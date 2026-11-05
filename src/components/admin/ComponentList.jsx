import { useMemo, useState } from 'react';
import { compareValues, deleteComponents, displayTitle, FIELD_KINDS, idField } from '../../lib/components.js';
import { navigate } from '../../lib/router.js';
import { useLocalStorage } from '../../lib/hooks.js';
import { fold, toPlainText } from '../../lib/html.js';
import ComponentForm from '../ComponentForm.jsx';
import { attempt, Icon } from '../ui.jsx';
import { confirmDialog } from '../dialogs.jsx';

const PAGE = 100;

const cellText = (f, v) => {
  if (v == null || v === '') return '';
  if (f.kind === 'state') return v.of ? `${v.name || 'State'} of ${v.of}` : '';
  return f.kind === 'ability' || f.kind === 'lore' ? toPlainText(String(v)) : String(v);
};

export default function ComponentList({ type, comps, editId, onChanged }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [sort, setSort] = useState({ key: null, dir: 1 });
  const idf = idField(type);
  // Which columns are shown is remembered per type in this browser.
  const defaultCols = useMemo(() => {
    const keys = type.fields.filter((f) => f.kind === 'id' || f.kind === 'title').map((f) => f.key).slice(0, 2);
    for (const f of type.fields) if (keys.length < 5 && (f.kind === 'type' || f.kind === 'value') && !keys.includes(f.key)) keys.push(f.key);
    return keys;
  }, [type.fields]);
  const [savedCols, setSavedCols] = useLocalStorage(`brv-cols-${type.id}`, null);
  const shownKeys = savedCols || defaultCols;
  const cols = type.fields.filter((f) => shownKeys.includes(f.key));
  const toggleCol = (key) => setSavedCols(shownKeys.includes(key) ? shownKeys.filter((k) => k !== key) : [...shownKeys, key]);

  const sortKey = sort.key || idf?.key;
  const list = useMemo(() => {
    const q = fold(search.trim());
    const l = q ? comps.filter((c) => type.fields.some((f) => fold(cellText(f, c.data[f.key])).includes(q))) : [...comps];
    return l.sort((a, b) => sort.dir * compareValues(a.data[sortKey], b.data[sortKey], type));
  }, [comps, search, type, sort.dir, sortKey]);

  const editing = editId ? comps.find((c) => c.id === editId) : null;
  const closeEditor = () => {
    setCreating(false);
    navigate('admin', ['components', type.id], { tab: 'list' }, { replace: true });
  };
  const sortBy = (key) => setSort((s) => ({ key, dir: (s.key || idf?.key) === key ? -s.dir : 1 }));

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>
          {comps.length} component{comps.length === 1 ? '' : 's'}
        </h2>
        <div className="row gap">
          <button
            className="small danger"
            disabled={!comps.length}
            title="Delete every component of this type (you can undo this)"
            onClick={async () =>
              (await confirmDialog({ title: 'Delete all components', message: `Delete all ${comps.length} “${type.name}” components? You can undo this.`, confirmLabel: 'Delete all', danger: true })) &&
              attempt(() => deleteComponents(comps.map((c) => c.id)), `Deleted ${comps.length} components`).then(onChanged)
            }
          >
            <Icon name="trash" />
            Delete all
          </button>
          <button className="small primary" onClick={() => setCreating(true)} disabled={!idf} title="Add a single component by hand">
            <Icon name="plus" />
            New component
          </button>
        </div>
      </div>
      {!idf && <p className="error">Add an ID field to this type first (Fields &amp; layout).</p>}
      <div className="list-toolbar">
        <div className="search">
          <Icon name="search" />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search all fields…"
            aria-label="Search components"
          />
        </div>
        <details className="menu">
          <summary className="btn small" title="Choose which fields are shown as columns">
            <Icon name="layers" />
            Columns ({cols.length})
          </summary>
          <div className="menu-pop" role="group" aria-label="Visible columns">
            {type.fields.map((f) => (
              <label key={f.key} className="check">
                <input type="checkbox" checked={shownKeys.includes(f.key)} onChange={() => toggleCol(f.key)} />
                {f.label}
                <span className="kind-mini">{FIELD_KINDS[f.kind]?.label}</span>
              </label>
            ))}
            <button type="button" className="link-btn small" onClick={() => setSavedCols(null)} disabled={!savedCols}>
              Reset to default
            </button>
          </div>
        </details>
      </div>
      <div className="table-wrap">
        <table className="table comp-table">
          <thead>
            <tr>
              {cols.map((f) => (
                <th key={f.key} aria-sort={sortKey === f.key ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}>
                  <button type="button" className="th-sort" onClick={() => sortBy(f.key)} title={`Sort by ${f.label}`}>
                    {f.label}
                    {sortKey === f.key && <Icon name={sort.dir > 0 ? 'arrowUp' : 'arrowDown'} size={12} />}
                  </button>
                </th>
              ))}
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {list.slice(page * PAGE, page * PAGE + PAGE).map((c) => (
              <tr key={c.id}>
                {cols.map((f) => {
                  const text = cellText(f, c.data[f.key]);
                  return (
                    <td key={f.key} className={`col-${f.kind}`} title={text.length > 90 ? text : undefined}>
                      {f.kind === 'id' ? <code>{text}</code> : text.length > 90 ? `${text.slice(0, 90)}…` : text}
                    </td>
                  );
                })}
                <td className="actions-cell">
                  <button className="icon-btn" aria-label={`Edit ${displayTitle(type, c)}`} title="Edit" onClick={() => navigate('admin', ['components', type.id], { tab: 'list', edit: c.id })}>
                    <Icon name="edit" />
                  </button>
                  <button
                    className="icon-btn danger"
                    aria-label={`Delete ${displayTitle(type, c)}`}
                    title="Delete"
                    onClick={async () =>
                      (await confirmDialog({ title: 'Delete component', message: `Delete “${displayTitle(type, c)}”?`, confirmLabel: 'Delete', danger: true })) &&
                      attempt(() => deleteComponents([c.id]), `Deleted ${displayTitle(type, c)}`).then(onChanged)
                    }
                  >
                    <Icon name="trash" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length === 0 && <p className="muted">{comps.length ? 'Nothing matches your search.' : 'No components yet. Add one, or import a spreadsheet.'}</p>}
      {list.length > PAGE && (
        <div className="row gap pager">
          <button className="small" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span className="muted small">
            {page * PAGE + 1}–{Math.min(list.length, (page + 1) * PAGE)} of {list.length}
          </span>
          <button className="small" disabled={(page + 1) * PAGE >= list.length} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
      {(editing || creating) && <ComponentForm type={type} comp={editing} comps={comps} onClose={closeEditor} onSaved={onChanged} />}
    </section>
  );
}
