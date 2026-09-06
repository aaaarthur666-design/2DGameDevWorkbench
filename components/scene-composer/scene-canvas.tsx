/* oxlint-disable react/react-compiler -- Pointer gesture refs drive transient canvas rendering. */
/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- This keyboard-operable SVG is an application canvas, not a static image. */
'use client';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { InteractionSimulation } from '@/features/interactable-editor/simulator.mjs';
import {
  instanceOrigin,
  materialFor,
  sceneBounds,
  type Scene,
  type Point,
} from '@/features/scene-composer/model.mjs';
import { ObjectArt, instanceRect } from './scene-art';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';

type Props = {
  scene: Scene;
  selected: string[];
  select: (ids: string[]) => void;
  edit: (fn: (s: Scene) => void, remember?: boolean) => void;
  duplicate: (offset?: number, ids?: string[]) => string[];
  drop: (id: string, p: Point) => void;
  arrange: (action: string, target?: string | number) => void;
  remove: () => void;
  replace: () => void;
  disabled: boolean;
  preview: boolean;
  sim: InteractionSimulation;
  time: number;
  targetMode: 'before' | 'after' | null;
  target: (id: string) => void;
  fit: number;
  notice: (text: string) => void;
};
export function SceneCanvas(p: Props) {
  const { scene, selected, preview, sim } = p;
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const canvas = svg.current;
    const preventScroll = (event: WheelEvent) => event.preventDefault();
    canvas?.addEventListener('wheel', preventScroll, { passive: false });
    return () => canvas?.removeEventListener('wheel', preventScroll);
  }, []);
  const [motion, setMotion] = useState<{
    dx: number;
    dy: number;
    ids: string[];
  } | null>(null);
  const [box, setBox] = useState<{ start: Point; end: Point } | null>(null);
  const [hover, setHover] = useState('');
  const [hits, setHits] = useState<string[]>([]);
  const space = useRef(false);
  const drag = useRef<{
    mode: 'move' | 'pan' | 'box' | 'actor';
    start: Point;
    client: Point;
    ids: string[];
    view: Point;
    moved: boolean;
  } | null>(null);
  const b = sceneBounds(scene);
  const view = scene.view;
  const screenPoint = (clientX: number, clientY: number): Point => {
    const rect = svg.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.x) / view.zoom,
      y: (clientY - rect.top - view.y) / view.zoom,
    };
  };
  const hitTest = (q: Point) =>
    scene.order.filter((id) => {
      const i = scene.instances.find((item) => item.id === id);
      if (i && !i.hidden) {
        const r = instanceRect(i, materialFor(scene, i)!);
        return (
          q.x >= r.x &&
          q.x <= r.x + r.width &&
          q.y >= r.y &&
          q.y <= r.y + r.height
        );
      }
      const l = scene.map?.layers.find((item) => item.id === id);
      return (
        l &&
        !l.hidden &&
        !l.locked &&
        q.x >= b.x &&
        q.y >= b.y &&
        q.x <= b.x + l.width &&
        q.y <= b.y + l.height
      );
    });
  const name = (id: string) =>
    id === 'actor'
      ? '玩家所在层'
      : scene.instances.find((i) => i.id === id)?.name ||
        scene.map?.layers.find((l) => l.id === id)?.name ||
        id;
  const start = (event: PointerEvent<SVGSVGElement>) => {
    // Keyboard focus must not scroll the clipped workbench route over its header.
    svg.current?.focus({ preventScroll: true });
    if (p.disabled || event.button === 2) return;
    const q = screenPoint(event.clientX, event.clientY);
    if (p.targetMode) {
      const hit = hitTest(q)[0];
      if (hit) p.target(hit);
      return;
    }
    if (preview && event.button === 0 && !space.current) {
      if (Math.hypot(q.x - sim.actor.x, q.y - sim.actor.y) < 18 / view.zoom)
        drag.current = {
          mode: 'actor',
          start: q,
          client: { x: event.clientX, y: event.clientY },
          ids: [],
          view,
          moved: false,
        };
      else sim.click(q.x, q.y);
    } else if (event.button === 1 || space.current)
      drag.current = {
        mode: 'pan',
        start: q,
        client: { x: event.clientX, y: event.clientY },
        ids: [],
        view: { x: view.x, y: view.y },
        moved: false,
      };
    else {
      const hit = hitTest(q).find(
        (id) => !scene.instances.find((i) => i.id === id)?.locked,
      );
      if (hit) {
        let ids = selected.includes(hit)
          ? selected
          : event.shiftKey
            ? [...selected, hit]
            : [hit];
        if (event.shiftKey && selected.includes(hit)) {
          p.select(selected.filter((id) => id !== hit));
          return;
        }
        p.select(ids);
        if (event.altKey) ids = p.duplicate(0, ids);
        drag.current = {
          mode: 'move',
          start: q,
          client: { x: event.clientX, y: event.clientY },
          ids,
          view,
          moved: false,
        };
      } else {
        if (!event.shiftKey) p.select([]);
        drag.current = {
          mode: 'box',
          start: q,
          client: { x: event.clientX, y: event.clientY },
          ids: event.shiftKey ? selected : [],
          view,
          moved: false,
        };
      }
    }
    if (drag.current) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const q = screenPoint(event.clientX, event.clientY);
    if (p.targetMode) setHover(hitTest(q)[0] || '');
    const d = drag.current;
    if (!d) return;
    d.moved ||=
      Math.hypot(event.clientX - d.client.x, event.clientY - d.client.y) > 2;
    if (d.mode === 'actor') sim.moveActor(q.x, q.y);
    else if (d.mode === 'box') setBox({ start: d.start, end: q });
    else if (d.mode === 'pan')
      setMotion({
        dx: event.clientX - d.client.x,
        dy: event.clientY - d.client.y,
        ids: [],
      });
    else {
      const snap = scene.view.grid;
      setMotion({
        dx: Math.round((q.x - d.start.x) / snap) * snap,
        dy: Math.round((q.y - d.start.y) / snap) * snap,
        ids: d.ids,
      });
    }
  };
  const finish = (event: PointerEvent<SVGSVGElement>, cancel = false) => {
    const d = drag.current;
    if (d && !cancel && d.moved) {
      if (d.mode === 'move' && motion)
        p.edit((next) => {
          for (const i of next.instances)
            if (d.ids.includes(i.id) && !i.locked) {
              i.x += motion.dx;
              i.y += motion.dy;
            }
          if (
            next.map &&
            next.map.layers.some((l) => d.ids.includes(l.id) && !l.locked)
          ) {
            next.map.offset.x += motion.dx;
            next.map.offset.y += motion.dy;
          }
        });
      if (d.mode === 'pan' && motion)
        p.edit((next) => {
          next.view.x = d.view.x + motion.dx;
          next.view.y = d.view.y + motion.dy;
        }, false);
      if (d.mode === 'box' && box) {
        const x = Math.min(box.start.x, box.end.x),
          y = Math.min(box.start.y, box.end.y),
          w = Math.abs(box.start.x - box.end.x),
          h = Math.abs(box.start.y - box.end.y);
        p.select([
          ...new Set([
            ...d.ids,
            ...scene.instances
              .filter((i) => {
                const r = instanceRect(i, materialFor(scene, i)!);
                return (
                  !i.locked &&
                  !i.hidden &&
                  r.x <= x + w &&
                  r.x + r.width >= x &&
                  r.y <= y + h &&
                  r.y + r.height >= y
                );
              })
              .map((i) => i.id),
          ]),
        ]);
      }
    }
    drag.current = null;
    setMotion(null);
    setBox(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const panX = drag.current?.mode === 'pan' ? motion?.dx || 0 : 0,
    panY = drag.current?.mode === 'pan' ? motion?.dy || 0 : 0;
  const drawing = (id: string) => {
    if (id === 'actor')
      return (
        view.showActor && (
          <g key={id} transform={`translate(${sim.actor.x} ${sim.actor.y})`}>
            <circle r={12} fill="#e5f2ff" stroke="#68a6ff" strokeWidth={2} />
            <text
              x={0}
              y={-20}
              textAnchor="middle"
              fill="#c5dcf4"
              fontSize={12 / view.zoom}
            >
              交互来源
            </text>
          </g>
        )
      );
    const layer = scene.map?.layers.find((l) => l.id === id);
    if (layer && !(preview ? !layer.included : layer.hidden)) {
      const moving =
        motion &&
        drag.current?.mode === 'move' &&
        scene.map?.layers.some((l) => motion.ids.includes(l.id));
      return (
        <image
          key={id}
          href={layer.source}
          x={b.x + (moving ? motion!.dx : 0)}
          y={b.y + (moving ? motion!.dy : 0)}
          width={layer.width}
          height={layer.height}
          opacity={!preview && !layer.included ? 0.25 : 1}
          style={{ imageRendering: 'pixelated' }}
        />
      );
    }
    const i = scene.instances.find((item) => item.id === id);
    if (!i || (preview ? !i.included : i.hidden)) return null;
    const moved =
      motion?.ids.includes(id) && drag.current?.mode === 'move'
        ? { ...i, x: i.x + motion.dx, y: i.y + motion.dy }
        : i;
    return (
      <g key={id} opacity={!preview && !i.included ? 0.25 : 1}>
        <ObjectArt
          instance={moved}
          material={materialFor(scene, i)!}
          time={p.time}
          preview={preview}
          simulated={
            preview ? sim.objects.find((s) => s.id === i.id) : undefined
          }
        />
      </g>
    );
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger render={<div className="sc-canvas-wrap" />}>
        <svg
          ref={svg}
          tabIndex={0}
          role="application"
          aria-label="场景摆放画布"
          className={`sc-canvas ${p.targetMode ? 'sc-targeting' : ''}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!p.disabled && !preview)
              p.drop(
                e.dataTransfer.getData('application/x-scene-material'),
                screenPoint(e.clientX, e.clientY),
              );
          }}
          onContextMenu={(e) => {
            if (p.disabled || preview) {
              e.preventDefault();
              return;
            }
            const list = hitTest(screenPoint(e.clientX, e.clientY));
            setHits(list);
            if (list[0] && !selected.includes(list[0])) p.select([list[0]]);
          }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={(e) => finish(e)}
          onPointerCancel={(e) => finish(e, true)}
          onBlur={() => {
            space.current = false;
            drag.current = null;
            setMotion(null);
            setBox(null);
          }}
          onKeyDown={(e) => {
            if (e.code === 'Space') {
              e.preventDefault();
              space.current = true;
            }
          }}
          onKeyUp={(e) => {
            if (e.code === 'Space') space.current = false;
          }}
          onWheel={(e) => {
            if (p.disabled) return;
            const q = screenPoint(e.clientX, e.clientY);
            const z = Math.max(
              0.02,
              Math.min(16, view.zoom * Math.exp(-e.deltaY * 0.001)),
            );
            p.edit((next) => {
              next.view.zoom = z;
              next.view.x += q.x * (view.zoom - z);
              next.view.y += q.y * (view.zoom - z);
            }, false);
          }}
        >
          <defs>
            <pattern
              id="sc-grid"
              width={Math.max(8, view.grid)}
              height={Math.max(8, view.grid)}
              patternUnits="userSpaceOnUse"
            >
              <path
                d={`M ${Math.max(8, view.grid)} 0 L 0 0 0 ${Math.max(8, view.grid)}`}
                fill="none"
                stroke="#476070"
                strokeWidth={0.5 / view.zoom}
              />
            </pattern>
          </defs>
          <g
            transform={`translate(${view.x + panX} ${view.y + panY}) scale(${view.zoom})`}
          >
            {[...scene.order].reverse().map(drawing)}
            {!preview && view.showGrid && (
              <rect
                x={b.x}
                y={b.y}
                width={b.width}
                height={b.height}
                fill="url(#sc-grid)"
                pointerEvents="none"
              />
            )}
            {view.showShapes && (
              <g pointerEvents="none">
                {scene.map?.collisions.map((points, n) => (
                  <polygon
                    key={n}
                    points={points
                      .map(
                        (q) =>
                          `${q.x + scene.map!.offset.x},${q.y + scene.map!.offset.y}`,
                      )
                      .join(' ')}
                    fill="#ffbc7218"
                    stroke="#ffbc72"
                    strokeWidth={1 / view.zoom}
                  />
                ))}
                {scene.instances
                  .filter((i) => (preview ? i.included : !i.hidden))
                  .map((i) => (
                    <g key={i.id}>
                      <ObjectArt
                        instance={i}
                        material={materialFor(scene, i)!}
                        shapes
                        art={false}
                        preview={preview}
                        time={p.time}
                        simulated={
                          preview
                            ? sim.objects.find((s) => s.id === i.id)
                            : undefined
                        }
                      />
                    </g>
                  ))}
              </g>
            )}
            {!preview &&
              scene.instances
                .filter((i) => !i.hidden)
                .map((i) => {
                  const r = instanceRect(i, materialFor(scene, i)!),
                    active = selected.includes(i.id) || hover === i.id;
                  const dx = motion?.ids.includes(i.id) ? motion.dx : 0,
                    dy = motion?.ids.includes(i.id) ? motion.dy : 0;
                  return (
                    <g
                      key={i.id}
                      pointerEvents="none"
                      transform={`translate(${dx} ${dy})`}
                    >
                      {active && (
                        <>
                          <rect
                            {...r}
                            fill="none"
                            stroke="#67ebcb"
                            strokeWidth={1.5 / view.zoom}
                          />
                          <path
                            d={`M ${i.x - 5 / view.zoom} ${i.y} h ${10 / view.zoom} M ${i.x} ${i.y - 5 / view.zoom} v ${10 / view.zoom}`}
                            stroke="#67ebcb"
                            strokeWidth={1 / view.zoom}
                          />
                        </>
                      )}
                      {view.showNames && (
                        <text
                          x={r.x}
                          y={r.y - 6 / view.zoom}
                          fontSize={12 / view.zoom}
                          fill={active ? '#99ffe1' : '#e8f3fa'}
                          paintOrder="stroke"
                          stroke="#101c26"
                          strokeWidth={3 / view.zoom}
                        >
                          {i.name}
                          {i.locked ? ' · 已锁定' : ''}
                        </text>
                      )}
                    </g>
                  );
                })}
            {preview &&
              sim.focus &&
              (() => {
                const instance = scene.instances.find(
                  (i) => i.id === sim.focus!.id,
                )!;
                const o = materialFor(scene, instance)!.project.objects[0];
                const origin = instanceOrigin(instance);
                return (
                  <text
                    x={origin.x + o.content.promptOffset.x * instance.scale}
                    y={origin.y + o.content.promptOffset.y * instance.scale}
                    textAnchor="middle"
                    fill="#95ffe0"
                    fontSize={14 / view.zoom}
                  >
                    {o.content.prompt ||
                      `[${o.activation.key}] ${instance.name}`}
                  </text>
                );
              })()}
            {box && (
              <rect
                x={Math.min(box.start.x, box.end.x)}
                y={Math.min(box.start.y, box.end.y)}
                width={Math.abs(box.end.x - box.start.x)}
                height={Math.abs(box.end.y - box.start.y)}
                fill="#67ebcb18"
                stroke="#67ebcb"
                strokeWidth={1 / view.zoom}
              />
            )}
          </g>
        </svg>
        {!scene.map && (
          <div className="sc-canvas-empty">
            <strong>先选择一张地图</strong>
            <span>再把左侧交互物拖到这里</span>
          </div>
        )}
        {p.targetMode && (
          <div className="sc-canvas-message">
            点选参照物，放到它{p.targetMode === 'before' ? '前面' : '后面'} ·
            Esc 取消 {hover && `· ${name(hover)}`}
          </div>
        )}
        {preview && (
          <div className="sc-canvas-message">
            拖动白色来源模拟靠近 · 点击物件交互 · 按物件配置的键触发
          </div>
        )}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={!selected.length || preview}
          onClick={() => p.arrange('front')}
        >
          置于最前
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!selected.length || preview}
          onClick={() => p.arrange('back')}
        >
          置于最后
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!selected.length || preview}
          onClick={() => p.arrange('forward')}
        >
          向前一层
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!selected.length || preview}
          onClick={() => p.arrange('backward')}
        >
          向后一层
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!selected.length || preview}
          onClick={() => p.arrange('target-before')}
        >
          放到……前面
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!selected.length || preview}
          onClick={() => p.arrange('target-after')}
        >
          放到……后面
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!selected.length || preview}
          onClick={() => p.arrange('before', 'actor')}
        >
          放到玩家前面
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!selected.length || preview}
          onClick={() => p.arrange('after', 'actor')}
        >
          放到玩家后面
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={
            preview || !scene.instances.some((i) => selected.includes(i.id))
          }
          onClick={() => p.duplicate()}
        >
          复制物件
        </ContextMenuItem>
        <ContextMenuItem
          disabled={
            preview || !scene.instances.some((i) => selected.includes(i.id))
          }
          onClick={p.replace}
        >
          替换选中物件…
        </ContextMenuItem>
        <ContextMenuItem
          disabled={
            preview || !scene.instances.some((i) => selected.includes(i.id))
          }
          onClick={p.remove}
        >
          删除物件
        </ContextMenuItem>
        {hits.length > 0 && (
          <>
            <ContextMenuSeparator />
            {hits.map((id) => (
              <ContextMenuItem key={id} onClick={() => p.select([id])}>
                选择：{name(id)}
              </ContextMenuItem>
            ))}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
