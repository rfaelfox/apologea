import fs from 'node:fs';
import path from 'node:path';
import { DIRS, insideDir } from '../paths.js';
import { store } from '../store.js';
import { STATUS, UserError, errorMessage, md5, nowIso, safeFileName } from '../util.js';
import { analyzeImage } from '../images.js';
import * as shopify from '../integrations/shopify.js';
import * as ai from '../ai/claude.js';
import { createJob, finishJob, logJob } from './jobs.js';

/**
 * Eigene Bilder für die Produktseite (z. B. eigene Mockups, Fotos, Detailaufnahmen).
 * Ablauf: Bilder anhängen + in eigenen Worten beschreiben, wie sie eingesetzt werden sollen →
 * Claude erstellt einen Plan (Reihenfolge, vorne/hinten, Alt-Texte) → Plan ist Teil der Freigabe →
 * nach dem Veröffentlichen lädt das Programm die Bilder ins Shopify-Produkt (Shopify-Admin-App nötig).
 */

const LOCKED = ['running', 'unknown', 'done'];
const dirOf = (id) => path.join(DIRS.uploads, 'produkte', id);

export function imagePath(draftId, file) {
  const p = path.join(dirOf(draftId), file);
  if (!insideDir(DIRS.uploads, p)) throw new UserError('Ungültiger Pfad.');
  return p;
}

function editable(id) {
  const d = store().products.get(id);
  if (!d) throw new UserError('Produktentwurf nicht gefunden.', { status: 404 });
  if (LOCKED.includes(d.publish?.state)) throw new UserError('Der Entwurf ist gesperrt (veröffentlicht oder in Prüfung).', { status: 409 });
  return d;
}

/** Jede Änderung an Bildern oder Plan hebt eine erteilte Prüfung auf. */
function touched(d) {
  if (d.status === STATUS.APPROVAL || d.status === STATUS.READY) d.status = STATUS.DRAFT;
  d.review = null;
  return d;
}

export function addImage(id, { tmpPath, originalName, mime }) {
  const d = editable(id);
  const buf = fs.readFileSync(tmpPath);
  const a = analyzeImage(buf, originalName);
  if (!['PNG', 'JPEG', 'WebP', 'GIF'].includes(a.format)) throw new UserError('Bitte Bilder als PNG, JPEG, WebP oder GIF anhängen.');
  if (buf.length > 20 * 1024 * 1024) throw new UserError('Bild ist größer als 20 MB – Shopify nimmt es nicht an.');
  fs.mkdirSync(dirOf(id), { recursive: true });
  const imgId = 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const file = `${imgId}-${safeFileName(originalName, 'bild')}`;
  fs.renameSync(tmpPath, path.join(dirOf(id), file));
  const img = { id: imgId, name: originalName, file, mime: a.mime || mime, width: a.width, height: a.height, size: buf.length, md5: md5(buf), preview: null, at: nowIso() };
  return store().products.update(id, (x) => { x.extraImages = [...(x.extraImages || []), img]; x.imagePlan = x.imagePlan ? { ...x.imagePlan, stale: true } : null; return touched(x); });
}

export function setPreview(id, imgId, tmpPath) {
  const d = store().products.get(id);
  const img = d?.extraImages?.find((i) => i.id === imgId);
  if (!img) throw new UserError('Bild nicht gefunden.', { status: 404 });
  const file = `${imgId}-vorschau.jpg`;
  fs.renameSync(tmpPath, path.join(dirOf(id), file));
  return store().products.update(id, (x) => { x.extraImages = x.extraImages.map((i) => (i.id === imgId ? { ...i, preview: file } : i)); return x; });
}

export function removeImage(id, imgId) {
  editable(id);
  return store().products.update(id, (x) => {
    x.extraImages = (x.extraImages || []).filter((i) => i.id !== imgId);
    if (x.imagePlan) x.imagePlan = { ...x.imagePlan, items: x.imagePlan.items.filter((it) => it.imageId !== imgId) };
    return touched(x);
  });
}

function normalizeItems(d, items) {
  const known = new Set((d.extraImages || []).map((i) => i.id));
  const seen = new Set();
  const out = [];
  for (const it of items || []) {
    const imageId = String(it.imageId || it.image_id || '');
    if (!known.has(imageId) || seen.has(imageId)) continue;
    seen.add(imageId);
    out.push({
      imageId,
      use: it.use !== false,
      position: it.position === 'vorne' ? 'vorne' : 'hinten',
      order: Number.isFinite(Number(it.order)) ? Number(it.order) : out.length + 1,
      alt: String(it.alt || '').slice(0, 512),
    });
  }
  return out;
}

/** Plan von Hand anpassen (Reihenfolge, vorne/hinten, Alt-Text, verwenden ja/nein). */
export function setPlan(id, plan) {
  const d = editable(id);
  const items = normalizeItems(d, plan?.items);
  return store().products.update(id, (x) => { x.imagePlan = { ...(x.imagePlan || {}), items, summary: x.imagePlan?.summary || '', source: x.imagePlan?.source || 'manual', edited: true, stale: false, at: nowIso() }; return touched(x); });
}

/** Plan, der tatsächlich ausgeführt wird: gespeicherter Plan, sonst alle Bilder in Reihenfolge hinten anfügen. */
export function effectivePlan(d) {
  const imgs = d.extraImages || [];
  if (!imgs.length) return [];
  const planned = normalizeItems(d, d.imagePlan?.items);
  const missing = imgs.filter((i) => !planned.some((p) => p.imageId === i.id)).map((i, n) => ({ imageId: i.id, use: true, position: 'hinten', order: 1000 + n, alt: '' }));
  const all = [...planned, ...missing].filter((p) => p.use);
  const sorted = [...all.filter((p) => p.position === 'vorne').sort((a, b) => a.order - b.order), ...all.filter((p) => p.position === 'hinten').sort((a, b) => a.order - b.order)];
  return sorted.map((p) => {
    const img = imgs.find((i) => i.id === p.imageId);
    return { imageId: p.imageId, name: img.name, md5: img.md5, position: p.position, alt: p.alt || (d.publicTitle ? `${d.publicTitle}` : img.name) };
  });
}

