import assert from 'node:assert/strict';
import { createScene } from '../../features/scene-composer/model.mjs';
import { taskSpecSchema } from '../../lib/workbench/scene-workflow-contract.mjs';
import { validateWorkflowPlan } from '../../lib/workbench/scene-workflow-execution.mjs';

const description = '生成工厂素材，并在初始画面或声明的行为回放中显示。';
const source = {
  document: { content: createScene('可见性检查') },
  materials: [],
};
const work = {
  spec: taskSpecSchema.parse({
    documentId: 'visibility-scene',
    expectedRevision: 1,
    description,
    budget: { generationCalls: 4 },
  }),
  generationConfiguration: {
    prop: { provider: 'validation-only', model: 'no-provider-call' },
  },
  plans: [],
  steps: [],
  calls: [],
  imageCalls: [],
  generationCalls: [],
  clarifications: [],
};
const step = (id, kind, input, dependsOn = []) => ({
  id,
  title: id,
  kind,
  input: JSON.stringify(input),
  dependsOn,
});
const generate = (name = 'art') =>
  step(`generate-${name}`, 'generate', {
    purpose: 'object',
    materialId: name,
    definitionId: `${name}-definition`,
    name,
    prompt: '透明背景上的工厂素材',
  });
const derive = (
  commands,
  name = 'derived',
  from = 'art',
  dependency = `generate-${from}`,
) =>
  step(
    `configure-${name}`,
    'object',
    {
      materialId: name,
      definitionId: `${name}-definition`,
      name,
      source: { kind: 'scene', materialId: from },
      commands: commands.map((command) => ({
        ...command,
        definitionId: `${name}-definition`,
      })),
    },
    [dependency],
  );
const place = (
  materialId = 'art',
  producer = `generate-${materialId}`,
  flags = {},
) =>
  step(
    `place-${materialId}`,
    'scene',
    {
      commands: [
        { type: 'add-instance', materialId, instanceId: 'placed', x: 0, y: 0 },
        ...(Object.keys(flags).length
          ? [{ type: 'set-node-flags', ids: ['placed'], ...flags }]
          : []),
      ],
    },
    [producer],
  );
const acceptance = (events = [], expectedVisible = true, id = 'display') => ({
  id,
  description: '检查声明回放后的素材显示',
  requirementIds: ['goal'],
  events,
  expectEvents: [],
  expectStates: [{ instanceId: 'placed', visible: expectedVisible }],
});
const plan = (steps, checks = []) => ({
  title: '素材可见性',
  summary: description,
  requirements: [
    { id: 'goal', text: description, source: 'user', evidence: description },
  ],
  visualCriteria: [
    {
      id: 'visible-art',
      description: '生成素材可见',
      requirementIds: ['goal'],
      region: null,
    },
  ],
  steps,
  acceptance: checks,
  questions: [],
});
const validate = (proposed) =>
  validateWorkflowPlan(proposed, work, source, source.document.content);
const hiddenVisual = { type: 'set-visual', visual: { visible: false } };
const toggle = (initialToggle = false) => ({
  type: 'set-behavior',
  behavior: {
    kind: 'toggle',
    repeat: true,
    initialToggle,
    states: [
      { name: '隐藏', appearance: { visible: false } },
      { name: '显示', appearance: { visible: true } },
    ],
  },
});
const hiddenPlan = (commands, checks = [acceptance()]) =>
  plan(
    [generate(), derive(commands), place('derived', 'configure-derived')],
    checks,
  );
