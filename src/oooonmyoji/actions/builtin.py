"""Built-in actions exposed to JSON workflows."""

from __future__ import annotations

import math
import random
import time
from typing import Any

from ..exceptions import CancelledError, VisionError, WorkflowError
from .base import Action, ActionResult


class CaptureAction(Action):
    name = "core.capture"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        frame = context.capture()
        return ActionResult.succeeded({"width": frame.width, "height": frame.height})


class SaveFrameAction(Action):
    name = "core.save_frame"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        frame = context.last_frame
        if frame is None:
            return ActionResult.failed("no captured frame is available", category="workflow")
        path = context.save_frame(frame, str(arguments["name"]))
        return ActionResult.succeeded({"path": str(path)})


class SleepAction(Action):
    name = "core.sleep"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        deadline = time.monotonic() + float(arguments["seconds"])
        while time.monotonic() < deadline:
            context.check_cancelled()
            time.sleep(min(0.1, max(0.0, deadline - time.monotonic())))
        return ActionResult.succeeded({"seconds": float(arguments["seconds"])})


class LogAction(Action):
    name = "core.log"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        fields = arguments.get("fields", {})
        context.log(str(arguments["message"]), **fields)
        return ActionResult.succeeded({"message": str(arguments["message"])})


class AssertAction(Action):
    name = "core.assert"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        if bool(arguments.get("value")):
            return ActionResult.succeeded({"asserted": True})
        return ActionResult.failed(str(arguments.get("message", "workflow assertion failed")), category="assertion")


class MatchTemplateAction(Action):
    name = "vision.match_template"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        matches = context.find_template(
            str(arguments["template"]),
            roi=arguments.get("roi"),
            threshold=float(arguments.get("threshold", 0.85)),
            max_results=int(arguments.get("max_results", 20)),
        )
        output = []
        for match in matches:
            value = match.to_dict()
            value["template"] = str(arguments["template"])
            value["threshold"] = float(arguments.get("threshold", 0.85))
            if arguments.get("roi") is not None:
                value["roi"] = list(arguments["roi"])
            output.append(value)
        return ActionResult.succeeded(output)


class OcrAction(Action):
    name = "vision.ocr"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        return ActionResult.succeeded([item.to_dict() for item in context.ocr(roi=arguments.get("roi"))])


class WaitTemplateAction(Action):
    name = "vision.wait_template"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        matches = context.wait_for(
            str(arguments["template"]),
            timeout_seconds=float(arguments["timeout_seconds"]),
            present=bool(arguments.get("present", True)),
            roi=arguments.get("roi"),
            threshold=float(arguments.get("threshold", 0.85)),
        )
        return ActionResult.succeeded([match.to_dict() for match in matches])


class TapAction(Action):
    name = "input.tap"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        x = int(arguments["x"])
        y = int(arguments["y"])
        clicked_x, clicked_y, interval_seconds = _tap_with_variation(context, x, y, arguments)
        return ActionResult.succeeded({
            "x": clicked_x,
            "y": clicked_y,
            "offset_x": clicked_x - x,
            "offset_y": clicked_y - y,
            "interval_seconds": interval_seconds,
        })


class TapMatchAction(Action):
    name = "input.tap_match"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        match = arguments["match"]
        if not isinstance(match, dict):
            return ActionResult.failed("match must be an object", category="workflow")
        selected = match
        if bool(arguments.get("revalidate", True)):
            template = match.get("template")
            if not isinstance(template, str):
                return ActionResult.failed("revalidation requires match.template", category="workflow")
            context.capture()
            matches = context.find_template(template, roi=match.get("roi"), threshold=float(match.get("threshold", 0.85)))
            if not matches:
                return ActionResult.failed("template match is no longer present", category="vision")
            selected = matches[0].to_dict()
        reference = selected.get("reference")
        if not isinstance(reference, list) or len(reference) != 4:
            return ActionResult.failed("match.reference is invalid", category="workflow")
        x = int(round(float(reference[0]) + float(reference[2]) / 2))
        y = int(round(float(reference[1]) + float(reference[3]) / 2))
        clicked_x, clicked_y, interval_seconds = _tap_with_variation(context, x, y, arguments)
        return ActionResult.succeeded({
            "x": clicked_x,
            "y": clicked_y,
            "offset_x": clicked_x - x,
            "offset_y": clicked_y - y,
            "interval_seconds": interval_seconds,
            "revalidated": bool(arguments.get("revalidate", True)),
        })


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


