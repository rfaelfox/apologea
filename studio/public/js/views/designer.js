import { h, clear } from '../core.js';

/**
 * Platzier-Editor: Motiv direkt auf dem Produktfoto verschieben und skalieren – wie im Designer des Anbieters.
 *
 * Gespeichert wird genau das, was der Anbieter erwartet: Position der Motivmitte (xPercent, yPercent)
 * und Breite (widthPercent) als Anteil der Druckfläche. Das Produktfoto dient der Orientierung; wo die
 * Druckfläche auf dem Foto liegt, liefert der Anbieter nicht – der gestrichelte Rahmen ist eine
 * Annahme und kann über „Druckfläche auf dem Foto anpassen“ einmal je Produkt ausgerichtet werden.
 */

// Ungefähre Lage der benannten Logo-Positionen (nur Darstellung; Größe/Lage bestimmt der Anbieter)
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

/** Standardlage der Druckfläche auf einem Produktfoto (Anteile des Fotos). */
export function defaultFrame(area, imgW, imgH) {
  const w = 0.42;
  const hgt = w * (imgW / imgH) * (area.height / area.width);
  return { x: (1 - w) / 2, y: area.name === 'back' ? 0.2 : 0.22, w, h: hgt };
}

/**
 * Bühne für eine Druckfläche.
 * opts: { area, garmentUrl, frame, design, altDesign, showAlt, placement, disabled,
 *         onChange(placement), onCommit(placement), onFrameCommit(frame) }
 */
