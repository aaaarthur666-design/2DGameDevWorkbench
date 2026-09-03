#!/usr/bin/env node

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const expectedTools = [
  'workbench_list_capabilities',
  'workbench_describe_capability',
  'workbench_prepare_task',
  'workbench_run_task',
  'workbench_get_task',
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
});

try {
  await client.connect(transport);

  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name);
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

  const prepared = await client.callTool({
    name: 'workbench_prepare_task',
    arguments: {
      capabilityId: 'sprite-generator',
      input: { prompt: 'MCP self-test request' },
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

  const awaitingConfiguration = await client.callTool({
    name: 'workbench_run_task',
    arguments: {
      capabilityId: 'map-stitcher',
      input: { prompt: 'MCP connector-state self-test' },
    },
  });
  if (
    awaitingConfiguration.isError ||
    awaitingConfiguration.structuredContent?.status !==
      'awaiting_configuration' ||
    awaitingConfiguration.structuredContent?.requiredEnvironment !==
      'MAP_STITCHER_API_URL'
  ) {
    throw new Error('Unconfigured connector state was not preserved.');
  }

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
        connectorFallback: awaitingConfiguration.structuredContent.status,
        invalidInputRejected: true,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await client.close();
}
