# 阴阳师通用自动化底座

本工作区使用 MuMu 的 `external_renderer_ipc.dll` 作为低延迟截图和触控
后端，提供视觉识别、PaddleOCR、可信本地 Action、JSON 工作流、多实例调度和
本机 CLI。ADB 是显式配置的兼容后端，并只在任务边界作为原生后端的降级选项。

## 目录结构

- `src/oooonmyoji/devices/`：设备协议、MuMu 原生后端、ADB 后端、坐标映射和实例锁。
- `tests/tools/mumu_fast_benchmark.py`：原生截图和触控速度测试工具。
- `tests/tools/adb_benchmark.py`：ADB 性能对比测试工具。
- `tests/tools/mumu_native_probe.cpp`：原生接口测试源码。
- `src/oooonmyoji/vision/`：BGRA/PNG 转换、OpenCV 模板匹配和 PaddleOCR 适配。
- `src/oooonmyoji/actions/`：内置和可信本地 Python Action 注册表。
- `src/oooonmyoji/workflows/`：工作流 JSON 加载、校验、引用解析和执行引擎。
- `src/oooonmyoji/runtime/`：任务上下文、调度、重试、监督器、记录和本机控制管道。
- `src/oooonmyoji/config/`：带 `schema_version` 的 JSON 配置模型和加载逻辑。
- `workflows/diagnostic.json`：首个只读诊断工作流。
- `plugins/actions/`：可选的自定义 Action 清单和实现。
- `src/oooonmyoji/ui/tui/`：前期使用的终端操作界面。
- `tests/`：测试代码、测试工具和测试产物。
- `tests/artifacts/screenshots/`：测试截图。
- `tests/artifacts/bin/`：原生测试程序编译产物。
- `config/`：运行配置文件。
- `assets/`：模板图和参考素材。
- `requirements.txt`：Python 依赖版本。

## 安装和配置

运行环境是 Windows、64 位 Python 3.12、MuMu Player 12。安装依赖：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

PaddleOCR 3.x 需要同时安装 PaddleOCR 包和 PaddlePaddle 推理引擎，二者已
一并列在 `requirements.txt` 中。首次创建 OCR 引擎时会下载中文模型；首版
使用 CPU，并在 OCR 工作进程中共享一份模型。

复制 `config/config.example.json` 为 `config/config.json`，然后填写 MuMu
安装路径、实例编号、ADB 序列号和任务输入。应用配置使用
`schema_version: 2`；v1 配置会明确提示迁移。启动前会校验 JSON 类型、实例
和任务引用、所有工作流、Action 参数、资源路径及时区。

`mumu_path` 可以留空，底座会在常见 MuMu 安装目录中查找原生 DLL 和
`adb.exe`；需要固定 ADB 可执行文件时填写 `adb_path` 的绝对路径。ADB
实例必须填写 `adb_serial`，例如 `127.0.0.1:16384`。如果 MuMu 的 ADB
`wm size` 返回竖屏尺寸，后端会以截图 PNG 的实际可见尺寸为准。

## CLI

```powershell
.\.venv\Scripts\python.exe -m src.oooonmyoji.cli --config .\config\config.json validate
.\.venv\Scripts\python.exe -m src.oooonmyoji.cli --config .\config\config.json doctor
.\.venv\Scripts\python.exe -m src.oooonmyoji.cli --config .\config\config.json list-workflows
.\.venv\Scripts\python.exe -m src.oooonmyoji.cli --config .\config\config.json show-workflow diagnostic
.\.venv\Scripts\python.exe -m src.oooonmyoji.cli --config .\config\config.json list-actions
.\.venv\Scripts\python.exe -m src.oooonmyoji.cli --config .\config\config.json serve
.\.venv\Scripts\python.exe -m src.oooonmyoji.cli --config .\config\config.json status
.\.venv\Scripts\python.exe -m src.oooonmyoji.cli --config .\config\config.json run diagnostic-mumu-0
.\.venv\Scripts\python.exe -m src.oooonmyoji.cli cancel <run-id>
```

`serve` 使用本机 Windows 命名管道接收其他 CLI 命令。找不到运行中的
监督器时，`run` 会进入一次性本地运行模式；若实例锁已存在，会直接失败。
关闭时先协作取消并等待最多 10 秒，再终止无响应的实例进程。

## 运行测试

请在工作区根目录运行：

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

默认测试不连接真实设备，真实设备测试必须显式开启。原生截图基准只测
`MumuDevice.capture()`，不包含 PNG 编码、磁盘写入、OCR 或日志；每批预热
5 次、测量 30 次，连续 3 批，输出平均值、P50、P95、最大值和 DLL/校验分段
耗时。每一批 P95 都必须不超过 20 ms：

```powershell
.\.venv\Scripts\python.exe .\tests\tools\mumu_fast_benchmark.py --batches 3 --rounds 30 --warmup 5
```

需要保存截图或测试点击时，再显式添加 `--save` 或 `--tap X,Y`；这些操作不计入
原生截图性能门槛。

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

## ROI 标注工具

使用独立的桌面工具获取当前 MuMu 画面、框选并命名区域：

