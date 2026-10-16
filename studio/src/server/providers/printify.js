import { UserError } from '../util.js';
import { cached, providerSettings, restCall, testBaseUrl } from './base.js';
import { printifySim } from '../../../fixtures/printify/sim.js';

/**
 * Anbieter-Baustein Printify (offizielle REST-API v1, persönlicher Zugangsschlüssel).
 * Ablauf: Produkt als Entwurf im Printify-Konto anlegen (noch nicht im Shop) → echte Mockups ansehen →
 * „Jetzt veröffentlichen“ überträgt es an den verbundenen Shopify-Shop. Preise in Cent.
 */
const BASE = () => testBaseUrl('APOLOGEA_PRINTIFY_URL') || 'https://api.printify.com/v1';

export const meta = {
  id: 'printify',
  name: 'Printify',
  website: 'https://printify.com',
  modes: [
    { id: 'api', label: 'Printify-API (persönlicher Zugangsschlüssel)', desc: 'Printify → Mein Konto → Verbindungen → „Personal Access Token“ erzeugen. Benötigte Rechte: shops.read, catalog.read, print_providers.read, products.read, products.write, uploads.read, uploads.write.' },
    { id: 'simulation', label: 'Simulation (Beispieldaten, nichts wird angelegt)', desc: 'Erfundene Beispieldaten nur zum Ausprobieren des Ablaufs.' },
    { id: 'none', label: 'Nicht verbunden' },
  ],
  secrets: [{ name: 'printify.token', label: 'Printify Personal Access Token', placeholder: 'eyJ…', hint: 'Wird verschlüsselt gespeichert.' }],
  capabilities: {
    alternativeDesign: true, // umgesetzt über eigene Druckbereiche für ausgewählte Farben
    neckPrint: false,
    namedPlacements: [],
    mockupChoice: false,
    twoStep: true,
    realMockups: true,
    directUpload: { maxBytes: 100 * 1024 * 1024 },
    catalogOptions: true,
    tags: true,
  },
  linkHelp: 'Druckdatei direkt zu Printify hochladen (Schaltfläche) oder eine bereits in Printify hochgeladene Datei suchen und verknüpfen.',
  publishEffect: (targets) => `Legt das Produkt bei Printify an (falls noch nicht geschehen) und veröffentlicht es an den verbundenen Shop (${targets.join(', ')}). Printify überträgt es dann an Shopify.`,
};

const sim = () => (providerSettings('printify').mode === 'simulation' ? printifySim : null);
export const isSimulation = () => providerSettings('printify').mode === 'simulation';

function call(method, path, body, opts = {}) {
  const mode = providerSettings('printify').mode;
  if (mode === 'none') throw new UserError('Printify ist nicht verbunden (Einstellungen → Anbieter).', { status: 412, code: 'mp_not_setup' });
  return restCall({ provider: 'Printify', baseUrl: BASE(), method, path, body, tokenSecret: 'printify.token', sim: sim(), ...opts });
}

export async function account({ refresh } = {}) {
  const r = await cached('printify', `shops-${providerSettings('printify').mode}`, 6 * 3600_000, refresh, () => call('GET', '/shops.json'));
  const shops = Array.isArray(r.data) ? r.data : r.data?.data || [];
  return {
    label: 'Printify-Konto', cachedAt: r.cachedAt, simulated: isSimulation(),
    targets: shops.map((s) => ({ id: String(s.id), label: `${s.title} (${s.sales_channel})`, channel: s.sales_channel, canPublish: true })),
  };
}

export async function testConnection() {
  const a = await account({ refresh: true });
  return { ok: true, mode: providerSettings('printify').mode, account: a, message: a.simulated ? 'Simulation aktiv – es wird nichts bei Printify angelegt.' : `Printify verbunden: ${a.targets.length} Shop(s).` };
}

export async function catalog({ refresh } = {}) {
  const r = await cached('printify', `catalog-${providerSettings('printify').mode}`, 24 * 3600_000, refresh, () => call('GET', '/catalog/blueprints.json'));
  return { cachedAt: r.cachedAt, stale: r.stale, error: r.error, items: (r.data || []).map((b) => ({ id: String(b.id), title: b.title, image: (b.images || [])[0], brand: b.brand, model: b.model })) };
}

