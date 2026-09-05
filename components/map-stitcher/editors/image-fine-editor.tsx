'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Check,
  Eraser,
  Eye,
  Move,
  Paintbrush,
  RotateCcw,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { canvasToBlob } from '@/features/map-stitcher/image-utils';

type FineTool = 'brush' | 'eraser' | 'eyedropper' | 'superEraser' | 'selectMove';
type Point = { x: number; y: number };
type Selection = { x: number; y: number; w: number; h: number };

const MAX_HISTORY = 30;
const MIN_SCALE = 0.05;
const MAX_SCALE = 48;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sliderNumber(value: number | readonly number[], fallback: number) {
  return Array.isArray(value) ? (value[0] ?? fallback) : Number(value);
}

function cloneImageData(value: ImageData) {
  return new ImageData(new Uint8ClampedArray(value.data), value.width, value.height);
}

function hasOpaquePixel(value: ImageData) {
  for (let index = 3; index < value.data.length; index += 4) if (value.data[index] > 0) return true;
  return false;
}

function normalizedSelection(start: Point, end: Point): Selection {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  return {
    x: left,
    y: top,
    w: Math.abs(end.x - start.x) + 1,
    h: Math.abs(end.y - start.y) + 1,
  };
}

function pointInSelection(point: Point, selection: Selection) {
  return point.x >= selection.x && point.x < selection.x + selection.w && point.y >= selection.y && point.y < selection.y + selection.h;
}

function blitImageData(dest: ImageData, chunk: ImageData, atX: number, atY: number) {
  for (let y = 0; y < chunk.height; y += 1) {
    for (let x = 0; x < chunk.width; x += 1) {
      const dx = atX + x;
      const dy = atY + y;
      if (dx < 0 || dx >= dest.width || dy < 0 || dy >= dest.height) continue;
      const sourceOffset = (y * chunk.width + x) * 4;
      const targetOffset = (dy * dest.width + dx) * 4;
      dest.data[targetOffset] = chunk.data[sourceOffset];
      dest.data[targetOffset + 1] = chunk.data[sourceOffset + 1];
      dest.data[targetOffset + 2] = chunk.data[sourceOffset + 2];
      dest.data[targetOffset + 3] = chunk.data[sourceOffset + 3];
    }
  }
}

export interface ImageFineEditorProps {
  width: number;
  height: number;
  imageUrl?: string;
  tileKey: string;
  layerLabel: string;
  onCancel: () => void;
  onApply: (blob: Blob | null) => Promise<void>;
}

