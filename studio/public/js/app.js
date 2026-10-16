import { h, clear, svg, ICONS, get, post, showError, toast, confirmDialog } from './core.js';
import { renderDashboard } from './views/dashboard.js';
import { renderWebsiteList, renderWebsiteDraft } from './views/website.js';
import { renderSiteEditor } from './views/siteEditor.js';
import { renderAnalytics } from './views/analytics.js';
import { renderProductList, renderProductEditor } from './views/products.js';
import { renderLibrary } from './views/library.js';
import { renderHistory } from './views/history.js';
import { renderSettings } from './views/settings.js';

export const state = { boot: null };

const NAV = [
  { href: '#/', label: 'Dashboard', icon: 'home', match: /^#\/?$/ },
  { href: '#/analytics', label: 'Analytics', icon: 'analytics', match: /^#\/analytics/ },
  { href: '#/website', label: 'Website', icon: 'web', match: /^#\/website/ },
  { href: '#/produkte', label: 'Produkte', icon: 'shirt', match: /^#\/produkte/ },
  { href: '#/bibliothek', label: 'Designbibliothek', icon: 'library', match: /^#\/bibliothek/ },
  { href: '#/verlauf', label: 'Aufträge & Verlauf', icon: 'history', match: /^#\/verlauf/ },
  { href: '#/einstellungen', label: 'Einstellungen', icon: 'settings', match: /^#\/einstellungen/ },
];

let main;
let nav;
let cleanup = null;

export function setCleanup(fn) { cleanup = fn; }

function brand() {
  // Logo Nr. 29 (Original der Marke, als SVG); eine eigene Datei aus den Einstellungen hat Vorrang.
  const logo = state.boot?.logo ? state.boot.logo + '?v=' + Date.now() : '/brand/logo-29.svg';
  return h('a.brand', { href: '#/' },
    h('img', { src: logo, alt: 'APOLOGEA' }),
    h('span.wordmark-sub', 'Studio'));
}

// ---- Benachrichtigungen (neue Verkäufe, Ziele, Erstattungen, Sync-Fehler) – dezent, einmal je Meldung
let unreadNotices = 0;
const shownNotices = new Set();
async function pollNotices(first = false) {
  try {
    const list = await get('/api/analytics/notices');
    const unread = list.filter((n) => !n.read);
    unreadNotices = unread.length;
    for (const n of unread.slice(0, 5).reverse()) {
      if (shownNotices.has(n.id)) continue;
      shownNotices.add(n.id);
      if (first) continue; // beim Start nicht alle alten Meldungen aufpoppen lassen
      toast(`${n.title}${n.text ? ' – ' + n.text : ''}`, n.kind === 'error' ? 'error' : 'ok', 9000);
      try { if ('Notification' in window && Notification.permission === 'granted') new Notification(`APOLOGEA · ${n.title}`, { body: n.text || '', icon: '/icon.svg', silent: true }); } catch { /* ohne Systembenachrichtigung */ }
    }
    renderNav();
  } catch { /* Analytics nicht eingerichtet */ }
}
setTimeout(() => { pollNotices(true); setInterval(() => pollNotices(false), 60_000); }, 2000);

export function renderNav() {
  clear(nav,
    brand(),
    NAV.map((n) => {
      const a = h('a.item', { href: n.href }, svg(ICONS[n.icon]), n.label, n.icon === 'analytics' && unreadNotices ? h('span.nav-badge', { title: 'Neue Benachrichtigungen' }, String(unreadNotices)) : null);
      if (n.match.test(location.hash || '#/')) a.classList.add('active');
      a.addEventListener('click', () => nav.classList.remove('open'));
      return a;
    }),
    h('div.spacer'),
    h('div.foot',
      h('div', `Version ${state.boot?.version || ''}`),
      h('button.small', { type: 'button', onclick: quit }, 'Programm beenden')));
}

async function quit() {
  const ok = await confirmDialog({ title: 'Programm beenden?', text: 'Offene Eingaben sind bereits automatisch gespeichert. Laufende Vorgänge sollten vorher abgeschlossen sein.', confirmLabel: 'Beenden' });
  if (!ok) return;
  await post('/api/quit').catch(() => {});
  clear(document.getElementById('app'), h('div.main', h('div.frame', { style: { maxWidth: '560px', margin: '15vh auto' } }, h('h2', 'APOLOGEA Studio wurde beendet'), h('p', 'Du kannst dieses Fenster schließen. Neu starten über die Verknüpfung auf dem Desktop.'))));
  setTimeout(() => window.close(), 800);
}

async function route() {
  if (cleanup) { try { await cleanup(); } catch { /* ignorieren */ } cleanup = null; }
  const hash = location.hash || '#/';
  renderNav();
  const [pathPart, queryPart = ''] = hash.replace(/^#\/?/, '').split('?');
  const parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  const query = Object.fromEntries(new URLSearchParams(queryPart));
  clear(main, h('div.muted', 'Lädt …'));
  try {
    if (!parts.length) await renderDashboard(main);
    else if (parts[0] === 'analytics') await renderAnalytics(main, parts[1] || 'uebersicht', query);
    else if (parts[0] === 'website' && parts[1] === 'liste') await renderWebsiteList(main);
    else if (parts[0] === 'website' && parts[1]) await renderWebsiteDraft(main, parts[1], query);
    else if (parts[0] === 'website') await renderSiteEditor(main, query);
    else if (parts[0] === 'produkte' && parts[1]) await renderProductEditor(main, parts[1]);
    else if (parts[0] === 'produkte') await renderProductList(main, query);
    else if (parts[0] === 'bibliothek') await renderLibrary(main, parts[1]);
    else if (parts[0] === 'verlauf') await renderHistory(main);
    else if (parts[0] === 'einstellungen') await renderSettings(main, parts[1]);
    else clear(main, h('div.empty', 'Seite nicht gefunden.'));
  } catch (err) {
    clear(main, h('div.frame', h('h2', 'Fehler'), h('p', err.message)));
    showError(err);
  }
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

export async function reloadBoot() {
  state.boot = await get('/api/bootstrap');
  renderNav();
  return state.boot;
}

async function init() {
  const root = document.getElementById('app');
  nav = h('nav.nav', { 'aria-label': 'Hauptnavigation' });
  main = h('main.main', { tabindex: -1 });
  const toggle = h('button.menu-toggle.icon-btn', { type: 'button', 'aria-label': 'Menü', onclick: () => nav.classList.toggle('open') }, svg(ICONS.menu));
  clear(root, toggle, h('div.shell', nav, main));
  try { await reloadBoot(); } catch (err) { showError(err); }
  window.addEventListener('hashchange', route);
  await route();
  // Lebenszeichen an den lokalen Dienst (beendet sich, wenn kein Fenster mehr offen ist).
  const beat = () => post('/api/heartbeat').catch(() => {});
  beat();
  setInterval(beat, 30_000);
  if (state.boot && !state.boot.settings.ui.onboardingDone) toast('Willkommen! Unter „Einstellungen“ verbindest du Shopify, MarketPrint und Claude.', 'info', 9000);
}

init();
