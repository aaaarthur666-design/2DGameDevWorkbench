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
const MOTION_OPERATIONS = new Set(['plan-motion', 'revise-motion', 'get-motion', 'generate-motion', 'pause-motion', 'resume-motion', 'get-motion-stage', 'review-motion-stage', 'target-motion-stage', 'repair-motion-stage', 'review-motion-repair']);

export function validateSpritePipelineInput(input) {
  const errors = [];
  if (MOTION_OPERATIONS.has(input.operation)) {
    if (input.operation !== 'plan-motion' && !/^[0-9a-f]{32}$/.test(input.openWorkId || '')) errors.push('openWorkId is required.');
    if (!['plan-motion', 'get-motion', 'get-motion-stage'].includes(input.operation) && !Number.isInteger(input.expectedRevision)) errors.push('expectedRevision is required.');
    if (['get-motion-stage','review-motion-stage','repair-motion-stage','review-motion-repair'].includes(input.operation)) {
      if (!Number.isInteger(input.stageIndex) || input.stageIndex < 0 || input.stageIndex > 3 || !Number.isInteger(input.candidateIndex)) errors.push('A valid stageIndex and candidateIndex are required.');
      if (input.operation === 'review-motion-stage' && (!/^[0-9a-f]{64}$/.test(input.stageToken || '') || !['accept','reject'].includes(input.stageDecision) || (input.reviewNote?.trim().length || 0) < 4)) errors.push('Exact stageToken, decision and actual visual reviewNote are required.');
    }
    if (['plan-motion', 'revise-motion'].includes(input.operation)) {
      if (!input.motionSpec) errors.push('motionSpec is required.');
      if (input.planningAuthorized !== true) errors.push('Planning model calls require explicit user authorization.');
    }
    if (input.operation === 'generate-motion' && !/^[0-9a-f]{64}$/.test(input.planSha256 || '')) errors.push('planSha256 from the current proposal is required.');
    if (input.operation === 'target-motion-stage' && (!Number.isInteger(input.stageIndex) || input.stageIndex<0 || input.stageIndex>3 || (input.reviewNote?.trim().length||0)<4 || (!input.targetImageBase64 && input.clearTarget!==true))) errors.push('Target stage, inspected PNG (or explicit clearTarget), and reviewNote are required.');
    if (input.operation === 'repair-motion-stage' && (input.generationAuthorized!==true || !Number.isInteger(input.repairStart) || !Number.isInteger(input.repairEnd) || !['appearance','transition'].includes(input.repairMode) || !/^[0-9a-f]{64}$/.test(input.stageToken||'') || (input.reviewNote?.trim().length||0)<4)) errors.push('Authorized repair requires exact evidence token, window, mode and actual defect note.');
    if (input.operation === 'review-motion-repair' && (!Number.isInteger(input.repairAttempt)||!/^[0-9a-f]{64}$/.test(input.stageToken||'')||!['accept','reject'].includes(input.stageDecision)||(input.reviewNote?.trim().length||0)<4)) errors.push('Repair review requires attempt, preview token, decision and actual visual note.');
    return errors;
  }
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
  if (MOTION_OPERATIONS.has(input.operation)) return executeOpenMotion(context, baseUrl, headers);
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
            review_note: input.reviewNote ?? '',
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
  if (task.adapter?.openWorkId) {
    const connector = capability.connector;
    const base = process.env[connector.urlEnv] || connector.defaultUrl;
    const token = connector.tokenEnv ? process.env[connector.tokenEnv] : undefined;
    const target = new URL(endpointUrl(base, `/v1/open-motion/${task.adapter.openWorkId}`));
    if (task.adapter.openWorkRevision) target.searchParams.set('revision', String(task.adapter.openWorkRevision));
    const work = await requestJson(target, { headers: bearerHeaders(token), timeoutMs: 15_000 });
    return buildOpenExecution(context, work, base, token);
  }
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

async function executeOpenMotion(context, baseUrl, headers) {
  const { input, task } = context;
  if (input.operation === 'get-motion-stage') {
    const route = `/v1/open-motion/${input.openWorkId}/candidates/${input.candidateIndex}/stages/${input.stageIndex}`;
    const stage = await requestJson(endpointUrl(baseUrl,route),{headers,timeoutMs:15_000});
    const token = context.capability.connector.tokenEnv ? process.env[context.capability.connector.tokenEnv] : undefined;
    const generatedOutputNames=[], orderedFrames=[];
    for (let i=0;i<stage.frames.length;i++) {
      const name=`checkpoint/frame-${String(i).padStart(3,'0')}.png`;
      await downloadSpriteArtifact(endpointUrl(baseUrl,`${route}/frames/${i}`),path.join(context.outputDirectory,name),token,'image/png');
      generatedOutputNames.push(name);orderedFrames.push(projectPath(context.repositoryRoot,context.outputDirectory,name));
    }
    const repairPreviews=[];
    for(const repair of stage.repairs||[]) if(repair.proposed_frames){
      const frames=[];
      for(let i=0;i<repair.proposed_frames.length;i++){
        const name=`checkpoint/repair-${repair.number}/frame-${String(i).padStart(3,'0')}.png`;
        await downloadSpriteArtifact(endpointUrl(baseUrl,`${route}/repairs/${repair.number}/frames/${i}`),path.join(context.outputDirectory,name),token,'image/png');
        generatedOutputNames.push(name);frames.push(projectPath(context.repositoryRoot,context.outputDirectory,name));
      }
      repairPreviews.push({attempt:repair.number,token:repair.token,frames});
    }
    return {status:'completed',result:{openWorkId:input.openWorkId,stage,orderedFrames,repairPreviews,nextActions:['review-motion-stage','repair-motion-stage','review-motion-repair'],viewPath:`/tools/sprite-generator?work=${input.openWorkId}&candidate=${input.candidateIndex}`},generatedOutputNames};
  }
  let route = '/v1/open-motion';
  if (input.operation !== 'plan-motion') route += `/${input.openWorkId}`;
  const suffix = { 'revise-motion': 'revise', 'generate-motion': 'generate', 'pause-motion': 'pause', 'resume-motion': 'resume', 'review-motion-stage':'review-stage', 'target-motion-stage':'target', 'repair-motion-stage':'repair-stage', 'review-motion-repair':'review-repair' }[input.operation];
  if (suffix) route += `/${suffix}`;
  const payload = input.operation === 'get-motion' ? null :
    ['plan-motion', 'revise-motion'].includes(input.operation) ? compact({
      spec: input.motionSpec, request_key: input.requestKey || task.id,
      planning_authorized: input.planningAuthorized === true, auto_execute: input.autoExecute ?? false,
      expected_revision: input.operation === 'revise-motion' ? input.expectedRevision : undefined,
    }) : input.operation === 'repair-motion-stage' ? {
      expected_revision:input.expectedRevision,candidate_index:input.candidateIndex,stage_index:input.stageIndex,token:input.stageToken,
      start:input.repairStart,end:input.repairEnd,mode:input.repairMode,note:input.reviewNote,request_key:input.requestKey||task.id,generation_authorized:input.generationAuthorized===true,
    } : input.operation === 'review-motion-repair' ? {
      expected_revision:input.expectedRevision,candidate_index:input.candidateIndex,stage_index:input.stageIndex,attempt:input.repairAttempt,token:input.stageToken,note:input.reviewNote,decision:input.stageDecision,
    } : input.operation === 'target-motion-stage' ? {
      expected_revision:input.expectedRevision,stage_index:input.stageIndex,png_base64:input.clearTarget?null:input.targetImageBase64,note:input.reviewNote,
    } : input.operation === 'review-motion-stage' ? {
      expected_revision:input.expectedRevision,candidate_index:input.candidateIndex,stage_index:input.stageIndex,
      token:input.stageToken,decision:input.stageDecision,note:input.reviewNote,acknowledge_warnings:input.acknowledgeWarnings ?? false,
      anchor_frame:input.anchorFrame ?? null,acknowledge_trim:input.acknowledgeTrim ?? false,
    } : compact({ expected_revision: input.expectedRevision, plan_sha256: input.operation === 'generate-motion' ? input.planSha256 : undefined });
  const work = await requestJson(endpointUrl(baseUrl, route), {
    method: payload ? 'POST' : 'GET', headers, ...(payload ? { body: JSON.stringify(payload) } : {}), timeoutMs: 30_000,
  });
  const token = context.capability.connector.tokenEnv ? process.env[context.capability.connector.tokenEnv] : undefined;
  return buildOpenExecution(context, work, baseUrl, token);
}

async function buildOpenExecution(context, work, baseUrl, token) {
  if (!/^[0-9a-f]{32}$/.test(work?.id || '')) throw new Error('Invalid open-motion response.');
  const status = work.job ? remoteTaskStatus(work.job.status) : work.status === 'planning' ? 'running' : 'attention_required';
  const execution = work.job ? await buildSpriteExecution(context, work.job, { baseUrl, token, status }) : { status, result: {}, generatedOutputNames: [] };
  execution.result = { ...execution.result, openWorkId: work.id, work, nextActions: work.job ? execution.result.nextActions : work.status === 'ready' ? ['generate-motion', 'revise-motion'] : work.status === 'planning' ? ['get-motion'] : ['revise-motion'] };
  execution.adapter = { ...execution.adapter, id: 'sprite-pipeline', openWorkId: work.id, openWorkRevision: work.revision, remoteStatus: work.job?.status || work.status };
  const checkpoints=(work.job?.candidates || []).flatMap(c=>(c.plan_execution?.stages || []).flatMap((s,i)=>s.state==='awaiting_review'?[{candidateIndex:c.candidate_index,stageIndex:i}]:[]));
  if (checkpoints.length) {
    execution.status='attention_required'; execution.result.pendingCheckpoints=checkpoints;
    execution.result.nextActions=['get-motion-stage','review-motion-stage'];
  }
  return execution;
}

function readJob(body) {
  const job = body?.data?.job ?? body?.job;
  if (!job || typeof job !== 'object' || typeof job.job_id !== 'string') {
    throw new Error('SpritePipeline response did not contain data.job.');
  }
  return job;
}

async function buildSpriteExecution(context, job, { baseUrl, token, status }) {
  if (job.request?.open_plan && job.candidates?.some(c => !c.frames?.length &&
      (['submitting','provider_pending','saving'].includes(c.status) || (job.plan_control?.enabled && c.status === 'created')))) status = 'running';
  if (context.input.operation !== 'create' && ['waiting', 'checking', 'repairing'].includes(job.motion_control?.state)) status = 'running';
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
    motionControl: job.motion_control ?? null,
    nextActions:
      ['waiting', 'checking', 'repairing'].includes(job.motion_control?.state) ? ['get'] :
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
    godotPackage: artifacts.godotPackage,
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
  let godotPackage = null;
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
    if (job.export.godot_package_path) {
      await downloadSpriteArtifact(
        endpointUrl(baseUrl, `/v1/jobs/${encodeURIComponent(job.job_id)}/exports/godot`),
        path.join(context.outputDirectory, 'sprite-frames.godot.zip'),
        token,
        'application/zip',
      );
      generatedOutputNames.push('sprite-frames.godot.zip');
      godotPackage = projectPath(context.repositoryRoot, context.outputDirectory, 'sprite-frames.godot.zip');
    }
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

  return { generatedOutputNames, orderedFrames, spriteSheet, preview, godotPackage };
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
  if (expectedContentType === 'application/zip' && !hasPrefix(buffer, [80, 75, 3, 4])) {
    throw new Error('SpritePipeline Godot package was not a ZIP.');
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
