import DOMPurify from 'dompurify';

const ALLOWED_TAGS = ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li', 'span', 'div', 'a', 'small', 'sup', 'sub', 'blockquote', 'code', 'img', 'hr', 'h4', 'h5'];
// No `style`: suggestions come from any signed-in user, so they must not be able to restyle the page.
const ALLOWED_ATTR = ['href', 'title', 'class', 'src', 'alt'];

const sanitize = (html) => DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });

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

/** Sanitized HTML with shorthands, ready for dangerouslySetInnerHTML. */
export function richHtml(value, shorthands) {
  if (value == null || value === '') return '';
  return sanitize(expandShorthands(sanitize(String(value)), shorthands));
}

/** Plain text (for search, PDF export and previews). */
export function toPlainText(html) {
  if (!html) return '';
  const s = String(html)
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
