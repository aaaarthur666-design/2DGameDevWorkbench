"""One bounded visual check of the actual generated reference, never a retry."""
from __future__ import annotations

import base64
import hashlib
import threading
import uuid
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .jsonio import atomic_write_json, read_json

_workers = {}
_workers_lock = threading.Lock()


class OrientationObservation(BaseModel):
    model_config = ConfigDict(extra='forbid')
    view: Literal['side', 'three_quarter', 'front', 'back', 'uncertain']
    facing: Literal['left', 'right', 'uncertain']
    confidence: Literal['confident', 'uncertain']
    evidence: str = Field(min_length=4, max_length=500)


def start_orientation_review(service, record_path, image, facing):
    """Persist intent before dispatch; restarting a sent check cannot resend it."""
    key = str(record_path)
    with _workers_lock, service.store.global_lock('reference-review-' + record_path.stem):
        record = read_json(record_path)
        review = record.get('orientationReview')
        if review:
            if review['state'] == 'checking' and key not in _workers:
                review.update(state='uncertain', matches=False, message='视角检查曾被中断，结论未知；未自动重复调用，请人工核对。')
                atomic_write_json(record_path, record)
            return review
        sha = hashlib.sha256(image).hexdigest()
        from .collaboration.model_config import ModelRegistry
        registry = ModelRegistry(service.settings)
        profile = registry.profile('reviewer')
        review = {'state': 'checking', 'matches': False, 'expectedView': 'side', 'expectedFacing': facing,
                  'sourceSha256': sha, 'provider': profile.provider, 'model': profile.model,
                  'requestId': uuid.uuid4().hex, 'startedAt': datetime.now(timezone.utc).isoformat(),
                  'profile': profile.model_dump(mode='json'), 'maximumCalls': 1,
                  'message': '正在检查实际原图的侧视角与朝向。'}
        if not registry.key(profile.provider):
            review.update(state='unavailable', message='未配置视觉检查服务，视角与朝向尚未验证；移送前请人工核对。')
            record['orientationReview'] = review
            atomic_write_json(record_path, record)
            return review
        snapshot = {'version': 1, 'default': profile.model_dump(mode='json'), 'roles': {}}
        record['orientationReview'] = review
        atomic_write_json(record_path, record)

        def save_review(fields):
            with service.store.global_lock('reference-review-' + record_path.stem):
                current = read_json(record_path)
                if fields.get('receipt'):
                    fields = {**fields, 'receipt': {**current['orientationReview'].get('receipt', {}), **fields['receipt']}}
                current['orientationReview'].update(fields)
                atomic_write_json(record_path, current)

        def run():
            try:
                content = [{'type': 'input_text', 'text':
                    'Inspect ONLY the actual supplied pixel character image. Determine its visible camera view and '
                    'the character\'s facing direction in image coordinates. A visible back with a turned head is back, '
                    'not side. Three-quarter view is not side. Use uncertain when a small or symmetric sprite does not '
                    'provide clear evidence. Do not infer the result from the requested direction. '
                    'Explain visible face, torso and limb evidence in concise Chinese. Expected side view facing ' + facing + '.'},
                    {'type': 'input_image', 'image_url': 'data:image/png;base64,' + base64.b64encode(image).decode(), 'detail': 'high'}]
                observation, receipt = registry.send('reviewer', content, OrientationObservation, 1, snapshot=snapshot,
                    schema_name='reference_orientation', on_response=lambda evidence: save_review({'receipt': evidence}))
                matches = observation.view == 'side' and observation.facing == facing and observation.confidence == 'confident'
                save_review({'state': 'checked', 'matches': matches, 'observation': observation.model_dump(mode='json'),
                    'receipt': receipt, 'message': '视觉检查观察到侧视角与目标朝向一致；请结合原图采用。' if matches else
                    '视觉检查发现视角、朝向不符或无法确定；移送前必须查看原图并确认。'})
            except Exception as exc:
                # Do not persist exception strings or provider bodies; the known receipt is retained.
                save_review({'state': 'uncertain', 'matches': False,
                    'errorType': type(exc).__name__, 'message': '视角检查未取得可用结论，未自动重试；移送前请人工核对。'})
            finally:
                with _workers_lock:
                    _workers.pop(key, None)

        worker = threading.Thread(target=run, name='reference-orientation-' + record_path.stem, daemon=True)
        _workers[key] = worker
        worker.start()
        return review
