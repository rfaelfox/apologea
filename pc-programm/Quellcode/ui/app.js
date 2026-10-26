/* APOLOGEA Kollektionsverwaltung – Oberfläche
   Alle Daten liegen als Dateien im Sammlungsordner; diese Oberfläche spricht nur mit dem lokalen Programm. */
'use strict';

// ================================================================ Grundlagen
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s == null ? '' : s).toLocaleLowerCase('de').normalize('NFD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss');
const ROLES = ['design', 'kleidungsansicht', 'mockup'];
const ROLE_LABEL = { design: 'Designmotiv', kleidungsansicht: 'Kleidungsansicht', mockup: 'Mockup' };
const ROLE_SHORT = { design: 'Design', kleidungsansicht: 'Ansicht', mockup: 'Mockup' };
const ROLE_BASE = { design: 'Design', kleidungsansicht: 'Kleidungsansicht', mockup: 'Mockup' };
const BROWSER_IMG = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'];
const IMG_EXT = BROWSER_IMG.concat(['tif', 'tiff', 'psd']);

const store = {
  get(k, d) { try { const v = localStorage.getItem('apologea.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('apologea.' + k, JSON.stringify(v)); } catch (e) { /* nur Komfort */ } }
};

const I = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  sort: '<path d="M7 4v16M3.5 16.5L7 20l3.5-3.5M17 20V4M13.5 7.5L17 4l3.5 3.5"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
  archive: '<rect x="3.5" y="4" width="17" height="4" rx="1"/><path d="M5 8v11.5h14V8M10 12h4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  folder: '<path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5v9.3a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  reveal: '<path d="M20.5 11V8.7A1.5 1.5 0 0 0 19 7.2h-7.8l-2-2.2H5a1.5 1.5 0 0 0-1.5 1.5V17A1.5 1.5 0 0 0 5 18.5h6"/><circle cx="16.5" cy="16" r="3"/><path d="M18.7 18.2l2 2"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  export: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M4.5 15.5v3A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  template: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M4 16V5.5A1.5 1.5 0 0 1 5.5 4H16"/><path d="M14 11v6M11 14h6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  zoomin: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5M8 11h6M11 8v6"/>',
  zoomout: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5M8 11h6"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><circle cx="9" cy="10" r="1.8"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/>',
  upload: '<path d="M12 16V5M7.5 9.5L12 5l4.5 4.5"/><path d="M4.5 15.5v3A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-3"/>',
  file: '<path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20z"/><path d="M14 3.5V8h4"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  restore: '<path d="M4 12a8 8 0 1 0 2.5-5.8L4 8.5"/><path d="M4 4v4.5h4.5"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  swap: '<path d="M7 7h12M15 3l4 4-4 4M17 17H5M9 13l-4 4 4 4"/>',
  code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'
};
const icon = (n, cls) => `<svg class="${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;

const S = {
  status: null,
  data: null,
  byId: new Map(),
  filter: { q: '', kat: '', status: '', koll: '' },
  sort: store.get('sort', 'nummer-auf'),
  cardImg: store.get('cardImg', 'mockup'),
  designBg: store.get('designBg', 'dunkel'),
  visibleIds: [],
  detail: null,
  form: null,
  lastRescan: 0
};

async function api(path, body) {
  const opt = { method: body === undefined ? 'GET' : 'POST', headers: { 'X-Apologea': '1' } };
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let r;
  try { r = await fetch(path, opt); }
  catch (e) { throw new Error('Keine Verbindung zum APOLOGEA-Programm. Bitte prüfen, ob es noch läuft, und gegebenenfalls APOLOGEA.exe neu starten.'); }
  let data = null;
  try { data = await r.json(); } catch (e) { /* keine JSON-Antwort */ }
  if (!r.ok) {
    const err = new Error((data && data.fehler) || ('Die Aktion ist fehlgeschlagen (Fehler ' + r.status + ').'));
    err.status = r.status;
    throw err;
  }
  return data;
}

const enc = encodeURIComponent;
const thumbUrl = (f, w) => `/vorschau?p=${enc(f.pfad)}&w=${w || 480}&v=${enc(f.v || '')}`;
const fileUrl = f => `/datei?p=${enc(f.pfad)}&v=${enc(f.v || '')}`;

function fmtBytes(b) {
  if (b == null) return '';
  if (b < 1024) return b + ' Byte';
  if (b < 1048576) return (b / 1024).toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' KB';
  if (b < 1073741824) return (b / 1048576).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' MB';
  return (b / 1073741824).toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' GB';
}
function fmtDate(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ', ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
}
const extOf = n => { const i = String(n || '').lastIndexOf('.'); return i < 0 ? '' : n.slice(i + 1).toLowerCase(); };
const pad3 = n => String(n).padStart(3, '0');
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

function guessRole(name) {
  const n = norm(name.replace(/\.[^.]+$/, ''));
  if (/kleidungsansicht|motivdarstellung|kleidung|ansicht|flat|front|garment/.test(n)) return 'kleidungsansicht';
  if (/mock|model|lifestyle/.test(n)) return 'mockup';
  if (/design|motiv|druck|print|artwork|grafik/.test(n)) return 'design';
  return null;
}

// ================================================================ Hinweise, Dialoge, Warteanzeige
function toast(msg, kind, opts) {
  opts = opts || {};
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.innerHTML = `<div class="msg">${opts.title ? '<b>' + esc(opts.title) + '</b>' : ''}${esc(msg)}${opts.action ? `<div class="act"><button class="btn small gold">${esc(opts.action.label)}</button></div>` : ''}</div><button aria-label="Hinweis schließen">×</button>`;
  const remove = () => { el.style.opacity = '0'; setTimeout(() => el.remove(), 200); };
  el.lastElementChild.onclick = remove;
  if (opts.action) $('.act button', el).onclick = () => { remove(); opts.action.run(); };
  $('#toasts').appendChild(el);
  setTimeout(remove, opts.ms || (kind === 'err' ? 11000 : 5500));
}
const toastErr = (e, title) => toast(e && e.message ? e.message : String(e), 'err', { title: title || 'Das hat nicht geklappt' });

function layerTop() { const l = $('#layer'); return l.lastElementChild; }

function modal(opts) {
  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(opts.title)}">
      <div class="modal-head"><h2>${esc(opts.title)}</h2><div class="ornament-line"></div></div>
      <div class="modal-body"></div>
      <div class="modal-foot"></div></div>`;
    const body = $('.modal-body', back);
    if (typeof opts.body === 'string') body.innerHTML = opts.body; else if (opts.body) body.appendChild(opts.body);
    const foot = $('.modal-foot', back);
    let done = false;
    const close = v => { if (done) return; done = true; back.remove(); resolve(v); };
    back._close = () => close(null);
    (opts.buttons || [{ label: 'Schließen', value: null }]).forEach(b => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (b.cls || '');
      btn.innerHTML = (b.icon ? icon(b.icon) : '') + esc(b.label);
      btn.onclick = async () => {
        if (b.run) { const keep = await b.run(back); if (keep === false) return; }
        close(b.value);
      };
      foot.appendChild(btn);
    });
    back.addEventListener('mousedown', e => { if (e.target === back && opts.dismiss !== false) close(null); });
    $('#layer').appendChild(back);
    if (opts.onOpen) opts.onOpen(back, close);
    const first = $('input,select,textarea', body) || $('.btn.primary', foot) || $('.btn', foot);
    if (first) setTimeout(() => first.focus(), 30);
  });
}

function confirmDialog(title, text, okLabel, danger) {
  return modal({
    title, body: `<p>${text}</p>`,
    buttons: [{ label: 'Abbrechen', value: false }, { label: okLabel || 'Bestätigen', cls: danger ? 'danger' : 'primary', value: true }]
  }).then(v => !!v);
}

function askText(title, label, value, hint) {
  return new Promise(resolve => {
    let result = null;
    modal({
      title,
      body: `<div class="field"><label for="pd-in">${esc(label)}</label><input id="pd-in" class="input" value="${esc(value || '')}" maxlength="60" autocomplete="off">${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</div>`,
      buttons: [{ label: 'Abbrechen', value: null }, { label: 'Übernehmen', cls: 'primary', run: back => { result = $('#pd-in', back).value.trim(); } }],
      onOpen: back => { $('#pd-in', back).addEventListener('keydown', e => { if (e.key === 'Enter') $('.btn.primary', back).click(); }); }
    }).then(() => resolve(result));
  });
}

let busyEl = null;
function busy(text) {
  unbusy();
  busyEl = document.createElement('div');
  busyEl.className = 'busy-layer';
  busyEl.style.cssText = 'position:fixed;inset:0';
  busyEl.innerHTML = `<div class="busy-box"><div class="spinner"></div><div>${esc(text || 'Bitte warten …')}</div></div>`;
  document.body.appendChild(busyEl);
}
function unbusy() { if (busyEl) { busyEl.remove(); busyEl = null; } }

// ================================================================ Start
async function boot() {
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());
  setInterval(() => api('/api/ping').catch(() => {}), 4000);
  api('/api/ping').catch(() => {});
  document.addEventListener('keydown', onKey);
  window.addEventListener('focus', onFocus);
  document.addEventListener('click', onGlobalClick);
  try { S.status = await api('/api/status'); }
  catch (e) { renderFatal(e.message); return; }
  if (!S.status.sammlung) { renderWelcome(); return; }
  try { await loadData(); }
  catch (e) { renderFatal(e.message); return; }
  renderShell();
  setTimeout(() => updAutoCheck(), 5000);
}

function renderFatal(msg) {
  $('#app').innerHTML = `<div class="welcome"><div class="welcome-box"><div class="wordmark">APOLOGEA</div><div class="ornament-line"></div><p>${esc(msg)}</p><div class="btn-row"><button class="btn gold" id="b-retry">Erneut versuchen</button></div></div></div>`;
  $('#b-retry').onclick = () => location.reload();
}

function renderWelcome() {
  const err = S.status && S.status.startfehler;
  const missing = S.status && S.status.eingestellteSammlung;
  $('#app').innerHTML = `<div class="welcome"><div class="welcome-box">
    <div class="wordmark">APOLOGEA</div><div class="ornament-line"></div>
    <p>Willkommen in der Kollektionsverwaltung. Bitte wählen Sie den Ordner, in dem Ihre Sammlung liegt (z. B. den Ordner „Sammlung“ neben dem Programm) – oder legen Sie eine neue, leere Sammlung an.</p>
    ${err ? `<div class="result-box err">${esc(err)}</div>` : ''}
    ${missing && !err ? `<div class="result-box err">Der zuletzt verwendete Sammlungsordner wurde nicht gefunden:<br><span class="mono">${esc(missing)}</span></div>` : ''}
    <div class="btn-row">
      <button class="btn primary" id="w-choose">${icon('folder')}Sammlungsordner wählen …</button>
      <button class="btn gold" id="w-new">${icon('plus')}Neue leere Sammlung anlegen …</button>
    </div>
    <p class="muted" style="font-size:13.5px;margin-top:22px">Ihre Bilder bleiben immer normale Dateien in normalen Ordnern. Das Programm legt in jedem Produktordner zusätzlich eine „Produktdaten.json“ an.</p>
  </div></div>`;
  $('#w-choose').onclick = () => chooseCollection();
  $('#w-new').onclick = () => newCollection();
}

async function chooseCollection() {
  try {
    const r = await api('/api/einstellungen/sammlung-waehlen', {});
    if (r.abgebrochen) return;
    location.reload();
  } catch (e) { toastErr(e); }
}
async function newCollection() {
  try {
    const r = await api('/api/einstellungen/neue-sammlung', {});
    if (r.abgebrochen) return;
    toast('Die neue Sammlung wurde angelegt: ' + r.status.sammlung, 'ok');
    setTimeout(() => location.reload(), 900);
  } catch (e) { toastErr(e); }
}

async function loadData(data) {
  S.data = data || await api('/api/sammlung');
  S.byId = new Map();
  for (const p of S.data.pieces) {
    p._hay = norm([p.nummer, p.nummerText, p.name, p.motivtitel, p.beschreibung, (p.schlagwoerter || []).join(' '), p.serie, p.kategorie, p.ordnerName].join(' '));
    S.byId.set(p.id, p);
  }
  if (S.filter.kat && !S.data.kategorien.some(k => k.name === S.filter.kat)) S.filter.kat = '';
  await kLoad();
}

// ================================================================ Hauptansicht
function renderShell() {
  $('#app').innerHTML = `<div class="shell">
    <header class="topbar">
      <div class="brand" id="brand"></div>
      <div class="spacer"></div>
      <div class="btn-row">
        <button class="btn ghost" id="b-refresh" title="Sammlungsordner neu einlesen (F5) – erkennt extern geänderte, neue und fehlende Dateien">${icon('refresh')}<span class="lbl">Aktualisieren</span></button>
        <button class="btn ghost" id="b-check" title="Sammlung auf fehlende Dateien, doppelte Nummern und nicht erkannte Ordner prüfen">${icon('shield')}<span class="lbl">Prüfen</span></button>
        <button class="btn ghost" id="b-trash" title="Gelöschte Pieces und ersetzte Dateien wiederherstellen">${icon('trash')}<span class="lbl">Papierkorb</span></button>
        <button class="btn ghost" id="b-backup" title="Vollständige ZIP-Sicherung erstellen">${icon('archive')}<span class="lbl">Sicherung</span></button>
        <button class="btn ghost" id="b-settings" title="Einstellungen">${icon('gear')}<span class="lbl">Einstellungen</span></button>
        <button class="btn ghost" id="b-import" title="Mehrere Pieces aus ZIP-Dateien, Ordnern oder Bildern importieren (wie in der Handy-App)">${icon('upload')}<span class="lbl">Importieren</span></button>
        <button class="btn ghost" id="b-katalog" title="Gestalteten Katalog als PDF erstellen (wie in der Handy-App)">${icon('file')}<span class="lbl">Katalog</span></button>
        <button class="btn primary" id="b-new" title="Neues Piece anlegen (Strg+N)">${icon('plus')}Neues Piece</button>
      </div>
    </header>
    <div class="ornament-line"></div>
    <div class="layout">
      <aside class="sidebar" id="sidebar"></aside>
      <main class="catalog">
        <div class="toolbar">
          <div class="search">${icon('search')}<input class="input" id="q" type="search" placeholder="Suchen: Name, Nummer, Beschreibung, Schlagwort …" autocomplete="off" value="${esc(S.filter.q)}"></div>
          <select class="input" id="sort" title="Sortierung">
            <option value="nummer-auf">Nummer aufsteigend</option>
            <option value="nummer-ab">Nummer absteigend</option>
            <option value="name-auf">Name A–Z</option>
            <option value="name-ab">Name Z–A</option>
            <option value="erstellt-neu">Erstellt: neueste zuerst</option>
            <option value="erstellt-alt">Erstellt: älteste zuerst</option>
            <option value="geaendert-neu">Zuletzt geändert</option>
          </select>
          <span class="tool-label">Kartenbild</span>
          <div class="seg" id="cardimg">
            <button data-v="mockup">Mockup</button><button data-v="design">Design</button><button data-v="kleidungsansicht">Ansicht</button>
          </div>
          <span class="tool-label">Designhintergrund</span>
          <div class="bg-switch" id="bgswitch" title="Hintergrund für transparente Designs">
            <button class="s-dunkel" data-v="dunkel" title="Dunkel"></button><button class="s-hell" data-v="hell" title="Hell"></button><button class="s-schach" data-v="schach" title="Schachbrett (zeigt Transparenz)"></button>
          </div>
          <span class="count-label" id="count"></span>
        </div>
        <div id="updatebar"></div>
        <div id="notices"></div>
        <div id="collbar"></div>
        <div class="grid-wrap" id="gridwrap"><div class="grid" id="grid"></div></div>
      </main>
    </div>
  </div>`;
  renderBrand();
  $('#b-new').onclick = () => openForm('neu');
  $('#b-import').onclick = () => openImport();
  $('#b-katalog').onclick = () => openCatalog();
  $('#b-refresh').onclick = () => rescan(false);
  $('#b-check').onclick = () => openCheck();
  $('#b-trash').onclick = () => openTrash();
  $('#b-backup').onclick = () => openBackup();
  $('#b-settings').onclick = () => openSettings();
  const q = $('#q');
  q.addEventListener('input', debounce(() => { S.filter.q = q.value; renderGrid(); }, 120));
  $('#sort').value = S.sort;
  $('#sort').onchange = e => { S.sort = e.target.value; store.set('sort', S.sort); renderGrid(); };
  $('#cardimg').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.cardImg = b.dataset.v; store.set('cardImg', S.cardImg); renderGrid(); };
  $('#bgswitch').onclick = e => { const b = e.target.closest('button'); if (!b) return; setDesignBg(b.dataset.v); };
  const grid = $('#grid');
  grid.addEventListener('click', async e => {
    const rm = e.target.closest('.coll-rm');
    if (rm) {
      e.stopPropagation();
      const c = kById(S.filter.koll), p = S.byId.get(rm.dataset.rm);
      if (c && p && await confirmDialog('Aus Kollektion entfernen?', `<b>Nr. ${p.nummerText} · ${esc(p.name)}</b> wird aus „${esc(c.name)}“ entfernt. Das Piece selbst bleibt in der Sammlung.`, 'Entfernen', true)) kRemove(c, [p.id]);
      return;
    }
    const c = e.target.closest('.card'); if (c) openDetail(c.dataset.id);
  });
  grid.addEventListener('keydown', e => { if (e.key === 'Enter') { const c = e.target.closest('.card'); if (c) openDetail(c.dataset.id); } });
  grid.addEventListener('error', e => {
    if (e.target.tagName !== 'IMG') return;
    const box = e.target.parentElement;
    e.target.remove();
    box.insertAdjacentHTML('beforeend', `<div class="missing-img">${icon('warn')}Vorschau nicht möglich – Datei beschädigt oder nicht lesbar</div>`);
  }, true);
  renderSidebar();
  renderGrid();
}

