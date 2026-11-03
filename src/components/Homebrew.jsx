import { autoFollow, notify, SUGGESTIONS } from '../lib/inbox.js';
import { deleteHomebrew, shareHomebrew, withdrawHomebrew } from '../lib/homebrew.js';
import { useSession } from '../lib/session.jsx';
import { confirmDialog } from './dialogs.jsx';
import { attempt, Icon } from './ui.jsx';

/**
 * Where a homebrew stands: private, submitted (shared with the admins), shared (a public
 * suggestion), or accepted (with the public label). `pub` is its public copy, if any.
 */
export const homebrewState = (pub, hb) => (pub ? (pub.label === 'Suggestion' ? 'shared' : 'accepted') : hb?.submitted ? 'submitted' : 'private');

/**
 * The author's view of their homebrew on a rule or card: what it is, and buttons to share it,
 * take it back or delete it. `pub` is its public copy, once shared. `target` names the rule or
 * card in notices.
 */
export function HomebrewBar({ hb, pub, target, onEdit, onDeleted }) {
  const { requireUser } = useSession();
  const state = homebrewState(pub, hb);
  const what = hb.kind === 'rule' ? 'rule' : hb.kind === 'card' ? 'card change' : 'version';

  const share = () =>
    requireUser(async (u) => {
      const ok = await confirmDialog({
        title: hb.declinedAt ? 'Share your homebrew again' : 'Share your homebrew with the admins',
        message: `Your ${what} goes to the admins first; until then only you and they see it. If they make it a public Suggestion, everyone can react to it and discuss it, and the admins may later accept it as a Community version or Official Ruling. You can keep editing it, and withdraw it at any time while it is under review.`,
        confirmLabel: 'Share with the admins',
      });
      if (!ok || !(await attempt(() => shareHomebrew(hb), 'Shared with the admins'))) return;
      // Sharing follows the rule or card, so the author hears what others say about it.
      // (A homebrew rule has nothing public to follow yet.)
      if (hb.kind !== 'rule') autoFollow(target.key, u.uid, target);
      const title = hb.kind === 'rule' ? `${u.displayName || 'Someone'} shared a homebrew rule with the admins: ${hb.title}` : `${u.displayName || 'Someone'} shared a homebrew ${what} for ${target.label} with the admins`;
      notify(SUGGESTIONS.key, u, { type: 'suggestion', title, text: hb.text || '', link: SUGGESTIONS.link });
    }, 'suggest');

  const withdraw = async () =>
    (await confirmDialog({
      title: 'Withdraw from review',
      message:
        state === 'shared'
          ? `Take your ${what} back? The public suggestion and its discussion go away; your homebrew stays, private to you.`
          : `Take your ${what} back from the admins? Your homebrew stays, private to you, and you can share it again later.`,
      confirmLabel: 'Withdraw',
    })) && attempt(() => withdrawHomebrew(hb), 'Withdrawn: your homebrew is private again');

  const remove = async () => {
    const message =
      state === 'accepted'
        ? `Remove this from your homebrew list? The accepted ${pub.label} version stays public.`
        : `Delete your homebrew ${what}?${state === 'shared' || state === 'submitted' ? ' It is withdrawn from review too.' : ''}`;
    if (!(await confirmDialog({ title: 'Delete homebrew', message, confirmLabel: 'Delete', danger: true }))) return;
    if (await attempt(() => deleteHomebrew(hb), 'Homebrew deleted')) onDeleted?.();
  };

  return (
    <div className={`homebrew-bar is-${state}`} role="group" aria-label="Your homebrew">
      <Icon name="flask" />
      <span className="homebrew-bar-text">
        {state === 'private' && (
          <>
            <b>Your homebrew.</b> Only you see it.
            {hb.declineReason !== undefined && hb.declinedAt && (
              <span className="homebrew-declined">
                {' '}
                The admins turned it down{hb.declineReason ? `: “${hb.declineReason}”` : '.'} You can still play it, change it and share it again.
              </span>
            )}
          </>
        )}
        {state === 'submitted' && (
          <>
            <b>Shared with the admins.</b> Only you and they see it until they make it a public suggestion.
          </>
        )}
        {state === 'shared' && (
          <>
            <b>Public suggestion.</b> Everyone can see and discuss it; admins decide whether to accept it.
          </>
        )}
        {state === 'accepted' && (
          <>
            <b>Accepted</b> as {pub.label}. Thanks for your homebrew!
          </>
        )}
      </span>
      <span className="homebrew-bar-actions">
        {state !== 'accepted' && (
          <button className="chip" onClick={onEdit} title={state === 'shared' ? 'Edit it: the public suggestion changes too' : 'Edit your homebrew'}>
            <Icon name="edit" />
            Edit
          </button>
        )}
        {state === 'private' && (
          <button className="chip ok" onClick={share} title="Share it with the admins, who can make it a public suggestion">
            <Icon name="share" />
            {hb.declinedAt ? 'Share again' : 'Share'}
          </button>
        )}
        {(state === 'shared' || state === 'submitted') && (
          <button className="chip" onClick={withdraw} title="Take it back from review">
            <Icon name="undo" />
            Withdraw
          </button>
        )}
        <button className="chip danger" onClick={remove} title={state === 'accepted' ? 'Remove from your homebrew list' : 'Delete this homebrew'}>
          <Icon name="trash" />
          {state === 'accepted' ? 'Remove' : 'Delete'}
        </button>
      </span>
    </div>
  );
}
