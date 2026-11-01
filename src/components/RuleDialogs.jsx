import { useState } from 'react';
import { createRule, createVersion, KINDS, LABELS, nextCode, updateRule, updateVersion } from '../lib/rules.js';
import { useSession } from '../lib/session.jsx';
import { attempt, Modal, RichText } from './ui.jsx';

function TextWithPreview({ value, onChange, label = 'Text', rows = 7 }) {
  const [preview, setPreview] = useState(false);
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
        <RichText html={value || '<p class="muted">Nothing to preview.</p>'} className="preview-box rule-text" />
      ) : (
        <textarea id="rule-text" value={value} onChange={(e) => onChange(e.target.value)} rows={rows} required />
      )}
      <p className="hint">
        Basic HTML works: <code>&lt;b&gt;</code>, <code>&lt;i&gt;</code>, <code>&lt;ul&gt;&lt;li&gt;</code>, <code>&lt;p&gt;</code>. Shorthands like <code>[rage]</code> are
        replaced with icons. Plain line breaks become paragraphs.
      </p>
    </div>
  );
}

/** Plain text typed without HTML tags gets paragraphs, so it renders like the rulebook. */
const normalizeText = (t) => (/<\/?[a-z][\s\S]*>/i.test(t) ? t.trim() : t.trim().split(/\n\s*\n/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join(''));

/** Suggest (or, for admins, add) a new version of an existing rule — or edit one. */
export function VersionDialog({ rule, version, onClose }) {
  const { isAdmin, user } = useSession();
  const editing = Boolean(version);
  const [label, setLabel] = useState(version?.label || (isAdmin ? 'Community' : 'Suggestion'));
  const [text, setText] = useState(version?.text || '');
  const [note, setNote] = useState(version?.note || '');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const data = { label: isAdmin ? label : 'Suggestion', text: normalizeText(text), note: note.trim() };
    const ok = editing
      ? await attempt(() => updateVersion(version.id, isAdmin ? data : { text: data.text, note: data.note }), 'Version saved')
      : await attempt(() => createVersion({ ruleId: rule.id, ...data }, user), isAdmin ? 'Version added' : 'Thanks! Your suggestion was added.');
    setBusy(false);
    if (ok !== undefined) onClose();
  };

  return (
    <Modal title={editing ? `Edit version of ${rule.code}` : isAdmin ? `New version of ${rule.code}` : `Suggest a change to ${rule.code}`} onClose={onClose} wide>
      <form onSubmit={submit} className="form">
        {!editing && !isAdmin && <p className="muted">Propose new wording or a clarification. It will appear as a “Suggestion” version that others can react to and discuss.</p>}
        {isAdmin && (
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
            {editing ? 'Save' : isAdmin ? 'Add version' : 'Submit suggestion'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Create a new rule (users: as a suggestion) or edit an existing rule's details (admins). */
export function RuleDialog({ rule, tree, rules, defaultSectionId, onClose, onCreated }) {
  const { isAdmin, user } = useSession();
  const editing = Boolean(rule);
  const firstSection = defaultSectionId || tree.ordered[0]?.id || '';
  const [sectionId, setSectionId] = useState(rule?.sectionId || firstSection);
  const sectionCode = (id) => tree.byId.get(id)?.code || 'GEN';
  const [code, setCode] = useState(rule?.code || nextCode(sectionCode(firstSection), rules));
  const [codeTouched, setCodeTouched] = useState(editing);
  const [title, setTitle] = useState(rule?.title || '');
  const [kind, setKind] = useState(rule?.kind || 'rule');
  const [page, setPage] = useState(rule?.page ?? '');
  const [status, setStatus] = useState(rule?.status || 'active');
  const [label, setLabel] = useState('Community');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const codeTaken = isAdmin && rules.some((r) => r.code.toLowerCase() === code.trim().toLowerCase() && r.id !== rule?.id);

  const changeSection = (id) => {
    setSectionId(id);
    if (!codeTouched) setCode(nextCode(sectionCode(id), rules));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (codeTaken) return;
    setBusy(true);
    const siblings = rules.filter((r) => r.sectionId === sectionId && r.id !== rule?.id);
    const order = siblings.reduce((m, r) => Math.max(m, r.order ?? 0), 0) + 1;
    let ok;
    if (editing) {
      const patch = { title: title.trim(), sectionId, code: code.trim(), kind, page: page === '' ? null : Number(page), status };
      if (sectionId !== rule.sectionId) patch.order = order;
      ok = await attempt(() => updateRule(rule.id, patch), 'Rule saved');
    } else {
      const meta = isAdmin
        ? { code: code.trim(), sectionId, order, title: title.trim(), kind, page: page === '' ? null : Number(page), status }
        : { code: `SUG-${Math.random().toString(36).slice(2, 6).toUpperCase()}`, sectionId, order, title: title.trim(), kind: 'rule', status: 'suggested' };
      const version = { label: isAdmin ? label : 'Suggestion', text: normalizeText(text), note: note.trim() };
      ok = await attempt(() => createRule(meta, version, user), isAdmin ? 'Rule added' : 'Thanks! Your rule suggestion was added.');
      if (ok) onCreated?.(meta.code);
    }
    setBusy(false);
    if (ok !== undefined) onClose();
  };

  return (
    <Modal title={editing ? `Edit rule ${rule.code}` : isAdmin ? 'Add a rule' : 'Suggest a new rule'} onClose={onClose} wide>
      <form onSubmit={submit} className="form">
        {!editing && !isAdmin && (
          <p className="muted">
            Suggested rules are visible to everyone (turn on “Show inactive”) and can be discussed. Admins may adopt them into the official FAQ.
          </p>
        )}
        <div className="grid-2">
          <div className="field">
            <label htmlFor="r-section">Section</label>
            <select id="r-section" value={sectionId} onChange={(e) => changeSection(e.target.value)} required>
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
        {isAdmin && (
          <div className="grid-4">
            <div className="field">
              <label htmlFor="r-code">ID</label>
              <input
                id="r-code"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\s+/g, ''));
                  setCodeTouched(true);
                }}
                required
                aria-invalid={codeTaken}
              />
              {codeTaken && <p className="error small">That ID is already used.</p>}
            </div>
            <div className="field">
              <label htmlFor="r-kind">Kind</label>
              <select id="r-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                {Object.entries(KINDS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
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
            {isAdmin && (
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
          <button className="primary" type="submit" disabled={busy || !title.trim() || (!editing && !text.trim()) || codeTaken}>
            {editing ? 'Save' : isAdmin ? 'Add rule' : 'Submit suggestion'}
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
