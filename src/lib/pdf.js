import { toPlainText } from './html.js';
import { cardLayout, imageUrl, isEmptyValue } from './components.js';

// jsPDF's built-in fonts only cover Latin-1, so swap typographic characters for safe ones.
const pdfSafe = (s) =>
  String(s || '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/•/g, '·')
    .replace(/−/g, '-')
    .replace(/[^\x00-\xff·]/g, '');

const capital = (k) => `${k[0].toUpperCase()}${k.slice(1)}`;

/** Page sizes in points (portrait). */
export const PAGE_SIZES = {
  letter: { label: 'Letter', hint: '8.5 × 11 in', w: 612, h: 792 },
  a4: { label: 'A4', hint: '210 × 297 mm', w: 595.28, h: 841.89 },
};

/** Card sizes for the card overview (or a custom size). Mini is Blood Rage's own card size. */
export const CARD_SIZES = {
  s: { label: 'Mini', w: 41, h: 63.5 },
};

const MM = 72 / 25.4;
export const UNITS = { mm: { label: 'mm', pt: MM }, in: { label: 'in', pt: 72 } };

// Custom sizes are kept within what makes sense on paper.
const clamp = (v, lo, hi, fallback) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.min(hi, Math.max(lo, Number(v))) : fallback);

/** The chosen paper in points, portrait: { w, h }. options: { format, paperW, paperH, unit } */
export function paperOf(o) {
  if (o.format !== 'custom') return PAGE_SIZES[o.format] || PAGE_SIZES.letter;
  const k = UNITS[o.unit]?.pt || MM;
  const a = clamp(o.paperW * k, 100 * MM, 1000 * MM, PAGE_SIZES.letter.w);
  const b = clamp(o.paperH * k, 100 * MM, 1000 * MM, PAGE_SIZES.letter.h);
  return { w: Math.min(a, b), h: Math.max(a, b) };
}

/** The chosen card size in points: { w, h }. options: { cardSize, cardW, cardH, unit } */
export function cardSizeOf(o) {
  const mini = CARD_SIZES.s;
  if (o.cardSize !== 'custom') return { w: mini.w * MM, h: mini.h * MM };
  const k = UNITS[o.unit]?.pt || MM;
  return { w: clamp(o.cardW * k, 20 * MM, 300 * MM, mini.w * MM), h: clamp(o.cardH * k, 20 * MM, 400 * MM, mini.h * MM) };
}
const CARD_MARGIN = 20;
const HEADING = 26;

/** How the card overview lays out on a page: card size in points, and how many fit. */
export function cardGrid(page, size) {
  // Cards touch, so one cut separates two of them. A card never gets bigger than the page holds.
  const fit = Math.min(1, (page.w - 2 * CARD_MARGIN) / size.w, (page.h - 2 * CARD_MARGIN - HEADING) / size.h);
  const w = size.w * fit;
  const h = size.h * fit;
  const cols = Math.max(1, Math.floor((page.w - 2 * CARD_MARGIN) / w));
  const rows = Math.max(1, Math.floor((page.h - 2 * CARD_MARGIN - HEADING) / h));
  return { w, h, cols, rows, perPage: cols * rows };
}

const DARK = [30, 26, 24];
const GREY = [120, 110, 105];
const LIGHT = [140, 135, 130];

const hexRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return [124, 26, 23];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** An image as a data URL, if the host allows it (CORS); null otherwise. */
const imageCache = new Map();
function loadImage(url) {
  if (!imageCache.has(url)) {
    imageCache.set(
      url,
      new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.referrerPolicy = 'no-referrer';
        const timer = setTimeout(() => resolve(null), 5000);
        img.onload = () => {
          clearTimeout(timer);
          try {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            c.getContext('2d').drawImage(img, 0, 0);
            resolve({ data: c.toDataURL('image/jpeg', 0.85), w: img.naturalWidth, h: img.naturalHeight });
          } catch {
            resolve(null);
          }
        };
        img.onerror = () => {
          clearTimeout(timer);
          resolve(null);
        };
        img.src = url;
      }),
    );
  }
  return imageCache.get(url);
}

// Card text sizes and line heights, as on the site (in units of 5% of the card width).
const CELL_SIZE = { xs: 0.7, s: 0.82, m: 0.95, l: 1.2, xl: 1.6, xxl: 2.1 };
const CELL_LH = { l: 1.15, xl: 1.1, xxl: 1.05 };

