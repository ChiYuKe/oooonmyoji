"""Deterministic Behavior Tree v4 runtime."""

from __future__ import annotations

import json
import math
import queue
import threading
import time
from copy import deepcopy
from dataclasses import dataclass, field, replace
from typing import Any, Callable

from ..actions import ActionRegistry, ActionResult, ActionStatus
from ..exceptions import AutomationError, CancelledError, WorkflowError, WorkflowTimeoutError
from .compiler import CompiledWorkflow, compile_workflow
from .graph import GROUP_BOUNDARY_NODE_TYPES, PURE_DATA_NODE_TYPES
from .model import BehaviorDecorator, WorkflowNode, WorkflowSpec
from .resolver import ReferenceResolver


@dataclass(frozen=True)
class WorkflowResult:
    status: ActionStatus
    output: dict[str, Any] = field(default_factory=dict)
    error_category: str | None = None
    error: str | None = None
    current_step: str | None = None
    step_history: tuple[dict[str, Any], ...] = ()
    requires_worker_restart: bool = False


@dataclass(frozen=True)
class _Outcome:
    status: ActionStatus
    output: Any = None
    error: str | None = None
    category: str | None = None
    fatal: bool = False
    node_status: ActionStatus | None = None


class _ExecutionLimit(WorkflowError):
    pass


#: 状态机等待画面时的固定轮询间隔（秒）：等待预算按它折算成轮询次数。
_STATE_POLL_SECONDS = 0.1


def _json_safe(value: Any) -> Any:
    try:
        json.dumps(value, ensure_ascii=False, allow_nan=False)
        return value
    except (TypeError, ValueError) as exc:
        raise WorkflowError(f"Action output is not JSON serializable: {type(value).__name__}") from exc


def _summary(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _summary(child) for key, child in list(value.items())[:50]}
    if isinstance(value, list):
        return [_summary(child) for child in value[:50]]
    if isinstance(value, str) and len(value) > 1000:
        return value[:1000] + "..."
    return value


def _path_label(node: WorkflowNode | None, node_id: str) -> str:
    """面包屑里一个节点怎么显示：有名字就「名字 (id)」，否则只用 id。"""

    name = node.name if node is not None else None
    if isinstance(name, str) and name.strip() and name.strip() != node_id:
        return f"{name.strip()} ({node_id})"
    return node_id


def _condition_branch(node: WorkflowNode, port: str) -> str | None:
    """判断节点上挂在某个口（true/false）的子节点 id；该口空着就返回 None。

    `ports` 与 `children` 对齐；老文档没写 `ports` 时按位置推导（0=真、1=假）。
    """

    ports = node.ports if len(node.ports) == len(node.children) else tuple(
        "true" if index == 0 else "false" for index in range(len(node.children))
    )
    for index, child_id in enumerate(node.children):
        if ports[index] == port:
            return child_id
    return None


