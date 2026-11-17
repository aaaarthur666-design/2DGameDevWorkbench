import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { motionReviewProgress, motionStageReviewProgress } from '../../lib/workbench/motion-review-progress.mjs';
import { mcpContent, nativeTask, taskPresentation } from '../../lib/workbench/presentation.mjs';
import { refreshTask, runConnector } from '../../lib/workbench/runtime.mjs';

export async function verifyReviewProgress(manifest, capability) {
  const preparing = motionStageReviewProgress({ state: 'complete', review: null,
    review_protocol: 'experts_v1', candidate_index: 1, stage_index: 0 });
  assert.equal(preparing.state, 'running');
  assert.equal(preparing.active[0].phase, 'prepare');
  assert.equal(preparing.active[0].maxCalls, 5);
  const id = 'b'.repeat(32);
  const calls = (phases, inFlight = false) => phases.map((phase, index) => ({
    phase, state: inFlight && index === phases.length - 1 ? 'submitting' : 'complete',
    request_id: `original-review-${index + 1}`, started_at: '2026-11-17T12:00:00Z',
  }));
  const stage = { state: 'reviewing', review: { state: 'running', protocol: 'experts_v1',
    requests: calls(['observe', 'audit', 'expert_appearance'], true) } };
  const candidate = { candidate_index: 1, status: 'provider_pending', frames: [],
    plan_execution: { stages: [stage], quality_review: null } };
  const job = { job_id: 'review-progress-fixture', status: 'provider_pending', candidates: [candidate],
    request: { open_plan: { work_id: id, revision: 1, plan: { quality: { version: 3 } },
      spec: { review_protocol: 'experts_v1', budget: { max_review_calls: 20 } } } } };
  const work = { id, revision: 1, status: 'executing', job };
  const observed = [];
  const server = http.createServer((request, response) => {
    observed.push({ method: request.method, url: request.url });
    response.setHeader('content-type', 'application/json');
    if (request.method === 'GET' && request.url.startsWith(`/v1/open-motion/${id}`)) response.end(JSON.stringify(work));
    else if (request.url.endsWith('/frames/0/image')) {
      response.setHeader('content-type', 'image/png');
      response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8V8AAAAASUVORK5CYII=', 'base64'));
    } else { response.statusCode = 404; response.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const previous = process.env.SPRITE_PIPELINE_API_URL;
  process.env.SPRITE_PIPELINE_API_URL = `http://127.0.0.1:${server.address().port}`;
  const resultOf = async task => JSON.parse(await readFile(task.outputs.find(file => file.endsWith('/result.json')), 'utf8'));
  try {
    let outcome = await runConnector(manifest, capability, { operation: 'get-motion', openWorkId: id });
    const originalTaskId = outcome.task.id;
    assert.equal(outcome.task.status, 'running');
    let result = await resultOf(outcome.task);
    assert.deepEqual(result.nextActions, ['get-motion']);
    assert.equal(result.reviewProgress.active[0].currentCheck, '外观专家独立检查');
    assert.equal(result.reviewProgress.active[0].callsUsed, 3);
    assert.equal(result.reviewProgress.active[0].callsCompleted, 2);
    assert.equal(result.reviewProgress.active[0].currentCall.requestId, 'original-review-3');
    const presented = taskPresentation(manifest, outcome.task);
    assert.equal(presented.state, 'running');
    assert.match(presented.summary, /外观专家独立检查.*已完成 2 次.*3\/至多 5/);
    const text = JSON.parse(mcpContent('workbench_get_task', { task: outcome.task, presentation: presented }));
    assert.equal(text.presentation.reviewProgress.active[0].phase, 'expert_appearance');
    assert.deepEqual(text.presentation.reviewProgress.nextActions, ['get-motion']);
    assert.match(text.presentation.nextStep, /查询原任务/);

    stage.review.requests = calls(['observe', 'audit', 'expert_appearance', 'expert_motion', 'dispute'], true);
    outcome = await refreshTask(manifest, originalTaskId);
    assert.equal(outcome.task.id, originalTaskId);
    assert.equal(outcome.task.status, 'running');
    assert.equal(outcome.task.adapter.reviewProgress.active[0].callsUsed, 5);
    assert.equal(outcome.task.adapter.reviewProgress.active[0].callsCompleted, 4);
    stage.state = 'awaiting_review'; stage.review.state = 'complete';
    stage.review.verdict = 'pass'; stage.review.requests.at(-1).state = 'complete';
    outcome = await refreshTask(manifest, originalTaskId);
    assert.equal(outcome.task.status, 'attention_required');
    result = await resultOf(outcome.task);
    assert.deepEqual(result.nextActions, ['get-motion-stage', 'review-motion-stage']);
    assert.equal(result.reviewProgress.active[0].callsCompleted, 5);
    assert.match(taskPresentation(manifest, outcome.task).nextStep, /原 token/);
    assert.equal(motionStageReviewProgress({ ...stage, candidate_index: 1, stage_index: 0 }).state, 'awaiting_stage_review');

    stage.state = 'accepted'; stage.review_history = [{ requests: calls(['observe', 'audit']) }];
    job.status = 'review_required'; candidate.status = 'review_ready'; candidate.frames = [{ index: 0 }];
    candidate.plan_execution.quality_review = { state: 'running', protocol: 'experts_v1',
      requests: calls(['observe'], true) };
    // A native review_required status must stay running until the full audit ends.
    outcome = await runConnector(manifest, capability, { operation: 'get-motion', openWorkId: id });
    assert.equal(outcome.task.status, 'running');
    result = await resultOf(outcome.task);
    assert.deepEqual(result.nextActions, ['get-motion']);
    assert.equal(result.reviewProgress.budget.callsUsed, 8, 'previous review history remains in the budget');
    assert.equal(nativeTask(job).status, 'running');
    assert.equal(taskPresentation(manifest, nativeTask(job), { result: job }).state, 'running');
    candidate.plan_execution.quality_review.state = 'complete';
    candidate.plan_execution.quality_review.verdict = 'pass';
    candidate.plan_execution.quality_review.requests[0].state = 'complete';
    outcome = await refreshTask(manifest, outcome.task.id);
    assert.equal(outcome.task.status, 'attention_required');
    assert.equal(outcome.task.adapter.reviewProgress.state, 'awaiting_candidate_approval');
    result = await resultOf(outcome.task);
    assert.ok(result.nextActions.includes('approve'));
    assert.match(taskPresentation(manifest, outcome.task).nextStep, /采用结论/);
    const oldReport = candidate.plan_execution.quality_review;
    oldReport.state = 'unknown'; oldReport.requests[0].state = 'failed_or_unknown';
    assert.match(motionReviewProgress(job).nextStep, /原请求与已有意见已保留/);
    candidate.frames = []; candidate.plan_execution = null; candidate.status = 'failed';
    candidate.error = { code: 'provider_permanent_error', message: 'fixture balance rejected', details: { submission_created: false, http_status: 402 } };
    job.status = 'attention_required'; job.request.provider = 'pixellab';
    outcome = await runConnector(manifest, capability, { operation: 'get-motion', openWorkId: id });
    assert.equal(outcome.task.status, 'not_submitted');
    assert.equal(outcome.task.adapter.submissionState, 'not_submitted');
    assert.equal((await resultOf(outcome.task)).submission.httpStatus, 402);
    assert.equal(taskPresentation(manifest, outcome.task).state, 'not_submitted');
    candidate.error.details.submission_unknown = true;
    outcome = await runConnector(manifest, capability, { operation: 'get-motion', openWorkId: id });
    assert.equal(outcome.task.status, 'attention_required', 'an unknown provider request remains recoverable');
    candidate.status = 'created'; job.status = 'provider_pending';
    candidate.error = { code: 'provider_queued', message: 'fixture queued', details: { submission_created: false, queue_position: 2 } };
    outcome = await runConnector(manifest, capability, { operation: 'get-motion', openWorkId: id });
    assert.equal(outcome.task.status, 'running');
    assert.equal(outcome.task.adapter.submissionState, 'queued');
    assert.match(taskPresentation(manifest, outcome.task).summary, /第 2 位/);
    assert.ok(observed.every(request => request.method === 'GET'), 'polling never resubmits a review or approves a result');
  } finally {
    if (previous === undefined) delete process.env.SPRITE_PIPELINE_API_URL;
    else process.env.SPRITE_PIPELINE_API_URL = previous;
    await new Promise(resolve => server.close(resolve));
  }
}
