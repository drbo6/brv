import { collection, deleteDoc, deleteField, doc, getDocs, increment, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from './firebase.js';

export const LABELS = ['Rulebook', 'Official Ruling', 'Community', 'Suggestion'];
export const LABEL_CLASS = { Rulebook: 'rulebook', 'Official Ruling': 'official', Community: 'community', Suggestion: 'suggestion' };

export const KINDS = {
  rule: 'Rule',
  note: 'Note',
  change: 'Changed from Blood Rage',
  tip: 'Tip',
  example: 'Example',
  flavor: 'Flavor',
  summary: 'Quick reference',
};

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
  const batch = writeBatch(db);
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

export async function addComment({ ruleId, versionId, text }, user) {
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'comments')), {
    ruleId,
    versionId: versionId || null,
    text,
    uid: user.uid,
    name: user.displayName || 'Anonymous',
    photo: user.photoURL || '',
    reactions: {},
    createdAt: serverTimestamp(),
  });
  batch.update(doc(db, 'rules', ruleId), { commentCount: increment(1) });
  await batch.commit();
}

export async function deleteComment(comment) {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'comments', comment.id));
  batch.update(doc(db, 'rules', comment.ruleId), { commentCount: increment(-1) });
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

// ---------- seed / backup ----------

/** Firestore batches max out at 500 writes. */
export async function commitInChunks(ops, size = 400) {
  for (let i = 0; i < ops.length; i += size) {
    const batch = writeBatch(db);
    ops.slice(i, i + size).forEach((op) => op(batch));
    await batch.commit();
  }
}

/** Load the transcribed rulebook. Sections use their code as document id. */
export async function importRulebookSeed(seed, user) {
  const ops = [];
  for (const s of seed.sections) {
    ops.push((b) => b.set(doc(db, 'sections', s.code), { code: s.code, title: s.title, parent: s.parent || null, order: s.order }));
  }
  for (const r of seed.rules) {
    const ruleRef = doc(collection(db, 'rules'));
    const versionRef = doc(collection(db, 'versions'));
    ops.push((b) =>
      b.set(ruleRef, {
        code: r.code,
        sectionId: r.section,
        order: r.order,
        title: r.title,
        kind: r.kind || 'rule',
        page: r.page ?? null,
        status: 'active',
        commentCount: 0,
        createdAt: serverTimestamp(),
        ...author(user),
      }),
    );
    ops.push((b) =>
      b.set(versionRef, { ruleId: ruleRef.id, label: 'Rulebook', text: r.text, note: `Rulebook p. ${r.page ?? '?'}`, reactions: {}, createdAt: serverTimestamp(), ...author(user) }),
    );
  }
  await commitInChunks(ops);
}

/** A JSON snapshot of all rules content, for backups. */
export async function exportRulesBackup() {
  const names = ['sections', 'rules', 'versions', 'rulesets', 'comments'];
  const out = { exportedAt: new Date().toISOString() };
  for (const n of names) {
    const snap = await getDocs(collection(db, n));
    out[n] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  return out;
}
