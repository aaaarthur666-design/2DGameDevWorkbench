import JSZip from 'jszip';
import {
  CENTER_KEY,
  type EditableLayer,
  type Feather,
  type LayerId,
  type MaskMode,
  type SavedImageReference,
  type SceneMakerState,
  type Tile,
  clamp,
  hasVisibleAsset,
} from './map-types';
import {
  baseFileName,
  canvasToBlob,
  downloadBlob,
  loadImage,
  rectsIntersect,
  safeFileName,
} from './image-utils';

interface RenderedTile {
  tile: Tile;
  canvas: HTMLCanvasElement;
  left: number;
  top: number;
  width: number;
  height: number;
  name: string;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function sourceTile(tiles: Tile[]) {
  const source = tiles.find((tile) => tile.key === CENTER_KEY);
  if (!source?.layers.ground) throw new Error('请先导入地图原图');
  return source;
}

function outputSize(tile: Tile, source: Tile) {
  const sourceAsset = source.layers.ground!;
  return {
    width: Math.max(1, Math.round(tile.w * sourceAsset.width)),
    height: Math.max(1, Math.round(tile.h * sourceAsset.height)),
  };
}

export async function renderTile(
  tile: Tile,
  source: Tile,
  layer: LayerId = 'overall',
  applyFeather = true,
): Promise<HTMLCanvasElement> {
  const { width, height } = outputSize(tile, source);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: applyFeather });
  if (!context) throw new Error('浏览器无法创建图片画布');
  context.imageSmoothingEnabled = false;

  const layers: EditableLayer[] = layer === 'overall' ? ['ground', 'object'] : [layer];
  for (const currentLayer of layers) {
    const asset = tile.layers[currentLayer];
    if (!asset) continue;
    const image = await loadImage(asset.url);
    context.drawImage(image, 0, 0, width, height);
  }

  if (applyFeather && tile.key !== CENTER_KEY) applyFeatherToCanvas(canvas, tile.feather);
  return canvas;
}

export function applyFeatherToCanvas(canvas: HTMLCanvasElement, feather: Feather) {
  if (!Object.values(feather).some(Boolean)) return;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const topEnd = Math.round((feather.top / 100) * canvas.height);
  const rightEnd = Math.round((feather.right / 100) * canvas.width);
  const bottomEnd = Math.round((feather.bottom / 100) * canvas.height);
  const leftEnd = Math.round((feather.left / 100) * canvas.width);
  const topStart = Math.round((Math.max(0, feather.top - 5) / 100) * canvas.height);
  const rightStart = Math.round((Math.max(0, feather.right - 5) / 100) * canvas.width);
  const bottomStart = Math.round((Math.max(0, feather.bottom - 5) / 100) * canvas.height);
  const leftStart = Math.round((Math.max(0, feather.left - 5) / 100) * canvas.width);

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      let alpha = 1;
      if (topEnd > 0 && y < topEnd) alpha *= clamp((y - topStart) / Math.max(1, topEnd - topStart), 0, 1);
      if (bottomEnd > 0 && canvas.height - 1 - y < bottomEnd) {
        alpha *= clamp((canvas.height - 1 - y - bottomStart) / Math.max(1, bottomEnd - bottomStart), 0, 1);
      }
      if (leftEnd > 0 && x < leftEnd) alpha *= clamp((x - leftStart) / Math.max(1, leftEnd - leftStart), 0, 1);
      if (rightEnd > 0 && canvas.width - 1 - x < rightEnd) {
        alpha *= clamp((canvas.width - 1 - x - rightStart) / Math.max(1, rightEnd - rightStart), 0, 1);
      }
      const offset = (y * canvas.width + x) * 4 + 3;
      data[offset] = Math.round(data[offset] * alpha);
    }
  }
  context.putImageData(imageData, 0, 0);
}

function completedTiles(tiles: Tile[], layer: LayerId) {
  return tiles.filter((tile) => hasVisibleAsset(tile, layer));
}

