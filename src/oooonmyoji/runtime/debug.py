"""Annotated per-action screenshots for workflow diagnostics."""

from __future__ import annotations

import re
import threading
from pathlib import Path
from typing import Any, Iterable, Iterator

from ..devices.coordinates import Rect
from ..vision.image import frame_to_bgr


ROI_COLOR = (255, 255, 0)
MATCH_COLOR = (70, 235, 70)
ORIGIN_COLOR = (0, 215, 255)
ACTUAL_COLOR = (40, 40, 255)


def _numbers(value: object, length: int) -> tuple[float, ...] | None:
    if not isinstance(value, (list, tuple)) or len(value) != length:
        return None
    if any(isinstance(item, bool) or not isinstance(item, (int, float)) for item in value):
        return None
    return tuple(float(item) for item in value)


def _walk(value: object) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk(child)


def _named_rois(value: object) -> Iterable[tuple[str, tuple[float, ...]]]:
    if not isinstance(value, dict):
        return
    for key, child in value.items():
        normalized = str(key).lower()
        roi = _numbers(child, 4)
        if roi is not None and (normalized == "roi" or normalized.endswith("_roi")):
            yield str(key), roi
        if isinstance(child, (dict, list)):
            yield from _named_rois(child)


def _reference_match(value: dict[str, Any], mapper: Any) -> tuple[int, int, int, int] | None:
    reference = _numbers(value.get("reference"), 4)
    if reference is not None:
        try:
            return mapper.rect(Rect(*(round(item) for item in reference))).as_tuple()
        except Exception:
            return None
    fields = tuple(value.get(key) for key in ("x", "y", "width", "height"))
    numeric_fields = tuple(float(item) for item in fields if not isinstance(item, bool) and isinstance(item, (int, float)))
    if len(numeric_fields) == 4:
        return (
            round(numeric_fields[0]),
            round(numeric_fields[1]),
            round(numeric_fields[2]),
            round(numeric_fields[3]),
        )
    return None


def _clicks(event: dict[str, Any]) -> Iterable[tuple[tuple[float, float], tuple[float, float]]]:
    output = event.get("output")
    if not isinstance(output, dict):
        return
    candidates: list[dict[str, Any]] = []
    nested = output.get("clicks")
    if isinstance(nested, list):
        candidates.extend(item for item in nested if isinstance(item, dict))
    candidates.append(output)
    for item in candidates:
        actual = _numbers([item.get("x"), item.get("y")], 2)
        origin = _numbers([item.get("origin_x"), item.get("origin_y")], 2)
        if origin is None and actual is not None:
            offset = _numbers([item.get("offset_x"), item.get("offset_y")], 2)
            if offset is not None:
                origin = (actual[0] - offset[0], actual[1] - offset[1])
        if origin is not None and actual is not None:
            yield (origin[0], origin[1]), (actual[0], actual[1])


def _safe_name(value: object) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", str(value or "unknown")) or "unknown"


