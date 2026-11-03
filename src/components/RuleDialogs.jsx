import { useRef, useState } from 'react';
import { escapeHtml } from '../lib/html.js';
import { createRule, createVersion, LABELS, ruleName, updateRule, updateVersion } from '../lib/rules.js';
import { useSession } from '../lib/session.jsx';
import { attempt, Icon, Modal, RichText } from './ui.jsx';
import { confirmDialog, promptDialog } from './dialogs.jsx';
import { autoFollow, notify, ruleTarget, SUGGESTIONS } from '../lib/inbox.js';

/** Insert text at the cursor through the browser, so the textarea's own Ctrl+Z still works. */
function insertAtCursor(el, before, after = '', placeholder = '') {
  el.focus();
  const { selectionStart: a, selectionEnd: b, value } = el;
  const middle = value.slice(a, b) || placeholder;
  const text = `${before}${middle}${after}`;
  if (!document.execCommand?.('insertText', false, text)) {
    el.setRangeText(text, a, b, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  // Select the placeholder so it can be typed over.
  if (middle) el.setSelectionRange(a + before.length, a + before.length + middle.length);
}

function ImageForm({ onInsert, onCancel }) {
  const [url, setUrl] = useState('');
  const [alt, setAlt] = useState('');
  const [caption, setCaption] = useState('');
  const [broken, setBroken] = useState(false);
  const valid = /^https:\/\/\S+$/i.test(url.trim());
  const submit = () => {
    if (!valid) return;
    const img = `<img src="${escapeHtml(url.trim())}" alt="${escapeHtml(alt.trim())}">`;
    // Blank lines around it make the image its own paragraph in plain-text rules.
    onInsert(caption.trim() ? `\n\n<figure>${img}<figcaption>${escapeHtml(caption.trim())}</figcaption></figure>\n\n` : `\n\n${img}\n\n`);
  };
  const onKeyDown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    submit();
  };
  return (
    <div className="image-form" onKeyDown={onKeyDown}>
      <div className="image-form-fields">
        <div className="field">
          <label htmlFor="img-url">Image address (https://…)</label>
          <input
            id="img-url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setBroken(false);
            }}
            placeholder="https://i.imgur.com/example.png"
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="img-alt">Description (for screen readers)</label>
          <input id="img-alt" value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="e.g. Board with three clans in Midgard" />
        </div>
        <div className="field">
          <label htmlFor="img-cap">Caption (optional)</label>
          <input id="img-cap" value={caption} onChange={(e) => setCaption(e.target.value)} />
        </div>
      </div>
      <div className="image-form-preview">
        {valid && !broken ? <img src={url.trim()} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : <span className="muted small">{broken ? 'That image could not be loaded.' : 'Preview'}</span>}
      </div>
      <div className="row gap">
        <button type="button" className="small" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="small primary" onClick={submit} disabled={!valid}>
          Insert image
        </button>
      </div>
      <p className="hint">The image stays on its own host (Imgur, BoardGameGeek, a public cloud link…). Use https addresses.</p>
    </div>
  );
}

