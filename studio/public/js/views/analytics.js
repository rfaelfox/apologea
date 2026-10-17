import { h, clear, get, post, del, fmtDate, showError, toast, busy, confirmDialog } from '../core.js';
import { setCleanup } from '../app.js';
import { lineChart, columnChart, barList, SERIES } from './charts.js';
import { viewSetup } from './analyticsSetup.js';

/**
 * Analytics & Business Intelligence – Bereiche:
 * Übersicht · Live View · Verkäufe & Umsatz · Kunden & Besucher · Produktperformance · Gewinn & POD-Kosten · Berichte
 * Alle Zahlen kommen aus dem Programm-Dienst (Shopify-Bestellungen, ShopifyQL, Live-View-Dienst). Nicht verfügbare
 * Werte werden als solche angezeigt – nie geschätzt oder erfunden.
 */

const TABS = [
  ['uebersicht', 'Übersicht'], ['live', 'Live View'], ['umsatz', 'Verkäufe & Umsatz'], ['kunden', 'Kunden & Besucher'],
  ['produkte', 'Produktperformance'], ['gewinn', 'Gewinn & POD-Kosten'], ['berichte', 'Berichte'], ['einrichtung', 'Einrichtung'],
];
const PRESETS = [['today', 'Heute'], ['yesterday', 'Gestern'], ['7d', '7 Tage'], ['30d', '30 Tage'], ['90d', '90 Tage'], ['ytd', 'Dieses Jahr'], ['custom', 'Zeitraum …']];

// ------------------------------------------------------------------ Formatierung
let CUR = 'EUR';
const money = (v, short) => (v === null || v === undefined ? '–' : new Intl.NumberFormat('de-DE', { style: 'currency', currency: CUR, maximumFractionDigits: short && Math.abs(v) >= 1000 ? 0 : 2, notation: short && Math.abs(v) >= 10000 ? 'compact' : 'standard' }).format(v));
const num = (v, short) => (v === null || v === undefined ? '–' : new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1, notation: short && Math.abs(v) >= 10000 ? 'compact' : 'standard' }).format(v));
const pct = (v, d = 1) => (v === null || v === undefined ? '–' : `${(v * 100).toFixed(d).replace('.', ',')} %`);

