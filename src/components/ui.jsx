import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { richHtml } from '../lib/html.js';
import { reactionCounts } from '../lib/rules.js';
import { useSession } from '../lib/session.jsx';
import { record, redo, undo } from '../lib/store.js';
import { useProfiles, useUserNames } from '../lib/profiles.js';

const ICONS = {
  up: '<path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>',
  down: '<path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/>',
  q: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  chevronUp: '<path d="m18 15-6-6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="m2 2 20 20"/>',
  flask: '<path d="M10 2v7.53a2 2 0 0 1-.21.9L4.72 20.55A1 1 0 0 0 5.6 22h12.8a1 1 0 0 0 .88-1.45l-5.07-10.12a2 2 0 0 1-.21-.9V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98"/><path d="m15.41 6.51-6.82 3.98"/>',
  bulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  arrowDown: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  flip: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  bellRing: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M4 2C2.8 3.7 2 5.7 2 8"/><path d="M22 8c0-2.3-.8-4.3-2-6"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  pinOff: '<path d="M12 17v5"/><path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89"/><path d="m2 2 20 20"/><path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  bold: '<path d="M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"/>',
  italic: '<path d="M19 4h-9"/><path d="M14 20H5"/><path d="M15 4 9 20"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
};

export function Icon({ name, size = 16, className = '' }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] || '' }}
    />
  );
}

// Open modals, innermost last: Escape only closes the top one, and focus returns where it was.
const modalStack = [];

