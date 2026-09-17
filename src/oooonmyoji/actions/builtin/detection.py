"""状态检测：候选状态解析、OCR 匹配与当前状态捕获。"""

from __future__ import annotations

import time
from typing import Any

from ..base import Action, ActionResult

def _state_candidates(value: object) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        raise ValueError("states must be a non-empty array")
    candidates: list[dict[str, Any]] = []
    names: set[str] = set()
    for index, raw in enumerate(value):
        if not isinstance(raw, dict):
            raise ValueError(f"states[{index}] must be an object")
        name = raw.get("name")
        template = raw.get("template")
        texts = raw.get("texts", [])
        if not isinstance(name, str) or not name:
            raise ValueError(f"states[{index}].name must be a non-empty string")
        if name in names:
            raise ValueError(f"duplicate state name: {name}")
        if template is not None and (not isinstance(template, str) or not template):
            raise ValueError(f"states[{index}].template must be a non-empty string")
        if not isinstance(texts, list) or not all(isinstance(text, str) and text for text in texts):
            raise ValueError(f"states[{index}].texts must be an array of non-empty strings")
        if template is None and not texts:
            raise ValueError(f"states[{index}] requires template or texts")
        threshold = float(raw.get("threshold", 0.85))
        min_confidence = float(raw.get("min_confidence", 0.0))
        if not 0.0 <= threshold <= 1.0 or not 0.0 <= min_confidence <= 1.0:
            raise ValueError(f"states[{index}] confidence thresholds must be between 0 and 1")
        names.add(name)
        candidates.append(raw)
    return candidates


def _ocr_current(context: Any, roi: object) -> list[Any]:
    method = getattr(context, "ocr_current", None)
    if callable(method):
        return method(roi=roi)
    return context.ocr(roi=roi)


def _ocr_match(item: Any) -> dict[str, Any]:
    if hasattr(item, "to_dict"):
        value = dict(item.to_dict())
    else:
        value = {
            "text": str(getattr(item, "text", "")),
            "confidence": round(float(getattr(item, "confidence", 0.0)), 6),
        }
    box = value.get("box")
    if isinstance(box, list) and box:
        points = [point for point in box if isinstance(point, list) and len(point) >= 2]
        if points:
            xs = [float(point[0]) for point in points]
            ys = [float(point[1]) for point in points]
            value["reference"] = [min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)]
    elif hasattr(item, "x") and hasattr(item, "y"):
        value["reference"] = [float(item.x), float(item.y), 0.0, 0.0]
    return value


def _detect_state_current(context: Any, candidates: list[dict[str, Any]], *, allow_ocr: bool) -> dict[str, Any] | None:
    template_hits: list[dict[str, Any]] = []
    for candidate in candidates:
        template = candidate.get("template")
        if not isinstance(template, str):
            continue
        matches = context.find_template(
            template,
            roi=candidate.get("roi"),
            threshold=float(candidate.get("threshold", 0.85)),
            scale_search=bool(candidate.get("scale_search", False)),
        )
        if not matches:
            continue
        # Some small, low-threshold UI crops (notably the courtyard Explore
        # label) can match character art on unrelated screens.  A candidate
        # may require an independent OCR anchor before its template is valid.
        required_texts = candidate.get("required_texts", [])
        if required_texts:
            roi_value = candidate.get("required_text_roi", candidate.get("text_roi", candidate.get("roi")))
            ocr_items = _ocr_current(context, roi_value)
            minimum = float(candidate.get("required_text_min_confidence", candidate.get("min_confidence", 0.0)))
            if not any(
                float(getattr(item, "confidence", 0.0)) >= minimum
                and any(expected in str(getattr(item, "text", "")) for expected in required_texts)
                for item in ocr_items
            ):
                continue
        match = matches[0].to_dict()
        match["template"] = template
        match["threshold"] = float(candidate.get("threshold", 0.85))
        if candidate.get("roi") is not None:
            match["roi"] = list(candidate["roi"])
        template_hits.append({
            "state": candidate["name"],
            "source": "template",
            "confidence": float(match.get("confidence", 0.0)),
            "match": match,
        })
    if template_hits:
        return max(template_hits, key=lambda item: item["confidence"])
    if not allow_ocr:
        return None

    ocr_cache: dict[tuple[int, ...] | None, list[Any]] = {}
    for candidate in candidates:
        texts = candidate.get("texts", [])
        if not texts:
            continue
        roi_value = candidate.get("text_roi", candidate.get("roi"))
        roi_key = tuple(int(value) for value in roi_value) if roi_value is not None else None
        if roi_key not in ocr_cache:
            ocr_cache[roi_key] = _ocr_current(context, roi_value)
        minimum = float(candidate.get("min_confidence", 0.0))
        for item in ocr_cache[roi_key]:
            confidence = float(getattr(item, "confidence", 0.0))
            text = str(getattr(item, "text", ""))
            if confidence >= minimum and any(expected in text for expected in texts):
                return {
                    "state": candidate["name"],
                    "source": "ocr",
                    "confidence": confidence,
                    "match": _ocr_match(item),
                }
    return None


def _capture_state(context: Any, candidates: list[dict[str, Any]], *, allow_ocr: bool = True) -> dict[str, Any] | None:
    context.check_cancelled()
    context.capture()
    return _detect_state_current(context, candidates, allow_ocr=allow_ocr)


class DetectStateAction(Action):
    """Recognize one of several independently configured states on one frame."""

    name = "vision.detect_state"

    def execute(self, context: Any, arguments: dict[str, Any]) -> ActionResult:
        started = time.perf_counter()
        try:
            candidates = _state_candidates(arguments.get("states"))
            detected = _capture_state(context, candidates, allow_ocr=bool(arguments.get("allow_ocr", True)))
        except (RuntimeError, ValueError) as exc:
            return ActionResult.failed(str(exc), category="vision")
        elapsed = round(time.perf_counter() - started, 6)
        if detected is None:
            return ActionResult.failed(
                "none of the configured states matched",
                category="not_matched",
                output={"state": "", "source": "none", "confidence": 0.0, "match": {}, "elapsed_seconds": elapsed},
            )
        return ActionResult.succeeded({**detected, "elapsed_seconds": elapsed})