function renderBrand() {
  const el = $('#brand');
  if (!el) return;
  el.innerHTML = S.status && S.status.logo
    ? `<img class="brand-logo" src="/logo?${Date.now()}" alt="APOLOGEA">`
    : `<div class="wordmark">APOLOGEA</div><div class="brand-sub">Kollektion</div>`;
}

function setDesignBg(v) {
  S.designBg = v;
  store.set('designBg', v);
  $$('.bg-switch button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  $$('.design-bg').forEach(el => { el.classList.remove('bg-dunkel', 'bg-hell', 'bg-schach'); el.classList.add('bg-' + v); });
}

function statusOf(p) {
  if (p.status === 'Entwurf') return 'entwurf';
  if (p.status === 'Unvollständig') return 'unvollstaendig';
  return 'vollstaendig';
}
function realProblems(p) {
  // Hinweise, die über den bloßen Status hinausgehen
  return (p.probleme || []).filter(x => !/^Kein Bild für/.test(x) || p.status === 'Vollständig');
}

function renderSidebar() {
  const sb = $('#sidebar');
  if (!sb) return;
  const ps = S.data.pieces;
  const cnt = f => ps.filter(f).length;
  const nProb = cnt(p => realProblems(p).length > 0);
  const item = (kind, v, label, n, extra) => `<li><button class="nav-item ${extra || ''} ${S.filter[kind] === v ? 'active' : ''}" data-kind="${kind}" data-v="${esc(v)}"><span>${esc(label)}</span><span class="count">${n}</span></button></li>`;
  sb.innerHTML = `
    <div class="section-title">Kleidungstypen</div>
    <ul class="nav-list">
      ${item('kat', '', 'Alle Pieces', ps.length)}
      ${S.data.kategorien.map(k => item('kat', k.name, k.name, k.anzahl)).join('')}
    </ul>
    <button class="btn ghost small nav-add" id="b-newcat">${icon('plus')}Neuer Kleidungstyp …</button>
    <div class="section-title">Status</div>
    <ul class="nav-list">
      ${item('status', '', 'Alle', ps.length)}
      ${item('status', 'vollstaendig', 'Vollständig', cnt(p => p.status === 'Vollständig'))}
      ${item('status', 'entwurf', 'Entwürfe', cnt(p => p.status === 'Entwurf'))}
      ${item('status', 'unvollstaendig', 'Unvollständig', cnt(p => p.status === 'Unvollständig'), cnt(p => p.status === 'Unvollständig') ? 'warn' : '')}
      ${item('status', 'hinweise', 'Mit Hinweisen', nProb, nProb ? 'warn' : '')}
    </ul>
    ${kSidebarHtml()}
    <div class="side-foot">
      <div class="label" style="margin-bottom:4px">Sammlungsordner</div>
      <div class="mono" title="${esc(S.data.pfad)}">${esc(S.data.pfad)}</div>
      <button class="btn small gold" id="b-openroot">${icon('folder')}Im Explorer öffnen</button>
    </div>`;
  sb.onclick = e => {
    const b = e.target.closest('.nav-item');
    if (!b) return;
    // Kollektion und Kleidungstyp/Status schließen sich aus
    if (b.dataset.kind === 'koll') { S.filter.kat = ''; S.filter.status = ''; } else S.filter.koll = '';
    S.filter[b.dataset.kind] = b.dataset.v;
    renderSidebar();
    renderGrid();
    $('#gridwrap').scrollTop = 0;
  };
  $('#b-newcat').onclick = async () => { const n = await createCategoryDialog(); if (n) { S.filter.kat = n; renderSidebar(); renderGrid(); } };
  $('#b-openroot').onclick = () => osAction('ordner', { pfad: S.data.pfad });
  $('#b-newkoll').onclick = () => kEdit(null);
  // Hinweisleiste für nicht erkannte Ordner
  const nf = S.data.fremdordner.length;
  const notices = $('#notices');
  if (notices) {
    notices.innerHTML = nf ? `<div class="notice-bar">${icon('warn')}<span>${nf === 1 ? 'Ein Ordner' : nf + ' Ordner'} ohne Produktdaten im Sammlungsordner gefunden (z. B. von Hand angelegt).</span><button class="btn small gold" id="b-fremd">Ansehen und übernehmen</button></div>` : '';
    if (nf) $('#b-fremd').onclick = () => openCheck();
  }
}

function filteredPieces() {
  const terms = norm(S.filter.q).split(/\s+/).filter(Boolean);
  const st = S.filter.status;
  const koll = S.filter.koll && kById(S.filter.koll);
  if (koll) return kPieces(koll).filter(p => terms.every(t => p._hay.includes(t)));
  let list = S.data.pieces.filter(p =>
    (!S.filter.kat || p.kategorie === S.filter.kat) &&
    (!st || (st === 'hinweise' ? realProblems(p).length > 0 : statusOf(p) === st)) &&
    terms.every(t => p._hay.includes(t)));
  const by = {
    'nummer-auf': (a, b) => a.nummer - b.nummer,
    'nummer-ab': (a, b) => b.nummer - a.nummer,
    'name-auf': (a, b) => a.name.localeCompare(b.name, 'de') || a.nummer - b.nummer,
    'name-ab': (a, b) => b.name.localeCompare(a.name, 'de') || a.nummer - b.nummer,
    'erstellt-neu': (a, b) => (b.erstellt || '').localeCompare(a.erstellt || '') || b.nummer - a.nummer,
    'erstellt-alt': (a, b) => (a.erstellt || '').localeCompare(b.erstellt || '') || a.nummer - b.nummer,
    'geaendert-neu': (a, b) => (b.geaendert || '').localeCompare(a.geaendert || '') || b.nummer - a.nummer
  }[S.sort] || ((a, b) => a.nummer - b.nummer);
  list.sort(by);
  // Exakte Nummer zuerst, wenn nach einer Zahl gesucht wird
  if (terms.length === 1 && /^\d+$/.test(terms[0])) {
    const n = parseInt(terms[0], 10);
    list.sort((a, b) => (b.nummer === n) - (a.nummer === n));
  }
  return list;
}

function cardHtml(p) {
  let used = S.cardImg, f = p.bilder[used];
  if (!f || !f.vorhanden || !f.vorschau) {
    f = null;
    for (const r of ['mockup', 'design', 'kleidungsansicht']) { const g = p.bilder[r]; if (g && g.vorhanden && g.vorschau) { f = g; used = r; break; } }
  }
  const missing = ROLES.filter(r => !p.bilder[r] || !p.bilder[r].vorhanden);
  const isDesign = used === 'design';
  const img = f
    ? `<img loading="lazy" decoding="async" src="${thumbUrl(f, 480)}" class="${isDesign ? 'contain' : ''}" alt="${esc(p.name)} – ${ROLE_LABEL[used]}">`
    : `<div class="missing-img">${icon('image')}Kein Bild vorhanden</div>`;
  const badges = [];
  if (p.status === 'Entwurf') badges.push('<span class="badge entwurf">Entwurf</span>');
  if (missing.length) badges.push(`<span class="badge fehlt">${missing.length === 3 ? 'Keine Bilder' : 'Fehlt: ' + missing.map(r => ROLE_SHORT[r]).join(', ')}</span>`);
  if (f && used !== S.cardImg) badges.push(`<span class="badge">zeigt ${ROLE_SHORT[used]}</span>`);
  const prob = realProblems(p).filter(x => !/fehlt:/.test(x));
  if (prob.length) badges.push(`<span class="badge hinweis" title="${esc(prob.join('\n'))}">Hinweis</span>`);
  return `<article class="card" tabindex="0" data-id="${p.id}" aria-label="${esc(p.nummerText + ' ' + p.name)}">
    <div class="card-img ${isDesign ? 'design-bg bg-' + S.designBg : ''}">${img}<div class="badges">${badges.join('')}</div></div>
    <div class="card-body">
      <div class="card-nr">Nr. ${p.nummerText}</div>
      <h3 class="card-name">${esc(p.name)}</h3>
      <div class="card-sub" title="${esc(p.kategorie + (p.motivtitel ? ' · ' + p.motivtitel : ''))}">${esc(p.kategorie)}${p.motivtitel ? ' · ' + esc(p.motivtitel) : ''}</div>
      <div class="dots">${ROLES.map(r => `<span class="dot ${p.bilder[r] && p.bilder[r].vorhanden ? 'ok' : 'no'}" title="${ROLE_LABEL[r]}: ${p.bilder[r] && p.bilder[r].vorhanden ? 'vorhanden' : 'fehlt'}">${ROLE_SHORT[r]}</span>`).join('')}</div>
    </div>
  </article>`;
}

function renderGrid() {
  const grid = $('#grid');
  if (!grid) return;
  const list = filteredPieces();
  S.visibleIds = list.map(p => p.id);
  $$('#cardimg button').forEach(b => b.classList.toggle('on', b.dataset.v === S.cardImg));
  $$('#bgswitch button').forEach(b => b.classList.toggle('on', b.dataset.v === S.designBg));
  const total = S.data.pieces.length;
  const koll = S.filter.koll && kById(S.filter.koll);
  const bar = $('#collbar');
  if (bar) { bar.innerHTML = koll ? kBarHtml(koll) : ''; if (koll) kBindBar(koll); }
  $('#count').innerHTML = list.length === total ? `<b>${total}</b> Pieces` : `<b>${list.length}</b> von ${total} Pieces`;
  if (!list.length) {
    grid.innerHTML = total
      ? koll && !S.filter.q ? `<div class="empty" style="grid-column:1/-1"><div class="wordmark">${esc(koll.name)}</div>Diese Kollektion enthält noch keine Pieces.<br><br><button class="btn primary" id="b-kpick">${icon('plus')}Pieces wählen</button></div>` : `<div class="empty" style="grid-column:1/-1"><div class="wordmark">KEINE TREFFER</div>Zu dieser Suche bzw. diesem Filter gibt es keine Pieces.<br><br><button class="btn gold" id="b-reset">Filter zurücksetzen</button></div>`
      : `<div class="empty" style="grid-column:1/-1"><div class="wordmark">APOLOGEA</div>Die Sammlung ist noch leer.<br><br><button class="btn primary" id="b-first">${icon('plus')}Erstes Piece anlegen</button></div>`;
    const r = $('#b-reset'); if (r) r.onclick = () => { S.filter = { q: '', kat: '', status: '', koll: '' }; $('#q').value = ''; renderSidebar(); renderGrid(); };
    const f = $('#b-first'); if (f) f.onclick = () => openForm('neu');
    const kp = $('#b-kpick'); if (kp) kp.onclick = () => kPick(koll);
    return;
  }
  grid.innerHTML = koll
    ? list.map(p => cardHtml(p).replace(/^(\s*<article[^>]*>)/, `$1<button class="coll-rm" data-rm="${esc(p.id)}" title="Aus Kollektion entfernen" aria-label="Aus Kollektion entfernen">✕</button>`)).join('')
    : list.map(cardHtml).join('');
}

async function rescan(silent) {
  if (!S.data) return;
  S.lastRescan = Date.now();
  try {
    const r = await api('/api/aktualisieren', {});
    await loadData(r.sammlung);
    renderSidebar();
    renderGrid();
    const a = r.aenderungen;
    const n = a.geaendert + a.neu + a.entfernt;
    const parts = [];
    if (a.geaendert) parts.push(a.geaendert === 1 ? '1 Piece mit geänderten Dateien' : a.geaendert + ' Pieces mit geänderten Dateien');
    if (a.neu) parts.push(a.neu + ' neu erkannt');
    if (a.entfernt) parts.push(a.entfernt + ' nicht mehr vorhanden');
    if (n) toast(parts.join(', ') + '. Ansicht wurde aktualisiert.', '', { title: 'Änderungen im Sammlungsordner erkannt' });
    else if (!silent) toast('Keine Änderungen gefunden. ' + S.data.pieces.length + ' Pieces eingelesen.', 'ok', { title: 'Sammlung neu eingelesen' });
    (a.hinweise || []).forEach(h => toast(h, '', { title: 'Hinweis', ms: 9000 }));
    if (S.detail && !$('.lightbox')) {
      if (S.byId.has(S.detail.id)) { if (n || !silent) openDetail(S.detail.id, true); }
      else { closeDetail(); toast('Das geöffnete Piece ist nicht mehr am bisherigen Ort. Wurde der Ordner verschoben oder gelöscht?', 'err'); }
    }
  } catch (e) { if (!silent) toastErr(e); }
}

function onFocus() {
  if (!S.data || S.form) return;
  if (Date.now() - S.lastRescan < 4000) return;
  if ($('.modal-back') || $('.busy-layer')) return;
  rescan(true);
}

// ================================================================ Explorer-Aktionen
async function osAction(act, payload) {
  const map = { oeffnen: '/api/os/oeffnen', anzeigen: '/api/os/anzeigen', kopieren: '/api/os/pfad-kopieren', exportieren: '/api/os/exportieren', ordner: '/api/os/ordner', 'ordner-exportieren': '/api/os/ordner-exportieren' };
  try {
    const r = await api(map[act], payload);
    if (r.abgebrochen) return;
    if (act === 'oeffnen') toast('Die Datei wird mit dem unter Windows zugeordneten Programm geöffnet. Nach dem Speichern dort genügt „Aktualisieren“.', 'ok');
    else if (act === 'kopieren') toast(r.pfad, 'ok', { title: 'Dateipfad in die Zwischenablage kopiert' });
    else if (act === 'exportieren') toast(r.ziel, 'ok', { title: 'Kopie gespeichert – Original unverändert' });
    else if (act === 'ordner-exportieren') toast(r.ziel, 'ok', { title: 'Produktordner kopiert' });
  } catch (e) {
    toastErr(e);
    if (e.status === 404) rescan(true);
  }
}

function onGlobalClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  const payload = {};
  if (b.dataset.pfad) payload.pfad = b.dataset.pfad;
  if (b.dataset.id) payload.id = b.dataset.id;
  osAction(b.dataset.act, payload);
}

function fileButtons(f, pieceId, compact) {
  if (!f || !f.vorhanden) return '';
  const p = esc(f.pfad), id = esc(pieceId || '');
  const s = compact ? 'small icon-only' : 'small';
  const lab = t => compact ? '' : t;
  return `<button class="btn ${s} gold" data-act="oeffnen" data-pfad="${p}" title="Datei mit dem zugeordneten Windows-Programm öffnen">${icon('open')}${lab('Datei öffnen')}</button>
    <button class="btn ${s} ghost" data-act="anzeigen" data-pfad="${p}" title="Datei im Explorer anzeigen">${icon('reveal')}${lab('Im Explorer')}</button>
    <button class="btn ${s} ghost" data-act="kopieren" data-pfad="${p}" title="Vollständigen Dateipfad kopieren">${icon('copy')}${lab('Pfad kopieren')}</button>
    <button class="btn ${s} ghost" data-act="exportieren" data-pfad="${p}" data-id="${id}" title="Originaldatei an einen gewählten Ort kopieren">${icon('export')}${lab('Exportieren')}</button>`;
}

