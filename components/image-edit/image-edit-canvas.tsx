'use client';
/* oxlint-disable next/no-img-element -- Context layers display exact existing blob/data sources at explicit source geometry. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { screenToPixel } from '@/features/image-edit/core.mjs';
import type { PixelPoint } from '@/features/image-edit/core.mjs';
import type { PixelController } from '@/features/image-edit/pixel-controller.mjs';
import type { ImageEditContextLayer } from '@/features/image-edit/client';

export type ImagePixelTool = 'pencil' | 'eraser' | 'mask-add' | 'mask-erase' | 'rectangle' | 'connected' | 'picker' | 'pan';
export type ImageViewMode = 'candidate' | 'source' | 'diff';
interface Props {
  controller: PixelController; version: number; tool: ImagePixelTool; color: string; alpha: number; brushSize: number;
  display: ImageViewMode; disabled: boolean; tolerance: number; contextLayers: ImageEditContextLayer[]; showContext: boolean;
  onChange: () => void; onColor: (color: string, alpha: number) => void; onError: (message: string) => void;
}
type Gesture = { kind: 'pan'; x: number; y: number; panX: number; panY: number } | { kind: 'rectangle'; start: PixelPoint; last: PixelPoint } | { kind: 'paint' } | { kind: 'mask' };

export function ImageEditCanvas({ controller, version, tool, color, alpha, brushSize, display, disabled, tolerance, contextLayers, showContext, onChange, onColor, onError }: Props) {
  const viewport = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), selectionCanvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<ImageData | null>(null), gesture = useRef<Gesture | null>(null);
  const maskFrame = useRef<ImageData | null>(null);
  const [view, setView] = useState({ zoom: 1, panX: 24, panY: 24 });
  const [grid, setGrid] = useState(false), [selectionVisible, setSelectionVisible] = useState(true), [background, setBackground] = useState('checker');
  const [selectionPreview, setSelectionPreview] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const imageWidth = controller.width, imageHeight = controller.height;
  const fit = useCallback(() => {
    const box = viewport.current?.getBoundingClientRect(); if (!box) return;
    const zoom = Math.max(0.02, Math.min(32, (box.width - 48) / controller.width, (box.height - 48) / controller.height));
    setView({ zoom, panX: (box.width - controller.width * zoom) / 2, panY: (box.height - controller.height * zoom) / 2 });
  }, [controller]);
  useEffect(() => {
    const initializeView = () => {
      const box = viewport.current?.getBoundingClientRect(); if (!box) return;
      const zoom = Math.max(0.02, Math.min(32, (box.width - 48) / imageWidth, (box.height - 48) / imageHeight));
      setView({ zoom, panX: (box.width - imageWidth * zoom) / 2, panY: (box.height - imageHeight * zoom) / 2 });
    };
    // Candidate/status changes can resize the footer. Preserve the user's view;
    // only a new image size or an explicit Fit action initializes it again.
    const pending = requestAnimationFrame(initializeView);
    return () => cancelAnimationFrame(pending);
  }, [imageWidth, imageHeight]);
  const zoomTo = useCallback((value: number, anchor?: { x: number; y: number }) => {
    const box = viewport.current?.getBoundingClientRect(); if (!box) return;
    setView(old => {
      const zoom = Math.max(0.02, Math.min(32, value)), point = anchor || { x: box.width / 2, y: box.height / 2 };
      return { zoom, panX: point.x - (point.x - old.panX) * zoom / old.zoom, panY: point.y - (point.y - old.panY) * zoom / old.zoom };
    });
  }, []);
  useEffect(() => {
    const element = viewport.current; if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2;
      setView(old => {
        const zoom = Math.max(0.02, Math.min(32, old.zoom * factor)), x = event.clientX - box.left, y = event.clientY - box.top;
        return { zoom, panX: x - (x - old.panX) * zoom / old.zoom, panY: y - (y - old.panY) * zoom / old.zoom };
      });
    };
    element.addEventListener('wheel', wheel, { passive: false }); return () => element.removeEventListener('wheel', wheel);
  }, []);
  useEffect(() => {
    const element = canvas.current, context = element?.getContext('2d'); if (!element || !context) return;
    element.width = controller.width; element.height = controller.height;
    const data = new ImageData(new Uint8ClampedArray(display === 'source' ? controller.sourcePixels : controller.pixels), controller.width, controller.height);
    if (display === 'diff') paintDiff(data, controller, 0, 0, controller.width, controller.height);
    frame.current = data; context.putImageData(data, 0, 0); controller.takeDirtyBounds();
  }, [controller, display]);
  useEffect(() => {
    const data = frame.current, context = canvas.current?.getContext('2d'), dirty = controller.takeDirtyBounds();
    if (!data || !context || !dirty || display === 'source') return;
    if (display === 'diff') paintDiff(data, controller, dirty.x, dirty.y, dirty.width, dirty.height);
    else for (let y = dirty.y; y < dirty.y + dirty.height; y++) {
      const start = (y * controller.width + dirty.x) * 4;
      data.data.set(controller.pixels.subarray(start, start + dirty.width * 4), start);
    }
    context.putImageData(data, 0, 0, dirty.x, dirty.y, dirty.width, dirty.height);
  }, [controller, version, display]);
  useEffect(() => {
    const element = selectionCanvas.current, context = element?.getContext('2d'); if (!element || !context) return;
    element.width = controller.width; element.height = controller.height;
    const data = new ImageData(controller.width, controller.height); maskFrame.current = data;
    for (let index = 0; index < controller.mask.length; index++) data.data[index * 4 + 3] = controller.mask[index] ? 0 : 112;
    context.putImageData(data, 0, 0); controller.takeMaskDirtyBounds();
  }, [controller, showContext]);
  useEffect(() => {
    const data = maskFrame.current, context = selectionCanvas.current?.getContext('2d'), dirty = controller.takeMaskDirtyBounds();
    if (!data || !context || !dirty) return;
    for (let y = dirty.y; y < dirty.y + dirty.height; y++) for (let x = dirty.x; x < dirty.x + dirty.width; x++) {
      const index = y * controller.width + x; data.data[index * 4 + 3] = controller.mask[index] ? 0 : 112;
    }
    context.putImageData(data, 0, 0, dirty.x, dirty.y, dirty.width, dirty.height);
  }, [controller, controller.maskRevision, version]);
  const pixel = (event: React.PointerEvent) => {
    const box = viewport.current?.getBoundingClientRect(); if (!box) return null;
    return screenToPixel({ screenX: event.clientX, screenY: event.clientY, originX: box.left + view.panX, originY: box.top + view.panY, zoom: view.zoom, width: controller.width, height: controller.height });
  };
  const paint = (point: PixelPoint) => {
    if (tool === 'mask-add' || tool === 'mask-erase') { controller.maskStroke(point, tool === 'mask-add' ? 'add' : 'erase', brushSize); onChange(); return; }
    const rgba = [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16), alpha];
    controller.stroke(point, tool === 'eraser' ? 'eraser' : 'pencil', rgba, brushSize); onChange();
  };
  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault(); canvas.current?.focus();
    const point = pixel(event);
    if (tool === 'pan' || event.button === 1) gesture.current = { kind: 'pan', x: event.clientX, y: event.clientY, panX: view.panX, panY: view.panY };
    else {
      if (disabled || display !== 'candidate' || showContext || !point) return;
      try {
        if (tool === 'picker') {
          const offset = (point.y * controller.width + point.x) * 4;
          onColor(`#${Array.from(controller.pixels.subarray(offset, offset + 3), byte => byte.toString(16).padStart(2, '0')).join('')}`, controller.pixels[offset + 3]); return;
        }
        if (tool === 'connected') { controller.selectRegion({ type: 'connected-color', ...point, tolerance }); onChange(); return; }
        if (tool === 'rectangle') { gesture.current = { kind: 'rectangle', start: point, last: point }; setSelectionPreview({ ...point, width: 1, height: 1 }); }
        else if (tool === 'mask-add' || tool === 'mask-erase') { controller.beginMaskStroke(); gesture.current = { kind: 'mask' }; paint(point); }
        else { controller.beginStroke(); gesture.current = { kind: 'paint' }; paint(point); }
      } catch (error) { gesture.current = null; controller.cancelStroke(); controller.cancelMaskStroke(); onChange(); onError(error instanceof Error ? error.message : '画布操作失败。'); return; }
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = gesture.current; if (!active) return;
    if (active.kind === 'pan') { setView(old => ({ ...old, panX: active.panX + event.clientX - active.x, panY: active.panY + event.clientY - active.y })); return; }
    const point = pixel(event); if (!point) return;
    try {
      if (active.kind === 'paint' || active.kind === 'mask') paint(point);
      else { active.last = point; setSelectionPreview({ x: Math.min(active.start.x, point.x), y: Math.min(active.start.y, point.y), width: Math.abs(point.x - active.start.x) + 1, height: Math.abs(point.y - active.start.y) + 1 }); }
    } catch (error) { gesture.current = null; controller.cancelStroke(); controller.cancelMaskStroke(); onChange(); onError(error instanceof Error ? error.message : '这一笔未写入。'); }
  };
  const finishPointer = (event: React.PointerEvent<HTMLDivElement>, cancel = false) => {
    const active = gesture.current; gesture.current = null; setSelectionPreview(null);
    try {
      if (active?.kind === 'paint') { if (cancel) controller.cancelStroke(); else controller.endStroke(); onChange(); }
      if (active?.kind === 'mask') { if (cancel) controller.cancelMaskStroke(); else controller.endMaskStroke(); onChange(); }
      if (active?.kind === 'rectangle' && !cancel) { controller.selectRectangle(active.start, active.last); onChange(); }
    } catch (error) { onChange(); onError(error instanceof Error ? error.message : '选区未改变。'); }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div className="ie-canvas-area">
    <div className="ie-viewbar">
      <Button size="sm" variant="outline" onClick={fit}>适配</Button>
      <Button size="sm" variant="outline" onClick={() => zoomTo(1)}>100%</Button>
      <Button size="sm" variant="ghost" aria-label="缩小" onClick={() => zoomTo(view.zoom / 1.5)}>−</Button>
      <output aria-label="当前缩放">{Math.round(view.zoom * 100)}%</output>
      <Button size="sm" variant="ghost" aria-label="放大" onClick={() => zoomTo(view.zoom * 1.5)}>+</Button>
      <label><input type="checkbox" checked={grid} onChange={event => setGrid(event.target.checked)} />网格</label>
      <label><input type="checkbox" checked={selectionVisible} onChange={event => setSelectionVisible(event.target.checked)} />选区</label>
      <select aria-label="画布底色" value={background} onChange={event => setBackground(event.target.value)}><option value="checker">棋盘格</option><option value="dark">深色</option><option value="light">浅色</option></select>
    </div>
    <div ref={viewport} className={`ie-viewport ie-bg-${background} ${tool === 'pan' ? 'ie-pan' : ''}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={event => finishPointer(event)} onPointerCancel={event => finishPointer(event, true)}>
      <div className="ie-world" style={{ width: controller.width, height: controller.height, transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}>
        {showContext && contextLayers.map((layer, index) => !layer.target && <img key={layer.id || index} src={layer.url} alt="只读上下文图层" width={layer.width} height={layer.height} draggable={false} style={{ position: 'absolute', left: layer.x || 0, top: layer.y || 0, width: layer.width, height: layer.height, opacity: layer.opacity ?? 1, zIndex: index }} />)}
        <canvas ref={canvas} className="ie-image" tabIndex={0} aria-label="图片像素画布" style={showContext ? { left: contextLayers.find(layer => layer.target)?.x || 0, top: contextLayers.find(layer => layer.target)?.y || 0, width: contextLayers.find(layer => layer.target)?.width || controller.width, height: contextLayers.find(layer => layer.target)?.height || controller.height, zIndex: Math.max(0, contextLayers.findIndex(layer => layer.target)) } : undefined} />
        <canvas ref={selectionCanvas} className="ie-selection" aria-label="可编辑区域显示层" style={{ visibility: !showContext && selectionVisible ? 'visible' : 'hidden' }} />
        {grid && view.zoom >= 8 && !showContext && <div className="ie-grid" />}
        {selectionPreview && <div className="ie-drag-selection" style={{ left: selectionPreview.x, top: selectionPreview.y, width: selectionPreview.width, height: selectionPreview.height, borderWidth: 1 / view.zoom }} />}
      </div>
    </div>
    <p className="ie-hint">滚轮缩放 · 平移工具或中键拖动 · {showContext ? '上下文只读，不进入图片输出' : display === 'candidate' ? '暗色区域受保护；坐标对应原图像素' : '对比只读'} · {controller.width} × {controller.height}</p>
  </div>;
}

function paintDiff(data: ImageData, controller: PixelController, x: number, y: number, width: number, height: number) {
  for (let row = y; row < y + height; row++) for (let column = x; column < x + width; column++) {
    const offset = (row * controller.width + column) * 4;
    const changed = [0, 1, 2, 3].some(channel => controller.pixels[offset + channel] !== controller.sourcePixels[offset + channel]);
    if (changed) data.data.set([255, 60, 155, 255], offset);
    else { data.data.set(controller.sourcePixels.subarray(offset, offset + 4), offset); data.data[offset + 3] = Math.round(controller.sourcePixels[offset + 3] * 0.3); }
  }
}
