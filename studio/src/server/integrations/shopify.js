import { getSecret, hasSecret } from '../secrets.js';
import { getSettings } from '../store.js';
import { UserError, sleep } from '../util.js';

/**
 * Shopify-Anbindung (offizielle Admin GraphQL API).
 *
 * Zwei Zugangsarten:
 *  A) Theme Access (App „Theme Access“ von Shopify, Passwort shptka_…): nur Themes.
 *     Endpunkt wie bei der Shopify CLI: https://theme-kit-access.shopifyapps.com/cli/admin/api/<v>/graphql.json
 *  B) Eigene App aus dem Shopify Dev Dashboard (Client-ID + Client-Secret, Client-Credentials-Grant,
 *     nur für Shops der eigenen Organisation). Token gilt 24 h und wird automatisch erneuert.
 *     Benötigte Berechtigungen: read/write_themes, read/write_products, read/write_content, read/write_files.
 *
 * Shop-Inhalte (Seiten, Kollektionen, Produkte, Dateien) gehen nur über B.
 */

const THEME_ACCESS_HOST = 'https://theme-kit-access.shopifyapps.com/cli/admin/api';
// Nur für automatische Tests: simulierter Shopify-Server statt echter Endpunkte.
const MOCK = process.env.APOLOGEA_TEST === '1' ? process.env.APOLOGEA_SHOPIFY_MOCK_URL : null;
let adminToken = null; // { token, expiresAt, scopes }

function cfg() {
  const s = getSettings().shop;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s.domain || '')) {
    throw new UserError('Bitte in den Einstellungen die Shop-Adresse im Format name.myshopify.com eintragen.');
  }
  return s;
}

export function connectionKinds() {
  return {
    themeAccess: hasSecret('shopify.themeAccessPassword'),
    adminApp: hasSecret('shopify.clientId') && hasSecret('shopify.clientSecret'),
  };
}

async function getAdminToken(force = false) {
  if (!force && adminToken && adminToken.expiresAt > Date.now() + 5 * 60_000) return adminToken;
  const { domain } = cfg();
  const clientId = await getSecret('shopify.clientId');
  const clientSecret = await getSecret('shopify.clientSecret');
  if (!clientId || !clientSecret) return null;
  const res = await fetchWithTimeout(MOCK ? `${MOCK}/admin/oauth/access_token` : `https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  }, 30_000);
  const text = await res.text();
  if (!res.ok) {
    throw new UserError(`Shopify hat die App-Anmeldung abgelehnt (${res.status}). Bitte Client-ID/Secret prüfen und ob die App im Shop installiert ist.`, { status: 502, details: text.slice(0, 300) });
  }
  const json = JSON.parse(text);
  adminToken = {
    token: json.access_token,
    scopes: String(json.scope || '').split(',').map((s) => s.trim()).filter(Boolean),
    expiresAt: Date.now() + (Number(json.expires_in) || 86_000) * 1000,
  };
  return adminToken;
}

async function fetchWithTimeout(url, opts, ms = 60_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new UserError('Zeitüberschreitung bei der Verbindung zu Shopify.', { status: 504, code: 'timeout' });
    throw new UserError('Keine Verbindung zu Shopify: ' + (err.cause?.code || err.message), { status: 502, code: 'network' });
  } finally {
    clearTimeout(t);
  }
}

/**
 * GraphQL-Aufruf. `need`: 'themes' | 'admin'. Bei Themes wird – falls vorhanden – die Admin-App
 * mit write_themes bevorzugt, sonst Theme Access.
 */
export async function gql(query, variables = {}, { need = 'admin', retries = 3 } = {}) {
  const { domain, apiVersion } = cfg();
  let url;
  let headers;
  const admin = await getAdminToken().catch((err) => { if (need === 'admin') throw err; return null; });
  const adminHasThemes = admin && admin.scopes.some((s) => s === 'write_themes');
  if (need === 'admin' || (need === 'themes' && adminHasThemes)) {
    if (!admin) throw new UserError('Für Shop-Inhalte (Seiten, Kollektionen, Produkte) fehlt die Shopify-Admin-App. Bitte unter Einstellungen → Shopify einrichten.', { status: 412, code: 'missing_admin' });
    url = MOCK ? `${MOCK}/admin/graphql.json` : `https://${domain}/admin/api/${apiVersion}/graphql.json`;
    headers = { 'X-Shopify-Access-Token': admin.token };
  } else {
    const pw = await getSecret('shopify.themeAccessPassword');
    if (!pw) throw new UserError('Für Theme-Änderungen fehlt ein Shopify-Zugang (Theme-Access-Passwort oder Admin-App).', { status: 412, code: 'missing_theme_access' });
    url = MOCK ? `${MOCK}/theme-access/graphql.json` : `${THEME_ACCESS_HOST}/${apiVersion}/graphql.json`;
    headers = { 'X-Shopify-Access-Token': pw, 'X-Shopify-Shop': domain };
  }
  for (let attempt = 0; ; attempt++) {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429 || res.status >= 500) {
      if (attempt < retries) { await sleep(1000 * 2 ** attempt); continue; }
    }
    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      if (need === 'admin' && attempt === 0) { await getAdminToken(true).catch(() => null); continue; }
      throw new UserError(`Shopify verweigert den Zugriff (${res.status}). Zugang und Berechtigungen in den Einstellungen prüfen.`, { status: 502, code: 'auth' });
    }
    let json;
    try { json = JSON.parse(text); } catch { throw new UserError(`Unerwartete Antwort von Shopify (${res.status}).`, { status: 502 }); }
    const throttled = json.errors?.some((e) => e.extensions?.code === 'THROTTLED');
    if (throttled && attempt < retries) { await sleep(1500 * 2 ** attempt); continue; }
    if (json.errors?.length) {
      const denied = json.errors.find((e) => e.extensions?.code === 'ACCESS_DENIED');
      if (denied) throw new UserError(`Fehlende Shopify-Berechtigung: ${denied.message}`, { status: 403, code: 'access_denied' });
      throw new UserError('Shopify-Fehler: ' + json.errors.map((e) => e.message).join('; '), { status: 502 });
    }
    return json.data;
  }
}

