"""Guard the successful original-image anchor and independent appearance review."""
import copy
import json
from pathlib import Path
from unittest.mock import patch

import pytest
from test_attack_sequence import setup_sequence, create
from test_motion_correction import PASS, setup
from test_vision_evidence import response
from test_vision_sequence import full_action
from vision_test_fixtures import consistent_appearance
from sprite_pipeline.attack_sequence import FixedAttackGeneration
from sprite_pipeline.errors import ConflictError, ProviderTemporaryError
from sprite_pipeline.service import SpritePipelineService
from sprite_pipeline.vision_review import VisionReviewer
from sprite_pipeline.vision_appearance import AppearanceAudit, assess_appearance


@pytest.fixture
def anchored(setup_sequence):
    s, provider, fixture = setup_sequence
    data = json.loads((Path(__file__).parents[1] / 'presets/actions/attack.json').read_text(encoding='utf-8'))
    assert data['generation_strategy'] == 'reference_anchored_attack'
    (fixture.action_dir / 'attack.json').write_text(json.dumps(data), encoding='utf-8')
    return s, provider, fixture


def test_original_image_is_present_during_actual_strike_for_every_candidate(anchored):
    service, provider, _ = anchored
    job = create(anchored, 3)
    with patch.object(VisionReviewer, 'review', return_value=PASS) as review:
        done = service.generate_job(job.job_id)
        service.generate_job(job.job_id)
    original = (service.store.job_dir(job.job_id) / 'input/reference.png').read_bytes()
    assert len(provider.requests) == 6 and review.call_count == 3
    for i, candidate in enumerate(done.candidates):
        preparation, strike = provider.requests[i * 2:i * 2 + 2]
        assert [preparation.frame_count, strike.frame_count] == [6, 10]
        assert sum(service._pixellab_generation_units(128,128,r.frame_count) for r in [preparation,strike])==5
        assert preparation.reference_image == original and preparation.last_frame is None
        assert strike.reference_image == FixedAttackGeneration(service).saved_frames(job.job_id, i + 1, 0)[-1]
        assert strike.last_frame == original
        assert 'FIRST image is the charged pose; LAST image anchors original body and weapon appearance' in strike.prompt
        assert 'continuous blade-following slash arc is allowed' in strike.prompt
        assert 'MUST MOVE' not in strike.prompt and 'No detached beams, flashes' not in strike.prompt
        assert 'SAME physical weapon hand' in strike.prompt
        assert candidate.attack_sequence['version'] == 6
        assert candidate.attack_sequence['maximum_submissions'] == candidate.submission_attempts == 2
        assert len(candidate.frames) == 16
        assert candidate.attack_sequence['handoff_frames'] == [7]
        assert candidate.attack_sequence['appearance_anchor']['reference_sha256'] == job.reference_sha256
        assert len(candidate.attack_sequence['timeline']['phases']) == 2
    assert done.motion_control['maximum_extra_generations'] == 0


def test_restart_keeps_original_endpoint_without_resubmitting_preparation(anchored):
    s, provider, _ = anchored
    job = create(anchored)
    s.generate_job(job.job_id, wait=False)
    with patch.object(VisionReviewer, 'review', return_value=PASS):
        done = SpritePipelineService(s.settings.root).generate_job(job.job_id)
    assert len(provider.requests) == 2 and len(done.candidates[0].frames) == 16
    assert provider.requests[1].last_frame is not None


@pytest.mark.parametrize('stage', [0, 1])
def test_unknown_submission_never_repeats_a_paid_segment(anchored, stage):
    s, provider, _ = anchored
    job = create(anchored)
    provider.unknown_stage = stage
    with pytest.raises(ProviderTemporaryError): s.generate_job(job.job_id)
    for _ in range(2):
        with pytest.raises(ConflictError): s.generate_job(job.job_id)
    assert len(provider.requests) == stage + 1


def test_missing_appearance_anchor_stops_before_any_charge(anchored):
    s, provider, _ = anchored
    job = create(anchored)
    with s.store.locked_job(job.job_id) as current:
        current.candidates[0].attack_sequence['appearance_anchor']['reference_sha256'] = '0' * 64
    with pytest.raises(ConflictError, match='原型视觉约束'):
        s.generate_job(job.job_id)
    assert provider.requests == []


def deformed_appearance(count=16):
    audit = consistent_appearance(count)
    audit.update(body_status='changed', weapon_status='changed')
    audit['findings'] = [
        {'code': 'identity_drift', 'confidence': .96, 'reference_feature': '原图躯干修长，胸甲窄，肩部比例小',
         'observations': [{'frame': 9, 'observation': '胸甲和肩部相对头部变宽，原图细分甲片合成大片'}, {'frame': 10, 'observation': '增厚胸甲延续到下一帧，头盔与躯干比例改变'}],
         'reason': '躯干和胸甲持续增厚，改变原角色比例', 'correction': 'Restore the original slim torso and armor proportions.'},
        {'code': 'weapon_deformation', 'confidence': .97, 'reference_feature': '原图具有从刀柄连续延伸的长而窄实心刀身',
         'observations': [{'frame': 10, 'observation': '刀柄前方只剩短亮块，看不到连接的细长刀身'}, {'frame': 11, 'observation': '短亮块继续出现，分离碎片不能解释为贴合实心刀身的拖尾'}],
         'reason': '连续帧中原长刀变成短亮块和碎片', 'correction': 'Restore the solid blade attached to the original hilt; keep its arc.'}
    ]
    return audit


