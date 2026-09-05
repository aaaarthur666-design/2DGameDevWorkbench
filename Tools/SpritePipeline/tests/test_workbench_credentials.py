import os
import subprocess
import sys

from sprite_pipeline.credential_store import CredentialStore
from sprite_pipeline.settings import HarnessSettings


def test_workbench_import_survives_restart_and_respects_clear(tmp_path, monkeypatch):
    from sprite_pipeline import settings

    old_root = tmp_path / 'standalone'
    new_root = tmp_path / 'workbench'
    monkeypatch.setattr(settings, '_default_data_root', lambda: old_root)
    monkeypatch.delenv('SPRITE_PIPELINE_HOME', raising=False)
    monkeypatch.delenv('PIXELLAB_API_KEY', raising=False)
    monkeypatch.setenv('SPRITE_PIPELINE_DATA_DIR', str(new_root))
    monkeypatch.setenv('SPRITE_PIPELINE_IMPORT_USER_CREDENTIALS', '1')
    CredentialStore(old_root / 'config').set('pixellab_api_key', 'dummy-persistent-key')

    assert HarnessSettings.load().pixellab_api_key == 'dummy-persistent-key'
    # A fresh process reads its own persisted configuration, without migration.
    env = {**os.environ, 'SPRITE_PIPELINE_IMPORT_USER_CREDENTIALS': '0'}
    result = subprocess.run(
        [sys.executable, '-c',
         "from sprite_pipeline.settings import HarnessSettings; "
         "assert HarnessSettings.load().pixellab_api_key == 'dummy-persistent-key'"],
        env=env, capture_output=True, text=True,
    )
    assert result.returncode == 0, 'Fresh process failed to restore credential'
    store = CredentialStore(new_root / 'config')
    store.set('pixellab_api_key', 'newer-workbench-key')
    assert HarnessSettings.load().pixellab_api_key == 'newer-workbench-key'
    store.set('pixellab_api_key', None)
    assert HarnessSettings.load().pixellab_api_key is None
    assert CredentialStore(old_root / 'config').get('pixellab_api_key') == 'dummy-persistent-key'


def test_portable_root_does_not_import_user_key(tmp_path, monkeypatch):
    from sprite_pipeline import settings

    old_root = tmp_path / 'standalone'
    monkeypatch.setattr(settings, '_default_data_root', lambda: old_root)
    monkeypatch.delenv('PIXELLAB_API_KEY', raising=False)
    monkeypatch.setenv('SPRITE_PIPELINE_IMPORT_USER_CREDENTIALS', '1')
    CredentialStore(old_root / 'config').set('pixellab_api_key', 'dummy-user-key')
    assert HarnessSettings.load(tmp_path / 'portable').pixellab_api_key is None
