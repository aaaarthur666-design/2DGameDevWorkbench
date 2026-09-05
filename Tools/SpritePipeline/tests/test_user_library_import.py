import json
from dataclasses import replace
from pathlib import Path

from sprite_pipeline.settings import HarnessSettings
from sprite_pipeline.user_library_import import import_user_library


def setup_library(tmp_path, monkeypatch):
    from sprite_pipeline import user_library_import
    source = tmp_path / 'standalone'
    source.mkdir()
    monkeypatch.setattr(user_library_import, '_default_data_root', lambda: source)
    monkeypatch.setenv('SPRITE_PIPELINE_IMPORT_USER_ASSETS', '1')
    settings = HarnessSettings.load(tmp_path / 'destination')
    settings.ensure_directories()
    settings = replace(settings, portable_mode=False)
    return source, settings


def job(root, name, provider='pixellab', content=b'original-frame', status='review_required'):
    target = root / 'jobs' / name
    target.mkdir(parents=True)
    (target / 'job.json').write_text(json.dumps({
        'job_id': name, 'revision': 1, 'request': {'provider': provider},
        'status': status, 'candidates': [],
    }), encoding='utf-8')
    (target / 'frame.png').write_bytes(content)
    return target


def test_import_preserves_images_and_characters_and_does_not_resurrect(tmp_path, monkeypatch):
    source, settings = setup_library(tmp_path, monkeypatch)
    old = job(source, '20260903_character_walk_001')
    character = source / 'characters' / 'character'
    character.mkdir(parents=True)
    (character / 'character.json').write_text('{}', encoding='utf-8')
    (character / 'reference.png').write_bytes(b'reference-image')
    before = {p.relative_to(source): p.read_bytes() for p in source.rglob('*') if p.is_file()}
    report = import_user_library(settings)
    assert report['copied_jobs'] == 1
    assert report['copied_characters'] == 1
    dest = settings.jobs_dir / old.name
    assert (dest / 'frame.png').read_bytes() == b'original-frame'
    assert (settings.user_characters_dir / 'character/reference.png').read_bytes() == b'reference-image'
    assert before == {p.relative_to(source): p.read_bytes() for p in source.rglob('*') if p.is_file()}
    assert import_user_library(settings)['copied_jobs'] == 0
    (dest / 'frame.png').unlink()
    assert import_user_library(settings)['copied_jobs'] == 0
    assert not (dest / 'frame.png').exists()


def test_import_preserves_conflicting_current_job_and_skips_fixtures(tmp_path, monkeypatch):
    source, settings = setup_library(tmp_path, monkeypatch)
    name = '20260903_character_walk_001'
    job(source, name)
    current = settings.jobs_dir / name
    current.mkdir()
    (current / 'job.json').write_text('{}', encoding='utf-8')
    (current / 'frame.png').write_bytes(b'newer-local-frame')
    job(source, '20260904_diagnostic_dummy_idle_001', provider='fixture')
    job(source, '20260904_character_walk_002', status='provider_pending')
    report = import_user_library(settings)
    assert len(report['conflicts']) == 1
    assert (current / 'frame.png').read_bytes() == b'newer-local-frame'
    assert (Path(report['conflicts'][0]['destination']) / 'frame.png').read_bytes() == b'original-frame'
    assert not (settings.jobs_dir / '20260904_diagnostic_dummy_idle_001').exists()
    assert not (settings.jobs_dir / '20260904_character_walk_002').exists()
    assert import_user_library(settings)['conflicts'] == []


def test_import_requires_opt_in_and_skips_portable_settings(tmp_path, monkeypatch):
    source, settings = setup_library(tmp_path, monkeypatch)
    job(source, '20260903_character_walk_001')
    assert import_user_library(replace(settings, portable_mode=True))['status'] == 'disabled'
    monkeypatch.setenv('SPRITE_PIPELINE_IMPORT_USER_ASSETS', '0')
    assert import_user_library(settings)['status'] == 'disabled'
    assert not (settings.jobs_dir / '20260903_character_walk_001').exists()
