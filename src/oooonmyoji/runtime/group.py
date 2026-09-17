"""Instance-parallel group state and persisted record shape."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any

from ..workflows.model import WorkflowNode, WorkflowSpec
from .records import RunStatus


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


def group_status(group: _Group) -> str:
    if group.terminal_status is not None:
        return group.terminal_status
    if len(group.records) < len(group.run_ids):
        return RunStatus.QUEUED.value
    statuses = []
    for run_id in group.run_ids:
        record = group.records.get(run_id)
        statuses.append(record.get("status") if isinstance(record, dict) else RunStatus.FAILED.value)
    if group.node.wait_for == "any" and RunStatus.SUCCEEDED.value in statuses:
        return RunStatus.SUCCEEDED.value
    if all(status == RunStatus.SUCCEEDED.value for status in statuses):
        return RunStatus.SUCCEEDED.value
    if all(status == RunStatus.CANCELLED.value for status in statuses):
        return RunStatus.CANCELLED.value
    return RunStatus.FAILED.value


def group_payload(group: _Group, *, status: str | None = None) -> dict[str, Any]:
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
        "status": status or group_status(group),
        "wait_for": group.node.wait_for,
        "cancel_on_failure": group.node.cancel_on_failure,
        "run_ids": list(group.run_ids),
        "runs": child_rows,
    }
