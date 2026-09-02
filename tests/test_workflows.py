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


class CountingAction(Action):
    name = "test.count"

    def __init__(self) -> None:
        self.calls = 0

    def execute(self, context: Context, arguments: dict[str, Any]) -> ActionResult:
        self.calls += 1
        return ActionResult.succeeded({"calls": self.calls})


class CountingFailAction(Action):
    name = "test.count_fail"

    def __init__(self) -> None:
        self.calls = 0

    def execute(self, context: Context, arguments: dict[str, Any]) -> ActionResult:
        self.calls += 1
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
    raw = tree([task("a", "test.echo")], "a", description="用于测试工作流描述", _layout={"a": {"x": 1, "y": 2}})
    parsed = validate(raw, actions)
    compiled = compile_workflow(parsed, actions)
    assert parsed.schema_version == 3
    assert parsed.description == "用于测试工作流描述"
    assert parsed.root == "root"
    assert compiled.parent_map == {"a": "root"}
    assert compiled.execution_index == {"root": 0, "a": 1}

    with pytest.raises(ConfigError, match="description"):
        validate(tree([task("a", "test.echo")], "a", description=123), actions)

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


def test_validator_accepts_instance_parallel_and_restricts_cross_instance_bindings() -> None:
    actions = registry(action_spec(EchoAction()))
    valid = tree([
        {
            "id": "run_all",
            "type": "instance_parallel",
            "runs": [
                {"instance": "mumu-0", "workflow": "entrypoints/mumu_0_souls_party_leader.json", "inputs": {"rounds": {"ref": "blackboard.rounds"}}},
                {"instance": "mumu-1", "workflow": "entrypoints/mumu_1_souls_loop.json", "inputs": {}},
            ],
            "wait_for": "all",
            "cancel_on_failure": True,
        },
    ], "run_all", blackboard={"rounds": {"type": "integer", "default": 1}})
    parsed = validate(valid, actions)
    assert parsed.node_map["run_all"].runs[0].instance == "mumu-0"
    assert parsed.node_map["run_all"].wait_for == "all"

    duplicate = tree([
        {"id": "run_all", "type": "instance_parallel", "runs": [
            {"instance": "mumu-0", "workflow": "entrypoints/mumu_1_souls_loop.json"},
            {"instance": "mumu-0", "workflow": "entrypoints/mumu_1_souls_loop.json"},
        ]},
    ], "run_all")
    with pytest.raises(ConfigError, match="more than once"):
        validate(duplicate, actions)

    output_binding = tree([
        {"id": "run_all", "type": "instance_parallel", "runs": [
            {"instance": "mumu-0", "workflow": "entrypoints/mumu_1_souls_loop.json", "inputs": {"value": {"ref": "nodes.some.output.value"}}},
        ]},
    ], "run_all")
    with pytest.raises(ConfigError, match="only reference blackboard"):
        validate(output_binding, actions)


def test_workflow_node_map_is_cached_for_an_immutable_snapshot() -> None:
    actions = registry(action_spec(EchoAction()))
    parsed = validate(
        tree([task("task", "test.echo")], "task"),
        actions,
    )

    first = parsed.node_map
    first.clear()
    assert parsed.node_map["task"].id == "task"


def test_validator_accepts_do_once_and_rejects_duplicate_or_extra_fields() -> None:
    actions = registry(action_spec(EchoAction()))
    ok = tree([task("a", "test.echo", decorators=[{"type": "do_once"}])], "a")
    validate(ok, actions)

    duplicate = tree([task("a", "test.echo", decorators=[{"type": "do_once"}, {"type": "do_once"}])], "a")
    with pytest.raises(ConfigError, match="duplicate do_once"):
        validate(duplicate, actions)

    extra = tree([task("a", "test.echo", decorators=[{"type": "do_once", "seconds": 1}])], "a")
    with pytest.raises(ConfigError, match="unknown fields"):
        validate(extra, actions)

    bad_reset = tree([task("a", "test.echo", decorators=[{"type": "do_once", "reset_on_failure": "yes"}])], "a")
    with pytest.raises(ConfigError):
        validate(bad_reset, actions)


