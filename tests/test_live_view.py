from __future__ import annotations

import json
import time
from pathlib import Path

import cv2
import numpy as np

from src.oooonmyoji.devices.protocol import DeviceFrame
from src.oooonmyoji.runtime.live_view import (
    MAX_INTERVAL_MS,
    MAX_OVERLAY_BOXES,
    MIN_INTERVAL_MS,
    REQUEST_FILENAME,
    LiveViewSink,
    build_overlay,
    request_is_fresh,
    requested_interval_ms,
    sink_from_environment,
    step_summary,
)


def _frame(width: int = 200, height: int = 120) -> DeviceFrame:
    image = np.full((height, width, 3), 255, dtype=np.uint8)
    ok, encoded = cv2.imencode(".png", image)
    assert ok
    return DeviceFrame(width, height, encoded.tobytes(), format="png")


def _event(**fields: object) -> dict:
    return {
        "step_id": "step_1",
        "name": "结界突破",
        "action": "vision.wait_template",
        "node_kind": "task",
        "status": "succeeded",
        "workflow_id": "realm",
        "workflow_path": ["realm", "realm_loop"],
        "workflow_depth": 1,
        "duration_ms": 123.4,
        **fields,
    }


# ------------------------------------------------------------------ 叠加信息


def test_overlay_collects_rois_matches_ocr_and_clicks() -> None:
    overlay = build_overlay(_event(
        params={
            "template": "assets/templates/realm/btn.png",
            "roi": [10, 20, 200, 100],
            "required_text_roi": [30, 40, 50, 60],
        },
        output={
            "reference": [12, 22, 40, 30],
            "confidence": 0.94321,
            "text": "结界突破",
            "clicks": [
                {"origin_x": 90, "origin_y": 90, "x": 97, "y": 85, "offset_x": 7, "offset_y": -5}
            ],
        },
    ))

    assert [item["label"] for item in overlay["rois"]] == ["roi", "required_text_roi"]
    assert overlay["rois"][0]["box"] == [10, 20, 200, 100]
    assert overlay["matches"] == []
    assert overlay["ocr"] == [{"text": "结界突破", "confidence": 0.9432, "box": [12, 22, 40, 30]}]
    assert overlay["clicks"] == [{"reference": [90, 90], "actual": [97, 85], "hold_ms": 0}]


def test_overlay_separates_template_matches_from_ocr() -> None:
    overlay = build_overlay(_event(
        params={"roi": [0, 0, 100, 50]},
        output={"matches": [
            {"x": 4, "y": 6, "width": 20, "height": 30, "confidence": 0.81},
            {"x": 40, "y": 8, "width": 22, "height": 10, "confidence": 0.93},
        ]},
    ))

    # 匹配按置信度从高到低排列，方便桌面端把最强的那个画在最上面。
    assert [item["box"] for item in overlay["matches"]] == [[40, 8, 22, 10], [4, 6, 20, 30]]
    assert overlay["matches"][0]["confidence"] == 0.93
    assert overlay["ocr"] == []


def test_overlay_ignores_confidence_less_and_degenerate_boxes() -> None:
    overlay = build_overlay(_event(params={
        "threshold": 0.85,
        "empty": {"reference": [1, 2, 0, 0], "confidence": 0.99},
        "flag": {"reference": [1, 2, 3, 4], "confidence": True},
        "note": {"reference": [1, 2, 3, 4], "confidence": "0.9"},
        "roi": [0, 0, 0, 0],
    }))

    assert overlay == {"rois": [], "matches": [], "ocr": [], "clicks": []}


def test_overlay_caps_box_count() -> None:
    matches = [
        {"x": index, "y": 0, "width": 4, "height": 4, "confidence": 0.5 + index / 1000}
        for index in range(MAX_OVERLAY_BOXES + 12)
    ]
    overlay = build_overlay(_event(output={"matches": matches}))

    assert len(overlay["matches"]) == MAX_OVERLAY_BOXES


