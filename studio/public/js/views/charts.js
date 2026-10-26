import { h } from '../core.js';

/**
 * Schlanke SVG-Diagramme im APOLOGEA-Stil (ohne Fremdbibliothek).
 * Regeln: eine y-Achse je Diagramm, 2px-Linien, Vergleich gestrichelt + Legende, dezentes Raster,
 * Fadenkreuz mit Tooltip beim Überfahren, Tabellenansicht für Barrierefreiheit.
 * Farben (gegen den dunklen Hintergrund geprüft): Gold #B88D3E = aktueller Zeitraum, Stahlblau #5F95D6 = Vergleich.
 */

export const SERIES = { current: '#B88D3E', previous: '#5F95D6' };
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) e.setAttribute(k, v);
  for (const k of kids) if (k) e.append(k);
  return e;
};

function niceMax(v) {
  if (!v || v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

export function keyLabel(key, granularity) {
  if (granularity === 'hour') return key.slice(11, 16);
  if (granularity === 'month') { const [y, m] = key.split('-'); return new Date(Date.UTC(+y, +m - 1, 1)).toLocaleDateString('de-DE', { month: 'short', year: '2-digit' }); }
  if (granularity === 'week') return 'KW ab ' + new Date(key + 'T12:00:00Z').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  return new Date(key + 'T12:00:00Z').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

/**
 * Liniendiagramm. series: [{ name, color, dashed, points: [{ key, value }] }] – Vergleichsreihe wird
 * positionsgleich (Tag 1 ↔ Tag 1) dargestellt, ihre eigenen Daten stehen im Tooltip.
 */
export function lineChart({ series, format = (v) => String(v), granularity = 'day', height = 240, area = true, title = '' }) {
  const wrap = h('div.chart');
  const W = 760; const H = height; const L = 56; const R = 12; const T = 14; const B = 28;
  const main = series[0]?.points || [];
  const n = Math.max(main.length, 1);
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.points.map((p) => p.value || 0))));
  const x = (i) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = (v) => T + (H - T - B) * (1 - (v || 0) / max);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': title });
  // Raster und y-Achse (4 Linien)
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    svg.append(el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: i === 0 ? 'axis' : 'grid' }));
    svg.append(el('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, document.createTextNode(format(v, true))));
  }
  // x-Beschriftung: höchstens 8
  const step = Math.max(1, Math.ceil(n / 8));
  main.forEach((p, i) => { if (i % step === 0 || (i === n - 1 && (n - 1) % step >= step / 2)) svg.append(el('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', class: 'tick' }, document.createTextNode(keyLabel(p.key, granularity)))); });
  // Reihen (Vergleich zuerst, damit Gold oben liegt)
  for (const s of [...series].reverse()) {
    if (!s.points.length) continue;
    const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    if (area && !s.dashed) svg.append(el('path', { d: `${d} L${x(s.points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`, fill: s.color, opacity: '0.10' }));
    svg.append(el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': s.dashed ? '5 4' : null }));
  }
  // Hover: Fadenkreuz + Punkte + Tooltip
  const cross = el('line', { y1: T, y2: H - B, class: 'crosshair', visibility: 'hidden' });
  const dots = series.map((s) => el('circle', { r: 4.5, fill: s.color, stroke: '#121110', 'stroke-width': 2, visibility: 'hidden' }));
  svg.append(cross, ...dots);
  const tip = h('div.chart-tip.hidden');
  const hit = el('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' });
  svg.append(hit);
  const show = (evt) => {
    const box = svg.getBoundingClientRect();
    const px = ((evt.clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1))));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    series.forEach((s, si) => { const p = s.points[i]; if (p) { dots[si].setAttribute('cx', x(i)); dots[si].setAttribute('cy', y(p.value)); dots[si].setAttribute('visibility', 'visible'); } else dots[si].setAttribute('visibility', 'hidden'); });
    tip.replaceChildren(...series.map((s) => { const p = s.points[i]; return p ? h('div.tip-row', h('span.sw', { style: { borderColor: s.color, borderStyle: s.dashed ? 'dashed' : 'solid' } }), h('span', `${s.name} · ${keyLabel(p.key, granularity)}`), h('strong', format(p.value))) : null; }));
    tip.classList.remove('hidden');
    const left = (x(i) / W) * box.width;
    tip.style.left = `${Math.min(box.width - 220, Math.max(0, left + 12))}px`;
    tip.style.top = '8px';
  };
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerleave', () => { tip.classList.add('hidden'); cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); });
  const legend = series.length > 1 ? h('div.chart-legend', series.map((s) => h('span', h('span.sw', { style: { borderColor: s.color, borderStyle: s.dashed ? 'dashed' : 'solid' } }), s.name))) : null;
  const table = h('details.chart-table', h('summary', 'Als Tabelle'), h('table.list', h('thead', h('tr', h('th', 'Zeitraum'), series.map((s) => h('th', s.name)))), h('tbody', main.map((p, i) => h('tr', h('td', keyLabel(p.key, granularity)), series.map((s) => h('td', s.points[i] ? format(s.points[i].value) : '–')))))));
  wrap.append(legend || '', h('div.chart-box', svg, tip), table);
  return wrap;
}