class WorkflowEngine:
    def __init__(
        self,
        workflow: WorkflowSpec,
        registry: ActionRegistry,
        context: Any,
        inputs: dict[str, Any],
        *,
        on_step: Callable[[dict[str, Any]], None] | None = None,
        on_step_start: Callable[[dict[str, Any]], None] | None = None,
        cancel_event: Any | None = None,
        cancel_grace_seconds: float = 1.0,
        workflow_path: tuple[str, ...] | None = None,
    ) -> None:
        self.workflow = workflow
        self.registry = registry
        self.context = context
        self.inputs = inputs
        self.variables = deepcopy(workflow.variable_defaults)
        self.on_step = on_step
        self.on_step_start = on_step_start
        self.cancel_event = cancel_event
        self.cancel_grace_seconds = cancel_grace_seconds
        self.workflow_path = workflow_path or (workflow.workflow_id,)
        self.outputs: dict[str, Any] = {}
        self.history: list[dict[str, Any]] = []
        self.requires_worker_restart = False
        self.compiled: CompiledWorkflow = compile_workflow(workflow, registry)
        self._lock = threading.RLock()
        self._steps = 0
        self._cooldowns: dict[str, float] = {}
        self._done_once: set[str] = set()
        self._data_node_last_event: dict[str, tuple[str, Any]] = {}
        self._runtime_local = threading.local()
        self._workflow_deadline = 0.0
        self._current_step: str | None = None

    def run(self) -> WorkflowResult:
        with self._lock:
            self.variables = deepcopy(self.workflow.variable_defaults)
            self.outputs = {}
            self.history = []
            self.requires_worker_restart = False
            self._steps = 0
            self._cooldowns = {}
            self._done_once = set()
            self._data_node_last_event = {}
            self._current_step = None
        self._workflow_deadline = (
            time.monotonic() + self.workflow.timeout_seconds
            if self.workflow.timeout_seconds is not None
            else math.inf
        )
        if hasattr(self.context, "set_deadline"):
            self.context.set_deadline(self._workflow_deadline)
        try:
            for name, definition in self.workflow.raw.get("variables", {}).items():
                source = definition.get("initial_from")
                if source is not None and source in self.inputs:
                    self._validate_action_input(self.workflow.variable_schema["properties"][name], self.inputs[source], f"variable {name}")
                    self.variables[name] = deepcopy(self.inputs[source])
            outcome = self._run_node(self.compiled.root, self._workflow_deadline, None)
        except CancelledError as exc:
            outcome = _Outcome(ActionStatus.CANCELLED, error=str(exc), category="cancelled")
        except _ExecutionLimit as exc:
            outcome = _Outcome(ActionStatus.FAILED, error=str(exc), category="workflow_limit", fatal=True)
        except WorkflowTimeoutError as exc:
            outcome = _Outcome(ActionStatus.FAILED, error=str(exc), category="workflow_timeout", fatal=True)
        except AutomationError as exc:
            outcome = _Outcome(ActionStatus.FAILED, error=str(exc), category=getattr(exc.category, "value", "workflow"), fatal=True)
        except Exception as exc:
            outcome = _Outcome(ActionStatus.FAILED, error=str(exc), category="internal", fatal=True)
        with self._lock:
            output = dict(self.outputs)
            history = tuple(self.history)
            current = self._current_step
        return WorkflowResult(
            status=outcome.status,
            output=output,
            error_category=outcome.category,
            error=outcome.error,
            current_step=current if outcome.status != ActionStatus.SUCCEEDED else None,
            step_history=history,
            requires_worker_restart=self.requires_worker_restart,
        )

    def _repeat_stack(self) -> list[dict[str, Any]]:
        stack = getattr(self._runtime_local, "repeat_stack", None)
        if stack is None:
            stack = []
            self._runtime_local.repeat_stack = stack
        return stack

    def _resolver(self) -> ReferenceResolver:
        stack = self._repeat_stack()
        runtime = {"repeat": dict(stack[-1])} if stack else {}
        with self._lock:
            return ReferenceResolver(
                self.inputs,
                self.outputs,
                runtime,
                variables=dict(self.variables),
                resolve_output=self._evaluate_data_node,
                is_data_node=self._is_data_node,
            )

    def _is_data_node(self, node_id: str) -> bool:
        node = self.compiled.node_map.get(node_id)
        return node is not None and node.type in PURE_DATA_NODE_TYPES

    def _evaluate_data_node(self, node_id: str) -> None:
        """纯数据节点（布尔判断 / 拆分）的按需求值。

        它们不在执行树里，所以在这里按需求值——**每次被拉取都重算**：卡片算的是
        「这一刻的值」，循环里 `classify` 每轮都刷新输出，卡片也必须跟着刷新，
        否则第二轮会拿着第一轮的旧结论做分支。步骤事件只在值真的变了（或第一次算）时
        记一条，循环里不会把日志刷满。
        """

        node = self.compiled.node_map.get(node_id)
        if node is None or node.type not in PURE_DATA_NODE_TYPES:
            return
        existing_evaluating = getattr(self._runtime_local, "evaluating_data_nodes", None)
        if isinstance(existing_evaluating, set):
            evaluating: set[str] = existing_evaluating
        else:
            evaluating = set()
            self._runtime_local.evaluating_data_nodes = evaluating
        if node_id in evaluating:
            raise WorkflowError(f"cyclic pure data reference: {node_id}")
        evaluating.add(node_id)
        # 值卡片不在执行树里：被别的节点按需拉起时，它不属于那个节点的子树，
        # 路径只写它自己；执行树里走到它（老文档）时才有真实祖先。
        path_ids, path_names, _ = self._node_path(node_id, ancestors=[] if node_id not in self._node_stack() else None)
        started_perf = time.perf_counter()
        started_at = time.time()
        try:
            with self._lock:
                allowed = self._resolver().condition(node.expression) if node.type == "bool_judge" else None
                if node.type == "bool_judge":
                    output: Any = {"value": bool(allowed)}
                else:
                    ref = str(node.ref["ref"]) if isinstance(node.ref, dict) and isinstance(node.ref.get("ref"), str) else ""
                    value = self._resolver().reference(ref)
                    if node.fields:
                        output = {}
                        for field_name, field_path in node.fields.items():
                            current = value
                            for segment in field_path.split("."):
                                if isinstance(current, dict) and segment in current:
                                    current = current[segment]
                                elif isinstance(current, list) and segment.isdigit() and int(segment) < len(current):
                                    current = current[int(segment)]
                                else:
                                    raise WorkflowError(f"break node failed: field {field_name} path '{field_path}' is unavailable")
                            output[field_name] = current
                    else:
                        output = value
                self.outputs[node_id] = output
        except Exception as exc:
            error = str(exc)
            if self._data_node_last_event.get(node_id) != ("failed", error):
                self._data_node_last_event[node_id] = ("failed", error)
                self._notify_start(node, path=(path_ids, path_names))
                self._record_node(
                    node,
                    _Outcome(
                        ActionStatus.FAILED,
                        error=error,
                        category="condition" if node.type == "bool_judge" else "break",
                    ),
                    started_perf,
                    started_at,
                    path=(path_ids, path_names),
                )
            raise
        finally:
            evaluating.remove(node_id)
            if not evaluating:
                del self._runtime_local.evaluating_data_nodes
        if self._data_node_last_event.get(node_id) != ("succeeded", output):
            self._data_node_last_event[node_id] = ("succeeded", output)
            self._notify_start(node, path=(path_ids, path_names))
            self._record_node(node, _Outcome(ActionStatus.SUCCEEDED, output=output), started_perf, started_at, path=(path_ids, path_names))

    def _node_stack(self) -> list[str]:
        """当前线程「根 → 正在执行的节点」的祖先链（最深的在末尾）。"""

        stack = getattr(self._runtime_local, "node_stack", None)
        if stack is None:
            stack = []
            self._runtime_local.node_stack = stack
        return stack

    def _node_path(self, node_id: str, ancestors: list[str] | None = None) -> tuple[list[str], list[str], list[WorkflowNode | None]]:
        """把一个节点摊成执行路径：节点 id 列表、显示名列表与对应节点对象。

        `ancestors` 省略时取当前线程的执行栈；栈顶就是正在执行的节点，
        所以只在「栈里还没有它」时补上。纯数据卡片不在执行树里，由调用方
        显式传空表，避免把它挂到「碰巧正在执行」的节点下面。
        """

        if ancestors is None:
            with self._lock:
                ancestors = list(self._node_stack())
        ids = [*ancestors, node_id] if not ancestors or ancestors[-1] != node_id else ancestors
        nodes = [self.compiled.node_map.get(value) for value in ids]
        return ids, [_path_label(node, value) for node, value in zip(nodes, ids)], nodes

    def _run_node(self, node_id: str, deadline: float, branch_cancel: threading.Event | None) -> _Outcome:
        local = {name: definition for name, definition in self.workflow.raw.get("variables", {}).items() if definition.get("owner") == node_id}
        with self._lock:
            saved = {name: deepcopy(self.variables[name]) for name in local}
            for name, definition in local.items():
                self.variables[name] = deepcopy(self.inputs.get(definition.get("initial_from"), self.workflow.variable_defaults[name]))
        stack = self._node_stack()
        stack.append(node_id)
        try:
            return self._run_node_scoped(node_id, deadline, branch_cancel)
        finally:
            stack.pop()
            with self._lock:
                self.variables.update(saved)

    def _run_node_scoped(self, node_id: str, deadline: float, branch_cancel: threading.Event | None) -> _Outcome:
        self._ensure_running(deadline, branch_cancel)
        with self._lock:
            if self.workflow.max_steps is not None and self._steps >= self.workflow.max_steps:
                raise _ExecutionLimit("workflow max_steps exceeded")
            self._steps += 1
            self._current_step = node_id
        node = self.compiled.node_map[node_id]
        if node.type in PURE_DATA_NODE_TYPES:
            # 老文档仍可能把值卡片挂进执行树：走到这里就当成「按需求值」，
            # 失败记成这条路径上的失败结果，而不是把异常抛穿整棵树。
            try:
                self._evaluate_data_node(node.id)
            except Exception as exc:
                return _Outcome(
                    ActionStatus.FAILED,
                    error=str(exc),
                    category="condition" if node.type == "bool_judge" else "break",
                )
            with self._lock:
                output = self.outputs.get(node.id)
            return _Outcome(ActionStatus.SUCCEEDED, output=output)
        started_perf = time.perf_counter()
        started_at = time.time()
        self._notify_start(node)

        cooldown = self._decorator(node, "cooldown")
        if cooldown is not None:
            with self._lock:
                remaining = self._cooldowns.get(node.id, 0.0) - time.monotonic()
            if remaining > 0:
                outcome = _Outcome(ActionStatus.FAILED, error=f"cooldown active for {remaining:.3f}s", category="cooldown")
                self._record_node(node, outcome, started_perf, started_at, decorator="cooldown")
                return outcome

        do_once = self._decorator(node, "do_once")
        if do_once is not None:
            with self._lock:
                already_done = node.id in self._done_once
            if already_done:
                outcome = _Outcome(ActionStatus.SUCCEEDED)
                self._record_node(node, outcome, started_perf, started_at, decorator="do_once")
                return outcome

        timeout = self._decorator(node, "timeout")
        retry = self._decorator(node, "retry")
        repeat = self._decorator(node, "repeat")
        force_success = self._decorator(node, "force_success")
        resolved = {}
        decorator_specs: list[tuple[str, BehaviorDecorator | None, tuple[str, ...]]] = [
            ("cooldown", cooldown, ("seconds",)), ("timeout", timeout, ("seconds",)),
            ("retry", retry, ("attempts", "delay_seconds")), ("do_once", do_once, ("reset_on_failure",)),
        ]
        for kind, active, keys in decorator_specs:
            if active is None:
                continue
            try:
                with self._lock:
                    values = {key: self._resolver().value(getattr(active, key)) for key in keys}
                for key, value in values.items():
                    if key == "reset_on_failure":
                        valid = isinstance(value, bool)
                    elif key == "attempts":
                        valid = not isinstance(value, bool) and isinstance(value, int) and value >= 1
                    else:
                        valid = not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value) and (value >= 0 if key == "delay_seconds" else value > 0)
                    if not valid:
                        raise ValueError(f"invalid resolved {key}: {value!r}")
                resolved[kind] = values
            except Exception as exc:
                outcome = _Outcome(ActionStatus.FAILED, error=f"{kind} decorator failed: {exc}", category="workflow")
                self._record_node(node, outcome, started_perf, started_at, decorator=kind)
                return outcome
        node_deadline = min(deadline, time.monotonic() + resolved["timeout"]["seconds"]) if timeout is not None else deadline
        attempts = resolved["retry"]["attempts"] if retry is not None else 1
        retry_delay = resolved["retry"]["delay_seconds"] if retry is not None else 0
        repeat_count = 1
        if repeat is not None:
            try:
                with self._lock:
                    resolved_count = self._resolver().value(repeat.count)
                if isinstance(resolved_count, bool) or not isinstance(resolved_count, int) or resolved_count < 1:
                    raise ValueError("repeat count must resolve to a positive integer")
                repeat_count = resolved_count
            except Exception as exc:
                outcome = _Outcome(ActionStatus.FAILED, error=f"repeat decorator failed: {exc}", category="workflow")
                self._record_node(node, outcome, started_perf, started_at, decorator="repeat")
                return outcome
        outcome = _Outcome(ActionStatus.FAILED, error="node did not execute", category="workflow")
        attempts_used = 0
        repeats_used = 0
        try:
            for repeat_index in range(repeat_count):
                repeats_used = repeat_index + 1
                repeat_stack = self._repeat_stack()
                if repeat is not None:
                    repeat_stack.append({
                        "index": repeat_index + 1,
                        "count": repeat_count,
                        "final": repeat_index + 1 == repeat_count,
                    })
                try:
                    for attempt in range(1, attempts + 1):
                        attempts_used += 1
                        self._ensure_running(node_deadline, branch_cancel)
                        outcome = self._run_core(node, node_deadline, branch_cancel)
                        if outcome.status != ActionStatus.FAILED or outcome.fatal:
                            break
                        if attempt < attempts and retry_delay:
                            self._sleep(retry_delay, node_deadline, branch_cancel)
                finally:
                    if repeat is not None:
                        repeat_stack.pop()
                if outcome.status != ActionStatus.SUCCEEDED:
                    break
        except _ExecutionLimit:
            raise
        except WorkflowTimeoutError as exc:
            category = "workflow_timeout" if time.monotonic() >= self._workflow_deadline else "node_timeout"
            outcome = _Outcome(ActionStatus.FAILED, error=str(exc), category=category, fatal=category == "workflow_timeout")
        except CancelledError as exc:
            outcome = _Outcome(ActionStatus.CANCELLED, error=str(exc), category="cancelled")
        except AutomationError as exc:
            outcome = _Outcome(ActionStatus.FAILED, error=str(exc), category=getattr(exc.category, "value", "workflow"))
        except Exception as exc:
            outcome = _Outcome(ActionStatus.FAILED, error=str(exc), category="internal")

        if cooldown is not None and cooldown.seconds is not None:
            with self._lock:
                self._cooldowns[node.id] = time.monotonic() + resolved["cooldown"]["seconds"]
        # Force Success（UE `UBTDecorator_ForceSuccess`：Change node result to Success，用途是
        # 「creating optional branches in sequence」）：把这个节点对外的失败改写成成功，于是父
        # 组合节点（Sequence）会继续往下走 —— 也就是"这一步失败也不中断"。
        #
        # 只改写 Failed：取消（UE 的 Aborted）与 fatal（要求重启工作进程）照旧向上传递，
        # 把它们吞掉会让"停止"和"工作进程需要重启"这两个信号消失。
        #
        # 改写发生在 retry / repeat **之后**：重试与循环看的是真实结果，改写只决定这个节点
        # 最终向父节点汇报什么。do_once 与步骤记录看到的是改写后的结果（下面那段用 `outcome`），
        # 因此一个被强制成功的节点在 do_once 眼里就是成功。
        forced_from: _Outcome | None = None
        if force_success is not None and outcome.status == ActionStatus.FAILED and not outcome.fatal:
            forced_from, outcome = outcome, _Outcome(ActionStatus.SUCCEEDED, output=outcome.output)
        if do_once is not None and (outcome.status == ActionStatus.SUCCEEDED or not resolved["do_once"]["reset_on_failure"]):
            with self._lock:
                self._done_once.add(node.id)
        # 条件卡的执行结果会透传所选分支的返回值，但卡片状态只表示「判断并选中分支」；
        # 分支内部的失败由对应子节点显示，不能反向覆盖条件卡自己的状态。
        recorded_outcome = _Outcome(outcome.node_status) if node.type == "condition" and outcome.node_status else outcome
        self._record_node(node, recorded_outcome, started_perf, started_at, attempts=attempts_used, repeats=repeats_used, forced_from=forced_from)
        return outcome

    def _run_core(self, node: WorkflowNode, deadline: float, branch_cancel: threading.Event | None) -> _Outcome:
        if node.type == "condition":
            # 判断节点：求值一次，然后走「真口」或「假口」的那条分支（每口最多一个子节点）。
            # - 一个分支都没接 = 纯判断：成立成功、不成立失败（可当作叶子放进 Selector）；
            # - 接了分支但该口空着 = 这条路径没有内容，按失败返回，交给父节点决定
            #   （放在 Selector 里就是「这一支不命中」）。
            try:
                with self._lock:
                    allowed = self._resolver().condition(node.expression)
            except Exception as exc:
                return _Outcome(ActionStatus.FAILED, error=f"condition node failed: {exc}", category="condition")
            port = "true" if allowed else "false"
            branch = _condition_branch(node, port)
            if branch is not None:
                # 控制流仍透传分支结果给父节点；仅供本卡事件记录的 status 代表判断本身已完成。
                return replace(self._run_node(branch, deadline, branch_cancel), node_status=ActionStatus.SUCCEEDED)
            if not node.children:
                if allowed:
                    return _Outcome(ActionStatus.SUCCEEDED)
                return _Outcome(ActionStatus.FAILED, error="condition node evaluated to false", category="condition")
            return _Outcome(ActionStatus.FAILED, error=f"condition node has no {'true' if allowed else 'false'} branch", category="condition")
        if node.type == "bool_judge" or node.type == "break":
            # 值卡片不会走到这里：`_run_node_scoped` 在进 `_run_core` 之前就把它们交给
            # `_evaluate_data_node`（按需求值、带环检测、记步骤事件）。这里再写一份
            # 就会变成两套语义，所以取值逻辑只有那一份。
            raise WorkflowError(f"pure data node {node.id} must be evaluated on demand")
        if node.type == "task":
            return self._run_task(node, deadline, branch_cancel)
        if node.type == "root":
            return self._run_node(node.children[0], deadline, branch_cancel)
        if node.type in GROUP_BOUNDARY_NODE_TYPES:
            # 折叠图边界卡（编辑器里的节点组隧道）：单子透传，等价于只有一个子节点的
            # sequence，执行语义与「展开折叠图后 A→子节点 直接相连」完全一致。
            if len(node.children) != 1:
                raise WorkflowError(f"fold graph boundary node {node.id} must contain exactly one child")
            return self._run_node(node.children[0], deadline, branch_cancel)
        if node.type == "selector":
            last = _Outcome(ActionStatus.FAILED, error="all selector children failed", category="behavior")
            failed_branches: list[tuple[int, int]] = []
            for child_index, child_id in enumerate(node.children):
                # A selector failure is a branch miss as soon as control moves to
                # the next candidate. The final candidate remains the real failure
                # when every candidate fails, so the root cause stays visible.
                if child_index > 0 and failed_branches:
                    self._ensure_running(deadline, branch_cancel)
                    self._recover_selector_failures(node.id, failed_branches)
                    failed_branches = []
                with self._lock:
                    history_start = len(self.history)
                last = self._run_node(child_id, deadline, branch_cancel)
                with self._lock:
                    history_end = len(self.history)
                if last.status == ActionStatus.SUCCEEDED:
                    return last
                if last.status == ActionStatus.CANCELLED or last.fatal:
                    return last
                failed_branches.append((history_start, history_end))
            return last
        if node.type == "sequence":
            last = _Outcome(ActionStatus.SUCCEEDED)
            for child_id in node.children:
                last = self._run_node(child_id, deadline, branch_cancel)
                if last.status != ActionStatus.SUCCEEDED:
                    return last
            return last
        if node.type == "simple_parallel":
            return self._run_simple_parallel(node, deadline, branch_cancel)
        if node.type == "parallel":
            return self._run_parallel(node, deadline, branch_cancel)
        if node.type == "repeat_until":
            for _ in range(node.max_iterations):
                result = self._run_node(node.children[0], deadline, branch_cancel)
                if result.status != ActionStatus.SUCCEEDED:
                    return result
                with self._lock:
                    allowed = self._resolver().condition(node.condition)
                if allowed:
                    return result
            return _Outcome(ActionStatus.FAILED, error=f"repeat_until exceeded {node.max_iterations} iterations", category="workflow_limit")
        if node.type == "branch":
            for condition, child_id in zip(node.conditions, node.children):
                with self._lock:
                    allowed = self._resolver().condition(condition)
                if allowed:
                    return self._run_node(child_id, deadline, branch_cancel)
            return _Outcome(ActionStatus.FAILED, error="no branch condition matched", category="condition")
        if node.type == "switch":
            with self._lock:
                value = self._resolver().value(node.expression)
            for case_value, child_id in node.cases:
                if value == case_value:
                    return self._run_node(child_id, deadline, branch_cancel)
            if node.default_child is not None:
                return self._run_node(node.default_child, deadline, branch_cancel)
            return _Outcome(ActionStatus.FAILED, error="no switch case matched", category="condition")
        if node.type == "state_machine":
            return self._run_state_machine(node, deadline, branch_cancel)
        raise WorkflowError(f"unsupported Behavior Tree node type: {node.type}")

    def _state_machine_output(
        self,
        detected: dict[str, Any],
        iterations: int,
        terminal: bool,
        started: float,
    ) -> dict[str, Any]:
        """一次识别的观察结果：既作为状态机自己的输出，也作为处理子图能读到的「当前判断」。"""

        match = detected.get("match")
        return {
            "state": str(detected.get("state", "")),
            "source": str(detected.get("source", "")),
            "confidence": float(detected.get("confidence", 0.0)),
            "match": match if isinstance(match, dict) else {},
            "iterations": iterations,
            "terminal": terminal,
            "elapsed_seconds": round(time.monotonic() - started, 6),
        }

    def _run_state_machine(
        self,
        node: WorkflowNode,
        deadline: float,
        branch_cancel: threading.Event | None,
    ) -> _Outcome:
        """状态机卡片：判断当前画面 → 运行该状态的处理子图 → 重新判断，直到终止状态或轮数用尽。

        每个状态的处理子图就是一个普通子图（"函数"）；切换是隐式的——处理子图把画面推进到
        别的状态后，下一轮判断自然分发到新的处理子图。

        「判断画面」这一步由卡片上的 `state_action` 指定（默认 `vision.detect_state`），并且走
        **真正的 Action 调用**：判断语义只有一处实现，步骤历史/插件覆盖/测试替换都沿用同一条
        入口。判断成功后立刻把这一轮的观察结果登记成状态机的输出，处理子图据此就能拿到
        `nodes.<状态机>.output.match`——识别与点击因而不会各自漂移。
        """

        started = time.monotonic()
        try:
            detection = self.registry.get(node.state_action)
        except AutomationError as exc:
            return _Outcome(
                ActionStatus.FAILED,
                error=f"state_machine node {node.id} needs the {node.state_action} action: {exc}",
                category="workflow",
            )
        with self._lock:
            resolver = self._resolver()
        try:
            states = resolver.value([dict(state) for state in node.states])
            # 轮数预算可以绑到输入（迁移后的 `运行轮数` 就是这么传的），解析后必须是正整数。
            resolved_max = resolver.value(node.max_iterations)
            if isinstance(resolved_max, bool) or not isinstance(resolved_max, int) or resolved_max < 1:
                raise ValueError(f"max_iterations must resolve to a positive integer, got {resolved_max!r}")
        except Exception as exc:
            return _Outcome(
                ActionStatus.FAILED,
                error=f"state_machine node {node.id} is invalid: {exc}",
                category="workflow",
            )
        # 同一轮里先等一个可识别的画面：页面正在切换/加载时不该直接判失败或吃掉轮数。
        # 等待预算按固定轮询间隔折算成次数（确定性，且不依赖真实墙钟），`_sleep` 负责节奏。
        state_timeout = float(node.state_timeout_seconds or 0.0)
        max_polls = 1 if state_timeout <= 0 else max(1, int(round(state_timeout / _STATE_POLL_SECONDS)))
        dispatch = {str(value): child for value, child in node.cases}
        terminal = set(node.terminal_states)
        iterations = 0
        last: dict[str, Any] = {}
        for index in range(resolved_max):
            detected: dict[str, Any] | None = None
            for poll in range(max_polls):
                self._ensure_running(deadline, branch_cancel)
                outcome, detected = self._detect_state(detection, states, node, deadline, branch_cancel)
                if outcome is not None:
                    return outcome
                if detected is not None or poll + 1 >= max_polls:
                    break
                self._sleep(_STATE_POLL_SECONDS, deadline, branch_cancel)
            iterations = index + 1
            if detected is None:
                # 一个候选状态都没识别到：有 default 子图就交给它兜底，否则整机失败。
                if node.default_child is None:
                    return _Outcome(
                        ActionStatus.FAILED,
                        error=f"state_machine {node.id} matched none of the configured states",
                        category="not_matched",
                    )
                outcome = self._run_node(node.default_child, deadline, branch_cancel)
                if outcome.status != ActionStatus.SUCCEEDED:
                    # 兜底子图失败时把「一个状态都没识别到」也写进错误：根因常常在这里，
                    # 只报兜底子图的失败会让人以为是它自己坏了。
                    return _Outcome(
                        outcome.status,
                        output=outcome.output,
                        error=(
                            f"state_machine {node.id} matched none of the configured states and its "
                            f"default handler failed: {outcome.error}"
                        ),
                        category=outcome.category,
                        fatal=outcome.fatal,
                    )
                continue
            last = detected
            state = str(detected["state"])
            # 判断结果立刻登记成状态机的输出：处理子图（以及它们里面的动作）可以直接引用
            # `nodes.<状态机>.output.match` 把「命中在哪」交给点击，不必把模板参数抄一遍。
            observation = self._state_machine_output(detected, iterations, False, started)
            with self._lock:
                self.outputs[node.id] = observation
            if state in terminal:
                observation["terminal"] = True
                return _Outcome(ActionStatus.SUCCEEDED, output=observation)
            child = dispatch.get(state) or node.default_child
            if child is None:
                return _Outcome(
                    ActionStatus.FAILED,
                    error=f"state_machine {node.id} has no handler for state: {state}",
                    category="workflow",
                )
            outcome = self._run_node(child, deadline, branch_cancel)
            if outcome.status != ActionStatus.SUCCEEDED:
                # 失败即停：某个状态的函数失败就整机失败（需要重试的场合由该子图自己带 retry）。
                # 报错里带上状态名与判断结果，否则「哪个画面上的哪一步坏了」看不出来。
                return _Outcome(
                    outcome.status,
                    output=outcome.output,
                    error=(
                        f"state_machine {node.id}: handler for state '{state}' "
                        f"(iterations={iterations}, confidence={observation['confidence']}) failed: {outcome.error}"
                    ),
                    category=outcome.category,
                    fatal=outcome.fatal,
                )
        # 轮数预算用完 = 正常收工（`运行轮数` 的语义），不是错误：终止状态才是「提前结束」。
        output = self._state_machine_output(last, iterations, False, started)
        with self._lock:
            self.outputs[node.id] = output
        return _Outcome(ActionStatus.SUCCEEDED, output=output)

    def _detect_state(
        self,
        detection: Any,
        states: Any,
        node: WorkflowNode,
        deadline: float,
        branch_cancel: threading.Event | None,
    ) -> tuple[_Outcome | None, dict[str, Any] | None]:
        """跑一次分类动作（默认 `vision.detect_state`）：返回（致命结果, 识别结果）。

        只有「一个状态都没命中」是可等待的（``None`` + ``None``）；设备/识别层面的硬错误
        直接作为整机失败返回，免得把真实故障冒充成「画面不认识」。
        """

        arguments = {"states": states, "allow_ocr": node.allow_ocr}
        try:
            self._validate_action_input(detection.input_schema, arguments, node.id)
            result = self._execute(detection, arguments, deadline, branch_cancel)
        except CancelledError:
            raise
        except AutomationError as exc:
            return _Outcome(ActionStatus.FAILED, error=str(exc), category=getattr(exc.category, "value", "vision")), None
        except Exception as exc:
            return _Outcome(ActionStatus.FAILED, error=str(exc), category="internal"), None
        if result.status == ActionStatus.SUCCEEDED:
            try:
                detected = _json_safe(result.output)
            except AutomationError as exc:
                return _Outcome(ActionStatus.FAILED, error=str(exc), category="workflow"), None
            if not isinstance(detected, dict):
                return _Outcome(
                    ActionStatus.FAILED,
                    error=f"state_machine {node.id} state detection output must be an object",
                    category="workflow",
                ), None
            return None, detected
        if result.error_category == "not_matched":
            return None, None
        return (
            _Outcome(
                ActionStatus.FAILED,
                error=result.error or f"state_machine {node.id} state detection failed",
                category=result.error_category or "vision",
            ),
            None,
        )

    def _run_parallel(self, node: WorkflowNode, deadline: float, branch_cancel: threading.Event | None) -> _Outcome:
        cancel = threading.Event()
        outcomes: list[_Outcome | None] = [None] * len(node.children)
        threads: list[threading.Thread] = []

        runtime_stack = list(self._repeat_stack())

        def run_branch(index: int, child_id: str) -> None:
            self._runtime_local.repeat_stack = list(runtime_stack)
            try:
                outcomes[index] = self._run_node(child_id, deadline, cancel)
            except BaseException as exc:
                outcomes[index] = _Outcome(ActionStatus.FAILED, error=str(exc), category="parallel", fatal=True)
            finally:
                del self._runtime_local.repeat_stack

        for index, child_id in enumerate(node.children):
            thread = threading.Thread(target=run_branch, args=(index, child_id), name=f"bt-parallel-{child_id}", daemon=True)
            threads.append(thread)
            thread.start()
        while True:
            self._ensure_running(deadline, branch_cancel)
            completed = [outcome for outcome in outcomes if outcome is not None]
            if node.wait_for == "any" and any(outcome.status == ActionStatus.SUCCEEDED for outcome in completed):
                cancel.set()
                break
            if node.cancel_on_failure and any(outcome.status in {ActionStatus.FAILED, ActionStatus.CANCELLED} for outcome in completed):
                cancel.set()
                break
            if len(completed) == len(outcomes):
                break
            time.sleep(0.02)
        for thread in threads:
            thread.join(self.cancel_grace_seconds)
        completed = [outcome for outcome in outcomes if outcome is not None]
        if any(outcome.fatal for outcome in completed):
            return next(outcome for outcome in completed if outcome.fatal)
        if node.wait_for == "any":
            return next((outcome for outcome in completed if outcome.status == ActionStatus.SUCCEEDED), completed[0])
        return next((outcome for outcome in completed if outcome.status != ActionStatus.SUCCEEDED), _Outcome(ActionStatus.SUCCEEDED))

    def _run_simple_parallel(self, node: WorkflowNode, deadline: float, branch_cancel: threading.Event | None) -> _Outcome:
        main_id, background_id = node.children
        background_cancel = threading.Event()
        finished = threading.Event()
        result_box: list[_Outcome] = []

        runtime_stack = list(self._repeat_stack())

        def background() -> None:
            self._runtime_local.repeat_stack = list(runtime_stack)
            try:
                result_box.append(self._run_node(background_id, deadline, background_cancel))
            except BaseException as exc:
                result_box.append(_Outcome(ActionStatus.FAILED, error=str(exc), category="parallel", fatal=True))
            finally:
                del self._runtime_local.repeat_stack
                finished.set()

        thread = threading.Thread(target=background, name=f"bt-background-{background_id}", daemon=True)
        thread.start()
        main = self._run_node(main_id, deadline, branch_cancel)
        if node.finish_mode == "abort_background":
            background_cancel.set()
            thread.join(self.cancel_grace_seconds)
            if thread.is_alive():
                self.requires_worker_restart = True
            return main

        while not finished.wait(0.05):
            self._ensure_running(deadline, branch_cancel)
        background_result = result_box[0]
        if background_result.fatal:
            return background_result
        return main

    def _run_task(self, node: WorkflowNode, deadline: float, branch_cancel: threading.Event | None) -> _Outcome:
        assert node.action is not None
        action = self.registry.get(node.action)
        with self._lock:
            resolver = self._resolver()
        try:
            arguments = deepcopy(resolver.value(node.params))
            self._validate_action_input(action.input_schema, arguments, node.id)
            result = self._execute(action, arguments, deadline, branch_cancel)
        except CancelledError:
            raise
        except AutomationError as exc:
            return _Outcome(ActionStatus.FAILED, error=str(exc), category=getattr(exc.category, "value", "action"))
        except Exception as exc:
            return _Outcome(ActionStatus.FAILED, error=str(exc), category="internal")
        output = None
        if result.output is not None:
            try:
                output = _json_safe(result.output)
            except AutomationError as exc:
                return _Outcome(ActionStatus.FAILED, error=str(exc), category=getattr(exc.category, "value", "workflow"))
        if result.status == ActionStatus.SUCCEEDED:
            with self._lock:
                self.outputs[node.id] = output
            return _Outcome(ActionStatus.SUCCEEDED, output=output)
        if result.status == ActionStatus.CANCELLED:
            return _Outcome(
                ActionStatus.CANCELLED,
                output=output,
                error=result.error,
                category=result.error_category or "cancelled",
            )
        return _Outcome(
            ActionStatus.FAILED,
            output=output,
            error=result.error,
            category=result.error_category or "action",
            fatal=self.requires_worker_restart,
        )

    def _execute(self, action: Any, arguments: dict[str, Any], deadline: float, branch_cancel: threading.Event | None) -> ActionResult:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise WorkflowTimeoutError("Behavior Tree node timed out")
        token: Any = None
        if hasattr(self.context, "begin_action"):
            token = self.context.begin_action()
        result_queue: queue.Queue[ActionResult | BaseException] = queue.Queue(maxsize=1)

        def call() -> None:
            try:
                if token is not None and hasattr(self.context, "bind_action"):
                    self.context.bind_action(token)
                result_queue.put(action.action.execute(self.context, arguments))
            except BaseException as exc:
                result_queue.put(exc)
            finally:
                if token is not None and hasattr(self.context, "end_action"):
                    self.context.end_action(token)

        thread = threading.Thread(target=call, daemon=True)
        thread.start()
        while thread.is_alive():
            cancelled = (self.cancel_event is not None and self.cancel_event.is_set()) or (branch_cancel is not None and branch_cancel.is_set())
            if cancelled:
                self._request_action_cancel(token)
                thread.join(self.cancel_grace_seconds)
                if thread.is_alive():
                    self.requires_worker_restart = True
                else:
                    completed = result_queue.get_nowait()
                    if isinstance(completed, ActionResult) and completed.status == ActionStatus.CANCELLED:
                        return completed
                return ActionResult.cancelled("Behavior Tree branch cancellation requested")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            thread.join(min(0.05, remaining))
        if thread.is_alive():
            self._request_action_cancel(token)
            thread.join(self.cancel_grace_seconds)
            if thread.is_alive():
                self.requires_worker_restart = True
            category = "workflow_timeout" if time.monotonic() >= self._workflow_deadline else "action_timeout"
            return ActionResult.failed("Action timed out", category=category)
        result = result_queue.get_nowait()
        if isinstance(result, BaseException):
            raise result
        if not isinstance(result, ActionResult):
            raise WorkflowError(f"Action returned invalid result type: {type(result).__name__}")
        if result.status not in {ActionStatus.SUCCEEDED, ActionStatus.FAILED, ActionStatus.CANCELLED}:
            raise WorkflowError(f"Action returned invalid status: {result.status!r}")
        if result.status == ActionStatus.SUCCEEDED:
            self._validate_action_output(action.output_schema, result.output, action.name)
        return result

    def _request_action_cancel(self, token: Any) -> None:
        if not hasattr(self.context, "request_action_cancel"):
            return
        try:
            self.context.request_action_cancel(token)
        except TypeError:
            self.context.request_action_cancel()

    def _decorator(self, node: WorkflowNode, kind: str) -> BehaviorDecorator | None:
        return next((decorator for decorator in node.decorators if decorator.type == kind), None)

    def _event_params(self, node: WorkflowNode) -> Any:
        if not node.is_task:
            return None
        try:
            with self._lock:
                resolver = self._resolver()
            return _summary(resolver.value(node.params))
        except Exception:
            # A failed reference is still useful in the event as its unresolved source.
            return _summary(node.params)

    def _notify_start(self, node: WorkflowNode, *, path: tuple[list[str], list[str]] | None = None) -> None:
        if self.on_step_start is None:
            return
        if path is None:
            path_ids, path_names, _ = self._node_path(node.id)
        else:
            path_ids, path_names = path
        event = {
            "step_id": node.id,
            "name": node.name,
            "action": node.action,
            "node_kind": node.type,
            "node_type": node.type,
            "execution_index": self.compiled.execution_index[node.id],
            "status": "running",
            "workflow_id": self.workflow.workflow_id,
            "workflow_path": list(self.workflow_path),
            "workflow_depth": len(self.workflow_path) - 1,
            "node_path": path_ids,
            "node_path_names": path_names,
            "breadcrumb": " → ".join(path_names),
            "ts": time.time(),
        }
        if node.is_task:
            event["params"] = self._event_params(node)
        self.on_step_start(event)

    def _record_node(
        self,
        node: WorkflowNode,
        outcome: _Outcome,
        started_perf: float,
        started_at: float,
        *,
        attempts: int = 0,
        repeats: int = 0,
        decorator: str | None = None,
        forced_from: _Outcome | None = None,
        path: tuple[list[str], list[str]] | None = None,
    ) -> None:
        if path is None:
            path_ids, path_names, _ = self._node_path(node.id)
        else:
            path_ids, path_names = path
        breadcrumb = " → ".join(path_names)
        event: dict[str, Any] = {
            "step_id": node.id,
            "name": node.name,
            "action": node.action,
            "node_kind": node.type,
            "node_type": node.type,
            "execution_index": self.compiled.execution_index[node.id],
            "status": outcome.status.value,
            "workflow_id": self.workflow.workflow_id,
            "workflow_path": list(self.workflow_path),
            "workflow_depth": len(self.workflow_path) - 1,
            "node_path": path_ids,
            "node_path_names": path_names,
            "breadcrumb": breadcrumb,
            "started_at": started_at,
            "duration_ms": round((time.perf_counter() - started_perf) * 1000, 3),
        }
        if attempts > 1:
            event["attempts"] = attempts
        if repeats > 1:
            event["repeats"] = repeats
        if decorator is not None:
            event["decorator"] = decorator
        if forced_from is not None:
            # 这一步的失败被 `force_success` 改写成成功：状态按**父节点看到的结果**记（succeeded），
            # 原始失败另存一份，运行日志里仍能看清这一步实际发生了什么。
            # `original_status` 沿用 `branch_miss` 已有的约定（见 `_recover_selector_failures`），
            # 于是 `_failed_node_event` 也不会把它当成真正的失败位置。
            event["forced_success"] = True
            event["original_status"] = forced_from.status.value
            if forced_from.error:
                event["original_error"] = forced_from.error
            if forced_from.category:
                event["original_error_category"] = forced_from.category
        if node.is_task:
            event["params"] = self._event_params(node)
        if outcome.output is not None and node.produces_output:
            event["output"] = _summary(outcome.output)
        if outcome.error:
            event["error"] = outcome.error
            # 失败定位：这条错误落在「根 → … → 失败节点」的哪条链路上。
            event["error_path"] = path_ids
            event["error_breadcrumb"] = breadcrumb
        if outcome.category:
            event["error_category"] = outcome.category
        with self._lock:
            event["variable_values"] = _summary(deepcopy(self.variables))
            self.history.append(dict(event))
            if self.on_step is not None:
                self.on_step(dict(event))

    def _recover_selector_failures(self, selector_id: str, ranges: list[tuple[int, int]]) -> None:
        recovered: list[dict[str, Any]] = []
        selector = self.compiled.node_map.get(selector_id)
        selector_name = selector.name if selector is not None else None
        with self._lock:
            for start, end in ranges:
                for event in self.history[start:end]:
                    if event.get("status") != ActionStatus.FAILED.value:
                        continue
                    event["status"] = "branch_miss"
                    event["original_status"] = ActionStatus.FAILED.value
                    event["recovered_by"] = selector_id
                    if selector_name:
                        event["recovered_by_name"] = selector_name
                    recovered.append(dict(event))
        if self.on_step is not None:
            for event in recovered:
                self.on_step(event)

    def _ensure_running(self, deadline: float, branch_cancel: threading.Event | None) -> None:
        if branch_cancel is not None and branch_cancel.is_set():
            raise CancelledError("Behavior Tree branch cancellation requested")
        if self.cancel_event is not None and self.cancel_event.is_set():
            raise CancelledError("workflow cancellation requested")
        self.context.check_cancelled()
        if time.monotonic() >= deadline:
            message = "workflow timeout exceeded" if deadline == self._workflow_deadline else "Behavior Tree node timed out"
            raise WorkflowTimeoutError(message)

    def _sleep(self, seconds: float, deadline: float, branch_cancel: threading.Event | None) -> None:
        end = min(time.monotonic() + seconds, deadline)
        while time.monotonic() < end:
            self._ensure_running(deadline, branch_cancel)
            time.sleep(min(0.05, end - time.monotonic()))

    def _validate_action_input(self, schema: dict[str, Any], arguments: Any, node_id: str) -> None:
        try:
            from jsonschema import Draft202012Validator
        except ImportError as exc:
            raise WorkflowError("jsonschema is required for Action validation", cause=exc) from exc
        error = next(iter(Draft202012Validator(schema).iter_errors(arguments)), None)
        if error is not None:
            raise WorkflowError(f"node {node_id} Action arguments: {error.message}")

    def _validate_action_output(self, schema: dict[str, Any], output: Any, action_name: str) -> None:
        if not schema:
            return
        try:
            from jsonschema import Draft202012Validator
        except ImportError as exc:
            raise WorkflowError("jsonschema is required for Action validation", cause=exc) from exc
        error = next(iter(Draft202012Validator(schema).iter_errors(output)), None)
        if error is not None:
            raise WorkflowError(f"Action {action_name} output: {error.message}")


__all__ = ["WorkflowEngine", "WorkflowResult"]
