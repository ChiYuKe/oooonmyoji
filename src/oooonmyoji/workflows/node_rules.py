"""节点级语义规则：装饰器解析、实例并行运行项、输出 schema 预取与图结构校验。"""

from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
from typing import Any

from ..actions import ActionRegistry
from ..config.loader import resolve_workflow_path
from ..exceptions import ConfigError
from .bindings import ref_schema, validate_value
from .model import BehaviorDecorator, WorkflowNode
from .resolver import is_binding

OPTIONAL_DECORATOR_FIELDS = {"retry": {"delay_seconds"}, "do_once": {"reset_on_failure"}}


def parse_decorators(
    raw: list[Any],
    *,
    node_index: int,
    node_ids: set[str],
    reference_schema: dict[str, Any],
    output_schemas: dict[str, dict[str, Any] | None],
    available_node_ids: set[str],
    possibly_available_node_ids: set[str],
) -> tuple[BehaviorDecorator, ...]:
    parsed: list[BehaviorDecorator] = []
    seen_singletons: set[str] = set()
    for index, item in enumerate(raw):
        assert isinstance(item, dict)
        kind = str(item["type"])
        path = f"nodes[{node_index}].decorators[{index}]"
        allowed = {
            "condition": {"type", "expression"},
            "cooldown": {"type", "seconds"},
            "timeout": {"type", "seconds"},
            "retry": {"type", "attempts", "delay_seconds"},
            "repeat": {"type", "count"},
            "do_once": {"type", "reset_on_failure"},
        }[kind]
        extra = set(item) - allowed
        missing = allowed - set(item) - OPTIONAL_DECORATOR_FIELDS.get(kind, set())
        if extra or missing:
            details = f"unknown fields {sorted(extra)}" if extra else f"missing fields {sorted(missing)}"
            raise ConfigError(f"{path}: {details}")
        if kind != "condition":
            if kind in seen_singletons:
                raise ConfigError(f"nodes[{node_index}] contains duplicate {kind} decorators")
            seen_singletons.add(kind)
        for key, expected_type in {"seconds": "number", "attempts": "integer", "delay_seconds": "number", "reset_on_failure": "boolean"}.items():
            if key in item:
                validate_value(item[key], node_ids=node_ids, reference_schema=reference_schema, output_schemas=output_schemas,
                              available_node_ids=available_node_ids, possibly_available_node_ids=possibly_available_node_ids,
                              path=f"{path}.{key}", expected_schema={"type": expected_type})
        if kind == "condition":
            validate_value(item["expression"], node_ids=node_ids, reference_schema=reference_schema, output_schemas=output_schemas, available_node_ids=available_node_ids, possibly_available_node_ids=possibly_available_node_ids, path=f"{path}.expression", condition=True)
            parsed.append(BehaviorDecorator(type=kind, expression=item["expression"]))
        elif kind in {"cooldown", "timeout"}:
            parsed.append(BehaviorDecorator(type=kind, seconds=deepcopy(item["seconds"])))
        elif kind == "retry":
            parsed.append(BehaviorDecorator(type=kind, attempts=deepcopy(item["attempts"]), delay_seconds=deepcopy(item.get("delay_seconds", 0.0))))
        elif kind == "do_once":
            parsed.append(BehaviorDecorator(type=kind, reset_on_failure=deepcopy(item.get("reset_on_failure", False))))
        elif kind == "repeat":
            validate_value(
                item["count"],
                node_ids=node_ids,
                reference_schema=reference_schema,
                output_schemas=output_schemas,
                available_node_ids=available_node_ids,
                possibly_available_node_ids=possibly_available_node_ids,
                path=f"{path}.count",
                expected_schema={"type": "integer"},
            )
            parsed.append(BehaviorDecorator(type=kind, count=item["count"]))
        else:
            parsed.append(BehaviorDecorator(type=kind, count=int(item["count"])))
    return tuple(parsed)


