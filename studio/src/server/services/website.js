import fs from 'node:fs';
import path from 'node:path';
import { diffLines } from 'diff';
import { DIRS, insideDir } from '../paths.js';
import { store, getSettings } from '../store.js';
import { STATUS, UserError, errorMessage, md5, nowIso, safeFileName, stableHash } from '../util.js';
import * as shopify from '../integrations/shopify.js';
import * as ai from '../ai/claude.js';
import { createJob, finishJob, logJob } from './jobs.js';

/**
 * Website bearbeiten.
 * Unterscheidung:
 *  - Theme-Änderungen (Dateien des veröffentlichten Themes) → Vorschau in einer Theme-Kopie, dann Übernahme.
 *  - Shop-Inhalte (Seiten, Kollektionszuordnungen) → Vorher-nachher-Ansicht, dann Übernahme.
 * Vor jeder Übernahme werden die betroffenen Originale gesichert; Wiederherstellung ist möglich.
 */

export const TEMPLATE_LABELS = {
  'templates/index.json': 'Startseite',
  'templates/product.json': 'Produktseite',
  'templates/collection.json': 'Kollektionsseite',
  'templates/list-collections.json': 'Alle Kollektionen',
  'templates/page.json': 'Standard-Inhaltsseite',
  'templates/cart.json': 'Warenkorb',
  'templates/search.json': 'Suche',
  'templates/blog.json': 'Blog',
  'templates/article.json': 'Blogbeitrag',
  'templates/404.json': 'Seite nicht gefunden (404)',
  'templates/password.json': 'Passwortseite',
  'sections/header-group.json': 'Kopfbereich (Header)',
  'sections/footer-group.json': 'Fußbereich (Footer)',
  'config/settings_data.json': 'Theme-Einstellungen: Farben, Schriften, Abstände',
};

const ALLOWED_NEW_PREFIXES = ['templates/', 'sections/', 'snippets/', 'assets/', 'blocks/'];
const MAX_CONTEXT_CHARS = 180_000;

export async function listAreas() {
  const areas = [];
  const st = { theme: null, content: null };
  try {
    const live = await shopify.liveTheme();
    st.theme = { id: live.id, name: live.name };
    const files = await shopify.listThemeFileNames(live.id);
    for (const f of files) {
      const label = TEMPLATE_LABELS[f.filename] || (f.filename.startsWith('templates/') && f.filename.endsWith('.json') ? 'Vorlage: ' + f.filename.slice(10, -5) : null);
      if (label) areas.push({ key: `theme:${f.filename}`, kind: 'theme', label, file: f.filename, group: 'Theme „' + live.name + '“' });
    }
    areas.push({ key: 'theme:new-landing', kind: 'theme', label: 'Neue Landingpage anlegen', group: 'Theme „' + live.name + '“' });
  } catch (err) { st.themeError = errorMessage(err); }
  if (shopify.connectionKinds().adminApp) {
    try {
      const pages = await shopify.listPages();
      for (const p of pages) areas.push({ key: `page:${p.id}`, kind: 'content', label: `Seite: ${p.title}`, pageId: p.id, group: 'Shop-Inhalte' });
      areas.push({ key: 'collections', kind: 'content', label: 'Kollektionen: Produkte zuordnen', group: 'Shop-Inhalte' });
      st.content = true;
    } catch (err) { st.contentError = errorMessage(err); }
  } else {
    st.contentError = 'Für Seiten und Kollektionen wird die Shopify-Admin-App benötigt.';
  }
  areas.push({ key: 'auto', kind: 'auto', label: 'Weiß ich nicht – Claude soll den Bereich bestimmen', group: 'Allgemein' });
  return { areas, ...st };
}

// ------------------------------------------------------------------ Entwürfe

export function createDraft({ title, areaKey, request }) {
  return store().websiteDrafts.put({ title: title || 'Neue Website-Änderung', areaKey: areaKey || 'auto', request: request || '', attachments: [], status: STATUS.DRAFT, proposal: null, preview: null, apply: { state: 'none' }, backups: [] });
}

export function saveDraft(id, patch) {
  const d = store().websiteDrafts.get(id);
  if (!d) throw new UserError('Entwurf nicht gefunden.', { status: 404 });
  if (['running', 'unknown'].includes(d.apply?.state)) throw new UserError('Während der Ausführung gesperrt.', { status: 409 });
  if (d.apply?.state === 'done') throw new UserError('Diese Änderung wurde bereits übernommen. Für weitere Änderungen bitte einen neuen Entwurf anlegen.', { status: 409 });
  for (const k of ['title', 'areaKey', 'request']) if (patch[k] !== undefined) d[k] = String(patch[k]);
  if (patch.request !== undefined || patch.areaKey !== undefined) {
    if (d.proposal) { d.proposal.stale = true; }
    d.review = null;
    if (d.status !== STATUS.DRAFT) d.status = STATUS.DRAFT;
  }
  return store().websiteDrafts.put(d);
}

export function addAttachment(id, { tmpPath, originalName, mime, previewTmp }) {
  const d = store().websiteDrafts.get(id);
  if (!d) throw new UserError('Entwurf nicht gefunden.', { status: 404 });
  const dir = path.join(DIRS.uploads, id);
  fs.mkdirSync(dir, { recursive: true });
  const attId = 'a' + Date.now().toString(36);
  const name = `${attId}-${safeFileName(originalName, 'bild')}`;
  fs.renameSync(tmpPath, path.join(dir, name));
  const att = { id: attId, name: originalName, file: name, mime, size: fs.statSync(path.join(dir, name)).size, preview: null };
  d.attachments.push(att);
  return store().websiteDrafts.put(d);
}

