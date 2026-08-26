"""Deterministic JSON workflow execution engine."""

from __future__ import annotations

import json
import queue
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from ..actions import ActionRegistry, ActionResult, ActionStatus
from ..exceptions import AutomationError, CancelledError, WorkflowError, WorkflowTimeoutError
from .model import WorkflowSpec, WorkflowStep
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


def _json_safe(value: Any) -> Any:
    try:
        json.dumps(value, ensure_ascii=False, allow_nan=False)
        return value
    except (TypeError, ValueError):
        raise WorkflowError(f"Action output is not JSON serializable: {type(value).__name__}")


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
        cancel_event: Any | None = None,
        cancel_grace_seconds: float = 1.0,
    ) -> None:
        self.workflow = workflow
        self.registry = registry
        self.context = context
        self.inputs = inputs
        self.on_step = on_step
        self.cancel_event = cancel_event
        self.cancel_grace_seconds = cancel_grace_seconds
        self.outputs: dict[str, Any] = {}
        self.history: list[dict[str, Any]] = []
        self.requires_worker_restart = False

    def run(self) -> WorkflowResult:
        deadline = time.monotonic() + self.workflow.timeout_seconds
        if hasattr(self.context, "set_deadline"):
            self.context.set_deadline(deadline)
        step_map = self.workflow.step_map
        current = self.workflow.entry
        executed = 0
        terminal_error: str | None = None
        terminal_category: str | None = None
        try:
            while current not in {"$success", "$failure", "$cancelled"}:
                if executed >= self.workflow.max_steps:
                    return self._failed("workflow max_steps exceeded", "workflow_limit", current)
                if time.monotonic() >= deadline:
                    return self._failed("workflow timeout exceeded", "workflow_timeout", current)
                self._check_cancelled()
                step = step_map[current]
                started = time.perf_counter()
                event: dict[str, Any] = {"step_id": step.id, "action": step.action, "status": "running", "started_at": time.time(), "attempts": 0}
                last_result: ActionResult | None = None
                try:
                    resolver = ReferenceResolver(self.inputs, self.outputs)
                    if step.when is not None and not resolver.condition(step.when):
                        event.update(status="skipped")
                        self._record(event, started)
                        current = self._target(step, "skip")
                        executed += 1
                        continue
                    action = self.registry.get(step.action)
                    arguments = resolver.value(step.arguments)
                    self._validate_action_input(action.input_schema, arguments, step.id)
                    for attempt in range(1, step.retry.attempts + 1):
                        self._check_cancelled()
                        event["attempts"] = attempt
                        try:
                            last_result = self._execute(action, arguments, step.timeout_seconds, deadline)
                        except CancelledError:
                            raise
                        except AutomationError as exc:
                            last_result = ActionResult.failed(str(exc), category=getattr(exc.category, "value", "action"))
                        except Exception as exc:
                            last_result = ActionResult.failed(str(exc), category="internal")
                        if self.requires_worker_restart:
                            break
                        if last_result.status in {ActionStatus.SUCCEEDED, ActionStatus.CANCELLED} or attempt >= step.retry.attempts:
                            break
                        if step.retry.delay_seconds:
                            self._sleep(step.retry.delay_seconds, deadline)
                    assert last_result is not None
                except CancelledError as exc:
                    event.update(status="cancelled", error=str(exc), error_category="cancelled")
                    return self._finish(event, ActionStatus.CANCELLED, current, str(exc), "cancelled", started)
                except AutomationError as exc:
                    last_result = ActionResult.failed(str(exc), category=getattr(exc.category, "value", "workflow"))
                except Exception as exc:
                    last_result = ActionResult.failed(str(exc), category="internal")
                assert last_result is not None
                if last_result.status == ActionStatus.SUCCEEDED:
                    try:
                        output = _json_safe(last_result.output)
                    except AutomationError as exc:
                        event.update(status="failed", error=str(exc), error_category=getattr(exc.category, "value", "workflow"))
                        self._record(event, started)
                        terminal_error = str(exc)
                        terminal_category = getattr(exc.category, "value", "workflow")
                        current = self._target(step, "failure")
                        executed += 1
                        continue
                    self.outputs[step.id] = output
                    event.update(status="succeeded", output=_summary(output))
                    self._record(event, started)
                    current = self._target(step, "success")
                elif last_result.status == ActionStatus.CANCELLED:
                    event.update(status="cancelled", error=last_result.error, error_category=last_result.error_category or "cancelled")
                    return self._finish(event, ActionStatus.CANCELLED, current, last_result.error, last_result.error_category, started)
                else:
                    event.update(status="failed", error=last_result.error, error_category=last_result.error_category or "action")
                    self._record(event, started)
                    if self.requires_worker_restart:
                        return WorkflowResult(
                            ActionStatus.FAILED,
                            output=dict(self.outputs),
                            error_category=last_result.error_category or "action_timeout",
                            error=last_result.error,
                            current_step=current,
                            step_history=tuple(self.history),
                            requires_worker_restart=True,
                        )
                    terminal_error = last_result.error
                    terminal_category = last_result.error_category or "action"
                    current = self._target(step, "failure")
                executed += 1
            if current == "$success":
                return WorkflowResult(ActionStatus.SUCCEEDED, output=dict(self.outputs), step_history=tuple(self.history))
            if current == "$cancelled":
                return WorkflowResult(ActionStatus.CANCELLED, output=dict(self.outputs), error_category="cancelled", error="workflow cancelled", step_history=tuple(self.history))
            return WorkflowResult(
                ActionStatus.FAILED,
                output=dict(self.outputs),
                error_category=terminal_category or "workflow",
                error=terminal_error or "workflow reached $failure",
                current_step=current,
                step_history=tuple(self.history),
            )
        except CancelledError as exc:
            return WorkflowResult(
                ActionStatus.CANCELLED,
                output=dict(self.outputs),
                error_category="cancelled",
                error=str(exc),
                current_step=current,
                step_history=tuple(self.history),
                requires_worker_restart=self.requires_worker_restart,
            )
        except AutomationError as exc:
            return WorkflowResult(ActionStatus.FAILED, output=dict(self.outputs), error_category=getattr(exc.category, "value", "workflow"), error=str(exc), current_step=current, step_history=tuple(self.history))

    def _execute(self, action: Any, arguments: dict[str, Any], timeout_seconds: float | None, deadline: float) -> ActionResult:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise WorkflowTimeoutError("workflow timeout exceeded")
        effective_timeout = remaining if timeout_seconds is None else min(timeout_seconds, remaining)
        if hasattr(self.context, "begin_action"):
            self.context.begin_action()
        result_queue: queue.Queue[ActionResult | BaseException] = queue.Queue(maxsize=1)

        def call() -> None:
            try:
                result_queue.put(action.action.execute(self.context, arguments))
            except BaseException as exc:
                result_queue.put(exc)

        thread = threading.Thread(target=call, daemon=True)
        thread.start()
        join_deadline = time.monotonic() + effective_timeout
        while thread.is_alive():
            if self.cancel_event is not None and self.cancel_event.is_set():
                if hasattr(self.context, "request_action_cancel"):
                    self.context.request_action_cancel()
                thread.join(self.cancel_grace_seconds)
                if thread.is_alive():
                    self.requires_worker_restart = True
                return ActionResult.cancelled("workflow cancellation requested")
            remaining = join_deadline - time.monotonic()
            if remaining <= 0:
                break
            thread.join(min(0.1, remaining))
        if thread.is_alive():
            if hasattr(self.context, "request_action_cancel"):
                self.context.request_action_cancel()
            thread.join(self.cancel_grace_seconds)
            if thread.is_alive():
                self.requires_worker_restart = True
            category = "workflow_timeout" if time.monotonic() >= deadline and timeout_seconds is None else "action_timeout"
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

    def _validate_action_input(self, schema: dict[str, Any], arguments: Any, step_id: str) -> None:
        try:
            from jsonschema import Draft202012Validator
        except ImportError as exc:
            raise WorkflowError("jsonschema is required for Action validation", cause=exc) from exc
        error = next(iter(Draft202012Validator(schema).iter_errors(arguments)), None)
        if error is not None:
            raise WorkflowError(f"step {step_id} Action arguments: {error.message}")

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

    def _sleep(self, seconds: float, deadline: float) -> None:
        end = min(time.monotonic() + seconds, deadline)
        while time.monotonic() < end:
            self._check_cancelled()
            time.sleep(min(0.1, end - time.monotonic()))
        if time.monotonic() >= deadline:
            raise WorkflowTimeoutError("workflow timeout exceeded")

    def _check_cancelled(self) -> None:
        if self.cancel_event is not None and self.cancel_event.is_set():
            raise CancelledError("workflow cancellation requested")
        self.context.check_cancelled()

    def _target(self, step: WorkflowStep, outcome: str) -> str:
        if outcome == "success":
            if step.on_success is not None:
                return step.on_success
        elif outcome == "failure":
            if step.on_failure is not None:
                return step.on_failure
        elif outcome == "skip":
            if step.on_skip is not None:
                return step.on_skip
        return self.workflow.next_step(step.id) if outcome != "failure" else "$failure"

    def _record(self, event: dict[str, Any], started: float | None = None) -> None:
        if started is not None:
            event["duration_ms"] = round((time.perf_counter() - started) * 1000, 3)
        self.history.append(dict(event))
        if self.on_step is not None:
            self.on_step(dict(event))

    def _finish(self, event: dict[str, Any], status: ActionStatus, current: str, error: str | None, category: str | None, started: float | None = None) -> WorkflowResult:
        self._record(event, started)
        return WorkflowResult(
            status,
            output=dict(self.outputs),
            error_category=category,
            error=error,
            current_step=current,
            step_history=tuple(self.history),
            requires_worker_restart=self.requires_worker_restart,
        )

    def _failed(self, error: str, category: str, current: str) -> WorkflowResult:
        return WorkflowResult(ActionStatus.FAILED, output=dict(self.outputs), error_category=category, error=error, current_step=current, step_history=tuple(self.history))


__all__ = ["WorkflowEngine", "WorkflowResult"]
