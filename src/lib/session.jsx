import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase.js';
import { useLive } from './hooks.js';
import { clearHistory } from './store.js';
import { DEFAULT_KINDS } from './rules.js';
import { brandOf } from './brand.js';
import { alertDialog } from '../components/dialogs.jsx';

const SessionCtx = createContext(null);

export const DEFAULT_SITE = { defaultRulesetId: 'rulebook' };

/** Roles you can preview the site as, from most to least access. */
/** Roles from most to least access. Editors manage content; admins also manage people; the owner can't be demoted. */
export const ROLES = { owner: 'Owner', admin: 'Admin', editor: 'Editor', user: 'Signed-in user', visitor: 'Visitor' };

/** Restrictions admins can put on a user. */
export const BLOCKS = { none: 'No restriction', suggest: 'No sharing', silence: 'Silenced (read only)' };

// Messages shown when a restricted user tries something they can't do.
const BLOCKED = {
  suggest: 'Your account can’t share homebrew for review at the moment.',
  talk: 'Your account can’t comment or react at the moment.',
};

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
      }),
    [],
  );

  const profile = useLive(() => (authUser ? doc(db, 'users', authUser.uid) : null), [authUser?.uid]);
  const user = useMemo(() => (authUser ? asUser(authUser, profile.data) : authUser), [authUser, profile.data]);
  // New users choose a username and avatar before they can take part.
  const needsProfile = Boolean(authUser && !profile.loading && !profile.data?.setup);

  // Record the visit only once the stored profile has arrived. Writing earlier makes Firestore show
  // a local copy holding nothing but the timestamp, which looks like "no profile yet" for a moment.
  const seenFor = useRef(null);
  useEffect(() => {
    if (!authUser || profile.loading || seenFor.current === authUser.uid) return;
    seenFor.current = authUser.uid;
    // Only a timestamp: the public profile is what the user chooses in the profile dialog.
    setDoc(doc(db, 'users', authUser.uid), { lastSeen: serverTimestamp() }, { merge: true }).catch((e) => console.warn('Could not update profile', e));
  }, [authUser, profile.loading]);
  const [profileOpen, setProfileOpen] = useState(false);

  // Role sources: config/owner (the owner), roles/{uid} (role and restriction), admins/{uid} (original setup).
  const adminDoc = useLive(() => (user ? doc(db, 'admins', user.uid) : null), [user?.uid]);
  const roleDoc = useLive(() => (user ? doc(db, 'roles', user.uid) : null), [user?.uid]);
  const ownerDoc = useLive(() => doc(db, 'config', 'owner'), []);
  const site = useLive(() => doc(db, 'config', 'site'), []);
  // The site's name, welcome, colors and fonts (Admin → Site, owner only).
  const brand = useLive(() => doc(db, 'config', 'brand'), []);
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

  const block = roleDoc.data?.block || 'none';
  const blockReason = roleDoc.data?.reason || '';

  /**
   * Run `fn` as the signed-in user with a profile; otherwise ask to sign in (and set up a profile)
   * first. `need` ('suggest' or 'talk') also checks that no restriction forbids the action.
   */
  const requireUser = useCallback(
    async (fn, need) => {
      if (need && (block === 'silence' || (need === 'suggest' && block === 'suggest'))) {
        alertDialog({ title: 'Not available', message: `${BLOCKED[need]}${blockReason ? ` Reason given: ${blockReason}` : ''} Contact an admin if you think this is a mistake.` });
        return undefined;
      }
      if (user && viewAs !== 'visitor') return needsProfile ? undefined : fn(user);
      if (!(await signIn())) return undefined;
      const u = auth.currentUser;
      const snap = await getDoc(doc(db, 'users', u.uid));
      // A brand-new user first sees the profile dialog; they can repeat the action afterwards.
      return snap.exists() && snap.data().setup ? fn(asUser(u, snap.data())) : undefined;
    },
    [user, signIn, viewAs, needsProfile, block, blockReason],
  );

  const isOwnerUser = Boolean(user && ownerDoc.data?.uid === user.uid);
  const realRole = !user
    ? 'visitor'
    : isOwnerUser
      ? 'owner'
      : adminDoc.data || roleDoc.data?.role === 'admin'
        ? 'admin'
        : roleDoc.data?.role === 'editor'
          ? 'editor'
          : 'user';
  const rank = (r) => Object.keys(ROLES).indexOf(r);
  // Only roles below your own count; anything else means "no preview".
  const role = viewAs && rank(viewAs) > rank(realRole) ? viewAs : realRole;
  const shownUser = role === 'visitor' ? (user === undefined ? undefined : null) : user;

  const value = useMemo(
    () => ({
      user: shownUser,
      realUser: user,
      authLoading: user === undefined,
      // isEditor: may change content. isAdmin: may also manage people.
      isEditor: rank(role) <= rank('editor'),
      isAdmin: rank(role) <= rank('admin'),
      isOwner: role === 'owner',
      // The bulk tables (Admin → Rules → Table, components tables): the owner, or staff granted it.
      canUseTables: role === 'owner' || (rank(role) <= rank('editor') && Boolean(roleDoc.data?.tables)),
      ownerUid: ownerDoc.data?.uid || null,
      ownerLoaded: !ownerDoc.loading,
      block: role === 'visitor' ? 'none' : block,
      blockReason,
      realRole,
      role,
      previewing: role !== realRole,
      setViewAs,
      site: { ...DEFAULT_SITE, ...(site.data || {}) },
      brand: brandOf(brand.data),
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
    [shownUser, user, role, realRole, setViewAs, site.data, brand.data, shorthands.data, signIn, requireUser, needsProfile, profileOpen, ownerDoc.data, ownerDoc.loading, block, blockReason, roleDoc.data],
  );

  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export const useSession = () => useContext(SessionCtx);


