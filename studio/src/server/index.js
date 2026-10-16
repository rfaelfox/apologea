import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { APP_DIR, DIRS, PUBLIC_DIR, ensureDirs, insideDir } from './paths.js';
import { openStore, store, getSettings, saveSettings, flushStore } from './store.js';
import { STATUS, UserError, errorMessage } from './util.js';
import { SECRET_BACKEND, secretInfo, setSecret } from './secrets.js';
import { analyzeImage } from './images.js';
import { openExternal, revealInExplorer, openFile } from './opener.js';
import * as shopify from './integrations/shopify.js';
import * as mp from './integrations/marketprint.js';
import { getProvider, listProviders, PROVIDER_IDS } from './providers/registry.js';
import * as ai from './ai/claude.js';
import { findClaude } from './claudeCli.js';
import * as designs from './services/designs.js';
import * as products from './services/products.js';
import * as website from './services/website.js';
import * as backup from './services/backup.js';
import { listJobs, recoverInterruptedJobs } from './services/jobs.js';
import * as updater from './services/updater.js';
import * as productImages from './services/productImages.js';
import * as storefront from './services/storefront.js';
import * as themeEditor from './services/themeEditor.js';

const VERSION = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8')).version;
const RUNTIME_FILE = path.join(DIRS.internal, 'laufzeit.json');
const PREFERRED_PORT = Number(process.env.APOLOGEA_PORT || 47821);
const SECRET_NAMES = new Set(['shopify.themeAccessPassword', 'shopify.storefrontPassword', 'shopify.clientId', 'shopify.clientSecret', 'anthropic.apiKey', 'printify.token', 'printful.token']);
const MAX_UPLOAD = 300 * 1024 * 1024;

ensureDirs();
// Nach einer Aktualisierung übernimmt der neue Dienst Startschlüssel und Port des alten,
// damit das offene Programmfenster angemeldet bleibt. Danach aus der Umgebung entfernen
// (Unterprozesse wie Claude Code sollen ihn nicht erben).
const RESTART = { token: process.env.APOLOGEA_RESTART_TOKEN, port: Number(process.env.APOLOGEA_RESTART_PORT) || 0, waitPid: Number(process.env.APOLOGEA_WAIT_PID) || 0 };
delete process.env.APOLOGEA_RESTART_TOKEN; delete process.env.APOLOGEA_RESTART_PORT; delete process.env.APOLOGEA_WAIT_PID;
const token = /^[A-Za-z0-9_-]{32}$/.test(RESTART.token || '') ? RESTART.token : crypto.randomBytes(24).toString('base64url');
let port = 0;
let lastSeen = Date.now();
let hadClient = false;

// ------------------------------------------------------------------ Hilfen

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const data = isBuf ? body : typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(data);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json' };

function sendFile(res, file, { download = false, csp = true } = {}) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'Datei nicht gefunden' });
  const ext = path.extname(file).toLowerCase();
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  // SVG-Dateien aus Uploads niemals als ausführbares Dokument behandeln
  if (csp) headers['Content-Security-Policy'] = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";
  if (download) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`;
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

function readJson(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new UserError('Anfrage zu groß.', { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new UserError('Ungültige Daten.')); }
    });
    req.on('error', reject);
  });
}

function readUploadToTmp(req) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(DIRS.tmp, `up-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
    const out = fs.createWriteStream(tmp);
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_UPLOAD) { req.destroy(); out.destroy(); fs.rmSync(tmp, { force: true }); reject(new UserError('Datei zu groß (max. 300 MB).', { status: 413 })); }
    });
    req.pipe(out);
    out.on('finish', () => resolve({ tmp, size }));
    out.on('error', reject);
    req.on('error', reject);
  });
}

function sanitizeSettings(s) {
  return {
    ...s,
    secrets: Object.fromEntries([...SECRET_NAMES].map((n) => [n, secretInfo(n)])),
    secretBackend: SECRET_BACKEND,
  };
}

// ------------------------------------------------------------------ Routen

const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, opts });

route('GET', '/api/ping', () => ({ ok: true, app: 'APOLOGEA Studio', version: VERSION }));

