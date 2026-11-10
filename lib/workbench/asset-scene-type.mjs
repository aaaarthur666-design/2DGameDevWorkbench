import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import JSZip from 'jszip';
import {
  readScenePackage,
  createScenePackage,
} from '../../features/scene-composer/package.mjs';
import { safeAssetPackagePath } from './asset-packages-zip.mjs';

// Scene exports have their own durable records, not fabricated production tasks.
async function sceneRecords(
  root,
  manifest,
  issues,
  { confined, readJson, safeId },
) {
  const directory = path.resolve(root, manifest.workspace.sceneExportDirectory);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (e) {
    if (e.code !== 'ENOENT')
      issues.push({
        source: 'scene-exports',
        message: '场景导出目录暂不可读。',
      });
    return [];
  }
  const rows = [];
  for (const entry of entries.filter(
    (e) => e.isFile() && /^scene-export-[a-z0-9_-]+\.json$/i.test(e.name),
  )) {
    try {
      const record = await readJson(
        await confined(directory, path.join(directory, entry.name)),
        1024 * 1024,
      );
      if (
        !safeId(record.exportId) ||
        entry.name !== `${record.exportId}.json` ||
        typeof record.sceneId !== 'string' ||
        !/^[a-z0-9_-]{1,100}$/i.test(record.sceneId) ||
        !Number.isInteger(record.revision) ||
        record.revision < 0 ||
        record.status !== 'completed' ||
        !Array.isArray(record.outputs) ||
        !record.outputs.every((p) => typeof p === 'string')
      )
        throw new Error();
      const files = ['scene-source.zip', 'scene-godot.zip'].map(
        (name) =>
          `${manifest.workspace.outputDirectory}/${record.exportId}/${name}`,
      );
      if (!files.every((f) => record.outputs.includes(f))) throw new Error();
      rows.push({ ...record, id: record.exportId, outputs: files });
    } catch {
      issues.push({
        source: 'scene-exports',
        record: entry.name,
        message: '场景导出记录损坏或身份不匹配。',
      });
    }
  }
  return rows.sort((a, b) => a.exportId.localeCompare(b.exportId));
}

async function sceneMetadata(manifest, record, { taskFile }) {
  if (typeof record.sceneName === 'string') return record;
  // Legacy exports did not persist display metadata. Read it from their saved source ZIP.
  const file = await taskFile(manifest, record, record.outputs[0]);
  if (!file.available) return {};
  const zip = await JSZip.loadAsync(await readFile(file.absolutePath));
  const source = zip.file('scene.json');
  if (!source || source._data.uncompressedSize > 8 * 1024 * 1024)
    throw new Error('场景元数据不可读取。');
  const scene = JSON.parse(await source.async('string'));
  if (
    scene.format !== 'workbench-scene' ||
    scene.id !== record.sceneId ||
    scene.revision !== record.revision
  )
    throw new Error('场景身份不匹配。');
  return {
    sceneName: typeof scene.name === 'string' ? scene.name : undefined,
    instanceCount: Array.isArray(scene.instances)
      ? scene.instances.length
      : undefined,
    materialCount: Array.isArray(scene.materials)
      ? scene.materials.length
      : undefined,
    mapName: typeof scene.map?.name === 'string' ? scene.map.name : undefined,
  };
}

export async function scanCatalog(root, manifest, issues, helpers) {
  const { taskFile } = helpers;
  const scenes = await sceneRecords(root, manifest, issues, helpers);
  const rows = [];
  for (const record of scenes) {
    let metadata = {};
    try {
      metadata = await sceneMetadata(manifest, record, helpers);
    } catch {
      issues.push({
        source: 'scene-exports',
        record: record.exportId,
        message: '场景源包元数据不可读取，请检查源文件。',
      });
    }
    const files = await Promise.all(
      record.outputs.map((file) => taskFile(manifest, record, file)),
    );
    rows.push({
      record,
      asset: {
        id: `scene:${record.exportId}`,
        kind: 'scene',
        origin: 'scene-export',
        exportId: record.exportId,
        sceneId: record.sceneId,
        sceneRevision: record.revision,
        title: metadata.sceneName || `完整场景 · ${record.sceneId}`,
        instanceCount: metadata.instanceCount,
        materialCount: metadata.materialCount,
        mapName: metadata.mapName,
        createdAt: record.createdAt,
        updatedAt: record.createdAt,
        status: 'exported',
        files: record.outputs,
        primary: record.outputs[0],
        hasArtwork: true,
        previewKind: 'none',
        availability: files.every((f) => f.available) ? 'available' : 'missing',
        taskIds: [],
      },
    });
  }
  return rows;
}

export async function editableCopy(bytes, { allocate, copy }) {
  const scene = await readScenePackage(bytes);
  scene.id = allocate(scene.id, 'scene');
  scene.revision = 0;
  for (const material of scene.materials)
    material.project.projectId = allocate(
      material.project.projectId,
      'project',
    );
  if (scene.map?.source?.startsWith('data:application/zip;base64,')) {
    const source = Buffer.from(
      scene.map.source.slice(scene.map.source.indexOf(',') + 1),
      'base64',
    );
    scene.map.source = `data:application/zip;base64,${Buffer.from(await copy(source, 'map')).toString('base64')}`;
  }
  return Buffer.from(await createScenePackage(scene));
}

export function packageHandlers({
  json,
  identifyZip,
  fileRecord,
  validateProject,
  candidate,
  addFile,
  dataBytes,
}) {
  async function sceneCandidate(bytes, sourceName, archive, files, context) {
    const manifest = json(archive.get('scene.json'));
    // Validate the embedded map container before the browser-compatible reader decodes it.
    if (manifest.map?.source) {
      safeAssetPackagePath(manifest.map.source);
      const mapBytes = archive.get(manifest.map.source);
      if (!mapBytes) throw new Error('场景缺少地图源包。');
      const map = await identifyZip(
        mapBytes,
        'scene-map-source.zip',
        [
          fileRecord(
            'scene-map-source.zip',
            mapBytes,
            'source',
            'application/zip',
          ),
        ],
        { ...context, depth: context.depth + 1 },
      );
      if (map.kind !== 'map')
        throw new Error('场景内嵌地图不是可识别的地图源或地图输出。');
    }
    const scene = await readScenePackage(bytes);
    for (const material of scene.materials)
      await validateProject(material.project);
    const result = candidate('scene', scene.name, files, {
      status: 'editable',
      recoverable: ['地图、物件素材、实例、排列与联动'],
      metadata: {
        sceneId: scene.id,
        sceneRevision: scene.revision,
        instanceCount: scene.instances.length,
        materialCount: scene.materials.length,
        mapName: scene.map?.name,
      },
      payload: {
        sourcePath: sourceName,
        sourceFormat: 'workbench-scene',
        scene: { id: scene.id, revision: scene.revision },
      },
    });
    const layer = scene.map?.layers[0];
    if (layer) {
      const preview = addFile(
        files,
        'recovered/preview.png',
        await sharp(dataBytes(layer.source, 'image/png'), {
          limitInputPixels: 100_000_000,
        })
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
      result.payload.previewPath = preview.path;
    }
    return result;
  }

  return {
    identifySourcePackage(bytes, name, archive, files, context) {
      return archive.has('scene.json')
        ? sceneCandidate(bytes, name, archive, files, context)
        : null;
    },
  };
}