// ================================================================ Detailansicht
function descHtml(t) {
  if (!t || !t.trim()) return '<p class="faint">Keine Beschreibung hinterlegt.</p>';
  return t.split('\n').map(line => {
    const m = line.match(/^([^:]{2,32}):\s+(.*)$/);
    if (m) return `<p><span class="k">${esc(m[1])}:</span> ${esc(m[2])}</p>`;
    return line.trim() ? `<p>${esc(line)}</p>` : '';
  }).join('');
}

async function openDetail(id, keepScroll) {
  let p;
  try { p = await api('/api/piece?id=' + enc(id)); }
  catch (e) { toastErr(e); if (e.status === 404) rescan(true); return; }
  S.detail = p;
  let view = $('#detail');
  const scroll = view && keepScroll ? $('.view-body', view).scrollTop : 0;
  if (!view) {
    view = document.createElement('div');
    view.id = 'detail';
    view.className = 'view';
    $('#layer').prepend(view);
  }
  const idx = S.visibleIds.indexOf(p.id);
  const prev = idx > 0 ? S.visibleIds[idx - 1] : null;
  const next = idx >= 0 && idx < S.visibleIds.length - 1 ? S.visibleIds[idx + 1] : null;
  const st = p.status;
  const probs = p.probleme || [];
  view.innerHTML = `
    <div class="view-head">
      <button class="btn ghost" id="d-back">${icon('back')}Zurück zum Katalog</button>
      <div class="spacer"></div>
      ${idx >= 0 ? `<span class="muted" style="font-size:13px">${idx + 1} von ${S.visibleIds.length}</span>` : ''}
      <button class="btn ghost icon-only" id="d-prev" ${prev ? '' : 'disabled'} title="Vorheriges Piece (Pfeil links)">${icon('left')}</button>
      <button class="btn ghost icon-only" id="d-next" ${next ? '' : 'disabled'} title="Nächstes Piece (Pfeil rechts)">${icon('right')}</button>
    </div>
    <div class="view-body"><div class="view-inner">
      <div class="detail-title">
        <div>
          <div class="nr">Nr. ${p.nummerText} · ${esc(p.kategorie)}</div>
          <h1>${esc(p.name)}</h1>
          ${p.motivtitel ? `<div class="motiv">${esc(p.motivtitel)}</div>` : ''}
        </div>
        <div class="badges">
          <span class="badge ${st === 'Vollständig' ? 'ok' : st === 'Entwurf' ? 'entwurf' : 'unvollstaendig'}">${st}</span>
          ${probs.length ? `<span class="badge hinweis">${probs.length} Hinweis${probs.length > 1 ? 'e' : ''}</span>` : ''}
        </div>
      </div>
      <div class="detail-actions">
        <button class="btn primary" id="d-edit">${icon('edit')}Bearbeiten</button>
        <button class="btn gold" id="d-tpl" title="Neues Piece mit Kopien dieser Angaben und Dateien anlegen – das Original bleibt unverändert">${icon('template')}Als Vorlage verwenden</button>
        <span class="sep"></span>
        <button class="btn" data-act="ordner" data-id="${p.id}">${icon('folder')}Produktordner im Explorer öffnen</button>
        <button class="btn ghost" data-act="ordner-exportieren" data-id="${p.id}" title="Den ganzen Produktordner an einen anderen Ort kopieren">${icon('export')}Ordner exportieren</button>
        <span class="spacer" style="flex:1"></span>
        <button class="btn danger" id="d-trash">${icon('trash')}In den Papierkorb</button>
      </div>
      ${probs.length ? `<div class="section-title">Hinweise</div><ul class="problems">${probs.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <div class="images3">${ROLES.map(r => imgPanel(p, r)).join('')}</div>
      <div class="info-grid">
        <div>
          <div class="section-title">Beschreibung</div>
          <div class="desc">${descHtml(p.beschreibung)}</div>
          ${(p.schlagwoerter || []).length ? `<div class="section-title" style="margin-top:22px">Schlagwörter</div><div class="btn-row">${p.schlagwoerter.map(t => `<span class="chip static">${esc(t)}</span>`).join('')}</div>` : ''}
          <div id="d-coll"></div>
        </div>
        <div>
          <div class="section-title">Produktdaten</div>
          <dl class="datalist">
            <dt>Piece-Nummer</dt><dd>${p.nummerText}</dd>
            <dt>Produktname</dt><dd>${esc(p.name)}</dd>
            <dt>Kleidungstyp</dt><dd>${esc(p.kategorie)}</dd>
            ${p.motivtitel ? `<dt>Motivtitel</dt><dd>${esc(p.motivtitel)}</dd>` : ''}
            ${p.serie ? `<dt>Serie</dt><dd>${esc(p.serie)}</dd>` : ''}
            <dt>Status</dt><dd>${st}</dd>
            <dt>Erstellt</dt><dd>${fmtDate(p.erstellt)}</dd>
            <dt>Zuletzt geändert</dt><dd>${fmtDate(p.geaendert)}</dd>
            ${p.vorlageTitel ? `<dt>Vorlage</dt><dd>${esc(p.vorlageTitel)}</dd>` : ''}
            ${p.herkunft ? `<dt>Herkunft</dt><dd>${esc(p.herkunft)}</dd>` : ''}
            <dt>Produktordner</dt><dd><span class="mono">${esc(p.ordner)}</span><div class="btn-row" style="margin-top:6px">
              <button class="btn small gold" data-act="ordner" data-id="${p.id}">${icon('folder')}Öffnen</button>
              <button class="btn small ghost" data-act="kopieren" data-pfad="${esc(p.ordnerVoll)}">${icon('copy')}Pfad kopieren</button></div></dd>
          </dl>
        </div>
      </div>
      <div class="section-title">Arbeitsdateien</div>
      ${p.arbeitsdateien.length ? `<div class="filelist">${p.arbeitsdateien.map(f => fileRow(f, p, false)).join('')}</div>` : '<p class="faint" style="margin:-4px 0 26px">Keine zusätzlichen Arbeitsdateien hinterlegt. Über „Bearbeiten“ lassen sich beliebige Dateien (z. B. PSD, AI, PDF, Konzepte) hinzufügen.</p>'}
      ${p.unzugeordnet.length ? `<div class="section-title">Nicht zugeordnete Dateien im Produktordner</div>
        <p class="muted" style="margin:-4px 0 10px;font-size:14px">Diese Dateien liegen im Ordner, sind aber keiner Rolle zugeordnet – z. B. weil sie im Explorer hinzugefügt wurden.</p>
        <div class="filelist">${p.unzugeordnet.map(f => fileRow(f, p, true)).join('')}</div>` : ''}
    </div></div>`;
  $('.view-body', view).scrollTop = scroll;
  $('#d-back').onclick = closeDetail;
  if (prev) $('#d-prev').onclick = () => openDetail(prev);
  if (next) $('#d-next').onclick = () => openDetail(next);
  $('#d-edit').onclick = () => openForm('bearbeiten', p);
  $('#d-tpl').onclick = () => openForm('vorlage', p);
  $('#d-trash').onclick = () => trashPiece(p);
  $$('[data-editnow]', view).forEach(b => b.onclick = () => openForm('bearbeiten', p));
  $$('.imgpanel-stage[data-role]', view).forEach(st => st.onclick = () => openLightboxFor(p, st.dataset.role));
  $$('.assign-sel', view).forEach(sel => sel.onchange = () => assignFile(p, sel.dataset.datei, sel.value, sel));
  $$('.bg-switch', view).forEach(sw => sw.onclick = e => { const b = e.target.closest('button'); if (b) setDesignBg(b.dataset.v); });
  $$('.bg-switch button', view).forEach(b => b.classList.toggle('on', b.dataset.v === S.designBg));
  kFillDetail(p, $('#d-coll', view));
}

function imgPanel(p, role) {
  const f = p.bilder[role];
  const isDesign = role === 'design';
  const head = `<div class="imgpanel-head"><span class="label">${ROLE_LABEL[role]}</span>${isDesign ? `<span class="bg-switch" title="Hintergrund der Vorschau"><button class="s-dunkel" data-v="dunkel" title="Dunkel"></button><button class="s-hell" data-v="hell" title="Hell"></button><button class="s-schach" data-v="schach" title="Schachbrett"></button></span>` : ''}</div>`;
  if (!f || !f.vorhanden) {
    const imgs = p.unzugeordnet.filter(u => u.bild);
    return `<div class="imgpanel">${head}
      <div class="imgpanel-stage noimg"><div class="missing-img">${icon('warn')}<div>${f ? `Datei fehlt:<br><b>${esc(f.name)}</b><br><span class="faint">Wurde sie verschoben, umbenannt oder gelöscht?</span>` : 'Kein Bild hinterlegt'}</div></div></div>
      <div class="imgpanel-meta">${imgs.length ? `<label class="label">Vorhandene Datei aus dem Ordner zuordnen</label>
        <select class="input assign-sel" data-datei="" data-role="${role}" style="margin-top:6px"><option value="">Datei auswählen …</option>${imgs.map(u => `<option value="${esc(u.datei)}">${esc(u.datei)}</option>`).join('')}</select>` : '<span class="faint">Über „Bearbeiten“ ein Bild hinzufügen.</span>'}</div>
      <div class="imgpanel-actions"><button class="btn small gold" data-editnow>${icon('upload')}Bild ergänzen</button></div></div>`;
  }
  const dims = f.breite ? `${f.breite} × ${f.hoehe} px · ` : '';
  const fmt = (f.format || f.ext || '').toUpperCase();
  const stage = f.vorschau
    ? `<img src="${thumbUrl(f, 900)}" alt="${esc(ROLE_LABEL[role])}" loading="lazy"><span class="zoom-hint btn small">${icon('zoomin')}Vergrößern</span>`
    : `<div class="missing-img" style="color:var(--muted)">${icon('file')}Keine Vorschau für .${esc(f.ext)} – bitte „Datei öffnen“</div>`;
  return `<div class="imgpanel">${head}
    <div class="imgpanel-stage ${isDesign ? 'design-bg bg-' + S.designBg : ''}" ${f.vorschau ? `data-role="${role}"` : ''}>${stage}</div>
    <div class="imgpanel-meta"><div class="fname">${esc(f.datei)}</div>${dims}${fmt} · ${fmtBytes(f.groesse)}</div>
    <div class="imgpanel-actions">${fileButtons(f, p.id)}</div></div>`;
}

function fileRow(f, p, unassigned) {
  const thumb = f.bild && f.vorhanden && f.vorschau ? `<img class="thumb" src="${thumbUrl(f, 120)}" alt="">` : `<span class="thumb" style="display:flex;align-items:center;justify-content:center;background:var(--panel-3)">${icon('file')}</span>`;
  const assign = unassigned ? `<select class="input assign-sel" data-datei="${esc(f.datei)}" title="Datei einer Rolle zuordnen">
      <option value="">Zuordnen als …</option>
      ${f.bild ? ROLES.map(r => `<option value="${r}">${ROLE_LABEL[r]}${p.bilder[r] && p.bilder[r].vorhanden ? ' (ersetzt Zuordnung)' : ''}</option>`).join('') : ''}
      <option value="arbeitsdatei">Arbeitsdatei</option></select>` : '';
  return `<div class="filerow ${f.vorhanden ? '' : 'missing'}">${thumb}
    <div class="fn">${esc(f.datei)}${f.vorhanden ? `<small>${fmtBytes(f.groesse)} · geändert ${fmtDate(f.geaendert)}</small>` : '<small style="color:var(--danger)">fehlt im Produktordner</small>'}</div>
    ${assign}
    <div class="btn-row">${fileButtons(f, p.id, true)}</div></div>`;
}

async function assignFile(p, datei, value, sel) {
  if (!value) return;
  let rolle = value, file = datei;
  if (!datei) { file = value; rolle = sel.dataset.role; }
  const label = rolle === 'arbeitsdatei' ? 'Arbeitsdatei' : ROLE_LABEL[rolle];
  if (rolle !== 'arbeitsdatei' && p.bilder[rolle] && p.bilder[rolle].vorhanden) {
    const ok = await confirmDialog('Zuordnung ändern', `„${esc(file)}“ wird als ${label} verwendet. Die bisher zugeordnete Datei „${esc(p.bilder[rolle].datei)}“ bleibt unverändert im Produktordner liegen und erscheint danach unter „Nicht zugeordnete Dateien“.`, 'Zuordnen');
    if (!ok) { sel.value = ''; return; }
  }
  try {
    await api('/api/zuordnen', { id: p.id, datei: file, rolle });
    toast(`„${file}“ ist jetzt als ${label} zugeordnet.`, 'ok');
    await loadData();
    renderSidebar(); renderGrid();
    openDetail(p.id, true);
  } catch (e) { toastErr(e); sel.value = ''; }
}

function closeDetail() {
  const v = $('#detail');
  if (v) v.remove();
  S.detail = null;
}

async function trashPiece(p) {
  const ok = await confirmDialog('In den Papierkorb verschieben?',
    `Das Piece <b>${esc(p.nummerText + ' · ' + p.name)}</b> wird mit seinem gesamten Produktordner in den Papierkorb der Sammlung verschoben (<span class="mono">_Papierkorb</span>). Es lässt sich dort jederzeit wiederherstellen. Die Nummer ${p.nummerText} bleibt bis zum endgültigen Löschen reserviert.`,
    'In den Papierkorb', true);
  if (!ok) return;
  try {
    await api('/api/papierkorb/verschieben', { id: p.id });
    closeDetail();
    await loadData();
    renderSidebar(); renderGrid();
    toast(`${p.nummerText} · ${p.name} liegt jetzt im Papierkorb.`, 'ok', { action: { label: 'Papierkorb öffnen', run: openTrash } });
  } catch (e) { toastErr(e); }
}

// ================================================================ Große Bildansicht
function openLightboxFor(p, role) {
  const items = ROLES.filter(r => p.bilder[r] && p.bilder[r].vorhanden && p.bilder[r].vorschau)
    .map(r => ({ f: p.bilder[r], role: r, title: `${p.nummerText} · ${p.name}`, sub: ROLE_LABEL[r] + ' – ' + p.bilder[r].datei }));
  const start = Math.max(0, items.findIndex(i => i.role === role));
  openLightbox(items, start);
}

function openLightbox(items, index) {
  if (!items.length) return;
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  lb.innerHTML = `<div class="lb-bar">
      <div class="lb-title"></div><div style="flex:1"></div>
      <span class="tool-label">Hintergrund</span>
      <span class="bg-switch"><button class="s-dunkel" data-v="dunkel" title="Dunkel"></button><button class="s-hell" data-v="hell" title="Hell"></button><button class="s-schach" data-v="schach" title="Schachbrett"></button></span>
      <button class="btn small ghost icon-only" data-z="out" title="Verkleinern (−)">${icon('zoomout')}</button>
      <span class="lb-zoom"></span>
      <button class="btn small ghost icon-only" data-z="in" title="Vergrößern (+)">${icon('zoomin')}</button>
      <button class="btn small ghost" data-z="fit" title="Einpassen (0)">${icon('fit')}Einpassen</button>
      <button class="btn small ghost" data-z="100" title="Originalgröße (1)">100 %</button>
      <button class="btn small gold" data-open>${icon('open')}Datei öffnen</button>
      <button class="btn small ghost icon-only" data-close title="Schließen (Esc)">${icon('close')}</button>
    </div>
    <div class="lb-stage"><img alt=""></div>`;
  $('#layer').appendChild(lb);
  const stage = $('.lb-stage', lb), img = $('img', stage);
  let i = index, scale = 1, x = 0, y = 0, fit = true;
  if (items.length > 1) {
    stage.insertAdjacentHTML('beforeend', `<button class="btn icon-only lb-nav prev" title="Vorheriges Bild">${icon('left')}</button><button class="btn icon-only lb-nav next" title="Nächstes Bild">${icon('right')}</button>`);
    $('.prev', stage).onclick = e => { e.stopPropagation(); show(i - 1); };
    $('.next', stage).onclick = e => { e.stopPropagation(); show(i + 1); };
  }
  const apply = () => { img.style.transform = `translate(${x}px,${y}px) scale(${scale})`; $('.lb-zoom', lb).textContent = Math.round(scale * 100) + ' %'; };
  const doFit = () => {
    const w = img.naturalWidth, h = img.naturalHeight, sw = stage.clientWidth - 40, sh = stage.clientHeight - 40;
    if (!w) return;
    scale = Math.min(sw / w, sh / h, 1);
    x = (stage.clientWidth - w * scale) / 2; y = (stage.clientHeight - h * scale) / 2; fit = true; apply();
  };
  const zoomAt = (factor, cx, cy) => {
    const ns = Math.min(8, Math.max(0.05, scale * factor));
    x = cx - (cx - x) * (ns / scale); y = cy - (cy - y) * (ns / scale); scale = ns; fit = false; apply();
  };
  const setBg = v => {
    stage.classList.remove('bg-dunkel', 'bg-hell', 'bg-schach');
    if (items[i].role === 'design') stage.classList.add('bg-' + v);
    $$('.bg-switch button', lb).forEach(b => b.classList.toggle('on', b.dataset.v === v));
  };
  function show(n) {
    i = (n + items.length) % items.length;
    const it = items[i];
    $('.lb-title', lb).innerHTML = `${esc(it.title)}<small>${esc(it.sub)}</small>`;
    img.style.opacity = '0';
    img.onload = () => { img.style.opacity = '1'; doFit(); };
    img.onerror = () => { $('.lb-title', lb).innerHTML += '<small style="color:var(--danger)"> – Bild konnte nicht geladen werden</small>'; };
    img.src = BROWSER_IMG.includes((it.f.format || it.f.ext || '').toLowerCase()) ? fileUrl(it.f) : thumbUrl(it.f, 2400);
    setBg(S.designBg);
  }
  stage.addEventListener('wheel', e => { e.preventDefault(); const r = stage.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  let drag = null;
  stage.addEventListener('mousedown', e => { if (e.target.closest('button')) return; drag = { sx: e.clientX, sy: e.clientY, x, y }; stage.classList.add('dragging'); });
  window.addEventListener('mousemove', lb._mm = e => { if (!drag) return; x = drag.x + e.clientX - drag.sx; y = drag.y + e.clientY - drag.sy; fit = false; apply(); });
  window.addEventListener('mouseup', lb._mu = () => { drag = null; stage.classList.remove('dragging'); });
  stage.addEventListener('dblclick', () => { if (fit) zoomAt(1 / scale, stage.clientWidth / 2, stage.clientHeight / 2); else doFit(); });
  window.addEventListener('resize', lb._rs = () => { if (fit) doFit(); });
  lb.addEventListener('click', e => {
    const z = e.target.closest('[data-z]');
    if (z) {
      const cx = stage.clientWidth / 2, cy = stage.clientHeight / 2;
      if (z.dataset.z === 'in') zoomAt(1.25, cx, cy);
      if (z.dataset.z === 'out') zoomAt(0.8, cx, cy);
      if (z.dataset.z === 'fit') doFit();
      if (z.dataset.z === '100') zoomAt(1 / scale, cx, cy);
    }
    const bg = e.target.closest('.bg-switch button');
    if (bg) { setDesignBg(bg.dataset.v); setBg(bg.dataset.v); }
    if (e.target.closest('[data-open]')) osAction('oeffnen', { pfad: items[i].f.pfad });
    if (e.target.closest('[data-close]')) closeLightbox();
  });
  lb._key = e => {
    if (e.key === 'ArrowLeft' && items.length > 1) show(i - 1);
    else if (e.key === 'ArrowRight' && items.length > 1) show(i + 1);
    else if (e.key === '+' || e.key === '=') zoomAt(1.25, stage.clientWidth / 2, stage.clientHeight / 2);
    else if (e.key === '-') zoomAt(0.8, stage.clientWidth / 2, stage.clientHeight / 2);
    else if (e.key === '0') doFit();
    else if (e.key === '1') zoomAt(1 / scale, stage.clientWidth / 2, stage.clientHeight / 2);
    else return false;
    return true;
  };
  show(i);
}
function closeLightbox() {
  const lb = $('.lightbox');
  if (!lb) return;
  window.removeEventListener('mousemove', lb._mm);
  window.removeEventListener('mouseup', lb._mu);
  window.removeEventListener('resize', lb._rs);
  lb.remove();
}

// ================================================================ Formular: Neues Piece / Bearbeiten / Vorlage
function slotFromFile(f, art, pieceId) {
  if (!f) return null;
  return { art, datei: f.datei, piece: pieceId, name: f.name, groesse: f.groesse, ext: (f.format || f.ext || '').toLowerCase(), url: f.vorschau ? thumbUrl(f, 700) : null, bild: f.bild !== false };
}

function openForm(mode, src) {
  if (!S.data) return;
  if (!S.data.kategorien.length && mode === 'neu') {
    toast('Bitte zuerst einen Kleidungstyp anlegen (links „Neuer Kleidungstyp …“).', 'err');
    return;
  }
  const f = {
    mode, id: null, vorlage_von: null, dirty: false, entwurf: false, orig: null, tplTitle: '',
    nummer: S.data.naechsteNummer, name: '', motivtitel: '', kategorie: S.filter.kat || '', serie: '', beschreibung: '', schlagwoerter: [],
    slots: { design: null, kleidungsansicht: null, mockup: null }, work: [], prevMissing: {}, preview: null
  };
  if (src && (mode === 'bearbeiten' || mode === 'vorlage')) {
    Object.assign(f, { name: src.name, motivtitel: src.motivtitel, kategorie: src.kategorie, serie: src.serie, beschreibung: src.beschreibung, schlagwoerter: (src.schlagwoerter || []).slice() });
  }
  if (mode === 'bearbeiten') {
    f.id = src.id; f.nummer = src.nummer; f.entwurf = src.entwurf; f.orig = src;
    ROLES.forEach(r => {
      const fi = src.bilder[r];
      if (fi && fi.vorhanden) f.slots[r] = slotFromFile(fi, 'behalten');
      else if (fi) f.prevMissing[r] = fi.datei;
    });
    f.work = src.arbeitsdateien.filter(a => a.vorhanden).map(a => slotFromFile(a, 'behalten'));
    f.unassigned = src.unzugeordnet;
  }
  if (mode === 'vorlage') {
    f.vorlage_von = src.id; f.tplTitle = src.nummerText + ' · ' + src.name;
    ROLES.forEach(r => { const fi = src.bilder[r]; if (fi && fi.vorhanden) f.slots[r] = slotFromFile(fi, 'kopie', src.id); });
    f.work = src.arbeitsdateien.filter(a => a.vorhanden).map(a => slotFromFile(a, 'kopie', src.id));
  }
  S.form = f;
  renderForm();
}

function formTitle(f) {
  if (f.mode === 'bearbeiten') return `Piece bearbeiten`;
  if (f.mode === 'vorlage') return `Neues Piece nach Vorlage`;
  return 'Neues Piece';
}

function renderForm() {
  const f = S.form;
  let view = $('#form');
  if (!view) { view = document.createElement('div'); view.id = 'form'; view.className = 'view'; $('#layer').appendChild(view); }
  const allTags = [...new Set(S.data.pieces.flatMap(p => p.schlagwoerter || []))].sort((a, b) => a.localeCompare(b, 'de'));
  const allSeries = [...new Set(S.data.pieces.map(p => p.serie).filter(Boolean))].sort();
  view.innerHTML = `
    <div class="view-head">
      <div><div class="card-nr">${f.mode === 'bearbeiten' ? 'Nr. ' + pad3(f.orig.nummer) + ' · ' + esc(f.orig.name) : 'APOLOGEA'}</div>
      <h2 style="margin:0;font-size:24px;letter-spacing:.06em">${formTitle(f)}</h2></div>
      <div class="spacer"></div>
      <button class="btn ghost" id="f-cancel">${icon('close')}Abbrechen</button>
    </div>
    <div class="view-body"><div class="view-inner">
      ${f.mode === 'vorlage' ? `<div class="tpl-note">Vorlage: <b>${esc(f.tplTitle)}</b>. Alle Angaben und Dateien werden als Kopie in einen neuen Produktordner übernommen – das Original bleibt unverändert. Bitte Namen und Nummer prüfen.</div>` : ''}
      <div class="form-grid">
        <div class="form-col">
          <div class="section-title">Angaben</div>
          <div class="field"><label for="f-kat">Kleidungstyp<span class="req">*</span></label>
            <select class="input" id="f-kat"><option value="">Bitte auswählen …</option>${S.data.kategorien.map(k => `<option ${k.name === f.kategorie ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}<option value="__neu">＋ Neuer Kleidungstyp …</option></select></div>
          <div class="field"><label for="f-name">Produktname<span class="req">*</span></label>
            <input class="input name-input" id="f-name" value="${esc(f.name)}" maxlength="60" placeholder="z. B. SERAPHIM" autocomplete="off"></div>
          <div class="field"><label for="f-nr">Piece-Nummer<span class="req">*</span></label>
            <div class="input-row"><input class="input" id="f-nr" type="number" min="1" max="99999" value="${f.nummer}">
            <button class="btn ghost small" id="f-nr-sug" title="Nächste freie Nummer übernehmen">Nächste freie: ${pad3(S.data.naechsteNummer)}</button></div>
            <span class="hint" id="f-nr-hint">Wird automatisch vorgeschlagen und auf Eindeutigkeit geprüft.</span></div>
          <div class="field"><label for="f-motiv">Motivtitel <span class="faint">(optional)</span></label>
            <input class="input" id="f-motiv" value="${esc(f.motivtitel)}" maxlength="80" placeholder="z. B. Sechsflügeliger Seraph" autocomplete="off"></div>
          <div class="field"><label for="f-serie">Serie <span class="faint">(optional)</span></label>
            <input class="input" id="f-serie" value="${esc(f.serie)}" list="f-serie-list" maxlength="80" autocomplete="off">
            <datalist id="f-serie-list">${allSeries.map(s => `<option value="${esc(s)}">`).join('')}</datalist></div>
          <div class="field"><label for="f-desc">Beschreibung <span class="faint">(optional)</span></label>
            <textarea class="input" id="f-desc" placeholder="Kleidungsstück, Farbe, Front, Rücken, Motiv, Veredelung …">${esc(f.beschreibung)}</textarea>
            <span class="hint">Zeilen wie „Farbe: Schwarz“ werden in der Ansicht übersichtlich hervorgehoben.</span></div>
          <div class="field"><label for="f-tag-in">Schlagwörter <span class="faint">(optional)</span></label>
            <div class="chips" id="f-tags"></div>
            <datalist id="f-tag-list">${allTags.map(t => `<option value="${esc(t)}">`).join('')}</datalist>
            <span class="hint">Eingabe mit Enter oder Komma bestätigen.</span></div>
        </div>
        <div class="form-col">
          <div class="section-title">Bilder</div>
          <div class="slots" id="f-slots"></div>
          <div class="multi-drop" id="f-multi">${icon('upload')}Mehrere Bilder auf einmal hier ablegen oder klicken – die Zuordnung erfolgt nach Dateinamen (z. B. „…design…“, „…mockup…“) bzw. in freie Felder. Sie lässt sich danach je Feld korrigieren.</div>
          <div class="section-title" style="margin-top:28px">Zusätzliche Arbeitsdateien</div>
          <div id="f-work"></div>
          <div class="work-drop" id="f-workdrop">Beliebige Dateien (z. B. PSD, AI, PDF, Schnittmuster, Notizen) hier ablegen oder klicken</div>
          <div class="summary" id="f-summary"></div>
        </div>
      </div>
    </div></div>
    <div class="view-foot">
      <span class="muted" id="f-state" style="font-size:13.5px"></span>
      <div class="spacer"></div>
      <button class="btn ghost" id="f-cancel2">Abbrechen</button>
      <button class="btn gold" id="f-draft" title="Speichern, auch wenn noch Bilder fehlen – das Piece wird als Entwurf gekennzeichnet">Als Entwurf speichern</button>
      <button class="btn primary" id="f-save">${icon('check')}Speichern</button>
    </div>`;
  const hidden = document.createElement('input');
  hidden.type = 'file'; hidden.multiple = true; hidden.style.display = 'none'; hidden.id = 'f-file';
  view.appendChild(hidden);

  const markDirty = () => { f.dirty = true; updateSummary(); };
  $('#f-cancel').onclick = $('#f-cancel2').onclick = () => closeForm();
  $('#f-kat').onchange = async e => {
    if (e.target.value === '__neu') {
      const n = await createCategoryDialog();
      if (n) { f.kategorie = n; renderForm(); f.dirty = true; } else e.target.value = f.kategorie;
      return;
    }
    f.kategorie = e.target.value; markDirty();
  };
  $('#f-name').oninput = e => { f.name = e.target.value; markDirty(); };
  $('#f-nr').oninput = e => { f.nummer = parseInt(e.target.value, 10) || 0; markDirty(); };
  $('#f-nr-sug').onclick = () => { f.nummer = S.data.naechsteNummer; $('#f-nr').value = f.nummer; markDirty(); };
  $('#f-motiv').oninput = e => { f.motivtitel = e.target.value; markDirty(); };
  $('#f-serie').oninput = e => { f.serie = e.target.value; markDirty(); };
  $('#f-desc').oninput = e => { f.beschreibung = e.target.value; f.dirty = true; };
  $('#f-draft').onclick = () => saveForm(true);
  $('#f-save').onclick = () => saveForm(false);
  setupDrop($('#f-multi'), files => addMany(files), true);
  setupDrop($('#f-workdrop'), files => addWork(files), true);
  renderTags();
  renderSlots();
  renderWork();
  updateSummary();
  setTimeout(() => { const el = f.kategorie ? $('#f-name') : $('#f-kat'); if (el) el.focus(); }, 50);
}

function pickFiles(multiple, accept) {
  return new Promise(resolve => {
    const inp = $('#f-file');
    inp.value = '';
    inp.multiple = !!multiple;
    inp.accept = accept || '';
    inp.onchange = () => resolve(Array.from(inp.files || []));
    inp.click();
  });
}

function setupDrop(el, onFiles, clickPicks, accept) {
  el.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', e => {
    e.preventDefault(); e.stopPropagation(); el.classList.remove('over');
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) onFiles(files);
  });
  if (clickPicks) el.addEventListener('click', async e => {
    if (e.target.closest('button,select')) return;
    const files = await pickFiles(true, accept);
    if (files.length) onFiles(files);
  });
}

