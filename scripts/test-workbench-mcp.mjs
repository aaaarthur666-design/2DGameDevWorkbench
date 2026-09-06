#!/usr/bin/env node
import '../tests/helpers/runtime-workspace.mjs';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { loadManifest, agentRequest } from '../lib/workbench/runtime.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const expectedTools = [
  'workbench_list_capabilities',
  'workbench_describe_capability',
  'workbench_prepare_task',
  'workbench_run_task',
  'workbench_get_task',
  'workbench_get_environment',
  'workbench_start_services',
  'workbench_start_frontend',
  'workbench_list_presets',
  'workbench_interactable_template',
  'workbench_list_tasks',
  'workbench_get_result',
  'workbench_read_artifact',
];

const client = new Client(
  { name: 'workbench-self-test', version: '0.2.0' },
  { capabilities: {} },
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['scripts/workbench-mcp.mjs'],
  cwd: repositoryRoot,
  stderr: 'pipe',
  env: {
    ...Object.fromEntries(
      Object.entries(process.env).filter((entry) => entry[1] !== undefined),
    ),
    GEMINI_API_KEY: '',
    OPENAI_API_KEY: '',
    MAP_STITCHER_IMAGE_PROVIDER: '',
  },
});

try {
  await client.connect(transport);
  assert.match(client.getInstructions(), /first user message/);
  assert.match(client.getInstructions(), /present_files/);
  assert.match(client.getInstructions(), /not a handshake browser side effect/);
  const environment = await client.callTool({
    name: 'workbench_get_environment',
    arguments: {},
  });
  assert.equal(environment.isError, undefined);
  assert.equal(
    environment.structuredContent.frontend.hostAction.tool,
    'present_files',
  );
  assert.ok(environment.structuredContent.frontend.hostAction.arguments.cwd);
  assert.equal(typeof environment.structuredContent.frontend.ready, 'boolean');

  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name);
  assert.equal(
    listed.tools.find((tool) => tool.name === 'workbench_start_frontend')
      .annotations.readOnlyHint,
    false,
  );
  for (const expected of expectedTools) {
    if (!names.includes(expected)) {
      throw new Error(`Missing MCP tool: ${expected}`);
    }
  }

  const capabilities = await client.callTool({
    name: 'workbench_list_capabilities',
    arguments: {},
  });
  if (capabilities.isError || !capabilities.structuredContent) {
    throw new Error('Capability listing failed.');
  }

  const guide = await agentRequest(await loadManifest(), 'guidance');
  assert.deepEqual(capabilities.structuredContent.conversationGuidance, guide);
  assert.equal(guide.createsTask, false);
  assert.match(guide.text, /AskUserQuestion/);
  assert.match(guide.text, /角色与动作/);
  assert.match(guide.text, /地图/);
  assert.match(guide.text, /交互物/);
  await assert.rejects(
    agentRequest(await loadManifest(), 'guidance', { prompt: 'make a chest' }),
    /Invalid/,
  );

  const prepared = await client.callTool({
    name: 'workbench_prepare_task',
    arguments: {
      capabilityId: 'sprite-generator',
      input: {
        operation: 'create',
        characterId: 'diagnostic_dummy',
        actionId: 'idle',
        provider: 'fixture',
      },
    },
  });
  if (
    prepared.isError ||
    prepared.structuredContent?.status !== 'prepared' ||
    typeof prepared.structuredContent?.taskId !== 'string'
  ) {
    throw new Error('Task preparation failed.');
  }

  const task = await client.callTool({
    name: 'workbench_get_task',
    arguments: { taskId: prepared.structuredContent.taskId },
  });
  if (
    task.isError ||
    task.structuredContent?.task?.id !== prepared.structuredContent.taskId
  ) {
    throw new Error('Prepared task could not be read back.');
  }

  const beforeManual = await client.callTool({ name: 'workbench_list_tasks', arguments: {} });
  assert(!capabilities.structuredContent.capabilities.some((c) => c.id === 'map-stitcher'));
  for (const name of ['workbench_prepare_task', 'workbench_run_task', 'workbench_describe_capability']) {
    const blocked = await client.callTool({ name, arguments: { capabilityId: 'map-stitcher', ...(name === 'workbench_describe_capability' ? {} : { input: { operation: 'compose' } }) } });
    assert(blocked.isError);
    assert.match(blocked.content[0].text, /manual frontend/);
  }
  const afterManual = await client.callTool({ name: 'workbench_list_tasks', arguments: {} });
  assert.deepEqual(afterManual.structuredContent, beforeManual.structuredContent);
  for (const kind of ['inspect', 'toggle', 'pickup', 'sequence']) {
    const candidate = await client.callTool({ name: 'workbench_interactable_template', arguments: { kind } });
    assert(!candidate.isError);
    assert.equal(candidate.structuredContent.project.objects[0].behavior.kind, kind);
  }
  const template = await client.callTool({ name: 'workbench_interactable_template', arguments: { kind: 'toggle', name: '可开关的门' } });
  assert(!template.isError);
  assert.equal(template.structuredContent.createsTask, false);
  assert.equal(template.structuredContent.project.objects[0].behavior.kind, 'toggle');
  assert.deepEqual((await client.callTool({ name: 'workbench_list_tasks', arguments: {} })).structuredContent, beforeManual.structuredContent);
  const project = template.structuredContent.project;
  project.objects[0].content.prompt = '按 E 开门';
  const saved = await client.callTool({ name: 'workbench_run_task', arguments: { capabilityId: 'interactable-editor', input: { operation: 'save-project', project } } });
  assert(!saved.isError);
  assert.equal(saved.structuredContent.status, 'completed');
  assert(!saved.structuredContent.outputs.some((p) => p.endsWith('.zip')));
  const savedResult = await client.callTool({ name: 'workbench_get_result', arguments: { taskId: saved.structuredContent.taskId } });
  assert.equal(savedResult.structuredContent.result.exported, false);
  assert.match(savedResult.structuredContent.viewPath, /interactable-editor\?task=/);
  const savedSource = saved.structuredContent.outputs.find((p) => p.endsWith('/interactable-project.json'));
  const sourceResult = await client.callTool({ name: 'workbench_read_artifact', arguments: { taskId: saved.structuredContent.taskId, artifactPath: savedSource } });
  assert.equal(sourceResult.structuredContent.value.objects[0].content.prompt, '按 E 开门');
  project.objects[0].activation.key = 'F';
  project.objects[0].content.prompt = '按 F 开门';
  const revised = await client.callTool({ name: 'workbench_run_task', arguments: { capabilityId: 'interactable-editor', input: { operation: 'save-project', project } } });
  assert(!revised.isError);
  const revision = await client.callTool({ name: 'workbench_get_task', arguments: { taskId: revised.structuredContent.taskId } });
  assert.equal(revision.structuredContent.task.input.project.projectId, project.projectId);
  assert.equal(revision.structuredContent.task.input.project.objects[0].definitionId, project.objects[0].definitionId);
  assert.equal(revision.structuredContent.task.input.project.objects[0].activation.key, 'F');
  const previousSource = await client.callTool({ name: 'workbench_read_artifact', arguments: { taskId: saved.structuredContent.taskId, artifactPath: savedSource } });
  assert.equal(previousSource.structuredContent.value.objects[0].activation.key, 'E');


  const invalid = await client.callTool({
    name: 'workbench_prepare_task',
    arguments: {
      capabilityId: 'sprite-generator',
      input: {},
    },
  });
  if (!invalid.isError) {
    throw new Error('Invalid task input was accepted.');
  }

  const interactionDescription = await client.callTool({
    name: 'workbench_describe_capability',
    arguments: { capabilityId: 'interactable-editor' },
  });
  assert(!interactionDescription.isError);
  const interaction = await client.callTool({
    name: 'workbench_run_task',
    arguments: {
      capabilityId: 'interactable-editor',
      input: {
        operation: 'export-godot',
        targetProfile: 'copyworms',
        project,
      },
    },
  });
  assert(!interaction.isError, JSON.stringify(interaction));
  assert.equal(interaction.structuredContent?.status, 'completed');
  assert(
    interaction.structuredContent.outputs.some((output) =>
      output.endsWith('/interactables-copyworms.zip'),
    ),
  );
  const interactionTask = await client.callTool({
    name: 'workbench_get_task',
    arguments: { taskId: interaction.structuredContent.taskId },
  });
  assert.equal(interactionTask.structuredContent?.task?.status, 'completed');
  for (const output of interaction.structuredContent.outputs)
    await access(path.join(repositoryRoot, output));

  process.stdout.write(
    `${JSON.stringify(
      {
        server: 'ok',
        tools: names,
        capabilities:
          capabilities.structuredContent.capabilities?.map(
            (capability) => capability.id,
          ) ?? [],
        preparedTask: prepared.structuredContent.taskId,
        manualMapExecution: 'blocked without creating tasks',
        invalidInputRejected: true,
        interactionExport: {
          taskId: interaction.structuredContent.taskId,
          status: interaction.structuredContent.status,
          outputs: interaction.structuredContent.outputs,
        },
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await client.close();
}
