"""Durable open-motion workspaces. Planning and execution have separate receipts."""
from __future__ import annotations

import hashlib
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from pydantic import ValidationError

from ..errors import ConflictError, NotFoundError, ValidationHarnessError
from ..jsonio import atomic_write_json, read_json
from .contracts import ExpertTurn, OpenWork, PlanBinding, TaskSpec, digest, bind_original_requirements
from .planning import PlanningModel


def now():
    return datetime.now(timezone.utc).isoformat()


class OpenMotionWorkspace:
    def __init__(self, service, *, model=None):
        self.service = service
        self.store = service.store
        self.root = service.settings.data_root / "open-motion"
        self.model = model or getattr(service, "open_motion_model", None) or PlanningModel(service.settings)

    def directory(self, work_id):
        if not re.fullmatch(r"[0-9a-f]{32}", work_id):
            raise ValidationHarnessError("作品标识无效")
        return self.root / work_id

    def load(self, work_id, revision=None):
        path = self.directory(work_id) / "work.json"
        if not path.is_file():
            raise NotFoundError("未找到此作品")
        current = OpenWork.model_validate(read_json(path))
        if revision is not None and revision != current.revision:
            if not isinstance(revision, int) or revision < 1:
                raise ValidationHarnessError("版本号无效")
            path = self.directory(work_id) / f"version-{revision}.json"
            if not path.is_file():
                raise NotFoundError("未找到此版本")
            return OpenWork.model_validate(read_json(path))
        return current

    def save(self, work):
        work.updated_at = now()
        atomic_write_json(self.directory(work.id) / "work.json", work.model_dump(mode="json"))

    def lock(self, work_id, *, timeout=5):
        self.directory(work_id)
        return self.store.global_lock("open-work-" + work_id, timeout_seconds=timeout)

    def reference(self, work):
        data = (self.directory(work.id) / f"reference-{work.revision}.png").read_bytes()
        if hashlib.sha256(data).hexdigest() != work.reference_sha256:
            raise ConflictError("作品参考图已改变，已停止执行")
        return data

    def listing(self):
        rows = []
        jobs = {j['job_id']: j for j in self.store.list_jobs()}
        for path in self.root.glob("*/work.json"):
            try:
                w = self.load(path.parent.name)
                job = jobs.get(w.job_id, {})
                rows.append({"id": w.id, "revision": w.revision, "title": w.plan.title if w.plan else w.spec.description[:60],
                             "status": w.status, "job_id": w.job_id, "job_status": job.get("status"),
                             "updated_at": max(w.updated_at, job.get("updated_at", "")),
                             "character_name": w.character["display_name"], "diagnostic_only": w.spec.provider == "fixture"})
            except (ValueError, OSError, KeyError):
                continue
        return sorted(rows, key=lambda row: row["updated_at"], reverse=True)

    def create(self, spec, request_key, *, planning_authorized=False, auto_execute=False):
        spec = TaskSpec.model_validate(spec)
        if not planning_authorized:
            raise ValidationHarnessError("制定方案会调用模型，请先授权本次规划额度")
        if spec.provider != 'fixture' and spec.budget.max_review_calls < 4 * spec.candidate_count:
            raise ValidationHarnessError('视觉预算至少需要每个候选 4 次（一个片段检查加整段复核）；尚未调用规划模型，请先调整预算')
        if not re.fullmatch(r"[A-Za-z0-9._:-]{8,128}", request_key):
            raise ValidationHarnessError("请求标识无效")
        fingerprint = digest({"spec": spec.model_dump(mode="json"), "auto_execute": auto_execute})
        request_path = self.root / "requests" / (hashlib.sha256(request_key.encode()).hexdigest() + ".json")
        with self.store.global_lock("open-work-creation"):
            if request_path.exists():
                receipt = read_json(request_path)
                if receipt["fingerprint"] != fingerprint:
                    raise ConflictError("同一请求标识已用于其他需求")
                return self.load(receipt["id"])
            if not self.model.configured:
                raise ValidationHarnessError("请先在模型设置中配置规划模型；不会创建空生成任务")
            character, preset_path = self.service.presets.load_character(spec.character_id)
            source = preset_path.parent / character.reference_frame
            self.service._validate_reference_image(source, character.cell_width, character.cell_height)
            data = source.read_bytes()
            work = OpenWork(id=uuid.uuid4().hex, request_key=request_key, request_sha256=fingerprint,
                            spec=spec, character=character.model_dump(mode="json"), reference_sha256=hashlib.sha256(data).hexdigest(),
                            created_at=now(), updated_at=now(), planning_authorized=True, auto_execute=auto_execute,
                            planning_config=self.model.configuration)
            directory = self.directory(work.id); directory.mkdir(parents=True)
            self.service._atomic_write_bytes(directory / "reference-1.png", data)
            self.save(work)
            atomic_write_json(request_path, {"id": work.id, "fingerprint": fingerprint})
            return work

    def revise(self, work_id, expected_revision, spec, request_key, *, planning_authorized=False):
        spec = TaskSpec.model_validate(spec)
        if not planning_authorized:
            raise ValidationHarnessError("重新制定方案需要明确授权规划调用")
        if not re.fullmatch(r"[A-Za-z0-9._:-]{8,128}", request_key):
            raise ValidationHarnessError("请求标识无效")
        with self.lock(work_id):
            work = self.load(work_id)
            fingerprint = digest({"spec": spec.model_dump(mode="json"), "auto_execute": False})
            if work.request_key == request_key:
                if work.request_sha256 != fingerprint:
                    raise ConflictError("同一请求标识已用于其他需求")
                return work
            if work.revision != expected_revision:
                raise ConflictError("需求版本已改变，请刷新后继续")
            if work.status == "planning":
                raise ConflictError("规划尚在执行，请等待结果后修改")
            if work.job_id:
                job = self.store.load(work.job_id)
                if any(c.status.value in {"submitting", "submission_unknown", "provider_pending", "saving"} for c in job.candidates):
                    raise ConflictError("已有请求尚未结束，请先核对结果；不会覆盖原任务")
                if job.plan_control and job.plan_control.enabled:
                    with self.store.locked_job(job.job_id) as current:
                        current.plan_control.enabled = False
                        current.touch("open_plan_superseded")
            if len(work.history) >= 50:
                raise ValidationHarnessError("当前作品版本过多，请另建作品；历史版本保留")
            character, preset_path = self.service.presets.load_character(spec.character_id)
            source = preset_path.parent / character.reference_frame
            self.service._validate_reference_image(source, character.cell_width, character.cell_height)
            data = source.read_bytes()
            snapshot = work.model_dump(mode="json"); snapshot.pop("history")
            atomic_write_json(self.directory(work.id) / f"version-{work.revision}.json", snapshot)
            work.history.append({"revision": work.revision, "title": work.plan.title if work.plan else work.spec.description[:60], "job_id": work.job_id})
            work.revision += 1; work.spec = spec; work.request_key = request_key; work.request_sha256 = fingerprint
            work.version = 3
            work.character = character.model_dump(mode="json"); work.reference_sha256 = hashlib.sha256(data).hexdigest()
            work.plan = None; work.plan_sha256 = None; work.job_id = None
            work.end_targets = []
            work.planning_calls = []; work.messages = []; work.status = "planning"
            work.message = "正在按新要求制定方案"; work.auto_execute = False
            work.planning_config = self.model.configuration
            self.service._atomic_write_bytes(self.directory(work.id) / f"reference-{work.revision}.png", data)
            self.save(work)
            return work

    def plan(self, work_id, *, stopping=lambda: False):
        # This OS-backed lock spans the model call; a second process cannot run
        # the same planning turn. A crash leaves a receipt, never an automatic retry.
        with self.store.global_lock("open-planner-" + work_id, timeout_seconds=0.1):
            work = self.load(work_id)
            if work.status != "planning":
                return work
            if work.planning_calls:
                work.status = "planning_failed"
                work.message = "规划曾被中断，已保留调用记录；请明确重新制定方案，不会自动重发"
                self.save(work); return work
            queue = [(role, "", None) for role in ("appearance", "motion", "strategy", "coordinator")]
            contributed = set()
            last_invalid_plan = None
            try:
                reference = self.reference(work)
                while queue:
                    if stopping():
                        return work
                    if len(work.planning_calls) >= work.spec.budget.max_planning_calls:
                        work.status = "budget_exhausted"; work.message = "规划调用已到上限；原要求和已有提案均已保留"
                        self.save(work); return work
                    role, question, crop = queue.pop(0)
                    work.message = {"appearance": "正在核对角色特征", "motion": "正在安排动作与衔接", "strategy": "正在制定生成策略", "coordinator": "正在协调并校验方案"}[role]
                    work.planning_calls.append({"role": role, "state": "submitting", "started_at": now(), "request_id": uuid.uuid4().hex,
                                                "reference_sha256": work.reference_sha256, "crop": crop})
                    self.save(work)
                    turn, receipt = self.model(role, work, reference, question=question, crop=crop)
                    turn = ExpertTurn.model_validate(turn)
                    work.planning_calls[-1].update(state="completed", finished_at=now(), **receipt)
                    work.messages.append({"role": role, "question": question, "response": turn.model_dump(mode="json"), "call": len(work.planning_calls)})
                    if turn.action == "inspect_reference":
                        # Validate locally before scheduling a further paid call.
                        if turn.crop:
                            left, top, right, bottom = turn.crop
                            if not 0 <= left < right <= work.character["cell_width"] or not 0 <= top < bottom <= work.character["cell_height"]:
                                raise ValidationHarnessError("专家请求的观察区域超出参考图")
                        queue.insert(0, (role, "Requested reference view supplied. Complete or revise your proposal.", turn.crop))
                    elif turn.action == "consult":
                        if turn.target == role:
                            raise ValidationHarnessError("专家不能向自己发起重复质询")
                        queue[0:0] = [(turn.target, turn.question, None), (role, "Your consultation has been answered; assess the peer evidence and continue.", None)]
                    elif turn.action == "finalize":
                        if role != "coordinator" or not {"appearance", "motion", "strategy"} <= contributed:
                            raise ValidationHarnessError("方案缺少必要的专家提案")
                        plan = bind_original_requirements(turn.plan, work.spec)
                        problem = None
                        calls = len(plan.stages) * work.spec.candidate_count
                        if calls > work.spec.budget.max_generation_calls:
                            problem = f"方案需要 {calls} 次生成，但用户上限是 {work.spec.budget.max_generation_calls} 次。合并非必要片段，不能提高预算。"
                        elif not plan.questions:
                            try:
                                PlanBinding(work_id=work.id, revision=work.revision, plan_sha256=digest(plan.model_dump(mode="json")),
                                            reference_sha256=work.reference_sha256, spec=work.spec, plan=plan)
                                if work.version >= 2 and work.spec.provider != 'fixture':
                                    from .quality import validate_quality_plan
                                    from ..models import CharacterPreset
                                    validate_quality_plan(plan, work.spec, CharacterPreset.model_validate(work.character), require_checkpoints=work.version >= 3)
                            except ValidationHarnessError as exc:
                                problem = str(exc)
                            except ValidationError as exc:
                                problem = "; ".join(e['msg'] for e in exc.errors(include_input=False))
                        if problem:
                            invalid_hash = digest(plan.model_dump(mode='json'))
                            if last_invalid_plan == invalid_hash:
                                raise ValidationHarnessError('协调专家重复了同一无效方案，已停止额外调用。' + problem)
                            last_invalid_plan = invalid_hash
                            # A successful model turn can ask the local validator
                            # for feedback, within the already authorized cap.
                            # Failed/ambiguous network requests are never retried.
                            work.messages.append({"role":"validator", "response":{"action":"validation_feedback", "summary":problem}, "call":len(work.planning_calls)})
                            if len(work.planning_calls) >= work.spec.budget.max_planning_calls:
                                raise ValidationHarnessError("方案校验未通过，规划调用已到上限；未提交生成。" + problem)
                            queue.insert(0, ("coordinator", "Local validator rejected the proposal. Correct ONLY the invalid plan, preserve the original task and return finalize: " + problem, None))
                            self.save(work)
                            continue
                        work.plan = plan; work.plan_sha256 = digest(plan.model_dump(mode="json"))
                        work.status = "needs_input" if plan.questions else "ready"
                        work.message = "请补充方案中的关键问题" if plan.questions else "方案已就绪，等待制作授权"
                        self.save(work)
                        if work.auto_execute and work.status == "ready" and not stopping():
                            return self.start(work.id, work.revision, work.plan_sha256)
                        return work
                    else:
                        contributed.add(role)
                        if role == "coordinator" and not queue:
                            queue.append((role, "Finalize a plan, or publish a plan with explicit questions if user input is required.", None))
                    self.save(work)
                raise ValidationHarnessError("专家未形成可执行方案；已有提案保留")
            except Exception as exc:
                if work.planning_calls and work.planning_calls[-1]["state"] == "submitting":
                    work.planning_calls[-1]["state"] = "outcome_unknown"
                    if isinstance(exc, ValidationHarnessError) and exc.details.get("model_receipt"):
                        receipt=exc.details['model_receipt']
                        work.planning_calls[-1].update(receipt)
                        work.planning_calls[-1]['state'] = 'invalid_response' if receipt.get('response_id') or 'output_sha256' in receipt else 'failed_request' if receipt.get('http_status') else 'outcome_unknown'
                work.status = "planning_failed"
                work.message = str(exc) if isinstance(exc, (ConflictError, ValidationHarnessError)) else "规划未完成，已保留记录；不会自动重复调用模型"
                self.save(work)
                return work

    def recover_planning(self, *, stopping=lambda: False):
        for row in self.listing():
            if stopping():
                break
            if row["status"] == "planning":
                try:
                    self.plan(row["id"], stopping=stopping)
                except ConflictError:
                    pass  # Another process owns this planning request.

    def start(self, work_id, expected_revision, plan_sha256):
        from ..models import GenerationRequest, utc_now
        with self.lock(work_id):
            work = self.load(work_id)
            if work.revision != expected_revision or work.plan_sha256 != plan_sha256:
                raise ConflictError("方案版本已改变，请查看最新方案")
            if work.job_id:
                # Repair a crash between binding the job and enabling it. A
                # previously started/paused job must never be re-enabled here.
                from .targets import freeze_targets
                freeze_targets(self, work, work.job_id)
                with self.store.locked_job(work.job_id) as current:
                    if current.generation_requested_at is None:
                        current.plan_control.enabled = True
                        current.generation_requested_at = utc_now()
                        current.touch("open_plan_authorized", plan_sha256=work.plan_sha256)
                return work  # An ambiguous client response never submits twice.
            if work.status != "ready" or work.plan is None:
                raise ConflictError("方案尚未就绪")
            from .quality import compiled_prompt
            binding = PlanBinding(work_id=work.id, revision=work.revision, plan_sha256=work.plan_sha256,
                                  reference_sha256=work.reference_sha256, spec=work.spec, plan=work.plan,
                                  model_snapshot=work.planning_config,
                                  end_targets=work.end_targets,
                                  compiled_prompts=[compiled_prompt(work.plan, self.service.presets.load_character(work.spec.character_id)[0], i) for i in range(len(work.plan.stages))])
            request = GenerationRequest(character_id=work.spec.character_id, action_id="motion_" + work.id[:12],
                                        provider=work.spec.provider, candidate_count=work.spec.candidate_count,
                                        seed=work.spec.seed, request_key=f"open-motion-{work.id}-{work.revision}", open_plan=binding)
            job = self.service.create_job(request)
            work.job_id = job.job_id; work.status = "executing"; work.message = "正在按方案制作"
            # Persist the binding before enabling any provider work.
            self.save(work)
            from .targets import freeze_targets
            freeze_targets(self, work, job.job_id)
            with self.store.locked_job(job.job_id) as current:
                current.plan_control.enabled = True
                current.plan_control.message = "等待执行计划"
                current.generation_requested_at = current.generation_requested_at or utc_now()
                current.touch("open_plan_authorized", plan_sha256=work.plan_sha256)
            return work

    def pause(self, work_id, expected_revision, *, resume=False):
        with self.lock(work_id):
            work = self.load(work_id)
            if work.revision != expected_revision or not work.job_id:
                raise ConflictError("当前版本没有可暂停的生成")
            with self.store.locked_job(work.job_id) as job:
                if resume and any(r.state in {'reviewing', 'awaiting_review', 'rejected'} for c in job.candidates for r in c.plan_execution.stages):
                    raise ConflictError('请先检查当前片段并确认实际姿势；继续按钮不能绕过分段验收')
                if resume and any(c.status.value in {"submission_unknown", "failed"} and not c.frames for c in job.candidates):
                    raise ConflictError("请先查询原请求解决异常；无法取回时可修改需求建立新版本，不会重发原片段")
                job.plan_control.enabled = resume
                job.plan_control.message = "继续按已授权方案制作" if resume else "已暂停后续提交，已发出的请求仍会取回"
                job.touch("open_plan_resumed" if resume else "open_plan_paused")
            return work

    def view(self, work_id, revision=None):
        work = self.load(work_id)
        latest_revision = work.revision
        if revision is not None and revision != work.revision:
            work = self.load(work_id, revision)
        result = work.model_dump(mode="json")
        result["latest_revision"] = latest_revision
        result["job"] = self.store.load(work.job_id).model_dump(mode="json") if work.job_id else None
        result["view_path"] = "/tools/sprite-generator?work=" + work.id
        result["diagnostic_only"] = work.spec.provider == "fixture" or bool(result["job"] and any(c["diagnostic_only"] for c in result["job"]["candidates"]))
        return result
