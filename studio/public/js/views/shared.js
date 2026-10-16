import { h, post, modal, fmtUsd, showError, userError } from '../core.js';

/**
 * Vor jedem KI-Aufruf: Schätzung holen. Bei der Anthropic API (kostenpflichtig) muss der Aufruf
 * ausdrücklich bestätigt werden. Rückgabe: { confirmPaid } oder null (abgebrochen).
 */
export async function confirmAiCall(estimateUrl, body = {}, what = 'diesen Auftrag') {
  let est;
  try { est = await post(estimateUrl, body); } catch (err) { showError(err); return null; }
  if (!est.paid) {
    if (est.engine === 'none') { showError(userError('Keine KI eingerichtet. Einstellungen → Claude.')); return null; }
    return { confirmPaid: false, engine: est.engine };
  }
  const ok = await modal({
    eyebrow: 'Kostenpflichtiger KI-Aufruf',
    title: 'Claude über die Anthropic API',
    body: h('div',
      h('p', `Für ${what} wird ${est.modelLabel} über deinen Anthropic-API-Schlüssel aufgerufen. Das wird nutzungsabhängig abgerechnet (nicht über dein Claude-Abo).`),
      h('dl.kv',
        h('dt', 'Eingabe'), h('dd', `${est.inputTokens.toLocaleString('de-DE')} Token (gezählt)`),
        h('dt', 'Ausgabe'), h('dd', `bis zu ${est.maxOutputTokens.toLocaleString('de-DE')} Token`),
        h('dt', 'Geschätzte Kosten'), h('dd', h('strong', `ca. ${fmtUsd(est.typicalUsd)}`), ` · höchstens ${fmtUsd(est.maxUsd)}`),
        h('dt', 'Preise'), h('dd', `$${est.pricePerMTok.in} / $${est.pricePerMTok.out} je 1 Mio. Token (Eingabe/Ausgabe)`)),
      h('p.hint', 'Schätzung auf Basis der Anthropic-Preisliste (Stand Oktober 2026). Die tatsächlichen Kosten werden nach dem Aufruf im Verlauf angezeigt.')),
    actions: [{ label: 'Abbrechen', value: false }, { label: 'Kostenpflichtig ausführen', value: true, primary: true }],
  });
  return ok ? { confirmPaid: true, engine: 'api' } : null;
}

export function issuesList(issues) {
  if (!issues?.length) return h('div.inline-msg.ok', 'Keine Probleme gefunden.');
  return h('div', issues.map((i) => h(`div.inline-msg.${i.level === 'error' ? 'error' : i.level === 'warn' ? 'warn' : 'info'}`, i.text)));
}

export function fileNotes(notes) {
  return h('div', (notes || []).map((n) => h(`div.inline-msg.${n.level === 'error' ? 'error' : n.level === 'warn' ? 'warn' : 'ok'}`, n.text)));
}

/** Unterschiede zeilenweise darstellen; lange unveränderte Blöcke werden eingeklappt. */
export function renderDiff(diff) {
  const box = h('div.diff');
  for (const part of diff || []) {
    const lines = part.v.replace(/\n$/, '').split('\n');
    if (part.t === '=') {
      if (lines.length > 8) {
        lines.slice(0, 3).forEach((l) => box.append(h('div.l.ctx', l || ' ')));
        box.append(h('div.gap', `… ${lines.length - 6} unveränderte Zeilen …`));
        lines.slice(-3).forEach((l) => box.append(h('div.l.ctx', l || ' ')));
      } else lines.forEach((l) => box.append(h('div.l.ctx', l || ' ')));
    } else {
      lines.forEach((l) => box.append(h(`div.l.${part.t === '+' ? 'add' : 'del'}`, (part.t === '+' ? '+ ' : '− ') + l)));
    }
  }
  return box;
}

/** HTML-Vorschau ohne Skripte (abgeschottetes iframe). */
export function htmlPreview(html) {
  const f = h('iframe.html-preview', { sandbox: '', title: 'Vorschau' });
  f.srcdoc = `<!doctype html><meta charset="utf-8"><style>body{font:15px/1.6 Georgia,serif;color:#222;padding:16px;max-width:760px}</style>${html || ''}`;
  return f;
}
