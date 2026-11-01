import { useEffect, useState, useCallback } from 'react';
import { onSnapshot } from 'firebase/firestore';

const toDocs = (snap) => (snap.docs ? snap.docs.map((d) => ({ id: d.id, ...d.data() })) : snap.exists() ? { id: snap.id, ...snap.data() } : null);

/**
 * Subscribe to a Firestore doc or query. `makeRef` returns the ref (or null to skip).
 * Returns { data, error, loading }; `data` is an array for queries, an object/null for docs.
 */
export function useLive(makeRef, deps) {
  const [state, setState] = useState({ data: undefined, error: null });
  useEffect(() => {
    const ref = makeRef();
    if (!ref) {
      setState({ data: null, error: null });
      return undefined;
    }
    setState((s) => ({ ...s, data: undefined }));
    return onSnapshot(
      ref,
      (snap) => setState({ data: toDocs(snap), error: null }),
      (error) => {
        console.error(error);
        setState({ data: null, error });
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { ...state, loading: state.data === undefined };
}

export function useLocalStorage(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? initial : JSON.parse(raw);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v) =>
      setValue((prev) => {
        const next = typeof v === 'function' ? v(prev) : v;
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* storage unavailable: keep in memory only */
        }
        return next;
      }),
    [key],
  );
  return [value, set];
}

export function useDebounced(value, ms = 200) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
