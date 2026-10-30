/* APOLOGEA – Zielgruppe eines Pieces (Mann / Frau / Unisex)
   Gemeinsam für Handy-App und PC-Programm. Gespeichert in Produktdaten.json als „zielgruppe“: "mann" | "frau" | "unisex" | "" (offen). */
'use strict';

const ZG = (() => {
  const LIST = [['mann', 'Mann'], ['frau', 'Frau'], ['unisex', 'Unisex']];
  const LABEL = { mann: 'Mann', frau: 'Frau', unisex: 'Unisex' };
  // Filter zeigen genau die jeweilige Gruppe (Unisex = Mockups mit Mann und Frau)
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
    return v === filter;
  }

  /** Zuordnungsliste von Claude einlesen: {"format":"APOLOGEA-Zielgruppen/1","zuordnung":[{"nummer":12,"name":"SIGNUM","zielgruppe":"mann"}]}
      Zuordnung über die Nummer; steht ein Name dabei, muss er passen (sonst übersprungen). */
  function parseFile(text, pieces) {
    let d;
    try { d = JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch (e) { throw new Error('Die Datei ist keine gültige Zuordnungsliste (JSON).'); }
    const list = Array.isArray(d) ? d : d && Array.isArray(d.zuordnung) ? d.zuordnung : null;
    if (!list) throw new Error('In der Datei wurde keine Zuordnung gefunden.');
    const key = s => simple(s).replace(/[^a-z0-9]+/g, '');
    const res = { changes: [], missing: [], mismatch: [], invalid: [] };
    list.forEach(e => {
      const nr = parseInt(e && e.nummer, 10), zg = norm(e && e.zielgruppe);
      if (!nr || (!zg && String(e.zielgruppe || '').trim())) { res.invalid.push(e); return; }
      const p = pieces.find(x => x.nummer === nr);
      if (!p) { res.missing.push(e); return; }
      if (e.name && key(e.name) !== key(p.name)) { res.mismatch.push({ e, p }); return; }
      res.changes.push({ piece: p, zg });
    });
    return res;
  }

  const label = v => LABEL[v] || '';
  return { LIST, FILTERS, norm, guess, matches, label, parseFile };
})();
