from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from jsonschema import validate

from src.oooonmyoji.actions.builtin.hyakki import CaptureDatasetAction, DetectObjectsAction, HyakkiPlayAction
from src.oooonmyoji.actions.registry import build_action_registry
from src.oooonmyoji.devices.coordinates import CoordinateMapper
from src.oooonmyoji.devices.protocol import DeviceFrame
from src.oooonmyoji.exceptions import CancelledError, VisionError
from src.oooonmyoji.tools.hyakki_replay import replay
from src.oooonmyoji.vision.hyakki import TargetTracker, ThrowPolicy
from src.oooonmyoji.vision.yolo import Detection, YoloDetector, resolve_model
from src.oooonmyoji.workflows.loader import WorkflowLoader


def detection(x=100, *, label="target", cls=0, confidence=0.9):
    return Detection(cls, label, confidence, (x, 100, x + 40, 140))


def policy(**kwargs):
    return ThrowPolicy(priorities=["rare", "target"], play_roi=[0, 0, 1000, 500], **kwargs)


def test_tracker_association_velocity_occlusion_and_expiration():
    tracker = TargetTracker(max_distance=50, ttl=0.5)
    first = tracker.update([detection(100)], 1)[0]
    second = tracker.update([detection(110)], 1.1)[0]
    assert second.id == first.id
    assert second.vx == pytest.approx(100)
    assert tracker.update([], 1.2) == []  # no shooting at retained, unseen tracks
    assert tracker.update([detection(130)], 1.3)[0].id == first.id
    assert tracker.update([detection(200)], 2)[0].id != first.id


def test_tracking_is_class_aware_and_one_to_one():
    tracker = TargetTracker()
    initial = tracker.update([detection(100), detection(120)], 1)
    next_frame = tracker.update([detection(110), detection(130), detection(110, cls=1)], 1.1)
    assert len({track.id for track in next_frame}) == 3
    assert next_frame[-1].id not in {track.id for track in initial}


def test_tracking_preserves_identity_at_same_class_crossing():
    tracker = TargetTracker()
    tracker.update([detection(100), detection(160)], 1)
    tracker.update([detection(120), detection(140)], 1.1)
    crossed = tracker.update([detection(120), detection(140)], 1.2)
    assert crossed[0].detection.center[0] == 160
    assert crossed[1].detection.center[0] == 140


def test_predicts_motion_and_accounts_for_frame_age():
    tracker = TargetTracker()
    tracker.update([detection(100)], 1)
    tracks = tracker.update([detection(110)], 1.1)
    decision = policy(flight_seconds=0.2).decide(tracks, captured_at=1.1, now=1.2)
    assert decision.x == 160  # center 130 + 100 px/s * (0.1 age + 0.2 flight)
    assert decision.y == 122


@pytest.mark.parametrize("now", [0.9, 1.7])
def test_rejects_negative_or_stale_frame_age(now):
    tracks = TargetTracker().update([detection()], 1)
    assert policy(min_hits=1).decide(tracks, captured_at=1, now=now) is None


def test_priority_cooldown_target_limit_and_global_interval():
    tracker = TargetTracker()
    tracks = tracker.update([detection(), detection(200, label="rare", cls=1)], 1)
    strategy = policy(min_hits=1, max_per_target=1)
    decision = strategy.decide(tracks, captured_at=1, now=1)
    assert decision.label == "rare"
    strategy.record_throw(tracker.tracks[decision.track_id], 1)
    assert strategy.decide(tracks, captured_at=1, now=1.1) is None
    assert strategy.decide(tracks, captured_at=1, now=1.2).label == "target"


def test_never_aims_outside_play_roi_or_at_unlisted_class():
    tracker = TargetTracker()
    tracker.update([detection(900)], 1)
    tracks = tracker.update([detection(990)], 1.1)
    assert policy().decide(tracks, captured_at=1.1, now=1.1) is None
    tracks = TargetTracker().update([detection(label="button")], 1)
    assert policy(min_hits=1).decide(tracks, captured_at=1, now=1) is None


