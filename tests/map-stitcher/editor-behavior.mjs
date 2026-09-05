import assert from 'node:assert/strict';

export async function registerEditorTests(server, test) {
  const state = await server.ssrLoadModule(
    '/features/map-stitcher/editor-state.ts',
  );
  const selectors = await server.ssrLoadModule(
    '/features/map-stitcher/editor-selectors.ts',
  );
  const regions = await server.ssrLoadModule(
    '/features/map-stitcher/region-engine.ts',
  );
  const storage = await server.ssrLoadModule(
    '/features/map-stitcher/state-package.ts',
  );
  const production = await server.ssrLoadModule(
    '/features/map-stitcher/map-production.ts',
  );
  const engine = await server.ssrLoadModule(
    '/features/map-stitcher/engine-export.ts',
  );
  const { GenerationQueue } = await server.ssrLoadModule(
    '/features/map-stitcher/generation-queue.ts',
  );
  const asset = (url) => ({ url, width: 100, height: 80 });
  const tile = {
    key: '0,0',
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    images: { overall: asset('overall'), object: asset('object') },
    feather: { top: 0, right: 0, bottom: 0, left: 0 },
    hidden: false,
  };
  const shape = {
    id: 'a',
    tileKey: tile.key,
    mapLayer: 'overall',
    layer: 'collision',
    mode: 'rectangle',
    points: [
      { x: 10, y: 10 },
      { x: 40, y: 40 },
    ],
  };
  const locks = {
    occlusion: false,
    collision: false,
    adjust: false,
    top: false,
  };
  const filter = {
    tileKey: tile.key,
    mapLayer: 'overall',
    scope: 'view',
    layer: 'collision',
  };
  const tick = () => new Promise((resolve) => setImmediate(resolve));

  test('visible region counts, lists and clear targets share one scope', () => {
    const all = [
      shape,
      { ...shape, id: 'b', mapLayer: 'surface' },
      { ...shape, id: 'c', tileKey: '1,0' },
      { ...shape, id: 'd', layer: 'top' },
    ];
    assert.deepEqual(
      selectors.regionsInScope(all, filter).map((r) => r.id),
      ['a'],
    );
    assert.deepEqual(
      selectors
        .regionsInScope(all, { ...filter, scope: 'tile' })
        .map((r) => r.id),
      ['a', 'b'],
    );
    assert.equal(
      selectors.regionsInScope(all, {
        ...filter,
        visibility: { collision: false },
      }).length,
      0,
    );
    const selected = new Set(
      selectors.regionsInScope(all, filter).map((r) => r.id),
    );
    assert.deepEqual(
      all.filter((r) => !selected.has(r.id)).map((r) => r.id),
      ['b', 'c', 'd'],
    );
  });
  test('region commands enforce the target lock and view, including cross-type deletion', () => {
    assert.throws(
      () =>
        selectors.assertRegionWrite(
          shape,
          { ...filter, layer: 'occlusion' },
          { ...locks, collision: true },
        ),
      /锁定/,
    );
    assert.throws(
      () =>
        selectors.assertRegionWrite(
          { ...shape, mapLayer: 'surface' },
          filter,
          locks,
        ),
      /范围/,
    );
    assert.throws(
      () =>
        selectors.assertRegionWrite(
          shape,
          { ...filter, visibility: { collision: false } },
          locks,
        ),
      /范围/,
    );
    assert.doesNotThrow(() =>
      selectors.assertRegionWrite(shape, filter, locks),
    );
  });
  test('image writes reject late results after lock cycles, replacement, history or project changes', () => {
    const document = { tiles: [tile], shapes: [shape] };
    const ticket = {
      epoch: 1,
      tileKey: tile.key,
      layer: 'overall',
      before: 'overall',
      lockVersion: 0,
    };
    assert.doesNotThrow(() =>
      state.assertImageWrite(ticket, document, 1, false, 0),
    );
    assert.throws(
      () => state.assertImageWrite(ticket, document, 1, true, 0),
      /锁定/,
    );
    assert.throws(
      () => state.assertImageWrite(ticket, document, 1, false, 2),
      /锁定/,
    );
    assert.throws(
      () => state.assertImageWrite(ticket, document, 2, false, 0),
      /历史/,
    );
    assert.throws(
      () =>
        state.assertImageWrite(
          ticket,
          {
            tiles: [{ ...tile, images: { overall: asset('new') } }],
            shapes: [],
          },
          1,
          false,
          0,
        ),
      /更新/,
    );
    assert.throws(
      () =>
        state.assertImageWrite(ticket, { tiles: [], shapes: [] }, 1, false, 0),
      /不存在/,
    );
  });
  test('undo/redo restores region and image documents with stable external-store snapshots', () => {
    const initial = { tiles: [tile], shapes: [] };
    const history = new state.MapHistory(initial, 3);
    let notifications = 0;
    const unsubscribe = history.subscribe(() => notifications++);
    const before = history.getSnapshot();
    const added = { ...initial, shapes: [shape] };
    history.commit(added, 'create');
    assert.notEqual(history.getSnapshot(), before);
    assert.equal(history.getSnapshot(), history.getSnapshot());
    const replaced = {
      tiles: [{ ...tile, images: { overall: asset('replacement') } }],
      shapes: [shape],
    };
    history.commit(replaced, 'replace');
    assert.equal(history.undo(), true);
    assert.equal(history.document, added);
    assert.equal(history.undo(), true);
    assert.equal(history.document, initial);
    assert.equal(history.redo(), true);
    assert.equal(history.document, added);
    assert.equal(history.redo(), true);
    assert.equal(history.document, replaced);
    assert.equal(notifications, 6);
    unsubscribe();
    history.undo();
    history.commit(
      { ...initial, shapes: [{ ...shape, id: 'branch' }] },
      'branch',
    );
    assert.equal(history.redo(), false);
  });
  test('history trims old assets but retains images reachable from redo', () => {
    const history = new state.MapHistory({ tiles: [tile], shapes: [] }, 2);
    for (const url of ['b', 'c', 'd'])
      history.commit(
        { tiles: [{ ...tile, images: { overall: asset(url) } }], shapes: [] },
        url,
      );
    assert.deepEqual(
      [...state.retainedAssets(history.documents()).keys()].sort((a, b) =>
        a.localeCompare(b),
      ),
      ['b', 'c', 'd'],
    );
    history.undo();
    assert.equal(state.retainedAssets(history.documents()).has('d'), true);
    history.clearHistory();
    assert.deepEqual(
      [...state.retainedAssets(history.documents()).keys()],
      ['c'],
    );
    history.reset({ tiles: [], shapes: [] });
    assert.equal(history.documents().length, 1);
  });
  test('closed free regions share SVG, hit-test and Godot polygon geometry', () => {
    const free = {
      ...shape,
      mode: 'free',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 80 },
        { x: 0, y: 80 },
      ],
    };
    assert.match(regions.shapeSvgPath(free), /Z$/);
    assert.equal(regions.hitTestRegionShape(free, { x: 50, y: 40 }, 0), true);
    assert.equal(regions.hitTestRegionShape(free, { x: 120, y: 40 }, 0), false);
    assert.deepEqual(
      regions.mapShapeToWorldPixels(free, tile, 100, 80),
      free.points,
    );
  });
  test('invalid region coordinates, zero area and self intersections are rejected', () => {
    assert.match(
      regions.regionValidationError('polygon', [
        { x: 0, y: 0 },
        { x: 40, y: 40 },
        { x: 0, y: 40 },
        { x: 60, y: 0 },
      ]),
      /自交/,
    );
    assert.ok(
      regions.regionValidationError('free', [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    );
    assert.equal(
      regions.normalizeRegionShape(
        { ...shape, points: [...shape.points, { x: NaN, y: 3 }] },
        100,
        80,
      ),
      null,
    );
    const corners = [
      { x: 10, y: 10 },
      { x: 40, y: 10 },
      { x: 40, y: 40 },
      { x: 10, y: 40 },
    ];
    assert.deepEqual(
      regions.shapePolygonPoints({ ...shape, points: corners }),
      corners,
    );
  });
  test('object and mask cache identities track relevant assets, regions and dimensions only', () => {
    const key = (t, layer = 'object', shapes = []) =>
      selectors.tileRenderKey(t, layer, shapes, 100, 80);
    assert.notEqual(key(tile), key(tile, 'mask'));
    assert.notEqual(
      key(tile),
      key({ ...tile, images: { ...tile.images, object: asset('new') } }),
    );
    assert.notEqual(key(tile), key({ ...tile, w: 0.5 }));
    assert.notEqual(
      key(tile),
      key(tile, 'object', [
        { ...shape, layer: 'occlusion', mapLayer: 'surface' },
      ]),
    );
    assert.equal(key(tile), key(tile, 'object', [shape]));
    assert.equal(
      key(tile),
      key(tile, 'object', [
        { ...shape, tileKey: 'elsewhere', layer: 'occlusion' },
      ]),
    );
  });
  test('draft surfaces never count as separated production output', () => {
    const complete = {
      ...tile,
      images: { ...tile.images, surface: asset('surface') },
    };
    assert.equal(production.canUseSeparatedComposite([complete]), true);
    assert.equal(
      production.canUseSeparatedComposite([
        { ...complete, surfaceIsDraft: true },
      ]),
      false,
    );
    assert.equal(
      production.canUseSeparatedComposite([complete, { ...tile, key: '1,0' }]),
      false,
    );
    assert.equal(
      production.canUseSeparatedComposite([
        complete,
        { ...tile, key: '1,0', hidden: true },
      ]),
      true,
    );
  });
  test('hidden tile regions do not enter engine exports', () => {
    const manifest = engine.buildRegionManifest(
      [{ ...tile, hidden: true }],
      [shape],
      100,
      80,
      { originX: 0, originY: 0, width: 100, height: 80 },
    );
    assert.equal(manifest.regions.length, 0);
    const overallNode = engine
      .buildGodotScene(manifest, ['overall', 'surface', 'object'], false)
      .split('\n\n')
      .find((block) => block.includes('[node name="Overall"'));
    assert.ok(overallNode);
    assert.doesNotMatch(overallNode, /visible = false/);
  });
  test('center-only states and preference compatibility remain supported', () => {
    assert.deepEqual(storage.parsePixelworkGeometry({}), {});
    assert.deepEqual(
      state.readEditorPreferences({
        concurrency: Infinity,
        memoryLimitMb: -3,
        regionScope: 'tile',
        showRegions: false,
      }),
      {
        ...state.DEFAULT_EDITOR_PREFERENCES,
        regionScope: 'tile',
        showRegions: false,
        memoryLimitMb: 64,
      },
    );
    assert.equal(
      selectors.estimateDocumentBytes({
        tiles: [tile, { ...tile, key: '1,0' }],
        shapes: [],
      }),
      2 * 100 * 80 * 4,
    );
  });
  test('queue respects concurrency, target deduplication, pause and resume', async () => {
    const pending = new Map();
    const started = [];
    const queue = new GenerationQueue({
      concurrency: () => 2,
      canStart: () => null,
      run: (job) =>
        new Promise((resolve) => {
          started.push(job.tileKey);
          pending.set(job.tileKey, resolve);
        }),
      onChange: () => {},
    });
    queue.add(
      ['a', 'b', 'c', 'a'].map((tileKey) => ({ tileKey, layer: 'overall' })),
    );
    await tick();
    assert.deepEqual(started, ['a', 'b']);
    assert.equal(queue.snapshot().jobs.length, 3);
    queue.pause();
    pending.get('a')();
    pending.get('b')();
    await tick();
    assert.deepEqual(started, ['a', 'b']);
    queue.resume();
    await tick();
    assert.deepEqual(started, ['a', 'b', 'c']);
    pending.get('c')();
    await tick();
    assert.equal(
      queue.snapshot().jobs.every((job) => job.status === 'completed'),
      true,
    );
  });
  test('memory limits pause before dispatch and allow explicit recovery', async () => {
    let blocked = true,
      calls = 0;
    const queue = new GenerationQueue({
      concurrency: () => 4,
      canStart: () => (blocked ? 'memory limit' : null),
      run: async () => {
        calls++;
      },
      onChange: () => {},
    });
    queue.add([{ tileKey: 'a', layer: 'overall' }]);
    await tick();
    assert.equal(calls, 0);
    assert.equal(queue.snapshot().paused, true);
    assert.equal(queue.snapshot().reason, 'memory limit');
    blocked = false;
    queue.resume();
    await tick();
    assert.equal(calls, 1);
  });
  test('queue cancellation aborts active work and suppresses completion expansion', async () => {
    let resolve,
      signal,
      completions = 0,
      calls = 0;
    const queue = new GenerationQueue({
      concurrency: () => 1,
      canStart: () => null,
      run: (_job, activeSignal) => {
        calls++;
        signal = activeSignal;
        return new Promise((done) => {
          resolve = done;
        });
      },
      onComplete: () => {
        completions++;
      },
      onChange: () => {},
    });
    queue.add([
      { tileKey: 'a', layer: 'overall' },
      { tileKey: 'b', layer: 'overall' },
    ]);
    await tick();
    queue.cancel();
    assert.equal(signal.aborted, true);
    resolve();
    await tick();
    assert.equal(calls, 1);
    assert.equal(completions, 0);
    assert.equal(queue.snapshot().active, 0);
    assert.equal(
      queue.snapshot().jobs.every((job) => job.status === 'cancelled'),
      true,
    );
  });
  test('retry only reruns failed items and reports the concrete failure', async () => {
    let attempts = 0;
    const queue = new GenerationQueue({
      concurrency: () => 1,
      canStart: () => null,
      run: async () => {
        if (++attempts === 1) throw new Error('fixture failure');
      },
      onChange: () => {},
    });
    queue.add([{ tileKey: 'a', layer: 'object' }]);
    await tick();
    assert.equal(queue.snapshot().jobs[0].error, 'fixture failure');
    queue.retry();
    await tick();
    assert.equal(queue.snapshot().jobs[0].status, 'completed');
    assert.equal(attempts, 2);
    queue.retry();
    await tick();
    assert.equal(attempts, 2);
  });
}
