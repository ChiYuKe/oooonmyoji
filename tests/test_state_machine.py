"""状态机卡片（`state_machine`）：图编译、校验与运行时循环的契约测试。

三件事分别锁定：

- **图编译**：`case.<下标>` 的下标指向 `states`，编译成 `cases[].value`（状态名）+ `children`；
  `default` 编译成 `default_child`；图形态里不保留 `cases`；
- **校验**：非终止状态必须有处理子图、终止状态不许接线、状态名/终止名自洽；
- **运行时**：识别 → 分发到对应处理子图 → 重新识别（隐式切换），命中终止状态成功结束，
  处理子图失败即整机失败，轮数用尽按 `workflow_limit` 失败。
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import pytest

from src.oooonmyoji.actions import Action, ActionRegistry, ActionResult, ActionSpec, build_action_registry
from src.oooonmyoji.actions.manifest import ActionDefinition, ParameterDefinition
from src.oooonmyoji.config.loader import _validate_json_schema
from src.oooonmyoji.exceptions import ConfigError
from src.oooonmyoji.vision.template import TemplateMatch
from src.oooonmyoji.workflows.dsl import emit_document, parse_document
from src.oooonmyoji.workflows.engine import WorkflowEngine
from src.oooonmyoji.workflows.graph_compile import compile_graph
from src.oooonmyoji.workflows.graph_schema import GRAPH_SCHEMA
from src.oooonmyoji.workflows.validator import validate_workflow

PROJECT_ROOT = Path(__file__).resolve().parents[1]


# --------------------------------------------------------------------------------------
# 测试替身
# --------------------------------------------------------------------------------------


class Screen:
    """被识别函数读的「当前画面」：状态名 → `<状态名>.png` 命中。"""

    def __init__(self, state: str) -> None:
        self.state = state


class ScreenContext:
    """引擎需要的最小上下文，外加把画面翻译成模板命中的 `find_template`。"""

    def __init__(self, state: str) -> None:
        self.screen = Screen(state)
        self.captures = 0
        self.last_frame: object | None = None

    def check_cancelled(self) -> None:
        return None

    def begin_action(self) -> None:
        return None

    def bind_action(self, token: object) -> None:
        return None

    def end_action(self, token: object) -> None:
        return None

    def request_action_cancel(self, token: object = None) -> None:
        return None

    def capture(self) -> object:
        self.captures += 1
        self.last_frame = object()
        return self.last_frame

    def find_template(self, template: str, **_: Any) -> list[TemplateMatch]:
        if template != f"{self.screen.state}.png":
            return []
        return [TemplateMatch(10, 20, 30, 40, 0.99, 10.0, 20.0, 30.0, 40.0)]

    def ocr(self, roi: Any = None) -> list[Any]:
        return []

    def ocr_current(self, roi: Any = None) -> list[Any]:
        return []


class SetStateAction(Action):
    """处理子图的替身：把画面推进到下一个状态。"""

    name = "test.set_state"

    def execute(self, context: ScreenContext, arguments: dict[str, Any]) -> ActionResult:
        context.screen.state = str(arguments["state"])
        return ActionResult.succeeded({"state": context.screen.state})


class FailAction(Action):
    name = "test.fail"

    def execute(self, context: ScreenContext, arguments: dict[str, Any]) -> ActionResult:
        return ActionResult.failed("expected failure", category="test")


class RecordAction(Action):
    """记录被喂进来的值，用来断言状态机输出确实被下游读到。"""

    name = "test.record"

    def __init__(self) -> None:
        self.values: list[Any] = []

    def execute(self, context: ScreenContext, arguments: dict[str, Any]) -> ActionResult:
        self.values.append(arguments.get("value"))
        return ActionResult.succeeded({"value": arguments.get("value")})


class CustomClassifier(Action):
    """替换「判断当前画面」这一步的替身：只按画面名判断，证明分类器是可替换的角色。"""

    name = "test.classify"

    def execute(self, context: ScreenContext, arguments: dict[str, Any]) -> ActionResult:
        declared = [
            str(item.get("name"))
            for item in arguments.get("states", [])
            if isinstance(item, dict) and item.get("name")
        ]
        current = str(context.screen.state)
        if current not in declared:
            return ActionResult.failed("no state matched", category="not_matched")
        return ActionResult.succeeded({
            "state": current,
            "source": "stub",
            "confidence": 0.5,
            "match": {"template": f"{current}.png", "reference": [7.0, 8.0, 9.0, 10.0]},
        })


def definition(
    name: str,
    *,
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
        retry="safe",
        side_effect=False,
        input_schema={"type": "object"},
    )


@lru_cache(maxsize=1)
def _real_registry() -> ActionRegistry:
    """真实 manifest 构建的注册表（读盘一次，供所有替身注册表复用）。"""

    return build_action_registry(PROJECT_ROOT / "plugins" / "actions")


def registry(*specs: ActionSpec) -> ActionRegistry:
    """状态机识别走真正的 `vision.detect_state`：替身注册表也要带上它。"""

    real = _real_registry()
    result = ActionRegistry()
    result.register(real.get("vision.detect_state"))
    for spec in specs:
        result.register(spec)
    return result


def action_spec(action: Action, **kwargs: Any) -> ActionSpec:
    return ActionSpec(definition(action.name, **kwargs), action)


def task(node_id: str, action: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"id": node_id, "type": "task", "action": action, "params": params or {}}


def machine_node(**overrides: Any) -> dict[str, Any]:
    """默认的三状态机器：home → battle → done（done 是终止状态）。"""

    node: dict[str, Any] = {
        "id": "sm",
        "type": "state_machine",
        "states": [
            {"name": "home", "template": "home.png"},
            {"name": "battle", "template": "battle.png"},
            {"name": "done", "template": "done.png"},
        ],
        "terminal_states": ["done"],
        "cases": [
            {"value": "home", "child": "handle_home"},
            {"value": "battle", "child": "handle_battle"},
        ],
        "children": ["handle_home", "handle_battle"],
        "max_iterations": 8,
    }
    node.update(overrides)
    return node


def default_handlers() -> list[dict[str, Any]]:
    return [
        task("handle_home", "test.set_state", {"state": "battle"}),
        task("handle_battle", "test.set_state", {"state": "done"}),
    ]


def state_machine_doc(
    *,
    node: dict[str, Any] | None = None,
    handlers: list[dict[str, Any]] | None = None,
    extra_nodes: list[dict[str, Any]] | None = None,
    root_child: str = "sm",
    **overrides: Any,
) -> dict[str, Any]:
    """把状态机节点、它的处理子图与可选附加节点拼成一份 v4 工作流。"""

    if node is None:
        node = machine_node(**overrides)
    if handlers is None:
        handlers = default_handlers()
    return {
        "schema_version": 4,
        "id": "sm_workflow",
        "version": "1.0.0",
        "resolution": [1920, 1080],
        "root": "root",
        "inputs": {},
        "variables": {},
        "nodes": [
            {"id": "root", "type": "root", "children": [root_child]},
            node,
            *handlers,
            *(extra_nodes or []),
        ],
    }


def sequence_output_doc(record: ActionSpec) -> dict[str, Any]:
    """`sequence [状态机, 记录]`：用来验证下游能读到状态机的输出。"""

    return state_machine_doc(
        root_child="main",
        node=machine_node(),
        handlers=default_handlers(),
        extra_nodes=[
            {"id": "main", "type": "sequence", "children": ["sm", "record"]},
            task("record", "test.record", {"value": {"ref": "nodes.sm.output.state"}}),
        ],
    )


def validate(raw: dict[str, Any], actions: ActionRegistry) -> Any:
    return validate_workflow(raw, Path("sm.json"), actions, project_root=Path.cwd())


def actions() -> ActionRegistry:
    return registry(
        action_spec(SetStateAction()),
        action_spec(FailAction()),
        action_spec(RecordAction()),
    )


# --------------------------------------------------------------------------------------
# 图编译
# --------------------------------------------------------------------------------------


GRAPH_TEXT = """workflow sm
  version: 1.0.0
  resolution: [1920, 1080]
  root: root

  node root root 入口
    at: [0, 0]
  node sm state_machine 主循环
    at: [100, 0]
    states:
      - name: home
        template: home.png
      - name: done
        template: done.png
    terminal_states: [done]
    max_iterations: 3
  node handle_home task 处理首页
    at: [200, 0]
    action: test.set_state
    params:
      state: done
  node fallback task 兜底
    at: [200, 100]
    action: test.set_state
    params:
      state: home

  edges:
    root -> sm
    sm:case.0 -> handle_home
    sm:default -> fallback
