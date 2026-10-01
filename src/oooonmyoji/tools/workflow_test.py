"""JSON line subprocess endpoint for the desktop workflow testing window."""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time

from ..config import load_config
from ..runtime.testing import TestDebugger, WorkflowTestSession


def command_lines():
    """Read the pipe without holding Windows' CRT stdin lock during DLL loads."""
    descriptor = sys.stdin.fileno()
    pending = b""
    if os.name == "nt":
        import ctypes
        import msvcrt
        from ctypes import wintypes

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        peek = kernel.PeekNamedPipe
        peek.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD, ctypes.c_void_p, ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
        peek.restype = wintypes.BOOL
        handle = msvcrt.get_osfhandle(descriptor)

        def available():
            count = wintypes.DWORD()
            if not peek(handle, None, 0, None, ctypes.byref(count), None):
                code = ctypes.get_last_error()
                if code in {109, 232}:  # Pipe closed by the desktop host.
                    return -1
                raise OSError(code, "unable to read test command pipe")
            return count.value
    else:
        import select

        def available():
            return 65536 if select.select([descriptor], [], [], 0.03)[0] else 0

    while True:
        count = available()
        if count < 0:
            return
        if not count:
            time.sleep(0.03)
            continue
        chunk = os.read(descriptor, min(count, 65536))
        if not chunk:
            return
        pending += chunk
        while b"\n" in pending:
            line, pending = pending.split(b"\n", 1)
            yield line.decode("utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    protocol_output = sys.stdout
    sys.stdout = sys.stderr  # OCR/plugin prints must not corrupt the JSON protocol.
    output_lock = threading.Lock()
    cancel = threading.Event()

    def emit(event: dict) -> None:
        with output_lock:
            protocol_output.write(json.dumps(event, ensure_ascii=False) + "\n")
            protocol_output.flush()

    lines = command_lines()
    request = json.loads(next(lines))
    debugger = TestDebugger(cancel, emit, single_step=request.get("singleStep", False), breakpoints=request.get("breakpoints", []))

    def commands() -> None:
        for line in lines:
            try:
                command = json.loads(line).get("command")
                if command == "pause" and not getattr(debugger, "allow_pause", True):
                    emit({"type": "notice", "message": "并行测试只支持停止；请单独选择一个分支进行单步测试"})
                    continue
                debugger.command(command)
            except (ValueError, AttributeError):
                continue
        debugger.command("stop")

    try:
        threading.Thread(target=commands, daemon=True).start()
        WorkflowTestSession(load_config(args.config), request, emit, cancel=cancel, debugger=debugger).run()
    except Exception as exc:
        emit({"type": "error", "message": str(exc)})
        emit({"type": "finished", "error": str(exc)})


if __name__ == "__main__":
    main()
