// Tests der Anbieter-Bausteine Printify und Printful: echter Anbietercode gegen simulierte HTTP-Server
// (Antworten aus den Beispieldaten in fixtures/*/sim.js). Es werden keine echten Anbieter angesprochen.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { printifySim } from '../fixtures/printify/sim.js';
import { printfulSim } from '../fixtures/printful/sim.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apologea-providers-'));
process.env.APOLOGEA_DATA_DIR = tmp;
process.env.APOLOGEA_TEST = '1';

const calls = { printify: [], printful: [] };
const faults = { printifyPublish500: false };

function server(name, handler) {
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      calls[name].push({ method: req.method, url: req.url, auth: req.headers.authorization, store: req.headers['x-pf-store-id'], body: body ? JSON.parse(body) : null });
      res.setHeader('Content-Type', 'application/json');
      if (name === 'printify' && faults.printifyPublish500 && req.url.endsWith('/publish.json')) { res.statusCode = 500; return res.end('{"error":"temporär"}'); }
      try { res.end(JSON.stringify(await handler(req.method, req.url, body ? JSON.parse(body) : null))); } catch (err) { res.statusCode = 400; res.end(JSON.stringify({ error: { message: err.message } })); }
    });
  });
}
const pfy = server('printify', printifySim);
const pfl = server('printful', printfulSim);
pfy.keepAliveTimeout = 60_000;
pfl.keepAliveTimeout = 60_000;
let S;

before(async () => {
  await new Promise((r) => pfy.listen(0, '127.0.0.1', r));
  await new Promise((r) => pfl.listen(0, '127.0.0.1', r));
  process.env.APOLOGEA_PRINTIFY_URL = `http://127.0.0.1:${pfy.address().port}`;
  process.env.APOLOGEA_PRINTFUL_URL = `http://127.0.0.1:${pfl.address().port}`;
  (await import('../src/server/paths.js')).ensureDirs();
  const store = await import('../src/server/store.js');
  store.openStore();
  S = {
    store,
    secrets: await import('../src/server/secrets.js'),
    products: await import('../src/server/services/products.js'),
    designs: await import('../src/server/services/designs.js'),
    registry: await import('../src/server/providers/registry.js'),
  };
  await S.secrets.setSecret('printify.token', 'pfy-test-token');
  await S.secrets.setSecret('printful.token', 'pfl-test-token');
  store.saveSettings({ printify: { mode: 'api', allowedShops: ['777'] }, printful: { mode: 'api', allowedShops: ['11', '12'] } });
});
after(() => { pfy.close(); pfl.close(); });

const { STATUS } = await import('../src/server/util.js');

async function design(name, w = 3600, hgt = 4800) {
  const { PNG } = await import('pngjs');
  const img = new PNG({ width: w, height: hgt });
  img.data.fill(0);
  for (let i = 0; i < w * 100 * 4; i += 4) { img.data[i] = 200; img.data[i + 3] = 255; }
  const f = path.join(tmp, '.studio', 'tmp', `up-${name}-${Date.now()}`);
  fs.writeFileSync(f, PNG.sync.write(img));
  return S.designs.importDesign({ tmpPath: f, originalName: `${name}.png` }).design;
}

test('Registry: alle drei Anbieter mit gleichem Vertrag', () => {
  const list = S.registry.listProviders();
  assert.deepEqual(list.map((p) => p.id), ['marketprint', 'printify', 'printful']);
  for (const id of ['marketprint', 'printify', 'printful']) {
    const p = S.registry.getProvider(id);
    for (const fn of ['account', 'catalog', 'catalogOptions', 'details', 'listImages', 'uploadImage', 'buildRequest', 'publish', 'reconcile', 'testConnection']) assert.equal(typeof p[fn], 'function', `${id}.${fn}`);
  }
});

