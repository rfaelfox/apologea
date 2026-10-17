// Simulation der Printify-API mit ERFUNDENEN Beispieldaten (nur zum Ausprobieren des Ablaufs).
// Struktur entspricht der Printify-API v1; Inhalte, IDs und Maße sind keine echten Katalogdaten.
const products = new Map();
let nextId = 1;
const uploads = [];

const blueprints = [
  { id: 9001, title: 'Beispiel: Oversized T-Shirt', brand: 'Beispielmarke', model: 'OS-1', description: 'Beispieldaten – kein echter Katalogtext.', images: [] },
  { id: 9002, title: 'Beispiel: Hoodie', brand: 'Beispielmarke', model: 'HD-1', description: 'Beispieldaten – kein echter Katalogtext.', images: [] },
];
const providers = { 9001: [{ id: 501, title: 'Beispiel-Druckerei', location: { country: 'DE' } }], 9002: [{ id: 501, title: 'Beispiel-Druckerei', location: { country: 'DE' } }] };
function variants(bp) {
  const out = [];
  let id = bp * 10;
  for (const color of ['Schwarz', 'Weiß']) for (const size of ['S', 'M', 'L', 'XL']) {
    out.push({ id: id++, title: `${color} / ${size}`, options: { color, size }, placeholders: [{ position: 'front', width: 3600, height: 4800 }, { position: 'back', width: 3600, height: 4800 }], is_available: true });
  }
  return out;
}

export async function printifySim(method, path, body) {
  let m;
  if (method === 'GET' && path === '/shops.json') return [{ id: 777, title: 'APOLOGEA (Beispiel)', sales_channel: 'shopify' }];
  if (method === 'GET' && path === '/catalog/blueprints.json') return blueprints;
  if (method === 'GET' && (m = path.match(/^\/catalog\/blueprints\/(\d+)\/print_providers\.json$/))) return providers[m[1]] || [];
  if (method === 'GET' && (m = path.match(/^\/catalog\/blueprints\/(\d+)\.json$/))) return blueprints.find((b) => String(b.id) === m[1]);
  if (method === 'GET' && (m = path.match(/^\/catalog\/blueprints\/(\d+)\/print_providers\/(\d+)\/variants\.json/))) return { id: Number(m[2]), variants: variants(Number(m[1])) };
  if (method === 'GET' && path.startsWith('/uploads.json')) return { data: uploads };
  if (method === 'POST' && path === '/uploads/images.json') { const u = { id: 'sim-up-' + (uploads.length + 1), file_name: body.file_name, preview_url: '' }; uploads.push(u); return u; }
  if (method === 'POST' && (m = path.match(/^\/shops\/(\d+)\/products\.json$/))) {
    if (process.env.APOLOGEA_TEST === '1' && process.env.APOLOGEA_SIM_FAIL === 'network') throw Object.assign(new Error('Verbindung unterbrochen (Test)'), { code: 'network' });
    const id = 'sim-prod-' + nextId++;
    products.set(id, { id, ...body, images: [{ src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', position: 'front', is_default: true }], external: null });
    return { id };
  }
  if ((m = path.match(/^\/shops\/(\d+)\/products\/([\w-]+)\.json$/))) {
    const p = products.get(m[2]);
    if (!p) throw Object.assign(new Error('Produkt nicht gefunden'), { code: 'tool_error' });
    if (method === 'PUT') { Object.assign(p, body); return { id: p.id }; }
    return p;
  }
  if (method === 'POST' && (m = path.match(/^\/shops\/(\d+)\/products\/([\w-]+)\/publish\.json$/))) {
    const p = products.get(m[2]);
    p.external = { id: 'sim-shopify-' + m[2], handle: '' };
    return {};
  }
  throw Object.assign(new Error('Simulation: Pfad nicht unterstützt: ' + method + ' ' + path), { code: 'tool_error' });
}
