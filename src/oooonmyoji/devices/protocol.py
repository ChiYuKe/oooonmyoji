"""Action 与运行时消费的设备契约。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, Self, runtime_checkable


@dataclass(frozen=True)
class DeviceFrame:
    """一帧画面：既可以是 BGRA/RGBA 原始像素，也可以是编码后的 PNG。"""

    width: int
    height: int
    pixels: object
    format: str = "bgra"

    @property
    def byte_count(self) -> int:
        """返回该帧占用的字节数，PNG 按实际载荷长度计算。"""

        if self.format == "png" and isinstance(self.pixels, (bytes, bytearray, memoryview)):
            return len(self.pixels)
        return self.width * self.height * 4


@runtime_checkable
class DeviceBackend(Protocol):
    """可信 Action 可以使用的最小设备接口。"""

    width: int
    height: int
    instance_id: str

    def connect(self) -> Self: ...

    def capture(self) -> object: ...

    def tap(self, x: int, y: int, hold_ms: int = 0) -> None: ...

    def swipe(self, x1: int, y1: int, x2: int, y2: int, duration_ms: int = 300) -> None: ...

    def key(self, keycode: str) -> None: ...

    def type_text(self, text: str) -> None: ...

    def health_check(self) -> bool: ...

    def close(self) -> None: ...


def frame_from_backend(frame: object) -> DeviceFrame:
    """把后端返回的帧适配成 DeviceFrame，避免协议依赖具体后端。"""

    if isinstance(frame, DeviceFrame):
        return frame
    width = getattr(frame, "width", None)
    height = getattr(frame, "height", None)
    pixels = getattr(frame, "pixels", None)
    if not isinstance(width, int) or not isinstance(height, int) or pixels is None:
        raise TypeError("backend capture did not return a frame-like object")
    frame_format = getattr(frame, "format", "bgra")
    if not isinstance(frame_format, str):
        frame_format = "bgra"
    return DeviceFrame(width, height, pixels, format=frame_format)


__all__ = ["DeviceBackend", "DeviceFrame", "frame_from_backend"]
