import {
  createMapProjectPackage,
  readMapProjectPackage,
} from './project-package.mjs';
import type { MapWorkspaceDraft } from './workspace-draft';
import { blobToAsset } from './image-utils';
import { imageBytesSha256 } from '../image-assets/browser-client.mjs';

export async function unpackMapProject(
  bytes: ArrayBuffer,
): Promise<MapWorkspaceDraft> {
  const { draft, images } = await readMapProjectPackage(new Uint8Array(bytes));
  const restored = {
    ...draft,
    snapshot: { ...draft.snapshot, tiles: [] },
  } as unknown as MapWorkspaceDraft;
  const urls: string[] = [];
  try {
    for (const tile of draft.snapshot.tiles) {
      const assets: MapWorkspaceDraft['snapshot']['tiles'][number]['images'] =
        {};
      for (const [layer, asset] of Object.entries(tile.images)) {
        const file = new File(
          [new Uint8Array(images.get(asset.path))],
          asset.name,
          { type: asset.type },
        );
        const loaded = await blobToAsset(file, asset.name);
        if (asset.generation) loaded.generation = asset.generation;
        urls.push(loaded.url);
        assets[layer as keyof typeof assets] = loaded;
      }
      restored.snapshot.tiles.push({
        ...tile,
        images: assets,
      } as MapWorkspaceDraft['snapshot']['tiles'][number]);
    }
    return restored;
  } catch (error) {
    urls.forEach((url) => URL.revokeObjectURL(url));
    throw error;
  }
}
const endpoint = (id: string) =>
  `/api/workbench/map-stitcher/projects/${encodeURIComponent(id)}`;
export async function fetchMapProject(id: string, expectedRevision?: number) {
  const response = await fetch(endpoint(id), { cache: 'no-store', signal: AbortSignal.timeout(90000) });
  if (response.status === 404) return undefined;
  if (!response.ok)
    throw new Error('地图工程服务暂不可读。请保留当前页面后重试。');
  const serverRevision = Number(response.headers.get('x-map-revision'));
  if (!Number.isSafeInteger(serverRevision) || serverRevision < 1)
    throw new Error('地图工程版本无效。');
  if (expectedRevision !== undefined && expectedRevision !== serverRevision)
    throw new Error('已采用图片之后地图又有新版本，请保留本机草稿并重新打开工程。');
  const bytes = await response.arrayBuffer();
  const serverSha256 = await imageBytesSha256(new Uint8Array(bytes));
  const draft = await unpackMapProject(bytes);
  if (draft.id !== id) throw new Error('地图工程身份不匹配。');
  return { ...draft, serverRevision, serverSha256, serverSynced: true };
}
export async function persistMapProject(
  draft: MapWorkspaceDraft,
  revision: number,
  preview?: Uint8Array,
) {
  const bytes = await createMapProjectPackage(draft, preview);
  const response = await fetch(endpoint(draft.id), {
    method: 'PUT',
    headers: {
      'content-type': 'application/zip',
      'x-map-revision': String(revision),
    },
    body: new Blob([new Uint8Array(bytes)], { type: 'application/zip' }),
    signal: AbortSignal.timeout(90000),
  });
  const result = (await response.json()) as {
    error?: string;
    revision: number;
    sha256: string;
  };
  if (!response.ok) throw new Error(result.error || '地图工程保存失败。');
  if (!Number.isSafeInteger(result.revision) || result.revision < 1 || result.sha256 !== await imageBytesSha256(new Uint8Array(bytes)))
    throw new Error('地图工程保存响应的版本或源包哈希不匹配。');
  return { revision: result.revision, sha256: result.sha256 };
}
