from __future__ import annotations

from typing import Any

import pytest

from src.oooonmyoji.actions.builtin import (
    DetectStateAction,
    RecoverStateAction,
    TapAction,
    TapMatchAction,
    WaitAnyAction,
    WaitTemplateAction,
)
from src.oooonmyoji.vision.template import TemplateMatch


class TapContext:
    def __init__(self) -> None:
        self.taps: list[tuple[int, int, int]] = []

    def check_cancelled(self) -> None:
        return

    def tap(self, x: int, y: int, *, hold_ms: int = 0) -> None:
        self.taps.append((x, y, hold_ms))


class MatchContext(TapContext):
    def capture(self) -> None:
        return

    def find_template(self, template: str, *, roi: Any = None, threshold: float = 0.85) -> list[Any]:
        return []


class WaitContext:
    def wait_for(self, *_args: Any, **_kwargs: Any) -> list[TemplateMatch]:
        return [TemplateMatch(10, 20, 30, 40, 0.97, 10.0, 20.0, 30.0, 40.0)]


def test_tap_applies_random_offset_and_interval(monkeypatch: pytest.MonkeyPatch) -> None:
    context = TapContext()
    offsets = iter((4, -3))
    monkeypatch.setattr("src.oooonmyoji.actions.builtin.random.randint", lambda _minimum, _maximum: next(offsets))
    monkeypatch.setattr("src.oooonmyoji.actions.builtin.random.uniform", lambda _minimum, _maximum: 0.25)
    clock = iter((0.0, 0.0, 0.3))
    sleeps: list[float] = []
    monkeypatch.setattr("src.oooonmyoji.actions.builtin.time.monotonic", lambda: next(clock))
    monkeypatch.setattr("src.oooonmyoji.actions.builtin.time.sleep", sleeps.append)

    result = TapAction().execute(context, {
        "x": 100,
        "y": 200,
        "hold_ms": 25,
        "random_offset": 8,
        "random_interval": [0.2, 0.6],
    })

    assert result.output == {
        "origin_x": 100,
        "origin_y": 200,
        "x": 104,
        "y": 197,
        "offset_x": 4,
        "offset_y": -3,
        "interval_seconds": 0.25,
    }
    assert context.taps == [(104, 197, 25)]
    assert sleeps == [0.1]


def test_tap_match_applies_variation_to_match_center(monkeypatch: pytest.MonkeyPatch) -> None:
    context = MatchContext()
    offsets = iter((2, 1))
    monkeypatch.setattr("src.oooonmyoji.actions.builtin.random.randint", lambda _minimum, _maximum: next(offsets))

    result = TapMatchAction().execute(context, {
        "match": {"reference": [100, 200, 40, 20]},
        "revalidate": False,
        "random_offset": 5,
        "random_interval": [0, 0],
    })

    assert result.output == {
        "origin_x": 120,
        "origin_y": 210,
        "x": 122,
        "y": 211,
        "offset_x": 2,
        "offset_y": 1,
        "interval_seconds": 0.0,
        "revalidated": False,
        "skipped": False,
        "final_state": "",
    }
    assert context.taps == [(122, 211, 0)]


def test_tap_match_accepts_confirmed_next_state_when_transient_match_disappears() -> None:
    context = StateContext("experience")
    result = TapMatchAction().execute(context, {
        "match": {"reference": [100, 200, 40, 20], "template": "settlement.png", "threshold": 0.9},
        "revalidate": True,
        "disappeared_states": [{"name": "experience", "template": "experience.png", "threshold": 0.9}],
    })

    assert result.status.value == "succeeded"
    assert result.output["skipped"] is True
    assert result.output["final_state"] == "experience"
    assert context.taps == []


def test_tap_match_waits_for_confirmed_next_state_when_button_auto_advances() -> None:
    class LoadingMatchContext(StateContext):
        captures = 0

        def capture(self) -> object:
            self.captures += 1
            if self.captures == 3:
                self.state = "experience"
            return super().capture()

    context = LoadingMatchContext("loading")
    result = TapMatchAction().execute(context, {
        "match": {"reference": [100, 200, 40, 20], "template": "ready.png", "threshold": 0.9},
        "revalidate": True,
        "disappeared_states": [{"name": "experience", "template": "experience.png", "threshold": 0.9}],
        "disappeared_state_timeout_seconds": 0.5,
    })

    assert result.status.value == "succeeded"
    assert result.output["skipped"] is True
    assert result.output["final_state"] == "experience"