def test_ignores_impossible_speed_and_requires_confirmation():
    tracker = TargetTracker()
    assert policy().decide(tracker.update([detection()], 1), captured_at=1, now=1) is None
    tracks = tracker.update([detection(150)], 1.01)
    assert policy().decide(tracks, captured_at=1.01, now=1.01) is None


def test_yolo_roi_inverse_scaling_and_lazy_model_cache(tmp_path):
    weights = tmp_path / "model.pt"
    weights.touch()
    calls = []

    class Boxes:
        xyxy = np.array([[10, 20, 50, 60], [1, 2, 3, 4]])
        conf = np.array([0.95, 0.1])
        cls = np.array([0, 0])

        def cpu(self):
            return self

    class Model:
        def __init__(self, *args, **kwargs):
            calls.append("load")

        def predict(self, **kwargs):
            assert kwargs["source"].shape[:2] == (100, 200)
            return [SimpleNamespace(boxes=Boxes(), names={0: "target"})]

    engine = YoloDetector(weights, model_factory=Model)
    frame = DeviceFrame(1000, 500, np.zeros((500, 1000, 3), dtype=np.uint8))
    mapper = CoordinateMapper(2000, 1000, 1000, 500)
    assert not calls
    result = engine.detect(frame, mapper, roi=[200, 100, 400, 200])
    assert result[0].box == (220, 140, 300, 220)
    assert len(result) == 1
    engine.detect(frame, mapper, roi=[200, 100, 400, 200])
    assert calls == ["load"]


def test_yolo_rejects_missing_model_and_resolution_change(tmp_path):
    engine = YoloDetector(tmp_path / "missing.pt")
    frame = DeviceFrame(10, 10, np.zeros((10, 10, 3), dtype=np.uint8))
    with pytest.raises(VisionError, match="local"):
        engine.detect(frame, CoordinateMapper(10, 10, 10, 10))
    with pytest.raises(VisionError, match="resolution"):
        engine.detect(frame, CoordinateMapper(10, 10, 20, 20))


def test_model_path_cannot_escape_project(tmp_path):
    with pytest.raises(VisionError, match="project root"):
        resolve_model(tmp_path, "../weights.pt")


def test_context_detection_captures_fresh_frame_reuses_model_and_checks_cancel(tmp_path, monkeypatch):
    import threading

    from src.oooonmyoji.runtime.context import TaskContextImpl
    from src.oooonmyoji.vision.template import TemplateMatcher

    clock = Clock()
    backend = Context(tmp_path, clock)
    created = []

    class Detector:
        def __init__(self, path):
            created.append(path)

        def detect(self, frame, mapper, **options):
            assert frame.width == mapper.actual_width
            return [detection()]

    monkeypatch.setattr("src.oooonmyoji.vision.yolo.YoloDetector", Detector)
    cancelled = threading.Event()
    context = TaskContextImpl(device=backend, mapper=backend.mapper,
                              template_matcher=TemplateMatcher(backend.mapper), ocr_engine=None,
                              artifact_dir=tmp_path, template_root=tmp_path,
                              logger=SimpleNamespace(emit=lambda *args, **kwargs: None), cancel_event=cancelled)
    context.detect_objects("test.pt")
    context.detect_objects("test.pt")
    assert len(created) == 1 and backend.frames == 2
    context.detect_objects("test.pt", frame=context.last_frame)
    assert backend.frames == 2
    cancelled.set()
    with pytest.raises(CancelledError):
        context.detect_objects("test.pt")
    assert backend.frames == 2


class Clock:
    value = 0.0

    def monotonic(self):
        return self.value

    def sleep(self, seconds):
        self.value += max(seconds, 0.001)


