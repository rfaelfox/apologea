import { store } from '../store.js';
import { STATUS, UserError, nowIso } from '../util.js';
import * as shopify from '../integrations/shopify.js';
import { TEMPLATE_LABELS, capabilities, stripJsonComment, normalizeProposal } from './website.js';

/**
 * Visueller Editor (wie der Shopify-Theme-Editor): zeigt Abschnitte und Blöcke der Seiten des
 * veröffentlichten Themes mit ihren Einstellungen. Eigene Änderungen werden in einem Entwurf gesammelt
 * und laufen danach durch denselben Weg wie Claudes Vorschläge: Vorschau → Prüfen → Freigabe → Übernahme
 * mit Sicherung. Vorher wird im Shop nichts geändert.
 */

// Einstellungsarten, die hier bearbeitet werden können; alle anderen werden nur angezeigt.
export const EDITABLE = new Set(['text', 'textarea', 'richtext', 'inline_richtext', 'url', 'image_picker', 'color', 'color_background', 'checkbox', 'range', 'number', 'select', 'radio', 'text_alignment', 'video_url', 'html']);
const INFO_ONLY = new Set(['header', 'paragraph']);
const GROUPS = { 'sections/header-group.json': 'Kopfbereich', 'sections/footer-group.json': 'Fußbereich' };

const SCHEMA_RE = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/;

