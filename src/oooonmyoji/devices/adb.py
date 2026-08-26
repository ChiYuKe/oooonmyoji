"""Explicit ADB device backend used as a configured fallback."""

from __future__ import annotations

import re
import struct
import subprocess
from pathlib import Path

from ..exceptions import DeviceCaptureError, DeviceConnectionError, DeviceInputError
from .protocol import DeviceFrame


class AdbDevice:
    def __init__(
        self,
        serial: str,
        adb_path: str | Path = "adb",
        *,
        command_timeout: float = 10.0,
        instance_id: str | None = None,
    ) -> None:
        if not serial or not isinstance(serial, str):
            raise ValueError("ADB serial must be a non-empty string")
        self.serial = serial
        self.adb_path = str(adb_path)
        self.command_timeout = command_timeout
        self.instance_id = instance_id or serial
        self.width = 0
        self.height = 0
        self.connected = False

    def _run(self, *arguments: str, timeout: float | None = None, text: bool = True) -> subprocess.CompletedProcess:
        try:
            return subprocess.run(
                [self.adb_path, "-s", self.serial, *arguments],
                check=False,
                capture_output=True,
                timeout=timeout or self.command_timeout,
                text=text,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise DeviceConnectionError(f"ADB command failed: {exc}", cause=exc) from exc

    def connect(self) -> "AdbDevice":
        result = self._run("get-state")
        if result.returncode != 0 or result.stdout.strip() != "device":
            message = (result.stderr or result.stdout).strip() or "device is not online"
            raise DeviceConnectionError(f"ADB {self.serial} is unavailable: {message}")
        self.connected = True
        self._read_resolution()
        try:
            screenshot = self._screencap()
            self.width, self.height = self._png_dimensions(screenshot)
        except (DeviceCaptureError, ValueError) as exc:
            self.connected = False
            raise DeviceConnectionError(f"unable to determine visible ADB display size: {exc}", cause=exc) from exc
        return self

    def _read_resolution(self) -> None:
        result = self._run("shell", "wm", "size")
        match = re.search(r"Physical size:\s*(\d+)x(\d+)|Override size:\s*(\d+)x(\d+)", result.stdout)
        if result.returncode != 0 or match is None:
            raise DeviceConnectionError(f"unable to read ADB display size: {result.stdout.strip()}")
        groups = match.groups()
        self.width, self.height = int(groups[0] or groups[2]), int(groups[1] or groups[3])

    def capture(self) -> DeviceFrame:
        if not self.connected:
            raise DeviceCaptureError("ADB device is not connected")
        payload = self._screencap()
        width, height = self._png_dimensions(payload)
        if (width, height) != (self.width, self.height):
            self.width, self.height = width, height
        return DeviceFrame(width, height, payload, format="png")

    def _screencap(self) -> bytes:
        result = self._run("exec-out", "screencap", "-p", text=False)
        if result.returncode != 0 or not result.stdout:
            stderr = result.stderr if isinstance(result.stderr, bytes) else str(result.stderr)
            raise DeviceCaptureError(stderr.decode(errors="replace") if isinstance(stderr, bytes) else stderr or "ADB screencap failed")
        if not isinstance(result.stdout, bytes):
            raise DeviceCaptureError("ADB screencap did not return bytes")
        return result.stdout

    @staticmethod
    def _png_dimensions(payload: bytes) -> tuple[int, int]:
        if len(payload) < 24 or payload[:8] != b"\x89PNG\r\n\x1a\n" or payload[12:16] != b"IHDR":
            raise ValueError("ADB screencap is not a PNG with an IHDR header")
        width, height = struct.unpack(">II", payload[16:24])
        if width < 1 or height < 1:
            raise ValueError(f"invalid PNG dimensions: {width}x{height}")
        return width, height

    def tap(self, x: int, y: int, hold_ms: int = 0, **_: object) -> None:
        if not self.connected:
            raise DeviceInputError("ADB device is not connected")
        if not 0 <= x < self.width or not 0 <= y < self.height:
            raise ValueError(f"tap ({x},{y}) is outside {self.width}x{self.height}")
        arguments = ["shell", "input", "tap", str(x), str(y)]
        if hold_ms:
            arguments = ["shell", "input", "swipe", str(x), str(y), str(x), str(y), str(hold_ms)]
        result = self._run(*arguments)
        if result.returncode != 0:
            raise DeviceInputError((result.stderr or result.stdout).strip())

    def health_check(self) -> bool:
        if not self.connected:
            return False
        result = self._run("get-state")
        return result.returncode == 0 and result.stdout.strip() == "device"

    def close(self) -> None:
        self.connected = False

    def __enter__(self) -> "AdbDevice":
        return self.connect()

    def __exit__(self, *_: object) -> None:
        self.close()


__all__ = ["AdbDevice"]
