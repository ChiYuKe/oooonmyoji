from __future__ import annotations

import base64
import queue
from pathlib import Path

import cv2
import numpy as np

from src.oooonmyoji.devices.coordinates import CoordinateMapper
from src.oooonmyoji.tools.vision_stream import (
    VisionStream,
    build_mapper,
    build_parser,
    image_roi_to_reference_roi,
)


def test_image_roi_maps_to_reference_coordinates() -> None:
    mapper = CoordinateMapper(1920, 1080, 960, 540)

    assert image_roi_to_reference_roi((100, 50, 200, 100), mapper) == (200, 100, 400, 200)


def test_image_roi_clamps_to_reference_bounds() -> None:
    mapper = CoordinateMapper(1920, 1080, 960, 540)

    rect = image_roi_to_reference_roi((940, 520, 40, 40), mapper)

    assert rect[0] + rect[2] <= mapper.reference_width
    assert rect[1] + rect[3] <= mapper.reference_height
    assert rect[2] >= 1
    assert rect[3] >= 1


def test_build_mapper_rejects_mismatched_aspect_ratios() -> None:
    assert build_mapper(1920, 1080, 1920, 1080) is not None
    assert build_mapper(1920, 1080, 1080, 1920) is None


def test_vision_stream_cli_defaults() -> None:
    args = build_parser().parse_args([])
    assert args.instance == "mumu-0"
    assert args.interval_ms == 200
    assert args.max_frame_width == 1280


class SinkDevice:
    """Fake Mumu-like device whose capture payload is replaced via frame_to_bgr."""

    def __init__(self) -> None:
        self.taps: list[tuple[int, int, int]] = []
        self.closed = False
        self.width = 960
        self.height = 540

    def connect(self) -> "SinkDevice":
        return self

    def capture(self):
        return object()

    def tap(self, x: int, y: int, hold_ms: int = 0) -> None:
        self.taps.append((x, y, hold_ms))

    def close(self) -> None:
        self.closed = True


def make_stream(
    tmp_path: Path,
    sink: list[dict],
    *,
    interval_ms: int = 1000,
    max_frame_width: int = 1280,
    seed: int = 5,
) -> tuple[VisionStream, SinkDevice, np.ndarray, np.ndarray]:
    """VisionStream + SinkDevice + (image, template) with one embedded textured target.

    画面里嵌入的是模板按 0.5 缩放后的纹理（与生产匹配器的坐标映射一致），
    匹配器加载原尺寸模板后会在内部缩到同样大小，命中置信度接近 1.0。
    """
    rng = np.random.default_rng(seed)
    template = rng.integers(0, 256, (120, 120, 3), dtype=np.uint8)
    image = rng.integers(0, 256, (540, 960, 3), dtype=np.uint8)
    scaled = cv2.resize(template, (60, 60), interpolation=cv2.INTER_AREA)
    image[100:160, 300:360] = scaled

    device = SinkDevice()
    stream = VisionStream(
        device_factory=lambda: device,
        write=sink.append,
        interval_ms=interval_ms,
        max_frame_width=max_frame_width,
        project_root=tmp_path,
    )
    return stream, device, image, template


def test_stream_emits_ready_and_downscaled_frames(tmp_path: Path) -> None:
    from src.oooonmyoji.tools import vision_stream

    sink: list[dict] = []
    stream, device, image, _ = make_stream(tmp_path, sink, interval_ms=20, max_frame_width=640)

    original_frame_to_bgr = vision_stream.frame_to_bgr
    try:
        vision_stream.frame_to_bgr = lambda _frame: image.copy()  # type: ignore[assignment]
        stream.run(commands=queue.Queue(), frame_limit=2)
    finally:
        vision_stream.frame_to_bgr = original_frame_to_bgr

    ready = next(item for item in sink if item["type"] == "ready")
    assert ready["orig_width"] == 960
    assert ready["orig_height"] == 540
    assert ready["display_width"] == 640  # 960 > max_frame_width=640
    assert ready["display_height"] == 360
    assert ready["mapper"] is True
    assert ready["reference"] == [1920, 1080]

    frames = [item for item in sink if item["type"] == "frame"]
    assert len(frames) == 2
    payload = base64.b64decode(frames[0]["data"])
    decoded = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_COLOR)
    assert decoded is not None
    assert decoded.shape[1] == 640
    assert frames[0]["orig_width"] == 960
    assert device.closed is True


def test_stream_answers_match_tap_and_interval_commands(tmp_path: Path) -> None:
    sink: list[dict] = []
    stream, device, image, template = make_stream(tmp_path, sink)
    cv2.imwrite(str(tmp_path / "texture.png"), template)

    stream._frame = image
    commands: queue.Queue = queue.Queue()
    commands.put({
        "type": "match",
        "id": 7,
        "template": "texture.png",
        "threshold": 0.9,
        "roi": [200, 50, 400, 200],
    })
    commands.put({"type": "tap", "id": 8, "x": 330, "y": 110, "hold_ms": 25})
    commands.put({"type": "interval", "id": 9, "ms": 500})
    stream._drain_commands(commands)

    result = next(item for item in sink if item["type"] == "match_result")
    assert result["id"] == 7
    assert len(result["matches"]) == 1
    match = result["matches"][0]
    assert (match["x"], match["y"]) == (300, 100)
    assert match["confidence"] >= 0.9
    assert result["roi"] == [200, 50, 400, 200]

    tap_result = next(item for item in sink if item["type"] == "tap_result")
    assert tap_result["ok"] is True
    assert device.taps == [(330, 110, 25)]

    ack = next(item for item in sink if item["type"] == "ack" and item["id"] == 9)
    assert ack["id"] == 9
    assert stream.interval_ms == 500


def test_stream_reports_bad_template_path(tmp_path: Path) -> None:
    sink: list[dict] = []
    stream, device, image, _ = make_stream(tmp_path, sink)
    stream._frame = image

    commands: queue.Queue = queue.Queue()
    commands.put({"type": "match", "id": 1, "template": "missing.png"})
    stream._drain_commands(commands)

    error = next(item for item in sink if item["type"] == "error")
    assert error["id"] == 1
    assert "missing.png" in error["message"]
