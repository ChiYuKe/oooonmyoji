"""节点级语义规则：装饰器解析、实例并行运行项、输出 schema 预取与图结构校验。"""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

from ..actions import ActionRegistry
from ..config.loader import resolve_workflow_path
from ..exceptions import ConfigError
from .bindings import ref_schema, schema_at_path, validate_value
from .dsl import DslError, parse_document
from .model import BOOL_JUDGE_OUTPUT_SCHEMA, BehaviorDecorator, WorkflowNode
from .resolver import is_binding

OPTIONAL_DECORATOR_FIELDS = {"retry": {"delay_seconds"}, "do_once": {"reset_on_failure"}}

#: 拆分节点的输出 schema 依赖其 ref 指向的节点输出；当指向的节点还没推导出来时先挂起。
_DEFER = object()


def node_label(index: int, item: Any) -> str:
    """节点在错误信息里的标识：索引 + id，方便直接回画布上找到那个节点。

    ``nodes[1]`` 这种只报下标的写法在卡片编辑器里没法定位；带上 id 后是
    ``nodes[1] (task_1)``，和左侧结构树/节点标题对得上。
    """

    node_id = item.get("id") if isinstance(item, dict) else None
    if isinstance(node_id, str) and node_id:
        return f"nodes[{index}] ({node_id})"
    return f"nodes[{index}]"


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
            "cooldown": {"type", "seconds"},
            "timeout": {"type", "seconds"},
            "retry": {"type", "attempts", "delay_seconds"},
            "repeat": {"type", "count"},
            "do_once": {"type", "reset_on_failure"},
        }.get(kind)
        if allowed is None:
            # schema 已经按 DECORATOR_TYPES 拦过一道；这里是防御性兜底（例如刚被删掉的 condition 装饰器）。
            raise ConfigError(f"{path}: unknown decorator type {kind}")
        extra = set(item) - allowed
        missing = allowed - set(item) - OPTIONAL_DECORATOR_FIELDS.get(kind, set())
        if extra or missing:
            details = f"unknown fields {sorted(extra)}" if extra else f"missing fields {sorted(missing)}"
            raise ConfigError(f"{path}: {details}")
        if kind in seen_singletons:
            raise ConfigError(f"nodes[{node_index}] contains duplicate {kind} decorators")
        seen_singletons.add(kind)
        for key, expected_type in {"seconds": "number", "attempts": "integer", "delay_seconds": "number", "reset_on_failure": "boolean"}.items():
            if key in item:
                validate_value(item[key], node_ids=node_ids, reference_schema=reference_schema, output_schemas=output_schemas,
                              available_node_ids=available_node_ids, possibly_available_node_ids=possibly_available_node_ids,
                              path=f"{path}.{key}", expected_schema={"type": expected_type})
        if kind in {"cooldown", "timeout"}:
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
        child_raw = parse_document(child_path.read_text(encoding="utf-8"), path=child_path.name)
    except DslError as exc:
        raise ConfigError(f"{path} cannot read child workflow: {reference}\n{exc.render()}") from exc
    except (OSError, UnicodeDecodeError) as exc:
        raise ConfigError(f"{path} cannot read child workflow: {reference}") from exc
    child_inputs = child_raw.get("inputs", {})
    if not isinstance(child_inputs, dict):
        child_inputs = {}
    undeclared = sorted(set(inputs) - set(child_inputs))
    if undeclared:
        raise ConfigError(f"{path} passes undeclared child inputs: {', '.join(undeclared)}")