def _write_bgr(path: Path, image: Any) -> None:
    try:
        import cv2
    except ImportError as exc:
        raise RuntimeError("OpenCV is required for annotated debug screenshots") from exc
    ok, encoded = cv2.imencode(".png", image)
    if not ok:
        raise RuntimeError(f"unable to encode debug screenshot: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(encoded.tobytes())


class DebugStepRecorder:
    """Save one uniquely named image for every completed task-node execution."""

    def __init__(self, context: Any, *, annotate: bool = True, sequence: Iterator[int] | None = None) -> None:
        self.context = context
        self.annotate = annotate
        self._sequence = sequence
        self._counter = 0
        self._saved: dict[tuple[tuple[str, ...], str, float], Path] = {}
        self._lock = threading.Lock()

    def record(self, event: dict[str, Any]) -> Path | None:
        if event.get("node_kind") != "task":
            return None
        workflow_path_value = event.get("workflow_path")
        workflow_path = tuple(str(item) for item in workflow_path_value) if isinstance(workflow_path_value, list) else ()
        identity = (workflow_path, str(event.get("step_id") or "unknown"), float(event.get("started_at") or 0.0))
        with self._lock:
            existing = self._saved.get(identity)
            if existing is not None:
                return existing
            # A task event is emitted after the action returns. Capture again at
            # that boundary so the annotation describes the completed action,
            # rather than the frame cached by the preceding vision poll.
            frame = None
            capture = getattr(self.context, "capture", None)
            if callable(capture):
                try:
                    frame = capture()
                except Exception:
                    frame = None
            if frame is None:
                frame = self.context.last_frame
            if frame is None:
                return None
            self._counter = next(self._sequence) if self._sequence is not None else self._counter + 1
            name = (
                f"{self._counter:06d}-"
                f"{_safe_name(event.get('workflow_id'))}-"
                f"{_safe_name(event.get('step_id'))}-"
                f"{_safe_name(event.get('status'))}.png"
            )
            destination = self.context.artifact_dir / "debug" / name
            if self.annotate:
                image = frame_to_bgr(frame).copy()
                self._annotate(image, event)
                _write_bgr(destination, image)
            else:
                self.context.save_frame(frame, f"debug/{name}")
            self._saved[identity] = destination
            return destination

    def _annotate(self, image: Any, event: dict[str, Any]) -> None:
        import cv2

        height, width = image.shape[:2]

        def clamp_point(point: tuple[int, int]) -> tuple[int, int]:
            return max(0, min(width - 1, point[0])), max(0, min(height - 1, point[1]))

        seen_rois: set[tuple[int, int, int, int]] = set()
        for label, roi in _named_rois(event.get("params")):
            try:
                mapped = self.context.mapper.rect(Rect(*(round(item) for item in roi))).as_tuple()
            except Exception:
                continue
            if mapped in seen_rois:
                continue
            seen_rois.add(mapped)
            x, y, roi_width, roi_height = mapped
            cv2.rectangle(image, clamp_point((x, y)), clamp_point((x + roi_width, y + roi_height)), ROI_COLOR, 2)
            roi_label = f"{label} [{x},{y},{roi_width},{roi_height}]"
            cv2.putText(image, roi_label, clamp_point((x + 4, y + 18)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, ROI_COLOR, 1, cv2.LINE_AA)

        seen_matches: set[tuple[int, int, int, int]] = set()
        for value in _walk({"params": event.get("params"), "output": event.get("output")}):
            confidence = value.get("confidence")
            if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
                continue
            rect = _reference_match(value, self.context.mapper)
            if rect is None or rect in seen_matches:
                continue
            seen_matches.add(rect)
            x, y, match_width, match_height = rect
            cv2.rectangle(image, clamp_point((x, y)), clamp_point((x + match_width, y + match_height)), MATCH_COLOR, 2)
            cv2.putText(
                image,
                f"match {float(confidence):.3f}",
                clamp_point((x + 4, max(16, y - 6))),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                MATCH_COLOR,
                1,
                cv2.LINE_AA,
            )

        for origin, actual in _clicks(event):
            try:
                origin_point = clamp_point(self.context.mapper.point(*origin))
                actual_point = clamp_point(self.context.mapper.point(*actual))
            except Exception:
                continue
            cv2.line(image, origin_point, actual_point, ACTUAL_COLOR, 2, cv2.LINE_AA)
            cv2.drawMarker(image, origin_point, ORIGIN_COLOR, cv2.MARKER_CROSS, 18, 2, cv2.LINE_AA)
            cv2.circle(image, actual_point, 8, ACTUAL_COLOR, 2, cv2.LINE_AA)
            cv2.putText(
                image,
                f"origin ({round(origin[0])},{round(origin[1])})",
                clamp_point((origin_point[0] + 11, origin_point[1] - 9)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.45,
                ORIGIN_COLOR,
                1,
                cv2.LINE_AA,
            )
            cv2.putText(
                image,
                f"actual ({round(actual[0])},{round(actual[1])})",
                clamp_point((actual_point[0] + 11, actual_point[1] + 18)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.45,
                ACTUAL_COLOR,
                1,
                cv2.LINE_AA,
            )

        bar_height = min(height, 58)
        overlay = image.copy()
        cv2.rectangle(overlay, (0, 0), (width, bar_height), (16, 18, 22), -1)
        cv2.addWeighted(overlay, 0.78, image, 0.22, 0, image)
        title = f"{event.get('step_id', 'unknown')} | {event.get('action') or event.get('node_type')} | {event.get('status')}"
        cv2.putText(image, title[:160], (10, min(23, height - 1)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (245, 245, 245), 1, cv2.LINE_AA)
        legend = "ROI cyan | match green | origin yellow + | actual red o"
        cv2.putText(image, legend, (10, min(47, height - 1)), cv2.FONT_HERSHEY_SIMPLEX, 0.43, (205, 210, 218), 1, cv2.LINE_AA)


__all__ = ["DebugStepRecorder"]
