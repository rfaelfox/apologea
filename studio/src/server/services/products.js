import fs from 'node:fs';
import { store, getSettings } from '../store.js';
import { STATUS, UserError, clone, errorMessage, newId, nowIso, stableHash } from '../util.js';
import * as mp from '../integrations/marketprint.js';
import * as shopify from '../integrations/shopify.js';
import { checkPrintFile } from '../images.js';
import { designFilePath } from './designs.js';
import { createJob, finishJob, logJob } from './jobs.js';
import * as ai from '../ai/claude.js';

const EMPTY = {
  internalName: '',
  publicTitle: '',
  productType: '',
  baseProduct: null, // { id, title, image, hasNeckPrint, hasAlternativeDesign }
  printerType: '',
  variantIds: [],
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

export function createProduct({ fromTemplate, fromProduct } = {}) {
  let base = clone(EMPTY);
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
  const allowedShops = getSettings().marketprint.allowedShops || [];
  base.targetShops = (base.targetShops || []).filter((x) => allowedShops.includes(x));
  if (!base.targetShops.length) base.targetShops = [getSettings().marketprint.defaultShop].filter((x) => x && allowedShops.includes(x));
  return store().products.put({ ...base, status: STATUS.DRAFT, publish: { state: 'none' }, validation: null });
}

function pickEditable(p) {
  const out = {};
  for (const k of Object.keys(EMPTY)) out[k] = clone(p[k]);
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
  // Jede Änderung hebt eine bereits erteilte Prüfung auf.
  if (cur.status === STATUS.APPROVAL || cur.status === STATUS.READY) next.status = STATUS.DRAFT;
  next.review = null;
  return store().products.put(next);
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
  return mp.baseProductDetails(draft.baseProduct.id);
}

export async function validateProduct(id) {
  const draft = store().products.get(id);
  if (!draft) throw new UserError('Produktentwurf nicht gefunden.', { status: 404 });
  const issues = [];
  const add = (field, level, text) => issues.push({ field, level, text });
  let details = null;
  try { details = await loadDetails(draft); } catch (err) { add('baseProduct', 'error', 'MarketPrint-Produktdaten nicht abrufbar: ' + errorMessage(err)); }

  if (!draft.internalName?.trim()) add('internalName', 'error', 'Interner Motivname fehlt.');
  if (!draft.publicTitle?.trim()) add('publicTitle', 'error', 'Öffentlicher Produktname fehlt.');
  if (!draft.baseProduct?.id) add('baseProduct', 'error', 'Kein MarketPrint-Grundprodukt gewählt.');

  const fileChecks = {};
  if (details) {
    const varMap = new Map(details.variants.map((v) => [v.id, v]));
    const selected = (draft.variantIds || []).map((vid) => varMap.get(vid)).filter(Boolean);
    if (!selected.length) add('variantIds', 'error', 'Mindestens eine Variante (Farbe und Größe) wählen.');
    if (selected.length !== (draft.variantIds || []).length) add('variantIds', 'error', 'Einige gewählte Varianten gibt es bei MarketPrint nicht mehr. Bitte neu wählen.');
    const unavailable = selected.filter((v) => v.available === false);
    if (unavailable.length) add('variantIds', 'warn', `${unavailable.length} gewählte Variante(n) sind laut MarketPrint derzeit nicht verfügbar.`);

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
      if (!design.marketprint?.imageId) add('placements', 'error', `„${design.name}“ ist noch nicht mit MarketPrint verknüpft (Designbibliothek → „Mit MarketPrint verknüpfen“).`);
      if (!fs.existsSync(designFilePath(design))) add('placements', 'error', `Die Datei von „${design.name}“ fehlt im Datenordner.`);
      const placement = pl.placement?.mode === 'named' ? pl.placement.named : pl.placement?.mode === 'custom' ? pl.placement : 'auto';
      const notes = checkPrintFile({ analysis: design.analysis, printArea: area, placement, printerType: draft.printerType || types[0] });
      fileChecks[pl.printArea] = notes;
      for (const n of notes.filter((x) => x.level === 'error')) add('placements', 'error', `${pl.printArea}: ${n.text}`);
      if (pl.alternative?.designId) {
        if (!details.hasAlternativeDesign) add('placements', 'error', 'Dieses Grundprodukt unterstützt keine Alternativ-Motive je Farbe.');
        const alt = store().designs.get(pl.alternative.designId);
        if (!alt?.marketprint?.imageId) add('placements', 'error', `Alternativ-Motiv für „${pl.printArea}“ ist nicht mit MarketPrint verknüpft.`);
        if (!pl.alternative.colors?.length) add('placements', 'error', `Für das Alternativ-Motiv auf „${pl.printArea}“ mindestens eine Farbe wählen.`);
        const selColors = new Set(selected.map((v) => v.colorHex));
        if ((pl.alternative.colors || []).some((c) => !selColors.has(c))) add('placements', 'warn', 'Das Alternativ-Motiv ist Farben zugeordnet, die nicht ausgewählt sind.');
        if (alt && design.analysis?.width && alt.analysis?.width && (alt.analysis.width !== design.analysis.width || alt.analysis.height !== design.analysis.height)) {
          add('placements', 'warn', 'Alternativ-Motiv hat andere Pixelmaße als das Hauptmotiv. MarketPrint empfiehlt gleiche Maße und gleiches Layout.');
        }
      }
    }
    const price = Number(draft.price);
    const maxCatalogue = Math.max(0, ...selected.map((v) => Number(v.price) || 0));
    if (!(price > 0)) add('price', 'error', 'Verkaufspreis fehlt.');
    else if (selected.length && price <= maxCatalogue) add('price', 'error', `Der Verkaufspreis (${price.toFixed(2)} €) liegt nicht über dem höchsten MarketPrint-Katalogpreis der gewählten Varianten (${maxCatalogue.toFixed(2)} €).`);
    if (placements.filter((p) => p.designId).length > 1) add('price', 'warn', 'Mehrere Druckflächen: MarketPrint berechnet laut Schnittstelle Aufschläge für zusätzliche Druckflächen. Die genaue Höhe liefert die Schnittstelle nicht.');
    if (draft.printerType === 'dtf') add('price', 'warn', 'DTF: MarketPrint berechnet laut Schnittstelle einen Aufschlag. Die genaue Höhe liefert die Schnittstelle nicht.');
  }

  if (!draft.mockups) add('mockups', 'error', 'Bitte festlegen, welche Mockups als Produktbilder verwendet werden.');
  if (!draft.targetShops?.length) add('targetShops', 'error', 'Zielshop wählen.');
  else {
    try {
      const acc = await mp.accountInfo();
      const notAllowed = draft.targetShops.filter((s) => !(getSettings().marketprint.allowedShops || []).includes(s));
      if (notAllowed.length) add('targetShops', 'error', `Nicht als Zielshop freigegeben: ${notAllowed.join(', ')} (Einstellungen → MarketPrint → erlaubte Zielshops).`);
      const bad = draft.targetShops.filter((s) => !(acc.shopDomains || []).includes(s));
      if (bad.length) add('targetShops', 'error', `Diese Shops sind nicht mit deinem MarketPrint-Konto verbunden: ${bad.join(', ')}`);
    } catch (err) { add('targetShops', 'warn', 'Verbundene Shops konnten nicht geprüft werden: ' + errorMessage(err)); }
  }
  if (!draft.description?.trim()) add('description', 'warn', 'Keine eigene Beschreibung: MarketPrint verwendet dann seinen Standardtext.');
  if ((draft.collections?.length || draft.tags?.length)) {
    const kinds = shopify.connectionKinds();
    if (!kinds.adminApp) add('collections', 'warn', 'Kollektionen und Tags kann MarketPrint nicht setzen. Ohne Shopify-Admin-App werden sie nicht übertragen.');
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

/** Genau die Argumente für MarketPrint create_shop_product. */
export function buildCreateArgs(draft) {
  const images = [];
  for (const pl of draft.placements || []) {
    if (!pl.designId) continue;
    const design = store().designs.get(pl.designId);
    const entry = { imageId: design?.marketprint?.imageId, printArea: pl.printArea };
    if (pl.placement?.mode === 'named' && pl.placement.named) entry.placement = pl.placement.named;
    if (pl.placement?.mode === 'custom') entry.placement = { xPercent: num(pl.placement.xPercent), yPercent: num(pl.placement.yPercent), widthPercent: num(pl.placement.widthPercent) };
    images.push(entry);
    if (pl.alternative?.designId) {
      const alt = store().designs.get(pl.alternative.designId);
      images.push({ imageId: alt?.marketprint?.imageId, printArea: pl.printArea, alternativeColors: [...pl.alternative.colors] });
    }
  }
  const args = {
    baseProductId: draft.baseProduct?.id,
    variantIds: [...(draft.variantIds || [])],
    addToShops: [...(draft.targetShops || [])],
    images,
    mockups: draft.mockups,
    price: Number(draft.price),
    title: draft.publicTitle?.trim(),
  };
  if (draft.description?.trim()) args.description = draft.description.trim();
  if (draft.printerType) args.selectedPrinterType = draft.printerType;
  return args;
}

function num(v) { return Math.round(Number(v) * 10000) / 10000; }

/** „Zur Veröffentlichung prüfen“: erstellt die verbindliche Zusammenfassung. */
export async function reviewProduct(id) {
  const v = await validateProduct(id);
  const draft = store().products.get(id);
  if (v.status !== STATUS.READY) return { ok: false, status: v.status, issues: v.issues };
  const details = await loadDetails(draft);
  const args = buildCreateArgs(draft);
  const post = { collections: draft.collections || [], tags: draft.tags || [] };
  const varMap = new Map(details.variants.map((x) => [x.id, x]));
  const byColor = {};
  for (const vid of args.variantIds) {
    const vr = varMap.get(vid);
    (byColor[vr.color] ||= { color: vr.color, hex: vr.colorHex, sizes: [], catalogue: [] });
    byColor[vr.color].sizes.push(vr.size);
    byColor[vr.color].catalogue.push(Number(vr.price));
  }
  const files = (draft.placements || []).filter((p) => p.designId).map((p) => {
    const d = store().designs.get(p.designId);
    const alt = p.alternative?.designId ? store().designs.get(p.alternative.designId) : null;
    return {
      printArea: p.printArea,
      design: d?.name, file: d?.originalName, mpImageId: d?.marketprint?.imageId,
      placement: p.placement?.mode === 'custom' ? `x ${pct(p.placement.xPercent)}, y ${pct(p.placement.yPercent)}, Breite ${pct(p.placement.widthPercent)}` : p.placement?.mode === 'named' ? p.placement.named : 'automatisch eingepasst',
      alternative: alt ? { design: alt.name, colors: p.alternative.colors } : null,
    };
  });
  const catalogueAll = Object.values(byColor).flatMap((c) => c.catalogue);
  const summary = {
    action: 'MarketPrint: Produkt anlegen und veröffentlichen',
    simulated: mp.isSimulation(),
    shops: args.addToShops,
    title: args.title,
    internalName: draft.internalName,
    baseProduct: draft.baseProduct.title,
    printerType: args.selectedPrinterType || (details.supportedPrinterTypes || [])[0] || '–',
    variants: Object.values(byColor).map((c) => ({ color: c.color, hex: c.hex, sizes: c.sizes })),
    variantCount: args.variantIds.length,
    price: args.price,
    catalogueMin: Math.min(...catalogueAll),
    catalogueMax: Math.max(...catalogueAll),
    files,
    mockups: args.mockups === 'all' ? 'Alle Mockups' : 'Nur Mockups mit Motiv',
    description: args.description ? args.description.slice(0, 600) : '(MarketPrint-Standardtext)',
    post,
    effect: [
      `Legt bei MarketPrint ein neues Produkt an und veröffentlicht es SOFORT öffentlich in: ${args.addToShops.join(', ')}.`,
      'Es wird KEINE Bestellung und KEINE Zahlung ausgelöst. Kosten entstehen erst bei Kundenbestellungen (mindestens der Katalogpreis plus ggf. Aufschläge).',
      post.collections.length || post.tags.length ? 'Danach werden Kollektionen/Tags in Shopify gesetzt, sofern die Shopify-Admin-App verbunden ist und das Produkt eindeutig gefunden wird.' : null,
    ].filter(Boolean),
    warnings: v.issues.filter((i) => i.level === 'warn').map((i) => i.text),
  };
  const approvalHash = stableHash({ args, post });
  store().products.update(id, (d) => { d.status = STATUS.APPROVAL; d.review = { at: nowIso(), approvalHash, summary }; return d; });
  return { ok: true, status: STATUS.APPROVAL, approvalHash, summary };
}

function pct(v) { return `${Math.round(Number(v) * 100)} %`; }

/** „Jetzt veröffentlichen“ – nur mit passender Freigabe, genau einmal. */
export async function publishProduct(id, { approvalHash }) {
  if (inFlight.has(id)) throw new UserError('Die Veröffentlichung läuft bereits.', { status: 409, code: 'in_flight' });
  inFlight.add(id);
  let jobId = null;
  try {
    const draft = store().products.get(id);
    if (!draft) throw new UserError('Produktentwurf nicht gefunden.', { status: 404 });
    const state = draft.publish?.state;
    if (state === 'done') throw new UserError('Dieses Produkt wurde bereits veröffentlicht. Es wird kein zweites Mal angelegt.', { status: 409, code: 'already_done' });
    if (state === 'running' || state === 'unknown') throw new UserError('Für diesen Entwurf gibt es einen Vorgang mit unklarem Ergebnis. Bitte zuerst „Ergebnis prüfen“.', { status: 409, code: 'needs_check' });
    if (draft.status !== STATUS.APPROVAL || !draft.review) throw new UserError('Bitte zuerst „Zur Veröffentlichung prüfen“.', { status: 409 });
    const args = buildCreateArgs(draft);
    const post = { collections: draft.collections || [], tags: draft.tags || [] };
    const notAllowed = args.addToShops.filter((s) => !(getSettings().marketprint.allowedShops || []).includes(s));
    if (notAllowed.length) throw new UserError(`Zielshop nicht freigegeben: ${notAllowed.join(', ')}. Es wurde nichts ausgeführt.`, { status: 409, code: 'shop_not_allowed' });
    if (stableHash({ args, post }) !== approvalHash || draft.review.approvalHash !== approvalHash) {
      throw new UserError('Der Entwurf wurde seit der Prüfung verändert. Bitte erneut prüfen und freigeben.', { status: 409, code: 'changed' });
    }
    const key = newId('pub_');
    const job = createJob({ type: 'product.publish', title: `Produkt veröffentlichen: ${args.title}`, refType: 'product', refId: id, simulated: mp.isSimulation() });
    jobId = job.id;
    // Zustand VOR dem Schreibaufruf dauerhaft festhalten.
    store().products.update(id, (d) => { d.status = STATUS.RUNNING; d.publish = { state: 'running', key, jobId, startedAt: nowIso(), approvalHash }; return d; });
    logJob(jobId, `MarketPrint create_shop_product (${args.variantIds.length} Varianten, ${args.addToShops.join(', ')})`);

    let result;
    try {
      result = await mp.createShopProduct(args);
    } catch (err) {
      const definitiveFailure = err.code === 'tool_error' || err.code === 'tool_not_called' || err.code === 'mp_not_setup' || err.code === 'mp_auth' || err.code === 'claude_missing';
      const st = definitiveFailure ? STATUS.FAILED : STATUS.CHECK;
      store().products.update(id, (d) => { d.status = st; d.publish = { ...d.publish, state: definitiveFailure ? 'failed' : 'unknown', finishedAt: nowIso(), error: errorMessage(err) }; return d; });
      finishJob(jobId, st, { error: errorMessage(err), msg: definitiveFailure ? 'MarketPrint hat abgelehnt / nichts ausgeführt' : 'Ergebnis unklar – bitte prüfen' });
      throw new UserError(definitiveFailure ? `Veröffentlichung fehlgeschlagen: ${errorMessage(err)}` : `Ergebnis unklar: ${errorMessage(err)} – bitte „Ergebnis prüfen“, bevor erneut veröffentlicht wird.`, { status: 502, code: definitiveFailure ? 'failed' : 'needs_check' });
    }
    logJob(jobId, 'MarketPrint hat das Anlegen bestätigt.');
    const confirmed = normalizeCreateResult(result);
    const links = [];
    for (const shop of confirmed.shops.length ? confirmed.shops : args.addToShops) {
      links.push({ label: `Shopify-Admin (${shop}): Produkte`, url: `https://${shop}/admin/products?query=${encodeURIComponent(args.title)}` });
    }
    let postResult = null;
    let shopifyProduct = null;
    if (!result.simulated && shopify.connectionKinds().adminApp) {
      try {
        shopifyProduct = await findCreatedShopifyProduct(args.title, store().products.get(id).publish.startedAt);
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
    const finalStatus = STATUS.SUCCESS;
    const resultObj = { marketprint: confirmed, links, postSteps: postResult, simulated: Boolean(result.simulated), shopifyProductId: shopifyProduct?.id || null };
    store().products.update(id, (d) => { d.status = finalStatus; d.publish = { ...d.publish, state: 'done', finishedAt: nowIso(), result: resultObj }; return d; });
    finishJob(jobId, finalStatus, { result: resultObj, msg: result.simulated ? 'Simulation abgeschlossen (nichts angelegt)' : 'Von MarketPrint bestätigt' });
    return { status: finalStatus, result: resultObj };
  } finally {
    inFlight.delete(id);
  }
}

function normalizeCreateResult(r) {
  const shops = r.publishedTo || r.shops || r.addedToShops || r.shopDomains || [];
  return {
    draftId: r.draftId || r.id || r.productId || null,
    shops: Array.isArray(shops) ? shops.map((s) => (typeof s === 'string' ? s : s.domain || s.shop || JSON.stringify(s))) : [],
    listingImages: r.listingImages || r.images || r.mockups || [],
    raw: r,
  };
}

async function findCreatedShopifyProduct(title, startedAt) {
  const since = new Date(Date.parse(startedAt) - 10 * 60_000).toISOString();
  const safeTitle = title.replace(/["\\]/g, ' ');
  for (let i = 0; i < 6; i++) {
    const found = (await shopify.searchProducts(`title:"${safeTitle}" created_at:>='${since}'`, 10)).filter((p) => p.title === title);
    if (found.length === 1) return found[0];
    if (found.length > 1) return null; // nicht eindeutig
    await new Promise((r) => setTimeout(r, 5000)); // Synchronisation MarketPrint → Shopify abwarten
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
  if (action === 'auto') {
    if (!shopify.connectionKinds().adminApp) return { found: null, message: 'Automatische Prüfung braucht die Shopify-Admin-App. Bitte im Shopify-Admin nachsehen und dann hier bestätigen.' };
    const p = await findCreatedShopifyProduct(draft.publicTitle, draft.publish.startedAt);
    if (p) {
      const resultObj = { links: [{ label: 'Produkt in Shopify', url: `https://${getSettings().shop.domain}/admin/products/${shopify.gid.num(p.id)}` }], reconciled: true };
      store().products.update(id, (d) => { d.status = STATUS.SUCCESS; d.publish = { ...d.publish, state: 'done', result: resultObj, reconciledAt: nowIso() }; return d; });
      if (draft.publish.jobId) finishJob(draft.publish.jobId, STATUS.SUCCESS, { result: resultObj, msg: 'Nachträglich in Shopify gefunden' });
      return { found: true, status: STATUS.SUCCESS };
    }
    return { found: false, message: 'In Shopify wurde (noch) kein passendes Produkt gefunden. Die Übertragung von MarketPrint kann einige Minuten dauern.' };
  }
  if (action === 'confirm-exists') {
    store().products.update(id, (d) => { d.status = STATUS.SUCCESS; d.publish = { ...d.publish, state: 'done', reconciledAt: nowIso(), result: { manual: true, links: [] } }; return d; });
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
  if (!draft.baseProduct?.id) throw new UserError('Bitte zuerst ein Grundprodukt wählen – die Produktdaten stammen von MarketPrint.');
  const details = await loadDetails(draft);
  const designs = (draft.placements || []).filter((p) => p.designId).map((p) => store().designs.get(p.designId)).filter(Boolean);
  const brand = getSettings().brand;
  const system = `Aufgabe: Produktbeschreibung (HTML: nur <p>, <ul>, <li>, <strong>, <em>, <br>) für den Shopify-Shop von APOLOGEA.
Stil: ${STYLES[style] || STYLES.schlicht}
Markenstimme: ${brand.voice}
Produktdaten (Material, Grammatur, Passform, Herkunft, Pflege) NUR aus dem MarketPrint-Text übernehmen und sinngemäß ins Deutsche übersetzen. Fehlt etwas, schreibe es nicht.
Bibelverse nur, wenn sie wörtlich in den Notizen der Inhaberin stehen; dann mit der angegebenen Stelle. Sonst keine Zitate.
Unter notes_for_review: alles, was die Inhaberin prüfen sollte (z. B. Übersetzungen von Materialangaben, Unsicherheiten).`;
  const parts = [
    { text: 'Bitte erstelle Produktname-Vorschlag und Beschreibung.' },
    { label: 'Angaben der Inhaberin', data: JSON.stringify({ interner_motivname: draft.internalName, oeffentlicher_name: draft.publicTitle, notizen: draft.notes, motive: designs.map((d) => ({ name: d.name, motiv: d.motif, kollektion: d.collection })) }, null, 1) },
    { label: `MarketPrint-Grundprodukt „${details.title}“ – Originaltext (Englisch, Quelle: MarketPrint)`, data: String(details.description || '').replace(/<br\s*\/?>/gi, '\n') },
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
