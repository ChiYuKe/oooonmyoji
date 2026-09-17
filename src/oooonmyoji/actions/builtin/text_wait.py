"""文字等待动作：等待文字与等待任一文字。"""

from __future__ import annotations

import time
from typing import Any

from ..base import Action, ActionResult

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


# Action parameter metadata now lives in the shared manifest files under
# ``src/oooonmyoji/actions/manifests/*.json`` (one per Action, consumed by both
# the Python runtime and the TypeScript editor). This module only implements the
# Action classes; ``build_action_registry`` resolves ``builtin:<ClassName>``
# entries against the classes defined here.
