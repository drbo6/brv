import { useEffect, useState } from 'react';
import { CARD_LABELS, cardVersions, changedFields, createCardVersion, dataIn, deleteCardVersion, PRINTED, reactToCard, updateCardVersion } from '../lib/cardVersions.js';
import { displayTitle, FIELD_KINDS, imageUrl, isEmptyValue } from '../lib/components.js';
import { LABEL_CLASS } from '../lib/rules.js';
import { absoluteLink, href } from '../lib/router.js';
import { useSession } from '../lib/session.jsx';
import ComponentCard from './ComponentCard.jsx';
import { RulesetChoiceRow, useActiveRuleset } from './ActiveRuleset.jsx';
import Discussion from './Discussion.jsx';
import { alertDialog, confirmDialog } from './dialogs.jsx';
import { attempt, copyText, Icon, Modal, Reactions, RichText, timeAgo, toast, UserName } from './ui.jsx';
import FollowButton from './FollowButton.jsx';
import { autoFollow, cardTarget, notify, rulesetTarget, SUGGESTIONS } from '../lib/inbox.js';

/**
 * A component in detail: its card, all its data, alternate states, and its versions with
 * reactions and discussion, the same way rules work.
 */
export default function ComponentDetail({ type, comp, states, versionsOf, metaOf, commentCount, onClose }) {
  const { shorthands, isEditor, user, requireUser } = useSession();
  const { byIdValue, statesOf, idf, sf } = states;
  // The family: the base component plus all its alternate states.
  const baseId = sf && comp.data[sf.key]?.of ? String(comp.data[sf.key].of) : String(comp.data[idf?.key]);
  const base = byIdValue.get(baseId) || comp;
  const family = [{ comp: base, name: 'Default' }, ...(statesOf.get(baseId) || [])];
  const [current, setCurrent] = useState(comp);
  useEffect(() => {
    setCurrent(comp);
  }, [comp]);

  const vs = cardVersions(current, versionsOf(current.id), metaOf(current.id));
  // The version the active ruleset uses, including unsaved changes.
  const rs = useActiveRuleset();
  const { selectedSet } = rs;
  const savedId = selectedSet.cards?.[current.id];
  const chosenId = current.id in rs.overrides.cards ? rs.overrides.cards[current.id] : savedId;
  const active = vs.find((v) => v.id === chosenId) || vs[0];
  const [shownId, setShownId] = useState(null);
  useEffect(() => {
    setShownId(null);
  }, [current.id]);
  const shown = vs.find((v) => v.id === shownId) || active;
  const idx = vs.indexOf(shown);
  const data = dataIn(current, shown);
  const [discuss, setDiscuss] = useState(false);
  const [dialog, setDialog] = useState(null);

  const ownsShown = !shown.printed && user && shown.createdBy === user.uid && shown.label === 'Suggestion';
  const rows = type.fields.filter((f) => f.kind !== 'state' && !isEmptyValue(data[f.key], type));
  const name = displayTitle(type, { ...current, data });
  const follow = cardTarget(current, displayTitle(type, current));

  const step = (d) => setShownId(vs[(idx + d + vs.length) % vs.length].id);

  return (
    <Modal title={name} onClose={onClose} wide className="detail-modal">
      <div className="detail">
        <div className="detail-card">
          <ComponentCard type={type} comp={{ ...current, data }} shorthands={shorthands} />
          {family.length > 1 && (
            <div className="seg state-switch" role="group" aria-label="States">
              {family.map((s) => (
                <button key={s.comp.id} className={s.comp.id === current.id ? 'on' : ''} onClick={() => setCurrent(s.comp)} title={`Show the ${s.name.toLowerCase()} side of this component`}>
                  <Icon name="flip" size={13} />
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="detail-data">
          <div className="version-switch card-version-switch">
            {vs.length > 1 && (
              <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous version" title="Previous version">
                <Icon name="left" />
              </button>
            )}
            <span className={`label l-${shown.printed ? 'rulebook' : LABEL_CLASS[shown.label] || 'other'}`} title={shown.printed ? 'The card as printed' : `${shown.label} version`}>
              {shown.label}
            </span>
            {vs.length > 1 && (
              <>
                <span className="version-count" aria-live="polite" title={`${vs.length} versions of this card`}>
                  {idx + 1}/{vs.length}
                </span>
                <button className="icon-btn" onClick={() => step(1)} aria-label="Next version" title="Next version">
                  <Icon name="right" />
                </button>
              </>
            )}
            {shown.id !== active.id && (
              <span className="tag t-warn" title={`${selectedSet.name} uses the ${active.label} version of this card`}>
                Not in {selectedSet.name}
              </span>
            )}
            {shown.id === active.id && !active.printed && (
              <span className="tag t-community" title={`This is the version ${selectedSet.name} uses`}>
                In {selectedSet.name}
              </span>
            )}
          </div>
          {!shown.printed && (
            <p className="version-meta">
              <span>
                Added by <UserName uid={shown.createdBy} fallback={shown.createdByName} /> · {timeAgo(shown.createdAt)}
              </span>
              {shown.note && <span className="version-note">{shown.note}</span>}
            </p>
          )}

          <dl>
            {rows.map((f) => {
              const changed = !shown.printed && f.key in (shown.data || {});
              return (
                <div key={f.key} className={`detail-row ${changed ? 'changed' : ''}`} title={changed ? `Printed: ${String(current.data[f.key] ?? '—')}` : undefined}>
                  <dt>
                    {f.label}
                    <span className="kind-mini">{changed ? 'Changed' : FIELD_KINDS[f.kind]?.label}</span>
                  </dt>
                  <dd>
                    {f.kind === 'image' ? (
                      imageUrl(f, data[f.key]) ? (
                        <a href={imageUrl(f, data[f.key])} target="_blank" rel="noreferrer">
                          {String(data[f.key])}
                        </a>
                      ) : (
                        <code>{String(data[f.key])}</code>
                      )
                    ) : (
                      <RichText html={String(data[f.key])} as="span" />
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>

          <RulesetChoiceRow what="card" inSet={shown.id === active.id} active onUse={() => rs.setCard(current.id, shown.printed ? null : shown.id, savedId)} />

          <div className="rule-foot">
            <Reactions
              reactions={shown.reactions}
              onReact={(t) => requireUser((u) => attempt(() => reactToCard(current.id, shown, Boolean(metaOf(current.id)), u.uid, t), null, 'reaction'), 'talk')}
            />
            <div className="rule-actions">
              <button className={`chip ${discuss ? 'on' : ''}`} onClick={() => setDiscuss((o) => !o)} aria-expanded={discuss} title="Discuss this card">
                <Icon name="message" />
                <span>{commentCount(current.id)}</span>
                Discuss
              </button>
              <button className="chip" onClick={() => requireUser(() => setDialog('new'), isEditor ? null : 'suggest')} title={isEditor ? 'Add an official or community version of this card' : 'Propose different values for this card'}>
                <Icon name="bulb" />
                {isEditor ? 'Add version' : 'Suggest change'}
              </button>
              <FollowButton target={follow} what={`${follow.label} (its discussion and versions)`} />
              <button
                className="chip"
                onClick={async () => {
                  await copyText(absoluteLink('components', [type.id, current.id]));
                  toast('Link copied', 'ok');
                }}
                title="Copy a link to this card"
                aria-label="Copy link"
              >
                <Icon name="link" />
              </button>
            </div>
          </div>

          {(isEditor || ownsShown) && (
            <div className="admin-tools" role="group" aria-label="Edit tools">
              {isEditor && <span className="admin-tools-label">Admin</span>}
              {!shown.printed && (
                <button className="chip" onClick={() => setDialog('edit')}>
                  <Icon name="edit" />
                  Edit version
                </button>
              )}
              {!shown.printed && (
                <button
                  className="chip danger"
                  onClick={async () =>
                    (await confirmDialog({ title: 'Delete version', message: `Delete this ${shown.label} version of “${name}”?`, confirmLabel: 'Delete', danger: true })) &&
                    attempt(() => deleteCardVersion(shown.id), 'Version deleted').then(() => setShownId(PRINTED))
                  }
                >
                  <Icon name="trash" />
                  Delete version
                </button>
              )}
              {isEditor && (
                <a className="chip btn" href={href('admin', ['components', type.id], { tab: 'list', edit: current.id })} title="Edit the printed card's data">
                  <Icon name="edit" />
                  Edit printed card
                </a>
              )}
            </div>
          )}

          {discuss && <Discussion target={{ field: 'componentId', id: current.id, name }} follow={follow} versions={vs} shownVersion={shown} />}
        </div>
      </div>
      {dialog && (
        <CardVersionDialog
          type={type}
          comp={current}
          version={dialog === 'edit' ? shown : null}
          startData={data}
          onClose={() => setDialog(null)}
          onSaved={(id) => id && setShownId(id)}
        />
      )}
    </Modal>
  );
}

/** Suggest (or, for admins, add) a version of a card, or edit one. Stores only the changed fields. */
function CardVersionDialog({ type, comp, version, startData, onClose, onSaved }) {
  const { isEditor, user } = useSession();
  const editable = type.fields.filter((f) => f.kind !== 'id' && f.kind !== 'state');
  const [values, setValues] = useState(() => Object.fromEntries(editable.map((f) => [f.key, startData[f.key] ?? ''])));
  const [label, setLabel] = useState(version?.label || (isEditor ? 'Community' : 'Suggestion'));
  const [note, setNote] = useState(version?.note || '');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const data = changedFields(comp, Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) && typeof comp.data[k] === 'number' ? Number(v) : v])));
    if (!Object.keys(data).length) return alertDialog({ title: 'Nothing changed', message: 'Change at least one value compared to the printed card.' });
    setBusy(true);
    const id = version
      ? await attempt(() => updateCardVersion(version.id, isEditor ? { data, note: note.trim(), label } : { data, note: note.trim() }), 'Version saved')
      : await attempt(() => createCardVersion({ comp, label: isEditor ? label : 'Suggestion', data, note: note.trim() }, user), isEditor ? 'Version added' : 'Thanks! Your suggestion was added.');
    setBusy(false);
    if (id !== undefined) {
      onSaved(version ? version.id : id);
      const t = cardTarget(comp, comp.data[type.fields.find((f) => f.kind === 'title')?.key] || comp.id);
      const who = user.displayName || 'Someone';
      const changes = Object.keys(data).join(', ');
      if (version) notify(t.key, user, { type: 'version', title: `${who} edited a version of ${t.label}`, text: `Changes: ${changes}`, link: t.link });
      else {
        autoFollow(t.key, user.uid, t);
        const title = isEditor ? `${who} added a ${label} version of ${t.label}` : `${who} suggested a change to ${t.label}`;
        notify(t.key, user, { type: 'version', title, text: `Changes: ${changes}`, link: t.link });
        if (!isEditor) notify(SUGGESTIONS.key, user, { type: 'suggestion', title, text: `Changes: ${changes}`, link: t.link });
      }
      onClose();
    }
  };

  return (
    <Modal title={version ? 'Edit card version' : isEditor ? 'New card version' : 'Suggest a change to this card'} onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        {!version && !isEditor && <p className="muted">Change the values you want to propose. Your suggestion appears as a “Suggestion” version that others can react to and discuss.</p>}
        {isEditor && (
          <div className="field">
            <label>Label</label>
            <div className="seg">
              {CARD_LABELS.map((l) => (
                <button type="button" key={l} className={label === l ? 'on' : ''} onClick={() => setLabel(l)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid-2">
          {editable.map((f) => {
            const changed = String(values[f.key] ?? '') !== String(comp.data[f.key] ?? '');
            const long = f.kind === 'ability' || f.kind === 'lore';
            return (
              <div key={f.key} className={`field ${long ? 'span-all' : ''} ${changed ? 'is-changed' : ''}`}>
                <label htmlFor={`cv-${f.key}`}>
                  {f.label}
                  {changed && (
                    <button type="button" className="link-btn small" onClick={() => setValues((v) => ({ ...v, [f.key]: comp.data[f.key] ?? '' }))} title={`Printed: ${String(comp.data[f.key] ?? '—')}`}>
                      reset
                    </button>
                  )}
                </label>
                {long ? (
                  <textarea id={`cv-${f.key}`} rows={3} value={values[f.key]} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
                ) : (
                  <input id={`cv-${f.key}`} value={values[f.key]} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
                )}
              </div>
            );
          })}
        </div>
        <div className="field">
          <label htmlFor="cv-note">Rationale or source</label>
          <input id="cv-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Errata from the designer, or why this balances the card" maxLength={500} />
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={busy}>
            {version ? 'Save' : isEditor ? 'Add version' : 'Submit suggestion'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
