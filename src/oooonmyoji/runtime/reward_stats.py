"""Asynchronous OCR and persistence for captured reward screens."""

from __future__ import annotations

import json
import queue
import re
import threading
import time
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable

from ..devices.protocol import DeviceFrame
from ..vision.template import TemplateMatcher


REWARD_SCREENSHOT_RETENTION_BATTLES = 10
_REWARD_SCREENSHOT_PATTERN = re.compile(
    r"^reward-(?P<battle>\d+)-layer-(?P<layer>\d+)-capture-(?P<capture>\d+)\.png$"
)


@dataclass(frozen=True)
class _MaterialTemplate:
    id: str
    name: str
    path: Path
    threshold: float
    max_results: int
    default_quantity: int | None


class RewardStatsProcessor:
    """Process already-saved screenshots without touching the live device."""

    def __init__(
        self,
        artifact_dir: Path | str,
        recognize: Callable[[object], list[Any]],
        *,
        logger: Any | None = None,
        queue_size: int = 128,
        material_catalog: Path | str | None = None,
    ) -> None:
        self.artifact_dir = Path(artifact_dir)
        self.recognize = recognize
        self.logger = logger
        self.material_templates = _load_material_catalog(material_catalog)
        self._run_material_totals: dict[str, dict[str, dict[str, Any]]] = {}
        self._run_instances: dict[str, str] = {}
        self._queue: queue.Queue[dict[str, Any] | None] = queue.Queue(maxsize=queue_size)
        self._closed = False
        self._stop_enqueued = False
        self._thread = threading.Thread(target=self._run, name="reward-stats", daemon=True)
        self._thread.start()

    def submit(self, request: dict[str, Any]) -> bool:
        if self._closed:
            return False
        try:
            self._queue.put_nowait(dict(request))
        except queue.Full:
            self._emit("reward_stats.queue_full", request=request)
            return False
        return True

    def close(self, *, wait_seconds: float = 15.0) -> bool:
        self._closed = True
        if not self._stop_enqueued:
            try:
                self._queue.put_nowait(None)
            except queue.Full:
                # The worker will make room; keep shutdown bounded for callers.
                try:
                    self._queue.put(None, timeout=max(0.1, min(wait_seconds, 1.0)))
                except queue.Full:
                    return False
            self._stop_enqueued = True
        self._thread.join(max(0.0, wait_seconds))
        return not self._thread.is_alive()

    def _run(self) -> None:
        while True:
            request = self._queue.get()
            try:
                if request is None:
                    return
                self._process(request)
            except Exception as exc:
                if request is not None:
                    self._write_record(request, status="failed", error=str(exc))
                    self._write_run_event(request, status="failed", error=str(exc), items=[])
                    self._emit("reward_stats.failed", error=str(exc), screenshot=request.get("screenshot"))
            finally:
                if request is not None:
                    self._prune_reward_screenshots(request)
                self._queue.task_done()

    def _process(self, request: dict[str, Any]) -> None:
        image = _read_image(Path(str(request["screenshot"])))
        x, y, width, height = _normalize_roi(request.get("roi"), image.shape[1], image.shape[0])

        # Classification comes first. OCR values are accepted as quantities only
        # when their boxes are spatially associated with one of these matches.
        detections = _match_materials(
            image,
            self.material_templates,
            roi=(x, y, width, height),
        )
        results = self.recognize(image[y : y + height, x : x + width].copy())
        ocr = sorted(
            (_translate_ocr_item(_ocr_item(item), x, y) for item in results),
            key=lambda item: (_item_y(item), _item_x(item)),
        )
        items, unassigned_numbers = _associate_quantities(detections, ocr)
        quantity_ocr = self._recognize_unresolved_quantities(image, items)
        if quantity_ocr:
            ocr = sorted((*ocr, *quantity_ocr), key=lambda item: (_item_y(item), _item_x(item)))
            items, unassigned_numbers = _associate_quantities(detections, ocr)
        texts = [str(item["text"]) for item in ocr if str(item.get("text", "")).strip()]
        numbers = [int(value) for text in texts for value in re.findall(r"(?<!\d)\d+(?!\d)", text)]
        self._write_record(
            request,
            status="succeeded",
            recognized=bool(items),
            detections=detections,
            items=items,
            ocr=ocr,
            text=" ".join(texts),
            numeric_values=numbers,
            unassigned_numeric_values=unassigned_numbers,
        )
        event_items = [
            {
                "id": item["id"],
                "name": item["name"],
                "quantity": item["quantity"],
                "occurrences": item["occurrences"],
                "unresolved_occurrences": item["unresolved_occurrences"],
            }
            for item in items
        ]
        material_totals = self._accumulate_run_materials(str(request.get("run_id") or "unknown"), event_items)
        self._write_run_event(
            request,
            status="succeeded",
            recognized=bool(items),
            text=" ".join(texts),
            items=event_items,
            material_totals=material_totals,
        )
        self._emit(
            "reward_stats.completed",
            instance_id=request.get("instance_id"),
            run_id=request.get("run_id"),
            battle_index=request.get("battle_index"),
            layer=request.get("layer"),
            text=" ".join(texts),
            items=[{"id": item["id"], "name": item["name"], "quantity": item["quantity"]} for item in items],
        )

    def _prune_reward_screenshots(self, request: dict[str, Any]) -> None:
        run_id = request.get("run_id")
        instance_id = request.get("instance_id")
        battle_index = request.get("battle_index")
        screenshot_value = request.get("screenshot")
        if (
            not isinstance(run_id, str)
            or not run_id
            or not isinstance(instance_id, str)
            or not instance_id
            or isinstance(battle_index, bool)
            or not isinstance(battle_index, int)
            or battle_index < 1
            or not isinstance(screenshot_value, str)
            or not screenshot_value
        ):
            return

        artifact_root = self.artifact_dir.resolve()
        screenshot = Path(screenshot_value).resolve()
        expected_directory = (artifact_root / run_id / "rewards").resolve()
        try:
            expected_directory.relative_to(artifact_root)
        except ValueError:
            return
        if screenshot.parent != expected_directory:
            return
        try:
            processed_through = screenshot.stat().st_mtime_ns
        except OSError:
            return

        self._run_instances[run_id] = instance_id
        groups: dict[tuple[str, int], list[tuple[Path, int]]] = {}
        try:
            run_directories = tuple(path for path in artifact_root.iterdir() if path.is_dir())
        except OSError as exc:
            self._emit("reward_stats.screenshot_prune_failed", instance_id=instance_id, error=str(exc))
            return

        for run_directory in run_directories:
            candidate_run_id = run_directory.name
            if self._instance_for_run(candidate_run_id) != instance_id:
                continue
            reward_directory = run_directory / "rewards"
            if not reward_directory.is_dir():
                continue
            try:
                candidates = tuple(reward_directory.glob("reward-*-layer-*-capture-*.png"))
            except OSError:
                continue
            for candidate in candidates:
                match = _REWARD_SCREENSHOT_PATTERN.fullmatch(candidate.name)
                if match is None:
                    continue
                try:
                    modified_at = candidate.stat().st_mtime_ns
                except OSError:
                    continue
                # Same-instance submissions are FIFO. Newer files may still be
                # waiting for OCR, so only prune screenshots already reached.
                if modified_at > processed_through:
                    continue
                key = (candidate_run_id, int(match.group("battle")))
                groups.setdefault(key, []).append((candidate, modified_at))

        ordered_groups = sorted(
            groups,
            key=lambda key: (max(item[1] for item in groups[key]), key[0], key[1]),
            reverse=True,
        )
        retained = set(ordered_groups[:REWARD_SCREENSHOT_RETENTION_BATTLES])
        retained.add((run_id, battle_index))
        deleted = 0
        for key in ordered_groups:
            if key in retained:
                continue
            for candidate, _ in groups[key]:
                try:
                    candidate.unlink()
                    deleted += 1
                except OSError as exc:
                    self._emit(
                        "reward_stats.screenshot_delete_failed",
                        instance_id=instance_id,
                        screenshot=str(candidate),
                        error=str(exc),
                    )
        if deleted:
            self._emit(
                "reward_stats.screenshots_pruned",
                instance_id=instance_id,
                retained_battles=REWARD_SCREENSHOT_RETENTION_BATTLES,
                deleted_screenshots=deleted,
            )

    def _instance_for_run(self, run_id: str) -> str | None:
        cached = self._run_instances.get(run_id)
        if cached is not None:
            return cached
        state_path = self.artifact_dir / "runs" / f"{run_id}.json"
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        instance_id = state.get("instance_id") if isinstance(state, dict) else None
        if not isinstance(instance_id, str) or not instance_id:
            return None
        self._run_instances[run_id] = instance_id
        return instance_id

    def _recognize_unresolved_quantities(
        self,
        image: Any,
        items: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        localized: list[dict[str, Any]] = []
        image_height, image_width = image.shape[:2]
        for item in items:
            detections = item.get("detections")
            if not isinstance(detections, list):
                continue
            for detection in detections:
                if not isinstance(detection, dict) or detection.get("quantity_source") != "unresolved":
                    continue
                x = int(detection["x"])
                y = int(detection["y"])
                width = int(detection["width"])
                height = int(detection["height"])
                left = max(0, x - 15)
                top = max(0, y + round(height * 0.55))
                right = min(image_width, x + width + 50)
                bottom = min(image_height, y + height + 60)
                if right <= left or bottom <= top:
                    continue
                try:
                    results = self.recognize(image[top:bottom, left:right].copy())
                except Exception as exc:
                    self._emit(
                        "reward_stats.quantity_ocr_failed",
                        material_id=item.get("id"),
                        error=str(exc),
                    )
                    continue
                for result in results:
                    translated = _translate_ocr_item(_ocr_item(result), left, top)
                    if not re.search(r"(?<!\d)\d+(?!\d)", str(translated.get("text", ""))):
                        continue
                    translated["source"] = "quantity_crop"
                    localized.append(translated)
        return localized

    def _write_record(self, request: dict[str, Any], *, status: str, **fields: Any) -> dict[str, Any]:
        instance_id = _safe_name(str(request.get("instance_id") or "unknown"))
        category = _safe_name(str(request.get("category") or "reward"))
        destination = self.artifact_dir / "reward-stats" / category / instance_id / f"rewards-{date.today().isoformat()}.jsonl"
        destination.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "processed_at": datetime.now(timezone.utc).isoformat(),
            "status": status,
            "instance_id": request.get("instance_id"),
            "run_id": request.get("run_id"),
            "category": request.get("category"),
            "battle_index": request.get("battle_index"),
            "layer": request.get("layer"),
            "capture_index": request.get("capture_index"),
            "captured_at": request.get("captured_at"),
            "screenshot": request.get("screenshot"),
            "roi": request.get("roi"),
            **fields,
        }
        with destination.open("a", encoding="utf-8", newline="\n") as stream:
            stream.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
        return self._update_summary(destination.parent / "summary.json", payload)

    @staticmethod
    def _update_summary(path: Path, record: dict[str, Any]) -> dict[str, Any]:
        try:
            current = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            current = {}
        if not isinstance(current, dict):
            current = {}
        current["total_battles"] = int(current.get("total_battles", 0)) + (1 if record.get("layer") == 1 else 0)
        current["total_screenshots"] = int(current.get("total_screenshots", 0)) + 1
        if record.get("status") != "succeeded":
            status_key = "failed_screenshots"
        elif record.get("recognized"):
            status_key = "recognized_screenshots"
        else:
            status_key = "unrecognized_screenshots"
        current[status_key] = int(current.get(status_key, 0)) + 1
        current.setdefault("recognized_screenshots", 0)
        current.setdefault("unrecognized_screenshots", 0)
        current.setdefault("failed_screenshots", 0)
        material_totals = current.setdefault("material_totals", {})
        if not isinstance(material_totals, dict):
            material_totals = {}
            current["material_totals"] = material_totals
        record_items = record.get("items")
        if isinstance(record_items, list):
            for item in record_items:
                if not isinstance(item, dict) or not isinstance(item.get("id"), str):
                    continue
                entry = material_totals.setdefault(item["id"], {
                    "name": item.get("name", item["id"]),
                    "quantity": 0,
                    "occurrences": 0,
                    "unresolved_occurrences": 0,
                })
                if not isinstance(entry, dict):
                    continue
                entry["name"] = item.get("name", item["id"])
                entry["occurrences"] = int(entry.get("occurrences", 0)) + int(item.get("occurrences", 0))
                quantity = item.get("quantity")
                if isinstance(quantity, int) and not isinstance(quantity, bool):
                    entry["quantity"] = int(entry.get("quantity", 0)) + quantity
                else:
                    entry["unresolved_occurrences"] = int(entry.get("unresolved_occurrences", 0)) + int(
                        item.get("unresolved_occurrences", 0)
                    )
        current["last_run_id"] = record.get("run_id")
        current["last_battle_index"] = record.get("battle_index")
        current["last_text"] = record.get("text", "")
        current["last_items"] = record.get("items", [])
        current["updated_at"] = record.get("processed_at")
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(current, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(path)
        return current

    def _accumulate_run_materials(
        self,
        run_id: str,
        items: list[dict[str, Any]],
    ) -> dict[str, dict[str, Any]]:
        totals = self._run_material_totals.setdefault(run_id, {})
        for item in items:
            material_id = str(item.get("id") or "unknown")
            entry = totals.setdefault(material_id, {
                "name": item.get("name", material_id),
                "quantity": 0,
                "occurrences": 0,
                "unresolved_occurrences": 0,
            })
            entry["name"] = item.get("name", material_id)
            entry["occurrences"] = int(entry.get("occurrences", 0)) + int(item.get("occurrences", 0))
            quantity = item.get("quantity")
            if isinstance(quantity, int) and not isinstance(quantity, bool):
                entry["quantity"] = int(entry.get("quantity", 0)) + quantity
            entry["unresolved_occurrences"] = int(entry.get("unresolved_occurrences", 0)) + int(
                item.get("unresolved_occurrences", 0)
            )
        return {material_id: dict(entry) for material_id, entry in totals.items()}

    def _write_run_event(self, request: dict[str, Any], *, status: str, **fields: Any) -> None:
        events_file = request.get("events_file")
        if not isinstance(events_file, str) or not events_file:
            return
        payload = {
            "type": "reward_stats",
            "run_id": request.get("run_id"),
            "instance_id": request.get("instance_id"),
            "battle_index": request.get("battle_index"),
            "layer": request.get("layer"),
            "capture_index": request.get("capture_index"),
            "status": status,
            "screenshot": request.get("screenshot"),
            "ts": time.time(),
            **fields,
        }
        path = Path(events_file)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8", newline="\n") as stream:
                stream.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
        except OSError as exc:
            self._emit(
                "reward_stats.event_write_failed",
                run_id=request.get("run_id"),
                events_file=events_file,
                error=str(exc),
            )

    def _emit(self, event: str, **fields: Any) -> None:
        if self.logger is not None:
            self.logger.emit(event, **fields)


def _load_material_catalog(path: Path | str | None) -> tuple[_MaterialTemplate, ...]:
    if path is None:
        return ()
    catalog_path = Path(path).resolve()
    try:
        value = json.loads(catalog_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"unable to read reward material catalog: {catalog_path}") from exc
    if not isinstance(value, dict) or value.get("schema_version") != 1 or not isinstance(value.get("templates"), list):
        raise ValueError(f"invalid reward material catalog: {catalog_path}")
    catalog_root = catalog_path.parent.resolve()
    templates: list[_MaterialTemplate] = []
    seen_ids: set[str] = set()
    for index, raw in enumerate(value["templates"]):
        if not isinstance(raw, dict):
            raise ValueError(f"reward material catalog templates[{index}] must be an object")
        material_id = raw.get("id")
        name = raw.get("name")
        reference = raw.get("template")
        if not isinstance(material_id, str) or not material_id or not re.fullmatch(r"[A-Za-z0-9_.-]+", material_id):
            raise ValueError(f"reward material catalog templates[{index}].id is invalid")
        if material_id in seen_ids:
            raise ValueError(f"duplicate reward material id: {material_id}")
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"reward material catalog templates[{index}].name is invalid")
        if not isinstance(reference, str) or not reference.strip():
            raise ValueError(f"reward material catalog templates[{index}].template is invalid")
        template_path = (catalog_root / reference).resolve()
        try:
            template_path.relative_to(catalog_root)
        except ValueError as exc:
            raise ValueError(f"reward material template escapes catalog directory: {reference}") from exc
        if not template_path.is_file():
            raise ValueError(f"reward material template does not exist: {template_path}")
        threshold = float(raw.get("threshold", 0.88))
        max_results = int(raw.get("max_results", 20))
        default_quantity = raw.get("default_quantity", 1)
        if not 0.0 <= threshold <= 1.0:
            raise ValueError(f"reward material threshold is outside 0..1: {material_id}")
        if max_results < 1:
            raise ValueError(f"reward material max_results must be positive: {material_id}")
        if default_quantity is not None and (
            isinstance(default_quantity, bool) or not isinstance(default_quantity, int) or default_quantity < 1
        ):
            raise ValueError(f"reward material default_quantity must be null or a positive integer: {material_id}")
        seen_ids.add(material_id)
        templates.append(_MaterialTemplate(
            id=material_id,
            name=name,
            path=template_path,
            threshold=threshold,
            max_results=max_results,
            default_quantity=default_quantity,
        ))
    return tuple(templates)


