import { useMemo, useState } from 'react';
import { compareValues, deleteComponents, displayTitle, FIELD_KINDS, idField, saveComponent } from '../../lib/components.js';
import { navigate } from '../../lib/router.js';
import { useSession } from '../../lib/session.jsx';
import ComponentCard from '../ComponentCard.jsx';
import { attempt, Icon, Modal } from '../ui.jsx';

const PAGE = 100;

export default function ComponentList({ type, comps, editId, onChanged }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const idf = idField(type);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const l = q ? comps.filter((c) => Object.values(c.data).some((v) => String(typeof v === 'object' ? v?.of ?? '' : v).toLowerCase().includes(q))) : [...comps];
    return l.sort((a, b) => compareValues(a.data[idf?.key], b.data[idf?.key], type));
  }, [comps, search, idf, type]);

  const editing = editId ? comps.find((c) => c.id === editId) : null;
  const closeEditor = () => {
    setCreating(false);
    navigate('admin', ['components', type.id], { tab: 'list' }, { replace: true });
  };

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
            onClick={() => confirm(`Delete ALL ${comps.length} “${type.name}” components? This cannot be undone.`) && attempt(() => deleteComponents(comps.map((c) => c.id)), 'Deleted').then(onChanged)}
          >
            <Icon name="trash" />
            Delete all
          </button>
          <button className="small primary" onClick={() => setCreating(true)} disabled={!idf}>
            <Icon name="plus" />
            New component
          </button>
        </div>
      </div>
      {!idf && <p className="error">Add an ID field to this type first.</p>}
      <input
        type="search"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(0);
        }}
        placeholder="Search…"
        aria-label="Search components"
      />
      <table className="table">
        <thead>
          <tr>
            <th>{idf?.label || 'ID'}</th>
            <th>Title</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {list.slice(page * PAGE, page * PAGE + PAGE).map((c) => (
            <tr key={c.id}>
              <td>
                <code>{String(c.data[idf?.key] ?? '')}</code>
              </td>
              <td>{displayTitle(type, c)}</td>
              <td className="row">
                <button className="icon-btn" aria-label="Edit" onClick={() => navigate('admin', ['components', type.id], { tab: 'list', edit: c.id })}>
                  <Icon name="edit" />
                </button>
                <button className="icon-btn danger" aria-label="Delete" onClick={() => confirm(`Delete “${displayTitle(type, c)}”?`) && attempt(() => deleteComponents([c.id]), 'Deleted').then(onChanged)}>
                  <Icon name="trash" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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

function ComponentForm({ type, comp, comps, onClose, onSaved }) {
  const { shorthands } = useSession();
  const [data, setData] = useState(() => ({ ...(comp?.data || {}) }));
  const [busy, setBusy] = useState(false);
  const idf = idField(type);
  const idValue = String(data[idf.key] ?? '').trim();
  const idTaken = comps.some((c) => c.id !== comp?.id && String(c.data[idf.key]).trim() === idValue);
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const ok = await attempt(() => saveComponent(type, data, comp?.id), 'Component saved');
    setBusy(false);
    if (ok) {
      await onSaved();
      onClose();
    }
  };

  return (
    <Modal title={comp ? `Edit ${displayTitle(type, comp)}` : 'New component'} onClose={onClose} wide>
      <form className="component-form" onSubmit={submit}>
        <div className="cf-fields">
          {type.fields.map((f) => (
            <div className="field" key={f.key}>
              <label htmlFor={`cf-${f.key}`}>
                {f.label} <span className="kind-mini">{FIELD_KINDS[f.kind]?.label}</span>
              </label>
              {f.kind === 'state' ? (
                <div className="row gap">
                  <input
                    id={`cf-${f.key}`}
                    list={`cf-ids-${f.key}`}
                    value={data[f.key]?.of || ''}
                    onChange={(e) => set(f.key, e.target.value ? { of: e.target.value, name: data[f.key]?.name || f.label } : null)}
                    placeholder="ID of the default component (empty = none)"
                  />
                  <datalist id={`cf-ids-${f.key}`}>
                    {comps.slice(0, 2000).map((c) => (
                      <option key={c.id} value={String(c.data[idf.key])}>
                        {displayTitle(type, c)}
                      </option>
                    ))}
                  </datalist>
                  <input value={data[f.key]?.name || ''} onChange={(e) => set(f.key, { of: data[f.key]?.of || '', name: e.target.value })} placeholder="State name, e.g. Flipped" disabled={!data[f.key]?.of} aria-label="State name" />
                </div>
              ) : f.kind === 'ability' || f.kind === 'lore' ? (
                <textarea id={`cf-${f.key}`} rows={3} value={data[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} />
              ) : (
                <input
                  id={`cf-${f.key}`}
                  value={data[f.key] ?? ''}
                  onChange={(e) => set(f.key, f.kind === 'value' && /^-?\d+(\.\d+)?$/.test(e.target.value) ? Number(e.target.value) : e.target.value)}
                  required={f.kind === 'id'}
                  aria-invalid={f.kind === 'id' && idTaken}
                />
              )}
              {f.kind === 'id' && idTaken && <p className="error small">Another component already has this ID.</p>}
            </div>
          ))}
        </div>
        <div className="cf-preview">
          <ComponentCard type={type} comp={{ id: comp?.id || 'new', data }} shorthands={shorthands} />
        </div>
        <div className="modal-actions span-all">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy || !idValue || idTaken}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
