import JSZip from 'jszip';
import { z } from 'zod';

export const MAX_MAP_PROJECT_BYTES = 256 * 1024 * 1024;
export const MAX_MAP_PREVIEW_BYTES = 2 * 1024 * 1024;
export const mapProjectId = z.string().regex(/^[a-z0-9][a-z0-9:_-]{0,100}$/i);
const finite = z.number().finite();
const point = z.object({ x: finite, y: finite });
const layer = z.enum(['overall', 'surface', 'object', 'black', 'white']);
const displayLayer = z.enum([...layer.options, 'mask']);
const region = z.enum(['occlusion', 'collision', 'adjust', 'top']);
const image = z.object({
  path: z.string().regex(/^images\/\d+\.bin$/),
  name: z.string().max(1000),
  type: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  size: z.number().int().positive().max(MAX_MAP_PROJECT_BYTES),
  width: finite.positive().max(32768),
  height: finite.positive().max(32768),
});
const schema = z.object({
  format: z.literal('forge-map-project'),
  version: z.literal(1),
  id: mapProjectId,
  snapshot: z.object({
    tiles: z
      .array(
        z.object({
          key: z.string().max(100),
          x: finite,
          y: finite,
          w: finite.positive(),
          h: finite.positive(),
          images: z.record(layer, image),
          imageOrigins: z.record(layer, z.string()).optional(),
          surfaceIsDraft: z.boolean().optional(),
          additionalPrompt: z.string().max(2000).optional(),
          feather: z.object({
            top: finite,
            right: finite,
            bottom: finite,
            left: finite,
          }),
          hidden: z.boolean(),
        }),
      )
      .min(1)
      .max(4096),
    shapes: z
      .array(
        z.object({
          id: z.string(),
          tileKey: z.string(),
          mapLayer: displayLayer,
          layer: region,
          mode: z.enum(['rectangle', 'polygon', 'free']),
          points: z.array(point).max(100000),
        }),
      )
      .max(100000),
    selectedKey: z.string().nullable(),
    horizontalOverlapPercent: finite,
    verticalOverlapPercent: finite,
    expandSplit: z.union([z.literal(4), z.literal(8), z.literal(12)]),
    pan: point,
    zoom: finite.positive(),
    activeMapLayer: displayLayer,
    overallPrompt: z.string().max(100000),
    hidePreviewBorders: z.boolean(),
    hidePreviewCards: z.boolean(),
    displayVisibility: z.record(displayLayer, z.boolean()),
    regionVisibility: z.record(region, z.boolean()),
    imageLocks: z.record(layer, z.boolean()),
    regionLocks: z.record(region, z.boolean()),
    editorPreferences: z.record(z.unknown()).optional(),
  }),
  pending: z
    .array(
      z.object({
        tileKey: z.string(),
        layer: z.enum(['overall', 'object']),
        request: z
          .object({ provider: z.string(), prompt: z.string().max(100000) })
          .optional(),
      }),
    )
    .max(8192),
});

export async function createMapProjectPackage(draft, preview) {
  const zip = new JSZip();
  let total = 0;
  let serial = 0;
  const tiles = [];
  for (const tile of draft.snapshot.tiles) {
    const images = {};
    for (const [key, asset] of Object.entries(tile.images)) {
      if (!asset) continue;
      if (!(asset.file instanceof Blob))
        throw new Error('地图缺少原始图片，无法保存工程。');
      total += asset.file.size;
      if (total > MAX_MAP_PROJECT_BYTES)
        throw new Error('地图工程超过 256 MB。');
      const path = `images/${serial++}.bin`;
      zip.file(path, await asset.file.arrayBuffer());
      images[key] = {
        path,
        name: asset.name,
        type: asset.file.type || asset.type,
        size: asset.file.size,
        width: asset.width,
        height: asset.height,
      };
    }
    tiles.push({ ...tile, images });
  }
  const data = schema.parse({
    ...draft,
    format: 'forge-map-project',
    snapshot: { ...draft.snapshot, tiles },
  });
  zip.file('map-project.json', JSON.stringify(data));
  if (
    preview?.byteLength &&
    preview.byteLength <= MAX_MAP_PREVIEW_BYTES &&
    total + preview.byteLength + JSON.stringify(data).length * 4 + 65536 <
      MAX_MAP_PROJECT_BYTES
  )
    zip.file('preview.png', preview);
  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'STORE',
  });
  if (bytes.byteLength > MAX_MAP_PROJECT_BYTES)
    throw new Error('地图工程超过 256 MB。');
  return bytes;
}

export async function readMapProjectPackage(bytes) {
  if (bytes.byteLength > MAX_MAP_PROJECT_BYTES)
    throw new Error('地图工程超过 256 MB。');
  const zip = await JSZip.loadAsync(bytes);
  let total = 0;
  const entries = Object.values(zip.files);
  if (entries.length > 22000) throw new Error('地图工程文件数过多。');
  for (const entry of entries) {
    if (entry.dir) continue;
    if (
      entry.unsafeOriginalName !== entry.name ||
      !/^(map-project\.json|preview\.png|images\/\d+\.bin)$/.test(entry.name)
    )
      throw new Error('地图工程包含无效路径。');
    total += entry._data?.uncompressedSize || 0;
    if (total > MAX_MAP_PROJECT_BYTES)
      throw new Error('地图工程解压超过 256 MB。');
  }
  const source = zip.file('map-project.json');
  if (!source || source._data?.uncompressedSize > 16 * 1024 * 1024)
    throw new Error('地图工程清单缺失或过大。');
  const draft = schema.parse(JSON.parse(await source.async('string')));
  const keys = new Set(draft.snapshot.tiles.map((tile) => tile.key));
  if (
    keys.size !== draft.snapshot.tiles.length ||
    !draft.snapshot.tiles.some(
      (tile) => tile.key === '0,0' && tile.images.overall,
    )
  )
    throw new Error('地图工程缺少中心图片或卡片身份重复。');
  if (
    draft.snapshot.shapes.some((shape) => !keys.has(shape.tileKey)) ||
    draft.pending.some((job) => !keys.has(job.tileKey))
  )
    throw new Error('地图工程引用了不存在的卡片。');
  const images = new Map();
  for (const tile of draft.snapshot.tiles)
    for (const asset of Object.values(tile.images)) {
      const entry = zip.file(asset.path);
      if (!entry || entry._data?.uncompressedSize !== asset.size)
        throw new Error('地图工程缺少完整图片。');
      if (!images.has(asset.path))
        images.set(asset.path, await entry.async('uint8array'));
    }
  let preview;
  const previewEntry = zip.file('preview.png');
  if (
    previewEntry &&
    previewEntry._data?.uncompressedSize <= MAX_MAP_PREVIEW_BYTES
  ) {
    try {
      preview = await previewEntry.async('uint8array');
    } catch {
      /* Optional display attachment must not prevent source recovery. */
    }
  }
  return { draft, images, preview };
}
