import { useEffect } from 'react';
import { RichText } from './ui.jsx';
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
          <RichText html={brand.welcomeText} className="welcome-custom" />
          <button className="primary big" onClick={onClose} autoFocus>
            {brand.welcomeButton}
          </button>
        </div>
      </div>
    </div>
  );
}

