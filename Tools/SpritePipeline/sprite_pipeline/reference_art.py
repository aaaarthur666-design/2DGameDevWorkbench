"""Workbench PixelLab reference images, sharing the animation service's credentials.

The Node workbench owns durable tasks and output files. This narrow gateway never
exports a key and never retries a chargeable submission. See PixelLab v2 OpenAPI.
"""

from __future__ import annotations

import base64
import binascii
import io
import hashlib
import re
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter
from PIL import Image
from pydantic import BaseModel, ConfigDict, Field

from .errors import ProviderConfigurationError, ProviderError, ProviderPermanentError, ValidationHarnessError
from .jsonio import atomic_write_json, read_json
from .pixellab_account import PixelLabAccountQueue, PixelLabQueued, require_balance
from .service import SpritePipelineService
from . import prop_reference
from .pixel_prop_gateway import conversion


class ReferenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt: str = Field(min_length=1, max_length=2000)
    facing: Literal["right", "left"] = "right"
    seed: int | None = Field(default=None, ge=0, le=2147483647)
    size: Literal[64, 128] = 128
    requestKey: str | None = Field(default=None, pattern=r'^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$')


class PropTransferRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sourceTaskId: str = Field(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$")
    identityDescription: str = Field(default="", max_length=1000)
    confirmation: 'PropConfirmation | None' = None


class PropConfirmation(BaseModel):
    model_config = ConfigDict(extra='forbid')
    note: str = Field(min_length=4, max_length=1000)


class PropConvertRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    sourceTaskId: str | None = Field(default=None, pattern=r'^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$')
    sourceImagePath: str | None = Field(default=None, min_length=1, max_length=1000)
    sourceImage: str | None = Field(default=None, max_length=40_000_100)
    recipe: dict = Field(default_factory=dict)


class KeyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    apiKey: str = Field(min_length=8, max_length=4096)


class ImportRequest(ReferenceRequest):
    prompt: str = Field(min_length=1, max_length=1000)
    image: str = Field(min_length=1, max_length=2_000_000)
    reuseIdentity: bool = False
    characterId: str = Field(pattern=r"^reference_[a-f0-9]{24}$")
    name: str = Field(min_length=1, max_length=80)


class AttachReferenceRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    providerJobId: str = Field(pattern=r'^[A-Za-z0-9_-]{1,200}$')


def _provider_request(service: SpritePipelineService, method: str, route: str, payload=None):
    key = service.settings.pixellab_api_key
    if not key:
        raise ProviderConfigurationError("请先在原图或序列帧设置中保存 PixelLab API Key。")
    base = service.settings.pixellab_base_url.rstrip("/")
    parsed = urlparse(base)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or (
        parsed.scheme != "https" and not (
            parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
        )
    ):
        raise ProviderConfigurationError("PixelLab 地址必须使用 HTTPS；本机测试可用 HTTP。")
    api_root = base if base.endswith("/v2") else base + "/v2"
    try:
        with httpx.Client(timeout=60, follow_redirects=False) as client:
            with client.stream(method, api_root + route, json=payload,
                               headers={"Authorization": f"Bearer {key}"}) as response:
                if response.status_code >= 300:
                    messages = {401: "PixelLab Key 无效。", 402: "PixelLab 额度不足。",
                                429: "PixelLab 当前任务过多，请稍后再试。", 404: "PixelLab 任务不存在或已过期。"}
                    raise ProviderPermanentError(messages.get(response.status_code, f"PixelLab 返回 HTTP {response.status_code}。"), details={
                        'http_status': response.status_code,
                        'submission_created': False if method == 'POST' and response.status_code < 500 else None,
                        'submission_unknown': method == 'POST' and response.status_code >= 500,
                    })
                chunks = []
                total = 0
                for chunk in response.iter_bytes():
                    total += len(chunk)
                    if total > 2_000_000:
                        raise ProviderPermanentError("PixelLab 响应超过大小限制。")
                    chunks.append(chunk)
                import json
                data = json.loads(b"".join(chunks))
                if not isinstance(data, dict):
                    raise ValueError("Expected object")
                return data
    except (httpx.HTTPError, ValueError) as exc:
        # Never echo upstream bodies, URLs or exception text: they may contain secrets.
        message = ("提交结果无法确认，未自动重试。请检查 PixelLab 账户任务后再决定是否重新生成。"
                   if method == "POST" else "PixelLab 状态读取失败，可继续查询同一个任务。")
        raise ProviderPermanentError(message, details={'submission_unknown': method == 'POST'}) from exc


def validate_reference_image(encoded: str, expected_size: int | None = None) -> bytes:
    if encoded.startswith("data:"):
        if not encoded.startswith("data:image/png;base64,"):
            raise ValidationHarnessError("原图必须是 PNG。")
        encoded = encoded.split(",", 1)[1]
    try:
        data = base64.b64decode(encoded, validate=True)
        if len(data) > 1_000_000:
            raise ValueError("oversize")
        with Image.open(io.BytesIO(data)) as image:
            if image.format != "PNG" or (image.size not in ((64, 64), (128, 128)) or (expected_size is not None and image.size != (expected_size, expected_size))):
                raise ValueError("size or format")
            image.load()
            if "A" not in image.getbands() and "transparency" not in image.info:
                raise ValueError("missing alpha")
            alpha = image.convert("RGBA").getchannel("A")
            if alpha.getbbox() is None or alpha.getextrema()[0] == 255:
                raise ValueError("empty or opaque")
        return data
    except (ValueError, binascii.Error, OSError) as exc:
        raise ValidationHarnessError("原图需要是 64×64 或 128×128、含角色且带透明背景的 PNG；请重新生成或使用其他图片。") from exc


def create_reference_router(service: SpritePipelineService) -> APIRouter:
    router = APIRouter(prefix="/v1/reference-art")
    import_lock = threading.Lock()

    def record_path(job_id):
        return service.settings.jobs_dir / '.reference-art' / (job_id + '.json')

    def account():
        if not service.settings.pixellab_api_key:
            raise ProviderConfigurationError('请先在原图或序列帧设置中保存 PixelLab API Key。')
        return PixelLabAccountQueue(service.store, service.settings.pixellab_api_key, service.settings.pixellab_base_url)

    def balance_preflight():
        raw = _provider_request(service, 'GET', '/balance')
        # Only numeric quota fields are evidence. Never persist arbitrary upstream strings.
        subscription = raw.get('subscription')
        safe = {'subscription': {key: value for key, value in (subscription.items() if isinstance(subscription, dict) else [])
                                 if key in {'generations', 'remaining', 'remaining_generations', 'generations_remaining'}
                                 and isinstance(value, (int, float)) and not isinstance(value, bool)}}
        return require_balance(safe)

    def submit_record(record):
        data = _provider_request(service, 'POST', '/create-image-pixflux-background', record['payload'])
        job_id = data.get('background_job_id')
        if not isinstance(job_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', job_id):
            raise ProviderPermanentError('PixelLab 未返回有效任务 ID，未自动重试。', details={'submission_unknown': True})
        return job_id

    def advance(job_id, *, submit_only=False):
        destination = record_path(job_id)
        with service.store.global_lock('reference-job-' + job_id, timeout_seconds=180):
            record = read_json(destination)
            queue = account() if record['status'] in {'queued', 'running'} else None
            if record['status'] == 'queued':
                try:
                    receipt = queue.receipt(record['requestKey'])
                    if receipt and receipt.get('provider_job_id'):
                        remote, balance = receipt['provider_job_id'], record.get('balance', {})
                    else:
                        remote, balance = queue.submit(record['requestKey'],
                            lambda remote: _provider_request(service, 'GET', '/background-jobs/' + remote).get('status'),
                            balance_preflight, lambda: submit_record(record), lambda remote: remote)
                    record.update(status='running', remoteJobId=remote, submissionState='submitted', balance=balance)
                except PixelLabQueued as exc:
                    record.update(submissionState='queued', queuePosition=exc.details['queue_position'], message=exc.message)
                except ProviderError as exc:
                    unknown = bool(exc.details.get('submission_unknown'))
                    record.update(status='attention_required' if unknown else 'not_submitted',
                        submissionState='unknown' if unknown else 'not_submitted', error=exc.as_dict(), message=exc.message)
                atomic_write_json(destination, record)
                return public_record(record)
            if record['status'] == 'running' and not submit_only:
                try:
                    data = _provider_request(service, 'GET', '/background-jobs/' + record['remoteJobId'])
                except ProviderPermanentError as exc:
                    if exc.details.get('http_status') == 404:
                        queue.release(record['requestKey'], state='failed')
                        record.update(status='failed', message=exc.message, error=exc.as_dict())
                        atomic_write_json(destination, record)
                        return public_record(record)
                    raise
                state = data.get('status')
                if data.get('id') != record['remoteJobId']:
                    raise ProviderPermanentError('PixelLab 返回了不匹配的任务。')
                if state in {'completed', 'failed'}:
                    queue.release(record['requestKey'], state=state)
                if state == 'failed':
                    record.update(status='failed', message='PixelLab 原图生成失败。')
                elif state == 'completed':
                    result = data.get('last_response')
                    encoded = result.get('image', {}).get('base64') if isinstance(result, dict) and isinstance(result.get('image'), dict) else None
                    try:
                        image = validate_reference_image(encoded, record['input']['size']) if isinstance(encoded, str) else None
                        if image is None:
                            raise ValidationHarnessError('PixelLab 已结束任务，但没有返回原图。')
                        record.update(status='completed', image=base64.b64encode(image).decode('ascii'))
                    except ValidationHarnessError as exc:
                        record.update(status='failed', message=str(exc))
                elif state != 'processing':
                    raise ProviderPermanentError('PixelLab 返回了未知任务状态。')
                atomic_write_json(destination, record)
        if record['status'] == 'completed':
            from .reference_orientation import start_orientation_review
            image = base64.b64decode(record['image'])
            try:
                review = start_orientation_review(service, destination, image, record['input']['facing'])
            except Exception as exc:
                # A missing/broken reviewer must not hide a successfully generated image.
                review = {'state': 'uncertain', 'matches': False, 'sourceSha256': hashlib.sha256(image).hexdigest(),
                    'expectedView': 'side', 'expectedFacing': record['input']['facing'], 'errorType': type(exc).__name__,
                    'message': '视觉检查配置或启动失败，视角与朝向尚未验证；原图已保留，请人工核对。'}
                with service.store.global_lock('reference-review-' + destination.stem):
                    latest = read_json(destination); latest['orientationReview'] = review; atomic_write_json(destination, latest)
            record['orientationReview'] = review
        return public_record(record)

    def public_record(record):
        return {key: record[key] for key in ('status', 'submissionState', 'remoteJobId', 'queuePosition', 'balance',
            'message', 'image', 'orientationReview', 'error') if key in record} | {'jobId': record['id']}

    @router.get("/settings")
    def settings():
        return {"configured": bool(service.settings.pixellab_api_key), "model": "pixflux", "size": 128}

    @router.post("/settings")
    def save_settings(body: KeyRequest):
        service.configure_pixellab_api_key(body.apiKey)
        return settings()

    @router.post("/jobs", status_code=202)
    def generate(body: ReferenceRequest):
        if not body.prompt.strip():
            raise ValidationHarnessError("请输入角色描述。")
        payload = {"description": body.prompt.strip(), "image_size": {"width": body.size, "height": body.size},
                   "no_background": True, "view": "side", "direction": "east" if body.facing == "right" else "west"}
        if body.seed is not None:
            payload["seed"] = body.seed
        account()  # Configuration failures do not create a provider request.
        identity = body.requestKey or uuid.uuid4().hex
        job_id = 'ref_' + hashlib.sha256(identity.encode()).hexdigest()[:32]
        destination = record_path(job_id)
        with service.store.global_lock('reference-job-' + job_id):
            if destination.exists():
                saved = read_json(destination)
                if saved['payload'] != payload:
                    raise ValidationHarnessError('相同原图请求身份不能改用不同内容。')
            else:
                atomic_write_json(destination, {'version': 1, 'id': job_id, 'requestKey': 'reference:' + identity,
                    'status': 'queued', 'submissionState': 'queued', 'payload': payload,
                    'input': body.model_dump(exclude={'requestKey'})})
        return advance(job_id, submit_only=True)

    @router.get("/jobs/{job_id}")
    def status(job_id: str):
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", job_id):
            raise ValidationHarnessError("无效的任务 ID。")
        if record_path(job_id).exists():
            return advance(job_id)
        data = _provider_request(service, "GET", "/background-jobs/" + job_id)
        state = data.get("status")
        if data.get("id") != job_id:
            raise ProviderPermanentError("PixelLab 返回了不匹配的任务。")
        if state == "failed":
            return {"status": "failed", "error": "PixelLab 原图生成失败。"}
        if state == "processing":
            return {"status": "running"}
        if state != "completed":
            raise ProviderPermanentError("PixelLab 返回了未知任务状态。")
        result = data.get("last_response")
        encoded = result.get("image", {}).get("base64") if isinstance(result, dict) and isinstance(result.get("image"), dict) else None
        if not isinstance(encoded, str):
            return {"status": "failed", "error": "PixelLab 已结束任务，但没有返回原图。"}
        try:
            image = validate_reference_image(encoded)
        except ValidationHarnessError as exc:
            return {"status": "failed", "error": str(exc)}
        return {"status": "completed", "image": base64.b64encode(image).decode("ascii")}

    def recover_pending():
        directory = service.settings.jobs_dir / '.reference-art'
        for destination in directory.glob('ref_*.json'):
            try:
                record = read_json(destination)
                if record['status'] in {'queued', 'running'} or (record.get('orientationReview') or {}).get('state') == 'checking':
                    advance(record['id'])
            except Exception:
                # Original job/queue evidence remains; a GET failure cannot replay a POST.
                continue
    service.reference_art_recovery = recover_pending

    @router.post('/jobs/{job_id}/attach-provider-job')
    def attach_reference(job_id: str, body: AttachReferenceRequest):
        if not re.fullmatch(r'ref_[a-f0-9]{32}', job_id) or not record_path(job_id).exists():
            raise ValidationHarnessError('原图请求身份不存在。')
        with service.store.global_lock('reference-job-' + job_id):
            record = read_json(record_path(job_id))
            if record['status'] != 'attention_required' or record.get('submissionState') != 'unknown':
                raise ValidationHarnessError('此原图请求不处于未知提交状态。')
            account().attach(record['requestKey'], body.providerJobId)
            record.update(status='running', submissionState='submitted', remoteJobId=body.providerJobId)
            atomic_write_json(record_path(job_id), record)
        return public_record(record)

    @router.post("/transfer-prop")
    def transfer_prop(body: PropTransferRequest):
        identity = prop_reference.transfer(service, body.sourceTaskId, body.identityDescription.strip(),
                                           body.confirmation.model_dump() if body.confirmation else None)
        return {"objectId": identity, "objectType": "interactable"}

    def convert_prop(body: PropConvertRequest):
        result, provenance = conversion(service, body.model_dump(exclude_none=True))
        return {'image': base64.b64encode(result.png).decode('ascii'),
                'compare': base64.b64encode(result.compare).decode('ascii'),
                'report': result.report, 'provenance': provenance}

    router.add_api_route('/convert-prop', convert_prop, methods=['POST'])
    router.add_api_route('/convert-prop/preview', convert_prop, methods=['POST'])

    @router.post("/import")
    def import_reference(body: ImportRequest):
        image = validate_reference_image(body.image, body.size)
        with import_lock, service.store.global_lock("reference-preset-" + body.characterId), tempfile.TemporaryDirectory(prefix="reference-import-") as directory:
            identity = body.prompt
            if body.reuseIdentity and service.presets.character_exists(body.characterId):
                existing, _ = service.presets.load_character(body.characterId)
                identity = existing.identity_description
            source = Path(directory) / "reference.png"
            source.write_bytes(image)
            preset = service.create_character_preset(
                display_name=body.name, reference_image=source, facing=body.facing,
                identity_description=identity, character_id=body.characterId, reuse_if_identical=True,
            )
        return {"characterId": preset.character_id}

    return router
