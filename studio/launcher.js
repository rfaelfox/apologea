// APOLOGEA Studio – Starter
// Startet den lokalen Dienst (nur auf diesem PC erreichbar) und öffnet das Programmfenster.
// Läuft der Dienst bereits, wird nur ein neues Fenster geöffnet.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const { DIRS, ensureDirs, IS_WINDOWS } = await import('./src/server/paths.js');
const { findEdge, openExternal } = await import('./src/server/opener.js');

ensureDirs();
const runtimeFile = path.join(DIRS.internal, 'laufzeit.json');
const logFile = path.join(DIRS.logs, 'studio.log');

async function ping(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(1500) });
    return r.ok && (await r.json()).app === 'APOLOGEA Studio';
  } catch { return false; }
}

async function running() {
  try {
    const rt = JSON.parse(fs.readFileSync(runtimeFile, 'utf8'));
    if (await ping(rt.port)) return rt;
  } catch { /* keine Instanz */ }
  return null;
}

function rotateLog() {
  try { if (fs.statSync(logFile).size > 5 * 1024 * 1024) fs.renameSync(logFile, logFile + '.alt'); } catch { /* ignorieren */ }
}

async function startServer() {
  rotateLog();
  const out = fs.openSync(logFile, 'a');
  fs.writeSync(out, `\n=== Start ${new Date().toISOString()} ===\n`);
  const child = spawn(process.execPath, [path.join(APP_DIR, 'src', 'server', 'index.js')], {
    cwd: APP_DIR,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, APOLOGEA_IDLE_EXIT: '1' },
  });
  child.unref();
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const rt = await running();
    if (rt) return rt;
  }
  throw new Error('Der Studio-Dienst ist nicht gestartet. Details: ' + logFile);
}

function openWindow(url) {
  const edge = findEdge();
  if (edge) {
    // Eigenes App-Fenster ohne Browserleisten, mit eigenem Profil (Sitzungs-Cookie bleibt getrennt).
    const profile = path.join(DIRS.internal, 'fenster-profil');
    const p = spawn(edge, [`--app=${url}`, `--user-data-dir=${profile}`, '--window-size=1440,920', '--no-first-run', '--disable-features=Translate'], { detached: true, stdio: 'ignore', windowsHide: false });
    p.unref();
    return 'edge-app';
  }
  openExternal(url);
  return 'browser';
}

try {
  const rt = (await running()) || (await startServer());
  const url = `http://127.0.0.1:${rt.port}/auth?t=${rt.token}`;
  const how = openWindow(url);
  if (process.argv.includes('--check')) console.log(JSON.stringify({ ok: true, port: rt.port, window: how }));
} catch (err) {
  fs.appendFileSync(logFile, `[Starter] ${err.stack || err}\n`);
  if (IS_WINDOWS) {
    const msg = String(err.message).replace(/"/g, "'");
    spawn('mshta.exe', [`javascript:alert("APOLOGEA Studio konnte nicht starten:\\n\\n${msg}");close()`], { detached: true, stdio: 'ignore' }).unref();
  } else {
    console.error('APOLOGEA Studio konnte nicht starten:', err.message);
  }
  process.exitCode = 1;
}
