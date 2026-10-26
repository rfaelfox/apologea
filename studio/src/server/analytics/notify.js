import { store, getSettings } from '../store.js';
import { nowIso } from '../util.js';

/**
 * Dezente Benachrichtigungen: neue Verkäufe, erreichte Umsatzziele, Rückerstattungen, fehlgeschlagene
 * Synchronisierung. Die Oberfläche fragt sie regelmäßig ab und zeigt sie als Hinweis (und – falls erlaubt –
 * als Windows-Benachrichtigung). Jede Meldung hat einen eindeutigen Schlüssel → keine Doppelmeldungen.
 */

function push(key, n) {
  const id = 'n_' + key.replace(/[^\w-]/g, '_').slice(0, 80);
  if (store().notices.has(id)) return null;
  const all = store().notices.list();
  if (all.length > 300) for (const old of all.slice(300)) store().notices.remove(old.id);
  return store().notices.put({ id, ...n, read: false, at: nowIso() });
}

const fmt = (v, cur = 'EUR') => new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur }).format(v);

export const notify = {
  orderChanged(order, prev) {
    const cfg = getSettings().analytics.notify;
    if (order.test) return;
    if (!prev && cfg.sales) push(`sale-${order.id}`, { kind: 'sale', title: `Neuer Verkauf ${order.name}`, text: `${fmt(order.total, order.currency)} · ${order.lines.reduce((s, l) => s + l.quantity, 0)} Artikel`, ref: order.id });
    const prevRefunds = new Set((prev?.refunds || []).map((r) => r.id));
    if (cfg.refunds) for (const r of order.refunds) if (!prevRefunds.has(r.id)) push(`refund-${r.id}`, { kind: 'refund', title: `Rückerstattung ${order.name}`, text: fmt(r.total, order.currency), ref: order.id });
  },
  async checkGoals() {
    const a = getSettings().analytics;
    if (!a.notify.goals || (!a.goals.daily && !a.goals.monthly)) return;
    const { goalProgress } = await import('./metrics.js');
    const g = await goalProgress();
    if (a.goals.daily && g.today >= a.goals.daily) push(`goal-day-${g.todayKey}`, { kind: 'goal', title: 'Tagesziel erreicht', text: `${fmt(g.today, g.currency)} von ${fmt(a.goals.daily, g.currency)}` });
    if (a.goals.monthly && g.month >= a.goals.monthly) push(`goal-month-${g.monthKey}`, { kind: 'goal', title: 'Monatsziel erreicht', text: `${fmt(g.month, g.currency)} von ${fmt(a.goals.monthly, g.currency)}` });
  },
  syncFailed(message) {
    if (!getSettings().analytics.notify.errors) return;
    // höchstens eine Fehlermeldung pro Stunde
    push(`syncerr-${new Date().toISOString().slice(0, 13)}`, { kind: 'error', title: 'Synchronisierung fehlgeschlagen', text: message });
  },
};

export function listNotices({ unreadOnly = false } = {}) {
  return store().notices.list((n) => !unreadOnly || !n.read).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100);
}

export function markRead(ids) {
  for (const id of ids === 'all' ? store().notices.list((n) => !n.read).map((n) => n.id) : ids || []) {
    store().notices.update(id, (n) => ({ ...n, read: true }));
  }
  return { ok: true };
}
