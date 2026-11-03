import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { collection, deleteField, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { useDraftHistory, useUndoScope } from '../lib/history.js';
import { autoFollow, notify, rulesetTarget, SUGGESTIONS } from '../lib/inbox.js';
import { absoluteLink, navigate } from '../lib/router.js';
import { createRuleset, entryFor, findVersion, groupVersions, HB, kindInfo, rulebookEntries, sectionTree, SET_LABELS, sortRules, updateRuleset } from '../lib/rules.js';
import { homebrewRefs, myHomebrewQuery, shareHomebrew, withCardHomebrew, withHomebrew } from '../lib/homebrew.js';
import { useLive } from '../lib/hooks.js';
import { compareValues, displayTitle, idField, loadComponents } from '../lib/components.js';
import { dataIn } from '../lib/cardVersions.js';
import { exportRulesetPdf } from '../lib/pdf.js';
import PdfDialog from './PdfDialog.jsx';
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
  // The reader's own homebrew: shown only to them, usable in their rulesets.
  const homebrew = useLive(() => myHomebrewQuery(user?.uid), [user?.uid]);
  const myHomebrew = useMemo(() => homebrew.data || [], [homebrew.data]);

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

  // Homebrew goes straight into the reader's own private ruleset, so they can play it at once.
  // (Not a public set: others would see it without the homebrew.)
  const brewSet = Boolean(!selectedSet.builtIn && user && selectedSet.ownerUid === user.uid && selectedSet.visibility !== 'public');
  const startHomebrew = (open) =>
    requireUser(async () => {
      if (brewSet) return open();
      const own = await confirmDialog({
        title: 'Homebrew needs a ruleset of your own',
        message: `Your homebrew goes into the ruleset you are using, so you can play it right away. “${selectedSet.name}” isn't yours to change: switch to one of your own rulesets in the ruleset bar, or make your own copy of this one, then choose Homebrew again. Would you like a Rulebook, Official Ruling or Community version to change for everyone? Say so with Discuss on that rule or card, or write your homebrew in your own ruleset and share it with the admins.`,
        confirmLabel: 'Make my own copy',
        cancelLabel: 'Not now',
      });
      if (own) setSaveAs(true);
    });
  /** After a homebrew went into the set: it is saved there, so it is no longer an unsaved change. */
  const homebrewUsed = (kind, id) => change(kind, id, null, null);

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

  /** The whole active ruleset as a PDF: its rules in the versions it uses, then its cards. Asks how first. */
  const [pdfOpen, setPdfOpen] = useState(false);
  const exportPdf = () => setPdfOpen(true);
  const makePdf = (options) =>
    attempt(async () => {
      const [secSnap, ruleSnap, verSnap] = await Promise.all(['sections', 'rules', 'versions'].map((c) => getDocs(collection(db, c))));
      const docs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const tree = sectionTree(docs(secSnap));
      // The reader's own homebrew prints too: it's their ruleset.
      const { rules, versions } = withHomebrew(myHomebrew, docs(ruleSnap), docs(verSnap));
      const vByRule = groupVersions(versions);
      const entries = apply(selectedSet.builtIn ? rulebookEntries(rules, vByRule) : selectedSet.entries || {}, 'rules');

      const bySection = new Map();
      for (const r of sortRules(rules)) {
        const v = findVersion(vByRule.get(r.id) || [], entryFor(entries, r));
        if (!v) continue;
        if (!bySection.has(r.sectionId)) bySection.set(r.sectionId, []);
        bySection.get(r.sectionId).push({
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

      // Every card, in the version the ruleset plays it in (printed unless it says otherwise).
      const cards = apply(selectedSet.cards, 'cards');
      const [{ types, components }, cvSnap] = await Promise.all([loadComponents(), getDocs(collection(db, 'componentVersions'))]);
      const cvs = new Map();
      for (const v of withCardHomebrew(myHomebrew, docs(cvSnap))) {
        cvs.set(v.id, v);
        if (v.homebrewId) cvs.set(HB + v.homebrewId, v);
      }
      const cardTypes = types.map((type) => {
        const idf = idField(type);
        const cardsOf = components.filter((c) => c.typeId === type.id).sort((a, b) => (idf ? compareValues(a.data[idf.key], b.data[idf.key], type) : 0) || a.id.localeCompare(b.id));
        return {
          type,
          cards: cardsOf.map((comp) => {
            const v = cards[comp.id] ? cvs.get(cards[comp.id]) : null;
            return { comp, data: dataIn(comp, v), label: v ? v.label : null, changed: v?.data || {} };
          }),
        };
      });
      // Without the card overview, the cards the ruleset changes are listed after the rules.
      if (options.cards === 'none' && Object.keys(cards).length) {
        const cardRules = [];
        for (const [compId, vid] of Object.entries(cards)) {
          const comp = components.find((c) => c.id === compId);
          const v = cvs.get(vid);
          if (!comp || !v) continue;
          const type = types.find((t) => t.id === comp.typeId);
          const label = (key) => type?.fields.find((f) => f.key === key)?.label || key;
          cardRules.push({
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
      await exportRulesetPdf({
        title: 'Blood Rage: Valhalla - Living Rulebook',
        subtitle: `Ruleset: ${name} · ${count} rules · exported ${new Date().toLocaleDateString()}`,
        groups,
        cardTypes,
        shorthands,
        options,
        filename: `brv-${name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()}.pdf`,
      });
      return true;
    }, 'PDF downloaded');

  // Homebrew of the reader's that this ruleset uses but nobody else can see.
  const privateHomebrewIn = useCallback(
    (set) => {
      const refs = homebrewRefs(set);
      return myHomebrew.filter((h) => refs.has(h.id) && !h.sharedId);
    },
    [myHomebrew],
  );

  /** Copy a link to the ruleset; first offer to share any private homebrew in it, or the link shows it without them. */
  const copySetLink = async (page) => {
    const hidden = privateHomebrewIn(selectedSet);
    if (hidden.length) {
      const n = hidden.length;
      const share = await confirmDialog({
        title: 'This ruleset uses your homebrew',
        message: `${n === 1 ? 'One homebrew' : `${n} homebrews`} in “${selectedSet.name}” ${n === 1 ? 'is' : 'are'} private: others opening the link won't see ${n === 1 ? 'it' : 'them'}, and the ruleset can't be made public. Share ${n === 1 ? 'it' : 'them'} with the admins? Once they make ${n === 1 ? 'it a public suggestion' : 'them public suggestions'}, everyone with the link sees ${n === 1 ? 'it' : 'them'}.`,
        confirmLabel: n === 1 ? 'Share it and copy the link' : `Share ${n} and copy the link`,
        cancelLabel: 'Copy the link without them',
      });
      const unshared = hidden.filter((h) => !h.submitted);
      if (share && unshared.length) {
        const ok = await requireUser(
          (u) =>
            attempt(async () => {
              for (const h of unshared) await shareHomebrew(h);
              return true;
            }, `Shared ${unshared.length === 1 ? 'your homebrew' : `${unshared.length} homebrews`} with the admins`),
          'suggest',
        );
        if (ok) notify(SUGGESTIONS.key, user, { type: 'suggestion', title: `${user.displayName || 'Someone'} shared ${unshared.length === 1 ? 'a homebrew' : `${unshared.length} homebrews`} from the ruleset “${selectedSet.name}” with the admins`, text: '', link: SUGGESTIONS.link });
      }
    }
    await copyText(absoluteLink(page, [], { set: selectedSet.id }));
    toast('Ruleset link copied', 'ok');
  };

  const value = {
    choice,
    myHomebrew,
    brewSet,
    startHomebrew,
    homebrewUsed,
    privateHomebrewIn,
    copySetLink,
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
      {pdfOpen && <PdfDialog setName={selectedSet.name} onExport={makePdf} onClose={() => setPdfOpen(false)} />}
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
              {selectedSet.label in SET_LABELS && <span className={`tag ${SET_LABELS[selectedSet.label]}`}>{selectedSet.label}</span>}{' '}
              {(selectedSet.description && (
                <span className="set-desc" title={selectedSet.description}>
                  {selectedSet.description}
                </span>
              )) ||
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
                  onClick={() => rs.copySetLink(page)}
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
