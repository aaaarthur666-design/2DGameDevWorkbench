export const ASSET_LAYERS = ['ground', 'object', 'foreground', 'black', 'white'] as const;
export type EditableLayer = typeof ASSET_LAYERS[number];
export type VisualLayer = 'ground' | 'object' | 'foreground';
export type ManagedLayer = EditableLayer | 'collision';
export type LayerId = 'overall' | ManagedLayer;
export type MaskMode = 'black' | 'white';

export interface ImageAsset {
  file: File;
  url: string;
  width: number;
  height: number;
  name: string;
  type: string;
  size: number;
}

export interface Feather {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CollisionRect {
  id: string;
  /** Normalized tile-local coordinates in the 0..1 range. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Tile {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  layers: Partial<Record<EditableLayer, ImageAsset>>;
  collisions: CollisionRect[];
  feather: Feather;
  hidden: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface SavedImageReference {
  fileName: string;
  type: string;
  size: number;
  width: number;
  height: number;
  path?: string;
  dataUrl?: string;
}

export interface SavedTile {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  feather: Feather;
  hidden: boolean;
  layers: Partial<Record<EditableLayer, SavedImageReference>>;
  collisions?: CollisionRect[];
}

export interface SceneMakerState {
  version: 5;
  format: 'scenemaker-map-stitch-state';
  savedAt: string;
  tiles: SavedTile[];
  selectedKey: string | null;
  horizontalOverlapPercent: number;
  verticalOverlapPercent: number;
  expandSplit: 4 | 8 | 12;
  pan: Point;
  zoom: number;
  hidePreviewBorders: boolean;
  hideCards: boolean;
  activeLayer: LayerId;
  maskMode: MaskMode;
  layerVisibility?: Partial<Record<EditableLayer | 'collision', boolean>>;
  layerLocks?: Partial<Record<EditableLayer | 'collision', boolean>>;
}

export const EMPTY_FEATHER: Feather = { top: 0, right: 0, bottom: 0, left: 0 };
export const CENTER_KEY = '0,0';

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function cleanNumber(value: number) {
  const rounded = Math.round(value * 10000) / 10000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function tileKey(x: number, y: number) {
  return `${cleanNumber(x)},${cleanNumber(y)}`;
}

export function assetCount(tiles: Tile[]) {
  return tiles.reduce((count, tile) =>
    count + ASSET_LAYERS.filter((layer) => Boolean(tile.layers[layer])).length,
  0);
}

export function assetBytes(tiles: Tile[]) {
  return tiles.reduce((bytes, tile) =>
    bytes + ASSET_LAYERS.reduce((sum, layer) => sum + (tile.layers[layer]?.size ?? 0), 0),
  0);
}

export function getPrimaryAsset(tile: Tile, layer: LayerId): ImageAsset | undefined {
  if (layer === 'ground') return tile.layers.ground;
  if (layer === 'object') return tile.layers.object;
  if (layer === 'foreground') return tile.layers.foreground;
  if (layer === 'collision') return tile.layers.foreground ?? tile.layers.object ?? tile.layers.ground;
  if (layer === 'black') return tile.layers.black;
  if (layer === 'white') return tile.layers.white;
  return tile.layers.foreground ?? tile.layers.object ?? tile.layers.ground;
}

export function hasVisibleAsset(tile: Tile, layer: LayerId) {
  if (layer === 'overall') return Boolean(tile.layers.ground || tile.layers.object || tile.layers.foreground);
  if (layer === 'collision') return tile.collisions.length > 0;
  return Boolean(tile.layers[layer]);
}

export function isAssetLayer(layer: LayerId): layer is EditableLayer {
  return ASSET_LAYERS.includes(layer as EditableLayer);
}