function renderTags() {
  const f = S.form, box = $('#f-tags');
  box.innerHTML = f.schlagwoerter.map((t, i) => `<span class="chip">${esc(t)}<button data-i="${i}" title="Schlagwort entfernen" aria-label="${esc(t)} entfernen">×</button></span>`).join('') +
    `<input id="f-tag-in" list="f-tag-list" placeholder="${f.schlagwoerter.length ? '' : 'z. B. Engel, Ikone, Gold'}" autocomplete="off">`;
  const inp = $('#f-tag-in');
  const add = () => {
    const parts = inp.value.split(',').map(s => s.trim()).filter(Boolean);
    let changed = false;
    parts.forEach(v => { if (!f.schlagwoerter.some(x => norm(x) === norm(v))) { f.schlagwoerter.push(v); changed = true; } });
    if (changed || parts.length) { f.dirty = true; renderTags(); $('#f-tag-in').focus(); }
  };
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
    else if (e.key === 'Backspace' && !inp.value && f.schlagwoerter.length) { f.schlagwoerter.pop(); f.dirty = true; renderTags(); $('#f-tag-in').focus(); }
  });
  inp.addEventListener('blur', () => { if (inp.value.trim()) add(); });
  box.onclick = e => {
    const b = e.target.closest('button[data-i]');
    if (b) { f.schlagwoerter.splice(+b.dataset.i, 1); f.dirty = true; renderTags(); }
    else if (e.target === box) $('#f-tag-in').focus();
  };
}

function slotTag(s) {
  if (!s) return '<span class="tag fehlt">leer</span>';
  if (s.pending) return '<span class="tag neu">wird übertragen …</span>';
  if (s.art === 'upload') return '<span class="tag neu">neu</span>';
  if (s.art === 'kopie') return '<span class="tag kopie">Kopie aus Vorlage</span>';
  return '<span class="tag vorhanden">vorhanden</span>';
}

