'use client';
import { useId, useState } from 'react';
import { Link2, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { makeId } from '@/features/interactable-editor/contract.mjs';
import type { Scene } from '@/features/scene-composer/model.mjs';
import { MAX_SCENE_LINKS, sceneLinkDiagnostics, type SceneLink } from '@/features/scene-composer/links.mjs';
import { canCopySourceToggle, LINK_ACTION_LABELS, LINK_EVENT_LABELS, linkDescription, linkDiagnosticLabel, linkInstanceLabel, linkSourceEvents, linkTargetActions, reconcileLinkDraft } from '@/features/scene-composer/link-editor.mjs';

type Draft = { link: SceneLink; sceneId: string; previous: string | null };
export function SceneLinksPanel({ scene, selected, disabled, edit, select }: {
  scene: Scene; selected: string[]; disabled: boolean;
  edit: (update: (draft: Scene) => void) => boolean; select: (ids: string[]) => void;
}) {
  const prefix = useId();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState(false);
  const links = scene.links || [];
  const diagnostics = sceneLinkDiagnostics(scene);
  const draftScene = draft ? { ...scene, links: draft.previous === null ? [...links, draft.link] : links.map(link => link.id === draft.link.id ? draft.link : link) } : null;
  const draftDiagnostics = draftScene ? sceneLinkDiagnostics(draftScene) : [];
  const source = draft && scene.instances.find(instance => instance.id === draft.link.sourceInstanceId);
  const target = draft && scene.instances.find(instance => instance.id === draft.link.targetInstanceId);
  const unavailable = draft && (!source || !target || source.id === target.id ||
    (draft.link.enabled && (!source.included || !target.included)) || scene.id !== draft.sceneId ||
    (draft.previous !== null && !links.some(link => link.id === draft.link.id)));
  const update = (patch: Partial<SceneLink>) => setDraft(current => current ? ({ ...current, link: reconcileLinkDraft(scene, current.link, patch) }) : null);
  const create = () => {
    const source = scene.instances.find(instance => selected.includes(instance.id)) || scene.instances[0];
    const target = scene.instances.find(instance => instance.id !== source?.id);
    if (!source || !target) return;
    const toggle = canCopySourceToggle(scene, source.id) && linkTargetActions(scene, target.id).includes('set_toggle');
    setDraft({ sceneId: scene.id, previous: null, link: {
      id: makeId('link'), sourceInstanceId: source.id, event: toggle ? 'toggled' : 'interaction_finished',
      targetInstanceId: target.id, action: toggle ? 'set_toggle' : 'set_enabled',
      value: toggle ? 'source_toggle' : true, enabled: source.included && target.included,
    } });
    setMessage(''); setOpen(true);
  };
  const save = () => {
    if (!draft || unavailable || draftDiagnostics.length) return;
    const incoming = structuredClone(draft.link);
    const applied = edit(next => {
      if (next.id !== draft.sceneId) throw new Error('场景已变化，请重新选择联动。');
      const index = next.links.findIndex(link => link.id === incoming.id);
      if (draft.previous !== null) {
        if (index < 0 || JSON.stringify(next.links[index]) !== draft.previous)
          throw new Error('这条联动已被其他编辑更新，请重新选择后再修改。');
        next.links[index] = incoming;
      } else next.links.push(incoming);
    });
    if (applied) { setDraft(null); setMessage('联动已保存，随场景自动同步。进入交互预览可检查效果。'); }
    else setMessage('联动未保存，请查看场景提示并修正。');
  };
  return <details className="sc-links-panel" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><Link2 size={15} />物件联动 · {links.length}</summary>
    <p className="sc-note">让一个物件的事件改变另一个物件。联动保存在当前场景中。</p>
    {!links.length && <p className="sc-note">尚未设置联动。</p>}
    <ul className="sc-links-list">
      {links.map(link => <li key={link.id}>
        <p>{linkDescription(scene, link)}</p>
        <label className="sc-check"><input type="checkbox" aria-label={`启用联动 ${linkDescription(scene, link)}`} checked={link.enabled} disabled={disabled} onChange={event => edit(next => {
          const current = next.links.find(item => item.id === link.id);
          if (current) current.enabled = event.target.checked;
        })} />启用</label>
        <div className="sc-link-actions">
          <Button size="xs" variant="outline" disabled={disabled} onClick={() => { setDraft({ link: structuredClone(link), sceneId: scene.id, previous: JSON.stringify(link) }); setMessage(''); }}><Pencil />编辑联动</Button>
          <Button size="xs" variant="ghost" disabled={disabled} onClick={() => {
            if (edit(next => { next.links = next.links.filter(item => item.id !== link.id); })) {
              if (draft?.link.id === link.id) setDraft(null);
              setMessage('联动已删除，可用撤销恢复。');
            }
          }}><Trash2 />删除联动</Button>
          <Button size="xs" variant="ghost" disabled={disabled} onClick={() => select([link.sourceInstanceId, link.targetInstanceId].filter(id => scene.instances.some(instance => instance.id === id)))}>选中两端</Button>
        </div>
      </li>)}
    </ul>
    <Button size="sm" variant="outline" disabled={disabled || scene.instances.length < 2 || links.length >= MAX_SCENE_LINKS} onClick={create}><Plus />新增联动</Button>
    {scene.instances.length < 2 && <p className="sc-note">先在场景中摆放至少两个物件。</p>}
    {draft && <fieldset className="sc-link-form" disabled={disabled}>
      <legend>{draft.previous === null ? '新增联动' : '编辑联动'}</legend>
      <label className="sc-field" htmlFor={`${prefix}-source`}>来源物件<select id={`${prefix}-source`} value={draft.link.sourceInstanceId} onChange={event => update({ sourceInstanceId: event.target.value })}>
        {!source && <option value={draft.link.sourceInstanceId}>来源已不存在，请重新选择</option>}
        {scene.instances.map(instance => <option key={instance.id} value={instance.id}>{linkInstanceLabel(instance)}</option>)}
      </select></label>
      <label className="sc-field" htmlFor={`${prefix}-event`}>发生事件<select id={`${prefix}-event`} value={draft.link.event} onChange={event => update({ event: event.target.value as SceneLink['event'] })}>
        {linkSourceEvents(scene, draft.link.sourceInstanceId).map(event => <option key={event} value={event}>{LINK_EVENT_LABELS[event]}</option>)}
      </select></label>
      <label className="sc-field" htmlFor={`${prefix}-target`}>目标物件<select id={`${prefix}-target`} value={draft.link.targetInstanceId} onChange={event => update({ targetInstanceId: event.target.value })}>
        {!target && <option value={draft.link.targetInstanceId}>目标已不存在，请重新选择</option>}
        {scene.instances.filter(instance => instance.id !== draft.link.sourceInstanceId).map(instance => <option key={instance.id} value={instance.id}>{linkInstanceLabel(instance)}</option>)}
      </select></label>
      <label className="sc-field" htmlFor={`${prefix}-action`}>执行动作<select id={`${prefix}-action`} value={draft.link.action} onChange={event => update({ action: event.target.value as SceneLink['action'] })}>
        {linkTargetActions(scene, draft.link.targetInstanceId).map(action => <option key={action} value={action}>{LINK_ACTION_LABELS[action]}</option>)}
      </select></label>
      <label className="sc-field" htmlFor={`${prefix}-value`}>目标值<select id={`${prefix}-value`} value={String(draft.link.value)} onChange={event => update({ value: event.target.value === 'source_toggle' ? 'source_toggle' : event.target.value === 'true' })}>
        <option value="true">{draft.link.action === 'set_toggle' ? '开启' : draft.link.action === 'set_visible' ? '显示' : '启用'}</option>
        <option value="false">{draft.link.action === 'set_toggle' ? '关闭' : draft.link.action === 'set_visible' ? '隐藏' : '停用'}</option>
        {canCopySourceToggle(scene, draft.link.sourceInstanceId) && <option value="source_toggle">跟随来源开关（开则开启 / 显示 / 启用）</option>}
      </select></label>
      <label className="sc-check"><input type="checkbox" checked={draft.link.enabled} onChange={event => update({ enabled: event.target.checked })} />启用这条联动</label>
      {unavailable && <p className="sc-link-warning">请检查两端物件：它们须存在且不同，启用时须参与导出。场景或联动若已变化，请重新选择。</p>}
      {!!draftDiagnostics.length && draftScene && <div className="sc-link-warning">{draftDiagnostics.map((diagnostic, index) => <p key={index}>{linkDiagnosticLabel(draftScene, diagnostic)}</p>)}</div>}
      <div className="sc-link-actions"><Button size="sm" disabled={!!unavailable || draftDiagnostics.length > 0} onClick={save}>保存联动</Button><Button size="sm" variant="ghost" onClick={() => { setDraft(null); setMessage(''); }}>取消编辑</Button></div>
    </fieldset>}
    {!!diagnostics.length && <output className="sc-link-warning">{diagnostics.map((diagnostic, index) => <span key={index}>{linkDiagnosticLabel(scene, diagnostic)}<br /></span>)}</output>}
    {message && <output>{message}</output>}
    <p className="sc-note">设置状态不会重跑目标的交互，也不会增加目标成功次数。删除物件时会移除与它连接的联动。</p>
  </details>;
}
