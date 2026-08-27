from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any

import pytest

from src.oooonmyoji.actions import Action, ActionRegistry, ActionResult, ActionSpec, ActionStatus
from src.oooonmyoji.exceptions import ConfigError
from src.oooonmyoji.workflows.engine import WorkflowEngine
from src.oooonmyoji.workflows.loader import WorkflowLoader
from src.oooonmyoji.workflows.resolver import ReferenceResolver
from src.oooonmyoji.workflows.validator import validate_workflow


class Context:
    def __init__(self) -> None:
        self.cancelled = False
        self.action_cancelled = threading.Event()

    def check_cancelled(self) -> None:
        if self.cancelled or self.action_cancelled.is_set():
            from src.oooonmyoji.exceptions import CancelledError
            raise CancelledError("cancelled")

    def begin_action(self) -> None:
        self.action_cancelled.clear()

    def request_action_cancel(self) -> None:
        self.action_cancelled.set()


class EchoAction(Action):
    name = "test.echo"

    def execute(self, context: Context, arguments: dict[str, Any]) -> ActionResult:
        return ActionResult.succeeded({"value": arguments.get("value")})


class RetryAction(Action):
    name = "test.retry"

    def __init__(self) -> None:
        self.calls = 0

    def execute(self, context: Context, arguments: dict[str, Any]) -> ActionResult:
        self.calls += 1
        if self.calls == 1:
            return ActionResult.failed("try again", category="test")
        return ActionResult.succeeded({"calls": self.calls})


class SlowAction(Action):
    name = "test.slow"

    def execute(self, context: Context, arguments: dict[str, Any]) -> ActionResult:
        time.sleep(float(arguments.get("seconds", 0.2)))
        return ActionResult.succeeded({})


class SideAction(EchoAction):
    name = "test.side"


class BadOutputAction(Action):
    name = "test.bad_output"

    def execute(self, context: Context, arguments: dict[str, Any]) -> ActionResult:
        return ActionResult.succeeded(["not an object"])


class TemplateAction(Action):
    name = "vision.match_template"


def registry(*specs: ActionSpec) -> ActionRegistry:
    result = ActionRegistry()
    for spec in specs:
        result.register(spec)
    return result


def spec(action: Action, *, retry_safe: bool = True, side_effect: bool = False) -> ActionSpec:
    return ActionSpec(action.name, "1.0.0", action, {"type": "object"}, {"type": "object"}, retry_safe, side_effect)


def workflow(raw_steps: list[dict[str, Any]], **extra: Any) -> dict[str, Any]:
    value: dict[str, Any] = {
        "schema_version": 1,
        "id": "test",
        "version": "1.0.0",
        "reference_resolution": [1920, 1080],
        "entry": raw_steps[0]["id"],
        "steps": raw_steps,
    }
    value.update(extra)
    return value


def test_validator_allows_underscore_metadata_fields(tmp_path: Path) -> None:
    actions = registry(spec(EchoAction()))
    raw = workflow(
        [{"id": "a", "action": "test.echo", "on_success": "$success", "on_skip": "$success"}],
        _layout={"a": {"x": 120, "y": 80}},
    )
    parsed = validate_workflow(raw, tmp_path / "layout.json", actions, project_root=tmp_path)
    assert parsed.entry == "a"

    # 非 _ 前缀的顶层未知字段仍然被拒绝
    bad = workflow([{"id": "a", "action": "test.echo"}], layout={"a": {"x": 1}})
    with pytest.raises(ConfigError):
        validate_workflow(bad, tmp_path / "bad.json", actions, project_root=tmp_path)


def test_validator_rejects_duplicate_unknown_and_unreachable_steps(tmp_path: Path) -> None:
    actions = registry(spec(EchoAction()))
    duplicate = workflow([{"id": "a", "action": "test.echo"}, {"id": "a", "action": "test.echo"}])
    with pytest.raises(ConfigError, match="duplicate"):
        validate_workflow(duplicate, tmp_path / "duplicate.json", actions, project_root=tmp_path)

    unknown = workflow([{"id": "a", "action": "test.missing"}])
    with pytest.raises(ConfigError, match="unknown Action"):
        validate_workflow(unknown, tmp_path / "unknown.json", actions, project_root=tmp_path)

    unreachable = workflow([
        {"id": "a", "action": "test.echo", "on_success": "$success", "on_skip": "$success"},
        {"id": "never", "action": "test.echo"},
    ])
    with pytest.raises(ConfigError, match="unreachable"):
        validate_workflow(unreachable, tmp_path / "unreachable.json", actions, project_root=tmp_path)


def test_validator_rejects_bad_refs_targets_and_side_effect_retry(tmp_path: Path) -> None:
    actions = registry(spec(EchoAction()), spec(SideAction(), side_effect=True, retry_safe=False))
    bad_ref = workflow([{"id": "a", "action": "test.echo", "with": {"value": {"$ref": "steps.missing.output.0"}}}])
    with pytest.raises(ConfigError, match="invalid structured reference"):
        validate_workflow(bad_ref, tmp_path / "ref.json", actions, project_root=tmp_path)

    bad_target = workflow([{"id": "a", "action": "test.echo", "on_success": "missing"}])
    with pytest.raises(ConfigError, match="unknown target"):
        validate_workflow(bad_target, tmp_path / "target.json", actions, project_root=tmp_path)

    side_effect = workflow([{"id": "a", "action": "test.echo", "retry": 2}])
    side_effect["steps"][0]["action"] = "test.side"
    with pytest.raises(ConfigError, match="not retry-safe"):
        validate_workflow(side_effect, tmp_path / "side.json", actions, project_root=tmp_path)


