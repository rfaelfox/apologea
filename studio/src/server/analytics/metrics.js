import { store, getSettings } from '../store.js';
import { resolvePeriod, bucketKey, bucketsFor, inRange, dayKey } from './time.js';
import { shopInfo, productInfo, meta } from './sync.js';
import * as ql from './shopifyql.js';
import { podOrderCosts, studioProductIndex, orderCosts, manualCosts, unitCostFor } from './costs.js';

/**
 * Kennzahlen – berechnet aus den synchronisierten Shopify-Bestellungen (Umsatz, Bestellungen, Artikel,
 * Rückerstattungen) und aus ShopifyQL (Sitzungen, Besucher, Conversion, Länder).
 *
 * Definitionen (angelehnt an die Shopify-Berichte, Beträge in Shop-Währung):
 *   Bruttoumsatz  = Artikelpreis × Menge, ohne Steuer (bei Preisen inkl. MwSt. herausgerechnet)
 *   Nettoumsatz   = Bruttoumsatz − Rabatte − Rücksendungen (Warenwert der Erstattungen, nach Erstattungsdatum)
 *   Gesamtumsatz  = Nettoumsatz + Versand + Steuern
 *   Ø Bestellwert = (Bruttoumsatz − Rabatte) ÷ Bestellungen
 * Testbestellungen sowie nie bezahlte, verfallene/stornierte Bestellungen (VOIDED/EXPIRED) zählen nicht.
 * Shopify kann durch eigene Zuordnungsregeln leicht abweichen – das wird in der Oberfläche so benannt.
 */

const EXCLUDED_STATUS = new Set(['VOIDED', 'EXPIRED']);
const round = (v) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);
const pct = (cur, prev) => (prev ? (cur - prev) / Math.abs(prev) : cur ? null : 0);

function validOrders() {
  return store().orders.list((o) => !o.test && !EXCLUDED_STATUS.has(String(o.financialStatus || '').toUpperCase()));
}

async function ctx(periodInput) {
  const shop = await shopInfo();
  const period = resolvePeriod(periodInput, shop.tz);
  return { shop, period, orders: validOrders() };
}

/** Kernsummen eines Zeitraums. */
function sums(orders, start, end) {
  const s = { gross: 0, discounts: 0, returns: 0, refunds: 0, shipping: 0, tax: 0, orders: 0, items: 0, returnedItems: 0, cancelled: 0 };
  for (const o of orders) {
    if (inRange(o.processedAt, start, end)) {
      s.orders++;
      if (o.cancelledAt) s.cancelled++;
      s.gross += o.lines.reduce((x, l) => x + l.gross, 0);
      s.items += o.lines.reduce((x, l) => x + l.quantity, 0);
      s.discounts += o.discounts;
      s.shipping += o.shipping;
      s.tax += o.tax;
    }
    for (const r of o.refunds) {
      if (!inRange(r.createdAt, start, end)) continue;
      s.returns += r.products;
      s.refunds += r.total;
      s.returnedItems += r.items.reduce((x, i) => x + i.quantity, 0);
    }
  }
  s.net = s.gross - s.discounts - s.returns;
  s.total = s.net + s.shipping + s.tax;
  s.aov = s.orders ? (s.gross - s.discounts) / s.orders : null;
  s.itemsNet = s.items - s.returnedItems;
  for (const k of Object.keys(s)) s[k] = typeof s[k] === 'number' ? round(s[k]) : s[k];
  return s;
}

function series(orders, period, granularity) {
  const g = granularity || period.granularity;
  const p = { ...period, granularity: g };
  const keys = bucketsFor(p);
  const map = new Map(keys.map((k) => [k, { key: k, total: 0, net: 0, orders: 0, items: 0 }]));
  for (const o of orders) {
    if (inRange(o.processedAt, period.start, period.end)) {
      const b = map.get(bucketKey(o.processedAt, period.tz, g));
      if (!b) continue;
      const gross = o.lines.reduce((x, l) => x + l.gross, 0);
      b.orders++;
      b.items += o.lines.reduce((x, l) => x + l.quantity, 0);
      b.net += gross - o.discounts;
      b.total += gross - o.discounts + o.shipping + o.tax;
    }
    for (const r of o.refunds) {
      if (!inRange(r.createdAt, period.start, period.end)) continue;
      const b = map.get(bucketKey(r.createdAt, period.tz, g));
      if (b) { b.net -= r.products; b.total -= r.products; }
    }
  }
  return { granularity: g, points: [...map.values()].map((b) => ({ ...b, total: round(b.total), net: round(b.net) })) };
}

