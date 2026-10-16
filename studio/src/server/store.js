import fs from 'node:fs';
import path from 'node:path';
import { DIRS } from './paths.js';
import { clone, newId, nowIso } from './util.js';

/**
 * Einfache, dauerhafte Datenhaltung: eine JSON-Datei pro Sammlung, atomar geschrieben
 * (temporäre Datei + Umbenennen), damit bei Absturz oder Stromausfall nichts halb geschrieben ist.
 * Es läuft immer nur eine Programminstanz (siehe Startsperre), daher genügt ein Speicher im Prozess.
 */
class Collection {
  constructor(name, prefix) {
    this.name = name;
    this.prefix = prefix;
    this.file = path.join(DIRS.db, `${name}.json`);
    this.items = new Map();
    this.writing = Promise.resolve();
    this.load();
  }

  load() {
    this.items.clear();
    let raw = null;
    for (const f of [this.file, this.file + '.bak']) {
      try { raw = JSON.parse(fs.readFileSync(f, 'utf8')); break; } catch { /* nächste Quelle */ }
    }
    for (const item of raw?.items || []) this.items.set(item.id, item);
  }

  list(filter) {
    const all = [...this.items.values()].map(clone);
    const out = filter ? all.filter(filter) : all;
    return out.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }

  get(id) {
    return clone(this.items.get(id)) || null;
  }

  has(id) {
    return this.items.has(id);
  }

  /** Legt an oder ersetzt; setzt Zeitstempel. */
  put(obj) {
    const now = nowIso();
    const item = { ...clone(obj) };
    if (!item.id) item.id = newId(this.prefix);
    const prev = this.items.get(item.id);
    item.createdAt = prev?.createdAt || item.createdAt || now;
    item.updatedAt = now;
    this.items.set(item.id, item);
    this.persist();
    return clone(item);
  }

  /** Teilaktualisierung mit Funktion (liest aktuellen Stand, schreibt Ergebnis). */
  update(id, fn) {
    const cur = this.items.get(id);
    if (!cur) return null;
    const next = fn(clone(cur)) || cur;
    next.id = id;
    return this.put(next);
  }

  remove(id) {
    const ok = this.items.delete(id);
    if (ok) this.persist();
    return ok;
  }

  /** Viele Einträge auf einmal anlegen/ersetzen – nur ein Schreibvorgang (z. B. Bestell-Synchronisierung). */
  putMany(objs) {
    const now = nowIso();
    for (const obj of objs) {
      const item = { ...clone(obj) };
      if (!item.id) item.id = newId(this.prefix);
      const prev = this.items.get(item.id);
      item.createdAt = prev?.createdAt || item.createdAt || now;
      item.updatedAt = now;
      this.items.set(item.id, item);
    }
    if (objs.length) this.persist();
    return objs.length;
  }

  replaceAll(items) {
    this.items.clear();
    for (const it of items || []) this.items.set(it.id, it);
    this.persist();
  }

  persist() {
    const snapshot = JSON.stringify({ version: 1, items: [...this.items.values()] }, null, 1);
    this.writing = this.writing.then(() => writeAtomic(this.file, snapshot)).catch((err) => {
      console.error(`[store] Schreiben von ${this.name} fehlgeschlagen:`, err);
    });
    return this.writing;
  }
}

export function writeAtomic(file, data) {
  return new Promise((resolve, reject) => {
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, data);
      if (fs.existsSync(file)) {
        try { fs.copyFileSync(file, file + '.bak'); } catch { /* Sicherungskopie optional */ }
      }
      // Unter Windows kann ein Virenscanner die Datei kurz sperren → mehrfach versuchen.
      let lastErr;
      for (let i = 0; i < 8; i++) {
        try { fs.renameSync(tmp, file); lastErr = null; break; } catch (err) {
          lastErr = err;
          if (!['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) break;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (i + 1));
        }
      }
      if (lastErr) throw lastErr;
      resolve();
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch { /* ignorieren */ }
      reject(err);
    }
  });
}

