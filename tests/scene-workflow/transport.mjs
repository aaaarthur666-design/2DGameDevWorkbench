import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  root,
  manifest,
  snapshot,
  fixture,
  plan,
  step,
  planner,
  turn,
} from './fixtures.mjs';
import {
  sendSceneExpert,
  strictModelSchema,
  sceneModelSettings,
} from '../../lib/workbench/scene-workflow-models.mjs';
import { expertTurnSchema } from '../../lib/workbench/scene-workflow-contract.mjs';
import { SceneWorkflowService } from '../../lib/workbench/scene-workflows.mjs';
import { hash } from '../../lib/workbench/scene-workflow-store.mjs';

const wire = [],
  receipts = [];
let responseMode = 'success';
const modelResponse = turn('finalize', {
  plan: plan(
    [
      step('move', 'scene', {
        commands: [{ type: 'move-instances', ids: ['gate'], dx: 4 }],
      }),
    ],
    [
      {
        id: 'state',
        description: '门仍关闭',
        requirementIds: ['goal'],
        events: [],
        expectEvents: [],
        expectStates: [
          {
            instanceId: 'gate',
            completed: null,
            toggleState: false,
            sequenceIndex: null,
            successCount: null,
            enabled: null,
            visible: true,
            solidEnabled: true,
          },
        ],
      },
    ],
  ),
});
const provider = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks));
  wire.push({
    url: request.url,
    body,
    authorization: request.headers.authorization,
  });
  if (responseMode === 'drop') {
    request.socket.destroy();
    return;
  }
  if (responseMode === 'error') {
    response
      .writeHead(429, { 'content-type': 'application/json' })
      .end(JSON.stringify({ error: 'DO-NOT-PERSIST-PROVIDER-BODY' }));
    return;
  }
  const content = JSON.stringify(modelResponse);
  const payload =
    request.url === '/responses'
      ? {
          id: 'resp_fixture',
          model: body.model,
          status: responseMode === 'incomplete' ? 'incomplete' : 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: content }],
            },
          ],
          usage: {
            input_tokens: 12,
            output_tokens: 8,
            total_tokens: 20,
            opaque: 'no',
          },
        }
      : {
          id: 'chat_fixture',
          model: body.model,
          choices: [
            {
              finish_reason: responseMode === 'incomplete' ? 'length' : 'stop',
              message: { content },
            },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
        };
  response
    .writeHead(200, {
      'content-type': 'application/json',
      'x-request-id': 'fixture-request',
    })
    .end(JSON.stringify(payload));
});
provider.listen(0, '127.0.0.1');
await once(provider, 'listening');
const mockUrl = `http://127.0.0.1:${provider.address().port}`;
const envBefore = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  TOKENHUB_API_KEY: process.env.TOKENHUB_API_KEY,
};
process.env.OPENAI_API_KEY = 'scene-fixture-key';
process.env.TOKENHUB_API_KEY = 'scene-fixture-token';
let bridge,
  stderr = '';
