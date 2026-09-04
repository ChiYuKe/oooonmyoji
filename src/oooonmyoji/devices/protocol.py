"""The device contract consumed by Actions and the runtime."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, Self, runtime_checkable


@dataclass(frozen=True)
class DeviceFrame:
    """A frame with raw BGRA/RGBA pixels or an encoded PNG payload."""

    width: int
    height: int
    pixels: object
    format: str = "bgra"

    @property
    def byte_count(self) -> int:
        if self.format == "png" and isinstance(self.pixels, (bytes, bytearray, memoryview)):
            return len(self.pixels)
        return self.width * self.height * 4


@runtime_checkable
class DeviceBackend(Protocol):
    """Minimal device API available to trusted Actions."""

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
    """Adapt the legacy MuMu Frame without coupling the protocol to it."""

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
