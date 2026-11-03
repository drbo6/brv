import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { useDebounced, useLive, useLocalStorage } from '../lib/hooks.js';
import { navigate } from '../lib/router.js';
import { entryFor, findVersion, groupVersions, HB, LABELS, moveRule, rulebookEntries, sectionTree, shortIds, sortRules } from '../lib/rules.js';
import { HOMEBREW, withHomebrew } from '../lib/homebrew.js';
import { toPlainText } from '../lib/html.js';
import { useSession } from '../lib/session.jsx';
import RuleCard from '../components/RuleCard.jsx';
import { useActiveRuleset } from '../components/ActiveRuleset.jsx';
import { RuleDialog } from '../components/RuleDialogs.jsx';
import { attempt, Disclaimer, Empty, Icon, Spinner } from '../components/ui.jsx';

export default function RulesPage({ route }) {
  const { isEditor, requireUser, kinds, user } = useSession();
  const sections = useLive(() => collection(db, 'sections'), []);
  const rules = useLive(() => collection(db, 'rules'), []);
  const versions = useLive(() => collection(db, 'versions'), []);

  // ----- the active ruleset (shared with the Components page, shown in the site-wide bar) -----
  const rs = useActiveRuleset();
  const { selectedSet, unsaved, customizing, myHomebrew } = rs;

  // ----- derived rule data -----
  const tree = useMemo(() => sectionTree(sections.data || []), [sections.data]);
  // The reader's own homebrew rules and versions show in place, for them only.
  const merged = useMemo(() => withHomebrew(myHomebrew, rules.data || [], versions.data || []), [myHomebrew, rules.data, versions.data]);
  const vByRule = useMemo(() => groupVersions(merged.versions), [merged.versions]);
  // Every rule carries its short, permanent id (sid); homebrew rules have none until shared.
  const allRules = useMemo(() => {
    const sids = shortIds(rules.data || []);
    return sortRules(merged.rules).map((r) => ({ ...r, sid: sids.get(r.id) }));
  }, [rules.data, merged.rules]);
  const rulebook = useMemo(() => rulebookEntries(allRules, vByRule), [allRules, vByRule]);
  const index = useMemo(
    () =>
      allRules.map((rule) => {
        const vs = vByRule.get(rule.id) || [];
        return { rule, vs, searchText: `${rule.sid} ${rule.title} ${vs.map((v) => `${rule.sid}.${v.num} ${v.label} ${toPlainText(v.text)} ${v.note || ''}`).join(' ')}`.toLowerCase() };
      }),
    [allRules, vByRule],
  );

  const baseEntries = useMemo(() => (selectedSet.builtIn ? rulebook : selectedSet.entries || {}), [selectedSet, rulebook]);
  const { apply } = rs;
  const entries = useMemo(() => apply(baseEntries, 'rules'), [apply, baseEntries]);
  useEffect(() => {
    rs.setRulebook(rulebook);
  }, [rulebook]); // eslint-disable-line react-hooks/exhaustive-deps
  // Edits while customizing or reading keep inactive rules visible, so they can be switched back on.
  const editing = unsaved || customizing;

  const [viewVersion, setViewVersion] = useState({});
  // One rule at a time shows its tools; a linked rule starts open.
  const [openId, setOpenId] = useState(null);
  const onToggle = useCallback((ruleId) => setOpenId((id) => (id === ruleId ? null : ruleId)), []);
  // Clicking outside the rules closes the open one. Rules handle clicks on themselves, and dialogs,
  // menus and notices opened from a rule don't count as outside.
  useEffect(() => {
    if (!openId) return;
    const onClick = (e) => {
      if (!e.target.isConnected || e.target.closest('article.rule, .modal, .dialog, .modal-backdrop, [role="dialog"], [role="menu"], [role="listbox"], .toast')) return;
      setOpenId(null);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [openId]);
  const onShowVersion = useCallback((ruleId, vid) => setViewVersion((m) => ({ ...m, [ruleId]: vid })), []);
  // Changing a rule's version or leaving it out is an unsaved change to the active ruleset.
  const baseRef = useRef(baseEntries);
  baseRef.current = baseEntries;
  const setRule = rs.setRule;
  const onSetActive = useCallback((ruleId, vid) => setRule(ruleId, vid, baseRef.current[ruleId]), [setRule]);
  const onUseVersion = onSetActive;
  // Rules of the set that the reader stepped to another version of: the page no longer shows the set as it is.
  const browsed = useMemo(() => Object.keys(viewVersion).filter((rid) => entries[rid] && viewVersion[rid] !== entries[rid]), [viewVersion, entries]);
  const showBrowsed = () => {
    const first = allRules.find((r) => r.id === browsed[0]);
    if (first) {
      setOpenId(first.id);
      document.getElementById(`rule-${first.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // A different ruleset starts from its own versions.
  useEffect(() => {
    setViewVersion({});
  }, [selectedSet.id]);

  // ----- pinned search area, pinned by default (below the site-wide ruleset bar) -----
  const [pinned, setPinned] = useLocalStorage('brv-pin-rules-top', true);
  const [stuck, setStuck] = useState(false);
  const topRef = useRef(null);
  const sentinelRef = useRef(null);
  useEffect(() => {
    // "Stuck" once the page scrolled past the top of the area: it then compacts.
    const css = getComputedStyle(document.documentElement);
    const above = (parseFloat(css.getPropertyValue('--header-h')) || 64) + (parseFloat(css.getPropertyValue('--ruleset-bar-h')) || 0);
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { rootMargin: `-${above + 1}px 0px 0px 0px` });
    if (sentinelRef.current) io.observe(sentinelRef.current);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    // Jumps to a rule or section leave room for the pinned area.
    const root = document.documentElement;
    const el = topRef.current;
    if (!pinned || !el) {
      root.style.setProperty('--rules-top-h', '0px');
      return undefined;
    }
    const ro = new ResizeObserver(() => root.style.setProperty('--rules-top-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.setProperty('--rules-top-h', '0px');
    };
  }, [pinned]);

  // ----- filters -----
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim().toLowerCase(), 150);
  const [showInactive, setShowInactive] = useLocalStorage('brv-show-inactive', false);
  const [labelFilter, setLabelFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  // Links name a rule by its short id, optionally with a version ("k7q2m.2"). Older links used the
  // document id or a section code; those still work.
  const focusParam = route.parts[0] || null;
  const focus = useMemo(() => {
    if (!focusParam) return null;
    const [sid, num] = focusParam.split('.');
    const byShort = allRules.find((r) => r.sid === sid);
    if (byShort) return { id: byShort.id, num: num ? Number(num) : null };
    const legacy = allRules.find((r) => r.id === focusParam || r.code === focusParam);
    return legacy ? { id: legacy.id, num: null } : null;
  }, [focusParam, allRules]);
  const focusId = focus?.id ?? null;

  const items = useMemo(() => {
    const tokens = q.split(/\s+/).filter(Boolean);
    return index
      .map(({ rule, vs, searchText }) => {
        const activeVersion = findVersion(vs, entryFor(entries, rule));
        const shown = findVersion(vs, viewVersion[rule.id]) || activeVersion || vs.find((v) => v.label === 'Rulebook') || vs[0];
        return { rule, vs, searchText, active: Boolean(activeVersion), activeVersion, shown };
      })
      .filter((it) => {
        if (it.rule.id === focusId) return true;
        if (it.rule.status === 'rejected' && !(isEditor && showInactive)) return false;
        // While customizing a ruleset, inactive rules stay visible so they can be switched back on.
        // Your own homebrew rules always show, shared or not, so you can find them.
        const mine = it.rule.homebrew || (it.rule.homebrewId && it.rule.status === 'suggested' && it.rule.createdBy === user?.uid);
        if (!it.active && !showInactive && !editing && !mine) return false;
        if (labelFilter && !it.vs.some((v) => v.label === labelFilter)) return false;
        if (kindFilter && (it.rule.kind || 'rule') !== kindFilter) return false;
        return tokens.every((t) => it.searchText.includes(t));
      });
  }, [index, entries, viewVersion, q, showInactive, labelFilter, kindFilter, isEditor, focusId, editing, user?.uid]);

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
    if (!focusId || focusedOnce.current === focusParam || rules.loading || versions.loading) return;
    const el = document.getElementById(`rule-${focusId}`);
    if (el) {
      focusedOnce.current = focusParam;
      setOpenId(focusId);
      // A link to a specific version shows that version.
      const v = focus.num && (vByRule.get(focusId) || []).find((x) => x.num === focus.num);
      if (v) setViewVersion((m) => ({ ...m, [focusId]: v.id }));
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focusId, focusParam, rules.loading, versions.loading, groups]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const jumpTo = (sectionId) => document.getElementById(`sec-${sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });


  const loading = sections.loading || rules.loading || versions.loading;
  const anyError = sections.error || rules.error || versions.error;

  return (
    <div className={`rules-layout ${customizing ? 'is-editing' : ''}`}>
      <aside className="toc" aria-label="Contents">
        <h2 className="toc-heading">Contents</h2>
        <nav>
          {groups.map(({ section, total }) => (
            <a
              key={section.id}
              href={`#sec-${section.id}`}
              onClick={(e) => {
                e.preventDefault();
                jumpTo(section.id);
              }}
              className={`toc-item depth-${section.depth}`}
            >
              <span className="toc-num">{section.number}</span>
              <span className="toc-title">{section.title}</span>
              <span className="toc-count">{total}</span>
            </a>
          ))}
        </nav>
        <p className="toc-disclaimer">
          <Disclaimer />
        </p>
      </aside>

      <div className="rules-main">
        <div ref={sentinelRef} className="rules-top-sentinel" aria-hidden="true" />
        <div ref={topRef} className={`rules-top ${pinned ? 'pinned' : ''} ${pinned && stuck ? 'stuck' : ''}`}>
        <section className="toolbar" aria-label="Search and filters">
          <select
            className="toc-jump"
            value=""
            onChange={(e) => {
              if (e.target.value) jumpTo(e.target.value);
            }}
            aria-label="Jump to section"
          >
            <option value="">Jump to section…</option>
            {groups.map(({ section }) => (
              <option key={section.id} value={section.id}>
                {'\u00a0\u00a0'.repeat(section.depth)}
                {section.number} {section.title}
              </option>
            ))}
          </select>
          <div className="search">
            <Icon name="search" />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search rules, IDs and versions…" aria-label="Search rules" />
          </div>
          <select value={labelFilter} onChange={(e) => setLabelFilter(e.target.value)} aria-label="Filter by version label">
            <option value="">Any label</option>
            {[...LABELS, ...(myHomebrew.length ? [HOMEBREW] : [])].map((l) => (
              <option key={l} value={l}>
                {l === HOMEBREW ? 'Has your Homebrew' : `Has ${l === 'Official Ruling' ? 'an' : 'a'} ${l}`}
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
            <button
              onClick={() => (isEditor ? requireUser(() => setDialog('newRule')) : rs.startHomebrew(() => setDialog('newRule')))}
              disabled={!tree.ordered.length}
              title={isEditor ? 'Add a rule to the rulebook' : 'Write a rule of your own: only you see it until you share it'}
            >
              <Icon name={isEditor ? 'plus' : 'flask'} />
              {isEditor ? 'Add rule' : 'Add homebrew rule'}
            </button>
            <button
              className={`icon-btn pin-btn ${pinned ? 'on' : ''}`}
              onClick={() => setPinned(!pinned)}
              aria-pressed={pinned}
              title={pinned ? 'Unpin: let the search bar scroll away with the page' : 'Pin the search bar to the top while you scroll'}
              aria-label={pinned ? 'Unpin the search bar' : 'Pin the search bar'}
            >
              <Icon name={pinned ? 'pin' : 'pinOff'} />
            </button>
          </div>
        </section>
        {browsed.length > 0 && (
          <div className="ruleset-status" role="status">
            <Icon name="info" />
            <span>
              {browsed.length === 1 ? 'One rule is' : `${browsed.length} rules are`} shown in a version that “{selectedSet.name}”{unsaved ? ' (with your changes)' : ''} doesn't use.
            </span>
            <span className="ruleset-status-actions">
              <button className="small" onClick={showBrowsed} title="Scroll to the first rule shown in another version">
                Show {browsed.length === 1 ? 'it' : 'them'}
              </button>
              <button className="small" onClick={() => browsed.forEach((rid) => onUseVersion(rid, viewVersion[rid]))} title={`Make ${rs.setLabel} use the versions you are looking at (unsaved until you save)`}>
                Use {browsed.length === 1 ? 'it' : 'them'} in {rs.setLabel}
              </button>
              <button className="small" onClick={() => setViewVersion({})} title={`Show every rule in the version “${selectedSet.name}” uses`}>
                Back to the ruleset's versions
              </button>
            </span>
          </div>
        )}
        </div>

        {anyError ? (
          <Empty title="Could not load the rules">
            <p>{anyError.message}</p>
          </Empty>
        ) : loading ? (
          <Spinner label="Loading rules…" />
        ) : allRules.length === 0 ? (
          <Empty title="No rules yet">
            <p>{isEditor ? 'Add the first rule with “Add rule”, or have the owner load prepared content (see the README).' : 'The rulebook hasn’t been added yet.'}</p>
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
                  </H>
                  {its.map((it) => {
                    const siblings = allRules.filter((r) => r.sectionId === it.rule.sectionId);
                    const pos = siblings.indexOf(it.rule);
                    return (
                      <RuleCard
                        key={it.rule.id}
                        item={it}
                        setName={unsaved ? `${selectedSet.name} (unsaved)` : selectedSet.name}
                        editing={customizing}
                        focused={it.rule.id === focusId}
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

      {dialog === 'newRule' && (
        <RuleDialog
          tree={tree}
          rules={allRules}
          onClose={() => setDialog(null)}
          onCreated={(id) => {
            if (!id.startsWith(HB)) return setTimeout(() => navigate('rules', [shortIds([{ id }]).get(id)]), 300);
            // A homebrew rule has no link of its own: open it where it landed.
            setOpenId(id);
            setTimeout(() => document.getElementById(`rule-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
          }}
        />
      )}
    </div>
  );
}
