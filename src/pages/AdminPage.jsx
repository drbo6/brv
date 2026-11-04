import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, limit, orderBy, query, serverTimestamp, where } from 'firebase/firestore';
import { addDoc, deleteDoc, setDoc, updateDoc, writeBatch } from '../lib/store.js';
import { addDoc as rawAddDoc, setDoc as rawSetDoc } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { useLive, useLocalStorage } from '../lib/hooks.js';
import { href } from '../lib/router.js';
import { commitInChunks, DEFAULT_KINDS, deleteRuleset, LABEL_CLASS, shortIds, millis, reactionCounts, sectionTree, SET_LABELS, updateRuleset } from '../lib/rules.js';
import { sortSets } from '../components/RulesetSelect.jsx';
import { plainToHtml, toPlainText } from '../lib/html.js';
import { acceptSuggestion, declineSuggestion, privateHomebrewCount, publishHomebrew, submittedHomebrewQuery, turnDownHomebrew } from '../lib/homebrew.js';
import { BLOCKS, ROLES, useSession } from '../lib/session.jsx';
import { attempt, Avatar, Empty, Icon, Spinner, timeAgo, UserAvatar, UserName } from '../components/ui.jsx';
import { alertDialog, confirmDialog, promptDialog } from '../components/dialogs.jsx';
import RulesTable from '../components/admin/RulesTable.jsx';
import DiscussionsAdmin, { discussionsQuery } from '../components/admin/DiscussionsAdmin.jsx';
import FollowButton from '../components/FollowButton.jsx';
import { cardTarget, notify, notifyUser, ruleTarget, rulesetTarget, SUGGESTIONS } from '../lib/inbox.js';

const ComponentsAdmin = lazy(() => import('../components/admin/ComponentsAdmin.jsx'));
const DataAdmin = lazy(() => import('../components/admin/DataAdmin.jsx'));

const TABS = [
  { id: 'chat', label: 'Staff chat' },
  { id: 'suggestions', label: 'Suggestions' },
  { id: 'discussions', label: 'Discussions' },
  { id: 'rulesets', label: 'Rulesets' },
  { id: 'rules', label: 'Rules' },
  { id: 'components', label: 'Components' },
  { id: 'people', label: 'People', adminOnly: true },
  { id: 'data', label: 'Backup', ownerOnly: true },
];

