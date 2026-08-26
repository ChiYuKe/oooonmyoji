"""Safe structured reference and condition evaluation."""

from __future__ import annotations

from typing import Any

from ..exceptions import WorkflowError


MISSING = object()
_NO_DEFAULT = object()


class ReferenceResolver:
    def __init__(self, inputs: dict[str, Any], outputs: dict[str, Any]) -> None:
        self.inputs = inputs
        self.outputs = outputs

    def reference(self, value: str, *, default: Any = _NO_DEFAULT) -> Any:
        parts = value.split(".")
        if len(parts) >= 2 and parts[0] == "inputs":
            current: Any = self.inputs
            segments = parts[1:]
        elif len(parts) >= 4 and parts[0] == "steps" and parts[2] == "output":
            if parts[1] not in self.outputs:
                if default is not _NO_DEFAULT:
                    return default
                raise WorkflowError(f"workflow output is not available: {value}")
            current = self.outputs[parts[1]]
            segments = parts[3:]
        else:
            raise WorkflowError(f"invalid structured reference: {value}")
        for segment in segments:
            try:
                if isinstance(current, list):
                    current = current[int(segment)]
                elif isinstance(current, dict):
                    current = current[segment]
                else:
                    raise KeyError(segment)
            except (KeyError, IndexError, TypeError, ValueError) as exc:
                if default is not _NO_DEFAULT:
                    return default
                raise WorkflowError(f"reference path does not exist: {value}") from exc
        return current

    def value(self, value: Any) -> Any:
        if isinstance(value, dict) and set(value) == {"$ref"}:
            return self.reference(value["$ref"])
        if isinstance(value, dict):
            return {key: self.value(child) for key, child in value.items()}
        if isinstance(value, list):
            return [self.value(child) for child in value]
        return value

    def condition(self, expression: Any) -> bool:
        if isinstance(expression, bool):
            return expression
        if not isinstance(expression, dict) or len(expression) != 1:
            raise WorkflowError("condition must be a boolean or one operator object")
        operator, operands = next(iter(expression.items()))
        if operator == "exists":
            if not isinstance(operands, dict) or set(operands) != {"$ref"}:
                raise WorkflowError("exists requires a structured reference")
            return self.reference(operands["$ref"], default=MISSING) is not MISSING
        if operator == "not":
            return not self.condition(operands)
        if operator in {"and", "or"}:
            if not isinstance(operands, list):
                raise WorkflowError(f"{operator} requires an array")
            values = (self.condition(item) for item in operands)
            return all(values) if operator == "and" else any(values)
        if operator not in {"eq", "ne", "gt", "gte", "lt", "lte", "contains"} or not isinstance(operands, list) or len(operands) != 2:
            raise WorkflowError(f"unsupported or malformed condition operator: {operator}")
        left = self.value(operands[0])
        right = self.value(operands[1])
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
        if isinstance(left, (str, list, tuple, dict)):
            return right in left
        return False


__all__ = ["MISSING", "ReferenceResolver"]
