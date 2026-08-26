from __future__ import annotations

from pathlib import Path

import numpy as np

from src.oooonmyoji.devices.coordinates import CoordinateMapper
from src.oooonmyoji.devices.protocol import DeviceFrame
from src.oooonmyoji.runtime.context import TaskContextImpl
from src.oooonmyoji.runtime.logging import EventLogger
from src.oooonmyoji.vision.ocr import OcrResult
from src.oooonmyoji.vision.template import TemplateMatcher


class FakeDevice:
    instance_id = "fake"
    width = 960
    height = 540

    def __init__(self) -> None:
        self.taps: list[tuple[int, int, int]] = []
        self.frame = DeviceFrame(self.width, self.height, np.zeros((self.height, self.width, 3), dtype=np.uint8))

    def capture(self) -> DeviceFrame:
        return self.frame

    def tap(self, x: int, y: int, hold_ms: int = 0) -> None:
        self.taps.append((x, y, hold_ms))

    def health_check(self) -> bool:
        return True


class FakeOcr:
    def recognize(self, image: object) -> list[OcrResult]:
        return [OcrResult("中文", 0.98, ((1, 2), (10, 2), (10, 12), (1, 12)))]


def test_task_context_maps_taps_and_translates_roi_ocr(tmp_path: Path) -> None:
    device = FakeDevice()
    mapper = CoordinateMapper(1920, 1080, device.width, device.height)
    context = TaskContextImpl(
        device=device,
        mapper=mapper,
        template_matcher=TemplateMatcher(mapper),
        ocr_engine=FakeOcr(),
        artifact_dir=tmp_path / "artifacts",
        template_root=tmp_path,
        logger=EventLogger(tmp_path / "logs"),
    )
    context.capture()
    result = context.ocr(roi=(200, 100, 100, 100))[0]
    assert result.text == "中文"
    assert result.box[0] == (101, 52)
    context.tap(960, 540, hold_ms=25)
    assert device.taps == [(480, 270, 25)]
