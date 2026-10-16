import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { IS_WINDOWS } from './paths.js';

/** Startet ein Programm und meldet, ob es ohne Fehler beendet bzw. gestartet wurde. */
function tryRun(cmd, args, { env, waitExit = true, timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true, env: env || process.env });
    } catch { return resolve(false); }
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    child.on('error', () => finish(false));
    if (waitExit) child.on('exit', (code) => finish(code === 0));
    else setTimeout(() => finish(true), 300);
    setTimeout(() => finish(true), timeoutMs); // läuft noch → gilt als gestartet
    child.unref();
  });
}

/**
 * Öffnet eine http(s)-Adresse im Standardbrowser. Nur http/https wird akzeptiert.
 * Windows: mehrere Wege nacheinander (PowerShell Start-Process → rundll32 → explorer), weil je nach
 * Systemeinstellung einzelne Wege still scheitern können. Ergebnis: { opened, via }.
 */
export async function openExternal(url) {
  if (!/^https?:\/\//i.test(url)) return { opened: false, via: null };
  if (IS_WINDOWS) {
    const root = process.env.SystemRoot || 'C:\\Windows';
    const ps = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    // Adresse über eine Umgebungsvariable übergeben – keine Probleme mit Sonderzeichen in der Befehlszeile
    if (await tryRun(fs.existsSync(ps) ? ps : 'powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', 'Start-Process -FilePath $env:STUDIO_OPEN_URL'], { env: { ...process.env, STUDIO_OPEN_URL: url } })) return { opened: true, via: 'powershell' };
    if (await tryRun(path.join(root, 'System32', 'rundll32.exe'), ['url.dll,FileProtocolHandler', url])) return { opened: true, via: 'rundll32' };
    if (await tryRun(path.join(root, 'explorer.exe'), [url], { waitExit: false })) return { opened: true, via: 'explorer' };
    const edge = findEdge();
    if (edge && await tryRun(edge, [url], { waitExit: false })) return { opened: true, via: 'edge' };
    return { opened: false, via: null };
  }
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
  return { opened: await tryRun(cmd, [url]), via: cmd };
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
