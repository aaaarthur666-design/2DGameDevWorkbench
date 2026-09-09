import '../helpers/runtime-workspace.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import JSZip from 'jszip';
import {
  loadManifest,
  repositoryRoot,
  persistTask,
} from '../../lib/workbench/runtime.mjs';
import {
  createProject,
  createObject,
} from '../../features/interactable-editor/contract.mjs';
import {
  createScene,
  replaceMap,
} from '../../features/scene-composer/model.mjs';
import { createScenePackage } from '../../features/scene-composer/package.mjs';
export async function createImportFixtures() {
  const manifest = await loadManifest();
  const png = await sharp({
    create: { width: 128, height: 128, channels: 4, background: '#237caaff' },
  })
    .png()
    .toBuffer();
  const frame2 = await sharp({
    create: { width: 128, height: 128, channels: 4, background: '#efb849ff' },
  })
    .png()
    .toBuffer();
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  const native = {
    id: 'animation:import-job:2',
    kind: 'animation',
    title: '导入验收动画',
    jobId: 'import-job',
    candidateIndex: 2,
    candidateCount: 3,
    status: 'review_required',
    availability: 'available',
    hasArtwork: true,
    width: 128,
    height: 128,
    frameCount: 2,
    fps: 12,
    loop: false,
  };
  const mock = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/artworks')
      return res.end(
        JSON.stringify({ data: { assets: [native], issues: [] } }),
      );
    if (req.url === '/v1/jobs')
      return res.end(JSON.stringify({ data: { jobs: [] } }));
    if (req.url.startsWith('/v1/artworks/file?')) {
      const key = new URL(req.url, 'http://test').searchParams.get('key');
      res.setHeader('content-type', 'image/png');
      return res.end(key === 'frame-1' ? frame2 : png);
    }
    if (req.url.startsWith('/v1/artworks/'))
      return res.end(
        JSON.stringify({
          data: {
            asset: {
              ...native,
              files: [
                {
                  key: 'frame-1',
                  name: 'frame_001.png',
                  path: '/native/frame_001.png',
                  available: true,
                  sha256: sha(frame2),
                  bytes: frame2.length,
                },
                {
                  key: 'frame-0',
                  name: 'frame_000.png',
                  path: '/native/frame_000.png',
                  available: true,
                  sha256: sha(png),
                  bytes: png.length,
                },
              ],
            },
          },
        }),
      );
    if (req.url === '/health')
      return res.end(
        JSON.stringify({
          ok: true,
          version: 'import-fixture',
          pixellab_configured: false,
        }),
      );
    res.writeHead(404);
    res.end('{}');
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  process.env.SPRITE_PIPELINE_API_URL =
    'http://127.0.0.1:' + mock.address().port;
  const task = async (id, capabilityId, input, files, result = {}) => {
    const root = path.join(
      repositoryRoot,
      manifest.workspace.outputDirectory,
      id,
    );
    await mkdir(root, { recursive: true });
    const outputs = [];
    for (const [name, bytes] of Object.entries({
      ...files,
      'result.json': JSON.stringify(result),
    })) {
      await writeFile(path.join(root, name), bytes);
      outputs.push(manifest.workspace.outputDirectory + '/' + id + '/' + name);
    }
    const record = {
      id,
      capabilityId,
      input,
      status: 'completed',
      createdAt: '2026-09-09T09:00:00Z',
      updatedAt: '2026-09-09T09:00:00Z',
      outputs,
    };
    await persistTask(manifest, record);
    return record;
  };
  await task(
    'import-prop',
    'reference-art',
    { operation: 'generate', subject: 'prop', name: '导入验收电池' },
    { 'reference.png': png },
    { width: 128, height: 128, sha256: sha(png) },
  );
  await task(
    'import-character',
    'reference-art',
    { operation: 'generate', subject: 'character', name: '导入验收角色' },
    { 'reference.png': png },
    { width: 128, height: 128, sha256: sha(png) },
  );
  const project = createProject();
  project.name = '导入验收交互物';
  project.assets = [
    {
      id: 'battery-image',
      name: 'battery.png',
      mime: 'image/png',
      source: 'data:image/png;base64,' + png.toString('base64'),
    },
  ];
  const object = createObject('toggle');
  object.displayName = '导入验收开关';
  object.visual.assetId = 'battery-image';
  project.objects = [object];
  await task(
    'import-object',
    'interactable-editor',
    { operation: 'save-project', project },
    { 'interactable-project.json': JSON.stringify(project) },
    {
      projectId: project.projectId,
      objects: [
        { definitionId: object.definitionId, name: object.displayName },
      ],
    },
  );
  await task(
    'import-map',
    'map-stitcher',
    { operation: 'generate-origin', name: '导入验收地图' },
    { 'generated-origin.png': png },
    { width: 128, height: 128 },
  );
  const sourceZip = new JSZip()
    .file('map.png', png)
    .file(
      'map_stitch_state.json',
      JSON.stringify({
        format: 'pixelwork-map-stitch-state',
        version: 2,
        source: { path: 'map.png', fileName: 'map.png', type: 'image/png' },
        tiles: {},
      }),
    );
  const mapSource = await sourceZip.generateAsync({ type: 'nodebuffer' });
  const scene = createScene('导入验收完整场景');
  replaceMap(scene, {
    name: '导入验收地图',
    origin: { x: -128, y: 0 },
    offset: { x: 8, y: 16 },
    layers: [
      {
        id: 'map_overall',
        name: '地图',
        source: 'data:image/png;base64,' + png.toString('base64'),
        width: 128,
        height: 128,
        locked: true,
        hidden: false,
        included: true,
      },
    ],
    collisions: [
      [
        { x: -128, y: 100 },
        { x: 0, y: 100 },
        { x: 0, y: 128 },
        { x: -128, y: 128 },
      ],
    ],
    warnings: [],
    source: 'data:application/zip;base64,' + mapSource.toString('base64'),
  });
  const exportId = 'scene-export-import-fixture';
  const out = path.join(
    repositoryRoot,
    manifest.workspace.outputDirectory,
    exportId,
  );
  await mkdir(out, { recursive: true });
  await writeFile(
    path.join(out, 'scene-source.zip'),
    await createScenePackage(scene),
  );
  await writeFile(
    path.join(out, 'scene-godot.zip'),
    Buffer.from('fixture-not-an-engine-export'),
  );
  await mkdir(
    path.resolve(repositoryRoot, manifest.workspace.sceneExportDirectory),
    { recursive: true },
  );
  await writeFile(
    path.resolve(
      repositoryRoot,
      manifest.workspace.sceneExportDirectory,
      exportId + '.json',
    ),
    JSON.stringify({
      exportId,
      sceneId: scene.id,
      revision: scene.revision,
      sceneName: scene.name,
      createdAt: '2026-09-09T09:00:00Z',
      status: 'completed',
      outputs: ['scene-source.zip', 'scene-godot.zip'].map(
        (name) =>
          manifest.workspace.outputDirectory + '/' + exportId + '/' + name,
      ),
    }),
  );
  return {
    manifest,
    png,
    frame2,
    scene,
    project,
    object,
    mapSource,
    ids: {
      prop: 'reference:import-prop',
      character: 'reference:import-character',
      object: 'interactable:' + project.projectId + ':' + object.definitionId,
      map: 'map:import-map:generated-origin',
      scene: 'scene:' + exportId,
      animation: native.id,
    },
    close: () => new Promise((r) => mock.close(r)),
  };
}