function renderSlots() {
  const f = S.form, box = $('#f-slots');
  const unassignedImgs = (f.unassigned || []).filter(u => u.bild && u.vorhanden);
  box.innerHTML = ROLES.map(r => {
    const s = f.slots[r];
    const isDesign = r === 'design';
    let inner;
    if (!s) inner = `<div class="empty-text">${icon('upload')}${ROLE_LABEL[r]} hierher ziehen<br>oder klicken zum Auswählen${f.prevMissing[r] ? `<br><span style="color:var(--danger)">Bisherige Datei „${esc(f.prevMissing[r])}“ fehlt</span>` : ''}</div>`;
    else if (s.url) inner = `<img src="${s.url}" alt="">`;
    else inner = `<div class="empty-text">${icon('file')}Keine Vorschau für .${esc(s.ext || '?')}<br>Die Datei wird unverändert gespeichert.</div>`;
    if (s && s.pending) inner += '<div class="busy">Datei wird übertragen …</div>';
    const others = ROLES.filter(o => o !== r);
    return `<div class="slot" data-role="${r}">
      <div class="slot-head"><span class="label">${ROLE_LABEL[r]}</span>${slotTag(s)}</div>
      <div class="slot-drop ${s ? 'filled' : ''} ${isDesign && s ? 'design-bg bg-' + S.designBg : ''}" title="Bild hierher ziehen oder klicken">${inner}</div>
      <div class="slot-file">${s ? `<b>${esc(s.name)}</b>${s.groesse != null ? ' · ' + fmtBytes(s.groesse) : ''}${s.hinweis ? `<br><span class="hint warn">${esc(s.hinweis)}</span>` : ''}` : ''}</div>
      <div class="slot-actions">
        <button class="btn small gold" data-pick="${r}">${icon('upload')}${s ? 'Ersetzen' : 'Datei wählen'}</button>
        ${s ? `<select class="input" data-swap="${r}" title="Zuordnung korrigieren"><option value="">Tauschen mit …</option>${others.map(o => `<option value="${o}">${ROLE_LABEL[o]}</option>`).join('')}</select>
        <button class="btn small danger icon-only" data-clear="${r}" title="Bild aus diesem Feld entfernen">${icon('close')}</button>` : ''}
        ${!s && unassignedImgs.length ? `<select class="input" data-useexisting="${r}"><option value="">Datei aus Ordner …</option>${unassignedImgs.map(u => `<option value="${esc(u.datei)}">${esc(u.datei)}</option>`).join('')}</select>` : ''}
      </div></div>`;
  }).join('');
  $$('.slot', box).forEach(el => {
    const r = el.dataset.role;
    setupDrop($('.slot-drop', el), files => setSlotFile(r, files[0], files.slice(1)), true, 'image/*,.psd,.tif,.tiff,.svg');
  });
  $$('[data-pick]', box).forEach(b => b.onclick = async () => { const fl = await pickFiles(false, 'image/*,.psd,.tif,.tiff,.svg'); if (fl[0]) setSlotFile(b.dataset.pick, fl[0]); });
  $$('[data-clear]', box).forEach(b => b.onclick = () => { f.slots[b.dataset.clear] = null; f.dirty = true; renderSlots(); updateSummary(); });
  $$('[data-swap]', box).forEach(sel => sel.onchange = () => {
    const a = sel.dataset.swap, b = sel.value;
    if (!b) return;
    const t = f.slots[a]; f.slots[a] = f.slots[b]; f.slots[b] = t;
    f.dirty = true; renderSlots(); updateSummary();
    toast(`${ROLE_LABEL[a]} und ${ROLE_LABEL[b]} wurden getauscht.`, 'ok', { ms: 2500 });
  });
  $$('[data-useexisting]', box).forEach(sel => sel.onchange = () => {
    const u = unassignedImgs.find(x => x.datei === sel.value);
    if (!u) return;
    f.slots[sel.dataset.useexisting] = slotFromFile(u, 'behalten');
    f.dirty = true; renderSlots(); updateSummary();
  });
  updateState();
}

async function uploadFile(file) {
  let r;
  try {
    r = await fetch('/api/upload', { method: 'POST', headers: { 'X-Apologea': '1', 'X-Dateiname': encodeURIComponent(file.name) }, body: file });
  } catch (e) { throw new Error('Die Datei „' + file.name + '“ konnte nicht übertragen werden. Läuft das Programm noch?'); }
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error((d && d.fehler) || 'Übertragung fehlgeschlagen.');
  return d;
}

async function setSlotFile(role, file, rest) {
  const f = S.form;
  const ext = extOf(file.name);
  if (!IMG_EXT.includes(ext) && !(file.type || '').startsWith('image/')) {
    toast(`„${file.name}“ ist keine Bilddatei. Andere Dateien bitte unter „Zusätzliche Arbeitsdateien“ ablegen.`, 'err');
    return;
  }
  const url = BROWSER_IMG.includes(ext) ? URL.createObjectURL(file) : null;
  const slot = { art: 'upload', name: file.name, groesse: file.size, ext, url, pending: true };
  f.slots[role] = slot; f.dirty = true;
  renderSlots(); updateSummary();
  try {
    const r = await uploadFile(file);
    if (f.slots[role] !== slot && !Object.values(f.slots).includes(slot)) return;
    slot.upload = r.upload; slot.ext = r.ext; slot.pending = false;
    if (r.endungKorrigiert) slot.hinweis = `Die Datei ist tatsächlich ein ${String(r.format).toUpperCase()}-Bild und wird mit der Endung .${r.ext} gespeichert (keine Umwandlung).`;
  } catch (e) {
    for (const k of ROLES) if (f.slots[k] === slot) f.slots[k] = null;
    toastErr(e);
  }
  if (S.form === f) { renderSlots(); updateSummary(); }
  if (rest && rest.length) addMany(rest);
}

function addMany(files) {
  const f = S.form;
  const imgs = [], others = [];
  files.forEach(fl => (IMG_EXT.includes(extOf(fl.name)) || (fl.type || '').startsWith('image/') ? imgs : others).push(fl));
  const assigned = {};
  imgs.forEach(fl => { const g = guessRole(fl.name); if (g && !assigned[g]) { assigned[g] = fl; } });
  const leftover = imgs.filter(fl => !Object.values(assigned).includes(fl));
  ROLES.forEach(r => { if (!assigned[r] && !f.slots[r] && leftover.length) assigned[r] = leftover.shift(); });
  Object.keys(assigned).forEach(r => setSlotFile(r, assigned[r]));
  if (leftover.length || others.length) {
    addWork(leftover.concat(others));
    toast(`${leftover.length + others.length} Datei(en) wurden als Arbeitsdatei übernommen.`, '', { ms: 4000 });
  }
}

async function addWork(files) {
  const f = S.form;
  for (const file of files) {
    const item = { art: 'upload', name: file.name, groesse: file.size, ext: extOf(file.name), pending: true };
    f.work.push(item); f.dirty = true;
    renderWork(); updateSummary();
    try { const r = await uploadFile(file); item.upload = r.upload; item.pending = false; }
    catch (e) { f.work.splice(f.work.indexOf(item), 1); toastErr(e); }
    if (S.form === f) { renderWork(); updateSummary(); }
  }
}

function renderWork() {
  const f = S.form, box = $('#f-work');
  box.innerHTML = f.work.length ? `<div class="filelist">${f.work.map((w, i) => `<div class="filerow">
      <span class="thumb" style="display:flex;align-items:center;justify-content:center;background:var(--panel-3)">${icon('file')}</span>
      <div class="fn">${esc(w.name)}<small>${w.groesse != null ? fmtBytes(w.groesse) : ''}</small></div>
      ${slotTag(w)}
      <button class="btn small danger icon-only" data-wdel="${i}" title="Arbeitsdatei entfernen">${icon('close')}</button></div>`).join('')}</div>` : '';
  $$('[data-wdel]', box).forEach(b => b.onclick = () => { f.work.splice(+b.dataset.wdel, 1); f.dirty = true; renderWork(); updateSummary(); });
  updateState();
}

function pendingCount() {
  const f = S.form;
  return ROLES.filter(r => f.slots[r] && f.slots[r].pending).length + f.work.filter(w => w.pending).length;
}
function updateState() {
  const f = S.form, el = $('#f-state');
  if (!el) return;
  const p = pendingCount();
  const missing = ROLES.filter(r => !f.slots[r]).map(r => ROLE_LABEL[r]);
  el.innerHTML = p ? `${p} Datei(en) werden noch übertragen …` : missing.length ? `Noch offen: ${missing.join(', ')} – Speichern als Entwurf möglich.` : 'Alle drei Bilder vorhanden.';
  $('#f-save').disabled = $('#f-draft').disabled = p > 0;
}

const fetchPreview = debounce(async () => {
  const f = S.form;
  if (!f || !f.kategorie || !f.nummer) { f && (f.preview = null); renderSummary(); return; }
  try {
    f.preview = await api('/api/ordner-vorschau', { id: f.id, nummer: f.nummer, name: f.name.trim() || 'NAME', motivtitel: f.motivtitel.trim(), kategorie: f.kategorie });
  } catch (e) { f.preview = null; }
  renderSummary();
}, 220);

function updateSummary() { renderSummary(); fetchPreview(); updateState(); }

