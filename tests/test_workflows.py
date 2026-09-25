from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from pathlib import Path
from typing import Any

import pytest

from src.oooonmyoji.actions import Action, ActionRegistry, ActionResult, ActionSpec, ActionStatus
from src.oooonmyoji.actions.manifest import ActionDefinition, ParameterDefinition
from src.oooonmyoji.exceptions import CancelledError, ConfigError
from src.oooonmyoji.workflows.compiler import compile_workflow
from src.oooonmyoji.workflows.dsl import WORKFLOW_SUFFIX, DslError, parse_document
from src.oooonmyoji.workflows.engine import WorkflowEngine
from src.oooonmyoji.workflows.loader import WorkflowLoader
from src.oooonmyoji.workflows.resolver import ReferenceResolver
from src.oooonmyoji.workflows.validator import validate_workflow

from .workflow_files import write_workflow


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


class PassThroughAction(Action):
    name = "test.passthrough"

    def execute(self, context: Context, arguments: dict[str, Any]) -> ActionResult:
        return ActionResult.succeeded(arguments)


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
        "schema_version": 4,
        "id": "test",
        "version": "3.0.0",
        "resolution": [1920, 1080],
        "root": "root",
        "inputs": {},
        "variables": {},
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
    assert parsed.schema_version == 4
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


def test_all_workflow_scripts_have_catalog_descriptions() -> None:
    project_root = Path(__file__).resolve().parents[1]
    workflow_files = sorted((project_root / "workflows").rglob(f"*{WORKFLOW_SUFFIX}"))

    missing = []
    for workflow_path in workflow_files:
        raw = parse_document(workflow_path.read_text(encoding="utf-8"), path=workflow_path.name)
        if not isinstance(raw.get("description"), str) or not raw["description"].strip():
            missing.append(workflow_path.relative_to(project_root).as_posix())

    assert missing == []


def _resolve_workflow_reference(project_root: Path, reference: str) -> Path | None:
    """把工作流引用（文件名 / 工作流 ID / workflows 下的路径）解析到实际文件。

    复刻桌面端 `matchWorkflowReference` + `resolveWorkflowReference` 的语义：先按路径/文件名匹配，
    没命中再把引用当成工作流 ID 读文件内容比对。绑定到 inputs 的引用（对象形式）不在这里处理。
    """
    ref = str(reference or "").replace("\\", "/").strip()
    if not ref:
        return None
    with_ext = ref if ref.lower().endswith(WORKFLOW_SUFFIX) else f"{ref}{WORKFLOW_SUFFIX}"
    without_ext = ref[: -len(WORKFLOW_SUFFIX)] if ref.lower().endswith(WORKFLOW_SUFFIX) else ref
    for path in sorted((project_root / "workflows").rglob(f"*{WORKFLOW_SUFFIX}")):
        rel = path.relative_to(project_root).as_posix()
        rootless = re.sub(r"^workflows/", "", rel, flags=re.IGNORECASE)
        for name in (rel, rootless, path.name):
            if ref in (name, without_ext) or with_ext == name:
                return path
        try:
            raw = parse_document(path.read_text(encoding="utf-8"), path=path.name)
        except (OSError, UnicodeDecodeError, DslError):
            continue
        if isinstance(raw, dict) and raw.get("id") == ref:
            return path
    return None


def test_all_workflow_references_resolve_to_existing_files() -> None:
    """工作流之间互相引用的名字必须真能解析到文件。

    重命名工作流后如果哪里的引用（画布上写回的字面引用、instance_parallel 的 runs[].workflow）
    还留着旧名字，这里会直接报出来——这类残留以前只能靠人眼在画布上发现。
    """
    project_root = Path(__file__).resolve().parents[1]
    dangling: list[str] = []
    for workflow_path in sorted((project_root / "workflows").rglob(f"*{WORKFLOW_SUFFIX}")):
        raw = parse_document(workflow_path.read_text(encoding="utf-8"), path=workflow_path.name)
        nodes = raw.get("nodes") if isinstance(raw, dict) else None
        if not isinstance(nodes, list):
            continue
        for node in nodes:
            if not isinstance(node, dict):
                continue
            raw_params = node.get("params")
            params = raw_params if isinstance(raw_params, dict) else {}
            references: list[Any] = []
            if node.get("type") == "task" and node.get("action") == "workflow.run":
                references.append(params.get("workflow"))
            if node.get("type") == "instance_parallel":
                raw_runs = node.get("runs")
                runs = raw_runs if isinstance(raw_runs, list) else []
                for run in runs:
                    if isinstance(run, dict):
                        references.append(run.get("workflow"))
            for reference in references:
                if not isinstance(reference, str) or not reference.strip():
                    continue  # 对象形式（绑定到 inputs）在运行时才解析
                if _resolve_workflow_reference(project_root, reference) is None:
                    dangling.append(f"{workflow_path.relative_to(project_root).as_posix()} 节点 {node.get('id')} → {reference}")
    assert dangling == []


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
    # 子工作流的输入键由编辑器生成（例如 v_<hash>），按实际声明取，避免改一次数据就红。
    child_workflow = Path(__file__).resolve().parents[1] / "workflows" / f"活动副本{WORKFLOW_SUFFIX}"
    child_inputs = list(parse_document(child_workflow.read_text(encoding="utf-8"), path=child_workflow.name).get("inputs", {}))
    assert child_inputs, "活动副本应当至少声明一个输入"
    child_input = child_inputs[0]
    valid = tree([
        {
            "id": "run_all",
            "type": "instance_parallel",
            "runs": [
                {"instance": "mumu-0", "workflow": "活动副本.json", "inputs": {child_input: {"ref": "inputs.运行轮数"}}},
                {"instance": "mumu-1", "workflow": "活动副本.json", "inputs": {}},
            ],
            "wait_for": "all",
            "cancel_on_failure": True,
        },
    ], "run_all", inputs={"运行轮数": {"type": "integer", "default": 1}})
    parsed = validate(valid, actions)
    assert parsed.node_map["run_all"].runs[0].instance == "mumu-0"
    assert parsed.node_map["run_all"].wait_for == "all"

    duplicate = tree([
        {"id": "run_all", "type": "instance_parallel", "runs": [
            {"instance": "mumu-0", "workflow": "活动副本.json"},
            {"instance": "mumu-0", "workflow": "活动副本.json"},
        ]},
    ], "run_all")
    with pytest.raises(ConfigError, match="more than once"):
        validate(duplicate, actions)

    output_binding = tree([
        {"id": "run_all", "type": "instance_parallel", "runs": [
            {"instance": "mumu-0", "workflow": "活动副本.json", "inputs": {child_input: {"ref": "nodes.some.output.value"}}},
        ]},
    ], "run_all")
    with pytest.raises(ConfigError, match="only reference inputs"):
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


