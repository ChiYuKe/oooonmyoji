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
from .bindings import CONDITION_OPERATORS, binding_aware_parameter_schema, break_target_schema, schema_at_path, schema_types, validate_value
from .graph import (
    PURE_DATA_NODE_TYPES,
    available_output_node_ids,
    possible_output_node_ids_in_subtree,
    possibly_available_output_node_ids,
    pure_data_guard,
)
from .model import INSTANCE_PARALLEL_WAIT_MODES, InstanceParallelRun, WorkflowNode, WorkflowSpec
from .node_rules import (
    build_output_schemas,
    node_label,
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

    action_specs, output_schemas = build_output_schemas(nodes_raw, registry, reference_schema)

    parsed: list[WorkflowNode] = []
    for index, item in enumerate(nodes_raw):
        node_type = str(item["type"])
        node_identifier = str(item["id"])
        if node_type in PURE_DATA_NODE_TYPES:
            # 纯数据节点没有执行位置：它自己的依赖按「使用者的执行点」判定，
            # 没人引用时不做位置判定（见 graph.pure_data_guard）。
            guard = pure_data_guard(nodes_raw, node_identifier)
            available_node_ids = set(node_ids) if guard is None else guard
            possibly_available_node_ids = available_node_ids
        else:
            available_node_ids = available_output_node_ids(nodes_raw, node_identifier)
            possibly_available_node_ids = possibly_available_output_node_ids(nodes_raw, node_identifier)
        children_raw = item.get("children", [])
        decorators_raw = item.get("decorators", [])
        assert isinstance(children_raw, list) and isinstance(decorators_raw, list)
        # 判断节点的分支口位：与 `children` 对齐，缺省按顺序（0=真、1=假）。
        node_ports: tuple[str, ...] = ()
        if node_type == "task":
            forbidden = set(item) & {"children", "finish_mode"}
            if forbidden:
                raise ConfigError(f"{node_label(index, item)} task cannot define {sorted(forbidden)}")
            params = item.get("params", {})
            assert isinstance(params, dict)
            spec = action_specs[item["id"]]
            validate_value(params, node_ids=node_id_set, reference_schema=reference_schema, output_schemas=output_schemas, available_node_ids=available_node_ids, possibly_available_node_ids=possibly_available_node_ids, path=f"{node_label(index, item)}.params", expected_schema=spec.input_schema)
            normalized = apply_parameter_defaults(spec.definition.parameters, params)
            _validate_json_schema(normalized, binding_aware_parameter_schema(spec.input_schema), f"{node_label(index, item)}.params")
            action = str(item["action"])
        elif node_type == "instance_parallel":
            forbidden = set(item) & {"action", "params", "children", "finish_mode"}
            if forbidden:
                raise ConfigError(f"{node_label(index, item)} instance_parallel cannot define {sorted(forbidden)}")
            if decorators_raw:
                raise ConfigError(f"{node_label(index, item)} instance_parallel cannot have decorators")
            runs_raw = item.get("runs")
            if not isinstance(runs_raw, list) or not runs_raw:
                raise ConfigError(f"{node_label(index, item)} instance_parallel must define at least one run")
            seen_instances: set[str] = set()
            default_workflow_dir = project_root / "workflows"
            base_workflow_dir = Path(workflow_dir or (default_workflow_dir if default_workflow_dir.is_dir() else path.parent)).resolve()
            for run_index, run_value in enumerate(runs_raw):
                if not isinstance(run_value, dict):
                    raise ConfigError(f"{node_label(index, item)}.runs[{run_index}] must be an object")
                instance_value = run_value.get("instance")
                workflow_value = run_value.get("workflow")
                if not isinstance(instance_value, str) or not instance_value.strip():
                    raise ConfigError(f"{node_label(index, item)}.runs[{run_index}].instance must be a non-empty string")
                if instance_value in seen_instances:
                    raise ConfigError(f"{node_label(index, item)} instance_parallel cannot run instance more than once: {instance_value}")
                seen_instances.add(instance_value)
                if not isinstance(workflow_value, str) or not workflow_value.strip():
                    raise ConfigError(f"{node_label(index, item)}.runs[{run_index}].workflow must be a non-empty string")
                validate_instance_workflow_reference(base_workflow_dir, workflow_value, f"{node_label(index, item)}.runs[{run_index}].workflow")
                run_inputs = run_value.get("inputs", {})
                if not isinstance(run_inputs, dict):
                    raise ConfigError(f"{node_label(index, item)}.runs[{run_index}].inputs must be an object")
                validate_instance_parallel_inputs(run_inputs, reference_schema=reference_schema, path=f"{node_label(index, item)}.runs[{run_index}].inputs")
                validate_child_inputs(
                    base_workflow_dir,
                    workflow_value,
                    run_inputs,
                    f"{node_label(index, item)}.runs[{run_index}].inputs",
                )
            wait_for = item.get("wait_for", "all")
            if wait_for not in INSTANCE_PARALLEL_WAIT_MODES:
                raise ConfigError(f"{node_label(index, item)}.wait_for must be one of {INSTANCE_PARALLEL_WAIT_MODES}")
            cancel_on_failure = item.get("cancel_on_failure", True)
            if not isinstance(cancel_on_failure, bool):
                raise ConfigError(f"{node_label(index, item)}.cancel_on_failure must be a boolean")
            params = {}
            action = None
        elif node_type == "condition":
            forbidden = set(item) & {"action", "params", "finish_mode"}
            if forbidden:
                raise ConfigError(f"{node_label(index, item)} condition cannot define {sorted(forbidden)}")
            if "expression" not in item:
                raise ConfigError(f"{node_label(index, item)} condition requires expression")
            validate_value(item["expression"], node_ids=node_id_set, reference_schema=reference_schema, output_schemas=output_schemas, available_node_ids=available_node_ids, possibly_available_node_ids=possibly_available_node_ids, path=f"{node_label(index, item)}.expression", condition=True)
            # 判断节点最多两条分支：真口 / 假口，各自最多一个子节点。
            if len(children_raw) > 2:
                raise ConfigError(f"{node_label(index, item)} condition accepts at most two branches")
            ports_raw = item.get("ports")
            if ports_raw is None:
                node_ports = tuple("true" if position == 0 else "false" for position in range(len(children_raw)))
            else:
                if not isinstance(ports_raw, list) or len(ports_raw) != len(children_raw):
                    raise ConfigError(f"{node_label(index, item)}.ports must match condition branches")
                if any(port not in ("true", "false") for port in ports_raw) or len(set(ports_raw)) != len(ports_raw):
                    raise ConfigError(f"{node_label(index, item)}.ports must be unique true/false values")
                node_ports = tuple(str(port) for port in ports_raw)
            params = {}
            action = None
        elif node_type == "bool_judge":
            # 布尔判断卡片：叶子，只带一个条件表达式；求值结果作为 `nodes.<id>.output.value`
            # 供别的节点引用（判断节点/Branch/Repeat Until 的条件都能直接绑它）。
            forbidden = set(item) & {"action", "params", "children", "finish_mode"}
            if forbidden:
                raise ConfigError(f"{node_label(index, item)} bool_judge cannot define {sorted(forbidden)}")
            if "expression" not in item:
                raise ConfigError(f"{node_label(index, item)} bool_judge requires expression")
            validate_value(item["expression"], node_ids=node_id_set, reference_schema=reference_schema, output_schemas=output_schemas, available_node_ids=available_node_ids, possibly_available_node_ids=possibly_available_node_ids, path=f"{node_label(index, item)}.expression", condition=True)
            params = {}
            action = None
        elif node_type == "break":
            # 拆分卡片：叶子，把一张卡片的对象/数组输出按字段拆开，登记成
            # `nodes.<id>.output.<字段>` 供别的节点引用（类似 UE 蓝图的 Break）。
            forbidden = set(item) & {"action", "params", "children", "finish_mode"}
            if forbidden:
                raise ConfigError(f"{node_label(index, item)} break cannot define {sorted(forbidden)}")
            ref_value = item.get("ref")
            if not is_binding(ref_value):
                raise ConfigError(f"{node_label(index, item)} break requires a ref binding like {{\"ref\": \"nodes.<id>.output...\"}}")
            ref_path = f"{node_label(index, item)}.ref"
            target_schema = break_target_schema(str(ref_value["ref"]), node_ids=node_id_set, reference_schema=reference_schema, output_schemas=output_schemas, available_node_ids=available_node_ids, path=ref_path)
            known_types = schema_types(target_schema)
            if known_types and not (known_types & {"object", "array"}):
                raise ConfigError(f"{ref_path} must reference an object or array output, got {sorted(known_types)}")
            fields = item.get("fields", {})
            if not isinstance(fields, dict):
                raise ConfigError(f"{node_label(index, item)}.fields must be an object")
            for field_name, field_path in fields.items():
                if not isinstance(field_name, str) or not field_name:
                    raise ConfigError(f"{node_label(index, item)}.fields keys must be non-empty strings")
                if not isinstance(field_path, str) or not field_path:
                    raise ConfigError(f"{node_label(index, item)}.fields.{field_name} must be a non-empty path string")
                if target_schema and schema_at_path(target_schema, str(field_path).split(".")) is None:
                    raise ConfigError(f"{node_label(index, item)}.fields.{field_name}: path '{field_path}' does not exist in the target output schema")
            params = {}
            action = None
        else:
            forbidden = set(item) & {"action", "params"}
            if forbidden:
                raise ConfigError(f"{node_label(index, item)} {node_type} cannot define {sorted(forbidden)}")
            params = {}
            action = None
        if node_type == "repeat_until":
            if len(children_raw) != 1:
                raise ConfigError(f"{node_label(index, item)} repeat_until must contain exactly one child")
            if "condition" not in item:
                raise ConfigError(f"{node_label(index, item)} repeat_until requires condition")
            # The body has completed before repeat_until evaluates its exit
            # condition, so outputs produced inside that body are valid here.
            # Keep the stricter execution-point rule for all other bindings.
            node_map_for_repeat = {str(node["id"]): node for node in nodes_raw}
            body_outputs = possible_output_node_ids_in_subtree(str(children_raw[0]), node_map_for_repeat)
            repeat_condition_outputs = possibly_available_node_ids | body_outputs
            validate_value(item["condition"], node_ids=node_id_set, reference_schema=reference_schema, output_schemas=output_schemas, available_node_ids=repeat_condition_outputs, possibly_available_node_ids=repeat_condition_outputs, path=f"{node_label(index, item)}.condition", condition=True)
            max_iterations = item.get("max_iterations", 100)
            if isinstance(max_iterations, bool) or not isinstance(max_iterations, int) or max_iterations < 1:
                raise ConfigError(f"{node_label(index, item)}.max_iterations must be a positive integer")
        elif node_type == "branch":
            if not children_raw:
                raise ConfigError(f"{node_label(index, item)} branch must contain at least one child")
            conditions = item.get("conditions")
            if not isinstance(conditions, list) or len(conditions) != len(children_raw):
                raise ConfigError(f"{node_label(index, item)}.conditions must match branch children")
            for condition_index, condition_value in enumerate(conditions):
                validate_value(condition_value, node_ids=node_id_set, reference_schema=reference_schema, output_schemas=output_schemas, available_node_ids=available_node_ids, possibly_available_node_ids=possibly_available_node_ids, path=f"{node_label(index, item)}.conditions[{condition_index}]", condition=True)
        elif node_type == "switch":
            if "expression" not in item:
                raise ConfigError(f"{node_label(index, item)} switch requires expression")
            cases = item.get("cases")
            if not isinstance(cases, list) or not cases:
                raise ConfigError(f"{node_label(index, item)}.cases must be a non-empty array")
            for case_index, case in enumerate(cases):
                if not isinstance(case, dict) or not isinstance(case.get("child"), str) or "value" not in case:
                    raise ConfigError(f"{node_label(index, item)}.cases[{case_index}] must define value and child")
        elif node_type == "parallel":
            if len(children_raw) < 2:
                raise ConfigError(f"{node_label(index, item)} parallel must contain at least two children")
            wait_for = item.get("wait_for", "all")
            if wait_for not in {"all", "any"}:
                raise ConfigError(f"{node_label(index, item)}.wait_for must be all or any")
            if not isinstance(item.get("cancel_on_failure", True), bool):
                raise ConfigError(f"{node_label(index, item)}.cancel_on_failure must be a boolean")
        if node_type != "simple_parallel" and "finish_mode" in item:
            raise ConfigError(f"{node_label(index, item)}.finish_mode is only valid for simple_parallel")
        if node_type != "instance_parallel" and any(field in item for field in ("runs", "wait_for", "cancel_on_failure")):
            if node_type != "parallel":
                raise ConfigError(f"{node_label(index, item)} instance_parallel fields are only valid for instance_parallel")
        node_fields = {"condition", "max_iterations", "conditions", "expression", "cases", "default_child", "ports", "ref", "fields"}
        allowed_fields = {
            "repeat_until": {"condition", "max_iterations"},
            "branch": {"conditions"},
            "switch": {"expression", "cases", "default_child"},
            "condition": {"expression", "ports"},
            "bool_judge": {"expression"},
            "break": {"ref", "fields"},
        }.get(node_type, set())
        invalid_fields = (set(item) & node_fields) - allowed_fields
        if invalid_fields:
            raise ConfigError(f"{node_label(index, item)} fields {sorted(invalid_fields)} are not valid for {node_type}")
        decorators = parse_decorators(decorators_raw, node_index=index, node_ids=node_id_set, reference_schema=reference_schema, output_schemas=output_schemas, available_node_ids=available_node_ids, possibly_available_node_ids=possibly_available_node_ids)
        if node_type == "root" and decorators:
            raise ConfigError(f"{node_label(index, item)} root cannot have decorators")
        retry = next((decorator for decorator in decorators if decorator.type == "retry"), None)
        if retry is not None and (is_binding(retry.attempts) or retry.attempts > 1) and node_type == "task" and not action_specs[item["id"]].definition.retry_safe and not raw.get("retry_safe", False):
            raise ConfigError(f"{node_label(index, item)} retries an Action that is not declared retry-safe")
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
            ref=deepcopy(item.get("ref")),
            fields=dict(deepcopy(item["fields"])) if isinstance(item.get("fields"), dict) else {},
            cases=tuple((deepcopy(case.get("value")), str(case["child"])) for case in item.get("cases", []) if isinstance(case, dict) and "child" in case),
            default_child=str(item["default_child"]) if isinstance(item.get("default_child"), str) else None,
            ports=node_ports,
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
