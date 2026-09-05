import JSZip from 'jszip';
import { blobToAsset } from './image-utils';
import { createFrameRoninCenterTile } from './frame-ronin-geometry';
import {
  DEFAULT_DISPLAY_VISIBILITY,
  DEFAULT_IMAGE_LOCKS,
  DEFAULT_OVERALL_PROMPT,
  DEFAULT_REGION_LOCKS,
  DEFAULT_REGION_VISIBILITY,
} from './frame-ronin-types';
import { DEFAULT_EDITOR_PREFERENCES } from './editor-state';
import {
  loadFrameRoninState,
  parsePixelworkShapes,
  type LoadedFrameRoninState,
} from './state-package';

/** Open a portable state, Godot ZIP, or manifest with locally selected companion assets. */
export async function loadMapProject(
  file: File,
  companions: File[] = [],
): Promise<LoadedFrameRoninState> {
  let zip = file.name.toLowerCase().endsWith('.zip')
    ? await JSZip.loadAsync(file)
    : null;
  if (zip?.file('source_state.zip'))
    return loadFrameRoninState(
      new File(
        [await zip.file('source_state.zip')!.async('blob')],
        'source_state.zip',
      ),
    );
  if (zip?.file('map_stitch_state.json')) return loadFrameRoninState(file);
  if (zip?.file('map.png') && zip.file('map_stitch.tscn')) {
    const recovered = new JSZip();
    recovered.file('map.png', await zip.file('map.png')!.async('blob'));
    recovered.file(
      'map_stitch_state.json',
      JSON.stringify({
        format: 'pixelwork-map-stitch-state',
        version: 2,
        source: {
          path: 'map.png',
          fileName: 'recovered_map.png',
          type: 'image/png',
        },
        tiles: {},
      }),
    );
    const loaded = await loadFrameRoninState(
      new File(
        [await recovered.generateAsync({ type: 'blob' })],
        'recovered_state.zip',
      ),
    );
    loaded.warnings.push(
      '该旧 Agent 包仅能恢复合成图片。区域没有足够的原卡片几何信息，无法可靠转换；请优先打开同批次的 pixelwork-state.zip 恢复完整地图。',
    );
    return loaded;
  }
  const manifestEntry =
    zip?.file('map_export.json') ?? zip?.file('map_stitch_godot.json');
  if (zip && !manifestEntry)
    throw new Error('压缩包中没有可识别的地图状态或 Godot 地图清单。');
  const manifest = JSON.parse(
    manifestEntry ? await manifestEntry.async('string') : await file.text(),
  );
  if (!manifest || typeof manifest !== 'object')
    throw new Error('地图清单无效。');
  const read = async (path: string): Promise<Blob> => {
    const entry = zip?.file(path.replace(/^res:\/\//, ''));
    if (entry) return entry.async('blob');
    const normalized = path.replace(/^res:\/\//, '');
    const matches = companions.filter(
      (item) =>
        item.webkitRelativePath.endsWith(`/${normalized}`) ||
        item.webkitRelativePath === normalized ||
        item.name === normalized.split('/').at(-1),
    );
    if (matches.length !== 1)
      throw new Error(
        `缺少或无法唯一匹配 ${path}。请打开完整 Godot ZIP，或用“打开资源文件夹”同时选择清单和图片。`,
      );
    return matches[0];
  };
  if (
    manifest.format === 'pixelwork-map-stitch-state' ||
    manifest.format === 'scenemaker-map-stitch-state'
  ) {
    if (!companions.length) return loadFrameRoninState(file);
    const combined = new JSZip();
    combined.file('map_stitch_state.json', JSON.stringify(manifest));
    const addReferences = async (value: unknown): Promise<void> => {
      if (!value || typeof value !== 'object') return;
      if ('path' in value && typeof value.path === 'string')
        combined.file(value.path, await read(value.path));
      for (const child of Object.values(value)) await addReferences(child);
    };
    await addReferences(manifest);
    return loadFrameRoninState(
      new File(
        [await combined.generateAsync({ type: 'blob' })],
        'recovered_state.zip',
      ),
    );
  }
  if (
    manifest.format === 'frame-ronin-engine-package' &&
    manifest.target === 'godot'
  ) {
    const tile = createFrameRoninCenterTile(
      await blobToAsset(
        await read('assets/map_overall.png'),
        'recovered_map.png',
      ),
    );
    try {
      for (const layer of ['surface', 'object', 'black', 'white'] as const) {
        if (Array.isArray(manifest.layers) && manifest.layers.includes(layer))
          tile.images[layer] = await blobToAsset(
            await read(`assets/map_${layer}.png`),
            `recovered_${layer}.png`,
          );
      }
      const regionManifest = JSON.parse(
        await (await read('regions.json')).text(),
      );
      const originX = Number(manifest.canvas?.originX ?? 0),
        originY = Number(manifest.canvas?.originY ?? 0);
      if (!Number.isFinite(originX) || !Number.isFinite(originY))
        throw new Error('Godot 清单的画布坐标无效。');
      const shapes = parsePixelworkShapes(regionManifest.regions).map(
        (shape) => {
          const points = shape.points.map((point) => ({
            x: point.x - originX,
            y: point.y - originY,
          }));
          return {
            ...shape,
            tileKey: tile.key,
            points:
              shape.mode === 'rectangle'
                ? [
                    {
                      x: Math.min(...points.map((p) => p.x)),
                      y: Math.min(...points.map((p) => p.y)),
                    },
                    {
                      x: Math.max(...points.map((p) => p.x)),
                      y: Math.max(...points.map((p) => p.y)),
                    },
                  ]
                : points,
          };
        },
      );
      return {
        tiles: [tile],
        shapes,
        selectedKey: tile.key,
        horizontalOverlapPercent: 15,
        verticalOverlapPercent: 15,
        expandSplit: 4,
        pan: { x: 0, y: 0 },
        zoom: 1,
        activeMapLayer: 'overall',
        overallPrompt: DEFAULT_OVERALL_PROMPT,
        hidePreviewBorders: false,
        hidePreviewCards: false,
        displayVisibility: { ...DEFAULT_DISPLAY_VISIBILITY },
        regionVisibility: { ...DEFAULT_REGION_VISIBILITY },
        imageLocks: { ...DEFAULT_IMAGE_LOCKS },
        regionLocks: { ...DEFAULT_REGION_LOCKS },
        editorPreferences: { ...DEFAULT_EDITOR_PREFERENCES },
        warnings: [
          '该 Godot 包只有合成输出，已恢复为单个地图块并转换区域坐标；原始卡片布局、羽化前图片和编辑历史无法恢复。',
        ],
        sourceFormat: 'pixelwork-v2',
      };
    } catch (error) {
      for (const asset of Object.values(tile.images))
        if (asset) URL.revokeObjectURL(asset.url);
      throw error;
    }
  }
  if (
    Array.isArray(manifest.tiles) &&
    manifest.tiles.some(
      (item: { image?: unknown }) => typeof item?.image === 'string',
    )
  ) {
    const combined = new JSZip();
    const tiles = new Map<
      string,
      {
        key: string;
        x: number;
        y: number;
        w: number;
        h: number;
        layers: Record<string, unknown>;
        collisions: unknown[];
      }
    >();
    for (const record of manifest.tiles) {
      if (!record || typeof record.image !== 'string' || !record.tile)
        throw new Error('Godot 卡片记录缺少图片或几何信息。');
      const key =
        typeof record.key === 'string'
          ? record.key
          : `${record.tile.x},${record.tile.y}`;
      let tile = tiles.get(key);
      if (!tile) {
        tile = {
          key,
          x: Number(record.tile.x),
          y: Number(record.tile.y),
          w: Number(record.tile.w),
          h: Number(record.tile.h),
          layers: {},
          collisions: [],
        };
        tiles.set(key, tile);
      }
      const layer =
        record.layer === 'surface' || record.layer === 'overall'
          ? 'ground'
          : (record.layer ?? 'ground');
      const blob = await read(record.image);
      combined.file(record.image, blob);
      tile.layers[layer] = {
        path: record.image,
        fileName: record.image.split('/').at(-1),
        type: 'image/png',
      };
    }
    for (const collision of manifest.collisions ?? [])
      if (collision?.normalized)
        tiles
          .get(collision.tileKey)
          ?.collisions.push({ ...collision.normalized, id: collision.id });
    combined.file(
      'map_stitch_state.json',
      JSON.stringify({
        format: 'scenemaker-map-stitch-state',
        version: 5,
        tiles: [...tiles.values()],
        horizontalOverlapPercent: manifest.overlap?.horizontal_percent ?? 15,
        verticalOverlapPercent: manifest.overlap?.vertical_percent ?? 15,
      }),
    );
    zip = null;
    const loaded = await loadFrameRoninState(
      new File(
        [await combined.generateAsync({ type: 'blob' })],
        'legacy_godot_state.zip',
      ),
    );
    loaded.warnings.push(
      '已读取 Godot 导出图片；图片可能已包含羽化，因此恢复时不再次应用羽化。',
    );
    return loaded;
  }
  throw new Error(
    '不支持此地图清单。请选择 Pixelwork 状态、SceneMaker v5 或可识别的 Godot 地图包。',
  );
}
