"""Replay a saved session's detector outputs without a device or YOLO dependency."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from ..vision.hyakki import controller_from_config
from ..vision.yolo import Detection


def replay(directory: Path, overrides: dict[str, Any] | None = None) -> dict[str, Any]:
    config = json.loads((directory / "config.json").read_text(encoding="utf-8"))
    config.update(overrides or {})
    tracker, policy = controller_from_config(config)
    decisions = []
    frames = 0
    budget = int(config.get("max_throws", 100))
    with (directory / "decisions.jsonl").open(encoding="utf-8") as source:
        for line in source:
            row = json.loads(line)
            captured_at, now = float(row["timestamp"]), float(row["decision_at"])
            detections = [Detection(item["class_id"], item["label"], item["confidence"], tuple(item["box"]))
                          for item in row["detections"]]
            tracks = tracker.update(detections, captured_at)
            frames += 1
            decision = policy.decide(tracks, captured_at=captured_at, now=now)
            if decision:
                decisions.append({"timestamp": now, **decision.to_dict()})
                policy.record_throw(tracker.tracks[decision.track_id], now)
            if len(decisions) >= budget:
                break
    return {"frames": frames, "planned_throws": len(decisions), "decisions": decisions}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("session", type=Path, help="artifact directory containing config.json and decisions.jsonl")
    parser.add_argument("--config", type=Path, help="optional JSON parameter overrides for calibration")
    args = parser.parse_args()
    overrides = json.loads(args.config.read_text(encoding="utf-8")) if args.config else None
    print(json.dumps(replay(args.session, overrides), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
