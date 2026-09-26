from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from src.oooonmyoji.actions import build_action_registry
from src.oooonmyoji.cli import _failure_summary, build_parser, command_run_workflow
from src.oooonmyoji.workflows.loader import WorkflowLoader
from tests.workflow_files import write_workflow


def test_cli_accepts_direct_workflow_without_a_task_id() -> None:
    args = build_parser().parse_args([
        "run-workflow",
        "new_workflow1",
        "--instance",
        "mumu-0",
        "--inputs",
        "inputs.json",
    ])

    assert args.command == "run-workflow"
    assert args.workflow == "new_workflow1"
    assert args.instance == "mumu-0"
    assert args.inputs == Path("inputs.json")


def test_direct_workflow_loads_without_a_config_task(tmp_path: Path) -> None:
    workflow_dir = tmp_path / "workflows"
    workflow_dir.mkdir()
    (tmp_path / "plugins" / "actions").mkdir(parents=True)
    write_workflow(
        workflow_dir / "direct.owf",
        {
            "schema_version": 4,
            "id": "direct",
            "version": "3.0.0",
            "resolution": [1920, 1080],
            "root": "root",
            "inputs": {},
            "variables": {},
            "nodes": [
                {"id": "root", "type": "root", "children": ["capture"]},
                {"id": "capture", "type": "task", "action": "core.capture", "params": {}},
            ],
        },
    )
    loader = WorkflowLoader(
        workflow_dir,
        build_action_registry(tmp_path / "plugins" / "actions"),
        project_root=tmp_path,
    )

    workflow = loader.load("direct")
    inputs = loader.normalize_inputs(workflow, {})
    loader.validate_input_paths(workflow, inputs)

    assert workflow.workflow_id == "direct"
    assert inputs == {}


def test_failure_summary_surfaces_the_failed_node_path() -> None:
    record = {
        "status": "failed",
        "error": "expected failure",
        "error_category": "assert",
        "failed_node_id": "reject",
        "failed_node_breadcrumb": "root → 主流程 (main) → 断言 (reject)",
    }

    assert _failure_summary(record) == {
        "error": "expected failure",
        "error_category": "assert",
        "failed_node": "reject",
        "failed_path": "root → 主流程 (main) → 断言 (reject)",
    }
    # 成功运行不打印失败定位；只有错误、没有路径时也不能伪造字段。
    assert _failure_summary({**record, "status": "succeeded"}) == {}
    assert _failure_summary({"status": "failed", "error": "boom"}) == {"error": "boom"}


class _StubSupervisor:
    """替掉真实监督器：worker 是 spawn 出去的进程，测试里没法替换它的设备连接。"""

    def __init__(self, config: object, *args: object, **kwargs: object) -> None:
        self.config = config

    def run_workflow(self, workflow: str, instance: str, inputs: object, *, wait: bool, events_file: object = None) -> str:
        return "run-1"

    def stop(self) -> None:
        return None


class _StubStore:
    def __init__(self, path: object, *args: object, **kwargs: object) -> None:
        self.path = path

    def read(self, default: object = None) -> object:
        return {
            "run_id": "run-1",
            "status": "failed",
            "error": "cli 失败",
            "error_category": "assertion",
            "failed_node_id": "reject",
            "failed_node_breadcrumb": "root → 主流程 (main) → 断言 (reject)",
        }


def test_run_workflow_prints_the_failed_node_path(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """`run-workflow` 的失败摘要要把失败节点与「根 → … → 失败节点」路径打出来。"""

    import src.oooonmyoji.cli as cli

    config_path = tmp_path / "config" / "config.json"
    config_path.parent.mkdir()
    config_path.write_text("{}", encoding="utf-8")
    (tmp_path / "workflows").mkdir()
    (tmp_path / "plugins" / "actions").mkdir(parents=True)
    write_workflow(
        tmp_path / "workflows" / "cli_fail.owf",
        {
            "schema_version": 4,
            "id": "cli_fail",
            "version": "3.0.0",
            "resolution": [1920, 1080],
            "root": "root",
            "inputs": {},
            "variables": {},
            "nodes": [
                {"id": "root", "type": "root", "children": ["reject"]},
                {"id": "reject", "type": "task", "action": "core.assert", "params": {"value": False, "message": "cli 失败"}},
            ],
        },
    )
    stub_config = SimpleNamespace(
        artifact_dir=tmp_path / "artifacts",
        action_dir=tmp_path / "plugins" / "actions",
        workflow_dir=tmp_path / "workflows",
        root_dir=tmp_path,
        instance=lambda instance_id: None,
    )
    monkeypatch.setattr(cli, "_prepare_workflow_run", lambda *args, **kwargs: ("cli_fail", {}))
    monkeypatch.setattr(cli, "expand_runtime_instances", lambda config: config)
    monkeypatch.setattr(cli, "ensure_runtime_instance", lambda config, instance_id: config)
    monkeypatch.setattr(cli, "replace", lambda config, **changes: config)
    monkeypatch.setattr(cli, "load_config", lambda path: stub_config)
    monkeypatch.setattr(cli, "Supervisor", _StubSupervisor)
    monkeypatch.setattr(cli, "AtomicJsonStore", _StubStore)

    exit_code = command_run_workflow(build_parser().parse_args([
        "--config", str(config_path),
        "run-workflow", "cli_fail",
        "--instance", "fake",
    ]))

    assert exit_code == 1
    printed = json.loads(capsys.readouterr().out.strip())
    assert printed["status"] == "failed"
    assert printed["failed_node"] == "reject"
    assert printed["failed_path"] == "root → 主流程 (main) → 断言 (reject)"
