import { h, clear, get, post, put, del, upload, badge, fmtDate, fmtUsd, showError, toast, modal, confirmDialog, autosaver, busy, dropzone, shrinkImage, extLink, ornament, userError } from '../core.js';
import { confirmAiCall, renderDiff, htmlPreview } from './shared.js';
import { setCleanup } from '../app.js';

const EXAMPLES = [
  'Ändere die Überschrift auf der Startseite in „Licht in der Dunkelheit“.',
  'Tausche das Bild im Hero-Bereich der Startseite gegen das angehängte Bild aus.',
  'Erstelle eine Landingpage für die Winterkollektion mit dem angehängten Bild und einem kurzen Einleitungstext.',
  'Passe die Akzentfarbe des Themes an ein etwas wärmeres Gold an.',
  'Füge die Produkte „…“ und „…“ zur Kollektion „…“ hinzu.',
];

export async function renderWebsiteList(main) {
  const drafts = await get('/api/website/drafts');
  clear(main,
    h('div.page-head', h('div', h('div.eyebrow', 'Website bearbeiten'), h('h1', 'Änderungen & Verlauf')),
      h('div.actions', h('a.btn', { href: '#/website' }, 'Zum Website-Editor'), h('button.primary', { type: 'button', onclick: create }, '+ Neue Änderung'))),
    h('p.muted', 'Hier beschreibst du Änderungen an deinem bestehenden Shop. Claude erstellt daraus einen konkreten Vorschlag. Du siehst Vorschau und Änderungsübersicht und gibst ausdrücklich frei. Erst dann wird etwas im Shop geändert.'),
    drafts.length ? h('div.table-wrap', h('table.list',
      h('thead', h('tr', h('th', 'Titel'), h('th', 'Status'), h('th', 'Zuletzt geändert'))),
      h('tbody', drafts.map((d) => {
        const tr = h('tr.click', h('td', d.title, h('div.muted', (d.request || '').slice(0, 120))), h('td', badge(d.status)), h('td.muted', fmtDate(d.updatedAt)));
        tr.addEventListener('click', () => { location.hash = `#/website/${d.id}`; });
        return tr;
      })))) : h('div.empty', 'Noch keine Website-Änderungen. Starte mit „Neue Änderung“.'));
}

async function create() {
  try { const d = await post('/api/website/drafts', {}); location.hash = `#/website/${d.id}`; } catch (err) { showError(err); }
}

