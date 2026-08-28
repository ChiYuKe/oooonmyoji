"""Spawn-based multi-instance supervisor."""

from __future__ import annotations

import multiprocessing as mp
import json
import queue
import threading
import time
import uuid
from datetime import datetime, timezone
from dataclasses import dataclass, replace
from typing import Any

from ..config.loader import load_config
from ..config.model import AppConfig, InstanceConfig, JobConfig
from ..actions import build_action_registry
from ..vision.ocr import SharedOcrPool
from ..workflows.loader import WorkflowLoader
from .logging import EventLogger
from .records import RunStatus
from .runner import RemoteOcrEngine, TaskRunner


@dataclass
class _Worker:
    instance: InstanceConfig
    process: Any
    command_queue: Any
    response_queue: Any
    control_queue: Any


def _apply_cancel_request(
    run_id: object,
    current_run_id: str | None,
    current_cancel: threading.Event,
    pending_cancels: set[str],
    completed_run_ids: set[str] | None = None,
) -> None:
    if isinstance(run_id, str) and completed_run_ids is not None and run_id in completed_run_ids:
        return
    if run_id == current_run_id:
        current_cancel.set()
    elif current_run_id is None and isinstance(run_id, str):
        pending_cancels.add(run_id)


def _activate_run_cancel(run_id: str, pending_cancels: set[str]) -> threading.Event:
    cancel_event = threading.Event()
    if run_id in pending_cancels:
        cancel_event.set()
        pending_cancels.remove(run_id)
    return cancel_event


def _instance_worker(
    config_path: str,
    instance: InstanceConfig,
    command_queue: Any,
    control_queue: Any,
    event_queue: Any,
    response_queue: Any,
) -> None:
    config = load_config(config_path)
    registry = build_action_registry(config.action_dir)
    workflow_loader = WorkflowLoader(config.workflow_dir, registry, project_root=config.root_dir)
    logger = EventLogger(config.log_dir)
    runner = TaskRunner(config, registry=registry, workflow_loader=workflow_loader, logger=logger)
    state_lock = threading.Lock()
    current_run_id: str | None = None
    current_cancel = threading.Event()
    pending_cancels: set[str] = set()
    completed_run_ids: set[str] = set()
    stop_requested = threading.Event()

    def control_loop() -> None:
        nonlocal current_run_id
        while True:
            control = control_queue.get()
            if control.get("type") == "stop":
                stop_requested.set()
                current_cancel.set()
                return
            if control.get("type") != "cancel":
                continue
            with state_lock:
                _apply_cancel_request(control.get("run_id"), current_run_id, current_cancel, pending_cancels, completed_run_ids)

    threading.Thread(target=control_loop, name=f"control-{instance.id}", daemon=True).start()
    while True:
        command = command_queue.get()
        if command.get("type") == "stop":
            return
        if command.get("type") != "run":
            continue
        command_job = command.get("job")
        job = command_job if isinstance(command_job, JobConfig) else config.job(command["job_id"])
        with state_lock:
            current_run_id = command["run_id"]
            current_cancel = _activate_run_cancel(current_run_id, pending_cancels)
        ocr_engine = RemoteOcrEngine(event_queue, response_queue, instance.id, cancel_event=current_cancel)
        try:
            record = runner.execute(
                job,
                instance,
                run_id=command["run_id"],
                ocr_engine=ocr_engine,
                cancel_event=current_cancel,
                event_queue=event_queue,
                events_file=command.get("events_file"),
            )
        finally:
            with state_lock:
                completed_run_ids.add(command["run_id"])
                if len(completed_run_ids) >= 512:
                    # 防止长驻 worker 内存无限增长，只保留最近的完成记录
                    completed_run_ids = set(list(completed_run_ids)[-256:])
                current_run_id = None
            if stop_requested.is_set():
                return
        if record.details.get("worker_restart_required"):
            return


