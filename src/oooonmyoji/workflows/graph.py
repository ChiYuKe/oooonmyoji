"""工作流图关系分析：推导某个执行点可用的节点输出。

可用性有两个来源：

1. **执行位置**：沿父子连边往上走，把同级里排在前面的兄弟节点的输出算进来
   （`available_output_node_ids`）。
2. **惰性数据节点**：布尔判断（`bool_judge`）与拆分（`break`）不在执行树里，
   它们在被引用的那一刻按需求值（`engine._evaluate_data_node`）。所以它们对某个
   执行点可用，当且仅当它们**自己的**依赖在该执行点可用——依赖在更后面的节点上的
   数据卡片，引用过去仍然会报错（`lazily_available_output_node_ids`）。
"""

from __future__ import annotations

from typing import Any

from ..exceptions import ConfigError

#: 不在执行树里、按需求值的纯数据节点类型。
PURE_DATA_NODE_TYPES = frozenset({"bool_judge", "break"})


def _node_index(nodes: list[dict[str, Any]]) -> tuple[dict[str, dict[str, Any]], dict[str, list[str]]]:
    node_map = {str(node.get("id")): node for node in nodes if isinstance(node.get("id"), str)}
    parents: dict[str, list[str]] = {}
    for node in nodes:
        parent_id = node.get("id")
        children = node.get("children")
        if not isinstance(parent_id, str) or not isinstance(children, list):
            continue
        for child in children:
            if isinstance(child, str):
                parents.setdefault(child, []).append(parent_id)
    return node_map, parents


def guaranteed_output_node_ids(
    node_id: str,
    node_map: dict[str, dict[str, Any]],
    visiting: frozenset[str] = frozenset(),
) -> set[str]:
    if node_id in visiting:
        return set()
    node = node_map.get(node_id)
    if node is None:
        return set()
    node_type = node.get("type")
    if node_type == "task":
        return {node_id} if isinstance(node.get("action"), str) else set()
    # 值卡片：求值成功就一定产出输出（布尔判断 `nodes.<id>.output.value`、拆分 `nodes.<id>.output.<字段>`）。
    if node_type in {"bool_judge", "break"}:
        return {node_id}
    children = node.get("children")
    if not isinstance(children, list):
        return set()
    nested = visiting | {node_id}
    if node_type == "root" and len(children) == 1:
        return guaranteed_output_node_ids(str(children[0]), node_map, nested)
    if node_type == "sequence":
        result: set[str] = set()
        for child in children:
            result.update(guaranteed_output_node_ids(str(child), node_map, nested))
        return result
    if node_type == "selector" and len(children) == 1:
        return guaranteed_output_node_ids(str(children[0]), node_map, nested)
    if node_type == "simple_parallel" and len(children) == 2:
        # A successful parallel node guarantees only that its main task
        # succeeded. The background branch may fail, still run, or be aborted.
        return guaranteed_output_node_ids(str(children[0]), node_map, nested)
    if node_type in {"parallel", "repeat_until", "branch", "switch"}:
        return set()
    return set()


def _referenced_source_ids(value: Any) -> set[str]:
    """收集一段载荷里所有 ``{"ref": "nodes.<id>.output..."}`` 的来源节点 id。"""

    found: set[str] = set()
    if isinstance(value, dict):
        ref = value.get("ref")
        if isinstance(ref, str):
            parts = ref.split(".")
            if len(parts) >= 3 and parts[0] == "nodes" and parts[2] == "output" and parts[1]:
                found.add(parts[1])
        for child in value.values():
            found |= _referenced_source_ids(child)
    elif isinstance(value, list):
        for child in value:
            found |= _referenced_source_ids(child)
    return found


def _pure_data_dependencies(node: dict[str, Any]) -> set[str]:
    """纯数据节点自己的上游节点依赖：布尔判断看表达式，拆分看拆分来源。"""

    node_type = node.get("type")
    if node_type == "bool_judge":
        return _referenced_source_ids(node.get("expression"))
    if node_type == "break":
        ref = node.get("ref")
        return _referenced_source_ids(ref if isinstance(ref, (dict, list)) else {"ref": ref})
    return set()


def _with_lazy_pure_nodes(nodes: list[dict[str, Any]], base_ids: set[str]) -> set[str]:
    """把「依赖都已就绪」的纯数据节点补进可用集合（不动点迭代，天然容忍纯节点之间的环）。"""

    node_map, _ = _node_index(nodes)
    pure_nodes = {
        node_id: node
        for node_id, node in node_map.items()
        if node.get("type") in PURE_DATA_NODE_TYPES
    }
    if not pure_nodes:
        return set(base_ids)
    result = set(base_ids)
    changed = True
    while changed:
        changed = False
        for node_id, node in pure_nodes.items():
            if node_id in result:
                continue
            if _pure_data_dependencies(node) <= result:
                result.add(node_id)
                changed = True
    return result


