import { collection, doc, getDoc, getDocs, increment, serverTimestamp, setDoc } from 'firebase/firestore';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { db } from './firebase.js';
import { commitInChunks } from './rules.js';

export const FIELD_KINDS = {
  id: { label: 'ID', help: 'Unique identifier. Exactly one per component type.' },
  title: { label: 'Title', help: 'Name of the component. Need not be unique.' },
  type: { label: 'Type', help: 'Category, faction, god… Can be offered as a filter.' },
  image: { label: 'Image', help: 'External image URL (or a value inserted into a URL template).' },
  ability: { label: 'Ability', help: 'Gameplay text. HTML and [shorthands] are rendered.' },
  lore: { label: 'Lore', help: 'Flavor text with no gameplay effect.' },
  value: { label: 'Value', help: 'A number such as a cost or strength. Sorts numerically.' },
  state: { label: 'State', help: 'Marks this component as an alternate state (flipped, turned, upgraded…) of another component.' },
};

export const FONTS = { body: 'Body serif', display: 'Display', condensed: 'Condensed', title: 'Blackletter', sans: 'Sans' };
export const SHAPES = { none: 'None', box: 'Rounded box', pill: 'Pill', circle: 'Filled circle', ring: 'Ring' };
export const BACKGROUNDS = { none: 'None', accent: 'Accent color', dark: 'Dark', light: 'Light', shade: 'Fade to dark (over images)' };

export const slugKey = (s) =>
  String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'field';

export const docIdFor = (typeId, idValue) => `${typeId}__${String(idValue).trim().replace(/[/\\.#$[\]]+/g, '-').slice(0, 300)}`;

export const DEFAULT_STYLE = { fontScale: 1, font: 'body', align: 'center', valign: 'middle', bold: false, italic: false, upper: false, vertical: false, shape: 'none', bg: 'none', color: '', prefix: '', suffix: '', showLabel: false };

export function newField(label, kind = 'ability', existingKeys = []) {
  let key = slugKey(label);
  let n = 2;
  const base = key;
  while (existingKeys.includes(key)) key = `${base}_${n++}`;
  return { key, label, kind, filterable: kind === 'type', urlTemplate: '', layout: { show: false, x: 2, y: 2, w: 8, h: 3, z: 1 }, style: { ...DEFAULT_STYLE } };
}

/** A sensible starting layout: title on top, image, value badges, a type band and the ability text. */
export function autoLayout(fields, cols, rows) {
  const out = fields.map((f) => ({ ...f, layout: { ...f.layout, show: false }, style: { ...DEFAULT_STYLE, ...f.style } }));
  const first = (kind) => out.find((f) => f.kind === kind);
  const place = (f, layout, style = {}) => {
    if (!f) return;
    f.layout = { show: true, z: 1, ...layout };
    f.style = { ...DEFAULT_STYLE, ...style };
  };
  const th = Math.max(2, Math.round(rows * 0.12));
  const title = first('title');
  place(title, { x: 0, y: 0, w: cols, h: th, z: 2 }, { font: 'display', bold: true, fontScale: 1.3 });
  let y = title ? th : 0;
  const image = first('image');
  const imageTop = y;
  if (image) {
    const ih = Math.round(rows * 0.42);
    place(image, { x: 0, y, w: cols, h: ih });
    y += ih;
  }
  const badge = Math.max(2, Math.round(cols * 0.22));
  out
    .filter((f) => f.kind === 'value')
    .slice(0, 3)
    .forEach((f, i) => {
      const x = [0, cols - badge, Math.round((cols - badge) / 2)][i];
      place(f, { x, y: imageTop + (image ? 1 : 0), w: badge, h: Math.max(2, Math.round((badge * rows) / cols)), z: 4 }, { font: 'display', bold: true, fontScale: 1.6, shape: 'circle', bg: 'dark' });
    });
  if (!image) y = imageTop + Math.max(2, Math.round((badge * rows) / cols)) + 1;
  const type = first('type');
  if (type) {
    place(type, { x: 0, y, w: cols, h: 2, z: 2 }, { font: 'condensed', upper: true, fontScale: 0.9, bg: 'dark' });
    y += 2;
  }
  const lore = first('lore');
  const loreH = lore ? Math.max(2, Math.round(rows * 0.1)) : 0;
  place(first('ability'), { x: 0, y, w: cols, h: Math.max(2, rows - y - loreH), z: 2 }, { fontScale: 0.95 });
  place(lore, { x: 0, y: rows - loreH, w: cols, h: loreH, z: 2 }, { italic: true, fontScale: 0.75 });
  return out;
}

