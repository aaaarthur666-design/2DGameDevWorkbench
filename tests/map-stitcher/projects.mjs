import '../helpers/runtime-workspace.mjs';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import JSZip from 'jszip';
import { readFile, writeFile } from 'node:fs/promises';
import { loadManifest, repositoryRoot } from '../../lib/workbench/runtime.mjs';
import {
  saveMapProject,
  readMapProject,
  listMapProjectRecords,
  readMapProjectPreview,
} from '../../lib/workbench/map-projects.mjs';
import { readMapProjectPackage, createMapProjectPackage } from '../../features/map-stitcher/project-package.mjs';
import { mapProjectFixture } from '../helpers/map-project.mjs';

const manifest = await loadManifest();
const png = await sharp({
  create: { width: 16, height: 16, channels: 4, background: '#abcdef' },
})
  .png()
  .toBuffer();
const { draft, bytes } = await mapProjectFixture(png);
const decoded = await readMapProjectPackage(bytes);
assert.deepEqual(decoded.draft.pending, draft.pending);
assert.deepEqual(decoded.draft.snapshot.shapes, draft.snapshot.shapes);
const { tiles: expectedTiles, ...settings } = draft.snapshot;
const { tiles, ...restoredSettings } = decoded.draft.snapshot;
assert.deepEqual(restoredSettings, settings);
assert.equal(tiles[0].additionalPrompt, ' 保留空白 ');
assert.deepEqual(tiles[0].feather, expectedTiles[0].feather);
for (const image of Object.values(tiles[0].images))
  assert.deepEqual(Buffer.from(decoded.images.get(image.path)), png);
const first = await saveMapProject(
  repositoryRoot,
  manifest,
  draft.id,
  0,
  bytes,
);
assert.equal(first.revision, 1);
const races = await Promise.allSettled(
  [1, 2].map(() =>
    saveMapProject(repositoryRoot, manifest, draft.id, 1, bytes),
  ),
);
assert.equal(races.filter((r) => r.status === 'fulfilled').length, 1);
assert.equal(races.find((r) => r.status === 'rejected').reason.status, 409);
const saved = await readMapProject(repositoryRoot, manifest, draft.id);
assert.equal(saved.record.revision, 2);
assert.equal(saved.record.createdAt, first.createdAt);
assert.deepEqual(saved.bytes, Buffer.from(bytes));
assert.equal(
  (await listMapProjectRecords(repositoryRoot, manifest, [])).length,
  1,
);
await assert.rejects(
  saveMapProject(repositoryRoot, manifest, '../bad', 0, bytes),
);
await assert.rejects(
  saveMapProject(repositoryRoot, manifest, 'map:wrong', 0, bytes),
  /身份/,
);
const zip = await JSZip.loadAsync(bytes);
zip.remove('images/0.bin');
await assert.rejects(
  saveMapProject(
    repositoryRoot,
    manifest,
    draft.id,
    2,
    await zip.generateAsync({ type: 'nodebuffer' }),
  ),
  /图片/,
);
assert.equal(
  (await readMapProject(repositoryRoot, manifest, draft.id)).record.revision,
  2,
);
const original = await readFile(saved.record.outputs[0]);
await writeFile(saved.record.outputs[0], Buffer.from('changed'));
await assert.rejects(
  readMapProject(repositoryRoot, manifest, draft.id),
  /损坏/,
);
await writeFile(saved.record.outputs[0], original);
assert.equal(saved.record.preview, undefined);
const previewPackage = await createMapProjectPackage(draft, png);
const withPreview = await saveMapProject(repositoryRoot, manifest, draft.id, 2, previewPackage);
assert.deepEqual((await readMapProjectPreview(repositoryRoot, manifest, withPreview)).bytes, png);
assert.deepEqual(Buffer.from((await readMapProjectPackage(previewPackage)).preview), png);
await writeFile(withPreview.preview.path, Buffer.from('broken preview'));
await assert.rejects(readMapProjectPreview(repositoryRoot, manifest, withPreview), /变化/);
assert.equal((await readMapProject(repositoryRoot, manifest, draft.id)).record.revision, 3);
const corruptPackage = await createMapProjectPackage(draft, new Uint8Array([1, 2, 3]));
const withoutPreview = await saveMapProject(repositoryRoot, manifest, draft.id, 3, corruptPackage);
assert.equal(withoutPreview.preview, undefined, 'a failed new preview cannot reuse the old version');
assert.equal((await readMapProject(repositoryRoot, manifest, draft.id)).record.revision, 4);
const largePng = await sharp(png).resize(641, 1).png().toBuffer();
const oversized = await saveMapProject(repositoryRoot, manifest, draft.id, 4, await createMapProjectPackage(draft, largePng));
assert.equal(oversized.preview, undefined);
console.log(
  'Map project roundtrip, durable identity, concurrency, invalid input and changed-file checks passed.',
);
