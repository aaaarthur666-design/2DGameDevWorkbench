'use client';
/* oxlint-disable next/no-img-element -- AI references preview the exact uploaded source bytes. */

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { PixelController } from '@/features/image-edit/pixel-controller.mjs';
import { base64ToBytes, encodePixelPatch, imageAiEditInput, imageApplyInput, imageCandidateBase, imageCandidateFollowState, imageEditInput, imageEditRequest, imageInspectionMetadata, imageResolveInput, imageSessionNeedsPolling, imageSourceActionBlockReason, ImageEditClientError, inspectImage, listImagePixelDrafts, mergeImageInspectionPage, mergeImageWorkspaceRefresh, openImageSession, performImageSourceAction, readImageAiReference, readImageEdit, saveImagePixelDraft, validateAiReferences, verifiedImagePixels } from '@/features/image-edit/client';
import type { ImageAdoptionReceipt, ImageAiReference, ImageCandidate, ImageEditContextLayer, ImageEditOperation, ImageEditSession, ImageInspection, ImagePixelDraft, ImageRelatedKind, ImageSessionBootstrap, ImageTargetInfo, ImageTargetRef } from '@/features/image-edit/client';
import type { RegionSpec } from '@/features/image-edit/core.mjs';
import type { ImageEditNavigation } from '@/features/image-edit/navigation';
import { ImageEditCanvas } from './image-edit-canvas';
import type { ImagePixelTool, ImageViewMode } from './image-edit-canvas';
import './image-edit.css';

export interface ImageEditWorkspaceProps {
  target: ImageTargetRef;
  initialEditId?: string;
  initialCandidateVersion?: string;
  readOnly?: boolean;
  contextLayers?: ImageEditContextLayer[];
  beforeApply?: () => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  onAdopt: (receipt: ImageAdoptionReceipt) => Promise<void>;
  onClose: () => void;
  onNavigationChange?: (selection: ImageEditNavigation) => void;
  renderContext?: (previewSource: string) => ReactNode;
  onOpenSource?: (target: ImageTargetInfo) => void | Promise<void>;
  onDownloadSource?: (target: ImageTargetInfo) => void | Promise<void>;
}
interface PendingCommand { label: string; operation: string; body: unknown; external?: boolean; complete: (value: unknown) => Promise<void> }
interface LoadedWorkspace { metadata: ImageInspection; session: ImageEditSession; controller: PixelController; baseVersion: string; baseHash: string; followVersion?: string; originalPreviewSource?: string; basePreviewSource?: string }
const plainSession = (value: ImageEditSession) => { const { pixels: _pixels, ...rest } = value; return rest; };
const metadataOnly = imageInspectionMetadata;
const operationNames: Record<string, string> = { 'pixel-patch': '手工笔划', 'clean-alpha': '透明噪点清理', 'replace-color': '精确替色', fill: '连通填充', erase: '擦除', translate: '移动像素', 'restore-region': '恢复区域', 'source-restore': '恢复原图', 'ai-edit': 'AI 修改' };
const statusNames: Record<string, string> = { completed: '已检查', running: '处理中', preparing: '准备中', failed: '失败', attention_required: '需要检查', awaiting_configuration: '等待配置' };
const tools: { id: ImagePixelTool; name: string }[] = [{ id: 'pencil', name: '画笔' }, { id: 'eraser', name: '橡皮' }, { id: 'mask-add', name: '添加选区' }, { id: 'mask-erase', name: '减去选区' }, { id: 'rectangle', name: '矩形选区' }, { id: 'connected', name: '连通选区' }, { id: 'picker', name: '取色' }, { id: 'pan', name: '平移' }];
const message = (error: unknown) => error instanceof Error ? error.message : '局部调整未完成。';

async function loadWorkspace(target: ImageTargetRef, attempt: ImageSessionBootstrap, requestedVersion?: string): Promise<LoadedWorkspace> {
  const { inspection, edit } = await openImageSession(target, attempt);
  if (edit.target.targetId !== inspection.target.targetId) throw new Error('编辑会话属于另一张图片，未打开。');
  const source = await readImageEdit(edit.editId, 'source', true);
  if (!source.edit.pixels) throw new Error('原始会话没有权威像素。');
  const original = await verifiedImagePixels(source.edit.pixels);
  if (original.width !== edit.target.width || original.height !== edit.target.height) throw new Error('会话原始图尺寸与目标绑定不一致。');
  const selection = imageCandidateBase(edit, requestedVersion);
  const base = selection.baseVersion === 'source' ? original : await loadCandidatePixels(edit.editId, selection.baseVersion);
  if (base.width !== original.width || base.height !== original.height) throw new Error('候选尺寸与原始图不一致。');
  return { metadata: metadataOnly(inspection), session: plainSession(edit), controller: new PixelController(original.pixels, original.width, original.height, base.pixels), ...selection, baseHash: base.rgbaSha256, originalPreviewSource: original.previewSource, basePreviewSource: base.previewSource };
}
async function loadCandidatePixels(editId: string, candidateVersion: string) {
  const { edit } = await readImageEdit(editId, candidateVersion, true);
  if (!edit.pixels) throw new Error('候选尚未提供可验证像素。');
  return verifiedImagePixels(edit.pixels);
}

