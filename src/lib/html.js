import DOMPurify from 'dompurify';

const ALLOWED_TAGS = ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li', 'span', 'div', 'a', 'small', 'sup', 'sub', 'blockquote', 'code', 'img', 'figure', 'figcaption', 'hr', 'h4', 'h5'];
// No `style`: suggestions come from any signed-in user, so they must not be able to restyle the page.
const ALLOWED_ATTR = ['href', 'title', 'class', 'src', 'alt', 'loading', 'referrerpolicy'];

const sanitize = (html) => DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });

// Images in rules and cards are externally hosted: allow only http(s) (and inline data) sources,
// load them lazily and don't tell the image host which page they are on.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName !== 'IMG') return;
  const src = node.getAttribute('src') || '';
  if (src && !/^(https?:)?\/\//i.test(src) && !src.startsWith('data:image/')) node.removeAttribute('src');
  node.setAttribute('loading', 'lazy');
  node.setAttribute('referrerpolicy', 'no-referrer');
});

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const SHORTHAND_RE = /\[([a-z0-9_-]+)\]/gi;

/** Expand [keyword] shorthands into emoji or inline images. */
export function expandShorthands(html, shorthands) {
  if (!shorthands) return html;
  return html.replace(SHORTHAND_RE, (match, key) => {
    const sh = shorthands[key.toLowerCase()];
    if (!sh || !sh.value) return match;
    if (sh.type === 'image') {
      if (!/^https?:\/\//i.test(sh.value) && !sh.value.startsWith('data:image/')) return match;
      return `<img class="sh" src="${escapeHtml(sh.value)}" alt="${escapeHtml(key)}" title="${escapeHtml(key)}">`;
    }
    return `<span class="sh" title="${escapeHtml(key)}">${escapeHtml(sh.value)}</span>`;
  });
}

// Note boxes: {box n}…{/box}, in one of the eight preset styles (Admin → Rules → Notes), and
// {box n Heading}…{/box} with a heading of its own. Curly braces, so they never clash with
// [shorthands]. The preset's colour and name come from CSS variables (see BoxStyles), so changing a
// preset restyles every box without touching the text.
const BOX_ANY = /\{box\s+([1-8])(?:\s+([^{}]*?))?\s*\}|\{\/box\}/gi;

export function expandBoxes(html) {
  if (!/\{\/?box\b/i.test(html)) return html;
  // A marker at the edge of a paragraph moves outside it, so the box wraps whole paragraphs.
  let s = html
    .replace(/<p>\s*(\{box\s+[1-8][^{}]*\})\s*/gi, '$1<p>')
    .replace(/\s*(\{\/box\})\s*<\/p>/gi, '</p>$1')
    .replace(/<p>\s*<\/p>/gi, '');
  let open = 0;
  s = s.replace(BOX_ANY, (m, n, title) => {
    // A stray {/box} is dropped; an unclosed box ends with the text.
    if (!n) {
      if (!open) return '';
      open--;
      return '</div>';
    }
    open++;
    const t = (title || '').replace(/<[^>]*>/g, '').replace(/[<>]/g, '').trim();
    return `<div class="box box-${n}${t ? ' has-title' : ''}">${t ? `<span class="box-title">${t}</span>` : ''}`;
  });
  return s + '</div>'.repeat(open);
}

/**
 * Text split into plain parts and boxes (for the PDF): [{ html }, { box: n, title, html }, …].
 * Boxes don't nest; the markers are gone from the parts.
 */
export function boxSegments(html) {
  const text = String(html || '');
  const out = [];
  let cur = { html: '' };
  let last = 0;
  for (const m of text.matchAll(BOX_ANY)) {
    cur.html += text.slice(last, m.index);
    last = m.index + m[0].length;
    out.push(cur);
    cur = m[1] ? { box: Number(m[1]), title: (m[2] || '').replace(/<[^>]*>/g, '').trim(), html: '' } : { html: '' };
  }
  cur.html += text.slice(last);
  out.push(cur);
  return out.filter((p) => p.box || p.html.replace(/<[^>]*>/g, '').trim());
}

/** Sanitized HTML with shorthands and note boxes, ready for dangerouslySetInnerHTML. */
export function richHtml(value, shorthands) {
  if (value == null || value === '') return '';
  return sanitize(expandShorthands(expandBoxes(sanitize(String(value))), shorthands));
}

/** Plain text (for search, PDF export and previews). */
export function toPlainText(html) {
  if (!html) return '';
  const s = String(html)
    // A box's own heading stays readable ("Careful: …"); the markers go.
    .replace(BOX_ANY, (m, n, title) => (n && title ? `\n${title.replace(/<[^>]*>/g, '').trim()}: ` : '\n'))
    .replace(/<\s*img\b[^>]*?\balt\s*=\s*"([^"]*)"[^>]*>/gi, (_, alt) => `[Image${alt ? `: ${alt}` : ''}]`)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<\/\s*(p|div|ul|ol|h4|h5|blockquote)\s*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');
  const el = document.createElement('textarea');
  el.innerHTML = s;
  return el.value.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Comments are plain text: escape and keep line breaks. */
export function plainToHtml(text) {
  return escapeHtml(text || '').replace(/\n/g, '<br>');
}

export { escapeHtml };