const originalFetch = globalThis.fetch;
globalThis.fetch = () => {
  throw new Error('Visibility validation never calls providers.');
};
let count = 0;
const test = (name, run) => {
  run();
  count++;
  console.log(`PASS ${name}`);
};
try {
  test('initially visible generated art passes without a behavior replay', () => {
    assert.equal(validate(plan([generate(), place()])).steps.length, 2);
    assert.throws(() => validate(plan([generate()])), /生成素材.*可见/);
  });
  test('hidden or excluded scene instances cannot establish generated-art visibility', () => {
    for (const flags of [{ hidden: true }, { included: false }])
      assert.throws(
        () => validate(plan([generate(), place('art', 'generate-art', flags)])),
        /生成素材.*可见/,
      );
  });
  test('base visual visibility and unexecuted expectation claims are respected', () => {
    assert.throws(
      () => validate(hiddenPlan([hiddenVisual])),
      /生成素材.*实际声明/,
    );
    assert.throws(() => validate(hiddenPlan([toggle()])), /生成素材.*实际声明/);
  });
  test('initial toggle appearance uses the real initialToggle state and runtime precedence', () => {
    assert.equal(
      validate(hiddenPlan([hiddenVisual, toggle(true)])).steps.length,
      3,
    );
    const reversed = toggle(true);
    reversed.behavior.states.reverse();
    assert.throws(() => validate(hiddenPlan([reversed])), /生成素材.*实际声明/);
  });
  test('a declared toggle replay can reveal initially hidden generated art', () => {
    assert.equal(
      validate(
        hiddenPlan(
          [toggle()],
          [acceptance([{ type: 'request', instanceId: 'placed' }])],
        ),
      ).steps.length,
      3,
    );
    assert.throws(
      () =>
        validate(
          hiddenPlan(
            [
              toggle(),
              { type: 'set-activation', activation: { enabled: false } },
            ],
            [acceptance([{ type: 'request', instanceId: 'placed' }])],
          ),
        ),
      /生成素材.*实际声明/,
    );
  });
  test('only a replay that actually ends visible supplies a saved visual observation', () => {
    const reveal = [{ type: 'request', instanceId: 'placed' }];
    const hideAgain = [...reveal, ...reveal];
    assert.throws(
      () => validate(hiddenPlan([toggle()], [acceptance(hideAgain)])),
      /生成素材.*实际声明/,
    );
    assert.equal(
      validate(
        hiddenPlan(
          [toggle()],
          [
            acceptance(hideAgain, false, 'hidden-end'),
            acceptance(reveal, true, 'visible-end'),
          ],
        ),
      ).steps.length,
      3,
    );
  });
  test('sequence appearance requires the real transition and completed feedback', () => {
    const sequence = {
      type: 'set-behavior',
      behavior: {
        kind: 'sequence',
        repeat: true,
        onEnd: 'stay_last',
        entries: [
          {
            name: '显示',
            pages: ['完成后显示'],
            appearance: { visible: true },
          },
        ],
      },
    };
    assert.throws(
      () =>
        validate(
          hiddenPlan(
            [hiddenVisual, sequence],
            [acceptance([{ type: 'request', instanceId: 'placed' }])],
          ),
        ),
      /生成素材.*实际声明/,
    );
    assert.equal(
      validate(
        hiddenPlan(
          [hiddenVisual, sequence],
          [
            acceptance([
              { type: 'request', instanceId: 'placed' },
              { type: 'advance-text' },
              { type: 'advance-text' },
            ]),
          ],
        ),
      ).steps.length,
      3,
    );
  });
  test('scene links can reveal generated art while every generated root still needs evidence', () => {
    const steps = [
      generate(),
      derive([hiddenVisual]),
      generate('control'),
      step(
        'place-linked',
        'scene',
        {
          commands: [
            {
              type: 'add-instance',
              materialId: 'derived',
              instanceId: 'placed',
              x: 0,
              y: 0,
            },
            {
              type: 'add-instance',
              materialId: 'control',
              instanceId: 'control',
              x: 50,
              y: 0,
            },
            {
              type: 'add-link',
              link: {
                id: 'reveal',
                sourceInstanceId: 'control',
                event: 'interaction_finished',
                targetInstanceId: 'placed',
                action: 'set_visible',
                value: true,
                enabled: true,
              },
            },
          ],
        },
        ['configure-derived', 'generate-control'],
      ),
    ];
    assert.throws(
      () => validate(plan(steps, [acceptance()])),
      /生成素材.*实际声明/,
    );
    assert.equal(
      validate(
        plan(steps, [acceptance([{ type: 'request', instanceId: 'control' }])]),
      ).steps.length,
      4,
    );
  });
  test('generated-root visibility follows multiple derived materials', () => {
    const first = derive([hiddenVisual]);
    const second = derive([toggle()], 'derived-again', 'derived', first.id);
    const steps = [
      generate(),
      first,
      second,
      place('derived-again', second.id),
    ];
    assert.throws(
      () => validate(plan(steps, [acceptance()])),
      /生成素材.*实际声明/,
    );
    assert.equal(
      validate(
        plan(steps, [acceptance([{ type: 'request', instanceId: 'placed' }])]),
      ).steps.length,
      4,
    );
  });
  console.log(
    `Scene workflow visibility: ${count} pure scenarios passed without model, provider or image calls.`,
  );
} finally {
  globalThis.fetch = originalFetch;
}
