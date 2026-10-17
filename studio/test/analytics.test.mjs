// Tests für Analytics & Business Intelligence.
// TESTDATEN: Alle Bestellungen, Sitzungen und Live-Ereignisse hier sind erfunden und nur für die Prüfung der
// Rechenlogik gedacht. Es wird kein echter Shop angesprochen.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apologea-analytics-'));
process.env.APOLOGEA_DATA_DIR = tmp;
process.env.APOLOGEA_TEST = '1';

// ---- simulierter Shopify-Admin (nur die von Analytics genutzten Abfragen)
const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();
const DAY = 86_400_000;
const m = (v) => ({ shopMoney: { amount: String(v), currencyCode: 'EUR' } });
function order(n, { ago, lines, shipping = 4.9, discount = 0, refunds = [], test: isTest = false, status = 'PAID', customer = 'gid://shopify/Customer/1', updated = 0 }) {
  const sub = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const tax = Math.round((sub - discount) * 19 / 119 * 100) / 100;
  return {
    id: `gid://shopify/Order/${1000 + n}`, name: `#${1000 + n}`, createdAt: iso(ago), processedAt: iso(ago), updatedAt: iso(updated || ago), cancelledAt: null, test: isTest,
    taxesIncluded: true, displayFinancialStatus: status, displayFulfillmentStatus: 'FULFILLED', currencyCode: 'EUR', sourceName: 'web', customer: customer ? { id: customer } : null,
    subtotalPriceSet: m(sub - discount), totalDiscountsSet: m(discount), totalShippingPriceSet: m(shipping), totalTaxSet: m(tax), totalPriceSet: m(sub - discount + shipping),
    totalRefundedSet: m(refunds.reduce((s, r) => s + r.total, 0)),
    lineItems: { nodes: lines.map((l, i) => ({ id: `gid://shopify/LineItem/${n}${i}`, title: l.title, quantity: l.qty, sku: '', vendor: 'MarketPrint', product: { id: l.pid }, variant: { id: `gid://shopify/ProductVariant/${n}${i}`, title: l.variant || 'Black / M' }, originalTotalSet: m(l.price * l.qty), discountedTotalSet: m(l.price * l.qty - (i === 0 ? discount : 0)), taxLines: [{ priceSet: m(Math.round((l.price * l.qty - (i === 0 ? discount : 0)) * 19 / 119 * 100) / 100) }] })) },
    refunds: refunds.map((r, i) => ({ id: `gid://shopify/Refund/${n}${i}`, createdAt: iso(r.ago), totalRefundedSet: m(r.total), refundLineItems: { nodes: [{ quantity: r.qty, subtotalSet: m(r.total), totalTaxSet: m(Math.round(r.total * 19 / 119 * 100) / 100), lineItem: { id: `gid://shopify/LineItem/${n}0` } }] } })),
  };
}
const SHIRT = 'gid://shopify/Product/9001';
const HOODIE = 'gid://shopify/Product/9002';
let orders = [
  order(1, { ago: 2 * 3600_000, lines: [{ title: 'Theotokos Shirt', pid: SHIRT, price: 49.9, qty: 2 }] }),
  order(2, { ago: 3 * DAY, lines: [{ title: 'Kreuz Hoodie', pid: HOODIE, price: 89, qty: 1 }], discount: 10, customer: 'gid://shopify/Customer/2' }),
  order(3, { ago: 10 * DAY, lines: [{ title: 'Theotokos Shirt', pid: SHIRT, price: 49.9, qty: 1 }], refunds: [{ ago: 9 * DAY, total: 49.9, qty: 1 }], customer: 'gid://shopify/Customer/2' }),
  order(4, { ago: 40 * DAY, lines: [{ title: 'Kreuz Hoodie', pid: HOODIE, price: 89, qty: 1 }] }), // Vorperiode
  order(5, { ago: 5 * DAY, lines: [{ title: 'Testkauf', pid: SHIRT, price: 1, qty: 1 }], test: true }),
  order(6, { ago: 6 * DAY, lines: [{ title: 'Nie bezahlt', pid: SHIRT, price: 49.9, qty: 1 }], status: 'EXPIRED' }),
];
const qlCalls = [];
const shop = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/admin/oauth/access_token')) return res.end(JSON.stringify({ access_token: 't', scope: 'read_orders,read_reports,read_products', expires_in: 86399 }));
    const { query, variables: v } = JSON.parse(body);
    if (/shop \{ name ianaTimezone/.test(query)) return res.end(JSON.stringify({ data: { shop: { name: 'APOLOGEA (Test)', ianaTimezone: 'Europe/Berlin', currencyCode: 'EUR' } } }));
    if (/orders\(first: 50/.test(query)) {
      let list = orders;
      const since = /updated_at:>='([^']+)'/.exec(v.q || '')?.[1];
      if (since) list = list.filter((o) => o.updatedAt >= since);
      return res.end(JSON.stringify({ data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: list } } }));
    }
    if (/nodes\(ids/.test(query)) return res.end(JSON.stringify({ data: { nodes: v.ids.map((id) => ({ id, title: id === SHIRT ? 'Theotokos Shirt' : 'Kreuz Hoodie', handle: 'x', vendor: 'MarketPrint', productType: id === SHIRT ? 'T-Shirt' : 'Hoodie', status: 'ACTIVE', featuredMedia: null, priceRangeV2: { minVariantPrice: { amount: '49.9' }, maxVariantPrice: { amount: '49.9' } }, onlineStoreUrl: null })) } }));
    if (/shopifyqlQuery/.test(query)) {
      qlCalls.push(v.q);
      // erste Schreibweise „scheitert“, zweite funktioniert – prüft die Ausweichlogik
      if (/online_store_visitors/.test(v.q)) return res.end(JSON.stringify({ data: { shopifyqlQuery: { tableData: null, parseErrors: ['Unknown column online_store_visitors'] } } }));
      if (/FROM sessions SHOW sessions, conversion_rate SINCE/.test(v.q)) return res.end(JSON.stringify({ data: { shopifyqlQuery: { tableData: { columns: [{ name: 'sessions' }, { name: 'conversion_rate' }], rows: [[400, 0.0125]] }, parseErrors: [] } } }));
      return res.end(JSON.stringify({ data: { shopifyqlQuery: { tableData: null, parseErrors: ['not supported in test'] } } }));
    }
    res.end(JSON.stringify({ errors: [{ message: 'Mock: nicht unterstützt' }] }));
  });
});
shop.keepAliveTimeout = 60_000;

