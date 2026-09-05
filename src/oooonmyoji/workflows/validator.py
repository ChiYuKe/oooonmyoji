"""Schema, reference, and structural validation for Behavior Tree v3 files."""

from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
from typing import Any

from ..actions import ActionRegistry
from ..actions.manifest import ParameterDefinition, apply_parameter_defaults, compile_parameters
from ..config.loader import _validate_json_schema, resolve_workflow_path
from ..exceptions import ConfigError
from .model import (
    DECORATOR_TYPES,
    INSTANCE_PARALLEL_WAIT_MODES,
    InstanceParallelRun,
    NODE_TYPES,
    PARALLEL_FINISH_MODES,
    BehaviorDecorator,
    WorkflowNode,
    WorkflowSpec,
)
from .resolver import is_binding

CONDITION_OPERATORS = {"exists", "eq", "ne", "gt", "gte", "lt", "lte", "contains", "and", "or", "not"}
RUNTIME_REFERENCE_SCHEMAS = {
    "runtime.repeat.index": {"type": "integer"},
    "runtime.repeat.count": {"type": "integer"},
    "runtime.repeat.final": {"type": "boolean"},
}
OPTIONAL_DECORATOR_FIELDS = {"retry": {"delay_seconds"}, "do_once": {"reset_on_failure"}}
_BINDING_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["ref"],
    "properties": {"ref": {"type": "string", "minLength": 1}},
    "additionalProperties": False,
}

WORKFLOW_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "required": ["schema_version", "id", "version", "resolution", "root", "nodes"],
    "properties": {
        "schema_version": {"const": 3},
        "id": {"type": "string", "minLength": 1},
        "version": {"type": "string", "minLength": 1},
        "description": {"type": "string"},
        "resolution": {
            "type": "array",
            "prefixItems": [
                {"type": "integer", "minimum": 1},
                {"type": "integer", "minimum": 1},
            ],
            "minItems": 2,
            "maxItems": 2,
        },
        "root": {"type": "string", "minLength": 1},
        "blackboard": {"type": "object"},
        "retry_safe": {"type": "boolean"},
        "limits": {
            "type": "object",
            "properties": {
                "timeout_seconds": {"type": "number", "exclusiveMinimum": 0},
                "max_steps": {"type": "integer", "minimum": 1},
            },
            "additionalProperties": False,
        },
        "nodes": {
            "type": "array",
            "minItems": 2,
            "items": {
                "type": "object",
                "required": ["id", "type"],
                "properties": {
                    "id": {"type": "string", "minLength": 1},
                    "type": {"enum": list(NODE_TYPES)},
                    "name": {"type": "string", "minLength": 1},
                    "action": {"type": "string", "minLength": 1},
                    "params": {"type": "object"},
                    "children": {
                        "type": "array",
                        "items": {"type": "string", "minLength": 1},
                        "uniqueItems": True,
                    },
                    "decorators": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["type"],
                            "properties": {
                                "type": {"enum": list(DECORATOR_TYPES)},
                                "expression": {},
                                "seconds": {"type": "number", "exclusiveMinimum": 0},
                                "attempts": {"type": "integer", "minimum": 1},
                                "delay_seconds": {"type": "number", "minimum": 0},
                                "count": {
                                    "anyOf": [
                                        {"type": "integer", "minimum": 1},
                                        deepcopy(_BINDING_SCHEMA),
                                    ]
                                },
                                "reset_on_failure": {"type": "boolean"},
                            },
                            "additionalProperties": False,
                        },
                    },
                    "finish_mode": {"enum": list(PARALLEL_FINISH_MODES)},
                    "runs": {
                        "type": "array",
                        "minItems": 1,
                        "items": {
                            "type": "object",
                            "required": ["instance", "workflow"],
                            "properties": {
                                "instance": {"type": "string", "minLength": 1},
                                "workflow": {"type": "string", "minLength": 1},
                                "inputs": {"type": "object"},
                            },
                            "additionalProperties": False,
                        },
                    },
                    "wait_for": {"enum": list(INSTANCE_PARALLEL_WAIT_MODES)},
                    "cancel_on_failure": {"type": "boolean"},
                    "condition": {},
                    "conditions": {"type": "array"},
                    "max_iterations": {"type": "integer", "minimum": 1},
                    "expression": {},
                    "cases": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": ["value", "child"],
                            "properties": {"value": {}, "child": {"type": "string", "minLength": 1}},
                            "additionalProperties": False,
                        },
                    },
                    "default_child": {"type": "string", "minLength": 1},
                },
                "additionalProperties": False,
            },
        },
    },
    "patternProperties": {"^_": {}},
    "additionalProperties": False,
}


