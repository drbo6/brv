import { useEffect } from 'react';
import { Icon } from './ui.jsx';

export default function WelcomeModal({ onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop welcome-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
        <div className="welcome-hero">
          <span className="welcome-rune" aria-hidden="true">
            ᚱ ᚨ ᚷ ᛖ
          </span>
          <p className="welcome-kicker">Welcome, warrior, to the</p>
          <h1 id="welcome-title">
            Blood Rage Valhalla
            <span>Unofficial Living Rulebook</span>
          </h1>
        </div>
        <div className="welcome-body">
          <p className="welcome-lead">
            <b>Blood Rage: Valhalla</b> is a fantastic game. Its rulebook, however, leaves a lot of questions unanswered — and the table argument over what a card
            “really” means can last longer than an Age.
          </p>
          <p>This site is a FAQ that the Blood Rage community maintains together:</p>
          <ul className="welcome-points">
            <li>
              <Icon name="book" size={18} />
              <span>
                <b>Every rule, one at a time.</b> The rulebook is split into individual rules with short IDs like <code>SUM.1</code>, so you can point at exactly
                what you mean.
              </span>
            </li>
            <li>
              <Icon name="layers" size={18} />
              <span>
                <b>Versions side by side.</b> Each rule can carry the printed text, official rulings, community clarifications and suggestions.
              </span>
            </li>
            <li>
              <Icon name="message" size={18} />
              <span>
                <b>Discuss and react.</b> Agree, disagree or flag a rule as unclear, and talk it through.
              </span>
            </li>
            <li>
              <Icon name="check" size={18} />
              <span>
                <b>Build your own ruleset.</b> Pick the rules and versions your group plays with, save it and export it as a PDF.
              </span>
            </li>
            <li>
              <Icon name="grid" size={18} />
              <span>
                <b>Look up every card</b> with search, filters and sorting.
              </span>
            </li>
          </ul>
          <p className="welcome-fine">This is an unofficial fan project and is not affiliated with the game’s publishers.</p>
          <button className="primary big" onClick={onClose} autoFocus>
            Enter the hall
          </button>
        </div>
      </div>
    </div>
  );
}
