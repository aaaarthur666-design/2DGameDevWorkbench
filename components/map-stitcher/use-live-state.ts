'use client';
import { useCallback, useRef, useState, type SetStateAction } from 'react';

/** Event/async actions can inspect the latest value before React's next render. */
export function useLiveState<T>(initial: T) {
  const [value, render] = useState(initial);
  const current = useRef(value);
  const set = useCallback((action: SetStateAction<T>) => {
    const next =
      typeof action === 'function'
        ? (action as (old: T) => T)(current.current)
        : action;
    current.current = next;
    render(next);
  }, []);
  return [value, set, current] as const;
}
