import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  taskPresentation,
  taskViewPath,
  mcpContent,
} from "../../lib/workbench/presentation.mjs";
const manifest = JSON.parse(
  await readFile(
    new URL("../../workbench/manifest.json", import.meta.url),
    "utf8",
  ),
);
const base = {
  id: "example",
  capabilityId: "reference-art",
  status: "prepared",
  input: { operation: "generate", name: "骑士" },
};
assert.equal(taskPresentation(manifest, base).state, "prepared");
assert.equal(
  taskPresentation(manifest, { ...base, status: "awaiting_configuration" })
    .state,
  "awaiting_configuration",
);
assert.equal(
  taskPresentation(
    manifest,
    { ...base, status: "completed" },
    { artifacts: [{ path: "outputs/example/reference.png", missing: true }] },
  ).state,
  "attention_required",
);
const transfer = {
  ...base,
  status: "completed",
  input: { operation: "transfer", sourceTaskId: "source-1" },
};
assert.equal(
  taskViewPath(manifest, transfer),
  "/tools/reference-art?task=source-1",
);
assert.equal(
  taskPresentation(manifest, transfer, {
    result: { characterId: "reference_one" },
  }).actions[0].viewPath,
  "/tools/sprite-generator?character=reference_one",
);
const sprite = {
  ...base,
  capabilityId: "sprite-generator",
  input: { operation: "get", jobId: "old-job", candidateIndex: 3 },
};
assert.equal(
  taskViewPath(manifest, sprite),
  "/tools/sprite-generator?job=old-job&candidate=3",
);
for (const [remoteStatus, state] of [
  ["created", "saved"],
  ["review_required", "attention_required"],
  ["approved", "saved"],
  ["exported", "completed"],
]) {
  assert.equal(
    taskPresentation(manifest, {
      ...sprite,
      status: "completed",
      adapter: { remoteStatus },
    }).state,
    state,
  );
}
const animation = taskPresentation(
  manifest,
  { ...sprite, status: "completed", adapter: { remoteStatus: "exported" } },
  { artifacts: [{ path: "outputs/example/preview.gif" }] },
);
assert.equal(animation.preview.kind, "animation");
assert.equal(animation.browserOpened, false);
const saved = {
  ...base,
  capabilityId: "interactable-editor",
  status: "completed",
  input: { operation: "save-project", project: { name: "门" } },
};
assert.equal(taskPresentation(manifest, saved).state, "saved");
for (const [operation, route] of [["generate-prop", "/tools/interactable-editor"], ["edit-image", "/tools/interactable-editor"]]) {
  const imageTask = { ...base, capabilityId: "image-assets", status: "completed", input: { operation } };
  const imagePresentation = taskPresentation(manifest, imageTask, { artifacts: [{ path: "outputs/example/image.png" }] });
  assert.equal(imagePresentation.viewPath, `${route}?imageTask=example`);
  assert.equal(imagePresentation.preview.kind, "image");
  assert.match(imagePresentation.summary, /候选已保存/);
}
const rich = {
  taskId: "example",
  status: "completed",
  presentation: animation,
  result: { orderedFrames: Array(200).fill("frames/example.png") },
};
assert(
  mcpContent("workbench_get_result", rich).length < JSON.stringify(rich).length,
);
assert(!mcpContent("workbench_get_result", rich).includes("orderedFrames"));
assert.equal(
  JSON.parse(
    mcpContent("workbench_get_result", { ...rich, detailIncluded: true }),
  ).result.orderedFrames.length,
  200,
);
const polled = JSON.parse(
  mcpContent("workbench_get_task", {
    task: { id: "keep-original-task", status: "running" },
    presentation: animation,
    refreshError: "network stack and internal diagnostics",
  }),
);
assert.equal(polled.taskId, "keep-original-task");
assert.equal(polled.status, "running");
assert.match(polled.issue, /上次保存的状态/);
assert(!JSON.stringify(polled).includes("internal diagnostics"));
const failedPresentation = {
  ...animation,
  issue: { summary: "请检查原任务。", detail: "long diagnostic details" },
};
const listed = JSON.parse(
  mcpContent("workbench_list_tasks", {
    tasks: [{ id: "failed-original", presentation: failedPresentation }],
  }),
);
assert.equal(listed.matches[0].taskId, "failed-original");
assert.deepEqual(listed.matches[0].issue, { summary: "请检查原任务。" });
assert(
  !taskPresentation(manifest, sprite, {
    candidateIndex: 1,
    artifacts: [{ path: "outputs/example/preview.gif" }],
  }).preview,
);
// UI-06: do not prepend character name when action title already includes it.
assert.equal(
  taskPresentation(manifest, { ...sprite, status: "completed" }, {
    result: {
      character: { display_name: "红袍法师" },
      action: { display_name: "红袍法师原地举杖施法循环" },
    },
  }).title,
  "红袍法师原地举杖施法循环",
);
assert.equal(
  taskPresentation(manifest, { ...sprite, status: "completed" }, {
    result: {
      character: { display_name: "红袍法师" },
      action: { display_name: "举杖施法" },
    },
  }).title,
  "红袍法师 · 举杖施法",
);
// REV-01: surface running stage review and whole-clip quality review progress + readyToDecide=false.
const stageReviewRunning = taskPresentation(
  manifest,
  { ...sprite, status: "running", input: { operation: "generate-motion" }, adapter: { remoteStatus: "created" } },
  {
    result: {
      openWorkId: "a".repeat(32),
      jobRecord: {
        job_id: "job-rev",
        status: "created",
        request: { open_plan: { revision: 1, plan_sha256: "b".repeat(64), spec: { review_protocol: "experts_v1", budget: { max_review_calls: 25 } }, plan: { quality: { version: 3 } } } },
        candidates: [{
          candidate_index: 1,
          frames: [],
          plan_execution: {
            stages: [{
              state: "reviewing",
              review: { state: "running", protocol: "experts_v1", requests: [{}, {}], expert_review: { state: "running", phase: "appearance", calls_used: 2, max_calls: 5 } },
            }],
            quality_review: { state: "pending", requests: [] },
          },
        }],
      },
    },
  },
);
assert.equal(stageReviewRunning.state, "running");
assert.equal(stageReviewRunning.readyToDecide, false);
assert.equal(stageReviewRunning.visualReview.scope, "stage");
assert.equal(stageReviewRunning.visualReview.phase, "appearance");
assert.equal(stageReviewRunning.visualReview.callsUsed, 2);
assert.equal(stageReviewRunning.visualReview.maxCalls, 25);
assert.match(stageReviewRunning.summary, /第 1 段/);
assert.match(stageReviewRunning.summary, /外观专家/);

