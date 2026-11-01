import { collection, doc, getDoc, getDocs, increment, serverTimestamp, setDoc as rawSetDoc } from 'firebase/firestore';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { db } from './firebase.js';
import { commitInChunks, knownState, onRevert, setDoc } from './store.js';

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

export const slugKey = (s) =>
  String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'field';

export const docIdFor = (typeId, idValue) => `${typeId}__${String(idValue).trim().replace(/[/\\.#$[\]]+/g, '-').slice(0, 300)}`;

export function newField(label, kind = 'ability', existingKeys = []) {
  let key = slugKey(label);
  let n = 2;
  const base = key;
  while (existingKeys.includes(key)) key = `${base}_${n++}`;
  return { key, label, kind, filterable: kind === 'type', urlTemplate: '' };
}

// ---------- card layout ----------
// A card is a stack of rows, like block elements on a web page. Each row holds fields side by side,
// like inline-flex items; `width` is a field's share of its row. One or more rows can `fill` the
// remaining height. Text sizes are relative to the card's width, so cards look the same at any size.

export const SIZES = { xs: 'Tiny', s: 'Small', m: 'Normal', l: 'Large', xl: 'Huge' };
export const ALIGNS = ['left', 'center', 'right'];
export const DEFAULT_CELL = { width: 1, size: 'm', align: 'left', bold: false, italic: false, muted: false, upper: false, label: false, prefix: '', suffix: '' };
export const DEFAULT_ROW = { fill: false, band: false, divider: false };

const cell = (key, style = {}) => ({ ...DEFAULT_CELL, key, ...style });
const row = (cells, style = {}) => ({ ...DEFAULT_ROW, ...style, cells });

/** A clean default: title and values on a colored band, type line, image, ability text, lore. */
export function autoLayout(fields) {
  const of = (kind) => fields.filter((f) => f.kind === kind);
  const rows = [];
  const [title] = of('title');
  const values = of('value').slice(0, 2);
  if (title || values.length) {
    rows.push(
      row(
        [
          ...(title ? [cell(title.key, { width: 4, size: 'l', bold: true })] : []),
          ...values.map((f) => cell(f.key, { width: 1, size: 'l', bold: true, align: 'right' })),
        ],
        { band: true },
      ),
    );
  }
  const types = of('type').slice(0, 3);
  if (types.length) rows.push(row(types.map((f) => cell(f.key, { size: 's', upper: true, muted: true }))));
  const [image] = of('image');
  if (image) rows.push(row([cell(image.key)], { fill: true }));
  const [ability] = of('ability');
  if (ability) rows.push(row([cell(ability.key)], { fill: !image, divider: Boolean(types.length && !image) }));
  const [lore] = of('lore');
  if (lore) rows.push(row([cell(lore.key, { size: 's', italic: true, muted: true })], { divider: true }));
  return { rows };
}

/** The type's layout, with unknown fields dropped. Types without one get an automatic layout. */
export function cardLayout(type) {
  const keys = new Set((type.fields || []).filter((f) => f.kind !== 'id' && f.kind !== 'state').map((f) => f.key));
  const source = type.layout?.rows ? type.layout : autoLayout(type.fields || []);
  return {
    rows: source.rows
      .map((r) => ({ ...DEFAULT_ROW, ...r, cells: (r.cells || []).filter((c) => keys.has(c.key)).map((c) => ({ ...DEFAULT_CELL, ...c })) }))
      .filter((r) => r.cells.length),
  };
}

export const NEW_TYPE = { name: 'New component type', order: 99, aspect: 0.7, emptyValues: ['n/a'], accentField: '', accentColors: {}, defaultAccent: '#7c1a17', fields: [], layout: { rows: [] } };

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

export const bumpComponentsVersion = () => rawSetDoc(doc(db, 'config', 'componentsMeta'), { version: increment(1), updatedAt: serverTimestamp() }, { merge: true });

// Undoing a component change must also invalidate visitors' caches.
onRevert((paths) => {
  if (paths.some((p) => p.startsWith('components/') || p.startsWith('componentTypes/'))) bumpComponentsVersion().catch((e) => console.warn(e));
});

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
  // `existing` is fresh, so the undo history can use it instead of reading every document again.
  const before = new Map(existing.map((c) => [c.id, c]));
  for (const data of rows) {
    const id = docIdFor(type.id, data[idf.key]);
    if (!ids.has(id)) {
      const prev = before.get(id);
      knownState(doc(db, 'components', id), prev ? { typeId: prev.typeId, data: prev.data } : null);
    }
    ids.add(id);
    ops.push((b) => b.set(doc(db, 'components', id), { typeId: type.id, data, updatedAt: serverTimestamp() }));
  }
  let removed = 0;
  if (removeMissing) {
    for (const c of existing) {
      if (c.typeId === type.id && !ids.has(c.id)) {
        knownState(doc(db, 'components', c.id), { typeId: c.typeId, data: c.data });
        ops.push((b) => b.delete(doc(db, 'components', c.id)));
        removed++;
      }
    }
  }
  await commitInChunks(ops);
  await bumpComponentsVersion();
  return { written: ids.size, removed };
}
