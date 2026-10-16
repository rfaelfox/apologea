// Baut das Windows-Installationspaket: dist/APOLOGEA-Studio-Installer.zip
//   node tools/build-package.mjs            → mit Node.js-Laufzeit (offline installierbar)
//   node tools/build-package.mjs --no-node  → ohne Laufzeit (Installer lädt sie von nodejs.org, Prüfsumme wird kontrolliert)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PKG = path.join(DIST, 'APOLOGEA Studio Installer');
const NODE_VERSION = 'v22.23.3';
const NODE_SHA256 = '2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71';
const withNode = !process.argv.includes('--no-node');

const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
const BOM = '﻿';

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(PKG, 'install'), { recursive: true });

// App-Dateien
const APP = path.join(PKG, 'app');
for (const item of ['package.json', 'package-lock.json', 'launcher.js', 'APOLOGEA Studio.vbs', 'src', 'public', 'fixtures', 'node_modules']) {
  const src = path.join(ROOT, item);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(APP, item), { recursive: true });
}
fs.writeFileSync(path.join(APP, 'APOLOGEA Studio.vbs'), crlf(fs.readFileSync(path.join(ROOT, 'APOLOGEA Studio.vbs'), 'utf8')));
// Entwicklungs-Testdateien nicht ausliefern
fs.rmSync(path.join(APP, 'public', 'icon-256.png'), { force: true });

// Installer-Skripte: UTF-8 mit BOM + CRLF (Windows PowerShell 5.1)
for (const f of ['install.ps1', 'uninstall.ps1']) {
  fs.writeFileSync(path.join(PKG, 'install', f), BOM + crlf(fs.readFileSync(path.join(ROOT, 'install', f), 'utf8')));
}
fs.writeFileSync(path.join(PKG, 'Installieren.cmd'), crlf(fs.readFileSync(path.join(ROOT, 'install', 'Installieren.cmd'), 'utf8')));
fs.writeFileSync(path.join(PKG, 'LIESMICH.txt'), BOM + crlf(fs.readFileSync(path.join(ROOT, 'install', 'LIESMICH.txt'), 'utf8')));

if (withNode) {
  const zipName = `node-${NODE_VERSION}-win-x64.zip`;
  const cache = path.join(ROOT, '.cache');
  fs.mkdirSync(cache, { recursive: true });
  const zipPath = path.join(cache, zipName);
  if (!fs.existsSync(zipPath)) {
    console.log('Lade', zipName);
    execFileSync('curl', ['-sSfL', '-o', zipPath, `https://nodejs.org/dist/${NODE_VERSION}/${zipName}`], { stdio: 'inherit' });
  }
  const hash = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
  if (hash !== NODE_SHA256) throw new Error('Prüfsumme der Node.js-Datei stimmt nicht: ' + hash);
  const nodeExe = new AdmZip(zipPath).getEntry(`node-${NODE_VERSION}-win-x64/node.exe`).getData();
  fs.mkdirSync(path.join(PKG, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(PKG, 'runtime', 'node.exe'), nodeExe);
  fs.writeFileSync(path.join(PKG, 'runtime', 'HERKUNFT.txt'), crlf(`node.exe aus ${zipName} (https://nodejs.org/dist/${NODE_VERSION}/), SHA-256 der ZIP-Datei: ${NODE_SHA256}\nLizenz: MIT (https://github.com/nodejs/node/blob/main/LICENSE)\n`));
}

const out = path.join(DIST, 'APOLOGEA-Studio-Installer.zip');
const zip = new AdmZip();
zip.addLocalFolder(PKG, 'APOLOGEA Studio Installer');
zip.writeZip(out);
console.log(JSON.stringify({ out, mb: (fs.statSync(out).size / 1024 / 1024).toFixed(1), withNode }));
