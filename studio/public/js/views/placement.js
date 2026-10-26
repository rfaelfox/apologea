/**
 * Platzierung und Druckqualität – reine Berechnungen (keine Oberfläche).
 * Gespeichert wird genau das Format des Anbieters: Mitte (xPercent, yPercent) und Breite (widthPercent)
 * als Anteil der Druckfläche.
 */

// Ungefähre Größe der festen Logo-Positionen (nur für die DPI-Schätzung; Größe/Lage bestimmt der Anbieter)
export const NAMED_GEOMETRY = {
  'small-left-chest': { x: 0.7, y: 0.18, w: 0.22 },
  'small-center-chest': { x: 0.5, y: 0.18, w: 0.22 },
  'small-right-chest': { x: 0.3, y: 0.18, w: 0.22 },
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r4 = (v) => Math.round(v * 10000) / 10000;

/** Wirksame Geometrie (Mitte + Breite als Anteil der Druckfläche) für jede Platzierungsart. */
export function effectiveGeometry(placement, area, design) {
  const iw = design?.analysis?.width;
  const ih = design?.analysis?.height;
  const ratio = iw && ih ? ih / iw : 1;
  const mode = placement?.mode || 'auto';
  let x = 0.5; let y = 0.5; let w;
  if (mode === 'custom') ({ xPercent: x, yPercent: y, widthPercent: w } = placement);
  else if (mode === 'named') ({ x, y, w } = NAMED_GEOMETRY[placement.named] || NAMED_GEOMETRY['small-center-chest']);
  else w = Math.min(1, (area.height / area.width) / ratio);
  const hFrac = w * (area.width / area.height) * ratio; // Höhe als Anteil der Druckflächenhöhe
  return { x, y, w, h: hFrac, ratio };
}

/**
 * Hält ein frei platziertes Motiv vollständig innerhalb der Druckfläche, so wie der Anbieter sie vorgibt:
 * Breite höchstens so groß, dass auch die Höhe passt; Mitte so, dass kein Rand übersteht.
 */
export function fitToArea(p, area, design) {
  if (p?.mode !== 'custom') return p;
  const iw = design?.analysis?.width;
  const ih = design?.analysis?.height;
  const ratio = iw && ih ? ih / iw : 1;
  const maxW = Math.min(1, (area.height / area.width) / ratio);
  const w = clamp(p.widthPercent, Math.min(0.03, maxW), maxW);
  const hFrac = w * (area.width / area.height) * ratio;
  return {
    mode: 'custom',
    xPercent: r4(clamp(p.xPercent, w / 2, 1 - w / 2)),
    yPercent: r4(clamp(p.yPercent, hFrac / 2, 1 - hFrac / 2)),
    widthPercent: r4(w),
  };
}

// DPI-Prüfung (gleiche Regeln wie auf dem Server, src/server/images.js):
// Druckflächen-Pixel laut Anbieter ≙ 300 DPI; ab 200 DPI gut, 150–199 mittel, darunter schlecht.
const AREA_DPI = 300;
export function dpiInfo(placement, area, design) {
  if (!design) return null;
  if (design.analysis?.vector) return { vector: true, rating: 'gut' };
  const iw = design.analysis?.width;
  if (!iw) return null;
  if (placement?.mode === 'named') return { named: true };
  const g = effectiveGeometry(placement, area, design);
  const inches = (g.w * area.width) / AREA_DPI;
  const dpi = Math.round(iw / inches);
  return {
    dpi,
    rating: dpi >= 200 ? 'gut' : dpi >= 150 ? 'mittel' : 'schlecht',
    widthCm: inches * 2.54,
    heightCm: ((g.h * area.height) / AREA_DPI) * 2.54,
  };
}
const cm = (v) => v.toFixed(1).replace('.', ',');
export function dpiText(info) {
  if (!info) return '';
  if (info.vector) return 'Vektor · gut';
  if (info.named) return 'DPI: Größe legt der Anbieter fest';
  return `${info.dpi} DPI · ${info.rating} · ${cm(info.widthCm)} × ${cm(info.heightCm)} cm`;
}

/** Größe der Druckfläche in cm (Annahme: Pixel des Anbieters ≙ 300 DPI). */
export function areaCm(area) {
  return { w: (area.width / AREA_DPI) * 2.54, h: (area.height / AREA_DPI) * 2.54 };
}
export const fmtCm = (v) => cm(v);

/**
 * Maximale Größe eines Motivs auf dieser Druckfläche:
 *  fit  – größtmöglich in der Druckfläche (Seitenverhältnis bleibt erhalten)
 *  good – größtmöglich, solange die DPI-Prüfung noch „gut“ ist (ab 200 DPI)
 */
export function motifMaxCm(area, design) {
  const a = areaCm(area);
  const iw = design?.analysis?.width;
  const ih = design?.analysis?.height;
  if (!iw || !ih) return { area: a, fit: null, good: null };
  const s = Math.min(a.w / iw, a.h / ih);
  const fit = { w: iw * s, h: ih * s };
  const goodW = Math.min(fit.w, (iw / 200) * 2.54);
  const good = design.analysis.vector ? fit : { w: goodW, h: goodW * (ih / iw) };
  return { area: a, fit, good };
}