let S;
before(async () => {
  await new Promise((r) => shop.listen(0, '127.0.0.1', r));
  process.env.APOLOGEA_SHOPIFY_MOCK_URL = `http://127.0.0.1:${shop.address().port}`;
  (await import('../src/server/paths.js')).ensureDirs();
  const store = await import('../src/server/store.js');
  store.openStore();
  const secrets = await import('../src/server/secrets.js');
  await secrets.setSecret('shopify.clientId', 'id');
  await secrets.setSecret('shopify.clientSecret', 'secret');
  S = {
    store, secrets,
    sync: await import('../src/server/analytics/sync.js'),
    metrics: await import('../src/server/analytics/metrics.js'),
    time: await import('../src/server/analytics/time.js'),
    reports: await import('../src/server/analytics/reports.js'),
    notify: await import('../src/server/analytics/notify.js'),
    live: await import('../src/server/analytics/live.js'),
    core: await import('../src/collector/core.js'),
  };
});
after(() => shop.close());

test('Zeitzone: Tagesgrenzen in Shop-Zeit (Europe/Berlin), Vorperiode gleich lang', () => {
  assert.equal(S.time.dayKey('2026-10-15T22:30:00.000Z', 'Europe/Berlin'), '2026-10-16'); // 00:30 Uhr in Berlin
  assert.equal(S.time.startOfDay('2026-10-16', 'Europe/Berlin').toISOString(), '2026-10-15T22:00:00.000Z');
  assert.equal(S.time.startOfDay('2026-01-10', 'Europe/Berlin').toISOString(), '2026-01-09T23:00:00.000Z'); // Winterzeit
  const p = S.time.resolvePeriod({ preset: '7d' }, 'Europe/Berlin', new Date('2026-10-16T10:00:00Z'));
  assert.equal(p.from, '2026-10-10');
  assert.equal(p.prev.to, '2026-10-09');
  assert.equal(p.prev.from, '2026-10-03');
});