function loadPeriod() {
  try { return JSON.parse(localStorage.getItem('apologea.analytics.period')) || { preset: '30d' }; } catch { return { preset: '30d' }; }
}
function savePeriod(p) { try { localStorage.setItem('apologea.analytics.period', JSON.stringify(p)); } catch { /* ohne Speicher */ } }
const qs = (p, extra = {}) => new URLSearchParams(Object.entries({ preset: p.preset, ...(p.preset === 'custom' ? { from: p.from, to: p.to } : {}), ...extra }).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();

// ------------------------------------------------------------------ Bausteine

function changeBadge(change, { inverse = false } = {}) {
  if (change === null || change === undefined) return h('span.chg.flat', '–');
  const up = change > 0.0005; const down = change < -0.0005;
  const good = inverse ? down : up;
  const bad = inverse ? up : down;
  return h(`span.chg${good ? '.good' : bad ? '.bad' : '.flat'}`, { title: 'Veränderung gegenüber der Vorperiode' }, up ? '▲ ' : down ? '▼ ' : '● ', `${change > 0 ? '+' : ''}${(change * 100).toFixed(1).replace('.', ',')} %`);
}

function kpi({ label, value, previous, change, info, fmt = num, unavailable, preliminary, inverse, extra, live }) {
  return h(`div.kpi${unavailable ? '.na' : ''}`,
    h('div.kpi-label', label, live ? h('span.live-dot', { title: 'Live' }) : null),
    h('div.kpi-value', unavailable ? 'nicht verfügbar' : fmt(value)),
    unavailable ? h('div.kpi-note', unavailable)
      : change === undefined ? null : h('div.kpi-cmp', changeBadge(change, { inverse }), previous !== undefined ? h('span.muted', ` Vorperiode ${fmt(previous)}`) : null),
    preliminary ? h('div.kpi-note.warn', 'vorläufig – Kosten unvollständig') : null,
    extra || null,
    h('div.kpi-info', info));
}

function section(title, ...kids) { return h('section.a-section', h('h2', title), ...kids); }
function na(text) { return h('div.inline-msg.info', text); }

// ------------------------------------------------------------------ Seite

export async function renderAnalytics(main, sub = 'uebersicht', query = {}) {
  if (!TABS.some(([k]) => k === sub) && sub !== 'produkt') sub = 'uebersicht';
  let period = loadPeriod();
  const body = h('div.a-body', h('div.muted', 'Lädt …'));
  const statusLine = h('div.a-status');
  const setupBox = h('div');
  const filter = h('div.a-filter');
  const timers = [];
  setCleanup(() => timers.forEach(clearInterval));

  const tabs = h('nav.a-tabs', TABS.map(([k, l]) => h(`a${k === sub || (sub === 'produkt' && k === 'produkte') ? '.on' : ''}`, { href: `#/analytics/${k}` }, l)));
  clear(main,
    h('div.page-head', h('div', h('div.eyebrow', 'Business Intelligence'), h('h1', 'Analytics')), statusLine),
    tabs, setupBox, ['live', 'berichte', 'einrichtung'].includes(sub) ? null : filter, body);

  // ---- Status & Einrichtung
  let status = null;
  async function loadStatus() {
    try { status = await get('/api/analytics/status'); } catch (err) { status = { permissions: { adminApp: false, error: err.message } }; }
    const s = status.sync;
    const syncBtn = h('button.small', { type: 'button' }, 'Jetzt aktualisieren');
    syncBtn.addEventListener('click', () => busy(syncBtn, async () => {
      try { const r = await post('/api/analytics/sync', {}); toast(r.firstRun ? `${r.total} Bestellungen übernommen.` : `Aktualisiert: ${r.added} neu, ${r.updated} geändert.`, 'ok'); await loadStatus(); await draw(); } catch (err) { showError(err); }
    }));
    clear(statusLine,
      s ? h('small', { class: s.ok ? 'muted' : 'err' }, s.ok ? `Stand: ${fmtDate(s.lastSyncAt)} · ${s.orders} Bestellungen` : `Letzte Synchronisierung fehlgeschlagen: ${s.error}`) : h('small.muted', 'Noch nicht synchronisiert'),
      status.permissions.adminApp ? syncBtn : null,
      h('a.btn.small.ghost', { href: '#/einstellungen/analytics' }, 'Einstellungen'));
    clear(setupBox, sub === 'einrichtung' ? null : setupHint(status));
  }

  // ---- Zeitfilter
  function drawFilter() {
    const from = h('input', { type: 'date', value: period.from || '' });
    const to = h('input', { type: 'date', value: period.to || '' });
    clear(filter,
      h('div.seg', PRESETS.map(([k, l]) => h(`button${period.preset === k ? '.on' : ''}`, { type: 'button', onclick: () => { period = k === 'custom' ? { preset: 'custom', from: period.from || '', to: period.to || '' } : { preset: k }; savePeriod(period); drawFilter(); if (k !== 'custom') draw(); } }, l))),
      period.preset === 'custom' ? h('span.row', from, h('span.muted', 'bis'), to, h('button.small.primary', { type: 'button', onclick: () => { if (!from.value || !to.value) return; period = { preset: 'custom', from: from.value, to: to.value }; savePeriod(period); draw(); } }, 'Anwenden')) : null,
      h('small.muted.a-cmp-note', 'Vergleich: gleich langer Zeitraum unmittelbar davor'));
  }

  const views = { uebersicht: viewOverview, live: viewLive, umsatz: viewSales, kunden: viewCustomers, produkte: viewProducts, produkt: viewProduct, gewinn: viewProfit, berichte: viewReports, einrichtung: viewSetup };
  async function draw() {
    clear(body, h('div.a-loading', h('span.spinner'), 'Daten werden geladen …'));
    try { await views[sub](body, period, { query, timers, redraw: draw }); } catch (err) {
      clear(body, h('div.inline-msg.error', err.message));
    }
  }

  drawFilter();
  await loadStatus();
  await draw();
}

function setupHint(status) {
  const p = status.permissions || {};
  const shopReady = p.adminApp && !p.missing?.length;
  if (shopReady && status.collector) return null;
  return h('div.frame.a-setup.a-setup-slim',
    h('div', h('h3', shopReady ? 'Live View noch nicht eingerichtet' : 'Analytics ist noch nicht vollständig eingerichtet'),
      h('p.muted', shopReady ? 'Alle Shopify-Zahlen laufen. Für „Besucher online“ fehlt noch der Live-Dienst.' : 'Der Assistent führt dich Schritt für Schritt durch – mit Knöpfen, die genau die richtige Seite öffnen.')),
    h('a.btn.primary', { href: '#/analytics/einrichtung' }, 'Einrichtung öffnen'));
}

// ------------------------------------------------------------------ Übersicht

async function viewOverview(body, period) {
  const [o, ins] = await Promise.all([get(`/api/analytics/overview?${qs(period)}`), get(`/api/analytics/insights?${qs(period)}`).catch(() => ({ insights: [] }))]);
  CUR = o.shop.currency || 'EUR';
  const k = o.kpis;
  const growth = k.total.change;
  const g = o.goal;
  clear(body,
    h('div.a-period', `${o.period.label}: ${new Date(o.period.from).toLocaleDateString('de-DE')} – ${new Date(o.period.to).toLocaleDateString('de-DE')}`, h('small.muted', ` · Zeitzone ${o.period.tz}${o.shop.fallback ? ' (Annahme – Shop nicht erreichbar)' : ''}`)),
    h('div.kpi-grid',
      kpi({ label: 'Gesamtumsatz', value: k.total.value, previous: k.total.previous, change: k.total.change, fmt: money, info: 'Nettoumsatz + Versand + Steuern. Rückerstattungen werden am Tag der Erstattung abgezogen.' }),
      kpi({ label: 'Nettoumsatz', value: k.net.value, previous: k.net.previous, change: k.net.change, fmt: money, info: 'Artikelumsatz ohne Steuern, abzüglich Rabatten und Rücksendungen.' }),
      kpi({ label: 'Bestellungen', value: k.orders.value, previous: k.orders.previous, change: k.orders.change, info: 'Abgeschlossene Bestellungen ohne Test- und nie bezahlte Bestellungen.' }),
      kpi({ label: 'Besucher online', value: k.online.value, unavailable: k.online.unavailable, live: true, info: `Aktive Besucher der letzten 5 Minuten (nur mit Einwilligung). ${k.online.at ? 'Stand ' + fmtDate(k.online.at) : ''}` }),
      kpi({ label: 'Sitzungen', value: k.sessions.value, previous: k.sessions.previous, change: k.sessions.change, unavailable: k.sessions.unavailable, info: 'Shop-Besuche laut Shopify-Berichten (ShopifyQL).' }),
      kpi({ label: 'Conversion-Rate', value: k.conversion.value, previous: k.conversion.previous, change: k.conversion.change, fmt: (v) => pct(v, 2), unavailable: k.conversion.unavailable, info: 'Anteil der Sitzungen mit Bestellung laut Shopify.' }),
      kpi({ label: 'Ø Bestellwert', value: k.aov.value, previous: k.aov.previous, change: k.aov.change, fmt: money, info: '(Bruttoumsatz − Rabatte) ÷ Bestellungen.' }),
      kpi({ label: 'Verkaufte Artikel', value: k.itemsNet.value, previous: k.itemsNet.previous, change: k.itemsNet.change, info: 'Verkaufte Stück abzüglich zurückerstatteter Stück.' }),
      kpi({ label: 'Retouren & Erstattungen', value: k.refunds.value, previous: k.refunds.previous, change: k.refunds.change, fmt: money, inverse: true, info: 'Summe der Rückerstattungen im Zeitraum (inkl. Steuer/Versand).' }),
      kpi({ label: 'Geschätzter Gewinn', value: k.profit.value, previous: k.profit.previous, change: k.profit.change, fmt: money, preliminary: k.profit.preliminary, info: 'Deckungsbeitrag − Werbung − sonstige Kosten. Details unter „Gewinn & POD-Kosten“.' }),
      kpi({ label: 'Umsatzveränderung', value: growth, fmt: (v) => (v === null || v === undefined ? '–' : `${v > 0 ? '+' : ''}${pct(v)}`), change: growth, info: 'Gesamtumsatz gegenüber dem gleich langen Zeitraum davor.' })),
    g && (g.goals?.daily || g.goals?.monthly) ? h('div.a-goals', g.goals.daily ? goalBar('Tagesziel', g.today, g.goals.daily) : null, g.goals.monthly ? goalBar('Monatsziel', g.month, g.goals.monthly) : null) : null,
    h('div.a-grid-2',
      section('Umsatz', lineChart({ title: 'Gesamtumsatz', granularity: o.charts.revenue.granularity, format: (v, ax) => money(v, ax), series: [
        { name: 'Zeitraum', color: SERIES.current, points: o.charts.revenue.current },
        { name: 'Vorperiode', color: SERIES.previous, dashed: true, points: o.charts.revenue.previous }] })),
      section('Bestellungen', columnChart({ name: 'Bestellungen', points: o.charts.orders.current, granularity: o.charts.orders.granularity, format: (v) => num(v) }))),
    section('Besucher (Sitzungen)', o.charts.sessions.unavailable ? na(`Nicht verfügbar: ${o.charts.sessions.unavailable}`) : lineChart({ title: 'Sitzungen', granularity: 'day', format: (v) => num(v, true), series: [{ name: 'Sitzungen', color: SERIES.current, points: o.charts.sessions.current }] })),
    section('Hinweise', insightList(ins.insights)),
    h('p.hint', 'Umsatzwerte berechnet aus deinen Shopify-Bestellungen; Sitzungen und Conversion aus den Shopify-Berichten. Durch unterschiedliche Zuordnungsregeln können kleine Abweichungen zum Shopify-Dashboard entstehen.'));
}

function goalBar(label, value, goal) {
  const r = Math.min(1, (value || 0) / goal);
  return h('div.goal', h('div.row.between', h('span', label), h('small', `${money(value)} von ${money(goal)} (${pct(value / goal, 0)})`)), h('div.goal-track', h('div.goal-fill', { style: { width: `${r * 100}%` } })));
}

function insightList(list) {
  if (!list?.length) return h('div.empty', 'Noch keine Hinweise – es fehlen Daten im Zeitraum.');
  return h('div.insights', list.map((i) => h(`div.insight.${i.level}`, h('div.ins-head', h('span.ins-tag', { prognose: 'Prognose', warnung: 'Achtung', positiv: 'Positiv', info: 'Info' }[i.level] || 'Info'), h('strong', i.title)), h('div', i.text), h('small.muted', `Grundlage: ${i.basis}`))));
}

// ------------------------------------------------------------------ Live View

async function viewLive(body, _period, { timers }) {
  const box = h('div');
  clear(body, box);
  let auto = true;
  const draw = async () => {
    let d;
    try { d = await get('/api/analytics/live'); } catch (err) { clear(box, h('div.inline-msg.error', err.message)); return; }
    const updated = h('div.live-stamp', h('span.live-dot'), `Zuletzt aktualisiert: ${new Date(d.updatedAt).toLocaleTimeString('de-DE')}`, h('small.muted', ' · automatisch alle 15 Sekunden · Aktivitätsfenster 5 Minuten'),
      h('label.check', h('input', { type: 'checkbox', checked: auto, onchange: (e) => { auto = e.target.checked; } }), h('span', 'automatisch')));
    const purchases = section('Käufe der letzten 60 Minuten', d.purchases.length ? h('div.table-wrap', h('table.list', h('tbody', d.purchases.map((p) => h('tr', h('td', p.name), h('td', p.titles.join(', ')), h('td.n', money(p.total)), h('td.muted', new Date(p.at).toLocaleTimeString('de-DE'))))))) : h('div.empty', 'Keine Käufe in der letzten Stunde.'), h('p.hint', 'Aus den synchronisierten Shopify-Bestellungen (echte Käufe).'));
    if (!d.available) {
      clear(box, updated,
        h('div.frame.a-setup', h('h3', 'Live-Besucherdaten noch nicht eingerichtet'), h('p', d.reason),
          h('p', 'Shopify stellt die eigene Live View nicht über eine Schnittstelle bereit. Für Besucher in Echtzeit braucht es einen kleinen Live-View-Dienst und ein Web Pixel in deinem Shop – datenschutzkonform, nur mit Einwilligung der Besucher. Anleitung: Einstellungen → Analytics.'),
          h('a.btn.small', { href: '#/einstellungen/analytics' }, 'Zur Einrichtung')),
        purchases);
      return;
    }
    clear(box, updated,
      h('div.kpi-grid.live',
        kpi({ label: 'Besucher gerade online', value: d.online, live: true, info: 'Unterschiedliche Besucher mit Aktivität in den letzten 5 Minuten.' }),
        kpi({ label: 'Aktive Warenkörbe', value: d.carts, info: 'Besucher, die in den letzten 5 Minuten etwas in den Warenkorb gelegt haben.' }),
        kpi({ label: 'Checkout erreicht', value: d.checkouts, info: 'Besucher, die in den letzten 5 Minuten den Checkout begonnen haben.' }),
        kpi({ label: 'Käufe (60 Min.)', value: d.purchases.length, info: 'Echte Bestellungen laut Shopify in der letzten Stunde.' })),
      section('Besucher im Verlauf (letzte 60 Minuten)', lineChart({ title: 'Besucher online', granularity: 'hour', area: true, format: (v) => num(v), series: [{ name: 'Besucher online', color: SERIES.current, points: d.series.map((p) => ({ key: `${p.t.slice(0, 10)} ${new Date(p.t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`, value: p.online })) }] })),
      h('div.a-grid-2',
        section('Gerade angesehene Produkte', barList({ items: d.products.map((p) => ({ label: p.title || p.id, value: p.viewers })), format: (v) => `${v} Besucher`, empty: 'Gerade schaut niemand ein Produkt an.' })),
        section('Länder', barList({ items: d.countries.map((c) => ({ label: countryName(c.code), value: c.count })), format: (v) => `${v}`, empty: 'Keine Länderangaben.' }), h('p.hint', 'Grob aus dem Netzwerk des Dienstes ermittelt; IP-Adressen werden nicht gespeichert.'))),
      purchases,
      h('p.hint', d.consentNote, ' Werte können deshalb niedriger sein als in der Shopify Live View, die nach eigenen Regeln misst.'));
  };
  await draw();
  timers.push(setInterval(() => { if (auto && document.visibilityState === 'visible') draw(); }, 15_000));
}

function countryName(code) {
  try { return new Intl.DisplayNames(['de'], { type: 'region' }).of(code) || code; } catch { return code; }
}

// ------------------------------------------------------------------ Verkäufe & Umsatz

async function viewSales(body, period, ctx) {
  let gran = ctx.query.g || '';
  const d = await get(`/api/analytics/sales?${qs(period, { granularity: gran })}`);
  CUR = d.shop.currency || 'EUR';
  const s = d.sums; const c = d.change;
  const granSeg = h('div.seg', [['', 'Automatisch'], ['day', 'Tage'], ['week', 'Wochen'], ['month', 'Monate']].map(([k, l]) => h(`button${gran === k ? '.on' : ''}`, { type: 'button', onclick: () => { ctx.query.g = k; ctx.redraw(); } }, l)));
  const row = (label, key, { sign = '', bold = false, inverse = false } = {}) => h(`tr${bold ? '.strong' : ''}`, h('td', sign + label), h('td.n', money(s[key])), h('td.n.muted', money(d.previous[key])), h('td.n', changeBadge(c[key]?.change, { inverse })));
  const history = h('div');
  clear(body,
    section('Umsatzentwicklung', h('div.row', granSeg), lineChart({ title: 'Umsatz', granularity: d.series.granularity, format: (v, ax) => money(v, ax), series: [{ name: 'Gesamtumsatz', color: SERIES.current, points: d.series.points.map((p) => ({ key: p.key, value: p.total })) }] })),
    h('div.a-grid-2',
      section('Zusammensetzung', h('div.table-wrap', h('table.list.fin', h('thead', h('tr', h('th', ''), h('th.n', 'Zeitraum'), h('th.n', 'Vorperiode'), h('th.n', 'Veränderung'))), h('tbody',
        row('Bruttoumsatz', 'gross'), row('Rabatte', 'discounts', { sign: '− ', inverse: true }), row('Rücksendungen', 'returns', { sign: '− ', inverse: true }), row('Nettoumsatz', 'net', { bold: true }),
        row('Versand', 'shipping', { sign: '+ ' }), row('Steuern', 'tax', { sign: '+ ' }), row('Gesamtumsatz', 'total', { bold: true }),
        h('tr', h('td', 'Bestellungen'), h('td.n', num(s.orders)), h('td.n.muted', num(d.previous.orders)), h('td.n', changeBadge(c.orders.change))),
        h('tr', h('td', 'Ø Warenkorbwert'), h('td.n', money(s.aov)), h('td.n.muted', money(d.previous.aov)), h('td.n', changeBadge(c.aov.change))),
        h('tr', h('td', 'Stornierte Bestellungen'), h('td.n', num(s.cancelled)), h('td.n.muted', num(d.previous.cancelled)), h('td.n', ''))))),
        h('p.hint', 'Steuern und Versand wie berechnet; bei Preisen inkl. MwSt. ist der Bruttoumsatz ohne Steuer angegeben. Alle Beträge in Shop-Währung.')),
      section('Umsatz nach Kategorie', barList({ items: d.categories.map((x) => ({ label: x.category, value: x.net, sub: `${x.units} Stück` })), format: money }))),
    h('div.a-grid-2',
      section('Top-Seller', barList({ items: d.top.map((p) => ({ label: p.title, value: p.net, sub: `${p.units} Stück`, image: p.image, onClick: p.productId ? () => { location.hash = `#/analytics/produkt?key=${encodeURIComponent(p.productId)}`; } : null })), format: money })),
      section('Schwächste Produkte', d.flop.length ? barList({ items: d.flop.map((p) => ({ label: p.title, value: p.net, sub: `${p.units} Stück`, image: p.image })), format: money, color: SERIES.previous }) : h('div.empty', 'Zu wenige Produkte für einen Vergleich.'))),
    section('Bestellungen nach Ländern', d.countries ? barList({ items: d.countries.map((x) => ({ label: countryName(x.country) || x.country, value: x.sales, sub: `${num(x.orders)} Bestellungen` })), format: money }) : na(`Nicht verfügbar: ${d.countriesReason}`), h('p.hint', 'Aus den Shopify-Berichten (nur zusammengefasst, keine Adressen).')),
    section('Bestellhistorie', history));
  orderHistory(history, period);
}

const STATUS_DE = {
  PAID: 'bezahlt', PENDING: 'ausstehend', AUTHORIZED: 'autorisiert', PARTIALLY_PAID: 'teilweise bezahlt', PARTIALLY_REFUNDED: 'teilweise erstattet', REFUNDED: 'erstattet', VOIDED: 'storniert', EXPIRED: 'abgelaufen',
  FULFILLED: 'versendet', UNFULFILLED: 'nicht versendet', PARTIALLY_FULFILLED: 'teilweise versendet', IN_PROGRESS: 'in Bearbeitung', ON_HOLD: 'zurückgehalten', SCHEDULED: 'geplant', RESTOCKED: 'zurück auf Lager', PENDING_FULFILLMENT: 'Versand ausstehend', OPEN: 'offen',
};

function orderHistory(box, period) {
  let page = 1; let q = ''; let st = ''; let sort = 'date-desc';
  const search = h('input', { type: 'search', placeholder: 'Bestellnummer, Produkt oder SKU …' });
  const status = h('select', [['', 'Alle (ohne Test)'], ['open', 'Nicht versendet'], ['refunded', 'Mit Erstattung'], ['cancelled', 'Storniert'], ['test', 'Testbestellungen']].map(([v, l]) => h('option', { value: v }, l)));
  const list = h('div');
  const load = async () => {
    let d;
    try { d = await get(`/api/analytics/orders?${qs(period, { q, status: st, sort, page })}`); } catch (err) { clear(list, h('div.inline-msg.error', err.message)); return; }
    const th = (label, key) => h('th', { class: 'sortable', onclick: () => { sort = sort === `${key}-desc` ? `${key}-asc` : `${key}-desc`; load(); } }, label, sort.startsWith(key) ? (sort.endsWith('asc') ? ' ▲' : ' ▼') : '');
    clear(list,
      d.orders.length ? h('div.table-wrap', h('table.list', h('thead', h('tr', h('th', 'Bestellung'), th('Datum', 'date'), h('th', 'Artikel'), th('Stück', 'items'), th('Summe', 'total'), h('th', 'Status'))),
        h('tbody', d.orders.map((o) => h('tr', h('td', o.name, o.test ? h('small.muted', ' Test') : null), h('td', fmtDate(o.processedAt)), h('td', h('small', o.lines.map((l) => `${l.quantity}× ${l.title}${l.variant ? ` (${l.variant})` : ''}`).join(', '))), h('td.n', num(o.items)), h('td.n', money(o.total), o.refunded ? h('div.small.err', `− ${money(o.refunded)} erstattet`) : null), h('td', h('small', [o.cancelled ? 'storniert' : '', STATUS_DE[o.financialStatus] || o.financialStatus, STATUS_DE[o.fulfillmentStatus] || o.fulfillmentStatus].filter(Boolean).join(' · ')))))))) : h('div.empty', 'Keine Bestellungen gefunden.'),
      d.pages > 1 ? h('div.row', h('button.small', { type: 'button', disabled: page <= 1, onclick: () => { page--; load(); } }, '‹ Zurück'), h('small.muted', `Seite ${page} von ${d.pages} · ${d.total} Bestellungen`), h('button.small', { type: 'button', disabled: page >= d.pages, onclick: () => { page++; load(); } }, 'Weiter ›')) : h('small.muted', `${d.total} Bestellungen`));
  };
  let t;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { q = search.value; page = 1; load(); }, 300); });
  status.addEventListener('change', () => { st = status.value; page = 1; load(); });
  clear(box, h('div.row', h('div', { style: { flex: '1 1 260px' } }, search), status), list);
  load();
}

