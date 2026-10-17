import * as marketprint from './marketprint.js';
import * as printify from './printify.js';
import * as printful from './printful.js';
import { providerSettings } from './base.js';
import { UserError } from '../util.js';

/**
 * Alle Print-on-Demand-Anbieter des Studios. Einen neuen Anbieter hier eintragen –
 * Vertrag und Anleitung: src/server/providers/base.js.
 */
const PROVIDERS = { marketprint, printify, printful };

export function getProvider(id) {
  const p = PROVIDERS[id || 'marketprint'];
  if (!p) throw new UserError(`Unbekannter Anbieter „${id}“.`);
  return p;
}

export function listProviders() {
  return Object.values(PROVIDERS).map((p) => {
    const s = providerSettings(p.meta.id);
    return { ...p.meta, mode: s.mode || 'none', allowedShops: s.allowedShops || [], simulated: s.mode === 'simulation', connected: s.mode && s.mode !== 'none' };
  });
}

export const PROVIDER_IDS = Object.keys(PROVIDERS);
