import {
  readWorkspaceDraft,
  listWorkItems,
} from '@/lib/workbench/browser-store';
import type { FrameRoninEditorSnapshot } from './state-package';
import type { GenerationJob } from './generation-queue';
import { MAP_IMAGE_LAYERS } from './frame-ronin-types';
import { blobToAsset } from './image-utils';

export type MapWorkspaceDraft = {
  version: 1;
  id: string;
  snapshot: FrameRoninEditorSnapshot;
  pending: Pick<GenerationJob, 'tileKey' | 'layer'>[];
};

export async function loadMapWorkspace(
  id?: string,
): Promise<MapWorkspaceDraft | undefined> {
  const items = await listWorkItems();
  const item = id
    ? items.find(
        (item) => item.id === id && item.capabilityId === 'map-stitcher',
      )
    : items
        .filter((item) => item.capabilityId === 'map-stitcher' && item.draftKey)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (!item?.draftKey) {
    if (id)
      throw new Error(
        '找不到这张地图的本机草稿。请在原浏览器中打开，或导入已保存的源文件。',
      );
    return;
  }
  const draft = await readWorkspaceDraft<MapWorkspaceDraft>(item.draftKey);
  if (!draft || draft.version !== 1 || !Array.isArray(draft.snapshot?.tiles))
    throw new Error('地图草稿格式无法读取，原记录已保留。');
  const created: string[] = [];
  try {
    const snapshot = {
      ...draft.snapshot,
      tiles: [] as FrameRoninEditorSnapshot['tiles'],
    };
    for (const tile of draft.snapshot.tiles) {
      const images = { ...tile.images };
      for (const layer of MAP_IMAGE_LAYERS) {
        const saved = images[layer];
        if (!saved) continue;
        if (!(saved.file instanceof Blob))
          throw new Error('地图草稿缺少原始图片，原记录已保留。');
        // Persisted object URLs belong to the old document; only the saved bytes are reusable.
        const asset = await blobToAsset(saved.file, saved.name);
        created.push(asset.url);
        images[layer] = asset;
      }
      snapshot.tiles.push({ ...tile, images });
    }
    return { ...draft, snapshot };
  } catch (error) {
    created.forEach((url) => URL.revokeObjectURL(url));
    throw error;
  }
}
