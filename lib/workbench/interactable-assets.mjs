import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assetExtensions,
  readAsset,
} from '../../features/interactable-editor/godot-builder.mjs';

export async function readInteractableAsset(source, repositoryRoot) {
  if (typeof source !== 'string' || source.startsWith('data:'))
    throw new Error('素材路径无效');
  const mime = Object.keys(assetExtensions).find(
    (key) => assetExtensions[key] === path.extname(source).toLowerCase(),
  );
  if (!mime) throw new Error('只允许读取图片或音效素材');
  return {
    mime,
    bytes: await readAsset(
      { source, name: path.basename(source), mime },
      repositoryRoot,
    ),
  };
}

export async function storeInteractableAsset(request, repositoryRoot) {
  const mime = request.headers['content-type']?.split(';')[0];
  if (!Object.hasOwn(assetExtensions, mime ?? ''))
    throw new Error('不支持的素材类型');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024 * 1024) throw new Error('素材超过 64 MB');
    chunks.push(chunk);
  }
  if (!size) throw new Error('素材文件为空');
  const relative = `work/assets/interactables/${randomUUID()}${assetExtensions[mime]}`;
  await mkdir(path.dirname(path.join(repositoryRoot, relative)), {
    recursive: true,
  });
  await writeFile(path.join(repositoryRoot, relative), Buffer.concat(chunks), {
    flag: 'wx',
  });
  return { source: relative, size, mime };
}
