import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import {
  createObject,
  createProject,
} from '../../features/interactable-editor/contract.mjs';
import { buildGodotPackage } from '../../features/interactable-editor/godot-builder.mjs';

const arg = (key) =>
  process.argv.includes(key)
    ? process.argv[process.argv.indexOf(key) + 1]
    : undefined;
const reference = path.resolve(
  arg('--project') || process.env.COPYWORMS_PROJECT || '../copyWorms',
);
const godot = arg('--godot') || process.env.GODOT_46_BIN;
assert(
  godot,
  'Supply --godot or GODOT_46_BIN. This optional development test is not part of export.',
);
const out = arg('--reuse')
  ? path.resolve(arg('--reuse'))
  : path.resolve('outputs', `interactable-copyworms-tests-${Date.now()}`);
assert(
  out.startsWith(
    path.resolve('outputs') + path.sep + 'interactable-copyworms-tests-',
  ),
  'Test copies must stay in outputs/interactable-copyworms-tests-*',
);
const gitArgs = [
  '-c',
  `safe.directory=${reference.replaceAll('\\', '/')}`,
  '-C',
  reference,
];
const git = (...args) =>
  execFileSync('git', [...gitArgs, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
const statusBefore = git('--no-optional-locks', 'status', '--short');
const commit = git('rev-parse', 'HEAD').trim();
await mkdir(out, { recursive: true });
console.log(`Copying reference ${commit} into ${out}`);
// Copy working files (including local fixes); never import or write in the source checkout.
for (const file of git('ls-files', '-z').split('\0').filter(Boolean)) {
  if (/^(\.git|\.agents|\.codex|addons\/godot_ai)(\/|$)/i.test(file)) continue;
  const dest = path.resolve(out, file);
  assert(dest.startsWith(out + path.sep));
  await mkdir(path.dirname(dest), { recursive: true });
  try {
    await copyFile(path.join(reference, file), dest);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  } // Respect existing source deletions.
}
let config = await readFile(path.join(out, 'project.godot'), 'utf8');
config = config
  .replace(/^_mcp_game_helper=.*\r?\n/gm, '')
  .replace(
    /^enabled=PackedStringArray\("res:\/\/addons\/godot_ai\/plugin.cfg"\).*$/gm,
    'enabled=PackedStringArray()',
  );
await writeFile(path.join(out, 'project.godot'), config);
const project = createProject();
project.objects = ['inspect', 'toggle', 'pickup', 'sequence'].map(createObject);
for (const o of project.objects) o.definitionId = `compat-${o.behavior.kind}`;
project.objects[0].content.pages = ['兼容测试第一页', '兼容测试第二页'];
project.objects[0].content.charactersPerSecond = 0;
project.objects[3].behavior.entries.push(
  structuredClone(project.objects[3].behavior.entries[0]),
);
const built = await buildGodotPackage(
  { project, targetProfile: 'copyworms' },
  { repositoryRoot: process.cwd(), exportId: 'compatibility-test' },
);
const zip = await JSZip.loadAsync(built.bytes);
for (const [name, file] of Object.entries(zip.files)) {
  if (file.dir) continue;
  const dest = path.join(out, name);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, await file.async('nodebuffer'));
}
await writeFile(
  path.join(out, 'copyworms-regression.gd'),
  await readFile('tests/interactable-editor/copyworms-regression.gd'),
);
await writeFile(
  path.join(out, 'copyworms-regression.tscn'),
  '[gd_scene format=3]\n[ext_resource type="Script" path="res://copyworms-regression.gd" id="1"]\n[node name="CompatibilityRegression" type="Node"]\nscript = ExtResource("1")\n',
);
async function run(args, name, timeout) {
  let log = '';
  const child = spawn(godot, ['--headless', '--path', out, ...args], {
    windowsHide: true,
    env: { ...process.env, APPDATA: out },
  });
  child.stdout.on('data', (chunk) => {
    log += chunk;
  });
  child.stderr.on('data', (chunk) => {
    log += chunk;
  });
  const timer = setTimeout(() => child.kill(), timeout);
  const code = await new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  clearTimeout(timer);
  await writeFile(path.join(out, `${name}.log`), log);
  console.log(`${name}: exit=${code}; log=${path.join(out, `${name}.log`)}`);
  // Existing project import messages remain visible in the log; runtime failures are fatal.
  const cleaned = log.replace(
    /ERROR: Failed to read the root certificate store\.[^\n]*\n\s*at: [^\n]+\n/g,
    '',
  );
  assert.equal(code, 0, cleaned.slice(-14000));
  assert(
    !/SCRIPT ERROR:|Parse Error:|ERROR:/.test(cleaned),
    cleaned.slice(-14000),
  );
  return log;
}
await run(['--editor', '--import'], 'import', 240000);
const runtime = await run(
  ['res://copyworms-regression.tscn'],
  'runtime',
  60000,
);
const checks = /COPYWORMS_TESTS (\d+) checks, 0 failures/.exec(runtime);
assert(checks, runtime.slice(-14000));
assert.equal(
  git('--no-optional-locks', 'status', '--short'),
  statusBefore,
  'Reference working tree changed during isolated testing.',
);
console.log(
  JSON.stringify(
    {
      compatibility: 'passed',
      engineChecks: Number(checks[1]),
      referenceCommit: commit,
      output: out,
      referenceUnchanged: true,
    },
    null,
    2,
  ),
);
