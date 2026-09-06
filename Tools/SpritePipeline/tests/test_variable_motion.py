import base64
import io
import json
from unittest.mock import patch

import pytest
from PIL import Image

from test_motion_correction import setup, create, PASS, FAIL
from sprite_pipeline.models import GenerationRequest, ReviewStatus
from sprite_pipeline.motion_correction import MotionCorrection
from sprite_pipeline.vision_review import VisionReviewer
from sprite_pipeline.errors import ConflictError, ValidationHarnessError


@pytest.mark.parametrize('provider', ['hunyuan', 'openai'])
@pytest.mark.parametrize('count', [1, 2, 3, 4, 8, 15, 17, 24, 64])
def test_actual_frames_sent_once_in_order_with_correct_labels(setup, monkeypatch, provider, count):
    s, _, f = setup
    monkeypatch.setenv('SPRITE_PIPELINE_VISION_PROVIDER', provider)
    paths = f.write_sequence(f.root/'variable-vision', shifts=tuple(i % 4 for i in range(count)))
    report = {**PASS, 'verdict': 'uncertain'} if count == 1 else {**FAIL, 'issues': [{**FAIL['issues'][0], 'frames': [count]}]}
    response = ({'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(report)}}]}
                if provider == 'hunyuan' else {'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps(report)}]}]})
    with patch.object(VisionReviewer, 'key', return_value='test-only-key'), patch('sprite_pipeline.vision_review.httpx.Client') as factory:
        client = factory.return_value.__enter__.return_value
        client.post.return_value.status_code = 200
        client.post.return_value.json.return_value = response
        result = VisionReviewer(s.settings).review(paths, 'attack', f.reference_path)
        body = client.post.call_args.kwargs['json']
        content = body['messages' if provider == 'hunyuan' else 'input'][0]['content']
        labels = [part['text'] for part in content if part['type'] in {'text', 'input_text'} and part['text'].startswith('Frame ')]
        assert labels == [f'Frame {i+1}/{count}' for i in range(count)]
        images = [part for part in content if part['type'] in {'image_url', 'input_image'}]
        assert len(images) == count + 1
        # Verify image bytes against the original ordered frames, not just their labels.
        for part, path in zip(images, [f.reference_path, *paths]):
            url = part['image_url']['url'] if provider == 'hunyuan' else part['image_url']
            actual = Image.open(io.BytesIO(base64.b64decode(url.split(',', 1)[1]))).convert('RGB')
            with Image.open(path) as original:
                expected = Image.new('RGBA', original.size, (70,70,70,255))
                expected.alpha_composite(original.convert('RGBA'))
                expected = expected.convert('RGB').resize((512,512), Image.Resampling.NEAREST)
            assert actual.tobytes() == expected.tobytes()
        schema = (json.loads(content[-1]['text'].split('without prose or Markdown. ', 1)[1])
                  if provider == 'hunyuan' else body['text']['format']['schema'])
        bounds = schema['$defs']['MotionIssue']['properties']['frames']['items']
        assert bounds['minimum'] == 1 and bounds['maximum'] == count
        assert result['frame_count'] == count
        assert client.post.call_count == 1


@pytest.mark.parametrize('count', [1, 8, 17, 64])
def test_response_cannot_reference_nonexistent_frame(setup, count):
    s, _, f = setup
    paths = f.write_sequence(f.root/'bounds', shifts=tuple(i%4 for i in range(count)))
    report = {**FAIL, 'issues': [{**FAIL['issues'][0], 'frames': [count+1]}]}
    with patch.object(VisionReviewer, 'key', return_value='test-only-key'), patch('sprite_pipeline.vision_review.httpx.Client') as factory:
        client = factory.return_value.__enter__.return_value
        client.post.return_value.status_code = 200
        client.post.return_value.json.return_value = {'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps(report)}]}]}
        with pytest.raises(ValidationHarnessError, match='未取得有效结论'):
            VisionReviewer(s.settings).review(paths, 'attack', f.reference_path)
        assert client.post.call_count == 1


@pytest.mark.parametrize('count', [0, 65])
def test_invalid_count_does_not_reserve_or_send_review(setup, count):
    s, _, f = setup
    job = create(setup)
    with patch('sprite_pipeline.vision_review.httpx.Client') as client:
        with pytest.raises(ValidationHarnessError, match='尚未发送请求'):
            MotionCorrection(s)._save_review(job.job_id, 'initial-1', [f.reference_path]*count, 'attack')
        assert not client.called
    assert s.get_job(job.job_id).motion_control['reviews'] == {}


@pytest.mark.parametrize('count', [8, 15, 17, 24, 64])
@pytest.mark.parametrize('action', ['attack', 'attack_in_air'])
def test_default_generation_reviews_all_returned_frames(setup, count, action):
    s, p, _ = setup
    p.frame_count = count
    job = create(setup, action)
    with patch.object(VisionReviewer, 'review', return_value=PASS) as review:
        result = s.generate_job(job.job_id)
    assert result.motion_control['state'] == 'passed', result.motion_control
    assert len(result.candidates[0].frames) == count
    assert len(review.call_args.args[0]) == count
    assert result.candidates[0].motion_review['report']['frame_count'] == count
    assert len(p.requests) == 1


def test_nondefault_request_count_keeps_attack_policy(setup):
    s, _, f = setup
    job = s.create_job(GenerationRequest(character_id=f.character_id, action_id='attack', provider='pixellab', frame_count=8, loop=False))
    assert job.motion_control['maximum_extra_generations'] == 2


def test_seventeenth_frame_auto_repair_preserves_every_other_frame(setup):
    s, p, _ = setup
    p.frame_count = 17
    p.edit_shifts = (1,2,3,1)
    failure = {**FAIL, 'issues': [{**FAIL['issues'][0], 'frames': [17]}]}
    with patch.object(VisionReviewer, 'review', side_effect=[failure, PASS]) as review:
        result = s.generate_job(create(setup).job_id)
    assert result.motion_control['state'] == 'passed', result.motion_control
    candidate = result.candidates[0]
    assert len(candidate.frames) == 17 and len(p.requests) == 2
    assert [len(call.args[0]) for call in review.call_args_list] == [17,17]
    assert result.motion_control['attempts'][0]['context'] == [13,14,15,16]
    assert candidate.frames[16].active_path.startswith('motion/')
    assert all(not frame.active_path.startswith('motion/') for frame in candidate.frames[:16])
    assert all(s.store.resolve_job_path(result.job_id,frame.raw_path).is_file() for frame in candidate.frames)


@pytest.mark.parametrize('count', [8, 17])
def test_variable_frame_budget_remains_two_after_restart(setup, count):
    s, p, _ = setup
    p.frame_count = count
    failure = {**FAIL, 'issues': [{**FAIL['issues'][0], 'frames': [count]}]}
    with patch.object(VisionReviewer, 'review', return_value=failure) as review:
        result = s.generate_job(create(setup).job_id)
        for _ in range(3):
            s.generate_job(result.job_id)
        assert review.call_count == 3
    assert result.motion_control['state'] == 'needs_repair'
    assert len(p.requests) == 3 and len(result.motion_control['attempts']) == 2
    with pytest.raises(ConflictError, match='检查已完成'):
        MotionCorrection(s).resume(result.job_id)
    assert len(s.get_job(result.job_id).motion_control['attempts']) == 2


@pytest.mark.parametrize('count', [1, 2, 3, 8, 17])
@pytest.mark.parametrize('end', [False, True])
def test_manual_edge_repair_keeps_actual_length_and_context_padding(setup, count, end):
    s, p, _ = setup
    p.frame_count = count
    uncertain = {**PASS, 'verdict': 'uncertain'}
    with patch.object(VisionReviewer, 'review', return_value=uncertain):
        job = s.generate_job(create(setup).job_id)
        c = job.candidates[0]
        target = count-1 if end else 0
        control = MotionCorrection(s)
        attempt = control.manual(job.job_id,1,target,c.frames[target].sha256,wait=True)
        assert len(attempt['context']) == 4
        assert all(0 <= i < count for i in attempt['context'])
        assert len(p.requests[-1].edit_frames) == 4
        adopted = control.adopt(job.job_id,attempt['id'],manual=True)
    frames = adopted.candidates[0].frames
    assert len(frames) == count
    assert frames[target].active_path.startswith('motion/')
    assert all(frame.active_path == c.frames[i].active_path for i,frame in enumerate(frames) if i != target)


def old_seventeen_frame_job(setup):
    s, p, _ = setup
    p.frame_count = 17
    with patch.object(VisionReviewer,'review',side_effect=ValidationHarnessError('视觉检查需要完整的 16 帧动作')):
        result = s.generate_job(create(setup).job_id)
    with s.store.locked_job(result.job_id) as saved:
        saved.motion_control['reviews'] = {'initial-1': {'state':'checking'}}
    return s.get_job(result.job_id)


def test_explicit_resume_legacy_unsent_check_reuses_original_generation(setup):
    s, p, _ = setup
    job = old_seventeen_frame_job(setup)
    before = [frame.sha256 for frame in job.candidates[0].frames]
    with s.store.locked_job(job.job_id) as saved:
        saved.candidates[0].frames[0].reviewed_by='user'
        saved.candidates[0].frames[0].review_note='保留用户标记'
    control = MotionCorrection(s)
    resumed = control.resume(job.job_id)
    assert resumed.motion_control['state'] == 'waiting'
    assert len(resumed.motion_control['unsent_history']) == 1
    assert resumed.candidates[0].frames[0].review_note == '保留用户标记'
    assert all(frame.review_status == ReviewStatus.pending for frame in resumed.candidates[0].frames[1:])
    control.resume(job.job_id)
    with patch.object(VisionReviewer,'review',return_value=PASS) as review:
        result = s.generate_job(job.job_id)
    assert result.motion_control['state'] == 'passed'
    assert len(p.requests) == 1 and review.call_count == 1
    assert before == [frame.sha256 for frame in result.candidates[0].frames]
    assert result.motion_control['maximum_extra_generations'] == 2


def test_sent_timeout_is_recorded_and_cannot_be_resumed(setup):
    s, p, _ = setup
    def timeout(*args, on_request, **kwargs):
        on_request()
        raise TimeoutError('timeout')
    with patch.object(VisionReviewer,'review',side_effect=timeout):
        job = s.generate_job(create(setup).job_id)
    record = job.motion_control['reviews']['initial-1']
    assert record['state'] == 'failed' and record['request_started'] is True
    with pytest.raises(ConflictError,match='已发送或结果未知'):
        MotionCorrection(s).resume(job.job_id)
    assert len(p.requests) == 1


def test_resume_endpoint_only_schedules_saved_frames(setup):
    from fastapi.testclient import TestClient
    from sprite_pipeline.api_app import create_api
    s, p, _ = setup
    job = old_seventeen_frame_job(setup)
    # No lifespan context: recovery is intentionally not started in this test.
    client = TestClient(create_api(service=s))
    response = client.post(f'/jobs/{job.job_id}/motion-review/resume')
    assert response.status_code == 200, response.text
    assert response.json()['motion_control']['state'] == 'waiting'
    assert len(p.requests) == 1
