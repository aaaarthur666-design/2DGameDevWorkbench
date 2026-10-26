import '../helpers/runtime-workspace.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createProject, createObject } from '../../features/interactable-editor/contract.mjs';
import { createScene, validateScene, addMaterial, addInstance, removeInstances, replaceInstances } from '../../features/scene-composer/model.mjs';
import { MAX_LINK_ACTIONS, sceneLinkDiagnostics } from '../../features/scene-composer/links.mjs';
import { createSceneSimulation } from '../../features/scene-composer/simulation.mjs';
import { replaySimulationEvents } from '../../features/scene-composer/simulation-replay.mjs';
import { createScenePackage, readScenePackage } from '../../features/scene-composer/package.mjs';
import { createDocument, applyDocumentCommands, getDocument, validateDocument, simulateDocument } from '../../lib/workbench/editor-documents.mjs';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
function fixture() {
  const scene = createScene('Switch room'); scene.id = 'linked-scene';
  const material = (id, kind = 'toggle') => {
    const project = createProject(); project.projectId = `project-${id}`; project.objects = [createObject(kind)]; project.objects[0].definitionId = `definition-${id}`;
    const m = addMaterial(scene, project, project.objects[0].definitionId); m.id = `material-${id}`;
    return m;
  };
  const source = addInstance(scene, material('switch').id, 40, 60); source.id = 'switch';
  const gateMaterial = material('gate');
  gateMaterial.project.objects[0].behavior.states[0].appearance.visible = true;
  gateMaterial.project.objects[0].behavior.states[0].appearance.solidEnabled = true;
  gateMaterial.project.objects[0].behavior.states[1].appearance.visible = false;
  gateMaterial.project.objects[0].behavior.states[1].appearance.solidEnabled = false;
  const target = addInstance(scene, gateMaterial.id, 160, 60); target.id = 'gate';
  scene.order = ['switch', 'gate', 'actor'];
  const link = { id: 'switch-gate', sourceInstanceId: 'switch', event: 'toggled', targetInstanceId: 'gate', action: 'set_toggle', value: 'source_toggle', enabled: true };
  scene.links = [link];
  return { scene, source, target, material, link };
}
const request = instanceId => ({ type: 'request', instanceId });

