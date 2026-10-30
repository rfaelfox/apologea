/* APOLOGEA Kollektionsverwaltung (PC) – Pieces importieren aus ZIP-Dateien, Ordnern oder einzelnen Dateien
   Gleiche Erkennungsregeln wie in der Handy-App (ZIP-Leser und Zuordnung unverändert übernommen).
   Gespeichert wird über /api/upload und /api/speichern – also genau wie beim Anlegen im Formular. */
'use strict';

const DATA_FILE = 'Produktdaten.json';
// Namensregeln wie im Programm (Windows-sichere Ordnernamen, ü → ue)
const Names = (() => {
  const RESERVED = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
  function translit(s) {
    return String(s || '').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
      .normalize('NFD').replace(/\p{Mn}/gu, '').normalize('NFC');
  }
  function segment(s, max) {
    s = translit(String(s || '').trim());
    let r = '';
    for (const c of s) {
      const code = c.codePointAt(0);
      if (code < 32 || '<>:"/\\|?*'.includes(c) || /\s/.test(c)) r += '_';
      else if (code > 126) r += /[\p{L}\p{N}]/u.test(c) ? c : '_';
      else r += c;
    }
    while (r.includes('__')) r = r.replace(/__/g, '_');
    r = r.replace(/^[_. ]+|[_. ]+$/g, '');
    if (r.length > max) r = r.slice(0, max).replace(/[_. ]+$/, '');
    if (RESERVED.includes(r.toUpperCase())) r += '_';
    return r;
  }
  function folderFor(nummer, name, motiv) {
    let n = segment(name, 40) || 'Ohne_Namen';
    const m = segment(motiv, 40);
    let res = String(nummer).padStart(3, '0') + '_' + n + (m ? '_' + m : '');
    if (res.length > 80) res = res.slice(0, 80).replace(/[_.]+$/, '');
    return res;
  }
  function category(name) {
    let s = translit(String(name || '').trim()).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '');
    while (s.includes('  ')) s = s.replace(/  /g, ' ');
    s = s.trim().replace(/^[._]+|[._]+$/g, '').trim();
    return s.slice(0, 40).trim();
  }
  function file(name) {
    const i = name.lastIndexOf('.');
    let stem = i > 0 ? name.slice(0, i) : name, ext = i > 0 ? name.slice(i + 1) : '';
    stem = stem.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').trim().replace(/\.+$/, '') || 'Datei';
    if (stem.length > 100) stem = stem.slice(0, 100).trim();
    if (RESERVED.includes(stem.toUpperCase())) stem += '_';
    ext = segment(ext, 12).toLowerCase();
    return ext ? stem + '.' + ext : stem;
  }
  return { segment, folderFor, category, file, translit };
})();


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

// ---------------------------------------------------------------- Oberfläche (PC)
const Imp = { st: null };

/** Abgelegte Dateien und Ordner einsammeln (Ordner rekursiv, relative Pfade bleiben erhalten) */
async function impFilesFromDrop(dt) {
  const entries = [...(dt.items || [])].filter(i => i.kind === 'file').map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!entries.length) return [...(dt.files || [])];
  const out = [];
  const walk = async (entry, prefix) => {
    if (entry.isFile) { const f = await new Promise((res, rej) => entry.file(res, rej)); f._rel = prefix + f.name; out.push(f); return; }
    if (!entry.isDirectory) return;
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) await walk(e, prefix + entry.name + '/');
    }
  };
  for (const e of entries) await walk(e, '');
  return out;
}
const impRel = f => f._rel || f.webkitRelativePath || f.name;
const plainEntries = files => files.map((f, i) => ({ path: impRel(f), size: f.size, key: i, getBlob: async () => f }));

