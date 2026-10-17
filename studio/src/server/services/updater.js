import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { APP_DIR, DIRS } from '../paths.js';
import { store, getSettings } from '../store.js';
import { STATUS, UserError } from '../util.js';

/**
 * Programm-Aktualisierung ohne neues Installationspaket.
 *
 * Quelle ist das öffentliche GitHub-Repository des Projekts. Ablauf:
 *  1. Neuesten Stand (Commit) des eingestellten Zweigs abfragen.
 *  2. Dessen update.json laden (Liste aller Programmdateien mit SHA-256) und mit der eigenen vergleichen.
 *  3. Erst nach Klick auf „Jetzt aktualisieren“: nur geänderte Dateien laden, jede Prüfsumme kontrollieren,
 *     bisherige Fassungen sichern, Dateien ersetzen, Dienst neu starten.
 * Daten, Zugangsdaten und Programmbibliotheken (node_modules) bleiben unberührt. Ändern sich die
 * Bibliotheken, meldet das Programm, dass einmal das Installationspaket nötig ist.
 */

export const DEFAULT_SOURCE = { repo: 'rfaelfox/apologea', branch: 'claude/apologea-shopify-theme-9kvfrj', dir: 'studio' };

// Nur diese Pfade dürfen durch eine Aktualisierung geschrieben oder entfernt werden.
const ALLOWED = /^(?:launcher\.js|package\.json|package-lock\.json|(?:src|public|fixtures)\/[A-Za-z0-9._\-/]+)$/;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Zielordner der Aktualisierung (im Testbetrieb ein Testordner statt des Programmordners)
function appDir() { return (process.env.APOLOGEA_TEST === '1' && process.env.APOLOGEA_UPDATE_TARGET) || APP_DIR; }

function source() {
  return { ...DEFAULT_SOURCE, ...(getSettings().update || {}) };
}

// Testbetrieb: eigene Adressen statt GitHub
function apiBase() { return (process.env.APOLOGEA_TEST === '1' && process.env.APOLOGEA_UPDATE_API) || 'https://api.github.com'; }
function rawBase() { return (process.env.APOLOGEA_TEST === '1' && process.env.APOLOGEA_UPDATE_RAW) || 'https://raw.githubusercontent.com'; }

export function localManifest() {
  try { return JSON.parse(fs.readFileSync(path.join(appDir(), 'update.json'), 'utf8')); } catch { return null; }
}

async function fetchBuf(url, { json = false, timeoutMs = 30_000 } = {}) {
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'APOLOGEA-Studio', Accept: json ? 'application/vnd.github+json' : '*/*' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new UserError(`Aktualisierung: keine Verbindung zu GitHub (${err.name === 'TimeoutError' ? 'Zeitüberschreitung' : err.message}).`, { status: 502, code: 'update_network' });
  }
  if (res.status === 403 || res.status === 429) throw new UserError('GitHub begrenzt gerade die Abfragen. Bitte in einer Stunde erneut versuchen.', { status: 502, code: 'update_rate' });
  if (!res.ok) throw new UserError(`Aktualisierung: GitHub antwortet mit ${res.status}.`, { status: 502, code: 'update_http' });
  const buf = Buffer.from(await res.arrayBuffer());
  return json ? JSON.parse(buf.toString('utf8')) : buf;
}

function rawUrl(src, sha, rel) {
  return `${rawBase()}/${src.repo}/${sha}/${src.dir}/${rel.split('/').map(encodeURIComponent).join('/')}`;
}

async function remoteState() {
  const src = source();
  const commit = await fetchBuf(`${apiBase()}/repos/${src.repo}/commits/${encodeURIComponent(src.branch)}`, { json: true });
  const sha = commit?.sha;
  if (!/^[0-9a-f]{40}$/.test(sha || '')) throw new UserError('Aktualisierung: unerwartete Antwort von GitHub.', { status: 502 });
  const manifest = JSON.parse((await fetchBuf(rawUrl(src, sha, 'update.json'))).toString('utf8'));
  if (manifest?.app !== 'APOLOGEA Studio' || typeof manifest.files !== 'object') throw new UserError('Aktualisierung: Dateiliste auf GitHub ist ungültig.', { status: 502 });
  for (const rel of Object.keys(manifest.files)) {
    if (!ALLOWED.test(rel) || rel.split('/').includes('..') || !/^[0-9a-f]{64}$/.test(manifest.files[rel])) throw new UserError(`Aktualisierung: unzulässiger Eintrag „${rel}“ – abgebrochen.`, { status: 502 });
  }
  return { src, sha, manifest, date: commit?.commit?.committer?.date || null, message: (commit?.commit?.message || '').split('\n')[0] };
}

function diff(local, remote) {
  const lf = local?.files || {};
  const changed = Object.keys(remote.files).filter((f) => lf[f] !== remote.files[f]);
  const removed = Object.keys(lf).filter((f) => !(f in remote.files) && ALLOWED.test(f) && !f.split('/').includes('..'));
  return { changed, removed };
}

let lastCheck = null;