def validate_instance_parallel_inputs(
    value: Any,
    *,
    reference_schema: dict[str, Any],
    path: str,
) -> None:
    """Only orchestration input bindings may cross an instance boundary."""

    if isinstance(value, dict):
        if "ref" in value:
            if not is_binding(value) or not str(value["ref"]).startswith("inputs."):
                raise ConfigError(f"{path} may only reference inputs.*")
            ref_schema(
                str(value["ref"]),
                node_ids=set(),
                reference_schema=reference_schema,
                output_schemas={},
                available_node_ids=set(),
                path=path,
            )
            return
        for key, child in value.items():
            validate_instance_parallel_inputs(child, reference_schema=reference_schema, path=f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            validate_instance_parallel_inputs(child, reference_schema=reference_schema, path=f"{path}[{index}]")


def validate_instance_workflow_reference(workflow_dir: Path, reference: str, path: str) -> None:
    try:
        resolve_workflow_path(workflow_dir, reference)
    except ConfigError as exc:
        raise ConfigError(f"{path} does not resolve to a workflow: {reference}") from exc


def validate_child_inputs(workflow_dir: Path, reference: str, inputs: dict[str, Any], path: str) -> None:
    child_path = resolve_workflow_path(workflow_dir, reference)
    try:
        child_raw = json.loads(child_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ConfigError(f"{path} cannot read child workflow: {reference}") from exc
    child_inputs = child_raw.get("inputs", {}) if isinstance(child_raw, dict) else {}
    if not isinstance(child_inputs, dict):
        child_inputs = {}
    undeclared = sorted(set(inputs) - set(child_inputs))
    if undeclared:
        raise ConfigError(f"{path} passes undeclared child inputs: {', '.join(undeclared)}")


def build_output_schemas(
    nodes_raw: list[Any],
    registry: ActionRegistry,
) -> tuple[dict[str, Any], dict[str, dict[str, Any] | None]]:
    """预取每个 task 节点的 Action 定义及其输出 schema。"""

    output_schemas: dict[str, dict[str, Any] | None] = {}
    action_specs: dict[str, Any] = {}
    for index, item in enumerate(nodes_raw):
        if item["type"] == "task":
            action = item.get("action")
            if not isinstance(action, str) or not action:
                raise ConfigError(f"nodes[{index}] task must define action")
            action_specs[item["id"]] = registry.get(action)
            output_schemas[item["id"]] = action_specs[item["id"]].output_schema
        else:
            output_schemas[item["id"]] = None
    return action_specs, output_schemas


def validate_graph_structure(
    parsed: list[WorkflowNode],
    raw: dict[str, Any],
    node_id_set: set[str],
) -> WorkflowNode:
    """校验父子关系、环与可达性，并返回根节点。"""

    node_map = {node.id: node for node in parsed}
    root = node_map[str(raw["root"])]
    if root.type != "root":
        raise ConfigError("workflow root must reference a node of type root")
    parent_counts = {node.id: 0 for node in parsed}
    for node in parsed:
        for child_id in node.children:
            if child_id not in node_map:
                raise ConfigError(f"node {node.id} references unknown child: {child_id}")
            parent_counts[child_id] += 1
        if node.type == "root" and len(node.children) != 1:
            raise ConfigError(f"root node {node.id} must contain exactly one child")
        if node.type in {"selector", "sequence"} and not node.children:
            raise ConfigError(f"{node.type} node {node.id} must contain at least one child")
        if node.type == "simple_parallel":
            if len(node.children) != 2:
                raise ConfigError(f"simple_parallel node {node.id} must contain exactly two children")
            elif node_map[node.children[0]].type != "task":
                raise ConfigError(f"simple_parallel node {node.id} requires a task as its first (main) child")
        if node.type == "switch":
            case_children = [child for _, child in node.cases]
            if any(child not in node_map for child in case_children):
                raise ConfigError(f"switch node {node.id} references an unknown case child")
            if node.default_child is not None and node.default_child not in node_map:
                raise ConfigError(f"switch node {node.id} references an unknown default child")
            expected_children = set(case_children)
            if node.default_child is not None:
                expected_children.add(node.default_child)
            if set(node.children) != expected_children:
                raise ConfigError(f"switch node {node.id} children must list every case/default child exactly once")
        if node.type == "instance_parallel":
            if node.children:
                raise ConfigError(f"instance_parallel node {node.id} cannot contain children")
            if not node.runs:
                raise ConfigError(f"instance_parallel node {node.id} must contain at least one run")
        if node.type == "task" and node.children:
            raise ConfigError(f"task node {node.id} cannot contain children")
    if parent_counts[root.id] != 0:
        raise ConfigError("root node cannot have a parent")
    for node in parsed:
        if node.type != "instance_parallel":
            continue
        if root.children != (node.id,) or parent_counts[node.id] != 1:
            raise ConfigError("instance_parallel must be the Root's only direct child")
    for node in parsed:
        if node.id != root.id and parent_counts[node.id] != 1:
            raise ConfigError(f"node {node.id} must have exactly one parent (found {parent_counts[node.id]})")

    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node_id: str) -> None:
        if node_id in visiting:
            raise ConfigError(f"workflow contains a cycle at node {node_id}")
        if node_id in visited:
            return
        visiting.add(node_id)
        for child_id in node_map[node_id].children:
            visit(child_id)
        visiting.remove(node_id)
        visited.add(node_id)

    visit(root.id)
    if visited != node_id_set:
        raise ConfigError(f"workflow contains unreachable nodes: {', '.join(sorted(node_id_set - visited))}")
    return root


__all__ = [
    "build_output_schemas",
    "parse_decorators",
    "validate_child_inputs",
    "validate_graph_structure",
    "validate_instance_parallel_inputs",
    "validate_instance_workflow_reference",
]
