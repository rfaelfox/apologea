import { h, clear, get, post, fmtDate, showError, toast, busy, confirmDialog } from '../core.js';

// Programm-Aktualisierung: Suchen kostet nichts (nur eine Abfrage bei GitHub), aktualisiert wird erst nach Klick.

let cached = null;

export async function checkUpdate({ force = false } = {}) {
  if (!force && cached) return cached;
  cached = await get('/api/update/check');
  return cached;
}

async function waitForRestart(statusEl) {
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    clear(statusEl, `Programm startet neu … (${i + 1} s)`);
    try {
      const r = await fetch('/api/ping', { cache: 'no-store' });
      if (r.ok && i >= 2) { location.reload(); return; }
    } catch { /* noch nicht wieder da */ }
  }
  clear(statusEl, 'Der Neustart dauert ungewöhnlich lange. Bitte das Fenster schließen und APOLOGEA Studio über das Desktop-Symbol neu öffnen.');
}

export async function runUpdate(info, statusEl) {
  const ok = await confirmDialog({
    title: 'Programm jetzt aktualisieren?',
    text: [
      `Neue Fassung: ${info.newVersion} (Stand ${fmtDate(info.commitDate)}).`,
      'Es werden nur Programmdateien ersetzt. Deine Entwürfe, Designs, Einstellungen und Zugangsdaten bleiben unverändert.',
      'Die bisherige Fassung wird vorher gesichert. Das Programm startet danach kurz neu.',
    ],
    confirmLabel: 'Jetzt aktualisieren',
  });
  if (!ok) return;
  clear(statusEl, 'Dateien werden geladen und geprüft …');
  try {
    const r = await post('/api/update/apply', { sha: info.sha });
    toast(`Aktualisiert auf ${r.version}. Programm startet neu …`, 'ok', 8000);
    await waitForRestart(statusEl);
  } catch (err) { clear(statusEl); showError(err); }
}

function describe(info, statusEl) {
  if (!info.available) return h('div.inline-msg.ok', `Du hast die neueste Fassung (${info.currentVersion}).`);
  if (info.needsInstaller) {
    return h('div.inline-msg.warn', info.noLocalManifest
      ? 'Diese Programmversion kann sich noch nicht selbst aktualisieren. Bitte einmal das neue Installationspaket installieren – danach geht es hier mit einem Klick.'
      : `Neue Fassung ${info.newVersion} verfügbar. Sie braucht neue Programmbibliotheken – bitte einmal das neue Installationspaket installieren.`);
  }
  const btn = h('button', { type: 'button' }, 'Jetzt aktualisieren');
  btn.addEventListener('click', () => busy(btn, () => runUpdate(info, statusEl)));
  return h('div.stack',
    h('div.inline-msg.info', `Neue Fassung verfügbar: ${info.newVersion} (Stand ${fmtDate(info.commitDate)}). ${info.changedFiles} Datei(en) ändern sich.`, info.commitMessage ? h('div.muted', info.commitMessage) : null),
    h('div.row', btn));
}

/** Kasten für die Einstellungen. */
export function updateBox(currentVersion) {
  const result = h('div');
  const statusEl = h('div.muted');
  const btn = h('button.small', { type: 'button' }, 'Nach Aktualisierung suchen');
  const run = async (force) => {
    try {
      const info = await checkUpdate({ force });
      clear(result, describe(info, statusEl), h('small.muted', `Geprüft: ${fmtDate(info.checkedAt)}`));
    } catch (err) { clear(result, h('div.inline-msg.error', err.message)); }
  };
  btn.addEventListener('click', () => busy(btn, () => run(true)));
  run(false);
  return h('div.frame.stack',
    h('h3', 'Programm-Aktualisierung'),
    h('p.muted', `Installierte Fassung: ${currentVersion}. Verbesserungen werden direkt geladen – ohne neues Installationspaket. Gesucht wird bei GitHub (kostenlos); aktualisiert wird nur nach deinem Klick.`),
    h('div.row', btn), result, statusEl);
}

/** Hinweisleiste auf der Startseite, nur wenn eine Aktualisierung bereitsteht. */
export async function updateBanner(box) {
  try {
    const info = await checkUpdate();
    if (!info.available) return clear(box);
    const statusEl = h('span.muted');
    const btn = h('button.small', { type: 'button' }, info.needsInstaller ? 'Details' : 'Jetzt aktualisieren');
    btn.addEventListener('click', () => {
      if (info.needsInstaller) location.hash = '#/einstellungen';
      else busy(btn, () => runUpdate(info, statusEl));
    });
    clear(box, h('div.inline-msg.info', { style: { marginBottom: '16px' } }, h('div.row', { style: { alignItems: 'center', justifyContent: 'space-between' } },
      h('span', `Neue Programmfassung ${info.newVersion} verfügbar.`), h('span.row', statusEl, btn))));
  } catch { clear(box); /* ohne Internet einfach keinen Hinweis zeigen */ }
}