export const COLLECTION_DEFS = {
  settings: 's_',
  designs: 'd_',
  products: 'p_',
  templates: 't_',
  websiteDrafts: 'w_',
  jobs: 'j_',
  // Analytics
  orders: 'o_', // synchronisierte Shopify-Bestellungen (ohne Kundendaten)
  costs: 'c_', // manuell erfasste Kosten (Werbung, Sonstiges)
  notices: 'n_', // Benachrichtigungen (neue Verkäufe, Ziele, Rückerstattungen, Fehler)
};

let db = null;

export function openStore() {
  db = {};
  for (const [name, prefix] of Object.entries(COLLECTION_DEFS)) db[name] = new Collection(name, prefix);
  return db;
}

export function store() {
  if (!db) throw new Error('Speicher nicht geöffnet');
  return db;
}

export async function flushStore() {
  if (!db) return;
  await Promise.all(Object.values(db).map((c) => c.writing));
}

/** Einstellungen als einzelnes Dokument. */
export const DEFAULT_SETTINGS = {
  id: 'settings',
  shop: {
    domain: 'dfz1mp-1u.myshopify.com',
    publicUrl: 'https://apologea.eu',
    apiVersion: '2026-07',
    liveThemeId: '',
  },
  ai: {
    engine: 'none', // 'none' | 'api' | 'claude-code'
    model: 'claude-opus-5-5',
    confirmEachPaidCall: true,
    paidCallsConfirmedAt: null,
  },
  marketprint: {
    mode: 'none', // 'none' | 'claude-code' | 'mcp' | 'simulation'
    claudeCodeServer: '',
    mcpUrl: '',
    defaultShop: 'dfz1mp-1u.myshopify.com',
    // Nur diese Shops dürfen Ziel einer Veröffentlichung sein. Das MarketPrint-Konto ist auch mit
    // einem fremden Shop (xgyzvd-1m) verbunden – der ist bewusst NICHT freigegeben.
    allowedShops: ['dfz1mp-1u.myshopify.com'],
  },
  // Weitere Anbieter (gleiche Struktur). Fremde Zielshops sind nie automatisch freigegeben.
  printify: { mode: 'none', allowedShops: [], defaultShop: '' },
  printful: { mode: 'none', allowedShops: [], defaultShop: '' },
  brand: {
    logoFile: '', // Logo Nr. 29, sobald bereitgestellt
    voice: 'Ruhig, würdevoll, hochwertig. Christlich-östliche Bildsprache ohne Kitsch. Keine Übertreibungen, keine erfundenen Fakten.',
  },
  ui: { onboardingDone: false },
  // Analytics & Business Intelligence
  analytics: {
    syncMinutes: 3, // Abstand der automatischen Bestell-Synchronisierung (0 = aus)
    goals: { daily: null, monthly: null }, // Umsatzziele (Gesamtumsatz, Shop-Währung)
    fees: { percent: null, fixed: null }, // Zahlungsgebühren je Bestellung, falls Shopify keine tatsächlichen Gebühren liefert
    podShippingPerOrder: null, // Versandkosten des Druckdienstleisters je Bestellung (Schätzung, falls keine Anbieterdaten)
    productCosts: {}, // Shopify-Produkt-ID → { unit, note } – Herstellkosten je Stück (manuell)
    collectorUrl: '', // Adresse des Live-View-Dienstes (siehe src/collector/)
    notify: { sales: true, refunds: true, goals: true, errors: true },
  },
  gelato: { mode: 'none' }, // nur Kostendaten für Analytics (API-Schlüssel in den Zugangsdaten)
};

export function getSettings() {
  const s = store().settings.get('settings');
  return deepMerge(clone(DEFAULT_SETTINGS), s || {});
}

export function saveSettings(patch) {
  const next = deepMerge(getSettings(), patch || {});
  next.id = 'settings';
  return store().settings.put(next);
}

function deepMerge(base, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      base[k] = deepMerge(base[k], v);
    } else if (v !== undefined) {
      base[k] = v;
    }
  }
  return base;
}
