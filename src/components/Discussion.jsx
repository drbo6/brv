import { useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { useLive } from '../lib/hooks.js';
import { autoFollow, notify, ruleTarget } from '../lib/inbox.js';
import { addComment, deleteComment, editComment, millis, react } from '../lib/rules.js';
import { plainToHtml } from '../lib/html.js';
import { useSession } from '../lib/session.jsx';
import { attempt, Icon, Reactions, Spinner, timeAgo, UserAvatar, UserName } from './ui.jsx';
import { confirmDialog } from './dialogs.jsx';

/** A homebrew shared for review has its own thread, apart from the rule's or card's general discussion. */
const inReview = (v) => Boolean(v?.homebrewId && v.label === 'Suggestion');

/**
 * Comment thread for a rule, or for a component (`target={{ field: 'componentId', id, name }}`).
 * Each comment remembers which version the author was looking at.
 */
export default function Discussion({ rule, target: given, follow: givenFollow, versions, shownVersion }) {
  const { user, isEditor, requireUser, signIn, block, blockReason } = useSession();
  const target = given || { field: 'ruleId', id: rule.id, name: rule.sid || rule.title };
  const follow = givenFollow || ruleTarget(rule);
  const comments = useLive(() => query(collection(db, 'comments'), where(target.field, '==', target.id)), [target.field, target.id]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);

  // On a shared homebrew: only its own comments. Elsewhere: everything but those review threads.
  const review = inReview(shownVersion) ? shownVersion : null;
  const sorted = useMemo(() => {
    const reviewIds = new Set(versions.filter(inReview).map((v) => v.id));
    return [...(comments.data || [])]
      .filter((c) => (review ? c.versionId === review.id : !reviewIds.has(c.versionId)))
      .sort((a, b) => (millis(a.createdAt) || Infinity) - (millis(b.createdAt) || Infinity));
  }, [comments.data, versions, review]);

  const versionTag = (vid) => {
    const i = versions.findIndex((v) => v.id === vid);
    if (i < 0) return null;
    const v = versions[i];
    return rule?.sid && v.num ? `${v.label} · ${rule.sid}.${v.num}` : `${v.label} · v${v.num || i + 1}`;
  };

  const post = async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    await requireUser(async (u) => {
      // Private homebrew has no public id to remember.
      const versionId = shownVersion && !shownVersion.homebrew ? shownVersion.id : null;
      const ok = await attempt(() => addComment({ [target.field]: target.id, versionId, text: body }, u), null, 'post comment');
      if (!ok) return;
      setText('');
      // Commenting follows the discussion, and tells everyone else who follows it.
      autoFollow(follow.key, u.uid, follow);
      notify(follow.key, u, { type: 'comment', title: `${u.displayName} commented on ${follow.label}`, text: body, link: follow.link });
    }, 'talk');
    setBusy(false);
  };

  return (
    <section className="discussion" aria-label={`Discussion of ${target.name}`}>
      {review && (
        <p className="discussion-scope small">
          <Icon name="share" size={14} />
          Discussion of this shared homebrew. Tell its author and the admins what you think, for instance whether it should become the default. The general discussion is on the
          other versions.
        </p>
      )}
      {comments.loading ? (
        <Spinner label="Loading discussion…" />
      ) : sorted.length === 0 ? (
        <p className="muted small">{review ? 'No comments on this shared homebrew yet.' : 'No comments yet. Start the discussion!'}</p>
      ) : (
        <ol className="comments">
          {sorted.map((c) => (
            <li key={c.id} className="comment">
              <UserAvatar uid={c.uid} name={c.name} size={30} />
              <div className="comment-main">
                <div className="comment-meta">
                  <b>
                    <UserName uid={c.uid} fallback={c.name} />
                  </b>
                  <span className="muted">{timeAgo(c.createdAt)}</span>
                  {c.editedAt && <span className="muted">(edited)</span>}
                  {versionTag(c.versionId) && <span className="tag tiny">on {versionTag(c.versionId)}</span>}
                </div>
                {editing?.id === c.id ? (
                  <form
                    className="comment-edit"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      await attempt(() => editComment(c.id, editing.text.trim()), null, 'edit comment');
                      setEditing(null);
                    }}
                  >
                    <textarea value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} rows={3} maxLength={5000} />
                    <div className="row gap">
                      <button className="primary small" type="submit" disabled={!editing.text.trim()}>
                        Save
                      </button>
                      <button className="small" type="button" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <p className="comment-text" dangerouslySetInnerHTML={{ __html: plainToHtml(c.text) }} />
                )}
                <div className="comment-actions">
                  <Reactions compact reactions={c.reactions} onReact={(type) => requireUser((u) => attempt(() => react('comments', c.id, u.uid, c.reactions?.[u.uid], type), null, 'reaction'), 'talk')} />
                  {user?.uid === c.uid && editing?.id !== c.id && (
                    <button className="link-btn small" onClick={() => setEditing({ id: c.id, text: c.text })}>
                      Edit
                    </button>
                  )}
                  {(user?.uid === c.uid || isEditor) && (
                    <button className="link-btn small danger" onClick={async () => (await confirmDialog({ title: 'Delete comment', message: 'Delete this comment?', confirmLabel: 'Delete', danger: true })) && attempt(() => deleteComment(c), 'Comment deleted')}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {user && block === 'silence' ? (
        <p className="small muted">Your account can’t comment at the moment{blockReason ? ` (${blockReason})` : ''}.</p>
      ) : user ? (
        <form className="comment-form" onSubmit={post}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={review ? 'Discuss this shared homebrew…' : `Discuss ${target.name}${shownVersion && !shownVersion.homebrew ? ` (${shownVersion.label} version)` : ''}…`}
            rows={2}
            maxLength={5000}
            aria-label="Write a comment"
          />
          <button className="primary" type="submit" disabled={busy || !text.trim()}>
            Post
          </button>
        </form>
      ) : (
        <p className="small">
          <button className="link-btn" onClick={signIn}>
            Log in with Google
          </button>{' '}
          to join the discussion.
        </p>
      )}
    </section>
  );
}
