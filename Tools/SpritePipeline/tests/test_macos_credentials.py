import base64
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from sprite_pipeline import credential_store as module
from sprite_pipeline.credential_store import CredentialStore


@pytest.fixture
def keychain(monkeypatch):
    secrets = {}
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setattr(module.macos_keychain, "put", lambda account, value: secrets.__setitem__(account, value))
    monkeypatch.setattr(module.macos_keychain, "get", lambda account: secrets[account])
    monkeypatch.setattr(module.macos_keychain, "delete", lambda account: secrets.pop(account, None))
    return secrets


def test_keychain_save_replace_clear_and_legacy_migration(tmp_path, keychain):
    store = CredentialStore(tmp_path)
    store.path.write_text(json.dumps({"secrets": {"pixellab_api_key": {"protection": "restricted-local-file", "value": base64.b64encode(b"legacy-fixture").decode()}}}), encoding="utf-8")
    assert store.get("pixellab_api_key") == "legacy-fixture"
    assert store.protection == "macos-keychain"
    assert "legacy-fixture" not in store.path.read_text()
    assert len(keychain) == 1
    store.set("pixellab_api_key", "replacement-fixture")
    assert CredentialStore(tmp_path).get("pixellab_api_key") == "replacement-fixture"
    assert len(keychain) == 1
    store.set("pixellab_api_key", None)
    assert store.get("pixellab_api_key") is None
    assert not keychain


def test_failed_write_preserves_old_credential(tmp_path, keychain, monkeypatch):
    store = CredentialStore(tmp_path)
    store.set("pixellab_api_key", "existing-fixture")
    def fail(*args):
        raise OSError("fixture: disk unavailable")
    monkeypatch.setattr(module, "atomic_write_json", fail)
    with pytest.raises(OSError):
        store.set("pixellab_api_key", "replacement-fixture")
    assert store.get("pixellab_api_key") == "existing-fixture"
    assert len(keychain) == 1


def test_keychain_denial_does_not_fall_back_to_plaintext(tmp_path, keychain, monkeypatch):
    def fail(*args):
        raise RuntimeError("fixture: access denied")
    monkeypatch.setattr(module.macos_keychain, "put", fail)
    store = CredentialStore(tmp_path)
    with pytest.raises(RuntimeError):
        store.set("pixellab_api_key", "never-write-this-fixture")
    assert not store.path.exists()


def test_macos_data_directory_keeps_existing_installations(tmp_path, monkeypatch):
    from sprite_pipeline import settings
    monkeypatch.setattr(settings, "os", SimpleNamespace(name="posix", environ={}))
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    native = tmp_path / "Library" / "Application Support" / "SpritePipeline"
    legacy = tmp_path / ".local" / "share" / "SpritePipeline"
    assert settings._default_data_root() == native
    legacy.mkdir(parents=True)
    assert settings._default_data_root() == legacy
    native.mkdir(parents=True)
    assert settings._default_data_root() == native


@pytest.mark.skipif(sys.platform != "darwin", reason="requires native macOS Keychain")
def test_native_keychain_roundtrip(tmp_path):
    store = CredentialStore(tmp_path)
    try:
        store.set("pixellab_api_key", "native-keychain-fixture")
        assert CredentialStore(tmp_path).get("pixellab_api_key") == "native-keychain-fixture"
        assert "native-keychain-fixture" not in store.path.read_text()
    finally:
        store.set("pixellab_api_key", None)
