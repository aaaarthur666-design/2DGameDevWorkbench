"""Attack timing reaches both paid requests without rewriting existing plans."""
import copy
import json
from unittest.mock import patch
import pytest
from PIL import Image
from test_attack_sequence import setup_sequence, create
from test_motion_correction import PASS
from sprite_pipeline.attack_sequence import phase_timing, FixedAttackGeneration
from sprite_pipeline.errors import ConflictError, ValidationHarnessError
from sprite_pipeline.service import SpritePipelineService
from sprite_pipeline.vision_review import VisionReviewer

CHECK_QUOTA = SpritePipelineService._check_submission_quota


@pytest.mark.parametrize("action", ["attack", "attack_in_air"])
def test_quarter_half_quarter_reaches_requests_with_unchanged_cost_limit(setup_sequence, action):
    s, p, f = setup_sequence
    job = create(setup_sequence, action=action)
    plan = copy.deepcopy(job.candidates[0].attack_sequence)
    assert plan["rhythm"]["requested_frames"] == {"preparation": 4, "attack": 8, "recovery": 4}
    with patch.object(VisionReviewer, "review", return_value=PASS) as review:
        done = s.generate_job(job.job_id)
        s.generate_job(job.job_id)
    assert [r.frame_count for r in p.requests] == [4, 12]
    assert "first 8 frames" in p.requests[1].prompt and "final 4 frames" in p.requests[1].prompt
    assert "follow-through" in p.requests[1].prompt and "decelerate" in p.requests[1].prompt
    assert "NO handoff" in p.requests[1].prompt and "no added cape" in p.requests[1].prompt
    assert all(len(r.prompt) <= 1000 for r in p.requests)
    assert sum(s._pixellab_generation_units(128, 128, r.frame_count) for r in p.requests) == 4
    assert len(done.candidates[0].frames) == 17  # Preserve extra returned frames, only deduplicate identical seam.
    assert review.call_count == 1 and len(review.call_args.args[0]) == 17
    assert done.candidates[0].attack_sequence["rhythm"] == plan["rhythm"]
    assert done.motion_control["maximum_extra_generations"] == 0


@pytest.mark.parametrize("count,timing", [(8, (4, 2, 2)), (10, (4, 4, 2)), (12, (4, 5, 3)), (14, (4, 7, 3)), (16, (4, 8, 4))])
def test_short_sequences_keep_legal_requests_and_visible_recovery(setup_sequence, count, timing):
    s, p, f = setup_sequence
    job = create(setup_sequence, frames=count)
    assert phase_timing(job.action) == dict(zip(["preparation", "attack", "recovery"], timing))
    with patch.object(VisionReviewer, "review", return_value=PASS):
        done = s.generate_job(job.job_id)
    assert sum(r.frame_count for r in p.requests) == count
    assert all(4 <= r.frame_count <= 16 and r.frame_count % 2 == 0 for r in p.requests)
    assert f"first {timing[1]} frames" in p.requests[1].prompt
    assert f"final {timing[2]} frames" in p.requests[1].prompt
    assert len(done.candidates[0].frames) == count + 1


@pytest.mark.parametrize("version", [1, 2])
def test_legacy_plan_keeps_original_counts_prompts_and_endpoint(setup_sequence, version):
    s, p, f = setup_sequence
    job = create(setup_sequence)
    with s.store.locked_job(job.job_id) as old:
        seq = old.candidates[0].attack_sequence
        seq["version"] = version
        seq.pop("rhythm")
        if version == 1:
            seq.pop("grip_contract")
        for index, stage in enumerate(seq["stages"]):
            stage.update(frame_count=8, prompt=f"Reserved old stage {index}")
    with patch.object(VisionReviewer, "review", return_value=PASS):
        s.generate_job(job.job_id, wait=False)
        restarted = SpritePipelineService(s.settings.root)
        restarted.generate_job(job.job_id)
    assert [r.frame_count for r in p.requests] == [8, 8]
    assert [r.prompt for r in p.requests] == ["Reserved old stage 0", "Reserved old stage 1"]
    assert bool(p.requests[1].last_frame) == (version == 1)


def test_legacy_quota_reserves_saved_six_plus_six_not_new_four_plus_eight(setup_sequence):
    s, p, f = setup_sequence
    preset = s.presets.character_path(f.character_id)
    data = json.loads(preset.read_text(encoding="utf-8"))
    data.update(cell_width=128, cell_height=128)
    preset.write_text(json.dumps(data), encoding="utf-8")
    Image.new("RGBA", (128, 128), (30, 80, 150, 255)).save(f.reference_path)
    job = create(setup_sequence, frames=12)
    with s.store.locked_job(job.job_id) as old:
        seq = old.candidates[0].attack_sequence
        seq["version"] = 2
        seq.pop("rhythm")
        for stage in seq["stages"]:
            stage["frame_count"] = 6
    p.get_balance = lambda: {"subscription": {"generations": 3}}
    with patch.object(SpritePipelineService, "_check_submission_quota", CHECK_QUOTA):
        with pytest.raises(ValidationHarnessError):
            s.generate_job(job.job_id)
    assert p.requests == []
    error = s.get_job(job.job_id).candidates[0].error
    assert error["details"]["requested_generation_units"] == 4


def test_restart_uses_saved_rhythm_even_when_defaults_later_change(setup_sequence):
    s, p, f = setup_sequence
    job = create(setup_sequence)
    with patch.object(VisionReviewer, "review", return_value=PASS):
        s.generate_job(job.job_id, wait=False)
        with patch("sprite_pipeline.attack_sequence.phase_prompts", side_effect=AssertionError("must use reserved prompt")), patch("sprite_pipeline.attack_sequence.segment_counts", return_value=[8, 8]):
            SpritePipelineService(s.settings.root).generate_job(job.job_id)
    assert [r.frame_count for r in p.requests] == [4, 12]
    assert "first 8 frames" in p.requests[1].prompt


def test_conflicting_timing_cannot_create_a_paid_request(setup_sequence):
    s, p, f = setup_sequence
    job = create(setup_sequence)
    with s.store.locked_job(job.job_id) as changed:
        changed.candidates[0].attack_sequence["rhythm"]["requested_frames"]["attack"] = 12
    with pytest.raises(ConflictError, match="节奏"):
        s.generate_job(job.job_id)
    assert p.requests == []
