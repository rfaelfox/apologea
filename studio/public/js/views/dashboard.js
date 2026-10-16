import { updateBanner } from './update.js';
import { h, clear, svg, ICONS, get, post, badge, fmtDate, showError, ornament, extLink } from '../core.js';

export async function renderDashboard(main) {
  const connBox = h('div.grid.cols-3', h('div.card', h('span.muted', 'Verbindungen werden geprüft …')));
  const lists = h('div');
  const updBox = h('div');
  clear(main,
    updBox,
    h('div.page-head', h('div', h('div.eyebrow', 'Arbeitsoberfläche'), h('h1', 'Willkommen im Atelier')), h('img', { src: '/brand/emblem-29.svg', alt: '', style: { width: '64px', opacity: '.9' } })),
    h('div.hero-actions',
      h('a.hero-btn', { href: '#/website?neu' , onclick: (e) => { e.preventDefault(); newWebsiteDraft(); } },
        glyph(ICONS.web),
        h('span.title', 'Website bearbeiten'),
        h('span.sub', 'Texte, Bilder, Farben oder Seiten deines bestehenden Shops ändern – mit Vorschau und Freigabe.')),
      h('a.hero-btn', { href: '#/produkte', onclick: (e) => { e.preventDefault(); newProduct(); } },
        glyph(ICONS.shirt),
        h('span.title', 'Neues Produkt erstellen'),
        h('span.sub', 'Motiv wählen, MarketPrint-Artikel einrichten, prüfen und nach deiner Freigabe veröffentlichen.'))),
    h('section.section', h('h2', 'Verbindungen'), connBox),
    lists);

  loadConnections(connBox);
  updateBanner(updBox);
  try {
    const d = await get('/api/dashboard');
    clear(lists,
      d.needsCheck.length ? h('section.section', h('h2', 'Ergebnis prüfen'), h('div.inline-msg.warn', 'Bei diesen Vorgängen ist das Ergebnis unklar (z. B. Verbindungsabbruch). Bitte öffnen und den tatsächlichen Stand prüfen, bevor erneut ausgeführt wird.'), table(d.needsCheck.map(toRow))) : null,
      h('div.grid.cols-2',
        h('section.section', h('h2', 'Offene Entwürfe'),
          d.openProducts.length + d.openWebsite.length ? table([...d.openWebsite.map(toRow), ...d.openProducts.map(toRow)]) : h('div.empty', 'Keine offenen Entwürfe.')),
        h('section.section', h('h2', 'Zuletzt bearbeitete Produkte'),
          d.recentProducts.length ? table(d.recentProducts.map(toRow)) : h('div.empty', 'Noch keine Produkte angelegt.'))),
      ornament(),
      h('section.section', h('h2', 'Letzte Aufträge'),
        d.jobs.length ? table(d.jobs.map((j) => ({ title: j.title, status: j.status, simulated: j.simulated, at: j.updatedAt, href: j.refType === 'product' ? `#/produkte/${j.refId}` : j.refType === 'website' ? `#/website/${j.refId}` : '#/verlauf' }))) : h('div.empty', 'Noch keine Aufträge.')));
  } catch (err) { showError(err); }
}

function glyph(markup) {
  const g = svg(markup);
  g.classList.add('glyph');
  g.setAttribute('stroke', 'currentColor');
  return g;
}

function toRow(x) {
  const isProduct = x.id?.startsWith('p_');
  return {
    title: isProduct ? (x.internalName || x.publicTitle || 'Produktentwurf') : (x.title || 'Website-Änderung'),
    kind: isProduct ? 'Produkt' : 'Website',
    status: x.status,
    simulated: x.publish?.result?.simulated,
    at: x.updatedAt,
    href: isProduct ? `#/produkte/${x.id}` : `#/website/${x.id}`,
  };
}

function table(rows) {
  return h('div.table-wrap', h('table.list',
    h('tbody', rows.map((r) => {
      const tr = h('tr.click', h('td', h('div', r.title), r.kind ? h('small', r.kind) : null), h('td', badge(r.status, { simulated: r.simulated })), h('td.muted', fmtDate(r.at)));
      tr.addEventListener('click', () => { location.hash = r.href; });
      return tr;
    }))));
}

async function newWebsiteDraft() {
  try { const d = await post('/api/website/drafts', {}); location.hash = `#/website/${d.id}`; } catch (err) { showError(err); }
}

async function newProduct() {
  location.hash = '#/produkte?neu=1';
}

export async function loadConnections(box) {
  try {
    const s = await get('/api/status/connections');
    const shop = s.shopify;
    const mpS = s.marketprint;
    const aiS = s.ai;
    clear(box,
      conn('Shopify', shop.ok ? 'ok' : shop.configured === false ? 'none' : 'err',
        shop.ok ? [
          shop.themeAccess?.ok ? `Themes: verbunden (${shop.themeAccess.shop})` : 'Themes: über Admin-App',
          shop.canContent ? 'Shop-Inhalte: verbunden (Admin-App)' : 'Shop-Inhalte: nicht verbunden (Admin-App fehlt)',
        ] : [shop.error || shop.themeAccess?.error || shop.adminApp?.error || 'Nicht eingerichtet']),
      Object.entries(s.providers || {}).filter(([pid, p]) => pid === 'marketprint' || p.mode !== 'none').map(([, p]) => conn(p.name, p.ok ? (p.simulated ? 'warn' : 'ok') : p.mode === 'none' ? 'none' : 'err',
        p.ok ? [modeLabel(p.mode), p.simulated ? 'SIMULATION – es wird nichts angelegt' : `Konto: ${p.account?.email || p.account?.label || '–'}`, `Shops: ${(p.account?.targets || []).map((t) => t.label).join(', ') || '–'}`] : p.mode === 'none' ? ['Nicht eingerichtet'] : [modeLabel(p.mode), p.error || p.message])),
      conn('Claude', aiS.ok ? 'ok' : aiS.engine === 'none' ? 'none' : 'err',
        [aiS.message || '', aiS.engine === 'api' ? 'Nutzungsabhängige Kosten – vor jedem Aufruf mit Kostenschätzung' : aiS.engine === 'claude-code' ? 'Zählt zu deinem Claude-Kontingent' : 'Texte und Website-Vorschläge benötigen Claude']),
    );
    box.append(h('div', { style: { gridColumn: '1 / -1' } }, h('small.muted', `Stand: ${fmtDate(s.checkedAt)} · `), h('a', { href: '#/einstellungen' }, 'Verbindungen einrichten')));
  } catch (err) {
    clear(box, h('div.inline-msg.error', 'Status konnte nicht ermittelt werden: ' + err.message));
  }
}

function modeLabel(m) {
  return { 'claude-code': 'Weg: über Claude Code', mcp: 'Weg: direkte MCP-Verbindung', api: 'Weg: offizielle Schnittstelle', simulation: 'Weg: Simulation', none: 'Nicht eingerichtet' }[m] || m;
}

function conn(name, state, lines) {
  const cls = state === 'ok' ? 'ok' : state === 'err' ? 'err' : state === 'warn' ? 'warn' : '';
  return h('div.card', h('div.conn', h(`span.dot${cls ? '.' + cls : ''}`), h('div', h('h3', name), lines.filter(Boolean).map((l) => h('div.muted', l)))));
}

export { extLink };
