// Kernfunktionen der Oberfläche: Server-Aufrufe, sichere DOM-Erzeugung, Dialoge, Meldungen.

export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) { super(message); this.status = status; this.code = code; this.details = details; }
}

export async function api(method, url, body) {
  const opts = { method, headers: { 'X-Studio': '1' }, credentials: 'same-origin' };
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(url, opts); } catch {
    throw new ApiError('Keine Verbindung zum Studio-Dienst. Läuft das Programm noch?', { status: 0, code: 'offline' });
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) throw new ApiError(data?.error || `Fehler ${res.status}`, { status: res.status, code: data?.code, details: data?.details });
  return data;
}
export const get = (u) => api('GET', u);
export const post = (u, b = {}) => api('POST', u, b);
export const put = (u, b) => api('PUT', u, b);
export const del = (u) => api('DELETE', u);

export async function upload(url, file, headers = {}) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'X-Studio': '1', 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || 'datei'), ...headers }, body: file });
  } catch { throw new ApiError('Upload fehlgeschlagen: keine Verbindung.', { code: 'offline' }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Fehler ${res.status}`, { status: res.status, code: data.code });
  return data;
}

/** Hyperscript: h('div.klasse#id', { attr }, kinder…) – Text wird immer als Text eingefügt (kein HTML). */
export function h(tag, attrs, ...children) {
  const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9-]*)(.*)$/i);
  const el = document.createElement(name || 'div');
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = Boolean(v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) { el.replaceChildren(); append(el, children); return el; }

export function svg(markup) {
  // Nur für feste, im Programm enthaltene Symbole verwendet (keine Nutzerdaten).
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

export const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.5"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  web: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>',
  shirt: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.5"><path d="M8 3l-5 3 2 5 2-1v11h10V10l2 1 2-5-5-3c0 2-2 3-4 3S8 5 8 3z"/></svg>',
  library: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.5"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 3"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  analytics: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.5"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  cross: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M24 4v40M4 24h40"/><path d="M24 4l-3 4h6zM24 44l-3-4h6zM4 24l4-3v6zM44 24l-4-3v6z" fill="currentColor"/><rect x="19" y="19" width="10" height="10" transform="rotate(45 24 24)"/></svg>',
  diamond: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M12 3l6 9-6 9-6-9z"/><path d="M12 8l2.5 4-2.5 4-2.5-4z" fill="currentColor"/></svg>',
  menu: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
};

export function ornament() {
  return h('div.ornament', svg(ICONS.diamond));
}

const SLUG = { 'Entwurf': 'entwurf', 'Angaben fehlen': 'angaben-fehlen', 'Bereit zur Prüfung': 'bereit-zur-pruefung', 'Freigabe erforderlich': 'freigabe-erforderlich', 'Wird ausgeführt': 'wird-ausgefuehrt', 'Erfolgreich': 'erfolgreich', 'Fehlgeschlagen': 'fehlgeschlagen', 'Ergebnis muss geprüft werden': 'ergebnis-muss-geprueft-werden' };
export function badge(status, { simulated } = {}) {
  return h('span', null,
    h(`span.badge.st-${SLUG[status] || 'entwurf'}`, status || 'Entwurf'),
    simulated ? h('span.badge.sim', { style: { marginLeft: '6px' } }, 'Simulation') : null);
}

// ---------------- Meldungen
let toastBox;
export function toast(msg, kind = 'info', ms = 5000) {
  if (!toastBox) { toastBox = h('div.toasts', { role: 'status', 'aria-live': 'polite' }); document.body.append(toastBox); }
  const t = h(`div.toast.${kind}`, msg);
  toastBox.append(t);
  while (toastBox.children.length > 4) toastBox.firstElementChild.remove();
  setTimeout(() => t.remove(), ms);
}
/** Hinweis an die Nutzerin bzw. den Nutzer (kein Programmfehler). */
export function userError(message) {
  return Object.assign(new Error(message), { user: true });
}
export function showError(err) {
  if (!(err instanceof ApiError) && !err?.user) console.error(err);
  toast(err?.message || String(err), 'error', 9000);
}

// ---------------- Dialoge
export function modal({ title, eyebrow, body, actions = [], wide = false, onClose, onReady }) {
  return new Promise((resolve) => {
    const close = (v) => { overlay.remove(); document.removeEventListener('keydown', onKey); onClose?.(v); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(undefined); };
    const foot = h('div.foot', actions.map((a) => {
      const b = h(`button${a.primary ? '.primary' : ''}${a.danger ? '.danger' : ''}`, { type: 'button' }, a.label);
      b.addEventListener('click', async () => {
        if (a.onClick) {
          b.disabled = true;
          try { const r = await a.onClick(b); if (r !== false) close(a.value ?? r); } catch (err) { showError(err); } finally { b.disabled = false; }
        } else close(a.value);
      });
      return b;
    }));
    const dialog = h(`div.dialog.frame${wide ? '.wide' : ''}`, { role: 'dialog', 'aria-modal': 'true' },
      h('div.head', h('div', eyebrow ? h('div.eyebrow', eyebrow) : null, h('h2', title)), h('button.ghost.icon-btn', { type: 'button', 'aria-label': 'Schließen', onclick: () => close(undefined) }, '✕')),
      body, foot);
    const overlay = h('div.overlay', dialog);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(undefined); });
    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
    onReady?.(close);
    (dialog.querySelector('input,textarea,select,button.primary') || dialog).focus?.();
  });
}

export function confirmDialog({ title, text, confirmLabel = 'Bestätigen', danger = false }) {
  return modal({ title, body: h('div', [].concat(text).map((t) => h('p', t))), actions: [{ label: 'Abbrechen', value: false }, { label: confirmLabel, value: true, primary: !danger, danger }] });
}

export function fmtDate(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function fmtEuro(v) {
  return v === null || v === undefined || Number.isNaN(Number(v)) ? '–' : Number(v).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}
export function fmtUsd(v) {
  return v === null || v === undefined ? '–' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 4 });
}
export function fmtBytes(n) {
  if (!n && n !== 0) return '–';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

/** Verzögertes automatisches Speichern. */
export function autosaver(saveFn, indicator, delay = 700) {
  let timer = null;
  let pending = null;
  let running = Promise.resolve();
  const flush = async () => {
    if (!pending) return running;
    const data = pending;
    pending = null;
    clearTimeout(timer);
    if (indicator) indicator.textContent = 'Speichert …';
    running = running.then(() => saveFn(data)).then(() => {
      if (indicator) indicator.textContent = 'Gespeichert ' + new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }).catch((err) => { if (indicator) indicator.textContent = 'Nicht gespeichert!'; showError(err); });
    return running;
  };
  return {
    schedule(data) { pending = { ...(pending || {}), ...data }; clearTimeout(timer); timer = setTimeout(flush, delay); if (indicator) indicator.textContent = 'Ungespeicherte Änderungen …'; },
    flush,
  };
}

/** Button während einer Aktion sperren (verhindert Doppelklicks). */
export async function busy(button, fn) {
  if (button.dataset.busy === '1') return undefined;
  button.dataset.busy = '1';
  const label = [...button.childNodes];
  button.disabled = true;
  button.replaceChildren(h('span.spinner'), ' Bitte warten …');
  try { return await fn(); } finally {
    button.dataset.busy = '0';
    button.disabled = false;
    button.replaceChildren(...label);
  }
}

/** Bild verkleinern (für Vorschaubilder) – Ergebnis als Blob. */
export async function shrinkImage(file, maxSide, type = 'image/png', quality = 0.9) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const w = img.naturalWidth || 1024;
    const hgt = img.naturalHeight || 1024;
    const s = Math.min(1, maxSide / Math.max(w, hgt));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s));
    c.height = Math.max(1, Math.round(hgt * s));
    const ctx = c.getContext('2d');
    if (type === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, type, quality));
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}

export function dropzone({ accept, multiple = true, label, onFiles }) {
  const input = h('input', { type: 'file', accept, multiple, class: 'hidden' });
  const zone = h('div.dropzone', { tabindex: 0, role: 'button' }, label || 'Dateien hierher ziehen oder klicken');
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); onFiles([...e.dataTransfer.files]); });
  input.addEventListener('change', () => { onFiles([...input.files]); input.value = ''; });
  return h('div', zone, input);
}

export async function openExternal(url) {
  try {
    const r = await post('/api/open-external', { url });
    // Ausweg, falls Windows den Standardbrowser nicht startet: im Programmfenster öffnen
    if (!r.ok) window.open(url, '_blank', 'noopener');
  } catch (err) { showError(err); }
}

export function extLink(label, url) {
  return h('a', { href: url, onclick: (e) => { e.preventDefault(); openExternal(url); } }, label, ' ↗');
}