/**
 * Export the active ruleset as a PDF: its rules, then (optionally) all its cards.
 * groups: [{ heading, depth, rules: [{ sid, ref, title, label, kindLabel, inactive, html }] }]
 * cardTypes: [{ type, cards: [{ comp, data, label }] }]: every card in the version the ruleset uses
 * (label is the version's label, or null when printed).
 * options: { format: 'letter' | 'a4' | 'custom', paperW, paperH, unit: 'mm' | 'in', perSheet: 1 | 2,
 *   cards: 'none' | 'table' | 'cards', cardSize: 's' | 'm' | 'custom', cardW }
 */
export async function exportRulesetPdf({ title, subtitle, groups, cardTypes = [], shorthands, filename, options }) {
  const { jsPDF } = await import('jspdf');
  const { perSheet, cards: cardMode } = options;
  const paper = paperOf(options);
  const format = [paper.w, paper.h];
  const twoUp = perSheet === 2;
  const pdf = new jsPDF({ unit: 'pt', format, orientation: twoUp ? 'landscape' : 'portrait' });
  // Shorthands read as their keyword: "(Rage)" in rules, "Rage" on cards.
  const shText = (html, paren = true) =>
    toPlainText(html).replace(/(\S?)\[([a-z0-9_-]+)\]/gi, (m, before, k) => {
      if (!shorthands?.[k.toLowerCase()]) return m;
      // A space after a word or number ("1 Rage"), not after punctuation ("Rage/Axes").
      const space = /[\w)]/.test(before) ? ' ' : '';
      return `${before}${space}${paren ? `(${capital(k)})` : capital(k)}`;
    });

  // ---------- rules: one or two pages per sheet ----------
  // A "page" is a slot on a sheet: the whole sheet, or one half of a landscape sheet.
  const SW = pdf.internal.pageSize.getWidth();
  const SH = pdf.internal.pageSize.getHeight();
  const scale = twoUp ? 0.85 : 1;
  const M = twoUp ? 36 : 54;
  const pages = [{ sheet: 1, x: 0, w: twoUp ? SW / 2 : SW }];
  let page = pages[0];
  let y = M;
  const newPage = () => {
    if (twoUp && page.x === 0) page = { sheet: page.sheet, x: SW / 2, w: SW / 2 };
    else {
      pdf.addPage(format, twoUp ? 'landscape' : 'portrait');
      page = { sheet: pdf.getNumberOfPages(), x: 0, w: twoUp ? SW / 2 : SW };
    }
    pages.push(page);
    y = M;
  };
  const ensure = (h) => {
    if (y + h > SH - M) newPage();
  };
  const write = (text, { size = 10, style = 'normal', color = DARK, gap = 4 } = {}) => {
    const s = size * scale;
    pdf.setPage(page.sheet);
    pdf.setFont('helvetica', style);
    pdf.setFontSize(s);
    pdf.setTextColor(...color);
    const lines = pdf.splitTextToSize(pdfSafe(text), page.w - M * 2);
    const lh = s * 1.32;
    for (const line of lines) {
      ensure(lh);
      pdf.setPage(page.sheet);
      pdf.text(line, page.x + M, y + s);
      y += lh;
    }
    y += gap * scale;
  };

  write(title, { size: 20, style: 'bold', gap: 2 });
  write(subtitle, { size: 10, color: [110, 100, 95], gap: 14 });

  for (const g of groups) {
    if (g.heading) {
      ensure(40 * scale);
      y += (g.depth === 0 ? 8 : 4) * scale;
      write(g.heading, { size: g.depth === 0 ? 15 : g.depth === 1 ? 12.5 : 11.5, style: 'bold', color: [140, 28, 26], gap: 6 });
    }
    for (const r of g.rules) {
      ensure(48 * scale);
      const tags = [r.label, r.kindLabel, r.inactive ? 'not in ruleset' : null].filter(Boolean).join(' | ');
      write(`${r.title || ''}${r.sid ? `  ${r.sid}` : ''}${r.ref ? `  (${r.ref})` : ''}`, { size: 10.5, style: 'bold', gap: 1, color: r.inactive ? LIGHT : DARK });
      if (tags) write(tags, { size: 8, color: GREY, gap: 2 });
      write(shText(r.html), { size: 10, gap: 10, color: r.inactive ? LIGHT : DARK });
    }
  }

  // Page numbers for the rules, and a fold line between two pages on a sheet.
  const ruleSheets = pdf.getNumberOfPages();
  pages.forEach((p, i) => {
    pdf.setPage(p.sheet);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8 * scale);
    pdf.setTextColor(...LIGHT);
    pdf.text(pdfSafe(`${title} - page ${i + 1} of ${pages.length}`), p.x + M, SH - 24);
  });
  if (twoUp) {
    for (let s = 1; s <= ruleSheets; s++) {
      pdf.setPage(s);
      pdf.setDrawColor(215, 210, 205);
      pdf.setLineDashPattern([3, 3], 0);
      pdf.line(SW / 2, 24, SW / 2, SH - 24);
      pdf.setLineDashPattern([], 0);
    }
  }

  // ---------- cards ----------
  const withCards = cardTypes.filter((t) => t.cards.length);
  if (cardMode === 'table') for (const t of withCards) cardTable(pdf, t, { paper, format, title, shText });
  if (cardMode === 'cards') for (const t of withCards) await cardSheets(pdf, t, { paper, format, size: cardSizeOf(options), title, shText });

  pdf.save(filename);
}

