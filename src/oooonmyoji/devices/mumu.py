#!/usr/bin/env python3
"""通过 external_renderer_ipc.dll 访问 MuMu 12 的高速设备接口。

本模块只负责设备输入输出，识别器和任务状态机可以建立在可复用的
截图缓冲区之上。DLL 会处理 MuMu 的显示旋转，因此坐标使用截图中
可见画面的方向。
"""

from __future__ import annotations

import ctypes
import json
import os
import struct
import subprocess
import time
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .adb import AdbDevice
from ..exceptions import DeviceCaptureError, DeviceConnectionError, DeviceError, DeviceInputError


class MumuDeviceError(DeviceError):
    """无法使用 MuMu 原生设备接口时抛出的异常。"""


def discover_mumu_path() -> Path | None:
    """查找包含原生渲染 DLL 的 MuMu 安装目录。"""

    candidates: list[Path] = []
    for drive in ("C:\\", "D:\\", "E:\\"):
        candidates.extend(
            (
                Path(drive) / "Program Files" / "Netease" / "MuMuPlayer-12.0",
                Path(drive) / "Program Files" / "Netease" / "MuMu Player 12",
                Path(drive) / "Program Files (x86)" / "Netease" / "MuMuPlayer-12.0",
            )
        )
    for candidate in candidates:
        if candidate.is_dir() and find_renderer_dll(candidate, required=False):
            return candidate
    return None


@dataclass(frozen=True)
class MumuPlayerInfo:
    """One Android-ready player reported by MuMuManager."""

    index: int
    name: str | None = None
    adb_serial: str | None = None
    android_version: str | None = None


def find_mumu_manager(mumu_path: Path | str | None = None) -> Path | None:
    resolved = Path(mumu_path) if mumu_path else discover_mumu_path()
    if resolved is None:
        return None
    for relative in (Path("nx_main/MuMuManager.exe"), Path("MuMuManager.exe")):
        candidate = resolved / relative
        if candidate.is_file():
            return candidate.resolve()
    return None


def parse_mumu_manager_info(value: object) -> tuple[MumuPlayerInfo, ...]:
    """Parse MuMuManager ``info --vmindex all`` JSON and keep ready players."""

    if not isinstance(value, dict):
        return ()
    found: dict[int, MumuPlayerInfo] = {}
    for raw in value.values():
        if not isinstance(raw, dict):
            continue
        if raw.get("is_process_started") is not True or raw.get("is_android_started") is not True:
            continue
        index_value = raw.get("index")
        if isinstance(index_value, bool) or not isinstance(index_value, (int, str)):
            continue
        try:
            index = int(index_value)
        except (TypeError, ValueError):
            continue
        if index < 0:
            continue
        name_value = raw.get("name")
        name = name_value.strip() if isinstance(name_value, str) and name_value.strip() else None
        version_value = raw.get("android_version")
        android_version = version_value.strip() if isinstance(version_value, str) and version_value.strip() else None
        host_value = raw.get("adb_host_ip")
        host = host_value.strip() if isinstance(host_value, str) and host_value.strip() else None
        port_value = raw.get("adb_port")
        adb_serial = None
        if host is not None and isinstance(port_value, int) and not isinstance(port_value, bool) and 0 < port_value <= 65535:
            adb_serial = f"{host}:{port_value}"
        found[index] = MumuPlayerInfo(index, name, adb_serial, android_version)
    return tuple(found[index] for index in sorted(found))


def discover_running_mumu_players(
    mumu_path: Path | str | None = None,
    *,
    timeout_seconds: float = 5.0,
) -> tuple[MumuPlayerInfo, ...]:
    """Return Android-ready MuMu players using the bundled manager CLI."""

    manager = find_mumu_manager(mumu_path)
    if manager is None:
        return ()
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    try:
        result = subprocess.run(
            [str(manager), "info", "--vmindex", "all"],
            capture_output=True,
            check=False,
            timeout=timeout_seconds,
            creationflags=creation_flags,
        )
        if result.returncode != 0:
            return ()
        output = result.stdout.decode("utf-8-sig", errors="replace")
        return parse_mumu_manager_info(json.loads(output))
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return ()


