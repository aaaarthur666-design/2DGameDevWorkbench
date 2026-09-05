import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { persistTask } from '../runtime.mjs';

import {
  bearerHeaders,
  endpointUrl,
  requestBinary,
  requestJson,
} from './http.mjs';

const CREATE_OPERATIONS = new Set(['create', 'create-and-generate']);
const CANDIDATE_OPERATIONS = new Set([
  'export',
  'check',
  'review-frame',
  'approve',
  'reject',
  'recover',
  'attach-provider-job',
  'safety',
]);
const JOB_OPERATIONS = new Set([
  'generate-existing',
  'get',
  ...CANDIDATE_OPERATIONS,
]);
const SAFE_PRESET_ID = /^[a-z0-9][a-z0-9_]*$/;

export function validateSpritePipelineInput(input) {
  const errors = [];
  if (CREATE_OPERATIONS.has(input.operation)) {
    if (typeof input.characterId !== 'string' || !input.characterId) {
      errors.push('characterId is required for this operation.');
    } else if (!SAFE_PRESET_ID.test(input.characterId)) {
      errors.push(
        'characterId must contain only lowercase letters, digits, and underscores.',
      );
    }
    if (typeof input.actionId !== 'string' || !input.actionId) {
      errors.push('actionId is required for this operation.');
    } else if (!SAFE_PRESET_ID.test(input.actionId)) {
      errors.push(
        'actionId must contain only lowercase letters, digits, and underscores.',
      );
    }
  }
  if (
    JOB_OPERATIONS.has(input.operation) &&
    (typeof input.jobId !== 'string' || !input.jobId)
  ) {
    errors.push('jobId is required for this operation.');
  }
  if (
    CANDIDATE_OPERATIONS.has(input.operation) &&
    !Number.isInteger(input.candidateIndex)
  ) {
    errors.push('candidateIndex is required for this operation.');
  }
  if (
    input.operation === 'create-and-generate' &&
    input.provider === 'import'
  ) {
    errors.push('create-and-generate cannot use the import provider.');
  }
  if (input.operation === 'approve' && !input.reviewNote?.trim())
    errors.push(
      'reviewNote is required after visually inspecting the candidate.',
    );
  if (input.operation === 'attach-provider-job' && !input.providerJobId)
    errors.push('providerJobId is required.');
  if (input.operation === 'review-frame') {
    if (!Number.isInteger(input.frameIndex) || !input.reviewStatus)
      errors.push('frameIndex and reviewStatus are required.');
    if (input.reviewStatus === 'repair_requested' && !input.issueType)
      errors.push('issueType is required for repair_requested.');
  }
  return errors;
}

export function spritePipelineConfigured(connector) {
  return Boolean(process.env[connector.urlEnv] || connector.defaultUrl);
}

export async function executeSpritePipeline(context) {
  const { capability, input, task } = context;
  const connector = capability.connector;
  const baseUrl = process.env[connector.urlEnv] || connector.defaultUrl;
  if (!baseUrl) {
    return {
      status: 'awaiting_configuration',
      requiredEnvironment: connector.urlEnv,
      result: null,
    };
  }

  const token = connector.tokenEnv
    ? process.env[connector.tokenEnv]
    : undefined;
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
      task.adapter = {
        id: 'sprite-pipeline',
        remoteJobId: createdJob.job_id,
        remoteStatus: createdJob.status,
      };
      await persistTask(context.manifest, task);
      body = await requestJson(
        endpointUrl(
          baseUrl,
          `/v1/jobs/${encodeURIComponent(createdJob.job_id)}/generate`,
        ),
        {
          method: 'POST',
          headers,
          body: JSON.stringify(
            compact({
              wait: input.wait ?? false,
              candidate_index: input.candidateIndex,
            }),
          ),
          timeoutMs: input.wait ? 360_000 : 30_000,
        },
      );
    }
  } else if (input.operation === 'get') {
    body = await requestJson(
      endpointUrl(baseUrl, `/v1/jobs/${encodeURIComponent(input.jobId)}`),
      {
        method: 'GET',
        headers,
        timeoutMs: 15_000,
      },
    );
  } else if (input.operation === 'generate-existing') {
    body = await requestJson(
      endpointUrl(
        baseUrl,
        `/v1/jobs/${encodeURIComponent(input.jobId)}/generate`,
      ),
      {
        method: 'POST',
        headers,
        body: JSON.stringify(
          compact({
            wait: input.wait ?? false,
            candidate_index: input.candidateIndex,
          }),
        ),
        timeoutMs: input.wait ? 360_000 : 30_000,
      },
    );
  } else if (
    CANDIDATE_OPERATIONS.has(input.operation) &&
    input.operation !== 'export'
  ) {
    const operation =
      input.operation === 'review-frame' ? 'reviews/frame' : input.operation;
    const route = `/v1/jobs/${encodeURIComponent(input.jobId)}/candidates/${input.candidateIndex}/${operation}`;
    const payload =
      input.operation === 'approve'
        ? {
            reviewer: input.reviewer ?? 'agent',
            acknowledge_warnings: input.acknowledgeWarnings ?? false,
          }
        : input.operation === 'reject'
          ? {
              reviewer: input.reviewer ?? 'agent',
              note: input.reviewNote ?? '',
            }
          : input.operation === 'review-frame'
            ? compact({
                reviewer: input.reviewer ?? 'agent',
                note: input.reviewNote ?? '',
                frame_index: input.frameIndex,
                status: input.reviewStatus,
                issue_type: input.issueType,
              })
            : input.operation === 'attach-provider-job'
              ? { provider_job_id: input.providerJobId }
              : {};
    body = await requestJson(endpointUrl(baseUrl, route), {
      method: input.operation === 'safety' ? 'GET' : 'POST',
      headers,
      ...(input.operation === 'safety'
        ? {}
        : { body: JSON.stringify(payload) }),
      timeoutMs: 30_000,
    });
    if (input.operation === 'safety') {
      const safety = body.data?.safety;
      const jobResponse = await requestJson(
        endpointUrl(baseUrl, `/v1/jobs/${encodeURIComponent(input.jobId)}`),
        { headers, timeoutMs: 15_000 },
      );
      const job = readJob(jobResponse);
      const execution = await buildSpriteExecution(context, job, {
        baseUrl,
        token,
        status: remoteTaskStatus(job.status),
      });
      execution.result.safety = safety;
      return execution;
    }
  } else if (input.operation === 'export') {
    body = await requestJson(
      endpointUrl(
        baseUrl,
        `/v1/jobs/${encodeURIComponent(input.jobId)}/candidates/${input.candidateIndex}/export`,
      ),
      {
        method: 'POST',
        headers,
        body: JSON.stringify(
          compact({
            columns: input.columns,
            filename: input.filename,
            overwrite: input.overwrite ?? false,
          }),
        ),
        timeoutMs: 30_000,
      },
    );
  } else {
    throw new Error(`Unsupported SpritePipeline operation: ${input.operation}`);
  }

  const job = readJob(body);
  return buildSpriteExecution(context, job, {
    baseUrl,
    token,
    status: operationStatus(input.operation, job.status),
  });
}

