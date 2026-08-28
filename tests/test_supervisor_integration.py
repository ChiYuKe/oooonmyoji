from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from src.oooonmyoji.config import load_config
from src.oooonmyoji.runtime.supervisor import Supervisor


def _write_config(path: Path, *, serial: str = "not-connected") -> Path:
    (path / "config").mkdir()
    (path / "workflows").mkdir()
    (path / "plugins" / "actions").mkdir(parents=True)
    (path / "workflows" / "simple.json").write_text(json.dumps({
        "schema_version": 3,
        "id": "simple",
        "version": "3.0.0",
        "resolution": [1920, 1080],
        "root": "root",
        "nodes": [
            {"id": "root", "type": "root", "children": ["capture"]},
            {"id": "capture", "type": "task", "action": "core.capture", "params": {}},
        ],
    }), encoding="utf-8")
    config_path = path / "config" / "config.json"
    config_path.write_text(json.dumps({
        "schema_version": 2,
        "timezone": "Asia/Shanghai",
        "workflow_dir": "workflows",
        "action_dir": "plugins/actions",
        "instances": [{"id": "fake", "backend": "adb", "adb_serial": serial}],
        "ocr": {"enabled": False},
        "tasks": [{"id": "simple-fake", "workflow": "simple", "instance": "fake"}],
        "retry": {"connection_attempts": 1, "capture_attempts": 1, "ocr_attempts": 1, "task_attempts": 1},
        "log_dir": "logs",
        "artifact_dir": "artifacts",
    }), encoding="utf-8")
    return config_path


def test_supervisor_spawns_instance_worker_and_records_failure(tmp_path: Path) -> None:
    config = load_config(_write_config(tmp_path))
    supervisor = Supervisor(config)
    try:
        run_id = supervisor.run("simple-fake", wait=True)
        record = json.loads((tmp_path / "artifacts" / "runs" / f"{run_id}.json").read_text(encoding="utf-8"))
        assert record["status"] == "failed"
        assert record["error_category"] == "device_connection"
        assert record["workflow_id"] == "simple"
        assert record["workflow_file_hash"]
        assert (tmp_path / "artifacts" / "runs" / f"{run_id}.json").is_file()
        with pytest.raises(KeyError):
            supervisor.cancel(run_id)
    finally:
        supervisor.stop()


@pytest.mark.skipif(
    os.environ.get("OOOONMYOJI_RUN_REAL_DEVICES") != "1",
    reason="set OOOONMYOJI_RUN_REAL_DEVICES=1 to run against two local MuMu ADB devices",
)
def test_supervisor_runs_two_real_adb_instances(tmp_path: Path) -> None:
    (tmp_path / "config").mkdir()
    (tmp_path / "workflows").mkdir()
    (tmp_path / "plugins" / "actions").mkdir(parents=True)
    (tmp_path / "workflows" / "simple.json").write_text(json.dumps({
        "schema_version": 3,
        "id": "simple",
        "version": "3.0.0",
        "resolution": [1920, 1080],
        "root": "root",
        "nodes": [
            {"id": "root", "type": "root", "children": ["capture"]},
            {"id": "capture", "type": "task", "action": "core.capture", "params": {}},
        ],
    }), encoding="utf-8")
    config_path = tmp_path / "config" / "config.json"
    config_path.write_text(json.dumps({
        "schema_version": 2,
        "timezone": "Asia/Shanghai",
        "workflow_dir": "workflows",
        "action_dir": "plugins/actions",
        "instances": [
            {"id": "real-0", "backend": "adb", "adb_serial": "127.0.0.1:16384"},
            {"id": "real-1", "backend": "adb", "adb_serial": "emulator-5554"},
        ],
        "ocr": {"enabled": False},
        "tasks": [
            {"id": "simple-real-0", "workflow": "simple", "instance": "real-0"},
            {"id": "simple-real-1", "workflow": "simple", "instance": "real-1"},
        ],
    }), encoding="utf-8")
    config = load_config(config_path)
    supervisor = Supervisor(config)
    try:
        run_ids = [supervisor.run("simple-real-0", wait=False), supervisor.run("simple-real-1", wait=False)]
        records = [supervisor.wait_for(run_id, timeout_seconds=60) for run_id in run_ids]
        assert all(record is not None and record["status"] == "succeeded" for record in records)
    finally:
        supervisor.stop()