def test_bindings_are_typed_and_use_inputs_and_nodes_namespaces() -> None:
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
    ], "seq", inputs={"count": {"type": "integer"}})
    validate(valid, actions)

    bad_namespace = clone_tree(valid)
    bad_namespace["nodes"][-1]["params"]["count"] = {"ref": "legacy.count"}
    with pytest.raises(ConfigError, match="invalid structured reference"):
        validate(bad_namespace, actions)

    bad_type = clone_tree(valid)
    bad_type["inputs"] = {"name": {"type": "string"}}
    bad_type["nodes"][-1]["params"]["count"] = {"ref": "inputs.name"}
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
        {
            "id": "check",
            "type": "condition",
            "expression": {"exists": {"ref": "nodes.producer.output.value"}},
            "children": ["act"],
            "ports": ["true"],
        },
        task("act", "test.echo"),
    ], "outer")
    validate(optional_selector_output, actions)


def clone_tree(raw: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(raw))


def test_unsafe_retry_is_rejected() -> None:
    actions = registry(action_spec(EchoAction(), retry_safe=False))
    raw = tree([task("a", "test.echo", decorators=[{"type": "retry", "attempts": 2}])], "a")
    with pytest.raises(ConfigError, match="not declared retry-safe"):
        validate(raw, actions)


def test_public_retry_cannot_bypass_retry_safety() -> None:
    actions = registry(action_spec(EchoAction(), retry_safe=False))
    raw = tree([task("a", "test.echo", decorators=[{"type": "retry", "attempts": {"ref": "inputs.tries"}}])], "a")
    raw["inputs"] = {"tries": {"type": "integer", "default": 1}}
    with pytest.raises(ConfigError, match="not declared retry-safe"):
        validate(raw, actions)


def test_engine_sequence_selector_condition_retry_and_references() -> None:
    retry_action = RetryAction()
    actions = registry(action_spec(EchoAction()), action_spec(FailAction()), action_spec(retry_action))
    raw = tree([
        {"id": "seq", "type": "sequence", "children": ["first", "selector"]},
        task("first", "test.echo", {"value": {"ref": "inputs.value"}}),
        {"id": "selector", "type": "selector", "children": ["judge", "retry"]},
        {
            "id": "judge",
            "type": "condition",
            "expression": {"eq": [{"ref": "inputs.enabled"}, True]},
            "children": ["blocked"],
            "ports": ["true"],
        },
        task("blocked", "test.echo"),
        task("retry", "test.retry", decorators=[{"type": "retry", "attempts": 2}]),
    ], "seq", inputs={"value": {"type": "any"}, "enabled": {"type": "boolean"}})
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
    # 判断节点不成立 → 由 Selector 回收成 branch_miss，blocked 一步都没跑。
    assert next(item for item in result.step_history if item["step_id"] == "judge")["status"] == "branch_miss"
    assert not any(item["step_id"] == "blocked" for item in result.step_history)
    assert next(item for item in result.step_history if item["step_id"] == "retry")["attempts"] == 2
    assert not ReferenceResolver({}, {}).condition({"exists": {"ref": "inputs.missing"}})


def test_engine_retry_retries_only_the_decorated_node() -> None:
    before_action = CountingAction()
    before_action.name = "test.before"
    retry_action = RetryAction()
    actions = registry(action_spec(before_action), action_spec(retry_action))
    raw = tree([
        {"id": "sequence", "type": "sequence", "children": ["before", "click"]},
        task("before", "test.before"),
        task("click", "test.retry", decorators=[{"type": "retry", "attempts": 2}]),
    ], "sequence")

    result = WorkflowEngine(validate(raw, actions), actions, Context(), {}).run()

    assert result.status == ActionStatus.SUCCEEDED
    assert before_action.calls == 1
    assert retry_action.calls == 2
    before_events = [item for item in result.step_history if item["step_id"] == "before"]
    click_events = [item for item in result.step_history if item["step_id"] == "click"]
    assert len(before_events) == 1
    assert len(click_events) == 1
    assert click_events[0]["attempts"] == 2


def test_engine_keeps_inputs_and_variables_read_only() -> None:
    actions = registry(action_spec(EchoAction()))
    raw = tree([
        {"id": "seq", "type": "sequence", "children": ["read_state"]},
        task("read_state", "test.echo", {"value": {"ref": "variables.counter"}}),
    ], "seq", inputs={"rounds": {"type": "integer", "default": 1}}, variables={
        "counter": {"type": "integer", "default": 7},
    })
    caller_inputs = {"rounds": 3}

    result = WorkflowEngine(validate(raw, actions), actions, Context(), caller_inputs).run()

    assert result.status == ActionStatus.SUCCEEDED
    assert result.output["read_state"] == {"value": 7}
    assert caller_inputs == {"rounds": 3}


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