def test_validator_accepts_do_once_reset_on_failure_flag() -> None:
    actions = registry(action_spec(EchoAction()))
    ok = tree([task("a", "test.echo", decorators=[{"type": "do_once", "reset_on_failure": True}])], "a")
    spec = validate(ok, actions)
    decorator = spec.node_map["a"].decorators[0]
    assert decorator.reset_on_failure is True


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

    self_ref = clone_tree(valid)
    self_ref["nodes"][-1]["params"]["count"] = {"ref": "nodes.typed.output.count"}
    with pytest.raises(ConfigError, match="unavailable at this execution point"):
        validate(self_ref, actions)

    forward_ref = clone_tree(valid)
    forward_ref["nodes"][-2]["params"]["value"] = {"ref": "nodes.typed.output.count"}
    with pytest.raises(ConfigError, match="unavailable at this execution point"):
        validate(forward_ref, actions)

    selector_branch_ref = tree([
        {"id": "choice", "type": "selector", "children": ["producer", "typed"]},
        task("producer", "test.echo", {"value": 1}),
        task("typed", "test.typed", {"count": {"ref": "nodes.producer.output.value"}}),
    ], "choice")
    with pytest.raises(ConfigError, match="unavailable at this execution point"):
        validate(selector_branch_ref, actions)

    nested_sequence_ref = tree([
        {"id": "outer", "type": "sequence", "children": ["prepare", "typed"]},
        {"id": "prepare", "type": "sequence", "children": ["producer"]},
        task("producer", "test.echo", {"value": 1}),
        task("typed", "test.typed", {"count": {"ref": "nodes.producer.output.value"}}),
    ], "outer")
    validate(nested_sequence_ref, actions)

    optional_selector_output = tree([
        {"id": "outer", "type": "sequence", "children": ["choice", "check"]},
        {"id": "choice", "type": "selector", "children": ["producer", "fallback"]},
        task("producer", "test.echo", {"value": 1}),
        task("fallback", "test.echo", {"value": 2}),
        task("check", "test.echo", decorators=[{
            "type": "condition",
            "expression": {"exists": {"ref": "nodes.producer.output.value"}},
        }]),
    ], "outer")
    validate(optional_selector_output, actions)


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
    started: list[dict[str, Any]] = []
    result = WorkflowEngine(
        validate(raw, actions),
        actions,
        Context(),
        {"value": "ok", "enabled": False},
        on_step_start=started.append,
    ).run()
    assert result.status == ActionStatus.SUCCEEDED
    assert result.output["first"] == {"value": "ok"}
    assert next(item for item in started if item["step_id"] == "first")["params"] == {"value": "ok"}
    assert next(item for item in result.step_history if item["step_id"] == "first")["params"] == {"value": "ok"}
    assert retry_action.calls == 2
    assert next(item for item in result.step_history if item["step_id"] == "blocked")["decorator"] == "condition"
    assert next(item for item in result.step_history if item["step_id"] == "retry")["attempts"] == 2
    assert not ReferenceResolver({}, {}).condition({"exists": {"ref": "blackboard.missing"}})


def test_engine_do_once_runs_action_only_once_across_repeat_iterations() -> None:
    once_action = CountingAction()
    echo_action = CountingAction()
    echo_action.name = "test.echo"
    actions = registry(action_spec(once_action), action_spec(echo_action))
    raw = tree([
        {"id": "loop", "type": "sequence", "decorators": [{"type": "repeat", "count": 3}], "children": ["once", "after"]},
        task("once", "test.count", decorators=[{"type": "do_once"}]),
        task("after", "test.echo"),
    ], "loop")
    result = WorkflowEngine(validate(raw, actions), actions, Context(), {}).run()
    assert result.status == ActionStatus.SUCCEEDED
    assert once_action.calls == 1
    assert echo_action.calls == 3
    once_events = [item for item in result.step_history if item["step_id"] == "once"]
    assert len(once_events) == 3
    assert once_events[0].get("decorator") is None
    assert all(item["status"] == ActionStatus.SUCCEEDED.value for item in once_events[1:])
    assert all(item["decorator"] == "do_once" for item in once_events[1:])