class Context:
    def __init__(self, tmp_path, clock):
        self.artifact_dir = tmp_path
        self.mapper = CoordinateMapper(1000, 500, 1000, 500)
        self.clock = clock
        self.frames = 0
        self.taps = []
        self.cancelled = False
        self.matches = set()
        self.targets = True
        self.delay = 0.01

    def check_cancelled(self):
        if self.cancelled:
            raise CancelledError("cancelled")

    def capture(self):
        self.check_cancelled()
        self.frames += 1
        self.clock.value += 0.02
        return DeviceFrame(1000, 500, np.zeros((500, 1000, 3), dtype=np.uint8))

    def detect_objects(self, model, **kwargs):
        self.clock.value += self.delay
        return [detection(100 + self.frames)] if self.targets else []

    def tap(self, x, y):
        self.taps.append((x, y))

    def find_template(self, template, **kwargs):
        return [True] if template in self.matches else []

    def save_frame(self, frame, name):
        path = self.artifact_dir / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"test frame")
        return path

    def log(self, *args, **kwargs):
        pass


@pytest.fixture
def session(tmp_path, monkeypatch):
    clock = Clock()
    monkeypatch.setattr("src.oooonmyoji.actions.builtin.hyakki.time", clock)
    return Context(tmp_path, clock)


def arguments(**overrides):
    return {"model": "models/test.pt", "roi": [0, 0, 1000, 500], "priorities": ["target"],
            "max_throws": 2, "duration_seconds": 2, **overrides}


@pytest.mark.parametrize("dry_run", [True, False])
def test_session_budget_dry_run_and_exact_replay(session, dry_run):
    output = HyakkiPlayAction().execute(session, arguments(dry_run=dry_run)).output
    assert output["reason"] == "throw_budget"
    assert output["planned_throws"] == 2
    assert output["throws"] == len(session.taps) == (0 if dry_run else 2)
    path = Path(output["trace"])
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    replayed = replay(path.parent)
    assert replayed["planned_throws"] == 2
    assert [(d["x"], d["y"]) for d in replayed["decisions"]] == [
        (row["decision"]["x"], row["decision"]["y"]) for row in rows if row["decision"]]


@pytest.mark.parametrize("options,expected", [({"end_template": "end"}, "end_template"),
                                            ({"active_template": "active"}, "inactive_screen")])
def test_session_screen_guards_never_throw(session, options, expected):
    session.matches.add("end")
    result = HyakkiPlayAction().execute(session, arguments(dry_run=False, **options))
    assert result.output["reason"] == expected
    assert not session.taps


def test_session_idle_timeout(session):
    session.targets = False
    output = HyakkiPlayAction().execute(session, arguments(idle_timeout_seconds=0.15)).output
    assert output["reason"] == "idle_timeout"
    assert output["planned_throws"] == 0


def test_session_slow_inference_never_throws(session):
    session.delay = 0.7
    output = HyakkiPlayAction().execute(session, arguments(dry_run=False)).output
    assert output["reason"] == "duration"
    assert not session.taps


def test_session_cancels_and_sampling_cancels(session):
    session.cancelled = True
    with pytest.raises(CancelledError):
        HyakkiPlayAction().execute(session, arguments(dry_run=False))
    with pytest.raises(CancelledError):
        CaptureDatasetAction().execute(session, {"count": 2})
    assert not session.taps


def test_dataset_sampling_and_detection_filter(session):
    output = CaptureDatasetAction().execute(session, {"count": 3, "interval_seconds": 0.1}).output
    directory = Path(output["directory"])
    assert len(list(directory.glob("*.png"))) == 3
    assert len((directory / "frames.jsonl").read_text().splitlines()) == 3
    output = DetectObjectsAction().execute(session, {"model": "test.pt", "labels": ["other"]}).output
    assert output == []


def test_manifest_registration_defaults_output_and_workflow_examples(session):
    from src.oooonmyoji.actions.manifest import apply_parameter_defaults

    root = Path(__file__).resolve().parents[1]
    registry = build_action_registry(root / "plugins/actions")
    spec = registry.get("hyakki.play")
    assert not spec.retry_safe and spec.side_effect
    options = apply_parameter_defaults(spec.definition.parameters, arguments())
    assert options["dry_run"] is True
    validate(options, spec.input_schema)
    result = spec.action.execute(session, options)
    validate(result.output, spec.output_schema)
    loader = WorkflowLoader(root / "workflows", registry, project_root=root)
    assert loader.load("samples/百鬼夜行_观察.owf")
    assert loader.load("samples/百鬼夜行_采集.owf")