export const NEW_TYPE = { name: 'New component type', order: 99, aspect: 0.7, cols: 20, rows: 28, emptyValues: ['n/a'], accentField: '', accentColors: {}, defaultAccent: '#2b2427', fields: [] };

export function isEmptyValue(v, type) {
  if (v == null) return true;
  if (typeof v === 'object') return !v.of;
  const s = String(v).trim();
  return s === '' || (type?.emptyValues || []).some((e) => e.toLowerCase() === s.toLowerCase());
}

export function imageUrl(field, value) {
  if (value == null || value === '') return '';
  const v = String(value).trim();
  if (/^(https?:)?\/\//i.test(v) || v.startsWith('data:image/')) return v;
  if (field.urlTemplate) return field.urlTemplate.replace(/\{value\}/g, encodeURIComponent(v));
  return '';
}

export const idField = (type) => type?.fields?.find((f) => f.kind === 'id');
export const titleField = (type) => type?.fields?.find((f) => f.kind === 'title');
export const stateField = (type) => type?.fields?.find((f) => f.kind === 'state');

export function displayTitle(type, comp) {
  const t = titleField(type);
  const i = idField(type);
  return (t && comp.data?.[t.key]) || (i && comp.data?.[i.key]) || comp.id;
}

/** Numeric-aware compare; empty values sort last. */
export function compareValues(a, b, type) {
  const ea = isEmptyValue(a, type);
  const eb = isEmptyValue(b, type);
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  if (Number.isFinite(na)) return -1;
  if (Number.isFinite(nb)) return 1;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

// ---------- loading, with a local cache ----------
// Components can number in the thousands. A single "version" counter in config/componentsMeta is bumped
// on every admin write; visitors only re-download everything when it changed.

const CACHE_KEY = 'brv-components-cache';

export async function loadComponents({ force = false } = {}) {
  const meta = await getDoc(doc(db, 'config', 'componentsMeta'));
  const version = meta.exists() ? meta.data().version || 0 : 0;
  if (!force) {
    try {
      const cached = await idbGet(CACHE_KEY);
      if (cached && cached.version === version) return { ...cached, fromCache: true };
    } catch {
      /* IndexedDB unavailable (private mode): fall through to the network */
    }
  }
  const [types, comps] = await Promise.all([getDocs(collection(db, 'componentTypes')), getDocs(collection(db, 'components'))]);
  const result = {
    version,
    types: types.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name)),
    components: comps.docs.map((d) => {
      const { typeId, data } = d.data();
      return { id: d.id, typeId, data: data || {} };
    }),
  };
  try {
    await idbSet(CACHE_KEY, result);
  } catch {
    /* ignore */
  }
  return { ...result, fromCache: false };
}

export const bumpComponentsVersion = () => setDoc(doc(db, 'config', 'componentsMeta'), { version: increment(1), updatedAt: serverTimestamp() }, { merge: true });

export async function saveType(type) {
  const { id, ...data } = type;
  const ref = id ? doc(db, 'componentTypes', id) : doc(collection(db, 'componentTypes'));
  await setDoc(ref, data);
  await bumpComponentsVersion();
  return ref.id;
}

export async function deleteType(typeId, components) {
  const ops = components.filter((c) => c.typeId === typeId).map((c) => (b) => b.delete(doc(db, 'components', c.id)));
  ops.push((b) => b.delete(doc(db, 'componentTypes', typeId)));
  await commitInChunks(ops);
  await bumpComponentsVersion();
}

export async function saveComponent(type, data, previousId) {
  const idf = idField(type);
  const id = docIdFor(type.id, data[idf.key]);
  const ops = [(b) => b.set(doc(db, 'components', id), { typeId: type.id, data, updatedAt: serverTimestamp() })];
  if (previousId && previousId !== id) ops.push((b) => b.delete(doc(db, 'components', previousId)));
  await commitInChunks(ops);
  await bumpComponentsVersion();
  return id;
}