test('Printify: Katalog, Druckdienstleister, Details, Upload (mit Zugangsschlüssel)', async () => {
  const p = S.registry.getProvider('printify');
  const acc = await p.account({ refresh: true });
  assert.equal(acc.targets[0].id, '777');
  const cat = await p.catalog({ refresh: true });
  assert.ok(cat.items.length >= 2);
  const opts = await p.catalogOptions(cat.items[0].id);
  assert.equal(opts[0].id, '501');
  const d = await p.details(`${cat.items[0].id}:${opts[0].id}`, { refresh: true });
  assert.deepEqual(d.printAreas.map((a) => a.name), ['front', 'back']);
  assert.equal(d.variants.length, 8);
  assert.equal(d.variants[0].price, null, 'Einkaufspreis wird nicht erfunden');
  assert.equal(calls.printify.at(-1).auth, 'Bearer pfy-test-token');
  const up = await p.uploadImage({ filename: 'x.png', buffer: Buffer.from('abc') });
  assert.ok(up.imageId);
});

async function printifyProduct() {
  const main = await design('motiv-hell');
  const alt = await design('motiv-dunkel');
  S.designs.linkProvider(main.id, 'printify', { imageId: 'up-main' });
  S.designs.linkProvider(alt.id, 'printify', { imageId: 'up-alt' });
  const p = S.products.createProduct({ provider: 'printify' });
  assert.deepEqual(p.targetShops, ['777'], 'freigegebener Zielshop wird vorbelegt');
  S.products.saveProduct(p.id, {
    internalName: 'Pfy 01', publicTitle: 'Printify Shirt', baseProduct: { id: '9001:501', title: 'Beispiel' },
    variantIds: ['90010', '90011', '90014'], price: 39.9, tags: ['apologea'],
    placements: [{ printArea: 'front', designId: main.id, placement: { mode: 'custom', xPercent: 0.5, yPercent: 0.4, widthPercent: 0.7 }, alternative: { designId: alt.id, colors: ['Weiß'] } }],
  });
  return p.id;
}

test('Printify: genaue Anfrage (Cent-Preise, Position, Alternativ-Motiv, Tags)', async () => {
  const id = await printifyProduct();
  const draft = S.store.store().products.get(id);
  const req = await S.products.buildRequest(draft);
  assert.equal(req.shopId, '777');
  assert.equal(req.product.blueprint_id, 9001);
  assert.equal(req.product.print_provider_id, 501);
  assert.ok(req.product.variants.every((v) => v.price === 3990 && v.is_enabled));
  assert.deepEqual(req.product.tags, ['apologea']);
  assert.equal(req.product.print_areas.length, 2);
  assert.deepEqual(req.product.print_areas[0].variant_ids, [90010, 90011]);
  assert.deepEqual(req.product.print_areas[1].variant_ids, [90014]);
  assert.deepEqual(req.product.print_areas[0].placeholders[0].images[0], { id: 'up-main', x: 0.5, y: 0.4, scale: 0.7, angle: 0 });
  assert.equal(req.product.print_areas[1].placeholders[0].images[0].id, 'up-alt');
});

test('Printify: echte Mockups (Entwurf), dann Veröffentlichen ohne zweites Anlegen', async () => {
  const id = await printifyProduct();
  const v = await S.products.validateProduct(id);
  assert.equal(v.status, STATUS.READY, JSON.stringify(v.issues));
  const m = await S.products.createMockups(id);
  assert.ok(m.images.length >= 1);
  const remote = S.store.store().products.get(id).remote;
  assert.ok(remote?.id);
  const createsBefore = calls.printify.filter((c) => c.method === 'POST' && c.url.endsWith('/products.json')).length;
  const r = await S.products.reviewProduct(id);
  const res = await S.products.publishProduct(id, { approvalHash: r.approvalHash });
  assert.equal(res.status, STATUS.SUCCESS);
  assert.equal(res.result.remoteId, remote.id);
  const createsAfter = calls.printify.filter((c) => c.method === 'POST' && c.url.endsWith('/products.json')).length;
  assert.equal(createsAfter, createsBefore, 'kein zweites Produkt angelegt');
  assert.ok(calls.printify.some((c) => c.method === 'PUT' && c.url.includes(remote.id)), 'Entwurf wurde aktualisiert');
  await assert.rejects(() => S.products.publishProduct(id, { approvalHash: r.approvalHash }), /bereits veröffentlicht/);
});

