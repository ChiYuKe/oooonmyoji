from __future__ import annotations

from datetime import datetime
from pathlib import Path

from src.oooonmyoji.config.model import JobConfig
from src.oooonmyoji.runtime.scheduler import ScheduleCalculator, Scheduler, ensure_timezone


def _job(schedule: dict, *, retry_enabled: bool = False) -> JobConfig:
    return JobConfig("job", "diagnostic", "one", schedule=schedule, retry_enabled=retry_enabled)


def test_interval_is_calculated_from_finish_time(tmp_path: Path) -> None:
    job = _job({"type": "interval", "seconds": 60})
    scheduler = Scheduler([job], tmp_path / "state.json")
    finished = ensure_timezone(datetime(2026, 1, 1, 10, 0), "Asia/Shanghai")
    scheduler.mark_finished("job", finished)
    assert scheduler.status()["job"]["next_due"].startswith("2026-01-01T10:01:00")


def test_due_item_is_reserved_and_does_not_overlap(tmp_path: Path) -> None:
    job = _job({"type": "once", "at": "2026-01-01T10:00:00+08:00"})
    scheduler = Scheduler([job], tmp_path / "state.json")
    now = ensure_timezone(datetime(2026, 1, 1, 10, 1), "Asia/Shanghai")
    assert len(scheduler.tick(now)) == 1
    assert scheduler.tick(now) == []


def test_recovery_does_not_replay_unsafe_running_job(tmp_path: Path) -> None:
    job = _job({"type": "interval", "seconds": 60})
    scheduler = Scheduler([job], tmp_path / "state.json")
    due = scheduler.tick()
    assert due == []  # The first interval is scheduled after startup.
    scheduler.state["job"]["running"] = True
    scheduler.state_store.write(scheduler.state)
    assert scheduler.recover() == ["job"]
    assert scheduler.status()["job"]["next_due"] is not None


def test_interval_formula_is_fixed_delay() -> None:
    start = ensure_timezone(datetime(2026, 1, 1, 10, 0), "Asia/Shanghai")
    assert ScheduleCalculator.interval_next(start, 30).minute == 0
