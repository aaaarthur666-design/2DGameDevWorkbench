from __future__ import annotations

import base64
import io
import json
import shutil
from pathlib import Path
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from sprite_pipeline.api_app import create_api
from sprite_pipeline import reference_art
from sprite_pipeline.service import SpritePipelineService


def image_base64(size=(128, 128), opaque=False):
    image = Image.new('RGBA', size, (0, 0, 0, 255 if opaque else 0))
    ImageDraw.Draw(image).rectangle((40, 30, 80, 110), fill=(40, 150, 80, 255))
    stream = io.BytesIO()
    image.save(stream, format='PNG')
    return base64.b64encode(stream.getvalue()).decode()


@pytest.fixture
def service(tmp_path, monkeypatch):
    monkeypatch.delenv('PIXELLAB_API_KEY', raising=False)
    monkeypatch.setenv('GRADIO_ANALYTICS_ENABLED', 'False')
    shutil.copytree(Path(__file__).resolve().parents[1] / 'presets', tmp_path / 'presets')
    return SpritePipelineService(tmp_path)


def test_settings_share_animation_credentials_without_echo(service, monkeypatch):
    from sprite_pipeline.credential_store import CredentialStore
    protected = {}
    monkeypatch.setattr(CredentialStore, 'set', lambda self, name, value: protected.update({name: value}))
    monkeypatch.setattr(CredentialStore, 'get', lambda self, name: protected.get(name))
    with TestClient(create_api(service=service)) as client:
        assert client.get('/v1/reference-art/settings').json()['configured'] is False
        response = client.post('/v1/reference-art/settings', json={'apiKey': 'test-shared-secret'})
        assert response.status_code == 200
        assert 'test-shared-secret' not in response.text
        assert service.settings.pixellab_api_key == 'test-shared-secret'
        assert client.get('/health').json()['pixellab_configured'] is True
        service.configure_pixellab_api_key('changed-in-animation')
        assert client.get('/v1/reference-art/settings').json()['configured'] is True
        invalid = client.post('/v1/reference-art/settings', json={'apiKey': 'sekret'})
        assert invalid.status_code == 422 and 'sekret' not in invalid.text


def test_animation_page_refreshes_key_saved_after_ui_startup(service, monkeypatch):
    from sprite_pipeline.credential_store import CredentialStore
    from sprite_pipeline.ui import build_ui
    protected = {}
    monkeypatch.setattr(CredentialStore, 'set', lambda self, name, value: protected.update({name: value}))
    monkeypatch.setattr(CredentialStore, 'get', lambda self, name: protected.get(name))
    ui = build_ui(service=service)
    try:
        callback = next(block for block in ui.fns.values() if getattr(block.fn, '__name__', '') == 'refresh_shared_api_state')
        assert callback.fn()[-1]['interactive'] is False
        with TestClient(create_api(service=service)) as client:
            response = client.post('/v1/reference-art/settings', json={'apiKey': 'new-shared-secret'})
            assert response.status_code == 200
        refreshed = callback.fn()
        assert len(refreshed) == len(callback.outputs)
        assert refreshed[-1]['interactive'] is True
        assert 'new-shared-secret' not in str(refreshed)
    finally:
        ui.close()


def test_documented_pixflux_submit_poll_and_no_secret_response(service, monkeypatch):
    service.settings = replace(service.settings, pixellab_api_key='private-test-key')
    calls = []
    real_client = httpx.Client
    def handler(request):
        calls.append(request)
        assert request.headers['authorization'] == 'Bearer private-test-key'
        if request.method == 'POST':
            assert request.url.path == '/v2/create-image-pixflux-background'
            assert json.loads(request.content) == {'description': 'pixel ranger', 'image_size': {'width': 128, 'height': 128}, 'no_background': True, 'view': 'side', 'direction': 'west', 'seed': 42}
            return httpx.Response(202, json={'background_job_id': 'test-job', 'status': 'processing', 'usage': {'secret': 'private-test-key'}})
        assert request.url.path == '/v2/background-jobs/test-job'
        return httpx.Response(200, json={'id': 'test-job', 'status': 'completed', 'last_response': {'image': {'base64': 'data:image/png;base64,' + image_base64()}}})
    with TestClient(create_api(service=service)) as client:
        monkeypatch.setattr(reference_art.httpx, 'Client', lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs))
        submitted = client.post('/v1/reference-art/jobs', json={'prompt': 'pixel ranger', 'facing': 'left', 'seed': 42})
        assert submitted.status_code == 202 and submitted.json()['jobId'] == 'test-job'
        polled = client.get('/v1/reference-art/jobs/test-job')
        assert polled.json()['status'] == 'completed'
        assert 'private-test-key' not in submitted.text + polled.text
        assert [r.method for r in calls] == ['POST', 'GET']