// ------------------------------------------------------------------ Kunden & Besucher

async function viewCustomers(body, period) {
  const d = await get(`/api/analytics/customers?${qs(period)}`);
  CUR = d.shop.currency || 'EUR';
  const s = d.sessions; const c = d.customers;
  const totalOrders = c.newOrders + c.returningOrders + c.guestOrders;
  clear(body,
    h('div.kpi-grid',
      kpi({ label: 'Sitzungen', value: s.sessions, unavailable: s.available ? null : s.reason, info: 'Laut Shopify-Berichten (ShopifyQL).' }),
      kpi({ label: 'Besucher', value: s.visitors, unavailable: s.visitors === null ? (s.reason || 'Von Shopify für diesen Zeitraum nicht geliefert.') : null, info: 'Eindeutige Besucher laut Shopify.' }),
      kpi({ label: 'Conversion-Rate', value: s.conversionRate, fmt: (v) => pct(v, 2), unavailable: s.conversionRate === null ? (s.reason || 'Von Shopify nicht geliefert.') : null, info: 'Anteil der Sitzungen mit Bestellung.' }),
      kpi({ label: 'Kund:innen mit Bestellung', value: c.uniqueCustomers, info: 'Unterschiedliche Kundenkonten (pseudonymisiert) im Zeitraum.' }),
      kpi({ label: 'Bestellungen je Kund:in', value: c.ordersPerCustomer, fmt: (v) => (v === null ? '–' : v.toFixed(2).replace('.', ',')), info: 'Durchschnitt im Zeitraum.' })),
    section('Besucher im Verlauf', s.series ? lineChart({ title: 'Sitzungen', format: (v) => num(v, true), series: [{ name: 'Sitzungen', color: SERIES.current, points: s.series.map((p) => ({ key: p.day, value: p.sessions })) }] }) : na(`Nicht verfügbar: ${s.seriesReason || s.reason}`)),
    h('div.a-grid-2',
      section('Neu oder wiederkehrend', totalOrders ? barList({ items: [{ label: 'Erstbestellung', value: c.newOrders }, { label: 'Wiederkehrend', value: c.returningOrders }, { label: 'Gastbestellung', value: c.guestOrders }], format: (v) => `${v} (${pct(v / totalOrders, 0)})` }) : h('div.empty', 'Keine Bestellungen im Zeitraum.'), d.note ? h('p.hint', d.note) : null),
      section('Besuche nach Land', d.countries.sessions ? barList({ items: d.countries.sessions.map((x) => ({ label: countryName(x.country), value: x.sessions })), format: (v) => num(v) }) : na(`Nicht verfügbar: ${d.countries.sessionsReason}`))),
    h('div.a-grid-2',
      section('Geräte', d.traffic.devices ? barList({ items: d.traffic.devices.map((x) => ({ label: x.label, value: x.sessions })), format: (v) => num(v) }) : na(`Nicht verfügbar: ${d.traffic.devicesReason}`)),
      section('Herkunft der Besuche', d.traffic.sources ? barList({ items: d.traffic.sources.map((x) => ({ label: x.label, value: x.sessions })), format: (v) => num(v) }) : na(`Nicht verfügbar: ${d.traffic.sourcesReason}`))),
    h('p.hint', 'Datenschutz: Kund:innen werden nur als nicht rückführbares Pseudonym gezählt; Länder kommen zusammengefasst aus den Shopify-Berichten.'));
}

