import { h, clear, get, badge, fmtDate, fmtUsd, extLink } from '../core.js';

const TYPE = {
  'product.publish': 'Produkt veröffentlichen',
  'ai.description': 'Produkttext (Claude)',
  'website.propose': 'Änderungsvorschlag (Claude)',
  'website.preview': 'Vorschau-Theme',
  'website.apply': 'Website-Änderung übernehmen',
  'website.restore': 'Website wiederherstellen',
};

export async function renderHistory(main) {
  const jobs = await get('/api/jobs');
  const filter = h('select', h('option', { value: '' }, 'Alle Aufträge'), Object.entries(TYPE).map(([k, v]) => h('option', { value: k }, v)));
  const box = h('div');
  const draw = () => {
    const list = jobs.filter((j) => !filter.value || j.type === filter.value);
    clear(box, list.length ? list.map((j) => h('details.box',
      h('summary', h('span', { style: { flex: 1 } }, j.title, h('div.muted', `${TYPE[j.type] || j.type} · ${fmtDate(j.createdAt)}`)), badge(j.status, { simulated: j.simulated })),
      h('div.stack',
        j.error ? h('div.inline-msg.error', j.error) : null,
        j.result?.costUsd != null ? h('div.muted', `KI-Kosten: ${fmtUsd(j.result.costUsd)}`) : null,
        h('div.row', (j.result?.links || []).map((l) => extLink(l.label, l.url))),
        h('ol', j.steps.map((s) => h('li', h('span.muted', new Date(s.at).toLocaleTimeString('de-DE')), ' ', s.msg))),
        j.refType === 'product' ? h('a', { href: `#/produkte/${j.refId}` }, 'Zum Produktentwurf') : j.refType === 'website' ? h('a', { href: `#/website/${j.refId}` }, 'Zum Website-Entwurf') : null)))
      : h('div.empty', 'Noch keine Aufträge.'));
  };
  filter.addEventListener('change', draw);
  clear(main,
    h('div.page-head', h('div', h('div.eyebrow', 'Protokoll'), h('h1', 'Aufträge & Verlauf')), h('div.actions', filter)),
    h('p.muted', 'Jede ausführende Aktion wird hier mit Zeitpunkt, Schritten und Ergebnis festgehalten. „Erfolgreich“ erscheint erst, wenn die Plattform den Erfolg bestätigt hat.'),
    box);
  draw();
}