export function ImageFineEditor({
  width,
  height,
  imageUrl,
  tileKey,
  layerLabel,
  onCancel,
  onApply,
}: ImageFineEditorProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLCanvasElement | null>(null);
  const initialRef = useRef<ImageData | null>(null);
  const historyRef = useRef<ImageData[]>([]);
  const redoRef = useRef<ImageData[]>([]);
  const pointerRef = useRef<{
    mode: 'draw' | 'pan' | 'marquee' | 'move';
    pointerId: number;
    start: Point;
    last: Point;
    panStart?: { x: number; y: number; ox: number; oy: number };
  } | null>(null);
  const viewportInitializedRef = useRef(false);

  const [tool, setTool] = useState<FineTool>('eraser');
  const [brushColor, setBrushColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(4);
  const [eraserSize, setEraserSize] = useState(8);
  const [tolerance, setTolerance] = useState(30);
  const [backgroundEnabled, setBackgroundEnabled] = useState(false);
  const [backgroundColor, setBackgroundColor] = useState('#22c55e');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [marquee, setMarquee] = useState<{ start: Point; end: Point } | null>(null);
  const [moveDelta, setMoveDelta] = useState({ x: 0, y: 0 });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [historyCount, setHistoryCount] = useState({ undo: 0, redo: 0 });
  const [isPanning, setIsPanning] = useState(false);

  const readImage = useCallback(() => {
    const canvas = imageRef.current;
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    return canvas && context ? context.getImageData(0, 0, canvas.width, canvas.height) : null;
  }, []);

  const writeImage = useCallback((value: ImageData) => {
    const canvas = imageRef.current;
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    context.putImageData(value, 0, 0);
    setRevision((current) => current + 1);
  }, []);

  const syncHistoryCount = useCallback(() => {
    setHistoryCount({ undo: Math.max(0, historyRef.current.length - 1), redo: redoRef.current.length });
  }, []);

  const pushHistory = useCallback(() => {
    const current = readImage();
    if (!current) return;
    historyRef.current.push(cloneImageData(current));
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
    redoRef.current = [];
    syncHistoryCount();
  }, [readImage, syncHistoryCount]);

  useEffect(() => {
    let disposed = false;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    context.imageSmoothingEnabled = false;
    imageRef.current = canvas;

    const finish = () => {
      if (disposed) return;
      const initial = context.getImageData(0, 0, width, height);
      initialRef.current = cloneImageData(initial);
      historyRef.current = [cloneImageData(initial)];
      redoRef.current = [];
      setHistoryCount({ undo: 0, redo: 0 });
      setReady(true);
      setRevision((current) => current + 1);
    };

    if (!imageUrl) {
      context.clearRect(0, 0, width, height);
      finish();
      return () => { disposed = true; };
    }

    const image = new Image();
    image.onload = () => {
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      finish();
    };
    image.onerror = finish;
    image.src = imageUrl;
    return () => { disposed = true; };
  }, [height, imageUrl, width]);

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
    const image = imageRef.current;
    if (!display || !image || !viewport.width || !viewport.height) return;
    const dpr = window.devicePixelRatio || 1;
    display.width = Math.round(viewport.width * dpr);
    display.height = Math.round(viewport.height * dpr);
    display.style.width = `${viewport.width}px`;
    display.style.height = `${viewport.height}px`;
    const context = display.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, viewport.width, viewport.height);
    context.fillStyle = '#242429';
    context.fillRect(0, 0, viewport.width, viewport.height);

    const checkerSize = clamp(Math.max(6, scale * 4), 6, 24);
    for (let y = 0; y < height * scale; y += checkerSize) {
      for (let x = 0; x < width * scale; x += checkerSize) {
        context.fillStyle = ((Math.floor(x / checkerSize) + Math.floor(y / checkerSize)) % 2) ? '#d9d2c8' : '#b8aea1';
        context.fillRect(offset.x + x, offset.y + y, Math.min(checkerSize, width * scale - x), Math.min(checkerSize, height * scale - y));
      }
    }
    if (backgroundEnabled) {
      context.fillStyle = backgroundColor;
      context.fillRect(offset.x, offset.y, width * scale, height * scale);
    }
    context.imageSmoothingEnabled = false;
    context.drawImage(image, offset.x, offset.y, width * scale, height * scale);

    const visibleSelection = marquee ? normalizedSelection(marquee.start, marquee.end) : selection;
    if (visibleSelection) {
      const dx = selection && !marquee ? moveDelta.x : 0;
      const dy = selection && !marquee ? moveDelta.y : 0;
      context.save();
      context.strokeStyle = marquee ? '#0ea5e9' : '#f59e0b';
      context.lineWidth = 2;
      context.setLineDash([6, 4]);
      context.strokeRect(
        offset.x + (visibleSelection.x + dx) * scale,
        offset.y + (visibleSelection.y + dy) * scale,
        visibleSelection.w * scale,
        visibleSelection.h * scale,
      );
      context.restore();
    }
  }, [backgroundColor, backgroundEnabled, height, marquee, moveDelta, offset, ready, revision, scale, selection, viewport, width]);

  const clientToPixel = useCallback((clientX: number, clientY: number, bounded = false): Point | null => {
    const display = displayRef.current;
    if (!display) return null;
    const rect = display.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left - offset.x) / scale);
    const y = Math.floor((clientY - rect.top - offset.y) / scale);
    if (bounded) return { x: clamp(x, 0, width - 1), y: clamp(y, 0, height - 1) };
    return x >= 0 && x < width && y >= 0 && y < height ? { x, y } : null;
  }, [height, offset, scale, width]);

  const drawLine = useCallback((from: Point, to: Point, erase: boolean) => {
    const canvas = imageRef.current;
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !context) return;
    const imageData = context.getImageData(0, 0, width, height);
    const size = erase ? eraserSize : brushSize;
    const radius = size / 2;
    const radiusSquared = radius * radius;
    const reach = Math.ceil(radius);
    const color = Number.parseInt(brushColor.slice(1), 16);
    const red = (color >> 16) & 255;
    const green = (color >> 8) & 255;
    const blue = color & 255;
    const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), 1);
    for (let step = 0; step <= steps; step += 1) {
      const point = {
        x: Math.round(from.x + ((to.x - from.x) * step) / steps),
        y: Math.round(from.y + ((to.y - from.y) * step) / steps),
      };
      for (let y = Math.max(0, point.y - reach); y <= Math.min(height - 1, point.y + reach); y += 1) {
        for (let x = Math.max(0, point.x - reach); x <= Math.min(width - 1, point.x + reach); x += 1) {
          const dx = x + 0.5 - (point.x + 0.5);
          const dy = y + 0.5 - (point.y + 0.5);
          if (dx * dx + dy * dy > radiusSquared) continue;
          const index = (y * width + x) * 4;
          if (erase) imageData.data[index + 3] = 0;
          else {
            imageData.data[index] = red;
            imageData.data[index + 1] = green;
            imageData.data[index + 2] = blue;
            imageData.data[index + 3] = 255;
          }
        }
      }
    }
    context.putImageData(imageData, 0, 0);
    setRevision((current) => current + 1);
  }, [brushColor, brushSize, eraserSize, height, width]);

  const superErase = useCallback((point: Point) => {
    const canvas = imageRef.current;
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !context) return;
    const imageData = context.getImageData(0, 0, width, height);
    const originIndex = (point.y * width + point.x) * 4;
    if (!imageData.data[originIndex + 3]) return;
    const origin = [imageData.data[originIndex], imageData.data[originIndex + 1], imageData.data[originIndex + 2]];
    const limit = tolerance * tolerance * 3;
    const visited = new Uint8Array(width * height);
    const stack: Point[] = [point];
    visited[point.y * width + point.x] = 1;
    while (stack.length) {
      const current = stack.pop()!;
      const index = (current.y * width + current.x) * 4;
      imageData.data[index + 3] = 0;
      for (const next of [
        { x: current.x + 1, y: current.y },
        { x: current.x - 1, y: current.y },
        { x: current.x, y: current.y + 1 },
        { x: current.x, y: current.y - 1 },
      ]) {
        if (next.x < 0 || next.x >= width || next.y < 0 || next.y >= height) continue;
        const visitIndex = next.y * width + next.x;
        if (visited[visitIndex]) continue;
        const pixelIndex = visitIndex * 4;
        if (!imageData.data[pixelIndex + 3]) continue;
        const distance =
          (imageData.data[pixelIndex] - origin[0]) ** 2 +
          (imageData.data[pixelIndex + 1] - origin[1]) ** 2 +
          (imageData.data[pixelIndex + 2] - origin[2]) ** 2;
        if (distance <= limit) {
          visited[visitIndex] = 1;
          stack.push(next);
        }
      }
    }
    context.putImageData(imageData, 0, 0);
    pushHistory();
    setRevision((current) => current + 1);
  }, [height, pushHistory, tolerance, width]);

  const finishMove = useCallback(() => {
    if (!selection || (!moveDelta.x && !moveDelta.y)) return;
    const canvas = imageRef.current;
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    if (!canvas || !context) return;
    const chunk = context.getImageData(selection.x, selection.y, selection.w, selection.h);
    context.clearRect(selection.x, selection.y, selection.w, selection.h);
    const destination = context.getImageData(0, 0, width, height);
    blitImageData(destination, chunk, selection.x + moveDelta.x, selection.y + moveDelta.y);
    context.putImageData(destination, 0, 0);
    pushHistory();
    setSelection({ ...selection, x: selection.x + moveDelta.x, y: selection.y + moveDelta.y });
    setMoveDelta({ x: 0, y: 0 });
  }, [height, moveDelta, pushHistory, selection, width]);

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const pan = event.button === 2 || event.button === 1 || (event.button === 0 && event.altKey);
    const point = clientToPixel(event.clientX, event.clientY);
    if (pan) {
      pointerRef.current = {
        mode: 'pan', pointerId: event.pointerId, start: point ?? { x: 0, y: 0 }, last: point ?? { x: 0, y: 0 },
        panStart: { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y },
      };
      setIsPanning(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0 || !point) return;

    if (tool === 'eyedropper') {
      const image = readImage();
      if (!image) return;
      const index = (point.y * width + point.x) * 4;
      setBrushColor(`#${[image.data[index], image.data[index + 1], image.data[index + 2]].map((value) => value.toString(16).padStart(2, '0')).join('')}`);
      setTool('brush');
      return;
    }
    if (tool === 'superEraser') {
      superErase(point);
      return;
    }
    if (tool === 'selectMove') {
      const moving = selection && pointInSelection(point, selection);
      pointerRef.current = { mode: moving ? 'move' : 'marquee', pointerId: event.pointerId, start: point, last: point };
      if (!moving) {
        setSelection(null);
        setMarquee({ start: point, end: point });
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    pointerRef.current = { mode: 'draw', pointerId: event.pointerId, start: point, last: point };
    drawLine(point, point, tool === 'eraser');
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
    const point = clientToPixel(event.clientX, event.clientY, true);
    if (!point) return;
    if (pointer.mode === 'draw') drawLine(pointer.last, point, tool === 'eraser');
    if (pointer.mode === 'marquee') setMarquee({ start: pointer.start, end: point });
    if (pointer.mode === 'move' && selection) {
      setMoveDelta({
        x: clamp(point.x - pointer.start.x, -selection.x, width - selection.x - selection.w),
        y: clamp(point.y - pointer.start.y, -selection.y, height - selection.y - selection.h),
      });
    }
    pointer.last = point;
  };

  const finishPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    if (pointer.mode === 'draw') pushHistory();
    if (pointer.mode === 'marquee') {
      const next = normalizedSelection(pointer.start, pointer.last);
      setSelection(next);
      setMarquee(null);
    }
    if (pointer.mode === 'move') finishMove();
    pointerRef.current = null;
    setIsPanning(false);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* pointer capture already released */ }
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
    const current = historyRef.current.pop()!;
    redoRef.current.push(current);
    writeImage(cloneImageData(historyRef.current[historyRef.current.length - 1]!));
    syncHistoryCount();
  };

  const reset = () => {
    if (!initialRef.current) return;
    writeImage(cloneImageData(initialRef.current));
    pushHistory();
    setSelection(null);
  };

  const apply = async () => {
    const canvas = imageRef.current;
    const image = readImage();
    if (!canvas || !image) return;
    setBusy(true);
    try {
      await onApply(hasOpaquePixel(image) ? await canvasToBlob(canvas) : null);
    } finally {
      setBusy(false);
    }
  };

  const cursor = isPanning ? 'grabbing' : tool === 'selectMove' ? (selection ? 'move' : 'crosshair') : tool === 'eyedropper' ? 'copy' : 'crosshair';

  return (
    <div className="fine-editor" aria-label={`${tileKey} ${layerLabel}像素精修`} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
      <header className="fine-editor-toolbar">
        <div className="fine-editor-title"><strong>像素精修</strong><span>{tileKey} · 正在编辑：{layerLabel}</span></div>
        <div className="fine-editor-tools">
          <Button size="sm" variant={tool === 'brush' ? 'default' : 'outline'} onClick={() => setTool('brush')}><Paintbrush /> 画笔</Button>
          <Button size="sm" variant={tool === 'eraser' ? 'default' : 'outline'} onClick={() => setTool('eraser')}><Eraser /> 橡皮擦</Button>
          <Button size="sm" variant={tool === 'eyedropper' ? 'default' : 'outline'} onClick={() => setTool('eyedropper')}><Eye /> 吸色</Button>
          <Button size="sm" variant={tool === 'superEraser' ? 'default' : 'outline'} onClick={() => setTool('superEraser')}><Sparkles /> 超级橡皮擦</Button>
          <Button size="sm" variant={tool === 'selectMove' ? 'default' : 'outline'} onClick={() => setTool('selectMove')}><Move /> 框选移动</Button>
        </div>
        {tool === 'brush' && <label className="fine-editor-color"><span>画笔颜色</span><input type="color" value={brushColor} onChange={(event) => setBrushColor(event.target.value)} /></label>}
        {tool === 'brush' && <label className="fine-editor-slider"><span>画笔 {brushSize}px</span><Slider min={1} max={32} step={1} value={[brushSize]} onValueChange={(value) => setBrushSize(sliderNumber(value, 4))} /></label>}
        {tool === 'eraser' && <label className="fine-editor-slider"><span>橡皮 {eraserSize}px</span><Slider min={1} max={64} step={1} value={[eraserSize]} onValueChange={(value) => setEraserSize(sliderNumber(value, 8))} /></label>}
        {tool === 'superEraser' && <label className="fine-editor-slider"><span>容差 {tolerance}</span><Slider min={1} max={100} step={1} value={[tolerance]} onValueChange={(value) => setTolerance(sliderNumber(value, 30))} /></label>}
        <div className="fine-editor-actions">
          <Button size="sm" variant={backgroundEnabled ? 'default' : 'outline'} onClick={() => setBackgroundEnabled((value) => !value)}>透明区背景</Button>
          <input aria-label="透明区背景颜色" type="color" value={backgroundColor} disabled={!backgroundEnabled} onChange={(event) => setBackgroundColor(event.target.value)} />
          <Button size="sm" variant="outline" disabled={!historyCount.undo || busy} onClick={undo}><Undo2 /> 撤销</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={reset}><RotateCcw /> 恢复原图</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}><X /> 取消</Button>
          <Button size="sm" disabled={busy} onClick={() => void apply()}><Check /> 保存当前层</Button>
        </div>
      </header>
      <div className="fine-editor-notice">画笔只修改“{layerLabel}”的实际像素，不会修改其他图层。右键 / 中键 / Alt+左键平移，滚轮缩放。</div>
      <div ref={wrapRef} className="fine-editor-canvas-wrap">
        <canvas
          ref={displayRef}
          aria-label={`${layerLabel}绘制画布`}
          style={{ cursor }}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
        />
        {!ready && <div className="fine-editor-loading">正在载入{layerLabel}…</div>}
        <div className="fine-editor-zoom">{Math.round(scale * 100)}%</div>
      </div>
    </div>
  );
}