// ------------------------------------------------------------------ Claude plant den Einsatz der Bilder

const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['summary', 'items', 'questions'],
  properties: {
    summary: { type: 'string' },
    items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['image_id', 'use', 'position', 'order', 'alt'], properties: {
      image_id: { type: 'string' }, use: { type: 'boolean' }, position: { type: 'string', enum: ['vorne', 'hinten'] }, order: { type: 'integer' }, alt: { type: 'string' },
    } } },
    questions: { type: 'array', items: { type: 'string' } },
  },
};

function planRequest(id) {
  const d = store().products.get(id);
  if (!d) throw new UserError('Produktentwurf nicht gefunden.', { status: 404 });
  const imgs = d.extraImages || [];
  if (!imgs.length) throw new UserError('Bitte zuerst Bilder anhängen.');
  if (!d.imageInstruction?.trim()) throw new UserError('Bitte beschreiben, wie die Bilder eingesetzt werden sollen.');
  const system = `Aufgabe: Eigene Bilder (z. B. Mockups, Fotos) für die Shopify-Produktseite von APOLOGEA nach der Anweisung der Inhaberin einplanen.
Für jedes Bild: use (soll es verwendet werden?), position ("vorne" = vor den automatisch erzeugten Mockups des Druckdienstleisters – das erste vordere Bild wird das Hauptbild; "hinten" = danach), order (Reihenfolge innerhalb der Position, ab 1), alt (kurzer, beschreibender deutscher Alternativtext für Barrierefreiheit und Suche; nur beschreiben, was zu sehen ist – nichts erfinden).
Bild-IDs genau so verwenden, wie sie angegeben sind. Unklarheiten unter questions. summary: verständliche deutsche Zusammenfassung.`;
  const parts = [
    { label: 'Anweisung der Inhaberin', data: d.imageInstruction },
    { label: 'Produkt', data: JSON.stringify({ titel: d.publicTitle, grundprodukt: d.baseProduct?.title || null }) },
    { label: 'Bilder', data: imgs.map((i, n) => `${i.id}: Bild ${n + 1} „${i.name}“ (${i.width || '?'} × ${i.height || '?'} px)`).join('\n') },
  ];
  for (const i of imgs) {
    const p = imagePath(id, i.preview || i.file);
    if (i.preview || fs.statSync(p).size < 4_500_000) parts.push({ imagePath: p, mime: i.preview ? 'image/jpeg' : i.mime, label: `${i.id}: ${i.name}` });
  }
  return { system, parts, maxOutputTokens: 4000, imageDirs: [dirOf(id)] };
}

export async function estimatePlan(id) {
  const r = planRequest(id);
  return ai.estimate({ system: r.system, parts: r.parts, maxOutputTokens: r.maxOutputTokens });
}

export async function planWithClaude(id, { confirmPaid } = {}) {
  editable(id);
  ai.requirePaidConfirmation(confirmPaid);
  const r = planRequest(id);
  const job = createJob({ type: 'ai.images', title: 'Produktbilder mit Claude einplanen', refType: 'product', refId: id });
  try {
    const out = await ai.generateJson({ ...r, schema: PLAN_SCHEMA, effort: 'low' });
    const d = store().products.get(id);
    const items = normalizeItems(d, out.data.items);
    const updated = store().products.update(id, (x) => { x.imagePlan = { items, summary: out.data.summary, questions: out.data.questions || [], source: 'claude', stale: false, at: nowIso(), cost: { usd: out.costUsd, engine: out.engine } }; return touched(x); });
    finishJob(job.id, STATUS.SUCCESS, { result: { costUsd: out.costUsd, engine: out.engine }, msg: 'Bilder eingeplant (noch nichts hochgeladen)' });
    return updated;
  } catch (err) {
    finishJob(job.id, STATUS.FAILED, { error: errorMessage(err) });
    throw err;
  }
}

// ------------------------------------------------------------------ Nach dem Veröffentlichen: in Shopify einpflegen

export async function applyToShopify(productGid, draft, items, jobId) {
  if (!items.length) return null;
  const files = items.map((it) => {
    const img = (draft.extraImages || []).find((i) => i.id === it.imageId);
    const buf = fs.readFileSync(imagePath(draft.id, img.file));
    if (md5(buf) !== it.md5) throw new UserError(`Bild „${img.name}“ wurde nach der Freigabe verändert.`);
    return { filename: safeFileName(img.name, 'bild'), mimeType: img.mime, buffer: buf, alt: it.alt, position: it.position };
  });
  logJob(jobId, `${files.length} eigene Bild(er) werden ins Shopify-Produkt geladen …`);
  const media = await shopify.addProductImages(productGid, files);
  const front = media.filter((_, n) => files[n].position === 'vorne');
  if (front.length) {
    await shopify.reorderProductMedia(productGid, front.map((m, n) => ({ id: m.id, newPosition: String(n) })));
    logJob(jobId, `${front.length} Bild(er) nach vorne gestellt (erstes = Hauptbild).`);
  }
  logJob(jobId, 'Eigene Bilder in Shopify angelegt.');
  return { ok: true, count: media.length, message: `${media.length} eigene Bild(er) eingepflegt${front.length ? `, ${front.length} davon vorne` : ''}.` };
}
