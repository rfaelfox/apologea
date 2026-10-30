/* APOLOGEA Handy-App – Oberfläche */
'use strict';

const VERSION = '1.7.0';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s == null ? '' : s).toLocaleLowerCase('de').normalize('NFD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss');
const prefs = {
  get(k, d) { try { const v = localStorage.getItem('apologea.ui.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('apologea.ui.' + k, JSON.stringify(v)); } catch (e) { /* nur Komfort */ } }
};
const BROWSER_IMG = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic', 'heif'];

const I = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  template: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M4 16V5.5A1.5 1.5 0 0 1 5.5 4H16"/><path d="M14 11v6M11 14h6"/>',
  share: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5z"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
  folder: '<path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5v9.3a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><circle cx="9" cy="10" r="1.8"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/>',
  camera: '<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  file: '<path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20z"/><path d="M14 3.5V8h4"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  sort: '<path d="M7 4v16M3.5 16.5L7 20l3.5-3.5M17 20V4M13.5 7.5L17 4l3.5 3.5"/>',
  logout: '<path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5"/><path d="M10 16l-4-4 4-4M6 12h10"/>',
  swap: '<path d="M7 7h12M15 3l4 4-4 4M17 17H5M9 13l-4 4 4 4"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  restore: '<path d="M4 12a8 8 0 1 0 2.5-5.8L4 8.5"/><path d="M4 4v4.5h4.5"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  import: '<path d="M12 3v11M7.5 9.5L12 14l4.5-4.5"/><path d="M4 14v4.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V14"/>'
};
const icon = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;

const S = {
  demo: new URLSearchParams(location.search).has('demo'),
  filter: { q: '', cat: '', status: '', zg: '' },
  sort: prefs.get('sort', 'nummer-auf'),
  cardImg: prefs.get('cardImg', 'mockup'),
  designBg: prefs.get('designBg', 'dunkel'),
  visible: [],
  detail: null,
  form: null,
  imp: false,
  syncing: false,
  lastSync: 0,
  user: ''
};
const M = () => Store.model;

// ================================================================ Hinweise, Blätter, Warten
function toast(msg, kind, opts) {
  opts = opts || {};
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.innerHTML = `<div class="msg">${opts.title ? '<b>' + esc(opts.title) + '</b>' : ''}${esc(msg)}</div><button aria-label="Schließen">×</button>`;
  const rm = () => { el.remove(); };
  el.lastElementChild.onclick = rm;
  $('#toasts').appendChild(el);
  setTimeout(rm, opts.ms || (kind === 'err' ? 9000 : 4500));
}
function fail(e, title) {
  if (e && (e.code === 'login_required' || e.status === 401)) { toast('Bitte erneut anmelden.', 'err'); renderLogin(); return; }
  toast(e && e.message ? e.message : String(e), 'err', { title: title || 'Das hat nicht geklappt' });
}

function sheet(opts) {
  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'sheet-back';
    back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grip"></div>
      ${opts.title ? `<div class="sheet-head"><h2>${esc(opts.title)}</h2></div>` : ''}
      <div class="sheet-body"></div>${opts.buttons ? '<div class="sheet-foot"></div>' : ''}</div>`;
    const body = $('.sheet-body', back);
    if (typeof opts.body === 'string') body.innerHTML = opts.body; else if (opts.body) body.appendChild(opts.body);
    let done = false;
    const close = v => { if (done) return; done = true; back.remove(); resolve(v); };
    back._close = close;
    back.addEventListener('click', e => { if (e.target === back) close(null); });
    (opts.buttons || []).forEach(b => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.cls || '');
      btn.textContent = b.label;
      btn.onclick = async () => { if (b.run) { const keep = await b.run(back); if (keep === false) return; } close(b.value); };
      $('.sheet-foot', back).appendChild(btn);
    });
    $('#layer').appendChild(back);
    if (opts.onOpen) opts.onOpen(back, close);
  });
}
const confirmSheet = (title, text, ok, danger) => sheet({ title, body: `<p>${text}</p>`, buttons: [{ label: 'Abbrechen', value: false }, { label: ok, cls: danger ? 'danger' : 'primary', value: true }] }).then(v => !!v);
function choose(title, options) {
  const body = document.createElement('div');
  body.innerHTML = options.map((o, i) => `<button class="menu-item" data-i="${i}">${o.icon ? icon(o.icon) : ''}<span>${esc(o.label)}</span>${o.sub ? `<span class="sub">${esc(o.sub)}</span>` : ''}</button>`).join('');
  return sheet({ title, body, onOpen: (back, close) => body.onclick = e => { const b = e.target.closest('[data-i]'); if (b) close(options[+b.dataset.i].value); } });
}
function askText(title, label, hint) {
  let val = null;
  return sheet({
    title,
    body: `<div class="field"><label for="ask">${esc(label)}</label><input id="ask" class="input" maxlength="60" autocomplete="off">${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</div>`,
    buttons: [{ label: 'Abbrechen' }, { label: 'Übernehmen', cls: 'primary', run: b => { val = $('#ask', b).value.trim(); } }],
    onOpen: b => setTimeout(() => $('#ask', b).focus(), 250)
  }).then(() => val);
}
let busyEl = null;
function busy(text) {
  if (!busyEl) { busyEl = document.createElement('div'); busyEl.className = 'busy-layer'; document.body.appendChild(busyEl); }
  busyEl.innerHTML = `<div class="busy-box"><div class="spinner"></div><div>${esc(text || 'Bitte warten …')}</div></div>`;
}
function unbusy() { if (busyEl) { busyEl.remove(); busyEl = null; } }

// ================================================================ Start und Anmeldung
async function boot() {
  if ('serviceWorker' in navigator && !S.demo && location.protocol === 'https:') {
    // Kommt eine neue App-Version an, einmal neu laden, damit sie sofort sichtbar ist
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded && !S.form && !S.imp) { reloaded = true; location.reload(); } });
    navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => {});
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - S.lastSync > 20000 && !S.form && !S.imp && Store.drive) sync(true); });
  if (S.demo) { await openCollection(DemoDrive, 'Sammlung'); return; }
  if (!Auth.configured()) { renderSetupMissing(); return; }
  try { await Auth.handleRedirect(); }
  catch (e) { renderLogin(e.message); return; }
  if (!Auth.signedIn()) { renderLogin(); return; }
  const savedRoot = prefs.get('rootId', null);
  try {
    if (savedRoot) await openCollection(GraphDrive, null, savedRoot);
    else await openCollection(GraphDrive, window.APOLOGEA_CONFIG.sammlungPfad);
  } catch (e) {
    if (e.code === 'login_required' || e.status === 401) { renderLogin(); return; }
    if (e.status === 404) { prefs.set('rootId', null); renderFolderPicker('Der Sammlungsordner wurde unter dem vorgeschlagenen Pfad nicht gefunden. Bitte den Ordner „Sammlung“ auswählen.'); return; }
    if (e.code === 'offline') { renderFatal('Keine Internetverbindung. Beim ersten Start wird eine Verbindung benötigt.'); return; }
    renderFatal(e.message);
  }
}

function renderFatal(msg) {
  $('#app').innerHTML = `<div class="center-screen"><div class="wordmark big">APOLOGEA</div><div class="ornament-line short"></div><p>${esc(msg)}</p><button class="btn gold" id="retry">Erneut versuchen</button></div>`;
  $('#retry').onclick = () => location.reload();
}

function renderSetupMissing() {
  $('#app').innerHTML = `<div class="center-screen"><div class="wordmark big">APOLOGEA</div><div class="ornament-line short"></div>
    <p>Die App ist noch nicht mit Microsoft verbunden. Bitte in der Datei <span class="mono">config.js</span> die Anwendungs-ID (Client-ID) eintragen – siehe Einrichtungsanleitung.</p>
    <a class="btn gold" href="?demo">Demo ansehen (ohne OneDrive)</a></div>`;
}

function renderLogin(err) {
  $('#layer').innerHTML = '';
  $('#app').innerHTML = `<div class="center-screen"><div class="wordmark big">APOLOGEA</div><div class="ornament-line short"></div>
    <p class="muted">Kollektion · unterwegs</p>
    <p>Melden Sie sich mit dem Microsoft-Konto an, in dessen OneDrive Ihre Sammlung liegt. Die Anmeldung erfolgt direkt bei Microsoft; die App erhält nur Zugriff auf Ihre OneDrive-Dateien.</p>
    ${err ? `<p style="color:var(--danger)">${esc(err)}</p>` : ''}
    <button class="btn primary" id="login">Mit Microsoft anmelden</button></div>`;
  $('#login').onclick = () => Auth.login().catch(fail);
}

async function openCollection(drive, path, id) {
  busy('Sammlung wird geöffnet …');
  try {
    const info = await Store.open(drive, path, id);
    if (drive.kind === 'onedrive') prefs.set('rootId', info.id);
    const cached = await Store.fromCache();
    unbusy();
    renderCatalog();
    if (!cached) busy('Sammlung wird zum ersten Mal geladen … (' + (drive.kind === 'demo' ? 'Demo' : 'OneDrive') + ')');
    await sync(true);
    unbusy();
    drive.me().then(n => { S.user = n; }).catch(() => {});
    Store.cleanupStaging().catch(() => {});
    if (typeof checkImportResume === 'function') checkImportResume().catch(() => {});
  } catch (e) { unbusy(); throw e; }
}

async function sync(silent) {
  if (S.syncing) return;
  S.syncing = true; S.lastSync = Date.now();
  setSyncDot('busy');
  try {
    const before = M().pieces.length;
    const r = await Store.refresh();
    setSyncDot('');
    rerender();
    if (!silent) toast(`${M().pieces.length} Pieces aktuell.`, 'ok');
    else if (!r.full && r.changed) toast('Änderungen aus OneDrive übernommen.', '', { ms: 2500 });
    void before;
  } catch (e) {
    setSyncDot('err');
    if (!silent || e.code === 'login_required') fail(e, 'Abgleich mit OneDrive nicht möglich');
  } finally { S.syncing = false; }
}
function setSyncDot(c) { const d = $('#syncdot'); if (d) d.className = 'sync-dot ' + c; }
function rerender() {
  renderStart(false);
  renderChips();
  if (!$('#coll-view')) renderGrid();
  if (typeof Coll !== 'undefined') Coll.refresh();
  if (S.detail && !S.form && !$('.viewer')) {
    const p = M().pieces.find(x => x.key === S.detail);
    if (p) openDetail(p.key, true); else closeDetail();
  }
}

// ================================================================ Sammlungsordner wählen
async function renderFolderPicker(msg) {
  let stack = [{ id: null, name: 'OneDrive' }];
  const body = document.createElement('div');
  async function show() {
    const cur = stack[stack.length - 1];
    body.innerHTML = `${msg ? `<p class="hint warn">${esc(msg)}</p>` : ''}<div class="crumbs">${stack.map(s => esc(s.name)).join(' / ')}</div><div class="spinner"></div>`;
    let kids;
    try { kids = (await GraphDrive.listChildren(cur.id)).filter(k => k.isFolder).sort((a, b) => a.name.localeCompare(b.name, 'de')); }
    catch (e) { fail(e); return; }
    body.innerHTML = `${msg ? `<p class="hint warn">${esc(msg)}</p>` : ''}<div class="crumbs">${stack.map(s => esc(s.name)).join(' / ')}</div>
      ${stack.length > 1 ? `<button class="picker-row" data-up>${icon('back')}Eine Ebene zurück</button>` : ''}
      ${kids.map(k => `<button class="picker-row" data-id="${k.id}" data-name="${esc(k.name)}">${icon('folder')}<span style="flex:1">${esc(k.name)}</span>${icon('chevron')}</button>`).join('') || '<p class="faint">Keine Unterordner.</p>'}
      ${stack.length > 1 ? `<button class="btn primary block" data-use style="margin-top:14px">Diesen Ordner als Sammlung verwenden</button>` : ''}`;
  }
  body.addEventListener('click', async e => {
    const r = e.target.closest('[data-id]');
    if (r) { stack.push({ id: r.dataset.id, name: r.dataset.name }); show(); return; }
    if (e.target.closest('[data-up]')) { stack.pop(); show(); return; }
    if (e.target.closest('[data-use]')) {
      const cur = stack[stack.length - 1];
      const ok = await GraphDrive.hasCollectionMarker(cur.id);
      if (!ok && !(await confirmSheet('Kein APOLOGEA-Ordner?', `Im Ordner „${esc(cur.name)}“ wurde keine APOLOGEA-Sammlung erkannt (es fehlt der Unterordner „.apologea“). Normalerweise heißt der richtige Ordner „Sammlung“. Trotzdem verwenden?`, 'Trotzdem verwenden'))) return;
      $('#layer').innerHTML = '';
      try { await openCollection(GraphDrive, null, cur.id); } catch (er) { fail(er); }
    }
  });
  $('#app').innerHTML = '<div class="center-screen"><div class="wordmark big">APOLOGEA</div><div class="ornament-line short"></div></div>';
  sheet({ title: 'Sammlungsordner wählen', body });
  show();
}

// ================================================================ Katalog
function renderCatalog() {
  $('#app').innerHTML = `
    <header class="topbar">
      <div class="topbar-row">
        <button class="wordmark wm-btn" id="b-start" title="Startseite">APOLOGEA</button>
        <button class="btn ghost icon" id="b-sync" aria-label="Aktualisieren"><span class="sync-dot" id="syncdot"></span>${icon('refresh')}</button>
        <button class="btn ghost icon" id="b-import" aria-label="Pieces importieren" title="Pieces importieren (ZIP, Ordner)">${icon('import')}</button>
        <button class="btn ghost icon" id="b-menu" aria-label="Menü">${icon('menu')}</button>
      </div>
      <div class="search">${icon('search')}<input class="input" id="q" type="search" placeholder="Name, Nummer, Beschreibung …" autocomplete="off" enterkeyhint="search" value="${esc(S.filter.q)}"></div>
      <div class="cats" id="cats"></div>
      <div class="cats zgs" id="zgs"></div>
      <div class="ornament-line"></div>
    </header>
    <div class="countline"><span id="count"></span><button class="btn ghost small" id="b-sort">${icon('sort')}<span id="sortlabel"></span></button></div>
    <div id="notice"></div>
    <main class="grid" id="grid"></main>
    <button class="fab" id="b-new">${icon('plus')}Neues Piece</button>
    ${S.demo ? '<div style="position:fixed;left:12px;bottom:calc(26px + var(--safe-b));z-index:6" class="badge entwurf">Demo-Modus</div>' : ''}`;
  $('#b-sync').onclick = () => sync(false);
  $('#b-start').onclick = () => renderStart(true);
  $('#b-menu').onclick = openMenu;
  $('#b-import').onclick = openImport;
  $('#b-new').onclick = () => openForm('neu');
  $('#b-sort').onclick = openSort;
  let t;
  $('#q').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { S.filter.q = e.target.value; renderGrid(); }, 150); });
  $('#q').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
  $('#cats').onclick = e => { const b = e.target.closest('[data-cat]'); if (!b) return; S.filter.cat = b.dataset.cat; renderChips(); renderGrid(); window.scrollTo(0, 0); };
  $('#zgs').onclick = e => { const b = e.target.closest('[data-zg]'); if (!b) return; S.filter.zg = b.dataset.zg; renderChips(); renderGrid(); window.scrollTo(0, 0); };
  $('#grid').onclick = e => { const c = e.target.closest('.card'); if (c) openDetail(c.dataset.key); };
  renderChips(); renderGrid();
  if (!S.started) renderStart(true);
}

// ---------------------------------------------------------------- Startseite: Alle · Mann · Frau · Unisex
function renderStart(show) {
  let el = $('#start');
  if (!el && !show) return;
  if (!el) { el = document.createElement('div'); el.id = 'start'; el.className = 'start'; $('#app').appendChild(el); }
  const ps = M().pieces, n = v => ps.filter(p => ZG.matches(p.zielgruppe, v)).length, open = n('offen');
  el.innerHTML = `<div class="start-inner">
    <img class="start-emblem" src="catalog/emblem.svg" alt="">
    <div class="wordmark big">APOLOGEA</div>
    <div class="start-sub">Kollektion</div>
    <div class="start-grid">${[['', 'Alle Pieces'], ['mann', 'Mann'], ['frau', 'Frau'], ['unisex', 'Unisex']].map(([v, l]) => `<button class="start-btn" data-zg="${v}"><span>${l}</span><b>${n(v)}</b></button>`).join('')}</div>
    ${open && ps.length ? `<button class="start-open" id="st-open">${open} ${open === 1 ? 'Piece ist' : 'Pieces sind'} noch nicht zugeordnet – jetzt zuordnen</button>` : ''}
  </div>`;
  el.onclick = e => {
    if (e.target.closest('#st-open')) { S.started = true; el.remove(); openZgAssign(); return; }
    const b = e.target.closest('.start-btn'); if (!b) return;
    S.started = true; S.filter.zg = b.dataset.zg; S.filter.cat = ''; el.remove(); renderChips(); renderGrid(); window.scrollTo(0, 0);
  };
}

const SORTS = { 'nummer-auf': 'Nummer ↑', 'nummer-ab': 'Nummer ↓', 'name-auf': 'Name A–Z', 'erstellt-neu': 'Neueste zuerst', 'geaendert-neu': 'Zuletzt geändert' };

function renderChips() {
  const el = $('#cats');
  if (!el) return;
  const ps = M().pieces;
  el.innerHTML = `<button class="cat ${!S.filter.cat ? 'on' : ''}" data-cat="">Alle<b>${ps.length}</b></button>` +
    M().categories.map(c => `<button class="cat ${S.filter.cat === c.name ? 'on' : ''}" data-cat="${esc(c.name)}">${esc(c.name)}<b>${c.anzahl}</b></button>`).join('');
  const z = $('#zgs');
  if (z) z.innerHTML = ZG.FILTERS.map(([v, l]) => { const k = ps.filter(p => ZG.matches(p.zielgruppe, v)).length; return v === 'offen' && !k ? '' : `<button class="cat zg ${S.filter.zg === v ? 'on' : ''}" data-zg="${v}">${l}<b>${k}</b></button>`; }).join('');
  const n = $('#notice');
  const probs = ps.filter(p => p.probleme.some(x => !/^Kein Bild für/.test(x) || p.status === 'Vollständig')).length;
  if (n) n.innerHTML = S.filter.status ? `<div class="notice">Filter: ${esc({ vollstaendig: 'Vollständig', entwurf: 'Entwürfe', unvollstaendig: 'Unvollständig', hinweise: 'Mit Hinweisen' }[S.filter.status])} · <u id="clrstat">aufheben</u></div>`
    : probs ? `<div class="notice" id="probnote">${probs} Piece${probs > 1 ? 's' : ''} mit Hinweisen (z. B. fehlende Bilder) – antippen zum Anzeigen</div>` : '';
  const c = $('#clrstat'); if (c) c.onclick = () => { S.filter.status = ''; renderChips(); renderGrid(); };
  const pn = $('#probnote'); if (pn) pn.onclick = () => { S.filter.status = 'hinweise'; renderChips(); renderGrid(); };
}

function realProblems(p) { return p.probleme.filter(x => !/^Kein Bild für/.test(x) || p.status === 'Vollständig'); }

function filtered() {
  const terms = norm(S.filter.q).split(/\s+/).filter(Boolean);
  const st = S.filter.status;
  const statusOf = p => p.status === 'Entwurf' ? 'entwurf' : p.status === 'Unvollständig' ? 'unvollstaendig' : 'vollstaendig';
  let l = M().pieces.filter(p => {
    if (S.filter.cat && p.kategorie !== S.filter.cat) return false;
    if (!ZG.matches(p.zielgruppe, S.filter.zg)) return false;
    if (st && (st === 'hinweise' ? !realProblems(p).length : statusOf(p) !== st)) return false;
    if (!terms.length) return true;
    if (!p._hay) p._hay = norm([p.nummer, pad3(p.nummer), p.name, p.motivtitel, p.beschreibung, p.schlagwoerter.join(' '), p.serie, p.kategorie, p.folderName].join(' '));
    return terms.every(t => p._hay.includes(t));
  });
  const by = {
    'nummer-auf': (a, b) => a.nummer - b.nummer, 'nummer-ab': (a, b) => b.nummer - a.nummer,
    'name-auf': (a, b) => a.name.localeCompare(b.name, 'de') || a.nummer - b.nummer,
    'erstellt-neu': (a, b) => String(b.erstellt).localeCompare(String(a.erstellt)) || b.nummer - a.nummer,
    'geaendert-neu': (a, b) => String(b.geaendert).localeCompare(String(a.geaendert)) || b.nummer - a.nummer
  }[S.sort] || ((a, b) => a.nummer - b.nummer);
  l.sort(by);
  if (terms.length === 1 && /^\d+$/.test(terms[0])) { const n = +terms[0]; l.sort((a, b) => (b.nummer === n) - (a.nummer === n)); }
  return l;
}

function cardItem(p) {
  let role = S.cardImg, f = p.bilder[role] && p.bilder[role].item;
  if (!f) for (const r of ['mockup', 'design', 'kleidungsansicht']) { if (p.bilder[r] && p.bilder[r].item) { f = p.bilder[r].item; role = r; break; } }
  return { f, role };
}

function renderGrid() {
  const grid = $('#grid');
  if (!grid) return;
  const list = filtered();
  S.visible = list.map(p => p.key);
  const total = M().pieces.length;
  $('#count').innerHTML = list.length === total ? `<b>${total}</b> Pieces` : `<b>${list.length}</b> von ${total} Pieces`;
  $('#sortlabel').textContent = SORTS[S.sort] || '';
  if (!list.length) {
    grid.innerHTML = total ? '<div class="empty">Keine passenden Pieces.</div>' : '<div class="empty">Noch keine Pieces in dieser Sammlung.</div>';
    return;
  }
  grid.innerHTML = list.map(pieceCardHtml).join('');
  observeThumbs(grid);
}
function pieceCardHtml(p) {
  const { f, role } = cardItem(p);
  const missing = ROLES.filter(r => !p.bilder[r] || !p.bilder[r].item);
  const badges = [];
  if (p.status === 'Entwurf') badges.push('<span class="badge entwurf">Entwurf</span>');
  if (missing.length) badges.push(`<span class="badge fehlt">${missing.length === 3 ? 'Keine Bilder' : 'Fehlt: ' + missing.map(r => ROLE_SHORT[r]).join(', ')}</span>`);
  const isD = role === 'design';
  return `<article class="card" data-key="${p.key}">
    <div class="card-img ${isD ? 'design bg-' + S.designBg : ''}">${f ? `<img data-thumb="${f.id}" alt="">` : `<div class="missing-img">${icon('image')}Kein Bild</div>`}<div class="badges">${badges.join('')}</div></div>
    <div class="card-body"><div class="card-nr">NR. ${pad3(p.nummer)}${p.zielgruppe ? `<span class="zg-tag">${ZG.label(p.zielgruppe)}</span>` : ''}</div><div class="card-name">${esc(p.name)}</div><div class="card-sub">${esc(p.motivtitel || p.kategorie)}</div></div></article>`;
}

// ---------------------------------------------------------------- Vorschaubilder bei Bedarf laden
const thumbCache = new Map();
let thumbObs = null, thumbQueue = new Set(), thumbTimer = null;
function observeThumbs(root) {
  if (!thumbObs) thumbObs = new IntersectionObserver(entries => {
    entries.forEach(en => { if (en.isIntersecting) { thumbQueue.add(en.target); thumbObs.unobserve(en.target); } });
    clearTimeout(thumbTimer); thumbTimer = setTimeout(flushThumbs, 80);
  }, { rootMargin: '400px 0px' });
  $$('img[data-thumb]', root).forEach(img => {
    const c = thumbCache.get(img.dataset.thumb);
    if (c) { img.src = c; img.onload = () => img.classList.add('on'); if (img.complete) img.classList.add('on'); }
    else thumbObs.observe(img);
  });
}
async function flushThumbs() {
  const imgs = [...thumbQueue]; thumbQueue = new Set();
  if (!imgs.length) return;
  const ids = [...new Set(imgs.map(i => i.dataset.thumb))];
  try {
    const urls = await Store.drive.thumbUrls(ids, 'large');
    imgs.forEach(img => {
      const u = urls[img.dataset.thumb];
      if (!u) { img.replaceWith(Object.assign(document.createElement('div'), { className: 'missing-img', innerHTML: icon('image') + 'Keine Vorschau' })); return; }
      thumbCache.set(img.dataset.thumb, u);
      img.onload = () => img.classList.add('on');
      img.src = u;
    });
  } catch (e) { imgs.forEach(i => thumbQueue.add(i)); if (e.code !== 'offline') setTimeout(flushThumbs, 3000); }
}

// ================================================================ Menüs
function openSort() {
  choose('Sortierung', Object.keys(SORTS).map(k => ({ label: SORTS[k], value: k, sub: k === S.sort ? '✓' : '' }))).then(v => { if (v) { S.sort = v; prefs.set('sort', v); renderGrid(); } });
}

function openMenu() {
  const body = document.createElement('div');
  const segs = (id, opts, cur) => `<div class="seg" id="${id}">${opts.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  body.innerHTML = `
    <button class="menu-item" data-a="sync">${icon('refresh')}Jetzt aktualisieren</button>
    <button class="menu-item" data-a="coll">${icon('template')}Kollektionen<span class="sub">${typeof Coll !== 'undefined' && Coll.count ? Coll.count : ''}</span></button>
    <button class="menu-item" data-a="catalog">${icon('file')}Katalog erstellen …<span class="sub">PDF zum Teilen</span></button>
    <button class="menu-item" data-a="import">${icon('import')}Pieces importieren …<span class="sub">ZIP, Ordner</span></button>
    <button class="menu-item" data-a="zg">${icon('swap')}Mann / Frau zuordnen …<span class="sub">${M().pieces.filter(p => !p.zielgruppe).length ? M().pieces.filter(p => !p.zielgruppe).length + ' offen' : 'alle zugeordnet'}</span></button>
    <button class="menu-item" data-a="newcat">${icon('plus')}Neuer Kleidungstyp …</button>
    <button class="menu-item" data-a="status">${icon('shield')}Nach Status filtern<span class="sub">${esc({ '': 'Alle', vollstaendig: 'Vollständig', entwurf: 'Entwürfe', unvollstaendig: 'Unvollständig', hinweise: 'Mit Hinweisen' }[S.filter.status])}</span></button>
    <button class="menu-item" data-a="check">${icon('warn')}Sammlung prüfen</button>
    <button class="menu-item" data-a="trash">${icon('trash')}Papierkorb<span class="sub">${M().trash.length}</span></button>
    <div class="section-title">Darstellung</div>
    <div class="field"><label>Kartenbild</label>${segs('m-card', [['mockup', 'Mockup'], ['design', 'Design'], ['kleidungsansicht', 'Ansicht']], S.cardImg)}</div>
    <div class="field"><label>Hintergrund für transparente Designs</label>${segs('m-bg', [['dunkel', 'Dunkel'], ['hell', 'Hell'], ['schach', 'Schachbrett']], S.designBg)}</div>
    <div class="section-title">Konto</div>
    ${Store.drive.kind === 'onedrive' ? `<p class="hint">Angemeldet${S.user ? ' als ' + esc(S.user) : ''}. Sammlung: <span class="mono">${esc((Store.drive.rootInfo || {}).name || '')}</span></p>
    <button class="menu-item" data-a="folder">${icon('folder')}Anderen Sammlungsordner wählen</button>
    <button class="menu-item" data-a="logout">${icon('logout')}Abmelden</button>` : '<p class="hint">Demo-Modus: Änderungen werden nicht gespeichert.</p>'}
    <p class="faint" style="font-size:12.5px;margin-top:14px">APOLOGEA Handy-App ${VERSION}</p>`;
  sheet({ title: 'Menü', body, onOpen: (back, close) => {
    body.addEventListener('click', async e => {
      const seg = e.target.closest('.seg button');
      if (seg) {
        const id = seg.parentElement.id, v = seg.dataset.v;
        $$('button', seg.parentElement).forEach(b => b.classList.toggle('on', b === seg));
        if (id === 'm-card') { S.cardImg = v; prefs.set('cardImg', v); }
        if (id === 'm-bg') { S.designBg = v; prefs.set('designBg', v); }
        renderGrid();
        return;
      }
      const a = e.target.closest('[data-a]');
      if (!a) return;
      close();
      const act = a.dataset.a;
      if (act === 'sync') sync(false);
      if (act === 'newcat') createCategory();
      if (act === 'zg') openZgAssign();
      if (act === 'import') openImport();
      if (act === 'catalog') openCatalog();
      if (act === 'coll') Coll.openList();
      if (act === 'check') openCheck();
      if (act === 'trash') openTrash();
      if (act === 'status') {
        const v = await choose('Status', [['', 'Alle'], ['vollstaendig', 'Vollständig'], ['entwurf', 'Entwürfe'], ['unvollstaendig', 'Unvollständig'], ['hinweise', 'Mit Hinweisen']].map(([v, l]) => ({ label: l, value: v || 'alle' })));
        if (v) { S.filter.status = v === 'alle' ? '' : v; renderChips(); renderGrid(); }
      }
      if (act === 'folder') renderFolderPicker();
      if (act === 'logout' && await confirmSheet('Abmelden?', 'Sie werden von diesem Gerät abgemeldet. Ihre Daten im OneDrive bleiben unverändert.', 'Abmelden')) {
        Auth.logout(); prefs.set('rootId', null); renderLogin();
      }
    });
  } });
}

async function createCategory() {
  const name = await askText('Neuer Kleidungstyp', 'Name (wird als Ordner angelegt)', 'Umlaute werden für Windows-sichere Ordnernamen umgeschrieben (ü → ue).');
  if (!name) return null;
  busy('Kleidungstyp wird angelegt …');
  try { const c = await Store.createCategory(name); unbusy(); rerender(); toast(`„${c.name}“ angelegt.`, 'ok'); return c; }
  catch (e) { unbusy(); fail(e); return null; }
}

// ================================================================ Detailansicht
function descHtml(t) {
  if (!t || !t.trim()) return '<p class="faint">Keine Beschreibung hinterlegt.</p>';
  return t.split('\n').map(l => { const m = l.match(/^([^:]{2,32}):\s+(.*)$/); return m ? `<p><span class="k">${esc(m[1])}:</span> ${esc(m[2])}</p>` : l.trim() ? `<p>${esc(l)}</p>` : ''; }).join('');
}
const fmtDate = iso => { const d = new Date(iso); return isNaN(d) ? '–' : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ', ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); };
const fmtBytes = b => b < 1048576 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' MB';

function openDetail(key, keep) {
  const p = M().pieces.find(x => x.key === key);
  if (!p) return;
  S.detail = key;
  let v = $('#detail');
  const scroll = v && keep ? $('.view-body', v).scrollTop : 0;
  if (!v) { v = document.createElement('div'); v.id = 'detail'; v.className = 'view'; $('#layer').prepend(v); }
  const idx = S.visible.indexOf(key);
  const probs = realProblems(p);
  v.innerHTML = `
    <div class="view-head"><button class="btn ghost icon" id="d-back" aria-label="Zurück">${icon('back')}</button><div class="title">${pad3(p.nummer)} · ${esc(p.name)}</div>
      <button class="btn ghost icon" id="d-prev" ${idx > 0 ? '' : 'disabled'} aria-label="Vorheriges">${icon('back')}</button><button class="btn ghost icon" id="d-next" ${idx >= 0 && idx < S.visible.length - 1 ? '' : 'disabled'} aria-label="Nächstes" style="transform:scaleX(-1)">${icon('back')}</button></div>
    <div class="view-body">
      <div class="carousel" id="car">${ROLES.map(r => slideHtml(p, r)).join('')}</div>
      <div class="dots" id="dots">${ROLES.map((r, i) => `<span class="${i === 0 ? 'on' : ''}"></span>`).join('')}</div>
      <div class="detail-title"><div class="nr">Nr. ${pad3(p.nummer)} · ${esc(p.kategorie)}</div><h1>${esc(p.name)}</h1>${p.motivtitel ? `<div class="motiv">${esc(p.motivtitel)}</div>` : ''}
        <div class="row" style="margin-top:8px"><span class="badge ${p.status === 'Vollständig' ? 'ok' : p.status === 'Entwurf' ? 'entwurf' : 'fehlt'}">${p.status}</span></div>
        <div class="zg-pick"><span class="zg-lbl">Für</span>${zgSeg('d-zg', p.zielgruppe)}</div></div>
      <div class="actions">
        <button class="btn primary" id="d-edit">${icon('edit')}Bearbeiten</button>
        <button class="btn gold" id="d-tpl">${icon('template')}Als Vorlage</button>
        <button class="btn" id="d-share">${icon('share')}Bilder teilen</button>
        ${p.webUrl && Store.drive.kind === 'onedrive' ? `<a class="btn" href="${esc(p.webUrl)}" target="_blank" rel="noopener">${icon('cloud')}In OneDrive</a>` : '<span></span>'}
      </div>
      ${probs.length ? `<div class="section-title">Hinweise</div><ul class="problems">${probs.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <div class="section-title">Beschreibung</div><div class="desc">${descHtml(p.beschreibung)}</div>
      ${p.schlagwoerter.length ? `<div class="section-title">Schlagwörter</div><div class="row">${p.schlagwoerter.map(t => `<span class="chip static">${esc(t)}</span>`).join('')}</div>` : ''}
      <div id="d-coll"></div>
      <div class="section-title">Produktdaten</div>
      <dl class="datalist">
        <dt>Nummer</dt><dd>${pad3(p.nummer)}</dd><dt>Kleidungstyp</dt><dd>${esc(p.kategorie)}</dd><dt>Für</dt><dd>${esc(ZG.label(p.zielgruppe) || 'nicht zugeordnet')}</dd>
        ${p.serie ? `<dt>Serie</dt><dd>${esc(p.serie)}</dd>` : ''}
        <dt>Erstellt</dt><dd>${fmtDate(p.erstellt)}</dd><dt>Geändert</dt><dd>${fmtDate(p.geaendert)}</dd>
        ${p.herkunft ? `<dt>Herkunft</dt><dd>${esc(p.herkunft)}</dd>` : ''}
        <dt>Ordner</dt><dd class="mono">${esc(p.kategorie + '/' + p.folderName)}</dd>
      </dl>
      ${p.arbeitsdateien.length ? `<div class="section-title">Arbeitsdateien</div><div class="filelist">${p.arbeitsdateien.map(a => fileRow(a, false, p)).join('')}</div>` : ''}
      ${p.unzugeordnet.length ? `<div class="section-title">Nicht zugeordnet</div><p class="hint" style="margin:-4px 0 8px">Dateien im Produktordner ohne Zuordnung, z. B. am PC hinzugefügt.</p><div class="filelist">${p.unzugeordnet.map(a => fileRow(a, true, p)).join('')}</div>` : ''}
      <button class="btn danger block" id="d-trash" style="margin-top:28px">${icon('trash')}In den Papierkorb</button>
    </div>`;
  $('.view-body', v).scrollTop = scroll;
  $('#d-back').onclick = closeDetail;
  $('#d-prev').onclick = () => openDetail(S.visible[idx - 1]);
  $('#d-next').onclick = () => openDetail(S.visible[idx + 1]);
  $('#d-edit').onclick = () => openForm('bearbeiten', p);
  $('#d-tpl').onclick = () => openForm('vorlage', p);
  $('#d-share').onclick = () => shareItems(ROLES.map(r => p.bilder[r] && p.bilder[r].item).filter(Boolean), p);
  $('#d-trash').onclick = () => trashPiece(p);
  $('#d-zg').onclick = e => { const b = e.target.closest('button'); if (b) setZg([p], b.dataset.v === p.zielgruppe ? '' : b.dataset.v); };
  const car = $('#car');
  car.addEventListener('scroll', () => { const i = Math.round(car.scrollLeft / car.clientWidth); $$('#dots span').forEach((d, j) => d.classList.toggle('on', i === j)); }, { passive: true });
  $$('[data-view]', v).forEach(el => el.onclick = () => openViewer(p, el.dataset.view));
  $$('[data-open]', v).forEach(el => el.onclick = () => openFile(el.dataset.open));
  $$('.assign', v).forEach(sel => sel.onchange = () => assign(p, sel.dataset.rel, sel.value, sel));
  if (typeof Coll !== 'undefined') Coll.fillDetail(p, $('#d-coll', v));
  loadSlideImages(p, v);
}

function slideHtml(p, r) {
  const b = p.bilder[r];
  const it = b && b.item;
  const stage = it
    ? `<div class="slide-stage ${r === 'design' ? 'bg-' + S.designBg : ''}" data-view="${r}"><div class="slide-pic" role="img" aria-label="${esc(ROLE_LABEL[r])}" data-slide="${it.id}" data-role="${r}" data-name="${esc(it.name)}"></div><div class="spinner" style="position:absolute"></div></div>`
    : `<div class="slide-stage"><div class="missing-img">${icon('warn')}${b ? 'Datei fehlt:<br>' + esc(b.rel) : 'Kein ' + ROLE_LABEL[r] + ' hinterlegt'}</div></div>`;
  return `<div class="slide">${stage}<div class="slide-label"><span class="role">${ROLE_LABEL[r]}</span><span>${it ? esc(it.name) + ' · ' + fmtBytes(it.size) : ''}</span></div></div>`;
}

let slideUrls = [];
/**
 * Bild erst vollständig laden und dekodieren, dann – falls größer als nötig – auf Bildschirmgröße verkleinern.
 * Große Originale direkt im Karussell zeichnet Safari auf dem iPhone sonst nur streifenweise.
 * Die Vollbildansicht verwendet weiterhin das Original.
 */
async function slideSrc(url, keepAlpha) {
  // Erst herunterladen (wie Store.blobOf), dann lokal verarbeiten – so blockiert der Browser die Zeichenfläche nicht
  const r = await fetch(url);
  if (!r.ok) throw new Error('Bild nicht ladbar');
  const local = URL.createObjectURL(await r.blob());
  slideUrls.push(local);
  const im = new Image();
  im.decoding = 'async';
  im.src = local;
  await (im.decode ? im.decode() : new Promise((res, rej) => { im.onload = res; im.onerror = rej; }));
  const max = Math.round(Math.min(2400, Math.max(1200, window.innerWidth * (window.devicePixelRatio || 1) * 1.5)));
  const w = im.naturalWidth, h = im.naturalHeight, k = Math.min(1, max / Math.max(w, h));
  if (k >= 1) return local;
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(im, 0, 0, c.width, c.height);
  const blob = await new Promise(res => c.toBlob(res, keepAlpha ? 'image/png' : 'image/jpeg', 0.92));
  c.width = c.height = 0; // Speicher sofort freigeben
  if (!blob) return local;
  URL.revokeObjectURL(local); slideUrls = slideUrls.filter(x => x !== local);
  const u = URL.createObjectURL(blob);
  slideUrls.push(u);
  return u;
}

async function loadSlideImages(p, v) {
  slideUrls.forEach(u => URL.revokeObjectURL(u)); slideUrls = [];
  // Als Hintergrundbild statt <img>: Safari auf dem iPhone malte <img> im Karussell nur als schmalen Streifen
  const imgs = $$('.slide-pic[data-slide]', v);
  const ready = img => { const sp = img.parentElement && img.parentElement.querySelector('.spinner'); if (sp) sp.remove(); };
  // Nacheinander statt gleichzeitig: schont den Speicher des iPhones bei großen Dateien
  for (const i of imgs) {
    try {
      const u = await Store.drive.fileUrl(i.dataset.slide);
      if (!u) { ready(i); continue; }
      const alpha = i.dataset.role === 'design' || /^(png|webp|gif|svg|tif|tiff)$/i.test(extOf(i.dataset.name || ''));
      let src = u;
      try { src = await slideSrc(u, alpha); } catch (e) { src = u; }
      if (!i.isConnected) return;
      i.style.backgroundImage = `url("${src}")`;
      ready(i);
    } catch (e) { ready(i); fail(e, 'Bilder konnten nicht geladen werden'); return; }
  }
}

function fileRow(a, unassigned, p) {
  const it = a.item;
  const isImg = IMG_EXT.includes(extOf(a.rel));
  return `<div class="filerow ${it ? '' : 'missing'}"><span style="color:var(--gold)">${icon(isImg ? 'image' : 'file')}</span>
    <div class="fn">${esc(a.rel)}<small>${it ? fmtBytes(it.size) : 'fehlt im Produktordner'}</small></div>
    ${unassigned ? `<select class="input assign" data-rel="${esc(a.rel)}" style="width:auto;padding:6px 30px 6px 10px;font-size:14px"><option value="">Zuordnen …</option>${isImg ? ROLES.map(r => `<option value="${r}">${ROLE_LABEL[r]}</option>`).join('') : ''}<option value="arbeitsdatei">Arbeitsdatei</option></select>` : ''}
    ${it ? `<button class="btn small gold" data-open="${it.id}">Öffnen</button>` : ''}</div>`;
}

async function openFile(id) {
  const w = window.open('', '_blank');
  try { const u = await Store.drive.fileUrl(id); if (w) w.location = u; else location.href = u; }
  catch (e) { if (w) w.close(); fail(e); }
}

async function shareItems(items, p) {
  if (!items.length) { toast('Keine Bilder vorhanden.', 'err'); return; }
  busy('Bilder werden vorbereitet …');
  try {
    const files = [];
    for (const it of items) { const b = await Store.blobOf(it); files.push(new File([b], pad3(p.nummer) + '_' + Names.segment(p.name, 40) + '_' + it.name, { type: b.type || 'image/jpeg' })); }
    unbusy();
    if (navigator.canShare && navigator.canShare({ files })) await navigator.share({ files, title: pad3(p.nummer) + ' · ' + p.name });
    else toast('Teilen wird von diesem Browser nicht unterstützt. Bitte „Öffnen“ verwenden.', 'err');
  } catch (e) { unbusy(); if (e.name !== 'AbortError') fail(e); }
}

async function assign(p, rel, role, sel) {
  if (!role) return;
  busy('Zuordnung wird gespeichert …');
  try { await Store.assign(p, rel, role); unbusy(); rerender(); toast(`„${rel}“ zugeordnet.`, 'ok'); }
  catch (e) { unbusy(); sel.value = ''; fail(e); }
}

function closeDetail() { const v = $('#detail'); if (v) v.remove(); S.detail = null; slideUrls.forEach(u => URL.revokeObjectURL(u)); slideUrls = []; }

async function trashPiece(p) {
  if (!(await confirmSheet('In den Papierkorb?', `<b>${esc(pad3(p.nummer) + ' · ' + p.name)}</b> wird mit dem ganzen Produktordner in den Papierkorb der Sammlung verschoben und kann dort wiederhergestellt werden.`, 'In den Papierkorb', true))) return;
  busy('Wird in den Papierkorb verschoben …');
  try { await Store.trashPiece(p); unbusy(); closeDetail(); rerender(); toast(`${pad3(p.nummer)} · ${p.name} liegt im Papierkorb.`, 'ok'); }
  catch (e) { unbusy(); fail(e); }
}

// ================================================================ Bildbetrachter (Zoomen mit zwei Fingern)
async function openViewer(p, role) {
  const roles = ROLES.filter(r => p.bilder[r] && p.bilder[r].item);
  let i = Math.max(0, roles.indexOf(role));
  const v = document.createElement('div');
  v.className = 'viewer';
  v.innerHTML = `<div class="viewer-bar"><button class="btn ghost icon" data-x aria-label="Schließen">${icon('close')}</button><div class="title"></div><span style="width:44px"></span></div>
    <div class="viewer-stage"><img alt=""><div class="spinner" style="position:absolute;left:50%;top:50%;margin:-16px"></div></div>
    <div class="viewer-foot"><button class="btn small" data-prev>‹</button><button class="btn small gold" data-share>${icon('share')}Teilen / Sichern</button><button class="btn small" data-orig>Original</button><button class="btn small" data-next>›</button></div>`;
  $('#layer').appendChild(v);
  const stage = $('.viewer-stage', v), img = $('img', stage);
  let s = 1, x = 0, y = 0, fitS = 1;
  const apply = () => { img.style.transform = `translate(${x}px,${y}px) scale(${s})`; };
  const fit = () => { const w = img.naturalWidth, h = img.naturalHeight; if (!w) return; fitS = Math.min(stage.clientWidth / w, stage.clientHeight / h); s = fitS; x = (stage.clientWidth - w * s) / 2; y = (stage.clientHeight - h * s) / 2; apply(); };
  async function show(n) {
    i = (n + roles.length) % roles.length;
    const r = roles[i], it = p.bilder[r].item;
    $('.title', v).textContent = ROLE_LABEL[r] + ' · ' + it.name;
    stage.className = 'viewer-stage' + (r === 'design' ? ' bg-' + S.designBg : '');
    img.style.opacity = '0';
    const sp = $('.spinner', stage); if (sp) sp.style.display = '';
    img.onload = () => { img.style.opacity = '1'; const sp2 = $('.spinner', stage); if (sp2) sp2.style.display = 'none'; fit(); };
    try { img.src = await Store.drive.fileUrl(it.id); } catch (e) { fail(e); }
  }
  const pts = new Map();
  let start = null;
  stage.addEventListener('pointerdown', e => { stage.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); start = snapshot(); });
  stage.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const cur = snapshot();
    if (!start) return;
    if (cur.n === 2 && start.n === 2) {
      const ns = Math.min(8, Math.max(fitS * .5, start.s * cur.d / start.d));
      const r = stage.getBoundingClientRect();
      const cx = start.cx - r.left, cy = start.cy - r.top;
      x = cx - (cx - start.x) * (ns / start.s) + (cur.cx - start.cx);
      y = cy - (cy - start.y) * (ns / start.s) + (cur.cy - start.cy);
      s = ns; apply();
    } else if (cur.n === 1 && start.n === 1) { x = start.x + cur.cx - start.cx; y = start.y + cur.cy - start.cy; apply(); }
  });
  const end = e => { pts.delete(e.pointerId); start = pts.size ? snapshot() : null; if (!pts.size && s <= fitS * 1.02) fit(); };
  stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
  let lastTap = 0;
  stage.addEventListener('click', () => { const t = Date.now(); if (t - lastTap < 300) { if (s > fitS * 1.05) fit(); else { const r = 2.5; x = stage.clientWidth / 2 - (stage.clientWidth / 2 - x) * r; y = stage.clientHeight / 2 - (stage.clientHeight / 2 - y) * r; s *= r; apply(); } } lastTap = t; });
  function snapshot() {
    const a = [...pts.values()];
    if (!a.length) return null;
    const cx = a.reduce((q, p2) => q + p2.x, 0) / a.length, cy = a.reduce((q, p2) => q + p2.y, 0) / a.length;
    const d = a.length > 1 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 1;
    return { n: a.length, cx, cy, d, s, x, y };
  }
  v.addEventListener('click', e => {
    if (e.target.closest('[data-x]')) v.remove();
    if (e.target.closest('[data-prev]')) show(i - 1);
    if (e.target.closest('[data-next]')) show(i + 1);
    if (e.target.closest('[data-share]')) shareItems([p.bilder[roles[i]].item], p);
    if (e.target.closest('[data-orig]')) openFile(p.bilder[roles[i]].item.id);
  });
  if (roles.length < 2) { $('[data-prev]', v).classList.add('hidden'); $('[data-next]', v).classList.add('hidden'); }
  show(i);
}

// ================================================================ Formular: Neues Piece / Bearbeiten / Vorlage
function openForm(mode, p) {
  if (!M().categories.length) { toast('Bitte zuerst einen Kleidungstyp anlegen (Menü → Neuer Kleidungstyp).', 'err'); return; }
  const f = {
    mode, key: null, baseETag: null, stagingId: null, dirty: false, vorlage_von: null, tplTitle: '',
    nummer: Store.nextNumber(), name: '', motivtitel: '', catId: (M().categories.find(c => c.name === S.filter.cat) || {}).id || '', zielgruppe: ['mann', 'frau', 'unisex'].includes(S.filter.zg) ? S.filter.zg : '', serie: '', beschreibung: '', schlagwoerter: [], entwurf: false,
    slots: { design: null, kleidungsansicht: null, mockup: null }, work: [], unassigned: [], prevMissing: {}
  };
  if (p) Object.assign(f, { name: p.name, motivtitel: p.motivtitel, catId: p.catId, zielgruppe: p.zielgruppe || '', serie: p.serie, beschreibung: p.beschreibung, schlagwoerter: p.schlagwoerter.slice() });
  if (mode === 'bearbeiten') {
    Object.assign(f, { key: p.key, baseETag: p.jsonItem.eTag, nummer: p.nummer, entwurf: p.entwurf, orig: p, unassigned: p.unzugeordnet.filter(u => u.item && IMG_EXT.includes(extOf(u.rel))) });
    ROLES.forEach(r => { const b = p.bilder[r]; if (b && b.item) f.slots[r] = { art: 'behalten', rel: b.rel, item: b.item, name: b.item.name, size: b.item.size }; else if (b) f.prevMissing[r] = b.rel; });
    f.work = p.arbeitsdateien.filter(a => a.item).map(a => ({ art: 'behalten', rel: a.rel, item: a.item, name: a.item.name, size: a.item.size }));
  }
  if (mode === 'vorlage') {
    f.vorlage_von = p.id; f.tplTitle = pad3(p.nummer) + ' · ' + p.name;
    ROLES.forEach(r => { const b = p.bilder[r]; if (b && b.item) f.slots[r] = { art: 'kopie', item: b.item, name: b.item.name, size: b.item.size, ext: extOf(b.item.name) }; });
    f.work = p.arbeitsdateien.filter(a => a.item).map(a => ({ art: 'kopie', item: a.item, name: a.item.name, origName: a.item.name, size: a.item.size, ext: extOf(a.item.name) }));
  }
  S.form = f;
  renderForm();
}

function renderForm() {
  const f = S.form;
  let v = $('#form');
  if (!v) { v = document.createElement('div'); v.id = 'form'; v.className = 'view'; $('#layer').appendChild(v); }
  const title = f.mode === 'bearbeiten' ? 'Bearbeiten' : f.mode === 'vorlage' ? 'Neu nach Vorlage' : 'Neues Piece';
  v.innerHTML = `
    <div class="view-head"><button class="btn ghost" id="f-cancel">Abbrechen</button><div class="title">${title}</div><span style="width:90px"></span></div>
    <div class="view-body">
      ${f.mode === 'vorlage' ? `<div class="tpl-note">Vorlage: <b>${esc(f.tplTitle)}</b>. Alles wird als Kopie in einen neuen Ordner übernommen – das Original bleibt unverändert.</div>` : ''}
      <div class="section-title">Bilder</div>
      <div class="slots" id="f-slots"></div>
      <div class="section-title">Angaben</div>
      <div class="field"><label for="f-cat">Kleidungstyp<span class="req">*</span></label>
        <select class="input" id="f-cat"><option value="">Bitte auswählen …</option>${M().categories.map(c => `<option value="${c.id}" ${c.id === f.catId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}<option value="__neu">＋ Neuer Kleidungstyp …</option></select></div>
      <div class="field"><label>Für <span class="faint">(Mann, Frau oder beide)</span></label>${zgSeg('f-zg', f.zielgruppe, true)}</div>
      <div class="field"><label for="f-name">Produktname<span class="req">*</span></label><input class="input name" id="f-name" value="${esc(f.name)}" maxlength="60" placeholder="z. B. SERAPHIM" autocapitalize="characters" autocomplete="off"></div>
      <div class="field"><label for="f-nr">Piece-Nummer<span class="req">*</span></label><input class="input" id="f-nr" type="number" inputmode="numeric" min="1" value="${f.nummer}"><span class="hint" id="f-nr-hint"></span></div>
      <div class="field"><label for="f-motiv">Motivtitel <span class="faint">(optional)</span></label><input class="input" id="f-motiv" value="${esc(f.motivtitel)}" maxlength="80" autocomplete="off"></div>
      <div class="field"><label for="f-serie">Serie <span class="faint">(optional)</span></label><input class="input" id="f-serie" value="${esc(f.serie)}" list="f-series" maxlength="80" autocomplete="off"><datalist id="f-series">${[...new Set(M().pieces.map(p => p.serie).filter(Boolean))].map(s => `<option value="${esc(s)}">`).join('')}</datalist></div>
      <div class="field"><label for="f-desc">Beschreibung <span class="faint">(optional)</span></label><textarea class="input" id="f-desc" placeholder="Farbe: …&#10;Front: …&#10;Veredelung: …">${esc(f.beschreibung)}</textarea></div>
      <div class="field"><label>Schlagwörter <span class="faint">(optional)</span></label><div class="chips" id="f-tags"></div></div>
      <div class="section-title">Arbeitsdateien</div>
      <div id="f-work"></div>
      <label class="btn gold block" style="margin-top:8px">${icon('file')}Dateien hinzufügen<input type="file" multiple id="f-workin" class="hidden"></label>
      <div class="summary" id="f-sum"></div>
    </div>
    <div class="view-foot"><button class="btn gold" id="f-draft">Als Entwurf</button><button class="btn primary" id="f-save">${icon('check')}Speichern</button></div>`;
  const dirty = () => { f.dirty = true; summary(); };
  $('#f-cancel').onclick = () => closeForm();
  $('#f-cat').onchange = async e => {
    if (e.target.value === '__neu') { const c = await createCategory(); if (c) { f.catId = c.id; renderForm(); } else e.target.value = f.catId; return; }
    f.catId = e.target.value; dirty();
  };
  $('#f-zg').onclick = e => { const b = e.target.closest('button'); if (!b) return; f.zielgruppe = b.dataset.v; $$('#f-zg button').forEach(x => x.classList.toggle('on', x === b)); dirty(); };
  $('#f-name').oninput = e => { f.name = e.target.value; dirty(); };
  $('#f-nr').oninput = e => { f.nummer = parseInt(e.target.value, 10) || 0; dirty(); };
  $('#f-motiv').oninput = e => { f.motivtitel = e.target.value; dirty(); };
  $('#f-serie').oninput = e => { f.serie = e.target.value; dirty(); };
  $('#f-desc').oninput = e => { f.beschreibung = e.target.value; f.dirty = true; };
  $('#f-workin').onchange = e => { addWork(Array.from(e.target.files || [])); e.target.value = ''; };
  $('#f-draft').onclick = () => saveForm(true);
  $('#f-save').onclick = () => saveForm(false);
  renderTags(); renderSlots(); renderWork(); summary();
}

function renderTags() {
  const f = S.form, box = $('#f-tags');
  box.innerHTML = f.schlagwoerter.map((t, i) => `<span class="chip">${esc(t)}<button data-i="${i}" aria-label="entfernen">×</button></span>`).join('') + '<input id="f-tagin" placeholder="hinzufügen …" enterkeyhint="done" autocomplete="off">';
  const inp = $('#f-tagin');
  const add = () => { inp.value.split(',').map(s => s.trim()).filter(Boolean).forEach(t => { if (!f.schlagwoerter.some(x => norm(x) === norm(t))) f.schlagwoerter.push(t); }); f.dirty = true; renderTags(); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); $('#f-tagin').focus(); } });
  inp.addEventListener('blur', () => { if (inp.value.trim()) add(); });
  box.onclick = e => { const b = e.target.closest('button[data-i]'); if (b) { f.schlagwoerter.splice(+b.dataset.i, 1); f.dirty = true; renderTags(); } };
}

const slotTag = s => !s ? '' : s.pending ? '<span class="tag neu">lädt …</span>' : s.art === 'upload' ? '<span class="tag neu">neu</span>' : s.art === 'kopie' ? '<span class="tag kopie">Kopie</span>' : '<span class="tag vorhanden">vorhanden</span>';

function renderSlots() {
  const f = S.form, box = $('#f-slots');
  box.innerHTML = ROLES.map(r => {
    const s = f.slots[r];
    let inner;
    if (!s) inner = `<div>${icon('camera')}${ROLE_SHORT[r]}<br>hinzufügen${f.prevMissing[r] ? '<br><span style="color:var(--danger)">fehlte</span>' : ''}</div>`;
    else inner = `<img data-preview="${r}" alt="">`;
    if (s && s.pending) inner += `<div class="prog"><span>${s.pct || 0} %</span><div class="bar"><div style="width:${s.pct || 0}%"></div></div></div>`;
    return `<div class="slot"><div class="slot-label">${ROLE_LABEL[r]}</div>
      <label class="slot-box ${s ? 'filled' : ''} ${r === 'design' && s ? 'bg-' + S.designBg : ''}">${inner}<input type="file" accept="image/*" class="hidden" data-pick="${r}"></label>
      <div class="slot-name">${s ? esc(s.name) + '<br>' + slotTag(s) : ''}</div>
      ${s ? `<div class="slot-tools"><button data-swap="${r}" aria-label="Zuordnung tauschen">${icon('swap').replace('<svg', '<svg style="width:16px;height:16px;vertical-align:-3px"')}</button><button class="del" data-del="${r}" aria-label="Entfernen">×</button></div>` : ''}
      ${!s && f.unassigned.length ? `<div class="slot-tools"><button data-exist="${r}">Aus Ordner …</button></div>` : ''}
    </div>`;
  }).join('');
  ROLES.forEach(r => {
    const s = f.slots[r], img = $(`img[data-preview="${r}"]`, box);
    if (!s || !img) return;
    if (s.url) img.src = s.url;
    else if (s.item) Store.drive.thumbUrls([s.item.id], 'large').then(u => { if (u[s.item.id]) { s.url = u[s.item.id]; img.src = s.url; } }).catch(() => {});
  });
  $$('[data-pick]', box).forEach(inp => inp.onchange = () => { const fl = inp.files && inp.files[0]; if (fl) setSlotFile(inp.dataset.pick, fl); inp.value = ''; });
  $$('[data-del]', box).forEach(b => b.onclick = () => { f.slots[b.dataset.del] = null; f.dirty = true; renderSlots(); summary(); });
  $$('[data-swap]', box).forEach(b => b.onclick = async () => {
    const a = b.dataset.swap;
    const t = await choose('Tauschen mit …', ROLES.filter(r => r !== a).map(r => ({ label: ROLE_LABEL[r], value: r })));
    if (!t) return;
    const x = f.slots[a]; f.slots[a] = f.slots[t]; f.slots[t] = x; f.dirty = true; renderSlots(); summary();
  });
  $$('[data-exist]', box).forEach(b => b.onclick = async () => {
    const rel = await choose('Datei aus dem Produktordner', f.unassigned.map(u => ({ label: u.rel, value: u.rel })));
    if (!rel) return;
    const u = f.unassigned.find(x => x.rel === rel);
    f.slots[b.dataset.exist] = { art: 'behalten', rel: u.rel, item: u.item, name: u.item.name, size: u.item.size };
    f.dirty = true; renderSlots(); summary();
  });
  updateButtons();
}

async function ensureStaging() {
  const f = S.form;
  if (!f.stagingId) { if (!f._stagingP) f._stagingP = Store.createStaging().then(s => { f.stagingId = s.id; return s; }); await f._stagingP; }
  return f.stagingId;
}

async function setSlotFile(role, file) {
  const f = S.form;
  const ext = extOf(file.name);
  if (!IMG_EXT.includes(ext) && !(file.type || '').startsWith('image/')) { toast('Das ist keine Bilddatei.', 'err'); return; }
  const slot = { art: 'upload', name: file.name, size: file.size, pending: true, pct: 0, url: BROWSER_IMG.includes(ext) || (file.type || '').startsWith('image/') ? URL.createObjectURL(file) : null };
  f.slots[role] = slot; f.dirty = true; renderSlots(); summary();
  try {
    await ensureStaging();
    let last = 0;
    const res = await Store.uploadToStaging(f.stagingId, file, n => { const pct = Math.round(n / file.size * 100); if (pct - last >= 5) { last = pct; slot.pct = pct; const bx = $(`img[data-preview="${role}"]`); const pr = bx && bx.parentElement.querySelector('.prog'); if (pr && f.slots[role] === slot) { pr.firstElementChild.textContent = pct + ' %'; pr.querySelector('.bar div').style.width = pct + '%'; } } });
    slot.item = res.item; slot.ext = res.ext; slot.pending = false;
    if (res.endungKorrigiert) toast(`„${file.name}“ ist tatsächlich ein ${String(res.format).toUpperCase()}-Bild und wird als .${res.ext} gespeichert.`, '', { ms: 6000 });
  } catch (e) {
    ROLES.forEach(r => { if (f.slots[r] === slot) f.slots[r] = null; });
    fail(e, 'Hochladen fehlgeschlagen');
  }
  if (S.form === f) { renderSlots(); summary(); }
}

async function addWork(files) {
  const f = S.form;
  for (const file of files) {
    const w = { art: 'upload', name: file.name, origName: file.name, size: file.size, pending: true };
    f.work.push(w); f.dirty = true; renderWork();
    try { await ensureStaging(); const r = await Store.uploadToStaging(f.stagingId, file); w.item = r.item; w.pending = false; }
    catch (e) { f.work.splice(f.work.indexOf(w), 1); fail(e, 'Hochladen fehlgeschlagen'); }
    if (S.form === f) { renderWork(); summary(); }
  }
}

function renderWork() {
  const f = S.form, box = $('#f-work');
  box.innerHTML = f.work.length ? `<div class="filelist">${f.work.map((w, i) => `<div class="filerow"><span style="color:var(--gold)">${icon('file')}</span><div class="fn">${esc(w.name)}<small>${fmtBytes(w.size || 0)} ${slotTag(w)}</small></div><button class="btn small danger" data-wdel="${i}">×</button></div>`).join('')}</div>` : '<p class="hint">Keine Arbeitsdateien. Beliebige Dateien (PDF, Notizen, Vorlagen …) sind möglich.</p>';
  $$('[data-wdel]', box).forEach(b => b.onclick = () => { f.work.splice(+b.dataset.wdel, 1); f.dirty = true; renderWork(); summary(); });
  updateButtons();
}

function pending() { const f = S.form; return ROLES.filter(r => f.slots[r] && f.slots[r].pending).length + f.work.filter(w => w.pending).length; }
function updateButtons() { const p = pending(); const a = $('#f-save'), b = $('#f-draft'); if (a) a.disabled = b.disabled = p > 0; }

function summary() {
  const f = S.form, box = $('#f-sum');
  if (!box) return;
  const hint = $('#f-nr-hint');
  const owner = f.nummer > 0 ? Store.numberOwner(f.nummer, f.key) : null;
  if (hint) { hint.className = 'hint ' + (owner || f.nummer < 1 ? 'error' : 'ok'); hint.textContent = f.nummer < 1 ? 'Bitte eine Zahl ab 1 eingeben.' : owner ? `Nummer ${pad3(f.nummer)} ist vergeben (${owner}). Frei: ${pad3(Store.nextNumber())}` : `Nummer ${pad3(f.nummer)} ist frei.`; }
  const cat = M().categories.find(c => c.id === f.catId);
  const leaf = f.mode === 'bearbeiten' && f.orig.name === f.name.trim() && f.orig.motivtitel === f.motivtitel.trim() && f.orig.nummer === f.nummer ? f.orig.folderName : Names.folderFor(f.nummer || 0, f.name || 'NAME', f.motivtitel);
  const rows = [['Ordner', cat ? `<span class="mono">${esc(cat.name + '/' + leaf)}</span>` : '<span class="faint">Kleidungstyp wählen</span>']];
  ROLES.forEach(r => { const s = f.slots[r]; rows.push([ROLE_LABEL[r], !s ? '<span style="color:var(--danger)">fehlt</span>' : s.art === 'behalten' ? esc(s.rel) + ' <span class="faint">(bleibt)</span>' : `${ROLE_BASE[r]}.${esc(s.ext || extOf(s.name))} <span class="faint">(${s.art === 'kopie' ? 'Kopie' : 'neu'})</span>`]); });
  if (f.mode === 'bearbeiten') {
    const kept = new Set(ROLES.map(r => f.slots[r]).concat(f.work).filter(s => s && s.art === 'behalten').map(s => s.rel.toLowerCase()));
    const removed = ROLES.map(r => f.orig.bilder[r]).concat(f.orig.arbeitsdateien).filter(x => x && x.item && !kept.has(x.rel.toLowerCase())).map(x => x.rel);
    if (removed.length) rows.push(['Ersetzt', esc(removed.join(', ')) + ' <span class="faint">→ Papierkorb</span>']);
  }
  box.innerHTML = '<div class="section-title" style="margin-top:0">Vorschau der Ablage</div>' + rows.map(([k, v]) => `<div class="r"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  updateButtons();
}

async function closeForm(force) {
  const f = S.form;
  if (!f) return;
  if (!force && f.dirty && !(await confirmSheet('Änderungen verwerfen?', 'Die Eingaben wurden noch nicht gespeichert.', 'Verwerfen', true))) return;
  if (!force) Store.discardStaging(f.stagingId);
  ROLES.forEach(r => { const s = f.slots[r]; if (s && s.url && s.url.startsWith('blob:')) URL.revokeObjectURL(s.url); });
  const v = $('#form'); if (v) v.remove();
  S.form = null;
}

async function saveForm(asDraft) {
  const f = S.form;
  f.name = $('#f-name').value; f.motivtitel = $('#f-motiv').value; f.serie = $('#f-serie').value; f.beschreibung = $('#f-desc').value;
  const ti = $('#f-tagin'); if (ti && ti.value.trim()) ti.value.split(',').map(s => s.trim()).filter(Boolean).forEach(t => { if (!f.schlagwoerter.includes(t)) f.schlagwoerter.push(t); });
  const errs = [];
  $('#f-cat').classList.toggle('invalid', !f.catId); if (!f.catId) errs.push('Bitte einen Kleidungstyp wählen.');
  $('#f-name').classList.toggle('invalid', !f.name.trim()); if (!f.name.trim()) errs.push('Bitte einen Produktnamen eingeben.');
  const owner = f.nummer > 0 ? Store.numberOwner(f.nummer, f.key) : 'ungültig';
  $('#f-nr').classList.toggle('invalid', !!owner); if (owner) errs.push(f.nummer > 0 ? `Die Nummer ${pad3(f.nummer)} ist bereits vergeben.` : 'Bitte eine gültige Nummer eingeben.');
  if (errs.length) { toast(errs.join(' '), 'err', { title: 'Bitte ergänzen' }); return; }
  if (pending()) { toast('Bitte warten, bis alle Dateien hochgeladen sind.', 'err'); return; }
  const missing = ROLES.filter(r => !f.slots[r]);
  if (!asDraft && missing.length) {
    const v = await sheet({ title: 'Bilder fehlen noch', body: `<p>Es fehlen: <b>${missing.map(r => ROLE_LABEL[r]).join(', ')}</b>.</p><p>Jetzt als <b>Entwurf</b> speichern und die Bilder später ergänzen?</p>`, buttons: [{ label: 'Zurück' }, { label: 'Als Entwurf speichern', cls: 'primary', value: 'draft' }] });
    if (v !== 'draft') return;
    asDraft = true;
  }
  f.entwurf = !!asDraft;
  busy('Wird gespeichert …');
  try {
    await ensureStaging();
    const p = await Store.save(f, msg => busy(msg));
    unbusy();
    await closeForm(true);
    rerender();
    if (p) openDetail(p.key);
    toast(`Gespeichert in OneDrive: ${p ? p.kategorie + '/' + p.folderName : ''}`, 'ok', { title: `${pad3(f.nummer)} · ${f.name.trim()}${asDraft ? ' (Entwurf)' : ''}` });
  } catch (e) { unbusy(); fail(e, 'Speichern nicht möglich'); }
}

// ================================================================ Mann / Frau / Unisex
function zgSeg(id, cur, withOpen) {
  const opts = ZG.LIST.concat(withOpen ? [['', 'Offen']] : []);
  return `<div class="seg zg-seg" id="${id}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === (cur || '') ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}

async function setZg(pieces, zg, quiet) {
  if (!quiet) busy('Wird gespeichert …');
  try {
    const r = await Store.setZielgruppe(pieces.map(p => ({ key: p.key, zg })), msg => busy(msg));
    if (!quiet) unbusy();
    if (r.conflicts) toast(`${r.conflicts === 1 ? 'Ein Piece wurde' : r.conflicts + ' Pieces wurden'} gerade an einem anderen Gerät geändert und nicht umgestellt. Bitte aktualisieren und erneut versuchen.`, 'err');
    else if (!quiet) toast(pieces.length === 1 ? `${pad3(pieces[0].nummer)} · ${pieces[0].name}: ${ZG.label(zg) || 'nicht zugeordnet'}` : `${r.done} Pieces: ${ZG.label(zg) || 'nicht zugeordnet'}`, 'ok');
    rerender();
    return r;
  } catch (e) { if (!quiet) unbusy(); fail(e, 'Speichern nicht möglich'); return null; }
}

/** Zuordnungsliste (JSON von Claude) einlesen, Übersicht zeigen, nach Bestätigung speichern */
async function zgFromFile(file) {
  let r;
  try { r = ZG.parseFile(await file.text(), M().pieces); } catch (e) { fail(e, 'Datei nicht lesbar'); return false; }
  const by = k => r.changes.filter(c => c.zg === k);
  const skipped = r.missing.length + r.mismatch.length + r.invalid.length;
  const ok = await sheet({
    title: 'Zuordnung übernehmen?',
    body: `<p><b>${r.changes.length} Pieces</b> aus „${esc(file.name)}“:</p>
      <dl class="datalist">${ZG.LIST.map(([k, l]) => `<dt>${l}</dt><dd>${by(k).length}</dd>`).join('')}${by('').length ? `<dt>Offen</dt><dd>${by('').length}</dd>` : ''}</dl>
      ${skipped ? `<p class="hint warn">${skipped} Einträge werden übersprungen:${r.mismatch.length ? `<br>Name passt nicht: ${r.mismatch.slice(0, 8).map(x => esc(pad3(x.p.nummer) + ' ' + x.p.name + ' ≠ ' + x.e.name)).join(', ')}${r.mismatch.length > 8 ? ' …' : ''}` : ''}${r.missing.length ? `<br>Nummer nicht gefunden: ${r.missing.slice(0, 12).map(x => pad3(x.nummer)).join(', ')}${r.missing.length > 12 ? ' …' : ''}` : ''}${r.invalid.length ? `<br>Ungültig: ${r.invalid.length}` : ''}</p>` : ''}
      <p class="hint">Vorhandene Zuordnungen dieser Pieces werden überschrieben. Einzelne lassen sich danach wieder umstellen.</p>`,
    buttons: [{ label: 'Abbrechen', value: false }, { label: 'Übernehmen', cls: 'primary', value: true }]
  });
  if (!ok || !r.changes.length) return false;
  busy('Zuordnung wird gespeichert …');
  let done = 0, conflicts = 0;
  try {
    for (const [k] of ZG.LIST.concat([['']])) {
      const list = by(k); if (!list.length) continue;
      const res = await Store.setZielgruppe(list.map(c => ({ key: c.piece.key, zg: k })), msg => busy(msg.replace('Wird gespeichert', (ZG.label(k) || 'Offen') + ' wird gespeichert')));
      done += res.done; conflicts += res.conflicts;
    }
    unbusy();
  } catch (e) { unbusy(); fail(e, 'Speichern nicht vollständig'); rerender(); return true; }
  rerender();
  toast(`${done} Pieces zugeordnet.${conflicts ? ` ${conflicts} wurden gerade an einem anderen Gerät geändert – bitte Datei erneut einspielen.` : ''}`, conflicts ? 'err' : 'ok');
  return true;
}

/** Schnelles Zuordnen vieler Pieces: Liste mit Bild und drei Knöpfen je Piece */
function openZgAssign() {
  const st = { only: M().pieces.some(p => !p.zielgruppe), cat: '', q: '' };
  let v = $('#zg-view');
  if (!v) { v = document.createElement('div'); v.id = 'zg-view'; v.className = 'view'; $('#layer').appendChild(v); }
  const list = () => {
    const t = norm(st.q).split(/\s+/).filter(Boolean);
    return M().pieces.filter(p => (!st.only || !p.zielgruppe) && (!st.cat || p.kategorie === st.cat) &&
      t.every(x => norm([p.nummer, pad3(p.nummer), p.name, p.motivtitel, p.kategorie].join(' ')).includes(x))).sort((a, b) => a.nummer - b.nummer);
  };
  const row = p => { const { f } = cardItem(p); return `<div class="zg-row" data-key="${p.key}"><div class="zg-thumb">${f ? `<img data-thumb="${f.id}" alt="">` : icon('image')}</div>
    <div class="zg-name"><b>${pad3(p.nummer)} · ${esc(p.name)}</b><small>${esc(p.kategorie)}${p.motivtitel ? ' · ' + esc(p.motivtitel) : ''}</small></div>${zgSeg('', p.zielgruppe)}</div>`; };
  const count = n => { const open = M().pieces.filter(p => !p.zielgruppe).length; $('#zg-count', v).innerHTML = `${open ? `<b>${open}</b> von ${M().pieces.length} noch offen` : '<b>Alle Pieces zugeordnet.</b>'} · ${n} angezeigt`; };
  const draw = () => {
    const l = list();
    const open = M().pieces.filter(p => !p.zielgruppe).length;
    count(l.length);
    $('#zg-list', v).innerHTML = l.length ? l.map(row).join('') : `<div class="empty">${st.only && !open ? 'Alle Pieces sind zugeordnet. 🙏' : 'Keine passenden Pieces.'}</div>`;
    $('#zg-bulk', v).classList.toggle('hidden', !l.length);
    observeThumbs($('#zg-list', v));
  };
  v.innerHTML = `
    <div class="view-head"><button class="btn ghost icon" id="zg-back" aria-label="Zurück">${icon('back')}</button><div class="title">Mann / Frau zuordnen</div><span style="width:44px"></span></div>
    <div class="view-body">
      <p class="hint" style="margin-top:0">Je Piece auf <b>Mann</b>, <b>Frau</b> oder <b>Unisex</b> tippen – wird sofort gespeichert. Unisex = Mockups mit Mann und Frau.</p>
      <button class="btn gold block" id="zg-file" style="margin-bottom:12px">${icon('file')}Zuordnung aus Datei übernehmen …</button><input type="file" id="zg-filein" accept=".json,application/json,text/plain" class="hidden">
      <div class="search">${icon('search')}<input class="input" id="zg-q" type="search" placeholder="Name, Nummer …" autocomplete="off" enterkeyhint="search"></div>
      <div class="cats" id="zg-cats" style="margin-top:10px"></div>
      <label class="imp-check"><input type="checkbox" id="zg-only" ${st.only ? 'checked' : ''}><span>Nur Pieces ohne Zuordnung</span></label>
      <p class="hint" id="zg-count"></p>
      <div class="zg-bulk" id="zg-bulk"><span>Alle angezeigten:</span>${ZG.LIST.map(([k, l]) => `<button class="btn small" data-all="${k}">${l}</button>`).join('')}</div>
      <div id="zg-list"></div>
    </div>`;
  const cats = () => { $('#zg-cats', v).innerHTML = `<button class="cat ${!st.cat ? 'on' : ''}" data-c="">Alle</button>` + M().categories.map(c => `<button class="cat ${st.cat === c.name ? 'on' : ''}" data-c="${esc(c.name)}">${esc(c.name)}</button>`).join(''); };
  $('#zg-back', v).onclick = () => { v.remove(); rerender(); };
  $('#zg-q', v).addEventListener('input', e => { st.q = e.target.value; draw(); });
  $('#zg-q', v).addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
  $('#zg-cats', v).onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; st.cat = b.dataset.c; cats(); draw(); };
  $('#zg-only', v).onchange = e => { st.only = e.target.checked; draw(); };
  $('#zg-file', v).onclick = () => $('#zg-filein', v).click();
  $('#zg-filein', v).onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f && await zgFromFile(f)) draw(); };
  $('#zg-bulk', v).onclick = async e => {
    const b = e.target.closest('[data-all]'); if (!b) return;
    const l = list();
    if (!(await confirmSheet(`${l.length} Pieces auf „${ZG.label(b.dataset.all)}“ setzen?`, 'Gilt für alle gerade angezeigten Pieces. Einzelne lassen sich danach wieder umstellen.', 'Übernehmen'))) return;
    await setZg(l, b.dataset.all);
    draw();
  };
  // Einzelne Knöpfe: sofort sichtbar umschalten, im Hintergrund nacheinander speichern
  let queue = Promise.resolve();
  $('#zg-list', v).onclick = e => {
    const b = e.target.closest('.zg-seg button'); if (!b) return;
    const rowEl = b.closest('.zg-row'), p = M().pieces.find(x => x.key === rowEl.dataset.key); if (!p) return;
    const zg = b.classList.contains('on') ? '' : b.dataset.v;
    $$('button', b.parentElement).forEach(x => x.classList.toggle('on', x === b && !!zg));
    rowEl.classList.add('saving');
    queue = queue.then(async () => {
      const cur = M().pieces.find(x => x.key === rowEl.dataset.key);
      const r = cur ? await setZg([cur], zg, true) : null;
      rowEl.classList.remove('saving');
      if (!r || r.conflicts) { draw(); return; }
      if (st.only && zg) { rowEl.classList.add('gone'); setTimeout(draw, 350); } else count($$('.zg-row', v).length);
    });
  };
  cats(); draw();
}

// ================================================================ Papierkorb und Prüfung
function openTrash() {
  const t = M().trash;
  const body = document.createElement('div');
  body.innerHTML = `<p class="hint">Gelöschte Pieces liegen im Ordner „_Papierkorb“ der Sammlung. Ersetzte Einzeldateien finden Sie am PC unter „Papierkorb“ oder im OneDrive.</p>` +
    (t.length ? t.map((e, i) => `<div class="trash-row"><div class="t"><b>${pad3(e.nummer)} · ${esc(e.name)}</b><div class="hint">${esc(e.kategorie)} · ${fmtDate(e.geloescht)}</div></div>
      <button class="btn small gold" data-r="${i}">${icon('restore')}</button><button class="btn small danger" data-k="${i}">${icon('trash')}</button></div>`).join('') : '<p class="faint">Der Papierkorb ist leer.</p>');
  sheet({ title: 'Papierkorb', body, onOpen: (back, close) => body.addEventListener('click', async e => {
    const r = e.target.closest('[data-r]'), k = e.target.closest('[data-k]');
    if (r) { close(); busy('Wird wiederhergestellt …'); try { const note = await Store.restore(t[+r.dataset.r]); unbusy(); rerender(); toast('Wiederhergestellt.' + note, 'ok'); } catch (er) { unbusy(); fail(er); } }
    if (k) {
      close();
      if (!(await confirmSheet('Endgültig löschen?', 'Der Ordner wird aus der Sammlung entfernt. (Er landet zusätzlich noch im OneDrive-Papierkorb.)', 'Endgültig löschen', true))) return;
      busy('Wird gelöscht …'); try { await Store.deleteForever(t[+k.dataset.k]); unbusy(); rerender(); toast('Gelöscht.', 'ok'); } catch (er) { unbusy(); fail(er); }
    }
  }) });
}

function openCheck() {
  const m = M(), ps = m.pieces;
  const withProb = ps.filter(p => realProblems(p).length);
  const body = document.createElement('div');
  body.innerHTML = `<dl class="datalist">
      <dt>Pieces</dt><dd>${ps.length} (${ps.filter(p => p.status === 'Vollständig').length} vollständig, ${ps.filter(p => p.status === 'Entwurf').length} Entwürfe, ${ps.filter(p => p.status === 'Unvollständig').length} unvollständig)</dd>
      <dt>Kleidungstypen</dt><dd>${m.categories.length}</dd></dl>
    <div class="section-title">Ordner ohne Produktdaten (${m.fremd.length})</div>
    ${m.fremd.length ? `<p class="hint">Bitte am PC unter „Prüfen“ als Piece übernehmen.</p>` + m.fremd.map(f => `<div class="hint mono">${esc(f.ordner)}${f.fehler ? ' – ' + esc(f.fehler) : ''}</div>`).join('') : '<p class="faint">Keine.</p>'}
    <div class="section-title">Pieces mit Hinweisen (${withProb.length})</div>
    ${withProb.length ? withProb.map(p => `<button class="menu-item" data-k="${p.key}"><span style="flex:1"><b>${pad3(p.nummer)} · ${esc(p.name)}</b><br><span class="hint">${realProblems(p).map(esc).join('<br>')}</span></span></button>`).join('') : '<p class="faint">Keine – alles in Ordnung.</p>'}`;
  sheet({ title: 'Sammlung prüfen', body, onOpen: (back, close) => body.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) { close(); openDetail(b.dataset.k); } }) });
}

window.addEventListener('popstate', () => {});
boot().catch(e => renderFatal(e.message));
