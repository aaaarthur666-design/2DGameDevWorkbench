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
import { fetchMapProject, persistMapProject } from '@/features/map-stitcher/project-client';
import { createMapPreviewCache } from '@/features/map-stitcher/project-preview';
import type { ImageWriteTicket } from '@/features/map-stitcher/editor-state';
import type { ImageAdoptionReceipt } from '@/features/image-edit/client';

export type MapSavedImageGuard = { projectId: string; revision: number; sha256: string; fingerprint: string; ticket: ImageWriteTicket };
function workspaceFingerprint(c: MapEditorController, revision = c.revision) {
  const { tiles: _tiles, shapes: _shapes, ...settings } = c.getWorkspaceSnapshot();
  return `${c.workspaceId}:${revision}:${JSON.stringify(settings)}:${JSON.stringify(c.queueState)}`;
}

export function useMapWorkspace(c: MapEditorController) {
  const latest = useRef(c);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState({ fingerprint: '', at: '' });
  const completed = useRef('');
  const savedRef = useRef(saved);
  const chain = useRef(Promise.resolve());
  const saving = useRef<Promise<void> | null>(null);
  const adoptionBarrier = useRef(false);
  const revisions = useRef(new Map<string, number>());
  const sourceHashes = useRef(new Map<string, string>());
  const previewCache = useRef<ReturnType<typeof createMapPreviewCache> | null>(null);
  previewCache.current ||= createMapPreviewCache();
  const fingerprint = workspaceFingerprint(c);
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
    if (adoptionBarrier.current) throw new Error('已采用图片正在协调共享版本；请保留页面，完成读取后再保存。');
    if (saving.current) return saving.current;
    const write = chain.current
      .catch(() => undefined)
      .then(async () => {
        while (true) {
          if (adoptionBarrier.current) throw new Error('已采用结果尚未协调，旧地图草稿未写回服务端。');
          const current = latest.current;
          if (!current.workspaceId || !current.sourceAsset) return;
          const mark = fingerprintRef.current;
          if (savedRef.current.fingerprint === mark) return;
          const at = new Date().toISOString();
          const item = makeItem(at)!;
          const storedItem: WorkItem = item.state === 'running'
            ? { ...item, state: 'attention', detail: '地图队列未完成，恢复后查看并继续' } : item;
          const draft: MapWorkspaceDraft = {
            version: 1, id: current.workspaceId, snapshot: current.getWorkspaceSnapshot(),
            pending: current.queueState.jobs.filter(j => ['pending', 'running', 'failed'].includes(j.status))
              .map(({ tileKey, layer, request }) => ({ tileKey, layer, request })),
          };
          const serverRevision = revisions.current.get(draft.id) || 0;
          await saveWorkspaceDraft(draft.id, { ...draft, serverRevision, serverSynced: false }, [storedItem], 'map-current');
          const preview = await previewCache.current!(draft.snapshot);
          const committed = await persistMapProject(draft, serverRevision, preview);
          revisions.current.set(draft.id, committed.revision);
          sourceHashes.current.set(draft.id, committed.sha256);
          await saveWorkspaceDraft(draft.id, { ...draft, serverRevision: committed.revision, serverSha256: committed.sha256, serverSynced: true }, [storedItem], 'map-current');
          savedRef.current = { fingerprint: mark, at };
          setSaved(savedRef.current);
          setError('');
          if (fingerprintRef.current === mark) {
            markEditorSaved('map-stitcher');
            return;
          }
        }
      });
    chain.current = write;
    saving.current = write;
    try {
      await write;
    } catch (error) {
      const message = error instanceof Error ? error.message : '地图工程保存失败，请保留页面并下载源文件。';
      setError(message);
      throw new Error(message);
    } finally { if (saving.current === write) saving.current = null; }
  }, [makeItem]);
  const flushSaved = async (ticket: ImageWriteTicket): Promise<MapSavedImageGuard> => {
    await save();
    const current = latest.current;
    current.assertImageEditTicket(ticket);
    const revision = revisions.current.get(current.workspaceId), sha256 = sourceHashes.current.get(current.workspaceId);
    if (!revision || !sha256 || savedRef.current.fingerprint !== fingerprintRef.current)
      throw new Error('地图最新内容尚未保存到服务端，请重试。');
    return { projectId: current.workspaceId, revision, sha256, fingerprint: fingerprintRef.current, ticket };
  };
  const assertImageGuard = (guard: MapSavedImageGuard) => {
    const current = latest.current;
    current.assertImageEditTicket(guard.ticket);
    if (current.workspaceId !== guard.projectId || fingerprintRef.current !== guard.fingerprint || revisions.current.get(guard.projectId) !== guard.revision)
      throw new Error('地图在图片调整期间已变化，候选未覆盖本机内容。');
  };
  const acceptAdopted = async (receipt: ImageAdoptionReceipt, guard: MapSavedImageGuard): Promise<MapSavedImageGuard> => {
    adoptionBarrier.current = true;
    let loaded: Awaited<ReturnType<typeof fetchMapProject>>, installed = false;
    try {
      await chain.current;
      assertImageGuard(guard);
      const ref = receipt.target.targetRef;
      if (ref.kind !== 'map-layer' || ref.projectId !== guard.projectId || ref.tileKey !== guard.ticket.tileKey || ref.layer !== guard.ticket.layer || typeof receipt.revision !== 'number' || receipt.currentRevision !== receipt.revision)
        throw new Error('图片采用结果与当前地图目标或版本不匹配。');
      loaded = await fetchMapProject(guard.projectId, receipt.revision);
      if (!loaded) throw new Error('已采用图片的地图源包不存在。');
      if (loaded.serverSha256 !== receipt.target.source?.projectSha256)
        throw new Error('已采用地图的真实源包哈希与采用记录不符。');
      assertImageGuard(guard);
      if (loaded.serverRevision === guard.revision) {
        if (loaded.serverSha256 !== guard.sha256) throw new Error('重复采用响应的源包哈希已变化。');
        for (const tile of loaded.snapshot.tiles) for (const asset of Object.values(tile.images)) if (asset) URL.revokeObjectURL(asset.url);
        adoptionBarrier.current = false;
        setError('');
        return guard;
      }
      if (loaded.serverRevision < guard.revision) throw new Error('历史采用响应不能替换较新的本机地图。');
      const current = latest.current;
      const nextRevision = current.restoreAdoptedImage(loaded.snapshot, guard.ticket);
      installed = true;
      revisions.current.set(guard.projectId, loaded.serverRevision);
      sourceHashes.current.set(guard.projectId, loaded.serverSha256);
      const mark = workspaceFingerprint(current, nextRevision);
      fingerprintRef.current = mark;
      savedRef.current = { fingerprint: mark, at: new Date().toISOString() };
      setSaved(savedRef.current);
      const item = makeItem(savedRef.current.at);
      await saveWorkspaceDraft(guard.projectId, loaded, item ? [item] : [], 'map-current');
      completed.current = '';
      setError('');
      adoptionBarrier.current = false;
      markEditorSaved('map-stitcher');
      return { projectId: guard.projectId, revision: loaded.serverRevision, sha256: loaded.serverSha256, fingerprint: mark, ticket: current.captureImageTicket(guard.ticket.tileKey, guard.ticket.layer) };
    } catch (error) {
      if (loaded && !installed) for (const tile of loaded.snapshot.tiles) for (const asset of Object.values(tile.images)) if (asset) URL.revokeObjectURL(asset.url);
      const message = error instanceof Error ? error.message : '已采用结果读取失败。';
      setError(`${message} 已采用结果保留在服务端；旧草稿自动保存已暂停，请重新打开工程。`);
      throw error;
    }
  };
  useEffect(() => {
    let alive = true;
    const revision = latest.current.revision;
    const id = new URLSearchParams(location.search).get('map') || undefined;
    void loadMapWorkspace(id, new URLSearchParams(location.search).get('saved') === '1')
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
        revisions.current.set(draft.id, draft.serverRevision || 0);
        if (draft.serverSha256) sourceHashes.current.set(draft.id, draft.serverSha256);
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
    if (!dirty || adoptionBarrier.current) return;
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
  // Keep an explicit empty-project URL so refresh cannot resurrect the latest draft.
  useEffect(() => {
    if (loading || !c.workspaceId || !c.sourceAsset) return;
    const url = new URL(location.href);
    url.searchParams.set('map', c.workspaceId);
    url.searchParams.delete('saved');
    window.history.replaceState(window.history.state, '', url);
  }, [loading, c.workspaceId, c.sourceAsset]);
  const newProject = async () => {
    await save();
    await chain.current;
    await saveWorkspaceDraft('map-current', 'new', []);
    latest.current.newProject();
    completed.current = '';
    savedRef.current = { fingerprint: '', at: '' };
    setSaved(savedRef.current);
    setError('');
    const url = new URL(location.href);
    url.searchParams.set('map', 'new');
    window.history.replaceState(window.history.state, '', url);
  };
  return { loading, error, newProject, flushSaved, assertImageGuard, acceptAdopted };
}
