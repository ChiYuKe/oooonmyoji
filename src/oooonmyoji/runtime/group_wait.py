"""运行组等待：轮询子 run 记录，落实 wait_for(any/all)、失败取消与超时。

Supervisor 保留编排（谁组队、起哪些子 run、收到结果怎么记账），
这个循环只关心「组什么时候算结束」；依赖全部以回调注入，
可以脱离真实进程与事件队列单独测试。
"""

from __future__ import annotations

import time
from contextlib import AbstractContextManager, nullcontext
from typing import Any, Callable

from .group import _Group
from .records import RunStatus

# 子 run 出现这些状态即视为终态，可以收进 group.records。
TERMINAL_STATUSES = frozenset({
    RunStatus.SUCCEEDED.value,
    RunStatus.FAILED.value,
    RunStatus.CANCELLED.value,
    RunStatus.INTERRUPTED.value,
})

# 仍在推进或已成功的状态：cancel_on_failure 只对这些之外的状态触发取消。
PENDING_OK_STATUSES = frozenset({
    None,
    RunStatus.SUCCEEDED.value,
    RunStatus.QUEUED.value,
    RunStatus.RUNNING.value,
    RunStatus.RETRYING.value,
})


class GroupWaiter:
    """Polls one instance_parallel group until it is finished, cancelled or timed out."""

    def __init__(
        self,
        *,
        lock: Any,
        is_stopping: Callable[[], bool],
        read_run_record: Callable[[str], Any],
        cancel_group_runs: Callable[[_Group], None],
        mark_group_timeout: Callable[[_Group], None],
        finish_group: Callable[[_Group], None],
        check_workers: Callable[[], None],
        poll_interval: float = 0.1,
    ) -> None:
        self._lock = lock
        self._is_stopping = is_stopping
        self.read_run_record = read_run_record
        self.cancel_group_runs = cancel_group_runs
        self.mark_group_timeout = mark_group_timeout
        self.finish_group = finish_group
        self.check_workers = check_workers
        self._poll_interval = poll_interval

    def _locked(self) -> AbstractContextManager[Any]:
        return self._lock if self._lock is not None else nullcontext()

    def wait(self, group: _Group, *, timeout_seconds: float | None) -> None:
        deadline = None if timeout_seconds is None else time.monotonic() + timeout_seconds
        failure_requested = False
        while True:
            with self._locked():
                if group.done.is_set() or self._is_stopping():
                    return
                run_ids = tuple(group.run_ids)
                known_records = set(group.records)
            for run_id in run_ids:
                if run_id in known_records:
                    continue
                record = self.read_run_record(run_id)
                if isinstance(record, dict) and record.get("status") in TERMINAL_STATUSES:
                    with self._locked():
                        group.records.setdefault(run_id, record)
            with self._locked():
                records_count = len(group.records)
                statuses = [record.get("status") for record in group.records.values() if isinstance(record, dict)]
            if group.node.wait_for == "any" and RunStatus.SUCCEEDED.value in statuses:
                if group.node.cancel_on_failure:
                    self.cancel_group_runs(group)
                self.finish_group(group)
                return
            if records_count == len(run_ids):
                if group.node.cancel_on_failure and not failure_requested and any(status != RunStatus.SUCCEEDED.value for status in statuses):
                    failure_requested = True
                self.finish_group(group)
                return
            if group.node.cancel_on_failure and not failure_requested and any(status not in PENDING_OK_STATUSES for status in statuses):
                failure_requested = True
                self.cancel_group_runs(group)
            if deadline is not None and time.monotonic() >= deadline:
                self.mark_group_timeout(group)
                self.finish_group(group)
                return
            self.check_workers()
            time.sleep(self._poll_interval)


__all__ = ["GroupWaiter", "PENDING_OK_STATUSES", "TERMINAL_STATUSES"]
