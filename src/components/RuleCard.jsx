import { memo, useState } from 'react';
import { absoluteLink, href } from '../lib/router.js';
import { deleteRule, deleteVersion, kindInfo, LABEL_CLASS, react, ruleName, updateRule, versionRef } from '../lib/rules.js';
import { useSession } from '../lib/session.jsx';
import Discussion from './Discussion.jsx';
import { RulesetChoiceRow, useActiveRuleset } from './ActiveRuleset.jsx';
import { HomebrewBar } from './Homebrew.jsx';
import { RuleDialog, VersionDialog } from './RuleDialogs.jsx';
import { attempt, copyText, Icon, Linkify, Reactions, RichText, timeAgo, toast, UserName } from './ui.jsx';
import { confirmDialog } from './dialogs.jsx';
import FollowButton from './FollowButton.jsx';
import { notify, ruleTarget } from '../lib/inbox.js';

/**
 * One rule. Reads like running text; clicking it opens the tools: versions, reactions, discussion,
 * suggestions and (for admins) editing. Shows the version picked by the current ruleset, or the one
 * the reader browsed to.
 */
function RuleCard({ item, setName, editing, focused, open, onToggle, onShowVersion, onSetActive, onUseVersion, onMove, canMoveUp, canMoveDown, tree, rules }) {
  const { isEditor, requireUser, user, kinds } = useSession();
  const { rule, vs, active, activeVersion, shown } = item;
  const { myHomebrew, startHomebrew } = useActiveRuleset();
  // A homebrew rule of the reader's own, not shared: only they see it.
  const brewRule = rule.status === 'homebrew';
  // The reader's homebrew behind the version on screen: private, or the public copy they shared.
  const hb = shown?.homebrew || (shown?.homebrewId && user && shown.createdBy === user.uid ? myHomebrew.find((h) => h.id === shown.homebrewId) : null) || null;
  const [discussOpen, setDiscussOpen] = useState(focused && !brewRule);
  const [dialog, setDialog] = useState(null);
  const idx = shown ? vs.indexOf(shown) : -1;
  const shownInSet = Boolean(shown && activeVersion && shown.id === activeVersion.id);

  const step = (d) => {
    const next = vs[(idx + d + vs.length) % vs.length];
    if (next) onShowVersion(rule.id, next.id);
  };

  const copyLink = async () => {
    // Viewing another version than the ruleset's? Link to exactly that version.
    const ref = shown && !shownInSet ? versionRef(rule, shown) : rule.sid;
    await copyText(absoluteLink('rules', [ref || rule.id]));
    toast(`Link to ${ref || ruleName(rule)} copied`, 'ok');
  };

  const approve = async () =>
    (await confirmDialog({ title: 'Approve rule', message: `Make “${rule.title}” an active rule of the rulebook, for everyone?`, confirmLabel: 'Approve' })) &&
    attempt(() => updateRule(rule.id, { status: 'active' }), 'Rule approved').then((ok) => {
      if (!ok) return;
      const t = ruleTarget(rule);
      notify(t.key, user, { type: 'approved', title: `${user.displayName || 'An admin'} approved the suggested rule “${rule.title}”`, text: '', link: t.link });
    });

  const kind = kindInfo(kinds, rule.kind);
  const hasKind = rule.kind && rule.kind !== 'rule';
  const classes = ['rule', `kind-${rule.kind || 'rule'}`, hasKind ? 'has-kind' : '', active ? 'active' : 'inactive', open ? 'open' : '', focused ? 'focused' : '', rule.status === 'suggested' ? 'is-suggested' : '', rule.status === 'rejected' ? 'is-rejected' : '', brewRule ? 'is-homebrew-rule' : ''];

  // Clicking anywhere in the text opens the rule's tools, unless the reader is selecting text or following a link.
  const onBodyClick = (e) => {
    if (e.target.closest('a, button, input, select, textarea, label') || String(window.getSelection?.() || '')) return;
    onToggle(rule.id);
  };

  return (
    <article id={`rule-${rule.id}`} className={classes.join(' ')} aria-label={ruleName(rule)} style={hasKind && kind.color ? { '--kind': kind.color } : undefined}>
      <div className="rule-read" onClick={onBodyClick}>
        <header className="rule-head">
          <h3 className="rule-title">
            <button type="button" className="rule-toggle" onClick={() => onToggle(rule.id)} aria-expanded={open} title={open ? 'Hide tools' : 'Show versions, reactions and discussion'}>
              {rule.title}
            </button>
          </h3>
          {brewRule ? (
            <span className="rule-code is-homebrew" title="Your homebrew rule: only you see it">
              <Icon name="flask" size={13} />
            </span>
          ) : (
            <span className="rule-code" title="This rule's permanent id: use it to cite the rule">
              {rule.sid}
            </span>
          )}
          {hasKind && (
            <span className="kind-tag" title={`Kind: ${kind.label}. Filter by kind in the toolbar.`}>
              {kind.label}
            </span>
          )}
          {rule.status === 'suggested' && <span className="tag t-suggestion">{rule.homebrewId ? 'Shared homebrew' : 'Suggested rule'}</span>}
          {brewRule && <span className="tag t-homebrew">Your homebrew</span>}
          {rule.status === 'rejected' && <span className="tag t-muted">Rejected</span>}
          {!active && !brewRule && <span className="tag t-muted">Inactive</span>}
          {!open && (
            <span className="rule-hints">
              {shown && shown.label !== 'Rulebook' && <span className={`hint-label l-${LABEL_CLASS[shown.label] || 'other'}`}>{shown.label}</span>}
              <span className={`hint-count ${vs.length > 1 ? 'has' : ''}`} title={`${vs.length} version${vs.length === 1 ? '' : 's'}`} aria-label={`${vs.length} versions`}>
                <Icon name="layers" size={13} /> {vs.length}
              </span>
              {!brewRule && <span className={`hint-count ${rule.commentCount ? 'has' : ''}`} title={`${rule.commentCount || 0} comment${rule.commentCount === 1 ? '' : 's'}`} aria-label={`${rule.commentCount || 0} comments`}>
                <Icon name="message" size={13} /> {rule.commentCount || 0}
              </span>}
            </span>
          )}
        </header>

        {shown ? <RichText html={shown.text} className="rule-text" /> : <p className="muted">This rule has no text yet.</p>}
      </div>

      {open && (
        <div className="rule-panel">
          {shown && (shown.note || shown.label !== 'Rulebook') && (
            <p className="version-meta">
              {shown.label !== 'Rulebook' && !shown.homebrew && (
                <span>
                  Added by <UserName uid={shown.createdBy} fallback={shown.createdByName} /> · {timeAgo(shown.createdAt)}
                </span>
              )}
              {shown.note && (
                <span className="version-note">
                  <Linkify text={shown.note} />
                </span>
              )}
            </p>
          )}

          <div className="rule-foot">
            {shown && (
              <div className="version-switch">
                {vs.length > 1 && (
                  <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous version">
                    <Icon name="left" />
                  </button>
                )}
                <span className={`label l-${LABEL_CLASS[shown.label] || 'other'}`}>{shown.label}</span>
                {versionRef(rule, shown) && (
                  <span className="version-ref" title="Cite this exact version with this reference">
                    {versionRef(rule, shown)}
                  </span>
                )}
                {shown.label === 'Rulebook' && rule.page != null && <span className="page-ref">p. {rule.page}</span>}
                {vs.length > 1 && (
                  <>
                    <span className="version-count" aria-live="polite">
                      {idx + 1}/{vs.length}
                    </span>
                    <button className="icon-btn" onClick={() => step(1)} aria-label="Next version">
                      <Icon name="right" />
                    </button>
                  </>
                )}
                {active && !shownInSet && (
                  <span className="tag t-warn" title={`${setName} uses a different version of this rule`}>
                    Not in {setName}
                  </span>
                )}
              </div>
            )}

            {shown && !shown.homebrew && (
              <Reactions
                reactions={shown.reactions}
                onReact={(type) => requireUser((u) => attempt(() => react('versions', shown.id, u.uid, shown.reactions?.[u.uid], type), null, 'reaction'), 'talk')}
              />
            )}

            <div className="rule-actions">
              {!brewRule && (
                <button className={`chip ${discussOpen ? 'on' : ''}`} onClick={() => setDiscussOpen((o) => !o)} aria-expanded={discussOpen}>
                  <Icon name="message" />
                  <span>{rule.commentCount || 0}</span>
                  <span className="hide-sm">Discuss</span>
                </button>
              )}
              {!brewRule && user && (
                <button className="chip" onClick={() => startHomebrew(() => setDialog('brew'))} title="Write this rule your own way. Only you see your homebrew; share it when you want others to consider it.">
                  <Icon name="flask" />
                  <span className="hide-sm">Homebrew</span>
                </button>
              )}
              {!brewRule && <FollowButton target={ruleTarget(rule)} what={`${ruleName(rule)} (its discussion and versions)`} />}
              {!brewRule && (
                <button className="chip" onClick={copyLink} title="Copy a link to this rule (it keeps working when rules are renumbered)" aria-label={`Copy link to ${ruleName(rule)}`}>
                  <Icon name="link" />
                </button>
              )}
            </div>
          </div>

          {hb && (
            <HomebrewBar
              hb={hb}
              pub={shown.homebrew ? null : shown}
              target={ruleTarget(rule)}
              onEdit={() => setDialog(hb.kind === 'rule' ? 'brewRule' : 'brewEdit')}
              onDeleted={() => onShowVersion(rule.id, null)}
            />
          )}

          {shown && !editing && rule.status !== 'suggested' && rule.status !== 'rejected' && (
            <RulesetChoiceRow
              inSet={shownInSet}
              active={active}
              onUse={() => onUseVersion(rule.id, shown.id)}
              onAdd={() => onSetActive(rule.id, shown.id)}
              onRemove={() => onSetActive(rule.id, null)}
            />
          )}

          {isEditor && !brewRule && (
            <div className="admin-tools" role="group" aria-label="Admin tools">
              <span className="admin-tools-label">Admin</span>
              <button className="chip" onClick={() => setDialog('suggest')} title="Add an official, community or other public version of this rule">
                <Icon name="plus" />
                Add version
              </button>
              {shown && !shown.homebrew && (
                <button className="chip" onClick={() => setDialog('version')} title="Edit this version">
                  <Icon name="edit" />
                  Edit version
                </button>
              )}
              {shown && !shown.homebrew && vs.length > 1 && (
                <button className="chip danger" onClick={async () => (await confirmDialog({ title: 'Delete version', message: `Delete this ${shown.label} version of ${ruleName(rule)}?`, confirmLabel: 'Delete', danger: true })) && attempt(() => deleteVersion(shown.id), 'Version deleted')}>
                  <Icon name="trash" />
                  Delete version
                </button>
              )}
              <button className="chip" onClick={() => setDialog('rule')}>
                <Icon name="edit" />
                Rule details
              </button>
              <button className="chip" onClick={() => onMove(rule.id, -1)} disabled={!canMoveUp} aria-label="Move up" title="Move up">
                <Icon name="arrowUp" />
              </button>
              <button className="chip" onClick={() => onMove(rule.id, 1)} disabled={!canMoveDown} aria-label="Move down" title="Move down">
                <Icon name="arrowDown" />
              </button>
              {rule.status === 'suggested' && (
                <button className="chip ok" onClick={approve}>
                  <Icon name="check" />
                  Approve rule
                </button>
              )}
              <button className="chip danger" onClick={async () => (await confirmDialog({ title: 'Delete rule', message: `Delete ${ruleName(rule)} with all its versions and comments? You can undo this.`, confirmLabel: 'Delete rule', danger: true })) && attempt(() => deleteRule(rule.id), 'Rule deleted')}>
                <Icon name="trash" />
                Delete rule
              </button>
            </div>
          )}

          {discussOpen && <Discussion rule={rule} versions={vs} shownVersion={shown} />}
        </div>
      )}

      {editing && (
        <div className="ruleset-controls">
          <label className="switch">
            <input type="checkbox" checked={active} onChange={(e) => onSetActive(rule.id, e.target.checked ? shown?.id : null)} disabled={!shown} />
            <span className="switch-track" aria-hidden="true" />
            <span>In ruleset</span>
          </label>
          {active && !shownInSet && shown && (
            <button className="small primary" onClick={() => onUseVersion(rule.id, shown.id)}>
              Use this version
            </button>
          )}
        </div>
      )}

      {dialog === 'suggest' && <VersionDialog rule={rule} onClose={() => setDialog(null)} />}
      {dialog === 'version' && <VersionDialog rule={rule} version={shown} onClose={() => setDialog(null)} />}
      {dialog === 'rule' && <RuleDialog rule={rule} tree={tree} rules={rules} onClose={() => setDialog(null)} />}
      {dialog === 'brew' && <VersionDialog rule={rule} homebrew startText={shown?.text || ''} onSaved={(vid) => onShowVersion(rule.id, vid)} onClose={() => setDialog(null)} />}
      {dialog === 'brewEdit' && hb && <VersionDialog rule={rule} homebrew={hb} onClose={() => setDialog(null)} />}
      {dialog === 'brewRule' && hb && <RuleDialog homebrew={hb} tree={tree} rules={rules} onClose={() => setDialog(null)} />}
    </article>
  );
}

export default memo(RuleCard);
