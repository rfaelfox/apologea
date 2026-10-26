import { PNG } from 'pngjs';

/**
 * Liest technische Eckdaten einer Bilddatei, ohne sie zu verändern.
 * Unterstützt: PNG (inkl. Transparenzanalyse), JPEG, WebP, GIF, SVG. Andere Formate werden erkannt,
 * aber nur als „nicht analysierbar“ gemeldet.
 */
export function analyzeImage(buf, filename = '') {
  const info = { format: 'unbekannt', mime: 'application/octet-stream', width: null, height: null, hasAlpha: null, transparentRatio: null, dpi: null, bytes: buf.length };
  const lower = filename.toLowerCase();
  try {
    if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return { ...info, ...analyzePng(buf) };
    if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return { ...info, ...analyzeJpeg(buf) };
    if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { ...info, ...analyzeWebp(buf) };
    if (buf.length > 10 && buf.toString('ascii', 0, 3) === 'GIF') return { ...info, format: 'GIF', mime: 'image/gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (buf.length > 4 && buf.toString('ascii', 0, 4) === '%PDF') return { ...info, format: 'PDF', mime: 'application/pdf' };
    const head = buf.subarray(0, 2048).toString('utf8');
    if (lower.endsWith('.svg') || /<svg[\s>]/i.test(head)) return { ...info, ...analyzeSvg(buf.toString('utf8')) };
  } catch (err) {
    return { ...info, error: 'Datei konnte nicht gelesen werden: ' + err.message };
  }
  return info;
}

function analyzePng(buf) {
  const out = { format: 'PNG', mime: 'image/png' };
  out.width = buf.readUInt32BE(16);
  out.height = buf.readUInt32BE(20);
  const colorType = buf[25];
  out.hasAlphaChannel = colorType === 4 || colorType === 6;
  // pHYs-Chunk → gespeicherte Auflösung (nur Information, nicht maßgeblich für den Druck)
  let off = 8;
  let hasTrns = false;
  while (off + 8 < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'pHYs' && len >= 9) {
      const ppuX = buf.readUInt32BE(off + 8);
      const unit = buf[off + 16];
      if (unit === 1) out.dpi = Math.round(ppuX * 0.0254);
    }
    if (type === 'tRNS') hasTrns = true;
    if (type === 'IDAT' || type === 'IEND') break;
    off += 12 + len;
  }
  out.hasAlphaChannel = out.hasAlphaChannel || hasTrns;
  // Transparenzanteil nur bei vertretbarer Größe vollständig auswerten (Speicherbedarf).
  const pixels = out.width * out.height;
  if (out.hasAlphaChannel && pixels <= 40_000_000) {
    const png = PNG.sync.read(buf);
    let transparent = 0;
    let partial = 0;
    const d = png.data;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] === 0) transparent++;
      else if (d[i] < 255) partial++;
    }
    out.transparentRatio = transparent / pixels;
    out.partialRatio = partial / pixels;
    out.hasAlpha = transparent + partial > 0;
  } else if (out.hasAlphaChannel) {
    out.hasAlpha = null; // zu groß für eine vollständige Analyse
  } else {
    out.hasAlpha = false;
    out.transparentRatio = 0;
  }
  return out;
}

function analyzeJpeg(buf) {
  const out = { format: 'JPEG', mime: 'image/jpeg', hasAlpha: false, hasAlphaChannel: false, transparentRatio: 0 };
  let off = 2;
  while (off + 9 < buf.length) {
    if (buf[off] !== 0xff) { off++; continue; }
    const marker = buf[off + 1];
    const len = buf.readUInt16BE(off + 2);
    if (marker === 0xe0 && buf.toString('ascii', off + 4, off + 9) === 'JFIF\u0000') {
      const units = buf[off + 11];
      const xd = buf.readUInt16BE(off + 12);
      if (units === 1) out.dpi = xd;
      else if (units === 2) out.dpi = Math.round(xd * 2.54);
    }
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      out.height = buf.readUInt16BE(off + 5);
      out.width = buf.readUInt16BE(off + 7);
      break;
    }
    off += 2 + len;
  }
  return out;
}

