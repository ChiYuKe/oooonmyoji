"""启动时收敛遗留运行记录：把归属进程已退出的非终态 run/group 标记为中断。"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..devices.lock import InstanceLock, InstanceLockError
from .logging import EventLogger
from .records import AtomicJsonStore, RunStatus


def reconcile_stale_run_records(
    artifact_dir: Path,
    logger: EventLogger,
    *,
    stale_after_seconds: float = 300.0,
) -> list[str]:
    """Close records left non-terminal after their owning process exited.

    A live controller holds the per-instance OS lock for a running task. The
    age grace covers the short queue-to-lock window during normal startup.
    """

    runs_dir = artifact_dir / "runs"
    if not runs_dir.is_dir():
        return []
    transient = {
        RunStatus.QUEUED.value,
        RunStatus.RUNNING.value,
        RunStatus.RETRYING.value,
    }
    terminal = {
        RunStatus.SUCCEEDED.value,
        RunStatus.FAILED.value,
        RunStatus.CANCELLED.value,
        RunStatus.INTERRUPTED.value,
    }
    now = time.time()
    finished_at = datetime.now(timezone.utc).isoformat()
    lock_available: dict[str, bool] = {}
    reconciled: list[str] = []

    def is_stale(path: Path) -> bool:
        try:
            return now - path.stat().st_mtime >= stale_after_seconds
        except OSError:
            return False

    records: dict[str, tuple[Path, dict[str, Any]]] = {}
    for path in runs_dir.glob("*.json"):
        record = AtomicJsonStore(path).read(default={})
        if isinstance(record, dict):
            records[path.stem] = (path, record)

    for record_id, (path, record) in records.items():
        if record.get("status") not in transient or isinstance(record.get("runs"), list) or not is_stale(path):
            continue
        instance_id = record.get("instance_id")
        if not isinstance(instance_id, str) or not instance_id:
            continue
        if instance_id not in lock_available:
            lock = InstanceLock(artifact_dir / "locks", instance_id)
            try:
                lock.acquire()
            except InstanceLockError:
                lock_available[instance_id] = False
            else:
                lock_available[instance_id] = True
                lock.release()
        if not lock_available[instance_id]:
            continue
        record["status"] = RunStatus.INTERRUPTED.value
        record["finished_at"] = finished_at
        record["error"] = "owning supervisor exited before the run reached a terminal status"
        record["error_category"] = "internal"
        details = record.setdefault("details", {})
        if isinstance(details, dict):
            details["reconciled_at_startup"] = True
        AtomicJsonStore(path).write(record)
        reconciled.append(record_id)
        logger.emit("run.stale_reconciled", run_id=record_id, instance_id=instance_id)

    for group_id, (path, group) in records.items():
        if group.get("status") not in transient or not isinstance(group.get("runs"), list) or not is_stale(path):
            continue
        child_records: dict[str, dict[str, Any]] = {}
        for run_id in group.get("run_ids", []):
            if not isinstance(run_id, str):
                continue
            child = AtomicJsonStore(runs_dir / f"{run_id}.json").read(default={})
            if isinstance(child, dict):
                child_records[run_id] = child
        run_ids = [run_id for run_id in group.get("run_ids", []) if isinstance(run_id, str)]
        if not run_ids or any(child_records.get(run_id, {}).get("status") not in terminal for run_id in run_ids):
            continue
        for entry in group["runs"]:
            if isinstance(entry, dict) and isinstance(entry.get("run_id"), str):
                child = child_records.get(entry["run_id"])
                if child is not None:
                    entry["status"] = child.get("status")
        group["status"] = RunStatus.INTERRUPTED.value
        group["finished_at"] = finished_at
        group["error"] = "owning supervisor exited before the group reached a terminal status"
        group["error_category"] = "internal"
        AtomicJsonStore(path).write(group)
        reconciled.append(group_id)
        logger.emit("group.stale_reconciled", group_id=group_id, run_ids=run_ids)
    return reconciled