test('Synchronisierung: übernimmt Bestellungen ohne Kundendaten, keine Doppelungen', async () => {
  const r = await S.sync.syncOrders({ full: true });
  assert.equal(r.total, 6);
  const o = S.store.store().orders.get('o_1001');
  assert.equal(o.lines[0].quantity, 2);
  assert.equal(o.customerKey.length, 20, 'nur Pseudonym');
  assert.ok(!JSON.stringify(o).includes('Customer/1'), 'keine Kunden-ID im Klartext');
  const again = await S.sync.syncOrders({ full: true });
  assert.equal(again.total, 6);
  assert.equal(again.added, 0);
});

test('Kennzahlen 30 Tage: Umsatz ohne Testbestellung/abgelaufene, Rückerstattung nach Datum, Vergleich', async () => {
  const o = await S.metrics.overview({ preset: '30d' });
  const net = (v) => Math.round(v / 1.19 * 100) / 100; // Preise inkl. 19 % MwSt.
  // Brutto (ohne Steuer): 2×49,90 + 89 + 49,90  − Rabatt 10 (netto) − Rücksendung 49,90 (netto)
  const gross = net(99.8) + net(89) + net(49.9);
  assert.ok(Math.abs(o.sums.discounts - net(10)) < 0.05, `Rabatt ohne MwSt.: ${o.sums.discounts}`);
  assert.equal(o.kpis.orders.value, 3);
  assert.ok(Math.abs(o.sums.gross - gross) < 0.05, `${o.sums.gross} vs ${gross}`);
  assert.ok(Math.abs(o.sums.returns - net(49.9)) < 0.05);
  assert.equal(o.kpis.itemsNet.value, 3); // 4 verkauft − 1 zurück
  assert.equal(o.kpis.orders.previous, 1);
  assert.equal(o.kpis.sessions.value, 400);
  assert.equal(o.kpis.conversion.value, 0.0125);
  assert.equal(o.kpis.online.value, null, 'ohne Live-Dienst kein Wert');
  assert.match(o.kpis.online.unavailable, /nicht eingerichtet/);
  assert.equal(o.charts.revenue.current.length, 30);
  assert.ok(qlCalls.some((q) => /online_store_visitors/.test(q)) && qlCalls.some((q) => /conversion_rate SINCE/.test(q)), 'Ausweich-Schreibweise genutzt');
  assert.ok(o.charts.sessions.unavailable, 'Verlauf nicht verfügbar → ehrlich gekennzeichnet');
});

