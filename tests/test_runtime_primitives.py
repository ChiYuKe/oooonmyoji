from __future__ import annotations

from pathlib import Path

import pytest

from src.oooonmyoji.devices.lock import InstanceLock, InstanceLockError
from src.oooonmyoji.runtime import records as records_module
from src.oooonmyoji.runtime.records import AtomicJsonStore, RunRecord, RunStatus
from src.oooonmyoji.runtime.retry import retry_call


def test_instance_lock_is_exclusive(tmp_path: Path) -> None:
    first = InstanceLock(tmp_path, "mumu/0")
    second = InstanceLock(tmp_path, "mumu/0")
    first.acquire()
    try:
        with pytest.raises(InstanceLockError):
            second.acquire()
    finally:
        first.release()
    second.acquire()
    second.release()


def test_atomic_store_replaces_complete_json(tmp_path: Path) -> None:
    store = AtomicJsonStore(tmp_path / "state.json")
    store.write({"status": "running", "count": 1})
    assert store.read() == {"status": "running", "count": 1}


def test_atomic_store_retries_transient_replace_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    original_replace = records_module.os.replace
    calls = 0
    delays: list[float] = []

    def flaky_replace(source: Path, destination: Path) -> None:
        nonlocal calls
        calls += 1
        if calls < 3:
            raise PermissionError("temporarily locked")
        original_replace(source, destination)

    monkeypatch.setattr(records_module.os, "replace", flaky_replace)
    monkeypatch.setattr(records_module.time, "sleep", delays.append)
    store = AtomicJsonStore(
        tmp_path / "state.json",
        replace_attempts=3,
        replace_retry_base_seconds=0.01,
        replace_retry_max_seconds=0.02,
    )

    store.write({"status": "running"})

    assert calls == 3
    assert delays == [0.01, 0.02]
    assert store.read() == {"status": "running"}


def test_atomic_store_does_not_retry_non_transient_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0
    delays: list[float] = []

    def failed_replace(source: Path, destination: Path) -> None:
        nonlocal calls
        calls += 1
        raise FileNotFoundError("invalid destination")

    monkeypatch.setattr(records_module.os, "replace", failed_replace)
    monkeypatch.setattr(records_module.time, "sleep", delays.append)
    store = AtomicJsonStore(tmp_path / "state.json")

    with pytest.raises(FileNotFoundError, match="invalid destination"):
        store.write({"status": "running"})

    assert calls == 1
    assert delays == []
    assert not list(tmp_path.glob(".*.tmp"))


def test_run_record_retains_only_latest_step_history() -> None:
    record = RunRecord(
        run_id="run-one",
        job_id="job-one",
        instance_id="instance-one",
        plugin_id=None,
        status=RunStatus.RUNNING,
    )

    for index in range(5):
        record.append_step({"step_id": f"step-{index}"}, limit=3)

    assert [event["step_id"] for event in record.step_history] == ["step-2", "step-3", "step-4"]
    assert record.step_history_total == 5
    assert record.step_history_dropped == 2
    assert record.to_dict()["step_history_total"] == 5


def test_retry_uses_bounded_backoff() -> None:
    calls = 0
    delays: list[float] = []

    def operation() -> str:
        nonlocal calls
        calls += 1
        if calls < 3:
            raise RuntimeError("temporary")
        return "ok"

    assert retry_call(operation, attempts=3, base_delay_seconds=1, max_delay_seconds=1.5, sleep=delays.append) == "ok"
    assert delays == [1, 1.5]
