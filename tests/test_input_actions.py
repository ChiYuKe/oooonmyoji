from __future__ import annotations

from typing import Any

import pytest

from src.oooonmyoji.actions.builtin import TapAction, TapMatchAction, WaitTemplateAction
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
    }
    assert context.taps == [(122, 211, 0)]


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
