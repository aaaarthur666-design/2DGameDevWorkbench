import JSZip from 'jszip';
import {
  blobToAsset,
  canvasToBlob,
  downloadBlob,
  loadImage,
  safeFileName,
} from './image-utils';
import {
  CENTER_KEY,
  EMPTY_FEATHER,
  type SavedImageReference,
  type ImageAsset,
} from './map-types';
import {
  DEFAULT_DISPLAY_VISIBILITY,
  DEFAULT_IMAGE_LOCKS,
  DEFAULT_OVERALL_PROMPT,
  upgradeLegacyOverallPrompt,
  DEFAULT_REGION_LOCKS,
  DEFAULT_REGION_VISIBILITY,
  MAP_DISPLAY_LAYERS,
  REGION_LAYERS,
  type FrameRoninTile,
  type MapDisplayLayer,
  type MapImageLayer,
  type PixelworkLayerUploads,
  type PixelworkMapStateV2,
  type RegionLayer,
  type RegionShape,
} from './frame-ronin-types';
import { deriveMaskCanvas } from './layer-engine';
import { regionRectToShape } from './region-engine';
import { readEditorPreferences, type EditorPreferences } from './editor-state';

export interface FrameRoninEditorSnapshot {
  tiles: FrameRoninTile[];
  shapes: RegionShape[];
  selectedKey: string | null;
  horizontalOverlapPercent: number;
  verticalOverlapPercent: number;
  expandSplit: 4 | 8 | 12;
  pan: { x: number; y: number };
  zoom: number;
  activeMapLayer: MapDisplayLayer;
  overallPrompt: string;
  hidePreviewBorders: boolean;
  hidePreviewCards: boolean;
  displayVisibility: Record<MapDisplayLayer, boolean>;
  regionVisibility: Record<RegionLayer, boolean>;
  imageLocks: Record<MapImageLayer, boolean>;
  regionLocks: Record<RegionLayer, boolean>;
  editorPreferences?: EditorPreferences;
}

export interface LoadedFrameRoninState extends FrameRoninEditorSnapshot {
  warnings: string[];
  sourceFormat: 'pixelwork-v2' | 'scenemaker-v5';
}

