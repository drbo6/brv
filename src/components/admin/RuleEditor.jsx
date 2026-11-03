import { useState } from 'react';
import { deleteRule, deleteVersion, kindInfo, LABEL_CLASS } from '../../lib/rules.js';
import { href } from '../../lib/router.js';
import { useSession } from '../../lib/session.jsx';
import { confirmDialog } from '../dialogs.jsx';
import { RuleDialog, VersionDialog } from '../RuleDialogs.jsx';
import { attempt, Icon, Modal, RichText, timeAgo, UserName } from '../ui.jsx';

/**
 * Everything about one rule in one place, from the rules table: its details and all its versions,
 * each editable with the same dialogs the Rules page uses.
 */
export default function RuleEditor({ rule, versions, tree, rules, onClose }) {
  const { kinds } = useSession();
  const [dialog, setDialog] = useState(null); // 'details' | 'new' | a version
  const section = tree.byId.get(rule.sectionId);
  const kind = kindInfo(kinds, rule.kind);

  return (
    <Modal title={`Edit ${rule.sid} “${rule.title}”`} onClose={onClose} wide className="rule-editor">
      <section className="re-details">
        <dl>
          <div>
            <dt>Section</dt>
            <dd>{section ? `${section.number} ${section.title}` : 'Unsorted'}</dd>
          </div>
          <div>
            <dt>Kind</dt>
            <dd>{kind.label}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{{ active: 'Active', suggested: 'Suggested', rejected: 'Rejected' }[rule.status || 'active']}</dd>
          </div>
          <div>
            <dt>Rulebook page</dt>
            <dd>{rule.page ?? '—'}</dd>
          </div>
        </dl>
        <div className="row gap wrap">
          <button className="small" onClick={() => setDialog('details')}>
            <Icon name="edit" />
            Edit details
          </button>
          <a className="btn small" href={href('rules', [rule.sid])} onClick={onClose} title="Show this rule on the Rules page">
            <Icon name="book" />
            Open on the Rules page
          </a>
        </div>
      </section>

      <section className="re-versions">
        <div className="panel-head">
          <h3>
            {versions.length} version{versions.length === 1 ? '' : 's'}
          </h3>
          <button className="small primary" onClick={() => setDialog('new')}>
            <Icon name="plus" />
            Add version
          </button>
        </div>
        {versions.length === 0 && <p className="muted small">This rule has no text yet. Add a version.</p>}
        {versions.map((v) => (
          <article key={v.id} className="re-version">
            <header>
              <span className={`label l-${LABEL_CLASS[v.label] || 'other'}`}>{v.label}</span>
              <span className="version-ref">
                {rule.sid}.{v.num}
              </span>
              <span className="muted small">
                by <UserName uid={v.createdBy} fallback={v.createdByName} /> · {timeAgo(v.updatedAt || v.createdAt)}
              </span>
              <span className="re-version-tools">
                <button className="icon-btn" onClick={() => setDialog(v)} title="Edit this version" aria-label={`Edit version ${v.num}`}>
                  <Icon name="edit" />
                </button>
                <button
                  className="icon-btn danger"
                  title={versions.length === 1 ? 'A rule needs at least one version' : 'Delete this version'}
                  aria-label={`Delete version ${v.num}`}
                  disabled={versions.length === 1}
                  onClick={async () =>
                    (await confirmDialog({ title: 'Delete version', message: `Delete the ${v.label} version ${rule.sid}.${v.num}?`, confirmLabel: 'Delete', danger: true })) &&
                    attempt(() => deleteVersion(v.id), 'Version deleted')
                  }
                >
                  <Icon name="trash" />
                </button>
              </span>
            </header>
            <RichText html={v.text} className="rule-text" />
            {v.note && <p className="version-meta version-note">{v.note}</p>}
          </article>
        ))}
      </section>

      <footer className="re-foot">
        <button
          className="small danger"
          onClick={async () => {
            if (!(await confirmDialog({ title: 'Delete rule', message: `Delete ${rule.sid} “${rule.title}” with all its versions and comments? You can undo this.`, confirmLabel: 'Delete rule', danger: true }))) return;
            if (await attempt(() => deleteRule(rule.id), 'Rule deleted')) onClose();
          }}
        >
          <Icon name="trash" />
          Delete rule
        </button>
      </footer>

      {dialog === 'details' && <RuleDialog rule={rule} tree={tree} rules={rules} onClose={() => setDialog(null)} />}
      {dialog === 'new' && <VersionDialog rule={rule} onClose={() => setDialog(null)} />}
      {dialog && typeof dialog === 'object' && <VersionDialog rule={rule} version={versions.find((v) => v.id === dialog.id) || dialog} onClose={() => setDialog(null)} />}
    </Modal>
  );
}
