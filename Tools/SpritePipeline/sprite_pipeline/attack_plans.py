"""Human-reviewed attack segments with a durable, finite submission allowance.

No loop in this module submits another candidate. Every new attempt requires an
explicit call; recovery only resumes the already reserved child job.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import secrets
import uuid
from pathlib import Path
from typing import Any

from PIL import Image

from .errors import ConflictError, ValidationHarnessError
from .jsonio import atomic_write_json, read_json, sha256_file
from .models import GenerationRequest

ANCHOR_FRAMES = (0, 3, 6, 9, 12, 15)
PHASES = ("抬刀过肩", "蓄力到顶", "唯一一次下劈", "低位随动", "收刀恢复")
PHASE_PROMPTS = (
    "Raise the sword behind the shoulder toward the end pose. Wind-up only; never swing forward.",
    "Finish charging with the blade behind the shoulder, then hold the end pose. No forward strike.",
    "Exactly one fast vertical downward chop from the charged pose to the low end pose. Never recharge.",
    "Continue the low follow-through toward the end pose. No new attack, overhead lift or recharge.",
    "Recover calmly to the idle end pose. No attack, wind-up or second hit.",
)
BUSY = {"submitting", "submission_unknown", "provider_pending", "saving"}


def trajectory_check(points: list[list[float]], segment: int, size: int) -> list[str]:
    """Check user-labelled directed grip-to-tip vectors, never guessed pixels.

