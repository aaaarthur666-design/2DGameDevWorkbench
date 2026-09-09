#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import { assetInputs, assetTools } from '../lib/workbench/asset-contract.mjs';
import { mcpContent } from '../lib/workbench/presentation.mjs';
import { previewInputs, previewTools } from '../lib/workbench/preview-follow-contract.mjs';
import { queuePresentation } from '../lib/workbench/preview-follow.mjs';
import { KINDS } from '../features/interactable-editor/contract.mjs';

import {
  repositoryRoot,
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

import {gameExportInputs,gameExportTools} from '../lib/workbench/game-export-contract.mjs';

const server = new McpServer(
  {
    name: '2d-game-workbench',
    version: '0.10.0',
  },
  {
    instructions:
      'Game integration: check workbench_list_game_exports for pending deliveries when continuing an authorized game task. Use get_game_export to inspect the exact package and selected target, read agentAssets.engineering.skill, install_game_export for verified file placement, then use host file tools to complete mounts, clip merges and gameplay signal wiring according to the actual project. Record real file and engine evidence with complete_game_export. A waiting delivery never means the host Agent was automatically started. Preserve user-modified files, other animation clips, existing controllers and project.godot. Map/scene production remains manual; consuming an existing export is permitted. WorkBuddy session startup: on the first user message after connecting this server, unless the user opts out of opening the UI, call workbench_get_environment. If frontend.ready is false, call workbench_start_frontend once when services are offline, then poll get_environment at bounded intervals (up to 60 seconds); stop on blocked/conflict/unreachable and report the reason. When ready, prefer a known selected artwork presentation.viewUrl over the homepage. Discover the host-native present_files tool (possibly connector-proxy namespaced), inspect its schema, and use frontend.hostAction.arguments, replacing files with the verified presentation.viewUrl when continuing known work, to open the exact frontend page in the WorkBuddy internal preview. Reuse an existing workbench preview and do not reopen it on each message, reconnect, or if the user closes it in this conversation. This is a first-conversation Agent workflow, not a handshake browser side effect. Only the host tool can confirm that the page opened; if unavailable, report that limitation and show the URL. Never open the OS default browser as a substitute. Do not apply WorkBuddy browser startup to other MCP clients or diagnostic clients. Continue the original user request after this local setup; it authorizes no generation or provider charges. For vague production requests, follow conversationGuidance returned by list_capabilities: inspect context and existing assets before asking, use the host-native AskUserQuestion only if currently available after inspecting its schema, otherwise ask concisely in chat. Do not create placeholder tasks while clarifying or mistake unanswered questions for consent. Map stitching and map generation are manual frontend workflows and cannot be prepared or run through MCP. For interactables, get a template without creating a task, edit its project, save-project for frontend continuation, then export-godot when requested. This server exposes the capabilities of the current 2D game workbench project. List capabilities before selecting one, then inspect its schema. Use prepare_task only for explicitly requested input validation. Resolve authorization before external execution; planning or clarification creates no task. Call run_task only when execution is authorized. get_task safely refreshes running adapter jobs before returning their persisted state. An awaiting_configuration task is not complete. Never invent outputs, and keep exact task IDs and paths in structured details; normal replies lead with the outcome and exact artwork link, without dumping JSON or IDs. Use get_environment and start_services for local readiness, list_presets for real IDs, list_tasks for earlier work, and get_result/read_artifact to inspect actual outputs. Review candidate frames before approve, recording visual evidence in reviewNote; check/approve/export are separate operations. Asset inventory: use list_assets for actual artwork, not list_tasks; filter candidateCount and candidateIndex and sortBy createdAt for the latest multi-candidate generation. Follow pagination to avoid missing old work. get_asset verifies the selected files; get_asset_manifest produces a handoff without modifying sources. Browser-only drafts are outside the server inventory; incomplete coverage is not proof an asset is gone. Presentation: before the first execution step call workbench_present with the discovered capabilityId or exact selected task/job/asset identity to arm page following for this MCP connection. Subsequent run_task/get_task responses automatically publish their current step; call workbench_present again when intentionally selecting another artwork or candidate through read-only result/asset tools. Check workbench_get_frontend_context with requestId to confirm displayed, never infer display from queued/pending or a returned URL. Follow the original task across generation, review, save and export with a short stage update; do not wait until the final answer to show the result. Repeated same-step polling must not reload the page. Respect paused/blocked states and never force host navigation around them. This channel navigates the existing frontend, it does not open a browser; the host-native present_files is only for the first preview. Context includes page identity and editing state, not map pixels or draft contents. Presentation: prefer presentation.summary and viewUrl. Reply with a short outcome, preview/link and one next step; show technical details only when asked or necessary for troubleshooting. Navigate an existing host preview only when supported and editing is safely saved; otherwise offer the exact link. A returned URL or browserOpened:false never proves the browser opened. Do not reopen a dismissed preview. AskUserQuestion is host-owned: discover it and read its schema, ask one material choice at a time, and never treat cancellation as consent. For ambiguous generation failures inspect the saved remoteJobId and recover the original job instead of resubmitting.',
  },
);

function success(value, name) {
  return {
    content: [{ type: 'text', text: mcpContent(name, value) }],
    structuredContent: value,
  };
}

function failure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: message.match(/^Task ([a-z0-9_-]+) failed:/i)
          ? JSON.stringify({
              summary:
                '本次操作未完成。请读取原任务的错误和已有结果，避免重复生成。',
              taskId: message.match(/^Task ([a-z0-9_-]+) failed:/i)[1],
              nextTool: 'workbench_get_result',
            })
          : message,
      },
    ],
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