function boundsFor(tiles: Tile[]): Bounds {
  return tiles.reduce(
    (bounds, tile) => ({
      minX: Math.min(bounds.minX, tile.x),
      minY: Math.min(bounds.minY, tile.y),
      maxX: Math.max(bounds.maxX, tile.x + tile.w),
      maxY: Math.max(bounds.maxY, tile.y + tile.h),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

async function renderedTiles(tiles: Tile[], layer: LayerId): Promise<{ items: RenderedTile[]; bounds: Bounds }> {
  const source = sourceTile(tiles);
  const completed = completedTiles(tiles, layer);
  if (!completed.length) throw new Error('当前图层没有可导出的图片');
  const bounds = boundsFor(completed);
  const sourceAsset = source.layers.ground!;
  const items = await Promise.all(
    completed.map(async (tile) => {
      const canvas = await renderTile(tile, source, layer);
      return {
        tile,
        canvas,
        left: Math.round((tile.x - bounds.minX) * sourceAsset.width),
        top: Math.round((tile.y - bounds.minY) * sourceAsset.height),
        width: canvas.width,
        height: canvas.height,
        name: tile.key === CENTER_KEY ? 'source' : `tile_${tile.key.replace(',', '_')}`,
      };
    }),
  );
  return { items, bounds };
}

export async function renderStitchedCanvas(tiles: Tile[], layer: LayerId = 'overall') {
  const source = sourceTile(tiles);
  const sourceAsset = source.layers.ground!;
  const { items, bounds } = await renderedTiles(tiles, layer);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) * sourceAsset.width));
  canvas.height = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) * sourceAsset.height));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法创建导出画布');
  context.imageSmoothingEnabled = false;
  for (const item of items) context.drawImage(item.canvas, item.left, item.top);
  return { canvas, items, bounds };
}

export async function exportPng(tiles: Tile[], layer: LayerId = 'overall') {
  const source = sourceTile(tiles);
  const { canvas } = await renderStitchedCanvas(tiles, layer);
  const blob = await canvasToBlob(canvas);
  downloadBlob(blob, `${baseFileName(source.layers.ground!.name)}_stitched.png`);
}

export async function createOverlapTemplate(tiles: Tile[], target: Tile, layer: LayerId) {
  const source = sourceTile(tiles);
  const sourceAsset = source.layers.ground!;
  const width = Math.max(1, Math.round(target.w * sourceAsset.width));
  const height = Math.max(1, Math.round(target.h * sourceAsset.height));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法创建模板画布');
  context.imageSmoothingEnabled = false;
  const neighbors = completedTiles(tiles, layer).filter((tile) => tile.key !== target.key && rectsIntersect(tile, target));
  if (!neighbors.length) throw new Error('周边没有可用于生成重叠像素的已完成图片');
  for (const neighbor of neighbors) {
    const neighborCanvas = await renderTile(neighbor, source, layer);
    const x = Math.round((neighbor.x - target.x) * sourceAsset.width);
    const y = Math.round((neighbor.y - target.y) * sourceAsset.height);
    context.drawImage(neighborCanvas, x, y);
  }
  return canvas;
}

export async function downloadOverlapTemplate(tiles: Tile[], target: Tile, layer: LayerId) {
  const source = sourceTile(tiles);
  const canvas = await createOverlapTemplate(tiles, target, layer);
  const blob = await canvasToBlob(canvas);
  downloadBlob(
    blob,
    `${baseFileName(source.layers.ground!.name)}_${target.key.replace(',', '_')}_overlap_template.png`,
  );
}

export async function downloadTileLayer(tiles: Tile[], target: Tile, layer: LayerId) {
  if (!hasVisibleAsset(target, layer)) throw new Error('当前图层没有可下载的图片');
  const source = sourceTile(tiles);
  const canvas = await renderTile(target, source, layer);
  const blob = await canvasToBlob(canvas);
  const layerName = layer === 'overall' ? 'overall' : layer;
  downloadBlob(blob, `${baseFileName(source.layers.ground!.name)}_${target.key.replace(',', '_')}_${layerName}.png`);
}

