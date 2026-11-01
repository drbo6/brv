import { useEffect, useRef } from 'react';

/**
 * Site-wide hover/focus tooltips. Any element with a `title` (or `data-tip`) gets a styled tooltip
 * instead of the browser's slow native one. The title moves into data-tip so the native tooltip
 * doesn't show as well; elements without another accessible name keep it as aria-label.
 */
export default function Tooltips() {
  const tip = useRef(null);

  useEffect(() => {
    const el = tip.current;
    let target = null;
    let timer = null;

    const hide = () => {
      clearTimeout(timer);
      target = null;
      el.classList.remove('show');
    };

    const show = (t) => {
      const text = t.getAttribute('data-tip');
      if (!text || !document.contains(t)) return;
      el.textContent = text;
      el.classList.add('show');
      const r = t.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const below = r.top < h + 12;
      el.dataset.side = below ? 'below' : 'above';
      el.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
      el.style.top = `${below ? r.bottom + 8 : r.top - h - 8}px`;
    };

    const find = (node) => {
      const t = node instanceof Element ? node.closest('[title], [data-tip]') : null;
      if (!t || t.closest('.tooltip')) return null;
      const title = t.getAttribute('title');
      if (title) {
        t.setAttribute('data-tip', title);
        t.removeAttribute('title');
        if (!t.hasAttribute('aria-label') && !t.textContent.trim() && !t.hasAttribute('aria-labelledby')) t.setAttribute('aria-label', title);
      }
      return t;
    };

    const enter = (e, delay) => {
      if (e.pointerType === 'touch') return;
      const t = find(e.target);
      if (t === target) return;
      hide();
      if (!t) return;
      target = t;
      timer = setTimeout(() => show(t), delay);
    };

    const onOver = (e) => enter(e, 350);
    const onFocus = (e) => {
      if (e.target.matches?.(':focus-visible')) enter(e, 150);
    };
    const onOut = (e) => {
      if (target && !target.contains(e.relatedTarget)) hide();
    };

    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    window.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);

  return <div ref={tip} className="tooltip" role="tooltip" aria-hidden="true" />;
}
