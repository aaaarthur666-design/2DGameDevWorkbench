'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from 'react';
import {
  ArrowLeft,
  ChevronDown,
  CircleHelp,
  Download,
  Eraser,
  Eye,
  EyeOff,
  Expand,
  FileArchive,
  Hand,
  ImagePlus,
  Layers3,
  LoaderCircle,
  Lock,
  LockOpen,
  Maximize,
  Minus,
  Paintbrush,
  Plus,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
} from 'lucide-react';
import { CollisionRegionEditor } from '@/components/map-stitcher/editors/collision-region-editor';
import { ImageFineEditor } from '@/components/map-stitcher/editors/image-fine-editor';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Toaster, toast } from '@/components/ui/toast';
import {
  ASSET_LAYERS,
  CENTER_KEY,
  EMPTY_FEATHER,
  assetBytes,
  assetCount,
  clamp,
  type Feather,
  type LayerId,
  type ManagedLayer,
  type MaskMode,
  type SavedImageReference,
  type SceneMakerState,
  type Tile,
  type VisualLayer,
  hasVisibleAsset,
  isAssetLayer,
} from '@/features/map-stitcher/map-types';
import {
  blobToAsset,
  canvasToBlob,
  createCenterTile,
  dataUrlToBlob,
  expandAroundTile,
  fileToAsset,
  isSameGeometry,
  preferredEditableLayer,
  repairBottomRightWatermark,
  revokeTileAssets,
  urlToBlob,
} from '@/features/map-stitcher/image-utils';
import {
  createOverlapTemplate,
  downloadTileLayer,
  downloadOverlapTemplate,
  exportGodot,
  exportPng,
  exportPsd,
  exportStateZip,
  generateLayerVariant,
  generateLocalExpansion,
  imageReferenceToBlob,
  legacyCollisionMaskToRectangles,
  loadGodotPackage,
  readStatePackage,
  renderTile,
  sourceTile,
} from '@/features/map-stitcher/export-utils';

const BASE_TILE_WIDTH = 360;
const GEMINI_URL = 'https://gemini.google.com/gem/1lJTnukifhxITzO7l084Icn3Q_ctIID9g?usp=sharing';

type GeneratorMode = 'local' | 'external';
interface PaintSession {
  tileKey: string;
  layer: VisualLayer | 'collision';
}

interface GeneratorSettings {
  mode: GeneratorMode;
  prompt: string;
}

const DEFAULT_GENERATOR: GeneratorSettings = {
  mode: 'local',
  prompt: '保持原图像素风、透视、光照与地形连续，只补全透明区域，不改变已有重叠像素。',
};