@pytest.mark.parametrize("kind,key,value,input_type", [
    ("cooldown", "seconds", 1, "number"),
    ("timeout", "seconds", 2, "number"),
    ("retry", "attempts", 2, "integer"),
    ("retry", "delay_seconds", 0, "number"),
    ("do_once", "reset_on_failure", False, "boolean"),
])
def test_all_decorator_parameters_accept_public_inputs(kind, key, value, input_type):
    actions = registry(action_spec(EchoAction()))
    decorator = {"type": kind, **({"attempts": 2} if kind == "retry" else {}), key: {"ref": "inputs.setting"}}
    raw = tree([task("item", "test.echo", decorators=[decorator])], "item")
    raw["inputs"] = {"setting": {"type": input_type, "default": value}}
    workflow = validate(raw, actions)
    result = WorkflowEngine(workflow, actions, Context(), {"setting": value}).run()
    assert result.status == ActionStatus.SUCCEEDED


def test_public_retry_attempts_override_default():
    action = RetryAction()
    actions = registry(action_spec(action))
    raw = tree([task("item", "test.retry", decorators=[{"type": "retry", "attempts": {"ref": "inputs.tries"}}])], "item")
    raw["inputs"] = {"tries": {"type": "integer", "default": 1}}
    result = WorkflowEngine(validate(raw, actions), actions, Context(), {"tries": 2}).run()
    assert result.status == ActionStatus.SUCCEEDED
    assert action.calls == 2


@pytest.mark.parametrize("kind,key,value", [("retry", "attempts", 0), ("retry", "delay_seconds", -1), ("timeout", "seconds", 0), ("cooldown", "seconds", -1)])
def test_invalid_public_decorator_values_fail_cleanly(kind, key, value):
    actions = registry(action_spec(EchoAction()))
    decorator = {"type": kind, **({"attempts": 2} if kind == "retry" else {}), key: {"ref": "inputs.setting"}}
    raw = tree([task("item", "test.echo", decorators=[decorator])], "item")
    raw["inputs"] = {"setting": {"type": "integer", "default": value}}
    result = WorkflowEngine(validate(raw, actions), actions, Context(), {"setting": value}).run()
    assert result.status == ActionStatus.FAILED
    assert any(kind + " decorator failed" in (event.get("error") or "") for event in result.step_history)


def test_engine_repeat_count_can_bind_to_inputs_integer() -> None:
    echo_action = CountingAction()
    echo_action.name = "test.echo"
    actions = registry(action_spec(echo_action))
    raw = tree([
        task(
            "repeatable",
            "test.echo",
            decorators=[{"type": "repeat", "count": {"ref": "inputs.rounds"}}],
        ),
    ], "repeatable")
    raw["inputs"] = {
        "rounds": {"type": "integer", "default": 1, "min": 1},
    }
    result = WorkflowEngine(validate(raw, actions), actions, Context(), {"rounds": 3}).run()
    assert result.status == ActionStatus.SUCCEEDED
    assert echo_action.calls == 3


def test_engine_repeat_runtime_context_selects_the_final_iteration() -> None:
    class RecordingAction(Action):
        name = "test.record"

        def __init__(self) -> None:
            self.values: list[object] = []

        def execute(self, context: Context, arguments: dict[str, Any]) -> ActionResult:
            self.values.append(arguments.get("value"))
            return ActionResult.succeeded({"value": arguments.get("value")})

    action = RecordingAction()
    actions = registry(action_spec(action))
    raw = tree([
        {
            "id": "loop",
            "type": "selector",
            "decorators": [{"type": "repeat", "count": {"ref": "inputs.rounds"}}],
            "children": ["judge", "ordinary"],
        },
        {
            "id": "judge",
            "type": "condition",
            "expression": {"eq": [{"ref": "runtime.repeat.final"}, True]},
            "children": ["final"],
            "ports": ["true"],
        },
        task("final", "test.record", params={"value": "finish"}),
        task("ordinary", "test.record", params={"value": {"ref": "runtime.repeat.index"}}),
    ], "loop")
    raw["inputs"] = {"rounds": {"type": "integer", "default": 1, "min": 1}}

    result = WorkflowEngine(validate(raw, actions), actions, Context(), {"rounds": 3}).run()

    assert result.status == ActionStatus.SUCCEEDED
    assert action.values == [1, 2, "finish"]


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


def guarded_route() -> dict[str, Any]:
    """用户图里最常见的写法：Selector 的每一支以判断节点(condition)开头。"""

    raw = tree([
        {"id": "route", "type": "selector", "children": ["guarded", "fallback"]},
        {"id": "guarded", "type": "sequence", "children": ["judge", "act"]},
        {"id": "judge", "type": "condition", "expression": {"eq": [{"ref": "variables.state"}, "settlement"]}},
        task("act", "test.count"),
        task("fallback", "test.echo"),
    ], "route")
    raw["variables"] = {"state": {"type": "string", "default": "settlement"}}
    return raw