function renderSummary() {
  const f = S.form, box = $('#f-summary');
  if (!f || !box) return;
  const pv = f.preview;
  const hint = $('#f-nr-hint');
  if (hint) {
    if (!f.nummer || f.nummer < 1) { hint.className = 'hint error'; hint.textContent = 'Bitte eine ganze Zahl ab 1 eingeben.'; }
    else if (pv && pv.nummerVergeben) { hint.className = 'hint error'; hint.textContent = `Die Nummer ${pad3(f.nummer)} ist bereits vergeben (${pv.nummerVergeben}).`; }
    else if (pv) { hint.className = 'hint ok'; hint.textContent = `Die Nummer ${pad3(f.nummer)} ist frei.`; }
  }
  const rows = [];
  const target = pv ? 'Sammlung\\' + pv.ordner : (f.kategorie ? '…' : 'Bitte Kleidungstyp wählen');
  rows.push(['Produktordner', `<span class="mono">${esc(target)}</span>${pv && pv.ordnerVorhanden ? '<br><span class="hint warn">Ein gleichnamiger Ordner existiert bereits – es wird automatisch ein eindeutiger Name verwendet.</span>' : ''}${f.mode === 'bearbeiten' && pv && pv.wirdVerschoben ? `<br><span class="hint warn">Der Ordner wird beim Speichern von „${esc(f.orig.ordner)}“ hierher umbenannt bzw. verschoben.</span>` : ''}`]);
  ROLES.forEach(r => {
    const s = f.slots[r];
    let v;
    if (!s) v = '<span style="color:var(--danger)">fehlt</span>';
    else if (s.art === 'behalten') v = `${esc(s.datei)} <span class="faint">(bleibt unverändert)</span>`;
    else v = `${ROLE_BASE[r]}.${esc(s.ext || extOf(s.name))} <span class="faint">← ${esc(s.name)} (${s.art === 'kopie' ? 'Kopie aus Vorlage' : 'neu'})</span>`;
    rows.push([ROLE_LABEL[r], v]);
  });
  if (f.work.length) rows.push(['Arbeitsdateien', f.work.length + ' Datei(en)' + (f.work.some(w => w.art !== 'behalten') ? ' <span class="faint">(neue landen im Unterordner „Arbeitsdateien“)</span>' : '')]);
  if (f.mode === 'bearbeiten') {
    const kept = new Set(ROLES.map(r => f.slots[r]).concat(f.work).filter(s => s && s.art === 'behalten').map(s => s.datei.toLowerCase()));
    const old = ROLES.map(r => f.orig.bilder[r]).concat(f.orig.arbeitsdateien).filter(x => x && x.vorhanden).map(x => x.datei);
    const removed = [...new Set(old.filter(d => !kept.has(d.toLowerCase())))];
    if (removed.length) rows.push(['Wird ersetzt', `${removed.map(esc).join(', ')} <span class="faint">→ wird in den Papierkorb der Sammlung verschoben (wiederherstellbar)</span>`]);
  }
  box.innerHTML = `<div class="section-title" style="margin-bottom:8px">Vorschau der Ablage</div>` + rows.map(([k, v]) => `<div class="row"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
}

async function closeForm(force) {
  const f = S.form;
  if (!f) return;
  if (!force && f.dirty) {
    const ok = await confirmDialog('Änderungen verwerfen?', 'Die Eingaben in diesem Formular wurden noch nicht gespeichert. Wirklich schließen?', 'Verwerfen', true);
    if (!ok) return;
  }
  ROLES.forEach(r => { const s = f.slots[r]; if (s && s.url && s.url.startsWith('blob:')) URL.revokeObjectURL(s.url); });
  const v = $('#form'); if (v) v.remove();
  S.form = null;
}

async function saveForm(asDraft) {
  const f = S.form;
  f.name = $('#f-name').value; f.motivtitel = $('#f-motiv').value; f.serie = $('#f-serie').value; f.beschreibung = $('#f-desc').value;
  const tagIn = $('#f-tag-in'); if (tagIn && tagIn.value.trim()) { tagIn.value.split(',').map(s => s.trim()).filter(Boolean).forEach(v => { if (!f.schlagwoerter.includes(v)) f.schlagwoerter.push(v); }); }
  const errs = [];
  if (!f.kategorie) { errs.push('Bitte einen Kleidungstyp auswählen.'); $('#f-kat').classList.add('invalid'); } else $('#f-kat').classList.remove('invalid');
  if (!f.name.trim()) { errs.push('Bitte einen Produktnamen eingeben.'); $('#f-name').classList.add('invalid'); } else $('#f-name').classList.remove('invalid');
  if (!f.nummer || f.nummer < 1) { errs.push('Bitte eine gültige Piece-Nummer eingeben.'); $('#f-nr').classList.add('invalid'); } else $('#f-nr').classList.remove('invalid');
  if (f.preview && f.preview.nummerVergeben) { errs.push(`Die Nummer ${pad3(f.nummer)} ist bereits vergeben. Frei wäre z. B. ${pad3(f.preview.naechsteNummer)}.`); $('#f-nr').classList.add('invalid'); }
  if (errs.length) { toast(errs.join(' '), 'err', { title: 'Bitte ergänzen' }); return; }
  if (pendingCount()) { toast('Bitte warten, bis alle Dateien übertragen sind.', 'err'); return; }
  const missing = ROLES.filter(r => !f.slots[r]);
  if (!asDraft && missing.length) {
    const v = await modal({
      title: 'Bilder fehlen noch',
      body: `<p>Für ein vollständiges Piece fehlen noch: <b>${missing.map(r => ROLE_LABEL[r]).join(', ')}</b>.</p><p>Sie können das Piece jetzt ausdrücklich als <b>Entwurf</b> speichern und die Bilder später ergänzen.</p>`,
      buttons: [{ label: 'Zurück zum Formular', value: null }, { label: 'Als Entwurf speichern', cls: 'primary', value: 'draft' }]
    });
    if (v !== 'draft') return;
    asDraft = true;
  }
  const slotReq = s => {
    if (!s) return null;
    if (s.art === 'upload') return { art: 'upload', upload: s.upload };
    if (s.art === 'kopie') return { art: 'kopie', piece: s.piece, datei: s.datei };
    return { art: 'behalten', datei: s.datei };
  };
  const body = {
    id: f.id, nummer: f.nummer, name: f.name.trim(), motivtitel: f.motivtitel.trim(), kategorie: f.kategorie,
    serie: f.serie.trim(), beschreibung: f.beschreibung, schlagwoerter: f.schlagwoerter, entwurf: !!asDraft,
    vorlage_von: f.vorlage_von,
    bilder: { design: slotReq(f.slots.design), kleidungsansicht: slotReq(f.slots.kleidungsansicht), mockup: slotReq(f.slots.mockup) },
    arbeitsdateien: f.work.map(slotReq)
  };
  busy('Piece wird gespeichert …');
  try {
    const r = await api('/api/speichern', body);
    unbusy();
    const p = r.piece;
    await closeForm(true);
    await loadData();
    renderSidebar(); renderGrid();
    await openDetail(p.id);
    toast(`Gespeichert in: Sammlung\\${p.ordner}`, 'ok', { title: `${p.nummerText} · ${p.name}${asDraft ? ' (Entwurf)' : ''} gespeichert` });
  } catch (e) {
    unbusy();
    toastErr(e, 'Speichern nicht möglich');
    if (e.status === 409) fetchPreview();
  }
}

async function createCategoryDialog() {
  const name = await askText('Neuer Kleidungstyp', 'Name des Kleidungstyps (wird als Ordner angelegt)', '', 'Zum Beispiel „Longsleeves“ oder „Kappen“. Umlaute werden für Windows-sichere Ordnernamen umgeschrieben (ü → ue).');
  if (!name) return null;
  try {
    const r = await api('/api/kategorie/neu', { name });
    await loadData();
    renderSidebar();
    toast(`Der Kleidungstyp „${r.name}“ wurde angelegt.`, 'ok');
    return r.name;
  } catch (e) { toastErr(e); return null; }
}

// ================================================================ Papierkorb
async function openTrash() {
  let entries;
  try { entries = (await api('/api/papierkorb')).eintraege; } catch (e) { toastErr(e); return; }
  const pieces = entries.filter(e => e.art === 'piece'), files = entries.filter(e => e.art === 'dateien');
  const body = document.createElement('div');
  body.innerHTML = `
    <p class="muted">Gelöschte Pieces und beim Bearbeiten ersetzte oder entfernte Dateien liegen im Ordner <span class="mono">_Papierkorb</span> der Sammlung und können wiederhergestellt werden.</p>
    <div class="section-title">Pieces (${pieces.length})</div>
    ${pieces.length ? pieces.map(e => `<div class="trash-row">
        ${e.bild ? `<img src="/vorschau?p=${enc(e.bild)}&w=160" alt="">` : '<span class="ph"></span>'}
        <div class="t"><b>${esc((e.nummerText || '') + ' · ' + (e.name || ''))}</b><div class="muted" style="font-size:13px">${esc(e.kategorie || '')} · gelöscht ${fmtDate(e.geloescht)}${e.fehler ? ' · ' + esc(e.fehler) : ''}</div></div>
        <button class="btn small gold" data-restore="${esc(e.eintrag)}">${icon('restore')}Wiederherstellen</button>
        <button class="btn small ghost icon-only" data-act="ordner" data-pfad="${esc(e.ordnerVoll)}" title="Im Explorer öffnen">${icon('folder')}</button>
        <button class="btn small danger icon-only" data-kill="piece|${esc(e.eintrag)}" title="Endgültig löschen">${icon('trash')}</button></div>`).join('') : '<p class="faint">Keine gelöschten Pieces.</p>'}
    <div class="section-title" style="margin-top:22px">Ersetzte oder entfernte Dateien (${files.length})</div>
    ${files.length ? files.map(e => `<div class="trash-row"><span class="ph" style="height:44px;width:44px;display:flex;align-items:center;justify-content:center">${icon('file')}</span>
        <div class="t"><b style="font-size:14px">${esc(e.eintrag)}</b><div class="muted" style="font-size:13px">${e.dateien.map(esc).join(', ')}</div></div>
        <button class="btn small gold" data-act="ordner" data-pfad="${esc(e.ordnerVoll)}">${icon('folder')}Im Explorer öffnen</button>
        <button class="btn small danger icon-only" data-kill="dateien|${esc(e.eintrag)}" title="Endgültig löschen">${icon('trash')}</button></div>`).join('') : '<p class="faint">Keine ersetzten Dateien.</p>'}
    <p class="faint" style="font-size:13px;margin-top:14px">Tipp: Eine ersetzte Datei lässt sich wieder verwenden, indem man sie im Formular des Pieces erneut in das passende Bildfeld zieht.</p>`;
  const m = modal({ title: 'Papierkorb', body, wide: true });
  body.addEventListener('click', async e => {
    const rs = e.target.closest('[data-restore]');
    const kl = e.target.closest('[data-kill]');
    if (rs) {
      try {
        const r = await api('/api/papierkorb/wiederherstellen', { eintrag: rs.dataset.restore });
        await loadData(); renderSidebar(); renderGrid();
        toast(`${r.piece.nummerText} · ${r.piece.name} ist wieder in „${r.piece.kategorie}“.${r.hinweis ? ' ' + r.hinweis : ''}`, 'ok', { title: 'Wiederhergestellt' });
        layerTop()._close(); openTrash();
      } catch (er) { toastErr(er); }
    }
    if (kl) {
      const [art, eintrag] = kl.dataset.kill.split('|');
      const ok = await confirmDialog('Endgültig löschen?', 'Dieser Eintrag wird <b>unwiderruflich</b> von der Festplatte gelöscht. Das lässt sich nicht rückgängig machen.', 'Endgültig löschen', true);
      if (!ok) return;
      try {
        await api('/api/papierkorb/loeschen', { art, eintrag });
        toast('Endgültig gelöscht.', 'ok');
        await loadData(); renderSidebar();
        const top = $$('.modal-back').pop(); if (top) top._close();
        openTrash();
      } catch (er) { toastErr(er); }
    }
  });
  return m;
}

// ================================================================ Sicherung
function openBackup() {
  const body = document.createElement('div');
  body.innerHTML = `
    <p>Die Sicherung ist <b>eine ZIP-Datei</b> mit allem, was zum Wiederherstellen nötig ist:</p>
    <ul style="margin:0 0 14px;padding-left:20px;color:var(--ivory-2)">
      <li>alle ${S.data.pieces.length} Pieces mit allen Bildern und Arbeitsdateien in der gewohnten Ordnerstruktur</li>
      <li>sämtliche Produktdaten (je Produktordner eine „Produktdaten.json“)</li>
      <li>das Programm <span class="mono">APOLOGEA.exe</span>, den Quellcode und eine Wiederherstellungsanleitung</li>
      <li>einen eigenständig lesbaren HTML-Suchkatalog (<span class="mono">Katalog_Ansicht.html</span>)</li>
    </ul>
    <p class="muted" style="font-size:14px">Frühere Sicherungs-ZIPs werden nicht erneut eingepackt. Die Datei entsteht zunächst unter einem Zwischennamen und erhält ihren endgültigen Namen erst nach erfolgreicher Prüfung.</p>
    <label class="checkbox"><input type="checkbox" id="bk-verify" checked><span>Sicherung nach dem Erstellen prüfen (empfohlen) – jede Datei wird wieder gelesen und mit dem Original verglichen</span></label>
    <label class="checkbox"><input type="checkbox" id="bk-trash"><span>Papierkorb mitsichern</span></label>
    <div id="bk-progress" class="hidden">
      <div id="bk-phase" style="margin-top:8px"></div>
      <div class="progress"><div id="bk-bar"></div></div>
      <div class="muted" id="bk-detail" style="font-size:13px"></div>
    </div>
    <div id="bk-result"></div>
    <div class="section-title" style="margin-top:20px">Nur Ansicht</div>
    <p class="muted" style="font-size:14px;margin-bottom:8px">Erzeugt <span class="mono">Katalog_Ansicht.html</span> im Sammlungsordner – ein Suchkatalog, der ohne Programm in jedem Browser geöffnet werden kann (keine Bearbeitung).</p>
    <button class="btn small gold" id="bk-html">${icon('code')}HTML-Ansichtskatalog erstellen</button>`;
  let polling = null;
  const startBtn = { label: 'Speicherort wählen und Sicherung erstellen', cls: 'primary', icon: 'archive', run: async back => { await startBackup(back); return false; } };
  modal({ title: 'Vollständige ZIP-Sicherung erstellen', body, wide: true, buttons: [{ label: 'Schließen', value: null }, startBtn],
    onOpen: back => {
      $('#bk-html', back).onclick = async () => {
        try { const r = await api('/api/html-export', {}); toast('Sammlung\\' + r.pfad, 'ok', { title: 'Ansichtskatalog erstellt', action: { label: 'Im Browser öffnen', run: () => osAction('oeffnen', { pfad: r.pfad }) } }); }
        catch (e) { toastErr(e); }
      };
      api('/api/sicherung/status').then(r => { if (r.job && r.job.laeuft) { show(back, r.job); poll(back); } }).catch(() => {});
    } }).then(() => { if (polling) clearInterval(polling); });

  async function startBackup(back) {
    try {
      const r = await api('/api/sicherung/start', { pruefen: $('#bk-verify', back).checked, papierkorb: $('#bk-trash', back).checked });
      if (r.abgebrochen) return;
      show(back, r.job); poll(back);
    } catch (e) { toastErr(e); }
  }
  function poll(back) {
    const btn = $$('.modal-foot .btn', back).pop(); if (btn) btn.disabled = true;
    if (polling) clearInterval(polling);
    polling = setInterval(async () => {
      try {
        const r = await api('/api/sicherung/status');
        show(back, r.job);
        if (!r.job.laeuft) { clearInterval(polling); polling = null; if (btn) btn.disabled = false; }
      } catch (e) { /* weiter versuchen */ }
    }, 400);
  }
  function show(back, j) {
    $('#bk-progress', back).classList.remove('hidden');
    $('#bk-phase', back).textContent = j.phase;
    const pct = j.bytesGesamt ? Math.round(j.bytesFertig / j.bytesGesamt * 100) : 0;
    $('#bk-bar', back).style.width = (j.laeuft ? pct : (j.fehler ? pct : 100)) + '%';
    $('#bk-detail', back).textContent = `${j.dateienFertig} von ${j.dateienGesamt} Dateien · ${fmtBytes(j.bytesFertig)} von ${fmtBytes(j.bytesGesamt)} · ${j.dauerSekunden} s`;
    const res = $('#bk-result', back);
    if (!j.laeuft && j.ergebnis) {
      res.innerHTML = `<div class="result-box ok"><b>Sicherung erfolgreich erstellt${j.geprueft ? ' und geprüft' : ''}.</b><br>${j.pieces} Pieces · ${j.dateienGesamt} Dateien · ZIP-Größe ${fmtBytes(j.zipGroesse)}<br><span class="mono">${esc(j.ergebnis)}</span><div class="btn-row" style="margin-top:10px"><button class="btn small gold" id="bk-show">${icon('reveal')}Im Explorer anzeigen</button></div></div>`;
      $('#bk-show', back).onclick = () => api('/api/sicherung/anzeigen', {}).catch(toastErr);
    } else if (!j.laeuft && j.fehler) {
      res.innerHTML = `<div class="result-box err">${esc(j.fehler)}</div>`;
    } else res.innerHTML = '';
  }
}

// ================================================================ Prüfung
async function openCheck() {
  busy('Sammlung wird geprüft …');
  try { const r = await api('/api/aktualisieren', {}); await loadData(r.sammlung); renderSidebar(); renderGrid(); }
  catch (e) { unbusy(); toastErr(e); return; }
  unbusy();
  const d = S.data, ps = d.pieces;
  const withProb = ps.filter(p => realProblems(p).length);
  const nImgs = ps.reduce((n, p) => n + ROLES.filter(r => p.bilder[r] && p.bilder[r].vorhanden).length, 0);
  const missingImgs = ps.reduce((n, p) => n + ROLES.filter(r => !p.bilder[r] || !p.bilder[r].vorhanden).length, 0);
  const unassigned = ps.filter(p => p.unzugeordnet.length);
  const body = document.createElement('div');
  body.innerHTML = `
    <dl class="datalist" style="margin-bottom:18px">
      <dt>Pieces</dt><dd>${ps.length} (${ps.filter(p => p.status === 'Vollständig').length} vollständig, ${ps.filter(p => p.status === 'Entwurf').length} Entwürfe, ${ps.filter(p => p.status === 'Unvollständig').length} unvollständig)</dd>
      <dt>Bilder</dt><dd>${nImgs} vorhanden${missingImgs ? `, <span style="color:var(--danger)">${missingImgs} fehlen bzw. sind nicht hinterlegt</span>` : ', keine fehlen'}</dd>
      <dt>Kleidungstypen</dt><dd>${d.kategorien.length}</dd>
      <dt>Zuletzt eingelesen</dt><dd>${fmtDate(d.gescannt)}</dd>
    </dl>
    ${(d.hinweise || []).length ? `<div class="section-title">Hinweise beim Einlesen</div><ul class="problems">${d.hinweise.map(h => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
    <div class="section-title">Ordner ohne Produktdaten (${d.fremdordner.length})</div>
    ${d.fremdordner.length ? `<p class="muted" style="font-size:14px">Diese Ordner liegen in einem Kleidungstyp-Ordner, sind aber (noch) keine Pieces. „Übernehmen“ legt eine Produktdaten.json an und ordnet Bilder nach Dateinamen zu; nichts wird umbenannt oder verschoben.</p>
      <div class="filelist">${d.fremdordner.map(f => `<div class="filerow"><div class="fn">${esc(f.ordner)}<small>${f.dateien} Dateien, davon ${f.bilder} Bilder${f.fehler ? ' · ' + esc(f.fehler) : ''}</small></div>
      <button class="btn small ghost" data-act="ordner" data-pfad="${esc(f.ordner)}">${icon('folder')}Öffnen</button>
      ${f.fehler ? '' : `<button class="btn small gold" data-adopt="${esc(f.ordner)}">${icon('plus')}Als Piece übernehmen</button>`}</div>`).join('')}</div>` : '<p class="faint">Keine – alle Ordner sind erkannt.</p>'}
    ${d.loseDateien.length ? `<div class="section-title">Lose Dateien direkt in Kleidungstyp-Ordnern (${d.loseDateien.length})</div><p class="muted" style="font-size:14px">Diese Dateien gehören zu keinem Piece. Am einfachsten in einen Produktordner verschieben oder im Formular hinzufügen.</p>
      <div class="filelist">${d.loseDateien.map(f => `<div class="filerow"><div class="fn">${esc(f)}</div><button class="btn small ghost" data-act="anzeigen" data-pfad="${esc(f)}">${icon('reveal')}Im Explorer</button></div>`).join('')}</div>` : ''}
    <div class="section-title">Pieces mit Hinweisen (${withProb.length})</div>
    ${withProb.length ? `<div class="filelist">${withProb.map(p => `<div class="filerow"><div class="fn"><b>${p.nummerText} · ${esc(p.name)}</b> <small>${esc(p.kategorie)}</small><div style="font-size:13px;color:var(--warn)">${realProblems(p).map(esc).join('<br>')}</div></div><button class="btn small gold" data-open="${p.id}">Öffnen</button></div>`).join('')}</div>` : '<p class="faint">Keine – alle Bildverknüpfungen sind in Ordnung.</p>'}
    ${unassigned.length ? `<div class="section-title">Pieces mit nicht zugeordneten Dateien (${unassigned.length})</div><div class="filelist">${unassigned.map(p => `<div class="filerow"><div class="fn"><b>${p.nummerText} · ${esc(p.name)}</b><small>${p.unzugeordnet.map(u => esc(u.datei)).join(', ')}</small></div><button class="btn small gold" data-open="${p.id}">Zuordnen</button></div>`).join('')}</div>` : ''}`;
  body.addEventListener('click', async e => {
    const o = e.target.closest('[data-open]');
    if (o) { layerTop()._close(); openDetail(o.dataset.open); }
    const a = e.target.closest('[data-adopt]');
    if (a) {
      try {
        const r = await api('/api/ordner-uebernehmen', { ordner: a.dataset.adopt });
        toast(`Übernommen als ${r.piece.nummerText} · ${r.piece.name}${r.piece.status !== 'Vollständig' ? ' (' + r.piece.status + ')' : ''}. Bitte Angaben prüfen.`, 'ok');
        layerTop()._close();
        await loadData(); renderSidebar(); renderGrid();
        openDetail(r.piece.id);
      } catch (er) { toastErr(er); }
    }
  });
  modal({ title: 'Sammlung prüfen', body, wide: true });
}

// ================================================================ Einstellungen
function openSettings() {
  const st = S.status;
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="section-title">Sammlungsordner</div>
    <p class="mono" style="margin-bottom:10px">${esc(S.data.pfad)}</p>
    <div class="btn-row" style="margin-bottom:6px">
      <button class="btn small gold" data-act="ordner" data-pfad="${esc(S.data.pfad)}">${icon('folder')}Im Explorer öffnen</button>
      <button class="btn small" id="st-choose">${icon('folder')}Anderen Sammlungsordner wählen …</button>
      <button class="btn small" id="st-new">${icon('plus')}Neue leere Sammlung anlegen …</button>
    </div>
    <p class="muted" style="font-size:13.5px">Programm und Sammlung sind getrennt: Ein neues Programm (APOLOGEA.exe) kann einfach ausgetauscht werden, ohne die Sammlung zu berühren.</p>
    <div class="section-title" style="margin-top:20px">Altbestand importieren</div>
    <p class="muted" style="font-size:14px;margin-bottom:8px">Übernimmt einen Ordner im bisherigen Format (z. B. „APOLOGEA_Pieces“ mit Gesamtindex.json) als Kopie in diese Sammlung. Das Original bleibt unverändert; bereits vorhandene Produktordner werden übersprungen.</p>
    <button class="btn small" id="st-import">${icon('upload')}Ordner importieren …</button>
    <div class="section-title" style="margin-top:20px">Logo</div>
    <p class="muted" style="font-size:14px;margin-bottom:8px">In den gelieferten Dateien war keine separate Logo-Datei enthalten; deshalb wird die Wortmarke in Schrift gezeigt. Eine eigene Logo-Datei (PNG/SVG) wird unverändert angezeigt und mit der Sammlung gesichert.</p>
    <div class="btn-row"><button class="btn small" id="st-logo">${icon('image')}Logo-Datei wählen …</button>${st.logo ? `<button class="btn small danger" id="st-logo-del">Logo entfernen</button>` : ''}</div>
    <div class="section-title" style="margin-top:20px">Darstellung</div>
    <div class="btn-row"><span class="muted" style="font-size:14px">Hintergrund für transparente Designs:</span>
      <div class="seg" id="st-bg"><button data-v="dunkel">Dunkel</button><button data-v="hell">Hell</button><button data-v="schach">Schachbrett</button></div></div>
    <div class="section-title" style="margin-top:20px">Programm</div>
    <dl class="datalist">
      <dt>Version</dt><dd>${esc(st.version)}</dd>
      <dt>Programmordner</dt><dd class="mono">${esc(st.programmOrdner)}</dd>
      <dt>Vorschau-Zwischenspeicher</dt><dd class="mono">${esc(st.datenOrdner)}</dd>
    </dl>
    <div class="btn-row" style="margin-top:10px"><button class="btn small ghost" id="st-cache">Vorschaubilder neu erzeugen</button><button class="btn small ghost" id="st-log">Protokoll öffnen</button></div>
    <div class="section-title" style="margin-top:20px">Programm-Aktualisierung</div>
    <p class="muted" style="font-size:14px;margin-bottom:8px">Neue Versionen kommen aus dem APOLOGEA-Repository bei GitHub. Installiert wird nur nach Ihrem Klick: Jede Datei wird per Prüfsumme kontrolliert, die bisherige Version gesichert (Ordner „Programm-Sicherung“), dann neu gebaut und neu gestartet. Klappt das Bauen nicht, bleibt die bisherige Version unverändert.</p>
    <div id="st-upd">${updBoxHtml()}</div>`;
  modal({ title: 'Einstellungen', body, wide: true, onOpen: back => {
    const seg = $('#st-bg', back);
    const mark = () => $$('button', seg).forEach(b => b.classList.toggle('on', b.dataset.v === S.designBg));
    mark();
    seg.onclick = e => { const b = e.target.closest('button'); if (b) { setDesignBg(b.dataset.v); mark(); renderGrid(); } };
    $('#st-choose', back).onclick = () => chooseCollection();
    $('#st-new', back).onclick = () => newCollection();
    $('#st-import', back).onclick = async () => {
      busy('Altbestand wird kopiert und geprüft – das kann einige Minuten dauern …');
      try {
        const r = await api('/api/einstellungen/import', {});
        unbusy();
        if (r.abgebrochen) return;
        const e = r.ergebnis;
        back._close();
        await loadData(); renderSidebar(); renderGrid();
        modal({ title: 'Import abgeschlossen', body: `<p><b>${e.uebernommen}</b> Pieces übernommen, ${e.uebersprungen} übersprungen, ${e.neuNummeriert} neu nummeriert, ${e.dateien} Dateien kopiert und per Prüfsumme verglichen.</p>${e.hinweise.length ? `<ul class="problems">${e.hinweise.slice(0, 60).map(h => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}<p class="muted">Bericht: <span class="mono">${esc(e.bericht)}</span></p>` });
      } catch (er) { unbusy(); toastErr(er); }
    };
    $('#st-logo', back).onclick = async () => {
      try { const r = await api('/api/einstellungen/logo', {}); if (r.abgebrochen) return; S.status = await api('/api/status'); renderBrand(); back._close(); toast('Logo übernommen.', 'ok'); }
      catch (e) { toastErr(e); }
    };
    const del = $('#st-logo-del', back);
    if (del) del.onclick = async () => { try { await api('/api/einstellungen/logo-entfernen', {}); S.status = await api('/api/status'); renderBrand(); back._close(); } catch (e) { toastErr(e); } };
    $('#st-cache', back).onclick = async () => { try { await api('/api/einstellungen/cache-leeren', {}); toast('Vorschaubilder werden beim nächsten Anzeigen neu erzeugt.', 'ok'); location.reload(); } catch (e) { toastErr(e); } };
    $('#st-log', back).onclick = () => api('/api/protokoll-oeffnen', {}).catch(toastErr);
    updBindBox(back);
  } });
}

