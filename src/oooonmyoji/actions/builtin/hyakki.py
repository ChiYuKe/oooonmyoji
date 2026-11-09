"""YOLO detection, dataset sampling, and a bounded Hyakki throwing session."""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any

from ...devices.coordinates import Rect
from ...vision.hyakki import controller_from_config
from ..base import Action, ActionResult


def _options(arguments: dict[str, Any]) -> dict[str, Any]:
    return {"roi": arguments.get("roi"), "confidence": float(arguments.get("confidence", 0.5)),
            "iou": float(arguments.get("iou", 0.45)), "image_size": int(arguments.get("image_size", 640)),
            "device": str(arguments.get("device", "cpu")), "max_results": int(arguments.get("max_results", 100))}


def _pause(context: Any, seconds: float) -> None:
    deadline = time.monotonic() + seconds
    while True:
        context.check_cancelled()
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return
        time.sleep(min(0.05, remaining))


class DetectObjectsAction(Action):
    name = "vision.detect_objects"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        results = context.detect_objects(str(arguments["model"]), **_options(arguments))
        labels = arguments.get("labels", [])
        return ActionResult.succeeded([item.to_dict() for item in results if not labels or item.label in labels])


class CaptureDatasetAction(Action):
    name = "vision.capture_dataset"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        count = int(arguments.get("count", 100))
        interval = float(arguments.get("interval_seconds", 0.2))
        if not 1 <= count <= 10000 or interval < 0.05:
            raise ValueError("dataset count must be 1..10000 and interval >= 0.05 seconds")
        session = f"datasets/hyakki/{uuid.uuid4().hex}"
        directory = Path(context.artifact_dir) / session
        directory.mkdir(parents=True, exist_ok=False)
        with (directory / "frames.jsonl").open("w", encoding="utf-8") as metadata:
            for index in range(count):
                frame = context.capture()
                path = context.save_frame(frame, f"{session}/{index:06d}.png")
                metadata.write(json.dumps({"image": str(path), "width": frame.width, "height": frame.height,
                                           "index": index, "timestamp": time.monotonic()}, ensure_ascii=False) + "\n")
                metadata.flush()
                if index + 1 < count:
                    _pause(context, interval)
        return ActionResult.succeeded({"directory": str(directory), "count": count})


class HyakkiPlayAction(Action):
    name = "hyakki.play"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        roi = arguments["roi"]
        # Validate before capturing or loading a model. ROI and policy share reference coordinates.
        context.mapper.rect(Rect(*roi))
        tracker, policy = controller_from_config(arguments)
        duration = float(arguments.get("duration_seconds", 60))
        idle_timeout = float(arguments.get("idle_timeout_seconds", 8))
        period = float(arguments.get("frame_interval_seconds", 0.05))
        budget = int(arguments.get("max_throws", 100))
        if not 0 < duration <= 600 or idle_timeout <= 0 or period < 0.01 or budget < 1:
            raise ValueError("invalid session duration, idle timeout, capture interval, or throw budget")
        dry_run = bool(arguments.get("dry_run", True))
        session = uuid.uuid4().hex
        directory = Path(context.artifact_dir) / "hyakki" / session
        directory.mkdir(parents=True, exist_ok=False)
        (directory / "config.json").write_text(json.dumps(arguments, ensure_ascii=False, indent=2), encoding="utf-8")
        trace_path = directory / "decisions.jsonl"
        throws = planned = frames = 0
        started = last_target = time.monotonic()
        reason = "duration"
        # Streaming trace is also the replay input. No unbounded per-frame output in workflow state.
        with trace_path.open("w", encoding="utf-8") as trace:
            while time.monotonic() - started < duration:
                context.check_cancelled()
                captured_at = time.monotonic()
                frame = context.capture()
                # find_template uses this same cached frame: never infer after detecting a result screen.
                end_template = arguments.get("end_template")
                if end_template and context.find_template(end_template, threshold=float(arguments.get("end_threshold", 0.85))):
                    reason = "end_template"
                    break
                active_template = arguments.get("active_template")
                if active_template and not context.find_template(active_template, threshold=float(arguments.get("active_threshold", 0.85))):
                    reason = "inactive_screen"
                    break
                detections = context.detect_objects(str(arguments["model"]), frame=frame, **_options(arguments))
                tracks = tracker.update(detections, captured_at)
                frames += 1
                now = time.monotonic()
                if now - started >= duration:
                    reason = "duration"
                    break
                if any(track.detection.label in policy.priorities for track in tracks):
                    last_target = now
                decision = policy.decide(tracks, captured_at=captured_at, now=now)
                if decision is not None:
                    context.check_cancelled()
                    if not dry_run:
                        context.tap(decision.x, decision.y)
                        throws += 1
                    planned += 1
                    policy.record_throw(tracker.tracks[decision.track_id], now)
                record = {"timestamp": captured_at - started, "decision_at": now - started,
                          "detections": [item.to_dict() for item in detections],
                          "decision": decision.to_dict() if decision else None, "dry_run": dry_run}
                trace.write(json.dumps(record, ensure_ascii=False) + "\n")
                trace.flush()
                if planned >= budget:
                    reason = "throw_budget"
                    break
                if now - last_target >= idle_timeout:
                    reason = "idle_timeout"
                    break
                _pause(context, max(0, period - (time.monotonic() - captured_at)))
        output = {"reason": reason, "frames": frames, "throws": throws, "planned_throws": planned,
                  "dry_run": dry_run, "elapsed_seconds": round(time.monotonic() - started, 3), "trace": str(trace_path)}
        context.log("百鬼夜行会话结束", **output)
        return ActionResult.succeeded(output)
