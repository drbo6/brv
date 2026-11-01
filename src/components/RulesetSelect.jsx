import { useMemo } from 'react';
import { collection, doc, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { useLive, useLocalStorage } from '../lib/hooks.js';
import { RULEBOOK_SET } from '../lib/rules.js';
import { useSession } from '../lib/session.jsx';

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

  const allSets = useMemo(() => {
    const seen = new Map([[RULEBOOK_SET.id, RULEBOOK_SET]]);
    for (const s of [...(publicSets.data || []), ...(mySets.data || []), linkedSet.data].filter(Boolean)) seen.set(s.id, s);
    return seen;
  }, [publicSets.data, mySets.data, linkedSet.data]);

  const selectedSet = allSets.get(linkedSetId) || allSets.get(storedSetId) || allSets.get(site.defaultRulesetId) || RULEBOOK_SET;
  return { selectedSet, publicSets: publicSets.data || [], mySets: mySets.data || [], linkedSet: linkedSet.data, setStoredSetId };
}

/** Dropdown of the rulesets a reader can pick. */
export default function RulesetSelect({ choice, onChange, id = 'ruleset-select', unsaved = false, differs = false }) {
  const { user, site } = useSession();
  const { selectedSet, publicSets, mySets, linkedSet } = choice;
  const privateMine = mySets.filter((s) => s.visibility !== 'public');
  // The selected set's name says when it has unsaved changes.
  const status = unsaved ? ' — unsaved changes' : differs ? ' — other versions shown' : '';
  const isDefault = (sid) => (status && sid === selectedSet.id ? status : site.defaultRulesetId === sid ? ' — default' : '');
  return (
    <select id={id} className={unsaved || differs ? 'is-unsaved' : ''} value={selectedSet.id} onChange={(e) => onChange(e.target.value)} title="Which rules and card versions you see">
      <option value={RULEBOOK_SET.id}>
        {RULEBOOK_SET.name}
        {isDefault(RULEBOOK_SET.id)}
      </option>
      {publicSets.length > 0 && (
        <optgroup label="Community rulesets">
          {publicSets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {isDefault(s.id)}
            </option>
          ))}
        </optgroup>
      )}
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
            {linkedSet.name} (by {linkedSet.ownerName}){isDefault(linkedSet.id)}
          </option>
        </optgroup>
      )}
    </select>
  );
}