def test_condition_node_is_a_leaf_judgement() -> None:
    guarded = CountingAction()
    guarded.name = "test.count"
    fallback = CountingAction()
    fallback.name = "test.echo"
    actions = registry(action_spec(guarded), action_spec(fallback))
    raw = guarded_route()

    raw["variables"] = {"state": {"type": "string", "default": "settlement"}}
    matched = WorkflowEngine(validate(raw, actions), actions, Context(), {}).run()
    assert matched.status == ActionStatus.SUCCEEDED
    assert guarded.calls == 1
    assert fallback.calls == 0
    assert next(event for event in matched.step_history if event["step_id"] == "judge")["status"] == ActionStatus.SUCCEEDED.value

    raw["variables"] = {"state": {"type": "string", "default": "raid"}}
    missed = WorkflowEngine(validate(raw, actions), actions, Context(), {}).run()
    assert missed.status == ActionStatus.SUCCEEDED
    assert guarded.calls == 1
    assert fallback.calls == 1
    # 判断不成立时由 Selector 回收成 branch_miss（没有假口分支就按失败返回）。
    judge_events = [event for event in missed.step_history if event["step_id"] == "judge"]
    assert judge_events[0]["status"] == "branch_miss"
    assert judge_events[0]["original_status"] == ActionStatus.FAILED.value


def test_condition_node_branch_ports() -> None:
    """判断节点的真/假口：各接一支就走对应那条，另一条不执行。"""

    on_true = CountingAction()
    on_true.name = "test.count"
    on_false = CountingAction()
    on_false.name = "test.echo"
    actions = registry(action_spec(on_true), action_spec(on_false))
    raw = tree([
        {"id": "judge", "type": "condition", "expression": {"eq": [{"ref": "variables.state"}, "settlement"]},
         "children": ["on_true", "on_false"], "ports": ["true", "false"]},
        task("on_true", "test.count"),
        task("on_false", "test.echo"),
    ], "judge")
    raw["variables"] = {"state": {"type": "string", "default": "settlement"}}

    matched = WorkflowEngine(validate(raw, actions), actions, Context(), {}).run()
    assert matched.status == ActionStatus.SUCCEEDED
    assert on_true.calls == 1
    assert on_false.calls == 0

    raw["variables"] = {"state": {"type": "string", "default": "raid"}}
    missed = WorkflowEngine(validate(raw, actions), actions, Context(), {}).run()
    assert missed.status == ActionStatus.SUCCEEDED
    assert on_true.calls == 1
    assert on_false.calls == 1


def test_condition_node_missing_branch_falls_through_selector() -> None:
    """该口空着 = 这条路径没有内容，按失败返回，交给父 Selector 继续试下一支。"""

    guarded = CountingAction()
    guarded.name = "test.count"
    fallback = CountingAction()
    fallback.name = "test.echo"
    actions = registry(action_spec(guarded), action_spec(fallback))
    raw = tree([
        {"id": "route", "type": "selector", "children": ["judge", "fallback"]},
        {"id": "judge", "type": "condition", "expression": {"eq": [{"ref": "variables.state"}, "settlement"]},
         "children": ["act"]},
        task("act", "test.count"),
        task("fallback", "test.echo"),
    ], "route")
    # 没写 ports 时按位置推导：唯一的分支挂在真口。
    raw["variables"] = {"state": {"type": "string", "default": "settlement"}}
    matched = WorkflowEngine(validate(raw, actions), actions, Context(), {}).run()
    assert matched.status == ActionStatus.SUCCEEDED
    assert guarded.calls == 1
    assert fallback.calls == 0

    raw["variables"] = {"state": {"type": "string", "default": "raid"}}
    missed = WorkflowEngine(validate(raw, actions), actions, Context(), {}).run()
    assert missed.status == ActionStatus.SUCCEEDED
    assert guarded.calls == 1
    assert fallback.calls == 1
    judge_events = [event for event in missed.step_history if event["step_id"] == "judge"]
    assert judge_events[0]["status"] == "branch_miss"
    assert "no false branch" in str(judge_events[0]["error"])

    # 显式把分支挂在假口：条件成立时没有真分支，同样按失败返回。
    only_false = tree([
        {"id": "route", "type": "selector", "children": ["judge", "fallback"]},
        {"id": "judge", "type": "condition", "expression": {"eq": [{"ref": "variables.state"}, "settlement"]},
         "children": ["act"], "ports": ["false"]},
        task("act", "test.count"),
        task("fallback", "test.echo"),
    ], "route")
    only_false["variables"] = {"state": {"type": "string", "default": "settlement"}}
    true_side = WorkflowEngine(validate(only_false, actions), actions, Context(), {}).run()
    assert true_side.status == ActionStatus.SUCCEEDED
    assert guarded.calls == 1
    assert fallback.calls == 2

    only_false["variables"] = {"state": {"type": "string", "default": "raid"}}
    false_side = WorkflowEngine(validate(only_false, actions), actions, Context(), {}).run()
    assert false_side.status == ActionStatus.SUCCEEDED
    assert guarded.calls == 2
    assert fallback.calls == 2


