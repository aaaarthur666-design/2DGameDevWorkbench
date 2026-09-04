import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

import JSZip from 'jszip';
import sharp from 'sharp';

import {
  findCapability,
  loadManifest,
  refreshTask,
  repositoryRoot,
  runConnector,
  validateInput,
} from '../../lib/workbench/runtime.mjs';

const requests = [];
const generatedTile = await sharp({
  create: { width: 2, height: 2, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
}).png().toBuffer();
let baseUrl = '';

const server = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
  requests.push({ method: request.method, url: request.url, headers: request.headers, body });
  response.setHeader('content-type', 'application/json');

  if (request.method === 'POST' && request.url === '/v1/jobs') {
    response.statusCode = 201;
    response.end(JSON.stringify({ ok: true, data: { job: spriteJob('created') } }));
    return;
  }
  if (request.method === 'POST' && request.url === '/v1/jobs/mock-job/generate') {
    response.end(JSON.stringify({ ok: true, data: { job: spriteJob('provider_pending') } }));
    return;
  }
  if (request.method === 'GET' && request.url === '/v1/jobs/mock-job') {
    response.end(JSON.stringify({ ok: true, data: { job: spriteJob('review_required') } }));
    return;
  }
  if (
    request.method === 'GET' &&
    request.url === '/v1/jobs/mock-job/candidates/1/frames/0/image'
  ) {
    response.setHeader('content-type', 'image/png');
    response.end(generatedTile);
    return;
  }
  if (request.method === 'POST' && request.url === '/map') {
    response.end(JSON.stringify({
      url: body.prompt === 'unsafe foreign URL'
        ? 'http://127.0.0.1:1/private.png'
        : `${baseUrl}/generated.png`,
    }));
    return;
  }
  if (request.method === 'GET' && request.url === '/generated.png') {
    response.setHeader('content-type', 'image/png');
    response.end(generatedTile);
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ ok: false, error: { message: 'not found' } }));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address === 'object');
baseUrl = `http://127.0.0.1:${address.port}`;
const previousSpriteUrl = process.env.SPRITE_PIPELINE_API_URL;
const previousMapUrl = process.env.MAP_STITCHER_API_URL;
process.env.SPRITE_PIPELINE_API_URL = baseUrl;
process.env.MAP_STITCHER_API_URL = `${baseUrl}/map`;

