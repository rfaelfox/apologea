// Simulation der Printful-API mit ERFUNDENEN Beispieldaten (nur zum Ausprobieren des Ablaufs).
// Struktur entspricht der Printful-API v1 ({ code, result }); Inhalte sind keine echten Katalogdaten.
const ok = (result) => ({ code: 200, result });
let next = 1;
const tasks = new Map();

export async function printfulSim(method, path, body) {
  let m;
  if (method === 'GET' && path === '/stores') return ok([
    { id: 11, name: 'APOLOGEA Shopify (Beispiel)', type: 'shopify' },
    { id: 12, name: 'Manual/API-Shop (Beispiel)', type: 'native' },
  ]);
  if (method === 'GET' && path === '/products') return ok([{ id: 7001, title: 'Beispiel: Heavyweight T-Shirt', brand: 'Beispielmarke', image: '' }]);
  if (method === 'GET' && (m = path.match(/^\/products\/(\d+)$/))) {
    const variants = [];
    let id = 70010;
    for (const [color, code] of [['Schwarz', '#0b0b0b'], ['Sand', '#d8c8a8']]) for (const size of ['S', 'M', 'L', 'XL']) variants.push({ id: id++, size, color, color_code: code, price: '13.95', in_stock: true, image: '' });
    return ok({ product: { id: Number(m[1]), title: 'Beispiel: Heavyweight T-Shirt', description: 'Beispieldaten – kein echter Katalogtext.' }, variants });
  }
  if (method === 'GET' && (m = path.match(/^\/mockup-generator\/printfiles\/(\d+)$/))) {
    return ok({ printfiles: [{ printfile_id: 1, width: 3600, height: 4800, dpi: 300 }], variant_printfiles: [{ variant_id: 70010, placements: { front: 1, back: 1 } }], available_placements: { front: 'Vorderseite', back: 'Rückseite' } });
  }
  if (method === 'GET' && (m = path.match(/^\/files\/(\w+)$/))) return ok({ id: m[1], filename: `beispiel-${m[1]}.png`, url: 'https://example.invalid/datei.png', preview_url: '', width: 3600, height: 4800 });
  if (method === 'POST' && path.startsWith('/mockup-generator/create-task/')) { const key = 'sim-task-' + next++; tasks.set(key, true); return ok({ task_key: key, status: 'pending' }); }
  if (method === 'GET' && path.startsWith('/mockup-generator/task')) return ok({ status: 'completed', mockups: [{ placement: 'front', mockup_url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>' }] });
  if (method === 'POST' && path === '/store/products') return ok({ id: 'sim-pf-' + next++, external_id: 'sim' });
  if (method === 'GET' && path.startsWith('/store/products/')) return ok({ id: path.split('/').pop() });
  throw Object.assign(new Error('Simulation: Pfad nicht unterstützt: ' + method + ' ' + path), { code: 'tool_error' });
}
