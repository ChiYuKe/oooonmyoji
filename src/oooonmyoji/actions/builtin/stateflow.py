"""状态流动作：点击匹配项、点模板关闭与页面状态恢复。"""

from __future__ import annotations

import time
from typing import Any

from ..base import Action, ActionResult
from .input import _tap_with_variation
from .detection import _capture_state, _detect_state_current, _ocr_current, _state_candidates

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
                disappeared_states = arguments.get("disappeared_states", [])
                if disappeared_states:
                    try:
                        candidates = _state_candidates(disappeared_states)
                    except ValueError as exc:
                        return ActionResult.failed(str(exc), category="workflow")
                    disappeared_timeout = float(arguments.get("disappeared_state_timeout_seconds", 0.0))
                    if disappeared_timeout < 0:
                        return ActionResult.failed("disappeared_state_timeout_seconds must be non-negative", category="workflow")
                    disappeared_deadline = time.monotonic() + disappeared_timeout
                    while True:
                        detected = _detect_state_current(context, candidates, allow_ocr=False)
                        if detected is not None:
                            return ActionResult.succeeded({
                                "origin_x": 0,
                                "origin_y": 0,
                                "x": 0,
                                "y": 0,
                                "offset_x": 0,
                                "offset_y": 0,
                                "interval_seconds": 0.0,
                                "revalidated": True,
                                "skipped": True,
                                "final_state": detected["state"],
                            })
                        if time.monotonic() >= disappeared_deadline:
                            break
                        context.check_cancelled()
                        time.sleep(min(0.1, max(0.0, disappeared_deadline - time.monotonic())))
                        context.capture()
                return ActionResult.failed("template match is no longer present", category="vision")
            selected = matches[0].to_dict()
        reference = selected.get("reference")
        if not isinstance(reference, list) or len(reference) != 4:
            return ActionResult.failed("match.reference is invalid", category="workflow")
        x = int(round(float(reference[0]) + float(reference[2]) / 2))
        y = int(round(float(reference[1]) + float(reference[3]) / 2))
        clicked_x, clicked_y, interval_seconds = _tap_with_variation(context, x, y, arguments)
        verified_gone = False
        if bool(arguments.get("verify_gone", False)):
            verify_template = selected.get("template") or match.get("template")
            if not isinstance(verify_template, str) or not verify_template:
                return ActionResult.failed(
                    "verify_gone requires match.template",
                    category="workflow",
                )
            verify_timeout = float(arguments.get("verify_timeout_seconds", 8.0))
            if verify_timeout < 0:
                return ActionResult.failed(
                    "verify_timeout_seconds must be non-negative",
                    category="workflow",
                )
            # 优先使用匹配结果自带的阈值，其次回退到入参阈值，最后用默认值。
            verify_threshold_raw = selected.get("threshold", match.get("threshold", 0.85))
            verify_threshold = float(verify_threshold_raw) if verify_threshold_raw is not None else 0.85
            if not 0.0 <= verify_threshold <= 1.0:
                return ActionResult.failed(
                    "match threshold must be between 0 and 1",
                    category="workflow",
                )
            verify_roi = selected.get("roi", match.get("roi"))
            verify_deadline = time.monotonic() + verify_timeout
            while True:
                context.check_cancelled()
                context.capture()
                if not context.find_template(verify_template, roi=verify_roi, threshold=verify_threshold):
                    verified_gone = True
                    break
                if time.monotonic() >= verify_deadline:
                    return ActionResult.failed(
                        "tap completed but matched template did not disappear",
                        category="vision",
                        output={
                            "origin_x": x,
                            "origin_y": y,
                            "x": clicked_x,
                            "y": clicked_y,
                            "offset_x": clicked_x - x,
                            "offset_y": clicked_y - y,
                            "interval_seconds": interval_seconds,
                            "revalidated": bool(arguments.get("revalidate", True)),
                            "skipped": False,
                            "final_state": "",
                            "verified_gone": False,
                        },
                    )
                time.sleep(min(0.1, max(0.0, verify_deadline - time.monotonic())))
        return ActionResult.succeeded({
            "origin_x": x,
            "origin_y": y,
            "x": clicked_x,
            "y": clicked_y,
            "offset_x": clicked_x - x,
            "offset_y": clicked_y - y,
            "interval_seconds": interval_seconds,
            "revalidated": bool(arguments.get("revalidate", True)),
            "skipped": False,
            "final_state": "",
            "verified_gone": verified_gone,
        })