// ================================================================ Tastatur
function onKey(e) {
  const top = layerTop();
  if (e.key === 'Escape') {
    if (busyEl) return;
    if (top && top.classList.contains('modal-back')) { top._close(); return; }
    if ($('.lightbox')) { closeLightbox(); return; }
    if (typeof Imp !== 'undefined' && Imp.st) { closeImport(); return; }
    if (S.form) { closeForm(); return; }
    if (S.detail) { closeDetail(); return; }
    return;
  }
  const lb = $('.lightbox');
  if (lb && !(top && top.classList.contains('modal-back'))) { if (lb._key(e)) e.preventDefault(); return; }
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName);
  if (e.key === 'F5') { e.preventDefault(); if (!S.form) rescan(false); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); if (!S.form && S.data) openForm('neu'); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !S.form) { e.preventDefault(); closeDetail(); const q = $('#q'); if (q) { q.focus(); q.select(); } return; }
  if (S.detail && !S.form && !typing && !(top && top.classList.contains('modal-back'))) {
    if (e.key === 'ArrowLeft') { const b = $('#d-prev'); if (b && !b.disabled) b.click(); }
    if (e.key === 'ArrowRight') { const b = $('#d-next'); if (b && !b.disabled) b.click(); }
  }
}

// ================================================================ Kollektionen (gemeinsam mit der Handy-App)
// Datei: Sammlung\.apologea\kollektionen.json – Pieces werden über ihre id referenziert, ihre Ordner bleiben unverändert.
const K = { list: [], stand: '', error: null, reorder: null, removed: new Set() };
const K_STATUS = [['idee', 'Idee'], ['planung', 'In Planung'], ['bereit', 'Bereit'], ['veroeffentlicht', 'Veröffentlicht']];
const K_LABEL = Object.fromEntries(K_STATUS);
const K_BADGE = { idee: '', planung: 'entwurf', bereit: 'hinweis', veroeffentlicht: 'ok' };
const kById = id => K.list.find(c => c.id === id);
const kPieces = c => (c.pieces || []).map(id => S.byId.get(id)).filter(Boolean);
const kMissing = c => (c.pieces || []).filter(id => !S.byId.has(id)).length;
const kBadge = c => `<span class="badge ${K_BADGE[c.status] || ''}">${esc(K_LABEL[c.status] || 'Idee')}</span>`;
const kDrop = d => { if (!d) return ''; const x = new Date(d + 'T12:00:00'); return isNaN(x) ? d : x.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' }); };
const kNewId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/-/g, '');
function kNow() {
  const d = new Date(), p = n => String(n).padStart(2, '0'), off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${off >= 0 ? '+' : '-'}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}

async function kLoad() {
  try { const r = await api('/api/kollektionen'); K.list = r.kollektionen || []; K.stand = r.stand || ''; K.error = null; }
  catch (e) { K.error = e.message; }
  if (S.filter.koll && !kById(S.filter.koll)) S.filter.koll = '';
}

/** Ändern mit Schutz vor gleichzeitigen Änderungen: aktuellen Stand lesen, ändern, nur speichern wenn unverändert */
async function kUpdate(mutate, msg) {
  busy(msg || 'Wird gespeichert …');
  try {
    for (let i = 0; i < 3; i++) {
      const r = await api('/api/kollektionen');
      const list = r.kollektionen || [];
      const res = mutate(list);
      try {
        const s = await api('/api/kollektionen/speichern', { stand: r.stand, kollektionen: list });
        K.list = s.kollektionen || list; K.stand = s.stand; K.error = null;
        unbusy();
        kRefreshUi();
        return res === undefined ? true : res;
      } catch (e) { if (e.status !== 409) throw e; }
    }
    throw new Error('Die Kollektionen wurden gleichzeitig an einem anderen Gerät geändert. Bitte erneut versuchen.');
  } catch (e) { unbusy(); toastErr(e, 'Speichern nicht möglich'); return null; }
}
function kRefreshUi() { renderSidebar(); renderGrid(); if (S.detail) { const box = $('#d-coll'); if (box) kFillDetail(S.detail, box); } }

function kSidebarHtml() {
  const item = c => { const n = kPieces(c).length; return `<li><button class="nav-item ${S.filter.koll === c.id ? 'active' : ''}" data-kind="koll" data-v="${esc(c.id)}" title="${esc((K_LABEL[c.status] || 'Idee') + (c.drop ? ' · Drop ' + kDrop(c.drop) : ''))}"><span>${esc(c.name)}</span><span class="count">${n}</span></button></li>`; };
  const cs = K.list.slice().sort((a, b) => String(a.drop || '9999').localeCompare(String(b.drop || '9999')) || a.name.localeCompare(b.name, 'de'));
  return `<div class="section-title">Kollektionen</div>
    ${K.error ? `<p class="hint error" style="margin:0 0 10px">${esc(K.error)}</p>` : ''}
    ${cs.length ? `<ul class="nav-list">${cs.map(item).join('')}</ul>` : '<p class="faint" style="font-size:13px;margin:0 0 18px">Noch keine Kollektionen – z. B. „Erster Drop“.</p>'}
    <button class="btn ghost small nav-add" id="b-newkoll">${icon('plus')}Neue Kollektion …</button>`;
}

function kBarHtml(c) {
  const ps = kPieces(c), miss = kMissing(c);
  return `<div class="collbar">
    <div class="collbar-main">
      <div class="collbar-kicker">Kollektion${c.drop ? ' · Drop ' + esc(kDrop(c.drop)) : ''}</div>
      <div class="collbar-title"><h2>${esc(c.name)}</h2>${kBadge(c)}<span class="muted">${ps.length} ${ps.length === 1 ? 'Piece' : 'Pieces'} · in der Reihenfolge der Kollektion</span></div>
      ${c.beschreibung ? `<p class="collbar-desc">${esc(c.beschreibung).replace(/\n/g, '<br>')}</p>` : ''}
      ${miss ? `<p class="hint warn" style="margin:6px 0 0">${miss === 1 ? '1 Piece ist' : miss + ' Pieces sind'} nicht mehr in der Sammlung (gelöscht oder im Papierkorb). <button class="btn small ghost" id="k-clean">Entfernen</button></p>` : ''}
    </div>
    <div class="btn-row collbar-actions">
      <button class="btn primary" id="k-pick">${icon('plus')}Pieces wählen</button>
      <button class="btn" id="k-order" ${ps.length ? '' : 'disabled'}>${icon('sort')}Reihenfolge &amp; entfernen</button>
      <button class="btn gold" id="k-cat" ${ps.length ? '' : 'disabled'}>${icon('file')}Katalog (PDF)</button>
      <button class="btn ghost" id="k-edit">${icon('edit')}Bearbeiten</button>
    </div></div>`;
}
function kBindBar(c) {
  const on = (id, fn) => { const b = $('#' + id); if (b) b.onclick = fn; };
  on('k-pick', () => kPick(c));
  on('k-order', () => kOrder(c));
  on('k-edit', () => kEdit(c));
  on('k-cat', () => openCatalog({ collection: c, pieces: kPieces(c) }));
  on('k-clean', () => kUpdate(cs => { const x = cs.find(k => k.id === c.id); if (x) x.pieces = (x.pieces || []).filter(id => S.byId.has(id)); }));
}

async function kRemove(c, ids) {
  const set = new Set(ids);
  const ok = await kUpdate(cs => { const x = cs.find(k => k.id === c.id); if (!x) throw new Error('Die Kollektion wurde inzwischen gelöscht.'); x.pieces = (x.pieces || []).filter(id => !set.has(id)); x.geaendert = kNow(); }, 'Wird entfernt …');
  if (ok) toast(set.size === 1 ? 'Aus der Kollektion entfernt.' : set.size + ' Pieces aus der Kollektion entfernt.', 'ok');
}

