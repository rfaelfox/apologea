import { h, clear, get, post, put, del, badge, fmtDate, fmtEuro, fmtUsd, showError, toast, modal, confirmDialog, autosaver, busy, extLink, ornament, userError } from '../core.js';
import { confirmAiCall, issuesList, fileNotes, htmlPreview } from './shared.js';
import { pickDesign } from './library.js';
import { setCleanup, state } from '../app.js';

const NAMED = [
  { v: 'small-left-chest', l: 'Klein, linke Brust' },
  { v: 'small-center-chest', l: 'Klein, Brustmitte' },
  { v: 'small-right-chest', l: 'Klein, rechte Brust' },
];
const AREA_LABEL = { front: 'Vorderseite', back: 'Rückseite' };
const STYLE_LABEL = { kurz: 'Kurz', schlicht: 'Schlicht', ausfuehrlich: 'Ausführlich & markengerecht' };

// ------------------------------------------------------------------ Liste

export async function renderProductList(main, query = {}) {
  const [items, templates] = await Promise.all([get('/api/products'), get('/api/templates')]);
  const grid = h('div.grid.cards');
  for (const p of items) {
    const card = h('div.card.click',
      h('div.thumb', cardImage(p)),
      h('h3', p.internalName || p.publicTitle || 'Unbenannter Entwurf'),
      h('div.muted', p.publicTitle && p.internalName ? p.publicTitle : ''),
      h('div.row.between', { style: { marginTop: '8px' } }, badge(p.status, { simulated: p.publish?.result?.simulated }), h('small.muted', fmtDate(p.updatedAt))));
    card.addEventListener('click', () => { location.hash = `#/produkte/${p.id}`; });
    grid.append(card);
  }
  clear(main,
    h('div.page-head', h('div', h('div.eyebrow', 'MarketPrint'), h('h1', 'Produkte')),
      h('div.actions', h('button.primary', { type: 'button', onclick: () => newProductDialog(items, templates) }, '+ Neues Produkt'))),
    items.length ? grid : h('div.empty', 'Noch keine Produktentwürfe.'));
  if (query.neu) newProductDialog(items, templates);
}

function cardImage(p) {
  const designId = (p.placements || []).find((x) => x.designId)?.designId;
  if (designId) return h('img', { src: `/files/design/${designId}/thumb`, alt: '', loading: 'lazy' });
  if (p.baseProduct?.image) return h('img', { src: p.baseProduct.image, alt: '', loading: 'lazy' });
  return h('span.muted', 'Kein Grundprodukt');
}

export async function newProductDialog(items, templates, presetDesignId) {
  items ||= await get('/api/products');
  templates ||= await get('/api/templates');
  let closeModal = () => {};
  const make = async (body) => {
    const p = await post('/api/products', body);
    closeModal(true);
    if (presetDesignId) await put(`/api/products/${p.id}`, { placements: [{ printArea: 'front', designId: presetDesignId, placement: { mode: 'auto' } }] });
    location.hash = `#/produkte/${p.id}`;
  };
  await modal({
    eyebrow: 'Neues Produkt', title: 'Wie möchtest du beginnen?', wide: true,
    body: h('div.grid.cols-3',
      h('div.card.stack', h('h3', 'Leerer Entwurf'), h('p.muted', 'Alle Angaben selbst festlegen.'), h('button.primary', { type: 'button', onclick: () => make({}).catch(showError) }, 'Leer beginnen')),
      h('div.card.stack', h('h3', 'Aus Vorlage'), templates.length ? templates.map((t) => h('button', { type: 'button', style: { width: '100%' }, onclick: () => make({ fromTemplate: t.id }).catch(showError) }, t.name)) : h('p.muted', 'Noch keine Vorlagen. In einem Entwurf: „Als Vorlage speichern“.')),
      h('div.card.stack', h('h3', 'Aus vorhandenem Produkt'), items.length ? h('div', { style: { maxHeight: '260px', overflow: 'auto' } }, items.slice(0, 30).map((p) => h('button.small', { type: 'button', style: { width: '100%', marginBottom: '4px', textTransform: 'none', letterSpacing: 0 }, onclick: () => make({ fromProduct: p.id }).catch(showError) }, p.internalName || p.publicTitle || p.id))) : h('p.muted', 'Noch keine Produkte.'))),
    actions: [{ label: 'Schließen', value: false }],
    onReady: (close) => { closeModal = close; },
  });
}

// ------------------------------------------------------------------ Editor

