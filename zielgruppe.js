/* APOLOGEA – Zielgruppe eines Pieces (Mann / Frau / Unisex)
   Gemeinsam für Handy-App und PC-Programm. Gespeichert in Produktdaten.json als „zielgruppe“: "mann" | "frau" | "unisex" | "" (offen). */
'use strict';

const ZG = (() => {
  const LIST = [['mann', 'Mann'], ['frau', 'Frau'], ['unisex', 'Unisex']];
  const LABEL = { mann: 'Mann', frau: 'Frau', unisex: 'Unisex' };
  // Filter: „Mann“ und „Frau“ zeigen Unisex-Pieces mit an, „Unisex“ und „Ohne Zuordnung“ nur genau diese
  const FILTERS = [['', 'Alle'], ['mann', 'Mann'], ['frau', 'Frau'], ['unisex', 'Unisex'], ['offen', 'Ohne Zuordnung']];
  const simple = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
  const WORDS = {
    frau: ['frau', 'frauen', 'damen', 'dame', 'women', 'womens', 'woman', 'ladies', 'lady', 'female', 'girls', 'wmns'],
    mann: ['mann', 'manner', 'maenner', 'herren', 'herr', 'men', 'mens', 'male', 'boys'],
    unisex: ['unisex']
  };

  /** Gespeicherten oder eingegebenen Wert vereinheitlichen; Unbekanntes → "" */
  function norm(v) {
    const s = simple(v).trim();
    if (!s) return '';
    if (LABEL[s]) return s;
    for (const k of Object.keys(WORDS)) if (WORDS[k].includes(s)) return k;
    return '';
  }

  /** Aus Ordnernamen erraten (z. B. „Damen/Hoodies“) – nur ganze Wörter, „Women“ wird nicht als „Men“ gelesen */
  function guess(segments) {
    const found = new Set();
    (segments || []).forEach(seg => simple(seg).split(/[^a-z]+/).forEach(w => {
      for (const k of Object.keys(WORDS)) if (WORDS[k].includes(w)) found.add(k);
    }));
    if (found.has('unisex') || (found.has('mann') && found.has('frau'))) return 'unisex';
    return found.has('frau') ? 'frau' : found.has('mann') ? 'mann' : '';
  }

  function matches(v, filter) {
    if (!filter) return true;
    if (filter === 'offen') return !v;
    if (filter === 'unisex') return v === 'unisex';
    return v === filter || v === 'unisex';
  }

  const label = v => LABEL[v] || '';
  return { LIST, FILTERS, norm, guess, matches, label };
})();