Camera/foreshortening and short blades can invalidate these 2D heuristics. A
flag stops acceptance for inspection; it never triggers paid regeneration.
"""
    if len(points) != 4 or any(len(row) != 4 for row in points):
        raise ValidationHarnessError("请为四帧分别填写握点 X/Y 和刀尖 X/Y")
    try:
        rows = [[float(v) for v in row] for row in points]
    except (ValueError, TypeError) as exc:
        raise ValidationHarnessError("武器坐标必须是数字；无法辨认时请先手工修补") from exc
    if any(not math.isfinite(v) or not 0 <= v < size for row in rows for v in row):
        raise ValidationHarnessError("武器坐标必须位于画布内")
    vectors = [(r[2] - r[0], r[3] - r[1]) for r in rows]
    lengths = [math.hypot(*v) for v in vectors]
    if min(lengths) < 3:
        raise ValidationHarnessError("握点与刀尖太近，无法可靠判断朝向；请检查标注")
    deltas = [math.degrees(math.atan2(a[0]*b[1]-a[1]*b[0], a[0]*b[0]+a[1]*b[1]))
              for a, b in zip(vectors, vectors[1:])]
    problems = []
    if segment != 2 and any(abs(v) > 85 for v in deltas):
        problems.append("非挥刀阶段出现超过 85° 的相邻朝向跳变")
    significant = [v for v in deltas if abs(v) > 15]
    if any(a*b < 0 for a, b in zip(significant, significant[1:])):
        problems.append("刀的转动方向在片段内反复改变，可能出现提前挥刀或再次蓄力")
    if max(lengths) / min(lengths) > 1.6:
        problems.append("武器投影长度变化超过 60%，请检查刀尖标注、透视或武器变形")
    if any(math.hypot(b[0]-a[0], b[1]-a[1]) > size * .25 for a, b in zip(rows, rows[1:])):
        problems.append("握点在相邻帧间移动超过画布的四分之一")
    return problems


class AttackPlans:
    def __init__(self, service: Any):
        self.service = service
        self.root = service.settings.data_root / "attack_plans"

    def directory(self, plan_id: str) -> Path:
        if not re.fullmatch(r"[0-9a-f]{32}", str(plan_id)):
            raise ValidationHarnessError("请选择已保存的攻击方案")
        return self.root / plan_id

    def load(self, plan_id: str) -> dict:
        plan = read_json(self.directory(plan_id) / "plan.json")
        # Fail closed if the ledger is damaged. Never recreate a missing ledger.
        attempts = plan["attempts"]
        if (plan["plan_id"] != plan_id or plan["schema_version"] != 1
                or not 5 <= plan["max_submissions"] <= 7 or len(attempts) > plan["max_submissions"]
                or any(sum(a["segment"] == i for a in attempts) > 2 for i in range(5))):
            raise ValidationHarnessError("攻击方案次数记录损坏，已停止生成")
        return plan

    def save(self, plan: dict) -> None:
        atomic_write_json(self.directory(plan["plan_id"]) / "plan.json", plan)

    def lock(self, plan_id: str):
        self.directory(plan_id)
        return self.service.store.global_lock(f"attack-{plan_id}", timeout_seconds=180)

    def list_plans(self) -> list[dict]:
        if not self.root.exists():
            return []
        return [self.load(p.parent.name) for p in sorted(self.root.glob("*/plan.json"), reverse=True)]

    def create(self, character_id: str, keyframes: list[str | Path], *, max_submissions: int = 7) -> dict:
        if type(max_submissions) is not int or not 5 <= max_submissions <= 7 or len(keyframes) != 5:
            raise ValidationHarnessError("需要五张结束姿势；总次数上限只能为 5、6 或 7")
        character, preset_path = self.service.presets.load_character(character_id)
        action, _ = self.service.presets.load_action("attack")
        if action.frame_count != 16 or action.loop:
            raise ValidationHarnessError("受约束攻击要求项目攻击规格为 16 帧、不循环")
        paths = [preset_path.parent / character.reference_frame, *map(Path, keyframes)]
        payloads = []
        for path in paths:
            if path.stat().st_size > 20 * 1024 * 1024:
                raise ValidationHarnessError("关键姿势图片过大")
            self.service._validate_reference_image(path, character.cell_width, character.cell_height)
            with Image.open(path) as opened:
                if opened.format != "PNG":
                    raise ValidationHarnessError("关键姿势必须是透明 PNG")
            payloads.append(path.read_bytes())
        hashes = [hashlib.sha256(p).hexdigest() for p in payloads]
        fingerprint = hashlib.sha256(json.dumps({"character": character.model_dump(mode="json"),
            "action": action.model_dump(mode="json"), "anchors": hashes}, sort_keys=True).encode()).hexdigest()
        with self.service.store.global_lock("attack-plan-creation"):
            for old in self.list_plans():
                if old["fingerprint"] == fingerprint:
                    if old["max_submissions"] != max_submissions:
                        raise ConflictError("相同方案已锁定次数上限，不能通过重新创建增加次数")
                    return old
                if old["character_id"] == character_id and old["status"] == "active":
                    raise ConflictError("这个角色已有未完成的攻击方案，请先继续或停止旧方案")
            plan_id = uuid.uuid4().hex
            directory = self.directory(plan_id)
            directory.mkdir(parents=True)
            for i, payload in enumerate(payloads):
                self.service._atomic_write_bytes(directory / f"anchor_{i}.png", payload)
            plan = {"schema_version": 1, "plan_id": plan_id, "character_id": character_id,
                "character_name": character.display_name, "size": character.cell_width,
                "facing": character.facing, "fingerprint": fingerprint, "anchors": hashes,
                "character_snapshot": character.model_dump(mode="json"), "action_snapshot": action.model_dump(mode="json"),
                "status": "active", "max_submissions": max_submissions, "attempts": [],
                "accepted": {}, "output_job_id": None}
            self.save(plan)
            return plan

    def validate_contract(self, plan: dict) -> None:
        character, _ = self.service.presets.load_character(plan["character_id"])
        action, _ = self.service.presets.load_action("attack")
        if (character.model_dump(mode="json") != plan["character_snapshot"]
                or action.model_dump(mode="json") != plan["action_snapshot"]):
            raise ConflictError("角色或攻击规格已变化，请先恢复已锁定的规格；不会自动生成")

    def anchor(self, plan: dict, index: int) -> Path:
        path = self.directory(plan["plan_id"]) / f"anchor_{index}.png"
        if sha256_file(path) != plan["anchors"][index]:
            raise ValidationHarnessError("已确认关键姿势发生变化，已停止提交")
        return path

    @staticmethod
    def latest(plan: dict, segment: int) -> dict | None:
        return next((a for a in reversed(plan["attempts"]) if a["segment"] == segment), None)

    def generation_inputs(self, request: GenerationRequest) -> tuple[bytes, bytes, str]:
        binding = request.attack_segment
        if binding is None:
            raise ValidationHarnessError("缺少攻击片段绑定")
        plan = self.load(binding.plan_id)
        self.validate_contract(plan)
        attempt = self.latest(plan, binding.segment_index)
        if (plan["status"] != "active" or attempt is None or attempt["attempt"] != binding.attempt
                or attempt["request_key"] != request.request_key or attempt["seed"] != request.seed
                or request.character_id != plan["character_id"] or request.action_id != "attack"
                or request.provider != "pixellab" or request.candidate_count != 1
                or request.frame_count != 4 or request.loop is not False
                or request.action_description is not None):
            raise ConflictError("片段不属于当前已预留的生成次数，禁止提交")
        i = binding.segment_index
        prompt = (f"4-frame grounded pixel-art transition, facing {plan['facing']}. " + PHASE_PROMPTS[i]
            + " Match the supplied start and end poses. Preserve sword grip, blade direction, shape,"
              " character identity, scale and canvas. Fixed camera; transparent background. No extra action.")
        return self.anchor(plan, i).read_bytes(), self.anchor(plan, i+1).read_bytes(), prompt

    def submit(self, plan_id: str, segment: int, *, retry: bool = False, reason: str = "") -> dict:
        if type(segment) is not int or segment not in range(5):
            raise ValidationHarnessError("无效片段")
        with self.lock(plan_id):
            plan = self.load(plan_id)
            if plan["status"] != "active":
                raise ConflictError("方案已结束，不能继续付费生成")
            if str(segment) in plan["accepted"]:
                raise ConflictError("已采用片段已锁定，不重复生成")
            if any(str(i) not in plan["accepted"] for i in range(segment)):
                raise ConflictError("请先检查并采用前面的片段，再继续生成")
            current = self.latest(plan, segment)
            for previous in plan["attempts"]:
                if previous.get("job_id"):
                    candidate = self.service.get_job(previous["job_id"]).candidates[0]
                    if candidate.status.value in BUSY and (previous is not current or retry):
                        raise ConflictError("已有生成未结束或提交结果未知；请先取回结果，不会再次提交")
            if current and not retry:
                pass  # Resume this exact reservation, including after a creation crash.
            else:
                if retry:
                    if not current or not current.get("job_id") or not reason.strip():
                        raise ValidationHarnessError("补做前请填写已发现的问题")
                    old = self.service.get_job(current["job_id"]).candidates[0]
                    if old.status.value == "created" or old.status.value in BUSY:
                        raise ConflictError("已有请求尚未完成，不能补做")
                    extras = len(plan["attempts"]) - len({a["segment"] for a in plan["attempts"]})
                    if current["attempt"] >= 2 or extras >= plan["max_submissions"] - 5:
                        raise ConflictError("补做次数已用完。保留现有结果，请手工修补或停止方案")
                if len(plan["attempts"]) >= plan["max_submissions"]:
                    raise ConflictError("总生成次数已用完，已停止付费生成")
                current = {"segment": segment, "attempt": (current["attempt"]+1 if current else 1),
                    "seed": secrets.randbelow(2**31-2)+1, "job_id": None,
                    "request_key": f"attack-{plan_id}-{segment}-{2 if retry else 1}", "reason": reason.strip()[:2000]}
                plan["attempts"].append(current)
                self.save(plan)  # Reserve BEFORE any task creation or external call. Never refund.
            job = self.service.create_job(GenerationRequest(character_id=plan["character_id"],
                action_id="attack", provider="pixellab", frame_count=4, loop=False,
                request_key=current["request_key"], seed=current["seed"],
                attack_segment={"plan_id": plan_id, "segment_index": segment, "attempt": current["attempt"]}))
            current["job_id"] = job.job_id
            self.save(plan)
            self.service.generate_job(job.job_id, wait=False)
            return self.load(plan_id)

    def refresh(self, plan_id: str, segment: int) -> dict:
        # No generate_job here: refresh must never submit even a reserved created job.
        with self.lock(plan_id):
            plan = self.load(plan_id)
            attempt = self.latest(plan, segment)
            if attempt and attempt.get("job_id"):
                job = self.service.get_job(attempt["job_id"])
                candidate = job.candidates[0]
                if candidate.status.value in {"provider_pending", "saving"} and candidate.provider_job_id:
                    from .providers import get_provider
                    provider = get_provider(job.request.provider, self.service.settings)
                    self.service._poll_candidate(job.job_id, 1, provider, wait=False)
            return self.load(plan_id)

    def frames(self, plan: dict, segment: int) -> tuple[str, list[Path]]:
        attempt = self.latest(plan, segment)
        if not attempt or not attempt.get("job_id"):
            raise ConflictError("本片段还没有生成结果")
        job = self.service.get_job(attempt["job_id"])
        candidate = job.candidates[0]
        if len(candidate.frames) != 4 or candidate.status.value in BUSY | {"created", "failed"}:
            raise ConflictError("需要完整的四帧结果；帧数异常时停止检查，保留全部原始返回帧")
        paths = [self.service.store.job_dir(job.job_id) / f.active_path for f in candidate.frames]
        # Provider references are guides; project endpoints are exact local anchors.
        paths[0], paths[3] = self.anchor(plan, segment), self.anchor(plan, segment+1)
        for path in paths:
            self.service._validate_reference_image(path, plan["size"], plan["size"])
        return job.job_id, paths

    def review_token(self, plan: dict, segment: int) -> str:
        job_id, paths = self.frames(plan, segment)
        return hashlib.sha256((job_id + ''.join(sha256_file(p) for p in paths)).encode()).hexdigest()

    def accept(self, plan_id: str, segment: int, *, token: str, points: list[list[float]],
               phase_confirmed: bool, reviewer: str = "web_user") -> dict:
        with self.lock(plan_id):
            plan = self.load(plan_id)
            if plan["status"] != "active" or not phase_confirmed:
                raise ConflictError("请确认动作阶段、握持关系和拼接边界均正确后再采用")
            if any(str(i) not in plan["accepted"] for i in range(segment)):
                raise ConflictError("请按顺序检查片段")
            if str(segment) in plan["accepted"]:
                if token == plan["accepted"][str(segment)]["token"]:
                    return plan
                raise ConflictError("已采用片段已锁定，不能用新结果覆盖")
            if token != self.review_token(plan, segment):
                raise ConflictError("画面已更新，请重新打开并检查，旧标注不能用于新结果")
            problems = trajectory_check(points, segment, plan["size"])
            if problems:
                raise ValidationHarnessError("；".join(problems))
            # The same shared anchor must use the same directed grip/tip labels.
            if segment and str(segment-1) in plan["accepted"]:
                previous = plan["accepted"][str(segment-1)]["points"][-1]
                if any(abs(float(a)-float(b)) > 2 for a, b in zip(previous, points[0])):
                    raise ValidationHarnessError("共享关键姿势的握点/刀尖标注不一致，请检查方向")
            job_id, paths = self.frames(plan, segment)
            checked_job = self.service.get_job(job_id)
            candidate = checked_job.candidates[0]
            self.service._assert_qa_current(job_id, checked_job, candidate)
            if candidate.diagnostic_only:
                raise ConflictError("离线示例不能作为正式攻击素材")
            # Freeze reviewed bytes. Later edits to child jobs cannot alter accepted segments.
            accepted_dir = self.directory(plan_id) / f"accepted_{segment}_{token[:16]}"
            accepted_dir.mkdir(exist_ok=True)
            hashes = []
            for i, path in enumerate(paths):
                payload = path.read_bytes()
                digest = hashlib.sha256(payload).hexdigest()
                destination = accepted_dir / f"frame_{i}.png"
                if destination.exists() and sha256_file(destination) != digest:
                    raise ConflictError("采用快照已存在且内容不同")
                self.service._atomic_write_bytes(destination, payload)
                hashes.append(digest)
            if hashlib.sha256((job_id + ''.join(hashes)).encode()).hexdigest() != token:
                raise ConflictError("保存检查结果时画面发生变化，请重新检查")
            plan["accepted"][str(segment)] = {"directory": accepted_dir.name,
                "hashes": hashes, "points": points, "job_id": job_id,
                "token": token, "reviewer": reviewer, "phase_confirmed": True}
            self.save(plan)
            return plan

    def assemble(self, plan_id: str) -> dict:
        with self.lock(plan_id):
            plan = self.load(plan_id)
            if plan["output_job_id"]:
                return plan
            if plan["status"] != "active" or len(plan["accepted"]) != 5:
                raise ConflictError("五个片段全部检查并采用后才能合成")
            self.validate_contract(plan)
            directory = self.directory(plan_id)
            output = directory / "assembled"
            output.mkdir(exist_ok=True)
            for segment in range(5):
                accepted = plan["accepted"][str(segment)]
                for local_index in range(4):
                    source = directory / accepted["directory"] / f"frame_{local_index}.png"
                    if sha256_file(source) != accepted["hashes"][local_index]:
                        raise ValidationHarnessError("已采用片段快照发生变化，停止合成")
                    if segment and local_index == 0:
                        continue
                    index = segment*3 + local_index
                    self.service._atomic_write_bytes(output / f"frame_{index:03d}.png", source.read_bytes())
            # Exact 16-frame project contract, shared endpoints appear only once.
            job = self.service.create_job(GenerationRequest(character_id=plan["character_id"], action_id="attack",
                provider="import", request_key=f"attack-assembly-{plan_id}"))
            if job.candidates[0].status.value == "created":
                self.service.ingest_candidate(job.job_id, 1, output, source_kind="sequence")
            atomic_write_json(self.service.store.job_dir(job.job_id) / "provider" / "attack_plan.json", plan)
            plan["output_job_id"] = job.job_id
            plan["status"] = "complete"
            self.save(plan)
            return plan

    def apply_hold_policy(self, job: Any, report: dict) -> None:
        """Only this confirmed workflow permits a hold in its charging interval."""
        allowed = set()
        binding = job.request.attack_segment
        if binding and binding.segment_index == 1:
            self.load(binding.plan_id)
            allowed = set(range(4))
        key = job.request.request_key or ""
        if key.startswith("attack-assembly-") and job.action.action_id == "attack":
            plan = self.load(key.removeprefix("attack-assembly-"))
            if (len(plan["accepted"]) == 5 and job.request.character_id == plan["character_id"]
                    and job.action.model_dump(mode="json") == plan["action_snapshot"]):
                allowed = set(range(3,7))
        if not allowed:
            return
        for issue in list(report.get("hard_failures", [])):
            indices = issue.get("frame_indices", [])
            if issue.get("code") != "consecutive_duplicate_frames" or not indices or not set(indices) <= allowed:
                continue
            report["hard_failures"].remove(issue)
            report["warnings"].append({**issue, "code": "intentional_charge_hold",
                "message": "蓄力阶段的静止姿势：请确认停顿节奏符合预期。"})
            for frame in report.get("frames", []):
                if frame.get("index") in indices:
                    frame["hard_failures"] = [c for c in frame["hard_failures"] if c != "consecutive_duplicate_frames"]
                    frame["warnings"].append("intentional_charge_hold")
        report["summary"]["hard_failure_count"] = len(report["hard_failures"])
        report["summary"]["warning_count"] = len(report["warnings"])

    def stop(self, plan_id: str) -> dict:
        with self.lock(plan_id):
            plan = self.load(plan_id)
            if plan["status"] == "active":
                plan["status"] = "stopped"
                self.save(plan)
            return plan
