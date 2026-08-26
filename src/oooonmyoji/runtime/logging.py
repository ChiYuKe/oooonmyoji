"""Human-readable and JSONL event logging with retention."""

from __future__ import annotations

import json
import logging
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Any


class EventLogger:
    def __init__(self, log_dir: Path | str, *, retention_days: int = 14, name: str = "oooonmyoji") -> None:
        self.log_dir = Path(log_dir)
        self.retention_days = retention_days
        self.name = name
        self._logger = logging.getLogger(name)
        self._logger.setLevel(logging.INFO)
        if not any(isinstance(handler, logging.StreamHandler) for handler in self._logger.handlers):
            console = logging.StreamHandler()
            console.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
            self._logger.addHandler(console)

    def emit(self, event: str, *, level: int = logging.INFO, **fields: Any) -> dict[str, Any]:
        now = time.time()
        timestamp = time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(now))
        payload = {"timestamp": timestamp, "event": event, **fields}
        self.log_dir.mkdir(parents=True, exist_ok=True)
        path = self.log_dir / f"events-{date.today().isoformat()}.jsonl"
        with path.open("a", encoding="utf-8", newline="\n") as stream:
            stream.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
        message = event
        if fields:
            message += " " + " ".join(f"{key}={value}" for key, value in fields.items())
        self._logger.log(level, message)
        self._prune()
        return payload

    def _prune(self) -> None:
        cutoff = date.today() - timedelta(days=self.retention_days - 1)
        for path in self.log_dir.glob("events-*.jsonl"):
            try:
                day = date.fromisoformat(path.stem.removeprefix("events-"))
            except ValueError:
                continue
            if day < cutoff:
                path.unlink(missing_ok=True)


__all__ = ["EventLogger"]
