"""输入动作：坐标点击、滑动、按键与文本输入。"""

from __future__ import annotations

import math
import random
import time

from typing import Any

from ..base import Action, ActionResult

class TapAction(Action):
    name = "input.tap"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        x = int(arguments["x"])
        y = int(arguments["y"])
        clicked_x, clicked_y, interval_seconds = _tap_with_variation(context, x, y, arguments)
        return ActionResult.succeeded({
            "origin_x": x,
            "origin_y": y,
            "x": clicked_x,
            "y": clicked_y,
            "offset_x": clicked_x - x,
            "offset_y": clicked_y - y,
            "interval_seconds": interval_seconds,
        })


class SwipeAction(Action):
    name = "input.swipe"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        start = (int(arguments["x1"]), int(arguments["y1"]))
        end = (int(arguments["x2"]), int(arguments["y2"]))
        context.swipe(*start, *end, duration_ms=int(arguments.get("duration_ms", 300)))
        return ActionResult.succeeded({"x1": start[0], "y1": start[1], "x2": end[0], "y2": end[1], "duration_ms": int(arguments.get("duration_ms", 300))})


class KeyAction(Action):
    name = "input.key"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        keycode = str(arguments["keycode"]).strip()
        context.key(keycode)
        return ActionResult.succeeded({"keycode": keycode})


class TypeTextAction(Action):
    name = "input.type_text"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        value = str(arguments["text"])
        context.type_text(value)
        return ActionResult.succeeded({"text": value, "length": len(value)})


def _tap_with_variation(context: Any, x: int, y: int, arguments: dict[str, Any]) -> tuple[int, int, float]:
    offset_limit = arguments.get("random_offset", 0)
    if isinstance(offset_limit, bool) or not isinstance(offset_limit, int) or offset_limit < 0:
        raise ValueError("random_offset must be a non-negative integer")
    if offset_limit:
        offset_x = random.randint(-offset_limit, offset_limit)
        offset_y = random.randint(-offset_limit, offset_limit)
    else:
        offset_x = offset_y = 0

    interval = arguments.get("random_interval", [0.0, 0.0])
    if not isinstance(interval, (list, tuple)) or len(interval) != 2:
        raise ValueError("random_interval must contain [minimum_seconds, maximum_seconds]")
    minimum, maximum = float(interval[0]), float(interval[1])
    if not all(math.isfinite(value) and value >= 0 for value in (minimum, maximum)) or minimum > maximum:
        raise ValueError("random_interval must contain two finite seconds with minimum <= maximum")
    interval_seconds = random.uniform(minimum, maximum) if minimum != maximum else minimum
    deadline = time.monotonic() + interval_seconds
    while True:
        context.check_cancelled()
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        time.sleep(min(0.1, remaining))

    clicked_x = x + offset_x
    clicked_y = y + offset_y
    context.tap(clicked_x, clicked_y, hold_ms=int(arguments.get("hold_ms", 0)))
    return clicked_x, clicked_y, round(interval_seconds, 6)
