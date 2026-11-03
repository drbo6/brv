import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { collection, deleteField, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { useDraftHistory, useUndoScope } from '../lib/history.js';
import { autoFollow, notify, rulesetTarget } from '../lib/inbox.js';
import { absoluteLink, navigate } from '../lib/router.js';
import { createRuleset, groupVersions, rulebookEntries, updateRuleset } from '../lib/rules.js';
import { useSession } from '../lib/session.jsx';
import FollowButton from './FollowButton.jsx';
import RulesetSelect, { useRulesetChoice } from './RulesetSelect.jsx';
import { SaveRulesetDialog } from './RuleDialogs.jsx';
import { confirmDialog } from './dialogs.jsx';
import { attempt, copyText, Icon, toast, UserName } from './ui.jsx';

// The ruleset a reader is using, shared by the Rules and Components pages: which rules are active,
// which version of each rule and which version of each card. Changes made while reading are kept
// as unsaved overrides ({ rules: { ruleId: versionId | null }, cards: { componentId: versionId | null } })
// until the reader saves them, to the set itself (if theirs) or as a new ruleset of their own.

const Ctx = createContext(null);
export const useActiveRuleset = () => useContext(Ctx);

const EMPTY = { rules: {}, cards: {} };

export function ActiveRulesetProvider({ route, children }) {
  const { user, isEditor, requireUser } = useSession();
  const choice = useRulesetChoice(route.params.get('set'));
  const { selectedSet, setStoredSetId } = choice;
  const ownsSet = Boolean(!selectedSet.builtIn && user && (selectedSet.ownerUid === user.uid || isEditor));

  // null when nothing changed; each change is one undo step (Ctrl+Z works too).
  const [draft, setDraft, history] = useDraftHistory(null, 0);
  useUndoScope(history);
  const overrides = draft || EMPTY;
  const changeCount = Object.keys(overrides.rules).length + Object.keys(overrides.cards).length;
  const unsaved = changeCount > 0;

  // The printed rulebook's entries are computed by the Rules page from the data it already loads.
  const rulebookRef = useRef(null);
  const setRulebook = useCallback((entries) => {
    rulebookRef.current = entries;
  }, []);

  // Starting over on another ruleset (picked here, or opened from a link) drops the overrides.
  const lastSet = useRef(selectedSet.id);
  useEffect(() => {
    if (lastSet.current !== selectedSet.id) history.reset(null);
    lastSet.current = selectedSet.id;
  }, [selectedSet.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Change one rule or card; `base` is what the saved ruleset has, so going back to it isn't a change. */
  const change = useCallback(
    (kind, id, versionId, base) =>
      setDraft((d) => {
        const cur = d || { ...EMPTY, customizing: false };
        const next = { ...cur[kind] };
        if ((versionId || null) === (base || null)) delete next[id];
        else next[id] = versionId || null;
        const out = { ...cur, [kind]: next };
        return Object.keys(out.rules).length || Object.keys(out.cards).length || out.customizing ? out : null;
      }),
    [setDraft],
  );
  const setRule = useCallback((ruleId, versionId, base) => change('rules', ruleId, versionId, base), [change]);
  const setCard = useCallback((compId, versionId, base) => change('cards', compId, versionId, base), [change]);
  const setCustomizing = (on) => setDraft((d) => (on ? { ...(d || EMPTY), customizing: true } : d && (Object.keys(d.rules).length || Object.keys(d.cards).length) ? { ...d, customizing: false } : null));

  /** The saved map with the overrides applied (null = left out). */
  const apply = useCallback((base, kind) => {
    const out = { ...(base || {}) };
    for (const [id, v] of Object.entries(overrides[kind])) {
      if (v) out[id] = v;
      else delete out[id];
    }
    return out;
  }, [overrides]);

  const discard = async () => {
    if (unsaved && !(await confirmDialog({ title: 'Discard changes', message: `Discard your ${changeCount} unsaved change${changeCount === 1 ? '' : 's'}?`, confirmLabel: 'Discard', danger: true }))) return false;
    history.reset(null);
    return true;
  };

  const selectSet = async (id) => {
    if (unsaved && !(await confirmDialog({ title: 'Discard changes', message: 'Switching rulesets discards your unsaved changes.', confirmLabel: 'Switch and discard', danger: true }))) return;
    history.reset(null);
    setStoredSetId(id);
    if (route.params.get('set')) navigate(route.page, route.parts, {}, { replace: true });
  };

  const saveInPlace = () =>
    requireUser(async () => {
      // Only the changed keys are written, so others' edits to other rules of this set survive.
      const patch = {};
      for (const [id, v] of Object.entries(overrides.rules)) patch[`entries.${id}`] = v || deleteField();
      for (const [id, v] of Object.entries(overrides.cards)) patch[`cards.${id}`] = v || deleteField();
      const ok = await attempt(() => updateRuleset(selectedSet.id, patch), 'Ruleset saved');
      if (ok) {
        history.reset(null);
        const t = rulesetTarget(selectedSet);
        notify(t.key, user, { type: 'ruleset', title: `${user.displayName || 'Someone'} updated the ruleset “${t.label}”`, text: `${changeCount} change${changeCount === 1 ? '' : 's'}.`, link: t.link });
      }
    });

  const [saveAs, setSaveAs] = useState(false);
  const saveAsNew = ({ name, description }) =>
    requireUser(async (u) => {
      const id = await attempt(async () => {
        let base = selectedSet.builtIn ? rulebookRef.current : selectedSet.entries || {};
        if (!base) {
          // Saving from the Components page: work out the printed rulebook's entries first.
          const [rules, versions] = await Promise.all([getDocs(collection(db, 'rules')), getDocs(collection(db, 'versions'))]);
          base = rulebookEntries(rules.docs.map((d) => ({ id: d.id, ...d.data() })), groupVersions(versions.docs.map((d) => ({ id: d.id, ...d.data() }))));
        }
        const cards = apply(selectedSet.cards, 'cards');
        return createRuleset({ name, description, entries: apply(base, 'rules'), ...(Object.keys(cards).length ? { cards } : {}) }, u);
      }, 'Ruleset saved');
      if (id) {
        history.reset(null);
        setStoredSetId(id);
        // You follow your own rulesets, to hear when admins publish them or others change them.
        autoFollow(rulesetTarget({ id, name }).key, u.uid, rulesetTarget({ id, name }));
      }
      return id;
    });

  const value = {
    choice,
    selectedSet,
    ownsSet,
    overrides,
    unsaved,
    changeCount,
    customizing: Boolean(draft?.customizing),
    setCustomizing,
    setRule,
    setCard,
    apply,
    setRulebook,
    selectSet,
    discard,
    saveInPlace,
    openSaveAs: () => requireUser(() => setSaveAs(true)),
    history,
    // How the set is named in buttons: yours, or the one you'd be making a copy of.
    setLabel: ownsSet ? `“${selectedSet.name}”` : 'your own ruleset',
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {saveAs && (
        <SaveRulesetDialog
          initialName={selectedSet.builtIn ? '' : `${selectedSet.name} (copy)`}
          initialDescription={selectedSet.builtIn ? '' : selectedSet.description}
          onSave={saveAsNew}
          onClose={() => setSaveAs(false)}
        />
      )}
    </Ctx.Provider>
  );
}

/** The site-wide ruleset bar on the Rules and Components pages. */
export function RulesetBar({ page }) {
  const rs = useActiveRuleset();
  const ref = useRef(null);
  const { selectedSet, unsaved, changeCount, ownsSet, customizing, history } = rs;

  // Pages pin their own toolbars below this bar.
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => root.style.setProperty('--ruleset-bar-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.setProperty('--ruleset-bar-h', '0px');
    };
  }, []);

  return (
    <section ref={ref} className={`site-ruleset ${unsaved ? 'is-unsaved' : ''}`} aria-label="Active ruleset">
      <div className="site-ruleset-inner">
        <div className="site-ruleset-pick">
          <Icon name="layers" />
          <label htmlFor="ruleset-select">Ruleset</label>
          <RulesetSelect choice={rs.choice} onChange={rs.selectSet} unsaved={unsaved} />
        </div>

        <p className="site-ruleset-status">
          {unsaved ? (
            ownsSet ? (
              <>
                <b>
                  {changeCount} unsaved change{changeCount === 1 ? '' : 's'}
                </b>{' '}
                to your ruleset “{selectedSet.name}”.
              </>
            ) : (
              <>
                <b>Your own copy</b> of “{selectedSet.name}” with {changeCount} change{changeCount === 1 ? '' : 's'}. Only you see it: save it as a new ruleset to keep it.
              </>
            )
          ) : customizing ? (
            <>Choose rules and versions with the switches on each rule.</>
          ) : (
            <span className="muted">
              {selectedSet.description ||
                (selectedSet.builtIn ? (
                  'The rules and cards exactly as printed.'
                ) : (
                  <>
                    A ruleset by <UserName uid={selectedSet.ownerUid} fallback={selectedSet.ownerName || 'a community member'} />.
                  </>
                ))}
            </span>
          )}
        </p>

        <div className="site-ruleset-actions">
          {unsaved || customizing ? (
            <>
              <button className="icon-btn" onClick={history.undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
                <Icon name="undo" />
              </button>
              <button className="icon-btn" onClick={history.redo} disabled={!history.canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
                <Icon name="redo" />
              </button>
              <button className="small" onClick={() => (unsaved ? rs.discard() : rs.setCustomizing(false))}>
                {unsaved ? 'Discard' : 'Done'}
              </button>
              {ownsSet && (
                <button className="small primary" onClick={rs.saveInPlace} disabled={!unsaved} title={`Save the changes to “${selectedSet.name}”`}>
                  <Icon name="save" />
                  Save
                </button>
              )}
              <button className={`small ${ownsSet ? '' : 'primary'}`} onClick={rs.openSaveAs} disabled={!unsaved} title="Save as a new ruleset of your own">
                Save as new…
              </button>
            </>
          ) : (
            <>
              {page === 'rules' && (
                <button className="small" onClick={() => rs.setCustomizing(true)} title="Show an “In ruleset” switch on every rule, to choose which rules and versions your ruleset uses">
                  <Icon name="layers" />
                  Customize
                </button>
              )}
              {!selectedSet.builtIn && <FollowButton target={rulesetTarget(selectedSet)} what={`the ruleset “${selectedSet.name}”`} className="small" />}
              {!selectedSet.builtIn && (
                <button
                  className="icon-btn"
                  title="Copy a link to this ruleset"
                  aria-label="Copy a link to this ruleset"
                  onClick={async () => {
                    await copyText(absoluteLink(page, [], { set: selectedSet.id }));
                    toast('Ruleset link copied', 'ok');
                  }}
                >
                  <Icon name="link" />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * The "your ruleset" row in an open rule or card: what the active ruleset does with the version on
 * screen, and buttons to change that. Worded so it is clear this changes a ruleset, not the rules.
 */
export function RulesetChoiceRow({ inSet, active, onUse, onRemove, onAdd, what = 'rule' }) {
  const { selectedSet, ownsSet, setLabel } = useActiveRuleset();
  const name = `“${selectedSet.name}”`;
  return (
    <div className="ruleset-choice" role="group" aria-label="Your ruleset">
      <Icon name="layers" />
      <span className="ruleset-choice-text">
        {!active ? `Not part of ${name}.` : inSet ? `${name} uses this version.` : `${name} uses a different version of this ${what}.`}
        {!ownsSet && (!inSet || active) && <span className="muted"> Changing this starts your own copy of the ruleset; it changes nothing for anyone else.</span>}
      </span>
      <span className="ruleset-choice-actions">
        {active && !inSet && (
          <button className="chip" onClick={onUse} title={`Make ${setLabel} use this version (unsaved until you save)`}>
            <Icon name="check" />
            Use this version in {setLabel}
          </button>
        )}
        {!active && onAdd && (
          <button className="chip" onClick={onAdd} title={`Add this ${what} to ${setLabel} (unsaved until you save)`}>
            <Icon name="plus" />
            Add to {setLabel}
          </button>
        )}
        {active && onRemove && (
          <button className="chip" onClick={onRemove} title={`Leave this ${what} out of ${setLabel} (unsaved until you save)`}>
            <Icon name="eyeOff" />
            Leave out of {setLabel}
          </button>
        )}
      </span>
    </div>
  );
}