export async function renderWebsiteDraft(main, id, query = {}) {
  let draft = await get(`/api/website/drafts/${id}`);
  const saved = h('span.saved', 'Gespeichert');
  const saver = autosaver((data) => put(`/api/website/drafts/${id}`, data).then((d) => { draft = d; renderProposal(); renderStatus(); }), saved);
  setCleanup(() => saver.flush());

  const statusBox = h('span');
  const areaSelect = h('select', { 'aria-label': 'Bereich' }, h('option', { value: draft.areaKey }, 'Bereiche werden geladen …'));
  const areaMsg = h('div');
  const titleInput = h('input', { type: 'text', value: draft.title, oninput: () => saver.schedule({ title: titleInput.value }) });
  const request = h('textarea.big', { placeholder: 'Beschreibe in normaler Sprache, was geändert werden soll …', oninput: () => saver.schedule({ request: request.value }) });
  request.value = draft.request || '';
  const attBox = h('div.attachments');
  const proposalBox = h('div');
  const locked = () => ['running', 'unknown', 'done'].includes(draft.apply?.state);

  function renderStatus() {
    clear(statusBox, badge(draft.status));
    const lock = locked();
    for (const el of [titleInput, request, areaSelect]) el.disabled = lock;
  }

  function renderAttachments() {
    clear(attBox, draft.attachments.map((a) => h('div.att',
      /^image\//.test(a.mime) ? h('img', { src: `/files/website/${id}/${a.id}${a.preview ? '?preview=1' : ''}`, alt: a.name }) : h('div', { style: { height: '90px', display: 'grid', placeItems: 'center' } }, 'PDF'),
      h('div.n', { title: a.name }, a.name),
      h('div.row', { style: { padding: '0 6px 6px' } }, h('small.muted', a.id), locked() ? null : h('button.small.ghost', { type: 'button', onclick: async () => { draft = await del(`/api/website/drafts/${id}/attachments/${a.id}`); renderAttachments(); } }, 'Entfernen')))));
  }

  async function onFiles(files) {
    for (const f of files) {
      try {
        draft = await upload(`/api/upload?kind=website&draft=${id}`, f);
        const att = draft.attachments[draft.attachments.length - 1];
        if (/^image\/(png|jpeg|webp|gif)$/.test(f.type)) {
          const prev = await shrinkImage(f, 1568, 'image/jpeg', 0.85);
          if (prev) draft = await upload(`/api/upload?kind=website-preview&draft=${id}&att=${att.id}`, new File([prev], 'vorschau.jpg', { type: 'image/jpeg' }));
        }
        toast(`${f.name} hinzugefügt`, 'ok');
      } catch (err) { showError(err); }
    }
    renderAttachments();
  }

  const proposeBtn = h('button.primary', { type: 'button' }, 'Vorschlag mit Claude erstellen');
  proposeBtn.addEventListener('click', () => busy(proposeBtn, async () => {
    await saver.flush();
    if (!draft.request.trim()) return showError(userError('Bitte zuerst beschreiben, was geändert werden soll.'));
    const c = await confirmAiCall(`/api/website/drafts/${id}/estimate`, {}, 'diesen Änderungsvorschlag');
    if (!c) return;
    try {
      draft = await post(`/api/website/drafts/${id}/propose`, { confirmPaid: c.confirmPaid });
      toast('Vorschlag erstellt. Es wurde noch nichts im Shop geändert.', 'ok');
    } catch (err) { showError(err); }
    renderProposal(); renderStatus();
  }));

  function renderProposal() {
    const p = draft.proposal;
    if (!p) { clear(proposalBox, h('div.empty', 'Noch kein Vorschlag. Beschreibe deinen Wunsch und klicke auf „Vorschlag mit Claude erstellen“.')); return; }
    const parts = [];
    if (p.stale) parts.push(h('div.inline-msg.warn', 'Du hast den Auftrag nach diesem Vorschlag geändert. Bitte einen neuen Vorschlag erstellen.'));
    parts.push(h('div.frame.stack',
      h('div.eyebrow', `Vorschlag vom ${fmtDate(p.at)}${p.cost?.usd != null ? ' · Kosten ' + fmtUsd(p.cost.usd) : p.cost?.engine === 'claude-code' ? ' · über Claude Code' : ''}`),
      p.manual ? null : [h('h3', 'So hat Claude deinen Wunsch verstanden'), h('p', p.understood)],
      h('h3', 'Geplante Änderung'), h('p', { style: { whiteSpace: 'pre-line' } }, p.summary),
      p.blocking.length ? h('div', p.blocking.map((b) => h('div.inline-msg.error', b))) : null,
      p.warnings.length ? h('div', p.warnings.map((b) => h('div.inline-msg.warn', b))) : null,
      p.questions.length ? h('div', h('h4', 'Rückfragen von Claude'), p.questions.map((q) => h('div.inline-msg.info', q)), h('p.hint', 'Ergänze die Antworten im Auftragstext und erstelle einen neuen Vorschlag.')) : null));
    if (p.themeFiles.length) {
      parts.push(h('h3', { style: { marginTop: '24px' } }, `Theme-Dateien (${p.liveThemeName}, veröffentlicht)`));
      for (const f of p.themeFiles) {
        parts.push(h('details.box', h('summary', h('strong', f.filename), f.isNew ? h('span.badge', 'neu') : h('small.muted', `${f.changedLines} geänderte Zeilen`)),
          h('div', h('p.muted', f.explanation), h('div.field-label', 'Vorher → Nachher'), renderDiff(f.diff))));
      }
    }
    for (const o of p.contentOps) {
      if (o.op === 'page_update') {
        parts.push(h('details.box', { open: true }, h('summary', h('strong', `Seite „${o.before.title}“ ändern`)),
          h('div', h('p.muted', o.explanation), h('div.grid.cols-2', h('div', h('div.field-label', 'Vorher'), htmlPreview(o.before.body)), h('div', h('div.field-label', 'Nachher'), htmlPreview(o.after.body))), h('div.field-label', 'Unterschiede im Quelltext'), renderDiff(o.diff))));
      } else if (o.op === 'page_create') {
        parts.push(h('details.box', { open: true }, h('summary', h('strong', `Neue Seite „${o.title}“ (unveröffentlicht)`)), h('div', h('p.muted', o.explanation), o.templateSuffix ? h('p', `Vorlage: page.${o.templateSuffix}`) : null, htmlPreview(o.body))));
      } else if (o.op === 'collection_add_products') {
        parts.push(h('details.box', { open: true }, h('summary', h('strong', `Kollektion „${o.collectionTitle}“: Produkte hinzufügen`)), h('div', h('p.muted', o.explanation), h('ul', o.products.map((x) => h('li', x.title, x.alreadyIn ? h('small.muted', ' (bereits enthalten)') : null))))));
      }
    }
    if (p.uploads.length) parts.push(h('div.inline-msg.info', 'Bilder, die übertragen werden: ' + p.uploads.map((u) => `${u.attachmentName} → ${u.target === 'theme_asset' ? u.filename : 'Shopify-Dateien'}`).join(' · ')));

    // Vorschau
    const prev = draft.preview;
    const previewRow = h('div.row', { style: { marginTop: '16px' } });
    if (p.themeFiles.length && !p.blocking.length) {
      const prevBtn = h('button', { type: 'button', disabled: locked() }, prev?.url ? 'Vorschau aktualisieren' : 'Vorschau erzeugen');
      prevBtn.addEventListener('click', () => busy(prevBtn, async () => {
        try { const r = await post(`/api/website/drafts/${id}/preview`); draft = await get(`/api/website/drafts/${id}`); toast(r.note || 'Vorschau ist bereit (unveröffentlichtes Theme).', 'ok'); renderProposal(); } catch (err) { showError(err); }
      }));
      previewRow.append(prevBtn);
      if (prev?.themeId) previewRow.append(h('a.btn.small', { href: `#/website?theme=${String(prev.themeId).replace(/\D/g, '')}` }, 'Im Programm ansehen'));
      if (prev?.url) previewRow.append(extLink('Vorschau im Browser öffnen', prev.url), extLink('Im Theme-Editor öffnen', prev.editorUrl));
      if (prev?.url && prev.proposalAt !== p.at) previewRow.append(h('small.muted', 'Vorschau gehört zu einem älteren Vorschlag.'));
      if (prev?.themeId) previewRow.append(h('button.small.danger', { type: 'button', onclick: removePreview }, 'Vorschau-Theme löschen'));
      parts.push(h('div.inline-msg.info', 'Die Vorschau ist eine Kopie deines veröffentlichten Themes mit den Änderungen. Sie ist für Besucher nicht sichtbar. Für die Vorschau-Adresse musst du im Shopify-Admin angemeldet sein.'), previewRow);
    } else if (p.contentOps.length && !p.themeFiles.length) {
      parts.push(h('div.inline-msg.info', 'Für Änderungen an Shop-Inhalten (Seiten, Kollektionen) bietet Shopify keine Vorschau. Die Vorher-nachher-Ansicht oben zeigt genau, was geändert wird.'));
    }

    // Freigabe
    const actionsRow = h('div.sticky-bar');
    if (draft.apply?.state === 'done') {
      actionsRow.append(h('div', badge(draft.status), ' Änderung übernommen am ', fmtDate(draft.apply.finishedAt || draft.apply.checkedAt)));
    } else if (['unknown', 'running'].includes(draft.apply?.state)) {
      const chk = h('button.primary', { type: 'button' }, 'Ergebnis prüfen');
      chk.addEventListener('click', () => busy(chk, async () => {
        try { const r = await post(`/api/website/drafts/${id}/check`); draft = await get(`/api/website/drafts/${id}`); toast(r.all ? 'Alle Änderungen sind im Shop vorhanden.' : r.none ? 'Keine der Änderungen ist im Shop – du kannst erneut freigeben.' : 'Teilweise übernommen – Details in der Übersicht.', r.all ? 'ok' : 'error'); renderProposal(); renderStatus(); } catch (err) { showError(err); }
      }));
      actionsRow.append(h('div.inline-msg.warn', 'Das Ergebnis ist unklar. Bitte zuerst den tatsächlichen Stand prüfen.'), chk);
    } else {
      const reviewBtn = h('button.primary', { type: 'button', disabled: Boolean(p.blocking.length || p.stale) }, 'Änderung prüfen & freigeben');
      reviewBtn.addEventListener('click', () => busy(reviewBtn, () => reviewAndApply()));
      actionsRow.append(h('span.muted', p.blocking.length ? 'Offene Probleme verhindern die Freigabe.' : 'Noch nichts geändert.'), reviewBtn);
    }
    parts.push(actionsRow);

    if (draft.apply?.results) {
      const r = draft.apply.results;
      parts.push(h('div.frame', { style: { marginTop: '24px' } }, h('h3', 'Ergebnis (von Shopify gelesen)'),
        h('ul', [...r.files.map((f) => h('li', `${f.filename}: `, f.confirmed ? h('span', { style: { color: 'var(--ok)' } }, 'bestätigt') : h('span', { style: { color: 'var(--warn)' } }, 'nicht bestätigt'))),
          ...r.ops.map((o) => h('li', `${o.label}: `, o.confirmed ? h('span', { style: { color: 'var(--ok)' } }, 'bestätigt') : h('span', { style: { color: 'var(--warn)' } }, 'nicht bestätigt')))]),
        h('div.row', (r.links || []).map((l) => extLink(l.label, l.url)))));
    }
    if (draft.backups?.length) {
      parts.push(ornament(), h('h3', 'Sicherungen'), h('div.table-wrap', h('table.list', h('tbody', draft.backups.map((b) => h('tr',
        h('td', fmtDate(b.at)), h('td', `${b.files.length} Datei(en), ${b.pages.length} Seite(n)`, b.newFiles.length ? h('div.muted', `Neu angelegt: ${b.newFiles.join(', ')}`) : null),
        h('td', h('button.small', { type: 'button', onclick: () => restore(b) }, 'Wiederherstellen'))))))));
    }
    clear(proposalBox, parts);
  }

  async function reviewAndApply() {
    await saver.flush();
    let r;
    try { r = await post(`/api/website/drafts/${id}/review`); } catch (err) { return showError(err); }
    draft = await get(`/api/website/drafts/${id}`);
    renderStatus();
    const s = r.summary;
    const ok = await modal({
      eyebrow: 'Freigabe erforderlich', title: 'Änderungsübersicht', wide: true,
      body: h('div.stack',
        h('dl.kv',
          h('dt', 'Shop'), h('dd', s.shop),
          s.theme ? [h('dt', 'Theme'), h('dd', s.theme)] : null,
          h('dt', 'Bereich'), h('dd', s.area),
          h('dt', 'Änderung'), h('dd', s.summary),
          s.files.length ? [h('dt', 'Dateien'), h('dd', s.files.map((f) => h('div', `${f.filename} ${f.isNew ? '(neu)' : `(${f.changedLines} Zeilen)`}`)))] : null,
          s.contentOps.length ? [h('dt', 'Shop-Inhalte'), h('dd', s.contentOps.map((x) => h('div', x)))] : null,
          s.uploads.length ? [h('dt', 'Verwendete Dateien'), h('dd', s.uploads.map((x) => h('div', x)))] : null,
          h('dt', 'Vorschau'), h('dd', s.files.length ? (s.previewChecked ? 'Vorschau zu diesem Vorschlag wurde erzeugt.' : 'Keine aktuelle Vorschau erzeugt.') : 'Nicht verfügbar (Shop-Inhalte)')),
        h('h4', 'Erwartete Auswirkung'), s.effect.map((e) => h('div.inline-msg.info', e)),
        s.warnings.map((w) => h('div.inline-msg.warn', w))),
      actions: [{ label: 'Abbrechen', value: false }, { label: 'Änderung übernehmen', value: true, primary: true }],
    });
    if (!ok) return;
    try {
      const res = await post(`/api/website/drafts/${id}/apply`, { approvalHash: r.approvalHash });
      toast(res.status === 'Erfolgreich' ? 'Änderung übernommen und von Shopify bestätigt.' : 'Ausgeführt – bitte Ergebnis prüfen.', res.status === 'Erfolgreich' ? 'ok' : 'error', 9000);
    } catch (err) { showError(err); }
    draft = await get(`/api/website/drafts/${id}`);
    renderProposal(); renderStatus();
  }

  async function restore(b) {
    const ok = await confirmDialog({ title: 'Sicherung wiederherstellen?', text: [`Die Sicherung vom ${fmtDate(b.at)} wird in den Shop zurückgeschrieben. ${b.files.length} Theme-Datei(en) und ${b.pages.length} Seite(n) werden auf den damaligen Stand gesetzt.`, 'Neu angelegte Dateien und Seiten werden nicht gelöscht.'], confirmLabel: 'Wiederherstellen' });
    if (!ok) return;
    try { await post(`/api/website/drafts/${id}/restore`, { backupId: b.id, confirm: true }); toast('Wiederhergestellt.', 'ok'); } catch (err) { showError(err); }
    draft = await get(`/api/website/drafts/${id}`);
    renderProposal(); renderStatus();
  }

  async function removePreview() {
    const ok = await confirmDialog({ title: 'Vorschau-Theme löschen?', text: `Das unveröffentlichte Theme „${draft.preview.name}“ wurde von APOLOGEA Studio angelegt und wird gelöscht. Dein veröffentlichtes Theme bleibt unberührt.`, confirmLabel: 'Löschen', danger: true });
    if (!ok) return;
    try { await post(`/api/website/drafts/${id}/remove-preview`, { confirm: true }); draft = await get(`/api/website/drafts/${id}`); renderProposal(); } catch (err) { showError(err); }
  }

  async function deleteDraft() {
    const ok = await confirmDialog({ title: 'Entwurf löschen?', text: 'Der Entwurf wird aus APOLOGEA Studio entfernt. Im Shop wird dadurch nichts geändert.', confirmLabel: 'Löschen', danger: true });
    if (!ok) return;
    try { await del(`/api/website/drafts/${id}?confirm=1`); location.hash = draft.manual ? '#/website' : '#/website/liste'; } catch (err) { showError(err); }
  }

  const manualEdits = Object.values(draft.manual?.edits || {});
  const formPart = draft.manual
    ? h('div.frame.stack',
      h('h3', 'Deine Änderungen aus dem Website-Editor'),
      manualEdits.length ? h('ul', manualEdits.map((e) => h('li', e.label || e.setting))) : h('p.muted', 'Keine Änderungen vorgemerkt.'),
      h('div.row', h('a.btn.small', { href: '#/website' }, 'Weiter im Website-Editor bearbeiten')),
      h('p.hint', 'Im Shop ist noch nichts geändert. Unten: Vorschau erzeugen, prüfen und freigeben.'))
    : null;
  clear(main,
    h('div.page-head',
      h('div', h('div.eyebrow', 'Website bearbeiten'), h('h1', draft.title || 'Website-Änderung')),
      h('div.actions', statusBox, saved, h('button.small.danger', { type: 'button', onclick: deleteDraft }, 'Entwurf löschen'))),
    formPart || h('div.grid.cols-2',
      h('div',
        h('label.field', h('span', 'Titel'), titleInput),
        h('label.field', h('span', 'Betroffene Seite bzw. Bereich'), areaSelect, areaMsg),
        h('label.field', h('span', 'Was möchtest du ändern?'), request),
        h('details.box', h('summary', 'Beispiele'), h('div', EXAMPLES.map((e) => h('div', h('button.small.ghost', { type: 'button', style: { textTransform: 'none', letterSpacing: 0 }, onclick: () => { request.value = e; saver.schedule({ request: e }); } }, e)))))),
      h('div',
        h('div.field-label', 'Bilder, Logos, Referenzen'),
        dropzone({ accept: 'image/*,application/pdf', label: 'Dateien hierher ziehen oder klicken (PNG, JPEG, WebP, SVG, PDF)', onFiles }),
        attBox,
        h('div', { style: { marginTop: '20px' } }, proposeBtn),
        h('p.hint', 'Claude erstellt nur einen Vorschlag. Im Shop wird erst nach deiner ausdrücklichen Freigabe etwas geändert.'))),
    ornament(),
    h('section.section', h('h2', 'Vorschlag, Vorschau & Freigabe'), proposalBox));

  renderStatus(); renderAttachments(); renderProposal();
  try {
    const a = await get('/api/website/areas');
    const groups = {};
    for (const ar of a.areas) (groups[ar.group] ||= []).push(ar);
    clear(areaSelect, Object.entries(groups).map(([g, list]) => h('optgroup', { label: g }, list.map((ar) => h('option', { value: ar.key, selected: ar.key === draft.areaKey }, ar.label)))));
    if (!a.areas.some((x) => x.key === draft.areaKey)) areaSelect.value = 'auto';
    clear(areaMsg, a.themeError ? h('div.inline-msg.warn', 'Theme: ' + a.themeError) : null, a.contentError ? h('div.inline-msg.info', a.contentError) : null);
  } catch (err) { clear(areaMsg, h('div.inline-msg.error', err.message)); }
  areaSelect.addEventListener('change', () => saver.schedule({ areaKey: areaSelect.value }));
  // Aus dem Website-Editor kommend: Vorschlag direkt anstoßen (Kostenhinweis erscheint wie gewohnt)
  if (query.start === '1' && !draft.proposal && draft.request?.trim()) {
    history.replaceState(null, '', `#/website/${id}`);
    proposeBtn.click();
  }
}
