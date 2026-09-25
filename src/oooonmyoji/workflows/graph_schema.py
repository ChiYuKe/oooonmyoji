"""节点图文档的结构 Schema（JSON Schema 2020-12）。

图文档**只活在内存里**：磁盘上写的是 `.owf` 文本（`docs/workflow-dsl-v6.md`），
`workflows/dsl/document.py` 解析出来的 dict 与这里描述的形状同形，版本号也是这里定的。

相对 v4（Behavior Tree 的序列化）只换「结构」那部分，运行时载荷（`action` / `params` /
`expression` / `decorators` / `runs` / `cases[].value` …）保持同名同形：

- 执行顺序从 `nodes[].children`（有序树）变成顶层 `edges`（显式边表）；
- 坐标从编辑器旁表 `_layout` 搬进节点自身的 `at`；
- `condition` 的口位从 `nodes[].ports` 派生自边（`true` / `false` 引脚）；
- `switch` 的分支从 `cases[].child` / `default_child` 变成 `case.<下标>` / `default` 边。
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from .schema import WORKFLOW_SCHEMA

#: 图文档的 schema 版本。v4 是运行时形态（内存里的编辑/执行形态），
#: v5 是曾经的 JSON 落盘格式，已由 `.owf` 文本（v6）取代。
GRAPH_SCHEMA_VERSION = 6

#: 执行流引脚：来源侧的出口。
EXEC_OUT_PIN = "then"
#: 执行流引脚：目标侧的入口（每个执行节点只有一个）。
EXEC_IN_PIN = "in"
#: 判断节点的两个分支口。
CONDITION_PINS = ("true", "false")

#: 变量节点：图里的「变量/输入」数据源（编辑器里的变量卡，运行时没有对应节点）。
VARIABLE_NODE_TYPE = "variable"
#: 变量节点能代表的两个作用域。
VARIABLE_SCOPES = ("inputs", "variables")

#: 引脚名到「这是不是执行流出口」的判定：`then` / `then.<下标>` / `true` / `false` /
#: `case.<下标>` / `default`。
_EXEC_OUT_LITERALS = frozenset({EXEC_OUT_PIN, *CONDITION_PINS, "default"})

BINDING_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["node", "pin"],
    "properties": {
        "node": {"type": "string", "minLength": 1},
        "pin": {"type": "string", "minLength": 1},
    },
    "additionalProperties": False,
}


def is_exec_out_pin(pin: str) -> bool:
    """这个引脚是不是执行流出口。"""

    if pin in _EXEC_OUT_LITERALS:
        return True
    head, _, tail = pin.partition(".")
    return head in {"then", "case"} and bool(tail)


def exec_out_index(pin: str) -> int:
    """执行流出口的顺序下标：`then` = `then.0`，`then.3` = 3，`case.2` = 2。"""

    head, _, tail = pin.partition(".")
    if not tail:
        return 0
    if not tail.isdigit():
        raise ValueError(f"exec pin index must be a number: {pin}")
    return int(tail)


def _node_items() -> dict[str, Any]:
    """图文档的节点定义：沿用 v4 的载荷字段，去掉树结构字段、加上坐标。"""

    items = deepcopy(WORKFLOW_SCHEMA["properties"]["nodes"]["items"])
    properties: dict[str, Any] = items["properties"]
    # 节点类型不再是封闭枚举：内置 13 种之外还可以是 `nodeTypes` 里声明的 `x-…`
    # 自定义类型（解析与报错在 `graph_types.resolve_node`，那里能指名道姓）。
    properties["type"] = {"type": "string", "minLength": 1}
    properties.pop("children", None)
    properties.pop("ports", None)
    # `default_child` 与 `cases[].child` 都是「藏在字段里的连接」，v5 改由 `default` /
    # `case.<下标>` 边表达，节点上不再允许出现。
    properties.pop("default_child", None)
    # 变量节点（编辑器里的变量卡）用它标明代表哪个作用域的哪个键。
    properties["scope"] = {"enum": list(VARIABLE_SCOPES)}
    properties["at"] = {
        "type": "object",
        "required": ["x", "y"],
        "properties": {"x": {"type": "integer"}, "y": {"type": "integer"}},
        "additionalProperties": False,
    }
    properties["size"] = {
        "type": "object",
        "required": ["w", "h"],
        "properties": {"w": {"type": "integer", "minimum": 1}, "h": {"type": "integer", "minimum": 1}},
        "additionalProperties": False,
    }
    properties["locked"] = {"type": "boolean"}
    properties["comment"] = {"type": "string"}
    # switch 的分支目标改由 `case.<下标>` / `default` 边表达，节点上只留分支取值。
    cases = properties.get("cases")
    if isinstance(cases, dict):
        case_items = cases.get("items")
        if isinstance(case_items, dict):
            case_properties = case_items.get("properties")
            if isinstance(case_properties, dict):
                case_properties.pop("child", None)
            case_items["required"] = ["value"]
    return items


def _graph_schema() -> dict[str, Any]:
    schema = deepcopy(WORKFLOW_SCHEMA)
    properties: dict[str, Any] = schema["properties"]
    properties["schema_version"] = {"const": GRAPH_SCHEMA_VERSION}
    properties["nodes"] = {
        "type": "array",
        "minItems": 2,
        "items": _node_items(),
    }
    # 自定义节点类型的定义表（可选）：`x-…` → 内置基类 + 预设载荷 + 显示信息。
    # 逐字段校验在 `graph_types.node_type_definitions`，那里能给出指名的报错。
    properties["nodeTypes"] = {"type": "object"}
    # 节点组（可选）：编辑器里的分组投影 + 组接口，运行时不认识它们。
    position = {
        "type": "object",
        "required": ["x", "y"],
        "properties": {"x": {"type": "integer"}, "y": {"type": "integer"}},
        "additionalProperties": False,
    }
    properties["groups"] = {
        "type": "array",
        "items": {
            "type": "object",
            "required": ["id", "nodeIds"],
            "properties": {
                "id": {"type": "string", "minLength": 1},
                "name": {"type": "string"},
                "nodeIds": {
                    "type": "array",
                    "items": {"type": "string", "minLength": 1},
                    "uniqueItems": True,
                },
                "pins": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["nodeId", "param"],
                        "properties": {
                            "nodeId": {"type": "string", "minLength": 1},
                            "param": {"type": "string", "minLength": 1},
                        },
                        "additionalProperties": False,
                    },
                },
                "pinPolicy": {"type": "string"},
                "at": position,
                "interfaceAt": position,
                "variablesAt": position,
            },
            "additionalProperties": False,
        },
    }
    # 注释框（可选）：UE 的 Comment，纯编辑期标注，运行时不认识。
    properties["comments"] = {
        "type": "array",
        "items": {
            "type": "object",
            "required": ["id", "text", "at"],
            "properties": {
                "id": {"type": "string", "minLength": 1},
                "text": {"type": "string"},
                "at": position,
                "size": {
                    "type": "object",
                    "required": ["w", "h"],
                    "properties": {
                        "w": {"type": "integer", "minimum": 1},
                        "h": {"type": "integer", "minimum": 1},
                    },
                    "additionalProperties": False,
                },
                "tint": {"type": "string", "minLength": 1},
            },
            "additionalProperties": False,
        },
    }
    properties["edges"] = {
        "type": "array",
        "items": {
            "type": "object",
            "required": ["from", "to"],
            "properties": {
                "from": deepcopy(BINDING_SCHEMA),
                "to": deepcopy(BINDING_SCHEMA),
                "waypoints": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["x", "y"],
                        "properties": {"x": {"type": "integer"}, "y": {"type": "integer"}},
                        "additionalProperties": False,
                    },
                },
            },
            "additionalProperties": False,
        },
    }
    schema["required"] = [*WORKFLOW_SCHEMA["required"], "edges"]
    return schema


#: 图文档的 JSON Schema（`.owf` 文本解析出来就是这个形状）。
GRAPH_SCHEMA: dict[str, Any] = _graph_schema()


def is_graph_document(raw: Any) -> bool:
    """这份原始文档是不是当前版本的图文档。"""

    return isinstance(raw, dict) and raw.get("schema_version") == GRAPH_SCHEMA_VERSION


__all__ = [
    "BINDING_SCHEMA",
    "CONDITION_PINS",
    "EXEC_IN_PIN",
    "EXEC_OUT_PIN",
    "GRAPH_SCHEMA",
    "GRAPH_SCHEMA_VERSION",
    "exec_out_index",
    "is_exec_out_pin",
    "is_graph_document",
]
