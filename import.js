/* APOLOGEA Handy-App – Import mehrerer Pieces aus ZIP-Dateien, Ordnern oder einzelnen Dateien
   Ohne KI: Die Zuordnung folgt festen Regeln (Ordnerstruktur, Dateinamen) und wird vor dem Import angezeigt.
   Gespeichert wird über Store.save – also genau im Format des PC-Programms. */
'use strict';

// ---------------------------------------------------------------- ZIP lesen (ohne Bibliothek)
const Zip = (() => {
  const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
  const utf8 = new TextDecoder('utf-8', { fatal: true });

  // UTF-8 zuerst (auch ohne Kennzeichen, z. B. vom Mac); ist es keins, die alte Windows-Kodierung CP437
  function decodeName(bytes) {
    if (bytes.every(b => b < 128)) return String.fromCharCode(...bytes);
    try { return utf8.decode(bytes); } catch (e) { /* kein gültiges UTF-8 */ }
    let s = '';
    for (const b of bytes) s += b < 128 ? String.fromCharCode(b) : CP437[b - 128];
    return s;
  }
  const u16 = (v, o) => v.getUint16(o, true);
  const u32 = (v, o) => v.getUint32(o, true);
  const u64 = (v, o) => Number(v.getBigUint64(o, true));
  async function bytes(file, start, len) { return new DataView(await file.slice(start, start + len).arrayBuffer()); }

  async function read(file) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Dieser Browser kann ZIP-Dateien nicht entpacken. Bitte den Browser aktualisieren oder die Dateien einzeln auswählen.');
    const tailLen = Math.min(file.size, 65557);
    const tail = await bytes(file, file.size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error(`„${file.name}“ ist keine gültige ZIP-Datei.`);
    let count = u16(tail, eocd + 10), cdSize = u32(tail, eocd + 12), cdOff = u32(tail, eocd + 16);
    if (count === 0xFFFF || cdSize === 0xFFFFFFFF || cdOff === 0xFFFFFFFF) {
      const loc = eocd - 20;
      if (loc < 0 || u32(tail, loc) !== 0x07064b50) throw new Error(`„${file.name}“ ist beschädigt (ZIP64-Verzeichnis fehlt).`);
      const z = await bytes(file, u64(tail, loc + 8), 56);
      if (u32(z, 0) !== 0x06064b50) throw new Error(`„${file.name}“ ist beschädigt (ZIP64-Verzeichnis ungültig).`);
      count = u64(z, 32); cdSize = u64(z, 40); cdOff = u64(z, 48);
    }
    const cd = await bytes(file, cdOff, cdSize);
    const out = [];
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (p + 46 > cd.byteLength || u32(cd, p) !== 0x02014b50) throw new Error(`„${file.name}“ ist beschädigt (Inhaltsverzeichnis).`);
      const flags = u16(cd, p + 8), method = u16(cd, p + 10);
      let comp = u32(cd, p + 20), size = u32(cd, p + 24), off = u32(cd, p + 42);
      const nl = u16(cd, p + 28), el = u16(cd, p + 30), cl = u16(cd, p + 32);
      let name = decodeName(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nl));
      for (let e = p + 46 + nl; e + 4 <= p + 46 + nl + el;) {
        const id = u16(cd, e), len = u16(cd, e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (size === 0xFFFFFFFF) { size = u64(cd, q); q += 8; }
          if (comp === 0xFFFFFFFF) { comp = u64(cd, q); q += 8; }
          if (off === 0xFFFFFFFF) { off = u64(cd, q); }
        }
        if (id === 0x7075 && len > 5) name = new TextDecoder('utf-8').decode(new Uint8Array(cd.buffer, cd.byteOffset + e + 9, len - 5));
        e += 4 + len;
      }
      p += 46 + nl + el + cl;
      if (name.endsWith('/') || name.endsWith('\\')) continue;
      out.push({
        path: name, size,
        async getBlob() {
          if (flags & 1) throw new Error(`„${name}“ ist verschlüsselt. Bitte die ZIP ohne Passwort erstellen.`);
          const h = await bytes(file, off, 30);
          if (u32(h, 0) !== 0x04034b50) throw new Error(`„${name}“ ist in der ZIP beschädigt.`);
          const start = off + 30 + u16(h, 26) + u16(h, 28);
          const raw = file.slice(start, start + comp);
          if (method === 0) return raw;
          if (method === 8) return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
          throw new Error(`„${name}“ nutzt ein nicht unterstütztes Komprimierungsverfahren. Bitte die ZIP mit der normalen Windows-/Handy-Funktion erstellen.`);
        }
      });
    }
    return out;
  }
  return { read };
})();

