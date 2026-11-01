import { useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { useLive } from '../lib/hooks.js';
import { addComment, deleteComment, editComment, millis, react } from '../lib/rules.js';
import { plainToHtml } from '../lib/html.js';
import { useSession } from '../lib/session.jsx';
import { attempt, Avatar, Reactions, Spinner, timeAgo } from './ui.jsx';

/** Comment thread for one rule. Each comment remembers which version the author was looking at. */
export default function Discussion({ rule, versions, shownVersion }) {
  const { user, isAdmin, requireUser, signIn } = useSession();
  const comments = useLive(() => query(collection(db, 'comments'), where('ruleId', '==', rule.id)), [rule.id]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);

  const sorted = useMemo(() => [...(comments.data || [])].sort((a, b) => (millis(a.createdAt) || Infinity) - (millis(b.createdAt) || Infinity)), [comments.data]);

  const versionTag = (vid) => {
    const i = versions.findIndex((v) => v.id === vid);
    return i < 0 ? null : `${versions[i].label} · v${i + 1}`;
  };

  const post = async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    await requireUser((u) => attempt(() => addComment({ ruleId: rule.id, versionId: shownVersion?.id, text: body }, u)).then(() => setText('')));
    setBusy(false);
  };

  return (
    <section className="discussion" aria-label={`Discussion of ${rule.code}`}>
      {comments.loading ? (
        <Spinner label="Loading discussion…" />
      ) : sorted.length === 0 ? (
        <p className="muted small">No comments yet. Start the discussion!</p>
      ) : (
        <ol className="comments">
          {sorted.map((c) => (
            <li key={c.id} className="comment">
              <Avatar name={c.name} photo={c.photo} size={30} />
              <div className="comment-main">
                <div className="comment-meta">
                  <b>{c.name}</b>
                  <span className="muted">{timeAgo(c.createdAt)}</span>
                  {c.editedAt && <span className="muted">(edited)</span>}
                  {versionTag(c.versionId) && <span className="tag tiny">on {versionTag(c.versionId)}</span>}
                </div>
                {editing?.id === c.id ? (
                  <form
                    className="comment-edit"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      await attempt(() => editComment(c.id, editing.text.trim()));
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
                  <Reactions compact reactions={c.reactions} onReact={(type) => requireUser((u) => attempt(() => react('comments', c.id, u.uid, c.reactions?.[u.uid], type)))} />
                  {user?.uid === c.uid && editing?.id !== c.id && (
                    <button className="link-btn small" onClick={() => setEditing({ id: c.id, text: c.text })}>
                      Edit
                    </button>
                  )}
                  {(user?.uid === c.uid || isAdmin) && (
                    <button className="link-btn small danger" onClick={() => confirm('Delete this comment?') && attempt(() => deleteComment(c))}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {user ? (
        <form className="comment-form" onSubmit={post}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Discuss ${rule.code}${shownVersion ? ` (${shownVersion.label} version)` : ''}…`}
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