def test_condition_node_validation_rules() -> None:
    actions = registry(action_spec(EchoAction()))

    with pytest.raises(ConfigError, match="requires expression"):
        validate(tree([{"id": "judge", "type": "condition"}], "judge"), actions)

    with_action = tree([{"id": "judge", "type": "condition", "expression": True, "action": "test.echo"}], "judge")
    with pytest.raises(ConfigError, match="condition cannot define"):
        validate(with_action, actions)

    with_params = tree([{"id": "judge", "type": "condition", "expression": True, "params": {}}], "judge")
    with pytest.raises(ConfigError, match="condition cannot define"):
        validate(with_params, actions)

    over_two = tree([
        {"id": "judge", "type": "condition", "expression": True, "children": ["a", "b", "c"]},
        task("a", "test.echo"),
        task("b", "test.echo"),
        task("c", "test.echo"),
    ], "judge")
    with pytest.raises(ConfigError, match="at most two branches"):
        validate(over_two, actions)

    mismatch = tree([
        {"id": "judge", "type": "condition", "expression": True, "children": ["a"], "ports": ["true", "false"]},
        task("a", "test.echo"),
    ], "judge")
    with pytest.raises(ConfigError, match="ports must match"):
        validate(mismatch, actions)

    duplicated = tree([
        {"id": "judge", "type": "condition", "expression": True, "children": ["a", "b"], "ports": ["true", "true"]},
        task("a", "test.echo"),
        task("b", "test.echo"),
    ], "judge")
    # 重复口位由 JSON Schema 的 uniqueItems 拦下（validator 里还有一道防御性检查）。
    with pytest.raises(ConfigError, match="non-unique elements"):
        validate(duplicated, actions)

    # 分支里可以用前面兄弟节点的输出（判断节点自己排在被引用节点之后）。
    output_actions = registry(action_spec(EchoAction(), output_schema={"type": "object", "properties": {"value": {"type": "integer"}}}))
    raw = tree([
        {"id": "seq", "type": "sequence", "children": ["produce", "judge"]},
        task("produce", "test.echo", params={"value": 1}),
        {"id": "judge", "type": "condition", "expression": {"gt": [{"ref": "nodes.produce.output.value"}, 0]},
         "children": ["act"], "ports": ["true"]},
        task("act", "test.echo", params={"value": 2}),
    ], "seq")
    parsed = validate(raw, output_actions)
    judge = next(node for node in parsed.nodes if node.id == "judge")
    assert judge.ports == ("true",)
    assert judge.children == ("act",)


def bool_judge_route() -> dict[str, Any]:
    """布尔判断卡片的典型用法：卡片算出一个 bool，判断节点引用它分支。"""

    raw = tree([
        {"id": "seq", "type": "sequence", "children": ["route"]},
        {"id": "on_settlement", "type": "bool_judge", "name": "是否在结算页",
         "expression": {"eq": [{"ref": "variables.state"}, "settlement"]}},
        {"id": "route", "type": "condition", "expression": {"ref": "nodes.on_settlement.output.value"},
         "children": ["act", "skip"], "ports": ["true", "false"]},
        task("act", "test.count"),
        task("skip", "test.echo"),
    ], "seq")
    raw["variables"] = {"state": {"type": "string", "default": "settlement"}}
    return raw


def test_bool_judge_card_is_a_reusable_boolean_value() -> None:
    """布尔判断卡片：求值一次、总是成功，并把结果登记成 `nodes.<id>.output.value`。"""

    on_true = CountingAction()
    on_true.name = "test.count"
    on_false = CountingAction()
    on_false.name = "test.echo"
    actions = registry(action_spec(on_true), action_spec(on_false))

    matched = WorkflowEngine(validate(bool_judge_route(), actions), actions, Context(), {}).run()
    assert matched.status == ActionStatus.SUCCEEDED
    assert on_true.calls == 1
    assert on_false.calls == 0
    card_event = next(event for event in matched.step_history if event["step_id"] == "on_settlement")
    assert card_event["status"] == ActionStatus.SUCCEEDED.value
    assert card_event["node_kind"] == "bool_judge"
    assert card_event["output"] == {"value": True}
    assert matched.output["on_settlement"] == {"value": True}

    raw = bool_judge_route()
    raw["variables"] = {"state": {"type": "string", "default": "raid"}}
    missed = WorkflowEngine(validate(raw, actions), actions, Context(), {}).run()
    assert missed.status == ActionStatus.SUCCEEDED
    assert on_true.calls == 1
    assert on_false.calls == 1
    card_event = next(event for event in missed.step_history if event["step_id"] == "on_settlement")
    assert card_event["output"] == {"value": False}


def test_bool_judge_card_validation_rules() -> None:
    actions = registry(action_spec(EchoAction()))

    with pytest.raises(ConfigError, match="bool_judge requires expression"):
        validate(tree([{"id": "card", "type": "bool_judge"}], "card"), actions)

    with_children = tree([
        {"id": "card", "type": "bool_judge", "expression": True, "children": ["a"]},
        task("a", "test.echo"),
    ], "card")
    with pytest.raises(ConfigError, match="bool_judge cannot define"):
        validate(with_children, actions)

    with_action = tree([{"id": "card", "type": "bool_judge", "expression": True, "action": "test.echo"}], "card")
    with pytest.raises(ConfigError, match="bool_judge cannot define"):
        validate(with_action, actions)

    with_ports = tree([{"id": "card", "type": "bool_judge", "expression": True, "ports": ["true"]}], "card")
    with pytest.raises(ConfigError, match="not valid for bool_judge"):
        validate(with_ports, actions)

    # 卡片是叶子，不能当局部作用域的 owner。
    owner = tree([{"id": "card", "type": "bool_judge", "expression": True}], "card")
    owner["variables"] = {"local": {"type": "integer", "default": 1, "owner": "card"}}
    with pytest.raises(ConfigError, match="must name a composite node"):
        validate(owner, actions)

    # 引用必须带上输出字段。值卡片不在执行树里：它自己的依赖在「使用它的执行点」上判定。
    typed = registry(action_spec(EchoAction(), output_schema={"type": "object", "properties": {"value": {"type": "boolean"}}}))
    good = tree([
        {"id": "seq", "type": "sequence", "children": ["consume"]},
        {"id": "card", "type": "bool_judge", "expression": True},
        task("consume", "test.echo", params={"value": {"ref": "nodes.card.output.value"}}),
    ], "seq")
    assert validate(good, typed).root == "root"

    # 卡片依赖的是排在使用者后面的任务输出 → 使用点拿不到，仍然要报错。
    too_early = tree([
        {"id": "seq", "type": "sequence", "children": ["consume", "produce"]},
        {"id": "card", "type": "bool_judge", "expression": {"eq": [{"ref": "nodes.produce.output.value"}, True]}},
        task("produce", "test.echo", params={"value": True}),
        task("consume", "test.echo", params={"value": {"ref": "nodes.card.output.value"}}),
    ], "seq")
    with pytest.raises(ConfigError, match="unavailable at this execution point"):
        validate(too_early, typed)

    missing_field = tree([
        {"id": "seq", "type": "sequence", "children": ["consume"]},
        {"id": "card", "type": "bool_judge", "expression": True},
        task("consume", "test.echo", params={"value": {"ref": "nodes.card.output"}}),
    ], "seq")
    with pytest.raises(ConfigError, match="invalid structured reference"):
        validate(missing_field, typed)