def test_clean_first_pass_cannot_hide_new_body_and_weapon_findings(setup):
    s, provider, fixture = setup
    from test_motion_correction import create as create_single
    initial, check = full_action()
    assert not initial['issues'] and initial['verdict'] == 'pass'
    check['appearance_continuity'] = deformed_appearance()
    with patch.object(VisionReviewer, 'key', return_value='test-key'), patch('sprite_pipeline.vision_review.httpx.Client') as factory:
        client = factory.return_value.__enter__.return_value
        client.post.side_effect = [response(initial), response(check)]
        job = s.generate_job(create_single(setup).job_id)
        s.generate_job(job.job_id)
    report = job.candidates[0].motion_review['report']
    assert client.post.call_count == 2 and len(provider.requests) == 1
    assert report['verdict'] == 'fail' and report['appearance_continuity']['status'] == 'changed'
    assert {i['code'] for i in report['issues']} == {'identity_drift', 'weapon_deformation'}
    assert job.candidates[0].frames[9].review_status.value == 'repair_requested'
    assert {t['code'] for t in job.candidates[0].frames[9].motion_tags} == {'identity_drift', 'weapon_deformation'}
    assert job.motion_control['maximum_extra_generations'] == 0


@pytest.mark.parametrize('case', ['missing_audit', 'missing_frame', 'low_confidence', 'missing_comparison'])
def test_no_overall_pass_without_independent_appearance_coverage(setup, case):
    s, _, fixture = setup
    paths = fixture.write_sequence(fixture.root / 'appearance-missing', shifts=tuple(i % 4 for i in range(16)))
    initial, check = full_action()
    if case == 'missing_audit': check.pop('appearance_continuity')
    if case == 'missing_frame': check['appearance_continuity']['checked_frames'].pop()
    if case == 'low_confidence': check['appearance_continuity']['confidence'] = .7
    if case == 'missing_comparison': check['appearance_continuity']['comparisons'].pop()
    with patch.object(VisionReviewer, 'key', return_value='test-key'), patch('sprite_pipeline.vision_review.httpx.Client') as factory:
        client = factory.return_value.__enter__.return_value
        client.post.side_effect = [response(initial), response(check)]
        report = VisionReviewer(s.settings).review(paths, 'attack', fixture.reference_path)
    assert report['verdict'] == 'uncertain' and not report['issues']
    assert client.post.call_count == 2


@pytest.mark.parametrize('case', ['non_adjacent', 'out_of_range', 'confidence', 'status_conflict', 'identical_to_ref'])
def test_unsupported_appearance_claim_cannot_become_a_fault(setup, case):
    _, _, fixture = setup
    paths = fixture.write_sequence(fixture.root / 'appearance-false', shifts=tuple(i % 4 for i in range(16)))
    audit = deformed_appearance()
    audit['findings'] = audit['findings'][:1]
    if case == 'non_adjacent': audit['findings'][0]['observations'][1]['frame'] = 12
    if case == 'out_of_range': audit['findings'][0]['observations'][1]['frame'] = 17
    if case == 'confidence': audit['findings'][0]['confidence'] = .8
    if case == 'status_conflict': audit['body_status'] = 'consistent'
    if case == 'identical_to_ref': paths = [fixture.reference_path] * 16
    ok, findings, result = assess_appearance(AppearanceAudit.model_validate(audit), paths, fixture.reference_path)
    assert not ok and not findings and result['status'] == 'uncertain'
    assert result['body_status'] == 'uncertain'


@pytest.mark.parametrize('count', [1, 17, 64])
def test_appearance_audit_uses_actual_frame_count(setup, count):
    _, _, fixture = setup
    paths = [fixture.reference_path] * count
    ok, findings, audit = assess_appearance(AppearanceAudit.model_validate(consistent_appearance(count)), paths, fixture.reference_path)
    assert ok and not findings and len(audit['checked_frames']) == count



def test_anchored_timeline_never_discards_a_distinct_windup_pose():
    from test_attack_stability import png
    from sprite_pipeline.attack_timeline import assemble_anchored_phases
    reference=png(1)
    raw=[reference,png(4),png(7),png(12),png(20)]
    result,timeline=assemble_anchored_phases([raw],[4],['preparation'],reference)
    assert result==raw[1:]
    assert timeline['phases'][0]['selected_raw_frames']==[2,3,4,5]
    # A fifth distinct pose is retained rather than dropped merely to get 4.
    raw[0]=png(2)
    result,timeline=assemble_anchored_phases([raw],[4],['preparation'],reference)
    assert result==raw and not timeline['phases'][0]['context_removed']


def test_context_match_tolerates_encoding_color_noise_but_not_pose_motion():
    from test_attack_stability import png
    from sprite_pipeline.attack_timeline import is_context_frame
    assert is_context_frame(png(1, (50, 100, 200, 0)),png(1))
    assert not is_context_frame(png(2),png(1))
