import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, IS_WINDOWS } from './paths.js';
import { writeAtomic } from './store.js';

/**
 * Zugangsdaten werden unter Windows mit der Datenschutz-API (DPAPI, Bereich „CurrentUser“)
 * verschlüsselt. Nur dein Windows-Benutzerkonto auf diesem PC kann sie wieder entschlüsseln.
 * Klartext wird nie auf die Festplatte geschrieben und nie an die Oberfläche zurückgegeben.
 *
 * Auf anderen Systemen (nur Entwicklung/Tests) wird eine Datei mit eingeschränkten Rechten
 * verwendet; die Oberfläche weist dann ausdrücklich darauf hin.
 */
const FILE = path.join(DIRS.internal, 'secrets.json');
const cache = new Map();

export const SECRET_BACKEND = IS_WINDOWS ? 'Windows-Datenschutz-API (DPAPI)' : 'Datei (nur Testbetrieb – nicht sicher)';

function readFile() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { version: 1, entries: {} }; }
}

async function writeFile(obj) {
  await writeAtomic(FILE, JSON.stringify(obj, null, 1));
  if (!IS_WINDOWS) { try { fs.chmodSync(FILE, 0o600); } catch { /* ignorieren */ } }
}

function runPowerShell(script, stdinText) {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
    });
    let out = '';
    let err = '';
    ps.stdout.on('data', (d) => { out += d; });
    ps.stderr.on('data', (d) => { err += d; });
    ps.on('error', reject);
    ps.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `PowerShell-Fehler ${code}`))));
    ps.stdin.end(stdinText);
  });
}

const PROTECT = `Add-Type -AssemblyName System.Security
$in = [Console]::In.ReadToEnd()
$bytes = [Text.Encoding]::UTF8.GetBytes($in)
$enc = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
[Convert]::ToBase64String($enc)`;

const UNPROTECT = `Add-Type -AssemblyName System.Security
$in = [Console]::In.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($in)
$dec = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
[Convert]::ToBase64String($dec)`;

async function protect(text) {
  if (!IS_WINDOWS) return 'plain:' + Buffer.from(text, 'utf8').toString('base64');
  return 'dpapi:' + (await runPowerShell(PROTECT, text));
}

async function unprotect(blob) {
  if (blob.startsWith('plain:')) return Buffer.from(blob.slice(6), 'base64').toString('utf8');
  if (blob.startsWith('dpapi:')) {
    const b64 = await runPowerShell(UNPROTECT, blob.slice(6));
    return Buffer.from(b64, 'base64').toString('utf8');
  }
  throw new Error('Unbekanntes Format der gespeicherten Zugangsdaten');
}

export async function setSecret(name, value) {
  const data = readFile();
  if (value === null || value === undefined || value === '') {
    delete data.entries[name];
    cache.delete(name);
  } else {
    data.entries[name] = { blob: await protect(String(value)), savedAt: new Date().toISOString() };
    cache.set(name, String(value));
  }
  await writeFile(data);
}

export async function getSecret(name) {
  if (cache.has(name)) return cache.get(name);
  const entry = readFile().entries[name];
  if (!entry) return null;
  const value = await unprotect(entry.blob);
  cache.set(name, value);
  return value;
}

export function hasSecret(name) {
  return cache.has(name) || Boolean(readFile().entries[name]);
}

export function secretInfo(name) {
  const entry = readFile().entries[name];
  return entry ? { set: true, savedAt: entry.savedAt } : { set: false };
}

/** Für Sicherungen: Zugangsdaten werden bewusst NICHT exportiert. */
export const SECRETS_FILE = FILE;