function parseSchema(liquid) {
  const m = SCHEMA_RE.exec(liquid || '');
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function makeTranslator(locale) {
  return (v) => {
    if (typeof v !== 'string' || !v.startsWith('t:')) return v;
    const key = v.slice(2);
    let cur = locale;
    for (const k of key.split('.')) cur = cur?.[k];
    if (typeof cur === 'string') return cur;
    const last = key.split('.').pop().replace(/_/g, ' ');
    return last.charAt(0).toUpperCase() + last.slice(1);
  };
}

export function templatePath(file) {
  const m = /^templates\/([\w-]+)(?:\.([\w-]+))?\.json$/.exec(file);
  if (!m) return null;
  const [, kind] = m;
  return { index: '/', product: '/products', collection: '/collections/all', 'list-collections': '/collections', page: '/pages', cart: '/cart', search: '/search', blog: '/blogs/news', '404': '/404-studio' }[kind] ?? '/';
}

/** Ordnet einen Shop-Pfad der passenden Vorlage zu (für die Live-Ansicht). */
export function templateForPath(p) {
  const path = (p || '/').replace(/\/+$/, '') || '/';
  if (path === '/') return 'templates/index.json';
  if (/^\/products\//.test(path)) return 'templates/product.json';
  if (/^\/collections\/[^/]+$/.test(path)) return 'templates/collection.json';
  if (path === '/collections') return 'templates/list-collections.json';
  if (/^\/pages\//.test(path)) return 'templates/page.json';
  if (path === '/cart') return 'templates/cart.json';
  if (path === '/search') return 'templates/search.json';
  if (/^\/blogs\/[^/]+$/.test(path)) return 'templates/blog.json';
  if (/^\/blogs\/[^/]+\/[^/]+$/.test(path)) return 'templates/article.json';
  if (path === '/password') return 'templates/password.json';
  return 'templates/404.json';
}

function field(setting, value, t) {
  const f = { id: setting.id, type: setting.type, label: t(setting.label || setting.content || setting.id || ''), info: setting.info ? t(setting.info) : '' };
  if (INFO_ONLY.has(setting.type)) return { ...f, infoOnly: true, label: t(setting.content || setting.label || '') };
  f.value = value === undefined ? (setting.default ?? null) : value;
  f.isDefault = value === undefined;
  f.editable = EDITABLE.has(setting.type);
  for (const k of ['min', 'max', 'step', 'unit', 'placeholder']) if (setting[k] !== undefined) f[k] = typeof setting[k] === 'string' ? t(setting[k]) : setting[k];
  if (Array.isArray(setting.options)) f.options = setting.options.map((o) => ({ value: o.value, label: t(o.label) }));
  return f;
}

function buildBlocks(inst, parentSchema, ctx, path) {
  const out = [];
  const order = inst.block_order || Object.keys(inst.blocks || {});
  for (const bid of order) {
    const b = inst.blocks?.[bid];
    if (!b) continue;
    let schema = (parentSchema?.blocks || []).find((x) => x.type === b.type && Array.isArray(x.settings));
    if (!schema && !b.type.startsWith('@')) schema = ctx.blockSchemas[b.type];
    const p = [...path, bid];
    out.push({
      kind: 'block', id: bid, type: b.type, path: p, disabled: Boolean(b.disabled), static: Boolean(b.static),
      name: ctx.t(b.name || schema?.name || b.type),
      settings: (schema?.settings || []).filter((s) => s.id || INFO_ONLY.has(s.type)).map((s) => field(s, b.settings?.[s.id], ctx.t)),
      children: buildBlocks(b, schema, ctx, p),
      unknownSchema: !schema,
    });
  }
  return out;
}

function buildSections(json, ctx, file) {
  const order = json.order || Object.keys(json.sections || {});
  return order.map((sid) => {
    const s = json.sections?.[sid];
    if (!s) return null;
    const schema = ctx.sectionSchemas[s.type];
    return {
      kind: 'section', file, id: sid, type: s.type, path: [], disabled: Boolean(s.disabled),
      name: ctx.t(s.name || schema?.name || s.type),
      settings: (schema?.settings || []).filter((x) => x.id || INFO_ONLY.has(x.type)).map((x) => field(x, s.settings?.[x.id], ctx.t)),
      children: buildBlocks(s, schema, ctx, []),
      unknownSchema: !schema,
    };
  }).filter(Boolean);
}

function collectBlockTypes(inst, set) {
  for (const b of Object.values(inst.blocks || {})) { if (b?.type && !b.type.startsWith('@')) set.add(b.type); collectBlockTypes(b, set); }
}

/** Aufbau einer Seite für den visuellen Editor. */
export async function structure({ template = 'templates/index.json' } = {}) {
  const caps = await capabilities();
  if (!caps.themes) throw new UserError('Für die Website-Ansicht wird ein Shopify-Zugang benötigt (Einstellungen → Shopify).', { status: 412, code: 'shopify_missing' });
  const live = await shopify.liveTheme();
  const names = new Set((await shopify.listThemeFileNames(live.id)).map((f) => f.filename));
  const templates = [...names].filter((n) => /^templates\/[\w.-]+\.json$/.test(n)).sort((a, b) => (a === 'templates/index.json' ? -1 : b === 'templates/index.json' ? 1 : a.localeCompare(b)))
    .map((f) => ({ file: f, label: TEMPLATE_LABELS[f] || 'Vorlage: ' + f.slice(10, -5), path: templatePath(f) }));
  if (!names.has(template)) template = 'templates/index.json';
  const groupFiles = Object.keys(GROUPS).filter((g) => names.has(g));
  const localeFile = ['locales/de.schema.json', 'locales/en.default.schema.json'].find((n) => names.has(n));
  const first = await shopify.readThemeFiles(live.id, [template, ...groupFiles, ...(localeFile ? [localeFile] : [])]);
  const parse = (f) => { try { return JSON.parse(stripJsonComment(first[f]?.content || '{}')); } catch { return null; } };
  const tplJson = parse(template);
  if (!tplJson) throw new UserError(`${template} konnte nicht gelesen werden.`);
  const jsons = { [template]: tplJson };
  for (const g of groupFiles) { const j = parse(g); if (j) jsons[g] = j; }
  const sectionTypes = new Set();
  const blockTypes = new Set();
  for (const j of Object.values(jsons)) for (const s of Object.values(j.sections || {})) { if (s?.type) sectionTypes.add(s.type); collectBlockTypes(s, blockTypes); }
  const want = [...[...sectionTypes].map((t) => `sections/${t}.liquid`), ...[...blockTypes].map((t) => `blocks/${t}.liquid`)].filter((n) => names.has(n));
  const files = await shopify.readThemeFiles(live.id, want);
  let locale = {};
  try { locale = localeFile ? JSON.parse(stripJsonComment(first[localeFile]?.content || '{}')) : {}; } catch { /* ohne Übersetzung */ }
  const ctx = { t: makeTranslator(locale), sectionSchemas: {}, blockSchemas: {} };
  for (const t of sectionTypes) ctx.sectionSchemas[t] = parseSchema(files[`sections/${t}.liquid`]?.content);
  for (const t of blockTypes) ctx.blockSchemas[t] = parseSchema(files[`blocks/${t}.liquid`]?.content);
  return {
    theme: { id: live.id, name: live.name },
    template,
    templates,
    checksums: Object.fromEntries(Object.keys(jsons).map((f) => [f, first[f]?.checksumMd5])),
    groups: [
      ...(jsons['sections/header-group.json'] ? [{ file: 'sections/header-group.json', label: GROUPS['sections/header-group.json'], sections: buildSections(jsons['sections/header-group.json'], ctx, 'sections/header-group.json') }] : []),
      { file: template, label: templates.find((x) => x.file === template)?.label || template, sections: buildSections(tplJson, ctx, template), main: true },
      ...(jsons['sections/footer-group.json'] ? [{ file: 'sections/footer-group.json', label: GROUPS['sections/footer-group.json'], sections: buildSections(jsons['sections/footer-group.json'], ctx, 'sections/footer-group.json') }] : []),
    ],
    canUploadImages: caps.content,
  };
}

// ------------------------------------------------------------------ Eigene Änderungen

const MANUAL_TITLE = 'Eigene Änderungen im Website-Editor';

function openManualDraft() {
  return store().websiteDrafts.list((d) => d.manual && !['running', 'unknown', 'done'].includes(d.apply?.state))[0] || null;
}

export function manualDraft({ create = false } = {}) {
  const d = openManualDraft();
  if (d || !create) return d;
  return store().websiteDrafts.put({ title: MANUAL_TITLE, areaKey: 'theme:templates/index.json', request: '', attachments: [], status: STATUS.DRAFT, proposal: null, preview: null, apply: { state: 'none' }, backups: [], manual: { edits: {} } });
}

const editKey = (e) => `${e.file}|${e.sectionId}|${(e.blockPath || []).join('/')}|${e.setting}`;
const SAFE_ID = /^[\w-]{1,120}$/;

/** Eine Einstellung ändern (oder mit remove: true zurücknehmen). Baut den Vorschlag neu auf. */
export async function setEdit(e) {
  if (!/^(templates\/[\w.-]+\.json|sections\/(header|footer)-group\.json)$/.test(e.file || '')) throw new UserError('Diese Datei kann hier nicht bearbeitet werden.');
  if (!SAFE_ID.test(e.sectionId || '') || !SAFE_ID.test(e.setting || '') || (e.blockPath || []).some((b) => !SAFE_ID.test(b))) throw new UserError('Ungültige Angabe.');
  if (!e.remove) {
    const v = e.value;
    if (!(v === null || ['string', 'number', 'boolean'].includes(typeof v))) throw new UserError('Ungültiger Wert.');
    if (typeof v === 'string' && v.length > 50_000) throw new UserError('Text zu lang.');
  }
  let d = manualDraft({ create: true });
  const key = editKey(e);
  store().websiteDrafts.update(d.id, (x) => {
    x.manual ||= { edits: {} };
    if (e.remove) delete x.manual.edits[key];
    else {
      x.manual.edits[key] = { file: e.file, sectionId: e.sectionId, blockPath: e.blockPath || [], setting: e.setting, value: e.value, label: String(e.label || '').slice(0, 200), at: nowIso() };
    }
    x.review = null;
    x.status = STATUS.DRAFT;
    return x;
  });
  d = store().websiteDrafts.get(d.id);
  return rebuild(d.id);
}

function applyEdits(json, edits) {
  for (const e of edits) {
    let node = json.sections?.[e.sectionId];
    if (!node) throw new UserError(`Abschnitt „${e.sectionId}“ gibt es auf der Seite nicht mehr.`);
    for (const b of e.blockPath) {
      node = node.blocks?.[b];
      if (!node) throw new UserError(`Block „${b}“ gibt es nicht mehr.`);
    }
    if (e.value === null) { if (node.settings) delete node.settings[e.setting]; } else {
      node.settings ||= {};
      node.settings[e.setting] = e.value;
    }
  }
  return json;
}

/** Vorschlag (gleiches Format wie Claudes Vorschläge) aus den gesammelten Änderungen erzeugen. */
export async function rebuild(id) {
  const d = store().websiteDrafts.get(id);
  const edits = Object.values(d.manual?.edits || {});
  if (!edits.length) {
    store().websiteDrafts.update(id, (x) => { x.proposal = null; x.status = STATUS.DRAFT; return x; });
    return store().websiteDrafts.get(id);
  }
  const caps = await capabilities();
  const live = await shopify.liveTheme();
  const byFile = {};
  for (const e of edits) (byFile[e.file] ||= []).push(e);
  const current = await shopify.readThemeFiles(live.id, Object.keys(byFile));
  const themeFiles = [];
  const uploads = new Map();
  for (const [file, list] of Object.entries(byFile)) {
    const raw = current[file]?.content;
    if (raw === undefined) throw new UserError(`${file} wurde im Shop nicht gefunden.`);
    const header = (/^﻿?\s*\/\*[\s\S]*?\*\/\s*/.exec(raw) || [''])[0];
    const json = applyEdits(JSON.parse(stripJsonComment(raw)), list);
    themeFiles.push({ filename: file, new_content: header + JSON.stringify(json, null, 2) + '\n', explanation: list.map((e) => e.label || e.setting).join(' · ') });
    for (const e of list) {
      const m = typeof e.value === 'string' && /__STUDIO_FILE_(\w+)__/.exec(e.value);
      if (m) uploads.set(m[1], { attachment_id: m[1], target: 'shop_file' });
    }
  }
  const data = {
    kind: 'theme_change',
    understood_request: 'Eigene Änderungen aus dem Website-Editor',
    summary: edits.map((e) => `${e.label || e.setting}`).join('\n'),
    theme_files: themeFiles,
    content_ops: [],
    asset_uploads: [...uploads.values()],
    limitations: [],
    questions: [],
  };
  const proposal = await normalizeProposal(d, data, { live, caps });
  proposal.manual = true;
  const main = Object.keys(byFile).find((f) => f.startsWith('templates/')) || 'templates/index.json';
  store().websiteDrafts.update(id, (x) => { x.proposal = proposal; x.areaKey = `theme:${main}`; x.status = proposal.blocking.length ? STATUS.MISSING : STATUS.READY; x.review = null; return x; });
  return store().websiteDrafts.get(id);
}
