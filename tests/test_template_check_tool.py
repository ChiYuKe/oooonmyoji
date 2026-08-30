from __future__ import annotations

import base64
from pathlib import Path

import cv2
import numpy as np
import pytest

from src.oooonmyoji.tools.template_check import check_image, resolve_template_path


def test_check_image_returns_frame_roi_and_confidence(tmp_path: Path) -> None:
    image = np.zeros((100, 200, 3), dtype=np.uint8)
    template = np.full((20, 30, 3), 32, dtype=np.uint8)
    cv2.rectangle(template, (3, 3), (26, 16), (255, 255, 255), 3)
    actual_template = cv2.resize(template, (15, 10), interpolation=cv2.INTER_AREA)
    image[40:50, 80:95] = actual_template
    encoded, payload = cv2.imencode(".png", template)
    assert encoded
    template_path = tmp_path / "assets" / "templates" / "target.png"
    template_path.parent.mkdir(parents=True)
    template_path.write_bytes(payload.tobytes())

    result = check_image(
        image,
        template_path,
        reference_resolution=(400, 200),
        roi=(100, 40, 200, 120),
        threshold=0.99,
        max_results=3,
    )

    assert result["image_size"] == [200, 100]
    assert result["reference_resolution"] == [400, 200]
    assert result["roi"] == [100, 40, 200, 120]
    assert result["roi_image"] == [50, 20, 100, 60]
    assert len(result["matches"]) == 1
    assert result["matches"][0]["confidence"] >= 0.99
    assert abs(result["matches"][0]["x"] - 80) <= 1
    assert base64.b64decode(result["image_base64"]).startswith(b"\x89PNG\r\n\x1a\n")


def test_resolve_template_path_rejects_project_escape(tmp_path: Path) -> None:
    outside = tmp_path.parent / "outside.png"
    outside.write_bytes(b"not-an-image")

    with pytest.raises(ValueError, match="below the project root"):
        resolve_template_path(tmp_path, str(outside))
