import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import AdmZip from 'adm-zip';
import { DIRS } from '../paths.js';
import { UserError } from '../util.js';
import { findEdge } from '../opener.js';
import * as metrics from './metrics.js';
import { buildInsights } from './insights.js';

/**
 * Berichte: Tag / Woche / Monat / freier Zeitraum – als PDF, CSV oder Excel (.xlsx).
 * Excel wird ohne Zusatzbibliothek als Office-Open-XML erzeugt; PDF über den „Drucken als PDF“-Modus
 * von Microsoft Edge (auf jedem Windows-PC vorhanden). Ohne Edge: HTML-Bericht zum Drucken.
 */

const REPORT_DIR = () => path.join(DIRS.exports, 'Berichte');
const KIND = { tag: { preset: 'yesterday', label: 'Tagesbericht' }, woche: { preset: '7d', label: 'Wochenbericht' }, monat: { preset: '30d', label: 'Monatsbericht' }, zeitraum: { preset: null, label: 'Bericht' } };

const money = (v, cur) => (v === null || v === undefined ? '–' : new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur || 'EUR' }).format(v));
const pct = (v) => (v === null || v === undefined ? '–' : `${(v * 100).toFixed(1).replace('.', ',')} %`);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export async function collect(kind, periodInput) {
  const k = KIND[kind] || KIND.zeitraum;
  const p = k.preset ? { preset: k.preset } : periodInput;
  const [overview, sales, products, profit, goal] = await Promise.all([metrics.overview(p), metrics.sales(p), metrics.products(p), metrics.profit(p), metrics.goalProgress()]);
  overview.goal = goal;
  const insights = buildInsights({ overview, sales, products, profit });
  const orders = await metrics.ordersList({ preset: overview.period.preset, from: overview.period.from, to: overview.period.to, page: 1 });
  return { kind, label: k.label, overview, sales, products, profit, insights, orders, createdAt: new Date().toISOString() };
}

// ------------------------------------------------------------------ Tabellen (für CSV und Excel)

