import fs from 'node:fs';
import { store, getSettings } from '../store.js';
import { STATUS, UserError, clone, errorMessage, newId, nowIso, stableHash } from '../util.js';
import * as shopify from '../integrations/shopify.js';
import { checkPrintFile } from '../images.js';
import { designFilePath, getLink } from './designs.js';
import { createJob, finishJob, logJob } from './jobs.js';
import { getProvider } from '../providers/registry.js';
import { providerSettings } from '../providers/base.js';
import * as ai from '../ai/claude.js';

/**
 * Produktentwürfe – unabhängig vom Print-on-Demand-Anbieter.
 * Anbieterspezifisches steckt ausschließlich in src/server/providers/<anbieter>.js.
 */
const EMPTY = {
  provider: 'marketprint',
  internalName: '',
  publicTitle: '',
  productType: '',
  baseProduct: null, // { id, title, image, optionId?, optionLabel? }
  printerType: '',
  variantIds: [],
  printSides: '', // 'front' | 'back' | 'both' – Ansicht im Platzier-Editor
  neckPrint: null, // { lightDesignId, darkDesignId, neckPrintId, uploadedFor, uploadedAt } – nur Anbieter mit Nackendruck
  placements: [], // { printArea, designId, placement: { mode:'auto'|'named'|'custom', named, xPercent, yPercent, widthPercent }, alternative: { designId, colors: [] } | null }
  description: '',
  descriptionStyle: 'schlicht',
  descriptionSource: '',
  price: null,
  targetShops: [],
  mockups: '',
  collections: [], // { id, title }
  tags: [],
  notes: '',
};

const inFlight = new Set(); // Schutz gegen gleichzeitige Veröffentlichung (Doppelklick)
const providerOf = (draft) => getProvider(draft.provider || 'marketprint');
const providerName = (draft) => providerOf(draft).meta.name;

function allowedTargets(providerId) {
  return providerSettings(providerId).allowedShops || [];
}

function defaultTargets(providerId, current = []) {
  const allowed = allowedTargets(providerId);
  const keep = (current || []).filter((x) => allowed.includes(x));
  if (keep.length) return keep;
  const def = providerSettings(providerId).defaultShop;
  if (def && allowed.includes(def)) return [def];
  return allowed.length === 1 ? [allowed[0]] : [];
}

export function createProduct({ fromTemplate, fromProduct, provider } = {}) {
  let base = clone(EMPTY);
  if (provider) { getProvider(provider); base.provider = provider; }
  if (fromTemplate) {
    const t = store().templates.get(fromTemplate);
    if (!t) throw new UserError('Vorlage nicht gefunden.', { status: 404 });
    base = { ...base, ...clone(t.data), templateId: t.id };
  }
  if (fromProduct) {
    const p = store().products.get(fromProduct);
    if (!p) throw new UserError('Produkt nicht gefunden.', { status: 404 });
    base = { ...base, ...pickEditable(p), internalName: p.internalName ? `${p.internalName} (Kopie)` : '', publicTitle: p.publicTitle ? `${p.publicTitle}` : '', duplicatedFrom: p.id };
  }
  base.provider ||= 'marketprint';
  base.targetShops = defaultTargets(base.provider, base.targetShops);
  return store().products.put({ ...base, status: STATUS.DRAFT, publish: { state: 'none' }, validation: null, remote: null });
}

function pickEditable(p) {
  const out = {};
  for (const k of Object.keys(EMPTY)) out[k] = clone(p[k]);
  out.provider ||= 'marketprint';
  return out;
}

/** Automatisches Speichern aus der Oberfläche. Veröffentlichte/laufende Entwürfe sind gesperrt. */
export function saveProduct(id, patch) {
  const cur = store().products.get(id);
  if (!cur) throw new UserError('Produktentwurf nicht gefunden.', { status: 404 });
  if (['running', 'unknown', 'done'].includes(cur.publish?.state)) {
    throw new UserError(cur.publish.state === 'done' ? 'Dieses Produkt ist bereits veröffentlicht. Für Änderungen bitte „Produkt duplizieren“.' : 'Während der Ausführung bzw. bis zur Ergebnisprüfung ist der Entwurf gesperrt.', { status: 409 });
  }
  const next = { ...cur };
  for (const k of Object.keys(EMPTY)) if (patch[k] !== undefined) next[k] = clone(patch[k]);
  if (patch.neckPrint !== undefined) next.neckPrint = mergeNeckPrint(cur.neckPrint, patch.neckPrint);
  // Anderes Grundprodukt → Nackendruck gilt nicht mehr (nicht jedes Produkt bietet ihn an)
  if (patch.baseProduct !== undefined && patch.baseProduct?.id !== cur.baseProduct?.id) next.neckPrint = null;
  if (patch.provider !== undefined && patch.provider !== cur.provider) {
    getProvider(patch.provider);
    // Anbieterwechsel: anbieterspezifische Angaben zurücksetzen
    Object.assign(next, { baseProduct: null, variantIds: [], placements: [], printerType: '', mockups: '', neckPrint: null, printSides: '', targetShops: defaultTargets(patch.provider) });
    next.remote = null;
  }
  // Jede Änderung hebt eine bereits erteilte Prüfung auf.
  if (cur.status === STATUS.APPROVAL || cur.status === STATUS.READY) next.status = STATUS.DRAFT;
  next.review = null;
  return store().products.put(next);
}

