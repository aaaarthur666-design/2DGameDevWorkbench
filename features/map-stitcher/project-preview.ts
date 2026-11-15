import type { FrameRoninEditorSnapshot } from './state-package';
import { frameRoninBounds } from './frame-ronin-geometry';
import { renderExportPreview } from './map-production';
import { canvasToBlob } from './image-utils';

export const MAP_PREVIEW_EDGE = 640;

/** View, selection, locks, prompts and queue progress cannot change the artwork. */
export function mapPreviewKey(snapshot: FrameRoninEditorSnapshot) {
  return JSON.stringify({
    tiles: snapshot.tiles.map(
      ({ key, x, y, w, h, hidden, feather, images, surfaceIsDraft }) => ({
        key,
        x,
        y,
        w,
        h,
        hidden,
        feather,
        surfaceIsDraft,
        images: Object.entries(images).map(([layer, asset]) => [
          layer,
          asset?.url,
        ]),
      }),
    ),
    shapes: snapshot.shapes,
  });
}

export function mapPreviewInput(snapshot: FrameRoninEditorSnapshot) {
  const source = snapshot.tiles.find((tile) => tile.key === '0,0')?.images
    .overall;
  const tiles = snapshot.tiles.filter(
    (tile) => !tile.hidden && Object.values(tile.images).some(Boolean),
  );
  if (!source || !tiles.length) throw new Error('地图暂无可预览画面。');
  const bounds = frameRoninBounds(tiles);
  const width = (bounds.maxX - bounds.minX) * source.width;
  const height = (bounds.maxY - bounds.minY) * source.height;
  // Leave room for floor/ceil rounding at negative origins. Never allocate a full map canvas.
  const scale = Math.min(1, (MAP_PREVIEW_EDGE - 2) / Math.max(width, height));
  if (!Number.isFinite(scale) || scale <= 0)
    throw new Error('地图预览范围无效。');
  return {
    tiles,
    width: source.width * scale,
    height: source.height * scale,
    shapes: snapshot.shapes.map((shape) => ({
      ...shape,
      points: shape.points.map(({ x, y }) => ({ x: x * scale, y: y * scale })),
    })),
  };
}

export async function createMapProjectPreview(
  snapshot: FrameRoninEditorSnapshot,
) {
  const input = mapPreviewInput(snapshot);
  const rendered = await renderExportPreview(
    input.tiles,
    input.shapes,
    input.width,
    input.height,
  );
  try {
    return await canvasToBlob(rendered.canvas);
  } finally {
    rendered.canvas.width = rendered.canvas.height = 1;
  }
}

/** One cache per editor. A failed preview stays absent; it never borrows older artwork. */
export function createMapPreviewCache(render = createMapProjectPreview) {
  let cached: { key: string; bytes: Uint8Array | undefined } | undefined;
  return async (snapshot: FrameRoninEditorSnapshot) => {
    const key = mapPreviewKey(snapshot);
    if (cached?.key === key) return cached.bytes;
    let bytes: Uint8Array | undefined;
    try {
      bytes = new Uint8Array(await (await render(snapshot)).arrayBuffer());
    } catch {
      /* Saving editable source remains authoritative. */
    }
    cached = { key, bytes };
    return bytes;
  };
}
