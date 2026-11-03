import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, limit, orderBy, query, serverTimestamp, where } from 'firebase/firestore';
import { addDoc, deleteDoc, setDoc, updateDoc } from '../lib/store.js';
import { db } from '../lib/firebase.js';
import { useLive } from '../lib/hooks.js';
import { href } from '../lib/router.js';
import { commitInChunks, DEFAULT_KINDS, deleteRuleset, LABEL_CLASS, shortIds, millis, reactionCounts, RULEBOOK_SET, sectionTree, updateRuleset, updateVersion } from '../lib/rules.js';
import { plainToHtml } from '../lib/html.js';
import { deleteCardVersion, updateCardVersion } from '../lib/cardVersions.js';
import { useSession } from '../lib/session.jsx';
import { attempt, Avatar, Empty, Icon, Spinner, timeAgo, UserAvatar, UserName } from '../components/ui.jsx';
import { alertDialog, confirmDialog, promptDialog } from '../components/dialogs.jsx';
import FollowButton from '../components/FollowButton.jsx';
import { cardTarget, notify, ruleTarget, rulesetTarget, SUGGESTIONS } from '../lib/inbox.js';

const ComponentsAdmin = lazy(() => import('../components/admin/ComponentsAdmin.jsx'));
const DataAdmin = lazy(() => import('../components/admin/DataAdmin.jsx'));

const TABS = [
  { id: 'chat', label: 'Admin chat' },
  { id: 'rules', label: 'Rules' },
  { id: 'rulesets', label: 'Rulesets' },
  { id: 'components', label: 'Components' },
  { id: 'people', label: 'People' },
  { id: 'data', label: 'Backup & import' },
];

