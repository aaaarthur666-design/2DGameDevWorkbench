'use client';

import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent,
} from 'react';
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
  cleanRegionPoints,
  hitTestRegionShape,
  rectanglePoints,
  regionValidationError,
  shapeSvgPath,
} from '@/features/map-stitcher/region-engine';

export interface RegionDrawingHandle {
  cancel: () => boolean;
  undoPoint: () => boolean;
  finish: () => void;
}
interface Props {
  tileKey: string;
  width: number;
  height: number;
  shapes: RegionShape[];
  activeMapLayer: MapDisplayLayer;
  activeRegionLayer: RegionLayer;
  tool: RegionTool;
  interactive: boolean;
  locked: boolean;
  suspended: boolean;
  selectedShapeId: string | null;
  onSelectShape: (id: string | null) => void;
  onCreate: (shape: Omit<RegionShape, 'id'>) => void;
  onDelete: (id: string) => void;
  onHint: (message: string) => void;
  onDraftChange: (count: number) => void;
}

export const RegionDrawingOverlay = forwardRef<RegionDrawingHandle, Props>(
  function RegionDrawingOverlay(
    {
      tileKey,
      width,
      height,
      shapes,
      activeMapLayer,
      activeRegionLayer,
      tool,
      interactive,
      locked,
      suspended,
      selectedShapeId,
      onSelectShape,
      onCreate,
      onDelete,
      onHint,
      onDraftChange,
    },
    ref,
  ) {
    const svgRef = useRef<SVGSVGElement>(null);
    const pointerRef = useRef<number | null>(null);
    const draftRef = useRef<RegionPoint[]>([]);
    const [draft, setDraft] = useState<RegionPoint[]>([]);
    const [hover, setHover] = useState<RegionPoint | null>(null);
    const updateDraft = (points: RegionPoint[]) => {
      draftRef.current = points;
      setDraft(points);
      onDraftChange(points.length);
    };
    const releasePointer = () => {
      const id = pointerRef.current;
      pointerRef.current = null;
      if (id !== null && svgRef.current?.hasPointerCapture(id))
        svgRef.current.releasePointerCapture(id);
    };
    const cancel = () => {
      const hadDraft = draftRef.current.length > 0;
      releasePointer();
      updateDraft([]);
      setHover(null);
      return hadDraft;
    };
    const commit = (mode: RegionMode, input: RegionPoint[]) => {
      const points = cleanRegionPoints(input);
      const error = regionValidationError(mode, points);
      if (error) {
        onHint(error);
        return;
      }
      if (locked || !interactive) {
        onHint('目标区域类别已锁定或已离开编辑状态。');
        cancel();
        return;
      }
      onCreate({
        tileKey,
        mapLayer: activeMapLayer,
        layer: activeRegionLayer,
        mode,
        points,
      });
      cancel();
    };
    const finish = () => {
      if (tool === 'polygon' && draftRef.current.length)
        commit('polygon', draftRef.current);
      if (tool === 'rectangle' && draftRef.current.length && hover)
        commit('rectangle', rectanglePoints(draftRef.current[0], hover));
    };
    useImperativeHandle(ref, () => ({
      cancel,
      finish,
      undoPoint: () => {
        if (!draftRef.current.length) return false;
        if (tool === 'free') cancel();
        else updateDraft(draftRef.current.slice(0, -1));
        return true;
      },
    }));
    const eventPoint = (
      event: Pick<PointerEvent<SVGSVGElement>, 'clientX' | 'clientY'>,
    ) => {
      const rect = svgRef.current!.getBoundingClientRect();
      return clampRegionPoint(
        {
          x: ((event.clientX - rect.left) * width) / rect.width,
          y: ((event.clientY - rect.top) * height) / rect.height,
        },
        width,
        height,
      );
    };
    const pointerDown = (event: PointerEvent<SVGSVGElement>) => {
      if (!interactive || suspended || event.button !== 0 || !event.isPrimary)
        return;
      event.stopPropagation();
      event.preventDefault();
      const point = eventPoint(event);
      if (tool === 'select' || tool === 'delete') {
        const candidates = shapes.filter(
          (shape) =>
            shape.layer === activeRegionLayer &&
            shape.mapLayer === activeMapLayer,
        );
        const hit = shapeAtPoint(
          candidates,
          point,
          (7 * width) /
            Math.max(1, svgRef.current!.getBoundingClientRect().width),
        );
        if (hit && tool === 'delete') onDelete(hit.id);
        else onSelectShape(hit?.id ?? null);
        return;
      }
      if (locked) {
        onHint('当前区域类别已锁定。');
        return;
      }
      onSelectShape(null);
      if (tool === 'free') {
        pointerRef.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        updateDraft([point]);
        setHover(point);
      } else if (tool === 'rectangle') {
        if (!draftRef.current.length) {
          updateDraft([point]);
          setHover(point);
          onHint('已设置起点，再次点击确定矩形终点。');
        } else commit('rectangle', rectanglePoints(draftRef.current[0], point));
      } else if (tool === 'polygon') {
        if (event.detail > 1) return;
        updateDraft([...draftRef.current, point]);
        setHover(point);
        onHint('继续添加顶点，Enter / C 完成，Backspace 撤回顶点。');
      }
    };
    const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
      if (!interactive || suspended) return;
      const point = eventPoint(event);
      setHover(point);
      if (tool === 'free' && pointerRef.current === event.pointerId) {
        const previous = draftRef.current.at(-1);
        if (
          previous &&
          Math.hypot(point.x - previous.x, point.y - previous.y) < 2
        )
          return;
        if (draftRef.current.length < 2047)
          updateDraft([...draftRef.current, point]);
      }
    };
    const pointerUp = (event: PointerEvent<SVGSVGElement>) => {
      if (pointerRef.current !== event.pointerId) return;
      const points = [...draftRef.current, eventPoint(event)];
      releasePointer();
      if (suspended) {
        cancel();
        return;
      }
      commit('free', points);
    };
    const draftPoints =
      tool === 'rectangle' && hover && draft.length
        ? rectanglePoints(draft[0], hover)
        : tool === 'polygon' && hover
          ? [...draft, hover]
          : draft;
    const meta = REGION_LAYER_META[activeRegionLayer];
    return (
      // The SVG is a coordinate input surface; MapCanvas owns keyboard commands.
      // Region selection is also accessible through the inspector list; this surface accepts coordinate gestures.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
      <svg
        ref={svgRef}
        className={`map-region-overlay ${interactive && !suspended ? 'interactive' : ''}`}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="application"
        aria-label={`${tileKey} 区域标注`}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={() => cancel()}
        onLostPointerCapture={() => {
          if (pointerRef.current !== null) cancel();
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (!suspended) finish();
        }}
      >
        {shapes.map((shape) => {
          const style = REGION_LAYER_META[shape.layer];
          const reference =
            shape.mapLayer !== activeMapLayer ||
            shape.layer !== activeRegionLayer;
          return (
            <path
              key={shape.id}
              data-region-id={shape.id}
              data-selected={selectedShapeId === shape.id}
              d={shapeSvgPath(shape)}
              fill={style.fill}
              stroke={style.color}
              strokeWidth={selectedShapeId === shape.id ? 3 : 1.5}
              strokeDasharray={reference ? '4 4' : undefined}
              opacity={reference ? 0.45 : 1}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {draft.length > 0 && (
          <path
            data-region-draft="true"
            d={shapeSvgPath({ mode: tool as RegionMode, points: draftPoints })}
            fill={meta.fill}
            stroke={meta.color}
            strokeWidth={2}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {tool === 'polygon' &&
          draft.map((point, index) => (
            <circle
              key={index}
              cx={point.x}
              cy={point.y}
              r={width / 120}
              fill={meta.color}
            />
          ))}
      </svg>
    );
  },
);

export function shapeAtPoint(
  shapes: RegionShape[],
  point: RegionPoint,
  tolerance = 8,
) {
  return (
    [...shapes]
      .reverse()
      .find((shape) => hitTestRegionShape(shape, point, tolerance)) ?? null
  );
}
