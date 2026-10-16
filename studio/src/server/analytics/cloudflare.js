import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR } from '../paths.js';
import { getSettings, saveSettings } from '../store.js';
import { getSecret, setSecret, hasSecret } from '../secrets.js';
import { UserError, errorMessage, nowIso, sleep } from '../util.js';
import { VERSION as COLLECTOR_VERSION } from '../../collector/core.js';

/**
 * Richtet den Live-View-Dienst (src/collector/) mit einem Klick bei Cloudflare ein – über die offizielle
 * Cloudflare-REST-Schnittstelle, ohne wrangler/npm (auf dem PC ist nur Node.js vorhanden).
 *
 * Benötigt einen Cloudflare-API-Token mit „Workers Scripts: Bearbeiten“ und „D1: Bearbeiten“
 * (Vorlage „Cloudflare Workers bearbeiten“ + D1). Der Token liegt verschlüsselt auf dem PC
 * (Zugang `cloudflare.apiToken`) und wird nur an api.cloudflare.com gesendet.
 *
 * Ablauf (wiederholbar – vorhandene Datenbank und Lese-Schlüssel werden weiterverwendet):
 * Token prüfen → Konto → D1-Datenbank „apologea-live“ → Tabellen → Worker hochladen (mit Bindungen)
 * → stündliche Aufräum-Aufgabe → workers.dev-Adresse → Adresse + Lese-Schlüssel im Studio speichern → Erreichbarkeit.
 */

const API = process.env.APOLOGEA_TEST === '1' && process.env.APOLOGEA_CF_API ? process.env.APOLOGEA_CF_API : 'https://api.cloudflare.com/client/v4';
export const SCRIPT_NAME = 'apologea-live';
const DB_NAME = 'apologea-live';
const COMPAT_DATE = '2026-09-01';
const CRON = '17 * * * *';
const COLLECTOR_DIR = path.join(APP_DIR, 'src', 'collector');

export { COLLECTOR_VERSION };

function explain(status, errors) {
  const codes = (errors || []).map((e) => e.code);
  const text = (errors || []).map((e) => e.message).filter(Boolean).join(' / ');
  if (status === 401 || codes.includes(10000) || codes.includes(9109) || /authentication/i.test(text)) {
    return 'Cloudflare lehnt den API-Token ab oder ihm fehlt eine Berechtigung. Benötigt: „Workers Scripts – Bearbeiten“ und „D1 – Bearbeiten“.';
  }
  return `Cloudflare meldet: ${text || `Fehler ${status}`}`;
}