def test_wait_template_output_can_be_revalidated_by_tap_match() -> None:
    result = WaitTemplateAction().execute(WaitContext(), {
        "template": "assets/templates/target.png",
        "timeout_seconds": 5,
        "roi": [1, 2, 300, 400],
        "threshold": 0.91,
    })

    assert result.output == [{
        "x": 10,
        "y": 20,
        "width": 30,
        "height": 40,
        "confidence": 0.97,
        "reference": [10.0, 20.0, 30.0, 40.0],
        "center": [25, 40],
        "template": "assets/templates/target.png",
        "threshold": 0.91,
        "roi": [1, 2, 300, 400],
    }]


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("random_offset", -1),
        ("random_interval", [0.5, 0.1]),
    ],
)
def test_tap_rejects_invalid_random_parameters(name: str, value: object) -> None:
    with pytest.raises(ValueError, match=name):
        TapAction().execute(TapContext(), {"x": 1, "y": 2, name: value})


class StateContext(TapContext):
    def __init__(self, state: str = "realm") -> None:
        super().__init__()
        self.state = state
        self.capture_calls = 0
        self.ocr_calls = 0
        self.last_frame: object | None = None
        self.saved: list[str] = []
        self.overlay_layer = 0

    def capture(self) -> object:
        self.capture_calls += 1
        self.last_frame = object()
        return self.last_frame

    def find_template(self, template: str, **_kwargs: Any) -> list[TemplateMatch]:
        if template != f"{self.state}.png":
            return []
        return [TemplateMatch(100, 200, 40, 20, 0.97, 100, 200, 40, 20)]

    def ocr_current(self, *, roi: object = None) -> list[object]:
        self.ocr_calls += 1
        return []

    def tap(self, x: int, y: int, *, hold_ms: int = 0) -> None:
        super().tap(x, y, hold_ms=hold_ms)
        if self.state == "settlement":
            self.overlay_layer += 1
            self.state = "settlement" if self.overlay_layer == 1 else "realm"
        elif self.state == "realm":
            self.state = "courtyard"
        elif self.state == "courtyard":
            self.state = "map"
        elif self.state == "map":
            self.state = "souls_type"
        elif self.state == "souls_type":
            self.state = "souls_challenge"

    def key(self, keycode: str) -> None:
        assert keycode == "BACK"
        self.state = "courtyard"

    def save_frame(self, frame: object, name: str) -> str:
        assert frame is self.last_frame
        self.saved.append(name)
        return name


def _states() -> list[dict[str, object]]:
    return [
        {"name": name, "template": f"{name}.png", "roi": [0, 0, 1920, 1080], "threshold": 0.9}
        for name in ["settlement", "realm", "courtyard", "map", "souls_type", "souls_challenge"]
    ]


def test_detect_state_uses_one_capture_and_skips_ocr_after_template_hit() -> None:
    context = StateContext("realm")
    result = DetectStateAction().execute(context, {"states": _states(), "allow_ocr": True})

    assert result.status.value == "succeeded"
    assert result.output["state"] == "realm"
    assert result.output["source"] == "template"
    assert result.output["match"]["reference"] == [100, 200, 40, 20]
    assert context.capture_calls == 1
    assert context.ocr_calls == 0


def test_wait_any_match_can_be_revalidated_by_tap_match() -> None:
    context = StateContext("realm")
    result = WaitAnyAction().execute(context, {
        "templates": ["missing.png", "realm.png"],
        "timeout_seconds": 0.1,
        "roi": [0, 0, 1920, 1080],
        "threshold": 0.9,
    })

    assert result.status.value == "succeeded"
    assert result.output["match"]["template"] == "realm.png"
    assert result.output["match"]["threshold"] == 0.9
    assert result.output["match"]["roi"] == [0, 0, 1920, 1080]


def test_detect_state_ocr_fallback_reuses_the_captured_frame() -> None:
    class OcrOnlyContext(StateContext):
        def find_template(self, template: str, **_kwargs: Any) -> list[TemplateMatch]:
            return []

        def ocr_current(self, *, roi: object = None) -> list[object]:
            self.ocr_calls += 1
            item = type("OcrItem", (), {"text": "结界突破", "confidence": 0.93, "x": 10, "y": 20})()
            return [item]

    context = OcrOnlyContext()
    result = DetectStateAction().execute(context, {
        "states": [{"name": "realm", "texts": ["结界突破"], "text_roi": [0, 0, 500, 200]}],
    })

    assert result.output["state"] == "realm"
    assert result.output["source"] == "ocr"
    assert context.capture_calls == 1
    assert context.ocr_calls == 1


