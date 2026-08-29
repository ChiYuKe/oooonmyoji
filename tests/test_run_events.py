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

TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


class StubDevice:
    width = 1920
    height = 1080

    def capture(self) -> DeviceFrame:
        return DeviceFrame(self.width, self.height, TINY_PNG, format="png")

    def tap(self, x: int, y: int, hold_ms: int = 0) -> None:
        return None

    def close(self) -> None:
        return None


def _write_config(path: Path, *, save_screenshots: bool | None = None) -> Path:
    (path / "config").mkdir()
    (path / "workflows").mkdir()
    (path / "plugins" / "actions").mkdir(parents=True)
    (path / "workflows" / "wf.json").write_text(json.dumps({
        "schema_version": 3,
        "id": "wf",
        "version": "3.0.0",
        "resolution": [1920, 1080],
        "root": "root",
        "nodes": [
            {"id": "root", "type": "root", "children": ["cap"]},
            {"id": "cap", "type": "task", "action": "core.capture", "params": {}},
        ],
    }), encoding="utf-8")
    config_path = path / "config" / "config.json"
    config = {
        "schema_version": 2,
        "timezone": "Asia/Shanghai",
        "workflow_dir": "workflows",
        "action_dir": "plugins/actions",
        "instances": [{"id": "fake", "backend": "adb", "adb_serial": "not-connected"}],
        "ocr": {"enabled": False},
        "tasks": [],
        "retry": {"connection_attempts": 1, "capture_attempts": 1, "ocr_attempts": 1, "task_attempts": 1},
        "log_dir": "logs",
        "artifact_dir": "artifacts",
    }
    if save_screenshots is not None:
        config["save_screenshots"] = save_screenshots
    config_path.write_text(json.dumps(config), encoding="utf-8")
    return config_path


def test_run_events_file_omits_screenshot_artifacts_by_default(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = load_config(_write_config(tmp_path))
    monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))
    job = JobConfig(
        id="wf-run",
        workflow="wf",
        instance="fake",
        inputs={},
        schedule={"type": "manual"},
        enabled=True,
        retry_enabled=False,
    )
    events_path = tmp_path / "artifacts" / "runs" / "events-latest.jsonl"
    record = TaskRunner(config).execute(job, config.instance("fake"), events_file=events_path)

    assert record.status.value == "succeeded"
    assert events_path.is_file()
    lines = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert lines[0]["type"] == "run_started"
    assert lines[0]["run_id"] == record.run_id
    assert lines[-1]["type"] == "run_finished"
    assert lines[-1]["status"] == "succeeded"

    step_lines = [line for line in lines if line["type"] == "step" and line["step_id"] == "cap"]
    statuses = [line["step"]["status"] for line in step_lines]
    assert "running" in statuses
    assert "succeeded" in statuses
    done = step_lines[-1]
    assert "screenshot" not in done
    assert "thumbnail" not in done
    assert "last_frame" not in record.details
    assert not list((tmp_path / "artifacts").rglob("*.png"))


def test_run_events_file_can_keep_screenshot_artifacts_when_enabled(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = load_config(_write_config(tmp_path, save_screenshots=True))
    monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))
    job = JobConfig(
        id="wf-run",
        workflow="wf",
        instance="fake",
        inputs={},
        schedule={"type": "manual"},
        enabled=True,
        retry_enabled=False,
    )
    events_path = tmp_path / "artifacts" / "runs" / "events-latest.jsonl"
    record = TaskRunner(config).execute(job, config.instance("fake"), events_file=events_path)

    lines = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    done = [line for line in lines if line["type"] == "step" and line["step_id"] == "cap" and line["step"]["status"] == "succeeded"][-1]
    assert Path(done["screenshot"]).is_file()
    assert Path(record.details["last_frame"]).is_file()
    try:
        import cv2  # noqa: F401
    except ImportError:
        pass
    else:
        assert isinstance(done["thumbnail"], str)
        assert len(done["thumbnail"]) > 16


def test_run_events_file_truncates_on_new_run(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = load_config(_write_config(tmp_path))
    monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))
    job = JobConfig(
        id="wf-run",
        workflow="wf",
        instance="fake",
        inputs={},
        schedule={"type": "manual"},
        enabled=True,
        retry_enabled=False,
    )
    events_path = tmp_path / "artifacts" / "runs" / "events-latest.jsonl"
    runner = TaskRunner(config)
    runner.execute(job, config.instance("fake"), events_file=events_path)
    first_run_id = json.loads(events_path.read_text(encoding="utf-8").splitlines()[0])["run_id"]
    runner.execute(job, config.instance("fake"), events_file=events_path)
    lines = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert lines[0]["type"] == "run_started"
    assert lines[0]["run_id"] != first_run_id
    assert lines[-1]["type"] == "run_finished"


def test_run_uses_run_specific_events_file_by_default(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = load_config(_write_config(tmp_path))
    monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))
    job = JobConfig(
        id="wf-run",
        workflow="wf",
        instance="fake",
        inputs={},
        schedule={"type": "manual"},
        enabled=True,
        retry_enabled=False,
    )

    record = TaskRunner(config).execute(job, config.instance("fake"), run_id="run-default-events")

    events_path = tmp_path / "artifacts" / "runs" / "events-run-default-events.jsonl"
    assert record.details["events_file"] == str(events_path)
    lines = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert lines[0]["type"] == "run_started"
    assert lines[-1]["type"] == "run_finished"


def test_run_record_checkpoints_are_batched(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config_path = _write_config(tmp_path)
    workflow_path = tmp_path / "workflows" / "wf.json"
    task_ids = [f"log-{index}" for index in range(30)]
    workflow_path.write_text(json.dumps({
        "schema_version": 3,
        "id": "wf",
        "version": "3.0.0",
        "resolution": [1920, 1080],
        "root": "root",
        "nodes": [
            {"id": "root", "type": "root", "children": ["batch"]},
            {"id": "batch", "type": "sequence", "children": task_ids},
            *[
                {"id": task_id, "type": "task", "action": "core.log", "params": {"message": task_id}}
                for task_id in task_ids
            ],
        ],
    }), encoding="utf-8")
    config = load_config(config_path)
    monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))
    original_write = runner_module.AtomicJsonStore.write
    state_writes = 0

    def counting_write(store: runner_module.AtomicJsonStore, value: object) -> None:
        nonlocal state_writes
        if store.path.name == "run-batched.json":
            state_writes += 1
        original_write(store, value)

    monkeypatch.setattr(runner_module.AtomicJsonStore, "write", counting_write)
    job = JobConfig(
        id="wf-run",
        workflow="wf",
        instance="fake",
        inputs={},
        schedule={"type": "manual"},
        enabled=True,
        retry_enabled=False,
    )

    record = TaskRunner(config).execute(job, config.instance("fake"), run_id="run-batched")

    assert record.status.value == "succeeded"
    assert record.step_history_total == 32
    assert state_writes == 5