export function tables(r) {
  const cur = r.overview.shop.currency;
  const k = r.overview.kpis;
  const s = r.sales.sums;
  return {
    Kennzahlen: [
      ['Kennzahl', 'Wert', 'Vorperiode', 'Veränderung'],
      ['Gesamtumsatz', k.total.value, k.total.previous, k.total.change],
      ['Nettoumsatz', k.net.value, k.net.previous, k.net.change],
      ['Bestellungen', k.orders.value, k.orders.previous, k.orders.change],
      ['Ø Bestellwert', k.aov.value, k.aov.previous, k.aov.change],
      ['Verkaufte Artikel', k.itemsNet.value, k.itemsNet.previous, k.itemsNet.change],
      ['Rückerstattungen', k.refunds.value, k.refunds.previous, k.refunds.change],
      ['Sitzungen', k.sessions.value, k.sessions.previous, k.sessions.change],
      ['Conversion-Rate', k.conversion.value, k.conversion.previous, k.conversion.change],
      ['Geschätzter Gewinn', k.profit.value, k.profit.previous, k.profit.change],
      [],
      ['Bruttoumsatz', s.gross], ['Rabatte', s.discounts], ['Rücksendungen', s.returns], ['Nettoumsatz', s.net], ['Versand', s.shipping], ['Steuern', s.tax], ['Gesamtumsatz', s.total],
      [], ['Währung', cur], ['Zeitraum', `${r.overview.period.from} bis ${r.overview.period.to}`], ['Zeitzone', r.overview.period.tz],
    ],
    Verlauf: [['Zeitraum', 'Gesamtumsatz', 'Nettoumsatz', 'Bestellungen', 'Artikel'], ...r.sales.series.points.map((p) => [p.key, p.total, p.net, p.orders, p.items])],
    Produkte: [['Produkt', 'Anbieter', 'Stück', 'Erlös', 'Herstellkosten', 'Versand (POD)', 'Gebühren', 'Rückerstattungen', 'Deckungsbeitrag', 'Marge', 'vorläufig'],
      ...r.profit.products.map((p) => [p.title, p.provider || '', p.units, p.revenue, p.production, p.podShipping, p.fees, p.returns, p.contribution, p.margin, p.preliminary ? 'ja' : 'nein'])],
    Gewinn: [['Position', 'Betrag'], ['Erlös (ohne Steuer, inkl. Versand)', r.profit.revenue], ['Rückerstattungen', -r.profit.returns], ['Herstellkosten (POD)', -r.profit.production], ['Versand (POD)', -r.profit.podShipping], ['Zahlungsgebühren', -r.profit.fees], ['Deckungsbeitrag', r.profit.contribution], ['Werbeausgaben', -r.profit.ads], ['Sonstige Kosten', -r.profit.other], ['Gewinn', r.profit.profit], [], ['Vorläufig', r.profit.preliminary ? 'ja' : 'nein'], ['Fehlende Angaben', r.profit.missing.join('; ')]],
    Bestellungen: [['Bestellung', 'Datum', 'Summe', 'Erstattet', 'Artikel', 'Zahlung', 'Versandstatus', 'Storniert'], ...r.orders.orders.map((o) => [o.name, o.processedAt, o.total, o.refunded, o.items, o.financialStatus, o.fulfillmentStatus, o.cancelled ? 'ja' : 'nein'])],
    Hinweise: [['Art', 'Hinweis', 'Details', 'Grundlage'], ...r.insights.map((i) => [i.level, i.title, i.text, i.basis])],
  };
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(Math.round(v * 10000) / 10000).replace('.', ',');
  const s = String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(rows) {
  // Semikolon + Komma als Dezimaltrennzeichen + BOM → öffnet sich in deutschem Excel korrekt
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
}

const xmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
function colName(i) { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

export function toXlsx(sheets) {
  const zip = new AdmZip();
  const names = Object.keys(sheets);
  zip.addFile('[Content_Types].xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`));
  zip.addFile('_rels/.rels', Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'));
  zip.addFile('xl/workbook.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xmlEsc(n.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`));
  zip.addFile('xl/_rels/workbook.xml.rels', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`));
  zip.addFile('xl/styles.xml', Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>'));
  names.forEach((n, i) => {
    const rows = sheets[n].map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      const ref = `${colName(ci)}${ri + 1}`;
      const st = ri === 0 ? ' s="1"' : '';
      if (v === null || v === undefined || v === '') return '';
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    zip.addFile(`xl/worksheets/sheet${i + 1}.xml`, Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`));
  });
  return zip.toBuffer();
}

// ------------------------------------------------------------------ HTML/PDF

export function toHtml(r) {
  const cur = r.overview.shop.currency;
  const k = r.overview.kpis;
  const row = (label, item, f) => `<tr><td>${esc(label)}</td><td class="n">${f(item.value)}</td><td class="n muted">${f(item.previous)}</td><td class="n">${item.change === null || item.change === undefined ? '–' : `${item.change > 0 ? '+' : ''}${(item.change * 100).toFixed(1).replace('.', ',')} %`}</td></tr>`;
  const m = (v) => money(v, cur);
  const n = (v) => (v === null || v === undefined ? '–' : new Intl.NumberFormat('de-DE').format(v));
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(r.label)} ${esc(r.overview.period.from)}</title><style>
  @page { size: A4; margin: 16mm 14mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #1b1814; font-size: 10.5pt; }
  h1 { font-family: "Palatino Linotype", Georgia, serif; font-weight: 400; letter-spacing: .12em; color: #6b5527; margin: 0 0 2mm; }
  h2 { font-family: "Palatino Linotype", Georgia, serif; font-weight: 400; color: #6b5527; border-bottom: 1px solid #b39659; padding-bottom: 1mm; margin-top: 8mm; font-size: 13pt; }
  .meta { color: #6f675b; font-size: 9pt; } table { width: 100%; border-collapse: collapse; margin-top: 3mm; }
  td, th { padding: 1.6mm 2mm; border-bottom: 1px solid #e6dfd2; text-align: left; vertical-align: top; } th { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .08em; color: #6f675b; }
  .n { text-align: right; white-space: nowrap; } .muted { color: #8a8070; } .note { font-size: 8.5pt; color: #6f675b; margin-top: 2mm; }
  .ins { margin: 2mm 0; padding: 2mm 3mm; border-left: 3px solid #b39659; background: #faf7f1; } .ins b { display: block; }
  </style></head><body>
  <h1>APOLOGEA · ${esc(r.label)}</h1>
  <div class="meta">${esc(r.overview.period.label || 'Zeitraum')}: ${esc(r.overview.period.from)} bis ${esc(r.overview.period.to)} · Vergleich: ${esc(r.overview.period.prev.from)} bis ${esc(r.overview.period.prev.to)} · Zeitzone ${esc(r.overview.period.tz)} · erstellt ${esc(new Date(r.createdAt).toLocaleString('de-DE'))}</div>
  <h2>Kennzahlen</h2><table><tr><th>Kennzahl</th><th class="n">Zeitraum</th><th class="n">Vorperiode</th><th class="n">Veränderung</th></tr>
  ${row('Gesamtumsatz', k.total, m)}${row('Nettoumsatz', k.net, m)}${row('Bestellungen', k.orders, n)}${row('Ø Bestellwert', k.aov, m)}${row('Verkaufte Artikel', k.itemsNet, n)}${row('Rückerstattungen', k.refunds, m)}${row('Sitzungen', k.sessions, n)}${row('Conversion-Rate', k.conversion, pct)}${row('Geschätzter Gewinn', k.profit, m)}</table>
  ${k.sessions.unavailable ? `<div class="note">Sitzungen/Conversion: ${esc(k.sessions.unavailable)}</div>` : ''}
  <h2>Gewinnrechnung</h2><table>
  <tr><td>Erlös (ohne Steuer, inkl. Versand)</td><td class="n">${m(r.profit.revenue)}</td></tr><tr><td>− Rückerstattungen</td><td class="n">${m(r.profit.returns)}</td></tr><tr><td>− Herstellkosten (POD)</td><td class="n">${m(r.profit.production)}</td></tr><tr><td>− Versand (POD)</td><td class="n">${m(r.profit.podShipping)}</td></tr><tr><td>− Zahlungsgebühren</td><td class="n">${m(r.profit.fees)}</td></tr>
  <tr><td><b>Deckungsbeitrag</b></td><td class="n"><b>${m(r.profit.contribution)}</b></td></tr><tr><td>− Werbung</td><td class="n">${m(r.profit.ads)}</td></tr><tr><td>− Sonstige Kosten</td><td class="n">${m(r.profit.other)}</td></tr><tr><td><b>Gewinn</b></td><td class="n"><b>${m(r.profit.profit)}</b></td></tr></table>
  ${r.profit.preliminary ? `<div class="note">Vorläufig – fehlende Angaben: ${esc(r.profit.missing.join(', '))}</div>` : ''}
  <h2>Pieces</h2><table><tr><th>Produkt</th><th class="n">Stück</th><th class="n">Erlös</th><th class="n">Deckungsbeitrag</th><th class="n">Marge</th></tr>
  ${r.profit.products.slice(0, 25).map((p) => `<tr><td>${esc(p.title)}${p.preliminary ? ' <span class="muted">(vorläufig)</span>' : ''}</td><td class="n">${n(p.units)}</td><td class="n">${m(p.revenue)}</td><td class="n">${m(p.contribution)}</td><td class="n">${pct(p.margin)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Keine Verkäufe im Zeitraum.</td></tr>'}</table>
  <h2>Hinweise</h2>${r.insights.map((i) => `<div class="ins"><b>${esc(i.title)}</b>${esc(i.text)} <span class="muted">(Grundlage: ${esc(i.basis)})</span></div>`).join('') || '<div class="muted">Keine Hinweise.</div>'}
  <div class="note">Umsatzwerte berechnet aus Shopify-Bestellungen (Shop-Währung ${esc(cur)}); Sitzungen und Conversion aus Shopify-Berichten. Kleine Abweichungen zu Shopify sind durch unterschiedliche Zuordnungsregeln möglich. Gewinn auf Basis der hinterlegten Kosten.</div>
  </body></html>`;
}

const reportTokens = new Map(); // einmalige Adressen für den PDF-Druck durch Edge

export function htmlByToken(tok) {
  const e = reportTokens.get(tok);
  if (!e || e.exp < Date.now()) return null;
  reportTokens.delete(tok);
  return e.html;
}

function browserForPdf() {
  if (process.env.APOLOGEA_TEST === '1' && process.env.APOLOGEA_PDF_BROWSER) return process.env.APOLOGEA_PDF_BROWSER;
  return findEdge();
}

async function printPdf(html, file, port) {
  const browser = browserForPdf();
  if (!browser) return false;
  const tok = crypto.randomBytes(18).toString('base64url');
  reportTokens.set(tok, { html, exp: Date.now() + 60_000 });
  const profile = path.join(DIRS.internal, 'pdf-profil');
  await new Promise((resolve) => {
    const extra = typeof process.getuid === 'function' && process.getuid() === 0 ? ['--no-sandbox'] : []; // nur Linux-Testumgebung
    const p = spawn(browser, [...extra, '--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`, '--no-pdf-header-footer', `--print-to-pdf=${file}`, `http://127.0.0.1:${port}/bericht/${tok}`], { stdio: 'ignore', windowsHide: true });
    const t = setTimeout(() => { p.kill(); resolve(); }, 60_000);
    p.on('exit', () => { clearTimeout(t); resolve(); });
    p.on('error', () => { clearTimeout(t); resolve(); });
  });
  return fs.existsSync(file) && fs.statSync(file).size > 0;
}

/** Bericht erzeugen und speichern. Rückgabe: { name, format, path } bzw. { html } wenn kein PDF möglich. */
export async function createReport({ kind = 'monat', format = 'pdf', preset, from, to }, { port }) {
  if (!['pdf', 'csv', 'xlsx'].includes(format)) throw new UserError('Unbekanntes Format.');
  const r = await collect(kind, { preset: preset || '30d', from, to });
  fs.mkdirSync(REPORT_DIR(), { recursive: true });
  const base = `APOLOGEA-${r.label.replace(/\s+/g, '-')}-${r.overview.period.from}_bis_${r.overview.period.to}-${Date.now().toString(36)}`;
  if (format === 'csv') {
    // CSV kann nur eine Tabelle: alle Abschnitte untereinander, durch Leerzeilen getrennt
    const t = tables(r);
    const rows = [];
    for (const [name, data] of Object.entries(t)) { rows.push([`# ${name}`]); rows.push(...data); rows.push([]); }
    const file = path.join(REPORT_DIR(), `${base}.csv`);
    fs.writeFileSync(file, toCsv(rows));
    return { name: path.basename(file), format, path: file };
  }
  if (format === 'xlsx') {
    const file = path.join(REPORT_DIR(), `${base}.xlsx`);
    fs.writeFileSync(file, toXlsx(tables(r)));
    return { name: path.basename(file), format, path: file };
  }
  const html = toHtml(r);
  const file = path.join(REPORT_DIR(), `${base}.pdf`);
  if (await printPdf(html, file, port)) return { name: path.basename(file), format, path: file };
  const htmlFile = path.join(REPORT_DIR(), `${base}.html`);
  fs.writeFileSync(htmlFile, html);
  return { name: path.basename(htmlFile), format: 'html', path: htmlFile, note: 'PDF-Erzeugung nicht möglich (Microsoft Edge nicht gefunden). Bericht als HTML gespeichert – im Browser öffnen und „Drucken → Als PDF speichern“.' };
}

export function reportFile(name) {
  if (!/^[\w.,-]+\.(pdf|csv|xlsx|html)$/.test(name)) throw new UserError('Ungültiger Dateiname.');
  return path.join(REPORT_DIR(), name);
}

export function listReports() {
  try {
    return fs.readdirSync(REPORT_DIR()).filter((f) => /\.(pdf|csv|xlsx|html)$/.test(f)).map((f) => ({ name: f, size: fs.statSync(path.join(REPORT_DIR(), f)).size, at: fs.statSync(path.join(REPORT_DIR(), f)).mtime.toISOString() })).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50);
  } catch { return []; }
}
