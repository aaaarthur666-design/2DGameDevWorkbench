import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({
  root: process.cwd(),
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

let passed = 0;
const tests = [];
const test = (name, run) => tests.push({ name, run });

try {
  const types = await server.ssrLoadModule('/features/map-stitcher/frame-ronin-types.ts');
  const geometry = await server.ssrLoadModule('/features/map-stitcher/frame-ronin-geometry.ts');
  const regions = await server.ssrLoadModule('/features/map-stitcher/region-engine.ts');
  const layers = await server.ssrLoadModule('/features/map-stitcher/layer-engine.ts');
  const state = await server.ssrLoadModule('/features/map-stitcher/state-package.ts');
  const engine = await server.ssrLoadModule('/features/map-stitcher/engine-export.ts');

  test('FrameRonin image and annotation layers remain separate', () => {
    assert.deepEqual(types.MAP_IMAGE_LAYERS, ['overall', 'surface', 'object', 'black', 'white']);
    assert.deepEqual(types.MAP_DISPLAY_LAYERS, ['overall', 'surface', 'object', 'mask', 'black', 'white']);
    assert.deepEqual(types.REGION_AUTHORING_MAP_LAYERS, ['overall', 'surface', 'object']);
    assert.deepEqual(types.REGION_LAYERS, ['occlusion', 'collision', 'adjust', 'top']);
  });

  test('online-compatible rectangles store two points but render four corners', () => {
    const points = regions.rectanglePoints({ x: 80, y: 60 }, { x: 20, y: 10 });
    assert.equal(points.length, 2);
    const corners = regions.shapePolygonPoints({ mode: 'rectangle', points });
    assert.deepEqual(corners, [
      { x: 20, y: 10 },
      { x: 80, y: 10 },
      { x: 80, y: 60 },
      { x: 20, y: 60 },
    ]);
    assert.equal(regions.regionShapeIsValid('rectangle', points), true);
  });

  test('region hit testing and normalized collision migration use tile-local pixels', () => {
    const shape = regions.regionRectToShape({
      id: 'collision_1', tileKey: '0,0', x: 0.25, y: 0.2, w: 0.5, h: 0.4,
      tileWidth: 200, tileHeight: 100,
    });
    assert.deepEqual(shape.points, [{ x: 50, y: 20 }, { x: 150, y: 60 }]);
    assert.equal(regions.hitTestRegionShape(shape, { x: 100, y: 40 }), true);
    assert.equal(regions.hitTestRegionShape(shape, { x: 5, y: 5 }), false);
  });

  test('free paths require enough points for Pixelwork v2 round trips', () => {
    assert.equal(regions.regionShapeIsValid('free', [{ x: 0, y: 0 }, { x: 5, y: 5 }]), false);
    assert.equal(regions.regionShapeIsValid('free', [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 6 }]), true);
  });

  test('expansion geometry creates 4/8/12-card rings without changing the center', () => {
    const center = geometry.createFrameRoninCenterTile({ width: 100, height: 80 });
    assert.equal(geometry.expandAroundFrameRoninTile(center, 4, 15, 15).length, 4);
    assert.equal(geometry.expandAroundFrameRoninTile(center, 8, 15, 15).length, 8);
    assert.equal(geometry.expandAroundFrameRoninTile(center, 12, 15, 15).length, 12);
    assert.deepEqual({ x: center.x, y: center.y, w: center.w, h: center.h }, { x: 0, y: 0, w: 1, h: 1 });
  });

  test('black/white matte extraction recovers color and alpha deterministically', () => {
    const pixel = layers.extractMattePixel([128, 0, 0], [255, 127, 127]);
    assert.deepEqual(pixel, [255, 0, 0, 128]);
    assert.deepEqual(layers.extractMattePixel([0, 0, 0], [255, 255, 255]), [0, 0, 0, 0]);
  });

  test('Pixelwork state parsers accept the live layer/geometry conventions', () => {
    assert.deepEqual(state.parsePixelworkGeometry({
      '1,0': { x: 0.85, y: 0, w: 1, h: 1 },
    }), { '1,0': { x: 0.85, y: 0, w: 1, h: 1 } });
    const parsed = state.parsePixelworkShapes([{
      id: 'shape_1', tileKey: '1,0', mapLayer: 'object', layer: 'occlusion', mode: 'rectangle',
      points: [{ x: 1, y: 2 }, { x: 9, y: 12 }],
    }]);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].mapLayer, 'object');
    assert.equal(parsed[0].points.length, 2);
  });

  test('engine manifests convert tile-local regions to world pixels', () => {
    const tile = { key: '1,0', x: 0.5, y: 0.25, w: 1, h: 1, images: {}, feather: {}, hidden: false };
    const shape = { id: 'collision_1', tileKey: '1,0', mapLayer: 'overall', layer: 'collision', mode: 'rectangle', points: [{ x: 10, y: 20 }, { x: 30, y: 40 }] };
    const manifest = engine.buildRegionManifest([tile], [shape], 100, 80, { originX: 0, originY: 0, width: 200, height: 160 });
    assert.deepEqual(manifest.regions[0].points, [
      { x: 60, y: 40 },
      { x: 80, y: 40 },
      { x: 80, y: 60 },
      { x: 60, y: 60 },
    ]);
    const scene = engine.buildGodotScene(manifest, ['overall', 'top']);
    assert.match(scene, /CollisionPolygon2D/);
    assert.match(scene, /z_index = 100/);
    assert.match(engine.buildUnityRegionRuntime(), /ToUnity/);
    const separatedScene = engine.buildGodotScene(manifest, ['overall', 'surface', 'object']);
    assert.match(separatedScene, /name="Overall"[\s\S]*visible = false/);
  });

  for (const entry of tests) {
    await entry.run();
    passed += 1;
    process.stdout.write(`ok ${passed} - ${entry.name}\n`);
  }
  process.stdout.write(`\n${passed} map-stitcher tests passed\n`);
} finally {
  await server.close();
}
