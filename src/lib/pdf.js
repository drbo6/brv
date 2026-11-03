import { toPlainText } from './html.js';

// jsPDF's built-in fonts only cover Latin-1, so swap typographic characters for safe ones.
const pdfSafe = (s) =>
  String(s || '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/•/g, '·')
    .replace(/[^\x00-\xff·]/g, '');

/**
 * Export rules as a text PDF.
 * groups: [{ heading, depth, rules: [{ code, title, label, kindLabel, inactive, html }] }]
 */
export async function exportRulesPdf({ title, subtitle, groups, shorthands, filename }) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const M = 54;
  const width = W - M * 2;
  let y = M;

  const ensure = (h) => {
    if (y + h > H - M) {
      pdf.addPage();
      y = M;
    }
  };
  const write = (text, { size = 10, style = 'normal', color = [30, 26, 24], gap = 4, indent = 0 } = {}) => {
    pdf.setFont('helvetica', style);
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    const lines = pdf.splitTextToSize(pdfSafe(text), width - indent);
    const lh = size * 1.32;
    for (const line of lines) {
      ensure(lh);
      pdf.text(line, M + indent, y + size);
      y += lh;
    }
    y += gap;
  };
  // Show shorthands as their keyword in the PDF, e.g. "(Rage)".
  const shText = (html) => toPlainText(html).replace(/\[([a-z0-9_-]+)\]/gi, (m, k) => (shorthands?.[k.toLowerCase()] ? `(${k[0].toUpperCase()}${k.slice(1)})` : m));

  write(title, { size: 20, style: 'bold', gap: 2 });
  write(subtitle, { size: 10, color: [110, 100, 95], gap: 14 });

  for (const g of groups) {
    if (g.heading) {
      ensure(40);
      y += g.depth === 0 ? 8 : 4;
      write(g.heading, { size: g.depth === 0 ? 15 : g.depth === 1 ? 12.5 : 11.5, style: 'bold', color: [140, 28, 26], gap: 6 });
    }
    for (const r of g.rules) {
      ensure(48);
      const tags = [r.label, r.kindLabel, r.inactive ? 'not in ruleset' : null].filter(Boolean).join(' | ');
      write(`${r.sid ? `${r.sid}  ` : ''}${r.title || ''}${r.ref ? `  (${r.ref})` : ''}`, { size: 10.5, style: 'bold', gap: 1, color: r.inactive ? [140, 135, 130] : [30, 26, 24] });
      if (tags) write(tags, { size: 8, color: [120, 110, 105], gap: 2 });
      write(shText(r.html), { size: 10, gap: 10, color: r.inactive ? [140, 135, 130] : [30, 26, 24] });
    }
  }

  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(140, 135, 130);
    pdf.text(pdfSafe(`${title} - page ${i} of ${pages}`), M, H - 28);
  }
  pdf.save(filename);
}
