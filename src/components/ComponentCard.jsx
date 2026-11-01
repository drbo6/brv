import { memo } from 'react';
import { richHtml } from '../lib/html.js';
import { imageUrl, isEmptyValue } from '../lib/components.js';

const VALIGN = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };
const FIXED_BG = { dark: 'rgba(10, 8, 9, 0.88)', light: 'rgba(245, 238, 226, 0.94)' };

export function accentFor(type, comp) {
  const key = type.accentField;
  const v = key ? comp?.data?.[key] : null;
  return (v != null && type.accentColors?.[v]) || type.defaultAccent || '#2b2427';
}

export function fieldBoxStyle(field, accent) {
  const { x, y, w, h, z } = field.layout;
  const s = field.style || {};
  const bg = s.bg && s.bg !== 'none' ? (s.bg === 'accent' ? accent : s.bg === 'shade' ? undefined : FIXED_BG[s.bg] || s.bg) : undefined;
  return {
    gridColumn: `${x + 1} / span ${w}`,
    gridRow: `${y + 1} / span ${h}`,
    zIndex: z ?? 1,
    fontSize: `calc(${s.fontScale ?? 1} * var(--u))`,
    textAlign: s.align || 'center',
    justifyContent: VALIGN[s.valign] || 'center',
    alignItems: s.align === 'left' ? 'flex-start' : s.align === 'right' ? 'flex-end' : 'center',
    color: s.color || undefined,
    background: bg,
    fontWeight: s.bold ? 700 : undefined,
    fontStyle: s.italic ? 'italic' : undefined,
    textTransform: s.upper ? 'uppercase' : undefined,
  };
}

function FieldContent({ field, value, shorthands }) {
  if (field.kind === 'image') {
    const url = imageUrl(field, value);
    return url ? <img src={url} alt="" loading="lazy" decoding="async" draggable="false" /> : <span className="img-missing" aria-hidden="true" />;
  }
  const s = field.style || {};
  const text = String(value);
  // "+" in front of "-1" would read "+-1".
  const prefix = s.prefix && !(/^[-+−]/.test(text) && /^[+-]/.test(s.prefix)) ? s.prefix : '';
  const html = richHtml(`${prefix}${text}${s.suffix || ''}`, shorthands);
  return (
    <>
      {s.showLabel && <span className="cf-label">{field.label}</span>}
      <span className="cf-value" dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
}

/**
 * Renders a component as a card using its type's layout. Positions are on a cols × rows grid and
 * font sizes are relative to the card width, so the same layout works at any card size.
 */
function ComponentCard({ type, comp, shorthands, onClick, className = '', hasStates = false, children }) {
  const accent = accentFor(type, comp);
  const fields = type.fields.filter((f) => f.layout?.show && f.kind !== 'state' && !isEmptyValue(comp.data?.[f.key], type));
  const Tag = onClick ? 'button' : 'div';
  const aspect = type.aspect || 0.7;
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={`ccard ${className}`}
      style={{
        '--accent': accent,
        aspectRatio: aspect,
        // Round corners: the vertical radius is a share of the height, so scale it by the aspect ratio.
        borderRadius: `4.5% / ${4.5 * aspect}%`,
        // minmax(0, 1fr) keeps rows from growing with their content, so the layout stays exact.
        gridTemplateColumns: `repeat(${type.cols || 20}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${type.rows || 28}, minmax(0, 1fr))`,
      }}
      onClick={onClick}
    >
      {fields.map((f) => {
        const s = f.style || {};
        const cls = ['cf', `cf-${f.kind}`, `font-${s.font || 'body'}`, s.vertical ? 'vertical' : '', s.shape && s.shape !== 'none' ? `shape-${s.shape}` : '', s.bg === 'shade' ? 'bg-shade' : ''];
        return (
          <div key={f.key} className={cls.join(' ')} style={fieldBoxStyle(f, accent)}>
            <FieldContent field={f} value={comp.data[f.key]} shorthands={shorthands} />
          </div>
        );
      })}
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
