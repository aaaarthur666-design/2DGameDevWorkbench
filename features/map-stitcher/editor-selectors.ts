import {
  MAP_IMAGE_LAYERS,
  type FrameRoninTile,
  type MapDisplayLayer,
  type RegionLayer,
  type RegionShape,
} from './frame-ronin-types';
import type { MapDocument, RegionScope } from './editor-state';

export const IMAGE_VIEW_LABELS: Record<MapDisplayLayer, string> = {
  overall: '整体',
  surface: '地表',
  object: '物件',
  black: '黑底参考',
  white: '白底参考',
  mask: 'Mask 派生',
};
export interface RegionFilter {
  tileKey: string | null;
  mapLayer: MapDisplayLayer;
  scope: RegionScope;
  layer?: RegionLayer;
  visibility?: Partial<Record<RegionLayer, boolean>>;
}
export function regionsInScope(shapes: RegionShape[], filter: RegionFilter) {
  return shapes.filter(
    (shape) =>
      shape.tileKey === filter.tileKey &&
      (filter.scope === 'tile' || shape.mapLayer === filter.mapLayer) &&
      (!filter.layer || shape.layer === filter.layer) &&
      filter.visibility?.[shape.layer] !== false,
  );
}
export function assertRegionWrite(
  shape: RegionShape,
  filter: RegionFilter,
  locks: Record<RegionLayer, boolean>,
) {
  if (locks[shape.layer]) throw new Error('目标区域类别已锁定。');
  if (!regionsInScope([shape], filter).length)
    throw new Error('目标区域不在当前操作范围内。');
}
export function hasImageView(tile: FrameRoninTile, layer: MapDisplayLayer) {
  return layer === 'mask'
    ? Boolean(tile.images.overall && tile.images.object)
    : Boolean(tile.images[layer]);
}
export function estimateDocumentBytes(document: MapDocument) {
  const seen = new Set<string>();
  let bytes = 0;
  for (const tile of document.tiles)
    for (const layer of MAP_IMAGE_LAYERS) {
      const asset = tile.images[layer];
      if (asset && !seen.has(asset.url)) {
        seen.add(asset.url);
        bytes += asset.width * asset.height * 4;
      }
    }
  return bytes;
}
export function tileRenderKey(
  tile: FrameRoninTile,
  layer: MapDisplayLayer,
  shapes: RegionShape[],
  width: number,
  height: number,
) {
  const sources =
    layer === 'mask'
      ? [tile.images.overall?.url, tile.images.object?.url]
      : [tile.images[layer]?.url];
  const regions =
    layer === 'mask' || layer === 'object'
      ? shapes.filter(
          (shape) => shape.tileKey === tile.key && shape.layer === 'occlusion',
        )
      : [];
  return JSON.stringify([
    tile.key,
    layer,
    width,
    height,
    tile.w,
    tile.h,
    sources,
    regions,
  ]);
}
export function isTypingTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="dialog"], [data-map-shortcuts="off"]',
      ),
    )
  );
}