// ------------------------------------------------------------------ Produktperformance

async function viewProducts(body, period) {
  const d = await get(`/api/analytics/products?${qs(period)}`);
  CUR = d.shop.currency || 'EUR';
  const open = (p) => { location.hash = `#/analytics/produkt?key=${encodeURIComponent(p.productId || `titel:${p.title}`)}`; };
  clear(body,
    d.preliminary ? h('div.inline-msg.warn', 'Margen teilweise vorläufig – es fehlen: ', d.missing.slice(0, 4).join(', '), d.missing.length > 4 ? ' …' : '', '. ', h('a', { href: '#/analytics/gewinn' }, 'Kosten ergänzen')) : null,
    h('div.a-grid-2',
      section('Meistverkauft (Stück)', barList({ items: d.byUnits.map((p) => ({ label: p.title, value: p.units, image: p.image, onClick: () => open(p) })), format: (v) => `${num(v)} Stück` })),
      section('Umsatzstärkste Pieces', barList({ items: d.byRevenue.map((p) => ({ label: p.title, value: p.revenue, image: p.image, onClick: () => open(p) })), format: money }))),
    section('Alle Pieces', d.products.length ? h('div.table-wrap', h('table.list.prod', h('thead', h('tr', h('th', 'Piece'), h('th', 'Anbieter'), h('th.n', 'Preis'), h('th.n', 'Stück'), h('th.n', 'Umsatz'), h('th.n', 'Aufrufe'), h('th.n', 'Conversion'), h('th.n', 'Herstellkosten'), h('th.n', 'Deckungsbeitrag'), h('th.n', 'Marge'))),
      h('tbody', d.products.map((p) => {
        const tr = h('tr.click', h('td', h('div.prod-cell', p.image ? h('img', { src: p.image, alt: '' }) : h('span.prod-ph'), h('span', p.title))), h('td', p.provider || h('span.muted', '–')), h('td.n', money(p.price)), h('td.n', num(p.units)), h('td.n', money(p.revenue)), h('td.n', p.views === null ? h('span.muted', '–') : num(p.views)), h('td.n', p.conversion === null ? h('span.muted', '–') : pct(p.conversion)), h('td.n', p.preliminary ? h('span.warn', 'fehlt') : money(p.production)), h('td.n', money(p.contribution), p.preliminary ? h('small.warn', ' vorl.') : null), h('td.n', p.margin === null || p.preliminary ? h('span.muted', { title: 'Erst mit vollständigen Kosten aussagekräftig' }, '–') : pct(p.margin, 0)));
        tr.addEventListener('click', () => open(p));
        return tr;
      })))) : h('div.empty', 'Keine Verkäufe im Zeitraum.'),
      h('p.hint', d.viewsNote, ' Conversion = verkaufte Stück ÷ Aufrufe (nur wo Aufrufe bekannt sind).')));
}