def reference_consumers(nodes: list[dict[str, Any]]) -> dict[str, set[str]]:
    """节点 id → 引用它的节点 id 集合（纯数据节点之间的引用也算）。"""

    consumers: dict[str, set[str]] = {}
    for node in nodes:
        node_id = node.get("id")
        if not isinstance(node_id, str):
            continue
        for source_id in _referenced_source_ids(node):
            consumers.setdefault(source_id, set()).add(node_id)
    return consumers


def pure_data_guard(
    nodes: list[dict[str, Any]],
    node_id: str,
    *,
    visiting: frozenset[str] = frozenset(),
) -> set[str] | None:
    """纯数据节点自己的依赖「必须在哪里可用」的守卫集合。

    它没有执行位置，所以判据只能落在使用者身上：

    - 没有任何使用者 → 返回 ``None``，表示位置无关（一张没人用的卡片放在哪里都不该报错）；
    - 否则返回**所有使用者执行点可用集合的交集**。引擎是按需求值的，但「求值那一刻
      取不到」仍然是运行期错误，所以只被某一个使用点满足并不算数；
      使用者本身也是纯数据节点时继续往它的使用者上递归。
    """

    if node_id in visiting:
        raise ConfigError(f"cyclic pure data reference: {node_id}")
    node_map, _ = _node_index(nodes)
    users = reference_consumers(nodes).get(node_id, set())
    if not users:
        return None
    guard: set[str] | None = None
    nested = visiting | {node_id}
    for user_id in users:
        user = node_map.get(user_id)
        if user is None:
            continue
        if user.get("type") in PURE_DATA_NODE_TYPES:
            point = pure_data_guard(nodes, user_id, visiting=nested)
            if point is None:
                # 使用者自己也没人用，不能约束这个依赖的位置。
                continue
        else:
            point = available_output_node_ids(nodes, user_id)
        guard = point if guard is None else guard & point
    return guard


def available_output_node_ids(
    nodes: list[dict[str, Any]],
    target_node_id: str,
) -> set[str]:
    node_map, parents = _node_index(nodes)
    result: set[str] = set()
    visited: set[str] = set()
    current = target_node_id
    while current not in visited:
        visited.add(current)
        parent_ids = parents.get(current, [])
        if len(parent_ids) != 1:
            break
        parent = node_map.get(parent_ids[0])
        if parent is None:
            break
        children = parent.get("children")
        if parent.get("type") == "sequence" and isinstance(children, list):
            try:
                current_index = children.index(current)
            except ValueError:
                current_index = 0
            for sibling in children[:current_index]:
                result.update(guaranteed_output_node_ids(str(sibling), node_map))
        current = str(parent["id"])
    return _with_lazy_pure_nodes(nodes, result)


def possible_output_node_ids_in_subtree(
    node_id: str,
    node_map: dict[str, dict[str, Any]],
    visiting: frozenset[str] = frozenset(),
) -> set[str]:
    if node_id in visiting:
        return set()
    node = node_map.get(node_id)
    if node is None:
        return set()
    if node.get("type") == "task":
        return {node_id} if isinstance(node.get("action"), str) else set()
    if node.get("type") in {"bool_judge", "break"}:
        return {node_id}
    children = node.get("children")
    if not isinstance(children, list):
        return set()
    nested = visiting | {node_id}
    result: set[str] = set()
    for child in children:
        result.update(possible_output_node_ids_in_subtree(str(child), node_map, nested))
    return result


def possibly_available_output_node_ids(
    nodes: list[dict[str, Any]],
    target_node_id: str,
) -> set[str]:
    node_map, parents = _node_index(nodes)
    result = available_output_node_ids(nodes, target_node_id)
    visited: set[str] = set()
    current = target_node_id
    while current not in visited:
        visited.add(current)
        parent_ids = parents.get(current, [])
        if len(parent_ids) != 1:
            break
        parent = node_map.get(parent_ids[0])
        if parent is None:
            break
        children = parent.get("children")
        if parent.get("type") in {"sequence", "selector", "branch", "switch"} and isinstance(children, list):
            try:
                current_index = children.index(current)
            except ValueError:
                current_index = 0
            for sibling in children[:current_index]:
                result.update(possible_output_node_ids_in_subtree(str(sibling), node_map))
        current = str(parent["id"])
    return _with_lazy_pure_nodes(nodes, result)


__all__ = [
    "PURE_DATA_NODE_TYPES",
    "available_output_node_ids",
    "guaranteed_output_node_ids",
    "possible_output_node_ids_in_subtree",
    "possibly_available_output_node_ids",
    "pure_data_guard",
    "reference_consumers",
]
