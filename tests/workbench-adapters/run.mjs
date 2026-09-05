import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

import JSZip from 'jszip';
import sharp from 'sharp';
import { preserveMapTemplatePixels } from '../../lib/workbench/adapters/map-generation-image.mjs';

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
  create: {
    width: 2,
    height: 2,
    channels: 4,
    background: { r: 10, g: 20, b: 30, alpha: 1 },
  },
})
  .png()
  .toBuffer();
let baseUrl = '';

const server = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks);
  const contentType = request.headers['content-type'] ?? '';
  const body =
    rawBody.length && contentType.includes('application/json')
      ? JSON.parse(rawBody.toString('utf8'))
      : null;
  requests.push({
    method: request.method,
    url: request.url,
    headers: request.headers,
    body,
    rawBody,
  });
  response.setHeader('content-type', 'application/json');

  if (request.method === 'POST' && request.url === '/v1/jobs') {
    response.statusCode = 201;
    response.end(
      JSON.stringify({ ok: true, data: { job: spriteJob('created') } }),
    );
    return;
  }
  if (
    request.method === 'POST' &&
    request.url === '/v1/jobs/mock-job/generate'
  ) {
    response.end(
      JSON.stringify({
        ok: true,
        data: { job: spriteJob('provider_pending') },
      }),
    );
    return;
  }
  if (request.method === 'GET' && request.url === '/v1/jobs/mock-job') {
    response.end(
      JSON.stringify({ ok: true, data: { job: spriteJob('review_required') } }),
    );
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
  if (
    request.method === 'POST' &&
    [
      '/v1/jobs/mock-job/candidates/1/recover',
      '/v1/jobs/mock-job/candidates/1/attach-provider-job',
    ].includes(request.url)
  ) {
    response.end(
      JSON.stringify({ ok: true, data: { job: spriteJob('review_required') } }),
    );
    return;
  }
  if (request.method === 'POST' && request.url === '/gemini') {
    response.end(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'image/png',
                    data: generatedTile.toString('base64'),
                  },
                },
              ],
            },
          },
        ],
      }),
    );
    return;
  }
  if (request.method === 'POST' && request.url === '/openai') {
    response.end(
      JSON.stringify({
        data: [{ b64_json: generatedTile.toString('base64') }],
      }),
    );
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
const previousGeminiUrl = process.env.MAP_STITCHER_GEMINI_API_URL;
const previousOpenAIUrl = process.env.MAP_STITCHER_OPENAI_API_URL;
const previousGeminiKey = process.env.GEMINI_API_KEY;
const previousOpenAIKey = process.env.OPENAI_API_KEY;
process.env.SPRITE_PIPELINE_API_URL = baseUrl;
process.env.MAP_STITCHER_GEMINI_API_URL = `${baseUrl}/gemini`;
process.env.MAP_STITCHER_OPENAI_API_URL = `${baseUrl}/openai`;
process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.OPENAI_API_KEY = 'test-openai-key';

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
  const frameMetadata = await sharp(
    path.resolve(repositoryRoot, frameOutput),
  ).metadata();
  assert.equal(frameMetadata.width, 2);
  assert.equal(frameMetadata.height, 2);

  const submissionCount = requests.filter(
    (r) => r.url === '/v1/jobs' || r.url.endsWith('/generate'),
  ).length;
  for (const operation of ['recover', 'attach-provider-job']) {
    const recovered = await runConnector(manifest, sprite, {
      operation,
      jobId: 'mock-job',
      candidateIndex: 1,
      ...(operation === 'attach-provider-job'
        ? { providerJobId: 'existing-provider-job' }
        : {}),
    });
    assert.equal(recovered.task.adapter.remoteJobId, 'mock-job');
  }
  assert.equal(
    requests.filter((r) => r.url === '/v1/jobs' || r.url.endsWith('/generate'))
      .length,
    submissionCount,
  );
  assert.deepEqual(
    requests.find((r) => r.url.endsWith('/attach-provider-job')).body,
    { provider_job_id: 'existing-provider-job' },
  );
  assert(
    validateInput(sprite, {
      operation: 'approve',
      jobId: 'mock-job',
      candidateIndex: 1,
    }).length > 0,
  );
  assert(
    validateInput(sprite, {
      operation: 'review-frame',
      jobId: 'mock-job',
      candidateIndex: 1,
      frameIndex: 0,
      reviewStatus: 'repair_requested',
      issueType: 'made_up',
    }).length > 0,
  );
  const blue = await solidPng(0, 80, 220);
  const green = await solidPng(0, 190, 90);
  assert(
    validateInput(map, {
      operation: 'compose',
      images: [dataUrl(blue)],
      engineTargets: ['unity'],
    }).length > 0,
  );
  assert.equal(map.outputs.includes('unityPackage'), false);
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
        points: [
          { x: 0, y: 0 },
          { x: 2, y: 2 },
        ],
      },
    ],
    engineTargets: ['godot'],
  });
  assert.equal(composeResult.task.status, 'completed');
  for (const suffix of [
    'stitched-map.png',
    'seam-report.json',
    'pixelwork-state.zip',
    'godot-package.zip',
  ]) {
    assert(
      composeResult.task.outputs.some((output) => output.endsWith(suffix)),
      `missing ${suffix}`,
    );
  }
  assert.equal(
    composeResult.task.outputs.some((output) => /unity/i.test(output)),
    false,
  );
  const stitchedPath = outputPath(
    composeResult.task.outputs,
    'stitched-map.png',
  );
  const metadata = await sharp(stitchedPath).metadata();
  assert.equal(metadata.width, 8);
  assert.equal(metadata.height, 4);
  const statePath = outputPath(
    composeResult.task.outputs,
    'pixelwork-state.zip',
  );
  const stateZip = await JSZip.loadAsync(await readFile(statePath));
  const state = JSON.parse(
    await stateZip.file('map_stitch_state.json').async('string'),
  );
  assert.equal(state.version, 2);
  assert.equal(state.format, 'pixelwork-map-stitch-state');
  assert.equal(state.drawShapes.length, 1);
  const godotZip = await JSZip.loadAsync(
    await readFile(outputPath(composeResult.task.outputs, 'godot-package.zip')),
  );
  const godotSource = await JSZip.loadAsync(
    await godotZip.file('source_state.zip').async('nodebuffer'),
  );
  assert.deepEqual(
    JSON.parse(await godotSource.file('map_stitch_state.json').async('string')),
    state,
  );

  const templatePixels = Buffer.from([
    0, 0, 0, 255, 255, 255, 255, 255, 50, 60, 70, 128, 0, 0, 0, 0,
  ]);
  const generationTemplate = await sharp(templatePixels, {
    raw: { width: 2, height: 2, channels: 4 },
  })
    .png()
    .toBuffer();
  const expectedGenerated = Buffer.from([
    0, 0, 0, 255, 255, 255, 255, 255, 50, 60, 70, 128, 10, 20, 30, 255,
  ]);
  const larger = await sharp(generatedTile).resize(4, 4).png().toBuffer();
  const restored = await preserveMapTemplatePixels(generationTemplate, larger);
  assert.deepEqual(
    await sharp(restored).ensureAlpha().raw().toBuffer(),
    expectedGenerated,
  );
  await assert.rejects(
    preserveMapTemplatePixels(
      generationTemplate,
      await sharp(generatedTile).resize(4, 2).png().toBuffer(),
    ),
    /宽高比/,
  );

  const generationResult = await runConnector(manifest, map, {
    operation: 'generate-layer',
    provider: 'nano-banana',
    image: dataUrl(generationTemplate),
    prompt: 'extend the test tile',
    tile: { key: '1,0', x: 1, y: 0, w: 1, h: 1 },
    layer: 'overall',
    mask_mode: 'white',
  });
  assert.equal(generationResult.task.status, 'completed');
  assert.equal(generationResult.task.adapter.model, 'gemini-3.1-flash-image');
  assert(
    generationResult.task.outputs.some((output) =>
      output.endsWith('generated-layer.png'),
    ),
  );
  assert.deepEqual(
    await sharp(
      outputPath(generationResult.task.outputs, 'generated-layer.png'),
    )
      .ensureAlpha()
      .raw()
      .toBuffer(),
    expectedGenerated,
  );
  const generationMetadata = JSON.parse(
    await readFile(
      outputPath(generationResult.task.outputs, 'result.json'),
      'utf8',
    ),
  );
  assert.equal(generationMetadata.provider, 'nano-banana');
  assert.equal(generationMetadata.model, 'gemini-3.1-flash-image');
  assert.equal(
    (
      await readFile(
        path.resolve(repositoryRoot, generationResult.taskPath),
        'utf8',
      )
    ).includes('test-gemini-key'),
    false,
  );
  const geminiRequest = requests.find((item) => item.url === '/gemini');
  assert.equal(geminiRequest.headers['x-goog-api-key'], 'test-gemini-key');
  assert.equal(
    geminiRequest.body.contents[0].parts[0].text,
    'extend the test tile',
  );
  assert.equal(
    geminiRequest.body.contents[0].parts[1].inline_data.mime_type,
    'image/png',
  );
  assert.deepEqual(geminiRequest.body.generationConfig.responseModalities, [
    'IMAGE',
  ]);

  const openAIResult = await runConnector(manifest, map, {
    operation: 'generate-layer',
    provider: 'gpt-image-2',
    image: dataUrl(generationTemplate),
    prompt: 'complete the transparent test tile',
    tile: { key: '1,0', x: 1, y: 0, w: 1, h: 1 },
    layer: 'overall',
    mask_mode: 'white',
  });
  assert.equal(openAIResult.task.status, 'completed');
  assert.deepEqual(
    await sharp(outputPath(openAIResult.task.outputs, 'generated-layer.png'))
      .ensureAlpha()
      .raw()
      .toBuffer(),
    expectedGenerated,
  );
  assert.equal(
    (
      await readFile(
        path.resolve(repositoryRoot, openAIResult.taskPath),
        'utf8',
      )
    ).includes('test-openai-key'),
    false,
  );
  const openAIRequest = requests.find((item) => item.url === '/openai');
  assert.equal(openAIRequest.headers.authorization, 'Bearer test-openai-key');
  assert.match(
    openAIRequest.headers['content-type'],
    /^multipart\/form-data; boundary=/,
  );
  const multipart = openAIRequest.rawBody.toString('latin1');
  assert.match(multipart, /name="model"[\s\S]*gpt-image-2/);
  assert.match(
    multipart,
    /name="prompt"[\s\S]*complete the transparent test tile/,
  );
  assert.match(multipart, /name="image\[\]"; filename="map-input.png"/);

  delete process.env.OPENAI_API_KEY;
  const awaitingKey = await runConnector(manifest, map, {
    operation: 'generate-layer',
    provider: 'gpt-image-2',
    image: dataUrl(blue),
    prompt: 'do not call without a key',
    tile: { key: '1,0', x: 1, y: 0, w: 1, h: 1 },
    layer: 'overall',
    mask_mode: 'white',
  });
  assert.equal(awaitingKey.task.status, 'awaiting_configuration');
  assert.equal(awaitingKey.requiredEnvironment, 'OPENAI_API_KEY');

  process.stdout.write(
    `${JSON.stringify(
      {
        spriteAdapter: 'ok',
        mapComposeAdapter: 'ok',
        mapGenerationContract: 'ok',
        spriteTaskId: refreshedSprite.task.id,
        mapTaskId: composeResult.task.id,
        outputs: composeResult.task.outputs,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  if (previousSpriteUrl === undefined)
    delete process.env.SPRITE_PIPELINE_API_URL;
  else process.env.SPRITE_PIPELINE_API_URL = previousSpriteUrl;
  restoreEnvironment('MAP_STITCHER_GEMINI_API_URL', previousGeminiUrl);
  restoreEnvironment('MAP_STITCHER_OPENAI_API_URL', previousOpenAIUrl);
  restoreEnvironment('GEMINI_API_KEY', previousGeminiKey);
  restoreEnvironment('OPENAI_API_KEY', previousOpenAIKey);
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
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
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r, g, b, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

function dataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

function outputPath(outputs, suffix) {
  const relative = outputs.find((output) => output.endsWith(suffix));
  assert(relative, `missing ${suffix}`);
  return path.resolve(repositoryRoot, relative);
}

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
