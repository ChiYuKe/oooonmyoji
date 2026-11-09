"""Pure tracking and throwing policy, shared by live sessions and offline replay."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Sequence

from .yolo import Detection


@dataclass
class Track:
    id: int
    detection: Detection
    seen_at: float
    hits: int = 1
    vx: float = 0
    vy: float = 0
    throws: int = 0
    last_throw: float = -math.inf


class TargetTracker:
    """Class-aware nearest predicted center matching with one-to-one association.

    Only tracks observed on the current frame are returned. Missing tracks are
    retained briefly for re-association, never used to fire through occlusion.
    """

    def __init__(self, *, max_distance: float = 100, ttl: float = 0.5) -> None:
        if not all(math.isfinite(value) and value > 0 for value in (max_distance, ttl)):
            raise ValueError("tracker distance and ttl must be positive")
        self.max_distance, self.ttl = max_distance, ttl
        self.tracks: dict[int, Track] = {}
        self._next_id = 1
        self._last_time = -math.inf

    def update(self, detections: Sequence[Detection], timestamp: float) -> list[Track]:
        if not math.isfinite(timestamp) or timestamp <= self._last_time:
            raise ValueError("tracking timestamps must strictly increase")
        self._last_time = timestamp
        self.tracks = {key: track for key, track in self.tracks.items() if timestamp - track.seen_at <= self.ttl}
        candidates = []
        for index, detection in enumerate(detections):
            cx, cy = detection.center
            for key, track in self.tracks.items():
                if track.detection.class_id != detection.class_id:
                    continue
                dt = timestamp - track.seen_at
                px, py = track.detection.center
                distance = math.hypot(cx - px - track.vx * dt, cy - py - track.vy * dt)
                if distance <= self.max_distance:
                    candidates.append((distance, key, index))
        assigned_tracks: set[int] = set()
        assigned_detections: set[int] = set()
        visible = []
        for _, key, index in sorted(candidates):
            if key in assigned_tracks or index in assigned_detections:
                continue
            track = self.tracks[key]
            detection = detections[index]
            dt = timestamp - track.seen_at
            x, y = track.detection.center
            nx, ny = detection.center
            vx, vy = (nx - x) / dt, (ny - y) / dt
            weight = 1.0 if track.hits == 1 else 0.5
            track.vx = weight * vx + (1 - weight) * track.vx
            track.vy = weight * vy + (1 - weight) * track.vy
            track.detection, track.seen_at = detection, timestamp
            track.hits += 1
            assigned_tracks.add(key)
            assigned_detections.add(index)
            visible.append(track)
        for index, detection in enumerate(detections):
            if index in assigned_detections:
                continue
            track = Track(self._next_id, detection, timestamp)
            self.tracks[track.id] = track
            self._next_id += 1
            visible.append(track)
        return sorted(visible, key=lambda track: track.id)


@dataclass(frozen=True)
class ThrowDecision:
    track_id: int
    label: str
    x: int
    y: int
    lead_seconds: float

    def to_dict(self) -> dict:
        return dict(track_id=self.track_id, label=self.label, x=self.x, y=self.y, lead_seconds=self.lead_seconds)


class ThrowPolicy:
    def __init__(self, *, priorities: Sequence[str], play_roi: Sequence[int], interval: float = 0.15,
                 target_interval: float = 0.3, max_per_target: int = 5, min_hits: int = 2,
                 flight_seconds: float = 0.15, max_frame_age: float = 0.6, aim_y: float = 0.55,
                 max_speed: float = 2000) -> None:
        if not priorities or len(play_roi) != 4 or min(play_roi[2:]) <= 0:
            raise ValueError("target priorities and a non-empty play ROI are required")
        values = (interval, target_interval, flight_seconds, max_frame_age, max_speed, aim_y, *play_roi)
        if not all(math.isfinite(v) for v in values):
            raise ValueError("policy values must be finite")
        if min(interval, target_interval, flight_seconds) < 0 or min(max_frame_age, max_speed) <= 0:
            raise ValueError("invalid throwing timing or speed")
        if min_hits < 1 or max_per_target < 1 or not 0 <= aim_y <= 1:
            raise ValueError("invalid target hit limits or aim_y")
        self.priorities = {name: index for index, name in reversed(list(enumerate(priorities)))}
        self.roi = tuple(play_roi)
        self.interval, self.target_interval = interval, target_interval
        self.max_per_target, self.min_hits = max_per_target, min_hits
        self.flight_seconds, self.max_frame_age, self.aim_y = flight_seconds, max_frame_age, aim_y
        self.max_speed = max_speed
        self.last_throw = -math.inf

    def decide(self, tracks: Sequence[Track], *, captured_at: float, now: float) -> ThrowDecision | None:
        age = now - captured_at
        if age < 0 or age > self.max_frame_age or now - self.last_throw < self.interval:
            return None
        rx, ry, rw, rh = self.roi
        candidates = []
        for track in tracks:
            if track.seen_at != captured_at or track.hits < self.min_hits or track.detection.label not in self.priorities:
                continue
            if track.throws >= self.max_per_target or now - track.last_throw < self.target_interval:
                continue
            if math.hypot(track.vx, track.vy) > self.max_speed:
                continue
            x1, y1, x2, y2 = track.detection.box
            lead = age + self.flight_seconds
            x = round((x1 + x2) / 2 + track.vx * lead)
            y = round(y1 + (y2 - y1) * self.aim_y + track.vy * lead)
            # Never clamp a departing target onto the screen edge.
            if not (rx <= x < rx + rw and ry <= y < ry + rh):
                continue
            decision = ThrowDecision(track.id, track.detection.label, x, y, lead)
            candidates.append((self.priorities[track.detection.label], -track.detection.confidence, track.id, decision))
        return min(candidates, key=lambda item: item[:3])[3] if candidates else None

    def record_throw(self, track: Track, now: float) -> None:
        track.throws += 1
        track.last_throw = self.last_throw = now


def controller_from_config(config: dict[str, Any]) -> tuple[TargetTracker, ThrowPolicy]:
    """One configuration contract for live sessions and offline replay."""
    return TargetTracker(max_distance=float(config.get("track_distance", 100)),
                         ttl=float(config.get("track_ttl_seconds", 0.5))), ThrowPolicy(
        priorities=config["priorities"], play_roi=config["roi"],
        interval=float(config.get("throw_interval_seconds", 0.15)),
        target_interval=float(config.get("target_interval_seconds", 0.3)),
        max_per_target=int(config.get("max_per_target", 5)), min_hits=int(config.get("min_hits", 2)),
        flight_seconds=float(config.get("flight_seconds", 0.15)),
        max_frame_age=float(config.get("max_frame_age_seconds", 0.6)),
        aim_y=float(config.get("aim_y", 0.55)), max_speed=float(config.get("max_speed", 2000)),
    )
