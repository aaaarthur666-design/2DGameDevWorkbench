import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { z } from 'zod';
import { getDocument, applyDocumentCommands } from './editor-documents.mjs';
import { inspectImageBytes, MAX_IMAGE_BYTES } from './adapters/image-assets-source.mjs';
import { createMapProjectPackage } from '../../features/map-stitcher/project-package.mjs';

const inputSchema = z.object({
  documentId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/),
  expectedRevision: z.number().int().positive(),
  commandId: z.string().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/),
  sourceTaskId: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,199}$/i),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  definitionId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/).optional(),
}).strict();
const hash = (value) => createHash('sha256').update(value).digest('hex');
const inside = (base, target) => {
  const relative = path.relative(base, target);
  return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
async function confinedRead(base, filename, maxBytes) {
  const actualBase = await realpath(base);
  const actual = await realpath(filename);
  if (!inside(actualBase, actual)) throw new Error('素材路径超出允许的目录。');
  const info = await stat(actual);
  if (!info.isFile() || info.size > maxBytes) throw new Error('素材记录过大或不是文件。');
  return readFile(actual);
}

export async function readGeneratedImage(root, manifest, taskId, expectedSha) {
  if (!/^[a-z0-9][a-z0-9_-]{0,199}$/i.test(taskId)) throw new Error('图片任务身份无效。');
  const tasks = path.resolve(root, manifest.workspace.taskDirectory);
  const task = JSON.parse(await confinedRead(tasks, path.join(tasks, `${taskId}.json`), 128 * 1024 * 1024));
  if (task.id !== taskId || task.capabilityId !== 'image-assets' || task.status !== 'completed' || !Array.isArray(task.outputs))
    throw new Error('只能采用已完成的图片素材任务。');
  const kind = task.input.operation === 'generate-prop' ? 'prop' : task.input.operation === 'generate-background' ? 'background' : ['edit-image', 'process-image'].includes(task.input.operation) ? task.input.kind || 'background' : null;
  if (!kind) throw new Error('图片任务操作无效。');
  const prefix = path.posix.join(manifest.workspace.outputDirectory.replaceAll('\\', '/'), taskId);
  if (!['image.png', 'result.json'].every((name) => task.outputs.includes(`${prefix}/${name}`))) throw new Error('图片任务缺少完整产物记录。');
  const directory = path.resolve(root, prefix);
  const outputRoot = await realpath(path.resolve(root, manifest.workspace.outputDirectory));
  if (!inside(outputRoot, await realpath(directory))) throw new Error('图片任务输出路径无效。');
  const metadata = JSON.parse(await confinedRead(directory, path.join(directory, 'result.json'), 1024 * 1024));
  const bytes = await confinedRead(directory, path.join(directory, 'image.png'), MAX_IMAGE_BYTES);
  const info = await inspectImageBytes(bytes, { pngOnly: true, transparency: kind === 'prop' });
  if (metadata.kind !== kind || metadata.image !== 'image.png' || metadata.sha256 !== expectedSha || info.sha256 !== expectedSha || metadata.width !== info.width || metadata.height !== info.height)
    throw new Error('图片内容或结果记录已变化，请重新检查原任务。');
  return { task, kind, bytes, width: info.width, height: info.height, generation: { sourceTaskId: taskId, sha256: info.sha256 }, name: String(task.input.name || (kind === 'prop' ? '透明物品' : '场景背景')).slice(0, 80) };
}

async function backgroundMap(image) {
  const flags = (keys, value) => Object.fromEntries(keys.map((key) => [key, value]));
  const layers = ['overall', 'surface', 'object', 'black', 'white'];
  const regions = ['occlusion', 'collision', 'adjust', 'top'];
  const draft = {
    version: 1, id: `image-${hash(image.task.id).slice(0, 32)}`, pending: [],
    snapshot: {
      tiles: [{ key: '0,0', x: 0, y: 0, w: 1, h: 1,
        images: { overall: { file: new Blob([image.bytes], { type: 'image/png' }), name: `${image.name}.png`, type: 'image/png', width: image.width, height: image.height, generation: image.generation } },
        imageOrigins: { overall: image.task.input.operation === 'process-image' ? 'pixel-edited' : 'api-generated' }, feather: { top: 0, right: 0, bottom: 0, left: 0 }, hidden: false,
      }],
      shapes: [], selectedKey: '0,0', horizontalOverlapPercent: 0, verticalOverlapPercent: 0, expandSplit: 4,
      pan: { x: 0, y: 0 }, zoom: 1, activeMapLayer: 'overall', overallPrompt: image.task.input.prompt || '',
      hidePreviewBorders: false, hidePreviewCards: false,
      displayVisibility: flags([...layers, 'mask'], true), regionVisibility: flags(regions, true), imageLocks: flags(layers, false), regionLocks: flags(regions, false),
    },
  };
  const zip = await JSZip.loadAsync(await createMapProjectPackage(draft));
  // Stable bytes make an adoption command safe to retry after a lost response.
  for (const entry of Object.values(zip.files)) entry.date = new Date('1980-01-01T00:00:00Z');
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  return {
    name: image.name, origin: { x: 0, y: 0 }, offset: { x: 0, y: 0 },
    layers: [{ id: 'map_overall', name: '背景', source: `data:image/png;base64,${image.bytes.toString('base64')}`, width: image.width, height: image.height, locked: true, hidden: false, included: true }],
    collisions: [], source: `data:application/zip;base64,${bytes.toString('base64')}`,
    warnings: ['此背景尚未配置地图碰撞。请设置并检查碰撞后再验证游戏行为。'],
  };
}

/** Adopts saved image evidence; never generates or modifies the original task. */
export async function adoptDocumentImage(root, manifest, input) {
  const parsed = inputSchema.parse(input);
  // Reconstruct commands from the exact original base, including on retries.
  const { document } = await getDocument(root, manifest, { documentId: parsed.documentId, revision: parsed.expectedRevision });
  const image = await readGeneratedImage(root, manifest, parsed.sourceTaskId, parsed.sha256);
  const commands = [];
  if (document.kind === 'scene') {
    if (image.kind !== 'background' || parsed.definitionId) throw new Error('场景背景采用需要 background 图片，且不接受交互物 definitionId。');
    commands.push({ type: 'replace-map', map: await backgroundMap(image) });
  } else {
    if (image.kind !== 'prop' || !parsed.definitionId || !document.content.objects.some((object) => object.definitionId === parsed.definitionId))
      throw new Error('透明物品采用需要现有交互物 definitionId 和 prop 图片。');
    const id = `image_${hash(image.task.id).slice(0, 32)}`;
    const asset = { id, name: `${image.name}.png`, mime: 'image/png', source: `data:image/png;base64,${image.bytes.toString('base64')}`, generation: image.generation };
    const existing = document.content.assets.find((value) => value.id === id);
    if (existing && (existing.source !== asset.source || existing.generation?.sha256 !== parsed.sha256 || existing.generation?.sourceTaskId !== image.task.id)) throw new Error('素材身份冲突。');
    if (!existing) commands.push({ type: 'add-asset', asset });
    commands.push({ type: 'bind-asset', definitionId: parsed.definitionId, assetId: id, target: 'visual' });
    commands.push({ type: 'set-visual', definitionId: parsed.definitionId, visual: { idleAnimation: '', focusAnimation: '' } });
  }
  return applyDocumentCommands(root, manifest, { documentId: parsed.documentId, expectedRevision: parsed.expectedRevision, commandId: parsed.commandId, commands });
}
