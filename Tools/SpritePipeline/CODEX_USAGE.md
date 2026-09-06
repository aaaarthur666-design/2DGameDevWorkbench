# Codex driver contract

Codex should operate the harness through `cli.py`, not by clicking Gradio. The
CLI is non-interactive, emits one UTF-8 JSON value, and persists every state
transition before moving to the next paid or destructive boundary.

On Windows, use `harness.cmd` when PowerShell execution policy blocks
`harness.ps1`; both launch the same JSON CLI.

## Safe orchestration sequence

1. Call `list-presets`; stop if the requested character/action is absent or
   marked invalid.
2. Call `create` with a stable `--request-key` and retain
   `data.job.job_id`. Repeating the same key and request returns that job.
3. For PixelLab, call `generate --job <id>`. For async control, add `--no-wait`
   and inspect `data.job.candidates[*].status` before calling again.
   Start with one candidate because each candidate is a separate paid POST.
   Call `estimate` first: subscription units follow
   `ceil(width * height * frame_count / 65536)`, so one 128x128, 16-frame
   candidate costs 4 units rather than 1.
4. Call `safety --job <id> --candidate <n>`, then inspect each candidate's
   `hard_failures`, `warnings`, and frame records. Use `storage-status` to
   discover the per-user jobs directory; never assume a repository `work/`.
5. Never approve a hard failure. When warnings are acceptable, record the
   decision with `approve --acknowledge-warnings --reviewer codex`.
6. For a lossless local/manual edit, call `pixel-edit-frame` directly on any
   frame in a non-terminal, unexported candidate; saving invalidates that
   frame's previous review and re-runs QA. These versions do not consume
   provider credits and are not limited to two. Before using the separately
   bounded external/future-AI `replace-frame` path, mark the frame with
   `review-frame --status repair_requested --issue <category>`.
7. Call `export` only after the candidate status is `approved`. Do not add
   `--overwrite` unless the user explicitly wants to replace an existing staged
   export.
8. Report the four paths and sheet checksum from `data.job.export`.

`list-jobs` is intentionally a lightweight catalog command. It reads each
task's `summary.json` and does not load frames, previews, or the full journal.
After selecting a `job_id`, use `status --job <id>` for the complete durable
record. All candidates created by one request remain under that single task
directory.

For the bundled Cyber Warrior, use action IDs `idle`, `walk`, `jump`, `attack`,
`attack_in_air`, `hurt`, `backward_evade`, or `death`. Do not reconstruct sheet
order yourself: every new bundled action requests sixteen frames and exports a
four-column, four-row sheet while preserving runtime FPS and critical-frame
metadata. Valid non-sixteen provider results and legacy Sheet imports must still
be preserved for review instead of being resubmitted or discarded.
`backward_evade` is a new asset contract and must not be reported as already
wired into the Godot state machine. Jump, attack, air attack, and hurt also need
their existing Godot frame lists updated before a new sixteen-frame export can
replace an older lower-frame asset.

## Statuses Codex must respect

Candidate states are `created`, `submitting`, `submission_unknown`,
`provider_pending`, `saving`, `received`, `check_failed`, `review_ready`,
`approved`, `rejected`, and `failed`.

- `submitting` is a persisted in-flight POST. If it becomes stale without a
  provider job ID, recovery changes it to `submission_unknown`.
- `submission_unknown` must never be resubmitted. If the original provider job
  ID is found, use `attach-provider-job`; that command never submits.
- `provider_pending` is resumable using another `generate` call.
- `saving` means the provider completed but local publication is unfinished.
  Run `recover-all`; it publishes a committed staging result or polls the same
  provider job, never a new one.
- A failed candidate whose `provider_status` is `completed` and whose error is
  the former frame-count contract can be salvaged with `recover --job <id>
  --candidate <n>`. `recover` polls the existing provider job and never submits.
- `check_failed` is never exportable.
- `review_ready` requires explicit review/approval.
- `fixture` results are diagnostic only even if QA passes.

Every successful QA run records `qa_algorithm_version`. If `safety` or `status`
shows a candidate approved under an older algorithm and it has not been
exported, run `check --job <id> --candidate <n>`, inspect the new report, and
approve it again. Never treat the old approval as current. Exported candidates
are immutable and cannot be rechecked as part of an algorithm migration. The
export recipe and QA JSON preserve the version used for the decision.

## Frame-repair state and browser drafts

The operator page shows every candidate frame in one timeline with five visual
states: pending, approved, repair requested, modified, and still blocking. It
can move directly to the previous or next problem frame and keeps the selected
job, candidate, and frame after a save or recheck. Loop endpoints use each
other as actual neighbors; do not analyze the first and last frame as unrelated
when the action is cyclic.

After a repair is checked successfully, `qa_change_summary` records resolved,
new, and persisting issues relative to the preceding successful QA. A failed QA
keeps `qa_issue_baseline` for a safe retry; do not clear or reinterpret that
baseline as a successful comparison.

Browser drafts store base RGBA plus edited RGBA. When the durable frame changes,
the editor performs a three-way merge and only accepts non-conflicting pixels;
editing remains disabled until recovery is resolved. Draft slots are unique per
page instance, so multiple windows must not be assumed to share one draft.

