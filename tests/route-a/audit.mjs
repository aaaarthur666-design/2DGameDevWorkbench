import assert from 'node:assert/strict';
import { createHash, randomFillSync } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createScene, replaceMap } from '../../features/scene-composer/model.mjs';
import { readGeneratedImage, adoptDocumentImage } from '../../lib/workbench/document-assets.mjs';
import { createProject } from '../../features/interactable-editor/contract.mjs';
import { createDocument, getDocument } from '../../lib/workbench/editor-documents.mjs';
import { observeScene } from '../../lib/workbench/scene-observation.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'forge-route-a-audit-'));
const manifest = { workspace: { outputDirectory: 'outputs', taskDirectory: 'work/tasks' } };
try {
  const id = 'large-background';
  const output = `outputs/${id}`;
  await mkdir(path.join(root, output), { recursive: true });
  await mkdir(path.join(root, 'work/tasks'), { recursive: true });
  const pixels = randomFillSync(Buffer.alloc(2880 * 2880 * 4));
  const bytes = await sharp(pixels, { raw: { width: 2880, height: 2880, channels: 4 } }).png().toBuffer();
  assert.ok(bytes.length > 30 * 1024 * 1024 && bytes.length < 40 * 1024 * 1024);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(path.join(root, output, 'image.png'), bytes);
  await writeFile(path.join(root, output, 'result.json'), JSON.stringify({ image: 'image.png', kind: 'background', width: 2880, height: 2880, sha256 }));
  await writeFile(path.join(root, 'work/tasks', `${id}.json`), JSON.stringify({ id, capabilityId: 'image-assets', status: 'completed', input: { operation: 'generate-background' }, outputs: [`${output}/image.png`, `${output}/result.json`] }));
  const image = await readGeneratedImage(root, manifest, id, sha256);
  assert.equal(image.width, 2880);
  assert.equal(image.generation.sha256, sha256);

  const propPixels = Buffer.alloc(16 * 16 * 4, 255);
  propPixels.fill(0, 0, 16 * 8 * 4);
  const propBytes = await sharp(propPixels, { raw: { width: 16, height: 16, channels: 4 } }).png().toBuffer();
  const propId = 'prop-provenance';
  const propSha = createHash('sha256').update(propBytes).digest('hex');
  const propDirectory = `outputs/${propId}`;
  await mkdir(path.join(root, propDirectory));
  await writeFile(path.join(root, propDirectory, 'image.png'), propBytes);
  await writeFile(path.join(root, propDirectory, 'result.json'), JSON.stringify({ image: 'image.png', kind: 'prop', width: 16, height: 16, sha256: propSha }));
  await writeFile(path.join(root, 'work/tasks', `${propId}.json`), JSON.stringify({ id: propId, capabilityId: 'image-assets', status: 'completed', input: { operation: 'generate-prop' }, outputs: [`${propDirectory}/image.png`, `${propDirectory}/result.json`] }));
  const project = createProject();
  const assetId = `image_${createHash('sha256').update(propId).digest('hex').slice(0, 32)}`;
  project.assets.push({ id: assetId, name: 'prop.png', mime: 'image/png', source: `data:image/png;base64,${propBytes.toString('base64')}`, generation: { sourceTaskId: 'another-task', sha256: propSha } });
  const definitionId = project.objects[0].definitionId;
  const { document } = await createDocument(root, manifest, { documentId: project.projectId, kind: 'interactable', commandId: 'create-provenance-check', content: project });
  await assert.rejects(adoptDocumentImage(root, manifest, { documentId: document.id, expectedRevision: 1, commandId: 'adopt-colliding-source', sourceTaskId: propId, sha256: propSha, definitionId }), /素材身份冲突/);
  assert.equal((await getDocument(root, manifest, { documentId: document.id })).document.revision, 1);

  const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#aa8844' } }).png().toBuffer();
  const scene = createScene('Junction boundary');
  replaceMap(scene, { name: 'map', origin: { x: 0, y: 0 }, offset: { x: 0, y: 0 }, source: 'fixture', warnings: [], collisions: [], layers: [{ id: 'map_overall', name: 'background', source: `data:image/png;base64,${png.toString('base64')}`, width: 16, height: 16, included: true, hidden: false, locked: false }] });
  const escaped = path.join(root, 'outside-outputs');
  await mkdir(escaped);
  await symlink(escaped, path.join(root, 'outputs/observations'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(observeScene(root, manifest, { id: scene.id, kind: 'scene', revision: 1, content: scene }), /输出路径超出/);
  assert.deepEqual(await readdir(escaped), [], 'A rejected junction must not create directories or images outside outputs.');
  assert.deepEqual(await readFile(path.join(root, output, 'image.png')), bytes);
  console.log('Route A audit: native PNG >30MiB adoption, exact source-task provenance and observation junction confinement passed.');
} finally {
  assert.ok(path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith('forge-route-a-audit-'));
  await rm(root, { recursive: true, force: true });
}
