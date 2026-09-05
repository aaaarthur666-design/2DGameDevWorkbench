// Deterministic, synthetic assets for local UI regression; no external image service.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import JSZip from 'jszip';

const output = path.resolve('work/map-ui-repair/fixtures');
await mkdir(output, { recursive: true });
const svg = (body) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">${body}</svg>`,
  );
const ground =
  '<rect width="320" height="240" fill="#638861"/><path d="M0 110H320M150 0V240" stroke="#dfcea0" stroke-width="48"/><path d="M0 110H320M150 0V240" stroke="#bda576" stroke-width="2" stroke-dasharray="6 8"/>';
const objects =
  '<rect x="36" y="24" width="60" height="58" rx="5" fill="#f07849"/><path d="M30 28L66 5L102 28Z" fill="#983e35"/><circle cx="250" cy="178" r="30" fill="#17462e"/><circle cx="260" cy="166" r="18" fill="#57ad62" fill-opacity="0.7"/>';
const assets = {
  'center.png': await sharp(svg(ground + objects))
    .png()
    .toBuffer(),
  'alternate.png': await sharp(
    svg(
      '<rect width="320" height="240" fill="#486a94"/><path d="M0 0L320 240M320 0L0 240" stroke="#f4d56c" stroke-width="32"/>',
    ),
  )
    .png()
    .toBuffer(),
  'surface.png': await sharp(svg(ground)).png().toBuffer(),
  'object.png': await sharp(svg(objects)).png().toBuffer(),
  'black.png': await sharp(
    svg('<rect width="320" height="240" fill="#000"/>' + objects),
  )
    .png()
    .toBuffer(),
  'white.png': await sharp(
    svg('<rect width="320" height="240" fill="#fff"/>' + objects),
  )
    .png()
    .toBuffer(),
};
for (const [name, data] of Object.entries(assets))
  await writeFile(path.join(output, name), data);
const reference = (name) => ({
  path: `images/${name}`,
  fileName: name,
  type: 'image/png',
  width: 320,
  height: 240,
});
const shape = (id, mapLayer, layer, mode, points) => ({
  id,
  tileKey: '0,0',
  mapLayer,
  layer,
  mode,
  points,
});
const manifest = {
  format: 'pixelwork-map-stitch-state',
  version: 2,
  source: reference('center.png'),
  tiles: { '1,0': { x: 0.75, y: 0, w: 1, h: 1 } },
  tileUploads: { '1,0': reference('alternate.png') },
  tileLayerUploads: {
    surface: { '0,0': reference('surface.png') },
    object: { '0,0': reference('object.png') },
    black: { '0,0': reference('black.png') },
    white: { '0,0': reference('white.png') },
  },
  selectedKey: '0,0',
  activeMapLayer: 'overall',
  pan: { x: 0, y: 0 },
  zoom: 1,
  drawShapes: [
    shape('overall_collision', 'overall', 'collision', 'rectangle', [
      { x: 32, y: 20 },
      { x: 100, y: 84 },
    ]),
    shape('surface_collision', 'surface', 'collision', 'rectangle', [
      { x: 200, y: 145 },
      { x: 296, y: 225 },
    ]),
    shape('object_occlusion', 'object', 'occlusion', 'free', [
      { x: 30, y: 15 },
      { x: 55, y: 15 },
      { x: 55, y: 85 },
      { x: 30, y: 85 },
    ]),
    shape('overall_top', 'overall', 'top', 'polygon', [
      { x: 213, y: 135 },
      { x: 300, y: 137 },
      { x: 302, y: 220 },
      { x: 214, y: 223 },
    ]),
  ],
  workbench: {
    editorPreferences: {
      regionScope: 'view',
      showImage: true,
      showRegions: true,
      concurrency: 1,
      memoryProtection: true,
      memoryLimitMb: 1024,
    },
  },
};
const pack = async (name, state) => {
  const zip = new JSZip();
  zip.file('map_stitch_state.json', JSON.stringify(state, null, 2));
  for (const [assetName, data] of Object.entries(assets))
    zip.file(`images/${assetName}`, data);
  await writeFile(
    path.join(output, name),
    await zip.generateAsync({ type: 'nodebuffer' }),
  );
};
await pack('pixelwork-v2.zip', manifest);
await pack('pixelwork-v1.zip', {
  ...manifest,
  version: 1,
  workbench: undefined,
});
await pack('center-only.zip', {
  ...manifest,
  tiles: {},
  tileUploads: {},
  drawShapes: [],
});
await pack('scenemaker-v5.zip', {
  format: 'scenemaker-map-stitch-state',
  version: 5,
  tiles: [
    {
      key: '0,0',
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      layers: {
        ground: reference('surface.png'),
        object: reference('object.png'),
      },
      feather: { top: 0, right: 0, bottom: 0, left: 0 },
      collisions: [{ id: 'legacy_collision', x: 0.1, y: 0.2, w: 0.2, h: 0.3 }],
    },
  ],
});
process.stdout.write(`${output}\n`);
