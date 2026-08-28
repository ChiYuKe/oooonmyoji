from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.oooonmyoji.config import load_config
from src.oooonmyoji.config.model import JobConfig
from src.oooonmyoji.devices.protocol import DeviceFrame
from src.oooonmyoji.runtime import runner as runner_module
from src.oooonmyoji.runtime.runner import TaskRunner


class StubDevice:
    width = 1920
    height = 1080

    def capture(self) -> DeviceFrame:
        return DeviceFrame(self.width, self.height, b"x", format="bgra")

    def tap(self, x: int, y: int, hold_ms: int = 0) -> None:
        return None

    def close(self) -> None:
        return None


def _setup(path: Path) -> object:
    (path / "config").mkdir(); (path / "workflows").mkdir(); (path / "plugins" / "actions").mkdir(parents=True)
    config_path = path / "config" / "config.json"
    config_path.write_text(json.dumps({
        "schema_version": 2, "timezone": "Asia/Shanghai", "workflow_dir": "workflows", "action_dir": "plugins/actions",
        "instances": [{"id": "fake", "backend": "adb", "adb_serial": "not-connected"}], "ocr": {"enabled": False}, "tasks": [],
        "retry": {"connection_attempts": 1, "capture_attempts": 1, "ocr_attempts": 1, "task_attempts": 1}, "log_dir": "logs", "artifact_dir": "artifacts",
    }), encoding="utf-8")
    return load_config(config_path)


def _write(path: Path, workflow_id: str, children: list[str]) -> None:
    definitions = {
        "first": {"id": "first", "type": "task", "action": "core.capture", "params": {}},
        "fail": {"id": "fail", "type": "task", "action": "core.assert", "params": {"value": False}},
        "last": {"id": "last", "type": "task", "action": "core.capture", "params": {}},
    }
    payload = {
        "schema_version": 3, "id": workflow_id, "version": "3.0.0", "resolution": [1920, 1080], "root": "root",
        "nodes": [
            {"id": "root", "type": "root", "children": ["sequence"]},
            {"id": "sequence", "type": "sequence", "children": children},
            *[definitions[child] for child in children],
        ],
    }
    (path / "workflows" / f"{workflow_id}.json").write_text(json.dumps(payload), encoding="utf-8")


def _run(config: object, workflow_id: str) -> object:
    job = JobConfig(id=f"run-{workflow_id}", workflow=workflow_id, instance="fake", inputs={}, schedule={"type": "manual"}, enabled=True, retry_enabled=False)
    return TaskRunner(config).execute(job, config.instance("fake"))


def test_sequence_runs_all_children_in_order(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = _setup(tmp_path); monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))
    _write(tmp_path, "sequence_ok", ["first", "last"])
    record = _run(config, "sequence_ok")
    assert record.status.value == "succeeded"
    ids = [event["step_id"] for event in record.step_history]
    assert ids.index("first") < ids.index("last")


def test_sequence_stops_after_first_failure(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = _setup(tmp_path); monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))
    _write(tmp_path, "sequence_fail", ["first", "fail", "last"])
    record = _run(config, "sequence_fail")
    assert record.status.value == "failed"
    ids = [event["step_id"] for event in record.step_history]
    assert "fail" in ids and "last" not in ids


def test_sequence_rejects_empty_children(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = _setup(tmp_path); monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))
    _write(tmp_path, "sequence_bad", [])
    record = _run(config, "sequence_bad")
    assert record.status.value == "failed"
    assert record.error_category == "config"
