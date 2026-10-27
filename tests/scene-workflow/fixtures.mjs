import '../helpers/runtime-workspace.mjs';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import JSZip from 'jszip';
import {
  createScene,
  replaceMap,
  addMaterial,
  addInstance,
} from '../../features/scene-composer/model.mjs';
import {
  createProject,
  createObject,
} from '../../features/interactable-editor/contract.mjs';
import { createDocument } from '../../lib/workbench/editor-documents.mjs';
import { loadManifest, repositoryRoot } from '../../lib/workbench/runtime.mjs';
import { modelSettingsSchema } from '../../lib/workbench/scene-workflow-contract.mjs';
export const root = repositoryRoot;
export const manifest = await loadManifest();
for (const key of [
  'documentDirectory',
  'sceneWorkflowDirectory',
  'outputDirectory',
  'taskDirectory',
])
  assert.ok(
    manifest.workspace[key].includes(
      `/test-runs/${process.env.WORKBENCH_TEST_RUN}`,
    ),
  );
export const snapshot = () => ({
  configuration: modelSettingsSchema.parse({
    default: { provider: 'openai', model: 'fixture-vision' },
  }),
  providers: [{ id: 'openai', endpoint: 'http://127.0.0.1:1/responses' }],
});
export const turn = (action, extra = {}) => ({
  action,
  summary: '依据真实画面处理当前问题。',
  target: null,
  question: '',
  observation: null,
  plan: null,
  ...extra,
});
export const step = (id, kind, input, dependsOn = []) => ({
  id,
  kind,
  title: id,
  input: JSON.stringify(input),
  dependsOn,
});
export const requirement = {
  id: 'goal',
  text: '拉杆开门并保持地图',
  source: 'user',
  evidence: '拉杆开门',
};
export function plan(steps, acceptance = []) {
  return {
    title: '工厂机关',
    summary: '复用已有素材完成机关。',
    requirements: [requirement],
    steps,
    visualCriteria: [
      {
        id: 'appearance',
        description: '门和拉杆清晰，地图保留',
        requirementIds: ['goal'],
        region: null,
      },
    ],
    acceptance,
    questions: [],
  };
}
export function opinion(data, classification = 'met') {
  return {
    summary: '已检查当前候选。',
    findings: data.assignedCriteria.map((criterionId) => ({
      criterionId,
      classification,
      evidenceIds: [data.evidence[0].id],
      affectedStepIds: [],
      explanation: '根据本次渲染与实际模拟。',
      suggestion: classification === 'defect' ? '调整门的位置' : '',
    })),
  };
}
export function planner(
  finalPlan,
  roles = ['layout'],
  review = ({ data }) => opinion(data),
) {
  let index = 0;
  return async (args) => {
    if (args.role.endsWith('reviewer')) return review(args);
    if (args.role !== 'coordinator') return turn('propose');
    if (index < roles.length)
      return turn('consult', {
        target: roles[index++],
        question: '请检查这一领域并给出具体建议。',
      });
    return turn('finalize', { plan: finalPlan });
  };
}
export async function fixture(name) {
  const png = async (width, height, color) =>
    `data:image/png;base64,${(
      await sharp({ create: { width, height, channels: 4, background: color } })
        .png()
        .toBuffer()
    ).toString('base64')}`;
  const scene = createScene(name);
  scene.id = name;
  replaceMap(scene, {
    name: '工厂',
    origin: { x: 0, y: 0 },
    offset: { x: 0, y: 0 },
    warnings: [],
    collisions: [],
    source: `data:application/zip;base64,${await new JSZip().generateAsync({ type: 'base64' })}`,
    layers: [
      {
        id: 'background',
        name: '背景',
        source: await png(256, 160, '#253341'),
        width: 256,
        height: 160,
        locked: true,
        hidden: false,
        included: true,
      },
    ],
  });
  const project = createProject();
  project.projectId = `${name}-objects`;
  project.name = '已有门素材';
  const gate = createObject('toggle');
  gate.definitionId = 'gate-definition';
  gate.displayName = '铁门';
  project.assets = [
    {
      id: 'gate-art',
      name: 'gate.png',
      mime: 'image/png',
      source: await png(24, 48, '#996633'),
    },
  ];
  Object.assign(gate.visual, { assetId: 'gate-art', width: 24, height: 48 });
  gate.behavior.states[0].appearance.visible = true;
  gate.behavior.states[0].appearance.solidEnabled = true;
  gate.behavior.states[1].appearance.visible = false;
  gate.behavior.states[1].appearance.solidEnabled = false;
  project.objects = [gate];
  const material = addMaterial(scene, project, gate.definitionId);
  material.id = 'gate-material';
  const instance = addInstance(scene, material.id, 120, 100);
  scene.order = scene.order.map((id) => (id === instance.id ? 'gate' : id));
  instance.id = 'gate';
  const source = (
    await createDocument(root, manifest, {
      kind: 'interactable',
      documentId: project.projectId,
      commandId: `source-${name}`,
      content: project,
    })
  ).document;
  const document = (
    await createDocument(root, manifest, {
      kind: 'scene',
      documentId: scene.id,
      commandId: `scene-${name}`,
      content: scene,
    })
  ).document;
  return {
    document,
    source,
    spec: {
      documentId: scene.id,
      expectedRevision: 1,
      description: '拉杆开门，复用已有素材并保留地图。',
      sourceDocumentIds: [source.id],
    },
  };
}