def test_engine_do_once_reset_on_failure_retries_until_success() -> None:
    fail_then_succeed = RetryAction()
    echo_action = CountingAction()
    echo_action.name = "test.echo"
    actions = registry(action_spec(fail_then_succeed), action_spec(echo_action))
    raw = tree([
        {"id": "loop", "type": "selector", "decorators": [{"type": "repeat", "count": 3}], "children": ["once", "fallback"]},
        task("once", "test.retry", decorators=[{"type": "do_once", "reset_on_failure": True}]),
        task("fallback", "test.echo"),
    ], "loop")
    result = WorkflowEngine(validate(raw, actions), actions, Context(), {}).run()
    assert result.status == ActionStatus.SUCCEEDED
    # 第 1 轮失败不锁定 → 第 2 轮重试成功并锁定 → 第 3 轮直接成功跳过（fallback 只在首轮执行）。
    assert fail_then_succeed.calls == 2
    assert echo_action.calls == 1
    once_events = [item for item in result.step_history if item["step_id"] == "once"]
    assert len(once_events) == 3
    # 第 1、2 次是真实执行（第 1 次失败、第 2 次成功），第 3 次才是 do_once 成功跳过。
    assert once_events[2]["decorator"] == "do_once"
    assert once_events[2]["status"] == ActionStatus.SUCCEEDED.value


def test_engine_do_once_default_locks_even_when_first_execution_fails() -> None:
    fail_action = CountingFailAction()
    echo_action = CountingAction()
    echo_action.name = "test.echo"
    actions = registry(action_spec(fail_action), action_spec(echo_action))
    raw = tree([
        {"id": "loop", "type": "selector", "decorators": [{"type": "repeat", "count": 2}], "children": ["once", "fallback"]},
        task("once", "test.count_fail", decorators=[{"type": "do_once"}]),
        task("fallback", "test.echo"),
    ], "loop")
    result = WorkflowEngine(validate(raw, actions), actions, Context(), {}).run()
    assert result.status == ActionStatus.SUCCEEDED
    assert fail_action.calls == 1
    assert echo_action.calls == 1
    once_events = [item for item in result.step_history if item["step_id"] == "once"]
    assert len(once_events) == 2
    # 第一次失败被 Selector 恢复归类为 branch_miss；第二次直接按 do_once 成功跳过。
    assert once_events[0]["status"] == "branch_miss"
    assert once_events[1]["status"] == ActionStatus.SUCCEEDED.value
    assert once_events[1]["decorator"] == "do_once"


def test_engine_sequence_stops_and_selector_falls_back() -> None:
    actions = registry(action_spec(EchoAction()), action_spec(FailAction()))
    selector = tree([
        {"id": "selector", "name": "选择可用分支", "type": "selector", "children": ["fail", "ok"]},
        {**task("fail", "test.fail"), "name": "失败分支"},
        task("ok", "test.echo"),
    ], "selector")
    emitted: list[dict[str, Any]] = []
    started: list[dict[str, Any]] = []
    result = WorkflowEngine(
        validate(selector, actions), actions, Context(), {},
        on_step=emitted.append, on_step_start=started.append,
    ).run()
    assert result.status == ActionStatus.SUCCEEDED
    assert [event["step_id"] for event in result.step_history][:2] == ["fail", "ok"]
    recovered = next(event for event in result.step_history if event["step_id"] == "fail")
    assert recovered["status"] == "branch_miss"
    assert recovered["original_status"] == "failed"
    assert recovered["recovered_by"] == "selector"
    assert recovered["recovered_by_name"] == "选择可用分支"
    assert recovered["name"] == "失败分支"
    assert next(event for event in started if event["step_id"] == "fail")["name"] == "失败分支"
    assert [event["status"] for event in emitted if event["step_id"] == "fail"] == ["failed", "branch_miss"]

    all_failed = tree([
        {"id": "selector", "type": "selector", "children": ["fail_one", "fail_two"]},
        task("fail_one", "test.fail"),
        task("fail_two", "test.fail"),
    ], "selector")
    all_failed_emitted: list[dict[str, Any]] = []
    failed_result = WorkflowEngine(
        validate(all_failed, actions), actions, Context(), {}, on_step=all_failed_emitted.append,
    ).run()
    assert failed_result.status == ActionStatus.FAILED
    assert [
        event["status"] for event in failed_result.step_history
        if event["step_id"] in {"fail_one", "fail_two"}
    ] == ["branch_miss", "failed"]
    assert [
        event["status"] for event in all_failed_emitted
        if event["step_id"] in {"fail_one", "fail_two"}
    ] == ["failed", "branch_miss", "failed"]

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


