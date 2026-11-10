import path from 'node:path';
import sharp from 'sharp';
import JSZip from 'jszip';
import {
  listMapProjectRecords,
  readMapProjectPreview,
} from './map-projects.mjs';
import { readMapProjectPackage } from '../../features/map-stitcher/project-package.mjs';
import { safeAssetPackagePath } from './asset-packages-zip.mjs';

export async function scanCatalog(root, manifest, issues, { taskFile, route }) {
  const maps = await listMapProjectRecords(root, manifest, issues);
  const rows = [];
  for (const record of maps) {
    const files = await Promise.all(
      record.outputs.map((file) => taskFile(manifest, record, file)),
    );
    const previewAvailable =
      record.preview &&
      (await readMapProjectPreview(root, manifest, record).then(
        () => true,
        () => false,
      ));
    rows.push({
      record,
      asset: {
        id: `map-project:${record.projectId}`,
        kind: 'map',
        mapType: 'project',
        origin: 'map-project',
        projectId: record.projectId,
        projectRevision: record.revision,
        title: record.title,
        tileCount: record.tileCount,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        status: 'saved',
        files: record.outputs,
        primary: record.outputs[0],
        hasArtwork: true,
        previewKind: previewAvailable ? 'image' : 'none',
        availability: files.every((f) => f.available) ? 'available' : 'missing',
        manualWorkflow: true,
        taskIds: [],
        editorPath: `${route(manifest, 'map-stitcher')}?map=${encodeURIComponent(record.projectId)}&saved=1`,
      },
    });
  }
  return rows;
}

export function readPreview(root, manifest, asset, record, projectRevision) {
  if (asset.origin !== 'map-project') return null;
  if (
    projectRevision !== undefined &&
    String(asset.projectRevision) !== String(projectRevision)
  )
    throw new Error('地图工程版本已更新，请刷新资产库。');
  return readMapProjectPreview(root, manifest, record);
}

export async function editableCopy(bytes, { allocate }) {
  if (!bytes.subarray(0, 2).equals(Buffer.from('PK'))) return bytes;
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file('map-project.json');
  if (!entry) return bytes;
  const draft = JSON.parse(await entry.async('string'));
  draft.id = allocate(draft.id, 'map');
  // The map reader always restores pending jobs in a paused queue.
  zip.file('map-project.json', JSON.stringify(draft));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
}

