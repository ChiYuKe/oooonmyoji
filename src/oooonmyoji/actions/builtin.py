"""Built-in actions exposed to JSON workflows."""

from __future__ import annotations

import math
import random
import re
import time
from typing import Any

from ..exceptions import AutomationError, CancelledError
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


class EnqueueRewardStatsAction(Action):
    """Capture and enqueue reward recognition without making statistics fatal."""

    name = "stats.enqueue_reward"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        try:
            output = context.enqueue_reward_statistics(
                category=str(arguments.get("category", "reward")),
                layer=int(arguments.get("layer", 1)),
                roi=arguments.get("roi"),
            )
        except Exception as exc:
            context.log("reward_stats.enqueue_failed", error=str(exc))
            return ActionResult.succeeded({
                "accepted": False,
                "screenshot": "",
                "battle_index": 0,
                "layer": int(arguments.get("layer", 1)),
                "error": str(exc),
            })
        return ActionResult.succeeded({**output, "error": ""})


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
        while True:
            context.check_cancelled()
            context.capture()
            for template in templates:
                matches = context.find_template(str(template), roi=arguments.get("roi"), threshold=threshold)
                if matches:
                    return ActionResult.succeeded({
                        "template": str(template),
                        "match": matches[0].to_dict(),
                        "elapsed_seconds": round(float(arguments["timeout_seconds"]) - max(0.0, deadline - time.monotonic()), 6),
                    })
            if time.monotonic() >= deadline:
                return ActionResult.failed("none of the templates matched before timeout", category="not_matched")
            time.sleep(0.1)


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


class AssignAction(Action):
    name = "core.assign"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        return ActionResult.succeeded({"name": str(arguments["name"]), "value": arguments.get("value")})


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
            "origin_x": x,
            "origin_y": y,
            "x": clicked_x,
            "y": clicked_y,
            "offset_x": clicked_x - x,
            "offset_y": clicked_y - y,
            "interval_seconds": interval_seconds,
            "revalidated": bool(arguments.get("revalidate", True)),
        })