export async function createPixelworkStatePackage(
  snapshot: FrameRoninEditorSnapshot,
) {
  const sourceTile = snapshot.tiles.find((tile) => tile.key === CENTER_KEY);
  const source = sourceTile?.images.overall;
  if (!sourceTile || !source)
    throw new Error('中心卡片缺少整体层，无法保存状态');

  const zip = new JSZip();
  const imageFolder = zip.folder('images');
  if (!imageFolder) throw new Error('无法创建状态图片目录');
  const usedPaths = new Set<string>();

  const packBlob = (
    blob: Blob,
    preferredName: string,
    width: number,
    height: number,
  ): SavedImageReference => {
    const fileName = uniqueImageName(usedPaths, preferredName, blob.type);
    const path = `images/${fileName}`;
    imageFolder.file(fileName, blob);
    return {
      fileName: preferredName,
      type: blob.type || 'image/png',
      size: blob.size,
      width,
      height,
      path,
    };
  };

  const sourceReference = packBlob(
    source.file,
    `source_${source.name}`,
    source.width,
    source.height,
  );
  const tileUploads: Record<string, SavedImageReference> = {};
  const tileLayerUploads: PixelworkLayerUploads = {
    surface: {},
    object: {},
    mask: {},
    black: {},
    white: {},
  };

  for (const tile of snapshot.tiles) {
    if (tile.key !== CENTER_KEY && tile.images.overall) {
      const asset = tile.images.overall;
      tileUploads[tile.key] = packBlob(
        asset.file,
        `tile_${keyName(tile.key)}_${asset.name}`,
        asset.width,
        asset.height,
      );
    }
    for (const layer of ['surface', 'object', 'black', 'white'] as const) {
      const asset = tile.images[layer];
      if (!asset) continue;
      tileLayerUploads[layer][tile.key] = packBlob(
        asset.file,
        `${layer}_${keyName(tile.key)}_${asset.name}`,
        asset.width,
        asset.height,
      );
    }
    if (tile.images.overall && tile.images.object) {
      const mask = await deriveMaskCanvas(
        tile.images.overall,
        tile.images.object,
      );
      const maskBlob = await canvasToBlob(mask);
      tileLayerUploads.mask[tile.key] = packBlob(
        maskBlob,
        `mask_${keyName(tile.key)}.png`,
        mask.width,
        mask.height,
      );
    }
  }

  const state: PixelworkMapStateV2 = {
    version: 2,
    savedAt: new Date().toISOString(),
    format: 'pixelwork-map-stitch-state',
    source: sourceReference,
    tiles: Object.fromEntries(
      snapshot.tiles
        .filter((tile) => tile.key !== CENTER_KEY)
        .map((tile) => [
          tile.key,
          { x: tile.x, y: tile.y, w: tile.w, h: tile.h },
        ]),
    ),
    tileUploads,
    tileLayerUploads,
    tileFeathers: Object.fromEntries(
      snapshot.tiles.map((tile) => [tile.key, tile.feather]),
    ),
    selectedKey: snapshot.selectedKey,
    horizontalOverlapPercent: snapshot.horizontalOverlapPercent,
    verticalOverlapPercent: snapshot.verticalOverlapPercent,
    expandSplit: snapshot.expandSplit,
    pan: snapshot.pan,
    zoom: snapshot.zoom,
    hidePreviewBorders: snapshot.hidePreviewBorders,
    hidePreviewCards: snapshot.hidePreviewCards,
    activeMapLayer: snapshot.activeMapLayer,
    surfaceLayerPrompt: snapshot.overallPrompt,
    blackLayerPrompt: '',
    whiteLayerPrompt: '',
    memoryProtectionEnabled:
      snapshot.editorPreferences?.memoryProtection ?? true,
    memoryProtectionLimitMb: snapshot.editorPreferences?.memoryLimitMb ?? 1024,
    godotExportScaleEnabled: false,
    godotExportScalePercent: 100,
    godotTextureFilterEnabled: true,
    godotObjectMaskLayerEnabled: true,
    hiddenPreviewTiles: Object.fromEntries(
      snapshot.tiles.map((tile) => [tile.key, tile.hidden]),
    ),
    drawShapes: snapshot.shapes,
    workbench: {
      tileImageOrigins: Object.fromEntries(
        snapshot.tiles.map((tile) => [tile.key, tile.imageOrigins ?? {}]),
      ),
      surfaceDrafts: Object.fromEntries(
        snapshot.tiles.map((tile) => [tile.key, Boolean(tile.surfaceIsDraft)]),
      ),
      editorPreferences: snapshot.editorPreferences,
      overallLayerPrompt: snapshot.overallPrompt,
      layerVisibility: {
        ...snapshot.displayVisibility,
        ...snapshot.regionVisibility,
      },
      layerLocks: { ...snapshot.imageLocks, ...snapshot.regionLocks },
      regionVisibility: snapshot.regionVisibility,
    },
  };
  zip.file('map_stitch_state.json', JSON.stringify(state, null, 2));
  return {
    blob: await zip.generateAsync({ type: 'blob', compression: 'STORE' }),
    fileName: `${safeFileName(source.name.replace(/\.[^.]+$/, ''))}_map_stitch_state.zip`,
    state,
  };
}

export async function downloadPixelworkState(
  snapshot: FrameRoninEditorSnapshot,
) {
  const result = await createPixelworkStatePackage(snapshot);
  downloadBlob(result.blob, result.fileName);
  return result;
}

export async function loadFrameRoninState(
  file: File,
): Promise<LoadedFrameRoninState> {
  const { manifest, zip } = await readFrameRoninStatePackage(file);
  const assets = new ImportAssets();
  try {
    if (
      isRecord(manifest) &&
      manifest.format === 'pixelwork-map-stitch-state' &&
      (manifest.version === 1 || manifest.version === 2)
    ) {
      return await loadPixelworkManifest(manifest, zip, assets);
    }
    if (
      isRecord(manifest) &&
      manifest.format === 'scenemaker-map-stitch-state' &&
      manifest.version === 5
    ) {
      return await loadSceneMakerManifest(manifest, zip, assets);
    }
    throw new Error('不是受支持的 Pixelwork v1/v2 或 SceneMaker v5 地图状态');
  } catch (error) {
    assets.revoke();
    throw error;
  }
}