export function packageHandlers({ json, imageInfo, candidate, addFile, hash }) {
  async function mapCandidate(bytes, sourceName, archive, files) {
    if (archive.has('map-project.json')) {
      const { draft, images, preview } = await readMapProjectPackage(bytes);
      for (const data of images.values()) await imageInfo(data);
      const center = draft.snapshot.tiles.find((tile) => tile.key === '0,0')
        .images.overall;
      const result = candidate('map', '地图工程', files, {
        mapType: 'project',
        status: 'editable',
        recoverable: ['卡片、原图、图层、区域、锁和显示偏好'],
        metadata: {
          mapType: 'project',
          projectId: draft.id,
          format: draft.format,
          version: draft.version,
          tileCount: draft.snapshot.tiles.length,
          pendingCount: draft.pending.length,
          width: center.width,
          height: center.height,
        },
        payload: {
          sourcePath: sourceName,
          sourceFormat: draft.format,
          map: {
            format: draft.format,
            version: draft.version,
            pendingPaused: true,
          },
        },
      });
      if (draft.pending.length)
        result.warnings.push('待处理生成请求保持暂停；导入不会执行生成。');
      const data = preview || images.get(center.path);
      const previewFile = addFile(
        files,
        'recovered/preview.png',
        await sharp(data, { limitInputPixels: 100_000_000 })
          .resize({
            width: 768,
            height: 768,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .png()
          .toBuffer(),
        'preview',
        'image/png',
      );
      result.payload.previewPath = previewFile.path;
      return result;
    }
    const state = archive.has('map_stitch_state.json')
      ? json(archive.get('map_stitch_state.json'))
      : null;
    if (state) {
      if (
        !(
          (state.format === 'pixelwork-map-stitch-state' &&
            [1, 2].includes(state.version)) ||
          (state.format === 'scenemaker-map-stitch-state' &&
            state.version === 5)
        )
      )
        throw new Error('不支持此地图状态格式或版本。');
      if (
        state.format.startsWith('pixelwork') &&
        (!state.source || typeof state.source.path !== 'string')
      )
        throw new Error('地图状态缺少中心图片。');
      if (
        state.format.startsWith('scenemaker') &&
        (!Array.isArray(state.tiles) || !state.tiles.length)
      )
        throw new Error('地图状态缺少卡片。');
      let references = 0,
        preview;
      const visit = async (value) => {
        if (!value || typeof value !== 'object') return;
        if (typeof value.path === 'string') {
          safeAssetPackagePath(value.path);
          const data = archive.get(value.path);
          if (!data) throw new Error(`地图状态缺少图片：${value.path}`);
          if (value.size !== undefined && value.size !== data.length)
            throw new Error('地图图片长度与清单不符。');
          if (value.generation && hash(data) !== value.generation.sha256)
            throw new Error('地图图片来源哈希不符。');
          await imageInfo(data);
          preview ||= data;
          references++;
        }
        for (const child of Object.values(value)) await visit(child);
      };
      await visit(state);
      if (!references) throw new Error('地图状态没有可恢复图片。');
      const previewFile = addFile(
        files,
        'recovered/preview.png',
        await sharp(preview, { limitInputPixels: 100_000_000 })
          .resize({
            width: 768,
            height: 768,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .png()
          .toBuffer(),
        'preview',
        'image/png',
      );
      return candidate('map', '地图工程', files, {
        mapType: 'project',
        status: 'editable',
        recoverable: ['兼容状态中的卡片、图片、区域和编辑设置'],
        warnings: ['沿用地图编辑器的兼容迁移；待处理请求保持暂停。'],
        metadata: {
          mapType: 'project',
          format: state.format,
          version: state.version,
        },
        payload: {
          sourcePath: sourceName,
          sourceFormat: state.format,
          previewPath: previewFile.path,
          map: {
            format: state.format,
            version: state.version,
            pendingPaused: true,
          },
        },
      });
    }
    throw new Error('地图包缺少受支持的源状态。');
  }
  async function pngCollection(archive, files, label) {
    const data = json(archive.get('png_manifest.json'));
    const layers = [
      'overall',
      'surface',
      'object',
      'mask',
      'black',
      'white',
      'top',
    ];
    if (
      !Array.isArray(data.layers) ||
      !data.layers.length ||
      new Set(data.layers).size !== data.layers.length ||
      data.layers.some((layer) => !layers.includes(layer)) ||
      ![data.width, data.height].every(
        (value) => Number.isInteger(value) && value > 0 && value <= 32768,
      ) ||
      ![data.originX, data.originY].every(Number.isFinite)
    )
      throw new Error('地图 PNG 集合清单无效。');
    for (const name of [
      'map_composite.png',
      ...data.layers.map((layer) => `map_${layer}.png`),
    ]) {
      const bytes = archive.get(name);
      if (!bytes) throw new Error(`地图图片集合缺少 ${name}。`);
      const info = await imageInfo(bytes);
      if (info.width !== data.width || info.height !== data.height)
        throw new Error('地图图片尺寸与清单不符。');
      addFile(files, name, bytes, 'image', 'image/png');
    }
    return candidate('map', label, files, {
      mapType: 'image',
      recoverable: ['合成图片、输出层、尺寸与原点'],
      warnings: ['图片集合不包含原始卡片、羽化前素材与完整源区域。'],
      metadata: { ...data, mapType: 'image' },
      payload: {
        primaryPath: 'map_composite.png',
        previewPath: 'map_composite.png',
        sourceFormat: 'forge-map-png-collection',
        map: { format: 'forge-map-png-collection' },
      },
    });
  }

  return {
    identifySourcePackage(bytes, name, archive, files, context) {
      if (
        archive.has('map-project.json') ||
        archive.has('map_stitch_state.json')
      )
        return mapCandidate(bytes, name, archive, files);
      if (archive.has('png_manifest.json'))
        return pngCollection(archive, files, context.label);
      return null;
    },
    async identifyOutputPackage(bytes, name, archive, files, context) {
      // Older map engine outputs carry only composed images, never a full source project.
      const mapManifestPath = [...archive.keys()].find((key) =>
        /(^|\/)(map_export|map_stitch_godot)\.json$/.test(key),
      );
      if (
        mapManifestPath ||
        (archive.has('map.png') && archive.has('map_stitch.tscn'))
      ) {
        const manifest = mapManifestPath
          ? json(archive.get(mapManifestPath))
          : {};
        const prefix =
          mapManifestPath?.slice(
            0,
            -path.posix.basename(mapManifestPath).length,
          ) || '';
        const imagePath = [
          prefix + 'assets/map_overall.png',
          prefix + 'map.png',
        ].find((key) => archive.has(key));
        if (!imagePath) throw new Error('旧地图引擎包缺少合成图片。');
        const image = addFile(
          files,
          'recovered/map.png',
          archive.get(imagePath),
          'image',
          'image/png',
        );
        const dimensions = await imageInfo(image.data);
        return candidate('map', context.label, files, {
          mapType: 'image',
          recoverable: ['地图合成图片与原引擎附件'],
          warnings: ['此引擎包缺少完整源数据，只恢复合成图片。'],
          metadata: {
            ...dimensions,
            mapType: 'image',
            format: manifest.format,
          },
          payload: {
            primaryPath: image.path,
            previewPath: image.path,
            godotPath: name,
            sourceFormat: manifest.format || 'legacy-map-output',
          },
        });
      }
      return null;
    },
  };
}