def _break_source_actions() -> ActionRegistry:
    """拆分测试用的动作：`test.passthrough` 原样返回参数（带对象/数组属性）；`test.consume` 只是消费参数。"""

    consume = EchoAction()
    consume.name = "test.consume"
    return registry(
        action_spec(
            PassThroughAction(),
            output_schema={
                "type": "object",
                "properties": {
                    "value": {
                        "type": "object",
                        "properties": {
                            "matched": {"type": "boolean"},
                            "x": {"type": "integer"},
                            "y": {"type": "integer"},
                        },
                        "additionalProperties": False,
                    },
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"name": {"type": "string"}, "score": {"type": "integer"}},
                            "additionalProperties": False,
                        },
                    },
                },
                "additionalProperties": False,
            },
        ),
        action_spec(consume),
    )


def test_break_card_unpacks_object_and_array_outputs() -> None:
    """拆分卡片：把一张卡片的对象/数组输出按字段拆开，登记成 `nodes.<id>.output.<字段>`。"""

    actions = _break_source_actions()
    raw = tree([
        {"id": "seq", "type": "sequence", "children": ["produce", "consume"]},
        task("produce", "test.passthrough", params={"value": {"matched": True, "x": 3, "y": 7}, "items": [{"name": "a", "score": 1}, {"name": "b", "score": 2}]}),
        {"id": "unpack", "type": "break", "name": "拆开匹配结果",
         "ref": {"ref": "nodes.produce.output.value"},
         "fields": {"x": "x", "matched": "matched"}},
        task("consume", "test.consume", params={"value": {"ref": "nodes.unpack.output.x"}}),
    ], "seq")
    result = WorkflowEngine(validate(raw, actions), actions, Context(), {}).run()
    assert result.status == ActionStatus.SUCCEEDED
    unpack_event = next(event for event in result.step_history if event["step_id"] == "unpack")
    assert unpack_event["node_kind"] == "break"
    assert unpack_event["status"] == ActionStatus.SUCCEEDED.value
    assert unpack_event["output"] == {"x": 3, "matched": True}
    assert result.output["unpack"] == {"x": 3, "matched": True}
    consume_event = next(event for event in result.step_history if event["step_id"] == "consume")
    assert consume_event["output"] == {"value": 3}

    # 数组按下标拆：`1.score` → 2。
    array_raw = tree([
        {"id": "seq", "type": "sequence", "children": ["produce", "consume2"]},
        task("produce", "test.passthrough", params={"value": {"matched": True, "x": 3, "y": 7}, "items": [{"name": "a", "score": 1}, {"name": "b", "score": 2}]}),
        {"id": "split_items", "type": "break", "ref": {"ref": "nodes.produce.output.items"}, "fields": {"top_score": "1.score"}},
        task("consume2", "test.consume", params={"value": {"ref": "nodes.split_items.output.top_score"}}),
    ], "seq")
    result2 = WorkflowEngine(validate(array_raw, actions), actions, Context(), {}).run()
    assert result2.status == ActionStatus.SUCCEEDED
    assert result2.output["split_items"] == {"top_score": 2}


def test_break_card_mirrors_source_schema_without_fields() -> None:
    """未声明 fields 时，拆分卡片整体镜像原输出，字段同名可直接引用。"""

    actions = _break_source_actions()
    raw = tree([
        {"id": "seq", "type": "sequence", "children": ["produce", "consume"]},
        task("produce", "test.passthrough", params={"value": {"matched": True, "x": 3, "y": 7}}),
        {"id": "mirror", "type": "break", "ref": {"ref": "nodes.produce.output.value"}},
        task("consume", "test.consume", params={"value": {"ref": "nodes.mirror.output.y"}}),
    ], "seq")
    result = WorkflowEngine(validate(raw, actions), actions, Context(), {}).run()
    assert result.status == ActionStatus.SUCCEEDED
    assert result.output["mirror"] == {"matched": True, "x": 3, "y": 7}
    consume_event = next(event for event in result.step_history if event["step_id"] == "consume")
    assert consume_event["output"] == {"value": 7}


def test_break_card_accepts_a_whole_node_output_ref() -> None:
    """`nodes.<id>.output`（不带字段）运行时也要能解析：拆分卡片就是这么拿整张卡片的输出的。"""

    actions = _break_source_actions()
    raw = tree([
        {"id": "seq", "type": "sequence", "children": ["produce", "consume"]},
        task("produce", "test.passthrough", params={"value": {"matched": True, "x": 3, "y": 7}}),
        {"id": "mirror", "type": "break", "ref": {"ref": "nodes.produce.output"}},
        task("consume", "test.consume", params={"value": {"ref": "nodes.mirror.output.value.y"}}),
    ], "seq")
    result = WorkflowEngine(validate(raw, actions), actions, Context(), {}).run()
    assert result.status == ActionStatus.SUCCEEDED, result.error
    assert result.output["mirror"] == {"value": {"matched": True, "x": 3, "y": 7}}
    consume_event = next(event for event in result.step_history if event["step_id"] == "consume")
    assert consume_event["output"] == {"value": 7}


