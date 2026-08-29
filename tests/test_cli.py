from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from src.oooonmyoji import cli as cli_module
from src.oooonmyoji.cli import build_parser
from src.oooonmyoji.workflows.loader import WorkflowLoader
from src.oooonmyoji.actions import build_action_registry


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


def test_cli_accepts_party_souls_instances() -> None:
    args = build_parser().parse_args([
        "run-party-souls",
        "--leader-instance",
        "mumu-0",
        "--member-instance",
        "mumu-1",
        "--rounds",
        "1",
        "--leader-events-file",
        "leader.jsonl",
        "--member-events-file",
        "member.jsonl",
    ])

    assert args.command == "run-party-souls"
    assert args.leader_instance == "mumu-0"
    assert args.member_instance == "mumu-1"
    assert args.rounds == 1
    assert args.leader_events_file == Path("leader.jsonl")
    assert args.member_events_file == Path("member.jsonl")


def test_cli_defaults_party_souls_to_9999_rounds() -> None:
    args = build_parser().parse_args(["run-party-souls"])

    assert args.rounds == 9999


def test_party_command_forwards_separate_event_files(monkeypatch, tmp_path: Path) -> None:
    captured: dict[str, object] = {}
    monkeypatch.setattr(cli_module, "_config_path", lambda _value: tmp_path / "config.json")
    monkeypatch.setattr(cli_module, "_prepare_workflow_run", lambda _path, workflow, _instance, _inputs: (workflow, {}))

    def send_control(request: dict[str, object]) -> dict[str, object]:
        captured.update(request)
        return {"ok": True}

    monkeypatch.setattr(cli_module, "send_control", send_control)
    args = SimpleNamespace(
        config=None,
        leader_instance="mumu-0",
        member_instance="mumu-1",
        rounds=9999,
        leader_events_file=tmp_path / "leader.jsonl",
        member_events_file=tmp_path / "member.jsonl",
    )

    assert cli_module.command_run_party_souls(args) == 0
    assert captured["rounds"] == 9999
    assert captured["leader_events_file"] == str(tmp_path / "leader.jsonl")
    assert captured["member_events_file"] == str(tmp_path / "member.jsonl")


def test_direct_workflow_loads_without_a_config_task(tmp_path: Path) -> None:
    workflow_dir = tmp_path / "workflows"
    workflow_dir.mkdir()
    (tmp_path / "plugins" / "actions").mkdir(parents=True)
    (workflow_dir / "direct.json").write_text(
        json.dumps(
            {
                "schema_version": 3,
                "id": "direct",
                "version": "3.0.0",
                "resolution": [1920, 1080],
                "root": "root",
                "nodes": [
                    {"id": "root", "type": "root", "children": ["capture"]},
                    {"id": "capture", "type": "task", "action": "core.capture", "params": {}},
                ],
            }
        ),
        encoding="utf-8",
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