def test_workflow_loader_applies_required_top_level_default_before_validation(tmp_path: Path) -> None:
    workflow_dir = tmp_path / "workflows"
    workflow_dir.mkdir()
    (tmp_path / "plugins" / "actions").mkdir(parents=True)
    raw = tree(
        [task("echo", "test.echo", {"value": {"ref": "blackboard.rounds"}})],
        "echo",
        blackboard={"rounds": {"type": "integer", "required": True, "default": 30}},
    )
    (workflow_dir / "defaults.json").write_text(json.dumps(raw), encoding="utf-8")
    actions = registry(action_spec(EchoAction()))
    loader = WorkflowLoader(workflow_dir, actions, project_root=tmp_path)

    normalized = loader.normalize_inputs(loader.load("defaults"), {})

    assert normalized == {"rounds": 30}


def test_workflow_loader_only_accepts_public_child_inputs(tmp_path: Path) -> None:
    workflow_dir = tmp_path / "workflows"
    workflow_dir.mkdir()
    raw = tree(
        [task("echo", "test.echo", {"value": {"ref": "blackboard.public_value"}})],
        "echo",
        blackboard={
            "public_value": {"type": "string", "public": True, "required": True},
            "private_value": {"type": "string", "public": False, "default": "internal"},
            "legacy_value": {"type": "integer", "default": 1},
        },
    )
    (workflow_dir / "child.json").write_text(json.dumps(raw), encoding="utf-8")
    loader = WorkflowLoader(workflow_dir, registry(action_spec(EchoAction())), project_root=tmp_path)
    child = loader.load("child")

    assert child.public_inputs == ("public_value", "legacy_value")
    assert loader.normalize_inputs(
        child,
        {"public_value": "from-parent", "legacy_value": 2},
        public_only=True,
    ) == {
        "public_value": "from-parent",
        "private_value": "internal",
        "legacy_value": 2,
    }
    with pytest.raises(ConfigError, match="private or unknown: private_value"):
        loader.normalize_inputs(
            child,
            {"public_value": "from-parent", "private_value": "override"},
            public_only=True,
        )


def test_instance_parallel_rejects_private_child_inputs(tmp_path: Path) -> None:
    workflow_dir = tmp_path / "workflows"
    workflow_dir.mkdir()
    child = tree(
        [task("echo", "test.echo")],
        "echo",
        blackboard={
            "rounds": {"type": "integer", "public": True, "default": 1},
            "secret": {"type": "string", "public": False, "default": "internal"},
        },
    )
    (workflow_dir / "child.json").write_text(json.dumps(child), encoding="utf-8")
    parent = tree([
        {
            "id": "parallel",
            "type": "instance_parallel",
            "runs": [{"instance": "mumu-0", "workflow": "child.json", "inputs": {"secret": "override"}}],
        },
    ], "parallel")

    with pytest.raises(ConfigError, match="private or unknown child inputs: secret"):
        validate_workflow(
            parent,
            workflow_dir / "parent.json",
            registry(action_spec(EchoAction())),
            project_root=tmp_path,
            workflow_dir=workflow_dir,
        )