def _break_output_schema(
    item: dict[str, Any],
    output_schemas: dict[str, dict[str, Any] | None],
    reference_schema: dict[str, Any] | None = None,
) -> dict[str, Any] | None | object:
    """推导拆分节点（`break`）的输出 schema。

    - 未声明 `fields`：镜像 ref 指向的输出 schema（对象/数组/定长元组），字段同名可引用；
    - 声明了 `fields`（输出名 → 源内路径）：每个输出名按路径在目标 schema 里取子 schema，
      打包成一个带 `required` 的 object schema；
    - ref 非法或指向不产生输出的节点：返回 ``None``（让校验节点本身报根因）；
    - ref 指向的节点输出还没推导出来（例如指向另一个拆分节点）：返回 ``_DEFER`` 挂起，
      等依赖轮次收敛。
    """

    ref = item.get("ref")
    if not isinstance(ref, dict) or not isinstance(ref.get("ref"), str):
        return None
    ref_text = str(ref["ref"])
    parts = ref_text.split(".")
    if len(parts) >= 3 and parts[0] == "nodes" and parts[2] == "output" and parts[1] in output_schemas and all(parts[1:]):
        source = output_schemas.get(parts[1])
        if source is None:
            return _DEFER
        base = schema_at_path(source, parts[3:])
    else:
        # inputs / variables / runtime 等来源：按已编译的引用 schema 解析（例如
        # `inputs.识别区域` 是 rect 四元组，能拆成 0..3 四个分量）。
        base = schema_at_path(reference_schema, parts) if reference_schema is not None else {}
        if base is None:
            base = {}
    fields = item.get("fields")
    if not isinstance(fields, dict) or not fields:
        return base
    properties: dict[str, Any] = {}
    required: list[str] = []
    for name, path in fields.items():
        if not isinstance(name, str) or not name or not isinstance(path, str) or not path:
            continue  # 非法条目由 validator 报错，这里只推导合法部分
        resolved = schema_at_path(base, path.split(".")) if base is not None else None
        properties[name] = resolved or {}
        required.append(name)
    return {"type": "object", "properties": properties, "required": required, "additionalProperties": False}


def build_output_schemas(
    nodes_raw: list[Any],
    registry: ActionRegistry,
    reference_schema: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, dict[str, Any] | None]]:
    """预取每个 task 节点的 Action 定义及其输出 schema；值卡片（布尔判断/拆分）自带输出。"""

    output_schemas: dict[str, dict[str, Any] | None] = {}
    action_specs: dict[str, Any] = {}
    for index, item in enumerate(nodes_raw):
        if item["type"] == "task":
            action = item.get("action")
            if not isinstance(action, str) or not action:
                raise ConfigError(f"{node_label(index, item)} task must define action")
            action_specs[item["id"]] = registry.get(action)
            output_schemas[item["id"]] = action_specs[item["id"]].output_schema
        elif item["type"] == "bool_judge":
            output_schemas[item["id"]] = BOOL_JUDGE_OUTPUT_SCHEMA
        else:
            output_schemas[item["id"]] = None
    # 拆分节点互相可作来源：逐轮推导直到收敛（指向非法/未产出节点的保持 None，交给校验报根因）。
    pending = [item for item in nodes_raw if item["type"] == "break"]
    while pending:
        progressed = False
        for item in list(pending):
            derived = _break_output_schema(item, output_schemas, reference_schema)
            if derived is _DEFER or not isinstance(derived, dict):
                continue
            output_schemas[item["id"]] = derived
            pending.remove(item)
            progressed = True
        if not progressed:
            break
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
    # Pure data nodes are not part of the execution tree. They may be referenced by
    # value pins and are evaluated lazily when an output reference is read.
    pure_node_ids = {node.id for node in parsed if node.type in {"bool_judge", "break"}}
    for node in parsed:
        for child_id in node.children:
            if child_id not in node_map:
                raise ConfigError(f"node {node.id} references unknown child: {child_id}")
            if child_id in pure_node_ids:
                raise ConfigError(f"pure data node {child_id} cannot be connected to an execution child pin")
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
        if node.type == "condition" and len(node.children) > 2:
            raise ConfigError(f"condition node {node.id} accepts at most two branches")
    if parent_counts[root.id] != 0:
        raise ConfigError("root node cannot have a parent")
    for node in parsed:
        if node.type != "instance_parallel":
            continue
        if root.children != (node.id,) or parent_counts[node.id] != 1:
            raise ConfigError("instance_parallel must be the Root's only direct child")
    for node in parsed:
        if node.id != root.id and node.id not in pure_node_ids and parent_counts[node.id] != 1:
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
    unreachable = node_id_set - visited - pure_node_ids
    if unreachable:
        raise ConfigError(f"workflow contains unreachable nodes: {', '.join(sorted(unreachable))}")
    return root


__all__ = [
    "build_output_schemas",
    "parse_decorators",
    "validate_child_inputs",
    "validate_graph_structure",
    "validate_instance_parallel_inputs",
    "validate_instance_workflow_reference",
]
