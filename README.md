# 阴阳师通用自动化底座

本工作区使用 MuMu 的 `external_renderer_ipc.dll` 作为低延迟截图和触控
后端，提供视觉识别、PaddleOCR、可信本地 Action、JSON 工作流、多实例调度和
本机 CLI。ADB 是显式配置的兼容后端，并只在任务边界作为原生后端的降级选项。

## 目录结构

- `src/oooonmyoji/`：设备、视觉识别、Action、工作流引擎和运行时源码。
- `workflows/`：按入口、业务流程和公共子流程分层的 JSON 工作流。
  - `entrypoints/`：可直接运行的实例入口（`mumu-0` 队长、`mumu-1` 队员/单人循环）。
  - `souls/party/`：组队御魂队长/队员的单回合流程。
  - `souls/shared/`：多个入口复用的进入副本、准备阵容、等待胜利和奖励统计流程。
  - `examples/`：用于开发验证的示例工作流。
- `assets/templates/`：按功能和实例分组的游戏模板图。
- `vscode-onmyoji-workflow/`：侧边栏控制、可视化编辑器和运行日志插件。
- `config/`：示例配置和本机运行配置。
- `plugins/actions/`：可选的可信本地 Action。
- `tests/`：单元测试、集成测试和设备测试工具。
- `scripts/`：本地维护脚本，默认先预览再执行。
- `docs/`：工作流规范、设计研究和实现记录。
- `artifacts/`、`logs/`：本地运行产物，已被 Git 忽略。

## 安装和配置

运行环境是 Windows、64 位 Python 3.12、MuMu Player 12。安装依赖：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

PaddleOCR 3.x 需要同时安装 PaddleOCR 包和 PaddlePaddle 推理引擎，二者已
一并列在 `requirements.txt` 中。当前使用 CUDA 12.9 GPU 推理包；首次创建
OCR 引擎时会下载中文模型，并在 OCR 工作进程中共享一份模型。

复制 `config/config.example.json` 为 `config/config.json`，然后填写 MuMu
安装路径和任务输入。应用配置使用
`schema_version: 2`；v1 配置会明确提示迁移。启动前会校验 JSON 类型、实例
和任务引用、所有工作流、Action 参数、资源路径及时区。

`mumu_path` 可以留空，底座会在常见 MuMu 安装目录中查找原生 DLL 和
`adb.exe`；需要固定 ADB 可执行文件时填写 `adb_path` 的绝对路径。ADB
实例必须填写 `adb_serial`，例如 `127.0.0.1:16384`。如果 MuMu 的 ADB
`wm size` 返回竖屏尺寸，后端会以截图 PNG 的实际可见尺寸为准。

`discover_mumu_instances: true` 会调用 MuMu 自带的 `MuMuManager.exe`，自动
合并所有已完成 Android 启动的原生实例。`instances` 中的同索引条目作为包名、
实例 ID 和回退端口的显式覆盖；后续三开、四开不需要继续增加配置。运行
下面的 `list-instances` 命令可查看当前解析结果。

## VS Code 运行

日常使用统一从 VS Code 左侧活动栏的 **Onmyoji** 页面操作：

- **组队御魂**：按配置启动 `mumu-0` 队长和 `mumu-1` 队员。
- **停止**：协作取消当前运行。
- **运行日志**：分别查看队长、队员步骤和奖励统计。
- 工作流编辑器标题栏的播放按钮可运行当前 JSON 工作流。

插件默认使用项目的 `.venv/Scripts/python.exe` 和 `config/config.json`，无需 BAT
或单独打开终端。

## CLI

需要诊断或开发时，可以直接调用 Python CLI：

```powershell
.\.venv\Scripts\python.exe -m src.oooonmyoji.cli --config .\config\config.json validate
.\.venv\Scripts\python.exe -m src.oooonmyoji.cli --config .\config\config.json list-instances
.\.venv\Scripts\python.exe -m src.oooonmyoji.cli --config .\config\config.json list-workflows
.\.venv\Scripts\python.exe -m src.oooonmyoji.cli --config .\config\config.json run-party-souls --rounds 9999
```

