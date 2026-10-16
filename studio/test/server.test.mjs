// Automatische Tests der Programmlogik (ohne echte Schreibaktionen bei Shopify/MarketPrint).
// Shopify: simulierter Server · MarketPrint: Simulationsmodus · Claude: feste Testantwort.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMockShopify } from './mock-shopify.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apologea-studio-test-'));
process.env.APOLOGEA_DATA_DIR = tmp;
process.env.APOLOGEA_TEST = '1';
const mock = createMockShopify();
let S; // Module
const aiFile = path.join(tmp, 'ai-antwort.json');

before(async () => {
  process.env.APOLOGEA_SHOPIFY_MOCK_URL = await mock.start();
  process.env.APOLOGEA_AI_MOCK = aiFile;
  const paths = await import('../src/server/paths.js');
  paths.ensureDirs();
  const store = await import('../src/server/store.js');
  store.openStore();
  S = {
    store,
    secrets: await import('../src/server/secrets.js'),
    website: await import('../src/server/services/website.js'),
    products: await import('../src/server/services/products.js'),
    designs: await import('../src/server/services/designs.js'),
    backup: await import('../src/server/services/backup.js'),
    jobs: await import('../src/server/services/jobs.js'),
    images: await import('../src/server/images.js'),
    util: await import('../src/server/util.js'),
    themeEditor: await import('../src/server/services/themeEditor.js'),
    storefront: await import('../src/server/services/storefront.js'),
  };
  store.saveSettings({ marketprint: { mode: 'simulation' } });
  await S.secrets.setSecret('shopify.clientId', 'test-id');
  await S.secrets.setSecret('shopify.clientSecret', 'test-secret');
});

after(async () => { await S.store.flushStore(); await mock.stop(); });

const { STATUS } = await import('../src/server/util.js');

function proposal(heading) {
  return {
    understood_request: 'Überschrift ändern', summary: `Überschrift wird „${heading}“.`, kind: 'mixed',
    theme_files: [{ filename: 'templates/index.json', new_content: JSON.stringify({ sections: { hero: { type: 'hero', settings: { heading } } }, order: ['hero'] }), explanation: 'Text im Hero' }],
    content_ops: [{ op: 'page_update', page_id: 'gid://shopify/Page/10', title: '', handle: '', body_html: '<p>Neu</p>', template_suffix: '', collection_id: '', product_ids: [], explanation: 'Text' }],
    asset_uploads: [], limitations: [], questions: [],
  };
}

test('Website: Vorschlag → Vorschau → Freigabe → Übernahme → Wiederherstellung', async () => {
  fs.writeFileSync(aiFile, JSON.stringify(proposal('Licht in der Dunkelheit')));
  const w = S.website.createDraft({ title: 'Überschrift', areaKey: 'theme:templates/index.json', request: 'Überschrift ändern' });
  const d = await S.website.createProposal(w.id, {});
  assert.equal(d.status, STATUS.READY);
  assert.equal(d.proposal.themeFiles.length, 1);
  assert.ok(d.proposal.themeFiles[0].diff.some((x) => x.t === '+'));
  // Vorschau in einer Theme-Kopie – Live-Theme bleibt unverändert
  const before = mock.live().files.get('templates/index.json');
  const p = await S.website.createPreview(w.id);
  assert.match(p.preview.url, /preview_theme_id=/);
  assert.equal(mock.live().files.get('templates/index.json'), before, 'Live-Theme darf bei der Vorschau nicht verändert werden');
  // Übernahme nur mit Freigabe
  await assert.rejects(() => S.website.applyDraft(w.id, { approvalHash: 'falsch' }), /prüfen und freigeben/);
  const r = await S.website.reviewDraft(w.id);
  assert.equal(r.status, STATUS.APPROVAL);
  const res = await S.website.applyDraft(w.id, { approvalHash: r.approvalHash });
  assert.equal(res.status, STATUS.SUCCESS);
  assert.match(mock.live().files.get('templates/index.json'), /Licht in der Dunkelheit/);
  assert.equal(mock.state.pages.get('gid://shopify/Page/10').body, '<p>Neu</p>');
  // Sicherung vorhanden (Datei im Datenordner)
  const saved = S.store.store().websiteDrafts.get(w.id);
  assert.equal(saved.backups.length, 1);
  assert.ok(fs.existsSync(saved.backups[0].files[0].local));
  // Doppelte Übernahme gesperrt
  await assert.rejects(() => S.website.applyDraft(w.id, { approvalHash: r.approvalHash }), /bereits übernommen/);
  // Wiederherstellung
  await assert.rejects(() => S.website.restoreBackup(w.id, { backupId: saved.backups[0].id }), /bestätigt/);
  await S.website.restoreBackup(w.id, { backupId: saved.backups[0].id, confirm: true });
  assert.equal(mock.live().files.get('templates/index.json'), before);
  assert.equal(mock.state.pages.get('gid://shopify/Page/10').body, '<p>Alt</p>');
  // Vorschau-Theme entfernen (nur nach Bestätigung, Live-Theme nie)
  await S.website.removePreview(w.id, { confirm: true });
  assert.equal(mock.state.themes.size, 1);
});

