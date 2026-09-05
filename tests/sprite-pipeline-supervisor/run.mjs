import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createSpritePipelineLaunch,
  probeSpritePipeline,
  resolveSpritePipelineTarget,
} from '../../lib/workbench/sprite-pipeline-supervisor.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');
let healthMode = 'valid';
const server = http.createServer((request, response) => {
  response.setHeader('content-type', 'application/json');
  if (request.url !== '/health') {
    response.writeHead(404);
    response.end('{}');
    return;
  }
  response.writeHead(200);
  response.end(
    healthMode === 'valid'
      ? JSON.stringify({ ok: true, version: 'test-version' })
      : JSON.stringify({ ok: true }),
  );
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address === 'object');
const target = {
  mode: 'managed',
  baseUrl: `http://127.0.0.1:${address.port}`,
  host: '127.0.0.1',
  port: address.port,
};

const ready = await probeSpritePipeline(target);
assert.deepEqual(ready, { state: 'ready', version: 'test-version' });

healthMode = 'invalid';
const conflict = await probeSpritePipeline(target);
assert.equal(conflict.state, 'conflict');

await new Promise((resolve, reject) =>
  server.close((error) => (error ? reject(error) : resolve())),
);
const offline = await probeSpritePipeline(target, { timeoutMs: 250 });
assert.deepEqual(offline, { state: 'offline' });

const defaultTarget = resolveSpritePipelineTarget({});
assert.equal(defaultTarget.mode, 'managed');
assert.equal(defaultTarget.baseUrl, 'http://127.0.0.1:7860');

const remoteTarget = resolveSpritePipelineTarget({
  SPRITE_PIPELINE_API_URL: 'https://sprites.example.test',
  NEXT_PUBLIC_SPRITE_PIPELINE_UI_URL: 'https://sprites.example.test',
});
assert.equal(remoteTarget.mode, 'external');

const splitTarget = resolveSpritePipelineTarget({
  SPRITE_PIPELINE_API_URL: 'http://127.0.0.1:8765',
});
assert.equal(splitTarget.mode, 'external');

const launch = createSpritePipelineLaunch(repositoryRoot, defaultTarget, {});
assert.equal(path.basename(launch.command).toLowerCase(), 'python.exe');
assert.deepEqual(launch.args.slice(1), [
  'serve-ui',
  '--host',
  '127.0.0.1',
  '--port',
  '7860',
]);
assert.equal(
  launch.env.SPRITE_PIPELINE_DATA_DIR,
  path.join(repositoryRoot, 'work', 'sprite-pipeline'),
);

console.log(
  JSON.stringify(
    {
      healthProbe: 'ok',
      wrongServiceDetection: 'ok',
      localAutoStart: 'ok',
      externalEndpointBypass: 'ok',
    },
    null,
    2,
  ),
);