export default function AdminPage({ route }) {
  const { user, isEditor, isAdmin, isOwner, authLoading } = useSession();
  // Waiting suggestions are counted on their tab.
  const pendingRules = useLive(() => (isEditor ? query(collection(db, 'versions'), where('label', '==', 'Suggestion')) : null), [isEditor]);
  const pendingCards = useLive(() => (isEditor ? query(collection(db, 'componentVersions'), where('label', '==', 'Suggestion')) : null), [isEditor]);
  const pendingHomebrew = useLive(() => (isEditor ? submittedHomebrewQuery() : null), [isEditor]);
  const pending = (pendingRules.data?.length || 0) + (pendingCards.data?.length || 0) + (pendingHomebrew.data?.length || 0);
  const recentComments = useLive(() => (isEditor ? discussionsQuery() : null), [isEditor]);
  const openComments = (recentComments.data || []).filter((c) => !c.handled).length;
  if (authLoading) return <Spinner />;
  if (!user || !isEditor)
    return (
      <div className="page narrow">
        <Empty title="Staff only">
          <p>
            {user ? (
              <>This part of the site is for editors and admins. An admin can give you a role from Admin → People: they find you by your username.</>
            ) : (
              <>
                Please <a href={href('account')}>log in</a> first.
              </>
            )}
          </p>
        </Empty>
      </div>
    );
  const tabs = TABS.filter((t) => (!t.adminOnly || isAdmin) && (!t.ownerOnly || isOwner));
  const tab = tabs.find((t) => t.id === route.parts[0])?.id || 'chat';
  return (
    <div className="page admin-page">
      <div className="page-head">
        <h1>Admin</h1>
      </div>
      <nav className="tabs" aria-label="Admin sections">
        {tabs.map((t) => (
          <a key={t.id} href={href('admin', [t.id])} className={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined}>
            {t.label}
            {t.id === 'suggestions' && pending > 0 && <span className="tab-count">{pending}</span>}
            {t.id === 'discussions' && openComments > 0 && <span className="tab-count">{openComments}</span>}
          </a>
        ))}
      </nav>
      {tab === 'chat' && <AdminChat />}
      {tab === 'suggestions' && <SuggestionsAdmin />}
      {tab === 'discussions' && <DiscussionsAdmin />}
      {tab === 'rules' && <RulesAdmin route={route} />}
      {tab === 'rulesets' && <RulesetsAdmin />}
      {tab === 'components' && (
        <Suspense fallback={<Spinner />}>
          <ComponentsAdmin route={route} />
        </Suspense>
      )}
      {tab === 'people' && isAdmin && <PeopleAdmin />}
      {tab === 'data' && isOwner && (
        <Suspense fallback={<Spinner />}>
          <DataAdmin />
        </Suspense>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- chat

function AdminChat() {
  const { user } = useSession();
  const messages = useLive(() => query(collection(db, 'adminChat'), orderBy('createdAt', 'desc'), limit(200)), []);
  const [text, setText] = useState('');
  const endRef = useRef(null);
  const list = useMemo(() => [...(messages.data || [])].reverse(), [messages.data]);
  useEffect(() => {
    // Block body on purpose: newer browsers return a Promise from scrollIntoView, which must not reach React.
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [list.length]);

  const send = async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText('');
    await attempt(() => addDoc(collection(db, 'adminChat'), { uid: user.uid, name: user.displayName || 'Admin', text: body, createdAt: serverTimestamp() }), null, 'chat message');
  };

  return (
    <section className="panel chat" aria-label="Admin chat">
      <div className="chat-log" role="log" aria-live="polite">
        {messages.loading ? (
          <Spinner />
        ) : list.length === 0 ? (
          <p className="muted">No messages yet. Say hello to your fellow admins.</p>
        ) : (
          list.map((m, i) => {
            const grouped = i > 0 && list[i - 1].uid === m.uid && millis(m.createdAt) - millis(list[i - 1].createdAt) < 5 * 60 * 1000;
            return (
              <div key={m.id} className={`chat-msg ${m.uid === user.uid ? 'mine' : ''} ${grouped ? 'grouped' : ''}`}>
                {!grouped && <UserAvatar uid={m.uid} name={m.name} size={30} />}
                <div className="chat-bubble">
                  {!grouped && (
                    <div className="chat-meta">
                      <b>
                        <UserName uid={m.uid} fallback={m.name} />
                      </b> <span className="muted">{timeAgo(m.createdAt)}</span>
                    </div>
                  )}
                  <p dangerouslySetInnerHTML={{ __html: plainToHtml(m.text) }} />
                </div>
                {m.uid === user.uid && (
                  <button className="icon-btn chat-del" aria-label="Delete message" onClick={() => attempt(() => deleteDoc(doc(db, 'adminChat', m.id)), 'Message deleted')}>
                    <Icon name="x" size={12} />
                  </button>
                )}
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>
      <form className="chat-form" onSubmit={send}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) send(e);
          }}
          placeholder="Message the admin team… (Enter to send, Shift+Enter for a new line)"
          rows={2}
          aria-label="Message"
          maxLength={4000}
        />
        <button className="primary" type="submit" disabled={!text.trim()} aria-label="Send">
          <Icon name="send" />
        </button>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------- rules

/** Structure first (sections and kinds), then all rules as a table for bulk work. */
function RulesAdmin({ route }) {
  const { canUseTables } = useSession();
  const sections = useLive(() => collection(db, 'sections'), []);
  const rules = useLive(() => collection(db, 'rules'), []);
  const tree = useMemo(() => sectionTree(sections.data || []), [sections.data]);
  const subs = [
    { id: 'sections', label: 'Sections', tip: 'The sections rules are grouped in, and their order' },
    { id: 'kinds', label: 'Kinds', tip: 'The kinds of rule (Note, Tip, FAQ…) with their colors' },
    canUseTables && { id: 'table', label: 'Table', tip: 'All rules as a table, for bulk work on their details' },
  ].filter(Boolean);
  const sub = subs.find((s) => s.id === route.params.get('tab'))?.id || 'sections';
  return (
    <>
      <nav className="tabs small" aria-label="Rules sections">
        {subs.map((s) => (
          <a key={s.id} href={href('admin', ['rules'], s.id === 'sections' ? {} : { tab: s.id })} className={sub === s.id ? 'on' : ''} title={s.tip}>
            {s.label}
          </a>
        ))}
      </nav>
      {sub === 'table' ? (
        <RulesTable tree={tree} />
      ) : sub === 'kinds' ? (
        <KindsEditor rules={rules.data || []} />
      ) : (
        <SectionsEditor tree={tree} rules={rules.data || []} loading={sections.loading} />
      )}
    </>
  );
}

/** Community suggestions for rules and cards, newest first. */
/** Accept a shared suggestion (optionally straight into a public ruleset), or turn it down. */
function ReviewActions({ publicSets, onAccept, onDecline }) {
  const [setId, setSetId] = useState('');
  return (
    <div className="review-actions">
      <button className="small ok" onClick={() => onAccept('Community', setId)} title="Make it a public Community version">
        <Icon name="check" />
        Accept as Community
      </button>
      <button className="small" onClick={() => onAccept('Official Ruling', setId)} title="Make it an Official Ruling">
        Accept as Official Ruling
      </button>
      {publicSets.length > 0 && (
        <label className="review-set small">
          <span className="muted">and use it in</span>
          <select value={setId} onChange={(e) => setSetId(e.target.value)} aria-label="Also use it in a public ruleset">
            <option value="">no ruleset</option>
            {publicSets.map((rs) => (
              <option key={rs.id} value={rs.id}>
                {rs.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button className="small danger" onClick={onDecline} title="Turn it down with a reason: it goes back to its author's homebrew">
        <Icon name="x" />
        Turn down…
      </button>
    </div>
  );
}

function SuggestionsAdmin() {
  const { user } = useSession();
  const rules = useLive(() => collection(db, 'rules'), []);
  const suggestions = useLive(() => query(collection(db, 'versions'), where('label', '==', 'Suggestion')), []);
  const cardSuggestions = useLive(() => query(collection(db, 'componentVersions'), where('label', '==', 'Suggestion')), []);
  const sets = useLive(() => query(collection(db, 'rulesets'), where('visibility', '==', 'public')), []);
  const publicSets = useMemo(() => [...(sets.data || [])].sort((x, y) => x.name.localeCompare(y.name)), [sets.data]);
  const ruleById = useMemo(() => {
    const sids = shortIds(rules.data || []);
    return new Map((rules.data || []).map((r) => [r.id, { ...r, sid: sids.get(r.id) }]));
  }, [rules.data]);
  const who = user.displayName || 'An admin';
  const what = (v) => (v.homebrewId ? 'shared homebrew' : 'suggestion');

  /** Accepting tells the author, everyone following the rule or card, and followers of the ruleset it joins. */
  const accept = async ({ col, v, rule, target }, label, setId) => {
    const set = publicSets.find((x) => x.id === setId);
    const confirmed = await confirmDialog({
      title: `Accept as ${label}`,
      message: `Make this suggestion for ${target.label}, by ${v.createdByName || 'its author'}, a public ${label} version${rule?.status === 'suggested' ? ' (the new rule becomes active)' : ''}${set ? `, and use it in the public ruleset “${set.name}”` : ''}? Its author is told.`,
      confirmLabel: `Accept as ${label}`,
    });
    if (!confirmed) return;
    const ok = await attempt(() => acceptSuggestion({ col, version: v, rule }, label, setId), set ? `Accepted as ${label}, and used in “${set.name}”` : `Accepted as ${label}`);
    if (!ok) return;
    const text = col === 'versions' ? v.text : `Changes: ${Object.keys(v.data || {}).join(', ')}`;
    const inSet = set ? ` and added it to the public ruleset “${set.name}”` : '';
    notifyUser(v.createdBy, target.key, user, { type: 'accepted', title: `${who} accepted your ${what(v)} for ${target.label} as ${label}${inSet}`, text, link: target.link });
    notify(target.key, user, { type: 'adopted', title: `${who} accepted a suggestion for ${target.label} as ${label}`, text, link: target.link }, { skip: [v.createdBy] });
    if (set) {
      const st = rulesetTarget(set);
      notify(st.key, user, { type: 'ruleset', title: `${who} added ${target.label} (${label}) to the ruleset “${set.name}”`, text: '', link: st.link }, { skip: [v.createdBy] });
    }
  };

  /** Turning down removes the public copy and hands a homebrew back to its author, with the reason. */
  const decline = async ({ col, v, rule, target }) => {
    const reason = await promptDialog({
      title: 'Turn down',
      message: v.homebrewId
        ? 'The public suggestion and its discussion are removed, and it goes back to its author as private homebrew. They see your reason, and can change it and share it again.'
        : 'The suggestion is removed. Its author sees your reason.',
      label: 'Reason',
      placeholder: 'e.g. It changes the balance of the Ragnarök phase too much',
      confirmLabel: 'Turn down',
      danger: true,
    });
    if (reason == null) return;
    const ok = await attempt(() => declineSuggestion({ col, version: v, rule }, reason.trim(), user), v.homebrewId ? 'Turned down: it is back in its author’s homebrew' : 'Suggestion removed');
    // A suggested new rule is gone now; its author finds it again among their homebrew.
    const link = rule?.status === 'suggested' ? { page: 'rules', parts: [] } : target.link;
    if (ok) notifyUser(v.createdBy, target.key, user, { type: 'declined', title: `${who} turned down your ${what(v)} for ${target.label}`, text: reason.trim(), link });
  };

  // Homebrew shared with the admins: nobody else sees it until it is made a public suggestion.
  const homebrew = useLive(() => submittedHomebrewQuery(), []);
  const sections = useLive(() => collection(db, 'sections'), []);
  const sectionName = (id) => (sections.data || []).find((s) => s.id === id)?.title || 'a section';
  const brewTarget = (h, id) =>
    h.kind === 'card'
      ? cardTarget({ id: h.componentId, typeId: h.typeId }, h.data?.title || h.componentId.split('__').pop())
      : h.kind === 'rule'
        ? ruleTarget({ id, title: h.title, sid: shortIds([{ id }]).get(id) })
        : ruleById.get(h.ruleId)
          ? ruleTarget(ruleById.get(h.ruleId))
          : { key: `rule_${h.ruleId}`, label: 'a deleted rule', link: { page: 'rules', parts: [] } };

  /** Making a shared homebrew a public suggestion tells its author and everyone following the rule or card. */
  const publish = async (h) => {
    const confirmed = await confirmDialog({
      title: 'Make it a public suggestion',
      message: `Everyone will see this homebrew by ${h.ownerName || 'its author'}, credited to them, and can react to it and discuss it. Check that it is fit to show. Its author is told.`,
      confirmLabel: 'Make it public',
    });
    if (!confirmed) return;
    const id = await attempt(() => publishHomebrew(h), 'Now a public suggestion');
    if (!id) return;
    const t = brewTarget(h, id);
    const text = h.kind === 'card' ? `Changes: ${Object.keys(h.data || {}).join(', ')}` : h.text || '';
    notifyUser(h.ownerUid, t.key, user, { type: 'suggestion', title: `${who} made your homebrew for ${t.label} a public suggestion`, text, link: t.link });
    if (h.kind !== 'rule') notify(t.key, user, { type: 'suggestion', title: `New suggestion for ${t.label}, by ${h.ownerName || 'someone'}`, text, link: t.link }, { skip: [h.ownerUid] });
  };

  const turnDown = async (h) => {
    const reason = await promptDialog({
      title: 'Turn down',
      message: 'It stays private to its author, who sees your reason and can change it and share it again.',
      label: 'Reason',
      placeholder: 'e.g. Please keep the wording civil',
      confirmLabel: 'Turn down',
      danger: true,
    });
    if (reason == null) return;
    if (!(await attempt(() => turnDownHomebrew(h, reason.trim(), user), 'Turned down: it is back in its author’s homebrew'))) return;
    const t = h.kind === 'rule' ? { key: `homebrew_${h.id}`, label: `the rule “${h.title}”`, link: { page: 'rules', parts: [] } } : brewTarget(h);
    notifyUser(h.ownerUid, t.key, user, { type: 'declined', title: `${who} turned down your homebrew for ${t.label}`, text: reason.trim(), link: t.link });
  };

  const brewQueue = [...(homebrew.data || [])].filter((h) => !h.sharedId).sort((x, y) => millis(x.submittedAt) - millis(y.submittedAt));
  const ruleQueue = [...(suggestions.data || [])].sort((x, y) => millis(y.createdAt) - millis(x.createdAt));
  const cardQueue = [...(cardSuggestions.data || [])].sort((x, y) => millis(y.createdAt) - millis(x.createdAt));
  const counts = (v) => {
    const c = reactionCounts(v.reactions);
    return `👍 ${c.up} 👎 ${c.down} ❓ ${c.q}`;
  };

  return (
    <div className="admin-grid">
      <section className="panel span-2">
        <div className="panel-head">
          <h2>Shared with the admins</h2>
          <FollowButton target={SUGGESTIONS} what="homebrew shared with the admins" className="small" />
        </div>
        <p className="small muted">
          Homebrew that members shared with you. Only they and the staff see it. <b>Make it a public suggestion</b> to put it up for everyone to see and discuss, credited to its
          author; <b>Turn down</b> keeps it private to them, with your reason. Authors hear either way.
        </p>
        {homebrew.loading || rules.loading ? (
          <Spinner />
        ) : brewQueue.length === 0 ? (
          <p className="muted">Nothing waiting. 🎉</p>
        ) : (
          <ul className="queue">
            {brewQueue.map((h) => {
              const r = ruleById.get(h.ruleId);
              return (
                <li key={h.id}>
                  <div className="queue-head">
                    {h.kind === 'card' ? (
                      <a href={href('components', [h.typeId, h.componentId])} title="Open the card">
                        <b>{h.componentId.split('__').pop()}</b> {h.data?.title || ''}
                      </a>
                    ) : h.kind === 'rule' ? (
                      <span>
                        <b>{h.title}</b> <span className="small muted">in {sectionName(h.sectionId)}</span>
                      </span>
                    ) : r ? (
                      <a href={href('rules', [r.sid])} title="Open the rule">
                        <b className="rule-code">{r.sid}</b> {r.title}
                      </a>
                    ) : (
                      <span className="muted">Deleted rule</span>
                    )}
                    <span className="tag t-homebrew">{h.kind === 'card' ? 'Card change' : h.kind === 'rule' ? 'New rule' : 'New version'}</span>
                  </div>
                  {h.kind === 'card' ? (
                    <p className="queue-text small">
                      {Object.entries(h.data || {})
                        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                        .join(' · ')}
                    </p>
                  ) : (
                    <p className="queue-text small">{toPlainText(h.text || '')}</p>
                  )}
                  <p className="small muted">
                    by <UserName uid={h.ownerUid} fallback={h.ownerName} /> · shared {timeAgo(h.submittedAt)}
                    {h.note && ` · “${h.note}”`}
                  </p>
                  <div className="review-actions">
                    <button className="small ok" onClick={() => publish(h)} title="Make it a public suggestion, for everyone to see, react to and discuss">
                      <Icon name="check" />
                      Make it a public suggestion
                    </button>
                    <button className="small danger" onClick={() => turnDown(h)} title="Turn it down with a reason: it stays private to its author">
                      <Icon name="x" />
                      Turn down…
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="panel span-2">
        <div className="panel-head">
          <h2>Public suggestions</h2>
        </div>
        <p className="small muted">
          Suggestions everyone can see and discuss. Open one to read its discussion. <b>Accept</b> makes it a public Community version or Official Ruling (a new rule becomes
          active), optionally in a public ruleset right away. <b>Turn down</b> gives it back to its author as private homebrew, with your reason. Authors hear either way.
        </p>
        {suggestions.loading || rules.loading ? (
          <Spinner />
        ) : ruleQueue.length === 0 ? (
          <p className="muted">No rules waiting. 🎉</p>
        ) : (
          <ul className="queue">
            {ruleQueue.map((v) => {
              const r = ruleById.get(v.ruleId);
              const item = { col: 'versions', v, rule: r, target: r ? ruleTarget(r) : { key: `rule_${v.ruleId}`, label: 'a deleted rule', link: { page: 'rules', parts: [] } } };
              return (
                <li key={v.id}>
                  <div className="queue-head">
                    {r ? (
                      <a href={href('rules', [`${r.sid}.${v.n || ''}`.replace(/\.$/, '')])} title="Open it on the Rules page, with its discussion">
                        <b className="rule-code">{r.sid}</b> {r.title}
                      </a>
                    ) : (
                      <span className="muted">Deleted rule</span>
                    )}
                    {r?.status === 'suggested' ? <span className="tag t-suggestion">New rule</span> : <span className="tag t-suggestion">New version</span>}
                  </div>
                  <p className="queue-text small">{toPlainText(v.text).slice(0, 280)}</p>
                  <p className="small muted">
                    by <UserName uid={v.createdBy} fallback={v.createdByName} /> · {timeAgo(v.createdAt)} · {counts(v)}
                    {v.note && ` · “${v.note}”`}
                  </p>
                  <ReviewActions publicSets={publicSets} onAccept={(label, setId) => accept(item, label, setId)} onDecline={() => decline(item)} />
                </li>
              );
            })}
          </ul>
        )}
        <h3 className="queue-title">Cards</h3>
        {cardSuggestions.loading ? (
          <Spinner />
        ) : !cardQueue.length ? (
          <p className="muted small">No cards waiting.</p>
        ) : (
          <ul className="queue">
            {cardQueue.map((v) => {
              const name = v.data?.title || v.componentId.split('__').pop();
              const item = { col: 'componentVersions', v, target: cardTarget({ id: v.componentId, typeId: v.typeId }, name) };
              return (
                <li key={v.id}>
                  <div className="queue-head">
                    <a href={href('components', [v.typeId, v.componentId])} title="Open the card to compare versions and discuss">
                      <b>{v.componentId.split('__').pop()}</b> {v.data?.title || ''}
                    </a>
                    <span className="small muted">changes {Object.keys(v.data || {}).join(', ')}</span>
                  </div>
                  <p className="small muted">
                    by <UserName uid={v.createdBy} fallback={v.createdByName} /> · {timeAgo(v.createdAt)} · {counts(v)}
                    {v.note && ` · “${v.note}”`}
                  </p>
                  <ReviewActions publicSets={publicSets} onAccept={(label, setId) => accept(item, label, setId)} onDecline={() => decline(item)} />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Admins define the list of rule kinds: a name and a color each. Rules store the kind's id. */
function KindsEditor({ rules }) {
  const { kinds } = useSession();
  const [rows, setRows] = useState(kinds);
  useEffect(() => {
    setRows(kinds);
  }, [kinds]);
  const dirty = JSON.stringify(rows) !== JSON.stringify(kinds);
  const used = (id) => rules.filter((r) => (r.kind || 'rule') === id).length;
  const update = (i, patch) => setRows((list) => list.map((k, j) => (j === i ? { ...k, ...patch } : k)));
  const move = (i, d) =>
    setRows((list) => {
      const next = [...list];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    });

  const add = async () => {
    const label = await promptDialog({
      title: 'New rule kind',
      label: 'Name',
      placeholder: 'e.g. Errata, Variant, Clarification',
      confirmLabel: 'Add kind',
      validate: (v) => (rows.some((k) => k.label.toLowerCase() === v.trim().toLowerCase()) ? 'That kind already exists.' : ''),
    });
    if (!label?.trim()) return;
    let id = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'kind';
    while (rows.some((k) => k.id === id)) id += '-2';
    setRows([...rows, { id, label: label.trim(), color: '#8a7d72' }]);
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Rule kinds</h2>
        <div className="row gap">
          <button className="small" onClick={add}>
            <Icon name="plus" />
            Add kind
          </button>
          <button className="small primary" disabled={!dirty} onClick={() => attempt(() => setDoc(doc(db, 'config', 'site'), { kinds: rows }, { merge: true }), 'Rule kinds saved')}>
            <Icon name="save" />
            Save
          </button>
        </div>
      </div>
      <p className="small muted">
        Kinds categorize rules. Every kind except “{rows[0]?.label}” shows as a colored badge, and readers can filter by kind. Set a rule's kind with <b>Rule details</b> on the rule.
        Renaming a kind updates every rule that uses it.
      </p>
      <table className="table kinds-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Color</th>
            <th title="Number of rules with this kind">Rules</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((k, i) => (
            <tr key={k.id}>
              <td>
                <input value={k.label} onChange={(e) => update(i, { label: e.target.value })} aria-label="Kind name" />
              </td>
              <td>
                <span className="row gap">
                  <input type="color" value={k.color || '#8a7d72'} onChange={(e) => update(i, { color: e.target.value })} aria-label={`Color of ${k.label}`} />
                  <span className="kind-tag" style={{ '--kind': k.color }}>
                    {k.label || '…'}
                  </span>
                </span>
              </td>
              <td className="muted">{used(k.id)}</td>
              <td className="row">
                <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${k.label} up`} title="Move up (order in menus)">
                  <Icon name="chevronUp" />
                </button>
                <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={`Move ${k.label} down`} title="Move down">
                  <Icon name="chevronDown" />
                </button>
                <button
                  className="icon-btn danger"
                  disabled={i === 0 || used(k.id) > 0}
                  title={i === 0 ? 'The first kind is the default for new rules' : used(k.id) ? 'Change the kind of its rules first' : 'Remove this kind'}
                  aria-label={`Remove ${k.label}`}
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                >
                  <Icon name="trash" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {kinds === DEFAULT_KINDS && !dirty && <p className="hint">These are the built-in kinds. Saving stores them so you can change them.</p>}
    </section>
  );
}

function SectionsEditor({ tree, rules, loading }) {
  const [adding, setAdding] = useState({ title: '', parent: '' });
  const ruleCount = (id) => rules.filter((r) => r.sectionId === id).length;

  const move = (s, delta) => {
    const siblings = tree.children.get(s.parent && tree.byId.has(s.parent) ? s.parent : null) || [];
    const i = siblings.findIndex((x) => x.id === s.id);
    const j = i + delta;
    if (j < 0 || j >= siblings.length) return;
    const list = [...siblings];
    [list[i], list[j]] = [list[j], list[i]];
    return attempt(() => commitInChunks(list.map((x, k) => (b) => b.update(doc(db, 'sections', x.id), { order: k + 1 }))), null, 'move section');
  };

  const add = async (e) => {
    e.preventDefault();
    const siblings = tree.children.get(adding.parent || null) || [];
    const ok = await attempt(() => addDoc(collection(db, 'sections'), { title: adding.title.trim(), parent: adding.parent || null, order: siblings.length + 1 }), 'Section added');
    if (ok) setAdding({ title: '', parent: '' });
  };

  return (
    <section className="panel span-2">
      <h2>Sections</h2>
      <p className="small muted">
        Section numbers follow the order here and change when you move sections. Rules are cited by their own permanent short id (like <code>k7q2m</code>), which never changes.
      </p>
      {loading ? (
        <Spinner />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Title</th>
              <th>Parent</th>
              <th>Rules</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {tree.ordered.map((s) => (
              <tr key={s.id}>
                <td className="muted">{s.number}</td>
                <td style={{ paddingLeft: 8 + s.depth * 18 }}>
                  <input defaultValue={s.title} aria-label="Title" onBlur={(e) => e.target.value.trim() && e.target.value !== s.title && attempt(() => updateDoc(doc(db, 'sections', s.id), { title: e.target.value.trim() }), null, 'section title')} />
                </td>
                <td>
                  <select
                    value={s.parent || ''}
                    aria-label="Parent section"
                    onChange={(e) => {
                      const parent = e.target.value || null;
                      const order = (tree.children.get(parent) || []).length + 1;
                      attempt(() => updateDoc(doc(db, 'sections', s.id), { parent, order }), null, 'section parent');
                    }}
                  >
                    <option value="">— top level —</option>
                    {tree.ordered
                      .filter((p) => p.id !== s.id && !p.number.startsWith(`${s.number}.`))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.number} {p.title}
                        </option>
                      ))}
                  </select>
                </td>
                <td className="muted">{ruleCount(s.id)}</td>
                <td className="row">
                  <button className="icon-btn" onClick={() => move(s, -1)} aria-label="Move up">
                    <Icon name="arrowUp" />
                  </button>
                  <button className="icon-btn" onClick={() => move(s, 1)} aria-label="Move down">
                    <Icon name="arrowDown" />
                  </button>
                  <button
                    className="icon-btn danger"
                    aria-label="Delete section"
                    disabled={ruleCount(s.id) > 0 || (tree.children.get(s.id) || []).length > 0}
                    title={ruleCount(s.id) > 0 ? 'Move or delete its rules first' : 'Delete section'}
                    onClick={async () => (await confirmDialog({ title: 'Delete section', message: `Delete the section “${s.title}”? Its rules stay, but show under “Unsorted” until you move them.`, confirmLabel: 'Delete', danger: true })) && attempt(() => deleteDoc(doc(db, 'sections', s.id)), 'Section deleted')}
                  >
                    <Icon name="trash" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form className="row gap wrap add-row" onSubmit={add}>
        <input value={adding.title} onChange={(e) => setAdding({ ...adding, title: e.target.value })} placeholder="Title" required aria-label="New section title" />
        <select value={adding.parent} onChange={(e) => setAdding({ ...adding, parent: e.target.value })} aria-label="New section parent">
          <option value="">— top level —</option>
          {tree.ordered.map((p) => (
            <option key={p.id} value={p.id}>
              {p.number} {p.title}
            </option>
          ))}
        </select>
        <button className="primary" type="submit">
          <Icon name="plus" />
          Add section
        </button>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------- rulesets

function RulesetsAdmin() {
  const { site, user } = useSession();
  const sets = useLive(() => collection(db, 'rulesets'), []);
  const all = sets.data || [];
  // Public sets first (Official, Community, Experimental), then everyone's private sets, newest first.
  const list = [...sortSets(all.filter((s) => s.visibility === 'public')), ...all.filter((s) => s.visibility !== 'public').sort((a, b) => millis(b.updatedAt) - millis(a.updatedAt))];
  const hasPublic = all.some((s) => s.visibility === 'public');
  const setDefault = (id) => attempt(() => setDoc(doc(db, 'config', 'site'), { defaultRulesetId: id }, { merge: true }), 'Default ruleset updated');

  const rename = async (s) => {
    const name = await promptDialog({ title: 'Rename ruleset', label: 'Name', initial: s.name, confirmLabel: 'Rename', validate: (v) => (v.trim() ? '' : 'Give it a name.') });
    if (name?.trim() && name.trim() !== s.name) attempt(() => updateRuleset(s.id, { name: name.trim() }), 'Ruleset renamed');
  };

  return (
    <section className="panel">
      <h2>Rulesets</h2>
      <p className="small muted">
        No ruleset is <i>the</i> rulebook: rulebooks get editions too. Public rulesets appear for everyone in the ruleset picker, grouped by their label (<i>Official</i>,{' '}
        <i>Community</i> or <i>Experimental</i>). The default ruleset, whatever its label, is what visitors see until they pick another; only a public ruleset can be the
        default. Rename a ruleset with the pencil.
      </p>
      {!hasPublic && !sets.loading && (
        <p className="callout small">
          The site has no public ruleset yet: readers see every rule in its main version (Rulebook, else Official Ruling, else Community), and the picker has nothing to
          offer. Rulesets are made on the Rules page (Customize, then
          save); make one public here and it becomes the first.
        </p>
      )}
      {sets.loading ? (
        <Spinner />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Default</th>
              <th>Name</th>
              <th>Label</th>
              <th>Owner</th>
              <th>Rules</th>
              <th>Updated</th>
              <th>Public</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td>
                  <input
                    type="radio"
                    name="default-set"
                    checked={site.defaultRulesetId === s.id}
                    disabled={s.visibility !== 'public'}
                    onChange={() => setDefault(s.id)}
                    aria-label={`Make ${s.name} the default`}
                  />
                </td>
                <td>
                  <a href={href('rules', [], { set: s.id })}>{s.name}</a>{' '}
                  <button className="icon-btn" onClick={() => rename(s)} aria-label={`Rename ${s.name}`} title="Rename">
                    <Icon name="edit" size={14} />
                  </button>
                  {s.description && <p className="small muted clamp">{s.description}</p>}
                </td>
                <td>
                  <select
                    value={s.label in SET_LABELS ? s.label : ''}
                    onChange={(e) => attempt(() => updateRuleset(s.id, { label: e.target.value || null }), e.target.value ? `Labeled ${e.target.value}` : 'Label removed')}
                    aria-label={`Label of ${s.name}`}
                  >
                    <option value="">No label</option>
                    {Object.keys(SET_LABELS).map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <UserName uid={s.ownerUid} fallback={s.ownerName} />
                </td>
                <td>{Object.keys(s.entries || {}).length}</td>
                <td className="muted">{timeAgo(s.updatedAt)}</td>
                <td>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={s.visibility === 'public'}
                      onChange={async (e) => {
                        if (!e.target.checked && site.defaultRulesetId === s.id) return alertDialog({ title: 'This is the default', message: 'Choose another default ruleset before making this one private.' });
                        const pub = e.target.checked;
                        // Private homebrew in it would be missing for everyone but its author.
                        const hidden = pub ? await privateHomebrewCount(s).catch(() => 0) : 0;
                        if (
                          hidden &&
                          !(await confirmDialog({
                            title: 'This ruleset uses private homebrew',
                            message: `${hidden === 1 ? 'One rule or card' : `${hidden} rules or cards`} in “${s.name}” ${hidden === 1 ? 'is' : 'are'} its owner's private homebrew, which nobody else can see. Ask them to share ${hidden === 1 ? 'it' : 'them'} for review first, or make the ruleset public without ${hidden === 1 ? 'it' : 'them'}.`,
                            confirmLabel: 'Make public without them',
                          }))
                        )
                          return;
                        attempt(() => updateRuleset(s.id, { visibility: pub ? 'public' : 'private' }), pub ? 'Ruleset made public' : 'Ruleset made private').then((ok) => {
                          const t = rulesetTarget(s);
                          if (ok) notify(t.key, user, { type: 'ruleset', title: `${user.displayName || 'An admin'} made the ruleset “${s.name}” ${pub ? 'public: everyone can now pick it' : 'private'}`, text: '', link: t.link });
                        });
                      }}
                    />
                    <span className="switch-track" aria-hidden="true" />
                    <span className="sr-only">Public</span>
                  </label>
                </td>
                <td>
                  <button
                    className="icon-btn danger"
                    aria-label={`Delete ${s.name}`}
                    disabled={site.defaultRulesetId === s.id}
                    onClick={async () => (await confirmDialog({ title: 'Delete ruleset', message: `Delete “${s.name}” by ${s.ownerName}?`, confirmLabel: 'Delete', danger: true })) && attempt(() => deleteRuleset(s.id), 'Ruleset deleted')}
                  >
                    <Icon name="trash" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- people

// What each role, permission and restriction allows, shown at the top of People.
const RIGHTS = [
  ['Read everything: rules, versions, discussions, rulesets, cards', true, true, true, true, true],
  ['React, comment, follow, inbox, save own rulesets', false, true, true, true, true],
  ['Write private homebrew (rules, versions, cards) and share it for review', false, true, true, true, true],
  ['Edit rules and versions, accept or turn down shared homebrew', false, false, true, true, true],
  ['Sections, rule kinds, component types, card layouts, shorthands', false, false, true, true, true],
  ['Add, edit and delete cards; publish rulesets and pick the default', false, false, true, true, true],
  ['Staff chat and the suggestions queue', false, false, true, true, true],
  ['Bulk tables (rules and components)', false, false, 'if given', 'if given', true],
  ['People: roles, table access, restrictions, moderation log', false, false, false, true, true],
  ['Backup (download the whole database)', false, false, false, false, true],
  ['Can be demoted or restricted', false, true, true, 'demoted only', false],
];

function RightsGuide() {
  // Collapsed until opened; the choice is remembered (under a new key, so everyone starts collapsed).
  const [open, setOpen] = useLocalStorage('brv-rights-open-v2', false);
  const mark = (v) => (v === true ? <Icon name="check" size={14} className="yes" /> : v === false ? <span className="muted">—</span> : <span className="small">{v}</span>);
  return (
    <details className="rights-guide" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Who can do what</summary>
      <div className="table-wrap">
        <table className="table rights-table">
          <thead>
            <tr>
              <th />
              <th>Visitor</th>
              <th>User</th>
              <th>Editor</th>
              <th>Admin</th>
              <th>Owner</th>
            </tr>
          </thead>
          <tbody>
            {RIGHTS.map(([what, ...cells]) => (
              <tr key={what}>
                <th scope="row">{what}</th>
                {cells.map((v, i) => (
                  <td key={i}>{mark(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="rights-notes">
        <dt>Roles</dt>
        <dd>
          <b>Visitors</b> aren't signed in. Everyone who signs in and picks a username is a <b>user</b>. <b>Editors</b> look after all content; <b>admins</b> also look after
          people. The <b>owner</b> is the admin who set the site up: nobody can demote or restrict them from the site.
        </dd>
        <dt>Table access</dt>
        <dd>
          The bulk tables (Admin → Rules → Table, and each component type's Table) change many things at once, so they are a separate permission, off by default. Tick{' '}
          <b>Tables</b> on an editor or admin to allow them. The owner always has them.
        </dd>
        <dt>Restrictions</dt>
        <dd>
          For users and editors who misbehave: <b>No sharing</b> keeps them from sharing homebrew for review (they can still write private homebrew, comment and react);{' '}
          <b>Silenced</b> makes them read-only. They see the reason you give. Admins can't be restricted; take away their admin role instead.
        </dd>
        <dt>Undo and log</dt>
        <dd>Every change here can be undone, and is listed in the moderation log below.</dd>
      </dl>
    </details>
  );
}

function PeopleAdmin() {
  const { user, ownerUid, ownerLoaded } = useSession();
  const users = useLive(() => collection(db, 'users'), []);
  const roles = useLive(() => collection(db, 'roles'), []);
  const admins = useLive(() => collection(db, 'admins'), []);
  const log = useLive(() => query(collection(db, 'modlog'), orderBy('createdAt', 'desc'), limit(50)), []);
  const [filter, setFilter] = useState('');
  const [show, setShow] = useState('all');

  const roleOf = useMemo(() => new Map((roles.data || []).map((r) => [r.id, r])), [roles.data]);
  const legacy = useMemo(() => new Set((admins.data || []).map((a) => a.id)), [admins.data]);
  const effectiveRole = (uid) => (uid === ownerUid ? 'owner' : legacy.has(uid) || roleOf.get(uid)?.role === 'admin' ? 'admin' : roleOf.get(uid)?.role === 'editor' ? 'editor' : 'user');
  const blockOf = (uid) => roleOf.get(uid)?.block || 'none';
  const adminCount = (users.data || []).filter((u) => ['owner', 'admin'].includes(effectiveRole(u.id))).length;

  const rank = { owner: 0, admin: 1, editor: 2, user: 3 };
  const list = [...(users.data || [])]
    .filter((u) => u.setup || u.name)
    .filter((u) => !filter || u.name?.toLowerCase().includes(filter.toLowerCase()))
    .filter((u) => show === 'all' || (show === 'staff' ? effectiveRole(u.id) !== 'user' : blockOf(u.id) !== 'none'))
    .sort((a, b) => rank[effectiveRole(a.id)] - rank[effectiveRole(b.id)] || millis(b.lastSeen) - millis(a.lastSeen));

  // Moderation log entries are permanent (not undoable), so they are written directly.
  const logAction = (target, action, from, to, reason = '') =>
    rawAddDoc(collection(db, 'modlog'), { actorUid: user.uid, actorName: user.displayName, targetUid: target.id, targetName: target.name || '', action, from, to, reason, createdAt: serverTimestamp() }).catch((e) =>
      console.warn('Could not write the moderation log', e),
    );

  const setRole = async (u, role) => {
    const from = effectiveRole(u.id);
    if (from === role) return;
    if (['owner', 'admin'].includes(from) && role !== 'admin' && adminCount <= 1) return alertDialog({ title: 'Last admin', message: 'There must be at least one admin.' });
    if (u.id === user.uid && !(await confirmDialog({ title: 'Change your own role', message: `You will become ${ROLES[role].toLowerCase()} and lose the matching access. Another admin can give it back.`, confirmLabel: 'Change', danger: true })))
      return;
    const ok = await attempt(async () => {
      const batch = writeBatch();
      // Admins can't be restricted: becoming one lifts any restriction.
      batch.set(doc(db, 'roles', u.id), { role, ...(role === 'admin' ? { block: 'none', reason: '' } : {}), updatedBy: user.uid, updatedAt: serverTimestamp() }, { merge: true });
      // The original admin list would keep them an admin: take them off it.
      if (legacy.has(u.id) && role !== 'admin') batch.delete(doc(db, 'admins', u.id));
      await batch.commit();
    }, `${u.name} is now ${role === 'user' ? 'a regular user' : `an ${ROLES[role].toLowerCase()}`}`);
    if (ok) logAction(u, 'role', from, role);
  };

  const setTables = async (u, on) => {
    const ok = await attempt(
      () => setDoc(doc(db, 'roles', u.id), { tables: on, updatedBy: user.uid, updatedAt: serverTimestamp() }, { merge: true }),
      on ? `${u.name} can now use the tables` : `${u.name} no longer has table access`,
    );
    if (ok) logAction(u, 'tables', on ? 'off' : 'on', on ? 'on' : 'off');
  };

  const setBlock = async (u, block) => {
    const from = blockOf(u.id);
    if (from === block) return;
    let reason = '';
    if (block !== 'none') {
      reason = await promptDialog({
        title: block === 'silence' ? `Silence ${u.name}` : `Stop ${u.name} from suggesting`,
        message:
          block === 'silence'
            ? 'They can still read everything, but can no longer comment, react, suggest or send notices.'
            : 'They can still comment and react, but can no longer suggest rules, versions or card changes.',
        label: 'Reason (shown to them)',
        placeholder: 'e.g. Repeated spam suggestions',
        confirmLabel: block === 'silence' ? 'Silence' : 'Restrict',
        allowEmpty: true,
      });
      if (reason === null) return;
    }
    const ok = await attempt(
      () => setDoc(doc(db, 'roles', u.id), { block, reason: reason.trim(), updatedBy: user.uid, updatedAt: serverTimestamp() }, { merge: true }),
      block === 'none' ? `${u.name}'s restriction was lifted` : `${u.name} is restricted: ${BLOCKS[block].toLowerCase()}`,
    );
    if (ok) logAction(u, 'block', from, block, reason.trim());
  };

  const claim = () =>
    attempt(() => rawSetDoc(doc(db, 'config', 'owner'), { uid: user.uid, claimedAt: serverTimestamp() }), 'You are now the owner of this site');

  return (
    <div className="admin-grid">
      {ownerLoaded && !ownerUid && (
        <section className="panel span-2 owner-claim">
          <h2>No owner yet</h2>
          {legacy.has(user.uid) ? (
            <>
              <p className="muted">
                The owner is the one admin nobody can demote or restrict. Claim it now: this can only be done once, and only changed later in the Firebase console.
              </p>
              <button className="primary" onClick={claim}>
                <Icon name="shield" />
                Make me the owner
              </button>
            </>
          ) : (
            <p className="muted">An admin from the original setup (with a document in the admins collection) can claim ownership here.</p>
          )}
        </section>
      )}

      <section className="panel span-2">
        <div className="panel-head">
          <h2>People</h2>
          <div className="seg">
            {[
              ['all', 'Everyone'],
              ['staff', 'Staff'],
              ['restricted', 'Restricted'],
            ].map(([id, label]) => (
              <button key={id} type="button" className={show === id ? 'on' : ''} onClick={() => setShow(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <RightsGuide />
        <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find someone by username…" aria-label="Find people" className="wide-search" />
        {users.loading || roles.loading ? (
          <Spinner />
        ) : list.length === 0 ? (
          <p className="muted">Nobody matches.</p>
        ) : (
          <ul className="people">
            {list.map((u) => {
              const role = effectiveRole(u.id);
              const block = blockOf(u.id);
              const locked = role === 'owner';
              return (
                <li key={u.id} className={block !== 'none' ? 'is-restricted' : ''}>
                  <Avatar name={u.name} avatar={u.avatar} photo={u.photo} size={36} />
                  <div className="people-main">
                    <b>{u.name || 'New member'}</b> {u.id === user.uid && <span className="muted small">(you)</span>}
                    <p className="small muted">
                      last seen {timeAgo(u.lastSeen)}
                      {block !== 'none' && (
                        <span className="tag t-warn" title={roleOf.get(u.id)?.reason || 'No reason given'}>
                          {BLOCKS[block]}
                        </span>
                      )}
                    </p>
                  </div>
                  {locked ? (
                    <span className="tag t-official" title="The owner can't be demoted or restricted from the site">
                      Owner
                    </span>
                  ) : (
                    <div className="people-controls">
                      <label>
                        <span className="sr-only">Role of {u.name}</span>
                        <select value={role} onChange={(e) => setRole(u, e.target.value)} title="Role: what this person may manage">
                          <option value="user">User</option>
                          <option value="editor">Editor</option>
                          <option value="admin">Admin</option>
                        </select>
                      </label>
                      <label className={`check tables-toggle ${role === 'user' ? 'is-na' : ''}`} title={role === 'user' ? 'Only editors and admins can be given table access' : 'Allow the bulk tables (Admin → Rules → Table, component tables)'}>
                        <input type="checkbox" checked={role !== 'user' && Boolean(roleOf.get(u.id)?.tables)} disabled={role === 'user'} onChange={(e) => setTables(u, e.target.checked)} />
                        Tables
                      </label>
                      <label>
                        <span className="sr-only">Restriction for {u.name}</span>
                        <select
                          value={role === 'admin' ? 'none' : block}
                          onChange={(e) => setBlock(u, e.target.value)}
                          disabled={u.id === user.uid || role === 'admin'}
                          title={role === 'admin' ? 'Admins can’t be restricted' : u.id === user.uid ? 'You can’t restrict yourself' : 'Restrict what this person can do'}
                        >
                          {Object.entries(BLOCKS).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="panel span-2">
        <h2>Moderation log</h2>
        {log.loading ? (
          <Spinner />
        ) : !log.data?.length ? (
          <p className="muted small">No role or restriction changes yet.</p>
        ) : (
          <ul className="modlog">
            {log.data.map((e) => (
              <li key={e.id}>
                <span className="muted small">{timeAgo(e.createdAt)}</span>{' '}
                <b>
                  <UserName uid={e.actorUid} fallback={e.actorName} />
                </b>{' '}
                {e.action === 'tables' ? (
                  <>
                    {e.to === 'on' ? 'gave' : 'removed'} table access {e.to === 'on' ? 'to' : 'from'} <UserName uid={e.targetUid} fallback={e.targetName} />
                  </>
                ) : e.action === 'role' ? (
                  <>
                    changed <UserName uid={e.targetUid} fallback={e.targetName} /> from {ROLES[e.from] || e.from} to <b>{ROLES[e.to] || e.to}</b>
                  </>
                ) : (
                  <>
                    set <UserName uid={e.targetUid} fallback={e.targetName} /> to <b>{BLOCKS[e.to] || e.to}</b>
                    {e.reason && <span className="muted"> — “{e.reason}”</span>}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