test('Website: Änderung im Shop seit dem Vorschlag → Übernahme wird verhindert', async () => {
  fs.writeFileSync(aiFile, JSON.stringify({ ...proposal('Konflikt'), content_ops: [] }));
  const w = S.website.createDraft({ title: 'Konflikt', areaKey: 'theme:templates/index.json', request: 'x' });
  await S.website.createProposal(w.id, {});
  const r = await S.website.reviewDraft(w.id);
  mock.live().files.set('templates/index.json', '{"sections":{},"order":[]}'); // jemand ändert parallel im Shop
  await assert.rejects(() => S.website.applyDraft(w.id, { approvalHash: r.approvalHash }), /seit dem Vorschlag/);
  const d = S.store.store().websiteDrafts.get(w.id);
  assert.equal(d.status, STATUS.FAILED);
  assert.equal(mock.live().files.get('templates/index.json'), '{"sections":{},"order":[]}', 'nichts überschrieben');
});

test('Website: ungültiges JSON von Claude wird blockiert', async () => {
  fs.writeFileSync(aiFile, JSON.stringify({ ...proposal('x'), content_ops: [], theme_files: [{ filename: 'templates/index.json', new_content: '{kaputt', explanation: '' }] }));
  const w = S.website.createDraft({ title: 'Kaputt', areaKey: 'auto', request: 'x' });
  const d = await S.website.createProposal(w.id, {});
  assert.equal(d.status, STATUS.MISSING);
  assert.ok(d.proposal.blocking.some((b) => /kein gültiges JSON/.test(b)));
  await assert.rejects(() => S.website.reviewDraft(w.id), /offene Probleme/);
});

async function readyProduct() {
  const png = path.join(tmp, 'motiv.png');
  const { PNG } = await import('pngjs');
  const img = new PNG({ width: 4677, height: 5000 });
  img.data.fill(0);
  for (let i = 0; i < 4677 * 2000 * 4; i += 4) { img.data[i] = 200; img.data[i + 3] = 255; }
  fs.writeFileSync(png, PNG.sync.write(img));
  const tmpCopy = path.join(tmp, '.studio', 'tmp', 'up-' + Date.now());
  fs.copyFileSync(png, tmpCopy);
  const { design } = S.designs.importDesign({ tmpPath: tmpCopy, originalName: 'motiv.png' });
  S.designs.linkMarketPrint(design.id, { imageId: 'img-1' });
  const p = S.products.createProduct({});
  S.products.saveProduct(p.id, {
    internalName: 'Test 01', publicTitle: 'Test Shirt', baseProduct: { id: '6391c767702e1dea29b936ed', title: 'VACANCY Oversized Shirt' },
    printerType: 'dtg', variantIds: ['6391c73b702e1dea29b936e5', '6391c73f702e1dea29b936e6'],
    placements: [{ printArea: 'front', designId: design.id, placement: { mode: 'auto' } }],
    price: 44.9, mockups: 'withDesign', targetShops: ['dfz1mp-1u.myshopify.com'],
  });
  return p.id;
}