export function setAttachmentPreview(id, attId, tmpPath) {
  const d = store().websiteDrafts.get(id);
  const att = d?.attachments.find((a) => a.id === attId);
  if (!att) throw new UserError('Anhang nicht gefunden.', { status: 404 });
  const file = `${attId}-vorschau.jpg`;
  fs.renameSync(tmpPath, path.join(DIRS.uploads, id, file));
  att.preview = file;
  return store().websiteDrafts.put(d);
}

export function removeAttachment(id, attId) {
  const d = store().websiteDrafts.get(id);
  if (!d) throw new UserError('Entwurf nicht gefunden.', { status: 404 });
  d.attachments = d.attachments.filter((a) => a.id !== attId);
  return store().websiteDrafts.put(d);
}

export function attachmentPath(draftId, file) {
  const p = path.join(DIRS.uploads, draftId, file);
  if (!insideDir(DIRS.uploads, p)) throw new UserError('Ungültiger Pfad.');
  return p;
}

export async function deleteDraft(id, { confirm } = {}) {
  const d = store().websiteDrafts.get(id);
  if (!d) return false;
  if (!confirm) throw new UserError('Löschen muss bestätigt werden.');
  if (d.apply?.state === 'running') throw new UserError('Läuft gerade.', { status: 409 });
  return store().websiteDrafts.remove(id);
}

// ------------------------------------------------------------------ Vorschlag mit Claude

const PROPOSAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['understood_request', 'summary', 'kind', 'theme_files', 'content_ops', 'asset_uploads', 'limitations', 'questions'],
  properties: {
    understood_request: { type: 'string' },
    summary: { type: 'string' },
    kind: { type: 'string', enum: ['theme', 'content', 'mixed', 'not_possible'] },
    theme_files: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['filename', 'new_content', 'explanation'], properties: { filename: { type: 'string' }, new_content: { type: 'string' }, explanation: { type: 'string' } } },
    },
    content_ops: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['op', 'page_id', 'title', 'handle', 'body_html', 'template_suffix', 'collection_id', 'product_ids', 'explanation'],
        properties: {
          op: { type: 'string', enum: ['page_update', 'page_create', 'collection_add_products'] },
          page_id: { type: 'string' }, title: { type: 'string' }, handle: { type: 'string' }, body_html: { type: 'string' }, template_suffix: { type: 'string' },
          collection_id: { type: 'string' }, product_ids: { type: 'array', items: { type: 'string' } }, explanation: { type: 'string' },
        },
      },
    },
    asset_uploads: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['attachment_id', 'target', 'filename'], properties: { attachment_id: { type: 'string' }, target: { type: 'string', enum: ['shop_file', 'theme_asset'] }, filename: { type: 'string' } } },
    },
    limitations: { type: 'array', items: { type: 'string' } },
    questions: { type: 'array', items: { type: 'string' } },
  },
};

const PROPOSAL_SYSTEM = `Aufgabe: Eine Änderungswunsch-Beschreibung für den BESTEHENDEN Shopify-Shop von APOLOGEA in einen konkreten, minimalen Änderungsvorschlag übersetzen.
Regeln:
- Ändere nur, was für den Wunsch nötig ist. Ersetze niemals das ganze Theme oder den Shop.
- Theme-Dateien: gib für jede geänderte Datei den VOLLSTÄNDIGEN neuen Inhalt zurück (new_content). JSON-Vorlagen müssen gültiges JSON bleiben; einen vorhandenen /* … */-Kommentarkopf darfst du weglassen. Nur Dateien ändern, die dir unter <daten> gezeigt wurden, oder neue Dateien unter templates/, sections/, snippets/, assets/ anlegen.
- Bilder aus Anhängen: in asset_uploads eintragen. target "shop_file" (für Bild-Einstellungen in JSON-Vorlagen, Referenz im Inhalt als __STUDIO_FILE_<attachment_id>__ einsetzen; wird durch shopify://shop_images/<dateiname> ersetzt) oder "theme_asset" (Datei unter assets/<filename>, in Liquid über {{ '<filename>' | asset_url }}).
- Shop-Inhalte (Seiten, Kollektionen) über content_ops. Für Felder, die eine Operation nicht braucht, leere Zeichenkette bzw. leere Liste.
- Neue Landingpage: neue Vorlage templates/page.<name>.json + content_op page_create mit template_suffix <name> (die Seite wird unveröffentlicht angelegt).
- Wenn etwas mit den verfügbaren Schnittstellen nicht geht oder Angaben fehlen: kind "not_possible" bzw. limitations/questions ausfüllen. Nichts erfinden (keine Preise, Bibelzitate, Fakten).
- summary: verständliche deutsche Zusammenfassung für eine Nicht-Programmiererin.`;