export async function refreshSpritePipeline(context) {
  const { capability, task } = context;
  const remoteJobId = task.adapter?.remoteJobId;
  if (typeof remoteJobId !== 'string' || !remoteJobId) return null;

  const connector = capability.connector;
  const baseUrl = process.env[connector.urlEnv] || connector.defaultUrl;
  if (!baseUrl) {
    return {
      status: 'awaiting_configuration',
      requiredEnvironment: connector.urlEnv,
      result: null,
      adapter: task.adapter,
    };
  }
  const token = connector.tokenEnv
    ? process.env[connector.tokenEnv]
    : undefined;
  const body = await requestJson(
    endpointUrl(baseUrl, `/v1/jobs/${encodeURIComponent(remoteJobId)}`),
    {
      method: 'GET',
      headers: bearerHeaders(token),
      timeoutMs: 15_000,
    },
  );
  const job = readJob(body);
  return buildSpriteExecution(context, job, {
    baseUrl,
    token,
    status: remoteTaskStatus(job.status),
  });
}

function readJob(body) {
  const job = body?.data?.job ?? body?.job;
  if (!job || typeof job !== 'object' || typeof job.job_id !== 'string') {
    throw new Error('SpritePipeline response did not contain data.job.');
  }
  return job;
}

async function buildSpriteExecution(context, job, { baseUrl, token, status }) {
  const artifacts = await materializeSpriteArtifacts(
    context,
    job,
    baseUrl,
    token,
  );
  return {
    status,
    result: normalizeSpriteResult(job, artifacts),
    generatedOutputNames: artifacts.generatedOutputNames,
    adapter: {
      id: 'sprite-pipeline',
      remoteJobId: job.job_id,
      remoteStatus: job.status,
      endpoint: context.capability.connector.urlEnv,
    },
    ...(status === 'failed' ? { error: remoteJobError(job) } : {}),
  };
}

function normalizeSpriteResult(job, artifacts) {
  const candidates = Array.isArray(job.candidates) ? job.candidates : [];
  return {
    jobRecord: job,
    jobId: job.job_id,
    candidates: candidates.map((candidate) => ({
      candidateIndex: candidate.candidate_index,
      status: candidate.status,
      hardFailures: candidate.hard_failures ?? [],
      warnings: candidate.warnings ?? [],
      frames:
        candidate.frames?.map((frame) => ({
          index: frame.index,
          reviewStatus: frame.review_status,
          hardFailures: frame.hard_failures ?? [],
          warnings: frame.warnings ?? [],
        })) ?? [],
    })),
    nextActions:
      job.status === 'approved' || job.status === 'exported'
        ? ['export']
        : job.status === 'review_required'
          ? [
              'read-artifact',
              'safety',
              'check',
              'review-frame',
              'approve',
              'reject',
            ]
          : job.status === 'attention_required'
            ? ['safety', 'recover']
            : ['get'],
    orderedFrames: artifacts.orderedFrames,
    spriteSheet: artifacts.spriteSheet,
    preview: artifacts.preview,
    metadata: {
      jobId: job.job_id,
      status: job.status,
      revision: job.revision,
      candidateCount: candidates.length,
    },
  };
}

