import { useMemo, useState } from 'react';
import { collection, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { useLive } from '../lib/hooks.js';
import { href } from '../lib/router.js';
import { findVersion, groupVersions, LABEL_CLASS, rulebookEntries, sectionTree, shortIds, sortRules } from '../lib/rules.js';
import { withHomebrew } from '../lib/homebrew.js';
import { setDoc } from '../lib/store.js';
import { toPlainText } from '../lib/html.js';
import { useSession } from '../lib/session.jsx';
import { useActiveRuleset } from './ActiveRuleset.jsx';
import { attempt, Icon, Modal, RichText } from './ui.jsx';

// componentRules/{componentId} → { rules: [ruleId, …] }: the rules attached to a card, in order.

/**
 * The rules attached to a card, each in the version the active ruleset uses. Editors attach,
 * reorder and detach them.
 */
export default function AttachedRules({ compId, name }) {
  const { isEditor, user } = useSession();
  const rs = useActiveRuleset();
  const attached = useLive(() => doc(db, 'componentRules', compId), [compId]);
  const rules = useLive(() => collection(db, 'rules'), []);
  const versions = useLive(() => collection(db, 'versions'), []);
  const sections = useLive(() => collection(db, 'sections'), []);
  const [picking, setPicking] = useState(false);

  const ids = attached.data?.rules || [];
  // The reader's homebrew versions count too, when their ruleset uses them.
  const vByRule = useMemo(() => groupVersions(withHomebrew(rs.myHomebrew, [], versions.data || []).versions), [rs.myHomebrew, versions.data]);
  const all = useMemo(() => {
    const sids = shortIds(rules.data || []);
    return (rules.data || []).map((r) => ({ ...r, sid: sids.get(r.id) }));
  }, [rules.data]);
  const byId = useMemo(() => new Map(all.map((r) => [r.id, r])), [all]);
  // The active ruleset decides which version of each attached rule is shown.
  const { apply, selectedSet } = rs;
  const entries = useMemo(
    () => apply(selectedSet.builtIn ? rulebookEntries(all, vByRule) : selectedSet.entries || {}, 'rules'),
    [apply, selectedSet, all, vByRule],
  );

  const save = (next, message) =>
    attempt(() => setDoc(doc(db, 'componentRules', compId), { rules: next, updatedBy: user.uid, updatedAt: serverTimestamp() }), message);
  const move = (i, d) => {
    const next = [...ids];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    return save(next, null);
  };

  if (attached.loading || rules.loading || versions.loading) return null;
  const list = ids.map((id) => byId.get(id)).filter(Boolean);
  if (!list.length && !isEditor) return null;

  return (
    <section className="attached-rules" aria-label="Rules for this card">
      <div className="attached-head">
        <h3>Rules for this card</h3>
        {isEditor && (
          <button className="chip" onClick={() => setPicking(true)} title="Attach a rule that explains or clarifies this card">
            <Icon name="plus" />
            Attach rule
          </button>
        )}
      </div>
      {!list.length && <p className="small muted">No rules attached yet. Attach the rules that explain or clarify this card.</p>}
      {list.map((r, i) => {
        const vs = vByRule.get(r.id) || [];
        const v = findVersion(vs, entries[r.id]);
        const shown = v || vs.find((x) => x.label === 'Rulebook') || vs[0];
        return (
          <article key={r.id} className="attached-rule">
            <header>
              <a href={href('rules', [r.sid])} className="rule-code" title="Open on the Rules page">
                {r.sid}
              </a>
              <a href={href('rules', [r.sid])} className="attached-title">
                {r.title}
              </a>
              {shown && shown.label !== 'Rulebook' && <span className={`label l-${LABEL_CLASS[shown.label] || 'other'}`}>{shown.label}</span>}
              {!v && <span className="tag t-muted" title={`Not part of “${selectedSet.name}”`}>Not in ruleset</span>}
              {isEditor && (
                <span className="attached-tools">
                  <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${r.sid} up`} title="Move up">
                    <Icon name="chevronUp" />
                  </button>
                  <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label={`Move ${r.sid} down`} title="Move down">
                    <Icon name="chevronDown" />
                  </button>
                  <button className="icon-btn danger" onClick={() => save(ids.filter((x) => x !== r.id), `Detached ${r.sid} from ${name}`)} aria-label={`Detach ${r.sid}`} title="Detach from this card">
                    <Icon name="x" />
                  </button>
                </span>
              )}
            </header>
            {shown && <RichText html={shown.text} className="rule-text" />}
          </article>
        );
      })}
      {picking && (
        <RulePicker
          rules={all}
          sections={sections.data || []}
          vByRule={vByRule}
          exclude={new Set(ids)}
          onClose={() => setPicking(false)}
          onPick={(id) => {
            setPicking(false);
            save([...ids, id], `Attached ${byId.get(id)?.sid} to ${name}`);
          }}
        />
      )}
    </section>
  );
}

/** Search rules by id, title, section or text and pick one. */
function RulePicker({ rules, sections, vByRule, exclude, onPick, onClose }) {
  const [q, setQ] = useState('');
  const tree = useMemo(() => sectionTree(sections), [sections]);
  const items = useMemo(
    () =>
      sortRules(rules.filter((r) => r.status !== 'rejected' && !exclude.has(r.id))).map((r) => {
        const sec = tree.byId.get(r.sectionId);
        const where = sec ? `${sec.number} ${sec.title}` : '';
        const text = (vByRule.get(r.id) || []).map((v) => toPlainText(v.text)).join(' ');
        return { r, where, search: `${r.sid} ${r.title} ${where} ${text}`.toLowerCase() };
      }),
    [rules, exclude, tree, vByRule],
  );
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = (tokens.length ? items.filter((it) => tokens.every((t) => it.search.includes(t))) : items).slice(0, 60);
  return (
    <Modal title="Attach a rule" onClose={onClose} className="rule-picker">
      <div className="search">
        <Icon name="search" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search rules by id, title, section or text…" aria-label="Search rules" autoFocus />
      </div>
      {results.length === 0 ? (
        <p className="muted">Nothing matches.</p>
      ) : (
        <ul className="picker-results">
          {results.map(({ r, where }) => (
            <li key={r.id}>
              <button type="button" onClick={() => onPick(r.id)}>
                <span>
                  <span className="rule-code">{r.sid}</span> {r.title}
                </span>
                <span className="muted small">{where}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