function TextWithPreview({ value, onChange, label = 'Text', rows = 7 }) {
  const [preview, setPreview] = useState(false);
  const [imageForm, setImageForm] = useState(false);
  const ref = useRef(null);
  const wrap = (before, after, placeholder) => ref.current && insertAtCursor(ref.current, before, after, placeholder);
  const addLink = async () => {
    const el = ref.current;
    const sel = el ? [el.selectionStart, el.selectionEnd] : null;
    const url = await promptDialog({ title: 'Insert link', label: 'Link address', placeholder: 'https://…', confirmLabel: 'Insert link', validate: (v) => (/^https?:\/\/\S+$/i.test(v.trim()) ? '' : 'Enter an address starting with https://') });
    if (!url || !el) return;
    el.setSelectionRange(...sel);
    wrap(`<a href="${escapeHtml(url.trim())}">`, '</a>', 'link text');
  };
  return (
    <div className="field">
      <div className="field-label-row">
        <label htmlFor="rule-text">{label}</label>
        <div className="seg">
          <button type="button" className={!preview ? 'on' : ''} onClick={() => setPreview(false)}>
            Write
          </button>
          <button type="button" className={preview ? 'on' : ''} onClick={() => setPreview(true)}>
            Preview
          </button>
        </div>
      </div>
      {preview ? (
        <RichText html={normalizeText(value) || '<p class="muted">Nothing to preview.</p>'} className="preview-box rule-text" />
      ) : (
        <>
          <div className="editor-toolbar" role="toolbar" aria-label="Formatting">
            <button type="button" className="icon-btn" title="Bold" aria-label="Bold" onClick={() => wrap('<b>', '</b>', 'bold text')}>
              <Icon name="bold" />
            </button>
            <button type="button" className="icon-btn" title="Italic" aria-label="Italic" onClick={() => wrap('<i>', '</i>', 'italic text')}>
              <Icon name="italic" />
            </button>
            <button type="button" className="icon-btn" title="Bulleted list" aria-label="Bulleted list" onClick={() => wrap('\n<ul>\n  <li>', '</li>\n</ul>\n', 'item')}>
              <Icon name="list" />
            </button>
            <button type="button" className="icon-btn" title="Link" aria-label="Link" onClick={addLink}>
              <Icon name="link" />
            </button>
            <button
              type="button"
              className={`icon-btn ${imageForm ? 'on' : ''}`}
              title="Insert an image from a web address"
              aria-label="Insert image"
              aria-expanded={imageForm}
              onClick={() => setImageForm((o) => !o)}
            >
              <Icon name="image" />
              <span>Image</span>
            </button>
          </div>
          {imageForm && (
            <ImageForm
              onCancel={() => setImageForm(false)}
              onInsert={(html) => {
                setImageForm(false);
                if (ref.current) insertAtCursor(ref.current, html);
                else onChange(`${value}${html}`);
              }}
            />
          )}
          <textarea ref={ref} id="rule-text" value={value} onChange={(e) => onChange(e.target.value)} rows={rows} required />
        </>
      )}
      <p className="hint">
        Basic HTML works: <code>&lt;b&gt;</code>, <code>&lt;i&gt;</code>, <code>&lt;ul&gt;&lt;li&gt;</code>, <code>&lt;p&gt;</code>, <code>&lt;img&gt;</code>. Shorthands like{' '}
        <code>[rage]</code> are replaced with icons. Plain line breaks become paragraphs.
      </p>
    </div>
  );
}

