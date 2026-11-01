import { collection, deleteField, doc, getDocs, increment, query, serverTimestamp, where } from 'firebase/firestore';
import { db } from './firebase.js';
import { commitInChunks, deleteDoc, setDoc, updateDoc, writeBatch } from './store.js';

export { commitInChunks };

export const LABELS = ['Rulebook', 'Official Ruling', 'Community', 'Suggestion'];
export const LABEL_CLASS = { Rulebook: 'rulebook', 'Official Ruling': 'official', Community: 'community', Suggestion: 'suggestion' };

/** Rule kinds until an admin edits the list (Admin → Rules → Rule kinds; stored in config/site). */
export const DEFAULT_KINDS = [
  { id: 'rule', label: 'Rule', color: '#9c9087' },
  { id: 'note', label: 'Note', color: '#6d9ccf' },
  { id: 'change', label: 'Changed from Blood Rage', color: '#d79a3b' },
  { id: 'tip', label: 'Tip', color: '#6fae5a' },
  { id: 'example', label: 'Example', color: '#6fae5a' },
  { id: 'flavor', label: 'Flavor', color: '#8a7d72' },
  { id: 'summary', label: 'Quick reference', color: '#d1a54b' },
];

/** The plain "rule" kind gets no badge; every other kind is shown on the rule. */
export const kindInfo = (kinds, id) => kinds.find((k) => k.id === (id || 'rule')) || { id, label: id, color: '' };

/** The built-in ruleset: every active rule, using its Rulebook version. Never stored. */
export const RULEBOOK_SET = { id: 'rulebook', name: 'Rulebook (as printed)', description: 'Every rule exactly as printed in the official rulebook.', builtIn: true };

export const millis = (ts) => (ts?.toMillis ? ts.toMillis() : typeof ts === 'number' ? ts : 0);

/** Orders sections depth-first and gives each a display number like "4.3.2". */
export function sectionTree(sections = []) {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const children = new Map();
  for (const s of sections) {
    const parent = s.parent && byId.has(s.parent) ? s.parent : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(s);
  }
  for (const list of children.values()) list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title));
  const ordered = [];
  const walk = (parent, prefix, depth) => {
    (children.get(parent) || []).forEach((s, i) => {
      const number = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      ordered.push({ ...s, number, depth });
      walk(s.id, number, depth + 1);
    });
  };
  walk(null, '', 0);
  return { ordered, byId: new Map(ordered.map((s) => [s.id, s])), children };
}

const labelRank = (l) => {
  const i = LABELS.indexOf(l);
  return i < 0 ? LABELS.length : i;
};

export function groupVersions(versions = []) {
  const map = new Map();
  for (const v of versions) {
    if (!map.has(v.ruleId)) map.set(v.ruleId, []);
    map.get(v.ruleId).push(v);
  }
  for (const list of map.values()) list.sort((a, b) => labelRank(a.label) - labelRank(b.label) || millis(a.createdAt) - millis(b.createdAt));
  return map;
}

export const sortRules = (rules) => [...rules].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));

export function rulebookEntries(rules, versionsByRule) {
  const entries = {};
  for (const r of rules) {
    if (r.status && r.status !== 'active') continue;
    const v = (versionsByRule.get(r.id) || []).find((x) => x.label === 'Rulebook');
    if (v) entries[r.id] = v.id;
  }
  return entries;
}

