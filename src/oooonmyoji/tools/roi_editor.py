"""Capture MuMu screens and prepare labeled template/ROI assets."""

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    import tkinter as tk
    from tkinter import filedialog, messagebox, simpledialog
except ImportError:  # pragma: no cover - only relevant to Python builds without Tk
    tk = None  # type: ignore[assignment]
    filedialog = messagebox = simpledialog = None  # type: ignore[assignment]

from ..config import load_config
from ..devices.mumu import MumuDevice, discover_mumu_path
from ..exceptions import AutomationError, DeviceError, VisionError
from ..vision.image import frame_to_bgr


DEFAULT_PACKAGE = "com.netease.onmyoji.wyzymnqsd_cps"
PROJECT_ROOT = Path(__file__).resolve().parents[3]
INVALID_FILENAME = re.compile(r'[\x00-\x1f<>:"/\\|?*]')


@dataclass
class RoiRegion:
    """One user-labeled rectangle in source-image coordinates."""

    region_id: str
    label: str
    x: int
    y: int
    width: int
    height: int

    def image_rect(self) -> list[int]:
        return [self.x, self.y, self.width, self.height]

    def reference_rect(self, image_width: int, image_height: int, reference_width: int, reference_height: int) -> list[int]:
        return [
            round(self.x * reference_width / image_width),
            round(self.y * reference_height / image_height),
            round(self.width * reference_width / image_width),
            round(self.height * reference_height / image_height),
        ]


def normalize_rect(
    first_x: int,
    first_y: int,
    second_x: int,
    second_y: int,
    image_width: int,
    image_height: int,
) -> tuple[int, int, int, int] | None:
    """Normalize two corners and clip the result to the source image."""

    left = max(0, min(first_x, second_x))
    top = max(0, min(first_y, second_y))
    right = min(image_width, max(first_x, second_x))
    bottom = min(image_height, max(first_y, second_y))
    if right - left < 2 or bottom - top < 2:
        return None
    return left, top, right - left, bottom - top


def safe_filename(value: str, fallback: str) -> str:
    """Keep a user label usable as a single local filename."""

    candidate = INVALID_FILENAME.sub("_", value).strip().strip(".")
    return candidate or fallback


def read_image(path: Path) -> Any:
    """Decode an image through bytes so Chinese Windows paths work reliably."""

    try:
        import cv2
        import numpy as np
    except ImportError as exc:  # pragma: no cover - dependencies are installed by requirements.txt
        raise VisionError("OpenCV and numpy are required for the ROI editor") from exc
    try:
        payload = path.read_bytes()
    except OSError as exc:
        raise VisionError(f"unable to read image: {path}") from exc
    image = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise VisionError(f"image is unreadable: {path}")
    return image


