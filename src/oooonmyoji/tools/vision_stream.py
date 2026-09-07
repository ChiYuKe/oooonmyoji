"""Long-lived vision stream server backing the desktop vision test window.

The process connects to one MuMu instance, pushes downscaled preview frames and
answers template-match / real-tap / interval commands over a newline-delimited
JSON protocol on stdio:

out:
  {"type":"ready","instance":..,"orig_width":..,"orig_height":..,
   "display_width":..,"display_height":..,"mapper":bool,"reference":[1920,1080]}
  {"type":"frame","data":"<base64 png>","width":..,"height":..,
   "orig_width":..,"orig_height":..}
  {"type":"match_result","id":..,"matches":[...],"roi":[..]|null,"threshold":..}
  {"type":"tap_result","id":..,"ok":bool,"message":..}
  {"type":"ack","id":..}
  {"type":"status","message":..,"error":bool}
  {"type":"error","id":..|null,"message":..}
in:
  {"type":"interval","id":..,"ms":100}
  {"type":"pause","id":..,"paused":true}
  {"type":"match","id":..,"template":"assets/templates/..","threshold":0.85,
   "max_results":20,"scale_search":false,"roi":[x,y,width,height]|null}
  {"type":"tap","id":..,"x":..,"y":..,"hold_ms":50}

Design note: the native MuMu capture blocks until the emulator renders a new
frame, so a dedicated worker thread owns capture and the command loop stays
responsive (matching, ROI, pause, tap) even when the game screen is static.
Taps use a short-lived separate device connection so they never wait on a
blocked capture. Matching and coordinate mapping reuse the production
TemplateMatcher and CoordinateMapper. An EOF on stdin (or killing the process)
ends the session.
"""

from __future__ import annotations

import argparse
import base64
import json
import queue
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable

from ..config import load_config
from ..devices.coordinates import CoordinateMapper
from ..devices.mumu import MumuDevice, discover_mumu_path
from ..devices.protocol import DeviceFrame
from ..exceptions import AutomationError, ConfigError, DeviceError, DeviceInputError, VisionError
from ..runtime.instances import ensure_runtime_instance, expand_runtime_instances
from ..vision.image import frame_to_bgr
from ..vision.template import TemplateMatcher
from .template_check import resolve_template_path


DEFAULT_PACKAGE = "com.netease.onmyoji.wyzymnqsd_cps"
DEFAULT_MAX_FRAME_WIDTH = 1280
MIN_INTERVAL_MS = 50
MAX_INTERVAL_MS = 5000


def image_roi_to_reference_roi(
    rect: tuple[int, int, int, int],
    mapper: CoordinateMapper,
) -> tuple[int, int, int, int]:
    """Convert an image-space ROI to reference-space coordinates, clamped to bounds.

    The production matcher interprets an ROI as reference coordinates whenever a
    coordinate mapper is present, so an ROI drawn on the live frame must be mapped
    back through the same mapper before being handed to ``TemplateMatcher.find``.
    """

    x, y, width, height = rect
    ref_x = round(x / mapper.scale_x)
    ref_y = round(y / mapper.scale_y)
    ref_width = max(1, round(width / mapper.scale_x))
    ref_height = max(1, round(height / mapper.scale_y))
    ref_x = max(0, min(ref_x, mapper.reference_width - 1))
    ref_y = max(0, min(ref_y, mapper.reference_height - 1))
    ref_width = min(ref_width, mapper.reference_width - ref_x)
    ref_height = min(ref_height, mapper.reference_height - ref_y)
    return ref_x, ref_y, ref_width, ref_height


def build_mapper(
    reference_width: int,
    reference_height: int,
    image_width: int,
    image_height: int,
) -> CoordinateMapper | None:
    """Build the production coordinate mapper when the aspect ratios agree."""

    try:
        return CoordinateMapper(reference_width, reference_height, image_width, image_height)
    except ConfigError:
        return None


def _cv2() -> Any:
    try:
        import cv2
    except ImportError as exc:  # pragma: no cover - declared runtime dependency
        raise VisionError("OpenCV is required for the vision stream") from exc
    return cv2


def _capture_settings(args: argparse.Namespace) -> dict[str, Any]:
    mumu_path = args.mumu_path
    instance_index = args.index if args.index is not None else 0
    package = args.package or DEFAULT_PACKAGE
    if args.config is not None:
        config = ensure_runtime_instance(
            expand_runtime_instances(load_config(args.config)),
            args.instance,
        )
        try:
            instance = config.instance(args.instance)
        except StopIteration as exc:
            raise ValueError(f"unknown runtime instance: {args.instance}") from exc
        if instance.backend != "mumu":
            raise AutomationError(f"vision stream requires a MuMu instance, got backend={instance.backend}")
        if mumu_path is None:
            mumu_path = config.mumu_path
        if args.index is None:
            instance_index = instance.mumu_index
        if args.package is None:
            package = instance.package or DEFAULT_PACKAGE
    if mumu_path is None:
        mumu_path = discover_mumu_path()
    if mumu_path is None:
        raise AutomationError("MuMu installation was not found; pass --mumu-path")
    return {
        "mumu_path": Path(mumu_path),
        "instance_index": instance_index,
        "package": package,
    }