const neckKey = (n) => `${n?.lightDesignId || ''}:${n?.darkDesignId || ''}`;

/** Die Kennung des hochgeladenen Nackendrucks setzt nur der Server; bei geänderten Motiven verfällt sie. */
function mergeNeckPrint(cur, patch) {
  if (!patch || !patch.lightDesignId) return patch?.darkDesignId ? { lightDesignId: null, darkDesignId: patch.darkDesignId, neckPrintId: null } : null;
  const n = { lightDesignId: patch.lightDesignId, darkDesignId: patch.darkDesignId || null, neckPrintId: null, uploadedFor: null, uploadedAt: null };
  if (cur?.neckPrintId && cur.uploadedFor === neckKey(n)) Object.assign(n, { neckPrintId: cur.neckPrintId, uploadedFor: cur.uploadedFor, uploadedAt: cur.uploadedAt, simulated: cur.simulated });
  return n;
}

/** Nackendruck zum Anbieter hochladen (legt nichts im Shop an). */
export async function uploadNeckPrint(id) {
  const draft = store().products.get(id);
  if (!draft) throw new UserError('Produktentwurf nicht gefunden.', { status: 404 });
  const prov = providerOf(draft);
  if (!prov.meta.capabilities.neckPrint || !prov.uploadNeckPrint) throw new UserError(`${prov.meta.name} bietet über die Schnittstelle keinen Nackendruck.`);
  if (['running', 'unknown', 'done'].includes(draft.publish?.state)) throw new UserError('Der Entwurf ist gesperrt.', { status: 409 });
  const n = draft.neckPrint;
  if (!n?.lightDesignId) throw new UserError('Bitte zuerst ein Motiv für den Nackendruck wählen (helle Textilien).');
  const file = (designId) => {
    const d = store().designs.get(designId);
    if (!d) throw new UserError('Motiv für den Nackendruck nicht gefunden.');
    return { filename: d.originalName || `${d.name}.png`, buffer: fs.readFileSync(designFilePath(d)), dpi: d.analysis?.dpi || undefined };
  };
  const job = createJob({ type: 'product.neckprint', title: `Nackendruck hochladen (${prov.meta.name}): ${draft.publicTitle || draft.internalName || id}`, refType: 'product', refId: id, simulated: prov.isSimulation() });
  try {
    const r = await prov.uploadNeckPrint({ light: file(n.lightDesignId), dark: n.darkDesignId ? file(n.darkDesignId) : null });
    const updated = store().products.update(id, (d) => {
      d.neckPrint = { ...d.neckPrint, neckPrintId: r.neckPrintId, uploadedFor: neckKey(d.neckPrint), uploadedAt: nowIso(), simulated: r.simulated };
      if (d.status === STATUS.APPROVAL || d.status === STATUS.READY) d.status = STATUS.DRAFT;
      d.review = null;
      return d;
    });
    finishJob(job.id, STATUS.SUCCESS, { result: { neckPrintId: r.neckPrintId, simulated: r.simulated }, msg: 'Nackendruck hochgeladen (noch nichts im Shop angelegt)' });
    return updated;
  } catch (err) {
    finishJob(job.id, STATUS.FAILED, { error: errorMessage(err) });
    throw err;
  }
}

export function deleteProduct(id, { confirm } = {}) {
  const p = store().products.get(id);
  if (!p) return false;
  if (!confirm) throw new UserError('Löschen muss bestätigt werden.');
  if (p.publish?.state === 'running') throw new UserError('Läuft gerade – kann nicht gelöscht werden.', { status: 409 });
  return store().products.remove(id);
}

export function duplicateProduct(id) {
  return createProduct({ fromProduct: id });
}

export function saveAsTemplate(id, name) {
  const p = store().products.get(id);
  if (!p) throw new UserError('Produktentwurf nicht gefunden.', { status: 404 });
  if (!name?.trim()) throw new UserError('Bitte einen Namen für die Vorlage angeben.');
  const data = pickEditable(p);
  // Vorlage = wiederverwendbare Einstellungen; Motiv-spezifische Angaben werden geleert.
  data.internalName = '';
  data.publicTitle = '';
  data.placements = (data.placements || []).map((pl) => ({ ...pl, designId: null, alternative: pl.alternative ? { ...pl.alternative, designId: null } : null }));
  return store().templates.put({ name: name.trim(), data, sourceProductId: id });
}

// ------------------------------------------------------------------ Prüfung

async function loadDetails(draft) {
  if (!draft.baseProduct?.id) return null;
  return providerOf(draft).details(draft.baseProduct.id);
}

function linkFn(draft) {
  return (designId) => getLink(store().designs.get(designId), draft.provider || 'marketprint')?.imageId;
}

function designGeometry(designId) {
  const d = store().designs.get(designId);
  return d?.analysis?.width ? { width: d.analysis.width, height: d.analysis.height } : null;
}

const colorKey = (v) => v.colorHex || v.color;