// ---------------------------------------------------------------- Zuordnungsregeln
const ImportRules = (() => {
  const JUNK_FILE = /^(desktop\.ini|thumbs\.db|\.ds_store|_papierkorb-info\.json|sammlung\.json)$/i;
  const ROLE_WORD = /^(design|designs|motiv|druck|druckdatei|print|artwork|grafik|mockup|mockups|mock|model|lifestyle|kleidungsansicht|ansicht|kleidung|motivdarstellung|flat|flatlay|garment|front|back|vorne|hinten|ruecken|rücken|rueckseite|rückseite|vorderseite|transparent|final)$/i;

  function roleOf(rel) {
    const n = String(rel).toLowerCase().replace(/\.[^./]+$/, '');
    if (/mock|model|lifestyle/.test(n)) return 'mockup';
    if (/kleidungsansicht|motivdarstellung|kleidung|ansicht|flat|garment/.test(n)) return 'kleidungsansicht';
    if (/design|motiv|druck|print|artwork|grafik/.test(n)) return 'design';
    return null;
  }
  const isImage = name => IMG_EXT.includes(extOf(name));
  const catKey = s => norm(Names.category(s));

  /** Ordner- oder Dateiname → Nummer + lesbarer Name */
  function parseLabel(label) {
    let s = String(label || '').trim(), nummer = 0;
    const m = s.match(/^(\d{1,5})[_\- .]+(.*)$/);
    if (m) { nummer = +m[1]; s = m[2]; }
    s = s.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
    return { nummer, name: s.slice(0, 60) };
  }
  /** Lose Dateien: Rollenwörter entfernen, damit „Seraphim_Design“ und „Seraphim_Mockup“ zusammenfinden */
  function stemKey(fileName) {
    const stem = fileName.replace(/\.[^.]+$/, '');
    const tokens = stem.split(/[\s_\-.()[\]]+/).filter(Boolean);
    const keep = tokens.filter(t => !ROLE_WORD.test(t) && !/^\d{1,2}$/.test(t));
    const label = (keep.length ? keep : tokens).join(' ');
    return { key: norm(label), label };
  }

  /**
   * entries: [{ path, size, getBlob }] · categories: [{ id, name }]
   * Liefert Gruppen: { label, folderNummer, catName, dir, files: [{ entry, rel }], json: entry|null }
   */
  function group(entries, categories) {
    const known = new Set(categories.map(c => catKey(c.name)));
    let files = entries.map(e => ({ entry: e, segs: String(e.path).replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '').split('/').filter(Boolean) }))
      .filter(f => f.segs.length && !f.segs.some(s => s.startsWith('.') || /^__MACOSX$/i.test(s) || /^_Papierkorb$/i.test(s)) && !JUNK_FILE.test(f.segs[f.segs.length - 1]));
    // Gemeinsamen Hüllordner entfernen (z. B. „Neue_Pieces/…“), solange er selbst keine Dateien enthält
    while (files.length && files.every(f => f.segs.length >= 3 && f.segs[0] === files[0].segs[0]) && !known.has(catKey(files[0].segs[0]))) files.forEach(f => f.segs.shift());

    const jsonDirs = new Set(files.filter(f => f.segs[f.segs.length - 1].toLowerCase() === DATA_FILE.toLowerCase()).map(f => f.segs.slice(0, -1).join('/')));
    const hasDirect = new Set(files.filter(f => f.segs.length === 2).map(f => f.segs[0]));
    const groups = new Map();
    const add = (key, init, file, rel) => { if (!groups.has(key)) groups.set(key, Object.assign({ files: [], json: null }, init)); const g = groups.get(key); if (rel.toLowerCase() === DATA_FILE.toLowerCase()) g.json = file.entry; else g.files.push({ entry: file.entry, rel }); };

    for (const f of files) {
      const dirs = f.segs.slice(0, -1), name = f.segs[f.segs.length - 1];
      // 1. Ordner mit Produktdaten.json (Format des PC-Programms)
      let jd = null;
      for (let i = dirs.length; i >= 1; i--) if (jsonDirs.has(dirs.slice(0, i).join('/'))) { jd = i; break; }
      if (jd) {
        const dir = dirs.slice(0, jd);
        add('d:' + dir.join('/'), { dir: dir.join('/'), label: dir[dir.length - 1], catName: dir.length >= 2 ? dir[dir.length - 2] : '' }, f, f.segs.slice(jd).join('/'));
        continue;
      }
      // 2. Lose Datei ganz oben → nach Dateinamen gruppieren
      if (!dirs.length) { const k = stemKey(name); add('s::' + k.key, { dir: '', label: k.label, catName: '' }, f, name); continue; }
      // 3. Oberster Ordner ist ein Kleidungstyp (vorhanden oder neu: enthält nur Unterordner)
      const top = dirs[0];
      if (known.has(catKey(top)) || !hasDirect.has(top)) {
        if (dirs.length === 1) { const k = stemKey(name); add('s:' + top + ':' + k.key, { dir: top, label: k.label, catName: top }, f, name); continue; }
        add('d:' + top + '/' + dirs[1], { dir: top + '/' + dirs[1], label: dirs[1], catName: top }, f, f.segs.slice(2).join('/'));
        continue;
      }
      // 4. Oberster Ordner ist das Piece selbst
      add('d:' + top, { dir: top, label: top, catName: '' }, f, f.segs.slice(1).join('/'));
    }
    return [...groups.values()].filter(g => g.files.length || g.json);
  }

  /** Rollen verteilen: Name/Ordner zuerst, dann freie Bilder; Rest → Arbeitsdateien */
  function assignRoles(files, bilder) {
    const res = files.map(f => ({ rel: f.rel, entry: f.entry, size: f.entry.size, role: 'arbeitsdatei' }));
    const taken = {};
    if (bilder) {
      ROLES.forEach(r => {
        const want = bilder[r] ? String(bilder[r]).replace(/\\/g, '/').toLowerCase() : null;
        const hit = want && res.find(x => x.rel.toLowerCase() === want);
        if (hit) { hit.role = r; taken[r] = true; }
      });
      return res;
    }
    const imgs = res.filter(x => isImage(x.rel) && !/^arbeitsdateien\//i.test(x.rel));
    imgs.forEach(x => { const r = roleOf(x.rel); if (r && !taken[r]) { x.role = r; taken[r] = true; } });
    const free = imgs.filter(x => x.role === 'arbeitsdatei' && !roleOf(x.rel));
    const pick = pred => { const i = free.findIndex(pred); return i < 0 ? null : free.splice(i, 1)[0]; };
    if (!taken.design) { const x = pick(y => /^(png|svg|psd|tif|tiff)$/.test(extOf(y.rel))) || pick(() => true); if (x) { x.role = 'design'; taken.design = true; } }
    if (!taken.mockup) { const x = pick(() => true); if (x) { x.role = 'mockup'; taken.mockup = true; } }
    if (!taken.kleidungsansicht) { const x = pick(() => true); if (x) { x.role = 'kleidungsansicht'; taken.kleidungsansicht = true; } }
    return res;
  }

  return { group, assignRoles, parseLabel, catKey, isImage };
})();

