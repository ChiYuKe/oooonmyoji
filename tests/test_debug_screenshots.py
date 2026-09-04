from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np

from src.oooonmyoji.devices.coordinates import CoordinateMapper
from src.oooonmyoji.devices.protocol import DeviceFrame
from src.oooonmyoji.runtime.debug import ACTUAL_COLOR, MATCH_COLOR, ORIGIN_COLOR, ROI_COLOR, DebugStepRecorder


def _frame(width: int = 200, height: int = 120) -> DeviceFrame:
    image = np.full((height, width, 3), 255, dtype=np.uint8)
    ok, encoded = cv2.imencode(".png", image)
    assert ok
    return DeviceFrame(width, height, encoded.tobytes(), format="png")


def _has_color(image: np.ndarray, color: tuple[int, int, int]) -> bool:
    return bool(np.any(np.all(image == np.asarray(color, dtype=np.uint8), axis=2)))


def test_debug_screenshot_marks_roi_match_and_click_offset(tmp_path: Path) -> None:
    context = SimpleNamespace(
        last_frame=_frame(),
        artifact_dir=tmp_path,
        mapper=CoordinateMapper(200, 120, 200, 120),
    )
    recorder = DebugStepRecorder(context)
    event = {
        "step_id": "settle_1",
        "workflow_id": "realm_raid_loop",
        "workflow_path": ["realm_raid", "realm_raid_loop"],
        "node_kind": "task",
        "action": "input.dismiss_template_until_text",
        "status": "succeeded",
        "started_at": 1.0,
        "params": {
            "template_roi": [10, 68, 170, 45],
            "match": {"reference": [42, 72, 35, 24], "confidence": 0.94321},
        },
        "output": {
            "clicks": [
                {"origin_x": 90, "origin_y": 90, "x": 97, "y": 85, "offset_x": 7, "offset_y": -5}
            ]
        },
    }

    first = recorder.record(event)
    repeated = recorder.record(event)
    second = recorder.record({**event, "started_at": 2.0})

    assert first is not None and repeated == first and second is not None
    assert first.name.startswith("000001-")
    assert second.name.startswith("000002-")
    image = cv2.imdecode(np.frombuffer(first.read_bytes(), dtype=np.uint8), cv2.IMREAD_COLOR)
    assert image is not None
    assert _has_color(image, ROI_COLOR)
    assert _has_color(image, MATCH_COLOR)
    assert _has_color(image, ORIGIN_COLOR)
    assert _has_color(image, ACTUAL_COLOR)


def test_debug_screenshot_captures_completed_action_frame(tmp_path: Path) -> None:
    stale = _frame()
    fresh_image = np.zeros((120, 200, 3), dtype=np.uint8)
    ok, encoded = cv2.imencode(".png", fresh_image)
    assert ok
    fresh = DeviceFrame(200, 120, encoded.tobytes(), format="png")
    context = SimpleNamespace(
        last_frame=stale,
        capture=lambda: fresh,
        artifact_dir=tmp_path,
        mapper=CoordinateMapper(200, 120, 200, 120),
    )
    recorder = DebugStepRecorder(context)
    event = {
        "step_id": "tap",
        "workflow_id": "workflow",
        "node_kind": "task",
        "action": "input.tap",
        "status": "succeeded",
        "started_at": 1.0,
    }

    destination = recorder.record(event)
    assert destination is not None
    image = cv2.imdecode(np.frombuffer(destination.read_bytes(), dtype=np.uint8), cv2.IMREAD_COLOR)
    assert image is not None
    # The fresh black frame is retained beneath the debug header.
    assert int(image[90, 100].max()) == 0
