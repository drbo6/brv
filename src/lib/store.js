// Recorded Firestore writes, so user actions can be undone.
//
// App code imports setDoc / updateDoc / deleteDoc / addDoc / writeBatch from here instead of
// 'firebase/firestore'. While an action runs inside `record()`, every document it touches is read
// once before its first write. Undoing puts back exactly what was touched:
// - whole-document writes (set, delete, create) restore or remove the document;
// - partial writes (update, merge) restore only the changed fields. This keeps undo within what the
//   security rules allow, e.g. a user's own key in a `reactions` map.
// Undoing is itself recorded, which is what makes redo work.

import * as fs from 'firebase/firestore';
import { db } from './firebase.js';

const pathOf = (ref) => ref.path || `${ref.col}/${ref.id}`;
const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

// Bookkeeping docs that must never be rolled back (the component cache counter only moves forward).
const SKIP = new Set(['config/componentsMeta']);

let rec = null;

function touch(ref, fields) {
  const p = pathOf(ref);
  if (!rec || SKIP.has(p)) return null;
  let t = rec.touched.get(p);
  if (!t) {
    const prev = rec.known.has(p) ? Promise.resolve(rec.known.get(p)) : fs.getDoc(ref).then((s) => (s.exists() ? s.data() : null));
    t = { ref, path: p, whole: false, fields: new Set(), prev };
    rec.touched.set(p, t);
  }
  if (fields) fields.forEach((f) => t.fields.add(f));
  else t.whole = true;
  return t.prev;
}

/** Tell the recorder what a document holds right now (null = missing), saving a read on big jobs. */
export function knownState(ref, data) {
  if (rec && !rec.touched.has(pathOf(ref))) rec.known.set(pathOf(ref), data);
}

export async function setDoc(ref, data, opts) {
  await touch(ref, opts?.merge ? Object.keys(data) : null);
  return fs.setDoc(ref, data, opts);
}

export async function updateDoc(ref, data) {
  await touch(ref, Object.keys(data));
  return fs.updateDoc(ref, data);
}

export async function deleteDoc(ref) {
  await touch(ref, null);
  return fs.deleteDoc(ref);
}

export async function addDoc(col, data) {
  const ref = fs.doc(col);
  await setDoc(ref, data);
  return ref;
}

export function writeBatch() {
  const batch = fs.writeBatch(db);
  const pending = [];
  return {
    set(ref, data, opts) {
      pending.push(touch(ref, opts?.merge ? Object.keys(data) : null));
      batch.set(ref, data, opts);
      return this;
    },
    update(ref, data) {
      pending.push(touch(ref, Object.keys(data)));
      batch.update(ref, data);
      return this;
    },
    delete(ref) {
      pending.push(touch(ref, null));
      batch.delete(ref);
      return this;
    },
    async commit() {
      await Promise.all(pending);
      return batch.commit();
    },
  };
}

/** Firestore batches max out at 500 writes. */
export async function commitInChunks(ops, size = 400) {
  for (let i = 0; i < ops.length; i += size) {
    const batch = writeBatch();
    ops.slice(i, i + size).forEach((op) => op(batch));
    await batch.commit();
  }
}

// ---------------------------------------------------------------- history

const MAX = 50;
let undoStack = [];
let redoStack = [];
let busy = false;
let snapshot = { undo: null, redo: null, busy: false };
const listeners = new Set();
const revertListeners = new Set();

function emit() {
  snapshot = { undo: undoStack[undoStack.length - 1] || null, redo: redoStack[redoStack.length - 1] || null, busy };
  listeners.forEach((l) => l());
}

export const subscribeHistory = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const getHistory = () => snapshot;

/** Called with the touched paths after an undo or redo, e.g. to refresh non-live data. */
export const onRevert = (fn) => {
  revertListeners.add(fn);
  return () => revertListeners.delete(fn);
};

export function clearHistory() {
  undoStack = [];
  redoStack = [];
  emit();
}

async function capture(fn) {
  const r = { touched: new Map(), known: new Map() };
  rec = r;
  let result;
  try {
    result = await fn();
  } finally {
    if (rec === r) rec = null;
  }
  const docs = await Promise.all(
    [...r.touched.values()].map(async (t) => ({ ref: t.ref, path: t.path, whole: t.whole, fields: [...t.fields], prev: await t.prev })),
  );
  return { result, docs };
}

/**
 * Run `fn` and remember how to undo the writes it makes. Nested calls join the outer recording.
 * Resolves to `{ result, entry }`; `entry` is null when nothing was written.
 */
export async function record(label, fn) {
  if (rec) return { result: await fn(), entry: null };
  const { result, docs } = await capture(fn);
  if (!docs.length) return { result, entry: null };
  const entry = { label: label || 'last change', docs, at: Date.now() };
  undoStack = [...undoStack, entry].slice(-MAX);
  redoStack = [];
  emit();
  return { result, entry };
}

function revertOps(entry) {
  return entry.docs.map(({ ref, whole, fields, prev }) => (b) => {
    if (prev == null) b.delete(ref);
    else if (whole) b.set(ref, prev);
    else b.update(ref, Object.fromEntries(fields.map((f) => [f, getPath(prev, f) === undefined ? fs.deleteField() : getPath(prev, f)])));
  });
}

async function revert(entry) {
  const { docs } = await capture(() => commitInChunks(revertOps(entry)));
  revertListeners.forEach((l) => l(entry.docs.map((d) => d.path)));
  return { label: entry.label, docs, at: Date.now() };
}

async function step(from, to, entry) {
  if (busy) return false;
  const i = entry ? from().lastIndexOf(entry) : from().length - 1;
  if (i < 0) return false;
  const target = from()[i];
  busy = true;
  emit();
  try {
    const inverse = await revert(target);
    from(from().filter((e) => e !== target));
    to([...to(), inverse].slice(-MAX));
    return target.label;
  } finally {
    busy = false;
    emit();
  }
}

const undoAccess = (v) => (v ? (undoStack = v) : undoStack);
const redoAccess = (v) => (v ? (redoStack = v) : redoStack);

/** Undo the latest action, or a specific one (e.g. from its toast). Resolves to its label. */
export const undo = (entry) => step(undoAccess, redoAccess, entry);
export const redo = (entry) => step(redoAccess, undoAccess, entry);
