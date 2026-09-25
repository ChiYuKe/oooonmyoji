"""Immutable Behavior Tree workflow snapshots."""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path
from typing import Any

NODE_TYPES = ("root", "selector", "sequence", "simple_parallel", "parallel", "repeat_until", "branch", "switch", "instance_parallel", "condition", "bool_judge", "break", "task")
DECORATOR_TYPES = ("cooldown", "timeout", "retry", "repeat", "do_once")
PARALLEL_FINISH_MODES = ("abort_background", "wait_for_background")
INSTANCE_PARALLEL_WAIT_MODES = ("all", "any")

#: 布尔判断卡片（`bool_judge`）执行成功后的输出形状：引用写作 `nodes.<id>.output.value`。
BOOL_JUDGE_OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"value": {"type": "boolean"}},
    "required": ["value"],
    "additionalProperties": False,
}


@dataclass(frozen=True)
class BehaviorDecorator:
    type: str
    seconds: Any = None
    attempts: Any = 1
    delay_seconds: Any = 0.0
    count: Any = 1
    reset_on_failure: Any = False


@dataclass(frozen=True)
class InstanceParallelRun:
    """One child workflow scheduled on a configured runtime instance."""

    instance: str
    workflow: str
    inputs: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class WorkflowNode:
    id: str
    type: str
    name: str | None = None
    action: str | None = None
    params: dict[str, Any] = field(default_factory=dict)
    children: tuple[str, ...] = ()
    decorators: tuple[BehaviorDecorator, ...] = ()
    finish_mode: str = "abort_background"
    runs: tuple[InstanceParallelRun, ...] = ()
    wait_for: str = "all"
    cancel_on_failure: bool = True
    condition: Any = None
    conditions: tuple[Any, ...] = ()
    max_iterations: int = 100
    expression: Any = None
    ref: Any = None
    fields: dict[str, str] = field(default_factory=dict)
    cases: tuple[tuple[Any, str], ...] = ()
    default_child: str | None = None
    ports: tuple[str, ...] = ()

    @property
    def is_task(self) -> bool:
        return self.type == "task"

    @property
    def produces_output(self) -> bool:
        """执行成功后会登记 ``nodes.<id>.output`` 的节点：Task、布尔判断卡片与拆分卡片。"""

        return self.type in {"task", "bool_judge", "break"}


@dataclass(frozen=True)
class WorkflowSpec:
    schema_version: int
    workflow_id: str
    version: str
    description: str
    resolution: tuple[int, int]
    root: str
    timeout_seconds: float | None
    max_steps: int | None
    input_schema: dict[str, Any]
    variable_schema: dict[str, Any]
    variable_defaults: dict[str, Any]
    nodes: tuple[WorkflowNode, ...]
    path: Path
    file_hash: str
    raw: dict[str, Any] = field(repr=False)
    retry_safe: bool = False

    @cached_property
    def _node_index(self) -> dict[str, WorkflowNode]:
        """Build the node index once for this immutable workflow snapshot."""

        return {node.id: node for node in self.nodes}

    @property
    def node_map(self) -> dict[str, WorkflowNode]:
        """Return a node index without exposing the cached mutable dictionary.

        A workflow snapshot never changes its ``nodes`` tuple, so rebuilding
        this index on every lookup only adds hashing overhead.  Returning a
        shallow copy preserves the original API's mutation isolation.
        """

        return dict(self._node_index)

    @property
    def input_names(self) -> tuple[str, ...]:
        """Inputs declared by this workflow."""

        inputs = self.raw.get("inputs", {})
        if not isinstance(inputs, dict):
            return ()
        return tuple(inputs)


__all__ = [
    "BOOL_JUDGE_OUTPUT_SCHEMA",
    "DECORATOR_TYPES",
    "INSTANCE_PARALLEL_WAIT_MODES",
    "InstanceParallelRun",
    "NODE_TYPES",
    "PARALLEL_FINISH_MODES",
    "BehaviorDecorator",
    "WorkflowNode",
    "WorkflowSpec",
]