function mirrorUnit(value: number) {
  const wrapped = ((value % 2) + 2) % 2;
  return wrapped <= 1 ? wrapped : 2 - wrapped;
}

function distanceBetweenTiles(a: Tile, b: Tile) {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;
  return Math.hypot(ax - bx, ay - by);
}

export async function generateLocalExpansion(
  tiles: Tile[],
  target: Tile,
  layer: LayerId,
  _maskMode: MaskMode,
) {
  const source = sourceTile(tiles);
  const sourceAsset = source.layers.ground!;
  const candidates = completedTiles(tiles, layer).filter((tile) => tile.key !== target.key);
  if (!candidates.length) throw new Error('周边没有可用于扩图的图片');
  candidates.sort((a, b) => distanceBetweenTiles(a, target) - distanceBetweenTiles(b, target));
  const nearest = candidates[0];
  const nearestCanvas = await renderTile(nearest, source, layer, false);
  const nearestContext = nearestCanvas.getContext('2d', { willReadFrequently: true });
  if (!nearestContext) throw new Error('无法读取邻接图片');
  const sourcePixels = nearestContext.getImageData(0, 0, nearestCanvas.width, nearestCanvas.height).data;
  const width = Math.max(1, Math.round(target.w * sourceAsset.width));
  const height = Math.max(1, Math.round(target.h * sourceAsset.height));
  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const context = output.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法创建扩图画布');
  const imageData = context.createImageData(width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const worldX = target.x + (x / Math.max(1, width - 1)) * target.w;
      const worldY = target.y + (y / Math.max(1, height - 1)) * target.h;
      const u = mirrorUnit((worldX - nearest.x) / nearest.w);
      const v = mirrorUnit((worldY - nearest.y) / nearest.h);
      const sx = clamp(Math.round(u * (nearestCanvas.width - 1)), 0, nearestCanvas.width - 1);
      const sy = clamp(Math.round(v * (nearestCanvas.height - 1)), 0, nearestCanvas.height - 1);
      const sourceOffset = (sy * nearestCanvas.width + sx) * 4;
      const targetOffset = (y * width + x) * 4;
      imageData.data[targetOffset] = sourcePixels[sourceOffset];
      imageData.data[targetOffset + 1] = sourcePixels[sourceOffset + 1];
      imageData.data[targetOffset + 2] = sourcePixels[sourceOffset + 2];
      imageData.data[targetOffset + 3] = sourcePixels[sourceOffset + 3];
    }
  }
  context.putImageData(imageData, 0, 0);

  for (const neighbor of candidates.filter((tile) => rectsIntersect(tile, target))) {
    const neighborCanvas = await renderTile(neighbor, source, layer, false);
    const x = Math.round((neighbor.x - target.x) * sourceAsset.width);
    const y = Math.round((neighbor.y - target.y) * sourceAsset.height);
    context.drawImage(neighborCanvas, x, y);
  }
  return canvasToBlob(output);
}

