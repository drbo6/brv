import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { useLive, useLocalStorage } from '../lib/hooks.js';
import { RULEBOOK_SET, SET_LABELS } from '../lib/rules.js';
import { useSession } from '../lib/session.jsx';
import { useProfiles } from '../lib/profiles.js';
import { Icon } from './ui.jsx';

/**
 * The ruleset the reader is using, shared by the Rules and Components pages:
 * a `?set=` link wins, then the reader's last choice, then the site default.
 */
export function useRulesetChoice(linkedSetId) {
  const { user, site } = useSession();
  const publicSets = useLive(() => query(collection(db, 'rulesets'), where('visibility', '==', 'public')), []);
  const mySets = useLive(() => (user ? query(collection(db, 'rulesets'), where('ownerUid', '==', user.uid)) : null), [user?.uid]);
  const linkedSet = useLive(() => (linkedSetId && linkedSetId !== RULEBOOK_SET.id ? doc(db, 'rulesets', linkedSetId) : null), [linkedSetId]);
  const [storedSetId, setStoredSetId] = useLocalStorage('brv-ruleset', null);

  // Public rulesets, Official first, then Community, Experimental and unlabeled ones.
  const publicList = useMemo(() => sortSets(publicSets.data || []), [publicSets.data]);
  // Only while the site has no public ruleset does the placeholder stand in (rules as printed).
  const printed = publicSets.loading || publicList.length === 0;

  const allSets = useMemo(() => {
    const seen = new Map(printed ? [[RULEBOOK_SET.id, RULEBOOK_SET]] : []);
    for (const s of [...publicList, ...(mySets.data || []), linkedSet.data].filter(Boolean)) seen.set(s.id, s);
    return seen;
  }, [printed, publicList, mySets.data, linkedSet.data]);

  const selectedSet = allSets.get(linkedSetId) || allSets.get(storedSetId) || allSets.get(site.defaultRulesetId) || publicList[0] || RULEBOOK_SET;
  return { selectedSet, publicSets: publicList, printed, mySets: mySets.data || [], linkedSet: linkedSet.data, setStoredSetId };
}

/** Dropdown of the rulesets a reader can pick. */
const labelRank = (s) => {
  const i = Object.keys(SET_LABELS).indexOf(s.label);
  return i < 0 ? 99 : i;
};
export const sortSets = (sets) => [...sets].sort((a, b) => labelRank(a) - labelRank(b) || a.name.localeCompare(b.name));

/** The rulesets a reader can pick, as a menu: grouped by label, then their own and shared ones. */
export default function RulesetSelect({ choice, onChange, id = 'ruleset-select', unsaved = false, differs = false }) {
  const { user, site } = useSession();
  const profiles = useProfiles();
  const { selectedSet, publicSets, printed, mySets, linkedSet } = choice;
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const btnRef = useRef(null);

  const sections = [
    ...(printed ? [{ title: 'Rulesets', items: [RULEBOOK_SET] }] : []),
    ...[...Object.keys(SET_LABELS), null].map((label) => ({
      title: label ? `${label} rulesets` : 'Other rulesets',
      items: publicSets.filter((s) => (label ? s.label === label : !(s.label in SET_LABELS))),
    })),
    { title: 'My rulesets', items: mySets.filter((s) => s.visibility !== 'public') },
    {
      title: 'Shared with you',
      items: linkedSet && linkedSet.visibility !== 'public' && linkedSet.ownerUid !== user?.uid ? [{ ...linkedSet, by: profiles.get(linkedSet.ownerUid)?.name || linkedSet.ownerName }] : [],
    },
  ].filter((g) => g.items.length);

  // Closes on a click elsewhere or Escape; arrow keys move between rulesets.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    // Start on the ruleset in use.
    requestAnimationFrame(() => ref.current?.querySelector('[role="option"][aria-selected="true"]')?.focus());
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      setOpen(false);
      btnRef.current?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const opts = [...ref.current.querySelectorAll('[role="option"]')];
    const i = opts.indexOf(document.activeElement);
    opts[(i + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length]?.focus();
  };
  const pick = (sid) => {
    setOpen(false);
    btnRef.current?.focus();
    if (sid !== selectedSet.id) onChange(sid);
  };

  const status = unsaved ? 'unsaved changes' : differs ? 'other versions shown' : '';
  return (
    <div ref={ref} className={`ruleset-menu ${open ? 'open' : ''}`} onKeyDown={onKeyDown}>
      <button
        ref={btnRef}
        id={id}
        type="button"
        className={`ruleset-btn ${status ? 'is-unsaved' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title="Which rules and card versions you see"
      >
        <span className="ruleset-btn-name">{selectedSet.name}</span>
        {status && <span className="ruleset-btn-status">{status}</span>}
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="menu-pop ruleset-pop" role="listbox" aria-label="Rulesets">
          {sections.map((g) => (
            <div key={g.title} role="group" aria-label={g.title} className="ruleset-group">
              <p className="menu-title">{g.title}</p>
              {g.items.map((s) => {
                const on = s.id === selectedSet.id;
                return (
                  <button key={s.id} type="button" role="option" aria-selected={on} className={`menu-item ${on ? 'on' : ''}`} onClick={() => pick(s.id)}>
                    <Icon name={on ? 'check' : 'layers'} size={15} />
                    <span>
                      <b>
                        {s.name}
                        {site.defaultRulesetId === s.id && <span className="tag t-muted">Default</span>}
                      </b>
                      {(s.description || s.by) && <span className="small muted">{s.by ? `By ${s.by}` : s.description}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
