import {
  REGION_LAYER_META,
  type FrameRoninTile,
  type MapDisplayLayer,
  type RegionLayer,
  type RegionMode,
  type RegionPoint,
  type RegionShape,
} from './frame-ronin-types';

const EPSILON = 0.0001;

export function clampRegionPoint(
  point: RegionPoint,
  width: number,
  height: number,
): RegionPoint {
  return {
    x: Math.max(0, Math.min(width, point.x)),
    y: Math.max(0, Math.min(height, point.y)),
  };
}

export function rectanglePoints(
  start: RegionPoint,
  end: RegionPoint,
): RegionPoint[] {
  return [start, end];
}

export function rectangleCorners(
  start: RegionPoint,
  end: RegionPoint,
): RegionPoint[] {
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const bottom = Math.max(start.y, end.y);
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

export function regionShapeIsValid(mode: RegionMode, points: RegionPoint[]) {
  return regionValidationError(mode, points) === null;
}

export function cleanRegionPoints(points: RegionPoint[]) {
  const result = points.filter(
    (point, index) =>
      !index ||
      Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) >
        EPSILON,
  );
  if (
    result.length > 2 &&
    Math.hypot(result[0].x - result.at(-1)!.x, result[0].y - result.at(-1)!.y) <
      EPSILON
  )
    result.pop();
  return result;
}

export function regionValidationError(
  mode: RegionMode,
  input: RegionPoint[],
): string | null {
  if (
    input.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
    )
  )
    return '区域含有无效坐标。';
  const points = cleanRegionPoints(input);
  if (mode === 'rectangle') {
    if (points.length < 2) return '请指定矩形起点和终点。';
    const bounds = regionBounds(points);
    return bounds.width > EPSILON && bounds.height > EPSILON
      ? null
      : '矩形宽度和高度必须大于零。';
  }
  if (points.length < 3) return '区域至少需要三个不同的顶点。';
  if (points.length > 2048) return '区域顶点过多，请分段绘制。';
  if (Math.abs(polygonArea(points)) <= EPSILON)
    return '区域面积为零，请重新绘制。';
  const cross = (a: RegionPoint, b: RegionPoint, c: RegionPoint) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const between = (a: RegionPoint, b: RegionPoint, c: RegionPoint) =>
    Math.abs(cross(a, b, c)) < EPSILON &&
    c.x >= Math.min(a.x, b.x) - EPSILON &&
    c.x <= Math.max(a.x, b.x) + EPSILON &&
    c.y >= Math.min(a.y, b.y) - EPSILON &&
    c.y <= Math.max(a.y, b.y) + EPSILON;
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const a = points[i],
        b = points[(i + 1) % points.length],
        c = points[j],
        d = points[(j + 1) % points.length];
      if (
        (cross(a, b, c) * cross(a, b, d) < 0 &&
          cross(c, d, a) * cross(c, d, b) < 0) ||
        between(a, b, c) ||
        between(a, b, d) ||
        between(c, d, a) ||
        between(c, d, b)
      )
        return '区域边界发生自交，请调整绘制路径。';
    }
  return null;
}

export function regionBounds(points: RegionPoint[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

export function polygonArea(points: RegionPoint[]) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return sum / 2;
}

export function polylineLength(points: RegionPoint[]) {
  let result = 0;
  for (let index = 1; index < points.length; index += 1) {
    result += Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    );
  }
  return result;
}

export function shapeSvgPoints(shape: Pick<RegionShape, 'points'>) {
  return shape.points
    .map((point) => `${round(point.x)},${round(point.y)}`)
    .join(' ');
}

export function shapeSvgPath(shape: Pick<RegionShape, 'mode' | 'points'>) {
  const points = shapePolygonPoints(shape);
  if (!points.length) return '';
  const start = points[0];
  const remainder = points
    .slice(1)
    .map((point) => `L ${round(point.x)} ${round(point.y)}`)
    .join(' ');
  const close = ' Z';
  return `M ${round(start.x)} ${round(start.y)} ${remainder}${close}`.trim();
}

