import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getHistory, redo, subscribeHistory, undo } from './store.js';

/** The saved-changes history: { undo, redo, busy } where undo/redo are the next entries or null. */
export const useHistory = () => useSyncExternalStore(subscribeHistory, getHistory);

// Editors with unsaved drafts register a local scope; Ctrl+Z goes there first while it has history.
const scopes = [];

export function useUndoScope(api) {
  const ref = useRef(api);
  ref.current = api;
  useEffect(() => {
    const scope = { get: () => ref.current };
    scopes.push(scope);
    return () => {
      scopes.splice(scopes.indexOf(scope), 1);
    };
  }, []);
}

const editable = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/**
 * Global Ctrl/⌘+Z and Ctrl/⌘+Shift+Z (or Ctrl+Y). Text fields keep their own native undo.
 * `onDone(kind, label)` reports what happened.
 */
export function useUndoKeys(onDone) {
  useEffect(() => {
    const onKey = async (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || editable(document.activeElement)) return;
      const key = e.key.toLowerCase();
      const isRedo = (key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey);
      if (key !== 'z' && !isRedo) return;
      if (document.querySelector('.modal-backdrop')) return;
      e.preventDefault();
      const local = scopes[scopes.length - 1]?.get();
      if (local && (isRedo ? local.canRedo : local.canUndo)) {
        isRedo ? local.redo() : local.undo();
        return;
      }
      const label = await (isRedo ? redo() : undo());
      if (label) onDone(isRedo ? 'redo' : 'undo', label);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onDone]);
}

/**
 * useState with undo/redo, for drafts edited before saving. Changes within `mergeMs` of each other
 * (typing, dragging) collapse into one step.
 */
export function useDraftHistory(initial, mergeMs = 600) {
  const [h, setH] = useState(() => ({ past: [], present: typeof initial === 'function' ? initial() : initial, future: [], at: 0 }));

  const set = useCallback(
    (update) =>
      setH((s) => {
        const next = typeof update === 'function' ? update(s.present) : update;
        if (next === s.present) return s;
        const now = Date.now();
        const merge = now - s.at < mergeMs && s.past.length > 0;
        return { past: merge ? s.past : [...s.past, s.present].slice(-100), present: next, future: [], at: now };
      }),
    [mergeMs],
  );
  const undoDraft = useCallback(
    () => setH((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future], at: 0 } : s)),
    [],
  );
  const redoDraft = useCallback(
    () => setH((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1), at: 0 } : s)),
    [],
  );
  const reset = useCallback((value) => setH({ past: [], present: value, future: [], at: 0 }), []);

  return [h.present, set, { undo: undoDraft, redo: redoDraft, canUndo: h.past.length > 0, canRedo: h.future.length > 0, reset }];
}
