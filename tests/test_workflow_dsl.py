"""工作流文本格式 v6（``.owf``）：解析、序列化、规范化与既有文档的往返。

这一组用例盯的是三条不变量：

1. ``parse(emit(doc)) == normalize_document(doc)``（语义无损，键序保留）；
2. ``emit(parse(text)) == text``（规范文本是不动点）；
3. ``compile_graph(doc) == compile_graph(parse(emit(doc)))``（运行时执行语义一字不差）。

真实样本用仓库里两份工作流与 Python / 桌面端共用的 ``graph-rules/cases.json`` 契约，
全特性形状用 ``fixtures/dsl/kitchen.owf``。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from src.oooonmyoji.exceptions import ConfigError
from src.oooonmyoji.workflows.dsl import (
    DslError,
    emit_document,
    normalize_document,
    parse_document,
    parse_expression,
    render_expression,
)
from src.oooonmyoji.workflows.graph_compile import compile_graph

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_FILES = ("活动副本.owf", "结界突破_寮突.owf")
GRAPH_RULES_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "graph-rules" / "cases.json"
KITCHEN_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "dsl" / "kitchen.owf"

CASES: list[dict[str, Any]] = json.loads(GRAPH_RULES_FIXTURE.read_text(encoding="utf-8"))["cases"]


def first_difference(left: Any, right: Any, path: str = "doc") -> str | None:
    """第一处不同，带路径；完全一致返回 None。"""

    if type(left) is not type(right):
        return f"{path}: 类型不同 {type(left).__name__} vs {type(right).__name__}"
    if isinstance(left, dict):
        for key in [*left, *(key for key in right if key not in left)]:
            if key not in left:
                return f"{path}.{key}: 只在解析结果里有"
            if key not in right:
                return f"{path}.{key}: 只在原文里有"
            found = first_difference(left[key], right[key], f"{path}.{key}")
            if found:
                return found
        return None
    if isinstance(left, list):
        if len(left) != len(right):
            return f"{path}: 长度不同 {len(left)} vs {len(right)}"
        for index, (a, b) in enumerate(zip(left, right)):
            found = first_difference(a, b, f"{path}[{index}]")
            if found:
                return found
        return None
    if left != right:
        return f"{path}: {left!r} != {right!r}"
    return None


def runtime_view(document: dict[str, Any]) -> Any:
    """编译成运行时文档。"""

    return compile_graph(document)


def compile_error(document: dict[str, Any]) -> str:
    with pytest.raises(ConfigError) as info:
        runtime_view(document)
    return f"{type(info.value).__name__}: {info.value}"


# --------------------------------------------------------------------------------------
# 真实文档往返
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize("name", WORKFLOW_FILES)
def test_real_workflow_is_canonical_and_compiles(name: str) -> None:
    text = (PROJECT_ROOT / "workflows" / name).read_text(encoding="utf-8")
    document = parse_document(text, path=name)

    assert emit_document(document) == text, "仓库里的 .owf 必须已经是规范形式"
    compiled = runtime_view(document)
    assert compiled["schema_version"] == 4
    # 变量节点只活在编辑器里，编译后不进运行时文档
    assert len(compiled["nodes"]) == len([node for node in document["nodes"] if node["type"] != "variable"])


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_contract_fixture_case_round_trip(case: dict[str, Any]) -> None:
    graph = case["graph"]
    try:
        text = emit_document(graph)
    except DslError as error:
        # 写不出来只允许发生在**本来就判定为非法**的文档上（缺 scope/name 的变量节点、
        # 悬空边……），文本形式给不出这些文档的自洽写法。
        assert not case["valid"], f"合法文档必须能写盘：{error.message}"
        return

    parsed = parse_document(text, path=f"{case['name']}.owf")
    assert first_difference(parsed, normalize_document(graph)) is None
    assert emit_document(parsed) == text

    if case["valid"]:
        assert runtime_view(parsed) == runtime_view(graph)
    else:
        # 边表是忠实转写：连 edges[i] 的报错下标都不会漂
        assert compile_error(parsed) == compile_error(graph)


def test_only_invalid_fixture_cases_are_unwritable() -> None:
    unwritable = []
    for case in CASES:
        try:
            emit_document(case["graph"])
        except DslError:
            unwritable.append(case["name"])
    assert len(unwritable) == 3, unwritable


# --------------------------------------------------------------------------------------
# 全特性夹具
# --------------------------------------------------------------------------------------


def test_kitchen_fixture_is_canonical() -> None:
    text = KITCHEN_FIXTURE.read_text(encoding="utf-8")
    document = parse_document(text, path="kitchen.owf")

    assert emit_document(document) == text
    assert document["schema_version"] == 6
    assert document["description"] == "多行说明：\n第二行"
    assert document["limits"] == {"timeout_seconds": 600, "max_steps": 500}
    assert document["_inputParams"] == {}


def test_kitchen_fixture_structures() -> None:
    document = parse_document(KITCHEN_FIXTURE.read_text(encoding="utf-8"))
    nodes = {node["id"]: node for node in document["nodes"]}

    # 变量节点的 id 由作用域与键派生，文本里不写 id
    assert nodes["var__inputs__运行轮数"]["scope"] == "inputs"
    assert nodes["var__inputs__运行轮数"]["name"] == "运行轮数"
    assert nodes["var__inputs__运行轮数"]["at"] == {"x": -200, "y": 100}

    # 位置 / 尺寸：行内 [x, y] ⇄ {"x": …, "y": …}
    assert nodes["root"]["at"] == {"x": 0, "y": 0}
    assert document["comments"][0]["size"] == {"w": 420, "h": 260}
    assert document["groups"][0]["variablesAt"] == {"x": -448, "y": 376}

    # 装饰器、cases、runs 与载荷字段名保持运行时原样
    assert nodes["rounds"]["decorators"] == [{"type": "repeat", "count": 3}]
    assert nodes["pick"]["cases"] == [{"value": "settlement"}, {"value": 2}]
    assert nodes["fleet"]["runs"] == [{"instance": "mumu-0", "workflow": "demo", "inputs": {"运行轮数": 2}}]
    assert nodes["fleet"]["fields"] == {"state": "状态"}
    assert nodes["fleet"]["wait_for"] == "any"
    assert nodes["fleet"]["finish_mode"] == "wait_for_background"
    assert nodes["fleet"]["cancel_on_failure"] is False

    # 中缀表达式落到运行时的操作数对象上
    assert nodes["judge"]["expression"] == {"eq": [None, "settlement"]}
    assert nodes["pick"]["expression"] == {"ref": "nodes.judge.output.value"}
    assert nodes["branch_1"]["conditions"] == [
        {"and": [{"eq": [{"ref": "nodes.judge.output.value"}, True]}, {"not": {"exists": {"ref": "inputs.运行轮数"}}}]}
    ]

    # 连线：源节点块内的 -&gt; 行，默认口位省略
    edges = {(edge["from"]["node"], edge["from"]["pin"]): edge for edge in document["edges"]}
    assert edges[("root", "then.0")]["to"] == {"node": "rounds", "pin": "in"}
    assert edges[("judge", "out.value")]["waypoints"] == [{"x": 100, "y": 80}, {"x": 120, "y": 180}]
    assert edges[("pick", "default")]["to"] == {"node": "fleet", "pin": "in"}
    assert edges[("var__inputs__运行轮数", "out")]["to"] == {"node": "rounds", "pin": "decorators.0.count"}


def test_edges_table_is_emitted_in_document_order() -> None:
    """边表是忠实转写：顺序按文档来，读起来与 `edges` 数组一一对应。"""

    document = parse_document(KITCHEN_FIXTURE.read_text(encoding="utf-8"))
    text = emit_document(document)
    table = text.split("  edges:\n", 1)[1].split("  group ", 1)[0]
    lines = [line.strip() for line in table.splitlines() if line.strip() and not line.strip().startswith("waypoints:")]
    assert lines[:4] == ["root -> rounds", "rounds -> branch_1", "rounds:then.1 -> pick", "rounds:then.2 -> judge"]
    assert lines[-2:] == ["var__inputs__运行轮数:out -> rounds:decorators.0.count", "judge:out.value -> branch_1:conditions.0"]
    assert "waypoints: [[100, 80], [120, 180]]" in table
    assert [edge["from"]["node"] for edge in document["edges"]][:2] == ["root", "rounds"]


# --------------------------------------------------------------------------------------
# 表达式
# --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("a == b", {"eq": ["a", "b"]}),
        ("a != 1", {"ne": ["a", 1]}),
        ("a > 1.5", {"gt": ["a", 1.5]}),
        ("a >= true", {"gte": ["a", True]}),
        ("a < null", {"lt": ["a", None]}),
        ("a <= b", {"lte": ["a", "b"]}),
        ("a contains b", {"contains": ["a", "b"]}),
        ("exists nodes.a.output.b", {"exists": {"ref": "nodes.a.output.b"}}),
        ("not a", {"not": "a"}),
        ("not not a", {"not": {"not": "a"}}),
        ("a and b and c", {"and": ["a", "b", "c"]}),
        ("a or b", {"or": ["a", "b"]}),
        ("a and b or c", {"or": [{"and": ["a", "b"]}, "c"]}),
        ("a or b and c", {"or": ["a", {"and": ["b", "c"]}]}),
        ("(a or b) and c", {"and": [{"or": ["a", "b"]}, "c"]}),
        ("not (a and b)", {"not": {"and": ["a", "b"]}}),
        ("nodes.a.output.x == inputs.运行轮数", {"eq": [{"ref": "nodes.a.output.x"}, {"ref": "inputs.运行轮数"}]}),
        ("true", True),
        ("nodes.a.output.value", {"ref": "nodes.a.output.value"}),
        ('"and" == x', {"eq": ["and", "x"]}),
    ],
)
def test_expression_parsing(text: str, expected: Any) -> None:
    from src.oooonmyoji.workflows.dsl.errors import SourceLine

    assert parse_expression(text, SourceLine("case.owf", 1, text)) == expected


@pytest.mark.parametrize(
    ("node", "expected"),
    [
        ({"eq": [None, "settlement"]}, "null == settlement"),
        ({"and": [{"eq": [{"ref": "nodes.a.output.x"}, 1]}, {"not": {"exists": {"ref": "inputs.运行轮数"}}}]}, "nodes.a.output.x == 1 and not exists inputs.运行轮数"),
        ({"or": [{"and": ["a", "b"]}, "c"]}, "a and b or c"),
        ({"and": [{"or": ["a", "b"]}, "c"]}, "(a or b) and c"),
        ({"contains": [{"ref": "nodes.a.output.list"}, "x"]}, "nodes.a.output.list contains x"),
        (True, "true"),
        ({"ref": "nodes.a.output.value"}, "nodes.a.output.value"),
        ({"and": ["a"]}, None),
        ({"wat": [1, 2]}, None),
        ({"eq": [1, 2, 3]}, None),
    ],
)
def test_expression_rendering(node: Any, expected: str | None) -> None:
    assert render_expression(node) == expected


def test_expression_round_trip() -> None:
    """中缀渲染出来的文本必须解析回同一棵树（扁平化是唯一的规范化）。"""

    from src.oooonmyoji.workflows.dsl.errors import SourceLine

    nodes = [
        {"eq": [{"ref": "nodes.a.output.x"}, "y"]},
        {"and": [True, {"or": ["a", {"not": {"exists": {"ref": "inputs.k"}}}]}]},
        {"contains": [{"ref": "variables.v"}, 3]},
        {"not": {"and": ["a", "b"]}},
    ]
    for node in nodes:
        text = render_expression(node)
        assert text is not None
        assert parse_expression(text, SourceLine("case.owf", 1, text)) == node


@pytest.mark.parametrize(
    ("text", "fragment"),
    [
        ("a < b < c", "链式比较"),
        ("exists a + b", "引用"),
        ("a = b", "=="),
        ("a ==", "没有写完"),
        ("a b", "多余的内容"),
        ("(a and b", "括号"),
        ("a and", "没有写完"),
    ],
)
def test_expression_errors(text: str, fragment: str) -> None:
    from src.oooonmyoji.workflows.dsl.errors import SourceLine

    with pytest.raises(DslError) as info:
        parse_expression(text, SourceLine("case.owf", 7, text))
    assert fragment in info.value.message
    assert info.value.line == 7


def test_expression_block_fallback_is_accepted() -> None:
    """中缀表达不了的形状用子块写（逃生舱），解析成同一棵树。"""

    document = parse_document(
        "workflow demo\n"
        "  version: 1.0.0\n"
        "  resolution: [1920, 1080]\n"
        "  root: root\n"
        "  node root root\n"
        "  node judge bool_judge\n"
        "    expression:\n"
        "      wat:\n"
        "        - 1\n"
        "        - two\n"
        "  edges:\n"
        "    root -> judge\n"
    )
    node = next(item for item in document["nodes"] if item["id"] == "judge")
    assert node["expression"] == {"wat": [1, "two"]}
    # 写盘时无从渲染，只能原样写成块
    assert "wat:" in emit_document(document)


# --------------------------------------------------------------------------------------
# 词法与结构
# --------------------------------------------------------------------------------------


def minimal_document() -> dict[str, Any]:
    return {
        "schema_version": 6,
        "id": "demo",
        "version": "1.0.0",
        "description": "demo",
        "resolution": [1920, 1080],
        "root": "root",
        "inputs": {},
        "variables": {},
        "nodes": [
            {"id": "root", "type": "root", "at": {"x": 0, "y": 0}},
            {
                "id": "tap_1",
                "type": "task",
                "name": "tap",
                "at": {"x": 0, "y": 200},
                "action": "input.tap",
                "params": {"x": 10, "y": 20, "random_interval": [0.2, 0.5], "note": "3 seconds"},
                "decorators": [],
            },
        ],
        "edges": [{"from": {"node": "root", "pin": "then.0"}, "to": {"node": "tap_1", "pin": "in"}}],
    }


MINIMAL_TEXT = (
    "workflow demo\n"
    "  version: 1.0.0\n"
    "  description: demo\n"
    "  resolution: [1920, 1080]\n"
    "  root: root\n"
    "  inputs: {}\n"
    "  variables: {}\n"
    "  node root root\n"
    "    at: [0, 0]\n"
    "  node tap_1 task tap\n"
    "    at: [0, 200]\n"
    "    action: input.tap\n"
    "    params:\n"
    "      x: 10\n"
    "      y: 20\n"
    "      random_interval: [0.2, 0.5]\n"
    '      note: "3 seconds"\n'
    "    decorators: []\n"
    "  edges:\n"
    "    root -> tap_1\n"
)


def test_canonical_text() -> None:
    assert emit_document(minimal_document()) == MINIMAL_TEXT
    assert parse_document(MINIMAL_TEXT) == normalize_document(minimal_document())


def test_comments_blank_lines_and_indentation() -> None:
    text = (
        "# 文件头注释\n"
        "workflow demo\n"
        "  version: 1.0.0   # 行尾注释\n"
        "\n"
        "  resolution: [1920, 1080]\n"
        "  root: root\n"
        "  node root root\n"
        "    # 节点里的注释\n"
        "    at: [0, 0]\n"
        "  edges:\n"
        "    root -> tap_1\n"
    )
    document = parse_document(text)
    assert document["version"] == "1.0.0"
    assert document["resolution"] == [1920, 1080]
    assert document["edges"][0]["to"]["node"] == "tap_1"


def test_wires_belong_to_the_edges_table() -> None:
    """连线写在节点块里要给出明确指引，而不是被当成未知字段吞掉。"""

    with pytest.raises(DslError) as info:
        parse_document("workflow demo\n  version: 1.0.0\n  resolution: [1920, 1080]\n  root: root\n  node root root\n    -> tap_1\n")
    assert "顶层 edges 块" in info.value.message
    assert info.value.line == 6


@pytest.mark.parametrize(
    ("text", "fragment", "line"),
    [
        ("version: 1.0.0\n", "第一行必须写成 workflow", 1),
        ("workflow demo\n  version: 1.0.0\n  resolution: [1920, 1080]\n", "缺少 root", None),
        ("workflow demo\n  version: 1.0.0\n  root: root\n", "缺少 resolution", None),
        ("workflow demo\n  resolution: [1920, 1080]\n  root: root\n", "缺少 version", None),
        ("workflow demo\n  version: 1.0.0\n  resolution: [1920, 1080]\n  root: root\n  node a task\n      at: [0, 0]\n", "缩进跳级", 6),
        ("workflow demo\n  version: 1.0.0\n  resolution: [1920, 1080]\n  root: root\n  version: 2.0.0\n", "顶层键重复", 5),
        ("workflow demo\n  version 1.0.0\n", "缺少 :", 2),
        ("workflow demo\n\tversion: 1.0.0\n", "Tab", 2),
        ("workflow demo\n  version: 1.0.0\n  resolution: [1920, 1080]\n  root: root\n  node a task\n    x: 1\n    x: 2\n", "键重复", 7),
    ],
)
def test_parse_errors_carry_line_numbers(text: str, fragment: str, line: int | None) -> None:
    with pytest.raises(DslError) as info:
        parse_document(text, path="demo.owf")
    assert fragment in info.value.message
    if line is not None:
        assert info.value.line == line
    assert "demo.owf" in info.value.render()


def test_multiline_text_block() -> None:
    document = parse_document(
        "workflow demo\n"
        "  version: 1.0.0\n"
        "  resolution: [1920, 1080]\n"
        "  root: root\n"
        "  description: |\n"
        "    第一行\n"
        "      缩进保留\n"
        "    第三行\n"
    )
    assert document["description"] == "第一行\n  缩进保留\n第三行"
    assert parse_document(emit_document(document))["description"] == document["description"]


def test_strings_that_look_like_other_values() -> None:
    document = parse_document(
        "workflow demo\n"
        "  version: 1.0.0\n"
        "  resolution: [1920, 1080]\n"
        "  root: root\n"
        "  variables:\n"
        '    "inputs.假的":\n'
        '      type: string\n'
        '      default: "inputs.真引用会被解析成引用，所以这里必须加引号"\n'
        "      display_name: \"3\"\n"
    )
    variable = document["variables"]["inputs.假的"]
    assert variable["default"] == "inputs.真引用会被解析成引用，所以这里必须加引号"
    assert variable["display_name"] == "3"
    assert emit_document(document).count('"3"') == 1


def test_emit_refuses_shapes_it_cannot_write() -> None:
    edit_form = {
        "schema_version": 4,
        "id": "demo",
        "version": "1.0.0",
        "resolution": [1920, 1080],
        "root": "root",
        "inputs": {},
        "variables": {},
        "nodes": [
            {"id": "root", "type": "root", "children": ["a"]},
            {"id": "a", "type": "sequence"},
        ],
    }
    with pytest.raises(DslError) as info:
        emit_document(edit_form)
    assert "编辑形态" in info.value.message

    bad_variable = minimal_document()
    bad_variable["nodes"].append({"id": "var__inputs__别的", "type": "variable", "scope": "inputs", "name": "模板"})
    with pytest.raises(DslError) as info:
        emit_document(bad_variable)
    assert "派生 id" in info.value.message

    dangling = minimal_document()
    dangling["edges"].append({"from": {"node": "tap_1", "pin": "out"}, "to": {"node": "ghost", "pin": "in"}})
    with pytest.raises(DslError) as info:
        emit_document(dangling)
    assert "不存在的节点" in info.value.message


def test_then_alias_is_normalized() -> None:
    document = minimal_document()
    document["edges"][0]["from"]["pin"] = "then"
    normalized = normalize_document(document)
    assert normalized["edges"][0]["from"]["pin"] == "then.0"
    assert parse_document(emit_document(document))["edges"][0]["from"]["pin"] == "then.0"


# --------------------------------------------------------------------------------------
# 回归：移植到 TypeScript 时发现的缺陷
# --------------------------------------------------------------------------------------


def test_extreme_floats_round_trip_exactly() -> None:
    """很小的浮点必须原样写回去（早先 `%.17f` 会把 1e-20 写成 0.0，是静默丢数据）。"""

    document = minimal_document()
    task = next(node for node in document["nodes"] if node["id"] == "tap_1")
    task["params"]["tiny"] = 1e-20
    task["params"]["micro"] = 1.2345678901234567e-05
    task["params"]["huge"] = 1e20
    task["params"]["plain"] = 0.5

    text = emit_document(document)
    assert "1e-20" in text and "1e+20" in text
    parsed = parse_document(text)
    params = next(node for node in parsed["nodes"] if node["id"] == "tap_1")["params"]
    assert params["tiny"] == 1e-20
    assert params["micro"] == 1.2345678901234567e-05
    assert params["huge"] == 1e20
    assert params["plain"] == 0.5
    assert first_difference(parsed, normalize_document(document)) is None


def test_expression_list_requires_closing_bracket() -> None:
    with pytest.raises(DslError) as info:
        parse_document(
            "workflow demo\n"
            "  version: 1.0.0\n"
            "  resolution: [1920, 1080]\n"
            "  root: root\n"
            "  node branch_1 branch\n"
            "    conditions: [a == 1, b == 2\n"
        )
    assert "缺少右括号" in info.value.message


def test_duplicate_top_level_keys_are_rejected() -> None:
    duplicate = (
        "workflow demo\n"
        "  version: 1.0.0\n"
        "  resolution: [1920, 1080]\n"
        "  root: root\n"
        "  inputs:\n"
        "    a:\n"
        "      type: integer\n"
        "  inputs:\n"
        "    b:\n"
        "      type: integer\n"
    )
    with pytest.raises(DslError) as info:
        parse_document(duplicate)
    assert "顶层键重复" in info.value.message
    assert info.value.line == 8

    with pytest.raises(DslError) as info:
        parse_document("workflow demo\n  version: 1.0.0\n  resolution: [1920, 1080]\n  root: root\n  schema_version: 6\n")
    assert "schema_version" in info.value.message


def test_node_id_with_colon_round_trips() -> None:
    """节点 id 里含 `:` 时 emit 会加引号，解析必须认得出（否则文件写出去读不回来）。"""

    document = minimal_document()
    document["nodes"][1]["id"] = "tap:1"
    document["edges"][0]["to"]["node"] = "tap:1"

    text = emit_document(document)
    assert 'node "tap:1" task' in text
    assert "edges:" in text and '"tap:1"' in text
    assert first_difference(parse_document(text), normalize_document(document)) is None


def test_non_object_inputs_are_normalized_like_emit() -> None:
    """`inputs: []` 这类非法形状：规范化要与 `emit` 的 `{}` 一致，否则往返不变量失效。"""

    document = minimal_document()
    document["inputs"] = []
    document["variables"] = None

    normalized = normalize_document(document)
    assert normalized["inputs"] == {}
    assert normalized["variables"] == {}
    assert first_difference(parse_document(emit_document(document)), normalized) is None
