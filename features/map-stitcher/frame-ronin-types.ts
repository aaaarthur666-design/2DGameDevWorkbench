import type { Feather, ImageAsset, Point, SavedImageReference } from './map-types';

/**
 * FrameRonin's image pipeline keeps generated images separate from vector
 * annotations. `mask` is deliberately absent: it is always derived from the
 * overall and object alpha channels and must never become an editable upload.
 */
export const MAP_IMAGE_LAYERS = ['overall', 'surface', 'object', 'black', 'white'] as const;
export type MapImageLayer = (typeof MAP_IMAGE_LAYERS)[number];

export const MAP_DISPLAY_LAYERS = ['overall', 'surface', 'object', 'mask', 'black', 'white'] as const;
export type MapDisplayLayer = (typeof MAP_DISPLAY_LAYERS)[number];

export const REGION_AUTHORING_MAP_LAYERS = ['overall', 'surface', 'object'] as const;

export const REGION_LAYERS = ['occlusion', 'collision', 'adjust', 'top'] as const;
export type RegionLayer = (typeof REGION_LAYERS)[number];

export const REGION_MODES = ['rectangle', 'polygon', 'free'] as const;
export type RegionMode = (typeof REGION_MODES)[number];
export type RegionTool = RegionMode | 'select' | 'delete';

export const REGION_LAYER_META: Record<RegionLayer, {
  label: string;
  color: string;
  fill: string;
  order: number;
  description: string;
}> = {
  occlusion: {
    label: '遮挡层',
    color: '#f8d34a',
    fill: 'rgba(248, 211, 74, 0.22)',
    order: 100,
    description: '从物体层和 Mask 中扣除，不导出为独立碰撞。',
  },
  collision: {
    label: '碰撞层',
    color: '#ff6868',
    fill: 'rgba(255, 104, 104, 0.24)',
    order: 110,
    description: '导出为 Godot 的碰撞多边形。',
  },
  adjust: {
    label: '调整层',
    color: '#bf7cff',
    fill: 'rgba(191, 124, 255, 0.22)',
    order: 120,
    description: '标记运行时可调区域，随引擎包导出。',
  },
  top: {
    label: '顶层',
    color: '#45d6cc',
    fill: 'rgba(69, 214, 204, 0.22)',
    order: 130,
    description: '从整体图层裁出并作为角色前景顶层导出。',
  },
};

export type RegionPoint = Point;

export interface RegionShape {
  id: string;
  tileKey: string;
  /** Image view on which the annotation was authored. */
  mapLayer: MapDisplayLayer;
  layer: RegionLayer;
  mode: RegionMode;
  /** Tile-local pixel coordinates. */
  points: RegionPoint[];
}

export interface FrameRoninTile {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  images: Partial<Record<MapImageLayer, ImageAsset>>;
  feather: Feather;
  hidden: boolean;
}

export interface SavedFrameRoninTile {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  images: Partial<Record<MapImageLayer, SavedImageReference>>;
  feather: Feather;
  hidden: boolean;
}

export type PixelworkLayerUploads = Record<
  Exclude<MapDisplayLayer, 'overall'>,
  Record<string, SavedImageReference>
>;

export interface PixelworkMapStateV2 {
  format: 'pixelwork-map-stitch-state';
  version: 2;
  savedAt: string;
  /** Center overall image. Kept for compatibility with FrameRonin state files. */
  source: SavedImageReference;
  /** Geometry records keyed exactly like FrameRonin's state package. */
  tiles: Record<string, Pick<SavedFrameRoninTile, 'x' | 'y' | 'w' | 'h'>>;
  /** Overall images for non-center tiles (and optionally the center tile). */
  tileUploads: Record<string, SavedImageReference>;
  /** Layer-first image maps used by FrameRonin. Mask files are import/export caches only. */
  tileLayerUploads: PixelworkLayerUploads;
  tileFeathers: Record<string, Feather>;
  selectedKey: string | null;
  horizontalOverlapPercent: number;
  verticalOverlapPercent: number;
  expandSplit: 4 | 8 | 12;
  pan: Point;
  zoom: number;
  activeMapLayer: MapDisplayLayer;
  hidePreviewBorders: boolean;
  hidePreviewCards: boolean;
  surfaceLayerPrompt: string;
  blackLayerPrompt: string;
  whiteLayerPrompt: string;
  memoryProtectionEnabled: boolean;
  memoryProtectionLimitMb: number;
  godotExportScaleEnabled: boolean;
  godotExportScalePercent: number;
  godotTextureFilterEnabled: boolean;
  godotObjectMaskLayerEnabled: boolean;
  hiddenPreviewTiles: Record<string, boolean>;
  drawShapes: RegionShape[];
  /** Workbench-only UI preferences; ignored safely by FrameRonin readers. */
  workbench?: {
    overallLayerPrompt?: string;
    layerVisibility: Partial<Record<MapDisplayLayer | RegionLayer, boolean>>;
    layerLocks: Partial<Record<MapImageLayer | RegionLayer, boolean>>;
    regionVisibility: Partial<Record<RegionLayer, boolean>>;
  };
}

export const DEFAULT_OVERALL_PROMPT = `You are a professional background artist specializing in large-scale 2D maps. Using the uploaded image, which contains artwork only along its outer edges, fill only the transparent pixels, matching the original style seamlessly while improving clarity and incorporating the user's requirements. The completed area must use a pure flat orthographic plan view: the ground plane is exactly parallel to the image plane, with no camera tilt or viewing angle, zero perspective distortion, zero foreshortening, and uniform scale throughout. It must not use an angled overhead, isometric, axonometric, oblique, three-quarter, or 45-degree view. All buildings and structures must follow the same flat orthographic projection. Render in high resolution with clear textures, sharp contours, intricate detail, and uniform sharp focus across the entire image. Exclude people, text, and smoke, and transition naturally between different terrain types.`;

export const DEFAULT_DISPLAY_VISIBILITY: Record<MapDisplayLayer, boolean> = {
  overall: true,
  surface: true,
  object: true,
  mask: true,
  black: true,
  white: true,
};

export const DEFAULT_REGION_VISIBILITY: Record<RegionLayer, boolean> = {
  occlusion: true,
  collision: true,
  adjust: true,
  top: true,
};

export const DEFAULT_IMAGE_LOCKS: Record<MapImageLayer, boolean> = {
  overall: false,
  surface: false,
  object: false,
  black: false,
  white: false,
};

export const DEFAULT_REGION_LOCKS: Record<RegionLayer, boolean> = {
  occlusion: false,
  collision: false,
  adjust: false,
  top: false,
};

export function isEditableMapLayer(layer: MapDisplayLayer): layer is MapImageLayer {
  return layer !== 'mask';
}

export function isRegionAuthoringMapLayer(layer: MapDisplayLayer) {
  return REGION_AUTHORING_MAP_LAYERS.includes(layer as (typeof REGION_AUTHORING_MAP_LAYERS)[number]);
}

export function regionShapeId(layer: RegionLayer) {
  return `${layer}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
