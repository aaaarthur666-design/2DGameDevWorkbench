"""Regression coverage for bounded phase generation and false recovery evidence."""
import copy
import io
import json
from pathlib import Path
from unittest.mock import patch

import pytest
from PIL import Image, ImageDraw
from test_attack_sequence import setup_sequence, create
from test_motion_correction import PASS
from test_vision_sequence import full_action
from sprite_pipeline.attack_sequence import FixedAttackGeneration
from sprite_pipeline.attack_timeline import select_phase, assemble_phases
from sprite_pipeline.errors import ConflictError, ProviderTemporaryError, ValidationHarnessError
from sprite_pipeline.service import SpritePipelineService
from sprite_pipeline.vision_review import VisionReviewer
from sprite_pipeline.vision_sequence import FramePose, SequenceVerification, assess_sequence, sequence_content


@pytest.fixture
def staged(setup_sequence):
    s, p, f = setup_sequence
    for action in ['attack', 'attack_in_air']:
        source = Path(__file__).parents[1] / f'presets/actions/{action}.json'
        data = json.loads(source.read_text(encoding='utf-8'))
        data['generation_strategy'] = 'three_stage_attack'  # Frozen v4 regression fixture.
        (f.action_dir / f'{action}.json').write_text(json.dumps(data), encoding='utf-8')
    return s, p, f


@pytest.mark.parametrize('action', ['attack', 'attack_in_air'])
def test_three_phases_all_candidates_exact_output_and_original_recovery_endpoint(staged, action):
    s, p, f = staged
    job = create(staged, 3, action)
    with patch.object(VisionReviewer, 'review', return_value=PASS) as review:
        done = s.generate_job(job.job_id)
        for _ in range(4):
            s.generate_job(job.job_id)
    assert len(p.requests) == 9 and review.call_count == 3
    assert [len(c.args[0]) for c in review.call_args_list] == [16] * 3
    assert all(c.kwargs['handoff_frames'] == [5, 13] for c in review.call_args_list)
    assert all(c.kwargs['facing'] == job.character.facing for c in review.call_args_list)
    for c in done.candidates:
        plan = c.attack_sequence
        runs = p.requests[(c.candidate_index - 1) * 3:c.candidate_index * 3]
        assert [r.frame_count for r in runs] == [4, 8, 4]
        assert runs[1].prompt.startswith('START THE STRIKE NOW')
        assert runs[2].prompt.startswith('RECOVERY ONLY')
        assert all('MUST MOVE' in r.prompt and 'No handoff' in r.prompt for r in runs)
        assert all('No detached beams' in r.prompt for r in runs)
        assert sum(s._pixellab_generation_units(128, 128, r.frame_count) for r in runs) == 4
        assert plan['maximum_submissions'] == c.submission_attempts == 3
        assert len(c.frames) == 16 and plan['actual_frame_count'] == 16
        assert [r['submission_attempts'] for r in plan['stages']] == [1] * 3
        original = (s.store.job_dir(job.job_id) / 'input/reference.png').read_bytes()
        assert runs[0].reference_image == original
        assert all(r.last_frame is None for r in runs[:2])
        assert runs[2].last_frame == (original if action == 'attack' else None)
        stored = FixedAttackGeneration(s)
        for i in [1, 2]:
            assert runs[i].reference_image == stored.saved_frames(job.job_id, c.candidate_index, i - 1)[-1]
        # Every delivered frame is traceable to an unchanged raw provider frame.
        assert [r['raw_count'] for r in plan['timeline']['phases']] == [5, 9, 5]
        for entry in plan['timeline']['frames']:
            raw = stored.saved_frames(job.job_id, c.candidate_index, entry['stage'])
            assert entry['raw_frame'] <= len(raw)
        assert [r['end'] for r in plan['timeline']['phases']] == [4, 12, 16]
    assert done.motion_control['maximum_extra_generations'] == 0


