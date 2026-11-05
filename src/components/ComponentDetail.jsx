import { useEffect, useState } from 'react';
import { CARD_LABELS, cardChoiceOf, cardVersions, changedFields, createCardVersion, dataIn, deleteCardVersion, PRINTED, reactToCard, updateCardVersion } from '../lib/cardVersions.js';
import { deleteComponents, displayTitle } from '../lib/components.js';
import ComponentForm from './ComponentForm.jsx';
import AttachedRules from './AttachedRules.jsx';
import { findVersion, HB, LABEL_CLASS } from '../lib/rules.js';
import { createHomebrew, updateHomebrew } from '../lib/homebrew.js';
import { HomebrewBar } from './Homebrew.jsx';
import { absoluteLink, navigate } from '../lib/router.js';
import { useSession } from '../lib/session.jsx';
import ComponentCard from './ComponentCard.jsx';
import { RulesetChoiceRow, useActiveRuleset } from './ActiveRuleset.jsx';
import Discussion from './Discussion.jsx';
import { alertDialog, confirmDialog } from './dialogs.jsx';
import { attempt, copyText, Icon, Linkify, Modal, Reactions, timeAgo, toast, UserName } from './ui.jsx';
import FollowButton from './FollowButton.jsx';
import { autoFollow, cardTarget, notify } from '../lib/inbox.js';

/**
 * A component in detail: its card, all its data, alternate states, and its versions with
 * reactions and discussion, the same way rules work.
 */