export default function AdminPage({ route }) {
  const { user, isAdmin, authLoading } = useSession();
  if (authLoading) return <Spinner />;
  if (!user || !isAdmin)
    return (
      <div className="page narrow">
        <Empty title="Admins only">
          <p>
            {user ? (
              <>
                Your account is not an admin. Share your user ID from the <a href={href('account')}>Account</a> page with a site admin.
              </>
            ) : (
              <>
                Please <a href={href('account')}>log in</a> first.
              </>
            )}
          </p>
        </Empty>
      </div>
    );
  const tab = TABS.find((t) => t.id === route.parts[0])?.id || 'chat';
  return (
    <div className="page admin-page">
      <div className="page-head">
        <h1>Admin</h1>
      </div>
      <nav className="tabs" aria-label="Admin sections">
        {TABS.map((t) => (
          <a key={t.id} href={href('admin', [t.id])} className={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined}>
            {t.label}
          </a>
        ))}
      </nav>
      {tab === 'chat' && <AdminChat />}
      {tab === 'rules' && <RulesAdmin />}
      {tab === 'rulesets' && <RulesetsAdmin />}
      {tab === 'components' && (
        <Suspense fallback={<Spinner />}>
          <ComponentsAdmin route={route} />
        </Suspense>
      )}
      {tab === 'people' && <PeopleAdmin />}
      {tab === 'data' && (
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

function RulesAdmin() {
  const { user } = useSession();
  const sections = useLive(() => collection(db, 'sections'), []);
  const rules = useLive(() => collection(db, 'rules'), []);
  const suggestions = useLive(() => query(collection(db, 'versions'), where('label', '==', 'Suggestion')), []);
  const cardSuggestions = useLive(() => query(collection(db, 'componentVersions'), where('label', '==', 'Suggestion')), []);
  const tree = useMemo(() => sectionTree(sections.data || []), [sections.data]);
  const ruleById = useMemo(() => {
    const sids = shortIds(rules.data || []);
    return new Map((rules.data || []).map((r) => [r.id, { ...r, sid: sids.get(r.id) }]));
  }, [rules.data]);

  const suggestedRules = (rules.data || []).filter((r) => r.status === 'suggested');

  // Adopting a suggestion tells everyone following that rule or card, including its author.
  const relabelRuleVersion = (v, label) =>
    attempt(() => updateVersion(v.id, { label }), `Labeled ${label}`).then((ok) => {
      const r = ruleById.get(v.ruleId);
      if (!ok || !r) return;
      const t = ruleTarget(r);
      notify(t.key, user, { type: 'adopted', title: `${user.displayName || 'An admin'} marked a suggestion for ${t.label} as ${label}`, text: v.text, link: t.link });
    });
  const relabelCardVersion = (v, label) =>
    attempt(() => updateCardVersion(v.id, { label }), `Labeled ${label}`).then((ok) => {
      if (!ok) return;
      const t = cardTarget({ id: v.componentId, typeId: v.typeId }, v.data?.title || v.componentId.split('__').pop());
      notify(t.key, user, { type: 'adopted', title: `${user.displayName || 'An admin'} marked a suggestion for ${t.label} as ${label}`, text: `Changes: ${Object.keys(v.data || {}).join(', ')}`, link: t.link });
    });
  const queue = [...(suggestions.data || [])].sort((a, b) => millis(b.createdAt) - millis(a.createdAt));

  return (
    <div className="admin-grid">
      <section className="panel">
        <div className="panel-head">
          <h2>Suggestions queue</h2>
          <FollowButton target={SUGGESTIONS} what="new suggestions from the community" className="small" />
        </div>
        <p className="small muted">New rules and versions suggested by the community. Relabel a version to adopt it, or open the rule to discuss.</p>
        {suggestions.loading ? (
          <Spinner />
        ) : queue.length === 0 ? (
          <p className="muted">Nothing waiting. 🎉</p>
        ) : (
          <ul className="queue">
            {queue.map((v) => {
              const r = ruleById.get(v.ruleId);
              const c = reactionCounts(v.reactions);
              return (
                <li key={v.id}>
                  <div className="queue-head">
                    {r ? (
                      <a href={href('rules', [r.sid])}>
                        <b className="rule-code">{r.sid}</b> {r.title}
                      </a>
                    ) : (
                      <span className="muted">Deleted rule</span>
                    )}
                    {r?.status === 'suggested' && <span className="tag t-suggestion">New rule</span>}
                  </div>
                  <p className="small muted">
                    by <UserName uid={v.createdBy} fallback={v.createdByName} /> · {timeAgo(v.createdAt)} · 👍 {c.up} 👎 {c.down} ❓ {c.q}
                  </p>
                  <div className="row gap wrap">
                    <button className="small" onClick={() => relabelRuleVersion(v, 'Community')}>
                      Mark Community
                    </button>
                    <button className="small" onClick={() => relabelRuleVersion(v, 'Official Ruling')}>
                      Mark Official Ruling
                    </button>
                    <button className="small danger" onClick={async () => (await confirmDialog({ title: 'Delete suggestion', message: 'Delete this suggested version?', confirmLabel: 'Delete', danger: true })) && attempt(() => deleteDoc(doc(db, 'versions', v.id)), 'Suggestion deleted')}>
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {suggestedRules.length > 0 && <p className="small muted">{suggestedRules.length} suggested new rule(s) — approve them from the rule card on the Rules page (turn on “Show inactive”).</p>}
        <h3 className="queue-title">Card suggestions</h3>
        {cardSuggestions.loading ? (
          <Spinner />
        ) : !cardSuggestions.data?.length ? (
          <p className="muted small">No card suggestions waiting.</p>
        ) : (
          <ul className="queue">
            {[...cardSuggestions.data]
              .sort((a, b) => millis(b.createdAt) - millis(a.createdAt))
              .map((v) => {
                const c = reactionCounts(v.reactions);
                return (
                  <li key={v.id}>
                    <div className="queue-head">
                      <a href={href('components', [v.typeId, v.componentId])} title="Open the card to compare versions and discuss">
                        <b>{v.componentId.split('__').pop()}</b> {v.data?.title || ''}
                      </a>
                      <span className="small muted">changes {Object.keys(v.data || {}).join(', ')}</span>
                    </div>
                    <p className="small muted">
                      by <UserName uid={v.createdBy} fallback={v.createdByName} /> · {timeAgo(v.createdAt)} · 👍 {c.up} 👎 {c.down} ❓ {c.q}
                      {v.note && ` · “${v.note}”`}
                    </p>
                    <div className="row gap wrap">
                      <button className="small" onClick={() => relabelCardVersion(v, 'Community')}>
                        Mark Community
                      </button>
                      <button className="small" onClick={() => relabelCardVersion(v, 'Official Ruling')}>
                        Mark Official Ruling
                      </button>
                      <button
                        className="small danger"
                        onClick={async () =>
                          (await confirmDialog({ title: 'Delete suggestion', message: 'Delete this suggested card version?', confirmLabel: 'Delete', danger: true })) && attempt(() => deleteCardVersion(v.id), 'Suggestion deleted')
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
          </ul>
        )}
      </section>

      <SectionsEditor tree={tree} rules={rules.data || []} loading={sections.loading} />
      <KindsEditor rules={rules.data || []} />
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
  const list = [...(sets.data || [])].sort((a, b) => (a.visibility === 'public' ? 0 : 1) - (b.visibility === 'public' ? 0 : 1) || millis(b.updatedAt) - millis(a.updatedAt));
  const setDefault = (id) => attempt(() => setDoc(doc(db, 'config', 'site'), { defaultRulesetId: id }, { merge: true }), 'Default ruleset updated');

  return (
    <section className="panel">
      <h2>Rulesets</h2>
      <p className="small muted">
        Public rulesets appear for everyone in the ruleset picker. The default ruleset is what visitors see until they pick another. Only public rulesets can be the default.
      </p>
      {sets.loading ? (
        <Spinner />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Default</th>
              <th>Name</th>
              <th>Owner</th>
              <th>Rules</th>
              <th>Updated</th>
              <th>Public</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <input type="radio" name="default-set" checked={site.defaultRulesetId === RULEBOOK_SET.id} onChange={() => setDefault(RULEBOOK_SET.id)} aria-label="Make default" />
              </td>
              <td>
                <b>{RULEBOOK_SET.name}</b>
              </td>
              <td className="muted">built in</td>
              <td className="muted">—</td>
              <td className="muted">always current</td>
              <td>
                <span className="tag t-community">Public</span>
              </td>
              <td />
            </tr>
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
                  <a href={href('rules', [], { set: s.id })}>{s.name}</a>
                  {s.description && <p className="small muted clamp">{s.description}</p>}
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
                      onChange={(e) => {
                        if (!e.target.checked && site.defaultRulesetId === s.id) return alertDialog({ title: 'This is the default', message: 'Choose another default ruleset before making this one private.' });
                        const pub = e.target.checked;
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

function PeopleAdmin() {
  const { user } = useSession();
  const users = useLive(() => collection(db, 'users'), []);
  const admins = useLive(() => collection(db, 'admins'), []);
  const [filter, setFilter] = useState('');
  const adminIds = new Set((admins.data || []).map((a) => a.id));
  const list = [...(users.data || [])]
    .filter((u) => !filter || u.name?.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => (adminIds.has(b.id) ? 1 : 0) - (adminIds.has(a.id) ? 1 : 0) || millis(b.lastSeen) - millis(a.lastSeen));

  const toggle = async (u) => {
    if (adminIds.has(u.id)) {
      if (adminIds.size <= 1) return alertDialog({ title: 'Last admin', message: 'There must be at least one admin.' });
      if (u.id === user.uid && !(await confirmDialog({ title: 'Remove your admin access', message: 'You will lose access to the admin pages. Another admin can give it back.', confirmLabel: 'Remove', danger: true }))) return;
      return attempt(() => deleteDoc(doc(db, 'admins', u.id)), `${u.name} is no longer an admin`);
    }
    return attempt(() => setDoc(doc(db, 'admins', u.id), { name: u.name, addedAt: serverTimestamp(), addedBy: user.uid }), `${u.name} is now an admin`);
  };

  return (
    <section className="panel">
      <h2>People</h2>
      <p className="small muted">Everyone who has logged in. Admins can manage rules, rulesets, components and other admins.</p>
      <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name…" aria-label="Filter people" />
      {users.loading ? (
        <Spinner />
      ) : (
        <ul className="people">
          {list.map((u) => (
            <li key={u.id}>
              <Avatar name={u.name} avatar={u.avatar} photo={u.photo} size={32} />
              <div>
                <b>{u.name}</b> {adminIds.has(u.id) && <span className={`tag t-${LABEL_CLASS['Official Ruling']}`}>Admin</span>}
                <p className="small muted">last seen {timeAgo(u.lastSeen)}</p>
              </div>
              <button className={adminIds.has(u.id) ? 'small danger' : 'small'} onClick={() => toggle(u)}>
                {adminIds.has(u.id) ? 'Remove admin' : 'Make admin'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
