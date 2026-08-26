from __future__ import annotations

from pathlib import Path

import pytest

from src.oooonmyoji.devices.lock import InstanceLock, InstanceLockError
from src.oooonmyoji.runtime.records import AtomicJsonStore
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
