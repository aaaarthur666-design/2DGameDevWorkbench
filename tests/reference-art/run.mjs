import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  loadManifest,
  findCapability,
  prepareTask,
  runConnector,
  refreshTask,
  persistTask,
  readTask,
  validateInput,
  repositoryRoot,
} from '../../lib/workbench/runtime.mjs';

const image = await sharp({
  create: { width: 128, height: 128, channels: 4, background: '#00000000' },
})
  .composite([
    {
      input: await sharp({
        create: { width: 40, height: 80, channels: 4, background: '#46ac55' },
      })
        .png()
        .toBuffer(),
      left: 44,
      top: 32,
    },
  ])
  .png()
  .toBuffer();
let configured = true;
let providerStatus = 'running';
let submits = 0;
let polls = 0;
let imports = 0;
let savedKey = '';
const received = [];
const mock = createServer(async (request, response) => {
  let text = '';
  for await (const chunk of request) text += chunk;
  const body = text ? JSON.parse(text) : null;
  received.push({ method: request.method, path: request.url, body });
  let result;
  if (request.url === '/v1/reference-art/settings') {
    if (body) {
      savedKey = body.apiKey;
      configured = true;
    }
    result = { configured };
  } else if (request.url === '/v1/reference-art/jobs') {
    submits++;
    result = { status: 'running', jobId: 'provider-reference-1' };
  } else if (request.url === '/v1/reference-art/jobs/provider-reference-1') {
    polls++;
    result =
      providerStatus === 'completed'
        ? { status: 'completed', image: image.toString('base64') }
        : { status: providerStatus, error: 'Provider failed' };
  } else if (request.url === '/v1/reference-art/import') {
    imports++;
    assert.deepEqual(Buffer.from(body.image, 'base64'), image);
    result = { characterId: body.characterId };
  } else {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(result));
});
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
const previousUrl = process.env.SPRITE_PIPELINE_API_URL;
process.env.SPRITE_PIPELINE_API_URL = `http://127.0.0.1:${mock.address().port}`;
let bridge;
try {
  const manifest = await loadManifest();
  const capability = findCapability(manifest, 'reference-art');
  const input = {
    operation: 'generate',
    name: 'Forest ranger',
    prompt: 'green cloak, full body',
    facing: 'left',
    seed: 9,
  };
  assert.ok(
    validateInput(capability, { ...input, apiKey: 'never-store' }).length,
  );
  assert.ok(
    validateInput(capability, { operation: 'generate', prompt: '  ' }).length,
  );
  assert.ok(
    validateInput(capability, {
      operation: 'transfer',
      sourceTaskId: '../escape',
    }).length,
  );
  const prepared = await prepareTask(manifest, capability, input);
  assert.equal(prepared.task.status, 'prepared');
  assert.equal(submits, 0);
  configured = false;
  const missingKey = await runConnector(manifest, capability, input);
  assert.equal(missingKey.task.status, 'awaiting_configuration');
  assert.equal(submits, 0);
  configured = true;
  const submitted = await runConnector(manifest, capability, input);
  assert.equal(submitted.task.status, 'running');
  assert.equal(submits, 1);
  const task = await readTask(manifest, submitted.task.id);
  assert.equal(task.adapter.referenceJobId, 'provider-reference-1');
  task.adapter.lastPolledAt = 0;
  await persistTask(manifest, task);
  const progress = await refreshTask(manifest, task.id);
  assert.equal(progress.task.status, 'running');
  assert.equal(polls, 1);
  assert.equal(submits, 1);
  await assert.rejects(
    runConnector(manifest, capability, {
      operation: 'transfer',
      sourceTaskId: task.id,
    }),
    /已经完成/,
  );
  providerStatus = 'completed';
  progress.task.adapter.lastPolledAt = 0;
  await persistTask(manifest, progress.task);
  const completed = await refreshTask(manifest, task.id);
  assert.equal(completed.task.status, 'completed');
  for (const output of completed.task.outputs)
    assert.ok((await stat(path.join(repositoryRoot, output))).isFile());
  const first = await runConnector(manifest, capability, {
    operation: 'transfer',
    sourceTaskId: task.id,
  });
  const second = await runConnector(manifest, capability, {
    operation: 'transfer',
    sourceTaskId: task.id,
  });
  const result = JSON.parse(
    await readFile(path.join(repositoryRoot, first.task.outputs[0]), 'utf8'),
  );
  assert.equal(
    result.characterId,
    JSON.parse(
      await readFile(path.join(repositoryRoot, second.task.outputs[0]), 'utf8'),
    ).characterId,
  );
  assert.match(result.href, /^\/tools\/sprite-generator\?character=reference_/);
  assert.equal(submits, 1);
  assert.equal(imports, 2);
  assert.ok(
    !received.some(
      (call) => call.path.includes('/generate') || call.path === '/v1/jobs',
    ),
  );
  const png = completed.task.outputs.find((output) => output.endsWith('.png'));
  await writeFile(
    png,
    await sharp(image).modulate({ brightness: 0.5 }).png().toBuffer(),
  );
  await assert.rejects(
    runConnector(manifest, capability, {
      operation: 'transfer',
      sourceTaskId: task.id,
    }),
    /已变化/,
  );
  await writeFile(png, image);

  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  bridge = spawn(process.execPath, ['scripts/workbench-http.mjs'], {
    cwd: repositoryRoot,
    env: { ...process.env, WORKBENCH_RUNTIME_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Bridge did not start')),
      10000,
    );
    bridge.once('error', reject);
    bridge.stdout.on('data', (data) => {
      if (data.toString().includes('ready at')) {
        clearTimeout(timer);
        resolve();
      }
    });
    bridge.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Bridge exited ${code}`));
    });
  });
  const base = `http://127.0.0.1:${port}`;
  const response = await fetch(`${base}/v1/reference-art/settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey: 'shared-key-never-echo' }),
  });
  const settingsText = await response.text();
  assert.equal(response.status, 200);
  assert.equal(savedKey, 'shared-key-never-echo');
  assert.ok(!settingsText.includes(savedKey));
  const unknown = await fetch(`${base}/v1/reference-art/settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey: 'valid-secret', unknown: true }),
  });
  assert.equal(unknown.status, 400);
  const restored = await fetch(`${base}/v1/tasks/${task.id}`);
  assert.equal((await restored.json()).task.status, 'completed');
  const download = await fetch(
    `${base}/v1/artifacts?path=${encodeURIComponent(png)}`,
  );
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), image);
  const sourceJson = await readFile(
    path.join(repositoryRoot, completed.taskPath),
    'utf8',
  );
  assert.ok(!sourceJson.includes(savedKey));
  console.log(
    JSON.stringify(
      {
        prepareWithoutGeneration: 'ok',
        sharedKey: 'ok',
        asyncResume: 'ok',
        referenceTransfer: 'ok',
        sourceIntegrity: 'ok',
        http: 'ok',
        paidCalls: 0,
      },
      null,
      2,
    ),
  );
} finally {
  if (previousUrl === undefined) delete process.env.SPRITE_PIPELINE_API_URL;
  else process.env.SPRITE_PIPELINE_API_URL = previousUrl;
  if (bridge && bridge.exitCode === null) {
    const exited = new Promise((resolve) => bridge.once('exit', resolve));
    bridge.kill();
    await exited;
  }
  await new Promise((resolve) => mock.close(resolve));
}
