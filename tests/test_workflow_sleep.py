"""Deadline crossings during polling must not crash a running workflow."""

from src.oooonmyoji.workflows.engine import WorkflowEngine


def test_poll_sleep_deadline_passes_between_check_and_sleep(monkeypatch):
    engine = WorkflowEngine.__new__(WorkflowEngine)
    ticks = iter([0.0, 0.099, 0.101])
    engine._clock = lambda: next(ticks)
    engine._ensure_running = lambda deadline, branch_cancel: None
    sleeps = []

    def sleep(seconds):
        assert seconds >= 0, "sleep length must be non-negative"
        sleeps.append(seconds)

    monkeypatch.setattr('src.oooonmyoji.workflows.engine.time.sleep', sleep)
    engine._sleep(0.1, 10.0, None)
    assert sleeps == []