export async function checkForUpdate() {
  const local = localManifest();
  const r = await remoteState();
  const { changed, removed } = diff(local, r.manifest);
  lastCheck = {
    checkedAt: new Date().toISOString(),
    currentVersion: local?.version || null,
    newVersion: r.manifest.version,
    sha: r.sha,
    commitDate: r.date,
    commitMessage: r.message,
    available: changed.length + removed.length > 0,
    changedFiles: changed.length,
    removedFiles: removed.length,
    needsInstaller: !local || local.depsHash !== r.manifest.depsHash,
    noLocalManifest: !local,
  };
  return lastCheck;
}

export function lastUpdateCheck() { return lastCheck; }

let applying = false;

/** Lädt die geänderten Dateien des geprüften Stands, kontrolliert sie und ersetzt sie. */
export async function applyUpdate({ sha }) {
  if (applying) throw new UserError('Die Aktualisierung läuft bereits.', { status: 409 });
  if (!/^[0-9a-f]{40}$/.test(sha || '')) throw new UserError('Bitte zuerst nach Aktualisierungen suchen.', { status: 400 });
  const running = store().jobs.list((j) => j.status === STATUS.RUNNING);
  if (running.length) throw new UserError('Gerade läuft noch ein Vorgang. Bitte warten, bis er abgeschlossen ist, dann aktualisieren.', { status: 409 });
  applying = true;
  try {
    const local = localManifest();
    if (!local) throw new UserError('Diese Programmversion kann sich noch nicht selbst aktualisieren. Bitte einmal das neue Installationspaket installieren.', { status: 409, code: 'update_needs_installer' });
    const r = await remoteState();
    if (r.sha !== sha) throw new UserError('Inzwischen gibt es einen neueren Stand. Bitte erneut nach Aktualisierungen suchen.', { status: 409 });
    if (local.depsHash !== r.manifest.depsHash) throw new UserError('Diese Aktualisierung enthält neue Programmbibliotheken. Bitte einmal das neue Installationspaket installieren.', { status: 409, code: 'update_needs_installer' });
    const { changed, removed } = diff(local, r.manifest);

    // 1. Alles laden und prüfen, bevor irgendetwas ersetzt wird
    const staging = path.join(DIRS.tmp, `update-${sha.slice(0, 12)}`);
    fs.rmSync(staging, { recursive: true, force: true });
    for (const rel of changed) {
      const buf = await fetchBuf(rawUrl(r.src, sha, rel), { timeoutMs: 60_000 });
      if (sha256(buf) !== r.manifest.files[rel]) throw new UserError(`Aktualisierung: Prüfsumme von „${rel}“ stimmt nicht – nichts wurde verändert.`, { status: 502 });
      const dest = path.join(staging, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
    }

    // 2. Bisherige Fassungen sichern
    const backupDir = path.join(DIRS.internal, 'programm-sicherung', `${local.version}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    for (const rel of [...changed, ...removed, 'update.json']) {
      const cur = path.join(appDir(), rel);
      if (fs.existsSync(cur)) { fs.mkdirSync(path.dirname(path.join(backupDir, rel)), { recursive: true }); fs.copyFileSync(cur, path.join(backupDir, rel)); }
    }

    // 3. Ersetzen (update.json zuletzt – bei einem Abbruch wird beim nächsten Mal erneut verglichen)
    for (const rel of changed) {
      const dest = path.join(appDir(), rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const tmp = `${dest}.neu`;
      fs.copyFileSync(path.join(staging, rel), tmp);
      fs.renameSync(tmp, dest);
    }
    for (const rel of removed) fs.rmSync(path.join(appDir(), rel), { force: true });
    fs.writeFileSync(path.join(appDir(), 'update.json'), JSON.stringify(r.manifest, null, 1) + '\n');
    fs.rmSync(staging, { recursive: true, force: true });
    pruneBackups();
    console.log(`[Studio] Aktualisiert auf ${r.manifest.version} (${sha.slice(0, 7)}): ${changed.length} geändert, ${removed.length} entfernt. Sicherung: ${backupDir}`);
    lastCheck = null;
    return { ok: true, version: r.manifest.version, changed: changed.length, removed: removed.length, backupDir };
  } finally {
    applying = false;
  }
}

function pruneBackups() {
  const dir = path.join(DIRS.internal, 'programm-sicherung');
  try {
    const all = fs.readdirSync(dir).sort();
    for (const old of all.slice(0, Math.max(0, all.length - 5))) fs.rmSync(path.join(dir, old), { recursive: true, force: true });
  } catch { /* nichts zu tun */ }
}

/**
 * Neuer Dienst mit gleichem Port und Startschlüssel – das offene Programmfenster bleibt angemeldet
 * und lädt sich neu, sobald der Dienst wieder antwortet.
 */
export function spawnReplacement({ port, token, logFile }) {
  const out = fs.openSync(logFile, 'a');
  fs.writeSync(out, `\n=== Neustart nach Aktualisierung ${new Date().toISOString()} ===\n`);
  const child = spawn(process.execPath, [path.join(APP_DIR, 'src', 'server', 'index.js')], {
    cwd: APP_DIR,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, APOLOGEA_RESTART_TOKEN: token, APOLOGEA_RESTART_PORT: String(port), APOLOGEA_WAIT_PID: String(process.pid) },
  });
  child.unref();
}
