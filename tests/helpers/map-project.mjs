import { createMapProjectPackage } from '../../features/map-stitcher/project-package.mjs';
export async function mapProjectFixture(png, id = 'map:fixture') {
  const flags = (keys) => Object.fromEntries(keys.map((key) => [key, true]));
  const layers = ['overall', 'surface', 'object', 'black', 'white'];
  const regions = ['occlusion', 'collision', 'adjust', 'top'];
  const image = {
    file: new Blob([png], { type: 'image/png' }),
    name: '地图.png',
    type: 'image/png',
    width: 16,
    height: 16,
  };
  const tile = {
    key: '0,0',
    x: -12,
    y: 7,
    w: 16,
    h: 16,
    images: Object.fromEntries(layers.map((key) => [key, image])),
    imageOrigins: { overall: 'uploaded' },
    surfaceIsDraft: true,
    additionalPrompt: ' 保留空白 ',
    feather: { top: 0, right: 2, bottom: 3, left: 4 },
    hidden: false,
  };
  const draft = {
    version: 1,
    id,
    pending: [
      {
        tileKey: '0,0',
        layer: 'overall',
        request: { provider: 'fixture', prompt: 'test' },
      },
    ],
    snapshot: {
      tiles: [tile],
      shapes: [
        {
          id: 'region',
          tileKey: '0,0',
          mapLayer: 'overall',
          layer: 'collision',
          mode: 'polygon',
          points: [
            { x: 1, y: 2 },
            { x: 8, y: 2 },
            { x: 8, y: 7 },
          ],
        },
      ],
      selectedKey: '0,0',
      horizontalOverlapPercent: 12,
      verticalOverlapPercent: 24,
      expandSplit: 8,
      pan: { x: 77, y: -12 },
      zoom: 0.75,
      activeMapLayer: 'object',
      overallPrompt: 'test',
      hidePreviewBorders: true,
      hidePreviewCards: false,
      displayVisibility: flags([...layers, 'mask']),
      regionVisibility: flags(regions),
      imageLocks: flags(layers),
      regionLocks: flags(regions),
      editorPreferences: {
        regionScope: 'tile',
        showRegions: true,
        showImage: false,
        concurrency: 2,
        memoryProtection: true,
        memoryLimitMb: 512,
      },
    },
  };
  return { draft, bytes: await createMapProjectPackage(draft) };
}
