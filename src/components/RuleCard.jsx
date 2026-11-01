import { memo, useState } from 'react';
import { absoluteLink, href } from '../lib/router.js';
import { deleteRule, deleteVersion, kindInfo, LABEL_CLASS, nextCode, react, updateRule } from '../lib/rules.js';
import { useSession } from '../lib/session.jsx';
import Discussion from './Discussion.jsx';
import { RuleDialog, VersionDialog } from './RuleDialogs.jsx';
import { attempt, copyText, Icon, Reactions, RichText, timeAgo, toast, UserName } from './ui.jsx';
import { confirmDialog } from './dialogs.jsx';

/**
 * One rule. Reads like running text; clicking it opens the tools: versions, reactions, discussion,
 * suggestions and (for admins) editing. Shows the version picked by the current ruleset, or the one
 * the reader browsed to.
 */
function RuleCard({ item, setName, editing, focused, open, onToggle, onShowVersion, onSetActive, onUseVersion, onMove, canMoveUp, canMoveDown, tree, rules }) {
  const { isAdmin, requireUser, user, kinds } = useSession();
  const { rule, vs, active, activeVersion, shown } = item;
  const [discussOpen, setDiscussOpen] = useState(focused);
  const [dialog, setDialog] = useState(null);
  const idx = shown ? vs.indexOf(shown) : -1;
  const shownInSet = Boolean(shown && activeVersion && shown.id === activeVersion.id);

  const step = (d) => {
    const next = vs[(idx + d + vs.length) % vs.length];
    if (next) onShowVersion(rule.id, next.id);
  };

  const copyLink = async () => {
    await copyText(absoluteLink('rules', [rule.code]));
    toast(`Link to ${rule.code} copied`, 'ok');
  };

  const approve = () => {
    const section = tree.byId.get(rule.sectionId);
    const code = nextCode(section?.code || 'GEN', rules);
    return attempt(() => updateRule(rule.id, { status: 'active', code }), `Approved as ${code}`);
  };

  const kind = kindInfo(kinds, rule.kind);
  const hasKind = rule.kind && rule.kind !== 'rule';
  const classes = ['rule', `kind-${rule.kind || 'rule'}`, hasKind ? 'has-kind' : '', active ? 'active' : 'inactive', open ? 'open' : '', focused ? 'focused' : '', rule.status === 'suggested' ? 'is-suggested' : '', rule.status === 'rejected' ? 'is-rejected' : ''];

  // Clicking anywhere in the text opens the rule's tools, unless the reader is selecting text or following a link.
  const onBodyClick = (e) => {
    if (e.target.closest('a, button, input, select, textarea, label') || String(window.getSelection?.() || '')) return;
    onToggle(rule.id);
  };

  return (
    <article id={`rule-${rule.code}`} className={classes.join(' ')} aria-label={`${rule.code} ${rule.title}`} style={hasKind && kind.color ? { '--kind': kind.color } : undefined}>
      <div className="rule-read" onClick={onBodyClick}>
        <header className="rule-head">
          <span className="rule-code">{rule.code}</span>
          <h3 className="rule-title">
            <button type="button" className="rule-toggle" onClick={() => onToggle(rule.id)} aria-expanded={open} title={open ? 'Hide tools' : 'Show versions, reactions and discussion'}>
              {rule.title}
            </button>
          </h3>
          {hasKind && (
            <span className="kind-tag" title={`Kind: ${kind.label}. Filter by kind in the toolbar.`}>
              {kind.label}
            </span>
          )}
          {rule.status === 'suggested' && <span className="tag t-suggestion">Suggested rule</span>}
          {rule.status === 'rejected' && <span className="tag t-muted">Rejected</span>}
          {!active && <span className="tag t-muted">Inactive</span>}
          {!open && (
            <span className="rule-hints">
              {shown && shown.label !== 'Rulebook' && <span className={`hint-label l-${LABEL_CLASS[shown.label] || 'other'}`}>{shown.label}</span>}
              <span className={`hint-count ${vs.length > 1 ? 'has' : ''}`} title={`${vs.length} version${vs.length === 1 ? '' : 's'}`} aria-label={`${vs.length} versions`}>
                <Icon name="layers" size={13} /> {vs.length}
              </span>
              <span className={`hint-count ${rule.commentCount ? 'has' : ''}`} title={`${rule.commentCount || 0} comment${rule.commentCount === 1 ? '' : 's'}`} aria-label={`${rule.commentCount || 0} comments`}>
                <Icon name="message" size={13} /> {rule.commentCount || 0}
              </span>
            </span>
          )}
        </header>

        {shown ? <RichText html={shown.text} className="rule-text" /> : <p className="muted">This rule has no text yet.</p>}
      </div>

      {open && (
        <div className="rule-panel">
          {shown && (shown.note || shown.label !== 'Rulebook') && (
            <p className="version-meta">
              {shown.label !== 'Rulebook' && (
                <span>
                  Added by <UserName uid={shown.createdBy} fallback={shown.createdByName} /> · {timeAgo(shown.createdAt)}
                </span>
              )}
              {shown.note && <span className="version-note">{shown.note}</span>}
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
                {!editing && shown && !shownInSet && (
                  <button className="chip ok" onClick={() => (active ? onUseVersion(rule.id, shown.id) : onSetActive(rule.id, shown.id))} title={`Make ${setName} use this version (saved when you save the ruleset)`}>
                    <Icon name="check" />
                    {active ? 'Use this version' : 'Add to ruleset'}
                  </button>
                )}
                {!editing && active && (
                  <button className="chip" onClick={() => onSetActive(rule.id, null)} title={`Make this rule inactive in ${setName} (saved when you save the ruleset)`}>
                    <Icon name="eyeOff" />
                    Make inactive
                  </button>
                )}
              </div>
            )}

            {shown && (
              <Reactions
                reactions={shown.reactions}
                onReact={(type) => requireUser((u) => attempt(() => react('versions', shown.id, u.uid, shown.reactions?.[u.uid], type), null, 'reaction'))}
              />
            )}

            <div className="rule-actions">
              <button className={`chip ${discussOpen ? 'on' : ''}`} onClick={() => setDiscussOpen((o) => !o)} aria-expanded={discussOpen}>
                <Icon name="message" />
                <span>{rule.commentCount || 0}</span>
                <span className="hide-sm">Discuss</span>
              </button>
              <button className="chip" onClick={() => requireUser(() => setDialog('suggest'))}>
                <Icon name="bulb" />
                <span className="hide-sm">{isAdmin ? 'Add version' : 'Suggest change'}</span>
              </button>
              <button className="chip" onClick={copyLink} title="Copy link" aria-label={`Copy link to ${rule.code}`}>
                <Icon name="link" />
              </button>
              {!isAdmin && shown && user && shown.createdBy === user.uid && shown.label === 'Suggestion' && (
                <button className="chip" onClick={() => setDialog('version')}>
                  <Icon name="edit" />
                  <span className="hide-sm">Edit my suggestion</span>
                </button>
              )}
            </div>
          </div>

          {isAdmin && (
            <div className="admin-tools" role="group" aria-label="Admin tools">
              <span className="admin-tools-label">Admin</span>
              {shown && (
                <button className="chip" onClick={() => setDialog('version')} title="Edit this version">
                  <Icon name="edit" />
                  Edit version
                </button>
              )}
              {shown && vs.length > 1 && (
                <button className="chip danger" onClick={async () => (await confirmDialog({ title: 'Delete version', message: `Delete this ${shown.label} version of ${rule.code}?`, confirmLabel: 'Delete', danger: true })) && attempt(() => deleteVersion(shown.id), 'Version deleted')}>
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
              <button className="chip danger" onClick={async () => (await confirmDialog({ title: `Delete ${rule.code}`, message: `Delete “${rule.title}” with all its versions and comments? You can undo this.`, confirmLabel: 'Delete rule', danger: true })) && attempt(() => deleteRule(rule.id), `${rule.code} deleted`)}>
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
    </article>
  );
}

export default memo(RuleCard);
