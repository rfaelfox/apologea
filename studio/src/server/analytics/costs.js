import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from '../paths.js';
import { store, getSettings, writeAtomic } from '../store.js';
import { UserError, errorMessage, nowIso } from '../util.js';
import { getSecret } from '../secrets.js';
import { providerSettings } from '../providers/base.js';
import * as shopify from '../integrations/shopify.js';

/**
 * Kosten für die Gewinnrechnung – jede Zahl mit Herkunft:
 *   „laut Anbieter“   tatsächliche Bestellkosten von Printful / Printify / Gelato (je Shopify-Bestellung)
 *   „manuell“         Herstellkosten je Stück, die du für ein Produkt einträgst
 *   „Katalogpreis“    Grundpreis der Variante laut MarketPrint/Printful (Schätzung, ohne Aufschläge)
 *   „Schätzung“       Versand je Bestellung bzw. Zahlungsgebühr laut deinen Einstellungen
 *   fehlt             wird ausdrücklich als fehlend ausgewiesen – dann nur vorläufiger Deckungsbeitrag
 */

const CACHE = () => path.join(DIRS.internal, 'analytics-pod-costs.json');
function readCache() { try { return JSON.parse(fs.readFileSync(CACHE(), 'utf8')); } catch { return { at: null, orders: {}, errors: {} }; } }

const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/** Fremdwährung → Shop-Währung über manuell hinterlegten Kurs; ohne Kurs: nicht verrechnen. */
function toShop(amount, currency, shopCurrency) {
  if (amount === null) return null;
  if (!currency || currency === shopCurrency) return amount;
  const rate = num(getSettings().analytics.fx?.[currency]);
  return rate ? amount * rate : null;
}

// ------------------------------------------------------------------ Anbieter-Bestellkosten

async function printifyOrders() {
  const s = providerSettings('printify');
  if (s.mode !== 'api') return { orders: [], skipped: 'Printify nicht verbunden' };
  const { api } = await import('../providers/printify.js');
  const out = [];
  for (const shopId of s.allowedShops || []) {
    for (let page = 1; page <= 20; page++) {
      const r = await api('GET', `/shops/${encodeURIComponent(shopId)}/orders.json?limit=50&page=${page}`);
      for (const o of r?.data || []) {
        const ref = o.metadata?.shop_order_id ? String(o.metadata.shop_order_id) : null;
        if (!ref) continue;
        const production = (o.line_items || []).reduce((sum, li) => sum + (num(li.cost) || 0), 0) / 100;
        out.push({ provider: 'Printify', ref, currency: 'USD', production, shipping: (num(o.total_shipping) || 0) / 100, total: (num(o.total_price) || 0) / 100 + (num(o.total_shipping) || 0) / 100, status: o.status });
      }
      if (!r?.next_page_url && (r?.data || []).length < 50) break;
    }
  }
  return { orders: out };
}

async function printfulOrders() {
  const s = providerSettings('printful');
  if (s.mode !== 'api') return { orders: [], skipped: 'Printful nicht verbunden' };
  const { api } = await import('../providers/printful.js');
  const out = [];
  for (const storeId of s.allowedShops || []) {
    for (let offset = 0; offset < 2000; offset += 100) {
      const list = await api('GET', `/orders?limit=100&offset=${offset}`, null, { storeId });
      for (const o of Array.isArray(list) ? list : []) {
        if (!o.external_id) continue;
        out.push({ provider: 'Printful', ref: String(o.external_id), currency: o.costs?.currency || 'EUR', production: num(o.costs?.subtotal), shipping: num(o.costs?.shipping), total: num(o.costs?.total), status: o.status });
      }
      if (!Array.isArray(list) || list.length < 100) break;
    }
  }
  return { orders: out };
}