// ---------------------------------------------------------------- Oberfläche
const Imp = { st: null };

function openImport() {
  const body = document.createElement('div');
  const dirOk = 'webkitdirectory' in document.createElement('input');
  body.innerHTML = `<p class="hint" style="margin-top:0">Mehrere neue Pieces auf einmal hinzufügen. Am besten <b>ein Ordner pro Piece</b> (z. B. <span class="mono">SERAPHIM/Design.png, Mockup.jpg …</span>), gern auch in Kleidungstyp-Ordnern. Vor dem Speichern sehen Sie eine Vorschau.</p>
    <label class="menu-item">${icon('folder')}<span>ZIP-Datei wählen</span><input type="file" accept=".zip,application/zip,application/x-zip-compressed" multiple class="hidden" data-src="zip"></label>
    ${dirOk ? `<label class="menu-item">${icon('folder')}<span>Ordner wählen</span><span class="sub">am PC / Android</span><input type="file" webkitdirectory multiple class="hidden" data-src="dir"></label>` : ''}
    <label class="menu-item">${icon('image')}<span>Einzelne Dateien wählen</span><input type="file" multiple class="hidden" data-src="files"></label>`;
  sheet({ title: 'Pieces importieren', body, buttons: [{ label: 'Abbrechen' }], onOpen: (back, close) => {
    $$('input[data-src]', body).forEach(inp => inp.onchange = () => { const fl = Array.from(inp.files || []); inp.value = ''; if (!fl.length) return; close(); analyzeImport(fl); });
  } });
}