def test_break_card_unpacks_workflow_input_tuple() -> None:
    """拆分来源可以是工作流输入：区域 rect 是定长四元组，按下标拆成可引用的分量。"""

    actions = _break_source_actions()
    raw = tree([
        {"id": "seq", "type": "sequence", "children": ["consume"]},
        {"id": "split", "type": "break", "name": "拆区域",
         "ref": {"ref": "inputs.识别区域"}, "fields": {"left": "0", "width": "2"}},
        task("consume", "test.consume", params={"value": {"ref": "nodes.split.output.width"}}),
    ], "seq", inputs={"识别区域": {"type": "rect", "default": [720, 973, 486, 107]}})
    result = WorkflowEngine(validate(raw, actions), actions, Context(), {"识别区域": [720, 973, 486, 107]}).run()
    assert result.status == ActionStatus.SUCCEEDED
    assert result.output["split"] == {"left": 720, "width": 486}
    consume_event = next(event for event in result.step_history if event["step_id"] == "consume")
    assert consume_event["output"] == {"value": 486}

    # 定长元组只有 0..3：越界下标的字段路径在保存期就被拒。
    bad = tree([
        {"id": "seq", "type": "sequence", "children": ["consume"]},
        {"id": "split", "type": "break", "ref": {"ref": "inputs.识别区域"}, "fields": {"left": "4"}},
        task("consume", "test.consume", params={"value": {"ref": "nodes.split.output.left"}}),
    ], "seq", inputs={"识别区域": {"type": "rect", "default": [720, 973, 486, 107]}})
    with pytest.raises(ConfigError, match="does not exist in the target output schema"):
        validate(bad, actions)


def test_break_card_validation_rules() -> None:
    actions = _break_source_actions()

    with pytest.raises(ConfigError, match="break requires a ref binding"):
        validate(tree([{"id": "card", "type": "break"}], "card"), actions)

    bad_ref = tree([{"id": "card", "type": "break", "ref": "nodes.a.output.value"}], "card")
    with pytest.raises(ConfigError, match="break requires a ref binding"):
        validate(bad_ref, actions)

    with_children = tree([
        {"id": "card", "type": "break", "ref": {"ref": "nodes.produce.output.value"}, "children": ["a"]},
        task("a", "test.passthrough"),
    ], "card")
    with pytest.raises(ConfigError, match="break cannot define"):
        validate(with_children, actions)

    with_action = tree([{"id": "card", "type": "break", "ref": {"ref": "nodes.produce.output.value"}, "action": "test.passthrough"}], "card")
    with pytest.raises(ConfigError, match="break cannot define"):
        validate(with_action, actions)

    with_params = tree([{"id": "card", "type": "break", "ref": {"ref": "nodes.produce.output.value"}, "params": {"a": 1}}], "card")
    with pytest.raises(ConfigError, match="break cannot define"):
        validate(with_params, actions)

    bad_fields_shape = tree([
        {"id": "seq", "type": "sequence", "children": ["produce"]},
        task("produce", "test.passthrough", params={"value": {"matched": True, "x": 3, "y": 7}}),
        {"id": "card", "type": "break", "ref": {"ref": "nodes.produce.output.value"}, "fields": []},
    ], "seq")
    with pytest.raises(ConfigError, match=r"\.fields must be an object"):
        validate(bad_fields_shape, actions)

    bad_field_name = tree([
        {"id": "seq", "type": "sequence", "children": ["produce"]},
        task("produce", "test.passthrough", params={"value": {"matched": True, "x": 3, "y": 7}}),
        {"id": "card", "type": "break", "ref": {"ref": "nodes.produce.output.value"}, "fields": {"": "x"}},
    ], "seq")
    with pytest.raises(ConfigError, match="fields keys must be non-empty"):
        validate(bad_field_name, actions)

    bad_field_path = tree([
        {"id": "seq", "type": "sequence", "children": ["produce"]},
        task("produce", "test.passthrough", params={"value": {"matched": True, "x": 3, "y": 7}}),
        {"id": "card", "type": "break", "ref": {"ref": "nodes.produce.output.value"}, "fields": {"nope": "nope"}},
    ], "seq")
    with pytest.raises(ConfigError, match="does not exist in the target output schema"):
        validate(bad_field_path, actions)

    # 目标是标量输出时拒绝：拆分只能拆对象/数组。
    scalar_actions = registry(
        action_spec(EchoAction(), output_schema={"type": "object", "properties": {"value": {"type": "boolean"}}, "additionalProperties": False})
    )
    scalar_target = tree([
        {"id": "seq", "type": "sequence", "children": ["flag"]},
        task("flag", "test.echo", params={"value": True}),
        {"id": "card", "type": "break", "ref": {"ref": "nodes.flag.output.value"}},
    ], "seq")
    with pytest.raises(ConfigError, match="must reference an object or array output"):
        validate(scalar_target, scalar_actions)

    # 卡片依赖的是排在使用者后面的任务输出 → 使用点拿不到，仍然要报错。
    too_early = tree([
        {"id": "seq", "type": "sequence", "children": ["consume", "flag"]},
        task("flag", "test.echo", params={"value": True}),
        {"id": "card", "type": "break", "ref": {"ref": "nodes.flag.output.value"}},
        task("consume", "test.echo", params={"value": {"ref": "nodes.card.output.value"}}),
    ], "seq")
    with pytest.raises(ConfigError, match="unavailable at this execution point"):
        validate(too_early, scalar_actions)

    # 来源是不产生输出的节点（判断节点）→ 不可用报错。
    no_output = tree([
        {"id": "seq", "type": "sequence", "children": ["judge", "consume"]},
        {"id": "judge", "type": "condition", "expression": True},
        {"id": "card", "type": "break", "ref": {"ref": "nodes.judge.output.value"}},
        task("consume", "test.consume", params={"value": {"ref": "nodes.card.output.value"}}),
    ], "seq")
    with pytest.raises(ConfigError, match="unavailable at this execution point"):
        validate(no_output, actions)

    # 卡片是叶子，不能当局部作用域的 owner。
    owner = tree([{"id": "card", "type": "break", "ref": {"ref": "nodes.produce.output.value"}}], "card")
    owner["variables"] = {"local": {"type": "integer", "default": 1, "owner": "card"}}
    with pytest.raises(ConfigError, match="must name a composite node"):
        validate(owner, actions)

    # 消费端引用拆分输出里的未知字段 → 报错。
    unknown_field = tree([
        {"id": "seq", "type": "sequence", "children": ["produce", "consume"]},
        task("produce", "test.passthrough", params={"value": {"matched": True, "x": 3, "y": 7}}),
        {"id": "card", "type": "break", "ref": {"ref": "nodes.produce.output.value"}, "fields": {"x": "x"}},
        task("consume", "test.consume", params={"value": {"ref": "nodes.card.output.nope"}}),
    ], "seq")
    with pytest.raises(ConfigError, match="references an unknown"):
        validate(unknown_field, actions)


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

    unlimited = validate(tree([task("a", "test.echo")], "a"), actions)
    assert unlimited.timeout_seconds is None
    assert unlimited.max_steps is None

    many_children = [
        {"id": f"step_{index}", "type": "condition", "expression": False}
        for index in range(1001)
    ]
    many = tree(
        [{"id": "pick", "type": "selector", "children": [child["id"] for child in many_children]}, *many_children],
        "pick",
    )
    many_result = WorkflowEngine(validate(many, actions), actions, Context(), {}).run()
    assert many_result.error_category == "condition"
    assert len(many_result.step_history) >= 1001


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