route('GET', '/api/bootstrap', async () => {
  const s = getSettings();
  const db = store();
  return {
    version: VERSION,
    settings: sanitizeSettings(s),
    dirs: { data: DIRS.data, designs: DIRS.designs, exports: DIRS.exports, backups: DIRS.backups },
    counts: { designs: db.designs.list().length, products: db.products.list().length, templates: db.templates.list().length, website: db.websiteDrafts.list().length },
    statuses: STATUS,
    logo: s.brand.logoFile && fs.existsSync(path.join(DIRS.internal, s.brand.logoFile)) ? '/files/brand/logo' : null,
  };
});

route('GET', '/api/dashboard', async () => {
  const db = store();
  const open = (x) => ![STATUS.SUCCESS].includes(x.status);
  return {
    openProducts: db.products.list(open).slice(0, 8),
    recentProducts: db.products.list().slice(0, 8),
    openWebsite: db.websiteDrafts.list(open).slice(0, 8),
    needsCheck: [...db.products.list((x) => x.status === STATUS.CHECK), ...db.websiteDrafts.list((x) => x.status === STATUS.CHECK)],
    jobs: listJobs({ limit: 8 }),
  };
});

route('GET', '/api/status/connections', async (_req, _p, _b, url) => {
  const deep = url.searchParams.get('deep') === '1';
  const s = getSettings();
  const out = {};
  out.shopify = await shopify.status().catch((err) => ({ ok: false, error: errorMessage(err) }));
  out.ai = await ai.engineStatus().catch((err) => ({ ok: false, error: errorMessage(err) }));
  out.claudeCode = { installed: Boolean(await findClaude().catch(() => null)) };
  out.providers = {};
  for (const meta of listProviders()) {
    const mode = meta.mode;
    if (mode === 'none') { out.providers[meta.id] = { name: meta.name, ok: false, mode, message: 'Nicht eingerichtet' }; continue; }
    try {
      const acc = deep ? (await getProvider(meta.id).testConnection()).account : await getProvider(meta.id).account();
      out.providers[meta.id] = { name: meta.name, ok: true, mode, simulated: mode === 'simulation', account: { label: acc.label, email: acc.email, targets: acc.targets }, cachedAt: acc.cachedAt };
    } catch (err) { out.providers[meta.id] = { name: meta.name, ok: false, mode, error: errorMessage(err) }; }
  }
  out.marketprint = out.providers.marketprint; // Kompatibilität
  out.checkedAt = new Date().toISOString();
  return out;
});

route('PUT', '/api/settings', async (_r, _p, body) => {
  const allowed = {};
  if (body.shop) allowed.shop = { domain: body.shop.domain?.trim().toLowerCase(), publicUrl: body.shop.publicUrl?.trim(), apiVersion: body.shop.apiVersion?.trim() };
  if (body.ai) allowed.ai = { engine: body.ai.engine, model: body.ai.model, confirmEachPaidCall: body.ai.confirmEachPaidCall };
  for (const pid of PROVIDER_IDS) {
    const b = body[pid];
    if (!b) continue;
    const modes = getProvider(pid).meta.modes.map((m) => m.id);
    if (b.mode !== undefined && !modes.includes(b.mode)) throw new UserError('Ungültige Verbindungsart.');
    allowed[pid] = { mode: b.mode, defaultShop: b.defaultShop?.trim() };
    if (pid === 'marketprint') allowed[pid].mcpUrl = b.mcpUrl?.trim();
    if (Array.isArray(b.allowedShops)) {
      allowed[pid].allowedShops = b.allowedShops.map((x) => String(x).trim()).filter((x) => (pid === 'marketprint' ? /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(x.toLowerCase()) : /^[\w.-]{1,80}$/.test(x)));
    }
  }
  if (body.brand) allowed.brand = { voice: body.brand.voice };
  if (body.ui) allowed.ui = body.ui;
  if (allowed.ai?.engine && !['none', 'api', 'claude-code'].includes(allowed.ai.engine)) throw new UserError('Ungültige KI-Auswahl.');
  if (allowed.ai?.model && !ai.PRICES[allowed.ai.model]) throw new UserError('Unbekanntes Modell.');
  if (allowed.marketprint?.mode) mp.resetMcp();
  return sanitizeSettings(saveSettings(JSON.parse(JSON.stringify(allowed))));
});

