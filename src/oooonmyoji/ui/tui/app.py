"""基于 Textual 的 MuMu 交互式终端界面。"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from textual.app import App, ComposeResult
from textual.containers import Vertical
from textual.widgets import Input, Log, Static

from ...devices.lock import InstanceLock, InstanceLockError
from ...devices.mumu import MumuDevice, MumuDeviceError, discover_mumu_path


DEFAULT_PACKAGE = "com.netease.onmyoji.wyzymnqsd_cps"
PROJECT_ROOT = Path(__file__).resolve().parents[4]


class TuiApp(App):
    """MuMu 自动化控制台的交互式终端应用。"""

    TITLE = "MuMu 自动化控制台"
    SUB_TITLE = ""
    CSS = """
    Screen {
        background: #090909;
        color: #a8a8a8;
    }

    #home {
        width: 100%;
        height: 1fr;
        align: center middle;
    }

    #center {
        width: 72;
        height: auto;
        align: center middle;
    }

    #brand {
        width: 100%;
        height: 5;
        content-align: center middle;
        color: #b5b5b5;
        text-style: bold;
        padding-top: 1;
    }

    #brand-subtitle {
        width: 100%;
        height: 1;
        content-align: center middle;
        color: #555555;
    }

    #prompt-box {
        width: 100%;
        height: 5;
        margin-top: 3;
        padding: 0 1;
        background: #1d1d1d;
        border-left: thick #5d9cff;
    }

    #command-input {
        width: 100%;
        height: 3;
        padding: 0;
        border: none;
        background: #1d1d1d;
        color: #dddddd;
    }

    #device-line {
        width: 100%;
        height: 1;
        color: #7e7e7e;
    }

    #hint-line {
        width: 100%;
        height: 2;
        padding-top: 1;
        color: #777777;
        content-align: left middle;
    }

    #tip-line {
        width: 100%;
        height: 3;
        margin-top: 4;
        content-align: center middle;
        color: #777777;
    }

    #log {
        width: 100%;
        height: 8;
        margin-top: 2;
        padding: 1;
        display: none;
        background: #111111;
        border: solid #292929;
        color: #a8a8a8;
    }

    #version {
        dock: bottom;
        width: 100%;
        height: 1;
        padding: 0 2;
        content-align: right middle;
        color: #606060;
    }
    """

    BINDINGS = [
        ("ctrl+p", "focus_command", "命令"),
        ("escape", "clear_command", "清空"),
        ("q", "quit", "退出"),
    ]

    def __init__(
        self,
        mumu_path: Path,
        instance_index: int,
        package: str | None,
        output_dir: Path,
        lock_dir: Path | None = None,
    ) -> None:
        super().__init__()
        self.mumu_path = mumu_path
        self.instance_index = instance_index
        self.package = package
        self.output_dir = output_dir
        self.lock_dir = lock_dir or PROJECT_ROOT / "artifacts" / "locks"
        self.device: MumuDevice | None = None
        self.instance_lock: InstanceLock | None = None

    def compose(self) -> ComposeResult:
        with Vertical(id="home"):
            with Vertical(id="center"):
                yield Static("M U M U", id="brand")
                yield Static("自动化控制台", id="brand-subtitle")
                with Vertical(id="prompt-box"):
                    yield Input(
                        placeholder="输入命令，例如：连接 MuMu、截图、点击 960,895",
                        id="command-input",
                    )
                    yield Static("设备 · 未连接    模式 · 原生高速", id="device-line")
                yield Static("Enter 执行    Ctrl+P 命令    Q 退出", id="hint-line")
                yield Static("● 提示 先连接 MuMu，再执行截图或点击", id="tip-line")
                yield Log(id="log", highlight=False)
        yield Static("TUI 0.1.0", id="version")

    def on_mount(self) -> None:
        """界面启动后聚焦命令输入框。"""

        self.query_one("#command-input", Input).focus()

    def on_input_submitted(self, event: Input.Submitted) -> None:
        """执行命令输入框中提交的操作。"""

        if event.input.id != "command-input":
            return
        command = event.value.strip()
        event.input.value = ""
        self._execute_command(command)

    def action_focus_command(self) -> None:
        """将键盘焦点切换到命令输入框。"""

        self.query_one("#command-input", Input).focus()

    def action_clear_command(self) -> None:
        """清空命令输入框中的内容。"""

        self.query_one("#command-input", Input).value = ""

    async def action_quit(self) -> None:
        """退出 TUI 并释放设备连接。"""

        self.exit()

    def _execute_command(self, command: str) -> None:
        """解析并执行一条中文或英文设备命令。"""

        normalized = command.lower()
        if normalized in {"连接", "连接mumu", "connect", "c"}:
            self.connect_device()
            return
        if normalized in {"截图", "capture", "s"}:
            self.capture_frame()
            return
        if normalized in {"断开", "断开连接", "disconnect", "d"}:
            self.disconnect_device()
            return
        if normalized in {"退出", "quit", "q", "exit"}:
            self.exit()
            return
        if normalized.startswith("点击") or normalized.startswith("tap"):
            self._tap_command(command)
            return
        if command:
            self._write_log(f"未知命令：{command}")
            self._set_tip("● 提示 支持：连接、截图、点击 X,Y、断开、退出")

    def connect_device(self) -> None:
        """连接 MuMu 原生设备并刷新设备状态。"""

        self.disconnect_device(silent=True)
        self._set_tip("● 正在连接 MuMu...")
        instance_lock = InstanceLock(self.lock_dir, str(self.instance_index))
        try:
            instance_lock.acquire()
        except InstanceLockError as exc:
            self._write_log(f"连接失败：实例已被其他任务占用（{exc}）")
            self._set_tip("● 实例已被占用")
            return
        try:
            device = MumuDevice(self.mumu_path, self.instance_index, self.package)
            device.connect()
        except (MumuDeviceError, OSError) as exc:
            instance_lock.release()
            self._write_log(f"连接失败：{exc}")
            self._set_tip("● 连接失败")
            return
        self.device = device
        self.instance_lock = instance_lock
        self._refresh_status()
        self._write_log(f"已连接，分辨率 {device.width}x{device.height}。")
        self._set_tip("● 已连接，可以执行截图或点击")

    def disconnect_device(self, silent: bool = False) -> None:
        """断开当前设备连接并刷新设备状态。"""

        if self.device is not None:
            self.device.close()
            self.device = None
        if self.instance_lock is not None:
            self.instance_lock.release()
            self.instance_lock = None
        self._refresh_status()
        if not silent:
            self._write_log("设备已断开。")
            self._set_tip("● 已断开")

    def capture_frame(self) -> None:
        """截图并保存到测试产物目录。"""

        if self.device is None:
            self._write_log("截图失败：请先连接 MuMu。")
            self._set_tip("● 提示 先连接 MuMu")
            return
        path = self.output_dir / "tui_latest.png"
        self._set_tip("● 正在截图...")
        try:
            self.device.capture_png(path)
        except (MumuDeviceError, OSError) as exc:
            self._write_log(f"截图失败：{exc}")
            self._set_tip("● 截图失败")
            return
        self._write_log(f"截图已保存：{path}")
        self._set_tip("● 截图完成")

    def _tap_command(self, command: str) -> None:
        """解析点击命令并发送触控事件。"""

        if self.device is None:
            self._write_log("点击失败：请先连接 MuMu。")
            self._set_tip("● 提示 先连接 MuMu")
            return
        argument = command[2:].strip() if command.startswith("点击") else command[3:].strip()
        parts = argument.replace("，", ",").split()
        if not parts:
            self._write_log("点击失败：格式应为 点击 X,Y [按住毫秒数]")
            self._set_tip("● 示例 点击 960,895 50")
            return
        try:
            x_text, y_text = parts[0].split(",", 1)
            x, y = int(x_text), int(y_text)
            hold_ms = int(parts[1]) if len(parts) > 1 else 50
            self.device.tap(x, y, hold_ms=hold_ms)
        except (ValueError, MumuDeviceError, OSError) as exc:
            self._write_log(f"点击失败：{exc}")
            self._set_tip("● 点击失败")
            return
        self._write_log(f"已点击 ({x},{y})，按住 {hold_ms} ms。")
        self._set_tip("● 点击完成")

    def _refresh_status(self) -> None:
        """刷新命令框下方的设备状态信息。"""

        status = self.query_one("#device-line", Static)
        if self.device is None:
            status.update("设备 · 未连接    模式 · 原生高速")
            return
        status.update(
            f"设备 · 已连接    分辨率 · {self.device.width}x{self.device.height}"
        )

    def _set_tip(self, message: str) -> None:
        """更新首页提示信息。"""

        self.query_one("#tip-line", Static).update(message)

    def _write_log(self, message: str) -> None:
        """写入日志并在有操作后显示日志区域。"""

        log = self.query_one("#log", Log)
        log.display = True
        log.write_line(message)

    def on_unmount(self) -> None:
        """界面退出时释放原生设备连接。"""

        self.disconnect_device(silent=True)


def build_parser() -> argparse.ArgumentParser:
    """创建 TUI 命令行参数解析器。"""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mumu-path", type=Path, default=discover_mumu_path())
    parser.add_argument("--index", type=int, default=0, help="MuMu 多开实例编号")
    parser.add_argument("--package", default=DEFAULT_PACKAGE, help="用于查找显示的应用包名")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=PROJECT_ROOT / "tests" / "artifacts" / "screenshots",
        help="截图输出目录",
    )
    parser.add_argument(
        "--lock-dir",
        type=Path,
        default=PROJECT_ROOT / "artifacts" / "locks",
        help="实例锁目录",
    )
    return parser


def main() -> int:
    """解析参数并启动 TUI。"""

    args = build_parser().parse_args()
    if args.mumu_path is None:
        print("未找到 MuMu，请使用 --mumu-path 指定安装目录。", file=sys.stderr)
        return 2
    TuiApp(args.mumu_path, args.index, args.package, args.output_dir, args.lock_dir).run()
    return 0
