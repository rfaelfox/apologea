import { shrinkImage, upload, h, clear, get, post, put, del, badge, fmtDate, fmtEuro, fmtUsd, showError, toast, modal, confirmDialog, autosaver, busy, extLink, ornament, userError } from '../core.js';
import { confirmAiCall, issuesList, fileNotes, htmlPreview, imageAttachments } from './shared.js';
import { pickDesign } from './library.js';
import { setCleanup, state } from '../app.js';
import { fitToArea, dpiInfo, dpiText, areaCm, motifMaxCm, fmtCm } from './placement.js';

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
    h('div.page-head', h('div', h('div.eyebrow', 'Print on Demand'), h('h1', 'Produkte')),
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

const MP_APP = 'https://app.marketprint.de';

/**
 * „Neues Produkt erstellen“: zwei Wege.
 *  1. Im Programm über die MarketPrint-Schnittstelle (MCP) – mit Prüfungen, Freigabe und Verlauf.
 *  2. Direkt im MarketPrint-Designer auf der MarketPrint-Website – das Programm öffnet das gewählte Produkt dort.
 */
export async function newProductDialog(items, templates, presetDesignId) {
  let closeModal = () => {};
  const choice = h('div.grid.cols-2.way-choice',
    h('div.card.way.stack',
      h('div.eyebrow', 'Weg 1'),
      h('h3', 'Im Programm anlegen'),
      h('p.muted', 'Über die MarketPrint-Schnittstelle (MCP): Kleidungsstück, Farben, Motiv, Platzierung, Texte und Preis hier festlegen. Mit DPI-Prüfung, Vorlagen, Freigabe vor dem Veröffentlichen und Verlauf.'),
      h('button.primary', { type: 'button', onclick: () => { closeModal(true); setTimeout(() => programDialog(items, templates, presetDesignId), 30); } }, 'Im Programm starten')),
    h('div.card.way.stack',
      h('div.eyebrow', 'Weg 2'),
      h('h3', 'Im MarketPrint-Designer gestalten'),
      h('p.muted', 'Direkt auf der Website von MarketPrint: Die MarketPrint-Seite öffnet sich in deinem Browser. Kleidungsstück wählen, gestalten und veröffentlichen erfolgen dort.'),
      h('button', { type: 'button', onclick: () => { closeModal(true); setTimeout(() => marketprintSiteDialog(), 30); } }, 'Zu MarketPrint wechseln')));
  await modal({
    eyebrow: 'Neues Produkt erstellen', title: 'Wie möchtest du das Produkt erstellen?', wide: true,
    body: choice,
    actions: [{ label: 'Schließen', value: false }],
    onReady: (close) => { closeModal = close; },
  });
}

async function programDialog(items, templates, presetDesignId) {
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
    eyebrow: 'Weg 1 · Im Programm anlegen', title: 'Wie möchtest du beginnen?', wide: true,
    body: h('div.grid.cols-3',
      h('div.card.stack', h('h3', 'Leerer Entwurf'), h('p.muted', 'Alle Angaben selbst festlegen.'), h('button.primary', { type: 'button', onclick: () => make({}).catch(showError) }, 'Leer beginnen')),
      h('div.card.stack', h('h3', 'Aus Vorlage'), templates.length ? templates.map((t) => h('button', { type: 'button', style: { width: '100%' }, onclick: () => make({ fromTemplate: t.id }).catch(showError) }, t.name)) : h('p.muted', 'Noch keine Vorlagen. In einem Entwurf: „Als Vorlage speichern“.')),
      h('div.card.stack', h('h3', 'Aus vorhandenem Produkt'), items.length ? h('div', { style: { maxHeight: '260px', overflow: 'auto' } }, items.slice(0, 30).map((p) => h('button.small', { type: 'button', style: { width: '100%', marginBottom: '4px', textTransform: 'none', letterSpacing: 0 }, onclick: () => make({ fromProduct: p.id }).catch(showError) }, p.internalName || p.publicTitle || p.id))) : h('p.muted', 'Noch keine Produkte.'))),
    actions: [{ label: 'Schließen', value: false }],
    onReady: (close) => { closeModal = close; },
  });
}

/** Weg 2: Kleidungsstück wählen → MarketPrint-Designer im Browser öffnen (ohne Wartezeit). */
async function marketprintSiteDialog() {
  const grid = h('div.mp-list', h('span.muted', 'Wird geladen …'));
  const search = h('input', { type: 'search', placeholder: 'Suchen, z. B. Shirt, Hoodie …' });
  const status = h('div');
  const open = async (url, label) => {
    clear(status, h('div.inline-msg.info', `${label} wird im Browser geöffnet …`));
    const fallback = () => h('div.row', { style: { marginTop: '8px' } },
      h('a.btn.small', { href: url, target: '_blank', rel: 'noopener' }, 'Hier im Programmfenster öffnen'),
      copyBtn(url));
    try {
      const r = await post('/api/open-external', { url });
      if (r.ok) clear(status, h('div.inline-msg.ok', `${label} wurde in deinem Standardbrowser geöffnet. Nichts zu sehen? Prüfe die Taskleiste – oder nutze einen der Wege hier:`, fallback()));
      else clear(status, h('div.inline-msg.warn', 'Windows hat den Standardbrowser nicht gestartet. So geht es trotzdem:', fallback()));
    } catch (err) {
      clear(status, h('div.inline-msg.error', `Öffnen fehlgeschlagen: ${err.message}`, fallback()));
    }
  };
  const copyBtn = (url) => h('button.small', { type: 'button', onclick: async (e) => {
    try { await navigator.clipboard.writeText(url); e.target.textContent = 'Kopiert – im Browser einfügen'; } catch { e.target.replaceWith(h('code', url)); }
  } }, 'Adresse kopieren');
  const body = h('div.stack',
    h('div.inline-msg.info', 'Der MarketPrint-Designer öffnet sich in deinem Browser (dort mit deinem MarketPrint-Konto anmelden). Was du dort anlegst, veröffentlicht MarketPrint direkt in deinem Shop – APOLOGEA Studio prüft und protokolliert diese Produkte nicht. Achte dort auf den richtigen Shop (dfz1mp-1u.myshopify.com).'),
    h('div.row', h('button.primary', { type: 'button', onclick: () => open(`${MP_APP}/`, 'MarketPrint') }, 'MarketPrint öffnen'), h('div', { style: { flex: '1 1 260px' } }, search)),
    status,
    h('div.field-label', 'Kleidungsstück schon wissen? Anklicken – MarketPrint öffnet sich, und hier steht, wo du es dort findest'),
    grid);
  let catalog = null;
  const draw = () => {
    if (!catalog) return;
    const q = search.value.toLowerCase();
    const list = catalog.items.filter((c) => !q || c.title.toLowerCase().includes(q));
    clear(grid, list.length ? list.map((c) => {
      const it = h('button.mp-item', { type: 'button', title: `MarketPrint öffnen und „${c.title}“ wählen` },
        c.image ? h('img', { src: c.image, alt: '', loading: 'lazy' }) : null,
        h('span.t', c.title), c.hasNeckPrint ? h('small.badge-neck', 'Nackendruck möglich') : null);
      // Direktlinks auf den Designer (/design/<id>) lädt MarketPrint nicht (getestet 2026-10-16) – daher Startseite
      // öffnen und den Produktnamen zum Einfügen in die MarketPrint-Suche kopieren.
      it.addEventListener('click', async () => {
        let copied = false;
        try { await navigator.clipboard.writeText(c.title); copied = true; } catch { /* Zwischenablage nicht verfügbar */ }
        await open(`${MP_APP}/`, 'MarketPrint');
        status.prepend(h('div.inline-msg.info', h('strong', `In MarketPrint: oben „Produkte“ → „${c.title}“ wählen.`), copied ? ' Der Name ist kopiert und kann dort in die Suche eingefügt werden (Strg+V).' : ''));
      });
      return it;
    }) : h('div.muted', 'Nichts gefunden.'));
  };
  search.addEventListener('input', draw);
  modal({ eyebrow: 'Weg 2 · MarketPrint-Website', title: 'Im MarketPrint-Designer gestalten', wide: true, body, actions: [{ label: 'Schließen', value: false }] });
  try {
    catalog = await get('/api/marketprint/website-catalog');
    draw();
  } catch (err) {
    clear(grid, h('div.inline-msg.warn', 'Produktliste nicht verfügbar – „MarketPrint öffnen“ funktioniert trotzdem. (', err.message, ')'));
  }
}

