"""One-task execution with immutable workflow snapshots and artifacts."""

from __future__ import annotations

import json
import queue
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..actions import ActionRegistry, ActionStatus, build_action_registry
from ..config.model import AppConfig, InstanceConfig, JobConfig
from ..devices.coordinates import CoordinateMapper
from ..devices.factory import connect_at_task_boundary
from ..devices.lock import InstanceLock
from ..exceptions import CancelledError, OcrError, WorkflowError
from ..vision.image import make_thumbnail_base64
from ..vision.ocr import OcrEngine
from ..vision.template import TemplateMatcher
from ..workflows.engine import WorkflowEngine
from ..workflows.loader import WorkflowLoader
from .context import TaskContextImpl
from .logging import EventLogger
from .records import AtomicJsonStore, RunRecord, RunStatus


RUN_RECORD_CHECKPOINT_STEPS = 25


class RemoteOcrEngine:
    """Proxy used by an instance process to the supervisor's shared OCR pool."""

    def __init__(self, request_queue: Any, response_queue: Any, instance_id: str, *, cancel_event: Any | None = None) -> None:
        self.request_queue = request_queue
        self.response_queue = response_queue
        self.instance_id = instance_id
        self.cancel_event = cancel_event

    def recognize(self, image: object) -> list[Any]:
        self._check_cancelled()
        request_id = uuid.uuid4().hex
        self.request_queue.put({"type": "ocr_request", "id": request_id, "instance_id": self.instance_id, "image": image})
        while True:
            self._check_cancelled()
            try:
                response = self.response_queue.get(timeout=0.1)
            except queue.Empty:
                continue
            if response.get("id") != request_id:
                continue
            if response.get("error"):
                raise OcrError(str(response["error"]))
            return response.get("results", [])

    def _check_cancelled(self) -> None:
        if self.cancel_event is not None and self.cancel_event.is_set():
            raise CancelledError("task cancellation requested during OCR")

    def close(self) -> None:
        return None


class RunEventWriter:
    """Truncate-once JSONL stream for per-step run events and optional images.

    The first write opens the file in "w" mode so each run starts with a clean
    stream; later lines are appended. Consumers (e.g. the VS Code extension)
    tail this file and watch for the run_started marker.
    """

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self._started = False
        self._lock = threading.Lock()

    def write(self, payload: dict[str, Any]) -> None:
        line = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            mode = "w" if not self._started else "a"
            with self.path.open(mode, encoding="utf-8", newline="\n") as stream:
                stream.write(line)
            self._started = True


def _safe_artifact_name(value: str) -> str:
    import re

    return re.sub(r"[^A-Za-z0-9_.-]+", "_", value) or "unknown"


def _step_event_payload(run_id: str, context: Any, event: dict[str, Any], *, save_screenshots: bool = False) -> dict[str, Any]:
    """Build a run-event line for one step, optionally attaching frame data."""
    import time

    payload: dict[str, Any] = {
        "type": "step",
        "run_id": run_id,
        "step_id": str(event.get("step_id")) if event.get("step_id") is not None else None,
        "step": dict(event),
        "ts": time.time(),
    }
    if save_screenshots and context is not None and context.last_frame is not None:
        try:
            saved = context.save_frame(context.last_frame, f"step-{_safe_artifact_name(payload['step_id'] or 'unknown')}.png")
            payload["screenshot"] = str(saved)
        except Exception as artifact_error:
            payload["screenshot_error"] = str(artifact_error)
        try:
            thumbnail = make_thumbnail_base64(context.last_frame)
            if thumbnail:
                payload["thumbnail"] = thumbnail
        except Exception:
            pass
    output = event.get("output")
    if event.get("action") == "stats.enqueue_reward" and isinstance(output, dict):
        screenshot = output.get("screenshot")
        if isinstance(screenshot, str) and screenshot:
            payload["screenshot"] = screenshot
    return payload


def _step_identity(event: dict[str, Any]) -> tuple[tuple[str, ...], str, int, float]:
    path = event.get("workflow_path")
    workflow_path = tuple(str(item) for item in path) if isinstance(path, list) else ()
    return (
        workflow_path,
        str(event.get("step_id") or ""),
        int(event.get("execution_index") or 0),
        float(event.get("started_at") or 0.0),
    )


