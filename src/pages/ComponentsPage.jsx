import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { collection, doc, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { compareValues, displayTitle, idField, isEmptyValue, loadComponents, stateField } from '../lib/components.js';
import { dataIn } from '../lib/cardVersions.js';
import { LABEL_CLASS } from '../lib/rules.js';
import { toPlainText } from '../lib/html.js';
import { useDebounced, useLive, useLocalStorage } from '../lib/hooks.js';
import { href, navigate } from '../lib/router.js';
import { useSession } from '../lib/session.jsx';
import ComponentCard from '../components/ComponentCard.jsx';
import ComponentDetail from '../components/ComponentDetail.jsx';
import ComponentForm from '../components/ComponentForm.jsx';
import { useActiveRuleset } from '../components/ActiveRuleset.jsx';
import { Empty, Icon, Spinner } from '../components/ui.jsx';

/** Index the components of a type: lookup by ID value and alternate states per base component. */
export function indexStates(type, comps) {
  const idf = idField(type);
  const sf = stateField(type);
  const byIdValue = new Map();
  const statesOf = new Map();
  const isState = new Set();
  if (idf) for (const c of comps) byIdValue.set(String(c.data[idf.key]), c);
  if (sf) {
    for (const c of comps) {
      const st = c.data[sf.key];
      if (st?.of && byIdValue.has(String(st.of))) {
        isState.add(c.id);
        const base = String(st.of);
        if (!statesOf.has(base)) statesOf.set(base, []);
        statesOf.get(base).push({ comp: c, name: st.name || sf.label });
      }
    }
  }
  return { byIdValue, statesOf, isState, idf, sf };
}

export default function ComponentsPage({ route }) {
  const { shorthands, isEditor } = useSession();
  const [state, setState] = useState({ loading: true });

  const load = useCallback((force = false) => {
    setState((s) => ({ ...s, loading: true }));
    return loadComponents({ force })
      .then((r) => setState({ ...r, loading: false }))
      .catch((error) => setState({ loading: false, error }));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  // Live: when anyone changes components, the counter moves and we fetch the new data.
  const meta = useLive(() => doc(db, 'config', 'componentsMeta'), []);
  const liveVersion = meta.data?.version || 0;
  useEffect(() => {
    if (state.version !== undefined && liveVersion !== state.version) load();
  }, [liveVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Versions, reactions and discussion counts are small collections and stay live.
  const cardVersionDocs = useLive(() => collection(db, 'componentVersions'), []);
  const cardMeta = useLive(() => collection(db, 'componentMeta'), []);
  const cardComments = useLive(() => query(collection(db, 'comments'), where('componentId', '!=', null)), []);
  const versionsByComp = useMemo(() => {
    const m = new Map();
    for (const v of cardVersionDocs.data || []) {
      if (!m.has(v.componentId)) m.set(v.componentId, []);
      m.get(v.componentId).push(v);
    }
    return m;
  }, [cardVersionDocs.data]);
  const metaById = useMemo(() => new Map((cardMeta.data || []).map((d) => [d.id, d])), [cardMeta.data]);
  const commentsByComp = useMemo(() => {
    const m = new Map();
    for (const c of cardComments.data || []) m.set(c.componentId, (m.get(c.componentId) || 0) + 1);
    return m;
  }, [cardComments.data]);

  const rs = useActiveRuleset();
  const cardChoices = useMemo(() => rs.apply(rs.selectedSet.cards, 'cards'), [rs.apply, rs.selectedSet.cards]); // eslint-disable-line react-hooks/exhaustive-deps

  const types = state.types || [];
  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  // All types are shown together; ?type= (or an old #/components/<type> link) narrows to one.
  const legacyType = route.parts.length === 1 && typeById.has(route.parts[0]) ? route.parts[0] : '';
  const filterType = typeById.has(route.params.get('type')) ? route.params.get('type') : legacyType;
  // With one type selected (or only one type existing), its own filters and sorts apply.
  const activeType = typeById.get(filterType) || (types.length === 1 ? types[0] : null);
  const setFilterType = (id) => navigate('components', [], id ? { type: id } : {}, { replace: true });

  // States are indexed per type on the printed cards; the detail view applies versions itself.
  const printedOf = useMemo(() => {
    const m = new Map(types.map((t) => [t.id, []]));
    for (const c of state.components || []) m.get(c.typeId)?.push(c);
    return m;
  }, [state.components, types]);
  const statesOf = useMemo(() => new Map(types.map((t) => [t.id, indexStates(t, printedOf.get(t.id) || [])])), [types, printedOf]);

  // Each component as the selected ruleset shows it (a chosen card version replaces fields).
  const comps = useMemo(() => {
    const byId = new Map((cardVersionDocs.data || []).map((v) => [v.id, v]));
    return (state.components || [])
      .filter((c) => typeById.has(c.typeId) && (!filterType || c.typeId === filterType))
      .map((c) => {
        const v = byId.get(cardChoices[c.id]);
        return v && v.componentId === c.id ? { ...c, data: dataIn(c, v), version: v } : c;
      });
  }, [state.components, typeById, filterType, cardChoices, cardVersionDocs.data]);

  // ----- toolbar state -----
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim().toLowerCase(), 150);
  const [filters, setFilters] = useState({});
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState(1);
  const [cardWidth, setCardWidth] = useLocalStorage('brv-card-width', 210);
  const [showStates, setShowStates] = useState(false);
  const [adding, setAdding] = useState(null); // type to add a component of
  useEffect(() => {
    setFilters({});
    setSortKey('');
  }, [activeType?.id]);

  const filterFields = useMemo(() => (activeType ? activeType.fields.filter((f) => f.filterable) : []), [activeType]);
  const filterOptions = useMemo(() => {
    const out = {};
    for (const f of filterFields) {
      const vals = new Set();
      for (const c of comps) if (!isEmptyValue(c.data[f.key], activeType)) vals.add(String(c.data[f.key]));
      out[f.key] = [...vals].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }
    return out;
  }, [filterFields, comps, activeType]);
  const sortFields = useMemo(() => (activeType ? activeType.fields.filter((f) => ['id', 'title', 'type', 'value'].includes(f.kind)) : []), [activeType]);
  const idf = activeType && statesOf.get(activeType.id)?.idf;

  const searchIndex = useMemo(() => {
    const m = new Map();
    for (const c of comps) {
      const t = typeById.get(c.typeId);
      m.set(
        c.id,
        `${t.name} ${t.fields
          .filter((f) => f.kind !== 'image' && f.kind !== 'state')
          .map((f) => toPlainText(String(c.data[f.key] ?? '')))
          .join(' ')}`.toLowerCase(),
      );
    }
    return m;
  }, [comps, typeById]);

  const isState = (c) => statesOf.get(c.typeId)?.isState.has(c.id);
  const stateCount = comps.filter(isState).length;
  const visible = useMemo(() => {
    const tokens = q.split(/\s+/).filter(Boolean);
    const active = Object.entries(filters).filter(([, v]) => v);
    const list = comps.filter((c) => (showStates || !isState(c)) && active.every(([k, v]) => String(c.data[k] ?? '') === v) && tokens.every((t) => searchIndex.get(c.id).includes(t)));
    if (activeType) {
      const key = sortKey || idf?.key;
      if (key) list.sort((a, b) => sortDir * compareValues(a.data[key], b.data[key], activeType) || compareValues(a.data[idf?.key], b.data[idf?.key], activeType));
    } else {
      // Several types: by type, then by title (or by title only).
      const title = (c) => String(displayTitle(typeById.get(c.typeId), c)).toLowerCase();
      list.sort((a, b) => sortDir * ((sortKey === 'title' ? 0 : typeById.get(a.typeId).order - typeById.get(b.typeId).order) || title(a).localeCompare(title(b), undefined, { numeric: true })));
    }
    return list;
  }, [comps, activeType, typeById, q, filters, sortKey, sortDir, showStates, statesOf, searchIndex, idf]); // eslint-disable-line react-hooks/exhaustive-deps

  const backParams = filterType ? { type: filterType } : {};
  const open = useCallback((c) => navigate('components', [c.typeId, c.id], backParams), [filterType]); // eslint-disable-line react-hooks/exhaustive-deps
  const detailId = route.parts.length === 2 ? route.parts[1] : null;
  const detail = detailId ? (state.components || []).find((c) => c.id === detailId) : null;
  const detailType = detail && typeById.get(detail.typeId);
  // Cards of different shapes share the grid: rows are as tall as the tallest shape.
  const aspect = activeType ? activeType.aspect || 0.7 : Math.min(...types.map((t) => t.aspect || 0.7));

  if (state.error)
    return (
      <div className="page">
        <Empty title="Could not load components">
          <p>{state.error.message}</p>
        </Empty>
      </div>
    );
  if (state.loading && !state.types) return <Spinner label="Loading components…" />;
  if (!types.length)
    return (
      <div className="page">
        <Empty title="No components yet">
          <p>{isEditor ? 'Create a component type in Admin → Components, then add components here.' : 'Admins have not added any components yet.'}</p>
        </Empty>
      </div>
    );

  return (
    <div className="page components-page">
      <div className="page-head">
        <h1>{filterType ? activeType.name : 'Components'}</h1>
        <div className="page-head-side">
          <p className="muted small">
            {visible.length} of {comps.length - (showStates ? 0 : stateCount)} shown
          </p>
        </div>
      </div>
      <section className="toolbar sticky" aria-label="Search, filter and sort">
        <div className="search">
          <Icon name="search" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${(filterType ? activeType.name : 'components').toLowerCase()}…`} aria-label="Search components" />
        </div>
        {types.length > 1 && (
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)} aria-label="Filter by component type" title="Show one type of component">
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        {filterFields.map((f) => (
          <select key={f.key} value={filters[f.key] || ''} onChange={(e) => setFilters((m) => ({ ...m, [f.key]: e.target.value }))} aria-label={`Filter by ${f.label}`}>
            <option value="">All {f.label}</option>
            {filterOptions[f.key].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        ))}
        <div className="sort">
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value)} aria-label="Sort by">
            {activeType ? (
              <>
                <option value="">Sort: {idf?.label || 'default'}</option>
                {sortFields
                  .filter((f) => f.key !== idf?.key)
                  .map((f) => (
                    <option key={f.key} value={f.key}>
                      Sort: {f.label}
                    </option>
                  ))}
              </>
            ) : (
              <>
                <option value="">Sort: type, then name</option>
                <option value="title">Sort: name</option>
              </>
            )}
          </select>
          <button className="icon-btn" onClick={() => setSortDir((d) => -d)} aria-label={sortDir > 0 ? 'Ascending' : 'Descending'} title={sortDir > 0 ? 'Ascending' : 'Descending'}>
            <Icon name={sortDir > 0 ? 'arrowUp' : 'arrowDown'} />
          </button>
        </div>
        {types.some((t) => statesOf.get(t.id)?.sf) && (
          <label className="switch">
            <input type="checkbox" checked={showStates} onChange={(e) => setShowStates(e.target.checked)} />
            <span className="switch-track" aria-hidden="true" />
            <span>Show alternate states</span>
          </label>
        )}
        <label className="size-slider">
          <span className="sr-only">Card size</span>
          <Icon name="grid" />
          <input type="range" min="130" max="360" step="10" value={cardWidth} onChange={(e) => setCardWidth(Number(e.target.value))} aria-label="Card size" />
        </label>
        {isEditor &&
          (activeType ? (
            idf && (
              <button className="primary" onClick={() => setAdding(activeType)} title={`Add a new ${activeType.name.toLowerCase()} by hand`}>
                <Icon name="plus" />
                Add
              </button>
            )
          ) : (
            <details className="menu">
              <summary className="btn primary-summary" title="Add a component by hand">
                <Icon name="plus" />
                Add
              </summary>
              <div className="menu-pop view-as-pop" role="menu">
                <p className="menu-title">Add a…</p>
                {types
                  .filter((t) => statesOf.get(t.id)?.idf)
                  .map((t) => (
                    <button key={t.id} type="button" className="menu-item" role="menuitem" onClick={(e) => {
                      e.currentTarget.closest('details').removeAttribute('open');
                      setAdding(t);
                    }}>
                      <Icon name="plus" />
                      <span>{t.name}</span>
                    </button>
                  ))}
              </div>
            </details>
          ))}
      </section>

      {visible.length === 0 ? (
        <Empty title="Nothing matches">
          <p>Try a different search or clear the filters.</p>
        </Empty>
      ) : (
        <VirtualGrid
          items={visible}
          aspect={aspect}
          cardWidth={cardWidth}
          renderItem={(c) => {
            const t = typeById.get(c.typeId);
            const st = statesOf.get(c.typeId);
            return (
              <ComponentCard key={c.id} type={t} comp={c} shorthands={shorthands} hasStates={st.statesOf.has(String(c.data[st.idf?.key]))} onClick={() => open(c)}>
                <CardBadges version={c.version} versions={versionsByComp.get(c.id)?.length || 0} comments={commentsByComp.get(c.id) || 0} />
              </ComponentCard>
            );
          }}
        />
      )}

      {detail && detailType && (
        <ComponentDetail
          type={detailType}
          comp={detail}
          states={statesOf.get(detailType.id)}
          versionsOf={(id) => versionsByComp.get(id) || []}
          metaOf={(id) => metaById.get(id)}
          commentCount={(id) => commentsByComp.get(id) || 0}
          allComps={printedOf.get(detailType.id) || []}
          onChanged={() => load(true)}
          onClose={() => navigate('components', [], backParams)}
        />
      )}
      {adding && (
        <ComponentForm
          type={adding}
          comps={printedOf.get(adding.id) || []}
          onClose={() => setAdding(null)}
          onSaved={async (id) => {
            await load(true);
            if (id) navigate('components', [adding.id, id], backParams);
          }}
        />
      )}
    </div>
  );
}

/** Window-scrolled, row-virtualized grid: only the rows near the viewport are rendered. */
function VirtualGrid({ items, aspect, cardWidth, renderItem }) {
  const ref = useRef(null);
  const [box, setBox] = useState({ width: 0, top: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    const measure = () => setBox({ width: el.clientWidth, top: el.getBoundingClientRect().top + window.scrollY });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const gap = cardWidth < 180 ? 10 : 16;
  const cols = Math.max(1, Math.floor((box.width + gap) / (cardWidth + gap)));
  const w = (box.width - gap * (cols - 1)) / cols;
  const rowH = w / aspect + gap;
  const rows = Math.ceil(items.length / cols);
  const virt = useWindowVirtualizer({ count: rows, estimateSize: () => rowH, overscan: 4, scrollMargin: box.top });
  useEffect(() => {
    virt.measure();
  }, [rowH, cols, virt]);

  return (
    <div ref={ref} className="vgrid" style={{ height: box.width ? virt.getTotalSize() : undefined }}>
      {box.width > 0 &&
        virt.getVirtualItems().map((row) => (
          <div
            key={row.key}
            className="vgrid-row"
            style={{ transform: `translateY(${row.start - virt.options.scrollMargin}px)`, gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap, height: rowH - gap }}
          >
            {items.slice(row.index * cols, row.index * cols + cols).map(renderItem)}
          </div>
        ))}
    </div>
  );
}

/** Small corner marks: the version a ruleset uses, and whether there are versions or comments to see. */
function CardBadges({ version, versions, comments }) {
  if (!version && !versions && !comments) return null;
  const tip = [version && `Shown as the ${version.label} version`, versions && `${versions} alternative version${versions === 1 ? '' : 's'}`, comments && `${comments} comment${comments === 1 ? '' : 's'}`]
    .filter(Boolean)
    .join(' · ');
  return (
    <span className="card-badges" title={tip}>
      {version && <span className={`label l-${LABEL_CLASS[version.label] || 'other'}`}>{version.label}</span>}
      {versions > 0 && (
        <span className="card-badge">
          <Icon name="layers" size={11} />
          {versions}
        </span>
      )}
      {comments > 0 && (
        <span className="card-badge">
          <Icon name="message" size={11} />
          {comments}
        </span>
      )}
    </span>
  );
}
