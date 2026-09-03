#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';

import {
  findCapability,
  loadManifest,
  prepareTask,
  publicCapability,
  readTask,
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
      'This server exposes the capabilities of the current 2D game workbench project. List capabilities before selecting one, then inspect its schema. Use prepare_task before any unapproved external call or cost. Call run_task only when execution is authorized. An awaiting_configuration task is not complete; report its required environment variable. Never invent outputs, and report task IDs and paths exactly as returned.',
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
      'List the production capabilities registered in this project and whether each external connector is configured.',
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
      'Validate a request and write a local task record without calling an external connector.',
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
      'Validate a request and run its configured external connector. Without configuration, preserve an awaiting_configuration task instead of fabricating output.',
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
      'Read the exact current status, inputs, outputs, and error information for a local workbench task.',
    inputSchema: {
      taskId: z.string().min(1).describe('Task ID returned by this server.'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ taskId }) => {
    const manifest = await loadManifest();
    return { task: await readTask(manifest, taskId) };
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
