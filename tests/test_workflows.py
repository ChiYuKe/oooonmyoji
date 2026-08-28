from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any

import pytest

from src.oooonmyoji.actions import Action, ActionRegistry, ActionResult, ActionSpec, ActionStatus
from src.oooonmyoji.actions.manifest import ActionDefinition, ParameterDefinition
from src.oooonmyoji.exceptions import CancelledError, ConfigError
from src.oooonmyoji.workflows.compiler import compile_workflow
from src.oooonmyoji.workflows.engine import WorkflowEngine
from src.oooonmyoji.workflows.loader import WorkflowLoader
from src.oooonmyoji.workflows.resolver import ReferenceResolver
from src.oooonmyoji.workflows.validator import validate_workflow


class Context:
    def __init__(self) -> None:
        self.cancelled = threading.Event()
        self.local = threading.local()

    def check_cancelled(self) -> None:
        token = getattr(self.local, "token", None)
        if self.cancelled.is_set() or (token is not None and token.is_set()):
            raise CancelledError("cancelled")

    def begin_action(self) -> threading.Event:
        return threading.Event()

    def bind_action(self, token: threading.Event) -> None:
        self.local.token = token

    def end_action(self, token: threading.Event) -> None:
        if getattr(self.local, "token", None) is token:
            del self.local.token

    def request_action_cancel(self, token: threading.Event | None = None) -> None:
        if token is not None:
            token.set()


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


class FailAction(Action):
    name = "test.fail"

    def execute(self, context: Context, arguments: dict[str, Any]) -> ActionResult:
        return ActionResult.failed("expected failure", category="test")


class SlowAction(Action):
    name = "test.slow"

    def execute(self, context: Context, arguments: dict[str, Any]) -> ActionResult:
        time.sleep(float(arguments.get("seconds", 0.2)))
        return ActionResult.succeeded({})


class CooperativeAction(Action):
    name = "test.cooperative"

    def __init__(self) -> None:
        self.cancelled = False

    def execute(self, context: Context, arguments: dict[str, Any]) -> ActionResult:
        end = time.monotonic() + float(arguments.get("seconds", 0.4))
        try:
            while time.monotonic() < end:
                context.check_cancelled()
                time.sleep(0.005)
        except CancelledError:
            self.cancelled = True
            return ActionResult.cancelled("background cancelled")
        return ActionResult.succeeded({})


class BadOutputAction(Action):
    name = "test.bad_output"

    def execute(self, context: Context, arguments: dict[str, Any]) -> ActionResult:
        return ActionResult.succeeded(["not an object"])


class TemplateAction(Action):
    name = "vision.match_template"

    def execute(self, context: Context, arguments: dict[str, Any]) -> ActionResult:
        return ActionResult.succeeded([])


def definition(
    name: str,
    *,
    retry_safe: bool = True,
    input_schema: dict[str, Any] | None = None,
    output_schema: dict[str, Any] | None = None,
    parameters: dict[str, ParameterDefinition] | None = None,
) -> ActionDefinition:
    return ActionDefinition(
        name=name,
        version="1.0.0",
        entry=f"builtin:{name.split('.')[-1]}",
        description="",
        parameters=parameters or {},
        output_schema=output_schema if output_schema is not None else {"type": "object"},
        retry="safe" if retry_safe else "unsafe",
        side_effect=not retry_safe,
        input_schema=input_schema if input_schema is not None else {"type": "object"},
    )


def action_spec(action: Action, **kwargs: Any) -> ActionSpec:
    return ActionSpec(definition(action.name, **kwargs), action)


def registry(*specs: ActionSpec) -> ActionRegistry:
    result = ActionRegistry()
    for value in specs:
        result.register(value)
    return result


