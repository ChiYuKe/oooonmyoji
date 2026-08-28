from __future__ import annotations

import base64
import threading
from pathlib import Path

import pytest

from src.oooonmyoji.actions.builtin import WaitTextAction
from src.oooonmyoji.devices.coordinates import CoordinateMapper
from src.oooonmyoji.devices.protocol import DeviceFrame
from src.oooonmyoji.exceptions import OcrError
from src.oooonmyoji.runtime.context import TaskContextImpl
from src.oooonmyoji.runtime.logging import EventLogger
from src.oooonmyoji.vision.image import frame_to_bgr
from src.oooonmyoji.vision.ocr import OcrResult
from src.oooonmyoji.vision.template import TemplateMatcher

TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


class StubDevice:
    width = 1920
    height = 1080

    def capture(self) -> DeviceFrame:
        return DeviceFrame(self.width, self.height, TINY_PNG, format="png")

    def tap(self, x: int, y: int, hold_ms: int = 0) -> None:
        return None

    def close(self) -> None:
        return None


class StubOcrEngine:
    """前 empty_calls 次返回空，之后返回匹配文本。"""

    def __init__(self, *, empty_calls: int = 2, text: str = "结算完成") -> None:
        self.empty_calls = empty_calls
        self.text = text
        self.calls = 0

    def recognize(self, image: object) -> list[OcrResult]:
        self.calls += 1
        if self.calls <= self.empty_calls:
            return []
        box = ((0, 0), (10, 0), (10, 10), (0, 10))
        return [OcrResult(self.text, 0.92, box)]


def _context(tmp_path: Path, ocr_engine: object | None) -> TaskContextImpl:
    return TaskContextImpl(
        device=StubDevice(),
        mapper=CoordinateMapper(1920, 1080, 1920, 1080),
        template_matcher=TemplateMatcher(CoordinateMapper(1920, 1080, 1920, 1080)),
        ocr_engine=ocr_engine,
        artifact_dir=tmp_path / "artifacts",
        template_root=tmp_path,
        logger=EventLogger(tmp_path / "logs"),
        cancel_event=threading.Event(),
        capture_attempts=1,
        ocr_attempts=1,
    )


def test_wait_text_succeeds_when_text_appears(tmp_path: Path) -> None:
    action = WaitTextAction()
    engine = StubOcrEngine(empty_calls=2)
    context = _context(tmp_path, engine)
    result = action.execute(context, {"text": "结算", "timeout_seconds": 5})
    assert result.status.value == "succeeded"
    assert result.output == {"matched": 1, "text": "结算", "present": True}
    assert engine.calls >= 3


def test_wait_text_times_out_without_match(tmp_path: Path) -> None:
    action = WaitTextAction()
    context = _context(tmp_path, StubOcrEngine(empty_calls=10 ** 9))
    result = action.execute(context, {"text": "不存在的文本", "timeout_seconds": 0.4})
    assert result.status.value == "failed"
    assert result.error_category == "vision"
    assert "超时" in str(result.error)


def test_wait_text_with_disabled_ocr(tmp_path: Path) -> None:
    action = WaitTextAction()
    context = _context(tmp_path, None)  # OCR 未启用
    result = action.execute(context, {"text": "结算", "timeout_seconds": 1})
    assert result.status.value == "failed"
    assert result.error_category == "ocr"


def test_wait_text_validates_arguments(tmp_path: Path) -> None:
    action = WaitTextAction()
    context = _context(tmp_path, StubOcrEngine())
    bad = action.execute(context, {"text": "", "timeout_seconds": 1})
    assert bad.status.value == "failed"
    assert bad.error_category == "workflow"
    bad_confidence = action.execute(context, {"text": "x", "timeout_seconds": 1, "min_confidence": 5})
    assert bad_confidence.status.value == "failed"
    assert bad_confidence.error_category == "workflow"