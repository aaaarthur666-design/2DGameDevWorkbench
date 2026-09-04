'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from 'react';
import Link from 'next/link';
import {
  CircleHelp,
  Download,
  Eye,
  EyeOff,
  FileArchive,
  Hand,
  ImagePlus,
  Layers3,
  LoaderCircle,
  Lock,
  LockOpen,
  Maximize,
  MousePointer2,
  PenTool,
  Pencil,
  Plus,
  Settings,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { ImageFineEditor } from '@/components/map-stitcher/editors/image-fine-editor';
import { RegionDrawingOverlay } from '@/components/map-stitcher/region-drawing-overlay';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Toaster, toast } from '@/components/ui/toast';
import {
  CENTER_KEY,
  clamp,
  type Feather,
} from '@/features/map-stitcher/map-types';
import {
  DEFAULT_DISPLAY_VISIBILITY,
  DEFAULT_IMAGE_LOCKS,
  DEFAULT_LAYER_PROMPTS,
  DEFAULT_REGION_LOCKS,
  DEFAULT_REGION_VISIBILITY,
  MAP_DISPLAY_LAYERS,
  MAP_IMAGE_LAYERS,
  REGION_LAYER_META,
  REGION_LAYERS,
  isEditableMapLayer,
  isRegionAuthoringMapLayer,
  regionShapeId,
  type FrameRoninTile,
  type LayerPromptMap,
  type MapDisplayLayer,
  type MapImageLayer,
  type RegionLayer,
  type RegionMode,
  type RegionShape,
  type RegionTool,
} from '@/features/map-stitcher/frame-ronin-types';
import {
  createFrameRoninCenterTile,
  expandAroundFrameRoninTile,
  frameRoninBounds,
  isSameFrameRoninGeometry,
  tilePixelSize,
} from '@/features/map-stitcher/frame-ronin-geometry';
import {
  blobToAsset,
  canvasToBlob,
  dataUrlToBlob,
  downloadBlob,
  fileToAsset,
  loadImage,
  urlToBlob,
} from '@/features/map-stitcher/image-utils';
import {
  createGenerationTemplate,
  deriveObjectFromMattes,
  generateLocalLayerFill,
  renderFrameRoninTile,
  renderStitchedMap,
} from '@/features/map-stitcher/layer-engine';
import { exportEnginePackage } from '@/features/map-stitcher/engine-export';
import { exportFrameRoninPsd } from '@/features/map-stitcher/psd-export';
import {
  downloadPixelworkState,
  loadFrameRoninState,
  type FrameRoninEditorSnapshot,
} from '@/features/map-stitcher/state-package';
import { normalizeRegionShape } from '@/features/map-stitcher/region-engine';

const BASE_TILE_WIDTH = 360;
const MAX_REGION_HISTORY = 80;

type GeneratorMode = 'local' | 'external';
type FineSession = { tileKey: string; layer: MapImageLayer };

type BrowserMapTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown;
};

type AgentAwareDocument = Document & {
  modelContext?: {
    registerTool: (
      tool: BrowserMapTool,
      options?: { signal?: AbortSignal },
    ) => void | Promise<void>;
  };
};

type MapAgentAction = (input: Record<string, unknown>) => unknown;
type MapAgentActions = Record<
  'readSummary' | 'setView' | 'importImages' | 'generateLayer' | 'createRegions' | 'exportArtifact',
  MapAgentAction
>;

const LAYER_LABELS: Record<MapDisplayLayer, string> = {
  overall: '整体层',
  surface: '地表层',
  object: '物件层',
  mask: '蒙版层',
  black: '黑层',
  white: '白层',
};

function notify(title: string, description?: string, type: 'success' | 'info' | 'warning' | 'error' = 'info') {
  toast.add({ title, description, type, timeout: type === 'error' ? 7_000 : 4_000 });
}

function fileList(files: FileList | null) {
  return files ? Array.from(files) : [];
}

function recordInput(value: unknown, label = '输入'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}必须是对象。`);
  }
  return value as Record<string, unknown>;
}

function stringInput(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}必须是非空字符串。`);
  return value;
}

function sliderNumber(value: number | readonly number[], fallback: number) {
  return Array.isArray(value) ? (value[0] ?? fallback) : Number(value);
}

function directionClass(tile: FrameRoninTile) {
  const centerX = tile.x + tile.w / 2;
  const centerY = tile.y + tile.h / 2;
  if (Math.abs(centerX - 0.5) > Math.abs(centerY - 0.5)) return centerX < 0.5 ? 'tile-left' : 'tile-right';
  return centerY < 0.5 ? 'tile-top' : 'tile-bottom';
}

function featherPreviewStyle(tile: FrameRoninTile): CSSProperties {
  if (tile.key === CENTER_KEY || !Object.values(tile.feather).some(Boolean)) return {};
  const { top, right, bottom, left } = tile.feather;
  const vertical = `linear-gradient(to bottom, ${top ? `transparent 0%, black ${top}%` : 'black 0%'}, ${bottom ? `black ${100 - bottom}%, transparent 100%` : 'black 100%'})`;
  const horizontal = `linear-gradient(to right, ${left ? `transparent 0%, black ${left}%` : 'black 0%'}, ${right ? `black ${100 - right}%, transparent 100%` : 'black 100%'})`;
  return {
    maskImage: `${vertical}, ${horizontal}`,
    maskComposite: 'intersect',
    WebkitMaskImage: `${vertical}, ${horizontal}`,
    WebkitMaskComposite: 'source-in',
  };
}

function revokeFrameRoninTiles(tiles: FrameRoninTile[]) {
  for (const tile of tiles) {
    for (const layer of MAP_IMAGE_LAYERS) {
      const asset = tile.images[layer];
      if (asset) URL.revokeObjectURL(asset.url);
    }
  }
}

function isTypingTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

async function canvasDataUrl(canvas: HTMLCanvasElement) {
  const blob = await canvasToBlob(canvas);
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('无法编码生成模板'));
    reader.onerror = () => reject(reader.error ?? new Error('无法编码生成模板'));
    reader.readAsDataURL(blob);
  });
}

