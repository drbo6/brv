import { collection, deleteField, doc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase.js';
import { LABELS, millis } from './rules.js';
import { deleteDoc, setDoc, updateDoc } from './store.js';

// Components get versions like rules do. The component document itself is the printed card
// ("Printed"); other versions live in `componentVersions` and store only the fields they change.
// Reactions on the printed card live in `componentMeta/{componentId}`, so the (cached, admin-only)
// component documents never change when someone reacts.

export const PRINTED = 'printed';
export const CARD_LABELS = LABELS.filter((l) => l !== 'Rulebook');

const rank = (l) => {
  const i = LABELS.indexOf(l);
  return i < 0 ? LABELS.length : i;
};

/** All versions of one component, printed first: [{ id, label, data, reactions, … }]. */
export function cardVersions(comp, extra = [], meta) {
  const printed = { id: PRINTED, label: 'Printed', data: {}, reactions: meta?.reactions || {}, printed: true };
  return [printed, ...[...extra].sort((a, b) => rank(a.label) - rank(b.label) || millis(a.createdAt) - millis(b.createdAt))];
}

/** The component's data as shown in a version. */
export const dataIn = (comp, version) => (version && !version.printed ? { ...comp.data, ...version.data } : comp.data);

/** Fields whose value differs from the printed card. */
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

/** Choose which version of a card a ruleset uses (null = the printed card). */
export const setCardVersionIn = (setId, compId, versionId) =>
  updateDoc(doc(db, 'rulesets', setId), { [`cards.${compId}`]: versionId && versionId !== PRINTED ? versionId : deleteField(), updatedAt: serverTimestamp() });
