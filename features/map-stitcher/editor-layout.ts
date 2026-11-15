// Device preferences only: these never enter map documents, undo history or exports.
export const MAP_LAYOUT_KEY = 'workbench.map-layout.v1';
export const DEFAULT_PANEL_WIDTH = 320;
export const MIN_PANEL_WIDTH = 280;
export const MAX_PANEL_WIDTH = 520;
export const MIN_CANVAS_WIDTH = 480;
export const PANEL_HANDLE_WIDTH = 8;
export const MAP_DOCK_MIN_WIDTH =
  MIN_CANVAS_WIDTH + MIN_PANEL_WIDTH + PANEL_HANDLE_WIDTH;

export function panelWidth(value: number) {
  return Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, value));
}

export function parseMapLayout(raw: string | null) {
  const fallback = { width: DEFAULT_PANEL_WIDTH, open: true };
  try {
    const value = JSON.parse(raw || 'null');
    if (!value || typeof value !== 'object') return fallback;
    return {
      width:
        typeof value.width === 'number' && Number.isFinite(value.width)
          ? panelWidth(value.width)
          : fallback.width,
      open: typeof value.open === 'boolean' ? value.open : fallback.open,
    };
  } catch {
    return fallback;
  }
}
