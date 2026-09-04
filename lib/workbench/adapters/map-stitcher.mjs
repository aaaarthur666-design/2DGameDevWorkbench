import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import JSZip from 'jszip';
import sharp from 'sharp';

import { bearerHeaders, requestJson } from './http.mjs';

const IMAGE_LAYERS = new Set(['overall', 'surface', 'object', 'black', 'white']);
const REGION_LAYERS = new Set(['occlusion', 'collision', 'adjust', 'top']);
const REGION_MODES = new Set(['rectangle', 'polygon', 'free']);

export function validateMapStitcherInput(input) {
  const errors = [];
  if (input.operation === 'compose') {
    if (!Array.isArray(input.images) || input.images.length === 0) {
      errors.push('images must contain at least one repository path or data:image URL for compose.');
    }
    if (Number.isInteger(input.columns) && Number.isInteger(input.rows) && input.columns * input.rows < (input.images?.length ?? 0)) {
      errors.push('columns * rows must have room for every image.');
    }
    for (const [index, region] of (input.regions ?? []).entries()) {
      const message = validateRegion(region);
      if (message) errors.push(`regions[${index}] ${message}`);
    }
  } else if (input.operation === 'generate-layer') {
    if (typeof input.image !== 'string' || !input.image.startsWith('data:image/')) {
      errors.push('image must be a data:image URL for generate-layer.');
    }
    if (typeof input.prompt !== 'string' || !input.prompt.trim()) {
      errors.push('prompt is required for generate-layer.');
    }
    if (!input.tile || typeof input.tile !== 'object' || Array.isArray(input.tile)) {
      errors.push('tile is required for generate-layer.');
    }
    if (!IMAGE_LAYERS.has(input.layer)) errors.push('layer is invalid for generate-layer.');
    if (input.mask_mode !== 'black' && input.mask_mode !== 'white') {
      errors.push('mask_mode must be black or white for generate-layer.');
    }
  }
  return errors;
}

export function mapStitcherConfigured() {
  return true;
}

export async function executeMapStitcher(context) {
  if (context.input.operation === 'generate-layer') return generateLayer(context);
  if (context.input.operation === 'compose') return composeMap(context);
  throw new Error(`Unsupported map-stitcher operation: ${context.input.operation}`);
}

async function generateLayer({ capability, input, outputDirectory }) {
  const connector = capability.connector;
  const url = process.env[connector.generationUrlEnv];
  if (!url) {
    return {
      status: 'awaiting_configuration',
      requiredEnvironment: connector.generationUrlEnv,
      result: null,
      adapter: { id: 'map-stitcher', operation: input.operation },
    };
  }
  const token = connector.generationTokenEnv
    ? process.env[connector.generationTokenEnv]
    : undefined;
  const request = {
    image: input.image,
    prompt: input.prompt,
    tile: input.tile,
    layer: input.layer,
    mask_mode: input.mask_mode,
  };
  const payload = await requestJson(url, {
    method: 'POST',
    headers: bearerHeaders(token),
    body: JSON.stringify(request),
    timeoutMs: 120_000,
  });
  const record = payload && typeof payload === 'object' ? payload : {};
  const nested = record.result && typeof record.result === 'object' ? record.result : record;
  const image = nested.image ?? nested.data ?? nested.url;
  if (typeof image !== 'string' || !image) {
    throw new Error('Map generation service did not return image, data, or url.');
  }

  const outputs = [];
  const imageBuffer = decodeImageValue(image);
  if (imageBuffer) {
    const imagePath = path.join(outputDirectory, 'generated-layer.png');
    await sharp(imageBuffer).png().toFile(imagePath);
    outputs.push('generated-layer.png');
  }
  return {
    status: 'completed',
    result: { image, layer: input.layer, tile: input.tile },
    generatedOutputNames: outputs,
    adapter: { id: 'map-stitcher', operation: input.operation },
  };
}

