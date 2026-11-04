// Minimal in-browser stand-in for the subset of `firebase/firestore` this app uses.
// Data lives in localStorage so demo edits survive reloads. Security rules are NOT enforced here.

// The game content is kept out of the repository (imports/ is ignored). When it is on this machine, a
// fresh demo starts with it; otherwise the demo starts empty, like a new site.
const seed = Object.values(import.meta.glob('../../imports/blood-rage-valhalla.json', { eager: true, import: 'default' }))[0];

const STORE_KEY = 'brv-demo-db';
const listeners = new Set();
let store = {}; // filled below, once Timestamp exists (load() revives timestamps)

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '{}', (k, v) =>
      v && typeof v === 'object' && '__ts' in v ? new Timestamp(v.__ts) : v,
    );
  } catch {
    return {};
  }
}

let saveQueued = false;
function persistAndNotify() {
  if (!saveQueued) {
    saveQueued = true;
    setTimeout(() => {
      saveQueued = false;
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify(store, function (k, v) {
          const raw = this[k];
          return raw instanceof Timestamp ? { __ts: raw.toMillis() } : v;
        }),
      );
    }, 50);
  }
  // Async like the real SDK.
  queueMicrotask(() => listeners.forEach((l) => l()));
}

// Other tabs of the demo share localStorage: pick up their writes, so the demo shows live collaboration.
window.addEventListener('storage', (e) => {
  if (e.key !== STORE_KEY) return;
  store = load();
  listeners.forEach((l) => l());
});

export class Timestamp {
  constructor(ms) {
    this._ms = ms;
    this.seconds = Math.floor(ms / 1000);
    this.nanoseconds = (ms % 1000) * 1e6;
  }
  toMillis() {
    return this._ms;
  }
  toDate() {
    return new Date(this._ms);
  }
  static now() {
    return new Timestamp(Date.now());
  }
  static fromMillis(ms) {
    return new Timestamp(ms);
  }
}

store = load();
// A fresh demo starts with the Blood Rage content (if present), so there is something to try.
if (!Object.keys(store).length && seed) {
  store = JSON.parse(JSON.stringify(seed.collections), (k, v) => (v && typeof v === 'object' && '__ts' in v ? new Timestamp(v.__ts) : v));
  persistAndNotify();
}

const SENTINEL = Symbol('sentinel');
export const serverTimestamp = () => ({ [SENTINEL]: 'ts' });
export const deleteField = () => ({ [SENTINEL]: 'delete' });
export const increment = (n) => ({ [SENTINEL]: 'inc', n });

export function getFirestore() {
  return { type: 'demo-firestore' };
}

const autoId = () => Array.from({ length: 20 }, () => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 62)]).join('');

// Paths may be nested (inbox/{uid}/items): a collection is stored under its full path.
export function collection(_db, ...segments) {
  return { kind: 'collection', path: segments.join('/') };
}

export function doc(parent, ...segments) {
  let col;
  let id;
  if (parent.kind === 'collection') {
    col = parent.path;
    id = segments[0] ?? autoId();
  } else {
    const parts = segments.join('/').split('/');
    id = parts.pop();
    col = parts.join('/');
  }
  return { kind: 'doc', col, id, path: `${col}/${id}` };
}

export const where = (field, op, value) => ({ type: 'where', field, op, value });
export const orderBy = (field, dir = 'asc') => ({ type: 'orderBy', field, dir });
export const limit = (n) => ({ type: 'limit', n });
export const query = (col, ...constraints) => ({ kind: 'query', path: col.path, constraints });

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const cmpVal = (v) => (v instanceof Timestamp ? v.toMillis() : v);

function clone(v) {
  if (v instanceof Timestamp) return v;
  if (Array.isArray(v)) return v.map(clone);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]));
  return v;
}

function resolve(value, prev) {
  if (value && typeof value === 'object' && value[SENTINEL]) {
    if (value[SENTINEL] === 'ts') return Timestamp.now();
    if (value[SENTINEL] === 'inc') return (typeof prev === 'number' ? prev : 0) + value.n;
  }
  if (value && typeof value === 'object' && !(value instanceof Timestamp) && !Array.isArray(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v && v[SENTINEL] === 'delete') continue;
      out[k] = resolve(v, prev?.[k]);
    }
    return out;
  }
  return clone(value);
}

function mergeDeep(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && v[SENTINEL] === 'delete') delete target[k];
    else if (v && typeof v === 'object' && !v[SENTINEL] && !(v instanceof Timestamp) && !Array.isArray(v) && target[k] && typeof target[k] === 'object') mergeDeep(target[k], v);
    else target[k] = resolve(v, target[k]);
  }
  return target;
}