def test_recover_state_bounds_overlays_and_returns_and_confirms_every_transition() -> None:
    context = StateContext("settlement")
    transitions = [
        {"from": "settlement", "type": "tap_match", "expected_states": ["settlement", "realm"]},
        {"from": "realm", "type": "tap", "x": 1815, "y": 210, "return_action": True, "expected_states": ["courtyard"]},
        {"from": "courtyard", "type": "tap_match", "expected_states": ["map"]},
        {"from": "map", "type": "tap_match", "expected_states": ["souls_type"]},
        {"from": "souls_type", "type": "tap_match", "expected_states": ["souls_challenge"]},
    ]
    result = RecoverStateAction().execute(context, {
        "states": _states(),
        "target_states": ["souls_challenge"],
        "overlay_states": ["settlement"],
        "transitions": transitions,
        "timeout_seconds": 2,
        "confirm_timeout_seconds": 0.2,
        "post_action_delay": 0,
        "poll_interval_seconds": 0,
        "max_overlay_clicks": 6,
        "max_return_attempts": 3,
        "max_transitions": 8,
        "random_interval": [0, 0],
    })

    assert result.status.value == "succeeded"
    assert result.output["state"] == "souls_challenge"
    assert result.output["overlay_clicks"] == 2
    assert result.output["return_attempts"] == 1
    assert [item["to"] for item in result.output["actions"]] == [
        "settlement", "realm", "courtyard", "map", "souls_type", "souls_challenge"
    ]


def test_recover_state_saves_frame_when_overlay_limit_is_exceeded() -> None:
    context = StateContext("settlement")
    result = RecoverStateAction().execute(context, {
        "states": _states(),
        "target_states": ["souls_challenge"],
        "overlay_states": ["settlement"],
        "transitions": [{"from": "settlement", "type": "tap_match"}],
        "timeout_seconds": 1,
        "confirm_timeout_seconds": 0.1,
        "post_action_delay": 0,
        "poll_interval_seconds": 0,
        "max_overlay_clicks": 1,
        "failure_frame_name": "recovery-limit.png",
        "random_interval": [0, 0],
    })

    assert result.status.value == "failed"
    assert result.error_category == "recovery"
    assert result.output["overlay_clicks"] == 1
    assert context.saved == ["recovery-limit.png"]


def test_recover_state_does_not_run_ocr_during_loading_transition() -> None:
    class LoadingContext(StateContext):
        loading_captures = 0

        def capture(self) -> object:
            if self.state == "loading":
                self.loading_captures += 1
                if self.loading_captures >= 2:
                    self.state = "souls_challenge"
            return super().capture()

        def tap(self, x: int, y: int, *, hold_ms: int = 0) -> None:
            TapContext.tap(self, x, y, hold_ms=hold_ms)
            self.state = "loading"

    context = LoadingContext("realm")
    result = RecoverStateAction().execute(context, {
        "states": _states(),
        "target_states": ["souls_challenge"],
        "overlay_states": [],
        "transitions": [{"from": "realm", "type": "tap", "x": 10, "y": 10, "expected_states": ["souls_challenge"]}],
        "timeout_seconds": 1,
        "confirm_timeout_seconds": 0.5,
        "post_action_delay": 0,
        "poll_interval_seconds": 0,
        "random_interval": [0, 0],
    })

    assert result.status.value == "succeeded"
    assert context.ocr_calls == 0


def test_recover_state_retries_a_confirmed_unchanged_page_within_transition_limit() -> None:
    class RetryContext(StateContext):
        attempts = 0

        def tap(self, x: int, y: int, *, hold_ms: int = 0) -> None:
            TapContext.tap(self, x, y, hold_ms=hold_ms)
            self.attempts += 1
            if self.attempts == 2:
                self.state = "souls_challenge"

    context = RetryContext("realm")
    result = RecoverStateAction().execute(context, {
        "states": _states(),
        "target_states": ["souls_challenge"],
        "overlay_states": [],
        "transitions": [{
            "from": "realm",
            "type": "tap_match",
            "expected_states": ["souls_challenge"],
            "retry_if_unchanged_seconds": 0,
        }],
        "timeout_seconds": 1,
        "confirm_timeout_seconds": 0.2,
        "post_action_delay": 0,
        "poll_interval_seconds": 0,
        "max_transitions": 2,
        "random_interval": [0, 0],
    })

    assert result.status.value == "succeeded"
    assert context.attempts == 2
    assert result.output["actions"][0]["retry_reason"] == "state_unchanged"
