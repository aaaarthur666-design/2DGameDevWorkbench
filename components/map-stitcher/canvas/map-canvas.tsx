'use client';
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import { Hand, Maximize, Minus, Plus, Upload, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  RegionDrawingOverlay,
  type RegionDrawingHandle,
} from '../region-drawing-overlay';
import type { MapEditorController } from '../use-map-editor-controller';
import {
  type FrameRoninTile,
  type MapDisplayLayer,
  type RegionShape,
} from '@/features/map-stitcher/frame-ronin-types';
import {
  IMAGE_VIEW_LABELS,
  isTypingTarget,
  regionsInScope,
  tileRenderKey,
} from '@/features/map-stitcher/editor-selectors';
import {
  frameRoninBounds,
  tilePixelSize,
} from '@/features/map-stitcher/frame-ronin-geometry';
import { renderFrameRoninTile } from '@/features/map-stitcher/layer-engine';
import { renderExportPreview } from '@/features/map-stitcher/map-production';
import { canvasToBlob } from '@/features/map-stitcher/image-utils';
import { clamp } from '@/features/map-stitcher/map-types';

const TILE_WIDTH = 360;
function tileStyle(tile: FrameRoninTile, height: number): CSSProperties {
  return {
    left: (tile.x - 0.5) * TILE_WIDTH,
    top: (tile.y - 0.5) * height,
    width: tile.w * TILE_WIDTH,
    height: tile.h * height,
  };
}
function featherStyle(tile: FrameRoninTile): CSSProperties {
  const { top, right, bottom, left } = tile.feather;
  if (![top, right, bottom, left].some(Boolean)) return {};
  const vertical = `linear-gradient(to bottom, ${top ? `transparent 0%, black ${top}%` : 'black 0%'}, ${bottom ? `black ${100 - bottom}%, transparent 100%` : 'black 100%'})`;
  const horizontal = `linear-gradient(to right, ${left ? `transparent 0%, black ${left}%` : 'black 0%'}, ${right ? `black ${100 - right}%, transparent 100%` : 'black 100%'})`;
  return {
    maskImage: `${vertical}, ${horizontal}`,
    maskComposite: 'intersect',
    WebkitMaskImage: `${vertical}, ${horizontal}`,
    WebkitMaskComposite: 'source-in',
  };
}

function TileImage({
  tile,
  layer,
  shapes,
  sourceWidth,
  sourceHeight,
}: {
  tile: FrameRoninTile;
  layer: MapDisplayLayer;
  shapes: RegionShape[];
  sourceWidth: number;
  sourceHeight: number;
}) {
  const key = tileRenderKey(tile, layer, shapes, sourceWidth, sourceHeight);
  const [rendered, setRendered] = useState<{
    key: string;
    url?: string;
    error?: string;
  } | null>(null);
  const processed = layer === 'object' || layer === 'mask';
  const available =
    layer === 'mask'
      ? Boolean(tile.images.overall && tile.images.object)
      : Boolean(tile.images[layer]);
  const renderCurrent = useEffectEvent(() =>
    renderFrameRoninTile(tile, layer, shapes, sourceWidth, sourceHeight),
  );
  useEffect(() => {
    if (!processed || !available) return;
    let cancelled = false;
    let ownedUrl: string | undefined;
    void renderCurrent()
      .then(canvasToBlob)
      .then((blob) => {
        if (cancelled) return;
        ownedUrl = URL.createObjectURL(blob);
        setRendered({ key, url: ownedUrl });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setRendered({
            key,
            error: error instanceof Error ? error.message : '预览失败',
          });
      });
    return () => {
      cancelled = true;
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
    };
  }, [key, processed, available]);
  const url = processed
    ? rendered?.key === key
      ? rendered.url
      : undefined
    : tile.images[layer]?.url;
  if (!available) return null;
  if (!url)
    return (
      <span className="map-render-status">
        {rendered?.key === key && rendered.error
          ? rendered.error
          : '预览处理中…'}
      </span>
    );
  // The URLs are local Blob assets and intentionally bypass image optimization.
  // eslint-disable-next-line next/no-img-element
  return <img src={url} alt="" draggable={false} style={featherStyle(tile)} />;
}

