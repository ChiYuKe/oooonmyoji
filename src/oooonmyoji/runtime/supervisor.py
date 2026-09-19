"""Spawn-based multi-instance supervisor."""

from __future__ import annotations

import multiprocessing as mp
import queue
import threading
import time
import uuid
from contextlib import nullcontext
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..actions import build_action_registry
from ..config.model import AppConfig, InstanceConfig, JobConfig
from ..vision.ocr import SharedOcrPool
from ..workflows.loader import WorkflowLoader
from ..workflows.model import WorkflowNode, WorkflowSpec
from ..workflows.resolver import ReferenceResolver
from .group import _Group, group_payload, group_status
from .group_wait import GroupWaiter
from .logging import EventLogger
from .ocr_dispatch import OcrDispatcher
from .records import AtomicJsonStore, RunStatus
from .reconciliation import reconcile_stale_run_records
from .reward_stats import RewardStatsProcessor
from .worker import _Worker
from .worker_lifecycle import WorkerLifecycle
# Keep these names importable for existing callers and cancellation tests.
from .worker import _activate_run_cancel as _activate_run_cancel
from .worker import _apply_cancel_request as _apply_cancel_request


class Supervisor:
    """Owns one spawn worker per configured instance and one OCR pool."""

    def __init__(self, config: AppConfig) -> None:
        self.config = config
        self.logger = EventLogger(config.log_dir)
        self.event_queue: Any | None = None
        self.workers: dict[str, _Worker] = {}
        self._runs: dict[str, str] = {}
        self._completed: dict[str, dict[str, Any]] = {}
        self._workflow_loader: WorkflowLoader | None = None
        self._groups: dict[str, _Group] = {}
        self._run_groups: dict[str, str] = {}
        self._group_lock = threading.RLock()
        self._reward_stats: RewardStatsProcessor | None = None
        self._stopping = False
        # OCR 的池与线程池归 OcrDispatcher；self.ocr_pool 仍是它的只读/可写视图。
        self._ocr = OcrDispatcher(config, self.logger, is_stopping=lambda: self._stopping)
        # 工作进程的创建与崩溃重启归 WorkerLifecycle（与 self.workers 共用同一份字典）。
        self._workers_lifecycle = WorkerLifecycle(
            config=config,
            logger=self.logger,
            workers=self.workers,
            runs=self._runs,
            lock=self._group_lock,
            event_queue=lambda: self.event_queue,
        )
        # 运行组等待循环归 GroupWaiter；回调都经属性查找，保留测试替换这些方法的口子。
        self._group_waiter = self._create_group_waiter()

    def _create_group_waiter(self) -> GroupWaiter:
        """装配运行组等待循环；回调都经属性查找，保留测试替换这些方法的口子。"""

        return GroupWaiter(
            lock=self._group_lock,
            is_stopping=lambda: self._stopping,
            read_run_record=lambda run_id: self._group_store(run_id).read(default={}),
            cancel_group_runs=lambda group: self._cancel_group_runs(group),
            mark_group_timeout=lambda group: self._mark_group_timeout(group),
            finish_group=lambda group: self._finish_group(group),
            check_workers=lambda: self.check_workers(),
        )

    @property
    def ocr_pool(self) -> SharedOcrPool | None:
        """共享 OCR 池（由 OcrDispatcher 持有）；保留该名字供调用方与测试使用。"""

        return self._ocr.pool

    @ocr_pool.setter
    def ocr_pool(self, pool: SharedOcrPool | None) -> None:
        self._ocr.pool = pool

    def start(self) -> None:
        with self._group_lock:
            if self.workers:
                return
            self._stopping = False
            self._reconcile_stale_run_records()
            context = mp.get_context("spawn")
            self.event_queue = context.Queue()
            for instance in self.config.instances:
                if not instance.enabled:
                    continue
                self._start_worker(context, instance)

    def _reconcile_stale_run_records(self, *, stale_after_seconds: float = 300.0) -> list[str]:
        """启动收敛：关闭归属进程已退出的非终态 run/group 记录。"""

        return reconcile_stale_run_records(self.config.artifact_dir, self.logger, stale_after_seconds=stale_after_seconds)


    def _start_worker(self, context: Any, instance: InstanceConfig) -> None:
        self._workers_lifecycle.spawn(context, instance)

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
        return group_payload(group, status=status)

    @staticmethod
    def _group_status(group: _Group) -> str:
        return group_status(group)

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
                    self._workflow_loader.normalize_inputs(child_workflow, resolved_inputs, declared_only=True)
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
        """轮询整组子 run 直到结束（实现见 GroupWaiter）。"""

        waiter = getattr(self, "_group_waiter", None)
        if waiter is None:
            # 测试会用 __new__ 手工装配实例，这里按需补建。
            waiter = self._create_group_waiter()
            self._group_waiter = waiter
        waiter.wait(group, timeout_seconds=timeout_seconds)

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

        self._workers_lifecycle.restart_crashed()

    def _handle_ocr(self, event: dict[str, Any]) -> None:
        """把工作进程的识别请求转给 OcrDispatcher（回执写回该进程的响应队列）。"""

        instance_id = event.get("instance_id")
        worker = self.workers.get(instance_id) if isinstance(instance_id, str) else None
        self._ocr.handle(event, worker)

    def _recognize_reward_image(self, image: object) -> list[Any]:
        """同步识别（奖励统计复用）；池的创建与关闭在 OcrDispatcher 内。"""

        return self._ocr.recognize(image)

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
        self._ocr.close()

    def __enter__(self) -> "Supervisor":
        self.start()
        return self

    def __exit__(self, *_: object) -> None:
        self.stop()


__all__ = ["Supervisor"]
