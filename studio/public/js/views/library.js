import { h, clear, get, post, put, del, upload, fmtDate, fmtBytes, showError, toast, modal, confirmDialog, busy, dropzone, shrinkImage, userError } from '../core.js';
import { state } from '../app.js';
import { newProductDialog } from './products.js';

/** Design hochladen: Datei wird in den Datenordner kopiert, Vorschaubild im Browser erzeugt. */
export async function importFiles(files, meta = {}) {
  const created = [];
  for (const f of files) {
    try {
      const r = await upload('/api/upload?kind=design', f, { 'X-Meta': encodeURIComponent(JSON.stringify(meta)) });
      let d = r.design;
      const thumb = await shrinkImage(f, 640, 'image/png');
      if (thumb) d = await upload(`/api/upload?kind=design-thumb&id=${d.id}`, new File([thumb], 'vorschau.png', { type: 'image/png' }));
      if (r.duplicateOf) toast(`Hinweis: „${f.name}“ ist identisch mit „${r.duplicateOf.name}“ (trotzdem importiert).`, 'info', 8000);
      else toast(`„${f.name}“ importiert (Kopie im Datenordner).`, 'ok');
      created.push(d);
    } catch (err) { showError(err); }
  }
  return created;
}

export async function renderLibrary(main, openId) {
  const tabs = h('div.tabs');
  const body = h('div');
  let tab = openId === 'vorlagen' ? 'templates' : 'designs';
  const draw = () => {
    clear(tabs,
      h(`button${tab === 'designs' ? '.on' : ''}`, { type: 'button', onclick: () => { tab = 'designs'; draw(); } }, 'Designs'),
      h(`button${tab === 'templates' ? '.on' : ''}`, { type: 'button', onclick: () => { tab = 'templates'; draw(); } }, 'Vorlagen'));
    if (tab === 'designs') renderDesigns(body, openId && openId !== 'vorlagen' ? openId : null); else renderTemplates(body);
  };
  clear(main,
    h('div.page-head', h('div', h('div.eyebrow', 'Archiv'), h('h1', 'Designbibliothek')),
      h('div.actions', h('button', { type: 'button', onclick: () => post('/api/reveal', { which: 'designs' }).catch(showError) }, 'Designordner öffnen'))),
    tabs, body);
  draw();
}

async function renderDesigns(box, openId) {
  const q = h('input', { type: 'search', placeholder: 'Nach Namen suchen …' });
  const motif = h('select', h('option', { value: '' }, 'Alle Motive'));
  const coll = h('select', h('option', { value: '' }, 'Alle Kollektionen'));
  const grid = h('div.grid.cards');
  let all = [];
  const load = async () => {
    all = await get('/api/designs');
    const motifs = [...new Set(all.map((d) => d.motif).filter(Boolean))].sort();
    const colls = [...new Set(all.map((d) => d.collection).filter(Boolean))].sort();
    const mv = motif.value; const cv = coll.value;
    clear(motif, h('option', { value: '' }, 'Alle Motive'), motifs.map((m) => h('option', { value: m, selected: m === mv }, m)));
    clear(coll, h('option', { value: '' }, 'Alle Kollektionen'), colls.map((m) => h('option', { value: m, selected: m === cv }, m)));
    draw();
  };
  const draw = () => {
    const needle = q.value.toLowerCase();
    const list = all.filter((d) => (!needle || `${d.name} ${d.originalName}`.toLowerCase().includes(needle)) && (!motif.value || d.motif === motif.value) && (!coll.value || d.collection === coll.value));
    clear(grid, list.length ? list.map((d) => designCard(d, () => openDesign(d.id, load))) : h('div.empty', all.length ? 'Keine Treffer.' : 'Noch keine Designs. Dateien oben hineinziehen.'));
  };
  [q, motif, coll].forEach((el) => el.addEventListener('input', draw));
  clear(box,
    dropzone({ accept: 'image/png,image/jpeg,image/svg+xml,image/webp', label: 'Designs hierher ziehen oder klicken (PNG empfohlen). Die Originale bleiben unverändert an ihrem Ort – es wird eine Kopie gespeichert.', onFiles: async (files) => { await importFiles(files); await load(); } }),
    h('div.row', { style: { margin: '16px 0' } }, h('div', { style: { flex: '2 1 240px' } }, q), h('div', { style: { flex: '1 1 160px' } }, motif), h('div', { style: { flex: '1 1 160px' } }, coll)),
    grid);
  await load();
  if (openId) openDesign(openId, load);
}

