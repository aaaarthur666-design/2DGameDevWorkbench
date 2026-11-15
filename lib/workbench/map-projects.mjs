import {
  mkdir,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
  rename,
} from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import {
  mapProjectId,
  readMapProjectPackage,
  MAX_MAP_PROJECT_BYTES,
} from '../../features/map-stitcher/project-package.mjs';
import { loadManifest } from './runtime.mjs';

const locks = new Map();
const key = (id) =>
  `map-project-${createHash('sha256').update(mapProjectId.parse(id)).digest('hex').slice(0, 32)}`;
const failure = (message, status) =>
  Object.assign(new Error(message), { status });
async function recordFor(root, manifest, id) {
  try {
    const record = JSON.parse(
      await readFile(
        path.join(
          root,
          manifest.workspace.mapProjectDirectory,
          `${key(id)}.json`,
        ),
        'utf8',
      ),
    );
    if (
      record.projectId !== id ||
      record.id !== key(id) ||
      !Number.isSafeInteger(record.revision) ||
      record.revision < 1
    )
      throw new Error('地图工程记录身份不匹配。');
    return record;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
export async function listMapProjectRecords(root, manifest, issues) {
  let entries;
  try {
    entries = await readdir(
      path.join(root, manifest.workspace.mapProjectDirectory),
    );
  } catch (error) {
    if (error.code !== 'ENOENT')
      issues.push({
        source: 'map-projects',
        message: '地图工程目录暂不可读。',
      });
    return [];
  }
  const rows = [];
  for (const entry of entries.filter((name) =>
    /^map-project-[a-f0-9]{32}\.json$/.test(name),
  )) {
    try {
      const raw = JSON.parse(
        await readFile(
          path.join(root, manifest.workspace.mapProjectDirectory, entry),
          'utf8',
        ),
      );
      const record = await recordFor(root, manifest, raw.projectId);
      if (
        !record ||
        `${record.id}.json` !== entry ||
        record.status !== 'completed' ||
        !Array.isArray(record.outputs)
      )
        throw new Error();
      rows.push(record);
    } catch {
      issues.push({
        source: 'map-projects',
        record: entry,
        message: '地图工程记录损坏。',
      });
    }
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}
export async function readMapProject(root, manifest, id) {
  const record = await recordFor(root, manifest, id);
  if (!record)
    throw failure('地图工程不存在。旧浏览器草稿请在原浏览器打开并保存。', 404);
  const base = await realpath(
    path.join(root, manifest.workspace.outputDirectory, key(id)),
  );
  const file = await realpath(path.resolve(root, record.outputs[0]));
  const relative = path.relative(base, file);
  if (
    !relative ||
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    (await stat(file)).size > MAX_MAP_PROJECT_BYTES
  )
    throw new Error('地图源包路径无效或文件过大。');
  const bytes = await readFile(file);
  if (createHash('sha256').update(bytes).digest('hex') !== record.sha256)
    throw new Error('地图工程文件已变化或损坏。');
  return { record, bytes };
}
export async function saveMapProject(
  root,
  manifest,
  id,
  expectedRevision,
  bytes,
) {
  mapProjectId.parse(id);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    throw failure('缺少地图工程版本。', 400);
  const lockKey = path.join(
    root,
    manifest.workspace.mapProjectDirectory,
    key(id),
  );
  const previous = locks.get(lockKey) || Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      const existing = await recordFor(root, manifest, id);
      if ((existing?.revision || 0) !== expectedRevision)
        throw failure(
          '地图工程已在其他页面更新。本页草稿已保留；请先下载本页源文件，再重新打开最新工程。',
          409,
        );
      const { draft, images, preview } = await readMapProjectPackage(bytes);
      if (draft.id !== id) throw new Error('地图工程身份与保存地址不一致。');
      for (const tile of draft.snapshot.tiles)
        for (const image of Object.values(tile.images)) {
          const metadata = await sharp(images.get(image.path), {
            limitInputPixels: 64 * 1024 * 1024,
          }).metadata();
          if (
            metadata.width !== image.width ||
            metadata.height !== image.height ||
            !['png', 'jpeg', 'webp'].includes(metadata.format)
          )
            throw new Error('地图图片尺寸或格式不匹配。');
        }
      const outputId = key(id);
      const relative = `${manifest.workspace.outputDirectory}/${outputId}/${expectedRevision + 1}-${randomUUID()}/map-source.zip`;
      await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
      await writeFile(path.join(root, relative), bytes, { flag: 'wx' });
      let previewRecord;
      if (preview) {
        try {
          const metadata = await sharp(preview, {
            limitInputPixels: 640 * 640,
          }).metadata();
          if (
            metadata.format !== 'png' ||
            metadata.width > 640 ||
            metadata.height > 640 ||
            (metadata.pages || 1) !== 1
          )
            throw new Error('地图缩略图格式无效。');
          // Decode the pixels too: a valid header alone does not prove a usable thumbnail.
          await sharp(preview, { limitInputPixels: 640 * 640 })
            .raw()
            .toBuffer();
          const previewPath = relative.replace(
            /map-source\.zip$/,
            'preview.png',
          );
          await writeFile(path.join(root, previewPath), preview, {
            flag: 'wx',
          });
          previewRecord = {
            path: previewPath,
            sha256: createHash('sha256').update(preview).digest('hex'),
            width: metadata.width,
            height: metadata.height,
          };
        } catch {
          /* The committed source remains usable without this optional attachment. */
        }
      }
      const now = new Date().toISOString();
      const record = {
        id: outputId,
        projectId: id,
        revision: expectedRevision + 1,
        status: 'completed',
        title: draft.snapshot.tiles
          .find((tile) => tile.key === '0,0')
          .images.overall.name.replace(/\.[^.]+$/, ''),
        tileCount: draft.snapshot.tiles.length,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        outputs: [relative],
        sha256: createHash('sha256').update(bytes).digest('hex'),
        ...(previewRecord ? { preview: previewRecord } : {}),
      };
      const directory = path.join(root, manifest.workspace.mapProjectDirectory);
      await mkdir(directory, { recursive: true });
      const temporary = path.join(directory, `${outputId}.${randomUUID()}.tmp`);
      await writeFile(temporary, JSON.stringify(record, null, 2));
      await rename(temporary, path.join(directory, `${outputId}.json`));
      return record;
    });
  locks.set(lockKey, operation);
  try {
    return await operation;
  } finally {
    if (locks.get(lockKey) === operation) locks.delete(lockKey);
  }
}
export async function readMapProjectPreview(root, manifest, record) {
  if (
    !record.preview ||
    record.preview.path !==
      record.outputs[0].replace(/map-source\.zip$/, 'preview.png')
  )
    throw new Error('此工程版本暂无预览。');
  const base = await realpath(
    path.dirname(path.resolve(root, record.outputs[0])),
  );
  const projectRoot = await realpath(
    path.join(root, manifest.workspace.outputDirectory, key(record.projectId)),
  );
  const relative = path.relative(projectRoot, base);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('地图预览越过工程目录。');
  const file = await realpath(path.resolve(root, record.preview.path));
  if (path.dirname(file) !== base || (await stat(file)).size > 2 * 1024 * 1024)
    throw new Error('地图缩略图不可读取。');
  const bytes = await readFile(file);
  if (
    createHash('sha256').update(bytes).digest('hex') !== record.preview.sha256
  )
    throw new Error('地图缩略图已变化。');
  return { bytes, mime: 'image/png' };
}
export async function saveMapProjectRequest(request, root, id) {
  if (
    (request.headers['content-type'] || '').split(';')[0] !== 'application/zip'
  )
    throw failure('请上传地图工程 ZIP。', 400);
  const revision = request.headers['x-map-revision'];
  if (typeof revision !== 'string' || !/^\d+$/.test(revision))
    throw failure('缺少地图工程版本。', 400);
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_MAP_PROJECT_BYTES)
      throw failure('地图工程超过 256 MB。', 413);
    chunks.push(chunk);
  }
  return saveMapProject(
    root,
    await loadManifest(),
    id,
    Number(revision),
    Buffer.concat(chunks),
  );
}
