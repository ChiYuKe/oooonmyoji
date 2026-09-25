"""节点图 v6 ⇄ Behavior Tree v4 的编译与反编译。

**编译**（`compile_graph`）：把带显式执行边的节点图编译成运行时认识的 v4 文档。
运行时（`validator.py` / `engine.py` / `supervisor.py`）一行不用改——执行语义仍然是
Behavior Tree，图只是它的编辑形态。

**反编译**（`decompile_workflow`）：把 v4 文档（含 `_layout` / `_layoutLocks` 编辑器
旁表）读成 v5，用于打开老文件与迁移。

引脚约定见 `graph_schema.py`；这里只做结构搬运与图结构检查，节点语义（装饰器、
绑定类型、Action 参数）仍然交给 v4 校验器，避免两套规则各自漂移。
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from ..exceptions import ConfigError
from .graph_pins import (
    delete_at_path,
    iter_node_refs,
    iter_variable_refs,
    path_to_pin,
    pin_to_path,
    set_at_path,
)
from .graph_schema import (
    CONDITION_PINS,
    EXEC_IN_PIN,
    GRAPH_SCHEMA_VERSION,
    VARIABLE_NODE_TYPE,
    VARIABLE_SCOPES,
    exec_out_index,
    is_exec_out_pin,
    is_graph_document,
)
from .graph_types import node_type_definitions, resolve_node

#: 节点载荷里由执行边表达、不写进图文档节点的字段。
_STRUCTURE_FIELDS = ("children", "ports", "default_child")

#: 编辑器/编译器内部标记，不进运行时文档。
_INTERNAL_FIELDS = ("_nodeType",)

#: 会产出 `nodes.<id>.output…` 的节点类型（数据边的来源）。
_OUTPUT_NODE_TYPES = frozenset({"task", "bool_judge", "break"})

#: 变量节点上的载荷键：只有这几个属于「代表哪个变量」，其余（含坐标）照常处理。
_VARIABLE_KEYS = ("scope", "name")

#: 运行时文档里不该出现的节点类型（图里的数据源，引擎没有对应节点）。
_GRAPH_ONLY_NODE_TYPES = frozenset({VARIABLE_NODE_TYPE})

#: 编辑器旁表键：v5 里坐标与锁进了节点自身，不再需要。
_INLINE_EDITOR_KEYS = ("_layout", "_layoutLocks")

#: 编辑器旁表键：v5 里变量卡与变量连线变成变量节点 + 数据边。
_VARIABLE_EDITOR_KEYS = ("_variableCards", "_variableLinks")

#: 编辑器旁表键：v5 里节点组搬进文档顶层的 `groups`。
_GROUP_EDITOR_KEYS = ("_nodeGroups",)

#: 组卡与两张组内合成卡的布局键前缀（画布用它们记位置）。
_GROUP_INTERFACE_PREFIX = "__node_group_interface__:"
_GROUP_VARIABLES_PREFIX = "__node_group_variables__:"

#: 顶层运行时键：编译产物只保留这些，下划线前缀的编辑器状态不进运行时文档。
_RUNTIME_KEYS = (
    "id",
    "version",
    "description",
    "resolution",
    "root",
    "inputs",
    "variables",
    "retry_safe",
    "limits",
)


def _node_map(nodes: list[dict[str, Any]], *, source: str) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for index, node in enumerate(nodes):
        node_id = node.get("id")
        if not isinstance(node_id, str) or not node_id:
            raise ConfigError(f"{source} nodes[{index}] must define a non-empty id")
        if node_id in result:
            raise ConfigError(f"{source} contains duplicate node IDs: {node_id}")
        result[node_id] = node
    return result


def _legal_exec_out_pins(node: dict[str, Any]) -> str:
    """这个节点允许的执行流出口长什么样（只用于报错说明）。"""

    node_type = str(node.get("type"))
    if node_type == "condition":
        return "true / false"
    if node_type == "switch":
        return "case.<下标> / default"
    return "then.<下标>"


def _check_groups(raw: dict[str, Any], node_ids: set[str]) -> None:
    """节点组是编辑期概念，但既然写进了文档就要说清楚：成员与端点必须存在。

    运行时不认识组，所以**不校验**它也不会跑错；但一个指向已删除节点的组会让编辑器
    在读入时静默剪掉成员（用户以为组还在），不如在编译期直接点名。
    """

    groups = raw.get("groups")
    if groups is None:
        return
    if not isinstance(groups, list):
        raise ConfigError("workflow graph groups must be an array")
    seen: set[str] = set()
    for index, group in enumerate(groups):
        if not isinstance(group, dict):
            raise ConfigError(f"groups[{index}] must be an object")
        group_id = group.get("id")
        if not isinstance(group_id, str) or not group_id:
            raise ConfigError(f"groups[{index}] must define a non-empty id")
        if group_id in seen:
            raise ConfigError(f"groups[{index}] duplicates group id: {group_id}")
        seen.add(group_id)
        members = group.get("nodeIds")
        if not isinstance(members, list) or not members:
            raise ConfigError(f"group {group_id} must list at least one member node")
        for member in members:
            if member not in node_ids:
                raise ConfigError(f"group {group_id} references an unknown node: {member}")
        pins = group.get("pins")
        if pins is None:
            continue
        if not isinstance(pins, list):
            raise ConfigError(f"group {group_id} pins must be an array")
        for pin_index, pin in enumerate(pins):
            if not isinstance(pin, dict):
                raise ConfigError(f"group {group_id} pins[{pin_index}] must be an object")
            if pin.get("nodeId") not in node_ids:
                raise ConfigError(
                    f"group {group_id} pins[{pin_index}] references an unknown node: {pin.get('nodeId')}"
                )
            if pin.get("nodeId") not in members:
                raise ConfigError(
                    f"group {group_id} pins[{pin_index}] points outside the group: {pin.get('nodeId')}"
                )
            if not isinstance(pin.get("param"), str) or not pin.get("param"):
                raise ConfigError(f"group {group_id} pins[{pin_index}] must define a non-empty param")


def _check_waypoints(raw: dict[str, Any]) -> None:
    """手工折线（UE Knot）：折点坐标必须是整数。

    结构 schema 已经挡了一层，这里再报一次是为了让**编译器本身**也能给出指名的错误
    （桌面端的诊断与它对齐：`graph-waypoint-position`），而不是只有走 loader 才会被拒。
    """

    edges = raw.get("edges")
    if not isinstance(edges, list):
        return
    for index, edge in enumerate(edges):
        if not isinstance(edge, dict) or "waypoints" not in edge:
            continue
        waypoints = edge["waypoints"]
        if not isinstance(waypoints, list):
            raise ConfigError(f"edges[{index}].waypoints must be an array")
        for point_index, point in enumerate(waypoints):
            if not (
                isinstance(point, dict)
                and isinstance(point.get("x"), int)
                and isinstance(point.get("y"), int)
            ):
                raise ConfigError(f"edges[{index}].waypoints[{point_index}] must define integer x / y")


def _check_comments(raw: dict[str, Any]) -> None:
    """注释框（UE Comment）：纯编辑期标注，运行时不认识，但文档里写了就要自洽。"""

    comments = raw.get("comments")
    if comments is None:
        return
    if not isinstance(comments, list):
        raise ConfigError("workflow graph comments must be an array")
    seen: set[str] = set()
    for index, comment in enumerate(comments):
        if not isinstance(comment, dict):
            raise ConfigError(f"comments[{index}] must be an object")
        comment_id = comment.get("id")
        if not isinstance(comment_id, str) or not comment_id:
            raise ConfigError(f"comments[{index}] must define a non-empty id")
        if comment_id in seen:
            raise ConfigError(f"comments[{index}] duplicates comment id: {comment_id}")
        seen.add(comment_id)
        if not isinstance(comment.get("text"), str):
            raise ConfigError(f"comment {comment_id} must define text as a string")
        position = comment.get("at")
        if not (
            isinstance(position, dict)
            and isinstance(position.get("x"), int)
            and isinstance(position.get("y"), int)
        ):
            raise ConfigError(f"comment {comment_id} must define at as integer x / y")
        size = comment.get("size")
        if size is None:
            continue
        if not isinstance(size, dict) or not isinstance(size.get("w"), int) or not isinstance(size.get("h"), int):
            raise ConfigError(f"comment {comment_id} size must be integer w / h")
        if size["w"] < 1 or size["h"] < 1:
            raise ConfigError(f"comment {comment_id} size must be positive")


def _collect_edges(
    raw: dict[str, Any],
    nodes: dict[str, dict[str, Any]],
) -> tuple[dict[str, dict[Any, str]], list[dict[str, Any]]]:
    """把 v5 的边收成「执行出边」与「数据边」，并顺手做图结构检查。

    - 执行边：`{源节点: {口: 目标节点}}`，编译成 `children` / `ports` / `cases`；
    - 数据边：来源引脚 `out` / `out.<字段路径>`，落到目标节点的数据引脚上，
      编译成绑定的 `{"ref": "nodes.<源节点>.output.<字段路径>"}`。
    """

    outgoing: dict[str, dict[Any, str]] = {node_id: {} for node_id in nodes}
    data_edges: list[dict[str, Any]] = []
    parents: dict[str, str] = {}
    edges = raw.get("edges")
    if not isinstance(edges, list):
        raise ConfigError("workflow graph must define an edges array")
    for index, edge in enumerate(edges):
        if not isinstance(edge, dict):
            raise ConfigError(f"edges[{index}] must be an object")
        source = edge.get("from")
        target = edge.get("to")
        if not isinstance(source, dict) or not isinstance(target, dict):
            raise ConfigError(f"edges[{index}] must define from and to")
        source_id = source.get("node")
        source_pin = source.get("pin")
        target_id = target.get("node")
        target_pin = target.get("pin")
        if not isinstance(source_id, str) or not isinstance(source_pin, str):
            raise ConfigError(f"edges[{index}].from must define node and pin")
        if not isinstance(target_id, str) or not isinstance(target_pin, str):
            raise ConfigError(f"edges[{index}].to must define node and pin")
        if source_id not in nodes:
            raise ConfigError(f"edges[{index}] starts at an unknown node: {source_id}")
        if target_id not in nodes:
            raise ConfigError(f"edges[{index}] points at an unknown node: {target_id}")
        if source_pin == "out" or source_pin.startswith("out."):
            data_edges.append(_data_edge(index, nodes, source_id, source_pin, target_id, target_pin))
            continue
        if str(nodes[source_id].get("type")) == VARIABLE_NODE_TYPE:
            raise ConfigError(
                f"edges[{index}] starts at variable node {source_id} with pin '{source_pin}': "
                "variable nodes only have the data pin out / out.<字段路径>"
            )
        if not is_exec_out_pin(source_pin):
            raise ConfigError(
                f"edges[{index}] starts at an unknown pin '{source_pin}': execution pins are "
                f"{_legal_exec_out_pins(nodes[source_id])}, data pins are out / out.<字段路径>"
            )
        if target_pin != EXEC_IN_PIN:
            raise ConfigError(f"edges[{index}].to.pin must be '{EXEC_IN_PIN}': {target_pin}")
        source_node = nodes[source_id]
        source_type = str(source_node.get("type"))
        key: Any
        if source_pin in CONDITION_PINS:
            if source_type != "condition":
                raise ConfigError(
                    f"node {source_id} ({source_type}) has no '{source_pin}' execution pin; "
                    f"its execution pins are {_legal_exec_out_pins(source_node)}"
                )
            key = source_pin
        elif source_type == "condition":
            # 判断节点只有 true / false 两个口：`then.*` 会让那条边在编译时被丢掉。
            raise ConfigError(
                f"node {source_id} (condition) has no '{source_pin}' execution pin; "
                f"its execution pins are {_legal_exec_out_pins(source_node)}"
            )
        elif source_type == "switch":
            head, _, _tail = source_pin.partition(".")
            if head != "case" and source_pin != "default":
                raise ConfigError(
                    f"node {source_id} (switch) has no '{source_pin}' execution pin; "
                    f"its execution pins are {_legal_exec_out_pins(source_node)}"
                )
            if source_pin == "default":
                key = "default"
            else:
                try:
                    key = ("case", exec_out_index(source_pin))
                except ValueError as exc:
                    raise ConfigError(f"edges[{index}]: {exc}") from exc
        else:
            head, _, _tail = source_pin.partition(".")
            if head != "then":
                raise ConfigError(
                    f"node {source_id} ({source_type}) has no '{source_pin}' execution pin; "
                    f"its execution pins are {_legal_exec_out_pins(source_node)}"
                )
            try:
                key = exec_out_index(source_pin)
            except ValueError as exc:
                raise ConfigError(f"edges[{index}]: {exc}") from exc
        if key in outgoing[source_id]:
            raise ConfigError(f"node {source_id} connects pin '{source_pin}' twice")
        existing_parent = parents.get(target_id)
        if existing_parent is not None:
            raise ConfigError(
                f"node {target_id} has two execution parents: {existing_parent} and {source_id}"
            )
        parents[target_id] = source_id
        outgoing[source_id][key] = target_id
    return outgoing, data_edges


def _variable_source(node: dict[str, Any]) -> tuple[str, str]:
    """校验变量节点并取出 `(作用域, 键)`。"""

    node_id = node.get("id", "<unknown>")
    scope = node.get("scope")
    name = node.get("name")
    if scope not in VARIABLE_SCOPES:
        raise ConfigError(
            f"variable node {node_id} must define scope as one of {list(VARIABLE_SCOPES)}, got {scope!r}"
        )
    if not isinstance(name, str) or not name:
        raise ConfigError(f"variable node {node_id} must define a non-empty name")
    return str(scope), name


def _data_edge(
    index: int,
    nodes: dict[str, dict[str, Any]],
    source_id: str,
    source_pin: str,
    target_id: str,
    target_pin: str,
) -> dict[str, Any]:
    """校验一条数据边并解析出目标载荷路径。"""

    source_node = nodes[source_id]
    source_type = str(source_node.get("type"))
    if source_type == VARIABLE_NODE_TYPE:
        scope, name = _variable_source(source_node)
        ref = f"{scope}.{name}{source_pin[len('out'):]}"
    elif source_type in _OUTPUT_NODE_TYPES:
        ref = f"nodes.{source_id}.output{source_pin[len('out'):]}"
    else:
        raise ConfigError(
            f"edges[{index}] reads '{source_pin}' from node {source_id} "
            f"({source_node.get('type')}), which produces no output"
        )
    target_node = nodes[target_id]
    if str(target_node.get("type")) == VARIABLE_NODE_TYPE:
        raise ConfigError(
            f"edges[{index}] points at variable node {target_id}: variable nodes are sources, "
            "they take no input"
        )
    path = pin_to_path(target_node, target_pin)
    if path is None:
        raise ConfigError(
            f"edges[{index}].to.pin '{target_pin}' is not a data pin of node {target_id} "
            f"({target_node.get('type')})"
        )
    return {
        "index": index,
        "ref": ref,
        "path": path,
        "target": target_id,
    }


def _check_acyclic(nodes: dict[str, dict[str, Any]], outgoing: dict[str, dict[Any, str]]) -> None:
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node_id: str, trail: tuple[str, ...]) -> None:
        if node_id in visiting:
            cycle = " -> ".join([*trail, node_id])
            raise ConfigError(f"workflow graph contains a cycle: {cycle}")
        if node_id in visited:
            return
        visiting.add(node_id)
        for child_id in outgoing.get(node_id, {}).values():
            visit(child_id, (*trail, node_id))
        visiting.discard(node_id)
        visited.add(node_id)

    for node_id in nodes:
        visit(node_id, ())


def compile_graph(raw: dict[str, Any]) -> dict[str, Any]:
    """节点图 v6 → Behavior Tree v4 文档。"""

    if not is_graph_document(raw):
        raise ConfigError("compile_graph expects a schema_version 6 node graph")
    nodes_raw = raw.get("nodes")
    if not isinstance(nodes_raw, list):
        raise ConfigError("workflow graph must define a nodes array")
    # 自定义节点类型先解析成「内置基类 + 合并后的载荷」，后面的引脚推导、边收集与
    # 载荷搬运都按解析结果走——`x-…` 类型在运行时文档里不该留下痕迹。
    definitions = node_type_definitions(raw)
    resolved_raw = [resolve_node(node, definitions) for node in nodes_raw if isinstance(node, dict)]
    if len(resolved_raw) != len(nodes_raw):
        raise ConfigError("workflow graph nodes must all be objects")
    nodes = _node_map(resolved_raw, source="workflow graph")
    # 组与注释框是编辑期概念（运行时不认识），但文档里写了就要自洽；折点只要坐标合法。
    _check_groups(raw, set(nodes))
    _check_comments(raw)
    _check_waypoints(raw)
    outgoing, data_edges = _collect_edges(raw, nodes)
    _check_acyclic(nodes, outgoing)
    # 同一目标引脚接了两条数据边 = 后写的那条静默覆盖前一条，必须在编译期拦下来。
    data_targets: dict[tuple[str, str], int] = {}
    for data_edge in data_edges:
        key = (str(data_edge["target"]), ".".join(str(part) for part in data_edge["path"]))
        previous = data_targets.get(key)
        if previous is not None:
            raise ConfigError(
                f"node {data_edge['target']} data pin '{data_edge['path']}' is connected twice "
                f"(edges[{previous}] and edges[{data_edge['index']}])"
            )
        data_targets[key] = int(data_edge["index"])

    payloads: dict[str, dict[str, Any]] = {}
    compiled_nodes: list[dict[str, Any]] = []
    for node in resolved_raw:
        node_id = str(node["id"])
        node_type = str(node.get("type"))
        if node_type in _GRAPH_ONLY_NODE_TYPES:
            # 变量节点只活在编辑器里：校验它能被解析，但不进运行时文档。
            _variable_source(node)
            continue
        # **深拷**：数据边会往载荷里写 `{"ref": …}`，浅拷的话会连带改掉调用方手里的
        # 图文档（迁移脚本会把「边 + 内联引用」双份表示写回文件）。
        payload = deepcopy(
            {
                key: value
                for key, value in node.items()
                if key not in _STRUCTURE_FIELDS
                and key not in _INTERNAL_FIELDS
                and key not in {"at", "size", "locked", "comment"}
            }
        )
        payloads[node_id] = payload
        pins = outgoing.get(node_id, {})
        if node_type == "condition":
            children: list[str] = []
            ports: list[str] = []
            for port in CONDITION_PINS:
                child_id = pins.get(port)
                if child_id is not None:
                    children.append(child_id)
                    ports.append(port)
            if children:
                payload["children"] = children
                payload["ports"] = ports
        elif node_type == "switch":
            cases = node.get("cases")
            case_values = cases if isinstance(cases, list) else []
            compiled_cases: list[dict[str, Any]] = []
            for index, case in enumerate(case_values):
                child_id = pins.get(("case", index))
                if child_id is None:
                    raise ConfigError(
                        f"node {node_id} (switch) case {index} has no execution edge; "
                        "every case must point at a branch node in v5"
                    )
                value = case.get("value") if isinstance(case, dict) else None
                compiled_cases.append({"value": value, "child": child_id})
            default_child = pins.get("default")
            stray = [key for key in pins if isinstance(key, tuple) and key[0] == "case" and key[1] >= len(case_values)]
            if stray:
                raise ConfigError(
                    f"node {node_id} (switch) connects case {stray[0][1]} but only declares {len(case_values)} cases"
                )
            payload["cases"] = compiled_cases
            if default_child is not None:
                payload["default_child"] = default_child
            payload["children"] = [case["child"] for case in compiled_cases] + (
                [default_child] if default_child is not None else []
            )
        else:
            ordered = [pins[index] for index in sorted(key for key in pins if isinstance(key, int))]
            if ordered:
                payload["children"] = ordered
        compiled_nodes.append(payload)

    # 数据边落成参数里的绑定：与手写 `{"ref": "nodes.<id>.output…"}` 完全等价。
    for data_edge in data_edges:
        set_at_path(payloads[str(data_edge["target"])], data_edge["path"], {"ref": data_edge["ref"]})

    compiled: dict[str, Any] = {"schema_version": 4}
    for runtime_key in _RUNTIME_KEYS:
        if runtime_key in raw:
            compiled[runtime_key] = raw[runtime_key]
    compiled["nodes"] = compiled_nodes
    return compiled


def decompile_workflow(raw: dict[str, Any]) -> dict[str, Any]:
    """Behavior Tree v4 文档 → 节点图文档（迁移：v4 → v6，落盘由 `dsl/convert.py` 写 `.owf`）。"""

    if not isinstance(raw, dict):
        raise ConfigError("workflow must be a JSON object")
    if is_graph_document(raw):
        return raw
    nodes_raw = raw.get("nodes")
    if not isinstance(nodes_raw, list):
        raise ConfigError("workflow must define a nodes array")
    raw_layout = raw.get("_layout")
    layout: dict[str, Any] = raw_layout if isinstance(raw_layout, dict) else {}
    raw_locks = raw.get("_layoutLocks")
    locks: list[Any] = raw_locks if isinstance(raw_locks, list) else []

    document: dict[str, Any] = {"schema_version": GRAPH_SCHEMA_VERSION}
    for key in _RUNTIME_KEYS:
        if key in raw:
            document[key] = raw[key]
    # 其余编辑器私有键（输入参数元数据）原样带走；变量卡与变量连线变成图里的变量节点 +
    # 数据边，节点组搬进顶层的 `groups`，都不再以旁表形式出现在 v5 文档里。
    for key, value in raw.items():
        if not key.startswith("_"):
            continue
        if key in _INLINE_EDITOR_KEYS or key in _VARIABLE_EDITOR_KEYS or key in _GROUP_EDITOR_KEYS:
            continue
        document[key] = value

    groups: list[dict[str, Any]] = []
    raw_groups = raw.get("_nodeGroups")
    node_groups: dict[str, Any] = raw_groups if isinstance(raw_groups, dict) else {}
    for group_id, group in node_groups.items():
        if not isinstance(group, dict):
            continue
        entry: dict[str, Any] = {"id": str(group_id)}
        if isinstance(group.get("name"), str) and group["name"]:
            entry["name"] = group["name"]
        entry["nodeIds"] = [str(member) for member in group.get("nodeIds", []) if isinstance(member, str)]
        if isinstance(group.get("pins"), list):
            entry["pins"] = [
                {"nodeId": str(pin["nodeId"]), "param": str(pin["param"])}
                for pin in group["pins"]
                if isinstance(pin, dict) and "nodeId" in pin and "param" in pin
            ]
        if isinstance(group.get("pinPolicy"), str):
            entry["pinPolicy"] = group["pinPolicy"]
        for key, layout_key in (
            ("at", str(group_id)),
            ("interfaceAt", f"{_GROUP_INTERFACE_PREFIX}{group_id}"),
            ("variablesAt", f"{_GROUP_VARIABLES_PREFIX}{group_id}"),
        ):
            position = layout.get(layout_key)
            if isinstance(position, dict) and isinstance(position.get("x"), int) and isinstance(position.get("y"), int):
                entry[key] = {"x": position["x"], "y": position["y"]}
        if entry["nodeIds"]:
            groups.append(entry)
    if groups:
        document["groups"] = groups

    # 变量节点：一个 (作用域, 键) 一个节点，id 由两者推导——v4 的引用里只有
    # `variables.x`，卡片 id 过一趟编译就没了，所以 id 必须从引用本身推出来，
    # 这样「编译 → 反编译」与反复刷新都稳定（同名重复卡片会并成一个变量）。
    variable_nodes: dict[tuple[str, str], dict[str, Any]] = {}
    used_node_ids = {str(node.get("id")) for node in nodes_raw if isinstance(node, dict)}

    def variable_node(scope: str, name: str) -> dict[str, Any]:
        key = (scope, name)
        existing = variable_nodes.get(key)
        if existing is not None:
            return existing
        candidate = f"var__{scope}__{name}"
        while candidate in used_node_ids:
            candidate += "_"
        used_node_ids.add(candidate)
        node: dict[str, Any] = {"id": candidate, "type": VARIABLE_NODE_TYPE, "scope": scope, "name": name}
        variable_nodes[key] = node
        return node

    raw_cards = raw.get("_variableCards")
    cards: dict[str, Any] = raw_cards if isinstance(raw_cards, dict) else {}
    for card_id, card in cards.items():
        if not isinstance(card, dict):
            continue
        scope = card.get("scope") if card.get("scope") in VARIABLE_SCOPES else "inputs"
        name = card.get("name")
        if not isinstance(name, str) or not name:
            continue
        node = variable_node(str(scope), name)
        if "at" not in node:
            position = layout.get(str(card_id))
            if not (isinstance(position, dict) and isinstance(position.get("x"), int) and isinstance(position.get("y"), int)):
                position = card
            if isinstance(position.get("x"), int) and isinstance(position.get("y"), int):
                node["at"] = {"x": position["x"], "y": position["y"]}
            if str(card_id) in locks:
                node["locked"] = True

    edges: list[dict[str, Any]] = []
    nodes: list[dict[str, Any]] = []
    for index, node in enumerate(nodes_raw):
        if not isinstance(node, dict):
            raise ConfigError(f"nodes[{index}] must be an object")
        node_id = str(node.get("id", ""))
        node_type = str(node.get("type", ""))
        payload = deepcopy({key: value for key, value in node.items() if key not in _STRUCTURE_FIELDS})
        # 认得出引脚位置的 `{"ref": "nodes.…"}` 提成数据边（右边补在下面），
        # 认不出的位置原样留在参数里——格式换代不能吞掉任何一条既有连线。
        extractions: list[tuple[tuple[Any, ...], str, str]] = []
        for ref_path, ref_text in iter_node_refs(payload):
            pin = path_to_pin(node, list(ref_path))
            if pin is None:
                continue
            extractions.append((ref_path, ref_text, pin))
        # 变量/输入引用同样折成边：来源是变量节点（没有卡片就补一张）。
        for ref_path, ref_text in list(iter_variable_refs(payload)):
            pin = path_to_pin(node, list(ref_path))
            if pin is None:
                continue
            scope, _, rest = ref_text.partition(".")
            name, _, nested = rest.partition(".")
            if scope not in VARIABLE_SCOPES or not name:
                continue
            source = variable_node(scope, name)
            edges.append(
                {
                    "from": {
                        "node": source["id"],
                        "pin": f"out{'.' + nested if nested else ''}",
                    },
                    "to": {"node": node_id, "pin": pin},
                }
            )
            delete_at_path(payload, list(ref_path))
        # 摘引用时列表元素留洞，所以删除顺序不影响结果。
        for ref_path, ref_text, pin in extractions:
            parts = ref_text.split(".")
            output_field = ".".join(parts[3:])
            edges.append(
                {
                    "from": {
                        "node": parts[1],
                        "pin": f"out{'.' + output_field if output_field else ''}",
                    },
                    "to": {"node": node_id, "pin": pin},
                }
            )
            delete_at_path(payload, list(ref_path))
        raw_cases = payload.get("cases")
        if isinstance(raw_cases, list):
            payload["cases"] = [
                {"value": case.get("value")} if isinstance(case, dict) else {"value": case}
                for case in raw_cases
            ]
        raw_children = node.get("children")
        children: list[Any] = raw_children if isinstance(raw_children, list) else []
        if node_type == "condition":
            raw_declared = node.get("ports")
            declared: list[Any] = raw_declared if isinstance(raw_declared, list) else []
            used: set[str] = set()
            for position, child_id in enumerate(children):
                port = declared[position] if position < len(declared) else None
                if port not in CONDITION_PINS or port in used:
                    port = "false" if "true" in used else "true"
                used.add(str(port))
                edges.append(
                    {"from": {"node": node_id, "pin": port}, "to": {"node": str(child_id), "pin": EXEC_IN_PIN}}
                )
        elif node_type == "switch":
            for case_index, case in enumerate(raw_cases if isinstance(raw_cases, list) else []):
                child_id = case.get("child") if isinstance(case, dict) else None
                if isinstance(child_id, str):
                    edges.append(
                        {
                            "from": {"node": node_id, "pin": f"case.{case_index}"},
                            "to": {"node": child_id, "pin": EXEC_IN_PIN},
                        }
                    )
            default_child = node.get("default_child")
            if isinstance(default_child, str):
                edges.append(
                    {"from": {"node": node_id, "pin": "default"}, "to": {"node": default_child, "pin": EXEC_IN_PIN}}
                )
        else:
            for position, child_id in enumerate(children):
                edges.append(
                    {
                        "from": {"node": node_id, "pin": f"then.{position}"},
                        "to": {"node": str(child_id), "pin": EXEC_IN_PIN},
                    }
                )
        at_position = layout.get(node_id)
        if (
            isinstance(at_position, dict)
            and isinstance(at_position.get("x"), int)
            and isinstance(at_position.get("y"), int)
        ):
            payload["at"] = {"x": at_position["x"], "y": at_position["y"]}
        if node_id in locks:
            payload["locked"] = True
        nodes.append(payload)

    # 变量节点排在业务节点后面：它们没有执行流，位置由卡片坐标决定（没有就留给编辑器放）。
    nodes.extend(variable_nodes.values())
    document["nodes"] = nodes
    document["edges"] = edges
    return document


__all__ = ["compile_graph", "decompile_workflow"]