function designCard(d, onOpen) {
  const card = h('div.card.click',
    h('div.thumb', h('img', { src: `/files/design/${d.id}/thumb`, alt: '', loading: 'lazy' })),
    h('h3', d.name),
    h('div.muted', [d.motif, d.collection].filter(Boolean).join(' · ') || d.originalName),
    h('div.row.between', { style: { marginTop: '6px' } },
      h('small', { style: { color: d.marketprint?.imageId ? 'var(--ok)' : 'var(--warn)' } }, d.marketprint?.imageId ? 'MarketPrint verknüpft' : 'nicht verknüpft'),
      h('small.muted', `${d.usedIn?.length || 0} Produkt(e)`)));
  card.addEventListener('click', onOpen);
  return card;
}

async function openDesign(id, onChange) {
  const all = await get('/api/designs');
  let d = all.find((x) => x.id === id);
  if (!d) return showError(userError('Design nicht gefunden.'));
  const a = d.analysis || {};
  const name = h('input', { type: 'text', value: d.name });
  const motif = h('input', { type: 'text', value: d.motif, placeholder: 'z. B. Theotokos, Christus Pantokrator, Kreuz' });
  const coll = h('input', { type: 'text', value: d.collection, placeholder: 'z. B. Drop 01 · Light in the Dark' });
  const mpBox = h('div');
  const mode = state.boot?.settings?.marketprint?.mode;

  const drawMp = () => {
    const results = h('div.grid.cards');
    const searchInput = h('input', { type: 'search', value: d.originalName.replace(/\.[^.]+$/, ''), placeholder: 'Dateiname in MarketPrint' });
    const searchBtn = h('button', { type: 'button' }, 'In MarketPrint suchen');
    searchBtn.addEventListener('click', () => busy(searchBtn, async () => {
      try {
        const r = await get(`/api/marketprint/images?q=${encodeURIComponent(searchInput.value)}`);
        const imgs = r.images || r.items || [];
        clear(results, imgs.length ? imgs.map((im) => {
          const imageId = im.imageId || im.id;
          return h('div.card', h('div.thumb', im.previewUrl || im.preview || im.url ? h('img', { src: im.previewUrl || im.preview || im.url, alt: '' }) : null), h('small', im.fileName || im.name || imageId),
            h('button.small.primary', { type: 'button', onclick: async () => { d = await post(`/api/designs/${d.id}/link-marketprint`, { imageId, fileName: im.fileName || im.name, previewUrl: im.previewUrl || im.preview }); toast('Verknüpft.', 'ok'); drawMp(); onChange?.(); } }, 'Verknüpfen'));
        }) : h('div.empty', r.simulated ? 'Simulation: keine MarketPrint-Designs vorhanden. Nutze „Direkt hochladen“.' : 'Keine Treffer. Ist die Datei in MarketPrint unter „Meine Designs“ hochgeladen?'));
      } catch (err) { showError(err); }
    }));
    const manual = h('input', { type: 'text', placeholder: 'MarketPrint-Bild-ID' });
    const canDirect = mode === 'mcp' || mode === 'simulation' || (a.bytes || 0) < 100_000;
    const direct = h('button', { type: 'button', disabled: !canDirect }, 'Direkt zu MarketPrint hochladen');
    direct.addEventListener('click', () => busy(direct, async () => { try { d = await post(`/api/designs/${d.id}/upload-marketprint`); toast('Hochgeladen und verknüpft.', 'ok'); drawMp(); onChange?.(); } catch (err) { showError(err); } }));
    clear(mpBox,
      d.marketprint?.imageId ? h('div.inline-msg.ok', `Verknüpft mit MarketPrint-Bild ${d.marketprint.imageId}${d.marketprint.fileName ? ' (' + d.marketprint.fileName + ')' : ''} · ${fmtDate(d.marketprint.linkedAt)}`) : h('div.inline-msg.warn', 'Noch nicht mit MarketPrint verknüpft. Für die Produkterstellung braucht MarketPrint die Datei in deinem Konto.'),
      h('ol.muted', h('li', `Lade „${d.originalName}“ in der MarketPrint-App unter „Meine Designs“ hoch. Das ist bei großen Druckdateien der zuverlässigste Weg.`), h('li', 'Suche sie hier und klicke auf „Verknüpfen“.')),
      h('div.row', h('div', { style: { flex: '1 1 220px' } }, searchInput), searchBtn),
      results,
      h('details.box', h('summary', 'Weitere Möglichkeiten'), h('div.stack',
        h('div.row', h('div', { style: { flex: '1 1 220px' } }, manual), h('button', { type: 'button', onclick: async () => { if (!manual.value.trim()) return; d = await post(`/api/designs/${d.id}/link-marketprint`, { imageId: manual.value.trim() }).catch((e) => { showError(e); return d; }); drawMp(); onChange?.(); } }, 'ID verknüpfen')),
        h('div.row', direct, canDirect ? null : h('small.muted', 'Über Claude Code nur für Dateien unter 100 KB möglich.')))));
  };
  drawMp();

  const notes = [
    `${a.format || '?'} · ${a.width && a.height ? `${a.width} × ${a.height} px` : 'Maße unbekannt'} · ${fmtBytes(a.bytes)}`,
    a.format === 'PNG' ? (a.hasAlpha ? `Transparenz: ja (${Math.round((a.transparentRatio || 0) * 100)} % transparent)` : a.hasAlphaChannel ? 'Alphakanal ohne transparente Pixel' : 'Keine Transparenz') : null,
    a.dpi ? `In der Datei hinterlegte Auflösung: ${a.dpi} dpi (für den Druck zählen die Pixel)` : null,
  ].filter(Boolean);

  await modal({
    eyebrow: 'Design', title: d.name, wide: true,
    body: h('div.grid.cols-2',
      h('div.stack',
        h('div.preview-box', { style: { background: 'repeating-conic-gradient(#2a2620 0% 25%, #1f1c18 0% 50%) 50% / 20px 20px' } }, h('img.garment', { src: `/files/design/${d.id}/thumb`, alt: d.name })),
        h('div', notes.map((n) => h('div.muted', n))),
        h('div.row',
          h('button', { type: 'button', onclick: () => post(`/api/designs/${d.id}/open`).catch(showError) }, 'Original öffnen'),
          h('button', { type: 'button', onclick: () => post(`/api/designs/${d.id}/reveal`).catch(showError) }, 'Im Ordner zeigen'))),
      h('div',
        h('label.field', h('span', 'Name'), name),
        h('label.field', h('span', 'Motiv'), motif),
        h('label.field', h('span', 'Kollektion'), coll),
        h('div.field-label', 'Verwendet in'), d.usedIn?.length ? h('ul', d.usedIn.map((u) => h('li', h('a', { href: `#/produkte/${u.id}`, onclick: () => document.querySelectorAll('.overlay').forEach((o) => o.remove()) }, u.name), ' · ', u.status))) : h('p.muted', 'Noch in keinem Produkt.'),
        h('h4', 'MarketPrint'), mpBox)),
    actions: [
      { label: 'Löschen', danger: true, onClick: async () => { if (!(await confirmDialog({ title: 'Design aus der Bibliothek entfernen?', text: 'Die Kopie im Datenordner wird gelöscht. Deine ursprüngliche Datei an ihrem alten Ort bleibt unberührt.', danger: true, confirmLabel: 'Entfernen' }))) return false; await del(`/api/designs/${d.id}?confirm=1`); onChange?.(); return true; } },
      { label: 'Neues Produkt mit diesem Design', onClick: async () => { await save(); setTimeout(() => newProductDialog(null, null, d.id), 50); return true; } },
      { label: 'Speichern', primary: true, onClick: async () => { await save(); toast('Gespeichert.', 'ok'); return true; } },
    ],
  });
  async function save() {
    await put(`/api/designs/${d.id}`, { name: name.value.trim() || d.name, motif: motif.value.trim(), collection: coll.value.trim() });
    onChange?.();
  }
}