/** Gewinnrechnung für einen Zeitraum und je Produkt. */
async function profitFor(orders, period, shop) {
  const pod = await podOrderCosts().catch(() => null);
  const index = studioProductIndex();
  const t = { revenue: 0, production: 0, podShipping: 0, fees: 0, returns: 0, missing: new Set(), sources: new Set(), ordersWithGaps: 0 };
  const perProduct = new Map();
  for (const o of orders) {
    if (!inRange(o.processedAt, period.start, period.end)) continue;
    const c = orderCosts(o, { pod, index, shopCurrency: shop.currency });
    const gross = o.lines.reduce((x, l) => x + l.gross, 0);
    t.revenue += gross - o.discounts + o.shipping; // Erlös ohne Steuer, inkl. vom Kunden bezahltem Versand
    t.production += c.production || 0;
    t.podShipping += c.shipping || 0;
    t.fees += c.fees || 0;
    c.missing.forEach((m) => t.missing.add(m));
    c.sources.forEach((s) => t.sources.add(s));
    if (c.missing.length) t.ordersWithGaps++;
    // Produktanteile: Erlös je Position (nach Rabatt), Kosten je Stück; Versand/Gebühren anteilig nach Erlös
    const orderNet = o.lines.reduce((x, l) => x + l.discounted, 0) || 1;
    for (const l of o.lines) {
      const key = l.productId || `titel:${l.title}`;
      const share = l.discounted / orderNet;
      const uc = unitCostFor(l, index);
      const pp = perProduct.get(key) || { productId: l.productId, title: l.title, provider: uc.provider, units: 0, revenue: 0, production: 0, podShipping: 0, fees: 0, returns: 0, costMissing: false, costSource: uc.source };
      pp.units += l.quantity;
      pp.revenue += l.discounted;
      if (uc.unit === null) pp.costMissing = true; else pp.production += uc.unit * l.quantity;
      pp.podShipping += (c.shipping || 0) * share;
      pp.fees += (c.fees || 0) * share;
      perProduct.set(key, pp);
    }
  }
  for (const o of orders) {
    for (const r of o.refunds) {
      if (!inRange(r.createdAt, period.start, period.end)) continue;
      t.returns += r.total - (o.taxesIncluded ? r.items.reduce((x, i) => x + i.tax, 0) : 0);
      for (const it of r.items) {
        const line = o.lines.find((l) => l.id === it.lineItemId);
        const key = line?.productId || (line ? `titel:${line.title}` : null);
        if (key && perProduct.has(key)) { const pp = perProduct.get(key); pp.returns += it.subtotal - (o.taxesIncluded ? it.tax : 0); pp.units -= it.quantity; }
      }
    }
  }
  const mc = manualCosts(period);
  const contribution = t.revenue - t.returns - t.production - t.podShipping - t.fees;
  const products = [...perProduct.values()].map((p) => {
    const cm = p.revenue - p.returns - p.production - p.podShipping - p.fees;
    return { ...p, revenue: round(p.revenue), production: round(p.production), podShipping: round(p.podShipping), fees: round(p.fees), returns: round(p.returns), contribution: round(cm), margin: p.revenue && !p.costMissing ? cm / p.revenue : null, preliminary: p.costMissing };
  });
  return {
    revenue: round(t.revenue), returns: round(t.returns), production: round(t.production), podShipping: round(t.podShipping), fees: round(t.fees),
    contribution: round(contribution), ads: round(mc.ads), other: round(mc.other), profit: round(contribution - mc.ads - mc.other),
    margin: t.revenue ? contribution / t.revenue : null,
    preliminary: t.missing.size > 0, missing: [...t.missing], sources: [...t.sources], ordersWithGaps: t.ordersWithGaps,
    pod: pod ? { at: pod.at, sources: pod.sources, errors: pod.errors } : null,
    products, costEntries: mc.entries,
  };
}

