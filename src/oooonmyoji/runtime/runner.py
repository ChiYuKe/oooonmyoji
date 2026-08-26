"""One-task execution with immutable workflow snapshots and artifacts."""

from __future__ import annotations

import json
import queue
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from ..actions import ActionRegistry, ActionStatus, build_action_registry
from ..config.model import AppConfig, InstanceConfig, JobConfig
from ..devices.coordinates import CoordinateMapper
from ..devices.factory import connect_at_task_boundary
from ..devices.lock import InstanceLock
from ..exceptions import CancelledError, OcrError
from ..vision.ocr import OcrEngine
from ..vision.template import TemplateMatcher
from ..workflows.engine import WorkflowEngine
from ..workflows.loader import WorkflowLoader
from .context import TaskContextImpl
from .logging import EventLogger
from .records import AtomicJsonStore, RunRecord, RunStatus


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
    ) -> RunRecord:
        run_id = run_id or uuid.uuid4().hex
        record = RunRecord(
            run_id=run_id,
            job_id=job.id,
            instance_id=instance.id,
            plugin_id=None,
            status=RunStatus.QUEUED,
        )
        record_store = AtomicJsonStore(self.config.artifact_dir / "runs" / f"{run_id}.json")
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
                mapper = CoordinateMapper(workflow.reference_resolution[0], workflow.reference_resolution[1], device.width, device.height)
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
                )

                def on_step(event: dict[str, Any]) -> None:
                    record.current_step = str(event.get("step_id")) if event.get("step_id") is not None else None
                    record.step_history.append(dict(event))
                    if context is not None and context.last_frame is not None:
                        try:
                            record.details["last_frame"] = str(context.save_frame(context.last_frame, "last-frame.png"))
                        except Exception as artifact_error:
                            record.details["last_frame_error"] = str(artifact_error)
                    record_store.write(record.to_dict())
                    self._emit(event_queue, {"type": "step", "run_id": run_id, "step": dict(event)})

                engine = WorkflowEngine(workflow, self.registry, context, inputs, on_step=on_step, cancel_event=cancel_event)
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
            record_store.write(record.to_dict())
            self.logger.emit("run.finished", run_id=run_id, instance_id=instance.id, workflow_id=record.workflow_id, status=record.status.value, duration_ms=record.duration_ms)
            self._emit(event_queue, {"type": "result", "run_id": run_id, "status": record.status.value, "record": record.to_dict()})
        return record

    @staticmethod
    def _emit(queue: Any | None, payload: dict[str, Any]) -> None:
        if queue is not None:
            queue.put(payload)


def run_job(config: AppConfig, job: JobConfig, *, ocr_engine: OcrEngine | None = None) -> RunRecord:
    return TaskRunner(config).execute(job, config.instance(job.instance), ocr_engine=ocr_engine)


__all__ = ["RemoteOcrEngine", "TaskRunner", "run_job"]