function analyzeWebp(buf) {
  const out = { format: 'WebP', mime: 'image/webp' };
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    out.hasAlphaChannel = Boolean(buf[20] & 0x10);
    out.width = 1 + buf.readUIntLE(24, 3);
    out.height = 1 + buf.readUIntLE(27, 3);
  } else if (chunk === 'VP8L') {
    const b = buf.readUInt32LE(21);
    out.width = (b & 0x3fff) + 1;
    out.height = ((b >> 14) & 0x3fff) + 1;
    out.hasAlphaChannel = Boolean((b >> 28) & 1);
  } else if (chunk === 'VP8 ') {
    out.width = buf.readUInt16LE(26) & 0x3fff;
    out.height = buf.readUInt16LE(28) & 0x3fff;
    out.hasAlphaChannel = false;
  }
  return out;
}

function analyzeSvg(text) {
  const out = { format: 'SVG', mime: 'image/svg+xml', vector: true, hasAlpha: true };
  const tag = (text.match(/<svg\b[^>]*>/i) || [''])[0];
  const num = (attr) => {
    const m = tag.match(new RegExp(`\\s${attr}\\s*=\\s*["']([\\d.]+)(px)?["']`, 'i'));
    return m ? Number(m[1]) : null;
  };
  const vb = tag.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  out.width = num('width') || (vb ? Number(vb[1]) : null);
  out.height = num('height') || (vb ? Number(vb[2]) : null);
  out.containsScript = /<script[\s>]|on\w+\s*=/i.test(text);
  return out;
}

/**
 * Prüft eine Druckdatei gegen die Druckfläche eines MarketPrint-Grundprodukts.
 * Grundlage sind ausschließlich Daten aus MarketPrint (Druckflächen in Pixeln) und die Datei selbst.
 * Es werden keine Zentimeter- oder DPI-Angaben erfunden.
 */
export function checkPrintFile({ analysis, printArea, placement, printerType }) {
  const notes = [];
  const add = (level, text) => notes.push({ level, text });
  if (!analysis) return [{ level: 'error', text: 'Keine Datei zugeordnet.' }];
  if (analysis.error) add('error', analysis.error);

  const fmt = analysis.format;
  if (fmt === 'PNG') add('ok', 'Format PNG.');
  else if (fmt === 'SVG') {
    add('warn', 'SVG-Vektordatei: MarketPrint verarbeitet die Datei selbst. Das Ergebnis bitte in den MarketPrint-Mockups kontrollieren.');
    if (analysis.containsScript) add('error', 'Die SVG-Datei enthält Skripte oder Ereignis-Attribute. Bitte eine bereinigte SVG- oder PNG-Datei verwenden.');
  } else if (fmt === 'JPEG') add('warn', 'JPEG hat keinen transparenten Hintergrund. Der Hintergrund würde mitgedruckt. Für Textildruck ist PNG mit Transparenz üblich.');
  else add('error', `Format ${fmt}: Die MarketPrint-Schnittstelle nennt PNG und SVG als Beispiele. Bitte als PNG exportieren.`);

  const textile = !printerType || ['dtg', 'dtf'].includes(printerType);
  if (fmt === 'PNG') {
    if (analysis.hasAlphaChannel === false) {
      if (textile) add('warn', 'Die PNG-Datei hat keinen Alphakanal. Ein Hintergrund würde vollflächig mitgedruckt.');
    } else if (analysis.hasAlpha === false) {
      if (textile) add('warn', 'Die PNG-Datei hat zwar einen Alphakanal, aber keine transparenten Pixel. Der Hintergrund würde mitgedruckt.');
    } else if (analysis.hasAlpha === true) {
      add('ok', `Transparenter Hintergrund vorhanden (${Math.round((analysis.transparentRatio || 0) * 100)} % vollständig transparent).`);
      if ((analysis.partialRatio || 0) > 0.05 && printerType === 'dtf') add('warn', 'Viele halbtransparente Pixel. Bei DTF können weiche Kanten oder Verläufe abweichend gedruckt werden.');
    } else {
      add('warn', 'Transparenz konnte wegen der Dateigröße nicht vollständig geprüft werden.');
    }
  }

  if (!printArea) {
    add('warn', 'Keine Druckfläche gewählt – Abmessungen können nicht geprüft werden.');
    return notes;
  }
  const areaW = printArea.width;
  const areaH = printArea.height;
  if (analysis.vector || !analysis.width || !analysis.height) {
    if (!analysis.vector) add('warn', 'Pixelabmessungen unbekannt.');
    return notes;
  }
  const imgW = analysis.width;
  const imgH = analysis.height;
  add('ok', `Datei: ${imgW} × ${imgH} px · Druckfläche „${printArea.name}“ laut MarketPrint: ${areaW} × ${areaH} px.`);

  const geom = placementGeometry({ imgW, imgH, areaW, areaH, placement });
  if (geom.named) {
    add('warn', `Benannte Position „${geom.named}“: Größe und Lage bestimmt MarketPrint. Bitte das Mockup prüfen.`);
    return notes;
  }
  const q = dpiRating(imgW, geom.targetW, geom.targetH);
  const size = `${String(q.widthCm).replace('.', ',')} × ${String(q.heightCm).replace('.', ',')} cm`;
  const needPx = Math.ceil((geom.targetW / AREA_DPI) * DPI_LEVELS.gut);
  const dpiNote = (level, text) => notes.push({ level, text, dpi: q });
  if (q.rating === 'gut') dpiNote('ok', `DPI-Prüfung: gut – ca. ${q.dpi} DPI bei ${size} Druckgröße.`);
  else if (q.rating === 'mittel') dpiNote('warn', `DPI-Prüfung: mittel – ca. ${q.dpi} DPI bei ${size} Druckgröße. Der Druck kann leicht weich wirken. Für „gut“ mindestens ${needPx} px Breite oder das Motiv etwas kleiner setzen.`);
  else dpiNote('error', `DPI-Prüfung: schlecht – nur ca. ${q.dpi} DPI bei ${size} Druckgröße. Das Motiv wird stark vergrößert und sichtbar unscharf. Bitte eine größere Datei liefern (mindestens ${needPx} px breit) oder das Motiv kleiner setzen.`);

  const coverW = Math.round((geom.targetW / areaW) * 100);
  const coverH = Math.round((geom.targetH / areaH) * 100);
  add('ok', `Belegte Fläche: ca. ${coverW} % der Breite und ${coverH} % der Höhe der Druckfläche.`);
  const ratioImg = imgW / imgH;
  const ratioArea = areaW / areaH;
  if (geom.auto && Math.abs(ratioImg - ratioArea) / ratioArea > 0.25) {
    add('warn', `Seitenverhältnis Motiv ${ratioImg.toFixed(2)} : 1 weicht vom Druckflächen-Verhältnis ${ratioArea.toFixed(2)} : 1 ab. Bei „automatisch einpassen“ bleibt Fläche frei.`);
  }
  if (geom.outOfBounds) add('error', 'Das Motiv ragt über die Druckfläche hinaus. Annahme dabei: Der Ankerpunkt ist die Motivmitte, MarketPrint dokumentiert ihn nicht genauer. Bitte Breite oder Position anpassen.');
  return notes;
}

