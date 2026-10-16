/**
 * Cloudflare-Worker-Hülle um core.js mit D1-Datenbank (kostenloser Tarif reicht für einen kleinen Shop).
 * Einrichtung: siehe README.md.
 */
import { handle, cleanup } from './core.js';

function d1Store(db) {
  return {
    async insertEvent(e) { await db.prepare('INSERT INTO events (ts, type, visitor, product_id, product_title, country, path) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(e.ts, e.type, e.visitor, e.productId, e.productTitle, e.country, e.path).run(); },
    async eventsSince(ts) {
      const r = await db.prepare('SELECT ts, type, visitor, product_id AS productId, product_title AS productTitle, country, path FROM events WHERE ts >= ? ORDER BY ts').bind(ts).all();
      return r.results || [];
    },
    async bumpView(day, productId, title) { await db.prepare('INSERT INTO views (day, product_id, title, count) VALUES (?, ?, ?, 1) ON CONFLICT(day, product_id) DO UPDATE SET count = count + 1, title = excluded.title').bind(day, productId, title).run(); },
    async countViews(from, to) {
      const r = await db.prepare('SELECT product_id, SUM(count) AS n FROM views WHERE day >= ? AND day <= ? GROUP BY product_id').bind(from, to).all();
      return Object.fromEntries((r.results || []).map((x) => [x.product_id, x.n]));
    },
    async purge(before) { await db.prepare('DELETE FROM events WHERE ts < ?').bind(before).run(); },
    async purgeViews(beforeDay) { await db.prepare('DELETE FROM views WHERE day < ?').bind(beforeDay).run(); },
    async count24h(since) { const r = await db.prepare('SELECT COUNT(*) AS n FROM events WHERE ts >= ?').bind(since).first(); return r?.n || 0; },
    async getSalt(day) {
      const r = await db.prepare('SELECT salt FROM salts WHERE day = ?').bind(day).first();
      if (r?.salt) return r.salt;
      const salt = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
      await db.prepare('INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)').bind(day, salt).run();
      await db.prepare('DELETE FROM salts WHERE day < ?').bind(new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10)).run();
      return (await db.prepare('SELECT salt FROM salts WHERE day = ?').bind(day).first()).salt;
    },
  };
}

export default {
  async fetch(request, env) {
    return handle(request, env, d1Store(env.DB), { country: request.cf?.country || null });
  },
  async scheduled(_event, env) {
    await cleanup(d1Store(env.DB));
  },
};
