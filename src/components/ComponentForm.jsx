import { useState } from 'react';
import { displayTitle, FIELD_KINDS, idField, saveComponent } from '../lib/components.js';
import { useSession } from '../lib/session.jsx';
import ComponentCard from './ComponentCard.jsx';
import { confirmDialog } from './dialogs.jsx';
import { attempt, Icon, Modal } from './ui.jsx';

/**
 * Add or edit one component (its printed data), with a live preview. Used on the Components page
 * by editors and in Admin → Components.
 */
export default function ComponentForm({ type, comp, comps, onClose, onSaved }) {
  const { shorthands } = useSession();
  const [data, setData] = useState(() => ({ ...(comp?.data || {}) }));
  const [busy, setBusy] = useState(false);
  const idf = idField(type);
  const idValue = String(data[idf.key] ?? '').trim();
  const idTaken = comps.some((c) => c.id !== comp?.id && String(c.data[idf.key]).trim() === idValue);
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));

  // The list reloads live, so `comp` changes if another admin saves this component meanwhile.
  const [openedWith, setOpenedWith] = useState(() => JSON.stringify(comp?.data || null));
  const changedElsewhere = comp && JSON.stringify(comp.data) !== openedWith;

  const submit = async (e) => {
    e.preventDefault();
    if (changedElsewhere) {
      const ok = await confirmDialog({
        title: 'Someone else changed this component',
        message: 'Another admin saved changes to this component while you were editing. Saving replaces their changes with yours.',
        confirmLabel: 'Save mine anyway',
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    const ok = await attempt(() => saveComponent(type, data, comp?.id), 'Component saved');
    setBusy(false);
    if (ok) {
      await onSaved?.(ok);
      onClose();
    }
  };

  return (
    <Modal title={comp ? `Edit ${displayTitle(type, comp)}` : 'New component'} onClose={onClose} wide>
      {changedElsewhere && (
        <div className="conflict-bar" role="alert">
          <Icon name="info" />
          <span>Someone else saved changes to this component while you were editing.</span>
          <button type="button" className="small" onClick={() => {
              setData({ ...comp.data });
              setOpenedWith(JSON.stringify(comp.data));
            }}>
            Load their version
          </button>
        </div>
      )}
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