/**
 * DPI-Prüfung wie im Editor von MarketPrint.
 * Annahme: Die Pixelmaße der Druckfläche, die MarketPrint liefert, entsprechen 300 DPI
 * (z. B. 4677 × 5881 px ≙ ca. 39,6 × 49,8 cm beim Oversized Shirt). Die Schnittstelle nennt keine Zentimeter.
 * Effektive DPI = Pixel des Motivs ÷ gedruckte Breite in Zoll.
 */
export const AREA_DPI = 300;
export const DPI_LEVELS = { gut: 200, mittel: 150 }; // ab 200 gut, 150–199 mittel, darunter schlecht

export function dpiRating(imgW, targetWpx, targetHpx) {
  const inches = targetWpx / AREA_DPI;
  const dpi = Math.round(imgW / inches);
  const rating = dpi >= DPI_LEVELS.gut ? 'gut' : dpi >= DPI_LEVELS.mittel ? 'mittel' : 'schlecht';
  return { dpi, rating, widthCm: Math.round(inches * 2.54 * 10) / 10, heightCm: targetHpx ? Math.round((targetHpx / AREA_DPI) * 2.54 * 10) / 10 : null };
}

export function placementGeometry({ imgW, imgH, areaW, areaH, placement }) {
  if (!placement || placement === 'auto' || placement.mode === 'auto') {
    const s = Math.min(areaW / imgW, areaH / imgH);
    return { auto: true, targetW: imgW * s, targetH: imgH * s, x: 0.5, y: 0.5, outOfBounds: false };
  }
  if (typeof placement === 'string') return { named: placement };
  const targetW = areaW * placement.widthPercent;
  const targetH = targetW * (imgH / imgW);
  const halfW = placement.widthPercent / 2;
  const halfH = targetH / areaH / 2;
  const eps = 0.001;
  const outOfBounds = placement.xPercent - halfW < -eps || placement.xPercent + halfW > 1 + eps
    || placement.yPercent - halfH < -eps || placement.yPercent + halfH > 1 + eps;
  return { targetW, targetH, x: placement.xPercent, y: placement.yPercent, outOfBounds };
}