/** Gelato Order API v4 (nur Kostendaten). Feldnamen laut Gelato-Doku; bei Einrichtung mit echter Antwort prüfen. */
async function gelatoOrders() {
  if (getSettings().gelato?.mode !== 'api') return { orders: [], skipped: 'Gelato nicht verbunden' };
  const key = await getSecret('gelato.apiKey');
  if (!key) return { orders: [], skipped: 'Gelato-API-Schlüssel fehlt' };
  const base = (process.env.APOLOGEA_TEST === '1' && process.env.APOLOGEA_GELATO_URL) || 'https://order.gelatoapis.com';
  const out = [];
  for (let offset = 0; offset < 2000; offset += 100) {
    const res = await fetch(`${base}/v4/orders:search`, { method: 'POST', headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 100, offset }), signal: AbortSignal.timeout(30_000) });
    if (res.status === 401 || res.status === 403) throw new UserError('Gelato lehnt den API-Schlüssel ab.', { status: 502 });
    if (!res.ok) throw new UserError(`Gelato meldet ${res.status}.`, { status: 502 });
    const json = await res.json();
    const list = json.orders || json.data || [];
    for (const o of list) {
      const ref = o.orderReferenceId || o.storeOrderId || null;
      if (!ref) continue;
      const items = num(o.itemsPrice ?? o.productsPrice ?? o.totalProductPrice);
      const ship = num(o.shippingPrice ?? o.shipment?.price);
      const total = num(o.totalPrice ?? o.price) ?? (items !== null || ship !== null ? (items || 0) + (ship || 0) : null);
      out.push({ provider: 'Gelato', ref: String(ref).replace(/\D/g, '') || String(ref), currency: o.currency || 'EUR', production: items ?? total, shipping: ship, total, status: o.fulfillmentStatus || o.status });
    }
    if (list.length < 100) break;
  }
  return { orders: out };
}

/** Anbieter-Bestellkosten laden (höchstens alle 30 Minuten, außer refresh). */
export async function podOrderCosts({ refresh = false } = {}) {
  const c = readCache();
  if (!refresh && c.at && Date.now() - Date.parse(c.at) < 30 * 60_000) return c;
  const next = { at: nowIso(), orders: {}, errors: {}, sources: {} };
  for (const [name, fn] of [['Printify', printifyOrders], ['Printful', printfulOrders], ['Gelato', gelatoOrders]]) {
    try {
      const r = await fn();
      next.sources[name] = r.skipped ? { connected: false, note: r.skipped } : { connected: true, count: r.orders.length };
      for (const o of r.orders) next.orders[o.ref] = o;
    } catch (err) {
      next.errors[name] = errorMessage(err);
      next.sources[name] = { connected: true, error: errorMessage(err) };
      for (const [ref, o] of Object.entries(c.orders || {})) if (o.provider === name) next.orders[ref] = o; // letzten Stand behalten
    }
  }
  await writeAtomic(CACHE(), JSON.stringify(next));
  return next;
}

// ------------------------------------------------------------------ Produktkosten (manuell / Katalog)

/** Studio-Produktentwürfe nach Shopify-Produkt-ID bzw. Titel (für Anbieter und Katalogpreise). */
export function studioProductIndex() {
  const byShopifyId = new Map();
  const byTitle = new Map();
  for (const p of store().products.list((x) => x.publish?.state === 'done' || x.publish?.result)) {
    const sid = p.publish?.result?.shopifyProductId;
    if (sid) byShopifyId.set(sid, p);
    if (p.publicTitle) byTitle.set(p.publicTitle.trim().toLowerCase(), p);
  }
  return { byShopifyId, byTitle, find(productId, title) { return byShopifyId.get(productId) || byTitle.get(String(title || '').trim().toLowerCase()) || null; } };
}

/** Katalog-Grundpreis einer Variante aus dem zwischengespeicherten Anbieter-Katalog (Schätzung). */
function catalogueUnitCost(draft, variantTitle) {
  if (!draft?.baseProduct?.id) return null;
  // Nur MarketPrint liefert Grundpreise je Variante im zwischengespeicherten Katalog (Printify erst beim Anlegen).
  if ((draft.provider || 'marketprint') !== 'marketprint') return null;
  const file = path.join(DIRS.cache, `marketprint-details-${getSettings().marketprint.mode}-${draft.baseProduct.id}.json`.replace(/[^\w.-]/g, '_'));
  let details = null;
  try { details = JSON.parse(fs.readFileSync(file, 'utf8')).data; } catch { return null; }
  const vars = (details?.variants || []).filter((v) => (draft.variantIds || []).includes(v.id) && v.price !== null && v.price !== undefined);
  if (!vars.length) return null;
  // Variante anhand von Farbe/Größe im Shopify-Variantentitel finden, sonst Durchschnitt
  const t = String(variantTitle || '').toLowerCase();
  const exact = vars.find((v) => t.includes(String(v.size).toLowerCase()) && t.includes(String(v.color).toLowerCase()));
  return exact ? Number(exact.price) : vars.reduce((s, v) => s + Number(v.price), 0) / vars.length;
}