test('Gewinn: vorläufig ohne Kosten, vollständig mit Stückkosten, Versand und Gebühren', async () => {
  let p = await S.metrics.profit({ preset: '30d' });
  assert.equal(p.preliminary, true);
  assert.ok(p.missing.some((x) => /Herstellkosten/.test(x)));
  const s = S.store.getSettings();
  s.analytics.productCosts = { [SHIRT]: { unit: 18 }, [HOODIE]: { unit: 30 } };
  s.analytics.fees = { percent: 2, fixed: 0.3 };
  s.analytics.podShippingPerOrder = 5;
  S.store.store().settings.put(s);
  p = await S.metrics.profit({ preset: '30d' });
  assert.equal(p.preliminary, false, p.missing.join());
  assert.equal(p.production, 18 * 3 + 30);
  assert.equal(p.podShipping, 15);
  const shirt = p.products.find((x) => x.productId === SHIRT);
  assert.equal(shirt.units, 2, '3 verkauft − 1 erstattet');
  assert.ok(shirt.contribution < shirt.revenue);
  S.store.store().costs.put({ date: S.time.dayKey(new Date().toISOString(), 'Europe/Berlin'), amount: 20, category: 'werbung', note: 'Test' });
  const p2 = await S.metrics.profit({ preset: '30d' });
  assert.equal(Math.round((p2.contribution - p2.profit) * 100) / 100, 20, 'Werbung mindert Gewinn, nicht Deckungsbeitrag');
});

test('Neue Bestellung und Rückerstattung → Benachrichtigungen (ohne Doppelungen)', async () => {
  orders = [...orders, order(7, { ago: 60_000, lines: [{ title: 'Theotokos Shirt', pid: SHIRT, price: 49.9, qty: 1 }], updated: 1000 })];
  orders[0] = { ...orders[0], updatedAt: iso(500), refunds: [{ id: 'gid://shopify/Refund/r1', createdAt: iso(500), totalRefundedSet: m(10), refundLineItems: { nodes: [] } }] };
  await S.sync.syncOrders({});
  await S.sync.syncOrders({});
  const n = S.notify.listNotices();
  assert.equal(n.filter((x) => x.kind === 'sale').length, 1);
  assert.equal(n.filter((x) => x.kind === 'refund').length, 1);
});

test('Bestellhistorie: Suche, Filter, Sortierung', async () => {
  const all = await S.metrics.ordersList({ preset: '90d' });
  assert.equal(all.total, 6, 'ohne Testbestellung');
  const q = await S.metrics.ordersList({ preset: '90d', q: 'hoodie' });
  assert.equal(q.total, 2);
  const ref = await S.metrics.ordersList({ preset: '90d', status: 'refunded' });
  assert.ok(ref.orders.every((o) => o.refunded > 0));
  const byTotal = await S.metrics.ordersList({ preset: '90d', sort: 'total-desc' });
  assert.ok(byTotal.orders[0].total >= byTotal.orders[1].total);
});