function operationStatus(operation, remoteStatus) {
  if (operation === 'create') return 'completed';
  return remoteTaskStatus(remoteStatus);
}

function remoteTaskStatus(remoteStatus) {
  if (remoteStatus === 'failed') return 'failed';
  if (
    remoteStatus === 'attention_required' ||
    remoteStatus === 'review_required'
  )
    return 'attention_required';
  if (remoteStatus === 'approved' || remoteStatus === 'exported')
    return 'completed';
  if (remoteStatus === 'created') return 'attention_required';
  return 'running';
}

async function materializeSpriteArtifacts(context, job, baseUrl, token) {
  const generatedOutputNames = [];
  const orderedFrames = [];
  const candidates = Array.isArray(job.candidates) ? job.candidates : [];
  for (const candidate of candidates) {
    if (
      !Number.isInteger(candidate.candidate_index) ||
      !Array.isArray(candidate.frames)
    )
      continue;
    const frames = candidate.frames
      .filter((frame) => Number.isInteger(frame.index))
      .slice()
      .sort((left, right) => left.index - right.index);
    for (const frame of frames) {
      const relativeName =
        `frames/candidate-${String(candidate.candidate_index).padStart(2, '0')}/` +
        `frame-${String(frame.index).padStart(3, '0')}.png`;
      await downloadSpriteArtifact(
        endpointUrl(
          baseUrl,
          `/v1/jobs/${encodeURIComponent(job.job_id)}/candidates/` +
            `${candidate.candidate_index}/frames/${frame.index}/image`,
        ),
        path.join(context.outputDirectory, relativeName),
        token,
        'image/png',
      );
      generatedOutputNames.push(relativeName);
      orderedFrames.push(
        projectPath(
          context.repositoryRoot,
          context.outputDirectory,
          relativeName,
        ),
      );
    }
  }

  let spriteSheet = null;
  let preview = null;
  if (job.export && typeof job.export === 'object') {
    await downloadSpriteArtifact(
      endpointUrl(
        baseUrl,
        `/v1/jobs/${encodeURIComponent(job.job_id)}/exports/sheet`,
      ),
      path.join(context.outputDirectory, 'sprite-sheet.png'),
      token,
      'image/png',
    );
    await downloadSpriteArtifact(
      endpointUrl(
        baseUrl,
        `/v1/jobs/${encodeURIComponent(job.job_id)}/exports/preview`,
      ),
      path.join(context.outputDirectory, 'preview.gif'),
      token,
      'image/gif',
    );
    generatedOutputNames.push('sprite-sheet.png', 'preview.gif');
    spriteSheet = projectPath(
      context.repositoryRoot,
      context.outputDirectory,
      'sprite-sheet.png',
    );
    preview = projectPath(
      context.repositoryRoot,
      context.outputDirectory,
      'preview.gif',
    );
  }

  return { generatedOutputNames, orderedFrames, spriteSheet, preview };
}

async function downloadSpriteArtifact(
  url,
  destination,
  token,
  expectedContentType,
) {
  const { buffer, contentType } = await requestBinary(url, {
    method: 'GET',
    headers: {
      accept: expectedContentType,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    timeoutMs: 30_000,
    maxBytes: 40 * 1024 * 1024,
  });
  if (
    contentType &&
    !contentType.toLowerCase().startsWith(expectedContentType)
  ) {
    throw new Error(
      `SpritePipeline artifact returned ${contentType}; expected ${expectedContentType}.`,
    );
  }
  if (
    expectedContentType === 'image/png' &&
    !hasPrefix(buffer, [137, 80, 78, 71, 13, 10, 26, 10])
  ) {
    throw new Error('SpritePipeline artifact was not a valid PNG.');
  }
  if (
    expectedContentType === 'image/gif' &&
    buffer.subarray(0, 6).toString('ascii') !== 'GIF87a' &&
    buffer.subarray(0, 6).toString('ascii') !== 'GIF89a'
  ) {
    throw new Error('SpritePipeline preview was not a valid GIF.');
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, buffer);
}

function projectPath(repositoryRoot, outputDirectory, relativeName) {
  return path
    .relative(repositoryRoot, path.join(outputDirectory, relativeName))
    .replaceAll('\\', '/');
}

function hasPrefix(buffer, values) {
  return values.every((value, index) => buffer[index] === value);
}

function remoteJobError(job) {
  const candidate = Array.isArray(job.candidates)
    ? job.candidates.find((item) => item?.error)
    : null;
  const error = job.error ?? candidate?.error;
  if (typeof error === 'string') return error;
  if (error?.message) return String(error.message);
  return 'SpritePipeline reported a failed job.';
}

function compact(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}