export async function validateProduct(id) {
  const draft = store().products.get(id);
  if (!draft) throw new UserError('Produktentwurf nicht gefunden.', { status: 404 });
  const prov = providerOf(draft);
  const name = prov.meta.name;
  const caps = prov.meta.capabilities;
  const issues = [];
  const add = (field, level, text) => issues.push({ field, level, text });
  let details = null;
  try { details = await loadDetails(draft); } catch (err) { add('baseProduct', 'error', `${name}-Produktdaten nicht abrufbar: ` + errorMessage(err)); }

  if (!draft.internalName?.trim()) add('internalName', 'error', 'Interner Motivname fehlt.');
  if (!draft.publicTitle?.trim()) add('publicTitle', 'error', 'Öffentlicher Produktname fehlt.');
  if (!draft.baseProduct?.id) add('baseProduct', 'error', `Kein ${name}-Grundprodukt gewählt.`);

  const fileChecks = {};
  if (details) {
    const varMap = new Map(details.variants.map((v) => [v.id, v]));
    const selected = (draft.variantIds || []).map((vid) => varMap.get(vid)).filter(Boolean);
    if (!selected.length) add('variantIds', 'error', 'Mindestens eine Variante (Farbe und Größe) wählen.');
    if (selected.length !== (draft.variantIds || []).length) add('variantIds', 'error', `Einige gewählte Varianten gibt es bei ${name} nicht mehr. Bitte neu wählen.`);
    const unavailable = selected.filter((v) => v.available === false);
    if (unavailable.length) add('variantIds', 'warn', `${unavailable.length} gewählte Variante(n) sind laut ${name} derzeit nicht verfügbar.`);

    const types = details.supportedPrinterTypes || [];
    if (types.length > 1 && !types.includes(draft.printerType)) add('printerType', 'error', `Druckverfahren wählen (${types.join(', ').toUpperCase()}).`);

    const areas = new Map((details.printAreas || []).map((a) => [a.name, a]));
    const placements = draft.placements || [];
    if (!placements.some((p) => p.designId)) add('placements', 'error', 'Mindestens eine Druckfläche mit Motiv belegen.');
    for (const pl of placements) {
      if (!pl.designId) continue;
      const area = areas.get(pl.printArea);
      if (!area) { add('placements', 'error', `Druckfläche „${pl.printArea}“ gibt es bei diesem Produkt nicht.`); continue; }
      const design = store().designs.get(pl.designId);
      if (!design) { add('placements', 'error', `Motiv für „${pl.printArea}“ nicht in der Designbibliothek gefunden.`); continue; }
      if (!getLink(design, draft.provider)?.imageId) add('placements', 'error', `„${design.name}“ ist noch nicht mit ${name} verknüpft (Designbibliothek → Design öffnen → ${name}).`);
      if (!fs.existsSync(designFilePath(design))) add('placements', 'error', `Die Datei von „${design.name}“ fehlt im Datenordner.`);
      if (pl.placement?.mode === 'named' && !caps.namedPlacements?.length) add('placements', 'error', `${name} unterstützt keine benannten Positionen. Bitte „automatisch“ oder „frei positionieren“ wählen.`);
      const placement = pl.placement?.mode === 'named' ? pl.placement.named : pl.placement?.mode === 'custom' ? pl.placement : 'auto';
      const notes = checkPrintFile({ analysis: design.analysis, printArea: area, placement, printerType: draft.printerType || types[0] });
      fileChecks[pl.printArea] = notes;
      for (const n of notes.filter((x) => x.level === 'error')) add('placements', 'error', `${pl.printArea}: ${n.text}`);
      if (pl.alternative?.designId) {
        if (!caps.alternativeDesign || details.hasAlternativeDesign === false) add('placements', 'error', 'Dieses Grundprodukt unterstützt keine Alternativ-Motive je Farbe.');
        const alt = store().designs.get(pl.alternative.designId);
        if (!getLink(alt, draft.provider)?.imageId) add('placements', 'error', `Alternativ-Motiv für „${pl.printArea}“ ist nicht mit ${name} verknüpft.`);
        if (!pl.alternative.colors?.length) add('placements', 'error', `Für das Alternativ-Motiv auf „${pl.printArea}“ mindestens eine Farbe wählen.`);
        const selColors = new Set(selected.map(colorKey));
        if ((pl.alternative.colors || []).some((c) => !selColors.has(c))) add('placements', 'warn', 'Das Alternativ-Motiv ist Farben zugeordnet, die nicht ausgewählt sind.');
        if (alt && design.analysis?.width && alt.analysis?.width && (alt.analysis.width !== design.analysis.width || alt.analysis.height !== design.analysis.height)) {
          add('placements', 'warn', 'Alternativ-Motiv hat andere Pixelmaße als das Hauptmotiv. Gleiche Maße und gleiches Layout werden empfohlen.');
        }
      }
    }
    const price = Number(draft.price);
    const known = selected.map((v) => v.price).filter((p) => p !== null && p !== undefined);
    const maxCatalogue = known.length ? Math.max(...known.map(Number)) : null;
    if (!(price > 0)) add('price', 'error', 'Verkaufspreis fehlt.');
    else if (maxCatalogue !== null && price <= maxCatalogue) add('price', 'error', `Der Verkaufspreis (${price.toFixed(2)} €) liegt nicht über dem höchsten ${details.priceLabel || 'Katalogpreis'} der gewählten Varianten (${maxCatalogue.toFixed(2)} €).`);
    else if (maxCatalogue === null && selected.length) add('price', 'warn', `${name} liefert den Einkaufspreis erst beim Anlegen. Bitte den Preis danach in ${name} kontrollieren.`);
    if (draft.provider === 'marketprint') {
      if (placements.filter((p) => p.designId).length > 1) add('price', 'warn', 'Mehrere Druckflächen: MarketPrint berechnet laut Schnittstelle Aufschläge für zusätzliche Druckflächen. Die genaue Höhe liefert die Schnittstelle nicht.');
      if (draft.printerType === 'dtf') add('price', 'warn', 'DTF: MarketPrint berechnet laut Schnittstelle einen Aufschlag. Die genaue Höhe liefert die Schnittstelle nicht.');
    }
  }

  if (draft.neckPrint?.lightDesignId) {
    if (!caps.neckPrint) add('neckPrint', 'error', `${name} unterstützt keinen Nackendruck über die Schnittstelle.`);
    else if (details && !details.hasNeckPrint) add('neckPrint', 'error', `Für dieses Grundprodukt bietet ${name} keinen Nackendruck an. Bitte den Nackendruck entfernen.`);
    else if (!draft.neckPrint.neckPrintId) add('neckPrint', 'error', `Nackendruck ist gewählt, aber noch nicht zu ${name} hochgeladen (Schaltfläche „Nackendruck hochladen“).`);
    else if (draft.provider === 'marketprint') add('neckPrint', 'warn', 'Nackendruck: MarketPrint berechnet laut Schnittstelle einen Aufschlag pro Bestellung.');
  } else if (draft.neckPrint?.darkDesignId) add('neckPrint', 'error', 'Für den Nackendruck fehlt das Motiv für helle Textilien (Pflicht).');

  if (caps.mockupChoice && !draft.mockups) add('mockups', 'error', 'Bitte festlegen, welche Mockups als Produktbilder verwendet werden.');
  if (!draft.targetShops?.length) add('targetShops', 'error', 'Zielshop wählen.');
  else {
    const notAllowed = draft.targetShops.filter((s) => !allowedTargets(draft.provider).includes(s));
    if (notAllowed.length) add('targetShops', 'error', `Nicht als Zielshop freigegeben: ${notAllowed.join(', ')} (Einstellungen → Anbieter → ${name} → erlaubte Zielshops).`);
    if (draft.provider !== 'marketprint' && draft.targetShops.length > 1) add('targetShops', 'error', `${name}: bitte genau einen Zielshop wählen.`);
    try {
      const acc = await prov.account();
      const targets = new Map(acc.targets.map((t) => [t.id, t]));
      const bad = draft.targetShops.filter((s) => !targets.has(s));
      if (bad.length) add('targetShops', 'error', `Diese Shops sind nicht mit deinem ${name}-Konto verbunden: ${bad.join(', ')}`);
      for (const s of draft.targetShops) if (targets.get(s) && targets.get(s).canPublish === false) add('targetShops', 'warn', `${targets.get(s).label}: ${targets.get(s).note || 'Veröffentlichen über die Schnittstelle nicht möglich.'}`);
    } catch (err) { add('targetShops', 'warn', 'Verbundene Shops konnten nicht geprüft werden: ' + errorMessage(err)); }
  }
  if (!draft.description?.trim()) add('description', 'warn', `Keine eigene Beschreibung: ${name} verwendet dann seinen Standardtext.`);
  if (draft.collections?.length || (draft.tags?.length && !caps.tags)) {
    if (!shopify.connectionKinds().adminApp) add('collections', 'warn', `Kollektionen${caps.tags ? '' : ' und Tags'} setzt ${name} nicht. Ohne Shopify-Admin-App werden sie nicht übertragen.`);
  }

  const hasError = issues.some((i) => i.level === 'error');
  const status = hasError ? STATUS.MISSING : STATUS.READY;
  const validation = { at: nowIso(), issues, fileChecks };
  store().products.update(id, (d) => {
    if (!['running', 'unknown', 'done'].includes(d.publish?.state) && d.status !== STATUS.APPROVAL) d.status = status;
    d.validation = validation;
    return d;
  });
  return { status, issues, fileChecks, details: details ? { printAreas: details.printAreas, supportedPrinterTypes: details.supportedPrinterTypes } : null };
}