`run-workflow` 会直接按 `workflows/` 下指定 JSON 的节点图运行，不需要先在
`config.json` 的 `tasks` 中注册。工作流 `inputs` 定义中的默认值会自动生效；
参数可以是工作流 ID、JSON 文件名或 `workflows/` 下的相对路径（包含子目录）；需要覆盖输入时可传入 JSON 文件：

```powershell
.\.venv\Scripts\python.exe -m src.oooonmyoji.cli `
  --config .\config\config.json `
  run-workflow mumu_1_souls_loop --instance mumu-1 --inputs .\inputs.json
```

`tasks` 仍用于定时调度和为同一工作流保存多个固定任务配置。

点击 Action 支持两个可选参数：`random_offset` 为像素最大偏移量，点击坐标
会在 X/Y 轴分别随机偏移 `-N` 到 `N`；`random_interval` 为点击前的随机等待
范围，单位是秒，格式为 `[最小值, 最大值]`。例如：

```json
{
  "random_offset": 8,
  "random_interval": [0.2, 0.6]
}
```

这两个参数可用于 `input.tap` 和 `input.tap_match`，默认值为 `0` 和
`[0, 0]`。

```powershell
.\.venv\Scripts\python.exe -m src.oooonmyoji.cli --config .\config\config.json validate
.\.venv\Scripts\python.exe -m src.oooonmyoji.cli --config .\config\config.json doctor
.\.venv\Scripts\python.exe -m src.oooonmyoji.cli --config .\config\config.json list-workflows
.\.venv\Scripts\python.exe -m src.oooonmyoji.cli --config .\config\config.json show-workflow mumu_1_souls_loop
.\.venv\Scripts\python.exe -m src.oooonmyoji.cli --config .\config\config.json list-actions
.\.venv\Scripts\python.exe -m src.oooonmyoji.cli --config .\config\config.json list-instances
.\.venv\Scripts\python.exe -m src.oooonmyoji.cli --config .\config\config.json serve
.\.venv\Scripts\python.exe -m src.oooonmyoji.cli --config .\config\config.json status
.\.venv\Scripts\python.exe -m src.oooonmyoji.cli --config .\config\config.json run-party-souls --rounds 1
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
间隔通过 `--interval-ms 500` 设置为 500 毫秒。拖动框选时实时捕获不会暂停，
临时框会在刷新后继续显示。

也可以直接打开已有截图，不连接设备：

```powershell
.\.venv\Scripts\python.exe -m src.oooonmyoji.tools.roi_editor `
  --image .\artifacts\manual-mumu-current.png
```

在“ROI 标注”模式下拖动鼠标即可新增运行时 ROI；切换到“截取区”模式后拖动
鼠标设置独立的截图裁剪区域。工具支持分别保存标注图、裁剪截取区和导出
`roi.json`；JSON 同时保存原图坐标与 `1920×1080` 参考坐标，`capture_rect` 与
`regions` 分开记录。默认输出目录为 `artifacts/roi-editor/`。

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
- 64 位 Python 3.12
- 当前 MuMu 安装目录中存在 `external_renderer_ipc.dll`

## 工作流和 Action 开发

工作流是 Behavior Tree v3（`schema_version: 3`）。`children` 表示有序父子关系，
执行结果由 `Selector`、`Sequence` 与 `Simple Parallel` 组合节点解释，不再使用
成功/失败跳转边。完整契约见 [docs/workflow-schema-v3.md](docs/workflow-schema-v3.md)。

```json
{
  "schema_version": 3,
  "id": "my_workflow",
  "version": "3.0.0",
  "description": "查找目标并点击",
  "resolution": [1920, 1080],
  "root": "root",
  "blackboard": { "template": { "type": "asset", "default": "assets/templates/x.png" } },
  "nodes": [
    { "id": "root", "type": "root", "children": ["main"] },
    { "id": "main", "type": "sequence", "children": ["find", "tap"] },
    { "id": "find", "type": "task", "action": "vision.match_template", "params": { "template": { "ref": "blackboard.template" } } },
    { "id": "tap", "type": "task", "action": "input.tap_match", "params": { "match": { "ref": "nodes.find.output.0" } } }
  ]
}
```

