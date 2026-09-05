import JSZip from 'jszip';
import {
  MAP_DISPLAY_LAYERS,
  type FrameRoninTile,
  type MapDisplayLayer,
  type RegionShape,
} from './frame-ronin-types';
import {
  canvasToBlob,
  downloadBlob,
  loadImage,
  safeFileName,
} from './image-utils';
import { hasImageView } from './editor-selectors';
import { renderStitchedMap } from './layer-engine';
import type { ImageAsset } from './map-types';

export function canUseSeparatedComposite(tiles: FrameRoninTile[]) {
  const included = tiles.filter(
    (tile) => !tile.hidden && Object.keys(tile.images).length,
  );
  return (
    included.length > 0 &&
    included.every(
      (tile) =>
        tile.images.surface && tile.images.object && !tile.surfaceIsDraft,
    )
  );
}
export async function renderExportPreview(
  tiles: FrameRoninTile[],
  shapes: RegionShape[],
  width: number,
  height: number,
) {
  const separated = canUseSeparatedComposite(tiles);
  const base = await renderStitchedMap(
    tiles,
    separated ? 'surface' : 'overall',
    shapes,
    width,
    height,
  );
  const context = base.canvas.getContext('2d')!;
  if (separated)
    context.drawImage(
      (await renderStitchedMap(tiles, 'object', shapes, width, height)).canvas,
      0,
      0,
    );
  if (shapes.some((shape) => shape.layer === 'top'))
    context.drawImage(
      (await renderStitchedMap(tiles, 'top', shapes, width, height)).canvas,
      0,
      0,
    );
  return {
    ...base,
    composition: separated
      ? '地表 + 物件 + 顶层'
      : '整体 + 顶层（部分卡片尚未分层）',
  };
}
export async function createAllPngPackage(
  tiles: FrameRoninTile[],
  shapes: RegionShape[],
  width: number,
  height: number,
  name: string,
) {
  const zip = new JSZip();
  const layers: Array<MapDisplayLayer | 'top'> = MAP_DISPLAY_LAYERS.filter(
    (layer) => tiles.some((tile) => !tile.hidden && hasImageView(tile, layer)),
  );
  if (shapes.some((shape) => shape.layer === 'top')) layers.push('top');
  for (const layer of layers) {
    const rendered = await renderStitchedMap(
      tiles,
      layer,
      shapes,
      width,
      height,
    );
    zip.file(`map_${layer}.png`, await canvasToBlob(rendered.canvas));
    rendered.canvas.width = rendered.canvas.height = 1;
  }
  const preview = await renderExportPreview(tiles, shapes, width, height);
  zip.file('map_composite.png', await canvasToBlob(preview.canvas));
  zip.file(
    'png_manifest.json',
    JSON.stringify(
      {
        layers,
        composition: preview.composition,
        width: preview.width,
        height: preview.height,
        originX: preview.originX,
        originY: preview.originY,
      },
      null,
      2,
    ),
  );
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  return {
    blob,
    fileName: `${safeFileName(name.replace(/\.[^.]+$/, ''))}_all_png.zip`,
    layers,
  };
}
export async function downloadAllPng(
  ...args: Parameters<typeof createAllPngPackage>
) {
  const result = await createAllPngPackage(...args);
  downloadBlob(result.blob, result.fileName);
  return result;
}
export async function createMatteReference(
  object: ImageAsset,
  background: 'black' | 'white',
) {
  const canvas = document.createElement('canvas');
  canvas.width = object.width;
  canvas.height = object.height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  const image = await loadImage(object.url);
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let transparent = false;
  for (let i = 3; i < pixels.length; i += 4)
    if (pixels[i] < 255) {
      transparent = true;
      break;
    }
  if (!transparent)
    throw new Error(
      '物件图片没有透明背景，请先上传透明物件或在像素精修中去背。',
    );
  context.globalCompositeOperation = 'destination-over';
  context.fillStyle = background === 'black' ? '#000' : '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  return canvasToBlob(canvas);
}
