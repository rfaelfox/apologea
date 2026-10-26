import * as shopify from '../integrations/shopify.js';
import { getSettings } from '../store.js';
import { errorMessage } from '../util.js';
import * as sync from './sync.js';
import { testCollector } from './live.js';
import { cloudflareInfo } from './cloudflare.js';

/**
 * Einrichtungs-Assistent: prüft jeden Schritt einzeln und echt (keine Annahmen).
 * state: 'ok' | 'todo' | 'warn' | 'blocked' (wartet auf einen früheren Schritt) | 'optional'.
 */

const storeHandle = () => String(getSettings().shop.domain || '').replace(/\.myshopify\.com$/, '');

export function links() {
  const h = storeHandle();
  return {
    devDashboard: 'https://dev.shopify.com/dashboard',
    customerEvents: `https://admin.shopify.com/store/${h}/settings/customer_events`,
    privacyPolicy: `https://admin.shopify.com/store/${h}/settings/legal`,
    cloudflareSignup: 'https://dash.cloudflare.com/sign-up',
    cloudflareTokens: 'https://dash.cloudflare.com/profile/api-tokens',
  };
}

async function protectedDataCheck() {
  try {
    await shopify.gql('{ orders(first: 1) { nodes { id } } }');
    return { ok: true };
  } catch (err) {
    const msg = errorMessage(err);
    const isProtected = /protected customer data|not approved to access|ACCESS_DENIED/i.test(msg);
    return { ok: false, protected: isProtected, error: msg };
  }
}

export async function setupStatus() {
  const s = getSettings();
  const kinds = shopify.connectionKinds();
  const steps = [];

  // 1. Shopify-App-Zugang
  let scopesOk = false;
  let perms = null;
  if (!kinds.adminApp) {
    steps.push({ id: 'app', state: 'todo', detail: 'Client-ID und Client-Secret fehlen noch.' });
  } else {
    try {
      perms = await sync.permissions();
      steps.push({ id: 'app', state: 'ok', detail: 'Verbunden.' });
    } catch (err) {
      steps.push({ id: 'app', state: 'todo', detail: `Verbindung fehlgeschlagen: ${errorMessage(err)}` });
    }
  }

  // 2. Berechtigungen
  if (!perms) steps.push({ id: 'scopes', state: 'blocked', detail: 'Wartet auf Schritt 1.' });
  else if (perms.missing.length) steps.push({ id: 'scopes', state: 'todo', missing: perms.missing, detail: `Fehlt noch: ${perms.missing.join(', ')}` });
  else {
    scopesOk = true;
    steps.push({ id: 'scopes', state: perms.allOrders ? 'ok' : 'warn', detail: perms.allOrders ? 'Alle Berechtigungen vorhanden (inkl. ältere Bestellungen).' : 'Vorhanden. Ohne read_all_orders sieht das Studio nur die letzten 60 Tage.' });
  }

  // 3. Geschützte Kundendaten
  let ordersOk = false;
  if (!scopesOk) steps.push({ id: 'protected', state: 'blocked', detail: 'Wartet auf Schritt 2.' });
  else {
    const p = await protectedDataCheck();
    ordersOk = p.ok;
    steps.push({ id: 'protected', state: p.ok ? 'ok' : 'todo', detail: p.ok ? 'Bestellungen dürfen gelesen werden.' : (p.protected ? 'Shopify hat den Zugriff auf geschützte Kundendaten noch nicht freigegeben.' : p.error) });
  }

  // 4. Erster Abgleich
  const m = sync.meta();
  if (!ordersOk) steps.push({ id: 'sync', state: 'blocked', detail: 'Wartet auf Schritt 3.' });
  else if (m.lastSyncAt && m.lastSyncOk !== false) steps.push({ id: 'sync', state: 'ok', detail: `${m.orderCount ?? 0} Bestellungen geladen.` });
  else steps.push({ id: 'sync', state: 'todo', detail: m.lastError ? `Letzter Versuch fehlgeschlagen: ${m.lastError}` : 'Noch nicht gestartet.' });

  // 5. Live-View-Dienst
  const cfInfo = cloudflareInfo();
  let health = null;
  if (s.analytics.collectorUrl) {
    try { health = await testCollector(); } catch (err) { health = { ok: false, error: errorMessage(err) }; }
  }
  if (health?.ok) steps.push({ id: 'live', state: cfInfo.updateAvailable ? 'warn' : 'ok', detail: cfInfo.updateAvailable ? `Läuft. Neue Dienst-Version ${cfInfo.latest} verfügbar – „Erneut einrichten“ aktualisiert.` : `Läuft: ${s.analytics.collectorUrl}` });
  else steps.push({ id: 'live', state: 'todo', detail: health ? `Eingerichtet, antwortet aber nicht: ${health.error}` : 'Noch nicht eingerichtet.' });

  // 6. Pixel im Shop
  if (!health?.ok) steps.push({ id: 'pixel', state: 'blocked', detail: 'Wartet auf Schritt 5.' });
  else if ((health.events24h || 0) > 0) steps.push({ id: 'pixel', state: 'ok', detail: `${health.events24h} Ereignisse in den letzten 24 Stunden empfangen.` });
  else steps.push({ id: 'pixel', state: 'todo', detail: 'Noch keine Besucher-Ereignisse empfangen. Pixel einfügen und danach den Shop einmal selbst besuchen (Cookies erlauben).' });

  // 7. Kosten & Gebühren
  const a = s.analytics;
  const hasFees = a.fees?.percent != null;
  const hasPod = a.podShippingPerOrder != null || Object.keys(a.productCosts || {}).length > 0;
  steps.push({ id: 'costs', state: hasFees && hasPod ? 'ok' : 'optional', detail: hasFees && hasPod ? 'Gebühren und Kosten hinterlegt.' : `Empfohlen: ${[!hasFees ? 'Zahlungsgebühren' : null, !hasPod ? 'POD-Versand oder Stückkosten' : null].filter(Boolean).join(', ')} eintragen – sonst ist der Gewinn nur „vorläufig“.` });

  const required = steps.filter((x) => !['costs'].includes(x.id));
  return {
    steps,
    done: required.filter((x) => x.state === 'ok' || x.state === 'warn').length,
    total: required.length,
    links: links(),
    cloudflare: cfInfo,
    shopDomain: s.shop.domain,
    checkedAt: new Date().toISOString(),
  };
}
