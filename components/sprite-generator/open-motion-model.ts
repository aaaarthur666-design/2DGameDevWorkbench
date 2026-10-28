export type MotionSpec = {
  character_id: string;
  description: string;
  ending: string;
  return_to_reference: boolean;
  loop: boolean;
  fps: number;
  timing_mode?: 'auto' | 'fixed';
  candidate_count: number;
  budget: {
    max_planning_calls: number;
    max_generation_calls: number;
    max_review_calls?: number;
  };
  provider: 'pixellab' | 'fixture';
  review_protocol?: 'baseline' | 'experts_v1';
  seed?: number | null;
  visual_structure?: { analysis_id: string; token: string } | null;
};
export type MotionStage = {
  name: string;
  goal: string;
  prompt: string;
  frame_count: number;
  first_frame: string;
  last_frame: string;
  acceptance: string[];
  structure_usage?: {part_ids:string[];anchor_ids:string[];relation_ids:string[];effect:string};
  checkpoint?: { endpoint: string; rhythm: string; reason: string };
  motion?: {camera:string;orientation:string;trajectory:string;support:string;drive:string;appearance:string;entry:string;exit:string;boundary:string;holds:{start:number;end:number;reason:string}[]};
};
export type MotionPlan = {
  quality?: {
    version: number;
    event_contract: string;
    appearance_contract: string;
    ending_contract: string;
    rhythm_contract: string;
    playback_fps: number;
    key_poses?: { frame: number; description: string }[];
  };
  title: string;
  summary: string;
  animation_name: string;
  stages: MotionStage[];
  requirements: { text: string; source: string; evidence: string }[];
  questions: string[];
};
export type MotionFrame = {
  index: number;
  sha256: string;
  active_path: string;
  review_status: string;
};
export type MotionReviewCheck = {
  dimension: 'completeness' | 'equipment' | 'rhythm';
  frames: number[];
  evidence: string;
  status?: 'pass' | 'fail' | 'uncertain';
  confidence?: number;
};
export type MotionReviewOpinion = { summary?: string; checks?: MotionReviewCheck[] };
export type MotionReview = MotionReviewOpinion & {
    state: string;
    verdict: 'pass' | 'fail' | 'uncertain';
    protocol?: 'experts_v1';
    requests?: {phase: string; state: string}[];
    expert_review?: {
      state: string; phase?: string; summary?: string; calls_used?: number; max_calls?: number; simulated?: boolean;
      baseline?: MotionReviewOpinion;
      experts?: Record<string, MotionReviewOpinion>;
      resolution?: {summary?: string; checks?: (MotionReviewCheck & {classification: string; observation?: string; prior_claim_correction?: string})[]};
      requires_human_adjudication?: {dimension: string; reason: string}[];
    };
};
export type MotionCandidate = {
  quality_review?: MotionReview;
  candidate_index: number;
  status: string;
  frames: MotionFrame[];
  review_token: string;
  hard_failures: { message: string }[];
  warnings: { message: string }[];
  error?: { message: string };
  plan_execution: {
    stages: {
      state: string;
      actual_frame_count: number;
      provider_job_id?: string;
    }[];
    timeline: { name: string; start: number; count: number }[];
  };
};
export type MotionJob = {
  job_id: string;
  status: string;
  revision: number;
  updated_at: string;
  action: { fps: number; loop: boolean };
  candidates: MotionCandidate[];
  plan_control: { enabled: boolean; message: string };
  export: { candidate_index: number; godot_package_path?: string } | null;
  request: { open_plan?: { work_id: string; revision: number } };
};
export type MotionWork = {
  visual_structure?: {sha256:string;revision:number;selection:{analysis_id:string;token:string};data:{summary:string}} | null;
  adjustment_usage?: {planning:number;generation:number;review:number;tasks:{id:string;revision:number;candidate:number;stage:number|null;state:string}[]};
  end_targets?: {stage: number; sha256: string; note: string}[];
  id: string;
  request_key?: string;
  revision: number;
  latest_revision: number;
  spec: MotionSpec;
  status: string;
  message: string;
  updated_at: string;
  character: { display_name: string; facing: string; cell_width: number };
  plan: MotionPlan | null;
  plan_sha256: string | null;
  job: MotionJob | null;
  diagnostic_only: boolean;
  history: { revision: number; title: string }[];
  messages: {
    role: string;
    call?: number;
    response: { action: string; summary: string; question?: string };
  }[];
  planning_calls: { role: string; state: string; requested_model?: string }[];
};
export type MotionPlanningProgress = {
  state: 'pending' | 'running' | 'complete' | 'blocked' | 'failed' | 'unknown';
  label: string;
};
export function motionPlanningRequestKey(
  work: Pick<MotionWork, 'request_key'> | null,
  pendingKey: string,
  createKey: () => string = () => crypto.randomUUID(),
): string {
  // A returned work confirms this request was received. An explicit new plan
  // needs a new identity, even with unchanged input. An unconfirmed POST keeps
  // its pending identity so a lost response cannot create duplicate paid work.
  return !pendingKey || pendingKey === work?.request_key ? createKey() : pendingKey;
}
export function motionPlanningProgress(
  work: Pick<MotionWork, 'status' | 'plan' | 'messages' | 'planning_calls'>,
  role: string,
): MotionPlanningProgress {
  const running = work.status === 'planning';
  if (role === 'validator') {
    // A validator message is rejection feedback, never a pass receipt. A plan
    // with open questions also bypasses execution validation on the server.
    if (work.plan?.questions.length) return { state: 'blocked', label: '等待补充要求' };
    if (work.plan && ['ready', 'executing'].includes(work.status))
      return { state: 'complete', label: '校验通过' };
    if (work.messages.some(m => m.role === role && m.response.action === 'validation_feedback'))
      return { state: 'blocked', label: running ? '等待修订后校验' : '校验未通过' };
    return { state: 'pending', label: running ? '等待最终方案' : '未完成校验' };
  }
  const callIndex = work.planning_calls.findLastIndex(c => c.role === role);
  if (callIndex < 0) return { state: 'pending', label: running ? '等待处理' : '未执行' };
  const call = work.planning_calls[callIndex];
  if (call.state === 'invalid_response') return { state: 'failed', label: '返回格式无效' };
  if (['failed_request', 'failed'].includes(call.state)) return { state: 'failed', label: '请求失败' };
  if (call.state === 'outcome_unknown') return { state: 'unknown', label: '结果待核对' };
  if (call.state === 'submitting') return running
    ? { state: 'running', label: '正在处理' }
    : { state: 'unknown', label: '调用已中断' };
  if (call.state !== 'completed') return { state: 'unknown', label: '状态待核对' };
  const message = work.messages.findLast(m => m.role === role && (m.call === undefined || m.call === callIndex + 1));
  const action = message?.response.action;
  if (action === 'propose') return { state: 'complete', label: '已提出建议' };
  if (action === 'finalize') return { state: 'complete', label: '已提交方案' };
  if (action === 'consult' || action === 'inspect_reference') return running
    ? { state: 'pending', label: action === 'consult' ? '等待协作回复' : '等待继续观察' }
    : { state: 'blocked', label: '未完成意见' };
  return { state: 'unknown', label: '结果待核对' };
}
export const motionSteps = [
  '准备与描述',
  '查看制作方案',
  '自动制作',
  '检查与调整',
  '导出与使用',
];
export const blankSpec: MotionSpec = {
  character_id: '',
  description: '',
  ending: '',
  return_to_reference: false,
  loop: false,
  fps: 12,
  candidate_count: 1,
  budget: {
    max_planning_calls: 8,
    max_generation_calls: 4,
    max_review_calls: 25,
  },
  timing_mode: 'auto',
  provider: 'pixellab',
  review_protocol: 'experts_v1',
};
export function motionSpecsEqual(a: MotionSpec, b: MotionSpec): boolean {
  // Local drafts merge defaults; the API serializes fields in schema order.
  // Key order is not an edit and must never trigger a fresh paid plan.
  const ordered = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(ordered);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, ordered(item)]),
      );
    return value;
  };
  return (
    JSON.stringify(
      ordered({
        timing_mode: 'auto',
        ...a,
        review_protocol: a.review_protocol ?? 'baseline',
        budget: { max_review_calls: 2, ...a.budget },
        seed: a.seed ?? null,
        visual_structure: a.visual_structure ?? null,
      }),
    ) ===
    JSON.stringify(
      ordered({
        timing_mode: 'auto',
        ...b,
        review_protocol: b.review_protocol ?? 'baseline',
        budget: { max_review_calls: 2, ...b.budget },
        seed: b.seed ?? null,
        visual_structure: b.visual_structure ?? null,
      }),
    )
  );
}
export function motionStep(work: MotionWork | null): number {
  if (!work) return 0;
  if (!work.job) return 1;
  if (work.job.candidates.some(c=>c.plan_execution.stages.some(s=>s.state==='awaiting_review'))) return 2;
  if (work.adjustment_usage?.tasks.some(t=>t.revision===work.revision&&t.stage===null&&!['adopted','rejected'].includes(t.state))) return 3;
  if (work.job.candidates.some((c) => c.status === 'approved')) return 4;
  if (work.job.candidates.some((c) => c.frames.length > 0)) return 3;
  return 2;
}
export function motionUrl(
  path = 'open-motion',
  query: Record<string, string> = {},
) {
  return `/api/workbench/open-motion?${new URLSearchParams({ path, ...query })}`;
}
export async function motionRequest<T>(
  path: string,
  body?: unknown,
  query: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(motionUrl(path, query), {
    cache: 'no-store',
    signal: signal || AbortSignal.timeout(35_000),
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  const payload = (await response.json()) as {
    error?: string | { message?: string };
    detail?: { msg?: string }[];
  };
  if (!response.ok)
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : payload.error?.message ||
            payload.detail?.[0]?.msg ||
            '操作未完成，请查看当前状态后重试。',
    );
  return payload as T;
}