class DismissTemplateUntilTextAction(Action):
    """Click a recurring overlay until a configured template or text state is stable."""

    name = "input.dismiss_template_until_text"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        initial_match = arguments.get("match")
        template = arguments.get("template")
        done_texts = arguments.get("done_texts", [])
        try:
            done_states = _state_candidates(arguments["done_states"]) if arguments.get("done_states") else []
        except ValueError as exc:
            return ActionResult.failed(str(exc), category="workflow")
        if not isinstance(initial_match, dict):
            return ActionResult.failed("match must be an object", category="workflow")
        if not isinstance(template, str) or not template:
            return ActionResult.failed("template must be a non-empty string", category="workflow")
        if not isinstance(done_texts, list) or not all(isinstance(item, str) and item for item in done_texts):
            return ActionResult.failed("done_texts must be an array of non-empty strings", category="workflow")
        if not done_texts and not done_states:
            return ActionResult.failed("done_texts or done_states must be configured", category="workflow")

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

                if done_states:
                    try:
                        detected = _detect_state_current(
                            context,
                            done_states,
                            allow_ocr=bool(arguments.get("allow_ocr", True)),
                        )
                    except RuntimeError as exc:
                        return ActionResult.failed(str(exc), category="ocr", output={"clicks": clicks})
                    if detected is not None:
                        stable_deadline = min(deadline, time.monotonic() + stable_seconds)
                        while time.monotonic() < stable_deadline:
                            context.check_cancelled()
                            time.sleep(min(0.1, stable_deadline - time.monotonic()))
                        confirmed = _capture_state(
                            context,
                            done_states,
                            allow_ocr=bool(arguments.get("allow_ocr", True)),
                        )
                        if confirmed is not None and confirmed["state"] == detected["state"]:
                            return ActionResult.succeeded({
                                "click_count": len(clicks),
                                "clicks": clicks,
                                "matched_text": "",
                                "final_state": confirmed["state"],
                                "source": confirmed["source"],
                                "confidence": confirmed["confidence"],
                            })

                try:
                    results = _ocr_current(context, arguments.get("done_roi")) if done_texts else []
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
                        "final_state": "",
                        "source": "ocr",
                        "confidence": float(getattr(matched, "confidence", 0.0)),
                    })
                time.sleep(0.1)
            else:
                return ActionResult.failed("timed out dismissing template overlay", category="vision", output={"clicks": clicks})


def _recovery_failure(context: Any, message: str, output: dict[str, Any], arguments: dict[str, Any]) -> ActionResult:
    try:
        frame = context.last_frame
        if frame is None:
            frame = context.capture()
        saved = context.save_frame(frame, str(arguments.get("failure_frame_name", "recovery-failure.png")))
        output["failure_frame"] = str(saved)
    except Exception as exc:
        output["failure_frame"] = ""
        output["failure_frame_error"] = str(exc)
    return ActionResult.failed(message, category="recovery", output=output)


def _sleep_cancelled(context: Any, seconds: float, deadline: float) -> None:
    end = min(deadline, time.monotonic() + max(0.0, seconds))
    while time.monotonic() < end:
        context.check_cancelled()
        time.sleep(min(0.1, max(0.0, end - time.monotonic())))


