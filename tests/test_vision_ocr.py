from __future__ import annotations

import os

import pytest

from src.oooonmyoji.devices.mumu import Frame, MumuDevice, discover_mumu_path
from src.oooonmyoji.devices.protocol import DeviceFrame
from src.oooonmyoji.exceptions import DeviceError
from src.oooonmyoji.vision.image import frame_to_bgr, write_frame
from src.oooonmyoji.vision.ocr import normalize_ocr_result
from src.oooonmyoji.vision.ocr import SharedOcrPool


def test_mumu_rgba_frame_is_converted_to_correct_bgr_colors() -> None:
    frame = Frame(1, 1, memoryview(bytes([30, 20, 10, 255])))

    image = frame_to_bgr(frame)

    assert image[0, 0].tolist() == [10, 20, 30]


def test_write_frame_handles_non_ascii_png_paths(tmp_path) -> None:
    import cv2
    import numpy as np

    image = np.array([[[10, 20, 30]]], dtype=np.uint8)
    destination = tmp_path / "中文目录" / "截图.png"

    write_frame(destination, DeviceFrame(1, 1, image))

    encoded = np.frombuffer(destination.read_bytes(), dtype=np.uint8)
    decoded = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    assert decoded is not None
    assert decoded[0, 0].tolist() == [10, 20, 30]


def test_normalize_paddle_dictionary_and_confidence_filter() -> None:
    raw = {
        "rec_texts": ["阴阳师", "noise"],
        "rec_scores": [0.99, 0.2],
        "rec_boxes": [[[1, 2], [10, 2], [10, 12], [1, 12]], [[0, 0], [1, 0], [1, 1], [0, 1]]],
    }
    results = normalize_ocr_result(raw, min_confidence=0.6)
    assert len(results) == 1
    assert results[0].text == "阴阳师"
    assert results[0].box[0] == (1, 2)


def test_normalize_paddleocr_3_result_wrapper() -> None:
    result = normalize_ocr_result({
        "res": {
            "rec_texts": ["阴阳师"],
            "rec_scores": [0.97],
            "rec_boxes": [[[1, 2], [11, 2], [11, 12], [1, 12]]],
        }
    })
    assert [item.text for item in result] == ["阴阳师"]


def test_normalize_paddleocr_axis_aligned_boxes() -> None:
    result = normalize_ocr_result({
        "rec_texts": ["文本"],
        "rec_scores": [0.9],
        "rec_boxes": [[1, 2, 11, 12]],
    })
    assert result[0].box == ((1, 2), (11, 2), (11, 12), (1, 12))


@pytest.mark.skipif(
    os.environ.get("OOOONMYOJI_RUN_REAL_OCR") != "1",
    reason="set OOOONMYOJI_RUN_REAL_OCR=1 to run model-backed OCR",
)
def test_real_paddleocr_shared_pool_on_live_mumu_capture() -> None:
    mumu_path = discover_mumu_path()
    if mumu_path is None:
        pytest.skip("MuMu installation with external_renderer_ipc.dll was not found")

    try:
        with MumuDevice(
            mumu_path,
            instance_index=0,
            package="com.netease.onmyoji.wyzymnqsd_cps",
        ) as device:
            frame = device.capture()
            image = frame_to_bgr(frame)
    except DeviceError as exc:
        pytest.skip(f"MuMu instance 0 is unavailable for live OCR: {exc}")

    with SharedOcrPool(language="ch", workers=1, timeout_seconds=60, min_confidence=0.6) as pool:
        results = pool.recognize(image)

    assert results
    image_height, image_width = image.shape[:2]
    for result in results:
        assert isinstance(result.text, str)
        assert result.text.strip()
        assert 0.0 <= result.confidence <= 1.0
        assert len(result.box) == 4
        for x, y in result.box:
            assert 0 <= x < image_width
            assert 0 <= y < image_height