export async function generateLayerVariant(
  tiles: Tile[],
  target: Tile,
  mode: 'black' | 'white' | 'object',
) {
  if (!target.layers.ground && !target.layers.object) throw new Error('当前卡片没有可用于提取图层的整体图片');
  const source = sourceTile(tiles);
  const input = await renderTile(target, source, 'overall', false);
  const context = input.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('浏览器无法读取图层图片');
  const imageData = context.getImageData(0, 0, input.width, input.height);
  const data = imageData.data;
  const samplePoints = [
    0,
    (input.width - 1) * 4,
    (input.height - 1) * input.width * 4,
    ((input.height - 1) * input.width + input.width - 1) * 4,
  ];
  const background = [0, 1, 2].map((channel) =>
    samplePoints.reduce((total, offset) => total + data[offset + channel], 0) / samplePoints.length,
  );

  for (let index = 0; index < data.length; index += 4) {
    const distance = Math.sqrt(
      (data[index] - background[0]) ** 2 +
      (data[index + 1] - background[1]) ** 2 +
      (data[index + 2] - background[2]) ** 2,
    );
    const foreground = clamp((distance - 18) / 58, 0, 1) * (data[index + 3] / 255);
    if (mode === 'object') {
      data[index + 3] = Math.round(foreground * 255);
      continue;
    }
    const backdrop = mode === 'black' ? 0 : 255;
    for (let channel = 0; channel < 3; channel += 1) {
      data[index + channel] = Math.round(backdrop * (1 - foreground) + data[index + channel] * foreground);
    }
    data[index + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
  return canvasToBlob(input);
}

export async function exportStateZip(
  tiles: Tile[],
  state: Omit<SceneMakerState, 'version' | 'format' | 'savedAt' | 'tiles'>,
) {
  const source = sourceTile(tiles);
  const zip = new JSZip();
  const images = zip.folder('images')!;
  const usedNames = new Set<string>();

  const uniqueName = (candidate: string) => {
    const safe = safeFileName(candidate);
    const dot = safe.lastIndexOf('.');
    const stem = dot > 0 ? safe.slice(0, dot) : safe;
    const extension = dot > 0 ? safe.slice(dot) : '';
    let result = safe;
    let suffix = 1;
    while (usedNames.has(result)) result = `${stem}_${suffix++}${extension}`;
    usedNames.add(result);
    return result;
  };

  const savedTiles = await Promise.all(
    tiles.map(async (tile) => {
      const layers: SavedTileLayers = {};
      for (const layer of ['ground', 'object', 'black', 'white'] as const) {
        const asset = tile.layers[layer];
        if (!asset) continue;
        const name = uniqueName(`${tile.key === CENTER_KEY ? 'source' : `tile_${tile.key.replace(',', '_')}`}_${layer}_${asset.name}`);
        const path = `images/${name}`;
        images.file(name, asset.file);
        layers[layer] = {
          fileName: asset.name,
          type: asset.type,
          size: asset.size,
          width: asset.width,
          height: asset.height,
          path,
        };
      }
      return {
        key: tile.key,
        x: tile.x,
        y: tile.y,
        w: tile.w,
        h: tile.h,
        feather: tile.feather,
        hidden: tile.hidden,
        layers,
      };
    }),
  );

  const manifest: SceneMakerState = {
    version: 3,
    format: 'scenemaker-map-stitch-state',
    savedAt: new Date().toISOString(),
    tiles: savedTiles,
    ...state,
  };
  zip.file('map_stitch_state.json', JSON.stringify(manifest, null, 2));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  downloadBlob(blob, `${baseFileName(source.layers.ground!.name)}_map_stitch_state.zip`);
}

type SavedTileLayers = Partial<Record<EditableLayer, SavedImageReference>>;

export async function exportGodot(tiles: Tile[], horizontalOverlapPercent: number, verticalOverlapPercent: number) {
  const source = sourceTile(tiles);
  const sourceAsset = source.layers.ground!;
  const { items, bounds } = await renderedTiles(tiles, 'overall');
  const zip = new JSZip();
  const images = zip.folder('images')!;
  const manifestTiles = [];
  const resources: string[] = [];
  const nodes: string[] = [];

  let resourceIndex = 0;
  const zOrder: Record<EditableLayer, number> = { ground: 0, object: 10, black: 30, white: 40 };
  for (const item of items) {
    for (const layer of ['ground', 'object', 'black', 'white'] as const) {
      if (!item.tile.layers[layer]) continue;
      resourceIndex += 1;
      const layerCanvas = await renderTile(item.tile, source, layer);
      const imageName = `${item.name}_${layer}.png`;
      images.file(imageName, await canvasToBlob(layerCanvas));
      const resourceId = `tex_${resourceIndex}`;
      resources.push(`[ext_resource type="Texture2D" path="res://images/${imageName}" id="${resourceId}"]`);
      nodes.push(
        `[node name="${item.name}_${layer}" type="Sprite2D" parent="."]\nposition = Vector2(${item.left}, ${item.top})\ncentered = false\nz_index = ${zOrder[layer]}\n${layer === 'black' || layer === 'white' ? 'visible = false\n' : ''}texture = ExtResource("${resourceId}")`,
      );
      manifestTiles.push({
        key: item.tile.key,
        name: `${item.name}_${layer}`,
        layer,
        image: `images/${imageName}`,
        pixel: { x: item.left, y: item.top, width: layerCanvas.width, height: layerCanvas.height },
        tile: { x: item.tile.x, y: item.tile.y, w: item.tile.w, h: item.tile.h },
        feather: item.tile.feather,
      });
    }
  }

  const width = Math.ceil((bounds.maxX - bounds.minX) * sourceAsset.width);
  const height = Math.ceil((bounds.maxY - bounds.minY) * sourceAsset.height);
  const manifest = {
    version: 2,
    generator: 'SceneMaker',
    coordinate_system: 'top_left_origin_y_down_pixels',
    canvas: { width, height },
    source: { file: sourceAsset.name, width: sourceAsset.width, height: sourceAsset.height },
    overlap: { horizontal_percent: horizontalOverlapPercent, vertical_percent: verticalOverlapPercent },
    tiles: manifestTiles,
  };
  zip.file('map_stitch_godot.json', JSON.stringify(manifest, null, 2));
  zip.file(
    'map_stitch_godot.tscn',
    `[gd_scene load_steps=${resourceIndex + 1} format=3]\n\n${resources.join('\n')}\n\n[node name="${baseFileName(sourceAsset.name)}" type="Node2D"]\n\n${nodes.join('\n\n')}\n`,
  );
  zip.file('README.txt', '将 images、map_stitch_godot.json 与 map_stitch_godot.tscn 复制到 Godot 4 项目中，然后打开场景文件。\n');
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `${baseFileName(sourceAsset.name)}_godot_package.zip`);
}

function stableGuid(input: string) {
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    a = Math.imul(a ^ input.charCodeAt(index), 0x01000193);
    b = Math.imul(b ^ (input.charCodeAt(index) + index), 0x85ebca6b);
  }
  const part = (value: number) => (value >>> 0).toString(16).padStart(8, '0');
  return `${part(a)}${part(b)}${part(a ^ b)}${part(Math.imul(a, b))}`.slice(0, 32);
}

