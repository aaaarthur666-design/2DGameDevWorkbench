import '../helpers/runtime-workspace.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import sharp from 'sharp';
import { createTestViteServer } from '../helpers/vite-server.mjs';
import { mapProjectFixture } from '../helpers/map-project.mjs';
import { createMapProjectPackage, readMapProjectPackage } from '../../features/map-stitcher/project-package.mjs';
import { createScene, validateScene } from '../../features/scene-composer/model.mjs';
import { createScenePackage, readScenePackage } from '../../features/scene-composer/package.mjs';
import { buildSceneGodotPackage } from '../../features/scene-composer/godot-builder.mjs';
import { inspectSceneImageSource, replaceSceneImageSource } from '../../lib/workbench/image-edit-scene-sources.mjs';
import { createDocument } from '../../lib/workbench/editor-documents.mjs';
import { adoptDocumentImage } from '../../lib/workbench/document-assets.mjs';
import { loadManifest, repositoryRoot } from '../../lib/workbench/runtime.mjs';

const root = repositoryRoot, manifest = await loadManifest();
assert.ok(manifest.workspace.documentDirectory.includes(`/test-runs/${process.env.WORKBENCH_TEST_RUN}/`));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const data = (bytes, mime = 'image/png') => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
const fromData = value => Buffer.from(value.slice(value.indexOf(',') + 1), 'base64');
let checks = 0, networkRequests = 0;
const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const reject = async (fn, code) => { await assert.rejects(fn, error => error.code === code); checks++; };
const width = 64, height = 32;
const pixels = Buffer.alloc(width * height * 4);
for (let i = 0; i < width * height; i++) pixels.set([22, 44, 66, i === 0 ? 0 : i === 1 ? 1 : 255], i * 4);
const original = await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
const other = await sharp({ create: { width, height, channels: 4, background: '#448866' } }).png().toBuffer();
const candidateBytes = await sharp({ create: { width, height, channels: 4, background: '#bb9944' } }).png().toBuffer();
const candidate = { bytes: candidateBytes, sha256: hash(candidateBytes), width, height, mimeType: 'image/png', taskId: 'scene-edit-candidate' };
const originalGlobals = { fetch: globalThis.fetch, Image: globalThis.Image, FileReader: globalThis.FileReader, document: globalThis.document };
const urls = [];
// Browser primitives decode genuine PNGs. The tiny pixel canvas only exercises
// the real deriveMaskCanvas alpha formula; it is not a scene render substitute.
globalThis.fetch = (...args) => {
  const source = args[0], url = typeof source === 'string' ? source : source instanceof URL ? source.href : source.url;
  if (!/^(blob:|data:)/.test(url)) { networkRequests++; throw new Error('Scene source tests forbid network.'); }
  return originalGlobals.fetch(...args);
};
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => this.onload({ target: { result } }), error => this.onerror({ target: { error } })); }
};
globalThis.Image = class {
  set src(url) {
    fetch(url).then(response => response.arrayBuffer()).then(bytes => sharp(Buffer.from(bytes)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }))
      .then(({ data: rgba, info }) => { this.naturalWidth = this.width = info.width; this.naturalHeight = this.height = info.height; this.rgba = rgba; this.onload(); }).catch(error => this.onerror(error));
  }
};
class PixelCanvas {
  width = 0; height = 0;
  getContext() {
    const canvas = this;
    this.pixels = new Uint8ClampedArray(this.width * this.height * 4);
    return {
      drawImage(image, x, y, w, h) { assert.equal(x, 0); assert.equal(y, 0); assert.equal(w, canvas.width); assert.equal(h, canvas.height); canvas.pixels.set(image.rgba); },
      clearRect() { canvas.pixels.fill(0); },
      getImageData() { return { data: new Uint8ClampedArray(canvas.pixels), width: canvas.width, height: canvas.height }; },
      createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
      putImageData(image) { canvas.pixels.set(image.data); },
    };
  }
  toBlob(callback) { sharp(Buffer.from(this.pixels), { raw: { width: this.width, height: this.height, channels: 4 } }).png().toBuffer().then(bytes => callback(new Blob([bytes], { type: 'image/png' })), () => callback(null)); }
}
const pixelDocument = { createElement(tag) { assert.equal(tag, 'canvas'); return new PixelCanvas(); } };
globalThis.document = pixelDocument;

