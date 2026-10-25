/* APOLOGEA Handy-App – Kollektionen zusammenstellen
   Gespeichert in Sammlung/.apologea/kollektionen.json (über Store.updateCollections).
   Pieces werden über ihre id referenziert; ihre Ordner und Produktdaten bleiben unverändert. */
'use strict';

const Coll = (() => {
  const STATUS = [['idee', 'Idee'], ['planung', 'In Planung'], ['bereit', 'Bereit'], ['veroeffentlicht', 'Veröffentlicht']];
  const STATUS_LABEL = Object.fromEntries(STATUS);
  const STATUS_BADGE = { idee: '', planung: 'entwurf', bereit: 'hinweis', veroeffentlicht: 'ok' };
  const st = { open: null, reorder: null };

  const list = () => Store.collections || [];
  const byId = id => list().find(c => c.id === id);
  const pieceById = id => M().pieces.find(p => p.id === id);
  const piecesOf = c => (c.pieces || []).map(pieceById).filter(Boolean);
  const missingOf = c => (c.pieces || []).filter(id => !pieceById(id)).length;
  const fmtDrop = d => { if (!d) return ''; const x = new Date(d + 'T12:00:00'); return isNaN(x) ? d : x.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' }); };
  const badge = c => `<span class="badge ${STATUS_BADGE[c.status] || ''}">${esc(STATUS_LABEL[c.status] || 'Idee')}</span>`;

  async function ensureLoaded(force) {
    try { await Store.loadCollections(force); return true; }
    catch (e) { fail(e, 'Kollektionen nicht verfügbar'); return false; }
  }
  async function save(mutate, msg) {
    busy(msg || 'Wird gespeichert …');
    try { const r = await Store.updateCollections(mutate); unbusy(); return r === undefined ? true : r; }
    catch (e) { unbusy(); fail(e, 'Speichern nicht möglich'); return null; }
  }

  // ---------------------------------------------------------------- Übersicht
  async function openList() {
    busy('Kollektionen werden geladen …');
    const ok = await ensureLoaded(true);
    unbusy();
    if (!ok) return;
    renderList();
  }
  function renderList() {
    let v = $('#coll-list');
    if (!v) { v = document.createElement('div'); v.id = 'coll-list'; v.className = 'view'; $('#layer').appendChild(v); }
    const cs = list().slice().sort((a, b) => String(a.drop || '9999').localeCompare(String(b.drop || '9999')) || a.name.localeCompare(b.name, 'de'));
    v.innerHTML = `
      <div class="view-head"><button class="btn ghost icon" id="cl-back" aria-label="Zurück">${icon('back')}</button><div class="title">Kollektionen</div><button class="btn ghost" id="cl-new">${icon('plus')}Neu</button></div>
      <div class="view-body">
        ${cs.length ? cs.map(c => {
          const ps = piecesOf(c), thumbs = ps.slice(0, 4).map(p => cardItem(p).f).filter(Boolean);
          return `<button class="coll-card" data-id="${esc(c.id)}">
            <div class="coll-thumbs">${[0, 1, 2, 3].map(i => thumbs[i] ? `<div class="ct"><img data-thumb="${thumbs[i].id}" alt=""></div>` : '<div class="ct empty"></div>').join('')}</div>
            <div class="coll-info"><div class="coll-name">${esc(c.name)}</div>
              <div class="coll-meta">${badge(c)}<span>${ps.length} ${ps.length === 1 ? 'Piece' : 'Pieces'}</span>${c.drop ? `<span>Drop: ${esc(fmtDrop(c.drop))}</span>` : ''}</div>
              ${c.beschreibung ? `<div class="coll-desc">${esc(c.beschreibung)}</div>` : ''}</div></button>`;
        }).join('') : `<div class="coll-empty"><div class="ornament-line short"></div><p>Noch keine Kollektionen.</p><p class="hint">Stellen Sie Pieces zu Kollektionen zusammen – z. B. „Erster Drop“ oder „Ikonen-Serie“. Ein Piece kann in mehreren Kollektionen sein.</p><button class="btn primary" id="cl-first">${icon('plus')}Erste Kollektion anlegen</button></div>`}
      </div>`;
    $('#cl-back', v).onclick = closeList;
    $('#cl-new', v).onclick = () => edit(null);
    const first = $('#cl-first', v); if (first) first.onclick = () => edit(null);
    $$('.coll-card', v).forEach(b => b.onclick = () => openOne(b.dataset.id));
    observeThumbs(v);
  }
  function closeList() { const v = $('#coll-list'); if (v) v.remove(); }

  // ---------------------------------------------------------------- Eine Kollektion
  function openOne(id) { st.open = id; st.reorder = null; renderOne(); }
  function renderOne() {
    const c = byId(st.open);
    let v = $('#coll-view');
    if (!c) { if (v) v.remove(); st.open = null; return; }
    if (!v) { v = document.createElement('div'); v.id = 'coll-view'; v.className = 'view'; $('#layer').appendChild(v); }
    const ps = piecesOf(c), miss = missingOf(c), scroll = $('.view-body', v) ? $('.view-body', v).scrollTop : 0;
    const ro = st.reorder;
    v.innerHTML = `
      <div class="view-head"><button class="btn ghost icon" id="cv-back" aria-label="Zurück">${icon('back')}</button><div class="title">${esc(c.name)}</div>
        ${ro ? '<button class="btn primary small" id="cv-ro-done">Fertig</button>' : `<button class="btn ghost icon" id="cv-edit" aria-label="Bearbeiten">${icon('edit')}</button>`}</div>
      <div class="view-body">
        <div class="detail-title"><div class="nr">Kollektion${c.drop ? ' · Drop ' + esc(fmtDrop(c.drop)) : ''}</div><h1>${esc(c.name)}</h1>
          <div class="row" style="margin-top:8px">${badge(c)}<span class="hint">${ps.length} ${ps.length === 1 ? 'Piece' : 'Pieces'}</span></div></div>
        ${c.beschreibung ? `<p class="coll-text">${esc(c.beschreibung).replace(/\n/g, '<br>')}</p>` : ''}
        ${ro ? '<p class="hint">Reihenfolge mit den Pfeilen ändern. Diese Reihenfolge gilt auch im Katalog.</p>' : `<div class="actions coll-actions">
          <button class="btn primary" id="cv-add">${icon('plus')}Pieces wählen</button>
          <button class="btn gold" id="cv-cat">${icon('file')}Katalog (PDF)</button>
          <button class="btn" id="cv-order" ${ps.length > 1 ? '' : 'disabled'}>${icon('sort')}Reihenfolge</button>
        </div>`}
        ${miss && !ro ? `<div class="notice coll-miss">${miss === 1 ? '1 Piece ist' : miss + ' Pieces sind'} nicht mehr in der Sammlung (gelöscht oder im Papierkorb). <button class="btn small ghost" id="cv-clean">Entfernen</button></div>` : ''}
        ${ro ? `<div class="filelist coll-order">${ro.map((pid, i) => { const p = pieceById(pid); return p ? `<div class="filerow"><span class="nr">${i + 1}.</span><div class="fn">${pad3(p.nummer)} · ${esc(p.name)}<small>${esc(p.kategorie)}</small></div>
            <button class="btn small" data-up="${i}" ${i ? '' : 'disabled'} aria-label="Nach oben">↑</button><button class="btn small" data-down="${i}" ${i < ro.length - 1 ? '' : 'disabled'} aria-label="Nach unten">↓</button></div>` : ''; }).join('')}</div>`
          : ps.length ? `<main class="grid coll-grid">${ps.map(pieceCardHtml).join('')}</main>` : '<div class="coll-empty"><p class="hint">Noch keine Pieces in dieser Kollektion. Tippen Sie auf „Pieces wählen“.</p></div>'}
      </div>`;
    $('.view-body', v).scrollTop = scroll;
    $('#cv-back', v).onclick = () => { if (st.reorder) { st.reorder = null; renderOne(); return; } closeOne(); };
    if (ro) {
      $('#cv-ro-done', v).onclick = async () => {
        const order = st.reorder.slice();
        const ok = await save(cs => { const x = cs.find(k => k.id === c.id); if (!x) throw new Error('Die Kollektion wurde inzwischen gelöscht.'); const rest = (x.pieces || []).filter(id => !order.includes(id)); x.pieces = order.filter(id => (x.pieces || []).includes(id)).concat(rest); x.geaendert = isoLocal(); }, 'Reihenfolge wird gespeichert …');
        if (ok) { st.reorder = null; renderOne(); renderListIfOpen(); toast('Reihenfolge gespeichert.', 'ok'); }
      };
      $$('[data-up]', v).forEach(b => b.onclick = () => { const i = +b.dataset.up; [ro[i - 1], ro[i]] = [ro[i], ro[i - 1]]; renderOne(); });
      $$('[data-down]', v).forEach(b => b.onclick = () => { const i = +b.dataset.down; [ro[i + 1], ro[i]] = [ro[i], ro[i + 1]]; renderOne(); });
      return;
    }
    $('#cv-edit', v).onclick = () => edit(c);
    $('#cv-add', v).onclick = () => pick(c);
    $('#cv-cat', v).onclick = () => { if (!ps.length) { toast('Die Kollektion enthält noch keine Pieces.', 'err'); return; } openCatalog({ collection: c, pieces: ps }); };
    $('#cv-order', v).onclick = () => { st.reorder = ps.map(p => p.id); renderOne(); };
    const clean = $('#cv-clean', v);
    if (clean) clean.onclick = async () => {
      const ids = new Set(M().pieces.map(p => p.id));
      if (await save(cs => { const x = cs.find(k => k.id === c.id); if (x) x.pieces = (x.pieces || []).filter(id => ids.has(id)); })) renderOne();
    };
    const grid = $('.coll-grid', v);
    if (grid) {
      grid.onclick = e => {
        const card = e.target.closest('.card'); if (!card) return;
        S.visible = ps.map(p => p.key);
        openDetail(card.dataset.key);
        const d = $('#detail'); if (d) $('#layer').appendChild(d); // über der Kollektion anzeigen
      };
      observeThumbs(grid);
    }
  }
  function closeOne() { const v = $('#coll-view'); if (v) v.remove(); st.open = null; st.reorder = null; renderGrid(); }
  function renderListIfOpen() { if ($('#coll-list')) renderList(); }

  // ---------------------------------------------------------------- Anlegen / Bearbeiten / Löschen
  function edit(c) {
    const body = document.createElement('div');
    let status = c ? c.status || 'idee' : 'idee';
    body.innerHTML = `
      <div class="field"><label for="ce-name">Name<span class="req">*</span></label><input class="input name" id="ce-name" maxlength="60" value="${esc(c ? c.name : '')}" placeholder="z. B. ERSTER DROP" autocomplete="off"></div>
      <div class="field"><label for="ce-desc">Beschreibung <span class="faint">(optional)</span></label><textarea class="input" id="ce-desc" placeholder="Idee, Thema, Botschaft der Kollektion …">${esc(c ? c.beschreibung || '' : '')}</textarea></div>
      <div class="field"><label>Status</label><div class="seg" id="ce-status">${STATUS.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === status ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="field"><label for="ce-drop">Drop-Datum <span class="faint">(optional)</span></label><input class="input" id="ce-drop" type="date" value="${esc(c ? c.drop || '' : '')}"></div>
      ${c ? `<button type="button" class="btn danger block" id="ce-del" style="margin-top:6px">${icon('trash')}Kollektion löschen</button><p class="hint">Löscht nur die Zusammenstellung – die Pieces bleiben erhalten.</p>` : ''}`;
    let data = null;
    sheet({
      title: c ? 'Kollektion bearbeiten' : 'Neue Kollektion', body,
      buttons: [{ label: 'Abbrechen' }, { label: c ? 'Speichern' : 'Anlegen', cls: 'primary', run: () => {
        const name = $('#ce-name', body).value.trim();
        if (!name) { $('#ce-name', body).classList.add('invalid'); toast('Bitte einen Namen eingeben.', 'err'); return false; }
        if (list().some(x => x.id !== (c && c.id) && norm(x.name) === norm(name))) { toast(`Eine Kollektion „${name}“ gibt es bereits.`, 'err'); return false; }
        data = { name, beschreibung: $('#ce-desc', body).value.replace(/\r\n/g, '\n').trim(), status, drop: $('#ce-drop', body).value || '' };
      } }],
      onOpen: (back, close) => {
        $('#ce-status', body).onclick = e => { const b = e.target.closest('button'); if (!b) return; status = b.dataset.v; $$('#ce-status button', body).forEach(x => x.classList.toggle('on', x === b)); };
        const del = $('#ce-del', body);
        if (del) del.onclick = async () => {
          close(null);
          if (!(await confirmSheet('Kollektion löschen?', `„${esc(c.name)}“ wird gelöscht. Die Pieces selbst bleiben unverändert in der Sammlung.`, 'Löschen', true))) return;
          if (await save(cs => { const i = cs.findIndex(k => k.id === c.id); if (i >= 0) cs.splice(i, 1); }, 'Wird gelöscht …')) { closeOne(); renderListIfOpen(); toast('Kollektion gelöscht.', 'ok'); }
        };
        if (!c) setTimeout(() => $('#ce-name', body).focus(), 250);
      }
    }).then(async () => {
      if (!data) return;
      if (c) {
        if (await save(cs => { const x = cs.find(k => k.id === c.id); if (!x) throw new Error('Die Kollektion wurde inzwischen gelöscht.'); Object.assign(x, data, { geaendert: isoLocal() }); })) { renderOne(); renderListIfOpen(); toast('Gespeichert.', 'ok'); }
      } else {
        const id = newId(), now = isoLocal();
        if (await save(cs => { cs.push(Object.assign({ id, pieces: [], erstellt: now, geaendert: now }, data)); }, 'Kollektion wird angelegt …')) { renderListIfOpen(); openOne(id); pick(byId(id)); }
      }
    });
  }

  // ---------------------------------------------------------------- Pieces auswählen (mit Suchleiste)
  function pick(c) {
    if (!c) return;
    const m = M(), sel = new Set((c.pieces || []).filter(id => pieceById(id)));
    const sorted = m.pieces.slice().sort((a, b) => a.kategorie.localeCompare(b.kategorie, 'de') || a.nummer - b.nummer);
    const hay = p => norm([p.nummer, pad3(p.nummer), p.name, p.motivtitel, p.serie, p.kategorie, p.schlagwoerter.join(' ')].join(' '));
    let q = '';
    const hits = () => { const t = norm(q).split(/\s+/).filter(Boolean); return t.length ? sorted.filter(p => { const h = hay(p); return t.every(x => h.includes(x)); }) : sorted; };
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="search cat-search">${icon('search')}<input class="input" id="cp-q" type="search" placeholder="Name, Nummer, Motiv, Serie …" autocomplete="off" enterkeyhint="search"></div>
      <label class="imp-check cat-allbox"><input type="checkbox" id="cp-all"><span>Alle Pieces <span class="faint">(${m.pieces.length})</span></span></label>
      <div class="cat-tools"><span id="cp-count" class="hint"></span><button type="button" class="btn small ghost" id="cp-hits">Treffer wählen</button><button type="button" class="btn small ghost" id="cp-none">Leeren</button></div>
      <div class="cat-list coll-pick" id="cp-list"></div>`;
    const render = () => {
      const l = hits();
      $('#cp-list', body).innerHTML = l.length ? l.slice(0, 400).map(p => `<label class="cat-row"><input type="checkbox" data-id="${esc(p.id)}" ${sel.has(p.id) ? 'checked' : ''}><span class="nr">${pad3(p.nummer)}</span><span class="nm">${esc(p.name)}<small>${esc(p.kategorie)}${p.motivtitel ? ' · ' + esc(p.motivtitel) : ''}${p.entwurf ? ' · Entwurf' : ''}</small></span></label>`).join('') + (l.length > 400 ? `<p class="hint">… und ${l.length - 400} weitere – bitte Suche verfeinern.</p>` : '') : '<p class="hint">Keine Treffer.</p>';
      $('#cp-count', body).textContent = `${sel.size} ausgewählt${q ? ' · ' + l.length + ' Treffer' : ''}`;
      const all = $('#cp-all', body); all.checked = sel.size === m.pieces.length; all.indeterminate = sel.size > 0 && sel.size < m.pieces.length;
    };
    let ok = false;
    sheet({
      title: 'Pieces für „' + c.name + '“', body,
      buttons: [{ label: 'Abbrechen' }, { label: 'Übernehmen', cls: 'primary', run: () => { ok = true; } }],
      onOpen: () => {
        render();
        $('#cp-q', body).addEventListener('input', e => { q = e.target.value; render(); });
        $('#cp-q', body).addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
        $('#cp-hits', body).onclick = () => { hits().forEach(p => sel.add(p.id)); render(); };
        $('#cp-none', body).onclick = () => { sel.clear(); render(); };
        $('#cp-all', body).onchange = e => { if (e.target.checked) m.pieces.forEach(p => sel.add(p.id)); else sel.clear(); render(); };
        $('#cp-list', body).addEventListener('change', e => { const x = e.target.closest('input[data-id]'); if (!x) return; if (x.checked) sel.add(x.dataset.id); else sel.delete(x.dataset.id); render(); });
      }
    }).then(async () => {
      if (!ok) return;
      const chosen = [...sel];
      const r = await save(cs => {
        const x = cs.find(k => k.id === c.id); if (!x) throw new Error('Die Kollektion wurde inzwischen gelöscht.');
        const keep = (x.pieces || []).filter(id => chosen.includes(id) || !pieceById(id)); // gelöschte bleiben, bis sie bewusst entfernt werden
        const add = sorted.map(p => p.id).filter(id => chosen.includes(id) && !keep.includes(id));
        x.pieces = keep.concat(add); x.geaendert = isoLocal();
      }, 'Kollektion wird gespeichert …');
      if (r) { renderOne(); renderListIfOpen(); toast(`${chosen.length} ${chosen.length === 1 ? 'Piece' : 'Pieces'} in „${c.name}“.`, 'ok'); }
    });
  }

  // ---------------------------------------------------------------- In der Detailansicht eines Pieces
  function fillDetail(p, box) {
    if (!box) return;
    const draw = () => {
      if (!box.isConnected) return;
      const mine = list().filter(c => (c.pieces || []).includes(p.id));
      box.innerHTML = `<div class="section-title">Kollektionen</div>
        <div class="row coll-chips">${mine.map(c => `<button class="chip coll-chip" data-id="${esc(c.id)}">${esc(c.name)}</button>`).join('')}
        <button class="chip coll-chip add" id="d-coll-add">${icon('plus')}Zu Kollektion …</button></div>`;
      $$('.coll-chip[data-id]', box).forEach(b => b.onclick = () => { closeDetail(); openOne(b.dataset.id); });
      $('#d-coll-add', box).onclick = () => toggleFor(p, draw);
    };
    draw();
    Store.loadCollections().then(draw).catch(() => {});
  }
  async function toggleFor(p, done) {
    if (!(await ensureLoaded(true))) return;
    const cs = list();
    const opts = cs.map(c => ({ label: c.name, value: c.id, sub: (c.pieces || []).includes(p.id) ? '✓ enthalten' : '' })).concat([{ label: 'Neue Kollektion …', value: '__neu', icon: 'plus' }]);
    const v = await choose(`${pad3(p.nummer)} · ${p.name}`, opts);
    if (!v) return;
    if (v === '__neu') {
      const name = await askText('Neue Kollektion', 'Name der Kollektion');
      if (!name) return;
      if (cs.some(x => norm(x.name) === norm(name))) { toast(`Eine Kollektion „${name}“ gibt es bereits.`, 'err'); return; }
      const now = isoLocal();
      if (await save(all => { all.push({ id: newId(), name, beschreibung: '', status: 'idee', drop: '', pieces: [p.id], erstellt: now, geaendert: now }); })) { toast(`Neue Kollektion „${name}“ mit diesem Piece angelegt.`, 'ok'); done(); renderListIfOpen(); }
      return;
    }
    const c = byId(v), inIt = (c.pieces || []).includes(p.id);
    if (await save(all => { const x = all.find(k => k.id === v); if (!x) throw new Error('Die Kollektion wurde inzwischen gelöscht.'); x.pieces = x.pieces || []; if (inIt) x.pieces = x.pieces.filter(id => id !== p.id); else if (!x.pieces.includes(p.id)) x.pieces.push(p.id); x.geaendert = isoLocal(); })) {
      toast(inIt ? `Aus „${c.name}“ entfernt.` : `Zu „${c.name}“ hinzugefügt.`, 'ok'); done(); renderListIfOpen(); if (st.open) renderOne();
    }
  }

  /** Nach Abgleich/Änderungen: offene Ansichten auffrischen (z. B. wenn ein anderes Gerät geändert hat) */
  async function refresh() {
    if (!$('#coll-list') && !$('#coll-view')) { Store.loadCollections().catch(() => {}); return; }
    try { await Store.loadCollections(); } catch (e) { return; }
    renderListIfOpen(); if (st.open && !st.reorder) renderOne();
  }

  return { openList, openOne, fillDetail, refresh, get count() { return list().length; } };
})();
