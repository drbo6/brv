import { collection, deleteField, doc, getDoc, limit, orderBy, query, serverTimestamp, updateDoc, where, writeBatch as rawBatch } from 'firebase/firestore';
import { db } from './firebase.js';
import { setDoc } from './store.js';

// Following and the inbox, without a server:
// - subscribers/{key} lists who follows a rule, card, ruleset or the admin suggestion feed
//   (key: rule_<id>, component_<id>, ruleset_<id>, suggestions), with a label and link for lists.
// - inbox/{uid}/items/{id} holds a person's notices. Whoever causes an event writes one notice to
//   every follower's inbox (never their own). Notices are not part of the undo history: they are
//   already delivered.

export const subKey = (type, id) => (id ? `${type}_${id}` : type);

/** What can be followed, with how it is named and linked in the inbox. */
export const ruleTarget = (rule) => ({ key: subKey('rule', rule.id), label: `${rule.code} ${rule.title}`, link: { page: 'rules', parts: [rule.code] } });
export const cardTarget = (comp, name) => ({ key: subKey('component', comp.id), label: name, link: { page: 'components', parts: [comp.typeId, comp.id] } });
export const rulesetTarget = (set) => ({ key: subKey('ruleset', set.id), label: set.name, link: { page: 'rules', parts: [], params: { set: set.id } } });
export const SUGGESTIONS = { key: 'suggestions', label: 'All new suggestions', link: { page: 'admin', parts: ['rules'] } };

/** Follow or unfollow something; `label` and `link` ({ page, parts, params }) describe it in lists. */
export function setFollowing(key, uid, on, { label, link } = {}) {
  return setDoc(doc(db, 'subscribers', key), { uids: { [uid]: on ? true : deleteField() }, ...(label ? { label } : {}), ...(link ? { link } : {}) }, { merge: true });
}

/** Follow without waiting or failing loudly: used when someone comments or suggests. */
export function autoFollow(key, uid, info) {
  return getDoc(doc(db, 'subscribers', key))
    .then((s) => (s.exists() && s.data().uids?.[uid] ? null : setFollowing(key, uid, true, info)))
    .catch((e) => console.warn('Could not follow', key, e));
}

const snippet = (text) => {
  const plain = String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > 160 ? `${plain.slice(0, 157)}…` : plain;
};

/**
 * Deliver a notice to everyone following `key`, except the person who caused it.
 * event: { type, title, text, link } — link is { page, parts, params } for the router.
 */
export async function notify(key, actor, event) {
  try {
    const subs = await getDoc(doc(db, 'subscribers', key));
    const uids = Object.keys(subs.exists() ? subs.data().uids || {} : {}).filter((u) => u !== actor.uid);
    if (!uids.length) return;
    for (let i = 0; i < uids.length; i += 400) {
      const batch = rawBatch(db);
      for (const uid of uids.slice(i, i + 400)) {
        batch.set(doc(collection(db, 'inbox', uid, 'items')), {
          type: event.type,
          key,
          title: event.title.slice(0, 200),
          text: snippet(event.text),
          link: event.link || null,
          actorUid: actor.uid,
          actorName: actor.displayName || 'Someone',
          read: false,
          createdAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }
  } catch (e) {
    // A failed notice must never break the action that caused it.
    console.warn('Could not deliver notices for', key, e);
  }
}

export const inboxQuery = (uid, max = 200) => query(collection(db, 'inbox', uid, 'items'), orderBy('createdAt', 'desc'), limit(max));
export const unreadQuery = (uid) => query(collection(db, 'inbox', uid, 'items'), where('read', '==', false));
export const followingQuery = (uid) => query(collection(db, 'subscribers'), where(`uids.${uid}`, '==', true));

export const markRead = (uid, id, read = true) => updateDoc(doc(db, 'inbox', uid, 'items', id), { read });

export async function markAllRead(uid, items) {
  const unread = items.filter((i) => !i.read);
  for (let i = 0; i < unread.length; i += 400) {
    const batch = rawBatch(db);
    unread.slice(i, i + 400).forEach((it) => batch.update(doc(db, 'inbox', uid, 'items', it.id), { read: true }));
    await batch.commit();
  }
}

export async function deleteNotices(uid, items) {
  for (let i = 0; i < items.length; i += 400) {
    const batch = rawBatch(db);
    items.slice(i, i + 400).forEach((it) => batch.delete(doc(db, 'inbox', uid, 'items', it.id)));
    await batch.commit();
  }
}