// ------------------------------------------------------------------ Editor

export async function renderProductEditor(main, id) {
  let draft = await get(`/api/products/${id}`);
  let details = null;
  let account = null;
  let designs = await get('/api/designs');
  const providers = await get('/api/providers');
  const pid = () => draft.provider || 'marketprint';
  const prov = () => providers.find((p) => p.id === pid()) || providers[0];
  const PN = () => prov().name;
  const caps = () => prov().capabilities;
  const linkOf = (d) => (d ? d.providerLinks?.[pid()] || (pid() === 'marketprint' ? d.marketprint : null) : null);
  const ckey = (v) => v.colorHex || v.color;
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
    base: h('div'), variants: h('div'), print: h('div'), texts: h('div'), images: h('div'), price: h('div'), check: h('div'), result: h('div'),
  };

  function renderStatus() { for (const b of [statusBox, statusBox2]) clear(b, badge(draft.status, { simulated: draft.publish?.result?.simulated })); }

  async function loadDetails(refresh = false) {
    if (!draft.baseProduct?.id) { details = null; return; }
    try { details = await get(`/api/providers/${pid()}/products/${encodeURIComponent(draft.baseProduct.id)}${refresh ? '?refresh=1' : ''}`); } catch (err) { details = null; showError(err); }
  }

  // ---------- 1 Anbieter & Grundprodukt
  function providerPicker() {
    return h('div', { style: { marginBottom: '18px' } },
      h('div.field-label', 'Print-on-Demand-Anbieter'),
      h('div.swatches', providers.map((p) => h(`button.swatch${p.id === pid() ? '.on' : ''}`, {
        type: 'button', disabled: locked() || p.id === pid(), title: p.connected ? '' : 'Noch nicht verbunden',
        onclick: async () => {
          if (draft.baseProduct && !window.confirm(`Zu ${p.name} wechseln? Grundprodukt, Varianten und Druckflächen werden zurückgesetzt.`)) return;
          await saver.flush();
          draft = await put(`/api/products/${id}`, { provider: p.id });
          details = null; account = null;
          renderAll();
        },
      }, p.name, p.simulated ? h('small.muted', ' (Simulation)') : !p.connected ? h('small', { style: { color: 'var(--warn)' } }, ' (nicht verbunden)') : null))),
      !prov().connected ? h('div.inline-msg.warn', `${PN()} ist noch nicht verbunden – `, h('a', { href: '#/einstellungen' }, 'Einstellungen → Anbieter'), '.') : null);
  }

  async function renderBase() {
    if (draft.baseProduct && details) {
      clear(sec.base, providerPicker(), h('div.grid.cols-2',
        h('div.preview-box', h('img.garment', { src: draft.baseProduct.image, alt: draft.baseProduct.title })),
        h('div.stack',
          h('h3', draft.baseProduct.title), draft.baseProduct.optionLabel ? h('div.muted', `Druckdienstleister: ${draft.baseProduct.optionLabel}`) : null,
          h('dl.kv',
            h('dt', 'Druckflächen'), h('dd', details.printAreas.map((a) => { const c = areaCm(a); return `${AREA_LABEL[a.name] || a.name}: max. ${fmtCm(c.w)} × ${fmtCm(c.h)} cm (${a.width} × ${a.height} px)`; }).join(' · ')),
            h('dt', 'Druckverfahren'), h('dd', (details.supportedPrinterTypes || []).map((t) => t.toUpperCase()).join(', ') || '–'),
            h('dt', 'Nackendruck'), h('dd', details.hasNeckPrint ? (caps().neckPrint ? 'möglich – siehe „Druck & Motive“' : `vom Produkt unterstützt, über ${PN()} nicht verfügbar`) : 'bei diesem Produkt nicht möglich'),
            h('dt', 'Alternativ-Motiv je Farbe'), h('dd', details.hasAlternativeDesign ? 'unterstützt' : 'nein'),
            h('dt', 'Daten abgerufen'), h('dd', fmtDate(details.cachedAt), ' ', h('button.small.ghost', { type: 'button', onclick: async () => { await loadDetails(true); renderAll(); } }, 'Aktualisieren'))),
          h('details.box', h('summary', `Produktangaben laut ${details.descriptionSource || PN()} (Originaltext)`), h('div', htmlPreview(details.description))),
          locked() ? null : h('button.small', { type: 'button', onclick: () => { if (!draft.variantIds.length || window.confirm('Grundprodukt ändern? Varianten und Druckflächen werden zurückgesetzt.')) { set({ baseProduct: null, variantIds: [], placements: [], printerType: '', printSides: '', neckPrint: null }); details = null; renderAll(); } } }, 'Anderes Grundprodukt wählen'))));
      return;
    }
    const search = h('input', { type: 'search', placeholder: 'Suchen, z. B. Shirt, Hoodie …' });
    const grid = h('div.catalog', h('span.muted', `Katalog wird von ${PN()} geladen …`));
    clear(sec.base, providerPicker(), h('div.row', { style: { marginBottom: '12px' } }, search), grid);
    let catalog;
    try { catalog = await get(`/api/providers/${pid()}/catalog`); } catch (err) { clear(grid, h('div.inline-msg.error', err.message, ' – ', h('a', { href: '#/einstellungen' }, `${PN()} einrichten`))); return; }
    const draw = () => {
      const q = search.value.toLowerCase();
      clear(grid, catalog.items.filter((c) => !q || c.title.toLowerCase().includes(q)).map((c) => {
        const it = h('div.item', { tabindex: 0, role: 'button' }, c.image ? h('img', { src: c.image, alt: '', loading: 'lazy' }) : h('div', { style: { aspectRatio: '1', display: 'grid', placeItems: 'center', color: '#8a7046' } }, 'ohne Bild'), h('div.t', c.title), caps().neckPrint && c.hasNeckPrint ? h('small.badge-neck', 'Nackendruck möglich') : null);
        const choose = async () => {
          let baseId = c.id;
          let optionLabel = null;
          if (caps().catalogOptions) {
            // z. B. Printify: Druckdienstleister wählen (bestimmt Varianten, Druckflächen, Preise)
            let opts;
            try { opts = await get(`/api/providers/${pid()}/catalog/${encodeURIComponent(c.id)}/options`); } catch (err) { return showError(err); }
            if (!opts.length) return showError(userError('Für dieses Produkt gibt es keinen Druckdienstleister.'));
            let chosen = opts[0];
            if (opts.length > 1) {
              const sel = h('select', opts.map((o) => h('option', { value: o.id }, o.label)));
              const ok = await modal({ title: 'Druckdienstleister wählen', body: h('div', h('p.muted', `${PN()} lässt „${c.title}“ von verschiedenen Druckereien fertigen. Varianten, Preise und Druckflächen hängen davon ab.`), sel), actions: [{ label: 'Abbrechen', value: false }, { label: 'Übernehmen', value: true, primary: true }] });
              if (!ok) return;
              chosen = opts.find((o) => o.id === sel.value);
            }
            baseId = `${c.id}:${chosen.id}`;
            optionLabel = chosen.label;
          }
          set({ baseProduct: { id: baseId, title: c.title, image: c.image, optionLabel }, variantIds: [], placements: [], printerType: '', printSides: '', neckPrint: null });
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
    if (catalog.stale) grid.before(h('div.inline-msg.warn', `Gespeicherter Katalog (${PN()} gerade nicht erreichbar): ` + catalog.error));
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
      h('div.swatches', colors.map((c) => h(`button.swatch${selColors.has(c.name) ? '.on' : ''}`, { type: 'button', disabled: dis, onclick: () => { const cs = new Set(selColors); cs.has(c.name) ? cs.delete(c.name) : cs.add(c.name); apply(cs, selSizes.size ? selSizes : new Set(sizes)); } }, h('span.c', { style: { background: c.hex || 'repeating-linear-gradient(45deg,#3a342a 0 4px,#23211e 4px 8px)' } }), c.name))),
      h('div.field-label', { style: { marginTop: '16px' } }, 'Größen'),
      h('div.sizes', sizes.map((s) => h(`button.size${selSizes.has(s) ? '.on' : ''}`, { type: 'button', disabled: dis, onclick: () => { const ss = new Set(selSizes); ss.has(s) ? ss.delete(s) : ss.add(s); apply(selColors, ss); } }, s)),
        h('button.small.ghost', { type: 'button', disabled: dis, onclick: () => apply(selColors, new Set(sizes)) }, 'Alle Größen')),
      h('div', { style: { marginTop: '16px' } },
        selVariants.length ? h('div.table-wrap', h('table.list', h('thead', h('tr', h('th', 'Farbe'), h('th', 'Größen'), h('th', details.priceLabel || 'Katalogpreis'))),
          h('tbody', [...selColors].map((c) => {
            const vs = selVariants.filter((v) => v.color === c);
            const prices = [...new Set(vs.map((v) => v.price).filter((x) => x !== null && x !== undefined))];
            return h('tr', h('td', c), h('td', vs.map((v) => v.size).join(', ')), h('td', prices.length ? prices.map(fmtEuro).join(' / ') : 'beim Anlegen'));
          })))) : h('div.inline-msg.warn', 'Noch keine Variante gewählt.'),
        h('p.hint', `${selVariants.length} Varianten ausgewählt. Nicht verfügbare Varianten werden automatisch ausgelassen.`)));
  }

  // ---------- 3 Druck & Motive
  function inferSides() {
    if (draft.printSides) return draft.printSides;
    const used = new Set(draft.placements.filter((p) => p.designId).map((p) => p.printArea));
    return used.has('front') && used.has('back') ? 'both' : used.has('back') ? 'back' : 'front';
  }

  function renderPrint() {
    if (!details) { clear(sec.print, h('p.muted', 'Zuerst ein Grundprodukt wählen.')); return; }
    const dis = locked();
    const types = details.supportedPrinterTypes || [];
    const parts = [];
    if (types.length > 1) {
      parts.push(h('label.field', h('span', 'Druckverfahren'),
        h('select', { disabled: dis, onchange: (e) => { set({ printerType: e.target.value }); renderPrint(); } }, h('option', { value: '' }, 'Bitte wählen …'), types.map((t) => h('option', { value: t, selected: draft.printerType === t }, t.toUpperCase()))),
        pid() === 'marketprint' ? h('div.hint', 'Laut MarketPrint werden für DTF Aufschläge berechnet.') : null));
    }
    const selVariants = details.variants.filter((v) => draft.variantIds.includes(v.id));

    const front = details.printAreas.find((a) => a.name === 'front');
    const back = details.printAreas.find((a) => a.name === 'back');
    const others = details.printAreas.filter((a) => a !== front && a !== back);
    const sides = inferSides();
    let shown = sides === 'both' ? [front, back] : sides === 'back' ? [back] : [front];
    shown = shown.filter(Boolean);
    if (!shown.length) shown = [front || back].filter(Boolean);

    // Ansicht: Vorderseite / Rückseite / Beidseitig
    if (front && back) {
      const choose = async (v) => {
        if (v === sides) return;
        const hide = v === 'front' ? ['back'] : v === 'back' ? ['front'] : [];
        const lose = draft.placements.filter((p) => hide.includes(p.printArea) && p.designId);
        if (lose.length && !(await confirmDialog({ title: 'Seite wechseln?', text: [`Das Motiv auf der ${lose.map((p) => AREA_LABEL[p.printArea]).join(' und ')} wird dabei entfernt – sonst würde es mitgedruckt.`], confirmLabel: 'Wechseln', danger: true }))) return;
        set({ printSides: v, placements: draft.placements.filter((p) => !hide.includes(p.printArea)) });
        renderPrint();
      };
      parts.push(h('div.side-switch', [['front', 'Vorderseite'], ['back', 'Rückseite'], ['both', 'Beidseitig']].map(([v, l]) => h(`button${sides === v ? '.on' : ''}`, { type: 'button', disabled: dis, onclick: () => choose(v) }, l))));
    }
    parts.push(h(`div.designer.cols-${shown.length}`, shown.map((area) => areaPanel(area, { dis, types, selVariants }))));
    if (others.length) {
      parts.push(h('details.box', { open: others.some((a) => draft.placements.some((p) => p.printArea === a.name && p.designId)) },
        h('summary', `Weitere Druckflächen (${others.map((a) => AREA_LABEL[a.name] || a.name).join(', ')})`),
        h('div.designer.cols-2', others.map((area) => areaPanel(area, { dis, types, selVariants })))));
    }
    const neck = neckPrintBox(dis);
    if (neck) parts.push(neck);
    clear(sec.print, parts);
  }

  function areaPanel(area, { dis, types, selVariants }) {
    let pl = draft.placements.find((p) => p.printArea === area.name);
    const ensure = () => { if (!pl) { pl = { printArea: area.name, designId: null, placement: { mode: 'auto' }, alternative: null }; draft.placements = [...draft.placements, pl]; } return pl; };
    const savePl = () => set({ placements: draft.placements.map((p) => (p.printArea === area.name ? pl : p)) });
    const design = pl?.designId ? designs.find((d) => d.id === pl.designId) : null;
    const alt = pl?.alternative?.designId ? designs.find((d) => d.id === pl.alternative.designId) : null;
    const notesBox = h('div');
    const dpiLine = h('div.dpi-line');
    const checkFile = async () => {
      if (!design) return clear(notesBox);
      try { clear(notesBox, fileNotes(await post(`/api/designs/${design.id}/check`, { printArea: area, placement: placementArg(pl), printerType: draft.printerType || types[0] }))); } catch (err) { clear(notesBox, h('div.inline-msg.error', err.message)); }
    };
    const showDpi = () => { const q = dpiInfo(pl?.placement, area, design); dpiLine.className = `dpi-line ${q?.rating || ''}`; dpiLine.textContent = q ? `DPI-Prüfung: ${dpiText(q)}` : ''; };
    const commit = (p) => { ensure(); pl.placement = fitToArea(p, area, design); savePl(); showDpi(); checkFile(); };
    const mode = pl?.placement?.mode || 'auto';
    const named = caps().namedPlacements || [];

    let placementBox = null;
    if (design) {
      const custom = () => (pl.placement?.mode === 'custom' ? pl.placement : fitToArea({ mode: 'custom', xPercent: 0.5, yPercent: 0.35, widthPercent: 0.6 }, area, design));
      const inputs = {};
      const num = (key, label) => {
        const inp = h('input', { type: 'number', min: 0, max: 100, step: 0.5, disabled: dis, value: (custom()[key] * 100).toFixed(1) });
        inputs[key] = inp;
        inp.addEventListener('change', () => {
          commit({ ...custom(), mode: 'custom', [key]: Math.min(1, Math.max(0, Number(inp.value) / 100)) });
          // begrenzte Werte (Motiv bleibt in der Druckfläche) sofort anzeigen – ohne Neuaufbau, damit der Fokus bleibt
          for (const [k, el] of Object.entries(inputs)) el.value = (pl.placement[k] * 100).toFixed(1);
        });
        return h('label.mini', h('span', label), inp, h('span.muted', '%'));
      };
      placementBox = h('div',
        h('div.field-label', 'Platzierung'),
        h('div.row', [['auto', 'Ganze Fläche (automatisch einpassen)'], ...(named.length ? [['named', 'Feste Logo-Position']] : []), ['custom', 'Eigene Position']].map(([m, l]) => h('label.check', h('input', { type: 'radio', name: `mode-${area.name}`, checked: mode === m, disabled: dis, onchange: () => { commit(m === 'named' ? { mode: 'named', named: pl?.placement?.named || named[0].v } : m === 'custom' ? custom() : { mode: 'auto' }); renderPrint(); } }), h('span', l)))),
        mode === 'named' ? h('select', { disabled: dis, onchange: (e) => commit({ mode: 'named', named: e.target.value }) }, named.map((n) => h('option', { value: n.v, selected: pl.placement.named === n.v }, n.l))) : null,
        mode === 'custom' ? h('div.readout', num('xPercent', 'Mitte X'), num('yPercent', 'Mitte Y'), num('widthPercent', 'Breite'),
          h('small.muted', 'Anteile der Druckfläche (0 % = links/oben, 100 % = rechts/unten). Das Motiv bleibt immer innerhalb der Druckfläche.')) : null,
        mode === 'auto' ? h('p.hint', 'Das Motiv wird so groß wie möglich eingepasst und zentriert – wie bei einem vollflächigen Druck.') : null,
        mode === 'named' ? h('p.hint', `Größe und Lage bestimmt ${PN()}. Für eine genaue Kontrolle das Produkt im ${PN()}-Designer ansehen.`) : null,
        dpiLine);
    }

    const altBox = h('div');
    if (caps().alternativeDesign && details.hasAlternativeDesign !== false && pl?.designId) {
      const colorHexes = [...new Map(selVariants.map((v) => [ckey(v), v.color])).entries()];
      clear(altBox, h('details.box', { open: Boolean(alt) }, h('summary', 'Alternativ-Motiv für bestimmte Farben (z. B. helle Version für dunkle Shirts)'),
        h('div.stack',
          h('div.row', alt ? h('span', alt.name) : h('span.muted', 'Kein Alternativ-Motiv'),
            h('button.small', { type: 'button', disabled: dis, onclick: async () => { const dId = await pickDesign(designs); if (!dId) return; ensure(); pl.alternative = { designId: dId, colors: pl.alternative?.colors || [] }; savePl(); designs = await get('/api/designs'); renderPrint(); } }, alt ? 'Ändern' : 'Wählen'),
            alt ? h('button.small.ghost', { type: 'button', disabled: dis, onclick: () => { pl.alternative = null; savePl(); renderPrint(); } }, 'Entfernen') : null),
          alt ? h('div', colorHexes.map(([hex, name]) => h('label.check', h('input', { type: 'checkbox', checked: pl.alternative.colors.includes(hex), disabled: dis, onchange: (e) => { const st = new Set(pl.alternative.colors); e.target.checked ? st.add(hex) : st.delete(hex); pl.alternative = { ...pl.alternative, colors: [...st] }; savePl(); } }), h('span', name)))) : null,
          h('p.hint', 'Position und Größe des Hauptmotivs werden übernommen; die Datei sollte gleiche Pixelmaße haben.'))));
    }
    showDpi();
    checkFile();
    return h('div.frame.area-panel',
      h('div.row.between', h('h3', { style: { margin: 0 } }, AREA_LABEL[area.name] || area.name), h('small.muted', `Druckfläche ${area.width} × ${area.height} px`)),
      maxSizeBox(area, design),
      h('div.row', { style: { margin: '10px 0' } },
        design ? h('img', { src: `/files/design/${design.id}/thumb`, alt: '', style: { width: '64px', height: '64px', objectFit: 'contain', background: '#fff1' } }) : null,
        h('div', { style: { flex: '1 1 140px' } }, design ? h('div', h('strong', design.name), h('div.muted', linkOf(design)?.imageId ? `${PN()} verknüpft` : `Noch nicht mit ${PN()} verknüpft`)) : h('span.muted', 'Kein Motiv auf dieser Seite')),
        h(`button.small${design ? '' : '.primary'}`, { type: 'button', disabled: dis, onclick: async () => { const dId = await pickDesign(designs); if (!dId) return; ensure(); pl.designId = dId; savePl(); designs = await get('/api/designs'); renderPrint(); } }, design ? 'Motiv ändern' : 'Motiv wählen'),
        design ? h('button.small.ghost', { type: 'button', disabled: dis, onclick: () => { draft.placements = draft.placements.filter((p) => p.printArea !== area.name); set({ placements: draft.placements }); renderPrint(); } }, 'Entfernen') : null,
        design && !linkOf(design)?.imageId ? h('a', { href: `#/bibliothek/${design.id}` }, 'Jetzt verknüpfen') : null),
      placementBox,
      altBox,
      design ? h('div', h('div.field-label', 'Prüfung der Druckdatei'), notesBox) : null);
  }

  // ---------- Eigene Bilder für die Produktseite (Mockups, Fotos) – per Anweisung an Claude eingeplant
  function renderImages() {
    const dis = locked();
    const imgs = draft.extraImages || [];
    const plan = draft.imagePlan;
    const instr = h('textarea', { rows: 3, disabled: dis, placeholder: 'Wie sollen die Bilder eingesetzt werden? z. B. „Bild 1 als Hauptbild vor den MarketPrint-Mockups, Bild 2 und 3 als Detailansichten ganz hinten.“' });
    instr.value = draft.imageInstruction || '';
    instr.addEventListener('input', () => set({ imageInstruction: instr.value }));
    const att = imageAttachments({ label: 'Bilder hinzufügen' });
    const addBtn = h('button.small.primary', { type: 'button', disabled: dis }, 'Hochladen');
    addBtn.addEventListener('click', () => busy(addBtn, async () => {
      const files = att.files();
      if (!files.length) return showError(userError('Bitte zuerst Bilder auswählen, hineinziehen oder einfügen.'));
      try {
        for (const f of files) {
          draft = await upload(`/api/upload?kind=product-image&product=${id}`, f);
          const img = draft.extraImages[draft.extraImages.length - 1];
          const prev = await shrinkImage(f, 1568, 'image/jpeg', 0.85);
          if (prev) draft = await upload(`/api/upload?kind=product-image-preview&product=${id}&img=${img.id}`, new File([prev], 'vorschau.jpg', { type: 'image/jpeg' }));
        }
        att.reset();
        renderStatus(); renderImages();
      } catch (err) { showError(err); }
    }));
    const box = h('div.stack', { style: { gap: '10px' } });
    const planFor = (imgId) => plan?.items?.find((x) => x.imageId === imgId);
    const savePlan = async (items) => { try { draft = await put(`/api/products/${id}/image-plan`, { items }); renderStatus(); renderImages(); } catch (err) { showError(err); } };
    const currentItems = () => imgs.map((im, n) => planFor(im.id) || { imageId: im.id, use: true, position: 'hinten', order: n + 1, alt: '' });
    const planBtn = h('button.primary', { type: 'button', disabled: dis || !imgs.length }, plan ? 'Plan mit Claude neu erstellen' : 'Mit Claude einplanen');
    planBtn.addEventListener('click', () => busy(planBtn, async () => {
      await saver.flush();
      const c = await confirmAiCall(`/api/products/${id}/image-plan/estimate`, {}, 'das Einplanen der Bilder');
      if (!c) return;
      try { draft = await post(`/api/products/${id}/image-plan`, { confirmPaid: c.confirmPaid }); toast('Plan erstellt – bitte prüfen. Hochgeladen wird erst nach deiner Freigabe.', 'ok'); renderStatus(); renderImages(); } catch (err) { showError(err); }
    }));
    clear(sec.images,
      h('p.muted', 'Eigene Mockups oder Fotos für die Shopify-Produktseite. Beschreibe, wie sie eingesetzt werden sollen – Claude plant Reihenfolge, Position (vor/hinter den Mockups des Druckdienstleisters) und Alternativtexte. Hochgeladen wird erst nach deiner Freigabe beim Veröffentlichen (Shopify-Admin-App nötig).'),
      dis ? null : h('div.frame.stack', att.el, h('div.row', addBtn)),
      imgs.length ? h('div.img-plan', imgs.map((im, n) => {
        const it = planFor(im.id) || { use: true, position: 'hinten', order: n + 1, alt: '' };
        const alt = h('input', { type: 'text', value: it.alt || '', disabled: dis, placeholder: 'Alternativtext (was ist zu sehen?)' });
        alt.addEventListener('change', () => savePlan(currentItems().map((x) => (x.imageId === im.id ? { ...x, alt: alt.value } : x))));
        return h(`div.img-card${it.use === false ? '.off' : ''}`,
          h('img', { src: `/files/product-image/${id}/${im.id}?preview=1`, alt: '' }),
          h('div.stack', { style: { gap: '6px', flex: '1 1 220px' } },
            h('div', h('strong', `Bild ${n + 1}`), h('small.muted', ` ${im.name} · ${im.width || '?'} × ${im.height || '?'} px`)),
            h('div.row',
              h('select', { disabled: dis, onchange: (e) => savePlan(currentItems().map((x) => (x.imageId === im.id ? { ...x, position: e.target.value, use: e.target.value !== 'aus' } : x)).map((x) => (x.position === 'aus' ? { ...x, position: 'hinten', use: false } : x))) },
                h('option', { value: 'vorne', selected: it.use !== false && it.position === 'vorne' }, 'Vorne (vor den Mockups)'),
                h('option', { value: 'hinten', selected: it.use !== false && it.position === 'hinten' }, 'Hinten (nach den Mockups)'),
                h('option', { value: 'aus', selected: it.use === false }, 'Nicht verwenden')),
              h('label.mini', h('span', 'Reihenfolge'), h('input', { type: 'number', min: 1, step: 1, value: it.order, disabled: dis, style: { width: '64px' }, onchange: (e) => savePlan(currentItems().map((x) => (x.imageId === im.id ? { ...x, order: Number(e.target.value) || 1 } : x))) }))),
            alt),
          dis ? null : h('button.small.ghost', { type: 'button', onclick: async () => { try { draft = await del(`/api/products/${id}/images/${im.id}`); renderStatus(); renderImages(); } catch (err) { showError(err); } } }, 'Entfernen'));
      })) : h('div.empty', 'Noch keine eigenen Bilder.'),
      imgs.length ? h('label.field', h('span', 'Anweisung für Claude'), instr) : null,
      imgs.length ? h('div.row', planBtn, plan?.summary ? h('small.muted', `Plan von ${plan.source === 'claude' ? 'Claude' : 'dir'} · ${fmtDate(plan.at)}`) : h('small.muted', 'Ohne Plan werden die Bilder in dieser Reihenfolge hinter den Mockups angefügt.')) : null,
      plan?.summary ? h('div.inline-msg.info', plan.summary) : null,
      (plan?.questions || []).map((q) => h('div.inline-msg.warn', q)),
      plan?.stale ? h('div.inline-msg.warn', 'Seit dem Plan sind Bilder dazugekommen – neue Bilder werden hinten angefügt, oder Plan neu erstellen.') : null);
  }

  /** Wie groß das Motiv auf dieser Fläche maximal sein darf (in cm). */
  function maxSizeBox(area, design) {
    const m = motifMaxCm(area, design);
    const sz = (o) => `${fmtCm(o.w)} × ${fmtCm(o.h)} cm`;
    return h('div.max-size',
      h('div', h('span.k', 'Motiv max.'), h('strong', sz(m.area)), h('small.muted', ' (Breite × Höhe der Druckfläche)')),
      m.fit ? h('div', h('span.k', 'Dieses Motiv'), h('strong', sz(m.fit)), h('small.muted', ' größtmöglich, Seitenverhältnis bleibt')) : null,
      m.good && m.good.w < m.fit.w - 0.05 ? h('div', h('span.k', 'In guter Qualität'), h('strong', sz(m.good)), h('small.muted', ' bis hier ab 200 DPI – größer wird „mittel“/„schlecht“')) : null);
  }

  function neckPrintBox(dis) {
    if (!details.hasNeckPrint) return null;
    if (!caps().neckPrint) return h('div.inline-msg.info', `Dieses Produkt hätte einen Nackendruck, ${PN()} bietet ihn über die Schnittstelle aber nicht an.`);
    const n = draft.neckPrint || {};
    const light = n.lightDesignId ? designs.find((d) => d.id === n.lightDesignId) : null;
    const dark = n.darkDesignId ? designs.find((d) => d.id === n.darkDesignId) : null;
    const saveNeck = async (patch) => {
      await saver.flush();
      const next = { lightDesignId: n.lightDesignId || null, darkDesignId: n.darkDesignId || null, ...patch };
      draft = await put(`/api/products/${id}`, { neckPrint: next.lightDesignId || next.darkDesignId ? next : null });
      designs = await get('/api/designs');
      renderStatus(); renderPrint();
    };
    const slot = (label, d, key, hint) => h('div.neck-slot',
      h('div.field-label', label),
      d ? h('img', { src: `/files/design/${d.id}/thumb`, alt: '' }) : h('div.neck-empty', 'Kein Motiv'),
      d ? h('small', d.name) : h('small.muted', hint),
      h('div.row',
        h('button.small', { type: 'button', disabled: dis, onclick: async () => { const dId = await pickDesign(designs); if (dId) saveNeck({ [key]: dId }).catch(showError); } }, d ? 'Ändern' : 'Wählen'),
        d ? h('button.small.ghost', { type: 'button', disabled: dis, onclick: () => saveNeck({ [key]: null }).catch(showError) }, 'Entfernen') : null));
    const uploadBtn = h('button.small.primary', { type: 'button', disabled: dis || !light }, n.neckPrintId ? 'Erneut hochladen' : 'Nackendruck hochladen');
    uploadBtn.addEventListener('click', () => busy(uploadBtn, async () => {
      await saver.flush();
      try { draft = await post(`/api/products/${id}/neckprint`); toast('Nackendruck hochgeladen. Im Shop wurde noch nichts angelegt.', 'ok'); renderStatus(); renderPrint(); } catch (err) { showError(err); }
    }));
    return h('div.frame', { style: { marginTop: '16px' } },
      h('div.row.between', h('h3', { style: { margin: 0 } }, 'Nackendruck (Innenkragen)'), n.neckPrintId ? h('small', { style: { color: 'var(--ok)' } }, `hochgeladen${n.simulated ? ' (Simulation)' : ''} · ${fmtDate(n.uploadedAt)}`) : light ? h('small', { style: { color: 'var(--warn)' } }, 'noch nicht hochgeladen') : h('small.muted', 'optional')),
      h('p.muted', `Ein eigenes Etikett innen im Nacken, z. B. Logo und Größe. ${PN()} berechnet dafür laut Schnittstelle einen Aufschlag pro Bestellung. Lage und Größe legt ${PN()} fest.`),
      h('div.neck-grid', slot('Für helle Textilien (Pflicht)', light, 'lightDesignId', 'z. B. dunkles Logo'), slot('Für dunkle Textilien (optional)', dark, 'darkDesignId', 'z. B. helles Logo')),
      h('div.row', { style: { marginTop: '10px' } }, uploadBtn,
        h('small.muted', pid() === 'marketprint' ? 'Hochladen legt nichts im Shop an. Über Claude Code sind nur kleine Dateien möglich (zusammen unter ca. 100 KB).' : '')));
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
        h('p.hint', `Claude übernimmt Produktdaten ausschließlich aus dem ${PN()}-Text und erfindet nichts hinzu. Das Ergebnis siehst du vor der Übernahme.`)),
      h('div',
        h('label.field', h('span', 'Produktbeschreibung (HTML)'), desc, h('div.hint', `Leer lassen = ${PN()}-Standardtext wird verwendet.`)),
        h('div.field-label', 'Vorschau'), prev)));
  }

  // ---------- 5 Preis & Shop
  async function renderPrice() {
    const dis = locked();
    const selVariants = details ? details.variants.filter((v) => draft.variantIds.includes(v.id)) : [];
    const cat = selVariants.map((v) => v.price).filter((x) => x !== null && x !== undefined).map(Number);
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
        h('label.field', h('span', 'Verkaufspreis (€, für alle Varianten)'), price, h('div.hint', max !== null ? `${details?.priceLabel || 'Katalogpreis'}: ${fmtEuro(min)} – ${fmtEuro(max)}` : details && selVariants.length ? `${PN()} nennt den Einkaufspreis erst beim Anlegen.` : 'Katalogpreis erscheint nach Variantenwahl.')),
        marginBox,
        caps().mockupChoice ? [
          h('div.field-label', 'Produktbilder (Mockups)'),
          h('label.check', h('input', { type: 'radio', name: 'mockups', checked: draft.mockups === 'withDesign', disabled: dis, onchange: () => set({ mockups: 'withDesign' }) }), h('span', `Nur Mockups, die das Motiv zeigen (Empfehlung von ${PN()})`)),
          h('label.check', h('input', { type: 'radio', name: 'mockups', checked: draft.mockups === 'all', disabled: dis, onchange: () => set({ mockups: 'all' }) }), h('span', 'Alle Mockups (auch Ansichten ohne Motiv)'))]
          : h('p.hint', `Produktbilder (Mockups) erzeugt ${PN()} selbst.${caps().realMockups ? ' Mit „Echte Mockups erzeugen“ siehst du sie schon vor dem Veröffentlichen.' : ''}`)),
      h('div',
        h('div.field-label', 'Zielshop'), shopsBox,
        h('div.field-label', { style: { marginTop: '16px' } }, 'Kollektionen (Shopify)'), colBox,
        h('div.field-label', { style: { marginTop: '16px' } }, 'Tags (Shopify)'), tagInput, tagChips,
        h('p.hint', caps().tags ? `Tags überträgt ${PN()} selbst. Kollektionen setzt APOLOGEA Studio nach dem Anlegen über die Shopify-Admin-App.` : `Kollektionen und Tags setzt APOLOGEA Studio nach dem Anlegen über die Shopify-Admin-App. ${PN()} selbst unterstützt sie nicht.`))));
    try {
      account ||= await get(`/api/providers/${pid()}/account`);
      const allowedShops = prov().allowedShops || [];
      const single = pid() !== 'marketprint';
      clear(shopsBox, account.targets.length ? account.targets.map((t) => {
        const ok = allowedShops.includes(t.id);
        return h('label.check', h('input', { type: single ? 'radio' : 'checkbox', name: 'target', checked: ok && draft.targetShops.includes(t.id), disabled: dis || !ok, onchange: (e) => { if (single) return set({ targetShops: [t.id] }); const set2 = new Set(draft.targetShops); e.target.checked ? set2.add(t.id) : set2.delete(t.id); set({ targetShops: [...set2] }); } }),
          h('span', t.label, ok ? h('small.muted', ' (freigegeben)') : h('small', { style: { color: 'var(--warn)' } }, ' – nicht als Zielshop freigegeben'), t.note ? h('div.muted', { style: { fontSize: '.8rem' } }, t.note) : null));
      }) : h('div.inline-msg.warn', `In deinem ${PN()}-Konto ist kein Shop verbunden.`));
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
        h('h2', r.simulated ? 'Simulation abgeschlossen' : draft.status === 'Erfolgreich' ? `Produkt wurde von ${PN()} angelegt` : 'Ergebnis prüfen'),
        h('p', `Abgeschlossen am ${fmtDate(pub.finishedAt || pub.reconciledAt)}.`),
        r.remoteId || r.marketprint?.draftId ? h('p', `${PN()}-ID: ${r.remoteId || r.marketprint.draftId}`) : null,
        r.message ? h('p.muted', r.message) : null,
        r.postSteps ? h(`div.inline-msg.${r.postSteps.ok ? 'ok' : 'warn'}`, r.postSteps.message) : null,
        h('div.row', (r.links || []).map((l) => extLink(l.label, l.url))),
        (r.listingImages || r.marketprint?.listingImages || []).length ? h('div.grid.cards', (r.listingImages || r.marketprint.listingImages).slice(0, 8).map((u) => h('div.card', h('div.thumb', h('img', { src: typeof u === 'string' ? u : u.url, alt: 'Mockup' }))))) : null,
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
          h('button', { type: 'button', onclick: async () => { if (await confirmDialog({ title: 'Produkt ist vorhanden?', text: `Du hast das Produkt in Shopify bzw. bei ${PN()} gefunden.` })) { await post(`/api/products/${id}/reconcile`, { action: 'confirm-exists' }).catch(showError); reload(); } } }, 'Produkt ist vorhanden'),
          h('button.danger', { type: 'button', onclick: async () => { if (await confirmDialog({ title: 'Produkt fehlt sicher?', text: `Nur bestätigen, wenn du in Shopify UND bei ${PN()} nachgesehen hast. Danach ist ein erneuter Versuch möglich.`, danger: true })) { await post(`/api/products/${id}/reconcile`, { action: 'confirm-missing' }).catch(showError); reload(); } } }, 'Produkt fehlt – erneuten Versuch erlauben'))));
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
    clear(simBanner, draft.publish?.result?.simulated ? h('div.sim-banner', `Dieser Entwurf wurde nur im Simulationsmodus „veröffentlicht“. Bei ${PN()} wurde nichts angelegt.`) : null);
    renderResult(); renderBase(); renderVariants(); renderPrint(); renderTexts(); renderImages(); renderPrice(); renderCheck();
    for (const b of actionButtons) b.disabled = locked() && !b.dataset.always;
    mockupBtn.classList.toggle('hidden', !caps().realMockups);
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
  const mockupBtn = btn('Echte Mockups erzeugen', async () => {
    await saver.flush();
    const ok = await confirmDialog({ title: `Echte Mockups bei ${PN()} erzeugen?`, text: pid() === 'printify'
      ? ['Dafür wird das Produkt als ENTWURF in deinem Printify-Konto angelegt bzw. aktualisiert. Im Shop ist es dadurch noch NICHT sichtbar.', 'Veröffentlicht wird erst mit „Jetzt veröffentlichen“.']
      : [`${PN()} erzeugt Mockup-Bilder. Im Shop wird dadurch nichts angelegt.`], confirmLabel: 'Mockups erzeugen' });
    if (!ok) return;
    try {
      const r = await post(`/api/products/${id}/mockups`);
      draft = await get(`/api/products/${id}`);
      await showMockups(r.images);
    } catch (err) { showError(err); }
  });
  async function showMockups(images) {
    await modal({ eyebrow: `Echte Mockups von ${PN()}`, title: draft.publicTitle || 'Mockups', wide: true,
      body: images?.length ? h('div.grid.cards', images.map((m) => h('div.card', h('div.thumb', h('img', { src: m.url, alt: 'Mockup' })), m.position ? h('small.muted', m.position) : null))) : h('div.empty', 'Keine Mockups erhalten.'),
      actions: [{ label: 'Schließen', value: true }] });
  }
  const reviewBtn = btn('Zur Veröffentlichung prüfen', async () => { await saver.flush(); await reviewAndPublish(); }, { primary: true });
  const actionButtons = [validateBtn, saveBtn, templateBtn, dupBtn, previewBtn, mockupBtn, reviewBtn];

  async function showPreview() {
    if (!details) return showError(userError('Zuerst ein Grundprodukt wählen.'));
    const selVariants = details.variants.filter((v) => draft.variantIds.includes(v.id));
    const canvases = (draft.placements || []).filter((p) => p.designId).map((pl) => {
      const area = details.printAreas.find((a) => a.name === pl.printArea);
      const d = designs.find((x) => x.id === pl.designId);
      const q = dpiInfo(pl.placement, area, d);
      const where = pl.placement?.mode === 'custom' ? `Mitte ${Math.round(pl.placement.xPercent * 100)} % / ${Math.round(pl.placement.yPercent * 100)} %, Breite ${Math.round(pl.placement.widthPercent * 100)} %` : pl.placement?.mode === 'named' ? (caps().namedPlacements || []).find((n) => n.v === pl.placement.named)?.l || pl.placement.named : 'Ganze Fläche';
      return h('div.card', h('div.field-label', AREA_LABEL[area.name] || area.name), h('div.thumb', h('img', { src: `/files/design/${d.id}/thumb`, alt: '' })), h('div', d.name), h('small.muted', where), q ? h(`div.dpi-line.${q.rating || ''}`, dpiText(q)) : null);
    });
    await modal({
      eyebrow: 'Vorschau – nicht verbindlich', title: draft.publicTitle || 'Produktvorschau', wide: true,
      body: h('div.stack',
        h('div.inline-msg.info', `Übersicht deiner Angaben. Verbindliche Mockups erzeugt ${PN()}${caps().realMockups ? ' (Schaltfläche „Echte Mockups erzeugen“)' : ' beim Anlegen des Produkts'}.`),
        h('div.grid.cols-3', canvases),
        h('dl.kv', h('dt', 'Grundprodukt'), h('dd', draft.baseProduct?.title || '–'), h('dt', 'Varianten'), h('dd', `${selVariants.length}`), h('dt', 'Preis'), h('dd', fmtEuro(draft.price))),
        draft.mockupImages?.images?.length ? [h('div.field-label', `Echte Mockups von ${PN()} (${fmtDate(draft.mockupImages.at)})`), h('div.grid.cards', draft.mockupImages.images.slice(0, 8).map((m) => h('div.card', h('div.thumb', h('img', { src: m.url, alt: 'Mockup' })))))] : null,
        h('div.field-label', 'Beschreibung'), htmlPreview(draft.description || `<p><em>(${PN()}-Standardtext)</em></p>`)),
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
        s.simulated ? h('div.sim-banner', `Simulationsmodus: Es wird nichts bei ${s.provider} oder Shopify angelegt.`) : null,
        h('dl.kv',
          h('dt', 'Zielshop'), h('dd', h('strong', s.shops.join(', '))),
          h('dt', 'Produkt'), h('dd', h('strong', s.title), h('div.muted', `intern: ${s.internalName}`)),
          h('dt', 'Grundprodukt'), h('dd', `${s.baseProduct} · Druck: ${String(s.printerType).toUpperCase()}`),
          h('dt', 'Varianten'), h('dd', `${s.variantCount} Varianten`, s.variants.map((v) => h('div', h('span', { style: { display: 'inline-block', width: '12px', height: '12px', background: v.hex, border: '1px solid #fff4', marginRight: '6px' } }), `${v.color}: ${v.sizes.join(', ')}`))),
          h('dt', 'Verkaufspreis'), h('dd', h('strong', fmtEuro(s.price)), h('div.muted', s.catalogueMin !== null ? `${s.priceLabel || 'Katalogpreis'}: ${fmtEuro(s.catalogueMin)} – ${fmtEuro(s.catalogueMax)}` : (s.priceLabel || ''))),
          h('dt', 'Dateien'), h('dd', s.files.map((f) => h('div', `${f.printArea}: ${f.design} (${f.file}) · ${f.placement}${f.dpi ? ` · ca. ${f.dpi.dpi} DPI (${f.dpi.rating})` : ''}`, f.alternative ? h('div.muted', `Alternativ: ${f.alternative.design} für ${f.alternative.colors.length} Farbe(n)`) : null))),
          s.images?.length ? [h('dt', 'Eigene Bilder'), h('dd', s.images.map((i, n) => h('div', `${n + 1}. ${i.name} · ${i.position === 'vorne' ? 'vorne' : 'hinten'}${i.alt ? ` · „${i.alt}“` : ''}`)))] : null,
          s.neckPrint ? [h('dt', 'Nackendruck'), h('dd', `${s.neckPrint.light}${s.neckPrint.dark ? ` (dunkle Textilien: ${s.neckPrint.dark})` : ''}`)] : null,
          h('dt', 'Anbieter'), h('dd', s.provider),
          h('dt', 'Produktbilder'), h('dd', s.mockups),
          s.tags?.length ? [h('dt', 'Tags'), h('dd', s.tags.join(', '))] : null,
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
      toast(res.result.simulated ? 'Simulation abgeschlossen – nichts wurde angelegt.' : (res.status === 'Erfolgreich' ? `${PN()} hat das Anlegen bestätigt.` : (res.result.message || 'Bitte Ergebnis prüfen.')), 'ok', 9000);
    } catch (err) { showError(err); }
    await reload();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const steps = [
    ['step-base', 'Grundprodukt', sec.base],
    ['step-variants', 'Farben & Größen', sec.variants],
    ['step-print', 'Druck & Motive', sec.print],
    ['step-texts', 'Namen & Texte', sec.texts],
    ['step-images', 'Eigene Bilder (Mockups, Fotos)', sec.images],
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
