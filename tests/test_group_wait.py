"""GroupWaiter 独立测试：wait_for any/all、失败即取消与超时收尾。"""

from __future__ import annotations

import threading
from types import SimpleNamespace

from src.oooonmyoji.runtime.group import _Group
from src.oooonmyoji.runtime.group_wait import GroupWaiter
from src.oooonmyoji.runtime.records import RunStatus


def make_group(*, run_ids: list[str], wait_for: str, cancel_on_failure: bool) -> _Group:
    node = SimpleNamespace(id="run_all", wait_for=wait_for, cancel_on_failure=cancel_on_failure)
    workflow = SimpleNamespace(workflow_id="all-accounts")
    return _Group("group-1-abcd", workflow, node, run_ids, [], {}, threading.Event())  # type: ignore[arg-type]


def make_waiter(records: dict[str, dict | None], *, stopping: bool = False):
    finished: list[_Group] = []
    cancelled: list[_Group] = []
    timed_out: list[_Group] = []

    waiter = GroupWaiter(
        lock=threading.RLock(),
        is_stopping=lambda: stopping,
        read_run_record=lambda run_id: records.get(run_id, {}),
        cancel_group_runs=cancelled.append,
        mark_group_timeout=timed_out.append,
        finish_group=finished.append,
        check_workers=lambda: None,
        poll_interval=0.0,
    )
    return waiter, finished, cancelled, timed_out


def test_all_succeeded_collects_every_child_and_finishes_once() -> None:
    group = make_group(run_ids=["r1", "r2"], wait_for="all", cancel_on_failure=True)
    records = {"r1": {"status": RunStatus.SUCCEEDED.value}, "r2": {"status": RunStatus.SUCCEEDED.value}}
    waiter, finished, cancelled, timed_out = make_waiter(records)

    waiter.wait(group, timeout_seconds=1)

    assert set(group.records) == {"r1", "r2"}
    assert finished == [group]
    assert cancelled == []
    assert timed_out == []


def test_wait_for_any_finishes_on_first_success_and_cancels_peers() -> None:
    group = make_group(run_ids=["r1", "r2"], wait_for="any", cancel_on_failure=True)
    records = {"r1": {"status": RunStatus.SUCCEEDED.value}, "r2": {"status": RunStatus.RUNNING.value}}
    waiter, finished, cancelled, timed_out = make_waiter(records)

    waiter.wait(group, timeout_seconds=1)

    assert cancelled == [group]
    assert finished == [group]
    assert timed_out == []
    # 仍在运行的兄弟不会被当成终态收进 records。
    assert set(group.records) == {"r1"}


def test_any_without_cancel_on_failure_leaves_peers_running() -> None:
    group = make_group(run_ids=["r1", "r2"], wait_for="any", cancel_on_failure=False)
    records = {"r1": {"status": RunStatus.SUCCEEDED.value}, "r2": {"status": RunStatus.RUNNING.value}}
    waiter, finished, cancelled, _ = make_waiter(records)

    waiter.wait(group, timeout_seconds=1)

    assert finished == [group]
    assert cancelled == []


def test_failure_cancels_pending_children_then_times_out() -> None:
    group = make_group(run_ids=["r1", "r2"], wait_for="all", cancel_on_failure=True)
    records = {"r1": {"status": RunStatus.FAILED.value}, "r2": {"status": RunStatus.RUNNING.value}}
    waiter, finished, cancelled, timed_out = make_waiter(records)

    waiter.wait(group, timeout_seconds=0)

    # 失败即请求取消兄弟，随后按超时收尾（不假装未完成的子 run 成功）。
    assert cancelled == [group]
    assert timed_out == [group]
    assert finished == [group]


def test_timeout_marks_terminal_without_cancelling_when_disabled() -> None:
    group = make_group(run_ids=["r1"], wait_for="all", cancel_on_failure=False)
    waiter, finished, cancelled, timed_out = make_waiter({"r1": {"status": RunStatus.RUNNING.value}})

    waiter.wait(group, timeout_seconds=0)

    assert timed_out == [group]
    assert finished == [group]
    assert cancelled == []


def test_group_done_or_supervisor_stopping_returns_without_finishing() -> None:
    group = make_group(run_ids=["r1"], wait_for="all", cancel_on_failure=True)
    group.done.set()
    waiter, finished, cancelled, timed_out = make_waiter({})

    waiter.wait(group, timeout_seconds=None)

    assert finished == [] and cancelled == [] and timed_out == []

    stopping_group = make_group(run_ids=["r1"], wait_for="all", cancel_on_failure=True)
    stopping_waiter, finished2, _, _ = make_waiter({}, stopping=True)

    stopping_waiter.wait(stopping_group, timeout_seconds=None)

    assert finished2 == []
