import { href } from '../lib/router.js';
import { kindInfo } from '../lib/rules.js';
import { useSession } from '../lib/session.jsx';
import { Icon } from './ui.jsx';

/**
 * "Clarifications about this": the rules (FAQ entries and others) whose text links to this rule or
 * card, found automatically from those links, plus a way to ask a new question about it.
 */
export default function Clarifications({ rules = [], onAsk }) {
  const { kinds } = useSession();
  return (
    <div className="clarifications">
      <div className="clarifications-head">
        <Icon name="help" />
        <b>Clarifications about this</b>
        <button type="button" className="chip" onClick={onAsk} title="Ask how this works, or how it interacts with other rules or cards">
          <Icon name="bulb" />
          Ask about this
        </button>
      </div>
      {rules.length ? (
        <ul>
          {rules.map((r) => {
            const k = kindInfo(kinds, r.kind);
            return (
              <li key={r.id}>
                <a href={href('rules', [r.sid || r.id])}>
                  {r.sid && <span className="rule-code">{r.sid}</span>} {r.title}
                </a>
                {r.kind && r.kind !== 'rule' && (
                  <span className="kind-tag" style={{ '--kind': k.color }}>
                    {k.label}
                  </span>
                )}
                {r.status === 'suggested' && <span className="tag t-suggestion">Open question</span>}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="small muted">No rule or FAQ entry links here yet.</p>
      )}
    </div>
  );
}