/** Genau die Daten, die an den Anbieter gesendet werden. */
export async function buildRequest(draft, details) {
  details ||= await loadDetails(draft);
  return providerOf(draft).buildRequest(draft, { details, link: linkFn(draft), designGeometry });
}

/** „Zur Veröffentlichung prüfen“: erstellt die verbindliche Zusammenfassung. */
export async function reviewProduct(id) {
  const v = await validateProduct(id);
  const draft = store().products.get(id);
  if (v.status !== STATUS.READY) return { ok: false, status: v.status, issues: v.issues };
  const prov = providerOf(draft);
  const details = await loadDetails(draft);
  const request = await buildRequest(draft, details);
  const post = { collections: draft.collections || [], tags: prov.meta.capabilities.tags ? [] : (draft.tags || []) };
  const varMap = new Map(details.variants.map((x) => [x.id, x]));
  const byColor = {};
  for (const vid of draft.variantIds) {
    const vr = varMap.get(vid);
    (byColor[vr.color] ||= { color: vr.color, hex: vr.colorHex, sizes: [], catalogue: [] });
    byColor[vr.color].sizes.push(vr.size);
    if (vr.price !== null && vr.price !== undefined) byColor[vr.color].catalogue.push(Number(vr.price));
  }
  const files = (draft.placements || []).filter((p) => p.designId).map((p) => {
    const d = store().designs.get(p.designId);
    const alt = p.alternative?.designId ? store().designs.get(p.alternative.designId) : null;
    return {
      printArea: p.printArea,
      design: d?.name, file: d?.originalName, providerFileId: getLink(d, draft.provider)?.imageId,
      placement: p.placement?.mode === 'custom' ? `x ${pct(p.placement.xPercent)}, y ${pct(p.placement.yPercent)}, Breite ${pct(p.placement.widthPercent)}` : p.placement?.mode === 'named' ? p.placement.named : 'automatisch eingepasst',
      alternative: alt ? { design: alt.name, colors: p.alternative.colors } : null,
      dpi: (v.fileChecks?.[p.printArea] || []).find((n) => n.dpi)?.dpi || null,
    };
  });
  const catalogueAll = Object.values(byColor).flatMap((c) => c.catalogue);
  let targetLabels = draft.targetShops;
  try { const acc = await prov.account(); targetLabels = draft.targetShops.map((t) => acc.targets.find((x) => x.id === t)?.label || t); } catch { /* Bezeichnungen optional */ }
  const summary = {
    action: `${prov.meta.name}: Produkt anlegen und veröffentlichen`,
    provider: prov.meta.name,
    simulated: prov.isSimulation(),
    shops: targetLabels,
    title: draft.publicTitle.trim(),
    internalName: draft.internalName,
    baseProduct: draft.baseProduct.title + (draft.baseProduct.optionLabel ? ` · ${draft.baseProduct.optionLabel}` : ''),
    printerType: draft.printerType || (details.supportedPrinterTypes || [])[0] || '–',
    variants: Object.values(byColor).map((c) => ({ color: c.color, hex: c.hex, sizes: c.sizes })),
    variantCount: draft.variantIds.length,
    price: Number(draft.price),
    catalogueMin: catalogueAll.length ? Math.min(...catalogueAll) : null,
    catalogueMax: catalogueAll.length ? Math.max(...catalogueAll) : null,
    priceLabel: details.priceLabel,
    files,
    neckPrint: draft.neckPrint?.neckPrintId ? {
      light: store().designs.get(draft.neckPrint.lightDesignId)?.name || '–',
      dark: draft.neckPrint.darkDesignId ? store().designs.get(draft.neckPrint.darkDesignId)?.name || '–' : null,
      id: draft.neckPrint.neckPrintId,
    } : null,
    mockups: prov.meta.capabilities.mockupChoice ? (draft.mockups === 'all' ? 'Alle Mockups' : 'Nur Mockups mit Motiv') : `Erzeugt ${prov.meta.name}`,
    description: draft.description?.trim() ? draft.description.trim().slice(0, 600) : `(${prov.meta.name}-Standardtext)`,
    post,
    tags: prov.meta.capabilities.tags ? draft.tags || [] : [],
    effect: [
      prov.meta.publishEffect(targetLabels),
      'Es wird KEINE Bestellung und KEINE Zahlung ausgelöst. Kosten entstehen erst bei Kundenbestellungen.',
      post.collections.length || post.tags.length ? 'Danach werden Kollektionen/Tags in Shopify gesetzt, sofern die Shopify-Admin-App verbunden ist und das Produkt eindeutig gefunden wird.' : null,
    ].filter(Boolean),
    warnings: v.issues.filter((i) => i.level === 'warn').map((i) => i.text),
  };
  const approvalHash = stableHash({ provider: draft.provider, request, post });
  store().products.update(id, (d) => { d.status = STATUS.APPROVAL; d.review = { at: nowIso(), approvalHash, summary }; return d; });
  return { ok: true, status: STATUS.APPROVAL, approvalHash, summary };
}