export async function deleteComponents(ids) {
  await commitInChunks(ids.map((id) => (b) => b.delete(doc(db, 'components', id))));
  await bumpComponentsVersion();
}

/** Upsert many rows; rows are { [fieldKey]: value } and must include the ID field. */
export async function importComponents(type, rows, { removeMissing = false, existing = [] } = {}) {
  const idf = idField(type);
  const ids = new Set();
  const ops = [];
  for (const data of rows) {
    const id = docIdFor(type.id, data[idf.key]);
    ids.add(id);
    ops.push((b) => b.set(doc(db, 'components', id), { typeId: type.id, data, updatedAt: serverTimestamp() }));
  }
  let removed = 0;
  if (removeMissing) {
    for (const c of existing) {
      if (c.typeId === type.id && !ids.has(c.id)) {
        ops.push((b) => b.delete(doc(db, 'components', c.id)));
        removed++;
      }
    }
  }
  await commitInChunks(ops);
  await bumpComponentsVersion();
  return { written: ids.size, removed };
}

// ---------- Blood Rage: Valhalla card preset ----------
// Field keys match the column headers of the card spreadsheet, so an import maps automatically.

const f = (key, label, kind, layout, style = {}, extra = {}) => ({
  key,
  label,
  kind,
  filterable: kind === 'type',
  urlTemplate: '',
  layout: layout ? { show: true, z: 1, ...layout } : { show: false, x: 0, y: 0, w: 6, h: 3, z: 1 },
  style: { ...DEFAULT_STYLE, ...style },
  ...extra,
});

export const BLOOD_RAGE_PRESET = {
  name: 'Blood Rage: Valhalla cards',
  order: 1,
  aspect: 485 / 745,
  cols: 20,
  rows: 30,
  emptyValues: ['n/a'],
  accentField: 'type',
  accentColors: { Battle: '#9e2228', Quest: '#3e6b26', Clan: '#1b1a1a', Elite: '#1b1a1a', Monster: '#1b1a1a' },
  defaultAccent: '#2b2427',
  fields: [
    f('id', 'ID', 'id', null),
    f('title', 'Title', 'title', { x: 4, y: 0, w: 16, h: 4, z: 2 }, { font: 'title', fontScale: 1.55, color: '#ffffff' }),
    f('illustration', 'Illustration', 'image', { x: 4, y: 4, w: 16, h: 25, z: 1 }),
    f('ability', 'Ability', 'ability', { x: 4, y: 18, w: 16, h: 11, z: 3 }, { fontScale: 1.05, bg: 'shade', valign: 'bottom', color: '#ffffff' }),
    f('cost', 'Cost', 'value', { x: 1, y: 4, w: 5, h: 4, z: 4 }, { font: 'display', fontScale: 1.8, bold: true, shape: 'circle', bg: '#8f2a25', color: '#ffffff' }),
    f('strength', 'Strength', 'value', { x: 8, y: 9, w: 8, h: 6, z: 4 }, { font: 'display', fontScale: 2.6, bold: true, shape: 'ring', color: '#ffffff', prefix: '+' }),
    f('type', 'Type', 'type', { x: 0, y: 19, w: 4, h: 11, z: 2 }, { font: 'condensed', fontScale: 2.2, vertical: true, upper: true, color: '#ffffff', align: 'left' }),
    f('subtype', 'Subtype', 'type', { x: 0, y: 12, w: 4, h: 7, z: 2 }, { font: 'condensed', fontScale: 1.25, vertical: true, upper: true, color: '#ffffff', align: 'left' }),
    f('god', 'God', 'type', { x: 0, y: 4, w: 4, h: 7, z: 2 }, { font: 'condensed', fontScale: 1.25, vertical: true, upper: true, color: '#ffffff', align: 'right' }),
    f('size', 'Size', 'type', null),
    f('quantity', 'Quantity', 'value', null),
    f('oldtitle', 'OldTitle', 'title', null),
    f('oldability', 'OldAbility', 'lore', null),
  ],
};

export const BLOOD_RAGE_SHORTHANDS = {
  rage: { type: 'emoji', value: '🩸' },
  axes: { type: 'emoji', value: '🪓' },
  horns: { type: 'emoji', value: '📯' },
  tribute: { type: 'emoji', value: '💀' },
};
