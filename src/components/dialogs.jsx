import { useEffect, useRef, useState } from 'react';
import { Modal } from './ui.jsx';

// Promise-based replacements for window.confirm / prompt / alert, rendered as the site's own modals.
// <DialogHost /> is mounted once in App; the functions can be called from anywhere.

let enqueue = null;
const pending = [];

function open(dialog) {
  return new Promise((resolve) => {
    const d = { ...dialog, resolve, id: Math.random() };
    if (enqueue) enqueue(d);
    else pending.push(d);
  });
}

const asOpts = (o) => (typeof o === 'string' ? { message: o } : o);

/** Resolves true when confirmed. Options: title, message, confirmLabel, cancelLabel, danger. */
export const confirmDialog = (o) => open({ kind: 'confirm', ...asOpts(o) });

/** Resolves to the entered text, or null when cancelled. Options: title, message, label, initial, placeholder, confirmLabel, validate(value) → error text. */
export const promptDialog = (o) => open({ kind: 'prompt', ...asOpts(o) });

/** Resolves when dismissed. Options: title, message. */
export const alertDialog = (o) => open({ kind: 'alert', ...asOpts(o) });

export function DialogHost() {
  const [queue, setQueue] = useState(() => pending.splice(0));
  useEffect(() => {
    enqueue = (d) => setQueue((q) => [...q, d]);
    return () => {
      enqueue = null;
    };
  }, []);
  const current = queue[0];
  if (!current) return null;
  const close = (value) => {
    current.resolve(value);
    setQueue((q) => q.slice(1));
  };
  return <Dialog key={current.id} d={current} close={close} />;
}

function Dialog({ d, close }) {
  const [value, setValue] = useState(d.initial ?? '');
  const ref = useRef(null);
  const error = d.kind === 'prompt' && d.validate ? d.validate(value) : '';
  const cancelValue = d.kind === 'confirm' ? false : d.kind === 'prompt' ? null : undefined;

  useEffect(() => {
    if (d.kind === 'prompt') ref.current?.select();
  }, [d.kind]);

  const submit = (e) => {
    e.preventDefault();
    if (d.kind === 'prompt') {
      if (error || (!d.allowEmpty && !value.trim())) return;
      close(value);
    } else close(d.kind === 'confirm' ? true : undefined);
  };

  const title = d.title || (d.kind === 'confirm' ? 'Are you sure?' : d.kind === 'alert' ? 'Note' : '');
  return (
    <Modal title={title} onClose={() => close(cancelValue)} className={`dialog dialog-${d.kind}`}>
      <form className="form" onSubmit={submit}>
        {d.message && <p className="dialog-message">{d.message}</p>}
        {d.kind === 'prompt' && (
          <div className="field">
            {d.label && <label htmlFor="dialog-input">{d.label}</label>}
            <input id="dialog-input" ref={ref} value={value} onChange={(e) => setValue(e.target.value)} placeholder={d.placeholder} aria-invalid={Boolean(error)} autoComplete="off" />
            {error && value && <p className="error small">{error}</p>}
          </div>
        )}
        <div className="modal-actions">
          {d.kind !== 'alert' && (
            <button type="button" onClick={() => close(cancelValue)}>
              {d.cancelLabel || 'Cancel'}
            </button>
          )}
          <button type="submit" className={d.danger ? 'danger-solid' : 'primary'} autoFocus={d.kind !== 'prompt'} disabled={d.kind === 'prompt' && (Boolean(error) || (!d.allowEmpty && !value.trim()))}>
            {d.confirmLabel || (d.kind === 'alert' ? 'OK' : d.kind === 'prompt' ? 'OK' : 'Confirm')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