test('Produkt: Druckdatei-Prüfung und Freigabe', async () => {
  const id = await readyProduct();
  const v = await S.products.validateProduct(id);
  assert.equal(v.status, STATUS.READY, JSON.stringify(v.issues));
  assert.ok(v.fileChecks.front.some((n) => /Transparenter Hintergrund/.test(n.text)));
  const r = await S.products.reviewProduct(id);
  assert.equal(r.ok, true);
  assert.deepEqual(r.summary.shops, ['dfz1mp-1u.myshopify.com']);
  // Änderung nach der Prüfung → Freigabe ungültig
  S.products.saveProduct(id, { price: 45.9 });
  await assert.rejects(() => S.products.publishProduct(id, { approvalHash: r.approvalHash }), /zuerst „Zur Veröffentlichung prüfen“|verändert/);
});

test('Produkt: Nackendruck – Pflicht zum Hochladen, Kennung verfällt bei Motivwechsel, wird mitgesendet', async () => {
  const id = await readyProduct();
  const { PNG } = await import('pngjs');
  const mk = (n) => { const img = new PNG({ width: 400, height: 200 }); img.data.fill(0); const f = path.join(tmp, '.studio', 'tmp', `neck-${n}-${Date.now()}`); fs.writeFileSync(f, PNG.sync.write(img)); return S.designs.importDesign({ tmpPath: f, originalName: `nacken-${n}.png` }).design; };
  const light = mk('hell');
  const dark = mk('dunkel');
  S.products.saveProduct(id, { neckPrint: { lightDesignId: light.id, darkDesignId: dark.id, neckPrintId: 'vom-client-erfunden' } });
  assert.equal(S.store.store().products.get(id).neckPrint.neckPrintId, null, 'Kennung setzt nur der Server');
  let v = await S.products.validateProduct(id);
  assert.ok(v.issues.some((i) => /noch nicht zu MarketPrint hochgeladen/.test(i.text)));
  const up = await S.products.uploadNeckPrint(id);
  assert.match(up.neckPrint.neckPrintId, /^sim-neck-/);
  v = await S.products.validateProduct(id);
  assert.equal(v.status, STATUS.READY, JSON.stringify(v.issues));
  const r = await S.products.reviewProduct(id);
  assert.equal(r.summary.neckPrint.light, light.name);
  const req = await S.products.buildRequest(S.store.store().products.get(id));
  assert.equal(req.neckPrintId, up.neckPrint.neckPrintId);
  // gleiche Motive erneut speichern → Kennung bleibt; anderes Motiv → Kennung verfällt
  S.products.saveProduct(id, { neckPrint: { lightDesignId: light.id, darkDesignId: dark.id } });
  assert.equal(S.store.store().products.get(id).neckPrint.neckPrintId, up.neckPrint.neckPrintId);
  S.products.saveProduct(id, { neckPrint: { lightDesignId: dark.id, darkDesignId: null } });
  assert.equal(S.store.store().products.get(id).neckPrint.neckPrintId, null);
  assert.equal((await S.products.buildRequest(S.store.store().products.get(id))).neckPrintId, undefined);
});

test('Produkt: Verbindungsabbruch → „Ergebnis muss geprüft werden“, kein zweiter Versuch ohne Klärung', async () => {
  const id = await readyProduct();
  const r = await S.products.reviewProduct(id);
  process.env.APOLOGEA_SIM_FAIL = 'network';
  await assert.rejects(() => S.products.publishProduct(id, { approvalHash: r.approvalHash }), /Ergebnis unklar/);
  delete process.env.APOLOGEA_SIM_FAIL;
  let p = S.store.store().products.get(id);
  assert.equal(p.status, STATUS.CHECK);
  assert.equal(p.publish.state, 'unknown');
  await assert.rejects(() => S.products.publishProduct(id, { approvalHash: r.approvalHash }), /unklarem Ergebnis/);
  // Klärung: Produkt fehlt → wieder bearbeitbar
  await S.products.reconcileProduct(id, { action: 'confirm-missing' });
  p = S.store.store().products.get(id);
  assert.equal(p.status, STATUS.FAILED);
  S.products.reopenProduct(id);
  const r2 = await S.products.reviewProduct(id);
  const ok = await S.products.publishProduct(id, { approvalHash: r2.approvalHash });
  assert.equal(ok.status, STATUS.SUCCESS);
  assert.equal(ok.result.simulated, true);
});

