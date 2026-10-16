// Simulierter Shopify-Server für automatische Tests (Admin GraphQL – nur die vom Studio genutzten Teile).
import crypto from 'node:crypto';
import http from 'node:http';

const md5 = (s) => crypto.createHash('md5').update(Buffer.from(s, 'utf8')).digest('hex');

export function createMockShopify() {
  const state = {
    themes: new Map([
      ['gid://shopify/OnlineStoreTheme/1', { id: 'gid://shopify/OnlineStoreTheme/1', name: 'Horizon', role: 'MAIN', files: new Map([
        ['templates/index.json', '{"sections":{"hero":{"type":"hero","settings":{"heading":"Willkommen"}}},"order":["hero"]}'],
        ['sections/hero.liquid', '<h1>{{ section.settings.heading }}</h1>{% schema %}{"name":"Hero","settings":[{"type":"text","id":"heading","label":"Überschrift"}]}{% endschema %}'],
        ['config/settings_data.json', '{"current":{"accent":"#b8955a"}}'],
      ]) }],
    ]),
    pages: new Map([['gid://shopify/Page/10', { id: 'gid://shopify/Page/10', title: 'Über uns', handle: 'ueber-uns', body: '<p>Alt</p>', isPublished: true, updatedAt: '2026-10-01T10:00:00Z', templateSuffix: null }]]),
    calls: [],
    nextId: 100,
  };
  const fileNode = (name, content) => ({ filename: name, size: content.length, checksumMd5: md5(content), contentType: name.endsWith('.json') ? 'application/json' : 'text/plain', updatedAt: new Date().toISOString(), body: { __typename: 'OnlineStoreThemeFileBodyText', content } });

  function handle(query, v) {
    state.calls.push(query.replace(/\s+/g, ' ').slice(0, 60));
    if (/themeFilesUpsert/.test(query)) {
      const t = state.themes.get(v.id);
      for (const f of v.files) t.files.set(f.filename, f.body.type === 'BASE64' ? Buffer.from(f.body.value, 'base64').toString('latin1') : f.body.value);
      return { themeFilesUpsert: { upsertedThemeFiles: v.files.map((f) => ({ filename: f.filename })), job: null, userErrors: [] } };
    }
    if (/themeDuplicate/.test(query)) {
      const src = state.themes.get(v.id);
      const id = `gid://shopify/OnlineStoreTheme/${state.nextId++}`;
      state.themes.set(id, { id, name: v.name, role: 'UNPUBLISHED', files: new Map(src.files) });
      return { themeDuplicate: { newTheme: { id, name: v.name, role: 'UNPUBLISHED', processing: false }, userErrors: [] } };
    }
    if (/themeDelete/.test(query)) { state.themes.delete(v.id); return { themeDelete: { deletedThemeId: v.id, userErrors: [] } }; }
    if (/pageUpdate/.test(query)) {
      const p = state.pages.get(v.id);
      Object.assign(p, v.page, { updatedAt: new Date().toISOString() });
      return { pageUpdate: { page: p, userErrors: [] } };
    }
    if (/themes\(first/.test(query)) {
      const out = { themes: { nodes: [...state.themes.values()].map((t) => ({ id: t.id, name: t.name, role: t.role, processing: false, processingFailed: false, updatedAt: '' })) } };
      if (/shop \{/.test(query)) out.shop = { name: 'Apologea (Test)' };
      return out;
    }
    if (/theme\(id: \$id\) \{ files\(first: 250/.test(query)) {
      const t = state.themes.get(v.id);
      return { theme: { files: { nodes: [...t.files.entries()].map(([n, c]) => ({ filename: n, size: c.length, checksumMd5: md5(c), contentType: 'text' })), pageInfo: { hasNextPage: false, endCursor: null } } } };
    }
    if (/files\(first: 50, filenames/.test(query)) {
      const t = state.themes.get(v.id);
      return { theme: { files: { nodes: v.names.filter((n) => t.files.has(n)).map((n) => fileNode(n, t.files.get(n))), userErrors: [] } } };
    }
    if (/theme\(id: \$id\) \{ id name role/.test(query)) {
      const t = state.themes.get(v.id);
      return { theme: t ? { id: t.id, name: t.name, role: t.role, processing: false, processingFailed: false } : null };
    }
    if (/page\(id: \$id\)/.test(query)) return { page: state.pages.get(v.id) || null };
    if (/pages\(first/.test(query)) return { pages: { nodes: [...state.pages.values()] } };
    if (/shop \{/.test(query)) return { shop: { name: 'Apologea (Test)', primaryDomain: { url: 'https://apologea.test' } } };
    throw new Error('Mock: Abfrage nicht unterstützt: ' + query.slice(0, 80));
  }

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.endsWith('/admin/oauth/access_token')) return res.end(JSON.stringify({ access_token: 'test-token', scope: 'read_themes,write_themes,read_content,write_content,read_products,write_products', expires_in: 86399 }));
      try {
        const { query, variables } = JSON.parse(body);
        res.end(JSON.stringify({ data: handle(query, variables || {}) }));
      } catch (err) { res.end(JSON.stringify({ errors: [{ message: err.message }] })); }
    });
  });
  return {
    state,
    start: () => new Promise((r) => { server.keepAliveTimeout = 60_000; server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`)); }),
    stop: () => new Promise((r) => server.close(r)),
    live: () => state.themes.get('gid://shopify/OnlineStoreTheme/1'),
  };
}
