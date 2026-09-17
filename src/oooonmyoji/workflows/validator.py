"""Behavior Tree v4 workflow validation 的公开入口。

校验实现按职责拆分：
- ``schema.py``：结构 JSON Schema；
- ``graph.py``：执行点可用输出推导；
- ``bindings.py``：绑定引用解析与类型校验；
- ``scopes.py``：inputs/variables 定义与局部作用域；
- ``node_rules.py``：装饰器、实例并行与图结构等语义规则。

本模块只做编排并保留 ``validate_workflow`` / ``WORKFLOW_SCHEMA`` 公开契约。
"""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

from ..actions import ActionRegistry
from ..actions.manifest import apply_parameter_defaults
from ..config.loader import _validate_json_schema
from ..exceptions import ConfigError
from .bindings import CONDITION_OPERATORS, binding_aware_parameter_schema, validate_value
from .graph import (
    available_output_node_ids,
    possible_output_node_ids_in_subtree,
    possibly_available_output_node_ids,
)
from .model import INSTANCE_PARALLEL_WAIT_MODES, InstanceParallelRun, WorkflowNode, WorkflowSpec
from .node_rules import (
    build_output_schemas,
    parse_decorators,
    validate_child_inputs,
    validate_graph_structure,
    validate_instance_parallel_inputs,
    validate_instance_workflow_reference,
)
from .resolver import is_binding
from .schema import WORKFLOW_SCHEMA
from .scopes import validate_scope_definitions, validate_variable_scopes


def validate_workflow(
    raw: dict[str, Any],
    path: Path,
    registry: ActionRegistry,
    *,
    project_root: Path,
    workflow_dir: Path | None = None,
) -> WorkflowSpec:
    _validate_json_schema(raw, WORKFLOW_SCHEMA, f"workflow {path}")

    input_schema, variable_schema, reference_schema, variable_defaults, variables_raw = validate_scope_definitions(raw)

    nodes_raw = raw["nodes"]
    assert isinstance(nodes_raw, list)
    node_ids = [str(item["id"]) for item in nodes_raw]
    if len(node_ids) != len(set(node_ids)):
        raise ConfigError(f"workflow {path} contains duplicate node IDs")
    node_id_set = set(node_ids)
    validate_variable_scopes(nodes_raw, variables_raw)
    if raw["root"] not in node_id_set:
        raise ConfigError(f"workflow {path} root does not name a node: {raw['root']}")

    action_specs, output_schemas = build_output_schemas(nodes_raw, registry)

    parsed: list[WorkflowNode] = []
    for index, item in enumerate(nodes_raw):
        node_type = str(item["type"])
        available_node_ids = available_output_node_ids(nodes_raw, str(item["id"]))
        possibly_available_node_ids = possibly_available_output_node_ids(nodes_raw, str(item["id"]))
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
            validate_value(params, node_ids=node_id_set, reference_schema=reference_schema, output_schemas=output_schemas, available_node_ids=available_node_ids, possibly_available_node_ids=possibly_available_node_ids, path=f"nodes[{index}].params", expected_schema=spec.input_schema)
            normalized = apply_parameter_defaults(spec.definition.parameters, params)
            _validate_json_schema(normalized, binding_aware_parameter_schema(spec.input_schema), f"nodes[{index}].params")
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
                validate_instance_workflow_reference(base_workflow_dir, workflow_value, f"nodes[{index}].runs[{run_index}].workflow")
                run_inputs = run_value.get("inputs", {})
                if not isinstance(run_inputs, dict):
                    raise ConfigError(f"nodes[{index}].runs[{run_index}].inputs must be an object")
                validate_instance_parallel_inputs(run_inputs, reference_schema=reference_schema, path=f"nodes[{index}].runs[{run_index}].inputs")
                validate_child_inputs(
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
            body_outputs = possible_output_node_ids_in_subtree(str(children_raw[0]), node_map_for_repeat)
            repeat_condition_outputs = possibly_available_node_ids | body_outputs
            validate_value(item["condition"], node_ids=node_id_set, reference_schema=reference_schema, output_schemas=output_schemas, available_node_ids=repeat_condition_outputs, possibly_available_node_ids=repeat_condition_outputs, path=f"nodes[{index}].condition", condition=True)
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
                validate_value(condition_value, node_ids=node_id_set, reference_schema=reference_schema, output_schemas=output_schemas, available_node_ids=available_node_ids, possibly_available_node_ids=possibly_available_node_ids, path=f"nodes[{index}].conditions[{condition_index}]", condition=True)
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
        decorators = parse_decorators(decorators_raw, node_index=index, node_ids=node_id_set, reference_schema=reference_schema, output_schemas=output_schemas, available_node_ids=available_node_ids, possibly_available_node_ids=possibly_available_node_ids)
        if node_type == "root" and decorators:
            raise ConfigError(f"nodes[{index}] root cannot have decorators")
        retry = next((decorator for decorator in decorators if decorator.type == "retry"), None)
        if retry is not None and (is_binding(retry.attempts) or retry.attempts > 1) and node_type == "task" and not action_specs[item["id"]].definition.retry_safe and not raw.get("retry_safe", False):
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

    root = validate_graph_structure(parsed, raw, node_id_set)

    limits = raw.get("limits", {})
    assert isinstance(limits, dict)
    timeout_seconds = limits.get("timeout_seconds")
    max_steps = limits.get("max_steps")
    return WorkflowSpec(
        schema_version=4,
        workflow_id=str(raw["id"]),
        version=str(raw["version"]),
        description=str(raw.get("description", "")),
        resolution=(int(raw["resolution"][0]), int(raw["resolution"][1])),
        root=root.id,
        timeout_seconds=float(timeout_seconds) if timeout_seconds is not None else None,
        max_steps=int(max_steps) if max_steps is not None else None,
        input_schema=input_schema,
        variable_schema=variable_schema,
        variable_defaults=variable_defaults,
        nodes=tuple(parsed),
        path=path,
        file_hash="",
        raw=deepcopy(raw),
        retry_safe=bool(raw.get("retry_safe", False)),
    )


__all__ = ["CONDITION_OPERATORS", "WORKFLOW_SCHEMA", "validate_workflow"]
