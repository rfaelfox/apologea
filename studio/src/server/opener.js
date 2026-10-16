import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { IS_WINDOWS } from './paths.js';

/** Öffnet eine http(s)-Adresse im Standardbrowser. Nur http/https wird akzeptiert. */
export function openExternal(url) {
  if (!/^https?:\/\//i.test(url)) return Promise.resolve(false);
  return new Promise((resolve) => {
    let child;
    if (IS_WINDOWS) child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore', windowsHide: true });
    else if (process.platform === 'darwin') child = spawn('open', [url], { detached: true, stdio: 'ignore' });
    else child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.unref();
    resolve(true);
  });
}

/** Öffnet eine Datei oder einen Ordner im Explorer (Datei wird markiert). */
export function revealInExplorer(target) {
  if (!fs.existsSync(target)) return false;
  let child;
  if (IS_WINDOWS) {
    const isDir = fs.statSync(target).isDirectory();
    child = spawn('explorer.exe', isDir ? [path.resolve(target)] : [`/select,${path.resolve(target)}`], { detached: true, stdio: 'ignore' });
  } else if (process.platform === 'darwin') child = spawn('open', ['-R', target], { detached: true, stdio: 'ignore' });
  else child = spawn('xdg-open', [path.dirname(target)], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
  return true;
}

/** Öffnet eine Datei mit dem zugeordneten Programm (z. B. Bildbetrachter). */
export function openFile(target) {
  if (!fs.existsSync(target)) return false;
  let child;
  if (IS_WINDOWS) child = spawn('explorer.exe', [path.resolve(target)], { detached: true, stdio: 'ignore' });
  else if (process.platform === 'darwin') child = spawn('open', [target], { detached: true, stdio: 'ignore' });
  else child = spawn('xdg-open', [target], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
  return true;
}

/** Sucht Microsoft Edge (für ein App-Fenster ohne Browserleisten). */
export function findEdge() {
  if (!IS_WINDOWS) return null;
  const bases = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  for (const b of bases) {
    const p = path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}
