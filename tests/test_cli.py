from __future__ import annotations

from pathlib import Path

from src.oooonmyoji.cli import build_parser
from src.oooonmyoji.workflows.loader import WorkflowLoader
from src.oooonmyoji.actions import build_action_registry


ROOT = Path(__file__).resolve().parents[1]


def test_cli_accepts_direct_workflow_without_a_task_id() -> None:
    args = build_parser().parse_args([
        "run-workflow",
        "onmyoji_start_icon_click",
        "--instance",
        "mumu-0",
        "--inputs",
        "inputs.json",
    ])

    assert args.command == "run-workflow"
    assert args.workflow == "onmyoji_start_icon_click"
    assert args.instance == "mumu-0"
    assert args.inputs == Path("inputs.json")


def test_direct_workflow_loads_without_a_config_task() -> None:
    loader = WorkflowLoader(
        ROOT / "workflows",
        build_action_registry(ROOT / "plugins" / "actions"),
        project_root=ROOT,
    )

    workflow = loader.load("onmyoji_start_icon_click")
    inputs = loader.normalize_inputs(workflow, {})
    loader.validate_input_paths(workflow, inputs)

    assert workflow.workflow_id == "onmyoji_start_icon_click"
    assert inputs["template"] == "assets/templates/start/omg_icon.png"