class Supervisor:
    """Owns one spawn worker per configured instance and one OCR pool."""

    def __init__(self, config: AppConfig) -> None:
        self.config = config
        self.logger = EventLogger(config.log_dir)
        self.event_queue: Any | None = None
        self.ocr_pool: SharedOcrPool | None = None
        self.workers: dict[str, _Worker] = {}
        self._runs: dict[str, str] = {}
        self._completed: dict[str, dict[str, Any]] = {}

    def start(self) -> None:
        if self.workers:
            return
        context = mp.get_context("spawn")
        self.event_queue = context.Queue()
        if self.config.ocr.enabled:
            self.ocr_pool = SharedOcrPool(
                language=self.config.ocr.language,
                workers=self.config.ocr.workers,
                timeout_seconds=self.config.ocr.request_timeout_seconds,
                min_confidence=self.config.ocr.min_confidence,
                use_gpu=self.config.ocr.use_gpu,
            )
        for instance in self.config.instances:
            if not instance.enabled:
                continue
            self._start_worker(context, instance)

    def _start_worker(self, context: Any, instance: InstanceConfig) -> None:
        command_queue = context.Queue(maxsize=1)
        control_queue = context.Queue()
        response_queue = context.Queue()
        process = context.Process(
            target=_instance_worker,
            args=(str(self.config.config_path), instance, command_queue, control_queue, self.event_queue, response_queue),
            name=f"oooonmyoji-instance-{instance.id}",
        )
        process.start()
        self.workers[instance.id] = _Worker(instance, process, command_queue, response_queue, control_queue)
        self.logger.emit("worker.started", instance_id=instance.id, pid=process.pid)

    def ensure_instance(self, instance: InstanceConfig) -> None:
        """Add a newly discovered instance to a running supervisor."""

        if instance.id in self.workers:
            return
        if not instance.enabled:
            raise RuntimeError(f"instance is disabled: {instance.id}")
        if not any(current.id == instance.id for current in self.config.instances):
            self.config = replace(self.config, instances=(*self.config.instances, instance))
        if self.event_queue is None:
            self.start()
            return
        self._start_worker(mp.get_context("spawn"), instance)

    def run(self, job_id: str, *, wait: bool = True, events_file: str | None = None) -> str:
        self.start()
        self.check_workers()
        job = self.config.job(job_id)
        worker = self.workers.get(job.instance)
        if worker is None:
            raise RuntimeError(f"instance is disabled or not started: {job.instance}")
        if any(instance_id == job.instance for instance_id in self._runs.values()):
            raise RuntimeError(f"instance already has a queued or running task: {job.instance}")
        run_id = f"{job_id}-{uuid.uuid4().hex[:12]}"
        worker.command_queue.put({"type": "run", "job_id": job_id, "run_id": run_id, "events_file": events_file})
        self._runs[run_id] = job.instance
        if wait:
            self.wait_for(run_id)
        return run_id

    def run_workflow(
        self,
        workflow: str,
        instance_id: str,
        inputs: dict[str, Any] | None = None,
        *,
        wait: bool = True,
        events_file: str | None = None,
    ) -> str:
        """Run one workflow directly without registering a config task."""

        self.start()
        self.check_workers()
        try:
            instance = self.config.instance(instance_id)
        except StopIteration as exc:
            raise RuntimeError(f"instance does not exist: {instance_id}") from exc
        worker = self.workers.get(instance_id)
        if worker is None:
            raise RuntimeError(f"instance is disabled or not started: {instance_id}")
        if any(active_instance == instance_id for active_instance in self._runs.values()):
            raise RuntimeError(f"instance already has a queued or running task: {instance_id}")
        if inputs is not None and not isinstance(inputs, dict):
            raise ValueError("workflow inputs must be a JSON object")

        job_id = f"workflow-{uuid.uuid4().hex[:12]}"
        job = JobConfig(
            id=job_id,
            workflow=workflow,
            instance=instance.id,
            inputs=dict(inputs or {}),
            schedule={"type": "manual"},
            enabled=True,
            retry_enabled=False,
        )
        run_id = f"{job_id}-{uuid.uuid4().hex[:12]}"
        worker.command_queue.put({"type": "run", "job_id": job_id, "job": job, "run_id": run_id, "events_file": events_file})
        self._runs[run_id] = instance_id
        if wait:
            self.wait_for(run_id)
        return run_id

    def wait_for(self, run_id: str, *, timeout_seconds: float | None = None) -> dict[str, Any] | None:
        if run_id in self._completed:
            return self._completed.pop(run_id)
        deadline = None if timeout_seconds is None else time.monotonic() + timeout_seconds
        while True:
            self.check_workers()
            remaining = None if deadline is None else max(0.0, deadline - time.monotonic())
            if remaining == 0.0:
                raise TimeoutError(f"timed out waiting for run {run_id}")
            try:
                event_queue = self.event_queue
                assert event_queue is not None
                event = event_queue.get(timeout=remaining)
            except queue.Empty as exc:
                raise TimeoutError(f"timed out waiting for run {run_id}") from exc
            if event.get("type") == "ocr_request":
                self._handle_ocr(event)
                continue
            if event.get("type") == "result":
                record = self.handle_event(event)
                if event.get("run_id") == run_id:
                    return record
                if isinstance(record, dict) and isinstance(event.get("run_id"), str):
                    self._completed[event["run_id"]] = record

    def handle_event(self, event: dict[str, Any]) -> dict[str, Any] | None:
        if event.get("type") == "ocr_request":
            self._handle_ocr(event)
            return None
        if event.get("type") != "result":
            return None
        run_id = event.get("run_id")
        if isinstance(run_id, str):
            self._runs.pop(run_id, None)
        record = event.get("record")
        return record if isinstance(record, dict) else None

    def check_workers(self) -> None:
        """Isolate a crashed instance and restart its worker process."""

        for instance_id, worker in list(self.workers.items()):
            if worker.process.is_alive():
                continue
            self.logger.emit("worker.crashed", level=40, instance_id=instance_id, exitcode=worker.process.exitcode)
            for run_id, run_instance in list(self._runs.items()):
                if run_instance != instance_id:
                    continue
                from .records import AtomicJsonStore

                store = AtomicJsonStore(self.config.artifact_dir / "runs" / f"{run_id}.json")
                record = store.read(default={})
                if isinstance(record, dict) and record.get("status") in {RunStatus.QUEUED.value, RunStatus.RUNNING.value, RunStatus.RETRYING.value}:
                    record["status"] = RunStatus.INTERRUPTED.value
                    record["finished_at"] = datetime.now(timezone.utc).isoformat()
                    record["error"] = "instance worker exited unexpectedly"
                    record["error_category"] = "internal"
                    artifacts = record.setdefault("artifacts", [])
                    if self.config.save_screenshots:
                        last_frame = self.config.artifact_dir / run_id / "last-frame.png"
                        if last_frame.is_file() and str(last_frame) not in artifacts:
                            artifacts.append(str(last_frame))
                    interrupted_metadata = self.config.artifact_dir / run_id / "interrupted.json"
                    interrupted_metadata.parent.mkdir(parents=True, exist_ok=True)
                    interrupted_metadata.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                    if str(interrupted_metadata) not in artifacts:
                        artifacts.append(str(interrupted_metadata))
                    store.write(record)
                    if self.event_queue is not None:
                        self.event_queue.put({"type": "result", "run_id": run_id, "status": RunStatus.INTERRUPTED.value, "record": record})
            worker.process.join(timeout=0)
            del self.workers[instance_id]
            context = mp.get_context("spawn")
            command_queue = context.Queue(maxsize=1)
            control_queue = context.Queue()
            response_queue = context.Queue()
            process = context.Process(
                target=_instance_worker,
                args=(str(self.config.config_path), worker.instance, command_queue, control_queue, self.event_queue, response_queue),
                name=f"oooonmyoji-instance-{instance_id}",
            )
            process.start()
            self.workers[instance_id] = _Worker(worker.instance, process, command_queue, response_queue, control_queue)
            self.logger.emit("worker.restarted", instance_id=instance_id, pid=process.pid)

    def _handle_ocr(self, event: dict[str, Any]) -> None:
        instance_id = event["instance_id"]
        worker = self.workers[instance_id]
        if self.ocr_pool is None:
            worker.response_queue.put({"id": event["id"], "error": "OCR is disabled"})
            return
        try:
            results = self.ocr_pool.recognize(event["image"])
            worker.response_queue.put({"id": event["id"], "results": results})
        except Exception as exc:
            worker.response_queue.put({"id": event["id"], "error": str(exc)})

    def cancel(self, run_id: str) -> None:
        instance_id = self._runs.get(run_id)
        if instance_id is None:
            raise KeyError(run_id)
        from .records import AtomicJsonStore

        record = AtomicJsonStore(self.config.artifact_dir / "runs" / f"{run_id}.json").read(default={})
        if isinstance(record, dict) and record.get("status") in {
            RunStatus.SUCCEEDED.value,
            RunStatus.FAILED.value,
            RunStatus.CANCELLED.value,
            RunStatus.INTERRUPTED.value,
        }:
            self._runs.pop(run_id, None)
            raise KeyError(run_id)
        self.workers[instance_id].control_queue.put({"type": "cancel", "run_id": run_id})
        self.logger.emit("run.cancel_requested", run_id=run_id, instance_id=instance_id)

    def stop(self, *, wait_seconds: float = 10.0) -> None:
        for worker in self.workers.values():
            try:
                worker.control_queue.put_nowait({"type": "stop"})
            except (queue.Full, OSError):
                pass
            try:
                worker.command_queue.put_nowait({"type": "stop"})
            except (queue.Full, OSError):
                pass
        deadline = time.monotonic() + wait_seconds
        for worker in self.workers.values():
            remaining = max(0.0, deadline - time.monotonic())
            worker.process.join(remaining)
        for worker in self.workers.values():
            if worker.process.is_alive():
                worker.process.terminate()
                worker.process.join()
            self.logger.emit("worker.stopped", instance_id=worker.instance.id, exitcode=worker.process.exitcode)
        self.workers.clear()
        self._runs.clear()
        self._completed.clear()
        if self.ocr_pool is not None:
            self.ocr_pool.close(force=True)
            self.ocr_pool = None

    def __enter__(self) -> "Supervisor":
        self.start()
        return self

    def __exit__(self, *_: object) -> None:
        self.stop()


__all__ = ["Supervisor"]
