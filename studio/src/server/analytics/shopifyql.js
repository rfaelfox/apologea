import { getSettings } from '../store.js';
import { errorMessage } from '../util.js';
import * as shopify from '../integrations/shopify.js';

/**
 * ShopifyQL über `shopifyqlQuery` (GraphQL Admin API, Berechtigung read_reports).
 * Liefert Kennzahlen, die nur Shopify kennt (Sitzungen, Besucher, Conversion, Länder).
 *
 * Shopify passt Datensätze und Spaltennamen von ShopifyQL gelegentlich an. Deshalb probiert jede Abfrage
 * mehrere Schreibweisen; was funktioniert, wird gemerkt. Schlägt alles fehl, meldet die Funktion
 * ehrlich „nicht verfügbar“ samt Grund – es werden nie Werte geschätzt oder erfunden.
 */

const working = new Map(); // Abfrage-Schlüssel → Index der funktionierenden Variante
const cache = new Map(); // Abfragetext → { at, data }

async function run(query) {
  const hit = cache.get(query);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.data;
  const d = await shopify.gql('query($q: String!) { shopifyqlQuery(query: $q) { tableData { columns { name dataType displayName } rows } parseErrors } }', { q: query });
  const r = d.shopifyqlQuery;
  if (!r) throw new Error('ShopifyQL lieferte keine Antwort.');
  const errs = (r.parseErrors || []).map((e) => (typeof e === 'string' ? e : e.message || JSON.stringify(e)));
  if (errs.length) throw new Error(errs.join('; '));
  const cols = (r.tableData?.columns || []).map((c) => c.name);
  let rows = r.tableData?.rows || [];
  if (typeof rows === 'string') rows = JSON.parse(rows);
  // Zeilen können als Arrays oder als Objekte kommen → einheitlich Objekte
  const objs = rows.map((row) => (Array.isArray(row) ? Object.fromEntries(cols.map((c, i) => [c, row[i]])) : row));
  const data = { columns: cols, rows: objs };
  cache.set(query, { at: Date.now(), data });
  return data;
}

/** Erste funktionierende Variante ausführen. variants: [(ctx) => queryString] */
async function tryVariants(key, variants, ctx) {
  const order = working.has(key) ? [working.get(key), ...variants.keys()] : [...variants.keys()];
  let lastErr = null;
  for (const i of [...new Set(order)]) {
    try {
      const data = await run(variants[i](ctx));
      working.set(key, i);
      return { available: true, ...data, query: variants[i](ctx) };
    } catch (err) {
      lastErr = err;
      if (err.code === 'access_denied' || err.code === 'missing_admin' || err.code === 'auth') break;
    }
  }
  return { available: false, reason: friendly(lastErr) };
}

