import '../helpers/runtime-workspace.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// A disabled registration must not resolve its implementation, even when the
// files are absent. Check in a fresh process, before any module cache is warm.
const child = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '-e',
    `
  import assert from 'node:assert/strict';
  import { register } from 'node:module';
  import { mkdtemp, rm } from 'node:fs/promises';
  import os from 'node:os';
  import path from 'node:path';
  const hook = 'export async function resolve(specifier, context, next) { if (/asset-(map|scene)-type|agent-scene-(split|workflow)-operations/.test(specifier)) throw new Error("Optional implementation was loaded: " + specifier); return next(specifier, context); }';
  register('data:text/javascript,' + encodeURIComponent(hook), import.meta.url);
  const { assetTypeExtensions } = await import('./lib/workbench/asset-type-registry.mjs');
  const { optionalAgentOperation } = await import('./lib/workbench/agent-operation-registry.mjs');
  const { inspectAssetPackage, commitAssetPackages } = await import('./lib/workbench/asset-packages.mjs');
  const { createProject, createObject } = await import('./features/interactable-editor/contract.mjs');
  const root = await mkdtemp(path.join(os.tmpdir(), 'forge-retained-package-'));
  const manifest = { workspace: { importedAssetDirectory: 'assets', packageImportDirectory: 'imports' }, agentAssets: { assetCatalog: { disabledKinds: ['map', 'scene'] } } };
  try {
    assert.deepEqual(await assetTypeExtensions(manifest), []);
    assert.equal(await optionalAgentOperation(manifest, 'scene-workflow-settings'), null);
    assert.equal(await optionalAgentOperation(manifest, 'scene-split-inspect'), null);
    const project = createProject();
    project.objects = [createObject('inspect')];
    const inspection = await inspectAssetPackage(root, manifest, { bytes: Buffer.from(JSON.stringify(project)), filename: 'interactable-project.json' });
    assert.equal(inspection.candidates[0].kind, 'interactable');
    assert.equal(inspection.candidates[0].status, 'editable');
    const result = await commitAssetPackages(root, manifest, { commandId: 'retained-only', selections: [{ inspectionId: inspection.inspectionId, candidateId: inspection.candidates[0].id }] });
    assert.equal(result.importedCount, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
`,
  ],
  { cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8' },
);
assert.equal(child.status, 0, child.stderr || child.stdout);
console.log(
  'Optional asset types stay unloaded while retained package import and commit remain available.',
);
