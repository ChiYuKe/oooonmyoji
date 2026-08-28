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


def _write_workflow(
    path: Path,
    workflow_id: str,
    nodes: list[dict[str, object]],
    edges: list[dict[str, object]] | None = None,
    inputs: dict[str, object] | None = None,
) -> None:
    del edges
    tasks = [
        {
            **node,
            "type": "task",
            "params": node.get("params", {}),
        }
        for node in nodes
        if "action" in node
    ]
    if len(tasks) == 1:
        root_child = str(tasks[0]["id"])
        tree_nodes: list[dict[str, object]] = tasks
    else:
        root_child = "main"
        tree_nodes = [
            {"id": "main", "type": "sequence", "children": [str(node["id"]) for node in tasks]},
            *tasks,
        ]
    payload: dict[str, object] = {
        "schema_version": 3,
        "id": workflow_id,
        "version": "3.0.0",
        "resolution": [1920, 1080],
        "root": "root",
        "nodes": [{"id": "root", "type": "root", "children": [root_child]}, *tree_nodes],
    }
    if inputs is not None:
        payload["blackboard"] = inputs
    (path / "workflows" / f"{workflow_id}.json").write_text(
        json.dumps(payload, ensure_ascii=False), encoding="utf-8"
    )


def _write_config(path: Path) -> Path:
    (path / "config").mkdir()
    (path / "workflows").mkdir()
    (path / "plugins" / "actions").mkdir(parents=True)
    # 子工作流：截屏成功即成功，缺 ok 输入会报错（inputs required）
    _write_workflow(
        path, "sub",
        [{"id": "s", "action": "core.capture"}],
        [{"from": "s", "event": "success", "to": "$success"}],
        inputs={"ok": {"type": "boolean", "required": True}},
    )
    config_path = path / "config" / "config.json"
    config_path.write_text(json.dumps({
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
        "save_screenshots": True,
    }), encoding="utf-8")
    return config_path


def _run(config: object, workflow_id: str) -> object:
    job = JobConfig(
        id=f"run-{workflow_id}",
        workflow=workflow_id,
        instance="fake",
        inputs={},
        schedule={"type": "manual"},
        enabled=True,
        retry_enabled=False,
    )
    return TaskRunner(config).execute(job, config.instance("fake"))


def _step(record: object, step_id: str) -> dict[str, object] | None:
    for event in record.step_history:
        if event.get("step_id") == step_id:
            return event
    return None


def test_subworkflow_success_receipt(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = load_config(_write_config(tmp_path))
    monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))
    _write_workflow(tmp_path, "parent_ok", [
        {"id": "cap", "action": "core.capture"},
        {"id": "exec_sub", "action": "workflow.run", "params": {"workflow": "sub", "inputs": {"ok": True}}},
    ], [
        {"from": "cap", "event": "success", "to": "exec_sub"},
        {"from": "exec_sub", "event": "success", "to": "check"},
        {"from": "check", "event": "success", "to": "$success"},
        {"from": "check", "event": "failure", "to": "$failure"},
    ])
    record = _run(config, "parent_ok")
    assert record.status.value == "succeeded"
    step = _step(record, "exec_sub")
    assert step is not None and step["status"] == "succeeded"
    assert step["output"]["status"] == "succeeded"
    assert step["output"]["workflow"] == "sub"


def test_subworkflow_missing_input_fails_call(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # 子工作流缺少必填输入 ok → 节点失败（category config），父走 failure 边
    config = load_config(_write_config(tmp_path))
    monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))
    _write_workflow(tmp_path, "parent_bad_input", [
        {"id": "exec_sub", "action": "workflow.run", "params": {"workflow": "sub", "inputs": {}}},
    ], [
        {"from": "exec_sub", "event": "success", "to": "$failure"},
        {"from": "exec_sub", "event": "failure", "to": "$success"},
    ])
    record = _run(config, "parent_bad_input")
    assert record.status.value == "failed"
    step = _step(record, "exec_sub")
    assert step is not None and step["status"] == "failed"
    assert step["error_category"] == "config"


def test_subworkflow_missing_file_fails_call(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = load_config(_write_config(tmp_path))
    monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))
    _write_workflow(tmp_path, "parent_missing", [
        {"id": "exec_sub", "action": "workflow.run", "params": {"workflow": "no_such_workflow"}},
    ], [
        {"from": "exec_sub", "event": "success", "to": "$failure"},
        {"from": "exec_sub", "event": "failure", "to": "$success"},
    ])
    record = _run(config, "parent_missing")
    assert record.status.value == "failed"
    step = _step(record, "exec_sub")
    assert step is not None and step["status"] == "failed"
    assert step["error_category"] in {"config", "workflow"}
    assert "no_such_workflow" in str(step["error"])


def test_subworkflow_recursion_is_blocked(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = load_config(_write_config(tmp_path))
    monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))
    _write_workflow(tmp_path, "recursive", [
        {"id": "exec_sub", "action": "workflow.run", "params": {"workflow": "recursive"}},
    ], [
        {"from": "exec_sub", "event": "success", "to": "$failure"},
        {"from": "exec_sub", "event": "failure", "to": "$success"},
    ])
    record = _run(config, "recursive")
    assert record.status.value == "failed"
    step = _step(record, "exec_sub")
    assert step is not None and step["status"] == "failed"
    assert "recursive" in str(step["error"])


def test_subworkflow_screenshot_thumbnail_in_parent_events(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # 子脚本里截的屏，会作为父节点的截图产物进入事件文件（缩略图）
    config = load_config(_write_config(tmp_path))
    monkeypatch.setattr(runner_module, "connect_at_task_boundary", lambda *args, **kwargs: (StubDevice(), False))
    _write_workflow(tmp_path, "parent_snap", [
        {"id": "exec_sub", "action": "workflow.run", "params": {"workflow": "sub", "inputs": {"ok": True}}},
    ], [
        {"from": "exec_sub", "event": "success", "to": "$success"},
    ])
    events_path = tmp_path / "artifacts" / "runs" / "events-latest.jsonl"
    job = JobConfig(
        id="run-snap", workflow="parent_snap", instance="fake", inputs={},
        schedule={"type": "manual"}, enabled=True, retry_enabled=False,
    )
    TaskRunner(config).execute(job, config.instance("fake"), events_file=events_path)
    lines = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    parent_steps = [line for line in lines if line["type"] == "step" and line["step_id"] == "exec_sub"]
    parent_step = parent_steps[-1]  # 最后一条是完成态（之前有 running 事件）
    assert parent_step["step"]["status"] == "succeeded"
    assert parent_step["thumbnail"]  # 子脚本截屏成为父节点截图产物
    assert Path(parent_step["screenshot"]).is_file()
