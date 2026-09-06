#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import { KINDS } from '../features/interactable-editor/contract.mjs';

import {
  agentRequest,
  findAgentCapability,
  agentCapabilities,
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
    version: '0.6.0',
  },
  {
    instructions:
      'WorkBuddy session startup: on the first user message after connecting this server, unless the user opts out of opening the UI, call workbench_get_environment. If frontend.ready is false, call workbench_start_frontend once when services are offline, then poll get_environment at bounded intervals (up to 60 seconds); stop on blocked/conflict/unreachable and report the reason. When ready, discover the host-native present_files tool (possibly connector-proxy namespaced), inspect its schema, and call it with frontend.hostAction.arguments to open frontend.url in the WorkBuddy internal preview. Reuse an existing workbench preview and do not reopen it on each message, reconnect, or if the user closes it in this conversation. This is a first-conversation Agent workflow, not a handshake browser side effect. Only the host tool can confirm that the page opened; if unavailable, report that limitation and show the URL. Never open the OS default browser as a substitute. Do not apply WorkBuddy browser startup to other MCP clients or diagnostic clients. Continue the original user request after this local setup; it authorizes no generation or provider charges. For vague production requests, follow conversationGuidance returned by list_capabilities: inspect context and existing assets before asking, use the host-native AskUserQuestion only if currently available after inspecting its schema, otherwise ask concisely in chat. Do not create placeholder tasks while clarifying or mistake unanswered questions for consent. Map stitching and map generation are manual frontend workflows and cannot be prepared or run through MCP. For interactables, get a template without creating a task, edit its project, save-project for frontend continuation, then export-godot when requested. This server exposes the capabilities of the current 2D game workbench project. List capabilities before selecting one, then inspect its schema. Use prepare_task before any unapproved external call or cost. Call run_task only when execution is authorized. get_task safely refreshes running adapter jobs before returning their persisted state. An awaiting_configuration task is not complete. Never invent outputs, and report task IDs and paths exactly as returned. Use get_environment and start_services for local readiness, list_presets for real IDs, list_tasks for earlier work, and get_result/read_artifact to inspect actual outputs. Review candidate frames before approve, recording visual evidence in reviewNote; check/approve/export are separate operations. For ambiguous generation failures inspect the saved remoteJobId and recover the original job instead of resubmitting.',
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
    structuredContent: {
      error: {
        message,
        ...(message.match(/^Task ([a-z0-9_-]+) failed:/i)
          ? {
              taskId: message.match(/^Task ([a-z0-9_-]+) failed:/i)[1],
              recovery:
                'Read this task and its existing remoteJobId before taking further action; do not blindly regenerate.',
            }
          : {}),
      },
    },
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
      'List the production capabilities and local adapters registered in this project, including optional external-service configuration and the conversation guide for turning vague requests into executable tasks.',
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
    return {
      capabilities: agentCapabilities(manifest).map(publicCapability),
      conversationGuidance: await agentRequest(manifest, 'guidance'),
    };
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
    return { capability: findAgentCapability(manifest, capabilityId) };
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
    const capability = findAgentCapability(manifest, capabilityId);
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
    const capability = findAgentCapability(manifest, capabilityId);
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
      ...(refreshed.refreshError
        ? { refreshError: refreshed.refreshError }
        : {}),
    };
  },
);

const discoveryTools = [
  [
    'workbench_interactable_template',
    'interactable-template',
    'Return a complete editable interactable project template without writing a task. Choose inspect, toggle, pickup or sequence; preserve returned IDs while editing. Save with save-project, open get_result.viewPath for frontend editing, and export-godot only when requested.',
    { kind: z.enum(KINDS).optional(), name: z.string().min(1).max(200).optional() },
  ],
  [
    'workbench_start_frontend',
    'frontend',
    'Start or reuse the local frontend and runtime bridge without generation, installing dependencies, or opening a browser. Query get_environment until frontend.ready, then let WorkBuddy call the host-native present_files using frontend.hostAction.arguments. Stop if blocked.',
    {},
  ],
  [
    'workbench_get_environment',
    'environment',
    'Check installed runtime, live service compatibility and saved PixelLab key status; no generation or balance request.',
    {},
  ],
  [
    'workbench_start_services',
    'start',
    'Start only the configured local SpritePipeline if offline; reuse existing services. Never installs dependencies or generates assets. Poll get_environment until ready.',
    {},
  ],
  [
    'workbench_list_presets',
    'presets',
    'Discover actual character and action IDs. Search by ID or display name; never invent preset IDs.',
    { query: z.string().max(2000).optional() },
  ],
  [
    'workbench_list_tasks',
    'tasks',
    'Find recent workbench tasks and native SpritePipeline jobs, including work created in the web page. Native jobs use job_id, not workbench taskId.',
    {
      query: z.string().max(2000).optional(),
      capabilityId: z.string().optional(),
      status: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
  ],
  [
    'workbench_get_result',
    'result',
    'Read structured task results, characterId, candidate QA, suggested actions and verified artifact paths. Does not refresh or generate.',
    { taskId: z.string().min(1) },
  ],
  [
    'workbench_read_artifact',
    'artifact',
    'Read only a registered task artifact. Returns PNG image content for visual inspection. GIF preview is its first frame: inspect orderedFrames to assess motion before approval.',
    { taskId: z.string().min(1), artifactPath: z.string().min(1) },
  ],
];
for (const [name, operation, description, inputSchema] of discoveryTools) {
  server.registerTool(
    name,
    {
      description,
      inputSchema,
      annotations: {
        readOnlyHint: !['start', 'frontend'].includes(operation),
        destructiveHint: false,
        idempotentHint: operation !== 'interactable-template',
        openWorldHint: ['environment', 'presets', 'tasks'].includes(operation),
      },
    },
    async (input) => {
      try {
        const value = await agentRequest(
          await loadManifest(),
          operation,
          input,
        );
        if (value.imageBase64) {
          const { imageBase64, ...metadata } = value;
          const result = success(metadata);
          result.content.push({
            type: 'image',
            data: imageBase64,
            mimeType: 'image/png',
          });
          return result;
        }
        return success(value);
      } catch (error) {
        return failure(error);
      }
    },
  );
}

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
