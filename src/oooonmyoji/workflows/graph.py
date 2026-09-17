"""工作流图关系分析：沿父子连边推导某个执行点可用的节点输出。"""

from __future__ import annotations

from typing import Any


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
    return result


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
    return result


__all__ = [
    "available_output_node_ids",
    "guaranteed_output_node_ids",
    "possible_output_node_ids_in_subtree",
    "possibly_available_output_node_ids",
]
