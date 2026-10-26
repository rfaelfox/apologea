// Erzeugt update.json: Liste aller Programmdateien mit SHA-256-Prüfsumme.
// Das Studio vergleicht sie mit der Liste auf GitHub und lädt nur geänderte Dateien nach.
//   node tools/manifest.mjs   → schreibt update.json neu (vor jedem Commit ausführen; ein Test prüft das)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOP_FILES = ['launcher.js', 'package.json', 'package-lock.json'];
const DIRS = ['src', 'public', 'fixtures'];
const SKIP = new Set(['public/icon-256.png']);

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function buildManifest(root = ROOT) {
  const files = {};
  const add = (rel) => { if (!SKIP.has(rel)) files[rel] = sha(fs.readFileSync(path.join(root, rel))); };
  for (const f of TOP_FILES) add(f);
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r); else add(r);
    }
  };
  for (const d of DIRS) walk(d);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return {
    app: 'APOLOGEA Studio',
    version: pkg.version,
    // Ändern sich die Programmbibliotheken, reicht eine Aktualisierung nicht – dann ist das Installationspaket nötig.
    depsHash: sha(JSON.stringify(pkg.dependencies || {})),
    files,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const m = buildManifest();
  fs.writeFileSync(path.join(ROOT, 'update.json'), JSON.stringify(m, null, 1) + '\n');
  console.log(`update.json: Version ${m.version}, ${Object.keys(m.files).length} Dateien`);
}