"""


def test_graph_compile_turns_case_pins_into_state_handlers() -> None:
    document = parse_document(GRAPH_TEXT, path="sm.owf")
    _validate_json_schema(document, GRAPH_SCHEMA, "sm graph")

    compiled = compile_graph(document)
    node = next(item for item in compiled["nodes"] if item["id"] == "sm")

    # 状态名只在 `states` 里写一份，`cases[].value` 由它派生。
    assert node["cases"] == [{"value": "home", "child": "handle_home"}]
    assert node["children"] == ["handle_home", "fallback"]
    assert node["default_child"] == "fallback"
    assert node["states"][0]["name"] == "home"
    assert node["terminal_states"] == ["done"]
    assert node["max_iterations"] == 3


def test_graph_form_keeps_case_wiring_in_edges_only() -> None:
    """图形态里没有 `cases` / `children`：连线一律在顶层 edges。"""

    document = parse_document(GRAPH_TEXT, path="sm.owf")
    node = next(item for item in document["nodes"] if item["id"] == "sm")
    assert "cases" not in node
    assert "children" not in node
    assert "default_child" not in node
    assert {edge["from"]["pin"] for edge in document["edges"] if edge["from"]["node"] == "sm"} == {"case.0", "default"}


def test_graph_text_roundtrips_byte_stable() -> None:
    document = parse_document(GRAPH_TEXT, path="sm.owf")
    once = emit_document(document)
    twice = emit_document(parse_document(once, path="sm.owf"))
    assert once == twice


def test_graph_text_roundtrips_state_action() -> None:
    text = GRAPH_TEXT.replace(
        "    terminal_states: [done]\n",
        "    terminal_states: [done]\n    state_action: vision.detect_state\n",
    )
    document = parse_document(text, path="sm.owf")
    node = next(item for item in document["nodes"] if item["id"] == "sm")
    assert node["state_action"] == "vision.detect_state"
    once = emit_document(document)
    assert once == emit_document(parse_document(once, path="sm.owf"))
    compiled = compile_graph(document)
    assert next(item for item in compiled["nodes"] if item["id"] == "sm")["state_action"] == "vision.detect_state"


def test_graph_compile_rejects_case_index_beyond_states() -> None:
    text = GRAPH_TEXT.replace("sm:case.0 -> handle_home", "sm:case.4 -> handle_home")
    with pytest.raises(ConfigError, match="only declares 2 states"):
        compile_graph(parse_document(text, path="sm.owf"))


def test_graph_compile_rejects_declared_cases_on_state_machine() -> None:
    document = parse_document(GRAPH_TEXT, path="sm.owf")
    node = next(item for item in document["nodes"] if item["id"] == "sm")
    node["cases"] = [{"value": "home"}]
    with pytest.raises(ConfigError, match="cannot declare cases"):
        compile_graph(document)


def test_decompile_round_trips_case_wiring() -> None:
    """v4 → 图 → v4：状态机接线还原成 case.<下标> 边，再编译回同样的 cases。"""

    from src.oooonmyoji.workflows.graph_compile import decompile_workflow

    original = state_machine_doc()
    document = decompile_workflow(original)
    node = next(item for item in document["nodes"] if item["id"] == "sm")
    assert "cases" not in node
    assert {edge["from"]["pin"] for edge in document["edges"] if edge["from"]["node"] == "sm"} == {"case.0", "case.1"}

    recompiled = compile_graph(document)
    source = next(item for item in original["nodes"] if item["id"] == "sm")
    target = next(item for item in recompiled["nodes"] if item["id"] == "sm")
    assert target["cases"] == source["cases"]
    assert target["children"] == source["children"]
    assert target["states"] == source["states"]


# --------------------------------------------------------------------------------------
# 校验
# --------------------------------------------------------------------------------------


def test_validator_accepts_state_machine() -> None:
    spec = validate(state_machine_doc(), actions())
    node = next(item for item in spec.nodes if item.id == "sm")
    assert node.type == "state_machine"
    assert [state["name"] for state in node.states] == ["home", "battle", "done"]
    assert node.terminal_states == ("done",)
    assert node.cases == (("home", "handle_home"), ("battle", "handle_battle"))
    assert node.produces_output is True


def test_validator_rejects_state_without_handler() -> None:
    raw = state_machine_doc(cases=[{"value": "home", "child": "handle_home"}], children=["handle_home"])
    with pytest.raises(ConfigError, match="no handler for state"):
        validate(raw, actions())


def test_validator_rejects_handler_for_terminal_state() -> None:
    raw = state_machine_doc(
        states=[
            {"name": "home", "template": "home.png"},
            {"name": "done", "template": "done.png"},
        ],
        terminal_states=["done"],
        cases=[{"value": "home", "child": "handle_home"}, {"value": "done", "child": "handle_battle"}],
        children=["handle_home", "handle_battle"],
    )
    with pytest.raises(ConfigError, match="wires terminal state"):
        validate(raw, actions())


def test_validator_rejects_unknown_terminal_state() -> None:
    with pytest.raises(ConfigError, match="must reference declared states"):
        validate(state_machine_doc(terminal_states=["missing"]), actions())


def test_validator_rejects_duplicate_state_names() -> None:
    raw = state_machine_doc(
        states=[
            {"name": "home", "template": "home.png"},
            {"name": "home", "template": "battle.png"},
            {"name": "done", "template": "done.png"},
        ],
    )
    with pytest.raises(ConfigError, match="duplicate state name"):
        validate(raw, actions())


def test_validator_rejects_state_without_detection_source() -> None:
    with pytest.raises(ConfigError, match="requires template, templates or texts"):
        validate(state_machine_doc(states=[{"name": "home"}]), actions())


def test_state_can_list_multiple_templates() -> None:
    """同一页面的不同外观（亮标 / 灰标）算一个状态，这样才能共用一个处理子图。"""

    raw = state_machine_doc(
        states=[
            {"name": "target", "templates": ["lit.png", "dim.png"], "roi": [0, 0, 10, 10]},
            {"name": "done", "template": "done.png"},
        ],
        terminal_states=["done"],
        cases=[{"value": "target", "child": "handle_home"}],
        children=["handle_home"],
        handlers=[task("handle_home", "test.set_state", {"state": "done"})],
    )
    spec = validate(raw, actions())
    node = next(item for item in spec.nodes if item.id == "sm")
    assert node.states[0]["templates"] == ["lit.png", "dim.png"]

    # 亮标命中即算 target：第二轮识别到 done（终止）后成功结束。
    context = ScreenContext("dim")
    result = WorkflowEngine(spec, actions(), context, {}).run()
    assert result.status.value == "succeeded"
    assert result.output["sm"]["state"] == "done"


def test_state_templates_must_be_a_non_empty_array() -> None:
    with pytest.raises(ConfigError):
        validate(state_machine_doc(states=[{"name": "home", "templates": []}]), actions())


def test_validator_rejects_unknown_state_field() -> None:
    with pytest.raises(ConfigError, match="states"):
        validate(state_machine_doc(states=[{"name": "home", "template": "home.png", "colour": "red"}]), actions())


@pytest.mark.parametrize("overrides", [{"allow_ocr": "yes"}, {"max_iterations": 0}, {"max_iterations": True}])
def test_validator_rejects_bad_machine_options(overrides: dict[str, Any]) -> None:
    with pytest.raises(ConfigError):
        validate(state_machine_doc(**overrides), actions())


def test_validator_rejects_children_that_do_not_match_cases() -> None:
    raw = state_machine_doc(children=["handle_home"])
    with pytest.raises(ConfigError, match="children must list every case/default child"):
        validate(raw, actions())


def test_validator_rejects_state_fields_on_other_nodes() -> None:
    raw = state_machine_doc(
        states=[
            {"name": "home", "template": "home.png"},
            {"name": "done", "template": "done.png"},
        ],
        terminal_states=["done"],
        cases=[{"value": "home", "child": "seq"}],
        children=["seq"],
        handlers=[{"id": "seq", "type": "sequence", "children": ["handle_home"], "states": [{"name": "x"}]},
                  task("handle_home", "test.set_state", {"state": "done"})],
    )
    with pytest.raises(ConfigError, match="not valid for sequence"):
        validate(raw, actions())


def test_validator_rejects_unknown_case_value() -> None:
    raw = state_machine_doc(
        cases=[{"value": "home", "child": "handle_home"}, {"value": "nope", "child": "handle_battle"}],
    )
    with pytest.raises(ConfigError, match="must name a declared state"):
        validate(raw, actions())


def test_terminal_state_can_omit_handler_and_have_no_case_edge() -> None:
    raw = state_machine_doc(
        states=[
            {"name": "home", "template": "home.png"},
            {"name": "done", "template": "done.png"},
        ],
        terminal_states=["done"],
        cases=[{"value": "home", "child": "handle_home"}],
        children=["handle_home"],
        max_iterations=4,
        handlers=[task("handle_home", "test.set_state", {"state": "done"})],
    )
    spec = validate(raw, actions())
    node = next(item for item in spec.nodes if item.id == "sm")
    assert node.cases == (("home", "handle_home"),)
    assert node.default_child is None


def test_state_template_can_bind_to_an_input() -> None:
    raw = state_machine_doc(
        states=[
            {"name": "home", "template": {"ref": "inputs.目标"}},
            {"name": "done", "template": "done.png"},
        ],
        terminal_states=["done"],
        cases=[{"value": "home", "child": "handle_home"}],
        children=["handle_home"],
        handlers=[task("handle_home", "test.set_state", {"state": "done"})],
    )
    raw["inputs"] = {"目标": {"type": "asset", "default": "home.png"}}
    validate(raw, actions())


def test_state_template_binding_must_match_the_declared_type() -> None:
    raw = state_machine_doc(
        states=[
            {"name": "home", "template": {"ref": "inputs.次数"}},
            {"name": "done", "template": "done.png"},
        ],
        terminal_states=["done"],
        cases=[{"value": "home", "child": "handle_home"}],
        children=["handle_home"],
        handlers=[task("handle_home", "test.set_state", {"state": "done"})],
    )
    raw["inputs"] = {"次数": {"type": "integer", "default": 1}}
    with pytest.raises(ConfigError, match="binding type is incompatible"):
        validate(raw, actions())


def test_state_machine_output_is_readable_by_later_siblings() -> None:
    record = action_spec(RecordAction())
    raw = sequence_output_doc(record)
    spec = validate(raw, registry(action_spec(SetStateAction()), record))
    assert spec.root == "root"


# --------------------------------------------------------------------------------------
# 运行时
# --------------------------------------------------------------------------------------


def run(raw: dict[str, Any], context: ScreenContext, action_registry: ActionRegistry) -> Any:
    spec = validate(raw, action_registry)
    return WorkflowEngine(spec, action_registry, context, {}).run()


def test_runtime_dispatches_per_state_and_ends_on_terminal_state() -> None:
    context = ScreenContext("home")
    result = run(state_machine_doc(), context, actions())

    assert result.status.value == "succeeded"
    assert result.output["sm"]["state"] == "done"
    assert result.output["sm"]["terminal"] is True
    assert context.screen.state == "done"


def test_runtime_output_records_last_state_and_iterations() -> None:
    record = action_spec(RecordAction())
    context = ScreenContext("home")
    result = run(sequence_output_doc(record), context, registry(action_spec(SetStateAction()), record))

    assert result.status.value == "succeeded"
    assert record.action.values == ["done"]


def test_runtime_uses_default_handler_when_no_state_matches() -> None:
    raw = state_machine_doc(
        default_child="fallback",
        children=["handle_home", "handle_battle", "fallback"],
        handlers=[*default_handlers(), task("fallback", "test.set_state", {"state": "done"})],
    )
    context = ScreenContext("unknown")
    result = run(raw, context, actions())

    assert result.status.value == "succeeded"
    assert context.screen.state == "done"


def test_runtime_fails_when_no_state_matches_and_no_default() -> None:
    context = ScreenContext("unknown")
    result = run(state_machine_doc(), context, actions())

    assert result.status.value == "failed"
    assert result.error_category == "not_matched"
    assert result.error is not None and "matched none of the configured states" in result.error


def test_runtime_stops_when_a_handler_fails() -> None:
    raw = state_machine_doc(
        states=[
            {"name": "home", "template": "home.png"},
            {"name": "done", "template": "done.png"},
        ],
        terminal_states=["done"],
        cases=[{"value": "home", "child": "handle_fail"}],
        children=["handle_fail"],
        handlers=[task("handle_fail", "test.fail")],
    )
    result = run(raw, ScreenContext("home"), actions())

    assert result.status.value == "failed"
    assert result.error is not None and "handler for state 'home'" in result.error
    assert result.error is not None and "expected failure" in result.error


def test_handler_can_read_the_classification_result() -> None:
    """「判断出来命中在哪」要能交给动作：原工作流里 `classify:out.match -> tap:match` 的数据流。

    没有这条流，处理子图就只能把模板参数抄一遍，识别与点击会各自漂移。
    """

    record = action_spec(RecordAction())
    raw = state_machine_doc(
        states=[
            {"name": "home", "template": "home.png"},
            {"name": "done", "template": "done.png"},
        ],
        terminal_states=["done"],
        cases=[{"value": "home", "child": "handle_home"}],
        children=["handle_home"],
        handlers=[
            {"id": "handle_home", "type": "sequence", "children": ["record_match", "go_done"]},
            task("record_match", "test.record", {"value": {"ref": "nodes.sm.output.match"}}),
            task("go_done", "test.set_state", {"state": "done"}),
        ],
    )
    context = ScreenContext("home")
    result = run(raw, context, registry(action_spec(SetStateAction()), record))

    assert result.status.value == "succeeded"
    assert record.action.values == [
        {"x": 10, "y": 20, "width": 30, "height": 40, "confidence": 0.99,
         "reference": [10.0, 20.0, 30.0, 40.0], "center": [25, 40],
         "template": "home.png", "threshold": 0.85}
    ]


def test_default_handler_cannot_read_the_classification_result() -> None:
    """兜底子图那一轮压根没判断成功，读观察结果只会拿到上一轮的旧值——校验层直接挡住。"""

    raw = state_machine_doc(
        states=[{"name": "done", "template": "done.png"}],
        terminal_states=["done"],
        cases=[],
        children=["fallback"],
        default_child="fallback",
        handlers=[task("fallback", "test.record", {"value": {"ref": "nodes.sm.output.state"}})],
    )
    with pytest.raises(ConfigError, match="unavailable at this execution point"):
        validate(raw, registry(action_spec(RecordAction())))


def test_state_machine_can_use_a_custom_classifier() -> None:
    """「判断当前画面」是可替换的角色：换 `state_action` 就能换一套判断实现。"""

    classifier = action_spec(
        CustomClassifier(),
        parameters={"states": ParameterDefinition.parse("states", {"type": "array", "required": True, "items": {"type": "object"}})},
        output_schema={
            "type": "object",
            "properties": {"state": {"type": "string"}},
            "required": ["state"],
            "additionalProperties": True,
        },
    )
    raw = state_machine_doc(state_action="test.classify")
    spec = validate(raw, registry(action_spec(SetStateAction()), classifier))
    node = next(item for item in spec.nodes if item.id == "sm")
    assert node.state_action == "test.classify"

    result = WorkflowEngine(spec, registry(action_spec(SetStateAction()), classifier), ScreenContext("home"), {}).run()
    assert result.status.value == "succeeded"
    assert result.output["sm"]["source"] == "stub"
    assert result.output["sm"]["state"] == "done"


def test_default_classifier_is_used_when_state_action_is_absent() -> None:
    spec = validate(state_machine_doc(), actions())
    node = next(item for item in spec.nodes if item.id == "sm")
    assert node.state_action == "vision.detect_state"


def test_validator_rejects_unknown_classifier() -> None:
    with pytest.raises(ConfigError, match="not a registered Action"):
        validate(state_machine_doc(state_action="test.missing"), actions())


def test_validator_requires_the_classifier_to_accept_declared_states() -> None:
    # `test.set_state` 存在，但它不接受 states 参数，当不了分类器。
    with pytest.raises(ConfigError, match="must accept a 'states' parameter"):
        validate(state_machine_doc(state_action="test.set_state"), actions())


def test_runtime_treats_a_spent_round_budget_as_normal_completion() -> None:
    """轮数用尽 = 正常收工（`运行轮数` 语义）；提前结束只由终止状态表达。"""

    raw = state_machine_doc(
        states=[
            {"name": "home", "template": "home.png"},
            {"name": "done", "template": "done.png"},
        ],
        terminal_states=["done"],
        cases=[{"value": "home", "child": "handle_stay"}],
        children=["handle_stay"],
        max_iterations=3,
        handlers=[task("handle_stay", "test.set_state", {"state": "home"})],
    )
    context = ScreenContext("home")
    result = run(raw, context, actions())

    assert result.status.value == "succeeded"
    assert result.output["sm"] == {
        "state": "home",
        "source": "template",
        "confidence": 0.99,
        "match": result.output["sm"]["match"],
        "iterations": 3,
        "terminal": False,
        "elapsed_seconds": result.output["sm"]["elapsed_seconds"],
    }


def test_runtime_resolves_the_round_budget_from_an_input() -> None:
    raw = state_machine_doc(
        states=[
            {"name": "home", "template": "home.png"},
            {"name": "done", "template": "done.png"},
        ],
        terminal_states=["done"],
        cases=[{"value": "home", "child": "handle_stay"}],
        children=["handle_stay"],
        max_iterations={"ref": "inputs.运行轮数"},
        handlers=[task("handle_stay", "test.set_state", {"state": "home"})],
    )
    raw["inputs"] = {"运行轮数": {"type": "integer", "default": 2}}
    context = ScreenContext("home")
    spec = validate(raw, actions())
    result = WorkflowEngine(spec, actions(), context, {"运行轮数": 2}).run()

    assert result.status.value == "succeeded"
    assert result.output["sm"]["iterations"] == 2


def test_runtime_rejects_a_non_integer_round_budget() -> None:
    raw = state_machine_doc(
        states=[{"name": "done", "template": "done.png"}],
        terminal_states=["done"],
        cases=[],
        children=[],
        handlers=[],
        max_iterations={"ref": "inputs.开关"},
    )
    raw["inputs"] = {"开关": {"type": "boolean", "default": True}}
    with pytest.raises(ConfigError, match="binding type is incompatible"):
        validate(raw, actions())


def test_runtime_resolves_state_templates_from_inputs() -> None:
    raw = state_machine_doc(
        states=[
            {"name": "home", "template": {"ref": "inputs.目标"}},
            {"name": "done", "template": "done.png"},
        ],
        terminal_states=["done"],
        cases=[{"value": "home", "child": "handle_home"}],
        children=["handle_home"],
        handlers=[task("handle_home", "test.set_state", {"state": "done"})],
    )
    raw["inputs"] = {"目标": {"type": "asset", "default": "home.png"}}
    context = ScreenContext("home")
    spec = validate(raw, actions())
    result = WorkflowEngine(spec, actions(), context, {"目标": "home.png"}).run()

    assert result.status.value == "succeeded"
    assert context.captures >= 2  # 第一轮识别 home，处理完切到 done 后再识别一次


class LoadingScreenContext(ScreenContext):
    """前 ``ready_after`` 次截图都识别不到状态（模拟页面还在加载）。"""

    def __init__(self, state: str, ready_after: int) -> None:
        super().__init__(state)
        self.ready_after = ready_after

    def find_template(self, template: str, **kwargs: Any) -> list[TemplateMatch]:
        if self.captures < self.ready_after:
            return []
        return super().find_template(template, **kwargs)


def terminal_only_doc(**overrides: Any) -> dict[str, Any]:
    return state_machine_doc(
        states=[{"name": "done", "template": "done.png"}],
        terminal_states=["done"],
        cases=[],
        children=[],
        handlers=[],
        **overrides,
    )


def test_runtime_waits_for_a_state_within_the_configured_timeout() -> None:
    context = LoadingScreenContext("done", ready_after=3)
    result = run(terminal_only_doc(state_timeout_seconds=2.0), context, actions())

    assert result.status.value == "succeeded"
    assert result.output["sm"]["state"] == "done"
    assert context.captures >= 3


def test_runtime_fails_immediately_without_a_wait_budget() -> None:
    context = LoadingScreenContext("done", ready_after=2)
    result = run(terminal_only_doc(state_timeout_seconds=0), context, actions())

    assert result.status.value == "failed"
    assert result.error_category == "not_matched"


def test_validator_rejects_a_negative_wait_budget() -> None:
    with pytest.raises(ConfigError, match="state_timeout_seconds"):
        validate(terminal_only_doc(state_timeout_seconds=-1), actions())
