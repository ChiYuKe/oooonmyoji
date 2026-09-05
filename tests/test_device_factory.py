from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from src.oooonmyoji.config import load_config
from src.oooonmyoji.devices import factory


ROOT = Path(__file__).resolve().parents[1]


def test_resolve_adb_path_discovers_mumu_when_path_is_implicit(tmp_path: Path, monkeypatch) -> None:
    mumu_path = tmp_path / "MuMuPlayer-12.0"
    adb_path = mumu_path / "nx_device" / "12.0" / "shell" / "adb.exe"
    adb_path.parent.mkdir(parents=True)
    adb_path.write_bytes(b"fake adb")
    config = load_config(ROOT / "config" / "config.example.json")
    config = replace(config, mumu_path=None, adb_path=None)
    monkeypatch.setattr(factory, "discover_mumu_path", lambda: mumu_path)

    assert factory.resolve_adb_path(config) == str(adb_path)


def test_mumu_backend_receives_scoped_adb_key_fallback(monkeypatch) -> None:
    config = load_config(ROOT / "config" / "config.example.json")
    instance = config.instances[0]
    captured: dict[str, object] = {}

    class FakeMumu:
        def __init__(self, *args, **kwargs) -> None:
            captured["args"] = args
            captured["kwargs"] = kwargs

    monkeypatch.setattr(factory, "MumuDevice", FakeMumu)
    backend = factory.create_backend(config, instance)

    assert isinstance(backend, FakeMumu)
    assert captured["kwargs"] == {
        "adb_serial": instance.adb_serial,
        "adb_path": factory.resolve_adb_path(config),
    }