export function shapesForTile(
  shapes: RegionShape[],
  tileKey: string,
  options: { mapLayer?: MapDisplayLayer; layers?: RegionLayer[] } = {},
) {
  return shapes
    .filter((shape) => shape.tileKey === tileKey)
    .filter((shape) => !options.mapLayer || shape.mapLayer === options.mapLayer)
    .filter((shape) => !options.layers || options.layers.includes(shape.layer))
    .sort(
      (a, b) =>
        REGION_LAYER_META[a.layer].order - REGION_LAYER_META[b.layer].order,
    );
}

export function hitTestRegionShape(
  shape: RegionShape,
  point: RegionPoint,
  tolerance = 8,
) {
  const polygon = shapePolygonPoints(shape);
  return (
    pointInPolygon(point, polygon) ||
    distanceToPolygon(point, polygon) <= tolerance
  );
}

export function shapePolygonPoints(
  shape: Pick<RegionShape, 'mode' | 'points'>,
) {
  if (shape.mode === 'rectangle' && shape.points.length >= 2) {
    if (shape.points.length > 2) {
      const bounds = regionBounds(shape.points);
      return rectangleCorners(
        { x: bounds.left, y: bounds.top },
        { x: bounds.right, y: bounds.bottom },
      );
    }
    return rectangleCorners(
      shape.points[0],
      shape.points[shape.points.length - 1],
    );
  }
  return shape.points;
}

export function regionRectToShape(input: {
  id: string;
  tileKey: string;
  mapLayer?: MapDisplayLayer;
  layer?: RegionLayer;
  x: number;
  y: number;
  w: number;
  h: number;
  tileWidth: number;
  tileHeight: number;
}): RegionShape {
  const start = {
    x: cleanRegionNumber(input.x * input.tileWidth),
    y: cleanRegionNumber(input.y * input.tileHeight),
  };
  const end = {
    x: cleanRegionNumber((input.x + input.w) * input.tileWidth),
    y: cleanRegionNumber((input.y + input.h) * input.tileHeight),
  };
  return {
    id: input.id,
    tileKey: input.tileKey,
    mapLayer: input.mapLayer ?? 'overall',
    layer: input.layer ?? 'collision',
    mode: 'rectangle',
    points: rectanglePoints(start, end),
  };
}

export function mapShapeToWorldPixels(
  shape: RegionShape,
  tile: FrameRoninTile,
  sourceWidth: number,
  sourceHeight: number,
) {
  const originX = tile.x * sourceWidth;
  const originY = tile.y * sourceHeight;
  return shapePolygonPoints(shape).map((point) => ({
    x: originX + point.x,
    y: originY + point.y,
  }));
}

export function normalizeRegionShape(
  shape: RegionShape,
  width: number,
  height: number,
): RegionShape | null {
  if (
    shape.points.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
    )
  )
    return null;
  const points = cleanRegionPoints(
    shape.points.map((point) => clampRegionPoint(point, width, height)),
  );
  if (!regionShapeIsValid(shape.mode, points)) return null;
  return { ...shape, points };
}

function pointInPolygon(point: RegionPoint, polygon: RegionPoint[]) {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index++
  ) {
    const a = polygon[index];
    const b = polygon[previous];
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || EPSILON) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function distanceToPolygon(point: RegionPoint, polygon: RegionPoint[]) {
  let distance = Infinity;
  for (let index = 0; index < polygon.length; index += 1) {
    distance = Math.min(
      distance,
      distanceToSegment(
        point,
        polygon[index],
        polygon[(index + 1) % polygon.length],
      ),
    );
  }
  return distance;
}

function distanceToSegment(
  point: RegionPoint,
  start: RegionPoint,
  end: RegionPoint,
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON)
    return Math.hypot(point.x - start.x, point.y - start.y);
  const amount = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        (dx * dx + dy * dy),
    ),
  );
  return Math.hypot(
    point.x - (start.x + amount * dx),
    point.y - (start.y + amount * dy),
  );
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function cleanRegionNumber(value: number) {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}
