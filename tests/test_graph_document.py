"""节点图 v6（`.owf`）：编译 / 反编译 / 图结构检查 / 加载链路。

图文档是「图即文档」的编辑形态，运行时不认识它——`WorkflowLoader` 在加载时把它编译成
Behavior Tree v4，所以这一组用例的重点是：**编译结果与等价的手写 v4 文档在运行语义上
完全一致**，以及图结构错误能在编译期被指出来。
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest

from src.oooonmyoji.actions import Action, ActionRegistry, ActionSpec
from src.oooonmyoji.actions.manifest import ActionDefinition
from src.oooonmyoji.exceptions import ConfigError
from src.oooonmyoji.workflows.dsl import parse_document
from src.oooonmyoji.workflows.graph_compile import compile_graph, decompile_workflow
from src.oooonmyoji.workflows.graph_schema import is_graph_document
from src.oooonmyoji.workflows.loader import WorkflowLoader
from src.oooonmyoji.workflows.validator import validate_workflow

from tests.workflow_files import write_workflow

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_FILES = ("活动副本.owf", "结界突破_寮突.owf")
GRAPH_RULES_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "graph-rules" / "cases.json"


class FixtureAction(Action):
    def execute(self, context: Any, arguments: dict[str, Any]) -> Any:
        raise AssertionError("fixture actions are never executed")


def fixture_registry(names: list[str] | None = None) -> ActionRegistry:
    registry = ActionRegistry()
    for name in names or ["test.echo"]:
        action = FixtureAction()
        action.name = name
        registry.register(
            ActionSpec(
                ActionDefinition(
                    name=name,
                    version="1.0.0",
                    entry=f"test:{name}",
                    description="",
                    parameters={},
                    output_schema={"type": "object"},
                    retry="safe",
                    side_effect=False,
                    input_schema={"type": "object"},
                ),
                action,
            )
        )
    return registry


def graph(nodes: list[dict[str, Any]], edges: list[dict[str, Any]], **extra: Any) -> dict[str, Any]:
    value: dict[str, Any] = {
        "schema_version": 6,
        "id": "graph_case",
        "version": "5.0.0",
        "resolution": [1920, 1080],
        "root": nodes[0]["id"],
        "inputs": {},
        "variables": {},
        "nodes": nodes,
        "edges": edges,
    }
    value.update(extra)
    return value


def task(node_id: str, action: str = "test.echo", *, params: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"id": node_id, "type": "task", "action": action, "params": params or {}, "at": {"x": 0, "y": 0}}


def edge(source: str, source_pin: str, target: str) -> dict[str, Any]:
    return {"from": {"node": source, "pin": source_pin}, "to": {"node": target, "pin": "in"}}


# --------------------------------------------------------------------------- 编译


def test_compile_orders_children_by_pin_index() -> None:
    document = graph(
        [
            {"id": "root", "type": "root", "at": {"x": 0, "y": 0}},
            {"id": "seq", "type": "sequence", "at": {"x": 0, "y": 100}},
            task("a"),
            task("b"),
            task("c"),
        ],
        [
            edge("root", "then.0", "seq"),
            edge("seq", "then.2", "c"),
            edge("seq", "then.0", "a"),
            edge("seq", "then.1", "b"),
        ],
    )
    compiled = compile_graph(document)
    assert compiled["schema_version"] == 4
    node_map = {node["id"]: node for node in compiled["nodes"]}
    assert node_map["seq"]["children"] == ["a", "b", "c"]
    assert node_map["root"]["children"] == ["seq"]
    # 坐标这类编辑期字段不进运行时文档。
    assert "at" not in node_map["a"]


def test_compile_condition_derives_ports_from_wired_branches() -> None:
    document = graph(
        [
            {"id": "root", "type": "root", "at": {"x": 0, "y": 0}},
            {
                "id": "judge",
                "type": "condition",
                "expression": True,
                "at": {"x": 0, "y": 100},
            },
            task("yes"),
            task("no"),
        ],
        [
            edge("root", "then.0", "judge"),
            edge("judge", "false", "no"),
            edge("judge", "true", "yes"),
        ],
    )
    compiled = compile_graph(document)
    node_map = {node["id"]: node for node in compiled["nodes"]}
    judge = node_map["judge"]
    assert judge["children"] == ["yes", "no"]
    assert judge["ports"] == ["true", "false"]

    # 只接真口：children 只有一项，ports 只写 true（老文档里缺省按 0=真 推导）。
    only_true = graph(
        [
            {"id": "root", "type": "root", "at": {"x": 0, "y": 0}},
            {"id": "judge", "type": "condition", "expression": True, "at": {"x": 0, "y": 100}},
            task("yes"),
        ],
        [edge("root", "then.0", "judge"), edge("judge", "true", "yes")],
    )
    judge = {node["id"]: node for node in compile_graph(only_true)["nodes"]}["judge"]
    assert judge["children"] == ["yes"]
    assert judge["ports"] == ["true"]


def test_compile_switch_rebuilds_cases_and_default_child() -> None:
    document = graph(
        [
            {"id": "root", "type": "root", "at": {"x": 0, "y": 0}},
            {
                "id": "route",
                "type": "switch",
                "expression": {"ref": "variables.mode"},
                "cases": [{"value": "settlement"}, {"value": "raid"}],
                "at": {"x": 0, "y": 100},
            },
            task("dismiss"),
            task("raid"),
            task("otherwise"),
        ],
        [
            edge("root", "then.0", "route"),
            edge("route", "case.1", "raid"),
            edge("route", "default", "otherwise"),
            edge("route", "case.0", "dismiss"),
        ],
    )
    node_map = {node["id"]: node for node in compile_graph(document)["nodes"]}
    route = node_map["route"]
    assert route["cases"] == [
        {"value": "settlement", "child": "dismiss"},
        {"value": "raid", "child": "raid"},
    ]
    assert route["default_child"] == "otherwise"
    assert route["children"] == ["dismiss", "raid", "otherwise"]
    assert "at" not in route


def test_compiled_graph_passes_runtime_validation() -> None:
    actions = fixture_registry()
    document = graph(
        [
            {"id": "root", "type": "root", "at": {"x": 0, "y": 0}},
            {"id": "seq", "type": "sequence", "at": {"x": 0, "y": 100}},
            task("a"),
            {
                "id": "judge",
                "type": "condition",
                "expression": True,
                "at": {"x": 0, "y": 200},
            },
            task("yes"),
        ],
        [
            edge("root", "then.0", "seq"),
            edge("seq", "then.0", "a"),
            edge("seq", "then.1", "judge"),
            edge("judge", "true", "yes"),
        ],
    )
    spec = validate_workflow(compile_graph(document), Path("graph.owf"), actions, project_root=PROJECT_ROOT)
    assert spec.root == "root"
    assert spec.schema_version == 4


# ------------------------------------------------------------------- 图结构错误


def test_compile_writes_data_edges_as_bindings() -> None:
    document = graph(
        [
            {"id": "root", "type": "root", "at": {"x": 0, "y": 0}},
            {"id": "seq", "type": "sequence", "at": {"x": 0, "y": 100}},
            task("produce"),
            {"id": "cond", "type": "condition", "at": {"x": 0, "y": 200}},
        ],
        [
            edge("root", "then.0", "seq"),
            edge("seq", "then.0", "produce"),
            edge("seq", "then.1", "cond"),
            {"from": {"node": "produce", "pin": "out.match.0.confidence"}, "to": {"node": "cond", "pin": "condition"}},
        ],
    )
    node_map = {node["id"]: node for node in compile_graph(document)["nodes"]}
    assert node_map["cond"]["expression"] == {"ref": "nodes.produce.output.match.0.confidence"}

    # 任务参数：引脚名就是参数名，嵌套路径按点号展开。
    nested = graph(
        [
            {"id": "root", "type": "root", "at": {"x": 0, "y": 0}},
            {"id": "seq", "type": "sequence", "at": {"x": 0, "y": 100}},
            task("produce"),
            task("consume", params={"states": [{"threshold": 0.5}]}),
        ],
        [
            edge("root", "then.0", "seq"),
            edge("seq", "then.0", "produce"),
            edge("seq", "then.1", "consume"),
            {"from": {"node": "produce", "pin": "out.value"}, "to": {"node": "consume", "pin": "states.0.threshold"}},
        ],
    )
    node_map = {node["id"]: node for node in compile_graph(nested)["nodes"]}
    assert node_map["consume"]["params"]["states"][0]["threshold"] == {"ref": "nodes.produce.output.value"}


def test_decompile_extracts_refs_and_keeps_unrecognised_ones_inline() -> None:
    raw = {
        "schema_version": 4,
        "id": "extract",
        "version": "4.0.0",
        "resolution": [1920, 1080],
        "root": "root",
        "inputs": {},
        "variables": {},
        "nodes": [
            {"id": "root", "type": "root", "children": ["seq"]},
            {"id": "seq", "type": "sequence", "children": ["produce", "consume", "route"]},
            task("produce"),
            {"id": "split", "type": "break", "ref": {"ref": "nodes.produce.output"}},
            {"id": "judge", "type": "bool_judge", "expression": {"eq": [{"ref": "nodes.split.output.state"}, "settlement"]}},
            {"id": "consume", "type": "task", "params": {"value": {"ref": "nodes.judge.output.value"}}},
            {
                "id": "route",
                "type": "switch",
                "expression": {"ref": "nodes.judge.output.value"},
                "cases": [{"value": "a", "child": "consume"}],
            },
        ],
    }
    document = decompile_workflow(raw)
    edges = {f"{e['from']['node']}:{e['from']['pin']}->{e['to']['node']}:{e['to']['pin']}" for e in document["edges"]}
    assert "produce:out->split:ref" in edges
    assert "split:out.state->judge:left" in edges
    assert "judge:out.value->consume:value" in edges
    assert "judge:out.value->route:expression" in edges

    node_map = {node["id"]: node for node in document["nodes"]}
    assert "ref" not in node_map["split"]
    assert node_map["judge"]["expression"] == {"eq": [None, "settlement"]}
    assert "value" not in node_map["consume"]["params"]


def test_data_edge_round_trip_is_lossless() -> None:
    """v4 → 图文档 → v4：提成边的引用要一字不差地长回原来的位置。"""

    raw = {
        "schema_version": 4,
        "id": "round",
        "version": "4.0.0",
        "resolution": [1920, 1080],
        "root": "root",
        "inputs": {},
        "variables": {},
        "nodes": [
            {"id": "root", "type": "root", "children": ["seq"]},
            {"id": "seq", "type": "sequence", "children": ["produce", "judge", "consume"]},
            {"id": "produce", "type": "task", "action": "test.echo", "params": {}},
            {
                "id": "judge",
                "type": "bool_judge",
                "expression": {"eq": [{"ref": "nodes.produce.output.value"}, {"ref": "nodes.produce.output.other"}]},
            },
            {
                "id": "consume",
                "type": "task",
                "action": "test.echo",
                "params": {"value": {"ref": "nodes.judge.output.value"}, "keep": 3},
            },
        ],
    }
    document = decompile_workflow(raw)
    # 反编译产出的是 v5 中间文档，喂给 compile_graph 前要显式提到当前版本 6。
    assert compile_graph({**document, "schema_version": 6}) == raw


def test_compile_does_not_mutate_the_graph_document() -> None:
    """编译不许改调用方手里的图文档：数据边会往载荷里写引用，浅拷会穿透过去。"""

    document = graph(
        [
            {"id": "root", "type": "root", "at": {"x": 0, "y": 0}},
            {"id": "seq", "type": "sequence", "at": {"x": 0, "y": 100}},
            task("produce"),
            {
                "id": "judge",
                "type": "bool_judge",
                "expression": {"eq": [None, "settlement"]},
                "at": {"x": 0, "y": 200},
            },
        ],
        [
            edge("root", "then.0", "seq"),
            edge("seq", "then.0", "produce"),
            edge("seq", "then.1", "judge"),
            {"from": {"node": "produce", "pin": "out.value"}, "to": {"node": "judge", "pin": "left"}},
        ],
    )
    snapshot = json.dumps(document, sort_keys=True)
    compiled = compile_graph(document)
    assert json.dumps(document, sort_keys=True) == snapshot, "编译改动了输入文档"
    judge = {node["id"]: node for node in compiled["nodes"]}["judge"]
    assert judge["expression"] == {"eq": [{"ref": "nodes.produce.output.value"}, "settlement"]}
    # 反向也一样：反编译不许改调用方手里的 v4 文档。
    v4 = {
        "schema_version": 4,
        "id": "demo",
        "version": "4.0.0",
        "resolution": [1920, 1080],
        "root": "root",
        "inputs": {},
        "variables": {},
        "nodes": [
            {"id": "root", "type": "root", "children": ["seq"]},
            {"id": "seq", "type": "sequence", "children": ["consume"]},
            {
                "id": "consume",
                "type": "task",
                "action": "test.echo",
                "params": {"value": {"ref": "nodes.judge.output.value"}},
            },
        ],
    }
    v4_snapshot = json.dumps(v4, sort_keys=True)
    decompile_workflow(v4)
    assert json.dumps(v4, sort_keys=True) == v4_snapshot, "反编译改动了输入的 v4 文档"


def test_compile_rejects_bad_data_edges() -> None:
    no_output = graph(
        [
            {"id": "root", "type": "root", "at": {"x": 0, "y": 0}},
            {"id": "seq", "type": "sequence", "at": {"x": 0, "y": 100}},
            task("a"),
        ],
        [
            edge("root", "then.0", "seq"),
            edge("seq", "then.0", "a"),
            {"from": {"node": "seq", "pin": "out.value"}, "to": {"node": "a", "pin": "value"}},
        ],
    )
    with pytest.raises(ConfigError, match="produces no output"):
        compile_graph(no_output)

    bad_target = graph(
        [
            {"id": "root", "type": "root", "at": {"x": 0, "y": 0}},
            {"id": "seq", "type": "sequence", "at": {"x": 0, "y": 100}},
            task("a"),
        ],
        [
            edge("root", "then.0", "seq"),
            edge("seq", "then.0", "a"),
            {"from": {"node": "a", "pin": "out.value"}, "to": {"node": "seq", "pin": "value"}},
        ],
    )
    with pytest.raises(ConfigError, match="is not a data pin of node seq"):
        compile_graph(bad_target)

    double = graph(
        [
            {"id": "root", "type": "root", "at": {"x": 0, "y": 0}},
            {"id": "seq", "type": "sequence", "at": {"x": 0, "y": 100}},
            task("a"),
            task("b"),
            task("consume"),
        ],
        [
            edge("root", "then.0", "seq"),
            edge("seq", "then.0", "a"),
            edge("seq", "then.1", "b"),
            edge("seq", "then.2", "consume"),
            {"from": {"node": "a", "pin": "out.value"}, "to": {"node": "consume", "pin": "value"}},
            {"from": {"node": "b", "pin": "out.value"}, "to": {"node": "consume", "pin": "value"}},
        ],
    )
    with pytest.raises(ConfigError, match="is connected twice"):
        compile_graph(double)

    unknown_pin = graph(
        [
            {"id": "root", "type": "root", "at": {"x": 0, "y": 0}},
            {"id": "seq", "type": "sequence", "at": {"x": 0, "y": 100}},
            task("a"),
        ],
        [
            edge("root", "then.0", "seq"),
            edge("seq", "then.0", "a"),
            {"from": {"node": "root", "pin": "output.value"}, "to": {"node": "a", "pin": "value"}},
        ],
    )
    with pytest.raises(ConfigError, match="starts at an unknown pin 'output.value'"):
        compile_graph(unknown_pin)


def test_compile_rejects_unknown_nodes_and_pins() -> None:
    unknown = graph([{"id": "root", "type": "root", "at": {"x": 0, "y": 0}}], [edge("root", "then.0", "ghost")])
    with pytest.raises(ConfigError, match="points at an unknown node: ghost"):
        compile_graph(unknown)

    bad_pin = graph(
        [{"id": "root", "type": "root", "at": {"x": 0, "y": 0}}, {"id": "seq", "type": "sequence", "at": {"x": 0, "y": 0}}, task("a")],
        [edge("root", "then.0", "seq"), {"from": {"node": "seq", "pin": "true"}, "to": {"node": "a", "pin": "in"}}],
    )
    with pytest.raises(ConfigError, match="has no 'true' execution pin"):
        compile_graph(bad_pin)

    bad_target_pin = graph(
        [{"id": "root", "type": "root", "at": {"x": 0, "y": 0}}, task("a")],
        [{"from": {"node": "root", "pin": "then.0"}, "to": {"node": "a", "pin": "then.0"}}],
    )
    with pytest.raises(ConfigError, match="to.pin must be 'in'"):
        compile_graph(bad_target_pin)


def test_compile_rejects_double_parent_and_double_pin() -> None:
    double_parent = graph(
        [
            {"id": "root", "type": "root", "at": {"x": 0, "y": 0}},
            {"id": "seq", "type": "sequence", "at": {"x": 0, "y": 0}},
            {"id": "other", "type": "sequence", "at": {"x": 0, "y": 0}},
            task("a"),
        ],
        [edge("root", "then.0", "seq"), edge("seq", "then.0", "a"), edge("other", "then.0", "a")],
    )
    with pytest.raises(ConfigError, match="has two execution parents"):
        compile_graph(double_parent)

    double_pin = graph(
        [
            {"id": "root", "type": "root", "at": {"x": 0, "y": 0}},
            {"id": "seq", "type": "sequence", "at": {"x": 0, "y": 0}},
            task("a"),
            task("b"),
        ],
        [edge("root", "then.0", "seq"), edge("seq", "then.0", "a"), edge("seq", "then.0", "b")],
    )
    with pytest.raises(ConfigError, match="connects pin 'then.0' twice"):
        compile_graph(double_pin)


def test_compile_rejects_cycles_and_unwired_switch_cases() -> None:
    cyclic = graph(
        [
            {"id": "root", "type": "root", "at": {"x": 0, "y": 0}},
            {"id": "seq", "type": "sequence", "at": {"x": 0, "y": 0}},
        ],
        [edge("root", "then.0", "seq"), edge("seq", "then.0", "root")],
    )
    with pytest.raises(ConfigError, match="contains a cycle"):
        compile_graph(cyclic)

    unwired_case = graph(
        [
            {"id": "root", "type": "root", "at": {"x": 0, "y": 0}},
            {
                "id": "route",
                "type": "switch",
                "expression": {"ref": "variables.mode"},
                "cases": [{"value": "a"}, {"value": "b"}],
                "at": {"x": 0, "y": 0},
            },
            task("only_a"),
        ],
        [edge("root", "then.0", "route"), edge("route", "case.0", "only_a")],
    )
    with pytest.raises(ConfigError, match="case 1 has no execution edge"):
        compile_graph(unwired_case)


# ----------------------------------------------------------------- 加载链路


def _edge_keys(document: dict[str, Any]) -> set[str]:
    return {
        f"{edge['from']['node']}:{edge['from']['pin']}->{edge['to']['node']}"
        for edge in document["edges"]
    }


@pytest.mark.parametrize("name", WORKFLOW_FILES)
def test_repo_workflows_round_trip_through_the_graph_form(name: str) -> None:
    """仓库里的工作流经过图形态来回一趟，语义零变化。

    磁盘上的 `.owf` 解析出来就是图形态（v6）；断言：图形态自身完整（有坐标、没有树结构
    残留）、编译幂等、执行结构不变。
    """

    current = parse_document((PROJECT_ROOT / "workflows" / name).read_text(encoding="utf-8"))
    assert is_graph_document(current)
    assert current["edges"], "图形态必须有执行边"
    for node in current["nodes"]:
        assert "children" not in node and "ports" not in node and "default_child" not in node
        if node.get("type") == "variable":
            # 变量节点是编辑器里的数据源：作用域与键必须有；坐标可以缺（没卡片时就地生成）。
            assert node.get("scope") in ("inputs", "variables"), node
            assert isinstance(node.get("name"), str) and node["name"], node
            continue
        assert "at" in node, f"{node['id']} 应该有坐标"

    compiled = compile_graph(current)
    again = decompile_workflow(compiled)
    assert _edge_keys(again) == _edge_keys(current), "图 → v4 → 图，执行结构必须一致"
    assert compile_graph({**again, "schema_version": 6}) == compiled, "编译必须幂等"


def test_loader_compiles_a_graph_workflow_end_to_end(tmp_path: Path) -> None:
    """图文档落盘成 `.owf` 后，`WorkflowLoader` 能一路编译到运行时快照。"""

    actions = fixture_registry()
    document = graph(
        [
            {"id": "root", "type": "root", "name": "入口", "at": {"x": 10, "y": 20}},
            {"id": "seq", "type": "sequence", "at": {"x": 10, "y": 140}},
            task("first"),
            {
                "id": "check",
                "type": "condition",
                "expression": True,
                "at": {"x": 10, "y": 260},
            },
            task("on_true"),
        ],
        [
            edge("root", "then.0", "seq"),
            edge("seq", "then.0", "first"),
            edge("seq", "then.1", "check"),
            edge("check", "true", "on_true"),
        ],
    )
    document["id"] = "graph_loaded"
    workflow_dir = tmp_path / "workflows"
    workflow_dir.mkdir()
    workflow_path = write_workflow(workflow_dir / "graph.owf", document)

    loader = WorkflowLoader(workflow_dir, actions, project_root=tmp_path)
    spec = loader.load(workflow_path.name)

    assert spec.workflow_id == "graph_loaded"
    assert spec.schema_version == 4
    node_map = {node.id: node for node in spec.nodes}
    assert node_map["seq"].children == ("first", "check")
    assert node_map["check"].children == ("on_true",)
    assert node_map["check"].ports == ("true",)
    # 编辑器旁表不进运行时快照。
    assert "_layout" not in spec.raw


def test_loader_rejects_a_malformed_graph(tmp_path: Path) -> None:
    actions = fixture_registry()
    workflow_dir = tmp_path / "workflows"
    workflow_dir.mkdir()
    # 手改过的 `.owf`：节点上残留编辑形态的 children，图文档 schema 必须挡下来。
    (workflow_dir / "bad.owf").write_text(
        "workflow bad\n"
        "  version: 6.0.0\n"
        "  resolution: [1920, 1080]\n"
        "  root: root\n"
        "  inputs: {}\n"
        "  variables: {}\n"
        "  node root root\n"
        "    at: [0, 0]\n"
        "    children: [a]\n"
        "  node a task\n"
        "    action: test.echo\n"
        "    at: [0, 100]\n"
        "  edges:\n"
        "    root -> a\n",
        encoding="utf-8",
    )

    loader = WorkflowLoader(workflow_dir, actions, project_root=tmp_path)
    with pytest.raises(ConfigError, match="children"):
        loader.load("bad.owf")


def test_custom_node_type_loads_with_real_action_manifests(tmp_path: Path) -> None:
    """自定义类型要能一路走到真实 Action 清单：基类 task + 预设参数 + 节点覆盖。"""

    from src.oooonmyoji.actions import build_action_registry

    document = graph(
        [
            {"id": "root", "type": "root", "at": {"x": 0, "y": 0}},
            {"id": "seq", "type": "sequence", "at": {"x": 0, "y": 100}},
            {
                "id": "note",
                "type": "x-note",
                "params": {"message": "节点覆盖了预设"},
                "at": {"x": 0, "y": 200},
            },
        ],
        [edge("root", "then.0", "seq"), edge("seq", "then.0", "note")],
        nodeTypes={
            "x-note": {
                "base": "task",
                "action": "core.log",
                "params": {"message": "预设的日志内容", "fields": {"from": "preset"}},
                "title": "记一笔",
            }
        },
    )
    document["id"] = "custom_loaded"
    workflow_dir = tmp_path / "workflows"
    workflow_dir.mkdir()
    workflow_path = write_workflow(workflow_dir / "custom.owf", document)

    registry = build_action_registry(PROJECT_ROOT / "plugins" / "actions")
    spec = WorkflowLoader(workflow_dir, registry, project_root=PROJECT_ROOT).load(workflow_path.name)
    node = spec.node_map["note"]
    assert node.type == "task"
    assert node.action == "core.log"
    assert node.name == "记一笔"
    assert node.params["message"] == "节点覆盖了预设"
    assert node.params["fields"] == {"from": "preset"}
    # 运行时文档里没有自定义类型的痕迹。
    assert "_nodeType" not in spec.raw["nodes"][2]
    assert "nodeTypes" not in spec.raw


def test_custom_node_type_errors() -> None:
    missing = graph(
        [
            {"id": "root", "type": "root", "at": {"x": 0, "y": 0}},
            {"id": "mystery", "type": "x-mystery", "at": {"x": 0, "y": 100}},
        ],
        [edge("root", "then.0", "mystery")],
    )
    with pytest.raises(ConfigError, match="uses unknown node type 'x-mystery'"):
        compile_graph(missing)

    bad_name = graph(
        [{"id": "root", "type": "root", "at": {"x": 0, "y": 0}}],
        [],
        nodeTypes={"note": {"base": "task", "action": "core.log"}},
    )
    with pytest.raises(ConfigError, match="must start with 'x-'"):
        compile_graph(bad_name)

    bad_base = graph(
        [{"id": "root", "type": "root", "at": {"x": 0, "y": 0}}],
        [],
        nodeTypes={"x-note": {"base": "sparkle"}},
    )
    with pytest.raises(ConfigError, match="base must be one of"):
        compile_graph(bad_base)

    structure = graph(
        [{"id": "root", "type": "root", "at": {"x": 0, "y": 0}}],
        [],
        nodeTypes={"x-note": {"base": "sequence", "children": ["hidden"]}},
    )
    with pytest.raises(ConfigError, match=r"cannot define \['children'\]"):
        compile_graph(structure)


def test_comments_are_validated_and_dropped_from_the_runtime_document() -> None:
    """注释框是编辑期标注：文档里校验，运行时产物里没有它们。"""

    document = graph(
        [
            {"id": "root", "type": "root", "at": {"x": 0, "y": 0}},
            {"id": "run", "type": "task", "action": "test.echo", "params": {}, "at": {"x": 0, "y": 100}},
        ],
        [edge("root", "then.0", "run")],
        comments=[
            {"id": "comment_1", "text": "结算页分支", "at": {"x": 1040, "y": 640}, "size": {"w": 420, "h": 260}, "tint": "warning"}
        ],
    )
    compiled = compile_graph(document)
    assert "comments" not in compiled

    duplicate = graph(
        [{"id": "root", "type": "root", "at": {"x": 0, "y": 0}}],
        [],
        comments=[{"id": "c1", "text": "a", "at": {"x": 0, "y": 0}}, {"id": "c1", "text": "b", "at": {"x": 0, "y": 0}}],
    )
    with pytest.raises(ConfigError, match="duplicates comment id: c1"):
        compile_graph(duplicate)

    bad_text = graph(
        [{"id": "root", "type": "root", "at": {"x": 0, "y": 0}}],
        [],
        comments=[{"id": "c1", "text": 3, "at": {"x": 0, "y": 0}}],
    )
    with pytest.raises(ConfigError, match="must define text as a string"):
        compile_graph(bad_text)

    bad_shape = graph(
        [{"id": "root", "type": "root", "at": {"x": 0, "y": 0}}],
        [],
        comments=[{"id": "c1", "text": "a", "at": {"x": 0, "y": 0}, "size": {"w": 120}}],
    )
    with pytest.raises(ConfigError, match="size must be integer w / h"):
        compile_graph(bad_shape)


def test_waypoints_are_validated_and_dropped_from_the_runtime_document() -> None:
    """手工折线（UE Knot）是编辑期走线：文档里校验，运行时产物里没有它们。"""

    document = graph(
        [
            {"id": "root", "type": "root", "at": {"x": 0, "y": 0}},
            {"id": "run", "type": "task", "action": "test.echo", "params": {}, "at": {"x": 0, "y": 100}},
        ],
        [
            {
                "from": {"node": "root", "pin": "then.0"},
                "to": {"node": "run", "pin": "in"},
                "waypoints": [{"x": 100, "y": 80}, {"x": 120, "y": 180}],
            }
        ],
    )
    compiled = compile_graph(document)
    assert compiled["nodes"][0].get("children") == ["run"]
    assert "waypoints" not in json.dumps(compiled), "折点不该进运行时文档"
    assert "edges" not in compiled

    # 坐标必须是整数（schema 兜底），另外再挡一次不合法形状。
    invalid = graph(
        [
            {"id": "root", "type": "root", "at": {"x": 0, "y": 0}},
            {"id": "run", "type": "task", "action": "test.echo", "params": {}, "at": {"x": 0, "y": 100}},
        ],
        [{"from": {"node": "root", "pin": "then.0"}, "to": {"node": "run", "pin": "in"}, "waypoints": [{"x": 1}]}],
    )
    with pytest.raises(ConfigError, match="waypoints"):
        from src.oooonmyoji.config.loader import _validate_json_schema

        from src.oooonmyoji.workflows.graph_schema import GRAPH_SCHEMA

        _validate_json_schema(invalid, GRAPH_SCHEMA, "workflow graph invalid.owf")


def test_groups_are_validated_and_dropped_from_the_runtime_document() -> None:
    """节点组同理：文档里自洽（成员/端点/坐标），运行时产物里没有它们。"""

    document = graph(
        [
            {"id": "root", "type": "root", "at": {"x": 0, "y": 0}},
            {"id": "seq", "type": "sequence", "at": {"x": 0, "y": 100}},
            {"id": "a", "type": "task", "action": "test.echo", "params": {}, "at": {"x": 0, "y": 200}},
        ],
        [edge("root", "then.0", "seq"), edge("seq", "then.0", "a")],
        groups=[{"id": "g1", "name": "组", "nodeIds": ["a"], "pins": [], "pinPolicy": "explicit-v1", "at": {"x": 100, "y": 200}}],
    )
    compiled = compile_graph(document)
    assert "groups" not in compiled

    outside = graph(
        [
            {"id": "root", "type": "root", "at": {"x": 0, "y": 0}},
            {"id": "a", "type": "task", "action": "test.echo", "params": {}, "at": {"x": 0, "y": 100}},
            {"id": "b", "type": "task", "action": "test.echo", "params": {}, "at": {"x": 0, "y": 200}},
        ],
        [],
        groups=[{"id": "g1", "nodeIds": ["a"], "pins": [{"nodeId": "b", "param": "value"}]}],
    )
    with pytest.raises(ConfigError, match="points outside the group: b"):
        compile_graph(outside)

    empty = graph(
        [{"id": "root", "type": "root", "at": {"x": 0, "y": 0}}],
        [],
        groups=[{"id": "g1", "nodeIds": []}],
    )
    with pytest.raises(ConfigError, match="must list at least one member node"):
        compile_graph(empty)


@pytest.mark.parametrize("name", WORKFLOW_FILES)
def test_migrated_workflow_loads_with_real_action_manifests(name: str, tmp_path: Path) -> None:
    """迁移成 `.owf`（v6）之后，两份真实工作流仍能用真实 Action 清单加载并通过运行时校验。"""

    from src.oooonmyoji.actions import build_action_registry

    document = parse_document((PROJECT_ROOT / "workflows" / name).read_text(encoding="utf-8"))
    workflow_dir = tmp_path / "workflows"
    workflow_dir.mkdir()
    write_workflow(workflow_dir / name, document)

    registry = build_action_registry(PROJECT_ROOT / "plugins" / "actions")
    loader = WorkflowLoader(workflow_dir, registry, project_root=PROJECT_ROOT)
    spec = loader.load(name)

    assert spec.schema_version == 4, "运行时快照始终是编译后的 v4"
    runtime_nodes = [node for node in document["nodes"] if node.get("type") != "variable"]
    assert len(spec.nodes) == len(runtime_nodes), "变量节点不该进运行时文档"
    assert {node.id for node in spec.nodes} == {str(node["id"]) for node in runtime_nodes}
    # 编译产物里没有图结构残留，也没有编辑器旁表（变量卡/变量连线已经变成变量节点 + 边）。
    assert "edges" not in spec.raw
    assert not any("at" in node for node in spec.raw["nodes"])
    assert not any(key.startswith("_") for key in spec.raw)
    assert not any(node.get("type") == "variable" for node in spec.raw["nodes"])
    assert loader.validate_paths(spec) is None


# --------------------------------------------------------- 跨语言契约（与桌面端共用）


def _graph_cases() -> list[dict[str, Any]]:
    return json.loads(GRAPH_RULES_FIXTURE.read_text(encoding="utf-8"))["cases"]


def _graph_registry(actions: dict[str, Any]) -> ActionRegistry:
    """按共享样例里的 Action 契约搭一个注册表，让编译结果能过完整的运行时校验。"""

    registry = ActionRegistry()
    for name, definition in actions.items():
        action = FixtureAction()
        action.name = name
        registry.register(
            ActionSpec(
                ActionDefinition(
                    name=name,
                    version="1.0.0",
                    entry=f"test:{name}",
                    description="",
                    parameters={},
                    output_schema=definition["output_schema"],
                    retry="safe" if definition.get("retry_safe") else "unsafe",
                    side_effect=not definition.get("retry_safe"),
                    input_schema=definition["input_schema"],
                ),
                action,
            )
        )
    return registry


@pytest.mark.parametrize("case", _graph_cases(), ids=[case["name"] for case in _graph_cases()])
def test_python_matches_shared_graph_rules(case: dict[str, Any]) -> None:
    """同一份 `tests/fixtures/graph-rules/cases.json` 桌面端也读：两端必须转出同样的结果。"""

    if case["valid"]:
        compiled = compile_graph(case["graph"])
        node_map = {node["id"]: node for node in compiled["nodes"]}
        for node_id, expected in case.get("expect_nodes", {}).items():
            node = node_map[node_id]
            for key, value in expected.items():
                assert node.get(key, []) == value, f"{node_id}.{key}"
        for node_id, expected in case.get("expect_bindings", {}).items():
            node = node_map[node_id]
            for key, value in expected.items():
                assert node.get(key) == value, f"{node_id}.{key}"
        layout = compiled.get("_layout", {})
        assert not layout, "编译产物是运行时文档，不该带编辑器坐标"
        # 编译结果必须是运行时真的能跑的文档：桌面端那条用例同样会跑一次校验。
        spec = validate_workflow(
            compiled,
            Path("graph.owf"),
            _graph_registry(json.loads(GRAPH_RULES_FIXTURE.read_text(encoding="utf-8"))["actions"]),
            project_root=PROJECT_ROOT,
        )
        assert spec.root == case["graph"]["root"]
        return

    with pytest.raises(ConfigError) as error:
        compile_graph(case["graph"])
    expected = case.get("python_error")
    if expected:
        assert re.search(expected, str(error.value)), str(error.value)