def test_overlay_survives_events_without_params_or_output() -> None:
    assert build_overlay({}) == {"rois": [], "matches": [], "ocr": [], "clicks": []}
    assert build_overlay({"params": None, "output": [1, 2, 3]}) == {"rois": [], "matches": [], "ocr": [], "clicks": []}


def test_step_summary_keeps_status_bar_fields() -> None:
    summary = step_summary(_event(error="none matched", error_category="not_matched", node_type="task"))

    assert summary["step_id"] == "step_1"
    assert summary["action"] == "vision.wait_template"
    assert summary["node_kind"] == "task"
    assert summary["workflow_path"] == ["realm", "realm_loop"]
    assert summary["error_category"] == "not_matched"


def test_sink_ignores_structural_nodes_without_action(tmp_path: Path) -> None:
    clock = _Clock()
    sink = LiveViewSink(
        tmp_path,
        instance_id="mumu-0",
        reference_width=1920,
        reference_height=1080,
        interval_seconds=0.25,
        max_width=160,
        clock=clock,
    )
    sink.record_step(_event(params={"roi": [1, 2, 3, 4]}))
    assert sink.maybe_write(_frame()) is True

    # root / sequence 这类结构节点也会发步骤事件，但不该擦掉上一条真实步骤。
    sink.record_step({"step_id": "root", "node_kind": "root", "status": "succeeded"})
    clock.now = 1.0
    assert sink.maybe_write(_frame()) is True

    meta = json.loads(sink.meta_path.read_text(encoding="utf-8"))
    assert meta["step"]["action"] == "vision.wait_template"
    assert meta["overlay"]["rois"][0]["box"] == [1, 2, 3, 4]


# ------------------------------------------------------------------ 观看门控


def test_request_is_fresh_reads_timestamp(tmp_path: Path) -> None:
    request = tmp_path / REQUEST_FILENAME
    request.write_text(json.dumps({"ts": 100.0}), encoding="utf-8")

    assert request_is_fresh(tmp_path, now=103.0) is True
    assert request_is_fresh(tmp_path, now=130.0) is False


def test_request_is_fresh_rejects_missing_and_broken_requests(tmp_path: Path) -> None:
    assert request_is_fresh(tmp_path, now=1.0) is False

    (tmp_path / REQUEST_FILENAME).write_text("not json", encoding="utf-8")
    assert request_is_fresh(tmp_path, now=1.0) is False

    (tmp_path / REQUEST_FILENAME).write_text(json.dumps({"ts": "now"}), encoding="utf-8")
    assert request_is_fresh(tmp_path, now=1.0) is False


# ------------------------------------------------------------------ 快照写出


class _Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_sink_waits_for_first_step_then_throttles(tmp_path: Path) -> None:
    clock = _Clock()
    sink = LiveViewSink(
        tmp_path,
        instance_id="mumu-0",
        reference_width=1920,
        reference_height=1080,
        interval_seconds=0.25,
        max_width=160,
        clock=clock,
    )

    # 还没有步骤事件：画面缺少上下文，先不写。
    assert sink.maybe_write(_frame()) is False

    sink.record_step(_event())
    assert sink.maybe_write(_frame()) is True
    assert sink.written == 1

    clock.now = 0.1
    assert sink.maybe_write(_frame()) is False
    assert sink.written == 1

    clock.now = 0.3
    assert sink.maybe_write(_frame()) is True
    assert sink.written == 2

    meta = json.loads(sink.meta_path.read_text(encoding="utf-8"))
    assert meta["seq"] == 2
    assert meta["instance_id"] == "mumu-0"
    assert meta["reference_width"] == 1920
    assert meta["step"]["step_id"] == "step_1"
    assert meta["overlay"]["rois"] == []
    assert meta["frame_width"] == 160
    assert meta["frame_height"] == 96

    image = cv2.imdecode(np.frombuffer(sink.frame_path.read_bytes(), dtype=np.uint8), cv2.IMREAD_COLOR)
    assert image is not None and image.shape[:2] == (96, 160)


def _write_request(tmp_path: Path, **fields: object) -> None:
    payload: dict[str, object] = {"ts": time.time(), "instance_id": "mumu-0", **fields}
    (tmp_path / REQUEST_FILENAME).write_text(json.dumps(payload), encoding="utf-8")


