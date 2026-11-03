import { useMemo } from 'react';
import { collection, doc, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { useLive, useLocalStorage } from '../lib/hooks.js';
import { RULEBOOK_SET, SET_LABELS } from '../lib/rules.js';
import { useSession } from '../lib/session.jsx';
import { useProfiles } from '../lib/profiles.js';

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
  // The printed rules only stand in while the site has no public ruleset.
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

export default function RulesetSelect({ choice, onChange, id = 'ruleset-select', unsaved = false, differs = false }) {
  const { user, site } = useSession();
  const profiles = useProfiles();
  const { selectedSet, publicSets, printed, mySets, linkedSet } = choice;
  // Public rulesets grouped by their label; unlabeled ones last.
  const groups = [...Object.keys(SET_LABELS), null]
    .map((label) => ({ label, sets: publicSets.filter((s) => (label ? s.label === label : !(s.label in SET_LABELS))) }))
    .filter((g) => g.sets.length);
  const privateMine = mySets.filter((s) => s.visibility !== 'public');
  // The selected set's name says when it has unsaved changes.
  const status = unsaved ? ' — unsaved changes' : differs ? ' — other versions shown' : '';
  const isDefault = (sid) => (status && sid === selectedSet.id ? status : site.defaultRulesetId === sid ? ' — default' : '');
  return (
    <select id={id} className={unsaved || differs ? 'is-unsaved' : ''} value={selectedSet.id} onChange={(e) => onChange(e.target.value)} title="Which rules and card versions you see">
      {printed && (
        <option value={RULEBOOK_SET.id}>
          {RULEBOOK_SET.name}
          {isDefault(RULEBOOK_SET.id)}
        </option>
      )}
      {groups.map((g) => (
        <optgroup key={g.label || 'other'} label={g.label ? `${g.label} rulesets` : 'Other rulesets'}>
          {g.sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {isDefault(s.id)}
            </option>
          ))}
        </optgroup>
      ))}
      {privateMine.length > 0 && (
        <optgroup label="My rulesets">
          {privateMine.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {isDefault(s.id)}
            </option>
          ))}
        </optgroup>
      )}
      {linkedSet && linkedSet.visibility !== 'public' && linkedSet.ownerUid !== user?.uid && (
        <optgroup label="Shared with you">
          <option value={linkedSet.id}>
            {linkedSet.name} (by {profiles.get(linkedSet.ownerUid)?.name || linkedSet.ownerName}){isDefault(linkedSet.id)}
          </option>
        </optgroup>
      )}
    </select>
  );
}
