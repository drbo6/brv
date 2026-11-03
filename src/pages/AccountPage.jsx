import { collection, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { useLive } from '../lib/hooks.js';
import { href } from '../lib/router.js';
import { deleteRuleset, millis, updateRuleset } from '../lib/rules.js';
import { ROLES, useSession } from '../lib/session.jsx';
import { useTheme } from '../lib/theme.js';
import { attempt, Avatar, copyText, Icon, Spinner, timeAgo, toast } from '../components/ui.jsx';
import { confirmDialog, promptDialog } from '../components/dialogs.jsx';

export default function AccountPage() {
  const { user, authLoading, realRole, block, blockReason, signIn, signOut, editProfile } = useSession();
  const theme = useTheme();
  const mySets = useLive(() => (user ? query(collection(db, 'rulesets'), where('ownerUid', '==', user.uid)) : null), [user?.uid]);

  if (authLoading) return <Spinner />;

  if (!user)
    return (
      <div className="page narrow">
        <section className="login-card">
          <h1>Log in</h1>
          <p>Log in to react to rules, join discussions, suggest new rules and save your own rulesets. Browsing is open to everyone.</p>
          <button className="primary big google-btn" onClick={signIn}>
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" />
              <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
            </svg>
            Continue with Google
          </button>
          <p className="hint">After signing in you choose a username and avatar. Those are all others see: your email address and Google name are never shown or stored with your posts.</p>
        </section>
      </div>
    );

  const sets = [...(mySets.data || [])].sort((a, b) => millis(b.updatedAt) - millis(a.updatedAt));

  return (
    <div className="page narrow">
      <section className="profile">
        <Avatar name={user.displayName} avatar={user.avatar} size={64} />
        <div>
          <h1>{user.displayName || 'New member'}</h1>
          <p className="muted small">
            <span title="Only you can see this. It is never shown to others.">
              <Icon name="eyeOff" size={13} /> {user.email} · private
            </span>{' '}
            {realRole !== 'user' && (
              <span className="tag t-official" title={{ owner: 'Runs the site; can’t be demoted', admin: 'Manages content and people', editor: 'Manages content' }[realRole]}>
                {ROLES[realRole]}
              </span>
            )}
          </p>
        </div>
        <div className="row gap wrap">
          <button onClick={theme.toggle} title="Switch between light and dark mode">
            <Icon name={theme.theme === 'light' ? 'moon' : 'sun'} />
            {theme.theme === 'light' ? 'Dark mode' : 'Light mode'}
          </button>
          <button onClick={editProfile} title="Change your username and avatar">
            <Icon name="edit" />
            Edit profile
          </button>
          <button onClick={signOut}>
            <Icon name="logout" />
            Log out
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>My rulesets</h2>
        {mySets.loading ? (
          <Spinner />
        ) : sets.length === 0 ? (
          <p className="muted">
            You have no rulesets yet. On the <a href={href('rules')}>Rules</a> page, choose <b>Customize</b> to pick rules and versions, then save.
          </p>
        ) : (
          <ul className="set-list">
            {sets.map((s) => (
              <li key={s.id}>
                <div>
                  <a href={href('rules', [], { set: s.id })}>
                    <b>{s.name}</b>
                  </a>
                  {s.visibility === 'public' && <span className="tag t-community">Public</span>}
                  <p className="small muted">
                    {Object.keys(s.entries || {}).length} rules · updated {timeAgo(s.updatedAt)}
                  </p>
                </div>
                <div className="row gap">
                  <button
                    className="icon-btn"
                    title="Rename"
                    aria-label={`Rename ${s.name}`}
                    onClick={async () => {
                      const name = await promptDialog({ title: 'Rename ruleset', label: 'Name', initial: s.name, confirmLabel: 'Rename' });
                      if (name?.trim() && name.trim() !== s.name) attempt(() => updateRuleset(s.id, { name: name.trim() }), 'Ruleset renamed');
                    }}
                  >
                    <Icon name="edit" />
                  </button>
                  <button
                    className="icon-btn"
                    title="Copy link"
                    aria-label={`Copy link to ${s.name}`}
                    onClick={async () => {
                      await copyText(`${location.origin}${location.pathname}${href('rules', [], { set: s.id })}`);
                      toast('Link copied', 'ok');
                    }}
                  >
                    <Icon name="link" />
                  </button>
                  <button className="icon-btn danger" title="Delete" aria-label={`Delete ${s.name}`} onClick={async () => (await confirmDialog({ title: 'Delete ruleset', message: `Delete “${s.name}”? People with its link will no longer be able to open it.`, confirmLabel: 'Delete', danger: true })) && attempt(() => deleteRuleset(s.id), 'Ruleset deleted')}>
                    <Icon name="trash" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {block !== 'none' && (
        <section className="panel restricted-note" role="status">
          <h2>Your account is restricted</h2>
          <p>
            {block === 'silence' ? 'You can read everything, but can’t comment, react or suggest changes.' : 'You can comment and react, but can’t suggest rules, versions or card changes.'}
            {blockReason && <> Reason given: “{blockReason}”.</>} Contact an admin if you think this is a mistake.
          </p>
        </section>
      )}

      <details className="panel uid-panel">
        <summary>Technical: your user ID</summary>
        <p className="small muted">You don't need this to get a role: admins find you by your username. It is only used when setting up the site's owner in the Firebase console.</p>
        <div className="row gap">
          <code className="uid">{user.uid}</code>
          <button
            className="icon-btn"
            aria-label="Copy user ID"
            onClick={async () => {
              await copyText(user.uid);
              toast('User ID copied', 'ok');
            }}
          >
            <Icon name="copy" />
          </button>
        </div>
      </details>
    </div>
  );
}
