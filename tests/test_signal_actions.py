from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import pytest

from src.oooonmyoji.actions.base import ActionStatus
from src.oooonmyoji.actions.builtin import EmitSignalAction, WaitSignalAction


class SignalContext:
    """极简假上下文：只暴露信号动作需要的属性。"""

    def __init__(self, signals_dir: Path | None, instance_id: str = "mumu-1") -> None:
        self.signals_dir = signals_dir
        self.instance_id = instance_id
        self.logs: list[str] = []

    def check_cancelled(self) -> None:
        return

    def log(self, message: str, **_fields: Any) -> None:
        self.logs.append(message)


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def test_emit_writes_signal_file_for_target(tmp_path: Path) -> None:
    context = SignalContext(tmp_path / "signals")
    result = EmitSignalAction().execute(context, {
        "signal": "invite_expected",
        "target_instance": "mumu-1",
        "payload": {"round": 3},
    })

    assert result.status == ActionStatus.SUCCEEDED
    assert result.output["emitted"] is True
    assert result.output["signal"] == "invite_expected"
    assert result.output["target_instance"] == "mumu-1"
    assert result.output["source_instance"] == "mumu-1"
    assert result.output["path"] == str(tmp_path / "signals" / "invite_expected" / "mumu-1.json")

    stored = _read_json(tmp_path / "signals" / "invite_expected" / "mumu-1.json")
    assert stored["signal"] == "invite_expected"
    assert stored["source_instance"] == "mumu-1"
    assert stored["target_instance"] == "mumu-1"
    assert stored["payload"] == {"round": 3}
    assert isinstance(stored["emitted_at"], (int, float))


def test_emit_writes_separate_files_per_target(tmp_path: Path) -> None:
    context = SignalContext(tmp_path / "signals")
    EmitSignalAction().execute(context, {"signal": "invite_expected", "target_instance": "mumu-1"})
    EmitSignalAction().execute(context, {"signal": "invite_expected", "target_instance": "mumu-2"})

    assert (tmp_path / "signals" / "invite_expected" / "mumu-1.json").is_file()
    assert (tmp_path / "signals" / "invite_expected" / "mumu-2.json").is_file()


def test_emit_overwrites_previous_signal(tmp_path: Path) -> None:
    context = SignalContext(tmp_path / "signals")
    EmitSignalAction().execute(context, {"signal": "invite_expected", "target_instance": "mumu-1", "payload": {"round": 1}})
    EmitSignalAction().execute(context, {"signal": "invite_expected", "target_instance": "mumu-1", "payload": {"round": 2}})

    stored = _read_json(tmp_path / "signals" / "invite_expected" / "mumu-1.json")
    assert stored["payload"] == {"round": 2}


def test_emit_is_noop_when_signals_dir_unconfigured(tmp_path: Path) -> None:
    context = SignalContext(signals_dir=None)
    result = EmitSignalAction().execute(context, {"signal": "invite_expected", "target_instance": "mumu-1"})

    assert result.status == ActionStatus.SUCCEEDED
    assert result.output["emitted"] is False
    assert result.output["path"] is None
    assert not (tmp_path / "signals").exists()


def test_wait_receives_signal_and_consumes_file(tmp_path: Path) -> None:
    context = SignalContext(tmp_path / "signals")
    EmitSignalAction().execute(context, {"signal": "invite_expected", "target_instance": "mumu-1", "payload": {"round": 1}})

    result = WaitSignalAction().execute(context, {"signal": "invite_expected", "timeout_seconds": 5})

    assert result.status == ActionStatus.SUCCEEDED
    assert result.output["received"] is True
    assert result.output["signal"] == "invite_expected"
    assert result.output["source_instance"] == "mumu-1"
    assert result.output["payload"] == {"round": 1}
    # 消费语义：收到后信号文件被删除，下一轮需要队长重新发出。
    assert not (tmp_path / "signals" / "invite_expected" / "mumu-1.json").exists()


def test_wait_ignores_signals_addressed_to_other_instances(tmp_path: Path) -> None:
    context = SignalContext(tmp_path / "signals", instance_id="mumu-1")
    EmitSignalAction().execute(context, {"signal": "invite_expected", "target_instance": "mumu-2"})

    result = WaitSignalAction().execute(context, {"signal": "invite_expected", "timeout_seconds": 0.2, "poll_interval": 0.05})

    assert result.status == ActionStatus.FAILED
    assert result.error_category == "timeout"
    assert (tmp_path / "signals" / "invite_expected" / "mumu-2.json").is_file()


def test_wait_times_out_and_falls_back_to_polling(tmp_path: Path) -> None:
    context = SignalContext(tmp_path / "signals")
    start = time.monotonic()
    result = WaitSignalAction().execute(context, {"signal": "invite_expected", "timeout_seconds": 0.3, "poll_interval": 0.05})
    elapsed = time.monotonic() - start

    assert result.status == ActionStatus.FAILED
    assert result.error_category == "timeout"
    assert 0.25 <= elapsed < 2.0


def test_wait_fails_fast_when_signals_dir_unconfigured(tmp_path: Path) -> None:
    context = SignalContext(signals_dir=None)
    result = WaitSignalAction().execute(context, {"signal": "invite_expected", "timeout_seconds": 5})

    assert result.status == ActionStatus.FAILED
    assert result.error_category == "timeout"


def test_wait_deletes_stale_signal_and_keeps_waiting(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    context = SignalContext(tmp_path / "signals")
    signal_path = tmp_path / "signals" / "invite_expected" / "mumu-1.json"
    signal_path.parent.mkdir(parents=True)
    signal_path.write_text(json.dumps({
        "signal": "invite_expected",
        "source_instance": "mumu-0",
        "target_instance": "mumu-1",
        "emitted_at": time.time() - 100_000,  # 远早于默认 max_age 300 秒
        "payload": {},
    }, ensure_ascii=False), encoding="utf-8")

    result = WaitSignalAction().execute(context, {"signal": "invite_expected", "timeout_seconds": 0.3, "poll_interval": 0.05})

    assert result.status == ActionStatus.FAILED
    assert result.error_category == "timeout"
    # 过期残留被当作不存在：删除后继续等，而不是触发。
    assert not signal_path.exists()


def test_wait_rejects_unsafe_signal_names(tmp_path: Path) -> None:
    context = SignalContext(tmp_path / "signals")
    result = WaitSignalAction().execute(context, {"signal": "../escape", "timeout_seconds": 1})

    assert result.status == ActionStatus.FAILED
    assert result.error_category == "workflow"


def test_emit_rejects_unsafe_target_instance(tmp_path: Path) -> None:
    context = SignalContext(tmp_path / "signals")
    result = EmitSignalAction().execute(context, {"signal": "invite_expected", "target_instance": "../evil"})

    assert result.status == ActionStatus.FAILED
    assert result.error_category == "workflow"


def test_emit_failure_is_best_effort_noop(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """写失败不应让工作流中断：信号只是提示。"""
    context = SignalContext(tmp_path / "signals")
    monkeypatch.setattr("src.oooonmyoji.actions.builtin.signal._write_json", lambda _path, _value: (_ for _ in ()).throw(OSError("disk full")))

    result = EmitSignalAction().execute(context, {"signal": "invite_expected", "target_instance": "mumu-1"})

    assert result.status == ActionStatus.SUCCEEDED
    assert result.output["emitted"] is False
