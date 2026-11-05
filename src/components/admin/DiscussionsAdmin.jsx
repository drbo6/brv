import { useEffect, useMemo, useState } from 'react';
import { collection, deleteField, doc, limit, orderBy, query, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase.js';
import { useLive } from '../../lib/hooks.js';
import { displayTitle, loadComponents } from '../../lib/components.js';
import { fold, plainToHtml } from '../../lib/html.js';
import { href } from '../../lib/router.js';
import { deleteComment, shortIds } from '../../lib/rules.js';
import { commitInChunks } from '../../lib/store.js';
import { useSession } from '../../lib/session.jsx';
import { confirmDialog } from '../dialogs.jsx';
import { attempt, Icon, Spinner, timeAgo, UserAvatar, UserName } from '../ui.jsx';

/** The newest comments across the site, as a queue staff work through. */
export const discussionsQuery = () => query(collection(db, 'comments'), orderBy('createdAt', 'desc'), limit(500));

/**
 * Every recent comment on rules and cards, newest first. Staff mark comments handled once they
 * have read or answered them; the tab counts the ones still open.
 */
export default function DiscussionsAdmin() {
  const { user } = useSession();
  const comments = useLive(discussionsQuery, []);
  const rules = useLive(() => collection(db, 'rules'), []);
  const [cards, setCards] = useState(null);
  const [show, setShow] = useState('open');
  const [q, setQ] = useState('');

  useEffect(() => {
    loadComponents()
      .then(({ types, components }) => {
        const typeById = new Map(types.map((t) => [t.id, t]));
        setCards(new Map(components.map((c) => [c.id, { name: String(displayTitle(typeById.get(c.typeId), c)), typeId: c.typeId }])));
      })
      .catch(() => setCards(new Map()));
  }, []);

  // What each comment is about: a rule (id and title) or a card (name), with a link to it.
  const about = useMemo(() => {
    const sids = shortIds(rules.data || []);
    const byId = new Map((rules.data || []).map((r) => [r.id, r]));
    return (c) => {
      if (c.ruleId) {
        const r = byId.get(c.ruleId);
        return r ? { label: `${sids.get(r.id)} ${r.title}`, kind: 'Rule', link: href('rules', [sids.get(r.id)]) } : { label: 'Deleted rule', kind: 'Rule' };
      }
      const card = cards?.get(c.componentId);
      return card ? { label: card.name, kind: 'Card', link: href('components', [card.typeId, c.componentId]) } : { label: 'Deleted card', kind: 'Card' };
    };
  }, [rules.data, cards]);

  if (comments.loading || rules.loading || !cards) return <Spinner />;
  const all = comments.data || [];
  const open = all.filter((c) => !c.handled);
  const tokens = fold(q.trim()).split(/\s+/).filter(Boolean);
  const list = (show === 'open' ? open : all).filter((c) => !tokens.length || tokens.every((t) => fold(`${c.text} ${c.name} ${about(c).label}`).includes(t)));

  const setHandled = (items, on) =>
    attempt(
      () =>
        commitInChunks(
          items.map((c) => (b) => b.update(doc(db, 'comments', c.id), on ? { handled: true, handledBy: user.uid, handledAt: serverTimestamp() } : { handled: deleteField(), handledBy: deleteField(), handledAt: deleteField() })),
        ),
      items.length === 1 ? (on ? 'Marked handled' : 'Reopened') : `Marked ${items.length} comments handled`,
    );

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{open.length ? `${open.length} open` : 'All caught up'}</h2>
        <div className="seg">
          <button type="button" className={show === 'open' ? 'on' : ''} onClick={() => setShow('open')}>
            Open
          </button>
          <button type="button" className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>
            All
          </button>
        </div>
      </div>
      <p className="small muted">
        The newest comments on rules and cards. Mark a comment <b>handled</b> once it has been read or answered; reply on the rule or card itself. Comments that arrive later
        start out open.
      </p>
      <div className="list-toolbar">
        <div className="search">
          <Icon name="search" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search comments, people, rules and cards…" aria-label="Search comments" />
        </div>
        {show === 'open' && list.length > 1 && (
          <button className="small" onClick={() => setHandled(list, true)} title="Mark every comment shown as handled">
            <Icon name="check" />
            Mark all {list.length} handled
          </button>
        )}
      </div>
      {list.length === 0 ? (
        <p className="muted">{show === 'open' ? 'No open comments.' : 'No comments yet.'}</p>
      ) : (
        <ul className="discussion-queue">
          {list.map((c) => {
            const a = about(c);
            return (
              <li key={c.id} className={c.handled ? 'is-handled' : ''}>
                <UserAvatar uid={c.uid} name={c.name} size={32} />
                <div className="dq-main">
                  <div className="dq-meta">
                    <b>
                      <UserName uid={c.uid} fallback={c.name} />
                    </b>
                    <span className="muted small">on</span>
                    {a.link ? (
                      <a href={a.link} title={`Open this ${a.kind.toLowerCase()} and its discussion`}>
                        {a.label}
                      </a>
                    ) : (
                      <span className="muted">{a.label}</span>
                    )}
                    <span className="tag tiny">{a.kind}</span>
                    <span className="muted small">{timeAgo(c.createdAt)}</span>
                    {c.handled && <span className="tag tiny t-community">Handled</span>}
                  </div>
                  <p className="dq-text" dangerouslySetInnerHTML={{ __html: plainToHtml(c.text) }} />
                </div>
                <div className="dq-tools">
                  <button className="small" onClick={() => setHandled([c], !c.handled)} title={c.handled ? 'Put it back in the open queue' : 'Mark as read or answered'}>
                    <Icon name={c.handled ? 'undo' : 'check'} />
                    {c.handled ? 'Reopen' : 'Handled'}
                  </button>
                  <button
                    className="icon-btn danger"
                    title="Delete this comment"
                    aria-label="Delete comment"
                    onClick={async () =>
                      (await confirmDialog({ title: 'Delete comment', message: `Delete this comment by ${c.name || 'someone'}?`, confirmLabel: 'Delete', danger: true })) &&
                      attempt(() => deleteComment(c), 'Comment deleted')
                    }
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