function userErrors(payload, what) {
  const errs = payload?.userErrors || [];
  if (errs.length) throw new UserError(`${what}: ` + errs.map((e) => `${e.field ? e.field.join('.') + ': ' : ''}${e.message || e.code}`).join('; '), { status: 422 });
}

export const gid = {
  theme: (id) => (String(id).startsWith('gid://') ? id : `gid://shopify/OnlineStoreTheme/${id}`),
  num: (g) => String(g).split('/').pop(),
};

// ---------------------------------------------------------------- Status

export async function status() {
  const kinds = connectionKinds();
  const out = { configured: kinds.themeAccess || kinds.adminApp, themeAccess: null, adminApp: null };
  if (kinds.adminApp) {
    try {
      const t = await getAdminToken();
      const data = await gql('{ shop { name primaryDomain { url } } }', {}, { need: 'admin' });
      out.adminApp = { ok: true, shop: data.shop.name, url: data.shop.primaryDomain?.url, scopes: t.scopes };
    } catch (err) { out.adminApp = { ok: false, error: err.message }; }
  }
  if (kinds.themeAccess) {
    try {
      const data = await gqlThemeAccessOnly('{ shop { name } themes(first: 20) { nodes { id name role } } }');
      out.themeAccess = { ok: true, shop: data.shop.name, themes: data.themes.nodes.length };
    } catch (err) { out.themeAccess = { ok: false, error: err.message }; }
  }
  out.ok = Boolean(out.adminApp?.ok || out.themeAccess?.ok);
  out.canContent = Boolean(out.adminApp?.ok);
  out.canThemes = Boolean(out.themeAccess?.ok || out.adminApp?.scopes?.includes('write_themes'));
  return out;
}