test('Produkt: eindeutige Ablehnung durch MarketPrint → „Fehlgeschlagen“', async () => {
  const id = await readyProduct();
  const r = await S.products.reviewProduct(id);
  process.env.APOLOGEA_SIM_FAIL = 'rejected';
  await assert.rejects(() => S.products.publishProduct(id, { approvalHash: r.approvalHash }), /fehlgeschlagen/);
  delete process.env.APOLOGEA_SIM_FAIL;
  assert.equal(S.store.store().products.get(id).status, STATUS.FAILED);
});

test('Wiederaufnahme: unterbrochene Vorgänge werden nach Neustart zur Prüfung markiert', async () => {
  const id = await readyProduct();
  S.store.store().products.update(id, (d) => { d.publish = { state: 'running', startedAt: new Date().toISOString() }; d.status = STATUS.RUNNING; return d; });
  const job = S.jobs.createJob({ type: 'product.publish', title: 'x', refType: 'product', refId: id });
  S.jobs.recoverInterruptedJobs();
  assert.equal(S.store.store().products.get(id).status, STATUS.CHECK);
  assert.equal(S.store.store().jobs.get(job.id).status, STATUS.CHECK);
});

test('Vorlage: speichern und daraus neues Produkt erstellen', async () => {
  const id = await readyProduct();
  const t = S.products.saveAsTemplate(id, 'Shirt vorne');
  const p = S.products.createProduct({ fromTemplate: t.id });
  assert.equal(p.price, 44.9);
  assert.equal(p.variantIds.length, 2);
  assert.equal(p.placements[0].designId, null, 'Vorlage enthält kein Motiv');
  assert.equal(p.internalName, '');
});

test('Datensicherung: Export, Import (mit Sicherheitskopie), keine Zugangsdaten im Export', async () => {
  const before = S.store.store().products.list().length;
  const exp = await S.backup.exportBackup();
  const AdmZip = (await import('adm-zip')).default;
  const names = new AdmZip(exp.file).getEntries().map((e) => e.entryName);
  assert.ok(names.includes('manifest.json'));
  assert.ok(!names.some((n) => /secrets/.test(n)), 'keine Zugangsdaten in der Sicherung');
  assert.ok(names.some((n) => n.startsWith('Designs/')));
  S.products.createProduct({});
  assert.equal(S.store.store().products.list().length, before + 1);
  const r = await S.backup.importBackup(exp.file);
  assert.ok(fs.existsSync(r.safetyCopy));
  const store = await import('../src/server/store.js');
  assert.equal(store.store().products.list().length, before);
});

