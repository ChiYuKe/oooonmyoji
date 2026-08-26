"""Reference-resolution coordinate and ROI mapping."""

from __future__ import annotations

from dataclasses import dataclass

from ..exceptions import ConfigError


@dataclass(frozen=True)
class Rect:
    x: int
    y: int
    width: int
    height: int

    @property
    def right(self) -> int:
        return self.x + self.width

    @property
    def bottom(self) -> int:
        return self.y + self.height

    def as_tuple(self) -> tuple[int, int, int, int]:
        return self.x, self.y, self.width, self.height


@dataclass(frozen=True)
class CoordinateMapper:
    reference_width: int
    reference_height: int
    actual_width: int
    actual_height: int
    max_aspect_ratio_delta: float = 0.01

    def __post_init__(self) -> None:
        if min(
            self.reference_width,
            self.reference_height,
            self.actual_width,
            self.actual_height,
        ) <= 0:
            raise ConfigError("all resolutions must be positive")
        if self.aspect_ratio_delta > self.max_aspect_ratio_delta:
            raise ConfigError(
                "display aspect ratio differs from workflow reference by "
                f"{self.aspect_ratio_delta:.3%}, above {self.max_aspect_ratio_delta:.3%}"
            )

    @property
    def scale_x(self) -> float:
        return self.actual_width / self.reference_width

    @property
    def scale_y(self) -> float:
        return self.actual_height / self.reference_height

    @property
    def aspect_ratio_delta(self) -> float:
        reference = self.reference_width / self.reference_height
        actual = self.actual_width / self.actual_height
        return abs(actual / reference - 1.0)

    def point(self, x: int | float, y: int | float) -> tuple[int, int]:
        mapped_x = round(float(x) * self.scale_x)
        mapped_y = round(float(y) * self.scale_y)
        if not 0 <= mapped_x < self.actual_width or not 0 <= mapped_y < self.actual_height:
            raise ConfigError(f"mapped point ({mapped_x},{mapped_y}) is outside display")
        return mapped_x, mapped_y

    def rect(self, value: Rect | tuple[int, int, int, int]) -> Rect:
        source = value if isinstance(value, Rect) else Rect(*value)
        mapped = Rect(
            round(source.x * self.scale_x),
            round(source.y * self.scale_y),
            round(source.width * self.scale_x),
            round(source.height * self.scale_y),
        )
        if mapped.width < 1 or mapped.height < 1:
            raise ConfigError("mapped ROI is empty")
        if mapped.x < 0 or mapped.y < 0 or mapped.right > self.actual_width or mapped.bottom > self.actual_height:
            raise ConfigError(f"mapped ROI {mapped.as_tuple()} is outside display")
        return mapped


__all__ = ["CoordinateMapper", "Rect"]