class RecoverStateAction(Action):
    """Recover a known UI state using bounded, confirmed transitions."""

    name = "input.recover_state"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        started = time.monotonic()
        try:
            states = _state_candidates(arguments.get("states"))
        except ValueError as exc:
            return ActionResult.failed(str(exc), category="workflow")
        targets = arguments.get("target_states")
        transitions = arguments.get("transitions")
        overlay_states = arguments.get("overlay_states", [])
        if not isinstance(targets, list) or not targets or not all(isinstance(item, str) and item for item in targets):
            return ActionResult.failed("target_states must be a non-empty array of strings", category="workflow")
        if not isinstance(transitions, list) or not all(isinstance(item, dict) for item in transitions):
            return ActionResult.failed("transitions must be an array of objects", category="workflow")
        if not isinstance(overlay_states, list) or not all(isinstance(item, str) and item for item in overlay_states):
            return ActionResult.failed("overlay_states must be an array of strings", category="workflow")

        state_names = {candidate["name"] for candidate in states}
        if not set(targets).issubset(state_names) or not set(overlay_states).issubset(state_names):
            return ActionResult.failed("target_states and overlay_states must reference configured states", category="workflow")
        by_source: dict[str, dict[str, Any]] = {}
        for index, transition in enumerate(transitions):
            source = transition.get("from")
            kind = transition.get("type")
            if not isinstance(source, str) or source not in state_names:
                return ActionResult.failed(f"transitions[{index}].from is not a configured state", category="workflow")
            if source in by_source:
                return ActionResult.failed(f"duplicate recovery transition for state: {source}", category="workflow")
            if kind not in {"tap_match", "tap_template", "tap", "key"}:
                return ActionResult.failed(f"transitions[{index}].type is invalid", category="workflow")
            retry_unchanged = transition.get("retry_if_unchanged_seconds")
            if retry_unchanged is not None and (
                isinstance(retry_unchanged, bool)
                or not isinstance(retry_unchanged, (int, float))
                or float(retry_unchanged) < 0
            ):
                return ActionResult.failed(
                    f"transitions[{index}].retry_if_unchanged_seconds must be non-negative",
                    category="workflow",
                )
            by_source[source] = transition

        timeout = float(arguments.get("timeout_seconds", 15.0))
        confirm_timeout = float(arguments.get("confirm_timeout_seconds", 5.0))
        poll_interval = float(arguments.get("poll_interval_seconds", 0.1))
        post_action_delay = float(arguments.get("post_action_delay", 0.35))
        max_returns = int(arguments.get("max_return_attempts", 3))
        max_overlays = int(arguments.get("max_overlay_clicks", 6))
        max_transitions = int(arguments.get("max_transitions", 12))
        if min(timeout, confirm_timeout) <= 0 or poll_interval < 0 or post_action_delay < 0:
            return ActionResult.failed("recovery timeouts and delays are invalid", category="workflow")
        if min(max_returns, max_overlays, max_transitions) < 1:
            return ActionResult.failed("recovery limits must be positive", category="workflow")

        deadline = started + timeout
        allow_ocr = bool(arguments.get("allow_ocr", True))
        actions: list[dict[str, Any]] = []
        return_attempts = 0
        overlay_clicks = 0
        transition_count = 0
        initial_state_timeout = float(arguments.get("initial_state_timeout_seconds", 0.0))
        if initial_state_timeout < 0:
            return ActionResult.failed("initial_state_timeout_seconds must be non-negative", category="workflow")
        initial_deadline = min(deadline, time.monotonic() + initial_state_timeout)
        detected: dict[str, Any] | None = None
        while True:
            detected = _capture_state(context, states, allow_ocr=False)
            if detected is not None or time.monotonic() >= initial_deadline:
                break
            _sleep_cancelled(context, poll_interval, initial_deadline)
        if detected is None and allow_ocr:
            detected = _detect_state_current(context, states, allow_ocr=True)
        if detected is None:
            return _recovery_failure(context, "current page is not a configured state", {
                "state": "", "source": "none", "confidence": 0.0, "actions": actions,
                "return_attempts": return_attempts, "overlay_clicks": overlay_clicks,
                "elapsed_seconds": round(time.monotonic() - started, 6),
            }, arguments)

        while True:
            context.check_cancelled()
            state = str(detected["state"])
            if state in targets:
                return ActionResult.succeeded({
                    **detected,
                    "actions": actions,
                    "return_attempts": return_attempts,
                    "overlay_clicks": overlay_clicks,
                    "elapsed_seconds": round(time.monotonic() - started, 6),
                    "failure_frame": "",
                })
            transition = by_source.get(state)
            if transition is None:
                return _recovery_failure(context, f"no recovery transition is configured for state: {state}", {
                    **detected, "actions": actions, "return_attempts": return_attempts,
                    "overlay_clicks": overlay_clicks, "elapsed_seconds": round(time.monotonic() - started, 6),
                }, arguments)
            if transition_count >= max_transitions:
                return _recovery_failure(context, f"recovery exceeded {max_transitions} confirmed transitions", {
                    **detected, "actions": actions, "return_attempts": return_attempts,
                    "overlay_clicks": overlay_clicks, "elapsed_seconds": round(time.monotonic() - started, 6),
                }, arguments)

            is_overlay = state in overlay_states
            is_return = bool(transition.get("return_action", False))
            if is_overlay and overlay_clicks >= max_overlays:
                return _recovery_failure(context, f"overlay remained after {max_overlays} clicks", {
                    **detected, "actions": actions, "return_attempts": return_attempts,
                    "overlay_clicks": overlay_clicks, "elapsed_seconds": round(time.monotonic() - started, 6),
                }, arguments)
            if is_return and return_attempts >= max_returns:
                return _recovery_failure(context, f"recovery exceeded {max_returns} return attempts", {
                    **detected, "actions": actions, "return_attempts": return_attempts,
                    "overlay_clicks": overlay_clicks, "elapsed_seconds": round(time.monotonic() - started, 6),
                }, arguments)

            kind = str(transition["type"])
            action_record: dict[str, Any] = {"from": state, "type": kind}
            if kind == "tap_match":
                reference = detected.get("match", {}).get("reference")
                if not isinstance(reference, list) or len(reference) != 4:
                    return _recovery_failure(context, f"state {state} has no clickable match", {
                        **detected, "actions": actions, "return_attempts": return_attempts,
                        "overlay_clicks": overlay_clicks, "elapsed_seconds": round(time.monotonic() - started, 6),
                    }, arguments)
                x = int(round(float(reference[0]) + float(reference[2]) / 2))
                y = int(round(float(reference[1]) + float(reference[3]) / 2))
                clicked_x, clicked_y, interval = _tap_with_variation(context, x, y, arguments)
                action_record.update({"x": clicked_x, "y": clicked_y, "interval_seconds": interval})
            elif kind == "tap_template":
                template = transition.get("template")
                if not isinstance(template, str) or not template:
                    return ActionResult.failed(f"transition for {state} requires template", category="workflow")
                context.capture()
                matches = context.find_template(
                    template,
                    roi=transition.get("roi"),
                    threshold=float(transition.get("threshold", 0.85)),
                    scale_search=bool(transition.get("scale_search", False)),
                )
                if not matches:
                    return _recovery_failure(context, f"transition template is absent for state: {state}", {
                        **detected, "actions": actions, "return_attempts": return_attempts,
                        "overlay_clicks": overlay_clicks, "elapsed_seconds": round(time.monotonic() - started, 6),
                    }, arguments)
                reference = matches[0].to_dict()["reference"]
                x = int(round(float(reference[0]) + float(reference[2]) / 2))
                y = int(round(float(reference[1]) + float(reference[3]) / 2))
                clicked_x, clicked_y, interval = _tap_with_variation(context, x, y, arguments)
                action_record.update({"x": clicked_x, "y": clicked_y, "template": template, "interval_seconds": interval})
            elif kind == "tap":
                if isinstance(transition.get("x"), bool) or not isinstance(transition.get("x"), int):
                    return ActionResult.failed(f"transition for {state} requires integer x/y", category="workflow")
                if isinstance(transition.get("y"), bool) or not isinstance(transition.get("y"), int):
                    return ActionResult.failed(f"transition for {state} requires integer x/y", category="workflow")
                clicked_x, clicked_y, interval = _tap_with_variation(
                    context, int(transition["x"]), int(transition["y"]), arguments,
                )
                action_record.update({"x": clicked_x, "y": clicked_y, "interval_seconds": interval})
            else:
                keycode = transition.get("keycode")
                if not isinstance(keycode, str) or not keycode:
                    return ActionResult.failed(f"transition for {state} requires keycode", category="workflow")
                context.key(keycode)
                action_record["keycode"] = keycode

            transition_count += 1
            if is_overlay:
                overlay_clicks += 1
            if is_return:
                return_attempts += 1
            actions.append(action_record)
            _sleep_cancelled(context, post_action_delay, deadline)

            confirmation_deadline = min(deadline, time.monotonic() + confirm_timeout)
            confirmation_started = time.monotonic()
            confirmed: dict[str, Any] | None = None
            while time.monotonic() < confirmation_deadline:
                # Actions commonly enter a short loading animation. Template-only
                # polling keeps that transient state cheap and lets the next real
                # page appear; OCR fallback is reserved for initial recognition.
                confirmed = _capture_state(context, states, allow_ocr=False)
                retry_unchanged = transition.get("retry_if_unchanged_seconds")
                if (
                    confirmed is not None
                    and not is_overlay
                    and confirmed["state"] == state
                    and retry_unchanged is not None
                    and time.monotonic() - confirmation_started >= float(retry_unchanged)
                ):
                    action_record["retry_reason"] = "state_unchanged"
                    break
                expected = transition.get("expected_states", [])
                expected_ok = not expected or (isinstance(expected, list) and confirmed is not None and confirmed["state"] in expected)
                changed = confirmed is not None and (is_overlay or confirmed["state"] != state)
                if confirmed is not None and expected_ok and changed:
                    break
                confirmed = None
                _sleep_cancelled(context, poll_interval, confirmation_deadline)
            if confirmed is None:
                return _recovery_failure(context, f"state did not change after recovery action from: {state}", {
                    **detected, "actions": actions, "return_attempts": return_attempts,
                    "overlay_clicks": overlay_clicks, "elapsed_seconds": round(time.monotonic() - started, 6),
                }, arguments)
            action_record["to"] = confirmed["state"]
            detected = confirmed



