import { useEffect, useState } from 'react';
import { useLocalStorage } from '../lib/hooks.js';
import { loadComponents } from '../lib/components.js';
import { CARD_SIZES, cardGrid, cardWidthOf, PAGE_SIZES, paperOf, UNITS } from '../lib/pdf.js';
import { Icon, Modal } from './ui.jsx';

const usLike = () => /^en-(US|CA)|^es-(MX|US)|^fr-CA/i.test(navigator.language || '');
const US = usLike();
const DEFAULTS = {
  format: US ? 'letter' : 'a4',
  perSheet: 1,
  cards: 'cards',
  cardSize: 'm',
  // Custom sizes, in `unit`.
  unit: US ? 'in' : 'mm',
  paperW: US ? 5.5 : 148,
  paperH: US ? 8.5 : 210,
  cardW: US ? 2.5 : 63,
};

// Rounded for display in a number field.
const round = (v, unit) => Math.round(v * (unit === 'in' ? 100 : 10)) / (unit === 'in' ? 100 : 10);

/** Number fields for a custom size, in the chosen unit. */
function SizeFields({ fields, unit, onUnit }) {
  return (
    <div className="pdf-custom">
      {fields.map((f, i) => (
        <span key={f.label} className="pdf-custom-field">
          {i > 0 && <span className="muted">×</span>}
          <label>
            <span className="small muted">{f.label}</span>
            <input type="number" min="0" step={unit === 'in' ? 0.05 : 1} value={f.value} onChange={(e) => f.onChange(e.target.value)} required />
          </label>
        </span>
      ))}
      <div className="seg" role="group" aria-label="Unit">
        {Object.entries(UNITS).map(([u, x]) => (
          <button key={u} type="button" className={unit === u ? 'on' : ''} onClick={() => onUnit(u)}>
            {x.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** One question: a row of choices, each with a short explanation. */
function Choice({ legend, value, options, onChange }) {
  return (
    <fieldset className="pdf-choice">
      <legend>{legend}</legend>
      <div className="pdf-options">
        {options.map((o) => (
          <button key={String(o.value)} type="button" className={`pdf-option ${value === o.value ? 'on' : ''}`} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
            {o.art}
            <b>{o.label}</b>
            {o.hint && <span className="small muted">{o.hint}</span>}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

// Little pictures of a sheet, so the choices read at a glance.
const Sheet = ({ landscape, halves, grid, table }) => (
  <svg className="pdf-art" viewBox="0 0 44 44" aria-hidden="true">
    <rect x={landscape ? 4 : 10} y={landscape ? 10 : 4} width={landscape ? 36 : 24} height={landscape ? 24 : 36} rx="2" />
    {halves && <line x1="22" y1="12" x2="22" y2="32" strokeDasharray="2 2" />}
    {!grid && !table && (halves ? [15, 19, 23, 27].map((y) => [<line key={`a${y}`} x1="7" y1={y} x2="19" y2={y} />, <line key={`b${y}`} x1="25" y1={y} x2="37" y2={y} />]) : [10, 15, 20, 25, 30].map((y) => <line key={y} x1="14" y1={y} x2="30" y2={y} />))}
    {grid && [0, 1, 2].flatMap((r) => [0, 1].map((c) => <rect key={`${r}${c}`} className="fill" x={13 + c * 10} y={7 + r * 11} width="8" height="9.5" rx="1" />))}
    {table && [14, 18, 22, 26, 30].map((y) => <line key={y} x1="7" y1={y} x2="37" y2={y} />)}
    {table && <line x1="16" y1="13" x2="16" y2="31" />}
  </svg>
);

/** Asks how the ruleset PDF should look, then hands the choices to `onExport`. */
export default function PdfDialog({ setName, onExport, onClose }) {
  const [saved, setSaved] = useLocalStorage('brv-pdf-options', DEFAULTS);
  const [o, setO] = useState(() => {
    const x = { ...DEFAULTS, ...saved };
    return x.cardSize in CARD_SIZES || x.cardSize === 'custom' ? x : { ...x, cardSize: 'm' };
  });
  const set = (patch) => setO((x) => ({ ...x, ...patch }));
  // Switching units converts the custom sizes, so they stay the same size.
  const setUnit = (unit) =>
    setO((x) => {
      if (x.unit === unit) return x;
      const k = UNITS[x.unit].pt / UNITS[unit].pt;
      return { ...x, unit, paperW: round(x.paperW * k, unit), paperH: round(x.paperH * k, unit), cardW: round(x.cardW * k, unit) };
    });
  const [cards, setCards] = useState(null); // { count, aspect }
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    loadComponents()
      .then(({ types, components }) => live && setCards({ count: components.length, aspect: types.find((t) => components.some((c) => c.typeId === t.id))?.aspect || 0.7 }))
      .catch(() => live && setCards({ count: 0, aspect: 0.7 }));
    return () => {
      live = false;
    };
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setSaved(o);
    setBusy(true);
    const ok = await onExport(o);
    setBusy(false);
    if (ok) onClose();
  };

  const paper = paperOf(o);
  const paperName = o.format === 'custom' ? 'page' : `${PAGE_SIZES[o.format].label} page`;
  const fit = (cardSize, cardW) => {
    const g = cardGrid(paper, cards.aspect, cardWidthOf({ ...o, cardSize, cardW }));
    return `${g.perPage} per ${paperName}, about ${Math.ceil(cards.count / g.perPage)} pages`;
  };
  return (
    <Modal title="Export as PDF" onClose={onClose} wide className="pdf-dialog">
      <form className="form" onSubmit={submit}>
        <p className="muted">
          “{setName}”: its rules in the versions it uses{cards?.count ? ', and its cards' : ''}.
        </p>
        <Choice
          legend="Paper"
          value={o.format}
          onChange={(format) => set({ format })}
          options={[...Object.entries(PAGE_SIZES).map(([value, p]) => ({ value, label: p.label, hint: p.hint })), { value: 'custom', label: 'Custom', hint: 'Any width and height' }]}
        />
        {o.format === 'custom' && (
          <SizeFields
            unit={o.unit}
            onUnit={setUnit}
            fields={[
              { label: 'Width', value: o.paperW, onChange: (paperW) => set({ paperW }) },
              { label: 'Height', value: o.paperH, onChange: (paperH) => set({ paperH }) },
            ]}
          />
        )}
        <Choice
          legend="Rules"
          value={o.perSheet}
          onChange={(perSheet) => set({ perSheet })}
          options={[
            { value: 1, label: 'One page per sheet', hint: 'Easiest to read', art: <Sheet /> },
            { value: 2, label: 'Two pages per sheet', hint: 'Side by side on a landscape sheet: half the paper', art: <Sheet landscape halves /> },
          ]}
        />
        {cards?.count > 0 && (
          <>
            <Choice
              legend={`Cards (${cards.count})`}
              value={o.cards}
              onChange={(c) => set({ cards: c })}
              options={[
                { value: 'cards', label: 'As cards', hint: 'Laid out like on the site', art: <Sheet grid /> },
                { value: 'table', label: 'As a table', hint: 'One row per card, on landscape pages', art: <Sheet landscape table /> },
                { value: 'none', label: 'Leave out', hint: 'Only list cards the ruleset changes', art: <Sheet /> },
              ]}
            />
            {o.cards === 'cards' && (
              <Choice
                legend="Card size"
                value={o.cardSize}
                onChange={(cardSize) => set({ cardSize })}
                options={[
                  ...Object.entries(CARD_SIZES).map(([value, s]) => ({ value, label: `${s.label} · ${s.mm} mm wide`, hint: fit(value) })),
                  { value: 'custom', label: 'Custom', hint: o.cardSize === 'custom' ? fit('custom', o.cardW) : 'Any width; the height follows the card shape' },
                ]}
              />
            )}
            {o.cards === 'cards' && o.cardSize === 'custom' && (
              <SizeFields unit={o.unit} onUnit={setUnit} fields={[{ label: 'Card width', value: o.cardW, onChange: (cardW) => set({ cardW }) }]} />
            )}
          </>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy || !cards}>
            <Icon name="download" />
            {busy ? 'Making the PDF…' : 'Download PDF'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
