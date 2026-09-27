"""状态检测：候选状态解析、OCR 匹配与当前状态捕获。"""

from __future__ import annotations

import time
from typing import Any

from ..base import Action, ActionResult

def _is_reference(value: object) -> bool:
    """`{"ref": "inputs.x"}` 形状的绑定：校验期还没解析，按「稍后有值」对待。"""

    return isinstance(value, dict) and set(value) == {"ref"} and isinstance(value.get("ref"), str)


def _deferred(value: object, *, allow_bindings: bool) -> bool:
    return allow_bindings and _is_reference(value)


def _candidate_templates(candidate: dict[str, Any]) -> list[str]:
    """一个状态的全部模板：`template`（单张）与 `templates`（任一命中即算该状态）。

    多模板是 `vision.wait_any` 的同一套语义——「亮标 / 灰标」这种同一状态的不同外观
    本来就该算一个状态，否则两个状态没法共用同一个处理子图（节点只有一个执行父级）。
    """

    found: list[str] = []
    single = candidate.get("template")
    if isinstance(single, str) and single:
        found.append(single)
    many = candidate.get("templates")
    if isinstance(many, list):
        found.extend(item for item in many if isinstance(item, str) and item)
    return found


def _state_candidates(value: object, *, allow_bindings: bool = False) -> list[dict[str, Any]]:
    """解析状态候选。

    ``allow_bindings`` 只给编译/校验期用：那时 `template` / `roi` / `threshold` 可能还是
    未解析的 `{"ref": …}` 绑定（运行前才由引用解析器求值），字面量检查必须放过它们。
    运行时一律走默认的 ``False``，因为那时拿到的是已解析的值。
    """

    if not isinstance(value, list) or not value:
        raise ValueError("states must be a non-empty array")
    candidates: list[dict[str, Any]] = []
    names: set[str] = set()
    for index, raw in enumerate(value):
        if not isinstance(raw, dict):
            raise ValueError(f"states[{index}] must be an object")
        name = raw.get("name")
        template = raw.get("template")
        templates = raw.get("templates")
        texts = raw.get("texts", [])
        if not isinstance(name, str) or not name:
            raise ValueError(f"states[{index}].name must be a non-empty string")
        if name in names:
            raise ValueError(f"duplicate state name: {name}")
        template_bound = _deferred(template, allow_bindings=allow_bindings)
        templates_bound = _deferred(templates, allow_bindings=allow_bindings)
        texts_bound = _deferred(texts, allow_bindings=allow_bindings)
        if template is not None and not template_bound and (not isinstance(template, str) or not template):
            raise ValueError(f"states[{index}].template must be a non-empty string")
        if templates is not None and not templates_bound:
            if not isinstance(templates, list) or not templates:
                raise ValueError(f"states[{index}].templates must be a non-empty array")
            if not allow_bindings and not all(isinstance(item, str) and item for item in templates):
                raise ValueError(f"states[{index}].templates must be an array of non-empty strings")
        if not texts_bound and (not isinstance(texts, list) or not all(isinstance(text, str) and text for text in texts)):
            raise ValueError(f"states[{index}].texts must be an array of non-empty strings")
        # 识别来源：模板（单张或多张）或文字，字面量或（校验期的）绑定都算。
        has_source = (
            template_bound
            or templates_bound
            or texts_bound
            or (isinstance(template, str) and bool(template))
            or (isinstance(templates, list) and bool(templates))
            or (isinstance(texts, list) and bool(texts))
        )
        if not has_source:
            raise ValueError(f"states[{index}] requires template, templates or texts")
        threshold = raw.get("threshold", 0.85)
        min_confidence = raw.get("min_confidence", 0.0)
        if not _deferred(threshold, allow_bindings=allow_bindings) and not _deferred(
            min_confidence, allow_bindings=allow_bindings
        ):
            if not 0.0 <= float(threshold) <= 1.0 or not 0.0 <= float(min_confidence) <= 1.0:
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
        # 一个状态可以有多个模板（亮标 / 灰标这种同一页面的不同外观）：任一命中即为该状态。
        for template in _candidate_templates(candidate):
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
            break
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
