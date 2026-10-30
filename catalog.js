/* APOLOGEA Handy-App – Katalog als PDF
   Jede Seite wird auf einer Zeichenfläche (A4, ca. 200 dpi) gestaltet und als Bild in eine PDF gesetzt.
   Ohne fremde Bibliothek; Schriften (OFL) und Logo liegen im Ordner catalog/. */
'use strict';

const Catalog = (() => {
  const W = 1654, H = 2339, M = 120;
  const C = {
    bg: '#080808', panel: '#121110', panel2: '#191714', gold: '#B39659', goldL: '#D9BC85', ivory: '#E6D5B8', white: '#F3F0EA',
    muted: '#A1988A', faint: '#6B655B', line: 'rgba(179,150,89,.38)', lineF: 'rgba(179,150,89,.14)', grid: 'rgba(179,150,89,.045)'
  };
  const F = {
    serif: '"APG Cormorant", "Palatino Linotype", Palatino, Georgia, serif',
    sans: '"APG Inter", -apple-system, "Segoe UI", system-ui, sans-serif',
    mono: '"APG Mono", ui-monospace, Menlo, Consolas, monospace'
  };
  const LAYOUTS = {
    kompakt: { cols: 3, gap: 40, imgH: 450, textH: 140, rowGap: 40, desc: false },
    gross: { cols: 2, gap: 56, imgH: 520, textH: 290, rowGap: 44, desc: true }
  };
  const HEAD_Y = M, CONTENT_Y = M + 110, FOOT_Y = H - M + 10, CONTENT_BOTTOM = H - M - 60, SECTION_H = 200;

  // ---------------------------------------------------------------- Schriften und Logo
  let assets = null;
  async function loadAssets() {
    if (assets) return assets;
    const fonts = [
      ['APG Cormorant', 'cormorant-garamond-latin-500-normal.woff2', '500'], ['APG Cormorant', 'cormorant-garamond-latin-600-normal.woff2', '600'],
      ['APG Inter', 'inter-latin-400-normal.woff2', '400'], ['APG Inter', 'inter-latin-500-normal.woff2', '500'],
      ['APG Mono', 'jetbrains-mono-latin-400-normal.woff2', '400'], ['APG Mono', 'jetbrains-mono-latin-500-normal.woff2', '500']
    ];
    await Promise.all(fonts.map(async ([fam, file, weight]) => {
      try { const f = new FontFace(fam, `url(catalog/fonts/${file})`, { weight }); await f.load(); document.fonts.add(f); } catch (e) { /* Ersatzschrift */ }
    }));
    const img = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
    const [emblem, wordmark] = await Promise.all([img('catalog/emblem.svg'), img('catalog/wordmark.svg')]);
    assets = { emblem, wordmark };
    return assets;
  }

  // ---------------------------------------------------------------- Durchsuchbarer Text (unsichtbar über dem Seitenbild)
  let notes = [];
  const note = (text, x, y, size, w) => { text = String(text || '').replace(/\s+/g, ' ').trim(); if (text) notes.push({ text, x, y, size, w: w || W - M - x }); };

  // ---------------------------------------------------------------- Zeichenhilfen
  const setFont = (g, weight, size, fam) => { g.font = `${weight} ${size}px ${fam}`; };
  /** Text mit Laufweite (manuell, da letterSpacing nicht überall unterstützt wird) */
  function tracked(g, text, x, y, track, align) {
    text = String(text);
    const chars = [...text];
    const widths = chars.map(c => g.measureText(c).width);
    const total = widths.reduce((a, b) => a + b, 0) + track * Math.max(0, chars.length - 1);
    let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    const prev = g.textAlign; g.textAlign = 'left';
    chars.forEach((c, i) => { g.fillText(c, cx, y); cx += widths[i] + track; });
    g.textAlign = prev;
    return total;
  }
  const trackedWidth = (g, text, track) => { const ch = [...String(text)]; return ch.reduce((a, c) => a + g.measureText(c).width, 0) + track * Math.max(0, ch.length - 1); };
  function ellipsize(g, text, maxW) {
    text = String(text || '');
    if (g.measureText(text).width <= maxW) return text;
    while (text.length > 1 && g.measureText(text + '…').width > maxW) text = text.slice(0, -1);
    return text.trimEnd() + '…';
  }
  function wrap(g, text, maxW, maxLines) {
    const out = [];
    String(text || '').replace(/\r/g, '').split('\n').forEach(par => {
      const words = par.split(/\s+/).filter(Boolean);
      let line = '';
      words.forEach(w => {
        const t = line ? line + ' ' + w : w;
        if (g.measureText(t).width <= maxW || !line) line = t; else { out.push(line); line = w; }
      });
      if (line) out.push(line);
    });
    if (out.length > maxLines) { const cut = out.slice(0, maxLines); cut[maxLines - 1] = ellipsize(g, cut[maxLines - 1] + ' …', maxW); return cut; }
    return out;
  }
  /** Schriftgröße verkleinern, bis der Text passt */
  function fit(g, text, maxW, size, min, weight, fam, track) {
    for (let s = size; s >= min; s -= 2) { setFont(g, weight, s, fam); if (trackedWidth(g, text, track * s / size) <= maxW) return { size: s, track: track * s / size, text }; }
    setFont(g, weight, min, fam);
    return { size: min, track: track * min / size, text: ellipsize(g, text, maxW - track * text.length) };
  }
  function line(g, x1, y1, x2, y2, color, w) { g.strokeStyle = color; g.lineWidth = w || 1.5; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
  function brackets(g, x, y, w, h, len, color, lw) {
    g.strokeStyle = color; g.lineWidth = lw || 2; g.beginPath();
    [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]].forEach(([px, py, sx, sy]) => { g.moveTo(px, py + sy * len); g.lineTo(px, py); g.lineTo(px + sx * len, py); });
    g.stroke();
  }
  /** Feine Linie mit Skalenstrichen (dezent futuristisch) */
  function tickRule(g, x1, x2, y, color) {
    line(g, x1, y, x2, y, color, 1.5);
    g.strokeStyle = color; g.lineWidth = 1.5; g.beginPath();
    for (let x = x1, i = 0; x <= x2 + 0.5; x += (x2 - x1) / 40, i++) { const l = i % 10 === 0 ? 12 : i % 5 === 0 ? 8 : 4; g.moveTo(x, y); g.lineTo(x, y + l); }
    g.stroke();
  }
  function background(g) {
    g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
    g.strokeStyle = C.grid; g.lineWidth = 1; g.beginPath();
    for (let x = M; x <= W - M + 1; x += (W - 2 * M) / 12) { g.moveTo(x, 0); g.lineTo(x, H); }
    for (let y = 0; y <= H; y += (W - 2 * M) / 12) { g.moveTo(0, y); g.lineTo(W, y); }
    g.stroke();
  }
  function contain(g, img, x, y, w, h, pad) {
    const iw = img.width, ih = img.height, s = Math.min((w - 2 * pad) / iw, (h - 2 * pad) / ih);
    const dw = iw * s, dh = ih * s;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  function drawLogo(g, img, cx, cy, w) { if (!img) return 0; const h = w * img.height / img.width; g.drawImage(img, cx - w / 2, cy - h / 2, w, h); return h; }

  // ---------------------------------------------------------------- Seitenteile
  function header(g, o, page, pages) {
    setFont(g, 500, 22, F.mono); g.fillStyle = C.gold; g.textBaseline = 'alphabetic';
    const aw = tracked(g, 'APOLOGEA', M, HEAD_Y + 26, 9, 'left');
    g.fillStyle = C.faint; tracked(g, '/  ' + o.title.toUpperCase(), M + aw + 22, HEAD_Y + 26, 4, 'left');
    g.fillStyle = C.muted; tracked(g, String(page).padStart(2, '0') + ' / ' + String(pages).padStart(2, '0'), W - M, HEAD_Y + 26, 4, 'right');
    tickRule(g, M, W - M, HEAD_Y + 52, C.lineF);
  }
  function footer(g, o) {
    line(g, M, FOOT_Y, W - M, FOOT_Y, C.lineF, 1.5);
    setFont(g, 400, 19, F.mono); g.fillStyle = C.faint;
    if (o.contact) tracked(g, o.contact.toUpperCase(), M, FOOT_Y + 38, 3, 'left');
    tracked(g, '© ' + new Date().getFullYear() + ' APOLOGEA · ' + o.edition.toUpperCase(), W - M, FOOT_Y + 38, 3, 'right');
  }
  /** Abschnittskopf: s = { nr, label, name, count } – ohne nr kein großes Kapitelzeichen */
  function section(g, y, s) {
    g.textBaseline = 'alphabetic';
    let nx = M;
    if (s.nr) {
      setFont(g, 500, 150, F.mono); g.strokeStyle = 'rgba(179,150,89,.55)'; g.lineWidth = 2;
      g.strokeText(s.nr, M - 6, y + 140);
      nx = M + g.measureText(s.nr).width + 40;
    }
    setFont(g, 500, 21, F.mono); g.fillStyle = C.gold;
    tracked(g, s.label, nx, y + 52, 6, 'left');
    const f = fit(g, s.name.toUpperCase(), W - M - nx - 260, 84, 48, 600, F.serif, 10);
    g.fillStyle = C.ivory; tracked(g, f.text, nx, y + 138, f.track, 'left');
    note(`${s.name} (${s.count} ${s.count === 1 ? 'Piece' : 'Pieces'})`, nx, y + 138, f.size);
    setFont(g, 500, 21, F.mono); g.fillStyle = C.muted;
    tracked(g, `${s.count} ${s.count === 1 ? 'PIECE' : 'PIECES'}`, W - M, y + 138, 5, 'right');
    line(g, M, y + 172, W - M, y + 172, C.line, 1.5);
    g.fillStyle = C.gold; g.fillRect(M, y + 169, 90, 6);
  }
  function continued(g, y, name) {
    setFont(g, 500, 19, F.mono); g.fillStyle = C.muted;
    const w = tracked(g, name.toUpperCase() + '  ·  FORTSETZUNG', M, y + 24, 5, 'left');
    line(g, M + w + 24, y + 17, W - M, y + 17, C.lineF, 1.5);
  }

  function card(g, L, x, y, w, it) {
    const p = it.piece, ih = L.imgH;
    g.fillStyle = C.panel; g.fillRect(x, y, w, ih);
    g.strokeStyle = C.lineF; g.lineWidth = 1.5; g.strokeRect(x + .75, y + .75, w - 1.5, ih - 1.5);
    if (it.img) contain(g, it.img, x, y, w, ih, 22);
    else {
      g.save(); g.globalAlpha = .08; drawLogo(g, assets.emblem, x + w / 2, y + ih / 2 - 16, Math.min(w, ih) * .42); g.restore();
      setFont(g, 500, 19, F.mono); g.fillStyle = C.faint; tracked(g, 'BILD FOLGT', x + w / 2, y + ih / 2 + Math.min(w, ih) * .28, 6, 'center');
    }
    brackets(g, x + 12, y + 12, w - 24, ih - 24, 24, 'rgba(179,150,89,.6)', 2);
    if (p.zielgruppe) {
      const zl = ZG.label(p.zielgruppe).toUpperCase();
      setFont(g, 500, 16, F.mono);
      const zw = trackedWidth(g, zl, 4) + 24;
      g.fillStyle = 'rgba(8,8,8,.78)'; g.fillRect(x + 26, y + 26, zw, 34);
      g.strokeStyle = 'rgba(179,150,89,.55)'; g.lineWidth = 1.5; g.strokeRect(x + 26, y + 26, zw, 34);
      g.fillStyle = C.gold; tracked(g, zl, x + 26 + zw / 2, y + 49, 4, 'center');
    }
    if (p.entwurf) {
      setFont(g, 500, 16, F.mono);
      const tw = trackedWidth(g, 'ENTWURF', 4) + 24;
      g.fillStyle = 'rgba(8,8,8,.78)'; g.fillRect(x + w - tw - 26, y + 26, tw, 34);
      g.strokeStyle = C.line; g.lineWidth = 1.5; g.strokeRect(x + w - tw - 26, y + 26, tw, 34);
      g.fillStyle = C.muted; tracked(g, 'ENTWURF', x + w - 26 - tw / 2, y + 49, 4, 'center');
    }
    let ty = y + ih + 40;
    setFont(g, 500, 20, F.mono); g.fillStyle = C.gold;
    tracked(g, 'N° ' + String(p.nummer).padStart(3, '0'), x, ty, 4, 'left');
    g.fillStyle = C.faint; setFont(g, 400, 17, F.mono);
    if (p.serie) tracked(g, ellipsize(g, p.serie.toUpperCase(), w * .6), x + w, ty, 2, 'right');
    ty += 52;
    const f = fit(g, (p.name || '').toUpperCase(), w, L.desc ? 46 : 38, L.desc ? 30 : 26, 600, F.serif, 3);
    g.fillStyle = C.ivory; tracked(g, f.text, x, ty, f.track, 'left');
    note(`N° ${String(p.nummer).padStart(3, '0')} ${p.name}${p.motivtitel ? ' – ' + p.motivtitel : ''} · ${p.kategorie}${p.zielgruppe ? ' · ' + ZG.label(p.zielgruppe) : ''}${p.serie ? ' · ' + p.serie : ''}${p.entwurf ? ' · Entwurf' : ''}`, x, ty, f.size, w);
    if (p.motivtitel) { ty += 36; setFont(g, 400, L.desc ? 23 : 21, F.sans); g.fillStyle = C.muted; g.fillText(ellipsize(g, p.motivtitel, w), x, ty); }
    if (L.desc && p.beschreibung) {
      ty += 22; line(g, x, ty, x + 60, ty, C.line, 1.5);
      setFont(g, 400, 21, F.sans); g.fillStyle = 'rgba(230,213,184,.82)';
      wrap(g, p.beschreibung, w, p.motivtitel ? 4 : 5).forEach(l => { ty += 31; g.fillText(l, x, ty); note(l, x, ty, 21, w); });
    }
  }

  function cover(g, o, stats) {
    background(g);
    const cx = W / 2, cy = 860;
    const glow = g.createRadialGradient(cx, cy, 40, cx, cy, 900);
    glow.addColorStop(0, 'rgba(179,150,89,.20)'); glow.addColorStop(.45, 'rgba(179,150,89,.06)'); glow.addColorStop(1, 'rgba(179,150,89,0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    // Ringe mit Skala um das Emblem
    g.strokeStyle = 'rgba(179,150,89,.30)'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, 390, 0, Math.PI * 2); g.stroke();
    g.setLineDash([3, 14]); g.strokeStyle = 'rgba(179,150,89,.32)'; g.beginPath(); g.arc(cx, cy, 455, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    g.strokeStyle = 'rgba(179,150,89,.10)'; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, 540, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(179,150,89,.45)'; g.lineWidth = 2; g.beginPath();
    for (let a = 0; a < 360; a += 6) {
      const r1 = 390, r2 = a % 90 === 0 ? 428 : a % 30 === 0 ? 414 : 400, t = a * Math.PI / 180;
      g.moveTo(cx + Math.cos(t) * r1, cy + Math.sin(t) * r1); g.lineTo(cx + Math.cos(t) * r2, cy + Math.sin(t) * r2);
    }
    g.stroke();
    drawLogo(g, assets.emblem, cx, cy, 500);
    // Kopfzeile
    setFont(g, 500, 22, F.mono); g.fillStyle = C.gold; g.textBaseline = 'alphabetic';
    tracked(g, o.collection ? 'APOLOGEA — COLLECTION' : 'APOLOGEA — CATALOGUE', M, M + 30, 8, 'left');
    g.fillStyle = C.muted; tracked(g, o.edition.toUpperCase(), W - M, M + 30, 5, 'right');
    tickRule(g, M, W - M, M + 58, C.lineF);
    // Schriftzug, Titel, Leitsatz
    if (assets.wordmark) drawLogo(g, assets.wordmark, cx, 1500, 980);
    else { setFont(g, 600, 120, F.serif); g.fillStyle = C.goldL; tracked(g, 'APOLOGEA', cx, 1540, 28, 'center'); }
    const t = fit(g, o.title.toUpperCase(), W - 2 * M, 60, 36, 500, F.serif, 16);
    g.fillStyle = C.ivory; tracked(g, t.text, cx, 1660, t.track, 'center');
    note('APOLOGEA ' + o.title + ' · ' + o.edition, M, 1660, t.size);
    setFont(g, 500, 24, F.mono); g.fillStyle = C.gold;
    tracked(g, 'FAITH IS NOT SILENT.', cx, 1730, 10, 'center');
    if (o.collection && o.collection.beschreibung) {
      setFont(g, 400, 26, F.sans); g.fillStyle = C.muted; g.textAlign = 'center';
      wrap(g, o.collection.beschreibung, W - 2 * M - 200, 3).forEach((l, i) => { g.fillText(l, cx, 1800 + i * 38); note(l, M, 1800 + i * 38, 26); });
      g.textAlign = 'left';
    }
    // Kennzahlen
    const drop = o.collection && o.collection.drop ? new Date(o.collection.drop + 'T12:00:00') : null;
    const y0 = H - M - 330, cols = [[stats.pieces, stats.pieces === 1 ? 'PIECE' : 'PIECES'], [stats.cats, stats.cats === 1 ? 'KLEIDUNGSTYP' : 'KLEIDUNGSTYPEN'], drop && !isNaN(drop) ? [drop.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }), 'DROP'] : [stats.date, 'STAND']];
    line(g, M, y0, W - M, y0, C.line, 1.5);
    const cw = (W - 2 * M) / 3;
    cols.forEach(([v, l], i) => {
      const x = M + cw * i + cw / 2;
      if (i) line(g, M + cw * i, y0 + 40, M + cw * i, y0 + 190, C.lineF, 1.5);
      setFont(g, 500, i === 2 ? 58 : 84, F.serif); g.fillStyle = C.ivory; g.textAlign = 'center'; g.fillText(String(v), x, y0 + 130); g.textAlign = 'left';
      setFont(g, 500, 19, F.mono); g.fillStyle = C.muted; tracked(g, l, x, y0 + 180, 6, 'center');
    });
    line(g, M, y0 + 230, W - M, y0 + 230, C.line, 1.5);
    if (o.contact) { setFont(g, 400, 21, F.mono); g.fillStyle = C.faint; tracked(g, o.contact.toUpperCase(), cx, H - M + 4, 5, 'center'); }
    brackets(g, 56, 56, W - 112, H - 112, 70, 'rgba(179,150,89,.5)', 2);
  }

  function backCover(g, o) {
    background(g);
    const glow = g.createRadialGradient(W / 2, H / 2 - 100, 20, W / 2, H / 2 - 100, 700);
    glow.addColorStop(0, 'rgba(179,150,89,.14)'); glow.addColorStop(1, 'rgba(179,150,89,0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    drawLogo(g, assets.emblem, W / 2, H / 2 - 220, 300);
    setFont(g, 500, 56, F.serif); g.fillStyle = C.ivory; g.textBaseline = 'alphabetic';
    tracked(g, 'NOT JUST CLOTHING.', W / 2, H / 2 + 60, 10, 'center');
    tracked(g, 'A TESTIMONY.', W / 2, H / 2 + 136, 10, 'center');
    line(g, W / 2 - 60, H / 2 + 200, W / 2 + 60, H / 2 + 200, C.line, 1.5);
    setFont(g, 500, 22, F.mono); g.fillStyle = C.gold;
    if (o.contact) tracked(g, o.contact.toUpperCase(), W / 2, H / 2 + 270, 6, 'center');
    setFont(g, 400, 18, F.mono); g.fillStyle = C.faint;
    tracked(g, 'KATALOG ERSTELLT AM ' + new Date().toLocaleDateString('de-DE'), W / 2, H - M - 20, 4, 'center');
    brackets(g, 56, 56, W - 112, H - 112, 70, 'rgba(179,150,89,.5)', 2);
  }

  function indexRows(g, y, rows) {
    const cols = [M, M + 140, M + 640, M + 1110, W - M];
    setFont(g, 500, 17, F.mono); g.fillStyle = C.faint;
    ['N°', 'NAME', 'MOTIV', 'KLEIDUNGSTYP', 'STATUS'].forEach((h, i) => tracked(g, h, i === 4 ? cols[4] : cols[i], y, 4, i === 4 ? 'right' : 'left'));
    line(g, M, y + 18, W - M, y + 18, C.line, 1.5);
    y += 18;
    rows.forEach((p, i) => {
      if (i % 2 === 0) { g.fillStyle = 'rgba(255,255,255,.022)'; g.fillRect(M, y, W - 2 * M, 46); }
      const by = y + 31;
      note(`${String(p.nummer).padStart(3, '0')} ${p.name} ${p.motivtitel || ''} ${p.kategorie} ${p.status}`, cols[0], by, 22);
      setFont(g, 500, 19, F.mono); g.fillStyle = C.gold; g.fillText(String(p.nummer).padStart(3, '0'), cols[0], by);
      setFont(g, 600, 26, F.serif); g.fillStyle = C.ivory; g.fillText(ellipsize(g, (p.name || '').toUpperCase(), 470), cols[1], by);
      setFont(g, 400, 19, F.sans); g.fillStyle = C.muted; g.fillText(ellipsize(g, p.motivtitel || '–', 440), cols[2], by);
      setFont(g, 400, 17, F.mono); g.fillStyle = C.muted; g.fillText(ellipsize(g, p.kategorie.toUpperCase(), 250), cols[3], by);
      g.fillStyle = p.status === 'Vollständig' ? C.gold : C.faint; g.textAlign = 'right'; g.fillText(p.status === 'Vollständig' ? 'FERTIG' : p.status.toUpperCase(), cols[4], by); g.textAlign = 'left';
      y += 46;
    });
  }

  // ---------------------------------------------------------------- Seitenplan
  function plan(pieces, o) {
    const L = LAYOUTS[o.layout] || LAYOUTS.kompakt;
    const rowH = L.imgH + L.textH + L.rowGap;
    let cats = [];
    if (o.collection) cats = [{ name: o.collection.name, list: pieces.slice(), label: 'KOLLEKTION' }]; // Reihenfolge der Kollektion beibehalten
    else {
      // Gliederung nach Kleidungstyp oder nach Mann / Frau / Unisex (dann je Kleidungstyp)
      const ZORD = { mann: 0, frau: 1, unisex: 2, '': 3 };
      const keyOf = p => o.group === 'zg' ? (ZG.label(p.zielgruppe) || 'Ohne Zuordnung') + ' · ' + p.kategorie : p.kategorie;
      pieces.forEach(p => { const k = keyOf(p); let c = cats.find(x => x.name === k); if (!c) cats.push(c = { name: k, zo: ZORD[p.zielgruppe || ''], kat: p.kategorie, list: [] }); c.list.push(p); });
      cats.sort((a, b) => o.group === 'zg' ? a.zo - b.zo || a.kat.localeCompare(b.kat, 'de') : a.name.localeCompare(b.name, 'de'));
      cats.forEach(c => c.list.sort((a, b) => a.nummer - b.nummer));
    }
    const pages = [{ type: 'cover' }];
    let cur = null, y = 0;
    const newPage = () => { cur = { type: 'grid', blocks: [] }; pages.push(cur); y = CONTENT_Y; };
    const fits = h => y + h <= CONTENT_BOTTOM;
    newPage();
    cats.forEach((c, ci) => {
      const gapBefore = y > CONTENT_Y ? 60 : 0;
      if (!fits(gapBefore + SECTION_H + rowH - L.rowGap)) newPage(); else y += gapBefore;
      const nr = String(ci + 1).padStart(2, '0');
      cur.blocks.push({ kind: 'section', y, s: c.label ? { label: c.label, name: c.name, count: c.list.length } : { nr, label: `KAPITEL ${nr} / ${String(cats.length).padStart(2, '0')}`, name: c.name, count: c.list.length } });
      y += SECTION_H;
      for (let i = 0; i < c.list.length; i += L.cols) {
        if (!fits(rowH - L.rowGap)) { newPage(); cur.blocks.push({ kind: 'cont', y, name: c.name }); y += 50; }
        cur.blocks.push({ kind: 'row', y, items: c.list.slice(i, i + L.cols) });
        y += rowH;
      }
    });
    if (o.index) {
      const all = cats.flatMap(c => c.list);
      let i = 0, first = true;
      while (i < all.length) {
        const top = first ? CONTENT_Y + SECTION_H + 30 : CONTENT_Y + 30;
        const n = Math.floor((CONTENT_BOTTOM - top - 30) / 46);
        pages.push({ type: 'index', first, top, rows: all.slice(i, i + n), total: all.length });
        i += n; first = false;
      }
    }
    pages.push({ type: 'back' });
    return { pages, cats, L };
  }

  // ---------------------------------------------------------------- Bilder laden (seitenweise, damit der Speicher reicht)
  const ORDER = r => [r, 'mockup', 'design', 'kleidungsansicht'].filter((x, i, a) => a.indexOf(x) === i);
  function pickImage(p, role) { for (const r of ORDER(role)) { const b = p.bilder[r]; if (b && b.item) return b.item; } return null; }
  async function decode(blob) {
    try { return await createImageBitmap(blob); }
    catch (e) { return await new Promise(res => { const u = URL.createObjectURL(blob), i = new Image(); i.onload = () => { res(i); setTimeout(() => URL.revokeObjectURL(u), 1000); }; i.onerror = () => { URL.revokeObjectURL(u); res(null); }; i.src = u; }); }
  }
  async function loadImages(items, role) {
    const list = items.map(p => ({ piece: p, item: pickImage(p, role), img: null }));
    const ids = list.filter(x => x.item).map(x => x.item.id);
    let thumbs = {};
    try { if (ids.length) thumbs = await Store.drive.thumbUrls(ids, 'large'); } catch (e) { thumbs = {}; }
    let k = 0;
    const worker = async () => {
      while (k < list.length) {
        const x = list[k++];
        if (!x.item) continue;
        try { if (thumbs[x.item.id]) { const r = await fetch(thumbs[x.item.id]); if (r.ok) x.img = await decode(await r.blob()); } } catch (e) { /* weiter mit Originaldatei */ }
        if (!x.img) { try { x.img = await decode(await Store.blobOf(x.item)); } catch (e) { x.img = null; } }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return list;
  }

  // ---------------------------------------------------------------- PDF zusammensetzen (JPEG je Seite)
  function pdfString(s) { let h = 'FEFF'; for (const c of String(s)) { const u = c.codePointAt(0); if (u > 0xFFFF) { const v = u - 0x10000; h += (0xD800 + (v >> 10)).toString(16).padStart(4, '0') + (0xDC00 + (v & 1023)).toString(16).padStart(4, '0'); } else h += u.toString(16).padStart(4, '0'); } return '<' + h.toUpperCase() + '>'; }
  // Text für die PDF in WinAnsi kodieren (deckt deutsche Umlaute, ß und typografische Zeichen ab)
  const WIN = { 0x20AC: 0x80, 0x201A: 0x82, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2030: 0x89, 0x0160: 0x8A, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x2122: 0x99, 0x0161: 0x9A, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
  function winAnsi(s) {
    let out = '';
    for (const ch of String(s)) {
      let c = ch.codePointAt(0);
      if (WIN[c]) c = WIN[c]; else if (c > 255 || (c >= 0x80 && c < 0xA0)) c = 63;
      if (c === 40 || c === 41 || c === 92) out += '\\' + String.fromCharCode(c);
      else if (c < 32 || c > 126) out += '\\' + c.toString(8).padStart(3, '0');
      else out += String.fromCharCode(c);
    }
    return '(' + out + ')';
  }
  function buildPdf(pages, title) {
    const enc = new TextEncoder(), parts = [], offs = [];
    let len = 0;
    const add = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
    const obj = (n, fn) => { offs[n] = len; add(`${n} 0 obj\n`); fn(); add('\nendobj\n'); };
    const pw = 595.28, ph = 841.89, k = pw / W, d = new Date(), p2 = n => String(n).padStart(2, '0');
    const first = 5;
    add('%PDF-1.4\n%âãÏÓ\n');
    obj(1, () => add('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => add(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => (first + 3 * i) + ' 0 R').join(' ')}] >>`));
    obj(3, () => add(`<< /Title ${pdfString(title)} /Author ${pdfString('APOLOGEA')} /Producer ${pdfString('APOLOGEA Handy-App')} /CreationDate (D:${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}) >>`));
    obj(4, () => add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
    pages.forEach((p, i) => {
      const n = first + 3 * i;
      // Seitenbild + unsichtbarer Text (Darstellungsmodus 3) → im PDF-Programm durchsuchbar und kopierbar
      let cs = `q ${pw} 0 0 ${ph} 0 0 cm /Im${i} Do Q\nBT 3 Tr\n`;
      (p.notes || []).forEach(t => {
        // Unsichtbaren Text auf die Breite des sichtbaren Bereichs stauchen (Helvetica ≈ 0,55 em je Zeichen), damit er nicht in Nachbarspalten läuft
        const tz = Math.max(15, Math.min(100, t.w / (t.text.length * 0.55 * t.size) * 100));
        cs += `/F1 ${(t.size * k).toFixed(2)} Tf ${tz.toFixed(1)} Tz 1 0 0 1 ${(t.x * k).toFixed(2)} ${(ph - t.y * k).toFixed(2)} Tm ${winAnsi(t.text)} Tj\n`;
      });
      cs += 'ET';
      obj(n, () => add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im${i} ${n + 2} 0 R >> /Font << /F1 4 0 R >> >> /Contents ${n + 1} 0 R >>`));
      obj(n + 1, () => { add(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`); });
      obj(n + 2, () => { add(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`); add(p.jpeg); add('\nendstream'); });
    });
    const xref = len, size = first + 3 * pages.length;
    let x = `xref\n0 ${size}\n0000000000 65535 f \n`;
    for (let n = 1; n < size; n++) x += String(offs[n]).padStart(10, '0') + ' 00000 n \n';
    add(x + `trailer\n<< /Size ${size} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }

  /** Seite als JPEG, so gut wie möglich innerhalb des Byte-Budgets (erst Qualität senken, dann Auflösung) */
  let small = null;
  async function encode(canvas, budget, high) {
    const toBytes = async (c, q) => { const b = await new Promise(res => c.toBlob(res, 'image/jpeg', q)); if (!b) throw new Error('Die Seite konnte nicht erzeugt werden (zu wenig Speicher?).'); return { jpeg: new Uint8Array(await b.arrayBuffer()), w: c.width, h: c.height }; };
    const steps = [[1, high ? [0.92, 0.86, 0.8] : [0.86, 0.78, 0.7, 0.62, 0.55]], [0.8, [0.7, 0.6, 0.5]], [0.65, [0.6, 0.5, 0.42]]];
    let last = null;
    for (const [scale, qs] of steps) {
      let c = canvas;
      if (scale < 1) {
        small = small || document.createElement('canvas');
        small.width = Math.round(W * scale); small.height = Math.round(H * scale);
        const sg = small.getContext('2d'); sg.imageSmoothingQuality = 'high'; sg.drawImage(canvas, 0, 0, small.width, small.height);
        c = small;
      }
      for (const q of qs) { last = await toBytes(c, q); if (last.jpeg.length <= budget) return last; }
    }
    return last;
  }

  // ---------------------------------------------------------------- Erstellen
  async function create(pieces, o, progress) {
    progress = progress || (() => {});
    progress('Schriften und Logo werden geladen …');
    await loadAssets();
    const { pages, cats, L } = plan(pieces, o);
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    const out = [];
    const maxBytes = (o.quality === 'hoch' ? 40 : 10) * 1048576 * 0.96 - 40000;
    let used = 0;
    const stats = { pieces: pieces.length, cats: new Set(pieces.map(p => p.kategorie)).size, date: new Date().toLocaleDateString('de-DE', { month: '2-digit', year: 'numeric' }).replace('.', ' / ') };
    for (let n = 0; n < pages.length; n++) {
      const pg = pages[n];
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      notes = [];
      if (pg.type === 'cover') { progress(`Seite ${n + 1} von ${pages.length}: Deckblatt …`); cover(g, o, stats); }
      else if (pg.type === 'back') { progress(`Seite ${n + 1} von ${pages.length}: Rückseite …`); backCover(g, o); }
      else {
        background(g); header(g, o, n + 1, pages.length); footer(g, o);
        if (pg.type === 'grid') {
          progress(`Seite ${n + 1} von ${pages.length}: Bilder werden geladen …`);
          const rows = pg.blocks.filter(b => b.kind === 'row');
          const loaded = await loadImages(rows.flatMap(r => r.items), o.role);
          progress(`Seite ${n + 1} von ${pages.length} wird gestaltet …`);
          const cw = (W - 2 * M - L.gap * (L.cols - 1)) / L.cols;
          let k = 0;
          pg.blocks.forEach(b => {
            if (b.kind === 'section') section(g, b.y, b.s);
            if (b.kind === 'cont') continued(g, b.y, b.name);
            if (b.kind === 'row') b.items.forEach((_, i) => {
              const it = loaded[k++];
              card(g, L, M + i * (cw + L.gap), b.y, cw, it);
              if (it.img && it.img.close) it.img.close();
            });
          });
        } else {
          progress(`Seite ${n + 1} von ${pages.length}: Verzeichnis …`);
          if (pg.first) section(g, CONTENT_Y, { label: 'ANHANG', name: 'Verzeichnis', count: pg.total });
          indexRows(g, pg.top, pg.rows);
        }
      }
      // Gleichmäßig verteiltes Budget; was eine Seite nicht braucht, bekommen die übrigen
      const budget = (maxBytes - used) / (pages.length - n);
      const page = await encode(canvas, budget, o.quality === 'hoch');
      used += page.jpeg.length + 2000;
      page.notes = notes;
      out.push(page);
    }
    progress('PDF wird zusammengesetzt …');
    return { blob: buildPdf(out, 'APOLOGEA – ' + o.title), pages: out.length };
  }

  return { create, plan, LAYOUTS };
})();

// ---------------------------------------------------------------- Oberfläche
function openCatalog(preset) {
  const m = M();
  const coll = preset && preset.collection ? preset : null;
  if (!m.pieces.length) { toast('Die Sammlung enthält noch keine Pieces.', 'err'); return; }
  const o = Object.assign({ title: 'Kollektion', contact: 'apologea.eu', scope: 'alle', zg: '', group: 'typ', role: S.cardImg || 'mockup', layout: 'kompakt', index: true, quality: 'klein' }, prefs.get('catalog', {}));
  o.edition = new Date().toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  if (coll) { const dd = coll.collection.drop ? new Date(coll.collection.drop + 'T12:00:00') : null; if (dd && !isNaN(dd)) o.edition = dd.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }); o.title = coll.collection.name; o.collection = { name: coll.collection.name, beschreibung: coll.collection.beschreibung || '', drop: coll.collection.drop || '' }; o.fixed = coll.pieces; }
  const sel = new Set(prefs.get('catalogSel', []).filter(id => m.pieces.some(p => p.id === id)));
  const filterActive = !!(S.filter.q || S.filter.cat || S.filter.status || S.filter.zg);
  if (o.scope === 'filter' && !filterActive) o.scope = 'alle';
  let q = '';
  const segs = (id, opts, cur) => `<div class="seg" id="${id}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${v === cur ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const count = scope => catalogList(Object.assign({}, o, { scope, sel: [...sel] })).length;
  const scopeSeg = () => segs('c-scope', [['alle', `Alle (${count('alle')})`], ['fertig', `Ohne Entwürfe (${count('fertig')})`]].concat(filterActive ? [['filter', `Filter (${count('filter')})`]] : []).concat([['auswahl', `Auswahl (${count('auswahl')})`]]), o.scope);
  const zgSegC = () => segs('c-zg', [['', 'Alle'], ['mann', 'Mann'], ['frau', 'Frau'], ['unisex', 'Unisex']], o.zg || '');
  const sorted = m.pieces.slice().sort((a, b) => a.kategorie.localeCompare(b.kategorie, 'de') || a.nummer - b.nummer);
  const hay = p => norm([p.nummer, pad3(p.nummer), p.name, p.motivtitel, p.serie, p.kategorie, p.schlagwoerter.join(' ')].join(' '));
  const hits = () => { const t = norm(q).split(/\s+/).filter(Boolean); return t.length ? sorted.filter(p => { const h = hay(p); return t.every(x => h.includes(x)); }) : sorted; };
  const body = document.createElement('div');
  body.innerHTML = `
    <p class="hint" style="margin-top:0">Ein gestalteter Katalog als PDF mit Bild, Nummer und Namen der Pieces – zum Teilen mit Partnern, Sponsoren, Freunden oder Claude.</p>
    ${coll ? `<div class="tpl-note" style="margin-bottom:14px">Kollektion <b>${esc(coll.collection.name)}</b> · ${coll.pieces.length} Pieces in der Reihenfolge der Kollektion.</div>` : `<div class="field"><label>Umfang</label><div id="c-scope-box">${scopeSeg()}</div></div>`}
    <div id="c-pick" class="${!coll && o.scope === 'auswahl' ? '' : 'hidden'}">
      <div class="search cat-search">${icon('search')}<input class="input" id="c-q" type="search" placeholder="Name, Nummer, Motiv, Serie …" autocomplete="off" enterkeyhint="search"></div>
      <label class="imp-check cat-allbox"><input type="checkbox" id="c-allp"><span>Alle Pieces <span class="faint">(${m.pieces.length})</span></span></label>
      <div class="cat-tools"><span id="c-selcount" class="hint"></span><button type="button" class="btn small ghost" id="c-all">Treffer wählen</button><button type="button" class="btn small ghost" id="c-none">Leeren</button></div>
      <div class="cat-list" id="c-list"></div>
    </div>
    ${coll ? '' : `<div class="field"><label>Für</label><div id="c-zg-box">${zgSegC()}</div><span class="hint">„Mann“ und „Frau“ enthalten auch die Unisex-Pieces.</span></div>`}
    <div class="field"><label>Gliederung</label>${segs('c-group', [['typ', 'Nach Kleidungstyp'], ['zg', 'Nach Mann / Frau']], o.group)}</div>
    <div class="field"><label for="c-title">Titel</label><input class="input" id="c-title" maxlength="40" value="${esc(o.title)}"></div>
    <div class="field"><label for="c-ed">Ausgabe</label><input class="input" id="c-ed" maxlength="40" value="${esc(o.edition)}"></div>
    <div class="field"><label for="c-contact">Kontakt <span class="faint">(optional, z. B. Website oder Instagram)</span></label><input class="input" id="c-contact" maxlength="60" value="${esc(o.contact)}"></div>
    <div class="field"><label>Bild</label>${segs('c-role', [['mockup', 'Mockup'], ['design', 'Design'], ['kleidungsansicht', 'Ansicht']], o.role)}<span class="hint">Fehlt das Bild, wird ein anderes des Pieces genommen.</span></div>
    <div class="field"><label>Darstellung</label>${segs('c-layout', [['kompakt', 'Übersicht · 9/Seite'], ['gross', 'Groß · 4/Seite']], o.layout)}<span class="hint">„Groß“ zeigt zusätzlich Serie und Beschreibung.</span></div>
    <div class="field"><label>Dateigröße</label>${segs('c-quality', [['klein', 'Max. 10 MB'], ['hoch', 'Hohe Qualität']], o.quality)}<span class="hint">„Max. 10 MB“ lässt sich problemlos per Messenger, Mail oder an Claude schicken. „Hohe Qualität“ (bis 40 MB) für den Druck.</span></div>
    <label class="imp-check"><input type="checkbox" id="c-index" ${o.index ? 'checked' : ''}><span>Verzeichnis aller Pieces am Ende</span></label>`;
  const renderList = () => {
    const list = hits();
    $('#c-list', body).innerHTML = list.length ? list.slice(0, 400).map(p => `<label class="cat-row"><input type="checkbox" data-id="${esc(p.id)}" ${sel.has(p.id) ? 'checked' : ''}><span class="nr">${pad3(p.nummer)}</span><span class="nm">${esc(p.name)}<small>${esc(p.kategorie)}${p.motivtitel ? ' · ' + esc(p.motivtitel) : ''}${p.entwurf ? ' · Entwurf' : ''}</small></span></label>`).join('') + (list.length > 400 ? `<p class="hint">… und ${list.length - 400} weitere – bitte Suche verfeinern.</p>` : '') : '<p class="hint">Keine Treffer.</p>';
    $('#c-selcount', body).textContent = `${sel.size} von ${m.pieces.length} ausgewählt${q ? ' · ' + list.length + ' Treffer' : ''}`;
    const all = $('#c-allp', body);
    all.checked = sel.size === m.pieces.length;
    all.indeterminate = sel.size > 0 && sel.size < m.pieces.length;
  };
  const refreshScope = () => { const b = $('#c-scope-box', body); if (b) b.innerHTML = scopeSeg(); };
  sheet({
    title: 'Katalog erstellen', body,
    buttons: [{ label: 'Abbrechen' }, { label: 'PDF erstellen', cls: 'primary', value: 'go', run: () => {
      if (!coll && o.scope === 'auswahl' && !sel.size) { toast('Bitte mindestens ein Piece auswählen (Suche oben).', 'err'); return false; }
      o.title = $('#c-title', body).value.trim() || 'Kollektion';
      o.edition = $('#c-ed', body).value.trim() || new Date().toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
      o.contact = $('#c-contact', body).value.trim();
      o.index = $('#c-index', body).checked;
      o.sel = [...sel];
    } }],
    onOpen: () => {
      renderList();
      $('#c-q', body).addEventListener('input', e => { q = e.target.value; renderList(); });
      $('#c-q', body).addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
      $('#c-all', body).onclick = () => { hits().forEach(p => sel.add(p.id)); renderList(); refreshScope(); };
      $('#c-none', body).onclick = () => { sel.clear(); renderList(); refreshScope(); };
      $('#c-allp', body).onchange = e => { if (e.target.checked) m.pieces.forEach(p => sel.add(p.id)); else sel.clear(); renderList(); refreshScope(); };
      $('#c-list', body).addEventListener('change', e => { const c = e.target.closest('input[data-id]'); if (!c) return; if (c.checked) sel.add(c.dataset.id); else sel.delete(c.dataset.id); renderList(); refreshScope(); });
      body.addEventListener('click', e => {
        const b = e.target.closest('.seg button'); if (!b) return;
        const id = b.parentElement.id;
        $$('button', b.parentElement).forEach(x => x.classList.toggle('on', x === b));
        if (id === 'c-scope') { o.scope = b.dataset.v; $('#c-pick', body).classList.toggle('hidden', o.scope !== 'auswahl'); if (o.scope === 'auswahl') setTimeout(() => $('#c-q', body).focus(), 50); }
        if (id === 'c-zg') { o.zg = b.dataset.v; refreshScope(); }
        if (id === 'c-group') o.group = b.dataset.v;
        if (id === 'c-role') o.role = b.dataset.v;
        if (id === 'c-layout') o.layout = b.dataset.v;
        if (id === 'c-quality') o.quality = b.dataset.v;
      });
    }
  }).then(v => { if (v === 'go') makeCatalog(o); });
}

/** Pieces für den Katalog: Umfang (alle, ohne Entwürfe, Filter, Auswahl) und dazu „Für“ (Mann / Frau / Unisex) */
function catalogList(o) {
  const m = M(), chosen = new Set(o.sel || []);
  if (o.fixed) return o.fixed;
  const list = o.scope === 'fertig' ? m.pieces.filter(p => !p.entwurf) : o.scope === 'filter' ? filtered() : o.scope === 'auswahl' ? m.pieces.filter(p => chosen.has(p.id)) : m.pieces.slice();
  return o.zg ? list.filter(p => ZG.matches(p.zielgruppe, o.zg)) : list;
}

async function makeCatalog(o) {
  const keep = prefs.get('catalog', {});
  prefs.set('catalog', { title: o.fixed ? keep.title || 'Kollektion' : o.title, contact: o.contact, scope: o.fixed ? keep.scope || 'alle' : o.scope, zg: o.fixed ? keep.zg || '' : o.zg, group: o.group, role: o.role, layout: o.layout, index: o.index, quality: o.quality });
  if (!o.fixed) prefs.set('catalogSel', o.sel || []);
  const list = catalogList(o);
  if (!list.length) { toast('Für diese Auswahl gibt es keine Pieces.', 'err'); return; }
  let lock = null;
  try { if (navigator.wakeLock) lock = await navigator.wakeLock.request('screen'); } catch (e) { /* optional */ }
  busy('Katalog wird vorbereitet …');
  try {
    const res = await Catalog.create(list, o, msg => busy(msg));
    const blob = res.blob;
    unbusy();
    const day = new Date().toISOString().slice(0, 10);
    const name = `APOLOGEA_Katalog_${Names.segment(o.title, 30) || 'Kollektion'}_${day}.pdf`;
    const file = new File([blob], name, { type: 'application/pdf' });
    const url = URL.createObjectURL(file);
    const canShare = navigator.canShare && navigator.canShare({ files: [file] });
    const v = await sheet({
      title: 'Katalog fertig',
      body: `<p><b>${list.length} ${list.length === 1 ? 'Piece' : 'Pieces'}</b> · ${res.pages} Seiten · ${fmtBytes(blob.size)}</p><p class="hint">${esc(name)}</p>
        <p class="hint">Durchsuchbar: Namen und Nummern lassen sich im PDF-Programm suchen und kopieren.</p>
        ${res.pages > 100 ? '<p class="hint warn">Hinweis: Claude liest PDFs bis etwa 100 Seiten. Für Claude besser „Übersicht“ wählen oder die Auswahl eingrenzen.</p>' : ''}`,
      buttons: [{ label: 'Ansehen', value: 'view' }].concat(canShare ? [{ label: 'Teilen …', cls: 'primary', value: 'share' }] : []).concat([{ label: 'Speichern', cls: canShare ? '' : 'primary', value: 'save' }])
    });
    if (v === 'share') { try { await navigator.share({ files: [file], title: 'APOLOGEA – ' + o.title }); } catch (e) { if (e && e.name !== 'AbortError') fail(e, 'Teilen nicht möglich'); } }
    if (v === 'save') { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
    if (v === 'view') window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 600000);
  } catch (e) { unbusy(); fail(e, 'Katalog konnte nicht erstellt werden'); }
  finally { if (lock) lock.release().catch(() => {}); }
}
