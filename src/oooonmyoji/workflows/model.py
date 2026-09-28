"""Immutable Behavior Tree workflow snapshots."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path
from typing import Any

NODE_TYPES = ("root", "selector", "sequence", "simple_parallel", "parallel", "repeat_until", "branch", "switch", "state_machine", "instance_parallel", "condition", "bool_judge", "break", "task", "group_entry", "group_exit")
DECORATOR_TYPES = ("cooldown", "timeout", "retry", "repeat", "do_once", "force_success")
PARALLEL_FINISH_MODES = ("abort_background", "wait_for_background")
INSTANCE_PARALLEL_WAIT_MODES = ("all", "any")

#: 布尔判断卡片（`bool_judge`）执行成功后的输出形状：引用写作 `nodes.<id>.output.value`。
BOOL_JUDGE_OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"value": {"type": "boolean"}},
    "required": ["value"],
    "additionalProperties": False,
}

#: 区域四元组 `[x, y, w, h]`。
RECT_SCHEMA: dict[str, Any] = {
    "type": "array",
    "prefixItems": [{"type": "integer"}, {"type": "integer"}, {"type": "integer"}, {"type": "integer"}],
    "minItems": 4,
    "maxItems": 4,
}

#: 状态机卡片（`state_machine`）里单个状态的识别载荷：与 `vision.detect_state` 的
#: `states` 参数同一套语义（模板优先、全部未命中才降级 OCR），所以 schema 也保持同形。
STATE_CANDIDATE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["name"],
    "properties": {
        "name": {"type": "string", "minLength": 1},
        "template": {"type": "string", "minLength": 1},
        "templates": {"type": "array", "items": {"type": "string", "minLength": 1}, "minItems": 1},
        "roi": deepcopy(RECT_SCHEMA),
        "threshold": {"type": "number", "minimum": 0, "maximum": 1},
        "scale_search": {"type": "boolean"},
        "texts": {"type": "array", "items": {"type": "string", "minLength": 1}},
        "text_roi": deepcopy(RECT_SCHEMA),
        "min_confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "required_texts": {"type": "array", "items": {"type": "string", "minLength": 1}},
        "required_text_roi": deepcopy(RECT_SCHEMA),
        "required_text_min_confidence": {"type": "number", "minimum": 0, "maximum": 1},
    },
    "additionalProperties": False,
}

#: 状态机卡片的 `states` 字段形状（编译/校验期按它检查字面量与绑定类型）。
STATE_CANDIDATES_SCHEMA: dict[str, Any] = {
    "type": "array",
    "minItems": 1,
    "items": deepcopy(STATE_CANDIDATE_SCHEMA),
}

#: 状态机卡片执行成功后的输出：最后一次识别结果 + 诊断计数，引用写作
#: `nodes.<id>.output.state` / `.match` / `.iterations` / `.terminal` / `.elapsed_seconds`。
#:
#: 注意 `match`：**每一轮识别成功后都会刷新这份输出**，所以状态机的处理子图可以直接引用
#: `nodes.<状态机>.output.match` 把「判断出来命中在哪」交给点击/OCR 等动作（原工作流里
#: `classify:out.match -> tap:match` 的那条数据流）。
STATE_MACHINE_OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "state": {"type": "string"},
        "source": {"type": "string"},
        "confidence": {"type": "number"},
        "match": {"type": "object"},
        "iterations": {"type": "integer"},
        "terminal": {"type": "boolean"},
        "elapsed_seconds": {"type": "number"},
    },
    "required": ["state", "iterations", "terminal", "elapsed_seconds"],
    "additionalProperties": False,
}

#: 状态机卡片默认用来「判断当前画面」的 Action：接受 `states` + `allow_ocr`，
#: 返回 `{state, source, confidence, match}`。换个实现只要换成满足同一契约的 Action。
DEFAULT_STATE_ACTION = "vision.detect_state"


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
    max_iterations: Any = 100
    expression: Any = None
    ref: Any = None
    fields: dict[str, str] = field(default_factory=dict)
    cases: tuple[tuple[Any, str], ...] = ()
    default_child: str | None = None
    ports: tuple[str, ...] = ()
    states: tuple[dict[str, Any], ...] = ()
    terminal_states: tuple[str, ...] = ()
    allow_ocr: bool = True
    state_timeout_seconds: Any = 0.0
    state_action: str = DEFAULT_STATE_ACTION

    @property
    def is_task(self) -> bool:
        return self.type == "task"

    @property
    def produces_output(self) -> bool:
        """执行成功后会登记 ``nodes.<id>.output`` 的节点：Task、布尔判断卡片、拆分卡片与状态机。"""

        return self.type in {"task", "bool_judge", "break", "state_machine"}


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
    "DEFAULT_STATE_ACTION",
    "INSTANCE_PARALLEL_WAIT_MODES",
    "InstanceParallelRun",
    "NODE_TYPES",
    "PARALLEL_FINISH_MODES",
    "RECT_SCHEMA",
    "STATE_CANDIDATES_SCHEMA",
    "STATE_CANDIDATE_SCHEMA",
    "STATE_MACHINE_OUTPUT_SCHEMA",
    "BehaviorDecorator",
    "WorkflowNode",
    "WorkflowSpec",
]