```powershell
.\.venv\Scripts\python.exe -m src.oooonmyoji.tools.roi_editor `
  --config .\config\config.example.json `
  --instance mumu-0
```

连接 MuMu 时工具默认以 250 毫秒间隔实时刷新画面；工具栏中的“实时捕获”可以
暂停或恢复，刷新间隔也可以直接调整。需要只捕获一次时添加 `--no-live`，或将
间隔通过 `--interval-ms 500` 设置为 500 毫秒。

也可以直接双击项目根目录的 `run_roi_editor.bat` 启动工具。批处理文件会优先
读取 `config/config.json`，不存在时回退到 `config/config.example.json`。

也可以直接打开已有截图，不连接设备：

```powershell
.\.venv\Scripts\python.exe -m src.oooonmyoji.tools.roi_editor `
  --image .\artifacts\manual-mumu-current.png
```

在画面上拖动鼠标即可新增标注。工具支持保存标注图、裁剪当前选区和导出
`roi.json`；JSON 同时保存原图坐标与 `1920×1080` 参考坐标，后续可直接用于
工作流的 `roi` 或模板制作。默认输出目录为 `artifacts/roi-editor/`。

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

## 工作流和 Action 开发

普通任务只需要新增 `workflows/<name>.json`，无需创建 Python 任务类或修改
运行时源码。工作流的 `entry`、步骤 ID 和跳转目标必须存在；终点固定为
`$success`、`$failure`、`$cancelled`。步骤可使用 `when`、`on_success`、
`on_failure`、`on_skip`、`retry` 和 `timeout_seconds`。

引用只允许结构化对象，例如 `{"$ref": "inputs.name"}` 或
`{"$ref": "steps.find_button.output.0"}`。条件只支持 `exists`、`eq`、
`ne`、`gt`、`gte`、`lt`、`lte`、`contains`、`and`、`or`、`not`，不执行
Python 表达式。每次运行从入口开始，使用启动时读取的不可变文件哈希快照；
修改 JSON 只影响下一次运行。

自定义 Action 放在 `plugins/actions/<name>/`，清单至少包含 `name`、`version`、
`entry`、`input_schema`，并可声明 `output_schema`、`retry_safe` 和
`side_effect`。入口类继承 `Action` 并实现：

```python
from src.oooonmyoji.actions.base import Action, ActionResult


class ExampleAction(Action):
    name = "example.inspect"

    def execute(self, context, arguments):
        return ActionResult.succeeded({"ok": True})
```

例如 `plugins/actions/example/action.json` 可以声明
`{"name":"example.inspect","version":"1.0.0","entry":"action.py:ExampleAction","input_schema":{"type":"object"}}`。
Action 代码属于可信本地扩展；更新代码后需要重启监督器，工作流 JSON 则在下一次运行时重新加载。

有输入副作用的 Action 默认不可自动重试。模板和产物路径必须留在项目资源
目录或当前运行的产物目录内；失败和中断会保存最后一帧、步骤历史及元数据。

## 调度和故障产物

周期任务按上次结束时间加间隔计算下一次运行，不会因任务耗时而重叠。
监督器重启时，停机期间到期的任务最多补跑一次；崩溃中的运行记录为
`interrupted`，默认不自动重放。只有工作流中的 Action 都标记为安全且任务
开启 `retry_enabled` 时，才会使用配置中的安全任务重试。

事件写入 `logs/events-YYYY-MM-DD.jsonl`，同时输出控制台文本，默认保留
14 天。失败或中断运行写入 `artifacts/<run-id>/`，包括最后一帧、失败元数据
和 OCR/模板结果。

单元测试：

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

有本地模型缓存且 MuMu 实例 0 已启动时，可运行真实 OCR 测试。测试会在运行时
从 MuMu 抓取一帧，不依赖仓库内固定截图，也不会点击设备；MuMu 未启动时会给出
明确的跳过原因：

```powershell
$env:OOOONMYOJI_RUN_REAL_OCR = "1"
.\.venv\Scripts\python.exe -m pytest tests/test_vision_ocr.py -q
```

两台 MuMu ADB 实例可用时，可运行双实例监督器测试：

```powershell
$env:OOOONMYOJI_RUN_REAL_DEVICES = "1"
.\.venv\Scripts\python.exe -m pytest tests/test_supervisor_integration.py::test_supervisor_runs_two_real_adb_instances -q
```

主验收工作流使用真实 JSON 配置，包含截图、保存帧、条件跳转和 OCR，并要求运行
记录可追溯且不执行点击：

```powershell
.\.venv\Scripts\python.exe -m src.oooonmyoji.cli `
  --config .\config\config.example.json `
  run diagnostic-mumu-0
```

也可以用一个命令执行完整验收（默认测试、`mypy src`、`doctor`、实时 OCR、双
ADB、3 批性能基准和真实 JSON 工作流）：

```powershell
.\tests\tools\acceptance.ps1
```

验收过程产生的 `artifacts/`、`logs/` 和 OCR 模型缓存仅用于本地运行，不应提交。

类型检查：

```powershell
.\.venv\Scripts\python.exe -m mypy src
```
