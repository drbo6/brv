import { memo } from 'react';
import { richHtml } from '../lib/html.js';
import { cardLayout, imageUrl, isEmptyValue } from '../lib/components.js';

export function accentFor(type, comp) {
  const key = type.accentField;
  const v = key ? comp?.data?.[key] : null;
  return (v != null && type.accentColors?.[v]) || type.defaultAccent || '#7c1a17';
}

function CellContent({ field, cell, value, shorthands }) {
  if (field.kind === 'image') {
    const url = imageUrl(field, value);
    return url ? <img src={url} alt="" loading="lazy" decoding="async" draggable="false" referrerPolicy="no-referrer" /> : <span className="img-missing" aria-hidden="true" />;
  }
  const text = String(value);
  // "+" in front of "-1" would read "+-1".
  const prefix = cell.prefix && !(/^[-+−]/.test(text) && /^[+-]/.test(cell.prefix)) ? cell.prefix : '';
  return (
    <>
      {cell.label && <span className="cc-label">{field.label}</span>}
      <span className="cc-value" dangerouslySetInnerHTML={{ __html: richHtml(`${prefix}${text}${cell.suffix || ''}`, shorthands) }} />
    </>
  );
}

/**
 * Renders a component as a card: rows of fields stacked top to bottom, fields side by side within a
 * row. All cards of a type share one size (the type's aspect ratio); text scales with the card width.
 * Pass `layout` to preview an unsaved layout.
 */
function ComponentCard({ type, comp, shorthands, onClick, className = '', hasStates = false, layout, selectedKey, children }) {
  const fields = new Map(type.fields.map((f) => [f.key, f]));
  const rows = (layout || cardLayout(type)).rows
    // An empty element is left out, unless it keeps its space.
    .map((r) => ({ ...r, cells: r.cells.map((c) => ({ ...c, empty: isEmptyValue(comp.data?.[c.key], type) })).filter((c) => fields.has(c.key) && (!c.empty || c.keepSpace)) }))
    .filter((r) => r.cells.length);
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`ccard ${className}`} style={{ '--accent': accentFor(type, comp), aspectRatio: type.aspect || 0.7 }} onClick={onClick}>
      {rows.map((r, i) => (
        <div key={i} className={['cc-row', r.fill ? 'fill' : '', r.band ? 'band' : '', r.divider ? 'divider' : ''].join(' ')}>
          {r.cells.map((c) => {
            const f = fields.get(c.key);
            const cls = ['cc', `cc-${f.kind}`, `size-${c.size}`, `align-${c.align}`, c.bold && 'bold', c.italic && 'italic', c.muted && 'muted', c.upper && 'upper', selectedKey === c.key && 'selected'];
            return (
              <div key={c.key} className={cls.filter(Boolean).join(' ')} style={{ flexGrow: c.width || 1 }}>
                {c.empty ? (
                  <span className="cc-value" aria-hidden="true">
                    {' '}
                  </span>
                ) : (
                  <CellContent field={f} cell={c} value={comp.data[c.key]} shorthands={shorthands} />
                )}
              </div>
            );
          })}
        </div>
      ))}
      {hasStates && (
        <span className="ccard-states" title="Has alternate states" aria-label="Has alternate states">
          ⟲
        </span>
      )}
      {children}
    </Tag>
  );
}

export default memo(ComponentCard);