async function analyzeImport(fileList) {
  busy('Dateien werden gelesen …');
  try {
    // Jede ZIP und die übrigen Dateien werden getrennt ausgewertet, damit sich nichts vermischt
    const zips = fileList.filter(f => extOf(f.name) === 'zip');
    const plain = fileList.filter(f => extOf(f.name) !== 'zip');
    const sources = [];
    for (const z of zips) { busy(`„${z.name}“ wird geöffnet …`); sources.push({ label: z.name, entries: await Zip.read(z) }); }
    if (plain.length) sources.push({ label: plain[0].webkitRelativePath ? plain[0].webkitRelativePath.split('/')[0] : 'Auswahl', entries: plain.map(f => ({ path: f.webkitRelativePath || f.name, size: f.size, getBlob: async () => f })) });
    const multi = sources.length > 1;
    const groups = [];
    let fileCount = 0;
    sources.forEach(s => { fileCount += s.entries.length; ImportRules.group(s.entries, M().categories).forEach(g => groups.push(Object.assign(g, { source: (multi ? s.label + ' › ' : '') + (g.dir || 'oberste Ebene') }))); });
    if (!groups.length) { unbusy(); toast('In der Auswahl wurden keine Dateien gefunden.', 'err'); return; }
    busy('Zuordnung wird vorbereitet …');
    const pieces = [];
    const usedNr = new Set();
    for (const g of groups) {
      let data = null;
      if (g.json) { try { data = JSON.parse((await (await g.json.getBlob()).text()).replace(/^﻿/, '')); } catch (e) { data = null; } }
      const lab = ImportRules.parseLabel(g.label);
      const name = String((data && data.name) || lab.name || 'Ohne Namen').trim().slice(0, 60);
      const catName = String((data && data.kategorie) || g.catName || '').trim();
      const cat = catName ? M().categories.find(c => ImportRules.catKey(c.name) === ImportRules.catKey(catName)) : null;
      let wantNr = parseInt(data && data.nummer, 10) || lab.nummer || 0;
      if (wantNr && (Store.numberOwner(wantNr) || usedNr.has(wantNr))) wantNr = 0;
      if (wantNr) usedNr.add(wantNr);
      const dup = M().pieces.find(p => norm(p.name) === norm(name) && (!cat || p.catId === cat.id));
      pieces.push({
        on: !dup, dup: dup ? `${pad3(dup.nummer)} · ${dup.name} in ${dup.kategorie}` : '',
        name, wantNr, motivtitel: String((data && data.motivtitel) || '').trim(), serie: String((data && data.serie) || '').trim(),
        beschreibung: String((data && data.beschreibung) || ''), schlagwoerter: data && Array.isArray(data.schlagwoerter) ? data.schlagwoerter.map(String) : [],
        extra: data || {}, cat: cat ? cat.id : catName ? '__neu:' + Names.category(catName) : '',
        source: g.source, files: ImportRules.assignRoles(g.files, data && data.bilder)
      });
    }
    pieces.sort((a, b) => a.source.localeCompare(b.source, 'de', { numeric: true }) || a.name.localeCompare(b.name, 'de'));
    unbusy();
    Imp.st = { pieces, entwurf: true, sourceName: sources.map(s => s.label).join(', ').slice(0, 120), fileCount, urls: [] };
    S.imp = true;
    renderImport();
  } catch (e) { unbusy(); fail(e, 'Import nicht möglich'); }
}

const impStatus = p => ROLES.filter(r => !p.files.some(f => f.role === r));

function catOptions(sel) {
  const news = [...new Set(Imp.st.pieces.map(p => p.cat).filter(c => c.startsWith('__neu:')))];
  return `<option value="">Kleidungstyp wählen …</option>${M().categories.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
    ${news.map(n => `<option value="${esc(n)}" ${n === sel ? 'selected' : ''}>＋ Neu anlegen: ${esc(n.slice(6))}</option>`).join('')}<option value="__ask">＋ Anderer neuer Kleidungstyp …</option>`;
}

