"""节点图文档的自定义节点类型：`x-*` → 内置基类 + 预设载荷。

「可扩展节点类型」在 UE 里是 `UK2Node` 子类：类型是代码，实例只存差异。这里做同一件事，
只是定义写在文档里（`nodeTypes`）而不是编译进运行时：

```json
{
  "nodeTypes": {
    "x-tap_settlement": {
      "base": "task",
      "action": "input.tap_match",
      "params": { "verify_gone": true, "verify_timeout_seconds": 10 },
      "title": "点掉结算页"
    }
  },
  "nodes": [
    { "id": "tap_settle", "type": "x-tap_settlement", "params": { "match": { "ref": "..." } } }
  ]
}
```

三条规矩：

1. **自定义类型必须有内置基类**。这一轮扩展的是「一个可复用的预设节点」，不是新的执行语义——
   要新语义得先有运行时，硬塞一个编译器认不出的类型只会在运行期炸。
2. **节点载荷赢过预设**：对象（`params`）按层深合并，其余字段节点写了就用节点的。
   于是 `x-tap_settlement` 既能带一套默认参数，又能在个别节点上覆盖其中一项。
3. **定义不许碰结构**：`children` / `ports` / `default_child` / 坐标 / 锁都由节点与边决定，
   定义里写这些直接报错，避免「预设里藏了一条连线」这种看不见的东西。
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from ..exceptions import ConfigError
from .graph_schema import VARIABLE_NODE_TYPE
from .model import NODE_TYPES

#: 内置节点类型（运行时真正认识的）。
BUILTIN_NODE_TYPES = frozenset(NODE_TYPES)

#: 只活在编辑器/图文档里的节点类型：引擎没有对应节点，编译时被丢掉。
GRAPH_ONLY_NODE_TYPES = frozenset({VARIABLE_NODE_TYPE})

#: 自定义类型名的保留前缀。
CUSTOM_TYPE_PREFIX = "x-"

#: 定义里只影响显示、不进载荷的键。
_DISPLAY_KEYS = ("base", "title", "description", "tint")

#: 定义里禁止出现的键：它们由节点自身与边决定，藏进预设会变成看不见的结构。
_FORBIDDEN_DEFINITION_KEYS = frozenset(
    {"id", "type", "children", "ports", "default_child", "at", "size", "locked", "comment"}
)


def node_type_definitions(raw: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """读出文档里的 `nodeTypes`（可选）；结构不对就报错，不猜。"""

    definitions = raw.get("nodeTypes")
    if definitions is None:
        return {}
    if not isinstance(definitions, dict):
        raise ConfigError("nodeTypes must be an object of node type definitions")
    result: dict[str, dict[str, Any]] = {}
    for name, definition in definitions.items():
        if not isinstance(name, str) or not name:
            raise ConfigError("nodeTypes keys must be non-empty strings")
        if not name.startswith(CUSTOM_TYPE_PREFIX):
            raise ConfigError(
                f"custom node type '{name}' must start with '{CUSTOM_TYPE_PREFIX}' "
                "(the prefix keeps custom types distinguishable from built-in ones)"
            )
        if name in BUILTIN_NODE_TYPES:
            raise ConfigError(f"node type '{name}' is built-in and cannot be redefined")
        if not isinstance(definition, dict):
            raise ConfigError(f"nodeTypes.{name} must be an object")
        forbidden = sorted(set(definition) & _FORBIDDEN_DEFINITION_KEYS)
        if forbidden:
            raise ConfigError(
                f"nodeTypes.{name} cannot define {forbidden}: structure comes from the node and its edges"
            )
        base = definition.get("base")
        if not isinstance(base, str) or base not in BUILTIN_NODE_TYPES:
            raise ConfigError(
                f"nodeTypes.{name}.base must be one of {sorted(BUILTIN_NODE_TYPES)}, got {base!r}"
            )
        result[name] = definition
    return result


def _merge_dicts(defaults: dict[str, Any], overrides: dict[str, Any]) -> dict[str, Any]:
    """把覆盖值合并到默认值上：对象逐层合并，其余（含数组）整体替换。"""

    merged = deepcopy(defaults)
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge_dicts(merged[key], value)
        else:
            merged[key] = deepcopy(value)
    return merged


def resolve_node(
    node: dict[str, Any],
    definitions: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """把节点解析成「内置类型 + 合并后的载荷」；内置类型原样深拷返回。"""

    node_type = node.get("type")
    node_id = node.get("id", "<unknown>")
    if not isinstance(node_type, str) or not node_type:
        raise ConfigError(f"node {node_id} must define a non-empty type")
    if node_type in BUILTIN_NODE_TYPES or node_type in GRAPH_ONLY_NODE_TYPES:
        return deepcopy(node)
    definition = definitions.get(node_type)
    if definition is None:
        raise ConfigError(
            f"node {node_id} uses unknown node type '{node_type}': built-in types are "
            f"{sorted(BUILTIN_NODE_TYPES)}, graph-only types are {sorted(GRAPH_ONLY_NODE_TYPES)}; "
            f"custom types must be declared in nodeTypes as '{CUSTOM_TYPE_PREFIX}…' with a built-in 'base'"
        )
    payload: dict[str, Any] = {key: deepcopy(value) for key, value in node.items() if key != "type"}
    for key, value in definition.items():
        if key in _DISPLAY_KEYS:
            continue
        if key == "params" and isinstance(value, dict):
            own = payload.get("params")
            payload["params"] = _merge_dicts(value, own if isinstance(own, dict) else {})
            continue
        if key not in payload:
            payload[key] = deepcopy(value)
    payload["type"] = str(definition["base"])
    if "name" not in payload and isinstance(definition.get("title"), str):
        payload["name"] = definition["title"]
    # 自定义类型名挂在旁边，写回图文档时还原（画布内部按基类工作）。
    payload["_nodeType"] = node_type
    return payload


def custom_type_name(node: dict[str, Any]) -> str | None:
    """节点来自哪个自定义类型（不是自定义类型返回 None）。"""

    name = node.get("_nodeType")
    return name if isinstance(name, str) and name else None


__all__ = [
    "BUILTIN_NODE_TYPES",
    "CUSTOM_TYPE_PREFIX",
    "custom_type_name",
    "node_type_definitions",
    "resolve_node",
]