def test_sink_follows_the_refresh_rate_in_the_viewing_request(tmp_path: Path) -> None:
    clock = _Clock()
    sink = LiveViewSink(
        tmp_path,
        instance_id="mumu-0",
        reference_width=1920,
        reference_height=1080,
        interval_seconds=0.25,
        max_width=160,
        clock=clock,
        enabled=lambda: request_is_fresh(tmp_path),
    )
    _write_request(tmp_path, interval_ms=1000)
    sink.record_step(_event())

    assert sink.maybe_write(_frame()) is True
    assert sink.interval_seconds == 1.0
    clock.now = 0.5
    # 观看端选了 1 fps：半秒后还不该写。
    assert sink.maybe_write(_frame()) is False

    # 观看端把刷新率调到 100 ms：下一个抓图周期立即跟上，不必等旧间隔走完。
    _write_request(tmp_path, interval_ms=100)
    clock.now = 0.6
    assert sink.maybe_write(_frame()) is True
    assert sink.interval_seconds == 0.1

    clock.now = 0.65
    # 新档位已经生效：50 ms 后就可以写下一帧，而不是再等 1 秒。
    assert sink.maybe_write(_frame()) is False
    clock.now = 0.75
    assert sink.maybe_write(_frame()) is True


def test_requested_interval_is_clamped_and_ignored_when_absent(tmp_path: Path) -> None:
    _write_request(tmp_path)
    assert requested_interval_ms(tmp_path) is None

    _write_request(tmp_path, interval_ms=5)
    assert requested_interval_ms(tmp_path) == 5.0

    sink = LiveViewSink(
        tmp_path,
        instance_id="mumu-0",
        reference_width=1920,
        reference_height=1080,
        interval_seconds=1.0,
    )
    sink.set_interval_ms(5)
    assert sink.interval_seconds == MIN_INTERVAL_MS / 1000
    sink.set_interval_ms(99999)
    assert sink.interval_seconds == MAX_INTERVAL_MS / 1000
    sink.set_interval_ms("nonsense")
    assert sink.interval_seconds == MAX_INTERVAL_MS / 1000  # 非法值不改动现有设置


def test_sink_respects_viewer_gate(tmp_path: Path) -> None:
    clock = _Clock()
    viewing = False
    sink = LiveViewSink(
        tmp_path,
        instance_id="mumu-0",
        reference_width=1920,
        reference_height=1080,
        interval_seconds=0.1,
        clock=clock,
        enabled=lambda: viewing,
    )
    sink.record_step(_event())

    # 没人看的时候不能写盘，也就不会给运行中的工作流增加任何 IO。
    assert sink.maybe_write(_frame()) is False
    assert not sink.meta_path.exists()

    viewing = True
    clock.now = 1.0
    assert sink.maybe_write(_frame()) is True


def test_sink_environment_is_off_without_directory(tmp_path: Path) -> None:
    assert sink_from_environment(instance_id="mumu-0", reference_width=1920, reference_height=1080, environ={}) is None


def test_sink_from_environment_reads_overrides(tmp_path: Path) -> None:
    request = tmp_path / REQUEST_FILENAME
    request.write_text(json.dumps({"ts": __import__("time").time()}), encoding="utf-8")

    sink = sink_from_environment(
        instance_id="mumu-0",
        reference_width=1920,
        reference_height=1080,
        environ={
            "OOONMYOJI_LIVE_VIEW_DIR": str(tmp_path),
            "OOONMYOJI_LIVE_VIEW_INTERVAL_MS": "500",
            "OOONMYOJI_LIVE_VIEW_MAX_WIDTH": "480",
        },
    )

    assert sink is not None
    assert sink.interval_seconds == 0.5
    assert sink.max_width == 480
    # 桌面端刚写过 request.json：门控应当是打开的。
    assert sink.maybe_write(_frame()) is False  # 还没有步骤事件
    sink.record_step(_event())
    assert sink.maybe_write(_frame()) is True