function friendly(err) {
  const m = errorMessage(err);
  if (/read_reports|ACCESS_DENIED|Berechtigung/i.test(m)) return 'Shopify-Berechtigung read_reports fehlt (Admin-App → Berechtigungen).';
  if (/Admin-App/.test(m)) return m;
  return `Von Shopify nicht geliefert: ${m}`;
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const pick = (row, names) => { for (const n of names) if (row[n] !== undefined) return num(row[n]); return null; };

/** Sitzungen, Besucher und Conversion für einen Zeitraum (Summen + Verlauf nach Tag). */
export async function sessions(period) {
  const ctx = { since: period.from, until: period.to };
  const totals = await tryVariants('sessions-total', [
    (c) => `FROM sessions SHOW sessions, online_store_visitors, conversion_rate SINCE ${c.since} UNTIL ${c.until}`,
    (c) => `FROM sessions SHOW sessions, conversion_rate SINCE ${c.since} UNTIL ${c.until}`,
    (c) => `FROM sessions SHOW sessions SINCE ${c.since} UNTIL ${c.until}`,
  ], ctx);
  const series = await tryVariants('sessions-series', [
    (c) => `FROM sessions SHOW sessions, conversion_rate GROUP BY day SINCE ${c.since} UNTIL ${c.until} ORDER BY day ASC`,
    (c) => `FROM sessions SHOW sessions TIMESERIES day SINCE ${c.since} UNTIL ${c.until}`,
  ], ctx);
  const t = totals.available ? totals.rows[0] || {} : {};
  let conv = totals.available ? pick(t, ['conversion_rate', 'online_store_conversion_rate']) : null;
  if (conv !== null && conv > 1) conv /= 100; // manche Antworten in Prozent
  return {
    available: totals.available,
    reason: totals.reason,
    sessions: totals.available ? pick(t, ['sessions', 'online_store_sessions']) : null,
    visitors: totals.available ? pick(t, ['online_store_visitors', 'visitors']) : null,
    conversionRate: conv,
    series: series.available ? series.rows.map((r) => ({ day: String(r.day || r.date || '').slice(0, 10), sessions: pick(r, ['sessions']) })).filter((r) => r.day) : null,
    seriesReason: series.reason,
  };
}

/** Sitzungen bzw. Umsatz nach Land – nur aggregiert, keine Einzelpersonen. */
export async function byCountry(period) {
  const ctx = { since: period.from, until: period.to };
  const sales = await tryVariants('sales-country', [
    (c) => `FROM sales SHOW total_sales, net_sales, orders GROUP BY billing_country SINCE ${c.since} UNTIL ${c.until} ORDER BY total_sales DESC LIMIT 25`,
    (c) => `FROM sales SHOW net_sales, orders GROUP BY billing_country SINCE ${c.since} UNTIL ${c.until} ORDER BY net_sales DESC LIMIT 25`,
    (c) => `FROM sales SHOW total_sales, orders GROUP BY shipping_country SINCE ${c.since} UNTIL ${c.until} ORDER BY total_sales DESC LIMIT 25`,
  ], ctx);
  const visits = await tryVariants('sessions-country', [
    (c) => `FROM sessions SHOW sessions GROUP BY session_country SINCE ${c.since} UNTIL ${c.until} ORDER BY sessions DESC LIMIT 25`,
    (c) => `FROM sessions SHOW sessions GROUP BY country SINCE ${c.since} UNTIL ${c.until} ORDER BY sessions DESC LIMIT 25`,
  ], ctx);
  return {
    sales: sales.available ? sales.rows.map((r) => ({ country: r.billing_country || r.shipping_country || '—', sales: pick(r, ['total_sales', 'net_sales']), orders: pick(r, ['orders']) })) : null,
    salesReason: sales.reason,
    sessions: visits.available ? visits.rows.map((r) => ({ country: r.session_country || r.country || '—', sessions: pick(r, ['sessions']) })) : null,
    sessionsReason: visits.reason,
  };
}

/** Geräte und Herkunft der Besuche. */
export async function trafficBreakdown(period) {
  const ctx = { since: period.from, until: period.to };
  const devices = await tryVariants('sessions-device', [
    (c) => `FROM sessions SHOW sessions GROUP BY session_device_type SINCE ${c.since} UNTIL ${c.until} ORDER BY sessions DESC`,
    (c) => `FROM sessions SHOW sessions GROUP BY device_type SINCE ${c.since} UNTIL ${c.until} ORDER BY sessions DESC`,
  ], ctx);
  const sources = await tryVariants('sessions-source', [
    (c) => `FROM sessions SHOW sessions GROUP BY referrer_source SINCE ${c.since} UNTIL ${c.until} ORDER BY sessions DESC LIMIT 10`,
    (c) => `FROM sessions SHOW sessions GROUP BY referring_channel SINCE ${c.since} UNTIL ${c.until} ORDER BY sessions DESC LIMIT 10`,
  ], ctx);
  const label = (r, keys) => { for (const k of keys) if (r[k]) return String(r[k]); return '—'; };
  return {
    devices: devices.available ? devices.rows.map((r) => ({ label: label(r, ['session_device_type', 'device_type']), sessions: pick(r, ['sessions']) })) : null,
    devicesReason: devices.reason,
    sources: sources.available ? sources.rows.map((r) => ({ label: label(r, ['referrer_source', 'referring_channel']), sessions: pick(r, ['sessions']) })) : null,
    sourcesReason: sources.reason,
  };
}

export function clearCache() { cache.clear(); }
export const _settings = () => getSettings().analytics;
