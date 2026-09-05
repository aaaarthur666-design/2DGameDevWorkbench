'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Check, MousePointer2, Trash2, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { loadImage } from '@/features/map-stitcher/image-utils';
import type { CollisionRect, ImageAsset, VisualLayer } from '@/features/map-stitcher/map-types';

type Point = { x: number; y: number };

const MIN_SCALE = 0.05;
const MAX_SCALE = 48;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function collisionId() {
  return `collision_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function cloneCollisions(value: CollisionRect[]) {
  return value.map((rect) => ({ ...rect }));
}

function contains(rect: CollisionRect, point: Point) {
  return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}

export interface CollisionRegionEditorProps {
  width: number;
  height: number;
  tileKey: string;
  assets: Partial<Record<VisualLayer, ImageAsset>>;
  visibility: Record<VisualLayer, boolean>;
  collisions: CollisionRect[];
  onCancel: () => void;
  onApply: (collisions: CollisionRect[]) => void;
}

export function CollisionRegionEditor({
  width,
  height,
  tileKey,
  assets,
  visibility,
  collisions: initialCollisions,
  onCancel,
  onApply,
}: CollisionRegionEditorProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef<HTMLCanvasElement>(null);
  const backgroundRef = useRef<HTMLCanvasElement | null>(null);
  const pointerRef = useRef<{
    mode: 'draw' | 'pan';
    pointerId: number;
    start: Point;
    end: Point;
    panStart?: { x: number; y: number; ox: number; oy: number };
  } | null>(null);
  const historyRef = useRef<CollisionRect[][]>([cloneCollisions(initialCollisions)]);
  const viewportInitializedRef = useRef(false);

  const [collisions, setCollisions] = useState(() => cloneCollisions(initialCollisions));
  const [draft, setDraft] = useState<{ start: Point; end: Point } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [ready, setReady] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [historyCount, setHistoryCount] = useState(0);

  useEffect(() => {
    let disposed = false;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = false;
    backgroundRef.current = canvas;

    const draw = async () => {
      context.clearRect(0, 0, width, height);
      for (const layer of ['ground', 'object', 'foreground'] as const) {
        const asset = assets[layer];
        if (!asset || !visibility[layer]) continue;
        try {
          const image = await loadImage(asset.url);
          if (disposed) return;
          context.drawImage(image, 0, 0, width, height);
        } catch {
          // Keep the remaining reference layers available when one image fails.
        }
      }
      if (!disposed) setReady(true);
    };
    void draw();
    return () => { disposed = true; };
  }, [assets, height, visibility, width]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let animationFrame = 0;
    const update = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const width = wrap.clientWidth;
        const height = wrap.clientHeight;
        setViewport((current) => (
          current.width === width && current.height === height
            ? current
            : { width, height }
        ));
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(wrap);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  useEffect(() => {
    if (!ready || !viewport.width || !viewport.height || viewportInitializedRef.current) return;
    const nextScale = clamp(Math.min((viewport.width * 0.9) / width, (viewport.height * 0.9) / height), MIN_SCALE, MAX_SCALE);
    setScale(nextScale);
    setOffset({ x: (viewport.width - width * nextScale) / 2, y: (viewport.height - height * nextScale) / 2 });
    viewportInitializedRef.current = true;
  }, [height, ready, viewport.height, viewport.width, width]);

  useLayoutEffect(() => {
    const display = displayRef.current;
    const background = backgroundRef.current;
    if (!display || !background || !viewport.width || !viewport.height) return;
    const dpr = window.devicePixelRatio || 1;
    display.width = Math.round(viewport.width * dpr);
    display.height = Math.round(viewport.height * dpr);
    display.style.width = `${viewport.width}px`;
    display.style.height = `${viewport.height}px`;
    const context = display.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = '#17171d';
    context.fillRect(0, 0, viewport.width, viewport.height);
    context.imageSmoothingEnabled = false;
    context.drawImage(background, offset.x, offset.y, width * scale, height * scale);

    for (const rect of collisions) {
      const selected = rect.id === selectedId;
      context.fillStyle = selected ? 'rgba(255, 120, 120, 0.56)' : 'rgba(200, 80, 80, 0.4)';
      context.strokeStyle = selected ? '#ff6666' : 'rgba(220, 90, 90, 0.95)';
      context.lineWidth = selected ? 2 : 1;
      context.setLineDash(selected ? [5, 4] : []);
      const x = offset.x + rect.x * width * scale;
      const y = offset.y + rect.y * height * scale;
      const rectWidth = rect.w * width * scale;
      const rectHeight = rect.h * height * scale;
      context.fillRect(x, y, rectWidth, rectHeight);
      context.strokeRect(x, y, rectWidth, rectHeight);
    }

    if (draft) {
      const x1 = Math.min(draft.start.x, draft.end.x);
      const y1 = Math.min(draft.start.y, draft.end.y);
      const x2 = Math.max(draft.start.x, draft.end.x);
      const y2 = Math.max(draft.start.y, draft.end.y);
      context.fillStyle = 'rgba(255, 150, 150, 0.5)';
      context.strokeStyle = '#ff6464';
      context.lineWidth = 2;
      context.setLineDash([5, 4]);
      context.fillRect(offset.x + x1 * width * scale, offset.y + y1 * height * scale, (x2 - x1) * width * scale, (y2 - y1) * height * scale);
      context.strokeRect(offset.x + x1 * width * scale, offset.y + y1 * height * scale, (x2 - x1) * width * scale, (y2 - y1) * height * scale);
    }
    context.setLineDash([]);
  }, [collisions, draft, height, offset, ready, scale, selectedId, viewport, width]);

  const clientToNormalized = useCallback((clientX: number, clientY: number): Point | null => {
    const canvas = displayRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left - offset.x) / (width * scale);
    const y = (clientY - rect.top - offset.y) / (height * scale);
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
  }, [height, offset, scale, width]);

  const pushState = useCallback((next: CollisionRect[]) => {
    historyRef.current.push(cloneCollisions(next));
    if (historyRef.current.length > 50) historyRef.current.shift();
    setHistoryCount(Math.max(0, historyRef.current.length - 1));
    setCollisions(next);
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const pan = event.button === 2 || event.button === 1 || (event.button === 0 && event.altKey);
    const point = clientToNormalized(event.clientX, event.clientY);
    if (pan) {
      pointerRef.current = {
        mode: 'pan', pointerId: event.pointerId, start: point ?? { x: 0, y: 0 }, end: point ?? { x: 0, y: 0 },
        panStart: { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y },
      };
      setIsPanning(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0 || !point) return;
    const hit = [...collisions].reverse().find((rect) => contains(rect, point));
    if (hit) {
      setSelectedId(hit.id);
      return;
    }
    setSelectedId(null);
    pointerRef.current = { mode: 'draw', pointerId: event.pointerId, start: point, end: point };
    setDraft({ start: point, end: point });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    if (pointer.mode === 'pan' && pointer.panStart) {
      setOffset({
        x: pointer.panStart.ox + event.clientX - pointer.panStart.x,
        y: pointer.panStart.oy + event.clientY - pointer.panStart.y,
      });
      return;
    }
    const point = clientToNormalized(event.clientX, event.clientY);
    if (!point) return;
    pointer.end = point;
    setDraft({ start: pointer.start, end: point });
  };

  const finishPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    if (pointer.mode === 'draw') {
      const x = Math.min(pointer.start.x, pointer.end.x);
      const y = Math.min(pointer.start.y, pointer.end.y);
      const w = Math.abs(pointer.end.x - pointer.start.x);
      const h = Math.abs(pointer.end.y - pointer.start.y);
      if (w * width >= 4 && h * height >= 4) {
        const created = { id: collisionId(), x, y, w, h };
        pushState([...collisions, created]);
        setSelectedId(created.id);
      }
    }
    pointerRef.current = null;
    setDraft(null);
    setIsPanning(false);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* capture already released */ }
  };

  useEffect(() => {
    const display = displayRef.current;
    if (!display) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = display.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      const imageX = (mouseX - offset.x) / scale;
      const imageY = (mouseY - offset.y) / scale;
      const nextScale = clamp(scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12), MIN_SCALE, MAX_SCALE);
      setScale(nextScale);
      setOffset({ x: mouseX - imageX * nextScale, y: mouseY - imageY * nextScale });
    };
    display.addEventListener('wheel', onWheel, { passive: false });
    return () => display.removeEventListener('wheel', onWheel);
  }, [offset, scale]);

  const undo = () => {
    if (historyRef.current.length <= 1) return;
    historyRef.current.pop();
    const previous = cloneCollisions(historyRef.current[historyRef.current.length - 1]!);
    setCollisions(previous);
    setSelectedId(null);
    setHistoryCount(historyRef.current.length - 1);
  };

  const removeSelected = () => {
    if (!selectedId) return;
    pushState(collisions.filter((rect) => rect.id !== selectedId));
    setSelectedId(null);
  };

  const clearAll = () => {
    if (!collisions.length) return;
    pushState([]);
    setSelectedId(null);
  };

  return (
    <div className="collision-editor" aria-label={`${tileKey}碰撞区域编辑器`} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
      <header className="collision-editor-toolbar">
        <div className="collision-editor-title"><strong>碰撞区域编辑</strong><span>{tileKey} · {collisions.length} 个矩形</span></div>
        <div className="collision-editor-hint"><MousePointer2 /> 在地图空白位置按住左键拖出矩形；点击已有矩形可选中。</div>
        <div className="collision-editor-actions">
          <Button size="sm" variant="outline" disabled={!historyCount} onClick={undo}><Undo2 /> 撤销上一步</Button>
          <Button size="sm" variant="outline" disabled={!selectedId} onClick={removeSelected}><Trash2 /> 删除选中</Button>
          <Button size="sm" variant="destructive" disabled={!collisions.length} onClick={clearAll}><Trash2 /> 清空全部</Button>
          <Button size="sm" variant="outline" onClick={onCancel}><X /> 取消</Button>
          <Button size="sm" onClick={() => onApply(cloneCollisions(collisions))}><Check /> 保存碰撞区域</Button>
        </div>
      </header>
      <div className="collision-editor-notice">碰撞层只保存矩形坐标，不会写入地图图片。右键 / 中键 / Alt+左键平移，滚轮缩放。</div>
      <div ref={wrapRef} className="collision-editor-canvas-wrap">
        <canvas
          ref={displayRef}
          aria-label="碰撞区域绘制画布"
          style={{ cursor: isPanning ? 'grabbing' : 'crosshair' }}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
        />
        {!ready && <div className="collision-editor-loading">正在载入地图图层…</div>}
        <div className="collision-editor-zoom">{Math.round(scale * 100)}%</div>
      </div>
    </div>
  );
}
