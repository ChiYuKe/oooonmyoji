#!/usr/bin/env python3
"""通过 external_renderer_ipc.dll 访问 MuMu 12 的高速设备接口。

本模块只负责设备输入输出，识别器和任务状态机可以建立在可复用的
截图缓冲区之上。DLL 会处理 MuMu 的显示旋转，因此坐标使用截图中
可见画面的方向。
"""

from __future__ import annotations

import ctypes
import os
import struct
import time
import zlib
from pathlib import Path


class MumuDeviceError(RuntimeError):
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


def write_bgra_png(path: Path, width: int, height: int, pixels: object) -> None:
    """将原生 BGRA 画面写成完成垂直校正的 PNG 文件。"""

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
    """设备可复用 BGRA 截图缓冲区的视图。

    下一次调用 :meth:`MumuDevice.capture` 后，该视图中的内容会被覆盖。
    如果需要保留当前画面，请先复制数据。
    """

    __slots__ = ("width", "height", "pixels")

    def __init__(self, width: int, height: int, pixels: memoryview) -> None:
        self.width = width
        self.height = height
        self.pixels = pixels

    @property
    def byte_count(self) -> int:
        return self.width * self.height * 4


class MumuDevice:
    """可复用的 MuMu 原生截图和输入连接。"""

    def __init__(
        self,
        mumu_path: Path | str | None = None,
        instance_index: int = 0,
        package: str | None = None,
    ) -> None:
        if os.name != "nt":
            raise MumuDeviceError("MuMu native IPC is supported on Windows only")

        resolved_path = Path(mumu_path) if mumu_path else discover_mumu_path()
        if resolved_path is None:
            raise MumuDeviceError("MuMu installation was not found; pass mumu_path")
        self.mumu_path = resolved_path.resolve()
        self.instance_index = instance_index
        self.package = package
        self.dll_path = find_renderer_dll(self.mumu_path)
        self._dll_dirs: list[object] = []
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
            raise MumuDeviceError(
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
            raise MumuDeviceError(
                f"failed to query display size: result={result}, size={width.value}x{height.value}"
            )
        self.width = width.value
        self.height = height.value
        self._buffer = (ctypes.c_ubyte * (self.width * self.height * 4))()
        return self

    def capture(self) -> Frame:
        """将画面捕获到复用缓冲区，并返回零拷贝视图。"""

        if not self.handle or self._buffer is None:
            raise MumuDeviceError("device is not connected")
        width = ctypes.c_int(self.width)
        height = ctypes.c_int(self.height)
        result = self._capture_display(
            self.handle,
            self.display_id,
            len(self._buffer),
            ctypes.byref(width),
            ctypes.byref(height),
            self._buffer,
        )
        if result != 0:
            raise MumuDeviceError(f"capture failed with result={result}")
        if (width.value, height.value) != (self.width, self.height):
            raise MumuDeviceError(
                f"display size changed to {width.value}x{height.value}; reconnect required"
            )
        return Frame(self.width, self.height, memoryview(self._buffer))

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
            raise MumuDeviceError("device is not connected")
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
            raise MumuDeviceError(f"tap failed: down={down_result}, up={up_result}")

    def capture_png(self, path: Path | str) -> Frame:
        frame = self.capture()
        write_bgra_png(Path(path), frame.width, frame.height, frame.pixels)
        return frame

    def close(self) -> None:
        if self.handle:
            self._disconnect(self.handle)
            self.handle = 0
        self._buffer = None
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
    "MumuDevice",
    "MumuDeviceError",
    "discover_mumu_path",
    "find_renderer_dll",
    "write_bgra_png",
]
