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
  seed?: number | null;
};
export type MotionStage = {
  name: string;
  goal: string;
  prompt: string;
  frame_count: number;
  first_frame: string;
  last_frame: string;
  acceptance: string[];
  checkpoint?: { endpoint: string; rhythm: string; reason: string };
  motion?: {camera:string;orientation:string;trajectory:string;support:string;drive:string;appearance:string;entry:string;exit:string;boundary:string;holds:{start:number;end:number;reason:string}[]};
};
export type MotionPlan = {
  quality?: {
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
export type MotionCandidate = {
  quality_review?: {
    state: string;
    verdict: 'pass' | 'fail' | 'uncertain';
    summary?: string;
    checks?: {
      dimension: 'completeness' | 'equipment' | 'rhythm';
      frames: number[];
      evidence: string;
    }[];
  };
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
  end_targets?: {stage: number; sha256: string; note: string}[];
  id: string;
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
    response: { action: string; summary: string; question?: string };
  }[];
  planning_calls: { role: string; state: string; requested_model?: string }[];
};
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
    max_review_calls: 10,
  },
  timing_mode: 'auto',
  provider: 'pixellab',
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
        budget: { max_review_calls: 2, ...a.budget },
        seed: a.seed ?? null,
      }),
    ) ===
    JSON.stringify(
      ordered({
        timing_mode: 'auto',
        ...b,
        budget: { max_review_calls: 2, ...b.budget },
        seed: b.seed ?? null,
      }),
    )
  );
}
export function motionStep(work: MotionWork | null): number {
  if (!work) return 0;
  if (!work.job) return 1;
  if (work.job.candidates.some(c=>c.plan_execution.stages.some(s=>s.state==='awaiting_review'))) return 2;
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