async function loadPixelworkManifest(
  manifest: Record<string, unknown>,
  zip: JSZip | null,
  assets: ImportAssets,
): Promise<LoadedFrameRoninState> {
  const sourceReference = normalizeReference(manifest.source, 'map_tile.png');
  if (!sourceReference) throw new Error('拼接状态缺少中心图片');
  const source = await assets.load(sourceReference, zip, 'map_tile.png');
  const geometry = parsePixelworkGeometry(manifest.tiles);
  const tileUploads = isRecord(manifest.tileUploads)
    ? manifest.tileUploads
    : {};
  const rawLayerUploads = isRecord(manifest.tileLayerUploads)
    ? manifest.tileLayerUploads
    : {};
  const featherMap = isRecord(manifest.tileFeathers)
    ? manifest.tileFeathers
    : {};
  const hiddenMap = isRecord(manifest.hiddenPreviewTiles)
    ? manifest.hiddenPreviewTiles
    : {};
  const tiles: FrameRoninTile[] = [
    {
      key: CENTER_KEY,
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      images: { overall: source },
      feather: readFeather(featherMap[CENTER_KEY]),
      hidden: hiddenMap[CENTER_KEY] === true,
    },
  ];

  for (const [key, bounds] of Object.entries(geometry)) {
    if (key === CENTER_KEY) continue;
    const images: FrameRoninTile['images'] = {};
    const overallReference = normalizeReference(
      tileUploads[key],
      `tile_${keyName(key)}.png`,
    );
    if (overallReference)
      images.overall = await assets.load(
        overallReference,
        zip,
        `tile_${keyName(key)}.png`,
      );
    tiles.push({
      key,
      ...bounds,
      images,
      feather: readFeather(featherMap[key]),
      hidden: hiddenMap[key] === true,
    });
  }

  for (const layer of ['surface', 'object', 'black', 'white'] as const) {
    const byTile = isRecord(rawLayerUploads[layer])
      ? rawLayerUploads[layer]
      : {};
    for (const tile of tiles) {
      const reference = normalizeReference(
        byTile[tile.key],
        `${layer}_${keyName(tile.key)}.png`,
      );
      if (reference)
        tile.images[layer] = await assets.load(
          reference,
          zip,
          `${layer}_${keyName(tile.key)}.png`,
        );
    }
  }

  const shapes = parsePixelworkShapes(
    manifest.drawShapes ?? manifest.drawingShapes,
  );
  const workbench = isRecord(manifest.workbench) ? manifest.workbench : {};
  const origins = isRecord(workbench.tileImageOrigins)
    ? workbench.tileImageOrigins
    : {};
  const drafts = isRecord(workbench.surfaceDrafts)
    ? workbench.surfaceDrafts
    : {};
  for (const tile of tiles) {
    const value = origins[tile.key];
    const values = isRecord(value) ? value : {};
    tile.imageOrigins = Object.fromEntries(
      Object.entries(values).filter(
        ([key, value]) =>
          key in tile.images &&
          [
            'uploaded',
            'overall-copy',
            'alpha-reference',
            'matte-extraction',
            'local-fill',
            'api-generated',
            'pixel-edited',
          ].includes(String(value)),
      ),
    ) as FrameRoninTile['imageOrigins'];
    tile.surfaceIsDraft = drafts[tile.key] === true;
  }
  const visibility = isRecord(workbench.layerVisibility)
    ? workbench.layerVisibility
    : {};
  const locks = isRecord(workbench.layerLocks) ? workbench.layerLocks : {};
  const regionVisibilityRecord = isRecord(workbench.regionVisibility)
    ? workbench.regionVisibility
    : visibility;
  const savedPrompt =
    typeof workbench.overallLayerPrompt === 'string' &&
    workbench.overallLayerPrompt.trim()
      ? workbench.overallLayerPrompt
      : typeof manifest.surfaceLayerPrompt === 'string' &&
          manifest.surfaceLayerPrompt.trim()
        ? manifest.surfaceLayerPrompt
        : DEFAULT_OVERALL_PROMPT;
  const overallPrompt = upgradeLegacyOverallPrompt(savedPrompt);

  return {
    tiles,
    shapes,
    selectedKey:
      typeof manifest.selectedKey === 'string' ? manifest.selectedKey : null,
    horizontalOverlapPercent: clampNumber(
      manifest.horizontalOverlapPercent,
      15,
      0,
      50,
    ),
    verticalOverlapPercent: clampNumber(
      manifest.verticalOverlapPercent,
      15,
      0,
      50,
    ),
    expandSplit: readSplit(manifest.expandSplit),
    pan: readPoint(manifest.pan),
    zoom: clampNumber(manifest.zoom, 1, 0.05, 8),
    activeMapLayer: readDisplayLayer(manifest.activeMapLayer),
    overallPrompt,
    hidePreviewBorders: manifest.hidePreviewBorders === true,
    hidePreviewCards: manifest.hidePreviewCards === true,
    displayVisibility: mergeBooleanMap(DEFAULT_DISPLAY_VISIBILITY, visibility),
    regionVisibility: mergeBooleanMap(
      DEFAULT_REGION_VISIBILITY,
      regionVisibilityRecord,
    ),
    imageLocks: mergeBooleanMap(DEFAULT_IMAGE_LOCKS, locks),
    regionLocks: mergeBooleanMap(DEFAULT_REGION_LOCKS, locks),
    editorPreferences: readEditorPreferences(
      workbench.editorPreferences ?? {
        memoryProtection: manifest.memoryProtectionEnabled,
        memoryLimitMb: manifest.memoryProtectionLimitMb,
      },
    ),
    warnings:
      overallPrompt !== savedPrompt
        ? ['旧版俯视默认提示词已更新为横版侧视默认词。']
        : [],
    sourceFormat: 'pixelwork-v2',
  };
}

