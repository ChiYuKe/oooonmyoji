"""Deterministic scheduling state machine."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterable
from zoneinfo import ZoneInfo

from ..config.model import JobConfig
from .records import AtomicJsonStore


def ensure_timezone(value: datetime, timezone_name: str) -> datetime:
    zone = ZoneInfo(timezone_name)
    if value.tzinfo is None:
        return value.replace(tzinfo=zone)
    return value.astimezone(zone)


def parse_schedule_time(value: str, timezone_name: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"invalid schedule time: {value}") from exc
    return ensure_timezone(parsed, timezone_name)


class ScheduleCalculator:
    @staticmethod
    def interval_next(last_finished: datetime, seconds: float) -> datetime:
        return last_finished + timedelta(seconds=seconds)

    @staticmethod
    def once_due(scheduled_at: datetime, now: datetime, *, consumed: bool) -> bool:
        return not consumed and now >= scheduled_at


@dataclass(frozen=True)
class DueJob:
    job: JobConfig
    due_at: datetime


class Scheduler:
    def __init__(self, jobs: Iterable[JobConfig], state_path: Path | str, *, timezone_name: str = "Asia/Shanghai") -> None:
        self.jobs = {job.id: job for job in jobs}
        self.timezone_name = timezone_name
        self.state_store = AtomicJsonStore(state_path)
        raw = self.state_store.read(default={})
        self.state: dict[str, dict[str, Any]] = raw if isinstance(raw, dict) else {}
        self._initialize()

    def _initialize(self) -> None:
        changed = False
        current = ensure_timezone(datetime.now(), self.timezone_name)
        for job in self.jobs.values():
            if job.id in self.state:
                continue
            schedule_type = job.schedule.get("type", "manual")
            item: dict[str, Any] = {"running": False, "consumed": False, "last_finished": None, "next_due": None}
            if schedule_type == "once" and isinstance(job.schedule.get("at"), str):
                item["next_due"] = parse_schedule_time(job.schedule["at"], self.timezone_name).isoformat()
            elif schedule_type == "interval":
                start_at = job.schedule.get("start_at")
                if isinstance(start_at, str):
                    item["next_due"] = parse_schedule_time(start_at, self.timezone_name).isoformat()
                else:
                    item["next_due"] = (current + timedelta(seconds=float(job.schedule["seconds"]))).isoformat()
            self.state[job.id] = item
            changed = True
        if changed:
            self._save()

    def _save(self) -> None:
        self.state_store.write(self.state)

    def _time(self, value: datetime | None) -> datetime:
        return ensure_timezone(value or datetime.now(), self.timezone_name)

    def _due_at(self, job_id: str) -> datetime | None:
        value = self.state[job_id].get("next_due")
        if not isinstance(value, str):
            return None
        return parse_schedule_time(value, self.timezone_name)

    def tick(self, now: datetime | None = None) -> list[DueJob]:
        current = self._time(now)
        due: list[DueJob] = []
        changed = False
        for job in self.jobs.values():
            if not job.enabled or job.schedule.get("type", "manual") == "manual":
                continue
            item = self.state[job.id]
            if item.get("running"):
                continue
            due_at = self._due_at(job.id)
            if due_at is None or current < due_at:
                continue
            item["running"] = True
            item["started_at"] = current.isoformat()
            # Reserving the due item before handing it to a worker prevents duplicate dispatch after a crash.
            item["next_due"] = None
            if job.schedule.get("type") == "once":
                item["consumed"] = True
            due.append(DueJob(job, due_at))
            changed = True
        if changed:
            self._save()
        return due

    def mark_finished(self, job_id: str, finished_at: datetime | None = None) -> None:
        job = self.jobs[job_id]
        current = self._time(finished_at)
        item = self.state[job_id]
        item["running"] = False
        item["last_finished"] = current.isoformat()
        if job.schedule.get("type") == "interval":
            seconds = float(job.schedule["seconds"])
            item["next_due"] = ScheduleCalculator.interval_next(current, seconds).isoformat()
        self._save()

    def mark_failed(self, job_id: str, finished_at: datetime | None = None) -> None:
        self.mark_finished(job_id, finished_at)

    def recover(self, *, now: datetime | None = None, retry_safe_job_ids: set[str] | None = None) -> list[str]:
        """Mark jobs left running by a dead supervisor as interrupted.

        Only explicitly safe jobs are made immediately runnable. Other jobs are
        advanced beyond the outage and are never silently replayed.
        """

        current = self._time(now)
        retry_safe_job_ids = retry_safe_job_ids or set()
        interrupted: list[str] = []
        changed = False
        for job_id, item in self.state.items():
            if not item.get("running"):
                continue
            interrupted.append(job_id)
            item["running"] = False
            item["interrupted_at"] = current.isoformat()
            job = self.jobs.get(job_id)
            if job_id in retry_safe_job_ids and job is not None and job.retry_enabled:
                item["consumed"] = False
                item["next_due"] = current.isoformat()
            elif job is not None and job.schedule.get("type") == "interval":
                item["next_due"] = (current + timedelta(seconds=float(job.schedule["seconds"]))).isoformat()
            else:
                item["consumed"] = True
                item["next_due"] = None
            changed = True
        if changed:
            self._save()
        return interrupted

    def status(self) -> dict[str, dict[str, Any]]:
        return {key: dict(value) for key, value in self.state.items()}


__all__ = ["DueJob", "ScheduleCalculator", "Scheduler", "ensure_timezone", "parse_schedule_time"]
