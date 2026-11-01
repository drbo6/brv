import { useMemo, useRef, useState } from 'react';
import { autoLayout, BACKGROUNDS, deleteType, DEFAULT_STYLE, FIELD_KINDS, FONTS, isEmptyValue, newField, saveType, SHAPES } from '../../lib/components.js';
import { navigate } from '../../lib/router.js';
import { useSession } from '../../lib/session.jsx';
import ComponentCard, { accentFor } from '../ComponentCard.jsx';
import { attempt, Icon } from '../ui.jsx';

const clone = (x) => JSON.parse(JSON.stringify(x));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export default function TypeEditor({ type, comps, allComponents, onSaved }) {
  const { shorthands } = useSession();
  const [draft, setDraft] = useState(() => clone(type));
  const [selected, setSelected] = useState(draft.fields.find((f) => f.layout?.show)?.key || null);
  const [sampleId, setSampleId] = useState(comps[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(type);

  const sample = comps.find((c) => c.id === sampleId) || comps[0] || { id: 'sample', data: Object.fromEntries(draft.fields.map((f) => [f.key, f.kind === 'image' ? '' : f.label])) };
  const setField = (key, patch) => setDraft((d) => ({ ...d, fields: d.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)) }));
  const setLayout = (key, patch) => setDraft((d) => ({ ...d, fields: d.fields.map((f) => (f.key === key ? { ...f, layout: { ...f.layout, ...patch } } : f)) }));
  const setStyle = (key, patch) => setDraft((d) => ({ ...d, fields: d.fields.map((f) => (f.key === key ? { ...f, style: { ...DEFAULT_STYLE, ...f.style, ...patch } } : f)) }));
  const sel = draft.fields.find((f) => f.key === selected);

  const accentValues = useMemo(() => {
    if (!draft.accentField) return [];
    const vals = new Set(Object.keys(draft.accentColors || {}));
    for (const c of comps) if (!isEmptyValue(c.data[draft.accentField], draft)) vals.add(String(c.data[draft.accentField]));
    return [...vals].sort();
  }, [draft, comps]);

  const save = async () => {
    const ids = draft.fields.filter((f) => f.kind === 'id');
    if (ids.length !== 1) return alert('A component type needs exactly one ID field.');
    setBusy(true);
    const ok = await attempt(() => saveType(draft), 'Component type saved');
    setBusy(false);
    if (ok) onSaved();
  };

  const addField = () => {
    const label = prompt('Name of the new field');
    if (!label?.trim()) return;
    const f = newField(label.trim(), 'ability', draft.fields.map((x) => x.key));
    setDraft((d) => ({ ...d, fields: [...d.fields, f] }));
    setSelected(f.key);
  };

  const moveField = (i, delta) =>
    setDraft((d) => {
      const fields = [...d.fields];
      const j = i + delta;
      if (j < 0 || j >= fields.length) return d;
      [fields[i], fields[j]] = [fields[j], fields[i]];
      return { ...d, fields };
    });

  return (
    <div className="type-editor">
      <section className="panel">
        <div className="panel-head">
          <h2>Type settings</h2>
          <div className="row gap">
            <button
              className="danger small"
              onClick={async () => {
                if (!confirm(`Delete the type “${type.name}” and all ${comps.length} of its components?`)) return;
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
            <button className="primary" onClick={save} disabled={!dirty || busy}>
              <Icon name="save" />
              {dirty ? 'Save changes' : 'Saved'}
            </button>
          </div>
        </div>
        <div className="grid-4">
          <div className="field">
            <label htmlFor="t-name">Name</label>
            <input id="t-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Card proportions (width × height)</label>
            <div className="row gap">
              <input
                type="number"
                min="1"
                className="mini"
                aria-label="Width"
                value={Math.round((draft.aspect || 0.7) * 1000)}
                onChange={(e) => setDraft({ ...draft, aspect: Number(e.target.value) / 1000 || 0.7 })}
              />
              <span>×</span>
              <input type="number" className="mini" value={1000} disabled aria-label="Height" />
            </div>
            <div className="row gap wrap small">
              {[
                ['Poker', 63 / 88],
                ['Tarot', 70 / 120],
                ['Square', 1],
                ['Blood Rage', 485 / 745],
              ].map(([n, a]) => (
                <button key={n} type="button" className="link-btn small" onClick={() => setDraft({ ...draft, aspect: a })}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Layout grid (columns × rows)</label>
            <div className="row gap">
              <input type="number" min="4" max="60" className="mini" value={draft.cols} onChange={(e) => setDraft({ ...draft, cols: clamp(Number(e.target.value) || 20, 4, 60) })} aria-label="Columns" />
              <span>×</span>
              <input type="number" min="4" max="80" className="mini" value={draft.rows} onChange={(e) => setDraft({ ...draft, rows: clamp(Number(e.target.value) || 28, 4, 80) })} aria-label="Rows" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="t-empty">Values that mean “empty”</label>
            <input id="t-empty" value={(draft.emptyValues || []).join(', ')} onChange={(e) => setDraft({ ...draft, emptyValues: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} placeholder="n/a, -" />
          </div>
        </div>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="t-accent">Card color comes from</label>
            <select id="t-accent" value={draft.accentField || ''} onChange={(e) => setDraft({ ...draft, accentField: e.target.value })}>
              <option value="">— one color for all —</option>
              {draft.fields
                .filter((f) => f.kind === 'type')
                .map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
            </select>
          </div>
          <div className="field">
            <label>Colors</label>
            <div className="color-list">
              <label className="color-chip">
                <input type="color" value={draft.defaultAccent || '#2b2427'} onChange={(e) => setDraft({ ...draft, defaultAccent: e.target.value })} />
                <span>Default</span>
              </label>
              {accentValues.map((v) => (
                <label key={v} className="color-chip">
                  <input
                    type="color"
                    value={draft.accentColors?.[v] || draft.defaultAccent || '#2b2427'}
                    onChange={(e) => setDraft({ ...draft, accentColors: { ...draft.accentColors, [v]: e.target.value } })}
                  />
                  <span>{v}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="layout-split">
        <section className="panel">
          <div className="panel-head">
            <h2>Fields</h2>
            <button className="small" onClick={addField}>
              <Icon name="plus" />
              Add field
            </button>
          </div>
          <ul className="field-list">
            {draft.fields.map((f, i) => (
              <li key={f.key} className={selected === f.key ? 'on' : ''}>
                <button className="field-pick" onClick={() => setSelected(f.key)} aria-pressed={selected === f.key}>
                  <span className={`kind-dot k-${f.kind}`} aria-hidden="true" />
                  <span className="field-name">{f.label}</span>
                  <span className="muted small">{FIELD_KINDS[f.kind]?.label}</span>
                </button>
                <label className="eye" title={f.layout?.show ? 'Shown on card' : 'Only in details'}>
                  <input type="checkbox" checked={Boolean(f.layout?.show)} onChange={(e) => setLayout(f.key, { show: e.target.checked })} disabled={f.kind === 'state'} />
                  <Icon name={f.layout?.show ? 'eye' : 'eyeOff'} />
                  <span className="sr-only">Show {f.label} on card</span>
                </label>
                <button className="icon-btn" onClick={() => moveField(i, -1)} aria-label="Move up" title="Earlier fields are drawn below later ones">
                  <Icon name="chevronUp" />
                </button>
                <button className="icon-btn" onClick={() => moveField(i, 1)} aria-label="Move down">
                  <Icon name="chevronDown" />
                </button>
              </li>
            ))}
          </ul>
          {sel && <FieldSettings field={sel} draft={draft} setField={setField} setLayout={setLayout} setStyle={setStyle} onRemove={() => {
            if (!confirm(`Remove the field “${sel.label}”? Its data stays in the components but will no longer be shown.`)) return;
            setDraft((d) => ({ ...d, fields: d.fields.filter((f) => f.key !== sel.key) }));
            setSelected(null);
          }} />}
        </section>

        <section className="panel layout-panel">
          <div className="panel-head">
            <h2>Card layout</h2>
            {comps.length > 0 && (
              <select value={sampleId} onChange={(e) => setSampleId(e.target.value)} aria-label="Preview with">
                {comps.slice(0, 500).map((c) => (
                  <option key={c.id} value={c.id}>
                    Preview: {String(c.data[draft.fields.find((f) => f.kind === 'title')?.key] ?? c.id)}
                  </option>
                ))}
              </select>
            )}
          </div>
          <p className="small muted">
            Drag a box to move it; drag its corner to resize. Positions snap to the grid. Font sizes scale with the card.{' '}
            <button className="link-btn small" onClick={() => confirm('Replace the current layout with an automatic one?') && setDraft((d) => ({ ...d, fields: autoLayout(d.fields, d.cols, d.rows) }))}>
              Auto-arrange
            </button>
          </p>
          <LayoutCanvas draft={draft} sample={sample} shorthands={shorthands} selected={selected} onSelect={setSelected} onLayout={setLayout} />
        </section>
      </div>
    </div>
  );
}

function FieldSettings({ field, draft, setField, setLayout, setStyle, onRemove }) {
  const s = { ...DEFAULT_STYLE, ...field.style };
  const L = field.layout || {};
  const hasId = draft.fields.some((f) => f.kind === 'id' && f.key !== field.key);
  return (
    <div className="field-settings">
      <h3>{field.label}</h3>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="fs-label">Label</label>
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

      {field.layout?.show && field.kind !== 'state' && (
        <>
          <h4>Position & size</h4>
          <div className="grid-5">
            {[
              ['x', 'Left', 0, draft.cols - 1],
              ['y', 'Top', 0, draft.rows - 1],
              ['w', 'Width', 1, draft.cols],
              ['h', 'Height', 1, draft.rows],
              ['z', 'Layer', 0, 20],
            ].map(([k, label, lo, hi]) => (
              <div className="field" key={k}>
                <label htmlFor={`fs-${k}`}>{label}</label>
                <input id={`fs-${k}`} type="number" min={lo} max={hi} value={L[k] ?? 0} onChange={(e) => setLayout(field.key, { [k]: clamp(Number(e.target.value) || 0, lo, hi) })} />
              </div>
            ))}
          </div>
          {field.kind !== 'image' && (
            <>
              <h4>Text</h4>
              <div className="field">
                <label htmlFor="fs-scale">Relative size: {Number(s.fontScale).toFixed(2)}×</label>
                <input id="fs-scale" type="range" min="0.4" max="4" step="0.05" value={s.fontScale} onChange={(e) => setStyle(field.key, { fontScale: Number(e.target.value) })} />
              </div>
              <div className="grid-3">
                <div className="field">
                  <label htmlFor="fs-font">Font</label>
                  <select id="fs-font" value={s.font} onChange={(e) => setStyle(field.key, { font: e.target.value })}>
                    {Object.entries(FONTS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Align</label>
                  <div className="seg">
                    {['left', 'center', 'right'].map((a) => (
                      <button key={a} type="button" className={s.align === a ? 'on' : ''} onClick={() => setStyle(field.key, { align: a })}>
                        {a}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label>Vertical</label>
                  <div className="seg">
                    {['top', 'middle', 'bottom'].map((a) => (
                      <button key={a} type="button" className={s.valign === a ? 'on' : ''} onClick={() => setStyle(field.key, { valign: a })}>
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
                  ['upper', 'Uppercase'],
                  ['vertical', 'Rotated'],
                  ['showLabel', 'Show label'],
                ].map(([k, label]) => (
                  <label key={k} className="check">
                    <input type="checkbox" checked={Boolean(s[k])} onChange={(e) => setStyle(field.key, { [k]: e.target.checked })} />
                    {label}
                  </label>
                ))}
              </div>
              <div className="grid-3">
                <div className="field">
                  <label htmlFor="fs-shape">Shape</label>
                  <select id="fs-shape" value={s.shape} onChange={(e) => setStyle(field.key, { shape: e.target.value })}>
                    {Object.entries(SHAPES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="fs-bg">Background</label>
                  <div className="row gap">
                    <select id="fs-bg" value={s.bg in BACKGROUNDS ? s.bg : 'custom'} onChange={(e) => setStyle(field.key, { bg: e.target.value === 'custom' ? '#444444' : e.target.value })}>
                      {Object.entries(BACKGROUNDS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                      <option value="custom">Custom color</option>
                    </select>
                    {!(s.bg in BACKGROUNDS) && <input type="color" value={s.bg} onChange={(e) => setStyle(field.key, { bg: e.target.value })} aria-label="Background color" />}
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="fs-color">Text color</label>
                  <div className="row gap">
                    <input id="fs-color" type="color" value={s.color || '#ffffff'} onChange={(e) => setStyle(field.key, { color: e.target.value })} />
                    {s.color && (
                      <button className="link-btn small" onClick={() => setStyle(field.key, { color: '' })}>
                        reset
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="fs-prefix">Prefix</label>
                  <input id="fs-prefix" value={s.prefix} onChange={(e) => setStyle(field.key, { prefix: e.target.value })} placeholder="e.g. +" />
                </div>
                <div className="field">
                  <label htmlFor="fs-suffix">Suffix</label>
                  <input id="fs-suffix" value={s.suffix} onChange={(e) => setStyle(field.key, { suffix: e.target.value })} placeholder="e.g. [rage]" />
                </div>
              </div>
            </>
          )}
        </>
      )}
      <button className="small danger" onClick={onRemove}>
        <Icon name="trash" />
        Remove field
      </button>
    </div>
  );
}

/** The card preview with draggable/resizable boxes for every visible field. */
function LayoutCanvas({ draft, sample, shorthands, selected, onSelect, onLayout }) {
  const ref = useRef(null);
  const drag = useRef(null);
  const visible = draft.fields.filter((f) => f.layout?.show && f.kind !== 'state');

  const start = (e, f, mode) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(f.key);
    const rect = ref.current.getBoundingClientRect();
    drag.current = { key: f.key, mode, x0: e.clientX, y0: e.clientY, L: { ...f.layout }, cw: rect.width / draft.cols, ch: rect.height / draft.rows };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = Math.round((e.clientX - d.x0) / d.cw);
    const dy = Math.round((e.clientY - d.y0) / d.ch);
    if (d.mode === 'move') onLayout(d.key, { x: clamp(d.L.x + dx, 0, draft.cols - d.L.w), y: clamp(d.L.y + dy, 0, draft.rows - d.L.h) });
    else onLayout(d.key, { w: clamp(d.L.w + dx, 1, draft.cols - d.L.x), h: clamp(d.L.h + dy, 1, draft.rows - d.L.y) });
  };
  const end = () => {
    drag.current = null;
  };
  const nudge = (e, f) => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!step) return;
    e.preventDefault();
    const L = f.layout;
    if (e.shiftKey) onLayout(f.key, { w: clamp(L.w + step[0], 1, draft.cols - L.x), h: clamp(L.h + step[1], 1, draft.rows - L.y) });
    else onLayout(f.key, { x: clamp(L.x + step[0], 0, draft.cols - L.w), y: clamp(L.y + step[1], 0, draft.rows - L.h) });
  };

  return (
    <div className="layout-stage">
      <div className="layout-card-wrap" style={{ '--accent': accentFor(draft, sample) }}>
        <ComponentCard type={draft} comp={sample} shorthands={shorthands} />
        <div
          ref={ref}
          className="layout-overlay"
          style={{ gridTemplateColumns: `repeat(${draft.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${draft.rows}, minmax(0, 1fr))`, '--cols': draft.cols, '--rows': draft.rows }}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        >
          {visible.map((f) => (
            <div
              key={f.key}
              className={`layout-box ${selected === f.key ? 'on' : ''}`}
              style={{ gridColumn: `${f.layout.x + 1} / span ${f.layout.w}`, gridRow: `${f.layout.y + 1} / span ${f.layout.h}`, zIndex: selected === f.key ? 50 : f.layout.z ?? 1 }}
              onPointerDown={(e) => start(e, f, 'move')}
              onKeyDown={(e) => nudge(e, f)}
              tabIndex={0}
              role="button"
              aria-label={`${f.label}: arrow keys move, shift+arrow keys resize`}
            >
              <span className="layout-tag">{f.label}</span>
              <span className="layout-handle" onPointerDown={(e) => start(e, f, 'resize')} aria-hidden="true" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