def task(node_id: str, action: str, params: dict[str, Any] | None = None, decorators: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    value: dict[str, Any] = {"id": node_id, "type": "task", "action": action, "params": params or {}}
    if decorators:
        value["decorators"] = decorators
    return value


def tree(body: list[dict[str, Any]], root_child: str, **extra: Any) -> dict[str, Any]:
    value: dict[str, Any] = {
        "schema_version": 3,
        "id": "test",
        "version": "3.0.0",
        "resolution": [1920, 1080],
        "root": "root",
        "nodes": [{"id": "root", "type": "root", "children": [root_child]}, *body],
    }
    value.update(extra)
    return value


def validate(raw: dict[str, Any], actions: ActionRegistry) -> Any:
    return validate_workflow(raw, Path("test.json"), actions, project_root=Path.cwd())


def test_validator_and_compiler_enforce_tree_invariants() -> None:
    actions = registry(action_spec(EchoAction()))
    raw = tree([task("a", "test.echo")], "a", _layout={"a": {"x": 1, "y": 2}})
    parsed = validate(raw, actions)
    compiled = compile_workflow(parsed, actions)
    assert parsed.schema_version == 3
    assert parsed.root == "root"
    assert compiled.parent_map == {"a": "root"}
    assert compiled.execution_index == {"root": 0, "a": 1}

    duplicate = tree([task("a", "test.echo"), task("a", "test.echo")], "a")
    with pytest.raises(ConfigError, match="duplicate node IDs"):
        validate(duplicate, actions)

    unknown = tree([{"id": "seq", "type": "sequence", "children": ["missing"]}], "seq")
    with pytest.raises(ConfigError, match="unknown child"):
        validate(unknown, actions)

    orphan = tree([task("a", "test.echo"), task("b", "test.echo")], "a")
    with pytest.raises(ConfigError, match="exactly one parent"):
        validate(orphan, actions)

    multiple = tree([
        {"id": "seq", "type": "sequence", "children": ["a", "sel"]},
        {"id": "sel", "type": "selector", "children": ["a"]},
        task("a", "test.echo"),
    ], "seq")
    with pytest.raises(ConfigError, match="exactly one parent"):
        validate(multiple, actions)

    cycle = tree([
        {"id": "a", "type": "sequence", "children": ["b"]},
        {"id": "b", "type": "sequence", "children": ["a"]},
    ], "a")
    with pytest.raises(ConfigError, match="exactly one parent|cycle"):
        validate(cycle, actions)


def test_validator_enforces_simple_parallel_shape_and_decorators() -> None:
    actions = registry(action_spec(EchoAction()))
    valid = tree([
        {"id": "parallel", "type": "simple_parallel", "finish_mode": "abort_background", "children": ["main", "background"]},
        task("main", "test.echo"),
        {"id": "background", "type": "sequence", "children": ["work"]},
        task("work", "test.echo"),
    ], "parallel")
    validate(valid, actions)

    invalid = tree([
        {"id": "parallel", "type": "simple_parallel", "children": ["background", "main"]},
        {"id": "background", "type": "sequence", "children": ["work"]},
        task("work", "test.echo"),
        task("main", "test.echo"),
    ], "parallel")
    with pytest.raises(ConfigError, match="first .* child"):
        validate(invalid, actions)

    bad_decorator = tree([task("a", "test.echo", decorators=[{"type": "cooldown", "seconds": 1, "count": 2}])], "a")
    with pytest.raises(ConfigError, match="unknown fields"):
        validate(bad_decorator, actions)


def test_bindings_are_typed_and_use_blackboard_and_nodes_namespaces() -> None:
    count = ParameterDefinition.parse("count", {"type": "integer", "required": True})
    typed = ActionSpec(definition(
        "test.typed",
        parameters={"count": count},
        input_schema={"type": "object", "properties": {"count": {"type": "integer"}}, "required": ["count"], "additionalProperties": False},
        output_schema={"type": "object", "properties": {"count": {"type": "integer"}}, "additionalProperties": False},
    ), EchoAction())
    # The registry checks the Action name, so reuse Echo with a matching lightweight instance.
    typed.action.name = "test.typed"
    producer = action_spec(EchoAction(), output_schema={"type": "object", "properties": {"value": {"type": "integer"}}, "additionalProperties": False})
    actions = registry(typed, producer)
    valid = tree([
        {"id": "seq", "type": "sequence", "children": ["producer", "typed"]},
        task("producer", "test.echo", {"value": 1}),
        task("typed", "test.typed", {"count": {"ref": "nodes.producer.output.value"}}),
    ], "seq", blackboard={"count": {"type": "integer"}})
    validate(valid, actions)

    bad_namespace = clone_tree(valid)
    bad_namespace["nodes"][-1]["params"]["count"] = {"ref": "inputs.count"}
    with pytest.raises(ConfigError, match="invalid structured reference"):
        validate(bad_namespace, actions)

    bad_type = clone_tree(valid)
    bad_type["blackboard"] = {"name": {"type": "string"}}
    bad_type["nodes"][-1]["params"]["count"] = {"ref": "blackboard.name"}
    with pytest.raises(ConfigError, match="incompatible"):
        validate(bad_type, actions)


def clone_tree(raw: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(raw))


def test_unsafe_retry_is_rejected() -> None:
    actions = registry(action_spec(EchoAction(), retry_safe=False))
    raw = tree([task("a", "test.echo", decorators=[{"type": "retry", "attempts": 2}])], "a")
    with pytest.raises(ConfigError, match="not declared retry-safe"):
        validate(raw, actions)


def test_engine_sequence_selector_condition_retry_and_references() -> None:
    retry_action = RetryAction()
    actions = registry(action_spec(EchoAction()), action_spec(FailAction()), action_spec(retry_action))
    raw = tree([
        {"id": "seq", "type": "sequence", "children": ["first", "selector"]},
        task("first", "test.echo", {"value": {"ref": "blackboard.value"}}),
        {"id": "selector", "type": "selector", "children": ["blocked", "retry"]},
        task("blocked", "test.echo", decorators=[{"type": "condition", "expression": {"eq": [{"ref": "blackboard.enabled"}, True]}}]),
        task("retry", "test.retry", decorators=[{"type": "retry", "attempts": 2}]),
    ], "seq", blackboard={"value": {"type": "any"}, "enabled": {"type": "boolean"}})
    result = WorkflowEngine(validate(raw, actions), actions, Context(), {"value": "ok", "enabled": False}).run()
    assert result.status == ActionStatus.SUCCEEDED
    assert result.output["first"] == {"value": "ok"}
    assert retry_action.calls == 2
    assert next(item for item in result.step_history if item["step_id"] == "blocked")["decorator"] == "condition"
    assert next(item for item in result.step_history if item["step_id"] == "retry")["attempts"] == 2
    assert not ReferenceResolver({}, {}).condition({"exists": {"ref": "blackboard.missing"}})


def test_engine_sequence_stops_and_selector_falls_back() -> None:
    actions = registry(action_spec(EchoAction()), action_spec(FailAction()))
    selector = tree([
        {"id": "selector", "type": "selector", "children": ["fail", "ok"]},
        task("fail", "test.fail"),
        task("ok", "test.echo"),
    ], "selector")
    result = WorkflowEngine(validate(selector, actions), actions, Context(), {}).run()
    assert result.status == ActionStatus.SUCCEEDED
    assert [event["step_id"] for event in result.step_history][:2] == ["fail", "ok"]

    sequence = tree([
        {"id": "sequence", "type": "sequence", "children": ["fail", "never"]},
        task("fail", "test.fail"),
        task("never", "test.echo"),
    ], "sequence")
    result = WorkflowEngine(validate(sequence, actions), actions, Context(), {}).run()
    assert result.status == ActionStatus.FAILED
    assert "never" not in [event["step_id"] for event in result.step_history]


def test_engine_timeout_limit_cancel_and_bad_output() -> None:
    actions = registry(
        action_spec(EchoAction()),
        action_spec(SlowAction()),
        action_spec(BadOutputAction(), output_schema={"type": "object"}),
    )
    slow = tree([task("slow", "test.slow", {"seconds": 0.2}, [{"type": "timeout", "seconds": 0.01}])], "slow")
    result = WorkflowEngine(validate(slow, actions), actions, Context(), {}, cancel_grace_seconds=0.01).run()
    assert result.status == ActionStatus.FAILED
    assert result.error_category == "action_timeout"
    assert result.requires_worker_restart

    cancel_event = threading.Event(); cancel_event.set()
    result = WorkflowEngine(validate(tree([task("a", "test.echo")], "a"), actions), actions, Context(), {}, cancel_event=cancel_event).run()
    assert result.status == ActionStatus.CANCELLED

    bad = WorkflowEngine(validate(tree([task("bad", "test.bad_output")], "bad"), actions), actions, Context(), {}).run()
    assert bad.status == ActionStatus.FAILED

    limited = tree([
        {"id": "seq", "type": "sequence", "children": ["a", "b"]},
        task("a", "test.echo"), task("b", "test.echo"),
    ], "seq", limits={"timeout_seconds": 5, "max_steps": 2})
    limited_result = WorkflowEngine(validate(limited, actions), actions, Context(), {}).run()
    assert limited_result.error_category == "workflow_limit"


def test_simple_parallel_abort_and_wait_modes_use_isolated_cancellation() -> None:
    cooperative = CooperativeAction()
    actions = registry(action_spec(EchoAction()), action_spec(cooperative))
    abort_tree = tree([
        {"id": "parallel", "type": "simple_parallel", "finish_mode": "abort_background", "children": ["main", "background"]},
        task("main", "test.echo"), task("background", "test.cooperative", {"seconds": 0.3}),
    ], "parallel")
    result = WorkflowEngine(validate(abort_tree, actions), actions, Context(), {}).run()
    assert result.status == ActionStatus.SUCCEEDED
    assert cooperative.cancelled
    assert not result.requires_worker_restart

    cooperative.cancelled = False
    wait_tree = clone_tree(abort_tree)
    next(node for node in wait_tree["nodes"] if node["id"] == "parallel")["finish_mode"] = "wait_for_background"
    next(node for node in wait_tree["nodes"] if node["id"] == "background")["params"]["seconds"] = 0.04
    started = time.monotonic()
    result = WorkflowEngine(validate(wait_tree, actions), actions, Context(), {}).run()
    assert result.status == ActionStatus.SUCCEEDED
    assert time.monotonic() - started >= 0.03
    assert not cooperative.cancelled


def test_workflow_loader_hash_paths_and_blackboard_defaults(tmp_path: Path) -> None:
    workflow_dir = tmp_path / "workflows"; workflow_dir.mkdir()
    asset = tmp_path / "assets" / "inside.png"; asset.parent.mkdir(); asset.write_bytes(b"placeholder")
    template_param = ParameterDefinition.parse("template", {"type": "string", "required": True})
    template_spec = ActionSpec(definition(
        "vision.match_template",
        parameters={"template": template_param},
        input_schema={"type": "object", "properties": {"template": {"type": "string"}}, "required": ["template"], "additionalProperties": False},
        output_schema={"type": "array"},
    ), TemplateAction())
    actions = registry(action_spec(EchoAction()), template_spec)
    raw = tree([
        {"id": "seq", "type": "sequence", "children": ["match", "echo"]},
        task("match", "vision.match_template", {"template": {"ref": "blackboard.template"}}),
        task("echo", "test.echo", {"value": {"ref": "blackboard.options.enabled"}}),
    ], "seq", blackboard={
        "template": {"type": "asset", "required": True},
        "options": {"type": "object", "default": {}, "properties": {"enabled": {"type": "boolean", "default": True}}},
    })
    path = workflow_dir / "one.json"; path.write_text(json.dumps(raw), encoding="utf-8")
    loader = WorkflowLoader(workflow_dir, actions, project_root=tmp_path)
    first = loader.load("one")
    normalized = loader.normalize_inputs(first, {"template": "assets/inside.png"})
    assert normalized["options"] == {"enabled": True}
    path.write_text(json.dumps({**raw, "version": "3.0.1"}), encoding="utf-8")
    assert first.file_hash != loader.load("one").file_hash
    with pytest.raises(ConfigError, match="escapes project root"):
        loader.validate_input_paths(first, {"template": "../outside.png", "options": {"enabled": True}})
    with pytest.raises(ConfigError):
        loader.load("../outside")
