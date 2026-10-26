import { materialFor } from './model.mjs';
import { LINK_ACTIONS, LINK_EVENTS } from './links.mjs';

export const LINK_EVENT_LABELS = {
  toggled: '开关切换后', picked_up: '拾取完成后', sequence_advanced: '序列推进后',
  interaction_finished: '一次交互结束后', interaction_completed: '物件完成后', state_changed: '状态改变后',
};
export const LINK_ACTION_LABELS = {
  set_toggle: '设置开关状态', set_enabled: '设置能否交互', set_visible: '设置显示状态',
};
const definitionFor = (scene, instanceId) => {
  const instance = scene.instances.find(item => item.id === instanceId);
  return instance ? materialFor(scene, instance)?.project.objects[0] : undefined;
};
export function linkSourceEvents(scene, instanceId) {
  const kind = definitionFor(scene, instanceId)?.behavior.kind;
  return LINK_EVENTS.filter(event => !['toggled', 'picked_up', 'sequence_advanced'].includes(event) ||
    event === ({ toggle: 'toggled', pickup: 'picked_up', sequence: 'sequence_advanced' })[kind]);
}
export function linkTargetActions(scene, instanceId) {
  const kind = definitionFor(scene, instanceId)?.behavior.kind;
  return LINK_ACTIONS.filter(action => action !== 'set_toggle' || kind === 'toggle');
}
export function canCopySourceToggle(scene, instanceId) {
  return definitionFor(scene, instanceId)?.behavior.kind === 'toggle';
}
export function reconcileLinkDraft(scene, draft, patch) {
  const next = { ...draft, ...patch };
  if (!linkSourceEvents(scene, next.sourceInstanceId).includes(next.event)) next.event = 'interaction_finished';
  if (!linkTargetActions(scene, next.targetInstanceId).includes(next.action)) next.action = 'set_enabled';
  if (next.value === 'source_toggle' && !canCopySourceToggle(scene, next.sourceInstanceId)) next.value = true;
  return next;
}
export function linkInstanceLabel(instance) {
  return `${instance.name} · ${Math.round(instance.x)}, ${Math.round(instance.y)}${instance.included ? '' : '（不参与导出）'}`;
}
export function linkValueLabel(link) {
  if (link.value === 'source_toggle') return '跟随来源开关';
  return ({ set_toggle: ['关闭', '开启'], set_enabled: ['停用', '启用'], set_visible: ['隐藏', '显示'] })[link.action]?.[link.value ? 1 : 0] || '';
}
export function linkDescription(scene, link) {
  const source = scene.instances.find(item => item.id === link.sourceInstanceId)?.name || '来源已删除';
  const target = scene.instances.find(item => item.id === link.targetInstanceId)?.name || '目标已删除';
  return `${source} · ${LINK_EVENT_LABELS[link.event] || link.event} → ${target} · ${LINK_ACTION_LABELS[link.action] || link.action}：${linkValueLabel(link)}`;
}
export function linkDiagnosticLabel(scene, diagnostic) {
  const link = (scene.links || []).find(item => item.id === diagnostic.linkId);
  const prefix = link ? `${linkDescription(scene, link)}：` : '';
  const messages = {
    LINK_ENDPOINT_MISSING: '来源或目标物件已不存在，请重新选择或删除这条联动。',
    LINK_EVENT_KIND: '来源物件的行为不支持这个事件，请重新选择事件。',
    LINK_ACTION_KIND: '目标不是开关物件，请更换目标或执行动作。',
    LINK_VALUE_KIND: '只有开关来源能使用“跟随来源开关”。',
    LINK_ENDPOINT_EXCLUDED: '启用时，两端物件都须参与导出。',
    LINK_ID_DUPLICATE: '存在重复联动，请删除重复项后重新创建。',
    LINK_CYCLE: '联动不能连接自身或形成循环，请停用或删除其中一条。',
    LINK_LIMIT: '场景联动已达数量上限，请先删除不需要的联动。',
  };
  return prefix + (messages[diagnostic.code] || diagnostic.message);
}
