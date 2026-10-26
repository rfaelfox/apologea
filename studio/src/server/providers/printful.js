import { UserError } from '../util.js';
import { cached, providerSettings, restCall, testBaseUrl } from './base.js';
import { printfulSim } from '../../../fixtures/printful/sim.js';

/**
 * Anbieter-Baustein Printful (offizielle REST-API v1, privater Zugangsschlüssel).
 *
 * WICHTIG (Printful-Dokumentation): Die Products-API legt Produkte NUR in Printful-Shops vom Typ
 * „Manual order / API“ an. Für mit Shopify verbundene Printful-Shops ist das Anlegen über die API nicht
 * vorgesehen. Für diese Shops bietet das Studio Katalog, Druckflächen, Dateiprüfung und echte Mockups;
 * das Produkt wird dann in der Printful-Oberfläche angelegt (Link wird angeboten).
 */
const BASE = () => testBaseUrl('APOLOGEA_PRINTFUL_URL') || 'https://api.printful.com';

export const meta = {
  id: 'printful',
  name: 'Printful',
  website: 'https://www.printful.com',
  modes: [
    { id: 'api', label: 'Printful-API (privater Zugangsschlüssel)', desc: 'developers.printful.com → „Private token“ erstellen (Konto-Token mit Zugriff auf Shops, Produkte, Dateien, Mockups).' },
    { id: 'simulation', label: 'Simulation (Beispieldaten, nichts wird angelegt)', desc: 'Erfundene Beispieldaten nur zum Ausprobieren des Ablaufs.' },
    { id: 'none', label: 'Nicht verbunden' },
  ],
  secrets: [{ name: 'printful.token', label: 'Printful Private Token', placeholder: 'Token', hint: 'Wird verschlüsselt gespeichert.' }],
  capabilities: {
    alternativeDesign: true, // je Variante eigene Druckdatei
    neckPrint: false,
    namedPlacements: [],
    mockupChoice: false,
    twoStep: false,
    realMockups: true,
    directUpload: null, // Printful nimmt Dateien nur per öffentlicher URL an
    catalogOptions: false,
    tags: false,
  },
  linkHelp: 'Printful übernimmt Dateien nur über eine öffentliche Adresse. Lade die Druckdatei in Printful unter „Datei-Bibliothek“ hoch und trage hier die Datei-ID ein (das Studio prüft sie).',
  publishEffect: (targets) => `Legt das Produkt im Printful-Shop ${targets.join(', ')} an (nur „Manual order / API“-Shops).`,
};

const sim = () => (providerSettings('printful').mode === 'simulation' ? printfulSim : null);
export const isSimulation = () => providerSettings('printful').mode === 'simulation';

function call(method, path, body, { storeId, ...opts } = {}) {
  if (providerSettings('printful').mode === 'none') throw new UserError('Printful ist nicht verbunden (Einstellungen → Anbieter).', { status: 412, code: 'mp_not_setup' });
  return restCall({ provider: 'Printful', baseUrl: BASE(), method, path, body, tokenSecret: 'printful.token', sim: sim(), headers: storeId ? { 'X-PF-Store-Id': String(storeId) } : {}, ...opts }).then((r) => r?.result ?? r);
}

const API_STORE = (type) => /native|api|manual/i.test(String(type || ''));

export async function account({ refresh } = {}) {
  const r = await cached('printful', `stores-${providerSettings('printful').mode}`, 6 * 3600_000, refresh, () => call('GET', '/stores'));
  return {
    label: 'Printful-Konto', cachedAt: r.cachedAt, simulated: isSimulation(),
    targets: (r.data || []).map((s) => ({
      id: String(s.id), label: `${s.name} (${s.type})`, channel: s.type, canPublish: API_STORE(s.type),
      note: API_STORE(s.type) ? null : 'Mit einer Plattform verbundener Shop: Anlegen über die Printful-API laut Printful nicht möglich – Vorbereitung und Mockups ja.',
    })),
  };
}

export async function testConnection() {
  const a = await account({ refresh: true });
  return { ok: true, mode: providerSettings('printful').mode, account: a, message: a.simulated ? 'Simulation aktiv – es wird nichts bei Printful angelegt.' : `Printful verbunden: ${a.targets.length} Shop(s).` };
}

export async function catalog({ refresh } = {}) {
  const r = await cached('printful', `catalog-${providerSettings('printful').mode}`, 24 * 3600_000, refresh, () => call('GET', '/products'));
  return { cachedAt: r.cachedAt, stale: r.stale, error: r.error, items: (r.data || []).map((p) => ({ id: String(p.id), title: p.title || p.model || p.type_name, image: p.image, brand: p.brand })) };
}

export async function catalogOptions() { return []; }

export async function details(id, { refresh } = {}) {
  const mode = providerSettings('printful').mode;
  const prod = (await cached('printful', `prod-${mode}-${id}`, 12 * 3600_000, refresh, () => call('GET', `/products/${encodeURIComponent(id)}`))).data;
  const pf = (await cached('printful', `pf-${mode}-${id}`, 24 * 3600_000, refresh, () => call('GET', `/mockup-generator/printfiles/${encodeURIComponent(id)}`))).data;
  const files = new Map((pf.printfiles || []).map((f) => [f.printfile_id, f]));
  const firstVariant = (pf.variant_printfiles || [])[0];
  const printAreas = Object.entries(firstVariant?.placements || {}).map(([placement, fid]) => {
    const f = files.get(fid) || {};
    return { name: placement, label: pf.available_placements?.[placement] || placement, width: f.width, height: f.height, dpi: f.dpi };
  });
  return {
    id: String(id), title: prod.product?.title || prod.product?.model, image: prod.product?.image, description: prod.product?.description || '',
    descriptionSource: 'Printful', priceLabel: 'Grundpreis laut Printful',
    supportedPrinterTypes: [], hasAlternativeDesign: true, hasNeckPrint: false,
    printAreas,
    variants: (prod.variants || []).map((v) => ({ id: String(v.id), size: v.size, color: v.color, colorHex: v.color_code || null, price: v.price != null ? Number(v.price) : null, available: v.in_stock !== false, images: v.image ? [{ image: v.image, printArea: printAreas[0]?.name }] : [] })),
  };
}