def _normalize_roi(value: object, image_width: int, image_height: int) -> tuple[int, int, int, int]:
    if value is None:
        return 0, 0, image_width, image_height
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        raise ValueError("reward statistics ROI must contain x, y, width, height")
    x, y, width, height = (int(item) for item in value)
    if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > image_width or y + height > image_height:
        raise ValueError(f"reward statistics ROI is outside screenshot: {value}")
    return x, y, width, height


def _match_materials(
    image: Any,
    templates: tuple[_MaterialTemplate, ...],
    *,
    roi: tuple[int, int, int, int],
) -> list[dict[str, Any]]:
    if not templates:
        return []
    height, width = image.shape[:2]
    frame = DeviceFrame(width, height, image)
    matcher = TemplateMatcher()
    detections: list[dict[str, Any]] = []
    for material in templates:
        matches = matcher.find(
            frame,
            material.path,
            roi=roi,
            threshold=material.threshold,
            max_results=material.max_results,
        )
        for match in matches:
            detections.append({
                "id": material.id,
                "name": material.name,
                "template": str(material.path),
                "threshold": material.threshold,
                "default_quantity": material.default_quantity,
                **match.to_dict(),
            })
    detections.sort(key=lambda item: (int(item["y"]), int(item["x"]), str(item["id"])))
    return detections


