"""Local reference canvas and read-only animation playback endpoints."""
from __future__ import annotations

import base64
import binascii
import hashlib
import io
from pathlib import Path
from typing import Any
from urllib.parse import quote

from PIL import Image
from pydantic import BaseModel, ConfigDict, Field

from .errors import ConflictError, NotFoundError, ValidationHarnessError
from .reference_canvas import ReferenceCanvas


class CanvasBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StartReferenceBody(CanvasBody):
    character_id: str = Field(min_length=1, max_length=200)


class ReferenceVersionBody(CanvasBody):
    base_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class ReferencePixelsBody(ReferenceVersionBody):
    width: int = Field(ge=1, le=128)
    height: int = Field(ge=1, le=128)
    rgba_base64: str = Field(min_length=4, max_length=100_000)
    reviewer: str = Field(default="web_pixel_editor", max_length=100)


def create_canvas_router(service: Any) -> Any:
    from fastapi import APIRouter
    from fastapi.responses import FileResponse, Response

    router = APIRouter()
    canvas = ReferenceCanvas(service)

    def ok(**data: Any) -> dict[str, Any]:
        return {"schema_version": 1, "ok": True, "data": data}

    @router.post("/v1/reference-edits")
    def start(body: StartReferenceBody) -> Any:
        return ok(edit=canvas.start_character(body.character_id))

    @router.get("/v1/reference-edits/{edit_id}/pixel-edit")
    def session(edit_id: str) -> Any:
        return ok(session=canvas.session(edit_id))

    @router.post("/v1/reference-edits/{edit_id}/pixel-edit")
    def save(edit_id: str, body: ReferencePixelsBody) -> Any:
        try:
            rgba = base64.b64decode(body.rgba_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValidationHarnessError("像素数据不是有效的 Base64") from exc
        return ok(edit=canvas.save(edit_id, width=body.width, height=body.height, rgba=rgba, base_sha256=body.base_sha256))

    @router.post("/v1/reference-edits/{edit_id}/transfer")
    def transfer(edit_id: str, body: ReferenceVersionBody) -> Any:
        character = canvas.transfer(edit_id, body.base_sha256)
        return ok(character_id=character.character_id, display_name=character.display_name)

    @router.get("/animation-player", include_in_schema=False)
    def player_page() -> Any:
        return FileResponse(Path(__file__).parent / "static" / "animation_player.html", media_type="text/html", headers={"Cache-Control": "no-store"})

    def candidate_record(job_id: str, candidate_index: int) -> Any:
        job = service.get_job(job_id)
        candidate = next((c for c in job.candidates if c.candidate_index == candidate_index), None)
        if candidate is None or not candidate.frames:
            raise NotFoundError("这份候选还没有可播放的画面")
        return job, candidate

    @router.get("/v1/jobs/{job_id}/candidates/{candidate_index}/playback")
    def playback(job_id: str, candidate_index: int) -> Any:
        job, candidate = candidate_record(job_id, candidate_index)
        prefix = f"/v1/jobs/{quote(job_id, safe='')}/candidates/{candidate_index}/playback/frames"
        return ok(playback={
            "width": job.character.cell_width, "height": job.character.cell_height,
            "fps": job.action.fps, "loop": job.action.loop,
            "frames": [{"index": f.index, "url": f"{prefix}/{f.index}?sha256={f.sha256}"} for f in candidate.frames],
        })

    @router.get("/v1/jobs/{job_id}/candidates/{candidate_index}/playback/frames/{frame_index}")
    def playback_frame(job_id: str, candidate_index: int, frame_index: int, sha256: str) -> Any:
        job, candidate = candidate_record(job_id, candidate_index)
        frame = next((f for f in candidate.frames if f.index == frame_index), None)
        if frame is None:
            raise NotFoundError("当前帧不存在")
        if frame.sha256 != sha256:
            raise ConflictError("动画版本已变化，请刷新当前结果")
        path = service.store.resolve_job_path(job_id, frame.active_path)
        if not path.is_file():
            raise NotFoundError("当前帧文件不存在")
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != sha256:
            raise ConflictError("动画文件已变化，请重新检查当前版本")
        with Image.open(io.BytesIO(data)) as image:
            if image.size != (job.character.cell_width, job.character.cell_height):
                raise ConflictError("动画帧尺寸与当前版本不一致")
        return Response(data, media_type="image/png", headers={"Cache-Control": "no-store"})

    return router
