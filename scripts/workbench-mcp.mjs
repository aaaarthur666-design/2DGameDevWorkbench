#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';

import {
  findCapability,
  loadManifest,
  prepareTask,
  publicCapability,
  refreshTask,
  runConnector,
  summarizeTask,
} from '../lib/workbench/runtime.mjs';

const server = new McpServer(
  {
    name: '2d-game-workbench',
    version: '0.2.0',
  },
  {
    instructions:
      'This server exposes the capabilities of the current 2D game workbench project. List capabilities before selecting one, then inspect its schema. Use prepare_task before any unapproved external call or cost. Call run_task only when execution is authorized. get_task safely refreshes running adapter jobs before returning their persisted state. An awaiting_configuration task is not complete. Never invent outputs, and report task IDs and paths exactly as returned.',
  },
);

function success(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function failure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

function registerTool(name, options, handler) {
  server.registerTool(name, options, async (input) => {
    try {
      return success(await handler(input));
    } catch (error) {
      return failure(error);
    }
  });
}

registerTool(
  'workbench_list_capabilities',
  {
    title: 'List 2D workbench capabilities',
    description:
      'List the production capabilities and local adapters registered in this project, including optional external-service configuration.',
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => {
    const manifest = await loadManifest();
    return { capabilities: manifest.capabilities.map(publicCapability) };
  },
);

registerTool(
  'workbench_describe_capability',
  {
    title: 'Describe a 2D workbench capability',
    description:
      'Read the full input schema, connector contract, workflow path, and output types for one registered capability.',
    inputSchema: {
      capabilityId: z.string().min(1).describe('Registered capability ID.'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ capabilityId }) => {
    const manifest = await loadManifest();
    return { capability: findCapability(manifest, capabilityId) };
  },
);

const taskInputSchema = {
  capabilityId: z.string().min(1).describe('Registered capability ID.'),
  input: z
    .record(z.string(), z.unknown())
    .describe('Input object matching the capability input schema.'),
};

registerTool(
  'workbench_prepare_task',
  {
    title: 'Prepare a 2D workbench task',
    description:
      'Validate a request and write a local task record without running its adapter or calling an external service.',
    inputSchema: taskInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ capabilityId, input }) => {
    const manifest = await loadManifest();
    const capability = findCapability(manifest, capabilityId);
    return summarizeTask(await prepareTask(manifest, capability, input));
  },
);

registerTool(
  'workbench_run_task',
  {
    title: 'Run a 2D workbench task',
    description:
      'Validate a request and run its manifest-selected local adapter. Operations that need an unconfigured external service remain awaiting_configuration instead of fabricating output.',
    inputSchema: taskInputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ capabilityId, input }) => {
    const manifest = await loadManifest();
    const capability = findCapability(manifest, capabilityId);
    return summarizeTask(await runConnector(manifest, capability, input));
  },
);

registerTool(
  'workbench_get_task',
  {
    title: 'Get a 2D workbench task',
    description:
      'Read a workbench task. If its adapter job is still running, poll that existing job once and persist the refreshed status and artifacts without starting new generation.',
    inputSchema: {
      taskId: z.string().min(1).describe('Task ID returned by this server.'),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ taskId }) => {
    const manifest = await loadManifest();
    const refreshed = await refreshTask(manifest, taskId);
    return {
      task: refreshed.task,
      ...(refreshed.refreshError ? { refreshError: refreshed.refreshError } : {}),
    };
  },
);

server.registerResource(
  'workbench-manifest',
  'workbench://manifest',
  {
    title: '2D Game Dev Workbench manifest',
    description:
      'Canonical capability catalog shared by the visual console, CLI, and agent clients.',
    mimeType: 'application/json',
  },
  async () => {
    const manifest = await loadManifest();
    return {
      contents: [
        {
          uri: 'workbench://manifest',
          mimeType: 'application/json',
          text: JSON.stringify(manifest, null, 2),
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('2D Game Dev Workbench MCP server ready on stdio.');
