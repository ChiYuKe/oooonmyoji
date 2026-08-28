"""OpenCV template matching with ROI scaling and duplicate suppression."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..devices.coordinates import CoordinateMapper, Rect
from ..exceptions import VisionError
from .image import frame_to_bgr


@dataclass(frozen=True)
class TemplateMatch:
    x: int
    y: int
    width: int
    height: int
    confidence: float
    reference_x: float
    reference_y: float
    reference_width: float
    reference_height: float

    @property
    def center(self) -> tuple[int, int]:
        return self.x + self.width // 2, self.y + self.height // 2

    def to_dict(self) -> dict[str, Any]:
        return {
            "x": self.x,
            "y": self.y,
            "width": self.width,
            "height": self.height,
            "confidence": round(self.confidence, 6),
            "reference": [self.reference_x, self.reference_y, self.reference_width, self.reference_height],
            "center": list(self.center),
        }


def _iou(left: TemplateMatch, right: TemplateMatch) -> float:
    x1 = max(left.x, right.x)
    y1 = max(left.y, right.y)
    x2 = min(left.x + left.width, right.x + right.width)
    y2 = min(left.y + left.height, right.y + right.height)
    intersection = max(0, x2 - x1) * max(0, y2 - y1)
    union = left.width * left.height + right.width * right.height - intersection
    return intersection / union if union else 0.0


class TemplateMatcher:
    def __init__(self, mapper: CoordinateMapper | None = None) -> None:
        self.mapper = mapper

    def find(
        self,
        frame: object,
        template: Path | str | object,
        *,
        roi: tuple[int, int, int, int] | None = None,
        threshold: float = 0.85,
        max_results: int = 20,
        deduplicate_iou: float = 0.3,
        scale_search: bool = False,
    ) -> list[TemplateMatch]:
        if not 0.0 <= threshold <= 1.0:
            raise ValueError("threshold must be between 0 and 1")
        try:
            import cv2
            import numpy as np
        except ImportError as exc:
            raise VisionError("OpenCV and numpy are required for template matching") from exc
        image = frame_to_bgr(frame)
        source_roi = None
        if roi is not None:
            if self.mapper is not None:
                source_roi = self.mapper.rect(Rect(*roi))
            else:
                source_roi = Rect(*roi)
            x, y, width, height = source_roi.as_tuple()
            if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > image.shape[1] or y + height > image.shape[0]:
                raise VisionError(f"ROI is outside frame: {roi}")
            search = image[y : y + height, x : x + width]
        else:
            x, y = 0, 0
            search = image
        if isinstance(template, (str, Path)):
            try:
                # cv2.imread cannot reliably open non-ASCII Windows paths.
                payload = Path(template).read_bytes()
            except OSError:
                template_image = None
            else:
                template_image = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_COLOR)
            if template_image is None:
                raise VisionError(f"template image does not exist or is unreadable: {template}")
        elif isinstance(template, np.ndarray):
            template_image = template
        else:
            raise VisionError("template must be a path or numpy array")
        if template_image.ndim == 2:
            template_image = cv2.cvtColor(template_image, cv2.COLOR_GRAY2BGR)
        if self.mapper is not None and (self.mapper.scale_x != 1.0 or self.mapper.scale_y != 1.0):
            template_image = cv2.resize(
                template_image,
                (
                    max(1, round(template_image.shape[1] * self.mapper.scale_x)),
                    max(1, round(template_image.shape[0] * self.mapper.scale_y)),
                ),
                interpolation=cv2.INTER_AREA,
            )
        if search.shape[0] < template_image.shape[0] or search.shape[1] < template_image.shape[1]:
            return []
        # 多尺度匹配（scale_search）：模拟器窗口缩放/分辨率漂移时按多档缩放搜索图兜底
        scales = [0.9, 0.95, 1.0, 1.05, 1.1] if scale_search else [1.0]
        candidates: list[TemplateMatch] = []
        template_height, template_width = template_image.shape[:2]
        for scale in scales:
            if scale == 1.0:
                search_view = search
            else:
                search_view = cv2.resize(
                    search,
                    (max(1, round(search.shape[1] * scale)), max(1, round(search.shape[0] * scale))),
                    interpolation=cv2.INTER_AREA,
                )
            if search_view.shape[0] < template_image.shape[0] or search_view.shape[1] < template_image.shape[1]:
                continue
            result = cv2.matchTemplate(search_view, template_image, cv2.TM_CCOEFF_NORMED)
            locations = np.where(result >= threshold)
            for row, column in zip(*locations):
                confidence = float(result[row, column])
                # 缩放尺度下的命中点换算回原搜索图坐标
                actual_x = int(round(column / scale)) + x
                actual_y = int(round(row / scale)) + y
                if self.mapper is None:
                    reference_x, reference_y = float(actual_x), float(actual_y)
                    reference_width, reference_height = float(template_width), float(template_height)
                else:
                    reference_x = actual_x / self.mapper.scale_x
                    reference_y = actual_y / self.mapper.scale_y
                    reference_width = template_width / self.mapper.scale_x
                    reference_height = template_height / self.mapper.scale_y
                candidates.append(TemplateMatch(
                    actual_x,
                    actual_y,
                    template_width,
                    template_height,
                    confidence,
                    reference_x,
                    reference_y,
                    reference_width,
                    reference_height,
                ))
        candidates.sort(key=lambda item: item.confidence, reverse=True)
        selected: list[TemplateMatch] = []
        for candidate in candidates:
            if any(_iou(candidate, existing) >= deduplicate_iou for existing in selected):
                continue
            selected.append(candidate)
            if len(selected) >= max_results:
                break
        return selected


__all__ = ["TemplateMatch", "TemplateMatcher"]