def test_engine_condition_skip_refs_and_retry() -> None:
    retry_action = RetryAction()
    actions = registry(spec(EchoAction()), spec(retry_action))
    raw = workflow([
        {"id": "first", "action": "test.echo", "with": {"value": {"$ref": "inputs.value"}}},
        {"id": "skip", "action": "test.echo", "when": {"eq": [{"$ref": "inputs.enabled"}, True]}},
        {"id": "retry", "action": "test.retry", "retry": 2, "on_success": "$success"},
    ])
    spec_value = validate_workflow(raw, Path("test.json"), actions, project_root=Path.cwd())
    result = WorkflowEngine(spec_value, actions, Context(), {"value": "ok", "enabled": False}).run()
    assert result.status == ActionStatus.SUCCEEDED
    assert [item["step_id"] for item in result.step_history] == ["first", "skip", "retry"]
    assert result.step_history[1]["status"] == "skipped"
    assert retry_action.calls == 2
    assert not ReferenceResolver({}, {}).condition({"exists": {"$ref": "inputs.missing"}})


def test_engine_loop_limit_cancel_and_timeout() -> None:
    actions = registry(spec(EchoAction()), spec(SlowAction()))
    loop = workflow([{"id": "loop", "action": "test.echo", "on_success": "loop"}], limits={"max_steps": 3, "timeout_seconds": 5})
    loop_spec = validate_workflow(loop, Path("loop.json"), actions, project_root=Path.cwd())
    loop_result = WorkflowEngine(loop_spec, actions, Context(), {}).run()
    assert loop_result.status == ActionStatus.FAILED
    assert loop_result.error_category == "workflow_limit"
    assert len(loop_result.step_history) == 3

    cancel_event = threading.Event()
    cancel_event.set()
    cancel_spec = validate_workflow(workflow([{"id": "a", "action": "test.echo"}]), Path("cancel.json"), actions, project_root=Path.cwd())
    cancel_result = WorkflowEngine(cancel_spec, actions, Context(), {}, cancel_event=cancel_event).run()
    assert cancel_result.status == ActionStatus.CANCELLED

    slow = workflow([{"id": "slow", "action": "test.slow", "timeout_seconds": 0.01}], limits={"timeout_seconds": 1})
    slow_spec = validate_workflow(slow, Path("slow.json"), actions, project_root=Path.cwd())
    slow_result = WorkflowEngine(slow_spec, actions, Context(), {}, cancel_grace_seconds=0.01).run()
    assert slow_result.status == ActionStatus.FAILED
    assert slow_result.error_category == "action_timeout"
    assert slow_result.requires_worker_restart


def test_engine_rejects_non_serializable_or_schema_invalid_outputs() -> None:
    actions = ActionRegistry()
    actions.register(ActionSpec("test.bad_output", "1.0.0", BadOutputAction(), {"type": "object"}, {"type": "object"}, True, False))
    bad = validate_workflow(workflow([{"id": "bad", "action": "test.bad_output"}]), Path("bad-output.json"), actions, project_root=Path.cwd())
    result = WorkflowEngine(bad, actions, Context(), {}).run()
    assert result.status == ActionStatus.FAILED
    assert result.step_history[0]["error_category"] == "workflow"


def test_workflow_loader_hashes_each_snapshot_and_rejects_escape(tmp_path: Path) -> None:
    workflow_dir = tmp_path / "workflows"
    workflow_dir.mkdir()
    actions = registry(spec(EchoAction()))
    path = workflow_dir / "one.json"
    path.write_text(json.dumps(workflow([{"id": "a", "action": "test.echo"}])), encoding="utf-8")
    loader = WorkflowLoader(workflow_dir, actions, project_root=tmp_path)
    first = loader.load("one")
    path.write_text(json.dumps(workflow([{"id": "a", "action": "test.echo", "with": {"value": "changed"}}])), encoding="utf-8")
    second = loader.load("one")
    assert first.file_hash != second.file_hash
    with pytest.raises(ConfigError):
        loader.load("../outside")

    dynamic_path = workflow_dir / "dynamic.json"
    path_candidate = tmp_path / "assets" / "inside.png"
    path_candidate.parent.mkdir()
    path_candidate.write_bytes(b"placeholder")
    dynamic_actions = registry(spec(EchoAction()), spec(TemplateAction()))
    dynamic_path.write_text(json.dumps(workflow([{
        "id": "match",
        "action": "vision.match_template",
        "with": {"template": {"$ref": "inputs.template"}},
    }])), encoding="utf-8")
    dynamic_loader = WorkflowLoader(workflow_dir, dynamic_actions, project_root=tmp_path)
    dynamic = dynamic_loader.load("dynamic")
    with pytest.raises(ConfigError, match="escapes project root"):
        dynamic_loader.validate_input_paths(dynamic, {"template": "../outside.png"})


def test_workflow_input_defaults_are_applied_recursively(tmp_path: Path) -> None:
    workflow_dir = tmp_path / "workflows"
    workflow_dir.mkdir()
    actions = registry(spec(EchoAction()))
    path = workflow_dir / "defaults.json"
    path.write_text(json.dumps(workflow(
        [{"id": "a", "action": "test.echo", "with": {"value": {"$ref": "inputs.options.enabled"}}}],
        inputs_schema={
            "type": "object",
                "properties": {"options": {"type": "object", "default": {}, "properties": {"enabled": {"type": "boolean", "default": True}}}},
        },
    )), encoding="utf-8")
    loader = WorkflowLoader(workflow_dir, actions, project_root=tmp_path)
    normalized = loader.normalize_inputs(loader.load("defaults"), {})
    assert normalized == {"options": {"enabled": True}}
