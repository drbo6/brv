import { useCallback, useEffect, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase.js';
import { BLOOD_RAGE_PRESET, BLOOD_RAGE_SHORTHANDS, loadComponents, NEW_TYPE, saveType } from '../../lib/components.js';
import { href, navigate } from '../../lib/router.js';
import { useSession } from '../../lib/session.jsx';
import { attempt, Icon, Spinner } from '../ui.jsx';
import TypeEditor from './TypeEditor.jsx';
import Importer from './Importer.jsx';
import ComponentList from './ComponentList.jsx';

const SUBTABS = [
  { id: 'layout', label: 'Fields & layout' },
  { id: 'import', label: 'Import spreadsheet' },
  { id: 'list', label: 'Components' },
];

export default function ComponentsAdmin({ route }) {
  const [data, setData] = useState(null);
  const reload = useCallback(() => loadComponents({ force: true }).then(setData), []);
  useEffect(() => {
    reload().catch((e) => setData({ error: e }));
  }, [reload]);

  if (!data) return <Spinner />;
  if (data.error) return <p className="error">{data.error.message}</p>;

  const typeId = route.parts[1];
  const type = data.types.find((t) => t.id === typeId);
  const sub = SUBTABS.find((s) => s.id === route.params.get('tab'))?.id || (route.params.get('edit') ? 'list' : 'layout');
  const comps = type ? data.components.filter((c) => c.typeId === type.id) : [];

  const createType = async (preset) => {
    const id = await attempt(() => saveType({ ...(preset || NEW_TYPE), order: data.types.length + 1 }), 'Component type created');
    if (id) {
      await reload();
      navigate('admin', ['components', id]);
    }
  };

  return (
    <div className="ca-layout">
      <aside className="panel ca-side">
        <h2>Component types</h2>
        <ul className="ca-types">
          {data.types.map((t) => (
            <li key={t.id}>
              <a href={href('admin', ['components', t.id])} className={t.id === typeId ? 'on' : ''}>
                <span>{t.name}</span>
                <span className="muted small">{data.components.filter((c) => c.typeId === t.id).length}</span>
              </a>
            </li>
          ))}
        </ul>
        <div className="col gap">
          <button onClick={() => createType()}>
            <Icon name="plus" />
            New type
          </button>
          {!data.types.some((t) => t.name === BLOOD_RAGE_PRESET.name) && (
            <button className="primary" onClick={() => createType(BLOOD_RAGE_PRESET)} title="Fields and card layout matching the Blood Rage: Valhalla card spreadsheet">
              <Icon name="layers" />
              Add Blood Rage card type
            </button>
          )}
        </div>
        <ShorthandsEditor />
      </aside>

      <div className="ca-main">
        {!type ? (
          <section className="panel">
            <h2>Components</h2>
            <p className="muted">
              Pick a component type, or create one. A type defines the data fields of a component (card, tile, board…) and how they are laid out when rendered.
            </p>
            <ol className="steps">
              <li>
                Create a type — the <b>Blood Rage card type</b> button sets up fields and a layout matching the card spreadsheet.
              </li>
              <li>Import the spreadsheet (.xlsx or .csv) and map its columns to fields.</li>
              <li>Fine-tune the layout and shorthands, such as [rage] → 🩸.</li>
            </ol>
          </section>
        ) : (
          <>
            <nav className="tabs small" aria-label="Type sections">
              {SUBTABS.map((s) => (
                <a key={s.id} href={href('admin', ['components', type.id], { tab: s.id })} className={sub === s.id ? 'on' : ''}>
                  {s.label}
                </a>
              ))}
            </nav>
            {sub === 'layout' && <TypeEditor key={type.id} type={type} comps={comps} allComponents={data.components} onSaved={reload} />}
            {sub === 'import' && <Importer key={type.id} type={type} comps={comps} onDone={reload} />}
            {sub === 'list' && <ComponentList key={type.id} type={type} comps={comps} editId={route.params.get('edit')} onChanged={reload} />}
          </>
        )}
      </div>
    </div>
  );
}

function ShorthandsEditor() {
  const { shorthands } = useSession();
  const [rows, setRows] = useState(null);
  useEffect(() => setRows(Object.entries(shorthands).map(([key, v]) => ({ key, ...v }))), [shorthands]);
  if (!rows) return null;

  const update = (i, patch) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = (list) => {
    const items = {};
    for (const r of list) if (r.key.trim()) items[r.key.trim().toLowerCase()] = { type: r.type, value: r.value.trim() };
    return attempt(() => setDoc(doc(db, 'config', 'shorthands'), { items }), 'Shorthands saved');
  };

  return (
    <section className="shorthands">
      <h3>Shorthands</h3>
      <p className="small muted">
        Write <code>[keyword]</code> in any card or rule text to show an emoji or image.
      </p>
      {rows.map((r, i) => (
        <div key={i} className="sh-row">
          <input className="mini" value={r.key} onChange={(e) => update(i, { key: e.target.value.replace(/[^a-z0-9_-]/gi, '') })} placeholder="keyword" aria-label="Keyword" />
          <select value={r.type} onChange={(e) => update(i, { type: e.target.value })} aria-label="Shorthand type">
            <option value="emoji">Text/emoji</option>
            <option value="image">Image URL</option>
          </select>
          <input value={r.value} onChange={(e) => update(i, { value: e.target.value })} placeholder={r.type === 'image' ? 'https://…' : '🩸'} aria-label="Value" />
          <span className="sh-preview" aria-hidden="true">
            {r.type === 'image' && /^https?:/.test(r.value) ? <img className="sh" src={r.value} alt="" /> : r.value}
          </span>
          <button className="icon-btn danger" aria-label="Remove shorthand" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
            <Icon name="x" />
          </button>
        </div>
      ))}
      <div className="row gap wrap">
        <button className="small" onClick={() => setRows([...rows, { key: '', type: 'emoji', value: '' }])}>
          <Icon name="plus" />
          Add
        </button>
        {!rows.some((r) => r.key === 'rage') && (
          <button className="small" onClick={() => setRows([...rows, ...Object.entries(BLOOD_RAGE_SHORTHANDS).map(([key, v]) => ({ key, ...v }))])}>
            Add Blood Rage icons
          </button>
        )}
        <button className="small primary" onClick={() => save(rows)}>
          Save
        </button>
      </div>
    </section>
  );
}