test('Druckdatei-Prüfung: Hochskalierung, Ränder, Format', () => {
  const area = { name: 'front', width: 4677, height: 5881 };
  const small = S.images.checkPrintFile({ analysis: { format: 'PNG', width: 1000, height: 1200, hasAlphaChannel: true, hasAlpha: true, transparentRatio: 0.5 }, printArea: area, placement: 'auto', printerType: 'dtg' });
  assert.ok(small.some((n) => n.level === 'error' && /DPI-Prüfung: schlecht/.test(n.text) && n.dpi.rating === 'schlecht'));
  // 4677 px über die volle Breite = 300 DPI → gut; 2800 px → ca. 180 DPI → mittel
  const full = S.images.checkPrintFile({ analysis: { format: 'PNG', width: 4677, height: 5881, hasAlphaChannel: true, hasAlpha: true }, printArea: area, placement: 'auto' });
  assert.equal(full.find((n) => n.dpi).dpi.rating, 'gut');
  assert.equal(full.find((n) => n.dpi).dpi.dpi, 300);
  assert.equal(full.find((n) => n.dpi).dpi.widthCm, 39.6);
  const mid = S.images.checkPrintFile({ analysis: { format: 'PNG', width: 2800, height: 3520, hasAlphaChannel: true, hasAlpha: true }, printArea: area, placement: 'auto' });
  assert.equal(mid.find((n) => n.dpi).dpi.rating, 'mittel');
  const half = S.images.checkPrintFile({ analysis: { format: 'PNG', width: 2800, height: 2800, hasAlphaChannel: true, hasAlpha: true }, printArea: area, placement: { mode: 'custom', xPercent: 0.5, yPercent: 0.5, widthPercent: 0.5 } });
  assert.equal(half.find((n) => n.dpi).dpi.rating, 'gut', 'kleiner gesetzt → höhere DPI');
  const edge = S.images.checkPrintFile({ analysis: { format: 'PNG', width: 4000, height: 4000, hasAlphaChannel: true, hasAlpha: true }, printArea: area, placement: { xPercent: 0.9, yPercent: 0.5, widthPercent: 0.5 } });
  assert.ok(edge.some((n) => /ragt über/.test(n.text)));
  const jpg = S.images.checkPrintFile({ analysis: { format: 'JPEG', width: 4677, height: 5881 }, printArea: area, placement: 'auto' });
  assert.ok(jpg.some((n) => n.level === 'warn' && /JPEG/.test(n.text)));
});

test('Zugangsdaten: werden gespeichert, aber nie im Klartext in Einstellungen abgelegt', async () => {
  await S.secrets.setSecret('anthropic.apiKey', 'sk-ant-test-123');
  assert.equal(await S.secrets.getSecret('anthropic.apiKey'), 'sk-ant-test-123');
  const settingsFile = fs.readFileSync(path.join(tmp, '.studio', 'db', 'settings.json'), 'utf8');
  assert.ok(!settingsFile.includes('sk-ant-test-123'));
});

test('Zielshop-Schutz: fremder Shop wird nie als Ziel verwendet', async () => {
  const id = await readyProduct();
  S.products.saveProduct(id, { targetShops: ['xgyzvd-1m.myshopify.com'] });
  const v = await S.products.validateProduct(id);
  assert.equal(v.status, STATUS.MISSING);
  assert.ok(v.issues.some((i) => /Nicht als Zielshop freigegeben/.test(i.text)));
  const r = await S.products.reviewProduct(id);
  assert.equal(r.ok, false);
});

