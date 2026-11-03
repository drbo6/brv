import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase.js';

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
  { id: 'roles', label: 'Roles and restrictions' },
  { id: 'modlog', label: 'Moderation log' },
  { id: 'adminChat', label: 'Staff chat' },
];

export const FORMAT = 'brv-backup';

// Bookkeeping that is regenerated, not worth keeping.
const SKIP_DOCS = new Set(['config/componentsMeta']);

// Timestamps become {"__ts": millis} so they survive the trip through JSON.
const encode = (v) => {
  if (v && typeof v.toMillis === 'function') return { __ts: v.toMillis() };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
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

export function downloadJson(data, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
