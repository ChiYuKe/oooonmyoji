from __future__ import annotations

import cv2
import numpy as np

from src.oooonmyoji.devices.coordinates import CoordinateMapper
from src.oooonmyoji.devices.protocol import DeviceFrame
from src.oooonmyoji.vision.template import TemplateMatcher


def test_template_matching_returns_confidence_and_reference_coordinates() -> None:
    image = np.zeros((540, 960, 3), dtype=np.uint8)
    pattern = np.zeros((40, 60, 3), dtype=np.uint8)
    cv2.rectangle(pattern, (4, 4), (54, 34), (255, 255, 255), 4)
    image[100:120, 200:230] = cv2.resize(pattern, (30, 20), interpolation=cv2.INTER_AREA)
    frame = DeviceFrame(960, 540, image)
    mapper = CoordinateMapper(1920, 1080, 960, 540)
    matches = TemplateMatcher(mapper).find(frame, pattern, roi=(300, 150, 500, 400), threshold=0.99)
    assert len(matches) == 1
    assert matches[0].confidence >= 0.99
    assert abs(matches[0].reference_x - 400) <= 2
    assert abs(matches[0].reference_y - 200) <= 2


def test_template_matching_reads_unicode_paths(tmp_path) -> None:
    image = np.full((80, 100, 3), 32, dtype=np.uint8)
    pattern = np.full((20, 30, 3), 32, dtype=np.uint8)
    cv2.rectangle(pattern, (4, 4), (26, 16), (255, 255, 255), 3)
    image[30:50, 40:70] = pattern
    encoded, payload = cv2.imencode(".png", pattern)
    assert encoded
    template_path = tmp_path / "中文目录" / "template.png"
    template_path.parent.mkdir()
    template_path.write_bytes(payload.tobytes())

    matches = TemplateMatcher().find(DeviceFrame(100, 80, image), template_path, threshold=0.99)

    assert len(matches) == 1
    assert (matches[0].x, matches[0].y) == (40, 30)