def _nested_branch_recovery_events(
    history: list[dict[str, Any]],
    parent_event: dict[str, Any],
) -> list[dict[str, Any]]:
    """Reclassify failed descendants when a workflow.run branch is recovered."""

    if parent_event.get("status") != "branch_miss" or parent_event.get("action") != "workflow.run":
        return []
    parent_path_value = parent_event.get("workflow_path")
    if not isinstance(parent_path_value, list):
        return []
    parent_path = tuple(str(item) for item in parent_path_value)
    parent_started = float(parent_event.get("started_at") or 0.0)
    parent_duration = max(0.0, float(parent_event.get("duration_ms") or 0.0)) / 1000.0
    parent_finished = parent_started + parent_duration + 0.001

    reference_id = ""
    output = parent_event.get("output")
    if isinstance(output, dict):
        reference = output.get("workflow")
        if isinstance(reference, str) and reference.strip():
            reference_id = Path(reference.replace("\\", "/")).stem

    latest: dict[tuple[tuple[str, ...], str, int, float], dict[str, Any]] = {}
    order: list[tuple[tuple[str, ...], str, int, float]] = []
    for event in history:
        path_value = event.get("workflow_path")
        if not isinstance(path_value, list):
            continue
        path = tuple(str(item) for item in path_value)
        if len(path) <= len(parent_path) or path[: len(parent_path)] != parent_path:
            continue
        if reference_id and path[len(parent_path)] != reference_id:
            continue
        started_at = float(event.get("started_at") or 0.0)
        if started_at < parent_started or started_at > parent_finished:
            continue
        identity = _step_identity(event)
        if identity not in latest:
            order.append(identity)
        latest[identity] = event

    recovered: list[dict[str, Any]] = []
    for identity in order:
        event = latest[identity]
        if event.get("status") != ActionStatus.FAILED.value:
            continue
        replacement = dict(event)
        replacement["status"] = "branch_miss"
        replacement["original_status"] = ActionStatus.FAILED.value
        replacement["recovered_by"] = parent_event.get("recovered_by")
        if parent_event.get("recovered_by_name"):
            replacement["recovered_by_name"] = parent_event.get("recovered_by_name")
        replacement["recovered_via"] = parent_event.get("step_id")
        recovered.append(replacement)
    return recovered


