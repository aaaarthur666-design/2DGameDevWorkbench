from unittest.mock import patch

import pytest

from test_motion_correction import setup, create, FAIL, PASS
from sprite_pipeline.errors import ConflictError
from sprite_pipeline.models import ReviewStatus, CandidateStatus
from sprite_pipeline.motion_correction import MotionCorrection
from sprite_pipeline.vision_review import VisionReviewer


@pytest.mark.parametrize("status", [ReviewStatus.pending, ReviewStatus.approved, ReviewStatus.repair_requested])
@pytest.mark.parametrize("action,phase", [("attack", "charge"), ("attack_in_air", "extend")])
def test_explicit_repair_can_propose_any_selected_editable_frame(setup, status, action, phase):
    service, provider, _ = setup
    with patch.object(VisionReviewer, "review", side_effect=[FAIL, PASS]):
        job = service.generate_job(create(setup, action).job_id)
        target = 8  # An untagged frame, not the automatically flagged seventh frame.
        with service.store.locked_job(job.job_id) as saved:
            saved.candidates[0].frames[target].review_status = status
        job = service.get_job(job.job_id)
        frames = job.candidates[0].frames
        assert not frames[target].motion_tags
        before = [f.model_dump(mode="json") for f in frames]
        control = MotionCorrection(service)
        attempt = control.manual(job.job_id, 1, target, frames[target].sha256, phase=phase, wait=True)
        assert attempt["state"] == "proposed"
        assert attempt["targets"] == [target]
        assert attempt["constraints"]["phase"] == phase
        assert attempt["constraints"]["previous_frame"] == target - 1
        assert attempt["constraints"]["next_frame"] == target + 1
        assert [f.model_dump(mode="json") for f in service.get_job(job.job_id).candidates[0].frames] == before
        assert len(provider.requests) == 2
        # Refresh/repeated Generate reuses the proposal without spending again.
        assert control.manual(job.job_id, 1, target, frames[target].sha256, phase=phase)["id"] == attempt["id"]
        assert len(provider.requests) == 2
        adopted = control.adopt(job.job_id, attempt["id"], manual=True)
        assert adopted.candidates[0].frames[target].active_path != frames[target].active_path
        assert all(f.active_path == frames[i].active_path for i, f in enumerate(adopted.candidates[0].frames) if i != target)


@pytest.mark.parametrize("base, message", [(None, "尚未加载完成"), ("", "尚未加载完成"), ("stale", "已有新版本")])
def test_unmarked_frame_still_requires_current_version_before_spending(setup, base, message):
    service, provider, _ = setup
    with patch.object(VisionReviewer, "review", return_value=FAIL):
        job = service.generate_job(create(setup).job_id)
    with pytest.raises(ConflictError, match=message):
        MotionCorrection(service).manual(job.job_id, 1, 8, base, phase="charge")
    saved = service.get_job(job.job_id)
    assert saved.motion_control["attempts"] == []
    assert saved.candidates[0].frames[8].review_status == ReviewStatus.pending
    assert len(provider.requests) == 1


@pytest.mark.parametrize("status", [CandidateStatus.approved, CandidateStatus.rejected, CandidateStatus.failed])
def test_selected_frame_does_not_unlock_readonly_candidate(setup, status):
    service, provider, _ = setup
    with patch.object(VisionReviewer, "review", return_value=FAIL):
        job = service.generate_job(create(setup).job_id)
    with service.store.locked_job(job.job_id) as saved:
        saved.candidates[0].status = status
    with pytest.raises(ConflictError, match="terminal candidate"):
        MotionCorrection(service).manual(job.job_id, 1, 8, job.candidates[0].frames[8].sha256, phase="charge")
    assert len(provider.requests) == 1


def test_direct_selection_keeps_two_attempt_limit(setup):
    service, provider, _ = setup
    with patch.object(VisionReviewer, "review", return_value=PASS):
        job = service.generate_job(create(setup).job_id)
        control = MotionCorrection(service)
        frame = job.candidates[0].frames[8]
        assert frame.review_status == ReviewStatus.pending
        control.manual(job.job_id, 1, 8, frame.sha256, phase="charge", wait=True)
        control.manual(job.job_id, 1, 8, frame.sha256, phase="charge", retry=True, wait=True)
        with pytest.raises(ConflictError, match="两次上限"):
            control.manual(job.job_id, 1, 8, frame.sha256, phase="charge", retry=True, wait=True)
    assert len(provider.requests) == 3
    assert len(service.get_job(job.job_id).motion_control["attempts"]) == 2
