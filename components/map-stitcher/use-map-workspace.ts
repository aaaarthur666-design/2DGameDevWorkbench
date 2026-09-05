'use client';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { saveWorkspaceDraft } from '@/lib/workbench/browser-store';
import {
  publishEditorSession,
  removeEditorSession,
  markEditorSaved,
} from '@/lib/workbench/editor-session';
import { workbenchModules } from '@/lib/workbench/modules';
import type { WorkItem } from '@/lib/workbench/work-items';
import {
  loadMapWorkspace,
  type MapWorkspaceDraft,
} from '@/features/map-stitcher/workspace-draft';
import type { MapEditorController } from './use-map-editor-controller';

export function useMapWorkspace(c: MapEditorController) {
  const latest = useRef(c);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState({ fingerprint: '', at: '' });
  const completed = useRef('');
  const savedRef = useRef(saved);
  const chain = useRef(Promise.resolve());
  const currentSnapshot = c.getWorkspaceSnapshot();
  const { tiles: _tiles, shapes: _shapes, ...settings } = currentSnapshot;
  const fingerprint = `${c.workspaceId}:${c.revision}:${JSON.stringify(settings)}:${JSON.stringify(c.queueState)}`;
  const fingerprintRef = useRef(fingerprint);
  useLayoutEffect(() => {
    latest.current = c;
    fingerprintRef.current = fingerprint;
  });
  const href = workbenchModules.find((m) => m.id === 'map-stitcher')!.href;
  const makeItem = useCallback(
    (savedAt?: string): WorkItem | undefined => {
      const current = latest.current;
      if (!current.workspaceId || !current.sourceAsset) return;
      const active = current.queueState.active > 0;
      const waiting =
        current.queueState.paused ||
        current.queueState.jobs.some((j) => j.status === 'failed');
      return {
        id: current.workspaceId,
        capabilityId: 'map-stitcher',
        title: current.sourceAsset.name.replace(/\.[^.]+$/, ''),
        detail: active
          ? '正在处理地图生成队列'
          : waiting
            ? current.queueState.reason || '部分地图生成失败，请查看队列'
            : completed.current === fingerprintRef.current
              ? '地图资源已导出'
              : '地图草稿，可继续编辑',
        state: active
          ? 'running'
          : waiting
            ? 'attention'
            : completed.current === fingerprintRef.current
              ? 'completed'
              : 'saved',
        updatedAt: new Date().toISOString(),
        savedAt,
        href: `${href}?map=${encodeURIComponent(current.workspaceId)}`,
        draftKey: current.workspaceId,
        stage: completed.current === fingerprintRef.current ? 1 : 0,
      };
    },
    [href],
  );
  const save = useCallback(async () => {
    const current = latest.current;
    if (!current.workspaceId || !current.sourceAsset) return;
    const mark = fingerprintRef.current;
    if (savedRef.current.fingerprint === mark) return;
    const at = new Date().toISOString();
    const item = makeItem(at)!;
    // A saved draft is resumable, but a browser-owned queue never runs after the page closes.
    const storedItem: WorkItem =
      item.state === 'running'
        ? {
            ...item,
            state: 'attention',
            detail: '地图队列未完成，恢复后查看并继续',
          }
        : item;
    const draft: MapWorkspaceDraft = {
      version: 1,
      id: current.workspaceId,
      snapshot: current.getWorkspaceSnapshot(),
      pending: current.queueState.jobs
        .filter((j) => ['pending', 'running', 'failed'].includes(j.status))
        .map(({ tileKey, layer }) => ({ tileKey, layer })),
    };
    const write = chain.current
      .catch(() => undefined)
      .then(() => saveWorkspaceDraft(draft.id, draft, [storedItem]));
    chain.current = write;
    try {
      await write;
      savedRef.current = { fingerprint: mark, at };
      if (fingerprintRef.current === mark) markEditorSaved('map-stitcher');
      setSaved(savedRef.current);
      setError('');
    } catch {
      setError('地图草稿保存失败。请在原工具中保存状态文件后重试。');
      throw new Error('地图草稿保存失败，请保留页面并下载源文件。');
    }
  }, [makeItem]);
  useEffect(() => {
    let alive = true;
    const revision = latest.current.revision;
    const id = new URLSearchParams(location.search).get('map') || undefined;
    void loadMapWorkspace(id)
      .then((draft) => {
        if (!draft) return;
        if (!alive || latest.current.revision !== revision) {
          draft.snapshot.tiles.forEach((tile) =>
            Object.values(tile.images).forEach((asset) => {
              if (asset) URL.revokeObjectURL(asset.url);
            }),
          );
          return;
        }
        latest.current.restoreWorkspaceSnapshot(draft.snapshot, draft.id);
        if (draft.pending?.length) {
          latest.current.queue.pause(
            '已恢复未完成的地图队列。确认后点击继续；恢复本身不会请求图片服务。',
          );
          latest.current.queue.add(draft.pending);
        }
      })
      .catch((error) => {
        if (alive)
          setError(
            error instanceof Error ? error.message : '地图草稿恢复失败。',
          );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (loading) return;
    const item = makeItem(saved.at || undefined);
    const dirty = Boolean(item) && saved.fingerprint !== fingerprint;
    publishEditorSession({
      capabilityId: 'map-stitcher',
      items: item
        ? [{ ...item, ...(error ? { state: 'attention', detail: error } : {}) }]
        : [],
      dirty,
      busy: c.busy || c.queueState.active > 0,
      save,
      beforeLeave: () => {
        const current = latest.current;
        if (
          current.busy ||
          current.queueState.active > 0 ||
          (!current.queueState.paused &&
            current.queueState.jobs.some((j) => j.status === 'pending'))
        )
          throw new Error(
            '地图操作仍在进行。请先暂停队列并等待当前任务结束，再切换页面。',
          );
      },
    });
    if (!dirty) return;
    const timer = setTimeout(() => void save().catch(() => undefined), 800);
    return () => clearTimeout(timer);
  }, [
    loading,
    fingerprint,
    saved,
    error,
    c.busy,
    c.queueState.active,
    makeItem,
    save,
  ]);
  useEffect(() => {
    const exported = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; format: string }>)
        .detail;
      if (detail.id !== latest.current.workspaceId) return;
      if (detail.format !== 'state') completed.current = fingerprintRef.current;
      savedRef.current = { fingerprint: '', at: savedRef.current.at };
      void save().catch(() => undefined);
    };
    window.addEventListener('workbench:map-export', exported);
    return () => {
      window.removeEventListener('workbench:map-export', exported);
      removeEditorSession('map-stitcher');
    };
  }, [save]);
  return { loading, error };
}
