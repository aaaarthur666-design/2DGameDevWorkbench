import pytest
from test_harness_integration import TemporaryHarness
from sprite_pipeline.service import SpritePipelineService
from sprite_pipeline.models import GenerationRequest, CandidateStatus
from sprite_pipeline.errors import ConflictError


def test_history_clear_preserves_job_evidence_and_new_jobs(tmp_path):
    fixture = TemporaryHarness(tmp_path)
    service = SpritePipelineService(tmp_path)
    request = GenerationRequest(character_id=fixture.character_id, action_id=fixture.action_id,
                                provider="import", request_key="history-original")
    job = service.create_job(request)
    service.archive_history(check_only=True)
    assert len(service.list_jobs()) == 1
    assert service.archive_history()["count"] == 1
    assert service.archive_history()["count"] == 0
    assert service.list_jobs() == []
    assert service.store.load(job.job_id).job_id == job.job_id
    assert service.create_job(request).job_id == job.job_id
    service.create_job(request.model_copy(update={"request_key": "history-new"}))
    assert len(SpritePipelineService(tmp_path).list_jobs()) == 1


def test_history_clear_refuses_pending_submission(tmp_path):
    fixture = TemporaryHarness(tmp_path)
    service = SpritePipelineService(tmp_path)
    job = service.create_job(GenerationRequest(character_id=fixture.character_id,
                            action_id=fixture.action_id, provider="import"))
    with service.store.locked_job(job.job_id) as saved:
        saved.candidates[0].status = CandidateStatus.submission_unknown
    with pytest.raises(ConflictError):
        service.archive_history()
    assert len(service.list_jobs()) == 1


def test_interrupted_offline_examples_do_not_block_history_clear(tmp_path):
    fixture = TemporaryHarness(tmp_path)
    service = SpritePipelineService(tmp_path)
    job = service.create_job(GenerationRequest(character_id=fixture.character_id,
                            action_id=fixture.action_id, provider="fixture"))
    with service.store.locked_job(job.job_id) as saved:
        saved.candidates[0].status = CandidateStatus.saving
    assert service.store.list_jobs()[0]["candidate_status_counts"] == {"saving": 1}
    service.archive_history(check_only=True)
    assert len(service.list_jobs()) == 1
    service.archive_history()
    assert service.list_jobs() == []
    assert service.store.load(job.job_id).candidates[0].status == CandidateStatus.saving
