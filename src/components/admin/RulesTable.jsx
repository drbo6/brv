import { useMemo, useState } from 'react';
import { collection, doc } from 'firebase/firestore';
import { db } from '../../lib/firebase.js';
import { useLive, useLocalStorage } from '../../lib/hooks.js';
import { href } from '../../lib/router.js';
import { deleteRule, groupVersions, kindInfo, millis, shortIds, sortRules, updateRule } from '../../lib/rules.js';
import { commitInChunks } from '../../lib/store.js';
import { useSession } from '../../lib/session.jsx';
import { attempt, Icon, Spinner, timeAgo } from '../ui.jsx';
import { confirmDialog } from '../dialogs.jsx';
import RuleEditor from './RuleEditor.jsx';

const STATUSES = { active: 'Active', suggested: 'Suggested', rejected: 'Rejected' };

const COLUMNS = [
  { id: 'sid', label: 'Id' },
  { id: 'section', label: 'Section' },
  { id: 'title', label: 'Title' },
  { id: 'kind', label: 'Kind' },
  { id: 'status', label: 'Status' },
  { id: 'page', label: 'Page' },
  { id: 'versions', label: 'Versions' },
  { id: 'comments', label: 'Comments' },
  { id: 'activity', label: 'Last activity' },
];
const DEFAULT_COLS = ['sid', 'section', 'title', 'kind', 'status', 'versions', 'comments'];

/**
 * All rules in a table, for bulk work on their details (section, kind, status, page, title).
 * Rule text and versions are edited on the Rules page.
 */
