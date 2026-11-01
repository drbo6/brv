import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { useLive } from '../lib/hooks.js';
import { href } from '../lib/router.js';
import { commitInChunks, deleteRuleset, exportRulesBackup, importRulebookSeed, LABEL_CLASS, millis, reactionCounts, RULEBOOK_SET, sectionTree, updateRuleset, updateVersion } from '../lib/rules.js';
import { plainToHtml } from '../lib/html.js';
import { useSession } from '../lib/session.jsx';
import { attempt, Avatar, Empty, Icon, Spinner, timeAgo } from '../components/ui.jsx';

const ComponentsAdmin = lazy(() => import('../components/admin/ComponentsAdmin.jsx'));

const TABS = [
  { id: 'chat', label: 'Admin chat' },
  { id: 'rules', label: 'Rules' },
  { id: 'rulesets', label: 'Rulesets' },
  { id: 'components', label: 'Components' },
  { id: 'people', label: 'People' },
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
    await attempt(() => addDoc(collection(db, 'adminChat'), { uid: user.uid, name: user.displayName || 'Admin', photo: user.photoURL || '', text: body, createdAt: serverTimestamp() }));
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
                {!grouped && <Avatar name={m.name} photo={m.photo} size={30} />}
                <div className="chat-bubble">
                  {!grouped && (
                    <div className="chat-meta">
                      <b>{m.name}</b> <span className="muted">{timeAgo(m.createdAt)}</span>
                    </div>
                  )}
                  <p dangerouslySetInnerHTML={{ __html: plainToHtml(m.text) }} />
                </div>
                {m.uid === user.uid && (
                  <button className="icon-btn chat-del" aria-label="Delete message" onClick={() => attempt(() => deleteDoc(doc(db, 'adminChat', m.id)))}>
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
  const [busy, setBusy] = useState(false);
  const tree = useMemo(() => sectionTree(sections.data || []), [sections.data]);
  const ruleById = useMemo(() => new Map((rules.data || []).map((r) => [r.id, r])), [rules.data]);

  const importSeed = async () => {
    const hasRules = (rules.data || []).length > 0;
    if (!confirm(hasRules ? `There are already ${rules.data.length} rules. Importing again will add duplicates. Continue?` : 'Import the transcribed rulebook?')) return;
    setBusy(true);
    const seed = (await import('../data/rulebook-seed.json')).default;
    await attempt(() => importRulebookSeed(seed, user), `Imported ${seed.rules.length} rules`);
    setBusy(false);
  };

  const backup = async () => {
    setBusy(true);
    const data = await attempt(exportRulesBackup);
    setBusy(false);
    if (!data) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `brv-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const suggestedRules = (rules.data || []).filter((r) => r.status === 'suggested');
  const queue = [...(suggestions.data || [])].sort((a, b) => millis(b.createdAt) - millis(a.createdAt));

  return (
    <div className="admin-grid">
      <section className="panel">
        <h2>Suggestions queue</h2>
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
                      <a href={href('rules', [r.code])}>
                        <b>{r.code}</b> {r.title}
                      </a>
                    ) : (
                      <span className="muted">Deleted rule</span>
                    )}
                    {r?.status === 'suggested' && <span className="tag t-suggestion">New rule</span>}
                  </div>
                  <p className="small muted">
                    by {v.createdByName} · {timeAgo(v.createdAt)} · 👍 {c.up} 👎 {c.down} ❓ {c.q}
                  </p>
                  <div className="row gap wrap">
                    <button className="small" onClick={() => attempt(() => updateVersion(v.id, { label: 'Community' }), 'Labeled Community')}>
                      Mark Community
                    </button>
                    <button className="small" onClick={() => attempt(() => updateVersion(v.id, { label: 'Official Ruling' }), 'Labeled Official Ruling')}>
                      Mark Official Ruling
                    </button>
                    <button className="small danger" onClick={() => confirm('Delete this suggestion?') && attempt(() => deleteDoc(doc(db, 'versions', v.id)), 'Deleted')}>
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {suggestedRules.length > 0 && <p className="small muted">{suggestedRules.length} suggested new rule(s) — approve them from the rule card on the Rules page (turn on “Show inactive”).</p>}
      </section>

      <section className="panel">
        <h2>Rulebook data</h2>
        <p className="small muted">
          {rules.data ? `${rules.data.length} rules in ${tree.ordered.length} sections.` : 'Loading…'} The transcribed rulebook ships with the site and can be imported once.
        </p>
        <div className="row gap wrap">
          <button className={rules.data?.length ? '' : 'primary'} onClick={importSeed} disabled={busy || rules.loading}>
            <Icon name="upload" />
            Import transcribed rulebook
          </button>
          <button onClick={backup} disabled={busy}>
            <Icon name="download" />
            Download JSON backup
          </button>
        </div>
      </section>

      <SectionsEditor tree={tree} rules={rules.data || []} loading={sections.loading} />
    </div>
  );
}

function SectionsEditor({ tree, rules, loading }) {
  const [adding, setAdding] = useState({ code: '', title: '', parent: '' });
  const codes = new Set(tree.ordered.map((s) => s.code));
  const ruleCount = (id) => rules.filter((r) => r.sectionId === id).length;

  const move = (s, delta) => {
    const siblings = tree.children.get(s.parent && tree.byId.has(s.parent) ? s.parent : null) || [];
    const i = siblings.findIndex((x) => x.id === s.id);
    const j = i + delta;
    if (j < 0 || j >= siblings.length) return;
    const list = [...siblings];
    [list[i], list[j]] = [list[j], list[i]];
    return attempt(() => commitInChunks(list.map((x, k) => (b) => b.update(doc(db, 'sections', x.id), { order: k + 1 }))));
  };

  const add = async (e) => {
    e.preventDefault();
    const code = adding.code.trim().toUpperCase();
    if (codes.has(code)) return alert('That section code is already used.');
    const siblings = tree.children.get(adding.parent || null) || [];
    const ok = await attempt(() => setDoc(doc(db, 'sections', code), { code, title: adding.title.trim(), parent: adding.parent || null, order: siblings.length + 1 }), 'Section added');
    if (ok) setAdding({ code: '', title: '', parent: '' });
  };

  return (
    <section className="panel span-2">
      <h2>Sections</h2>
      <p className="small muted">
        Section codes prefix new rule IDs (e.g. <code>SUM</code> → <code>SUM.7</code>). Existing rule IDs never change when sections are renamed or reordered, so links and discussions stay valid.
      </p>
      {loading ? (
        <Spinner />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Code</th>
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
                <td>
                  <input
                    className="mini"
                    defaultValue={s.code}
                    aria-label="Code"
                    onBlur={(e) => {
                      const v = e.target.value.trim().toUpperCase();
                      if (v && v !== s.code) {
                        if (codes.has(v)) {
                          alert('That code is already used.');
                          e.target.value = s.code;
                        } else attempt(() => updateDoc(doc(db, 'sections', s.id), { code: v }));
                      }
                    }}
                  />
                </td>
                <td style={{ paddingLeft: 8 + s.depth * 18 }}>
                  <input defaultValue={s.title} aria-label="Title" onBlur={(e) => e.target.value.trim() && e.target.value !== s.title && attempt(() => updateDoc(doc(db, 'sections', s.id), { title: e.target.value.trim() }))} />
                </td>
                <td>
                  <select
                    value={s.parent || ''}
                    aria-label="Parent section"
                    onChange={(e) => {
                      const parent = e.target.value || null;
                      const order = (tree.children.get(parent) || []).length + 1;
                      attempt(() => updateDoc(doc(db, 'sections', s.id), { parent, order }));
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
                    onClick={() => confirm(`Delete section ${s.title}?`) && attempt(() => deleteDoc(doc(db, 'sections', s.id)))}
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
        <input value={adding.code} onChange={(e) => setAdding({ ...adding, code: e.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 6) })} placeholder="Code (e.g. FAQ)" required aria-label="New section code" className="mini" />
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
  const { site } = useSession();
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
                <td>{s.ownerName}</td>
                <td>{Object.keys(s.entries || {}).length}</td>
                <td className="muted">{timeAgo(s.updatedAt)}</td>
                <td>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={s.visibility === 'public'}
                      onChange={(e) => {
                        if (!e.target.checked && site.defaultRulesetId === s.id) return alert('Choose another default ruleset first.');
                        attempt(() => updateRuleset(s.id, { visibility: e.target.checked ? 'public' : 'private' }));
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
                    onClick={() => confirm(`Delete “${s.name}” by ${s.ownerName}?`) && attempt(() => deleteRuleset(s.id), 'Deleted')}
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

  const toggle = (u) => {
    if (adminIds.has(u.id)) {
      if (u.id === user.uid && !confirm('Remove your own admin access?')) return;
      if (adminIds.size <= 1) return alert('There must be at least one admin.');
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
              <Avatar name={u.name} photo={u.photo} size={32} />
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
