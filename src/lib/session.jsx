import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
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
/** The signed-in user as the site shows them: their chosen username and avatar, never their Google name. */
const asUser = (authUser, profile) => ({
  uid: authUser.uid,
  displayName: profile?.name || '',
  photoURL: profile?.avatar?.photo || '',
  avatar: profile?.avatar || null,
  // Only ever shown to the user themselves; never written to the database.
  email: authUser.email || '',
  googlePhoto: authUser.photoURL || '',
});

export function SessionProvider({ children }) {
  const [authUser, setAuthUser] = useState(undefined);
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
  }, [authUser?.uid]);

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setAuthUser(u || null);
        // Only a timestamp: the public profile is what the user chooses in the profile dialog.
        if (u) setDoc(doc(db, 'users', u.uid), { lastSeen: serverTimestamp() }, { merge: true }).catch((e) => console.warn('Could not update profile', e));
      }),
    [],
  );

  const profile = useLive(() => (authUser ? doc(db, 'users', authUser.uid) : null), [authUser?.uid]);
  const user = useMemo(() => (authUser ? asUser(authUser, profile.data) : authUser), [authUser, profile.data]);
  // New users choose a username and avatar before they can take part.
  const needsProfile = Boolean(authUser && !profile.loading && !profile.data?.setup);
  const [profileOpen, setProfileOpen] = useState(false);

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

  /** Run `fn` as the signed-in user with a profile; otherwise ask to sign in (and set up a profile) first. */
  const requireUser = useCallback(
    async (fn) => {
      if (user && viewAs !== 'visitor') return needsProfile ? undefined : fn(user);
      if (!(await signIn())) return undefined;
      const u = auth.currentUser;
      const snap = await getDoc(doc(db, 'users', u.uid));
      // A brand-new user first sees the profile dialog; they can repeat the action afterwards.
      return snap.exists() && snap.data().setup ? fn(asUser(u, snap.data())) : undefined;
    },
    [user, signIn, viewAs, needsProfile],
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
      needsProfile,
      profileOpen: profileOpen || needsProfile,
      editProfile: () => setProfileOpen(true),
      closeProfile: () => setProfileOpen(false),
    }),
    [shownUser, user, role, realRole, setViewAs, site.data, shorthands.data, signIn, requireUser, needsProfile, profileOpen],
  );

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export const useSession = () => useContext(SessionCtx);


