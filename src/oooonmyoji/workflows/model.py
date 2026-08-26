"""Immutable workflow snapshots loaded from JSON."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class StepRetry:
    attempts: int = 1
    delay_seconds: float = 0.0


@dataclass(frozen=True)
class WorkflowStep:
    id: str
    action: str
    arguments: dict[str, Any] = field(default_factory=dict)
    when: Any = None
    on_success: str | None = None
    on_failure: str | None = None
    on_skip: str | None = None
    retry: StepRetry = field(default_factory=StepRetry)
    timeout_seconds: float | None = None


@dataclass(frozen=True)
class WorkflowSpec:
    schema_version: int
    workflow_id: str
    version: str
    reference_resolution: tuple[int, int]
    entry: str
    timeout_seconds: float
    max_steps: int
    inputs_schema: dict[str, Any]
    steps: tuple[WorkflowStep, ...]
    path: Path
    file_hash: str
    raw: dict[str, Any] = field(repr=False)
    retry_safe: bool = False

    @property
    def step_map(self) -> dict[str, WorkflowStep]:
        return {step.id: step for step in self.steps}

    def next_step(self, step_id: str) -> str:
        index = next(index for index, step in enumerate(self.steps) if step.id == step_id)
        if index + 1 >= len(self.steps):
            return "$success"
        return self.steps[index + 1].id


__all__ = ["StepRetry", "WorkflowSpec", "WorkflowStep"]
