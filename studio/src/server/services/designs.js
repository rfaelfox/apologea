import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, insideDir } from '../paths.js';
import { store } from '../store.js';
import { UserError, safeFileName } from '../util.js';
import { analyzeImage } from '../images.js';

/**
 * Designbibliothek. Importierte Dateien werden in den verwalteten Datenordner KOPIERT.
 * Die Originaldatei an ihrem ursprünglichen Ort wird nie verändert oder gelöscht.
 */

export function designDir(design) {
  return path.join(DIRS.designs, design.folder);
}

export function designFilePath(design) {
  const p = path.join(designDir(design), design.file);
  if (!insideDir(DIRS.designs, p)) throw new UserError('Ungültiger Dateipfad.');
  return p;
}

export function importDesign({ tmpPath, originalName, name, motif, collection, tags }) {
  const buf = fs.readFileSync(tmpPath);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const duplicate = store().designs.list((d) => d.sha256 === sha256)[0] || null;
  const analysis = analyzeImage(buf, originalName);
  if (analysis.format === 'unbekannt') throw new UserError('Dateiformat nicht erkannt. Unterstützt: PNG, JPEG, SVG, WebP, GIF.');
  const base = safeFileName(originalName, 'design');
  const draft = store().designs.put({
    name: (name || path.parse(base).name).slice(0, 120),
    motif: motif || '',
    collection: collection || '',
    tags: Array.isArray(tags) ? tags : [],
    originalName: base,
    sha256,
    analysis,
    marketprint: null,
    thumbnail: null,
  });
  const folder = `${safeFileName(draft.name, 'design').replace(/\s+/g, '-').slice(0, 40)}-${draft.id}`;
  const dir = path.join(DIRS.designs, folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.renameSync(tmpPath, path.join(dir, base));
  const saved = store().designs.put({ ...draft, folder, file: base });
  return { design: saved, duplicateOf: duplicate ? { id: duplicate.id, name: duplicate.name } : null };
}

export function saveThumbnail(id, tmpPath) {
  const d = store().designs.get(id);
  if (!d) throw new UserError('Design nicht gefunden.', { status: 404 });
  const target = path.join(designDir(d), 'vorschau.png');
  fs.renameSync(tmpPath, target);
  return store().designs.put({ ...d, thumbnail: 'vorschau.png' });
}

export function updateDesign(id, patch) {
  const d = store().designs.get(id);
  if (!d) throw new UserError('Design nicht gefunden.', { status: 404 });
  const allowed = ['name', 'motif', 'collection', 'tags', 'notes'];
  for (const k of allowed) if (patch[k] !== undefined) d[k] = patch[k];
  return store().designs.put(d);
}

/** Verknüpfung eines Designs mit der Datei-/Bild-ID bei einem Anbieter. */
export function getLink(design, provider) {
  if (!design) return null;
  if (provider === 'marketprint') return design.marketprint || design.providerLinks?.marketprint || null;
  return design.providerLinks?.[provider] || null;
}

export function linkProvider(id, provider, { imageId, fileName, previewUrl }) {
  const d = store().designs.get(id);
  if (!d) throw new UserError('Design nicht gefunden.', { status: 404 });
  if (!imageId) throw new UserError('Bild-/Datei-ID fehlt.');
  const link = { imageId: String(imageId), fileName: fileName || null, previewUrl: previewUrl || null, linkedAt: new Date().toISOString() };
  d.providerLinks = { ...(d.providerLinks || {}), [provider]: link };
  if (provider === 'marketprint') d.marketprint = link; // Kompatibilität mit älteren Daten
  return store().designs.put(d);
}

export function linkMarketPrint(id, data) {
  return linkProvider(id, 'marketprint', data);
}

export function listDesigns({ q, motif, collection } = {}) {
  const needle = (q || '').toLowerCase().trim();
  const products = store().products.list();
  return store().designs.list((d) => {
    if (needle && !`${d.name} ${d.originalName} ${(d.tags || []).join(' ')}`.toLowerCase().includes(needle)) return false;
    if (motif && d.motif !== motif) return false;
    if (collection && d.collection !== collection) return false;
    return true;
  }).map((d) => ({
    ...d,
    usedIn: products.filter((p) => (p.placements || []).some((pl) => pl.designId === d.id || pl.alternative?.designId === d.id)).map((p) => ({ id: p.id, name: p.internalName || p.publicTitle || 'Entwurf', status: p.status })),
  }));
}

/** Entfernt nur die verwaltete Kopie im Datenordner – nach ausdrücklicher Bestätigung. */
export function deleteDesign(id, { confirm } = {}) {
  const d = store().designs.get(id);
  if (!d) return false;
  if (!confirm) throw new UserError('Löschen muss bestätigt werden.');
  const inUse = store().products.list((p) => (p.placements || []).some((pl) => pl.designId === id || pl.alternative?.designId === id));
  if (inUse.length) throw new UserError(`Das Design wird noch in ${inUse.length} Produktentwurf/-entwürfen verwendet.`);
  const dir = designDir(d);
  if (insideDir(DIRS.designs, dir)) fs.rmSync(dir, { recursive: true, force: true });
  store().designs.remove(id);
  return true;
}
