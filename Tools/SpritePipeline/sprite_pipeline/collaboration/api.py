"""Small local API for the five-stage workspace; GET never creates or submits."""
from __future__ import annotations

import base64
import binascii
import tempfile
from pathlib import Path
from typing import Literal

from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import Field

from ..errors import ConflictError, ValidationHarnessError
from ..models import ExportOptions
from ..vision_review import VisionReviewer, PROVIDERS
from .contracts import Contract, TaskSpec, digest
from .workspace import OpenMotionWorkspace
from .model_config import ModelRegistry, ModelConfiguration


class Create(Contract):
    spec: TaskSpec
    request_key: str = Field(min_length=8, max_length=128)
    planning_authorized: bool = False
    auto_execute: bool = False


class Revision(Contract):
    expected_revision: int = Field(ge=1)


class Revise(Create, Revision):
    pass


class Generate(Revision):
    plan_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class Review(Revision):
    candidate_index: int = Field(ge=1, le=8)
    candidate_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    note: str = Field(min_length=4, max_length=2000)
    acknowledge_warnings: bool = False


class Export(Revision):
    candidate_index: int = Field(ge=1, le=8)


class StageReview(Export):
    stage_index: int = Field(ge=0, le=3)
    token: str = Field(pattern=r'^[0-9a-f]{64}$')
    note: str = Field(min_length=4, max_length=2000)
    decision: Literal['accept', 'reject']
    acknowledge_warnings: bool = False
    anchor_frame: int | None = Field(default=None, ge=0, le=63)
    acknowledge_trim: bool = False


class Recover(Export):
    provider_job_id: str | None = Field(default=None, min_length=6, max_length=200)


class Target(Revision):
    stage_index: int = Field(ge=0, le=3)
    png_base64: str | None = Field(default=None, max_length=2_000_000)
    note: str = Field(min_length=4, max_length=1000)


class Repair(Export):
    stage_index: int = Field(ge=0,le=3)
    token: str = Field(pattern=r'^[0-9a-f]{64}$')
    start: int = Field(ge=0,le=63)
    end: int = Field(ge=0,le=63)
    mode: Literal['appearance','transition']
    note: str = Field(min_length=4,max_length=700)
    request_key: str = Field(min_length=8,max_length=128,pattern=r'^[A-Za-z0-9._:-]+$')
    generation_authorized: bool = False


class RepairReview(Export):
    stage_index: int = Field(ge=0,le=3)
    attempt: int = Field(ge=0,le=1)
    token: str = Field(pattern=r'^[0-9a-f]{64}$')
    note: str = Field(min_length=4,max_length=2000)
    decision: Literal['accept','reject']


class Settings(Contract):
    provider: Literal["hunyuan", "openai"] | None = None
    configuration: ModelConfiguration | None = None
    tokenhub_key: str | None = Field(default=None, max_length=4096)
    openai_key: str | None = Field(default=None, max_length=4096)
    planning_key: str | None = Field(default=None, max_length=4096)
    pixellab_key: str | None = Field(default=None, max_length=4096)


class Reference(Contract):
    display_name: str = Field(min_length=1, max_length=200)
    png_base64: str = Field(min_length=4, max_length=2_000_000)
    facing: Literal["left", "right"] = "right"
    identity_description: str = Field(default="", max_length=1000)


def candidate_digest(candidate):
    return digest([{k: frame.model_dump(mode="json")[k] for k in ("index", "sha256", "active_path")} for frame in candidate.frames])


