// APOLOGEA – Shopify Custom Pixel für die Live View im APOLOGEA Studio
// Einfügen unter: Shopify-Admin → Einstellungen → Kundenereignisse → Benutzerdefiniertes Pixel hinzufügen.
// Pixel-Einstellungen dort: Berechtigung „Erforderlich“ → „Analyse“; Datenverkauf → „Erfasste Daten gelten nicht als Datenverkauf“.
// So lädt Shopify das Pixel nur für Besucher, die der Analyse zugestimmt haben. Zusätzlich prüft der Code selbst.

const ENDPOINT = 'https://HIER-DEINE-WORKER-ADRESSE.workers.dev/v1/e'; // aus der Einrichtung (README.md)
const SHOP = 'dfz1mp-1u.myshopify.com';

let allowed = Boolean(init?.customerPrivacy?.analyticsProcessingAllowed);
customerPrivacy.subscribe('visitorConsentCollected', (e) => { allowed = Boolean(e?.customerPrivacy?.analyticsProcessingAllowed); });

function send(name, event, extra = {}) {
  if (!allowed) return; // keine Einwilligung → nichts senden
  const body = {
    name,
    shop: SHOP,
    consent: true,
    ts: Date.parse(event.timestamp) || Date.now(),
    clientId: event.clientId, // wird im Dienst nur gehasht (Tagessalz) gespeichert
    path: event.context?.document?.location?.pathname || null,
    ...extra,
  };
  fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => {});
}

const gid = (id) => (id ? (String(id).startsWith('gid://') ? String(id) : `gid://shopify/Product/${id}`) : null);

analytics.subscribe('page_viewed', (event) => send('page_viewed', event));
analytics.subscribe('product_viewed', (event) => {
  const p = event.data?.productVariant?.product;
  send('product_viewed', event, { productId: gid(p?.id), productTitle: p?.title || null });
});
analytics.subscribe('product_added_to_cart', (event) => {
  const p = event.data?.cartLine?.merchandise?.product;
  send('product_added_to_cart', event, { productId: gid(p?.id), productTitle: p?.title || null });
});
analytics.subscribe('checkout_started', (event) => send('checkout_started', event));
analytics.subscribe('checkout_completed', (event) => send('checkout_completed', event));
