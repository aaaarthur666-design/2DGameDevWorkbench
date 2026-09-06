import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { loadManifest, manifestPath, findCapability, prepareTask, listTasks } from '../../lib/workbench/runtime.mjs';

const original = process.env.WORKBENCH_TEST_RUN;
const production = JSON.parse(await readFile(manifestPath, 'utf8'));
const before = await readdir(production.workspace.taskDirectory).catch((error) => {
  if (error.code === 'ENOENT') return [];
  throw error;
});
try {
  delete process.env.WORKBENCH_TEST_RUN;
  assert.deepEqual((await loadManifest()).workspace, production.workspace);
  process.env.WORKBENCH_TEST_RUN = `isolation-${randomUUID()}`;
  const isolated = await loadManifest();
  assert.notEqual(isolated.workspace.taskDirectory, production.workspace.taskDirectory);
  assert.notEqual(isolated.workspace.outputDirectory, production.workspace.outputDirectory);
  const { task } = await prepareTask(isolated, findCapability(isolated, 'sprite-generator'), {
    operation: 'create', characterId: 'diagnostic_dummy', actionId: 'idle', provider: 'fixture',
  });
  const child = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    "import {loadManifest,listTasks} from './lib/workbench/runtime.mjs'; const m=await loadManifest(); console.log(JSON.stringify({workspace:m.workspace,tasks:await listTasks(m)}));"
  ], { encoding: 'utf8', windowsHide: true }));
  assert.deepEqual(child.workspace, isolated.workspace);
  assert.deepEqual(child.tasks.map((entry) => entry.id), [task.id]);
  process.env.WORKBENCH_TEST_RUN = `isolation-${randomUUID()}`;
  assert.deepEqual(await listTasks(await loadManifest()), []);
  for (const invalid of ['../tasks', 'a/b', 'a\\b', 'C:/work']) {
    process.env.WORKBENCH_TEST_RUN = invalid;
    await assert.rejects(loadManifest(), /simple test run identifier/);
  }
  const after = await readdir(production.workspace.taskDirectory).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  assert.deepEqual(after.sort((a, b) => a.localeCompare(b)), before.sort((a, b) => a.localeCompare(b)), 'Tests must not create production task records');
  console.log('PASS production defaults, isolated runs, subprocess inheritance, and path validation');
} finally {
  if (original === undefined) delete process.env.WORKBENCH_TEST_RUN;
  else process.env.WORKBENCH_TEST_RUN = original;
}
