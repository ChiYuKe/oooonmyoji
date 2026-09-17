"""Instance process entry point and cancellation state."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any

from ..actions import build_action_registry
from ..config.loader import load_config
from ..config.model import InstanceConfig, JobConfig
from ..workflows.loader import WorkflowLoader
from .logging import EventLogger
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