def _translate_ocr_item(item: dict[str, Any], dx: int, dy: int) -> dict[str, Any]:
    translated = dict(item)
    box = translated.get("box")
    if isinstance(box, list):
        translated["box"] = [
            [int(point[0]) + dx, int(point[1]) + dy]
            for point in box
            if isinstance(point, (list, tuple)) and len(point) >= 2
        ]
    return translated


def _associate_quantities(
    detections: list[dict[str, Any]],
    ocr: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[int]]:
    assignments: dict[int, tuple[float, int, dict[str, Any]]] = {}
    unassigned: list[int] = []
    for ocr_item in ocr:
        text = str(ocr_item.get("text", ""))
        values = [int(value) for value in re.findall(r"(?<!\d)\d+(?!\d)", text)]
        if not values:
            continue
        center = _item_center(ocr_item)
        for value in values:
            if center is None:
                unassigned.append(value)
                continue
            candidates: list[tuple[float, int]] = []
            for index, detection in enumerate(detections):
                score = _quantity_distance(center, detection)
                if score is not None:
                    candidates.append((score, index))
            if not candidates:
                unassigned.append(value)
                continue
            score, index = min(candidates)
            current = assignments.get(index)
            if current is None or score < current[0]:
                if current is not None:
                    unassigned.append(current[1])
                assignments[index] = (score, value, ocr_item)
            else:
                unassigned.append(value)

    grouped: dict[str, dict[str, Any]] = {}
    for index, detection in enumerate(detections):
        assignment = assignments.get(index)
        default_quantity = detection.get("default_quantity")
        quantity = assignment[1] if assignment is not None else default_quantity
        quantity_source = "ocr" if assignment is not None else ("default" if default_quantity is not None else "unresolved")
        detail = {
            "x": detection["x"],
            "y": detection["y"],
            "width": detection["width"],
            "height": detection["height"],
            "confidence": detection["confidence"],
            "quantity": quantity,
            "quantity_source": quantity_source,
        }
        if assignment is not None:
            detail["quantity_ocr"] = assignment[2]
        material_id = str(detection["id"])
        group = grouped.setdefault(material_id, {
            "id": material_id,
            "name": detection["name"],
            "quantity": 0,
            "occurrences": 0,
            "unresolved_occurrences": 0,
            "confidence": 0.0,
            "detections": [],
        })
        group["occurrences"] += 1
        group["confidence"] = max(float(group["confidence"]), float(detection["confidence"]))
        group["detections"].append(detail)
        if isinstance(quantity, int) and not isinstance(quantity, bool):
            group["quantity"] += quantity
        else:
            group["unresolved_occurrences"] += 1

    items = list(grouped.values())
    for item in items:
        item["confidence"] = round(float(item["confidence"]), 6)
        if item["unresolved_occurrences"]:
            item["quantity"] = None
    items.sort(key=lambda item: min(int(detection["x"]) for detection in item["detections"]))
    return items, unassigned


