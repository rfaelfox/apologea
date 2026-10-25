/* APOLOGEA Handy-App – Sammlungslogik
   Liest und schreibt exakt das Format des PC-Programms:
   Sammlung / Kleidungstyp / 171_NAME / Bilder + Produktdaten.json (+ Arbeitsdateien/) */
'use strict';

const ROLES = ['design', 'kleidungsansicht', 'mockup'];
const ROLE_LABEL = { design: 'Designmotiv', kleidungsansicht: 'Kleidungsansicht', mockup: 'Mockup' };
const ROLE_SHORT = { design: 'Design', kleidungsansicht: 'Ansicht', mockup: 'Mockup' };
const ROLE_BASE = { design: 'Design', kleidungsansicht: 'Kleidungsansicht', mockup: 'Mockup' };
const DATA_FILE = 'Produktdaten.json';
const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'svg', 'avif', 'psd', 'heic', 'heif'];
const KNOWN_KEYS = ['format', 'id', 'nummer', 'name', 'motivtitel', 'kategorie', 'serie', 'beschreibung', 'schlagwoerter', 'entwurf', 'bilder', 'arbeitsdateien', 'erstellt', 'geaendert', 'herkunft', 'vorlage_von'];

// ---------------------------------------------------------------- Hilfen (identisch zum PC-Programm)
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

function isoLocal(d) {
  d = d || new Date();
  const p = n => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16))).replace(/-/g, '');
const extOf = n => { const i = String(n || '').lastIndexOf('.'); return i < 0 ? '' : n.slice(i + 1).toLowerCase(); };
const pad3 = n => String(n).padStart(3, '0');

async function detectFormat(blob) {
  const h = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const s = (a, b) => String.fromCharCode(...h.slice(a, b));
  if (h[0] === 0x89 && s(1, 4) === 'PNG') return 'png';
  if (h[0] === 0xFF && h[1] === 0xD8 && h[2] === 0xFF) return 'jpg';
  if (s(0, 3) === 'GIF') return 'gif';
  if (s(0, 4) === 'RIFF' && s(8, 12) === 'WEBP') return 'webp';
  if (s(0, 2) === 'BM') return 'bmp';
  if ((s(0, 2) === 'II' && h[2] === 42) || (s(0, 2) === 'MM' && h[3] === 42)) return 'tif';
  if (s(0, 4) === '8BPS') return 'psd';
  if (s(0, 4) === '%PDF') return 'pdf';
  if (s(4, 8) === 'ftyp') { const b = s(8, 12); if (b === 'avif') return 'avif'; if (/hei|mif1|msf1/.test(b)) return 'heic'; }
  return null;
}

function guessRole(name) {
  const n = String(name).toLowerCase().replace(/\.[^.]+$/, '');
  if (/kleidungsansicht|motivdarstellung|kleidung|ansicht|flat|front|garment/.test(n)) return 'kleidungsansicht';
  if (/mock|model|lifestyle/.test(n)) return 'mockup';
  if (/design|motiv|druck|print|artwork|grafik/.test(n)) return 'design';
  return null;
}

