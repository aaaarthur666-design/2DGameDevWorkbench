/** Normalize high-frequency trackpads and line/page-based mouse wheels. */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY)) return 1;
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 800 : 1);
  return Math.exp(-Math.max(-120, Math.min(120, pixels)) * Math.log(1.12) / 100);
}
