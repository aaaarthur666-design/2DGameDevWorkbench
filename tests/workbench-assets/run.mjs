import '../helpers/runtime-workspace.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  loadManifest,
  agentRequest,
  persistTask,
  repositoryRoot,
} from '../../lib/workbench/runtime.mjs';
import {
  readAssetPreview,
  buildAssetArchive,
} from '../../lib/workbench/asset-catalog.mjs';

let offline = false;
let changeNativeBytes = false;
const nativePng = await sharp({
  create: { width: 128, height: 128, channels: 4, background: '#abcdef' },
})
  .png()
  .toBuffer();
const nativeSha = createHash('sha256').update(nativePng).digest('hex');
const nativeGodot = await new JSZip().file('forge_sprites/fixture/sprite_frames.tres', '[gd_resource type="SpriteFrames" format=3]').generateAsync({type: 'nodebuffer'});
const nativeGodotSha = createHash('sha256').update(nativeGodot).digest('hex');
const nativeAssets = [1, 2, 3].map((candidateIndex) => ({
  id: `animation:original-job:${candidateIndex}`,
  kind: 'animation',
  title: '骑士 · 攻击',
  characterId: 'knight',
  actionId: 'attack',
  jobId: 'original-job',
  candidateIndex,
  candidateCount: 3,
  frameCount: 17,
  status: 'review_required',
  statusLabel: '待检查',
  createdAt: '2026-08-01',
  updatedAt: '2026-08-02',
  availability: 'available',
  previewKind: 'animation',
  hasArtwork: true,
}));
nativeAssets.push({
  id: 'character:transferred',
  kind: 'character',
  characterId: 'transferred',
  title: '已移送骑士',
  createdAt: '2026-08-01',
  updatedAt: '2026-08-01',
  availability: 'available',
  status: 'saved',
  hasArtwork: true,
});
const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (offline) {
    res.writeHead(503);
    res.end('{}');
    return;
  }
  if (req.url === '/v1/artworks') {
    res.end(JSON.stringify({ data: { assets: nativeAssets, issues: [] } }));
    return;
  }
  if (req.url.startsWith('/v1/artworks/file?')) {
    const query = new URL(req.url, 'http://localhost').searchParams;
    if (
      !nativeAssets.some((a) => a.id === query.get('asset_id')) ||
      !['frame-0', 'godot'].includes(query.get('key'))
    ) {
      res.writeHead(404);
      res.end('{}');
      return;
    }
    res.setHeader('Content-Type', query.get('key') === 'godot' ? 'application/zip' : 'image/png');
    res.end(changeNativeBytes ? Buffer.from('changed') : query.get('key') === 'godot' ? nativeGodot : nativePng);
    return;
  }
  const id = decodeURIComponent(req.url.slice('/v1/artworks/'.length));
  const asset = nativeAssets.find((a) => a.id === id);
  if (!asset) {
    res.writeHead(404);
    res.end('{}');
    return;
  }
  res.end(
    JSON.stringify({
      data: {
        asset: {
          ...asset,
          width: 128,
          height: 128,
          files: [
            { key: 'godot', path: '/native/existing/sprite.godot.zip', name: 'sprite.godot.zip', bytes: nativeGodot.length, sha256: nativeGodotSha, available: true },
            {
              key: 'frame-0',
              path: '/native/existing/frame.png',
              name: 'frame_000.png',
              bytes: nativePng.length,
              sha256: nativeSha,
              available: true,
            },
            {
              key: 'preview',
              name: 'frame_000.png',
              path: '/native/existing/frame.png',
              bytes: nativePng.length,
              sha256: nativeSha,
              available: true,
            },
          ],
        },
      },
    }),
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
process.env.SPRITE_PIPELINE_API_URL = `http://127.0.0.1:${server.address().port}`;
const manifest = await loadManifest();
let client;
let bridge;
try {
  async function task(
    id,
    capabilityId,
    input,
    files = {},
    timestamp = '2026-01-01',
  ) {
    const output = path.join(
      repositoryRoot,
      manifest.workspace.outputDirectory,
      id,
    );
    await mkdir(output, { recursive: true });
    for (const [name, bytes] of Object.entries(files))
      await writeFile(path.join(output, name), bytes);
    const record = {
      schemaVersion: 1,
      id,
      capabilityId,
      input,
      status: Object.keys(files).length ? 'completed' : 'prepared',
      outputs: Object.keys(files).map(
        (name) => `${manifest.workspace.outputDirectory}/${id}/${name}`,
      ),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await persistTask(manifest, record);
    return record;
  }
  const png = await sharp({
    create: { width: 128, height: 128, channels: 4, background: '#123456' },
  })
    .png()
    .toBuffer();
  const original = await task(
    'reference-original',
    'reference-art',
    { operation: 'generate', name: '最早的骑士' },
    { 'reference.png': png },
  );
  await task(
    'transfer-original',
    'reference-art',
    { operation: 'transfer', sourceTaskId: original.id },
    { 'result.json': JSON.stringify({ characterId: 'transferred' }) },
  );
  for (let i = 0; i < 205; i++)
    await task(
      `empty-${i}`,
      'sprite-generator',
      { operation: 'create', provider: 'fixture' },
      {},
      '2026-09-01',
    );
  const project = {
    projectId: 'door-project',
    name: '门',
    assets: [],
    objects: [
      {
        definitionId: 'door',
        displayName: '木门',
        visual: { width: 64, height: 80 },
        behavior: { kind: 'toggle' },
      },
      {
        definitionId: 'removed',
        displayName: '旧门',
        visual: {},
        behavior: { kind: 'toggle' },
      },
    ],
  };
  await task(
    'old-project',
    'interactable-editor',
    { operation: 'export-godot', project },
    {
      'interactable-project.json': JSON.stringify(project),
      'interactables.zip': 'old export',
    },
  );
  const currentProject = { ...project, objects: project.objects.slice(0, 1) };
  await task(
    'new-project',
    'interactable-editor',
    { operation: 'save-project', project: currentProject },
    { 'interactable-project.json': JSON.stringify(currentProject) },
    '2026-07-01',
  );
  const taskDirectory = path.join(
    repositoryRoot,
    manifest.workspace.taskDirectory,
  );
  const before = await readdir(taskDirectory);
  const first = await agentRequest(manifest, 'assets', { limit: 2 });
  assert.equal(first.total, 5); // one linked reference, three candidates, one current object
  assert.equal(first.coverage.runtimeRecords, 209);
  const second = await agentRequest(manifest, 'assets', {
    limit: 2,
    offset: first.nextOffset,
    snapshot: first.snapshot,
  });
  assert(!first.assets.some((a) => second.assets.some((b) => b.id === a.id)));
  const old = await agentRequest(manifest, 'assets', { query: '最早的骑士' });
  assert.equal(old.assets[0].id, 'reference:reference-original');
  assert.equal(old.assets[0].characterId, 'transferred');
  const selected = await agentRequest(manifest, 'assets', {
    kind: 'animation',
    candidateCount: 3,
    candidateIndex: 2,
    limit: 1,
  });
  assert.equal(selected.total, 1);
  assert.match(selected.assets[0].editorPath, /job=original-job&candidate=2$/);
  const detail = await agentRequest(manifest, 'asset', {
    assetId: 'character:transferred',
  });
  assert.equal(detail.asset.id, 'reference:reference-original');
  assert.equal(detail.asset.width, 128);
  assert.equal(detail.asset.files[0].sha256.length, 64);
  const handoff = await agentRequest(manifest, 'asset-manifest', {
    assetIds: [
      'reference:reference-original',
      'character:transferred',
      selected.assets[0].id,
      'interactable:door-project:door',
    ],
  });
  assert.equal(handoff.manifest.assets.length, 3);
  assert.equal(handoff.manifest.engineValidated, false);
  assert(
    handoff.manifest.assets
      .find((a) => a.kind === 'interactable')
      .readiness.issues.some((i) => i.includes('逻辑')),
  );
  assert.equal(
    handoff.manifest.assets.find((a) => a.kind === 'interactable').status,
    'saved',
  );
  assert.deepEqual((await readdir(taskDirectory)).sort(), before.sort());
  assert(
    (
      await readAssetPreview(manifest, 'reference:reference-original')
    ).bytes.equals(png),
  );
  const mapZip = new JSZip();
  mapZip.file('map.png', png);
  const mapBytes = await mapZip.generateAsync({ type: 'nodebuffer' });
  await task(
    'saved-map',
    'map-stitcher',
    { operation: 'compose' },
    { 'stitched-map.png': png, 'godot-package.zip': mapBytes },
  );
  const archiveIds = [
    'reference:reference-original',
    'character:transferred',
    'animation:original-job:1',
    'animation:original-job:2',
    'interactable:door-project:door',
    'map:saved-map:stitched-map',
  ];
  const beforeArchive = await readdir(taskDirectory);
  const archive = await buildAssetArchive(manifest, { assetIds: archiveIds });
  assert.equal(archive.assetCount, 5);
  const zip = await JSZip.loadAsync(archive.bytes, { checkCRC32: true });
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  assert.equal(
    entries.filter((f) => f.name.endsWith('/frames/frame_000.png')).length,
    2,
  );
  for (const frame of entries.filter((f) =>
    f.name.endsWith('/frames/frame_000.png'),
  ))
    assert((await frame.async('nodebuffer')).equals(nativePng));
  assert(
    (
      await entries
        .find((f) => f.name.endsWith('/reference.png'))
        .async('nodebuffer')
    ).equals(png),
  );
  assert(
    (
      await entries.find((f) => f.name.endsWith('/map.png')).async('nodebuffer')
    ).equals(png),
  );
  assert(
    (
      await entries
        .find((f) => f.name.endsWith('/godot-package.zip'))
        .async('nodebuffer')
    ).equals(mapBytes),
  );
  assert.deepEqual(
    JSON.parse(
      await entries
        .find((f) => f.name.endsWith('/interactable-project.json'))
        .async('string'),
    ),
    currentProject,
  );
  assert(!entries.some((f) => /manifest|result\.json|qa\.json/.test(f.name)));
  assert(!entries.some((f) => f.name.includes('..') || f.name.startsWith('/')));
  assert.deepEqual((await readdir(taskDirectory)).sort(), beforeArchive.sort());
  changeNativeBytes = true;
  await assert.rejects(
    buildAssetArchive(manifest, { assetIds: ['animation:original-job:2'] }),
    /发生变化/,
  );
  changeNativeBytes = false;
  await assert.rejects(buildAssetArchive(manifest, { assetIds: [] }));
  const bad = { ...original, id: 'escape-original', outputs: original.outputs };
  await persistTask(manifest, bad);
  const escaped = await agentRequest(manifest, 'asset', {
    assetId: 'reference:escape-original',
  });
  assert.equal(escaped.asset.files[0].available, false);
  await assert.rejects(readAssetPreview(manifest, 'reference:escape-original'));
  await assert.rejects(
    buildAssetArchive(manifest, { assetIds: ['reference:escape-original'] }),
    /缺失|不可读取/,
  );
  await assert.rejects(
    agentRequest(manifest, 'assets', { snapshot: first.snapshot }),
  );
  await assert.rejects(
    agentRequest(manifest, 'assets', { candidateIndex: '2' }),
  );
  await assert.rejects(
    agentRequest(manifest, 'asset-manifest', { assetIds: [] }),
  );
  await assert.rejects(
    agentRequest(manifest, 'asset', { assetId: 'does-not-exist' }),
  );
  const oldRevision = detail.asset.revision;
  await writeFile(
    path.join(repositoryRoot, original.outputs[0]),
    await sharp(png).negate().png().toBuffer(),
  );
  assert.notEqual(
    (await agentRequest(manifest, 'asset', { assetId: detail.asset.id })).asset
      .revision,
    oldRevision,
  );
  await unlink(path.join(repositoryRoot, original.outputs[0]));
  assert.equal(
    (await agentRequest(manifest, 'asset', { assetId: detail.asset.id })).asset
      .readiness.filesAvailable,
    false,
  );
  await assert.rejects(
    buildAssetArchive(manifest, { assetIds: ['reference:reference-original'] }),
    /缺失|不可读取/,
  );
  offline = true;
  const partial = await agentRequest(manifest, 'assets', {});
  assert.equal(partial.coverage.complete, false);
  assert(
    partial.assets.some(
      (a) => a.id === detail.asset.id && a.availability === 'missing',
    ),
  );
  offline = false;
  client = new Client({ name: 'asset-inventory-test', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['scripts/workbench-mcp.mjs'],
      cwd: repositoryRoot,
      env: { ...process.env },
      stderr: 'pipe',
    }),
  );
  const tools = await client.listTools();
  for (const name of [
    'workbench_list_assets',
    'workbench_get_asset',
    'workbench_get_asset_manifest',
  ])
    assert.equal(
      tools.tools.find((t) => t.name === name).annotations.readOnlyHint,
      true,
    );
  const response = await client.callTool({
    name: 'workbench_list_assets',
    arguments: { candidateCount: 3, candidateIndex: 2 },
  });
  assert.equal(response.structuredContent.assets[0].id, selected.assets[0].id);
  const serverPort = await new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
  bridge = spawn(process.execPath, ['scripts/workbench-http.mjs'], {
    cwd: repositoryRoot,
    env: { ...process.env, WORKBENCH_RUNTIME_PORT: String(serverPort) },
    stdio: 'ignore',
    windowsHide: true,
  });
  const base = `http://127.0.0.1:${serverPort}`;
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(base + '/health')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const httpResult = await fetch(base + '/v1/agent/assets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ candidateCount: 3, candidateIndex: 2 }),
  });
  assert.equal(httpResult.status, 200);
  assert.deepEqual(
    (await httpResult.json()).assets,
    response.structuredContent.assets,
  );
  const download = await fetch(base + '/v1/assets/download', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assetIds: ['animation:original-job:2'] }),
  });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/zip');
  assert.match(download.headers.get('content-disposition'), /forge-assets.zip/);
  const downloadedZip = await JSZip.loadAsync(await download.arrayBuffer(), {
    checkCRC32: true,
  });
  assert.equal(
    Object.values(downloadedZip.files).filter((f) =>
      f.name.endsWith('/frames/frame_000.png'),
    ).length,
    1,
  );
  const packagedGodot = Object.values(downloadedZip.files).find((file) => file.name.endsWith('/godot/sprite-frames.zip'));
  assert(packagedGodot);
  assert.deepEqual(await packagedGodot.async('nodebuffer'), nativeGodot);
  const invalidDownload = await fetch(base + '/v1/assets/download', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assetIds: ['reference:escape-original'] }),
  });
  assert.equal(invalidDownload.status, 400);
  console.log(
    'Assets: complete record scan, pagination, exact candidates, provenance deduplication, project revisions, file hashes, missing/escaped files, offline coverage, MCP/HTTP parity and actual ZIP bytes/candidate isolation/download errors passed; zero generation.',
  );
} finally {
  await client?.close();
  bridge?.kill();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