export function ImageEditWorkspace({ target, initialEditId, initialCandidateVersion, readOnly = false, contextLayers = [], beforeApply, onBusyChange, onAdopt, onClose, onNavigationChange, renderContext, onOpenSource, onDownloadSource }: ImageEditWorkspaceProps) {
  const [loaded, setLoaded] = useState<LoadedWorkspace | null>(null), [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [pending, setPending] = useState<PendingCommand | null>(null);
  const [tool, setTool] = useState<ImagePixelTool>('pencil'), [display, setDisplay] = useState<ImageViewMode>('candidate');
  const [color, setColor] = useState('#eebc52'), [alpha, setAlpha] = useState(255), [brushSize, setBrushSize] = useState(1), [tolerance, setTolerance] = useState(0);
  const [threshold, setThreshold] = useState(1), [replaceFrom, setReplaceFrom] = useState('#000000'), [replaceTo, setReplaceTo] = useState('#ffffff');
  const [dx, setDx] = useState(1), [dy, setDy] = useState(0), [seedX, setSeedX] = useState(0), [seedY, setSeedY] = useState(0);
  const [regionName, setRegionName] = useState(''), [selectedNamed, setSelectedNamed] = useState(''), [restoreVersion, setRestoreVersion] = useState('source');
  const [preserveAlpha, setPreserveAlpha] = useState(false), [showContext, setShowContext] = useState(false), [leavePrompt, setLeavePrompt] = useState(false), [retryLoad, setRetryLoad] = useState(0);
  const [recoverableDraft, setRecoverableDraft] = useState<ImagePixelDraft | null>(null);
  const [sessionStartFailed, setSessionStartFailed] = useState(false);
  const [contextPreview, setContextPreview] = useState<{ controller: PixelController; version: number; display: ImageViewMode; url: string } | null>(null);
  const [aiPreserveAlpha, setAiPreserveAlpha] = useState(true);
  const [mode, setMode] = useState<'local' | 'ai'>('local'), [aiPrompt, setAiPrompt] = useState(''), [aiReferences, setAiReferences] = useState<ImageAiReference[]>([]), [referencesLoading, setReferencesLoading] = useState(false), [savedAiDraft, setSavedAiDraft] = useState('');
  const dialog = useRef<HTMLDialogElement>(null), busyRef = useRef(false), draftOwner = useRef('');
  const boot = useRef<{ key: string; attempt: ImageSessionBootstrap; promise: Promise<LoadedWorkspace> } | null>(null);
  const nextSession = useRef<ImageSessionBootstrap | null>(null);
  const loadedRef = useRef<LoadedWorkspace | null>(null);
  const key = JSON.stringify({ target, initialEditId, initialCandidateVersion });
  const aiDraftKey = JSON.stringify({ prompt: aiPrompt.trim(), references: aiReferences.map(reference => reference.id), region: loaded?.controller.region, preserveAlpha: aiPreserveAlpha });
  const aiDraftDirty = !!(aiPrompt.trim() || aiReferences.length) && aiDraftKey !== savedAiDraft;
  const changed = () => setVersion(value => value + 1);
  const switchMode = (next: 'local' | 'ai') => { setMode(next); if (next === 'local' && ['mask-add', 'mask-erase'].includes(tool)) setTool('pencil'); if (next === 'ai' && ['pencil', 'eraser', 'picker'].includes(tool)) setTool('rectangle'); };
  useEffect(() => { loadedRef.current = loaded; }, [loaded]);
  const navigationEditId = loaded?.session.editId, navigationVersion = loaded?.followVersion || loaded?.baseVersion;
  useEffect(() => {
    if (navigationEditId) onNavigationChange?.({ editId: navigationEditId, candidateVersion: navigationVersion });
  }, [navigationEditId, navigationVersion, onNavigationChange]);
  const previewController = loaded?.controller;
  const savedPreviewSource = display === 'source' ? loaded?.originalPreviewSource : !previewController?.dirty ? loaded?.basePreviewSource : undefined;
  const contextPreviewUrl = savedPreviewSource || (contextPreview?.controller === previewController && contextPreview?.version === version && contextPreview?.display === display ? contextPreview.url : '');
  useEffect(() => {
    if (!showContext || !renderContext || !previewController || savedPreviewSource) return;
    let active = true, url = '';
    const canvas = document.createElement('canvas'); canvas.width = previewController.width; canvas.height = previewController.height;
    canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(display === 'source' ? previewController.sourcePixels : previewController.pixels), canvas.width, canvas.height), 0, 0);
    // Canvas encoding is only for this read-only preview, never for edit/apply.
    canvas.toBlob(blob => { if (blob && active) { url = URL.createObjectURL(blob); setContextPreview({ controller: previewController, version, display, url }); } }, 'image/png');
    return () => { active = false; if (url) URL.revokeObjectURL(url); canvas.width = canvas.height = 0; };
  }, [showContext, renderContext, previewController, version, display, savedPreviewSource]);
  useEffect(() => {
    let alive = true;
    if (!draftOwner.current) draftOwner.current = crypto.randomUUID();
    const previous = document.activeElement;
    dialog.current?.focus();
    void Promise.resolve().then(() => { if (alive) { setBusy('正在读取并核验源像素'); setError(''); setLoaded(null); } });
    const attempt = boot.current?.key === key ? boot.current.attempt : { commandId: crypto.randomUUID(), editId: initialEditId };
    if (!boot.current || boot.current.key !== key || retryLoad) {
      const selection = JSON.parse(key) as { target: ImageTargetRef; initialEditId?: string; initialCandidateVersion?: string };
      boot.current = { key, attempt, promise: loadWorkspace(selection.target, attempt, selection.initialCandidateVersion) };
    }
    void boot.current.promise.then(value => { if (alive) { setLoaded(value); setBusy(''); } }).catch(cause => { if (alive) { setError(message(cause)); setBusy(''); } });
    return () => { alive = false; if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [key, retryLoad, initialEditId]);
  useEffect(() => { onBusyChange?.(!!busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const dirty = !!loaded?.controller.dirty;
  const draftEditId = loaded?.session.editId, draftSourceSha = loaded?.session.source.sha256;
  useEffect(() => {
    if (!draftEditId || !draftSourceSha) return;
    let alive = true;
    void listImagePixelDrafts(draftEditId).then(drafts => {
      const draft = drafts.filter(item => item.owner !== draftOwner.current && item.sourceSha256 === draftSourceSha).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (alive) setRecoverableDraft(draft || null);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [draftEditId, draftSourceSha]);
  useEffect(() => {
    if (!loaded) return;
    const current = loaded, owner = draftOwner.current, draftKey = `${current.session.editId}:${owner}`;
    const timer = setTimeout(() => {
      try {
        const patch = current.controller.dirty ? encodePixelPatch(current.controller.patch(), current.baseHash) : null;
        const draft = patch?.type === 'pixel-patch' ? { key: draftKey, editId: current.session.editId, owner, baseVersion: current.baseVersion, baseHash: current.baseHash, sourceSha256: current.session.source.sha256, patch, updatedAt: Date.now() } : null;
        void saveImagePixelDraft(draft, draftKey).catch(cause => setNotice(message(cause)));
      } catch (cause) { setNotice(message(cause)); }
    }, 600);
    return () => clearTimeout(timer);
  }, [loaded, version]);
  useEffect(() => {
    if (!dirty && !pending && !busy && !aiDraftDirty) return;
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty, pending, busy, aiDraftDirty]);
  const pollingEditId = loaded?.session.editId;
  const needsPolling = loaded ? imageSessionNeedsPolling(loaded.session, loaded.followVersion) : false;
  useEffect(() => {
    if (!pollingEditId || !needsPolling) return;
    let active = true, reading = false;
    const timer = setInterval(() => {
      if (busyRef.current || reading) return;
      reading = true;
      void (async () => {
        try {
          const { edit } = await readImageEdit(pollingEditId);
          if (!active) return;
          const current = loadedRef.current;
          if (!current || current.session.editId !== edit.editId) return;
          const following = imageCandidateFollowState(edit, current.followVersion, current.controller.dirty), requested = following.candidate;
          if (requested && ['select', 'preserve-draft'].includes(following.state) && !busyRef.current) {
            if (following.state === 'preserve-draft') {
              setLoaded(old => old?.session.editId === edit.editId ? { ...old, session: plainSession(edit), followVersion: undefined } : old);
              setNotice('请求的候选已完成；未保存笔划保留，请保存后明确选择该候选。');
            } else {
              busyRef.current = true; setBusy('读取请求的候选');
              try {
                const pixels = await loadCandidatePixels(edit.editId, requested.version);
                const latest = loadedRef.current;
                if (!active || !latest || latest.session.editId !== edit.editId || latest.followVersion !== requested.version) return;
                if (latest.controller.dirty) { setNotice('候选已完成，未覆盖后来产生的笔划。'); return; }
                const controller = new PixelController(latest.controller.sourcePixels, pixels.width, pixels.height, pixels.pixels);
                if (latest.controller.region) controller.selectRegion(latest.controller.region);
                setLoaded({ ...latest, session: plainSession(edit), controller, baseVersion: requested.version, baseHash: pixels.rgbaSha256, basePreviewSource: pixels.previewSource, followVersion: undefined });
                setDisplay('candidate'); setNotice('请求的候选已完成并通过保护检查；尚未采用。');
              } finally { busyRef.current = false; if (active) setBusy(''); }
            }
          } else {
            const stopped = following.state === 'stopped';
            setLoaded(old => old?.session.editId === edit.editId && old.session.revision <= edit.revision ? { ...old, session: plainSession(edit), ...(stopped ? { followVersion: undefined } : {}) } : old);
            if (stopped) setError(requested?.error || '原任务需要检查，不会重新提交或自动采用。');
          }
        } catch (cause) { if (active) setError(message(cause)); }
        finally { reading = false; }
      })();
    }, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [pollingEditId, needsPolling]);

  const execute = async (command: PendingCommand) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(command.label); setError(''); setNotice(''); setPending(command);
    let submitted = false;
    try {
      if (command.operation === 'apply') await beforeApply?.();
      submitted = true;
      const value = await imageEditRequest<unknown>(command.operation, command.body);
      await command.complete(value); setPending(null);
    } catch (cause) {
      setError(message(cause));
      if (!submitted || (cause instanceof ImageEditClientError && cause.status < 500 && !['IMAGE_EDIT_BUSY', 'IMAGE_SUBMISSION_UNKNOWN'].includes(cause.code || ''))) setPending(null);
    } finally { busyRef.current = false; setBusy(''); }
  };
  const local = (operation: () => void) => { try { operation(); changed(); setError(''); } catch (cause) { setError(message(cause)); } };
  const forceReadOnly = readOnly || !!loaded?.metadata.historyOnly;
  const canContinue = !forceReadOnly && !!loaded && loaded.metadata.target.revision === loaded.session.target.revision && loaded.metadata.target.sha256 === loaded.session.target.sha256 && loaded.metadata.target.editable && !loaded.metadata.target.locked;
  const adoptionBlocked = forceReadOnly || !loaded?.metadata.target.editable || !!loaded?.metadata.target.locked;
  const blocked = !!busy || !!pending || !canContinue;
  const selectCandidate = async (candidateVersion: string) => {
    if (!loaded || busyRef.current) return;
    if (loaded.controller.dirty) { setError('请先保存或舍弃未保存笔划，再切换候选。'); return; }
    busyRef.current = true; setBusy('读取候选像素'); setError('');
    try {
      const pixels = await loadCandidatePixels(loaded.session.editId, candidateVersion);
      const controller = new PixelController(loaded.controller.sourcePixels, pixels.width, pixels.height, pixels.pixels);
      if (loaded.controller.region) controller.selectRegion(loaded.controller.region);
      setLoaded({ ...loaded, controller, baseVersion: candidateVersion, baseHash: pixels.rgbaSha256, basePreviewSource: pixels.previewSource, followVersion: undefined }); setDisplay('candidate');
    } catch (cause) { setError(message(cause)); }
    finally { busyRef.current = false; setBusy(''); }
  };
  const runOperation = async (operation: ImageEditOperation, references: readonly ImageAiReference[] = []) => {
    if (!loaded || blocked || busyRef.current || !loaded.controller.region) return;
    if (loaded.controller.maskStrokeActive) { setError('请先结束当前选区笔划，再提交候选。'); return; }
    if (operation.type !== 'pixel-patch' && loaded.controller.dirty) { setError('请先将未保存笔划保存为候选，再执行其他操作。'); return; }
    const current = loaded, region = current.controller.region, commandId = crypto.randomUUID();
    const submittedAiKey = aiDraftKey, frozenReferences = references.slice(), external = operation.type === 'ai-edit';
    if (!region) return;
    busyRef.current = true; setBusy('解析当前选区'); setError('');
    let body: ReturnType<typeof imageEditInput>;
    try {
      const { regionRef } = await imageEditRequest<{ regionRef: string }>('resolve', imageResolveInput(current.metadata.target, region));
      body = operation.type === 'ai-edit' ? imageAiEditInput(current.metadata.target, current.session, current.baseVersion, regionRef, operation.prompt, frozenReferences, current.controller.dirty, commandId, aiPreserveAlpha) : imageEditInput(current.metadata.target, current.session, current.baseVersion, regionRef, operation, preserveAlpha, commandId);
    }
    catch (cause) { setError(message(cause)); busyRef.current = false; setBusy(''); return; }
    busyRef.current = false;
    await execute({
      label: external ? '正在提交 AI 候选请求' : '正在保存本地候选', operation: 'edit', body, external,
      complete: async value => {
        const result = value as { edit: ImageEditSession; candidateVersion: string; status: string };
        if (external) setSavedAiDraft(submittedAiKey);
        if (result.status !== 'completed') {
          const stopped = ['failed', 'attention_required', 'awaiting_configuration'].includes(result.status);
          setLoaded(old => old?.session.editId === result.edit.editId ? { ...old, session: plainSession(result.edit), followVersion: stopped ? undefined : result.candidateVersion } : old);
          if (stopped) setError(result.edit.candidates.find(item => item.version === result.candidateVersion)?.error || '候选未通过检查，原图与笔划保留；不会自动重新请求。');
          else setNotice('原任务正在处理。关闭不取消；重开此会话继续查看，不会重复提交或采用。');
          return;
        }
        const pixels = await loadCandidatePixels(result.edit.editId, result.candidateVersion);
        const controller = new PixelController(current.controller.sourcePixels, pixels.width, pixels.height, pixels.pixels);
        if (current.controller.region) controller.selectRegion(current.controller.region);
        setLoaded(old => old?.session.editId === result.edit.editId ? { ...old, session: plainSession(result.edit), controller, baseVersion: result.candidateVersion, baseHash: pixels.rgbaSha256, basePreviewSource: pixels.previewSource, followVersion: undefined } : old);
        setDisplay('candidate'); setNotice('候选已保存并通过像素检查，尚未采用。');
      },
    });
  };
  const savePixels = () => {
    if (!loaded) return;
    try { void runOperation(encodePixelPatch(loaded.controller.patch(), loaded.baseHash)); } catch (cause) { setError(message(cause)); }
  };
  const adopt = async (candidateVersion: string) => {
    if (!loaded || busyRef.current || pending || forceReadOnly || !loaded.metadata.target.editable || loaded.metadata.target.locked) return;
    if (loaded.controller.dirty) { setError('请先保存或舍弃未保存笔划，再采用。'); return; }
    const current = loaded;
    await execute({ label: candidateVersion === 'source' ? '恢复原始图片' : '采用当前候选', operation: 'apply', body: imageApplyInput(current.metadata.target, current.session.editId, candidateVersion, crypto.randomUUID()), complete: async value => {
      const receipt = value as ImageAdoptionReceipt;
      try { await onAdopt(receipt); }
      catch (cause) { throw new Error(`服务端已采用，本页尚未完成同步。请重试同一操作以重新读取：${message(cause)}`); }
      const refreshed = await readImageEdit(current.session.editId);
      const selected = await loadCandidatePixels(current.session.editId, candidateVersion);
      setLoaded({ ...current, metadata: { ...current.metadata, target: receipt.target }, session: plainSession(refreshed.edit), controller: new PixelController(current.controller.sourcePixels, selected.width, selected.height, selected.pixels), baseVersion: candidateVersion, baseHash: selected.rgbaSha256, basePreviewSource: selected.previewSource, followVersion: undefined });
      setDisplay('candidate'); setNotice(candidateVersion === 'source' ? '原始图片已恢复为新的目标版本。其他源图和工程内容保留。' : '已采用到指定目标。继续精修将基于采用结果创建新会话。');
    } });
  };
  const startNewSession = async (reset = false) => {
    if (!loaded || busyRef.current || loaded.controller.dirty || forceReadOnly) return;
    busyRef.current = true; setBusy('基于当前目标新建编辑'); setError('');
    if (reset || !nextSession.current) nextSession.current = { commandId: crypto.randomUUID() };
    try { setLoaded(await loadWorkspace(target, nextSession.current)); nextSession.current = null; setSessionStartFailed(false); setNotice('已基于当前目标打开新会话。'); }
    catch (cause) { setSessionStartFailed(true); setError(message(cause)); }
    finally { busyRef.current = false; setBusy(''); }
  };
  const saveNamedRegion = async () => {
    if (!loaded || !loaded.controller.region || !regionName.trim() || blocked) return;
    const current = loaded, region = current.controller.region;
    if (!region) return;
    await execute({ label: '保存命名区域', operation: 'resolve', body: imageResolveInput(current.metadata.target, region, regionName.trim(), crypto.randomUUID()), complete: async () => {
      const metadata = metadataOnly(await imageEditRequest<ImageInspection>('inspect', { target, view: 'metadata' }));
      setLoaded(old => old ? { ...old, metadata } : old); setNotice('区域名称已保存，其他客户端可读取同一区域。'); setRegionName('');
    } });
  };
  const loadNamedRegion = async () => {
    if (!loaded || !selectedNamed || blocked) return;
    busyRef.current = true; setBusy('读取命名区域'); setError('');
    try {
      const region = await imageEditRequest<{ spec: RegionSpec }>('resolve', imageResolveInput(loaded.metadata.target, { type: 'named', regionId: selectedNamed }));
      loaded.controller.selectRegion(region.spec); changed();
    } catch (cause) { setError(message(cause)); }
    finally { busyRef.current = false; setBusy(''); }
  };
  const restoreDraft = async () => {
    if (!loaded || !recoverableDraft || busyRef.current || forceReadOnly) return;
    if (loaded.controller.dirty) { setError('请先保存或舍弃当前笔划，再恢复草稿。'); return; }
    busyRef.current = true; setBusy('恢复本机笔划');
    try {
      const base = await loadCandidatePixels(loaded.session.editId, recoverableDraft.baseVersion);
      if (base.rgbaSha256 !== recoverableDraft.baseHash) throw new Error('草稿像素基准已变，保留草稿但未恢复。');
      const controller = new PixelController(loaded.controller.sourcePixels, base.width, base.height, base.pixels);
      controller.restorePatch(recoverableDraft.patch.spans.map(span => ({ startPixel: span.startPixel, before: base64ToBytes(span.beforeRgbaBase64), after: base64ToBytes(span.afterRgbaBase64) })));
      setLoaded({ ...loaded, controller, baseVersion: recoverableDraft.baseVersion, baseHash: base.rgbaSha256, basePreviewSource: base.previewSource }); setRecoverableDraft(null); setNotice('本机笔划已恢复，尚未保存为候选。');
    } catch (cause) { setError(message(cause)); }
    finally { busyRef.current = false; setBusy(''); }
  };
  const selectSession = async (editId: string) => {
    if (!loaded || busyRef.current || !editId) return;
    if (loaded.controller.dirty) { setError('请先保存或舍弃当前笔划，再打开另一份会话。'); return; }
    busyRef.current = true; setBusy('打开已保存会话'); setError('');
    try { setLoaded(await loadWorkspace(target, { commandId: crypto.randomUUID(), editId })); setNotice('已打开明确选择的历史会话。'); }
    catch (cause) { setError(message(cause)); }
    finally { busyRef.current = false; setBusy(''); }
  };
  const refreshTarget = async () => {
    if (!loaded || busyRef.current) return;
    busyRef.current = true; setBusy('核对当前目标'); setError('');
    try {
      const [metadata, refreshed] = await Promise.all([inspectImage(target), readImageEdit(loaded.session.editId)]);
      const merged = mergeImageWorkspaceRefresh(loaded, metadata, refreshed.edit);
      setLoaded(old => old?.session.editId === merged.session.editId ? { ...old, metadata: merged.metadata, session: old.session.revision > merged.session.revision ? old.session : merged.session } : old);
      setNotice('目标与会话版本已刷新；本机笔划、已选基准和候选保留。');
    } catch (cause) { setError(message(cause)); }
    finally { busyRef.current = false; setBusy(''); }
  };
  const loadMoreRelated = async (kind: ImageRelatedKind) => {
    if (!loaded || busyRef.current) return;
    const offset = loaded.metadata.relatedPagination?.[kind].nextOffset;
    if (offset === null || offset === undefined) return;
    busyRef.current = true; setBusy(kind === 'sessions' ? '读取更多编辑会话' : '读取更多命名区域'); setError('');
    try {
      const page = await inspectImage(target, offset);
      const metadata = mergeImageInspectionPage(loaded.metadata, page, kind);
      setLoaded(old => old?.session.editId === loaded.session.editId && old.metadata.target.revision === metadata.target.revision ? { ...old, metadata } : old);
    } catch (cause) { setError(message(cause)); }
    finally { busyRef.current = false; setBusy(''); }
  };
  const addAiReferences = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files || []); event.currentTarget.value = '';
    if (!files.length || referencesLoading) return;
    setError('');
    try {
      validateAiReferences([...aiReferences, ...files.map(file => ({ id: '', name: file.name, source: '', bytes: file.size }))]);
      setReferencesLoading(true);
      const references = await Promise.all(files.map(readImageAiReference));
      setAiReferences([...aiReferences, ...references]);
    } catch (cause) { setError(message(cause)); }
    finally { setReferencesLoading(false); }
  };
  const close = () => { if (loaded?.controller.dirty || pending || busy || aiDraftDirty) setLeavePrompt(true); else onClose(); };
  const sourceActionState = { busy: !!busy, pending: !!pending, pixelDirty: !!loaded?.controller.dirty, aiDraftDirty, referencesLoading };
  const openSourceBlocked = imageSourceActionBlockReason(sourceActionState, true);
  const downloadSourceBlocked = imageSourceActionBlockReason(sourceActionState, false);
  const sourceAction = async (opensEditor: boolean) => {
    const action = opensEditor ? onOpenSource : onDownloadSource;
    if (!loaded || !action) return;
    const state = { ...sourceActionState, busy: !!busy || busyRef.current };
    const reason = imageSourceActionBlockReason(state, opensEditor);
    if (reason) { setError(reason); return; }
    busyRef.current = true; setBusy('正在核验嵌入源包版本与内容'); setError('');
    try { await performImageSourceAction(loaded.metadata.target, state, opensEditor, action); }
    catch (cause) { setError(message(cause)); }
    finally { busyRef.current = false; setBusy(''); }
  };
  const keyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'Tab' && dialog.current) {
      const controls = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]')).filter(element => element.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement || blocked || !loaded) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); local(() => event.shiftKey ? loaded.controller.redoPixels() : loaded.controller.undoPixels()); }
  };
  const controller = loaded?.controller;
  const candidate = loaded?.session.candidates.find(item => item.version === loaded.baseVersion);
  return <div className="ie-backdrop"><dialog open ref={dialog} aria-modal="true" aria-labelledby="ie-title" tabIndex={-1} className="ie-workspace" onKeyDown={keyDown}>
    <header className="ie-header"><div><h2 id="ie-title">局部调整</h2><p>{loaded?.metadata.target.name || '读取已有图片'}{loaded && ` · ${loaded.metadata.target.width} × ${loaded.metadata.target.height} · 目标版本 ${String(loaded.metadata.target.revision).slice(0, 10)}`}</p></div><div className="ie-header-actions"><span className="ie-local-badge">{mode === 'ai' ? 'AI 修改 · 调用图片服务' : '本地精修 · 不调用图片服务'}</span><Button variant="ghost" onClick={close}>关闭</Button></div></header>
    {!loaded && <div className="ie-loading"><p>{busy || error || '准备编辑工作区'}</p>{!busy && <><Button onClick={() => setRetryLoad(value => value + 1)}>重试同一次打开</Button><Button variant="ghost" onClick={() => { boot.current = null; setRetryLoad(value => value + 1); }}>按当前目标重新打开</Button></>}</div>}
    {loaded && controller && <>
      <div className="ie-main">
        <aside className="ie-tools" aria-label="像素工具">
          {tools.map(item => <Button key={item.id} size="sm" variant={tool === item.id ? 'secondary' : 'ghost'} onClick={() => setTool(item.id)} disabled={(item.id !== 'pan' && blocked) || (mode === 'ai' && ['pencil', 'eraser', 'picker'].includes(item.id)) || (mode === 'local' && ['mask-add', 'mask-erase'].includes(item.id))}>{item.name}</Button>)}
          {mode === 'local' && <>
          <label>颜色<input type="color" value={color} onChange={event => setColor(event.target.value)} /></label>
          <label>不透明度<input type="number" min={0} max={255} value={alpha} onChange={event => setAlpha(Math.max(0, Math.min(255, Number(event.target.value))))} /></label>
          <label>笔宽<input type="number" min={1} max={32} value={brushSize} onChange={event => setBrushSize(Math.max(1, Math.min(32, Number(event.target.value))))} /></label>
          <label>连通容差<input type="number" min={0} max={255} value={tolerance} onChange={event => setTolerance(Math.max(0, Math.min(255, Number(event.target.value))))} /></label>
          <hr /><span className="ie-label">像素历史</span><Button size="sm" variant="outline" disabled={blocked || !controller.canUndoPixels} onClick={() => local(() => controller.undoPixels())}>撤销笔划</Button><Button size="sm" variant="outline" disabled={blocked || !controller.canRedoPixels} onClick={() => local(() => controller.redoPixels())}>重做笔划</Button>
          <Button size="sm" disabled={blocked || !controller.dirty} onClick={savePixels}>保存笔划为候选</Button>
          <Button size="sm" variant="ghost" disabled={!!busy || !!pending || !controller.dirty} onClick={() => local(() => controller.discardPixels())}>舍弃未保存笔划</Button>
          </>}
          {mode === 'ai' && <><label>选区笔宽<input type="number" min={1} max={32} value={brushSize} onChange={event => setBrushSize(Math.max(1, Math.min(32, Number(event.target.value))))} /></label><p className="ie-hint">添加／减去只改选区，不改 RGBA。像素画笔与橡皮请切回本地精修。</p></>}
        </aside>
        <section className="ie-center">
          <div className="ie-modebar"><Button size="sm" variant={mode === 'local' ? 'secondary' : 'ghost'} onClick={() => switchMode('local')}>本地精修</Button><Button size="sm" variant={mode === 'ai' ? 'secondary' : 'ghost'} onClick={() => switchMode('ai')}>AI 局部修改</Button><span>{mode === 'ai' ? '明确生成候选后才请求模型' : 'RGBA 笔划与本地处理'}</span></div>
          <div className="ie-compare" aria-label="图片对比">{([{ id: 'candidate', name: '当前候选' }, { id: 'source', name: '原始图片' }, { id: 'diff', name: '差异高亮' }] as const).map(item => <Button key={item.id} size="sm" variant={display === item.id ? 'secondary' : 'ghost'} onClick={() => { setDisplay(item.id); if (item.id === 'diff' && renderContext) setShowContext(false); }}>{item.name}</Button>)}{(contextLayers.length > 0 || renderContext) && <label><input type="checkbox" checked={showContext} onChange={event => { setShowContext(event.target.checked); if (event.target.checked && display === 'diff' && renderContext) setDisplay('candidate'); }} />{renderContext ? '场景上下文' : '地图上下文'}</label>}</div>
          {showContext && renderContext && <div className="ie-context-preview">{contextPreviewUrl ? <div className="ie-context-image" key={contextPreviewUrl}>{renderContext(contextPreviewUrl)}</div> : <p>正在准备当前版本的只读上下文…</p>}<p className="ie-hint">仅预览所选图片位置，不修改其他实例、源包或运行状态；上下文不会自动上传。</p></div>}
          <div className="ie-source-pane" style={{ display: showContext && renderContext ? 'none' : undefined }}><ImageEditCanvas controller={controller} version={version} tool={tool} color={color} alpha={alpha} brushSize={brushSize} display={display} disabled={blocked} tolerance={tolerance} contextLayers={contextLayers} showContext={showContext && !renderContext} onChange={changed} onColor={(nextColor, nextAlpha) => { setColor(nextColor); setAlpha(nextAlpha); }} onError={setError} /></div>
        </section>
        <aside className="ie-properties" aria-label="局部调整参数">
          {loaded.metadata.target.targetRef.kind === 'scene-instance' && <p className="ie-ai-reason">仅修改选中实例，采用时派生独立素材。{loaded.metadata.target.sharedInstanceCount !== undefined && `当前素材由 ${loaded.metadata.target.sharedInstanceCount} 个实例共享。`}其他实例、位置、锚点与联动保留。</p>}
          {(!loaded.metadata.target.editable || loaded.metadata.target.locked || forceReadOnly) && <p className="ie-ai-reason">{loaded.metadata.target.readOnlyReason || (loaded.metadata.target.locked ? '此图片目标已锁定，只读查看。' : '此入口只读，可查看原图和历史候选。')}</p>}
          {loaded.metadata.target.sourceEntry && <section className="ie-evidence"><h3>嵌入地图源包</h3><p>打开源包不会自动更新已固定的场景快照。交付前将核验宿主版本与源包内容。</p>{onOpenSource && <Button size="sm" variant="outline" disabled={!!openSourceBlocked} onClick={() => void sourceAction(true)}>打开嵌入地图源包</Button>}{onDownloadSource && <Button size="sm" variant="ghost" disabled={!!downloadSourceBlocked} onClick={() => void sourceAction(false)}>下载嵌入地图源包</Button>}{openSourceBlocked && <p className="ie-hint">{openSourceBlocked}</p>}</section>}
          <fieldset disabled={blocked}><legend>可编辑区域</legend>
            <output>{controller.selectionCount === controller.width * controller.height ? '整张图片' : `${controller.selectionCount.toLocaleString()} 个像素`} {controller.dirty ? `· 未保存 ${controller.dirtyPixelCount.toLocaleString()} 个像素` : ''}</output>
            <div className="ie-row"><Button size="sm" variant="outline" onClick={() => local(() => controller.selectRegion({ type: 'all' }))}>选整图</Button><Button size="sm" variant="ghost" onClick={() => local(() => controller.selectRegion(null))}>清空选区</Button></div>
            <div className="ie-row"><Button size="sm" variant="outline" onClick={() => local(() => controller.selectRegion({ type: 'alpha-bounds', threshold: 1 }))}>可见包围框</Button><Button size="sm" variant="outline" onClick={() => local(() => controller.selectRegion({ type: 'alpha-selection', minAlpha: 1, maxAlpha: 255 }))}>可见像素</Button></div>
            <div className="ie-row"><Button size="sm" variant="ghost" disabled={!controller.canUndoMask} onClick={() => local(() => controller.undoMask())}>撤销选区</Button><Button size="sm" variant="ghost" disabled={!controller.canRedoMask} onClick={() => local(() => controller.redoMask())}>重做选区</Button></div>
            <label>区域名称<input value={regionName} maxLength={80} placeholder="例如：门框" onChange={event => setRegionName(event.target.value)} /></label><Button size="sm" variant="outline" disabled={!regionName.trim() || !controller.selectionCount} onClick={() => void saveNamedRegion()}>保存命名区域</Button>
            <select aria-label="已保存区域" value={selectedNamed} onChange={event => setSelectedNamed(event.target.value)}><option value="">选择已保存区域</option>{loaded.metadata.namedRegions?.map(region => <option key={region.regionId} value={region.regionId} disabled={region.stale}>{region.name}{region.stale ? '（来源已变）' : ''}</option>)}</select><Button size="sm" variant="ghost" disabled={!selectedNamed} onClick={() => void loadNamedRegion()}>使用区域</Button>
            {loaded.metadata.relatedPagination?.namedRegions.nextOffset != null && <Button size="sm" variant="outline" onClick={() => void loadMoreRelated('namedRegions')}>加载更多区域（已显示 {loaded.metadata.namedRegions?.length || 0}/{loaded.metadata.relatedPagination.namedRegions.total}）</Button>}
          </fieldset>
          {mode === 'local' && <fieldset disabled={blocked || controller.dirty || !controller.selectionCount}><legend>本地操作</legend>
            <label><input type="checkbox" checked={preserveAlpha} onChange={event => setPreserveAlpha(event.target.checked)} />保持所有 Alpha 通道</label>
            <label>低 Alpha 阈值<input type="number" min={0} max={16} value={threshold} onChange={event => setThreshold(Math.max(0, Math.min(16, Number(event.target.value))))} /></label><Button size="sm" variant="outline" onClick={() => void runOperation({ type: 'clean-alpha', threshold })}>清理透明噪点</Button>
            <div className="ie-row"><label>原色<input type="color" value={replaceFrom} onChange={event => setReplaceFrom(event.target.value)} /></label><label>替换色<input type="color" value={replaceTo} onChange={event => setReplaceTo(event.target.value)} /></label></div><Button size="sm" variant="outline" onClick={() => void runOperation({ type: 'replace-color', from: replaceFrom, to: replaceTo })}>精确替色</Button>
            <div className="ie-row"><label>种子 X<input type="number" min={0} max={controller.width - 1} value={seedX} onChange={event => setSeedX(Number(event.target.value))} /></label><label>Y<input type="number" min={0} max={controller.height - 1} value={seedY} onChange={event => setSeedY(Number(event.target.value))} /></label></div><Button size="sm" variant="outline" onClick={() => void runOperation({ type: 'fill', x: seedX, y: seedY, rgba: [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16), alpha] })}>用画笔颜色填充</Button>
            <div className="ie-row"><label>移动 X<input type="number" min={-3839} max={3839} value={dx} onChange={event => setDx(Number(event.target.value))} /></label><label>Y<input type="number" min={-3839} max={3839} value={dy} onChange={event => setDy(Number(event.target.value))} /></label></div><Button size="sm" variant="outline" onClick={() => void runOperation({ type: 'translate', dx, dy })}>移动矩形内像素</Button>
            <Button size="sm" variant="outline" onClick={() => void runOperation({ type: 'erase' })}>擦除选区内像素</Button>
            <select aria-label="区域恢复来源" value={restoreVersion} onChange={event => setRestoreVersion(event.target.value)}><option value="source">原始图片</option>{loaded.session.candidates.filter(item => item.status === 'completed').map((item, index) => <option key={item.version} value={item.version}>候选 {index + 1} · {operationNames[item.operation.type] || '本地修改'}</option>)}</select><Button size="sm" variant="outline" onClick={() => void runOperation({ type: 'restore-region', candidateVersion: restoreVersion })}>从所选版本恢复区域</Button>
          </fieldset>}
          {mode === 'ai' && <fieldset disabled={blocked}><legend>AI 局部修改</legend>
            <p className="ie-hint">范围：{controller.selectionCount === controller.width * controller.height ? '整张图片' : `${controller.selectionCount.toLocaleString()} 个选区像素`}。使用矩形、连通或已保存区域；选整图需明确选择。</p>
            <p className="ie-hint">基准：{loaded.baseVersion === 'source' ? '会话原始图' : `候选 ${loaded.session.candidates.findIndex(item => item.version === loaded.baseVersion) + 1}`}。请求冻结描述、参考图、区域与基准；不会自动采用。</p>
            {!loaded.metadata.target.aiEdit?.supported && <output className="ie-ai-reason">{loaded.metadata.target.aiEdit?.reason || '尚未取得 AI 编辑可用性，请刷新目标状态。'} 小像素图仍可本地精修，不会自动放大。</output>}
            {loaded.metadata.target.aiEdit?.supported && <p className="ie-hint">{loaded.metadata.target.aiEdit.model || loaded.metadata.target.aiEdit.provider} · 保持 {controller.width} × {controller.height} 尺寸</p>}
            <label><input type="checkbox" checked={aiPreserveAlpha} onChange={event => setAiPreserveAlpha(event.target.checked)} />保留原图透明度</label>
            <p className="ie-hint">保留本次基准图的透明边缘，包括半透明像素；连续精修以所选候选为准。需要改变轮廓时关闭。</p>
            <label>修改描述<textarea rows={5} maxLength={12000} value={aiPrompt} placeholder="例如：将门框改为生锈的铁质，保留门洞布局" onChange={event => setAiPrompt(event.target.value)} /></label>
            <span className="ie-label">{aiPrompt.length.toLocaleString()}/12,000 字</span>
            <label>可选参考图（最多 8 张）<input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={referencesLoading || aiReferences.length >= 8} onChange={event => void addAiReferences(event)} /></label>
            {referencesLoading && <output>正在冻结参考图字节…</output>}
            <div className="ie-ai-references">{aiReferences.map(reference => <div key={reference.id}><img src={reference.source} alt={reference.name} /><span title={reference.name}>{reference.name}</span><Button size="xs" variant="ghost" disabled={referencesLoading} onClick={() => setAiReferences(current => current.filter(item => item.id !== reference.id))}>移除</Button></div>)}</div>
            <p className="ie-hint">单张不超过 30 MiB，合计不超过 32 MiB。只发送已选参考；地图上下文不会自动上传。</p>
            <p className="ie-hint">选区外像素保持不变。{aiPreserveAlpha ? '透明度逐像素保持，不额外清理低透明度像素。' : '选区内透明度可能变化。'}颜色、内部细节、接缝与碰撞适配仍需检查。</p>
            {controller.dirty && <><output className="ie-ai-reason">仍有未保存笔划，请先保存为候选。</output><Button size="sm" variant="outline" onClick={() => switchMode('local')}>返回本地保存笔划</Button></>}
            <Button disabled={!loaded.metadata.target.aiEdit?.supported || controller.dirty || !controller.selectionCount || !aiPrompt.trim() || referencesLoading} onClick={() => void runOperation({ type: 'ai-edit', prompt: aiPrompt }, aiReferences)}>生成 AI 候选（调用模型）</Button>
          </fieldset>}
          <p className="ie-hint">选区与笔划分别撤销。移动扩展至源区与目标区；其他操作保护选区外 RGBA。</p>
          {candidate && <ImageCandidateEvidence candidate={candidate} session={loaded.session} />}
          {!!loaded.session.candidates.filter(item => item.status !== 'completed').length && <details className="ie-task-status"><summary>原任务状态</summary>{loaded.session.candidates.filter(item => item.status !== 'completed').map((item, index) => <p key={item.version}>{operationNames[item.operation.type] || '候选'} {index + 1}：{statusNames[item.status] || item.status}{item.error && <span> · {item.error}</span>}</p>)}<p>关闭窗口不取消；只查询既有任务，不重新提交。</p></details>}
        </aside>
      </div>
      {recoverableDraft && <div className="ie-status"><span>发现本机未保存笔划（{new Date(recoverableDraft.updatedAt).toLocaleString()}）。</span><Button size="sm" disabled={!!busy || !!pending || forceReadOnly} onClick={() => void restoreDraft()}>恢复本机笔划</Button><Button size="sm" variant="ghost" onClick={() => setRecoverableDraft(null)}>暂不恢复</Button><Button size="sm" variant="ghost" disabled={!!busy || !!pending} onClick={() => { void saveImagePixelDraft(null, recoverableDraft.key).then(() => setRecoverableDraft(null)).catch(cause => setError(message(cause))); }}>删除这份本机草稿</Button></div>}
      <footer className="ie-footer"><div className="ie-history"><button className={loaded.baseVersion === 'source' ? 'ie-history-selected' : ''} disabled={!!busy || !!pending} onClick={() => void selectCandidate('source')}>原始图片</button>{loaded.session.candidates.map((item, index) => <button key={item.version} className={loaded.baseVersion === item.version ? 'ie-history-selected' : ''} disabled={!!busy || !!pending || item.status !== 'completed'} onClick={() => void selectCandidate(item.version)}><span>候选 {index + 1} · {operationNames[item.operation.type] || '本地修改'}</span><small>{statusNames[item.status] || item.status}</small></button>)}</div><div className="ie-adopt-actions"><select aria-label="编辑会话" value={loaded.session.editId} disabled={!!busy || !!pending} onChange={event => void selectSession(event.target.value)}><option value={loaded.session.editId}>当前编辑会话</option>{loaded.metadata.sessions?.filter(item => item.editId !== loaded.session.editId).map(item => <option key={item.editId} value={item.editId}>{new Date(item.createdAt).toLocaleString()}{item.stale ? ' · 历史来源' : ''}</option>)}</select><Button variant="outline" disabled={adoptionBlocked || !!busy || !!pending || controller.dirty || !loaded.session.adoptions.length} onClick={() => void adopt('source')}>恢复会话原图</Button><Button disabled={adoptionBlocked || !!busy || !!pending || controller.dirty || loaded.baseVersion === 'source' || candidate?.status !== 'completed'} onClick={() => void adopt(loaded.baseVersion)}>采用当前候选</Button></div></footer>
      <div className="ie-status" aria-live="polite">{busy || error || notice || (controller.dirty ? '笔划尚未保存；关闭或离开前会提醒。' : '候选与采用分开；选择明确版本后采用。')}{forceReadOnly && <span>{readOnly ? '当前入口只读：可查看原图和历史候选，不能编辑或采用。' : loaded.metadata.target.readOnlyReason}</span>}{loaded.followVersion && <span>跟随请求的候选；当前显示其已保存基准。</span>}{loaded.metadata.target.willStopDefaultAnimations && <span>采用默认图将停止默认待机/聚焦动画选择；动画片段保留。</span>}{pending && !busy && <Button size="sm" variant="outline" onClick={() => void execute(pending)}>{pending.external ? '恢复同一请求（不新建）' : '重试同一操作'}</Button>}{!busy && <Button size="sm" variant="ghost" onClick={() => void refreshTarget()}>刷新目标状态</Button>}{loaded.metadata.relatedPagination?.sessions.nextOffset != null && <Button size="sm" variant="outline" disabled={!!busy || !!pending} onClick={() => void loadMoreRelated('sessions')}>加载更多会话（已显示 {loaded.metadata.sessions?.length || 0}/{loaded.metadata.relatedPagination.sessions.total}）</Button>}{!forceReadOnly && !canContinue && !busy && !pending && <><span>此会话用于查看与恢复；继续修改将基于当前目标。</span><Button size="sm" variant="outline" onClick={() => void startNewSession()}>{sessionStartFailed ? '重试建立编辑会话' : '基于当前图片继续精修'}</Button>{sessionStartFailed && <Button size="sm" variant="ghost" onClick={() => void startNewSession(true)}>放弃此次打开并按当前目标重建</Button>}</>}</div>
    </>}
    {leavePrompt && <div className="ie-leave" role="alertdialog" aria-label="离开局部调整"><h3>离开局部调整？</h3><p>{busy || pending ? '请求可能已保存到会话。关闭不取消，也不会重新提交；之后通过原会话继续检查。' : aiDraftDirty ? '未提交的 AI 描述、参考选择及未保存笔划将丢失；运行任务和已保存候选保留。' : '未保存的笔划将丢失；已保存的候选和采用记录保留。'}</p><div className="ie-row"><Button onClick={() => setLeavePrompt(false)}>继续编辑</Button><Button variant="destructive" onClick={() => { if (loaded) void saveImagePixelDraft(null, `${loaded.session.editId}:${draftOwner.current}`).catch(() => undefined); onClose(); }}>舍弃未保存内容并关闭</Button></div></div>}
  </dialog></div>;
}

function ImageCandidateEvidence({ candidate, session }: { candidate: ImageCandidate; session: ImageEditSession }) {
  const base = candidate.diffFromBase || candidate.diff, source = candidate.diffFromSource;
  const baseName = !candidate.baseCandidateVersion || candidate.baseCandidateVersion === 'source' ? '原始图' : `候选 ${session.candidates.findIndex(item => item.version === candidate.baseCandidateVersion) + 1}`;
  return <section className="ie-evidence" aria-label="候选保护证据"><h3>候选检查</h3>
    <p>本步基准：{baseName}</p>
    {base ? <><p>本步变化 {base.changedPixelCount.toLocaleString()} 像素 · 保护区变化 {base.changedOutsideRegion.toLocaleString()}</p><p>本步 Alpha 变化 {base.alphaChangedPixelCount.toLocaleString()} 像素</p></> : <p>本步像素检查尚未完成。</p>}
    {source && <p>累计相对原始图：{source.changedPixelCount.toLocaleString()} 像素；当前区域外 {source.changedOutsideRegion.toLocaleString()}（可包含先前编辑）。</p>}
    {candidate.evidence?.preservation?.changedOutsideMaskPixels !== undefined && <p>编码后保护区变化：{candidate.evidence.preservation.changedOutsideMaskPixels}</p>}
    {candidate.operation.type === 'ai-edit' && <p>{candidate.evidence?.model || candidate.evidence?.provider || 'AI 图片候选'} · {candidate.evidence?.alphaPreservation?.changedAlphaPixels === 0 ? '透明度已按本步基准保持并校验' : '未启用透明度保持，选区内 Alpha 可能变化'}；仍需检查内部细节与接缝。</p>}
  </section>;
}
