import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PUBLIC_DIR = path.join(APP_DIR, 'public');
export const IS_WINDOWS = process.platform === 'win32';

/**
 * Datenordner:
 * 1. Umgebungsvariable APOLOGEA_DATA_DIR (Tests)
 * 2. install.json neben der Anwendung (vom Installer mit dem echten Dokumente-Pfad geschrieben,
 *    inkl. OneDrive-Umleitung)
 * 3. <Benutzerordner>/Documents/APOLOGEA Studio
 */
function resolveDataDir() {
  if (process.env.APOLOGEA_DATA_DIR) return path.resolve(process.env.APOLOGEA_DATA_DIR);
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'install.json'), 'utf8'));
    if (cfg.dataDir) return cfg.dataDir;
  } catch { /* keine Installationsdatei – Entwicklungsmodus */ }
  return path.join(os.homedir(), 'Documents', 'APOLOGEA Studio');
}

export const DATA_DIR = resolveDataDir();

/** Sichtbare Ordner für die Nutzerin bzw. den Nutzer. */
export const DIRS = {
  data: DATA_DIR,
  designs: path.join(DATA_DIR, 'Designs'),
  uploads: path.join(DATA_DIR, 'Website-Uploads'),
  exports: path.join(DATA_DIR, 'Exporte'),
  backups: path.join(DATA_DIR, 'Sicherungen'),
  themeBackups: path.join(DATA_DIR, 'Sicherungen', 'Website-Aenderungen'),
  internal: path.join(DATA_DIR, '.studio'),
  db: path.join(DATA_DIR, '.studio', 'db'),
  cache: path.join(DATA_DIR, '.studio', 'cache'),
  logs: path.join(DATA_DIR, '.studio', 'logs'),
  tmp: path.join(DATA_DIR, '.studio', 'tmp'),
};

export function ensureDirs() {
  for (const dir of Object.values(DIRS)) fs.mkdirSync(dir, { recursive: true });
}

/** Prüft, dass ein Pfad innerhalb eines erlaubten Ordners liegt (Schutz vor ../-Tricks). */
export function insideDir(base, target) {
  const rel = path.relative(path.resolve(base), path.resolve(target));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}
