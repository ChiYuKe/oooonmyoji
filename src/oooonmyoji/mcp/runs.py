"""Session-owned CLI runs: background execution, progress and cancellation."""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import threading
from collections.abc import Callable
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4


def terminate_process_tree(process: subprocess.Popen[str]) -> None:
    """Terminate only the CLI process owned by this run and its children."""
    if process.poll() is not None:
        return
    if sys.platform == "win32":
        try:
            result = subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(process.pid)],
                capture_output=True, timeout=30, check=False,
            )
            if result.returncode == 0:
                return
        except (OSError, subprocess.SubprocessError):
            pass
        if process.poll() is None:
            process.kill()
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


class RunManager:
    """Keep a bounded history and never accept arbitrary process IDs to cancel."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._runs: dict[str, dict[str, Any]] = {}
        self._closed = False

    def run(self, operation: Callable[[str], dict[str, Any]], *, workflow: str, instance: str, wait: bool) -> dict[str, Any]:
        run_id = f"mcp-{uuid4().hex}"
        with self._lock:
            if self._closed:
                raise RuntimeError("MCP run manager is closed")
            if sum(item["status"] in ("running", "cancelling") for item in self._runs.values()) >= 8:
                return {"ok": False, "code": "too_many_runs"}
            for key in list(self._runs):
                if len(self._runs) < 100:
                    break
                if self._runs[key]["status"] not in ("running", "cancelling"):
                    del self._runs[key]
            self._runs[run_id] = {
                "mcp_run_id": run_id, "workflow": workflow, "instance": instance,
                "status": "running", "started_at": datetime.now(timezone.utc).isoformat(),
            }

        def execute() -> dict[str, Any]:
            try:
                result = operation(run_id)
            except Exception as exc:
                result = {"ok": False, "code": "run_error", "error": str(exc)}
            with self._lock:
                item = self._runs[run_id]
                cancelled = item["status"] == "cancelling"
                if cancelled:
                    result = {**result, "ok": False, "code": "run_cancelled", "status": "cancelled"}
                item.update(
                    status="cancelled" if cancelled else ("succeeded" if result.get("ok") else "failed"),
                    result={**result, "mcp_run_id": run_id},
                    finished_at=datetime.now(timezone.utc).isoformat(),
                )
                item.pop("process", None)
                return dict(item["result"])

        if wait:
            return execute()
        threading.Thread(target=execute, name=run_id, daemon=True).start()
        return {"ok": True, "mcp_run_id": run_id, "status": "running", "workflow": workflow, "instance": instance}

    def bind(self, run_id: str, process: subprocess.Popen[str], events_file: str) -> None:
        with self._lock:
            item = self._runs[run_id]
            item.update(process=process, events_file=events_file)
            if item["status"] == "cancelling":
                terminate_process_tree(process)

    def status(self, run_id: str | None = None) -> dict[str, Any]:
        with self._lock:
            if run_id is None:
                return {"ok": True, "runs": [self._snapshot(item) for item in self._runs.values()]}
            item = self._runs.get(run_id)
            return {"ok": True, **self._snapshot(item)} if item else {"ok": False, "code": "run_not_found", "mcp_run_id": run_id}

    @staticmethod
    def _snapshot(item: dict[str, Any]) -> dict[str, Any]:
        return deepcopy({key: value for key, value in item.items() if key != "process"})

    def cancel(self, run_id: str) -> dict[str, Any]:
        with self._lock:
            item = self._runs.get(run_id)
            if item is None:
                return {"ok": False, "code": "run_not_found", "mcp_run_id": run_id}
            if item["status"] not in ("running", "cancelling"):
                return {"ok": True, "mcp_run_id": run_id, "status": item["status"], "already_finished": True}
            item["status"] = "cancelling"
            process = item.get("process")
            if process is not None:
                terminate_process_tree(process)
            return {"ok": True, "mcp_run_id": run_id, "status": "cancelling"}

    def close(self) -> None:
        with self._lock:
            self._closed = True
            for run_id in list(self._runs):
                self.cancel(run_id)
