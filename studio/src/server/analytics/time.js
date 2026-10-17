/**
 * Zeiträume und Zeitzonen für Analytics.
 * Alle Tagesgrenzen werden in der Zeitzone des Shops berechnet (wie im Shopify-Admin), nicht in der des PCs.
 */

const fmtCache = new Map();
function partsFmt(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }));
  }
  return fmtCache.get(tz);
}

function parts(date, tz) {
  const o = {};
  for (const p of partsFmt(tz).formatToParts(date)) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return o;
}

/** Abstand der Zeitzone zu UTC in ms zum gegebenen Zeitpunkt. */
function offsetMs(date, tz) {
  const p = parts(date, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

/** 'YYYY-MM-DD' des Zeitpunkts in der Shop-Zeitzone. */
export function dayKey(iso, tz) {
  const p = parts(new Date(iso), tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Beginn des Tages (Shop-Zeitzone) als Date in UTC. */
export function startOfDay(key, tz) {
  const [y, m, d] = key.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetMs(new Date(guess), tz);
  t = guess - offsetMs(new Date(t), tz); // Sommerzeit-Wechsel berücksichtigen
  return new Date(t);
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((Date.UTC(...b.split('-').map((v, i) => (i === 1 ? v - 1 : +v))) - Date.UTC(...a.split('-').map((v, i) => (i === 1 ? v - 1 : +v)))) / 86_400_000);
}

const PRESETS = {
  today: 'Heute', yesterday: 'Gestern', '7d': 'Letzte 7 Tage', '30d': 'Letzte 30 Tage', '90d': 'Letzte 90 Tage', ytd: 'Dieses Jahr', custom: 'Benutzerdefiniert',
};

/**
 * Zeitraum aus Voreinstellung bzw. von/bis (inklusive, Shop-Tage) samt Vergleichszeitraum
 * (gleich lang, unmittelbar davor – wie „Vorperiode“ in Shopify).
 */
export function resolvePeriod({ preset = '30d', from, to } = {}, tz, now = new Date()) {
  const today = dayKey(now.toISOString(), tz);
  let a; let b;
  switch (preset) {
    case 'today': a = today; b = today; break;
    case 'yesterday': a = addDays(today, -1); b = a; break;
    case '7d': a = addDays(today, -6); b = today; break;
    case '90d': a = addDays(today, -89); b = today; break;
    case 'ytd': a = `${today.slice(0, 4)}-01-01`; b = today; break;
    case 'custom': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) throw new Error('Bitte Start- und Enddatum angeben.');
      a = from <= to ? from : to; b = from <= to ? to : from;
      break;
    }
    default: a = addDays(today, -29); b = today; preset = '30d';
  }
  const len = daysBetween(a, b) + 1;
  const prevB = addDays(a, -1);
  const prevA = addDays(prevB, -(len - 1));
  const granularity = len <= 2 ? 'hour' : len <= 62 ? 'day' : len <= 200 ? 'week' : 'month';
  return {
    preset, label: PRESETS[preset], from: a, to: b, days: len, granularity, tz,
    start: startOfDay(a, tz).toISOString(), end: startOfDay(addDays(b, 1), tz).toISOString(),
    prev: { from: prevA, to: prevB, start: startOfDay(prevA, tz).toISOString(), end: startOfDay(addDays(prevB, 1), tz).toISOString() },
  };
}

/** Schlüssel des Zeit-Eimers (Stunde/Tag/Woche ab Montag/Monat) für einen Zeitpunkt. */
export function bucketKey(iso, tz, granularity) {
  const p = parts(new Date(iso), tz);
  const day = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  if (granularity === 'hour') return `${day} ${String(p.hour).padStart(2, '0')}:00`;
  if (granularity === 'month') return day.slice(0, 7);
  if (granularity === 'week') {
    const wd = (new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() + 6) % 7; // Montag = 0
    return addDays(day, -wd);
  }
  return day;
}

/** Alle Eimer eines Zeitraums (damit Tage ohne Umsatz als 0 erscheinen). */
export function bucketsFor(period) {
  const out = [];
  const g = period.granularity;
  if (g === 'hour') {
    for (let d = period.from; d <= period.to; d = addDays(d, 1)) for (let h = 0; h < 24; h++) out.push(`${d} ${String(h).padStart(2, '0')}:00`);
    return out;
  }
  const seen = new Set();
  for (let d = period.from; d <= period.to; d = addDays(d, 1)) {
    const k = g === 'month' ? d.slice(0, 7) : g === 'week' ? bucketKey(startOfDay(d, period.tz).toISOString(), period.tz, 'week') : d;
    if (!seen.has(k)) { seen.add(k); out.push(k); }
  }
  return out;
}

export function inRange(iso, start, end) {
  return iso && iso >= start && iso < end;
}
