import { useEffect, useState } from 'react';

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

export function useTheme() {
  const [choice, setChoice] = useState(stored);
  useEffect(() => {
    applyTheme(choice);
    if (choice) return undefined;
    const m = media();
    const follow = () => applyTheme(null);
    m.addEventListener('change', follow);
    return () => m.removeEventListener('change', follow);
  }, [choice]);
  const toggle = () => {
    const next = resolvedTheme(choice) === 'light' ? 'dark' : 'light';
    // Picking the system's own theme goes back to following the system.
    const value = next === (media().matches ? 'light' : 'dark') ? null : next;
    try {
      if (value) localStorage.setItem(KEY, value);
      else localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setChoice(value);
  };
  return { theme: resolvedTheme(choice), following: !choice, toggle };
}