export default function ComponentDetail({ type, comp, states, versionsOf, metaOf, commentCount, allComps, onChanged, onClose }) {
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
  // The ruleset's choice for this card: a version, printed, or left out (null), saved and with changes.
  const savedChoice = cardChoiceOf(selectedSet, selectedSet.cards, current.id);
  const choice = cardChoiceOf(selectedSet, rs.apply(selectedSet.cards, 'cards'), current.id);
  // A chosen version that no longer exists falls back to the printed card.
  const active = choice ? findVersion(vs, choice) || vs[0] : null;
  const [shownId, setShownId] = useState(null);
  useEffect(() => {
    setShownId(null);
  }, [current.id]);
  const shown = findVersion(vs, shownId) || active || vs[0];
  const idx = vs.indexOf(shown);
  const data = dataIn(current, shown);
  const [discuss, setDiscuss] = useState(false);
  const [dialog, setDialog] = useState(null);

  // The reader's homebrew behind the version on screen: private, or the public copy they shared.
  const hb = shown.homebrew || (shown.homebrewId && user && shown.createdBy === user.uid ? rs.myHomebrew.find((h) => h.id === shown.homebrewId) : null) || null;
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
          <AttachedRules compId={current.id} name={name} />

          <div className="card-interact">
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
              {active && shown.id !== active.id && (
                <span className="tag t-warn" title={`${selectedSet.name} uses the ${active.label} version of this card`}>
                  Not in {selectedSet.name}
                </span>
              )}
              {!active && (
                <span className="tag t-muted" title={`${selectedSet.name} leaves this card out`}>
                  Left out of {selectedSet.name}
                </span>
              )}
              {active && shown.id === active.id && !active.printed && (
                <span className="tag t-community" title={`This is the version ${selectedSet.name} uses`}>
                  In {selectedSet.name}
                </span>
              )}
              {!shown.homebrew && (
                <Reactions
                  reactions={shown.reactions}
                  onReact={(t) => requireUser((u) => attempt(() => reactToCard(current.id, shown, Boolean(metaOf(current.id)), u.uid, t), null, 'reaction'), 'talk')}
                />
              )}
            </div>
            {!shown.printed && !shown.homebrew && (
              <p className="version-meta">
                <span>
                  Added by <UserName uid={shown.createdBy} fallback={shown.createdByName} /> · {timeAgo(shown.createdAt)}
                </span>
                {shown.note && (
                  <span className="version-note">
                    <Linkify text={shown.note} />
                  </span>
                )}
              </p>
            )}
            {shown.homebrew && shown.note && (
              <p className="version-meta">
                <span className="version-note">
                  <Linkify text={shown.note} />
                </span>
              </p>
            )}
            <div className="rule-actions card-actions">
                <button className={`chip ${discuss ? 'on' : ''}`} onClick={() => setDiscuss((o) => !o)} aria-expanded={discuss} title="Discuss this card">
                  <Icon name="message" />
                  <span>{commentCount(current.id)}</span>
                  <span className="hide-sm">Discuss</span>
                </button>
                {user && (
                  <button className="chip" onClick={() => rs.startHomebrew(() => setDialog('brew'))} title="Change this card your own way. Only you see your homebrew; share it when you want others to consider it.">
                    <Icon name="flask" />
                    <span className="hide-sm">Homebrew</span>
                  </button>
                )}
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
            {hb && <HomebrewBar hb={hb} pub={shown.homebrew ? null : shown} target={follow} onEdit={() => setDialog('brewEdit')} onDeleted={() => setShownId(PRINTED)} />}
            <RulesetChoiceRow
              what="card"
              inSet={Boolean(active) && shown.id === active.id}
              active={Boolean(active)}
              onUse={() => rs.setCard(current.id, shown.printed ? PRINTED : shown.id, savedChoice)}
              onAdd={() => rs.setCard(current.id, shown.printed ? PRINTED : shown.id, savedChoice)}
              onRemove={() => rs.setCard(current.id, null, savedChoice)}
            />

          {isEditor && (
            <div className="admin-tools" role="group" aria-label="Admin tools">
              <span className="admin-tools-label">Admin</span>
              <button className="chip" onClick={() => setDialog('new')} title="Add an official, community or other public version of this card">
                <Icon name="plus" />
                Add version
              </button>
              {!shown.printed && !shown.homebrew && (
                <button className="chip" onClick={() => setDialog('edit')}>
                  <Icon name="edit" />
                  Edit version
                </button>
              )}
              {!shown.printed && !shown.homebrew && (
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
              <button className="chip" onClick={() => setDialog('printed')} title="Edit the card's own (printed) data">
                <Icon name="edit" />
                Edit card
              </button>
              <button
                className="chip danger"
                title="Delete this card (you can undo this)"
                onClick={async () => {
                  if (!(await confirmDialog({ title: 'Delete card', message: `Delete “${displayTitle(type, current)}” with its data? Its versions and discussion stay, but nothing links to them.`, confirmLabel: 'Delete card', danger: true }))) return;
                  const ok = await attempt(() => deleteComponents([current.id]), `Deleted ${displayTitle(type, current)}`);
                  if (ok) {
                    onClose();
                    onChanged?.();
                  }
                }}
              >
                <Icon name="trash" />
                Delete card
              </button>
            </div>
          )}
          </div>

          {discuss && <Discussion target={{ field: 'componentId', id: current.id, name }} follow={follow} versions={vs} shownVersion={shown} />}
        </div>
      </div>
      {dialog === 'printed' && (
        <ComponentForm
          type={type}
          comp={current}
          comps={allComps}
          onClose={() => setDialog(null)}
          onSaved={async (id) => {
            await onChanged?.();
            // A changed ID gives the card a new address.
            if (id && id !== current.id) navigate('components', [type.id, id], {}, { replace: true });
          }}
        />
      )}
      {dialog && dialog !== 'printed' && (
        <CardVersionDialog
          type={type}
          comp={current}
          version={dialog === 'edit' ? shown : null}
          homebrew={dialog === 'brew' ? true : dialog === 'brewEdit' ? hb : null}
          startData={data}
          onClose={() => setDialog(null)}
          onSaved={(id) => id && setShownId(id)}
        />
      )}
    </Modal>
  );
}

/**
 * A version of a card, or edit one; stores only the changed fields. Everyone writes homebrew
 * (`homebrew`: true for a new one, or the homebrew to edit); admins also add public versions.
 */
function CardVersionDialog({ type, comp, version, homebrew, startData, onClose, onSaved }) {
  const { user } = useSession();
  const rs = useActiveRuleset();
  const hb = homebrew && typeof homebrew === 'object' ? homebrew : null;
  const brew = Boolean(homebrew);
  const editable = type.fields.filter((f) => f.kind !== 'id' && f.kind !== 'state');
  // Editing a homebrew starts from its own values; a new one from the version on screen.
  const start = hb ? { ...comp.data, ...hb.data } : startData;
  const [values, setValues] = useState(() => Object.fromEntries(editable.map((f) => [f.key, start[f.key] ?? ''])));
  const [label, setLabel] = useState(version?.label || 'Community');
  const [note, setNote] = useState((hb || version)?.note || '');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const data = changedFields(comp, Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) && typeof comp.data[k] === 'number' ? Number(v) : v])));
    if (!Object.keys(data).length) return alertDialog({ title: 'Nothing changed', message: 'Change at least one value compared to the printed card.' });
    setBusy(true);
    if (brew) {
      const id = hb
        ? await attempt(() => updateHomebrew(hb, { data, note: note.trim() }), 'Homebrew saved')
        : await attempt(() => createHomebrew({ kind: 'card', componentId: comp.id, typeId: comp.typeId, data, note: note.trim() }, user, rs.selectedSet.id), `Homebrew saved and used in “${rs.selectedSet.name}”: only you see it`);
      setBusy(false);
      if (id === undefined) return;
      if (!hb) rs.homebrewUsed('cards', comp.id);
      if (!hb) onSaved(HB + id);
      return onClose();
    }
    const id = version
      ? await attempt(() => updateCardVersion(version.id, { data, note: note.trim(), label }), 'Version saved')
      : await attempt(() => createCardVersion({ comp, label, data, note: note.trim() }, user), 'Version added');
    setBusy(false);
    if (id !== undefined) {
      onSaved(version ? version.id : id);
      const t = cardTarget(comp, comp.data[type.fields.find((f) => f.kind === 'title')?.key] || comp.id);
      const who = user.displayName || 'Someone';
      const changes = Object.keys(data).join(', ');
      if (version) notify(t.key, user, { type: 'version', title: `${who} edited a version of ${t.label}`, text: `Changes: ${changes}`, link: t.link });
      else {
        autoFollow(t.key, user.uid, t);
        notify(t.key, user, { type: 'version', title: `${who} added a ${label} version of ${t.label}`, text: `Changes: ${changes}`, link: t.link });
      }
      onClose();
    }
  };

  return (
    <Modal title={brew ? (hb ? 'Edit your card homebrew' : 'Homebrew: your version of this card') : version ? 'Edit card version' : 'New card version'} onClose={onClose} wide>
      <form className="form" onSubmit={submit}>
        {brew && !hb && (
          <p className="muted">
            Change the values the way your table plays this card. Your homebrew is private: only you see it, and saving it puts it straight into the ruleset you are using. Share it when you would like
            the community and the admins to consider it.
          </p>
        )}
        {hb?.sharedId && <p className="muted">This homebrew is shared for review: the shared copy changes too.</p>}
        {!brew && (
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
            {brew ? 'Save homebrew' : version ? 'Save' : 'Add version'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
