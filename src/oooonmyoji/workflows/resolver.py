"""Structured workflow input, variable, runtime, and node-output references."""

from __future__ import annotations

from typing import Any

from ..exceptions import WorkflowError

MISSING = object()
_NO_DEFAULT = object()


def is_binding(value: Any) -> bool:
    return isinstance(value, dict) and set(value) == {"ref"} and isinstance(value.get("ref"), str)


class ReferenceResolver:
    def __init__(
        self,
        inputs: dict[str, Any],
        outputs: dict[str, Any],
        runtime: dict[str, Any] | None = None,
        *,
        variables: dict[str, Any] | None = None,
        resolve_output: Any = None,
        is_data_node: Any = None,
    ) -> None:
        self.inputs = inputs
        self.variables = variables or {}
        self.outputs = outputs
        self.runtime = runtime or {}
        self.resolve_output = resolve_output
        #: 判断某个节点是不是「按需求值的纯数据节点」（布尔判断 / 拆分）：
        #: 它们的输出不缓存，每次引用都重算。
        self.is_data_node = is_data_node or (lambda _node_id: False)

    def reference(self, value: str, *, default: Any = _NO_DEFAULT) -> Any:
        parts = value.split(".")
        if len(parts) >= 2 and parts[0] == "inputs" and all(parts[1:]):
            current: Any = self.inputs
            path = parts[1:]
        elif len(parts) >= 2 and parts[0] == "variables" and all(parts[1:]):
            current = self.variables
            path = parts[1:]
        elif len(parts) >= 2 and parts[0] == "runtime" and all(parts[1:]):
            current = self.runtime
            path = parts[1:]
        elif len(parts) >= 3 and parts[0] == "nodes" and parts[2] == "output" and all(parts[1:]):
            # `nodes.<id>.output`（不带字段）也是合法引用：拆分卡片（`break`）就是靠它
            # 拿整张卡片的输出再拆字段，校验层同样允许这种写法。
            #
            # 纯数据节点（布尔判断 / 拆分）**每次引用都重新求值**：它们算的是「这一刻」的值，
            # 树里的任务每轮都会刷新输出，缓存住第一轮的结论会让循环用旧值走错分支。
            # 普通节点仍然只在缺输出时补算。
            node_id = parts[1]
            if self.resolve_output is not None and (self.is_data_node(node_id) or node_id not in self.outputs):
                self.resolve_output(node_id)
            current = self.outputs
            path = [node_id, *parts[3:]]
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
        if is_binding(expression):
            expression = self.value(expression)
            if is_binding(expression):
                raise WorkflowError("condition input must contain a boolean or condition expression, not another reference")
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
