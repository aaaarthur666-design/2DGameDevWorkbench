import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTestViteServer } from '../helpers/vite-server.mjs';
import { sceneWorkflowInputs } from '../../lib/workbench/scene-workflow-contract.mjs';
import { SceneWorkflowService } from '../../lib/workbench/scene-workflows.mjs';
import {
  root,
  manifest,
  snapshot,
  fixture,
  plan,
  step,
  planner,
} from './fixtures.mjs';

const vite = await createTestViteServer({
  configFile: false,
  appType: 'custom',
  resolve: { alias: { '@': root } },
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true },
  logLevel: 'error',
});
const originalFetch = globalThis.fetch;
try {
  const client = await vite.ssrLoadModule('/features/scene-workflow/client.ts');
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
  const f = await fixture('frontend');
  const initial = await service.request('scene-workflow-create', {
    commandId: 'frontend',
    spec: f.spec,
  });
  const work = service.public(await service.drain(initial.work.id));
  assert.equal(client.canAdoptWorkflow(work), true);
  assert.equal(client.canAdoptWorkflow({ ...work, running: true }), false);
  assert.equal(
    client.canAdoptWorkflow({ ...work, recoverableProduction: true }),
    false,
  );
  assert.equal(client.canReviseWorkflow(work), true);
  assert.equal(
    client.canReviseWorkflow({ ...work, recoverableProduction: true }),
    false,
  );
  const input = client.adoptionInput(work, [], '', 'frontend-adopt');
  assert.deepEqual(
    sceneWorkflowInputs['scene-workflow-adopt'].parse(input),
    input,
  );
  assert.throws(
    () =>
      client.adoptionInput({ ...work, candidateHash: 'a'.repeat(64) }, [], ''),
    /当前版本/,
  );
  assert.equal(
    client.canAdoptWorkflow({ ...work, candidateHash: 'a'.repeat(64) }),
    false,
    'the UI never offers adoption for a different candidate hash',
  );
  assert.equal(
    client.canAdoptWorkflow({
      ...work,
      candidateRevision: work.candidateRevision + 1,
    }),
    false,
  );
  assert.throws(
    () =>
      client.adoptionInput(
        { ...work, candidateRevision: work.candidateRevision + 1 },
        [],
        '',
      ),
    /当前版本/,
  );
  const uncertain = structuredClone(work);
  uncertain.status = 'attention_required';
  uncertain.reviews.at(-1).status = 'needs_human';
  uncertain.reviews.at(-1).requiresHuman = ['appearance'];
  assert.throws(() => client.adoptionInput(uncertain, [], ''), /确认/);
  assert.throws(
    () => client.adoptionInput(uncertain, ['appearance'], ''),
    /确认/,
  );
  assert.equal(
    client.adoptionInput(uncertain, ['appearance'], '已查看实际图片')
      .acknowledgedCriteria[0],
    'appearance',
  );
  const result = await service.request('scene-workflow-adopt', input);
  client.validateAdoption(result.work, result.adoption);
  client.validateMutationResult(result, 'adopt', input, f.document.id);
  assert.throws(
    () =>
      client.validateMutationResult(result, 'adopt', input, 'another-scene'),
    /场景或任务/,
  );
  assert.throws(
    () =>
      client.validateMutationResult(
        result,
        'adopt',
        { ...input, workId: 'another-work' },
        f.document.id,
      ),
    /场景或任务/,
  );
  assert.throws(
    () =>
      client.validateMutationResult(
        result,
        'adopt',
        { ...input, candidateHash: 'a'.repeat(64) },
        f.document.id,
      ),
    /原请求的候选/,
  );
  assert.equal(
    client.newerWorkflow(result.work, work),
    result.work,
    'an older poll never replaces a confirmed adoption',
  );
  assert.equal(client.newerWorkflow(work, result.work), result.work);
  assert.throws(
    () =>
      client.validateAdoption(result.work, {
        ...result.adoption,
        documentId: 'another',
      }),
    /不匹配/,
  );
  assert.throws(
    () =>
      client.validateAdoption(result.work, {
        ...result.adoption,
        candidateRevision: 999,
      }),
    /不匹配/,
  );
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, '/api/workbench/scene-workflow/adopt');
    assert.equal(options.method, 'POST');
    assert.equal(options.cache, 'no-store');
    assert.deepEqual(JSON.parse(options.body), input);
    return Response.json(
      { error: '场景已被用户修改', code: 'REVISION_CONFLICT' },
      { status: 409 },
    );
  };
  await assert.rejects(
    client.workflowRequest('adopt', input),
    (e) => e.code === 'REVISION_CONFLICT' && e.status === 409,
  );
  assert.equal(calls, 1, 'CAS failure is never retried as a new command');
  globalThis.fetch = async () => {
    calls++;
    throw new Error('response lost');
  };
  await assert.rejects(client.workflowRequest('adopt', input), /response lost/);
  assert.equal(calls, 2);
  const { POST } = await vite.ssrLoadModule(
    '/app/api/workbench/scene-workflow/[operation]/route.ts',
  );
  assert.equal(
    (
      await POST(
        new Request('http://local/api/workbench/scene-workflow/unknown', {
          method: 'POST',
        }),
        { params: Promise.resolve({ operation: 'unknown' }) },
      )
    ).status,
    404,
  );
  globalThis.fetch = async (url, options) => {
    assert.match(url, /\/v1\/agent\/scene-workflow-get$/);
    assert.equal(options.method, 'POST');
    return Response.json({ work });
  };
  const response = await POST(
    new Request('http://local/api/workbench/scene-workflow/get', {
      method: 'POST',
      body: JSON.stringify({ workId: work.id }),
    }),
    { params: Promise.resolve({ operation: 'get' }) },
  );
  assert.equal((await response.json()).work.id, work.id);
  const {
    SceneWorkflowPanel,
    WorkflowProductionAuthorization,
    WorkflowProductionReceipts,
    WorkflowResumeAction,
  } = await vite.ssrLoadModule(
    '/components/scene-composer/scene-workflow-panel.tsx',
  );
  renderToStaticMarkup(
    createElement(SceneWorkflowPanel, {
      document: f.document,
      beforeAdopt: async () => {},
      onAdopt: async () => {},
      onClose: () => {},
    }),
  );
  const resume = (state) =>
    renderToStaticMarkup(
      createElement(WorkflowResumeAction, {
        work: { ...work, ...state },
        disabled: false,
        onResume: () => {},
      }),
    );
  assert.match(resume({ status: 'paused' }), /继续任务/);
  assert.match(
    resume({ status: 'attention_required', recoverableProduction: true }),
    /核对原制作请求/,
  );
  assert.match(
    resume({
      status: 'attention_required',
      recoverableProduction: true,
      configurationRequired: true,
    }),
    /配置完成后继续制作/,
  );
  assert.equal(
    resume({ status: 'attention_required', recoverableProduction: false }),
    '',
  );
  assert.equal(
    resume({
      status: 'attention_required',
      recoverableProduction: true,
      running: true,
    }),
    '',
  );
  const production = structuredClone(work);
  production.spec.mapMode = 'extend';
  production.spec.budget.generationCalls = 3;
  production.spec.budget.mapTiles = 2;
  production.generationConfiguration = {
    schemaVersion: 1,
    prop: {
      provider: 'frozen-prop',
      model: 'frozen-prop-model',
      endpoint: 'http://private-fixture.invalid/unused',
      configuredAtCreation: true,
    },
    map: {
      provider: 'frozen-map',
      model: 'frozen-map-model',
      configuredAtCreation: true,
    },
  };
  const authorization = renderToStaticMarkup(
    createElement(WorkflowProductionAuthorization, { work: production }),
  );
  assert.match(authorization, /扩建现有地图/);
  assert.match(authorization, /frozen-prop.*frozen-prop-model/);
  assert.match(authorization, /frozen-map.*frozen-map-model/);
  assert.doesNotMatch(authorization, /private-fixture/);
  const productionStep = {
    id: 'generated-gate',
    title: '生成新铁门',
    kind: 'generate',
    planHash: work.plans.at(-1).hash,
    status: 'started',
    beforeRevision: work.candidateRevision,
    commandId: 'same-production-command',
    taskId: 'same-production-task',
    generationJob: {
      requestId: 'same-generation-request',
      requestHash: 'b'.repeat(64),
      profileHash: 'c'.repeat(64),
      taskId: 'same-production-task',
      status: 'completed',
    },
    generationEvidence: {
      provider: 'frozen-prop',
      model: 'frozen-prop-model',
      image: {
        artifactPath: 'outputs/fixture/image.png',
        sha256: 'd'.repeat(64),
        width: 1024,
        height: 1024,
      },
    },
    message: '<script>fixture</script>',
  };
  production.steps.push(productionStep);
  production.generationCalls = [
    { commandId: productionStep.commandId, taskId: productionStep.taskId },
  ];
  production.steps.push({
    ...productionStep,
    id: 'east-tile',
    title: '扩建东侧地图',
    kind: 'map',
    generationJob: undefined,
    generationEvidence: undefined,
    mapJob: {
      id: 'east-tile-map',
      commandId: 'same-map-command',
      generationJob: {
        ...productionStep.generationJob,
        requestId: 'same-map-request',
        taskId: 'same-map-task',
      },
      generationEvidence: productionStep.generationEvidence,
    },
    mapOutput: {
      operation: 'extend',
      stepId: 'east-tile',
      tileKey: 'wf_east-tile',
      layerId: 'private-map-layer',
      tileBounds: { x: 860, y: -10, width: 1024, height: 1024 },
      beforeMapHash: 'e'.repeat(64),
      afterMapHash: 'f'.repeat(64),
      sourceTaskId: 'same-map-task',
      generatedSha256: 'd'.repeat(64),
      stitchedSha256: 'b'.repeat(64),
    },
  });
  const receipts = renderToStaticMarkup(
    createElement(WorkflowProductionReceipts, { work: production }),
  );
  assert.match(receipts, /same-production-command/);
  assert.match(receipts, /same-generation-request/);
  assert.match(receipts, /same-production-task/);
  assert.match(receipts, /same-map-task/);
  assert.match(receipts, /same-map-request/);
  assert.match(receipts, /wf_east-tile/);
  assert.match(receipts, /地图源坐标（860，-10）/);
  assert.match(receipts, /e{64}.*→.*f{64}/);
  assert.match(receipts, /1024.*×.*1024/);
  assert.match(receipts, /d{64}/);
  assert.doesNotMatch(receipts, /src="outputs\/fixture/);
  assert.match(receipts, /原作业/);
  assert.match(receipts, /&lt;script&gt;fixture&lt;\/script&gt;/);
  assert.doesNotMatch(receipts, /<script>/);
  console.log(
    'Scene workflow frontend: exact review/adoption binding, human adjudication requirements, HTTP failure/no-retry, canonical proxy, frozen production authorization and escaped original job receipts passed.',
  );
} finally {
  globalThis.fetch = originalFetch;
  await vite.close();
}
