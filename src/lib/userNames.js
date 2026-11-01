import { useSyncExternalStore } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from './firebase.js';

// One shared, live uid → display name map (from users/{uid}), started the first time it is needed.
let names = new Map();
let started = false;
const subs = new Set();

function subscribe(fn) {
  subs.add(fn);
  if (!started) {
    started = true;
    onSnapshot(
      collection(db, 'users'),
      (snap) => {
        names = new Map(snap.docs.map((d) => [d.id, d.data().name || 'Anonymous']));
        subs.forEach((s) => s());
      },
      (e) => console.warn('Could not load user names', e),
    );
  }
  return () => subs.delete(fn);
}

export const useUserNames = () => useSyncExternalStore(subscribe, () => names);
