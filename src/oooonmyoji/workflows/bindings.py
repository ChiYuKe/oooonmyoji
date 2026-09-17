"""绑定（ref）解析与类型校验：inputs / variables / nodes.<id>.output / runtime 引用。"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from ..exceptions import ConfigError
from .resolver import is_binding
from .schema import BINDING_SCHEMA

CONDITION_OPERATORS = {"exists", "eq", "ne", "gt", "gte", "lt", "lte", "contains", "and", "or", "not"}
RUNTIME_REFERENCE_SCHEMAS = {
    "runtime.repeat.index": {"type": "integer"},
    "runtime.repeat.count": {"type": "integer"},
    "runtime.repeat.final": {"type": "boolean"},
}


def schema_at_path(schema: dict[str, Any], segments: list[str]) -> dict[str, Any] | None:
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


def schema_types(schema: dict[str, Any] | None) -> set[str]:
    if not schema:
        return set()
    value = schema.get("type")
    if isinstance(value, str):
        return {value}
    if isinstance(value, list):
        return {item for item in value if isinstance(item, str)}
    return set()


def binding_types_compatible(expected: dict[str, Any] | None, actual: dict[str, Any]) -> bool:
    expected_types = schema_types(expected)
    actual_types = schema_types(actual)
    if not expected_types or not actual_types:
        return True
    if "number" in expected_types and "integer" in actual_types:
        actual_types = (actual_types - {"integer"}) | {"number"}
    return bool(expected_types & actual_types)


def ref_schema(
    value: str,
    *,
    node_ids: set[str],
    reference_schema: dict[str, Any],
    output_schemas: dict[str, dict[str, Any] | None],
    available_node_ids: set[str],
    path: str,
) -> dict[str, Any]:
    parts = value.split(".")
    runtime_schema = RUNTIME_REFERENCE_SCHEMAS.get(value)
    if runtime_schema is not None:
        return runtime_schema
    if len(parts) >= 2 and parts[0] in {"inputs", "variables"} and all(parts[1:]):
        resolved = schema_at_path(reference_schema, parts)
        if resolved is not None:
            return resolved
        raise ConfigError(f"{path} references an unknown {parts[0]} key: {value}")
    if len(parts) >= 4 and parts[0] == "nodes" and parts[2] == "output" and parts[1] in node_ids and all(parts[3:]):
        if parts[1] not in available_node_ids:
            raise ConfigError(f"{path} references a node output unavailable at this execution point: {value}")
        output_schema = output_schemas.get(parts[1])
        if output_schema is None:
            raise ConfigError(f"{path} references a node without output: {value}")
        resolved = schema_at_path(output_schema, parts[3:])
        if resolved is not None:
            return resolved
        raise ConfigError(f"{path} references an unknown Action output: {value}")
    raise ConfigError(f"{path} has invalid structured reference: {value}")


def schema_child(schema: dict[str, Any] | None, key: str | int) -> dict[str, Any] | None:
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


def validate_value(
    value: Any,
    *,
    node_ids: set[str],
    reference_schema: dict[str, Any],
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
            actual = ref_schema(
                value["ref"],
                node_ids=node_ids,
                reference_schema=reference_schema,
                output_schemas=output_schemas,
                available_node_ids=available_node_ids,
                path=path,
            )
            if not binding_types_compatible(expected_schema, actual):
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
                    validate_value(operand, node_ids=node_ids, reference_schema=reference_schema, output_schemas=output_schemas, available_node_ids=available_node_ids, possibly_available_node_ids=possibly_available_node_ids, path=f"{path}.{operator}[{index}]", condition=True)
            elif operator == "not":
                validate_value(operands, node_ids=node_ids, reference_schema=reference_schema, output_schemas=output_schemas, available_node_ids=available_node_ids, possibly_available_node_ids=possibly_available_node_ids, path=f"{path}.not", condition=True)
            elif operator == "exists":
                if not is_binding(operands):
                    raise ConfigError(f"{path}.exists must contain a structured reference")
                validate_value(operands, node_ids=node_ids, reference_schema=reference_schema, output_schemas=output_schemas, available_node_ids=possibly_available_node_ids, possibly_available_node_ids=possibly_available_node_ids, path=f"{path}.exists")
            else:
                if not isinstance(operands, list) or len(operands) != 2:
                    raise ConfigError(f"{path}.{operator} must contain two operands")
                for index, operand in enumerate(operands):
                    validate_value(operand, node_ids=node_ids, reference_schema=reference_schema, output_schemas=output_schemas, available_node_ids=available_node_ids, possibly_available_node_ids=possibly_available_node_ids, path=f"{path}.{operator}[{index}]")
            return
        for key, child in value.items():
            validate_value(child, node_ids=node_ids, reference_schema=reference_schema, output_schemas=output_schemas, available_node_ids=available_node_ids, possibly_available_node_ids=possibly_available_node_ids, path=f"{path}.{key}", expected_schema=schema_child(expected_schema, key))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            validate_value(child, node_ids=node_ids, reference_schema=reference_schema, output_schemas=output_schemas, available_node_ids=available_node_ids, possibly_available_node_ids=possibly_available_node_ids, path=f"{path}[{index}]", expected_schema=schema_child(expected_schema, index))
    elif condition and not isinstance(value, bool):
        raise ConfigError(f"{path} must be a boolean or condition object")


def allow_binding(schema: dict[str, Any]) -> dict[str, Any]:
    literal = deepcopy(schema)
    properties = literal.get("properties")
    if isinstance(properties, dict):
        literal["properties"] = {name: allow_binding(child) if isinstance(child, dict) else child for name, child in properties.items()}
    items = literal.get("items")
    if isinstance(items, dict):
        literal["items"] = allow_binding(items)
    prefix = literal.get("prefixItems")
    if isinstance(prefix, list):
        literal["prefixItems"] = [allow_binding(child) if isinstance(child, dict) else child for child in prefix]
    return {"anyOf": [literal, deepcopy(BINDING_SCHEMA)]}


def binding_aware_parameter_schema(schema: dict[str, Any]) -> dict[str, Any]:
    result = deepcopy(schema)
    properties = result.get("properties")
    if isinstance(properties, dict):
        result["properties"] = {name: allow_binding(child) if isinstance(child, dict) else child for name, child in properties.items()}
    return result


__all__ = [
    "CONDITION_OPERATORS",
    "RUNTIME_REFERENCE_SCHEMAS",
    "allow_binding",
    "binding_aware_parameter_schema",
    "binding_types_compatible",
    "ref_schema",
    "schema_at_path",
    "schema_child",
    "schema_types",
    "validate_value",
]
