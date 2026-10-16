// Tests der MarketPrint-Anbindung „über Claude Code“ mit einer Ersatz-Kommandozeile (keine echten Aufrufe).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apologea-bridge-'));
process.env.APOLOGEA_DATA_DIR = tmp;
process.env.APOLOGEA_CLAUDE_PATH = path.join(here, 'fake-claude.mjs');
let mp; let store;

before(async () => {
  (await import('../src/server/paths.js')).ensureDirs();
  store = await import('../src/server/store.js');
  store.openStore();
  store.saveSettings({ marketprint: { mode: 'claude-code' } });
  mp = await import('../src/server/integrations/marketprint.js');
});

test('Verbindung prüfen: Connector und Werkzeugnamen werden erkannt', async () => {
  const r = await mp.testConnection();
  assert.equal(r.ok, true, r.message);
  assert.equal(r.toolPrefix, 'mcp__claude_ai_MarketPrint__Print_On_Demand__');
  assert.equal(r.account.email, 'test@apologea.invalid');
  assert.equal(store.getSettings().marketprint.mcpUrl, 'https://mcp.marketprint.test/mcp');
});

test('Verbindung prüfen: auch bei nachgeladenen Werkzeugen (Werkzeugsuche)', async () => {
  store.saveSettings({ marketprint: { claudeCodeServer: '' } });
  process.env.FAKE_CLAUDE_MODE = 'deferred';
  const r = await mp.testConnection();
  delete process.env.FAKE_CLAUDE_MODE;
  assert.equal(r.ok, true, r.message);
  assert.equal(r.toolPrefix, 'mcp__claude_ai_MarketPrint__Print_On_Demand__');
  assert.equal(r.account.email, 'test@apologea.invalid');
});

test('Namensvarianten des Servers', () => {
  assert.ok(mp.nameVariants('claude.ai MarketPrint: Print On Demand').includes('claude_ai_MarketPrint__Print_On_Demand'));
  assert.ok(mp.nameVariants('claude.ai MarketPrint: Print On Demand').includes('MarketPrint_Print_On_Demand'));
});

test('Werkzeugergebnis stammt direkt aus dem Ereignisstrom', async () => {
  const r = await mp.createShopProduct({ baseProductId: 'a'.repeat(24), variantIds: ['v1'], addToShops: ['dfz1mp-1u.myshopify.com'], images: [{ imageId: 'i', printArea: 'front' }], mockups: 'withDesign', price: 40 });
  assert.equal(r.draftId, 'draft-123');
});

test('Veränderte Argumente werden erkannt → Ergebnis prüfen', async () => {
  process.env.FAKE_CLAUDE_MODE = 'alter';
  await assert.rejects(() => mp.createShopProduct({ baseProductId: 'a'.repeat(24), variantIds: ['v1'], addToShops: ['x'], images: [], mockups: 'all', price: 40 }), (e) => e.code === 'needs_check');
});

test('Mehrfachaufruf wird erkannt → Ergebnis prüfen', async () => {
  process.env.FAKE_CLAUDE_MODE = 'twice';
  await assert.rejects(() => mp.createShopProduct({ baseProductId: 'a'.repeat(24), variantIds: ['v1'], addToShops: ['x'], images: [], mockups: 'all', price: 40 }), (e) => e.code === 'needs_check');
});

test('Kein Werkzeugaufruf → eindeutig „nichts ausgeführt“', async () => {
  process.env.FAKE_CLAUDE_MODE = 'notool';
  await assert.rejects(() => mp.createShopProduct({ baseProductId: 'a'.repeat(24), variantIds: ['v1'], addToShops: ['x'], images: [], mockups: 'all', price: 40 }), (e) => e.code === 'tool_not_called');
  delete process.env.FAKE_CLAUDE_MODE;
});
