import { useEffect, useMemo, useRef, useState } from 'react';
import { ALIGNS, cardLayout, currentTypeRev, DEFAULT_CELL, DEFAULT_ROW, deleteType, FIELD_KINDS, isEmptyValue, newField, saveType, SIZES } from '../../lib/components.js';
import { useDraftHistory, useUndoScope } from '../../lib/history.js';
import { navigate } from '../../lib/router.js';
import { useSession } from '../../lib/session.jsx';
import ComponentCard from '../ComponentCard.jsx';
import { attempt, Icon, Modal } from '../ui.jsx';
import { alertDialog, confirmDialog } from '../dialogs.jsx';

const clone = (x) => JSON.parse(JSON.stringify(x));
// The editor always works on an explicit layout, even for types that still use the automatic one.
// Compares saved and edited types regardless of key order (Firestore may return maps reordered).
const stable = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]])) : v));
const same = (a, b) => stable(a) === stable(b);

const editable = (type) => ({ ...clone(type), layout: cardLayout(type) });

const ASPECTS = [
  ['Poker card', 63 / 88],
  ['Tarot card', 70 / 120],
  ['Square', 1],
  ['Landscape', 88 / 63],
];

// ---------- pure layout edits ----------

const locate = (layout, key) => {
  for (let r = 0; r < layout.rows.length; r++) {
    const c = layout.rows[r].cells.findIndex((x) => x.key === key);
    if (c >= 0) return [r, c];
  }
  return null;
};

const withoutCell = (layout, key) => ({ rows: layout.rows.map((r) => ({ ...r, cells: r.cells.filter((c) => c.key !== key) })) });
const dropEmptyRows = (layout) => ({ rows: layout.rows.filter((r) => r.cells.length) });

/** Place `cell` in row `row` before index `index`; `newRow: true` inserts a new row at position `row`. */
function placeCell(layout, cell, { row, index = Infinity, newRow = false }) {
  const from = locate(layout, cell.key);
  let rows = withoutCell(layout, cell.key).rows;
  if (newRow) rows = [...rows.slice(0, row), { ...DEFAULT_ROW, cells: [cell] }, ...rows.slice(row)];
  else {
    // Moving right within the same row: the removal shifted the target left by one.
    const i = from && from[0] === row && from[1] < index ? index - 1 : index;
    rows = rows.map((r, ri) => (ri === row ? { ...r, cells: [...r.cells.slice(0, i), cell, ...r.cells.slice(i)] } : r));
  }
  return dropEmptyRows({ rows });
}

