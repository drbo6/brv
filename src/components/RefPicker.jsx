import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { displayTitle, loadComponents } from '../lib/components.js';
import { refToken } from '../lib/html.js';
import { sectionTree, shortIds } from '../lib/rules.js';
import { Icon, Modal, Spinner } from './ui.jsx';

/** Search rules and cards and pick one to reference; resolves to a [[kind:id|label]] token. */
export default function RefPicker({ onPick, onClose }) {
  const [items, setItems] = useState(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    let live = true;
    Promise.all([getDocs(collection(db, 'rules')), getDocs(collection(db, 'sections')), loadComponents()])
      .then(([ruleSnap, secSnap, { types, components }]) => {
        const rules = ruleSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((r) => r.status !== 'rejected');
        const sids = shortIds(rules);
        const tree = sectionTree(secSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        const sectionOf = (r) => {
          const sec = tree.byId.get(r.sectionId);
          return sec ? `${sec.number} ${sec.title}` : '';
        };
        const typeById = new Map(types.map((t) => [t.id, t]));
        const list = [
          ...rules.map((r) => ({ kind: 'rule', id: r.id, label: `${sids.get(r.id)} ${r.title}`, hint: `Rule · ${sectionOf(r)}`, search: `${sids.get(r.id)} ${r.title} ${sectionOf(r)}`.toLowerCase() })),
          ...components
            .filter((c) => typeById.has(c.typeId))
            .map((c) => {
              const name = String(displayTitle(typeById.get(c.typeId), c));
              return { kind: 'card', id: c.id, label: name, hint: typeById.get(c.typeId).name, search: `${name} ${c.id.split('__').pop()}`.toLowerCase() };
            }),
        ];
        if (live) setItems(list);
      })
      .catch((e) => live && setItems({ error: e }));
    return () => {
      live = false;
    };
  }, []);

  const results = useMemo(() => {
    if (!Array.isArray(items)) return [];
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (tokens.length ? items.filter((it) => tokens.every((t) => it.search.includes(t))) : items).slice(0, 60);
  }, [items, q]);

  return (
    <Modal title="Link a rule or card" onClose={onClose} className="ref-picker">
      <p className="small muted">The link shows as a chip in the text. The rule or card then lists this rule under “Clarifications about this”.</p>
      <div className="search">
        <Icon name="search" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search rules (id, title or section) and cards…" aria-label="Search rules and cards" autoFocus />
      </div>
      {!items ? (
        <Spinner />
      ) : items.error ? (
        <p className="error">{items.error.message}</p>
      ) : results.length === 0 ? (
        <p className="muted">Nothing matches.</p>
      ) : (
        <ul className="ref-results">
          {results.map((it) => (
            <li key={`${it.kind}:${it.id}`}>
              <button type="button" onClick={() => onPick(refToken(it.kind, it.id, it.label))}>
                <span className={`ref ref-${it.kind}`}>{it.label}</span>
                <span className="muted small">{it.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