function pct(v) { return `${Math.round(Number(v) * 100)} %`; }

/** „Echte Mockups erzeugen“ (nur Anbieter, die das vor dem Veröffentlichen erlauben). */
export async function createMockups(id) {
  const v = await validateProduct(id);
  const draft = store().products.get(id);
  const prov = providerOf(draft);
  if (!prov.meta.capabilities.realMockups || !prov.mockups) throw new UserError(`${prov.meta.name} bietet vor dem Veröffentlichen keine echten Mockups über die Schnittstelle.`);
  const blocking = v.issues.filter((i) => i.level === 'error' && ['placements', 'variantIds', 'baseProduct', 'targetShops', 'price'].includes(i.field));
  if (blocking.length) throw new UserError('Für Mockups bitte zuerst diese Angaben vervollständigen: ' + blocking.map((b) => b.text).join(' '));
  const details = await loadDetails(draft);
  const request = await buildRequest(draft, details);
  const job = createJob({ type: 'product.mockups', title: `Mockups erzeugen (${prov.meta.name}): ${draft.publicTitle || draft.internalName}`, refType: 'product', refId: id, simulated: prov.isSimulation() });
  try {
    const r = await prov.mockups(request, {
      draft, details, remote: draft.remote,
      ctx: { link: linkFn(draft), designGeometry },
      onRemote: async (remote) => { store().products.update(id, (d) => { d.remote = { ...remote, provider: draft.provider, at: nowIso() }; return d; }); logJob(job.id, `Entwurf beim Anbieter angelegt (${remote.id}) – noch nicht im Shop.`); },
    });
    store().products.update(id, (d) => { d.mockupImages = { at: nowIso(), images: r.images }; return d; });
    finishJob(job.id, STATUS.SUCCESS, { result: { images: r.images.length }, msg: `${r.images.length} Mockup(s) von ${prov.meta.name} erhalten` });
    return { images: r.images };
  } catch (err) {
    finishJob(job.id, STATUS.FAILED, { error: errorMessage(err) });
    throw err;
  }
}