/** Next free "<SECTION>.<n>" code. */
export function nextCode(sectionCode, rules) {
  const prefix = `${sectionCode}.`;
  const max = rules.reduce((m, r) => {
    if (!String(r.code).startsWith(prefix)) return m;
    const n = parseInt(String(r.code).slice(prefix.length), 10);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `${prefix}${max + 1}`;
}

export const reactionCounts = (reactions = {}) => {
  const c = { up: 0, down: 0, q: 0 };
  for (const v of Object.values(reactions)) if (v in c) c[v] += 1;
  return c;
};

// ---------- writes ----------

const author = (user) => ({ createdBy: user.uid, createdByName: user.displayName || 'Anonymous' });

/** Toggle the signed-in user's reaction on a version or comment. Only touches their own key. */
export function react(col, id, uid, current, type) {
  return updateDoc(doc(db, col, id), { [`reactions.${uid}`]: current === type ? deleteField() : type });
}

export function createVersion({ ruleId, label, text, note }, user) {
  const ref = doc(collection(db, 'versions'));
  return setDoc(ref, { ruleId, label, text, note: note || '', reactions: {}, createdAt: serverTimestamp(), ...author(user) }).then(() => ref.id);
}

export const updateVersion = (id, patch) => updateDoc(doc(db, 'versions', id), { ...patch, updatedAt: serverTimestamp() });
export const deleteVersion = (id) => deleteDoc(doc(db, 'versions', id));

export async function createRule(rule, version, user) {
  const ruleRef = doc(collection(db, 'rules'));
  const versionRef = doc(collection(db, 'versions'));
  const batch = writeBatch();
  batch.set(ruleRef, { commentCount: 0, page: null, ...rule, createdAt: serverTimestamp(), ...author(user) });
  batch.set(versionRef, { ruleId: ruleRef.id, label: version.label, text: version.text, note: version.note || '', reactions: {}, createdAt: serverTimestamp(), ...author(user) });
  await batch.commit();
  return ruleRef.id;
}

export const updateRule = (id, patch) => updateDoc(doc(db, 'rules', id), patch);

/** Deletes a rule along with its versions and discussion. */
export async function deleteRule(id) {
  const [versions, comments] = await Promise.all([
    getDocs(query(collection(db, 'versions'), where('ruleId', '==', id))),
    getDocs(query(collection(db, 'comments'), where('ruleId', '==', id))),
  ]);
  const refs = [...versions.docs, ...comments.docs].map((d) => d.ref);
  await commitInChunks([...refs.map((r) => (b) => b.delete(r)), (b) => b.delete(doc(db, 'rules', id))]);
}

/** Swap a rule with its neighbour inside the same section. */
export async function moveRule(siblings, index, delta) {
  const a = siblings[index];
  const b = siblings[index + delta];
  if (!a || !b) return;
  // Renumber the whole section so equal/missing orders can't get stuck.
  const reordered = [...siblings];
  reordered[index] = b;
  reordered[index + delta] = a;
  await commitInChunks(reordered.map((r, i) => (batch) => batch.update(doc(db, 'rules', r.id), { order: i + 1 })));
}

/** A comment on a rule (`ruleId`) or a component (`componentId`). Rules keep a comment counter. */
export async function addComment({ ruleId = null, componentId = null, versionId, text }, user) {
  const batch = writeBatch();
  batch.set(doc(collection(db, 'comments')), {
    ruleId,
    ...(componentId ? { componentId } : {}),
    versionId: versionId || null,
    text,
    uid: user.uid,
    // The name is a fallback: pages show the author's current username.
    name: user.displayName || 'Anonymous',
    reactions: {},
    createdAt: serverTimestamp(),
  });
  if (ruleId) batch.update(doc(db, 'rules', ruleId), { commentCount: increment(1) });
  await batch.commit();
}

export async function deleteComment(comment) {
  const batch = writeBatch();
  batch.delete(doc(db, 'comments', comment.id));
  if (comment.ruleId) batch.update(doc(db, 'rules', comment.ruleId), { commentCount: increment(-1) });
  await batch.commit();
}

export const editComment = (id, text) => updateDoc(doc(db, 'comments', id), { text, editedAt: serverTimestamp() });

// ---------- rulesets ----------

export async function createRuleset({ name, description, entries }, user) {
  const ref = doc(collection(db, 'rulesets'));
  await setDoc(ref, {
    name,
    description: description || '',
    entries,
    visibility: 'private',
    ownerUid: user.uid,
    ownerName: user.displayName || 'Anonymous',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export const updateRuleset = (id, patch) => updateDoc(doc(db, 'rulesets', id), { ...patch, updatedAt: serverTimestamp() });
export const deleteRuleset = (id) => deleteDoc(doc(db, 'rulesets', id));
