"""Immutable Behavior Tree workflow snapshots."""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path
from typing import Any

NODE_TYPES = ("root", "selector", "sequence", "simple_parallel", "instance_parallel", "task")
COMPOSITE_TYPES = ("root", "selector", "sequence", "simple_parallel", "instance_parallel")
DECORATOR_TYPES = ("condition", "cooldown", "timeout", "retry", "repeat", "do_once")
PARALLEL_FINISH_MODES = ("abort_background", "wait_for_background")
INSTANCE_PARALLEL_WAIT_MODES = ("all", "any")


@dataclass(frozen=True)
class BehaviorDecorator:
    type: str
    expression: Any = None
    seconds: float | None = None
    attempts: int = 1
    delay_seconds: float = 0.0
    count: int = 1
    reset_on_failure: bool = False


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

    @property
    def is_task(self) -> bool:
        return self.type == "task"

    @property
    def is_composite(self) -> bool:
        return self.type in COMPOSITE_TYPES

    @property
    def is_orchestration(self) -> bool:
        return self.type == "instance_parallel"


@dataclass(frozen=True)
class WorkflowSpec:
    schema_version: int
    workflow_id: str
    version: str
    description: str
    resolution: tuple[int, int]
    root: str
    timeout_seconds: float
    max_steps: int
    blackboard_schema: dict[str, Any]
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
    def public_inputs(self) -> tuple[str, ...]:
        """Inputs exposed to parent workflows; omitted ``public`` keeps v3 compatibility."""

        blackboard = self.raw.get("blackboard", {})
        if not isinstance(blackboard, dict):
            return ()
        return tuple(
            name
            for name, definition in blackboard.items()
            if isinstance(definition, dict) and definition.get("public", True) is not False
        )


__all__ = [
    "COMPOSITE_TYPES",
    "DECORATOR_TYPES",
    "INSTANCE_PARALLEL_WAIT_MODES",
    "InstanceParallelRun",
    "NODE_TYPES",
    "PARALLEL_FINISH_MODES",
    "BehaviorDecorator",
    "WorkflowNode",
    "WorkflowSpec",
]
