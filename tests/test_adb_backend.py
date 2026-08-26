from __future__ import annotations

import struct
import subprocess
from pathlib import Path

from src.oooonmyoji.devices.adb import AdbDevice


def _png_header(width: int, height: int) -> bytes:
    return b"\x89PNG\r\n\x1a\n" + b"\0\0\0\rIHDR" + struct.pack(">II", width, height) + b"\x08\x06\0\0\0"


def test_adb_uses_visible_png_dimensions_over_portrait_wm_size(monkeypatch) -> None:
    calls: list[list[str]] = []
    screenshot = _png_header(1920, 1080)

    def fake_run(command, **kwargs):
        calls.append(command)
        if command[-1] == "get-state":
            return subprocess.CompletedProcess(command, 0, stdout="device", stderr="")
        if command[-2:] == ["wm", "size"]:
            return subprocess.CompletedProcess(command, 0, stdout="Physical size: 1080x1920\n", stderr="")
        return subprocess.CompletedProcess(command, 0, stdout=screenshot, stderr=b"")

    monkeypatch.setattr(subprocess, "run", fake_run)
    device = AdbDevice("127.0.0.1:16384", adb_path=Path("C:/MuMu/shell/adb.exe"))
    device.connect()
    assert (device.width, device.height) == (1920, 1080)
    frame = device.capture()
    assert (frame.width, frame.height) == (1920, 1080)
    assert calls[0][0].replace("\\", "/") == "C:/MuMu/shell/adb.exe"
    assert calls[0][1:] == ["-s", "127.0.0.1:16384", "get-state"]
