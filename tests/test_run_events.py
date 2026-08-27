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
        "schema_version": 1,
        "id": "wf",
        "version": "1.0.0",
        "reference_resolution": [1920, 1080],
        "entry": "cap",
        "steps": [{"id": "cap", "action": "core.capture"}],
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
