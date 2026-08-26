# MuMu 自动化基础

本工作区使用 MuMu 的 `external_renderer_ipc.dll` 作为低延迟截图和触控
后端。ADB 仍然保留，用于兼容性测试、启动和异常兜底。

## 目录结构

- `src/oooonmyoji/devices/mumu.py`：可复用的 MuMu 原生设备层。
- `tests/tools/mumu_fast_benchmark.py`：原生截图和触控速度测试工具。
- `tests/tools/adb_benchmark.py`：ADB 性能对比测试工具。
- `tests/tools/mumu_native_probe.cpp`：原生接口测试源码。
- `src/oooonmyoji/vision/`：截图处理和视觉识别。
- `src/oooonmyoji/tasks/`：自动化任务和状态机。
- `src/oooonmyoji/runtime/`：调度、重试和运行时协作。
- `src/oooonmyoji/config/`：配置模型和加载逻辑。
- `src/oooonmyoji/ui/tui/`：前期使用的终端操作界面。
- `tests/`：测试代码、测试工具和测试产物。
- `tests/artifacts/screenshots/`：测试截图。
- `tests/artifacts/bin/`：原生测试程序编译产物。
- `config/`：运行配置文件。
- `assets/`：模板图和参考素材。
- `requirements.txt`：Python 依赖版本。

## 运行测试

请在工作区根目录运行：

```powershell
python .\tests\tools\mumu_fast_benchmark.py --package com.netease.onmyoji.wyzymnqsd_cps --rounds 30 --tap 10,10 --hold-ms 0 --save .\tests\artifacts\screenshots\latest.png
```

## 启动 TUI

请在工作区根目录运行：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m src.oooonmyoji.ui.tui
```

当前 TUI 已使用 Textual 实现，支持连接 MuMu、截图、点击坐标和断开连接。
截图默认保存到
`tests/artifacts/screenshots/tui_latest.png`。

命令输入示例：

```text
连接 MuMu
截图
点击 960,895 50
断开
退出
```

参数说明：

- `--package`：指定需要查找的游戏包名。
- `--rounds`：正式测试次数。
- `--tap X,Y`：测试指定坐标的点击操作。
- `--hold-ms`：点击按住时间，设为 `0` 可测量纯调用耗时。
- `--save`：保存一张原生截图。

## Python 调用

```python
from src.oooonmyoji.devices.mumu import MumuDevice

with MumuDevice(package="com.netease.onmyoji.wyzymnqsd_cps") as device:
    frame = device.capture()
    device.tap(960, 895, hold_ms=50)
```

`frame.pixels` 是可复用的 BGRA 缓冲区视图。如果需要在下一次截图后
继续保留当前画面，请先复制该数据。坐标使用模拟器可见画面的方向，
MuMu DLL 会自行处理内部旋转，不需要额外转换坐标。

## 环境要求

- Windows
- MuMu Player 12 已启动
- Python 3.10 或更高版本
- 当前 MuMu 安装目录中存在 `external_renderer_ipc.dll`