const client = new Client({ name: 'scene-workflow-transport', version: '1' });
try {
  const settings = sceneModelSettings(manifest);
  assert.equal(settings.configuration, null);
  assert.equal(JSON.stringify(settings).includes('scene-fixture-key'), false);
  const strict = strictModelSchema(expertTurnSchema);
  function strictObjects(schema) {
    if (!schema || typeof schema !== 'object') return;
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(schema.required, Object.keys(schema.properties));
    }
    for (const item of Object.values(schema))
      if (Array.isArray(item)) item.forEach(strictObjects);
      else strictObjects(item);
  }
  strictObjects(strict);
  const images = [
    {
      data: 'cG5n',
      sha256: hash('png'),
      role: 'composite',
      revision: 3,
      evidenceId: 'candidate-2',
    },
  ];
  for (const id of ['openai', 'tokenhub']) {
    const frozen = snapshot();
    frozen.configuration.default.provider = id;
    frozen.providers = [
      {
        id,
        endpoint: `${mockUrl}/${id === 'openai' ? 'responses' : 'chat/completions'}`,
      },
    ];
    const args = {
      manifest,
      snapshot: frozen,
      role: 'coordinator',
      instructions: 'Return structured JSON.',
      data: { task: 'fixture' },
      images,
      schema: expertTurnSchema,
      onReceipt: (r) => receipts.push(r),
    };
    const result = await sendSceneExpert(args);
    assert.equal(
      result.plan.acceptance[0].expectStates[0].completed,
      undefined,
      'nullable wire optionals are removed even inside a nullable plan',
    );
    assert.equal(result.plan.acceptance[0].expectStates[0].visible, true);
    assert.equal(
      wire.at(-1).authorization,
      `Bearer ${id === 'openai' ? 'scene-fixture-key' : 'scene-fixture-token'}`,
    );
    if (id === 'openai') {
      assert.equal(wire.at(-1).body.store, false);
      assert.equal(wire.at(-1).body.text.format.strict, true);
      assert.ok(
        wire.at(-1).body.input[0].content.some((c) => c.type === 'input_image'),
      );
    } else {
      assert.equal(wire.at(-1).body.response_format.type, 'json_object');
      assert.ok(
        wire
          .at(-1)
          .body.messages[0].content.some((c) => c.type === 'image_url'),
      );
    }
    responseMode = 'incomplete';
    await assert.rejects(
      sendSceneExpert(args),
      (e) => e.code === 'SCENE_MODEL_INVALID',
    );
    responseMode = 'error';
    const count = wire.length;
    await assert.rejects(
      sendSceneExpert(args),
      (e) => e.code === 'SCENE_MODEL_FAILED' && !e.message.includes('DO-NOT'),
    );
    assert.equal(wire.length, count + 1, 'provider failures never retry');
    responseMode = 'drop';
    await assert.rejects(
      sendSceneExpert(args),
      (e) => e.code === 'SCENE_MODEL_OUTCOME_UNKNOWN',
    );
    responseMode = 'success';
  }
  assert.ok(
    receipts.some(
      (r) => r.responseId === 'resp_fixture' && r.usage.total_tokens === 20,
    ),
  );
  assert.equal(JSON.stringify(receipts).includes('scene-fixture-key'), false);
  assert.equal(JSON.stringify(receipts).includes('opaque'), false);

  const service = new SceneWorkflowService(root, manifest, {
    snapshot,
    requestModel: planner(
      plan([
        step('move', 'scene', {
          commands: [{ type: 'move-instances', ids: ['gate'], dx: 4 }],
        }),
      ]),
    ),
  });
  const f = await fixture('transport');
  const input = { commandId: 'transport-create', spec: f.spec };
  const started = await service.request('scene-workflow-create', input);
  const finished = await service.drain(started.work.id);
  assert.equal(finished.status, 'ready_to_adopt', finished.message);
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`,
    env = {
      ...process.env,
      WORKBENCH_RUNTIME_PORT: String(port),
      WORKBENCH_RUNTIME_URL: base,
      SCENE_EXPERT_OPENAI_URL: `${mockUrl}/responses`,
    };
  bridge = spawn(process.execPath, ['scripts/workbench-http.mjs'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bridge.stderr.on('data', (bytes) => {
    stderr += bytes;
  });
  bridge.stdout.resume();
  for (let i = 0; ; i++) {
    if (i > 300 || bridge.exitCode !== null)
      throw new Error(`Bridge failed: ${stderr}`);
    try {
      if ((await fetch(`${base}/health`)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const post = async (operation, value) => {
    const response = await fetch(
      `${base}/v1/agent/scene-workflow-${operation}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(value),
      },
    );
    return { status: response.status, body: await response.json() };
  };
  const before = wire.length;
  assert.equal(
    (await post('create', input)).body.replayed,
    true,
    'HTTP duplicate recovers canonical stored task without a model',
  );
  assert.equal(
    (await post('get', { workId: finished.id })).body.work.status,
    'ready_to_adopt',
  );
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['scripts/workbench-mcp.mjs'],
      env,
      stderr: 'pipe',
    }),
  );
  const names = (await client.listTools()).tools.map((t) => t.name);
  for (const name of [
    'workbench_create_scene_workflow',
    'workbench_get_scene_workflow',
    'workbench_observe_scene_workflow',
    'workbench_adopt_scene_workflow',
    'workbench_get_scene_workflow_settings',
  ])
    assert.ok(names.includes(name));
  const observed = await client.callTool({
    name: 'workbench_observe_scene_workflow',
    arguments: { workId: finished.id },
  });
  assert.equal(observed.isError, undefined);
  assert.equal(observed.content.filter((c) => c.type === 'image').length, 2);
  const runCli = async () => {
    const child = spawn(
      process.execPath,
      [
        'scripts/workbench.mjs',
        'agent',
        'scene-workflow-get',
        '--input-json',
        JSON.stringify({ workId: finished.id }),
        '--json',
      ],
      { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    child.stdout.on('data', (bytes) => {
      output += bytes;
    });
    child.stderr.resume();
    const [code] = await once(child, 'exit');
    return { code, output };
  };
  const cli = await runCli();
  assert.equal(cli.code, 0);
  assert.equal(JSON.parse(cli.output).work.id, finished.id);
  const adoption = {
    workId: finished.id,
    expectedRevision: finished.revision,
    commandId: 'transport-adopt',
    candidateRevision: finished.candidateRevision,
    candidateHash: finished.candidateHash,
  };
  const adopted = await client.callTool({
    name: 'workbench_adopt_scene_workflow',
    arguments: adoption,
  });
  assert.equal(adopted.isError, undefined);
  assert.equal(adopted.structuredContent.work.status, 'completed');
  assert.equal((await post('adopt', adoption)).body.replayed, true);
  assert.equal(
    wire.length,
    before,
    'HTTP/CLI/MCP reads and adoption never call a model',
  );
  await client.close();
  const exited = once(bridge, 'exit');
  bridge.kill('SIGTERM');
  await exited;
  assert.notEqual(
    (await runCli()).code,
    0,
    'offline clients cannot fall back to a second local authority',
  );
  console.log(
    'Scene workflow transport: OpenAI/TokenHub wire schemas, nested nullable parsing, usage receipts, failure/no-retry, HTTP/CLI/MCP authority and image delivery passed.',
  );
} finally {
  for (const [key, value] of Object.entries(envBefore)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await client.close().catch(() => {});
  if (bridge && bridge.exitCode === null && bridge.signalCode === null) {
    const exited = once(bridge, 'exit');
    bridge.kill('SIGTERM');
    await exited;
  }
  provider.closeAllConnections();
  await new Promise((resolve) => provider.close(resolve));
}