/** „Jetzt veröffentlichen“ – nur mit passender Freigabe, genau einmal. */
export async function publishProduct(id, { approvalHash }) {
  if (inFlight.has(id)) throw new UserError('Die Veröffentlichung läuft bereits.', { status: 409, code: 'in_flight' });
  inFlight.add(id);
  let jobId = null;
  try {
    const draft = store().products.get(id);
    if (!draft) throw new UserError('Produktentwurf nicht gefunden.', { status: 404 });
    const prov = providerOf(draft);
    const state = draft.publish?.state;
    if (state === 'done') throw new UserError('Dieses Produkt wurde bereits veröffentlicht. Es wird kein zweites Mal angelegt.', { status: 409, code: 'already_done' });
    if (state === 'running' || state === 'unknown') throw new UserError('Für diesen Entwurf gibt es einen Vorgang mit unklarem Ergebnis. Bitte zuerst „Ergebnis prüfen“.', { status: 409, code: 'needs_check' });
    if (draft.status !== STATUS.APPROVAL || !draft.review) throw new UserError('Bitte zuerst „Zur Veröffentlichung prüfen“.', { status: 409 });
    const request = await buildRequest(draft);
    const post = { collections: draft.collections || [], tags: prov.meta.capabilities.tags ? [] : (draft.tags || []) };
    const notAllowed = (draft.targetShops || []).filter((s) => !allowedTargets(draft.provider).includes(s));
    if (notAllowed.length) throw new UserError(`Zielshop nicht freigegeben: ${notAllowed.join(', ')}. Es wurde nichts ausgeführt.`, { status: 409, code: 'shop_not_allowed' });
    if (stableHash({ provider: draft.provider, request, post }) !== approvalHash || draft.review.approvalHash !== approvalHash) {
      throw new UserError('Der Entwurf wurde seit der Prüfung verändert. Bitte erneut prüfen und freigeben.', { status: 409, code: 'changed' });
    }
    const key = newId('pub_');
    const job = createJob({ type: 'product.publish', title: `Produkt veröffentlichen (${prov.meta.name}): ${draft.publicTitle}`, refType: 'product', refId: id, simulated: prov.isSimulation() });
    jobId = job.id;
    // Zustand VOR dem Schreibaufruf dauerhaft festhalten.
    store().products.update(id, (d) => { d.status = STATUS.RUNNING; d.publish = { state: 'running', key, jobId, startedAt: nowIso(), approvalHash, provider: draft.provider, remote: d.remote || null }; return d; });
    logJob(jobId, `${prov.meta.name}: Veröffentlichung (${draft.variantIds.length} Varianten)`);

    let result;
    try {
      result = await prov.publish(request, {
        draft, remote: draft.remote,
        log: (m) => logJob(jobId, m),
        onRemote: async (remote) => {
          const r = { ...remote, provider: draft.provider, at: nowIso() };
          store().products.update(id, (d) => { d.remote = r; d.publish = { ...d.publish, remote: r }; return d; });
          logJob(jobId, `Beim Anbieter angelegt: ${remote.id}`);
        },
      });
    } catch (err) {
      const definitiveFailure = ['tool_error', 'tool_not_called', 'mp_not_setup', 'mp_auth', 'claude_missing', 'provider_auth', 'provider_missing_token', 'shop_not_allowed'].includes(err.code);
      const st = definitiveFailure ? STATUS.FAILED : STATUS.CHECK;
      store().products.update(id, (d) => { d.status = st; d.publish = { ...d.publish, state: definitiveFailure ? 'failed' : 'unknown', finishedAt: nowIso(), error: errorMessage(err) }; return d; });
      finishJob(jobId, st, { error: errorMessage(err), msg: definitiveFailure ? `${prov.meta.name} hat abgelehnt / nichts ausgeführt` : 'Ergebnis unklar – bitte prüfen' });
      throw new UserError(definitiveFailure ? `Veröffentlichung fehlgeschlagen: ${errorMessage(err)}` : `Ergebnis unklar: ${errorMessage(err)} – bitte „Ergebnis prüfen“, bevor erneut veröffentlicht wird.`, { status: 502, code: definitiveFailure ? 'failed' : 'needs_check' });
    }
    logJob(jobId, result.message || `${prov.meta.name} hat das Anlegen bestätigt.`);
    const links = [...(result.links || [])];
    let postResult = null;
    let shopifyProduct = null;
    if (!result.simulated && shopify.connectionKinds().adminApp && result.confirmed) {
      try {
        shopifyProduct = await findCreatedShopifyProduct(result.shopifyTitle || draft.publicTitle, store().products.get(id).publish.startedAt);
        if (shopifyProduct) {
          links.unshift({ label: 'Produkt in Shopify', url: `https://${getSettings().shop.domain}/admin/products/${shopify.gid.num(shopifyProduct.id)}` });
          if (shopifyProduct.onlineStoreUrl) links.push({ label: 'Im Shop ansehen', url: shopifyProduct.onlineStoreUrl });
        }
        if (post.collections.length || post.tags.length) postResult = await applyPostSteps(shopifyProduct, post, jobId);
      } catch (err) {
        postResult = { ok: false, message: 'Kollektionen/Tags nicht gesetzt: ' + errorMessage(err) };
        logJob(jobId, postResult.message);
      }
    } else if (post.collections.length || post.tags.length) {
      postResult = { ok: false, message: result.simulated ? 'Simulation: Kollektionen/Tags nicht gesetzt.' : 'Kollektionen/Tags nicht gesetzt (keine Shopify-Admin-App verbunden).' };
    }
    // Erfolg nur, wenn der Anbieter bestätigt; „angenommen, Shop-Bestätigung ausstehend“ → prüfen
    const finalStatus = result.confirmed ? STATUS.SUCCESS : STATUS.CHECK;
    const resultObj = { provider: draft.provider, remoteId: result.remoteId, shops: result.shops, listingImages: result.listingImages || [], links, postSteps: postResult, simulated: Boolean(result.simulated), shopifyProductId: shopifyProduct?.id || null, message: result.message || null, marketprint: draft.provider === 'marketprint' ? { draftId: result.remoteId, listingImages: result.listingImages } : undefined };
    store().products.update(id, (d) => { d.status = finalStatus; d.publish = { ...d.publish, state: result.confirmed ? 'done' : 'unknown', finishedAt: nowIso(), result: resultObj }; return d; });
    finishJob(jobId, finalStatus, { result: resultObj, msg: result.simulated ? 'Simulation abgeschlossen (nichts angelegt)' : result.confirmed ? `Von ${prov.meta.name} bestätigt` : 'Angenommen – Bestätigung ausstehend' });
    return { status: finalStatus, result: resultObj };
  } finally {
    inFlight.delete(id);
  }
}