function notify(title: string, description?: string, type: 'success' | 'info' | 'warning' | 'error' = 'info') {
  toast.add({ title, description, type, timeout: type === 'error' ? 7_000 : 4_000 });
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function layerName(layer: ManagedLayer) {
  return { ground: '地表', object: '物体', foreground: '遮挡', collision: '碰撞', black: '黑层', white: '白层' }[layer];
}

function collisionId() {
  return `collision_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function sliderNumber(value: number | readonly number[], fallback: number) {
  return Array.isArray(value) ? (value[0] ?? fallback) : Number(value);
}

function directionClass(tile: Tile) {
  const centerX = tile.x + tile.w / 2;
  const centerY = tile.y + tile.h / 2;
  if (Math.abs(centerX - 0.5) > Math.abs(centerY - 0.5)) return centerX < 0.5 ? 'tile-left' : 'tile-right';
  return centerY < 0.5 ? 'tile-top' : 'tile-bottom';
}

function featherPreviewStyle(tile: Tile): CSSProperties {
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

function fileList(files: FileList | null) {
  return files ? Array.from(files) : [];
}

async function canvasDataUrl(canvas: HTMLCanvasElement) {
  const blob = await canvasToBlob(canvas);
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('无法编码扩图模板'));
    };
    reader.onerror = () => reject(new Error('无法编码扩图模板'));
    reader.readAsDataURL(blob);
  });
}

export function MapEditor() {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [activeLayer, setActiveLayer] = useState<LayerId>('overall');
  const [maskMode, setMaskMode] = useState<MaskMode>('white');
  const [horizontalOverlap, setHorizontalOverlap] = useState(15);
  const [verticalOverlap, setVerticalOverlap] = useState(15);
  const [expandSplit, setExpandSplit] = useState<4 | 8 | 12>(4);
  const [generateCount, setGenerateCount] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [panMode, setPanMode] = useState(false);
  const [spacePan, setSpacePan] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [hideCards, setHideCards] = useState(false);
  const [hidePreviewBorders, setHidePreviewBorders] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [paintSession, setPaintSession] = useState<PaintSession | null>(null);
  const [layerVisibility, setLayerVisibility] = useState<Record<ManagedLayer, boolean>>({
    ground: true,
    object: true,
    foreground: true,
    collision: false,
    black: true,
    white: true,
  });
  const [layerLocks, setLayerLocks] = useState<Record<ManagedLayer, boolean>>({
    ground: false,
    object: false,
    foreground: false,
    collision: false,
    black: false,
    white: false,
  });
  const [generator, setGenerator] = useState<GeneratorSettings>(DEFAULT_GENERATOR);
  const [processingKeys, setProcessingKeys] = useState<string[]>([]);
  const workspaceRef = useRef<HTMLFormElement>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const tileInputRef = useRef<HTMLInputElement>(null);
  const stateInputRef = useRef<HTMLInputElement>(null);
  const godotInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const tilesRef = useRef(tiles);
  const selectedTile = useMemo(() => tiles.find((tile) => tile.key === selectedKey) ?? null, [tiles, selectedKey]);
  const paintTile = useMemo(() => paintSession ? tiles.find((tile) => tile.key === paintSession.tileKey) ?? null : null, [paintSession, tiles]);
  const source = useMemo(() => tiles.find((tile) => tile.key === CENTER_KEY), [tiles]);
  const sourceAspect = source?.layers.ground ? source.layers.ground.height / source.layers.ground.width : 1;
  const baseTileHeight = BASE_TILE_WIDTH * sourceAspect;
  const imageCount = assetCount(tiles);
  const memoryMb = assetBytes(tiles) / (1024 * 1024);
  const editableLayer = preferredEditableLayer(activeLayer);

  useEffect(() => {
    tilesRef.current = tiles;
  }, [tiles]);

  useEffect(() => () => revokeTileAssets(tilesRef.current), []);

  const replaceTiles = useCallback((nextTiles: Tile[]) => {
    const previous = tilesRef.current;
    tilesRef.current = nextTiles;
    setTiles(nextTiles);
    revokeTileAssets(previous);
  }, []);

  const fitView = useCallback((targetTiles = tilesRef.current) => {
    const workspace = workspaceRef.current;
    if (!workspace || !targetTiles.length) {
      setPan({ x: 0, y: 0 });
      setZoom(1);
      return;
    }
    const bounds = targetTiles.reduce(
      (result, tile) => ({
        minX: Math.min(result.minX, tile.x),
        minY: Math.min(result.minY, tile.y),
        maxX: Math.max(result.maxX, tile.x + tile.w),
        maxY: Math.max(result.maxY, tile.y + tile.h),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    const width = Math.max(BASE_TILE_WIDTH, (bounds.maxX - bounds.minX) * BASE_TILE_WIDTH);
    const height = Math.max(baseTileHeight, (bounds.maxY - bounds.minY) * baseTileHeight);
    const nextZoom = clamp(Math.min((workspace.clientWidth - 370) / width, (workspace.clientHeight - 100) / height, 1), 0.08, 1);
    const centerX = ((bounds.minX + bounds.maxX) / 2 - 0.5) * BASE_TILE_WIDTH;
    const centerY = ((bounds.minY + bounds.maxY) / 2 - 0.5) * baseTileHeight;
    setZoom(nextZoom);
    setPan({ x: -centerX * nextZoom, y: -centerY * nextZoom });
  }, [baseTileHeight]);

  const addExpansion = useCallback((origin: Tile, currentTiles = tilesRef.current) => {
    const candidates = expandAroundTile(origin, origin.key === CENTER_KEY ? expandSplit : 4, horizontalOverlap, verticalOverlap);
    const originDistance = Math.hypot(origin.x + origin.w / 2 - 0.5, origin.y + origin.h / 2 - 0.5);
    const additions = candidates.filter((candidate) => {
      if (currentTiles.some((tile) => isSameGeometry(tile, candidate))) return false;
      if (origin.key === CENTER_KEY) return true;
      const candidateDistance = Math.hypot(candidate.x + candidate.w / 2 - 0.5, candidate.y + candidate.h / 2 - 0.5);
      return candidateDistance > originDistance - 0.0001;
    });
    if (!additions.length) {
      notify('周围已经存在扩图卡片', '可以选择外围卡片继续向外扩展。', 'info');
      return currentTiles;
    }
    const next = [...currentTiles, ...additions];
    tilesRef.current = next;
    setTiles(next);
    notify(`已添加 ${additions.length} 个扩图卡片`, '点击空卡片即可上传、生成模板或自动填充。', 'success');
    return next;
  }, [expandSplit, horizontalOverlap, verticalOverlap]);

  const importSourceFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    try {
      const assets = [];
      for (const file of files) assets.push(await fileToAsset(file));
      const center = createCenterTile(assets[0]);
      const initial = [center, ...expandAroundTile(center, expandSplit, horizontalOverlap, verticalOverlap)];
      for (let index = 1; index < assets.length && index <= initial.length - 1; index += 1) {
        initial[index] = { ...initial[index], layers: { ground: assets[index] } };
      }
      for (let index = initial.length; index < assets.length; index += 1) URL.revokeObjectURL(assets[index].url);
      replaceTiles(initial);
      setSelectedKey(CENTER_KEY);
      setPan({ x: 0, y: 0 });
      window.setTimeout(() => fitView(initial), 30);
      notify('地图已导入', assets.length > 1 ? `其余 ${assets.length - 1} 张图片已依次放入扩图卡片。` : '已创建第一圈扩图卡片。', 'success');
    } catch (error) {
      notify('导入失败', error instanceof Error ? error.message : '无法读取图片', 'error');
    }
  }, [expandSplit, fitView, horizontalOverlap, replaceTiles, verticalOverlap]);

  const assignFilesToTiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    if (activeLayer === 'collision') {
      notify('碰撞层不接受图片', '请使用“编辑碰撞区域”在地图上拖出碰撞矩形。', 'warning');
      return;
    }
    if (!tilesRef.current.length) {
      await importSourceFiles(files);
      return;
    }
    try {
      const assets = [];
      for (const file of files) assets.push(await fileToAsset(file));
      const preferred = selectedKey ? tilesRef.current.find((tile) => tile.key === selectedKey) : undefined;
      const targets = [preferred, ...tilesRef.current.filter((tile) => tile.key !== preferred?.key && !tile.layers[editableLayer])].filter(Boolean) as Tile[];
      if (!targets.length) throw new Error('当前图层没有空卡片，请先扩展地图');
      const next = [...tilesRef.current];
      for (let index = 0; index < assets.length && index < targets.length; index += 1) {
        const targetIndex = next.findIndex((tile) => tile.key === targets[index].key);
        const old = next[targetIndex].layers[editableLayer];
        if (old) URL.revokeObjectURL(old.url);
        next[targetIndex] = {
          ...next[targetIndex],
          layers: { ...next[targetIndex].layers, [editableLayer]: assets[index] },
          hidden: false,
        };
      }
      for (let index = targets.length; index < assets.length; index += 1) URL.revokeObjectURL(assets[index].url);
      tilesRef.current = next;
      setTiles(next);
      notify('图片已放入地图', `已更新 ${Math.min(assets.length, targets.length)} 个${layerName(editableLayer)}图层卡片。`, 'success');
    } catch (error) {
      notify('上传失败', error instanceof Error ? error.message : '无法读取图片', 'error');
    }
  }, [activeLayer, editableLayer, importSourceFiles, selectedKey]);

  const updateTile = useCallback((key: string, update: (tile: Tile) => Tile) => {
    setTiles((current) => {
      const next = current.map((tile) => tile.key === key ? update(tile) : tile);
      tilesRef.current = next;
      return next;
    });
  }, []);

  const createBlankLayer = useCallback(async () => {
    if (!selectedTile || !isAssetLayer(activeLayer) || layerLocks[activeLayer]) return;
    const sourceAsset = source?.layers.ground;
    if (!sourceAsset) return;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(selectedTile.w * sourceAsset.width));
    canvas.height = Math.max(1, Math.round(selectedTile.h * sourceAsset.height));
    const asset = await blobToAsset(await canvasToBlob(canvas), `${selectedTile.key.replace(',', '_')}_${activeLayer}.png`);
    updateTile(selectedTile.key, (tile) => ({
      ...tile,
      hidden: false,
      layers: { ...tile.layers, [activeLayer]: asset },
    }));
    notify(`${layerName(activeLayer)}图层已创建`, '现在可以直接在地图图片上绘制。', 'success');
  }, [activeLayer, layerLocks, selectedTile, source, updateTile]);

  const beginRegionPaint = useCallback(() => {
    if (!selectedTile) return;
    const layer = activeLayer === 'overall' ? 'ground' : activeLayer;
    if (!(['ground', 'object', 'foreground', 'collision'] as const).includes(layer as VisualLayer | 'collision')) {
      notify('该参考层不支持区域绘制', '请选择地表层、物体层、遮挡层或碰撞层。', 'warning');
      return;
    }
    if (layerLocks[layer]) return;
    if (selectedTile.hidden) updateTile(selectedTile.key, (tile) => ({ ...tile, hidden: false }));
    if (activeLayer === 'overall') setActiveLayer('ground');
    setPanMode(false);
    setSpacePan(false);
    setPaintSession({ tileKey: selectedTile.key, layer: layer as VisualLayer | 'collision' });
  }, [activeLayer, layerLocks, selectedTile, updateTile]);

  const applyFinePaint = useCallback(async (blob: Blob | null) => {
    if (!paintSession || paintSession.layer === 'collision') return;
    try {
      const layer = paintSession.layer;
      const replacement = blob ? await blobToAsset(blob, `${paintSession.tileKey.replace(',', '_')}_${layer}_painted.png`) : null;
      updateTile(paintSession.tileKey, (tile) => {
        const layers = { ...tile.layers };
        const previous = layers[layer];
        if (previous) URL.revokeObjectURL(previous.url);
        if (replacement) layers[layer] = replacement;
        else delete layers[layer];
        return { ...tile, layers, hidden: false };
      });
      notify('区域绘制已保存', `${paintSession.tileKey} · ${layerName(layer)}图层`, 'success');
      setPaintSession(null);
    } catch (error) {
      notify('区域绘制保存失败', error instanceof Error ? error.message : '无法生成图片', 'error');
      throw error;
    }
  }, [paintSession, updateTile]);

  const applyCollisionRegions = useCallback((collisions: Tile['collisions']) => {
    if (!paintSession || paintSession.layer !== 'collision') return;
    updateTile(paintSession.tileKey, (tile) => ({ ...tile, collisions, hidden: false }));
    notify('碰撞区域已保存', `${paintSession.tileKey} · ${collisions.length} 个矩形`, 'success');
    setPaintSession(null);
  }, [paintSession, updateTile]);

  const setFeather = useCallback((side: keyof Feather, value: number) => {
    if (!selectedTile || selectedTile.key === CENTER_KEY) return;
    updateTile(selectedTile.key, (tile) => ({
      ...tile,
      feather: { ...tile.feather, [side]: clamp(Math.round(value / 5) * 5, 0, 50) },
    }));
  }, [selectedTile, updateTile]);

  const removeSelectedImage = useCallback(() => {
    if (!selectedTile) return;
    if (activeLayer === 'collision') {
      updateTile(selectedTile.key, (tile) => ({ ...tile, collisions: [] }));
      notify('已清空碰撞区域', undefined, 'success');
      return;
    }
    if (selectedTile.key === CENTER_KEY && editableLayer === 'ground') {
      notify('中心原图不能单独卸载', '可通过顶部“导入图片”替换整个地图。', 'warning');
      return;
    }
    updateTile(selectedTile.key, (tile) => {
      const asset = tile.layers[editableLayer];
      if (asset) URL.revokeObjectURL(asset.url);
      const layers = { ...tile.layers };
      delete layers[editableLayer];
      return { ...tile, layers };
    });
    notify('已卸载当前图层图片', undefined, 'success');
  }, [activeLayer, editableLayer, selectedTile, updateTile]);

  const downloadTemplate = useCallback(async () => {
    if (!selectedTile) return;
    try {
      await downloadOverlapTemplate(tilesRef.current, selectedTile, activeLayer);
      notify('重叠模板已下载', undefined, 'success');
    } catch (error) {
      notify('模板生成失败', error instanceof Error ? error.message : '未知错误', 'error');
    }
  }, [activeLayer, selectedTile]);

  const generatedBlob = useCallback(async (target: Tile) => {
    if (activeLayer === 'collision') throw new Error('碰撞层请使用碰撞区域编辑器');
    if (generator.mode === 'local') {
      if (editableLayer !== 'ground' && (target.layers.ground || target.layers.object)) {
        return generateLayerVariant(tilesRef.current, target, editableLayer);
      }
      return generateLocalExpansion(tilesRef.current, target, activeLayer, maskMode);
    }
    const template = editableLayer !== 'ground' && (target.layers.ground || target.layers.object)
      ? await renderTile(target, sourceTile(tilesRef.current), 'overall', false)
      : await createOverlapTemplate(tilesRef.current, target, activeLayer);
    const response = await fetch('/api/workbench/map-stitcher/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image: await canvasDataUrl(template),
        prompt: generator.prompt,
        tile: { key: target.key, x: target.x, y: target.y, w: target.w, h: target.h },
        layer: editableLayer,
        mask_mode: maskMode,
      }),
    });
    const data = await response.json() as { image?: string; data?: string; url?: string; error?: string };
    if (!response.ok) throw new Error(data.error ?? `扩图服务返回 ${response.status}`);
    const result = data.image ?? data.data ?? data.url;
    if (!result) throw new Error('扩图服务未返回 image、data 或 url 字段');
    if (result.startsWith('data:')) return dataUrlToBlob(result);
    if (/^https?:\/\//.test(result)) return urlToBlob(result);
    return dataUrlToBlob(`data:image/png;base64,${result}`);
  }, [activeLayer, editableLayer, generator, maskMode]);

  const generateOne = async (target: Tile) => {
    setProcessingKeys((keys) => [...keys, target.key]);
    try {
      const blob = await generatedBlob(target);
      const asset = await blobToAsset(blob, `generated_${target.key.replace(',', '_')}_${editableLayer}.png`);
      updateTile(target.key, (tile) => {
        const previous = tile.layers[editableLayer];
        if (previous) URL.revokeObjectURL(previous.url);
        return {
          ...tile,
          layers: { ...tile.layers, [editableLayer]: asset },
          hidden: false,
        };
      });
      return true;
    } finally {
      setProcessingKeys((keys) => keys.filter((key) => key !== target.key));
    }
  };

  const removeWatermark = useCallback(async () => {
    if (!selectedTile) return;
    const current = selectedTile.layers[editableLayer];
    if (!current) {
      notify('当前图层没有图片', undefined, 'warning');
      return;
    }
    try {
      const blob = await repairBottomRightWatermark(current);
      const repaired = await blobToAsset(blob, `${current.name.replace(/\.[^.]+$/, '')}_repaired.png`);
      updateTile(selectedTile.key, (tile) => {
        const previous = tile.layers[editableLayer];
        if (previous) URL.revokeObjectURL(previous.url);
        return { ...tile, layers: { ...tile.layers, [editableLayer]: repaired } };
      });
      notify('右下角水印区域已修复', '已使用邻近像素重建并柔化边缘。', 'success');
    } catch (error) {
      notify('去水印失败', error instanceof Error ? error.message : '未知错误', 'error');
    }
  }, [editableLayer, selectedTile, updateTile]);

  const autoGenerate = async () => {
    if (!tilesRef.current.length) {
      notify('请先导入地图原图', undefined, 'warning');
      return;
    }
    if (activeLayer === 'collision') {
      notify('碰撞层不使用图片生成', '请在画布上拖拽创建碰撞矩形。', 'warning');
      return;
    }
    let available = tilesRef.current.filter((tile) => {
      if (tile.layers[editableLayer]) return false;
      if (editableLayer === 'ground') return tile.key !== CENTER_KEY;
      return Boolean(tile.layers.ground || tile.layers.object);
    });
    if (!available.length) {
      const origin = selectedTile ?? sourceTile(tilesRef.current);
      const previousKeys = new Set(tilesRef.current.map((tile) => tile.key));
      const expanded = addExpansion(origin, tilesRef.current);
      available = expanded.filter((tile) => !previousKeys.has(tile.key));
    }
    const targets = available
      .sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))
      .slice(0, generateCount);
    if (!targets.length) return;
    let completed = 0;
    for (const target of targets) {
      try {
        if (await generateOne(target)) completed += 1;
      } catch (error) {
        notify(`卡片 ${target.key} 生成失败`, error instanceof Error ? error.message : '未知错误', 'error');
      }
    }
    if (completed) notify('扩图完成', `已生成 ${completed} 个${layerName(editableLayer)}图层卡片。`, 'success');
  };

  const runExport = useCallback(async (kind: 'png' | 'psd' | 'state' | 'godot') => {
    try {
      notify('正在准备导出', kind.toUpperCase(), 'info');
      if (kind === 'png') await exportPng(tilesRef.current, activeLayer);
      if (kind === 'psd') await exportPsd(tilesRef.current);
      if (kind === 'state') {
        await exportStateZip(tilesRef.current, {
          selectedKey,
          horizontalOverlapPercent: horizontalOverlap,
          verticalOverlapPercent: verticalOverlap,
          expandSplit,
          pan,
          zoom,
          hidePreviewBorders,
          hideCards,
          activeLayer,
          maskMode,
          layerVisibility,
          layerLocks,
        });
      }
      if (kind === 'godot') await exportGodot(tilesRef.current, horizontalOverlap, verticalOverlap);
      notify('导出已开始', '文件将保存到浏览器下载目录。', 'success');
    } catch (error) {
      notify('导出失败', error instanceof Error ? error.message : '未知错误', 'error');
    }
  }, [activeLayer, expandSplit, hideCards, hidePreviewBorders, horizontalOverlap, layerLocks, layerVisibility, maskMode, pan, selectedKey, verticalOverlap, zoom]);

  const restoreState = useCallback(async (file: File) => {
    try {
      const { manifest: raw, zip } = await readStatePackage(file);
      const manifest = raw as {
        format?: string;
        version?: number;
        selectedKey?: string | null;
        horizontalOverlapPercent?: number;
        verticalOverlapPercent?: number;
        expandSplit?: number;
        pan?: { x: number; y: number };
        zoom?: number;
        hidePreviewBorders?: boolean;
        hideCards?: boolean;
        activeLayer?: LayerId;
        maskMode?: MaskMode;
        layerVisibility?: SceneMakerState['layerVisibility'];
        layerLocks?: SceneMakerState['layerLocks'];
        source?: SavedImageReference;
        tiles?: SceneMakerState['tiles'] | Record<string, { x: number; y: number; w: number; h: number }>;
        tileUploads?: Record<string, SavedImageReference>;
        tileFeathers?: Record<string, Feather>;
        hiddenPreviewTiles?: Record<string, boolean>;
      };
      const restored: Tile[] = [];

      if (manifest.format === 'scenemaker-map-stitch-state' && [3, 4, 5].includes(Number(manifest.version)) && Array.isArray(manifest.tiles)) {
        for (const record of manifest.tiles) {
          if (![record.x, record.y, record.w, record.h].every(Number.isFinite) || record.w <= 0 || record.h <= 0) continue;
          const layers: Tile['layers'] = {};
          for (const layer of ASSET_LAYERS) {
            const reference = record.layers?.[layer];
            if (!reference) continue;
            const blob = await imageReferenceToBlob(reference, zip);
            layers[layer] = await blobToAsset(blob, reference.fileName || `${record.key}_${layer}.png`);
          }
          let collisions = Array.isArray(record.collisions)
            ? record.collisions.filter((rect) => [rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) && rect.w > 0 && rect.h > 0).map((rect) => ({ ...rect, id: rect.id || collisionId() }))
            : [];
          const legacyCollisionReference = (record.layers as Record<string, SavedImageReference | undefined> | undefined)?.collision;
          if (!collisions.length && legacyCollisionReference) {
            collisions = await legacyCollisionMaskToRectangles(await imageReferenceToBlob(legacyCollisionReference, zip));
          }
          restored.push({
            key: String(record.key),
            x: Number(record.x),
            y: Number(record.y),
            w: Number(record.w),
            h: Number(record.h),
            layers,
            collisions,
            hidden: Boolean(record.hidden),
            feather: {
              top: clamp(Number(record.feather?.top) || 0, 0, 50),
              right: clamp(Number(record.feather?.right) || 0, 0, 50),
              bottom: clamp(Number(record.feather?.bottom) || 0, 0, 50),
              left: clamp(Number(record.feather?.left) || 0, 0, 50),
            },
          });
        }
      } else if (manifest.format === 'pixelwork-map-stitch-state' && [1, 2].includes(Number(manifest.version)) && manifest.source && manifest.tiles && !Array.isArray(manifest.tiles)) {
        const sourceBlob = await imageReferenceToBlob(manifest.source, zip);
        const sourceAsset = await blobToAsset(sourceBlob, manifest.source.fileName || 'source.png');
        restored.push(createCenterTile(sourceAsset));
        const legacyTiles = manifest.tiles as Record<string, { x: number; y: number; w: number; h: number }>;
        for (const [key, geometry] of Object.entries(legacyTiles)) {
          if (key === CENTER_KEY || ![geometry.x, geometry.y, geometry.w, geometry.h].every(Number.isFinite) || geometry.w <= 0 || geometry.h <= 0) continue;
          const reference = manifest.tileUploads?.[key];
          const ground = reference ? await blobToAsset(await imageReferenceToBlob(reference, zip), reference.fileName || `${key}.png`) : undefined;
          const feather = manifest.tileFeathers?.[key] ?? EMPTY_FEATHER;
          restored.push({
            key,
            x: geometry.x,
            y: geometry.y,
            w: geometry.w,
            h: geometry.h,
            layers: ground ? { ground } : {},
            collisions: [],
            hidden: Boolean(manifest.hiddenPreviewTiles?.[key]),
            feather: {
              top: clamp(Number(feather.top) || 0, 0, 50),
              right: clamp(Number(feather.right) || 0, 0, 50),
              bottom: clamp(Number(feather.bottom) || 0, 0, 50),
              left: clamp(Number(feather.left) || 0, 0, 50),
            },
          });
        }
      } else {
        throw new Error('不是有效的 SceneMaker 或 FrameRonin 地图状态文件');
      }
      if (!restored.find((tile) => tile.key === CENTER_KEY)?.layers.ground) throw new Error('状态文件缺少中心原图');
      replaceTiles(restored);
      setSelectedKey(restored.some((tile) => tile.key === manifest.selectedKey) ? manifest.selectedKey ?? null : null);
      setHorizontalOverlap(clamp(Number(manifest.horizontalOverlapPercent) || 15, 0, 50));
      setVerticalOverlap(clamp(Number(manifest.verticalOverlapPercent) || 15, 0, 50));
      setExpandSplit([4, 8, 12].includes(Number(manifest.expandSplit)) ? manifest.expandSplit as 4 | 8 | 12 : 4);
      setPan(manifest.pan && Number.isFinite(manifest.pan.x) && Number.isFinite(manifest.pan.y) ? manifest.pan : { x: 0, y: 0 });
      setZoom(clamp(Number(manifest.zoom) || 1, 0.05, 8));
      setHidePreviewBorders(Boolean(manifest.hidePreviewBorders));
      setHideCards(Boolean(manifest.hideCards));
      setActiveLayer(['overall', 'ground', 'object', 'foreground', 'collision', 'black', 'white'].includes(String(manifest.activeLayer)) ? manifest.activeLayer as LayerId : 'overall');
      setMaskMode(manifest.maskMode === 'black' ? 'black' : 'white');
      if (manifest.layerVisibility) setLayerVisibility((current) => ({ ...current, ...manifest.layerVisibility }));
      if (manifest.layerLocks) setLayerLocks((current) => ({ ...current, ...manifest.layerLocks }));
      notify('状态已恢复', `载入 ${restored.length} 个地图卡片。`, 'success');
    } catch (error) {
      notify('状态加载失败', error instanceof Error ? error.message : '文件无效', 'error');
    }
  }, [replaceTiles]);

  const importGodot = useCallback(async (file: File) => {
    try {
      const { manifest, records } = await loadGodotPackage(file);
      const restored: Tile[] = [];
      for (const { record, blob } of records) {
        const asset = await blobToAsset(blob, record.image.split('/').pop() ?? `${record.key}.png`);
        const layer = record.layer ?? 'ground';
        const existing = restored.find((tile) => tile.key === record.key);
        if (existing) {
          existing.layers[layer] = asset;
        } else {
          restored.push({
            key: record.key,
            x: record.tile.x,
            y: record.tile.y,
            w: record.tile.w,
            h: record.tile.h,
            layers: { [layer]: asset },
            collisions: [],
            feather: record.feather ?? { ...EMPTY_FEATHER },
            hidden: false,
          });
        }
      }
      for (const collision of manifest.collisions ?? []) {
        if (!collision.tileKey || !collision.normalized) continue;
        const tile = restored.find((candidate) => candidate.key === collision.tileKey);
        const rect = collision.normalized;
        if (!tile || ![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) || rect.w <= 0 || rect.h <= 0) continue;
        tile.collisions.push({ id: rect.id || collision.id || collisionId(), x: rect.x, y: rect.y, w: rect.w, h: rect.h });
      }
      if (!restored.find((tile) => tile.key === CENTER_KEY)) throw new Error('Godot 包缺少中心图片');
      replaceTiles(restored);
      setHorizontalOverlap(clamp(Number(manifest.overlap?.horizontal_percent) || 15, 0, 50));
      setVerticalOverlap(clamp(Number(manifest.overlap?.vertical_percent) || 15, 0, 50));
      setSelectedKey(CENTER_KEY);
      window.setTimeout(() => fitView(restored), 30);
      notify('Godot 地图已加载', `恢复 ${restored.length} 个图片块。`, 'success');
    } catch (error) {
      notify('Godot 包加载失败', error instanceof Error ? error.message : '文件无效', 'error');
    }
  }, [fitView, replaceTiles]);

  const onWheel = useCallback((event: WheelEvent<HTMLElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - rect.left - rect.width / 2;
    const pointerY = event.clientY - rect.top - rect.height / 2;
    const nextZoom = clamp(zoom * Math.exp(-event.deltaY * 0.0015), 0.05, 8);
    const worldX = (pointerX - pan.x) / zoom;
    const worldY = (pointerY - pan.y) / zoom;
    setPan({ x: pointerX - worldX * nextZoom, y: pointerY - worldY * nextZoom });
    setZoom(nextZoom);
  }, [pan, zoom]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const shouldPan = event.button === 1 || event.button === 2 || ((panMode || spacePan) && event.button === 0);
    if (!shouldPan) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    setIsPanning(true);
  }, [pan, panMode, spacePan]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    setPan({
      x: dragRef.current.panX + event.clientX - dragRef.current.x,
      y: dragRef.current.panY + event.clientY - dragRef.current.y,
    });
  }, []);

  const endPan = useCallback(() => {
    dragRef.current = null;
    setIsPanning(false);
  }, []);

  const onDrop = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const files = fileList(event.dataTransfer.files);
    if (files.length) void (tilesRef.current.length ? assignFilesToTiles(files) : importSourceFiles(files));
  }, [assignFilesToTiles, importSourceFiles]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (event.code === 'Space') {
        event.preventDefault();
        setSpacePan(true);
      }
      if (event.key.toLowerCase() === 'h' && tilesRef.current.length && !paintSession) setHideCards((value) => !value);
      if (event.key === 'Escape') {
        if (paintSession) setPaintSession(null);
        else setSelectedKey(null);
      }
      if (event.key === '0') fitView();
      if (event.key === '+' || event.key === '=') setZoom((value) => clamp(value * 1.15, 0.05, 8));
      if (event.key === '-') setZoom((value) => clamp(value / 1.15, 0.05, 8));
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpacePan(false);
    };
    const onBlur = () => setSpacePan(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [fitView, paintSession]);

  useEffect(() => {
    const modelContext = (document as Document & {
      modelContext?: { registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => void | Promise<void> };
    }).modelContext;
    if (!modelContext?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(modelContext.registerTool({
        name: 'read_scene_summary',
        title: '读取地图摘要',
        description: '读取当前 SceneMaker 地图的图片数、卡片数、图层、重叠率和视图缩放。',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: false },
        execute: () => ({
          imageCount: assetCount(tilesRef.current),
          tileCount: tilesRef.current.length,
          activeLayer,
          horizontalOverlap,
          verticalOverlap,
          zoom,
        }),
      }, { signal: lifecycle.signal })).catch(() => undefined);
      void Promise.resolve(modelContext.registerTool({
        name: 'set_scene_view',
        title: '设置地图视图',
        description: '切换地图图层并设置缩放，结果会同步反映在可见编辑器中。',
        inputSchema: {
          type: 'object',
          properties: {
            layer: { type: 'string', enum: ['overall', 'ground', 'object'] },
            zoom: { type: 'number', minimum: 0.05, maximum: 8 },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: (input: unknown) => {
          const value = input as { layer?: LayerId; zoom?: number };
          if (value.layer) setActiveLayer(value.layer);
          if (typeof value.zoom === 'number') setZoom(clamp(value.zoom, 0.05, 8));
          return { layer: value.layer ?? activeLayer, zoom: typeof value.zoom === 'number' ? clamp(value.zoom, 0.05, 8) : zoom };
        },
      }, { signal: lifecycle.signal })).catch(() => undefined);
    } catch {
      // Browsers without WebMCP continue to use the visible interface.
    }
    return () => lifecycle.abort();
  }, [activeLayer, horizontalOverlap, verticalOverlap, zoom]);

  const visibleTiles = tiles;

  const stageStyle = {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
  };

  return (
    <Toaster>
      <main className="map-stitcher-surface editor-shell">
        <header className="topbar">
          <div className="title-cluster">
            <Button variant="ghost" className="topbar-button" onClick={() => fitView()}>
              <ArrowLeft /> 返回中心
            </Button>
            <h1>地图拼接</h1>
            <p>中键 / 右键拖动画布，滚轮缩放视图</p>
          </div>

          <div className="top-controls">
            <div className="field-stack">
              <span>扩图细分数</span>
              <Select value={String(expandSplit)} onValueChange={(value) => setExpandSplit(Number(value) as 4 | 8 | 12)}>
                <SelectTrigger className="wide-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="4">4 分扩图</SelectItem>
                  <SelectItem value="8">8 分扩图</SelectItem>
                  <SelectItem value="12">12 分扩图</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="slider-field">
              <span>左右重叠 {formatPercent(horizontalOverlap)}</span>
              <Slider aria-label="左右重叠比例" value={[horizontalOverlap]} min={0} max={50} onValueChange={(value) => setHorizontalOverlap(sliderNumber(value, 15))} />
            </div>
            <div className="slider-field">
              <span>上下重叠 {formatPercent(verticalOverlap)}</span>
              <Slider aria-label="上下重叠比例" value={[verticalOverlap]} min={0} max={50} onValueChange={(value) => setVerticalOverlap(sliderNumber(value, 15))} />
            </div>
            <Button variant="outline" className="toolbar-action" onClick={() => sourceInputRef.current?.click()}>
              <Upload /> 导入图片
            </Button>
            <Button variant="outline" className="toolbar-action" disabled={!tiles.length} onClick={() => void runExport('png')}>
              <Download /> 下载全部 PNG
            </Button>
            <Button variant="outline" className="toolbar-action" disabled={!tiles.length} onClick={() => void runExport('psd')}>
              <Layers3 /> 下载 PSD
            </Button>
          </div>
        </header>

        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The editor surface handles pointer pan, wheel zoom, and file drop. */}
        <form
          ref={workspaceRef}
          className={`workspace ${isPanning ? 'is-panning' : ''} ${panMode || spacePan ? 'pan-mode' : ''} ${paintSession ? 'paint-mode' : ''} mask-${maskMode}`}
          aria-label="地图编辑工作区"
          onSubmit={(event) => event.preventDefault()}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onContextMenu={(event) => event.preventDefault()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={onDrop}
        >
          <div className="canvas-grain" />

          {paintSession && paintTile && source?.layers.ground && paintSession.layer === 'collision' && (
            <CollisionRegionEditor
              width={Math.max(1, Math.round(paintTile.w * source.layers.ground.width))}
              height={Math.max(1, Math.round(paintTile.h * source.layers.ground.height))}
              tileKey={paintTile.key}
              assets={paintTile.layers}
              visibility={{ ground: layerVisibility.ground, object: layerVisibility.object, foreground: layerVisibility.foreground }}
              collisions={paintTile.collisions}
              onCancel={() => setPaintSession(null)}
              onApply={applyCollisionRegions}
            />
          )}

          {paintSession && paintTile && source?.layers.ground && paintSession.layer !== 'collision' && (
            <ImageFineEditor
              width={Math.max(1, Math.round(paintTile.w * source.layers.ground.width))}
              height={Math.max(1, Math.round(paintTile.h * source.layers.ground.height))}
              tileKey={paintTile.key}
              layerLabel={`${layerName(paintSession.layer)}图层`}
              imageUrl={paintTile.layers[paintSession.layer]?.url}
              onCancel={() => setPaintSession(null)}
              onApply={applyFinePaint}
            />
          )}

          {tiles.length > 0 && !paintSession && (
            <div className="stage" style={stageStyle} aria-label="可缩放地图画布">
              {visibleTiles.map((tile) => {
                const selected = selectedKey === tile.key;
                const empty = activeLayer === 'collision' ? !hasVisibleAsset(tile, 'overall') : !hasVisibleAsset(tile, activeLayer);
                const processing = processingKeys.includes(tile.key);
                return (
                  <button
                    key={tile.key}
                    className={`map-tile ${directionClass(tile)} ${selected ? 'selected' : ''} ${empty ? 'empty' : ''} ${tile.hidden ? 'preview-hidden' : ''} ${hidePreviewBorders ? 'borderless' : ''}`}
                    style={{
                      left: (tile.x - 0.5) * BASE_TILE_WIDTH,
                      top: (tile.y - 0.5) * baseTileHeight,
                      width: tile.w * BASE_TILE_WIDTH,
                      height: tile.h * baseTileHeight,
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!isPanning && !paintSession) setSelectedKey(tile.key);
                    }}
                    aria-label={`${tile.key === CENTER_KEY ? '中心地图' : `地图卡片 ${tile.key}`}${empty ? '，未上传' : '，已上传'}`}
                    aria-pressed={selected}
                  >
                    {!tile.hidden && (
                      <>
                        {layerVisibility.ground && (activeLayer === 'overall' || activeLayer === 'ground' || activeLayer === 'collision') && tile.layers.ground && (
                          // Blob URLs are local editor data and intentionally bypass image optimization.
                          // eslint-disable-next-line next/no-img-element
                          <img className="tile-layer-ground" src={tile.layers.ground.url} alt="" draggable={false} style={featherPreviewStyle(tile)} />
                        )}
                        {layerVisibility.object && (activeLayer === 'overall' || activeLayer === 'object' || activeLayer === 'collision') && tile.layers.object && (
                          // Blob URLs are local editor data and intentionally bypass image optimization.
                          // eslint-disable-next-line next/no-img-element
                          <img className="tile-layer-object" src={tile.layers.object.url} alt="" draggable={false} style={featherPreviewStyle(tile)} />
                        )}
                        {layerVisibility.foreground && (activeLayer === 'overall' || activeLayer === 'foreground' || activeLayer === 'collision') && tile.layers.foreground && (
                          // Blob URLs are local editor data and intentionally bypass image optimization.
                          // eslint-disable-next-line next/no-img-element
                          <img className="tile-layer-foreground" src={tile.layers.foreground.url} alt="" draggable={false} style={featherPreviewStyle(tile)} />
                        )}
                        {activeLayer === 'black' && tile.layers.black && (
                          // Blob URLs are local editor data and intentionally bypass image optimization.
                          // eslint-disable-next-line next/no-img-element
                          <img className="tile-layer-mask" src={tile.layers.black.url} alt="" draggable={false} style={featherPreviewStyle(tile)} />
                        )}
                        {activeLayer === 'white' && tile.layers.white && (
                          // Blob URLs are local editor data and intentionally bypass image optimization.
                          // eslint-disable-next-line next/no-img-element
                          <img className="tile-layer-mask" src={tile.layers.white.url} alt="" draggable={false} style={featherPreviewStyle(tile)} />
                        )}
                        {layerVisibility.collision && (activeLayer === 'collision' || activeLayer === 'overall') && (
                          <div className="collision-overlay" aria-label="碰撞层预览">
                            {tile.collisions.map((rect) => <span key={rect.id} className="collision-rect" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }} />)}
                          </div>
                        )}
                      </>
                    )}
                    {processing ? (
                      <span className="tile-empty-copy"><LoaderCircle className="spin" /><strong>正在扩图</strong><small>保持此页面打开</small></span>
                    ) : empty ? (
                      <span className="tile-empty-copy"><ImagePlus /><strong>点击激活</strong><small>上传或生成重叠模板</small></span>
                    ) : !hideCards && !paintSession && (
                      <span className="tile-status"><strong>{tile.key === CENTER_KEY ? '中心原图' : '点击操作'}</strong><small>{tile.key}</small></span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="floating-tools" aria-label="视图工具">
            <Button variant={panMode ? 'default' : 'outline'} size="icon-lg" aria-label="切换平移模式" aria-pressed={panMode} onClick={() => setPanMode((value) => !value)}><Hand /></Button>
            <Button variant="outline" size="icon-lg" aria-label="适配全部地图" disabled={!tiles.length} onClick={() => fitView()}><Maximize /></Button>
            <Button variant="outline" size="icon-lg" aria-label="隐藏全部卡片" disabled={!tiles.length} onClick={() => setHideCards((value) => !value)}>{hideCards ? <Eye /> : <EyeOff />}</Button>
            <Button variant="outline" size="icon-lg" aria-label="地图拼接帮助" onClick={() => setHelpOpen(true)}><CircleHelp /></Button>
          </div>

          <div className="zoom-chip" aria-live="polite">
            <Button variant="ghost" size="icon-xs" aria-label="缩小" onClick={() => setZoom((value) => clamp(value / 1.15, 0.05, 8))}><Minus /></Button>
            <button onClick={() => fitView()}>{Math.round(zoom * 100)}%</button>
            <Button variant="ghost" size="icon-xs" aria-label="放大" onClick={() => setZoom((value) => clamp(value * 1.15, 0.05, 8))}><Plus /></Button>
          </div>

          <div className="memory-card" aria-label="资源统计" title="按原始文件大小估算，不含导出时临时画布">
            <span>图片</span><strong>{imageCount} 张</strong>
            <span>内存</span><strong>{memoryMb < 0.01 ? '0' : memoryMb.toFixed(1)} MB</strong>
          </div>

          <aside className="side-panel" aria-label="地图操作">
            <section className="layer-panel">
              <span className="panel-label">视觉图层 · 上方显示在最前</span>
              <button className={`layer-overall ${activeLayer === 'overall' ? 'active' : ''}`} disabled={Boolean(paintSession)} onClick={() => setActiveLayer('overall')}><Layers3 /> 整体预览</button>
              <div className="layer-stack" aria-label="地图图层">
                {([
                  ['foreground', '遮挡层'],
                  ['object', '物体层'],
                  ['ground', '地表层'],
                ] as const).map(([value, label]) => (
                  <div className={`layer-stack-row ${activeLayer === value ? 'active' : ''}`} key={value}>
                    <button disabled={Boolean(paintSession)} onClick={() => setActiveLayer(value)}>{label}</button>
                    <button aria-label={`${label}${layerVisibility[value] ? '隐藏' : '显示'}`} onClick={() => setLayerVisibility((current) => ({ ...current, [value]: !current[value] }))}>{layerVisibility[value] ? <Eye /> : <EyeOff />}</button>
                    <button aria-label={`${label}${layerLocks[value] ? '解锁' : '锁定'}`} onClick={() => setLayerLocks((current) => ({ ...current, [value]: !current[value] }))}>{layerLocks[value] ? <Lock /> : <LockOpen />}</button>
                  </div>
                ))}
              </div>
              <span className="panel-label layer-debug-label">调试层 · 不参与画面合成</span>
              <div className={`layer-stack-row layer-debug-row ${activeLayer === 'collision' ? 'active' : ''}`}>
                <button disabled={Boolean(paintSession)} onClick={() => { setActiveLayer('collision'); setLayerVisibility((current) => ({ ...current, collision: true })); }}>碰撞层</button>
                <button aria-label={`碰撞层${layerVisibility.collision ? '隐藏' : '显示'}`} onClick={() => setLayerVisibility((current) => ({ ...current, collision: !current.collision }))}>{layerVisibility.collision ? <Eye /> : <EyeOff />}</button>
                <button aria-label={`碰撞层${layerLocks.collision ? '解锁' : '锁定'}`} onClick={() => setLayerLocks((current) => ({ ...current, collision: !current.collision }))}>{layerLocks.collision ? <Lock /> : <LockOpen />}</button>
              </div>
              <div className="layer-reference-row" aria-label="生成参考层">
                <button disabled={Boolean(paintSession)} className={activeLayer === 'black' ? 'active' : ''} onClick={() => { setActiveLayer('black'); setMaskMode('black'); }}>黑底参考</button>
                <button disabled={Boolean(paintSession)} className={activeLayer === 'white' ? 'active' : ''} onClick={() => { setActiveLayer('white'); setMaskMode('white'); }}>白底参考</button>
              </div>
            </section>
            <div className="inline-control">
              <span>同时生成</span>
              <Select value={String(generateCount)} onValueChange={(value) => setGenerateCount(Number(value))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="1">1 块</SelectItem><SelectItem value="2">2 块</SelectItem><SelectItem value="3">3 块</SelectItem><SelectItem value="4">4 块</SelectItem><SelectItem value="6">6 块</SelectItem><SelectItem value="8">8 块</SelectItem><SelectItem value="10">10 块</SelectItem><SelectItem value="12">12 块</SelectItem><SelectItem value="16">16 块</SelectItem><SelectItem value="20">20 块</SelectItem></SelectContent>
              </Select>
            </div>
            <Button variant="outline" className="panel-button" onClick={() => setSettingsOpen(true)}><Settings /> 设置</Button>
            <Button variant="outline" className="panel-button" onClick={() => window.open(GEMINI_URL, '_blank', 'noopener,noreferrer')}><WandSparkles /> 手动生成</Button>
            <Button variant="outline" className="panel-button accent-button" disabled={!tiles.length || activeLayer === 'collision' || processingKeys.length > 0} onClick={() => void autoGenerate()}>
              {processingKeys.length ? <LoaderCircle className="spin" /> : <Sparkles />} 全自动扩图
            </Button>
            <Button variant="outline" className="panel-button" onClick={() => stateInputRef.current?.click()}><Upload /> 加载状态</Button>
            <Button variant="outline" className="panel-button" onClick={() => godotInputRef.current?.click()}><Upload /> 加载 Godot</Button>
            <Button variant="outline" className="panel-button" disabled={!tiles.length} onClick={() => void runExport('state')}><FileArchive /> 保存状态</Button>
            <Button variant="outline" className="panel-button" disabled={!tiles.length} onClick={() => void runExport('godot')}><Download /> Godot 包</Button>
            <Button variant="outline" className="panel-button" disabled={!tiles.length || Boolean(paintSession)} onClick={() => setHideCards((value) => !value)}>{hideCards ? <Eye /> : <EyeOff />} {hideCards ? '显示卡片' : '隐藏卡片'}</Button>
          </aside>

          {selectedTile && !hideCards && !paintSession && (
            <aside className="tile-inspector" aria-label="当前卡片设置">
              <header>
                <div><small>{selectedTile.key === CENTER_KEY ? '中心地图' : '扩图卡片'}</small><strong>{selectedTile.key}</strong></div>
                <Button variant="ghost" size="icon-sm" aria-label="关闭卡片设置" disabled={Boolean(paintSession)} onClick={() => setSelectedKey(null)}><ChevronDown /></Button>
              </header>
              {activeLayer === 'collision' ? (
                <>
                  <div className="inspector-status">
                    <span>碰撞层</span>
                    <strong className={hasVisibleAsset(selectedTile, 'collision') ? 'status-ready' : 'status-waiting'}>{hasVisibleAsset(selectedTile, 'collision') ? `${selectedTile.collisions.length} 个矩形` : '尚未绘制'}</strong>
                  </div>
                  <p className="collision-hint">打开碰撞区域编辑后，直接在地图上拖出红色矩形。碰撞层不保存图片，也不使用画笔。</p>
                  <div className="inspector-grid">
                    <Button variant="outline" disabled={layerLocks.collision} onClick={beginRegionPaint}><Paintbrush /> 编辑碰撞区域</Button>
                    <Button variant="outline" onClick={() => addExpansion(selectedTile)}><Expand /> 扩展</Button>
                    <Button variant="destructive" disabled={!selectedTile.collisions.length || layerLocks.collision} onClick={removeSelectedImage}><Trash2 /> 清空碰撞</Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="inspector-status">
                    <span>{layerName(editableLayer)}图层</span>
                    <strong className={selectedTile.layers[editableLayer] ? 'status-ready' : 'status-waiting'}>{selectedTile.layers[editableLayer] ? '已创建' : '尚未创建'}</strong>
                  </div>
                  <div className="inspector-grid">
                    <Button variant="outline" disabled={layerLocks[editableLayer]} onClick={() => tileInputRef.current?.click()}><Upload /> 上传</Button>
                    <Button variant="outline" disabled={Boolean(selectedTile.layers[editableLayer]) || layerLocks[editableLayer]} onClick={() => void createBlankLayer()}><Plus /> 创建空白层</Button>
                    <Button variant="outline" disabled={!hasVisibleAsset(selectedTile, activeLayer)} onClick={() => void downloadTileLayer(tilesRef.current, selectedTile, activeLayer).catch((error) => notify('下载失败', error instanceof Error ? error.message : '未知错误', 'error'))}><Download /> 下载</Button>
                    <Button variant="outline" disabled={selectedTile.key === CENTER_KEY} onClick={() => void downloadTemplate()}><Download /> 模板</Button>
                    <Button variant="outline" disabled={layerLocks[editableLayer] || (selectedTile.key === CENTER_KEY && editableLayer === 'ground') || processingKeys.includes(selectedTile.key)} onClick={() => void generateOne(selectedTile).then(() => notify('卡片扩图完成', selectedTile.key, 'success')).catch((error) => notify('扩图失败', error instanceof Error ? error.message : '未知错误', 'error'))}><Sparkles /> 生成</Button>
                    <Button variant="outline" onClick={() => addExpansion(selectedTile)}><Expand /> 扩展</Button>
                    <Button variant="outline" disabled={!['ground', 'object', 'foreground'].includes(editableLayer) || layerLocks[editableLayer]} onClick={beginRegionPaint}><Paintbrush /> 区域绘制</Button>
                    <Button variant="outline" disabled={!selectedTile.layers[editableLayer] || layerLocks[editableLayer]} onClick={() => void removeWatermark()}><Eraser /> 去水印</Button>
                    <Button variant="outline" onClick={() => updateTile(selectedTile.key, (tile) => ({ ...tile, hidden: !tile.hidden }))}>{selectedTile.hidden ? <Eye /> : <EyeOff />} 预览</Button>
                    <Button variant="destructive" disabled={!selectedTile.layers[editableLayer] || layerLocks[editableLayer]} onClick={removeSelectedImage}><Trash2 /> 删除图层内容</Button>
                  </div>
                </>
              )}
              {activeLayer !== 'collision' && selectedTile.key !== CENTER_KEY && (
                <div className="feather-controls">
                  <div className="feather-heading"><span>边缘羽化</span><small>0–50%</small></div>
                  {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                    <div className="feather-row" key={side}>
                      <span>{{ top: '上', right: '右', bottom: '下', left: '左' }[side]} {selectedTile.feather[side]}%</span>
                      <Slider aria-label={`${{ top: '上', right: '右', bottom: '下', left: '左' }[side]}边羽化`} value={[selectedTile.feather[side]]} min={0} max={50} step={5} onValueChange={(value) => setFeather(side, sliderNumber(value, 0))} />
                    </div>
                  ))}
                </div>
              )}
              <div className="switch-row"><span>隐藏预览边框</span><Switch aria-label="隐藏预览边框" checked={hidePreviewBorders} onCheckedChange={setHidePreviewBorders} /></div>
            </aside>
          )}

          {!tiles.length && (
            <button className="upload-empty" onClick={() => sourceInputRef.current?.click()}>
              <Upload className="upload-icon" />
              <strong>导入地图图片</strong>
              <span className="primary-upload"><Upload /> 点击上传图片</span>
              <small>也可以把 PNG / JPG / JFIF / WebP 拖到这里上传。</small>
            </button>
          )}

          <input ref={sourceInputRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,.jfif" multiple onChange={(event) => { void importSourceFiles(fileList(event.target.files)); event.target.value = ''; }} />
          <input ref={tileInputRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,.jfif" multiple onChange={(event) => { void assignFilesToTiles(fileList(event.target.files)); event.target.value = ''; }} />
          <input ref={stateInputRef} className="sr-only" type="file" accept=".zip,.json,application/zip,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void restoreState(file); event.target.value = ''; }} />
          <input ref={godotInputRef} className="sr-only" type="file" accept=".zip,application/zip" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importGodot(file); event.target.value = ''; }} />
        </form>
      </main>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent
          className="map-stitcher-settings-dialog"
          overlayClassName="map-stitcher-dialog-overlay"
        >
          <DialogHeader>
            <DialogTitle>地图拼接设置</DialogTitle>
            <DialogDescription>本地模式无需配置；外部模式通过工作台服务端连接器安全调用。</DialogDescription>
          </DialogHeader>
          <div className="map-stitcher-dialog-form">
            <Label htmlFor="generator-mode">扩图方式</Label>
            <Select value={generator.mode} onValueChange={(value) => setGenerator((current) => ({ ...current, mode: value as GeneratorMode }))}>
              <SelectTrigger id="generator-mode" className="dialog-select"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="local">本地镜像补全</SelectItem><SelectItem value="external">外部图片 API</SelectItem></SelectContent>
            </Select>
            {generator.mode === 'external' && (
              <>
                <Label>服务连接</Label>
                <div className="map-stitcher-server-status">
                  API 地址与令牌由工作台服务端环境变量统一管理，不会发送到浏览器。
                </div>
              </>
            )}
            <Label htmlFor="prompt">生成提示词</Label>
            <textarea id="prompt" rows={3} value={generator.prompt} onChange={(event) => setGenerator((current) => ({ ...current, prompt: event.target.value }))} />
            <div className="switch-row"><span>隐藏所有预览边框</span><Switch aria-label="隐藏所有预览边框" checked={hidePreviewBorders} onCheckedChange={setHidePreviewBorders} /></div>
          </div>
          <DialogFooter><Button onClick={() => setSettingsOpen(false)}>完成</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent
          className="map-stitcher-help-dialog"
          overlayClassName="map-stitcher-dialog-overlay"
        >
          <DialogHeader>
            <DialogTitle>地图拼接帮助</DialogTitle>
            <DialogDescription>从一张中心地图开始，逐圈补全场景。</DialogDescription>
          </DialogHeader>
          <ol className="map-stitcher-help-steps">
            <li><span>1</span><div><strong>导入中心地图</strong><p>支持 PNG、JPG、JFIF、WebP，单张不超过 30 MB。一次选择多图会自动填入首圈卡片。</p></div></li>
            <li><span>2</span><div><strong>生成或上传邻接图</strong><p>点击空卡片，可下载带透明区的重叠模板、调用本地/外部扩图，或手动上传结果。</p></div></li>
            <li><span>3</span><div><strong>当前图层区域绘制</strong><p>先在右侧选择地表、物体或遮挡层，再打开区域绘制；编辑器只会修改当前图层。碰撞层使用独立的矩形区域编辑器。</p></div></li>
            <li><span>4</span><div><strong>保存与交付</strong><p>导出拼接 PNG、带图层 PSD、可恢复状态包；Godot 包会包含分层 Sprite2D 与 StaticBody2D 碰撞节点。</p></div></li>
          </ol>
          <div className="map-stitcher-shortcut-list"><kbd>滚轮</kbd><span>缩放</span><kbd>中键 / 右键</kbd><span>平移</span><kbd>H</kbd><span>隐藏卡片</span><kbd>0</kbd><span>适配画布</span><kbd>Esc</kbd><span>取消选择</span></div>
          <DialogFooter><Button onClick={() => setHelpOpen(false)}>知道了</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Toaster>
  );
}