/** Herstellkosten je Stück für eine Bestellposition: { unit, source, provider } oder { unit: null, missing } */
export function unitCostFor(line, index) {
  const manual = num(getSettings().analytics.productCosts?.[line.productId]?.unit);
  const draft = index.find(line.productId, line.title);
  const provider = draft ? ({ marketprint: 'MarketPrint', printify: 'Printify', printful: 'Printful' }[draft.provider] || draft.provider) : (line.vendor || null);
  if (manual !== null) return { unit: manual, source: 'manuell', provider };
  const cat = draft ? catalogueUnitCost(draft, line.variantTitle) : null;
  if (cat !== null) return { unit: cat, source: 'Katalogpreis (Schätzung, ohne Aufschläge für Rückendruck/DTF/Nacken)', provider };
  return { unit: null, source: null, provider, missing: true };
}

/**
 * Kosten einer Bestellung. Anbieterdaten haben Vorrang (tatsächlich berechnet), sonst Stückkosten × Menge.
 * Rückgabe: { production, shipping, fees, sources: [...], missing: [...] }
 */
export function orderCosts(order, { pod, index, shopCurrency }) {
  const a = getSettings().analytics;
  const ref = order.shopifyId ? shopify.gid.num(order.shopifyId) : order.id.replace(/^o_/, '');
  const missing = [];
  const sources = [];
  let production = null;
  let shipping = null;
  const p = pod?.orders?.[ref] || pod?.orders?.[order.name?.replace('#', '')] || null;
  if (p) {
    production = toShop(p.production, p.currency, shopCurrency);
    shipping = toShop(p.shipping, p.currency, shopCurrency);
    if (production === null) missing.push(`Wechselkurs ${p.currency} → ${shopCurrency} (Einstellungen → Analytics)`);
    else sources.push(`${p.provider} (laut Anbieter)`);
  }
  if (production === null) {
    let sum = 0;
    let complete = true;
    for (const l of order.lines) {
      const c = unitCostFor(l, index);
      if (c.unit === null) { complete = false; missing.push(`Herstellkosten „${l.title}“`); continue; }
      sum += c.unit * l.quantity;
      if (!sources.includes(c.source)) sources.push(c.source);
    }
    production = complete ? sum : (sum || null);
    if (!complete && sum) sources.push('teilweise');
  }
  if (shipping === null) {
    const est = num(a.podShippingPerOrder);
    if (est !== null) { shipping = est; sources.push('Versand: Schätzung laut Einstellungen'); } else missing.push('Versandkosten des Druckdienstleisters');
  }
  let fees = null;
  const pct = num(a.fees?.percent);
  const fix = num(a.fees?.fixed);
  if (pct !== null || fix !== null) { fees = order.total * (pct || 0) / 100 + (fix || 0); sources.push('Zahlungsgebühr: Schätzung laut Einstellungen'); } else missing.push('Zahlungsgebühren');
  return { production, shipping, fees, sources, missing: [...new Set(missing)], provider: p?.provider || null };
}

/** Manuell erfasste Kosten (Werbung, Sonstiges) im Zeitraum. */
export function manualCosts(period) {
  const list = store().costs.list((c) => c.date >= period.from && c.date <= period.to);
  const sum = (cat) => list.filter((c) => c.category === cat).reduce((s, c) => s + Number(c.amount || 0), 0);
  return { ads: sum('werbung'), other: sum('sonstiges'), entries: list };
}

export function saveCost(entry) {
  const amount = num(entry.amount);
  if (amount === null || amount < 0) throw new UserError('Bitte einen gültigen Betrag eingeben.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date || '')) throw new UserError('Bitte ein Datum angeben.');
  if (!['werbung', 'sonstiges'].includes(entry.category)) throw new UserError('Ungültige Kostenart.');
  return store().costs.put({ id: entry.id || undefined, date: entry.date, amount, category: entry.category, note: String(entry.note || '').slice(0, 200) });
}
