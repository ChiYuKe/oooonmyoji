"""Structured blackboard and Behavior Tree node-output references."""

from __future__ import annotations

from typing import Any

from ..exceptions import WorkflowError

MISSING = object()
_NO_DEFAULT = object()


def is_binding(value: Any) -> bool:
    return isinstance(value, dict) and set(value) == {"ref"} and isinstance(value.get("ref"), str)


class ReferenceResolver:
    def __init__(self, blackboard: dict[str, Any], outputs: dict[str, Any], runtime: dict[str, Any] | None = None) -> None:
        self.blackboard = blackboard
        self.outputs = outputs
        self.runtime = runtime or {}

    def reference(self, value: str, *, default: Any = _NO_DEFAULT) -> Any:
        parts = value.split(".")
        if len(parts) >= 2 and parts[0] == "blackboard" and all(parts[1:]):
            current: Any = self.blackboard
            path = parts[1:]
        elif len(parts) >= 2 and parts[0] == "runtime" and all(parts[1:]):
            current = self.runtime
            path = parts[1:]
        elif len(parts) >= 4 and parts[0] == "nodes" and parts[2] == "output" and all(parts[1:]):
            current = self.outputs
            path = [parts[1], *parts[3:]]
        else:
            if default is not _NO_DEFAULT:
                return default
            raise WorkflowError(f"invalid structured reference: {value}")
        for part in path:
            if isinstance(current, dict) and part in current:
                current = current[part]
            elif isinstance(current, list) and part.isdigit() and int(part) < len(current):
                current = current[int(part)]
            else:
                if default is not _NO_DEFAULT:
                    return default
                raise WorkflowError(f"reference is unavailable: {value}")
        return current

    def value(self, value: Any) -> Any:
        if is_binding(value):
            return self.reference(value["ref"])
        if isinstance(value, dict):
            return {key: self.value(child) for key, child in value.items()}
        if isinstance(value, list):
            return [self.value(child) for child in value]
        return value

    def condition(self, expression: Any) -> bool:
        if isinstance(expression, bool):
            return expression
        if not isinstance(expression, dict) or len(expression) != 1:
            raise WorkflowError("condition must use exactly one operator")
        operator, operands = next(iter(expression.items()))
        if operator == "and":
            return all(self.condition(item) for item in operands)
        if operator == "or":
            return any(self.condition(item) for item in operands)
        if operator == "not":
            return not self.condition(operands)
        if operator == "exists":
            if not is_binding(operands):
                raise WorkflowError("exists expects a structured reference")
            return self.reference(operands["ref"], default=MISSING) is not MISSING
        if not isinstance(operands, list) or len(operands) != 2:
            raise WorkflowError(f"condition operator {operator} expects two operands")
        left, right = (self.value(item) for item in operands)
        if operator == "eq":
            return left == right
        if operator == "ne":
            return left != right
        if operator == "gt":
            return left > right
        if operator == "gte":
            return left >= right
        if operator == "lt":
            return left < right
        if operator == "lte":
            return left <= right
        if operator == "contains":
            return right in left
        raise WorkflowError(f"unsupported condition operator: {operator}")


__all__ = ["MISSING", "ReferenceResolver", "is_binding"]
