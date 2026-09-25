"""顶层 inputs/variables 定义与局部变量作用域校验。"""

from __future__ import annotations

from typing import Any

from ..actions.manifest import ParameterDefinition, apply_parameter_defaults, compile_parameters
from ..exceptions import ConfigError
from .bindings import validate_value


def validate_scope_definitions(
    raw: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any], dict[str, Any]]:
    """校验顶层 inputs/variables 定义并编译 schema。

    返回 ``(input_schema, variable_schema, reference_schema, variable_defaults, variables_raw)``。
    """

    inputs_raw = raw.get("inputs", {})
    variables_raw = raw.get("variables", {})
    assert isinstance(inputs_raw, dict) and isinstance(variables_raw, dict)
    for scope, definitions in (("inputs", inputs_raw), ("variables", variables_raw)):
        for name, definition in definitions.items():
            if isinstance(definition, dict) and "public" in definition:
                raise ConfigError(f"{scope}.{name}.public was removed in schema v4")
    overlap = sorted(set(inputs_raw) & set(variables_raw))
    if overlap:
        raise ConfigError(f"workflow inputs and variables overlap: {', '.join(overlap)}")
    input_definitions = {
        name: ParameterDefinition.parse(name, value)
        for name, value in inputs_raw.items()
    }
    variable_definitions = {
        name: ParameterDefinition.parse(name, value)
        for name, value in variables_raw.items()
    }
    missing_defaults = sorted(name for name, definition in variable_definitions.items() if not definition.has_default)
    if missing_defaults:
        raise ConfigError(f"workflow variables require defaults: {', '.join(missing_defaults)}")
    input_schema = compile_parameters(input_definitions)
    variable_schema = compile_parameters(variable_definitions)
    reference_schema = {
        "type": "object",
        "properties": {"inputs": input_schema, "variables": variable_schema},
        "additionalProperties": False,
    }
    variable_defaults = apply_parameter_defaults(variable_definitions, {})
    for name, definition in variables_raw.items():
        initial_from = definition.get("initial_from")
        if initial_from is None:
            continue
        if not isinstance(initial_from, str) or initial_from not in input_definitions:
            raise ConfigError(f"variables.{name}.initial_from must name a declared input")
        validate_value(
            {"ref": f"inputs.{initial_from}"},
            node_ids=set(),
            reference_schema=reference_schema,
            output_schemas={},
            available_node_ids=set(),
            possibly_available_node_ids=set(),
            path=f"variables.{name}.initial_from",
            expected_schema=variable_schema["properties"][name],
        )
    return input_schema, variable_schema, reference_schema, variable_defaults, variables_raw


def validate_variable_scopes(nodes_raw: list[Any], variables_raw: dict[str, Any]) -> None:
    """校验局部变量的 owner 是复合节点，且只能在 owner 子树内被引用。"""

    node_map = {item["id"]: item for item in nodes_raw}
    owners = {name: definition.get("owner") for name, definition in variables_raw.items() if definition.get("owner")}
    for name, owner in owners.items():
        if not isinstance(owner, str) or owner not in node_map or node_map[owner]["type"] in {"task", "instance_parallel", "bool_judge", "break"}:
            raise ConfigError(f"variables.{name}.owner must name a composite node")
        descendants: set[str] = set()
        pending = [owner]
        while pending:
            current = pending.pop()
            if current in descendants:
                continue
            descendants.add(current)
            pending.extend(node_map.get(current, {}).get("children", []))

        def check_scope(value: Any, caller: str) -> None:
            if isinstance(value, dict):
                ref = value.get("ref")
                if isinstance(ref, str) and (ref == f"variables.{name}" or ref.startswith(f"variables.{name}.")) and caller not in descendants:
                    raise ConfigError(f"node {caller} cannot read local variable {name} outside {owner}")
                for child in value.values():
                    check_scope(child, caller)
            elif isinstance(value, list):
                for child in value:
                    check_scope(child, caller)

        for item in nodes_raw:
            check_scope(item, item["id"])


__all__ = ["validate_scope_definitions", "validate_variable_scopes"]
