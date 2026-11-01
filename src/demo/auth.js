// Stand-in for `firebase/auth` in demo mode. "Signing in" makes you a demo user;
// the first demo user is made an admin so every screen can be tried out.
import { doc, setDoc } from './firestore.js';

const KEY = 'brv-demo-user';
const subs = new Set();
let current = read();

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

function emit() {
  subs.forEach((cb) => cb(current));
}

export class GoogleAuthProvider {
  setCustomParameters() {}
}

export function getAuth() {
  return { get currentUser() { return current; } };
}

export function onAuthStateChanged(_auth, cb) {
  subs.add(cb);
  setTimeout(() => cb(current), 0);
  return () => subs.delete(cb);
}

export async function signInWithPopup() {
  const name = window.prompt('Demo sign-in: choose a display name.\nThe name "Admin" signs in as a site admin.', 'Admin');
  if (!name) throw Object.assign(new Error('cancelled'), { code: 'auth/popup-closed-by-user' });
  const uid = 'demo-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  current = { uid, displayName: name, photoURL: '', email: `${uid}@example.com` };
  localStorage.setItem(KEY, JSON.stringify(current));
  if (name.toLowerCase() === 'admin') await setDoc(doc({ kind: 'collection', path: 'admins' }, uid), { name, addedAt: Date.now() });
  emit();
  return { user: current };
}

export async function signOut() {
  current = null;
  localStorage.removeItem(KEY);
  emit();
}
