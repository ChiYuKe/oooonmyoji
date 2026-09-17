"""模板与 OCR 动作：模板匹配、文字识别与等待。"""

from __future__ import annotations

import time
from typing import Any

from ..base import Action, ActionResult

class MatchTemplateAction(Action):
    name = "vision.match_template"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        matches = context.find_template(
            str(arguments["template"]),
            roi=arguments.get("roi"),
            threshold=float(arguments.get("threshold", 0.85)),
            max_results=int(arguments.get("max_results", 20)),
            scale_search=bool(arguments.get("scale_search", False)),
        )
        output = []
        for match in matches:
            value = match.to_dict()
            value["template"] = str(arguments["template"])
            value["threshold"] = float(arguments.get("threshold", 0.85))
            if arguments.get("roi") is not None:
                value["roi"] = list(arguments["roi"])
            output.append(value)
        if not output:
            return ActionResult.failed(
                f"template not matched: {arguments['template']}",
                category="not_matched",
                output=[],
            )
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
            scale_search=bool(arguments.get("scale_search", False)),
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


class WaitAnyAction(Action):
    name = "vision.wait_any"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        templates = arguments.get("templates", [])
        if not isinstance(templates, list) or not templates:
            return ActionResult.failed("templates must be a non-empty list", category="workflow")
        deadline = time.monotonic() + float(arguments["timeout_seconds"])
        threshold = float(arguments.get("threshold", 0.85))
        scale_search = bool(arguments.get("scale_search", False))
        while True:
            context.check_cancelled()
            context.capture()
            for template in templates:
                matches = context.find_template(
                    str(template),
                    roi=arguments.get("roi"),
                    threshold=threshold,
                    scale_search=scale_search,
                )
                if matches:
                    match = matches[0].to_dict()
                    match["template"] = str(template)
                    match["threshold"] = threshold
                    if arguments.get("roi") is not None:
                        match["roi"] = list(arguments["roi"])
                    return ActionResult.succeeded({
                        "template": str(template),
                        "match": match,
                        "elapsed_seconds": round(float(arguments["timeout_seconds"]) - max(0.0, deadline - time.monotonic()), 6),
                    })
            if time.monotonic() >= deadline:
                return ActionResult.failed("none of the templates matched before timeout", category="not_matched")
            time.sleep(0.1)