function unityTextureMeta(guid: string) {
  return `fileFormatVersion: 2\nguid: ${guid}\nTextureImporter:\n  internalIDToNameTable: []\n  externalObjects: {}\n  serializedVersion: 13\n  mipmaps:\n    mipMapMode: 0\n    enableMipMap: 0\n  isReadable: 0\n  textureType: 8\n  textureShape: 1\n  sRGBTexture: 1\n  alphaSource: 1\n  alphaIsTransparency: 1\n  spriteMode: 1\n  spritePixelsToUnits: 100\n  spriteAlignment: 7\n  spritePivot: {x: 0, y: 1}\n  filterMode: 0\n  wrapU: 1\n  wrapV: 1\n  maxTextureSize: 8192\n`;
}

export async function exportUnity(tiles: Tile[], horizontalOverlapPercent: number, verticalOverlapPercent: number) {
  const source = sourceTile(tiles);
  const sourceAsset = source.layers.ground!;
  const { items, bounds } = await renderedTiles(tiles, 'overall');
  const zip = new JSZip();
  const root = zip.folder('Assets/SceneMaker')!;
  const textures = root.folder('Textures')!;
  const data = root.folder('Data')!;
  const editor = root.folder('Editor')!;
  const manifestTiles = [];

  for (const item of items) {
    const imageName = `${item.name}.png`;
    const imagePath = `Assets/SceneMaker/Textures/${imageName}`;
    const guid = stableGuid(`${sourceAsset.name}:${item.name}`);
    textures.file(imageName, await canvasToBlob(item.canvas));
    textures.file(`${imageName}.meta`, unityTextureMeta(guid));
    manifestTiles.push({
      key: item.tile.key,
      name: item.name,
      image: imagePath,
      x: item.left,
      y: item.top,
      width: item.width,
      height: item.height,
      guid,
    });
  }

  const manifest = {
    version: 1,
    generator: 'SceneMaker',
    pixelsPerUnit: 100,
    canvas: {
      width: Math.ceil((bounds.maxX - bounds.minX) * sourceAsset.width),
      height: Math.ceil((bounds.maxY - bounds.minY) * sourceAsset.height),
    },
    overlap: { horizontal_percent: horizontalOverlapPercent, vertical_percent: verticalOverlapPercent },
    tiles: manifestTiles,
  };
  data.file('map_stitch_unity.json', JSON.stringify(manifest, null, 2));
  editor.file(
    'SceneMakerImporter.cs',
    `using System;\nusing UnityEditor;\nusing UnityEngine;\n\npublic static class SceneMakerImporter {\n  [Serializable] private class Manifest { public float pixelsPerUnit = 100; public TileRecord[] tiles; }\n  [Serializable] private class TileRecord { public string key; public string name; public string image; public float x; public float y; public int width; public int height; }\n\n  [MenuItem("Tools/SceneMaker/Create Map From Manifest")]\n  public static void CreateMap() {\n    var jsonAsset = AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/SceneMaker/Data/map_stitch_unity.json");\n    if (jsonAsset == null) { Debug.LogError("SceneMaker manifest not found."); return; }\n    var manifest = JsonUtility.FromJson<Manifest>(jsonAsset.text);\n    if (manifest == null || manifest.tiles == null) { Debug.LogError("SceneMaker manifest is invalid."); return; }\n    var root = new GameObject("SceneMaker Map");\n    Undo.RegisterCreatedObjectUndo(root, "Create SceneMaker Map");\n    for (var i = 0; i < manifest.tiles.Length; i++) {\n      var tile = manifest.tiles[i];\n      var sprite = AssetDatabase.LoadAssetAtPath<Sprite>(tile.image);\n      if (sprite == null) { Debug.LogWarning("Missing sprite: " + tile.image); continue; }\n      var child = new GameObject(tile.name);\n      child.transform.SetParent(root.transform, false);\n      child.transform.localPosition = new Vector3(tile.x / manifest.pixelsPerUnit, -tile.y / manifest.pixelsPerUnit, -i * 0.001f);\n      child.AddComponent<SpriteRenderer>().sprite = sprite;\n    }\n    Selection.activeObject = root;\n    EditorGUIUtility.PingObject(root);\n  }\n}\n`,
  );
  root.file('README.txt', '解压到 Unity 项目根目录。Unity 会以 Point Filter / Sprite 模式导入图片。导入完成后使用菜单 Tools > SceneMaker > Create Map From Manifest 自动创建地图对象。\n');
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `${baseFileName(sourceAsset.name)}_unity_package.zip`);
}

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