async function loadSceneMakerManifest(
  manifest: Record<string, unknown>,
  zip: JSZip | null,
  assets: ImportAssets,
): Promise<LoadedFrameRoninState> {
  if (!Array.isArray(manifest.tiles) || !manifest.tiles.length)
    throw new Error('SceneMaker 状态中没有地图卡片');
  const warnings = [
    '已从 SceneMaker v5 迁移：ground 映射为 surface，整体层由旧视觉层合成。',
  ];
  const records = manifest.tiles.filter(isRecord);
  const centerRecord =
    records.find((record) => record.key === CENTER_KEY) ?? records[0];
  const centerLayers = isRecord(centerRecord.layers) ? centerRecord.layers : {};
  const centerGround = normalizeReference(
    centerLayers.ground,
    'source_ground.png',
  );
  if (!centerGround)
    throw new Error('SceneMaker 状态的中心卡片缺少 ground 图片');
  const sourceProbe = await assets.load(centerGround, zip, 'source_ground.png');
  const sourceWidth = sourceProbe.width;
  const sourceHeight = sourceProbe.height;
  URL.revokeObjectURL(sourceProbe.url);
  const tiles: FrameRoninTile[] = [];
  const shapes: RegionShape[] = [];
  let hadForeground = false;

  for (const record of records) {
    const key = typeof record.key === 'string' ? record.key : CENTER_KEY;
    const layers = isRecord(record.layers) ? record.layers : {};
    const groundRef = normalizeReference(
      layers.ground,
      `${keyName(key)}_ground.png`,
    );
    const objectRef = normalizeReference(
      layers.object,
      `${keyName(key)}_object.png`,
    );
    const foregroundRef = normalizeReference(
      layers.foreground,
      `${keyName(key)}_foreground.png`,
    );
    const blackRef = normalizeReference(
      layers.black,
      `${keyName(key)}_black.png`,
    );
    const whiteRef = normalizeReference(
      layers.white,
      `${keyName(key)}_white.png`,
    );
    hadForeground ||= Boolean(foregroundRef);

    const images: FrameRoninTile['images'] = {};
    const compositeAssets = [];
    if (groundRef) {
      images.surface = await assets.load(
        groundRef,
        zip,
        `${keyName(key)}_surface.png`,
      );
      compositeAssets.push(
        await assets.load(groundRef, zip, `${keyName(key)}_overall_ground.png`),
      );
    }
    if (objectRef) {
      images.object = await assets.load(
        objectRef,
        zip,
        `${keyName(key)}_object.png`,
      );
      compositeAssets.push(
        await assets.load(objectRef, zip, `${keyName(key)}_overall_object.png`),
      );
    }
    if (foregroundRef)
      compositeAssets.push(
        await assets.load(
          foregroundRef,
          zip,
          `${keyName(key)}_overall_foreground.png`,
        ),
      );
    if (blackRef)
      images.black = await assets.load(
        blackRef,
        zip,
        `${keyName(key)}_black.png`,
      );
    if (whiteRef)
      images.white = await assets.load(
        whiteRef,
        zip,
        `${keyName(key)}_white.png`,
      );
    if (compositeAssets.length) {
      images.overall = assets.keep(
        await composeLegacyOverall(
          compositeAssets,
          `${keyName(key)}_overall.png`,
        ),
      );
      for (const asset of compositeAssets) URL.revokeObjectURL(asset.url);
    }

    const tile: FrameRoninTile = {
      key,
      x: finiteNumber(record.x, 0),
      y: finiteNumber(record.y, 0),
      w: positiveNumber(record.w, 1),
      h: positiveNumber(record.h, 1),
      images,
      feather: readFeather(record.feather),
      hidden: record.hidden === true,
    };
    tiles.push(tile);
    if (Array.isArray(record.collisions)) {
      const width = Math.max(1, Math.round(tile.w * sourceWidth));
      const height = Math.max(1, Math.round(tile.h * sourceHeight));
      for (const [index, collision] of record.collisions.entries()) {
        if (!isRecord(collision)) continue;
        shapes.push(
          regionRectToShape({
            id:
              typeof collision.id === 'string'
                ? collision.id
                : `legacy_collision_${index}`,
            tileKey: key,
            x: finiteNumber(collision.x, 0),
            y: finiteNumber(collision.y, 0),
            w: positiveNumber(collision.w, 0),
            h: positiveNumber(collision.h, 0),
            tileWidth: width,
            tileHeight: height,
          }),
        );
      }
    }
  }
  if (hadForeground)
    warnings.push(
      '旧 foreground 已烘焙进整体层；无法可靠推断 top 区域，因此未伪造顶层标注。',
    );

  const activeMapLayer = mapLegacyLayer(manifest.activeLayer);
  const visibility = isRecord(manifest.layerVisibility)
    ? manifest.layerVisibility
    : {};
  const locks = isRecord(manifest.layerLocks) ? manifest.layerLocks : {};
  return {
    tiles,
    shapes,
    selectedKey:
      typeof manifest.selectedKey === 'string' ? manifest.selectedKey : null,
    horizontalOverlapPercent: clampNumber(
      manifest.horizontalOverlapPercent,
      15,
      0,
      50,
    ),
    verticalOverlapPercent: clampNumber(
      manifest.verticalOverlapPercent,
      15,
      0,
      50,
    ),
    expandSplit: readSplit(manifest.expandSplit),
    pan: readPoint(manifest.pan),
    zoom: clampNumber(manifest.zoom, 1, 0.05, 8),
    activeMapLayer,
    overallPrompt: DEFAULT_OVERALL_PROMPT,
    hidePreviewBorders: manifest.hidePreviewBorders === true,
    hidePreviewCards: manifest.hideCards === true,
    displayVisibility: {
      ...DEFAULT_DISPLAY_VISIBILITY,
      surface: booleanValue(visibility.ground, true),
      object: booleanValue(visibility.object, true),
      black: booleanValue(visibility.black, true),
      white: booleanValue(visibility.white, true),
    },
    regionVisibility: {
      ...DEFAULT_REGION_VISIBILITY,
      collision: booleanValue(visibility.collision, true),
    },
    imageLocks: {
      ...DEFAULT_IMAGE_LOCKS,
      surface: booleanValue(locks.ground, false),
      object: booleanValue(locks.object, false),
      black: booleanValue(locks.black, false),
      white: booleanValue(locks.white, false),
    },
    regionLocks: {
      ...DEFAULT_REGION_LOCKS,
      collision: booleanValue(locks.collision, false),
    },
    warnings,
    sourceFormat: 'scenemaker-v5',
  };
}