def test_workflow_loader_discovers_nested_workflows_and_resolves_ids(tmp_path: Path) -> None:
    workflow_dir = tmp_path / "workflows"
    nested = workflow_dir / "entrypoints"
    nested.mkdir(parents=True)
    raw = tree([task("echo", "test.echo", {"value": "nested"})], "echo")
    path = nested / "nested_entry.json"
    path.write_text(json.dumps(raw), encoding="utf-8")
    actions = registry(action_spec(EchoAction()))
    loader = WorkflowLoader(workflow_dir, actions, project_root=tmp_path)

    assert loader.path_for("entrypoints/nested_entry.json") == path.resolve()
    assert loader.path_for("nested_entry") == path.resolve()
    assert list(loader.discover()) == [raw["id"]]


def test_party_member_waits_for_reward_overlay_to_close_before_next_invite() -> None:
    project_root = Path(__file__).resolve().parents[1]
    workflow_path = Path(__file__).resolve().parents[1] / "workflows" / "souls" / "party" / "member_round.json"
    raw = json.loads(workflow_path.read_text(encoding="utf-8"))
    nodes = {node["id"]: node for node in raw["nodes"]}

    assert nodes["settled_after_one_tap"]["children"][-3:] == [
        "pause_after_reward_once",
        "wait_reward_overlay_gone_after_one",
        "done_after_one",
    ]
    assert nodes["settled_after_two_taps"]["children"][-3:] == [
        "pause_after_reward_twice",
        "wait_reward_overlay_gone_after_two",
        "done_after_two",
    ]
    for node_id in ("wait_reward_overlay_gone_after_one", "wait_reward_overlay_gone_after_two"):
        params = nodes[node_id]["params"]
        assert params["template"] == "assets/templates/souls/souls-victory-continue.png"
        assert params["present"] is False
    invite_params = nodes["wait_auto_ready_invite"]["params"]
    assert invite_params["threshold"] >= 0.85
    assert invite_params["timeout_seconds"] >= 12
    assert (project_root / invite_params["template"]).is_file()
    assert nodes["complete_auto_ready_setup"]["children"] == [
        "wait_lobby_without_confirmation",
        "handle_auto_ready_confirmation",
    ]
    assert nodes["wait_lobby_without_confirmation"]["params"]["timeout_seconds"] <= 2


def test_party_member_setup_phase_accepts_return_to_lobby() -> None:
    workflow_path = Path(__file__).resolve().parents[1] / "workflows" / "souls" / "party" / "member_round.json"
    raw = json.loads(workflow_path.read_text(encoding="utf-8"))
    nodes = {node["id"]: node for node in raw["nodes"]}
    lobby_phase_condition = {
        "type": "condition",
        "expression": {"ne": [{"ref": "blackboard.phase"}, "finish"]},
    }

    for node_id in ("wait_lobby_direct", "wait_lobby_after_one", "wait_lobby_after_two"):
        assert lobby_phase_condition in nodes[node_id]["decorators"]


def test_mumu1_courtyard_detection_covers_camera_shift() -> None:
    project_root = Path(__file__).resolve().parents[1]
    workflow_nodes = []
    workflow_paths = (
        project_root / "workflows" / "souls" / "party" / "member_round.json",
        project_root / "workflows" / "entrypoints" / "mumu_1_souls_loop.json",
    )
    for workflow_path in workflow_paths:
        raw = json.loads(workflow_path.read_text(encoding="utf-8"))
        workflow_nodes.extend(
            node
            for node in raw["nodes"]
            if node.get("params", {}).get("template")
            == "assets/templates/souls/courtyard-explore/mumu-1.png"
        )

    assert len(workflow_nodes) == 6
    for node in workflow_nodes:
        params = node["params"]
        x, y, width, height = params["roi"]
        assert x <= 567
        assert x + width >= 835
        assert y <= 145
        assert y + height >= 265
        assert params["threshold"] <= 0.65