/** Bei Printify gehört zu jedem Grundprodukt ein Druckdienstleister (bestimmt Varianten, Preise, Druckflächen). */
export async function catalogOptions(blueprintId) {
  const r = await cached('printify', `pp-${providerSettings('printify').mode}-${blueprintId}`, 24 * 3600_000, false, () => call('GET', `/catalog/blueprints/${encodeURIComponent(blueprintId)}/print_providers.json`));
  return (r.data || []).map((p) => ({ id: String(p.id), label: p.title + (p.location?.country ? ` (${p.location.country})` : '') }));
}

export async function details(compoundId, { refresh } = {}) {
  const [bp, pp] = String(compoundId).split(':');
  if (!bp || !pp) throw new UserError('Bitte Grundprodukt und Druckdienstleister wählen.');
  const mode = providerSettings('printify').mode;
  const blueprint = (await cached('printify', `bp-${mode}-${bp}`, 24 * 3600_000, refresh, () => call('GET', `/catalog/blueprints/${bp}.json`))).data;
  const v = await cached('printify', `vars-${mode}-${bp}-${pp}`, 12 * 3600_000, refresh, () => call('GET', `/catalog/blueprints/${bp}/print_providers/${pp}/variants.json?show-out-of-stock=1`));
  const variants = v.data?.variants || [];
  const areas = new Map();
  for (const vr of variants) for (const ph of vr.placeholders || []) {
    const a = areas.get(ph.position);
    if (!a || ph.width * ph.height > a.width * a.height) areas.set(ph.position, { name: ph.position, width: ph.width, height: ph.height });
  }
  return {
    id: compoundId, blueprintId: bp, printProviderId: pp,
    title: blueprint.title, image: (blueprint.images || [])[0], description: blueprint.description || '',
    descriptionSource: 'Printify', priceLabel: 'Einkaufspreis: berechnet Printify beim Anlegen',
    supportedPrinterTypes: [],
    hasAlternativeDesign: true, hasNeckPrint: false,
    printAreas: [...areas.values()],
    variants: variants.map((x) => ({ id: String(x.id), size: x.options?.size || '–', color: x.options?.color || x.title, colorHex: null, price: null, available: x.is_available !== false, images: [] })),
    cachedAt: v.cachedAt,
  };
}

export async function listImages({ search } = {}) {
  const r = await call('GET', '/uploads.json?limit=100');
  const list = (r.data || []).filter((u) => !search || String(u.file_name).toLowerCase().includes(String(search).toLowerCase()));
  return { images: list.map((u) => ({ imageId: u.id, name: u.file_name, preview: u.preview_url })), simulated: isSimulation() };
}

export async function uploadImage({ filename, buffer }) {
  const r = await call('POST', '/uploads/images.json', { file_name: filename, contents: buffer.toString('base64') }, { timeoutMs: 10 * 60_000 });
  if (!r?.id) throw new UserError('Printify hat keine Bild-ID zurückgegeben.');
  return { imageId: r.id };
}

export const canDirectUpload = () => true;

/** Genaue Printify-Produktdaten. ctx: { details, link(designId), designGeometry(designId) } */
export function buildRequest(draft, ctx) {
  const d = ctx.details;
  const altVariantIds = new Set();
  const mainPh = [];
  const altPh = [];
  for (const pl of draft.placements || []) {
    if (!pl.designId) continue;
    const area = d.printAreas.find((a) => a.name === pl.printArea);
    mainPh.push({ position: pl.printArea, images: [imageEntry(pl, pl.designId, area, ctx)] });
    if (pl.alternative?.designId) {
      for (const vid of draft.variantIds) {
        const v = d.variants.find((x) => x.id === vid);
        if (v && (pl.alternative.colors || []).includes(colorKey(v))) altVariantIds.add(vid);
      }
      altPh.push({ position: pl.printArea, images: [imageEntry(pl, pl.alternative.designId, area, ctx)] });
    }
  }
  const mainIds = draft.variantIds.filter((x) => !altVariantIds.has(x)).map(Number);
  const printAreas = [];
  if (mainIds.length) printAreas.push({ variant_ids: mainIds, placeholders: mainPh });
  if (altVariantIds.size) {
    // Druckflächen ohne Alternativ-Motiv übernehmen das Hauptmotiv
    const altPositions = new Set(altPh.map((p) => p.position));
    printAreas.push({ variant_ids: [...altVariantIds].map(Number), placeholders: [...altPh, ...mainPh.filter((p) => !altPositions.has(p.position))] });
  }
  const req = {
    shopId: (draft.targetShops || [])[0],
    product: {
      title: draft.publicTitle?.trim(),
      description: draft.description?.trim() || d.description || '',
      blueprint_id: Number(d.blueprintId),
      print_provider_id: Number(d.printProviderId),
      variants: draft.variantIds.map((vid) => ({ id: Number(vid), price: Math.round(Number(draft.price) * 100), is_enabled: true })),
      print_areas: printAreas,
      tags: draft.tags || [],
    },
  };
  return req;
}