test('Berichte: CSV (deutsches Excel), XLSX, PDF', async () => {
  const csv = await S.reports.createReport({ kind: 'monat', format: 'csv' }, { port: 0 });
  const text = fs.readFileSync(csv.path, 'utf8');
  assert.ok(text.startsWith('﻿') && text.includes(';') && /Gesamtumsatz;\d+,\d+/.test(text));
  const x = await S.reports.createReport({ kind: 'woche', format: 'xlsx' }, { port: 0 });
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip(x.path);
  assert.ok(zip.getEntry('xl/workbook.xml').getData().toString().includes('Kennzahlen'));
  assert.ok(zip.getEntry('xl/worksheets/sheet3.xml').getData().toString().includes('Theotokos Shirt'));
  // PDF über einen echten Chromium (statt Edge) – Bericht wird über eine einmalige Adresse geladen
  const chrome = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  if (fs.existsSync(chrome)) {
    process.env.APOLOGEA_PDF_BROWSER = chrome;
    const srv = http.createServer((req, res) => { const h = S.reports.htmlByToken(req.url.split('/').pop()); res.writeHead(h ? 200 : 404, { 'Content-Type': 'text/html' }); res.end(h || ''); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const pdf = await S.reports.createReport({ kind: 'monat', format: 'pdf' }, { port: srv.address().port });
    srv.close();
    assert.equal(pdf.format, 'pdf', pdf.note);
    assert.equal(fs.readFileSync(pdf.path).subarray(0, 4).toString(), '%PDF');
  }
});

// ---- Live-View-Dienst (Kernlogik) mit Speicher im Arbeitsspeicher
function memStore() {
  const events = []; const views = new Map(); const salts = new Map();
  return {
    events,
    async insertEvent(e) { events.push(e); },
    async eventsSince(ts) { return events.filter((e) => e.ts >= ts); },
    async bumpView(day, id) { const k = `${day}|${id}`; views.set(k, (views.get(k) || 0) + 1); },
    async countViews(from, to) { const out = {}; for (const [k, n] of views) { const [d, id] = k.split('|'); if (d >= from && d <= to) out[id] = (out[id] || 0) + n; } return out; },
    async purge(before) { for (let i = events.length - 1; i >= 0; i--) if (events[i].ts < before) events.splice(i, 1); },
    async purgeViews() {},
    async count24h(since) { return events.filter((e) => e.ts >= since).length; },
    async getSalt(day) { if (!salts.has(day)) salts.set(day, Math.random().toString(36)); return salts.get(day); },
  };
}

test('Live-View-Dienst: nur mit Einwilligung, gehashte Besucher, 5-Minuten-Fenster, Zugriffsschutz', async () => {
  const st = memStore();
  const env = { READ_TOKEN: 'geheim', SHOP_DOMAIN: 'dfz1mp-1u.myshopify.com' };
  const post = (body) => S.core.handle(new Request('https://x.workers.dev/v1/e', { method: 'POST', headers: { Origin: 'https://dfz1mp-1u.myshopify.com', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, st, { country: 'DE' });
  const t = Date.now();
  await post({ name: 'product_viewed', consent: true, shop: env.SHOP_DOMAIN, clientId: 'A', ts: t, productId: SHIRT, productTitle: 'Theotokos Shirt' });
  await post({ name: 'product_added_to_cart', consent: true, shop: env.SHOP_DOMAIN, clientId: 'A', ts: t });
  await post({ name: 'page_viewed', consent: true, shop: env.SHOP_DOMAIN, clientId: 'B', ts: t - 10 * 60_000 + 1000 }); // knapp 10 Min. alt → nicht mehr online
  await post({ name: 'page_viewed', consent: false, shop: env.SHOP_DOMAIN, clientId: 'C', ts: t }); // ohne Einwilligung
  await post({ name: 'page_viewed', consent: true, shop: 'fremder-shop.myshopify.com', clientId: 'D', ts: t }); // fremder Shop
  assert.equal(st.events.length, 3);
  assert.ok(st.events.every((e) => e.visitor !== 'A' && !('ip' in e)), 'Besucher nur gehasht, keine IP');
  const unauth = await S.core.handle(new Request('https://x.workers.dev/v1/live'), env, st);
  assert.equal(unauth.status, 401);
  const live = await (await S.core.handle(new Request('https://x.workers.dev/v1/live?window=300', { headers: { Authorization: 'Bearer geheim' } }), env, st)).json();
  assert.equal(live.online, 1);
  assert.equal(live.carts, 1);
  assert.equal(live.products[0].viewers, 1);
  assert.deepEqual(live.countries, [{ code: 'DE', count: 1 }]);
  assert.equal(live.series.length, 61);
  // Studio fragt den Dienst ab (Zugangsschlüssel bleibt auf dem Server)
  const srv = http.createServer(async (req, res) => {
    const r = await S.core.handle(new Request(`http://127.0.0.1${req.url}`, { headers: req.headers }), env, st);
    res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(await r.text());
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const s = S.store.getSettings(); s.analytics.collectorUrl = `http://127.0.0.1:${srv.address().port}`; S.store.store().settings.put(s);
  await S.secrets.setSecret('analytics.collectorToken', 'geheim');
  const snap = await S.live.liveSnapshot();
  srv.close();
  assert.equal(snap.available, true, snap.reason);
  assert.equal(snap.online, 1);
  assert.ok(snap.purchases.length >= 1, 'echte Käufe aus der Bestell-Synchronisierung');
});