def write_png(path: Path, image: Any) -> Path:
    """Encode a BGR image through bytes to support Chinese output paths."""

    try:
        import cv2
    except ImportError as exc:  # pragma: no cover - dependencies are installed by requirements.txt
        raise VisionError("OpenCV is required for the ROI editor") from exc
    encoded, payload = cv2.imencode(".png", image)
    if not encoded:
        raise VisionError(f"unable to encode PNG: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.write_bytes(payload.tobytes())
    except OSError as exc:
        raise VisionError(f"unable to write PNG: {path}") from exc
    return path


def encode_png(image: Any) -> bytes:
    """Encode a BGR image as PNG bytes."""

    try:
        import cv2
    except ImportError as exc:  # pragma: no cover - dependencies are installed by requirements.txt
        raise VisionError("OpenCV is required for the ROI editor") from exc
    encoded, payload = cv2.imencode(".png", image)
    if not encoded:
        raise VisionError("unable to encode rendered PNG")
    return payload.tobytes()


def encode_tk_png(image: Any) -> bytes:
    """Encode a BGR image as PNG bytes for Tk PhotoImage."""

    return encode_png(image)


def export_payload(
    source_path: Path | None,
    image_width: int,
    image_height: int,
    regions: list[RoiRegion],
    reference_width: int,
    reference_height: int,
    capture_rect: tuple[int, int, int, int] | None = None,
) -> dict[str, Any]:
    """Build the stable JSON representation used by later workflow authoring."""

    capture_payload = None
    if capture_rect is not None:
        capture = RoiRegion("capture", "截取区", *capture_rect)
        capture_payload = {
            "image_rect": capture.image_rect(),
            "reference_rect": capture.reference_rect(
                image_width,
                image_height,
                reference_width,
                reference_height,
            ),
        }
    return {
        "schema_version": 1,
        "source": str(source_path) if source_path is not None else None,
        "image_size": [image_width, image_height],
        "reference_resolution": [reference_width, reference_height],
        "capture_rect": capture_payload,
        "regions": [
            {
                "id": region.region_id,
                "label": region.label,
                "image_rect": region.image_rect(),
                "reference_rect": region.reference_rect(
                    image_width,
                    image_height,
                    reference_width,
                    reference_height,
                ),
                "center": [
                    round((region.x + region.width / 2) * reference_width / image_width),
                    round((region.y + region.height / 2) * reference_height / image_height),
                ],
            }
            for region in regions
        ],
    }


def selection_payload(
    rect: tuple[int, int, int, int],
    image_width: int,
    image_height: int,
    reference_width: int,
    reference_height: int,
) -> dict[str, Any]:
    """Build the compact result returned by the workflow ROI picker."""

    region = RoiRegion("selection", "识别区域", *rect)
    return {
        "image_rect": region.image_rect(),
        "reference_rect": region.reference_rect(
            image_width,
            image_height,
            reference_width,
            reference_height,
        ),
        "image_size": [image_width, image_height],
        "reference_resolution": [reference_width, reference_height],
    }


def write_selection_result(
    path: Path,
    rect: tuple[int, int, int, int],
    image_width: int,
    image_height: int,
    reference_width: int,
    reference_height: int,
) -> Path:
    """Write one selected ROI for consumption by the workflow editor."""

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            selection_payload(rect, image_width, image_height, reference_width, reference_height),
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return path


def capture_result(
    capture: dict[str, Any],
    result_file: Path,
) -> Path:
    """Capture one MuMu frame and write it as base64 PNG JSON for the Webview."""

    device = MumuDevice(
        capture["mumu_path"],
        capture["instance_index"],
        capture["package"],
    )
    try:
        device.connect()
        image = frame_to_bgr(device.capture()).copy()
    finally:
        device.close()
    image_height, image_width = image.shape[:2]
    result_file.parent.mkdir(parents=True, exist_ok=True)
    result_file.write_text(
        json.dumps(
            {
                "image_base64": base64.b64encode(encode_png(image)).decode("ascii"),
                "image_size": [image_width, image_height],
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    return result_file


class RoiEditor:
    """Small desktop editor for screenshot annotations and ROI extraction."""

    def __init__(
        self,
        *,
        output_dir: Path,
        reference_width: int,
        reference_height: int,
        capture: Any | None = None,
        initial_image: Path | None = None,
        live: bool = True,
        live_interval_ms: int = 250,
        select_only: bool = False,
        result_file: Path | None = None,
    ) -> None:
        if tk is None:
            raise RuntimeError("Tkinter is not available in this Python installation")
        self.root = tk.Tk()
        self.root.title("阴阳师 ROI 选择器" if select_only else "阴阳师 ROI 标注工具")
        self.root.geometry("1400x900")
        self.root.minsize(900, 600)
        self.output_dir = output_dir.resolve()
        self.reference_width = reference_width
        self.reference_height = reference_height
        self.capture = capture
        self.initial_image = initial_image
        self.select_only = bool(select_only)
        self.result_file = result_file.resolve() if result_file is not None else None
        self.live_enabled = bool(capture is not None and live)
        self.live_interval_ms = max(100, min(5000, int(live_interval_ms)))
        self.capture_device: MumuDevice | None = None
        self.live_job: str | None = None
        self.image: Any | None = None
        self.source_path: Path | None = None
        self.regions: list[RoiRegion] = []
        self.selected_index: int | None = None
        self.capture_rect: tuple[int, int, int, int] | None = None
        self.selection_mode = "capture" if self.select_only else "roi"
        self.photo: Any | None = None
        self.image_origin = (0, 0)
        self.display_size = (0, 0)
        self.display_scale = 1.0
        self.drag_start: tuple[int, int] | None = None
        self.drag_current: tuple[int, int] | None = None
        self.drag_item: int | None = None
        self.status = tk.StringVar(value="正在准备画面...")
        self._build_ui()
        self.root.protocol("WM_DELETE_WINDOW", self.close)
        self.root.after(100, self._load_initial)

    def _build_ui(self) -> None:
        self.root.grid_rowconfigure(1, weight=1)
        self.root.grid_columnconfigure(0, weight=1)

        toolbar = tk.Frame(self.root, padx=8, pady=8)
        toolbar.grid(row=0, column=0, sticky="ew")
        if self.select_only:
            buttons = (
                ("重新截图", self.capture_current),
                ("打开图片", self.open_image),
                ("确认选择", self.confirm_selection),
            )
        else:
            buttons = (
                ("重新截图", self.capture_current),
                ("打开图片", self.open_image),
                ("保存标注图", self.save_annotated),
                ("截取区域为 PNG", self.crop_selected),
                ("导出 ROI JSON", self.export_json),
                ("删除 ROI", self.delete_selected),
                ("清空 ROI", self.clear_regions),
            )
        for label, command in buttons:
            tk.Button(toolbar, text=label, command=command, padx=8).pack(side="left", padx=3)
        if not self.select_only:
            tk.Label(toolbar, text="框选模式").pack(side="left", padx=(12, 2))
            self.mode_var = tk.StringVar(value=self.selection_mode)
            tk.Radiobutton(
                toolbar,
                text="ROI 标注",
                value="roi",
                variable=self.mode_var,
                command=self.on_mode_change,
                indicatoron=False,
                padx=6,
            ).pack(side="left")
            tk.Radiobutton(
                toolbar,
                text="截取区",
                value="capture",
                variable=self.mode_var,
                command=self.on_mode_change,
                indicatoron=False,
                padx=6,
            ).pack(side="left")
            self.live_var = tk.BooleanVar(value=self.live_enabled)
            tk.Checkbutton(
                toolbar,
                text="实时捕获",
                variable=self.live_var,
                command=self.toggle_live,
            ).pack(side="left", padx=(12, 2))
            tk.Label(toolbar, text="刷新(ms)", fg="#555555").pack(side="left")
            self.interval_var = tk.StringVar(value=str(self.live_interval_ms))
            tk.Spinbox(
                toolbar,
                from_=100,
                to=5000,
                increment=50,
                width=6,
                textvariable=self.interval_var,
                command=self.update_interval,
            ).pack(side="left", padx=(2, 8))
        tk.Label(
            toolbar,
            text=f"参考分辨率 {self.reference_width}×{self.reference_height}",
            fg="#555555",
        ).pack(side="right", padx=8)

        body = tk.Frame(self.root)
        body.grid(row=1, column=0, sticky="nsew")
        body.grid_rowconfigure(0, weight=1)
        body.grid_columnconfigure(0, weight=1)

        self.canvas = tk.Canvas(body, background="#202020", highlightthickness=0)
        self.canvas.grid(row=0, column=0, sticky="nsew")
        self.canvas.bind("<Configure>", lambda _event: self.render())
        self.canvas.bind("<ButtonPress-1>", self.on_press)
        self.canvas.bind("<B1-Motion>", self.on_motion)
        self.canvas.bind("<ButtonRelease-1>", self.on_release)

        side = tk.Frame(body, width=300, padx=8, pady=8)
        side.grid(row=0, column=1, sticky="ns")
        side.grid_propagate(False)
        tk.Label(side, text="识别区域" if self.select_only else "ROI 标注（运行时区域）").pack(anchor="w")
        self.region_list = tk.Listbox(side, width=36, height=25, exportselection=False)
        self.region_list.pack(fill="both", expand=True, pady=(6, 8))
        self.region_list.bind("<<ListboxSelect>>", self.on_list_select)
        self.capture_info = tk.StringVar(value=("识别区" if self.select_only else "截取区") + "：未设置")
        tk.Label(side, textvariable=self.capture_info, justify="left", fg="#008c99").pack(
            anchor="w", pady=(0, 8)
        )
        tk.Button(side, text="清除选择" if self.select_only else "清除截取区", command=self.clear_capture_rect, padx=8).pack(
            anchor="w", pady=(0, 8)
        )
        tk.Label(
            side,
            text=(
                "拖动框选识别区域，确认后返回工作流编辑器。"
                if self.select_only
                else "ROI 标注模式：框选后填写名称并加入 ROI 列表。\n截取区模式：框选一个独立区域，用于裁剪 PNG。"
            ),
            justify="left",
            fg="#666666",
        ).pack(anchor="w", pady=(0, 8))

        tk.Label(self.root, textvariable=self.status, anchor="w", padx=8, pady=5).grid(
            row=2,
            column=0,
            sticky="ew",
        )

    def _load_initial(self) -> None:
        if self.initial_image is not None:
            self.load_image(self.initial_image)
        elif self.capture is not None:
            self.capture_current()
        else:
            self.status.set("请打开图片，或使用 MuMu 配置启动工具。")
            self.render()

    def _set_image(self, image: Any, source_path: Path | None, *, reset_regions: bool = True) -> None:
        previous_shape = self.image.shape[:2] if self.image is not None else None
        self.image = image.copy()
        if source_path is not None:
            self.source_path = source_path.resolve()
        if reset_regions or previous_shape != self.image.shape[:2]:
            self.regions.clear()
            self.selected_index = None
            self.capture_rect = None
            self.refresh_region_list()
        else:
            self._update_capture_info()
        height, width = self.image.shape[:2]
        self.status.set(f"已载入 {width}×{height} 画面。拖动鼠标框选 ROI。")
        self.render()

    def on_mode_change(self) -> None:
        self.selection_mode = self.mode_var.get()
        if self.selection_mode == "capture":
            self.status.set("截取区模式：拖动框选一个独立的截图区域。")
        else:
            self.status.set("ROI 标注模式：拖动框选后填写区域名称。")

    def _update_capture_info(self) -> None:
        if self.capture_rect is None or self.image is None:
            self.capture_info.set(("识别区" if self.select_only else "截取区") + "：未设置")
            return
        image_height, image_width = self.image.shape[:2]
        reference = RoiRegion("capture", "识别区" if self.select_only else "截取区", *self.capture_rect).reference_rect(
            image_width,
            image_height,
            self.reference_width,
            self.reference_height,
        )
        label = "识别区" if self.select_only else "截取区"
        self.capture_info.set(f"{label}：{list(self.capture_rect)}\n参考：{reference}")

    def load_image(self, path: Path) -> None:
        try:
            self._set_image(read_image(path), path)
        except (AutomationError, OSError, ValueError) as exc:
            self.show_error(f"打开图片失败：{exc}")

    def capture_current(self) -> None:
        if self.capture is None:
            self.show_error("当前没有 MuMu 捕获配置。请使用 --config 或 --mumu-path 启动。")
            return
        try:
            image = self._capture_image()
            capture_dir = self.output_dir / "captures"
            capture_path = capture_dir / f"mumu-{datetime.now().strftime('%Y%m%d-%H%M%S')}.png"
            write_png(capture_path, image)
            self._set_image(image, capture_path, reset_regions=self.image is None or self.select_only)
            if self.live_enabled:
                self.status.set(f"实时捕获中：{capture_path}")
                self._schedule_live_capture(delay_ms=0)
            else:
                self.status.set(f"已截图并载入：{capture_path}")
        except (AutomationError, DeviceError, OSError, ValueError) as exc:
            self.show_error(f"MuMu 截图失败：{exc}")

    def _capture_image(self) -> Any:
        if self.capture is None:
            raise DeviceError("当前没有 MuMu 捕获配置")
        if self.capture_device is None:
            self.capture_device = MumuDevice(
                self.capture["mumu_path"],
                self.capture["instance_index"],
                self.capture["package"],
            )
            self.capture_device.connect()
        try:
            return frame_to_bgr(self.capture_device.capture()).copy()
        except (AutomationError, DeviceError, OSError, ValueError):
            self.capture_device.close()
            self.capture_device = None
            raise

    def toggle_live(self) -> None:
        self.live_enabled = bool(self.live_var.get())
        if self.live_enabled:
            self.status.set("正在启动实时捕获...")
            self._schedule_live_capture(delay_ms=0)
        else:
            self._stop_live_capture()
            self.status.set("实时捕获已暂停。")

    def update_interval(self) -> None:
        try:
            value = int(self.interval_var.get())
        except (TypeError, ValueError):
            self.interval_var.set(str(self.live_interval_ms))
            return
        self.live_interval_ms = max(100, min(5000, value))
        self.interval_var.set(str(self.live_interval_ms))
        if self.live_enabled:
            self._stop_live_capture()
            self._schedule_live_capture(delay_ms=self.live_interval_ms)

    def _schedule_live_capture(self, *, delay_ms: int | None = None) -> None:
        if not self.live_enabled or self.capture is None or self.live_job is not None:
            return
        delay = self.live_interval_ms if delay_ms is None else max(0, delay_ms)
        self.live_job = self.root.after(delay, self._poll_live_capture)

    def _poll_live_capture(self) -> None:
        self.live_job = None
        if not self.live_enabled or self.capture is None:
            return
        try:
            image = self._capture_image()
            self._set_image(image, None, reset_regions=False)
            height, width = image.shape[:2]
            self.status.set(
                f"实时捕获中 · {width}×{height} · {datetime.now().strftime('%H:%M:%S')}"
            )
        except (AutomationError, DeviceError, OSError, ValueError) as exc:
            self.status.set(f"实时捕获失败，将重试：{exc}")
        finally:
            self._schedule_live_capture()

    def _stop_live_capture(self) -> None:
        if self.live_job is not None:
            self.root.after_cancel(self.live_job)
            self.live_job = None

    def close(self) -> None:
        self.live_enabled = False
        self._stop_live_capture()
        if self.capture_device is not None:
            self.capture_device.close()
            self.capture_device = None
        self.root.destroy()

    def open_image(self) -> None:
        if filedialog is None:
            return
        if hasattr(self, "live_var"):
            self.live_var.set(False)
        self.live_enabled = False
        self._stop_live_capture()
        selected = filedialog.askopenfilename(
            title="打开截图",
            filetypes=[("图片", "*.png *.jpg *.jpeg *.bmp"), ("全部文件", "*.*")],
        )
        if selected:
            self.load_image(Path(selected))

    def _image_point(self, event: Any) -> tuple[int, int] | None:
        if self.image is None or self.display_size[0] < 1 or self.display_size[1] < 1:
            return None
        origin_x, origin_y = self.image_origin
        display_width, display_height = self.display_size
        if not origin_x <= event.x <= origin_x + display_width or not origin_y <= event.y <= origin_y + display_height:
            return None
        image_height, image_width = self.image.shape[:2]
        x = round((event.x - origin_x) / self.display_scale)
        y = round((event.y - origin_y) / self.display_scale)
        return max(0, min(image_width, x)), max(0, min(image_height, y))

    def on_press(self, event: Any) -> None:
        point = self._image_point(event)
        if point is None:
            self.drag_start = None
            return
        self.drag_start = point
        self.drag_current = point
        if self.drag_item is not None:
            self.canvas.delete(self.drag_item)
        self.drag_item = self.canvas.create_rectangle(
            event.x,
            event.y,
            event.x,
            event.y,
            outline="#ffd166",
            width=2,
            dash=(4, 2),
        )

    def on_motion(self, event: Any) -> None:
        if self.drag_start is None or self.drag_item is None:
            return
        point = self._image_point(event)
        if point is None:
            return
        self.drag_current = point
        canvas_x, canvas_y = self._canvas_point(*point)
        start_x, start_y = self._canvas_point(*self.drag_start)
        self.canvas.coords(self.drag_item, start_x, start_y, canvas_x, canvas_y)

    def on_release(self, event: Any) -> None:
        if self.drag_start is None or self.image is None:
            return
        point = self._image_point(event)
        if point is None:
            point = self.drag_current or self.drag_start
        image_height, image_width = self.image.shape[:2]
        rect = normalize_rect(
            self.drag_start[0],
            self.drag_start[1],
            point[0],
            point[1],
            image_width,
            image_height,
        )
        if self.drag_item is not None:
            self.canvas.delete(self.drag_item)
        self.drag_item = None
        self.drag_start = None
        self.drag_current = None
        if self.selection_mode == "capture":
            self.capture_rect = rect
            self.status.set(
                ("已清除选择。" if self.select_only else "已清除截取区。")
                if rect is None
                else (
                    f"已选择识别区域：{list(rect)}，点击“确认选择”返回。"
                    if self.select_only
                    else f"已设置截取区：{list(rect)}，点击“截取区域为 PNG”保存。"
                )
            )
            self.refresh_region_list()
            self.render()
            return
        if rect is None or simpledialog is None:
            self.render()
            return
        default_label = f"roi_{len(self.regions) + 1}"
        label = simpledialog.askstring(
            "标注 ROI",
            "请输入区域名称：",
            initialvalue=default_label,
            parent=self.root,
        )
        if label is None:
            self.render()
            return
        x, y, width, height = rect
        region = RoiRegion(default_label, label.strip() or default_label, x, y, width, height)
        self.regions.append(region)
        self.selected_index = len(self.regions) - 1
        self.refresh_region_list()
        self.status.set(f"已添加 {region.region_id}：{region.label}")
        self.render()

    def _canvas_point(self, x: int, y: int) -> tuple[int, int]:
        return (
            self.image_origin[0] + round(x * self.display_scale),
            self.image_origin[1] + round(y * self.display_scale),
        )

    def render(self) -> None:
        self.canvas.delete("all")
        self.drag_item = None
        if self.image is None:
            self.canvas.create_text(
                max(1, self.canvas.winfo_width() // 2),
                max(1, self.canvas.winfo_height() // 2),
                text="没有载入截图",
                fill="#aaaaaa",
            )
            return
        try:
            import cv2

            image_height, image_width = self.image.shape[:2]
            canvas_width = max(1, self.canvas.winfo_width())
            canvas_height = max(1, self.canvas.winfo_height())
            self.display_scale = min(
                1.0,
                max(1.0, canvas_width - 20) / image_width,
                max(1.0, canvas_height - 20) / image_height,
            )
            display_width = max(1, round(image_width * self.display_scale))
            display_height = max(1, round(image_height * self.display_scale))
            self.display_size = display_width, display_height
            self.image_origin = (
                (canvas_width - display_width) // 2,
                (canvas_height - display_height) // 2,
            )
            if display_width == image_width and display_height == image_height:
                display = self.image
            else:
                display = cv2.resize(self.image, (display_width, display_height), interpolation=cv2.INTER_AREA)
            self.photo = tk.PhotoImage(data=encode_tk_png(display), format="png")
            self.canvas.create_image(*self.image_origin, image=self.photo, anchor="nw")
            if self.capture_rect is not None:
                left, top = self._canvas_point(self.capture_rect[0], self.capture_rect[1])
                right, bottom = self._canvas_point(
                    self.capture_rect[0] + self.capture_rect[2],
                    self.capture_rect[1] + self.capture_rect[3],
                )
                self.canvas.create_rectangle(left, top, right, bottom, outline="#4dd0e1", width=2)
                self.canvas.create_text(
                    left + 4,
                    top + 4,
                    text="识别区" if self.select_only else "截取区",
                    anchor="nw",
                    fill="#4dd0e1",
                    font=("Segoe UI", 10, "bold"),
                )
            for index, region in enumerate(self.regions):
                left, top = self._canvas_point(region.x, region.y)
                right, bottom = self._canvas_point(region.x + region.width, region.y + region.height)
                color = "#ffd166" if index == self.selected_index else "#ff5c5c"
                self.canvas.create_rectangle(left, top, right, bottom, outline=color, width=2)
                self.canvas.create_text(
                    left + 4,
                    top + 4,
                    text=f"{region.region_id} {region.label}",
                    anchor="nw",
                    fill=color,
                    font=("Segoe UI", 10, "bold"),
                )
            if self.drag_start is not None and self.drag_current is not None:
                start_x, start_y = self._canvas_point(*self.drag_start)
                current_x, current_y = self._canvas_point(*self.drag_current)
                self.drag_item = self.canvas.create_rectangle(
                    start_x,
                    start_y,
                    current_x,
                    current_y,
                    outline="#ffd166",
                    width=2,
                    dash=(4, 2),
                )
        except (ImportError, VisionError, ValueError) as exc:
            self.status.set(f"画面渲染失败：{exc}")

    def refresh_region_list(self) -> None:
        self.region_list.delete(0, tk.END)
        self._update_capture_info()
        if self.image is None:
            return
        image_height, image_width = self.image.shape[:2]
        for region in self.regions:
            reference = region.reference_rect(
                image_width,
                image_height,
                self.reference_width,
                self.reference_height,
            )
            self.region_list.insert(
                tk.END,
                f"{region.region_id}  {region.label}  {reference}",
            )
        if self.selected_index is not None and self.selected_index < len(self.regions):
            self.region_list.selection_set(self.selected_index)
            self.region_list.see(self.selected_index)

    def on_list_select(self, _event: Any) -> None:
        selection = self.region_list.curselection()
        self.selected_index = int(selection[0]) if selection else None
        self.render()

    def delete_selected(self) -> None:
        if self.selected_index is None or self.selected_index >= len(self.regions):
            return
        removed = self.regions.pop(self.selected_index)
        self.selected_index = min(self.selected_index, len(self.regions) - 1) if self.regions else None
        self.refresh_region_list()
        self.status.set(f"已删除 {removed.region_id}")
        self.render()

    def clear_regions(self) -> None:
        if not self.regions:
            return
        if messagebox is not None and not messagebox.askyesno("清空标注", "确定清空所有 ROI 标注吗？", parent=self.root):
            return
        self.regions.clear()
        self.selected_index = None
        self.refresh_region_list()
        self.status.set("已清空标注")
        self.render()

    def clear_capture_rect(self) -> None:
        self.capture_rect = None
        self.status.set("已清除选择" if self.select_only else "已清除截取区")
        self.refresh_region_list()
        self.render()

    def confirm_selection(self) -> None:
        if not self.select_only or self.image is None or self.capture_rect is None:
            self.show_error("请先在 MuMu 截图上框选识别区域。")
            return
        if self.result_file is None:
            self.show_error("ROI 选择结果路径未配置。")
            return
        image_height, image_width = self.image.shape[:2]
        try:
            write_selection_result(
                self.result_file,
                self.capture_rect,
                image_width,
                image_height,
                self.reference_width,
                self.reference_height,
            )
            self.status.set(f"已确认识别区域：{list(self.capture_rect)}")
            self.close()
        except OSError as exc:
            self.show_error(f"保存识别区域失败：{exc}")

    def crop_selected(self) -> None:
        if self.image is None or self.capture_rect is None:
            self.show_error("请切换到“截取区”模式并先框选截取区域。")
            return
        if filedialog is None:
            return
        default_name = "capture_rect.png"
        selected = filedialog.asksaveasfilename(
            title="保存截取区",
            initialdir=str(self.output_dir / "crops"),
            initialfile=default_name,
            defaultextension=".png",
            filetypes=[("PNG 图片", "*.png")],
        )
        if not selected:
            return
        x, y, width, height = self.capture_rect
        try:
            path = write_png(Path(selected), self.image[y : y + height, x : x + width])
            self.status.set(f"截取区已保存：{path}")
        except (AutomationError, OSError, ValueError) as exc:
            self.show_error(f"裁剪失败：{exc}")

    def save_annotated(self) -> None:
        if self.image is None:
            self.show_error("当前没有截图。")
            return
        if filedialog is None:
            return
        default_name = safe_filename(self.source_path.stem if self.source_path else "mumu-current", "mumu-current") + "-annotated.png"
        selected = filedialog.asksaveasfilename(
            title="保存标注图",
            initialdir=str(self.output_dir),
            initialfile=default_name,
            defaultextension=".png",
            filetypes=[("PNG 图片", "*.png")],
        )
        if not selected:
            return
        try:
            import cv2

            annotated = self.image.copy()
            if self.capture_rect is not None:
                x, y, width, height = self.capture_rect
                cv2.rectangle(
                    annotated,
                    (x, y),
                    (x + width - 1, y + height - 1),
                    (255, 200, 0),
                    3,
                )
                cv2.putText(
                    annotated,
                    "CAPTURE",
                    (x + 4, max(20, y + 22)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.7,
                    (255, 200, 0),
                    2,
                    cv2.LINE_AA,
                )
            for index, region in enumerate(self.regions, start=1):
                cv2.rectangle(
                    annotated,
                    (region.x, region.y),
                    (region.x + region.width - 1, region.y + region.height - 1),
                    (0, 80, 255),
                    3,
                )
                cv2.putText(
                    annotated,
                    f"ROI-{index}",
                    (region.x + 4, max(20, region.y + 22)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.7,
                    (0, 80, 255),
                    2,
                    cv2.LINE_AA,
                )
            path = write_png(Path(selected), annotated)
            self.status.set(f"标注图已保存：{path}")
        except (AutomationError, ImportError, OSError, ValueError) as exc:
            self.show_error(f"保存标注图失败：{exc}")

    def export_json(self) -> None:
        if self.image is None:
            self.show_error("当前没有截图。")
            return
        if filedialog is None:
            return
        selected = filedialog.asksaveasfilename(
            title="导出 ROI JSON",
            initialdir=str(self.output_dir),
            initialfile="roi.json",
            defaultextension=".json",
            filetypes=[("JSON 文件", "*.json")],
        )
        if not selected:
            return
        image_height, image_width = self.image.shape[:2]
        payload = export_payload(
            self.source_path,
            image_width,
            image_height,
            self.regions,
            self.reference_width,
            self.reference_height,
            self.capture_rect,
        )
        try:
            path = Path(selected)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            self.status.set(f"ROI JSON 已导出：{path}")
        except OSError as exc:
            self.show_error(f"导出 JSON 失败：{exc}")

    def show_error(self, message: str) -> None:
        self.status.set(message)
        if messagebox is not None:
            messagebox.showerror("ROI 标注工具", message, parent=self.root)

    def run(self) -> None:
        self.root.mainloop()


def _capture_settings(args: argparse.Namespace) -> dict[str, Any] | None:
    mumu_path = args.mumu_path
    instance_index = args.index if args.index is not None else 0
    package = args.package or DEFAULT_PACKAGE
    if args.config is not None:
        config = load_config(args.config)
        instance = config.instance(args.instance)
        if instance.backend != "mumu":
            raise AutomationError(f"ROI editor requires a MuMu instance, got backend={instance.backend}")
        if mumu_path is None:
            mumu_path = config.mumu_path
        if args.index is None:
            instance_index = instance.mumu_index
        if args.package is None:
            package = instance.package or DEFAULT_PACKAGE
    if mumu_path is None:
        mumu_path = discover_mumu_path()
    if mumu_path is None:
        raise AutomationError("MuMu installation was not found; pass --mumu-path or use --image")
    return {
        "mumu_path": Path(mumu_path),
        "instance_index": instance_index,
        "package": package,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, help="JSON 配置路径，用于读取 MuMu 实例设置")
    parser.add_argument("--instance", default="mumu-0", help="配置中的 MuMu 实例 ID")
    parser.add_argument("--mumu-path", type=Path, help="MuMu 安装目录")
    parser.add_argument("--index", type=int, help="MuMu 多开实例编号")
    parser.add_argument("--package", help="用于选择 MuMu 显示的应用包名")
    parser.add_argument("--image", type=Path, help="打开已有截图，不连接 MuMu")
    parser.add_argument(
        "--interval-ms",
        type=int,
        default=250,
        help="实时捕获刷新间隔，范围 100-5000 毫秒",
    )
    parser.add_argument(
        "--no-live",
        action="store_true",
        help="启动时只捕获一次，不自动刷新 MuMu 画面",
    )
    parser.add_argument(
        "--select-roi",
        action="store_true",
        help="打开单次 ROI 选择模式，确认后将结果写入 --result-file",
    )
    parser.add_argument(
        "--capture-only",
        action="store_true",
        help="只捕获一帧 MuMu 画面并将 PNG base64 写入 --result-file",
    )
    parser.add_argument("--result-file", type=Path, help="单次 ROI 选择模式的结果 JSON 路径")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=PROJECT_ROOT / "artifacts" / "roi-editor",
        help="截图、裁剪图和导出文件的默认目录",
    )
    parser.add_argument("--reference-width", type=int, default=1920)
    parser.add_argument("--reference-height", type=int, default=1080)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.reference_width < 1 or args.reference_height < 1:
        print("参考分辨率必须为正数。", file=sys.stderr)
        return 2
    if not 100 <= args.interval_ms <= 5000:
        print("实时捕获刷新间隔必须在 100-5000 毫秒之间。", file=sys.stderr)
        return 2
    if (args.select_roi or args.capture_only) != (args.result_file is not None):
        print("--select-roi 或 --capture-only 必须和 --result-file 一起使用。", file=sys.stderr)
        return 2
    if args.select_roi and args.capture_only:
        print("--select-roi 和 --capture-only 不能同时使用。", file=sys.stderr)
        return 2
    if args.capture_only and args.image is not None:
        print("--capture-only 不能和 --image 一起使用。", file=sys.stderr)
        return 2
    try:
        if args.capture_only:
            capture = _capture_settings(args)
            if capture is None:
                raise AutomationError("当前没有 MuMu 捕获配置")
            capture_result(capture, args.result_file)
            return 0
        capture = None if args.image is not None else _capture_settings(args)
        editor = RoiEditor(
            output_dir=args.output_dir,
            reference_width=args.reference_width,
            reference_height=args.reference_height,
            capture=capture,
            initial_image=args.image,
            live=args.image is None and not args.no_live and not args.select_roi,
            live_interval_ms=args.interval_ms,
            select_only=args.select_roi,
            result_file=args.result_file,
        )
        editor.run()
        return 0
    except (AutomationError, OSError, RuntimeError, ValueError) as exc:
        print(f"ROI editor error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
