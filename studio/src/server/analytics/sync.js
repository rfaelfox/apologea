import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from '../paths.js';
import { store, getSettings, writeAtomic } from '../store.js';
import { UserError, errorMessage, nowIso, sleep } from '../util.js';
import * as shopify from '../integrations/shopify.js';
import { notify } from './notify.js';

/**
 * Bestell-Synchronisierung (Shopify GraphQL Admin API, Berechtigung read_orders).
 *
 * - Erster Lauf: alle Bestellungen, die die App lesen darf (ohne read_all_orders: die letzten 60 Tage).
 * - Danach nur geänderte Bestellungen (updated_at), seitenweise, mit Pause gegen Rate-Limits.
 * - Jede Bestellung wird unter ihrer Shopify-ID gespeichert → keine Doppelungen, Änderungen (Erstattung,
 *   Stornierung) überschreiben den alten Stand.
 * - Datenminimierung: keine Namen, E-Mails, Adressen. Kunden nur als gesalzener Pseudonym-Hash
 *   (für „neu/wiederkehrend“), Land nur aus Shopify-Berichten (ShopifyQL), nicht aus Adressen.
 */

const META_FILE = () => path.join(DIRS.internal, 'analytics-meta.json');

export function meta() {
  try { return JSON.parse(fs.readFileSync(META_FILE(), 'utf8')); } catch { return {}; }
}
async function saveMeta(patch) {
  const next = { ...meta(), ...patch };
  await writeAtomic(META_FILE(), JSON.stringify(next, null, 1));
  return next;
}

function salt() {
  const m = meta();
  if (m.salt) return m.salt;
  const s = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(DIRS.internal, { recursive: true });
  fs.writeFileSync(META_FILE(), JSON.stringify({ ...m, salt: s }, null, 1));
  return s;
}

const money = (set) => Number(set?.shopMoney?.amount || 0);
const iso = (v) => (v ? new Date(v).toISOString() : null);

const ORDER_FIELDS = `id name createdAt processedAt updatedAt cancelledAt test taxesIncluded displayFinancialStatus displayFulfillmentStatus currencyCode sourceName
  customer { id }
  subtotalPriceSet { shopMoney { amount currencyCode } }
  totalDiscountsSet { shopMoney { amount } }
  totalShippingPriceSet { shopMoney { amount } }
  totalTaxSet { shopMoney { amount } }
  totalPriceSet { shopMoney { amount } }
  totalRefundedSet { shopMoney { amount } }
  lineItems(first: 100) { nodes { id title quantity sku vendor product { id } variant { id title }
    originalTotalSet { shopMoney { amount } } discountedTotalSet { shopMoney { amount } }
    taxLines { priceSet { shopMoney { amount } } } } }
  refunds(first: 30) { id createdAt totalRefundedSet { shopMoney { amount } }
    refundLineItems(first: 100) { nodes { quantity subtotalSet { shopMoney { amount } } totalTaxSet { shopMoney { amount } } lineItem { id } } } }`;

