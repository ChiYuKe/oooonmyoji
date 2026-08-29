"""Run records and atomic local JSON persistence."""

from __future__ import annotations

import json
import os
import tempfile
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import StrEnum
from pathlib import Path
from typing import Any


DEFAULT_STEP_HISTORY_LIMIT = 250
_TRANSIENT_REPLACE_WINERRORS = {5, 32, 33}


class RunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    RETRYING = "retrying"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"
    INTERRUPTED = "interrupted"


@dataclass
class RunRecord:
    run_id: str
    job_id: str
    instance_id: str
    plugin_id: str | None
    status: RunStatus
    workflow_id: str | None = None
    workflow_version: str | None = None
    workflow_file_hash: str | None = None
    current_step: str | None = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    started_at: str | None = None
    finished_at: str | None = None
    duration_ms: float | None = None
    error: str | None = None
    error_category: str | None = None
    artifacts: list[str] = field(default_factory=list)
    step_history: list[dict[str, Any]] = field(default_factory=list)
    step_history_total: int = 0
    step_history_dropped: int = 0
    details: dict[str, Any] = field(default_factory=dict)

    def append_step(self, event: dict[str, Any], *, limit: int = DEFAULT_STEP_HISTORY_LIMIT) -> None:
        if limit < 1:
            raise ValueError("step history limit must be positive")
        self.step_history.append(dict(event))
        self.step_history_total += 1
        overflow = len(self.step_history) - limit
        if overflow > 0:
            del self.step_history[:overflow]
            self.step_history_dropped += overflow

    def to_dict(self) -> dict[str, Any]:
        result = asdict(self)
        result["status"] = self.status.value
        return result


class AtomicJsonStore:
    def __init__(
        self,
        path: Path | str,
        *,
        replace_attempts: int = 10,
        replace_retry_base_seconds: float = 0.025,
        replace_retry_max_seconds: float = 0.5,
    ) -> None:
        if replace_attempts < 1:
            raise ValueError("replace_attempts must be positive")
        if replace_retry_base_seconds < 0 or replace_retry_max_seconds < 0:
            raise ValueError("replace retry delays must not be negative")
        self.path = Path(path)
        self.replace_attempts = replace_attempts
        self.replace_retry_base_seconds = replace_retry_base_seconds
        self.replace_retry_max_seconds = replace_retry_max_seconds

    def read(self, default: Any = None) -> Any:
        if not self.path.is_file():
            return default
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return default

    def write(self, value: Any) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary_name = tempfile.mkstemp(prefix=f".{self.path.name}.", suffix=".tmp", dir=self.path.parent)
        temporary_path = Path(temporary_name)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
                json.dump(value, stream, ensure_ascii=False, indent=2, sort_keys=True)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            self._replace_with_retry(temporary_path)
        finally:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                pass

    def _replace_with_retry(self, temporary_path: Path) -> None:
        for attempt in range(self.replace_attempts):
            try:
                os.replace(temporary_path, self.path)
                return
            except OSError as exc:
                winerror = getattr(exc, "winerror", None)
                transient = isinstance(exc, PermissionError) or winerror in _TRANSIENT_REPLACE_WINERRORS
                if not transient or attempt + 1 >= self.replace_attempts:
                    raise
                delay = min(
                    self.replace_retry_base_seconds * (2**attempt),
                    self.replace_retry_max_seconds,
                )
                if delay > 0:
                    time.sleep(delay)


__all__ = ["AtomicJsonStore", "DEFAULT_STEP_HISTORY_LIMIT", "RunRecord", "RunStatus"]
