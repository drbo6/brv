import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, deleteField } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { useDebounced, useLive, useLocalStorage } from '../lib/hooks.js';
import { useDraftHistory, useUndoScope } from '../lib/history.js';
import { absoluteLink, navigate } from '../lib/router.js';
import { createRuleset, groupVersions, kindInfo, LABELS, moveRule, RULEBOOK_SET, rulebookEntries, sectionTree, sortRules, updateRuleset } from '../lib/rules.js';
import { toPlainText } from '../lib/html.js';
import { useSession } from '../lib/session.jsx';
import { exportRulesPdf } from '../lib/pdf.js';
import RuleCard from '../components/RuleCard.jsx';
import RulesetSelect, { useRulesetChoice } from '../components/RulesetSelect.jsx';
import { RuleDialog, SaveRulesetDialog } from '../components/RuleDialogs.jsx';
import { attempt, copyText, Empty, Icon, Spinner, toast } from '../components/ui.jsx';
import { confirmDialog } from '../components/dialogs.jsx';

export default function RulesPage({ route }) {
  const { user, isAdmin, shorthands, requireUser, kinds } = useSession();
  const sections = useLive(() => collection(db, 'sections'), []);
  const rules = useLive(() => collection(db, 'rules'), []);
  const versions = useLive(() => collection(db, 'versions'), []);

  // ----- ruleset selection -----
  const choice = useRulesetChoice(route.params.get('set'));
  const { selectedSet, setStoredSetId } = choice;

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
  // { baseId, entries } while customizing. Each toggle is one undo step (Ctrl+Z works too).
  const [draft, setDraft, draftHistory] = useDraftHistory(null, 0);
  useUndoScope(draftHistory);
  const endDraft = draftHistory.reset;
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
  // One rule at a time shows its tools; a linked rule starts open.
  const [openId, setOpenId] = useState(null);
  const onToggle = useCallback((ruleId) => setOpenId((id) => (id === ruleId ? null : ruleId)), []);
  const onShowVersion = useCallback((ruleId, vid) => setViewVersion((m) => ({ ...m, [ruleId]: vid })), []);
  // Changing a rule's version or switching it off starts an unsaved draft of the ruleset if needed.
  const baseRef = useRef(null);
  baseRef.current = { baseId: selectedSet.id, entries: baseEntries };
  const editDraft = useCallback(
    (fn) => setDraft((d) => {
      const cur = d || { ...baseRef.current, customizing: false };
      return { ...cur, entries: fn({ ...cur.entries }) };
    }),
    [setDraft],
  );
  const onSetActive = useCallback(
    (ruleId, vid) =>
      editDraft((e) => {
        if (vid) e[ruleId] = vid;
        else delete e[ruleId];
        return e;
      }),
    [editDraft],
  );
  const onUseVersion = useCallback((ruleId, vid) => editDraft((e) => ({ ...e, [ruleId]: vid })), [editDraft]);
  const unsaved = Boolean(draft) && changeCount > 0;
  // Rules of the set that the reader stepped to another version of: the page no longer shows the set as it is.
  const browsed = useMemo(() => Object.keys(viewVersion).filter((rid) => entries[rid] && viewVersion[rid] !== entries[rid]), [viewVersion, entries]);
  const showBrowsed = () => {
    const first = allRules.find((r) => r.id === browsed[0]);
    if (first) {
      setOpenId(first.id);
      document.getElementById(`rule-${first.code}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const selectSet = async (id) => {
    if (draft && changeCount && !(await confirmDialog({ title: 'Discard changes', message: 'Discard your unsaved ruleset changes?', confirmLabel: 'Discard', danger: true }))) return;
    endDraft(null);
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
        // While customizing a ruleset, inactive rules stay visible so they can be switched back on.
        if (!it.active && !showInactive && !draft) return false;
        if (labelFilter && !it.vs.some((v) => v.label === labelFilter)) return false;
        if (kindFilter && (it.rule.kind || 'rule') !== kindFilter) return false;
        return tokens.every((t) => it.searchText.includes(t));
      });
  }, [index, entries, viewVersion, q, showInactive, labelFilter, kindFilter, isAdmin, focusCode, draft]);

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
      const linked = allRules.find((r) => r.code === focusCode);
      if (linked) setOpenId(linked.id);
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focusCode, rules.loading, versions.loading, groups, allRules]);

  // ----- actions -----
  const onMove = useCallback(
    (ruleId, delta) => {
      const rule = allRules.find((r) => r.id === ruleId);
      const siblings = allRules.filter((r) => r.sectionId === rule.sectionId);
      return attempt(() => moveRule(siblings, siblings.indexOf(rule), delta), null, 'move rule');
    },
    [allRules],
  );

  const [dialog, setDialog] = useState(null);
  // The contents list starts collapsed on narrow screens, where it sits above the rules.
  const [tocOpen] = useState(() => window.matchMedia('(min-width: 901px)').matches);
  const ownsSet = !selectedSet.builtIn && user && (selectedSet.ownerUid === user.uid || isAdmin);

  const saveExisting = () =>
    requireUser(async () => {
      // Write only the rules that changed, so edits others made to other rules in this set survive.
      const patch = {};
      for (const k of new Set([...Object.keys(draft.entries), ...Object.keys(baseEntries)])) {
        if (draft.entries[k] !== baseEntries[k]) patch[`entries.${k}`] = draft.entries[k] ?? deleteField();
      }
      const ok = await attempt(() => updateRuleset(selectedSet.id, patch), 'Ruleset saved');
      if (ok) endDraft(null);
    });

  const saveAsNew = async ({ name, description }) =>
    requireUser(async (u) => {
      const id = await attempt(() => createRuleset({ name, description, entries: draft.entries }, u), 'Ruleset saved');
      if (id) {
        endDraft(null);
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
        kindLabel: it.rule.kind && it.rule.kind !== 'rule' ? kindInfo(kinds, it.rule.kind).label : '',
        inactive: !it.active,
        html: it.shown?.text || '',
      })),
    }));
    const name = `${selectedSet.name}${unsaved ? ' (unsaved changes)' : ''}${browsed.length ? `, ${browsed.length} rule${browsed.length === 1 ? '' : 's'} in other versions` : ''}`;
    const filters = [q && `search "${q}"`, labelFilter && `label ${labelFilter}`, kindFilter && kindInfo(kinds, kindFilter).label, showInactive && 'including inactive rules'].filter(Boolean).join(', ');
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
        <details open={tocOpen} className="toc-details">
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
            <RulesetSelect choice={choice} onChange={selectSet} unsaved={unsaved} differs={browsed.length > 0} />
            {unsaved && (
              <span className="tag t-warn unsaved-tag" title="You changed which rules or versions this ruleset uses. Save or discard below.">
                Unsaved changes
              </span>
            )}
          </div>
          {(unsaved || browsed.length > 0) && (
            <div className="ruleset-status" role="status">
              <Icon name="info" />
              <span>
                {unsaved && (
                  <>
                    You changed {changeCount} rule{changeCount === 1 ? '' : 's'} in “{selectedSet.name}”: the page shows your unsaved version of the ruleset.{' '}
                  </>
                )}
                {browsed.length > 0 && (
                  <>
                    {browsed.length === 1 ? 'One rule is' : `${browsed.length} rules are`} shown in a version that “{selectedSet.name}”{unsaved ? ' (with your changes)' : ''} doesn't use.{' '}
                  </>
                )}
              </span>
              <span className="ruleset-status-actions">
                {browsed.length > 0 && (
                  <>
                    <button className="small" onClick={showBrowsed} title="Scroll to the first rule shown in another version">
                      Show {browsed.length === 1 ? 'it' : 'them'}
                    </button>
                    <button className="small" onClick={() => editDraft((e) => ({ ...e, ...Object.fromEntries(browsed.map((rid) => [rid, viewVersion[rid]])) }))} title="Make the ruleset use the versions you are looking at (as unsaved changes)">
                      Use {browsed.length === 1 ? 'this version' : 'these versions'}
                    </button>
                    <button className="small" onClick={() => setViewVersion({})} title={`Show every rule in the version “${selectedSet.name}” uses`}>
                      Back to the ruleset's versions
                    </button>
                  </>
                )}
              </span>
            </div>
          )}
          <p className="ruleset-desc">
            {selectedSet.description || (selectedSet.builtIn ? '' : `A ruleset by ${selectedSet.ownerName || 'a community member'}.`)}
            {!selectedSet.builtIn && <span className="muted"> · {Object.keys(selectedSet.entries || {}).length} rules</span>}
          </p>
          <div className="ruleset-actions">
            {!draft?.customizing ? (
              <button
                onClick={() => (draft ? setDraft((d) => ({ ...d, customizing: true })) : endDraft({ baseId: selectedSet.id, entries: { ...baseEntries }, customizing: true }))}
                title="Show an “In ruleset” switch on every rule, to choose which rules and versions are part of this ruleset"
              >
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
            {kinds.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
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
            <p>{isAdmin ? 'Load the rules from Admin → Backup & import (for example imports/blood-rage-valhalla.json from the repository).' : 'An admin needs to import the rulebook first.'}</p>
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
                        setName={unsaved ? `${selectedSet.name} (unsaved)` : selectedSet.name}
                        editing={Boolean(draft?.customizing)}
                        focused={it.rule.code === focusCode}
                        open={openId === it.rule.id}
                        onToggle={onToggle}
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
            <b>{draft.customizing ? `Customizing “${selectedSet.name}”` : `Unsaved changes to “${selectedSet.name}”`}</b>
            <span className="muted">
              {' '}
              · {Object.keys(draft.entries).length} rules active · {changeCount} change{changeCount === 1 ? '' : 's'}
            </span>
            <p className="small muted">
              {draft.customizing
                ? 'Toggle “In ruleset” on each rule, or browse to another version and choose “Use this version”.'
                : selectedSet.builtIn
                  ? 'The printed rulebook can’t be changed: save your changes as a new ruleset.'
                  : 'Save them to the ruleset, save them as a new ruleset, or discard them.'}
            </p>
          </div>
          <div className="row gap">
            <button className="icon-btn" onClick={draftHistory.undo} disabled={!draftHistory.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
              <Icon name="undo" />
            </button>
            <button className="icon-btn" onClick={draftHistory.redo} disabled={!draftHistory.canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
              <Icon name="redo" />
            </button>
            <button onClick={async () => (!changeCount || (await confirmDialog({ title: 'Discard changes', message: `Discard your ${changeCount} unsaved change${changeCount === 1 ? '' : 's'}?`, confirmLabel: 'Discard', danger: true }))) && endDraft(null)}>Discard</button>
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