async function composeLegacyOverall(
  assets: Awaited<ReturnType<typeof loadReferenceAsset>>[],
  name: string,
) {
  const width = Math.max(...assets.map((asset) => asset.width));
  const height = Math.max(...assets.map((asset) => asset.height));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法创建迁移画布');
  context.imageSmoothingEnabled = false;
  for (const asset of assets)
    context.drawImage(await loadImage(asset.url), 0, 0, width, height);
  return blobToAsset(await canvasToBlob(canvas), name);
}

async function loadReferenceAsset(
  reference: SavedImageReference,
  zip: JSZip | null,
  fallbackName: string,
) {
  const blob = await referenceToBlob(reference, zip);
  return blobToAsset(blob, reference.fileName || fallbackName);
}

/** Failed imports release every image loaded so far, while the current document stays intact. */
class ImportAssets {
  private urls = new Set<string>();
  keep(asset: ImageAsset) {
    this.urls.add(asset.url);
    return asset;
  }
  async load(...args: Parameters<typeof loadReferenceAsset>) {
    return this.keep(await loadReferenceAsset(...args));
  }
  revoke() {
    for (const url of this.urls) URL.revokeObjectURL(url);
  }
}

async function readFrameRoninStatePackage(file: File) {
  if (!file.name.toLowerCase().endsWith('.zip'))
    return { manifest: JSON.parse(await file.text()) as unknown, zip: null };
  const zip = await JSZip.loadAsync(file);
  const manifestFile = zip.file('map_stitch_state.json');
  if (!manifestFile) throw new Error('压缩包中缺少 map_stitch_state.json');
  return {
    manifest: JSON.parse(await manifestFile.async('string')) as unknown,
    zip,
  };
}

