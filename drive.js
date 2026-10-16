/* APOLOGEA Handy-App – Zugriff auf den Sammlungsordner in OneDrive (Microsoft Graph)
   Alle Änderungen werden direkt als Dateien und Ordner im OneDrive gespeichert –
   im selben Aufbau wie am PC. */
'use strict';

class DriveError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

const GraphDrive = (() => {
  const G = 'https://graph.microsoft.com/v1.0';
  const SELECT = 'id,name,parentReference,folder,file,size,eTag,cTag,lastModifiedDateTime,deleted,webUrl';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let rootId = null;
  let rootInfo = null;

  function friendly(status, body) {
    const code = body && body.error && body.error.code;
    if (status === 401) return 'Die Anmeldung ist abgelaufen. Bitte erneut anmelden.';
    if (status === 403) return 'Kein Zugriff auf diesen OneDrive-Ordner.';
    if (status === 404) return 'Datei oder Ordner wurde im OneDrive nicht gefunden. Wurde er inzwischen verschoben oder gelöscht?';
    if (status === 409 || code === 'nameAlreadyExists') return 'Ein Element mit diesem Namen existiert bereits.';
    if (status === 412) return 'Die Datei wurde inzwischen an einem anderen Gerät geändert. Bitte neu laden und erneut versuchen.';
    if (status === 507 || code === 'quotaLimitReached') return 'Der OneDrive-Speicher ist voll.';
    if (status >= 500) return 'OneDrive ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.';
    return (body && body.error && body.error.message) || ('OneDrive-Fehler ' + status);
  }

  async function req(method, url, opts) {
    opts = opts || {};
    for (let attempt = 0; attempt < 5; attempt++) {
      let token;
      try { token = await Auth.token(); }
      catch (e) { throw new DriveError(e.message, 401, 'login_required'); }
      const headers = Object.assign({ Authorization: 'Bearer ' + token }, opts.headers || {});
      let body = opts.body;
      if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.json); }
      let r;
      try { r = await fetch(url.startsWith('http') ? url : G + url, { method, headers, body }); }
      catch (e) {
        if (attempt < 2) { await sleep(800); continue; }
        throw new DriveError('Keine Internetverbindung. Bitte Verbindung prüfen und erneut versuchen.', 0, 'offline');
      }
      if (r.status === 401 && attempt === 0) { localStorage.removeItem('apologea.auth.expires'); continue; }
      if (r.status === 429 || r.status === 503 || r.status === 504) {
        const wait = (+r.headers.get('Retry-After') || (attempt + 1)) * 1000;
        await sleep(Math.min(wait, 10000));
        continue;
      }
      if (r.status === 204) return null;
      const text = await r.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
      if (!r.ok) {
        const code = data && data.error && data.error.code;
        throw new DriveError(friendly(r.status, data), r.status, r.status === 409 ? 'exists' : r.status === 412 ? 'conflict' : code);
      }
      return data;
    }
    throw new DriveError('OneDrive antwortet gerade nicht. Bitte später erneut versuchen.', 503);
  }

  function norm(it) {
    return {
      id: it.id,
      name: it.name,
      parentId: it.parentReference ? it.parentReference.id : null,
      isFolder: !!it.folder,
      size: it.size || 0,
      eTag: it.eTag,
      cTag: it.cTag,
      modified: it.lastModifiedDateTime,
      deleted: !!it.deleted,
      webUrl: it.webUrl
    };
  }

  const encPath = p => p.split('/').filter(Boolean).map(encodeURIComponent).join('/');

  // ---------------------------------------------------------------- Sammlungsordner
  async function openPath(path) {
    const it = await req('GET', '/me/drive/root:/' + encPath(path) + '?$select=' + SELECT);
    if (!it.folder) throw new DriveError('Der gewählte Pfad ist kein Ordner.', 400);
    rootId = it.id;
    rootInfo = norm(it);
    return rootInfo;
  }
  async function openId(id) {
    const it = await req('GET', '/me/drive/items/' + id + '?$select=' + SELECT);
    rootId = it.id;
    rootInfo = norm(it);
    return rootInfo;
  }
  async function listChildren(id) {
    let url = (id ? '/me/drive/items/' + id : '/me/drive/root') + '/children?$select=id,name,folder,parentReference&$top=200';
    const out = [];
    while (url) {
      const d = await req('GET', url);
      d.value.forEach(v => out.push(norm(v)));
      url = d['@odata.nextLink'];
    }
    return out;
  }
  async function hasCollectionMarker(id) {
    try {
      const kids = await listChildren(id);
      const meta = kids.find(k => k.name === '.apologea' && k.isFolder);
      if (!meta) return false;
      const inner = await listChildren(meta.id);
      return inner.some(k => k.name === 'sammlung.json');
    } catch (e) { return false; }
  }

  // ---------------------------------------------------------------- Abgleich (Delta)
  /** Liefert alle Elemente unterhalb der Sammlung. Nach dem ersten Mal werden nur noch Änderungen geladen. */
  async function sync(state) {
    // state: { items: Map, deltaLink }
    let url = state.deltaLink || ('/me/drive/items/' + rootId + '/delta?$select=' + SELECT);
    let fresh = !state.deltaLink;
    if (fresh) state.items = new Map();
    let changes = 0;
    try {
      while (url) {
        const d = await req('GET', url);
        for (const v of d.value) {
          changes++;
          if (v.deleted) state.items.delete(v.id);
          else state.items.set(v.id, norm(v));
        }
        url = d['@odata.nextLink'];
        if (!url) state.deltaLink = d['@odata.deltaLink'];
      }
    } catch (e) {
      if (e.status === 410 || (e.status === 400 && state.deltaLink)) { state.deltaLink = null; return sync(state); }
      if (fresh && (e.status === 400 || e.status === 501 || e.status === 403)) { await fullListing(state); return { changes: state.items.size, full: true }; }
      throw e;
    }
    return { changes: fresh ? state.items.size : changes, full: fresh };
  }

  async function fullListing(state) {
    state.items = new Map();
    state.deltaLink = null;
    const queue = [rootId];
    state.items.set(rootId, rootInfo);
    while (queue.length) {
      const batch = queue.splice(0, 6);
      const lists = await Promise.all(batch.map(async id => {
        let url = '/me/drive/items/' + id + '/children?$select=' + SELECT + '&$top=200';
        const out = [];
        while (url) { const d = await req('GET', url); d.value.forEach(v => out.push(norm(v))); url = d['@odata.nextLink']; }
        return out;
      }));
      lists.flat().forEach(it => { state.items.set(it.id, it); if (it.isFolder) queue.push(it.id); });
    }
  }

  // ---------------------------------------------------------------- Lesen
  async function batch(requests) {
    const out = {};
    for (let i = 0; i < requests.length; i += 20) {
      const part = requests.slice(i, i + 20);
      const d = await req('POST', '/$batch', { json: { requests: part } });
      (d.responses || []).forEach(r => { out[r.id] = r; });
    }
    return out;
  }

  const urlCache = new Map(); // Schlüssel -> { url, t }
  const FRESH = 40 * 60 * 1000;

  async function downloadUrls(ids) {
    const need = ids.filter(id => { const c = urlCache.get('dl:' + id); return !c || Date.now() - c.t > FRESH; });
    if (need.length) {
      const res = await batch(need.map(id => ({ id, method: 'GET', url: '/me/drive/items/' + id + '?$select=id,@microsoft.graph.downloadUrl' })));
      need.forEach(id => {
        const r = res[id];
        const u = r && r.status === 200 && r.body && r.body['@microsoft.graph.downloadUrl'];
        if (u) urlCache.set('dl:' + id, { url: u, t: Date.now() });
      });
    }
    const out = {};
    ids.forEach(id => { const c = urlCache.get('dl:' + id); if (c) out[id] = c.url; });
    return out;
  }

  async function readTexts(ids) {
    const urls = await downloadUrls(ids);
    const out = {};
    const list = ids.slice();
    async function worker() {
      while (list.length) {
        const id = list.shift();
        if (!urls[id]) continue;
        try { const r = await fetch(urls[id]); if (r.ok) out[id] = await r.text(); } catch (e) { /* später erneut */ }
      }
    }
    await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
    return out;
  }

  async function fileUrl(id) { return (await downloadUrls([id]))[id]; }

  async function thumbUrls(ids, size) {
    size = size || 'medium';
    const need = ids.filter(id => { const c = urlCache.get(size + ':' + id); return !c || Date.now() - c.t > FRESH; });
    if (need.length) {
      const res = await batch(need.map(id => ({ id, method: 'GET', url: '/me/drive/items/' + id + '/thumbnails?$select=' + size })));
      need.forEach(id => {
        const r = res[id];
        const t = r && r.status === 200 && r.body && r.body.value && r.body.value[0] && r.body.value[0][size];
        urlCache.set(size + ':' + id, { url: t ? t.url : null, t: Date.now() });
      });
    }
    const out = {};
    ids.forEach(id => { const c = urlCache.get(size + ':' + id); if (c && c.url) out[id] = c.url; });
    return out;
  }

  // ---------------------------------------------------------------- Schreiben
  async function createFolder(parentId, name) {
    const it = await req('POST', '/me/drive/items/' + parentId + '/children', { json: { name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' } });
    return norm(it);
  }

  function xhrPut(url, blob, headers, onProgress, withAuthToken) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('PUT', url);
      Object.keys(headers || {}).forEach(k => x.setRequestHeader(k, headers[k]));
      if (withAuthToken) x.setRequestHeader('Authorization', 'Bearer ' + withAuthToken);
      x.upload.onprogress = e => { if (onProgress && e.lengthComputable) onProgress(e.loaded); };
      x.onload = () => {
        let d = null;
        try { d = x.responseText ? JSON.parse(x.responseText) : null; } catch (e) { /* leer */ }
        if (x.status >= 200 && x.status < 300) resolve(d);
        else reject(new DriveError(friendly(x.status, d), x.status, x.status === 409 ? 'exists' : undefined));
      };
      x.onerror = () => reject(new DriveError('Übertragung unterbrochen. Bitte Internetverbindung prüfen.', 0, 'offline'));
      x.send(blob);
    });
  }

  const CHUNK = 327680 * 12; // ca. 3,75 MB, Vielfaches von 320 KiB (Vorgabe von OneDrive)

  async function upload(parentId, name, blob, onProgress) {
    const path = '/me/drive/items/' + parentId + ':/' + encodeURIComponent(name) + ':';
    if (blob.size <= CHUNK) {
      const token = await Auth.token();
      const d = await xhrPut(G + path + '/content?@microsoft.graph.conflictBehavior=fail', blob, { 'Content-Type': 'application/octet-stream' }, onProgress, token);
      return norm(d);
    }
    const s = await req('POST', path + '/createUploadSession', { json: { item: { '@microsoft.graph.conflictBehavior': 'fail' } } });
    let start = 0, last = null;
    while (start < blob.size) {
      const end = Math.min(start + CHUNK, blob.size);
      let tries = 0;
      for (;;) {
        try {
          last = await xhrPut(s.uploadUrl, blob.slice(start, end), { 'Content-Range': `bytes ${start}-${end - 1}/${blob.size}` }, n => onProgress && onProgress(start + n));
          break;
        } catch (e) {
          if (++tries >= 3) { try { await fetch(s.uploadUrl, { method: 'DELETE' }); } catch (x) { /* egal */ } throw e; }
          await sleep(1500 * tries);
        }
      }
      start = end;
    }
    return norm(last);
  }

  async function writeText(parentId, name, text) {
    const d = await req('PUT', '/me/drive/items/' + parentId + ':/' + encodeURIComponent(name) + ':/content?@microsoft.graph.conflictBehavior=fail', { body: new Blob([text], { type: 'text/plain' }), headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    return norm(d);
  }

  async function replaceText(itemId, text, eTag) {
    const headers = { 'Content-Type': 'text/plain; charset=utf-8' };
    if (eTag) headers['If-Match'] = eTag;
    const d = await req('PUT', '/me/drive/items/' + itemId + '/content', { body: new Blob([text], { type: 'text/plain' }), headers });
    return norm(d);
  }

  async function move(itemId, parentId, name) {
    const json = {};
    if (parentId) json.parentReference = { id: parentId };
    if (name) json.name = name;
    const d = await req('PATCH', '/me/drive/items/' + itemId, { json });
    return norm(d);
  }

  async function remove(itemId) { await req('DELETE', '/me/drive/items/' + itemId); }

  async function me() {
    const d = await req('GET', '/me?$select=displayName,userPrincipalName');
    return d.displayName || d.userPrincipalName || '';
  }

  return {
    kind: 'onedrive', openPath, openId, listChildren, hasCollectionMarker, sync,
    readTexts, fileUrl, thumbUrls, createFolder, upload, writeText, replaceText, move, remove, me,
    get rootId() { return rootId; }, get rootInfo() { return rootInfo; }
  };
})();

