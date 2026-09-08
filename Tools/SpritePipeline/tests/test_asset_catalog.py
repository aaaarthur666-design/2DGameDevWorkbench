import hashlib
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient
from sprite_pipeline.api_app import create_api
from sprite_pipeline.asset_catalog import AssetCatalog
from sprite_pipeline.service import SpritePipelineService
from test_harness_integration import TemporaryHarness


def test_inventory_exact_candidate_and_files_are_read_only():
    with tempfile.TemporaryDirectory(prefix="catalog-test-") as directory:
        fixture = TemporaryHarness(Path(directory))
        service = SpritePipelineService(Path(directory))
        job = service.create_job({**fixture.create_request('import'), 'candidate_count': 3})
        fixture.write_sequence(fixture.root / 'inputs')
        service.ingest_candidate(job.job_id, 2, fixture.root / 'inputs')
        before = service.get_job(job.job_id).model_dump_json()
        catalog = AssetCatalog(service)
        rows = catalog.list()['assets']
        animations = [a for a in rows if a['kind'] == 'animation']
        assert len(animations) == 1
        selected = animations[0]
        assert selected['candidateIndex'] == 2 and selected['candidateCount'] == 3
        assert selected['frameCount'] == 4
        client = TestClient(create_api(service=service))
        assert client.get('/v1/artworks').json()['data']['assets'] == rows
        detail = client.get('/v1/artworks/' + selected['id']).json()['data']['asset']
        assert detail['width'] == 64 and detail['height'] == 64
        frame = next(f for f in detail['files'] if f['key'] == 'frame-1')
        image = client.get('/v1/artworks/file', params={'asset_id': selected['id'], 'key': 'frame-1'})
        assert image.status_code == 200
        assert hashlib.sha256(image.content).hexdigest() == frame['sha256']
        assert client.get('/v1/artworks/file', params={'asset_id': selected['id'], 'key': '../../config/credentials.json'}).status_code == 404
        assert client.get('/v1/artworks/' + f'animation:{job.job_id}:1').status_code == 404
        Path(frame['path']).unlink()
        missing = catalog.detail(selected['id'])
        assert next(f for f in missing['files'] if f['key'] == 'frame-1')['available'] is False
        assert service.get_job(job.job_id).model_dump_json() == before


def test_fixture_and_empty_jobs_do_not_become_assets():
    with tempfile.TemporaryDirectory(prefix="catalog-test-") as directory:
        fixture = TemporaryHarness(Path(directory))
        service = SpritePipelineService(Path(directory))
        empty = service.create_job(fixture.create_request('import'))
        diagnostic = service.create_job(fixture.create_request('fixture'))
        service.generate_job(diagnostic.job_id)
        assert not [a for a in AssetCatalog(service).list()['assets'] if a.get('jobId') in [empty.job_id, diagnostic.job_id]]
