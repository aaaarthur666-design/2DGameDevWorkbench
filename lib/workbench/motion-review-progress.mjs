// Read-only projection of the persisted native review ledger. Reading it never
// starts another visual request or bypasses the actual-frame decision gates.
const CHECKS = {
  prepare: '准备实际帧与检查证据', observe: '按顺序观察全部实际帧',
  audit: '核对动作、外观与节奏合同', expert_appearance: '外观专家独立检查',
  expert_motion: '运动专家独立检查', dispute: '针对争议复核实际帧',
};
const RUNNING = new Set(['pending', 'running']);

function reviewEntry(report = {}, candidateIndex, stageIndex, state, protocol) {
  report ??= {};
  const requests = report.requests || [];
  const stored = report.progress || {};
  const current = requests.at(-1);
  const running = state === 'running';
  const expertPhase = { appearance: 'expert_appearance', motion: 'expert_motion', dispute: 'dispute' }[report.expert_review?.phase];
  const phase = running
    ? (current?.state === 'submitting' ? current.phase : stored.phase || expertPhase || current?.phase || 'prepare')
    : 'done';
  const after = stageIndex === undefined
    ? '读取完整实际帧并记录采用结论'
    : '读取本段实际帧，以原 token 确认或拒绝片段';
  const interrupted = ['failed', 'unknown', 'stale', 'unavailable'].includes(report.state);
  return {
    candidateIndex, scope: stageIndex === undefined ? 'candidate' : 'stage',
    ...(stageIndex === undefined ? {} : { stageIndex }),
    state, reportState: report.state || 'pending', phase,
    currentCheck: running ? CHECKS[phase] || stored.current_check || '检查实际帧'
      : interrupted ? '本次视觉检查未完成' : '视觉检查已结束',
    callsUsed: requests.length,
    callsCompleted: requests.filter(r => r.state === 'complete').length,
    maxCalls: stored.max_calls || (protocol === 'experts_v1' || report.protocol === 'experts_v1' ? 5 : 2),
    ...(running && current?.state === 'submitting' ? { currentCall: {
      number: requests.length, phase: current.phase, state: current.state,
      ...(current.request_id ? { requestId: current.request_id } : {}),
      ...(current.started_at ? { startedAt: current.started_at } : {}),
      ...(current.response_id ? { responseId: current.response_id } : {}),
    } } : {}),
    requiresAcknowledgement: !running && report.verdict !== 'pass',
    nextStep: running ? `继续查询原任务，检查结束后${after}。`
      : interrupted ? `原请求与已有意见已保留；${after}并明确处理提醒。` : `${after}。`,
  };
}

function summary(active, budget, pollingOperation) {
  if (!active.length) return null;
  const running = active.filter(item => item.state === 'running');
  const selected = running[0] || active[0];
  const state = running.length ? 'running' : selected.state;
  const scope = `候选 ${selected.candidateIndex} ${selected.scope === 'stage' ? `第 ${selected.stageIndex + 1} 段` : '完整动作'}`;
  return {
    state, active, ...(budget ? { budget } : {}),
    summary: `${scope}：${selected.currentCheck}；已完成 ${selected.callsCompleted} 次，已用 ${selected.callsUsed}/至多 ${selected.maxCalls} 次调用。`,
    nextActions: running.length ? [pollingOperation]
      : state === 'awaiting_stage_review' ? ['get-motion-stage', 'review-motion-stage']
      : state === 'awaiting_candidate_approval' ? ['read-artifact', 'safety', 'approve', 'reject'] : [pollingOperation],
    nextStep: selected.nextStep,
  };
}

export function motionStageReviewProgress(stage) {
  if (!stage || !['complete', 'reviewing', 'awaiting_review'].includes(stage.state)) return null;
  const state = ['complete', 'reviewing'].includes(stage.state) || RUNNING.has(stage.review?.state)
    ? 'running' : 'awaiting_stage_review';
  return summary([reviewEntry(stage.review, stage.candidate_index, stage.stage_index, state, stage.review_protocol)], null, 'get-motion');
}

export function motionReviewProgress(job, { candidateIndex } = {}) {
  if (!job || !Array.isArray(job.candidates)) return null;
  const active = [];
  let callsUsed = 0;
  const plan = job.request?.open_plan;
  for (const candidate of job.candidates) {
    const execution = candidate.plan_execution;
    const whole = candidate.quality_review || execution?.quality_review;
    callsUsed += (whole?.requests || []).length;
    for (const stage of execution?.stages || []) {
      callsUsed += (stage.review?.requests || []).length;
      callsUsed += (stage.review_history || []).reduce((sum, old) => sum + (old.requests || []).length, 0);
    }
    if (candidateIndex !== undefined && candidate.candidate_index !== candidateIndex) continue;
    if (['approved', 'rejected', 'exported'].includes(candidate.status)) continue;
    for (const [index, stage] of (execution?.stages || []).entries()) {
      const reviewable = stage.review || plan?.plan?.quality?.version >= 3;
      if (!reviewable || !['complete', 'reviewing', 'awaiting_review'].includes(stage.state)) continue;
      const state = ['complete', 'reviewing'].includes(stage.state) || RUNNING.has(stage.review?.state)
        ? 'running' : 'awaiting_stage_review';
      active.push(reviewEntry(stage.review, candidate.candidate_index, index, state, plan?.spec?.review_protocol));
    }
    if (whole && (RUNNING.has(whole.state) || candidate.frames?.length && candidate.status === 'review_ready')) {
      active.push(reviewEntry(whole, candidate.candidate_index, undefined,
        RUNNING.has(whole.state) ? 'running' : 'awaiting_candidate_approval', plan?.spec?.review_protocol));
    }
  }
  return summary(active, { callsUsed, maxCalls: plan?.spec?.budget?.max_review_calls ?? null }, plan ? 'get-motion' : 'get');
}