function ExportPreview({
  c,
  height,
}: {
  c: MapEditorController;
  height: number;
}) {
  const [result, setResult] = useState<{
    revision: number;
    url?: string;
    error?: string;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const { tiles, shapes, sourceAsset, revision } = c;
  useEffect(() => {
    if (!sourceAsset) return;
    let cancelled = false;
    let owned: string | undefined;
    void renderExportPreview(
      tiles,
      shapes,
      sourceAsset.width,
      sourceAsset.height,
    )
      .then(async (rendered) => {
        const blob = await canvasToBlob(rendered.canvas);
        if (cancelled) return;
        owned = URL.createObjectURL(blob);
        setResult({
          revision,
          url: owned,
          x: rendered.originX / sourceAsset.width,
          y: rendered.originY / sourceAsset.height,
          width: rendered.width / sourceAsset.width,
          height: rendered.height / sourceAsset.height,
        });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setResult({
            revision,
            error: error instanceof Error ? error.message : '预览失败',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          });
      });
    return () => {
      cancelled = true;
      if (owned) URL.revokeObjectURL(owned);
    };
  }, [revision, tiles, shapes, sourceAsset]);
  if (result?.revision !== c.revision || !result.url)
    return (
      <span className="map-render-status">
        {result?.error ?? '正在合成导出效果…'}
      </span>
    );
  return (
    // eslint-disable-next-line next/no-img-element
    <img
      className="map-export-composite"
      src={result.url}
      alt="Godot 导出效果预览"
      style={{
        left: (result.x - 0.5) * TILE_WIDTH,
        top: (result.y - 0.5) * height,
        width: result.width * TILE_WIDTH,
        height: result.height * height,
      }}
      draggable={false}
    />
  );
}

export function MapCanvas({
  c,
  disabled,
  onImport,
  onGenerate,
}: {
  c: MapEditorController;
  disabled: boolean;
  onImport: () => void;
  onGenerate: () => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<RegionDrawingHandle>(null);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    pan: { x: number; y: number };
  } | null>(null);
  const [space, setSpace] = useState(false);
  const spaceRef = useRef(false);
  const [panning, setPanning] = useState(false);
  const [draftStatus, setDraftStatus] = useState({ session: '', count: 0 });
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const height =
    TILE_WIDTH *
    (c.sourceAsset ? c.sourceAsset.height / c.sourceAsset.width : 1);
  const activeSession = `${c.session}:${c.mode}:${c.selectedKey}:${c.activeMapLayer}:${c.activeRegionLayer}:${c.regionTool}:${c.preferences.showRegions}`;
  const draftCount =
    draftStatus.session === activeSession ? draftStatus.count : 0;
  const fit = () => {
    const canvas = canvasRef.current;
    if (!canvas || !c.tiles.length) return;
    const bounds = frameRoninBounds(c.tiles);
    const nextZoom = clamp(
      Math.min(
        (canvas.clientWidth - 90) / ((bounds.maxX - bounds.minX) * TILE_WIDTH),
        (canvas.clientHeight - 90) / ((bounds.maxY - bounds.minY) * height),
        1,
      ),
      0.05,
      8,
    );
    c.setZoom(nextZoom);
    c.setPan({
      x: (-(bounds.minX + bounds.maxX - 1) / 2) * TILE_WIDTH * nextZoom,
      y: (-(bounds.minY + bounds.maxY - 1) / 2) * height * nextZoom,
    });
  };
  const fitOnRequest = useEffectEvent(fit);
  // The stage is anchored at 50% / 50% of this persistent canvas. Resizing the
  // inspector or toggling focus mode keeps pan/zoom and the center map point;
  // fitting is an explicit command, never a ResizeObserver side effect.
  useEffect(() => {
    const frame = requestAnimationFrame(() => fitOnRequest());
    return () => cancelAnimationFrame(frame);
  }, [c.fitRequest]);
  const stopPan = () => {
    const active = drag.current;
    drag.current = null;
    if (active && canvasRef.current?.hasPointerCapture(active.id))
      canvasRef.current.releasePointerCapture(active.id);
    setPanning(false);
  };
  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (
        disabled ||
        isTypingTarget(event.target) ||
        !canvasRef.current
          ?.closest('[data-map-editor]')
          ?.contains(event.target as Node)
      )
        return;
      if (
        event.code === 'Space' &&
        !(event.target instanceof Element && event.target.closest('button'))
      ) {
        event.preventDefault();
        spaceRef.current = true;
        setSpace(true);
        if (c.regionTool === 'free') draftRef.current?.cancel();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) c.redo();
        else if (!draftRef.current?.undoPoint()) c.undo();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (draftRef.current?.cancel()) c.setHint('已取消当前草稿。');
        else if (c.selectedShapeId) c.selectRegion(null);
        else {
          c.setMode('navigate');
          c.resetSession();
        }
        return;
      }
      if (
        (event.key === 'Enter' || event.key.toLowerCase() === 'c') &&
        draftCount &&
        c.mode === 'region'
      ) {
        event.preventDefault();
        draftRef.current?.finish();
        return;
      }
      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        c.mode === 'region'
      ) {
        event.preventDefault();
        if (!draftRef.current?.undoPoint() && c.selectedShapeId)
          c.perform(() => c.deleteRegion(c.selectedShapeId!));
        return;
      }
      if (event.key === '0') fit();
      if (event.key.toLowerCase() === 'h') c.setHideCards((value) => !value);
      if (event.key === '+' || event.key === '=')
        c.setZoom((value) => clamp(value * 1.15, 0.05, 8));
      if (event.key === '-') c.setZoom((value) => clamp(value / 1.15, 0.05, 8));
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spaceRef.current = false;
        setSpace(false);
      }
    };
    const blur = () => {
      spaceRef.current = false;
      setSpace(false);
      stopPan();
      draftRef.current?.cancel();
    };
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', blur);
    };
  });
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (
      disabled ||
      (event.target instanceof Element &&
        event.target.closest('[data-canvas-control]'))
    )
      return;
    const shouldPan =
      c.panMode || spaceRef.current || event.button === 1 || event.button === 2;
    if (shouldPan) {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        pan: c.pan,
      };
      setPanning(true);
    } else if (
      !(event.target instanceof Element && event.target.closest('button'))
    )
      event.currentTarget.focus({ preventScroll: true });
  };
  const wheel = (event: WheelEvent<HTMLDivElement>) => {
    if (
      disabled ||
      (event.target instanceof Element &&
        event.target.closest('[data-canvas-control]'))
    )
      return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2,
      y = event.clientY - rect.top - rect.height / 2;
    const zoom = clamp(c.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), 0.05, 8);
    c.setPan({
      x: x - ((x - c.pan.x) / c.zoom) * zoom,
      y: y - ((y - c.pan.y) / c.zoom) * zoom,
    });
    c.setZoom(zoom);
  };
  // A coordinate editor needs its own keyboard focus; named controls are exposed alongside it.
  /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
  return (
    <div
      ref={canvasRef}
      className={`map-canvas ${panning ? 'panning' : c.panMode || space ? 'pan-ready' : ''}`}
      tabIndex={0}
      role="application"
      aria-label="地图画布"
      data-map-canvas
      onPointerDownCapture={pointerDown}
      onPointerMove={(event) => {
        if (drag.current?.id === event.pointerId)
          c.setPan({
            x: drag.current.pan.x + event.clientX - drag.current.x,
            y: drag.current.pan.y + event.clientY - drag.current.y,
          });
        if (c.sourceAsset) {
          const rect = event.currentTarget.getBoundingClientRect();
          setCursor({
            x: Math.round(
              ((event.clientX - rect.left - rect.width / 2 - c.pan.x) /
                c.zoom /
                TILE_WIDTH +
                0.5) *
                c.sourceAsset.width,
            ),
            y: Math.round(
              ((event.clientY - rect.top - rect.height / 2 - c.pan.y) /
                c.zoom /
                height +
                0.5) *
                c.sourceAsset.height,
            ),
          });
        }
      }}
      onPointerLeave={() => setCursor(null)}
      onPointerUp={() => stopPan()}
      onPointerCancel={() => {
        stopPan();
        draftRef.current?.cancel();
      }}
      onLostPointerCapture={() => {
        if (drag.current) stopPan();
      }}
      onWheel={wheel}
      onContextMenu={(event) => event.preventDefault()}
      onDragOver={(event) => {
        event.preventDefault();
        const key =
          (event.target as Element)
            .closest('[data-tile-key]')
            ?.getAttribute('data-tile-key') ?? c.selectedKey;
        setDropTarget(key ?? 'new');
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setDropTarget(null);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDropTarget(null);
        if (disabled) return;
        const files = Array.from(event.dataTransfer.files).filter((file) =>
          file.type.startsWith('image/'),
        );
        const target =
          (event.target as Element)
            .closest('[data-tile-key]')
            ?.getAttribute('data-tile-key') ?? c.selectedKey;
        c.perform(() =>
          c.tiles.length
            ? c.uploadToLayer(files, target)
            : c.importImages(files),
        );
      }}
    >
      {c.tiles.length > 0 ? (
        <div
          className="map-stage"
          style={{
            transform: `translate(${c.pan.x}px, ${c.pan.y}px) scale(${c.zoom})`,
          }}
        >
          <div className="map-image-plane" aria-hidden="true">
            {c.exportPreview ? (
              <ExportPreview c={c} height={height} />
            ) : (
              c.preferences.showImage &&
              c.tiles.map(
                (tile) =>
                  !tile.hidden && (
                    <div
                      className="map-tile-image"
                      key={tile.key}
                      style={tileStyle(tile, height)}
                    >
                      <TileImage
                        tile={tile}
                        layer={c.activeMapLayer}
                        shapes={c.shapes}
                        sourceWidth={c.sourceAsset!.width}
                        sourceHeight={c.sourceAsset!.height}
                      />
                    </div>
                  ),
              )
            )}
          </div>
          <div className="map-interaction-plane">
            {c.tiles.map((tile) => {
              const selected = tile.key === c.selectedKey;
              const size = c.sourceAsset
                ? tilePixelSize(tile, c.sourceAsset.width, c.sourceAsset.height)
                : { width: 1, height: 1 };
              const visible = c.preferences.showRegions
                ? regionsInScope(c.shapes, {
                    tileKey: tile.key,
                    mapLayer: c.activeMapLayer,
                    scope: c.preferences.regionScope,
                    visibility: c.regionVisibility,
                  })
                : [];
              return (
                <fieldset
                  key={tile.key}
                  data-tile-key={tile.key}
                  className={`map-tile-target ${selected ? 'selected' : ''} ${tile.hidden ? 'excluded' : ''} ${c.hideBorders ? 'borderless' : ''}`}
                  style={tileStyle(tile, height)}
                  aria-label={`地图块 ${tile.key}`}
                  onPointerDown={(event) => {
                    if (
                      event.button === 0 &&
                      !disabled &&
                      !(c.mode === 'region' && selected)
                    ) {
                      event.stopPropagation();
                      c.perform(() => c.selectTile(tile.key));
                    }
                  }}
                >
                  {!c.hideCards && (
                    <button
                      data-canvas-control
                      type="button"
                      className="map-tile-label"
                      onClick={() => c.perform(() => c.selectTile(tile.key))}
                    >
                      {tile.key === '0,0' ? '中心地图' : tile.key}
                      {tile.hidden ? ' · 已排除输出' : ''}
                    </button>
                  )}
                  {!tile.hidden && c.preferences.showRegions && (
                    <RegionDrawingOverlay
                      key={`${tile.key}:${activeSession}`}
                      ref={selected ? draftRef : undefined}
                      tileKey={tile.key}
                      width={size.width}
                      height={size.height}
                      shapes={visible}
                      activeMapLayer={c.activeMapLayer}
                      activeRegionLayer={c.activeRegionLayer}
                      tool={c.regionTool}
                      interactive={
                        !disabled &&
                        c.mode === 'region' &&
                        selected &&
                        c.regionVisibility[c.activeRegionLayer] &&
                        !c.exportPreview
                      }
                      locked={c.regionLocks[c.activeRegionLayer]}
                      suspended={space || c.panMode || panning}
                      selectedShapeId={c.selectedShapeId}
                      onSelectShape={(id) =>
                        c.perform(() => c.selectRegion(id))
                      }
                      onCreate={(shape) =>
                        c.perform(() => c.createRegions([shape]))
                      }
                      onDelete={(id) => c.perform(() => c.deleteRegion(id))}
                      onHint={c.setHint}
                      onDraftChange={
                        selected
                          ? (count) =>
                              setDraftStatus({ session: activeSession, count })
                          : () => undefined
                      }
                    />
                  )}
                </fieldset>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="map-empty">
          <Upload size={30} />
          <h2>从一张地图开始</h2>
          <p>生成一张原图或导入已有图片，确认中心图后继续向外扩展。</p>
          <Button disabled={disabled} onClick={onGenerate}>
            <Sparkles /> 生成地图原图
          </Button>
          <Button variant="outline" disabled={disabled} onClick={onImport}>
            <Upload />
            导入地图图片
          </Button>
        </div>
      )}
      <div className="map-canvas-controls" data-canvas-control>
        <Button
          variant={c.panMode ? 'default' : 'outline'}
          size="icon"
          aria-label="平移模式"
          aria-pressed={c.panMode}
          onClick={() => c.setPanMode((value) => !value)}
        >
          <Hand />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="适配画布"
          onClick={fit}
        >
          <Maximize />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="缩小"
          onClick={() => c.setZoom((value) => clamp(value / 1.15, 0.05, 8))}
        >
          <Minus />
        </Button>
        <span>{Math.round(c.zoom * 100)}%</span>
        <Button
          variant="outline"
          size="icon"
          aria-label="放大"
          onClick={() => c.setZoom((value) => clamp(value * 1.15, 0.05, 8))}
        >
          <Plus />
        </Button>
      </div>
      {draftCount > 0 && (
        <div className="map-draft-controls" data-canvas-control>
          <span>草稿 · {draftCount} 点</span>
          <Button
            size="sm"
            disabled={c.regionTool === 'free'}
            onClick={() => draftRef.current?.finish()}
          >
            完成区域
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => draftRef.current?.cancel()}
          >
            取消草稿
          </Button>
        </div>
      )}
      {dropTarget && (
        <div className="map-drop-hint">
          {dropTarget === 'new'
            ? '松开以新建地图'
            : `松开上传到 ${dropTarget} · ${IMAGE_VIEW_LABELS[c.activeMapLayer]}`}
        </div>
      )}
      {c.exportPreview && (
        <div className="map-preview-badge">导出效果预览 · 区域绘制已暂停</div>
      )}
      {cursor && (
        <div className="map-cursor-position">
          世界坐标 {cursor.x}, {cursor.y} px
        </div>
      )}
    </div>
  );
  /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
}
