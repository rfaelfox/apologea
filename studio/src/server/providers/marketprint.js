import * as mp from '../integrations/marketprint.js';
import { getSettings } from '../store.js';
import * as shopify from '../integrations/shopify.js';

/** Anbieter-Baustein MarketPrint (über den offiziellen MarketPrint-MCP-Server). */
export const meta = {
  id: 'marketprint',
  name: 'MarketPrint',
  website: 'https://www.marketprint.de',
  modes: [
    { id: 'claude-code', label: 'Über Claude Code (empfohlen)', desc: 'Nutzt den MarketPrint-Connector deines Claude-Kontos über die lokal installierte, angemeldete Claude-Code-Kommandozeile. Zählt zu deinem Claude-Kontingent.' },
    { id: 'mcp', label: 'Direkte Verbindung (MCP, Anmeldung über MarketPrint)', desc: 'Nur möglich, wenn MarketPrint externe Programme zulässt. Adresse aus der MarketPrint-Hilfe.' },
    { id: 'simulation', label: 'Simulation (Test ohne echte Aktionen)', desc: 'Echte Katalogdaten aus einer Momentaufnahme. Es wird nichts angelegt.' },
    { id: 'none', label: 'Nicht verbunden' },
  ],
  secrets: [],
  capabilities: {
    alternativeDesign: true,
    neckPrint: true,
    namedPlacements: [
      { v: 'small-left-chest', l: 'Klein, linke Brust' },
      { v: 'small-center-chest', l: 'Klein, Brustmitte' },
      { v: 'small-right-chest', l: 'Klein, rechte Brust' },
    ],
    mockupChoice: true,
    twoStep: false,
    realMockups: false,
    directUpload: { maxBytesViaClaudeCode: 100_000 },
    catalogOptions: false,
    tags: false,
  },
  linkHelp: 'Datei in der MarketPrint-App unter „Meine Designs“ hochladen und hier suchen und verknüpfen. Das ist bei großen Druckdateien der zuverlässigste Weg.',
  publishEffect: (targets) => `Legt bei MarketPrint ein neues Produkt an und veröffentlicht es SOFORT öffentlich in: ${targets.join(', ')}.`,
};

export const isSimulation = () => mp.isSimulation();
export const testConnection = () => mp.testConnection();

export async function account({ refresh } = {}) {
  const a = await mp.accountInfo({ refresh });
  return { label: a.email || 'MarketPrint-Konto', email: a.email, cachedAt: a.cachedAt, simulated: a.simulated, targets: (a.shopDomains || []).map((d) => ({ id: d, label: d, channel: 'shopify', canPublish: true })) };
}

export async function catalog({ refresh } = {}) {
  const r = await mp.baseProducts({ refresh });
  return { ...r, items: r.items.map((c) => ({ id: c.id, title: c.title, image: c.image, hasNeckPrint: c.hasNeckPrint, hasAlternativeDesign: c.hasAlternativeDesign })) };
}

export async function catalogOptions() { return []; }

export async function details(id, { refresh } = {}) {
  const d = await mp.baseProductDetails(id, { refresh });
  return { ...d, descriptionSource: 'MarketPrint', priceLabel: 'Katalogpreis laut MarketPrint' };
}

export async function listImages({ search } = {}) {
  const r = await mp.myImages({ search });
  const imgs = r.images || r.items || [];
  return { images: imgs.map((im) => ({ imageId: im.imageId || im.id, name: im.fileName || im.name, preview: im.previewUrl || im.preview || im.url })), simulated: r.simulated };
}

export async function uploadImage({ filename, buffer }) {
  const r = await mp.uploadImageBase64(filename, buffer);
  return { imageId: r.imageId || r.id };
}

/** Nackendruck hochladen → Kennung für das Produkt. */
export async function uploadNeckPrint({ light, dark }) {
  const r = await mp.uploadNeckprint({ light, dark });
  const neckPrintId = r.neckPrintId || r.neckprintId || r.id;
  if (!neckPrintId) throw new Error('MarketPrint hat keine Nackendruck-Kennung zurückgegeben.');
  return { neckPrintId: String(neckPrintId), simulated: Boolean(r.simulated) };
}

export function canDirectUpload(bytes) {
  const mode = getSettings().marketprint.mode;
  return mode === 'mcp' || mode === 'simulation' || bytes < 100_000;
}

/** Genau die Argumente für MarketPrint create_shop_product. */
export function buildRequest(draft, { link }) {
  const images = [];
  for (const pl of draft.placements || []) {
    if (!pl.designId) continue;
    const entry = { imageId: link(pl.designId), printArea: pl.printArea };
    if (pl.placement?.mode === 'named' && pl.placement.named) entry.placement = pl.placement.named;
    if (pl.placement?.mode === 'custom') entry.placement = { xPercent: r4(pl.placement.xPercent), yPercent: r4(pl.placement.yPercent), widthPercent: r4(pl.placement.widthPercent) };
    images.push(entry);
    if (pl.alternative?.designId) images.push({ imageId: link(pl.alternative.designId), printArea: pl.printArea, alternativeColors: [...pl.alternative.colors] });
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
  if (draft.neckPrint?.lightDesignId && draft.neckPrint.neckPrintId) args.neckPrintId = draft.neckPrint.neckPrintId;
  return args;
}

const r4 = (v) => Math.round(Number(v) * 10000) / 10000;

export async function publish(request) {
  const r = await mp.createShopProduct(request);
  const shops = r.publishedTo || r.shops || r.addedToShops || r.shopDomains || [];
  return {
    confirmed: true,
    simulated: Boolean(r.simulated),
    remoteId: r.draftId || r.id || r.productId || null,
    shops: Array.isArray(shops) ? shops.map((s) => (typeof s === 'string' ? s : s.domain || s.shop || JSON.stringify(s))) : [],
    listingImages: r.listingImages || r.images || r.mockups || [],
    links: (request.addToShops || []).map((shop) => ({ label: `Shopify-Admin (${shop}): Produkte`, url: `https://${shop}/admin/products?query=${encodeURIComponent(request.title)}` })),
    shopifyTitle: request.title,
    raw: r,
  };
}

/** MarketPrint liefert keine Abfrage einzelner Produkte – Prüfung erfolgt über Shopify (falls verbunden). */
export async function reconcile() { return null; }

export { shopify };
