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
        self.capture_count = 0
        self.frame = DeviceFrame(self.width, self.height, np.zeros((self.height, self.width, 3), dtype=np.uint8))

    def capture(self) -> DeviceFrame:
        self.capture_count += 1
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
    assert device.capture_count == 2
    context.tap(960, 540, hold_ms=25)
    assert device.taps == [(480, 270, 25)]


def test_task_context_enqueues_reward_screens_with_battle_and_layer_ids(tmp_path: Path) -> None:
    device = FakeDevice()
    mapper = CoordinateMapper(1920, 1080, device.width, device.height)
    requests: list[dict[str, object]] = []
    context = TaskContextImpl(
        device=device,
        mapper=mapper,
        template_matcher=TemplateMatcher(mapper),
        ocr_engine=None,
        artifact_dir=tmp_path / "run-one",
        template_root=tmp_path,
        logger=EventLogger(tmp_path / "logs"),
        run_id="run-one",
        instance_id="mumu-1",
        reward_stats_submitter=requests.append,
    )

    first = context.enqueue_reward_statistics(category="souls", layer=1, roi=(100, 200, 400, 300))
    second = context.enqueue_reward_statistics(category="souls", layer=2, roi=(100, 200, 400, 300))
    third = context.enqueue_reward_statistics(category="souls", layer=1, roi=(100, 200, 400, 300))

    assert [first["battle_index"], second["battle_index"], third["battle_index"]] == [1, 1, 2]
    assert [request["layer"] for request in requests] == [1, 2, 1]
    assert requests[0]["roi"] == [50, 100, 200, 150]
    assert all(Path(str(request["screenshot"])).is_file() for request in requests)


def test_realm_pass_tracker_anchors_then_accumulates_until_confirmation(tmp_path: Path) -> None:
    context = TaskContextImpl(
        device=FakeDevice(),
        mapper=CoordinateMapper(1920, 1080, 960, 540),
        template_matcher=TemplateMatcher(),
        ocr_engine=None,
        artifact_dir=tmp_path / "run",
        template_root=tmp_path,
        logger=EventLogger(tmp_path / "logs"),
    )

    first = context.observe_realm_pass_reward(2, threshold=30)
    assert first == {"estimated_owned": 0, "needs_confirmation": True, "first_detection": True}
    assert context.confirm_realm_pass_count(24, threshold=30)["should_enter"] is False
    assert context.observe_realm_pass_reward(2, threshold=30)["estimated_owned"] == 26
    reached = context.observe_realm_pass_reward(4, threshold=30)
    assert reached == {"estimated_owned": 30, "needs_confirmation": True, "first_detection": False}
    assert context.confirm_realm_pass_count(30, threshold=30)["should_enter"] is True
    assert context.observe_realm_pass_reward(1, threshold=30)["first_detection"] is True
