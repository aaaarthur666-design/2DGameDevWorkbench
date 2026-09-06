'use client';
import { useEffect, useState } from 'react';
import type { Shape } from '@/features/interactable-editor/contract.mjs';
import {
  initialState,
  stateAppearance,
  type SimInstance,
} from '@/features/interactable-editor/simulator.mjs';
import {
  instanceOrigin,
  type Instance,
  type Material,
} from '@/features/scene-composer/model.mjs';

export function ShapeOutline({
  shape,
  color,
}: {
  shape: Shape;
  color: string;
}) {
  const common = {
    fill: `${color}18`,
    stroke: color,
    strokeWidth: 1,
    vectorEffect: 'non-scaling-stroke' as const,
  };
  return shape.type === 'circle' ? (
    <circle
      {...common}
      cx={shape.offset.x}
      cy={shape.offset.y}
      r={shape.radius}
    />
  ) : (
    <rect
      {...common}
      x={shape.offset.x - shape.width / 2}
      y={
        shape.offset.y -
        Math.max(shape.height, shape.type === 'capsule' ? shape.width : 0) / 2
      }
      width={shape.width}
      height={Math.max(
        shape.height,
        shape.type === 'capsule' ? shape.width : 0,
      )}
      rx={shape.type === 'capsule' ? shape.width / 2 : 0}
    />
  );
}
export function instanceRect(instance: Instance, material: Material) {
  const v = material.project.objects[0].visual,
    p = instanceOrigin(instance),
    sx = instance.scale * (instance.flipH ? -1 : 1);
  const w = v.width * v.scale * instance.scale,
    h = v.height * v.scale * instance.scale;
  return {
    x: p.x + v.offset.x * sx - w / 2,
    y: p.y + v.offset.y * instance.scale - h / 2,
    width: w,
    height: h,
  };
}
export function ObjectArt({
  instance: i,
  material,
  time = 0,
  simulated,
  shapes = false,
  preview = false,
  art = true,
}: {
  instance: Instance;
  material: Material;
  time?: number;
  simulated?: SimInstance;
  shapes?: boolean;
  preview?: boolean;
  art?: boolean;
}) {
  const o = material.project.objects[0],
    v = o.visual;
  const appearance = stateAppearance(o, simulated?.state || initialState(o));
  const completedHidden =
    simulated?.state.completed && o.completion !== 'remain';
  const visible = (appearance.visible ?? v.visible) && !completedHidden;
  const clipName =
    simulated?.animation?.name || appearance.animation || v.idleAnimation;
  const clip = v.clips.find((c) => c.name === clipName);
  let frame = clip?.frames[0];
  if (clip) {
    const total = clip.frames.reduce((sum, f) => sum + f.duration, 0);
    let t = Math.max(0, time - (simulated?.animation?.started || 0)) * clip.fps;
    t = clip.loop ? t % total : Math.min(t, total - 0.00001);
    for (const f of clip.frames) {
      frame = f;
      if (t < f.duration) break;
      t -= f.duration;
    }
  }
  const assetId = frame?.assetId || appearance.assetId || v.assetId;
  const asset = material.project.assets.find((a) => a.id === assetId);
  const imageSource = asset?.source;
  const [dimensions, setDimensions] = useState({
    width: v.width,
    height: v.height,
  });
  useEffect(() => {
    let alive = true;
    if (imageSource) {
      const image = new Image();
      image.onload = () => {
        if (alive)
          setDimensions({
            width: image.naturalWidth,
            height: image.naturalHeight,
          });
      };
      image.src = imageSource;
    }
    return () => {
      alive = false;
    };
  }, [imageSource]);
  const p = instanceOrigin(i),
    region = frame?.region;
  const rgb = [1, 3, 5].map(
    (index) =>
      parseInt((appearance.tint || v.tint).slice(index, index + 2), 16) / 255,
  );
  return (
    <g
      transform={`translate(${p.x} ${p.y}) scale(${i.scale * (i.flipH ? -1 : 1)} ${i.scale})`}
    >
      {shapes && !(preview && completedHidden) && (
        <g pointerEvents="none">
          <ShapeOutline shape={o.detection.shape} color="#56ddb0" />
          <ShapeOutline shape={o.pointer} color="#88baff" />
          {(appearance.solidEnabled ?? o.solid.enabled) && (
            <ShapeOutline shape={o.solid.shape} color="#ffbc72" />
          )}
        </g>
      )}
      {art && (
        <g
          opacity={visible ? 1 : preview ? 0 : 0.2}
          transform={`translate(${v.offset.x} ${v.offset.y + (v.float ? Math.sin(time * 2) * 5 : 0)}) scale(${v.scale * (v.flipH ? -1 : 1)} ${v.scale * (v.flipV ? -1 : 1)})`}
        >
          <defs>
            <filter id={`scene-tint-${i.id}`} colorInterpolationFilters="sRGB">
              <feColorMatrix
                type="matrix"
                values={`${rgb[0]} 0 0 0 0 0 ${rgb[1]} 0 0 0 0 0 ${rgb[2]} 0 0 0 0 0 1 0`}
              />
            </filter>
          </defs>
          {asset ? (
            <svg
              x={-v.width / 2}
              y={-v.height / 2}
              width={v.width}
              height={v.height}
              preserveAspectRatio="none"
              viewBox={
                region
                  ? `${region.x} ${region.y} ${region.width} ${region.height}`
                  : `0 0 ${dimensions.width} ${dimensions.height}`
              }
            >
              <image
                filter={`url(#scene-tint-${i.id})`}
                href={asset.source}
                width={dimensions.width}
                height={dimensions.height}
                style={{ imageRendering: 'pixelated' }}
              />
            </svg>
          ) : (
            <rect
              x={v.dot ? -5 : -v.width / 2}
              y={v.dot ? -5 : -v.height / 2}
              width={v.dot ? 10 : v.width}
              height={v.dot ? 10 : v.height}
              rx={v.dot ? 5 : 3}
              fill="#55dcb2"
              filter={`url(#scene-tint-${i.id})`}
            />
          )}
        </g>
      )}
    </g>
  );
}
