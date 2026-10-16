import { h, clear, get, post, upload, showError, toast, busy, userError } from '../core.js';
import { setCleanup } from '../app.js';

/**
 * Website-Editor im Stil des Shopify-Theme-Editors:
 *  - oben: Auftrag an Claude (Schwerpunkt) – Änderung per Beschreibung
 *  - links: Seiten, Abschnitte und Blöcke · Mitte: Live-Ansicht des Shops · rechts: Einstellungen
 * Eigene Änderungen werden gesammelt und erst nach Vorschau, Prüfung und Freigabe übernommen.
 */

const TYPE_HINT = {
  richtext: 'Formatierter Text (HTML, z. B. <p>…</p>)',
  inline_richtext: 'Kurzer formatierter Text (HTML erlaubt: <strong>, <em>, <a>)',
  html: 'HTML-Code',
};

export async function renderSiteEditor(main, query = {}) {
  let session = await get('/api/website/editor/session');
  let draft = session.draft;
  let data = null;
  let template = query.vorlage || 'templates/index.json';
  let selected = null; // { file, sectionId, blockPath, node }
  let mode = 'select';
  let device = 'desktop';
  let themeView = query.theme ? String(query.theme) : null; // null = live
  let previewBase = session.previewLive;
  let currentPath = '/';
  let domIds = [];

  // ---------- Grundgerüst
  const prompt = h('textarea.big', { rows: 2, placeholder: 'Beschreibe, was Claude an deiner Website ändern soll – z. B. „Ersetze das Bild oben auf der Startseite durch das angehängte und schreibe eine ruhigere Überschrift.“' });
  const contextChip = h('span.chip');
  const askBtn = h('button.primary', { type: 'button' }, 'Vorschlag mit Claude erstellen');
  const iframe = h('iframe.site-frame', { title: 'Live-Ansicht des Shops', sandbox: 'allow-scripts' });
  const frameWrap = h('div.site-frame-wrap', iframe);
  const pathLabel = h('span.path');
  const tree = h('div.tree', h('span.muted', 'Wird geladen …'));
  const pageSelect = h('select', { 'aria-label': 'Seite' });
  const inspector = h('div.inspector', h('div.empty', 'Abschnitt in der Ansicht anklicken oder links auswählen.'));
  const pendingBar = h('div.pending-bar');
  const themeSel = h('select', { 'aria-label': 'Ansicht' });

  const modeBtns = [['select', 'Auswählen'], ['browse', 'Durchklicken']].map(([v, l]) => h('button', { type: 'button', 'data-v': v, onclick: () => setMode(v) }, l));
  const devBtns = [['desktop', 'Desktop'], ['mobile', 'Mobil']].map(([v, l]) => h('button', { type: 'button', 'data-v': v, onclick: () => { device = v; frameWrap.classList.toggle('mobile', v === 'mobile'); markSeg(devBtns, v); } }, l));
  const markSeg = (btns, v) => btns.forEach((b) => b.classList.toggle('on', b.dataset.v === v));

  clear(main,
    h('div.page-head', h('div', h('div.eyebrow', 'Website bearbeiten'), h('h1', 'Website')),
      h('div.actions', h('a.btn.small', { href: '#/website/liste' }, 'Änderungen & Verlauf'))),
    h('div.ask-claude',
      h('div.ask-head', h('span.eyebrow', 'Mit Claude ändern'), contextChip),
      h('div.ask-row', prompt, askBtn),
      h('small.muted', 'Claude erstellt einen Vorschlag mit Vorher-nachher-Ansicht. Im Shop ändert sich erst nach deiner Freigabe etwas. Bilder kannst du im nächsten Schritt anhängen.')),
    pendingBar,
    h('div.site-editor',
      h('aside.site-left', h('label.field', h('span', 'Seite'), pageSelect), tree),
      h('div.site-center',
        h('div.site-toolbar',
          h('div.seg', modeBtns), h('div.seg', devBtns),
          themeSel,
          h('button.small.ghost', { type: 'button', title: 'Neu laden', onclick: () => loadFrame(currentPath) }, '↻'),
          pathLabel),
        frameWrap),
      h('aside.site-right', inspector)));
  markSeg(modeBtns, mode);
  markSeg(devBtns, device);

  // ---------- Live-Ansicht
  function frameSrc(path) {
    return `${previewBase}${path.startsWith('/') ? path : '/' + path}`;
  }
  function loadFrame(path) {
    currentPath = path || '/';
    pathLabel.textContent = currentPath;
    iframe.src = frameSrc(currentPath);
  }
  function setMode(v) {
    mode = v;
    markSeg(modeBtns, v);
    iframe.contentWindow?.postMessage({ __studio: 1, type: 'mode', mode: v }, '*');
  }
  const onMessage = (e) => {
    if (e.source !== iframe.contentWindow) return;
    const d = e.data || {};
    if (d.__studio !== 1) return;
    if (d.type === 'page') {
      currentPath = d.path || '/';
      pathLabel.textContent = currentPath;
      domIds = (d.sections || []).map((s) => s.domId);
      iframe.contentWindow.postMessage({ __studio: 1, type: 'mode', mode }, '*');
      const tpl = templateForPath(currentPath);
      if (data && tpl !== template && data.templates.some((t) => t.file === tpl)) { template = tpl; loadStructure(); }
      if (selected) highlight(selected);
    }
    if (d.type === 'select') {
      const sid = String(d.domId || '').split('__').pop();
      const hit = findSection(sid);
      if (hit) select(hit.file, hit.node, []);
      else toast('Dieser Bereich ist kein bearbeitbarer Abschnitt der Seite.', 'info');
    }
    if (d.type === 'external') toast('Externer Link – in der Vorschau nicht geöffnet.', 'info');
  };
  window.addEventListener('message', onMessage);
  setCleanup(() => window.removeEventListener('message', onMessage));

  function highlight(sel) {
    if (!sel || sel.blockPath.length) return;
    const domId = domIds.find((id) => id.endsWith(`__${sel.sectionId}`)) || `shopify-section-${sel.sectionId}`;
    iframe.contentWindow?.postMessage({ __studio: 1, type: 'highlight', domId }, '*');
  }

  // ---------- Struktur
  function findSection(sid) {
    for (const g of data?.groups || []) {
      const n = g.sections.find((s) => s.id === sid);
      if (n) return { file: g.file, node: n };
    }
    return null;
  }

  async function loadStructure() {
    clear(tree, h('span.muted', 'Wird geladen …'));
    try {
      data = await get(`/api/website/editor?template=${encodeURIComponent(template)}`);
      template = data.template;
      clear(pageSelect, data.templates.map((t) => h('option', { value: t.file, selected: t.file === template }, t.label)));
      renderTree();
      if (selected) {
        const g = data.groups.find((x) => x.file === selected.file);
        const sec = g?.sections.find((s) => s.id === selected.sectionId);
        let node = sec;
        for (const b of selected.blockPath) node = node?.children.find((c) => c.id === b);
        if (node) select(selected.file, sec, selected.blockPath, node); else { selected = null; renderInspector(); }
      }
      updateContext();
    } catch (err) {
      clear(tree, h('div.inline-msg.error', err.message, ' – ', h('a', { href: '#/einstellungen' }, 'Einstellungen')));
    }
  }
  pageSelect.addEventListener('change', () => {
    template = pageSelect.value;
    selected = null;
    renderInspector();
    loadStructure();
    const t = data?.templates.find((x) => x.file === template);
    if (t?.path) loadFrame(t.path === '/products' || t.path === '/pages' ? currentPath : t.path);
  });

  function renderTree() {
    clear(tree, data.groups.map((g) => h('div.tree-group',
      h('div.tree-head', g.label),
      g.sections.length ? g.sections.map((s) => nodeItem(g.file, s, s, [])) : h('small.muted', 'Keine Abschnitte'))));
  }

  function nodeItem(file, section, node, path) {
    const isSel = selected && selected.file === file && selected.sectionId === section.id && selected.blockPath.join('/') === path.join('/');
    const count = pendingFor(file, section.id, path);
    const item = h(`div.tree-item${isSel ? '.on' : ''}${node.disabled ? '.off' : ''}`, { tabindex: 0, role: 'button' },
      h('span', node.name), node.disabled ? h('small.muted', ' ausgeblendet') : null, count ? h('span.dot-pending', { title: `${count} Änderung(en) vorgemerkt` }) : null);
    const go = () => select(file, section, path, node);
    item.addEventListener('click', go);
    item.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    const kids = (node.children || []).map((c) => nodeItem(file, section, c, [...path, c.id]));
    return h('div', item, kids.length ? h('div.tree-children', kids) : null);
  }

  function select(file, section, blockPath, node) {
    let n = node || section;
    if (!node) for (const b of blockPath) n = n?.children.find((c) => c.id === b);
    selected = { file, sectionId: section.id, blockPath, node: n, section };
    renderTree();
    renderInspector();
    highlight(selected);
    updateContext();
  }

  function updateContext() {
    const page = data?.templates.find((t) => t.file === template)?.label || 'Startseite';
    clear(contextChip, selected ? `Bereich: ${selected.section.name}${selected.blockPath.length ? ' › ' + selected.node.name : ''} (${page})` : `Seite: ${page}`);
  }

  // ---------- Eigene Änderungen
  const editKey = (file, sid, path, setting) => `${file}|${sid}|${path.join('/')}|${setting}`;
  const edits = () => draft?.manual?.edits || {};
  function pendingFor(file, sid, path) {
    const prefix = `${file}|${sid}|${path.join('/')}|`;
    return Object.keys(edits()).filter((k) => k.startsWith(prefix)).length;
  }

  function renderPending() {
    const n = Object.keys(edits()).length;
    if (!n) return clear(pendingBar);
    const p = draft.proposal;
    clear(pendingBar, h('div.pending',
      h('span', h('strong', `${n} eigene Änderung${n === 1 ? '' : 'en'}`), ' vorgemerkt – im Shop noch nicht übernommen.'),
      p?.blocking?.length ? h('span.err', p.blocking[0]) : null,
      h('span.row',
        draft.preview?.themeId ? h('button.small.ghost', { type: 'button', onclick: () => switchTheme(String(draft.preview.themeId).replace(/\D/g, '')) }, 'Vorschau ansehen') : null,
        h('a.btn.small.primary', { href: `#/website/${draft.id}` }, 'Vorschau, Prüfen & Freigeben'))));
  }

  const timers = {};
  async function saveEdit(f, value, { remove = false, immediate = false } = {}) {
    const s = selected;
    const body = { file: s.file, sectionId: s.sectionId, blockPath: s.blockPath, setting: f.id, value, remove, label: `${data.templates.find((t) => t.file === s.file)?.label || (s.file.includes('header') ? 'Kopfbereich' : 'Fußbereich')} › ${s.section.name}${s.blockPath.length ? ' › ' + s.node.name : ''} › ${f.label}` };
    const key = editKey(s.file, s.sectionId, s.blockPath, f.id);
    clearTimeout(timers[key]);
    const run = async () => {
      try { draft = await post('/api/website/editor/edit', body); renderPending(); renderTree(); renderInspector(); } catch (err) { showError(err); }
    };
    if (immediate) await run(); else timers[key] = setTimeout(run, 700);
  }

  function renderInspector() {
    if (!selected) return clear(inspector, h('div.empty', 'Abschnitt in der Ansicht anklicken oder links auswählen.'));
    const n = selected.node;
    const fields = n.settings || [];
    clear(inspector,
      h('div.insp-head', h('div.eyebrow', selected.blockPath.length ? 'Block' : 'Abschnitt'), h('h3', n.name), h('small.muted', n.type)),
      n.unknownSchema ? h('div.inline-msg.info', 'Für diesen Bereich liefert das Theme keine Einstellungen. Änderungen am besten über Claude (oben) beschreiben.') : null,
      fields.length ? fields.map((f) => fieldEl(f)) : h('p.muted', 'Keine Einstellungen.'),
      h('div.inline-msg.info', { style: { marginTop: '14px' } }, 'Inhalte, Reihenfolge oder neue Abschnitte? Einfach oben beschreiben – Claude erstellt den Vorschlag.'));
  }

  function fieldEl(f) {
    if (f.infoOnly) return f.type === 'header' ? h('h4.insp-sub', f.label) : h('p.hint', f.label);
    const key = editKey(selected.file, selected.sectionId, selected.blockPath, f.id);
    const pending = edits()[key];
    const value = pending ? pending.value : f.value;
    const resetLink = pending ? h('button.linkish', { type: 'button', onclick: () => saveEdit(f, null, { remove: true, immediate: true }) }, 'Änderung verwerfen') : null;
    const wrap = (control, extra) => h(`label.field${pending ? '.changed' : ''}`, h('span', f.label, pending ? h('small.tag-changed', ' geändert') : null), control, extra || null, f.info ? h('div.hint', f.info) : null, TYPE_HINT[f.type] ? h('div.hint', TYPE_HINT[f.type]) : null, resetLink);
    if (!f.editable) return wrap(h('div.readonly', valueText(value)), h('div.hint', `Diese Einstellung (${f.type}) bitte über Claude oder im Shopify-Theme-Editor ändern.`));
    switch (f.type) {
      case 'text': case 'url': case 'video_url': {
        const inp = h('input', { type: 'text', value: value ?? '', placeholder: f.placeholder || '' });
        inp.addEventListener('input', () => saveEdit(f, inp.value));
        return wrap(inp);
      }
      case 'number': {
        const inp = h('input', { type: 'number', value: value ?? '' });
        inp.addEventListener('change', () => saveEdit(f, inp.value === '' ? null : Number(inp.value), { immediate: true }));
        return wrap(inp);
      }
      case 'textarea': case 'richtext': case 'inline_richtext': case 'html': {
        const ta = h('textarea', { rows: f.type === 'inline_richtext' ? 2 : 5 });
        ta.value = value ?? '';
        ta.addEventListener('input', () => saveEdit(f, ta.value));
        return wrap(ta);
      }
      case 'checkbox': {
        const cb = h('input', { type: 'checkbox', checked: Boolean(value) });
        cb.addEventListener('change', () => saveEdit(f, cb.checked, { immediate: true }));
        return h(`label.check${pending ? '.changed' : ''}`, cb, h('span', f.label, pending ? h('small.tag-changed', ' geändert') : null), resetLink);
      }
      case 'range': {
        const out = h('span.muted', `${value ?? ''}${f.unit || ''}`);
        const inp = h('input', { type: 'range', min: f.min ?? 0, max: f.max ?? 100, step: f.step ?? 1, value: value ?? f.min ?? 0 });
        inp.addEventListener('input', () => { out.textContent = `${inp.value}${f.unit || ''}`; saveEdit(f, Number(inp.value)); });
        return wrap(h('div.row', inp, out));
      }
      case 'select': case 'radio': case 'text_alignment': {
        const opts = f.options || (f.type === 'text_alignment' ? [{ value: 'left', label: 'Links' }, { value: 'center', label: 'Mitte' }, { value: 'right', label: 'Rechts' }] : []);
        const sel = h('select', opts.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
        sel.addEventListener('change', () => saveEdit(f, sel.value, { immediate: true }));
        return wrap(sel);
      }
      case 'color': case 'color_background': {
        const txt = h('input', { type: 'text', value: value ?? '', style: { flex: '1' } });
        const col = /^#[0-9a-f]{6}$/i.test(value || '') ? h('input', { type: 'color', value }) : null;
        col?.addEventListener('input', () => { txt.value = col.value; saveEdit(f, col.value); });
        txt.addEventListener('input', () => saveEdit(f, txt.value));
        return wrap(h('div.row', col, txt));
      }
      case 'image_picker': return imageField(f, value, wrap);
      default: return wrap(h('div.readonly', valueText(value)));
    }
  }

  function imageField(f, value, wrap) {
    const isNew = typeof value === 'string' && value.startsWith('__STUDIO_FILE_');
    const att = isNew ? draft?.attachments?.find((a) => value.includes(a.id)) : null;
    const shown = att ? h('img.insp-img', { src: `/files/website/${draft.id}/${att.id}${att.preview ? '?preview=1' : ''}`, alt: '' }) : h('div.readonly', value ? String(value).replace('shopify://shop_images/', 'Bild: ') : 'Kein Bild');
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', style: { display: 'none' } });
    const btn = h('button.small', { type: 'button', disabled: !data.canUploadImages }, value ? 'Bild ersetzen' : 'Bild wählen');
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', () => busy(btn, async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        if (!draft) draft = await post('/api/website/editor/draft');
        draft = await upload(`/api/upload?kind=website&draft=${draft.id}`, file);
        const a = draft.attachments[draft.attachments.length - 1];
        await saveEdit(f, `__STUDIO_FILE_${a.id}__`, { immediate: true });
        toast('Bild vorgemerkt. Es wird erst bei der Übernahme zu Shopify hochgeladen.', 'ok');
      } catch (err) { showError(err); }
    }));
    return wrap(h('div.stack', shown, h('div.row', btn, input)), data.canUploadImages ? null : h('div.hint', 'Bilder ersetzen braucht die Shopify-Admin-App (Einstellungen → Shopify → B), weil Shopify Bilder nur über „Dateien“ annimmt.'));
  }

  // ---------- Ansicht: live oder Vorschau-Theme
  function renderThemeSel() {
    const opts = [h('option', { value: '' }, 'Live-Shop (aktuell)')];
    if (draft?.preview?.themeId) opts.push(h('option', { value: String(draft.preview.themeId).replace(/\D/g, '') }, 'Vorschau mit meinen Änderungen'));
    if (themeView && !opts.some((o) => o.value === themeView)) opts.push(h('option', { value: themeView }, `Vorschau-Theme ${themeView}`));
    clear(themeSel, opts);
    themeSel.value = themeView || '';
  }
  async function switchTheme(v) {
    themeView = v || null;
    try { previewBase = (await get(`/api/website/editor/preview-url${themeView ? `?theme=${themeView}` : ''}`)).base; } catch (err) { return showError(err); }
    renderThemeSel();
    loadFrame(currentPath);
  }
  themeSel.addEventListener('change', () => switchTheme(themeSel.value));

  // ---------- Auftrag an Claude
  askBtn.addEventListener('click', () => busy(askBtn, async () => {
    const text = prompt.value.trim();
    if (!text) return showError(userError('Bitte zuerst beschreiben, was geändert werden soll.'));
    const where = selected ? `\n\nBetroffener Bereich (im Editor ausgewählt): Abschnitt „${selected.section.name}“ (id ${selected.sectionId}, Typ ${selected.section.type}) in ${selected.file}${selected.blockPath.length ? `, Block ${selected.blockPath.join(' › ')}` : ''}.` : '';
    try {
      const d = await post('/api/website/drafts', { title: text.slice(0, 60), areaKey: `theme:${selected?.file?.startsWith('templates/') ? selected.file : template}`, request: text + where });
      location.hash = `#/website/${d.id}?start=1`;
    } catch (err) { showError(err); }
  }));

  renderPending();
  renderThemeSel();
  if (themeView) await switchTheme(themeView); else loadFrame(data?.templates?.find((t) => t.file === template)?.path || '/');
  await loadStructure();
}

function valueText(v) {
  if (v === null || v === undefined || v === '') return '–';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Gleiche Zuordnung wie auf dem Server (services/themeEditor.js). */
function templateForPath(p) {
  const path = (p || '/').replace(/\/+$/, '') || '/';
  if (path === '/') return 'templates/index.json';
  if (/^\/products\//.test(path)) return 'templates/product.json';
  if (/^\/collections\/[^/]+$/.test(path)) return 'templates/collection.json';
  if (path === '/collections') return 'templates/list-collections.json';
  if (/^\/pages\//.test(path)) return 'templates/page.json';
  if (path === '/cart') return 'templates/cart.json';
  if (path === '/search') return 'templates/search.json';
  if (/^\/blogs\/[^/]+$/.test(path)) return 'templates/blog.json';
  if (/^\/blogs\/[^/]+\/[^/]+$/.test(path)) return 'templates/article.json';
  return 'templates/404.json';
}