function rawSet(ref, data, opts) {
  const col = (store[ref.col] ||= {});
  col[ref.id] = opts?.merge && col[ref.id] ? mergeDeep(col[ref.id], data) : resolve(data);
}

function rawUpdate(ref, data) {
  const current = store[ref.col]?.[ref.id];
  if (!current) throw new Error(`No document to update: ${ref.col}/${ref.id}`);
  for (const [path, v] of Object.entries(data)) {
    const keys = path.split('.');
    let o = current;
    for (const k of keys.slice(0, -1)) o = o[k] && typeof o[k] === 'object' ? o[k] : (o[k] = {});
    const last = keys[keys.length - 1];
    if (v && v[SENTINEL] === 'delete') delete o[last];
    else o[last] = resolve(v, o[last]);
  }
}

function rawDelete(ref) {
  if (store[ref.col]) delete store[ref.col][ref.id];
}

function docSnap(ref) {
  const data = store[ref.col]?.[ref.id];
  return { id: ref.id, ref, exists: () => data !== undefined, data: () => (data === undefined ? undefined : clone(data)) };
}

function querySnap(q) {
  let entries = Object.entries(store[q.path] || {});
  for (const c of q.constraints || []) {
    if (c.type === 'where') {
      entries = entries.filter(([, d]) => {
        const v = getPath(d, c.field);
        if (c.op === '==') return v === c.value;
        // Like Firestore, != never matches documents that lack the field.
        if (c.op === '!=') return v !== undefined && v !== c.value;
        if (c.op === 'in') return c.value.includes(v);
        if (c.op === 'array-contains') return Array.isArray(v) && v.includes(c.value);
        throw new Error(`demo firestore: unsupported op ${c.op}`);
      });
    }
  }
  for (const c of (q.constraints || []).filter((c) => c.type === 'orderBy').reverse()) {
    entries.sort(([, a], [, b]) => {
      const x = cmpVal(getPath(a, c.field));
      const y = cmpVal(getPath(b, c.field));
      const r = x < y ? -1 : x > y ? 1 : 0;
      return c.dir === 'desc' ? -r : r;
    });
  }
  const lim = (q.constraints || []).find((c) => c.type === 'limit');
  if (lim) entries = entries.slice(0, lim.n);
  const docs = entries.map(([id]) => docSnap({ kind: 'doc', col: q.path, id }));
  return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn) => docs.forEach(fn) };
}

const snapshotOf = (ref) => (ref.kind === 'doc' ? docSnap(ref) : querySnap(ref.kind === 'collection' ? { path: ref.path } : ref));
const later = (fn) => new Promise((res, rej) => setTimeout(() => { try { res(fn()); } catch (e) { rej(e); } }, 5));

export const getDoc = (ref) => later(() => docSnap(ref));
export const getDocs = (q) => later(() => snapshotOf(q));
export const setDoc = (ref, data, opts) => later(() => { rawSet(ref, data, opts); persistAndNotify(); });
export const updateDoc = (ref, data) => later(() => { rawUpdate(ref, data); persistAndNotify(); });
export const deleteDoc = (ref) => later(() => { rawDelete(ref); persistAndNotify(); });
export const addDoc = (col, data) => {
  const ref = doc(col);
  return setDoc(ref, data).then(() => ref);
};

export function writeBatch() {
  const ops = [];
  return {
    set(ref, data, opts) { ops.push(() => rawSet(ref, data, opts)); return this; },
    update(ref, data) { ops.push(() => rawUpdate(ref, data)); return this; },
    delete(ref) { ops.push(() => rawDelete(ref)); return this; },
    commit: () => later(() => { ops.forEach((op) => op()); persistAndNotify(); }),
  };
}

export function onSnapshot(ref, next, error) {
  let last;
  const fire = () => {
    try {
      const snap = snapshotOf(ref);
      const key = JSON.stringify(ref.kind === 'doc' ? snap.data() ?? null : snap.docs.map((d) => [d.id, d.data()]));
      if (key === last) return;
      last = key;
      next(snap);
    } catch (e) {
      error?.(e);
    }
  };
  listeners.add(fire);
  setTimeout(fire, 5);
  return () => listeners.delete(fire);
}

// Exposed for the demo toolbar ("reset demo data").
export function __resetDemo() {
  store = {};
  localStorage.removeItem(STORE_KEY);
  persistAndNotify();
}