async function cf(token, method, pathname, { json, form } = {}) {
  let res;
  try {
    res = await fetch(API + pathname, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: form || (json !== undefined ? JSON.stringify(json) : undefined),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new UserError(`Cloudflare nicht erreichbar (${err.name === 'TimeoutError' ? 'Zeitüberschreitung' : err.message}).`, { status: 502 });
  }
  let body = null;
  try { body = await res.json(); } catch { /* keine JSON-Antwort */ }
  if (!res.ok || body?.success === false) {
    const e = new UserError(explain(res.status, body?.errors), { status: 502, code: 'cloudflare' });
    e.cfStatus = res.status;
    e.cfCodes = (body?.errors || []).map((x) => x.code);
    throw e;
  }
  return body?.result;
}

/** Schema-Datei in einzelne Anweisungen zerlegen (Kommentare entfernen). */
export function schemaStatements() {
  const sql = fs.readFileSync(path.join(COLLECTOR_DIR, 'schema.sql'), 'utf8').replace(/--[^\n]*/g, '');
  return sql.split(';').map((s) => s.trim()).filter(Boolean);
}

function setupState() {
  return getSettings().analytics.liveSetup || {};
}

/** Ablauf mit Fortschrittsliste. */
export async function deployCollector({ apiToken } = {}) {
  if (apiToken !== undefined) {
    const t = String(apiToken || '').trim();
    if (!/^[\w-]{30,200}$/.test(t)) throw new UserError('Das sieht nicht wie ein Cloudflare-API-Token aus. Bitte den ganzen Token kopieren (ca. 40 Zeichen).');
    await setSecret('cloudflare.apiToken', t);
  }
  const token = await getSecret('cloudflare.apiToken');
  if (!token) throw new UserError('Bitte zuerst den Cloudflare-API-Token eintragen.', { status: 412, code: 'cf_token_missing' });

  const steps = [];
  const step = async (label, fn) => {
    try {
      const r = await fn();
      steps.push({ label, ok: true, detail: typeof r === 'string' ? r : null });
      return r;
    } catch (err) {
      steps.push({ label, ok: false, detail: errorMessage(err) });
      err.steps = steps;
      throw err;
    }
  };
  const prev = setupState();

  try {
    const account = await step('Cloudflare-Konto gefunden', async () => {
      const list = await cf(token, 'GET', '/accounts?per_page=50');
      if (!list?.length) throw new UserError('Der Token hat keinen Zugriff auf ein Cloudflare-Konto.');
      return list.find((a) => a.id === prev.accountId) || list[0];
    });
    steps[steps.length - 1].detail = account.name || null;
    const A = `/accounts/${account.id}`;

    const db = await step('Datenbank bereit', async () => {
      const found = await cf(token, 'GET', `${A}/d1/database?name=${encodeURIComponent(DB_NAME)}`);
      const hit = (found || []).find((d) => d.name === DB_NAME);
      if (hit) return hit;
      return cf(token, 'POST', `${A}/d1/database`, { json: { name: DB_NAME } });
    });
    const dbId = db.uuid || db.id;
    steps[steps.length - 1].detail = db.created_at && !prev.databaseId ? 'neu angelegt' : 'vorhanden';

    await step('Tabellen angelegt', async () => {
      for (const sql of schemaStatements()) await cf(token, 'POST', `${A}/d1/database/${dbId}/query`, { json: { sql } });
    });

    let readToken = await getSecret('analytics.collectorToken');
    if (!readToken) {
      readToken = crypto.randomBytes(24).toString('base64url');
      await setSecret('analytics.collectorToken', readToken);
    }

    await step('Live-Dienst hochgeladen', async () => {
      const shop = getSettings().shop.domain;
      const metadata = {
        main_module: 'worker.js',
        compatibility_date: COMPAT_DATE,
        bindings: [
          { type: 'd1', name: 'DB', id: dbId },
          { type: 'plain_text', name: 'SHOP_DOMAIN', text: shop },
          { type: 'plain_text', name: 'ALLOWED_ORIGINS', text: '' },
          { type: 'secret_text', name: 'READ_TOKEN', text: readToken },
        ],
      };
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      for (const f of ['worker.js', 'core.js']) {
        form.append(f, new Blob([fs.readFileSync(path.join(COLLECTOR_DIR, f))], { type: 'application/javascript+module' }), f);
      }
      await cf(token, 'PUT', `${A}/workers/scripts/${SCRIPT_NAME}`, { form });
      return `Version ${COLLECTOR_VERSION}`;
    });

    await step('Automatisches Löschen alter Daten (stündlich)', () => cf(token, 'PUT', `${A}/workers/scripts/${SCRIPT_NAME}/schedules`, { json: [{ cron: CRON }] }));

    const sub = await step('Öffentliche Adresse eingerichtet', async () => {
      let s = null;
      try { s = (await cf(token, 'GET', `${A}/workers/subdomain`))?.subdomain || null; } catch (err) { if (err.cfStatus !== 404 && !(err.cfCodes || []).includes(10007)) throw err; }
      if (!s) {
        const name = `apologea-${crypto.randomBytes(3).toString('hex')}`;
        s = (await cf(token, 'PUT', `${A}/workers/subdomain`, { json: { subdomain: name } }))?.subdomain || name;
      }
      await cf(token, 'POST', `${A}/workers/scripts/${SCRIPT_NAME}/subdomain`, { json: { enabled: true, previews_enabled: false } });
      return s;
    });
    const url = process.env.APOLOGEA_TEST === '1' && process.env.APOLOGEA_CF_WORKER_URL ? process.env.APOLOGEA_CF_WORKER_URL : `https://${SCRIPT_NAME}.${sub}.workers.dev`;
    steps[steps.length - 1].detail = url;

    saveSettings({ analytics: { collectorUrl: url, liveSetup: { accountId: account.id, accountName: account.name || null, databaseId: dbId, url, deployedAt: nowIso(), version: COLLECTOR_VERSION } } });

    // Neue workers.dev-Adressen sind manchmal erst nach ein paar Minuten erreichbar.
    let reachable = false;
    let lastErr = null;
    for (let i = 0; i < 6 && !reachable; i++) {
      try {
        const r = await fetch(`${url}/v1/health`, { headers: { Authorization: `Bearer ${readToken}` }, signal: AbortSignal.timeout(10_000) });
        reachable = r.ok;
        if (!r.ok) lastErr = `Antwort ${r.status}`;
      } catch (err) { lastErr = err.message; }
      if (!reachable && i < 5) await sleep(process.env.APOLOGEA_TEST === '1' ? 50 : 5000);
    }
    steps.push({ label: 'Dienst antwortet', ok: reachable, pending: !reachable, detail: reachable ? null : `Noch nicht erreichbar (${lastErr}). Bei einem neuen Cloudflare-Konto kann das einige Minuten dauern – später „Erneut prüfen“.` });
    return { ok: true, reachable, url, steps, version: COLLECTOR_VERSION };
  } catch (err) {
    return { ok: false, error: errorMessage(err), steps: err.steps || steps };
  }
}

/** Pixel-Code mit eingesetzter Dienst-Adresse und Shop-Domain. */
export function pixelCode() {
  const url = String(getSettings().analytics.collectorUrl || '').replace(/\/+$/, '');
  if (!url) throw new UserError('Zuerst den Live-View-Dienst einrichten.', { status: 412 });
  const shop = getSettings().shop.domain;
  return fs.readFileSync(path.join(COLLECTOR_DIR, 'pixel.js'), 'utf8')
    .replace(/const ENDPOINT = '[^']*';[^\n]*/, `const ENDPOINT = '${url}/v1/e';`)
    .replace(/const SHOP = '[^']*';/, `const SHOP = '${shop}';`);
}

export function cloudflareInfo() {
  const s = setupState();
  return {
    tokenSet: hasSecret('cloudflare.apiToken'),
    deployed: Boolean(s.url),
    url: s.url || null,
    accountName: s.accountName || null,
    deployedAt: s.deployedAt || null,
    version: s.version || null,
    latest: COLLECTOR_VERSION,
    updateAvailable: Boolean(s.version && s.version !== COLLECTOR_VERSION),
  };
}
