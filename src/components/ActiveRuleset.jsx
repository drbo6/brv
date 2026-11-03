import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { collection, deleteField, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { useDraftHistory, useUndoScope } from '../lib/history.js';
import { autoFollow, notify, rulesetTarget } from '../lib/inbox.js';
import { absoluteLink, navigate } from '../lib/router.js';
import { createRuleset, groupVersions, kindInfo, rulebookEntries, sectionTree, shortIds, sortRules, updateRuleset } from '../lib/rules.js';
import { displayTitle, loadComponents } from '../lib/components.js';
import { exportRulesPdf } from '../lib/pdf.js';
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
  const { user, isEditor, requireUser, kinds, shorthands } = useSession();
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

  /** The whole active ruleset as a PDF: its rules in the versions it uses, then the cards it changes. */
  const exportPdf = () =>
    attempt(async () => {
      const [secSnap, ruleSnap, verSnap] = await Promise.all(['sections', 'rules', 'versions'].map((c) => getDocs(collection(db, c))));
      const docs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const tree = sectionTree(docs(secSnap));
      const rules = docs(ruleSnap);
      const sids = shortIds(rules);
      const vByRule = groupVersions(docs(verSnap));
      const entries = apply(selectedSet.builtIn ? rulebookEntries(rules, vByRule) : selectedSet.entries || {}, 'rules');

      const bySection = new Map();
      for (const r of sortRules(rules)) {
        const v = (vByRule.get(r.id) || []).find((x) => x.id === entries[r.id]);
        if (!v) continue;
        if (!bySection.has(r.sectionId)) bySection.set(r.sectionId, []);
        bySection.get(r.sectionId).push({
          sid: sids.get(r.id),
          ref: v.label !== 'Rulebook' ? `${sids.get(r.id)}.${v.num}` : '',
          title: r.title,
          label: v.label,
          kindLabel: r.kind && r.kind !== 'rule' ? kindInfo(kinds, r.kind).label : '',
          html: v.text,
        });
      }
      // A section heading is kept when it, or a section inside it, has rules.
      const total = new Map();
      for (const sec of [...tree.ordered].reverse()) {
        total.set(sec.id, (bySection.get(sec.id)?.length || 0) + (tree.children.get(sec.id) || []).reduce((n, c) => n + (total.get(c.id) || 0), 0));
      }
      const groups = tree.ordered.filter((sec) => total.get(sec.id) > 0).map((sec) => ({ heading: `${sec.number}  ${sec.title}`, depth: sec.depth, rules: bySection.get(sec.id) || [] }));

      // Cards the ruleset plays in another version than printed.
      const cards = apply(selectedSet.cards, 'cards');
      if (Object.keys(cards).length) {
        const [{ types, components }, cvSnap] = await Promise.all([loadComponents(), getDocs(collection(db, 'componentVersions'))]);
        const cvs = new Map(docs(cvSnap).map((v) => [v.id, v]));
        const cardRules = [];
        for (const [compId, vid] of Object.entries(cards)) {
          const comp = components.find((c) => c.id === compId);
          const v = cvs.get(vid);
          if (!comp || !v) continue;
          const type = types.find((t) => t.id === comp.typeId);
          const label = (key) => type?.fields.find((f) => f.key === key)?.label || key;
          cardRules.push({
            sid: '',
            title: displayTitle(type, comp),
            label: v.label,
            html: Object.entries(v.data || {})
              .map(([k, val]) => `<p><b>${label(k)}:</b> ${val}</p>`)
              .join(''),
          });
        }
        if (cardRules.length) groups.push({ heading: 'Card changes', depth: 0, rules: cardRules });
      }

      const name = `${selectedSet.name}${unsaved ? ' (unsaved changes)' : ''}`;
      const count = groups.reduce((n, g) => n + (g.heading === 'Card changes' ? 0 : g.rules.length), 0);
      await exportRulesPdf({
        title: 'Blood Rage: Valhalla - Living Rulebook',
        subtitle: `Ruleset: ${name} · ${count} rules · exported ${new Date().toLocaleDateString()}`,
        groups,
        shorthands,
        filename: `brv-${name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()}.pdf`,
      });
    });

  const value = {
    choice,
    exportPdf,
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
                  'The rules and cards as printed, plus official rulings on questions the book doesn’t answer.'
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
              <button className="small" onClick={rs.exportPdf} title="Download this ruleset as a PDF: its rules in the versions it uses, and the cards it changes">
                <Icon name="download" />
                PDF
              </button>
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
