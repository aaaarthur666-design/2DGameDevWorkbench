import { z } from 'zod';

export const LINK_EVENTS = ['toggled', 'picked_up', 'sequence_advanced', 'interaction_finished', 'interaction_completed', 'state_changed'];
export const LINK_ACTIONS = ['set_toggle', 'set_enabled', 'set_visible'];
export const MAX_SCENE_LINKS = 256;
export const MAX_LINK_ACTIONS = 256;
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const sceneLinkSchema = z.object({
  id,
  sourceInstanceId: id,
  event: z.enum(LINK_EVENTS),
  targetInstanceId: id,
  action: z.enum(LINK_ACTIONS),
  value: z.union([z.boolean(), z.literal('source_toggle')]),
  enabled: z.boolean().default(true),
}).strict();

export function sceneLinkDiagnostics(scene) {
  const diagnostics = [];
  const instances = new Map(scene.instances.map(instance => [instance.id, instance]));
  const definitions = new Map(scene.materials.map(material => [material.id, material.project.objects[0]]));
  const ids = new Set();
  const links = scene.links || [];
  const error = (link, code, message) => diagnostics.push({ severity: 'error', code, linkId: link?.id, message });
  if (links.length > MAX_SCENE_LINKS) error(null, 'LINK_LIMIT', `场景联动最多 ${MAX_SCENE_LINKS} 条。`);
  for (const link of links) {
    if (ids.has(link.id)) error(link, 'LINK_ID_DUPLICATE', `联动 ${link.id} 身份重复。`);
    ids.add(link.id);
    const source = instances.get(link.sourceInstanceId);
    const target = instances.get(link.targetInstanceId);
    if (!source || !target) { error(link, 'LINK_ENDPOINT_MISSING', `联动 ${link.id} 的来源或目标实例不存在。`); continue; }
    const sourceKind = definitions.get(source.materialId)?.behavior.kind;
    const targetKind = definitions.get(target.materialId)?.behavior.kind;
    const eventKind = { toggled: 'toggle', picked_up: 'pickup', sequence_advanced: 'sequence' }[link.event];
    if (eventKind && sourceKind !== eventKind) error(link, 'LINK_EVENT_KIND', `联动 ${link.id} 的 ${link.event} 事件需要 ${eventKind} 来源。`);
    if (link.action === 'set_toggle' && targetKind !== 'toggle') error(link, 'LINK_ACTION_KIND', `联动 ${link.id} 的 set_toggle 目标必须是 toggle 物件。`);
    if (link.value === 'source_toggle' && sourceKind !== 'toggle') error(link, 'LINK_VALUE_KIND', `联动 ${link.id} 的 source_toggle 需要 toggle 来源。`);
    if (link.enabled && (!source.included || !target.included)) error(link, 'LINK_ENDPOINT_EXCLUDED', `启用的联动 ${link.id} 两端必须参与导出。`);
  }
  // Reject enabled directed cycles conservatively, even when constant values
  // could happen to converge. Runtime dispatch remains bounded independently.
  const graph = new Map(); const indegree = new Map();
  for (const link of links.filter(link => link.enabled)) {
    if (!instances.has(link.sourceInstanceId) || !instances.has(link.targetInstanceId)) continue;
    if (!graph.has(link.sourceInstanceId)) graph.set(link.sourceInstanceId, []);
    graph.get(link.sourceInstanceId).push(link.targetInstanceId);
    indegree.set(link.sourceInstanceId, indegree.get(link.sourceInstanceId) || 0);
    indegree.set(link.targetInstanceId, (indegree.get(link.targetInstanceId) || 0) + 1);
  }
  const queue = [...indegree].filter(([, count]) => count === 0).map(([instanceId]) => instanceId);
  let processed = 0;
  for (let n = 0; n < queue.length; n++) {
    processed++;
    for (const target of graph.get(queue[n]) || []) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  if (processed !== indegree.size) error(null, 'LINK_CYCLE', '启用的场景联动不能形成有向循环或连接自身；请删除或停用其中一条。');
  return diagnostics;
}

export function validateSceneLinks(scene) {
  const diagnostics = sceneLinkDiagnostics(scene);
  if (diagnostics.length) throw Object.assign(new Error(diagnostics.map(entry => entry.message).join('\n')), { code: diagnostics[0].code, diagnostics });
  return scene;
}
