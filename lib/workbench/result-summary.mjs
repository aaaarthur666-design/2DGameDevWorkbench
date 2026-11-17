import { createHash } from 'node:crypto';

const text = value => typeof value === 'string' ? value.slice(0, 300) : value;
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, text(value[key])]));
const notices = values => (values || []).slice(0, 2).map(value => String(typeof value === 'string' ? value : JSON.stringify(value)).slice(0, 160));

function progressSummary(progress) {
  if (!progress) return undefined;
  return { ...pick(progress, ['state', 'summary', 'nextStep']), budget: progress.budget,
    nextActions: progress.nextActions, activeCount: progress.active?.length || 0,
    active: (progress.active || []).slice(0, 2).map(item => ({
      ...pick(item, ['candidateIndex', 'scope', 'stageIndex', 'state', 'phase', 'currentCheck', 'callsUsed', 'callsCompleted', 'maxCalls']),
      ...(item.currentCall ? { currentCall: pick(item.currentCall, ['number', 'phase', 'state', 'requestId', 'startedAt', 'responseId']) } : {}),
    })),
  };
}

function stageSummary(stage, stageIndex) {
  return { stageIndex, ...pick(stage, ['state', 'token', 'revision', 'candidate_index', 'work_id', 'index']),
    ...(stage.review?.token && !stage.token ? { token: stage.review.token } : {}),
    ...(stage.review ? { review: pick(stage.review, ['state', 'verdict', 'calls_used']) } : {}),
  };
}

export function motionResultSummary(result, candidateIndex) {
  if (!result) return null;
  const job = result.jobRecord || result.work?.job || (result.job_id ? result : null);
  const work = result.work;
  const candidates = result.candidates || job?.candidates || [];
  return {
    ...pick(result, ['jobId', 'openWorkId', 'remoteStatus', 'adjustmentId', 'spriteSheet', 'preview', 'godotPackage']),
    ...(result.submission ? { submission: pick(result.submission, ['status', 'message', 'reason', 'queuePosition']) } : {}),
    ...(job ? { jobId: job.job_id, remoteStatus: job.status } : {}),
    ...(job?.request?.open_plan ? { openWorkId: job.request.open_plan.work_id,
      work: { id: job.request.open_plan.work_id, revision: job.request.open_plan.revision, plan_sha256: job.request.open_plan.plan_sha256 } } : {}),
    ...(work ? { openWorkId: work.id, work: pick(work, ['id', 'revision', 'status', 'message', 'plan_sha256', 'target_set_sha256']) } : {}),
    ...(work?.plan ? { plan: { ...pick(work.plan, ['title', 'summary']), questions: work.plan.questions, stages: (work.plan.stages || []).map(stage => pick(stage, ['name', 'frame_count'])) } } : {}),
    nextActions: (result.nextActions || []).slice(0, 8),
    candidateCount: candidates.length,
    candidateIndices: candidates.map(c => c.candidateIndex ?? c.candidate_index),
    omittedCandidateCount: candidateIndex === undefined ? Math.max(0, candidates.length - 2) : 0,
    candidates: candidates.filter(c => candidateIndex === undefined || (c.candidateIndex ?? c.candidate_index) === candidateIndex).slice(0, 2).map(c => {
      const index = c.candidateIndex ?? c.candidate_index;
      const source = job?.candidates?.find(item => item.candidate_index === index) || c;
      const hardFailures = c.hardFailures || c.hard_failures || [];
      return { candidateIndex: index, status: c.status, frameCount: c.frames?.length || 0,
        hardFailures: notices(hardFailures), hardFailureCount: hardFailures.length,
        warnings: notices(c.warnings), warningCount: (c.warnings || []).length,
        stages: (source.plan_execution?.stages || []).map(stageSummary),
      };
    }),
    ...(result.stage ? { stage: stageSummary(result.stage, result.stage.stage_index ?? result.stage.index) } : {}),
    ...(result.repairPreviews ? { repairPreviews: result.repairPreviews.slice(0, 2).map(repair => ({
      ...pick(repair, ['attempt', 'token']), frameCount: repair.frames?.length || 0, framePreviews: repair.frames?.slice(0, 2) || [],
    })) } : {}),
    ...(result.adjustmentContext ? { adjustmentContext: {
      ...pick(result.adjustmentContext, ['token', 'fps', 'width', 'height', 'editable_stage_end', 'attempt_scope', 'attempt_limit', 'appearance_max']),
      locked_frames: result.adjustmentContext.locked_frames, frame_attempts: result.adjustmentContext.frame_attempts,
      budget: result.adjustmentContext.budget, frameCount: result.adjustmentContext.frames?.length || 0,
    } } : {}),
    ...(result.adjustment ? { adjustment: pick(result.adjustment, ['id', 'work_id', 'revision', 'candidate', 'stage', 'state', 'source_token', 'preview_token', 'start', 'end', 'fps', 'loop', 'message']) } : {}),
    ...(result.pendingCheckpoints ? { pendingCheckpoints: result.pendingCheckpoints.slice(0, 32) } : {}),
    ...(result.reviewProgress ? { reviewProgress: progressSummary(result.reviewProgress) } : {}),
    ...(result.safety ? { safety: {
      ...pick(result.safety, ['stage', 'local_task_saved', 'automatic_resubmission_allowed', 'submission_attempts', 'provider_job_id', 'result_integrity', 'message']),
      ...(result.safety.error ? { error: typeof result.safety.error === 'string' ? text(result.safety.error) : pick(result.safety.error, ['code', 'message']) } : {}),
    } } : {}),
    orderedFrameCount: result.orderedFrames?.length || 0,
    framePreviews: Object.fromEntries([['ordered', result.orderedFrames], ['original', result.originalFrames], ['alternative', result.alternativeFrames]]
      .filter(([, frames]) => frames?.length).map(([kind, frames]) => [kind, { count: frames.length, paths: frames.slice(0, 2) }])),
  };
}