class DismissTemplateUntilTextAction(Action):
    """Click a recurring overlay prompt until the destination page is stable."""

    name = "input.dismiss_template_until_text"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        initial_match = arguments.get("match")
        template = arguments.get("template")
        done_texts = arguments.get("done_texts")
        if not isinstance(initial_match, dict):
            return ActionResult.failed("match must be an object", category="workflow")
        if not isinstance(template, str) or not template:
            return ActionResult.failed("template must be a non-empty string", category="workflow")
        if not isinstance(done_texts, list) or not done_texts or not all(isinstance(item, str) and item for item in done_texts):
            return ActionResult.failed("done_texts must be a non-empty array of strings", category="workflow")

        timeout = float(arguments.get("timeout_seconds", 30))
        max_clicks = int(arguments.get("max_clicks", 6))
        threshold = float(arguments.get("threshold", 0.85))
        post_click_delay = float(arguments.get("post_click_delay", 0.8))
        stable_seconds = float(arguments.get("stable_seconds", 0.5))
        if timeout <= 0 or max_clicks < 1 or post_click_delay < 0 or stable_seconds < 0:
            return ActionResult.failed("timeout, max_clicks, and delays are invalid", category="workflow")
        if not 0.0 <= threshold <= 1.0:
            return ActionResult.failed("threshold must be between 0 and 1", category="workflow")

        deadline = time.monotonic() + timeout
        selected = initial_match
        clicks: list[dict[str, Any]] = []
        while True:
            context.check_cancelled()
            if time.monotonic() >= deadline:
                return ActionResult.failed("timed out dismissing template overlay", category="vision", output={"clicks": clicks})

            reference = selected.get("reference")
            if not isinstance(reference, list) or len(reference) != 4:
                return ActionResult.failed("match.reference is invalid", category="workflow")
            x = int(round(float(reference[0]) + float(reference[2]) / 2))
            y = int(round(float(reference[1]) + float(reference[3]) / 2))
            clicked_x, clicked_y, interval_seconds = _tap_with_variation(context, x, y, arguments)
            clicks.append({
                "origin_x": x,
                "origin_y": y,
                "x": clicked_x,
                "y": clicked_y,
                "offset_x": clicked_x - x,
                "offset_y": clicked_y - y,
                "interval_seconds": interval_seconds,
            })

            delay_deadline = min(deadline, time.monotonic() + post_click_delay)
            while time.monotonic() < delay_deadline:
                context.check_cancelled()
                time.sleep(min(0.1, delay_deadline - time.monotonic()))

            while time.monotonic() < deadline:
                context.check_cancelled()
                context.capture()
                matches = context.find_template(template, roi=arguments.get("template_roi"), threshold=threshold)
                if matches:
                    if len(clicks) >= max_clicks:
                        return ActionResult.failed(
                            f"template overlay remained after {max_clicks} clicks",
                            category="vision",
                            output={"clicks": clicks},
                        )
                    selected = matches[0].to_dict()
                    break

                try:
                    results = context.ocr(roi=arguments.get("done_roi"))
                except RuntimeError as exc:
                    return ActionResult.failed(str(exc), category="ocr", output={"clicks": clicks})
                matched = next((item for item in results if any(text in item.text for text in done_texts)), None)
                if matched is not None:
                    stable_deadline = min(deadline, time.monotonic() + stable_seconds)
                    while time.monotonic() < stable_deadline:
                        context.check_cancelled()
                        time.sleep(min(0.1, stable_deadline - time.monotonic()))
                    context.capture()
                    matches = context.find_template(template, roi=arguments.get("template_roi"), threshold=threshold)
                    if matches:
                        if len(clicks) >= max_clicks:
                            return ActionResult.failed(
                                f"template overlay remained after {max_clicks} clicks",
                                category="vision",
                                output={"clicks": clicks},
                            )
                        selected = matches[0].to_dict()
                        break
                    return ActionResult.succeeded({
                        "click_count": len(clicks),
                        "clicks": clicks,
                        "matched_text": matched.text,
                    })
                time.sleep(0.1)
            else:
                return ActionResult.failed("timed out dismissing template overlay", category="vision", output={"clicks": clicks})


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
        except CancelledError:
            raise
        except AutomationError as exc:
            receipt = _subworkflow_receipt(reference, "failed", None, str(exc), exc.category.value)
            return ActionResult.failed(str(exc), category=exc.category.value, output=receipt)
        receipt = _subworkflow_receipt(reference, status, output, error, error_category)
        if status == "succeeded":
            return ActionResult.succeeded(receipt)
        if status == "cancelled":
            return ActionResult.cancelled(error or "subworkflow cancelled", output=receipt)
        return ActionResult.failed(
            f"subworkflow {reference} failed: {error or 'unknown error'}",
            category=error_category or "subworkflow",
            output=receipt,
        )


class SelectWorkflowAction(Action):
    """UE 行为树 Selector 语义：按顺序尝试子工作流，一个成功即成功，全部失败才失败。"""

    name = "workflow.select"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        refs = arguments.get("workflows")
        if not isinstance(refs, list) or not refs or not all(isinstance(r, str) and r.strip() for r in refs):
            return ActionResult.failed("workflows must be a non-empty array of workflow references", category="workflow")
        inputs = arguments.get("inputs", {})
        if not isinstance(inputs, dict):
            return ActionResult.failed("inputs must be an object", category="workflow")
        attempts: list[dict[str, Any]] = []
        for reference in refs:
            try:
                status, output, error, error_category = context.run_subworkflow(reference, inputs)
            except CancelledError:
                raise
            except AutomationError as exc:
                attempts.append(_subworkflow_receipt(reference, "failed", None, str(exc), exc.category.value))
                continue
            receipt = _subworkflow_receipt(reference, status, output, error, error_category)
            attempts.append(receipt)
            if status == "succeeded":
                return ActionResult.succeeded({
                    "workflow": reference,
                    "status": "succeeded",
                    "output": output,
                    "error": None,
                    "error_category": None,
                    "attempts": attempts,
                })
            if status == "cancelled":
                return ActionResult.cancelled(
                    error or "subworkflow cancelled",
                    output={**receipt, "attempts": attempts},
                )
        final = attempts[-1]
        message = "workflow.select: all branches failed"
        return ActionResult.failed(
            message,
            category="subworkflow",
            output={
                "workflow": final["workflow"],
                "status": "failed",
                "output": final["output"],
                "error": message,
                "error_category": "subworkflow",
                "attempts": attempts,
            },
        )