/** Plain text typed without HTML tags gets paragraphs, so it renders like the rulebook. */
// Blocks separated by blank lines become paragraphs, unless they already start with a block tag.
const BLOCK_START = /^<(p|ul|ol|div|blockquote|figure|h4|h5|hr)\b/i;
const normalizeText = (t) => {
  const s = t.trim();
  // Fully structured HTML (e.g. the transcribed rulebook) is kept exactly as is.
  if (BLOCK_START.test(s) && !/\n\s*\n/.test(s)) return s;
  return s
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (BLOCK_START.test(p) ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`))
    .join('');
};

/** Suggest (or, for admins, add) a new version of an existing rule — or edit one. */
export function VersionDialog({ rule, version, onClose }) {
  const { isEditor, user } = useSession();
  const editing = Boolean(version);
  const [label, setLabel] = useState(version?.label || (isEditor ? 'Community' : 'Suggestion'));
  const [text, setText] = useState(version?.text || '');
  const [note, setNote] = useState(version?.note || '');
  const [busy, setBusy] = useState(false);
  // Versions update live: notice when someone else saves this one while it is open here.
  const [openedWith, setOpenedWith] = useState(() => (version ? version.text + version.note : ''));
  const changedElsewhere = editing && version.text + version.note !== openedWith;

  const submit = async (e) => {
    e.preventDefault();
    if (changedElsewhere) {
      const ok = await confirmDialog({
        title: 'Someone else changed this version',
        message: 'This version was saved by someone else while you were editing. Saving replaces their wording with yours.',
        confirmLabel: 'Save mine anyway',
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    const data = { label: isEditor ? label : 'Suggestion', text: normalizeText(text), note: note.trim() };
    const ok = editing
      ? await attempt(() => updateVersion(version.id, isEditor ? data : { text: data.text, note: data.note }), 'Version saved')
      : await attempt(() => createVersion({ ruleId: rule.id, ...data }, user), isEditor ? 'Version added' : 'Thanks! Your suggestion was added.');
    setBusy(false);
    if (ok === undefined) return;
    onClose();
    const t = ruleTarget(rule);
    const who = user.displayName || 'Someone';
    if (editing) {
      notify(t.key, user, { type: 'version', title: `${who} edited the ${data.label} version of ${t.label}`, text: data.text, link: t.link });
    } else {
      // Suggesting follows the rule, so the author hears about reactions to it in the discussion.
      autoFollow(t.key, user.uid, t);
      const title = isEditor ? `${who} added a ${data.label} version of ${t.label}` : `${who} suggested a change to ${t.label}`;
      notify(t.key, user, { type: 'version', title, text: data.text, link: t.link });
      if (!isEditor) notify(SUGGESTIONS.key, user, { type: 'suggestion', title, text: data.text, link: t.link });
    }
  };

  return (
    <Modal title={editing ? `Edit version of ${ruleName(rule)}` : isEditor ? `New version of ${ruleName(rule)}` : `Suggest a change to ${ruleName(rule)}`} onClose={onClose} wide>
      {changedElsewhere && (
        <div className="conflict-bar" role="alert">
          <Icon name="info" />
          <span>Someone else saved this version while you were editing it.</span>
          <button
            type="button"
            className="small"
            onClick={() => {
              setText(version.text);
              setNote(version.note || '');
              setOpenedWith(version.text + version.note);
            }}
          >
            Load their version
          </button>
        </div>
      )}
      <form onSubmit={submit} className="form">
        {!editing && !isEditor && <p className="muted">Propose new wording or a clarification. It will appear as a “Suggestion” version that others can react to and discuss.</p>}
        {isEditor && (
          <div className="field">
            <label>Label</label>
            <div className="seg">
              {LABELS.map((l) => (
                <button type="button" key={l} className={label === l ? 'on' : ''} onClick={() => setLabel(l)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        )}
        <TextWithPreview value={text} onChange={setText} />
        <div className="field">
          <label htmlFor="v-note">Rationale or source</label>
          <input id="v-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Designer ruling on BGG, or why this improves balance" maxLength={500} />
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy || !text.trim()}>
            {editing ? 'Save' : isEditor ? 'Add version' : 'Submit suggestion'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Create a new rule (users: as a suggestion) or edit an existing rule's details (admins). */
export function RuleDialog({ rule, tree, rules, defaultSectionId, onClose, onCreated }) {
  const { isEditor, user, kinds } = useSession();
  const editing = Boolean(rule);
  const firstSection = defaultSectionId || tree.ordered[0]?.id || '';
  const [sectionId, setSectionId] = useState(rule?.sectionId || firstSection);
  const [title, setTitle] = useState(rule?.title || '');
  const [kind, setKind] = useState(rule?.kind || 'rule');
  const [page, setPage] = useState(rule?.page ?? '');
  const [status, setStatus] = useState(rule?.status || 'active');
  const [label, setLabel] = useState('Community');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const siblings = rules.filter((r) => r.sectionId === sectionId && r.id !== rule?.id);
    const order = siblings.reduce((m, r) => Math.max(m, r.order ?? 0), 0) + 1;
    let ok;
    if (editing) {
      const patch = { title: title.trim(), sectionId, kind, page: page === '' ? null : Number(page), status };
      if (sectionId !== rule.sectionId) patch.order = order;
      ok = await attempt(() => updateRule(rule.id, patch), 'Rule saved');
    } else {
      const meta = isEditor
        ? { sectionId, order, title: title.trim(), kind, page: page === '' ? null : Number(page), status }
        : { sectionId, order, title: title.trim(), kind: 'rule', status: 'suggested' };
      const version = { label: isEditor ? label : 'Suggestion', text: normalizeText(text), note: note.trim() };
      ok = await attempt(() => createRule(meta, version, user), isEditor ? 'Rule added' : 'Thanks! Your rule suggestion was added.');
      if (ok) {
        onCreated?.(ok);
        const t = ruleTarget({ id: ok, title: meta.title });
        autoFollow(t.key, user.uid, t);
        if (!isEditor) notify(SUGGESTIONS.key, user, { type: 'suggestion', title: `${user.displayName || 'Someone'} suggested a new rule: ${meta.title}`, text: version.text, link: t.link });
      }
    }
    setBusy(false);
    if (ok !== undefined) onClose();
  };

  return (
    <Modal title={editing ? `Edit rule ${ruleName(rule)}` : isEditor ? 'Add a rule' : 'Suggest a new rule'} onClose={onClose} wide>
      <form onSubmit={submit} className="form">
        {!editing && !isEditor && (
          <p className="muted">
            Suggested rules are visible to everyone (turn on “Show inactive”) and can be discussed. Admins may adopt them into the official FAQ.
          </p>
        )}
        <div className="grid-2">
          <div className="field">
            <label htmlFor="r-section">Section</label>
            <select id="r-section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} required>
              {tree.ordered.map((s) => (
                <option key={s.id} value={s.id}>
                  {'  '.repeat(s.depth)}
                  {s.number} {s.title}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="r-title">Short title</label>
            <input id="r-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={80} placeholder="e.g. Summoning at 0 Rage" />
          </div>
        </div>
        {isEditor && (
          <div className="grid-3">
            <div className="field">
              <label htmlFor="r-kind">Kind</label>
              <select id="r-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                {kinds.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
                {!kinds.some((k) => k.id === kind) && <option value={kind}>{kind} (removed kind)</option>}
              </select>
            </div>
            <div className="field">
              <label htmlFor="r-page">Rulebook page</label>
              <input id="r-page" type="number" min="0" value={page} onChange={(e) => setPage(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="r-status">Status</label>
              <select id="r-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="active">Active</option>
                <option value="suggested">Suggested</option>
                <option value="rejected">Rejected (hidden)</option>
              </select>
            </div>
          </div>
        )}
        {!editing && (
          <>
            {isEditor && (
              <div className="field">
                <label>Label of the first version</label>
                <div className="seg">
                  {LABELS.map((l) => (
                    <button type="button" key={l} className={label === l ? 'on' : ''} onClick={() => setLabel(l)}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <TextWithPreview value={text} onChange={setText} />
            <div className="field">
              <label htmlFor="r-note">Rationale or source</label>
              <input id="r-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
            </div>
          </>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy || !title.trim() || (!editing && !text.trim())}>
            {editing ? 'Save' : isEditor ? 'Add rule' : 'Submit suggestion'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function SaveRulesetDialog({ initialName = '', initialDescription = '', title = 'Save as a new ruleset', onSave, onClose }) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const ok = await onSave({ name: name.trim(), description: description.trim() });
          setBusy(false);
          if (ok !== undefined) onClose();
        }}
      >
        <div className="field">
          <label htmlFor="rs-name">Name</label>
          <input id="rs-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="e.g. Our table’s house rules" />
        </div>
        <div className="field">
          <label htmlFor="rs-desc">Description</label>
          <textarea id="rs-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1000} />
        </div>
        <p className="hint">New rulesets are private to you, but anyone with the link can view them. Admins can make a ruleset available to everyone.</p>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy || !name.trim()}>
            Save ruleset
          </button>
        </div>
      </form>
    </Modal>
  );
}
