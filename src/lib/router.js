import { useEffect, useState } from 'react';

// Hash routing, since GitHub Pages cannot rewrite deep links: #/rules/SUM.1?set=abc
export function parseHash(hash = window.location.hash) {
  const raw = hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { page: parts[0] || 'rules', parts: parts.slice(1), params: new URLSearchParams(qs) };
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseHash());
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function href(page, parts = [], params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  return `#/${[page, ...parts].map(encodeURIComponent).join('/')}${qs ? `?${qs}` : ''}`;
}

export function navigate(page, parts, params, { replace = false } = {}) {
  const next = href(page, parts, params);
  if (replace) history.replaceState(null, '', next);
  else if (window.location.hash !== next) window.location.hash = next;
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function absoluteLink(page, parts, params) {
  return `${window.location.origin}${window.location.pathname}${href(page, parts, params)}`;
}
