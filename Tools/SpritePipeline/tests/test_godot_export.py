import hashlib
import json
import os
from pathlib import Path
import subprocess
from unittest.mock import patch
import zipfile

import pytest
from PIL import Image
from fastapi.testclient import TestClient
from sprite_pipeline.api_app import create_api
from sprite_pipeline.asset_catalog import AssetCatalog
from sprite_pipeline.errors import ExportBlockedError
from sprite_pipeline.processing.godot_export import build_godot_package
from sprite_pipeline.service import SpritePipelineService
from sprite_pipeline.ui import _export_download_files, build_ui
from test_harness_integration import TemporaryHarness


@pytest.fixture
def approved(tmp_path):
    harness = TemporaryHarness(tmp_path)
    service = SpritePipelineService(tmp_path)
    job = service.create_job(harness.create_request('import'))
    harness.write_sequence(tmp_path / 'incoming')
    service.ingest_candidate(job.job_id, 1, tmp_path / 'incoming')
    service.approve_candidate(job.job_id, 1, reviewer='export-test', acknowledge_warnings=True)
    return service, job.job_id


def read_package(path):
    with zipfile.ZipFile(path) as z:
        contents = {name: z.read(name) for name in z.namelist()}
    contract = json.loads(next(v for k, v in contents.items() if k.endswith('/export.json')))
    return contents, contract


def test_approved_export_delivers_godot_via_api_inventory_and_ui(approved):
    service, job_id = approved
    job = service.export_candidate(job_id, 1)
    record = job.export
    package = service.settings.resolve_record_path(record.godot_package_path)
    files, contract = read_package(package)
    assert hashlib.sha256(package.read_bytes()).hexdigest() == record.godot_sha256
    assert contract['frame_count'] == 4
    assert contract['fps'] == job.action.fps
    assert contract['loop'] == job.action.loop
    assert contract['animation'] == (job.action.manifest_action_name or job.action.action_id)
    assert files[contract['sprite_frames'].removeprefix('res://')].startswith(b'[gd_resource type="SpriteFrames"')
    assert not any(name.endswith('project.godot') for name in files)
    assert len(files) == 5
    assert not contract['engine_validated']
    before = service.get_job(job_id).model_dump_json()
    client = TestClient(create_api(service=service))
    response = client.get(f'/v1/jobs/{job_id}/exports/godot')
    assert response.status_code == 200 and response.headers['content-type'] == 'application/zip'
    assert response.content == package.read_bytes()
    detail = AssetCatalog(service).detail(f'animation:{job_id}:1')
    assert next(f for f in detail['files'] if f['key'] == 'godot')['sha256'] == record.godot_sha256
    again = _export_download_files(service, job_id, 1)
    assert again[1] == str(package.resolve())
    assert _export_download_files(service, job_id, 2) == (None, None, [])
    assert service.get_job(job_id).model_dump_json() == before


def test_old_exports_remain_readable_without_a_package(approved):
    service, job_id = approved
    service.export_candidate(job_id, 1)
    with service.store.locked_job(job_id) as job:
        job.export.godot_package_path = None
        job.export.godot_sha256 = None
    client = TestClient(create_api(service=service))
    assert client.get(f'/v1/jobs/{job_id}/exports/sheet').status_code == 200
    assert client.get(f'/v1/jobs/{job_id}/exports/godot').status_code == 404
    assert _export_download_files(service, job_id, 1)[0]
    assert _export_download_files(service, job_id, 1)[1] is None


def test_godot_failure_does_not_publish_partial_files(approved):
    service, job_id = approved
    with patch('sprite_pipeline.processing.godot_export.build_godot_package', side_effect=RuntimeError('zip construction failed')):
        with pytest.raises(RuntimeError, match='zip construction'):
            service.export_candidate(job_id, 1)
    assert service.get_job(job_id).export is None
    assert not list(service.settings.exports_dir.rglob('*.*'))


def test_zip_publish_failure_restores_entire_previous_bundle(approved):
    service, job_id = approved
    service.export_candidate(job_id, 1)
    before_job = service.get_job(job_id).model_dump_json()
    before_files = {p: p.read_bytes() for p in service.settings.exports_dir.rglob('*') if p.is_file()}
    real_copy = service._atomic_copy
    failed = False
    def fail_once(source, target):
        nonlocal failed
        if str(target).endswith('.godot.zip') and not failed:
            failed = True
            raise OSError('zip publish failed')
        return real_copy(source, target)
    with patch.object(service, '_atomic_copy', side_effect=fail_once):
        with pytest.raises(OSError, match='zip publish'):
            service.export_candidate(job_id, 1, {'overwrite': True})
    assert failed
    assert service.get_job(job_id).model_dump_json() == before_job
    assert {p: p.read_bytes() for p in service.settings.exports_dir.rglob('*') if p.is_file()} == before_files