async function composeMap({ input, outputDirectory, repositoryRoot }) {
  const sources = await Promise.all(
    input.images.map((value, index) => readImageSource(value, index, repositoryRoot)),
  );
  const firstMetadata = await sharp(sources[0].buffer).metadata();
  const tileWidth = input.tileSize ?? firstMetadata.width;
  const tileHeight = input.tileSize ?? firstMetadata.height;
  if (!tileWidth || !tileHeight) throw new Error('Could not determine the tile dimensions.');

  const columns = input.columns ?? Math.ceil(Math.sqrt(sources.length));
  const rows = input.rows ?? Math.ceil(sources.length / columns);
  if (columns * rows < sources.length) throw new Error('The requested grid is smaller than the image list.');

  const normalizedTiles = await Promise.all(
    sources.map(async (source) => ({
      ...source,
      png: await sharp(source.buffer)
        .resize(tileWidth, tileHeight, { fit: 'fill', kernel: sharp.kernel.nearest })
        .ensureAlpha()
        .png()
        .toBuffer(),
    })),
  );
  const width = columns * tileWidth;
  const height = rows * tileHeight;
  const stitched = await sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(normalizedTiles.map((tile, index) => ({
      input: tile.png,
      left: (index % columns) * tileWidth,
      top: Math.floor(index / columns) * tileHeight,
    })))
    .png()
    .toBuffer();

  const stitchedPath = path.join(outputDirectory, 'stitched-map.png');
  await writeFile(stitchedPath, stitched);
  const seamReport = input.checkSeams === false
    ? { checked: false, seams: [], warningCount: 0 }
    : await inspectSeams(stitched, width, height, tileWidth, tileHeight, columns, rows, sources.length);
  await writeFile(
    path.join(outputDirectory, 'seam-report.json'),
    `${JSON.stringify(seamReport, null, 2)}\n`,
    'utf8',
  );

  const regions = Array.isArray(input.regions) ? input.regions : [];
  await writeFile(
    path.join(outputDirectory, 'region-annotations.json'),
    `${JSON.stringify({ schemaVersion: 1, regions }, null, 2)}\n`,
    'utf8',
  );
  const state = await createStatePackage(normalizedTiles, {
    columns,
    tileWidth,
    tileHeight,
    regions,
  });
  await writeFile(path.join(outputDirectory, 'pixelwork-state.zip'), state);

  const generatedOutputNames = [
    'stitched-map.png',
    'seam-report.json',
    'region-annotations.json',
    'pixelwork-state.zip',
  ];
  const engineTargets = Array.isArray(input.engineTargets) ? input.engineTargets : [];
  for (const target of engineTargets) {
    const fileName = `${target}-package.zip`;
    await writeFile(
      path.join(outputDirectory, fileName),
      await createEnginePackage(target, stitched, regions, width, height),
    );
    generatedOutputNames.push(fileName);
  }

  return {
    status: 'completed',
    result: {
      stitchedMap: 'stitched-map.png',
      seamReport: 'seam-report.json',
      statePackage: 'pixelwork-state.zip',
      regionAnnotations: 'region-annotations.json',
      godotPackage: generatedOutputNames.includes('godot-package.zip') ? 'godot-package.zip' : null,
      unityPackage: generatedOutputNames.includes('unity-package.zip') ? 'unity-package.zip' : null,
      metadata: { imageCount: sources.length, columns, rows, tileWidth, tileHeight, width, height },
    },
    generatedOutputNames,
    adapter: { id: 'map-stitcher', operation: input.operation },
  };
}

async function readImageSource(value, index, repositoryRoot) {
  if (typeof value !== 'string') throw new Error(`images[${index}] must be a string.`);
  if (value.startsWith('data:image/')) {
    const buffer = decodeDataImage(value);
    return { name: `tile_${String(index).padStart(3, '0')}.png`, buffer };
  }
  const candidate = path.resolve(repositoryRoot, value);
  const root = `${await realpath(repositoryRoot)}${path.sep}`;
  const resolved = await realpath(candidate).catch(() => null);
  if (!resolved || (!`${resolved}${path.sep}`.startsWith(root) && resolved !== root.slice(0, -1))) {
    throw new Error(`images[${index}] must resolve to a file inside the repository.`);
  }
  if (!/\.(png|jpe?g|jfif|webp)$/i.test(resolved)) {
    throw new Error(`images[${index}] is not a supported image file.`);
  }
  return { name: path.basename(resolved), buffer: await readFile(resolved) };
}

function decodeDataImage(value) {
  const match = /^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\s]+)$/i.exec(value);
  if (!match) throw new Error('Only base64 data:image URLs are supported.');
  if (match[1].length > 56_000_000) throw new Error('Image data exceeds the 40 MB adapter limit.');
  return Buffer.from(match[1], 'base64');
}

function decodeImageValue(value) {
  if (value.startsWith('data:image/')) return decodeDataImage(value);
  if (/^[a-z0-9+/=\s]+$/i.test(value) && value.length >= 64) return Buffer.from(value, 'base64');
  return null;
}

async function inspectSeams(buffer, width, height, tileWidth, tileHeight, columns, rows, imageCount) {
  const { data } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const seams = [];
  for (let column = 1; column < columns; column += 1) {
    const x = column * tileWidth;
    seams.push(compareLine(data, width, height, { orientation: 'vertical', coordinate: x }));
  }
  for (let row = 1; row < rows; row += 1) {
    if (row * columns >= imageCount) break;
    const y = row * tileHeight;
    seams.push(compareLine(data, width, height, { orientation: 'horizontal', coordinate: y }));
  }
  return {
    checked: true,
    threshold: 32,
    seams,
    warningCount: seams.filter((seam) => seam.meanDifference > 32).length,
  };
}