let following = false;
async function followResult(value) {
  if (!following || !value.presentation?.viewPath) return value;
  try {
    return { ...value, frontendPresentation: await queuePresentation(repositoryRoot, await loadManifest(), { ...value.presentation, viewPath: value.presentation.actions?.[0]?.viewPath || value.presentation.viewPath }) };
  } catch {
    // Presentation failures never turn an already-submitted production operation into a retry.
    return { ...value, frontendPresentation: { state: 'unavailable', displayed: false, browserOpened: false } };
  }
}
function registerTool(name, options, handler) {
  server.registerTool(name, options, async (input) => {
    try {
      let value = await handler(input);
      if (['workbench_run_task', 'workbench_get_task'].includes(name)) value = await followResult(value);
      return success(value, name);
    } catch (error) {
      const response = failure(error);
      const taskId = response.structuredContent.error.taskId;
      if (following && taskId && name === 'workbench_run_task') {
        try {
          const failed = await followResult(await agentRequest(await loadManifest(), 'result', { taskId }));
          response.structuredContent.frontendPresentation = failed.frontendPresentation;
          response.content.push({ type: 'text', text: JSON.stringify({ frontendPresentation: failed.frontendPresentation }) });
        } catch { /* The original operation error is authoritative. */ }
      }
      return response;
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
    const execution = await prepareTask(manifest, capability, input);
    return {
      ...summarizeTask(execution),
      presentation: (
        await agentRequest(manifest, 'result', { taskId: execution.task.id })
      ).presentation,
    };
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
    const execution = await runConnector(manifest, capability, input);
    return {
      ...summarizeTask(execution),
      presentation: (
        await agentRequest(manifest, 'result', { taskId: execution.task.id })
      ).presentation,
    };
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
      presentation: (await agentRequest(manifest, 'result', { taskId }))
        .presentation,
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
    {
      kind: z.enum(KINDS).optional(),
      name: z.string().min(1).max(200).optional(),
    },
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
    'Search all unarchived workbench tasks and native SpritePipeline jobs before pagination. Follow nextOffset with snapshot for older history. Native jobs use job_id, not workbench taskId. Archiving history does not remove assets.',
    {
      query: z.string().max(2000).optional(),
      capabilityId: z.string().optional(),
      status: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
      snapshot: z.string().max(2000).optional(),
    },
  ],
  [
    'workbench_get_result',
    'result',
    'Read a workbench taskId OR a native sprite jobId (exactly one). Optional candidateIndex selects an existing candidate. Returns a concise presentation and exact viewUrl plus structured results. Does not refresh, generate, create tasks or open a browser.',
    {
      taskId: z.string().min(1).optional(),
      jobId: z.string().min(1).max(200).optional(),
      candidateIndex: z.number().int().min(1).max(1000).optional(),
      detail: z
        .boolean()
        .optional()
        .describe(
          'Return full technical JSON in text content for clients without structuredContent; use for frame review or debugging.',
        ),
    },
  ],
  [
    'workbench_read_artifact',
    'artifact',
    'Read only a registered task artifact. Returns PNG image content for visual inspection. GIF preview is its first frame: inspect orderedFrames to assess motion before approval.',
    { taskId: z.string().min(1), artifactPath: z.string().min(1) },
  ],
];
for (const [name,operation,description] of gameExportTools) {
  registerTool(name,{description,inputSchema:gameExportInputs[operation].shape,annotations:{readOnlyHint:['game-exports','game-export'].includes(operation),destructiveHint:false,idempotentHint:true,openWorldHint:false}},async input=>agentRequest(await loadManifest(),operation,input));
}
for (const [name, operation, description] of previewTools) {
  registerTool(name, {
    description, inputSchema: previewInputs[operation].shape,
    annotations: { readOnlyHint: operation !== 'present', destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    const result = await agentRequest(await loadManifest(), operation, input);
    if (operation === 'present') following = true;
    return result;
  });
}
for (const [name, operation, description] of assetTools) {
  registerTool(
    name,
    {
      description,
      inputSchema: assetInputs[operation].shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => agentRequest(await loadManifest(), operation, input),
  );
}

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
          const result = success(metadata, name);
          result.content.push({
            type: 'image',
            data: imageBase64,
            mimeType: 'image/png',
          });
          return result;
        }
        return success(value, name);
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
