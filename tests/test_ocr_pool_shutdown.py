from __future__ import annotations

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
