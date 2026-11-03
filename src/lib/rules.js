import { collection, deleteField, doc, getDocs, increment, query, serverTimestamp, where } from 'firebase/firestore';
import { db } from './firebase.js';
import { commitInChunks, deleteDoc, setDoc, updateDoc, writeBatch } from './store.js';

export { commitInChunks };

export const LABELS = ['Rulebook', 'Official Ruling', 'Community', 'Suggestion'];
export const LABEL_CLASS = { Rulebook: 'rulebook', 'Official Ruling': 'official', Community: 'community', Suggestion: 'suggestion', Homebrew: 'homebrew' };

// A reader's private homebrew is referred to as "hb:<homebrew id>" in their rulesets. Once shared,
// the public copy carries `homebrewId`, so the same reference finds it.
export const HB = 'hb:';

/** The version a ruleset refers to by id (or by homebrew reference). */
export const findVersion = (vs, vid) => (vid ? vs.find((v) => v.id === vid || (v.homebrewId && HB + v.homebrewId === vid)) : undefined);

/** A ruleset's entry for a rule; a shared homebrew rule may still be listed under its homebrew reference. */
export const entryFor = (entries, rule) => entries[rule.id] ?? (rule.homebrewId ? entries[HB + rule.homebrewId] : undefined);

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
// No ruleset is "the" rulebook: the printed rules are a ruleset like any other (the content ships one).
// Only on a site without any public ruleset does this placeholder stand in, showing every rule as
// printed. It is not offered as a ruleset: the picker says there is none yet.
export const RULEBOOK_SET = { id: 'rulebook', name: 'No public ruleset yet', description: 'No ruleset has been published yet: every rule is shown as printed.', builtIn: true };

/** What admins can call a ruleset, in the order the picker lists them, with each one's tag style. */
export const SET_LABELS = { Official: 't-official', Community: 't-community', Experimental: 't-warn' };

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
  for (const [ruleId, list] of map) {
    const nums = numberVersions(list);
    map.set(
      ruleId,
      list.map((v) => ({ ...v, num: nums.get(v.id) })).sort((a, b) => labelRank(a.label) - labelRank(b.label) || millis(a.createdAt) - millis(b.createdAt)),
    );
  }
  return map;
}

export const sortRules = (rules) => [...rules].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || millis(a.createdAt) - millis(b.createdAt) || String(a.id).localeCompare(String(b.id)));

// ---------- rule ids ----------
// Each rule is cited by a short id such as "k7q2m", derived from its (permanent) document id: nobody
// has to choose one, existing rules get one automatically, and it never changes. Versions are
// numbered in the order they were added: k7q2m.1, k7q2m.2…

const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'; // no 0/o, 1/l/i

function hashId(str, len) {
  // FNV-1a, extended by re-hashing for longer ids.
  let out = '';
  let seed = 0x811c9dc5;
  while (out.length < len) {
    let h = seed;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    for (let i = 0; i < 6 && out.length < len; i++) {
      out += ALPHABET[h % ALPHABET.length];
      h = Math.floor(h / ALPHABET.length);
    }
    seed = (h ^ 0x9e3779b9) >>> 0;
  }
  return out;
}

/** docId → short id for every rule. On the (rare) clash, the newer rule gets a longer id. */
export function shortIds(rules) {
  const out = new Map();
  const seen = new Set();
  for (const r of [...rules].sort((a, b) => millis(a.createdAt) - millis(b.createdAt) || String(a.id).localeCompare(String(b.id)))) {
    let sid = hashId(r.id, 5);
    for (let len = 7; seen.has(sid); len++) sid = hashId(`${r.id}#`, len);
    seen.add(sid);
    out.set(r.id, sid);
  }
  return out;
}

/** Version numbers by order of creation. New versions store theirs (`n`), so deleting one renumbers nothing. */
function numberVersions(list) {
  let next = 1;
  // Oldest first: versions from before numbers were stored get theirs from their age.
  const byAge = [...list].sort((a, b) => millis(a.createdAt) - millis(b.createdAt) || (a.n ?? 0) - (b.n ?? 0));
  const nums = new Map();
  for (const v of byAge) {
    // Private homebrew isn't numbered: it can't be cited.
    if (v.homebrew) continue;
    const num = v.n ?? next;
    nums.set(v.id, num);
    next = Math.max(next, num + 1);
  }
  return nums;
}

/** How a rule is named in messages and lists: its short id and title. */
export const ruleName = (rule) => (rule.sid ? `${rule.sid} “${rule.title}”` : `“${rule.title}”`);

/** A version's citable reference, e.g. "k7q2m.2". */
export const versionRef = (rule, version) => (rule.sid && version?.num ? `${rule.sid}.${version.num}` : '');

export function rulebookEntries(rules, versionsByRule) {
  const entries = {};
  for (const r of rules) {
    if (r.status && r.status !== 'active') continue;
    const v = (versionsByRule.get(r.id) || []).find((x) => x.label === 'Rulebook');
    if (v) entries[r.id] = v.id;
  }
  return entries;
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

/** The next version number of a rule, kept with the version so it never changes. */
export async function nextVersionNumber(ruleId) {
  const existing = await getDocs(query(collection(db, 'versions'), where('ruleId', '==', ruleId)));
  const nums = numberVersions(existing.docs.map((d) => ({ id: d.id, ...d.data() })));
  return Math.max(0, ...nums.values()) + 1;
}

export async function createVersion({ ruleId, label, text, note }, user) {
  const n = await nextVersionNumber(ruleId);
  const ref = doc(collection(db, 'versions'));
  await setDoc(ref, { ruleId, label, text, n, note: note || '', reactions: {}, createdAt: serverTimestamp(), ...author(user) });
  return ref.id;
}

export const updateVersion = (id, patch) => updateDoc(doc(db, 'versions', id), { ...patch, updatedAt: serverTimestamp() });
export const deleteVersion = (id) => deleteDoc(doc(db, 'versions', id));

export async function createRule(rule, version, user) {
  const ruleRef = doc(collection(db, 'rules'));
  const versionRef = doc(collection(db, 'versions'));
  const batch = writeBatch();
  batch.set(ruleRef, { commentCount: 0, page: null, ...rule, createdAt: serverTimestamp(), ...author(user) });
  batch.set(versionRef, { ruleId: ruleRef.id, label: version.label, text: version.text, n: 1, note: version.note || '', reactions: {}, createdAt: serverTimestamp(), ...author(user) });
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

export async function createRuleset({ name, description, entries, cards }, user) {
  const ref = doc(collection(db, 'rulesets'));
  await setDoc(ref, {
    name,
    description: description || '',
    entries,
    ...(cards ? { cards } : {}),
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
