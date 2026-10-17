import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { DIRS, insideDir } from '../paths.js';
import { flushStore, openStore } from '../store.js';
import { UserError } from '../util.js';

/**
 * Vollständige Datensicherung als ZIP: Datenbank (Entwürfe, Vorlagen, Designs-Metadaten, Verlauf),
 * Designdateien, Website-Uploads und die Sicherungen von Website-Änderungen.
 * Zugangsdaten (verschlüsselt) und Zwischenspeicher werden bewusst NICHT exportiert.
 */
const INCLUDE = [
  { dir: DIRS.db, zip: 'db' },
  { dir: DIRS.designs, zip: 'Designs' },
  { dir: DIRS.uploads, zip: 'Website-Uploads' },
  { dir: DIRS.themeBackups, zip: 'Sicherungen/Website-Aenderungen' },
];

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

export async function exportBackup({ targetDir = DIRS.exports, prefix = 'APOLOGEA-Studio-Sicherung' } = {}) {
  await flushStore();
  const zip = new AdmZip();
  const counts = {};
  for (const { dir, zip: zdir } of INCLUDE) {
    if (!fs.existsSync(dir)) continue;
    let n = 0;
    walk(dir, (file) => {
      if (file.endsWith('.tmp')) return;
      const rel = path.relative(dir, file).split(path.sep).join('/');
      zip.addFile(`${zdir}/${rel}`, fs.readFileSync(file));
      n++;
    });
    counts[zdir] = n;
  }
  zip.addFile('manifest.json', Buffer.from(JSON.stringify({ app: 'APOLOGEA Studio', format: 1, createdAt: new Date().toISOString(), counts }, null, 1)));
  fs.mkdirSync(targetDir, { recursive: true });
  const file = path.join(targetDir, `${prefix}_${stamp()}.zip`);
  zip.writeZip(file);
  return { file, size: fs.statSync(file).size, counts };
}

function walk(dir, fn) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, fn);
    else if (e.isFile()) fn(p);
  }
}

/** Liest eine Sicherung ein. Vorher wird der aktuelle Stand automatisch gesichert. */
export async function importBackup(zipPath) {
  let zip;
  try { zip = new AdmZip(zipPath); } catch { throw new UserError('Die Datei ist keine gültige ZIP-Sicherung.'); }
  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) throw new UserError('Keine APOLOGEA-Studio-Sicherung (manifest.json fehlt).');
  const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
  if (manifest.app !== 'APOLOGEA Studio') throw new UserError('Keine APOLOGEA-Studio-Sicherung.');
  // Plausibilitätsprüfung aller Einträge vor dem Schreiben (Schutz vor ../-Pfaden)
  const plan = [];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || entry.entryName === 'manifest.json') continue;
    const target = INCLUDE.find((i) => entry.entryName.startsWith(i.zip + '/'));
    if (!target) continue;
    const rel = entry.entryName.slice(target.zip.length + 1);
    const dest = path.join(target.dir, ...rel.split('/'));
    if (!insideDir(target.dir, dest)) throw new UserError('Die Sicherung enthält ungültige Pfade und wird nicht eingelesen.');
    if (target.zip === 'db') { try { JSON.parse(entry.getData().toString('utf8')); } catch { if (!rel.endsWith('.bak')) throw new UserError(`Beschädigte Datei in der Sicherung: ${entry.entryName}`); } }
    plan.push({ entry, dest });
  }
  const before = await exportBackup({ targetDir: DIRS.backups, prefix: 'vor-Wiederherstellung' });
  // Datenbank vollständig ersetzen, Dateien ergänzen/überschreiben (nichts außerhalb des Datenordners).
  for (const f of fs.readdirSync(DIRS.db)) fs.rmSync(path.join(DIRS.db, f), { force: true });
  for (const { entry, dest } of plan) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, entry.getData());
  }
  openStore();
  return { restored: plan.length, manifest, safetyCopy: before.file };
}

/** Automatische Sicherung beim Start (eine pro Tag, die letzten 14 bleiben erhalten). */
export async function dailyAutoBackup() {
  const dir = path.join(DIRS.backups, 'automatisch');
  fs.mkdirSync(dir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.zip')).sort();
  if (files.some((f) => f.includes(today))) return null;
  const r = await exportBackup({ targetDir: dir, prefix: `Auto_${today}` });
  const all = fs.readdirSync(dir).filter((f) => f.startsWith('Auto_') && f.endsWith('.zip')).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 14))) fs.rmSync(path.join(dir, old), { force: true });
  return r;
}

export function listBackups() {
  const out = [];
  for (const dir of [DIRS.exports, DIRS.backups, path.join(DIRS.backups, 'automatisch')]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.zip')) {
      const p = path.join(dir, f);
      out.push({ name: f, path: p, size: fs.statSync(p).size, at: fs.statSync(p).mtime.toISOString() });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
