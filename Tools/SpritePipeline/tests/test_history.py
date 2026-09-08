import hashlib

import pytest
from fastapi.testclient import TestClient
from sprite_pipeline.api_app import create_api
from sprite_pipeline.artwork_library import ArtworkLibrary
from sprite_pipeline.asset_catalog import AssetCatalog
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


def test_archived_animation_keeps_inventory_details_and_downloads_after_restart(tmp_path):
    fixture = TemporaryHarness(tmp_path)
    service = SpritePipelineService(tmp_path)
    job = service.create_job({**fixture.create_request("import"), "candidate_count": 3})
    fixture.write_sequence(tmp_path / "incoming")
    for candidate in (1, 2):
        service.ingest_candidate(job.job_id, candidate, tmp_path / "incoming")
    service.approve_candidate(job.job_id, 2, reviewer="archive-test", acknowledge_warnings=True)
    service.export_candidate(job.job_id, 2)
    catalog = AssetCatalog(service)
    assets = catalog.list()["assets"]
    details = {row["id"]: catalog.detail(row["id"])
               for row in assets if row["kind"] == "animation"}
    assert set(details) == {f"animation:{job.job_id}:1", f"animation:{job.job_id}:2"}
    assert "godot" in {file["key"] for file in details[f"animation:{job.job_id}:2"]["files"]}
    evidence = service.get_job(job.job_id).model_dump_json()

    assert service.archive_history()["count"] == 1
    for current in (service, SpritePipelineService(tmp_path)):
        with TestClient(create_api(service=current)) as client:
            assert client.get("/v1/jobs").json()["data"]["jobs"] == []
            assert client.get("/v1/artworks").json()["data"]["assets"] == assets
            for asset_id, detail in details.items():
                assert ArtworkLibrary(current).get(asset_id)["id"] == asset_id
                response = client.get(f"/v1/artworks/{asset_id}")
                assert response.status_code == 200
                assert response.json()["data"]["asset"] == detail
                for file in detail["files"]:
                    download = client.get("/v1/artworks/file", params={"asset_id": asset_id, "key": file["key"]})
                    assert download.status_code == 200
                    assert hashlib.sha256(download.content).hexdigest() == file["sha256"]
            assert client.get(f"/v1/artworks/animation:{job.job_id}:3").status_code == 404
        assert current.get_job(job.job_id).model_dump_json() == evidence

    new_job = service.create_job(fixture.create_request("import"))
    assert [row["job_id"] for row in service.list_jobs()] == [new_job.job_id]
    assert catalog.list()["assets"] == assets