test('old scene migration and portable source preserve stable link IDs', async () => {
  const { scene } = fixture();
  const legacy = structuredClone(scene); delete legacy.links;
  assert.deepEqual(validateScene(legacy).links, []);
  assert.deepEqual((await readScenePackage(await createScenePackage(scene))).links, scene.links);
});
test('invalid endpoints, kinds, duplicate IDs, excluded endpoints and scripts are rejected', () => {
  for (const [change, code] of [
    [link => { link.targetInstanceId = 'missing'; }, 'LINK_ENDPOINT_MISSING'],
    [link => { link.event = 'picked_up'; }, 'LINK_EVENT_KIND'],
  ]) {
    const { scene } = fixture(); change(scene.links[0]);
    assert.throws(() => validateScene(scene), error => error.code === code);
  }
  const { scene, target, material } = fixture(); target.included = false;
  assert.equal(sceneLinkDiagnostics(scene)[0].code, 'LINK_ENDPOINT_EXCLUDED');
  scene.links[0].enabled = false; validateScene(scene);
  scene.links.push(structuredClone(scene.links[0]));
  assert.throws(() => validateScene(scene), error => error.code === 'LINK_ID_DUPLICATE');
  scene.links.pop(); target.included = true;
  const inspect = material('inspect', 'inspect'); target.materialId = inspect.id;
  assert.throws(() => validateScene(scene), error => error.code === 'LINK_ACTION_KIND');
  scene.links[0].script = 'eval()'; assert.throws(() => validateScene(scene));
});
test('enabled cycles and self edges reject; disabled back edges remain editable', () => {
  const { scene, link } = fixture();
  scene.links.push({ ...link, id: 'return', sourceInstanceId: 'gate', targetInstanceId: 'switch', event: 'state_changed' });
  assert.throws(() => validateScene(scene), error => error.code === 'LINK_CYCLE');
  scene.links[1].enabled = false; validateScene(scene);
  scene.links[0].targetInstanceId = 'switch';
  assert.throws(() => validateScene(scene), error => error.code === 'LINK_CYCLE');
});
test('removal prunes related links, copies do not acquire wiring, replacement checks kind', () => {
  const { scene, material } = fixture();
  const copy = addInstance(scene, scene.instances[0].materialId, 80, 60); copy.id = 'copy'; scene.order = ['switch', 'copy', 'gate', 'actor'];
  assert.equal(scene.links.length, 1);
  assert.ok(scene.links.every(link => link.sourceInstanceId !== copy.id && link.targetInstanceId !== copy.id));
  const replacement = material('new-toggle'); replaceInstances(scene, ['gate'], replacement.id); validateScene(scene);
  const wrong = material('wrong', 'inspect'); replaceInstances(scene, ['gate'], wrong.id);
  assert.throws(() => validateScene(scene), error => error.code === 'LINK_ACTION_KIND');
  assert.deepEqual(removeInstances(scene, ['gate']), ['switch-gate']);
  assert.deepEqual(scene.links, []); validateScene(scene);
});
test('switch copies open/close state and collision appearance without extra interactions', () => {
  const { scene } = fixture(); const original = JSON.stringify(scene);
  const sim = createSceneSimulation(scene);
  const opened = replaySimulationEvents(sim, [request('switch')]);
  assert.equal(sim.getLinkState('gate').toggleState, true);
  assert.equal(sim.getLinkState('gate').visible, false);
  assert.equal(sim.getLinkState('gate').solidEnabled, false);
  assert.equal(sim.getLinkState('gate').successCount, 0);
  assert.equal(sim.getLinkState('switch').successCount, 1);
  assert.deepEqual(opened.events.map(event => event.name), ['interaction_started', 'toggled', 'interaction_finished', 'state_changed', 'link_applied', 'state_changed']);
  replaySimulationEvents(sim, [request('switch')]);
  assert.equal(sim.getLinkState('gate').toggleState, false);
  assert.equal(sim.getLinkState('gate').visible, true);
  assert.equal(sim.getLinkState('gate').solidEnabled, true);
  assert.equal(JSON.stringify(scene), original);
});
test('FIFO chaining uses state_changed and no-op actions do not re-emit changes', () => {
  const { scene, material, link } = fixture();
  const lamp = addInstance(scene, material('lamp', 'inspect').id, 200, 60); lamp.id = 'lamp'; scene.order = ['switch', 'gate', 'lamp', 'actor'];
  scene.links.push({ ...link, id: 'gate-lamp', sourceInstanceId: 'gate', event: 'state_changed', targetInstanceId: 'lamp', action: 'set_visible', value: false });
  const sim = createSceneSimulation(scene); replaySimulationEvents(sim, [request('switch')]);
  assert.equal(sim.objects.find(instance => instance.id === 'lamp').visible, false);
  assert.equal(sim.objects.find(instance => instance.id === 'lamp').visibleOverride, false);
  assert.deepEqual(sim.eventLog.filter(event => event.name === 'link_applied').map(event => event.linkId), ['switch-gate', 'gate-lamp']);
  replaySimulationEvents(sim, [request('switch')]);
  assert.equal(sim.eventLog.filter(event => event.name === 'link_applied' && event.linkId === 'gate-lamp').at(-1).changed, false);
  assert.equal(sim.eventLog.filter(event => event.name === 'state_changed' && event.instanceId === 'lamp').length, 1);
  sim.reset(); assert.equal(sim.getLinkState('lamp').visible, true); assert.equal(sim.objects.find(instance => instance.id === 'lamp').visibleOverride, null);
});
test('enabling a disabled definition changes eligibility and reset restores it', () => {
  const { scene } = fixture(); scene.links[0].action = 'set_enabled'; scene.links[0].value = true;
  scene.materials.find(material => material.id === 'material-gate').project.objects[0].activation.enabled = false;
  const sim = createSceneSimulation(scene);
  assert.equal(sim.request(sim.objects.find(instance => instance.id === 'gate')), false);
  replaySimulationEvents(sim, [request('switch')]);
  assert.equal(sim.getLinkState('gate').enabled, true);
  assert.equal(sim.request(sim.objects.find(instance => instance.id === 'gate')), true);
  sim.reset(); assert.equal(sim.getLinkState('gate').enabled, false);
});
test('links defer until feedback commits; disabled links do not attempt actions', () => {
  const { scene } = fixture(); scene.materials[0].project.objects[0].feedback = [{ type: 'wait', seconds: 0.5 }];
  const sim = createSceneSimulation(scene); replaySimulationEvents(sim, [request('switch')]);
  assert.equal(sim.active.id, 'switch'); assert.equal(sim.getLinkState('gate').toggleState, false); assert.equal(sim.linkAttempts, 0);
  replaySimulationEvents(sim, [{ type: 'tick', seconds: 1 }]); assert.equal(sim.getLinkState('gate').toggleState, true);
  scene.links[0].enabled = false; const disabled = createSceneSimulation(scene);
  replaySimulationEvents(disabled, [request('switch'), { type: 'tick', seconds: 1 }]); assert.equal(disabled.linkAttempts, 0);
});
test('runtime unavailable targets skip and action budget stops corrupted queues', () => {
  const { scene } = fixture(); const sim = createSceneSimulation(scene);
  sim.objects = sim.objects.filter(instance => instance.id !== 'gate'); replaySimulationEvents(sim, [request('switch')]);
  assert.equal(sim.eventLog.find(event => event.name === 'link_skipped').reason, 'target_unavailable');
  const bounded = createSceneSimulation(scene);
  bounded.links = Array.from({ length: MAX_LINK_ACTIONS + 1 }, (_, index) => ({ ...scene.links[0], id: `runtime-${index}` }));
  replaySimulationEvents(bounded, [request('switch')]);
  assert.equal(bounded.linkAttempts, MAX_LINK_ACTIONS); assert.equal(bounded.linkDiagnostics[0].code, 'LINK_ACTION_LIMIT');
  assert.ok(bounded.eventLog.some(event => event.name === 'link_error'));
});
test('replay validates all typed inputs before applying any event', () => {
  const { scene } = fixture(); const sim = createSceneSimulation(scene);
  assert.throws(() => replaySimulationEvents(sim, [request('switch'), { type: 'set-state', toggleState: true }]));
  assert.equal(sim.getLinkState('switch').successCount, 0);
  assert.throws(() => replaySimulationEvents(sim, Array.from({ length: 201 }, () => ({ type: 'press' }))));
});
test('shared commands, idempotency, rollback and exact state checks retain the document', async () => {
  const base = path.resolve('work/test-runs', process.env.WORKBENCH_TEST_RUN); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'scene-links-'));
  const manifest = { workspace: { taskDirectory: 'work/tasks', outputDirectory: 'outputs', documentDirectory: 'work/editor-documents' } };
  try {
    const { scene, link } = fixture(); scene.links = [];
    await createDocument(root, manifest, { kind: 'scene', commandId: 'create', content: scene });
    const requestInput = { documentId: scene.id, expectedRevision: 1, commandId: 'wire', commands: [{ type: 'add-link', link }] };
    const wired = await applyDocumentCommands(root, manifest, requestInput); assert.equal(wired.document.revision, 2);
    assert.equal((await applyDocumentCommands(root, manifest, requestInput)).replayed, true);
    const opened = await simulateDocument(root, manifest, { documentId: scene.id, revision: 2, events: [request('switch')], expectEvents: [{ name: 'link_applied' }], expectStates: [{ instanceId: 'gate', toggleState: true, visible: false, solidEnabled: false, successCount: 0 }] });
    assert.equal(opened.passed, true); assert.equal(opened.linkAttempts, 1); assert.equal(opened.checks.at(-1).type, 'state');
    const failed = await simulateDocument(root, manifest, { documentId: scene.id, events: [request('switch')], expectStates: [{ instanceId: 'gate', visible: true }] });
    assert.equal(failed.passed, false);
    assert.equal((await getDocument(root, manifest, { documentId: scene.id })).document.contentHash, wired.document.contentHash);
    assert.equal((await validateDocument(root, manifest, { documentId: scene.id })).counts.links, 1);
    await assert.rejects(applyDocumentCommands(root, manifest, { documentId: scene.id, expectedRevision: 2, commandId: 'cycle', commands: [{ type: 'rename', name: 'must rollback' }, { type: 'add-link', link: { ...link, id: 'reverse', sourceInstanceId: 'gate', targetInstanceId: 'switch' } }] }), error => error.code === 'LINK_CYCLE');
    assert.equal((await getDocument(root, manifest, { documentId: scene.id })).document.name, scene.name);
    const removed = await applyDocumentCommands(root, manifest, { documentId: scene.id, expectedRevision: 2, commandId: 'remove-target', commands: [{ type: 'remove-instances', ids: ['gate'] }] });
    assert.deepEqual(removed.document.content.links, []); assert.deepEqual(removed.document.commandResults[0].removedLinkIds, ['switch-gate']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const [name, fn] of tests) { await fn(); process.stdout.write(`PASS ${name}\n`); }
process.stdout.write(`Scene links: ${tests.length} deterministic fixture tests passed; paid calls 0.\n`);
