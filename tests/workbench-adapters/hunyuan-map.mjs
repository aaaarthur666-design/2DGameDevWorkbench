import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { runConnector, repositoryRoot } from '../../lib/workbench/runtime.mjs';
import {
  planHunyuanMapSize,
  validateHunyuanImageUrl,
} from '../../lib/workbench/adapters/hunyuan-map-image.mjs';

export async function testHunyuanMap(manifest, map) {
  const previousKey = process.env.TOKENHUB_API_KEY;
  const previousUrl = process.env.MAP_STITCHER_HUNYUAN_API_URL;
  const requests = [];
  let mode = 'success';
  let png;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString())
      : undefined;
    requests.push({ path: req.url, headers: req.headers, body });
    if (req.url === '/asset') {
      assert.equal(
        req.headers.authorization,
        undefined,
        'CDN must not receive the API key',
      );
      if (mode === 'download-error') {
        res.writeHead(503);
        res.end();
        return;
      }
      if (mode === 'redirect') {
        res.writeHead(302, { location: base + '/redirect-target' });
        res.end();
        return;
      }
      res.setHeader('content-type', 'image/png');
      res.end(png);
      return;
    }
    res.setHeader('content-type', 'application/json');
    if (mode === 'unauthorized') {
      res.writeHead(401);
      res.end(
        JSON.stringify({ error: { message: 'echo test-hunyuan-secret' } }),
      );
      return;
    }
    if (mode === 'empty') {
      res.end('{}');
      return;
    }
    const [width, height] =
      mode === 'wrong-size' ? [32, 8] : body.size.split('x').map(Number);
    png =
      mode === 'invalid-image'
        ? Buffer.from('invalid image')
        : await sharp({
            create: { width, height, channels: 4, background: '#1b602f' },
          })
            .png()
            .toBuffer();
    res.end(
      JSON.stringify({
        data: [
          {
            url:
              mode === 'unsafe-url'
                ? 'http://169.254.169.254/private'
                : base + '/asset',
          },
        ],
        request_id: 'test-request',
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const read = (task, name) => {
    const file = task.outputs.find((file) => file.endsWith('/' + name));
    assert.ok(file, name);
    assert.ok(file.startsWith(manifest.workspace.outputDirectory + '/'));
    return readFile(path.resolve(repositoryRoot, file));
  };
  try {
    process.env.MAP_STITCHER_HUNYUAN_API_URL = base + '/generate';
    delete process.env.TOKENHUB_API_KEY;
    const origin = {
      operation: 'generate-origin',
      provider: 'hunyuan-image-3',
      prompt: '像素森林，纯二维侧视',
    };
    const awaiting = await runConnector(manifest, map, origin);
    assert.equal(awaiting.task.status, 'awaiting_configuration');
    assert.equal(requests.length, 0);
    process.env.TOKENHUB_API_KEY = 'test-hunyuan-secret';
    for (const aspectRatio of ['1:1', '3:2', '2:3']) {
      const { task } = await runConnector(manifest, map, {
        ...origin,
        aspectRatio,
      });
      assert.equal(task.status, 'completed', task.error);
      const call = requests.at(-2);
      assert.equal(call.headers.authorization, 'Bearer test-hunyuan-secret');
      assert.equal(call.body.model, 'hy-image-v3');
      assert.equal(call.body.revise, false);
      assert.equal('images' in call.body, false);
      assert.match(call.body.prompt, /像素森林/);
      const [w, h] = call.body.size.split('x').map(Number);
      assert.ok(
        w >= 512 && h >= 512 && w <= 2048 && h <= 2048 && w * h <= 1048576,
      );
      const result = JSON.parse(await read(task, 'result.json'));
      assert.equal(result.requiresAdoption, true);
      assert.deepEqual(
        await sharp(await read(task, 'generated-origin.png'))
          .raw()
          .toBuffer(),
        await sharp(png).raw().toBuffer(),
      );
    }
    const templatePixels = Buffer.from([
      200, 10, 20, 255, 12, 22, 32, 128, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const template = await sharp(templatePixels, {
      raw: { width: 2, height: 2, channels: 4 },
    })
      .png()
      .toBuffer();
    const layer = {
      operation: 'generate-layer',
      provider: origin.provider,
      prompt: 'Extend the pixel forest into the transparent area.',
      image: `data:image/png;base64,${template.toString('base64')}`,
      tile: { key: '1,0', x: 1, y: 0, w: 1, h: 1 },
      layer: 'overall',
      mask_mode: 'white',
    };
    const expanded = await runConnector(manifest, map, layer);
    assert.equal(expanded.task.status, 'completed', expanded.task.error);
    const reference = requests.at(-2).body.images;
    assert.equal(reference.length, 1);
    assert.deepEqual(Buffer.from(reference[0], 'base64'), template);
    const pixels = await sharp(await read(expanded.task, 'generated-layer.png'))
      .ensureAlpha()
      .raw()
      .toBuffer();
    assert.deepEqual(
      pixels.subarray(0, 8),
      templatePixels.subarray(0, 8),
      'Existing opaque and partial alpha pixels must remain exact',
    );
    assert.deepEqual([...pixels.subarray(8, 12)], [27, 96, 47, 255]);
    for (const input of [origin, layer]) {
      for (mode of [
        'unauthorized',
        'empty',
        'unsafe-url',
        'download-error',
        'redirect',
        'wrong-size',
        'invalid-image',
      ]) {
        const before = requests.filter((r) => r.path === '/generate').length;
        const { task } = await runConnector(manifest, map, input);
        assert.equal(task.status, 'failed', mode);
        assert.equal(
          requests.filter((r) => r.path === '/generate').length,
          before + 1,
          'No paid retry',
        );
        assert.equal(
          task.outputs.some((file) =>
            /\/generated-(origin|layer)\.png$/.test(file),
          ),
          false,
        );
        assert.equal(
          JSON.stringify(task).includes('test-hunyuan-secret'),
          false,
        );
        if (mode === 'wrong-size')
          assert.ok(
            task.outputs.some((file) => /provider-response/.test(file)),
          );
      }
    }
    assert.equal(
      requests.some((r) => r.path === '/redirect-target'),
      false,
    );
    mode = 'success';
    const beforeInvalid = requests.length;
    const tooLong = await runConnector(manifest, map, {
      ...origin,
      prompt: '图'.repeat(8192),
    });
    assert.equal(tooLong.task.status, 'failed');
    assert.match(tooLong.task.error, /8192/);
    assert.equal(requests.length, beforeInvalid);
    assert.throws(() => planHunyuanMapSize(5000, 100), /画幅限制/);
    const large = planHunyuanMapSize(5504, 3072);
    assert.ok(large.width * large.height <= 1048576);
    const provider = map.connector.providers.find(
      (p) => p.id === origin.provider,
    );
    assert.throws(
      () => validateHunyuanImageUrl('http://localhost/private', provider),
      /不受支持/,
    );
    assert.throws(
      () =>
        validateHunyuanImageUrl(
          'https://user:secret@aigc-image.cos.myqcloud.com/file',
          provider,
        ),
      /不受支持/,
    );
    assert.equal(
      validateHunyuanImageUrl(
        'https://aigc-image.cos.myqcloud.com/image.png',
        provider,
      ),
      'https://aigc-image.cos.myqcloud.com/image.png',
    );
    console.log(
      'Hunyuan: origin, reference expansion, exact template preservation, URL safety, no secret leakage and no automatic retries passed.',
    );
  } finally {
    if (previousKey === undefined) delete process.env.TOKENHUB_API_KEY;
    else process.env.TOKENHUB_API_KEY = previousKey;
    if (previousUrl === undefined)
      delete process.env.MAP_STITCHER_HUNYUAN_API_URL;
    else process.env.MAP_STITCHER_HUNYUAN_API_URL = previousUrl;
    await new Promise((resolve) => server.close(resolve));
  }
}
