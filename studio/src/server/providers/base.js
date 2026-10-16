import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR, DIRS } from '../paths.js';
import { writeAtomic, getSettings } from '../store.js';
import { getSecret } from '../secrets.js';
import { UserError, sleep } from '../util.js';

/**
 * Gemeinsame Bausteine für alle Print-on-Demand-Anbieter.
 *
 * SO WIRD EIN NEUER ANBIETER ERGÄNZT (siehe docs/STUDIO.md, Abschnitt „Anbieter-Bausteine“):
 *   1. Datei src/server/providers/<id>.js anlegen, die ein Objekt nach dem Vertrag unten exportiert.
 *   2. In src/server/providers/registry.js eintragen.
 *   3. Optional Testdaten für den Simulationsmodus in fixtures/<id>/ (klar als Beispieldaten markiert).
 * Oberfläche, Freigaben, Doppelschutz, Druckdatei-Prüfung, Vorlagen und Verlauf funktionieren dann automatisch.
 *
 * Vertrag eines Anbieters:
 *   meta: { id, name, website, modes: [{ id, label, desc }], secrets: [{ name, label, placeholder, hint }],
 *           capabilities: { alternativeDesign, neckPrint, namedPlacements: [{v,l}], mockupChoice, twoStep,
 *                           realMockups, directUpload: { maxBytes } | null, catalogOptions, priceUnit },
 *           linkHelp }
 *   status(), testConnection(), account({refresh}) → { label, email, targets: [{ id, label, channel, canPublish, note }] }
 *   catalog({refresh}) → { items: [{ id, title, image, badges }] }
 *   catalogOptions(id) → [{ id, label }]          (z. B. Printify: Druckdienstleister)
 *   details(id, {refresh}) → { id, title, image, description, descriptionSource, supportedPrinterTypes, printAreas: [{ name, label, width, height }],
 *                               variants: [{ id, size, color, colorHex, price, available, images: [{ image, printArea }] }] }
 *   listImages({ search }) → { images: [{ imageId, name, preview }] }, uploadImage({ filename, buffer }) → { imageId }
 *   buildRequest(draft, ctx) → genaue Daten, die gesendet werden (für Freigabe-Hash und Zusammenfassung)
 *   publish(request, { draft, onRemote, log }) → { confirmed, remoteId, links, listingImages, pending }
 *   reconcile(draft) → { found, links } | null,   mockups(request, { draft, onRemote }) → { images }   (optional)
 */

export function providerSettings(id) {
  return getSettings()[id] || { mode: 'none', allowedShops: [] };
}

export function cacheFile(provider, name) {
  return path.join(DIRS.cache, `${provider}-${name.replace(/[^\w-]/g, '_')}.json`);
}

export function readCache(provider, name, maxAgeMs) {
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile(provider, name), 'utf8'));
    if (!maxAgeMs || Date.now() - Date.parse(c.at) < maxAgeMs) return c;
  } catch { /* kein Zwischenspeicher */ }
  return null;
}

export async function writeCache(provider, name, data) {
  await writeAtomic(cacheFile(provider, name), JSON.stringify({ at: new Date().toISOString(), data }));
}

/** Zwischengespeichert laden; bei Fehlern den letzten bekannten Stand anzeigen (mit Hinweis). */
export async function cached(provider, name, maxAgeMs, refresh, loader) {
  const hit = !refresh && readCache(provider, name, maxAgeMs);
  if (hit) return { data: hit.data, cachedAt: hit.at };
  try {
    const data = await loader();
    await writeCache(provider, name, data);
    return { data, cachedAt: new Date().toISOString() };
  } catch (err) {
    const stale = readCache(provider, name);
    if (stale) return { data: stale.data, cachedAt: stale.at, stale: true, error: err.message };
    throw err;
  }
}

/**
 * JSON-REST-Aufruf mit Zeitlimit und Wiederholung bei 429/5xx (nur für lesende Aufrufe automatisch).
 * sim: Funktion (method, path, body) für den Simulationsmodus – derselbe Anbietercode läuft dann gegen Testdaten.
 */
export async function restCall({ provider, baseUrl, method = 'GET', path: p, body, headers = {}, tokenSecret, sim, retryWrites = false, timeoutMs = 60_000 }) {
  if (sim) {
    try { return await sim(method, p, body); } catch (err) {
      throw new UserError(`${provider} (Simulation): ${err.message}`, { status: 502, code: err.code || 'tool_error' });
    }
  }
  const token = tokenSecret ? await getSecret(tokenSecret) : null;
  if (tokenSecret && !token) throw new UserError(`Für ${provider} ist noch kein Zugangsschlüssel hinterlegt (Einstellungen → Anbieter).`, { status: 412, code: 'provider_missing_token' });
  const isWrite = method !== 'GET';
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(baseUrl + p, {
        method,
        signal: ctrl.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'APOLOGEA-Studio/1.1', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      clearTimeout(t);
      // Lesende Aufrufe dürfen gefahrlos wiederholt werden; Schreibaufrufe nie automatisch.
      if (!isWrite && attempt < 2) { await sleep(500 * (attempt + 1)); continue; }
      // Bei Schreibaufrufen ist nach einem Abbruch unklar, ob der Anbieter die Anfrage erhalten hat.
      throw new UserError(`${provider}: Verbindung ${err.name === 'AbortError' ? 'abgelaufen' : 'fehlgeschlagen'}.`, { status: 504, code: isWrite ? 'network' : 'network_read' });
    }
    clearTimeout(t);
    if ((res.status === 429 || res.status >= 500) && (!isWrite || retryWrites) && attempt < 3) {
      await sleep(Number(res.headers.get('retry-after')) * 1000 || 1500 * 2 ** attempt);
      continue;
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* kein JSON */ }
    if (res.status === 401 || res.status === 403) throw new UserError(`${provider} lehnt den Zugangsschlüssel ab (${res.status}). Bitte in den Einstellungen prüfen.`, { status: 502, code: 'provider_auth' });
    if (!res.ok) {
      const msg = json?.error?.message || json?.message || json?.errors?.reason || json?.result || text.slice(0, 300);
      // 4xx = eindeutige Ablehnung (es wurde nichts angelegt); 5xx bei Schreibaufrufen = unklar
      throw new UserError(`${provider} meldet einen Fehler (${res.status}): ${typeof msg === 'string' ? msg : JSON.stringify(msg).slice(0, 300)}`, { status: 502, code: res.status >= 500 && isWrite ? 'network' : 'tool_error' });
    }
    return json;
  }
}

export function fixture(provider, name) {
  return JSON.parse(fs.readFileSync(path.join(DIRS_FIXTURES, provider, name), 'utf8'));
}

const DIRS_FIXTURES = path.join(APP_DIR, 'fixtures');

/** Test-Override der Basisadresse (nur im Testbetrieb). */
export function testBaseUrl(envName) {
  return process.env.APOLOGEA_TEST === '1' ? process.env[envName] : null;
}