def test_workflow_loader_hash_paths_and_inputs_defaults(tmp_path: Path) -> None:
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
        task("match", "vision.match_template", {"template": {"ref": "inputs.template"}}),
        task("echo", "test.echo", {"value": {"ref": "inputs.options.enabled"}}),
    ], "seq", inputs={
        "template": {"type": "asset", "required": True},
        "options": {"type": "object", "default": {}, "properties": {"enabled": {"type": "boolean", "default": True}}},
    })
    path = write_workflow(workflow_dir / "one.owf", raw)
    loader = WorkflowLoader(workflow_dir, actions, project_root=tmp_path)
    first = loader.load("one")
    normalized = loader.normalize_inputs(first, {"template": "assets/inside.png"})
    assert normalized["options"] == {"enabled": True}
    assert first.file_hash == hashlib.sha256(path.read_bytes()).hexdigest()
    write_workflow(path, {**raw, "version": "3.0.1"})
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
        [task("echo", "test.echo", {"value": {"ref": "inputs.rounds"}})],
        "echo",
        inputs={"rounds": {"type": "integer", "required": True, "default": 30}},
    )
    write_workflow(workflow_dir / "defaults.owf", raw)
    actions = registry(action_spec(EchoAction()))
    loader = WorkflowLoader(workflow_dir, actions, project_root=tmp_path)

    normalized = loader.normalize_inputs(loader.load("defaults"), {})

    assert normalized == {"rounds": 30}


def test_workflow_loader_only_accepts_declared_child_inputs(tmp_path: Path) -> None:
    workflow_dir = tmp_path / "workflows"
    workflow_dir.mkdir()
    raw = tree(
        [task("echo", "test.echo", {"value": {"ref": "inputs.public_value"}})],
        "echo",
        inputs={
            "public_value": {"type": "string", "required": True},
            "legacy_value": {"type": "integer", "default": 1},
        },
        variables={"private_value": {"type": "string", "default": "internal"}},
    )
    write_workflow(workflow_dir / "child.owf", raw)
    loader = WorkflowLoader(workflow_dir, registry(action_spec(EchoAction())), project_root=tmp_path)
    child = loader.load("child")

    assert child.input_names == ("public_value", "legacy_value")
    assert loader.normalize_inputs(
        child,
        {"public_value": "from-parent", "legacy_value": 2},
        declared_only=True,
    ) == {
        "public_value": "from-parent",
        "legacy_value": 2,
    }
    with pytest.raises(ConfigError, match="not declared: private_value"):
        loader.normalize_inputs(
            child,
            {"public_value": "from-parent", "private_value": "override"},
            declared_only=True,
        )


def test_instance_parallel_rejects_runtime_variables_as_child_inputs(tmp_path: Path) -> None:
    workflow_dir = tmp_path / "workflows"
    workflow_dir.mkdir()
    child = tree(
        [task("echo", "test.echo")],
        "echo",
        inputs={
            "rounds": {"type": "integer", "default": 1},
        },
        variables={"secret": {"type": "string", "default": "internal"}},
    )
    write_workflow(workflow_dir / "child.owf", child)
    parent = tree([
        {
            "id": "parallel",
            "type": "instance_parallel",
            "runs": [{"instance": "mumu-0", "workflow": "child.json", "inputs": {"secret": "override"}}],
        },
    ], "parallel")

    with pytest.raises(ConfigError, match="undeclared child inputs: secret"):
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
    path = write_workflow(nested / "nested_entry.owf", raw)
    actions = registry(action_spec(EchoAction()))
    loader = WorkflowLoader(workflow_dir, actions, project_root=tmp_path)

    assert loader.path_for("entrypoints/nested_entry.json") == path.resolve()
    assert loader.path_for("nested_entry") == path.resolve()
    assert list(loader.discover()) == [raw["id"]]