async function viewProduct(body, period, { query }) {
  const key = query.key || '';
  const d = await get(`/api/analytics/product?${qs(period, { key })}`);
  CUR = d.shop.currency || 'EUR';
  const st = d.stats;
  const costInput = h('input', { type: 'number', step: '0.01', min: 0, value: d.manualCost?.unit ?? '', placeholder: 'z. B. 18,50' });
  const saveCost = h('button.small.primary', { type: 'button' }, 'Speichern');
  saveCost.addEventListener('click', () => busy(saveCost, async () => {
    try { await post('/api/analytics/product-cost', { productId: key, unit: costInput.value === '' ? null : Number(costInput.value) }); toast('Herstellkosten gespeichert.', 'ok'); await viewProduct(body, period, { query }); } catch (err) { showError(err); }
  }));
  clear(body,
    h('div.row', h('a.btn.small.ghost', { href: '#/analytics/produkte' }, '‹ Alle Pieces')),
    h('div.prod-head', d.product.image ? h('img', { src: d.product.image, alt: '' }) : null, h('div', h('h2', d.product.title), h('div.muted', [d.studioDraft ? `Anbieter: ${({ marketprint: 'MarketPrint', printify: 'Printify', printful: 'Printful' })[d.studioDraft.provider] || d.studioDraft.provider}` : (d.product.vendor ? `Anbieter laut Shopify: ${d.product.vendor}` : ''), d.product.price ? `Preis ${money(d.product.price)}` : ''].filter(Boolean).join(' · ')), d.studioDraft ? h('a', { href: `#/produkte/${d.studioDraft.id}` }, 'Entwurf im Studio öffnen') : null)),
    st ? h('div.kpi-grid',
      kpi({ label: 'Verkaufte Stück', value: st.units, info: 'Nach Abzug zurückerstatteter Stück.' }),
      kpi({ label: 'Erlös', value: st.revenue, fmt: money, info: 'Nach Rabatt, ohne Steuer.' }),
      kpi({ label: 'Herstellkosten', value: st.preliminary ? null : st.production, unavailable: st.preliminary ? 'Kosten fehlen – unten eintragen.' : null, fmt: money, info: st.costSource || '' }),
      kpi({ label: 'Deckungsbeitrag', value: st.contribution, fmt: money, preliminary: st.preliminary, info: 'Erlös − Erstattungen − Herstellung − Versand (anteilig) − Gebühren (anteilig).' }),
      kpi({ label: 'Marge', value: st.margin, fmt: (v) => pct(v, 0), info: 'Deckungsbeitrag ÷ Erlös.' })) : h('div.empty', 'Im Zeitraum nicht verkauft.'),
    section('Verkäufe im Verlauf', lineChart({ title: 'Umsatz', granularity: d.series.granularity, format: (v, ax) => money(v, ax), series: [{ name: 'Nettoumsatz', color: SERIES.current, points: d.series.points.map((p) => ({ key: p.key, value: p.net })) }] })),
    h('div.a-grid-2',
      section('Varianten', barList({ items: d.variants.map((v) => ({ label: v.variant, value: v.units, sub: money(v.net) })), format: (v) => `${v} Stück` })),
      section('Herstellkosten je Stück', h('p.muted', 'Trage ein, was dich ein Stück beim Druckdienstleister kostet (ohne Versand). Hat der Anbieter echte Bestellkosten geliefert, haben diese Vorrang.'), h('div.row', costInput, h('span.muted', CUR), saveCost))));
}

