import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

for (const mode of ['api', 'ui']) {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workbench-startup-'));
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    ['scripts/run-sprite-pipeline.mjs', mode],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SPRITE_PIPELINE_API_URL: url,
        NEXT_PUBLIC_SPRITE_PIPELINE_UI_URL: url,
        SPRITE_PIPELINE_DATA_DIR: directory,
        SPRITE_PIPELINE_EXPORTS_DIR: path.join(directory, 'exports'),
        SPRITE_PIPELINE_IMPORT_USER_ASSETS: '0',
        SPRITE_PIPELINE_IMPORT_USER_CREDENTIALS: '0',
        SPRITE_PIPELINE_API_TOKEN: '',
        GRADIO_ANALYTICS_ENABLED: 'False',
      },
    },
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      assert.equal(child.exitCode, null, output);
      try {
        const response = await fetch(url + '/health', {
          signal: AbortSignal.timeout(500),
        });
        ready = response.ok && (await response.json()).ok === true;
        if (ready) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert(ready, `${mode} failed to start: ${output}`);
    if (mode === 'ui') assert((await fetch(url)).ok, 'UI is unavailable');
    console.log(`${mode}: loopback health check passed`);
  } finally {
    if (process.platform === 'win32') {
      const killer = spawn(
        'taskkill.exe',
        ['/PID', String(child.pid), '/T', '/F'],
        { stdio: 'ignore' },
      );
      await new Promise((resolve) => killer.once('exit', resolve));
    } else child.kill('SIGTERM');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(timeout);
  }
}
