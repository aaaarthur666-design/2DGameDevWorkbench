import path from 'node:path';
import process from 'node:process';

import { bearerHeaders, endpointUrl, requestJson } from './http.mjs';

const CREATE_OPERATIONS = new Set(['create', 'create-and-generate']);
const JOB_OPERATIONS = new Set(['generate-existing', 'get', 'export']);
const SAFE_PRESET_ID = /^[a-z0-9][a-z0-9_]*$/;

export function validateSpritePipelineInput(input) {
  const errors = [];
  if (CREATE_OPERATIONS.has(input.operation)) {
    if (typeof input.characterId !== 'string' || !input.characterId) {
      errors.push('characterId is required for this operation.');
    } else if (!SAFE_PRESET_ID.test(input.characterId)) {
      errors.push('characterId must contain only lowercase letters, digits, and underscores.');
    }
    if (typeof input.actionId !== 'string' || !input.actionId) {
      errors.push('actionId is required for this operation.');
    } else if (!SAFE_PRESET_ID.test(input.actionId)) {
      errors.push('actionId must contain only lowercase letters, digits, and underscores.');
    }
  }
  if (JOB_OPERATIONS.has(input.operation) && (typeof input.jobId !== 'string' || !input.jobId)) {
    errors.push('jobId is required for this operation.');
  }
  if (input.operation === 'export' && !Number.isInteger(input.candidateIndex)) {
    errors.push('candidateIndex is required for export.');
  }
  if (input.operation === 'create-and-generate' && input.provider === 'import') {
    errors.push('create-and-generate cannot use the import provider.');
  }
  return errors;
}

export function spritePipelineConfigured(connector) {
  return Boolean(process.env[connector.urlEnv] || connector.defaultUrl);
}

export async function executeSpritePipeline(context) {
  const { capability, input, task, repositoryRoot } = context;
  const connector = capability.connector;
  const baseUrl = process.env[connector.urlEnv] || connector.defaultUrl;
  if (!baseUrl) {
    return {
      status: 'awaiting_configuration',
      requiredEnvironment: connector.urlEnv,
      result: null,
    };
  }

  const token = connector.tokenEnv ? process.env[connector.tokenEnv] : undefined;
  const headers = bearerHeaders(token);
  let body;

  if (CREATE_OPERATIONS.has(input.operation)) {
    const requestBody = compact({
      schema_version: 1,
      character_id: input.characterId,
      action_id: input.actionId,
      provider: input.provider ?? 'pixellab',
      candidate_count: input.candidateCount ?? 1,
      seed: input.seed,
      frame_count: input.frameCount,
      action_description: input.actionDescription,
      loop: input.loop,
      request_key: input.requestKey ?? task.id,
    });
    body = await requestJson(endpointUrl(baseUrl, '/v1/jobs'), {
      method: 'POST',
      headers: {
        ...headers,
        'Idempotency-Key': requestBody.request_key,
      },
      body: JSON.stringify(requestBody),
      timeoutMs: 30_000,
    });

    if (input.operation === 'create-and-generate') {
      const createdJob = readJob(body);
      body = await requestJson(endpointUrl(baseUrl, `/v1/jobs/${encodeURIComponent(createdJob.job_id)}/generate`), {
        method: 'POST',
        headers,
        body: JSON.stringify(compact({
          wait: input.wait ?? false,
          candidate_index: input.candidateIndex,
        })),
        timeoutMs: input.wait ? 360_000 : 30_000,
      });
    }
  } else if (input.operation === 'get') {
    body = await requestJson(endpointUrl(baseUrl, `/v1/jobs/${encodeURIComponent(input.jobId)}`), {
      method: 'GET',
      headers,
      timeoutMs: 15_000,
    });
  } else if (input.operation === 'generate-existing') {
    body = await requestJson(endpointUrl(baseUrl, `/v1/jobs/${encodeURIComponent(input.jobId)}/generate`), {
      method: 'POST',
      headers,
      body: JSON.stringify(compact({
        wait: input.wait ?? false,
        candidate_index: input.candidateIndex,
      })),
      timeoutMs: input.wait ? 360_000 : 30_000,
    });
  } else if (input.operation === 'export') {
    body = await requestJson(
      endpointUrl(baseUrl, `/v1/jobs/${encodeURIComponent(input.jobId)}/candidates/${input.candidateIndex}/export`),
      {
        method: 'POST',
        headers,
        body: JSON.stringify(compact({
          columns: input.columns,
          filename: input.filename,
          overwrite: input.overwrite ?? false,
        })),
        timeoutMs: 30_000,
      },
    );
  } else {
    throw new Error(`Unsupported SpritePipeline operation: ${input.operation}`);
  }

  const job = readJob(body);
  const result = normalizeSpriteResult(job);
  const additionalOutputs = projectOutputs(result, repositoryRoot);
  return {
    status: operationStatus(input.operation, job.status),
    result,
    additionalOutputs,
    adapter: {
      id: 'sprite-pipeline',
      remoteJobId: job.job_id,
      remoteStatus: job.status,
      endpoint: connector.urlEnv,
    },
  };
}

function readJob(body) {
  const job = body?.data?.job ?? body?.job;
  if (!job || typeof job !== 'object' || typeof job.job_id !== 'string') {
    throw new Error('SpritePipeline response did not contain data.job.');
  }
  return job;
}

function normalizeSpriteResult(job) {
  const candidates = Array.isArray(job.candidates) ? job.candidates : [];
  const orderedFrames = candidates.flatMap((candidate) =>
    Array.isArray(candidate.frames)
      ? candidate.frames
          .slice()
          .sort((left, right) => Number(left.index) - Number(right.index))
          .map((frame) => frame.active_path)
          .filter((value) => typeof value === 'string')
      : [],
  );
  return {
    jobRecord: job,
    orderedFrames,
    spriteSheet: job.export?.sheet_path ?? null,
    preview: job.export?.preview_path ?? null,
    metadata: {
      jobId: job.job_id,
      status: job.status,
      revision: job.revision,
      candidateCount: candidates.length,
    },
  };
}

function operationStatus(operation, remoteStatus) {
  if (operation === 'create' || operation === 'get' || operation === 'export') return 'completed';
  if (remoteStatus === 'failed') return 'failed';
  if (remoteStatus === 'attention_required' || remoteStatus === 'review_required') return 'attention_required';
  if (remoteStatus === 'approved' || remoteStatus === 'exported') return 'completed';
  return 'running';
}

function projectOutputs(result, repositoryRoot) {
  const values = [...result.orderedFrames, result.spriteSheet, result.preview].filter(
    (value) => typeof value === 'string',
  );
  return values.flatMap((value) => {
    const resolved = path.isAbsolute(value)
      ? path.resolve(value)
      : path.resolve(repositoryRoot, value);
    const relative = path.relative(repositoryRoot, resolved);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
      ? [relative.replaceAll('\\', '/')]
      : [];
  });
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