def _schema_at_path(schema: dict[str, Any], segments: list[str]) -> dict[str, Any] | None:
    current = schema
    for segment in segments:
        if not current:
            return {}
        if current.get("type") == "object":
            properties = current.get("properties")
            if isinstance(properties, dict) and isinstance(properties.get(segment), dict):
                current = properties[segment]
                continue
            additional = current.get("additionalProperties", True)
            if additional is False:
                return None
            current = additional if isinstance(additional, dict) else {}
            continue
        if current.get("type") == "array":
            try:
                index = int(segment)
            except ValueError:
                return None
            prefix = current.get("prefixItems")
            if isinstance(prefix, list) and index < len(prefix) and isinstance(prefix[index], dict):
                current = prefix[index]
                continue
            items = current.get("items")
            if items is False:
                return None
            current = items if isinstance(items, dict) else {}
            continue
        return None
    return current


def _schema_types(schema: dict[str, Any] | None) -> set[str]:
    if not schema:
        return set()
    value = schema.get("type")
    if isinstance(value, str):
        return {value}
    if isinstance(value, list):
        return {item for item in value if isinstance(item, str)}
    return set()


def _binding_types_compatible(expected: dict[str, Any] | None, actual: dict[str, Any]) -> bool:
    expected_types = _schema_types(expected)
    actual_types = _schema_types(actual)
    if not expected_types or not actual_types:
        return True
    if "number" in expected_types and "integer" in actual_types:
        actual_types = (actual_types - {"integer"}) | {"number"}
    return bool(expected_types & actual_types)


