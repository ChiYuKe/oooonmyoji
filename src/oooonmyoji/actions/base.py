"""Public Action contract and metadata."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from .manifest import ActionDefinition


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
    def cancelled(cls, error: str = "cancelled", *, output: Any = None) -> "ActionResult":
        return cls(ActionStatus.CANCELLED, output=output, error_category="cancelled", error=error)


class Action:
    """Trusted local Python implementation invoked by a workflow node."""

    name = ""

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        raise NotImplementedError


@dataclass(frozen=True)
class ActionSpec:
    """A runtime Action paired with its single manifest definition.

    The definition is the only source of truth for parameters, defaults,
    output schema and retry safety; the flat properties below are derived
    from it so engine call sites stay concise.
    """

    definition: ActionDefinition
    action: Action
    source: str = "builtin"

    @property
    def name(self) -> str:
        return self.definition.name

    @property
    def version(self) -> str:
        return self.definition.version

    @property
    def input_schema(self) -> dict[str, Any]:
        return self.definition.input_schema

    @property
    def output_schema(self) -> dict[str, Any]:
        return self.definition.output_schema

    @property
    def retry_safe(self) -> bool:
        return self.definition.retry_safe

    @property
    def side_effect(self) -> bool:
        return self.definition.side_effect

    @property
    def description(self) -> str:
        return self.definition.description

    @property
    def output_fields(self) -> tuple[str, ...]:
        return self.definition.output_fields


__all__ = ["Action", "ActionResult", "ActionSpec", "ActionStatus"]