class VisionStream:
    """Owns the capture worker and serves one JSONL session."""

    def __init__(
        self,
        *,
        device_factory: Callable[[], MumuDevice],
        write: Callable[[dict[str, Any]], None],
        reference_width: int = 1920,
        reference_height: int = 1080,
        interval_ms: int = 200,
        max_frame_width: int = DEFAULT_MAX_FRAME_WIDTH,
        project_root: Path,
    ) -> None:
        self.device_factory = device_factory
        self.write = write
        self.reference_width = reference_width
        self.reference_height = reference_height
        self.interval_ms = max(MIN_INTERVAL_MS, min(MAX_INTERVAL_MS, int(interval_ms)))
        self.max_frame_width = max(320, int(max_frame_width))
        self.project_root = project_root.resolve()
        self.paused = False
        self._frame_lock = threading.Lock()
        self._frame: Any | None = None
        self._frame_seq = 0
        self._ready_pending: dict[str, Any] | None = None
        self._status_pending: tuple[str, bool] | None = None
        self._capture_stop = False
        self._command_id = 0

    # ------------------------------------------------------------------ loop

    def run(self, commands: queue.Queue[Any] | None = None, frame_limit: int | None = None) -> int:
        """Serve frames until a quit sentinel, EOF (None entry) or frame_limit."""

        worker = threading.Thread(target=self._capture_worker, name="vision-capture", daemon=True)
        worker.start()
        last_sent_seq = 0
        frame_no = 0
        next_send = time.monotonic()
        try:
            while True:
                if commands is not None:
                    quit_stream = self._drain_commands(commands)
                    if quit_stream:
                        break
                with self._frame_lock:
                    pending_status = self._status_pending
                    self._status_pending = None
                    pending_ready = self._ready_pending
                    self._ready_pending = None
                if pending_status is not None:
                    message, error = pending_status
                    self.write({"type": "status", "message": message, "error": error})
                if pending_ready is not None:
                    self.write(pending_ready)
                if self.paused:
                    time.sleep(0.04)
                    continue
                now = time.monotonic()
                if now < next_send:
                    time.sleep(min(0.04, next_send - now))
                    continue
                next_send = now + self.interval_ms / 1000
                with self._frame_lock:
                    image = self._frame
                    seq = self._frame_seq
                if image is None or seq == last_sent_seq:
                    continue
                last_sent_seq = seq
                image_height, image_width = image.shape[:2]
                display = image
                display_width, display_height = image_width, image_height
                if image_width > self.max_frame_width:
                    cv2 = _cv2()
                    scale = self.max_frame_width / image_width
                    display_width = max(1, round(image_width * scale))
                    display_height = max(1, round(image_height * scale))
                    display = cv2.resize(image, (display_width, display_height), interpolation=cv2.INTER_AREA)
                try:
                    encoded, payload = _cv2().imencode(".png", display)
                    if not encoded:
                        raise VisionError("unable to encode preview frame")
                except (VisionError, ValueError, RuntimeError) as exc:
                    self.write({"type": "status", "message": f"画面编码失败：{exc}", "error": True})
                    continue
                self.write({
                    "type": "frame",
                    "data": base64.b64encode(payload.tobytes()).decode("ascii"),
                    "width": display_width,
                    "height": display_height,
                    "orig_width": image_width,
                    "orig_height": image_height,
                })
                frame_no += 1
                if frame_limit is not None and frame_no >= frame_limit:
                    break
        finally:
            self._capture_stop = True
            worker.join(timeout=2.0)
        return 0

    def _capture_worker(self) -> None:
        device: MumuDevice | None = None
        try:
            while not self._capture_stop:
                if device is None:
                    try:
                        device = self.device_factory()
                    except (AutomationError, DeviceError, OSError, ValueError) as exc:
                        self._set_status(
                            f"连接模拟器失败：{exc}（若实例未启动，请先在 MuMu 中打开后再试）",
                            error=True,
                        )
                        time.sleep(1.0)
                        continue
                    self._set_status("已连接模拟器。")
                    try:
                        width = max(1, int(device.width))
                        height = max(1, int(device.height))
                    except (AttributeError, TypeError, ValueError):
                        width = height = 0
                    if width > 0 and height > 0:
                        mapper = build_mapper(
                            self.reference_width,
                            self.reference_height,
                            width,
                            height,
                        )
                        display_width = min(width, self.max_frame_width)
                        display_height = max(1, round(height * min(1.0, self.max_frame_width / width)))
                        with self._frame_lock:
                            self._ready_pending = {
                                "type": "ready",
                                "orig_width": width,
                                "orig_height": height,
                                "display_width": display_width,
                                "display_height": display_height,
                                "mapper": mapper is not None,
                                "reference": [self.reference_width, self.reference_height],
                            }
                try:
                    image = frame_to_bgr(device.capture()).copy()
                except (AutomationError, DeviceError, OSError, ValueError) as exc:
                    self._set_status(f"实时捕获失败，将重连：{exc}", error=True)
                    try:
                        device.close()
                    except (AutomationError, DeviceError, OSError, ValueError):
                        pass
                    device = None
                    time.sleep(1.0)
                    continue
                with self._frame_lock:
                    self._frame = image
                    self._frame_seq += 1
        finally:
            if device is not None:
                try:
                    device.close()
                except (AutomationError, DeviceError, OSError, ValueError):
                    pass

    def _set_status(self, message: str, *, error: bool = False) -> None:
        with self._frame_lock:
            self._status_pending = (message, error)

    # ------------------------------------------------------------- commands

    def _drain_commands(self, commands: queue.Queue[Any]) -> bool:
        quit_stream = False
        while True:
            try:
                item = commands.get_nowait()
            except queue.Empty:
                return quit_stream
            if item is None:
                return True
            if not isinstance(item, dict):
                continue
            command = item
            self._command_id += 1
            command_id = command.get("id", self._command_id)
            kind = command.get("type")
            try:
                if kind == "interval":
                    self.interval_ms = max(MIN_INTERVAL_MS, min(MAX_INTERVAL_MS, int(command["ms"])))
                    self.write({"type": "ack", "id": command_id})
                elif kind == "pause":
                    self.paused = bool(command.get("paused", True))
                    self.write({"type": "ack", "id": command_id})
                elif kind == "match":
                    self._handle_match(command_id, command)
                elif kind == "tap":
                    self._handle_tap(command_id, command)
                else:
                    self.write({"type": "error", "id": command_id, "message": f"未知命令：{kind}"})
            except (KeyError, TypeError, ValueError) as exc:
                self.write({"type": "error", "id": command_id, "message": f"命令参数无效：{exc}"})
        return quit_stream

    def _latest_frame(self) -> Any | None:
        with self._frame_lock:
            return self._frame

    def _handle_match(self, command_id: int, command: dict[str, Any]) -> None:
        template = command.get("template")
        if not isinstance(template, str) or not template.strip():
            raise ValueError("缺少模板路径")
        image = self._latest_frame()
        if image is None:
            self.write({"type": "error", "id": command_id, "message": "还没有可用画面，请稍后再匹配。"})
            return
        try:
            threshold = float(command.get("threshold", 0.85))
            max_results = int(command.get("max_results", 20))
            scale_search = bool(command.get("scale_search", False))
        except (TypeError, ValueError) as exc:
            raise ValueError(str(exc)) from exc
        if not 0.0 <= threshold <= 1.0 or not 1 <= max_results <= 100:
            raise ValueError("阈值必须在 0-1，结果数必须在 1-100 之间")
        try:
            template_path = resolve_template_path(self.project_root, template)
        except (ValueError, VisionError) as exc:
            raise ValueError(str(exc)) from exc
        roi_px = None
        raw_roi = command.get("roi")
        if raw_roi is not None:
            if not isinstance(raw_roi, list) or len(raw_roi) != 4:
                raise ValueError("ROI 必须是 [x, y, width, height]")
            x, y, width, height = (int(value) for value in raw_roi)
            roi_px = (x, y, width, height)
        image_height, image_width = image.shape[:2]
        mapper = build_mapper(
            self.reference_width,
            self.reference_height,
            image_width,
            image_height,
        )
        roi_reference = None
        if roi_px is not None:
            if mapper is not None:
                roi_reference = image_roi_to_reference_roi(roi_px, mapper)
            else:
                roi_reference = roi_px
        try:
            frame = DeviceFrame(image_width, image_height, image, format="bgr")
            matches = TemplateMatcher(mapper).find(
                frame,
                template_path,
                roi=roi_reference,
                threshold=threshold,
                max_results=max_results,
                scale_search=scale_search,
            )
        except (VisionError, ValueError, ConfigError) as exc:
            self.write({"type": "error", "id": command_id, "message": f"匹配失败：{exc}"})
            return
        self.write({
            "type": "match_result",
            "id": command_id,
            "template": template,
            "threshold": threshold,
            "roi": list(roi_px) if roi_px is not None else None,
            "matches": [match.to_dict() for match in matches],
        })

    def _handle_tap(self, command_id: int, command: dict[str, Any]) -> None:
        x = int(command["x"])
        y = int(command["y"])
        hold_ms = max(0, min(2000, int(command.get("hold_ms", 0))))
        image = self._latest_frame()
        if image is None:
            self.write({"type": "tap_result", "id": command_id, "ok": False, "message": "还没有画面，模拟器可能未连接。"})
            return
        image_height, image_width = image.shape[:2]
        if x < 0 or y < 0 or x >= image_width or y >= image_height:
            self.write({"type": "tap_result", "id": command_id, "ok": False, "message": f"点击坐标 ({x},{y}) 超出画面。"})
            return
        # 使用独立的短生命周期连接，避免被阻塞中的画面捕获线程卡住。
        device: MumuDevice | None = None
        try:
            device = self.device_factory()
            device.tap(x, y, hold_ms=hold_ms)
        except (DeviceInputError, DeviceError, ValueError, AutomationError, OSError) as exc:
            self.write({"type": "tap_result", "id": command_id, "ok": False, "message": f"点击失败：{exc}"})
            return
        finally:
            if device is not None:
                try:
                    device.close()
                except (AutomationError, DeviceError, OSError, ValueError):
                    pass
        self.write({
            "type": "tap_result",
            "id": command_id,
            "ok": True,
            "message": f"已点击 ({x},{y})，按住 {hold_ms} ms。",
        })


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, help="JSON 配置路径，用于读取 MuMu 实例设置")
    parser.add_argument("--instance", default="mumu-0", help="配置中的 MuMu 实例 ID")
    parser.add_argument("--mumu-path", type=Path, help="MuMu 安装目录")
    parser.add_argument("--index", type=int, help="MuMu 多开实例编号")
    parser.add_argument("--package", help="用于选择 MuMu 显示的应用包名")
    parser.add_argument("--interval-ms", type=int, default=200, help="帧推送间隔，范围 50-5000 毫秒")
    parser.add_argument("--max-frame-width", type=int, default=DEFAULT_MAX_FRAME_WIDTH, help="预览帧最大宽度")
    parser.add_argument("--reference-width", type=int, default=1920)
    parser.add_argument("--reference-height", type=int, default=1080)
    return parser