function compare(cur, prev, keys) {
  const out = {};
  for (const k of keys) out[k] = { value: cur[k], previous: prev[k], change: cur[k] === null || prev[k] === null ? null : pct(cur[k], prev[k]) };
  return out;
}

function status() {
  const m = meta();
  return { lastSyncAt: m.lastSyncAt || null, lastSyncOk: m.lastSyncOk !== false, lastError: m.lastError || null, orderCount: m.orderCount || 0 };
}

// ------------------------------------------------------------------ Bereiche

export async function overview(periodInput) {
  const { shop, period, orders } = await ctx(periodInput);
  const cur = sums(orders, period.start, period.end);
  const prev = sums(orders, period.prev.start, period.prev.end);
  const [sess, sessPrev] = await Promise.all([ql.sessions(period), ql.sessions({ from: period.prev.from, to: period.prev.to })]);
  const profit = await profitFor(orders, period, shop);
  const profitPrev = await profitFor(orders, { ...period, start: period.prev.start, end: period.prev.end, from: period.prev.from, to: period.prev.to }, shop);
  const { liveSnapshot } = await import('./live.js');
  const live = await liveSnapshot().catch((err) => ({ available: false, reason: err.message }));
  const kpis = {
    ...compare(cur, prev, ['total', 'net', 'orders', 'aov', 'itemsNet', 'refunds']),
    sessions: { value: sess.sessions, previous: sessPrev.sessions, change: sess.sessions !== null && sessPrev.sessions !== null ? pct(sess.sessions, sessPrev.sessions) : null, unavailable: sess.available ? null : sess.reason },
    conversion: { value: sess.conversionRate, previous: sessPrev.conversionRate, change: sess.conversionRate !== null && sessPrev.conversionRate ? pct(sess.conversionRate, sessPrev.conversionRate) : null, unavailable: sess.conversionRate === null ? (sess.reason || 'Shopify liefert keine Conversion-Rate für diesen Zeitraum.') : null },
    profit: { value: profit.profit, previous: profitPrev.profit, change: pct(profit.profit, profitPrev.profit), preliminary: profit.preliminary },
    online: { value: live.available ? live.online : null, unavailable: live.available ? null : live.reason, at: live.updatedAt || null },
  };
  const s = series(orders, period);
  const sp = series(orders, { ...period, start: period.prev.start, end: period.prev.end, from: period.prev.from, to: period.prev.to });
  return {
    shop, period, kpis, sums: cur, previous: prev, status: status(),
    charts: {
      revenue: { current: s.points.map((p) => ({ key: p.key, value: p.total })), previous: sp.points.map((p) => ({ key: p.key, value: p.total })), granularity: s.granularity },
      orders: { current: s.points.map((p) => ({ key: p.key, value: p.orders })), previous: sp.points.map((p) => ({ key: p.key, value: p.orders })), granularity: s.granularity },
      sessions: sess.series ? { current: sess.series.map((p) => ({ key: p.day, value: p.sessions })), granularity: 'day' } : { unavailable: sess.seriesReason || sess.reason },
    },
    profit: { contribution: profit.contribution, profit: profit.profit, preliminary: profit.preliminary, missing: profit.missing },
  };
}

export async function sales(periodInput, { granularity } = {}) {
  const { shop, period, orders } = await ctx(periodInput);
  const cur = sums(orders, period.start, period.end);
  const prev = sums(orders, period.prev.start, period.prev.end);
  const s = series(orders, period, granularity);
  // nach Produkt und Kategorie
  const byProduct = new Map();
  for (const o of orders) {
    if (!inRange(o.processedAt, period.start, period.end)) continue;
    for (const l of o.lines) {
      const key = l.productId || `titel:${l.title}`;
      const p = byProduct.get(key) || { productId: l.productId, title: l.title, units: 0, gross: 0, net: 0, orders: 0 };
      p.units += l.quantity; p.gross += l.gross; p.net += l.discounted; p.orders++;
      byProduct.set(key, p);
    }
  }
  const info = await productInfo([...byProduct.values()].map((p) => p.productId).filter(Boolean));
  const products = [...byProduct.values()].map((p) => ({ ...p, gross: round(p.gross), net: round(p.net), image: info[p.productId]?.image || null, type: info[p.productId]?.type || '' })).sort((a, b) => b.net - a.net);
  const byType = new Map();
  for (const p of products) { const k = p.type || 'Ohne Kategorie'; const t = byType.get(k) || { category: k, net: 0, units: 0 }; t.net += p.net; t.units += p.units; byType.set(k, t); }
  const countries = await ql.byCountry(period);
  return {
    shop, period, sums: cur, previous: prev, change: compare(cur, prev, ['gross', 'discounts', 'returns', 'net', 'shipping', 'tax', 'total', 'orders', 'aov']),
    series: s, products, top: products.slice(0, 5), flop: products.length > 5 ? products.slice(-5).reverse() : [],
    categories: [...byType.values()].map((c) => ({ ...c, net: round(c.net) })).sort((a, b) => b.net - a.net),
    countries: countries.sales, countriesReason: countries.salesReason, status: status(),
  };
}

