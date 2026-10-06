"""Capture and OCR the current emulator screen for duel lineup entry."""

from __future__ import annotations

import argparse
import base64
import json
import re
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from ..config import load_config
from ..devices.factory import connect_at_task_boundary
from ..devices.protocol import frame_from_backend
from ..runtime.instances import ensure_runtime_instance, expand_runtime_instances
from ..vision.image import frame_to_bgr
from ..vision.ocr import PaddleOcrEngine


def _read_color_image(path: Path) -> Any | None:
    """Read image assets from Unicode paths (cv2.imread fails on some Windows paths)."""
    try:
        encoded = np.fromfile(path, dtype=np.uint8)
    except OSError:
        return None
    return cv2.imdecode(encoded, cv2.IMREAD_COLOR) if encoded.size else None


def _screen_side(image: Any) -> str:
    """Read the blue/red fan color in the upper-left team badge."""
    height, width = image.shape[:2]
    badge = image[: max(1, int(height * .24)), : max(1, int(width * .15))]
    hsv = cv2.cvtColor(badge, cv2.COLOR_BGR2HSV)
    blue = int(cv2.countNonZero(cv2.inRange(hsv, (90, 70, 55), (135, 255, 255))))
    red = int(cv2.countNonZero(cv2.inRange(hsv, (0, 75, 60), (12, 255, 255))))
    red += int(cv2.countNonZero(cv2.inRange(hsv, (168, 75, 60), (180, 255, 255))))
    if blue >= 35 and blue > red * 1.35:
        return "blue"
    if red >= 35 and red > blue * 1.35:
        return "red"
    return "unknown"


def _match_soul_icons(image: Any, positions: list[tuple[float, float]], project_root: Path) -> list[dict[str, Any] | None]:
    icon_dir = project_root / "assets" / "soul-icons"
    manifest_path = icon_dir / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return [None for _ in positions]
    templates: list[tuple[int, Any]] = []
    for entry in manifest:
        if not isinstance(entry, dict) or not isinstance(entry.get("suitId"), int):
            continue
        source = _read_color_image(icon_dir / str(entry.get("file", "")))
        if source is not None:
            templates.append((entry["suitId"], source))
    height, width = image.shape[:2]
    matches: list[dict[str, Any] | None] = []
    for x, y in positions:
        center_x, center_y = round(x), round(y)
        radius = max(28, round(min(width, height) * .065))
        x1, x2 = max(0, center_x - radius), min(width, center_x + radius)
        y1, y2 = max(0, center_y - radius), min(height, center_y + radius)
        crop = image[y1:y2, x1:x2]
        if crop.size == 0 or min(crop.shape[:2]) < 20:
            matches.append(None)
            continue
        best_id, best_score = 0, -1.0
        suit_scores: dict[int, float] = {}
        for suit_id, source in templates:
            source_size = max(source.shape[:2])
            sizes = sorted({round(source_size * scale) for scale in (0.70, 0.78, 0.86, 0.94, 1.0, 1.08, 1.16, 1.24)})
            for size in sizes:
                if size > min(crop.shape[:2]) or size < 12:
                    continue
                template = cv2.resize(source, (size, size), interpolation=cv2.INTER_AREA if size < source_size else cv2.INTER_CUBIC)
                response = cv2.matchTemplate(crop, template, cv2.TM_CCOEFF_NORMED)
                score = float(cv2.minMaxLoc(response)[1])
                suit_scores[suit_id] = max(suit_scores.get(suit_id, -1.0), score)
                if score > best_score:
                    best_id, best_score = suit_id, score
        second_score = max((score for suit_id, score in suit_scores.items() if suit_id != best_id), default=-1.0)
        matches.append({
            "suitId": best_id,
            "score": round(best_score, 4),
            "confidenceGap": round(best_score - second_score, 4),
        } if best_id else None)
    return matches


def _table_columns(items: list[Any], width: int, height: int) -> tuple[list[float], float | None]:
    groups: list[dict[str, float]] = []
    for item in items:
        if item.confidence < .4 or not re.search(r"\d", item.text):
            continue
        x = sum(point[0] for point in item.box) / 4
        y = sum(point[1] for point in item.box) / 4
        if not height * .2 <= y <= height * .9 or x < width * .16:
            continue
        group = next((entry for entry in groups if abs(entry["x"] - x) <= width * .035), None)
        if group:
            group["x"] = (group["x"] * group["count"] + x) / (group["count"] + 1)
            group["count"] += 1
        else:
            groups.append({"x": x, "count": 1})
    columns = sorted((entry for entry in groups if entry["count"] >= 3), key=lambda entry: entry["count"], reverse=True)[:5]
    columns.sort(key=lambda entry: entry["x"])
    attack_rows = [item for item in items if item.confidence >= .4 and "攻击" in item.text and sum(point[0] for point in item.box) / 4 < width * .2]
    attack_y = min((sum(point[1] for point in item.box) / 4 for item in attack_rows), default=None)
    return [entry["x"] for entry in columns], attack_y


