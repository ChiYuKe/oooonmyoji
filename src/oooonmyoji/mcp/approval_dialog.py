"""Local confirmation window for gated MCP operations.

The MCP server runs this module as a separate process whenever a tool needs
human approval.  The model cannot answer this window: nothing in the MCP tool
surface can write the decision file, and the file lives in a temporary directory
that only the broker and this window know about.

The window follows the desktop app's dialog language, taken from
`desktop/public/theme/theme.css` (see `src/oooonmyoji/ui/theme.py`): a self-drawn
title bar, `--ui-surface` header/footer over an `--ui-panel` body, `--ui-field`
content box with a `--border` hairline, flat controls that change only their
background on hover, one primary command, a plain secondary, a `color-mix`
danger button, and a thin floating scrollbar with no arrow buttons.

Exit codes: 0 answered, 2 request file unreadable, 3 Tk unavailable.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from functools import partial
from pathlib import Path
from typing import Any, Literal

try:
    import tkinter as tk
    from tkinter import font as tkfont
except ImportError:  # pragma: no cover - Python builds without Tk
    tk = None  # type: ignore[assignment]
    tkfont = None  # type: ignore[assignment]

from ..ui.theme import DARK, FONT_STACK, MONO_STACK, accent_for, enable_dark_titlebar, mix, pick_family
from .approval import RISK_HINTS, RISK_TITLES

WINDOW_WIDTH = 720
BODY_HEIGHT = 420
TITLEBAR_HEIGHT = 30
HEADER_HEIGHT = 30
FOOTER_HEIGHT = 46
WARN_SECONDS = 20.0

# 字号按应用 11/12px 的 UI 字号折算（Tk 用 pt），保持两边密度一致。
SIZE_BODY = 9
SIZE_SMALL = 8
SIZE_MONO = 9

FontWeight = Literal["normal", "bold"]
FontSpec = tuple[str, int, FontWeight]


def load_request(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("approval request must be a JSON object")
    return payload


def write_result(path: Path, decision: str, reason: str = "") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "decision": decision,
        "reason": reason,
        "decided_at": datetime.now(timezone.utc).isoformat(),
        "decided_by_pid": os.getpid(),
    }
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def rounded_points(x1: float, y1: float, x2: float, y2: float, radius: float) -> list[float]:
    """Corner points for a smooth polygon, i.e. a rounded rectangle."""

    radius = max(0.0, min(radius, (x2 - x1) / 2, (y2 - y1) / 2))
    return [
        x1 + radius, y1,
        x2 - radius, y1,
        x2, y1,
        x2, y1 + radius,
        x2, y2 - radius,
        x2, y2,
        x2 - radius, y2,
        x1 + radius, y2,
        x1, y2,
        x1, y2 - radius,
        x1, y1 + radius,
        x1, y1,
    ]


class RoundedButton:
    """平面圆角按钮：只换底色，主命令用 --ui-selected，危险操作用混色。"""

    def __init__(
        self,
        parent: Any,
        *,
        text: str,
        command: Any,
        font: FontSpec,
        fill: str,
        border: str,
        hover_fill: str,
        hover_border: str,
        foreground: str,
        padx: int = 12,
        pady: int = 5,
        radius: int = 4,
        width: int | None = None,
    ) -> None:
        assert tk is not None
        measure = tkfont.Font(family=font[0], size=font[1], weight=font[2])
        text_width = measure.measure(text)
        text_height = measure.metrics("linespace")
        self._width = width or text_width + padx * 2
        self._height = text_height + pady * 2
        self._radius = radius
        self._text = text
        self._font = font
        self._states = {
            "normal": (fill, border, foreground),
            "hover": (hover_fill, hover_border, foreground),
        }
        self._command = command
        # Canvas 自带的 1px 焦点框，保证键盘可达性；悬停不改边框粗细。
        self.canvas = tk.Canvas(
            parent,
            width=self._width,
            height=self._height,
            bg=parent.cget("bg"),
            highlightthickness=1,
            highlightbackground=parent.cget("bg"),
            highlightcolor=DARK["focus"],
            takefocus=True,
            cursor="hand2",
            bd=0,
        )
        self.canvas.bind("<Enter>", lambda _event: self._paint("hover"))
        self.canvas.bind("<Leave>", lambda _event: self._paint("normal"))
        self.canvas.bind("<Button-1>", lambda _event: self._command())
        self._paint("normal")

    def pack(self, **kwargs: Any) -> "RoundedButton":
        self.canvas.pack(**kwargs)
        return self

    def _paint(self, state: str) -> None:
        fill, border, foreground = self._states[state]
        self.canvas.delete("all")
        self.canvas.create_polygon(
            rounded_points(0.5, 0.5, self._width - 0.5, self._height - 0.5, self._radius),
            smooth=True,
            splinesteps=12,
            fill=fill,
            outline=border,
            width=1,
        )
        text_height = tkfont.Font(family=self._font[0], size=self._font[1], weight=self._font[2]).metrics("linespace")
        self.canvas.create_text(
            self._width / 2,
            (self._height - text_height) / 2 + 1,
            text=self._text,
            fill=foreground,
            font=self._font,
            anchor="n",
        )


class ThinScrollbar:
    """细滚动条：只有一颗浮动滑块，没有轨道底色，也没有箭头按钮。"""

    def __init__(self, parent: Any, *, command: Any, track: str, thumb: str, active: str, width: int = 10) -> None:
        assert tk is not None
        self._command = command
        self._thumb = thumb
        self._active = active
        self._first = 0.0
        self._last = 1.0
        self._drag_origin: float | None = None
        self._drag_first = 0.0
        self.canvas = tk.Canvas(parent, width=width, bg=track, highlightthickness=0, bd=0)
        self.canvas.bind("<Configure>", lambda _event: self._redraw())
        self.canvas.bind("<Button-1>", self._on_press)
        self.canvas.bind("<B1-Motion>", self._on_drag)
        self.canvas.bind("<ButtonRelease-1>", lambda _event: setattr(self, "_drag_origin", None))
        self.canvas.bind("<MouseWheel>", lambda event: self._command("scroll", -1 if event.delta > 0 else 1, "units"))
        self.canvas.bind("<Enter>", lambda _event: self._redraw(active=True))
        self.canvas.bind("<Leave>", lambda _event: self._redraw(active=False))
        self._hover = False

    def set(self, first: str | float, last: str | float) -> None:
        self._first, self._last = float(first), float(last)
        self._redraw()

    def _thumb_box(self) -> tuple[float, float, float, float] | None:
        height = self.canvas.winfo_height()
        if height < 4 or self._last - self._first >= 0.999:
            return None
        top = self._first * height
        bottom = max(top + 24, self._last * height)
        if bottom > height:
            bottom = height
            top = max(0.0, bottom - 24)
        return 1.0, top + 1, 9.0, bottom - 1

    def _redraw(self, *, active: bool | None = None) -> None:
        if active is not None:
            self._hover = active
        self.canvas.delete("all")
        box = self._thumb_box()
        if box is None:
            return
        color = self._active if self._hover else self._thumb
        self.canvas.create_polygon(
            rounded_points(*box, 4),
            smooth=True,
            splinesteps=12,
            fill=color,
            outline=color,
        )

    def _on_press(self, event: Any) -> None:
        box = self._thumb_box()
        if box is None:
            return
        if box[1] <= event.y <= box[3]:
            self._drag_origin = float(event.y)
            self._drag_first = self._first
            return
        # 点空白处 = 翻页，与应用里点击轨道的行为一致。
        self._command("scroll", 1 if event.y > box[3] else -1, "pages")

    def _on_drag(self, event: Any) -> None:
        if self._drag_origin is None:
            return
        height = max(1, self.canvas.winfo_height())
        span = max(1e-6, self._last - self._first)
        target = self._drag_first + (event.y - self._drag_origin) / height
        self._command("moveto", max(0.0, min(1.0 - span, target)))


class ApprovalWindow:
    """One request, three answers: allow once, allow for this session, deny."""

    def __init__(self, request: dict[str, Any], result_path: Path, timeout_seconds: float) -> None:
        assert tk is not None
        self.request = request
        self.result_path = result_path
        self._total = max(5.0, timeout_seconds)
        self.deadline = time.monotonic() + self._total
        self.answered = False
        self._buttons: dict[str, RoundedButton] = {}
        self._drag_offset: tuple[int, int] | None = None

        self.root = tk.Tk()
        self.root.configure(bg=DARK["panel"])
        self.root.resizable(False, False)
        # 自绘标题栏，去掉系统标题栏这条与应用不一致的“第二条 chrome”。
        try:
            self.root.overrideredirect(True)
            self._custom_chrome = True
        except tk.TclError:  # pragma: no cover - 平台不支持无边框窗口
            self._custom_chrome = False
            self.root.title("AutoFlow Studio — MCP 操作确认")
            enable_dark_titlebar(self.root)

        family = pick_family(tkfont.families(self.root), FONT_STACK)
        mono = pick_family(tkfont.families(self.root), MONO_STACK)
        self._family = family
        self._mono = mono

        risk = str(request.get("risk", "execute"))
        self._accent = accent_for(risk)
        self._risk = risk

        chrome = self._measure_chrome()
        height = chrome + BODY_HEIGHT
        screen_width = self.root.winfo_screenwidth()
        screen_height = self.root.winfo_screenheight()
        x = max(0, (screen_width - WINDOW_WIDTH) // 2)
        y = max(0, (screen_height - height) // 3)
        self.root.geometry(f"{WINDOW_WIDTH}x{height}+{x}+{y}")

        self._build_titlebar(family)
        self._build_header(request, family)
        self._build_body(request, family, mono)
        self._build_footer(request, family)

        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self.root.bind_all("<Escape>", lambda _event: self._answer("deny", "escape pressed"))
        self.root.bind_all("<Control-Return>", lambda _event: self._answer("allow", "keyboard confirm"))
        self._tick_id: str | None = self.root.after(200, self._tick)
        self.root.lift()
        try:
            self.root.focus_force()
        except tk.TclError:  # pragma: no cover - window manager dependent
            pass

    @staticmethod
    def _measure_chrome() -> int:
        return TITLEBAR_HEIGHT + 1 + HEADER_HEIGHT + 1 + 1 + FOOTER_HEIGHT

    # ---- layout --------------------------------------------------------

    def _build_titlebar(self, family: str) -> None:
        bar = tk.Frame(self.root, bg=DARK["chrome"], height=TITLEBAR_HEIGHT)
        bar.pack(fill="x")
        bar.pack_propagate(False)
        if self._custom_chrome:
            for widget in (bar,):
                widget.bind("<Button-1>", self._start_drag)
                widget.bind("<B1-Motion>", self._on_drag)

        mark = tk.Canvas(bar, width=14, height=14, bg=DARK["chrome"], highlightthickness=0)
        mark.create_polygon(
            rounded_points(0.5, 0.5, 13.5, 13.5, 3),
            smooth=True,
            splinesteps=10,
            fill=DARK["surface"],
            outline=DARK["border"],
        )
        mark.create_text(7, 7, text="A", fill=DARK["text"], font=(family, 7, "bold"))
        mark.pack(side="left", padx=(10, 6))
        if self._custom_chrome:
            mark.bind("<Button-1>", self._start_drag)
            mark.bind("<B1-Motion>", self._on_drag)

        label = tk.Label(bar, text="AutoFlow Studio — MCP 操作确认", bg=DARK["chrome"], fg=DARK["muted"], font=(family, SIZE_SMALL))
        label.pack(side="left")
        if self._custom_chrome:
            label.bind("<Button-1>", self._start_drag)
            label.bind("<B1-Motion>", self._on_drag)

        if self._custom_chrome:
            close = tk.Label(bar, text="✕", bg=DARK["chrome"], fg=DARK["muted"], font=(family, SIZE_SMALL), padx=12)
            close.pack(side="right", fill="y")
            close.bind("<Enter>", lambda _event: close.configure(bg=DARK["hover"], fg=DARK["text"]))
            close.bind("<Leave>", lambda _event: close.configure(bg=DARK["chrome"], fg=DARK["muted"]))
            close.bind("<Button-1>", lambda _event: self._on_close())
        else:  # pragma: no cover - fallback path
            tk.Frame(bar, bg=DARK["chrome"], width=6).pack(side="right")

        tk.Frame(self.root, bg=DARK["line"], height=1).pack(fill="x")

    def _build_header(self, request: dict[str, Any], family: str) -> None:
        header = tk.Frame(self.root, bg=DARK["surface"], height=HEADER_HEIGHT)
        header.pack(fill="x")
        header.pack_propagate(False)

        dot = tk.Canvas(header, width=10, height=10, bg=DARK["surface"], highlightthickness=0)
        dot.create_oval(1, 1, 9, 9, fill=self._accent, outline=self._accent)
        dot.pack(side="left", padx=(12, 7))

        tk.Label(
            header,
            text=RISK_TITLES.get(self._risk, self._risk),
            bg=DARK["surface"],
            fg=DARK["text"],
            font=(family, SIZE_BODY, "bold"),
        ).pack(side="left")

        tk.Label(
            header,
            text=f"请求 {str(request.get('request_id', ''))[:8]}",
            bg=DARK["surface"],
            fg=DARK["muted"],
            font=(family, SIZE_SMALL),
        ).pack(side="right", padx=(0, 12))

        tk.Frame(self.root, bg=DARK["line"], height=1).pack(fill="x")

    def _build_body(self, request: dict[str, Any], family: str, mono: str) -> None:
        body = tk.Frame(self.root, bg=DARK["panel"], padx=14, pady=12)
        body.pack(fill="both", expand=True)

        tk.Label(
            body,
            text=str(request.get("summary", "")),
            bg=DARK["panel"],
            fg=DARK["text"],
            font=(family, SIZE_BODY, "bold"),
            wraplength=WINDOW_WIDTH - 32,
            justify="left",
            anchor="w",
        ).pack(fill="x")

        tk.Label(
            body,
            text=RISK_HINTS.get(self._risk, ""),
            bg=DARK["panel"],
            fg=DARK["muted"],
            font=(family, SIZE_SMALL),
            wraplength=WINDOW_WIDTH - 32,
            justify="left",
            anchor="w",
        ).pack(fill="x", pady=(3, 0))

        meta = (
            f"工具 {request.get('tool', '?')}    载荷指纹 {str(request.get('payload_hash', ''))[:12]}    "
            f"MCP 服务进程 {request.get('server_pid', '?')}    {request.get('created_at', '')}"
        )
        tk.Label(body, text=meta, bg=DARK["panel"], fg=DARK["muted"], font=(family, SIZE_SMALL), anchor="w", justify="left").pack(
            fill="x", pady=(8, 0)
        )

        tk.Label(body, text="请求内容", bg=DARK["panel"], fg=DARK["muted"], font=(family, SIZE_SMALL), anchor="w").pack(
            fill="x", pady=(10, 3)
        )

        field = tk.Frame(body, bg=DARK["field"], highlightthickness=1, highlightbackground=DARK["border"])
        field.pack(fill="both", expand=True)
        self._payload = tk.Text(
            field,
            wrap="word",
            height=9,
            font=(mono, SIZE_MONO),
            bg=DARK["field"],
            fg=DARK["text"],
            insertbackground=DARK["focus"],
            selectbackground=DARK["selection"],
            selectforeground=DARK["selection_text"],
            relief="flat",
            bd=0,
            padx=8,
            pady=6,
            highlightthickness=0,
        )
        # 先建文本再建滚动条，避免两边在构造期互相引用。
        self._scrollbar = ThinScrollbar(
            field,
            command=self._payload.yview,
            track=DARK["field"],
            thumb=DARK["scrollbar"],
            active=DARK["scrollbar_hover"],
        )
        self._payload.configure(yscrollcommand=self._scrollbar.set)
        self._scrollbar.canvas.pack(side="right", fill="y", padx=(0, 2), pady=2)
        self._payload.pack(side="left", fill="both", expand=True)
        self._payload.insert("1.0", json.dumps(request.get("payload", {}), ensure_ascii=False, indent=2, default=str))
        self._payload.configure(state="disabled")

        strip = tk.Frame(body, bg=DARK["line"], height=2)
        strip.pack(fill="x", pady=(10, 0))
        self._bar = tk.Frame(strip, bg=DARK["focus"], height=2)
        self._bar.place(x=0, y=0, relwidth=1.0, relheight=1)

        self._countdown = tk.Label(body, bg=DARK["panel"], fg=DARK["muted"], font=(family, SIZE_SMALL), anchor="w")
        self._countdown.pack(fill="x", pady=(6, 0))

    def _build_footer(self, request: dict[str, Any], family: str) -> None:
        tk.Frame(self.root, bg=DARK["line"], height=1).pack(fill="x")
        footer = tk.Frame(self.root, bg=DARK["surface"], padx=12, pady=8, height=FOOTER_HEIGHT)
        footer.pack(fill="x")
        footer.pack_propagate(False)

        tk.Label(
            footer,
            text="Esc 拒绝    Ctrl+Enter 允许一次",
            bg=DARK["surface"],
            fg=DARK["muted"],
            font=(family, SIZE_SMALL),
        ).pack(side="left")

        danger_fill = mix(DARK["red"], DARK["panel"], 0.12)
        self._add_button(
            footer,
            "allow",
            "允许一次",
            family=family,
            fill=DARK["selection"],
            border=DARK["focus"],
            hover_fill=DARK["hover"],
            hover_border=DARK["focus"],
            foreground=DARK["text"],
        )
        self._add_button(
            footer,
            "deny",
            "拒绝",
            family=family,
            fill=danger_fill,
            border=DARK["red"],
            hover_fill=mix(DARK["red"], DARK["panel"], 0.22),
            hover_border=DARK["red"],
            foreground=DARK["red"],
        )
        if bool(request.get("allow_session", True)):
            self._add_button(
                footer,
                "allow_session",
                "本会话都允许此类",
                family=family,
                fill=DARK["surface"],
                border=DARK["border"],
                hover_fill=DARK["hover"],
                hover_border=DARK["focus"],
                foreground=DARK["text"],
            )

    def _add_button(
        self,
        parent: Any,
        decision: str,
        text: str,
        *,
        family: str,
        fill: str,
        border: str,
        hover_fill: str,
        hover_border: str,
        foreground: str,
    ) -> None:
        button = RoundedButton(
            parent,
            text=text,
            command=partial(self._answer, decision),
            font=(family, SIZE_BODY, "normal"),
            fill=fill,
            border=border,
            hover_fill=hover_fill,
            hover_border=hover_border,
            foreground=foreground,
        )
        button.pack(side="right", padx=(8, 0) if decision != "allow_session" else (0, 0))
        self._buttons[decision] = button

    # ---- window drag ---------------------------------------------------

    def _start_drag(self, event: Any) -> None:
        self._drag_offset = (event.x_root - self.root.winfo_x(), event.y_root - self.root.winfo_y())

    def _on_drag(self, event: Any) -> None:
        if self._drag_offset is None:
            return
        self.root.geometry(f"+{event.x_root - self._drag_offset[0]}+{event.y_root - self._drag_offset[1]}")

    # ---- behaviour -----------------------------------------------------

    def _on_close(self) -> None:
        self._answer("deny", "window closed")

    def _tick(self) -> None:
        if self.answered:
            return
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            self._answer("deny", "no answer before timeout")
            return
        total = max(1e-6, self._total)
        self._countdown.configure(
            text=f"{remaining:0.0f} 秒后自动拒绝（超时按拒绝处理）",
            fg=DARK["yellow"] if remaining <= WARN_SECONDS else DARK["muted"],
        )
        self._bar.place_configure(relwidth=max(0.0, min(1.0, remaining / total)))
        self._tick_id = self.root.after(250, self._tick)

    def _answer(self, decision: str, reason: str = "") -> None:
        if self.answered:
            return
        self.answered = True
        # 先撤掉挂起的倒计时回调，避免窗口销毁后 after 脚本再跑一次。
        if self._tick_id is not None:
            try:
                self.root.after_cancel(self._tick_id)
            except tk.TclError:  # pragma: no cover - 窗口已销毁
                pass
            self._tick_id = None
        try:
            write_result(self.result_path, decision, reason)
        finally:
            try:
                self.root.destroy()
            except tk.TclError:  # pragma: no cover - already destroyed
                pass

    def run(self) -> int:
        self.root.mainloop()
        if not self.answered:
            write_result(self.result_path, "deny", "window closed")
        return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", type=Path, required=True, help="审批请求 JSON 路径")
    parser.add_argument("--result", type=Path, required=True, help="写入审批结果的路径")
    parser.add_argument("--timeout", type=float, default=120.0, help="超时秒数，超时按拒绝处理")
    parser.add_argument("--auto-deny", action="store_true", help="不显示窗口，直接拒绝（无人值守场景）")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    request_path = args.request.resolve()
    result_path = args.result.resolve()
    if args.auto_deny:
        write_result(result_path, "deny", "auto-deny requested")
        return 0
    try:
        request = load_request(request_path)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"unable to read approval request: {exc}", file=sys.stderr)
        return 2
    if tk is None:  # pragma: no cover - Python builds without Tk
        print("Tk is unavailable, so the approval window cannot be shown", file=sys.stderr)
        return 3
    try:
        return ApprovalWindow(request, result_path, args.timeout).run()
    except tk.TclError as exc:  # pragma: no cover - no display available
        print(f"unable to open the approval window: {exc}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
