import * as z from 'zod/v4';

const id = z.string().min(1).max(500);
export const previewInputs = {
  present: z.object({
    taskId: id.optional(),
    jobId: id.optional(),
    assetId: id.optional(),
    capabilityId: id.optional(),
    candidateIndex: z.number().int().min(1).max(1000).optional(),
  }).strict(),
  'frontend-context': z.object({ requestId: z.uuid().optional() }).strict(),
};

export const previewTools = [
  ['workbench_present', 'present', 'Show the current step in the existing frontend, without opening tabs or generating assets. Supply exactly one verified taskId, jobId, assetId or discovered capabilityId; optional candidateIndex selects an exact animation candidate. Call before starting work and at each selected artwork/step change. Arms automatic page following for subsequent run_task/get_task calls in this MCP connection. Pending is not displayed: check workbench_get_frontend_context with requestId. Paused/blocked pages must not be forced.'],
  ['workbench_get_frontend_context', 'frontend-context', 'Read connected frontend page summaries and presentation acknowledgement. Optional requestId checks a particular presentation. Reports current route, visible editor items and dirty/busy state; does not read canvas pixels, unsaved map contents, or browser storage. No page connection is not asset deletion. Read-only; no generation or navigation.'],
];