try {
  const manifest = await loadManifest();
  const sprite = findCapability(manifest, 'sprite-generator');
  const map = findCapability(manifest, 'map-stitcher');

  assert.deepEqual(
    validateInput(sprite, {
      operation: 'create-and-generate',
      characterId: 'diagnostic_dummy',
      actionId: 'idle',
      provider: 'fixture',
    }),
    [],
  );
  assert(validateInput(sprite, { operation: 'create' }).length >= 2);

  const spriteResult = await runConnector(manifest, sprite, {
    operation: 'create-and-generate',
    characterId: 'diagnostic_dummy',
    actionId: 'idle',
    provider: 'fixture',
    candidateCount: 1,
    frameCount: 1,
  });
  assert.equal(spriteResult.task.status, 'running');
  assert.equal(spriteResult.task.adapter.remoteJobId, 'mock-job');
  const createRequest = requests.find((item) => item.url === '/v1/jobs');
  assert.equal(createRequest.body.character_id, 'diagnostic_dummy');
  assert.equal(createRequest.body.action_id, 'idle');
  assert.equal(createRequest.body.candidate_count, 1);
  assert.equal(createRequest.body.frame_count, 1);
  assert.equal('taskId' in createRequest.body, false);
  assert.equal(createRequest.headers['idempotency-key'], spriteResult.task.id);

  const refreshedSprite = await refreshTask(manifest, spriteResult.task.id);
  assert.equal(refreshedSprite.task.id, spriteResult.task.id);
  assert.equal(refreshedSprite.task.status, 'attention_required');
  assert.equal(refreshedSprite.task.adapter.remoteStatus, 'review_required');
  const frameOutput = refreshedSprite.task.outputs.find((output) =>
    output.endsWith('/frames/candidate-01/frame-000.png'),
  );
  assert(frameOutput);
  assert(frameOutput.startsWith(`outputs/${spriteResult.task.id}/`));
  const frameMetadata = await sharp(path.resolve(repositoryRoot, frameOutput)).metadata();
  assert.equal(frameMetadata.width, 2);
  assert.equal(frameMetadata.height, 2);

  const blue = await solidPng(0, 80, 220);
  const green = await solidPng(0, 190, 90);
  const composeResult = await runConnector(manifest, map, {
    operation: 'compose',
    images: [dataUrl(blue), dataUrl(green)],
    columns: 2,
    tileSize: 4,
    checkSeams: true,
    regions: [
      {
        id: 'collision_test',
        tileKey: '0,0',
        mapLayer: 'overall',
        layer: 'collision',
        mode: 'rectangle',
        points: [{ x: 0, y: 0 }, { x: 2, y: 2 }],
      },
    ],
    engineTargets: ['godot', 'unity'],
  });
  assert.equal(composeResult.task.status, 'completed');
  for (const suffix of [
    'stitched-map.png',
    'seam-report.json',
    'pixelwork-state.zip',
    'godot-package.zip',
    'unity-package.zip',
  ]) {
    assert(composeResult.task.outputs.some((output) => output.endsWith(suffix)), `missing ${suffix}`);
  }
  const stitchedPath = outputPath(composeResult.task.outputs, 'stitched-map.png');
  const metadata = await sharp(stitchedPath).metadata();
  assert.equal(metadata.width, 8);
  assert.equal(metadata.height, 4);
  const statePath = outputPath(composeResult.task.outputs, 'pixelwork-state.zip');
  const stateZip = await JSZip.loadAsync(await readFile(statePath));
  const state = JSON.parse(await stateZip.file('map_stitch_state.json').async('string'));
  assert.equal(state.version, 2);
  assert.equal(state.format, 'pixelwork-map-stitch-state');
  assert.equal(state.drawShapes.length, 1);

  const generationResult = await runConnector(manifest, map, {
    operation: 'generate-layer',
    image: dataUrl(blue),
    prompt: 'extend the test tile',
    tile: { key: '1,0', x: 1, y: 0, w: 1, h: 1 },
    layer: 'overall',
    mask_mode: 'white',
  });
  assert.equal(generationResult.task.status, 'completed');
  assert(generationResult.task.outputs.some((output) => output.endsWith('generated-layer.png')));
  const mapRequest = requests.find((item) => item.url === '/map');
  assert.deepEqual(Object.keys(mapRequest.body).sort(), ['image', 'layer', 'mask_mode', 'prompt', 'tile']);
  assert.equal(mapRequest.body.layer, 'overall');

  await assert.rejects(
    runConnector(manifest, map, {
      operation: 'generate-layer',
      image: dataUrl(blue),
      prompt: 'unsafe foreign URL',
      tile: { key: '1,0', x: 1, y: 0, w: 1, h: 1 },
      layer: 'overall',
      mask_mode: 'white',
    }),
    /image URL must use the connector origin/,
  );

  process.stdout.write(`${JSON.stringify({
    spriteAdapter: 'ok',
    mapComposeAdapter: 'ok',
    mapGenerationContract: 'ok',
    spriteTaskId: refreshedSprite.task.id,
    mapTaskId: composeResult.task.id,
    outputs: composeResult.task.outputs,
  }, null, 2)}\n`);
} finally {
  if (previousSpriteUrl === undefined) delete process.env.SPRITE_PIPELINE_API_URL;
  else process.env.SPRITE_PIPELINE_API_URL = previousSpriteUrl;
  if (previousMapUrl === undefined) delete process.env.MAP_STITCHER_API_URL;
  else process.env.MAP_STITCHER_API_URL = previousMapUrl;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function spriteJob(status) {
  return {
    job_id: 'mock-job',
    status,
    revision: 2,
    candidates: [
      {
        candidate_index: 1,
        frames: [
          {
            index: 0,
            active_path: 'candidates/candidate_01/frames/frame_000.png',
          },
        ],
      },
    ],
    export: null,
  };
}

async function solidPng(r, g, b) {
  return sharp({
    create: { width: 2, height: 2, channels: 4, background: { r, g, b, alpha: 1 } },
  }).png().toBuffer();
}

function dataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

function outputPath(outputs, suffix) {
  const relative = outputs.find((output) => output.endsWith(suffix));
  assert(relative, `missing ${suffix}`);
  return path.resolve(repositoryRoot, relative);
}
