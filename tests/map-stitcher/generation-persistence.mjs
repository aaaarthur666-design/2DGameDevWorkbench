import assert from 'node:assert/strict';
import JSZip from 'jszip';
import sharp from 'sharp';

// Only emulate browser file/image decoding; exercise the real ZIP format and PNG bytes.
export async function registerGenerationPersistenceTests(server, test) {
  const storage = await server.ssrLoadModule(
    '/features/map-stitcher/state-package.ts',
  );
  const geometry = await server.ssrLoadModule(
    '/features/map-stitcher/frame-ronin-geometry.ts',
  );
  test('tile requirements round-trip through ZIP, including center and empty cards; legacy stays empty', async () => {
    const before = {
      Image: globalThis.Image,
      FileReader: globalThis.FileReader,
    };
    globalThis.FileReader = class {
      readAsArrayBuffer(blob) {
        blob.arrayBuffer().then(
          (result) => this.onload({ target: { result } }),
          (error) => this.onerror({ target: { error } }),
        );
      }
    };
    globalThis.Image = class {
      set src(url) {
        fetch(url)
          .then((r) => r.arrayBuffer())
          .then((b) => sharp(Buffer.from(b)).metadata())
          .then(({ width, height }) => {
            this.naturalWidth = width;
            this.naturalHeight = height;
            this.onload();
          })
          .catch(() => this.onerror());
      }
    };
    const loadedUrls = [];
    const png = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 4,
        background: { r: 30, g: 80, b: 40, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const file = new File([png], 'source.png', { type: 'image/png' });
    const center = geometry.createFrameRoninCenterTile({
      file,
      name: file.name,
      type: file.type,
      size: file.size,
      url: URL.createObjectURL(file),
      width: 8,
      height: 8,
    });
    loadedUrls.push(center.images.overall.url);
    center.additionalPrompt = ' 中心森林\n保持侧视 ';
    const next = geometry.expandAroundFrameRoninTile(center, 4, 15, 15);
    assert.ok(next.every((tile) => !tile.additionalPrompt));
    next[0].additionalPrompt = '北侧木桥';
    const snapshot = {
      tiles: [center, ...next],
      shapes: [],
      selectedKey: next[0].key,
      horizontalOverlapPercent: 15,
      verticalOverlapPercent: 15,
      expandSplit: 4,
      pan: { x: 0, y: 0 },
      zoom: 1,
      activeMapLayer: 'overall',
      overallPrompt: 'base',
      hidePreviewBorders: false,
      hidePreviewCards: false,
      displayVisibility: {},
      regionVisibility: {},
      imageLocks: {},
      regionLocks: {},
    };
    try {
      const packed = await storage.createPixelworkStatePackage(snapshot);
      const roundTrip = await storage.loadFrameRoninState(
        new File([packed.blob], 'map.zip'),
      );
      for (const tile of roundTrip.tiles)
        if (tile.images.overall) loadedUrls.push(tile.images.overall.url);
      assert.equal(
        roundTrip.tiles.find((t) => t.key === '0,0').additionalPrompt,
        center.additionalPrompt,
      );
      assert.equal(
        roundTrip.tiles.find((t) => t.key === next[0].key).additionalPrompt,
        '北侧木桥',
      );
      assert.equal(
        roundTrip.tiles.find((t) => t.key === next[1].key).additionalPrompt,
        '',
      );
      assert.deepEqual(
        Buffer.from(await roundTrip.tiles[0].images.overall.file.arrayBuffer()),
        png,
      );
      const zip = await JSZip.loadAsync(await packed.blob.arrayBuffer());
      const manifest = JSON.parse(
        await zip.file('map_stitch_state.json').async('string'),
      );
      delete manifest.workbench.tileAdditionalPrompts;
      zip.file('map_stitch_state.json', JSON.stringify(manifest));
      const legacy = await storage.loadFrameRoninState(
        new File(
          [await zip.generateAsync({ type: 'uint8array' })],
          'legacy.zip',
        ),
      );
      for (const tile of legacy.tiles)
        if (tile.images.overall) loadedUrls.push(tile.images.overall.url);
      assert.ok(legacy.tiles.every((t) => t.additionalPrompt === ''));
      manifest.workbench.tileAdditionalPrompts = { '0,0': 'x'.repeat(2001) };
      zip.file('map_stitch_state.json', JSON.stringify(manifest));
      await assert.rejects(
        storage.loadFrameRoninState(
          new File(
            [await zip.generateAsync({ type: 'uint8array' })],
            'invalid.zip',
          ),
        ),
        /2000/,
      );
    } finally {
      loadedUrls.forEach((url) => URL.revokeObjectURL(url));
      for (const [key, value] of Object.entries(before)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
    }
  });
}
