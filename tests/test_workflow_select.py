from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest

from src.oooonmyoji.config import load_config
from src.oooonmyoji.config.model import JobConfig
from src.oooonmyoji.devices.protocol import DeviceFrame
from src.oooonmyoji.runtime import runner as runner_module
from src.oooonmyoji.runtime.runner import TaskRunner

TINY_PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")


class StubDevice:
    width = 1920
    height = 1080

    def capture(self) -> DeviceFrame:
        return DeviceFrame(self.width, self.height, TINY_PNG, format="png")

    def tap(self, x: int, y: int, hold_ms: int = 0) -> None:
        return None

    def close(self) -> None:
        return None


def _write_tree(path: Path, workflow_id: str, selector_children: list[str]) -> None:
    nodes: list[dict[str, object]] = [
        {"id": "root", "type": "root", "children": ["selector"]},
        {"id": "selector", "type": "selector", "children": selector_children},
        {"id": "fail", "type": "task", "action": "core.assert", "params": {"value": False}},
        {"id": "ok", "type": "task", "action": "core.capture", "params": {}},
        {"id": "fail_2", "type": "task", "action": "core.assert", "params": {"value": False}},
    ]
    used = {"root", "selector", *selector_children}
    payload = {
        "schema_version": 3,
        "id": workflow_id,
        "version": "3.0.0",
        "resolution": [1920, 1080],
        "root": "root",
        "nodes": [node for node in nodes if node["id"] in used],
    }
    (path / "workflows" / f"{workflow_id}.json").write_text(json.dumps(payload), encoding="utf-8")


def _config(path: Path) -> object:
    (path / "config").mkdir(); (path / "workflows").mkdir(); (path / "plugins" / "actions").mkdir(parents=True)
    config_path = path / "config" / "config.json"
    config_path.write_text(json.dumps({
        "schema_version": 2, "timezone": "Asia/Shanghai", "workflow_dir": "workflows", "action_dir": "plugins/actions",
        "instances": [{"id": "fake", "backend": "adb", "adb_serial": "not-connected"}], "ocr": {"enabled": False}, "tasks": [],
        "retry": {"connection_attempts": 1, "capture_attempts": 1, "ocr_attempts": 1, "task_attempts": 1}, "log_dir": "logs", "artifact_dir": "artifacts",
    }), encoding="utf-8")
    return load_config(config_path)


def _run(config: object, workflow_id: str) -> object:
    job = JobConfig(id=f"run-{workflow_id}", workflow=workflow_id, instance="fake", inputs={}, schedule={"type": "manual"}, enabled=True, retry_enabled=False)
    return TaskRunner(config).execute(job, config.instance("fake"))


def test_selector_falls_back_and_stops_after_success(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = _config(tmp_path)
    monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))
    _write_tree(tmp_path, "selector_ok", ["fail", "ok", "fail_2"])
    record = _run(config, "selector_ok")
    assert record.status.value == "succeeded"
    ids = [event["step_id"] for event in record.step_history]
    assert "fail" in ids and "ok" in ids and "fail_2" not in ids


def test_selector_fails_when_all_children_fail(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = _config(tmp_path)
    monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))
    _write_tree(tmp_path, "selector_fail", ["fail", "fail_2"])
    record = _run(config, "selector_fail")
    assert record.status.value == "failed"
    assert record.error_category == "assertion"


def test_selector_rejects_empty_children(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = _config(tmp_path)
    monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))
    _write_tree(tmp_path, "selector_bad", [])
    record = _run(config, "selector_bad")
    assert record.status.value == "failed"
    assert record.error_category == "config"
    assert "at least one child" in str(record.error)