// ---------------------------------------------------------------- Sammlung
const Store = (() => {
  let drive = null;
  const st = { items: new Map(), deltaLink: null, texts: new Map() };
  let kids = new Map();
  let model = { categories: [], pieces: [], fremd: [], trash: [], trashNumbers: new Set(), notes: [] };
  const CACHE_KEY = () => 'apologea.cache.' + drive.kind + '.' + drive.rootId;

  function saveCache() {
    if (drive.kind !== 'onedrive') return;
    try {
      const texts = {};
      st.texts.forEach((v, k) => { texts[k] = v; });
      localStorage.setItem(CACHE_KEY(), JSON.stringify({ items: [...st.items.values()], deltaLink: st.deltaLink, texts, t: Date.now() }));
    } catch (e) { /* Speicher voll: Zwischenspeicher ist nur Komfort */ }
  }
  function loadCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY()) || 'null');
      if (!c) return false;
      st.items = new Map(c.items.map(i => [i.id, i]));
      st.deltaLink = c.deltaLink;
      st.texts = new Map(Object.entries(c.texts || {}));
      return true;
    } catch (e) { return false; }
  }

  function indexKids() {
    kids = new Map();
    st.items.forEach(it => {
      if (!it.parentId) return;
      if (!kids.has(it.parentId)) kids.set(it.parentId, []);
      kids.get(it.parentId).push(it);
    });
  }
  const childrenOf = id => kids.get(id) || [];
  const child = (id, name) => childrenOf(id).find(c => c.name.toLowerCase() === name.toLowerCase());

  function filesRecursive(folderId, prefix, out) {
    for (const c of childrenOf(folderId)) {
      const rel = prefix + c.name;
      if (c.isFolder) filesRecursive(c.id, rel + '/', out);
      else out.set(rel.toLowerCase(), Object.assign({ rel }, c));
    }
    return out;
  }

  async function ensureTexts(ids) {
    const need = ids.filter(id => { const it = st.items.get(id); const c = st.texts.get(id); return it && (!c || c.cTag !== it.cTag); });
    if (!need.length) return;
    const res = await drive.readTexts(need);
    need.forEach(id => { if (res[id] != null) st.texts.set(id, { cTag: st.items.get(id).cTag, text: res[id] }); });
  }

  function parsePiece(jsonItem, folder, cat) {
    const c = st.texts.get(jsonItem.id);
    if (!c) return { error: 'Produktdaten werden noch geladen' };
    let d;
    try { d = JSON.parse(c.text.replace(/^\uFEFF/, '')); } catch (e) { return { error: 'Produktdaten.json ist nicht lesbar' }; }
    const files = filesRecursive(folder.id, '', new Map());
    const p = {
      key: folder.id, raw: d,
      id: d.id || folder.id, nummer: parseInt(d.nummer, 10) || 0, name: String(d.name || '').trim(), motivtitel: String(d.motivtitel || '').trim(),
      kategorie: cat.name, catId: cat.id, serie: d.serie || '', beschreibung: d.beschreibung || '', schlagwoerter: Array.isArray(d.schlagwoerter) ? d.schlagwoerter : [],
      entwurf: !!d.entwurf, erstellt: d.erstellt || jsonItem.modified, geaendert: d.geaendert || jsonItem.modified, herkunft: d.herkunft || '', vorlage_von: d.vorlage_von || null,
      folderId: folder.id, folderName: folder.name, webUrl: folder.webUrl, jsonItem, files,
      bilder: {}, arbeitsdateien: [], unzugeordnet: [], probleme: []
    };
    if (!p.nummer) { const m = folder.name.match(/^(\d+)_/); if (m) p.nummer = +m[1]; }
    const referenced = new Set();
    const b = d.bilder || {};
    ROLES.forEach(r => {
      const rel = b[r] ? String(b[r]).replace(/\\/g, '/') : null;
      if (!rel) { p.bilder[r] = null; p.probleme.push(`Kein Bild für „${ROLE_LABEL[r]}“ hinterlegt.`); return; }
      referenced.add(rel.toLowerCase());
      const f = files.get(rel.toLowerCase()) || null;
      p.bilder[r] = { rel, item: f };
      if (!f) p.probleme.push(`${ROLE_LABEL[r]} fehlt: „${rel}“ wurde im Produktordner nicht gefunden.`);
    });
    (d.arbeitsdateien || []).forEach(a => {
      const rel = String(a).replace(/\\/g, '/');
      referenced.add(rel.toLowerCase());
      const f = files.get(rel.toLowerCase()) || null;
      p.arbeitsdateien.push({ rel, item: f });
      if (!f) p.probleme.push(`Arbeitsdatei fehlt: „${rel}“.`);
    });
    files.forEach((f, k) => {
      const nm = f.name;
      if (/^(produktdaten\.json|_papierkorb-info\.json|desktop\.ini|thumbs\.db|\.ds_store)$/i.test(nm) && !f.rel.includes('/')) return;
      if (nm.startsWith('.neu_') || nm.includes('.schreiben-')) return;
      if (!referenced.has(k)) p.unzugeordnet.push({ rel: f.rel, item: f });
    });
    const missing = ROLES.some(r => !p.bilder[r] || !p.bilder[r].item);
    p.status = p.entwurf ? 'Entwurf' : missing ? 'Unvollständig' : 'Vollständig';
    return p;
  }

  async function rebuild() {
    indexKids();
    const root = drive.rootId;
    const cats = childrenOf(root).filter(c => c.isFolder && !/^[._]/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    const jsonIds = [];
    const pieceFolders = [];
    const fremd = [];
    cats.forEach(cat => childrenOf(cat.id).filter(f => f.isFolder && !f.name.startsWith('.')).forEach(f => {
      const j = child(f.id, DATA_FILE);
      if (j && !j.isFolder) { jsonIds.push(j.id); pieceFolders.push([j, f, cat]); }
      else fremd.push({ ordner: cat.name + '/' + f.name, kategorie: cat.name, folderId: f.id });
    }));
    // Papierkorb
    const trash = [];
    const tr = child(root, '_Papierkorb');
    const trP = tr && child(tr.id, 'Pieces');
    if (trP) childrenOf(trP.id).filter(f => f.isFolder).forEach(f => {
      const j = child(f.id, DATA_FILE), info = child(f.id, '_Papierkorb-Info.json');
      if (j) jsonIds.push(j.id);
      if (info) jsonIds.push(info.id);
      trash.push({ folder: f, json: j, info });
    });
    await ensureTexts(jsonIds);
    const pieces = [];
    const notes = [];
    pieceFolders.forEach(([j, f, cat]) => {
      const p = parsePiece(j, f, cat);
      if (p.error) fremd.push({ ordner: cat.name + '/' + f.name, kategorie: cat.name, folderId: f.id, fehler: p.error });
      else pieces.push(p);
    });
    // doppelte Nummern
    const byNr = new Map();
    pieces.forEach(p => { if (!byNr.has(p.nummer)) byNr.set(p.nummer, []); byNr.get(p.nummer).push(p); });
    byNr.forEach(list => { if (list.length > 1) list.forEach(p => p.probleme.push(`Doppelte Nummer ${pad3(p.nummer)} – ebenfalls vergeben an: ${list.filter(o => o !== p).map(o => o.kategorie + '/' + o.folderName).join(', ')}.`)); });
    const trashNumbers = new Set();
    const trashList = trash.map(t => {
      let d = {}, info = {};
      try { d = JSON.parse(st.texts.get(t.json.id).text); } catch (e) { /* unlesbar */ }
      try { if (t.info) info = JSON.parse(st.texts.get(t.info.id).text); } catch (e) { /* unlesbar */ }
      const nr = parseInt(d.nummer, 10);
      if (nr) trashNumbers.add(nr);
      return { folder: t.folder, nummer: nr || 0, name: d.name || t.folder.name, kategorie: info.kategorie || d.kategorie || '', geloescht: info.geloescht || t.folder.modified, ursprungsordner: info.ursprungsordner || '', data: d, json: t.json, info: t.info };
    }).sort((a, b) => String(b.geloescht).localeCompare(String(a.geloescht)));
    model = { categories: cats.map(c => ({ id: c.id, name: c.name, anzahl: pieces.filter(p => p.catId === c.id).length })), pieces: pieces.sort((a, b) => a.nummer - b.nummer), fremd, trash: trashList, trashNumbers, notes };
    saveCache();
    return model;
  }

  async function open(d, path, id) {
    drive = d;
    const info = id ? await drive.openId(id) : await drive.openPath(path);
    loadCache();
    return info;
  }

  /** Nur aus dem Zwischenspeicher aufbauen (schnelle Anzeige, auch offline). */
  async function fromCache() {
    if (!st.items.size) return null;
    try { return await rebuild(); } catch (e) { return null; }
  }

  async function refresh() {
    const before = new Map([...st.items.values()].map(i => [i.id, i.eTag]));
    const r = await drive.sync(st);
    let changed = 0;
    if (!r.full) st.items.forEach((it, id) => { if (before.get(id) !== it.eTag) changed++; });
    await rebuild();
    return { full: r.full, changed };
  }

  // ---------------------------------------------------------------- Nummern und Namen
  function nextNumber() {
    let max = 0;
    model.pieces.forEach(p => { max = Math.max(max, p.nummer); });
    model.trashNumbers.forEach(n => { max = Math.max(max, n); });
    model.fremd.forEach(f => { const m = f.ordner.split('/')[1].match(/^(\d+)_/); if (m && +m[1] < 100000) max = Math.max(max, +m[1]); });
    return max + 1;
  }
  function numberOwner(n, exceptKey) {
    const p = model.pieces.find(x => x.nummer === n && x.key !== exceptKey);
    if (p) return `${pad3(p.nummer)} · ${p.name} in ${p.kategorie}`;
    if (model.trashNumbers.has(n)) return 'ein Piece im Papierkorb';
    return null;
  }

  // ---------------------------------------------------------------- Ordner-Hilfen
  async function ensureFolder(parentId, name) {
    const ex = child(parentId, name);
    if (ex && ex.isFolder) return ex;
    try {
      const f = await drive.createFolder(parentId, name);
      st.items.set(f.id, f); indexKids();
      return f;
    } catch (e) {
      if (e.code === 'exists') { await drive.sync(st); indexKids(); const again = child(parentId, name); if (again) return again; }
      throw e;
    }
  }
  async function uniqueMove(itemId, parentId, name, isFolder) {
    const dot = !isFolder && name.lastIndexOf('.') > 0 ? name.lastIndexOf('.') : name.length;
    const stem = name.slice(0, dot), ext = name.slice(dot);
    for (let i = 1; i < 50; i++) {
      const n = i === 1 ? name : isFolder ? `${name}_${i}` : `${stem} (${i})${ext}`;
      try { const r = await drive.move(itemId, parentId, n); st.items.set(r.id, Object.assign({}, st.items.get(r.id) || {}, r, { parentId: parentId || (st.items.get(r.id) || {}).parentId })); return r; }
      catch (e) { if (e.code !== 'exists') throw e; }
    }
    throw new DriveError('Kein freier Name gefunden.', 409);
  }
  async function uniqueUpload(parentId, name, blob, onP) {
    const dot = name.lastIndexOf('.') > 0 ? name.lastIndexOf('.') : name.length;
    for (let i = 1; i < 50; i++) {
      const n = i === 1 ? name : `${name.slice(0, dot)} (${i})${name.slice(dot)}`;
      try { const r = await drive.upload(parentId, n, blob, onP); st.items.set(r.id, Object.assign({ parentId }, r)); return r; }
      catch (e) { if (e.code !== 'exists') throw e; }
    }
    throw new DriveError('Kein freier Dateiname gefunden.', 409);
  }

  // ---------------------------------------------------------------- Zwischenablage für das Formular
  /** Neue Bilder werden sofort in einen eigenen Zwischenordner hochgeladen und beim Speichern nur noch verschoben. */
  async function createStaging() {
    const meta = await ensureFolder(drive.rootId, '.apologea');
    return ensureFolder(meta.id, 'mobil_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  }
  async function uploadToStaging(stagingId, file, onP) {
    const fmt = await detectFormat(file);
    let origExt = extOf(file.name);
    if (origExt === 'jpeg') origExt = 'jpg';
    if (origExt === 'tiff') origExt = 'tif';
    const ext = fmt || origExt;
    const tmpName = 'upload_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + (ext ? '.' + ext : '');
    const it = await drive.upload(stagingId, tmpName, file, onP);
    st.items.set(it.id, Object.assign({ parentId: stagingId }, it));
    return { item: it, ext, format: fmt, endungKorrigiert: !!(fmt && origExt && fmt !== origExt) };
  }
  async function discardStaging(stagingId) {
    if (!stagingId) return;
    try { await drive.remove(stagingId); st.items.delete(stagingId); } catch (e) { /* bleibt liegen, wird später aufgeräumt */ }
  }
  /** Reste abgebrochener Formulare (älter als 1 Tag) entfernen. */
  async function cleanupStaging() {
    const meta = child(drive.rootId, '.apologea');
    if (!meta) return;
    const old = childrenOf(meta.id).filter(f => f.isFolder && f.name.startsWith('mobil_') && Date.now() - new Date(f.modified).getTime() > 86400000);
    for (const f of old) await discardStaging(f.id);
  }

  async function blobOf(item) {
    const url = await drive.fileUrl(item.id);
    if (!url) throw new DriveError('Datei konnte nicht geladen werden.', 404);
    const r = await fetch(url);
    if (!r.ok) throw new DriveError('Datei konnte nicht geladen werden.', r.status);
    return r.blob();
  }

  // ---------------------------------------------------------------- Speichern
  function pieceJson(p) {
    const d = {
      format: 'APOLOGEA-Piece/1', id: p.id, nummer: p.nummer, name: p.name, motivtitel: p.motivtitel, kategorie: p.kategorie, serie: p.serie,
      beschreibung: p.beschreibung, schlagwoerter: p.schlagwoerter, entwurf: p.entwurf,
      bilder: { design: p.bilder.design || null, kleidungsansicht: p.bilder.kleidungsansicht || null, mockup: p.bilder.mockup || null },
      arbeitsdateien: p.arbeitsdateien, erstellt: p.erstellt, geaendert: p.geaendert, herkunft: p.herkunft, vorlage_von: p.vorlage_von
    };
    Object.keys(p.extra || {}).forEach(k => { if (!KNOWN_KEYS.includes(k)) d[k] = p.extra[k]; });
    return JSON.stringify(d, null, 2) + '\n';
  }

  /**
   * f: { mode, key (bei Bearbeiten), stagingId, nummer, name, motivtitel, catId, serie, beschreibung, schlagwoerter, entwurf, vorlage_von,
   *      slots: { role: {art:'behalten', rel} | {art:'upload', item, ext} | {art:'kopie', item, ext} | null }, work: [ ... ] }
   */
  async function save(f, progress) {
    progress = progress || (() => {});
    progress('Aktuellen Stand aus OneDrive prüfen …');
    await drive.sync(st); await rebuild();
    const name = f.name.trim();
    if (!name) throw new Error('Bitte einen Produktnamen eingeben.');
    if (!Names.segment(name, 40)) throw new Error('Der Produktname muss mindestens einen Buchstaben oder eine Ziffer enthalten.');
    const cat = model.categories.find(c => c.id === f.catId);
    if (!cat) throw new Error('Bitte einen vorhandenen Kleidungstyp auswählen.');
    if (!f.nummer || f.nummer < 1 || f.nummer > 99999) throw new Error('Bitte eine gültige Piece-Nummer eingeben.');
    const old = f.key ? model.pieces.find(p => p.key === f.key) : null;
    if (f.key && !old) throw new Error('Das Piece wurde inzwischen verschoben oder gelöscht. Bitte neu laden.');
    if (old && f.baseETag && old.jsonItem.eTag !== f.baseETag) throw new Error('Dieses Piece wurde inzwischen an einem anderen Gerät geändert. Bitte das Formular schließen, neu laden und die Änderung erneut vornehmen.');
    const owner = numberOwner(f.nummer, f.key);
    if (owner) throw new Error(`Die Nummer ${pad3(f.nummer)} ist bereits vergeben (${owner}). Frei wäre z. B. ${pad3(nextNumber())}.`);
    const missing = ROLES.filter(r => !f.slots[r]);
    if (!f.entwurf && missing.length) throw new Error('Für ein vollständiges Piece fehlen noch: ' + missing.map(r => ROLE_LABEL[r]).join(', ') + '.');

    const now = isoLocal();
    const tpl = f.vorlage_von ? model.pieces.find(p => p.id === f.vorlage_von) : null;
    const data = {
      id: old ? old.id : newId(), nummer: f.nummer, name, motivtitel: f.motivtitel.trim(), kategorie: cat.name, serie: f.serie.trim(),
      beschreibung: f.beschreibung.replace(/\r\n/g, '\n').trim(), schlagwoerter: f.schlagwoerter, entwurf: !!f.entwurf,
      erstellt: old ? old.erstellt : now, geaendert: now,
      herkunft: old ? old.herkunft : f.herkunft || 'Am Handy erstellt am ' + new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) + (tpl ? ' nach Vorlage ' + pad3(tpl.nummer) + ' · ' + tpl.name + '.' : '.'),
      vorlage_von: old ? old.vorlage_von : (tpl ? tpl.id : null),
      extra: old ? old.raw : f.extra || {}, bilder: {}, arbeitsdateien: []
    };
    // Kopien aus einer Vorlage zuerst in den Zwischenordner holen
    const all = ROLES.map(r => f.slots[r]).concat(f.work).filter(Boolean);
    for (const s of all) {
      if (s.art !== 'kopie') continue;
      progress('Vorlagedatei „' + s.item.name + '“ wird kopiert …');
      const blob = await blobOf(s.item);
      const up = await uploadToStaging(f.stagingId, new File([blob], s.item.name));
      s.art = 'upload'; s.item = up.item; s.ext = up.ext;
    }
    // Im Formular ersetzte oder entfernte Uploads nicht mit in den Produktordner nehmen
    indexKids();
    const used = new Set(ROLES.map(r => f.slots[r]).concat(f.work).filter(s => s && s.art === 'upload').map(s => s.item.id));
    for (const c of childrenOf(f.stagingId)) if (!used.has(c.id)) { try { await drive.remove(c.id); st.items.delete(c.id); } catch (e) { /* egal */ } }
    return old ? update(old, f, data, cat, progress) : create(f, data, cat, progress);
  }

  async function create(f, data, cat, progress) {
    const stagingId = f.stagingId;
    progress('Dateien werden benannt …');
    for (const r of ROLES) {
      const s = f.slots[r];
      if (!s) { data.bilder[r] = null; continue; }
      const res = await uniqueMove(s.item.id, null, ROLE_BASE[r] + (s.ext ? '.' + s.ext : ''), false);
      data.bilder[r] = res.name;
    }
    if (f.work.length) {
      const wd = await ensureFolder(stagingId, 'Arbeitsdateien');
      for (const s of f.work) {
        const res = await uniqueMove(s.item.id, wd.id, Names.file(s.origName || s.item.name), false);
        data.arbeitsdateien.push('Arbeitsdateien/' + res.name);
      }
    }
    progress('Produktdaten werden geschrieben …');
    await drive.writeText(stagingId, DATA_FILE, pieceJson(data));
    progress('Produktordner wird angelegt …');
    const leaf = Names.folderFor(data.nummer, data.name, data.motivtitel);
    const moved = await uniqueMove(stagingId, cat.id, leaf, true);
    await refresh();
    return model.pieces.find(p => p.folderId === moved.id);
  }

  async function update(old, f, data, cat, progress) {
    const undo = [];
    let folderId = old.folderId;
    try {
      // 1. Ordner umbenennen bzw. verschieben
      const rename = old.name !== data.name || old.motivtitel !== data.motivtitel || old.nummer !== data.nummer;
      const leaf = rename ? Names.folderFor(data.nummer, data.name, data.motivtitel) : old.folderName;
      if (leaf !== old.folderName || cat.id !== old.catId) {
        progress('Produktordner wird umbenannt …');
        const res = await uniqueMove(old.folderId, cat.id !== old.catId ? cat.id : null, leaf, true);
        undo.push(() => drive.move(old.folderId, old.catId, old.folderName));
        folderId = res.id;
      }
      // 2. Nicht mehr verwendete Dateien in den Papierkorb der Sammlung
      const kept = new Set(ROLES.map(r => f.slots[r]).concat(f.work).filter(s => s && s.art === 'behalten').map(s => s.rel.toLowerCase()));
      const oldRefs = ROLES.map(r => old.bilder[r]).concat(old.arbeitsdateien).filter(x => x && x.item);
      const toTrash = oldRefs.filter(x => !kept.has(x.rel.toLowerCase()));
      if (toTrash.length) {
        progress('Ersetzte Dateien werden in den Papierkorb gelegt …');
        const tr = await ensureFolder(drive.rootId, '_Papierkorb');
        const trF = await ensureFolder(tr.id, 'Dateien');
        const stamp = isoLocal().slice(0, 19).replace('T', '_').replace(/:/g, '').replace(/-/g, '-');
        const batch = await ensureFolder(trF.id, stamp + '_' + Names.folderFor(old.nummer, old.name, ''));
        for (const x of toTrash) {
          const parent = x.item.parentId;
          const r = await uniqueMove(x.item.id, batch.id, x.item.name, false);
          undo.push(() => drive.move(x.item.id, parent, x.item.name));
          void r;
        }
      }
      // 3. Neue Dateien an ihren Platz
      progress('Neue Dateien werden einsortiert …');
      for (const r of ROLES) {
        const s = f.slots[r];
        if (!s) { data.bilder[r] = null; continue; }
        if (s.art === 'behalten') { data.bilder[r] = s.rel; continue; }
        const res = await uniqueMove(s.item.id, folderId, ROLE_BASE[r] + (s.ext ? '.' + s.ext : ''), false);
        undo.push(() => drive.move(s.item.id, f.stagingId, s.item.name));
        data.bilder[r] = res.name;
      }
      let wd = null;
      for (const s of f.work) {
        if (s.art === 'behalten') { data.arbeitsdateien.push(s.rel); continue; }
        if (!wd) { indexKids(); wd = await ensureFolder(folderId, 'Arbeitsdateien'); }
        const res = await uniqueMove(s.item.id, wd.id, Names.file(s.origName || s.item.name), false);
        undo.push(() => drive.move(s.item.id, f.stagingId, s.item.name));
        data.arbeitsdateien.push('Arbeitsdateien/' + res.name);
      }
      // 4. Produktdaten schreiben (nur wenn niemand zwischendurch geändert hat)
      progress('Produktdaten werden geschrieben …');
      await drive.replaceText(old.jsonItem.id, pieceJson(data), old.jsonItem.eTag);
    } catch (e) {
      for (const u of undo.reverse()) { try { await u(); } catch (x) { /* weiter zurücknehmen */ } }
      e.message = 'Die Änderungen wurden vollständig zurückgenommen. Ursache: ' + e.message;
      throw e;
    }
    await discardStaging(f.stagingId);
    await refresh();
    return model.pieces.find(p => p.folderId === folderId);
  }

  // ---------------------------------------------------------------- Weitere Aktionen
  async function createCategory(name) {
    const safe = Names.category(name);
    if (!safe || !Names.segment(safe, 40)) throw new Error('Bitte einen gültigen Namen für den Kleidungstyp eingeben.');
    if (model.categories.some(c => c.name.toLowerCase() === safe.toLowerCase())) throw new Error(`Den Kleidungstyp „${safe}“ gibt es bereits.`);
    await drive.createFolder(drive.rootId, safe);
    await refresh();
    return model.categories.find(c => c.name === safe);
  }

  async function assign(p, rel, role) {
    const d = Object.assign({}, p.raw);
    d.bilder = Object.assign({}, d.bilder || {});
    d.arbeitsdateien = (d.arbeitsdateien || []).slice();
    if (role === 'arbeitsdatei') { if (!d.arbeitsdateien.some(a => a.toLowerCase() === rel.toLowerCase())) d.arbeitsdateien.push(rel); }
    else { d.bilder[role] = rel; d.arbeitsdateien = d.arbeitsdateien.filter(a => a.toLowerCase() !== rel.toLowerCase()); }
    d.geaendert = isoLocal();
    await drive.replaceText(p.jsonItem.id, JSON.stringify(d, null, 2) + '\n', p.jsonItem.eTag);
    await refresh();
    return model.pieces.find(x => x.key === p.key);
  }

  async function trashPiece(p) {
    await drive.sync(st); await rebuild();
    const cur = model.pieces.find(x => x.key === p.key);
    if (!cur) throw new Error('Das Piece wurde inzwischen verschoben oder gelöscht. Bitte neu laden.');
    const tr = await ensureFolder(drive.rootId, '_Papierkorb');
    const trP = await ensureFolder(tr.id, 'Pieces');
    const stamp = isoLocal().slice(0, 19).replace('T', '_').replace(/:/g, '');
    const moved = await uniqueMove(cur.folderId, trP.id, stamp + '__' + cur.kategorie + '__' + cur.folderName, true);
    const info = { id: cur.id, nummer: cur.nummer, name: cur.name, kategorie: cur.kategorie, ursprungsordner: cur.kategorie + '\\' + cur.folderName, geloescht: isoLocal() };
    try { await drive.writeText(moved.id, '_Papierkorb-Info.json', JSON.stringify(info, null, 2)); } catch (e) { /* Info ist optional */ }
    await refresh();
  }

  async function restore(t) {
    const d = Object.assign({}, t.data);
    let catName = d.kategorie || t.kategorie || 'Wiederhergestellt';
    let cat = model.categories.find(c => c.name === catName);
    if (!cat) { await drive.createFolder(drive.rootId, catName); await refresh(); cat = model.categories.find(c => c.name === catName); }
    let leaf = (t.ursprungsordner || '').split(/[\\/]/).pop() || Names.folderFor(d.nummer, d.name, d.motivtitel);
    let note = '';
    if (model.pieces.some(p => p.nummer === d.nummer)) {
      const oldNr = d.nummer;
      d.nummer = nextNumber();
      leaf = Names.folderFor(d.nummer, d.name, d.motivtitel || '');
      note = ` Die Nummer ${pad3(oldNr)} war inzwischen vergeben; neue Nummer: ${pad3(d.nummer)}.`;
      await drive.replaceText(t.json.id, JSON.stringify(d, null, 2) + '\n', t.json.eTag);
    }
    await uniqueMove(t.folder.id, cat.id, leaf, true);
    if (t.info) { try { await drive.remove(t.info.id); } catch (e) { /* egal */ } }
    await refresh();
    return note;
  }

  async function deleteForever(t) {
    await drive.remove(t.folder.id); // landet zusätzlich im OneDrive-Papierkorb
    await refresh();
  }

  // ---------------------------------------------------------------- Kollektionen (eigene Datei im internen Ordner .apologea)
  // Die Piece-Ordner und Produktdaten.json bleiben unverändert; Pieces werden über ihre id referenziert.
  const COLL_FILE = 'kollektionen.json';
  let collections = [], collTag = null;
  const collItem = () => { const meta = child(drive.rootId, '.apologea'); return meta ? child(meta.id, COLL_FILE) : null; };
  async function readCollections() {
    const f = collItem();
    if (!f) return { data: { format: 'APOLOGEA-Kollektionen/1', kollektionen: [] }, item: null };
    const t = (await drive.readTexts([f.id]))[f.id];
    // Nicht lesbar heißt NICHT leer – sonst würde beim Speichern alles überschrieben
    if (t == null) throw new DriveError('Die Kollektionen konnten nicht geladen werden. Bitte Verbindung prüfen.', 0, 'offline');
    let data;
    try { data = JSON.parse(String(t).replace(/^﻿/, '')); } catch (e) { throw new Error('Die Datei kollektionen.json ist beschädigt und wird nicht überschrieben.'); }
    if (!Array.isArray(data.kollektionen)) data.kollektionen = [];
    return { data, item: f };
  }
  /** Neu laden, wenn sich die Datei (z. B. an einem anderen Gerät) geändert hat */
  async function loadCollections(force) {
    const f = collItem();
    const tag = f ? f.eTag : null;
    if (!force && tag === collTag) return collections;
    const { data } = await readCollections();
    collections = data.kollektionen; collTag = tag;
    return collections;
  }
  /** Ändern mit Schutz vor gleichzeitigen Änderungen: aktuellen Stand lesen, ändern, nur schreiben wenn unverändert */
  async function updateCollections(mutate) {
    for (let attempt = 0; attempt < 3; attempt++) {
      await drive.sync(st); indexKids();
      const { data, item } = await readCollections();
      const result = mutate(data.kollektionen, data);
      data.format = 'APOLOGEA-Kollektionen/1'; data.geaendert = isoLocal();
      const text = JSON.stringify(data, null, 2) + '\n';
      try {
        let r;
        if (item) { r = await drive.replaceText(item.id, text, item.eTag); st.items.set(r.id, Object.assign({}, item, r)); }
        else { const meta = await ensureFolder(drive.rootId, '.apologea'); r = await drive.writeText(meta.id, COLL_FILE, text); st.items.set(r.id, Object.assign({ parentId: meta.id }, r)); indexKids(); }
        collections = data.kollektionen; collTag = r.eTag;
        saveCache();
        return result;
      } catch (e) { if (e.code !== 'conflict' && e.code !== 'exists') throw e; }
    }
    throw new Error('Die Kollektionen wurden gleichzeitig an einem anderen Gerät geändert. Bitte erneut versuchen.');
  }

  return {
    loadCollections, updateCollections, get collections() { return collections; },
    open, fromCache, refresh, nextNumber, numberOwner, save, createCategory, assign, trashPiece, restore, deleteForever,
    createStaging, uploadToStaging, discardStaging, cleanupStaging, blobOf,
    get model() { return model; }, get drive() { return drive; }
  };
})();