export function placementStage(opts) {
  const { area, disabled } = opts;
  let placement = opts.placement || { mode: 'auto' };
  let frame = opts.frame || null;
  let calibrating = false;

  const stage = h('div.stage', { style: { aspectRatio: '1 / 1' } });
  const img = opts.garmentUrl ? h('img.stage-photo', { src: opts.garmentUrl, alt: '', draggable: false }) : null;
  const frameEl = h('div.print-frame');
  const guideV = h('div.guide.v');
  const guideH = h('div.guide.h');
  const motifImg = h('img', { alt: '', draggable: false });
  const handle = h('span.handle', { title: 'Größe ändern' });
  const motif = h('div.motif', { tabindex: disabled ? -1 : 0, title: 'Ziehen zum Verschieben · Ecke ziehen zum Skalieren · Pfeiltasten zum Feinjustieren' }, motifImg, handle);
  const frameHandle = h('span.handle.frame-handle', { title: 'Druckfläche skalieren' });
  const label = h('span.stage-label', area.label || area.name);
  const dpiBadge = h('span.dpi-badge', { title: 'DPI-Prüfung: ab 200 DPI gut, 150–199 mittel, darunter schlecht (Druckfläche laut Anbieter ≙ 300 DPI)' });
  frameEl.append(guideV, guideH, motif, frameHandle);
  if (img) stage.append(img);
  stage.append(frameEl, label, dpiBadge);

  const design = () => (opts.showAlt && opts.altDesign ? opts.altDesign : opts.design);

  function layoutFrame() {
    const iw = img?.naturalWidth || 1000;
    const ih = img?.naturalHeight || 1000;
    stage.style.aspectRatio = `${iw} / ${ih}`;
    if (!frame) frame = img ? defaultFrame(area, iw, ih) : { x: 0.06, y: 0.06, w: 0.88, h: 0.88 * (area.height / area.width) };
    if (!img) stage.style.aspectRatio = `${area.width} / ${area.height * 1.12}`;
    Object.assign(frameEl.style, { left: `${frame.x * 100}%`, top: `${frame.y * 100}%`, width: `${frame.w * 100}%`, height: `${frame.h * 100}%` });
  }

  function layoutMotif() {
    const d = design();
    motif.classList.toggle('hidden', !d);
    const q = dpiInfo(placement, area, d);
    dpiBadge.className = `dpi-badge${q?.rating ? ' ' + q.rating : ''}${q ? '' : ' hidden'}`;
    dpiBadge.textContent = dpiText(q);
    if (!d) return;
    const g = effectiveGeometry(placement, area, d);
    const url = `/files/design/${d.id}/thumb`;
    if (motifImg.getAttribute('src') !== url) motifImg.src = url;
    Object.assign(motif.style, { left: `${(g.x - g.w / 2) * 100}%`, top: `${(g.y - g.h / 2) * 100}%`, width: `${g.w * 100}%`, height: `${g.h * 100}%` });
    const out = g.x - g.w / 2 < -0.002 || g.x + g.w / 2 > 1.002 || g.y - g.h / 2 < -0.002 || g.y + g.h / 2 > 1.002;
    motif.classList.toggle('out', out);
    motif.classList.toggle('named', placement.mode === 'named');
  }

  function toCustom() {
    const g = effectiveGeometry(placement, area, design());
    return fitToArea({ mode: 'custom', xPercent: r4(g.x), yPercent: r4(g.y), widthPercent: r4(g.w) }, area, design());
  }

  function update(p, commit) {
    placement = fitToArea(p, area, design());
    layoutMotif();
    opts.onChange?.(placement);
    if (commit) opts.onCommit?.(placement);
  }

  // ---- Motiv ziehen / skalieren
  let drag = null;
  motif.addEventListener('pointerdown', (e) => {
    if (disabled || calibrating || !design()) return;
    e.preventDefault();
    motif.focus();
    const rect = frameEl.getBoundingClientRect();
    const start = toCustom();
    drag = { kind: e.target === handle ? 'resize' : 'move', sx: e.clientX, sy: e.clientY, fw: rect.width, fh: rect.height, start };
    motif.setPointerCapture(e.pointerId);
    stage.classList.add('dragging');
  });
  motif.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.sx) / drag.fw;
    const dy = (e.clientY - drag.sy) / drag.fh;
    const s = drag.start;
    if (drag.kind === 'move') {
      let x = clamp(s.xPercent + dx, 0, 1);
      let y = clamp(s.yPercent + dy, 0, 1);
      const snapX = Math.abs(x - 0.5) < 0.015;
      const snapY = Math.abs(y - 0.5) < 0.015;
      if (snapX) x = 0.5;
      if (snapY) y = 0.5;
      guideV.classList.toggle('on', snapX);
      guideH.classList.toggle('on', snapY);
      update({ ...s, xPercent: r4(x), yPercent: r4(y) });
    } else {
      update({ ...s, widthPercent: r4(clamp(s.widthPercent + 2 * dx, 0.03, 1)) });
    }
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    guideV.classList.remove('on'); guideH.classList.remove('on');
    stage.classList.remove('dragging');
    opts.onCommit?.(placement);
  };
  motif.addEventListener('pointerup', endDrag);
  motif.addEventListener('pointercancel', endDrag);
  let keyTimer = null;
  motif.addEventListener('keydown', (e) => {
    if (disabled || !design()) return;
    const step = e.shiftKey ? 0.05 : 0.005;
    const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!map[e.key] && e.key !== '+' && e.key !== '-') return;
    e.preventDefault();
    const s = toCustom();
    if (map[e.key]) update({ ...s, xPercent: r4(clamp(s.xPercent + map[e.key][0], 0, 1)), yPercent: r4(clamp(s.yPercent + map[e.key][1], 0, 1)) });
    else update({ ...s, widthPercent: r4(clamp(s.widthPercent + (e.key === '+' ? 0.01 : -0.01), 0.03, 1)) });
    clearTimeout(keyTimer);
    keyTimer = setTimeout(() => opts.onCommit?.(placement), 500);
  });

  // ---- Druckfläche auf dem Foto ausrichten
  let fdrag = null;
  frameEl.addEventListener('pointerdown', (e) => {
    if (!calibrating) return;
    e.preventDefault();
    const rect = stage.getBoundingClientRect();
    fdrag = { kind: e.target === frameHandle ? 'resize' : 'move', sx: e.clientX, sy: e.clientY, sw: rect.width, sh: rect.height, start: { ...frame } };
    frameEl.setPointerCapture(e.pointerId);
  });
  frameEl.addEventListener('pointermove', (e) => {
    if (!fdrag) return;
    const dx = (e.clientX - fdrag.sx) / fdrag.sw;
    const dy = (e.clientY - fdrag.sy) / fdrag.sh;
    const s = fdrag.start;
    if (fdrag.kind === 'move') frame = { ...s, x: r4(s.x + dx), y: r4(s.y + dy) };
    else { const w = clamp(s.w + dx, 0.1, 1); frame = { ...s, w: r4(w), h: r4(s.h * (w / s.w)) }; }
    layoutFrame();
  });
  const endFrame = () => { if (fdrag) { fdrag = null; opts.onFrameCommit?.(frame); } };
  frameEl.addEventListener('pointerup', endFrame);
  frameEl.addEventListener('pointercancel', endFrame);

  if (img) img.addEventListener('load', () => { layoutFrame(); layoutMotif(); });
  layoutFrame();
  layoutMotif();

  return {
    el: stage,
    setPlacement(p, commit = false) { update(p, commit); },
    getPlacement: () => placement,
    toCustom,
    geometry: () => effectiveGeometry(placement, area, design()),
    setAlt(show) { opts.showAlt = show; layoutMotif(); },
    setGarment(url) { if (img && url && img.getAttribute('src') !== url) img.src = url; },
    setCalibrating(on) { calibrating = on; stage.classList.toggle('calibrating', on); },
    resetFrame() { frame = null; layoutFrame(); opts.onFrameCommit?.(null); },
  };
}

