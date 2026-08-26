from __future__ import annotations

import pytest

from src.oooonmyoji.devices.coordinates import CoordinateMapper, Rect
from src.oooonmyoji.exceptions import ConfigError


def test_coordinate_mapper_scales_points_and_rois() -> None:
    mapper = CoordinateMapper(1920, 1080, 1280, 720)
    assert mapper.point(960, 540) == (640, 360)
    assert mapper.rect(Rect(100, 200, 400, 300)).as_tuple() == (67, 133, 267, 200)


def test_coordinate_mapper_rejects_aspect_ratio_drift() -> None:
    with pytest.raises(ConfigError):
        CoordinateMapper(1920, 1080, 1280, 700)
