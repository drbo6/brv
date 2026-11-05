import { collection, deleteField, doc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase.js';
import { HB, LABELS, millis } from './rules.js';
import { deleteDoc, setDoc, updateDoc } from './store.js';

// Components get versions like rules do. The component document itself is the card's original
// version (no label: which cards make up the printed game is up to a ruleset); other versions live
// in `componentVersions` and store only the fields they change. Reactions on the original live in
// `componentMeta/{componentId}`, so the (cached, admin-only) component documents never change when
// someone reacts.

// A ruleset's value for "the card as it is" (stored as 'printed', from before it was renamed).
export const PRINTED = 'printed';
export const ORIGINAL = 'Original';
export const CARD_LABELS = LABELS.filter((l) => l !== 'Rulebook');

const rank = (l) => {
  const i = LABELS.indexOf(l);
  return i < 0 ? LABELS.length : i;
};

/** All versions of one component, the original first: [{ id, label, data, reactions, … }]. */
export function cardVersions(comp, extra = [], meta) {
  const printed = { id: PRINTED, label: ORIGINAL, data: {}, reactions: meta?.reactions || {}, printed: true };
  return [printed, ...[...extra].sort((a, b) => rank(a.label) - rank(b.label) || millis(a.createdAt) - millis(b.createdAt))];
}

/** The component's data as shown in a version. */
export const dataIn = (comp, version) => (version && !version.printed ? { ...comp.data, ...version.data } : comp.data);

/** Fields whose value differs from the original card. */
export function changedFields(comp, data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) if (String(v ?? '') !== String(comp.data[k] ?? '')) out[k] = v;
  return out;
}

const author = (user) => ({ createdBy: user.uid, createdByName: user.displayName || 'Anonymous' });

export function createCardVersion({ comp, label, data, note }, user) {
  const ref = doc(collection(db, 'componentVersions'));
  return setDoc(ref, { componentId: comp.id, typeId: comp.typeId, label, data, note: note || '', reactions: {}, createdAt: serverTimestamp(), ...author(user) }).then(() => ref.id);
}

export const updateCardVersion = (id, patch) => updateDoc(doc(db, 'componentVersions', id), { ...patch, updatedAt: serverTimestamp() });
export const deleteCardVersion = (id) => deleteDoc(doc(db, 'componentVersions', id));

/** Toggle the user's reaction on a card version. Only ever touches their own key. */
export function reactToCard(compId, version, metaExists, uid, type) {
  const next = version.reactions?.[uid] === type ? deleteField() : type;
  if (!version.printed) return updateDoc(doc(db, 'componentVersions', version.id), { [`reactions.${uid}`]: next });
  const ref = doc(db, 'componentMeta', compId);
  return metaExists ? updateDoc(ref, { [`reactions.${uid}`]: next }) : setDoc(ref, { reactions: { [uid]: type } });
}

/**
 * The version of a card a ruleset uses: a version id (or "hb:<id>"), PRINTED (the card as it is),
 * or null when the ruleset leaves the card out. Rulesets list every card they include, like rules;
 * `cards` is their map with unsaved changes applied. Only the stand-in for a site without rulesets
 * (builtIn) includes the site's cards it doesn't mention.
 *
 * A member's new card is listed as "hb:<id>" while it is private homebrew, and still found that
 * way once it is a public suggested card (`homebrewId`). New cards (homebrew or suggested) are
 * only in a ruleset that lists them.
 */
export function cardChoiceFor(set, cards, comp) {
  if (cards && comp.id in cards) return cards[comp.id] || null;
  if (comp.homebrewId && cards && HB + comp.homebrewId in cards) return cards[HB + comp.homebrewId] || null;
  return set?.builtIn && !comp.status ? PRINTED : null;
}

/** The key a ruleset lists a card under: its id, or "hb:<id>" for the author's own new card. */
export const cardKeyIn = (cards, comp) => (comp.homebrewId && cards && !(comp.id in cards) && HB + comp.homebrewId in cards ? HB + comp.homebrewId : comp.id);
