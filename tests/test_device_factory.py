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