async function buildContext(draft) {
  const parts = [];
  const caps = await capabilities();
  const area = draft.areaKey || 'auto';
  let live = null;
  let files = [];
  if (caps.themes) {
    live = await shopify.liveTheme();
    files = await shopify.listThemeFileNames(live.id);
  }
  const want = new Set();
  if (area.startsWith('theme:') && area !== 'theme:new-landing') want.add(area.slice(6));
  if (area === 'theme:new-landing') { want.add('templates/page.json'); }
  if (area === 'auto' && caps.themes) { want.add('templates/index.json'); want.add('sections/header-group.json'); want.add('sections/footer-group.json'); }
  if (/farb|color|schrift|font/i.test(draft.request) && caps.themes) { want.add('config/settings_data.json'); }
  let fileData = {};
  if (caps.themes && want.size) {
    const names = files.map((f) => f.filename);
    // Abschnitte, die in den gewählten JSON-Vorlagen verwendet werden, mitliefern (Schema für erlaubte Einstellungen).
    fileData = await shopify.readThemeFiles(live.id, [...want].filter((w) => names.includes(w)));
    const sectionTypes = new Set();
    for (const f of Object.values(fileData)) {
      if (f.filename.endsWith('.json') && f.content) {
        try { for (const s of Object.values(JSON.parse(stripJsonComment(f.content)).sections || {})) if (s.type) sectionTypes.add(s.type); } catch { /* ignorieren */ }
      }
    }
    const sectionFiles = [...sectionTypes].map((t) => `sections/${t}.liquid`).filter((n) => names.includes(n)).slice(0, 12);
    Object.assign(fileData, await shopify.readThemeFiles(live.id, sectionFiles));
    if (want.has('config/settings_data.json') && names.includes('config/settings_schema.json')) Object.assign(fileData, await shopify.readThemeFiles(live.id, ['config/settings_schema.json']));
  }
  let size = 0;
  for (const f of Object.values(fileData)) {
    if (f.content === undefined) continue;
    let content = f.content;
    if (size + content.length > MAX_CONTEXT_CHARS) content = content.slice(0, Math.max(0, MAX_CONTEXT_CHARS - size)) + '\n…(gekürzt)';
    size += content.length;
    parts.push({ label: `Theme-Datei ${f.filename}`, data: content });
  }
  if (caps.themes) parts.push({ label: 'Alle Dateinamen des veröffentlichten Themes', data: files.map((f) => f.filename).join('\n') });
  let pageData = null;
  if (area.startsWith('page:') && caps.content) {
    pageData = await shopify.getPage(area.slice(5));
    parts.push({ label: `Shop-Seite ${pageData.title} (id ${pageData.id}, handle ${pageData.handle})`, data: pageData.body || '' });
  }
  if ((area === 'collections' || /kollektion/i.test(draft.request)) && caps.content) {
    const cols = await shopify.listCollections();
    const prods = await shopify.searchProducts(null, 100);
    parts.push({ label: 'Kollektionen (id, Titel, automatisch?)', data: cols.map((c) => `${c.id} | ${c.title} | ${c.smart ? 'automatisch (Regeln) – keine manuelle Zuordnung möglich' : 'manuell'}`).join('\n') });
    parts.push({ label: 'Produkte (id, Titel)', data: prods.map((p) => `${p.id} | ${p.title}`).join('\n') });
  }
  parts.push({ label: 'Verfügbare Schnittstellen', data: `Theme-Dateien ändern: ${caps.themes ? 'ja' : 'nein'}\nShop-Inhalte (Seiten/Kollektionen/Dateien): ${caps.content ? 'ja' : 'nein'}` });
  const imgs = draft.attachments.filter((a) => /^image\//.test(a.mime));
  for (const a of imgs) {
    const p = attachmentPath(draft.id, a.preview || a.file);
    if (a.preview || fs.statSync(p).size < 4_500_000) parts.push({ imagePath: p, mime: a.preview ? 'image/jpeg' : a.mime, label: `Anhang ${a.id}: ${a.name}` });
  }
  if (draft.attachments.length) parts.push({ label: 'Anhänge', data: draft.attachments.map((a) => `${a.id}: ${a.name} (${a.mime})`).join('\n') });
  parts.unshift({ text: `Bereich: ${area}\nTitel: ${draft.title}` }, { label: 'Wunsch der Inhaberin', data: draft.request });
  return { parts, live, fileData, pageData, caps };
}

export async function capabilities() {
  const kinds = shopify.connectionKinds();
  return { themes: kinds.themeAccess || kinds.adminApp, content: kinds.adminApp };
}

export async function estimateProposal(id) {
  const d = store().websiteDrafts.get(id);
  if (!d) throw new UserError('Entwurf nicht gefunden.', { status: 404 });
  if (!d.request?.trim()) throw new UserError('Bitte zuerst beschreiben, was geändert werden soll.');
  const { parts } = await buildContext(d);
  return ai.estimate({ system: PROPOSAL_SYSTEM, parts, maxOutputTokens: 48000 });
}

export async function createProposal(id, { confirmPaid } = {}) {
  const d = store().websiteDrafts.get(id);
  if (!d) throw new UserError('Entwurf nicht gefunden.', { status: 404 });
  if (!d.request?.trim()) throw new UserError('Bitte zuerst beschreiben, was geändert werden soll.');
  if (d.apply?.state === 'done') throw new UserError('Bereits übernommen.', { status: 409 });
  ai.requirePaidConfirmation(confirmPaid);
  const job = createJob({ type: 'website.propose', title: `Änderungsvorschlag: ${d.title}`, refType: 'website', refId: id });
  try {
    const ctx = await buildContext(d);
    logJob(job.id, `Kontext: ${ctx.parts.length} Teile`);
    const out = await ai.generateJson({ system: PROPOSAL_SYSTEM, parts: ctx.parts, schema: PROPOSAL_SCHEMA, maxOutputTokens: 48000, effort: 'medium', imageDirs: [path.join(DIRS.uploads, id)] });
    const proposal = await normalizeProposal(d, out.data, ctx);
    proposal.cost = { usd: out.costUsd, engine: out.engine, model: out.model };
    store().websiteDrafts.update(id, (x) => { x.proposal = proposal; x.status = proposal.blocking.length ? STATUS.MISSING : STATUS.READY; x.review = null; return x; });
    finishJob(job.id, STATUS.SUCCESS, { result: { costUsd: out.costUsd, files: proposal.themeFiles.length, ops: proposal.contentOps.length }, msg: 'Vorschlag erstellt (noch nichts geändert)' });
    return store().websiteDrafts.get(id);
  } catch (err) {
    finishJob(job.id, STATUS.FAILED, { error: errorMessage(err) });
    throw err;
  }
}

export function stripJsonComment(s) {
  return String(s).replace(/^﻿?\s*\/\*[\s\S]*?\*\/\s*/, '');
}

/** Prüft und vereinheitlicht den Vorschlag; berechnet Vorher-nachher-Unterschiede. */
export async function normalizeProposal(draft, data, ctx) {
  const blocking = [];
  const warnings = [...(data.limitations || [])];
  const liveNames = new Set();
  if (ctx.live) for (const f of await shopify.listThemeFileNames(ctx.live.id)) liveNames.add(f.filename);
  const themeFiles = [];
  const existing = ctx.live ? await shopify.readThemeFiles(ctx.live.id, (data.theme_files || []).map((f) => f.filename).filter((n) => liveNames.has(n))) : {};
  for (const f of data.theme_files || []) {
    const name = String(f.filename || '').replace(/^\/+/, '');
    if (!/^[\w./-]+$/.test(name) || name.includes('..')) { blocking.push(`Ungültiger Dateiname: ${name}`); continue; }
    const exists = liveNames.has(name);
    if (!exists && !ALLOWED_NEW_PREFIXES.some((p) => name.startsWith(p))) { blocking.push(`Neue Datei an nicht erlaubtem Ort: ${name}`); continue; }
    if (name.startsWith('layout/')) warnings.push(`Achtung: Änderung am Grundlayout (${name}).`);
    if (name.endsWith('.json')) {
      try { JSON.parse(stripJsonComment(f.new_content)); } catch (e) { blocking.push(`${name}: kein gültiges JSON (${e.message}).`); }
    }
    const before = exists ? (existing[name]?.content ?? null) : '';
    if (exists && before === null) { blocking.push(`${name} ist eine Binärdatei und kann nicht als Text geändert werden.`); continue; }
    const diff = diffLines(before || '', f.new_content).map((p) => ({ t: p.added ? '+' : p.removed ? '-' : '=', v: p.value }));
    themeFiles.push({ filename: name, isNew: !exists, explanation: f.explanation, newContent: f.new_content, beforeChecksum: exists ? existing[name]?.checksumMd5 : null, beforeContent: before, diff, changedLines: diff.filter((x) => x.t !== '=').reduce((n, x) => n + x.v.split('\n').length - 1, 0) });
  }
  const contentOps = [];
  for (const op of data.content_ops || []) {
    if (!ctx.caps.content) { blocking.push('Shop-Inhalte ändern erfordert die Shopify-Admin-App.'); break; }
    if (op.op === 'page_update') {
      const page = await shopify.getPage(op.page_id).catch(() => null);
      if (!page) { blocking.push(`Seite ${op.page_id} nicht gefunden.`); continue; }
      const newBody = op.body_html || page.body;
      contentOps.push({ op: 'page_update', pageId: page.id, title: op.title || page.title, before: { title: page.title, body: page.body, updatedAt: page.updatedAt }, after: { title: op.title || page.title, body: newBody }, diff: diffLines(page.body || '', newBody).map((p) => ({ t: p.added ? '+' : p.removed ? '-' : '=', v: p.value })), explanation: op.explanation });
    } else if (op.op === 'page_create') {
      contentOps.push({ op: 'page_create', title: op.title, handle: op.handle, body: op.body_html, templateSuffix: op.template_suffix, explanation: op.explanation, published: false });
    } else if (op.op === 'collection_add_products') {
      const cols = await shopify.listCollections();
      const col = cols.find((c) => c.id === op.collection_id);
      if (!col) { blocking.push(`Kollektion ${op.collection_id} nicht gefunden.`); continue; }
      if (col.smart) { blocking.push(`„${col.title}“ ist eine automatische Kollektion – Produkte werden dort über Regeln zugeordnet, nicht manuell.`); continue; }
      const products = [];
      for (const pid of op.product_ids || []) { const p = await shopify.getProduct(pid).catch(() => null); if (p) products.push({ id: p.id, title: p.title, alreadyIn: p.collections.nodes.some((n) => n.id === col.id) }); else blocking.push(`Produkt ${pid} nicht gefunden.`); }
      contentOps.push({ op: 'collection_add_products', collectionId: col.id, collectionTitle: col.title, products, explanation: op.explanation });
    }
  }
  const uploads = [];
  for (const u of data.asset_uploads || []) {
    const att = draft.attachments.find((a) => a.id === u.attachment_id);
    if (!att) { blocking.push(`Anhang ${u.attachment_id} nicht gefunden.`); continue; }
    if (u.target === 'shop_file' && !ctx.caps.content) { blocking.push('Bilder für Bild-Einstellungen hochladen erfordert die Shopify-Admin-App (Dateien).'); continue; }
    const filename = u.target === 'theme_asset' ? `assets/${safeFileName(path.basename(u.filename || att.name)).replace(/\s+/g, '-')}` : safeFileName(path.basename(u.filename || att.name)).replace(/\s+/g, '-');
    uploads.push({ attachmentId: att.id, attachmentName: att.name, target: u.target, filename });
  }
  if (data.kind === 'not_possible') blocking.push('Claude hält den Wunsch mit den verfügbaren Schnittstellen nicht für umsetzbar (siehe Hinweise).');
  if (!themeFiles.length && !contentOps.length && data.kind !== 'not_possible') blocking.push('Der Vorschlag enthält keine Änderung.');
  return {
    at: nowIso(), liveThemeId: ctx.live?.id || null, liveThemeName: ctx.live?.name || null,
    understood: data.understood_request, summary: data.summary, kind: data.kind,
    themeFiles, contentOps, uploads, warnings, questions: data.questions || [], blocking, stale: false,
  };
}

// ------------------------------------------------------------------ Vorschau (Theme-Kopie)

export async function createPreview(id) {
  const d = store().websiteDrafts.get(id);
  if (!d?.proposal) throw new UserError('Kein Vorschlag vorhanden.');
  if (d.proposal.blocking.length) throw new UserError('Der Vorschlag hat offene Probleme.');
  if (!d.proposal.themeFiles.length) return { note: 'Dieser Vorschlag ändert nur Shop-Inhalte. Dafür bietet Shopify keine Vorschau; die Vorher-nachher-Ansicht zeigt die Änderung.' };
  const job = createJob({ type: 'website.preview', title: `Vorschau erzeugen: ${d.title}`, refType: 'website', refId: id });
  try {
    let previewTheme = d.preview?.themeId ? await shopify.getTheme(d.preview.themeId).catch(() => null) : null;
    if (!previewTheme) {
      logJob(job.id, 'Kopie des veröffentlichten Themes wird angelegt …');
      const name = `Studio-Vorschau ${d.title}`.slice(0, 50);
      previewTheme = await shopify.duplicateTheme(d.proposal.liveThemeId, name);
      store().websiteDrafts.update(id, (x) => { x.preview = { themeId: previewTheme.id, name: previewTheme.name, createdAt: nowIso() }; return x; });
    }
    await shopify.waitForThemeReady(previewTheme.id);
    const files = await materializeFiles(d, { forPreview: true, jobId: job.id });
    await shopify.upsertThemeFiles(previewTheme.id, files);
    const check = await shopify.readThemeFiles(previewTheme.id, files.map((f) => f.filename));
    const missing = files.filter((f) => !check[f.filename]);
    if (missing.length) throw new UserError('Vorschau unvollständig: ' + missing.map((m) => m.filename).join(', '));
    const area = d.areaKey.startsWith('theme:templates/') ? previewPath(d.areaKey.slice(6)) : '/';
    const preview = { themeId: previewTheme.id, name: previewTheme.name, url: shopify.previewUrl(previewTheme.id, area), editorUrl: shopify.editorUrl(previewTheme.id), updatedAt: nowIso(), proposalAt: d.proposal.at };
    store().websiteDrafts.update(id, (x) => { x.preview = { ...x.preview, ...preview }; return x; });
    finishJob(job.id, STATUS.SUCCESS, { result: { links: [{ label: 'Vorschau öffnen', url: preview.url }] }, msg: 'Vorschau-Theme aktualisiert (nicht veröffentlicht)' });
    return { preview };
  } catch (err) {
    finishJob(job.id, STATUS.FAILED, { error: errorMessage(err) });
    throw err;
  }
}

function previewPath(file) {
  if (file === 'templates/index.json') return '/';
  if (file === 'templates/list-collections.json') return '/collections';
  if (file === 'templates/cart.json') return '/cart';
  if (file === 'templates/search.json') return '/search';
  if (file === 'templates/collection.json') return '/collections/all';
  return '/';
}

/** Ersetzt Platzhalter für hochgeladene Bilder und liefert die Dateiliste für Shopify. */
async function materializeFiles(d, { forPreview, jobId }) {
  const replacements = {};
  const extra = [];
  for (const u of d.proposal.uploads) {
    const att = d.attachments.find((a) => a.id === u.attachmentId);
    const buf = fs.readFileSync(attachmentPath(d.id, att.file));
    if (u.target === 'theme_asset') {
      extra.push({ filename: u.filename, contentBase64: buf.toString('base64') });
    } else {
      const done = d.uploadedFiles?.[u.attachmentId];
      let ref = done?.reference;
      if (!ref) {
        logJob(jobId, `Bild ${att.name} wird in Shopify-Dateien hochgeladen …`);
        const r = await shopify.uploadShopImage({ filename: u.filename, mimeType: att.mime, buffer: buf, alt: d.title });
        ref = r.reference;
        store().websiteDrafts.update(d.id, (x) => { x.uploadedFiles = { ...(x.uploadedFiles || {}), [u.attachmentId]: r }; return x; });
      }
      replacements[`__STUDIO_FILE_${u.attachmentId}__`] = ref;
    }
  }
  const files = d.proposal.themeFiles.map((f) => {
    let content = f.newContent;
    for (const [k, v] of Object.entries(replacements)) content = content.split(k).join(v);
    return { filename: f.filename, content };
  });
  if (forPreview === undefined) return files;
  return [...files, ...extra];
}

// ------------------------------------------------------------------ Prüfen, Freigeben, Übernehmen

export async function reviewDraft(id) {
  const d = store().websiteDrafts.get(id);
  if (!d?.proposal) throw new UserError('Kein Vorschlag vorhanden.');
  if (d.proposal.stale) throw new UserError('Der Auftrag wurde nach dem Vorschlag geändert. Bitte neuen Vorschlag erstellen.');
  if (d.proposal.blocking.length) throw new UserError('Der Vorschlag hat offene Probleme: ' + d.proposal.blocking.join(' '));
  const summary = {
    action: 'Website-Änderung übernehmen',
    shop: getSettings().shop.domain,
    theme: d.proposal.themeFiles.length ? `${d.proposal.liveThemeName} (veröffentlicht, live)` : null,
    area: d.areaKey,
    summary: d.proposal.summary,
    files: d.proposal.themeFiles.map((f) => ({ filename: f.filename, isNew: f.isNew, changedLines: f.changedLines })),
    contentOps: d.proposal.contentOps.map((o) => opLabel(o)),
    uploads: d.proposal.uploads.map((u) => `${u.attachmentName} → ${u.target === 'theme_asset' ? 'Theme: ' + u.filename : 'Shopify-Dateien: ' + u.filename}`),
    previewChecked: Boolean(d.preview?.url && d.preview.proposalAt === d.proposal.at),
    effect: [
      d.proposal.themeFiles.length ? 'Die genannten Dateien des LIVE-Themes werden überschrieben bzw. angelegt. Besucher sehen die Änderung sofort.' : null,
      d.proposal.contentOps.length ? 'Die genannten Shop-Inhalte werden sofort geändert. Neue Seiten werden unveröffentlicht angelegt.' : null,
      'Vorher werden die betroffenen Originale gesichert. „Wiederherstellen“ ist danach möglich.',
    ].filter(Boolean),
    warnings: d.proposal.warnings,
  };
  const approvalHash = stableHash({ files: d.proposal.themeFiles.map((f) => [f.filename, md5(f.newContent), f.beforeChecksum]), ops: d.proposal.contentOps, uploads: d.proposal.uploads });
  store().websiteDrafts.update(id, (x) => { x.status = STATUS.APPROVAL; x.review = { at: nowIso(), approvalHash, summary }; return x; });
  return { approvalHash, summary, status: STATUS.APPROVAL };
}

function opLabel(o) {
  if (o.op === 'page_update') return `Seite „${o.before.title}“ ändern`;
  if (o.op === 'page_create') return `Neue Seite „${o.title}“ anlegen (unveröffentlicht${o.templateSuffix ? ', Vorlage ' + o.templateSuffix : ''})`;
  if (o.op === 'collection_add_products') return `${o.products.filter((p) => !p.alreadyIn).length} Produkt(e) zur Kollektion „${o.collectionTitle}“ hinzufügen`;
  return o.op;
}

const applying = new Set();

export async function applyDraft(id, { approvalHash }) {
  if (applying.has(id)) throw new UserError('Die Übernahme läuft bereits.', { status: 409 });
  applying.add(id);
  let jobId;
  try {
    const d = store().websiteDrafts.get(id);
    if (!d) throw new UserError('Entwurf nicht gefunden.', { status: 404 });
    if (d.apply?.state === 'done') throw new UserError('Diese Änderung wurde bereits übernommen.', { status: 409 });
    if (['running', 'unknown'].includes(d.apply?.state)) throw new UserError('Ein vorheriger Vorgang hat ein unklares Ergebnis. Bitte zuerst „Ergebnis prüfen“.', { status: 409 });
    if (d.status !== STATUS.APPROVAL || d.review?.approvalHash !== approvalHash) throw new UserError('Bitte zuerst prüfen und freigeben (oder der Entwurf wurde seitdem geändert).', { status: 409 });
    const job = createJob({ type: 'website.apply', title: `Website-Änderung übernehmen: ${d.title}`, refType: 'website', refId: id });
    jobId = job.id;
    store().websiteDrafts.update(id, (x) => { x.status = STATUS.RUNNING; x.apply = { state: 'running', startedAt: nowIso(), jobId }; return x; });

    // 1) Konfliktprüfung + Sicherung
    const backup = { id: 'b' + Date.now().toString(36), at: nowIso(), themeId: d.proposal.liveThemeId, files: [], pages: [], newFiles: [], createdPages: [], collectionAdds: [] };
    const backupDir = path.join(DIRS.themeBackups, `${safeFileName(d.title).slice(0, 40)}-${id}`, backup.id);
    fs.mkdirSync(backupDir, { recursive: true });
    if (d.proposal.themeFiles.length) {
      const live = await shopify.liveTheme();
      if (live.id !== d.proposal.liveThemeId) throw new UserError('Das veröffentlichte Theme hat sich seit dem Vorschlag geändert. Bitte neuen Vorschlag erstellen.', { code: 'conflict' });
      const current = await shopify.readThemeFiles(live.id, d.proposal.themeFiles.map((f) => f.filename));
      for (const f of d.proposal.themeFiles) {
        const cur = current[f.filename];
        if (!f.isNew && cur?.checksumMd5 !== f.beforeChecksum) throw new UserError(`${f.filename} wurde seit dem Vorschlag im Shop geändert. Bitte neuen Vorschlag erstellen.`, { code: 'conflict' });
        if (f.isNew && cur) throw new UserError(`${f.filename} existiert inzwischen. Bitte neuen Vorschlag erstellen.`, { code: 'conflict' });
        if (cur) {
          const local = path.join(backupDir, f.filename.replace(/\//g, '__'));
          fs.writeFileSync(local, cur.content ?? Buffer.from(cur.contentBase64 || '', 'base64'));
          backup.files.push({ filename: f.filename, checksumMd5: cur.checksumMd5, local });
        } else backup.newFiles.push(f.filename);
      }
      for (const u of d.proposal.uploads.filter((x) => x.target === 'theme_asset')) {
        const ex = (await shopify.readThemeFiles(live.id, [u.filename]))[u.filename];
        if (ex) {
          const local = path.join(backupDir, u.filename.replace(/\//g, '__'));
          fs.writeFileSync(local, ex.content ?? Buffer.from(ex.contentBase64 || '', 'base64'));
          backup.files.push({ filename: u.filename, checksumMd5: ex.checksumMd5, local, binary: ex.content === undefined });
        } else backup.newFiles.push(u.filename);
      }
    }
    for (const o of d.proposal.contentOps.filter((x) => x.op === 'page_update')) {
      const cur = await shopify.getPage(o.pageId);
      if (cur.updatedAt !== o.before.updatedAt) throw new UserError(`Die Seite „${cur.title}“ wurde seit dem Vorschlag geändert. Bitte neuen Vorschlag erstellen.`, { code: 'conflict' });
      backup.pages.push({ id: cur.id, title: cur.title, body: cur.body });
    }
    fs.writeFileSync(path.join(backupDir, 'sicherung.json'), JSON.stringify(backup, null, 1));
    store().websiteDrafts.update(id, (x) => { x.backups = [...(x.backups || []), backup]; return x; });
    logJob(jobId, `Sicherung angelegt: ${backup.files.length} Datei(en), ${backup.pages.length} Seite(n) → ${backupDir}`);

    // 2) Ausführen
    const fresh = store().websiteDrafts.get(id);
    const results = { files: [], ops: [], links: [] };
    if (fresh.proposal.themeFiles.length || fresh.proposal.uploads.some((u) => u.target === 'theme_asset')) {
      const files = await materializeFiles(fresh, { forPreview: false, jobId });
      await shopify.upsertThemeFiles(fresh.proposal.liveThemeId, files);
      const check = await shopify.readThemeFiles(fresh.proposal.liveThemeId, files.map((f) => f.filename));
      for (const f of files) {
        const expected = f.content !== undefined ? md5(Buffer.from(f.content, 'utf8')) : md5(Buffer.from(f.contentBase64, 'base64'));
        const got = check[f.filename]?.checksumMd5;
        // Shopify normalisiert JSON-Vorlagen beim Speichern – dann genügt das Vorhandensein.
        const ok = got === expected || (f.filename.endsWith('.json') && Boolean(check[f.filename]));
        results.files.push({ filename: f.filename, confirmed: ok });
      }
      results.links.push({ label: 'Shop ansehen', url: getSettings().shop.publicUrl || `https://${getSettings().shop.domain}` });
    }
    for (const o of fresh.proposal.contentOps) {
      if (o.op === 'page_update') {
        const p = await shopify.updatePage(o.pageId, { title: o.after.title, body: o.after.body });
        results.ops.push({ label: opLabel(o), confirmed: p.body === o.after.body });
      } else if (o.op === 'page_create') {
        const p = await shopify.createPage({ title: o.title, handle: o.handle || undefined, body: o.body, templateSuffix: o.templateSuffix || undefined, isPublished: false });
        store().websiteDrafts.update(id, (x) => { x.backups[x.backups.length - 1].createdPages.push(p.id); return x; });
        results.ops.push({ label: opLabel(o), confirmed: Boolean(p?.id) });
        results.links.push({ label: `Neue Seite im Admin: ${p.title}`, url: `https://${getSettings().shop.domain}/admin/pages/${shopify.gid.num(p.id)}` });
      } else if (o.op === 'collection_add_products') {
        for (const pr of o.products.filter((x) => !x.alreadyIn)) {
          await shopify.updateProduct({ id: pr.id, collectionsToJoin: [o.collectionId] });
          const after = await shopify.getProduct(pr.id);
          const ok = after.collections.nodes.some((n) => n.id === o.collectionId);
          store().websiteDrafts.update(id, (x) => { x.backups[x.backups.length - 1].collectionAdds.push({ productId: pr.id, collectionId: o.collectionId }); return x; });
          results.ops.push({ label: `${pr.title} → ${o.collectionTitle}`, confirmed: ok });
        }
      }
    }
    const allOk = results.files.every((f) => f.confirmed) && results.ops.every((o) => o.confirmed);
    const st = allOk ? STATUS.SUCCESS : STATUS.CHECK;
    store().websiteDrafts.update(id, (x) => { x.status = st; x.apply = { ...x.apply, state: allOk ? 'done' : 'unknown', finishedAt: nowIso(), results }; return x; });
    finishJob(jobId, st, { result: results, msg: allOk ? 'Von Shopify bestätigt' : 'Nicht alle Änderungen konnten bestätigt werden' });
    return { status: st, results };
  } catch (err) {
    const d = store().websiteDrafts.get(id);
    if (d?.apply?.state === 'running') {
      const conflict = err.code === 'conflict';
      const st = conflict ? STATUS.FAILED : STATUS.CHECK;
      store().websiteDrafts.update(id, (x) => { x.status = st; x.apply = { ...x.apply, state: conflict ? 'failed' : 'unknown', error: errorMessage(err), finishedAt: nowIso() }; return x; });
      if (jobId) finishJob(jobId, st, { error: errorMessage(err) });
    }
    throw err;
  } finally {
    applying.delete(id);
  }
}

/** Unklares Ergebnis: tatsächlichen Zustand lesen und vergleichen. */
export async function checkApplied(id) {
  const d = store().websiteDrafts.get(id);
  if (!d?.proposal) throw new UserError('Kein Vorschlag vorhanden.');
  const report = [];
  if (d.proposal.themeFiles.length) {
    const cur = await shopify.readThemeFiles(d.proposal.liveThemeId, d.proposal.themeFiles.map((f) => f.filename));
    for (const f of d.proposal.themeFiles) {
      const c = cur[f.filename];
      const applied = c && (c.checksumMd5 === md5(Buffer.from(f.newContent, 'utf8')) || (f.filename.endsWith('.json') && c.checksumMd5 !== f.beforeChecksum));
      report.push({ item: f.filename, applied: Boolean(applied) });
    }
  }
  for (const o of d.proposal.contentOps.filter((x) => x.op === 'page_update')) {
    const p = await shopify.getPage(o.pageId);
    report.push({ item: `Seite ${p.title}`, applied: p.body === o.after.body });
  }
  const all = report.length > 0 && report.every((r) => r.applied);
  const none = report.every((r) => !r.applied);
  store().websiteDrafts.update(id, (x) => {
    if (all) { x.status = STATUS.SUCCESS; x.apply = { ...x.apply, state: 'done', checkedAt: nowIso() }; }
    else if (none) { x.status = STATUS.FAILED; x.apply = { ...x.apply, state: 'failed', checkedAt: nowIso() }; }
    return x;
  });
  return { report, all, none };
}

/** Sicherung zurückspielen (nach ausdrücklicher Bestätigung). */
export async function restoreBackup(id, { backupId, confirm }) {
  if (!confirm) throw new UserError('Wiederherstellung muss bestätigt werden.');
  const d = store().websiteDrafts.get(id);
  const b = d?.backups?.find((x) => x.id === backupId);
  if (!b) throw new UserError('Sicherung nicht gefunden.', { status: 404 });
  const job = createJob({ type: 'website.restore', title: `Wiederherstellen: ${d.title}`, refType: 'website', refId: id });
  try {
    const live = await shopify.liveTheme();
    if (b.files.length) {
      if (live.id !== b.themeId) throw new UserError('Das veröffentlichte Theme ist inzwischen ein anderes. Die Sicherung gehört zu einem anderen Theme und wird nicht automatisch eingespielt.');
      const files = b.files.map((f) => {
        const buf = fs.readFileSync(f.local);
        return f.binary ? { filename: f.filename, contentBase64: buf.toString('base64') } : { filename: f.filename, content: buf.toString('utf8') };
      });
      await shopify.upsertThemeFiles(b.themeId, files);
      logJob(job.id, `${files.length} Theme-Datei(en) zurückgeschrieben.`);
    }
    if (b.newFiles.length) logJob(job.id, `Neu angelegte Dateien bleiben bestehen (werden nicht ungefragt gelöscht): ${b.newFiles.join(', ')}`);
    for (const p of b.pages) { await shopify.updatePage(p.id, { title: p.title, body: p.body }); logJob(job.id, `Seite „${p.title}“ zurückgesetzt.`); }
    for (const c of b.collectionAdds || []) { await shopify.updateProduct({ id: c.productId, collectionsToLeave: [c.collectionId] }); }
    if (b.createdPages?.length) logJob(job.id, `Neu angelegte Seiten bleiben (unveröffentlicht) bestehen: ${b.createdPages.length}`);
    store().websiteDrafts.update(id, (x) => { x.restoredAt = nowIso(); x.status = STATUS.DRAFT; x.apply = { state: 'none', previous: x.apply }; x.review = null; return x; });
    finishJob(job.id, STATUS.SUCCESS, { msg: 'Wiederhergestellt' });
    return { ok: true };
  } catch (err) {
    finishJob(job.id, STATUS.FAILED, { error: errorMessage(err) });
    throw err;
  }
}

export async function removePreview(id, { confirm }) {
  if (!confirm) throw new UserError('Bitte bestätigen.');
  const d = store().websiteDrafts.get(id);
  if (!d?.preview?.themeId) return { ok: true };
  await shopify.deleteTheme(d.preview.themeId);
  store().websiteDrafts.update(id, (x) => { x.preview = null; return x; });
  return { ok: true };
}
