// Tests für die Ein-Klick-Einrichtung des Live-View-Dienstes und den Einrichtungs-Assistenten.
// TESTDATEN: simuliertes Cloudflare (keine echten Konten, keine Kosten). Der simulierte Worker beantwortet
// /v1/health nur mit dem Lese-Schlüssel, der beim Hochladen als Geheimnis übergeben wurde.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apologea-cf-'));
process.env.APOLOGEA_DATA_DIR = tmp;
process.env.APOLOGEA_TEST = '1';

import { createCloudflareMock, MOCK_CF_TOKEN } from './mock-cloudflare.mjs';

const { server: cf, calls, state } = createCloudflareMock();

let S;
const TOKEN = MOCK_CF_TOKEN;
before(async () => {
  await new Promise((r) => cf.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${cf.address().port}`;
  process.env.APOLOGEA_CF_API = `${base}/client/v4`;
  process.env.APOLOGEA_CF_WORKER_URL = `${base}/worker`;
  (await import('../src/server/paths.js')).ensureDirs();
  const store = await import('../src/server/store.js');
  store.openStore();
  S = {
    store,
    secrets: await import('../src/server/secrets.js'),
    cloudflare: await import('../src/server/analytics/cloudflare.js'),
    setup: await import('../src/server/analytics/setup.js'),
  };
});
after(() => cf.close());

test('Ohne Token: klare Meldung, nichts wird gesendet', async () => {
  await assert.rejects(S.cloudflare.deployCollector(), /API-Token eintragen/);
  await assert.rejects(S.cloudflare.deployCollector({ apiToken: 'zu kurz' }), /Cloudflare-API-Token/);
  assert.equal(calls.length, 0);
});

test('Fehlende Berechtigung: verständlicher Hinweis, Fortschritt zeigt den Fehlschritt', async () => {
  state.failAuth = true;
  const r = await S.cloudflare.deployCollector({ apiToken: TOKEN });
  state.failAuth = false;
  assert.equal(r.ok, false);
  assert.match(r.error, /D1 – Bearbeiten/);
  assert.equal(r.steps.at(-1).ok, false);
  assert.equal(S.store.getSettings().analytics.collectorUrl, '', 'nichts gespeichert');
});

test('Einrichtung: Datenbank, Tabellen, Worker mit Bindungen, Aufräum-Zeitplan, Adresse, Erreichbarkeit', async () => {
  calls.length = 0;
  const r = await S.cloudflare.deployCollector(); // Token ist aus dem vorigen Test verschlüsselt gespeichert
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.reachable, true);
  assert.equal(state.dbs.length, 1);
  assert.deepEqual(state.queries, S.cloudflare.schemaStatements());
  assert.ok(state.queries.some((q) => /CREATE TABLE IF NOT EXISTS events/.test(q)));
  const md = state.script.metadata;
  assert.equal(md.main_module, 'worker.js');
  assert.deepEqual(md.bindings.find((b) => b.type === 'd1'), { type: 'd1', name: 'DB', id: 'db-1' });
  assert.equal(md.bindings.find((b) => b.name === 'SHOP_DOMAIN').text, 'dfz1mp-1u.myshopify.com');
  const readToken = await S.secrets.getSecret('analytics.collectorToken');
  assert.ok(readToken && readToken.length >= 30);
  assert.deepEqual(md.bindings.find((b) => b.name === 'READ_TOKEN'), { type: 'secret_text', name: 'READ_TOKEN', text: readToken });
  assert.match(state.script.files['worker.js'], /from '\.\/core\.js'/);
  assert.match(state.script.files['core.js'], /export async function handle/);
  assert.deepEqual(state.script.types, ['application/javascript+module', 'application/javascript+module']);
  assert.deepEqual(state.schedules, [{ cron: '17 * * * *' }]);
  assert.match(state.subdomain, /^apologea-[0-9a-f]{6}$/);
  assert.equal(state.enabled, true);
  const a = S.store.getSettings().analytics;
  assert.equal(a.collectorUrl, process.env.APOLOGEA_CF_WORKER_URL);
  assert.equal(a.liveSetup.databaseId, 'db-1');
  assert.ok(r.steps.every((s) => s.ok), JSON.stringify(r.steps));
});

test('Erneut einrichten: gleiche Datenbank und gleicher Lese-Schlüssel, keine neue Subdomain', async () => {
  const before = await S.secrets.getSecret('analytics.collectorToken');
  const sub = state.subdomain;
  calls.length = 0;
  const r = await S.cloudflare.deployCollector();
  assert.equal(r.ok, true);
  assert.equal(state.dbs.length, 1, 'keine zweite Datenbank');
  assert.ok(!calls.includes('POST /accounts/acc1/d1/database'));
  assert.ok(!calls.includes('PUT /accounts/acc1/workers/subdomain'));
  assert.equal(state.subdomain, sub);
  assert.equal(await S.secrets.getSecret('analytics.collectorToken'), before);
});

test('Pixel-Code: Adresse und Shop eingesetzt, Einwilligungsprüfung bleibt', () => {
  const code = S.cloudflare.pixelCode();
  assert.ok(code.includes(`const ENDPOINT = '${process.env.APOLOGEA_CF_WORKER_URL}/v1/e';`));
  assert.ok(code.includes("const SHOP = 'dfz1mp-1u.myshopify.com';"));
  assert.ok(!code.includes('HIER-DEINE-WORKER-ADRESSE'));
  assert.match(code, /analyticsProcessingAllowed/);
});

test('Assistent: echte Prüfung je Schritt (ohne Shopify-App blockiert, Live-Dienst läuft, Pixel wartet auf Ereignisse)', async () => {
  const st = await S.setup.setupStatus();
  const by = Object.fromEntries(st.steps.map((s) => [s.id, s.state]));
  assert.equal(by.app, 'todo');
  assert.equal(by.scopes, 'blocked');
  assert.equal(by.protected, 'blocked');
  assert.equal(by.sync, 'blocked');
  assert.equal(by.live, 'ok');
  assert.equal(by.pixel, 'todo');
  assert.equal(by.costs, 'optional');
  assert.equal(st.done, 1);
  assert.equal(st.total, 6);
  assert.match(st.links.customerEvents, /admin\.shopify\.com\/store\/dfz1mp-1u\/settings\/customer_events/);
  assert.equal(st.cloudflare.deployed, true);
  assert.equal(st.cloudflare.updateAvailable, false);
});
