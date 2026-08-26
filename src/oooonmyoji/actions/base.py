"""Public Action contract and metadata."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class ActionStatus(StrEnum):
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass(frozen=True)
class ActionResult:
    status: ActionStatus
    output: Any = None
    error_category: str | None = None
    error: str | None = None

    @classmethod
    def succeeded(cls, output: Any = None) -> "ActionResult":
        return cls(ActionStatus.SUCCEEDED, output=output)

    @classmethod
    def failed(cls, error: str, *, category: str = "action", output: Any = None) -> "ActionResult":
        return cls(ActionStatus.FAILED, output=output, error_category=category, error=error)

    @classmethod
    def cancelled(cls, error: str = "cancelled") -> "ActionResult":
        return cls(ActionStatus.CANCELLED, error_category="cancelled", error=error)


class Action:
    """Trusted local Python implementation invoked by a workflow step."""

    name = ""

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        raise NotImplementedError


@dataclass(frozen=True)
class ActionSpec:
    name: str
    version: str
    action: Action
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    retry_safe: bool
    side_effect: bool
    source: str = "builtin"


__all__ = ["Action", "ActionResult", "ActionSpec", "ActionStatus"]