/* ------------------------------------------------------------------------------------
   Demo-Laufwerk: nur zum Ausprobieren und Testen ohne Microsoft-Konto (Adresse mit ?demo).
   Es speichert nichts dauerhaft und berührt kein OneDrive. */
const DemoDrive = (() => {
  const items = new Map();
  const blobs = new Map();
  let seq = 0, rootId = null;
  const nid = () => 'D' + (++seq);
  const now = () => new Date().toISOString();
  const tag = () => '"' + Math.random().toString(36).slice(2) + '"';

  function add(parentId, name, isFolder, blob) {
    for (const it of items.values()) if (it.parentId === parentId && it.name.toLowerCase() === name.toLowerCase())
      throw new DriveError('Ein Element mit diesem Namen existiert bereits.', 409, 'exists');
    const it = { id: nid(), name, parentId, isFolder, size: blob ? blob.size : 0, eTag: tag(), cTag: tag(), modified: now(), webUrl: '#' };
    items.set(it.id, it);
    if (blob) blobs.set(it.id, blob);
    return Object.assign({}, it);
  }

  function swatch(text, w, h, bg, fg, transparent) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (!transparent) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
    g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(w * .2, h * .2, w * .6, h * .6);
    g.fillStyle = fg; g.font = `${Math.round(w / 9)}px Georgia`; g.textAlign = 'center';
    g.fillText(text, w / 2, h / 2 + w / 30);
    return new Promise(r => c.toBlob(r, transparent ? 'image/png' : 'image/jpeg', .85));
  }

  async function seed() {
    if (rootId) return;
    const root = add(null, 'Sammlung', true);
    rootId = root.id;
    const meta = add(rootId, '.apologea', true);
    add(meta.id, 'sammlung.json', false, new Blob(['{"format":"APOLOGEA-Sammlung/1"}']));
    const data = [
      ['Hoodies', 132, 'BENEDICT', 'Benedikt von Nursia', '#1c2340'],
      ['Hoodies', 41, 'PANTOKRATOR COLOR', 'Christus Pantokrator in Farbe', '#141414'],
      ['Polos', 1, 'SIGNUM', 'Goldenes Kreuzzeichen', '#111111'],
      ['Polos', 2, 'OLIVA', 'Olivenzweig', '#e9e1cf'],
      ['T-Shirts', 26, 'DIALOGUE', 'Wortmarke mit Kreuz', '#121212']
    ];
    const cats = {};
    for (const c of ['Hoodies', 'Polos', 'T-Shirts', 'Jacken']) cats[c] = add(rootId, c, true).id;
    for (const [cat, nr, name, motiv, color] of data) {
      const leaf = String(nr).padStart(3, '0') + '_' + name.replace(/ /g, '_') + '_' + motiv.replace(/ /g, '_');
      const f = add(cats[cat], leaf, true);
      add(f.id, 'Design.png', false, await swatch(name, 600, 600, null, '#b8955a', true));
      add(f.id, 'Motivdarstellung.jpg', false, await swatch('Ansicht', 900, 600, '#f3efe6', '#333', false));
      add(f.id, 'Mockup.jpg', false, await swatch('Mockup', 600, 900, color, '#c9a96f', false));
      add(f.id, 'Konzept.txt', false, new Blob(['Konzept ' + name]));
      const pd = { format: 'APOLOGEA-Piece/1', id: 'demo' + nr, nummer: nr, name, motivtitel: motiv, kategorie: cat, serie: nr > 120 ? '121–170 · Ikonen' : '001–100',
        beschreibung: 'Kleidungsstück: ' + cat.slice(0, -1) + '\nFarbe: Schwarz\nFront: Kleine Wortmarke\nVeredelung: Stickerei', schlagwoerter: [], entwurf: false,
        bilder: { design: 'Design.png', kleidungsansicht: 'Motivdarstellung.jpg', mockup: 'Mockup.jpg' }, arbeitsdateien: ['Konzept.txt'],
        erstellt: '2026-10-16T00:50:00+02:00', geaendert: '2026-10-16T00:50:00+02:00', herkunft: 'Demo', vorlage_von: null };
      add(f.id, 'Produktdaten.json', false, new Blob([JSON.stringify(pd, null, 2)]));
    }
  }

  const copy = it => Object.assign({}, it);
  return {
    kind: 'demo',
    async openPath() { await seed(); return copy(items.get(rootId)); },
    async openId() { await seed(); return copy(items.get(rootId)); },
    async listChildren(id) { await seed(); return [...items.values()].filter(i => i.parentId === (id || null)).map(copy); },
    async hasCollectionMarker() { return true; },
    async sync(state) { await seed(); state.items = new Map([...items.values()].map(i => [i.id, copy(i)])); state.deltaLink = 'demo'; return { changes: items.size, full: true }; },
    async readTexts(ids) { const o = {}; for (const id of ids) if (blobs.has(id)) o[id] = await blobs.get(id).text(); return o; },
    async fileUrl(id) { return blobs.has(id) ? URL.createObjectURL(blobs.get(id)) : null; },
    async thumbUrls(ids) { const o = {}; ids.forEach(id => { if (blobs.has(id)) o[id] = URL.createObjectURL(blobs.get(id)); }); return o; },
    async createFolder(p, n) { return add(p, n, true); },
    async upload(p, n, b, onP) { await new Promise(r => setTimeout(r, 150)); if (onP) onP(b.size); return add(p, n, false, b); },
    async writeText(p, n, t) { return add(p, n, false, new Blob([t])); },
    async replaceText(id, t, eTag) {
      const it = items.get(id);
      if (!it) throw new DriveError('Nicht gefunden', 404);
      if (eTag && it.eTag !== eTag) throw new DriveError('Die Datei wurde inzwischen an einem anderen Gerät geändert.', 412, 'conflict');
      blobs.set(id, new Blob([t])); it.size = t.length; it.eTag = tag(); it.cTag = tag(); it.modified = now(); return copy(it);
    },
    async move(id, parentId, name) {
      const it = items.get(id);
      if (!it) throw new DriveError('Nicht gefunden', 404);
      const p = parentId || it.parentId, n = name || it.name;
      for (const o of items.values()) if (o !== it && o.parentId === p && o.name.toLowerCase() === n.toLowerCase()) throw new DriveError('Ein Element mit diesem Namen existiert bereits.', 409, 'exists');
      it.parentId = p; it.name = n; it.eTag = tag(); return copy(it);
    },
    async remove(id) {
      const kill = x => { [...items.values()].filter(i => i.parentId === x).forEach(c => kill(c.id)); items.delete(x); blobs.delete(x); };
      kill(id);
    },
    async me() { return 'Demo-Modus'; },
    get rootId() { return rootId; },
    get rootInfo() { return items.get(rootId); }
  };
})();