export const colorKey = (v) => v.colorHex || v.color;

function imageEntry(pl, designId, area, ctx) {
  const g = ctx.designGeometry(designId);
  let x = 0.5; let y = 0.5; let scale = 1;
  if (pl.placement?.mode === 'custom') {
    x = Number(pl.placement.xPercent); y = Number(pl.placement.yPercent); scale = Number(pl.placement.widthPercent);
  } else if (g?.width && g?.height && area) {
    // automatisch einpassen: Breite relativ zur Druckfläche, ohne die Höhe zu überschreiten
    scale = Math.min(1, (area.height * g.width / g.height) / area.width);
  }
  return { id: ctx.link(designId), x: r4(x), y: r4(y), scale: r4(scale), angle: 0 };
}
const r4 = (v) => Math.round(Number(v) * 10000) / 10000;

/** Entwurf bei Printify anlegen/aktualisieren (nicht im Shop sichtbar) und echte Mockups liefern. */
export async function mockups(request, { remote, onRemote }) {
  const id = await upsertDraft(request, remote, onRemote);
  const p = await call('GET', `/shops/${request.shopId}/products/${id}.json`);
  return { remoteId: id, images: (p.images || []).map((i) => ({ url: i.src, position: i.position, isDefault: i.is_default })) };
}

async function upsertDraft(request, remote, onRemote) {
  if (remote?.id && remote.shopId === request.shopId) {
    await call('PUT', `/shops/${request.shopId}/products/${remote.id}.json`, request.product);
    return remote.id;
  }
  const created = await call('POST', `/shops/${request.shopId}/products.json`, request.product);
  if (!created?.id) throw new UserError('Printify hat keine Produkt-ID zurückgegeben.', { code: 'needs_check' });
  await onRemote?.({ id: created.id, shopId: request.shopId });
  return created.id;
}

export async function publish(request, { remote, onRemote, log }) {
  const id = await upsertDraft(request, remote, onRemote);
  log?.(`Printify-Entwurf ${id} bereit, Veröffentlichung wird angefordert …`);
  await call('POST', `/shops/${request.shopId}/products/${id}/publish.json`, { title: true, description: true, images: true, variants: true, tags: true, keyFeatures: true, shipping_template: true });
  // Printify veröffentlicht im Hintergrund; Bestätigung = Shopify-ID im Produkt („external“).
  const deadline = Date.now() + (isSimulation() ? 2000 : 120_000);
  let p;
  while (Date.now() < deadline) {
    p = await call('GET', `/shops/${request.shopId}/products/${id}.json`);
    if (p.external?.id || p.external?.handle) break;
    await new Promise((r) => setTimeout(r, isSimulation() ? 100 : 5000));
  }
  const confirmed = Boolean(p?.external?.id || p?.external?.handle);
  return {
    confirmed, pending: !confirmed, simulated: isSimulation(), remoteId: id, shops: [request.shopId],
    listingImages: (p?.images || []).map((i) => i.src),
    links: [
      { label: 'Produkt in Printify', url: `https://printify.com/app/editor/${id}` },
      ...(p?.external?.handle ? [{ label: 'Im Shop ansehen', url: p.external.handle }] : []),
    ],
    shopifyTitle: request.product.title,
    message: confirmed ? 'Printify hat die Veröffentlichung im Shop bestätigt.' : 'Printify hat die Veröffentlichung angenommen, die Bestätigung von Shopify steht noch aus.',
  };
}

export async function reconcile(draft) {
  const remote = draft.publish?.remote || draft.remote;
  if (!remote?.id) return { found: false, message: 'Bei Printify wurde noch kein Entwurf angelegt.' };
  const p = await call('GET', `/shops/${remote.shopId}/products/${remote.id}.json`);
  if (p.external?.id || p.external?.handle) return { found: true, links: p.external.handle ? [{ label: 'Im Shop ansehen', url: p.external.handle }] : [] };
  return { found: false, existsAsDraft: true, message: 'Das Produkt existiert bei Printify, ist aber (noch) nicht im Shop veröffentlicht.' };
}