/** Auswahl eines Designs (für Produkt-Druckflächen). Rückgabe: Design-ID oder null. */
export async function pickDesign() {
  let all = await get('/api/designs');
  const grid = h('div.grid.cards', { style: { maxHeight: '60vh', overflow: 'auto' } });
  const q = h('input', { type: 'search', placeholder: 'Suchen …' });
  let resolveFn;
  let closeModal = () => {};
  const done = new Promise((r) => { resolveFn = r; });
  const draw = () => {
    const needle = q.value.toLowerCase();
    clear(grid, all.filter((d) => !needle || `${d.name} ${d.motif} ${d.collection}`.toLowerCase().includes(needle)).map((d) => {
      const c = designCard(d, () => { resolveFn(d.id); closeModal(); });
      return c;
    }));
    if (!all.length) grid.append(h('div.empty', 'Noch keine Designs – unten hochladen.'));
  };
  q.addEventListener('input', draw);
  draw();
  modal({
    title: 'Motiv wählen', wide: true,
    body: h('div.stack', q, grid, dropzone({ accept: 'image/png,image/jpeg,image/svg+xml,image/webp', multiple: false, label: 'Neues Design hochladen', onFiles: async (files) => { const c = await importFiles(files); all = await get('/api/designs'); draw(); if (c[0]) { resolveFn(c[0].id); closeModal(); } } })),
    actions: [{ label: 'Abbrechen', value: null }],
    onClose: () => resolveFn(null),
    onReady: (close) => { closeModal = close; },
  });
  return done;
}