@pytest.mark.parametrize('stage', [0, 1, 2])
def test_unknown_phase_never_repeats_or_spends_remaining_budget(staged, stage):
    s, p, f = staged
    job = create(staged)
    p.unknown_stage = stage
    with pytest.raises(ProviderTemporaryError):
        s.generate_job(job.job_id)
    for _ in range(3):
        with pytest.raises(ConflictError):
            s.generate_job(job.job_id)
    assert len(p.requests) == stage + 1


@pytest.mark.parametrize('completed_stages', [1, 2])
def test_restart_uses_frozen_plan_and_only_remaining_phases(staged, completed_stages):
    s, p, f = staged
    job = create(staged)
    with patch.object(VisionReviewer, 'review', return_value=PASS) as review:
        for _ in range(completed_stages):
            s.generate_job(job.job_id, wait=False)
        assert len(p.requests) == completed_stages and not review.called
        with patch('sprite_pipeline.attack_sequence.phase_prompts', side_effect=AssertionError('frozen plan')):
            recovered = SpritePipelineService(s.settings.root).generate_job(job.job_id)
    assert len(p.requests) == 3 and review.call_count == 1
    assert len(recovered.candidates[0].frames) == 16


def test_three_phase_commit_failure_recovers_without_generation(staged):
    s, p, f = staged
    job = create(staged)
    with patch.object(s, '_store_provider_frames', side_effect=OSError('disk busy')):
        with pytest.raises(OSError):
            s.generate_job(job.job_id)
    assert len(p.requests) == 3
    with patch.object(VisionReviewer, 'review', return_value=PASS):
        done = s.generate_job(job.job_id)
    assert len(p.requests) == 3 and len(done.candidates[0].frames) == 16


@pytest.mark.parametrize('n,counts', [(8, [4, 4]), (10, [4, 6]), (12, [4, 4, 4]), (14, [4, 6, 4]), (16, [4, 8, 4])])
def test_shorter_requests_remain_legal_and_frozen(staged, n, counts):
    s, p, f = staged
    with patch.object(VisionReviewer, 'review', return_value=PASS):
        done = s.generate_job(create(staged, frames=n).job_id)
    assert [r.frame_count for r in p.requests] == counts
    assert len(done.candidates[0].frames) == (n if len(counts) == 3 else n + 1)


def png(x, hidden=(0, 0, 0, 0)):
    image = Image.new('RGBA', (32, 32), hidden)
    ImageDraw.Draw(image).rectangle((x, 4, x + 3, 12), fill=(40, 180, 240, 255))
    stream = io.BytesIO()
    image.save(stream, format='PNG')
    return stream.getvalue()


def test_timeline_removes_hold_preserves_fast_key_pose_endpoints_and_bytes():
    raw = [png(1), png(1), png(5), png(17), png(22)]
    indices = select_phase(raw, 4)
    assert indices == [0, 2, 3, 4]
    combined, timeline = assemble_phases([raw], [4], ['preparation'])
    assert combined == [raw[i] for i in indices]
    assert timeline['raw_frames_preserved']
    assert select_phase([png(1, (255, 80, 0, 0)), png(4), png(8), png(14), png(20)], 4, previous=png(1)) == [1, 2, 3, 4]


@pytest.mark.parametrize('count', [3, 9])
def test_timeline_never_fills_missing_frames_or_silently_truncates_huge_result(count):
    with pytest.raises(ValidationHarnessError):
        select_phase([png(1)] * count, 4)


