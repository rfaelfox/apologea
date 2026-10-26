// Simuliertes Cloudflare (REST-API v4 + Worker-Adresse) für Tests und Oberflächen-Durchläufe.
// TESTDATEN – keine echten Konten. Der Worker unter /worker beantwortet /v1/health nur mit dem beim Hochladen
// übergebenen Lese-Schlüssel (prüft, dass der Schlüssel korrekt durchgereicht wird).
import http from 'node:http';

export const MOCK_CF_TOKEN = 'cf_test_token_abcdefghijklmnopqrstuvwxyz0123';

export function createCloudflareMock() {
  const calls = [];
  const state = { dbs: [], subdomain: null, script: null, schedules: null, enabled: false, failAuth: false, queries: [], events24h: 0 };
  const ok = (res, result) => res.end(JSON.stringify({ success: true, errors: [], result }));
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const buf = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://x');
      const p = url.pathname.replace(/^\/client\/v4/, '');
      calls.push(`${req.method} ${p}`);
      res.setHeader('Content-Type', 'application/json');

      // simulierter Worker unter eigener Adresse
      if (p === '/worker/v1/health') {
        const auth = req.headers.authorization;
        const tok = state.script?.metadata.bindings.find((b) => b.name === 'READ_TOKEN')?.text;
        if (!state.enabled || !tok || auth !== `Bearer ${tok}`) { res.statusCode = 401; return res.end('{"error":"unauthorized"}'); }
        return res.end(JSON.stringify({ ok: true, version: '1.0.0', shop: 'dfz1mp-1u.myshopify.com', events24h: state.events24h }));
      }
      if (req.headers.authorization !== `Bearer ${MOCK_CF_TOKEN}` || state.failAuth) {
        res.statusCode = 403;
        return res.end(JSON.stringify({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }));
      }
      const A = '/accounts/acc1';
      if (req.method === 'GET' && p === '/accounts') return ok(res, [{ id: 'acc1', name: 'APOLOGEA Test' }]);
      if (req.method === 'GET' && p === `${A}/d1/database`) return ok(res, state.dbs.filter((d) => d.name === url.searchParams.get('name')));
      if (req.method === 'POST' && p === `${A}/d1/database`) { const d = { uuid: `db-${state.dbs.length + 1}`, name: JSON.parse(buf).name, created_at: new Date().toISOString() }; state.dbs.push(d); return ok(res, d); }
      if (req.method === 'POST' && /\/d1\/database\/[^/]+\/query$/.test(p)) { state.queries.push(JSON.parse(buf).sql); return ok(res, [{ success: true }]); }
      if (req.method === 'PUT' && p === `${A}/workers/scripts/apologea-live`) {
        const form = await new Response(buf, { headers: { 'content-type': req.headers['content-type'] } }).formData();
        const metadata = JSON.parse(await form.get('metadata').text());
        state.script = { metadata, files: Object.fromEntries(await Promise.all(['worker.js', 'core.js'].map(async (f) => [f, form.get(f) ? await form.get(f).text() : null]))), types: ['worker.js', 'core.js'].map((f) => form.get(f)?.type) };
        return ok(res, { id: 'apologea-live' });
      }
      if (req.method === 'PUT' && p === `${A}/workers/scripts/apologea-live/schedules`) { state.schedules = JSON.parse(buf); return ok(res, { schedules: state.schedules }); }
      if (req.method === 'GET' && p === `${A}/workers/subdomain`) {
        if (!state.subdomain) { res.statusCode = 404; return res.end(JSON.stringify({ success: false, errors: [{ code: 10007, message: 'This account does not have a workers.dev subdomain' }] })); }
        return ok(res, { subdomain: state.subdomain });
      }
      if (req.method === 'PUT' && p === `${A}/workers/subdomain`) { state.subdomain = JSON.parse(buf).subdomain; return ok(res, { subdomain: state.subdomain }); }
      if (req.method === 'POST' && p === `${A}/workers/scripts/apologea-live/subdomain`) { state.enabled = JSON.parse(buf).enabled; return ok(res, null); }
      res.statusCode = 404;
      res.end(JSON.stringify({ success: false, errors: [{ code: 7003, message: `Mock: ${req.method} ${p} unbekannt` }] }));
    });
  });
  server.keepAliveTimeout = 60_000;
  return { server, calls, state };
}