function renderImport() {
  const st = Imp.st;
  let v = $('#import');
  if (!v) { v = document.createElement('div'); v.id = 'import'; v.className = 'view'; $('#layer').appendChild(v); }
  const on = st.pieces.filter(p => p.on);
  // Fokus: nach „importieren“ nur die Pieces zeigen, denen noch der Kleidungstyp fehlt (bleiben sichtbar, auch wenn erledigt)
  const open = st.focus ? st.pieces.filter((p, i) => st.focus.has(i) && p.on && !p.cat).length : 0;
  const roleSel = (pi, fi, cur) => `<select class="input imp-role" data-p="${pi}" data-f="${fi}">${ROLES.map(r => `<option value="${r}" ${r === cur ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}<option value="arbeitsdatei" ${cur === 'arbeitsdatei' ? 'selected' : ''}>Arbeitsdatei</option><option value="weg" ${cur === 'weg' ? 'selected' : ''}>Nicht importieren</option></select>`;
  v.innerHTML = `
    <div class="view-head"><button class="btn ghost" id="i-cancel">Abbrechen</button><div class="title">Import</div><span style="width:90px"></span></div>
    <div class="view-body">
      ${st.focus ? `<div class="notice imp-focus ${open ? '' : 'done'}">${open ? `<b>${open === 1 ? '1 Piece hat' : open + ' Pieces haben'} noch keinen Kleidungstyp.</b> Es werden nur diese angezeigt – bitte zuordnen.` : '<b>Alle zugeordnet.</b> Jetzt unten auf „importieren“ tippen.'}<button class="btn small ghost" id="i-all">Alle anzeigen</button></div>`
        : `<p class="hint" style="margin-top:0"><span class="mono">${esc(st.sourceName)}</span> · ${st.fileCount} Dateien · <b>${st.pieces.length} Pieces erkannt</b>. Bitte Namen, Kleidungstyp und Bildzuordnung prüfen.</p>`}
      <div class="field"><label for="i-allcat">Kleidungstyp für alle ohne Zuordnung</label><select class="input" id="i-allcat">${catOptions('')}</select></div>
      ${st.focus ? '' : `<label class="imp-check"><input type="checkbox" id="i-draft" ${st.entwurf ? 'checked' : ''}><span>Alle als <b>Entwurf</b> speichern (empfohlen – am Handy oder PC kurz prüfen)</span></label>`}
      ${st.pieces.map((p, pi) => {
        if (st.focus && !st.focus.has(pi)) return '';
        const miss = impStatus(p);
        return `<div class="imp-card ${p.on ? '' : 'off'}">
          <label class="imp-check imp-top"><input type="checkbox" data-on="${pi}" ${p.on ? 'checked' : ''}><span class="mono faint">${esc(p.source)}</span></label>
          ${p.dup ? `<div class="notice imp-dup">Gibt es vermutlich schon: <b>${esc(p.dup)}</b>. Deshalb abgewählt – bei Bedarf wieder anhaken.</div>` : ''}
          <div class="imp-thumbs">${ROLES.map(r => { const f = p.files.find(x => x.role === r); return `<div class="imp-thumb ${r === 'design' ? 'bg-' + S.designBg : ''}" data-thumb="${pi}:${r}">${f ? '' : `<span>${ROLE_SHORT[r]}<br>fehlt</span>`}<small>${ROLE_SHORT[r]}</small></div>`; }).join('')}</div>
          <div class="field"><label>Produktname</label><input class="input name" data-name="${pi}" value="${esc(p.name)}" maxlength="60" autocomplete="off"></div>
          <div class="field"><label>Kleidungstyp</label><select class="input ${p.on && !p.cat ? 'invalid' : ''}" data-cat="${pi}">${catOptions(p.cat)}</select></div>
          <div class="hint">${p.wantNr ? `Nummer ${pad3(p.wantNr)} (aus dem Ordnernamen)` : 'Nummer: nächste freie'} · ${miss.length ? `<span style="color:var(--warn)">Entwurf – fehlt: ${miss.map(r => ROLE_LABEL[r]).join(', ')}</span>` : '<span style="color:var(--ok)">alle drei Bilder vorhanden</span>'}</div>
          <div class="filelist imp-files">${p.files.map((f, fi) => `<div class="filerow"><div class="fn">${esc(f.rel)}<small>${fmtBytes(f.size || 0)}</small></div>${roleSel(pi, fi, f.role)}</div>`).join('')}</div>
        </div>`;
      }).join('')}
    </div>
    <div class="view-foot"><button class="btn primary" id="i-go" ${on.length ? '' : 'disabled'}>${icon('check')}${on.length === 1 ? '1 Piece' : on.length + ' Pieces'} importieren</button></div>`;

  $('#i-cancel').onclick = () => closeImport();
  if ($('#i-draft')) $('#i-draft').onchange = e => { st.entwurf = e.target.checked; };
  if ($('#i-all')) $('#i-all').onclick = () => { st.focus = null; renderImport(); };
  $('#i-allcat').onchange = async e => {
    let val = e.target.value;
    if (val === '__ask') { const n = await askText('Neuer Kleidungstyp', 'Name (wird beim Import als Ordner angelegt)'); if (!n) { e.target.value = ''; return; } val = '__neu:' + Names.category(n); }
    if (!val) return;
    st.pieces.forEach(p => { if (!p.cat) p.cat = val; });
    renderImport();
  };
  $$('[data-on]', v).forEach(c => c.onchange = () => { st.pieces[+c.dataset.on].on = c.checked; renderImport(); });
  $$('[data-name]', v).forEach(i => i.oninput = () => { st.pieces[+i.dataset.name].name = i.value; });
  $$('[data-cat]', v).forEach(s => s.onchange = async () => {
    const p = st.pieces[+s.dataset.cat];
    if (s.value === '__ask') { const n = await askText('Neuer Kleidungstyp', 'Name (wird beim Import als Ordner angelegt)'); if (n) p.cat = '__neu:' + Names.category(n); renderImport(); return; }
    p.cat = s.value; renderImport();
  });
  $$('.imp-role', v).forEach(s => s.onchange = () => {
    const p = st.pieces[+s.dataset.p], f = p.files[+s.dataset.f], r = s.value;
    if (ROLES.includes(r)) p.files.forEach(x => { if (x !== f && x.role === r) x.role = 'arbeitsdatei'; });
    f.role = r; renderImport();
  });
  $('#i-go').onclick = runImport;
  loadImportThumbs();
}

async function loadImportThumbs() {
  const st = Imp.st;
  for (const el of $$('[data-thumb]')) {
    const [pi, r] = el.dataset.thumb.split(':');
    const f = st.pieces[+pi] && st.pieces[+pi].files.find(x => x.role === r);
    if (!f || !BROWSER_IMG.includes(extOf(f.rel)) || f.size > 25 * 1048576) continue;
    try {
      if (!f.url) { f.url = URL.createObjectURL(await f.entry.getBlob()); st.urls.push(f.url); }
      if (Imp.st !== st || !el.isConnected) return;
      el.insertAdjacentHTML('afterbegin', `<img src="${f.url}" alt="">`);
    } catch (e) { /* Vorschau ist nur Komfort */ }
  }
}

async function closeImport(force) {
  if (!Imp.st) return;
  if (!force && !(await confirmSheet('Import abbrechen?', 'Es wurde noch nichts gespeichert.', 'Abbrechen', true))) return;
  Imp.st.urls.forEach(u => URL.revokeObjectURL(u));
  Imp.st = null; S.imp = false;
  const v = $('#import'); if (v) v.remove();
}

async function runImport() {
  const st = Imp.st;
  const list = st.pieces.filter(p => p.on);
  const noCat = list.filter(p => !p.cat), noName = list.filter(p => !Names.segment(p.name, 40));
  if (noCat.length) {
    st.focus = new Set(noCat.map(p => st.pieces.indexOf(p)));
    renderImport();
    $('#import .view-body').scrollTop = 0;
    toast(`Es gibt ${noCat.length === 1 ? 'ein Piece' : noCat.length + ' Pieces'} ohne Kleidungstyp. Es werden nur ${noCat.length === 1 ? 'dieses' : 'diese'} angezeigt.`, '', { title: 'Kleidungstyp fehlt' });
    return;
  }
  if (noName.length) { toast('Jedes Piece braucht einen Produktnamen mit mindestens einem Buchstaben oder einer Ziffer.', 'err', { title: 'Bitte ergänzen' }); return; }
  if (!(await confirmSheet(`${list.length} ${list.length === 1 ? 'Piece' : 'Pieces'} importieren?`, `Die Pieces werden in Ihrem OneDrive in die Sammlung eingefügt${st.entwurf ? ' (als Entwurf)' : ''}. Bitte die App währenddessen geöffnet und den Bildschirm an lassen.`, 'Importieren'))) return;

  let lock = null;
  try { if (navigator.wakeLock) lock = await navigator.wakeLock.request('screen'); } catch (e) { /* optional */ }
  const warn = e => { e.preventDefault(); e.returnValue = ''; };
  window.addEventListener('beforeunload', warn);
  const ok = [], bad = [];
  const label = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  try {
    // Neue Kleidungstypen zuerst anlegen
    const newCats = [...new Set(list.map(p => p.cat).filter(c => c.startsWith('__neu:')))];
    for (const nc of newCats) {
      const n = nc.slice(6);
      busy(`Kleidungstyp „${n}“ wird angelegt …`);
      let c = M().categories.find(x => ImportRules.catKey(x.name) === ImportRules.catKey(n));
      if (!c) c = await Store.createCategory(n);
      list.forEach(p => { if (p.cat === nc) p.cat = c.id; });
    }
    for (let i = 0; i < list.length; i++) {
      const p = list[i], head = `Piece ${i + 1} von ${list.length} · ${p.name}`;
      let stagingId = null;
      try {
        busy(head + ' – Ordner wird vorbereitet …');
        stagingId = (await Store.createStaging()).id;
        const slots = { design: null, kleidungsansicht: null, mockup: null }, work = [];
        const files = p.files.filter(f => f.role !== 'weg');
        for (let k = 0; k < files.length; k++) {
          const f = files[k], fname = f.rel.split('/').pop();
          busy(`${head} – Datei ${k + 1} von ${files.length}: ${fname}`);
          const blob = await f.entry.getBlob();
          const up = await Store.uploadToStaging(stagingId, new File([blob], fname, { type: blob.type || '' }));
          if (ROLES.includes(f.role)) slots[f.role] = { art: 'upload', item: up.item, ext: up.ext };
          else work.push({ art: 'upload', item: up.item, origName: fname });
        }
        const missing = ROLES.filter(r => !slots[r]);
        const nummer = p.wantNr && !Store.numberOwner(p.wantNr) ? p.wantNr : Store.nextNumber();
        const extra = Object.assign({}, p.extra);
        const saved = await Store.save({
          mode: 'neu', key: null, stagingId, nummer, name: p.name.trim(), motivtitel: p.motivtitel, catId: p.cat, serie: p.serie,
          beschreibung: p.beschreibung, schlagwoerter: p.schlagwoerter, entwurf: st.entwurf || missing.length > 0, vorlage_von: null,
          slots, work, extra, herkunft: `Am Handy importiert am ${label} aus „${st.sourceName}“ (${p.source}).`
        }, msg => busy(head + ' – ' + msg));
        ok.push({ p, saved });
      } catch (e) {
        bad.push({ p, msg: e && e.message ? e.message : String(e) });
        if (stagingId) await Store.discardStaging(stagingId);
        if (e && (e.code === 'login_required' || e.status === 401)) break;
      }
    }
  } catch (e) {
    bad.push({ p: { name: 'Kleidungstyp' }, msg: e.message || String(e) });
  } finally {
    unbusy();
    window.removeEventListener('beforeunload', warn);
    if (lock) lock.release().catch(() => {});
  }
  await closeImport(true);
  rerender();
  const body = `<p><b>${ok.length}</b> von ${list.length} ${list.length === 1 ? 'Piece' : 'Pieces'} importiert.</p>
    ${ok.length ? '<div class="filelist">' + ok.map(o => `<div class="filerow"><div class="fn">${o.saved ? pad3(o.saved.nummer) + ' · ' : ''}${esc(o.p.name)}<small>${o.saved ? esc(o.saved.kategorie + '/' + o.saved.folderName) + (o.saved.entwurf ? ' · Entwurf' : '') : ''}</small></div></div>`).join('') + '</div>' : ''}
    ${bad.length ? `<div class="section-title">Nicht importiert (${bad.length})</div>` + bad.map(b => `<p class="hint error"><b>${esc(b.p.name)}:</b> ${esc(b.msg)}</p>`).join('') : ''}`;
  sheet({ title: 'Import abgeschlossen', body, buttons: [{ label: 'Fertig', cls: 'primary' }] });
}