test('Website-Editor: Abschnitte mit Einstellungen, eigene Änderung → Vorschlag im gewohnten Freigabeweg', async () => {
  mock.state.themes.get('gid://shopify/OnlineStoreTheme/1').files.set('templates/index.json', '/* Automatisch erzeugt */\n{"sections":{"hero":{"type":"hero","settings":{"heading":"Willkommen"}}},"order":["hero"]}');
  const st = await S.themeEditor.structure({ template: 'templates/index.json' });
  const main = st.groups.find((g) => g.main);
  const hero = main.sections.find((x) => x.id === 'hero');
  assert.equal(hero.name, 'Hero');
  const f = hero.settings.find((x) => x.id === 'heading');
  assert.equal(f.label, 'Überschrift');
  assert.equal(f.editable, true);
  const before = mock.state.themes.get('gid://shopify/OnlineStoreTheme/1').files.get('templates/index.json');
  const d = await S.themeEditor.setEdit({ file: 'templates/index.json', sectionId: 'hero', setting: 'heading', value: 'Licht in der Dunkelheit', label: 'Hero › Überschrift' });
  assert.equal(d.proposal.blocking.length, 0, d.proposal.blocking.join(' '));
  assert.match(d.proposal.themeFiles[0].newContent, /Licht in der Dunkelheit/);
  assert.match(d.proposal.themeFiles[0].newContent, /^\/\* Automatisch erzeugt \*\//, 'Kopfkommentar bleibt erhalten');
  assert.equal(mock.state.themes.get('gid://shopify/OnlineStoreTheme/1').files.get('templates/index.json'), before, 'im Shop noch nichts geändert');
  const r = await S.website.reviewDraft(d.id);
  assert.ok(r.approvalHash);
  // Zurücknehmen → kein Vorschlag mehr
  const d2 = await S.themeEditor.setEdit({ file: 'templates/index.json', sectionId: 'hero', setting: 'heading', remove: true });
  assert.equal(d2.proposal, null);
  await assert.rejects(() => S.themeEditor.setEdit({ file: 'layout/theme.liquid', sectionId: 'x', setting: 'y', value: 1 }), /nicht bearbeitet/);
  await assert.rejects(() => S.themeEditor.setEdit({ file: 'templates/index.json', sectionId: '../x', setting: 'y', value: 1 }), /Ungültige/);
});

test('Shop-Vorschau: Anmeldung mit Shop-Passwort, Links umgeschrieben, Einbettungssperre entfernt, abgeschottet', async () => {
  const http = await import('node:http');
  let shopHost;
  const shop = http.createServer((req, res) => {
    const cookie = req.headers.cookie || '';
    if (req.method === 'POST' && req.url === '/password') {
      let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
        if (new URLSearchParams(b).get('password') === 'geheim') { res.writeHead(302, { 'Set-Cookie': 'storefront_digest=ok; path=/', Location: '/' }); } else res.writeHead(302, { Location: '/password' });
        res.end();
      });
      return;
    }
    if (req.url === '/password') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<form>Passwort</form>'); }
    if (!cookie.includes('storefront_digest=ok')) { res.writeHead(302, { Location: '/password' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'" });
    res.end(`<html><head><link rel="stylesheet" href="/cdn/shop/t/1/assets/base.css"></head><body><a href="/products/kreuz">Kreuz</a><img src="//${shopHost}/cdn/shop/files/a.png"><div id="shopify-section-template--1__hero"><h2>Hallo</h2></div><p>${req.url}</p></body></html>`);
  });
  await new Promise((r) => shop.listen(0, '127.0.0.1', r));
  shopHost = `127.0.0.1:${shop.address().port}`;
  process.env.APOLOGEA_STOREFRONT_URL = `http://${shopHost}`;
  const proxy = http.createServer((req, res) => S.storefront.handle(req, res, new URL(req.url, 'http://127.0.0.1')));
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${proxy.address().port}`;
  try {
    let res = await fetch(`${base}/vorschau/falsch/live/`);
    assert.equal(res.status, 403);
    res = await fetch(`${base}${S.storefront.previewBase()}/`);
    assert.match(await res.text(), /passwortgeschützt/);
    await S.secrets.setSecret('shopify.storefrontPassword', 'geheim');
    res = await fetch(`${base}${S.storefront.previewBase()}/?x=1`);
    const html = await res.text();
    assert.equal(res.headers.get('x-frame-options'), null);
    assert.equal(res.headers.get('content-security-policy'), 'sandbox allow-scripts');
    const P = S.storefront.previewBase();
    assert.ok(html.includes(`href="${P}/products/kreuz"`), html);
    assert.ok(html.includes(`href="${P}/cdn/shop/t/1/assets/base.css"`));
    assert.ok(html.includes(`src="${P}/cdn/shop/files/a.png"`));
    assert.ok(html.includes('__studio-tag'));
    res = await fetch(`${base}${S.storefront.previewBase('gid://shopify/OnlineStoreTheme/555')}/pages/a`);
    assert.match(await res.text(), /preview_theme_id=555/);
    res = await fetch(`${base}${P}/`, { method: 'POST' });
    assert.equal(res.status, 405);
  } finally { shop.close(); proxy.close(); delete process.env.APOLOGEA_STOREFRONT_URL; }
});

test('MarketPrint-Website: Produktliste sofort verfügbar (ohne Abfrage über Claude Code)', async () => {
  const mp = await import('../src/server/integrations/marketprint.js');
  const c = mp.websiteCatalog();
  assert.ok(c.items.length >= 10);
  assert.ok(c.items.every((i) => /^[a-f0-9]{24}$/.test(i.id) && i.title));
});
