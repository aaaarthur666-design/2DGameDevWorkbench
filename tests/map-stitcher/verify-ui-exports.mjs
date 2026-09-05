// Read-back checks for actual files downloaded through the browser regression flow.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import JSZip from 'jszip';

const root = path.resolve('work/map-ui-repair/downloads');
const open = async (name) =>
  JSZip.loadAsync(await readFile(path.join(root, name)));
const stateZip = await open('center_map_stitch_state.zip');
const state = JSON.parse(
  await stateZip.file('map_stitch_state.json').async('string'),
);
assert.equal(state.version, 2);
assert.equal(state.drawShapes.length, 5);
assert.equal(state.workbench.surfaceDrafts['0,0'], true);
assert.equal(state.workbench.tileImageOrigins['0,0'].surface, 'overall-copy');
for (const ref of [
  state.source,
  ...Object.values(state.tileUploads),
  ...Object.values(state.tileLayerUploads).flatMap(Object.values),
])
  assert.ok(stateZip.file(ref.path), ref.path);

const godot = await open('center_godot.zip');
for (const name of [
  'map_scene.tscn',
  'project.godot',
  'frame_ronin_regions.gd',
  'regions.json',
  'map_export.json',
  'source_state.zip',
])
  assert.ok(godot.file(name), name);
const source = await JSZip.loadAsync(
  await godot.file('source_state.zip').async('nodebuffer'),
);
const restored = JSON.parse(
  await source.file('map_stitch_state.json').async('string'),
);
assert.deepEqual(restored.drawShapes, state.drawShapes);
assert.deepEqual(restored.tiles, state.tiles);
assert.deepEqual(
  restored.workbench.surfaceDrafts,
  state.workbench.surfaceDrafts,
);
const scene = await godot.file('map_scene.tscn').async('string');
assert.match(scene, /CollisionPolygon2D/);
assert.match(scene, /z_index = 100/);
assert.doesNotMatch(
  scene.split('\n\n').find((part) => part.includes('[node name="Overall"')),
  /visible = false/,
);

const png = await open('center_all_png.zip');
const manifest = JSON.parse(
  await png.file('png_manifest.json').async('string'),
);
assert.equal(manifest.width, 560);
assert.equal(manifest.height, 240);
assert.equal(manifest.layers.length, 7);
const pixels = {};
for (const name of [...manifest.layers, 'composite']) {
  const buffer = await png.file(`map_${name}.png`).async('nodebuffer');
  const decoded = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(decoded.info.width, 560);
  assert.equal(decoded.info.height, 240);
  pixels[name] = decoded.data;
}
const alpha = (layer, x, y) => pixels[layer][(y * 560 + x) * 4 + 3];
assert.equal(
  alpha('object', 40, 40),
  0,
  'foreign-view occlusion removes object pixels',
);
assert.ok(alpha('object', 70, 40) > 0, 'object outside occlusion remains');
assert.equal(alpha('mask', 40, 40), 0);
assert.equal(
  alpha('top', 30, 30),
  0,
  'top is transparent outside the authored polygon',
);
assert.ok(alpha('top', 220, 150) > 0);
assert.deepEqual(
  pixels.composite,
  pixels.overall,
  'draft/incomplete separation keeps the overall composition',
);

const psd = await readFile(path.join(root, 'center_layers.psd'));
assert.equal(psd.toString('ascii', 0, 4), '8BPS');
assert.equal(psd.readUInt16BE(4), 1);
assert.equal(psd.readUInt32BE(14), 240);
assert.equal(psd.readUInt32BE(18), 560);

// A package without source_state.zip exercises the explicit, merged-map recovery path.
godot.remove('source_state.zip');
await writeFile(
  path.resolve('work/map-ui-repair/fixtures/legacy-composite-godot.zip'),
  await godot.generateAsync({ type: 'nodebuffer' }),
);
process.stdout.write(
  'UI export read-back passed: 8 PNG images, Pixelwork v2, Godot source/regions, PSD header; legacy recovery fixture ready.\n',
);
