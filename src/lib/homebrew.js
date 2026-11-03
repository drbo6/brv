import { collection, deleteField, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore';
import { db } from './firebase.js';
import { HB, nextVersionNumber } from './rules.js';
import { deleteDoc, knownState, writeBatch } from './store.js';

// Homebrew: anyone signed in can change any rule or card, or write a new rule, for themselves.
// homebrew/{id} → { ownerUid, ownerName, kind, …, note, sharedId, sharedVersionId, declineReason }
//   kind 'version': { ruleId, text }        a different wording of an existing rule
//   kind 'rule':    { sectionId, title, text } a rule of their own, in an existing section
//   kind 'card':    { componentId, typeId, data } changed fields of a card
// Only the owner can read it, so it shows on their screen only and can be used in their rulesets
// (as "hb:<id>"). Sharing it copies it into the public versions (or rules) as a Suggestion with
// `homebrewId`, where everyone can discuss it and admins review it. Turning a shared homebrew down
// removes the public copy and hands it back, private again, with the admin's reason.

export const HOMEBREW = 'Homebrew';

export const myHomebrewQuery = (uid) => (uid ? query(collection(db, 'homebrew'), where('ownerUid', '==', uid)) : null);

/** Ids of homebrew that has a public copy, from the public lists already loaded. */
const publicIds = (...lists) => new Set(lists.flat().map((d) => d.homebrewId).filter(Boolean));

/**
 * The reader's homebrew rules and rule versions that aren't public, shaped like rules and versions
 * so the Rules page can show them in place. Shared homebrew shows as its public copy instead.
 */
export function withHomebrew(mine, rules, versions) {
  const shared = publicIds(rules, versions);
  const own = mine.filter((h) => !shared.has(h.id));
  const pseudoRules = own
    .filter((h) => h.kind === 'rule')
    .map((h) => ({ id: HB + h.id, sectionId: h.sectionId, title: h.title, kind: 'rule', status: 'homebrew', order: 1e9, commentCount: 0, createdAt: h.createdAt, homebrew: h }));
  const pseudoVersions = own
    .filter((h) => h.kind === 'version' || h.kind === 'rule')
    .map((h) => ({
      id: HB + h.id,
      ruleId: h.kind === 'rule' ? HB + h.id : h.ruleId,
      label: HOMEBREW,
      text: h.text,
      note: h.note || '',
      reactions: {},
      createdAt: h.createdAt,
      createdBy: h.ownerUid,
      createdByName: h.ownerName,
      homebrew: h,
    }));
  return { rules: pseudoRules.length ? [...rules, ...pseudoRules] : rules, versions: pseudoVersions.length ? [...versions, ...pseudoVersions] : versions };
}

/** The reader's private card homebrew, shaped like card versions. */
export function withCardHomebrew(mine, cardVersions) {
  const shared = publicIds(cardVersions);
  const own = mine.filter((h) => h.kind === 'card' && !shared.has(h.id));
  if (!own.length) return cardVersions;
  return [
    ...cardVersions,
    ...own.map((h) => ({
      id: HB + h.id,
      componentId: h.componentId,
      typeId: h.typeId,
      label: HOMEBREW,
      data: h.data || {},
      note: h.note || '',
      reactions: {},
      createdAt: h.createdAt,
      createdBy: h.ownerUid,
      createdByName: h.ownerName,
      homebrew: h,
    })),
  ];
}

/** Homebrew references ("hb:<id>") in a ruleset, rules and cards. */
export function homebrewRefs(set) {
  const out = new Set();
  for (const [k, v] of Object.entries(set?.entries || {})) {
    if (k.startsWith(HB)) out.add(k.slice(HB.length));
    if (typeof v === 'string' && v.startsWith(HB)) out.add(v.slice(HB.length));
  }
  for (const v of Object.values(set?.cards || {})) if (typeof v === 'string' && v.startsWith(HB)) out.add(v.slice(HB.length));
  return out;
}

/** How many homebrew references in a ruleset have no public copy (so only their author sees them). */
export async function privateHomebrewCount(set) {
  const refs = homebrewRefs(set);
  if (!refs.size) return 0;
  const snaps = await Promise.all(['rules', 'versions', 'componentVersions'].map((c) => getDocs(query(collection(db, c), where('homebrewId', '!=', null)))));
  const shared = publicIds(...snaps.map((s) => s.docs.map((d) => d.data())));
  return [...refs].filter((id) => !shared.has(id)).length;
}

// ---------- writes (the owner's) ----------

const owner = (user) => ({ ownerUid: user.uid, ownerName: user.displayName || 'Anonymous' });
const author = (user) => ({ createdBy: user.uid, createdByName: user.displayName || 'Anonymous' });

/** Where a homebrew goes in a ruleset: the rule (or card) it stands in for. */
const setField = (h, id) => (h.kind === 'card' ? `cards.${h.componentId}` : `entries.${h.kind === 'rule' ? HB + id : h.ruleId}`);

/** Create a homebrew and use it in the reader's ruleset `rulesetId`, in one step; returns its id. */
export async function createHomebrew(fields, user, rulesetId) {
  const ref = doc(collection(db, 'homebrew'));
  // It's new: no need to read it first (and reading a missing homebrew is not allowed).
  knownState(ref, null);
  const batch = writeBatch();
  batch.set(ref, { ...fields, note: fields.note || '', ...owner(user), sharedId: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  if (rulesetId) batch.update(doc(db, 'rulesets', rulesetId), { [setField(fields, ref.id)]: HB + ref.id, updatedAt: serverTimestamp() });
  await batch.commit();
  return ref.id;
}

/** The public copy's documents: [collection, id] pairs, the main one first. */
const publicDocs = (h) =>
  !h.sharedId ? [] : h.kind === 'rule' ? [['rules', h.sharedId], ['versions', h.sharedVersionId]] : [[h.kind === 'card' ? 'componentVersions' : 'versions', h.sharedId]];

/** The public copy of a shared homebrew, if it is still under review (label "Suggestion"). */
async function reviewCopy(h) {
  if (!h.sharedId) return null;
  const [col, id] = h.kind === 'rule' ? ['versions', h.sharedVersionId] : publicDocs(h)[0];
  if (!id) return null;
  const snap = await getDoc(doc(db, col, id));
  return snap.exists() && snap.data().label === 'Suggestion' ? snap.data() : null;
}

/** Change a homebrew. While it is shared for review, its public copy changes with it. */
export async function updateHomebrew(h, patch) {
  const batch = writeBatch();
  batch.update(doc(db, 'homebrew', h.id), { ...patch, updatedAt: serverTimestamp() });
  if (await reviewCopy(h)) {
    const now = { updatedAt: serverTimestamp() };
    if (h.kind === 'card') batch.update(doc(db, 'componentVersions', h.sharedId), { data: patch.data ?? h.data, note: patch.note ?? h.note ?? '', ...now });
    else batch.update(doc(db, 'versions', h.kind === 'rule' ? h.sharedVersionId : h.sharedId), { text: patch.text ?? h.text, note: patch.note ?? h.note ?? '', ...now });
    if (h.kind === 'rule' && (patch.title !== undefined || patch.sectionId !== undefined)) {
      batch.update(doc(db, 'rules', h.sharedId), { title: patch.title ?? h.title, sectionId: patch.sectionId ?? h.sectionId });
    }
  }
  await batch.commit();
}

/** Share a homebrew for review: it becomes a public Suggestion. Returns the public id. */
export async function shareHomebrew(h, user) {
  const batch = writeBatch();
  const base = { label: 'Suggestion', note: h.note || '', reactions: {}, homebrewId: h.id, createdAt: serverTimestamp(), ...author(user) };
  let sharedId;
  let sharedVersionId = null;
  if (h.kind === 'version') {
    const ref = doc(collection(db, 'versions'));
    batch.set(ref, { ...base, ruleId: h.ruleId, text: h.text, n: await nextVersionNumber(h.ruleId) });
    sharedId = ref.id;
  } else if (h.kind === 'rule') {
    // A new rule goes at the end of its section, as a suggested rule.
    const siblings = await getDocs(query(collection(db, 'rules'), where('sectionId', '==', h.sectionId)));
    const order = Math.max(0, ...siblings.docs.map((d) => d.data().order ?? 0)) + 1;
    const rule = doc(collection(db, 'rules'));
    const version = doc(collection(db, 'versions'));
    batch.set(rule, { sectionId: h.sectionId, order, title: h.title, kind: 'rule', status: 'suggested', page: null, commentCount: 0, homebrewId: h.id, createdAt: serverTimestamp(), ...author(user) });
    batch.set(version, { ...base, ruleId: rule.id, text: h.text, n: 1 });
    sharedId = rule.id;
    sharedVersionId = version.id;
  } else {
    const ref = doc(collection(db, 'componentVersions'));
    batch.set(ref, { ...base, componentId: h.componentId, typeId: h.typeId, data: h.data || {} });
    sharedId = ref.id;
  }
  batch.update(doc(db, 'homebrew', h.id), { sharedId, sharedVersionId, declineReason: deleteField(), declinedBy: deleteField(), declinedAt: deleteField(), updatedAt: serverTimestamp() });
  await batch.commit();
  return sharedId;
}

/** Take a shared homebrew back while it is under review: the public copy goes, the homebrew stays. */
export async function withdrawHomebrew(h) {
  const batch = writeBatch();
  for (const [col, id] of publicDocs(h)) if (id) batch.delete(doc(db, col, id));
  batch.update(doc(db, 'homebrew', h.id), { sharedId: null, sharedVersionId: null, updatedAt: serverTimestamp() });
  await batch.commit();
}

/** Delete a homebrew. One under review is withdrawn too; an accepted one stays public. */
export async function deleteHomebrew(h) {
  if (!(await reviewCopy(h))) return deleteDoc(doc(db, 'homebrew', h.id));
  const batch = writeBatch();
  for (const [col, id] of publicDocs(h)) if (id) batch.delete(doc(db, col, id));
  batch.delete(doc(db, 'homebrew', h.id));
  await batch.commit();
}

// ---------- review (editors) ----------

/**
 * Accept a shared suggestion as Community or Official Ruling: a suggested rule becomes active, and
 * the version can go straight into a public ruleset.
 */
export async function acceptSuggestion({ col, version, rule }, label, rulesetId) {
  const batch = writeBatch();
  batch.update(doc(db, col, version.id), { label, updatedAt: serverTimestamp() });
  if (rule?.status === 'suggested') batch.update(doc(db, 'rules', rule.id), { status: 'active' });
  if (rulesetId) {
    const path = col === 'componentVersions' ? `cards.${version.componentId}` : `entries.${version.ruleId}`;
    batch.update(doc(db, 'rulesets', rulesetId), { [path]: version.id, updatedAt: serverTimestamp() });
  }
  await batch.commit();
}

/**
 * Turn a shared suggestion down: its public copy is removed (with the whole rule, for a suggested
 * new rule) and the author's homebrew becomes private again, with the reason.
 */
export async function declineSuggestion({ col, version, rule }, reason, admin) {
  const batch = writeBatch();
  if (rule?.status === 'suggested' && rule.homebrewId && rule.homebrewId === version.homebrewId) {
    const vs = await getDocs(query(collection(db, 'versions'), where('ruleId', '==', rule.id)));
    vs.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(db, 'rules', rule.id));
  } else batch.delete(doc(db, col, version.id));
  if (version.homebrewId) {
    const hb = await getDoc(doc(db, 'homebrew', version.homebrewId)).catch(() => null);
    if (hb?.exists()) {
      batch.update(hb.ref, { sharedId: null, sharedVersionId: null, declineReason: reason || '', declinedBy: admin.uid, declinedAt: serverTimestamp() });
    }
  }
  await batch.commit();
}