test('Printify: Serverfehler beim Veröffentlichen → „Ergebnis prüfen“, Entwurf bleibt verknüpft', async () => {
  const id = await printifyProduct();
  const r = await S.products.reviewProduct(id);
  faults.printifyPublish500 = true;
  await assert.rejects(() => S.products.publishProduct(id, { approvalHash: r.approvalHash }), /Ergebnis unklar/);
  faults.printifyPublish500 = false;
  const d = S.store.store().products.get(id);
  assert.equal(d.status, STATUS.CHECK);
  assert.ok(d.publish.remote?.id, 'angelegter Entwurf ist bekannt');
  const rec = await S.products.reconcileProduct(id, { action: 'auto' });
  assert.equal(rec.found, false);
  assert.match(rec.message, /noch\) nicht im Shop/);
});

test('Printify: nicht freigegebener Zielshop wird blockiert', async () => {
  const id = await printifyProduct();
  S.products.saveProduct(id, { targetShops: ['999'] });
  const v = await S.products.validateProduct(id);
  assert.ok(v.issues.some((i) => /Nicht als Zielshop freigegeben/.test(i.text)));
});

async function printfulProduct(store) {
  const main = await design('pf-motiv');
  S.designs.linkProvider(main.id, 'printful', { imageId: '555' });
  const p = S.products.createProduct({ provider: 'printful' });
  S.products.saveProduct(p.id, {
    internalName: 'Pfl 01', publicTitle: 'Printful Shirt', baseProduct: { id: '7001', title: 'Beispiel' }, targetShops: [store],
    variantIds: ['70010', '70011'], price: 34.9, placements: [{ printArea: 'front', designId: main.id, placement: { mode: 'auto' } }],
  });
  return p.id;
}

test('Printful: Katalog mit echten Grundpreisen und Druckflächen', async () => {
  const d = await S.registry.getProvider('printful').details('7001', { refresh: true });
  assert.equal(d.variants[0].price, 13.95);
  assert.equal(d.printAreas[0].width, 3600);
  assert.equal(d.variants[0].colorHex, '#0b0b0b');
});

test('Printful: Shopify-verbundener Shop → ehrliche Ablehnung, nichts ausgeführt', async () => {
  const id = await printfulProduct('11');
  const r = await S.products.reviewProduct(id);
  assert.equal(r.ok, true);
  assert.ok(r.summary.warnings.some((w) => /nicht möglich/.test(w)));
  const before = calls.printful.filter((c) => c.method === 'POST' && c.url === '/store/products').length;
  await assert.rejects(() => S.products.publishProduct(id, { approvalHash: r.approvalHash }), /nur in „Manual order \/ API“-Shops/);
  assert.equal(calls.printful.filter((c) => c.method === 'POST' && c.url === '/store/products').length, before);
  assert.equal(S.store.store().products.get(id).status, STATUS.FAILED);
});

test('Printful: „Manual order / API“-Shop → Anlegen mit Store-Kennung, Mockups über Generator', async () => {
  const id = await printfulProduct('12');
  const m = await S.products.createMockups(id);
  assert.ok(m.images.length >= 1);
  const r = await S.products.reviewProduct(id);
  const res = await S.products.publishProduct(id, { approvalHash: r.approvalHash });
  assert.equal(res.status, STATUS.SUCCESS);
  const post = calls.printful.filter((c) => c.method === 'POST' && c.url === '/store/products').at(-1);
  assert.equal(post.store, '12');
  assert.equal(post.body.sync_variants[0].retail_price, '34.90');
  assert.deepEqual(post.body.sync_variants[0].files, [{ type: 'front', id: 555 }]);
});