// Full evidence remains unchanged on disk. JSON slices have an explicit offset
// and content hash so readers cannot accidentally combine two async snapshots.
export function resultDetailPage(result, artifacts, { offset = 0, limit = 6000, snapshot } = {}) {
  const serialized = JSON.stringify({ result, artifacts });
  const sha256 = createHash('sha256').update(serialized).digest('hex');
  if (offset > 0 && !snapshot) throw new Error('A detail page after offset 0 requires the snapshot returned by the first page.');
  if (snapshot && snapshot !== sha256) throw new Error('Result changed while reading detail pages. Restart at offset 0.');
  if (offset > serialized.length) throw new Error('Detail offset exceeds the result length.');
  const end = Math.min(offset + limit, serialized.length);
  return { encoding: 'json', offsetUnit: 'utf16-code-units', offset, totalCharacters: serialized.length,
    snapshot: sha256, nextOffset: end < serialized.length ? end : null, text: serialized.slice(offset, end) };
}

export function compactMotionResponse(value, options) {
  const { result, artifacts, presentation, ...metadata } = value;
  const { reviewProgress, ...display } = presentation;
  const summary = motionResultSummary(result, options.candidateIndex);
  if (summary && reviewProgress) {
    summary.reviewProgress = progressSummary(reviewProgress);
    summary.nextActions = reviewProgress.nextActions;
  }
  return { ...metadata, ...(metadata.error ? { error: text(metadata.error) } : {}), compactResult: true,
    result: summary,
    presentation: { ...display, ...(display.issue ? { issue: { summary: text(display.issue.summary) } } : {}) },
    artifactCount: artifacts.length,
    details: 'At most 2 candidates and 2 notices per category are shown; use candidateIndex for another candidate. Use detail:true with offset/limit for full JSON slices. Concatenate detailPage.text in order; pass its snapshot on subsequent pages.',
    ...(options.detail ? { detailPage: resultDetailPage(result, artifacts, options) } : {}),
  };
}