// ------------------------------------------------------------------ Gewinn & POD-Kosten

async function viewProfit(body, period, ctx) {
  const d = await get(`/api/analytics/profit?${qs(period)}`);
  CUR = d.shop.currency || 'EUR';
  const line = (label, v, { neg = false, strong = false } = {}) => h(`tr${strong ? '.strong' : ''}`, h('td', label), h('td.n', v === null || v === undefined ? '–' : (neg && v ? `− ${money(v)}` : money(v))));
  const costs = h('div');
  clear(body,
    d.preliminary ? h('div.inline-msg.warn', h('strong', 'Vorläufig: '), 'Es fehlen Kostenangaben – angezeigt wird ein vorläufiger Deckungsbeitrag. Fehlend: ', d.missing.join(', '), '.') : h('div.inline-msg.ok', 'Alle Kostenpositionen für den Zeitraum sind hinterlegt.'),
    h('div.a-grid-2',
      section('Vom Umsatz zum Gewinn', h('div.table-wrap', h('table.list.fin', h('tbody',
        line('Erlös (ohne Steuer, inkl. Versand vom Kunden)', d.revenue), line('Rückerstattungen', d.returns, { neg: true }), line('Herstellkosten (POD)', d.production, { neg: true }), line('Versand an Kunden (POD)', d.podShipping, { neg: true }), line('Zahlungsgebühren', d.fees, { neg: true }),
        line('Deckungsbeitrag', d.contribution, { strong: true }), line('Werbeausgaben', d.ads, { neg: true }), line('Sonstige Kosten', d.other, { neg: true }), line('Gewinn (vor Steuern)', d.profit, { strong: true })))),
        h('p.hint', 'Umsatz = was Kunden zahlen. Deckungsbeitrag = was nach den direkten Kosten je Bestellung übrig bleibt. Gewinn = Deckungsbeitrag abzüglich Werbung und sonstiger Kosten. Steuern auf den Gewinn sind nicht berücksichtigt.'),
        h('div.muted', h('small', 'Kostenquellen: ', d.sources.join(' · ') || '–'))),
      section('Kostenquellen der Druckdienstleister', podSources(d.pod), h('p.hint', 'MarketPrint stellt über seine Schnittstelle keine Bestellkosten bereit – dort gelten deine eingetragenen Herstellkosten bzw. der Katalog-Grundpreis (Schätzung ohne Aufschläge).'))),
    section('Deckungsbeitrag je Piece', d.products.length ? h('div.table-wrap', h('table.list.prod', h('thead', h('tr', h('th', 'Piece'), h('th', 'Anbieter'), h('th.n', 'Stück'), h('th.n', 'Erlös'), h('th.n', 'Herstellung'), h('th.n', 'Versand'), h('th.n', 'Gebühren'), h('th.n', 'Erstattungen'), h('th.n', 'Deckungsbeitrag'), h('th.n', 'Marge'))),
      h('tbody', d.products.map((p) => { const tr = h('tr.click', h('td', h('div.prod-cell', p.image ? h('img', { src: p.image, alt: '' }) : h('span.prod-ph'), h('span', p.title))), h('td', p.provider || '–'), h('td.n', num(p.units)), h('td.n', money(p.revenue)), h('td.n', p.preliminary ? h('span.warn', 'fehlt') : money(p.production)), h('td.n', money(p.podShipping)), h('td.n', money(p.fees)), h('td.n', money(p.returns)), h('td.n', money(p.contribution), p.preliminary ? h('small.warn', ' vorl.') : null), h('td.n', p.margin === null || p.preliminary ? h('span.muted', { title: 'Erst mit vollständigen Kosten aussagekräftig' }, '–') : pct(p.margin, 0))); tr.addEventListener('click', () => { location.hash = `#/analytics/produkt?key=${encodeURIComponent(p.productId || `titel:${p.title}`)}`; }); return tr; })))) : h('div.empty', 'Keine Verkäufe im Zeitraum.')),
    section('Werbeausgaben & sonstige Kosten', costs));
  manualCosts(costs, ctx);
}