const server = await createTestViteServer({ root, configFile: false, resolve: { alias: { '@': root } }, optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } });
const storage = await server.ssrLoadModule('/features/map-stitcher/state-package.ts');
const geometry = await server.ssrLoadModule('/features/map-stitcher/frame-ronin-geometry.ts');
const { buildRegionManifest } = await server.ssrLoadModule('/features/map-stitcher/engine-export.ts');
const { deriveMaskCanvas } = await server.ssrLoadModule('/features/map-stitcher/layer-engine.ts');
function sceneFor(bytes, shapes, layerBytes = { overall: original }) {
  const scene = createScene('Pinned source fixture'); scene.id = 'scene-source-fixture';
  scene.map = { name: 'Source', origin: { x: 0, y: 0 }, offset: { x: 35, y: 20 }, source: data(bytes, 'application/zip'), warnings: ['keep'],
    collisions: buildRegionManifest([{ key: '0,0', x: 0, y: 0, hidden: false }], shapes, width, height, { originX: 0, originY: 0, width, height }).regions.filter(shape => shape.layer === 'collision').map(shape => shape.points),
    layers: Object.entries(layerBytes).map(([layer, bytes]) => ({ id: `map_${layer}`, name: layer, source: data(bytes), width, height, locked: false, hidden: false, included: true })) };
  scene.order = ['actor', ...scene.map.layers.map(layer => layer.id)];
  return validateScene(scene);
}
async function forge() {
  const { draft } = await mapProjectFixture(original, 'map:scene-source');
  draft.pending = []; const tile = draft.snapshot.tiles[0];
  Object.assign(tile, { x: 0, y: 0, w: 1, h: 1, feather: { top: 0, right: 0, bottom: 0, left: 0 } });
  for (const [layer, image] of Object.entries(tile.images)) tile.images[layer] = { ...image, width, height, file: new Blob([layer === 'surface' ? other : original], { type: 'image/png' }) };
  draft.snapshot.imageLocks = Object.fromEntries(Object.keys(tile.images).map(layer => [layer, false]));
  const bytes = Buffer.from(await createMapProjectPackage(draft, original));
  return { draft, scene: sceneFor(bytes, draft.snapshot.shapes), bytes };
}
async function mutateSource(scene, update) {
  const zip = await JSZip.loadAsync(fromData(scene.map.source));
  const filename = zip.file('map-project.json') ? 'map-project.json' : 'map_stitch_state.json';
  const source = JSON.parse(await zip.file(filename).async('string'));
  await update(source, zip);
  zip.file(filename, JSON.stringify(source));
  const copy = structuredClone(scene); copy.map.source = data(await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }), 'application/zip'); return copy;
}
async function readonly(scene, layerId = 'map_overall', note = '') {
  const before = JSON.stringify(scene), inspected = await inspectSceneImageSource(root, scene, layerId);
  check(inspected.editable, false, note); check(inspected.bytes, fromData(scene.map.layers.find(layer => layer.id === layerId).source));
  check(typeof inspected.readOnlyReason, 'string'); check(inspected.sourceEntry.action, 'edit-map-source');
  await reject(() => replaceSceneImageSource(root, scene, layerId, candidate), inspected.readOnlyCode);
  check(JSON.stringify(scene), before, 'Rejected source never mutates input.');
  return inspected;
}
try {
  const fixture = await forge(), before = structuredClone(fixture.scene);
  const initial = await inspectSceneImageSource(root, before, 'map_overall');
  check(initial.editable, true, initial.readOnlyReason); check(initial.mapping.format, 'forge-map-project'); check(initial.mapping.tileKey, '0,0'); check(initial.sha256, hash(original));
  check(initial.sourceEntry.sourceField, 'map.source'); check(initial.sourceEntry.sha256, hash(fixture.bytes));
  const changed = await replaceSceneImageSource(root, before, 'map_overall', candidate);
  check(before, fixture.scene, 'No source or scene mutation.'); check(fromData(changed.map.layers[0].source), candidateBytes);
  const expectedScene = structuredClone(before); expectedScene.map.source = changed.map.source; expectedScene.map.layers[0].source = changed.map.layers[0].source;
  check(changed, expectedScene, 'Only the selected layer image and embedded ZIP change.');
  const afterPackage = await readMapProjectPackage(fromData(changed.map.source));
  const originalPackage = await readMapProjectPackage(fixture.bytes);
  for (const [layer, image] of Object.entries(afterPackage.draft.snapshot.tiles[0].images)) {
    check(Buffer.from(afterPackage.images.get(image.path)), layer === 'overall' ? candidateBytes : Buffer.from(originalPackage.images.get(originalPackage.draft.snapshot.tiles[0].images[layer].path)), `Source ${layer} byte isolation.`);
  }
  check(afterPackage.draft.snapshot.tiles[0].images.overall.generation, { sourceTaskId: candidate.taskId, sha256: candidate.sha256 });
  check(afterPackage.draft.snapshot.shapes, originalPackage.draft.snapshot.shapes); check(afterPackage.preview, undefined);
  await new Promise(resolve => setTimeout(resolve, 1100));
  check((await replaceSceneImageSource(root, before, 'map_overall', candidate)).map.source, changed.map.source, 'ZIP content is deterministic across wall-clock seconds.');
  const roundTrip = await readScenePackage(await createScenePackage(changed)); check(roundTrip, changed);
  const delivery = await buildSceneGodotPackage(changed, { repositoryRoot: root });
  const deliveryZip = await JSZip.loadAsync(delivery.bytes);
  check(await deliveryZip.file(`scenes/${changed.id}/map/map_overall.png`).async('nodebuffer'), candidateBytes);
  check(await readScenePackage(delivery.bytes), changed, 'Godot delivery source package agrees with exported map PNG.');
  const multiPresented = sceneFor(fixture.bytes, fixture.draft.snapshot.shapes, { overall: original, surface: other, object: original });
  const multiChanged = await replaceSceneImageSource(root, multiPresented, 'map_surface', candidate);
  check(multiChanged.map.layers[0], multiPresented.map.layers[0]); check(multiChanged.map.layers[2], multiPresented.map.layers[2]); check(multiChanged.order, multiPresented.order);

  // Preserve unknown, non-target metadata and split shared paths instead of
  // accidentally altering a sibling image slot.
  const aliased = await mutateSource(before, source => {
    source.customEditorState = { future: 'retain me' }; source.snapshot.tiles[0].futureGeometryFlag = 7;
    source.snapshot.tiles[0].images.surface = structuredClone(source.snapshot.tiles[0].images.overall);
    source.snapshot.tiles[0].images.overall.customName = 'keep metadata';
  });
  const aliasNext = await replaceSceneImageSource(root, aliased, 'map_overall', candidate);
  const aliasZip = await JSZip.loadAsync(fromData(aliasNext.map.source));
  const aliasManifest = JSON.parse(await aliasZip.file('map-project.json').async('string'));
  check(aliasManifest.customEditorState, { future: 'retain me' }); check(aliasManifest.snapshot.tiles[0].futureGeometryFlag, 7); check(aliasManifest.snapshot.tiles[0].images.overall.customName, 'keep metadata');
  check(aliasManifest.snapshot.tiles[0].images.overall.path === aliasManifest.snapshot.tiles[0].images.surface.path, false);
  check(await aliasZip.file(aliasManifest.snapshot.tiles[0].images.surface.path).async('nodebuffer'), original);

  await readonly(await mutateSource(before, source => { source.snapshot.tiles.push({ ...structuredClone(source.snapshot.tiles[0]), key: '1,0', x: 1, images: {} }); }), undefined, 'Composite geometry is read-only.');
  for (const change of [tile => tile.feather.top = 1, tile => tile.w = width, tile => tile.hidden = true, tile => tile.x = 1])
    await readonly(await mutateSource(before, source => change(source.snapshot.tiles[0])));
  const offsetOrigin = structuredClone(before); offsetOrigin.map.origin.x = 1; await readonly(offsetOrigin);
  const wrongLayer = structuredClone(before); wrongLayer.map.layers[0].source = data(other); await readonly(wrongLayer);
  const wrongCollision = structuredClone(before); wrongCollision.map.collisions[0][0].x++; await readonly(wrongCollision);
  for (const layer of ['occlusion', 'adjust', 'top']) await readonly(await mutateSource(before, source => source.snapshot.shapes.push({ ...source.snapshot.shapes[0], id: layer, layer })));
  const top = structuredClone(before); top.map.layers[0].id = 'map_top'; top.order = ['actor', 'map_top']; await readonly(top, 'map_top');
  const sourceLocked = await mutateSource(before, source => source.snapshot.imageLocks.overall = true); check((await readonly(sourceLocked)).locked, true);
  const layerLocked = structuredClone(before); layerLocked.map.layers[0].locked = true; check((await readonly(layerLocked)).locked, true);
  await reject(() => replaceSceneImageSource(root, before, 'map_overall', { ...candidate, sha256: '0'.repeat(64) }), 'IMAGE_SCENE_SOURCE_INVALID');
  await reject(() => replaceSceneImageSource(root, before, 'map_overall', { ...candidate, width: width + 1 }), 'IMAGE_SCENE_SOURCE_INVALID');
  await readonly(await mutateSource(before, source => source.snapshot.tiles[0].images.overall.width++));
  await readonly(await mutateSource(before, (_source, zip) => zip.file('../escape.png', original)));
  await readonly(await mutateSource(before, source => source.snapshot.tiles[0].images.overall.path = 'images/missing.bin'));
  const badManifest = await JSZip.loadAsync(fixture.bytes); badManifest.file('map-project.json', '{');
  const badManifestScene = structuredClone(before); badManifestScene.map.source = data(await badManifest.generateAsync({ type: 'nodebuffer' }), 'application/zip'); await readonly(badManifestScene);
  const noSource = structuredClone(before); noSource.map.source = 'blob:unpersisted-source'; await readonly(noSource);
  // Central-directory claims cannot bypass actual-size and CRC validation.
  const crcZip = Buffer.from(fixture.bytes), signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let central = crcZip.indexOf(signature);
  while (crcZip.subarray(central + 46, central + 46 + crcZip.readUInt16LE(central + 28)).toString().endsWith('/')) central = crcZip.indexOf(signature, central + 4);
  crcZip.writeUInt32LE((crcZip.readUInt32LE(central + 16) ^ 1) >>> 0, central + 16);
  const crcScene = structuredClone(before); crcScene.map.source = data(crcZip, 'application/zip'); await readonly(crcScene);
  const sizeZip = Buffer.from(fixture.bytes); sizeZip.writeUInt32LE(300 * 1024 * 1024, central + 24);
  const sizeScene = structuredClone(before); sizeScene.map.source = data(sizeZip, 'application/zip'); await readonly(sizeScene);
  const smallSizeZip = Buffer.from(fixture.bytes); smallSizeZip.writeUInt32LE(1, central + 24);
  const smallSizeScene = structuredClone(before); smallSizeScene.map.source = data(smallSizeZip, 'application/zip'); await readonly(smallSizeScene);

  // Use the actual Pixelwork writer and loader, including its implicit center
  // geometry and real rectangle-to-world collision projection.
  const asset = (bytes, name) => { const file = new File([bytes], name, { type: 'image/png' }); const url = URL.createObjectURL(file); urls.push(url); return { file, name, type: file.type, size: file.size, url, width, height }; };
  const tile = geometry.createFrameRoninCenterTile(asset(original, '原图 source.png'));
  tile.images.surface = asset(other, '未选 surface.png'); tile.images.object = asset(original, '物件 object.png');
  const rectangle = { id: 'rect', tileKey: '0,0', mapLayer: 'overall', layer: 'collision', mode: 'rectangle', points: [{ x: 40, y: 20 }, { x: 3, y: 2 }] };
  const snapshot = { ...fixture.draft.snapshot, tiles: [tile], shapes: [rectangle], imageLocks: Object.fromEntries(['overall', 'surface', 'object', 'black', 'white'].map(key => [key, false])) };
  const packed = await storage.createPixelworkStatePackage(snapshot);
  const pixelBytes = Buffer.from(await packed.blob.arrayBuffer());
  const pixelScene = sceneFor(pixelBytes, snapshot.shapes);
  check(pixelScene.map.collisions, [[{ x: 3, y: 2 }, { x: 40, y: 2 }, { x: 40, y: 20 }, { x: 3, y: 20 }]]);
  check((await inspectSceneImageSource(root, pixelScene, 'map_overall')).editable, true);
  const pixelChanged = await replaceSceneImageSource(root, pixelScene, 'map_overall', candidate);
  const pixelZip = await JSZip.loadAsync(fromData(pixelChanged.map.source));
  const pixelManifest = JSON.parse(await pixelZip.file('map_stitch_state.json').async('string'));
  check(pixelManifest.tileLayerUploads.mask, {}); check(Object.keys(pixelZip.files).some(name => name.includes('mask_')), false);
  check(pixelManifest.savedAt, packed.state.savedAt); check(pixelManifest.drawShapes, packed.state.drawShapes);
  const loaded = await storage.loadFrameRoninState(new File([fromData(pixelChanged.map.source)], 'source.zip', { type: 'application/zip' }));
  for (const loadedTile of loaded.tiles) for (const image of Object.values(loadedTile.images)) urls.push(image.url);
  check(loaded.sourceFormat, 'pixelwork-v2'); check(loaded.tiles.length, 1); check(loaded.tiles[0].w, 1); check(loaded.tiles[0].h, 1);
  check(geometry.tilePixelSize(loaded.tiles[0], width, height), { width, height });
  check(Buffer.from(await loaded.tiles[0].images.overall.file.arrayBuffer()), candidateBytes);
  check(Buffer.from(await loaded.tiles[0].images.surface.file.arrayBuffer()), other);
  check(Buffer.from(await loaded.tiles[0].images.object.file.arrayBuffer()), original);
  check(loaded.tiles[0].images.mask, undefined, 'Importer ignores invalidated derived mask cache.');
  check(buildRegionManifest(loaded.tiles, loaded.shapes, width, height, { originX: 0, originY: 0, width, height }).regions.map(region => region.points), pixelChanged.map.collisions);
  const rebuiltMask = await deriveMaskCanvas(loaded.tiles[0].images.overall, loaded.tiles[0].images.object);
  check(rebuiltMask.pixels[3], 0); check(rebuiltMask.pixels[7], 1); check(rebuiltMask.pixels[11], 255);
  check(Array.from(rebuiltMask.pixels.slice(0, 3)), [255, 255, 255], 'Real mask rebuild uses source alpha, including hidden RGB and alpha=1.');
  check((await replaceSceneImageSource(root, pixelScene, 'map_overall', candidate)).map.source, pixelChanged.map.source);
  const pixelShared = await mutateSource(pixelScene, source => { source.tileLayerUploads.surface['0,0'] = structuredClone(source.source); });
  const sharedChanged = await replaceSceneImageSource(root, pixelShared, 'map_overall', candidate);
  const sharedZip = await JSZip.loadAsync(fromData(sharedChanged.map.source)); const sharedManifest = JSON.parse(await sharedZip.file('map_stitch_state.json').async('string'));
  check(sharedManifest.source.path === sharedManifest.tileLayerUploads.surface['0,0'].path, false);
  check(await sharedZip.file(sharedManifest.tileLayerUploads.surface['0,0'].path).async('nodebuffer'), original);
  check((await readonly(await mutateSource(pixelScene, source => source.workbench.layerLocks.overall = true))).locked, true);

  // New generated backgrounds must persist normalized map geometry, so opening
  // their source in the real editor does not multiply width/height twice.
  const taskId = 'source-geometry-background', prefix = `${manifest.workspace.outputDirectory}/${taskId}`;
  await mkdir(path.resolve(root, prefix), { recursive: true }); await mkdir(path.resolve(root, manifest.workspace.taskDirectory), { recursive: true });
  await writeFile(path.resolve(root, prefix, 'image.png'), original);
  await writeFile(path.resolve(root, prefix, 'result.json'), JSON.stringify({ image: 'image.png', kind: 'background', width, height, sha256: hash(original) }));
  await writeFile(path.resolve(root, manifest.workspace.taskDirectory, `${taskId}.json`), JSON.stringify({ id: taskId, capabilityId: 'image-assets', status: 'completed', input: { operation: 'generate-background' }, outputs: [`${prefix}/image.png`, `${prefix}/result.json`] }));
  const empty = createScene('Generated source geometry'); empty.id = 'generated-source-geometry';
  await createDocument(root, manifest, { kind: 'scene', content: empty, commandId: 'create-geometry-source' });
  const adopted = await adoptDocumentImage(root, manifest, { documentId: empty.id, expectedRevision: 1, commandId: 'adopt-geometry-source', sourceTaskId: taskId, sha256: hash(original) });
  const adoptedPackage = await readMapProjectPackage(fromData(adopted.document.content.map.source));
  const adoptedTile = adoptedPackage.draft.snapshot.tiles[0]; check(adoptedTile.w, 1); check(adoptedTile.h, 1); check(geometry.tilePixelSize(adoptedTile, width, height), { width, height });
  check(adoptedTile.images.overall.generation, { sourceTaskId: taskId, sha256: hash(original) });
  const unlocked = structuredClone(adopted.document.content); unlocked.map.layers[0].locked = false;
  check((await inspectSceneImageSource(root, unlocked, 'map_overall')).editable, true);
  const legacy = await mutateSource(unlocked, source => { source.snapshot.tiles[0].w = width; source.snapshot.tiles[0].h = height; }); await readonly(legacy);
  check(networkRequests, 0);
  const report = { sceneSources: 'passed', checks, formats: ['forge-map-project', 'pixelwork-v2'], realPixelworkLoader: true, realDerivedMaskRebuild: true, portableAndGodotSourceConsistency: true, atomicCloneOnly: true, deterministicZip: true, networkRequests, paidCalls: 0, testRun: process.env.WORKBENCH_TEST_RUN };
  const logDir = path.resolve(root, 'work/phase7-acceptance/7d'); await mkdir(logDir, { recursive: true });
  await writeFile(path.join(logDir, 'scene-sources-result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const url of urls) URL.revokeObjectURL(url);
  Object.assign(globalThis, originalGlobals);
  await server.close();
}