@pytest.mark.parametrize('response', ['timeout', 401, 402, 429, 500])
def test_rejected_or_ambiguous_submission_never_retries_or_echoes_body(service, monkeypatch, response):
    service.settings = replace(service.settings, pixellab_api_key='secret-never-log')
    real_client = httpx.Client
    calls = []
    def handler(request):
        calls.append(request)
        if response == 'timeout':
            raise httpx.ReadTimeout('secret-never-log', request=request)
        return httpx.Response(response, json={'error': 'secret-never-log'})
    with TestClient(create_api(service=service)) as client:
        monkeypatch.setattr(reference_art.httpx, 'Client', lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs))
        result = client.post('/v1/reference-art/jobs', json={'prompt': 'ranger'})
        assert result.status_code == 502 and 'secret-never-log' not in result.text
        assert len(calls) == 1


def test_missing_key_and_invalid_payload_do_not_call_provider(service, monkeypatch):
    provider = Mock(side_effect=AssertionError('must not contact PixelLab'))
    monkeypatch.setattr(reference_art.httpx, 'Client', provider)
    # TestClient is already backed by ASGI and uses the original class.
    with TestClient(create_api(service=service)) as client:
        assert client.post('/v1/reference-art/jobs', json={'prompt': 'ranger'}).status_code == 422
        assert client.post('/v1/reference-art/jobs', json={'prompt': 'ranger', 'apiKey': 'do-not-store'}).status_code == 422
    provider.assert_not_called()


def test_transfer_is_idempotent_and_preselects_reference_without_animation(service, monkeypatch):
    generate = Mock(side_effect=AssertionError('transfer must not generate animation'))
    monkeypatch.setattr(service, 'generate_job', generate)
    body = {'characterId': 'reference_' + 'a' * 24, 'image': image_base64(), 'name': 'Forest ranger', 'prompt': 'green cloak', 'facing': 'left'}
    with TestClient(create_api(service=service)) as client:
        first = client.post('/v1/reference-art/import', json=body)
        second = client.post('/v1/reference-art/import', json=body)
        assert first.status_code == second.status_code == 200
        assert first.json() == second.json() == {'characterId': body['characterId']}
        changed = client.post('/v1/reference-art/import', json={**body, 'prompt': 'changed'})
        assert changed.status_code == 409
    character, preset_path = service.presets.load_character(body['characterId'])
    assert character.identity_description == 'green cloak' and character.facing == 'left'
    assert (preset_path.parent / character.reference_frame).read_bytes() == base64.b64decode(body['image'])
    from sprite_pipeline.ui import build_ui
    ui = build_ui(service=service)
    try:
        callback = next(block for block in ui.fns.values() if getattr(block.fn, '__name__', '') == 'load_workbench_character')
        result = callback.fn(SimpleNamespace(query_params={'workbench_character': body['characterId']}))
        assert len(result) == len(callback.outputs)
        assert result[0]['selected'] == 'generate'
        assert result[1]['value'] == body['characterId']
        assert result[2] is not None and result[5:7] == ('Forest ranger', 'green cloak')
        missing = callback.fn(SimpleNamespace(query_params={'workbench_character': 'missing'}))
        assert '参考角色不存在' in missing[3]
        empty = callback.fn(SimpleNamespace(query_params={}))
        assert len(empty) == len(callback.outputs)
    finally:
        ui.close()
    generate.assert_not_called()
    assert service.list_jobs() == []


@pytest.mark.parametrize('encoded', ['broken', image_base64((64, 64)), image_base64(opaque=True)])
def test_transfer_rejects_invalid_references(service, encoded):
    with TestClient(create_api(service=service)) as client:
        result = client.post('/v1/reference-art/import', json={'characterId': 'reference_' + 'b' * 24, 'image': encoded, 'name': 'ranger', 'prompt': 'ranger'})
        assert result.status_code == 422