function openImport() {
  if (!S.data) return;
  const body = document.createElement('div');
  body.innerHTML = `<p class="muted" style="margin-top:0">Mehrere neue Pieces auf einmal hinzufügen – mit derselben Erkennung wie in der Handy-App. Am besten <b>ein Ordner pro Piece</b> (z. B. <span class="mono">SERAPHIM\\Design.png, Mockup.jpg …</span>), gern auch in Kleidungstyp-Ordnern. Ordner aus dem Programm mit <span class="mono">Produktdaten.json</span> werden samt Beschreibung übernommen. Vor dem Speichern sehen Sie eine Vorschau.</p>
    <div class="multi-drop imp-drop" id="imp-drop">${icon('upload')}<div><b>ZIP-Dateien, Ordner oder Bilder hierher ziehen</b><br><span class="muted">oder unten auswählen</span></div></div>
    <div class="btn-row" style="margin-top:14px"><button class="btn gold" data-src="zip">${icon('archive')}ZIP-Datei wählen</button><button class="btn" data-src="dir">${icon('folder')}Ordner wählen</button><button class="btn" data-src="files">${icon('image')}Einzelne Dateien wählen</button></div>`;
  modal({
    title: 'Pieces importieren', wide: true, body, buttons: [{ label: 'Abbrechen', value: null }],
    onOpen: (back, close) => {
      const pick = (accept, dir) => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.multiple = true;
        if (accept) inp.accept = accept;
        if (dir) inp.webkitdirectory = true;
        inp.onchange = () => { const fl = [...(inp.files || [])]; if (fl.length) { close(null); analyzeImport(fl); } };
        inp.click();
      };
      $('[data-src="zip"]', body).onclick = () => pick('.zip,application/zip,application/x-zip-compressed');
      $('[data-src="dir"]', body).onclick = () => pick(null, true);
      $('[data-src="files"]', body).onclick = () => pick(null, false);
      const drop = $('#imp-drop', body);
      drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', async e => {
        e.preventDefault(); drop.classList.remove('over');
        const fl = await impFilesFromDrop(e.dataTransfer);
        if (fl.length) { close(null); analyzeImport(fl); }
      });
    }
  });
}

async function analyzeImport(fileList) {
  busy('Dateien werden gelesen …');
  try {
    // Jede ZIP und die übrigen Dateien werden getrennt ausgewertet, damit sich nichts vermischt
    const zips = fileList.filter(f => extOf(f.name) === 'zip');
    const plain = fileList.filter(f => extOf(f.name) !== 'zip');
    const sources = [];
    for (const z of zips) { busy(`„${z.name}“ wird geöffnet …`); sources.push({ label: z.name, entries: await Zip.read(z) }); }
    if (plain.length) { const r0 = impRel(plain[0]); sources.push({ label: r0.includes('/') ? r0.split('/')[0] : 'Auswahl', entries: plainEntries(plain) }); }
    const multi = sources.length > 1;
    const groups = [];
    let fileCount = 0;
    sources.forEach(s => { fileCount += s.entries.length; ImportRules.group(s.entries, S.data.kategorien).forEach(g => groups.push(Object.assign(g, { srcLabel: s.label.replace(/\.zip$/i, ''), source: (multi ? s.label + ' › ' : '') + (g.dir || 'oberste Ebene') }))); });
    if (!groups.length) { unbusy(); toast('In der Auswahl wurden keine Dateien gefunden.', 'err'); return; }
    busy('Zuordnung wird vorbereitet …');
    const usedNr = new Set(S.data.pieces.map(p => p.nummer));
    const pieces = [];
    for (const g of groups) {
      let data = null;
      if (g.json) { try { data = JSON.parse((await (await g.json.getBlob()).text()).replace(/^﻿/, '')); } catch (e) { data = null; } }
      const lab = ImportRules.parseLabel(g.label);
      const name = String((data && data.name) || lab.name || 'Ohne Namen').trim().slice(0, 60);
      const catName = String((data && data.kategorie) || g.catName || '').trim();
      const cat = catName ? S.data.kategorien.find(c => ImportRules.catKey(c.name) === ImportRules.catKey(catName)) : null;
      let wantNr = parseInt(data && data.nummer, 10) || lab.nummer || 0;
      if (wantNr && usedNr.has(wantNr)) wantNr = 0;
      if (wantNr) usedNr.add(wantNr);
      const dup = S.data.pieces.find(p => norm(p.name) === norm(name) && (!cat || p.kategorie === cat.name));
      pieces.push({
        on: !dup, dup: dup ? `${dup.nummerText} · ${dup.name} in ${dup.kategorie}` : '',
        name, wantNr, motivtitel: String((data && data.motivtitel) || '').trim(), serie: String((data && data.serie) || '').trim(),
        beschreibung: String((data && data.beschreibung) || ''), schlagwoerter: data && Array.isArray(data.schlagwoerter) ? data.schlagwoerter.map(String) : [],
        extra: data || {}, cat: cat ? cat.name : catName ? '__neu:' + Names.category(catName) : '',
        // Mann/Frau: aus der Produktdaten.json, sonst aus Ordner- bzw. ZIP-Namen wie „Damen“ oder „Herren“ (nicht aus dem Piece-Namen)
        zielgruppe: ZG.norm(data && data.zielgruppe) || ZG.guess(String(g.dir || '').split('/').filter(x => x && x !== g.label).concat([g.srcLabel])),
        source: g.source, files: ImportRules.assignRoles(g.files, data && data.bilder)
      });
    }
    pieces.sort((a, b) => a.source.localeCompare(b.source, 'de', { numeric: true }) || a.name.localeCompare(b.name, 'de'));
    unbusy();
    Imp.st = { pieces, entwurf: true, sourceName: sources.map(s => s.label).join(', ').slice(0, 120), fileCount, urls: [] };
    renderImport();
  } catch (e) { unbusy(); toastErr(e, 'Import nicht möglich'); }
}