/** Shopify-Bestellung → gespeicherte, minimierte Form (alle Beträge in Shop-Währung). */
export function normalizeOrder(o, saltValue) {
  const currency = o.subtotalPriceSet?.shopMoney?.currencyCode || o.currencyCode;
  const lines = (o.lineItems?.nodes || []).map((l) => {
    const tax = (l.taxLines || []).reduce((s, t) => s + money(t.priceSet), 0);
    const original = money(l.originalTotalSet);
    const discounted = money(l.discountedTotalSet);
    // Bei Preisen inkl. MwSt. die Steuer herausrechnen (wie in Shopify-Berichten). Die Steuer der Position bezieht sich
    // auf den rabattierten Betrag → Steuersatz daraus ableiten und auf den Originalpreis anwenden.
    const rate = o.taxesIncluded && discounted - tax > 0 ? tax / (discounted - tax) : 0;
    const gross = o.taxesIncluded ? original / (1 + rate) : original;
    const net = o.taxesIncluded ? discounted - tax : discounted;
    return {
      id: l.id, productId: l.product?.id || null, variantId: l.variant?.id || null, title: l.title, variantTitle: l.variant?.title || '', sku: l.sku || '', vendor: l.vendor || '',
      quantity: l.quantity,
      gross: Math.round(gross * 100) / 100,
      discounted: Math.round(net * 100) / 100,
      tax,
    };
  });
  const refunds = (o.refunds || []).map((r) => {
    const items = (r.refundLineItems?.nodes || []).map((x) => ({ lineItemId: x.lineItem?.id, quantity: x.quantity, subtotal: money(x.subtotalSet), tax: money(x.totalTaxSet) }));
    return {
      id: r.id, createdAt: iso(r.createdAt), total: money(r.totalRefundedSet),
      // Warenrücksendungen ohne Steuer (für Nettoumsatz); Rest = Versand/Sonstiges
      products: items.reduce((s, x) => s + (o.taxesIncluded ? x.subtotal - x.tax : x.subtotal), 0),
      items,
    };
  });
  const customerKey = o.customer?.id ? crypto.createHash('sha256').update(saltValue + o.customer.id).digest('hex').slice(0, 20) : null;
  return {
    id: 'o_' + shopify.gid.num(o.id),
    shopifyId: o.id, name: o.name,
    createdAt: iso(o.createdAt), processedAt: iso(o.processedAt || o.createdAt), shopifyUpdatedAt: iso(o.updatedAt), cancelledAt: iso(o.cancelledAt),
    test: Boolean(o.test), taxesIncluded: Boolean(o.taxesIncluded),
    financialStatus: o.displayFinancialStatus, fulfillmentStatus: o.displayFulfillmentStatus, source: o.sourceName || '',
    currency,
    subtotal: money(o.subtotalPriceSet),
    // Rabatte ohne Steuer aus den Positionen (Bestell-Rabatte inkl. MwSt. stehen in discountsGross)
    discounts: Math.round(lines.reduce((s, l) => s + (l.gross - l.discounted), 0) * 100) / 100, discountsGross: money(o.totalDiscountsSet), shipping: money(o.totalShippingPriceSet), tax: money(o.totalTaxSet),
    total: money(o.totalPriceSet), refunded: money(o.totalRefundedSet),
    lines, refunds, customerKey,
  };
}

let running = null;

/** Synchronisiert Bestellungen. full = alles neu laden. Liefert { added, updated, total }. */
export function syncOrders({ full = false, reason = 'manuell' } = {}) {
  if (running) return running;
  running = doSync({ full, reason }).finally(() => { running = null; });
  return running;
}

async function doSync({ full, reason }) {
  if (!shopify.connectionKinds().adminApp) throw new UserError('Für Analytics wird die Shopify-Admin-App mit den Berechtigungen read_orders und read_reports benötigt (Einstellungen → Shopify → B).', { status: 412, code: 'missing_admin' });
  const m = meta();
  const startedAt = nowIso();
  const s = salt();
  // Puffer von 10 Minuten, damit nichts zwischen zwei Läufen verloren geht (Doppelungen sind durch die ID ausgeschlossen)
  const since = !full && m.lastSyncAt ? new Date(Date.parse(m.lastSyncAt) - 10 * 60_000).toISOString() : null;
  const q = since ? `updated_at:>='${since}'` : null;
  const known = new Map(store().orders.list().map((o) => [o.id, o]));
  let after = null;
  let added = 0; let updated = 0; let pages = 0;
  const fresh = [];
  try {
    do {
      const data = await shopify.gql(`query($after: String, $q: String) { orders(first: 50, after: $after, query: $q, sortKey: UPDATED_AT) { pageInfo { hasNextPage endCursor } nodes { ${ORDER_FIELDS} } } }`, { after, q });
      const conn = data.orders;
      const batch = conn.nodes.map((o) => normalizeOrder(o, s));
      for (const o of batch) {
        const prev = known.get(o.id);
        if (!prev) { added++; fresh.push({ order: o, prev: null }); } else if (prev.shopifyUpdatedAt !== o.shopifyUpdatedAt) { updated++; fresh.push({ order: o, prev }); }
      }
      store().orders.putMany(batch);
      after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
      pages++;
      if (after) await sleep(300); // schonend gegenüber dem Rate-Limit
    } while (after && pages < 400);
    const firstRun = !m.lastSyncAt;
    await saveMeta({ lastSyncAt: startedAt, lastSyncOk: true, lastError: null, lastReason: reason, orderCount: store().orders.list().length });
    if (!firstRun) for (const f of fresh) notify.orderChanged(f.order, f.prev);
    if (!firstRun) notify.checkGoals();
    return { added, updated, total: store().orders.list().length, firstRun };
  } catch (err) {
    await saveMeta({ lastSyncOk: false, lastError: errorMessage(err), lastErrorAt: nowIso() });
    notify.syncFailed(errorMessage(err));
    throw err;
  }
}

