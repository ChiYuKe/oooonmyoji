from __future__ import annotations

import threading

from src.oooonmyoji.runtime.supervisor import _activate_run_cancel, _apply_cancel_request


def test_cancel_received_before_worker_activates_run_is_applied() -> None:
    pending: set[str] = set()
    current = threading.Event()
    _apply_cancel_request("run-1", None, current, pending)

    active = _activate_run_cancel("run-1", pending)

    assert active.is_set()
    assert not pending


def test_cancel_for_old_run_does_not_cancel_current_run() -> None:
    pending: set[str] = set()
    current = threading.Event()
    _apply_cancel_request("old", "new", current, pending)

    assert not current.is_set()
    assert not pending


def test_cancel_for_completed_run_is_not_carried_to_next_run() -> None:
    pending: set[str] = set()
    current = threading.Event()
    completed = {"old"}
    _apply_cancel_request("old", None, current, pending, completed)

    active = _activate_run_cancel("new", pending)

    assert not active.is_set()
    assert not pending
