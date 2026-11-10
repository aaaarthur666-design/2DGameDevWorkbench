import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { createMapProjectPackage } from '../../features/map-stitcher/project-package.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
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

export async function sceneImageCommands(document, image, input) {
  if (image.kind !== 'background' || input.definitionId) throw new Error('场景背景采用需要 background 图片，且不接受交互物 definitionId。');
  return [{ type: 'replace-map', map: await backgroundMap(image) }];
}