def _item_center(item: dict[str, Any]) -> tuple[float, float] | None:
    box = item.get("box")
    if not isinstance(box, list):
        return None
    points = [point for point in box if isinstance(point, (list, tuple)) and len(point) >= 2]
    if not points:
        return None
    return (
        sum(float(point[0]) for point in points) / len(points),
        sum(float(point[1]) for point in points) / len(points),
    )


def _quantity_distance(center: tuple[float, float], detection: dict[str, Any]) -> float | None:
    x = float(detection["x"])
    y = float(detection["y"])
    width = float(detection["width"])
    height = float(detection["height"])
    center_x, center_y = center
    if not (x - 30 <= center_x <= x + width + 90 and y - 30 <= center_y <= y + height + 90):
        return None
    icon_center_x = x + width / 2
    icon_center_y = y + height / 2
    return ((center_x - icon_center_x) / max(width, 1.0)) ** 2 + ((center_y - icon_center_y) / max(height, 1.0)) ** 2


def _read_image(path: Path):
    try:
        import cv2
        import numpy as np
    except ImportError as exc:
        raise RuntimeError("OpenCV and numpy are required for reward statistics") from exc
    try:
        encoded = np.frombuffer(path.read_bytes(), dtype=np.uint8)
    except OSError as exc:
        raise RuntimeError(f"unable to read reward screenshot: {path}") from exc
    image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"unable to decode reward screenshot: {path}")
    return image


def _ocr_item(item: Any) -> dict[str, Any]:
    if hasattr(item, "to_dict"):
        value = item.to_dict()
        if isinstance(value, dict):
            return value
    if isinstance(item, dict):
        return dict(item)
    return {"text": str(item), "confidence": 0.0, "box": []}


def _item_x(item: dict[str, Any]) -> int:
    box = item.get("box")
    return min((int(point[0]) for point in box if isinstance(point, (list, tuple)) and len(point) >= 2), default=0) if isinstance(box, list) else 0


def _item_y(item: dict[str, Any]) -> int:
    box = item.get("box")
    return min((int(point[1]) for point in box if isinstance(point, (list, tuple)) and len(point) >= 2), default=0) if isinstance(box, list) else 0


def _safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", value) or "unknown"


__all__ = ["RewardStatsProcessor"]