@pytest.mark.parametrize('case', ['mid_sequence', 'held', 'snap', 'not_settled', 'before_strike'])
def test_wrong_recovery_claim_cannot_pass(case):
    initial, check = full_action()
    if case == 'mid_sequence':
        check['stages'][-1]['observations'][-1]['frame'] = 14
        check['recovery_evidence']['end_frame'] = 14
    if case == 'held': check['recovery_evidence']['motion'] = 'held_extended'
    if case == 'snap': check['recovery_evidence']['motion'] = 'snapped_to_ready'
    if case == 'not_settled': check['recovery_evidence']['settled'] = False
    if case == 'before_strike': check['recovery_evidence']['start_frame'] = 7
    ok, issues, audit = assess_sequence(SequenceVerification.model_validate(check), [FramePose.model_validate(p) for p in initial['observations']], 'attack', 16)
    assert not ok and not issues
    assert audit[-1]['status'] == 'uncertain' and audit[-1]['evidence_note']


def test_confirmed_held_tail_is_localized_missing_recovery():
    initial, check = full_action()
    check['stages'][-1].update(status='missing', reason='出刀后一直伸臂持刀到末帧，没有回收轨迹')
    check['recovery_evidence'].update(motion='held_extended', settled=False)
    ok, issues, audit = assess_sequence(SequenceVerification.model_validate(check), [FramePose.model_validate(p) for p in initial['observations']], 'attack', 16)
    assert not ok and issues[0]['code'] == 'incomplete_action'
    assert issues[0]['frames'] == [13, 16] and issues[0]['evidence_status'] == 'confirmed'


def test_both_seams_tail_and_explicit_axes_are_in_one_second_request(staged):
    s, p, f = staged
    paths = f.write_sequence(f.root / 'audit-panels', shifts=tuple(i % 4 for i in range(16)))
    content, _ = sequence_content(paths, f.reference_path, [], 'attack', handoff_frames=[5, 13], facing='left')
    text = ' '.join(part.get('text', '') for part in content)
    assert 'Front = screen left; behind = screen right' in text
    assert 'TERMINAL RECOVERY' in text and 'end at frame 16' in text
    assert all(f'Segment handoff close-up around frame {n}' in text for n in [5, 13])


def test_brief_charge_does_not_require_extra_hold_frames():
    initial, check = full_action()
    for pose in initial['observations']:
        pose.update(grip_height='low', blade_tip='front_low')
    initial['observations'][3].update(grip_height='shoulder', blade_tip='behind_high')
    frames={'windup':[3,4], 'charge':[4], 'strike':[4,5,7], 'follow_through':[8,12], 'recover':[13,16]}
    for stage in check['stages']:
        stage['observations']=[{'frame':f,'observation':'可见举刀到肩后的短暂蓄力，再立即出刀'} for f in frames[stage['stage']]]
    ok, issues, audit = assess_sequence(SequenceVerification.model_validate(check), [FramePose.model_validate(p) for p in initial['observations']], 'attack', 16)
    assert ok and not issues


def test_fixed_old_charge_window_cannot_excuse_a_frozen_new_strike(staged):
    from sprite_pipeline.motion_correction import apply_charge_hold
    job=create(staged)
    report={'frames':[{'index':i,'hard_failures':['consecutive_duplicate_frames'] if i in [4,5,6] else [],'warnings':[]} for i in range(16)],
            'hard_failures':[{'code':'consecutive_duplicate_frames','frame_indices':[4,5,6],'message':'frozen strike'}],
            'warnings':[], 'summary':{'hard_failure_count':1,'warning_count':0}}
    apply_charge_hold(job,report)
    assert report['hard_failures'] and not report['warnings']


def test_short_provider_result_stops_before_spending_on_later_phases(staged):
    from sprite_pipeline.providers.base import PollResult, PollStatus
    s,p,f=staged
    original=p.poll
    def short(job_id):
        result=original(job_id)
        result.images=result.images[:3]
        return result
    p.poll=short
    job=create(staged)
    with pytest.raises(ValidationHarnessError):
        s.generate_job(job.job_id)
    assert len(p.requests)==1
    assert len(FixedAttackGeneration(s).saved_frames(job.job_id,1,0))==3
    for _ in range(2):
        s.generate_job(job.job_id)
    assert len(p.requests)==1