export function Modal({ title, onClose, children, footer, wide = false, className = '' }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const me = {};
    modalStack.push(me);
    const opener = document.activeElement;
    const onKey = (e) => {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === me) {
        e.stopPropagation();
        closeRef.current?.();
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    if (!ref.current?.contains(document.activeElement)) ref.current?.querySelector('[autofocus], input, textarea, select, button.primary')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      modalStack.splice(modalStack.indexOf(me), 1);
      if (!modalStack.length) document.body.classList.remove('modal-open');
      if (opener && document.contains(opener)) opener.focus?.();
    };
  }, []);
  // Rendered at the end of <body>, so a dialog opened from inside another modal sits on top of it.
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} className={`modal ${wide ? 'wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-label={title}>
        {title && (
          <header className="modal-head">
            <h2>{title}</h2>
            {onClose && (
              <button className="icon-btn" onClick={onClose} aria-label="Close">
                <Icon name="x" size={18} />
              </button>
            )}
          </header>
        )}
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function RichText({ html, className = '', as: Tag = 'div' }) {
  const { shorthands } = useSession();
  return <Tag className={`rich ${className}`} dangerouslySetInnerHTML={{ __html: richHtml(html, shorthands) }} />;
}

/**
 * A user's picture: a chosen glyph on a color ({ glyph, color }), a picture ({ photo }),
 * or initials as a fallback.
 */
export function Avatar({ name, avatar, photo, size = 28 }) {
  const src = avatar?.photo || (!avatar && photo);
  if (src) return <img className="avatar" src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" />;
  if (avatar?.glyph)
    return (
      <span className="avatar avatar-glyph" style={{ width: size, height: size, fontSize: size * 0.55, background: avatar.color }} aria-hidden="true">
        {avatar.glyph}
      </span>
    );
  const initials = (name || '?')
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="avatar avatar-fallback" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">
      {initials}
    </span>
  );
}

/** Someone's current avatar, looked up live by uid (names and avatars can change after posting). */
export function UserAvatar({ uid, name, size }) {
  const p = useProfiles().get(uid);
  return <Avatar name={p?.name || name} avatar={p?.avatar} photo={p?.avatar ? undefined : p?.photo} size={size} />;
}

/** Someone's current username, falling back to the name stored with what they wrote. */
export function UserName({ uid, fallback = 'someone' }) {
  const p = useProfiles().get(uid);
  return <>{p?.name || fallback}</>;
}

const REACTIONS = [
  { type: 'up', label: 'Agree' },
  { type: 'down', label: 'Disagree' },
  { type: 'q', label: 'Unclear / has questions' },
];

/** Thumbs up / thumbs down / question reactions. `onReact(type)` toggles. */
/** "Agree: you, Alice and 3 others" — who picked a reaction, for its tooltip. */
function whoReacted(label, reactions, type, names, myUid) {
  const uids = Object.keys(reactions || {}).filter((u) => reactions[u] === type);
  if (!uids.length) return `${label}: nobody yet`;
  const list = uids.map((u) => (u === myUid ? 'you' : names.get(u) || 'someone')).sort((a, b) => (a === 'you' ? -1 : b === 'you' ? 1 : a.localeCompare(b)));
  const shown = list.slice(0, 12);
  const rest = list.length - shown.length;
  const text = rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : shown[0];
  return `${label}: ${text}`;
}

export function Reactions({ reactions, onReact, compact = false }) {
  const { user } = useSession();
  const names = useUserNames();
  const counts = reactionCounts(reactions);
  const mine = user ? reactions?.[user.uid] : null;
  return (
    <div className={`reactions ${compact ? 'compact' : ''}`} role="group" aria-label="Reactions">
      {REACTIONS.map(({ type, label }) => (
        <button
          key={type}
          className={`reaction r-${type} ${mine === type ? 'mine' : ''}`}
          onClick={() => onReact(type)}
          title={whoReacted(label, reactions, type, names, user?.uid)}
          aria-label={`${label}, ${counts[type]}`}
          aria-pressed={mine === type}
        >
          <Icon name={type} size={compact ? 13 : 15} />
          <span>{counts[type]}</span>
        </button>
      ))}
    </div>
  );
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="spinner-wrap" role="status">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function timeAgo(ts) {
  const ms = ts?.toMillis ? ts.toMillis() : typeof ts === 'number' ? ts : null;
  if (!ms) return 'just now';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString();
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt('Copy this:', text);
    return false;
  }
}

/** Small transient status message under the header, optionally with one action button (e.g. Undo). */
export function toast(message, kind = 'info', action = null) {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = message;
  el.appendChild(text);
  let timer;
  const close = () => {
    clearTimeout(timer);
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  };
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.onclick = () => {
      close();
      action.onClick();
    };
    el.appendChild(btn);
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', () => (timer = setTimeout(close, 2500)));
  }
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  timer = setTimeout(close, action ? 6000 : 2600);
}

/** Undo one recorded action and say so. */
export async function undoWithToast(entry) {
  try {
    const label = await undo(entry);
    if (label) toast(`Undone: ${label}`, 'ok', { label: 'Redo', onClick: () => redoWithToast() });
  } catch (e) {
    console.error(e);
    toast(e?.code === 'permission-denied' ? 'That change can no longer be undone with your permissions.' : `Could not undo: ${e.message}`, 'error');
  }
}

export async function redoWithToast(entry) {
  try {
    const label = await redo(entry);
    if (label) toast(`Redone: ${label}`, 'ok', { label: 'Undo', onClick: () => undoWithToast() });
  } catch (e) {
    console.error(e);
    toast(`Could not redo: ${e.message}`, 'error');
  }
}

/**
 * Wrap an async action: records its writes for undo and shows errors as toasts instead of failing
 * silently. Resolves to the action's result (or `true`) on success, `undefined` on failure.
 * `label` names the action in the undo history when there is no success message.
 */
export async function attempt(fn, success, label) {
  try {
    const { result, entry } = await record(success || label, fn);
    if (success) toast(success, 'ok', entry ? { label: 'Undo', onClick: () => undoWithToast(entry) } : null);
    return result === undefined ? true : result;
  } catch (e) {
    console.error(e);
    toast(e?.code === 'permission-denied' ? 'You do not have permission to do that.' : `Something went wrong: ${e.message}`, 'error');
    return undefined;
  }
}

/** The site's disclaimer, in the footer and beside the rules (the owner can replace it in Admin → Site). */
export function Disclaimer() {
  const { brand } = useSession();
  if (brand.disclaimer) return <Linkify text={brand.disclaimer} />;
  return (
    <>
      A fan-made, community-maintained resource. Not affiliated with or endorsed by the game’s publishers.{' '}
      <span className="nowrap">Rules text © its respective owners.</span>
    </>
  );
}

// Web addresses in plain text, e.g. a version's source; a trailing full stop or bracket isn't part of one.
const URL_RE = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'])/g;

/** Plain text with any https:// address shown as a link (opening in a new tab). */
export function Linkify({ text }) {
  const parts = String(text || '').split(URL_RE);
  return parts.map((p, i) =>
    i % 2 ? (
      <a key={i} href={p} target="_blank" rel="noopener noreferrer">
        {p}
      </a>
    ) : (
      p
    ),
  );
}
