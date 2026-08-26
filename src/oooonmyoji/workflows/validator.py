"""JSON Schema and graph validation for workflow files."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any, Iterable

from ..actions import ActionRegistry
from ..config.loader import _validate_json_schema
from ..exceptions import ConfigError, WorkflowError
from .model import StepRetry, WorkflowSpec, WorkflowStep


WORKFLOW_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "required": ["schema_version", "id", "version", "reference_resolution", "entry", "steps"],
    "properties": {
        "schema_version": {"const": 1},
        "id": {"type": "string", "minLength": 1},
        "version": {"type": "string", "minLength": 1},
        "reference_resolution": {"type": "array", "prefixItems": [{"type": "integer", "minimum": 1}, {"type": "integer", "minimum": 1}], "minItems": 2, "maxItems": 2},
        "entry": {"type": "string", "minLength": 1},
        "limits": {"type": "object", "properties": {"timeout_seconds": {"type": "number", "exclusiveMinimum": 0}, "max_steps": {"type": "integer", "minimum": 1}}, "additionalProperties": False},
        "inputs_schema": {"type": "object"},
        "steps": {"type": "array", "minItems": 1, "items": {"type": "object", "required": ["id", "action"], "properties": {
            "id": {"type": "string", "minLength": 1},
            "action": {"type": "string", "minLength": 1},
            "with": {"type": "object"},
            "when": {},
            "on_success": {"type": "string", "minLength": 1},
            "on_failure": {"type": "string", "minLength": 1},
            "on_skip": {"type": "string", "minLength": 1},
            "retry": {"oneOf": [{"type": "integer", "minimum": 1}, {"type": "object", "properties": {"attempts": {"type": "integer", "minimum": 1}, "delay_seconds": {"type": "number", "minimum": 0}}, "additionalProperties": False}]},
            "timeout_seconds": {"type": "number", "exclusiveMinimum": 0},
        }, "additionalProperties": False}},
    },
    "additionalProperties": False,
}

TERMINALS = {"$success", "$failure", "$cancelled"}
CONDITION_OPERATORS = {"exists", "eq", "ne", "gt", "gte", "lt", "lte", "contains", "and", "or", "not"}


def _ref_path(value: str, *, step_ids: set[str], path: str) -> None:
    parts = value.split(".")
    if len(parts) >= 2 and parts[0] == "inputs" and all(parts[1:]):
        return
    if len(parts) >= 4 and parts[0] == "steps" and parts[2] == "output" and parts[1] in step_ids and all(parts[3:]):
        return
    raise ConfigError(f"{path} has invalid structured reference: {value}")


def _validate_ref_and_conditions(value: Any, *, step_ids: set[str], path: str, condition: bool = False) -> None:
    if isinstance(value, dict):
        if "$ref" in value:
            if set(value) != {"$ref"} or not isinstance(value["$ref"], str):
                raise ConfigError(f"{path} must contain only a string $ref")
            _ref_path(value["$ref"], step_ids=step_ids, path=path)
            return
        if condition:
            if len(value) != 1 or next(iter(value)) not in CONDITION_OPERATORS:
                raise ConfigError(f"{path} must use exactly one supported condition operator")
            operator, operands = next(iter(value.items()))
            if operator in {"and", "or"}:
                if not isinstance(operands, list) or not operands:
                    raise ConfigError(f"{path}.{operator} must be a non-empty array")
                for index, operand in enumerate(operands):
                    _validate_ref_and_conditions(operand, step_ids=step_ids, path=f"{path}.{operator}[{index}]", condition=True)
            elif operator == "not":
                _validate_ref_and_conditions(operands, step_ids=step_ids, path=f"{path}.not", condition=True)
            elif operator == "exists":
                if not isinstance(operands, dict) or set(operands) != {"$ref"}:
                    raise ConfigError(f"{path}.exists must contain a structured reference")
                _validate_ref_and_conditions(operands, step_ids=step_ids, path=f"{path}.exists", condition=True)
            else:
                if not isinstance(operands, list) or len(operands) != 2:
                    raise ConfigError(f"{path}.{operator} must contain two operands")
                for index, operand in enumerate(operands):
                    _validate_ref_and_conditions(operand, step_ids=step_ids, path=f"{path}.{operator}[{index}]", condition=False)
            return
        for key, child in value.items():
            _validate_ref_and_conditions(child, step_ids=step_ids, path=f"{path}.{key}", condition=False)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _validate_ref_and_conditions(child, step_ids=step_ids, path=f"{path}[{index}]", condition=False)
    elif condition and not isinstance(value, bool):
        raise ConfigError(f"{path} must be a boolean or condition object")


def _targets(spec_steps: tuple[WorkflowStep, ...], step: WorkflowStep) -> Iterable[str]:
    index = next(index for index, item in enumerate(spec_steps) if item.id == step.id)
    yield step.on_success or (spec_steps[index + 1].id if index + 1 < len(spec_steps) else "$success")
    yield step.on_failure or "$failure"
    yield step.on_skip or (spec_steps[index + 1].id if index + 1 < len(spec_steps) else "$success")


def validate_workflow(raw: dict[str, Any], path: Path, registry: ActionRegistry, *, project_root: Path) -> WorkflowSpec:
    _validate_json_schema(raw, WORKFLOW_SCHEMA, f"workflow {path}")
    try:
        from jsonschema import Draft202012Validator
        Draft202012Validator.check_schema(raw.get("inputs_schema", {"type": "object"}))
    except ImportError as exc:
        raise ConfigError("jsonschema is required for workflow validation", cause=exc) from exc
    except Exception as exc:
        raise ConfigError(f"workflow {path} inputs_schema is invalid: {exc}", cause=exc) from exc
    steps_raw = raw["steps"]
    assert isinstance(steps_raw, list)
    step_ids = [item["id"] for item in steps_raw]
    if len(step_ids) != len(set(step_ids)):
        raise ConfigError(f"workflow {path} contains duplicate step IDs")
    step_id_set = set(step_ids)
    if raw["entry"] not in step_id_set:
        raise ConfigError(f"workflow {path} entry does not name a step: {raw['entry']}")
    parsed: list[WorkflowStep] = []
    for index, item in enumerate(steps_raw):
        action = registry.get(item["action"])
        arguments = item.get("with", {})
        _validate_ref_and_conditions(arguments, step_ids=step_id_set, path=f"steps[{index}].with")
        when = item.get("when")
        if when is not None:
            _validate_ref_and_conditions(when, step_ids=step_id_set, path=f"steps[{index}].when", condition=True)
        retry_raw = item.get("retry", 1)
        if isinstance(retry_raw, int):
            retry = StepRetry(retry_raw)
        else:
            retry = StepRetry(int(retry_raw.get("attempts", 1)), float(retry_raw.get("delay_seconds", 0.0)))
        if retry.attempts > 1 and (not action.retry_safe or action.side_effect):
            raise ConfigError(f"steps[{index}] Action {action.name} is not retry-safe")
        parsed.append(WorkflowStep(
            id=item["id"],
            action=item["action"],
            arguments=deepcopy(arguments),
            when=deepcopy(when),
            on_success=item.get("on_success"),
            on_failure=item.get("on_failure"),
            on_skip=item.get("on_skip"),
            retry=retry,
            timeout_seconds=item.get("timeout_seconds"),
        ))
    parsed_tuple = tuple(parsed)
    valid_targets = step_id_set | TERMINALS
    for step in parsed_tuple:
        for target in _targets(parsed_tuple, step):
            if target not in valid_targets:
                raise ConfigError(f"step {step.id} points to unknown target: {target}")
    reachable: set[str] = set()
    pending = [raw["entry"]]
    while pending:
        current = pending.pop()
        if current in reachable or current in TERMINALS:
            continue
        reachable.add(current)
        step = next(item for item in parsed_tuple if item.id == current)
        pending.extend(target for target in _targets(parsed_tuple, step) if target not in reachable)
    if reachable != step_id_set:
        raise ConfigError(f"workflow {path} contains unreachable steps: {', '.join(sorted(step_id_set - reachable))}")
    can_finish = set(TERMINALS)
    changed = True
    while changed:
        changed = False
        for step in parsed_tuple:
            if step.id not in can_finish and any(target in can_finish for target in _targets(parsed_tuple, step)):
                can_finish.add(step.id)
                changed = True
    if not step_id_set.issubset(can_finish):
        raise ConfigError(f"workflow {path} has a step with no reachable terminal")
    limits = raw.get("limits", {})
    retry_safe = all(
        not registry.get(step.action).side_effect and registry.get(step.action).retry_safe
        for step in parsed_tuple
    )
    return WorkflowSpec(
        schema_version=1,
        workflow_id=raw["id"],
        version=raw["version"],
        reference_resolution=(int(raw["reference_resolution"][0]), int(raw["reference_resolution"][1])),
        entry=raw["entry"],
        timeout_seconds=float(limits.get("timeout_seconds", 300.0)),
        max_steps=int(limits.get("max_steps", 200)),
        retry_safe=retry_safe,
        inputs_schema=deepcopy(raw.get("inputs_schema", {"type": "object"})),
        steps=parsed_tuple,
        path=path,
        file_hash="",
        raw=deepcopy(raw),
    )


__all__ = ["CONDITION_OPERATORS", "TERMINALS", "WORKFLOW_SCHEMA", "validate_workflow"]