route('POST', '/api/secrets', async (_r, _p, body) => {
  if (!SECRET_NAMES.has(body.name)) throw new UserError('Unbekannter Zugang.');
  const v = typeof body.value === 'string' ? body.value.trim() : '';
  if (body.name === 'shopify.themeAccessPassword' && v && !/^shptka_/.test(v)) throw new UserError('Ein Theme-Access-Passwort beginnt mit „shptka_“.');
  if (body.name === 'anthropic.apiKey' && v && !/^sk-ant-/.test(v)) throw new UserError('Ein Anthropic-API-Schlüssel beginnt mit „sk-ant-“.');
  await setSecret(body.name, v || null);
  if (body.name === 'shopify.storefrontPassword') storefront.resetSession();
  return { ok: true, info: secretInfo(body.name) };
});

route('GET', '/api/marketprint/website-catalog', async () => mp.websiteCatalog());
route('POST', '/api/open-external', async (_r, _p, body) => {
  const u = String(body.url || '');
  const allowedHosts = [/\.myshopify\.com$/, /(^|\.)apologea\.eu$/, /(^|\.)shopify\.com$/, /(^|\.)marketprint\.de$/, /(^|\.)printify\.com$/, /(^|\.)printful\.com$/, /(^|\.)anthropic\.com$/, /(^|\.)claude\.(ai|com)$/];
  let host;
  try { host = new URL(u).hostname; } catch { throw new UserError('Ungültige Adresse.'); }
  if (!/^https:\/\//.test(u) || !allowedHosts.some((r) => r.test(host))) throw new UserError('Diese Adresse wird aus Sicherheitsgründen nicht geöffnet.');
  const r = await openExternal(u);
  console.log(`[Studio] Browser öffnen (${host}): ${r.opened ? 'gestartet über ' + r.via : 'fehlgeschlagen'}`);
  return { ok: r.opened, ...r };
});

route('POST', '/api/reveal', async (_r, _p, body) => {
  const map = { data: DIRS.data, designs: DIRS.designs, exports: DIRS.exports, backups: DIRS.backups };
  const target = map[body.which];
  if (!target) throw new UserError('Unbekannter Ordner.');
  revealInExplorer(target);
  return { ok: true };
});

// ---- MarketPrint
// ---- Print-on-Demand-Anbieter (einheitlich für alle Bausteine)
route('GET', '/api/providers', async () => listProviders());
route('POST', '/api/providers/:pid/test', async (_r, p) => getProvider(p.pid).testConnection());
route('GET', '/api/providers/:pid/account', async (_r, p, _b, url) => getProvider(p.pid).account({ refresh: url.searchParams.get('refresh') === '1' }));
route('GET', '/api/providers/:pid/catalog', async (_r, p, _b, url) => getProvider(p.pid).catalog({ refresh: url.searchParams.get('refresh') === '1' }));
route('GET', '/api/providers/:pid/catalog/:id/options', async (_r, p) => getProvider(p.pid).catalogOptions(p.id));
route('GET', '/api/providers/:pid/products/:id', async (_r, p, _b, url) => getProvider(p.pid).details(p.id, { refresh: url.searchParams.get('refresh') === '1' }));
route('GET', '/api/providers/:pid/images', async (_r, p, _b, url) => getProvider(p.pid).listImages({ search: url.searchParams.get('q') || undefined }));

// ---- Designs
route('GET', '/api/designs', async (_r, _p, _b, url) => designs.listDesigns(Object.fromEntries(url.searchParams)));
route('PUT', '/api/designs/:id', async (_r, p, body) => designs.updateDesign(p.id, body));
route('DELETE', '/api/designs/:id', async (_r, p, _b, url) => ({ ok: designs.deleteDesign(p.id, { confirm: url.searchParams.get('confirm') === '1' }) }));
route('POST', '/api/designs/:id/link/:pid', async (_r, p, body) => {
  const prov = getProvider(p.pid);
  let data = body;
  if (prov.verifyImage) data = { ...body, ...(await prov.verifyImage(body.imageId)) }; // ID beim Anbieter prüfen
  return designs.linkProvider(p.id, p.pid, data);
});
route('POST', '/api/designs/:id/upload/:pid', async (_r, p) => {
  const d = store().designs.get(p.id);
  if (!d) throw new UserError('Design nicht gefunden.', { status: 404 });
  const buf = fs.readFileSync(designs.designFilePath(d));
  const r = await getProvider(p.pid).uploadImage({ filename: d.originalName, buffer: buf });
  if (!r.imageId) throw new UserError('Der Anbieter hat keine Bild-ID zurückgegeben.');
  return designs.linkProvider(p.id, p.pid, { imageId: r.imageId, fileName: d.originalName });
});
route('POST', '/api/designs/:id/reveal', async (_r, p) => { const d = store().designs.get(p.id); revealInExplorer(designs.designFilePath(d)); return { ok: true }; });
route('POST', '/api/designs/:id/open', async (_r, p) => { const d = store().designs.get(p.id); openFile(designs.designFilePath(d)); return { ok: true }; });
route('POST', '/api/designs/:id/check', async (_r, p, body) => {
  const d = store().designs.get(p.id);
  if (!d) throw new UserError('Design nicht gefunden.', { status: 404 });
  const { checkPrintFile } = await import('./images.js');
  return checkPrintFile({ analysis: d.analysis, printArea: body.printArea, placement: body.placement, printerType: body.printerType });
});

// ---- Produkte
route('GET', '/api/products', async () => store().products.list());
route('POST', '/api/products', async (_r, _p, body) => products.createProduct(body));
route('GET', '/api/products/:id', async (_r, p) => { const x = store().products.get(p.id); if (!x) throw new UserError('Nicht gefunden.', { status: 404 }); return x; });
route('PUT', '/api/products/:id', async (_r, p, body) => products.saveProduct(p.id, body));
route('DELETE', '/api/products/:id', async (_r, p, _b, url) => ({ ok: products.deleteProduct(p.id, { confirm: url.searchParams.get('confirm') === '1' }) }));
route('POST', '/api/products/:id/validate', async (_r, p) => products.validateProduct(p.id));
route('POST', '/api/products/:id/duplicate', async (_r, p) => products.duplicateProduct(p.id));
route('POST', '/api/products/:id/template', async (_r, p, body) => products.saveAsTemplate(p.id, body.name));
route('POST', '/api/products/:id/describe/estimate', async (_r, p, body) => products.estimateDescription(p.id, body.style));
route('POST', '/api/products/:id/describe', async (_r, p, body) => products.generateDescription(p.id, body));
route('POST', '/api/products/:id/review', async (_r, p) => products.reviewProduct(p.id));
route('POST', '/api/products/:id/publish', async (_r, p, body) => products.publishProduct(p.id, body));
route('POST', '/api/products/:id/reconcile', async (_r, p, body) => products.reconcileProduct(p.id, body));
route('POST', '/api/products/:id/reopen', async (_r, p) => products.reopenProduct(p.id));
route('POST', '/api/products/:id/mockups', async (_r, p) => products.createMockups(p.id));
route('DELETE', '/api/products/:id/images/:img', async (_r, p) => productImages.removeImage(p.id, p.img));
route('PUT', '/api/products/:id/image-plan', async (_r, p, body) => productImages.setPlan(p.id, body || {}));
route('POST', '/api/products/:id/image-plan/estimate', async (_r, p) => productImages.estimatePlan(p.id));
route('POST', '/api/products/:id/image-plan', async (_r, p, body) => productImages.planWithClaude(p.id, body || {}));
route('POST', '/api/products/:id/neckprint', async (_r, p) => products.uploadNeckPrint(p.id));

// ---- Vorlagen
route('GET', '/api/templates', async () => store().templates.list());
route('PUT', '/api/templates/:id', async (_r, p, body) => { const t = store().templates.get(p.id); if (!t) throw new UserError('Nicht gefunden.', { status: 404 }); if (body.name) t.name = body.name; return store().templates.put(t); });
route('DELETE', '/api/templates/:id', async (_r, p, _b, url) => { if (url.searchParams.get('confirm') !== '1') throw new UserError('Bitte bestätigen.'); return { ok: store().templates.remove(p.id) }; });

// ---- Website
route('GET', '/api/website/areas', async () => website.listAreas());
route('GET', '/api/website/editor', async (_r, _p, _b, url) => themeEditor.structure({ template: url.searchParams.get('template') || undefined }));
route('GET', '/api/website/editor/session', async () => ({ previewLive: storefront.previewBase(), draft: themeEditor.manualDraft() }));
route('POST', '/api/website/editor/draft', async () => themeEditor.manualDraft({ create: true }));
route('POST', '/api/website/editor/edit', async (_r, _p, body) => themeEditor.setEdit(body || {}));
route('POST', '/api/website/editor/rebuild', async () => { const d = themeEditor.manualDraft(); return d ? themeEditor.rebuild(d.id) : null; });
route('GET', '/api/website/editor/preview-url', async (_r, _p, _b, url) => ({ base: storefront.previewBase(url.searchParams.get('theme') || null) }));
route('GET', '/api/website/drafts', async () => store().websiteDrafts.list());
route('POST', '/api/website/drafts', async (_r, _p, body) => website.createDraft(body));
route('GET', '/api/website/drafts/:id', async (_r, p) => { const d = store().websiteDrafts.get(p.id); if (!d) throw new UserError('Nicht gefunden.', { status: 404 }); return d; });
route('PUT', '/api/website/drafts/:id', async (_r, p, body) => website.saveDraft(p.id, body));
route('DELETE', '/api/website/drafts/:id', async (_r, p, _b, url) => ({ ok: await website.deleteDraft(p.id, { confirm: url.searchParams.get('confirm') === '1' }) }));
route('DELETE', '/api/website/drafts/:id/attachments/:att', async (_r, p) => website.removeAttachment(p.id, p.att));
route('POST', '/api/website/drafts/:id/estimate', async (_r, p) => website.estimateProposal(p.id));
route('POST', '/api/website/drafts/:id/propose', async (_r, p, body) => website.createProposal(p.id, body));
route('POST', '/api/website/drafts/:id/preview', async (_r, p) => website.createPreview(p.id));
route('POST', '/api/website/drafts/:id/review', async (_r, p) => website.reviewDraft(p.id));
route('POST', '/api/website/drafts/:id/apply', async (_r, p, body) => website.applyDraft(p.id, body));
route('POST', '/api/website/drafts/:id/check', async (_r, p) => website.checkApplied(p.id));
route('POST', '/api/website/drafts/:id/restore', async (_r, p, body) => website.restoreBackup(p.id, body));
route('POST', '/api/website/drafts/:id/remove-preview', async (_r, p, body) => website.removePreview(p.id, body));

// ---- Shopify (lesend, für Auswahllisten)
route('GET', '/api/shopify/collections', async () => shopify.listCollections());
route('GET', '/api/shopify/products', async (_r, _p, _b, url) => shopify.searchProducts(url.searchParams.get('q') || null, 50));
route('GET', '/api/shopify/themes', async () => shopify.listThemes());

// ---- Verlauf & Sicherung
route('GET', '/api/jobs', async (_r, _p, _b, url) => listJobs({ refId: url.searchParams.get('ref') || undefined }));
route('POST', '/api/backup/export', async () => backup.exportBackup());
route('GET', '/api/backup/list', async () => backup.listBackups());
route('POST', '/api/backup/reveal', async (_r, _p, body) => {
  const f = String(body.path || '');
  if (!(insideDir(DIRS.exports, f) || insideDir(DIRS.backups, f))) throw new UserError('Ungültiger Pfad.');
  revealInExplorer(f);
  return { ok: true };
});

// ---- Leben & Beenden
route('POST', '/api/heartbeat', async () => { lastSeen = Date.now(); hadClient = true; return { ok: true }; });
route('GET', '/api/update/check', async () => updater.checkForUpdate());
route('POST', '/api/update/apply', async (_r, _p, body) => {
  const r = await updater.applyUpdate({ sha: body?.sha });
  setTimeout(() => {
    updater.spawnReplacement({ port, token, logFile: path.join(DIRS.logs, 'studio.log') });
    shutdown('Neustart nach Aktualisierung');
  }, 300);
  return { ...r, restarting: true };
});
route('POST', '/api/quit', async () => { setTimeout(() => shutdown('Beenden über die Oberfläche'), 200); return { ok: true }; });

// ------------------------------------------------------------------ Uploads (Rohdaten)

async function handleUpload(req, res, url) {
  const kind = url.searchParams.get('kind');
  const name = decodeURIComponent(req.headers['x-file-name'] || 'datei');
  const mime = String(req.headers['content-type'] || 'application/octet-stream').split(';')[0];
  const { tmp } = await readUploadToTmp(req);
  try {
    if (kind === 'design') {
      const meta = JSON.parse(decodeURIComponent(req.headers['x-meta'] || '%7B%7D'));
      return send(res, 200, designs.importDesign({ tmpPath: tmp, originalName: name, ...meta }));
    }
    if (kind === 'design-thumb') return send(res, 200, designs.saveThumbnail(url.searchParams.get('id'), tmp));
    if (kind === 'website') {
      if (!/^image\/|^application\/pdf$/.test(mime)) throw new UserError('Bitte Bilder (PNG, JPEG, WebP, SVG) oder PDF hochladen.');
      return send(res, 200, website.addAttachment(url.searchParams.get('draft'), { tmpPath: tmp, originalName: name, mime }));
    }
    if (kind === 'product-image') return send(res, 200, productImages.addImage(url.searchParams.get('product'), { tmpPath: tmp, originalName: name, mime }));
    if (kind === 'product-image-preview') return send(res, 200, productImages.setPreview(url.searchParams.get('product'), url.searchParams.get('img'), tmp));
    if (kind === 'website-preview') return send(res, 200, website.setAttachmentPreview(url.searchParams.get('draft'), url.searchParams.get('att'), tmp));
    if (kind === 'logo') {
      const a = analyzeImage(fs.readFileSync(tmp), name);
      if (!['PNG', 'SVG', 'WebP', 'JPEG'].includes(a.format)) throw new UserError('Logo bitte als PNG, SVG, WebP oder JPEG.');
      if (a.format === 'SVG' && a.containsScript) throw new UserError('Die SVG-Datei enthält Skripte und wird nicht verwendet.');
      const file = `marke-logo${path.extname(name).toLowerCase() || '.png'}`;
      fs.renameSync(tmp, path.join(DIRS.internal, file));
      saveSettings({ brand: { logoFile: file } });
      return send(res, 200, { ok: true, logo: '/files/brand/logo' });
    }
    if (kind === 'backup') {
      const r = await backup.importBackup(tmp);
      return send(res, 200, r);
    }
    throw new UserError('Unbekannte Upload-Art.');
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// ------------------------------------------------------------------ Dateien

function handleFiles(res, url) {
  const parts = url.pathname.split('/').slice(2).map(decodeURIComponent); // /files/<art>/...
  if (parts[0] === 'design') {
    const d = store().designs.get(parts[1]);
    if (!d) return send(res, 404, { error: 'Nicht gefunden' });
    const file = parts[2] === 'thumb' && d.thumbnail ? path.join(designs.designDir(d), d.thumbnail) : designs.designFilePath(d);
    return sendFile(res, file, { download: url.searchParams.get('download') === '1' });
  }
  if (parts[0] === 'website') {
    const d = store().websiteDrafts.get(parts[1]);
    const att = d?.attachments.find((a) => a.id === parts[2]);
    if (!att) return send(res, 404, { error: 'Nicht gefunden' });
    return sendFile(res, website.attachmentPath(d.id, url.searchParams.get('preview') === '1' && att.preview ? att.preview : att.file));
  }
  if (parts[0] === 'product-image') {
    const d = store().products.get(parts[1]);
    const img = d?.extraImages?.find((i) => i.id === parts[2]);
    if (!img) return send(res, 404, { error: 'Nicht gefunden' });
    return sendFile(res, productImages.imagePath(d.id, url.searchParams.get('preview') === '1' && img.preview ? img.preview : img.file));
  }
  if (parts[0] === 'brand' && parts[1] === 'logo') {
    const f = getSettings().brand.logoFile;
    if (!f) return send(res, 404, { error: 'Kein Logo' });
    return sendFile(res, path.join(DIRS.internal, f));
  }
  return send(res, 404, { error: 'Nicht gefunden' });
}

// ------------------------------------------------------------------ Server

function hostOk(req) {
  const h = String(req.headers.host || '');
  return h === `127.0.0.1:${port}` || h === `localhost:${port}`;
}

function authed(req) {
  const cookie = String(req.headers.cookie || '');
  const m = cookie.match(/(?:^|;\s*)studio=([\w-]+)/);
  if (!m || m[1].length !== token.length) return false;
  return crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(token));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  try {
    // Schutz gegen DNS-Rebinding: nur Aufrufe an 127.0.0.1/localhost mit dem richtigen Port.
    if (!hostOk(req)) return send(res, 403, 'Verboten');

    if (url.pathname === '/auth') {
      const t = url.searchParams.get('t') || '';
      if (t.length !== token.length || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(token))) return send(res, 403, 'Ungültiger Startschlüssel. Bitte APOLOGEA Studio über die Desktop-Verknüpfung starten.');
      res.writeHead(302, { 'Set-Cookie': `studio=${token}; HttpOnly; SameSite=Strict; Path=/`, Location: '/' });
      return res.end();
    }
    if (url.pathname === '/oauth/marketprint/callback') {
      const code = url.searchParams.get('code');
      try { await mp.finishOAuth(code); return send(res, 200, '<!doctype html><meta charset="utf-8"><title>Angemeldet</title><body style="background:#0b0a09;color:#efe6d4;font-family:sans-serif;padding:40px">MarketPrint-Anmeldung abgeschlossen. Du kannst dieses Fenster schließen.</body>', { 'Content-Type': 'text/html; charset=utf-8' }); } catch (err) { return send(res, 400, 'Anmeldung fehlgeschlagen: ' + errorMessage(err)); }
    }
    if (url.pathname === '/api/ping') return send(res, 200, { ok: true, app: 'APOLOGEA Studio', version: VERSION });

    // Live-Ansicht des Shops: eigener Vorschau-Schlüssel, abgeschottet (siehe services/storefront.js)
    if (url.pathname.startsWith('/vorschau/')) return await storefront.handle(req, res, url);

    if (!authed(req)) {
      if (url.pathname === '/' || url.pathname === '/index.html') return send(res, 401, 'Bitte APOLOGEA Studio über die Desktop-Verknüpfung starten.');
      return send(res, 401, { error: 'Nicht angemeldet' });
    }
    lastSeen = Date.now();

    const unsafe = !['GET', 'HEAD'].includes(req.method);
    if (unsafe) {
      // Schutz gegen fremde Webseiten (CSRF): eigener Header + gleiche Herkunft.
      const origin = req.headers.origin;
      if (req.headers['x-studio'] !== '1' || (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`)) return send(res, 403, { error: 'Verboten' });
    }

    if (url.pathname === '/api/upload' && req.method === 'POST') return await handleUpload(req, res, url);
    if (url.pathname.startsWith('/files/')) return handleFiles(res, url);

    if (url.pathname.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.re);
        if (!m) continue;
        const params = Object.fromEntries(Object.entries(m.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
        const body = unsafe ? await readJson(req) : {};
        const out = await r.handler(req, params, body, url);
        return send(res, 200, out ?? { ok: true });
      }
      return send(res, 404, { error: 'Unbekannte Funktion' });
    }

    // Oberfläche
    let file = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!insideDir(PUBLIC_DIR, file) && file !== path.join(PUBLIC_DIR, 'index.html')) return send(res, 404, 'Nicht gefunden');
    if (!fs.existsSync(file)) file = path.join(PUBLIC_DIR, 'index.html');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob: https://cdn.marketprint.de https://cdn.shopify.com https://images.printify.com https://*.printify.com https://files.cdn.printful.com https://*.printful.com; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'",
    });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    const status = err instanceof UserError ? err.status : 500;
    if (!(err instanceof UserError)) console.error('[Fehler]', err);
    if (!res.headersSent) send(res, status, { error: errorMessage(err), code: err.code || null, details: err.details || null });
    else res.end();
  }
});

async function alreadyRunning() {
  try {
    const rt = JSON.parse(fs.readFileSync(RUNTIME_FILE, 'utf8'));
    const r = await fetch(`http://127.0.0.1:${rt.port}/api/ping`, { signal: AbortSignal.timeout(1500) });
    if (r.ok && (await r.json()).app === 'APOLOGEA Studio') return rt;
  } catch { /* keine laufende Instanz */ }
  return null;
}

function listen(p) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(p, '127.0.0.1', () => { server.off('error', reject); resolve(server.address().port); });
  });
}

let shuttingDown = false;
async function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Studio] Wird beendet: ${reason}`);
  await flushStore();
  try { fs.rmSync(RUNTIME_FILE, { force: true }); } catch { /* ignorieren */ }
  server.close();
  setTimeout(() => process.exit(0), 300);
}

async function waitForExit(pid, ms = 20_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { process.kill(pid, 0); } catch { return; }
    await new Promise((r) => setTimeout(r, 200));
  }
}

export async function start() {
  if (RESTART.waitPid) await waitForExit(RESTART.waitPid);
  const existing = await alreadyRunning();
  if (existing) {
    console.log(JSON.stringify({ alreadyRunning: true, port: existing.port }));
    return { alreadyRunning: true, ...existing };
  }
  openStore();
  const recovered = recoverInterruptedJobs();
  if (recovered.length) console.log(`[Studio] ${recovered.length} unterbrochene(r) Vorgang/Vorgänge als „Ergebnis muss geprüft werden“ markiert.`);
  const wanted = RESTART.port || PREFERRED_PORT;
  for (let i = 0; i < (RESTART.port ? 20 : 1) && !port; i++) {
    try { port = await listen(wanted); } catch { if (RESTART.port) await new Promise((r) => setTimeout(r, 250)); }
  }
  if (!port) port = await listen(0);
  mp.setOAuthCallbackBase(`http://127.0.0.1:${port}`);
  fs.writeFileSync(RUNTIME_FILE, JSON.stringify({ port, token, pid: process.pid, startedAt: new Date().toISOString() }));
  if (process.platform !== 'win32') { try { fs.chmodSync(RUNTIME_FILE, 0o600); } catch { /* ignorieren */ } }
  backup.dailyAutoBackup().catch((err) => console.error('[Studio] Automatische Sicherung fehlgeschlagen:', err.message));
  const startUrl = `http://127.0.0.1:${port}/auth?t=${token}`;
  console.log(JSON.stringify({ ready: true, port }));
  if (process.env.APOLOGEA_IDLE_EXIT === '1') {
    setInterval(() => {
      if (hadClient && Date.now() - lastSeen > 3 * 60_000) shutdown('Kein Programmfenster mehr geöffnet');
      if (!hadClient && Date.now() - lastSeen > 15 * 60_000) shutdown('Nicht geöffnet');
    }, 30_000).unref();
  }
  return { port, token, url: startUrl };
}

process.on('SIGINT', () => shutdown('Abbruch'));
process.on('SIGTERM', () => shutdown('Beendet'));
process.on('unhandledRejection', (err) => console.error('[Studio] Unbehandelter Fehler:', err));

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(path.join(APP_DIR, 'src', 'server', 'index.js'))) {
  start().catch((err) => { console.error(err); process.exit(1); });
}