def _guaranteed_output_node_ids(
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
        return _guaranteed_output_node_ids(str(children[0]), node_map, nested)
    if node_type == "sequence":
        result: set[str] = set()
        for child in children:
            result.update(_guaranteed_output_node_ids(str(child), node_map, nested))
        return result
    if node_type == "selector" and len(children) == 1:
        return _guaranteed_output_node_ids(str(children[0]), node_map, nested)
    if node_type == "simple_parallel" and len(children) == 2:
        # A successful parallel node guarantees only that its main task
        # succeeded. The background branch may fail, still run, or be aborted.
        return _guaranteed_output_node_ids(str(children[0]), node_map, nested)
    if node_type in {"parallel", "repeat_until", "branch", "switch"}:
        return set()
    return set()


def _available_output_node_ids(
    nodes: list[dict[str, Any]],
    target_node_id: str,
) -> set[str]:
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
                result.update(_guaranteed_output_node_ids(str(sibling), node_map))
        current = str(parent["id"])
    return result


def _possible_output_node_ids_in_subtree(
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
        result.update(_possible_output_node_ids_in_subtree(str(child), node_map, nested))
    return result


def _possibly_available_output_node_ids(
    nodes: list[dict[str, Any]],
    target_node_id: str,
) -> set[str]:
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
    result = _available_output_node_ids(nodes, target_node_id)
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
                result.update(_possible_output_node_ids_in_subtree(str(sibling), node_map))
        current = str(parent["id"])
    return result


def _ref_schema(
    value: str,
    *,
    node_ids: set[str],
    blackboard_schema: dict[str, Any],
    output_schemas: dict[str, dict[str, Any] | None],
    available_node_ids: set[str],
    path: str,
) -> dict[str, Any]:
    parts = value.split(".")
    runtime_schema = RUNTIME_REFERENCE_SCHEMAS.get(value)
    if runtime_schema is not None:
        return runtime_schema
    if len(parts) >= 2 and parts[0] == "blackboard" and all(parts[1:]):
        resolved = _schema_at_path(blackboard_schema, parts[1:])
        if resolved is not None:
            return resolved
        raise ConfigError(f"{path} references an unknown blackboard key: {value}")
    if len(parts) >= 4 and parts[0] == "nodes" and parts[2] == "output" and parts[1] in node_ids and all(parts[3:]):
        if parts[1] not in available_node_ids:
            raise ConfigError(f"{path} references a node output unavailable at this execution point: {value}")
        output_schema = output_schemas.get(parts[1])
        if output_schema is None:
            raise ConfigError(f"{path} references a node without output: {value}")
        resolved = _schema_at_path(output_schema, parts[3:])
        if resolved is not None:
            return resolved
        raise ConfigError(f"{path} references an unknown Action output: {value}")
    raise ConfigError(f"{path} has invalid structured reference: {value}")


def _schema_child(schema: dict[str, Any] | None, key: str | int) -> dict[str, Any] | None:
    if not schema:
        return None
    if isinstance(key, str) and schema.get("type") == "object":
        properties = schema.get("properties")
        if isinstance(properties, dict) and isinstance(properties.get(key), dict):
            return properties[key]
    if isinstance(key, int) and schema.get("type") == "array":
        prefix = schema.get("prefixItems")
        if isinstance(prefix, list) and key < len(prefix) and isinstance(prefix[key], dict):
            return prefix[key]
        items = schema.get("items")
        return items if isinstance(items, dict) else None
    return None


def _validate_value(
    value: Any,
    *,
    node_ids: set[str],
    blackboard_schema: dict[str, Any],
    output_schemas: dict[str, dict[str, Any] | None],
    available_node_ids: set[str],
    possibly_available_node_ids: set[str],
    path: str,
    condition: bool = False,
    expected_schema: dict[str, Any] | None = None,
) -> None:
    if isinstance(value, dict):
        if "ref" in value:
            if not is_binding(value):
                raise ConfigError(f"{path} must contain only a string ref")
            actual = _ref_schema(
                value["ref"],
                node_ids=node_ids,
                blackboard_schema=blackboard_schema,
                output_schemas=output_schemas,
                available_node_ids=available_node_ids,
                path=path,
            )
            if not _binding_types_compatible(expected_schema, actual):
                raise ConfigError(f"{path} binding type is incompatible with its Action parameter: {value['ref']}")
            return
        if condition:
            if len(value) != 1 or next(iter(value)) not in CONDITION_OPERATORS:
                raise ConfigError(f"{path} must use exactly one supported condition operator")
            operator, operands = next(iter(value.items()))
            if operator in {"and", "or"}:
                if not isinstance(operands, list) or not operands:
                    raise ConfigError(f"{path}.{operator} must be a non-empty array")
                for index, operand in enumerate(operands):
                    _validate_value(operand, node_ids=node_ids, blackboard_schema=blackboard_schema, output_schemas=output_schemas, available_node_ids=available_node_ids, possibly_available_node_ids=possibly_available_node_ids, path=f"{path}.{operator}[{index}]", condition=True)
            elif operator == "not":
                _validate_value(operands, node_ids=node_ids, blackboard_schema=blackboard_schema, output_schemas=output_schemas, available_node_ids=available_node_ids, possibly_available_node_ids=possibly_available_node_ids, path=f"{path}.not", condition=True)
            elif operator == "exists":
                if not is_binding(operands):
                    raise ConfigError(f"{path}.exists must contain a structured reference")
                _validate_value(operands, node_ids=node_ids, blackboard_schema=blackboard_schema, output_schemas=output_schemas, available_node_ids=possibly_available_node_ids, possibly_available_node_ids=possibly_available_node_ids, path=f"{path}.exists")
            else:
                if not isinstance(operands, list) or len(operands) != 2:
                    raise ConfigError(f"{path}.{operator} must contain two operands")
                for index, operand in enumerate(operands):
                    _validate_value(operand, node_ids=node_ids, blackboard_schema=blackboard_schema, output_schemas=output_schemas, available_node_ids=available_node_ids, possibly_available_node_ids=possibly_available_node_ids, path=f"{path}.{operator}[{index}]")
            return
        for key, child in value.items():
            _validate_value(child, node_ids=node_ids, blackboard_schema=blackboard_schema, output_schemas=output_schemas, available_node_ids=available_node_ids, possibly_available_node_ids=possibly_available_node_ids, path=f"{path}.{key}", expected_schema=_schema_child(expected_schema, key))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _validate_value(child, node_ids=node_ids, blackboard_schema=blackboard_schema, output_schemas=output_schemas, available_node_ids=available_node_ids, possibly_available_node_ids=possibly_available_node_ids, path=f"{path}[{index}]", expected_schema=_schema_child(expected_schema, index))
    elif condition and not isinstance(value, bool):
        raise ConfigError(f"{path} must be a boolean or condition object")


def _allow_binding(schema: dict[str, Any]) -> dict[str, Any]:
    literal = deepcopy(schema)
    properties = literal.get("properties")
    if isinstance(properties, dict):
        literal["properties"] = {name: _allow_binding(child) if isinstance(child, dict) else child for name, child in properties.items()}
    items = literal.get("items")
    if isinstance(items, dict):
        literal["items"] = _allow_binding(items)
    prefix = literal.get("prefixItems")
    if isinstance(prefix, list):
        literal["prefixItems"] = [_allow_binding(child) if isinstance(child, dict) else child for child in prefix]
    return {"anyOf": [literal, deepcopy(_BINDING_SCHEMA)]}


def _binding_aware_parameter_schema(schema: dict[str, Any]) -> dict[str, Any]:
    result = deepcopy(schema)
    properties = result.get("properties")
    if isinstance(properties, dict):
        result["properties"] = {name: _allow_binding(child) if isinstance(child, dict) else child for name, child in properties.items()}
    return result


def _parse_decorators(
    raw: list[Any],
    *,
    node_index: int,
    node_ids: set[str],
    blackboard_schema: dict[str, Any],
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
        if kind == "condition":
            _validate_value(item["expression"], node_ids=node_ids, blackboard_schema=blackboard_schema, output_schemas=output_schemas, available_node_ids=available_node_ids, possibly_available_node_ids=possibly_available_node_ids, path=f"{path}.expression", condition=True)
            parsed.append(BehaviorDecorator(type=kind, expression=item["expression"]))
        elif kind in {"cooldown", "timeout"}:
            parsed.append(BehaviorDecorator(type=kind, seconds=float(item["seconds"])))
        elif kind == "retry":
            parsed.append(BehaviorDecorator(type=kind, attempts=int(item["attempts"]), delay_seconds=float(item.get("delay_seconds", 0.0))))
        elif kind == "do_once":
            parsed.append(BehaviorDecorator(type=kind, reset_on_failure=bool(item.get("reset_on_failure", False))))
        elif kind == "repeat":
            _validate_value(
                item["count"],
                node_ids=node_ids,
                blackboard_schema=blackboard_schema,
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


def _validate_instance_parallel_inputs(
    value: Any,
    *,
    blackboard_schema: dict[str, Any],
    path: str,
) -> None:
    """Only orchestration blackboard bindings may cross an instance boundary."""

    if isinstance(value, dict):
        if "ref" in value:
            if not is_binding(value) or not str(value["ref"]).startswith("blackboard."):
                raise ConfigError(f"{path} may only reference blackboard.*")
            _ref_schema(
                str(value["ref"]),
                node_ids=set(),
                blackboard_schema=blackboard_schema,
                output_schemas={},
                available_node_ids=set(),
                path=path,
            )
            return
        for key, child in value.items():
            _validate_instance_parallel_inputs(child, blackboard_schema=blackboard_schema, path=f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _validate_instance_parallel_inputs(child, blackboard_schema=blackboard_schema, path=f"{path}[{index}]")


def _validate_instance_workflow_reference(workflow_dir: Path, reference: str, path: str) -> None:
    try:
        resolve_workflow_path(workflow_dir, reference)
    except ConfigError as exc:
        raise ConfigError(f"{path} does not resolve to a workflow: {reference}") from exc


def _validate_public_child_inputs(workflow_dir: Path, reference: str, inputs: dict[str, Any], path: str) -> None:
    child_path = resolve_workflow_path(workflow_dir, reference)
    try:
        child_raw = json.loads(child_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ConfigError(f"{path} cannot read child workflow: {reference}") from exc
    blackboard = child_raw.get("blackboard", {}) if isinstance(child_raw, dict) else {}
    if not isinstance(blackboard, dict):
        blackboard = {}
    public = {
        name
        for name, definition in blackboard.items()
        if isinstance(definition, dict)
        and definition.get("public", True) is not False
    }
    hidden = sorted(set(inputs) - public)
    if hidden:
        raise ConfigError(f"{path} passes private or unknown child inputs: {', '.join(hidden)}")


def validate_workflow(
    raw: dict[str, Any],
    path: Path,
    registry: ActionRegistry,
    *,
    project_root: Path,
    workflow_dir: Path | None = None,
) -> WorkflowSpec:
    _validate_json_schema(raw, WORKFLOW_SCHEMA, f"workflow {path}")

    blackboard_raw = raw.get("blackboard", {})
    assert isinstance(blackboard_raw, dict)
    for name, definition in blackboard_raw.items():
        if isinstance(definition, dict) and "public" in definition and not isinstance(definition["public"], bool):
            raise ConfigError(f"blackboard.{name}.public must be a boolean")
    blackboard_schema = compile_parameters({name: ParameterDefinition.parse(name, value) for name, value in blackboard_raw.items()})

    nodes_raw = raw["nodes"]
    assert isinstance(nodes_raw, list)
    node_ids = [str(item["id"]) for item in nodes_raw]
    if len(node_ids) != len(set(node_ids)):
        raise ConfigError(f"workflow {path} contains duplicate node IDs")
    node_id_set = set(node_ids)
    if raw["root"] not in node_id_set:
        raise ConfigError(f"workflow {path} root does not name a node: {raw['root']}")

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

    parsed: list[WorkflowNode] = []
    for index, item in enumerate(nodes_raw):
        node_type = str(item["type"])
        available_node_ids = _available_output_node_ids(nodes_raw, str(item["id"]))
        possibly_available_node_ids = _possibly_available_output_node_ids(nodes_raw, str(item["id"]))
        children_raw = item.get("children", [])
        decorators_raw = item.get("decorators", [])
        assert isinstance(children_raw, list) and isinstance(decorators_raw, list)
        if node_type == "task":
            forbidden = set(item) & {"children", "finish_mode"}
            if forbidden:
                raise ConfigError(f"nodes[{index}] task cannot define {sorted(forbidden)}")
            params = item.get("params", {})
            assert isinstance(params, dict)
            spec = action_specs[item["id"]]
            _validate_value(params, node_ids=node_id_set, blackboard_schema=blackboard_schema, output_schemas=output_schemas, available_node_ids=available_node_ids, possibly_available_node_ids=possibly_available_node_ids, path=f"nodes[{index}].params", expected_schema=spec.input_schema)
            normalized = apply_parameter_defaults(spec.definition.parameters, params)
            _validate_json_schema(normalized, _binding_aware_parameter_schema(spec.input_schema), f"nodes[{index}].params")
            action = str(item["action"])
        elif node_type == "instance_parallel":
            forbidden = set(item) & {"action", "params", "children", "finish_mode"}
            if forbidden:
                raise ConfigError(f"nodes[{index}] instance_parallel cannot define {sorted(forbidden)}")
            if decorators_raw:
                raise ConfigError(f"nodes[{index}] instance_parallel cannot have decorators")
            runs_raw = item.get("runs")
            if not isinstance(runs_raw, list) or not runs_raw:
                raise ConfigError(f"nodes[{index}] instance_parallel must define at least one run")
            seen_instances: set[str] = set()
            default_workflow_dir = project_root / "workflows"
            base_workflow_dir = Path(workflow_dir or (default_workflow_dir if default_workflow_dir.is_dir() else path.parent)).resolve()
            for run_index, run_value in enumerate(runs_raw):
                if not isinstance(run_value, dict):
                    raise ConfigError(f"nodes[{index}].runs[{run_index}] must be an object")
                instance_value = run_value.get("instance")
                workflow_value = run_value.get("workflow")
                if not isinstance(instance_value, str) or not instance_value.strip():
                    raise ConfigError(f"nodes[{index}].runs[{run_index}].instance must be a non-empty string")
                if instance_value in seen_instances:
                    raise ConfigError(f"nodes[{index}] instance_parallel cannot run instance more than once: {instance_value}")
                seen_instances.add(instance_value)
                if not isinstance(workflow_value, str) or not workflow_value.strip():
                    raise ConfigError(f"nodes[{index}].runs[{run_index}].workflow must be a non-empty string")
                _validate_instance_workflow_reference(base_workflow_dir, workflow_value, f"nodes[{index}].runs[{run_index}].workflow")
                run_inputs = run_value.get("inputs", {})
                if not isinstance(run_inputs, dict):
                    raise ConfigError(f"nodes[{index}].runs[{run_index}].inputs must be an object")
                _validate_instance_parallel_inputs(run_inputs, blackboard_schema=blackboard_schema, path=f"nodes[{index}].runs[{run_index}].inputs")
                _validate_public_child_inputs(
                    base_workflow_dir,
                    workflow_value,
                    run_inputs,
                    f"nodes[{index}].runs[{run_index}].inputs",
                )
            wait_for = item.get("wait_for", "all")
            if wait_for not in INSTANCE_PARALLEL_WAIT_MODES:
                raise ConfigError(f"nodes[{index}].wait_for must be one of {INSTANCE_PARALLEL_WAIT_MODES}")
            cancel_on_failure = item.get("cancel_on_failure", True)
            if not isinstance(cancel_on_failure, bool):
                raise ConfigError(f"nodes[{index}].cancel_on_failure must be a boolean")
            params = {}
            action = None
        else:
            forbidden = set(item) & {"action", "params"}
            if forbidden:
                raise ConfigError(f"nodes[{index}] {node_type} cannot define {sorted(forbidden)}")
            params = {}
            action = None
        if node_type == "repeat_until":
            if len(children_raw) != 1:
                raise ConfigError(f"nodes[{index}] repeat_until must contain exactly one child")
            if "condition" not in item:
                raise ConfigError(f"nodes[{index}] repeat_until requires condition")
            # The body has completed before repeat_until evaluates its exit
            # condition, so outputs produced inside that body are valid here.
            # Keep the stricter execution-point rule for all other bindings.
            node_map_for_repeat = {str(node["id"]): node for node in nodes_raw}
            body_outputs = _possible_output_node_ids_in_subtree(str(children_raw[0]), node_map_for_repeat)
            repeat_condition_outputs = possibly_available_node_ids | body_outputs
            _validate_value(item["condition"], node_ids=node_id_set, blackboard_schema=blackboard_schema, output_schemas=output_schemas, available_node_ids=repeat_condition_outputs, possibly_available_node_ids=repeat_condition_outputs, path=f"nodes[{index}].condition", condition=True)
            max_iterations = item.get("max_iterations", 100)
            if isinstance(max_iterations, bool) or not isinstance(max_iterations, int) or max_iterations < 1:
                raise ConfigError(f"nodes[{index}].max_iterations must be a positive integer")
        elif node_type == "branch":
            if not children_raw:
                raise ConfigError(f"nodes[{index}] branch must contain at least one child")
            conditions = item.get("conditions")
            if not isinstance(conditions, list) or len(conditions) != len(children_raw):
                raise ConfigError(f"nodes[{index}].conditions must match branch children")
            for condition_index, condition_value in enumerate(conditions):
                _validate_value(condition_value, node_ids=node_id_set, blackboard_schema=blackboard_schema, output_schemas=output_schemas, available_node_ids=available_node_ids, possibly_available_node_ids=possibly_available_node_ids, path=f"nodes[{index}].conditions[{condition_index}]", condition=True)
        elif node_type == "switch":
            if "expression" not in item:
                raise ConfigError(f"nodes[{index}] switch requires expression")
            cases = item.get("cases")
            if not isinstance(cases, list) or not cases:
                raise ConfigError(f"nodes[{index}].cases must be a non-empty array")
            for case_index, case in enumerate(cases):
                if not isinstance(case, dict) or not isinstance(case.get("child"), str) or "value" not in case:
                    raise ConfigError(f"nodes[{index}].cases[{case_index}] must define value and child")
        elif node_type == "parallel":
            if len(children_raw) < 2:
                raise ConfigError(f"nodes[{index}] parallel must contain at least two children")
            wait_for = item.get("wait_for", "all")
            if wait_for not in {"all", "any"}:
                raise ConfigError(f"nodes[{index}].wait_for must be all or any")
            if not isinstance(item.get("cancel_on_failure", True), bool):
                raise ConfigError(f"nodes[{index}].cancel_on_failure must be a boolean")
        if node_type != "simple_parallel" and "finish_mode" in item:
            raise ConfigError(f"nodes[{index}].finish_mode is only valid for simple_parallel")
        if node_type != "instance_parallel" and any(field in item for field in ("runs", "wait_for", "cancel_on_failure")):
            if node_type != "parallel":
                raise ConfigError(f"nodes[{index}] instance_parallel fields are only valid for instance_parallel")
        node_fields = {"condition", "max_iterations", "conditions", "expression", "cases", "default_child"}
        allowed_fields = {
            "repeat_until": {"condition", "max_iterations"},
            "branch": {"conditions"},
            "switch": {"expression", "cases", "default_child"},
        }.get(node_type, set())
        invalid_fields = (set(item) & node_fields) - allowed_fields
        if invalid_fields:
            raise ConfigError(f"nodes[{index}] fields {sorted(invalid_fields)} are not valid for {node_type}")
        decorators = _parse_decorators(decorators_raw, node_index=index, node_ids=node_id_set, blackboard_schema=blackboard_schema, output_schemas=output_schemas, available_node_ids=available_node_ids, possibly_available_node_ids=possibly_available_node_ids)
        if node_type == "root" and decorators:
            raise ConfigError(f"nodes[{index}] root cannot have decorators")
        retry = next((decorator for decorator in decorators if decorator.type == "retry"), None)
        if retry is not None and retry.attempts > 1 and node_type == "task" and not action_specs[item["id"]].definition.retry_safe and not raw.get("retry_safe", False):
            raise ConfigError(f"nodes[{index}] retries an Action that is not declared retry-safe")
        instance_runs = tuple(
            InstanceParallelRun(
                instance=str(run_value["instance"]),
                workflow=str(run_value["workflow"]),
                inputs=deepcopy(run_value.get("inputs", {})),
            )
            for run_value in item.get("runs", [])
        ) if node_type == "instance_parallel" else ()
        parsed.append(WorkflowNode(
            id=str(item["id"]),
            type=node_type,
            name=item.get("name") if isinstance(item.get("name"), str) else None,
            action=action,
            params=params,
            children=tuple(str(child) for child in children_raw),
            decorators=decorators,
            finish_mode=str(item.get("finish_mode", "abort_background")),
            runs=instance_runs,
            wait_for=str(item.get("wait_for", "all")),
            cancel_on_failure=bool(item.get("cancel_on_failure", True)),
            condition=deepcopy(item.get("condition")),
            conditions=tuple(deepcopy(item.get("conditions", []))),
            max_iterations=int(item.get("max_iterations", 100)),
            expression=deepcopy(item.get("expression")),
            cases=tuple((deepcopy(case.get("value")), str(case["child"])) for case in item.get("cases", []) if isinstance(case, dict) and "child" in case),
            default_child=str(item["default_child"]) if isinstance(item.get("default_child"), str) else None,
        ))

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

    limits = raw.get("limits", {})
    assert isinstance(limits, dict)
    return WorkflowSpec(
        schema_version=3,
        workflow_id=str(raw["id"]),
        version=str(raw["version"]),
        description=str(raw.get("description", "")),
        resolution=(int(raw["resolution"][0]), int(raw["resolution"][1])),
        root=root.id,
        timeout_seconds=float(limits.get("timeout_seconds", 300.0)),
        max_steps=int(limits.get("max_steps", 1000)),
        blackboard_schema=blackboard_schema,
        nodes=tuple(parsed),
        path=path,
        file_hash="",
        raw=deepcopy(raw),
        retry_safe=bool(raw.get("retry_safe", False)),
    )


__all__ = ["CONDITION_OPERATORS", "WORKFLOW_SCHEMA", "validate_workflow"]
