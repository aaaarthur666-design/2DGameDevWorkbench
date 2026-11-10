import { addMaterial, addInstance, changeAnchor, reorder, replaceInstances, replaceMap, validateScene, removeInstances, sceneMaterialProject } from '../../features/scene-composer/model.mjs';
import { sceneCommandSchema } from './scene-document-contract.mjs';
import { updateSplitSourceState } from '../../features/scene-composer/map-split-source.mjs';
import { updateMapCollisionOverride } from '../../features/scene-composer/map-collisions.mjs';
import { assertEditableSceneNodes, assertSceneMutationLocks } from '../../features/scene-composer/mutation-policy.mjs';
import { fail, selected } from './document-command-utils.mjs';

function editable(nodes) {
  try { assertEditableSceneNodes(nodes); } catch (error) { fail(error.message); }
  return nodes;
}
export function applySceneCommands(input, commands) {
  const scene = validateScene(input);
  const results = [];
  for (const raw of commands) {
    const c = sceneCommandSchema.parse(raw);
    const before = structuredClone(scene);
    const instances = () => selected(scene.instances, c.ids || [c.instanceId]);
    const nodes = (ids = c.ids) => selected([...(scene.map?.layers || []), ...scene.instances, ...(scene.mapSplit?.elements || [])], ids);
    if (c.type === 'rename') scene.name = c.name;
    else if (c.type === 'set-view') Object.assign(scene.view, c.view);
    else if (c.type === 'import-material') {
      if (c.materialId && scene.materials.some(m => m.id === c.materialId)) fail('Material ID already exists.');
      const material = addMaterial(scene, c.project, c.definitionId, c.materialId);
      results.push({ type: c.type, materialId: material.id });
    } else if (c.type === 'replace-material') {
      const material = selected(scene.materials, [c.materialId])[0];
      material.project = sceneMaterialProject(c.project, c.definitionId);
      material.name = material.project.objects[0].displayName;
      // Existing instances preserve their placement/anchor until explicitly changed.
    } else if (c.type === 'add-instance') {
      if (c.instanceId && scene.order.includes(c.instanceId)) fail('Instance ID already exists.');
      const instance = addInstance(scene, c.materialId, c.x, c.y, c.instanceId);
      results.push({ type: c.type, instanceId: instance.id });
    } else if (c.type === 'move-instances') {
      const relative = c.dx !== undefined || c.dy !== undefined;
      const absolute = c.x !== undefined || c.y !== undefined;
      if (relative === absolute) fail('Use either dx/dy or x/y for a move.');
      for (const i of editable(instances())) {
        i.x = relative ? i.x + (c.dx || 0) : (c.x ?? i.x);
        i.y = relative ? i.y + (c.dy || 0) : (c.y ?? i.y);
      }
    } else if (c.type === 'scale-instances') for (const i of editable(instances())) i.scale = c.scale;
    else if (c.type === 'flip-instances') for (const i of editable(instances())) i.flipH = c.flipH;
    else if (c.type === 'set-node-flags') {
      if ([c.locked, c.hidden, c.included].every(v => v === undefined)) fail('Provide at least one node flag.');
      for (const node of nodes()) for (const flag of ['locked', 'hidden', 'included']) if (c[flag] !== undefined) node[flag] = c[flag];
    } else if (c.type === 'reorder') {
      for (const id of c.ids) if (!scene.order.includes(id)) fail('Order includes an unknown node.');
      editable(nodes(c.ids.filter(id => id !== 'actor')));
      if (['before', 'after'].includes(c.action) && !scene.order.includes(c.target)) fail('Order target does not exist.');
      if (c.action === 'index' && typeof c.target !== 'number') fail('Index ordering requires a numeric target.');
      reorder(scene, c.ids, c.action, c.target);
    } else if (c.type === 'replace-instances') { editable(instances()); replaceInstances(scene, c.ids, c.materialId); }
    else if (c.type === 'remove-instances') {
      editable(instances());
      results.push({ type: c.type, removedInstanceIds: c.ids, removedLinkIds: removeInstances(scene, c.ids) });
    } else if (c.type === 'set-links') scene.links = c.links;
    else if (c.type === 'add-link') {
      if (scene.links.some(link => link.id === c.link.id)) fail('Link ID already exists.');
      scene.links.push(c.link);
    } else if (c.type === 'update-link') Object.assign(selected(scene.links, [c.linkId])[0], c.patch);
    else if (c.type === 'remove-links') {
      selected(scene.links, c.ids);
      scene.links = scene.links.filter(link => !c.ids.includes(link.id));
    } else if (c.type === 'replace-map') replaceMap(scene, c.map);
    else if (c.type === 'set-map-collisions') {
      if (!scene.map) fail('The scene has no map.');
      scene.map.collisions = c.collisions;
    }
    else if (c.type === 'move-map') {
      if (!scene.map) fail('The scene has no map.');
      if (!scene.map.layers.some(layer => !layer.locked)) fail('请先解锁至少一个地图层再移动地图。');
      scene.map.offset = { x: c.x, y: c.y };
    } else if (c.type === 'set-anchor') changeAnchor(editable(instances())[0], c.anchor);
    updateMapCollisionOverride(before, scene);
    updateSplitSourceState(input,scene);
    validateScene(scene);
    assertSceneMutationLocks(before, scene, { command: c });
  }
  return { content: validateScene(scene), commandResults: results };
}

