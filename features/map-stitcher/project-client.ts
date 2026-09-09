import {
  createMapProjectPackage,
  readMapProjectPackage,
} from './project-package.mjs';
import type { MapWorkspaceDraft } from './workspace-draft';
import { blobToAsset } from './image-utils';

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
export async function fetchMapProject(id: string) {
  const response = await fetch(endpoint(id), { cache: 'no-store' });
  if (response.status === 404) return undefined;
  if (!response.ok)
    throw new Error('地图工程服务暂不可读。请保留当前页面后重试。');
  const draft = await unpackMapProject(await response.arrayBuffer());
  if (draft.id !== id) throw new Error('地图工程身份不匹配。');
  const serverRevision = Number(response.headers.get('x-map-revision'));
  if (!Number.isSafeInteger(serverRevision) || serverRevision < 1)
    throw new Error('地图工程版本无效。');
  return { ...draft, serverRevision, serverSynced: true };
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
  });
  const result = (await response.json()) as {
    error?: string;
    revision: number;
  };
  if (!response.ok) throw new Error(result.error || '地图工程保存失败。');
  return result.revision as number;
}