// ------------------------------------------------------------ Anlegen / Bearbeiten / Löschen
function kEdit(c) {
  let status = c ? c.status || 'idee' : 'idee';
  const removed = new Set();
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="field"><label for="ke-name">Name<span class="req">*</span></label><input class="input" id="ke-name" maxlength="60" value="${esc(c ? c.name : '')}" placeholder="z. B. ERSTER DROP" autocomplete="off"></div>
    <div class="field"><label for="ke-desc">Beschreibung <span class="faint">(optional)</span></label><textarea class="input" id="ke-desc" rows="3" placeholder="Idee, Thema, Botschaft der Kollektion …">${esc(c ? c.beschreibung || '' : '')}</textarea></div>
    <div class="field"><label>Status</label><div class="seg" id="ke-status">${K_STATUS.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === status ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="field"><label for="ke-drop">Drop-Datum <span class="faint">(optional)</span></label><input class="input" id="ke-drop" type="date" value="${esc(c ? c.drop || '' : '')}" style="max-width:220px"></div>
    ${c ? `<div class="field"><label>Pieces in dieser Kollektion <span class="faint" id="ke-count"></span></label><div class="filelist kedit-list" id="ke-pieces"></div><span class="hint">Mit ✕ entfernen – gespeichert wird mit „Speichern“. Hinzufügen über „Pieces wählen“.</span></div>
      <div class="btn-row" style="margin-top:6px"><button type="button" class="btn danger small" id="ke-del">${icon('trash')}Kollektion löschen</button><span class="hint">Löscht nur die Zusammenstellung – die Pieces bleiben erhalten.</span></div>` : ''}`;
  const draw = () => {
    const box = $('#ke-pieces', body); if (!box) return;
    const ids = (c.pieces || []).filter(id => !removed.has(id));
    $('#ke-count', body).textContent = `(${ids.length})`;
    box.innerHTML = ids.length ? ids.map(id => { const p = S.byId.get(id); return `<div class="filerow"><div class="fn">${p ? 'Nr. ' + p.nummerText + ' · ' + esc(p.name) + '<small>' + esc(p.kategorie) + '</small>' : '<span class="faint">Nicht mehr in der Sammlung</span>'}</div><button type="button" class="btn small danger icon-only" data-x="${esc(id)}" title="Entfernen">✕</button></div>`; }).join('') : '<p class="faint" style="padding:10px 14px;margin:0">Keine Pieces.</p>';
  };
  let data = null;
  modal({
    title: c ? 'Kollektion bearbeiten' : 'Neue Kollektion', wide: !!c, body,
    buttons: [{ label: 'Abbrechen', value: null }, { label: c ? 'Speichern' : 'Anlegen', cls: 'primary', run: () => {
      const name = $('#ke-name', body).value.trim();
      if (!name) { $('#ke-name', body).classList.add('invalid'); toast('Bitte einen Namen eingeben.', 'err'); return false; }
      if (K.list.some(x => x.id !== (c && c.id) && norm(x.name) === norm(name))) { toast(`Eine Kollektion „${name}“ gibt es bereits.`, 'err'); return false; }
      data = { name, beschreibung: $('#ke-desc', body).value.replace(/\r\n/g, '\n').trim(), status, drop: $('#ke-drop', body).value || '' };
    } }],
    onOpen: (back, close) => {
      if (c) { draw(); $('#ke-pieces', body).onclick = e => { const b = e.target.closest('[data-x]'); if (b) { removed.add(b.dataset.x); draw(); } }; }
      $('#ke-status', body).onclick = e => { const b = e.target.closest('button'); if (!b) return; status = b.dataset.v; $$('#ke-status button', body).forEach(x => x.classList.toggle('on', x === b)); };
      const del = $('#ke-del', body);
      if (del) del.onclick = async () => {
        close(null);
        if (!(await confirmDialog('Kollektion löschen?', `„${esc(c.name)}“ wird gelöscht. Die Pieces selbst bleiben unverändert in der Sammlung.`, 'Löschen', true))) return;
        if (await kUpdate(cs => { const i = cs.findIndex(k => k.id === c.id); if (i >= 0) cs.splice(i, 1); }, 'Wird gelöscht …')) { if (S.filter.koll === c.id) { S.filter.koll = ''; kRefreshUi(); } toast('Kollektion gelöscht.', 'ok'); }
      };
    }
  }).then(async () => {
    if (!data) return;
    if (c) {
      const ok = await kUpdate(cs => { const x = cs.find(k => k.id === c.id); if (!x) throw new Error('Die Kollektion wurde inzwischen gelöscht.'); Object.assign(x, data, { geaendert: kNow() }); if (removed.size) x.pieces = (x.pieces || []).filter(id => !removed.has(id)); });
      if (ok) toast(removed.size ? `Gespeichert · ${removed.size} ${removed.size === 1 ? 'Piece' : 'Pieces'} entfernt.` : 'Gespeichert.', 'ok');
    } else {
      const id = kNewId(), now = kNow();
      if (await kUpdate(cs => { cs.push(Object.assign({ id, pieces: [], erstellt: now, geaendert: now }, data)); }, 'Kollektion wird angelegt …')) {
        S.filter = { q: S.filter.q, kat: '', status: '', koll: id };
        kRefreshUi();
        kPick(kById(id));
      }
    }
  });
}

// ------------------------------------------------------------ Pieces auswählen (Suchleiste)
function kPick(c) {
  if (!c) return;
  const all = S.data.pieces.slice().sort((a, b) => a.kategorie.localeCompare(b.kategorie, 'de') || a.nummer - b.nummer);
  const sel = new Set((c.pieces || []).filter(id => S.byId.has(id)));
  let q = '';
  const hits = () => { const t = norm(q).split(/\s+/).filter(Boolean); return t.length ? all.filter(p => t.every(x => p._hay.includes(x))) : all; };
  const thumbOf = p => { for (const r of ['mockup', 'design', 'kleidungsansicht']) { const f = p.bilder[r]; if (f && f.vorhanden && f.vorschau) return f; } return null; };
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="search kpick-search">${icon('search')}<input class="input" id="kp-q" type="search" placeholder="Suchen: Name, Nummer, Motiv, Serie, Kleidungstyp …" autocomplete="off"></div>
    <div class="kpick-tools"><label class="checkbox"><input type="checkbox" id="kp-all"><span>Alle Pieces <span class="faint">(${all.length})</span></span></label>
      <span class="spacer"></span><span class="muted" id="kp-count"></span>
      <button type="button" class="btn small ghost" id="kp-hits">Treffer wählen</button><button type="button" class="btn small ghost" id="kp-none">Leeren</button></div>
    <div class="filelist kpick-list" id="kp-list"></div>`;
  const render = () => {
    const l = hits();
    $('#kp-list', body).innerHTML = l.length ? l.slice(0, 500).map(p => { const f = thumbOf(p); return `<label class="filerow kpick-row"><input type="checkbox" data-id="${esc(p.id)}" ${sel.has(p.id) ? 'checked' : ''}>${f ? `<img class="thumb" loading="lazy" src="${thumbUrl(f, 96)}" alt="">` : '<span class="thumb"></span>'}<div class="fn">Nr. ${p.nummerText} · <b>${esc(p.name)}</b><small>${esc(p.kategorie)}${p.motivtitel ? ' · ' + esc(p.motivtitel) : ''}${p.status === 'Entwurf' ? ' · Entwurf' : ''}</small></div></label>`; }).join('') + (l.length > 500 ? `<p class="hint" style="padding:8px 14px">… und ${l.length - 500} weitere – bitte Suche verfeinern.</p>` : '') : '<p class="faint" style="padding:10px 14px;margin:0">Keine Treffer.</p>';
    $('#kp-count', body).textContent = `${sel.size} ausgewählt${q ? ' · ' + l.length + ' Treffer' : ''}`;
    const a = $('#kp-all', body); a.checked = sel.size === all.length; a.indeterminate = sel.size > 0 && sel.size < all.length;
  };
  let ok = false;
  modal({
    title: 'Pieces für „' + c.name + '“', wide: true, body,
    buttons: [{ label: 'Abbrechen', value: null }, { label: 'Übernehmen', cls: 'primary', run: () => { ok = true; } }],
    onOpen: () => {
      render();
      $('#kp-q', body).addEventListener('input', debounce(e => { q = e.target.value; render(); }, 100));
      $('#kp-hits', body).onclick = () => { hits().forEach(p => sel.add(p.id)); render(); };
      $('#kp-none', body).onclick = () => { sel.clear(); render(); };
      $('#kp-all', body).onchange = e => { if (e.target.checked) all.forEach(p => sel.add(p.id)); else sel.clear(); render(); };
      $('#kp-list', body).addEventListener('change', e => { const x = e.target.closest('input[data-id]'); if (!x) return; if (x.checked) sel.add(x.dataset.id); else sel.delete(x.dataset.id); render(); });
    }
  }).then(async () => {
    if (!ok) return;
    const chosen = new Set(sel);
    const r = await kUpdate(cs => {
      const x = cs.find(k => k.id === c.id); if (!x) throw new Error('Die Kollektion wurde inzwischen gelöscht.');
      const keep = (x.pieces || []).filter(id => chosen.has(id) || !S.byId.has(id)); // gelöschte bleiben, bis sie bewusst entfernt werden
      const add = all.map(p => p.id).filter(id => chosen.has(id) && !keep.includes(id));
      x.pieces = keep.concat(add); x.geaendert = kNow();
    }, 'Kollektion wird gespeichert …');
    if (r) toast(`${chosen.size} ${chosen.size === 1 ? 'Piece' : 'Pieces'} in „${c.name}“.`, 'ok');
  });
}

// ------------------------------------------------------------ Reihenfolge & entfernen
function kOrder(c) {
  const order = kPieces(c).map(p => p.id), removed = new Set();
  const body = document.createElement('div');
  const draw = () => {
    body.innerHTML = `<p class="muted" style="margin-top:0">Reihenfolge mit den Pfeilen ändern, mit ✕ aus der Kollektion entfernen. Gespeichert wird erst mit „Speichern“.</p>
      <div class="filelist kpick-list">${order.map((id, i) => { const p = S.byId.get(id); return `<div class="filerow"><span class="kord-nr">${i + 1}.</span><div class="fn">Nr. ${p.nummerText} · <b>${esc(p.name)}</b><small>${esc(p.kategorie)}</small></div>
        <button type="button" class="btn small icon-only" data-up="${i}" ${i ? '' : 'disabled'} title="Nach oben">↑</button><button type="button" class="btn small icon-only" data-down="${i}" ${i < order.length - 1 ? '' : 'disabled'} title="Nach unten">↓</button><button type="button" class="btn small danger icon-only" data-x="${i}" title="Aus Kollektion entfernen">✕</button></div>`; }).join('') || '<p class="faint" style="padding:10px 14px;margin:0">Keine Pieces.</p>'}</div>`;
  };
  draw();
  body.addEventListener('click', e => {
    const up = e.target.closest('[data-up]'), down = e.target.closest('[data-down]'), x = e.target.closest('[data-x]');
    if (up) { const i = +up.dataset.up; [order[i - 1], order[i]] = [order[i], order[i - 1]]; draw(); }
    if (down) { const i = +down.dataset.down; [order[i + 1], order[i]] = [order[i], order[i + 1]]; draw(); }
    if (x) { removed.add(order[+x.dataset.x]); order.splice(+x.dataset.x, 1); draw(); }
  });
  let ok = false;
  modal({ title: 'Reihenfolge – ' + c.name, wide: true, body, buttons: [{ label: 'Abbrechen', value: null }, { label: 'Speichern', cls: 'primary', run: () => { ok = true; } }] })
    .then(async () => {
      if (!ok) return;
      const r = await kUpdate(cs => {
        const k = cs.find(y => y.id === c.id); if (!k) throw new Error('Die Kollektion wurde inzwischen gelöscht.');
        const cur = k.pieces || [];
        const rest = cur.filter(id => !order.includes(id) && !removed.has(id)); // z. B. inzwischen an anderem Gerät hinzugefügt
        k.pieces = order.filter(id => cur.includes(id)).concat(rest); k.geaendert = kNow();
      });
      if (r) toast(removed.size ? `Gespeichert · ${removed.size} ${removed.size === 1 ? 'Piece' : 'Pieces'} entfernt.` : 'Reihenfolge gespeichert.', 'ok');
    });
}

// ------------------------------------------------------------ Detailansicht eines Pieces
function kFillDetail(p, box) {
  if (!box) return;
  const mine = K.list.filter(c => (c.pieces || []).includes(p.id));
  box.innerHTML = `<div class="section-title" style="margin-top:22px">Kollektionen</div>
    <div class="btn-row">${mine.map(c => `<button class="chip static kchip" data-id="${esc(c.id)}" title="Kollektion anzeigen">${esc(c.name)}</button>`).join('')}
    <button class="btn small ghost" id="d-koll">${icon('plus')}Zu Kollektion …</button></div>`;
  $$('.kchip', box).forEach(b => b.onclick = () => { closeDetail(); S.filter = { q: '', kat: '', status: '', koll: b.dataset.id }; const q = $('#q'); if (q) q.value = ''; renderSidebar(); renderGrid(); });
  $('#d-koll', box).onclick = () => kToggleFor(p);
}
function kToggleFor(p) {
  const want = new Set(K.list.filter(c => (c.pieces || []).includes(p.id)).map(c => c.id));
  const body = document.createElement('div');
  body.innerHTML = `${K.list.length ? K.list.map(c => `<label class="checkbox"><input type="checkbox" data-id="${esc(c.id)}" ${want.has(c.id) ? 'checked' : ''}><span>${esc(c.name)} <span class="faint">· ${kPieces(c).length} Pieces</span></span></label>`).join('') : '<p class="faint">Noch keine Kollektionen.</p>'}
    <div class="field" style="margin-top:12px"><label for="kt-new">Neue Kollektion mit diesem Piece <span class="faint">(optional)</span></label><input class="input" id="kt-new" maxlength="60" placeholder="Name der neuen Kollektion" autocomplete="off"></div>`;
  let ok = false;
  modal({ title: `Nr. ${p.nummerText} · ${p.name}`, body, buttons: [{ label: 'Abbrechen', value: null }, { label: 'Übernehmen', cls: 'primary', run: () => {
    const n = $('#kt-new', body).value.trim();
    if (n && K.list.some(x => norm(x.name) === norm(n))) { toast(`Eine Kollektion „${n}“ gibt es bereits.`, 'err'); return false; }
    $$('input[data-id]', body).forEach(x => { if (x.checked) want.add(x.dataset.id); else want.delete(x.dataset.id); });
    ok = n || true;
  } }] }).then(async () => {
    if (!ok) return;
    const newName = typeof ok === 'string' ? ok : '';
    const r = await kUpdate(cs => {
      cs.forEach(c => {
        c.pieces = c.pieces || [];
        const has = c.pieces.includes(p.id);
        if (want.has(c.id) && !has) { c.pieces.push(p.id); c.geaendert = kNow(); }
        if (!want.has(c.id) && has) { c.pieces = c.pieces.filter(id => id !== p.id); c.geaendert = kNow(); }
      });
      if (newName) { const now = kNow(); cs.push({ id: kNewId(), name: newName, beschreibung: '', status: 'idee', drop: '', pieces: [p.id], erstellt: now, geaendert: now }); }
    });
    if (r) toast('Kollektionen aktualisiert.', 'ok');
  });
}

// ================================================================ Programm-Aktualisierung
const UPD = { info: null, checking: false };
function updBoxHtml() {
  const i = UPD.info;
  if (UPD.checking) return '<p class="muted">Suche nach Updates …</p>';
  if (!i) return `<button class="btn small gold" id="upd-check">${icon('refresh')}Nach Updates suchen</button>`;
  if (i.fehler) return `<p class="hint error">${esc(i.fehler)}</p><button class="btn small" id="upd-check">${icon('refresh')}Erneut suchen</button>`;
  if (!i.verfuegbar) return `<p class="hint ok" style="margin-bottom:8px">Das Programm ist aktuell (Version ${esc(i.aktuell)}).</p><button class="btn small ghost" id="upd-check">${icon('refresh')}Erneut suchen</button>`;
  return `<div class="result-box ok" style="margin-bottom:10px"><b>Neue Version ${esc(i.neueste)} verfügbar</b> (installiert: ${esc(i.aktuell)})${i.hinweise ? `<div style="margin-top:6px;white-space:pre-line">${esc(i.hinweise)}</div>` : ''}</div>
    <div class="btn-row"><button class="btn primary" id="upd-install">${icon('upload')}Jetzt aktualisieren</button><button class="btn small ghost" id="upd-check">${icon('refresh')}Erneut suchen</button></div>`;
}
function updBindBox(root) {
  const box = $('#st-upd', root); if (!box) return;
  const c = $('#upd-check', box); if (c) c.onclick = async () => { await updCheck(false); box.innerHTML = updBoxHtml(); updBindBox(root); };
  const i = $('#upd-install', box); if (i) i.onclick = () => updInstall();
}
async function updCheck(silent) {
  UPD.checking = true;
  try { UPD.info = await api('/api/update/pruefen'); store.set('updLast', Date.now()); }
  catch (e) { UPD.info = { fehler: e.message }; }
  finally { UPD.checking = false; }
  renderUpdateBar();
  return UPD.info;
}
async function updAutoCheck() {
  if (Date.now() - (store.get('updLast', 0) || 0) < 12 * 3600 * 1000 && !store.get('updVerfuegbar', false)) return;
  const i = await updCheck(true);
  store.set('updVerfuegbar', !!(i && i.verfuegbar));
}
function renderUpdateBar() {
  const bar = $('#updatebar'); if (!bar) return;
  const i = UPD.info;
  bar.innerHTML = i && i.verfuegbar ? `<div class="notice-bar upd-bar">${icon('upload')}<span><b>Neue Programmversion ${esc(i.neueste)}</b> ist verfügbar (installiert: ${esc(i.aktuell)}).</span><button class="btn small gold" id="upd-bar-go">Ansehen und aktualisieren</button></div>` : '';
  const b = $('#upd-bar-go', bar); if (b) b.onclick = () => updInstall();
}
async function updInstall() {
  const i = UPD.info;
  if (!i || !i.verfuegbar) { await updCheck(false); if (!UPD.info || !UPD.info.verfuegbar) { toast(UPD.info && UPD.info.fehler ? UPD.info.fehler : 'Das Programm ist bereits aktuell.', UPD.info && UPD.info.fehler ? 'err' : 'ok'); return; } }
  const info = UPD.info;
  const ok = await confirmDialog(`Auf Version ${esc(info.neueste)} aktualisieren?`,
    `${info.hinweise ? `<span style="white-space:pre-line">${esc(info.hinweise)}</span><br><br>` : ''}Das Programm lädt die neuen Dateien, prüft sie, sichert die bisherige Version, baut neu und startet anschließend neu (ca. 1 Minute). Ihre Sammlung wird dabei nicht berührt.`, 'Jetzt aktualisieren');
  if (!ok) return;
  if (S.form) { toast('Bitte zuerst das geöffnete Formular speichern oder schließen.', 'err'); return; }
  busy('Update wird geladen, geprüft und gebaut – bitte warten …');
  try {
    const r = await api('/api/update/installieren', { commit: info.commit });
    store.set('updVerfuegbar', false);
    busy(`Version ${r.version} ist installiert. APOLOGEA startet neu – das neue Fenster öffnet sich gleich.`);
    setTimeout(() => { try { window.close(); } catch (e) { /* Fenster wird vom Programm geschlossen */ } }, 4000);
  } catch (e) { unbusy(); toastErr(e, 'Aktualisierung nicht möglich'); updCheck(true); }
}

boot();