async function renderTemplates(box) {
  const list = await get('/api/templates');
  clear(box,
    h('p.muted', 'Vorlagen speichern Produkteinstellungen und Standardtexte. Du legst sie in einem Produktentwurf über „Als Vorlage speichern“ an.'),
    list.length ? h('div.table-wrap', h('table.list', h('thead', h('tr', h('th', 'Name'), h('th', 'Grundprodukt'), h('th', 'Preis'), h('th', ''))),
      h('tbody', list.map((t) => h('tr',
        h('td', t.name, h('div.muted', fmtDate(t.updatedAt))),
        h('td', t.data?.baseProduct?.title || '–'),
        h('td', t.data?.price ? `${Number(t.data.price).toFixed(2)} €` : '–'),
        h('td', h('div.row',
          h('button.small.primary', { type: 'button', onclick: async () => { const p = await post('/api/products', { fromTemplate: t.id }).catch(showError); if (p) location.hash = `#/produkte/${p.id}`; } }, 'Produkt aus Vorlage'),
          h('button.small', { type: 'button', onclick: async () => { const n = prompt('Neuer Name', t.name); if (n) { await put(`/api/templates/${t.id}`, { name: n }).catch(showError); renderTemplates(box); } } }, 'Umbenennen'),
          h('button.small.danger', { type: 'button', onclick: async () => { if (await confirmDialog({ title: 'Vorlage löschen?', text: t.name, danger: true, confirmLabel: 'Löschen' })) { await del(`/api/templates/${t.id}?confirm=1`).catch(showError); renderTemplates(box); } } }, 'Löschen'))))))))
      : h('div.empty', 'Noch keine Vorlagen.'));
}