class SequenceWorkflowAction(Action):
    """UE 行为树 Sequence 语义：按顺序执行子工作流，全部成功才成功，任一失败立即中止。"""

    name = "workflow.sequence"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        refs = arguments.get("workflows")
        if not isinstance(refs, list) or not refs or not all(isinstance(r, str) and r.strip() for r in refs):
            return ActionResult.failed("workflows must be a non-empty array of workflow references", category="workflow")
        inputs = arguments.get("inputs", {})
        if not isinstance(inputs, dict):
            return ActionResult.failed("inputs must be an object", category="workflow")
        attempts: list[dict[str, Any]] = []
        output: Any = None
        for reference in refs:
            try:
                status, output, error, error_category = context.run_subworkflow(reference, inputs)
            except CancelledError:
                raise
            except AutomationError as exc:
                receipt = _subworkflow_receipt(reference, "failed", None, str(exc), exc.category.value)
                attempts.append(receipt)
                message = f"workflow.sequence aborted at {reference}: {exc}"
                return ActionResult.failed(
                    message,
                    category=exc.category.value,
                    output={**receipt, "error": message, "attempts": attempts},
                )
            receipt = _subworkflow_receipt(reference, status, output, error, error_category)
            attempts.append(receipt)
            if status == "cancelled":
                return ActionResult.cancelled(
                    error or "subworkflow cancelled",
                    output={**receipt, "attempts": attempts},
                )
            if status != "succeeded":
                message = f"workflow.sequence aborted at {reference}: {error or 'failed'}"
                return ActionResult.failed(
                    message,
                    category=error_category or "subworkflow",
                    output={
                        **receipt,
                        "status": "failed",
                        "error": message,
                        "error_category": error_category or "subworkflow",
                        "attempts": attempts,
                    },
                )
        return ActionResult.succeeded({
            "workflow": refs[-1],
            "status": "succeeded",
            "output": output,
            "error": None,
            "error_category": None,
            "attempts": attempts,
        })


def _subworkflow_receipt(
    workflow: str,
    status: str,
    output: Any,
    error: str | None,
    error_category: str | None,
) -> dict[str, Any]:
    """Build the stable parent/child workflow completion contract."""

    return {
        "workflow": workflow,
        "status": status,
        "output": output,
        "error": error,
        "error_category": error_category,
    }


class WaitTextAction(Action):
    """轮询 OCR 直到指定文本出现（或消失），超时判定为失败。"""

    name = "vision.wait_text"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        text = arguments.get("text")
        if not isinstance(text, str) or not text:
            return ActionResult.failed("text must be a non-empty string", category="workflow")
        timeout = float(arguments.get("timeout_seconds", 30))
        min_confidence = float(arguments.get("min_confidence", 0.0))
        if not 0.0 <= min_confidence <= 1.0:
            return ActionResult.failed("min_confidence must be between 0 and 1", category="workflow")
        present = bool(arguments.get("present", True))
        try:
            matches = context.wait_for_text(
                text,
                timeout_seconds=timeout,
                roi=arguments.get("roi"),
                min_confidence=min_confidence,
                present=present,
            )
        except RuntimeError as exc:
            return ActionResult.failed(str(exc), category="ocr")
        except TimeoutError as exc:
            return ActionResult.failed(str(exc), category="vision")
        return ActionResult.succeeded({"matched": len(matches), "text": text, "present": present})


