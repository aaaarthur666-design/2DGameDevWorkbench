import base64
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from test_harness_integration import TemporaryHarness
from sprite_pipeline.api_app import create_api
from sprite_pipeline.jsonio import sha256_file
from sprite_pipeline.reference_canvas import ReferenceCanvas
from sprite_pipeline.service import SpritePipelineService


@pytest.fixture
def setup_canvas(tmp_path):
    harness = TemporaryHarness(tmp_path)
    service = SpritePipelineService(tmp_path)
    client = TestClient(create_api(service=service))
    yield service, harness, client
    client.close()


def begin(setup_canvas):
    service, harness, client = setup_canvas
    result = client.post('/v1/reference-edits', json={'character_id': harness.character_id})
    assert result.status_code == 200
    edit_id = result.json()['data']['edit']['edit_id']
    url = '/v1/reference-edits/' + edit_id
    session = client.get(url + '/pixel-edit').json()['data']['session']
    pixels = bytearray(base64.b64decode(session['rgba_base64']))
    pixels[4 * (32 * session['width'] + 32):4 * (32 * session['width'] + 32) + 4] = bytes([242, 31, 78, 179])
    body = {key: session[key] for key in ['width', 'height', 'base_sha256']}
    body['rgba_base64'] = base64.b64encode(pixels).decode()
    return url, session, pixels, body


def test_edit_transfer_exact_pixels_independent_original_and_new_generation_input(setup_canvas):
    service, harness, client = setup_canvas
    source = harness.reference_path.read_bytes()
    contract_path = harness.character_dir / 'character.json'
    contract = json.loads(contract_path.read_text())
    contract['weapon_hand'] = 'left'
    contract['facing'] = 'left'
    contract_path.write_text(json.dumps(contract))
    url, session, pixels, body = begin(setup_canvas)
    assert not service.list_jobs()
    assert client.post(url + '/transfer', json={'base_sha256': session['base_sha256']}).status_code == 422
    saved = client.post(url + '/pixel-edit', json=body)
    assert saved.status_code == 200, saved.text
    edit = saved.json()['data']['edit']
    latest = client.get(url + '/pixel-edit').json()['data']['session']
    assert base64.b64decode(latest['rgba_base64']) == pixels
    assert latest['manual_edit_versions'] == 1 and latest['can_edit']
    transferred = client.post(url + '/transfer', json={'base_sha256': edit['sha256']})
    assert transferred.status_code == 200, transferred.text
    cid = transferred.json()['data']['character_id']
    assert client.post(url + '/transfer', json={'base_sha256': edit['sha256']}).json()['data']['character_id'] == cid
    character, character_path = service.presets.load_character(cid)
    assert character.weapon_hand == 'left' and character.facing == 'left'
    assert character.qa.rigid_translation_tolerance_px == 4
    assert character.anchor.model_dump() == contract['anchor']
    with Image.open(character_path.parent / character.reference_frame) as image:
        assert image.convert('RGBA').tobytes() == pixels
    assert harness.reference_path.read_bytes() == source
    assert not service.list_jobs()
    # Preparing a local import job exercises the actual generator input snapshot;
    # it never submits to a provider.
    request = harness.create_request('import')
    request['character_id'] = cid
    job = service.create_job(request)
    with Image.open(service.store.job_dir(job.job_id) / 'input/reference.png') as image:
        assert image.convert('RGBA').tobytes() == pixels
    assert job.character.weapon_hand == 'left'


def test_stale_saves_transfers_and_repeated_versions(setup_canvas):
    service, _, client = setup_canvas
    url, session, pixels, body = begin(setup_canvas)
    first = client.post(url + '/pixel-edit', json=body).json()['data']['edit']
    assert client.post(url + '/pixel-edit', json=body).status_code == 409
    assert client.post(url + '/transfer', json={'base_sha256': session['base_sha256']}).status_code == 409
    cid1 = client.post(url + '/transfer', json={'base_sha256': first['sha256']}).json()['data']['character_id']
    pixels[0:4] = bytes([1, 2, 3, 4])
    body.update(base_sha256=first['sha256'], rgba_base64=base64.b64encode(pixels).decode())
    second = client.post(url + '/pixel-edit', json=body).json()['data']['edit']
    assert second['manual_edit_versions'] == 2
    cid2 = client.post(url + '/transfer', json={'base_sha256': second['sha256']}).json()['data']['character_id']
    assert cid1 != cid2
    old, old_path = service.presets.load_character(cid1)
    assert sha256_file(old_path.parent / old.reference_frame) == first['sha256']


@pytest.mark.parametrize('case', ['dimensions', 'length', 'encoding', 'empty'])
def test_invalid_pixel_payloads_and_empty_transfer(setup_canvas, case):
    _, _, client = setup_canvas
    url, session, pixels, body = begin(setup_canvas)
    if case == 'dimensions': body['width'] = 63
    if case == 'length': body['rgba_base64'] = 'AAAA'
    if case == 'encoding': body['rgba_base64'] = '!!!!'
    if case == 'empty': body['rgba_base64'] = base64.b64encode(bytes(len(pixels))).decode()
    saved = client.post(url + '/pixel-edit', json=body)
    if case == 'empty':
        assert saved.status_code == 200
        assert client.post(url + '/transfer', json={'base_sha256': saved.json()['data']['edit']['sha256']}).status_code == 422
    else:
        assert saved.status_code == 422
        assert client.get(url + '/pixel-edit').json()['data']['session']['base_sha256'] == session['base_sha256']


@pytest.mark.parametrize('count', [1, 4, 17, 64])
def test_playback_all_current_frames_and_no_mutation(setup_canvas, count):
    service, harness, client = setup_canvas
    action_path = harness.action_dir / (harness.action_id + '.json')
    action = json.loads(action_path.read_text())
    action['frame_count'] = count
    action_path.write_text(json.dumps(action))
    harness.write_sequence(harness.root / 'incoming', shifts=tuple(i % 4 for i in range(count)))
    job = service.create_job(harness.create_request('import'))
    job = service.ingest_candidate(job.job_id, 1, harness.root / 'incoming', source_kind='png_dir')
    before = service.store.load(job.job_id).model_dump_json()
    result = client.get(f'/v1/jobs/{job.job_id}/candidates/1/playback')
    assert result.status_code == 200
    data = result.json()['data']['playback']
    assert len(data['frames']) == count and data['fps'] == 8 and not data['loop']
    assert [item['index'] for item in data['frames']] == list(range(count))
    for item, frame in zip(data['frames'], job.candidates[0].frames):
        response = client.get(item['url'])
        assert response.status_code == 200
        assert hashlib.sha256(response.content).hexdigest() == frame.sha256
    assert client.get(data['frames'][0]['url'].split('?')[0] + '?sha256=' + '0' * 64).status_code == 409
    assert service.store.load(job.job_id).model_dump_json() == before
    # Replacing a frame behind the API cannot silently mix versions.
    service.store.resolve_job_path(job.job_id, job.candidates[0].frames[0].active_path).write_bytes(b'changed')
    assert client.get(data['frames'][0]['url']).status_code == 409


def test_playback_clock_node_suite():
    node = shutil.which('node')
    if not node: pytest.skip('Node.js unavailable')
    result = subprocess.run([node, str(Path(__file__).with_name('test_animation_player_core.mjs'))], capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
