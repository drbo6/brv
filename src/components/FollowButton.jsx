import { doc } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { useLive } from '../lib/hooks.js';
import { setFollowing } from '../lib/inbox.js';
import { useSession } from '../lib/session.jsx';
import { attempt, Icon } from './ui.jsx';

/** Follow / Following toggle for a rule, card, ruleset or feed. Followers get notices in their inbox. */
export default function FollowButton({ target, what = 'this', className = 'chip' }) {
  const { user, requireUser } = useSession();
  const subs = useLive(() => doc(db, 'subscribers', target.key), [target.key]);
  const following = Boolean(user && subs.data?.uids?.[user.uid]);
  const count = Object.keys(subs.data?.uids || {}).length;
  const toggle = () =>
    requireUser((u) =>
      attempt(() => setFollowing(target.key, u.uid, !following, { label: target.label, link: target.link }), following ? `Stopped following ${what}` : `Following ${what}: new activity goes to your inbox`),
    );
  return (
    <button
      type="button"
      className={`${className} follow-btn ${following ? 'on' : ''}`}
      onClick={toggle}
      aria-pressed={following}
      title={following ? `You get inbox notices about ${what}. Click to stop.` : `Get inbox notices about ${what} (new comments, versions and changes)`}
    >
      <Icon name={following ? 'bellRing' : 'bell'} />
      <span>{following ? 'Following' : 'Follow'}</span>
      {count > 0 && <span className="follow-count">{count}</span>}
    </button>
  );
}