class WaitAnyTextAction(Action):
    """轮询 OCR，直到任一候选文本出现或全部消失。"""

    name = "vision.wait_any_text"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        texts = arguments.get("texts")
        if not isinstance(texts, list) or not texts or not all(isinstance(item, str) and item for item in texts):
            return ActionResult.failed("texts must be a non-empty array of strings", category="workflow")
        timeout = float(arguments.get("timeout_seconds", 30))
        min_confidence = float(arguments.get("min_confidence", 0.0))
        if not 0.0 <= min_confidence <= 1.0:
            return ActionResult.failed("min_confidence must be between 0 and 1", category="workflow")
        present = bool(arguments.get("present", True))
        allow_timeout = bool(arguments.get("allow_timeout", False))
        deadline = time.monotonic() + timeout
        while True:
            context.check_cancelled()
            try:
                results = context.ocr(roi=arguments.get("roi"))
            except RuntimeError as exc:
                return ActionResult.failed(str(exc), category="ocr")
            matched = next(
                (result for result in results if any(text in result.text for text in texts) and result.confidence >= min_confidence),
                None,
            )
            if (matched is not None) is present:
                return ActionResult.succeeded({
                    "matched_text": matched.text if matched is not None else "",
                    "confidence": matched.confidence if matched is not None else 0.0,
                    "present": present,
                })
            if time.monotonic() >= deadline:
                state = "appear" if present else "disappear"
                if allow_timeout:
                    return ActionResult.succeeded({
                        "matched_text": "",
                        "confidence": 0.0,
                        # A timeout means the requested state was not observed.
                        # For disappearance waits, the last known state remains present.
                        "present": False if present else True,
                        "timed_out": True,
                    })
                return ActionResult.failed(f"timed out waiting for OCR text to {state}: {texts}", category="vision")
            time.sleep(0.1)


class ReadRealmPassCountAction(Action):
    """读取结界突破券数量；识别失败时返回 skip，避免误停御魂。"""

    name = "realm.read_pass_count"

    _number = re.compile(r"(?<!\d)(\d{1,4})(?!\d)")

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        minimum = int(arguments.get("minimum_passes", 1))
        if minimum < 0:
            return ActionResult.failed("minimum_passes must be non-negative", category="workflow")
        key_texts = arguments.get("key_texts", ["结界突破", "突破券", "结界券"])
        if not isinstance(key_texts, list) or not all(isinstance(item, str) for item in key_texts):
            return ActionResult.failed("key_texts must be an array of strings", category="workflow")
        try:
            results = context.ocr(roi=arguments.get("roi"))
        except RuntimeError as exc:
            context.log("realm.pass_count_unavailable", error=str(exc))
            return ActionResult.succeeded({"passes": 0, "detected": False, "should_enter": False, "mode": "skip", "raw_text": ""})
        text = " ".join(result.text for result in results)
        numbers: list[int] = []
        for result in results:
            numbers.extend(int(value) for value in ReadRealmPassCountAction._number.findall(result.text))
        # Prefer numbers located in the same OCR item as a known label. If OCR
        # split the label and number into separate items, use the first small
        # count in the configured ROI as a conservative fallback.
        labelled = [
            int(value)
            for result in results
            if any(label in result.text for label in key_texts)
            for value in ReadRealmPassCountAction._number.findall(result.text)
        ]
        passes = labelled[0] if labelled else (numbers[0] if numbers else 0)
        return ActionResult.succeeded({
            "passes": passes,
            "detected": bool(numbers),
            "should_enter": bool(numbers) and passes >= minimum,
            "mode": "run" if bool(numbers) and passes >= minimum else "skip",
            "raw_text": text,
        })