def find_renderer_dll(mumu_path: Path, required: bool = True) -> Path | None:
    relative_paths = (
        Path("nx_device/15.0/shell/sdk/external_renderer_ipc.dll"),
        Path("nx_device/12.0/shell/sdk/external_renderer_ipc.dll"),
        Path("shell/sdk/external_renderer_ipc.dll"),
        Path("nx_main/sdk/external_renderer_ipc.dll"),
    )
    for relative_path in relative_paths:
        candidate = mumu_path / relative_path
        if candidate.is_file():
            return candidate
    if required:
        raise MumuDeviceError(f"external_renderer_ipc.dll not found below {mumu_path}")
    return None


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
    )


def write_bgra_png(path: Path, width: int, height: int, pixels: Any) -> None:
    """将 MuMu 原生 RGBA 画面写成完成垂直校正的 PNG 文件。"""

    row_size = width * 4
    raw = bytearray((height * (row_size + 1)))
    output = 0
    for row in range(height - 1, -1, -1):
        raw[output] = 0
        output += 1
        start = row * row_size
        raw[output : output + row_size] = pixels[start : start + row_size]
        output += row_size

    png = bytearray(b"\x89PNG\r\n\x1a\n")
    png.extend(_png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)))
    png.extend(_png_chunk(b"IDAT", zlib.compress(bytes(raw), level=1)))
    png.extend(_png_chunk(b"IEND", b""))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


class Frame:
    """设备可复用 RGBA 截图缓冲区的视图。

    下一次调用 :meth:`MumuDevice.capture` 后，该视图中的内容会被覆盖。
    如果需要保留当前画面，请先复制数据。
    """

    __slots__ = ("width", "height", "pixels")
    format = "rgba"

    def __init__(self, width: int, height: int, pixels: memoryview) -> None:
        self.width = width
        self.height = height
        self.pixels = pixels

    @property
    def byte_count(self) -> int:
        return self.width * self.height * 4


@dataclass(frozen=True)
class CaptureTiming:
    """Optional timing breakdown for one native capture call."""

    dll_call_ms: float
    validation_ms: float
    total_ms: float


