import { collection, doc, getDocs, Timestamp } from 'firebase/firestore';
import { db } from './firebase.js';
import { commitInChunks, knownState } from './store.js';
import { bumpComponentsVersion } from './components.js';

/** Every collection the site uses, in a sensible restore order. */
export const COLLECTIONS = [
  { id: 'sections', label: 'Rule sections' },
  { id: 'rules', label: 'Rules' },
  { id: 'versions', label: 'Rule versions' },
  { id: 'comments', label: 'Discussion comments' },
  { id: 'rulesets', label: 'Rulesets' },
  { id: 'componentTypes', label: 'Component types' },
  { id: 'components', label: 'Components' },
  { id: 'componentVersions', label: 'Component versions' },
  { id: 'componentMeta', label: 'Component reactions' },
  { id: 'config', label: 'Site settings & shorthands' },
  { id: 'admins', label: 'Admins' },
  { id: 'users', label: 'User profiles' },
  { id: 'usernames', label: 'Username claims' },
  { id: 'subscribers', label: 'Who follows what' },
  { id: 'adminChat', label: 'Admin chat' },
];

export const FORMAT = 'brv-backup';

// Bookkeeping that is regenerated, never restored.
const SKIP_DOCS = new Set(['config/componentsMeta']);

// Timestamps become {"__ts": millis} so they survive the trip through JSON.
const encode = (v) => {
  if (v && typeof v.toMillis === 'function') return { __ts: v.toMillis() };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  return v;
};
const decode = (v) => {
  if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && typeof v.__ts === 'number') return Timestamp.fromMillis(v.__ts);
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]));
  return v;
};

async function readCollection(name) {
  const snap = await getDocs(collection(db, name));
  const out = {};
  snap.docs.forEach((d) => {
    if (!SKIP_DOCS.has(`${name}/${d.id}`)) out[d.id] = d.data();
  });
  return out;
}

export async function exportDatabase(names = COLLECTIONS.map((c) => c.id)) {
  const collections = {};
  for (const name of names) collections[name] = encode(await readCollection(name));
  return { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), collections };
}

/** Validates a parsed backup file and counts what it holds. Throws with a readable message. */
export function inspectBackup(data) {
  if (!data || data.format !== FORMAT || typeof data.collections !== 'object') throw new Error('This is not a site backup file (expected "format": "brv-backup").');
  const known = new Set(COLLECTIONS.map((c) => c.id));
  const counts = {};
  for (const [name, docs] of Object.entries(data.collections)) {
    if (!known.has(name)) continue;
    if (!docs || typeof docs !== 'object' || Array.isArray(docs)) throw new Error(`Collection "${name}" must be an object of { id: data }.`);
    counts[name] = Object.keys(docs).length;
  }
  return counts;
}

/**
 * Write a backup into the database.
 * - merge: documents in the file are created or overwritten; everything else is left alone.
 * - replace: the chosen collections end up exactly as in the file (other documents are deleted).
 * `protect` lists "collection/id" paths that replace mode must not delete (e.g. your own admin entry).
 * Runs as one undoable action when called inside `attempt`.
 */
export async function importDatabase(data, { names, mode = 'merge', protect = [] }) {
  const keep = new Set(protect);
  const ops = [];
  let written = 0;
  let removed = 0;
  for (const name of names) {
    const incoming = data.collections[name] || {};
    const current = await readCollection(name);
    // The undo history needs each document's previous state; we already have it.
    for (const [id, d] of Object.entries(current)) knownState(doc(db, name, id), d);
    for (const [id, d] of Object.entries(incoming)) {
      if (SKIP_DOCS.has(`${name}/${id}`)) continue;
      if (!(id in current)) knownState(doc(db, name, id), null);
      ops.push((b) => b.set(doc(db, name, id), decode(d)));
      written++;
    }
    if (mode === 'replace') {
      for (const id of Object.keys(current)) {
        if (!(id in incoming) && !keep.has(`${name}/${id}`)) {
          ops.push((b) => b.delete(doc(db, name, id)));
          removed++;
        }
      }
    }
  }
  await commitInChunks(ops);
  if (names.includes('components') || names.includes('componentTypes')) await bumpComponentsVersion();
  return { written, removed };
}

export function downloadJson(data, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