def _write_json_line(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _stdin_command_source() -> queue.Queue[Any]:
    commands: queue.Queue[Any] = queue.Queue()

    def reader() -> None:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                commands.put(json.loads(line))
            except ValueError:
                commands.put({"type": "error", "message": "无法解析的命令行。"})
        commands.put(None)

    threading.Thread(target=reader, name="vision-stdin", daemon=True).start()
    return commands


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.reference_width < 1 or args.reference_height < 1:
        print("reference resolution must be positive", file=sys.stderr)
        return 2
    if not MIN_INTERVAL_MS <= args.interval_ms <= MAX_INTERVAL_MS:
        print(f"interval must be within {MIN_INTERVAL_MS}-{MAX_INTERVAL_MS} ms", file=sys.stderr)
        return 2
    if args.max_frame_width < 320:
        print("max frame width must be at least 320", file=sys.stderr)
        return 2
    project_root = Path.cwd().resolve()
    try:
        capture = _capture_settings(args)
    except (AutomationError, OSError, ValueError) as exc:
        _write_json_line({"type": "error", "message": str(exc)})
        return 2
    if args.config is not None:
        try:
            project_root = load_config(args.config).root_dir.resolve()
        except (AutomationError, OSError, ValueError):
            project_root = Path.cwd().resolve()

    def device_factory() -> MumuDevice:
        device = MumuDevice(
            capture["mumu_path"],
            capture["instance_index"],
            capture["package"],
        )
        device.connect()
        return device

    # 预热 OpenCV/numpy：首次 frame_to_bgr 会触发 cv2 完整导入（可达数秒），
    # 若等连接后再导入，用户会先看到黑屏。这里在推流启动前完成导入，
    # 让 ready 到达后首帧能立即推送。
    try:
        _cv2()
        import numpy  # noqa: F401
    except (VisionError, ImportError):
        pass

    stream = VisionStream(
        device_factory=device_factory,
        write=_write_json_line,
        reference_width=args.reference_width,
        reference_height=args.reference_height,
        interval_ms=args.interval_ms,
        max_frame_width=args.max_frame_width,
        project_root=project_root,
    )
    try:
        return stream.run(commands=_stdin_command_source())
    except (KeyboardInterrupt, OSError, RuntimeError):
        return 0


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "MIN_INTERVAL_MS",
    "MAX_INTERVAL_MS",
    "VisionStream",
    "build_mapper",
    "build_parser",
    "image_roi_to_reference_roi",
    "main",
]