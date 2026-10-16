/**
 * APOLOGEA Live-View-Dienst – Kernlogik (unabhängig vom Hosting).
 *
 * Nimmt Customer Events des Shopify Web Pixels entgegen und beantwortet Abfragen des Studios.
 * Datenschutz (DSGVO):
 *  - Das Pixel sendet nur, wenn Besucher der Analyse zugestimmt haben (Customer Privacy API, siehe pixel.js).
 *  - Keine IP-Adressen, keine Kundendaten, keine Cookies dieses Dienstes.
 *  - Besucher-Kennung = Hash(Tagessalz + clientId des Pixels) → wechselt täglich, nicht rückführbar.
 *  - Land nur grob (2 Buchstaben) aus dem Hosting-Netz (z. B. Cloudflare), IP wird nicht gespeichert.
 *  - Ereignisse werden nach 48 Stunden gelöscht; Tageszähler für Produktaufrufe nach 400 Tagen.
 *
 * Speicher-Schnittstelle (store): insertEvent(e), eventsSince(ts), countViews(fromDay, toDay), bumpView(day, productId),
 * purge(beforeTs), purgeViews(beforeDay), count24h(ts), getSalt(day).
 */

export const VERSION = '1.0.0';
const ALLOWED = new Set(['page_viewed', 'product_viewed', 'product_added_to_cart', 'checkout_started', 'checkout_completed']);

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });
}

function cors(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = origin && (allowed.includes(origin) || /\.myshopify\.com$/.test(new URL(origin).host) || /^https:\/\/[\w-]+\.shopifycloud\.com$/.test(origin) || origin === 'null');
  return ok ? { 'Access-Control-Allow-Origin': origin === 'null' ? '*' : origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } : null;
}

const clean = (v, max = 120) => (typeof v === 'string' ? v.slice(0, max) : null);
const dayOf = (ts) => new Date(ts).toISOString().slice(0, 10);

/** Ein Ereignis vom Pixel annehmen. */
async function ingest(request, env, store, meta) {
  const origin = request.headers.get('Origin');
  const c = cors(origin || 'null', env) || {};
  let body;
  try { body = await request.json(); } catch { return json({ ok: false }, 400, c); }
  const events = Array.isArray(body?.events) ? body.events.slice(0, 20) : [body];
  const now = Date.now();
  for (const ev of events) {
    if (!ev || !ALLOWED.has(ev.name)) continue;
    if (env.SHOP_DOMAIN && ev.shop && ev.shop !== env.SHOP_DOMAIN) continue;
    if (ev.consent !== true) continue; // ohne Einwilligung nichts speichern
    const ts = Math.min(now, Number(ev.ts) || now);
    if (now - ts > 10 * 60_000) continue; // veraltete Ereignisse verwerfen
    const day = dayOf(ts);
    const visitor = ev.clientId ? await sha256(`${await store.getSalt(day)}:${ev.clientId}`) : null;
    const e = { ts, type: ev.name, visitor, productId: clean(ev.productId, 80), productTitle: clean(ev.productTitle), country: /^[A-Z]{2}$/.test(meta.country || '') ? meta.country : null, path: clean(ev.path, 200) };
    await store.insertEvent(e);
    if (e.type === 'product_viewed' && e.productId) await store.bumpView(day, e.productId, e.productTitle);
  }
  return json({ ok: true }, 200, c);
}

/** Live-Zahlen für das Studio. */
async function live(url, store) {
  const windowS = Math.min(1800, Math.max(60, Number(url.searchParams.get('window')) || 300));
  const now = Date.now();
  const since60 = now - 60 * 60_000;
  const events = await store.eventsSince(since60);
  const recent = events.filter((e) => e.ts >= now - windowS * 1000);
  const visitors = (list) => new Set(list.map((e) => e.visitor).filter(Boolean));
  const online = visitors(recent);
  const products = new Map();
  for (const e of recent) if (e.type === 'product_viewed' && e.productId) {
    const p = products.get(e.productId) || { id: e.productId, title: e.productTitle, visitors: new Set() };
    if (e.visitor) p.visitors.add(e.visitor);
    products.set(e.productId, p);
  }
  const countries = new Map();
  const lastCountry = new Map();
  for (const e of recent) if (e.visitor && e.country) lastCountry.set(e.visitor, e.country);
  for (const c of lastCountry.values()) countries.set(c, (countries.get(c) || 0) + 1);
  // Verlauf: je Minute die Besucher der jeweils letzten 5 Minuten
  const series = [];
  for (let t = now - 60 * 60_000; t <= now; t += 60_000) series.push({ t: new Date(t).toISOString(), online: visitors(events.filter((e) => e.ts > t - windowS * 1000 && e.ts <= t)).size });
  return json({
    updatedAt: new Date(now).toISOString(), windowSeconds: windowS,
    online: online.size,
    carts: visitors(recent.filter((e) => e.type === 'product_added_to_cart')).size,
    checkouts: visitors(recent.filter((e) => e.type === 'checkout_started')).size,
    purchases: recent.filter((e) => e.type === 'checkout_completed').length,
    products: [...products.values()].map((p) => ({ id: p.id, title: p.title, viewers: p.visitors.size })).sort((a, b) => b.viewers - a.viewers).slice(0, 10),
    countries: [...countries.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
    series,
    consentNote: 'Gezählt werden nur Besucher, die der Analyse zugestimmt haben (Einwilligung über das Cookie-Banner).',
  });
}

/** Einstiegspunkt: Request → Response. store und meta stellt die Hosting-Schicht bereit. */
export async function handle(request, env, store, meta = {}) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request.headers.get('Origin') || 'null', env) || {} });
  if (request.method === 'POST' && url.pathname === '/v1/e') return ingest(request, env, store, meta);
  // Alles andere nur mit Zugangsschlüssel des Studios
  const auth = request.headers.get('Authorization') || '';
  if (!env.READ_TOKEN || auth !== `Bearer ${env.READ_TOKEN}`) return json({ error: 'unauthorized' }, 401);
  if (request.method === 'GET' && url.pathname === '/v1/live') return live(url, store);
  if (request.method === 'GET' && url.pathname === '/v1/views') {
    const from = url.searchParams.get('from'); const to = url.searchParams.get('to');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) return json({ error: 'from/to' }, 400);
    return json({ counts: await store.countViews(from, to) });
  }
  if (request.method === 'GET' && url.pathname === '/v1/health') return json({ ok: true, version: VERSION, shop: env.SHOP_DOMAIN || null, events24h: await store.count24h(Date.now() - 86_400_000) });
  return json({ error: 'not found' }, 404);
}

/** Aufräumen (zeitgesteuert, z. B. stündlich). */
export async function cleanup(store, now = Date.now()) {
  await store.purge(now - 48 * 3600_000);
  await store.purgeViews(dayOf(now - 400 * 86_400_000));
}