export default function TypeEditor({ type, comps, allComponents, onSaved }) {
  const { shorthands } = useSession();
  const base = useMemo(() => editable(type), [type]);
  const [draft, setDraft, history] = useDraftHistory(() => editable(type));
  useUndoScope(history);
  const [selected, setSelected] = useState(() => draft.layout.rows[0]?.cells[0]?.key || draft.fields[0]?.key || null);
  const [sampleId, setSampleId] = useState(comps[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(null);
  const dirty = !same({ ...draft, rev: 0 }, { ...base, rev: 0 });

  // When the saved type changes underneath us (save, undo, redo) and there are no local edits, follow it.
  // Our own save comes back the same way; `justSaved` is what we wrote, so it isn't taken for someone else's.
  const prevBase = useRef(base);
  const justSaved = useRef(null);
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    if (prevBase.current !== base && !same(prevBase.current, base)) {
      if (same(draft, prevBase.current) || (justSaved.current && same(justSaved.current, base))) history.reset(clone(base));
      else if (!same(draft, base)) setConflict(true);
      justSaved.current = null;
    }
    prevBase.current = base;
  }, [base]); // eslint-disable-line react-hooks/exhaustive-deps

  const sample = comps.find((c) => c.id === sampleId) || comps[0] || { id: 'sample', data: Object.fromEntries(draft.fields.map((f) => [f.key, f.kind === 'image' ? '' : f.kind === 'value' ? 3 : f.label])) };
  const fieldOf = useMemo(() => new Map(draft.fields.map((f) => [f.key, f])), [draft.fields]);
  const placed = new Set(draft.layout.rows.flatMap((r) => r.cells.map((c) => c.key)));
  const placeable = draft.fields.filter((f) => f.kind !== 'id' && f.kind !== 'state');
  const unplaced = placeable.filter((f) => !placed.has(f.key));

  const setType = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setLayout = (fn) => setDraft((d) => ({ ...d, layout: fn(d.layout) }));
  const setField = (key, patch) => setDraft((d) => ({ ...d, fields: d.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)) }));
  const setCell = (key, patch) => setLayout((l) => ({ rows: l.rows.map((r) => ({ ...r, cells: r.cells.map((c) => (c.key === key ? { ...c, ...patch } : c)) })) }));
  const setRow = (ri, patch) => setLayout((l) => ({ rows: l.rows.map((r, i) => (i === ri ? { ...r, ...patch } : r)) }));
  const moveRow = (ri, d) =>
    setLayout((l) => {
      const rows = [...l.rows];
      const j = ri + d;
      if (j < 0 || j >= rows.length) return l;
      [rows[ri], rows[j]] = [rows[j], rows[ri]];
      return { rows };
    });
  const cellOf = (key) => {
    const at = locate(draft.layout, key);
    return at ? draft.layout.rows[at[0]].cells[at[1]] : { ...DEFAULT_CELL, key };
  };
  const place = (key, target) => setLayout((l) => placeCell(l, cellOf(key), target));

  // ----- drag and drop -----
  const dragProps = (key) => ({
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.setData('text/plain', key);
      e.dataTransfer.effectAllowed = 'move';
      setDrag(key);
    },
    onDragEnd: () => setDrag(null),
  });
  const dropProps = (target) => ({
    onDragOver: (e) => {
      if (!drag) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.classList.add('drop-on');
    },
    onDragLeave: (e) => e.currentTarget.classList.remove('drop-on'),
    onDrop: (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.classList.remove('drop-on');
      const key = e.dataTransfer.getData('text/plain') || drag;
      if (key) place(key, target);
      setDrag(null);
      setSelected(key);
    },
  });

  const accentValues = useMemo(() => {
    if (!draft.accentField) return [];
    const vals = new Set(Object.keys(draft.accentColors || {}));
    for (const c of comps) if (!isEmptyValue(c.data[draft.accentField], draft)) vals.add(String(c.data[draft.accentField]));
    return [...vals].sort();
  }, [draft, comps]);

  const save = async () => {
    if (draft.fields.filter((f) => f.kind === 'id').length !== 1) return alertDialog({ title: 'ID field needed', message: 'A component type needs exactly one field of kind ID: it identifies each component and matches rows on import.' });
    setBusy(true);
    // Someone else may have saved this type since we loaded it.
    const current = await currentTypeRev(type.id).catch(() => base.rev || 0);
    if (current !== (base.rev || 0)) {
      const overwrite = await confirmDialog({
        title: 'Someone else changed this type',
        message: 'Another admin saved changes to this component type after you started editing. Saving now replaces their changes with yours.',
        confirmLabel: 'Save mine anyway',
        danger: true,
      });
      if (!overwrite) return setBusy(false);
    }
    justSaved.current = { ...draft, rev: current + 1 };
    const ok = await attempt(() => saveType(justSaved.current), 'Component type saved');
    setBusy(false);
    if (!ok) justSaved.current = null;
    if (ok) onSaved();
  };

  const addField = ({ label, kind, onCard }) => {
    const f = newField(label, kind, draft.fields.map((x) => x.key));
    setDraft((d) => ({
      ...d,
      fields: [...d.fields, f],
      layout: onCard && kind !== 'id' && kind !== 'state' ? placeCell(d.layout, { ...DEFAULT_CELL, key: f.key }, { row: d.layout.rows.length, newRow: true }) : d.layout,
    }));
    setSelected(f.key);
  };
  const [adding, setAdding] = useState(false);
  const addToCard = (key) => {
    place(key, { row: draft.layout.rows.length, newRow: true });
    setSelected(key);
  };

  const moveField = (i, delta) =>
    setDraft((d) => {
      const fields = [...d.fields];
      const j = i + delta;
      if (j < 0 || j >= fields.length) return d;
      [fields[i], fields[j]] = [fields[j], fields[i]];
      return { ...d, fields };
    });

  const removeField = async (key) => {
    const f = fieldOf.get(key);
    const ok = await confirmDialog({
      title: 'Remove field',
      message: `Remove the field “${f.label}” from this type? The values stay stored in the components, but are no longer shown anywhere.`,
      confirmLabel: 'Remove field',
      danger: true,
    });
    if (!ok) return;
    setDraft((d) => ({ ...d, fields: d.fields.filter((x) => x.key !== key), layout: dropEmptyRows(withoutCell(d.layout, key)) }));
    setSelected(null);
  };

  const sel = selected && fieldOf.get(selected);
  const selAt = sel && locate(draft.layout, sel.key);

  return (
    <div className="type-editor">
      {conflict && (
        <div className="conflict-bar" role="alert">
          <Icon name="info" />
          <span>Someone else just saved changes to this component type while you were editing it.</span>
          <button
            className="small"
            onClick={() => {
              history.reset(clone(base));
              setConflict(false);
            }}
          >
            Load their version
          </button>
          <button className="small" onClick={() => setConflict(false)} title="Keep your edits; saving will ask before replacing their changes">
            Keep mine
          </button>
        </div>
      )}
      {adding && <AddFieldDialog existing={draft.fields} onClose={() => setAdding(false)} onAdd={addField} />}
      <section className="panel">
        <div className="panel-head">
          <h2>Type settings</h2>
          <div className="row gap wrap">
            <button className="icon-btn" onClick={history.undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
              <Icon name="undo" />
            </button>
            <button className="icon-btn" onClick={history.redo} disabled={!history.canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
              <Icon name="redo" />
            </button>
            <button
              className="danger small"
              onClick={async () => {
                if (!(await confirmDialog({ title: 'Delete component type', message: `Delete “${type.name}” and all ${comps.length} of its components? You can undo this.`, confirmLabel: 'Delete type', danger: true }))) return;
                const ok = await attempt(() => deleteType(type.id, allComponents), 'Type deleted');
                if (ok) {
                  await onSaved();
                  navigate('admin', ['components']);
                }
              }}
            >
              <Icon name="trash" />
              Delete type
            </button>
            <button onClick={() => history.reset(clone(base))} disabled={!dirty || busy}>
              Discard
            </button>
            <button className="primary" onClick={save} disabled={!dirty || busy}>
              <Icon name="save" />
              {dirty ? 'Save changes' : 'Saved'}
            </button>
          </div>
        </div>
        <div className="grid-3">
          <div className="field">
            <label htmlFor="t-name">Name</label>
            <input id="t-name" value={draft.name} onChange={(e) => setType({ name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="t-aspect">Card shape</label>
            <select id="t-aspect" value={ASPECTS.find(([, a]) => Math.abs(a - draft.aspect) < 0.005)?.[0] || 'custom'} onChange={(e) => {
              const a = ASPECTS.find(([n]) => n === e.target.value);
              if (a) setType({ aspect: a[1] });
            }}>
              {ASPECTS.map(([n]) => (
                <option key={n}>{n}</option>
              ))}
              <option value="custom" disabled>
                Custom
              </option>
            </select>
            <p className="hint">
              Width ÷ height:{' '}
              <input type="number" className="mini" min="0.3" max="3" step="0.01" value={Number(draft.aspect || 0.7).toFixed(2)} onChange={(e) => setType({ aspect: Math.min(3, Math.max(0.3, Number(e.target.value) || 0.7)) })} aria-label="Width divided by height" />
            </p>
          </div>
          <div className="field">
            <label htmlFor="t-empty">Values that mean “empty”</label>
            <input id="t-empty" value={(draft.emptyValues || []).join(', ')} onChange={(e) => setType({ emptyValues: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} placeholder="n/a, -" />
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="t-accent">Accent color comes from</label>
            <select id="t-accent" value={draft.accentField || ''} onChange={(e) => setType({ accentField: e.target.value })}>
              <option value="">— one color for all —</option>
              {draft.fields
                .filter((f) => f.kind === 'type')
                .map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
            </select>
            <p className="hint">Used for the card's top edge and for highlighted rows.</p>
          </div>
          <div className="field">
            <label>Colors</label>
            <div className="color-list">
              <label className="color-chip">
                <input type="color" value={draft.defaultAccent || '#7c1a17'} onChange={(e) => setType({ defaultAccent: e.target.value })} />
                <span>Default</span>
              </label>
              {accentValues.map((v) => (
                <label key={v} className="color-chip">
                  <input type="color" value={draft.accentColors?.[v] || draft.defaultAccent || '#7c1a17'} onChange={(e) => setType({ accentColors: { ...draft.accentColors, [v]: e.target.value } })} />
                  <span>{v}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="layout-split">
        <div className="col gap">
          <section className="panel">
            <div className="panel-head">
              <h2>Card layout</h2>
            </div>
            <p className="small muted">
              The card is a stack of rows; fields in a row sit side by side. Drag fields between rows, or select one and use its controls below.
            </p>
            <div className={`lb ${drag ? 'dragging' : ''}`}>
              {draft.layout.rows.map((r, ri) => (
                <div key={ri} className="lb-block">
                  <div className="lb-gap" {...dropProps({ row: ri, newRow: true })} aria-hidden="true" />
                  <div className={`lb-row ${r.band ? 'band' : ''} ${r.fill ? 'fill' : ''}`} {...dropProps({ row: ri })}>
                    <div className="lb-cells">
                      {r.cells.map((c, ci) => {
                        const f = fieldOf.get(c.key);
                        return (
                          <button
                            key={c.key}
                            type="button"
                            className={`lb-cell ${selected === c.key ? 'on' : ''}`}
                            style={{ flexGrow: c.width || 1 }}
                            onClick={() => setSelected(c.key)}
                            aria-pressed={selected === c.key}
                            {...dragProps(c.key)}
                            {...dropProps({ row: ri, index: ci })}
                          >
                            <span className={`kind-dot k-${f.kind}`} aria-hidden="true" />
                            <span className="lb-cell-name">{f.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="lb-row-tools" role="group" aria-label={`Row ${ri + 1}`}>
                      <button type="button" className={`tog ${r.fill ? 'on' : ''}`} aria-pressed={r.fill} onClick={() => setRow(ri, { fill: !r.fill })} title="Let this row take up the remaining height">
                        Fill
                      </button>
                      <button type="button" className={`tog ${r.band ? 'on' : ''}`} aria-pressed={r.band} onClick={() => setRow(ri, { band: !r.band })} title="Accent-colored background">
                        Highlight
                      </button>
                      <button type="button" className={`tog ${r.divider ? 'on' : ''}`} aria-pressed={r.divider} onClick={() => setRow(ri, { divider: !r.divider })} title="Thin line above this row">
                        Line
                      </button>
                      <button type="button" className="icon-btn" onClick={() => moveRow(ri, -1)} disabled={ri === 0} aria-label="Move row up">
                        <Icon name="chevronUp" />
                      </button>
                      <button type="button" className="icon-btn" onClick={() => moveRow(ri, 1)} disabled={ri === draft.layout.rows.length - 1} aria-label="Move row down">
                        <Icon name="chevronDown" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              <div className="lb-gap lb-gap-end" {...dropProps({ row: draft.layout.rows.length, newRow: true })}>
                {drag ? 'Drop here for a new row' : draft.layout.rows.length ? '' : 'The card is empty. Add fields from the list below.'}
              </div>
            </div>
            <div className="lb-unplaced">
              <span className="lb-unplaced-label">Add to card</span>
              {unplaced.length === 0 && <span className="small muted">Every field is on the card.</span>}
              {unplaced.map((f) => (
                <button key={f.key} type="button" className="chip add-chip" {...dragProps(f.key)} onClick={() => addToCard(f.key)} title={`Add “${f.label}” as a new row at the bottom, or drag it into a row`}>
                  <Icon name="plus" size={12} />
                  {f.label}
                </button>
              ))}
              <button type="button" className="chip" onClick={() => setAdding(true)} title="Create a new field and put it on the card">
                <Icon name="plus" size={12} />
                New field…
              </button>
            </div>
          </section>

          {sel && (
            <section className="panel field-settings">
              <div className="panel-head">
                <h2>
                  <span className={`kind-dot k-${sel.kind}`} aria-hidden="true" /> {sel.label}
                </h2>
              </div>
              {selAt && <CellSettings cell={draft.layout.rows[selAt[0]].cells[selAt[1]]} at={selAt} layout={draft.layout} kind={sel.kind} setCell={setCell} place={place} remove={() => setLayout((l) => dropEmptyRows(withoutCell(l, sel.key)))} />}
              <FieldSettings field={sel} draft={draft} setField={setField} onRemove={() => removeField(sel.key)} />
            </section>
          )}

          <section className="panel">
            <div className="panel-head">
              <h2>Fields</h2>
              <button className="small" onClick={() => setAdding(true)} title="Create a new data field for this component type">
                <Icon name="plus" />
                Add field
              </button>
            </div>
            <p className="small muted">Every field is listed in this order in a component's details, whether or not it is on the card.</p>
            <ul className="field-list">
              {draft.fields.map((f, i) => (
                <li key={f.key} className={selected === f.key ? 'on' : ''}>
                  <button className="field-pick" onClick={() => setSelected(f.key)} aria-pressed={selected === f.key}>
                    <span className={`kind-dot k-${f.kind}`} aria-hidden="true" />
                    <span className="field-name">{f.label}</span>
                    <span className="muted small">{FIELD_KINDS[f.kind]?.label}</span>
                  </button>
                  {f.kind === 'id' || f.kind === 'state' ? (
                    <span className="field-place muted small" title={f.kind === 'id' ? 'The ID is shown in the details, not on the card' : 'States are switched in the details, not shown on the card'}>
                      details only
                    </span>
                  ) : placed.has(f.key) ? (
                    <button className="field-place on" onClick={() => setLayout((l) => dropEmptyRows(withoutCell(l, f.key)))} title="Shown on the card. Click to hide it from the card.">
                      <Icon name="eye" size={14} /> On card
                    </button>
                  ) : (
                    <button className="field-place" onClick={() => addToCard(f.key)} title="Only in the details. Click to add it to the card.">
                      <Icon name="plus" size={14} /> Add to card
                    </button>
                  )}
                  <button className="icon-btn" onClick={() => moveField(i, -1)} disabled={i === 0} aria-label={`Move ${f.label} up`}>
                    <Icon name="chevronUp" />
                  </button>
                  <button className="icon-btn" onClick={() => moveField(i, 1)} disabled={i === draft.fields.length - 1} aria-label={`Move ${f.label} down`}>
                    <Icon name="chevronDown" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="panel layout-panel">
          <div className="panel-head">
            <h2>Preview</h2>
          </div>
          {comps.length > 0 && (
            <select value={sampleId} onChange={(e) => setSampleId(e.target.value)} aria-label="Preview with">
              {comps.slice(0, 500).map((c) => (
                <option key={c.id} value={c.id}>
                  {String(c.data[draft.fields.find((f) => f.kind === 'title')?.key] ?? c.id)}
                </option>
              ))}
            </select>
          )}
          <div className="layout-stage">
            <div className="layout-card-wrap">
              <ComponentCard type={draft} comp={sample} shorthands={shorthands} layout={draft.layout} selectedKey={selected} />
            </div>
            <div className="layout-card-wrap small" aria-hidden="true">
              <ComponentCard type={draft} comp={sample} shorthands={shorthands} layout={draft.layout} />
            </div>
          </div>
          <p className="hint">Shown at two sizes: text scales with the card. Long text is faded out at the bottom of its row.</p>
        </section>
      </div>
    </div>
  );
}

function AddFieldDialog({ existing, onClose, onAdd }) {
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState('ability');
  const [onCard, setOnCard] = useState(true);
  const hasId = existing.some((f) => f.kind === 'id');
  const taken = existing.some((f) => f.label.trim().toLowerCase() === label.trim().toLowerCase());
  const submit = (e) => {
    e.preventDefault();
    if (!label.trim() || taken) return;
    onAdd({ label: label.trim(), kind, onCard });
    onClose();
  };
  return (
    <Modal title="Add a field" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="af-label">Name</label>
          <input id="af-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Cost, Faction, Flavor text" maxLength={60} required aria-invalid={taken} />
          {taken && <p className="error small">A field with this name already exists.</p>}
        </div>
        <div className="field">
          <label htmlFor="af-kind">Kind</label>
          <select id="af-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(FIELD_KINDS).map(([k, v]) => (
              <option key={k} value={k} disabled={k === 'id' && hasId}>
                {v.label}
              </option>
            ))}
          </select>
          <p className="hint">{FIELD_KINDS[kind].help}</p>
        </div>
        {kind !== 'id' && kind !== 'state' && (
          <label className="check">
            <input type="checkbox" checked={onCard} onChange={(e) => setOnCard(e.target.checked)} />
            Show it on the card (as a new row at the bottom)
          </label>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!label.trim() || taken}>
            Add field
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CellSettings({ cell, at, layout, kind, setCell, place, remove }) {
  const [ri, ci] = at;
  const rowLen = layout.rows[ri].cells.length;
  const isImage = kind === 'image';
  return (
    <div className="cell-settings">
      <h3>On the card</h3>
      <div className="row gap wrap">
        <button type="button" className="small" onClick={() => place(cell.key, { row: ri, index: ci - 1 })} disabled={ci === 0} title="Move left">
          <Icon name="left" /> Left
        </button>
        <button type="button" className="small" onClick={() => place(cell.key, { row: ri, index: ci + 2 })} disabled={ci === rowLen - 1} title="Move right">
          Right <Icon name="right" />
        </button>
        <button type="button" className="small" onClick={() => (ri === 0 ? place(cell.key, { row: 0, newRow: true }) : place(cell.key, { row: ri - 1 }))} disabled={ri === 0 && rowLen === 1} title="Into the row above">
          <Icon name="chevronUp" /> Row above
        </button>
        <button type="button" className="small" onClick={() => (ri === layout.rows.length - 1 ? place(cell.key, { row: layout.rows.length, newRow: true }) : place(cell.key, { row: ri + 1, index: 0 }))} disabled={ri === layout.rows.length - 1 && rowLen === 1} title="Into the row below">
          <Icon name="chevronDown" /> Row below
        </button>
        {rowLen > 1 && (
          <button type="button" className="small" onClick={() => place(cell.key, { row: ci === 0 ? ri : ri + 1, newRow: true })} title="Give this field a row of its own">
            Own row
          </button>
        )}
        <button type="button" className="small danger" onClick={remove}>
          <Icon name="eyeOff" /> Hide from card
        </button>
      </div>
      {rowLen > 1 && (
        <div className="field">
          <label htmlFor="cs-width" title="How much of the row's width this field gets, compared to the other fields in the row">
            Share of the row: {cell.width}
          </label>
          <input id="cs-width" type="range" min="1" max="6" step="1" value={cell.width} onChange={(e) => setCell(cell.key, { width: Number(e.target.value) })} />
        </div>
      )}
      {!isImage && (
        <>
          <div className="grid-2">
            <div className="field">
              <label>Text size</label>
              <div className="seg">
                {Object.entries(SIZES).map(([k, v]) => (
                  <button key={k} type="button" className={cell.size === k ? 'on' : ''} onClick={() => setCell(cell.key, { size: k })} title={`${v} text`}>
                    {k.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Alignment</label>
              <div className="seg">
                {ALIGNS.map((a) => (
                  <button key={a} type="button" className={cell.align === a ? 'on' : ''} onClick={() => setCell(cell.key, { align: a })}>
                    {a}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="row gap wrap">
            {[
              ['bold', 'Bold'],
              ['italic', 'Italic'],
              ['muted', 'Subdued'],
              ['upper', 'Capitals'],
              ['label', 'Show field name'],
            ].map(([k, label]) => (
              <label key={k} className="check">
                <input type="checkbox" checked={Boolean(cell[k])} onChange={(e) => setCell(cell.key, { [k]: e.target.checked })} />
                {label}
              </label>
            ))}
          </div>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="cs-prefix">Before the value</label>
              <input id="cs-prefix" value={cell.prefix} onChange={(e) => setCell(cell.key, { prefix: e.target.value })} placeholder="e.g. +" />
            </div>
            <div className="field">
              <label htmlFor="cs-suffix">After the value</label>
              <input id="cs-suffix" value={cell.suffix} onChange={(e) => setCell(cell.key, { suffix: e.target.value })} placeholder="e.g. [rage]" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FieldSettings({ field, draft, setField, onRemove }) {
  const hasId = draft.fields.some((f) => f.kind === 'id' && f.key !== field.key);
  return (
    <div className="cell-settings">
      <h3>Field</h3>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="fs-label">Name</label>
          <input id="fs-label" value={field.label} onChange={(e) => setField(field.key, { label: e.target.value })} />
          <p className="hint">
            Stored as <code>{field.key}</code>
          </p>
        </div>
        <div className="field">
          <label htmlFor="fs-kind">Kind</label>
          <select id="fs-kind" value={field.kind} onChange={(e) => setField(field.key, { kind: e.target.value, filterable: e.target.value === 'type' ? field.filterable : false })}>
            {Object.entries(FIELD_KINDS).map(([k, v]) => (
              <option key={k} value={k} disabled={k === 'id' && hasId}>
                {v.label}
              </option>
            ))}
          </select>
          <p className="hint">{FIELD_KINDS[field.kind]?.help}</p>
        </div>
      </div>
      {field.kind === 'type' && (
        <label className="check">
          <input type="checkbox" checked={Boolean(field.filterable)} onChange={(e) => setField(field.key, { filterable: e.target.checked })} />
          Offer as a filter on the Components page
        </label>
      )}
      {field.kind === 'image' && (
        <div className="field">
          <label htmlFor="fs-url">URL template</label>
          <input id="fs-url" value={field.urlTemplate || ''} onChange={(e) => setField(field.key, { urlTemplate: e.target.value })} placeholder="https://example.com/art/{value}.jpg" />
          <p className="hint">If values are not full URLs, they are inserted at {'{value}'}. Leave empty when the data holds full image URLs.</p>
        </div>
      )}
      <div>
        <button className="small danger" onClick={onRemove}>
          <Icon name="trash" />
          Remove field
        </button>
      </div>
    </div>
  );
}
