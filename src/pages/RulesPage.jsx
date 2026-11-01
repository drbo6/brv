import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { useDebounced, useLive, useLocalStorage } from '../lib/hooks.js';
import { absoluteLink, navigate } from '../lib/router.js';
import { createRuleset, groupVersions, KINDS, LABELS, moveRule, RULEBOOK_SET, rulebookEntries, sectionTree, sortRules, updateRuleset } from '../lib/rules.js';
import { toPlainText } from '../lib/html.js';
import { useSession } from '../lib/session.jsx';
import { exportRulesPdf } from '../lib/pdf.js';
import RuleCard from '../components/RuleCard.jsx';
import { RuleDialog, SaveRulesetDialog } from '../components/RuleDialogs.jsx';
import { attempt, copyText, Empty, Icon, Spinner, toast } from '../components/ui.jsx';

export default function RulesPage({ route }) {
  const { user, isAdmin, site, shorthands, requireUser } = useSession();
  const sections = useLive(() => collection(db, 'sections'), []);
  const rules = useLive(() => collection(db, 'rules'), []);
  const versions = useLive(() => collection(db, 'versions'), []);
  const publicSets = useLive(() => query(collection(db, 'rulesets'), where('visibility', '==', 'public')), []);
  const mySets = useLive(() => (user ? query(collection(db, 'rulesets'), where('ownerUid', '==', user.uid)) : null), [user?.uid]);

  // ----- ruleset selection -----
  const linkedSetId = route.params.get('set');
  const linkedSet = useLive(() => (linkedSetId && linkedSetId !== RULEBOOK_SET.id ? doc(db, 'rulesets', linkedSetId) : null), [linkedSetId]);
  const [storedSetId, setStoredSetId] = useLocalStorage('brv-ruleset', null);

  const allSets = useMemo(() => {
    const seen = new Map([[RULEBOOK_SET.id, RULEBOOK_SET]]);
    for (const s of [...(publicSets.data || []), ...(mySets.data || []), linkedSet.data].filter(Boolean)) seen.set(s.id, s);
    return seen;
  }, [publicSets.data, mySets.data, linkedSet.data]);

  const selectedSet = allSets.get(linkedSetId) || allSets.get(storedSetId) || allSets.get(site.defaultRulesetId) || RULEBOOK_SET;

  // ----- derived rule data -----
  const tree = useMemo(() => sectionTree(sections.data || []), [sections.data]);
  const vByRule = useMemo(() => groupVersions(versions.data || []), [versions.data]);
  const allRules = useMemo(() => sortRules(rules.data || []), [rules.data]);
  const rulebook = useMemo(() => rulebookEntries(allRules, vByRule), [allRules, vByRule]);
  const index = useMemo(
    () =>
      allRules.map((rule) => {
        const vs = vByRule.get(rule.id) || [];
        return { rule, vs, searchText: `${rule.code} ${rule.title} ${vs.map((v) => `${v.label} ${toPlainText(v.text)} ${v.note || ''}`).join(' ')}`.toLowerCase() };
      }),
    [allRules, vByRule],
  );

  // ----- editing a ruleset -----
  const [draft, setDraft] = useState(null); // { baseId, entries }
  const baseEntries = selectedSet.builtIn ? rulebook : selectedSet.entries || {};
  const entries = draft ? draft.entries : baseEntries;
  const changeCount = useMemo(() => {
    if (!draft) return 0;
    const keys = new Set([...Object.keys(draft.entries), ...Object.keys(baseEntries)]);
    let n = 0;
    keys.forEach((k) => draft.entries[k] !== baseEntries[k] && n++);
    return n;
  }, [draft, baseEntries]);

  const [viewVersion, setViewVersion] = useState({});
  const onShowVersion = useCallback((ruleId, vid) => setViewVersion((m) => ({ ...m, [ruleId]: vid })), []);
  const onSetActive = useCallback((ruleId, vid) => setDraft((d) => {
    const next = { ...d.entries };
    if (vid) next[ruleId] = vid;
    else delete next[ruleId];
    return { ...d, entries: next };
  }), []);
  const onUseVersion = useCallback((ruleId, vid) => setDraft((d) => ({ ...d, entries: { ...d.entries, [ruleId]: vid } })), []);

  const selectSet = (id) => {
    if (draft && changeCount && !confirm('Discard your unsaved ruleset changes?')) return;
    setDraft(null);
    setViewVersion({});
    setStoredSetId(id);
    navigate('rules', route.parts, {}, { replace: true });
  };

  // ----- filters -----
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim().toLowerCase(), 150);
  const [showInactive, setShowInactive] = useLocalStorage('brv-show-inactive', false);
  const [labelFilter, setLabelFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const focusCode = route.parts[0] || null;

  const items = useMemo(() => {
    const tokens = q.split(/\s+/).filter(Boolean);
    return index
      .map(({ rule, vs, searchText }) => {
        const activeVersion = vs.find((v) => v.id === entries[rule.id]);
        const shown = vs.find((v) => v.id === viewVersion[rule.id]) || activeVersion || vs.find((v) => v.label === 'Rulebook') || vs[0];
        return { rule, vs, searchText, active: Boolean(activeVersion), activeVersion, shown };
      })
      .filter((it) => {
        if (it.rule.code === focusCode) return true;
        if (it.rule.status === 'rejected' && !(isAdmin && showInactive)) return false;
        if (!it.active && !showInactive) return false;
        if (labelFilter && !it.vs.some((v) => v.label === labelFilter)) return false;
        if (kindFilter && (it.rule.kind || 'rule') !== kindFilter) return false;
        return tokens.every((t) => it.searchText.includes(t));
      });
  }, [index, entries, viewVersion, q, showInactive, labelFilter, kindFilter, isAdmin, focusCode]);

  const groups = useMemo(() => {
    const bySection = new Map();
    for (const it of items) {
      const key = tree.byId.has(it.rule.sectionId) ? it.rule.sectionId : '__none';
      if (!bySection.has(key)) bySection.set(key, []);
      bySection.get(key).push(it);
    }
    // A heading is shown if the section or any descendant has visible rules.
    const visibleCount = new Map();
    for (const s of [...tree.ordered].reverse()) {
      const own = bySection.get(s.id)?.length || 0;
      const kids = (tree.children.get(s.id) || []).reduce((n, c) => n + (visibleCount.get(c.id) || 0), 0);
      visibleCount.set(s.id, own + kids);
    }
    const out = tree.ordered.filter((s) => visibleCount.get(s.id) > 0).map((s) => ({ section: s, items: bySection.get(s.id) || [], total: visibleCount.get(s.id) }));
    if (bySection.has('__none')) out.push({ section: { id: '__none', title: 'Unsorted', number: '', depth: 0 }, items: bySection.get('__none'), total: bySection.get('__none').length });
    return out;
  }, [items, tree]);

  // ----- focus a linked rule -----
  const focusedOnce = useRef(null);
  useEffect(() => {
    if (!focusCode || focusedOnce.current === focusCode || rules.loading || versions.loading) return;
    const el = document.getElementById(`rule-${focusCode}`);
    if (el) {
      focusedOnce.current = focusCode;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focusCode, rules.loading, versions.loading, groups]);

  // ----- actions -----
  const onMove = useCallback(
    (ruleId, delta) => {
      const rule = allRules.find((r) => r.id === ruleId);
      const siblings = allRules.filter((r) => r.sectionId === rule.sectionId);
      return attempt(() => moveRule(siblings, siblings.indexOf(rule), delta));
    },
    [allRules],
  );

  const [dialog, setDialog] = useState(null);
  const ownsSet = !selectedSet.builtIn && user && (selectedSet.ownerUid === user.uid || isAdmin);

  const saveExisting = () =>
    requireUser(async () => {
      const ok = await attempt(() => updateRuleset(selectedSet.id, { entries: draft.entries }), 'Ruleset saved');
      if (ok) setDraft(null);
    });

  const saveAsNew = async ({ name, description }) =>
    requireUser(async (u) => {
      const id = await attempt(() => createRuleset({ name, description, entries: draft.entries }, u), 'Ruleset saved');
      if (id) {
        setDraft(null);
        setStoredSetId(id);
        navigate('rules', [], {}, { replace: true });
      }
      return id;
    });

  const exportPdf = () => {
    const pdfGroups = groups.map(({ section, items: its }) => ({
      heading: section.number ? `${section.number}  ${section.title}` : section.title,
      depth: section.depth,
      rules: its.map((it) => ({
        code: it.rule.code,
        title: it.rule.title,
        label: it.shown?.label,
        kindLabel: it.rule.kind && it.rule.kind !== 'rule' ? KINDS[it.rule.kind] : '',
        inactive: !it.active,
        html: it.shown?.text || '',
      })),
    }));
    const name = draft ? `${selectedSet.name} (edited)` : selectedSet.name;
    const filters = [q && `search "${q}"`, labelFilter && `label ${labelFilter}`, kindFilter && KINDS[kindFilter], showInactive && 'including inactive rules'].filter(Boolean).join(', ');
    return attempt(() =>
      exportRulesPdf({
        title: 'Blood Rage: Valhalla - Living Rulebook',
        subtitle: `Ruleset: ${name} · ${items.length} rules${filters ? ` · ${filters}` : ''} · exported ${new Date().toLocaleDateString()}`,
        groups: pdfGroups,
        shorthands,
        filename: `brv-rules-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`,
      }),
    );
  };

  const loading = sections.loading || rules.loading || versions.loading;
  const anyError = sections.error || rules.error || versions.error;

  return (
    <div className={`rules-layout ${draft ? 'is-editing' : ''}`}>
      <aside className="toc" aria-label="Contents">
        <details open className="toc-details">
          <summary>Contents</summary>
          <nav>
            {groups.map(({ section, total }) => (
              <a
                key={section.id}
                href={`#sec-${section.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(`sec-${section.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className={`toc-item depth-${section.depth}`}
              >
                <span className="toc-num">{section.number}</span>
                <span className="toc-title">{section.title}</span>
                <span className="toc-count">{total}</span>
              </a>
            ))}
          </nav>
        </details>
      </aside>

      <div className="rules-main">
        <section className="ruleset-bar" aria-label="Ruleset">
          <div className="ruleset-pick">
            <label htmlFor="ruleset-select">Ruleset</label>
            <select id="ruleset-select" value={selectedSet.id} onChange={(e) => selectSet(e.target.value)}>
              <option value={RULEBOOK_SET.id}>
                {RULEBOOK_SET.name}
                {site.defaultRulesetId === RULEBOOK_SET.id ? ' — default' : ''}
              </option>
              {(publicSets.data || []).length > 0 && (
                <optgroup label="Community rulesets">
                  {publicSets.data.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {site.defaultRulesetId === s.id ? ' — default' : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              {(mySets.data || []).filter((s) => s.visibility !== 'public').length > 0 && (
                <optgroup label="My rulesets">
                  {mySets.data
                    .filter((s) => s.visibility !== 'public')
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </optgroup>
              )}
              {linkedSet.data && linkedSet.data.visibility !== 'public' && linkedSet.data.ownerUid !== user?.uid && (
                <optgroup label="Shared with you">
                  <option value={linkedSet.data.id}>
                    {linkedSet.data.name} (by {linkedSet.data.ownerName})
                  </option>
                </optgroup>
              )}
            </select>
          </div>
          <p className="ruleset-desc">
            {selectedSet.description || (selectedSet.builtIn ? '' : `A ruleset by ${selectedSet.ownerName || 'a community member'}.`)}
            {!selectedSet.builtIn && <span className="muted"> · {Object.keys(selectedSet.entries || {}).length} rules</span>}
          </p>
          <div className="ruleset-actions">
            {!draft ? (
              <button onClick={() => setDraft({ baseId: selectedSet.id, entries: { ...baseEntries } })} title="Choose which rules and versions are part of a ruleset">
                <Icon name="layers" />
                Customize
              </button>
            ) : null}
            {!selectedSet.builtIn && (
              <button
                className="icon-btn"
                title="Copy a link to this ruleset"
                aria-label="Copy a link to this ruleset"
                onClick={async () => {
                  await copyText(absoluteLink('rules', [], { set: selectedSet.id }));
                  toast('Ruleset link copied', 'ok');
                }}
              >
                <Icon name="link" />
              </button>
            )}
          </div>
        </section>

        <section className="toolbar" aria-label="Search and filters">
          <div className="search">
            <Icon name="search" />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search rules, IDs and versions…" aria-label="Search rules" />
          </div>
          <select value={labelFilter} onChange={(e) => setLabelFilter(e.target.value)} aria-label="Filter by version label">
            <option value="">Any label</option>
            {LABELS.map((l) => (
              <option key={l} value={l}>
                Has {l === 'Official Ruling' ? 'an' : 'a'} {l}
              </option>
            ))}
          </select>
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} aria-label="Filter by kind">
            <option value="">All kinds</option>
            {Object.entries(KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <label className="switch">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            <span className="switch-track" aria-hidden="true" />
            <span>Show inactive</span>
          </label>
          <div className="toolbar-end">
            <button onClick={exportPdf} disabled={!items.length} title="Download the rules currently shown as a PDF">
              <Icon name="download" />
              PDF
            </button>
            <button onClick={() => requireUser(() => setDialog('newRule'))} disabled={!tree.ordered.length}>
              <Icon name="plus" />
              {isAdmin ? 'Add rule' : 'Suggest rule'}
            </button>
          </div>
        </section>

        {anyError ? (
          <Empty title="Could not load the rules">
            <p>{anyError.message}</p>
          </Empty>
        ) : loading ? (
          <Spinner label="Loading rules…" />
        ) : allRules.length === 0 ? (
          <Empty title="No rules yet">
            <p>{isAdmin ? 'Import the transcribed rulebook from Admin → Rules to get started.' : 'An admin needs to import the rulebook first.'}</p>
          </Empty>
        ) : groups.length === 0 ? (
          <Empty title="No rules match">
            <p>Try another search{showInactive ? '' : ', or turn on “Show inactive”'}.</p>
          </Empty>
        ) : (
          <div className="rule-list">
            <p className="result-count muted small" aria-live="polite">
              Showing {items.length} of {allRules.length} rules
            </p>
            {groups.map(({ section, items: its }) => {
              const H = section.depth === 0 ? 'h2' : section.depth === 1 ? 'h3' : 'h4';
              return (
                <section key={section.id} className={`rule-section depth-${section.depth}`} aria-labelledby={`sec-${section.id}`}>
                  <H id={`sec-${section.id}`} className="section-heading">
                    {section.number && <span className="section-num">{section.number}</span>}
                    {section.title}
                    {section.code && <span className="section-code">{section.code}</span>}
                  </H>
                  {its.map((it) => {
                    const siblings = allRules.filter((r) => r.sectionId === it.rule.sectionId);
                    const pos = siblings.indexOf(it.rule);
                    return (
                      <RuleCard
                        key={it.rule.id}
                        item={it}
                        setName={draft ? 'your edit' : selectedSet.name}
                        editing={Boolean(draft)}
                        focused={it.rule.code === focusCode}
                        onShowVersion={onShowVersion}
                        onSetActive={onSetActive}
                        onUseVersion={onUseVersion}
                        onMove={onMove}
                        canMoveUp={pos > 0}
                        canMoveDown={pos < siblings.length - 1}
                        tree={tree}
                        rules={allRules}
                      />
                    );
                  })}
                </section>
              );
            })}
          </div>
        )}
      </div>

      {draft && (
        <div className="draft-bar" role="region" aria-label="Ruleset editor">
          <div>
            <b>Customizing “{selectedSet.name}”</b>
            <span className="muted">
              {' '}
              · {Object.keys(draft.entries).length} rules active · {changeCount} change{changeCount === 1 ? '' : 's'}
            </span>
            <p className="small muted">Toggle “In ruleset” on each rule, or browse to another version and choose “Use this version”.</p>
          </div>
          <div className="row gap">
            <button onClick={() => (!changeCount || confirm('Discard your changes?')) && setDraft(null)}>Discard</button>
            {ownsSet && (
              <button className="primary" onClick={saveExisting} disabled={!changeCount}>
                <Icon name="save" />
                Save
              </button>
            )}
            <button className={ownsSet ? '' : 'primary'} onClick={() => requireUser(() => setDialog('saveAs'))}>
              Save as new…
            </button>
          </div>
        </div>
      )}

      {dialog === 'newRule' && (
        <RuleDialog
          tree={tree}
          rules={allRules}
          onClose={() => setDialog(null)}
          onCreated={(code) => {
            if (!isAdmin) setShowInactive(true);
            setTimeout(() => navigate('rules', [code]), 300);
          }}
        />
      )}
      {dialog === 'saveAs' && (
        <SaveRulesetDialog
          initialName={selectedSet.builtIn ? '' : `${selectedSet.name} (copy)`}
          initialDescription={selectedSet.builtIn ? '' : selectedSet.description}
          onSave={saveAsNew}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
