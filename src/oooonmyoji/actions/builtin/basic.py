"""基础动作：截图、保存现场图、等待、日志与断言。"""

from __future__ import annotations

import time
from typing import Any

from ..base import Action, ActionResult

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
