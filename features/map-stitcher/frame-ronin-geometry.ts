import { CENTER_KEY, EMPTY_FEATHER, cleanNumber, tileKey } from './map-types';
import type { ImageAsset } from './map-types';
import type { FrameRoninTile } from './frame-ronin-types';

export function createFrameRoninCenterTile(asset: ImageAsset): FrameRoninTile {
  return {
    key: CENTER_KEY,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    images: { overall: asset },
    feather: { ...EMPTY_FEATHER },
    hidden: false,
  };
}

export function expandAroundFrameRoninTile(
  origin: FrameRoninTile,
  split: 4 | 8 | 12,
  horizontalOverlapPercent: number,
  verticalOverlapPercent: number,
): FrameRoninTile[] {
  const count = split / 4;
  const overlapX = horizontalOverlapPercent / 100;
  const overlapY = verticalOverlapPercent / 100;
  const horizontalSize = origin.w / (count - (count - 1) * overlapX);
  const horizontalStep = horizontalSize * (1 - overlapX);
  const verticalSize = origin.h / (count - (count - 1) * overlapY);
  const verticalStep = verticalSize * (1 - overlapY);
  const candidates: Array<Omit<FrameRoninTile, 'key'>> = [];

  for (let index = 0; index < count; index += 1) {
    const x = cleanNumber(origin.x + index * horizontalStep);
    candidates.push(blankTile(x, origin.y - horizontalSize * (1 - overlapY), horizontalSize));
    candidates.push(blankTile(x, origin.y + origin.h - horizontalSize * overlapY, horizontalSize));
  }

  for (let index = 0; index < count; index += 1) {
    const y = cleanNumber(origin.y + index * verticalStep);
    candidates.push(blankTile(origin.x - verticalSize * (1 - overlapX), y, verticalSize));
    candidates.push(blankTile(origin.x + origin.w - verticalSize * overlapX, y, verticalSize));
  }

  return candidates.map((tile) => ({ ...tile, key: tileKey(tile.x, tile.y) }));
}

function blankTile(x: number, y: number, size: number): Omit<FrameRoninTile, 'key'> {
  return {
    x: cleanNumber(x),
    y: cleanNumber(y),
    w: cleanNumber(size),
    h: cleanNumber(size),
    images: {},
    feather: { ...EMPTY_FEATHER },
    hidden: false,
  };
}

export function isSameFrameRoninGeometry(a: FrameRoninTile, b: FrameRoninTile) {
  const epsilon = 0.0001;
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.w - b.w) < epsilon &&
    Math.abs(a.h - b.h) < epsilon
  );
}

export function tilePixelSize(tile: FrameRoninTile, sourceWidth: number, sourceHeight: number) {
  return {
    width: Math.max(1, Math.round(tile.w * sourceWidth)),
    height: Math.max(1, Math.round(tile.h * sourceHeight)),
  };
}

export function frameRoninBounds(tiles: FrameRoninTile[]) {
  return tiles.reduce(
    (bounds, tile) => ({
      minX: Math.min(bounds.minX, tile.x),
      minY: Math.min(bounds.minY, tile.y),
      maxX: Math.max(bounds.maxX, tile.x + tile.w),
      maxY: Math.max(bounds.maxY, tile.y + tile.h),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

