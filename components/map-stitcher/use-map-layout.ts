'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  MAP_LAYOUT_KEY,
  parseMapLayout,
} from '@/features/map-stitcher/editor-layout';

export function useMapLayout() {
  const [layout, setLayout] = useState(() => parseMapLayout(null));
  const [ready, setReady] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  useEffect(() => {
    let stored = parseMapLayout(null);
    try {
      stored = parseMapLayout(localStorage.getItem(MAP_LAYOUT_KEY));
    } catch {
      /* Optional preference. */
    }
    // oxlint-disable-next-line react/react-compiler -- Hydrate optional device preferences after SSR.
    setLayout(stored);
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(MAP_LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      /* Editing works without storage. */
    }
  }, [layout, ready]);
  const setPanelOpen = useCallback(
    (value: boolean | ((open: boolean) => boolean)) =>
      setLayout((previous) => ({
        ...previous,
        open: typeof value === 'function' ? value(previous.open) : value,
      })),
    [],
  );
  const setPanelWidth = useCallback(
    (width: number) => setLayout((previous) => ({ ...previous, width })),
    [],
  );
  return {
    panelOpen: layout.open,
    setPanelOpen,
    panelWidth: layout.width,
    setPanelWidth,
    layoutReady: ready,
    focusMode,
    setFocusMode,
  };
}
