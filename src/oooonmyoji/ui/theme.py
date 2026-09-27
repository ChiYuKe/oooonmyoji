"""Tk 端复用的桌面端主题 token。

数值取自 `desktop/public/theme/theme.css` 的深色主题块（`data-theme="dark"`），
本地 Tk 工具（MCP 审批弹窗、ROI 框选器）据此保持与主程序同一套炭黑层级与语义色。
修改配色时请先改 theme.css，再同步到这里；不要在 Tk 代码里硬编码颜色。
"""

from __future__ import annotations

import sys
from typing import Any

# 深色主题：与 theme.css 的 :root[data-theme="dark"] 一一对应。
DARK: dict[str, str] = {
    "chrome": "#181818",
    "canvas": "#202020",
    "header": "#292929",
    "selection": "#414141",
    "selection_text": "#f2f2f2",
    "bg": "#1c1c1c",
    "panel": "#232323",
    "field": "#191919",
    "surface": "#303030",
    "hover": "#383838",
    "line": "#343434",
    "text": "#dedede",
    "muted": "#a8a8a8",
    "focus": "#bfbfbf",
    "border": "#484848",
    "button": "#4a4a4a",
    "button_hover": "#595959",
    "button_text": "#ffffff",
    "scrollbar": "#4a4a4a",
    "scrollbar_hover": "#686868",
    "green": "#8bc6a4",
    "red": "#ed9098",
    "yellow": "#dbbc7e",
}

# 风险等级 → 状态标记色。语义色只做状态点/文字，不铺大面积、不加发光。
RISK_ACCENT: dict[str, str] = {
    "execute": DARK["red"],
    "delete": DARK["red"],
    "write": DARK["yellow"],
    "read": DARK["muted"],
}

# 与 styles.css 的 font-family 一致；逐级回退到本机存在的字体。
FONT_STACK: tuple[str, ...] = ("HarmonyOS Sans SC", "Segoe UI", "Microsoft YaHei UI", "sans-serif")
MONO_STACK: tuple[str, ...] = ("Cascadia Mono", "Consolas", "Courier New", "monospace")


def pick_family(available: Any, stack: tuple[str, ...]) -> str:
    """Return the first family in ``stack`` that Tk reports as installed."""

    try:
        installed = {str(name) for name in available}
    except Exception:  # pragma: no cover - Tk font enumeration failure
        installed = set()
    for family in stack:
        if family in installed:
            return family
    return stack[-1]


def font(family: str, size: int, weight: str = "normal") -> tuple[str, int, str]:
    return (family, size, weight)


def accent_for(risk: str) -> str:
    return RISK_ACCENT.get(risk, DARK["muted"])


def mix(foreground: str, background: str, ratio: float) -> str:
    """``color-mix(in srgb, foreground <ratio>, background)`` 的等价实现。

    theme.css 用 12% / 22% 的危险色混出按钮底色；Tk 没有 color-mix，
    这里按同样比例算出来，保证两侧得到同一个十六进制值。
    """

    ratio = max(0.0, min(1.0, ratio))

    def channels(value: str) -> tuple[int, int, int]:
        text = value.lstrip("#")
        return int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16)

    front = channels(foreground)
    back = channels(background)
    values = [round(ratio * front[index] + (1.0 - ratio) * back[index]) for index in range(3)]
    return "#" + "".join(f"{value:02x}" for value in values)


def enable_dark_titlebar(root: Any) -> bool:
    """让 Windows 用深色画这个窗口的标题栏（尽力而为，失败不影响功能）。

    主程序使用自绘标题栏（`--dark-chrome`），Tk 窗口仍由系统绘制标题栏；
    打开沉浸式深色模式后，白条消失，窗口与主程序同一套炭黑层级。
    """

    if sys.platform != "win32":
        return False
    try:
        import ctypes

        root.update_idletasks()
        hwnd = ctypes.windll.user32.GetParent(root.winfo_id())
        if not hwnd:
            hwnd = root.winfo_id()
        enabled = ctypes.c_int(1)
        for attribute in (20, 19):  # DWMWA_USE_IMMERSIVE_DARK_MODE，旧版构建用 19
            result = ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, attribute, ctypes.byref(enabled), ctypes.sizeof(enabled))
            if result == 0:
                return True
    except Exception:  # pragma: no cover - 非 Windows 或 DWM 不可用
        return False
    return False


__all__ = [
    "DARK",
    "FONT_STACK",
    "MONO_STACK",
    "RISK_ACCENT",
    "accent_for",
    "enable_dark_titlebar",
    "font",
    "mix",
    "pick_family",
]