/** Section heading at the top of a card page. */
function cardHeading(pdf, text, sub, x, y) {
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(13);
  pdf.setTextColor(140, 28, 26);
  pdf.text(pdfSafe(text), x, y + 13);
  if (sub) {
    const after = pdf.getTextWidth(pdfSafe(text));
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(...GREY);
    pdf.text(pdfSafe(sub), x + after + 10, y + 13);
  }
}

function pageFooter(pdf, text, x, y) {
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(...LIGHT);
  pdf.text(pdfSafe(text), x, y);
}

const fieldsOf = (type) => new Map(type.fields.map((f) => [f.key, f]));
const changedNote = (cards) => (cards.some((c) => c.label) ? 'Cards in another version than printed are marked with that version.' : 'All cards as printed.');

/** Cards drawn as cards, edge to edge in a grid, marked with their version when it isn't printed. */
async function cardSheets(pdf, { type, cards }, { paper: page, format, size, title, shText }) {
  const g = cardGrid(page, size);
  const left = (page.w - g.cols * g.w) / 2;
  for (let i = 0; i < cards.length; i++) {
    const at = i % g.perPage;
    if (at === 0) {
      pdf.addPage(format, 'portrait');
      cardHeading(pdf, `${type.name} (${cards.length})`, i === 0 ? changedNote(cards) : 'continued', CARD_MARGIN, CARD_MARGIN - 6);
      pageFooter(pdf, `${title} - ${type.name}`, CARD_MARGIN, page.h - 20);
    }
    const col = at % g.cols;
    const row = Math.floor(at / g.cols);
    const x = left + col * g.w;
    const y = CARD_MARGIN + HEADING + row * g.h;
    await drawCard(pdf, type, cards[i].data, x, y, g.w, g.h, shText, cards[i].label);
  }
}

