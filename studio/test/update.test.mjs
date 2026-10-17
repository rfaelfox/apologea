// Tests der Programm-Aktualisierung gegen einen simulierten GitHub-Server (kein echter Download).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apologea-update-'));
const target = path.join(tmp, 'app');
process.env.APOLOGEA_DATA_DIR = path.join(tmp, 'daten');
process.env.APOLOGEA_TEST = '1';
process.env.APOLOGEA_UPDATE_TARGET = target;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const SHA1 = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);
const deps = sha('{}');

// Stand auf „GitHub“
const remote = {
  [SHA1]: { files: { 'package.json': '{"version":"9.9.9"}', 'src/neu.js': 'export const x = 2;\n', 'public/alt.css': 'body{}' }, depsHash: deps },
};
const manifestOf = (files, depsHash, version = '9.9.9') => ({ app: 'APOLOGEA Studio', version, depsHash, files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha(v)])) });
let currentSha = SHA1;
const tamper = { file: null };
const hits = [];

const srv = http.createServer((req, res) => {
  hits.push(req.url);
  const m = req.url.match(/^\/api\/repos\/rfaelfox\/apologea\/commits\/(.+)$/);
  if (m) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ sha: currentSha, commit: { committer: { date: '2026-10-16T12:00:00Z' }, message: 'Neue Fassung\n\nDetails' } })); }
  const r = req.url.match(/^\/raw\/rfaelfox\/apologea\/([0-9a-f]{40})\/studio\/(.+)$/);
  if (r && remote[r[1]]) {
    const rel = decodeURIComponent(r[2]);
    const st = remote[r[1]];
    if (rel === 'update.json') return res.end(JSON.stringify(st.manifest || manifestOf(st.files, st.depsHash)));
    if (rel in st.files) return res.end(tamper.file === rel ? 'manipuliert' : st.files[rel]);
  }
  res.statusCode = 404; res.end('nicht gefunden');
});

let U;
before(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  process.env.APOLOGEA_UPDATE_API = `${base}/api`;
  process.env.APOLOGEA_UPDATE_RAW = `${base}/raw`;
  (await import('../src/server/paths.js')).ensureDirs();
  (await import('../src/server/store.js')).openStore();
  U = await import('../src/server/services/updater.js');
});
after(() => srv.close());

function installLocal(files, depsHash = deps) {
  fs.rmSync(target, { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(target, rel)), { recursive: true });
    fs.writeFileSync(path.join(target, rel), content);
  }
  fs.writeFileSync(path.join(target, 'update.json'), JSON.stringify(manifestOf(files, depsHash, '1.0.0')));
  fs.writeFileSync(path.join(target, 'install.json'), '{"dataDir":"x"}');
}

test('update.json im Projekt ist aktuell (vor dem Commit „node tools/manifest.mjs“ ausführen)', async () => {
  const { buildManifest } = await import('../tools/manifest.mjs');
  const committed = JSON.parse(fs.readFileSync(path.join(ROOT, 'update.json'), 'utf8'));
  assert.deepEqual(committed, buildManifest(ROOT));
});

test('Suchen: erkennt geänderte und entfernte Dateien', async () => {
  installLocal({ 'package.json': '{"version":"1.0.0"}', 'src/neu.js': 'export const x = 1;\n', 'public/alt.css': 'body{}', 'src/weg.js': 'alt' });
  currentSha = SHA1;
  const info = await U.checkForUpdate();
  assert.equal(info.available, true);
  assert.equal(info.currentVersion, '1.0.0');
  assert.equal(info.newVersion, '9.9.9');
  assert.equal(info.changedFiles, 2);
  assert.equal(info.removedFiles, 1);
  assert.equal(info.needsInstaller, false);
  assert.equal(info.commitMessage, 'Neue Fassung');
});

test('Manipulierte Datei → Abbruch, nichts verändert', async () => {
  tamper.file = 'src/neu.js';
  await assert.rejects(() => U.applyUpdate({ sha: SHA1 }), /Prüfsumme/);
  tamper.file = null;
  assert.equal(fs.readFileSync(path.join(target, 'src/neu.js'), 'utf8'), 'export const x = 1;\n');
  assert.ok(fs.existsSync(path.join(target, 'src/weg.js')));
});

test('Aktualisieren: ersetzt nur Programmdateien, sichert alte Fassung, lässt install.json in Ruhe', async () => {
  const r = await U.applyUpdate({ sha: SHA1 });
  assert.equal(r.version, '9.9.9');
  assert.equal(fs.readFileSync(path.join(target, 'src/neu.js'), 'utf8'), 'export const x = 2;\n');
  assert.ok(!fs.existsSync(path.join(target, 'src/weg.js')));
  assert.ok(fs.existsSync(path.join(target, 'install.json')));
  assert.equal(fs.readFileSync(path.join(r.backupDir, 'src/neu.js'), 'utf8'), 'export const x = 1;\n');
  assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'update.json'), 'utf8')).version, '9.9.9');
  const again = await U.checkForUpdate();
  assert.equal(again.available, false);
});

test('Veralteter Stand (inzwischen neuer Commit) wird nicht angewendet', async () => {
  remote[SHA2] = { files: { ...remote[SHA1].files, 'src/neu.js': 'export const x = 3;\n' }, depsHash: deps };
  currentSha = SHA2;
  await assert.rejects(() => U.applyUpdate({ sha: SHA1 }), /neueren Stand/);
});

test('Neue Programmbibliotheken → Installationspaket nötig', async () => {
  remote[SHA2].depsHash = sha('{"neu":"1"}');
  const info = await U.checkForUpdate();
  assert.equal(info.needsInstaller, true);
  await assert.rejects(() => U.applyUpdate({ sha: SHA2 }), /Installationspaket/);
  remote[SHA2].depsHash = deps;
});

test('Unzulässige Pfade in der Dateiliste → Abbruch', async () => {
  remote[SHA2].manifest = { app: 'APOLOGEA Studio', version: '9.9.9', depsHash: deps, files: { '../../boese.js': sha('x') } };
  await assert.rejects(() => U.checkForUpdate(), /unzulässiger Eintrag/);
  remote[SHA2].manifest = { app: 'APOLOGEA Studio', version: '9.9.9', depsHash: deps, files: { 'node_modules/x/index.js': sha('x') } };
  await assert.rejects(() => U.checkForUpdate(), /unzulässiger Eintrag/);
  delete remote[SHA2].manifest;
});

test('Ohne eigene Dateiliste (alte Version): Hinweis auf Installationspaket', async () => {
  fs.rmSync(path.join(target, 'update.json'));
  const info = await U.checkForUpdate();
  assert.equal(info.noLocalManifest, true);
  assert.equal(info.needsInstaller, true);
  await assert.rejects(() => U.applyUpdate({ sha: SHA2 }), /Installationspaket/);
});
