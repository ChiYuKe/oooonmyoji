"""实时视觉监视：把运行时“眼中的画面”连同这一步的判断依据写给桌面端。

模拟器画面测试工具（``tools/vision_stream``）是一条独立的采集链路，回答的是
“这个模板现在能不能匹配上”。本模块回答的是另一个问题：**正在跑的工作流这一步
看到了什么、按什么框去找、点到了哪里**。因此它不另外开采集连接，而是挂在运行
时自己的 ``TaskContext.capture`` 上，把已经抓到的帧按固定节奏写到
``artifacts/live/live-<instance>.json`` + ``.jpg``，由桌面端轮询显示。

写出的是**参考分辨率坐标**（ROI / 匹配框 / OCR 框 / 点击），桌面端按
``frame_width / reference_width`` 比例换算到当前画面，因此缩放、换分辨率都不影响
标注位置。

门控：只有 ``artifacts/live/request.json`` 存在且时间戳新鲜时才写盘。桌面端在
实时视觉窗口打开、且确实有工作流在跑的时候创建它，运行结束时删除；这样“没人看”
的时候预览通道完全不产生任何额外开销。
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping

from ..naming import safe_name
from ..vision.image import frame_to_bgr

#: 每类标注最多画多少个框，避免一张画面被几百个候选刷满。
MAX_OVERLAY_BOXES = 24
#: 预览帧最长边（像素）。桌面端显示区域通常远小于模拟器原始分辨率。
DEFAULT_MAX_WIDTH = 960
#: 预览帧 JPEG 质量。
DEFAULT_JPEG_QUALITY = 72
#: 两次写盘之间的最小间隔（秒）。
DEFAULT_INTERVAL_SECONDS = 0.25
#: 刷新率允许范围，与画面推流工具保持一致。
MIN_INTERVAL_MS = 50
MAX_INTERVAL_MS = 5000
#: ``request.json`` 超过这个年龄就认为观看方已退出，预览通道自动关闭。
REQUEST_STALE_SECONDS = 6.0

REQUEST_FILENAME = "request.json"
#: 观看端据此找到每个实例的快照文件名，避免两端各自实现一遍文件名清洗。
INDEX_FILENAME = "index.json"


def _numbers(value: object, length: int) -> tuple[float, ...] | None:
    if not isinstance(value, (list, tuple)) or len(value) != length:
        return None
    if any(isinstance(item, bool) or not isinstance(item, (int, float)) for item in value):
        return None
    return tuple(float(item) for item in value)


def _walk(value: object) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk(child)
    elif isinstance(value, (list, tuple)):
        for child in value:
            yield from _walk(child)


def _rounded(box: Iterable[float]) -> list[int]:
    return [int(round(item)) for item in box]


def _confidence(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return round(float(value), 4)


def _named_rois(value: object) -> Iterable[tuple[str, list[int]]]:
    """按 ``roi`` / ``*_roi`` 字段名递归收集 ROI（参考坐标）。"""

    if not isinstance(value, dict):
        return
    for key, child in value.items():
        normalized = str(key).lower()
        roi = _numbers(child, 4)
        if roi is not None and (normalized == "roi" or normalized.endswith("_roi")):
            if roi[2] > 0 and roi[3] > 0:
                yield str(key), _rounded(roi)
        if isinstance(child, (dict, list, tuple)):
            yield from _named_rois(child)


def _match_box(value: dict[str, Any]) -> list[int] | None:
    reference = _numbers(value.get("reference"), 4)
    if reference is not None:
        return _rounded(reference)
    fields = [value.get(key) for key in ("x", "y", "width", "height")]
    numeric = [float(item) for item in fields if not isinstance(item, bool) and isinstance(item, (int, float))]
    if len(numeric) != 4:
        return None
    return _rounded(numeric)


def _click_trails(event: dict[str, Any]) -> Iterable[dict[str, Any]]:
    """收集点击轨迹：``(参考起点, 实际落点)``。

    点击动作的输出里带 ``x``/``y``（映射前）与 ``origin_x``/``origin_y`` 或
    ``offset_x``/``offset_y``（映射后），与 ``DebugStepRecorder`` 用的是同一份约定。
    """

    output = event.get("output")
    if not isinstance(output, dict):
        return
    candidates: list[dict[str, Any]] = []
    nested = output.get("clicks")
    if isinstance(nested, list):
        candidates.extend(item for item in nested if isinstance(item, dict))
    candidates.append(output)
    for item in candidates:
        actual = _numbers([item.get("x"), item.get("y")], 2)
        if actual is None:
            continue
        origin = _numbers([item.get("origin_x"), item.get("origin_y")], 2)
        if origin is None:
            offset = _numbers([item.get("offset_x"), item.get("offset_y")], 2)
            if offset is not None:
                origin = (actual[0] - offset[0], actual[1] - offset[1])
        yield {
            "reference": _rounded(origin if origin is not None else actual),
            "actual": _rounded(actual),
            "hold_ms": int(item.get("hold_ms") or 0),
        }


def _recognitions(value: object, *, seen: set[tuple[int, ...]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """递归找出所有带置信度的识别结果，分成模板匹配与 OCR 文字两类。"""

    matches: list[dict[str, Any]] = []
    ocr: list[dict[str, Any]] = []
    for item in _walk(value):
        confidence = _confidence(item.get("confidence"))
        if confidence is None:
            continue
        box = _match_box(item)
        if box is None or box[2] <= 0 or box[3] <= 0:
            continue
        key = tuple(box)
        text = item.get("text")
        if isinstance(text, str) and text:
            if key in seen:
                continue
            seen.add(key)
            ocr.append({"text": text, "confidence": confidence, "box": box})
            continue
        if key in seen:
            continue
        seen.add(key)
        template = item.get("template")
        threshold = item.get("threshold")
        matches.append({
            "confidence": confidence,
            "box": box,
            "template": template if isinstance(template, str) else None,
            "threshold": round(float(threshold), 4) if isinstance(threshold, (int, float)) and not isinstance(threshold, bool) else None,
        })
    return matches, ocr


def build_overlay(event: dict[str, Any]) -> dict[str, Any]:
    """从一个步骤事件里抽出桌面端要画的所有标注（均为参考坐标）。"""

    seen: set[tuple[int, ...]] = set()
    # 参数里放着这一步“打算怎么做”（ROI、阈值、模板路径），输出里放着“结果如何”。
    param_matches, param_ocr = _recognitions(event.get("params"), seen=seen)
    output_matches, output_ocr = _recognitions(event.get("output"), seen=seen)
    matches = sorted(param_matches + output_matches, key=lambda item: item["confidence"], reverse=True)
    return {
        "rois": [{"label": label, "box": box} for label, box in _named_rois(event.get("params"))][:MAX_OVERLAY_BOXES],
        "matches": matches[:MAX_OVERLAY_BOXES],
        "ocr": (param_ocr + output_ocr)[:MAX_OVERLAY_BOXES],
        "clicks": list(_click_trails(event))[:MAX_OVERLAY_BOXES],
    }


def step_summary(event: dict[str, Any]) -> dict[str, Any]:
    """步骤事件里状态条需要显示的字段。"""

    workflow_path = event.get("workflow_path")
    return {
        "step_id": event.get("step_id"),
        "name": event.get("name"),
        "action": event.get("action"),
        "node_kind": event.get("node_kind") or event.get("node_type"),
        "status": event.get("status"),
        "workflow_id": event.get("workflow_id"),
        "workflow_path": list(workflow_path) if isinstance(workflow_path, (list, tuple)) else None,
        "workflow_depth": event.get("workflow_depth"),
        "duration_ms": event.get("duration_ms"),
        "error": event.get("error"),
        "error_category": event.get("error_category"),
    }


def _atomic_write_bytes(path: Path, payload: bytes) -> None:
    temporary = path.with_name(f"{path.name}.tmp")
    temporary.write_bytes(payload)
    os.replace(temporary, path)


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    _atomic_write_bytes(path, json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def request_is_fresh(directory: Path, *, now: float | None = None, max_age: float = REQUEST_STALE_SECONDS) -> bool:
    """观看方是否还在等帧：``request.json`` 存在且时间戳足够新。"""

    return _read_request(Path(directory), now=now, max_age=max_age) is not None


def _read_request(directory: Path, *, now: float | None = None, max_age: float = REQUEST_STALE_SECONDS) -> dict[str, Any] | None:
    """读取新鲜的观看请求；不存在、损坏或过期都返回 ``None``。"""

    try:
        payload = json.loads((directory / REQUEST_FILENAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    stamp = payload.get("ts")
    if isinstance(stamp, bool) or not isinstance(stamp, (int, float)):
        return None
    current = time.time() if now is None else now
    if abs(current - float(stamp)) > max_age:
        return None
    return payload


def requested_interval_ms(directory: Path) -> float | None:
    """观看方在请求里指定的刷新间隔（毫秒）；没指定就用装配时的默认值。"""

    payload = _read_request(Path(directory))
    if payload is None:
        return None
    value = payload.get("interval_ms")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


class LiveViewSink:
    """把运行时抓到的帧按节流节奏写成桌面端可轮询的快照。

    线程安全：子工作流与 ``instance_parallel`` 都会走同一个 ``capture``。
    """

    def __init__(
        self,
        directory: Path,
        *,
        instance_id: str,
        reference_width: int,
        reference_height: int,
        interval_seconds: float = DEFAULT_INTERVAL_SECONDS,
        max_width: int = DEFAULT_MAX_WIDTH,
        jpeg_quality: int = DEFAULT_JPEG_QUALITY,
        clock: Callable[[], float] = time.monotonic,
        enabled: Callable[[], bool] | None = None,
    ) -> None:
        self.directory = Path(directory)
        self.instance_id = instance_id or "default"
        self.reference_width = max(1, int(reference_width))
        self.reference_height = max(1, int(reference_height))
        self.interval_seconds = max(0.0, float(interval_seconds))
        self.max_width = max(160, int(max_width))
        self.jpeg_quality = max(20, min(95, int(jpeg_quality)))
        self._clock = clock
        self._enabled = enabled
        self._lock = threading.RLock()
        self._last_write = float("-inf")
        self._sequence = 0
        self._step: dict[str, Any] | None = None
        self._overlay: dict[str, Any] = {"rois": [], "matches": [], "ocr": [], "clicks": []}
        self.written = 0

    @property
    def frame_path(self) -> Path:
        return self.directory / f"live-{safe_name(self.instance_id)}.jpg"

    @property
    def meta_path(self) -> Path:
        return self.directory / f"live-{safe_name(self.instance_id)}.json"

    @property
    def index_path(self) -> Path:
        return self.directory / INDEX_FILENAME

    def set_interval_ms(self, value: float) -> None:
        """改刷新间隔（毫秒）。观看端调整刷新率时由 ``capture`` 之前的检查调用。"""

        try:
            milliseconds = float(value)
        except (TypeError, ValueError):
            return
        with self._lock:
            self.interval_seconds = max(MIN_INTERVAL_MS, min(MAX_INTERVAL_MS, milliseconds)) / 1000

    def _refresh_interval_from_request(self) -> None:
        milliseconds = requested_interval_ms(self.directory)
        if milliseconds is not None:
            self.set_interval_ms(milliseconds)

    def _publish_index(self) -> None:
        """发布 实例 → 快照文件名 的索引，让桌面端不必猜文件名。"""

        try:
            payload = json.loads(self.index_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            payload = {}
        instances = payload.get("instances") if isinstance(payload, dict) else None
        index = dict(instances) if isinstance(instances, dict) else {}
        index[self.instance_id] = {
            "meta": self.meta_path.name,
            "frame": self.frame_path.name,
            "reference_width": self.reference_width,
            "reference_height": self.reference_height,
            "updated_at": time.time(),
        }
        _atomic_write_json(self.index_path, {"instances": index})

    def record_step(self, event: dict[str, Any], frame: object | None = None, *, force: bool = False) -> None:
        """记住最近一条步骤事件；下一次 ``capture`` 会带上它一起写出。

        传入 ``frame`` 时会立刻尝试补写一帧（``force`` 可跳过节流）：点击、按键这类
        步骤自己不抓屏，只靠 ``capture`` 触发的话，它们的判断依据要等到下一步才会
        显示出来。

        只有带 ``action`` 的步骤才会替换当前上下文：root / sequence 这类结构节点也
        会产生步骤事件，但它们没有动作也没有判断依据，不能把上一条真实步骤擦掉。
        """

        if not isinstance(event, dict) or not event.get("action"):
            return
        with self._lock:
            self._step = step_summary(event)
            self._overlay = build_overlay(event)
        if frame is not None:
            self.maybe_write(frame, force=force)

    def maybe_write(self, frame: object, *, force: bool = False) -> bool:
        """到了节流间隔才写盘；返回本次是否真的写出一帧。"""

        with self._lock:
            # 观看端可能刚调过刷新率；先跟一次请求再判节流，改档位才能立即生效。
            self._refresh_interval_from_request()
            now = self._clock()
            if not force and now - self._last_write < self.interval_seconds:
                return False
            if self._step is None:
                # 还没有步骤事件，画面缺少上下文，等第一步开始再写。
                return False
            if self._enabled is not None and not self._enabled():
                return False
            step = self._step
            overlay = self._overlay
            self._last_write = now
            self._sequence += 1
            sequence = self._sequence
        try:
            payload, width, height = self._encode(frame)
        except Exception:
            # 预览编码失败绝不能影响正在跑的工作流。
            return False
        try:
            self.directory.mkdir(parents=True, exist_ok=True)
            _atomic_write_bytes(self.frame_path, payload)
            _atomic_write_json(self.meta_path, {
                "seq": sequence,
                "ts": time.time(),
                "instance_id": self.instance_id,
                "step": step,
                "overlay": overlay,
                "frame_width": width,
                "frame_height": height,
                "reference_width": self.reference_width,
                "reference_height": self.reference_height,
            })
            self._publish_index()
        except OSError:
            return False
        with self._lock:
            self.written += 1
        return True

    def _encode(self, frame: object) -> tuple[bytes, int, int]:
        import cv2

        image = frame_to_bgr(frame)
        height, width = image.shape[:2]
        if width > self.max_width:
            scaled_height = max(1, round(height * self.max_width / width))
            image = cv2.resize(image, (self.max_width, scaled_height), interpolation=cv2.INTER_AREA)
            width, height = self.max_width, scaled_height
        ok, encoded = cv2.imencode(".jpg", image.copy(), [int(cv2.IMWRITE_JPEG_QUALITY), self.jpeg_quality])
        if not ok:
            raise RuntimeError("unable to encode live preview frame")
        return encoded.tobytes(), width, height


def sink_from_environment(
    *,
    instance_id: str,
    reference_width: int,
    reference_height: int,
    environ: Mapping[str, str] | None = None,
) -> LiveViewSink | None:
    """按桌面端下发的环境变量决定是否开启预览通道。"""

    source = os.environ if environ is None else environ
    directory = source.get("OOONMYOJI_LIVE_VIEW_DIR")
    if not directory:
        return None
    target = Path(directory)
    interval = _float_env(source, "OOONMYOJI_LIVE_VIEW_INTERVAL_MS", DEFAULT_INTERVAL_SECONDS * 1000) / 1000
    max_width = int(_float_env(source, "OOONMYOJI_LIVE_VIEW_MAX_WIDTH", DEFAULT_MAX_WIDTH))
    return LiveViewSink(
        target,
        instance_id=instance_id,
        reference_width=reference_width,
        reference_height=reference_height,
        interval_seconds=interval if interval > 0 else DEFAULT_INTERVAL_SECONDS,
        max_width=max_width,
        enabled=lambda: request_is_fresh(target),
    )

def _float_env(source: Mapping[str, str], name: str, default: float) -> float:
    try:
        return float(source.get(name, default))
    except (TypeError, ValueError):
        return float(default)


__all__ = [
    "DEFAULT_INTERVAL_SECONDS",
    "DEFAULT_MAX_WIDTH",
    "INDEX_FILENAME",
    "LiveViewSink",
    "MAX_INTERVAL_MS",
    "MAX_OVERLAY_BOXES",
    "MIN_INTERVAL_MS",
    "REQUEST_FILENAME",
    "REQUEST_STALE_SECONDS",
    "build_overlay",
    "request_is_fresh",
    "requested_interval_ms",
    "sink_from_environment",
    "step_summary",
]
