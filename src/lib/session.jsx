import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase.js';
import { useLive } from './hooks.js';
import { clearHistory } from './store.js';
import { DEFAULT_KINDS } from './rules.js';
import { alertDialog } from '../components/dialogs.jsx';

const SessionCtx = createContext(null);

export const DEFAULT_SITE = { defaultRulesetId: 'rulebook' };

/** Roles you can preview the site as, from most to least access. */
export const ROLES = { admin: 'Admin', user: 'Signed-in user', visitor: 'Visitor' };

const readViewAs = () => {
  try {
    return sessionStorage.getItem('brv-view-as') || null;
  } catch {
    return null;
  }
};

/**
 * App-wide state: the signed-in user, whether they are an admin, plus the small
 * config docs every page needs (site settings and [shorthand] definitions).
 */
export function SessionProvider({ children }) {
  const [user, setUser] = useState(undefined);
  // Preview the site with a lower role. Kept per tab, so a reload doesn't lock an admin out of their tools.
  const [viewAs, setViewAsState] = useState(readViewAs);
  const setViewAs = useCallback((role) => {
    setViewAsState(role);
    try {
      if (role) sessionStorage.setItem('brv-view-as', role);
      else sessionStorage.removeItem('brv-view-as');
    } catch {
      /* ignore */
    }
  }, []);

  // Undo history belongs to whoever made the changes.
  useEffect(() => {
    clearHistory();
  }, [user?.uid]);

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
    if (viewAs === 'visitor') {
      alertDialog({ title: 'Previewing as a visitor', message: 'Stop previewing (in the banner at the top) to sign in or make changes.' });
      return false;
    }
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
      return true;
    } catch (e) {
      if (e?.code !== 'auth/popup-closed-by-user' && e?.code !== 'auth/cancelled-popup-request') alertDialog({ title: 'Sign-in failed', message: e.message });
      return false;
    }
  }, [viewAs]);

  /** Run `fn` if signed in, otherwise ask to sign in first. */
  const requireUser = useCallback(
    async (fn) => {
      if (user && viewAs !== 'visitor') return fn(user);
      if (await signIn()) return fn(auth.currentUser);
      return undefined;
    },
    [user, signIn, viewAs],
  );

  const realAdmin = Boolean(user && adminDoc.data);
  const realRole = !user ? 'visitor' : realAdmin ? 'admin' : 'user';
  const order = Object.keys(ROLES);
  // Only roles below your own count; anything else means "no preview".
  const role = viewAs && order.indexOf(viewAs) > order.indexOf(realRole) ? viewAs : realRole;
  const shownUser = role === 'visitor' ? (user === undefined ? undefined : null) : user;

  const value = useMemo(
    () => ({
      user: shownUser,
      realUser: user,
      authLoading: user === undefined,
      isAdmin: role === 'admin',
      realRole,
      role,
      previewing: role !== realRole,
      setViewAs,
      site: { ...DEFAULT_SITE, ...(site.data || {}) },
      kinds: site.data?.kinds?.length ? site.data.kinds : DEFAULT_KINDS,
      shorthands: shorthands.data?.items || {},
      signIn,
      signOut: () => signOut(auth),
      requireUser,
    }),
    [shownUser, user, role, realRole, setViewAs, site.data, shorthands.data, signIn, requireUser],
  );

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export const useSession = () => useContext(SessionCtx);

/** Display-safe author info for documents we write. */
export const authorOf = (user) => ({ uid: user.uid, name: user.displayName || 'Anonymous', photo: user.photoURL || '' });
