import { useEffect, useSyncExternalStore } from 'react';

// 'light' or 'dark' when the reader picked one; otherwise the system setting decides.
const KEY = 'brv-theme';
const media = () => window.matchMedia('(prefers-color-scheme: light)');

const stored = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

export const resolvedTheme = (choice = stored()) => choice || (media().matches ? 'light' : 'dark');

export function applyTheme(choice = stored()) {
  document.documentElement.dataset.theme = resolvedTheme(choice);
}

// One shared choice, so every toggle (header, Account page) stays in sync.
let choice = stored();
const subs = new Set();
const setChoice = (value) => {
  choice = value;
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  applyTheme(value);
  subs.forEach((s) => s());
};
const subscribe = (fn) => {
  subs.add(fn);
  return () => subs.delete(fn);
};

export function useTheme() {
  const current = useSyncExternalStore(subscribe, () => choice);
  useEffect(() => {
    if (current) return undefined;
    // Following the system: switch along with it.
    const m = media();
    const follow = () => {
      applyTheme(null);
      subs.forEach((s) => s());
    };
    m.addEventListener('change', follow);
    return () => m.removeEventListener('change', follow);
  }, [current]);
  const toggle = () => {
    const next = resolvedTheme(current) === 'light' ? 'dark' : 'light';
    // Picking the system's own theme goes back to following the system.
    setChoice(next === (media().matches ? 'light' : 'dark') ? null : next);
  };
  return { theme: resolvedTheme(current), following: !current, toggle };
}