export async function listImages() {
  return { images: [], note: 'Printful bietet keine Suche in der Datei-Bibliothek über diese Schnittstelle. Bitte die Datei-ID eintragen.' };
}

export async function verifyImage(fileId) {
  const f = await call('GET', `/files/${encodeURIComponent(fileId)}`);
  return { imageId: String(f.id), name: f.filename, preview: f.preview_url || f.thumbnail_url, url: f.url, width: f.width, height: f.height };
}

export async function uploadImage() {
  throw new UserError('Printful übernimmt Druckdateien nur über eine öffentliche Internetadresse. Bitte die Datei in Printful (Datei-Bibliothek) hochladen und die Datei-ID hier verknüpfen.', { code: 'provider_upload_unsupported' });
}

export const canDirectUpload = () => false;

export function buildRequest(draft, ctx) {
  const d = ctx.details;
  const sync_variants = draft.variantIds.map((vid) => {
    const v = d.variants.find((x) => x.id === vid);
    const files = [];
    for (const pl of draft.placements || []) {
      if (!pl.designId) continue;
      const useAlt = pl.alternative?.designId && v && (pl.alternative.colors || []).includes(v.colorHex || v.color);
      const designId = useAlt ? pl.alternative.designId : pl.designId;
      const area = d.printAreas.find((a) => a.name === pl.printArea);
      const entry = { type: pl.printArea, id: Number(ctx.link(designId)) };
      const g = ctx.designGeometry(designId);
      if (pl.placement?.mode === 'custom' && area?.width && g?.width) {
        const w = Math.round(area.width * pl.placement.widthPercent);
        const hgt = Math.round(w * g.height / g.width);
        entry.position = { area_width: area.width, area_height: area.height, width: w, height: hgt, left: Math.round(area.width * pl.placement.xPercent - w / 2), top: Math.round(area.height * pl.placement.yPercent - hgt / 2) };
      }
      files.push(entry);
    }
    return { variant_id: Number(vid), retail_price: Number(draft.price).toFixed(2), files };
  });
  return { storeId: (draft.targetShops || [])[0], product: { sync_product: { name: draft.publicTitle?.trim() }, sync_variants } };
}

export async function publish(request) {
  const acc = await account();
  const target = acc.targets.find((t) => t.id === String(request.storeId));
  if (!target) throw new UserError('Printful-Shop nicht gefunden.', { code: 'tool_error' });
  if (!target.canPublish) {
    throw new UserError('Printful erlaubt das Anlegen über die Schnittstelle nur in „Manual order / API“-Shops. Für deinen mit Shopify verbundenen Printful-Shop bitte das Produkt in der Printful-Oberfläche anlegen (Mockups und Druckdaten sind vorbereitet). Es wurde nichts ausgeführt.', { code: 'tool_error' });
  }
  const r = await call('POST', '/store/products', request.product, { storeId: request.storeId });
  return {
    confirmed: Boolean(r?.id), simulated: isSimulation(), remoteId: r?.id ? String(r.id) : null, shops: [target.label], listingImages: [],
    links: [{ label: 'Produkte in Printful', url: 'https://www.printful.com/dashboard/default' }],
    message: 'Printful hat das Anlegen bestätigt.',
  };
}

export async function reconcile(draft) {
  const remote = draft.publish?.remote;
  if (!remote?.id) return null;
  try { await call('GET', `/store/products/${remote.id}`, null, { storeId: remote.shopId }); return { found: true, links: [] }; } catch { return { found: false, message: 'Bei Printful nicht gefunden.' }; }
}

/** Echte Mockups über den Printful-Mockup-Generator (schreibt nichts in den Shop). */
export async function mockups(request, { details: d, draft, ctx }) {
  const placements = (draft.placements || []).filter((p) => p.designId);
  const files = [];
  for (const pl of placements) {
    const info = await verifyImage(ctx.link(pl.designId));
    if (!info.url) throw new UserError('Für die Datei liefert Printful keine Adresse – Mockups nicht möglich.');
    files.push({ placement: pl.printArea, image_url: info.url });
  }
  const variantIds = draft.variantIds.slice(0, 6).map(Number);
  const task = await call('POST', `/mockup-generator/create-task/${encodeURIComponent(draft.baseProduct.id)}`, { variant_ids: variantIds, format: 'jpg', files });
  const deadline = Date.now() + (isSimulation() ? 2000 : 120_000);
  while (Date.now() < deadline) {
    const t = await call('GET', `/mockup-generator/task?task_key=${encodeURIComponent(task.task_key)}`);
    if (t.status === 'completed') return { images: (t.mockups || []).map((m) => ({ url: m.mockup_url, position: m.placement })) };
    if (t.status === 'failed') throw new UserError('Printful konnte keine Mockups erzeugen: ' + (t.error || 'unbekannter Fehler'));
    await new Promise((r) => setTimeout(r, isSimulation() ? 100 : 4000));
  }
  throw new UserError('Printful erzeugt die Mockups noch. Bitte später erneut versuchen.');
}

/** Lesender Zugriff für Analytics (Bestellkosten). */
export { call as api };
