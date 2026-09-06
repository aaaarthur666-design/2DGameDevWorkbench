import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createTestViteServer as createServer } from '../helpers/vite-server.mjs';

const server = await createServer({
  root: process.cwd(),
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  resolve: { alias: { '@': resolve(process.cwd()) } },
  server: { middlewareMode: true },
});
const tests = [];
const test = (name, run) => tests.push({ name, run });

try {
  const { workbenchModules: modules, productionLines: lines } =
    await server.ssrLoadModule('/lib/workbench/modules.ts');
  const { taskWorkItems, spriteWorkItem, mergeWorkItems, interactableItemId } =
    await server.ssrLoadModule('/lib/workbench/work-items.ts');
  const sessions = await server.ssrLoadModule(
    '/lib/workbench/editor-session.ts',
  );
  const { isUntouchedStarterProject, isLegacyEmptyWorkItem } =
    await server.ssrLoadModule(
      '/features/interactable-editor/draft-activity.ts',
    );
  const { createProject } = await server.ssrLoadModule(
    '/features/interactable-editor/contract.mjs',
  );
  const { restoreTaskProject } = await server.ssrLoadModule('/features/interactable-editor/task-project.ts');
  test('Agent project resume preserves different local drafts and reuses the imported version', async () => {
    const project = createProject();
    const local = structuredClone(project);
    local.objects[0].displayName = '本机未导出的门';
    const records = new Map([[`interactable-project:${project.projectId}`, local]]);
    let requests = 0;
    const storage = {
      read: async (key) => records.get(key),
      save: async (key, value, _items, mapping) => { records.set(key, value); records.set(mapping, key); },
      items: () => [],
      request: async (url) => { requests++; return Response.json(url.includes('/tasks/') ? { task: { capabilityId: 'interactable-editor', status: 'completed', input: { operation: 'save-project' }, outputs: ['outputs/t1/interactable-project.json'] } } : project); },
    };
    const loaded = await restoreTaskProject('t1', storage);
    assert.notEqual(loaded.projectId, project.projectId);
    assert.equal(records.get(`interactable-project:${project.projectId}`).objects[0].displayName, '本机未导出的门');
    loaded.objects[0].displayName = '继续编辑 Agent 版本';
    assert.equal((await restoreTaskProject('t1', storage)).objects[0].displayName, '继续编辑 Agent 版本');
    assert.equal(requests, 2);
    await assert.rejects(restoreTaskProject('bad', { ...storage, request: async () => Response.json({ task: { capabilityId: 'map-stitcher', status: 'completed' } }) }), /尚未完成或无法读取/);
  });
  test('saved Agent projects appear saved and link directly to the editor', () => {
    const project = createProject();
    const [item] = taskWorkItems([{ id: 'saved-task', capabilityId: 'interactable-editor', status: 'completed', input: { operation: 'save-project', project } }], modules);
    assert.equal(item.state, 'saved');
    assert.match(item.detail, /尚未导出/);
    assert.match(item.href, /interactable-editor\?task=saved-task/);
    assert.equal(lines.find((line) => line.id === 'player').name, '角色美术');
  });

  const at = '2026-09-05T10:00:00.000Z';
  const later = '2026-09-05T10:01:00.000Z';
  const task = (overrides = {}) => ({
    id: 'task-1',
    capabilityId: 'sprite-generator',
    status: 'prepared',
    updatedAt: at,
    input: {},
    ...overrides,
  });

  test('untouched legacy starters are hidden while edits, explicit saves and exports stay visible', () => {
    const draft = createProject();
    const item = {
      id: 'legacy',
      capabilityId: 'interactable-editor',
      state: 'saved',
    };
    assert.equal(isUntouchedStarterProject(draft), true);
    assert.equal(isUntouchedStarterProject(createProject()), true);
    assert.equal(isLegacyEmptyWorkItem(item, draft), true);
    assert.equal(
      isLegacyEmptyWorkItem({ ...item, userInitiated: true }, draft),
      false,
    );
    assert.equal(
      isLegacyEmptyWorkItem({ ...item, outputs: ['object.zip'] }, draft),
      false,
    );
    assert.equal(
      isLegacyEmptyWorkItem({ ...item, taskIds: ['export-1'] }, draft),
      false,
    );
    assert.equal(
      isLegacyEmptyWorkItem({ ...item, state: 'completed' }, draft),
      false,
    );
    assert.equal(isLegacyEmptyWorkItem(item, undefined), false);
    assert.equal(
      isLegacyEmptyWorkItem(item, { ...draft, name: '我的项目' }),
      false,
    );
    const edited = structuredClone(draft);
    edited.objects[0].displayName = '箱子';
    assert.equal(isLegacyEmptyWorkItem(item, edited), false);
    const behavior = structuredClone(draft);
    behavior.objects[0].behavior.repeat = !behavior.objects[0].behavior.repeat;
    assert.equal(isLegacyEmptyWorkItem(item, behavior), false);
    assert.equal(
      isLegacyEmptyWorkItem(item, {
        ...draft,
        assets: [{ id: 'uploaded-art' }],
      }),
      false,
    );
  });
  test('entering and leaving a clean editor never invokes a draft save', async () => {
    let saves = 0;
    let guards = 0;
    sessions.publishEditorSession({
      capabilityId: 'untouched-editor',
      items: [],
      dirty: false,
      busy: false,
      save: async () => {
        saves++;
      },
      beforeLeave: () => {
        guards++;
      },
    });
    await sessions.saveBeforeNavigation();
    await sessions.saveBeforeNavigation();
    await sessions.saveBeforeReplacement('untouched-editor');
    assert.equal(saves, 0);
    assert.equal(guards, 3);
  });

  test('manifest production lines route every tool to a valid workflow', () => {
    assert.deepEqual(
      lines.map((line) => line.id),
      ['player', 'scene'],
    );
    assert.equal(lines.find((line) => line.id === 'player').href, '/player');
    assert.equal(lines.find((line) => line.id === 'scene').href, '/scene');
    for (const capability of modules) {
      assert.ok(lines.some((line) => line.id === capability.productionLine));
      assert.ok(capability.stages.length >= 2);
      assert.ok(capability.entryTitle && capability.starterHint);
    }
    assert.deepEqual(
      modules
        .filter((m) => m.productionLine === 'scene')
        .map((m) => m.id)
        .sort(),
      ['interactable-editor', 'map-stitcher', 'scene-composer'],
    );
  });
  test('prepared and unconfigured tasks never appear completed or running', () => {
    for (const status of ['prepared', 'awaiting_configuration', 'failed']) {
      assert.equal(
        taskWorkItems([task({ status })], modules)[0].state,
        'attention',
      );
    }
    assert.match(taskWorkItems([task()], modules)[0].detail, /尚未执行/);
  });
  test('sprite states distinguish saved, review, generation and actual export', () => {
    const expected = {
      created: 'saved',
      submitting: 'running',
      provider_pending: 'running',
      saving: 'running',
      review_required: 'attention',
      approved: 'saved',
      exported: 'completed',
      failed: 'attention',
      attention_required: 'attention',
      unknown: 'attention',
    };
    for (const [status, state] of Object.entries(expected)) {
      const item = spriteWorkItem(
        {
          job_id: 'job 1',
          status,
          updated_at: at,
          character_name: '主角',
          action_name: '待机',
        },
        '/tools/sprite-generator',
      );
      assert.equal(item.state, state, status);
      assert.equal(item.title, '主角 · 待机');
      assert.equal(item.href, '/tools/sprite-generator?job=job%201');
    }
  });
  test('execution attempts for one sprite merge while different sprites stay separate', () => {
    const items = taskWorkItems(
      [
        task({
          id: 'retry',
          status: 'completed',
          updatedAt: later,
          adapter: { remoteJobId: 'job-a', remoteStatus: 'review_required' },
          outputs: ['outputs/retry/result.json'],
        }),
        task({
          id: 'first',
          status: 'running',
          adapter: { remoteJobId: 'job-a', remoteStatus: 'provider_pending' },
        }),
        task({ id: 'other', adapter: { remoteJobId: 'job-b' } }),
      ],
      modules,
    );
    assert.equal(items.length, 2);
    const item = items.find((item) => item.id === 'sprite:job-a');
    assert.equal(item.state, 'attention');
    assert.deepEqual(item.taskIds, ['first', 'retry']);
    assert.deepEqual(item.outputs, ['outputs/retry/result.json']);
  });
  test('an Agent export without a local draft opens its real task and artifacts', () => {
    const [item] = taskWorkItems(
      [
        task({
          capabilityId: 'interactable-editor',
          status: 'completed',
          input: {
            project: {
              projectId: 'p1',
              objects: [{ definitionId: 'chest', displayName: '宝箱' }],
            },
          },
          outputs: ['outputs/task-1/godot.zip'],
        }),
      ],
      modules,
    );
    assert.equal(item.id, interactableItemId('p1', 'chest'));
    assert.equal(item.href, '/tools/interactable-editor?task=task-1&object=chest');
    assert.equal(item.title, '宝箱');
    assert.equal(item.state, 'completed');
  });
  test('local drafts preserve editable links and names while gathering execution outputs', () => {
    const local = {
      id: 'interactable:p1:chest',
      capabilityId: 'interactable-editor',
      title: '森林宝箱',
      detail: '本机草稿',
      state: 'saved',
      updatedAt: at,
      savedAt: at,
      href: '/tools/interactable-editor?project=p1&object=chest',
      draftKey: 'interactable-project:p1',
    };
    const remote = {
      ...local,
      title: '旧名称',
      state: 'completed',
      updatedAt: later,
      href: '/advanced?task=t1',
      draftKey: undefined,
      savedAt: undefined,
      taskIds: ['t1'],
      outputs: ['outputs/t1/godot.zip'],
    };
    const [item] = mergeWorkItems([local], [remote], [remote]);
    assert.equal(item.title, local.title);
    assert.equal(item.href, local.href);
    assert.equal(item.savedAt, at);
    assert.equal(item.state, 'completed');
    assert.deepEqual(item.outputs, remote.outputs);
    assert.deepEqual(item.taskIds, ['t1']);
    const [edited] = mergeWorkItems(
      [{ ...local, updatedAt: '2026-09-05T11:00:00.000Z' }],
      [remote],
    );
    assert.equal(
      edited.state,
      'saved',
      'editing after export must return to work in progress',
    );
  });
  test('navigation validates all editors before saving any of them', async () => {
    let saves = 0;
    sessions.publishEditorSession({
      capabilityId: 'test-map',
      items: [],
      dirty: false,
      busy: false,
      save: async () => {
        saves++;
      },
    });
    sessions.publishEditorSession({
      capabilityId: 'test-object',
      items: [],
      dirty: false,
      busy: true,
      save: async () => {
        saves++;
      },
      beforeLeave: () => {
        throw new Error('busy');
      },
    });
    await assert.rejects(sessions.saveBeforeNavigation(), /busy/);
    assert.equal(saves, 0);
  });
  test('save failures block navigation and edits during a save are flushed before leaving', async () => {
    sessions.publishEditorSession({
      capabilityId: 'test-map',
      items: [],
      dirty: true,
      busy: false,
      save: async () => {
        throw new Error('disk full');
      },
    });
    await assert.rejects(sessions.saveBeforeNavigation(), /disk full/);
    let saves = 0;
    sessions.publishEditorSession({
      capabilityId: 'test-map',
      items: [],
      dirty: true,
      busy: false,
      save: async () => {
        saves++;
        if (saves === 2) sessions.markEditorSaved('test-map');
      },
    });
    await sessions.saveBeforeNavigation();
    assert.equal(saves, 2);
    assert.equal(sessions.getEditorSessions()[0].dirty, false);
  });
  test('replacing a workspace also respects the active operation guard', async () => {
    let saves = 0;
    sessions.publishEditorSession({
      capabilityId: 'test-map',
      items: [],
      dirty: true,
      busy: true,
      save: async () => {
        saves++;
      },
      beforeLeave: () => {
        throw new Error('queue running');
      },
    });
    await assert.rejects(
      sessions.saveBeforeReplacement('test-map'),
      /queue running/,
    );
    assert.equal(saves, 0);
  });

  for (const { name, run } of tests) {
    try {
      await run();
      console.log(`PASS ${name}`);
    } finally {
      for (const session of sessions.getEditorSessions())
        sessions.removeEditorSession(session.capabilityId);
    }
  }
  console.log(`Workbench shell: ${tests.length} tests passed.`);
} finally {
  await server.close();
}
