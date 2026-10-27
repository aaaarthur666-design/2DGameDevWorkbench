// Optional manual browser QA. Always seeds an isolated namespace; no provider calls.
// Run with a fixed WORKBENCH_TEST_RUN, then launch the Bridge and frontend with
// that same namespace and an unused WORKBENCH_RUNTIME_URL/port.
import assert from 'node:assert/strict';
import {
  root,
  manifest,
  snapshot,
  fixture,
  plan,
  step,
  planner,
} from './fixtures.mjs';
import { SceneWorkflowService } from '../../lib/workbench/scene-workflows.mjs';
import { createScene } from '../../features/scene-composer/model.mjs';
import { createDocument } from '../../lib/workbench/editor-documents.mjs';
const f = await fixture('workflow-browser-scene');
const emptyScene = createScene('从空场景开始制作');
emptyScene.id = 'workflow-browser-empty';
const { document: emptyDocument } = await createDocument(root, manifest, {
  kind: 'scene',
  documentId: emptyScene.id,
  commandId: 'browser-empty-scene',
  content: emptyScene,
});
const request = plan([
  step('move-gate', 'scene', {
    commands: [{ type: 'move-instances', ids: ['gate'], dx: 40 }],
  }),
]);
request.title = '铁门位置调整';
request.summary = '将铁门向右移动 40 像素，保留地图和物件外观。';
f.spec.description = request.summary;
request.requirements[0] = {
  id: 'goal',
  text: request.summary,
  source: 'user',
  evidence: request.summary,
};
request.steps[0].title = '将铁门向右移动 40 像素';
const service = new SceneWorkflowService(root, manifest, {
  snapshot,
  requestModel: planner(request),
});
const { work } = await service.request('scene-workflow-create', {
  commandId: 'browser-ready-position',
  spec: f.spec,
});
const finished = await service.drain(work.id);
assert.equal(finished.status, 'ready_to_adopt', finished.message);

// This read-only UI specimen deliberately contains mocked receipts. It cannot
// adopt or revise and never submits generation. The real candidate above stays
// separate so browser QA can still exercise an actual guarded adoption.
const productionSource = await fixture('workflow-browser-production');
productionSource.spec.autoExecute = false;
const productionPlan = plan([
  step('mock-layout', 'scene', {
    commands: [{ type: 'move-instances', ids: ['gate'], dx: 1 }],
  }),
]);
productionPlan.title = '模拟素材与地图回执（无生成调用）';
const productionService = new SceneWorkflowService(root, manifest, {
  snapshot,
  requestModel: planner(productionPlan),
});
const { work: productionCreated } = await productionService.request(
  'scene-workflow-create',
  {
    commandId: 'browser-mock-production-receipts',
    spec: productionSource.spec,
  },
);
const productionWork = await productionService.drain(productionCreated.id);
productionWork.status = 'attention_required';
productionWork.phase = 'execution';
productionWork.message = '仅用于界面检查的模拟制作回执，未调用图像提供方。';
productionWork.spec.mapMode = 'extend';
productionWork.spec.budget.generationCalls = 3;
productionWork.spec.budget.mapTiles = 2;
productionWork.repairs = productionWork.spec.budget.revisions;
productionWork.generationConfiguration = {
  schemaVersion: 1,
  prop: {
    provider: 'mock-prop-provider',
    model: 'mock-transparent-art-model',
    configuredAtCreation: true,
  },
  map: {
    provider: 'mock-map-provider',
    model: 'mock-map-image-model',
    configuredAtCreation: true,
  },
};
const mockHash = 'b'.repeat(64);
const mockGenerationJob = {
  requestId: 'mock-generation-request',
  requestHash: mockHash,
  status: 'completed',
  taskId: 'mock-production-task',
  profileHash: mockHash,
};
productionWork.steps.push(
  {
    id: 'mock-generation',
    title: '模拟：生成铁门素材',
    kind: 'generate',
    planHash: productionWork.plans.at(-1).hash,
    status: 'completed',
    commandId: 'mock-stable-generation-command',
    generationJob: mockGenerationJob,
    generationEvidence: {
      image: productionWork.evidence[0].images[0],
      provider: 'mock-prop-provider',
      model: 'mock-transparent-art-model',
      usage: { images: 1 },
    },
    fixture: true,
  },
  {
    id: 'mock-map-tile',
    title: '模拟：扩建东侧瓦片',
    kind: 'map',
    planHash: productionWork.plans.at(-1).hash,
    status: 'completed',
    commandId: 'mock-stable-map-command',
    mapJob: {
      id: 'mock-map-tile-map',
      commandId: 'mock-stable-map-command:map',
      generationJob: {
        ...mockGenerationJob,
        requestId: 'mock-map-request',
        taskId: 'mock-map-task',
      },
      generationEvidence: {
        image: productionWork.evidence[0].images[0],
        provider: 'mock-map-provider',
        model: 'mock-map-image-model',
        usage: { images: 1 },
      },
    },
    mapOutput: {
      operation: 'extend',
      stepId: 'mock-map-tile',
      tileKey: 'wf_mock-map-tile',
      layerId: 'mock-map-derived-layer',
      tileBounds: { x: 218, y: 0, width: 256, height: 160 },
      beforeMapHash: 'c'.repeat(64),
      afterMapHash: 'd'.repeat(64),
      sourceTaskId: 'mock-map-task',
      generatedSha256: mockHash,
      stitchedSha256: 'e'.repeat(64),
    },
    fixture: true,
  },
);
productionWork.generationCalls = [
  {
    requestId: mockGenerationJob.requestId,
    stepId: 'mock-generation',
    purpose: 'mock-only',
    capability: 'image-assets',
    provider: 'mock-prop-provider',
    model: 'mock-transparent-art-model',
    requestHash: mockHash,
    profileHash: mockHash,
    status: 'completed',
    submissionState: 'confirmed',
    submitted: true,
    taskId: mockGenerationJob.taskId,
  },
];
productionWork.generationCalls.push({
  ...productionWork.generationCalls[0],
  requestId: 'mock-map-request',
  stepId: 'mock-map-tile',
  capability: 'map-stitcher',
  provider: 'mock-map-provider',
  model: 'mock-map-image-model',
  taskId: 'mock-map-task',
});
await productionService.store.save(productionWork);
console.log(
  JSON.stringify({
    namespace: process.env.WORKBENCH_TEST_RUN,
    documentId: f.document.id,
    workId: work.id,
    emptyDocumentId: emptyDocument.id,
    mockProductionDocumentId: productionSource.document.id,
    mockProductionWorkId: productionWork.id,
    expectedAdoptedX: 160,
  }),
);
