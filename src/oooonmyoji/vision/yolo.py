"""Optional, lazy YOLO inference. All public boxes use workflow reference pixels."""

from __future__ import annotations

import math
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, Sequence

from ..devices.coordinates import CoordinateMapper, Rect
from ..devices.protocol import DeviceFrame
from ..exceptions import VisionError
from .image import crop_frame


@dataclass(frozen=True)
class Detection:
    class_id: int
    label: str
    confidence: float
    box: tuple[float, float, float, float]  # x1, y1, x2, y2

    @property
    def center(self) -> tuple[float, float]:
        x1, y1, x2, y2 = self.box
        return (x1 + x2) / 2, (y1 + y2) / 2

    def to_dict(self) -> dict[str, Any]:
        x1, y1, x2, y2 = self.box
        return {"class_id": self.class_id, "label": self.label, "confidence": self.confidence,
                "box": list(self.box), "center": list(self.center),
                "x": x1, "y": y1, "width": x2 - x1, "height": y2 - y1}


class ObjectDetector(Protocol):
    def detect(self, frame: DeviceFrame, mapper: CoordinateMapper, *, roi: Sequence[int] | None = None,
               confidence: float = 0.5, iou: float = 0.45, max_results: int = 100,
               image_size: int = 640, device: str = "cpu") -> list[Detection]: ...


class YoloDetector:
    """One model per instance, serialized inference; no imports/downloads at startup."""

    def __init__(self, model_path: Path, *, model_factory: Any = None) -> None:
        self.model_path = model_path
        self._factory = model_factory
        self._model: Any = None
        self._lock = threading.Lock()

    def detect(self, frame: DeviceFrame, mapper: CoordinateMapper, *, roi: Sequence[int] | None = None,
               confidence: float = 0.5, iou: float = 0.45, max_results: int = 100,
               image_size: int = 640, device: str = "cpu") -> list[Detection]:
        if not (0 <= confidence <= 1 and 0 <= iou <= 1) or max_results < 1 or image_size < 32:
            raise ValueError("invalid YOLO inference parameters")
        if (frame.width, frame.height) != (mapper.actual_width, mapper.actual_height):
            raise VisionError("frame resolution changed; reconnect the device before YOLO inference")
        actual_roi = mapper.rect(Rect(*roi)).as_tuple() if roi is not None else None
        image = crop_frame(frame, actual_roi)
        dx, dy = actual_roi[:2] if actual_roi else (0, 0)
        with self._lock:
            if self._model is None:
                if not self.model_path.is_file() or self.model_path.suffix.lower() not in {".pt", ".onnx"}:
                    raise VisionError(f"YOLO requires an existing local .pt or .onnx model: {self.model_path}")
                factory = self._factory
                if factory is None:
                    try:
                        from ultralytics import YOLO
                    except ImportError as exc:
                        raise VisionError("YOLO is optional; install requirements-yolo.txt first", cause=exc) from exc
                    factory = YOLO
                try:
                    self._model = factory(str(self.model_path), task="detect")
                except Exception as exc:
                    raise VisionError(f"unable to load YOLO model {self.model_path}: {exc}", cause=exc) from exc
            try:
                predictions = self._model.predict(source=image, conf=confidence, iou=iou, max_det=max_results,
                                                  imgsz=image_size, device=device, verbose=False, save=False)
                detections = []
                for result in predictions:
                    if result.boxes is None:
                        continue
                    boxes = result.boxes.cpu()
                    for box, score, cls in zip(boxes.xyxy.tolist(), boxes.conf.tolist(), boxes.cls.tolist()):
                        if not all(math.isfinite(float(v)) for v in [*box, score, cls]):
                            continue
                        x1, y1, x2, y2 = box
                        if score < confidence or x2 <= x1 or y2 <= y1:
                            continue
                        # Clamp to the crop before restoring its origin, then invert scaling once.
                        width, height = image.shape[1], image.shape[0]
                        x1, x2 = max(0, min(width, x1)), max(0, min(width, x2))
                        y1, y2 = max(0, min(height, y1)), max(0, min(height, y2))
                        if x2 <= x1 or y2 <= y1:
                            continue
                        reference = ((x1 + dx) / mapper.scale_x, (y1 + dy) / mapper.scale_y,
                                     (x2 + dx) / mapper.scale_x, (y2 + dy) / mapper.scale_y)
                        detections.append(Detection(int(cls), str(result.names[int(cls)]), float(score), reference))
                return sorted(detections, key=lambda item: item.confidence, reverse=True)[:max_results]
            except VisionError:
                raise
            except Exception as exc:
                raise VisionError(f"YOLO inference failed: {exc}", cause=exc) from exc


def resolve_model(root: Path | None, model: str) -> Path:
    path = Path(model)
    if root is not None:
        path = (root / path).resolve()
        try:
            path.relative_to(root.resolve())
        except ValueError as exc:
            raise VisionError("model path must stay below the project root") from exc
    return path.resolve()