def test_modified_frame_cannot_bypass_export_gate(approved):
    service, job_id = approved
    job = service.get_job(job_id)
    frame = service.store.resolve_job_path(job_id, job.candidates[0].frames[0].active_path)
    with Image.open(frame) as im:
        changed = im.copy()
    changed.putpixel((1, 1), (255, 0, 0, 255))
    changed.save(frame)
    with pytest.raises(ExportBlockedError):
        service.export_candidate(job_id, 1)
    assert service.get_job(job_id).export is None
    assert not list(service.settings.exports_dir.rglob('*.godot.zip'))


def test_export_button_returns_download_and_restores_selection(approved):
    service, job_id = approved
    ui = build_ui(service=service)
    try:
        callback = next(fn for fn in ui.fns.values() if fn.name == 'export_one')
        result = callback.fn(job_id, 1, '角色动画.png', False)
        assert len(result) == len(callback.outputs) == 5
        assert result[-1]['ok'] is True
        assert Path(result[2]).name == '角色动画.godot.zip'
        downloads = next(fn for fn in ui.fns.values() if fn.name == 'export_downloads')
        assert downloads.fn(job_id, 1)[1] == result[2]
        assert callback.outputs[2].label == 'Godot SpriteFrames 包（ZIP）'
    finally:
        ui.close()


def package_fixture(tmp_path, loop=False, candidate_index=1):
    sheet = tmp_path / 'sheet.png'
    im = Image.new('RGBA', (128, 128), (0, 0, 0, 0))
    im.paste(Image.new('RGBA', (64, 64), '#ff0000'), (64, 64))
    im.paste(Image.new('RGBA', (64, 64), '#00ff00'), (0, 0))
    im.paste(Image.new('RGBA', (64, 64), '#0000ff'), (64, 0))
    im.save(sheet)
    recipe = {'job_id': 'fixture_job', 'candidate_index': candidate_index, 'character_id': 'hero',
              'action_id': 'idle' if loop else 'hurt', 'manifest_action_name': 'idle' if loop else 'hit',
              'sheet_sha256': hashlib.sha256(sheet.read_bytes()).hexdigest(),
              'cell_width': 64, 'cell_height': 64, 'frame_count': 3, 'runtime_fps': 12.5,
              'loop': loop, 'source_region_px': [[64, 64, 64, 64], [0, 0, 64, 64], [64, 0, 64, 64]]}
    target = tmp_path / f'{candidate_index}.godot.zip'
    result = build_godot_package(sheet, target, recipe, anchor_x=30, ground_y=60, facing='left')
    return sheet, target, recipe, result


def test_package_preserves_irregular_order_alias_alpha_and_is_deterministic(tmp_path):
    sheet, target, recipe, result = package_fixture(tmp_path)
    original = target.read_bytes()
    files, contract = read_package(target)
    assert contract['source_region_px'] == recipe['source_region_px']
    assert contract['animation'] == 'hit'
    assert contract['visual_offset'] == [2, -28]
    assert next(v for k, v in files.items() if k.endswith('/sprite-sheet.png')) == sheet.read_bytes()
    build_godot_package(sheet, target, recipe, anchor_x=30, ground_y=60, facing='left')
    assert target.read_bytes() == original
    recipe['candidate_index'] = 2
    other = build_godot_package(sheet, target, recipe, anchor_x=30, ground_y=60, facing='left')
    assert other['resource_path'] != result['resource_path']
    recipe['source_region_px'][0] = [120, 0, 64, 64]
    with pytest.raises(ValueError, match='geometry'):
        build_godot_package(sheet, target, recipe, anchor_x=30, ground_y=60, facing='left')


def test_package_import_and_playback_in_godot_46(tmp_path):
    godot = os.environ.get('GODOT_46_BIN')
    if not godot:
        pytest.skip('Set GODOT_46_BIN for real engine import/playback; static success is not engine validation')
    version = subprocess.check_output([godot, '--version'], text=True).strip()
    assert version.startswith('4.6.'), version
    project = tmp_path / 'project'
    project.mkdir()
    results = []
    for loop, candidate in ((False, 1), (True, 2)):
        _sheet, archive, _recipe, result = package_fixture(tmp_path, loop=loop, candidate_index=candidate)
        with zipfile.ZipFile(archive) as z:
            for name in z.namelist():
                dest = (project / name).resolve()
                assert dest.is_relative_to(project.resolve())
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(z.read(name))
        results.append(result)
    (project / 'project.godot').write_text('[application]\nconfig/name="Sprite package test"\nconfig/features=PackedStringArray("4.6")\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n', encoding='utf-8')
    gd = Path(__file__).with_name('godot_package_probe.gd').read_text(encoding='utf-8')
    gd = gd.replace('ONCE', json.dumps(results[0]['scene_path'])).replace('REPEATING', json.dumps(results[1]['scene_path']))
    (project / 'probe.gd').write_text(gd, encoding='utf-8')
    for args in (['--editor', '--import'], ['--script', 'res://probe.gd']):
        run = subprocess.run([godot, '--headless', '--path', str(project), *args], capture_output=True, text=True, encoding='utf-8', timeout=45)
        output = run.stdout + run.stderr
        assert run.returncode == 0 and 'ERROR:' not in output, output
    assert 'SPRITE_GODOT_PACKAGE_OK' in output