export async function ordersList({ q = '', status: st = '', sort = 'date-desc', page = 1, preset, from, to } = {}) {
  const { shop, period } = await ctx({ preset: preset || '90d', from, to });
  let list = store().orders.list((o) => inRange(o.processedAt, period.start, period.end));
  const needle = q.trim().toLowerCase();
  if (needle) list = list.filter((o) => o.name.toLowerCase().includes(needle) || o.lines.some((l) => l.title.toLowerCase().includes(needle) || (l.sku || '').toLowerCase().includes(needle)));
  if (st === 'refunded') list = list.filter((o) => o.refunds.length);
  else if (st === 'cancelled') list = list.filter((o) => o.cancelledAt);
  else if (st === 'test') list = list.filter((o) => o.test);
  else if (st === 'open') list = list.filter((o) => !o.cancelledAt && !/FULFILLED/.test(o.fulfillmentStatus || ''));
  else list = list.filter((o) => !o.test);
  const [field, dir] = sort.split('-');
  const val = (o) => (field === 'total' ? o.total : field === 'items' ? o.lines.reduce((s, l) => s + l.quantity, 0) : o.processedAt);
  list.sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * (dir === 'asc' ? 1 : -1));
  const per = 50;
  const total = list.length;
  return {
    shop, period, total, page, pages: Math.max(1, Math.ceil(total / per)),
    orders: list.slice((page - 1) * per, page * per).map((o) => ({ id: o.id, name: o.name, processedAt: o.processedAt, total: o.total, refunded: Math.max(o.refunded || 0, o.refunds.reduce((s, r) => s + r.total, 0)), currency: o.currency, financialStatus: o.financialStatus, fulfillmentStatus: o.fulfillmentStatus, cancelled: Boolean(o.cancelledAt), test: o.test, items: o.lines.reduce((s, l) => s + l.quantity, 0), lines: o.lines.map((l) => ({ title: l.title, variant: l.variantTitle, quantity: l.quantity })) })),
  };
}

export async function products(periodInput) {
  const { shop, period, orders } = await ctx(periodInput);
  const pf = await profitFor(orders, period, shop);
  const info = await productInfo(pf.products.map((p) => p.productId).filter(Boolean));
  const views = await (await import('./live.js')).productViews(period).catch(() => null);
  const rows = pf.products.map((p) => {
    const i = info[p.productId] || {};
    const v = views?.counts?.[p.productId] ?? null;
    return { ...p, title: i.title || p.title, image: i.image || null, price: i.price ?? null, url: i.url || null, views: v, conversion: v ? Math.min(1, p.units / v) : null };
  });
  return {
    shop, period, products: rows,
    byUnits: [...rows].sort((a, b) => b.units - a.units).slice(0, 10),
    byRevenue: [...rows].sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    viewsNote: views?.note || 'Produktaufrufe kommen aus dem Live-View-Dienst (Web Pixel) – noch nicht eingerichtet.',
    preliminary: pf.preliminary, missing: pf.missing,
  };
}

