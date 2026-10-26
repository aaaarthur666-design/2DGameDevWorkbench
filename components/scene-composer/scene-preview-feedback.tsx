'use client';
import type { Scene } from '@/features/scene-composer/model.mjs';
import type { SceneSimulation } from '@/features/scene-composer/simulation.mjs';
import { linkDiagnosticLabel } from '@/features/scene-composer/link-editor.mjs';
import { previewBehaviorLabel, previewEventLabel } from '@/features/scene-composer/preview-feedback.mjs';

export function ScenePreviewFeedback({ scene, sim, selected, select }: {
  scene: Scene; sim: SceneSimulation; selected: string[]; select: (ids: string[]) => void;
}) {
  const name = (id: string) => scene.instances.find(instance => instance.id === id)?.name || '已删除物件';
  return <div className="sc-preview-feedback">
    <p className="sc-note">白色来源使用碰撞层 1。此处检查交互与联动，预览状态不会写回物件的初始配置。</p>
    <p className="sc-note">绿色：感知 · 蓝色：点击 · 橙色：碰撞。平台跳跃与实际物理需在 Godot 检查。</p>
    {sim.active && <output>正在交互：{name(sim.active.id)}</output>}
    <div aria-label="物件运行状态">
      {sim.objects.map(instance => {
        const state = sim.getLinkState(instance.id);
        return <button className="sc-preview-row" key={instance.id} aria-pressed={selected.includes(instance.id)} onClick={() => select([instance.id])}>
          <strong>{name(instance.id)}</strong>
          <span>{previewBehaviorLabel(instance)} · 成功 {instance.state.successCount} 次</span>
          {state && <small>{state.enabled ? '可交互' : '已停用'} · {state.visible ? '显示' : '隐藏'} · 实体碰撞{state.solidEnabled ? '开启' : '关闭'}</small>}
        </button>;
      })}
    </div>
    {!!sim.linkDiagnostics.length && <output className="sc-link-warning">{sim.linkDiagnostics.map((diagnostic, index) => <span key={index}>{linkDiagnosticLabel(scene, diagnostic)}<br /></span>)}</output>}
    <h3>事件与联动记录</h3>
    <div role="log" aria-label="场景事件与联动记录" aria-live="polite" className="sc-preview-events">
      {!sim.events.length && <p className="sc-note">操作来源物件后，事件与联动结果会显示在这里。</p>}
      {sim.events.slice(0, 12).map((event, index) => <p className={event.name === 'link_error' || event.name === 'link_skipped' ? 'sc-link-warning' : 'sc-note'} key={`${event.time}-${event.instanceId}-${event.name}-${index}`}>
        <time>{event.time.toFixed(2)} 秒</time> {previewEventLabel(scene, event)}
      </p>)}
    </div>
  </div>;
}