export default function RulesTable({ tree }) {
  const { kinds } = useSession();
  const rules = useLive(() => collection(db, 'rules'), []);
  const versions = useLive(() => collection(db, 'versions'), []);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState({ section: '', kind: '', status: '' });
  const [sort, setSort] = useState({ key: null, dir: 1 });
  const [picked, setPicked] = useState(() => new Set());
  const [editId, setEditId] = useState(null);
  const [savedCols, setSavedCols] = useLocalStorage('brv-rule-cols', null);
  const cols = COLUMNS.filter((c) => (savedCols || DEFAULT_COLS).includes(c.id));
  const toggleCol = (id) => {
    const cur = savedCols || DEFAULT_COLS;
    setSavedCols(cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id]);
  };

  const vByRule = useMemo(() => groupVersions(versions.data || []), [versions.data]);
  const rows = useMemo(() => {
    const sids = shortIds(rules.data || []);
    // Book order: by section, then by position in the section.
    const sectionRank = new Map(tree.ordered.map((s, i) => [s.id, i]));
    return sortRules(rules.data || [])
      .map((r, i) => {
        const vs = vByRule.get(r.id) || [];
        const sec = tree.byId.get(r.sectionId);
        return {
          rule: r,
          sid: sids.get(r.id),
          section: sec ? `${sec.number} ${sec.title}` : 'Unsorted',
          bookOrder: (sectionRank.get(r.sectionId) ?? 9999) * 10000 + i,
          versions: vs.length,
          comments: r.commentCount || 0,
          activity: Math.max(millis(r.createdAt), ...vs.map((v) => Math.max(millis(v.createdAt), millis(v.updatedAt)))),
        };
      })
      .sort((a, b) => a.bookOrder - b.bookOrder);
  }, [rules.data, vByRule, tree]);

  const valueOf = (row, key) =>
    ({
      sid: row.sid,
      section: row.bookOrder,
      title: row.rule.title.toLowerCase(),
      kind: kindInfo(kinds, row.rule.kind).label.toLowerCase(),
      status: row.rule.status || 'active',
      page: row.rule.page ?? 9999,
      versions: row.versions,
      comments: row.comments,
      activity: row.activity,
    })[key];

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = rows.filter(
      (row) =>
        (!q || `${row.sid} ${row.rule.title}`.toLowerCase().includes(q)) &&
        (!filter.section || row.rule.sectionId === filter.section) &&
        (!filter.kind || (row.rule.kind || 'rule') === filter.kind) &&
        (!filter.status || (row.rule.status || 'active') === filter.status),
    );
    if (sort.key) out.sort((a, b) => (valueOf(a, sort.key) > valueOf(b, sort.key) ? 1 : valueOf(a, sort.key) < valueOf(b, sort.key) ? -1 : 0) * sort.dir);
    return out;
  }, [rows, search, filter, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const sortBy = (key) => setSort((s) => (s.key === key ? (s.dir === 1 ? { key, dir: -1 } : { key: null, dir: 1 }) : { key, dir: 1 }));
  const allPicked = list.length > 0 && list.every((r) => picked.has(r.rule.id));
  const pick = (id, on) =>
    setPicked((p) => {
      const n = new Set(p);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  // Moving rules to another section puts them at its end, in their current order.
  const nextOrder = (sectionId) => (rules.data || []).filter((r) => r.sectionId === sectionId).reduce((m, r) => Math.max(m, r.order ?? 0), 0) + 1;
  const patchFor = (field, value, index = 0, base = 0) => (field === 'sectionId' ? { sectionId: value, order: base + index } : { [field]: value });

  const setOne = (rule, field, value) => {
    if ((rule[field] ?? '') === value) return;
    return attempt(() => updateRule(rule.id, patchFor(field, value, 0, field === 'sectionId' ? nextOrder(value) : 0)), null, `rule ${field === 'sectionId' ? 'section' : field}`);
  };

  const [bulk, setBulk] = useState({ field: 'kind', value: '' });
  const applyBulk = () => {
    const ids = list.filter((r) => picked.has(r.rule.id)).map((r) => r.rule.id);
    if (!ids.length || !bulk.value) return;
    const base = bulk.field === 'sectionId' ? nextOrder(bulk.value) : 0;
    const label = { sectionId: 'section', kind: 'kind', status: 'status' }[bulk.field];
    return attempt(
      () => commitInChunks(ids.map((id, i) => (b) => b.update(doc(db, 'rules', id), patchFor(bulk.field, bulk.value, i, base)))),
      `Changed the ${label} of ${ids.length} rule${ids.length === 1 ? '' : 's'}`,
    ).then((ok) => ok && setPicked(new Set()));
  };

  /** Delete the ticked rules with their versions and discussion, as one action that can be undone. */
  const deleteSelected = async () => {
    const rows = list.filter((r) => picked.has(r.rule.id));
    if (!rows.length) return;
    const comments = rows.reduce((n, r) => n + (r.rule.commentCount || 0), 0);
    const ok = await confirmDialog({
      title: `Delete ${rows.length} rule${rows.length === 1 ? '' : 's'}`,
      message: `Delete ${rows.length === 1 ? `“${rows[0].rule.title}”` : `these ${rows.length} rules`} with all ${rows.length === 1 ? 'its' : 'their'} versions${
        comments ? ` and ${comments} comment${comments === 1 ? '' : 's'}` : ''
      }? You can undo this.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const done = await attempt(async () => {
      for (const r of rows) await deleteRule(r.rule.id);
      return true;
    }, `Deleted ${rows.length} rule${rows.length === 1 ? '' : 's'}`);
    if (done) setPicked(new Set());
  };

  const sectionSelect = (value, onChange, props = {}) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} {...props}>
      {props.placeholder && <option value="">{props.placeholder}</option>}
      {tree.ordered.map((s) => (
        <option key={s.id} value={s.id}>
          {'  '.repeat(s.depth)}
          {s.number} {s.title}
        </option>
      ))}
    </select>
  );
  const kindSelect = (value, onChange, props = {}) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} {...props}>
      {props.placeholder && <option value="">{props.placeholder}</option>}
      {kinds.map((k) => (
        <option key={k.id} value={k.id}>
          {k.label}
        </option>
      ))}
    </select>
  );
  const statusSelect = (value, onChange, props = {}) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} {...props}>
      {props.placeholder && <option value="">{props.placeholder}</option>}
      {Object.entries(STATUSES).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  );

  if (rules.loading || versions.loading) return <Spinner />;
  // Live: the editor follows the rule as it is saved, and closes if it is deleted.
  const editRow = editId && rows.find((x) => x.rule.id === editId);
  const nPicked = list.filter((r) => picked.has(r.rule.id)).length;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          {list.length === rows.length ? `${rows.length} rules` : `${list.length} of ${rows.length} rules`}
        </h2>
      </div>
      <p className="small muted">Change a rule's section, kind, status, page or title right in the table, or select several and change them together. Rule text and versions are edited on the Rules page.</p>

      <div className="list-toolbar">
        <div className="search">
          <Icon name="search" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ids and titles…" aria-label="Search rules" />
        </div>
        {sectionSelect(filter.section, (v) => setFilter({ ...filter, section: v }), { placeholder: 'All sections', 'aria-label': 'Filter by section' })}
        {kindSelect(filter.kind, (v) => setFilter({ ...filter, kind: v }), { placeholder: 'All kinds', 'aria-label': 'Filter by kind' })}
        {statusSelect(filter.status, (v) => setFilter({ ...filter, status: v }), { placeholder: 'Any status', 'aria-label': 'Filter by status' })}
        <details className="menu">
          <summary className="btn small" title="Choose which columns are shown">
            <Icon name="layers" />
            Columns ({cols.length})
          </summary>
          <div className="menu-pop" role="group" aria-label="Visible columns">
            {COLUMNS.map((c) => (
              <label key={c.id} className="check">
                <input type="checkbox" checked={cols.includes(c)} onChange={() => toggleCol(c.id)} />
                {c.label}
              </label>
            ))}
            <button type="button" className="link-btn small" onClick={() => setSavedCols(null)} disabled={!savedCols}>
              Reset to default
            </button>
          </div>
        </details>
      </div>

      {nPicked > 0 && (
        <div className="bulk-bar" role="group" aria-label="Change selected rules">
          <b>
            {nPicked} selected
          </b>
          <select value={bulk.field} onChange={(e) => setBulk({ field: e.target.value, value: '' })} aria-label="What to change">
            <option value="kind">Set kind</option>
            <option value="sectionId">Move to section</option>
            <option value="status">Set status</option>
          </select>
          {bulk.field === 'kind'
            ? kindSelect(bulk.value, (v) => setBulk({ ...bulk, value: v }), { placeholder: 'Choose…', 'aria-label': 'Kind' })
            : bulk.field === 'sectionId'
              ? sectionSelect(bulk.value, (v) => setBulk({ ...bulk, value: v }), { placeholder: 'Choose…', 'aria-label': 'Section' })
              : statusSelect(bulk.value, (v) => setBulk({ ...bulk, value: v }), { placeholder: 'Choose…', 'aria-label': 'Status' })}
          <button className="small primary" onClick={applyBulk} disabled={!bulk.value}>
            Apply
          </button>
          <button className="small danger" onClick={deleteSelected} title="Delete the selected rules with their versions and discussion (can be undone)">
            <Icon name="trash" />
            Delete
          </button>
          <button className="small" onClick={() => setPicked(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      <div className="table-wrap">
        <table className="table comp-table rules-table">
          <thead>
            <tr>
              <th className="pick-cell">
                <input
                  type="checkbox"
                  checked={allPicked}
                  onChange={(e) => setPicked(e.target.checked ? new Set([...picked, ...list.map((r) => r.rule.id)]) : new Set([...picked].filter((id) => !list.some((r) => r.rule.id === id))))}
                  aria-label="Select all shown rules"
                />
              </th>
              {cols.map((c) => (
                <th key={c.id} aria-sort={sort.key === c.id ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}>
                  <button type="button" className="th-sort" onClick={() => sortBy(c.id)} title={`Sort by ${c.label.toLowerCase()} (click again to reverse, a third time for book order)`}>
                    {c.label}
                    {sort.key === c.id && <Icon name={sort.dir > 0 ? 'arrowUp' : 'arrowDown'} size={12} />}
                  </button>
                </th>
              ))}
              <th aria-label="Edit" />
            </tr>
          </thead>
          <tbody>
            {list.map((row) => {
              const r = row.rule;
              return (
                <tr key={r.id} className={picked.has(r.id) ? 'picked' : ''}>
                  <td className="pick-cell">
                    <input type="checkbox" checked={picked.has(r.id)} onChange={(e) => pick(r.id, e.target.checked)} aria-label={`Select ${row.sid}`} />
                  </td>
                  {cols.map((c) => (
                    <td key={c.id} className={`col-${c.id}`}>
                      {c.id === 'sid' ? (
                        <a href={href('rules', [row.sid])} className="rule-code" title="Open on the Rules page">
                          {row.sid}
                        </a>
                      ) : c.id === 'section' ? (
                        sectionSelect(r.sectionId, (v) => setOne(r, 'sectionId', v), { 'aria-label': `Section of ${row.sid}` })
                      ) : c.id === 'title' ? (
                        <input key={r.title} defaultValue={r.title} aria-label={`Title of ${row.sid}`} onBlur={(e) => e.target.value.trim() && setOne(r, 'title', e.target.value.trim())} />
                      ) : c.id === 'kind' ? (
                        kindSelect(r.kind || 'rule', (v) => setOne(r, 'kind', v), { 'aria-label': `Kind of ${row.sid}` })
                      ) : c.id === 'status' ? (
                        statusSelect(r.status || 'active', (v) => setOne(r, 'status', v), { 'aria-label': `Status of ${row.sid}` })
                      ) : c.id === 'page' ? (
                        <input
                          key={r.page ?? ''}
                          className="mini"
                          type="number"
                          min="0"
                          defaultValue={r.page ?? ''}
                          aria-label={`Rulebook page of ${row.sid}`}
                          onBlur={(e) => setOne(r, 'page', e.target.value === '' ? null : Number(e.target.value))}
                        />
                      ) : c.id === 'activity' ? (
                        <span className="muted small">{row.activity ? timeAgo(row.activity) : '—'}</span>
                      ) : (
                        row[c.id]
                      )}
                    </td>
                  ))}
                  <td className="actions-cell">
                    <button className="icon-btn" onClick={() => setEditId(r.id)} title="Edit everything about this rule: details and all its versions" aria-label={`Edit ${row.sid}`}>
                      <Icon name="edit" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {list.length === 0 && <p className="muted">No rules match.</p>}
      {editRow && (
        <RuleEditor
          rule={{ ...editRow.rule, sid: editRow.sid }}
          versions={vByRule.get(editRow.rule.id) || []}
          tree={tree}
          rules={rows.map((x) => ({ ...x.rule, sid: x.sid }))}
          onClose={() => setEditId(null)}
        />
      )}
    </section>
  );
}
