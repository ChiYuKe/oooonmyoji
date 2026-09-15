"""Action 的公共契约与元数据。"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from .manifest import ActionDefinition


class ActionStatus(StrEnum):
    """Action 的执行结果状态。"""

    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass(frozen=True)
class ActionResult:
    """Action 返回给工作流引擎的结果，包含状态、输出与错误分类。"""

    status: ActionStatus
    output: Any = None
    error_category: str | None = None
    error: str | None = None

    @classmethod
    def succeeded(cls, output: Any = None) -> "ActionResult":
        """构造成功结果。"""

        return cls(ActionStatus.SUCCEEDED, output=output)

    @classmethod
    def failed(cls, error: str, *, category: str = "action", output: Any = None) -> "ActionResult":
        """构造失败结果，``category`` 用于结构化日志分类。"""

        return cls(ActionStatus.FAILED, output=output, error_category=category, error=error)

    @classmethod
    def cancelled(cls, error: str = "cancelled", *, output: Any = None) -> "ActionResult":
        """构造被取消的结果。"""

        return cls(ActionStatus.CANCELLED, output=output, error_category="cancelled", error=error)


class Action:
    """由工作流节点调用的可信本地 Python 实现。"""

    name = ""

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        """执行 Action；子类必须重写。"""

        raise NotImplementedError


@dataclass(frozen=True)
class ActionSpec:
    """运行时 Action 与它唯一一份 manifest 定义的组合。

    manifest 定义是参数、默认值、输出 schema 与重试安全性的唯一来源；
    下面的扁平属性都从它派生，方便引擎调用处保持简洁。
    """

    definition: ActionDefinition
    action: Action
    source: str = "builtin"

    @property
    def name(self) -> str:
        """Action 名称。"""

        return self.definition.name

    @property
    def version(self) -> str:
        """Action 版本。"""

        return self.definition.version

    @property
    def input_schema(self) -> dict[str, Any]:
        """入参 JSON schema。"""

        return self.definition.input_schema

    @property
    def output_schema(self) -> dict[str, Any]:
        """输出 JSON schema。"""

        return self.definition.output_schema

    @property
    def retry_safe(self) -> bool:
        """是否允许自动重试。"""

        return self.definition.retry_safe

    @property
    def side_effect(self) -> bool:
        """是否带有输入副作用。"""

        return self.definition.side_effect

    @property
    def description(self) -> str:
        """面向用户的描述。"""

        return self.definition.description


__all__ = ["Action", "ActionResult", "ActionSpec", "ActionStatus"]