export async function renderProductEditor(main, id) {
  let draft = await get(`/api/products/${id}`);
  let details = null;
  let account = null;
  let designs = await get('/api/designs');
  let lastValidation = draft.validation;
  const saved = h('span.saved', 'Gespeichert');
  const saver = autosaver((patch) => put(`/api/products/${id}`, patch).then((d) => { draft = d; renderStatus(); }), saved);
  setCleanup(() => saver.flush());
  const locked = () => ['running', 'unknown', 'done', 'failed'].includes(draft.publish?.state);
  const set = (patch) => { Object.assign(draft, patch); if (!locked()) saver.schedule(patch); };

  const statusBox = h('span');
  const statusBox2 = h('span');
  const simBanner = h('div');
  const sec = {
    base: h('div'), variants: h('div'), print: h('div'), texts: h('div'), price: h('div'), check: h('div'), result: h('div'),
  };

  function renderStatus() { for (const b of [statusBox, statusBox2]) clear(b, badge(draft.status, { simulated: draft.publish?.result?.simulated })); }

  async function loadDetails(refresh = false) {
    if (!draft.baseProduct?.id) { details = null; return; }
    try { details = await get(`/api/marketprint/products/${draft.baseProduct.id}${refresh ? '?refresh=1' : ''}`); } catch (err) { details = null; showError(err); }
  }

  // ---------- 1 Grundprodukt
  async function renderBase() {
    if (draft.baseProduct && details) {
      clear(sec.base, h('div.grid.cols-2',
        h('div.preview-box', h('img.garment', { src: draft.baseProduct.image, alt: draft.baseProduct.title })),
        h('div.stack',
          h('h3', draft.baseProduct.title),
          h('dl.kv',
            h('dt', 'Druckflächen'), h('dd', details.printAreas.map((a) => `${AREA_LABEL[a.name] || a.name}: ${a.width} × ${a.height} px`).join(' · ')),
            h('dt', 'Druckverfahren'), h('dd', (details.supportedPrinterTypes || []).map((t) => t.toUpperCase()).join(', ') || '–'),
            h('dt', 'Nackendruck'), h('dd', details.hasNeckPrint ? 'unterstützt (in dieser Version nicht über APOLOGEA Studio)' : 'nein'),
            h('dt', 'Alternativ-Motiv je Farbe'), h('dd', details.hasAlternativeDesign ? 'unterstützt' : 'nein'),
            h('dt', 'Daten abgerufen'), h('dd', fmtDate(details.cachedAt), ' ', h('button.small.ghost', { type: 'button', onclick: async () => { await loadDetails(true); renderAll(); } }, 'Aktualisieren'))),
          h('details.box', h('summary', 'Produktangaben laut MarketPrint (Originaltext)'), h('div', htmlPreview(details.description))),
          locked() ? null : h('button.small', { type: 'button', onclick: () => { if (!draft.variantIds.length || window.confirm('Grundprodukt ändern? Varianten und Druckflächen werden zurückgesetzt.')) { set({ baseProduct: null, variantIds: [], placements: [], printerType: '' }); details = null; renderAll(); } } }, 'Anderes Grundprodukt wählen'))));
      return;
    }
    const search = h('input', { type: 'search', placeholder: 'Suchen, z. B. Shirt, Hoodie …' });
    const grid = h('div.catalog', h('span.muted', 'Katalog wird von MarketPrint geladen …'));
    clear(sec.base, h('div.row', { style: { marginBottom: '12px' } }, search), grid);
    let catalog;
    try { catalog = await get('/api/marketprint/catalog'); } catch (err) { clear(grid, h('div.inline-msg.error', err.message, ' – ', h('a', { href: '#/einstellungen' }, 'MarketPrint einrichten'))); return; }
    const draw = () => {
      const q = search.value.toLowerCase();
      clear(grid, catalog.items.filter((c) => !q || c.title.toLowerCase().includes(q)).map((c) => {
        const it = h('div.item', { tabindex: 0, role: 'button' }, h('img', { src: c.image, alt: '', loading: 'lazy' }), h('div.t', c.title));
        const choose = async () => {
          set({ baseProduct: { id: c.id, title: c.title, image: c.image, hasNeckPrint: c.hasNeckPrint, hasAlternativeDesign: c.hasAlternativeDesign }, variantIds: [], placements: [], printerType: '' });
          await saver.flush();
          await loadDetails();
          if (details?.supportedPrinterTypes?.length === 1) set({ printerType: details.supportedPrinterTypes[0] });
          renderAll();
        };
        it.addEventListener('click', choose);
        it.addEventListener('keydown', (e) => { if (e.key === 'Enter') choose(); });
        return it;
      }));
    };
    search.addEventListener('input', draw);
    draw();
    if (catalog.stale) grid.before(h('div.inline-msg.warn', 'Gespeicherter Katalog (MarketPrint gerade nicht erreichbar): ' + catalog.error));
  }

  // ---------- 2 Varianten
  function renderVariants() {
    if (!details) { clear(sec.variants, h('p.muted', 'Zuerst ein Grundprodukt wählen.')); return; }
    const colors = [];
    const sizes = [];
    for (const v of details.variants) {
      if (!colors.find((c) => c.name === v.color)) colors.push({ name: v.color, hex: v.colorHex });
      if (!sizes.includes(v.size)) sizes.push(v.size);
    }
    const sel = new Set(draft.variantIds);
    const selVariants = details.variants.filter((v) => sel.has(v.id));
    const selColors = new Set(selVariants.map((v) => v.color));
    const selSizes = new Set(selVariants.map((v) => v.size));
    const apply = (cs, ss) => {
      const ids = details.variants.filter((v) => cs.has(v.color) && ss.has(v.size) && v.available !== false).map((v) => v.id);
      set({ variantIds: ids });
      renderVariants(); renderPrint(); renderPrice();
    };
    const dis = locked();
    clear(sec.variants,
      h('div.field-label', 'Farben'),
      h('div.swatches', colors.map((c) => h(`button.swatch${selColors.has(c.name) ? '.on' : ''}`, { type: 'button', disabled: dis, onclick: () => { const cs = new Set(selColors); cs.has(c.name) ? cs.delete(c.name) : cs.add(c.name); apply(cs, selSizes.size ? selSizes : new Set(sizes)); } }, h('span.c', { style: { background: c.hex } }), c.name))),
      h('div.field-label', { style: { marginTop: '16px' } }, 'Größen'),
      h('div.sizes', sizes.map((s) => h(`button.size${selSizes.has(s) ? '.on' : ''}`, { type: 'button', disabled: dis, onclick: () => { const ss = new Set(selSizes); ss.has(s) ? ss.delete(s) : ss.add(s); apply(selColors, ss); } }, s)),
        h('button.small.ghost', { type: 'button', disabled: dis, onclick: () => apply(selColors, new Set(sizes)) }, 'Alle Größen')),
      h('div', { style: { marginTop: '16px' } },
        selVariants.length ? h('div.table-wrap', h('table.list', h('thead', h('tr', h('th', 'Farbe'), h('th', 'Größen'), h('th', 'Katalogpreis laut MarketPrint'))),
          h('tbody', [...selColors].map((c) => {
            const vs = selVariants.filter((v) => v.color === c);
            const prices = [...new Set(vs.map((v) => v.price))];
            return h('tr', h('td', c), h('td', vs.map((v) => v.size).join(', ')), h('td', prices.map(fmtEuro).join(' / ')));
          })))) : h('div.inline-msg.warn', 'Noch keine Variante gewählt.'),
        h('p.hint', `${selVariants.length} Varianten ausgewählt. Nicht verfügbare Varianten werden automatisch ausgelassen.`)));
  }

  // ---------- 3 Druck & Motive
  function renderPrint() {
    if (!details) { clear(sec.print, h('p.muted', 'Zuerst ein Grundprodukt wählen.')); return; }
    const dis = locked();
    const types = details.supportedPrinterTypes || [];
    const parts = [];
    if (types.length > 1) {
      parts.push(h('label.field', h('span', 'Druckverfahren'),
        h('select', { disabled: dis, onchange: (e) => { set({ printerType: e.target.value }); renderPrint(); } }, h('option', { value: '' }, 'Bitte wählen …'), types.map((t) => h('option', { value: t, selected: draft.printerType === t }, t.toUpperCase()))),
        h('div.hint', 'Laut MarketPrint werden für DTF Aufschläge berechnet.')));
    }
    if (details.hasNeckPrint) parts.push(h('div.inline-msg.info', 'Nackendruck wird von MarketPrint für dieses Produkt unterstützt, in dieser Programmversion aber nicht eingerichtet. Bei Bedarf in der MarketPrint-App ergänzen.'));
    const selVariants = details.variants.filter((v) => draft.variantIds.includes(v.id));
    const firstColor = selVariants[0] || details.variants[0];
    for (const area of details.printAreas) {
      let pl = draft.placements.find((p) => p.printArea === area.name);
      const ensure = () => { if (!pl) { pl = { printArea: area.name, designId: null, placement: { mode: 'auto' }, alternative: null }; draft.placements = [...draft.placements, pl]; } return pl; };
      const savePl = () => set({ placements: draft.placements.map((p) => (p.printArea === area.name ? pl : p)) });
      const design = pl?.designId ? designs.find((d) => d.id === pl.designId) : null;
      const notesBox = h('div');
      const canvas = h('canvas.schema', { width: 420, height: Math.round(420 * area.height / area.width) });
      const garmentImg = (firstColor?.images || []).find((i) => i.printArea === area.name)?.image;
      const refresh = async () => {
        drawSchema(canvas, area, pl, design);
        if (design) {
          try {
            const notes = await post(`/api/designs/${design.id}/check`, { printArea: area, placement: placementArg(pl), printerType: draft.printerType || types[0] });
            clear(notesBox, fileNotes(notes));
          } catch (err) { clear(notesBox, h('div.inline-msg.error', err.message)); }
        } else clear(notesBox);
      };
      const mode = pl?.placement?.mode || 'auto';
      const slider = (key, label, min, max) => {
        const val = pl?.placement?.[key] ?? (key === 'widthPercent' ? 0.6 : 0.5);
        const out = h('span.muted', `${Math.round(val * 100)} %`);
        const inp = h('input', { type: 'range', min, max, step: 0.01, value: val, disabled: dis, oninput: () => { ensure(); pl.placement = { ...pl.placement, mode: 'custom', [key]: Number(inp.value) }; out.textContent = `${Math.round(inp.value * 100)} %`; drawSchema(canvas, area, pl, design); savePl(); }, onchange: refresh });
        return h('label.field', h('span', label, ' ', out), inp);
      };
      const altBox = h('div');
      if (details.hasAlternativeDesign && pl?.designId) {
        const alt = pl.alternative?.designId ? designs.find((d) => d.id === pl.alternative.designId) : null;
        const colorHexes = [...new Map(selVariants.map((v) => [v.colorHex, v.color])).entries()];
        clear(altBox, h('details.box', { open: Boolean(alt) }, h('summary', 'Alternativ-Motiv für bestimmte Farben (z. B. helle Version für dunkle Shirts)'),
          h('div.stack',
            h('div.row', alt ? h('span', alt.name) : h('span.muted', 'Kein Alternativ-Motiv'),
              h('button.small', { type: 'button', disabled: dis, onclick: async () => { const dId = await pickDesign(designs); if (!dId) return; ensure(); pl.alternative = { designId: dId, colors: pl.alternative?.colors || [] }; savePl(); designs = await get('/api/designs'); renderPrint(); } }, alt ? 'Ändern' : 'Wählen'),
              alt ? h('button.small.ghost', { type: 'button', disabled: dis, onclick: () => { pl.alternative = null; savePl(); renderPrint(); } }, 'Entfernen') : null),
            alt ? h('div', colorHexes.map(([hex, name]) => h('label.check', h('input', { type: 'checkbox', checked: pl.alternative.colors.includes(hex), disabled: dis, onchange: (e) => { const s = new Set(pl.alternative.colors); e.target.checked ? s.add(hex) : s.delete(hex); pl.alternative = { ...pl.alternative, colors: [...s] }; savePl(); } }), h('span', name)))) : null,
            h('p.hint', 'MarketPrint verwendet dabei Position und Größe des Hauptmotivs; die Datei sollte gleiche Pixelmaße haben.'))));
      }
      parts.push(h('div.frame', { style: { marginBottom: '16px' } },
        h('div.row.between', h('h3', { style: { margin: 0 } }, `${AREA_LABEL[area.name] || area.name}`), h('small.muted', `Druckfläche ${area.width} × ${area.height} px`)),
        h('div.placement', { style: { marginTop: '12px' } },
          h('div.stack',
            h('div.row',
              design ? h('img', { src: `/files/design/${design.id}/thumb`, alt: '', style: { width: '64px', height: '64px', objectFit: 'contain', background: '#fff1' } }) : null,
              h('div', design ? h('div', h('strong', design.name), h('div.muted', design.marketprint?.imageId ? `MarketPrint verknüpft (${design.marketprint.imageId})` : 'Noch nicht mit MarketPrint verknüpft')) : h('span.muted', 'Kein Motiv auf dieser Fläche')),
              h('button.small', { type: 'button', disabled: dis, onclick: async () => { const dId = await pickDesign(designs); if (!dId) return; ensure(); pl.designId = dId; savePl(); designs = await get('/api/designs'); renderPrint(); } }, design ? 'Motiv ändern' : 'Motiv wählen'),
              design ? h('button.small.ghost', { type: 'button', disabled: dis, onclick: () => { draft.placements = draft.placements.filter((p) => p.printArea !== area.name); set({ placements: draft.placements }); renderPrint(); } }, 'Fläche leeren') : null,
              design && !design.marketprint?.imageId ? h('a', { href: `#/bibliothek/${design.id}` }, 'Jetzt verknüpfen') : null),
            design ? h('div',
              h('div.field-label', 'Platzierung'),
              h('div.row',
                ['auto', 'named', 'custom'].map((m) => h('label.check', h('input', { type: 'radio', name: `mode-${area.name}`, checked: mode === m, disabled: dis, onchange: () => { ensure(); pl.placement = m === 'named' ? { mode: 'named', named: pl.placement?.named || 'small-left-chest' } : m === 'custom' ? { mode: 'custom', xPercent: 0.5, yPercent: 0.35, widthPercent: 0.6 } : { mode: 'auto' }; savePl(); renderPrint(); } }), h('span', { auto: 'Automatisch einpassen', named: 'Kleines Logo', custom: 'Frei positionieren' }[m])))),
              mode === 'named' ? h('select', { disabled: dis, onchange: (e) => { pl.placement = { mode: 'named', named: e.target.value }; savePl(); refresh(); } }, NAMED.map((n) => h('option', { value: n.v, selected: pl.placement.named === n.v }, n.l))) : null,
              mode === 'custom' ? h('div', slider('xPercent', 'Horizontal (Mitte)', 0, 1), slider('yPercent', 'Vertikal (Mitte)', 0, 1), slider('widthPercent', 'Breite', 0.05, 1)) : null,
              mode === 'auto' ? h('p.hint', 'Das Motiv wird so groß wie möglich eingepasst und zentriert, wie bei einem vollflächigen Druck.') : null) : null,
            altBox,
            h('div', h('div.field-label', 'Prüfung der Druckdatei'), notesBox)),
          h('div.grid', { style: { gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px', alignContent: 'start' } },
            h('div', h('div.preview-box', h('span.preview-label', 'Schematisch – nicht verbindlich'), canvas), h('p.hint', 'Druckfläche (gestrichelt) mit Motiv. Annahme: Position bezieht sich auf die Motivmitte.')),
            garmentImg ? h('div', h('div.preview-box', h('span.preview-label', 'MarketPrint-Produktfoto'), h('img.garment', { src: garmentImg, alt: '' })), h('p.hint', `Leeres Produkt (${firstColor.color}). Echte Mockups mit Motiv erzeugt MarketPrint beim Anlegen.`)) : null))));
      refresh();
    }
    clear(sec.print, parts);
  }

  // ---------- 4 Texte
  function renderTexts() {
    const dis = locked();
    const internal = h('input', { type: 'text', value: draft.internalName, disabled: dis, oninput: () => set({ internalName: internal.value }) });
    const title = h('input', { type: 'text', value: draft.publicTitle, disabled: dis, oninput: () => set({ publicTitle: title.value }) });
    const notes = h('textarea', { disabled: dis, placeholder: 'Motivgeschichte, Bedeutung, gewünschte Bibelstelle (mit Wortlaut und Übersetzung), Hinweise für die Beschreibung …', oninput: () => set({ notes: notes.value }) });
    notes.value = draft.notes || '';
    const desc = h('textarea', { disabled: dis, style: { minHeight: '200px', fontFamily: 'Consolas, monospace', fontSize: '13px' }, oninput: () => { set({ description: desc.value }); prev.replaceWith(prev = htmlPreview(desc.value)); } });
    desc.value = draft.description || '';
    let prev = htmlPreview(draft.description);
    const style = h('div.row', Object.entries(STYLE_LABEL).map(([k, l]) => h('label.check', h('input', { type: 'radio', name: 'style', checked: draft.descriptionStyle === k, disabled: dis, onchange: () => set({ descriptionStyle: k }) }), h('span', l))));
    const genBtn = h('button', { type: 'button', disabled: dis }, 'Beschreibung mit Claude erstellen');
    genBtn.addEventListener('click', () => busy(genBtn, async () => {
      await saver.flush();
      const c = await confirmAiCall(`/api/products/${id}/describe/estimate`, { style: draft.descriptionStyle }, 'die Produktbeschreibung');
      if (!c) return;
      try {
        const r = await post(`/api/products/${id}/describe`, { style: draft.descriptionStyle, confirmPaid: c.confirmPaid });
        const take = await modal({
          eyebrow: `Vorschlag von Claude${r.costUsd != null ? ' · Kosten ' + fmtUsd(r.costUsd) : ''}`, title: 'Produkttext', wide: true,
          body: h('div.stack', h('div.field-label', 'Titel-Vorschlag'), h('p', r.title_suggestion), h('div.field-label', 'Beschreibung'), htmlPreview(r.description_html),
            r.notes_for_review?.length ? h('div', h('h4', 'Bitte prüfen'), r.notes_for_review.map((n) => h('div.inline-msg.warn', n))) : null),
          actions: [{ label: 'Verwerfen', value: null }, { label: 'Nur Titel übernehmen', value: 'title' }, { label: 'Beschreibung übernehmen', value: 'desc' }, { label: 'Beides übernehmen', value: 'both', primary: true }],
        });
        if (take === 'title' || take === 'both') { title.value = r.title_suggestion; set({ publicTitle: r.title_suggestion }); }
        if (take === 'desc' || take === 'both') { desc.value = r.description_html; set({ description: r.description_html, descriptionSource: 'claude' }); prev.replaceWith(prev = htmlPreview(desc.value)); }
      } catch (err) { showError(err); }
    }));
    clear(sec.texts, h('div.grid.cols-2',
      h('div',
        h('label.field', h('span', 'Interner Motivname'), internal, h('div.hint', 'Nur für dich, z. B. „Theotokos Gold 01“.')),
        h('label.field', h('span', 'Öffentlicher Produktname'), title),
        h('label.field', h('span', 'Notizen & Motivgeschichte (für Claude)'), notes),
        h('div.field-label', 'Textstil'), style,
        h('div', { style: { marginTop: '12px' } }, genBtn),
        h('p.hint', 'Claude übernimmt Produktdaten ausschließlich aus dem MarketPrint-Text und erfindet nichts hinzu. Das Ergebnis siehst du vor der Übernahme.')),
      h('div',
        h('label.field', h('span', 'Produktbeschreibung (HTML)'), desc, h('div.hint', 'Leer lassen = MarketPrint-Standardtext wird verwendet.')),
        h('div.field-label', 'Vorschau'), prev)));
  }

  // ---------- 5 Preis & Shop
  async function renderPrice() {
    const dis = locked();
    const selVariants = details ? details.variants.filter((v) => draft.variantIds.includes(v.id)) : [];
    const cat = selVariants.map((v) => Number(v.price));
    const max = cat.length ? Math.max(...cat) : null;
    const min = cat.length ? Math.min(...cat) : null;
    const marginBox = h('div');
    const price = h('input', { type: 'number', step: '0.01', min: '0', value: draft.price ?? '', disabled: dis, oninput: () => { set({ price: price.value === '' ? null : Number(price.value) }); drawMargin(); } });
    const drawMargin = () => {
      const p = Number(price.value);
      if (!p || max === null) return clear(marginBox);
      clear(marginBox, h(`div.inline-msg.${p > max ? 'info' : 'error'}`, `Differenz zum Katalogpreis: ${fmtEuro(p - max)} (teuerste Variante) bis ${fmtEuro(p - min)} (günstigste). Ohne Aufschläge für weitere Druckflächen/DTF, Versand, Zahlungsgebühren und Steuern.`));
    };
    drawMargin();
    const shopsBox = h('div', h('span.muted', 'Verbundene Shops werden geladen …'));
    const colBox = h('div');
    const tagInput = h('input', { type: 'text', placeholder: 'Tag eingeben und Enter drücken', disabled: dis });
    const tagChips = h('div.chips');
    const drawTags = () => clear(tagChips, (draft.tags || []).map((t) => h('span.chip', t, dis ? null : h('button', { type: 'button', 'aria-label': 'Entfernen', onclick: () => { set({ tags: draft.tags.filter((x) => x !== t) }); drawTags(); } }, '×'))));
    tagInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && tagInput.value.trim()) { e.preventDefault(); set({ tags: [...new Set([...(draft.tags || []), tagInput.value.trim()])] }); tagInput.value = ''; drawTags(); } });
    drawTags();
    clear(sec.price, h('div.grid.cols-2',
      h('div',
        h('label.field', h('span', 'Verkaufspreis (€, für alle Varianten)'), price, h('div.hint', max !== null ? `Katalogpreise laut MarketPrint: ${fmtEuro(min)} – ${fmtEuro(max)}` : 'Katalogpreis erscheint nach Variantenwahl.')),
        marginBox,
        h('div.field-label', 'Produktbilder (Mockups)'),
        h('label.check', h('input', { type: 'radio', name: 'mockups', checked: draft.mockups === 'withDesign', disabled: dis, onchange: () => set({ mockups: 'withDesign' }) }), h('span', 'Nur Mockups, die das Motiv zeigen (Empfehlung von MarketPrint)')),
        h('label.check', h('input', { type: 'radio', name: 'mockups', checked: draft.mockups === 'all', disabled: dis, onchange: () => set({ mockups: 'all' }) }), h('span', 'Alle Mockups (auch Ansichten ohne Motiv)'))),
      h('div',
        h('div.field-label', 'Zielshop'), shopsBox,
        h('div.field-label', { style: { marginTop: '16px' } }, 'Kollektionen (Shopify)'), colBox,
        h('div.field-label', { style: { marginTop: '16px' } }, 'Tags (Shopify)'), tagInput, tagChips,
        h('p.hint', 'Kollektionen und Tags setzt APOLOGEA Studio nach dem Anlegen über die Shopify-Admin-App. MarketPrint selbst unterstützt sie nicht.'))));
    try {
      account ||= await get('/api/marketprint/account');
      const allowedShops = state.boot?.settings?.marketprint?.allowedShops || [];
      clear(shopsBox, (account.shopDomains || []).map((s) => {
        const ok = allowedShops.includes(s);
        return h('label.check', h('input', { type: 'checkbox', checked: ok && draft.targetShops.includes(s), disabled: dis || !ok, onchange: (e) => { const set2 = new Set(draft.targetShops); e.target.checked ? set2.add(s) : set2.delete(s); set({ targetShops: [...set2] }); } }),
          h('span', s, ok ? h('small.muted', ' (freigegeben)') : h('small', { style: { color: 'var(--warn)' } }, ' – nicht als Zielshop freigegeben')));
      }));
    } catch (err) { clear(shopsBox, h('div.inline-msg.error', err.message)); }
    try {
      const cols = await get('/api/shopify/collections');
      clear(colBox, cols.filter((c) => !c.smart).map((c) => h('label.check', h('input', { type: 'checkbox', checked: draft.collections.some((x) => x.id === c.id), disabled: dis, onchange: (e) => { const others = draft.collections.filter((x) => x.id !== c.id); set({ collections: e.target.checked ? [...others, { id: c.id, title: c.title }] : others }); } }), h('span', c.title))),
        cols.some((c) => c.smart) ? h('p.hint', 'Automatische Kollektionen ordnen Produkte selbst über Regeln zu und sind hier nicht wählbar.') : null);
    } catch (err) { clear(colBox, h('div.inline-msg.info', err.code === 'missing_admin' ? 'Nicht verfügbar – dafür wird die Shopify-Admin-App benötigt.' : err.message)); }
  }

  // ---------- 6 Prüfen
  function renderCheck() {
    clear(sec.check, lastValidation ? h('div', h('p.muted', `Zuletzt geprüft: ${fmtDate(lastValidation.at)}`), issuesList(lastValidation.issues)) : h('p.muted', 'Noch nicht geprüft. „Angaben prüfen“ zeigt fehlende oder problematische Angaben.'));
  }

  // ---------- Ergebnis / Sperrzustände
  function renderResult() {
    const pub = draft.publish || {};
    if (pub.state === 'done') {
      const r = pub.result || {};
      clear(sec.result, h('div.frame.stack',
        h('div.eyebrow', r.simulated ? 'Simulation – nichts wurde angelegt' : 'Veröffentlicht'),
        h('h2', r.simulated ? 'Simulation abgeschlossen' : 'Produkt wurde von MarketPrint angelegt'),
        h('p', `Abgeschlossen am ${fmtDate(pub.finishedAt || pub.reconciledAt)}.`),
        r.marketprint?.draftId ? h('p', `MarketPrint-Entwurf: ${r.marketprint.draftId}`) : null,
        r.postSteps ? h(`div.inline-msg.${r.postSteps.ok ? 'ok' : 'warn'}`, r.postSteps.message) : null,
        h('div.row', (r.links || []).map((l) => extLink(l.label, l.url))),
        (r.marketprint?.listingImages || []).length ? h('div.grid.cards', r.marketprint.listingImages.slice(0, 8).map((u) => h('div.card', h('div.thumb', h('img', { src: typeof u === 'string' ? u : u.url, alt: 'Mockup' }))))) : null,
        h('div.row', h('button', { type: 'button', onclick: duplicate }, 'Als neuen Entwurf duplizieren'))));
    } else if (pub.state === 'unknown' || pub.state === 'running') {
      const auto = h('button.primary', { type: 'button' }, 'In Shopify nachsehen');
      auto.addEventListener('click', () => busy(auto, async () => { try { const r = await post(`/api/products/${id}/reconcile`, { action: 'auto' }); toast(r.found ? 'Produkt gefunden – als erfolgreich markiert.' : r.message, r.found ? 'ok' : 'error', 9000); await reload(); } catch (err) { showError(err); } }));
      clear(sec.result, h('div.frame.stack',
        h('div.eyebrow', 'Ergebnis muss geprüft werden'),
        h('h2', 'Unklarer Ausgang'),
        h('p', 'Die Veröffentlichung wurde gestartet, aber das Ergebnis ist nicht bestätigt (z. B. Verbindungsabbruch oder Programm beendet). Damit kein Produkt doppelt angelegt wird, ist eine erneute Veröffentlichung gesperrt, bis der tatsächliche Stand geklärt ist.'),
        pub.error ? h('div.inline-msg.warn', pub.error) : null,
        h('div.row', auto, extLink('Shopify-Produkte öffnen', `https://${draft.targetShops[0] || 'dfz1mp-1u.myshopify.com'}/admin/products?query=${encodeURIComponent(draft.publicTitle)}`)),
        h('div.row',
          h('button', { type: 'button', onclick: async () => { if (await confirmDialog({ title: 'Produkt ist vorhanden?', text: 'Du hast das Produkt in Shopify/MarketPrint gefunden.' })) { await post(`/api/products/${id}/reconcile`, { action: 'confirm-exists' }).catch(showError); reload(); } } }, 'Produkt ist vorhanden'),
          h('button.danger', { type: 'button', onclick: async () => { if (await confirmDialog({ title: 'Produkt fehlt sicher?', text: 'Nur bestätigen, wenn du in Shopify UND MarketPrint nachgesehen hast. Danach ist ein erneuter Versuch möglich.', danger: true })) { await post(`/api/products/${id}/reconcile`, { action: 'confirm-missing' }).catch(showError); reload(); } } }, 'Produkt fehlt – erneuten Versuch erlauben'))));
    } else if (pub.state === 'failed') {
      clear(sec.result, h('div.frame.stack', h('div.eyebrow', 'Fehlgeschlagen'), h('h2', 'Veröffentlichung fehlgeschlagen'), h('div.inline-msg.error', pub.error || 'Unbekannter Fehler'), h('p', 'Es wurde nichts angelegt bzw. du hast das bestätigt. Du kannst den Entwurf wieder bearbeiten und erneut prüfen.'),
        h('button.primary', { type: 'button', onclick: async () => { await post(`/api/products/${id}/reopen`).catch(showError); reload(); } }, 'Entwurf wieder bearbeiten')));
    } else clear(sec.result);
  }

  async function reload() {
    draft = await get(`/api/products/${id}`);
    lastValidation = draft.validation;
    renderAll();
  }

  async function duplicate() {
    await saver.flush();
    try { const p = await post(`/api/products/${id}/duplicate`); toast('Duplikat angelegt.', 'ok'); location.hash = `#/produkte/${p.id}`; } catch (err) { showError(err); }
  }

  function renderAll() {
    renderStatus();
    clear(simBanner, draft.publish?.result?.simulated ? h('div.sim-banner', 'Dieser Entwurf wurde nur im Simulationsmodus „veröffentlicht“. Bei MarketPrint wurde nichts angelegt.') : null);
    renderResult(); renderBase(); renderVariants(); renderPrint(); renderTexts(); renderPrice(); renderCheck();
    for (const b of actionButtons) b.disabled = locked() && !b.dataset.always;
  }

  // ---------- Aktionen
  const btn = (label, fn, opts = {}) => {
    const b = h(`button${opts.primary ? '.primary' : ''}`, { type: 'button' }, label);
    if (opts.always) b.dataset.always = '1';
    b.addEventListener('click', () => busy(b, fn));
    return b;
  };
  const validateBtn = btn('Angaben prüfen', async () => {
    await saver.flush();
    try { const r = await post(`/api/products/${id}/validate`); lastValidation = { at: new Date().toISOString(), issues: r.issues }; draft = await get(`/api/products/${id}`); renderStatus(); renderCheck(); document.getElementById('step-check').scrollIntoView({ behavior: 'smooth' }); toast(r.status === 'Bereit zur Prüfung' ? 'Alle Pflichtangaben vorhanden.' : 'Es fehlen noch Angaben.', r.status === 'Bereit zur Prüfung' ? 'ok' : 'error'); } catch (err) { showError(err); }
  });
  const saveBtn = btn('Entwurf speichern', async () => { await saver.flush(); toast('Entwurf gespeichert.', 'ok'); });
  const templateBtn = btn('Als Vorlage speichern', async () => {
    await saver.flush();
    const input = h('input', { type: 'text', placeholder: 'z. B. Oversized Shirt – Rückendruck' });
    const name = await modal({ title: 'Als Vorlage speichern', body: h('div', h('p.muted', 'Gespeichert werden Grundprodukt, Varianten, Druckverfahren, Platzierungen, Textstil, Beschreibung, Preis, Shop, Mockups, Kollektionen und Tags – ohne Motive und Namen.'), h('label.field', h('span', 'Name der Vorlage'), input)), actions: [{ label: 'Abbrechen', value: null }, { label: 'Speichern', primary: true, onClick: () => input.value.trim() || false }] });
    if (!name) return;
    try { await post(`/api/products/${id}/template`, { name }); toast('Vorlage gespeichert.', 'ok'); } catch (err) { showError(err); }
  }, { always: true });
  const dupBtn = btn('Produkt duplizieren', duplicate, { always: true });
  const previewBtn = btn('Vorschau anzeigen', async () => { await saver.flush(); await showPreview(); }, { always: true });
  const reviewBtn = btn('Zur Veröffentlichung prüfen', async () => { await saver.flush(); await reviewAndPublish(); }, { primary: true });
  const actionButtons = [validateBtn, saveBtn, templateBtn, dupBtn, previewBtn, reviewBtn];

  async function showPreview() {
    if (!details) return showError(userError('Zuerst ein Grundprodukt wählen.'));
    const selVariants = details.variants.filter((v) => draft.variantIds.includes(v.id));
    const canvases = (draft.placements || []).filter((p) => p.designId).map((pl) => {
      const area = details.printAreas.find((a) => a.name === pl.printArea);
      const d = designs.find((x) => x.id === pl.designId);
      const c = h('canvas.schema', { width: 360, height: Math.round(360 * area.height / area.width) });
      drawSchema(c, area, pl, d);
      return h('div', h('div.field-label', AREA_LABEL[area.name] || area.name), h('div.preview-box', h('span.preview-label', 'Schematisch'), c));
    });
    await modal({
      eyebrow: 'Vorschau – nicht verbindlich', title: draft.publicTitle || 'Produktvorschau', wide: true,
      body: h('div.stack',
        h('div.inline-msg.info', 'Diese Vorschau ist von APOLOGEA Studio erzeugt und zeigt nur die ungefähre Lage auf der Druckfläche. Verbindliche Mockups erzeugt MarketPrint beim Anlegen des Produkts.'),
        h('div.grid.cols-3', canvases),
        h('dl.kv', h('dt', 'Grundprodukt'), h('dd', draft.baseProduct?.title || '–'), h('dt', 'Varianten'), h('dd', `${selVariants.length}`), h('dt', 'Preis'), h('dd', fmtEuro(draft.price))),
        h('div.field-label', 'Beschreibung'), htmlPreview(draft.description || '<p><em>(MarketPrint-Standardtext)</em></p>')),
      actions: [{ label: 'Schließen', value: true }],
    });
  }

  async function reviewAndPublish() {
    let r;
    try { r = await post(`/api/products/${id}/review`); } catch (err) { return showError(err); }
    if (!r.ok) {
      lastValidation = { at: new Date().toISOString(), issues: r.issues };
      draft = await get(`/api/products/${id}`);
      renderStatus(); renderCheck();
      document.getElementById('step-check').scrollIntoView({ behavior: 'smooth' });
      return toast('Es fehlen noch Angaben – siehe „Prüfen“.', 'error');
    }
    draft = await get(`/api/products/${id}`);
    renderStatus();
    const s = r.summary;
    const ok = await modal({
      eyebrow: s.simulated ? 'Freigabe erforderlich · SIMULATION' : 'Freigabe erforderlich', title: 'Zusammenfassung vor der Veröffentlichung', wide: true,
      body: h('div.stack',
        s.simulated ? h('div.sim-banner', 'Simulationsmodus: Es wird nichts bei MarketPrint oder Shopify angelegt.') : null,
        h('dl.kv',
          h('dt', 'Zielshop'), h('dd', h('strong', s.shops.join(', '))),
          h('dt', 'Produkt'), h('dd', h('strong', s.title), h('div.muted', `intern: ${s.internalName}`)),
          h('dt', 'Grundprodukt'), h('dd', `${s.baseProduct} · Druck: ${String(s.printerType).toUpperCase()}`),
          h('dt', 'Varianten'), h('dd', `${s.variantCount} Varianten`, s.variants.map((v) => h('div', h('span', { style: { display: 'inline-block', width: '12px', height: '12px', background: v.hex, border: '1px solid #fff4', marginRight: '6px' } }), `${v.color}: ${v.sizes.join(', ')}`))),
          h('dt', 'Verkaufspreis'), h('dd', h('strong', fmtEuro(s.price)), h('div.muted', `Katalogpreis laut MarketPrint: ${fmtEuro(s.catalogueMin)} – ${fmtEuro(s.catalogueMax)}`)),
          h('dt', 'Dateien'), h('dd', s.files.map((f) => h('div', `${f.printArea}: ${f.design} (${f.file}) · ${f.placement}`, f.alternative ? h('div.muted', `Alternativ: ${f.alternative.design} für ${f.alternative.colors.length} Farbe(n)`) : null))),
          h('dt', 'Produktbilder'), h('dd', s.mockups),
          h('dt', 'Beschreibung'), h('dd', s.description.replace(/<[^>]+>/g, ' ').slice(0, 300) + (s.description.length > 300 ? ' …' : '')),
          s.post.collections.length || s.post.tags.length ? [h('dt', 'Danach in Shopify'), h('dd', [s.post.collections.length ? `Kollektionen: ${s.post.collections.map((c) => c.title).join(', ')}` : null, s.post.tags.length ? `Tags: ${s.post.tags.join(', ')}` : null].filter(Boolean).join(' · '))] : null),
        h('h4', 'Erwartete Auswirkung'), s.effect.map((e) => h('div.inline-msg.info', e)),
        s.warnings.map((w) => h('div.inline-msg.warn', w))),
      actions: [{ label: 'Abbrechen', value: false }, { label: s.simulated ? 'Simulation ausführen' : 'Jetzt veröffentlichen', value: true, primary: true }],
    });
    if (!ok) return;
    draft.status = 'Wird ausgeführt';
    renderStatus();
    for (const b of actionButtons) b.disabled = true;
    try {
      const res = await post(`/api/products/${id}/publish`, { approvalHash: r.approvalHash });
      toast(res.result.simulated ? 'Simulation abgeschlossen – nichts wurde angelegt.' : 'MarketPrint hat das Anlegen bestätigt.', 'ok', 9000);
    } catch (err) { showError(err); }
    await reload();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const steps = [
    ['step-base', 'Grundprodukt', sec.base],
    ['step-variants', 'Farben & Größen', sec.variants],
    ['step-print', 'Druck & Motive', sec.print],
    ['step-texts', 'Namen & Texte', sec.texts],
    ['step-price', 'Preis, Shop & Kollektion', sec.price],
    ['step-check', 'Prüfen', sec.check],
  ];
  clear(main,
    h('div.page-head',
      h('div', h('div.eyebrow', 'Neues Produkt'), h('h1', draft.internalName || draft.publicTitle || 'Produktentwurf')),
      h('div.actions', statusBox, saved, h('button.small.danger', { type: 'button', onclick: async () => { if (await confirmDialog({ title: 'Entwurf löschen?', text: 'Nur der Entwurf in APOLOGEA Studio wird gelöscht. Bereits angelegte Produkte in MarketPrint/Shopify bleiben bestehen.', danger: true, confirmLabel: 'Löschen' })) { await del(`/api/products/${id}?confirm=1`).catch(showError); location.hash = '#/produkte'; } } }, 'Entwurf löschen'))),
    simBanner,
    sec.result,
    h('div.editor',
      h('nav.steps', { 'aria-label': 'Schritte' }, steps.map(([sid, label], i) => h('a', { href: `#`, onclick: (e) => { e.preventDefault(); document.getElementById(sid).scrollIntoView({ behavior: 'smooth' }); } }, h('span.n', String(i + 1)), label))),
      h('div',
        steps.map(([sid, label, el], i) => h('section.section.step', { id: sid }, h('h2', `${i + 1} · ${label}`), el)),
        h('div.sticky-bar', h('div.row', statusBox2), h('div.row', actionButtons)))));

  await loadDetails();
  renderAll();
}

