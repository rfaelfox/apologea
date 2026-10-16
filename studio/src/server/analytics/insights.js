/**
 * Regelbasierte Hinweise – ausschließlich aus vorhandenen Daten berechnet.
 * Jede Aussage nennt ihre Grundlage; Hochrechnungen sind ausdrücklich als „Prognose“ gekennzeichnet.
 */

const fmt = (v, cur) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur || 'EUR' }).format(v || 0);
const pctTxt = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)} %`;

export function buildInsights({ overview, sales, products, profit }) {
  const out = [];
  const cur = overview.shop.currency;
  const k = overview.kpis;
  // Wachstum gegenüber Vorperiode
  if (k.total.change !== null && k.total.previous) {
    const big = Math.abs(k.total.change) >= 0.2;
    out.push({ level: k.total.change >= 0 ? 'positiv' : (big ? 'warnung' : 'info'), kind: 'wachstum', title: `Gesamtumsatz ${pctTxt(k.total.change)} gegenüber der Vorperiode`, text: `${fmt(k.total.value, cur)} statt ${fmt(k.total.previous, cur)} (${overview.period.label}).${big ? ' Auffällige Veränderung.' : ''}`, basis: 'Bestellungen aus Shopify' });
  } else if (k.total.value && !k.total.previous) {
    out.push({ level: 'info', kind: 'wachstum', title: 'Kein Vergleich möglich', text: 'In der Vorperiode gab es keinen Umsatz – eine prozentuale Veränderung ist nicht sinnvoll.', basis: 'Bestellungen aus Shopify' });
  }
  if (k.orders.change !== null && k.orders.previous >= 5 && Math.abs(k.orders.change) >= 0.3) {
    out.push({ level: k.orders.change > 0 ? 'positiv' : 'warnung', kind: 'auffaellig', title: `Bestellungen ${pctTxt(k.orders.change)}`, text: `${k.orders.value} statt ${k.orders.previous} Bestellungen.`, basis: 'Bestellungen aus Shopify' });
  }
  // Umsatzstärkste Produkte
  const top = sales.products.slice(0, 3);
  if (top.length) out.push({ level: 'info', kind: 'top', title: `Umsatzstärkstes Piece: ${top[0].title}`, text: top.map((p, i) => `${i + 1}. ${p.title} – ${fmt(p.net, cur)} (${p.units} Stück)`).join(' · '), basis: 'Bestellpositionen' });
  // Conversion-Rate
  if (k.conversion.value !== null && k.conversion.value !== undefined) {
    if (k.conversion.value < 0.01) out.push({ level: 'warnung', kind: 'conversion', title: `Niedrige Conversion-Rate (${(k.conversion.value * 100).toFixed(2).replace('.', ',')} %)`, text: 'Weniger als 1 von 100 Sitzungen führt zu einer Bestellung. Üblich im Modehandel sind grob 1–3 %. Produktseiten, Preise und Versandkosten prüfen.', basis: 'Shopify-Berichte (ShopifyQL)' });
  }
  // Produkte mit Aufrufen, aber ohne Verkäufe
  const viewedNoSale = (products.products || []).filter((p) => p.views >= 30 && p.units === 0);
  for (const p of viewedNoSale.slice(0, 3)) out.push({ level: 'warnung', kind: 'conversion', title: `Viel angesehen, nicht gekauft: ${p.title}`, text: `${p.views} Aufrufe ohne Verkauf im Zeitraum.`, basis: 'Web Pixel (nur mit Einwilligung)' });
  // Schwache Margen
  for (const p of (profit.products || []).filter((x) => !x.preliminary && x.margin !== null && x.margin < 0.2 && x.units > 0).slice(0, 5)) {
    out.push({ level: 'warnung', kind: 'marge', title: `Schwache Marge: ${p.title}`, text: `Deckungsbeitrag ${fmt(p.contribution, cur)} bei ${fmt(p.revenue, cur)} Erlös (${Math.round(p.margin * 100)} %).`, basis: 'Erlöse und hinterlegte Kosten' });
  }
  if (profit.preliminary) out.push({ level: 'info', kind: 'kosten', title: 'Gewinn nur vorläufig', text: `Es fehlen Kostenangaben: ${profit.missing.slice(0, 4).join(', ')}${profit.missing.length > 4 ? ' …' : ''}.`, basis: 'Kostenquellen' });
  // Prognose Monatsende (ausdrücklich gekennzeichnet)
  if (overview.goal && overview.goal.month > 0) {
    const g = overview.goal;
    const [y, m] = g.monthKey.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const elapsed = Number(g.todayKey.slice(8, 10));
    if (elapsed >= 3) {
      const forecast = (g.month / elapsed) * daysInMonth;
      out.push({ level: 'prognose', kind: 'prognose', title: `Prognose Monatsende: ca. ${fmt(forecast, cur)}`, text: `Lineare Hochrechnung aus ${elapsed} Tagen (${fmt(g.month, cur)} bisher). Keine Garantie – Saison, Aktionen und Drops verändern das Ergebnis.${g.goals?.monthly ? ` Monatsziel: ${fmt(g.goals.monthly, cur)}.` : ''}`, basis: 'Prognose' });
    }
  }
  return out;
}
