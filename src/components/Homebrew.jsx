import { autoFollow, notify, ruleTarget, SUGGESTIONS } from '../lib/inbox.js';
import { shortIds } from '../lib/rules.js';
import { deleteHomebrew, shareHomebrew, withdrawHomebrew } from '../lib/homebrew.js';
import { useSession } from '../lib/session.jsx';
import { confirmDialog } from './dialogs.jsx';
import { attempt, Icon } from './ui.jsx';

/** Where a homebrew stands: private, shared for review, or accepted (with the public label). */
export const homebrewState = (pub) => (!pub ? 'private' : pub.label === 'Suggestion' ? 'shared' : 'accepted');

/**
 * The author's view of their homebrew on a rule or card: what it is, and buttons to share it,
 * take it back or delete it. `pub` is its public copy, once shared. `target` names the rule or
 * card in notices.
 */
export function HomebrewBar({ hb, pub, target, onEdit, onDeleted }) {
  const { requireUser } = useSession();
  const state = homebrewState(pub);
  const what = hb.kind === 'rule' ? 'rule' : hb.kind === 'card' ? 'card change' : 'version';

  const share = () =>
    requireUser(async (u) => {
      const ok = await confirmDialog({
        title: 'Share your homebrew',
        message: `Your ${what} becomes a public suggestion: everyone can see it, react to it and discuss it. Admins may accept it as a Community version or Official Ruling, or add it to a public ruleset. You can keep editing it, and withdraw it while it is under review.`,
        confirmLabel: 'Share for review',
      });
      const id = ok && (await attempt(() => shareHomebrew(hb, u), 'Shared for review: it now has its own discussion'));
      if (!id) return;
      // A shared homebrew rule is a new (suggested) rule; everything else belongs to its rule or card.
      const t = hb.kind === 'rule' ? ruleTarget({ id, title: hb.title, sid: shortIds([{ id }]).get(id) }) : target;
      // Sharing follows the rule or card, so the author hears what others say about it.
      autoFollow(t.key, u.uid, t);
      const title = hb.kind === 'rule' ? `${u.displayName || 'Someone'} shared a homebrew rule: ${hb.title}` : `${u.displayName || 'Someone'} shared a homebrew ${what} for ${t.label}`;
      if (hb.kind !== 'rule') notify(t.key, u, { type: 'suggestion', title, text: hb.text || '', link: t.link });
      notify(SUGGESTIONS.key, u, { type: 'suggestion', title, text: hb.text || '', link: t.link });
    }, 'suggest');

  const withdraw = async () =>
    (await confirmDialog({
      title: 'Withdraw from review',
      message: `Take your ${what} back? The public copy and its discussion go away; your homebrew stays, private to you.`,
      confirmLabel: 'Withdraw',
    })) && attempt(() => withdrawHomebrew(hb), 'Withdrawn: your homebrew is private again');

  const remove = async () => {
    const message =
      state === 'accepted'
        ? `Remove this from your homebrew list? The accepted ${pub.label} version stays public.`
        : `Delete your homebrew ${what}?${state === 'shared' ? ' It is withdrawn from review too.' : ''}`;
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
                It was shared and turned down{hb.declineReason ? `: “${hb.declineReason}”` : '.'}
              </span>
            )}
          </>
        )}
        {state === 'shared' && (
          <>
            <b>Shared for review.</b> Everyone can see and discuss it; admins decide whether to accept it.
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
          <button className="chip" onClick={onEdit} title={state === 'shared' ? 'Edit it: the shared copy changes too' : 'Edit your homebrew'}>
            <Icon name="edit" />
            Edit
          </button>
        )}
        {state === 'private' && (
          <button className="chip ok" onClick={share} title="Share it with everyone, for the admins to review">
            <Icon name="share" />
            Share
          </button>
        )}
        {state === 'shared' && (
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
