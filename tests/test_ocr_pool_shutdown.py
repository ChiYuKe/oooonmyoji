from __future__ import annotations

import queue
from types import SimpleNamespace

from src.oooonmyoji.runtime.supervisor import Supervisor
from src.oooonmyoji.vision.ocr import SharedOcrPool


class FakeProcess:
    def __init__(self) -> None:
        self.alive = True
        self.killed = False

    def join(self, timeout=None) -> None:
        return None

    def is_alive(self) -> bool:
        return self.alive

    def kill(self) -> None:
        self.killed = True
        self.alive = False


class FakePool:
    def __init__(self, process: FakeProcess) -> None:
        self._pool = [process]
        self.terminated = False
        self.joined = False

    def terminate(self) -> None:
        self.terminated = True

    def join(self) -> None:
        self.joined = True


def test_force_shutdown_kills_stuck_ocr_worker() -> None:
    process = FakeProcess()
    pool = FakePool(process)
    SharedOcrPool._terminate_pool(pool)  # type: ignore[arg-type]
    assert pool.terminated is True
    assert process.killed is True
    assert pool.joined is True


def test_supervisor_starts_ocr_pool_only_when_requested(tmp_path, monkeypatch) -> None:
    created = []

    class FakeOcrPool:
        def __init__(self, **options) -> None:
            created.append(options)

        def recognize(self, image):
            return [f"recognized:{image}"]

    config = SimpleNamespace(
        log_dir=tmp_path,
        ocr=SimpleNamespace(
            enabled=True,
            language="ch",
            workers=1,
            request_timeout_seconds=60,
            min_confidence=0.6,
            use_gpu=False,
        ),
    )
    supervisor = Supervisor(config)  # type: ignore[arg-type]
    responses = queue.Queue()
    supervisor.workers["mumu-1"] = SimpleNamespace(response_queue=responses)  # type: ignore[assignment]
    monkeypatch.setattr("src.oooonmyoji.runtime.supervisor.SharedOcrPool", FakeOcrPool)

    assert created == []
    supervisor._handle_ocr({"id": "request-1", "instance_id": "mumu-1", "image": "frame"})

    assert len(created) == 1
    assert responses.get_nowait() == {"id": "request-1", "results": ["recognized:frame"]}