/** Kleine Schaltflächenleiste für schnelle Platzierungen. */
export function quickTools({ area, stageApi, namedPlacements, disabled, onCommit }) {
  const btn = (label, fn, title) => h('button.small.ghost', { type: 'button', disabled, title, onclick: () => { fn(); onCommit(stageApi.getPlacement()); } }, label);
  const custom = () => stageApi.toCustom();
  return h('div.row.tools',
    btn('Ganze Fläche', () => stageApi.setPlacement({ mode: 'auto' }), 'Automatisch einpassen und zentrieren (vollflächiger Druck)'),
    btn('Mittig', () => stageApi.setPlacement({ ...custom(), xPercent: 0.5 }), 'Horizontal zentrieren'),
    btn('Oben', () => { const c = custom(); const g = stageApi.geometry(); stageApi.setPlacement({ ...c, yPercent: r4(Math.min(0.5, g.h / 2 + 0.02)) }); }, 'Motiv an den oberen Rand der Druckfläche'),
    btn('−', () => { const c = custom(); stageApi.setPlacement({ ...c, widthPercent: r4(clamp(c.widthPercent - 0.05, 0.03, 1)) }); }, 'Kleiner'),
    btn('+', () => { const c = custom(); stageApi.setPlacement({ ...c, widthPercent: r4(clamp(c.widthPercent + 0.05, 0.03, 1)) }); }, 'Größer'),
    ...(namedPlacements || []).map((n) => btn(n.l, () => stageApi.setPlacement({ mode: 'named', named: n.v }), 'Feste Logo-Position des Anbieters')));
}

/** Zahlenanzeige/-eingabe der Platzierung. */
export function placementReadout({ stageApi, disabled, onCommit }) {
  const box = h('div.readout');
  const field = (key, label) => {
    const inp = h('input', { type: 'number', min: 0, max: 100, step: 0.5, disabled });
    inp.addEventListener('change', () => {
      const c = stageApi.toCustom();
      const v = clamp(Number(inp.value) / 100, key === 'widthPercent' ? 0.03 : 0, 1);
      stageApi.setPlacement({ ...c, [key]: r4(v) }, false);
      onCommit(stageApi.getPlacement());
    });
    return { inp, el: h('label.mini', h('span', label), inp, h('span.muted', '%')) };
  };
  const fx = field('xPercent', 'Mitte X');
  const fy = field('yPercent', 'Mitte Y');
  const fw = field('widthPercent', 'Breite');
  const mode = h('small.muted');
  clear(box, fx.el, fy.el, fw.el, mode);
  return {
    el: box,
    show(p) {
      const named = p.mode === 'named';
      const auto = p.mode === 'auto' || !p.mode;
      for (const f of [fx, fy, fw]) f.inp.disabled = disabled || named;
      if (p.mode === 'custom') { fx.inp.value = (p.xPercent * 100).toFixed(1); fy.inp.value = (p.yPercent * 100).toFixed(1); fw.inp.value = (p.widthPercent * 100).toFixed(1); }
      else { fx.inp.value = ''; fy.inp.value = ''; fw.inp.value = ''; }
      mode.textContent = named ? 'Feste Logo-Position: Größe und Lage bestimmt der Anbieter.' : auto ? 'Ganze Fläche: automatisch eingepasst und zentriert.' : 'Frei platziert – das Motiv bleibt immer innerhalb der Druckfläche des Anbieters; genau diese Werte werden übertragen.';
    },
  };
}