async function gqlThemeAccessOnly(query) {
  const { domain, apiVersion } = cfg();
  const pw = await getSecret('shopify.themeAccessPassword');
  const res = await fetchWithTimeout(MOCK ? `${MOCK}/theme-access/graphql.json` : `${THEME_ACCESS_HOST}/${apiVersion}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': pw, 'X-Shopify-Shop': domain },
    body: JSON.stringify({ query }),
  }, 30_000);
  if (res.status === 401) throw new UserError('Theme-Access-Passwort wird abgelehnt (401). Bitte in der Theme-Access-App ein neues erzeugen.');
  const json = await res.json();
  if (json.errors?.length) throw new UserError(json.errors.map((e) => e.message).join('; '));
  return json.data;
}

// ---------------------------------------------------------------- Themes

export async function listThemes() {
  const data = await gql('{ themes(first: 50) { nodes { id name role processing processingFailed updatedAt } } }', {}, { need: 'themes' });
  return data.themes.nodes.map((t) => ({ ...t, numericId: gid.num(t.id) }));
}

export async function liveTheme() {
  const themes = await listThemes();
  const main = themes.find((t) => t.role === 'MAIN');
  if (!main) throw new UserError('Kein veröffentlichtes Theme gefunden.');
  return main;
}

export async function listThemeFileNames(themeId) {
  const names = [];
  let after = null;
  for (let i = 0; i < 40; i++) {
    const data = await gql(`query($id: ID!, $after: String) { theme(id: $id) { files(first: 250, after: $after) { nodes { filename size checksumMd5 contentType } pageInfo { hasNextPage endCursor } } } }`,
      { id: gid.theme(themeId), after }, { need: 'themes' });
    const f = data.theme?.files;
    if (!f) throw new UserError('Theme nicht gefunden.');
    names.push(...f.nodes);
    if (!f.pageInfo.hasNextPage) break;
    after = f.pageInfo.endCursor;
  }
  return names;
}

/** Liest Dateien inkl. Inhalt. Rückgabe: Map filename → { content|contentBase64|url, checksumMd5, contentType } */
export async function readThemeFiles(themeId, filenames) {
  const out = {};
  for (let i = 0; i < filenames.length; i += 50) {
    const chunk = filenames.slice(i, i + 50);
    const data = await gql(`query($id: ID!, $names: [String!]) { theme(id: $id) { files(first: 50, filenames: $names) {
      nodes { filename size checksumMd5 contentType updatedAt body {
        __typename ... on OnlineStoreThemeFileBodyText { content } ... on OnlineStoreThemeFileBodyBase64 { contentBase64 } ... on OnlineStoreThemeFileBodyUrl { url } } }
      userErrors { code filename } } } }`, { id: gid.theme(themeId), names: chunk }, { need: 'themes' });
    for (const n of data.theme?.files?.nodes || []) {
      out[n.filename] = {
        filename: n.filename,
        checksumMd5: n.checksumMd5,
        contentType: n.contentType,
        updatedAt: n.updatedAt,
        content: n.body?.content,
        contentBase64: n.body?.contentBase64,
        url: n.body?.url,
      };
    }
  }
  return out;
}

/** files: [{ filename, content } | { filename, contentBase64 }] */
export async function upsertThemeFiles(themeId, files) {
  const input = files.map((f) => ({
    filename: f.filename,
    body: f.contentBase64 !== undefined ? { type: 'BASE64', value: f.contentBase64 } : { type: 'TEXT', value: f.content },
  }));
  const results = [];
  for (let i = 0; i < input.length; i += 25) {
    const data = await gql(`mutation($id: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
      themeFilesUpsert(themeId: $id, files: $files) { upsertedThemeFiles { filename } job { id done } userErrors { field message code filename } } }`,
    { id: gid.theme(themeId), files: input.slice(i, i + 25) }, { need: 'themes' });
    userErrors(data.themeFilesUpsert, 'Theme-Dateien konnten nicht gespeichert werden');
    results.push(...(data.themeFilesUpsert.upsertedThemeFiles || []).map((f) => f.filename));
  }
  return results;
}

export async function duplicateTheme(themeId, name) {
  const data = await gql(`mutation($id: ID!, $name: String) { themeDuplicate(id: $id, name: $name) { newTheme { id name role processing } userErrors { field message code } } }`,
    { id: gid.theme(themeId), name }, { need: 'themes' });
  userErrors(data.themeDuplicate, 'Vorschau-Theme konnte nicht angelegt werden');
  return data.themeDuplicate.newTheme;
}

export async function getTheme(themeId) {
  const data = await gql('query($id: ID!) { theme(id: $id) { id name role processing processingFailed } }', { id: gid.theme(themeId) }, { need: 'themes' });
  return data.theme;
}

export async function waitForThemeReady(themeId, timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await getTheme(themeId);
    if (!t) throw new UserError('Theme nicht gefunden.');
    if (t.processingFailed) throw new UserError('Shopify meldet einen Fehler beim Verarbeiten des Themes.');
    if (!t.processing) return t;
    await sleep(3000);
  }
  throw new UserError('Shopify verarbeitet das Theme noch. Bitte später erneut prüfen.', { code: 'still_processing' });
}

export async function deleteTheme(themeId) {
  const t = await getTheme(themeId);
  if (!t) return true;
  if (t.role === 'MAIN') throw new UserError('Das veröffentlichte Theme wird niemals gelöscht.');
  const data = await gql('mutation($id: ID!) { themeDelete(id: $id) { deletedThemeId userErrors { field message code } } }', { id: gid.theme(themeId) }, { need: 'themes' });
  userErrors(data.themeDelete, 'Theme konnte nicht gelöscht werden');
  return true;
}

export function previewUrl(themeId, pathName = '/') {
  const { domain } = cfg();
  return `https://${domain}${pathName}?preview_theme_id=${gid.num(themeId)}`;
}

export function editorUrl(themeId) {
  const { domain } = cfg();
  return `https://${domain}/admin/themes/${gid.num(themeId)}/editor`;
}

// ---------------------------------------------------------------- Shop-Inhalte (Admin-App)

export async function listPages() {
  const data = await gql('{ pages(first: 100, sortKey: TITLE) { nodes { id title handle isPublished updatedAt templateSuffix } } }');
  return data.pages.nodes;
}

export async function getPage(id) {
  const data = await gql('query($id: ID!) { page(id: $id) { id title handle body isPublished templateSuffix updatedAt } }', { id });
  return data.page;
}

export async function updatePage(id, page) {
  const data = await gql('mutation($id: ID!, $page: PageUpdateInput!) { pageUpdate(id: $id, page: $page) { page { id title handle body isPublished updatedAt } userErrors { field message code } } }', { id, page });
  userErrors(data.pageUpdate, 'Seite konnte nicht gespeichert werden');
  return data.pageUpdate.page;
}

export async function createPage(page) {
  const data = await gql('mutation($page: PageCreateInput!) { pageCreate(page: $page) { page { id title handle body isPublished } userErrors { field message code } } }', { page });
  userErrors(data.pageCreate, 'Seite konnte nicht angelegt werden');
  return data.pageCreate.page;
}

export async function findPageByHandle(handle) {
  const data = await gql('query($q: String!) { pages(first: 5, query: $q) { nodes { id title handle body isPublished } } }', { q: `handle:${handle}` });
  return data.pages.nodes.find((p) => p.handle === handle) || null;
}

export async function listCollections() {
  const data = await gql('{ collections(first: 100, sortKey: TITLE) { nodes { id title handle updatedAt productsCount { count } ruleSet { appliedDisjunctively } } } }');
  return data.collections.nodes.map((c) => ({ ...c, smart: Boolean(c.ruleSet), count: c.productsCount?.count ?? null }));
}

export async function searchProducts(query, first = 25) {
  const data = await gql(`query($q: String, $first: Int!) { products(first: $first, query: $q, sortKey: UPDATED_AT, reverse: true) {
    nodes { id title handle status tags createdAt updatedAt onlineStoreUrl featuredMedia { preview { image { url } } } collections(first: 20) { nodes { id title } } } } }`, { q: query || null, first });
  return data.products.nodes;
}

export async function getProduct(id) {
  const data = await gql(`query($id: ID!) { product(id: $id) { id title handle status tags descriptionHtml createdAt updatedAt onlineStoreUrl
    collections(first: 50) { nodes { id title } } } }`, { id });
  return data.product;
}

export async function updateProduct(product) {
  const data = await gql('mutation($p: ProductUpdateInput!) { productUpdate(product: $p) { product { id title tags collections(first: 50) { nodes { id title } } } userErrors { field message } } }', { p: product });
  userErrors(data.productUpdate, 'Produkt konnte nicht aktualisiert werden');
  return data.productUpdate.product;
}

/** Lädt eine Bilddatei in „Inhalte → Dateien“ hoch und liefert die shopify://shop_images/… Referenz. */
export async function uploadShopImage({ filename, mimeType, buffer, alt }) {
  const staged = await gql(`mutation($input: [StagedUploadInput!]!) { stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } } }`,
    { input: [{ resource: 'IMAGE', filename, mimeType, httpMethod: 'POST', fileSize: String(buffer.length) }] });
  userErrors(staged.stagedUploadsCreate, 'Upload konnte nicht vorbereitet werden');
  const target = staged.stagedUploadsCreate.stagedTargets[0];
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append('file', new Blob([buffer], { type: mimeType }), filename);
  const up = await fetchWithTimeout(target.url, { method: 'POST', body: form }, 120_000);
  if (!up.ok && up.status !== 201 && up.status !== 204) throw new UserError(`Upload zu Shopify fehlgeschlagen (${up.status}).`, { status: 502 });
  const created = await gql(`mutation($files: [FileCreateInput!]!) { fileCreate(files: $files) { files { id alt fileStatus ... on MediaImage { image { url } } } userErrors { field message } } }`,
    { files: [{ originalSource: target.resourceUrl, contentType: 'IMAGE', alt: alt || '', filename }] });
  userErrors(created.fileCreate, 'Datei konnte nicht angelegt werden');
  const file = created.fileCreate.files[0];
  return { id: file.id, reference: `shopify://shop_images/${filename}`, status: file.fileStatus, url: file.image?.url || null };
}
