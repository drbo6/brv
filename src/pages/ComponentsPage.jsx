import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { compareValues, displayTitle, FIELD_KINDS, idField, imageUrl, isEmptyValue, loadComponents, stateField } from '../lib/components.js';
import { toPlainText } from '../lib/html.js';
import { useDebounced, useLocalStorage } from '../lib/hooks.js';
import { absoluteLink, href, navigate } from '../lib/router.js';
import { useSession } from '../lib/session.jsx';
import ComponentCard from '../components/ComponentCard.jsx';
import { copyText, Empty, Icon, Modal, RichText, Spinner, toast } from '../components/ui.jsx';

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
  const { shorthands, isAdmin } = useSession();
  const [state, setState] = useState({ loading: true });

  const load = useCallback((force = false) => {
    setState((s) => ({ ...s, loading: true }));
    loadComponents({ force })
      .then((r) => setState({ ...r, loading: false }))
      .catch((error) => setState({ loading: false, error }));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const types = state.types || [];
  const type = types.find((t) => t.id === route.parts[0]) || types[0];
  const comps = useMemo(() => (type ? (state.components || []).filter((c) => c.typeId === type.id) : []), [state.components, type]);
  const states = useMemo(() => (type ? indexStates(type, comps) : null), [type, comps]);

  // ----- toolbar state -----
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim().toLowerCase(), 150);
  const [filters, setFilters] = useState({});
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState(1);
  const [cardWidth, setCardWidth] = useLocalStorage('brv-card-width', 210);
  const [showStates, setShowStates] = useState(false);
  useEffect(() => {
    setFilters({});
    setSortKey('');
  }, [type?.id]);

  const filterFields = useMemo(() => (type ? type.fields.filter((f) => f.filterable) : []), [type]);
  const filterOptions = useMemo(() => {
    const out = {};
    for (const f of filterFields) {
      const vals = new Set();
      for (const c of comps) if (!isEmptyValue(c.data[f.key], type)) vals.add(String(c.data[f.key]));
      out[f.key] = [...vals].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }
    return out;
  }, [filterFields, comps, type]);
  const sortFields = useMemo(() => (type ? type.fields.filter((f) => ['id', 'title', 'type', 'value'].includes(f.kind)) : []), [type]);

  const searchIndex = useMemo(() => {
    const m = new Map();
    if (!type) return m;
    for (const c of comps) {
      m.set(
        c.id,
        type.fields
          .filter((f) => f.kind !== 'image' && f.kind !== 'state')
          .map((f) => toPlainText(String(c.data[f.key] ?? '')))
          .join(' ')
          .toLowerCase(),
      );
    }
    return m;
  }, [comps, type]);

  const visible = useMemo(() => {
    if (!type) return [];
    const tokens = q.split(/\s+/).filter(Boolean);
    const active = Object.entries(filters).filter(([, v]) => v);
    const list = comps.filter(
      (c) =>
        (showStates || !states.isState.has(c.id)) &&
        active.every(([k, v]) => String(c.data[k] ?? '') === v) &&
        tokens.every((t) => searchIndex.get(c.id).includes(t)),
    );
    const key = sortKey || states.idf?.key;
    if (key) list.sort((a, b) => sortDir * compareValues(a.data[key], b.data[key], type) || compareValues(a.data[states.idf?.key], b.data[states.idf?.key], type));
    return list;
  }, [comps, type, q, filters, sortKey, sortDir, showStates, states, searchIndex]);

  const open = useCallback((c) => navigate('components', [type.id, c.id]), [type?.id]);
  const detail = route.parts[1] ? comps.find((c) => c.id === route.parts[1]) : null;

  if (state.error)
    return (
      <div className="page">
        <Empty title="Could not load components">
          <p>{state.error.message}</p>
        </Empty>
      </div>
    );
  if (state.loading && !state.types) return <Spinner label="Loading components…" />;
  if (!type)
    return (
      <div className="page">
        <Empty title="No components yet">
          <p>{isAdmin ? 'Create a component type and import a spreadsheet in Admin → Components.' : 'Admins have not added any components yet.'}</p>
        </Empty>
      </div>
    );

  return (
    <div className="page components-page">
      {types.length > 1 && (
        <nav className="tabs" aria-label="Component types">
          {types.map((t) => (
            <a key={t.id} href={href('components', [t.id])} className={t.id === type.id ? 'on' : ''}>
              {t.name}
            </a>
          ))}
        </nav>
      )}
      <div className="page-head">
        <h1>{type.name}</h1>
        <p className="muted">
          {visible.length} of {comps.length - (showStates ? 0 : states.isState.size)} shown
          {state.fromCache && ' · from local cache'}
        </p>
      </div>
      <section className="toolbar sticky" aria-label="Search, filter and sort">
        <div className="search">
          <Icon name="search" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${type.name.toLowerCase()}…`} aria-label="Search components" />
        </div>
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
            <option value="">Sort: {states.idf?.label || 'default'}</option>
            {sortFields
              .filter((f) => f.key !== states.idf?.key)
              .map((f) => (
                <option key={f.key} value={f.key}>
                  Sort: {f.label}
                </option>
              ))}
          </select>
          <button className="icon-btn" onClick={() => setSortDir((d) => -d)} aria-label={sortDir > 0 ? 'Ascending' : 'Descending'} title={sortDir > 0 ? 'Ascending' : 'Descending'}>
            <Icon name={sortDir > 0 ? 'arrowUp' : 'arrowDown'} />
          </button>
        </div>
        {states.sf && (
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
        <button className="icon-btn" onClick={() => load(true)} title="Reload from the server" aria-label="Reload from the server">
          <Icon name="flip" />
        </button>
      </section>

      {visible.length === 0 ? (
        <Empty title="Nothing matches">
          <p>Try a different search or clear the filters.</p>
        </Empty>
      ) : (
        <VirtualGrid
          items={visible}
          aspect={type.aspect || 0.7}
          cardWidth={cardWidth}
          renderItem={(c) => (
            <ComponentCard
              key={c.id}
              type={type}
              comp={c}
              shorthands={shorthands}
              hasStates={states.statesOf.has(String(c.data[states.idf?.key]))}
              onClick={() => open(c)}
            />
          )}
        />
      )}

      {detail && <ComponentDetail type={type} comp={detail} states={states} onClose={() => navigate('components', [type.id])} />}
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

function ComponentDetail({ type, comp, states, onClose }) {
  const { shorthands, isAdmin } = useSession();
  const { byIdValue, statesOf, idf, sf } = states;
  // The family: the base component plus all its alternate states.
  const baseId = sf && comp.data[sf.key]?.of ? String(comp.data[sf.key].of) : String(comp.data[idf?.key]);
  const base = byIdValue.get(baseId) || comp;
  const family = [{ comp: base, name: 'Default' }, ...(statesOf.get(baseId) || [])];
  const [current, setCurrent] = useState(comp);
  useEffect(() => {
    setCurrent(comp);
  }, [comp]);

  const rows = type.fields.filter((f) => f.kind !== 'state' && !isEmptyValue(current.data[f.key], type));

  return (
    <Modal title={displayTitle(type, current)} onClose={onClose} wide className="detail-modal">
      <div className="detail">
        <div className="detail-card">
          <ComponentCard type={type} comp={current} shorthands={shorthands} />
          {family.length > 1 && (
            <div className="seg state-switch" role="group" aria-label="States">
              {family.map((s) => (
                <button key={s.comp.id} className={s.comp.id === current.id ? 'on' : ''} onClick={() => setCurrent(s.comp)}>
                  <Icon name="flip" size={13} />
                  {s.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="detail-data">
          <dl>
            {rows.map((f) => (
              <div key={f.key} className="detail-row">
                <dt>
                  {f.label}
                  <span className="kind-mini">{FIELD_KINDS[f.kind]?.label}</span>
                </dt>
                <dd>
                  {f.kind === 'image' ? (
                    imageUrl(f, current.data[f.key]) ? (
                      <a href={imageUrl(f, current.data[f.key])} target="_blank" rel="noreferrer">
                        {String(current.data[f.key])}
                      </a>
                    ) : (
                      <code>{String(current.data[f.key])}</code>
                    )
                  ) : (
                    <RichText html={String(current.data[f.key])} as="span" />
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <div className="row gap wrap">
            <button
              onClick={async () => {
                await copyText(absoluteLink('components', [type.id, current.id]));
                toast('Link copied', 'ok');
              }}
            >
              <Icon name="link" />
              Copy link
            </button>
            {isAdmin && (
              <a className="btn" href={href('admin', ['components', type.id], { edit: current.id })}>
                <Icon name="edit" />
                Edit
              </a>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
