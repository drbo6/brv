import { useEffect } from 'react';
import { Icon, RichText } from './ui.jsx';
import { useSession } from '../lib/session.jsx';

/**
 * The opening (and "About this site") window. Its heading, kicker, text and button come from the
 * owner's settings in Admin → Site; `brand` can be passed to preview unsaved settings.
 */
export default function WelcomeModal({ onClose, brand: preview }) {
  const { brand: saved } = useSession();
  const brand = preview || saved;
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
            {brand.mark}
          </span>
          {brand.welcomeKicker && <p className="welcome-kicker">{brand.welcomeKicker}</p>}
          <h1 id="welcome-title">
            {brand.name}
            {brand.tagline && <span>{brand.tagline}</span>}
          </h1>
        </div>
        <div className="welcome-body">
          {brand.welcomeText ? (
            <RichText html={brand.welcomeText} className="welcome-custom" />
          ) : (
            <BuiltInWelcome name={brand.name} />
          )}
          <button className="primary big" onClick={onClose} autoFocus>
            {brand.welcomeButton}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The introduction the site ships with, shown until the owner writes their own. */
function BuiltInWelcome({ name }) {
  return (
    <>
          <p className="welcome-lead">
            <b>{name}</b> is a living rulebook: the game’s rules, kept up to date by its players.
          </p>
          <p>Every unclear rule can be clarified, discussed and improved together:</p>
          <ul className="welcome-points">
            <li>
              <Icon name="book" size={18} />
              <span>
                <b>Every rule, one at a time.</b> The rulebook is split into individual rules, each with a short permanent id like{' '}
                <code>k7q2m</code>, so you can point at exactly what you mean.
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
                <b>Look up every card and component</b> with search, filters and sorting.
              </span>
            </li>
          </ul>
          <p className="welcome-fine">This is an unofficial fan project and is not affiliated with the game’s publishers.</p>
    </>
  );
}
