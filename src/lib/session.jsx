import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase.js';
import { useLive } from './hooks.js';

const SessionCtx = createContext(null);

export const DEFAULT_SITE = { defaultRulesetId: 'rulebook' };

/**
 * App-wide state: the signed-in user, whether they are an admin, plus the small
 * config docs every page needs (site settings and [shorthand] definitions).
 */
export function SessionProvider({ children }) {
  const [user, setUser] = useState(undefined);

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u || null);
        if (u) {
          setDoc(doc(db, 'users', u.uid), { name: u.displayName || 'Anonymous', photo: u.photoURL || '', lastSeen: serverTimestamp() }, { merge: true }).catch((e) =>
            console.warn('Could not update profile', e),
          );
        }
      }),
    [],
  );

  const adminDoc = useLive(() => (user ? doc(db, 'admins', user.uid) : null), [user?.uid]);
  const site = useLive(() => doc(db, 'config', 'site'), []);
  const shorthands = useLive(() => doc(db, 'config', 'shorthands'), []);

  const signIn = useCallback(async () => {
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
      return true;
    } catch (e) {
      if (e?.code !== 'auth/popup-closed-by-user' && e?.code !== 'auth/cancelled-popup-request') alert(`Sign-in failed: ${e.message}`);
      return false;
    }
  }, []);

  /** Run `fn` if signed in, otherwise ask to sign in first. */
  const requireUser = useCallback(
    async (fn) => {
      if (user) return fn(user);
      if (await signIn()) return fn(auth.currentUser);
      return undefined;
    },
    [user, signIn],
  );

  const value = useMemo(
    () => ({
      user,
      authLoading: user === undefined,
      isAdmin: Boolean(user && adminDoc.data),
      site: { ...DEFAULT_SITE, ...(site.data || {}) },
      shorthands: shorthands.data?.items || {},
      signIn,
      signOut: () => signOut(auth),
      requireUser,
    }),
    [user, adminDoc.data, site.data, shorthands.data, signIn, requireUser],
  );

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export const useSession = () => useContext(SessionCtx);

/** Display-safe author info for documents we write. */
export const authorOf = (user) => ({ uid: user.uid, name: user.displayName || 'Anonymous', photo: user.photoURL || '' });