class MumuDevice:
    """可复用的 MuMu 原生截图和输入连接。"""

    def __init__(
        self,
        mumu_path: Path | str | None = None,
        instance_index: int = 0,
        package: str | None = None,
        capture_timing: bool = False,
        adb_serial: str | None = None,
        adb_path: Path | str = "adb",
    ) -> None:
        if os.name != "nt":
            raise MumuDeviceError("MuMu native IPC is supported on Windows only")

        resolved_path = Path(mumu_path) if mumu_path else discover_mumu_path()
        if resolved_path is None:
            raise MumuDeviceError("MuMu installation was not found; pass mumu_path")
        self.mumu_path = resolved_path.resolve()
        self.instance_index = instance_index
        self.instance_id = str(instance_index)
        self.package = package
        self.capture_timing = capture_timing
        self.adb_serial = adb_serial
        self.adb_path = adb_path
        self._adb_input: AdbDevice | None = None
        self.last_capture_timing: CaptureTiming | None = None
        dll_path = find_renderer_dll(self.mumu_path)
        if dll_path is None:
            raise MumuDeviceError("external_renderer_ipc.dll was not found")
        self.dll_path = dll_path
        self._dll_dirs: list[Any] = []
        for directory in (
            self.dll_path.parent,
            self.mumu_path / "nx_main",
            self.mumu_path / "nx_device" / "12.0" / "shell",
            self.mumu_path / "nx_device" / "15.0" / "shell",
        ):
            if directory.is_dir() and hasattr(os, "add_dll_directory"):
                self._dll_dirs.append(os.add_dll_directory(str(directory)))

        try:
            self.dll = ctypes.WinDLL(str(self.dll_path))
        except OSError as exc:
            self._close_dll_dirs()
            raise MumuDeviceError(f"failed to load {self.dll_path}: {exc}") from exc

        self._connect = self._function("nemu_connect", ctypes.c_int, [ctypes.c_wchar_p, ctypes.c_int])
        self._disconnect = self._function("nemu_disconnect", None, [ctypes.c_int])
        self._get_display_id = self._function(
            "nemu_get_display_id", ctypes.c_int, [ctypes.c_int, ctypes.c_char_p, ctypes.c_int]
        )
        self._capture_display = self._function(
            "nemu_capture_display",
            ctypes.c_int,
            [
                ctypes.c_int,
                ctypes.c_uint,
                ctypes.c_int,
                ctypes.POINTER(ctypes.c_int),
                ctypes.POINTER(ctypes.c_int),
                ctypes.POINTER(ctypes.c_ubyte),
            ],
        )
        self._touch_down = self._function(
            "nemu_input_event_touch_down",
            ctypes.c_int,
            [ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int],
        )
        self._touch_up = self._function(
            "nemu_input_event_touch_up", ctypes.c_int, [ctypes.c_int, ctypes.c_int]
        )
        self._finger_down = self._function(
            "nemu_input_event_finger_touch_down",
            ctypes.c_int,
            [ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int],
        )
        self._finger_up = self._function(
            "nemu_input_event_finger_touch_up",
            ctypes.c_int,
            [ctypes.c_int, ctypes.c_int, ctypes.c_int],
        )

        self.handle = 0
        self.display_id = 0
        self.width = 0
        self.height = 0
        self._buffer: ctypes.Array[ctypes.c_ubyte] | None = None
        self._buffer_pointer: Any | None = None
        self._buffer_size = 0
        self._frame: Frame | None = None
        self._capture_width: ctypes.c_int | None = None
        self._capture_height: ctypes.c_int | None = None
        self._capture_width_ref: Any | None = None
        self._capture_height_ref: Any | None = None

    def _function(self, name: str, restype: object, argtypes: list[object]):
        try:
            function = getattr(self.dll, name)
        except AttributeError as exc:
            self._close_dll_dirs()
            raise MumuDeviceError(f"{self.dll_path} does not export {name}") from exc
        function.restype = restype
        function.argtypes = argtypes
        return function

    def connect(self) -> "MumuDevice":
        if self.handle:
            return self
        self.handle = int(self._connect(str(self.mumu_path), self.instance_index))
        if not self.handle:
            raise DeviceConnectionError(
                f"nemu_connect failed for path={self.mumu_path}, index={self.instance_index}"
            )

        if self.package:
            package_display = int(
                self._get_display_id(self.handle, self.package.encode("utf-8"), 0)
            )
            if package_display >= 0:
                self.display_id = package_display

        width = ctypes.c_int(0)
        height = ctypes.c_int(0)
        result = self._capture_display(
            self.handle, self.display_id, 0, ctypes.byref(width), ctypes.byref(height), None
        )
        if result != 0 or width.value < 1 or height.value < 1:
            self.close()
            raise DeviceConnectionError(
                f"failed to query display size: result={result}, size={width.value}x{height.value}"
            )
        self.width = width.value
        self.height = height.value
        self._buffer = (ctypes.c_ubyte * (self.width * self.height * 4))()
        self._buffer_pointer = ctypes.cast(self._buffer, ctypes.POINTER(ctypes.c_ubyte))
        self._buffer_size = len(self._buffer)
        self._capture_width = ctypes.c_int(self.width)
        self._capture_height = ctypes.c_int(self.height)
        self._capture_width_ref = ctypes.byref(self._capture_width)
        self._capture_height_ref = ctypes.byref(self._capture_height)
        self._frame = Frame(self.width, self.height, memoryview(self._buffer))
        return self

    def capture(self) -> Frame:
        """将画面捕获到复用缓冲区，并返回零拷贝视图。"""

        if not self.handle or self._buffer is None:
            raise DeviceCaptureError("device is not connected")
        if self._frame is None or self._capture_width is None or self._capture_height is None:
            raise DeviceCaptureError("capture buffers are not initialized")
        buffer_pointer = self._buffer_pointer
        buffer_size = self._buffer_size
        if buffer_pointer is None or buffer_size < 1:
            raise DeviceCaptureError("capture buffer pointer is not initialized")
        self._capture_width.value = self.width
        self._capture_height.value = self.height
        started_ns = time.perf_counter_ns() if self.capture_timing else 0
        result = self._capture_display(
            self.handle,
            self.display_id,
            buffer_size,
            self._capture_width_ref,
            self._capture_height_ref,
            buffer_pointer,
        )
        dll_finished_ns = time.perf_counter_ns() if self.capture_timing else 0
        if result != 0:
            raise DeviceCaptureError(f"capture failed with result={result}")
        if (self._capture_width.value, self._capture_height.value) != (self.width, self.height):
            raise DeviceCaptureError(
                "display size changed to "
                f"{self._capture_width.value}x{self._capture_height.value}; reconnect required"
            )
        if self.capture_timing:
            finished_ns = time.perf_counter_ns()
            self.last_capture_timing = CaptureTiming(
                dll_call_ms=(dll_finished_ns - started_ns) / 1_000_000,
                validation_ms=(finished_ns - dll_finished_ns) / 1_000_000,
                total_ms=(finished_ns - started_ns) / 1_000_000,
            )
        return self._frame

    def tap(
        self,
        x: int,
        y: int,
        hold_ms: int = 0,
        api: str = "finger",
        pointer_id: int = 1,
    ) -> None:
        """使用可见画面坐标发送一次点击。"""

        if not self.handle:
            raise DeviceInputError("device is not connected")
        if not 0 <= x < self.width or not 0 <= y < self.height:
            raise ValueError(f"tap ({x},{y}) is outside {self.width}x{self.height}")
        if hold_ms < 0:
            raise ValueError("hold_ms cannot be negative")
        if api == "basic":
            down_result = int(self._touch_down(self.handle, self.display_id, x, y))
        elif api == "finger":
            down_result = int(self._finger_down(self.handle, self.display_id, pointer_id, x, y))
        else:
            raise ValueError("api must be 'basic' or 'finger'")

        if hold_ms:
            time.sleep(hold_ms / 1000)
        if api == "basic":
            up_result = int(self._touch_up(self.handle, self.display_id))
        else:
            up_result = int(self._finger_up(self.handle, self.display_id, pointer_id))
        if down_result != 0 or up_result != 0:
            raise DeviceInputError(f"tap failed: down={down_result}, up={up_result}")

    def swipe(self, x1: int, y1: int, x2: int, y2: int, duration_ms: int = 300) -> None:
        """Send a swipe when the native SDK exposes a move primitive.

        Older MuMu SDKs do not export touch-move; failing explicitly is safer
        than silently reducing a swipe to a tap.
        """
        raise DeviceInputError("MuMu native backend does not expose swipe input; use the ADB backend")

    def key(self, keycode: str) -> None:
        if not self.adb_serial:
            raise DeviceInputError("MuMu native backend does not expose key input; configure adb_serial for key fallback")
        if self._adb_input is None:
            self._adb_input = AdbDevice(
                self.adb_serial,
                adb_path=self.adb_path,
                instance_id=self.instance_id,
            ).connect()
        self._adb_input.key(keycode)

    def type_text(self, text: str) -> None:
        raise DeviceInputError("MuMu native backend does not expose text input; use the ADB backend")

    def health_check(self) -> bool:
        """Return whether the native connection still has a live handle."""

        return bool(self.handle)

    def capture_png(self, path: Path | str) -> Frame:
        frame = self.capture()
        write_bgra_png(Path(path), frame.width, frame.height, frame.pixels)
        return frame

    def close(self) -> None:
        if self._adb_input is not None:
            self._adb_input.close()
            self._adb_input = None
        handle, self.handle = self.handle, 0
        if handle:
            try:
                self._disconnect(handle)
            except OSError:
                # 模拟器可能已退出导致句柄失效；资源清理必须继续
                pass
        self._buffer = None
        self._buffer_pointer = None
        self._buffer_size = 0
        self._frame = None
        self._capture_width = None
        self._capture_height = None
        self._capture_width_ref = None
        self._capture_height_ref = None
        self.last_capture_timing = None
        self._close_dll_dirs()

    def _close_dll_dirs(self) -> None:
        for directory in self._dll_dirs:
            directory.close()
        self._dll_dirs.clear()

    def __enter__(self) -> "MumuDevice":
        return self.connect()

    def __exit__(self, *_: object) -> None:
        self.close()


__all__ = [
    "Frame",
    "CaptureTiming",
    "MumuDevice",
    "MumuDeviceError",
    "MumuPlayerInfo",
    "discover_mumu_path",
    "discover_running_mumu_players",
    "find_mumu_manager",
    "find_renderer_dll",
    "parse_mumu_manager_info",
    "write_bgra_png",
]
