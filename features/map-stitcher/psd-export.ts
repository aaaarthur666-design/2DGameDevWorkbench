import { downloadBlob, safeFileName } from './image-utils';
import type { FrameRoninTile, MapDisplayLayer, RegionShape } from './frame-ronin-types';
import { renderStitchedMap } from './layer-engine';

class BinaryWriter {
  private chunks: Uint8Array[] = [];
  private byteLength = 0;

  private push(value: Uint8Array) {
    this.chunks.push(value);
    this.byteLength += value.byteLength;
  }

  u8(value: number) { this.push(Uint8Array.of(value & 0xff)); }
  i16(value: number) { this.u16(value < 0 ? 0x10000 + value : value); }
  u16(value: number) { this.push(Uint8Array.of((value >>> 8) & 0xff, value & 0xff)); }
  i32(value: number) { this.u32(value >>> 0); }
  u32(value: number) { this.push(Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)); }
  ascii(value: string) {
    const output = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index += 1) output[index] = value.charCodeAt(index) & 0xff;
    this.push(output);
  }
  raw(value: Uint8Array) { this.push(value); }
  pad(count: number) { if (count > 0) this.push(new Uint8Array(count)); }
  get length() { return this.byteLength; }
  value() {
    const output = new Uint8Array(this.byteLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }
}

interface PsdLayer {
  name: string;
  canvas: HTMLCanvasElement;
  visible: boolean;
}

export async function exportFrameRoninPsd(
  tiles: FrameRoninTile[],
  shapes: RegionShape[],
  sourceWidth: number,
  sourceHeight: number,
  projectName: string,
) {
  const overall = await renderStitchedMap(tiles, 'overall', shapes, sourceWidth, sourceHeight);
  if (overall.width > 30_000 || overall.height > 30_000) throw new Error('PSD 宽高不能超过 30,000 像素');
  if (overall.width * overall.height > 64_000_000) throw new Error('PSD 像素总量过大，请减少地图范围后重试');

  const candidates: Array<{ layer: MapDisplayLayer | 'top'; name: string }> = [
    { layer: 'top', name: 'Top Regions' },
    { layer: 'object', name: 'Object' },
    { layer: 'surface', name: 'Surface' },
    { layer: 'overall', name: 'Overall' },
    { layer: 'mask', name: 'Mask (Derived)' },
    { layer: 'black', name: 'Black Reference' },
    { layer: 'white', name: 'White Reference' },
  ];
  const activeCandidates = candidates.filter((candidate) => hasLayer(candidate.layer, tiles, shapes));
  if (overall.width * overall.height * activeCandidates.length > 160_000_000) {
    throw new Error('PSD 分层像素总量过大，请减少地图范围或图层数量后重试');
  }
  const layers: PsdLayer[] = [];
  for (const candidate of activeCandidates) {
    const rendered = candidate.layer === 'overall'
      ? overall
      : await renderStitchedMap(tiles, candidate.layer, shapes, sourceWidth, sourceHeight);
    layers.push({ name: candidate.name, canvas: rendered.canvas, visible: candidate.layer === 'overall' });
  }

  const layerRecords = new BinaryWriter();
  const layerChannels = new BinaryWriter();
  layerRecords.i16(layers.length);
  const imageData = layers.map((layer) => {
    const context = layer.canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error(`无法读取 PSD 图层：${layer.name}`);
    return { layer, data: context.getImageData(0, 0, overall.width, overall.height) };
  });

  for (const { layer } of imageData) {
    layerRecords.i32(0);
    layerRecords.i32(0);
    layerRecords.i32(overall.height);
    layerRecords.i32(overall.width);
    layerRecords.u16(4);
    for (const id of [0, 1, 2, -1]) {
      layerRecords.i16(id);
      layerRecords.u32(2 + overall.width * overall.height);
    }
    layerRecords.ascii('8BIM');
    layerRecords.ascii('norm');
    layerRecords.u8(255);
    layerRecords.u8(0);
    layerRecords.u8(layer.visible ? 8 : 10);
    layerRecords.u8(0);
    const extra = new BinaryWriter();
    extra.u32(0);
    extra.u32(0);
    writePascalName(extra, layer.name);
    layerRecords.u32(extra.length);
    layerRecords.raw(extra.value());
  }
  for (const { data } of imageData) {
    for (const channel of [0, 1, 2, 3]) {
      layerChannels.u16(0);
      layerChannels.raw(channelBytes(data, channel));
    }
  }

  const layerInfo = new BinaryWriter();
  layerInfo.raw(layerRecords.value());
  layerInfo.raw(layerChannels.value());
  if (layerInfo.length % 2) layerInfo.pad(1);
  const layerMask = new BinaryWriter();
  layerMask.u32(layerInfo.length);
  layerMask.raw(layerInfo.value());
  layerMask.u32(0);

  const compositeContext = overall.canvas.getContext('2d', { willReadFrequently: true });
  if (!compositeContext) throw new Error('无法读取 PSD 合成图');
  const composite = compositeContext.getImageData(0, 0, overall.width, overall.height);
  const writer = new BinaryWriter();
  writer.ascii('8BPS');
  writer.u16(1);
  writer.pad(6);
  writer.u16(4);
  writer.u32(overall.height);
  writer.u32(overall.width);
  writer.u16(8);
  writer.u16(3);
  writer.u32(0);
  writer.u32(0);
  writer.u32(layerMask.length);
  writer.raw(layerMask.value());
  writer.u16(0);
  for (const channel of [0, 1, 2, 3]) writer.raw(channelBytes(composite, channel));
  const blob = new Blob([writer.value()], { type: 'image/vnd.adobe.photoshop' });
  const fileName = `${safeFileName(projectName.replace(/\.[^.]+$/, ''))}_layers.psd`;
  downloadBlob(blob, fileName);
  return { blob, fileName, layers: layers.map((layer) => layer.name) };
}

function hasLayer(layer: MapDisplayLayer | 'top', tiles: FrameRoninTile[], shapes: RegionShape[]) {
  if (layer === 'top') return shapes.some((shape) => shape.layer === 'top');
  if (layer === 'mask') return tiles.some((tile) => tile.images.overall && tile.images.object);
  return tiles.some((tile) => Boolean(tile.images[layer]));
}

function channelBytes(imageData: ImageData, channel: number) {
  const pixels = imageData.width * imageData.height;
  const output = new Uint8Array(pixels);
  for (let index = 0; index < pixels; index += 1) output[index] = imageData.data[index * 4 + channel];
  return output;
}

function writePascalName(writer: BinaryWriter, input: string) {
  const safe = input.replace(/[^ -~]/g, '_').slice(0, 255);
  writer.u8(safe.length);
  writer.ascii(safe);
  const consumed = safe.length + 1;
  writer.pad((4 - (consumed % 4)) % 4);
}
