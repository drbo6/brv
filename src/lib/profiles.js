import { useSyncExternalStore } from 'react';
import { collection, deleteField, doc, getDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase.js';
import { writeBatch } from './store.js';

// Public profiles: users/{uid} holds only what others may see — the chosen username and avatar.
// Emails are never written to the database. Usernames are unique: usernames/{lowercased name}
// records who holds each one, and the security rules check it.

let profiles = new Map();
let started = false;
const subs = new Set();

function subscribe(fn) {
  subs.add(fn);
  if (!started) {
    started = true;
    onSnapshot(
      collection(db, 'users'),
      (snap) => {
        profiles = new Map(snap.docs.map((d) => [d.id, d.data()]));
        subs.forEach((s) => s());
      },
      (e) => console.warn('Could not load profiles', e),
    );
  }
  return () => subs.delete(fn);
}

/** Live map of uid → { name, avatar, … } for everyone. */
export const useProfiles = () => useSyncExternalStore(subscribe, () => profiles);

/** uid → display name, for tooltips and lists. */
export const useUserNames = () => {
  const p = useProfiles();
  return { get: (uid) => p.get(uid)?.name };
};

export const NAME_RULES = { min: 3, max: 24 };
export const nameKey = (name) => name.trim().toLowerCase();

export function nameProblem(name) {
  const n = name.trim();
  if (n.length < NAME_RULES.min) return `At least ${NAME_RULES.min} characters.`;
  if (n.length > NAME_RULES.max) return `At most ${NAME_RULES.max} characters.`;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u.test(n)) return 'Use letters, numbers, spaces, dots, dashes or underscores, starting with a letter or number.';
  if (/@/.test(n)) return 'Usernames cannot contain an email address.';
  return '';
}

/** Whether `name` is free (or already yours). */
export async function nameAvailable(name, uid) {
  const snap = await getDoc(doc(db, 'usernames', nameKey(name)));
  return !snap.exists() || snap.data().uid === uid;
}

// The pool avatars are drawn from. The picker offers a random handful that nobody else uses yet.
// Split into whole emoji (grapheme clusters), so sequences like 🛡️ and 🐦‍⬛ stay intact.
const graphemes = (str) => [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(str)].map((x) => x.segment);
export const AVATAR_GLYPHS = [
  '🪓🛡️⚔️🗡️🏹🔱🪃⛏️🔨🪚🧭⚓🪝🗿🏺🪨🛶⛵🏰🏯⛺🗻⛰️🌋🏔️🌲🌳🌴🌵🍄🌾🌿🍀🍁🍂🌻🌹🌷🌸🌺🌼🪻🪷',
  '🐺🦊🐻🐻‍❄️🐗🦌🐴🦄🐂🐃🐏🐐🦬🐘🦏🦛🐪🦒🦘🦥🦦🦡🦨🦔🐇🐿️🦫🐀🦇🐓🦃🦚🦜🦢🦩🦉🦅🦆🐦‍⬛🕊️🐧🐊🐢🦎🐍🐲🐉🦕🦖🐋🐳🐬🦭🐟🐠🐡🦈🐙🦑🦀🦞🦐🦂🕷️🐝🪲🐞🦋🐌🪱',
  '🔥❄️⚡🌙☀️⭐🌟☄️🌈🌊💧🌪️🌫️🌀💎🔮🪄🧿📜🗝️🔑🪙💰👑💀☠️👻👹👺🤖👾🎃🧙🧝🧛🧟🧞🧜🧚🍺🍻🍷🍯🍖🍗🥩🍞🧀🍎🍐🍇🍓🫐🍒🥕🌶️🌰🥨',
  '🎲♟️🃏🀄🎯🎻🥁🪘🎺📯🔔🏆🥇🎖️🏅🪖⛑️🧱🪵⚙️🔧🧲🔭🔬⚗️🧪🕯️🪔🏮🎐🧩🪁🛸🚀⛩️🗽',
].flatMap(graphemes);

/** `n` random glyphs nobody else uses (topping up with used ones only if the pool runs out). */
export function glyphChoices(used, keep, n = 24) {
  const shuffle = (list) => {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const free = shuffle(AVATAR_GLYPHS.filter((g) => !used.has(g) && g !== keep));
  const taken = shuffle(AVATAR_GLYPHS.filter((g) => used.has(g) && g !== keep));
  return [...(keep ? [keep] : []), ...free, ...taken].slice(0, n);
}
export const AVATAR_COLORS = ['#9e2228', '#c0632b', '#b8902f', '#3e6b26', '#2e6b5e', '#2e5266', '#3d4e8a', '#5e3d8a', '#7a3a5e', '#4b4f5c'];

/** Save username and avatar, claiming the new name and releasing the old one in one step. */
export async function saveProfile(uid, { name, avatar }, previousName) {
  const n = name.trim();
  const claim = await getDoc(doc(db, 'usernames', nameKey(n)));
  if (claim.exists() && claim.data().uid !== uid) throw new Error('Someone already uses this name.');
  const batch = writeBatch();
  if (previousName && nameKey(previousName) !== nameKey(n)) {
    const old = await getDoc(doc(db, 'usernames', nameKey(previousName)));
    if (old.exists() && old.data().uid === uid) batch.delete(old.ref);
  }
  // Claims can't be overwritten, so only write one that doesn't exist yet.
  if (!claim.exists()) batch.set(doc(db, 'usernames', nameKey(n)), { uid });
  // `photo` held the Google picture in older versions; it is dropped unless the user picks it.
  batch.set(doc(db, 'users', uid), { name: n, avatar, setup: true, photo: deleteField(), updatedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
}
