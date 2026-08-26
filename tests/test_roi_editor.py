from __future__ import annotations

from pathlib import Path

from src.oooonmyoji.tools.roi_editor import (
    RoiRegion,
    build_parser,
    encode_tk_png,
    export_payload,
    normalize_rect,
    safe_filename,
)


def test_normalize_rect_clips_reversed_coordinates() -> None:
    assert normalize_rect(90, 80, -10, -20, 100, 100) == (0, 0, 90, 80)
    assert normalize_rect(10, 10, 11, 30, 100, 100) is None


def test_roi_export_maps_source_coordinates_to_reference_resolution(tmp_path: Path) -> None:
    region = RoiRegion("roi_1", "探索按钮", 100, 50, 200, 100)

    payload = export_payload(Path("screen.png"), 1000, 500, [region], 1920, 1080)

    assert payload["source"] == "screen.png"
    assert payload["regions"][0]["image_rect"] == [100, 50, 200, 100]
    assert payload["regions"][0]["reference_rect"] == [192, 108, 384, 216]
    assert payload["regions"][0]["center"] == [384, 216]


def test_safe_filename_removes_path_separators() -> None:
    assert safe_filename("按钮/左上", "roi") == "按钮_左上"
    assert safe_filename("...", "roi") == "roi"


def test_roi_cli_defaults_to_live_capture_and_allows_static_mode() -> None:
    args = build_parser().parse_args([])
    assert args.interval_ms == 250
    assert args.no_live is False

    static_args = build_parser().parse_args(["--no-live", "--interval-ms", "500"])
    assert static_args.no_live is True
    assert static_args.interval_ms == 500


def test_tk_png_encoding_swaps_bgr_to_rgb_for_tk() -> None:
    import cv2
    import numpy as np

    bgr = np.array([[[10, 20, 30]]], dtype=np.uint8)
    encoded = encode_tk_png(bgr)
    decoded = cv2.imdecode(np.frombuffer(encoded, dtype=np.uint8), cv2.IMREAD_COLOR)

    assert decoded is not None
    assert decoded[0, 0].tolist() == [30, 20, 10]


def test_live_capture_pauses_during_roi_drag() -> None:
    from src.oooonmyoji.tools.roi_editor import RoiEditor

    editor = RoiEditor.__new__(RoiEditor)
    editor.live_enabled = True
    editor.live_job = "after-id"
    editor.live_paused_for_drag = False
    stopped = []
    scheduled = []
    editor._stop_live_capture = lambda: stopped.append(True)
    editor._schedule_live_capture = lambda *, delay_ms=None: scheduled.append(delay_ms)

    editor._pause_live_for_drag()
    assert editor.live_paused_for_drag is True
    assert stopped == [True]

    editor._resume_live_after_drag()
    assert editor.live_paused_for_drag is False
    assert scheduled == [0]
