import '../helpers/runtime-workspace.mjs';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { loadManifest } from '../../lib/workbench/runtime.mjs';
import { getPublicMapGenerationSettings, updateMapGenerationSettings } from '../../lib/workbench/map-generation-settings.mjs';
import { mapSettingsPath } from '../../lib/workbench/map-settings-store.mjs';
import { createMacMapCredentials } from '../../lib/workbench/macos-map-credentials.mjs';

export function registerApiSettingsTests(test) {
  test('macOS map credentials use a keychain-backed key without secrets in argv and reject tampering', () => {
    const entries = new Map();
    const calls = [];
    const run = (command, args, options) => {
      calls.push({ command, args });
      assert.equal(command, '/usr/bin/security');
      if (args[0] === '-i') {
        const match = /^add-generic-password -a ([0-9a-f-]+) -s 2DGameDevWorkbench\.map-generation -w ([0-9a-f]{64})\n$/.exec(options.input);
        assert.ok(match);
        entries.set(match[1], match[2]);
        return { status: 0, stdout: '' };
      }
      return { status: 0, stdout: entries.get(args[4]) + '\n' };
    };
    const credentials = createMacMapCredentials(run);
    const clear = JSON.stringify({ keys: { provider: 'private-fixture'.repeat(300) } });
    const sealed = credentials.seal(clear);
    assert.ok(!sealed.includes('private-fixture'));
    assert.ok(!JSON.stringify(calls).includes([...entries.values()][0]));
    assert.equal(credentials.open(sealed), clear);
    const record = JSON.parse(sealed);
    assert.equal(credentials.open(credentials.seal('updated', record.account)), 'updated');
    assert.equal(entries.size, 1);
    record.tag = Buffer.alloc(16).toString('base64');
    assert.throws(() => credentials.open(JSON.stringify(record)));
    assert.throws(() => createMacMapCredentials(() => ({ status: 1, stdout: '' })).seal(clear), /钥匙串/);
  });
  test('map API settings survive restart without exposing credentials and failed saves preserve settings', async () => {
    const connector = (await loadManifest()).capabilities.find(capability => capability.id === 'map-stitcher').connector;
    const key = 'map-persistence-fixture-key';
    updateMapGenerationSettings(connector, { provider: 'nano-banana', apiKey: key, active: true });
    updateMapGenerationSettings(connector, { provider: 'gpt-image-2', apiKey: 'second-fixture-key', active: true });
    const saved = updateMapGenerationSettings(connector, { provider: 'nano-banana', active: false });
    assert.equal(saved.active, false);
    assert.equal(saved.providers.filter(p => p.configured).length >= 2, true);
    const file = mapSettingsPath();
    const raw = readFileSync(file, 'utf8');
    if (['win32', 'darwin'].includes(process.platform)) assert.ok(!raw.includes(key));
    assert.ok(!JSON.stringify(saved).includes(key));
    assert.throws(() => updateMapGenerationSettings(connector, { provider: 'nano-banana', apiKey: 'replacement-fixture', active: 'invalid' }));
    assert.equal(readFileSync(file, 'utf8'), raw);

    const restarted = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { loadManifest } from './lib/workbench/runtime.mjs';
      import { getPublicMapGenerationSettings, resolveMapGenerationProvider, updateMapGenerationSettings } from './lib/workbench/map-generation-settings.mjs';
      const connector = (await loadManifest()).capabilities.find(c => c.id === 'map-stitcher').connector;
      const settings = getPublicMapGenerationSettings(connector);
      assert.equal(settings.active, false);
      assert.equal(settings.provider, 'nano-banana');
      assert.equal(resolveMapGenerationProvider(connector, 'nano-banana').apiKey === 'map-persistence-fixture-key', true);
      assert.equal(resolveMapGenerationProvider(connector, 'gpt-image-2').apiKey === 'second-fixture-key', true);
      assert.equal(updateMapGenerationSettings(connector, { provider: 'nano-banana', active: true }).active, true);
    `], { env: process.env, encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.equal(restarted.status, 0, 'A fresh runtime must restore both credentials and the disabled selection.');
    assert.equal(getPublicMapGenerationSettings(connector).active, true);

    const valid = readFileSync(file, 'utf8');
    writeFileSync(file, '{invalid');
    assert.throws(() => getPublicMapGenerationSettings(connector), /无法读取/);
    assert.throws(() => updateMapGenerationSettings(connector, { provider: 'nano-banana', active: false }), /无法读取/);
    writeFileSync(file, valid);
    assert.equal(getPublicMapGenerationSettings(connector).active, true);
  });
}
