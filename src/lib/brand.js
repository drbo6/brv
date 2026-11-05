// The site's identity, set by the owner in Admin → Site: name, tagline, the mark in the header,
// the welcome window, the disclaimer, two colors and three fonts. Stored in config/brand (owner
// only); anything left empty falls back to the neutral defaults below.

export const DEFAULT_COLORS = { primary: '#c4302b', accent: '#d1a54b' };
export const DEFAULT_FONTS = { display: 'Cinzel', text: 'Alegreya', ui: 'Alegreya Sans' };

export const DEFAULT_BRAND = {
  name: 'Living Rulebook',
  tagline: 'Community rules hub',
  mark: '§',
  welcomeKicker: 'Welcome to the',
  welcomeText: '', // HTML; empty shows the built-in introduction
  welcomeButton: 'Get started',
  disclaimer: '', // empty shows the built-in disclaimer
  colors: DEFAULT_COLORS,
  fonts: DEFAULT_FONTS,
};

/** The saved brand over the defaults (empty text means "use the default"). */
export function brandOf(saved) {
  const b = saved || {};
  const pick = (k) => (typeof b[k] === 'string' && b[k].trim() ? b[k] : DEFAULT_BRAND[k]);
  return {
    name: pick('name'),
    tagline: typeof b.tagline === 'string' ? b.tagline : DEFAULT_BRAND.tagline,
    mark: pick('mark'),
    welcomeKicker: typeof b.welcomeKicker === 'string' ? b.welcomeKicker : DEFAULT_BRAND.welcomeKicker,
    welcomeText: b.welcomeText || '',
    welcomeButton: pick('welcomeButton'),
    disclaimer: b.disclaimer || '',
    colors: { ...DEFAULT_COLORS, ...validColors(b.colors) },
    fonts: { ...DEFAULT_FONTS, ...validFonts(b.fonts) },
  };
}

const HEX = /^#[0-9a-f]{6}$/i;
const validColors = (c) => Object.fromEntries(Object.entries(c || {}).filter(([k, v]) => k in DEFAULT_COLORS && HEX.test(v || '')));
// A font name is letters, digits and spaces (it goes into CSS and a Google Fonts address).
const FONT_NAME = /^[A-Za-z0-9 ]{2,40}$/;
const validFonts = (f) => Object.fromEntries(Object.entries(f || {}).filter(([k, v]) => k in DEFAULT_FONTS && FONT_NAME.test(v || '')));

/** Google Fonts offered in the font pickers, by what they suit (any other Google font can be typed in). */
export const FONT_CHOICES = {
  display: ['Cinzel', 'Cinzel Decorative', 'Uncial Antiqua', 'MedievalSharp', 'IM Fell English SC', 'Pirata One', 'Playfair Display', 'Bebas Neue', 'Oswald', 'Montserrat', 'Alegreya SC', 'Marcellus'],
  text: ['Alegreya', 'EB Garamond', 'Crimson Pro', 'Lora', 'Merriweather', 'Source Serif 4', 'Libre Baskerville', 'IM Fell English', 'Inter', 'Open Sans', 'Roboto'],
  ui: ['Alegreya Sans', 'Inter', 'Roboto', 'Open Sans', 'Lato', 'Nunito Sans', 'Work Sans', 'Source Sans 3', 'Fira Sans', 'Montserrat'],
};

// Fallbacks while a font loads (or if it doesn't).
const STACK = { display: "'Alegreya', Georgia, serif", text: "Georgia, 'Times New Roman', serif", ui: "system-ui, -apple-system, 'Segoe UI', sans-serif" };

// ---------- colors ----------

const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
/** Mix a color toward white (amount > 0) or black (amount < 0). */
const shade = (hex, amount) => toHex(toRgb(hex).map((v) => (amount > 0 ? v + (255 - v) * amount : v * (1 + amount))));
const rgba = (hex, a) => `rgba(${toRgb(hex).join(', ')}, ${a})`;

/**
 * CSS that applies the brand's colors and fonts over the stylesheet's defaults, for both themes.
 * Nothing is written for what is still the default, so the default look stays exactly as designed.
 */
export function brandCss(brand) {
  const { colors, fonts } = brand;
  const dark = [];
  const light = [];
  const extra = [];
  if (colors.primary.toLowerCase() !== DEFAULT_COLORS.primary) {
    const p = colors.primary;
    dark.push(`--blood:${p}`, `--blood-2:${shade(p, 0.15)}`, `--blood-dark:${shade(p, -0.45)}`);
    light.push(`--blood:${shade(p, -0.1)}`, `--blood-2:${shade(p, -0.15)}`, `--blood-dark:${shade(p, -0.45)}`);
  }
  if (colors.accent.toLowerCase() !== DEFAULT_COLORS.accent) {
    const a = colors.accent;
    dark.push(`--gold:${a}`, `--gold-2:${shade(a, 0.25)}`, `--focus:${shade(a, 0.25)}`);
    light.push(`--gold:${shade(a, -0.25)}`, `--gold-2:${shade(a, -0.4)}`, `--focus:${shade(a, -0.25)}`);
  }
  if (dark.length) {
    // The page's soft glow follows the colors too.
    const glow = (p, a, pa, aa) =>
      `background:radial-gradient(1200px 600px at 10% -10%, ${rgba(p, pa)}, transparent 60%),radial-gradient(900px 500px at 110% 0%, ${rgba(a, aa)}, transparent 60%),var(--bg);background-attachment:fixed`;
    extra.push(`:root body{${glow(colors.primary, colors.accent, 0.12, 0.07)}}`, `:root[data-theme='light'] body{${glow(colors.primary, colors.accent, 0.07, 0.08)}}`);
  }
  for (const role of Object.keys(DEFAULT_FONTS)) {
    if (fonts[role] !== DEFAULT_FONTS[role]) dark.push(`--font-${role}:'${fonts[role]}', ${STACK[role]}`);
  }
  return [dark.length && `:root{${dark.join(';')}}`, light.length && `:root[data-theme='light']{${light.join(';')}}`, ...extra].filter(Boolean).join('');
}

/** Google Fonts addresses for the brand's fonts that index.html doesn't load already. */
export function fontUrls(fonts) {
  const extra = [...new Set(Object.keys(DEFAULT_FONTS).filter((r) => fonts[r] !== DEFAULT_FONTS[r]).map((r) => fonts[r]))];
  // One link per font: a font that lacks a weight (or doesn't exist) then can't break the others.
  return extra.map((f) => `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f).replace(/%20/g, '+')}&display=swap`);
}
