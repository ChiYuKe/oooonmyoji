"""WorkerLifecycle 独立测试：崩溃隔离、在途 run 标记与重启只影响出事的实例。"""

from __future__ import annotations

import json
import threading
from types import SimpleNamespace

from src.oooonmyoji.runtime.worker import _Worker
from src.oooonmyoji.runtime.worker_lifecycle import WorkerLifecycle


class FakeProcess:
    def __init__(self, *, alive: bool, pid: int) -> None:
        self.alive = alive
        self.pid = pid
        self.exitcode = 1 if not alive else None
        self.started = False
        self.joined: list[float | None] = []

    def is_alive(self) -> bool:
        return self.alive

    def start(self) -> None:
        self.started = True
        self.alive = True

    def join(self, timeout=None) -> None:
        self.joined.append(timeout)


class FakeContext:
    """替代 mp.get_context("spawn")：记录新建的进程，不真的 spawn。"""

    def __init__(self) -> None:
        self.processes: list[FakeProcess] = []
        self.spawned_args: list[tuple] = []
        self.spawned_names: list[str] = []

    def Queue(self, maxsize: int | None = None) -> SimpleNamespace:  # noqa: N802 - 对齐 multiprocessing 接口
        return SimpleNamespace(maxsize=maxsize)

    def Process(self, *, target, args, name) -> FakeProcess:  # noqa: N802 - 对齐 multiprocessing 接口
        assert target.__name__ == "_instance_worker"
        process = FakeProcess(alive=False, pid=9000 + len(self.processes))
        self.processes.append(process)
        self.spawned_args.append(args)
        self.spawned_names.append(name)
        return process


class FakeLogger:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict]] = []

    def emit(self, event: str, **fields) -> None:
        self.events.append((event, fields))


class FakeQueue:
    def __init__(self) -> None:
        self.items: list[dict] = []

    def put(self, item: dict) -> None:
        self.items.append(item)


def make_lifecycle(tmp_path, *, workers, runs, context):
    config = SimpleNamespace(
        artifact_dir=tmp_path,
        config_path=tmp_path / "config.json",
        save_screenshots=False,
    )
    logger = FakeLogger()
    queue = FakeQueue()
    lifecycle = WorkerLifecycle(
        config=config,  # type: ignore[arg-type]
        logger=logger,  # type: ignore[arg-type]
        workers=workers,
        runs=runs,
        lock=threading.RLock(),
        event_queue=lambda: queue,
        context_factory=lambda: context,
    )
    return lifecycle, logger, queue


def test_restart_isolates_crashed_worker_runs_and_marks_interrupted(tmp_path) -> None:
    crashed = FakeProcess(alive=False, pid=100)
    healthy = FakeProcess(alive=True, pid=200)
    instance = SimpleNamespace(id="mumu-1")
    workers = {
        "mumu-1": _Worker(instance, crashed, SimpleNamespace(), SimpleNamespace(), SimpleNamespace()),
        "mumu-2": _Worker(SimpleNamespace(id="mumu-2"), healthy, SimpleNamespace(), SimpleNamespace(), SimpleNamespace()),
    }
    runs = {"run-1": "mumu-1", "run-2": "mumu-2"}
    context = FakeContext()
    lifecycle, logger, queue = make_lifecycle(tmp_path, workers=workers, runs=runs, context=context)

    lifecycle.restart_crashed()

    # 崩溃实例被替换成新进程，健康实例原样保留。
    assert workers["mumu-1"].process is context.processes[0]
    assert context.processes[0].started is True
    assert workers["mumu-2"].process is healthy
    assert crashed.joined == [0]
    assert [event for event, _ in logger.events] == ["worker.crashed", "worker.started", "worker.restarted"]

    # 在途 run 落盘为 interrupted，并写入独立的中断元数据。
    record = json.loads((tmp_path / "runs" / "run-1.json").read_text(encoding="utf-8"))
    assert record["status"] == "interrupted"
    assert record["instance_id"] == "mumu-1"
    assert record["error"] == "instance worker exited unexpectedly"
    assert record["error_category"] == "internal"
    assert str(tmp_path / "run-1" / "interrupted.json") in record["artifacts"]
    assert (tmp_path / "run-1" / "interrupted.json").is_file()

    # 事件队列收到中断结果；健康实例的 run 不被触碰。
    assert queue.items[0]["type"] == "result"
    assert queue.items[0]["run_id"] == "run-1"
    assert queue.items[0]["status"] == "interrupted"
    assert not (tmp_path / "runs" / "run-2.json").exists()


def test_restart_skips_workers_that_are_still_alive(tmp_path) -> None:
    alive = FakeProcess(alive=True, pid=100)
    instance = SimpleNamespace(id="mumu-1")
    workers = {"mumu-1": _Worker(instance, alive, SimpleNamespace(), SimpleNamespace(), SimpleNamespace())}
    context = FakeContext()
    lifecycle, logger, _ = make_lifecycle(tmp_path, workers=workers, runs={}, context=context)

    lifecycle.restart_crashed()

    assert context.processes == []
    assert workers["mumu-1"].process is alive
    assert logger.events == []