/** One card, following the type's layout: rows top to bottom, fields side by side. */
async function drawCard(pdf, type, data, x, y, w, h, shText, versionLabel) {
  const u = w * 0.05;
  const accent = hexRgb((type.accentField && type.accentColors?.[data[type.accentField]]) || type.defaultAccent);
  const fields = fieldsOf(type);
  const rows = cardLayout(type)
    .rows.map((r) => ({ ...r, cells: r.cells.filter((c) => fields.has(c.key) && !isEmptyValue(data[c.key], type)) }))
    .filter((r) => r.cells.length);

  pdf.setFillColor(255, 255, 255);
  pdf.rect(x, y, w, h, 'F');

  const padX = 0.9 * u;
  const gap = 0.6 * u;
  const inner = w - 2 * padX;
  const fontFor = (f, c) => [f.kind === 'ability' || f.kind === 'lore' ? 'times' : 'helvetica', c.bold && c.italic ? 'bolditalic' : c.bold ? 'bold' : c.italic ? 'italic' : 'normal'];
  const textOf = (f, c) => {
    let t = shText(String(data[c.key]), false);
    const prefix = c.prefix && !(/^[-+−]/.test(t) && /^[+-]/.test(c.prefix)) ? c.prefix : '';
    // A shorthand suffix such as "[rage]" reads "1 Rage".
    t = `${shText(prefix, false)}${t}${c.suffix ? `${/^\[/.test(c.suffix) ? ' ' : ''}${shText(c.suffix, false)}` : ''}`;
    return pdfSafe(c.upper ? t.toUpperCase() : t);
  };

  // Lay out each cell: its lines at its font size.
  const laid = rows.map((r, ri) => {
    const total = r.cells.reduce((n, c) => n + (c.width || 1), 0);
    const avail = inner - gap * (r.cells.length - 1);
    const cells = r.cells.map((c) => {
      const f = fields.get(c.key);
      const cw = (avail * (c.width || 1)) / total;
      let fs = (CELL_SIZE[c.size] || 0.95) * u;
      if (f.kind === 'image') return { c, f, cw, fs, image: true, height: (cw * 9) / 16 };
      pdf.setFont(...fontFor(f, c));
      const text = textOf(f, c);
      // Short values (a cost, a name) shrink a little to stay on one line rather than wrap.
      if (!r.fill && f.kind !== 'ability' && f.kind !== 'lore') {
        pdf.setFontSize(fs);
        const tw = pdf.getTextWidth(text);
        if (tw > cw) fs = Math.max(fs * 0.45, (fs * cw) / tw);
      }
      pdf.setFontSize(fs);
      const lines = pdf.splitTextToSize(text, cw);
      const lh = fs * (CELL_LH[c.size] || 1.3);
      const labelH = c.label ? fs * 0.7 * 1.25 : 0;
      return { c, f, cw, fs, lh, lines, labelH, height: labelH + lines.length * lh };
    });
    const padTop = (r.band ? 0.6 : ri === 0 ? 0.8 : 0.5) * u;
    const padBottom = (r.band ? 0.6 : ri === rows.length - 1 ? 0.8 : 0.5) * u;
    return { r, cells, padTop, padBottom, natural: padTop + padBottom + Math.max(...cells.map((x) => x.height)) };
  });
  // Rows marked "fill" share the space left over.
  const fixed = laid.filter((l) => !l.r.fill).reduce((n, l) => n + l.natural, 0);
  const fills = laid.filter((l) => l.r.fill).length;
  const top = Math.max(2, u * 0.3);
  const spare = Math.max(0, h - top - fixed);

  let cy = y + top;
  for (const l of laid) {
    const rh = l.r.fill ? spare / fills : l.natural;
    if (cy >= y + h - 1) break;
    const bottom = Math.min(cy + rh, y + h);
    if (l.r.band) {
      pdf.setFillColor(...accent);
      pdf.rect(x + 0.3, cy, w - 0.6, bottom - cy, 'F');
    }
    if (l.r.divider) {
      pdf.setDrawColor(200, 193, 186);
      pdf.setLineWidth(0.5);
      pdf.line(x + padX * 0.5, cy, x + w - padX * 0.5, cy);
    }
    let cx = x + padX;
    for (const cell of l.cells) {
      const { c, f, cw } = cell;
      const ty = cy + l.padTop;
      if (cell.image) {
        const ih = l.r.fill ? bottom - ty - l.padBottom : cell.height;
        const url = imageUrl(f, data[c.key]);
        const img = url ? await loadImage(url) : null;
        if (img && ih > 2) {
          // Cover the box, cropping the overflow, like the site does.
          const s = Math.max(cw / img.w, ih / img.h);
          pdf.saveGraphicsState();
          pdf.rect(cx, ty, cw, ih, null);
          pdf.clip();
          pdf.discardPath();
          pdf.addImage(img.data, 'JPEG', cx + (cw - img.w * s) / 2, ty + (ih - img.h * s) / 2, img.w * s, img.h * s);
          pdf.restoreGraphicsState();
        } else if (ih > 2) {
          pdf.setFillColor(238, 234, 230);
          pdf.rect(cx, ty, cw, ih, 'F');
        }
      } else {
        const color = l.r.band ? (c.muted ? [235, 225, 222] : [255, 255, 255]) : c.muted ? GREY : DARK;
        const ax = c.align === 'center' ? cx + cw / 2 : c.align === 'right' ? cx + cw : cx;
        let ly = ty;
        if (c.label) {
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(cell.fs * 0.7);
          pdf.setTextColor(...(l.r.band ? [235, 225, 222] : GREY));
          pdf.text(pdfSafe(f.label.toUpperCase()), ax, ly, { align: c.align, baseline: 'top' });
          ly += cell.labelH;
        }
        pdf.setFont(...fontFor(f, c));
        pdf.setFontSize(cell.fs);
        pdf.setTextColor(...color);
        const limit = bottom - (l.r.fill ? l.padBottom : 0);
        for (let i = 0; i < cell.lines.length; i++) {
          // Text that doesn't fit the card ends with "...".
          const last = ly + cell.lh * 2 > limit + 0.5 && i < cell.lines.length - 1;
          if (ly + cell.lh > limit + 0.5) break;
          pdf.text(last ? `${cell.lines[i].replace(/\s*\S*$/, '')}...` : cell.lines[i], ax, ly, { align: c.align, baseline: 'top' });
          ly += cell.lh;
          if (last) break;
        }
      }
      cx += cw + gap;
    }
    cy += rh;
  }

  // The accent edge on top, the version in the bottom corner, and a square outline to cut along.
  pdf.setFillColor(...accent);
  pdf.rect(x, y, w, top, 'F');
  if (versionLabel) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(Math.max(5, 0.62 * u));
    pdf.setTextColor(140, 28, 26);
    pdf.text(pdfSafe(versionLabel.toUpperCase()), x + w - padX, y + h - 0.5 * u, { align: 'right' });
  }
  pdf.setDrawColor(150, 142, 135);
  pdf.setLineWidth(0.5);
  pdf.rect(x, y, w, h, 'S');
}