class TaskRunner:
    def __init__(
        self,
        config: AppConfig,
        *,
        registry: ActionRegistry | None = None,
        workflow_loader: WorkflowLoader | None = None,
        logger: EventLogger | None = None,
    ) -> None:
        self.config = config
        self.logger = logger or EventLogger(config.log_dir)
        self.registry = registry or build_action_registry(config.action_dir)
        self.workflow_loader = workflow_loader or WorkflowLoader(config.workflow_dir, self.registry, project_root=config.root_dir)

    def execute(
        self,
        job: JobConfig,
        instance: InstanceConfig,
        *,
        run_id: str | None = None,
        ocr_engine: OcrEngine | None = None,
        cancel_event: Any | None = None,
        event_queue: Any | None = None,
        events_file: Path | str | None = None,
    ) -> RunRecord:
        run_id = run_id or uuid.uuid4().hex
        resolved_events_file = (
            Path(events_file)
            if events_file is not None
            else self.config.artifact_dir / "runs" / f"events-{run_id}.jsonl"
        )
        writer = RunEventWriter(resolved_events_file)
        record = RunRecord(
            run_id=run_id,
            job_id=job.id,
            instance_id=instance.id,
            plugin_id=None,
            status=RunStatus.QUEUED,
        )
        record.details["events_file"] = str(resolved_events_file)
        record_store = AtomicJsonStore(self.config.artifact_dir / "runs" / f"{run_id}.json")
        record_lock = threading.RLock()
        steps_since_checkpoint = 0

        def checkpoint_record(*, force: bool = False) -> None:
            nonlocal steps_since_checkpoint
            if not force and steps_since_checkpoint < RUN_RECORD_CHECKPOINT_STEPS:
                return
            record_store.write(record.to_dict())
            steps_since_checkpoint = 0

        record_store.write(record.to_dict())
        self._emit(event_queue, {"type": "status", "run_id": run_id, "status": RunStatus.QUEUED.value})
        lock = InstanceLock(self.config.artifact_dir / "locks", instance.id)
        device: Any | None = None
        context: TaskContextImpl | None = None
        started = time.perf_counter()
        workflow = None
        try:
            # The loader reads and hashes the file once. All retries use this snapshot.
            workflow = self.workflow_loader.load(job.workflow)
            inputs = self.workflow_loader.normalize_inputs(workflow, job.inputs)
            self.workflow_loader.validate_input_paths(workflow, inputs)
            record.workflow_id = workflow.workflow_id
            record.workflow_version = workflow.version
            record.workflow_file_hash = workflow.file_hash
            record_store.write(record.to_dict())

            lock.acquire()
            record.status = RunStatus.RUNNING
            record.started_at = datetime.now(timezone.utc).isoformat()
            record_store.write(record.to_dict())
            self._emit(event_queue, {"type": "status", "run_id": run_id, "status": RunStatus.RUNNING.value})
            writer.write({
                "type": "run_started",
                "run_id": run_id,
                "instance_id": instance.id,
                "workflow_id": record.workflow_id,
                "status": RunStatus.RUNNING.value,
                "ts": time.time(),
            })

            attempts = self.config.retry.task_attempts if job.retry_enabled and workflow.retry_safe else 1
            result: Any = None
            for attempt in range(attempts):
                if attempt:
                    record.status = RunStatus.RETRYING
                    record_store.write(record.to_dict())
                    self._emit(event_queue, {"type": "status", "run_id": run_id, "status": RunStatus.RETRYING.value, "attempt": attempt + 1})
                if device is not None:
                    device.close()
                device, used_adb = connect_at_task_boundary(
                    self.config,
                    instance,
                    attempts=self.config.retry.connection_attempts,
                    base_delay_seconds=self.config.retry.base_delay_seconds,
                    max_delay_seconds=self.config.retry.max_delay_seconds,
                )
                self.logger.emit("run.device_connected", run_id=run_id, instance_id=instance.id, backend="adb" if used_adb else "mumu")
                mapper = CoordinateMapper(workflow.resolution[0], workflow.resolution[1], device.width, device.height)
                # 脚本嵌套调用：workflow.run 动作经由 context.run_subworkflow 到这里执行子工作流
                # 栈初始包含当前工作流自身，任何形式的自调用/跨层递归都会立即被拦截
                subworkflow_stack: list[str] = [workflow.workflow_id]
                subworkflow_limit = 4

                def run_subworkflow(reference: str, inputs: dict[str, Any]) -> tuple[str, Any, str | None, str | None]:
                    workflow_reference = reference if "/" not in reference else reference.replace("\\", "/")
                    sub = self.workflow_loader.load(workflow_reference)
                    sub_id = sub.workflow_id
                    if sub_id in subworkflow_stack:
                        raise WorkflowError(f"recursive subworkflow call: {sub_id}")
                    if len(subworkflow_stack) >= subworkflow_limit:
                        raise WorkflowError(f"subworkflow nesting exceeds the limit ({subworkflow_limit})")
                    normalized = self.workflow_loader.normalize_inputs(sub, inputs)
                    subworkflow_stack.append(sub_id)
                    try:
                        sub_engine = WorkflowEngine(
                            sub,
                            self.registry,
                            context,
                            normalized,
                            on_step=on_step,
                            on_step_start=on_step_start,
                            cancel_event=cancel_event,
                            workflow_path=tuple(subworkflow_stack),
                        )
                        result = sub_engine.run()
                    finally:
                        subworkflow_stack.pop()
                    return result.status.value, result.output, result.error, result.error_category

                def submit_reward_statistics(event: dict[str, Any]) -> None:
                    if event_queue is None:
                        return
                    payload = dict(event)
                    payload["events_file"] = str(resolved_events_file)
                    event_queue.put(payload)

                context = TaskContextImpl(
                    device=device,
                    mapper=mapper,
                    template_matcher=TemplateMatcher(mapper),
                    ocr_engine=ocr_engine,
                    artifact_dir=self.config.artifact_dir / run_id,
                    template_root=self.config.root_dir,
                    logger=self.logger,
                    cancel_event=cancel_event,
                    capture_attempts=self.config.retry.capture_attempts,
                    ocr_attempts=self.config.retry.ocr_attempts,
                    retry_base_delay=self.config.retry.base_delay_seconds,
                    retry_max_delay=self.config.retry.max_delay_seconds,
                    subworkflow_runner=run_subworkflow,
                    run_id=run_id,
                    instance_id=instance.id,
                    reward_stats_submitter=submit_reward_statistics if event_queue is not None else None,
                )

                def on_step(event: dict[str, Any]) -> None:
                    nonlocal steps_since_checkpoint
                    with record_lock:
                        nested_recoveries = _nested_branch_recovery_events(record.step_history, event)
                        for step_event in (*nested_recoveries, event):
                            record.current_step = str(step_event.get("step_id")) if step_event.get("step_id") is not None else None
                            record.append_step(step_event)
                            if context is not None and context.last_frame is not None:
                                if self.config.save_screenshots:
                                    try:
                                        record.details["last_frame"] = str(context.save_frame(context.last_frame, "last-frame.png"))
                                    except Exception as artifact_error:
                                        record.details["last_frame_error"] = str(artifact_error)
                            writer.write(_step_event_payload(run_id, context, step_event, save_screenshots=self.config.save_screenshots))
                            self._emit(event_queue, {"type": "step", "run_id": run_id, "step": dict(step_event)})
                            steps_since_checkpoint += 1
                        checkpoint_record()

                def on_step_start(event: dict[str, Any]) -> None:
                    writer.write(_step_event_payload(run_id, context, event, save_screenshots=self.config.save_screenshots))

                engine = WorkflowEngine(
                    workflow,
                    self.registry,
                    context,
                    inputs,
                    on_step=on_step,
                    on_step_start=on_step_start,
                    cancel_event=cancel_event,
                    workflow_path=(workflow.workflow_id,),
                )
                result = engine.run()
                if result.requires_worker_restart:
                    record.details["worker_restart_required"] = True
                if result.current_step not in {None, "$success", "$failure", "$cancelled"}:
                    record.current_step = result.current_step
                if result.requires_worker_restart or result.status != ActionStatus.FAILED or attempt + 1 >= attempts:
                    break

            assert result is not None
            record.status = {
                ActionStatus.SUCCEEDED: RunStatus.SUCCEEDED,
                ActionStatus.FAILED: RunStatus.FAILED,
                ActionStatus.CANCELLED: RunStatus.CANCELLED,
            }[result.status]
            record.details["workflow_output"] = result.output
            record.error = result.error
            record.error_category = result.error_category
        except CancelledError as exc:
            record.status = RunStatus.CANCELLED
            record.error = str(exc)
            record.error_category = "cancelled"
        except BaseException as exc:
            if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                raise
            record.status = RunStatus.FAILED
            record.error = str(exc)
            record.error_category = getattr(getattr(exc, "category", None), "value", "internal")
            self.logger.emit("run.failed", level=40, run_id=run_id, instance_id=instance.id, workflow_id=record.workflow_id, error=record.error, error_category=record.error_category)
        finally:
            record.finished_at = datetime.now(timezone.utc).isoformat()
            record.duration_ms = round((time.perf_counter() - started) * 1000, 3)
            if device is not None:
                try:
                    device.close()
                except Exception as close_error:
                    record.details["device_close_error"] = str(close_error)
            lock.release()
            if record.status in {RunStatus.FAILED, RunStatus.CANCELLED, RunStatus.INTERRUPTED}:
                if context is not None and context.last_frame is not None:
                    try:
                        record.artifacts.append(str(context.save_frame(context.last_frame, "failure-last-frame.png")))
                    except Exception as artifact_error:
                        record.details["artifact_error"] = str(artifact_error)
                failure_metadata = self.config.artifact_dir / run_id / "failure.json"
                failure_metadata.parent.mkdir(parents=True, exist_ok=True)
                record.artifacts.append(str(failure_metadata))
                failure_metadata.write_text(json.dumps(record.to_dict(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            checkpoint_record(force=True)
            self.logger.emit("run.finished", run_id=run_id, instance_id=instance.id, workflow_id=record.workflow_id, status=record.status.value, duration_ms=record.duration_ms)
            writer.write({
                "type": "run_finished",
                "run_id": run_id,
                "workflow_id": record.workflow_id,
                "status": record.status.value,
                "error": record.error,
                "error_category": record.error_category,
                "ts": time.time(),
            })
            self._emit(event_queue, {"type": "result", "run_id": run_id, "status": record.status.value, "record": record.to_dict()})
        return record

    @staticmethod
    def _emit(queue: Any | None, payload: dict[str, Any]) -> None:
        if queue is not None:
            queue.put(payload)


def run_job(config: AppConfig, job: JobConfig, *, ocr_engine: OcrEngine | None = None) -> RunRecord:
    return TaskRunner(config).execute(job, config.instance(job.instance), ocr_engine=ocr_engine)


__all__ = ["RemoteOcrEngine", "RunEventWriter", "TaskRunner", "run_job"]