/** Waagerechtes Balkendiagramm (Rangfolgen). items: [{ label, value, sub, onClick }] */
export function barList({ items, format = (v) => String(v), color = SERIES.current, empty = 'Keine Daten.' }) {
  if (!items.length) return h('div.empty', empty);
  const max = Math.max(...items.map((i) => i.value || 0), 1);
  return h('div.bar-list', items.map((it) => {
    const row = h(`div.bar-row${it.onClick ? '.click' : ''}`, { title: `${it.label}: ${format(it.value)}` },
      h('div.bar-label', it.image ? h('img', { src: it.image, alt: '', loading: 'lazy' }) : null, h('span', it.label), it.sub ? h('small.muted', it.sub) : null),
      h('div.bar-track', h('div.bar-fill', { style: { width: `${Math.max(1.5, (100 * (it.value || 0)) / max)}%`, background: color } })),
      h('div.bar-val', format(it.value)));
    if (it.onClick) row.addEventListener('click', it.onClick);
    return row;
  }));
}

/** Säulendiagramm für wenige Werte im Zeitverlauf (z. B. Bestellungen je Tag). */
export function columnChart({ points, format = (v) => String(v), granularity = 'day', height = 200, color = SERIES.current, name = '' }) {
  const W = 760; const H = height; const L = 44; const R = 8; const T = 12; const B = 26;
  const n = Math.max(points.length, 1);
  const max = niceMax(Math.max(0, ...points.map((p) => p.value || 0)));
  const bw = Math.max(2, ((W - L - R) / n) - 2);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': name });
  const y = (v) => T + (H - T - B) * (1 - (v || 0) / max);
  for (let i = 0; i <= 3; i++) { const v = (max / 3) * i; svg.append(el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: i === 0 ? 'axis' : 'grid' })); svg.append(el('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, document.createTextNode(format(v, true)))); }
  const tip = h('div.chart-tip.hidden');
  const step = Math.max(1, Math.ceil(n / 8));
  points.forEach((p, i) => {
    const x0 = L + i * ((W - L - R) / n) + 1;
    const hgt = Math.max(0, y(0) - y(p.value));
    const r = Math.min(4, bw / 2, hgt);
    // oben abgerundet (4px), unten an der Grundlinie gerade
    const d = hgt > 0 ? `M${x0},${y(0)} V${y(p.value) + r} Q${x0},${y(p.value)} ${x0 + r},${y(p.value)} H${x0 + bw - r} Q${x0 + bw},${y(p.value)} ${x0 + bw},${y(p.value) + r} V${y(0)} Z` : '';
    if (d) svg.append(el('path', { d, fill: color }));
    const hit = el('rect', { x: x0 - 1, y: T, width: bw + 2, height: H - T - B, fill: 'transparent' });
    hit.addEventListener('pointerenter', () => { tip.replaceChildren(h('div.tip-row', h('span', keyLabel(p.key, granularity)), h('strong', format(p.value)))); tip.classList.remove('hidden'); const box = svg.getBoundingClientRect(); tip.style.left = `${Math.min(box.width - 180, ((x0 + bw) / W) * box.width + 6)}px`; tip.style.top = '8px'; });
    hit.addEventListener('pointerleave', () => tip.classList.add('hidden'));
    svg.append(hit);
    if (i % step === 0) svg.append(el('text', { x: x0 + bw / 2, y: H - 8, 'text-anchor': 'middle', class: 'tick' }, document.createTextNode(keyLabel(p.key, granularity))));
  });
  return h('div.chart', h('div.chart-box', svg, tip));
}
