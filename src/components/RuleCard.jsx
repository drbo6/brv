import { memo, useState } from 'react';
import { absoluteLink, href } from '../lib/router.js';
import { deleteRule, deleteVersion, KINDS, LABEL_CLASS, nextCode, react, updateRule } from '../lib/rules.js';
import { useSession } from '../lib/session.jsx';
import Discussion from './Discussion.jsx';
import { RuleDialog, VersionDialog } from './RuleDialogs.jsx';
import { attempt, copyText, Icon, Reactions, RichText, timeAgo, toast } from './ui.jsx';

/**
 * One rule. Shows the version picked by the current ruleset (or the one the reader browsed to),
 * with arrows to step through every version.
 */
function RuleCard({ item, setName, editing, focused, onShowVersion, onSetActive, onUseVersion, onMove, canMoveUp, canMoveDown, tree, rules }) {
  const { isAdmin, requireUser, user } = useSession();
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

  const classes = ['rule', `kind-${rule.kind || 'rule'}`, active ? 'active' : 'inactive', focused ? 'focused' : '', rule.status === 'suggested' ? 'is-suggested' : '', rule.status === 'rejected' ? 'is-rejected' : ''];

  return (
    <article id={`rule-${rule.code}`} className={classes.join(' ')} aria-label={`${rule.code} ${rule.title}`}>
      <header className="rule-head">
        <a className="rule-code" href={href('rules', [rule.code])} title="Permalink">
          {rule.code}
        </a>
        <h3 className="rule-title">{rule.title}</h3>
        <div className="rule-tags">
          {rule.kind && rule.kind !== 'rule' && <span className={`kind-tag kt-${rule.kind}`}>{KINDS[rule.kind] || rule.kind}</span>}
          {rule.status === 'suggested' && <span className="tag t-suggestion">Suggested rule</span>}
          {rule.status === 'rejected' && <span className="tag t-muted">Rejected</span>}
          {!active && <span className="tag t-muted">Inactive</span>}
        </div>
        <div className="rule-tools">
          <button className="icon-btn" onClick={copyLink} title="Copy link" aria-label={`Copy link to ${rule.code}`}>
            <Icon name="link" />
          </button>
          {isAdmin && (
            <>
              <button className="icon-btn" onClick={() => onMove(rule.id, -1)} disabled={!canMoveUp} title="Move up" aria-label="Move up">
                <Icon name="arrowUp" />
              </button>
              <button className="icon-btn" onClick={() => onMove(rule.id, 1)} disabled={!canMoveDown} title="Move down" aria-label="Move down">
                <Icon name="arrowDown" />
              </button>
              <button className="icon-btn" onClick={() => setDialog('rule')} title="Edit rule details" aria-label="Edit rule details">
                <Icon name="edit" />
              </button>
              <button
                className="icon-btn danger"
                title="Delete rule"
                aria-label="Delete rule"
                onClick={() => confirm(`Delete ${rule.code} with all its versions and comments? This cannot be undone.`) && attempt(() => deleteRule(rule.id), 'Rule deleted')}
              >
                <Icon name="trash" />
              </button>
            </>
          )}
        </div>
      </header>

      {shown ? <RichText html={shown.text} className="rule-text" /> : <p className="muted">This rule has no text yet.</p>}

      {shown && (shown.note || shown.label !== 'Rulebook') && (
        <p className="version-meta">
          {shown.label !== 'Rulebook' && (
            <span>
              Added by {shown.createdByName || 'someone'} · {timeAgo(shown.createdAt)}
            </span>
          )}
          {shown.note && <span className="version-note">{shown.note}</span>}
        </p>
      )}

      <footer className="rule-foot">
        {shown && (
          <div className="version-switch">
            {vs.length > 1 && (
              <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous version">
                <Icon name="left" />
              </button>
            )}
            <span className={`label l-${LABEL_CLASS[shown.label] || 'other'}`}>{shown.label}</span>
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

        {shown && <Reactions reactions={shown.reactions} onReact={(type) => requireUser((u) => attempt(() => react('versions', shown.id, u.uid, shown.reactions?.[u.uid], type)))} />}

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
          {isAdmin && shown && (
            <>
              <button className="chip" onClick={() => setDialog('version')} title="Edit this version">
                <Icon name="edit" />
                <span className="hide-sm">Edit version</span>
              </button>
              {vs.length > 1 && (
                <button
                  className="chip danger"
                  title="Delete this version"
                  onClick={() => confirm(`Delete this ${shown.label} version of ${rule.code}?`) && attempt(() => deleteVersion(shown.id), 'Version deleted')}
                >
                  <Icon name="trash" />
                </button>
              )}
            </>
          )}
          {!isAdmin && shown && user && shown.createdBy === user.uid && shown.label === 'Suggestion' && (
            <button className="chip" onClick={() => setDialog('version')}>
              <Icon name="edit" />
              <span className="hide-sm">Edit my suggestion</span>
            </button>
          )}
          {isAdmin && rule.status === 'suggested' && (
            <button className="chip ok" onClick={approve}>
              <Icon name="check" />
              Approve rule
            </button>
          )}
        </div>

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
      </footer>

      {discussOpen && <Discussion rule={rule} versions={vs} shownVersion={shown} />}

      {dialog === 'suggest' && <VersionDialog rule={rule} onClose={() => setDialog(null)} />}
      {dialog === 'version' && <VersionDialog rule={rule} version={shown} onClose={() => setDialog(null)} />}
      {dialog === 'rule' && <RuleDialog rule={rule} tree={tree} rules={rules} onClose={() => setDialog(null)} />}
    </article>
  );
}

export default memo(RuleCard);