async function referenceToBlob(
  reference: SavedImageReference,
  zip: JSZip | null,
) {
  if (reference.path && zip) {
    const imageFile = zip.file(reference.path);
    if (!imageFile) throw new Error(`状态包缺少图片：${reference.path}`);
    const blob = await imageFile.async('blob');
    return new Blob([blob], {
      type: reference.type || blob.type || 'image/png',
    });
  }
  if (reference.dataUrl) {
    const response = await fetch(reference.dataUrl);
    if (!response.ok)
      throw new Error(`无法读取状态图片：${reference.fileName}`);
    return response.blob();
  }
  throw new Error(`图片 ${reference.fileName} 没有可读取的数据`);
}

function normalizeReference(
  value: unknown,
  fallbackName: string,
): SavedImageReference | null {
  if (typeof value === 'string' && value.startsWith('data:')) {
    return {
      fileName: fallbackName,
      type: dataUrlType(value),
      size: 0,
      width: 0,
      height: 0,
      dataUrl: value,
    };
  }
  if (!isRecord(value)) return null;
  const dataUrl = typeof value.dataUrl === 'string' ? value.dataUrl : undefined;
  const path = typeof value.path === 'string' ? value.path : undefined;
  if (!dataUrl && !path) return null;
  return {
    fileName:
      typeof value.fileName === 'string' ? value.fileName : fallbackName,
    type:
      typeof value.type === 'string'
        ? value.type
        : dataUrl
          ? dataUrlType(dataUrl)
          : 'image/png',
    size: finiteNumber(value.size, 0),
    width: finiteNumber(value.width, 0),
    height: finiteNumber(value.height, 0),
    dataUrl,
    path,
  };
}

export function parsePixelworkGeometry(value: unknown) {
  if (!isRecord(value)) throw new Error('拼接状态缺少地图块数据');
  const result: Record<string, { x: number; y: number; w: number; h: number }> =
    {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!isRecord(candidate)) continue;
    const x = finiteNumber(candidate.x, Number.NaN);
    const y = finiteNumber(candidate.y, Number.NaN);
    const w = positiveNumber(candidate.w, Number.NaN);
    const h = positiveNumber(candidate.h, Number.NaN);
    if ([x, y, w, h].every(Number.isFinite)) result[key] = { x, y, w, h };
  }
  // A project containing only the separately stored center legitimately has no outer tiles.
  if (Object.keys(value).length && !Object.keys(result).length)
    throw new Error('拼接状态中的地图块数据无效');
  return result;
}

