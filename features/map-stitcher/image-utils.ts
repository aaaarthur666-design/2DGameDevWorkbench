import {
  CENTER_KEY,
  EMPTY_FEATHER,
  ASSET_LAYERS,
  type EditableLayer,
  type ImageAsset,
  type Tile,
  clamp,
  cleanNumber,
  tileKey,
} from './map-types';

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片无法读取或已损坏'));
    image.src = url;
  });
}

export async function fileToAsset(file: File): Promise<ImageAsset> {
  const inferredType = file.type || inferImageType(file.name);
  if (!ACCEPTED_IMAGE_TYPES.includes(inferredType)) {
    throw new Error('仅支持 PNG、JPG、JFIF 和 WebP 图片');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`图片 ${file.name} 超过 30 MB`);
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    return {
      file,
      url,
      width: image.naturalWidth,
      height: image.naturalHeight,
      name: file.name,
      type: inferredType,
      size: file.size,
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export async function blobToAsset(blob: Blob, name: string): Promise<ImageAsset> {
  const file = new File([blob], name, { type: blob.type || 'image/png' });
  return fileToAsset(file);
}

function inferImageType(fileName: string) {
  const name = fileName.toLowerCase();
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.jfif')) return 'image/jpeg';
  return 'image/png';
}

export function revokeTileAssets(tiles: Tile[]) {
  for (const tile of tiles) {
    for (const layer of ASSET_LAYERS) {
      if (tile.layers[layer]) URL.revokeObjectURL(tile.layers[layer].url);
    }
  }
}

export function createCenterTile(asset: ImageAsset): Tile {
  return {
    key: CENTER_KEY,
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    layers: { ground: asset },
    collisions: [],
    feather: { ...EMPTY_FEATHER },
    hidden: false,
  };
}

export function expandAroundTile(
  origin: Tile,
  split: 4 | 8 | 12,
  horizontalOverlapPercent: number,
  verticalOverlapPercent: number,
): Tile[] {
  const count = split / 4;
  const ox = horizontalOverlapPercent / 100;
  const oy = verticalOverlapPercent / 100;
  const horizontalSize = origin.w / (count - (count - 1) * ox);
  const horizontalStep = horizontalSize * (1 - ox);
  const verticalSize = origin.h / (count - (count - 1) * oy);
  const verticalStep = verticalSize * (1 - oy);
  const candidates: Array<Omit<Tile, 'key'>> = [];

  for (let index = 0; index < count; index += 1) {
    const x = cleanNumber(origin.x + index * horizontalStep);
    candidates.push({
      x,
      y: cleanNumber(origin.y - horizontalSize * (1 - oy)),
      w: cleanNumber(horizontalSize),
      h: cleanNumber(horizontalSize),
      layers: {},
      collisions: [],
      feather: { ...EMPTY_FEATHER },
      hidden: false,
    });
    candidates.push({
      x,
      y: cleanNumber(origin.y + origin.h - horizontalSize * oy),
      w: cleanNumber(horizontalSize),
      h: cleanNumber(horizontalSize),
      layers: {},
      collisions: [],
      feather: { ...EMPTY_FEATHER },
      hidden: false,
    });
  }

  for (let index = 0; index < count; index += 1) {
    const y = cleanNumber(origin.y + index * verticalStep);
    candidates.push({
      x: cleanNumber(origin.x - verticalSize * (1 - ox)),
      y,
      w: cleanNumber(verticalSize),
      h: cleanNumber(verticalSize),
      layers: {},
      collisions: [],
      feather: { ...EMPTY_FEATHER },
      hidden: false,
    });
    candidates.push({
      x: cleanNumber(origin.x + origin.w - verticalSize * ox),
      y,
      w: cleanNumber(verticalSize),
      h: cleanNumber(verticalSize),
      layers: {},
      collisions: [],
      feather: { ...EMPTY_FEATHER },
      hidden: false,
    });
  }

  return candidates.map((tile) => ({ ...tile, key: tileKey(tile.x, tile.y) }));
}

export function isSameGeometry(a: Tile, b: Tile) {
  const epsilon = 0.0001;
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.w - b.w) < epsilon &&
    Math.abs(a.h - b.h) < epsilon
  );
}

export function rectsIntersect(a: Tile, b: Tile) {
  const epsilon = 0.000001;
  return (
    a.x < b.x + b.w - epsilon &&
    a.x + a.w > b.x + epsilon &&
    a.y < b.y + b.h - epsilon &&
    a.y + a.h > b.y + epsilon
  );
}

export function preferredEditableLayer(layer: 'overall' | EditableLayer | 'collision'): EditableLayer {
  return layer === 'overall' || layer === 'collision' ? 'ground' : layer;
}

export function safeFileName(name: string) {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
  return safe || 'scene';
}

export function baseFileName(name: string) {
  return safeFileName(name.replace(/\.[^.]+$/, '')) || 'scene';
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('无法生成图片文件'))), type, quality);
  });
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

export function dataUrlToBlob(dataUrl: string) {
  const [header, payload] = dataUrl.split(',');
  if (!header || !payload) throw new Error('扩图服务返回了无效图片');
  const type = /data:([^;]+)/.exec(header)?.[1] ?? 'image/png';
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

export async function urlToBlob(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`无法下载扩图结果（${response.status}）`);
  return response.blob();
}

export async function repairBottomRightWatermark(asset: ImageAsset) {
  const image = await loadImage(asset.url);
  const canvas = document.createElement('canvas');
  canvas.width = asset.width;
  canvas.height = asset.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('浏览器无法创建去水印画布');
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0);

  const standardSize = asset.width > 1024 && asset.height > 1024 ? 96 : 48;
  const markSize = Math.max(1, Math.min(standardSize, asset.width, asset.height));
  const margin = Math.min(standardSize === 96 ? 64 : 32, Math.floor(Math.min(asset.width, asset.height) / 4));
  const left = Math.max(0, asset.width - margin - markSize);
  const top = Math.max(0, asset.height - margin - markSize);
  const sampleLeft = Math.max(0, Math.min(asset.width - markSize, left - markSize - Math.round(margin / 2)));
  const source = context.getImageData(sampleLeft, top, markSize, markSize);
  const destination = context.getImageData(left, top, markSize, markSize);

  for (let y = 0; y < markSize; y += 1) {
    for (let x = 0; x < markSize; x += 1) {
      const offset = (y * markSize + x) * 4;
      const edgeDistance = Math.min(x, y, markSize - 1 - x, markSize - 1 - y);
      const blend = clamp(edgeDistance / Math.max(3, markSize * 0.16), 0, 1);
      for (let channel = 0; channel < 3; channel += 1) {
        destination.data[offset + channel] = Math.round(
          destination.data[offset + channel] * (1 - blend) + source.data[offset + channel] * blend,
        );
      }
      destination.data[offset + 3] = Math.max(destination.data[offset + 3], source.data[offset + 3]);
    }
  }
  context.putImageData(destination, left, top);
  return canvasToBlob(canvas);
}
