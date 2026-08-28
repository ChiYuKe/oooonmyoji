from __future__ import annotations

import json
from pathlib import Path

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