def create_router(service):
    router = APIRouter(prefix="/v1/open-motion", tags=["Open motion"])
    workspace = OpenMotionWorkspace(service)

    def view(work_id, revision=None):
        result = workspace.view(work_id, revision)
        if result["job"]:
            from .visual_review import review_state
            native = service.store.load(result['job']['job_id'])
            for candidate in result["job"]["candidates"]:
                candidate["review_token"] = digest([{k: f[k] for k in ("index", "sha256", "active_path")} for f in candidate["frames"]])
                if result['plan'].get('quality'):
                    candidate['quality_review'] = review_state(service._candidate(native,candidate['candidate_index']))
        return result

    def current(work_id, revision):
        work = workspace.load(work_id)
        if work.revision != revision or not work.job_id:
            raise ConflictError("当前作品版本已改变，请刷新后继续")
        return work

    @router.get("")
    def listing():
        return {"works": workspace.listing()}

    @router.get("/settings")
    def settings():
        return {**ModelRegistry(service.settings).describe(), "pixellab_configured": bool(service.settings.pixellab_api_key),
                "providers": [{"id": k, "label": v["label"], "model": v["model"]} for k, v in PROVIDERS.items()]}

    @router.post("/settings")
    def configure(body: Settings):
        registry = ModelRegistry(service.settings)
        config = registry.load()
        if body.configuration is not None:
            config = body.configuration
        elif body.provider is not None:
            provider = 'tokenhub' if body.provider == 'hunyuan' else 'openai'
            config.default = config.default.model_copy(update={'provider':provider,'model':PROVIDERS[body.provider]['model']})
        planning_provider = ('tokenhub' if body.provider == 'hunyuan' else 'openai') if body.provider else config.default.provider
        for provider, value in [(planning_provider,body.planning_key),('tokenhub',body.tokenhub_key),('openai',body.openai_key)]:
            registry.validate_key(provider,value)
        if body.planning_key:
            registry.save_key(planning_provider, body.planning_key)
        if body.tokenhub_key: registry.save_key('tokenhub',body.tokenhub_key)
        if body.openai_key: registry.save_key('openai',body.openai_key)
        if body.pixellab_key:
            service.configure_pixellab_api_key(body.pixellab_key)
        registry.save(config)
        return settings()

    @router.get("/references")
    def references():
        return {"characters": service.list_presets()["characters"]}

    @router.get("/references/{character_id}")
    def reference_preview(character_id: str):
        character, path = service.presets.load_character(character_id)
        service._validate_reference_image(path.parent / character.reference_frame, character.cell_width, character.cell_height)
        return Response((path.parent / character.reference_frame).read_bytes(), media_type="image/png", headers={"Cache-Control": "no-store"})

    @router.post("/references")
    def upload(body: Reference):
        try:
            data = base64.b64decode(body.png_base64, validate=True)
        except (ValueError, binascii.Error):
            raise ValidationHarnessError("参考图编码无效") from None
        with tempfile.TemporaryDirectory(prefix="open-motion-", dir=service.settings.data_root) as folder:
            source = Path(folder) / "reference.png"
            source.write_bytes(data)
            character = service.create_character_preset(display_name=body.display_name, reference_image=source,
                        facing=body.facing, identity_description=body.identity_description, reuse_if_identical=True)
        return {"character": character.model_dump(mode="json")}

    @router.post("", status_code=201)
    def create(body: Create):
        work = workspace.create(body.spec, body.request_key, planning_authorized=body.planning_authorized, auto_execute=body.auto_execute)
        return view(work.id)

    @router.get("/{work_id}")
    def get(work_id: str, revision: int | None = None):
        return view(work_id, revision)

    @router.get("/{work_id}/reference")
    def original(work_id: str, revision: int | None = None):
        return Response(workspace.reference(workspace.load(work_id, revision)), media_type="image/png", headers={"Cache-Control": "no-store"})

    @router.post("/{work_id}/revise")
    def revise(work_id: str, body: Revise):
        if body.auto_execute:
            raise ValidationHarnessError("修改后的方案需要重新查看并确认制作")
        workspace.revise(work_id, body.expected_revision, body.spec, body.request_key, planning_authorized=body.planning_authorized)
        return view(work_id)

    @router.post("/{work_id}/generate")
    def generate(work_id: str, body: Generate):
        workspace.start(work_id, body.expected_revision, body.plan_sha256)
        return view(work_id)

    @router.post('/{work_id}/target')
    def target(work_id: str, body: Target):
        from .targets import save_target
        try:
            data = base64.b64decode(body.png_base64,validate=True) if body.png_base64 is not None else None
        except (ValueError,binascii.Error): raise ValidationHarnessError('目标图片编码无效') from None
        save_target(workspace,work_id,body.expected_revision,body.stage_index,data,body.note)
        return view(work_id)

    @router.get('/{work_id}/targets/{stage}')
    def target_image(work_id: str, stage: int, revision: int | None = None):
        work = workspace.load(work_id,revision)
        item = next((t for t in work.end_targets if t.stage == stage),None)
        if not item: raise ValidationHarnessError('尚未绑定目标姿势图片')
        data = (workspace.directory(work_id)/item.filename).read_bytes()
        import hashlib
        if hashlib.sha256(data).hexdigest() != item.sha256: raise ConflictError('目标图片已改变')
        return Response(data,media_type='image/png',headers={'Cache-Control':'no-store'})

    @router.post("/{work_id}/pause")
    def pause(work_id: str, body: Revision):
        workspace.pause(work_id, body.expected_revision)
        return view(work_id)

    @router.post("/{work_id}/resume")
    def resume(work_id: str, body: Revision):
        workspace.pause(work_id, body.expected_revision, resume=True)
        return view(work_id)

    @router.post("/{work_id}/review")
    def review(work_id: str, body: Review):
        with workspace.lock(work_id):
            work = current(work_id, body.expected_revision)
            service.approve_candidate(work.job_id, body.candidate_index, reviewer="open-motion-user",
                acknowledge_warnings=body.acknowledge_warnings, expected_frames=body.candidate_sha256, review_note=body.note)
        return view(work_id)

    @router.get('/{work_id}/candidates/{candidate}/stages/{stage}')
    def stage_view(work_id: str, candidate: int, stage: int, revision: int | None = None):
        from .checkpoints import Checkpoints
        work = workspace.load(work_id,revision)
        if not work.job_id: raise ConflictError('尚无生成片段')
        return Checkpoints(service).view(work.job_id,candidate,stage)

    @router.get('/{work_id}/candidates/{candidate}/stages/{stage}/frames/{frame}')
    def stage_image(work_id: str, candidate: int, stage: int, frame: int, revision: int | None = None):
        data = stage_view(work_id,candidate,stage,revision)
        work = workspace.load(work_id,revision)
        if not 0 <= frame < len(data['frames']): raise ValidationHarnessError('帧索引无效')
        path = service.store.resolve_job_path(work.job_id,data['frames'][frame]['path'])
        return Response(path.read_bytes(),media_type='image/png',headers={'Cache-Control':'no-store'})

    @router.post('/{work_id}/review-stage')
    def review_stage(work_id: str, body: StageReview):
        from .checkpoints import Checkpoints
        with workspace.lock(work_id):
            work = current(work_id,body.expected_revision)
            Checkpoints(service).decide(work.job_id,body.candidate_index,body.stage_index,
                token=body.token,note=body.note,decision=body.decision,acknowledge=body.acknowledge_warnings,
                anchor_frame=body.anchor_frame,acknowledge_trim=body.acknowledge_trim)
        return view(work_id)

    @router.post('/{work_id}/repair-stage')
    def repair_stage(work_id: str, body: Repair):
        from .repairs import LocalRepairs
        from ..providers import get_provider
        with workspace.lock(work_id):
            work=current(work_id,body.expected_revision)
            LocalRepairs(service).create(work.job_id,body.candidate_index,body.stage_index,token=body.token,
                start=body.start,end=body.end,note=body.note,mode=body.mode,request_key=body.request_key,
                authorized=body.generation_authorized,provider=get_provider(work.spec.provider,service.settings))
        return view(work_id)

    @router.post('/{work_id}/review-repair')
    def review_repair(work_id: str, body: RepairReview):
        from .repairs import LocalRepairs
        with workspace.lock(work_id):
            work=current(work_id,body.expected_revision)
            LocalRepairs(service).decide(work.job_id,body.candidate_index,body.stage_index,body.attempt,body.token,body.note,body.decision)
        return view(work_id)

    @router.get('/{work_id}/candidates/{candidate}/stages/{stage}/repairs/{attempt}/frames/{frame}')
    def repair_image(work_id: str,candidate: int,stage: int,attempt: int,frame: int,revision: int | None=None):
        from .repairs import LocalRepairs
        work=workspace.load(work_id,revision)
        if not work.job_id:raise ConflictError('尚无片段')
        job=service.store.load(work.job_id);repairs=LocalRepairs(service);run=repairs.run(job,candidate,stage)
        if not 0<=attempt<len(run.repairs):raise ValidationHarnessError('修复记录不存在')
        frames=run.repairs[attempt].get('proposed_frames',[])
        if not 0<=frame<len(frames):raise ValidationHarnessError('修复预览帧无效')
        data=repairs.read_frames(job.job_id,[frames[frame]])[0]
        return Response(data,media_type='image/png',headers={'Cache-Control':'no-store'})

    @router.post("/{work_id}/recover")
    def recover(work_id: str, body: Recover):
        with workspace.lock(work_id):
            work = current(work_id, body.expected_revision)
            if body.provider_job_id:
                service.attach_provider_job_id(work.job_id, body.candidate_index, body.provider_job_id)
            service.recover_completed_candidate(work.job_id, body.candidate_index)
        return view(work_id)

    @router.get("/{work_id}/progress-image")
    def progress(work_id: str, candidate: int = 1):
        from .execution import PlanGeneration
        work = workspace.load(work_id)
        if work.job_id:
            job = service.store.load(work.job_id)
            current_candidate = service._candidate(job, candidate)
            for index in reversed(range(len(current_candidate.plan_execution.stages))):
                if current_candidate.plan_execution.stages[index].state in {'complete','reviewing','awaiting_review','accepted','rejected'}:
                    data = PlanGeneration(service).saved_frames(work.job_id, candidate, index)[-1]
                    return Response(data, media_type="image/png", headers={"Cache-Control": "no-store"})
        return Response(workspace.reference(work), media_type="image/png", headers={"Cache-Control": "no-store"})

    @router.post("/{work_id}/export")
    def export(work_id: str, body: Export):
        with workspace.lock(work_id):
            work = current(work_id, body.expected_revision)
            # Native exporter allows repeated delivery of the same approved clip.
            service.export_candidate(work.job_id, body.candidate_index, ExportOptions(overwrite=True))
        return view(work_id)

    return router
