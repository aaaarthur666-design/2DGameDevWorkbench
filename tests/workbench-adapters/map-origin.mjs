import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  runConnector,
  repositoryRoot,
  validateInput,
} from '../../lib/workbench/runtime.mjs';
import { resolveMapGenerationProvider } from '../../lib/workbench/map-generation-settings.mjs';

export async function testMapOrigin(manifest, map) {
  const names = [
    'GEMINI_API_KEY',
    'OPENAI_API_KEY',
    'MAP_STITCHER_GEMINI_API_URL',
    'MAP_STITCHER_OPENAI_API_URL',
    'MAP_STITCHER_OPENAI_GENERATION_API_URL',
  ];
  const previous = names.map((name) => process.env[name]);
  const requests = [];
  let mode = 'success';
  let returned;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push({ url: req.url, body, headers: req.headers });
    res.setHeader('content-type', 'application/json');
    if (mode === 'http-error') {
      res.writeHead(401);
      res.end('{}');
      return;
    }
    if (mode === 'no-image') {
      res.end('{}');
      return;
    }
    const gemini = req.url === '/gemini';
    const sizes = { '1:1': [32, 32], '3:2': [1264, 848], '2:3': [848, 1264] };
    const [width, height] =
      mode === 'wrong-ratio'
        ? [40, 10]
        : gemini
          ? sizes[body.generationConfig.responseFormat.image.aspectRatio]
          : body.size.split('x').map(Number);
    returned =
      mode === 'invalid-image'
        ? Buffer.from('invalid image')
        : await sharp({
            create: { width, height, channels: 4, background: '#285940' },
          })
            .png()
            .toBuffer();
    res.end(
      JSON.stringify(
        gemini
          ? {
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        inlineData: {
                          mimeType: 'image/png',
                          data: returned.toString('base64'),
                        },
                      },
                    ],
                  },
                },
              ],
            }
          : { data: [{ b64_json: returned.toString('base64') }] },
      ),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const artifact = (task, suffix) => {
    const file = task.outputs.find((output) => output.endsWith('/' + suffix));
    assert.ok(file, `missing ${suffix}`);
    assert.ok(file.startsWith(manifest.workspace.outputDirectory + '/'));
    return path.resolve(repositoryRoot, file);
  };
  try {
    process.env.MAP_STITCHER_GEMINI_API_URL = base + '/gemini';
    process.env.MAP_STITCHER_OPENAI_API_URL = base + '/v1/images/edits';
    delete process.env.MAP_STITCHER_OPENAI_GENERATION_API_URL;
    process.env.GEMINI_API_KEY = 'test-origin-gemini';
    process.env.OPENAI_API_KEY = 'test-origin-openai';
    const input = {
      operation: 'generate-origin',
      prompt: '森林营地，无人物',
      provider: 'gpt-image-2',
    };
    for (const invalid of [
      { prompt: ' ' },
      { prompt: 'x'.repeat(12001) },
      { aspectRatio: '16:9' },
      { image: 'data:image/png;base64,AA==' },
      { apiKey: 'forbidden' },
    ]) {
      assert.ok(validateInput(map, { ...input, ...invalid }).length > 0);
    }
    assert.deepEqual(validateInput(map, input), []);
    delete process.env.OPENAI_API_KEY;
    const awaiting = await runConnector(manifest, map, input);
    assert.equal(awaiting.task.status, 'awaiting_configuration');
    assert.equal(requests.length, 0);
    process.env.OPENAI_API_KEY = 'test-origin-openai';
    assert.equal(
      resolveMapGenerationProvider(
        map.connector,
        input.provider,
        'generate-origin',
      ).endpoint,
      base + '/v1/images/generations',
    );
    process.env.MAP_STITCHER_OPENAI_GENERATION_API_URL =
      base + '/custom-generations';
    assert.equal(
      resolveMapGenerationProvider(
        map.connector,
        input.provider,
        'generate-origin',
      ).endpoint,
      base + '/custom-generations',
    );
    delete process.env.MAP_STITCHER_OPENAI_GENERATION_API_URL;
    for (const provider of ['nano-banana', 'gpt-image-2']) {
      for (const aspectRatio of ['1:1', '3:2', '2:3']) {
        const { task } = await runConnector(manifest, map, {
          ...input,
          provider,
          aspectRatio,
        });
        assert.equal(task.status, 'completed', task.error);
        const call = requests.at(-1);
        if (provider === 'nano-banana') {
          assert.equal(call.url, '/gemini');
          assert.equal(call.body.contents[0].parts.length, 1);
          assert.deepEqual(Object.keys(call.body.contents[0].parts[0]), [
            'text',
          ]);
          assert.match(call.body.contents[0].parts[0].text, /森林营地，无人物/);
          assert.deepEqual(call.body.generationConfig.responseFormat.image, {
            aspectRatio,
            imageSize: '1K',
          });
          assert.equal(call.headers['x-goog-api-key'], 'test-origin-gemini');
        } else {
          assert.equal(call.url, '/v1/images/generations');
          assert.equal(call.headers.authorization, 'Bearer test-origin-openai');
          assert.equal(call.body.n, 1);
          assert.equal(call.body.output_format, 'png');
          assert.equal(
            call.body.size,
            { '1:1': '1024x1024', '3:2': '1536x1024', '2:3': '1024x1536' }[
              aspectRatio
            ],
          );
          assert.equal('image' in call.body, false);
          assert.equal('mask' in call.body, false);
        }
        const png = await readFile(artifact(task, 'generated-origin.png'));
        assert.deepEqual(
          await sharp(png).raw().toBuffer({ resolveWithObject: true }),
          await sharp(returned).raw().toBuffer({ resolveWithObject: true }),
        );
        const result = JSON.parse(
          await readFile(artifact(task, 'result.json'), 'utf8'),
        );
        assert.equal(result.requiresAdoption, true);
        assert.equal(result.aspectRatio, aspectRatio);
        assert.equal(JSON.stringify(task).includes('test-origin-'), false);
      }
      for (const failure of [
        'http-error',
        'no-image',
        'wrong-ratio',
        'invalid-image',
      ]) {
        mode = failure;
        const before = requests.length;
        const { task } = await runConnector(manifest, map, {
          ...input,
          provider,
        });
        assert.equal(task.status, 'failed');
        assert.equal(
          requests.length,
          before + 1,
          'failure must not auto-retry a paid request',
        );
        assert.equal(
          task.outputs.some((file) => file.endsWith('/generated-origin.png')),
          false,
        );
        const diagnostics = JSON.parse(
          await readFile(artifact(task, 'generation-diagnostics.json'), 'utf8'),
        );
        assert.equal(diagnostics.stage, 'failed');
        if (failure === 'wrong-ratio' || failure === 'invalid-image') {
          assert.deepEqual(
            await readFile(artifact(task, 'provider-response.bin')),
            returned,
          );
        }
      }
      mode = 'success';
    }
    console.log(
      'Map origin: both providers, all ratios, missing key, validation, raw preservation and failures passed.',
    );
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
    await new Promise((resolve) => server.close(resolve));
  }
}