const impMissing = p => ROLES.filter(r => !p.files.some(f => f.role === r));

function impCatOptions(sel) {
  const news = [...new Set(Imp.st.pieces.map(p => p.cat).filter(c => c.startsWith('__neu:')))];
  return `<option value="">Kleidungstyp wählen …</option>${S.data.kategorien.map(c => `<option value="${esc(c.name)}" ${c.name === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
    ${news.map(n => `<option value="${esc(n)}" ${n === sel ? 'selected' : ''}>＋ Neu anlegen: ${esc(n.slice(6))}</option>`).join('')}<option value="__ask">＋ Anderer neuer Kleidungstyp …</option>`;
}

function impZgOptions(sel, withOpen) {
  return `<option value="">${withOpen ? 'Nicht zugeordnet' : 'Bitte wählen …'}</option>` + ZG.LIST.map(([v, l]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${l}</option>`).join('');
}

function renderImport() {
  const st = Imp.st;
  let v = $('#import');
  if (!v) { v = document.createElement('div'); v.id = 'import'; v.className = 'view'; $('#layer').appendChild(v); }
  const scroll = $('.view-body', v) ? $('.view-body', v).scrollTop : 0;
  const on = st.pieces.filter(p => p.on);
  const open = st.focus ? st.pieces.filter((p, i) => st.focus.has(i) && p.on && !p.cat).length : 0;
  const roleSel = (pi, fi, cur) => `<select class="input imp-role" data-p="${pi}" data-f="${fi}">${ROLES.map(r => `<option value="${r}" ${r === cur ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}<option value="arbeitsdatei" ${cur === 'arbeitsdatei' ? 'selected' : ''}>Arbeitsdatei</option><option value="weg" ${cur === 'weg' ? 'selected' : ''}>Nicht importieren</option></select>`;
  v.innerHTML = `
    <div class="view-head"><button class="btn ghost" id="i-cancel">${icon('back')}Abbrechen</button><div class="spacer"></div><h2 style="margin:0">Pieces importieren</h2><div class="spacer"></div><span class="muted">${on.length} von ${st.pieces.length} ausgewählt</span></div>
    <div class="view-body"><div class="view-inner">
      ${st.focus ? `<div class="notice-bar imp-focus ${open ? '' : 'done'}">${icon(open ? 'warn' : 'check')}<span>${open ? `<b>${open === 1 ? '1 Piece hat' : open + ' Pieces haben'} noch keinen Kleidungstyp.</b> Es werden nur diese angezeigt – bitte zuordnen.` : '<b>Alle zugeordnet.</b> Jetzt unten auf „importieren“ klicken.'}</span><button class="btn small ghost" id="i-all">Alle anzeigen</button></div>`
        : `<p class="muted" style="margin-top:0"><span class="mono">${esc(st.sourceName)}</span> · ${st.fileCount} Dateien · <b>${st.pieces.length} Pieces erkannt</b>. Bitte Namen, Kleidungstyp und Bildzuordnung prüfen.</p>`}
      <div class="imp-top-row">
        <div class="field" style="margin:0"><label for="i-allcat">Kleidungstyp für alle ohne Zuordnung</label><select class="input" id="i-allcat" style="min-width:280px">${impCatOptions('')}</select></div>
        ${st.focus ? '' : `<div class="field" style="margin:0"><label for="i-allzg">Mann / Frau für alle ohne Zuordnung</label><select class="input" id="i-allzg" style="min-width:220px">${impZgOptions('')}</select></div>`}
        ${st.focus ? '' : `<label class="checkbox"><input type="checkbox" id="i-draft" ${st.entwurf ? 'checked' : ''}><span>Alle als <b>Entwurf</b> speichern (empfohlen – danach kurz prüfen)</span></label>`}
      </div>
      <div class="imp-grid">
      ${st.pieces.map((p, pi) => {
        if (st.focus && !st.focus.has(pi)) return '';
        const miss = impMissing(p);
        return `<div class="imp-card ${p.on ? '' : 'off'}">
          <label class="checkbox imp-head"><input type="checkbox" data-on="${pi}" ${p.on ? 'checked' : ''}><span class="mono faint">${esc(p.source)}</span></label>
          ${p.dup ? `<div class="hint warn" style="margin:0 0 10px">Gibt es vermutlich schon: <b>${esc(p.dup)}</b>. Deshalb abgewählt – bei Bedarf wieder anhaken.</div>` : ''}
          <div class="imp-body">
            <div class="imp-thumbs">${ROLES.map(r => { const f = p.files.find(x => x.role === r); return `<div class="imp-thumb ${r === 'design' ? 'design-bg bg-' + S.designBg : ''}" data-thumb="${pi}:${r}">${f ? '' : `<span>${ROLE_SHORT[r]}<br>fehlt</span>`}<small>${ROLE_SHORT[r]}</small></div>`; }).join('')}</div>
            <div class="imp-fields">
              <div class="field"><label>Produktname</label><input class="input" data-name="${pi}" value="${esc(p.name)}" maxlength="60" autocomplete="off"></div>
              <div class="field"><label>Kleidungstyp</label><select class="input ${p.on && !p.cat ? 'invalid' : ''}" data-cat="${pi}">${impCatOptions(p.cat)}</select></div>
              <div class="field"><label>Für</label><select class="input" data-zg="${pi}">${impZgOptions(p.zielgruppe, true)}</select></div>
              <div class="hint">${p.wantNr ? `Nummer ${pad3(p.wantNr)} (aus dem Ordnernamen)` : 'Nummer: nächste freie'} · ${miss.length ? `<span style="color:var(--warn)">Entwurf – fehlt: ${miss.map(r => ROLE_LABEL[r]).join(', ')}</span>` : '<span style="color:var(--ok)">alle drei Bilder vorhanden</span>'}</div>
            </div>
          </div>
          <div class="filelist imp-files">${p.files.map((f, fi) => `<div class="filerow"><div class="fn">${esc(f.rel)}<small>${fmtBytes(f.size || 0)}</small></div>${roleSel(pi, fi, f.role)}</div>`).join('')}</div>
        </div>`;
      }).join('')}
      </div>
    </div></div>
    <div class="view-foot"><span class="muted">Dateien werden erst beim Importieren in die Sammlung übernommen.</span><span class="spacer"></span><button class="btn" id="i-cancel2">Abbrechen</button><button class="btn primary" id="i-go" ${on.length ? '' : 'disabled'}>${icon('check')}${on.length === 1 ? '1 Piece' : on.length + ' Pieces'} importieren</button></div>`;
  $('.view-body', v).scrollTop = scroll;
  $('#i-cancel', v).onclick = $('#i-cancel2', v).onclick = () => closeImport();
  if ($('#i-draft', v)) $('#i-draft', v).onchange = e => { st.entwurf = e.target.checked; };
  if ($('#i-all', v)) $('#i-all', v).onclick = () => { st.focus = null; renderImport(); };
  const askNew = async () => { const n = await askText('Neuer Kleidungstyp', 'Name (wird beim Import als Ordner angelegt)', '', 'Umlaute werden für Windows-sichere Ordnernamen umgeschrieben (ü → ue).'); return n ? '__neu:' + Names.category(n) : null; };
  $('#i-allcat', v).onchange = async e => {
    let val = e.target.value;
    if (val === '__ask') { val = await askNew(); if (!val) { e.target.value = ''; return; } }
    if (!val) return;
    st.pieces.forEach(p => { if (!p.cat) p.cat = val; });
    renderImport();
  };
  if ($('#i-allzg', v)) $('#i-allzg', v).onchange = e => { const val = e.target.value; if (!val) return; st.pieces.forEach(p => { if (!p.zielgruppe) p.zielgruppe = val; }); renderImport(); };
  $$('[data-zg]', v).forEach(s => s.onchange = () => { st.pieces[+s.dataset.zg].zielgruppe = s.value; });
  $$('[data-on]', v).forEach(c => c.onchange = () => { st.pieces[+c.dataset.on].on = c.checked; renderImport(); });
  $$('[data-name]', v).forEach(i => i.oninput = () => { st.pieces[+i.dataset.name].name = i.value; });
  $$('[data-cat]', v).forEach(s => s.onchange = async () => {
    const p = st.pieces[+s.dataset.cat];
    if (s.value === '__ask') { const n = await askNew(); if (n) p.cat = n; renderImport(); return; }
    p.cat = s.value; renderImport();
  });
  $$('.imp-role', v).forEach(s => s.onchange = () => {
    const p = st.pieces[+s.dataset.p], f = p.files[+s.dataset.f], r = s.value;
    if (ROLES.includes(r)) p.files.forEach(x => { if (x !== f && x.role === r) x.role = 'arbeitsdatei'; });
    f.role = r; renderImport();
  });
  $('#i-go', v).onclick = runImport;
  loadImportThumbs();
}

async function loadImportThumbs() {
  const st = Imp.st;
  for (const el of $$('#import [data-thumb]')) {
    const [pi, r] = el.dataset.thumb.split(':');
    const f = st.pieces[+pi] && st.pieces[+pi].files.find(x => x.role === r);
    if (!f || !BROWSER_IMG.includes(extOf(f.rel)) || f.size > 40 * 1048576) continue;
    try {
      if (!f.url) { f.url = URL.createObjectURL(await f.entry.getBlob()); st.urls.push(f.url); }
      if (Imp.st !== st || !el.isConnected) return;
      el.insertAdjacentHTML('afterbegin', `<img src="${f.url}" alt="">`);
    } catch (e) { /* Vorschau ist nur Komfort */ }
  }
}

async function closeImport(force) {
  if (!Imp.st) return;
  if (!force && !(await confirmDialog('Import abbrechen?', 'Es wurde noch nichts gespeichert.', 'Import abbrechen', true))) return;
  Imp.st.urls.forEach(u => URL.revokeObjectURL(u));
  Imp.st = null;
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
  if (!(await confirmDialog(`${list.length} ${list.length === 1 ? 'Piece' : 'Pieces'} importieren?`, `Die Pieces werden in die Sammlung eingefügt${st.entwurf ? ' (als Entwurf)' : ''}.`, 'Importieren'))) return;

  const label = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const ok = [], bad = [];
  try {
    // Neue Kleidungstypen zuerst anlegen
    for (const nc of [...new Set(list.map(p => p.cat).filter(c => c.startsWith('__neu:')))]) {
      const n = nc.slice(6);
      busy(`Kleidungstyp „${n}“ wird angelegt …`);
      let c = S.data.kategorien.find(x => ImportRules.catKey(x.name) === ImportRules.catKey(n));
      const name = c ? c.name : (await api('/api/kategorie/neu', { name: n })).name;
      list.forEach(p => { if (p.cat === nc) p.cat = name; });
    }
    if (list.some(p => !S.data.kategorien.some(k => k.name === p.cat))) await loadData();
    for (let i = 0; i < list.length; i++) {
      const p = list[i], head = `Piece ${i + 1} von ${list.length} · ${p.name}`;
      try {
        const bilder = { design: null, kleidungsansicht: null, mockup: null }, work = [];
        const files = p.files.filter(f => f.role !== 'weg');
        for (let k = 0; k < files.length; k++) {
          const f = files[k], fname = f.rel.split('/').pop();
          busy(`${head} – Datei ${k + 1} von ${files.length}: ${fname}`);
          const blob = await f.entry.getBlob();
          const up = await uploadFile(new File([blob], fname, { type: blob.type || '' }));
          if (ROLES.includes(f.role) && up.bild) bilder[f.role] = { art: 'upload', upload: up.upload };
          else work.push({ art: 'upload', upload: up.upload });
        }
        const missing = ROLES.filter(r => !bilder[r]);
        const req = {
          name: p.name.trim(), motivtitel: p.motivtitel, kategorie: p.cat, zielgruppe: p.zielgruppe || '', serie: p.serie, beschreibung: p.beschreibung, schlagwoerter: p.schlagwoerter,
          entwurf: st.entwurf || missing.length > 0, vorlage_von: null, bilder, arbeitsdateien: work, extra: p.extra,
          herkunft: `Am PC importiert am ${label} aus „${st.sourceName}“ (${p.source}).`
        };
        let saved = null;
        for (let attempt = 0; attempt < 3 && !saved; attempt++) {
          busy(head + ' – wird gespeichert …');
          const pv = await api('/api/ordner-vorschau', { kategorie: p.cat, nummer: p.wantNr || 0, name: req.name, motivtitel: req.motivtitel });
          req.nummer = p.wantNr && !pv.nummerVergeben && attempt === 0 ? p.wantNr : pv.naechsteNummer;
          try { saved = (await api('/api/speichern', req)).piece; }
          catch (e) { if (e.status !== 409) throw e; } // Nummer inzwischen vergeben → nächste freie
        }
        if (!saved) throw new Error('Es konnte keine freie Nummer vergeben werden.');
        ok.push({ p, saved });
      } catch (e) { bad.push({ p, msg: e && e.message ? e.message : String(e) }); }
    }
  } catch (e) {
    bad.push({ p: { name: 'Kleidungstyp' }, msg: e.message || String(e) });
  } finally { unbusy(); }
  await closeImport(true);
  try { await loadData(); } catch (e) { /* Anzeige folgt beim nächsten Aktualisieren */ }
  renderSidebar(); renderGrid();
  const body = `<p><b>${ok.length}</b> von ${list.length} ${list.length === 1 ? 'Piece' : 'Pieces'} importiert.</p>
    ${ok.length ? '<div class="filelist" style="max-height:46vh;overflow-y:auto">' + ok.map(o => `<div class="filerow"><div class="fn">${o.saved.nummerText} · ${esc(o.saved.name)}<small>${esc(o.saved.ordner)}${o.saved.status === 'Entwurf' ? ' · Entwurf' : ''}</small></div></div>`).join('') + '</div>' : ''}
    ${bad.length ? `<div class="section-title" style="margin-top:16px">Nicht importiert (${bad.length})</div>` + bad.map(b => `<p class="hint error"><b>${esc(b.p.name)}:</b> ${esc(b.msg)}</p>`).join('') : ''}`;
  modal({ title: 'Import abgeschlossen', wide: true, body, buttons: [{ label: 'Fertig', cls: 'primary', value: null }] });
}