export async function exportPsd(tiles: Tile[]) {
  const source = sourceTile(tiles);
  const { canvas, items } = await renderStitchedCanvas(tiles, 'overall');
  if (canvas.width > 30_000 || canvas.height > 30_000) throw new Error('PSD 宽高不能超过 30,000 像素');
  if (canvas.width * canvas.height > 64_000_000) throw new Error('PSD 像素总量过大，请减少地图范围后重试');

  const psdItems: RenderedTile[] = [];
  for (const item of items) {
    for (const layer of ['ground', 'object', 'black', 'white'] as const) {
      if (!item.tile.layers[layer]) continue;
      psdItems.push({
        ...item,
        canvas: await renderTile(item.tile, source, layer),
        name: `${item.name}_${layer}`,
      });
    }
  }

  const layerRecords = new BinaryWriter();
  const layerChannels = new BinaryWriter();
  layerRecords.i16(psdItems.length);

  const itemData = psdItems.map((item) => {
    const context = item.canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('无法读取 PSD 图层');
    return { item, imageData: context.getImageData(0, 0, item.canvas.width, item.canvas.height) };
  });

  for (const { item } of itemData) {
    layerRecords.i32(item.top);
    layerRecords.i32(item.left);
    layerRecords.i32(item.top + item.height);
    layerRecords.i32(item.left + item.width);
    layerRecords.u16(4);
    for (const id of [0, 1, 2, -1]) {
      layerRecords.i16(id);
      layerRecords.u32(2 + item.width * item.height);
    }
    layerRecords.ascii('8BIM');
    layerRecords.ascii('norm');
    layerRecords.u8(255);
    layerRecords.u8(0);
    layerRecords.u8(8);
    layerRecords.u8(0);
    const extra = new BinaryWriter();
    extra.u32(0);
    extra.u32(0);
    writePascalName(extra, item.name);
    layerRecords.u32(extra.length);
    layerRecords.raw(extra.value());
  }

  for (const { imageData } of itemData) {
    for (const channel of [0, 1, 2, 3]) {
      layerChannels.u16(0);
      layerChannels.raw(channelBytes(imageData, channel));
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

  const compositeContext = canvas.getContext('2d', { willReadFrequently: true });
  if (!compositeContext) throw new Error('无法读取 PSD 合成图');
  const composite = compositeContext.getImageData(0, 0, canvas.width, canvas.height);

  const writer = new BinaryWriter();
  writer.ascii('8BPS');
  writer.u16(1);
  writer.pad(6);
  writer.u16(4);
  writer.u32(canvas.height);
  writer.u32(canvas.width);
  writer.u16(8);
  writer.u16(3);
  writer.u32(0);
  writer.u32(0);
  writer.u32(layerMask.length);
  writer.raw(layerMask.value());
  writer.u16(0);
  for (const channel of [0, 1, 2, 3]) writer.raw(channelBytes(composite, channel));
  downloadBlob(new Blob([writer.value()], { type: 'image/vnd.adobe.photoshop' }), `${baseFileName(source.layers.ground!.name)}_stitched.psd`);
}

export async function loadGodotPackage(file: File) {
  const zip = await JSZip.loadAsync(file);
  const manifestFile = zip.file('map_stitch_godot.json');
  if (!manifestFile) throw new Error('压缩包中缺少 map_stitch_godot.json');
  const manifest = JSON.parse(await manifestFile.async('string')) as {
    source?: { width?: number; height?: number };
    overlap?: { horizontal_percent?: number; vertical_percent?: number };
    tiles?: Array<{
      key: string;
      layer?: EditableLayer;
      image: string;
      tile: { x: number; y: number; w: number; h: number };
      feather?: Feather;
    }>;
  };
  if (!Array.isArray(manifest.tiles) || !manifest.tiles.length) throw new Error('Godot 地图清单中没有图片块');
  const records = [];
  for (const record of manifest.tiles) {
    const imageFile = zip.file(record.image);
    if (!imageFile) continue;
    records.push({ record, blob: await imageFile.async('blob') });
  }
  return { manifest, records };
}

export async function readStatePackage(file: File) {
  let manifest: unknown;
  let zip: JSZip | null = null;
  if (file.name.toLowerCase().endsWith('.zip')) {
    zip = await JSZip.loadAsync(file);
    const manifestFile = zip.file('map_stitch_state.json');
    if (!manifestFile) throw new Error('压缩包中缺少 map_stitch_state.json');
    manifest = JSON.parse(await manifestFile.async('string'));
  } else {
    manifest = JSON.parse(await file.text());
  }
  return { manifest, zip };
}

export async function imageReferenceToBlob(reference: SavedImageReference, zip: JSZip | null) {
  if (reference.path && zip) {
    const imageFile = zip.file(reference.path);
    if (!imageFile) throw new Error(`状态包缺少图片：${reference.path}`);
    const blob = await imageFile.async('blob');
    return new Blob([blob], { type: reference.type || blob.type || 'image/png' });
  }
  if (reference.dataUrl) {
    const response = await fetch(reference.dataUrl);
    return response.blob();
  }
  throw new Error(`图片 ${reference.fileName} 没有可读取的数据`);
}