function placementArg(pl) {
  if (!pl) return 'auto';
  if (pl.placement?.mode === 'named') return pl.placement.named;
  if (pl.placement?.mode === 'custom') return pl.placement;
  return 'auto';
}

/** Schematische Darstellung: Druckfläche + Motiv. Ausdrücklich nicht verbindlich. */
function drawSchema(canvas, area, pl, design) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#8a7046';
  ctx.setLineDash([6, 5]);
  ctx.strokeRect(1, 1, W - 2, H - 2);
  ctx.setLineDash([]);
  if (!design?.analysis?.width || !design?.analysis?.height) {
    ctx.fillStyle = '#9a907f';
    ctx.font = '14px Segoe UI, sans-serif';
    ctx.fillText(design ? 'Vektordatei – Größe bestimmt MarketPrint' : 'Kein Motiv', 14, 26);
    return;
  }
  const iw = design.analysis.width;
  const ih = design.analysis.height;
  let w; let hh; let cx; let cy;
  const mode = pl?.placement?.mode || 'auto';
  if (mode === 'custom') {
    w = W * pl.placement.widthPercent; hh = w * ih / iw; cx = W * pl.placement.xPercent; cy = H * pl.placement.yPercent;
  } else if (mode === 'named') {
    w = W * 0.22; hh = w * ih / iw; cy = H * 0.18;
    cx = pl.placement.named === 'small-left-chest' ? W * 0.7 : pl.placement.named === 'small-right-chest' ? W * 0.3 : W * 0.5;
  } else {
    const s = Math.min(W / iw, H / ih); w = iw * s; hh = ih * s; cx = W / 2; cy = H / 2;
  }
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, cx - w / 2, cy - hh / 2, w, hh);
    ctx.strokeStyle = '#cfae72';
    ctx.strokeRect(cx - w / 2, cy - hh / 2, w, hh);
    if (mode === 'named') { ctx.fillStyle = '#cfae72'; ctx.font = '12px Segoe UI, sans-serif'; ctx.fillText('ungefähre Lage', 8, H - 10); }
  };
  img.src = `/files/design/${design.id}/thumb`;
}