function podSources(pod) {
  if (!pod) return h('div.empty', 'Noch nicht abgefragt.');
  const refresh = h('button.small', { type: 'button' }, 'Neu abfragen');
  refresh.addEventListener('click', () => busy(refresh, async () => { try { await post('/api/analytics/pod-costs/refresh'); toast('Bestellkosten der Anbieter aktualisiert.', 'ok'); location.reload(); } catch (err) { showError(err); } }));
  return h('div.stack', ['Printful', 'Printify', 'Gelato'].map((n) => {
    const s = pod.sources?.[n] || {};
    return h('div.row.between', h('span', n), h('small', { class: s.error ? 'err' : s.connected ? '' : 'muted' }, s.error ? `Fehler: ${s.error}` : s.connected ? `${s.count} Bestellungen mit Kosten` : (s.note || 'nicht verbunden')));
  }), h('div.row.between', h('span', 'MarketPrint'), h('small.muted', 'keine Bestellkosten über die Schnittstelle')), h('div.row', refresh, h('small.muted', `Stand: ${fmtDate(pod.at)}`)));
}

async function manualCosts(box, ctx) {
  const list = await get('/api/analytics/costs').catch(() => []);
  const date = h('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
  const amount = h('input', { type: 'number', step: '0.01', min: 0, placeholder: 'Betrag' });
  const cat = h('select', h('option', { value: 'werbung' }, 'Werbung'), h('option', { value: 'sonstiges' }, 'Sonstiges'));
  const note = h('input', { type: 'text', placeholder: 'Notiz, z. B. Instagram-Kampagne Drop 01' });
  const add = h('button.small.primary', { type: 'button' }, 'Hinzufügen');
  add.addEventListener('click', () => busy(add, async () => { try { await post('/api/analytics/costs', { date: date.value, amount: amount.value, category: cat.value, note: note.value }); toast('Kosten erfasst.', 'ok'); ctx.redraw(); } catch (err) { showError(err); } }));
  clear(box,
    h('div.row.cost-form', date, amount, cat, h('div', { style: { flex: '1 1 220px' } }, note), add),
    list.length ? h('div.table-wrap', h('table.list', h('tbody', list.slice(0, 50).map((c) => h('tr', h('td', c.date), h('td', c.category === 'werbung' ? 'Werbung' : 'Sonstiges'), h('td', c.note || ''), h('td.n', money(c.amount)), h('td', h('button.small.ghost', { type: 'button', onclick: async () => { if (await confirmDialog({ title: 'Eintrag löschen?', text: `${c.date}: ${money(c.amount)}`, danger: true, confirmLabel: 'Löschen' })) { await del(`/api/analytics/costs/${c.id}`).catch(showError); ctx.redraw(); } } }, 'Löschen'))))))) : h('div.empty', 'Noch keine Kosten erfasst.'),
    h('p.hint', 'Werbeausgaben und sonstige Kosten (z. B. Abos, Proben) zählen zum Datum, an dem sie anfallen. Zahlungsgebühren, Versand-Schätzung und Wechselkurse: Einstellungen → Analytics.'));
}

// ------------------------------------------------------------------ Berichte

async function viewReports(body) {
  const listBox = h('div');
  const insBox = h('div');
  let kind = 'monat'; let format = 'pdf';
  const from = h('input', { type: 'date' }); const to = h('input', { type: 'date' });
  const custom = h('span.row.hidden', from, h('span.muted', 'bis'), to);
  const seg = (opts, cur, set) => h('div.seg', opts.map(([k, l]) => h(`button${cur() === k ? '.on' : ''}`, { type: 'button', onclick: (e) => { set(k); e.target.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.target)); custom.classList.toggle('hidden', kind !== 'zeitraum'); } }, l)));
  const make = h('button.primary', { type: 'button' }, 'Bericht erstellen');
  make.addEventListener('click', () => busy(make, async () => {
    try {
      const r = await post('/api/analytics/reports', { kind, format, preset: kind === 'zeitraum' ? 'custom' : undefined, from: from.value || undefined, to: to.value || undefined });
      toast(r.note || `Bericht erstellt: ${r.name}`, r.note ? 'info' : 'ok', 8000);
      await post('/api/analytics/reports/open', { name: r.name }).catch(() => {});
      loadList();
    } catch (err) { showError(err); }
  }));
  const loadList = async () => {
    const list = await get('/api/analytics/reports').catch(() => []);
    clear(listBox, list.length ? h('div.table-wrap', h('table.list', h('tbody', list.map((r) => h('tr', h('td', r.name), h('td.muted', fmtDate(r.at)), h('td', h('div.row', h('button.small', { type: 'button', onclick: () => post('/api/analytics/reports/open', { name: r.name }).catch(showError) }, 'Öffnen'), h('button.small.ghost', { type: 'button', onclick: () => post('/api/analytics/reports/reveal', { name: r.name }).catch(showError) }, 'Im Ordner zeigen'), h('a.btn.small.ghost', { href: `/files/bericht/${encodeURIComponent(r.name)}` }, 'Herunterladen')))))))) : h('div.empty', 'Noch keine Berichte erstellt.'));
  };
  clear(body,
    section('Bericht erstellen',
      h('div.stack',
        h('div', h('div.field-label', 'Art'), seg([['tag', 'Tag (gestern)'], ['woche', 'Woche (7 Tage)'], ['monat', 'Monat (30 Tage)'], ['zeitraum', 'Zeitraum …']], () => kind, (k) => { kind = k; }), custom),
        h('div', h('div.field-label', 'Format'), seg([['pdf', 'PDF'], ['xlsx', 'Excel'], ['csv', 'CSV']], () => format, (k) => { format = k; })),
        h('div', make),
        h('p.hint', 'Enthält Kennzahlen mit Vergleich, Umsatz-Zusammensetzung, Gewinnrechnung, Pieces, Bestellungen und Hinweise. Gespeichert unter Dokumente → APOLOGEA Studio → Exporte → Berichte.'))),
    section('Gespeicherte Berichte', listBox),
    section('Aktuelle Hinweise (30 Tage)', insBox));
  loadList();
  get(`/api/analytics/insights?${qs({ preset: '30d' })}`).then((r) => clear(insBox, insightList(r.insights))).catch((err) => clear(insBox, h('div.inline-msg.error', err.message)));
}

export { insightList };

