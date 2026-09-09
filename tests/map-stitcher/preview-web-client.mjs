import React from 'react';
import { createRoot } from 'react-dom/client';
import { AssetLibrary } from '/components/workbench/asset-library.tsx';
import { createMapProjectPreview } from '/features/map-stitcher/project-preview.ts';
import {
  DEFAULT_DISPLAY_VISIBILITY,
  DEFAULT_IMAGE_LOCKS,
  DEFAULT_REGION_LOCKS,
  DEFAULT_REGION_VISIBILITY,
} from '/features/map-stitcher/frame-ronin-types.ts';
import '/app/globals.css';
import '/components/workbench/workbench.css';

const status = document.getElementById('test-result');
const realFetch = window.fetch.bind(window);
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
async function asset(name, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  draw(canvas.getContext('2d'));
  const blob = await new Promise((resolve) => canvas.toBlob(resolve));
  return {
    file: new File([blob], name, { type: 'image/png' }),
    url: URL.createObjectURL(blob),
    width: 256,
    height: 128,
    name,
    type: 'image/png',
    size: blob.size,
  };
}
try {
  const surface = await asset('surface.png', (ctx) => {
    ctx.fillStyle = '#3f7958';
    ctx.fillRect(0, 32, 256, 64);
  });
  const overall = await asset('overall.png', (ctx) => {
    ctx.fillStyle = '#3f7958';
    ctx.fillRect(0, 32, 256, 64);
    ctx.fillStyle = '#ffc857';
    ctx.fillRect(64, 0, 36, 24);
  });
  const object = await asset('object.png', (ctx) => {
    ctx.fillStyle = '#e45858';
    ctx.fillRect(96, 8, 64, 56);
  });
  const tile = {
    key: '0,0',
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    images: { overall, surface, object },
    hidden: false,
    feather: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const snapshot = {
    tiles: [
      tile,
      { ...tile, key: 'hidden', x: 200, hidden: true },
      { ...tile, key: 'empty', x: -200, images: {} },
    ],
    shapes: [
      {
        id: 'cut',
        tileKey: '0,0',
        mapLayer: 'object',
        layer: 'occlusion',
        mode: 'rectangle',
        points: [
          { x: 120, y: 10 },
          { x: 150, y: 90 },
        ],
      },
      {
        id: 'top',
        tileKey: '0,0',
        mapLayer: 'overall',
        layer: 'top',
        mode: 'rectangle',
        points: [
          { x: 64, y: 0 },
          { x: 100, y: 24 },
        ],
      },
    ],
    selectedKey: '0,0',
    horizontalOverlapPercent: 10,
    verticalOverlapPercent: 10,
    expandSplit: 4,
    pan: { x: 900, y: -20 },
    zoom: 3,
    activeMapLayer: 'white',
    overallPrompt: '',
    hidePreviewBorders: false,
    hidePreviewCards: false,
    displayVisibility: DEFAULT_DISPLAY_VISIBILITY,
    imageLocks: DEFAULT_IMAGE_LOCKS,
    regionLocks: DEFAULT_REGION_LOCKS,
    regionVisibility: DEFAULT_REGION_VISIBILITY,
  };
  const preview = await createMapProjectPreview(snapshot);
  const image = await createImageBitmap(preview);
  check(
    image.width === 256 && image.height === 128,
    '隐藏和空卡片污染裁切范围',
  );
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].join(',');
  check(pixel(10, 10) === '0,0,0,0', '透明区域丢失');
  check(pixel(104, 16) === '228,88,88,255', '物件层丢失');
  check(pixel(130, 50) === '63,121,88,255', '遮挡扣除位置不正确');
  check(pixel(70, 10) === '255,200,87,255', '顶层缺失');
  const huge = await createMapProjectPreview({
    ...snapshot,
    tiles: [{ ...tile, x: -2, w: 200 }],
  });
  const hugeImage = await createImageBitmap(huge);
  check(hugeImage.width <= 640 && hugeImage.height <= 640, '缩略图超过上限');
  await realFetch('/__map-preview?id=normal', {
    method: 'POST',
    body: preview,
  });
  await realFetch('/__map-preview?id=wide', { method: 'POST', body: huge });
  const assets = ['normal', 'wide', 'legacy', 'broken'].map((id, index) => ({
    id,
    title: [
      '林间平台 · 测试工程',
      '超宽地图 · 测试工程',
      '旧工程 · 暂无预览',
      '预览文件缺失 · 测试工程',
    ][index],
    kind: 'map',
    statusLabel: '已保存',
    availability: 'available',
    tileCount: 3,
    previewKind: id === 'legacy' ? 'none' : 'image',
    previewUrl: `/__map-preview?id=${id}`,
    updatedAt: '2026-09-08T20:00:00Z',
    viewPath: `/tests/map-stitcher/preview-web.html?asset=${id}`,
    editorPath: `/tests/map-stitcher/preview-web.html?editor=${id}`,
    files: [],
    readiness: { issues: [] },
  }));
  window.fetch = async (input, options) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('/api/workbench/assets?')) {
      const params = new URL(url, location.href).searchParams;
      return Response.json(
        params.has('assetId')
          ? { asset: assets.find((a) => a.id === params.get('assetId')) }
          : {
              assets,
              total: 4,
              nextOffset: null,
              snapshot: 'fixture',
              coverage: {
                complete: true,
                note: '隔离测试素材，未读取真实工程。',
                issues: [],
              },
            },
      );
    }
    return realFetch(input, options);
  };
  createRoot(document.getElementById('root')).render(
    React.createElement(AssetLibrary),
  );
  status.textContent =
    'PASS：真实画布验证透明、地表/物件/顶层合成、遮挡扣除、隐藏/空卡片裁切、超宽地图尺寸。以下为实际资产库组件。';
} catch (error) {
  status.textContent = `FAIL：${error.message}`;
  console.error(error);
}