export function FrameRoninMapEditor() {
  const [tiles, setTiles] = useState<FrameRoninTile[]>([]);
  const [shapes, setShapes] = useState<RegionShape[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [activeMapLayer, setActiveMapLayer] = useState<MapDisplayLayer>('overall');
  const [activeRegionLayer, setActiveRegionLayer] = useState<RegionLayer>('collision');
  const [regionTool, setRegionTool] = useState<RegionTool>('select');
  const [regionEditing, setRegionEditing] = useState(false);
  const [displayVisibility, setDisplayVisibility] = useState({ ...DEFAULT_DISPLAY_VISIBILITY });
  const [regionVisibility, setRegionVisibility] = useState({ ...DEFAULT_REGION_VISIBILITY });
  const [imageLocks, setImageLocks] = useState({ ...DEFAULT_IMAGE_LOCKS });
  const [regionLocks, setRegionLocks] = useState({ ...DEFAULT_REGION_LOCKS });
  const [horizontalOverlap, setHorizontalOverlap] = useState(15);
  const [verticalOverlap, setVerticalOverlap] = useState(15);
  const [expandSplit, setExpandSplit] = useState<4 | 8 | 12>(4);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [panMode, setPanMode] = useState(false);
  const [spacePan, setSpacePan] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [hideCards, setHideCards] = useState(false);
  const [hidePreviewBorders, setHidePreviewBorders] = useState(false);
  const [fineSession, setFineSession] = useState<FineSession | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [generatorMode, setGeneratorMode] = useState<GeneratorMode>('local');
  const [layerPrompts, setLayerPrompts] = useState<LayerPromptMap>({ ...DEFAULT_LAYER_PROMPTS });
  const [processingKeys, setProcessingKeys] = useState<string[]>([]);
  const [processedLayerUrls, setProcessedLayerUrls] = useState<Record<string, string>>({});
  const [regionHint, setRegionHint] = useState('选择区域类型与绘制工具后，在已选卡片上绘制。');
  const [canUndoRegions, setCanUndoRegions] = useState(false);

  const workspaceRef = useRef<HTMLFormElement>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const layerInputRef = useRef<HTMLInputElement>(null);
  const stateInputRef = useRef<HTMLInputElement>(null);
  const tilesRef = useRef(tiles);
  const shapesRef = useRef(shapes);
  const undoShapesRef = useRef<RegionShape[][]>([]);
  const redoShapesRef = useRef<RegionShape[][]>([]);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const agentActionsRef = useRef<Partial<MapAgentActions>>({});
  const imageLocksRef = useRef(imageLocks);
  const generatorModeRef = useRef(generatorMode);

  const sourceTile = useMemo(() => tiles.find((tile) => tile.key === CENTER_KEY) ?? null, [tiles]);
  const sourceAsset = sourceTile?.images.overall;
  const selectedTile = useMemo(() => tiles.find((tile) => tile.key === selectedKey) ?? null, [selectedKey, tiles]);
  const fineTile = useMemo(() => fineSession ? tiles.find((tile) => tile.key === fineSession.tileKey) ?? null : null, [fineSession, tiles]);
  const baseTileHeight = BASE_TILE_WIDTH * (sourceAsset ? sourceAsset.height / sourceAsset.width : 1);
  const imageCount = useMemo(() => tiles.reduce((count, tile) => count + MAP_IMAGE_LAYERS.filter((layer) => tile.images[layer]).length, 0), [tiles]);
  const memoryMb = useMemo(() => tiles.reduce((bytes, tile) => bytes + MAP_IMAGE_LAYERS.reduce((sum, layer) => sum + (tile.images[layer]?.size ?? 0), 0), 0) / 1024 / 1024, [tiles]);
  const selectedRegionCount = useMemo(() => shapes.filter((shape) => shape.tileKey === selectedKey && shape.layer === activeRegionLayer).length, [activeRegionLayer, selectedKey, shapes]);

  useEffect(() => { tilesRef.current = tiles; }, [tiles]);
  useEffect(() => { shapesRef.current = shapes; }, [shapes]);
  useEffect(() => { imageLocksRef.current = imageLocks; }, [imageLocks]);
  useEffect(() => { generatorModeRef.current = generatorMode; }, [generatorMode]);
  useEffect(() => () => revokeFrameRoninTiles(tilesRef.current), []);

  const replaceTiles = useCallback((next: FrameRoninTile[]) => {
    const previous = tilesRef.current;
    tilesRef.current = next;
    setTiles(next);
    revokeFrameRoninTiles(previous);
  }, []);

  const updateTile = useCallback((key: string, update: (tile: FrameRoninTile) => FrameRoninTile) => {
    setTiles((current) => {
      const next = current.map((tile) => tile.key === key ? update(tile) : tile);
      tilesRef.current = next;
      return next;
    });
  }, []);

  const commitShapes = useCallback((next: RegionShape[]) => {
    undoShapesRef.current = [...undoShapesRef.current.slice(-(MAX_REGION_HISTORY - 1)), shapesRef.current];
    redoShapesRef.current = [];
    shapesRef.current = next;
    setShapes(next);
    setCanUndoRegions(true);
  }, []);

  const undoRegions = useCallback(() => {
    const previous = undoShapesRef.current.pop();
    if (!previous) return;
    redoShapesRef.current.push(shapesRef.current);
    shapesRef.current = previous;
    setShapes(previous);
    setSelectedShapeId(null);
    setCanUndoRegions(undoShapesRef.current.length > 0);
  }, []);

  const fitView = useCallback((targetTiles = tilesRef.current) => {
    const workspace = workspaceRef.current;
    if (!workspace || !targetTiles.length) {
      setPan({ x: 0, y: 0 });
      setZoom(1);
      return;
    }
    const bounds = frameRoninBounds(targetTiles);
    const width = Math.max(BASE_TILE_WIDTH, (bounds.maxX - bounds.minX) * BASE_TILE_WIDTH);
    const height = Math.max(baseTileHeight, (bounds.maxY - bounds.minY) * baseTileHeight);
    const nextZoom = clamp(Math.min((workspace.clientWidth - 390) / width, (workspace.clientHeight - 120) / height, 1), 0.05, 1);
    const centerX = ((bounds.minX + bounds.maxX) / 2 - 0.5) * BASE_TILE_WIDTH;
    const centerY = ((bounds.minY + bounds.maxY) / 2 - 0.5) * baseTileHeight;
    setZoom(nextZoom);
    setPan({ x: -centerX * nextZoom, y: -centerY * nextZoom });
  }, [baseTileHeight]);

  const addExpansion = useCallback((origin: FrameRoninTile) => {
    const candidates = expandAroundFrameRoninTile(origin, origin.key === CENTER_KEY ? expandSplit : 4, horizontalOverlap, verticalOverlap);
    const originDistance = Math.hypot(origin.x + origin.w / 2 - 0.5, origin.y + origin.h / 2 - 0.5);
    const additions = candidates.filter((candidate) => {
      if (tilesRef.current.some((tile) => isSameFrameRoninGeometry(tile, candidate))) return false;
      if (origin.key === CENTER_KEY) return true;
      return Math.hypot(candidate.x + candidate.w / 2 - 0.5, candidate.y + candidate.h / 2 - 0.5) > originDistance - 0.0001;
    });
    if (!additions.length) return notify('周围已经存在扩图卡片', '请选择外围卡片继续扩展。');
    const next = [...tilesRef.current, ...additions];
    tilesRef.current = next;
    setTiles(next);
    notify(`已添加 ${additions.length} 个扩图卡片`, undefined, 'success');
  }, [expandSplit, horizontalOverlap, verticalOverlap]);

  const importSourceFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    try {
      const assets = [];
      for (const file of files) assets.push(await fileToAsset(file));
      const center = createFrameRoninCenterTile(assets[0]);
      const initial = [center, ...expandAroundFrameRoninTile(center, expandSplit, horizontalOverlap, verticalOverlap)];
      for (let index = 1; index < assets.length && index < initial.length; index += 1) {
        initial[index] = { ...initial[index], images: { overall: assets[index] } };
      }
      for (let index = initial.length; index < assets.length; index += 1) URL.revokeObjectURL(assets[index].url);
      replaceTiles(initial);
      shapesRef.current = [];
      setShapes([]);
      undoShapesRef.current = [];
      redoShapesRef.current = [];
      setCanUndoRegions(false);
      setSelectedKey(CENTER_KEY);
      setActiveMapLayer('overall');
      setPan({ x: 0, y: 0 });
      window.setTimeout(() => fitView(initial), 30);
      notify('地图已导入', '已建立 FrameRonin 图层模型和首圈扩图卡片。', 'success');
    } catch (error) {
      notify('导入失败', error instanceof Error ? error.message : '无法读取图片', 'error');
    }
  }, [expandSplit, fitView, horizontalOverlap, replaceTiles, verticalOverlap]);

  const assignFilesToLayer = useCallback(async (files: File[]) => {
    if (!files.length) return;
    if (!tilesRef.current.length) return importSourceFiles(files);
    if (!isEditableMapLayer(activeMapLayer)) return notify('蒙版层是派生层', '请提供整体层和物件层，蒙版会自动生成。', 'warning');
    if (imageLocks[activeMapLayer]) return notify('当前图层已锁定', undefined, 'warning');
    try {
      const assets = [];
      for (const file of files) assets.push(await fileToAsset(file));
      const preferred = selectedKey ? tilesRef.current.find((tile) => tile.key === selectedKey) : undefined;
      const targets = [preferred, ...tilesRef.current.filter((tile) => tile.key !== preferred?.key && !tile.images[activeMapLayer])].filter(Boolean) as FrameRoninTile[];
      if (!targets.length) throw new Error('当前图层没有可放置图片的卡片');
      const next = [...tilesRef.current];
      for (let index = 0; index < assets.length && index < targets.length; index += 1) {
        const targetIndex = next.findIndex((tile) => tile.key === targets[index].key);
        const previous = next[targetIndex].images[activeMapLayer];
        if (previous) URL.revokeObjectURL(previous.url);
        next[targetIndex] = { ...next[targetIndex], images: { ...next[targetIndex].images, [activeMapLayer]: assets[index] }, hidden: false };
      }
      for (let index = targets.length; index < assets.length; index += 1) URL.revokeObjectURL(assets[index].url);
      tilesRef.current = next;
      setTiles(next);
      notify('图层图片已更新', `${LAYER_LABELS[activeMapLayer]} · ${Math.min(assets.length, targets.length)} 张`, 'success');
    } catch (error) {
      notify('上传失败', error instanceof Error ? error.message : '无法读取图片', 'error');
    }
  }, [activeMapLayer, imageLocks, importSourceFiles, selectedKey]);

  const replaceTileAsset = useCallback((tileKey: string, layer: MapImageLayer, asset: Awaited<ReturnType<typeof blobToAsset>>) => {
    const next = tilesRef.current.map((tile) => {
      if (tile.key !== tileKey) return tile;
      const previous = tile.images[layer];
      if (previous) URL.revokeObjectURL(previous.url);
      return { ...tile, images: { ...tile.images, [layer]: asset }, hidden: false };
    });
    tilesRef.current = next;
    setTiles(next);
  }, []);

  const generateLayerForTile = useCallback(async (tile: FrameRoninTile, layer: MapImageLayer) => {
    if (!sourceAsset) throw new Error('请先导入中心地图');
    if (layer === 'object') {
      if (!tile.images.black || !tile.images.white) throw new Error('物件层需要同一卡片的黑层和白层');
      const blob = await deriveObjectFromMattes(tile.images.black, tile.images.white);
      replaceTileAsset(tile.key, 'object', await blobToAsset(blob, `${tile.key.replace(',', '_')}_object.png`));
      return;
    }

    let blob: Blob;
    if (generatorMode === 'local') {
      if (layer === 'overall') {
        blob = await generateLocalLayerFill(tilesRef.current, tile, layer, sourceAsset.width, sourceAsset.height);
      } else {
        const overall = tile.images.overall;
        if (!overall) throw new Error(`本地${LAYER_LABELS[layer]}需要当前卡片先有整体层`);
        const canvas = document.createElement('canvas');
        canvas.width = overall.width;
        canvas.height = overall.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('浏览器无法创建图层画布');
        context.imageSmoothingEnabled = false;
        if (layer === 'black' || layer === 'white') {
          context.fillStyle = layer === 'black' ? '#000' : '#fff';
          context.fillRect(0, 0, canvas.width, canvas.height);
        }
        context.drawImage(await loadImage(overall.url), 0, 0, canvas.width, canvas.height);
        blob = await canvasToBlob(canvas);
      }
    } else {
      const template = layer === 'overall'
        ? await createGenerationTemplate(tilesRef.current, tile, 'overall', sourceAsset.width, sourceAsset.height)
        : await assetCanvas(tile.images.overall);
      const response = await fetch('/api/workbench/map-stitcher/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operation: 'generate-layer',
          image: await canvasDataUrl(template),
          prompt: layer === 'overall' ? DEFAULT_LAYER_PROMPTS.surface : layerPrompts[layer],
          tile: { key: tile.key, x: tile.x, y: tile.y, w: tile.w, h: tile.h },
          layer,
          mask_mode: layer === 'black' ? 'black' : 'white',
        }),
      });
      const payload = await response.json().catch(() => ({})) as { image?: string; error?: string };
      if (!response.ok || !payload.image) throw new Error(payload.error || `外部生成失败（HTTP ${response.status}）`);
      blob = payload.image.startsWith('data:') ? dataUrlToBlob(payload.image) : await urlToBlob(payload.image);
    }
    replaceTileAsset(tile.key, layer, await blobToAsset(blob, `${tile.key.replace(',', '_')}_${layer}.png`));
  }, [generatorMode, layerPrompts, replaceTileAsset, sourceAsset]);

  const generateLayerForTileRef = useRef(generateLayerForTile);
  useEffect(() => { generateLayerForTileRef.current = generateLayerForTile; }, [generateLayerForTile]);

  const runGeneration = useCallback(async (tile: FrameRoninTile, layer: MapImageLayer) => {
    const operationKey = `${tile.key}:${layer}`;
    setProcessingKeys((current) => [...current, operationKey]);
    try {
      await generateLayerForTile(tile, layer);
      notify(`${LAYER_LABELS[layer]}已生成`, tile.key, 'success');
    } catch (error) {
      notify('生成失败', error instanceof Error ? error.message : '未知错误', 'error');
    } finally {
      setProcessingKeys((current) => current.filter((key) => key !== operationKey));
    }
  }, [generateLayerForTile]);

  const runLayerPipeline = useCallback(async () => {
    if (!selectedTile?.images.overall) return notify('当前卡片缺少整体层', undefined, 'warning');
    const operationKey = `${selectedTile.key}:pipeline`;
    setProcessingKeys((current) => [...current, operationKey]);
    try {
      for (const layer of ['surface', 'black', 'white', 'object'] as const) {
        const currentTile = tilesRef.current.find((tile) => tile.key === selectedTile.key);
        if (!currentTile) throw new Error('目标卡片已不存在');
        await generateLayerForTile(currentTile, layer);
      }
      notify('图层流水线已完成', 'surface → black → white → object；Mask 将自动派生。', 'success');
    } catch (error) {
      notify('图层流水线中断', error instanceof Error ? error.message : '未知错误', 'error');
    } finally {
      setProcessingKeys((current) => current.filter((key) => key !== operationKey));
    }
  }, [generateLayerForTile, selectedTile]);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    if (!sourceAsset || (activeMapLayer !== 'object' && activeMapLayer !== 'mask')) {
      return;
    }
    void (async () => {
      const next: Record<string, string> = {};
      for (const tile of tiles) {
        if (activeMapLayer === 'object' && !tile.images.object) continue;
        if (activeMapLayer === 'mask' && (!tile.images.overall || !tile.images.object)) continue;
        const canvas = await renderFrameRoninTile(tile, activeMapLayer, shapes, sourceAsset.width, sourceAsset.height);
        const url = URL.createObjectURL(await canvasToBlob(canvas));
        urls.push(url);
        next[tile.key] = url;
      }
      if (cancelled) urls.forEach((url) => URL.revokeObjectURL(url));
      else setProcessedLayerUrls(next);
    })().catch((error) => !cancelled && notify('图层预览失败', error instanceof Error ? error.message : '未知错误', 'error'));
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [activeMapLayer, shapes, sourceAsset, tiles]);

  const startRegionEditing = useCallback(() => {
    if (!selectedTile) return notify('请先选择一张地图卡片', undefined, 'warning');
    if (!isRegionAuthoringMapLayer(activeMapLayer)) return notify('当前显示层不用于区域标注', '请选择整体层、地表层或物件层。', 'warning');
    if (regionLocks[activeRegionLayer]) return notify('当前区域层已锁定', undefined, 'warning');
    setRegionVisibility((current) => ({ ...current, [activeRegionLayer]: true }));
    setRegionEditing(true);
    setPanMode(false);
    if (regionTool === 'select') setRegionTool('rectangle');
    setRegionHint('矩形点两次；多边形按 C / Enter 闭合；自由绘制按住拖动。Ctrl+Z 撤销。');
  }, [activeMapLayer, activeRegionLayer, regionLocks, regionTool, selectedTile]);

  const selectMapLayer = useCallback((layer: MapDisplayLayer) => {
    setActiveMapLayer(layer);
    if (!isRegionAuthoringMapLayer(layer)) setRegionEditing(false);
    setSelectedShapeId(null);
  }, []);

  const createRegion = useCallback((shape: Omit<RegionShape, 'id'>) => {
    const next = [...shapesRef.current, { ...shape, id: regionShapeId(shape.layer) }];
    commitShapes(next);
    setRegionHint(`${REGION_LAYER_META[shape.layer].label}已创建。`);
  }, [commitShapes]);

  const deleteRegion = useCallback((id: string) => {
    const next = shapesRef.current.filter((shape) => shape.id !== id);
    if (next.length === shapesRef.current.length) return;
    commitShapes(next);
    if (selectedShapeId === id) setSelectedShapeId(null);
  }, [commitShapes, selectedShapeId]);

  const clearCurrentRegions = useCallback(() => {
    if (!selectedKey) return;
    const next = shapesRef.current.filter((shape) => shape.tileKey !== selectedKey || shape.layer !== activeRegionLayer);
    if (next.length === shapesRef.current.length) return;
    commitShapes(next);
    setSelectedShapeId(null);
    notify('当前区域层已清空', `${selectedKey} · ${REGION_LAYER_META[activeRegionLayer].label}`, 'success');
  }, [activeRegionLayer, commitShapes, selectedKey]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.code === 'Space') {
        event.preventDefault();
        setSpacePan(true);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && regionEditing) {
        event.preventDefault();
        undoRegions();
      }
      if (event.key === '0') fitView();
      if (event.key.toLowerCase() === 'h') setHideCards((value) => !value);
      if (event.key === 'Escape') {
        setSelectedShapeId(null);
        if (regionEditing) setRegionEditing(false);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => { if (event.code === 'Space') setSpacePan(false); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [fitView, regionEditing, undoRegions]);

  const beginPan = (event: ReactPointerEvent<HTMLFormElement>) => {
    const shouldPan = panMode || spacePan || event.button === 1 || event.button === 2;
    if (!shouldPan || fineSession) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    setIsPanning(true);
  };

  const movePan = (event: ReactPointerEvent<HTMLFormElement>) => {
    if (!dragRef.current) return;
    setPan({
      x: dragRef.current.panX + event.clientX - dragRef.current.x,
      y: dragRef.current.panY + event.clientY - dragRef.current.y,
    });
  };

  const endPan = (event: ReactPointerEvent<HTMLFormElement>) => {
    if (!dragRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setIsPanning(false);
  };

  const zoomWorkspace = (event: WheelEvent<HTMLFormElement>) => {
    if (fineSession) return;
    event.preventDefault();
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const rect = workspace.getBoundingClientRect();
    const mouseX = event.clientX - rect.left - rect.width / 2;
    const mouseY = event.clientY - rect.top - rect.height / 2;
    const nextZoom = clamp(zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), 0.05, 8);
    const worldX = (mouseX - pan.x) / zoom;
    const worldY = (mouseY - pan.y) / zoom;
    setPan({ x: mouseX - worldX * nextZoom, y: mouseY - worldY * nextZoom });
    setZoom(nextZoom);
  };

  const handleDrop = (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault();
    const files = fileList(event.dataTransfer.files).filter((file) => file.type.startsWith('image/'));
    if (files.length) void (tilesRef.current.length ? assignFilesToLayer(files) : importSourceFiles(files));
  };

  const removeSelectedLayer = useCallback(() => {
    if (!selectedTile || !isEditableMapLayer(activeMapLayer)) return;
    if (selectedTile.key === CENTER_KEY && activeMapLayer === 'overall') return notify('中心整体层不能单独删除', '可通过“导入地图”替换整个项目。', 'warning');
    updateTile(selectedTile.key, (tile) => {
      const previous = tile.images[activeMapLayer];
      if (previous) URL.revokeObjectURL(previous.url);
      const images = { ...tile.images };
      delete images[activeMapLayer];
      return { ...tile, images };
    });
    notify('当前图层内容已删除', undefined, 'success');
  }, [activeMapLayer, selectedTile, updateTile]);

  const setFeather = useCallback((side: keyof Feather, value: number) => {
    if (!selectedTile || selectedTile.key === CENTER_KEY) return;
    updateTile(selectedTile.key, (tile) => ({
      ...tile,
      feather: { ...tile.feather, [side]: clamp(Math.round(value / 5) * 5, 0, 50) },
    }));
  }, [selectedTile, updateTile]);

  const applyFineEdit = useCallback(async (blob: Blob | null) => {
    if (!fineSession) return;
    if (!blob) {
      updateTile(fineSession.tileKey, (tile) => {
        const previous = tile.images[fineSession.layer];
        if (previous) URL.revokeObjectURL(previous.url);
        const images = { ...tile.images };
        delete images[fineSession.layer];
        return { ...tile, images };
      });
    } else {
      replaceTileAsset(fineSession.tileKey, fineSession.layer, await blobToAsset(blob, `${fineSession.tileKey.replace(',', '_')}_${fineSession.layer}_edited.png`));
    }
    setFineSession(null);
    notify('像素精修已保存', undefined, 'success');
  }, [fineSession, replaceTileAsset, updateTile]);

  const snapshot = useCallback((): FrameRoninEditorSnapshot => ({
    tiles: tilesRef.current,
    shapes: shapesRef.current,
    selectedKey,
    horizontalOverlapPercent: horizontalOverlap,
    verticalOverlapPercent: verticalOverlap,
    expandSplit,
    pan,
    zoom,
    activeMapLayer,
    layerPrompts,
    hidePreviewBorders,
    hidePreviewCards: hideCards,
    displayVisibility,
    regionVisibility,
    imageLocks,
    regionLocks,
  }), [activeMapLayer, displayVisibility, expandSplit, hideCards, hidePreviewBorders, horizontalOverlap, imageLocks, layerPrompts, pan, regionLocks, regionVisibility, selectedKey, verticalOverlap, zoom]);

  const saveState = useCallback(async () => {
    try {
      const result = await downloadPixelworkState(snapshot());
      notify('Pixelwork v2 状态已保存', result.fileName, 'success');
    } catch (error) {
      notify('保存状态失败', error instanceof Error ? error.message : '未知错误', 'error');
    }
  }, [snapshot]);

  const restoreState = useCallback(async (file: File) => {
    try {
      const loaded = await loadFrameRoninState(file);
      replaceTiles(loaded.tiles);
      shapesRef.current = loaded.shapes;
      setShapes(loaded.shapes);
      undoShapesRef.current = [];
      redoShapesRef.current = [];
      setCanUndoRegions(false);
      setSelectedKey(loaded.selectedKey && loaded.tiles.some((tile) => tile.key === loaded.selectedKey) ? loaded.selectedKey : CENTER_KEY);
      setActiveMapLayer(loaded.activeMapLayer);
      setHorizontalOverlap(loaded.horizontalOverlapPercent);
      setVerticalOverlap(loaded.verticalOverlapPercent);
      setExpandSplit(loaded.expandSplit);
      setPan(loaded.pan);
      setZoom(loaded.zoom);
      setLayerPrompts(loaded.layerPrompts);
      setHideCards(loaded.hidePreviewCards);
      setHidePreviewBorders(loaded.hidePreviewBorders);
      setDisplayVisibility(loaded.displayVisibility);
      setRegionVisibility(loaded.regionVisibility);
      setImageLocks(loaded.imageLocks);
      setRegionLocks(loaded.regionLocks);
      notify('地图状态已加载', loaded.warnings.join(' ') || 'Pixelwork v2 状态结构已恢复。', loaded.warnings.length ? 'warning' : 'success');
    } catch (error) {
      notify('加载状态失败', error instanceof Error ? error.message : '未知错误', 'error');
    }
  }, [replaceTiles]);

  const exportCurrentPng = useCallback(async (layer: MapDisplayLayer | 'top' = activeMapLayer) => {
    if (!sourceAsset) return;
    try {
      const rendered = await renderStitchedMap(tilesRef.current, layer, shapesRef.current, sourceAsset.width, sourceAsset.height);
      const fileName = `${sourceAsset.name.replace(/\.[^.]+$/, '')}_${layer}.png`;
      downloadBlob(await canvasToBlob(rendered.canvas), fileName);
      notify('PNG 已导出', `${rendered.width} × ${rendered.height} · ${fileName}`, 'success');
    } catch (error) {
      notify('导出失败', error instanceof Error ? error.message : '未知错误', 'error');
    }
  }, [activeMapLayer, sourceAsset]);

  const exportEngine = useCallback(async (target: 'godot' | 'unity') => {
    if (!sourceAsset) return;
    try {
      const result = await exportEnginePackage(target, tilesRef.current, shapesRef.current, sourceAsset.width, sourceAsset.height, sourceAsset.name);
      notify(`${target === 'godot' ? 'Godot' : 'Unity'} 包已导出`, `${result.layers.length} 个图层 · ${result.manifest.regions.length} 个区域`, 'success');
    } catch (error) {
      notify('引擎包导出失败', error instanceof Error ? error.message : '未知错误', 'error');
    }
  }, [sourceAsset]);

  const exportPsd = useCallback(async () => {
    if (!sourceAsset) return;
    try {
      const result = await exportFrameRoninPsd(tilesRef.current, shapesRef.current, sourceAsset.width, sourceAsset.height, sourceAsset.name);
      notify('分层 PSD 已导出', `${result.layers.length} 个图层 · ${result.fileName}`, 'success');
    } catch (error) {
      notify('PSD 导出失败', error instanceof Error ? error.message : '未知错误', 'error');
    }
  }, [sourceAsset]);

  const importImagesForAgent = useCallback(async (input: Record<string, unknown>) => {
    if (!Array.isArray(input.images) || input.images.length === 0 || input.images.length > 64) {
      throw new Error('images 必须包含 1–64 个 data:image URL 或 HTTP(S) 图片 URL。');
    }
    const names = Array.isArray(input.names) ? input.names : [];
    const files: File[] = [];
    for (const [index, value] of input.images.entries()) {
      const source = stringInput(value, `images[${index}]`);
      let blob: Blob;
      if (source.startsWith('data:image/')) blob = dataUrlToBlob(source);
      else if (/^https?:\/\//i.test(source)) blob = await urlToBlob(source);
      else throw new Error(`images[${index}] 只支持 data:image 或 HTTP(S) URL。`);
      const preferredName = typeof names[index] === 'string' && names[index]
        ? names[index]
        : `agent_tile_${String(index).padStart(3, '0')}.png`;
      files.push(new File([blob], preferredName, { type: blob.type || 'image/png' }));
    }
    await importSourceFiles(files);
    return {
      imported: files.length,
      tileCount: tilesRef.current.length,
      selectedKey: CENTER_KEY,
    };
  }, [importSourceFiles]);

  const generateLayerForAgent = useCallback(async (input: Record<string, unknown>) => {
    const tileKey = stringInput(input.tileKey, 'tileKey');
    const layer = stringInput(input.layer, 'layer') as MapImageLayer;
    if (!MAP_IMAGE_LAYERS.includes(layer)) throw new Error('layer 不是可编辑图片图层。');
    if (imageLocksRef.current[layer]) throw new Error(`图片图层 ${layer} 已锁定。`);
    const tile = tilesRef.current.find((candidate) => candidate.key === tileKey);
    if (!tile) throw new Error(`未找到地图卡片：${tileKey}`);
    const operationKey = `${tile.key}:${layer}:agent`;
    setSelectedKey(tile.key);
    setActiveMapLayer(layer);
    setProcessingKeys((current) => [...current, operationKey]);
    try {
      await generateLayerForTileRef.current(tile, layer);
      return {
        tileKey,
        layer,
        generatorMode: generatorModeRef.current,
        generated: Boolean(tilesRef.current.find((candidate) => candidate.key === tileKey)?.images[layer]),
      };
    } finally {
      setProcessingKeys((current) => current.filter((key) => key !== operationKey));
    }
  }, []);

  const createRegionsForAgent = useCallback((input: Record<string, unknown>) => {
    if (!sourceAsset) throw new Error('请先导入中心地图。');
    if (!Array.isArray(input.regions) || input.regions.length === 0 || input.regions.length > 500) {
      throw new Error('regions 必须包含 1–500 个区域对象。');
    }
    const additions: RegionShape[] = [];
    for (const [index, raw] of input.regions.entries()) {
      const region = recordInput(raw, `regions[${index}]`);
      const tileKey = stringInput(region.tileKey, `regions[${index}].tileKey`);
      const tile = tilesRef.current.find((candidate) => candidate.key === tileKey);
      if (!tile) throw new Error(`regions[${index}] 引用了不存在的卡片 ${tileKey}。`);
      const layer = stringInput(region.layer, `regions[${index}].layer`) as RegionLayer;
      if (!REGION_LAYERS.includes(layer)) throw new Error(`regions[${index}].layer 无效。`);
      if (regionLocks[layer]) throw new Error(`区域图层 ${layer} 已锁定。`);
      const mode = stringInput(region.mode, `regions[${index}].mode`) as RegionMode;
      if (!['rectangle', 'polygon', 'free'].includes(mode)) throw new Error(`regions[${index}].mode 无效。`);
      const mapLayer = (typeof region.mapLayer === 'string' ? region.mapLayer : activeMapLayer) as MapDisplayLayer;
      if (!isRegionAuthoringMapLayer(mapLayer)) throw new Error(`regions[${index}].mapLayer 不支持区域标注。`);
      if (!Array.isArray(region.points)) throw new Error(`regions[${index}].points 必须是数组。`);
      const points = region.points.map((rawPoint, pointIndex) => {
        const point = recordInput(rawPoint, `regions[${index}].points[${pointIndex}]`);
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
          throw new Error(`regions[${index}].points[${pointIndex}] 坐标无效。`);
        }
        return { x: Number(point.x), y: Number(point.y) };
      });
      const size = tilePixelSize(tile, sourceAsset.width, sourceAsset.height);
      const normalized = normalizeRegionShape({
        id: typeof region.id === 'string' && region.id ? region.id : regionShapeId(layer),
        tileKey,
        mapLayer,
        layer,
        mode,
        points,
      }, size.width, size.height);
      if (!normalized) throw new Error(`regions[${index}] 的几何形状无效或面积为零。`);
      additions.push(normalized);
    }
    commitShapes([...shapesRef.current, ...additions]);
    setSelectedKey(additions.at(-1)?.tileKey ?? selectedKey);
    setSelectedShapeId(additions.at(-1)?.id ?? null);
    setActiveRegionLayer(additions.at(-1)?.layer ?? activeRegionLayer);
    return { created: additions.length, ids: additions.map((shape) => shape.id) };
  }, [activeMapLayer, activeRegionLayer, commitShapes, regionLocks, selectedKey, sourceAsset]);

  const exportForAgent = useCallback(async (input: Record<string, unknown>) => {
    if (!sourceAsset) throw new Error('请先导入中心地图。');
    const format = stringInput(input.format, 'format');
    if (format === 'state') {
      const result = await downloadPixelworkState(snapshot());
      return { format, fileName: result.fileName, tileCount: tilesRef.current.length, regionCount: shapesRef.current.length };
    }
    if (format === 'psd') {
      const result = await exportFrameRoninPsd(tilesRef.current, shapesRef.current, sourceAsset.width, sourceAsset.height, sourceAsset.name);
      return { format, fileName: result.fileName, layerCount: result.layers.length };
    }
    if (format === 'godot' || format === 'unity') {
      const result = await exportEnginePackage(format, tilesRef.current, shapesRef.current, sourceAsset.width, sourceAsset.height, sourceAsset.name);
      return { format, layerCount: result.layers.length, regionCount: result.manifest.regions.length };
    }
    if (format === 'png' || format === 'top-png') {
      const requestedLayer = format === 'top-png'
        ? 'top'
        : (typeof input.layer === 'string' && MAP_DISPLAY_LAYERS.includes(input.layer as MapDisplayLayer)
            ? input.layer as MapDisplayLayer
            : activeMapLayer);
      const rendered = await renderStitchedMap(tilesRef.current, requestedLayer, shapesRef.current, sourceAsset.width, sourceAsset.height);
      const fileName = `${sourceAsset.name.replace(/\.[^.]+$/, '')}_${requestedLayer}.png`;
      downloadBlob(await canvasToBlob(rendered.canvas), fileName);
      return { format, layer: requestedLayer, fileName, width: rendered.width, height: rendered.height };
    }
    throw new Error('format 必须是 png、top-png、state、psd、godot 或 unity。');
  }, [activeMapLayer, snapshot, sourceAsset]);

  useEffect(() => {
    agentActionsRef.current = {
      readSummary: () => ({
        format: 'pixelwork-v2',
        tileCount: tilesRef.current.length,
        imageCount: tilesRef.current.reduce(
          (count, tile) => count + MAP_IMAGE_LAYERS.filter((layer) => tile.images[layer]).length,
          0,
        ),
        regionCount: shapesRef.current.length,
        selectedKey,
        activeMapLayer,
        activeRegionLayer,
        generatorMode,
        zoom,
        pan,
      }),
      setView: (input) => {
        if (input.fit === true) fitView();
        if (typeof input.selectedKey === 'string') {
          if (!tilesRef.current.some((tile) => tile.key === input.selectedKey)) throw new Error('selectedKey 不存在。');
          setSelectedKey(input.selectedKey);
        }
        if (typeof input.mapLayer === 'string') {
          if (!MAP_DISPLAY_LAYERS.includes(input.mapLayer as MapDisplayLayer)) throw new Error('mapLayer 无效。');
          selectMapLayer(input.mapLayer as MapDisplayLayer);
        }
        if (typeof input.regionLayer === 'string') {
          if (!REGION_LAYERS.includes(input.regionLayer as RegionLayer)) throw new Error('regionLayer 无效。');
          setActiveRegionLayer(input.regionLayer as RegionLayer);
        }
        if (typeof input.zoom === 'number' && Number.isFinite(input.zoom)) setZoom(clamp(input.zoom, 0.05, 8));
        if (Number.isFinite(input.panX) || Number.isFinite(input.panY)) {
          setPan((current) => ({
            x: Number.isFinite(input.panX) ? Number(input.panX) : current.x,
            y: Number.isFinite(input.panY) ? Number(input.panY) : current.y,
          }));
        }
        return { updated: true };
      },
      importImages: importImagesForAgent,
      generateLayer: generateLayerForAgent,
      createRegions: createRegionsForAgent,
      exportArtifact: exportForAgent,
    };
  }, [activeMapLayer, activeRegionLayer, createRegionsForAgent, exportForAgent, fitView, generateLayerForAgent, generatorMode, importImagesForAgent, pan, selectMapLayer, selectedKey, zoom]);

  useEffect(() => {
    const context = (document as AgentAwareDocument).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const options = { signal: lifecycle.signal };
    const call = (name: keyof MapAgentActions, input: unknown) => {
      const action = agentActionsRef.current[name];
      if (!action) throw new Error('地图编辑器工具尚未就绪。');
      return action(recordInput(input));
    };
    const tools: BrowserMapTool[] = [
      {
        name: 'map_stitcher_read_summary',
        title: '读取地图编辑摘要',
        description: '读取当前地图卡片、图片图层、区域和视图状态，不修改页面。',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: (input) => call('readSummary', input),
      },
      {
        name: 'map_stitcher_set_view',
        title: '调整地图编辑视图',
        description: '选择卡片、图片层或区域层，并可调整缩放、平移或适配画布。',
        inputSchema: {
          type: 'object',
          properties: {
            selectedKey: { type: 'string' },
            mapLayer: { type: 'string', enum: MAP_DISPLAY_LAYERS },
            regionLayer: { type: 'string', enum: REGION_LAYERS },
            zoom: { type: 'number', minimum: 0.05, maximum: 8 },
            panX: { type: 'number' },
            panY: { type: 'number' },
            fit: { type: 'boolean' },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (input) => call('setView', input),
      },
      {
        name: 'map_stitcher_import_images',
        title: '导入地图图片',
        description: '从 data:image 或 HTTP(S) URL 批量导入图片，并建立与可见“导入地图”操作相同的 FrameRonin 卡片状态。',
        inputSchema: {
          type: 'object',
          properties: {
            images: { type: 'array', minItems: 1, maxItems: 64, items: { type: 'string' } },
            names: { type: 'array', items: { type: 'string' } },
          },
          required: ['images'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: (input) => call('importImages', input),
      },
      {
        name: 'map_stitcher_generate_layer',
        title: '生成地图图片层',
        description: '对指定卡片生成 overall、surface、black、white 或 object 层，使用页面当前选择的本地或外部生成方式。',
        inputSchema: {
          type: 'object',
          properties: {
            tileKey: { type: 'string' },
            layer: { type: 'string', enum: MAP_IMAGE_LAYERS },
          },
          required: ['tileKey', 'layer'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
        execute: (input) => call('generateLayer', input),
      },
      {
        name: 'map_stitcher_create_regions',
        title: '批量创建地图区域',
        description: '以卡片本地像素坐标批量创建遮挡、碰撞、调整或顶层区域，并立即显示在编辑器中。',
        inputSchema: {
          type: 'object',
          properties: {
            regions: {
              type: 'array',
              minItems: 1,
              maxItems: 500,
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  tileKey: { type: 'string' },
                  mapLayer: { type: 'string', enum: ['overall', 'surface', 'object'] },
                  layer: { type: 'string', enum: REGION_LAYERS },
                  mode: { type: 'string', enum: ['rectangle', 'polygon', 'free'] },
                  points: {
                    type: 'array',
                    minItems: 2,
                    items: {
                      type: 'object',
                      properties: { x: { type: 'number' }, y: { type: 'number' } },
                      required: ['x', 'y'],
                      additionalProperties: false,
                    },
                  },
                },
                required: ['tileKey', 'layer', 'mode', 'points'],
                additionalProperties: false,
              },
            },
          },
          required: ['regions'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (input) => call('createRegions', input),
      },
      {
        name: 'map_stitcher_export',
        title: '导出地图产物',
        description: '完成 PNG、顶层 PNG、Pixelwork 状态、PSD、Godot 或 Unity 导出，并触发与页面按钮相同的下载。',
        inputSchema: {
          type: 'object',
          properties: {
            format: { type: 'string', enum: ['png', 'top-png', 'state', 'psd', 'godot', 'unity'] },
            layer: { type: 'string', enum: MAP_DISPLAY_LAYERS },
          },
          required: ['format'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (input) => call('exportArtifact', input),
      },
    ];
    for (const tool of tools) {
      void Promise.resolve(context.registerTool(tool, options)).catch(() => undefined);
    }
    return () => lifecycle.abort();
  }, []);

  const activeAsset = selectedTile && isEditableMapLayer(activeMapLayer) ? selectedTile.images[activeMapLayer] : null;
  const fineAsset = fineSession && fineTile ? fineTile.images[fineSession.layer] : null;
  const fineSize = fineTile && sourceAsset ? tilePixelSize(fineTile, sourceAsset.width, sourceAsset.height) : null;
  const visibleShapes = shapes.filter((shape) => regionVisibility[shape.layer]);

  return (
    <Toaster>
      <main className="map-stitcher-surface editor-shell frame-ronin-editor">
        <header className="topbar frame-ronin-topbar">
          <div className="title-cluster">
            <div><h1>地图拼接 · FrameRonin 模式</h1><p>分离图片图层、矢量区域与像素精修 · Pixelwork v2</p></div>
          </div>
          <div className="top-controls">
            <label className="compact-number"><span>横向重叠</span><input type="number" min={0} max={50} value={horizontalOverlap} onChange={(event) => setHorizontalOverlap(clamp(Number(event.target.value), 0, 50))} />%</label>
            <label className="compact-number"><span>纵向重叠</span><input type="number" min={0} max={50} value={verticalOverlap} onChange={(event) => setVerticalOverlap(clamp(Number(event.target.value), 0, 50))} />%</label>
            <label className="compact-select"><span>中心扩展</span><select value={expandSplit} onChange={(event) => setExpandSplit(Number(event.target.value) as 4 | 8 | 12)}><option value={4}>4 块</option><option value={8}>8 块</option><option value={12}>12 块</option></select></label>
            <Button variant="outline" className="toolbar-action" onClick={() => sourceInputRef.current?.click()}><Upload /> 导入地图</Button>
            <Button variant="outline" className="toolbar-action" disabled={!tiles.length} onClick={() => void exportCurrentPng()}><Download /> 当前 PNG</Button>
            <Button variant="outline" className="toolbar-action" disabled={!tiles.length} onClick={() => void saveState()}><FileArchive /> 保存状态</Button>
            <Link className="legacy-editor-link" href="/tools/map-stitcher-legacy">旧版</Link>
          </div>
        </header>

        {/* The form is the pan/zoom canvas surface and intentionally owns pointer capture. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <form
          ref={workspaceRef}
          className={`workspace ${panMode || spacePan ? 'pan-mode' : ''} ${isPanning ? 'is-panning' : ''}`}
          role="application"
          aria-label="FrameRonin 地图画布"
          onSubmit={(event) => event.preventDefault()}
          onPointerDown={beginPan}
          onPointerMove={movePan}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onWheel={zoomWorkspace}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="canvas-grain" aria-hidden="true" />

          {fineSession && fineTile && fineSize ? (
            <ImageFineEditor
              width={fineAsset?.width ?? fineSize.width}
              height={fineAsset?.height ?? fineSize.height}
              imageUrl={fineAsset?.url}
              tileKey={fineTile.key}
              layerLabel={LAYER_LABELS[fineSession.layer]}
              onCancel={() => setFineSession(null)}
              onApply={applyFineEdit}
            />
          ) : tiles.length > 0 && (
            <div className="stage" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
              {tiles.map((tile) => {
                const activeImage = activeMapLayer === 'mask' || activeMapLayer === 'object'
                  ? processedLayerUrls[tile.key] ?? (activeMapLayer === 'object' ? tile.images.object?.url : undefined)
                  : tile.images[activeMapLayer]?.url;
                const selected = tile.key === selectedKey;
                const processing = processingKeys.some((key) => key.startsWith(`${tile.key}:`));
                const tileSize = sourceAsset ? tilePixelSize(tile, sourceAsset.width, sourceAsset.height) : { width: 1, height: 1 };
                return (
                  <button
                    type="button"
                    key={tile.key}
                    className={`map-tile frame-tile ${directionClass(tile)} ${selected ? 'selected' : ''} ${hidePreviewBorders ? 'borderless' : ''} ${tile.hidden ? 'preview-hidden' : ''}`}
                    style={{
                      left: (tile.x - 0.5) * BASE_TILE_WIDTH,
                      top: (tile.y - 0.5) * baseTileHeight,
                      width: tile.w * BASE_TILE_WIDTH,
                      height: tile.h * baseTileHeight,
                    }}
                    onClick={() => {
                      setSelectedKey(tile.key);
                      setSelectedShapeId(null);
                    }}
                  >
                    {!tile.hidden && displayVisibility[activeMapLayer] && activeImage && (
                      // Blob URLs contain local editor data and intentionally bypass image optimization.
                      // eslint-disable-next-line next/no-img-element
                      <img className="tile-layer-active" src={activeImage} alt="" draggable={false} style={featherPreviewStyle(tile)} />
                    )}
                    {!tile.hidden && (
                      <RegionDrawingOverlay
                        key={`${tile.key}:${activeMapLayer}:${activeRegionLayer}:${regionTool}`}
                        tileKey={tile.key}
                        width={tileSize.width}
                        height={tileSize.height}
                        shapes={visibleShapes}
                        activeMapLayer={activeMapLayer}
                        activeRegionLayer={activeRegionLayer}
                        tool={regionTool}
                        interactive={regionEditing && selected && !regionLocks[activeRegionLayer]}
                        selectedShapeId={selectedShapeId}
                        onSelectShape={setSelectedShapeId}
                        onCreate={createRegion}
                        onDelete={deleteRegion}
                        onHint={setRegionHint}
                      />
                    )}
                    {processing ? (
                      <span className="tile-empty-copy"><LoaderCircle className="spin" /><strong>正在处理图层</strong><small>{tile.key}</small></span>
                    ) : !activeImage && (
                      <span className="tile-empty-copy"><ImagePlus /><strong>{LAYER_LABELS[activeMapLayer]}为空</strong><small>选中后上传或生成</small></span>
                    )}
                    {!hideCards && !regionEditing && activeImage && <span className="tile-status"><strong>{tile.key === CENTER_KEY ? '中心地图' : LAYER_LABELS[activeMapLayer]}</strong><small>{tile.key}</small></span>}
                  </button>
                );
              })}
            </div>
          )}

          {!tiles.length && (
            <button type="button" className="upload-empty" onClick={() => sourceInputRef.current?.click()}>
              <Upload className="upload-icon" />
              <strong>导入地图图片</strong>
              <span className="primary-upload"><Upload /> 选择 PNG / JPG / WebP</span>
              <small>第一张作为中心整体层，其余图片依次放入首圈扩图卡片。</small>
            </button>
          )}

          <div className="floating-tools" aria-label="视图工具">
            <Button variant={panMode ? 'default' : 'outline'} size="icon-lg" aria-label="平移模式" onClick={() => setPanMode((value) => !value)}><Hand /></Button>
            <Button variant="outline" size="icon-lg" aria-label="适配画布" disabled={!tiles.length} onClick={() => fitView()}><Maximize /></Button>
            <Button variant="outline" size="icon-lg" aria-label="帮助" onClick={() => setHelpOpen(true)}><CircleHelp /></Button>
          </div>
          <div className="zoom-chip"><Button variant="ghost" size="icon-xs" onClick={() => setZoom((value) => clamp(value / 1.15, 0.05, 8))}>−</Button><button type="button" onClick={() => fitView()}>{Math.round(zoom * 100)}%</button><Button variant="ghost" size="icon-xs" onClick={() => setZoom((value) => clamp(value * 1.15, 0.05, 8))}>+</Button></div>
          <div className="memory-card"><span>图片</span><strong>{imageCount} 张</strong><span>资源</span><strong>{memoryMb < 0.01 ? '0' : memoryMb.toFixed(1)} MB</strong><span>区域</span><strong>{shapes.length} 个</strong></div>

          <aside className="side-panel frame-ronin-panel" aria-label="地图图层与区域">
            <section className="layer-panel">
              <span className="panel-label">图片图层 · 每次只编辑一层</span>
              <button type="button" className={`layer-overall ${activeMapLayer === 'overall' ? 'active' : ''}`} onClick={() => selectMapLayer('overall')}><Layers3 /> 整体层</button>
              <div className="layer-stack">
                {MAP_DISPLAY_LAYERS.filter((layer) => layer !== 'overall').map((layer) => (
                  <div className={`layer-stack-row ${activeMapLayer === layer ? 'active' : ''}`} key={layer}>
                    <button type="button" onClick={() => selectMapLayer(layer)}>{LAYER_LABELS[layer]}{layer === 'mask' ? ' · 派生' : ''}</button>
                    <button type="button" aria-label={`${LAYER_LABELS[layer]}显隐`} onClick={() => setDisplayVisibility((current) => ({ ...current, [layer]: !current[layer] }))}>{displayVisibility[layer] ? <Eye /> : <EyeOff />}</button>
                    <button type="button" disabled={layer === 'mask'} aria-label={`${LAYER_LABELS[layer]}锁定`} onClick={() => layer !== 'mask' && setImageLocks((current) => ({ ...current, [layer]: !current[layer] }))}>{layer !== 'mask' && imageLocks[layer] ? <Lock /> : <LockOpen />}</button>
                  </div>
                ))}
              </div>
            </section>

            <section className="region-layer-panel">
              <div className="panel-heading-row"><span className="panel-label">矢量区域 · 独立于图片</span><strong>{selectedRegionCount}</strong></div>
              <div className="layer-stack region-layer-stack">
                {REGION_LAYERS.map((layer) => (
                  <div className={`layer-stack-row ${activeRegionLayer === layer ? 'active' : ''}`} key={layer} style={{ '--region-color': REGION_LAYER_META[layer].color } as CSSProperties}>
                    <button type="button" onClick={() => { setActiveRegionLayer(layer); setRegionVisibility((current) => ({ ...current, [layer]: true })); }}>{REGION_LAYER_META[layer].label}</button>
                    <button type="button" aria-label={`${REGION_LAYER_META[layer].label}显隐`} onClick={() => setRegionVisibility((current) => ({ ...current, [layer]: !current[layer] }))}>{regionVisibility[layer] ? <Eye /> : <EyeOff />}</button>
                    <button type="button" aria-label={`${REGION_LAYER_META[layer].label}锁定`} onClick={() => setRegionLocks((current) => ({ ...current, [layer]: !current[layer] }))}>{regionLocks[layer] ? <Lock /> : <LockOpen />}</button>
                  </div>
                ))}
              </div>
              <p className="region-description">{REGION_LAYER_META[activeRegionLayer].description}</p>
              <div className="region-tool-grid" aria-label="区域绘制工具">
                <Button size="sm" variant={regionTool === 'select' ? 'default' : 'outline'} onClick={() => setRegionTool('select')}><MousePointer2 /> 选择</Button>
                <Button size="sm" variant={regionTool === 'rectangle' ? 'default' : 'outline'} onClick={() => setRegionTool('rectangle')}><Square /> 矩形</Button>
                <Button size="sm" variant={regionTool === 'polygon' ? 'default' : 'outline'} onClick={() => setRegionTool('polygon')}><PenTool /> 多边形</Button>
                <Button size="sm" variant={regionTool === 'free' ? 'default' : 'outline'} onClick={() => setRegionTool('free')}><Pencil /> 自由</Button>
                <Button size="sm" variant={regionTool === 'delete' ? 'destructive' : 'outline'} onClick={() => setRegionTool('delete')}><Trash2 /> 删除</Button>
                <Button size="sm" variant="outline" disabled={!canUndoRegions} onClick={undoRegions}><Undo2 /> 撤销</Button>
              </div>
              <Button type="button" className={`panel-button ${regionEditing ? 'region-editing-active' : ''}`} disabled={!selectedTile || !isRegionAuthoringMapLayer(activeMapLayer) || regionLocks[activeRegionLayer]} onClick={() => regionEditing ? setRegionEditing(false) : startRegionEditing()}>{regionEditing ? <X /> : <Pencil />} {regionEditing ? '退出区域绘制' : '进入区域绘制'}</Button>
              <p className="region-draw-hint">{regionHint}</p>
            </section>

            <section className="tile-actions-panel">
              <span className="panel-label">{selectedTile ? `${selectedTile.key} · ${LAYER_LABELS[activeMapLayer]}` : '选择卡片后操作'}</span>
              <div className="inspector-grid compact-actions">
                <Button variant="outline" disabled={!selectedTile || !isEditableMapLayer(activeMapLayer) || imageLocks[activeMapLayer as MapImageLayer]} onClick={() => layerInputRef.current?.click()}><Upload /> 上传</Button>
                <Button variant="outline" disabled={!selectedTile || !isEditableMapLayer(activeMapLayer) || imageLocks[activeMapLayer as MapImageLayer]} onClick={() => selectedTile && isEditableMapLayer(activeMapLayer) && void runGeneration(selectedTile, activeMapLayer)}><Sparkles /> 生成</Button>
                <Button variant="outline" disabled={!selectedTile || !isEditableMapLayer(activeMapLayer) || !activeAsset} onClick={() => selectedTile && isEditableMapLayer(activeMapLayer) && setFineSession({ tileKey: selectedTile.key, layer: activeMapLayer })}><Pencil /> 像素精修</Button>
                <Button variant="outline" disabled={!selectedTile} onClick={() => selectedTile && addExpansion(selectedTile)}><Plus /> 向外扩展</Button>
                <Button variant="outline" disabled={!selectedTile?.images.overall || processingKeys.length > 0} onClick={() => void runLayerPipeline()}><Sparkles /> 图层流水线</Button>
                <Button variant="destructive" disabled={!selectedTile || !activeAsset || !isEditableMapLayer(activeMapLayer)} onClick={removeSelectedLayer}><Trash2 /> 删除图片</Button>
                <Button variant="outline" disabled={!selectedRegionCount} onClick={clearCurrentRegions}><Trash2 /> 清空区域</Button>
                <Button variant="outline" disabled={!shapes.some((shape) => shape.layer === 'top')} onClick={() => void exportCurrentPng('top')}><Download /> 顶层 PNG</Button>
              </div>
              {selectedTile && selectedTile.key !== CENTER_KEY && (
                <div className="feather-controls">
                  <div className="feather-heading"><span>边缘羽化</span><small>0–50%</small></div>
                  {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                    <div className="feather-row" key={side}><span>{{ top: '上', right: '右', bottom: '下', left: '左' }[side]} {selectedTile.feather[side]}%</span><Slider value={[selectedTile.feather[side]]} min={0} max={50} step={5} onValueChange={(value) => setFeather(side, sliderNumber(value, 0))} /></div>
                  ))}
                </div>
              )}
            </section>

            <Button variant="outline" className="panel-button" onClick={() => setSettingsOpen(true)}><Settings /> 生成与显示设置</Button>
            <Button variant="outline" className="panel-button" onClick={() => stateInputRef.current?.click()}><Upload /> 加载状态</Button>
            <Button variant="outline" className="panel-button" disabled={!tiles.length} onClick={() => void exportPsd()}><Download /> 分层 PSD</Button>
            <Button variant="outline" className="panel-button" disabled={!tiles.length} onClick={() => void exportEngine('godot')}><Download /> Godot 包</Button>
            <Button variant="outline" className="panel-button" disabled={!tiles.length} onClick={() => void exportEngine('unity')}><Download /> Unity 包</Button>
          </aside>

          <input ref={sourceInputRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,.jfif" multiple onChange={(event) => { void importSourceFiles(fileList(event.target.files)); event.target.value = ''; }} />
          <input ref={layerInputRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,.jfif" multiple onChange={(event) => { void assignFilesToLayer(fileList(event.target.files)); event.target.value = ''; }} />
          <input ref={stateInputRef} className="sr-only" type="file" accept=".zip,.json,application/zip,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void restoreState(file); event.target.value = ''; }} />
        </form>
      </main>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="map-stitcher-settings-dialog frame-ronin-settings" overlayClassName="map-stitcher-dialog-overlay">
          <DialogHeader><DialogTitle>FrameRonin 图层生成设置</DialogTitle><DialogDescription>浏览器只提交图片和提示词；API 地址与令牌仍由工作台服务端管理。</DialogDescription></DialogHeader>
          <div className="frame-ronin-settings-grid">
            <label><span>生成方式</span><select value={generatorMode} onChange={(event) => setGeneratorMode(event.target.value as GeneratorMode)}><option value="local">本地确定性补全</option><option value="external">工作台外部图片 API</option></select></label>
            {(['surface', 'black', 'white'] as const).map((layer) => <label key={layer}><span>{LAYER_LABELS[layer]}提示词</span><textarea rows={3} value={layerPrompts[layer]} onChange={(event) => setLayerPrompts((current) => ({ ...current, [layer]: event.target.value }))} /></label>)}
            <div className="switch-row"><span>隐藏预览边框</span><Switch checked={hidePreviewBorders} onCheckedChange={setHidePreviewBorders} /></div>
            <div className="switch-row"><span>隐藏卡片标签</span><Switch checked={hideCards} onCheckedChange={setHideCards} /></div>
          </div>
          <DialogFooter><Button onClick={() => setSettingsOpen(false)}>完成</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="map-stitcher-help-dialog" overlayClassName="map-stitcher-dialog-overlay">
          <DialogHeader><DialogTitle>新地图编辑模型</DialogTitle><DialogDescription>区域标注不再改写图片像素。</DialogDescription></DialogHeader>
          <ol className="map-stitcher-help-steps">
            <li><span>1</span><div><strong>图片图层</strong><p>overall、surface、object、black、white 分开保存；mask 由 overall 与 object 自动派生。</p></div></li>
            <li><span>2</span><div><strong>矢量区域</strong><p>遮挡、碰撞、调整、顶层支持矩形、多边形、自由绘制。坐标保存为卡片本地像素。</p></div></li>
            <li><span>3</span><div><strong>像素精修</strong><p>只在单独入口修改当前图片层，不再伪装成“区域绘制”。</p></div></li>
            <li><span>4</span><div><strong>状态与导出</strong><p>保存线上兼容的 Pixelwork v2 ZIP；Godot 与 Unity 包同时包含区域清单。</p></div></li>
          </ol>
          <DialogFooter><Button onClick={() => setHelpOpen(false)}>知道了</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Toaster>
  );
}

async function assetCanvas(asset: FrameRoninTile['images']['overall']) {
  if (!asset) throw new Error('当前卡片缺少整体层');
  const canvas = document.createElement('canvas');
  canvas.width = asset.width;
  canvas.height = asset.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法创建生成画布');
  context.imageSmoothingEnabled = false;
  context.drawImage(await loadImage(asset.url), 0, 0);
  return canvas;
}