For external `replace-frame`, the selected file is bound to its job, candidate,
frame, and source SHA-256. Changing repair context invalidates the upload. Codex
must follow the same rule: keep the target identifiers and SHA captured when the
source was read, and require the operator to reselect/recreate the file after a
context change instead of applying it to a different frame.

## Stable examples

Create from flags with an idempotency key:

```powershell
.\harness.ps1 create --character your_character --action idle --provider pixellab --candidates 1 --seed 12345 --request-key <stable-unique-value>
```

Run the bundled, offline diagnostic from a versioned request file:

```powershell
$created = .\harness.ps1 create --request examples\create_job.json | ConvertFrom-Json
$jobId = $created.data.job.job_id
.\harness.ps1 generate --job $jobId
```

Commit a local pixel-edit PNG directly:

```powershell
.\harness.ps1 pixel-edit-frame --job <id> --candidate 1 --frame 5 --source D:\repairs\frame_005.png --base-sha256 <current-frame-sha256> --reviewer codex
```

`--base-sha256` is required. It prevents a PNG prepared from an older frame
from overwriting a newer version saved by another UI/API/CLI session. Always
carry forward the hash returned when the source pixels were read; never query
a fresh hash only at commit time.
The command verifies an exact RGBA PNG round trip, preserves the immutable raw
frame, records changed-pixel metadata, and re-runs QA.

The bounded external `replace-frame` fallback also requires
`--base-sha256 <hash-captured-when-the-frame-was-selected>` for the same
double-window protection.

Base64 frame ingestion accepts 1–64 PNG frames and retains the aggregate upload
limit. Provider candidates additionally require an intact immutable result
manifest, commit marker, and raw frames before QA, approval, or export; repaired
active versions never bypass this gate.

Reject a candidate without modifying its immutable raw frames:

```powershell
.\harness.ps1 reject --job <id> --candidate 2 --reviewer codex --note "identity drift"
```

The CLI JSON schema starts at `schema_version: 1`. Treat unknown fields as
forward-compatible, but do not ignore `ok: false`, nonzero exit codes, hard
failures, or an unapproved candidate state.

Normal runs separate code and user data. `storage-status` reports the actual
data, job, export, and protected-credential paths. `balance` performs a free
balance query, while `estimate` is entirely local. `recover-all`, `recover`, `safety`, and
`attach-provider-job` never create a chargeable submission. Only pass
`--root` for an explicitly requested portable/test workspace.

## 攻击默认检查与有限补做

地面攻击（`attack`）和空中攻击（`attack_in_air`）的非循环生成默认启用：先生成完整动作，再由所选视觉服务检查判断提前挥刀、武器翻向、重复蓄力、额外挥刀及身体连续性。无需选择额外模式或上传关键姿势。

在设置中选择视觉检查服务并保存 **视觉检查 API Key**。默认使用 TokenHub 的混元 `hy-vision-2.0-instruct`，可复用服务端 `TOKENHUB_API_KEY`；如果 Key 仅保存在地图页面的运行时进程，请在视觉设置中再保存一次。也可选择 OpenAI `gpt-5.4-2026-03-05`，使用独立的 `OPENAI_API_KEY` 或本机保存的密钥。两家密钥分别存于受保护存储，不互相覆盖；不会在检查失败时自动切换提供方。图片发送至所选服务，按 API 用量另行计费。未配置时不提交新的攻击生成，低置信度、超时、截断或无有效结论均停止自动补做。

每个任务（多个候选共用）最多额外生成 **两次**，每次编辑包含邻帧的 4 帧短段，仅将问题帧放回完整动画复检。只有结论改善且本机检查无阻止问题，才自动采用。原始帧与未采用候选保留。检查请求最多为候选数加两次，不会自动重试结果未知的付费请求。次数记录先持久化，刷新与重启不会清零；旧任务不会自动触发新增费用。

达到上限仍有问题时，保留较好版本并标记至 **3 · 逐帧修补**。其中的 **AI 修补当前问题帧** 可生成、刷新和预览，再由用户明确采用；每帧最多手动请求两次，与自动阶段分别计数。采用时检查基础版本，防止覆盖补做期间的新修改。手工像素修补和上传替换继续可用。

旧 `/attack-plans` 接口及记录保留兼容，但复杂的方案面板已经从生成页移除。内部补做子任务只作为执行记录，不列入作品库。

视觉检查按候选的实际帧数工作，支持 1–64 帧；17 帧等结果全部按原顺序发送，不截断到 16 帧。非标准帧数按可见动作判断阶段边界，问题帧号不得越界。单帧无法证明连续性，因此不能判为通过。局部补做仍提交四个上下文槽位，少于四帧时只对上下文补齐，采用时保留原动画长度、原始帧和全部非目标帧。整个任务的自动补做上限仍为两次，不因帧数、刷新或重启而重置。

播放检查和逐帧修补明确区分本机基础检查与视觉检查状态。对于旧版本因非 16 帧而在发送前停止的任务，可在“播放检查”选中动画后点击“继续视觉检查”，或调用 `POST /jobs/{job_id}/motion-review/resume`。这会复用已有帧并排队检查，视觉请求及有限补做按用量计费。已发送但结果未知的请求不会借此重发；已完成的视觉检查不会重置补做预算。旧任务不会仅因更新程序而自动收费。
