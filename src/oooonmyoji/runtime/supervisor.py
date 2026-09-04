"""Spawn-based multi-instance supervisor."""

from __future__ import annotations

import json
import multiprocessing as mp
import queue
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..actions import build_action_registry
from ..config.loader import load_config
from ..config.model import AppConfig, InstanceConfig, JobConfig
from ..vision.ocr import SharedOcrPool
from ..workflows.loader import WorkflowLoader
from ..workflows.model import WorkflowNode, WorkflowSpec
from ..workflows.resolver import ReferenceResolver
from .logging import EventLogger
from .records import AtomicJsonStore, RunStatus
from .reward_stats import RewardStatsProcessor
from .runner import RemoteOcrEngine, TaskRunner


@dataclass
class _Worker:
    instance: InstanceConfig
    process: Any
    command_queue: Any
    response_queue: Any
    control_queue: Any


@dataclass
class _Group:
    group_id: str
    workflow: WorkflowSpec
    node: WorkflowNode
    run_ids: list[str]
    entries: list[dict[str, Any]]
    records: dict[str, dict[str, Any] | None]
    done: threading.Event
    cancel_requested: bool = False
    terminal_status: str | None = None
    finished: bool = False


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
        self._workflow_loader: WorkflowLoader | None = None
        self._groups: dict[str, _Group] = {}
        self._run_groups: dict[str, str] = {}
        self._group_lock = threading.RLock()
        self._ocr_lock = threading.Lock()
        self._ocr_executor: ThreadPoolExecutor | None = None
        self._ocr_slots: threading.BoundedSemaphore | None = None
        self._reward_stats: RewardStatsProcessor | None = None
        self._stopping = False

    def start(self) -> None:
        with self._group_lock:
            if self.workers:
                return
            self._stopping = False
            context = mp.get_context("spawn")
            self.event_queue = context.Queue()
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

        with self._group_lock:
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

    def load_workflow(self, workflow: str) -> WorkflowSpec:
        """Load a workflow in the supervisor process for orchestration decisions."""

        if self._workflow_loader is None:
            registry = build_action_registry(self.config.action_dir)
            self._workflow_loader = WorkflowLoader(
                self.config.workflow_dir,
                registry,
                project_root=self.config.root_dir,
            )
        return self._workflow_loader.load(workflow)

    @staticmethod
    def _instance_parallel_node(workflow: WorkflowSpec) -> WorkflowNode | None:
        node_map = workflow.node_map
        root = node_map.get(workflow.root)
        if root is None or len(root.children) != 1:
            return None
        child = node_map.get(root.children[0])
        return child if child is not None and child.type == "instance_parallel" else None

    def run(self, job_id: str, *, wait: bool = True, events_file: str | None = None) -> str:
        self.start()
        self.check_workers()
        job = self.config.job(job_id)
        workflow_spec = self.load_workflow(job.workflow)
        orchestration_node = self._instance_parallel_node(workflow_spec)
        if orchestration_node is not None:
            normalized = self._workflow_loader.normalize_inputs(workflow_spec, dict(job.inputs)) if self._workflow_loader else dict(job.inputs)
            return self._run_instance_parallel(workflow_spec, orchestration_node, normalized, wait=wait, events_file=events_file)
        with self._group_lock:
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
        workflow_spec = self.load_workflow(workflow)
        orchestration_node = self._instance_parallel_node(workflow_spec)
        if orchestration_node is not None:
            normalized = self._workflow_loader.normalize_inputs(workflow_spec, dict(inputs or {})) if self._workflow_loader else dict(inputs or {})
            return self._run_instance_parallel(workflow_spec, orchestration_node, normalized, wait=wait, events_file=events_file)
        return self._queue_workflow_run(workflow, instance_id, inputs, events_file=events_file, wait=wait)

    def _queue_workflow_run(
        self,
        workflow: str,
        instance_id: str,
        inputs: dict[str, Any] | None = None,
        *,
        events_file: str | None = None,
        wait: bool = True,
    ) -> str:
        try:
            instance = self.config.instance(instance_id)
        except StopIteration as exc:
            raise RuntimeError(f"instance does not exist: {instance_id}") from exc
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
        with self._group_lock:
            worker = self.workers.get(instance_id)
            if worker is None:
                raise RuntimeError(f"instance is disabled or not started: {instance_id}")
            if any(active_instance == instance_id for active_instance in self._runs.values()):
                raise RuntimeError(f"instance already has a queued or running task: {instance_id}")
            run_id = f"{job_id}-{uuid.uuid4().hex[:12]}"
            worker.command_queue.put({"type": "run", "job_id": job_id, "job": job, "run_id": run_id, "events_file": events_file})
            self._runs[run_id] = instance_id
        if wait:
            self.wait_for(run_id)
        return run_id

    def _group_events_file(self, group_id: str, instance_id: str, requested: str | None) -> str:
        if requested:
            target = Path(requested)
            return str(target.with_name(f"{target.stem}-{instance_id}{target.suffix or '.jsonl'}"))
        stamp = group_id.split("-", 2)[1] if group_id.startswith("group-") else group_id
        return str(self.config.artifact_dir / "runs" / f"events-group-{stamp}-{instance_id}.jsonl")

    def _group_store(self, group_id: str) -> AtomicJsonStore:
        return AtomicJsonStore(self.config.artifact_dir / "runs" / f"{group_id}.json")

    def _group_payload(self, group: _Group, *, status: str | None = None) -> dict[str, Any]:
        child_rows: list[dict[str, Any]] = []
        for entry in group.entries:
            row = dict(entry)
            record = group.records.get(entry["run_id"])
            if isinstance(record, dict):
                row["status"] = record.get("status", row.get("status"))
                row["record"] = record
            child_rows.append(row)
        return {
            "group_id": group.group_id,
            "workflow_id": group.workflow.workflow_id,
            "workflow_file": str(group.workflow.path),
            "workflow_file_hash": group.workflow.file_hash,
            "node_id": group.node.id,
            "status": status or self._group_status(group),
            "wait_for": group.node.wait_for,
            "cancel_on_failure": group.node.cancel_on_failure,
            "run_ids": list(group.run_ids),
            "runs": child_rows,
        }

    @staticmethod
    def _group_status(group: _Group) -> str:
        if group.terminal_status is not None:
            return group.terminal_status
        if len(group.records) < len(group.run_ids):
            return RunStatus.QUEUED.value
        statuses = [
            record.get("status") if isinstance(record, dict) else RunStatus.FAILED.value
            for run_id in group.run_ids
            for record in [group.records.get(run_id)]
        ]
        if group.node.wait_for == "any" and RunStatus.SUCCEEDED.value in statuses:
            return RunStatus.SUCCEEDED.value
        if all(status == RunStatus.SUCCEEDED.value for status in statuses):
            return RunStatus.SUCCEEDED.value
        if all(status == RunStatus.CANCELLED.value for status in statuses):
            return RunStatus.CANCELLED.value
        return RunStatus.FAILED.value

    def _persist_group(self, group: _Group, *, status: str | None = None, finished: bool = False) -> None:
        payload = self._group_payload(group, status=status)
        if finished:
            payload["finished_at"] = datetime.now(timezone.utc).isoformat()
        self._group_store(group.group_id).write(payload)

    def _cancel_group_runs(self, group: _Group) -> None:
        """Request cancellation for children that have not produced a record."""

        lock = getattr(self, "_group_lock", None)
        with lock if lock is not None else nullcontext():
            group.cancel_requested = True
            pending = tuple(run_id for run_id in group.run_ids if run_id not in group.records)
        for run_id in pending:
            try:
                self.cancel(run_id)
            except KeyError:
                # The result may have been handled between the record scan and
                # the cancellation request.
                continue

    def _mark_group_timeout(self, group: _Group) -> None:
        """Make timeout terminal without pretending unfinished children succeeded."""

        self._cancel_group_runs(group)
        group.terminal_status = RunStatus.FAILED.value

    def _run_instance_parallel(
        self,
        workflow: WorkflowSpec,
        node: WorkflowNode,
        inputs: dict[str, Any],
        *,
        wait: bool,
        events_file: str | None,
    ) -> str:
        if not node.runs:
            raise RuntimeError(f"instance_parallel node has no runs: {node.id}")
        instances = [run.instance for run in node.runs]
        if len(instances) != len(set(instances)):
            raise RuntimeError("instance_parallel contains duplicate instances")
        with self._group_lock:
            # Keep validation, snapshot resolution, and enqueue atomic so a
            # competing submission cannot reserve one child midway through a group.
            for instance_id in instances:
                try:
                    self.config.instance(instance_id)
                except StopIteration as exc:
                    raise RuntimeError(f"instance does not exist: {instance_id}") from exc
                if instance_id not in self.workers:
                    raise RuntimeError(f"instance is disabled or not started: {instance_id}")
                if any(active_instance == instance_id for active_instance in self._runs.values()):
                    raise RuntimeError(f"instance already has a queued or running task: {instance_id}")

            resolver = ReferenceResolver(inputs, {})
            group_id = f"group-{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"
            entries: list[dict[str, Any]] = []
            child_ids: list[str] = []
            child_inputs: list[dict[str, Any]] = []
            for run in node.runs:
                resolved_inputs = resolver.value(run.inputs)
                if not isinstance(resolved_inputs, dict):
                    raise ValueError(f"inputs for instance_parallel run {run.instance} must resolve to an object")
                child_workflow = self.load_workflow(run.workflow)
                child_inputs.append(
                    self._workflow_loader.normalize_inputs(child_workflow, resolved_inputs, public_only=True)
                    if self._workflow_loader is not None
                    else resolved_inputs
                )
            for run, resolved_inputs in zip(node.runs, child_inputs):
                child_id = self._queue_workflow_run(
                    run.workflow,
                    run.instance,
                    resolved_inputs,
                    events_file=self._group_events_file(group_id, run.instance, events_file),
                    wait=False,
                )
                child_ids.append(child_id)
                entries.append({
                    "run_id": child_id,
                    "instance": run.instance,
                    "workflow": run.workflow,
                    "inputs": resolved_inputs,
                    "events_file": self._group_events_file(group_id, run.instance, events_file),
                    "status": RunStatus.QUEUED.value,
                })

            group = _Group(group_id, workflow, node, child_ids, entries, {}, threading.Event())
            self._groups[group_id] = group
            for child_id in child_ids:
                self._run_groups[child_id] = group_id
        self._persist_group(group)
        if wait:
            try:
                if node.wait_for == "all":
                    records = self.wait_for_all(
                        child_ids,
                        timeout_seconds=workflow.timeout_seconds,
                        cancel_on_failure=node.cancel_on_failure,
                    )
                    group.records.update(records)
                else:
                    self._wait_group_poll(group, timeout_seconds=workflow.timeout_seconds)
            except TimeoutError:
                self._mark_group_timeout(group)
                self._finish_group(group)
                raise
            self._finish_group(group)
        else:
            thread = threading.Thread(
                target=self._wait_group_poll,
                args=(group,),
                kwargs={"timeout_seconds": workflow.timeout_seconds},
                name=f"wait-{group_id}",
                daemon=True,
            )
            thread.start()
        return group_id

    def _finish_group(self, group: _Group) -> None:
        lock = getattr(self, "_group_lock", None)
        with lock if lock is not None else nullcontext():
            if group.finished:
                return
            status = self._group_status(group)
            self._persist_group(group, status=status, finished=True)
            group.finished = True
            group.done.set()
            groups = getattr(self, "_groups", None)
            if isinstance(groups, dict):
                groups.pop(group.group_id, None)
            run_groups = getattr(self, "_run_groups", None)
            if isinstance(run_groups, dict):
                for run_id in group.run_ids:
                    if run_groups.get(run_id) == group.group_id:
                        run_groups.pop(run_id, None)
        if self.event_queue is not None:
            record = self._group_store(group.group_id).read(default={})
            self.event_queue.put({"type": "result", "run_id": group.group_id, "status": status, "record": record})

    def _wait_group_poll(self, group: _Group, *, timeout_seconds: float | None) -> None:
        deadline = None if timeout_seconds is None else time.monotonic() + timeout_seconds
        terminal = {
            RunStatus.SUCCEEDED.value,
            RunStatus.FAILED.value,
            RunStatus.CANCELLED.value,
            RunStatus.INTERRUPTED.value,
        }
        failure_requested = False
        while True:
            lock = getattr(self, "_group_lock", None)
            with lock if lock is not None else nullcontext():
                if group.done.is_set() or getattr(self, "_stopping", False):
                    return
                run_ids = tuple(group.run_ids)
                known_records = set(group.records)
            for run_id in run_ids:
                if run_id in known_records:
                    continue
                record = self._group_store(run_id).read(default={})
                if isinstance(record, dict) and record.get("status") in terminal:
                    with lock if lock is not None else nullcontext():
                        group.records.setdefault(run_id, record)
            with lock if lock is not None else nullcontext():
                records_count = len(group.records)
                statuses = [record.get("status") for record in group.records.values() if isinstance(record, dict)]
            if group.node.wait_for == "any" and RunStatus.SUCCEEDED.value in statuses:
                if group.node.cancel_on_failure:
                    self._cancel_group_runs(group)
                self._finish_group(group)
                return
            if records_count == len(run_ids):
                if group.node.cancel_on_failure and not failure_requested and any(status != RunStatus.SUCCEEDED.value for status in statuses):
                    failure_requested = True
                self._finish_group(group)
                return
            if group.node.cancel_on_failure and not failure_requested and any(status not in {None, RunStatus.SUCCEEDED.value, RunStatus.QUEUED.value, RunStatus.RUNNING.value, RunStatus.RETRYING.value} for status in statuses):
                failure_requested = True
                self._cancel_group_runs(group)
            if deadline is not None and time.monotonic() >= deadline:
                self._mark_group_timeout(group)
                self._finish_group(group)
                return
            self.check_workers()
            time.sleep(0.1)

    def wait_for(self, run_id: str, *, timeout_seconds: float | None = None) -> dict[str, Any] | None:
        lock = getattr(self, "_group_lock", None)
        with lock if lock is not None else nullcontext():
            completed = self._completed.pop(run_id, None)
        if completed is not None:
            return completed
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
            record = self.handle_event(event)
            if event.get("type") == "result":
                if event.get("run_id") == run_id:
                    return record
                if isinstance(record, dict) and isinstance(event.get("run_id"), str):
                    lock = getattr(self, "_group_lock", None)
                    with lock if lock is not None else nullcontext():
                        self._completed[event["run_id"]] = record

    def wait_for_all(
        self,
        run_ids: list[str] | tuple[str, ...],
        *,
        timeout_seconds: float | None = None,
        cancel_on_failure: bool = True,
    ) -> dict[str, dict[str, Any] | None]:
        """Wait for a coordinated set of runs and stop peers after one fails."""

        ordered = list(run_ids)
        if not ordered or len(set(ordered)) != len(ordered):
            raise ValueError("run_ids must contain unique run IDs")
        pending = set(ordered)
        records: dict[str, dict[str, Any] | None] = {}
        lock = getattr(self, "_group_lock", None)
        with lock if lock is not None else nullcontext():
            for run_id in ordered:
                if run_id in self._completed:
                    records[run_id] = self._completed.pop(run_id)
                    pending.remove(run_id)

        deadline = None if timeout_seconds is None else time.monotonic() + timeout_seconds
        cancellation_requested = False

        def cancel_pending() -> None:
            nonlocal cancellation_requested
            if cancellation_requested or not cancel_on_failure:
                return
            cancellation_requested = True
            for pending_run_id in tuple(pending):
                try:
                    self.cancel(pending_run_id)
                except KeyError:
                    pass

        if any(not record or record.get("status") != RunStatus.SUCCEEDED.value for record in records.values()):
            cancel_pending()

        while pending:
            self.check_workers()
            remaining = None if deadline is None else max(0.0, deadline - time.monotonic())
            if remaining == 0.0:
                cancel_pending()
                raise TimeoutError(f"timed out waiting for runs: {', '.join(sorted(pending))}")
            try:
                event_queue = self.event_queue
                assert event_queue is not None
                event = event_queue.get(timeout=remaining)
            except queue.Empty as exc:
                cancel_pending()
                raise TimeoutError(f"timed out waiting for runs: {', '.join(sorted(pending))}") from exc
            record = self.handle_event(event)
            if event.get("type") != "result":
                continue
            event_run_id = event.get("run_id")
            if not isinstance(event_run_id, str):
                continue
            if event_run_id not in pending:
                if isinstance(record, dict):
                    lock = getattr(self, "_group_lock", None)
                    with lock if lock is not None else nullcontext():
                        self._completed[event_run_id] = record
                continue
            records[event_run_id] = record
            pending.remove(event_run_id)
            if not isinstance(record, dict) or record.get("status") != RunStatus.SUCCEEDED.value:
                cancel_pending()

        return {run_id: records.get(run_id) for run_id in ordered}

    def handle_event(self, event: dict[str, Any]) -> dict[str, Any] | None:
        if event.get("type") == "ocr_request":
            self._handle_ocr(event)
            return None
        if event.get("type") == "reward_stats_request":
            if self._reward_stats is None:
                self._reward_stats = RewardStatsProcessor(
                    self.config.artifact_dir,
                    self._recognize_reward_image,
                    logger=self.logger,
                    material_catalog=self.config.root_dir / "assets" / "templates" / "rewards" / "catalog.json",
                )
            if not self._reward_stats.submit(event):
                self.logger.emit(
                    "reward_stats.dropped",
                    run_id=event.get("run_id"),
                    screenshot=event.get("screenshot"),
                )
            return None
        if event.get("type") != "result":
            return None
        run_id = event.get("run_id")
        if isinstance(run_id, str):
            lock = getattr(self, "_group_lock", None)
            with lock if lock is not None else nullcontext():
                self._runs.pop(run_id, None)
        record = event.get("record")
        if isinstance(run_id, str) and isinstance(record, dict):
            self._update_group_record(run_id, record)
        return record if isinstance(record, dict) else None

    def _update_group_record(self, run_id: str, record: dict[str, Any]) -> None:
        group_lock = getattr(self, "_group_lock", None)
        run_groups = getattr(self, "_run_groups", {})
        groups = getattr(self, "_groups", {})
        if group_lock is None:
            return
        with group_lock:
            group_id = run_groups.get(run_id)
            group = groups.get(group_id) if group_id else None
            if group is None:
                return
            group.records[run_id] = record
            self._persist_group(group)

    def check_workers(self) -> None:
        """Isolate a crashed instance and restart its worker process."""

        with self._group_lock:
            workers = list(self.workers.items())
        for instance_id, worker in workers:
            if worker.process.is_alive():
                continue
            self.logger.emit("worker.crashed", level=40, instance_id=instance_id, exitcode=worker.process.exitcode)
            with self._group_lock:
                active_runs = list(self._runs.items())
            for run_id, run_instance in active_runs:
                if run_instance != instance_id:
                    continue
                store = AtomicJsonStore(self.config.artifact_dir / "runs" / f"{run_id}.json")
                record = store.read(default={})
                if not isinstance(record, dict):
                    record = {}
                if record.get("status") in {
                    RunStatus.QUEUED.value,
                    RunStatus.RUNNING.value,
                    RunStatus.RETRYING.value,
                } or not record:
                    record.setdefault("run_id", run_id)
                    record.setdefault("instance_id", instance_id)
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
            with self._group_lock:
                # Another caller may have already isolated and restarted this
                # worker while we were writing interruption metadata.
                current = self.workers.get(instance_id)
                if current is not worker:
                    continue
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
        instance_id = event.get("instance_id")
        request_id = event.get("id")
        if not isinstance(instance_id, str) or not isinstance(request_id, str):
            return
        worker = self.workers.get(instance_id)
        if worker is None:
            return
        if not self.config.ocr.enabled:
            worker.response_queue.put({"id": request_id, "error": "OCR is disabled"})
            return
        workers = max(1, int(getattr(self.config.ocr, "workers", 1)))
        if self._ocr_executor is None:
            self._ocr_executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="supervisor-ocr")
            self._ocr_slots = threading.BoundedSemaphore(workers * 2)
        slots = self._ocr_slots
        if slots is None or not slots.acquire(blocking=False):
            worker.response_queue.put({"id": request_id, "error": "OCR queue is full"})
            self.logger.emit("ocr.queue_full", instance_id=instance_id, request_id=request_id)
            return
        started = time.monotonic()
        self.logger.emit("ocr.request_started", instance_id=instance_id, request_id=request_id)

        def process() -> None:
            try:
                results = self._recognize_reward_image(event.get("image"))
                worker.response_queue.put({"id": request_id, "results": results})
                self.logger.emit(
                    "ocr.request_completed",
                    instance_id=instance_id,
                    request_id=request_id,
                    duration_ms=round((time.monotonic() - started) * 1000, 3),
                )
            except Exception as exc:
                worker.response_queue.put({"id": request_id, "error": str(exc)})
                self.logger.emit(
                    "ocr.request_failed",
                    level=40,
                    instance_id=instance_id,
                    request_id=request_id,
                    duration_ms=round((time.monotonic() - started) * 1000, 3),
                    error=str(exc),
                )
            finally:
                slots.release()

        try:
            self._ocr_executor.submit(process)
        except RuntimeError:
            slots.release()
            worker.response_queue.put({"id": request_id, "error": "OCR is unavailable"})

    def _recognize_reward_image(self, image: object) -> list[Any]:
        if not self.config.ocr.enabled:
            raise RuntimeError("OCR is disabled")
        if self._stopping:
            raise RuntimeError("supervisor is stopping")
        with self._ocr_lock:
            if self._stopping:
                raise RuntimeError("supervisor is stopping")
            if self.ocr_pool is None:
                self.ocr_pool = SharedOcrPool(
                    language=self.config.ocr.language,
                    workers=self.config.ocr.workers,
                    timeout_seconds=self.config.ocr.request_timeout_seconds,
                    min_confidence=self.config.ocr.min_confidence,
                    use_gpu=self.config.ocr.use_gpu,
                )
            return self.ocr_pool.recognize(image)

    def cancel(self, run_id: str) -> None:
        with self._group_lock:
            group = self._groups.get(run_id)
            if group is not None:
                group.cancel_requested = True
                child_ids = tuple(group.run_ids)
            else:
                child_ids = ()
                instance_id = self._runs.get(run_id)
                if instance_id is None:
                    raise KeyError(run_id)
                worker = self.workers.get(instance_id)
                if worker is None:
                    raise KeyError(run_id)
        if group is not None:
            for child_id in child_ids:
                try:
                    self.cancel(child_id)
                except KeyError:
                    continue
            self.logger.emit("group.cancel_requested", group_id=run_id, run_ids=list(child_ids))
            return
        record = AtomicJsonStore(self.config.artifact_dir / "runs" / f"{run_id}.json").read(default={})
        if isinstance(record, dict) and record.get("status") in {
            RunStatus.SUCCEEDED.value,
            RunStatus.FAILED.value,
            RunStatus.CANCELLED.value,
            RunStatus.INTERRUPTED.value,
        }:
            with self._group_lock:
                self._runs.pop(run_id, None)
            raise KeyError(run_id)
        assert worker is not None
        worker.control_queue.put({"type": "cancel", "run_id": run_id})
        self.logger.emit("run.cancel_requested", run_id=run_id, instance_id=instance_id)

    def stop(self, *, wait_seconds: float = 10.0) -> None:
        with self._group_lock:
            for group in self._groups.values():
                group.done.set()
            workers = list(self.workers.values())
        for worker in workers:
            try:
                worker.control_queue.put_nowait({"type": "stop"})
            except (queue.Full, OSError):
                pass
            try:
                worker.command_queue.put_nowait({"type": "stop"})
            except (queue.Full, OSError):
                pass
        deadline = time.monotonic() + wait_seconds
        for worker in workers:
            remaining = max(0.0, deadline - time.monotonic())
            worker.process.join(remaining)
        for worker in workers:
            if worker.process.is_alive():
                worker.process.terminate()
                worker.process.join()
            self.logger.emit("worker.stopped", instance_id=worker.instance.id, exitcode=worker.process.exitcode)
        with self._group_lock:
            self.workers.clear()
            self._runs.clear()
            self._completed.clear()
            self._groups.clear()
            self._run_groups.clear()
        if self._reward_stats is not None:
            drained = self._reward_stats.close(wait_seconds=15.0)
            if not drained:
                self._stopping = True
                if self.ocr_pool is not None:
                    self.ocr_pool.close(force=True)
                    self.ocr_pool = None
                self._reward_stats.close(wait_seconds=2.0)
            self._reward_stats = None
        self._stopping = True
        if self.ocr_pool is not None:
            self.ocr_pool.close(force=True)
            self.ocr_pool = None
        if self._ocr_executor is not None:
            self._ocr_executor.shutdown(wait=True)
            self._ocr_executor = None
            self._ocr_slots = None

    def __enter__(self) -> "Supervisor":
        self.start()
        return self

    def __exit__(self, *_: object) -> None:
        self.stop()


__all__ = ["Supervisor"]
