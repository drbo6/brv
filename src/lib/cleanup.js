import { collection, deleteField, doc, getDocs } from 'firebase/firestore';
import { db } from './firebase.js';
import { commitInChunks } from './store.js';
import { HB } from './rules.js';
import { PRINTED } from './cardVersions.js';

// The owner's Clean up (Admin → Backup): data that points at something that no longer exists, left
// behind by deletes from before they removed everything, or by imports that replaced one collection
// but not the ones pointing into it. Reading every collection is fine here: the owner may read all.

const all = async (name) => (await getDocs(collection(db, name))).docs.map((d) => ({ id: d.id, ...d.data() }));

/**
 * What would be cleaned up, by kind: { key, label, items: [{ describe, op }] }. Each `op` is a write
 * for commitInChunks: a delete, or an update that drops dangling references.
 */
export async function findLeftovers() {
  const [rules, versions, comps, cardVersions, meta, attached, comments, rulesets, subscribers, homebrew] = await Promise.all(
    ['rules', 'versions', 'components', 'componentVersions', 'componentMeta', 'componentRules', 'comments', 'rulesets', 'subscribers', 'homebrew'].map(all),
  );
  const ruleIds = new Set(rules.map((r) => r.id));
  const compIds = new Set(comps.map((c) => c.id));
  const versionById = new Map(versions.map((v) => [v.id, v]));
  const cardVersionById = new Map(cardVersions.map((v) => [v.id, v]));
  const homebrewIds = new Set(homebrew.map((h) => h.id));
  const setIds = new Set(rulesets.map((s) => s.id));
  const del = (col, id) => (b) => b.delete(doc(db, col, id));
  const groups = [];
  const add = (key, label, items) => items.length && groups.push({ key, label, items });

  add('versions', 'Rule versions of deleted rules', versions.filter((v) => !ruleIds.has(v.ruleId)).map((v) => ({ describe: v.id, op: del('versions', v.id) })));
  add('cardVersions', 'Card versions of deleted cards', cardVersions.filter((v) => !compIds.has(v.componentId)).map((v) => ({ describe: v.id, op: del('componentVersions', v.id) })));
  add('meta', 'Reactions on deleted cards', meta.filter((m) => !compIds.has(m.id)).map((m) => ({ describe: m.id, op: del('componentMeta', m.id) })));
  add(
    'attached',
    'Attached rules: deleted cards, or rules that no longer exist',
    attached.flatMap((a) => {
      if (!compIds.has(a.id)) return [{ describe: a.id, op: del('componentRules', a.id) }];
      const kept = (a.rules || []).filter((id) => ruleIds.has(id));
      return kept.length === (a.rules || []).length ? [] : [{ describe: a.id, op: (b) => b.update(doc(db, 'componentRules', a.id), { rules: kept }) }];
    }),
  );
  add(
    'comments',
    'Comments on deleted rules or cards',
    comments.filter((c) => (c.ruleId && !ruleIds.has(c.ruleId)) || (c.componentId && !compIds.has(c.componentId))).map((c) => ({ describe: c.id, op: del('comments', c.id) })),
  );

  // Rulesets: entries for rules, versions, cards or homebrew that are gone.
  const setItems = [];
  for (const s of rulesets) {
    const patch = {};
    for (const [key, v] of Object.entries(s.entries || {})) {
      const hbKey = key.startsWith(HB);
      if (hbKey ? !homebrewIds.has(key.slice(HB.length)) : !ruleIds.has(key)) patch[`entries.${key}`] = deleteField();
      else if (typeof v === 'string' && (v.startsWith(HB) ? !homebrewIds.has(v.slice(HB.length)) : !hbKey && versionById.get(v)?.ruleId !== key)) patch[`entries.${key}`] = deleteField();
    }
    for (const [key, v] of Object.entries(s.cards || {})) {
      // "hb:<id>" is a member's own new card, there as long as their homebrew is.
      if (key.startsWith(HB) ? !homebrewIds.has(key.slice(HB.length)) : !compIds.has(key)) patch[`cards.${key}`] = deleteField();
      // A chosen version that's gone: the card stays in the ruleset, as printed.
      else if (v && v !== PRINTED && (v.startsWith(HB) ? !homebrewIds.has(v.slice(HB.length)) : cardVersionById.get(v)?.componentId !== key)) patch[`cards.${key}`] = PRINTED;
    }
    const n = Object.keys(patch).length;
    if (n) setItems.push({ describe: `${s.name} (${n})`, count: n, op: (b) => b.update(doc(db, 'rulesets', s.id), patch) });
  }
  add('rulesets', 'Ruleset entries for things that no longer exist', setItems);

  add(
    'homebrew',
    "Members' homebrew of deleted rules or cards",
    homebrew.filter((h) => (h.kind === 'version' && !ruleIds.has(h.ruleId)) || (h.kind === 'card' && !compIds.has(h.componentId))).map((h) => ({ describe: h.id, op: del('homebrew', h.id) })),
  );
  add(
    'subscribers',
    'Follows of deleted rules, cards or rulesets',
    subscribers
      .filter((f) => {
        const [, kind, id] = /^(rule|component|ruleset)_(.+)$/.exec(f.id) || [];
        return kind && !(kind === 'rule' ? ruleIds : kind === 'component' ? compIds : setIds).has(id);
      })
      .map((f) => ({ describe: f.id, op: del('subscribers', f.id) })),
  );
  return groups;
}

/** Apply what findLeftovers found, as one undoable action. */
export const removeLeftovers = (groups) => commitInChunks(groups.flatMap((g) => g.items.map((i) => i.op)));
