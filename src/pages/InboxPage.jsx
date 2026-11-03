import { useState } from 'react';
import { useLive } from '../lib/hooks.js';
import { deleteNotices, followingQuery, inboxQuery, markAllRead, markRead, setFollowing } from '../lib/inbox.js';
import { href, navigate } from '../lib/router.js';
import { useSession } from '../lib/session.jsx';
import { attempt, Empty, Icon, Spinner, timeAgo, UserAvatar } from '../components/ui.jsx';

const TYPE_ICONS = { comment: 'message', version: 'layers', suggestion: 'bulb', adopted: 'check', approved: 'check', ruleset: 'book' };
const KEY_ICONS = { rule: 'book', component: 'grid', ruleset: 'layers', suggestions: 'bulb' };
const keyType = (key) => key.split('_')[0];
const linkHref = (link) => (link ? href(link.page, link.parts || [], link.params || {}) : '#');

/** Notices about what you follow, and the list of what you follow. */
export default function InboxPage({ route }) {
  const { user, signIn, authLoading } = useSession();
  const tab = route.parts[0] === 'following' ? 'following' : 'notices';
  if (authLoading) return <Spinner />;
  if (!user)
    return (
      <div className="page narrow">
        <Empty title="Your inbox">
          <p>Sign in to follow rules, cards and rulesets, and get notices about new comments, versions and changes.</p>
          <button className="primary" onClick={signIn}>
            Sign in with Google
          </button>
        </Empty>
      </div>
    );
  return (
    <div className="page narrow inbox-page">
      <div className="page-head">
        <h1>Inbox</h1>
      </div>
      <nav className="tabs" aria-label="Inbox sections">
        <a href={href('inbox')} className={tab === 'notices' ? 'on' : ''} title="What happened in the things you follow">
          Notices
        </a>
        <a href={href('inbox', ['following'])} className={tab === 'following' ? 'on' : ''} title="Rules, cards and rulesets you follow">
          Following
        </a>
      </nav>
      {tab === 'notices' ? <Notices uid={user.uid} /> : <Following uid={user.uid} />}
    </div>
  );
}

function Notices({ uid }) {
  const items = useLive(() => inboxQuery(uid), [uid]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  if (items.loading) return <Spinner />;
  const all = items.data || [];
  const list = unreadOnly ? all.filter((i) => !i.read) : all;
  const unread = all.filter((i) => !i.read).length;

  const open = (it) => {
    if (!it.read) markRead(uid, it.id).catch((e) => console.warn(e));
    if (it.link) navigate(it.link.page, it.link.parts || [], it.link.params || {});
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          {unread ? `${unread} unread` : 'All caught up'}
          <span className="muted small"> · {all.length} notice{all.length === 1 ? '' : 's'}</span>
        </h2>
        <div className="row gap wrap">
          <label className="switch">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
            <span className="switch-track" aria-hidden="true" />
            <span>Unread only</span>
          </label>
          <button className="small" disabled={!unread} onClick={() => attempt(() => markAllRead(uid, all))} title="Mark every notice as read">
            <Icon name="check" />
            Mark all read
          </button>
          <button className="small" disabled={!all.some((i) => i.read)} onClick={() => attempt(() => deleteNotices(uid, all.filter((i) => i.read)))} title="Delete the notices you have read">
            <Icon name="trash" />
            Clear read
          </button>
        </div>
      </div>
      {list.length === 0 ? (
        <p className="muted">
          {all.length ? 'No unread notices.' : 'Nothing yet. Follow a rule, card or ruleset (or join a discussion) and new activity shows up here.'}
        </p>
      ) : (
        <ul className="notices">
          {list.map((it) => (
            <li key={it.id} className={`notice ${it.read ? '' : 'unread'}`}>
              <UserAvatar uid={it.actorUid} name={it.actorName} size={32} />
              <a
                className="notice-main"
                href={linkHref(it.link)}
                onClick={(e) => {
                  e.preventDefault();
                  open(it);
                }}
              >
                <span className="notice-title">
                  <Icon name={TYPE_ICONS[it.type] || 'bell'} size={14} />
                  {it.title}
                </span>
                {it.text && <span className="notice-text">{it.text}</span>}
                <span className="notice-time muted small">{timeAgo(it.createdAt)}</span>
              </a>
              <div className="notice-tools">
                <button className="icon-btn" onClick={() => markRead(uid, it.id, !it.read)} title={it.read ? 'Mark as unread' : 'Mark as read'} aria-label={it.read ? 'Mark as unread' : 'Mark as read'}>
                  <Icon name={it.read ? 'eyeOff' : 'check'} />
                </button>
                <button className="icon-btn" onClick={() => deleteNotices(uid, [it])} title="Delete this notice" aria-label="Delete notice">
                  <Icon name="x" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Following({ uid }) {
  const subs = useLive(() => followingQuery(uid), [uid]);
  if (subs.loading) return <Spinner />;
  const list = [...(subs.data || [])].sort((a, b) => keyType(a.id).localeCompare(keyType(b.id)) || String(a.label).localeCompare(String(b.label)));
  return (
    <section className="panel">
      <h2>Following {list.length ? `(${list.length})` : ''}</h2>
      <p className="small muted">
        You get a notice when someone comments, adds or changes a version, or updates a ruleset you follow. Commenting on something, or sharing a homebrew of it, follows it automatically.
      </p>
      {list.length === 0 ? (
        <p className="muted">You don't follow anything yet. Use the Follow button on a rule, card or ruleset.</p>
      ) : (
        <ul className="following">
          {list.map((s) => (
            <li key={s.id}>
              <Icon name={KEY_ICONS[keyType(s.id)] || 'bell'} />
              <a href={linkHref(s.link)}>{s.label || s.id}</a>
              <span className="muted small">{{ rule: 'Rule', component: 'Card', ruleset: 'Ruleset', suggestions: 'Feed' }[keyType(s.id)] || ''}</span>
              <span className="muted small">{Object.keys(s.uids || {}).length} following</span>
              <button className="small" onClick={() => attempt(() => setFollowing(s.id, uid, false), `Stopped following ${s.label || 'it'}`)} title="Stop getting notices about this">
                Unfollow
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
