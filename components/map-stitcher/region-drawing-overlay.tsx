'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  REGION_LAYER_META,
  type MapDisplayLayer,
  type RegionLayer,
  type RegionMode,
  type RegionPoint,
  type RegionShape,
  type RegionTool,
} from '@/features/map-stitcher/frame-ronin-types';
import {
  clampRegionPoint,
  hitTestRegionShape,
  rectanglePoints,
  regionShapeIsValid,
  shapeSvgPath,
} from '@/features/map-stitcher/region-engine';

interface RegionDrawingOverlayProps {
  tileKey: string;
  width: number;
  height: number;
  shapes: RegionShape[];
  activeMapLayer: MapDisplayLayer;
  activeRegionLayer: RegionLayer;
  tool: RegionTool;
  interactive: boolean;
  selectedShapeId: string | null;
  onSelectShape: (id: string | null) => void;
  onCreate: (shape: Omit<RegionShape, 'id'>) => void;
  onDelete: (id: string) => void;
  onHint?: (message: string) => void;
}

export function RegionDrawingOverlay({
  tileKey,
  width,
  height,
  shapes,
  activeMapLayer,
  activeRegionLayer,
  tool,
  interactive,
  selectedShapeId,
  onSelectShape,
  onCreate,
  onDelete,
  onHint,
}: RegionDrawingOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const freePointerRef = useRef<number | null>(null);
  const [draft, setDraft] = useState<RegionPoint[]>([]);
  const [hoverPoint, setHoverPoint] = useState<RegionPoint | null>(null);
  const visibleShapes = useMemo(
    () => shapes.filter((shape) => shape.tileKey === tileKey && shape.mapLayer === activeMapLayer),
    [activeMapLayer, shapes, tileKey],
  );

  const cancelDraft = useCallback(() => {
    freePointerRef.current = null;
    setDraft([]);
    setHoverPoint(null);
  }, []);

  const commit = useCallback((mode: RegionMode, points: RegionPoint[]) => {
    if (!regionShapeIsValid(mode, points)) {
      onHint?.('区域太小或点数不足，未创建标注。');
      cancelDraft();
      return;
    }
    onCreate({ tileKey, mapLayer: activeMapLayer, layer: activeRegionLayer, mode, points });
    cancelDraft();
  }, [activeMapLayer, activeRegionLayer, cancelDraft, onCreate, onHint, tileKey]);

  const finishPolygon = useCallback(() => {
    if (tool !== 'polygon' || !draft.length) return;
    commit('polygon', draft);
  }, [commit, draft, tool]);

  useEffect(() => {
    if (!interactive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancelDraft();
        return;
      }
      if ((event.key === 'c' || event.key === 'C' || event.key === 'Enter') && tool === 'polygon' && draft.length) {
        event.preventDefault();
        finishPolygon();
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && selectedShapeId) {
        event.preventDefault();
        onDelete(selectedShapeId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cancelDraft, draft.length, finishPolygon, interactive, onDelete, selectedShapeId, tool]);

  const eventPoint = useCallback((event: Pick<ReactPointerEvent<SVGSVGElement>, 'clientX' | 'clientY'>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return clampRegionPoint({
      x: (event.clientX - rect.left) * width / Math.max(1, rect.width),
      y: (event.clientY - rect.top) * height / Math.max(1, rect.height),
    }, width, height);
  }, [height, width]);

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!interactive) return;
    const point = eventPoint(event);
    onSelectShape(null);
    if (tool === 'free') {
      event.currentTarget.setPointerCapture(event.pointerId);
      freePointerRef.current = event.pointerId;
      setDraft([point]);
      return;
    }
    if (tool === 'rectangle') {
      if (!draft.length) {
        setDraft([point]);
        setHoverPoint(point);
        onHint?.('再次点击确定矩形终点。');
      } else {
        commit('rectangle', rectanglePoints(draft[0], point));
      }
      return;
    }
    if (tool === 'polygon') {
      setDraft((current) => [...current, point]);
      onHint?.('继续点击添加顶点，按 C 或 Enter 闭合。');
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!interactive) return;
    const point = eventPoint(event);
    setHoverPoint(point);
    if (tool === 'free' && freePointerRef.current === event.pointerId) {
      setDraft((current) => {
        const previous = current[current.length - 1];
        if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 2) return current;
        return [...current, point];
      });
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (tool !== 'free' || freePointerRef.current !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const points = [...draft, eventPoint(event)];
    freePointerRef.current = null;
    commit('free', points);
  };

  const draftShape = useMemo<RegionShape | null>(() => {
    if (!draft.length) return null;
    const points = tool === 'rectangle' && hoverPoint ? rectanglePoints(draft[0], hoverPoint) :
      tool === 'polygon' && hoverPoint ? [...draft, hoverPoint] : draft;
    if (tool !== 'rectangle' && tool !== 'polygon' && tool !== 'free') return null;
    return {
      id: '__draft__',
      tileKey,
      mapLayer: activeMapLayer,
      layer: activeRegionLayer,
      mode: tool,
      points,
    };
  }, [activeMapLayer, activeRegionLayer, draft, hoverPoint, tileKey, tool]);

  return (
    // SVG is the actual coordinate input surface; replacing it with a button would break pointer capture and viewBox mapping.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex
    <svg
      ref={svgRef}
      className={`region-drawing-overlay ${interactive ? 'interactive' : ''}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="application"
      aria-label={`${tileKey} 区域标注`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={() => finishPolygon()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {visibleShapes.map((shape) => {
        const meta = REGION_LAYER_META[shape.layer];
        const selected = shape.id === selectedShapeId;
        return (
          <path
            key={shape.id}
            d={shapeSvgPath(shape)}
            className={`region-shape region-${shape.layer} ${selected ? 'selected' : ''}`}
            fill={shape.mode === 'free' ? 'none' : meta.fill}
            stroke={meta.color}
            strokeWidth={selected ? 3 : shape.mode === 'free' ? 5 : 2}
            vectorEffect="non-scaling-stroke"
            onPointerDown={(event) => {
              if (!interactive || (tool !== 'select' && tool !== 'delete')) return;
              event.stopPropagation();
              if (tool === 'delete') onDelete(shape.id);
              else onSelectShape(shape.id);
            }}
          />
        );
      })}
      {draftShape && (
        <path
          d={shapeSvgPath(draftShape)}
          className="region-shape region-draft"
          fill={draftShape.mode === 'free' ? 'none' : REGION_LAYER_META[activeRegionLayer].fill}
          stroke={REGION_LAYER_META[activeRegionLayer].color}
          strokeWidth={draftShape.mode === 'free' ? 5 : 2}
          strokeDasharray="7 5"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {draftShape?.mode === 'polygon' && draft.map((point, index) => (
        <circle key={`${point.x}-${point.y}-${index}`} cx={point.x} cy={point.y} r={4} fill={REGION_LAYER_META[activeRegionLayer].color} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

export function shapeAtPoint(shapes: RegionShape[], point: RegionPoint) {
  return [...shapes].reverse().find((shape) => hitTestRegionShape(shape, point)) ?? null;
}
