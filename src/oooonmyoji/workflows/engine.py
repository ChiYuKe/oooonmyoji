"""Deterministic Behavior Tree v3 runtime."""

from __future__ import annotations

import json
import queue
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from ..actions import ActionRegistry, ActionResult, ActionStatus
from ..exceptions import AutomationError, CancelledError, WorkflowError, WorkflowTimeoutError
from .compiler import CompiledWorkflow, compile_workflow
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


class _ExecutionLimit(WorkflowError):
    pass


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
        self.blackboard = inputs
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
        self._runtime_local = threading.local()
        self._workflow_deadline = 0.0
        self._current_step: str | None = None

    def run(self) -> WorkflowResult:
        with self._lock:
            self.outputs = {}
            self.history = []
            self.requires_worker_restart = False
            self._steps = 0
            self._cooldowns = {}
            self._done_once = set()
            self._current_step = None
        self._workflow_deadline = time.monotonic() + self.workflow.timeout_seconds
        if hasattr(self.context, "set_deadline"):
            self.context.set_deadline(self._workflow_deadline)
        try:
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
            return ReferenceResolver(self.blackboard, dict(self.outputs), runtime)

    def _run_node(self, node_id: str, deadline: float, branch_cancel: threading.Event | None) -> _Outcome:
        self._ensure_running(deadline, branch_cancel)
        with self._lock:
            if self._steps >= self.workflow.max_steps:
                raise _ExecutionLimit("workflow max_steps exceeded")
            self._steps += 1
            self._current_step = node_id
        node = self.compiled.node_map[node_id]
        started_perf = time.perf_counter()
        started_at = time.time()
        self._notify_start(node)

        for decorator in node.decorators:
            if decorator.type != "condition":
                continue
            try:
                with self._lock:
                    resolver = self._resolver()
                allowed = resolver.condition(decorator.expression)
            except Exception as exc:
                outcome = _Outcome(ActionStatus.FAILED, error=f"condition decorator failed: {exc}", category="condition")
                self._record_node(node, outcome, started_perf, started_at, decorator="condition")
                return outcome
            if not allowed:
                outcome = _Outcome(ActionStatus.FAILED, error="condition decorator rejected branch", category="condition")
                self._record_node(node, outcome, started_perf, started_at, decorator="condition")
                return outcome

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
        node_deadline = min(deadline, time.monotonic() + timeout.seconds) if timeout is not None and timeout.seconds is not None else deadline
        retry = self._decorator(node, "retry")
        repeat = self._decorator(node, "repeat")
        attempts = retry.attempts if retry is not None else 1
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
                        if attempt < attempts and retry is not None and retry.delay_seconds:
                            self._sleep(retry.delay_seconds, node_deadline, branch_cancel)
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
                self._cooldowns[node.id] = time.monotonic() + cooldown.seconds
        if do_once is not None and (outcome.status == ActionStatus.SUCCEEDED or not do_once.reset_on_failure):
            with self._lock:
                self._done_once.add(node.id)
        self._record_node(node, outcome, started_perf, started_at, attempts=attempts_used, repeats=repeats_used)
        return outcome

    def _run_core(self, node: WorkflowNode, deadline: float, branch_cancel: threading.Event | None) -> _Outcome:
        if node.type == "task":
            return self._run_task(node, deadline, branch_cancel)
        if node.type == "root":
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
        raise WorkflowError(f"unsupported Behavior Tree node type: {node.type}")

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
            arguments = resolver.value(node.params)
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
                if node.action == "core.assign" and isinstance(arguments.get("name"), str) and arguments["name"]:
                    self.blackboard[arguments["name"]] = arguments.get("value")
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

    def _notify_start(self, node: WorkflowNode) -> None:
        if self.on_step_start is None:
            return
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
    ) -> None:
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
            "started_at": started_at,
            "duration_ms": round((time.perf_counter() - started_perf) * 1000, 3),
        }
        if attempts > 1:
            event["attempts"] = attempts
        if repeats > 1:
            event["repeats"] = repeats
        if decorator is not None:
            event["decorator"] = decorator
        if node.is_task:
            event["params"] = self._event_params(node)
        if outcome.output is not None and node.is_task:
            event["output"] = _summary(outcome.output)
        if outcome.error:
            event["error"] = outcome.error
        if outcome.category:
            event["error_category"] = outcome.category
        with self._lock:
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