export function parsePixelworkShapes(value: unknown): RegionShape[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate, index) => {
    if (!isRecord(candidate)) return [];
    const layer = REGION_LAYERS.includes(candidate.layer as RegionLayer)
      ? (candidate.layer as RegionLayer)
      : null;
    const mode =
      candidate.mode === 'rectangle' ||
      candidate.mode === 'polygon' ||
      candidate.mode === 'free'
        ? candidate.mode
        : null;
    if (!layer || !mode || !Array.isArray(candidate.points)) return [];
    const points = candidate.points.flatMap((point) =>
      isRecord(point) && Number.isFinite(point.x) && Number.isFinite(point.y)
        ? [{ x: Number(point.x), y: Number(point.y) }]
        : [],
    );
    if (
      (mode === 'rectangle' && points.length < 2) ||
      (mode !== 'rectangle' && points.length < 3)
    )
      return [];
    return [
      {
        id:
          typeof candidate.id === 'string' && candidate.id
            ? candidate.id
            : `shape_${index}`,
        tileKey:
          typeof candidate.tileKey === 'string'
            ? candidate.tileKey
            : CENTER_KEY,
        mapLayer: readDisplayLayer(candidate.mapLayer),
        layer,
        mode,
        points,
      },
    ];
  });
}

function readDisplayLayer(value: unknown): MapDisplayLayer {
  return MAP_DISPLAY_LAYERS.includes(value as MapDisplayLayer)
    ? (value as MapDisplayLayer)
    : 'overall';
}

function mapLegacyLayer(value: unknown): MapDisplayLayer {
  if (value === 'ground') return 'surface';
  if (value === 'object' || value === 'black' || value === 'white')
    return value;
  return 'overall';
}

function readSplit(value: unknown): 4 | 8 | 12 {
  return value === 8 || value === 12 ? value : 4;
}

function readFeather(value: unknown) {
  if (!isRecord(value)) return { ...EMPTY_FEATHER };
  return {
    top: clampNumber(value.top, 0, 0, 50),
    right: clampNumber(value.right, 0, 0, 50),
    bottom: clampNumber(value.bottom, 0, 0, 50),
    left: clampNumber(value.left, 0, 0, 50),
  };
}

function readPoint(value: unknown) {
  return isRecord(value)
    ? { x: finiteNumber(value.x, 0), y: finiteNumber(value.y, 0) }
    : { x: 0, y: 0 };
}

function mergeBooleanMap<T extends string>(
  defaults: Record<T, boolean>,
  values: Record<string, unknown>,
) {
  return Object.fromEntries(
    Object.keys(defaults).map((key) => [
      key,
      booleanValue(values[key], defaults[key as T]),
    ]),
  ) as Record<T, boolean>;
}

function uniqueImageName(
  used: Set<string>,
  candidate: string,
  mimeType: string,
) {
  const safeCandidate = safeFileName(candidate);
  const extension =
    /\.[a-z0-9]+$/i.exec(safeCandidate)?.[0] ?? mimeExtension(mimeType);
  const stem = safeCandidate.replace(/\.[a-z0-9]+$/i, '') || 'image';
  let name = `${stem}${extension}`;
  let suffix = 1;
  while (used.has(name)) name = `${stem}_${suffix++}${extension}`;
  used.add(name);
  return name;
}

function mimeExtension(type: string) {
  if (type === 'image/jpeg') return '.jpg';
  if (type === 'image/webp') return '.webp';
  return '.png';
}

function dataUrlType(dataUrl: string) {
  return /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'image/png';
}

function keyName(key: string) {
  return key.replace(',', '_').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positiveNumber(value: unknown, fallback: number) {
  const number = finiteNumber(value, fallback);
  return number > 0 ? number : fallback;
}

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  return Math.max(min, Math.min(max, finiteNumber(value, fallback)));
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