/** Shop-Stammdaten (Zeitzone, Währung) – zwischengespeichert. */
export async function shopInfo({ refresh = false } = {}) {
  const m = meta();
  if (!refresh && m.shop && Date.now() - Date.parse(m.shop.at) < 24 * 3600_000) return m.shop;
  try {
    const d = await shopify.gql('{ shop { name ianaTimezone currencyCode } }');
    const info = { name: d.shop.name, tz: d.shop.ianaTimezone || 'Europe/Berlin', currency: d.shop.currencyCode || 'EUR', at: nowIso() };
    await saveMeta({ shop: info });
    return info;
  } catch (err) {
    if (m.shop) return m.shop;
    return { name: getSettings().shop.domain, tz: 'Europe/Berlin', currency: 'EUR', at: null, fallback: true, error: errorMessage(err) };
  }
}

/** Produktdaten (Titel, Bild, Anbieter) für Produkte aus Bestellungen. */
export async function productInfo(ids, { refresh = false } = {}) {
  const m = meta();
  const cache = m.products || {};
  const missing = ids.filter((id) => id && (refresh || !cache[id]));
  for (let i = 0; i < missing.length; i += 50) {
    try {
      const d = await shopify.gql('query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id title handle vendor productType status featuredMedia { preview { image { url } } } priceRangeV2 { minVariantPrice { amount } maxVariantPrice { amount } } onlineStoreUrl } } }', { ids: missing.slice(i, i + 50) });
      for (const n of d.nodes || []) {
        if (!n?.id) continue;
        cache[n.id] = { id: n.id, title: n.title, handle: n.handle, vendor: n.vendor, type: n.productType, status: n.status, image: n.featuredMedia?.preview?.image?.url || null, price: Number(n.priceRangeV2?.minVariantPrice?.amount || 0), priceMax: Number(n.priceRangeV2?.maxVariantPrice?.amount || 0), url: n.onlineStoreUrl, at: nowIso() };
      }
    } catch { break; } // Produktdaten sind eine Ergänzung – Analytics funktioniert auch ohne
  }
  await saveMeta({ products: cache });
  return cache;
}

/** Erteilte Berechtigungen prüfen und erklären. */
export async function permissions() {
  const kinds = shopify.connectionKinds();
  if (!kinds.adminApp) return { adminApp: false, scopes: [], missing: ['read_orders', 'read_reports', 'read_products'] };
  const scopes = (await shopify.adminScopes()) || [];
  const need = ['read_orders', 'read_reports', 'read_products'];
  return {
    adminApp: true, scopes,
    missing: need.filter((n) => !scopes.includes(n) && !scopes.includes(n.replace('read_', 'write_'))),
    allOrders: scopes.includes('read_all_orders'),
    payments: scopes.some((x) => /shopify_payments/.test(x)),
  };
}