export async function productDetail(productKey, periodInput) {
  const { shop, period, orders } = await ctx(periodInput);
  const own = orders.filter((o) => o.lines.some((l) => (l.productId || `titel:${l.title}`) === productKey));
  const s = series(own.map((o) => ({ ...o, lines: o.lines.filter((l) => (l.productId || `titel:${l.title}`) === productKey), discounts: 0, shipping: 0, tax: 0, refunds: o.refunds.map((r) => ({ ...r, products: r.items.filter((it) => o.lines.find((l) => l.id === it.lineItemId && (l.productId || `titel:${l.title}`) === productKey)).reduce((x, it) => x + it.subtotal, 0) })) })), period);
  const pf = await profitFor(own.map((o) => o), period, shop);
  const row = pf.products.find((p) => (p.productId || `titel:${p.title}`) === productKey) || null;
  const info = productKey.startsWith('gid://') ? (await productInfo([productKey]))[productKey] : null;
  const variants = new Map();
  for (const o of own) for (const l of o.lines) if ((l.productId || `titel:${l.title}`) === productKey && inRange(o.processedAt, period.start, period.end)) {
    const v = variants.get(l.variantTitle || '–') || { variant: l.variantTitle || '–', units: 0, net: 0 };
    v.units += l.quantity; v.net += l.discounted; variants.set(v.variant, v);
  }
  const index = studioProductIndex();
  const draft = index.find(productKey, row?.title || info?.title);
  return { shop, period, product: { key: productKey, ...(info || {}), title: info?.title || row?.title || productKey }, stats: row, series: s, variants: [...variants.values()].map((v) => ({ ...v, net: round(v.net) })).sort((a, b) => b.units - a.units), studioDraft: draft ? { id: draft.id, provider: draft.provider, baseProduct: draft.baseProduct?.title } : null, manualCost: getSettings().analytics.productCosts?.[productKey] || null };
}

export async function profit(periodInput) {
  const { shop, period, orders } = await ctx(periodInput);
  const pf = await profitFor(orders, period, shop);
  const info = await productInfo(pf.products.map((p) => p.productId).filter(Boolean));
  pf.products = pf.products.map((p) => ({ ...p, title: info[p.productId]?.title || p.title, image: info[p.productId]?.image || null })).sort((a, b) => b.contribution - a.contribution);
  return { shop, period, ...pf };
}

export async function customers(periodInput) {
  const { shop, period, orders } = await ctx(periodInput);
  const firstOrder = new Map();
  for (const o of [...orders].sort((a, b) => a.processedAt.localeCompare(b.processedAt))) if (o.customerKey && !firstOrder.has(o.customerKey)) firstOrder.set(o.customerKey, o.id);
  let newC = 0; let returning = 0; let guests = 0;
  const custOrders = new Map();
  for (const o of orders) {
    if (!inRange(o.processedAt, period.start, period.end)) continue;
    if (!o.customerKey) { guests++; continue; }
    if (firstOrder.get(o.customerKey) === o.id) newC++; else returning++;
    custOrders.set(o.customerKey, (custOrders.get(o.customerKey) || 0) + 1);
  }
  const [sess, countries, traffic] = await Promise.all([ql.sessions(period), ql.byCountry(period), ql.trafficBreakdown(period)]);
  const hist = sumsHistory();
  return {
    shop, period, sessions: sess, countries, traffic,
    customers: { newOrders: newC, returningOrders: returning, guestOrders: guests, uniqueCustomers: custOrders.size, ordersPerCustomer: custOrders.size ? [...custOrders.values()].reduce((a, b) => a + b, 0) / custOrders.size : null },
    note: hist.limited ? 'Ohne Berechtigung read_all_orders sieht Shopify nur die letzten 60 Tage – „neu/wiederkehrend“ bezieht sich auf diesen Zeitraum.' : null,
  };
}

function sumsHistory() {
  const oldest = store().orders.list().reduce((m, o) => (!m || o.processedAt < m ? o.processedAt : m), null);
  return { oldest, limited: !oldest || Date.now() - Date.parse(oldest) < 61 * 86_400_000 };
}

export async function goalProgress() {
  const shop = await shopInfo();
  const today = resolvePeriod({ preset: 'today' }, shop.tz);
  const orders = validOrders();
  const monthStart = `${today.from.slice(0, 7)}-01`;
  const month = resolvePeriod({ preset: 'custom', from: monthStart, to: today.to }, shop.tz);
  return { currency: shop.currency, todayKey: today.from, monthKey: monthStart.slice(0, 7), today: sums(orders, today.start, today.end).total, month: sums(orders, month.start, month.end).total, goals: getSettings().analytics.goals };
}

export { sums as _sums, series as _series, dayKey };