async function findCreatedShopifyProduct(title, startedAt) {
  const since = new Date(Date.parse(startedAt) - 10 * 60_000).toISOString();
  const safeTitle = title.replace(/["\\]/g, ' ');
  for (let i = 0; i < 6; i++) {
    const found = (await shopify.searchProducts(`title:"${safeTitle}" created_at:>='${since}'`, 10)).filter((p) => p.title === title);
    if (found.length === 1) return found[0];
    if (found.length > 1) return null; // nicht eindeutig
    await new Promise((r) => setTimeout(r, 5000)); // Synchronisation Anbieter → Shopify abwarten
  }
  return null;
}

async function applyPostSteps(product, post, jobId) {
  if (!product) return { ok: false, message: 'Produkt in Shopify nicht eindeutig gefunden – Kollektionen/Tags bitte manuell setzen.' };
  const input = { id: product.id };
  if (post.tags.length) input.tags = [...new Set([...(product.tags || []), ...post.tags])];
  if (post.collections.length) input.collectionsToJoin = post.collections.map((c) => c.id);
  await shopify.updateProduct(input);
  const check = await shopify.getProduct(product.id);
  const missing = post.collections.filter((c) => !check.collections.nodes.some((n) => n.id === c.id));
  logJob(jobId, missing.length ? `Kollektionen nicht bestätigt: ${missing.map((m) => m.title).join(', ')}` : 'Kollektionen/Tags in Shopify gesetzt und bestätigt.');
  return { ok: !missing.length, message: missing.length ? 'Einige Kollektionen wurden nicht bestätigt (z. B. automatische Kollektionen).' : 'Kollektionen/Tags gesetzt.' };
}

/** „Ergebnis prüfen“ bei unklarem Ausgang. */
export async function reconcileProduct(id, { action } = {}) {
  const draft = store().products.get(id);
  if (!draft) throw new UserError('Produktentwurf nicht gefunden.', { status: 404 });
  if (!['unknown', 'running'].includes(draft.publish?.state) && action !== 'unlock-failed') throw new UserError('Kein unklarer Vorgang vorhanden.');
  if (inFlight.has(id)) throw new UserError('Läuft noch.', { status: 409 });
  const prov = providerOf(draft);
  if (action === 'auto') {
    // 1) beim Anbieter selbst nachsehen (wenn möglich)
    const r = await prov.reconcile(draft).catch(() => null);
    if (r?.found) {
      const resultObj = { ...(draft.publish.result || {}), links: [...(draft.publish.result?.links || []), ...(r.links || [])], reconciled: true };
      store().products.update(id, (d) => { d.status = STATUS.SUCCESS; d.publish = { ...d.publish, state: 'done', result: resultObj, reconciledAt: nowIso() }; return d; });
      if (draft.publish.jobId) finishJob(draft.publish.jobId, STATUS.SUCCESS, { result: resultObj, msg: `Nachträglich bei ${prov.meta.name} bestätigt` });
      return { found: true, status: STATUS.SUCCESS };
    }
    // 2) in Shopify suchen
    if (shopify.connectionKinds().adminApp) {
      const p = await findCreatedShopifyProduct(draft.publicTitle, draft.publish.startedAt);
      if (p) {
        const resultObj = { links: [{ label: 'Produkt in Shopify', url: `https://${getSettings().shop.domain}/admin/products/${shopify.gid.num(p.id)}` }], reconciled: true };
        store().products.update(id, (d) => { d.status = STATUS.SUCCESS; d.publish = { ...d.publish, state: 'done', result: resultObj, reconciledAt: nowIso() }; return d; });
        if (draft.publish.jobId) finishJob(draft.publish.jobId, STATUS.SUCCESS, { result: resultObj, msg: 'Nachträglich in Shopify gefunden' });
        return { found: true, status: STATUS.SUCCESS };
      }
    }
    return { found: false, message: r?.message || (shopify.connectionKinds().adminApp ? 'In Shopify wurde (noch) kein passendes Produkt gefunden. Die Übertragung kann einige Minuten dauern.' : 'Automatische Prüfung in Shopify braucht die Shopify-Admin-App. Bitte im Shopify-Admin nachsehen und dann hier bestätigen.') };
  }
  if (action === 'confirm-exists') {
    store().products.update(id, (d) => { d.status = STATUS.SUCCESS; d.publish = { ...d.publish, state: 'done', reconciledAt: nowIso(), result: { ...(d.publish.result || {}), manual: true, links: d.publish.result?.links || [] } }; return d; });
    if (draft.publish.jobId) finishJob(draft.publish.jobId, STATUS.SUCCESS, { msg: 'Von dir als vorhanden bestätigt' });
    return { status: STATUS.SUCCESS };
  }
  if (action === 'confirm-missing' || action === 'unlock-failed') {
    store().products.update(id, (d) => { d.status = STATUS.FAILED; d.publish = { ...d.publish, state: 'failed', reconciledAt: nowIso() }; return d; });
    if (draft.publish.jobId) finishJob(draft.publish.jobId, STATUS.FAILED, { msg: 'Von dir als nicht vorhanden bestätigt – erneuter Versuch erlaubt' });
    return { status: STATUS.FAILED };
  }
  throw new UserError('Unbekannte Aktion.');
}

/** Nach „Fehlgeschlagen“: Entwurf wieder bearbeitbar machen. */
export function reopenProduct(id) {
  return store().products.update(id, (d) => {
    if (d.publish?.state !== 'failed') throw new UserError('Nur fehlgeschlagene Vorgänge können wieder geöffnet werden.');
    d.publish = { state: 'none', previous: d.publish };
    d.status = STATUS.DRAFT;
    d.review = null;
    return d;
  });
}

// ------------------------------------------------------------------ Texte mit Claude

const DESC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title_suggestion', 'description_html', 'notes_for_review'],
  properties: {
    title_suggestion: { type: 'string' },
    description_html: { type: 'string' },
    notes_for_review: { type: 'array', items: { type: 'string' } },
  },
};

const STYLES = {
  kurz: 'Sehr kurz: 2–3 Sätze, dann eine knappe Liste der gesicherten Produktdaten.',
  schlicht: 'Schlicht und sachlich: ein Absatz (3–5 Sätze) zum Motiv, danach die gesicherten Produktdaten als Liste.',
  ausfuehrlich: 'Ausführlich und markengerecht: 2–3 Absätze zu Motiv und Haltung der Marke, danach die gesicherten Produktdaten als Liste.',
};

async function descriptionRequest(id, style) {
  const draft = store().products.get(id);
  if (!draft) throw new UserError('Produktentwurf nicht gefunden.', { status: 404 });
  if (!draft.baseProduct?.id) throw new UserError(`Bitte zuerst ein Grundprodukt wählen – die Produktdaten stammen von ${providerName(draft)}.`);
  const details = await loadDetails(draft);
  const source = details.descriptionSource || providerName(draft);
  const designs = (draft.placements || []).filter((p) => p.designId).map((p) => store().designs.get(p.designId)).filter(Boolean);
  const brand = getSettings().brand;
  const system = `Aufgabe: Produktbeschreibung (HTML: nur <p>, <ul>, <li>, <strong>, <em>, <br>) für den Shopify-Shop von APOLOGEA.
Stil: ${STYLES[style] || STYLES.schlicht}
Markenstimme: ${brand.voice}
Produktdaten (Material, Grammatur, Passform, Herkunft, Pflege) NUR aus dem ${source}-Text übernehmen und sinngemäß ins Deutsche übersetzen. Fehlt etwas, schreibe es nicht.
Bibelverse nur, wenn sie wörtlich in den Notizen der Inhaberin stehen; dann mit der angegebenen Stelle. Sonst keine Zitate.
Unter notes_for_review: alles, was die Inhaberin prüfen sollte (z. B. Übersetzungen von Materialangaben, Unsicherheiten).`;
  const parts = [
    { text: 'Bitte erstelle Produktname-Vorschlag und Beschreibung.' },
    { label: 'Angaben der Inhaberin', data: JSON.stringify({ interner_motivname: draft.internalName, oeffentlicher_name: draft.publicTitle, notizen: draft.notes, motive: designs.map((d) => ({ name: d.name, motiv: d.motif, kollektion: d.collection })) }, null, 1) },
    { label: `${source}-Grundprodukt „${details.title}“ – Originaltext (Quelle: ${source})`, data: String(details.description || '').replace(/<br\s*\/?>/gi, '\n') },
  ];
  return { system, parts, maxOutputTokens: 6000 };
}

export async function estimateDescription(id, style) {
  const r = await descriptionRequest(id, style);
  return ai.estimate(r);
}

export async function generateDescription(id, { style, confirmPaid }) {
  ai.requirePaidConfirmation(confirmPaid);
  const r = await descriptionRequest(id, style);
  const job = createJob({ type: 'ai.description', title: 'Produktbeschreibung mit Claude', refType: 'product', refId: id });
  try {
    const out = await ai.generateJson({ ...r, schema: DESC_SCHEMA, effort: 'low' });
    finishJob(job.id, STATUS.SUCCESS, { result: { costUsd: out.costUsd, engine: out.engine }, msg: 'Text erzeugt (noch nicht übernommen)' });
    return { ...out.data, costUsd: out.costUsd, engine: out.engine };
  } catch (err) {
    finishJob(job.id, STATUS.FAILED, { error: errorMessage(err) });
    throw err;
  }
}
