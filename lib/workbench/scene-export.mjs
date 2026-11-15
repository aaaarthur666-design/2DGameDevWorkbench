import { mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  readScenePackage,
  MAX_PACKAGE_BYTES,
} from '../../features/scene-composer/package.mjs';
import { buildSceneGodotPackage } from '../../features/scene-composer/godot-builder.mjs';
import { loadManifest } from './runtime.mjs';

export async function exportSceneRequest(request, repositoryRoot, manifest) {
  manifest ||= await loadManifest();
  if (
    (request.headers['content-type'] || '').split(';')[0] !== 'application/zip'
  )
    throw new Error('请上传场景源 ZIP。');
  let total = 0;
  const chunks = [];
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_PACKAGE_BYTES) throw new Error('场景包超过 256 MB。');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const scene = await readScenePackage(bytes);
  const result = await buildSceneGodotPackage(scene, { repositoryRoot });
  const exportId = `scene-export-${randomUUID()}`;
  const outputDirectory = manifest.workspace.outputDirectory;
  const directory = path.join(repositoryRoot, outputDirectory, exportId);
  const records = path.join(repositoryRoot, manifest.workspace.sceneExportDirectory);
  await mkdir(directory, { recursive: true });
  await mkdir(records, { recursive: true });
  await writeFile(path.join(directory, 'scene-source.zip'), bytes);
  await writeFile(path.join(directory, 'scene-godot.zip.tmp'), result.bytes);
  await rename(
    path.join(directory, 'scene-godot.zip.tmp'),
    path.join(directory, 'scene-godot.zip'),
  );
  const record = {
    exportId,
    sceneId: scene.id,
    sceneName: scene.name,
    instanceCount: scene.instances.length,
    materialCount: scene.materials.length,
    mapName: scene.map?.name || null,
    revision: scene.revision,
    status: 'completed',
    createdAt: new Date().toISOString(),
    outputs: [
      `${outputDirectory}/${exportId}/scene-godot.zip`,
      `${outputDirectory}/${exportId}/scene-source.zip`,
    ],
    scenePath: result.scenePath,
  };
  await writeFile(
    path.join(records, `${exportId}.json.tmp`),
    JSON.stringify(record, null, 2),
  );
  await rename(path.join(records, `${exportId}.json.tmp`), path.join(records, `${exportId}.json`));
  return record;
}