function compareLine(data, width, height, seam) {
  let difference = 0;
  let samples = 0;
  const compare = (left, right) => {
    if (data[left + 3] === 0 && data[right + 3] === 0) return;
    difference += Math.abs(data[left] - data[right]);
    difference += Math.abs(data[left + 1] - data[right + 1]);
    difference += Math.abs(data[left + 2] - data[right + 2]);
    samples += 3;
  };
  if (seam.orientation === 'vertical') {
    for (let y = 0; y < height; y += 1) {
      compare((y * width + seam.coordinate - 1) * 4, (y * width + seam.coordinate) * 4);
    }
  } else {
    for (let x = 0; x < width; x += 1) {
      compare(((seam.coordinate - 1) * width + x) * 4, (seam.coordinate * width + x) * 4);
    }
  }
  return { ...seam, meanDifference: samples ? Math.round((difference / samples) * 100) / 100 : 0 };
}

async function createStatePackage(tiles, options) {
  const zip = new JSZip();
  const folder = zip.folder('images');
  const references = [];
  for (const [index, tile] of tiles.entries()) {
    const fileName = `tile_${String(index).padStart(3, '0')}.png`;
    folder.file(fileName, tile.png);
    references.push({
      fileName,
      type: 'image/png',
      size: tile.png.length,
      width: options.tileWidth,
      height: options.tileHeight,
      path: `images/${fileName}`,
    });
  }
  const geometry = {};
  const uploads = {};
  const feathers = { '0,0': { top: 0, right: 0, bottom: 0, left: 0 } };
  const hidden = { '0,0': false };
  for (let index = 1; index < tiles.length; index += 1) {
    const column = index % options.columns;
    const row = Math.floor(index / options.columns);
    const key = `${column},${row}`;
    geometry[key] = { x: column, y: row, w: 1, h: 1 };
    uploads[key] = references[index];
    feathers[key] = { top: 0, right: 0, bottom: 0, left: 0 };
    hidden[key] = false;
  }
  const state = {
    version: 2,
    savedAt: new Date().toISOString(),
    format: 'pixelwork-map-stitch-state',
    source: references[0],
    tiles: geometry,
    tileUploads: uploads,
    tileLayerUploads: { surface: {}, object: {}, mask: {}, black: {}, white: {} },
    tileFeathers: feathers,
    selectedKey: '0,0',
    horizontalOverlapPercent: 0,
    verticalOverlapPercent: 0,
    expandSplit: 4,
    pan: { x: 0, y: 0 },
    zoom: 1,
    hidePreviewBorders: false,
    hidePreviewCards: false,
    activeMapLayer: 'overall',
    surfaceLayerPrompt: '',
    blackLayerPrompt: '',
    whiteLayerPrompt: '',
    memoryProtectionEnabled: true,
    memoryProtectionLimitMb: 1024,
    godotExportScaleEnabled: false,
    godotExportScalePercent: 100,
    godotTextureFilterEnabled: true,
    godotObjectMaskLayerEnabled: true,
    hiddenPreviewTiles: hidden,
    drawShapes: options.regions,
  };
  zip.file('map_stitch_state.json', JSON.stringify(state, null, 2));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
}

async function createEnginePackage(target, stitched, regions, width, height) {
  const zip = new JSZip();
  if (target === 'godot') {
    zip.file('map.png', stitched);
    zip.file('regions.json', JSON.stringify({ schemaVersion: 1, regions }, null, 2));
    zip.file('map_stitch.tscn', `[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Texture2D" path="res://map.png" id="1"]\n\n[node name="MapStitch" type="Node2D"]\n\n[node name="Map" type="Sprite2D" parent="."]\ntexture = ExtResource("1")\ncentered = false\n`);
    zip.file('README.md', `# Godot map package\n\nMap size: ${width} x ${height}. Region data is in regions.json.\n`);
  } else if (target === 'unity') {
    zip.file('Assets/Map/map.png', stitched);
    zip.file('Assets/Map/regions.json', JSON.stringify({ schemaVersion: 1, regions }, null, 2));
    zip.file('Assets/Map/README.md', `# Unity map package\n\nMap size: ${width} x ${height}. Import map.png as a Sprite and consume regions.json for collision and sorting areas.\n`);
  } else {
    throw new Error(`Unsupported engine target: ${target}`);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
}

function validateRegion(region) {
  if (!region || typeof region !== 'object' || Array.isArray(region)) return 'must be an object.';
  if (!REGION_LAYERS.has(region.layer)) return 'has an invalid layer.';
  if (!REGION_MODES.has(region.mode)) return 'has an invalid mode.';
  if (typeof region.tileKey !== 'string' || !region.tileKey) return 'must include tileKey.';
  if (!Array.isArray(region.points) || region.points.length < (region.mode === 'rectangle' ? 2 : 3)) {
    return 'does not contain enough points.';
  }
  if (region.points.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return 'contains invalid points.';
  }
  return null;
}
