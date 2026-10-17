import crypto from 'node:crypto';

export const STATUS = Object.freeze({
  DRAFT: 'Entwurf',
  MISSING: 'Angaben fehlen',
  READY: 'Bereit zur Prüfung',
  APPROVAL: 'Freigabe erforderlich',
  RUNNING: 'Wird ausgeführt',
  SUCCESS: 'Erfolgreich',
  FAILED: 'Fehlgeschlagen',
  CHECK: 'Ergebnis muss geprüft werden',
});

/** Fehler, deren Text direkt in der Oberfläche angezeigt werden darf. */
export class UserError extends Error {
  constructor(message, { status = 400, code = 'user_error', details } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function newId(prefix = '') {
  return prefix + crypto.randomBytes(9).toString('base64url');
}

export function nowIso() {
  return new Date().toISOString();
}

/** Stabiler Hash über ein JSON-Objekt (Schlüssel sortiert). */
export function stableHash(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(value).sort().filter((k) => value[k] !== undefined)
    .map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

export function md5(buf) {
  return crypto.createHash('md5').update(buf).digest('hex');
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

/** Dateinamen für das Dateisystem entschärfen (Windows-tauglich). */
export function safeFileName(name, fallback = 'datei') {
  const cleaned = String(name || '')
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

export function errorMessage(err) {
  if (!err) return 'Unbekannter Fehler';
  if (err instanceof UserError) return err.message;
  return err.message || String(err);
}
