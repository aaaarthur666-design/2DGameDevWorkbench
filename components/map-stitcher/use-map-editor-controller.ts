'use client';
import {
  captureGenerationRequest,
  composeGenerationPrompt,
  generationUnavailableReason,
  readAdditionalPrompt,
  type GenerationRequest,
} from '@/features/map-stitcher/generation-request';
import { useMapLayout } from './use-map-layout';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from '@/components/ui/toast';
import {
  CENTER_KEY,
  clamp,
  type ImageAsset,
  type Feather,
} from '@/features/map-stitcher/map-types';
import {
  DEFAULT_DISPLAY_VISIBILITY,
  DEFAULT_IMAGE_LOCKS,
  DEFAULT_REGION_LOCKS,
  DEFAULT_REGION_VISIBILITY,
  DEFAULT_OVERALL_PROMPT,
  upgradeLegacyOverallPrompt,
  MAP_IMAGE_LAYERS,
  REGION_LAYERS,
  isEditableMapLayer,
  isRegionAuthoringMapLayer,
  regionShapeId,
  type MapDisplayLayer,
  type MapImageLayer,
  type RegionLayer,
  type RegionShape,
  type RegionTool,
  type FrameRoninTile,
  type ImageOrigin,
} from '@/features/map-stitcher/frame-ronin-types';
import {
  MapHistory,
  DEFAULT_EDITOR_PREFERENCES,
  assertImageWrite,
  retainedAssets,
  readEditorPreferences,
  type MapDocument,
  type EditorMode,
  type EditorSelection,
  type ImageWriteTicket,
} from '@/features/map-stitcher/editor-state';
import {
  IMAGE_VIEW_LABELS,
  assertRegionWrite,
  regionsInScope,
} from '@/features/map-stitcher/editor-selectors';
import {
  createFrameRoninCenterTile,
  expandAroundFrameRoninTile,
  isSameFrameRoninGeometry,
  tilePixelSize,
} from '@/features/map-stitcher/frame-ronin-geometry';
import { normalizeRegionShape } from '@/features/map-stitcher/region-engine';
import {
  blobToAsset,
  canvasToBlob,
  dataUrlToBlob,
  downloadBlob,
  fileToAsset,
  urlToBlob,
} from '@/features/map-stitcher/image-utils';
import {
  createGenerationTemplate,
  deriveObjectFromMattes,
  renderStitchedMap,
} from '@/features/map-stitcher/layer-engine';
import {
  createMatteReference,
  downloadAllPng,
  renderExportPreview,
} from '@/features/map-stitcher/map-production';
import { loadMapProject } from '@/features/map-stitcher/godot-import';
import {
  downloadPixelworkState,
  type FrameRoninEditorSnapshot,
} from '@/features/map-stitcher/state-package';
import { exportGodotPackage } from '@/features/map-stitcher/engine-export';
import { exportFrameRoninPsd } from '@/features/map-stitcher/psd-export';
import {
  GenerationQueue,
  type QueueSnapshot,
} from '@/features/map-stitcher/generation-queue';
import { useLiveState } from './use-live-state';
import { useMapApiSettings } from './panels/map-api-settings';
import { saveBeforeReplacement } from '@/lib/workbench/editor-session';

const initialQueue: QueueSnapshot = {
  jobs: [],
  paused: false,
  reason: '',
  active: 0,
};
export type MapExportFormat =
  | 'png'
  | 'top-png'
  | 'all-png'
  | 'composite'
  | 'state'
  | 'psd'
  | 'godot';
