"""跨实例信号动作：写信号文件 / 等信号文件。

信号是**提示**，不是事实来源：对方收到信号后仍要回到屏幕检测去验证（模板匹配），
超时后工作流自行回退到全量轮询。两实例跑在同一台机器上，共享同一份配置的
``artifact_dir / "signals"`` 目录；实例 id 用来给信号文件分区。
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import time
from pathlib import Path
from typing import Any

from ..base import Action, ActionResult

#: 信号名 / 实例 id 只允许安全字符，防止把路径写成别的目录。
_SAFE_NAME = re.compile(r"^[A-Za-z0-9_.-]+$")

#: 信号文件的默认新鲜度上限：超过该秒数的旧信号按不存在处理并删除，
#: 防止崩溃重启后残留的上一轮信号误触发。
DEFAULT_MAX_AGE_SECONDS = 300.0


def _signal_path(signals_dir: Path, signal: str, instance_id: str) -> Path:
    """把信号名与实例 id 折叠成信号文件路径；非法名字直接抛 ValueError。"""
    if not _SAFE_NAME.match(signal) or not _SAFE_NAME.match(instance_id):
        raise ValueError(f"invalid signal or instance id: {signal!r} / {instance_id!r}")
    return Path(signals_dir) / signal / f"{instance_id}.json"


def _write_json(path: Path, value: dict[str, Any]) -> None:
    """原子写 JSON：先写临时文件再 os.replace，避免读者读到半截内容。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, ensure_ascii=False, sort_keys=True)
            stream.write("\n")
        os.replace(temporary_name, path)
    finally:
        try:
            Path(temporary_name).unlink(missing_ok=True)
        except OSError:
            pass


class EmitSignalAction(Action):
    name = "instance.emit_signal"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        signal = str(arguments["signal"])
        target = str(arguments["target_instance"])
        source = str(getattr(context, "instance_id", "") or "")
        signals_dir = getattr(context, "signals_dir", None)
        payload = dict(arguments.get("payload") or {})
        if signals_dir is None:
            context.log(f"instance.emit_signal: signals directory not configured; signal {signal} -> {target} skipped")
            return ActionResult.succeeded(
                {"signal": signal, "target_instance": target, "source_instance": source, "emitted": False, "path": None}
            )
        try:
            path = _signal_path(signals_dir, signal, target)
        except ValueError as exc:
            return ActionResult.failed(str(exc), category="workflow")
        try:
            _write_json(
                path,
                {
                    "signal": signal,
                    "source_instance": source,
                    "target_instance": target,
                    "emitted_at": time.time(),
                    "payload": payload,
                },
            )
        except Exception as exc:  # noqa: BLE001 - 信号只是提示，写失败不应让工作流中断
            context.log(f"instance.emit_signal: failed to write signal {signal} -> {target}: {exc}")
            return ActionResult.succeeded(
                {"signal": signal, "target_instance": target, "source_instance": source, "emitted": False, "path": None}
            )
        return ActionResult.succeeded(
            {"signal": signal, "target_instance": target, "source_instance": source, "emitted": True, "path": str(path)}
        )


class WaitSignalAction(Action):
    name = "instance.wait_signal"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        signal = str(arguments["signal"])
        own = str(getattr(context, "instance_id", "") or "")
        signals_dir = getattr(context, "signals_dir", None)
        timeout_seconds = float(arguments.get("timeout_seconds", 60))
        poll_interval = float(arguments.get("poll_interval", 0.2))
        max_age_seconds = float(arguments.get("max_age_seconds", DEFAULT_MAX_AGE_SECONDS))
        if signals_dir is None:
            # 没配信号目录时按「收不到」处理，让调用方回退到屏幕轮询。
            return ActionResult.failed("signals directory not configured", category="timeout")
        try:
            path = _signal_path(signals_dir, signal, own)
        except ValueError as exc:
            return ActionResult.failed(str(exc), category="workflow")

        deadline = time.monotonic() + timeout_seconds
        while True:
            context.check_cancelled()
            if path.is_file():
                try:
                    value = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    value = None
                if isinstance(value, dict):
                    emitted_at = value.get("emitted_at")
                    if isinstance(emitted_at, (int, float)) and time.time() - float(emitted_at) > max_age_seconds:
                        # 过期残留：删掉继续等，当作没收到。
                        try:
                            path.unlink(missing_ok=True)
                        except OSError:
                            pass
                    else:
                        # 消费：删除信号文件，下一轮需要队长重新发出，避免旧信号二次触发。
                        try:
                            path.unlink(missing_ok=True)
                        except OSError:
                            pass
                        return ActionResult.succeeded(
                            {
                                "received": True,
                                "signal": signal,
                                "source_instance": value.get("source_instance", ""),
                                "emitted_at": emitted_at,
                                "payload": value.get("payload", {}),
                            }
                        )
            if time.monotonic() >= deadline:
                return ActionResult.failed(
                    f"signal {signal!r} not received within {timeout_seconds}s", category="timeout"
                )
            time.sleep(min(poll_interval, max(0.05, deadline - time.monotonic())))


__all__ = ["DEFAULT_MAX_AGE_SECONDS", "EmitSignalAction", "WaitSignalAction"]