class RunWorkflowAction(Action):
    """运行另一个工作流（脚本嵌套调用），并把子脚本的“回执”作为步骤输出返回。"""

    name = "workflow.run"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        reference = arguments.get("workflow")
        if not isinstance(reference, str) or not reference.strip():
            return ActionResult.failed("workflow must be a workflow id or path below workflows/", category="workflow")
        inputs = arguments.get("inputs", {})
        if not isinstance(inputs, dict):
            return ActionResult.failed("inputs must be an object", category="workflow")
        try:
            status, output, error, error_category = context.run_subworkflow(reference, inputs)
        except WorkflowError as exc:
            return ActionResult.failed(str(exc), category=exc.category.value, output={"workflow": reference, "status": "failed"})
        receipt = {"workflow": reference, "status": status, "output": output}
        if status == "succeeded":
            return ActionResult.succeeded(receipt)
        if status == "cancelled":
            return ActionResult.cancelled(error or "subworkflow cancelled")
        return ActionResult.failed(
            f"subworkflow {reference} failed: {error or 'unknown error'}",
            category=error_category or "subworkflow",
            output=receipt,
        )


BUILTIN_ACTIONS: tuple[tuple[Action, dict[str, Any], dict[str, Any], bool, bool], ...] = (
    (CaptureAction(), {"type": "object", "additionalProperties": False}, {"type": "object"}, True, False),
    (SaveFrameAction(), {"type": "object", "required": ["name"], "properties": {"name": {"type": "string", "minLength": 1}}, "additionalProperties": False}, {"type": "object"}, True, False),
    (SleepAction(), {"type": "object", "required": ["seconds"], "properties": {"seconds": {"type": "number", "minimum": 0}}, "additionalProperties": False}, {"type": "object"}, True, False),
    (LogAction(), {"type": "object", "required": ["message"], "properties": {"message": {"type": "string"}, "fields": {"type": "object"}}, "additionalProperties": False}, {"type": "object"}, True, False),
    (AssertAction(), {"type": "object", "required": ["value"], "properties": {"value": {}, "message": {"type": "string"}}, "additionalProperties": False}, {"type": "object"}, True, False),
    (MatchTemplateAction(), {"type": "object", "required": ["template"], "properties": {"template": {"type": "string"}, "roi": {"type": "array", "items": {"type": "integer"}, "minItems": 4, "maxItems": 4}, "threshold": {"type": "number", "minimum": 0, "maximum": 1}, "max_results": {"type": "integer", "minimum": 1}}, "additionalProperties": False}, {"type": "array"}, True, False),
    (OcrAction(), {"type": "object", "properties": {"roi": {"type": "array", "items": {"type": "integer"}, "minItems": 4, "maxItems": 4}}, "additionalProperties": False}, {"type": "array"}, True, False),
    (WaitTemplateAction(), {"type": "object", "required": ["template", "timeout_seconds"], "properties": {"template": {"type": "string"}, "timeout_seconds": {"type": "number", "minimum": 0}, "present": {"type": "boolean"}, "roi": {"type": "array", "items": {"type": "integer"}, "minItems": 4, "maxItems": 4}, "threshold": {"type": "number", "minimum": 0, "maximum": 1}}, "additionalProperties": False}, {"type": "array"}, True, False),
    (TapAction(), {"type": "object", "required": ["x", "y"], "properties": {"x": {"type": "number"}, "y": {"type": "number"}, "hold_ms": {"type": "integer", "minimum": 0}, "random_offset": {"type": "integer", "minimum": 0}, "random_interval": {"type": "array", "prefixItems": [{"type": "number", "minimum": 0}, {"type": "number", "minimum": 0}], "minItems": 2, "maxItems": 2}}, "additionalProperties": False}, {"type": "object"}, False, True),
    (TapMatchAction(), {"type": "object", "required": ["match"], "properties": {"match": {"type": "object"}, "revalidate": {"type": "boolean"}, "hold_ms": {"type": "integer", "minimum": 0}, "random_offset": {"type": "integer", "minimum": 0}, "random_interval": {"type": "array", "prefixItems": [{"type": "number", "minimum": 0}, {"type": "number", "minimum": 0}], "minItems": 2, "maxItems": 2}}, "additionalProperties": False}, {"type": "object"}, False, True),
    (RunWorkflowAction(), {"type": "object", "required": ["workflow"], "properties": {"workflow": {"type": "string", "minLength": 1}, "inputs": {"type": "object"}}, "additionalProperties": False}, {"type": "object"}, False, True),
)


__all__ = ["BUILTIN_ACTIONS"]