class DetectRealmProgressAction(Action):
    """检测当前页 9 个目标的完成态并返回断点。"""

    name = "realm.detect_progress"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        rois = arguments.get("target_rois")
        if not isinstance(rois, list) or len(rois) != 9 or not all(isinstance(roi, list) and len(roi) == 4 for roi in rois):
            return ActionResult.failed("target_rois must contain exactly 9 rects", category="workflow")
        completed_texts = arguments.get("completed_texts", ["已挑战", "已击败", "胜利", "占领", "破"])
        templates = arguments.get("completed_templates", [])
        if not isinstance(completed_texts, list) or not all(isinstance(item, str) and item for item in completed_texts):
            return ActionResult.failed("completed_texts must be an array of strings", category="workflow")
        if not isinstance(templates, list) or not all(isinstance(item, str) and item for item in templates):
            return ActionResult.failed("completed_templates must be an array of assets", category="workflow")
        min_confidence = float(arguments.get("min_confidence", 0.45))
        if not 0.0 <= min_confidence <= 1.0:
            return ActionResult.failed("min_confidence must be between 0 and 1", category="workflow")
        # The page title ROI only covers the header.  Scan the union of all
        # target cards instead so completion stamps at the card's right edge
        # are visible, while retaining the caller's per-card ROIs for matching.
        scan_roi = arguments.get("progress_roi")
        if scan_roi is None:
            coordinates = [tuple(int(value) for value in roi) for roi in rois]
            bounds = list(zip(*coordinates))
            min_x = min(bounds[0])
            min_y = min(bounds[1])
            max_x = max(x + width for x, _, width, _ in coordinates)
            max_y = max(y + height for _, y, _, height in coordinates)
            padding = 96
            scan_roi = [max(0, min_x - padding), max(0, min_y - padding), max_x - min_x + padding * 2, max_y - min_y + padding * 2]
        try:
            context.capture()
            ocr_items = context.ocr(roi=scan_roi)
        except RuntimeError as exc:
            context.log("realm.progress_unavailable", error=str(exc))
            return ActionResult.succeeded({
                "detected": False,
                "completed": [False] * 9,
                "completed_count": 0,
                "next_index": 1,
                "source": "unavailable",
                "evidence": [[] for _ in range(9)],
            })
        completed = [False] * 9
        evidence: list[list[str]] = [[] for _ in range(9)]
        # "破" is the game's standard completed-card stamp.  Keep it enabled
        # even for older workflow files whose public text list predates it.
        effective_completed_texts = list(dict.fromkeys([*completed_texts, "破"]))
        for index, roi in enumerate(rois):
            x, y, width, height = (int(value) for value in roi)
            for item in ocr_items:
                if item.confidence < min_confidence:
                    continue
                if x <= item.x <= x + width and y <= item.y <= y + height and any(text in item.text for text in effective_completed_texts):
                    completed[index] = True
                    evidence[index].append(item.text)
            for template in templates:
                try:
                    if context.find_template(template, roi=roi, threshold=min_confidence):
                        completed[index] = True
                        evidence[index].append(template)
                except (OSError, ValueError):
                    continue
        completed_count = sum(completed)
        next_index = next((index + 1 for index, value in enumerate(completed) if not value), 9)
        return ActionResult.succeeded({
            "detected": any(completed),
            "completed": completed,
            "completed_count": completed_count,
            "next_index": next_index,
            "source": "ocr_or_template",
            "evidence": evidence,
        })


# Action parameter metadata now lives in the shared manifest files under
# ``src/oooonmyoji/actions/manifests/*.json`` (one per Action, consumed by both
# the Python runtime and the TypeScript editor). This module only implements the
# Action classes; ``build_action_registry`` resolves ``builtin:<ClassName>``
# entries against the classes defined here.

__all__ = [
    "AssertAction",
    "CaptureAction",
    "EnqueueRewardStatsAction",
    "LogAction",
    "MatchTemplateAction",
    "OcrAction",
    "RunWorkflowAction",
    "SaveFrameAction",
    "SelectWorkflowAction",
    "SequenceWorkflowAction",
    "SleepAction",
    "TapAction",
    "TapMatchAction",
    "WaitTemplateAction",
    "WaitTextAction",
    "WaitAnyTextAction",
    "ReadRealmPassCountAction",
    "DetectRealmProgressAction",
    "DismissTemplateUntilTextAction",
]