const clipReviewRunning = taskPresentation(
  manifest,
  { ...sprite, status: "attention_required", input: { operation: "get-motion" }, adapter: { remoteStatus: "review_required" } },
  {
    result: {
      openWorkId: "a".repeat(32),
      jobRecord: {
        job_id: "job-rev",
        status: "review_required",
        request: { open_plan: { revision: 1, plan_sha256: "b".repeat(64), spec: { review_protocol: "experts_v1", budget: { max_review_calls: 25 } }, plan: { quality: { version: 3 } } } },
        candidates: [{
          candidate_index: 1,
          frames: [{ index: 0 }, { index: 1 }],
          plan_execution: {
            stages: [{ state: "accepted", review: { state: "complete", requests: [{}, {}, {}, {}, {}] } }],
            quality_review: { state: "running", protocol: "experts_v1", requests: [{}, {}, {}], expert_review: { state: "running", phase: "motion", calls_used: 3, max_calls: 5 } },
          },
        }],
      },
    },
  },
);
assert.equal(clipReviewRunning.state, "running");
assert.equal(clipReviewRunning.readyToDecide, false);
assert.equal(clipReviewRunning.visualReview.scope, "clip");
assert.equal(clipReviewRunning.visualReview.phase, "motion");
assert.equal(clipReviewRunning.visualReview.callsUsed, 8);
assert.match(clipReviewRunning.summary, /整段动画/);
assert.match(clipReviewRunning.summary, /运动专家/);

// MCP-01: default mcpContent surfaces open-motion tokens & candidate errors/warnings without "orderedFrames".
const stageToken = "c".repeat(64);
const planSha = "d".repeat(64);
const targetSha = "e".repeat(64);
const mcpSummaryText = mcpContent("workbench_get_result", {
  taskId: "t-open",
  detailIncluded: false,
  status: "attention_required",
  presentation: taskPresentation(manifest, { ...sprite, status: "attention_required" }, {
    result: { openWorkId: "a".repeat(32), pendingCheckpoints: [{ candidateIndex: 1, stageIndex: 0, stageToken }] },
  }),
  result: {
    openWorkId: "a".repeat(32),
    revision: 2,
    planSha256: planSha,
    targetSetSha256: targetSha,
    pendingCheckpoints: [{ candidateIndex: 1, stageIndex: 0, stageToken }],
    candidates: [{ candidateIndex: 1, status: "created", hardFailures: ["bad_alpha"], warnings: ["flicker"] }],
    orderedFrames: ["frames/000.png"],
  },
});
assert(!mcpSummaryText.includes("orderedFrames"));
const mcpSummary = JSON.parse(mcpSummaryText);
assert.equal(mcpSummary.openWorkId, "a".repeat(32));
assert.equal(mcpSummary.revision, 2);
assert.equal(mcpSummary.planSha256, planSha);
assert.equal(mcpSummary.targetSetSha256, targetSha);
assert.equal(mcpSummary.pendingCheckpoints[0].stageToken, stageToken);
assert.deepEqual(mcpSummary.candidates[0].hardFailures, ["bad_alpha"]);
assert.deepEqual(mcpSummary.candidates[0].warnings, ["flicker"]);

console.log(
  "Presentation: exact identities, honest states, missing artifacts, animated preview and compact/full fallback passed.",
);
