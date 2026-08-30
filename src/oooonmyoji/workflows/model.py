"""Immutable Behavior Tree workflow snapshots."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

NODE_TYPES = ("root", "selector", "sequence", "simple_parallel", "task")
COMPOSITE_TYPES = ("root", "selector", "sequence", "simple_parallel")
DECORATOR_TYPES = ("condition", "cooldown", "timeout", "retry", "repeat")
PARALLEL_FINISH_MODES = ("abort_background", "wait_for_background")


@dataclass(frozen=True)
class BehaviorDecorator:
    type: str
    expression: Any = None
    seconds: float | None = None
    attempts: int = 1
    delay_seconds: float = 0.0
    count: int = 1


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

    @property
    def is_task(self) -> bool:
        return self.type == "task"

    @property
    def is_composite(self) -> bool:
        return self.type in COMPOSITE_TYPES


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

    @property
    def node_map(self) -> dict[str, WorkflowNode]:
        return {node.id: node for node in self.nodes}


__all__ = [
    "COMPOSITE_TYPES",
    "DECORATOR_TYPES",
    "NODE_TYPES",
    "PARALLEL_FINISH_MODES",
    "BehaviorDecorator",
    "WorkflowNode",
    "WorkflowSpec",
]
