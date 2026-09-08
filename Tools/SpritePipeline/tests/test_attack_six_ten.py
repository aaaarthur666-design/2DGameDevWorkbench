"""Keep the working visual/grip chain while changing only timing and footwork."""
import copy
import json
from unittest.mock import patch

import pytest
from PIL import Image
from test_attack_identity_regression import anchored
from test_attack_sequence import setup_sequence, create
from test_motion_correction import PASS
from sprite_pipeline.attack_sequence import FixedAttackGeneration, phase_timing
from sprite_pipeline.errors import ValidationHarnessError
from sprite_pipeline.project_profile import DREAMWEAVER_PROFILE
from sprite_pipeline.service import SpritePipelineService
from sprite_pipeline.vision_review import VisionReviewer


CHECK_QUOTA = SpritePipelineService._check_submission_quota


def test_six_ten_has_coordinated_lunge_and_matching_charge_metadata(anchored):
    service, provider, fixture = anchored
    job = create(anchored)
    plan = job.candidates[0].attack_sequence
    assert plan['rhythm'] == {'target_ratio': [3, 3, 2], 'requested_frames': {'preparation': 6, 'attack': 6, 'recovery': 4}}
    assert job.action.critical_frame_indices == [5]
    assert DREAMWEAVER_PROFILE.action('attack').critical_frame_indices == (5,)
    with patch.object(VisionReviewer, 'review', return_value=PASS) as review:
        done = service.generate_job(job.job_id)
    preparation, strike = provider.requests
    assert [preparation.frame_count, strike.frame_count] == [6, 10]
    assert 'During this wind-up only, keep both feet at their FIRST-frame positions' in preparation.prompt
    assert 'no step, lunge or body turn' in preparation.prompt
    assert 'hips and torso driving the elbow and blade' in strike.prompt
    assert 'Rear foot stays planted' in strike.prompt
    assert 'lead foot makes ONE small forward lunge' in strike.prompt
    assert 'final 4 frames return the SAME lead foot and sword' in strike.prompt
    assert 'SAME physical weapon hand' in strike.prompt
    assert job.character.identity_description.strip() in strike.prompt
    assert 'LAST image anchors original body and weapon appearance' in strike.prompt
    assert all(len(r.prompt) <= 1000 for r in provider.requests)
    assert review.call_count == 1 and len(review.call_args.args[0]) == 16
    assert review.call_args.kwargs['handoff_frames'] == [7]
    assert done.motion_control['maximum_extra_generations'] == 0


def test_reserved_v5_four_twelve_resumes_with_its_original_prompts_and_anchors(anchored):
    service, provider, fixture = anchored
    job = create(anchored)
    with service.store.locked_job(job.job_id) as saved:
        saved.action.critical_frame_indices = [3]
        seq = saved.candidates[0].attack_sequence
        seq['version'] = 5
        seq['rhythm'] = {'target_ratio': [1, 2, 1], 'requested_frames': {'preparation': 4, 'attack': 8, 'recovery': 4}}
        for i, count in enumerate([4, 12]):
            seq['stages'][i].update(frame_count=count, prompt=f'Frozen version 5 stage {i}')
        reserved = copy.deepcopy(seq)
    with patch.object(VisionReviewer, 'review', return_value=PASS):
        service.generate_job(job.job_id, wait=False)
        with patch('sprite_pipeline.attack_sequence.phase_prompts', side_effect=AssertionError('Do not rewrite reserved prompts')):
            done = SpritePipelineService(service.settings.root).generate_job(job.job_id)
    assert [r.frame_count for r in provider.requests] == [4, 12]
    assert [r.prompt for r in provider.requests] == [s['prompt'] for s in reserved['stages']]
    assert done.candidates[0].attack_sequence['version'] == 5
    assert done.candidates[0].attack_sequence['rhythm'] == reserved['rhythm']
    assert provider.requests[1].reference_image == FixedAttackGeneration(service).saved_frames(job.job_id, 1, 0)[-1]
    assert provider.requests[1].last_frame == (service.store.job_dir(job.job_id) / 'input/reference.png').read_bytes()
    assert done.action.critical_frame_indices == [3] and len(done.candidates[0].frames) == 16


@pytest.mark.parametrize('count,counts', [(8, [4, 4]), (10, [4, 6]), (12, [4, 8]), (14, [6, 8]), (16, [6, 10])])
def test_short_ground_attacks_keep_supported_counts_and_actual_boundary(anchored, count, counts):
    service, provider, fixture = anchored
    job = create(anchored, frames=count)
    timing = phase_timing(job.action)
    assert sum(timing.values()) == count
    with patch.object(VisionReviewer, 'review', return_value=PASS):
        done = service.generate_job(job.job_id)
    assert [r.frame_count for r in provider.requests] == counts
    assert all(r.frame_count >= 4 and r.frame_count % 2 == 0 for r in provider.requests)
    assert f"final {timing['recovery']} frames return the SAME lead foot" in provider.requests[1].prompt
    assert done.candidates[0].attack_sequence['handoff_frames'] == [counts[0] + 1]
    assert len(done.candidates[0].frames) == count


def test_six_ten_reserves_five_units_before_either_paid_request(anchored):
    service, provider, fixture = anchored
    preset = service.presets.character_path(fixture.character_id)
    data = json.loads(preset.read_text(encoding='utf-8'))
    data.update(cell_width=128, cell_height=128)
    preset.write_text(json.dumps(data), encoding='utf-8')
    Image.new('RGBA', (128, 128), (30, 80, 150, 255)).save(fixture.reference_path)
    estimate = service.estimate_pixellab_generation_units(fixture.character_id, 'attack', candidate_count=2)
    assert estimate['segment_frame_counts'] == [6, 10]
    assert estimate['maximum_generation_units'] == 10
    assert estimate['maximum_visual_reviews'] == 4
    job = create(anchored)
    provider.get_balance = lambda: {'subscription': {'generations': 4}}
    with patch.object(SpritePipelineService, '_check_submission_quota', CHECK_QUOTA):
        with pytest.raises(ValidationHarnessError):
            service.generate_job(job.job_id)
    assert provider.requests == []
    assert service.get_job(job.job_id).candidates[0].error['details']['requested_generation_units'] == 5