export function useMapEditorController() {
  const [workspaceId, setWorkspaceId] = useState('');
  const [history] = useState(() => new MapHistory());
  const historyView = useSyncExternalStore(
    history.subscribe,
    history.getSnapshot,
    history.getSnapshot,
  );
  const revision = historyView.revision;
  const epoch = useRef(0);
  const pool = useRef(new Map<string, ImageAsset>());
  const disposal = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historySelections = useRef(new WeakMap<MapDocument, EditorSelection>());
  const [selection, setSelection, selectionRef] = useLiveState<EditorSelection>(
    { kind: 'none' },
  );
  const [activeMapLayer, setActiveMapLayer, mapLayerRef] =
    useLiveState<MapDisplayLayer>('overall');
  const [activeRegionLayer, setActiveRegionLayer, regionLayerRef] =
    useLiveState<RegionLayer>('collision');
  const [mode, setMode] = useLiveState<EditorMode>('navigate');
  const [regionTool, setRegionTool] = useState<RegionTool>('select');
  const [session, setSession] = useState(0);
  const [panel, setPanel] = useState<'tile' | 'region' | 'queue'>('tile');
  const layout = useMapLayout();
  const { setPanelOpen } = layout;
  const [preferences, setPreferences, preferencesRef] = useLiveState({
    ...DEFAULT_EDITOR_PREFERENCES,
  });
  const [imageLocks, setImageLocks, imageLocksRef] = useLiveState({
    ...DEFAULT_IMAGE_LOCKS,
  });
  const [regionLocks, setRegionLocks, regionLocksRef] = useLiveState({
    ...DEFAULT_REGION_LOCKS,
  });
  const [regionVisibility, setRegionVisibility, regionVisibilityRef] =
    useLiveState({ ...DEFAULT_REGION_VISIBILITY });
  const lockVersions = useRef(
    Object.fromEntries(MAP_IMAGE_LAYERS.map((layer) => [layer, 0])) as Record<
      MapImageLayer,
      number
    >,
  );
  const [horizontalOverlap, setHorizontalOverlap] = useState(15);
  const [verticalOverlap, setVerticalOverlap] = useState(15);
  const [expandSplit, setExpandSplit] = useState<4 | 8 | 12>(4);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [fitRequest, setFitRequest] = useState(0);
  const [panMode, setPanMode] = useState(false);
  const [hideCards, setHideCards] = useState(false);
  const [hideBorders, setHideBorders] = useState(false);
  const [exportPreview, setExportPreview] = useState(false);
  const [storedPrompt, setPrompt, promptRef] = useLiveState(
    DEFAULT_OVERALL_PROMPT,
  );
  const prompt = upgradeLegacyOverallPrompt(storedPrompt);
  const [hint, setHint] = useState(
    '导入地图后选择图片视图，或打开已有状态继续编辑。',
  );
  const [busy, setBusy] = useState(false);
  const [fineSession, setFineSession] = useState<{
    ticket: ImageWriteTicket;
    original: ImageAsset;
    previousMode: EditorMode;
  } | null>(null);
  const [queueState, setQueueState] = useState<QueueSnapshot>(initialQueue);
  const automaticRemaining = useRef(0);
  const automaticRequest = useRef<GenerationRequest | null>(null);
  const [queue] = useState(
    () =>
      new GenerationQueue({
        concurrency: () => 1,
        canStart: () => '编辑器尚未就绪。',
        run: async () => {
          throw new Error('编辑器尚未就绪。');
        },
        onChange: setQueueState,
      }),
  );
  const api = useMapApiSettings();
  const document = historyView.document;
  const tiles = document.tiles,
    shapes = document.shapes;
  const selectedKey = selection.kind === 'none' ? null : selection.tileKey;
  const selectedShapeId = selection.kind === 'region' ? selection.id : null;
  const selectedTile = tiles.find((tile) => tile.key === selectedKey) ?? null;
  const sourceAsset = tiles.find((tile) => tile.key === CENTER_KEY)?.images
    .overall;
  const imageCount = tiles.reduce(
    (sum, tile) => sum + Object.keys(tile.images).length,
    0,
  );
  const memoryBytes = [
    ...retainedAssets([
      document,
      ...historyView.past.map((entry) => entry.document),
      ...historyView.future.map((entry) => entry.document),
    ]).values(),
  ].reduce((sum, asset) => sum + asset.width * asset.height * 4, 0);
  const scope = () => ({
    tileKey:
      selectionRef.current.kind === 'none'
        ? null
        : selectionRef.current.tileKey,
    mapLayer: mapLayerRef.current,
    scope: preferencesRef.current.regionScope,
    layer: regionLayerRef.current,
    visibility: regionVisibilityRef.current,
  });
  const scopedRegions = regionsInScope(shapes, {
    tileKey: selectedKey,
    mapLayer: activeMapLayer,
    scope: preferences.regionScope,
    layer: activeRegionLayer,
    visibility: regionVisibility,
  });
  const otherViewCount = shapes.filter(
    (shape) =>
      shape.tileKey === selectedKey && shape.mapLayer !== activeMapLayer,
  ).length;

  const report = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    setHint(message);
    toast.add({
      title: '操作未完成',
      description: message,
      type: 'error',
      timeout: 6000,
    });
  };
  const perform = (action: () => unknown) => {
    try {
      const result = action();
      if (result instanceof Promise) void result.catch(report);
    } catch (error) {
      report(error);
    }
  };
  const resetSession = () => {
    setSession((value) => value + 1);
  };
  const publish = () => {
    const retained = retainedAssets(history.documents());
    for (const [url] of pool.current)
      if (!retained.has(url)) URL.revokeObjectURL(url);
    pool.current = retained;
    const current = selectionRef.current;
    if (
      current.kind !== 'none' &&
      !history.document.tiles.some((tile) => tile.key === current.tileKey)
    )
      setSelection({ kind: 'none' });
    else if (
      current.kind === 'region' &&
      !history.document.shapes.some((shape) => shape.id === current.id)
    )
      setSelection({ kind: 'tile', tileKey: current.tileKey });
  };
  const commit = (next: MapDocument, label: string) => {
    historySelections.current.set(history.document, selectionRef.current);
    history.commit(next, label);
    publish();
    historySelections.current.set(history.document, selectionRef.current);
  };
  const cancelQueue = () => {
    automaticRemaining.current = 0;
    automaticRequest.current = null;
    queue.cancel();
  };
  const invalidate = (resetMode = true) => {
    epoch.current++;
    cancelQueue();
    resetSession();
    setFineSession(null);
    setMode((value) => (resetMode || value === 'pixel' ? 'navigate' : value));
  };
  const restoreHistorySelection = () => {
    publish();
    const remembered = historySelections.current.get(history.document);
    if (!remembered) return;
    setSelection(remembered);
    if (remembered.kind === 'region') {
      const shape = history.document.shapes.find(
        (item) => item.id === remembered.id,
      );
      if (shape) {
        setActiveMapLayer(shape.mapLayer);
        setActiveRegionLayer(shape.layer);
      }
    }
  };
  const undo = () => {
    invalidate(false);
    if (history.undo()) {
      restoreHistorySelection();
      setHint('已撤销最近的地图修改。');
    }
  };
  const redo = () => {
    invalidate(false);
    if (history.redo()) {
      restoreHistorySelection();
      setHint('已重做地图修改。');
    }
  };
  const selectTile = (tileKey: string) => {
    if (!history.document.tiles.some((tile) => tile.key === tileKey))
      throw new Error('地图块不存在。');
    if (
      selectionRef.current.kind === 'none' ||
      selectionRef.current.tileKey !== tileKey
    )
      resetSession();
    setSelection({ kind: 'tile', tileKey });
  };
  const selectView = (layer: MapDisplayLayer) => {
    setActiveMapLayer(layer);
    resetSession();
    setExportPreview(false);
    const current = selectionRef.current;
    if (current.kind === 'region')
      setSelection({ kind: 'tile', tileKey: current.tileKey });
    if (!isRegionAuthoringMapLayer(layer)) setMode('navigate');
    setHint(
      `${IMAGE_VIEW_LABELS[layer]}视图。区域保留其所属视图，可在区域面板查看其他视图的标注。`,
    );
  };
  const selectRegion = (id: string | null) => {
    if (!id) {
      if (selectedKey) setSelection({ kind: 'tile', tileKey: selectedKey });
      return;
    }
    const shape = history.document.shapes.find((item) => item.id === id);
    if (!shape) throw new Error('区域不存在。');
    if (
      shape.mapLayer !== mapLayerRef.current ||
      shape.tileKey !== selectedKey ||
      shape.layer !== regionLayerRef.current
    )
      resetSession();
    setActiveMapLayer(shape.mapLayer);
    setActiveRegionLayer(shape.layer);
    setRegionVisibility((value) => ({ ...value, [shape.layer]: true }));
    setSelection({ kind: 'region', tileKey: shape.tileKey, id });
    setRegionTool('select');
    setMode('region');
    setPanel('region');
    setExportPreview(false);
  };
  const chooseRegionLayer = (layer: RegionLayer) => {
    resetSession();
    setActiveRegionLayer(layer);
    setPanel('region');
    setRegionVisibility((value) => ({ ...value, [layer]: true }));
    if (selectedKey) setSelection({ kind: 'tile', tileKey: selectedKey });
  };
  const chooseTool = (tool: RegionTool) => {
    if (!selectedTile || selectedTile.hidden)
      throw new Error('请先选择参与地图输出的卡片。');
    if (!isRegionAuthoringMapLayer(mapLayerRef.current))
      throw new Error('请选择整体、地表或物件视图绘制区域。');
    if (tool !== 'select' && regionLocksRef.current[regionLayerRef.current])
      throw new Error('当前区域类别已锁定。');
    resetSession();
    setMode('region');
    setRegionTool(tool);
    setPanMode(false);
    setPanel('region');
    setExportPreview(false);
    setPreferences((value) => ({ ...value, showRegions: true }));
    setRegionVisibility((value) => ({
      ...value,
      [regionLayerRef.current]: true,
    }));
    setHint(
      tool === 'rectangle'
        ? '点击设置起点，再次点击确定矩形终点。'
        : tool === 'polygon'
          ? '点击添加顶点，Enter / C 完成，Backspace 撤回顶点。'
          : tool === 'free'
            ? '按住左键绘制套索，松开后闭合。'
            : '点击当前类别的区域进行选择或删除。',
    );
  };
  const toggleImageLock = (layer: MapImageLayer) => {
    lockVersions.current[layer]++;
    setImageLocks((value) => ({ ...value, [layer]: !value[layer] }));
  };
  const toggleRegionLock = (layer: RegionLayer) => {
    resetSession();
    setRegionLocks((value) => ({ ...value, [layer]: !value[layer] }));
  };
  const toggleRegionVisibility = (layer: RegionLayer) => {
    resetSession();
    setRegionVisibility((value) => ({ ...value, [layer]: !value[layer] }));
    if (layer === regionLayerRef.current && selectedKey)
      setSelection({ kind: 'tile', tileKey: selectedKey });
  };
  const imageTicket = (
    tileKey: string,
    layer: MapImageLayer,
  ): ImageWriteTicket => {
    const tile = history.document.tiles.find((item) => item.key === tileKey);
    if (!tile) throw new Error('地图块不存在。');
    if (imageLocksRef.current[layer])
      throw new Error(`${IMAGE_VIEW_LABELS[layer]}图片已锁定（全部卡片）。`);
    return {
      epoch: epoch.current,
      tileKey,
      layer,
      before: tile.images[layer]?.url,
      lockVersion: lockVersions.current[layer],
    };
  };
  const applyAssets = (
    updates: Array<{
      ticket: ImageWriteTicket;
      asset?: ImageAsset;
      origin?: ImageOrigin;
      surfaceIsDraft?: boolean;
    }>,
    label: string,
  ) => {
    try {
      for (const { ticket } of updates)
        assertImageWrite(
          ticket,
          history.document,
          epoch.current,
          imageLocksRef.current[ticket.layer],
          lockVersions.current[ticket.layer],
        );
      const next = history.document.tiles.map((tile) => {
        const changes = updates.filter(
          ({ ticket }) => ticket.tileKey === tile.key,
        );
        if (!changes.length) return tile;
        const images = { ...tile.images };
        const imageOrigins = { ...tile.imageOrigins };
        let surfaceIsDraft = tile.surfaceIsDraft;
        for (const {
          ticket,
          asset,
          origin = 'uploaded',
          surfaceIsDraft: draft,
        } of changes) {
          if (asset) {
            images[ticket.layer] = asset;
            imageOrigins[ticket.layer] = origin;
          } else {
            delete images[ticket.layer];
            delete imageOrigins[ticket.layer];
          }
          if (ticket.layer === 'surface')
            surfaceIsDraft =
              draft ??
              (origin === 'pixel-edited' ? tile.surfaceIsDraft : false);
        }
        return { ...tile, images, imageOrigins, surfaceIsDraft };
      });
      commit({ ...history.document, tiles: next }, label);
    } catch (error) {
      for (const { asset } of updates)
        if (asset && !pool.current.has(asset.url))
          URL.revokeObjectURL(asset.url);
      throw error;
    }
  };
  const resetDocument = (next: MapDocument) => {
    history.reset(next);
    publish();
  };
  const newProject = () => {
    invalidate();
    queue.reset();
    resetDocument({ tiles: [], shapes: [] });
    historySelections.current = new WeakMap();
    setWorkspaceId('');
    setSelection({ kind: 'none' });
    setActiveMapLayer('overall');
    setActiveRegionLayer('collision');
    setRegionTool('select');
    setPanel('tile');
    setPreferences({ ...DEFAULT_EDITOR_PREFERENCES });
    setImageLocks({ ...DEFAULT_IMAGE_LOCKS });
    setRegionLocks({ ...DEFAULT_REGION_LOCKS });
    setRegionVisibility({ ...DEFAULT_REGION_VISIBILITY });
    setHorizontalOverlap(15);
    setVerticalOverlap(15);
    setExpandSplit(4);
    setPan({ x: 0, y: 0 });
    setZoom(1);
    setPanMode(false);
    setHideCards(false);
    setHideBorders(false);
    setExportPreview(false);
    setPrompt(DEFAULT_OVERALL_PROMPT);
    setFitRequest((value) => value + 1);
    setHint('已新建空白项目。导入中心地图图片即可开始。');
  };
  const importImages = async (files: File[]) => {
    if (!files.length) return;
    await saveBeforeReplacement('map-stitcher');
    invalidate();
    const token = epoch.current;
    setBusy(true);
    const assets: ImageAsset[] = [];
    try {
      for (const file of files) assets.push(await fileToAsset(file));
      if (token !== epoch.current) throw new Error('导入已被新操作取消。');
      const center = createFrameRoninCenterTile(assets[0]);
      const next = [
        center,
        ...expandAroundFrameRoninTile(
          center,
          expandSplit,
          horizontalOverlap,
          verticalOverlap,
        ),
      ];
      if (assets.length > next.length)
        throw new Error(
          `首圈只有 ${next.length} 个卡片，请减少图片或先扩展后批量上传。`,
        );
      for (let index = 1; index < assets.length; index++)
        next[index] = { ...next[index], images: { overall: assets[index] } };
      resetDocument({ tiles: next, shapes: [] });
      setWorkspaceId(`map:${crypto.randomUUID()}`);
      setSelection({ kind: 'tile', tileKey: CENTER_KEY });
      setActiveMapLayer('overall');
      setImageLocks({ ...DEFAULT_IMAGE_LOCKS });
      setRegionLocks({ ...DEFAULT_REGION_LOCKS });
      setRegionVisibility({ ...DEFAULT_REGION_VISIBILITY });
      setPreferences((value) => ({
        ...value,
        showImage: true,
        showRegions: true,
      }));
      setExportPreview(false);
      setFitRequest((value) => value + 1);
      setHint('地图已导入。可先扩图，也可上传独立地表和透明物件。');
    } catch (error) {
      for (const asset of assets)
        if (!pool.current.has(asset.url)) URL.revokeObjectURL(asset.url);
      throw error;
    } finally {
      setBusy(false);
    }
  };
  const openProject = async (files: File[]) => {
    const file =
      files.find((item) => item.name === 'source_state.zip') ??
      files.find((item) => /\.zip$/i.test(item.name)) ??
      files.find((item) => item.name === 'map_stitch_state.json') ??
      files.find((item) =>
        /^(map_export|map_stitch_godot)\.json$/i.test(item.name),
      ) ??
      files.find((item) => /\.json$/i.test(item.name));
    if (!file)
      throw new Error('请选择状态 ZIP / JSON 或完整 Godot 资源文件夹。');
    await saveBeforeReplacement('map-stitcher');
    invalidate();
    const token = epoch.current;
    setBusy(true);
    try {
      const loaded = await loadMapProject(file, files);
      if (token !== epoch.current) {
        for (const asset of retainedAssets([loaded]).values())
          URL.revokeObjectURL(asset.url);
        throw new Error('导入已取消。');
      }
      resetDocument(loaded);
      setWorkspaceId(`map:${crypto.randomUUID()}`);
      setSelection({
        kind: 'tile',
        tileKey: loaded.tiles.some((tile) => tile.key === loaded.selectedKey)
          ? loaded.selectedKey!
          : CENTER_KEY,
      });
      setActiveMapLayer(loaded.activeMapLayer);
      setPan(loaded.pan);
      setZoom(loaded.zoom);
      setPrompt(loaded.overallPrompt);
      setHorizontalOverlap(loaded.horizontalOverlapPercent);
      setVerticalOverlap(loaded.verticalOverlapPercent);
      setExpandSplit(loaded.expandSplit);
      setHideCards(loaded.hidePreviewCards);
      setHideBorders(loaded.hidePreviewBorders);
      setImageLocks(loaded.imageLocks);
      setRegionLocks(loaded.regionLocks);
      setRegionVisibility(loaded.regionVisibility);
      setPreferences(
        readEditorPreferences(
          loaded.editorPreferences ?? {
            showImage: loaded.displayVisibility[loaded.activeMapLayer],
          },
        ),
      );
      setExportPreview(false);
      setHint(loaded.warnings.join(' ') || '地图状态已恢复。');
      if (loaded.warnings.length)
        toast.add({
          title: '地图已恢复',
          description: loaded.warnings.join(' '),
          type: 'warning',
          timeout: 10000,
        });
    } finally {
      setBusy(false);
    }
  };
  const uploadToLayer = async (
    files: File[],
    targetKey = selectedKey,
    layer: MapImageLayer | MapDisplayLayer = mapLayerRef.current,
  ) => {
    if (!files.length) return;
    if (!targetKey || !isEditableMapLayer(layer))
      throw new Error('请选择卡片及可编辑图片视图；Mask 是只读派生预览。');
    const ordered = [
      history.document.tiles.find((tile) => tile.key === targetKey),
      ...history.document.tiles.filter(
        (tile) => tile.key !== targetKey && !tile.hidden && !tile.images[layer],
      ),
    ].filter(Boolean) as FrameRoninTile[];
    if (files.length > ordered.length)
      throw new Error('可用空卡片不足，请先扩展地图。');
    const tickets = files.map((_, index) =>
      imageTicket(ordered[index].key, layer),
    );
    const assets: ImageAsset[] = [];
    try {
      for (const file of files) assets.push(await fileToAsset(file));
      applyAssets(
        assets.map((asset, index) => ({ asset, ticket: tickets[index] })),
        '上传图片',
      );
      setHint(`已上传 ${files.length} 张${IMAGE_VIEW_LABELS[layer]}图片。`);
    } catch (error) {
      for (const asset of assets)
        if (!pool.current.has(asset.url)) URL.revokeObjectURL(asset.url);
      throw error;
    }
  };
  const expand = (key = selectedKey) => {
    const origin = history.document.tiles.find((tile) => tile.key === key);
    if (!origin) throw new Error('请先选择地图块。');
    const distance = Math.hypot(
      origin.x + origin.w / 2 - 0.5,
      origin.y + origin.h / 2 - 0.5,
    );
    const candidates = expandAroundFrameRoninTile(
      origin,
      key === CENTER_KEY ? expandSplit : 4,
      horizontalOverlap,
      verticalOverlap,
    ).filter(
      (candidate) =>
        !history.document.tiles.some(
          (tile) =>
            tile.key === candidate.key ||
            isSameFrameRoninGeometry(tile, candidate),
        ) &&
        (key === CENTER_KEY ||
          Math.hypot(
            candidate.x + candidate.w / 2 - 0.5,
            candidate.y + candidate.h / 2 - 0.5,
          ) >
            distance - 0.0001),
    );
    if (candidates.length)
      commit(
        {
          ...history.document,
          tiles: [...history.document.tiles, ...candidates],
        },
        '扩展地图卡片',
      );
    return candidates;
  };
  const createRegions = (
    inputs: Array<Omit<RegionShape, 'id'> & { id?: string }>,
    fromAgent = false,
  ) => {
    const source = history.document.tiles.find(
      (tile) => tile.key === CENTER_KEY,
    )?.images.overall;
    if (!source) throw new Error('请先导入地图。');
    if (!inputs.length || inputs.length > 500)
      throw new Error('一次创建区域数量必须为 1–500。');
    const ids = new Set(history.document.shapes.map((shape) => shape.id));
    const additions = inputs.map((input) => {
      const tile = history.document.tiles.find(
        (item) => item.key === input.tileKey,
      );
      if (!tile || tile.hidden)
        throw new Error('区域目标卡片不存在或已排除输出。');
      if (
        !REGION_LAYERS.includes(input.layer) ||
        !isRegionAuthoringMapLayer(input.mapLayer)
      )
        throw new Error('区域类别或所属视图无效。');
      if (regionLocksRef.current[input.layer])
        throw new Error('目标区域类别已锁定。');
      const id = input.id || regionShapeId(input.layer);
      if (ids.has(id)) throw new Error('区域 ID 重复。');
      ids.add(id);
      const size = tilePixelSize(tile, source.width, source.height);
      const shape = normalizeRegionShape(
        { ...input, id },
        size.width,
        size.height,
      );
      if (!shape) throw new Error('区域坐标、面积或边界无效。');
      if (!fromAgent)
        assertRegionWrite(
          shape,
          { ...scope(), scope: 'view' },
          regionLocksRef.current,
        );
      return shape;
    });
    commit(
      {
        ...history.document,
        shapes: [...history.document.shapes, ...additions],
      },
      '创建区域',
    );
    setHint(`已创建 ${additions.length} 个区域。`);
    return additions;
  };
  const deleteRegion = (id: string) => {
    const shape = history.document.shapes.find((item) => item.id === id);
    if (!shape) return;
    assertRegionWrite(
      shape,
      { ...scope(), scope: 'view' },
      regionLocksRef.current,
    );
    commit(
      {
        ...history.document,
        shapes: history.document.shapes.filter((item) => item.id !== id),
      },
      '删除区域',
    );
  };
  const clearRegions = () => {
    const targets = regionsInScope(history.document.shapes, scope());
    for (const shape of targets)
      assertRegionWrite(shape, scope(), regionLocksRef.current);
    if (!targets.length) return;
    const ids = new Set(targets.map((shape) => shape.id));
    commit(
      {
        ...history.document,
        shapes: history.document.shapes.filter((shape) => !ids.has(shape.id)),
      },
      '清空当前范围区域',
    );
    setHint(`已清空当前范围内 ${targets.length} 个区域，可撤销恢复。`);
  };
  const removeImage = () => {
    if (!selectedKey || !isEditableMapLayer(activeMapLayer)) return;
    if (selectedKey === CENTER_KEY && activeMapLayer === 'overall')
      throw new Error(
        '中心整体图用于地图坐标，不能单独删除。可通过顶部“新建项目”清空地图。',
      );
    applyAssets(
      [{ ticket: imageTicket(selectedKey, activeMapLayer) }],
      '删除图片',
    );
  };
  const setFeather = (side: keyof Feather, value: number) => {
    if (!selectedKey) return;
    if (
      MAP_IMAGE_LAYERS.some(
        (layer) => selectedTile?.images[layer] && imageLocksRef.current[layer],
      )
    )
      throw new Error('羽化影响该卡片的全部图片，请先解除相关图片锁定。');
    commit(
      {
        ...history.document,
        tiles: history.document.tiles.map((tile) =>
          tile.key === selectedKey
            ? {
                ...tile,
                feather: {
                  ...tile.feather,
                  [side]: clamp(Math.round(value), 0, 50),
                },
              }
            : tile,
        ),
      },
      '修改卡片羽化',
    );
  };
  const toggleIncluded = () => {
    if (!selectedKey) return;
    resetSession();
    commit(
      {
        ...history.document,
        tiles: history.document.tiles.map((tile) =>
          tile.key === selectedKey ? { ...tile, hidden: !tile.hidden } : tile,
        ),
      },
      '修改卡片输出范围',
    );
  };
  const startFineEdit = () => {
    if (!selectedKey || !isEditableMapLayer(activeMapLayer))
      throw new Error('请选择可编辑图片。');
    const ticket = imageTicket(selectedKey, activeMapLayer);
    const original = selectedTile?.images[activeMapLayer];
    if (!original) throw new Error('请先上传图片。');
    resetSession();
    setFineSession({ ticket, original, previousMode: mode });
    setMode('pixel');
  };
  const closeFineEdit = () => {
    setMode(fineSession?.previousMode ?? 'navigate');
    setFineSession(null);
    resetSession();
  };
  const applyFineEdit = async (blob: Blob | null) => {
    if (!fineSession) return;
    if (
      !blob &&
      fineSession.ticket.tileKey === CENTER_KEY &&
      fineSession.ticket.layer === 'overall'
    )
      throw new Error('中心整体图不能清空。');
    const asset = blob
      ? await blobToAsset(blob, `${fineSession.original.name}_edited.png`)
      : undefined;
    applyAssets(
      [{ ticket: fineSession.ticket, asset, origin: 'pixel-edited' }],
      '像素精修',
    );
    closeFineEdit();
  };
  const confirmSurface = () => {
    if (!selectedKey || !selectedTile?.images.surface)
      throw new Error('请先上传或处理地表草稿。');
    imageTicket(selectedKey, 'surface');
    commit(
      {
        ...history.document,
        tiles: history.document.tiles.map((tile) =>
          tile.key === selectedKey ? { ...tile, surfaceIsDraft: false } : tile,
        ),
      },
      '确认独立地表',
    );
    setHint('地表已标记为独立素材，将与物件共同参与分层合成。');
  };

  // Generation and export actions are defined below and shared with WebMCP.
  const snapshot = (): FrameRoninEditorSnapshot => ({
    ...history.document,
    selectedKey,
    activeMapLayer,
    horizontalOverlapPercent: horizontalOverlap,
    verticalOverlapPercent: verticalOverlap,
    expandSplit,
    pan,
    zoom,
    overallPrompt: prompt,
    hidePreviewBorders: hideBorders,
    hidePreviewCards: hideCards,
    displayVisibility: {
      ...DEFAULT_DISPLAY_VISIBILITY,
      [activeMapLayer]: preferences.showImage,
    },
    imageLocks,
    regionLocks,
    regionVisibility,
    editorPreferences: preferences,
  });
  const restoreWorkspaceSnapshot = (
    loaded: FrameRoninEditorSnapshot,
    id: string,
  ) => {
    invalidate();
    resetDocument(loaded);
    setWorkspaceId(id);
    setSelection(
      loaded.selectedKey
        ? { kind: 'tile', tileKey: loaded.selectedKey }
        : { kind: 'none' },
    );
    setActiveMapLayer(loaded.activeMapLayer);
    setPan(loaded.pan);
    setZoom(loaded.zoom);
    setPrompt(loaded.overallPrompt);
    setHorizontalOverlap(loaded.horizontalOverlapPercent);
    setVerticalOverlap(loaded.verticalOverlapPercent);
    setExpandSplit(loaded.expandSplit);
    setHideCards(loaded.hidePreviewCards);
    setHideBorders(loaded.hidePreviewBorders);
    setImageLocks(loaded.imageLocks);
    setRegionLocks(loaded.regionLocks);
    setRegionVisibility(loaded.regionVisibility);
    setPreferences(readEditorPreferences(loaded.editorPreferences));
    setExportPreview(false);
    setHint('已恢复本机地图草稿，原始图片、图层和区域都已载入。');
  };
  const generateLayer = async (
    tileKey: string,
    layer: MapImageLayer,
    signal = new AbortController().signal,
    capturedRequest?: GenerationRequest,
  ) => {
    const ticket = imageTicket(tileKey, layer);
    const current = history.document;
    const tile = current.tiles.find((item) => item.key === tileKey)!;
    const source = current.tiles.find((item) => item.key === CENTER_KEY)?.images
      .overall;
    if (!source) throw new Error('请先导入地图。');
    let blob: Blob;
    if (layer === 'object') {
      if (!tile.images.black || !tile.images.white)
        throw new Error('请先上传同一物件的真实黑白参考图。');
      blob = await deriveObjectFromMattes(tile.images.black, tile.images.white);
    } else if (layer === 'surface') {
      if (!tile.images.overall) throw new Error('当前卡片没有整体图片可复制。');
      blob = tile.images.overall.file;
    } else if (layer === 'black' || layer === 'white') {
      if (!tile.images.object)
        throw new Error('生成黑白参考需要先上传透明物件。');
      blob = await createMatteReference(tile.images.object, layer);
    } else {
      const request =
        capturedRequest ??
        captureGenerationRequest(
          api.settingsRef.current,
          promptRef.current,
          tile.additionalPrompt,
        );
      const unavailable = generationUnavailableReason(
        api.settingsRef.current,
        request.provider,
      );
      if (unavailable) throw new Error(unavailable);
      const template = await createGenerationTemplate(
        current.tiles,
        tile,
        'overall',
        source.width,
        source.height,
      );
      const response = await fetch('/api/workbench/map-stitcher/generate', {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operation: 'generate-layer',
          provider: request.provider,
          image: template.toDataURL('image/png'),
          prompt: request.prompt,
          tile: { key: tile.key, x: tile.x, y: tile.y, w: tile.w, h: tile.h },
          layer: 'overall',
          mask_mode: 'white',
        }),
      });
      const payload = (await response.json()) as {
        image?: string;
        error?: string;
      };
      if (!response.ok || typeof payload.image !== 'string')
        throw new Error(payload.error || '生成失败');
      blob = payload.image.startsWith('data:')
        ? dataUrlToBlob(payload.image)
        : await urlToBlob(payload.image);
    }
    signal.throwIfAborted();
    const asset = await blobToAsset(
      blob,
      `${tileKey.replace(',', '_')}_${layer}.png`,
    );
    if (signal.aborted) {
      URL.revokeObjectURL(asset.url);
      signal.throwIfAborted();
    }
    const origin: ImageOrigin =
      layer === 'surface'
        ? 'overall-copy'
        : layer === 'object'
          ? 'matte-extraction'
          : layer === 'black' || layer === 'white'
            ? 'alpha-reference'
            : 'api-generated';
    applyAssets(
      [{ ticket, asset, origin, surfaceIsDraft: layer === 'surface' }],
      layer === 'surface'
        ? '复制整体图为地表草稿'
        : `生成${IMAGE_VIEW_LABELS[layer]}`,
    );
    setHint(
      layer === 'surface'
        ? '已复制为地表草稿；该操作没有移除物件，需上传真实地表或继续精修。'
        : `已完成${IMAGE_VIEW_LABELS[layer]}。`,
    );
  };
  const createReferences = async () => {
    if (!selectedKey) throw new Error('请选择地图块。');
    const black = imageTicket(selectedKey, 'black'),
      white = imageTicket(selectedKey, 'white');
    const object = history.document.tiles.find(
      (tile) => tile.key === selectedKey,
    )?.images.object;
    if (!object) throw new Error('请先上传透明物件。');
    const assets: ImageAsset[] = [];
    try {
      assets.push(
        await blobToAsset(
          await createMatteReference(object, 'black'),
          'black_reference.png',
        ),
      );
      assets.push(
        await blobToAsset(
          await createMatteReference(object, 'white'),
          'white_reference.png',
        ),
      );
      applyAssets(
        [
          { ticket: black, asset: assets[0], origin: 'alpha-reference' },
          { ticket: white, asset: assets[1], origin: 'alpha-reference' },
        ],
        '由透明物件生成黑白参考',
      );
      setHint('已由透明物件生成成对黑白参考。');
    } catch (error) {
      for (const asset of assets)
        if (!pool.current.has(asset.url)) URL.revokeObjectURL(asset.url);
      throw error;
    }
  };
  const scheduleAutomatic = () => {
    if (automaticRemaining.current <= 0) return;
    const jobs = queue.snapshot().jobs;
    const targets = history.document.tiles
      .filter(
        (tile) =>
          !tile.hidden &&
          !tile.images.overall &&
          !jobs.some(
            (job) =>
              job.tileKey === tile.key &&
              job.layer === 'overall' &&
              job.status !== 'cancelled',
          ),
      )
      .slice(0, automaticRemaining.current);
    automaticRemaining.current -= targets.length;
    const captured = automaticRequest.current;
    if (!captured) return;
    queue.add(
      targets.map((tile) => ({
        tileKey: tile.key,
        layer: 'overall',
        request: {
          provider: captured.provider,
          prompt: composeGenerationPrompt(
            captured.prompt,
            tile.additionalPrompt,
          ),
        },
      })),
    );
  };
  useEffect(() => {
    queue.configure({
      concurrency: () => preferencesRef.current.concurrency,
      run: (job, signal) =>
        generateLayer(job.tileKey, job.layer, signal, job.request),
      canStart: (job, active) => {
        if (job.layer === 'overall') {
          if (!job.request)
            return '旧任务没有提示词快照，请取消后重新加入生成队列。';
          const reason = generationUnavailableReason(
            api.settingsRef.current,
            job.request.provider,
          );
          if (reason) return reason;
        }
        if (imageLocksRef.current[job.layer])
          return `${IMAGE_VIEW_LABELS[job.layer]}已锁定，队列暂停。`;
        const source = history.document.tiles.find(
          (tile) => tile.key === CENTER_KEY,
        )?.images.overall;
        const tile = history.document.tiles.find(
          (item) => item.key === job.tileKey,
        );
        if (!source || !tile) return '目标地图已改变，队列暂停。';
        const size = tilePixelSize(tile, source.width, source.height);
        const retained = [
          ...retainedAssets(history.documents()).values(),
        ].reduce((sum, asset) => sum + asset.width * asset.height * 4, 0);
        const estimate =
          retained + size.width * size.height * 4 * 8 * (active + 1);
        return preferencesRef.current.memoryProtection &&
          estimate > preferencesRef.current.memoryLimitMb * 1024 * 1024
          ? '预计解码图片与生成临时画布将超过内存上限。清理历史或调整上限后继续。'
          : null;
      },
      onComplete: (job) => {
        if (job.layer === 'overall' && automaticRemaining.current > 0) {
          expand(job.tileKey);
          scheduleAutomatic();
        }
      },
    });
  });
  const enqueue = (layer: 'overall' | 'object', all = false) => {
    const targets = all
      ? history.document.tiles.filter(
          (tile) =>
            !tile.hidden &&
            !tile.images[layer] &&
            (layer !== 'object' || (tile.images.black && tile.images.white)),
        )
      : selectedTile
        ? [selectedTile]
        : [];
    if (!targets.length)
      throw new Error('没有符合条件的目标卡片。物件提取需要黑白参考。');
    for (const tile of targets) imageTicket(tile.key, layer);
    queue.add(
      targets.map((tile) => ({
        tileKey: tile.key,
        layer,
        request:
          layer === 'overall'
            ? captureGenerationRequest(
                api.settingsRef.current,
                promptRef.current,
                tile.additionalPrompt,
              )
            : undefined,
      })),
    );
    setPanel('queue');
    setPanelOpen(true);
  };
  const startAutomatic = (limit: number) => {
    if (!sourceAsset) throw new Error('请先导入地图。');
    if (imageLocksRef.current.overall) throw new Error('整体图片已锁定。');
    if (
      queue
        .snapshot()
        .jobs.some(
          (job) => job.status === 'running' || job.status === 'pending',
        )
    )
      throw new Error('请先完成或取消现有生成队列。');
    automaticRequest.current = captureGenerationRequest(
      api.settingsRef.current,
      promptRef.current,
    );
    queue.clear();
    automaticRemaining.current = Math.max(1, Math.min(64, Math.round(limit)));
    expand(selectedKey ?? CENTER_KEY);
    scheduleAutomatic();
    setPanel('queue');
    setPanelOpen(true);
  };
  const updateTilePrompt = (tileKey: string, value: string) => {
    const additionalPrompt = readAdditionalPrompt(value);
    const current = history.document;
    const tile = current.tiles.find((item) => item.key === tileKey);
    if (!tile || (tile.additionalPrompt ?? '') === additionalPrompt) return;
    commit(
      {
        ...current,
        tiles: current.tiles.map((item) =>
          item.key === tileKey ? { ...item, additionalPrompt } : item,
        ),
      },
      '修改地图块额外提示词',
    );
  };
  const generationUnavailable =
    generationUnavailableReason(api.settings) ||
    (!prompt.trim() ? '请填写整体层基础提示词。' : null);
  const createExportArtifact = async (
    format: MapExportFormat,
    layer: MapDisplayLayer = mapLayerRef.current,
  ) => {
    if (!sourceAsset) throw new Error('请先导入地图。');
    setBusy(true);
    try {
      const data = snapshot();
      const args = [
        data.tiles,
        data.shapes,
        sourceAsset.width,
        sourceAsset.height,
        sourceAsset.name,
      ] as const;
      if (format === 'state') return await downloadPixelworkState(data);
      if (format === 'godot') return await exportGodotPackage(...args, data);
      if (format === 'psd') return await exportFrameRoninPsd(...args);
      if (format === 'all-png') return await downloadAllPng(...args);
      const rendered =
        format === 'composite'
          ? await renderExportPreview(
              data.tiles,
              data.shapes,
              sourceAsset.width,
              sourceAsset.height,
            )
          : await renderStitchedMap(
              data.tiles,
              format === 'top-png' ? 'top' : layer,
              data.shapes,
              sourceAsset.width,
              sourceAsset.height,
            );
      const fileName = `${sourceAsset.name.replace(/\.[^.]+$/, '')}_${format === 'png' ? layer : format}.png`;
      downloadBlob(await canvasToBlob(rendered.canvas), fileName);
      return { fileName, width: rendered.width, height: rendered.height };
    } finally {
      setBusy(false);
    }
  };
  const exportArtifact = async (
    format: MapExportFormat,
    layer?: MapDisplayLayer,
  ) => {
    const result = await createExportArtifact(format, layer);
    window.dispatchEvent(
      new CustomEvent('workbench:map-export', {
        detail: { id: workspaceId, format },
      }),
    );
    return result;
  };
  const composeScene = async () => {
    if (busy) throw new Error('请等待当前地图操作完成。');
    setBusy(true);
    try {
      const { startSceneFromMap } =
        await import('@/features/scene-composer/browser');
      return await startSceneFromMap(snapshot());
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    // Strict Mode and Fast Refresh re-run effects without discarding the document.
    // Dispose only if the editor stays unmounted through the next task.
    if (disposal.current !== null) clearTimeout(disposal.current);
    const release = () => {
      epoch.current++;
      queue.cancel();
      for (const url of pool.current.keys()) URL.revokeObjectURL(url);
    };
    return () => {
      disposal.current = setTimeout(release, 0);
    };
  }, [queue]);
  return {
    workspaceId,
    getWorkspaceSnapshot: snapshot,
    composeScene,
    restoreWorkspaceSnapshot,
    document,
    tiles,
    shapes,
    revision,
    selection,
    selectedKey,
    selectedShapeId,
    selectedTile,
    sourceAsset,
    imageCount,
    memoryBytes,
    activeMapLayer,
    activeRegionLayer,
    regionTool,
    mode,
    setMode,
    session,
    resetSession,
    panel,
    setPanel,
    ...layout,
    preferences,
    setPreferences,
    imageLocks,
    regionLocks,
    regionVisibility,
    toggleImageLock,
    toggleRegionLock,
    toggleRegionVisibility,
    horizontalOverlap,
    setHorizontalOverlap,
    verticalOverlap,
    setVerticalOverlap,
    expandSplit,
    setExpandSplit,
    pan,
    setPan,
    zoom,
    setZoom,
    fitRequest,
    fitView: () => setFitRequest((value) => value + 1),
    panMode,
    setPanMode,
    hideCards,
    setHideCards,
    hideBorders,
    setHideBorders,
    exportPreview,
    setExportPreview,
    prompt,
    setPrompt,
    updateTilePrompt,
    generationUnavailable,
    api,
    hint,
    setHint,
    busy,
    fineSession,
    startFineEdit,
    closeFineEdit,
    applyFineEdit,
    perform,
    report,
    newProject,
    importImages,
    openProject,
    uploadToLayer,
    selectTile,
    selectRegion,
    selectView,
    chooseRegionLayer,
    chooseTool,
    scopedRegions,
    otherViewCount,
    createRegions,
    deleteRegion,
    clearRegions,
    removeImage,
    setFeather,
    toggleIncluded,
    expand,
    confirmSurface,
    undo,
    redo,
    canUndo: historyView.past.length > 0,
    canRedo: historyView.future.length > 0,
    undoLabel: historyView.past.at(-1)?.label,
    redoLabel: historyView.future.at(-1)?.label,
    clearHistory: () => {
      invalidate();
      history.clearHistory();
      publish();
    },
    queueState,
    queue,
    cancelQueue,
    enqueue,
    startAutomatic,
    generateLayer,
    createReferences,
    exportArtifact,
  };
}
export type MapEditorController = ReturnType<typeof useMapEditorController>;
