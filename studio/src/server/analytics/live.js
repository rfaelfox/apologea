import { store, getSettings } from '../store.js';
import { UserError, errorMessage } from '../util.js';
import { getSecret } from '../secrets.js';

/**
 * Live View.
 *
 * Shopify bietet für die eigene „Live View“ keine öffentliche Schnittstelle. Echtzeitdaten über Besucher
 * kommen deshalb aus einem kleinen, eigenen Dienst (src/collector/), der die Customer Events eines
 * Shopify Web Pixels entgegennimmt – nur mit Einwilligung der Besucher (Cookie-Banner/Customer Privacy API),
 * ohne IP-Adressen, mit täglich wechselndem Pseudonym. Das Programm fragt diesen Dienst ab; der Zugangsschlüssel
 * bleibt im Programm (verschlüsselt) und wird nie an die Oberfläche gegeben.
 *
 * Käufe stammen zusätzlich aus der Bestell-Synchronisierung (echte Shopify-Bestellungen).
 * Aktivitätsfenster für „gerade online“: 5 Minuten.
 */

export const WINDOW_SECONDS = 300;

async function collector(pathname) {
  const url = String(getSettings().analytics.collectorUrl || '').replace(/\/+$/, '');
  if (!url) throw new UserError('Live-View-Dienst noch nicht eingerichtet (Einstellungen → Analytics).', { status: 412, code: 'collector_missing' });
  if (!/^https:\/\//.test(url) && !(process.env.APOLOGEA_TEST === '1' && /^http:\/\/127\.0\.0\.1/.test(url))) throw new UserError('Die Adresse des Live-View-Dienstes muss mit https:// beginnen.');
  const token = await getSecret('analytics.collectorToken');
  if (!token) throw new UserError('Zugangsschlüssel des Live-View-Dienstes fehlt (Einstellungen → Analytics).', { status: 412, code: 'collector_missing' });
  let res;
  try {
    res = await fetch(url + pathname, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    throw new UserError(`Live-View-Dienst nicht erreichbar (${err.name === 'TimeoutError' ? 'Zeitüberschreitung' : err.message}).`, { status: 502, code: 'collector_down' });
  }
  if (res.status === 401 || res.status === 403) throw new UserError('Der Live-View-Dienst lehnt den Zugangsschlüssel ab.', { status: 502 });
  if (!res.ok) throw new UserError(`Live-View-Dienst meldet ${res.status}.`, { status: 502 });
  return res.json();
}

function recentPurchases(minutes = 60) {
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  return store().orders.list((o) => !o.test && o.processedAt >= since)
    .sort((a, b) => b.processedAt.localeCompare(a.processedAt))
    .map((o) => ({ name: o.name, at: o.processedAt, total: o.total, currency: o.currency, items: o.lines.reduce((s, l) => s + l.quantity, 0), titles: o.lines.map((l) => l.title).slice(0, 3) }));
}

/** Momentaufnahme für Live View und die KPI-Karte „Besucher online“. */
export async function liveSnapshot() {
  const purchases = recentPurchases(60);
  try {
    const d = await collector(`/v1/live?window=${WINDOW_SECONDS}`);
    return {
      available: true,
      updatedAt: d.updatedAt || new Date().toISOString(),
      windowSeconds: d.windowSeconds || WINDOW_SECONDS,
      online: d.online ?? null,
      carts: d.carts ?? null,
      checkouts: d.checkouts ?? null,
      pixelPurchases: d.purchases ?? null,
      products: d.products || [],
      countries: d.countries || [],
      series: d.series || [],
      consentNote: d.consentNote || 'Gezählt werden nur Besucher, die der Analyse zugestimmt haben.',
      purchases,
    };
  } catch (err) {
    return { available: false, reason: errorMessage(err), code: err.code || null, purchases, updatedAt: new Date().toISOString() };
  }
}

/** Produktaufrufe im Zeitraum (nur mit Live-View-Dienst; nur zustimmende Besucher). */
export async function productViews(period) {
  const d = await collector(`/v1/views?from=${period.from}&to=${period.to}`);
  return { counts: d.counts || {}, note: 'Produktaufrufe laut Web Pixel – nur Besucher mit Einwilligung, daher niedriger als in Shopify.' };
}

/** Verbindung zum Dienst prüfen (Einstellungen). */
export async function testCollector() {
  const d = await collector('/v1/health');
  return { ok: true, version: d.version || null, events24h: d.events24h ?? null, shop: d.shop || null };
}