- `root` 恰好连接一个子节点；其他节点恰好有一个父节点，禁止环和孤立节点。
- `Selector` 遇到成功即停止，`Sequence` 遇到失败即停止；`Simple Parallel` 的
  第一个子节点必须是主 Task，第二个是后台分支。
- 条件、冷却、超时、重试、重复、只执行一次都作为 `decorators` 挂在节点或子树上。
- 参数绑定使用 `{"ref": "blackboard.<键>"}` 或
  `{"ref": "nodes.<节点id>.output.<字段>"}`。
- 顶层可选字段 `description` 用于说明工作流用途，并显示在子工作流选择器中。
- 每次运行使用启动时读取的不可变文件哈希快照；修改 JSON 只影响下一次运行。

自定义 Action 放在 `plugins/actions/<name>/`，清单是 v2 manifest
（`schema_version: 2`，字段为 `name`、`entry`、`parameters`、`outputs`、
`effects`），与内置 Action 完全同构，运行时与编辑器读取同一份定义。入口类
继承 `Action` 并实现：

```python
from src.oooonmyoji.actions.base import Action, ActionResult


class ExampleAction(Action):
    name = "example.inspect"

    def execute(self, context, arguments):
        return ActionResult.succeeded({"ok": True})
```

例如 `plugins/actions/example/action.json` 可以声明
`{"schema_version":2,"name":"example.inspect","version":"1.0.0","entry":"action.py:ExampleAction","parameters":{"target":{"type":"string","required":true}}}`。
Action 代码属于可信本地扩展；更新代码后需要重启监督器，工作流 JSON 则在下一次运行时重新加载。

有输入副作用的 Action（`effects.retry: "unsafe"`）不可自动重试。模板和产物
路径必须留在项目资源目录或当前运行的产物目录内；失败和中断会保存最后一帧、
步骤历史及元数据。

## 调度和故障产物

周期任务按上次结束时间加间隔计算下一次运行，不会因任务耗时而重叠。
监督器重启时，停机期间到期的任务最多补跑一次；崩溃中的运行记录为
`interrupted`，默认不自动重放。只有工作流中的 Action 都标记为安全且任务
开启 `retry_enabled` 时，才会使用配置中的安全任务重试。

事件写入 `logs/events-YYYY-MM-DD.jsonl`，同时输出控制台文本，默认保留
14 天。运行器默认不保存步骤截图、缩略图或自动 `last-frame.png`；只需要原始
步骤截图时可设置 `"save_screenshots": true`。排查坐标和识别问题时设置
`"debug": {"enabled": true, "annotate_screenshots": true}`，运行器会在
`artifacts/<run-id>/debug/` 为每个任务节点保存唯一编号的截图，并标出 ROI、
模板匹配度、原点击位置和随机偏移后的实际位置。桌面端可在“设置 > 运行”中
切换逐步截图和标注，设置从下一次运行开始生效。工作流显式使用
`core.save_frame` 时仍会保存指定截图。失败或中断运行写入
`artifacts/<run-id>/`，包括失败元数据、OCR/模板结果和一张最终现场图；选择器
正常回退产生的中间失败不会保存截图。
奖励统计截图按游戏实例跨运行滚动保留最近 10 局；OCR 尚未处理的截图不会提前
删除，结构化奖励统计和运行事件日志不受截图清理影响。

维护脚本默认只显示清理计划，不修改文件：

```powershell
.\scripts\cleanup-artifacts.ps1 -KeepLatestRuns 10 -ClearCaches
```

确认预览内容后添加 `-Apply` 执行。脚本保留最新运行、结构化统计、日志和参考
素材，清理旧工作流图片、重复失败截图、临时验证目录及可再生成的测试缓存。

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

也可以用一个命令执行完整验收（默认测试、`mypy src`、`doctor`、实时 OCR、双
ADB 和 3 批性能基准）：

```powershell
.\tests\tools\acceptance.ps1
```

验收过程产生的 `artifacts/`、`logs/` 和 OCR 模型缓存仅用于本地运行，不应提交。

类型检查：

```powershell
.\.venv\Scripts\python.exe -m mypy src
```
