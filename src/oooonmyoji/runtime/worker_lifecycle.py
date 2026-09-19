"""实例工作进程的启动、崩溃隔离与重启。

Supervisor 保留协调（什么时候启动、什么时候巡检），进程的创建参数与
崩溃后把在途 run 标记为中断的细节放在这里，可脱离真实进程单独测试。
"""

from __future__ import annotations

import json
import multiprocessing as mp
import threading
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Callable

from ..config.model import InstanceConfig
from .records import AtomicJsonStore, RunStatus
from .worker import _Worker, _instance_worker

if TYPE_CHECKING:  # pragma: no cover - 只为类型标注
    from ..config.model import AppConfig
    from .logging import EventLogger


class WorkerLifecycle:
    """Owns worker processes for one supervisor: spawn, crash isolation, restart."""

    def __init__(
        self,
        *,
        config: AppConfig,
        logger: EventLogger,
        workers: dict[str, _Worker],
        runs: dict[str, str],
        lock: threading.RLock,
        event_queue: Callable[[], Any | None],
        context_factory: Callable[[], Any] | None = None,
    ) -> None:
        self.config = config
        self.logger = logger
        # workers/runs 与 Supervisor 共用同一份字典，双方的增删互相可见。
        self.workers = workers
        self.runs = runs
        self._lock = lock
        self._event_queue = event_queue
        # 重启时另起一个 spawn 上下文；测试可注入假上下文替代真实进程。
        self._context_factory = context_factory or (lambda: mp.get_context("spawn"))

    def spawn(self, context: Any, instance: InstanceConfig) -> _Worker:
        """按配置起一个 spawn 工作进程并登记（调用方负责持有锁）。"""

        command_queue = context.Queue(maxsize=1)
        control_queue = context.Queue()
        response_queue = context.Queue()
        process = context.Process(
            target=_instance_worker,
            args=(str(self.config.config_path), instance, command_queue, control_queue, self._event_queue(), response_queue),
            name=f"oooonmyoji-instance-{instance.id}",
        )
        process.start()
        worker = _Worker(instance, process, command_queue, response_queue, control_queue)
        self.workers[instance.id] = worker
        self.logger.emit("worker.started", instance_id=instance.id, pid=process.pid)
        return worker

    def restart_crashed(self) -> None:
        """Isolate a crashed instance and restart its worker process."""

        with self._lock:
            workers = list(self.workers.items())
        for instance_id, worker in workers:
            if worker.process.is_alive():
                continue
            self.logger.emit("worker.crashed", level=40, instance_id=instance_id, exitcode=worker.process.exitcode)
            with self._lock:
                active_runs = list(self.runs.items())
            self._isolate_runs(instance_id, active_runs)
            worker.process.join(timeout=0)
            with self._lock:
                # Another caller may have already isolated and restarted this
                # worker while we were writing interruption metadata.
                current = self.workers.get(instance_id)
                if current is not worker:
                    continue
                del self.workers[instance_id]
                restarted = self.spawn(self._context_factory(), worker.instance)
            self.logger.emit("worker.restarted", instance_id=instance_id, pid=restarted.process.pid)

    def _isolate_runs(self, instance_id: str, active_runs: list[tuple[str, str]]) -> None:
        """把崩溃进程名下的在途 run 记录改写为 interrupted，并回报给事件队列。"""

        for run_id, run_instance in active_runs:
            if run_instance != instance_id:
                continue
            store = AtomicJsonStore(self.config.artifact_dir / "runs" / f"{run_id}.json")
            record = store.read(default={})
            if not isinstance(record, dict):
                record = {}
            if record.get("status") in {
                RunStatus.QUEUED.value,
                RunStatus.RUNNING.value,
                RunStatus.RETRYING.value,
            } or not record:
                record.setdefault("run_id", run_id)
                record.setdefault("instance_id", instance_id)
                record["status"] = RunStatus.INTERRUPTED.value
                record["finished_at"] = datetime.now(timezone.utc).isoformat()
                record["error"] = "instance worker exited unexpectedly"
                record["error_category"] = "internal"
                artifacts = record.setdefault("artifacts", [])
                if self.config.save_screenshots:
                    last_frame = self.config.artifact_dir / run_id / "last-frame.png"
                    if last_frame.is_file() and str(last_frame) not in artifacts:
                        artifacts.append(str(last_frame))
                interrupted_metadata = self.config.artifact_dir / run_id / "interrupted.json"
                interrupted_metadata.parent.mkdir(parents=True, exist_ok=True)
                interrupted_metadata.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                if str(interrupted_metadata) not in artifacts:
                    artifacts.append(str(interrupted_metadata))
                store.write(record)
                event_queue = self._event_queue()
                if event_queue is not None:
                    event_queue.put({"type": "result", "run_id": run_id, "status": RunStatus.INTERRUPTED.value, "record": record})


__all__ = ["WorkerLifecycle"]
