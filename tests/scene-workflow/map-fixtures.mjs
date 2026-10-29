import JSZip from 'jszip';
import sharp from 'sharp';
import {
  createScene,
  replaceMap,
} from '../../features/scene-composer/model.mjs';
import { createMapProjectPackage } from '../../features/map-stitcher/project-package.mjs';

export async function mapPixels(
  width = 24,
  height = 16,
  color = [45, 75, 105, 255],
) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      data.set(
        [color[0] + (x % 3), color[1] + (y % 3), color[2], color[3]],
        offset,
      );
      if (x === 4 && y === 3) data.fill(0, offset, offset + 4);
    }
  return sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}
export async function sceneMapFixture({
  width = 24,
  height = 16,
  format = 'pixelwork-v2',
  collision = true,
  offset = { x: 19, y: -7 },
} = {}) {
  const bytes = await mapPixels(width, height),
    image = {
      path: 'images/source.png',
      fileName: 'source.png',
      type: 'image/png',
      size: bytes.length,
      width,
      height,
    };
  const shape = {
    id: 'keep-platform',
    tileKey: '0,0',
    mapLayer: 'overall',
    layer: 'collision',
    mode: 'polygon',
    points: [
      { x: 1, y: height - 4 },
      { x: width - 1, y: height - 4 },
      { x: width - 1, y: height - 1 },
    ],
  };
  const shapes = collision ? [shape] : [],
    feather = { top: 0, right: 0, bottom: 0, left: 0 };
  let source;
  if (format === 'forge-map-project') {
    source = await createMapProjectPackage({
      version: 1,
      id: 'fixture-map',
      pending: [],
      snapshot: {
        tiles: [
          {
            key: '0,0',
            x: 0,
            y: 0,
            w: 1,
            h: 1,
            images: {
              overall: {
                name: 'source.png',
                type: 'image/png',
                file: new Blob([bytes], { type: 'image/png' }),
                width,
                height,
              },
            },
            feather,
            hidden: false,
          },
        ],
        shapes,
        selectedKey: '0,0',
        horizontalOverlapPercent: 15,
        verticalOverlapPercent: 15,
        expandSplit: 4,
        pan: { x: 37, y: -13 },
        zoom: 0.8,
        activeMapLayer: 'overall',
        overallPrompt: '保留旧工厂',
        hidePreviewBorders: false,
        hidePreviewCards: true,
        displayVisibility: Object.fromEntries(
          ['overall', 'surface', 'object', 'black', 'white', 'mask'].map(
            (key) => [key, true],
          ),
        ),
        regionVisibility: Object.fromEntries(
          ['collision', 'occlusion', 'adjust', 'top'].map((key) => [key, true]),
        ),
        imageLocks: Object.fromEntries(
          ['overall', 'surface', 'object', 'black', 'white'].map((key) => [
            key,
            false,
          ]),
        ),
        regionLocks: Object.fromEntries(
          ['collision', 'occlusion', 'adjust', 'top'].map((key) => [key, true]),
        ),
      },
    });
  } else {
    const zip = new JSZip();
    zip.file(image.path, bytes);
    zip.file(
      'map_stitch_state.json',
      JSON.stringify({
        format: 'pixelwork-map-stitch-state',
        version: 2,
        source: image,
        tiles: {},
        tileUploads: {},
        tileLayerUploads: {
          surface: {},
          object: {},
          mask: {},
          black: {},
          white: {},
        },
        tileFeathers: { '0,0': feather },
        hiddenPreviewTiles: { '0,0': false },
        drawShapes: shapes,
        selectedKey: '0,0',
        horizontalOverlapPercent: 15,
        verticalOverlapPercent: 15,
        expandSplit: 4,
        pan: { x: 37, y: -13 },
        zoom: 0.8,
        activeMapLayer: 'overall',
        surfaceLayerPrompt: '保留旧工厂',
        hidePreviewBorders: false,
        hidePreviewCards: true,
        workbench: {
          layerLocks: { overall: false, collision: true },
          editorPreferences: { memoryProtection: true },
        },
      }),
    );
    source = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'STORE',
    });
  }
  const scene = createScene('地图扩展测试');
  replaceMap(scene, {
    name: '旧工厂',
    origin: { x: 0, y: 0 },
    offset,
    collisions: shapes.map((shape) => shape.points),
    warnings: ['保留已有地图提示'],
    source: `data:application/zip;base64,${Buffer.from(source).toString('base64')}`,
    layers: [
      {
        id: 'map_overall',
        name: '原底图',
        source: `data:image/png;base64,${bytes.toString('base64')}`,
        width,
        height,
        locked: true,
        hidden: false,
        included: true,
      },
    ],
  });
  return { scene, bytes, source: Buffer.from(source), shape };
}
