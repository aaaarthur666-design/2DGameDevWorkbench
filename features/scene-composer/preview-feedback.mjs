import { LINK_ACTION_LABELS } from './link-editor.mjs';

const eventLabels = {
  picked_up: '已拾取', toggled: '已切换', sequence_advanced: '序列推进',
  interaction_finished: '交互结束', interaction_started: '开始交互', interaction_completed: '已完成',
  interaction_cancelled: '交互已取消', focus_entered: '进入焦点', focus_exited: '离开焦点',
  state_changed: '状态已改变', play_animation: '播放动画', play_audio: '播放音效',
};
export function previewEventLabel(scene, event) {
  const name = id => scene.instances.find(instance => instance.id === id)?.name || '已删除物件';
  if (['link_applied', 'link_skipped', 'link_error'].includes(event.name)) {
    const route = `${name(event.sourceInstanceId || event.instanceId)} → ${name(event.targetInstanceId)}`;
    if (event.name === 'link_skipped') return `${route} · 目标不可用，联动未执行`;
    if (event.name === 'link_error') return `${route} · 联动已停止，请检查循环或执行上限`;
    const value = event.action === 'set_toggle' ? (event.value ? '开启' : '关闭') : event.action === 'set_visible' ? (event.value ? '显示' : '隐藏') : (event.value ? '启用' : '停用');
    return `${route} · ${LINK_ACTION_LABELS[event.action] || '设置状态'}：${value}${event.changed === false ? '（状态未变化）' : ''}`;
  }
  return `${name(event.instanceId)} · ${eventLabels[event.name] || '交互事件'}${event.name === 'toggled' ? (event.result.toggleState ? '到状态 B' : '到状态 A') : ''}`;
}
export function previewBehaviorLabel(instance) {
  const { definition, state } = instance;
  if (definition.behavior.kind === 'toggle') return `状态 ${state.toggleState ? 'B' : 'A'}${state.completed ? ' · 已完成' : ''}`;
  if (definition.behavior.kind === 'sequence') return `${state.completed ? '序列已完成' : `下一步 ${Math.min(state.sequenceIndex + 1, definition.behavior.entries.length)} / ${definition.behavior.entries.length}`}`;
  return state.completed ? (definition.behavior.kind === 'pickup' ? '已拾取' : '已完成') : instance.inRange ? '范围内' : '等待交互';
}