/** Cards as a table: the fields shown on the card, one card per row, on landscape pages. */
function cardTable(pdf, { type, cards }, { paper: page, format, title, shText }) {
  const W = page.h;
  const H = page.w;
  const M = 36;
  const fields = fieldsOf(type);
  const id = type.fields.find((f) => f.kind === 'id');
  const onCard = cardLayout(type)
    .rows.flatMap((r) => r.cells.map((c) => fields.get(c.key)))
    .filter((f) => f && f.kind !== 'image');
  const cols = [...(id ? [{ key: id.key, label: '#', weight: 0.5 }] : []), ...onCard.map((f) => ({ key: f.key, label: f.label, weight: f.kind === 'ability' ? 5 : f.kind === 'lore' ? 3 : f.kind === 'title' ? 2 : f.kind === 'value' ? 0.8 : 1.2 }))];
  const hasVersions = cards.some((c) => c.label);
  if (hasVersions) cols.push({ key: '__version', label: 'Version', weight: 1.2 });
  const total = cols.reduce((n, c) => n + c.weight, 0);
  const pad = 3;
  const widths = cols.map((c) => ((W - 2 * M) * c.weight) / total);
  const FS = 7.5;
  const LH = FS * 1.25;

  let y = 0;
  const header = () => {
    pdf.setFillColor(240, 235, 230);
    pdf.rect(M, y, W - 2 * M, LH + pad * 2, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(FS);
    pdf.setTextColor(...DARK);
    let x = M;
    cols.forEach((c, i) => {
      pdf.text(pdfSafe(c.label), x + pad, y + pad, { baseline: 'top' });
      x += widths[i];
    });
    y += LH + pad * 2;
  };
  const newPage = (first) => {
    pdf.addPage(format, 'landscape');
    cardHeading(pdf, `${type.name} (${cards.length})`, first ? `${changedNote(cards)} Changed values are in bold.` : 'continued', M, M - 6);
    pageFooter(pdf, `${title} - ${type.name}`, M, H - 20);
    y = M + HEADING;
    header();
  };
  newPage(true);

  for (const card of cards) {
    const changed = new Set(card.label ? Object.keys(card.changed || {}) : []);
    const cells = cols.map((c, i) => {
      const raw = c.key === '__version' ? card.label || '' : isEmptyValue(card.data[c.key], type) ? '' : shText(String(card.data[c.key]), false);
      const bold = c.key === '__version' || changed.has(c.key);
      pdf.setFont('helvetica', bold ? 'bold' : 'normal');
      pdf.setFontSize(FS);
      return { lines: pdf.splitTextToSize(pdfSafe(raw), widths[i] - pad * 2), bold };
    });
    const rh = Math.max(1, ...cells.map((c) => c.lines.length)) * LH + pad * 2;
    if (y + rh > H - M) newPage(false);
    let x = M;
    cells.forEach((c, i) => {
      pdf.setFont('helvetica', c.bold ? 'bold' : 'normal');
      pdf.setFontSize(FS);
      pdf.setTextColor(...(cols[i].key === '__version' ? [140, 28, 26] : DARK));
      c.lines.forEach((line, li) => pdf.text(line, x + pad, y + pad + li * LH, { baseline: 'top' }));
      x += widths[i];
    });
    y += rh;
    pdf.setDrawColor(220, 214, 208);
    pdf.setLineWidth(0.4);
    pdf.line(M, y, W - M, y);
  }
}
