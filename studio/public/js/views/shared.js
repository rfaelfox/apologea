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

/**
 * Bilder an einen Auftrag anhängen: Schaltfläche, Ziehen & Ablegen und Einfügen aus der Zwischenablage (Strg+V).
 * Die Dateien bleiben im Browser, bis der Auftrag abgeschickt wird (files()).
 */
export function imageAttachments({ label = 'Bilder anhängen', hint = '' } = {}) {
  let list = [];
  const thumbs = h('div.att-thumbs');
  const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml', multiple: true, style: { display: 'none' } });
  const add = (files) => {
    for (const f of files) if (/^image\//.test(f.type) && !list.some((x) => x.name === f.name && x.size === f.size)) list.push(f);
    draw();
  };
  const draw = () => {
    thumbs.replaceChildren(...list.map((f, n) => {
      const url = URL.createObjectURL(f);
      return h('div.att-thumb', { title: f.name },
        h('img', { src: url, alt: f.name, onload: () => URL.revokeObjectURL(url) }),
        h('span.att-no', `Bild ${n + 1}`),
        h('button.att-x', { type: 'button', title: 'Entfernen', onclick: () => { list.splice(n, 1); draw(); } }, '×'));
    }));
  };
  input.addEventListener('change', () => { add([...input.files]); input.value = ''; });
  const el = h('div.att-box', h('div.row', h('button.small', { type: 'button', onclick: () => input.click() }, label), h('small.muted', hint || 'oder Bilder hierher ziehen bzw. mit Strg+V einfügen. Im Text kannst du sie mit „Bild 1“, „Bild 2“ … ansprechen.'), input), thumbs);
  const bindDrop = (target) => {
    target.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) { e.preventDefault(); target.classList.add('drop-on'); } });
    target.addEventListener('dragleave', () => target.classList.remove('drop-on'));
    target.addEventListener('drop', (e) => { e.preventDefault(); target.classList.remove('drop-on'); add([...(e.dataTransfer?.files || [])]); });
  };
  const bindPaste = (target) => target.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type));
    if (files.length) { e.preventDefault(); add(files.map((f, n) => (f.name && f.name !== 'image.png' ? f : new File([f], `eingefuegt-${Date.now()}-${n + 1}.png`, { type: f.type })))); }
  });
  return { el, files: () => [...list], reset: () => { list = []; draw(); }, bindDrop, bindPaste };
}
