import { canvasToBlob, loadImage } from './image-utils';
import type { ImageAsset } from './map-types';
import { frameRoninBounds, tilePixelSize } from './frame-ronin-geometry';
import type {
  FrameRoninTile,
  MapDisplayLayer,
  MapImageLayer,
  RegionShape,
} from './frame-ronin-types';
import {
  mapShapeToWorldPixels,
  shapePolygonPoints,
  shapesForTile,
} from './region-engine';

export interface RenderedMap {
  canvas: HTMLCanvasElement;
  bounds: ReturnType<typeof frameRoninBounds>;
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export function extractMattePixel(
  black: readonly [number, number, number],
  white: readonly [number, number, number],
): readonly [number, number, number, number] {
  const alphaChannels = [0, 1, 2].map((channel) =>
    clamp01(1 - (white[channel] - black[channel]) / 255),
  );
  const alpha = (alphaChannels[0] + alphaChannels[1] + alphaChannels[2]) / 3;
  if (alpha <= 1 / 255) return [0, 0, 0, 0];
  return [
    clampByte(black[0] / alpha),
    clampByte(black[1] / alpha),
    clampByte(black[2] / alpha),
    clampByte(alpha * 255),
  ];
}

export async function deriveObjectFromMattes(
  black: ImageAsset,
  white: ImageAsset,
) {
  if (black.width !== white.width || black.height !== white.height)
    throw new Error('黑白参考图尺寸必须一致。');
  const width = Math.max(1, Math.min(black.width, white.width));
  const height = Math.max(1, Math.min(black.height, white.height));
  const [blackImage, whiteImage] = await Promise.all([
    loadImage(black.url),
    loadImage(white.url),
  ]);
  const blackCanvas = createCanvas(width, height);
  const whiteCanvas = createCanvas(width, height);
  const blackContext = context2d(blackCanvas, true);
  const whiteContext = context2d(whiteCanvas, true);
  blackContext.drawImage(blackImage, 0, 0, width, height);
  whiteContext.drawImage(whiteImage, 0, 0, width, height);
  const blackData = blackContext.getImageData(0, 0, width, height);
  const whiteData = whiteContext.getImageData(0, 0, width, height);
  const output = blackContext.createImageData(width, height);
  let difference = 0;

  for (let offset = 0; offset < output.data.length; offset += 4) {
    difference +=
      Math.abs(blackData.data[offset] - whiteData.data[offset]) +
      Math.abs(blackData.data[offset + 1] - whiteData.data[offset + 1]) +
      Math.abs(blackData.data[offset + 2] - whiteData.data[offset + 2]);
    const pixel = extractMattePixel(
      [
        blackData.data[offset],
        blackData.data[offset + 1],
        blackData.data[offset + 2],
      ],
      [
        whiteData.data[offset],
        whiteData.data[offset + 1],
        whiteData.data[offset + 2],
      ],
    );
    output.data[offset] = pixel[0];
    output.data[offset + 1] = pixel[1];
    output.data[offset + 2] = pixel[2];
    output.data[offset + 3] = pixel[3];
  }
  if (!difference)
    throw new Error(
      '黑白参考图完全相同，无法恢复透明物件。请上传同一物件在真实黑底和白底上的参考图。',
    );
  blackContext.clearRect(0, 0, width, height);
  blackContext.putImageData(output, 0, 0);
  return canvasToBlob(blackCanvas);
}

export async function deriveMaskCanvas(
  overall: ImageAsset,
  object: ImageAsset,
) {
  const width = Math.max(1, Math.min(overall.width, object.width));
  const height = Math.max(1, Math.min(overall.height, object.height));
  const [overallImage, objectImage] = await Promise.all([
    loadImage(overall.url),
    loadImage(object.url),
  ]);
  const canvas = createCanvas(width, height);
  const context = context2d(canvas, true);
  context.drawImage(overallImage, 0, 0, width, height);
  const overallData = context.getImageData(0, 0, width, height);
  context.clearRect(0, 0, width, height);
  context.drawImage(objectImage, 0, 0, width, height);
  const objectData = context.getImageData(0, 0, width, height);
  const output = context.createImageData(width, height);
  for (let offset = 0; offset < output.data.length; offset += 4) {
    const alpha = Math.round(
      (overallData.data[offset + 3] * objectData.data[offset + 3]) / 255,
    );
    output.data[offset] = 255;
    output.data[offset + 1] = 255;
    output.data[offset + 2] = 255;
    output.data[offset + 3] = alpha;
  }
  context.clearRect(0, 0, width, height);
  context.putImageData(output, 0, 0);
  return canvas;
}

export async function renderFrameRoninTile(
  tile: FrameRoninTile,
  layer: MapDisplayLayer,
  shapes: RegionShape[],
  sourceWidth: number,
  sourceHeight: number,
) {
  const { width, height } = tilePixelSize(tile, sourceWidth, sourceHeight);
  const canvas = createCanvas(width, height);
  const context = context2d(canvas);
  let image: HTMLImageElement | null = null;

  if (layer === 'mask') {
    const overall = tile.images.overall;
    const object = tile.images.object;
    if (overall && object)
      context.drawImage(
        await deriveMaskCanvas(overall, object),
        0,
        0,
        width,
        height,
      );
  } else {
    const asset = tile.images[layer];
    if (asset) {
      image = await loadImage(asset.url);
      context.drawImage(image, 0, 0, width, height);
    }
  }

  if ((layer === 'object' || layer === 'mask') && canvasHasPixels(canvas)) {
    const occlusionShapes = shapesForTile(shapes, tile.key, {
      layers: ['occlusion'],
    });
    if (occlusionShapes.length) {
      context.save();
      context.globalCompositeOperation = 'destination-out';
      for (const shape of occlusionShapes) fillRegionPath(context, shape);
      context.restore();
    }
  }
  return canvas;
}

export async function createGenerationTemplate(
  tiles: FrameRoninTile[],
  target: FrameRoninTile,
  layer: MapImageLayer,
  sourceWidth: number,
  sourceHeight: number,
) {
  const { width, height } = tilePixelSize(target, sourceWidth, sourceHeight);
  const canvas = createCanvas(width, height);
  const context = context2d(canvas);
  for (const tile of tiles) {
    if (tile.key === target.key || tile.hidden) continue;
    const asset = tile.images[layer];
    if (!asset) continue;
    const image = await loadImage(asset.url);
    context.drawImage(
      image,
      Math.round((tile.x - target.x) * sourceWidth),
      Math.round((tile.y - target.y) * sourceHeight),
      Math.round(tile.w * sourceWidth),
      Math.round(tile.h * sourceHeight),
    );
  }
  return canvas;
}

export async function generateLocalLayerFill(
  tiles: FrameRoninTile[],
  target: FrameRoninTile,
  layer: MapImageLayer,
  sourceWidth: number,
  sourceHeight: number,
) {
  const canvas = await createGenerationTemplate(
    tiles,
    target,
    layer,
    sourceWidth,
    sourceHeight,
  );
  const context = context2d(canvas);
  const nearest = tiles
    .filter(
      (tile) => tile.key !== target.key && !tile.hidden && tile.images[layer],
    )
    .sort((a, b) => tileDistance(a, target) - tileDistance(b, target))[0];
  if (!nearest?.images[layer])
    throw new Error('当前图层没有可用于本地补全的相邻图片');
  const image = await loadImage(nearest.images[layer].url);
  context.save();
  context.globalCompositeOperation = 'destination-over';
  const flipX = nearest.x < target.x;
  const flipY = nearest.y < target.y;
  context.translate(flipX ? canvas.width : 0, flipY ? canvas.height : 0);
  context.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  context.restore();
  return canvasToBlob(canvas);
}

export async function renderStitchedMap(
  tiles: FrameRoninTile[],
  layer: MapDisplayLayer | 'top',
  shapes: RegionShape[],
  sourceWidth: number,
  sourceHeight: number,
): Promise<RenderedMap> {
  if (!tiles.length) throw new Error('地图中没有可导出的卡片');
  const bounds = frameRoninBounds(tiles);
  const originX = Math.floor(bounds.minX * sourceWidth);
  const originY = Math.floor(bounds.minY * sourceHeight);
  const width = Math.max(1, Math.ceil(bounds.maxX * sourceWidth) - originX);
  const height = Math.max(1, Math.ceil(bounds.maxY * sourceHeight) - originY);
  if (width > 30000 || height > 30000 || width * height > 64_000_000)
    throw new Error(
      '合成画布超过 6400 万像素或 30000 像素边长，请减少输出范围。',
    );
  const canvas = createCanvas(width, height);
  const context = context2d(canvas);

  if (layer === 'top') {
    const overall = await renderStitchedMap(
      tiles,
      'overall',
      shapes,
      sourceWidth,
      sourceHeight,
    );
    context.drawImage(overall.canvas, 0, 0);
    const mask = createCanvas(width, height);
    const maskContext = context2d(mask);
    for (const shape of shapes.filter(
      (candidate) => candidate.layer === 'top',
    )) {
      const tile = tiles.find((candidate) => candidate.key === shape.tileKey);
      if (!tile || tile.hidden) continue;
      maskContext.beginPath();
      appendWorldRegionPath(
        maskContext,
        mapShapeToWorldPixels(shape, tile, sourceWidth, sourceHeight),
        originX,
        originY,
      );
      maskContext.fillStyle = '#fff';
      maskContext.fill();
    }
    context.globalCompositeOperation = 'destination-in';
    context.drawImage(mask, 0, 0);
    context.globalCompositeOperation = 'source-over';
    overall.canvas.width = overall.canvas.height = mask.width = mask.height = 1;
    return { canvas, bounds, originX, originY, width, height };
  }

  for (const tile of tiles) {
    if (tile.hidden) continue;
    const tileCanvas = await renderFrameRoninTile(
      tile,
      layer,
      shapes,
      sourceWidth,
      sourceHeight,
    );
    if (!canvasHasPixels(tileCanvas)) continue;
    context.save();
    applyFeather(context, tileCanvas, tile);
    context.drawImage(
      tileCanvas,
      Math.round(tile.x * sourceWidth) - originX,
      Math.round(tile.y * sourceHeight) - originY,
      Math.round(tile.w * sourceWidth),
      Math.round(tile.h * sourceHeight),
    );
    context.restore();
  }
  return { canvas, bounds, originX, originY, width, height };
}

export function fillRegionPath(
  context: CanvasRenderingContext2D,
  shape: RegionShape,
) {
  const points = shapePolygonPoints(shape);
  if (!points.length) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  if (shape.mode !== 'free' || points.length >= 3) {
    context.closePath();
    context.fillStyle = '#fff';
    context.fill();
  } else {
    context.lineWidth = 8;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#fff';
    context.stroke();
  }
}

function appendWorldRegionPath(
  context: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  originX: number,
  originY: number,
) {
  if (!points.length) return;
  context.moveTo(points[0].x - originX, points[0].y - originY);
  for (const point of points.slice(1))
    context.lineTo(point.x - originX, point.y - originY);
  context.closePath();
}

function applyFeather(
  context: CanvasRenderingContext2D,
  tileCanvas: HTMLCanvasElement,
  tile: FrameRoninTile,
) {
  const { top, right, bottom, left } = tile.feather;
  if (![top, right, bottom, left].some(Boolean)) return;
  const mask = createCanvas(tileCanvas.width, tileCanvas.height);
  const maskContext = context2d(mask);
  const horizontal = maskContext.createLinearGradient(0, 0, mask.width, 0);
  horizontal.addColorStop(0, left ? 'rgba(255,255,255,0)' : '#fff');
  horizontal.addColorStop(Math.min(0.5, left / 100), '#fff');
  horizontal.addColorStop(Math.max(0.5, 1 - right / 100), '#fff');
  horizontal.addColorStop(1, right ? 'rgba(255,255,255,0)' : '#fff');
  maskContext.fillStyle = horizontal;
  maskContext.fillRect(0, 0, mask.width, mask.height);
  maskContext.globalCompositeOperation = 'destination-in';
  const vertical = maskContext.createLinearGradient(0, 0, 0, mask.height);
  vertical.addColorStop(0, top ? 'rgba(255,255,255,0)' : '#fff');
  vertical.addColorStop(Math.min(0.5, top / 100), '#fff');
  vertical.addColorStop(Math.max(0.5, 1 - bottom / 100), '#fff');
  vertical.addColorStop(1, bottom ? 'rgba(255,255,255,0)' : '#fff');
  maskContext.fillStyle = vertical;
  maskContext.fillRect(0, 0, mask.width, mask.height);
  const tileContext = context2d(tileCanvas);
  tileContext.save();
  tileContext.globalCompositeOperation = 'destination-in';
  tileContext.drawImage(mask, 0, 0);
  tileContext.restore();
  void context;
}

function canvasHasPixels(canvas: HTMLCanvasElement) {
  return canvas.width > 0 && canvas.height > 0;
}

function tileDistance(a: FrameRoninTile, b: FrameRoninTile) {
  return Math.hypot(
    a.x + a.w / 2 - b.x - b.w / 2,
    a.y + a.h / 2 - b.y - b.h / 2,
  );
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas: HTMLCanvasElement, readFrequently = false) {
  const context = canvas.getContext('2d', {
    willReadFrequently: readFrequently,
  });
  if (!context) throw new Error('浏览器无法创建 2D 画布');
  context.imageSmoothingEnabled = false;
  return context;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