def _match_hero_icons(image: Any, positions: list[tuple[float, float]], project_root: Path) -> list[dict[str, Any] | None]:
    icon_dir = project_root / "assets" / "hero-icons"
    manifest_path = icon_dir / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return [None for _ in positions]
    templates: list[tuple[int, Any]] = []
    for entry in manifest:
        if not isinstance(entry, dict) or not isinstance(entry.get("id"), int):
            continue
        source = _read_color_image(icon_dir / str(entry.get("file", "")))
        if source is not None:
            templates.append((entry["id"], source))
    height, width = image.shape[:2]
    matches: list[dict[str, Any] | None] = []
    for x, y in positions:
        center_x, center_y = round(x), round(y)
        radius = max(22, round(min(width, height) * .047))
        crop = image[max(0, center_y - radius):min(height, center_y + radius), max(0, center_x - radius):min(width, center_x + radius)]
        if crop.size == 0 or min(crop.shape[:2]) < 20:
            matches.append(None)
            continue
        scores: dict[int, float] = {}
        for hero_id, source in templates:
            best = -1.0
            for size in range(max(20, min(crop.shape[:2]) - 18), min(crop.shape[:2]) + 1, 3):
                template = cv2.resize(source, (size, size), interpolation=cv2.INTER_AREA if size < source.shape[0] else cv2.INTER_CUBIC)
                best = max(best, float(cv2.minMaxLoc(cv2.matchTemplate(crop, template, cv2.TM_CCOEFF_NORMED))[1]))
            scores[hero_id] = best
        ranked = sorted(scores.items(), key=lambda entry: entry[1], reverse=True)
        if ranked:
            matches.append({
                "heroId": ranked[0][0],
                "score": round(ranked[0][1], 4),
                "confidenceGap": round(ranked[0][1] - (ranked[1][1] if len(ranked) > 1 else -1), 4),
                "x": center_x,
            })
        else:
            matches.append(None)
    return matches


def _analyze_image(config: Any, image: Any) -> dict[str, Any]:
    if not config.ocr.enabled:
        raise RuntimeError("请先在设置中启用 OCR")
    height, width = image.shape[:2]
    engine = PaddleOcrEngine(
        language=config.ocr.language,
        use_gpu=config.ocr.use_gpu,
        min_confidence=config.ocr.min_confidence,
    )
    try:
        items = engine.recognize(image)
        column_xs, attack_y = _table_columns(items, width, height)
        portrait_y = max(0, attack_y - height * .14) if attack_y is not None else height * .1
        hero_matches = _match_hero_icons(image, [(x, portrait_y) for x in column_xs], config.root_dir)
        labels = [item for item in items if item.confidence >= .4 and "御魂效果" in item.text.replace(" ", "")]
        columns: list[tuple[float, float]] = []
        for item in items:
            if item.confidence < .4:
                continue
            x = sum(point[0] for point in item.box) / 4
            y = sum(point[1] for point in item.box) / 4
            if y < height * .4 and x > width * .15 and len(re.findall(r"[\u4e00-\u9fff]", item.text)) >= 2:
                columns.append((x, y))
        columns.sort()
        grouped_columns: list[tuple[float, float]] = []
        for x, y in columns:
            if grouped_columns and x - grouped_columns[-1][0] < width * .08:
                previous_x, previous_y = grouped_columns[-1]
                grouped_columns[-1] = ((previous_x + x) / 2, (previous_y + y) / 2)
            else:
                grouped_columns.append((x, y))
        label_y = (sum(point[1] for point in labels[0].box) / 4) if labels else None
        # The game places the “御魂效果” label and the round icons on the same row.
        # Center on that row when OCR finds it; keep a layout-based fallback otherwise.
        icon_y = min(height - 1, label_y) if label_y is not None else height * .895
        soul_matches = _match_soul_icons(image, [(x, icon_y) for x, _ in grouped_columns[:5]], config.root_dir)
        return {
            "width": width,
            "height": height,
            "screenSide": _screen_side(image),
            "items": [item.to_dict() for item in items],
            "heroMatches": hero_matches,
            "soulMatches": [
                {"x": grouped_columns[index][0], **match} if match else None
                for index, match in enumerate(soul_matches)
            ],
        }
    finally:
        engine.close()


def capture_screen(config_path: Path, instance_id: str) -> dict[str, Any]:
    config = expand_runtime_instances(load_config(config_path))
    config = ensure_runtime_instance(config, instance_id)
    device = None
    try:
        device, _used_adb = connect_at_task_boundary(config, config.instance(instance_id))
        image = frame_to_bgr(frame_from_backend(device.capture()))
        success, encoded = cv2.imencode(".png", image, [cv2.IMWRITE_PNG_COMPRESSION, 3])
        if not success:
            raise RuntimeError("无法编码模拟器画面")
        height, width = image.shape[:2]
        return {"width": width, "height": height, "dataUrl": f"data:image/png;base64,{base64.b64encode(encoded).decode('ascii')}"}
    finally:
        if device is not None:
            device.close()


def recognize_image(config_path: Path, image_path: Path, roi: tuple[int, int, int, int]) -> dict[str, Any]:
    config = load_config(config_path)
    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError("无法读取截图")
    x, y, width, height = roi
    image_height, image_width = image.shape[:2]
    if x < 0 or y < 0 or width < 1 or height < 1 or x + width > image_width or y + height > image_height:
        raise RuntimeError("框选区域超出截图范围")
    return _analyze_image(config, image[y:y + height, x:x + width].copy())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--mode", choices=("capture", "recognize-image"), default="capture")
    parser.add_argument("--instance")
    parser.add_argument("--image", type=Path)
    parser.add_argument("--roi", nargs=4, type=int)
    args = parser.parse_args()
    try:
        if args.mode == "capture":
            if not args.instance:
                raise RuntimeError("请选择模拟器实例")
            result = capture_screen(args.config, args.instance)
        else:
            if not args.image or not args.roi:
                raise RuntimeError("缺少截图或 ROI 区域")
            result = recognize_image(args.config, args.image, tuple(args.roi))
        print(json.dumps({"ok": True, **result}, ensure_ascii=False))
        return 0
    except Exception as exc:  # noqa: BLE001 - keep the IPC response machine-readable.
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
