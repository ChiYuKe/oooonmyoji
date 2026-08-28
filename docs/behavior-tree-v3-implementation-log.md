# Behavior Tree v3 实施与 UE 参考记录

本文记录本次 Behavior Tree 重构做了什么、改了什么、从 UE 仓库定向获取了什么。

## 参考仓库与获取方式

- 仓库：`https://github.com/ChiYuKe/UnrealEngine.git`
- 分支：`release`
- 参考 commit：`16d75d84714512edfb744e1fd0a59e9c74d57873`
- 临时对象库：`C:\Users\Administrator\AppData\Local\Temp\codex-ue-reference-release`
- 获取命令：

```powershell
git fetch --depth=1 --filter=tree:0 origin release
```

没有 clone 或 checkout 完整 Unreal Engine 工作树。`--filter=tree:0` 只保留所需
commit/tree，并在 `git show FETCH_HEAD:<path>` 时按需取得下面列出的源码 blob。

## 本轮读取的 UE 文件

编辑器卡片、引脚、连线与画布：

- `Engine/Source/Editor/BehaviorTreeEditor/Private/BehaviorTreeConnectionDrawingPolicy.cpp`
- `Engine/Source/Editor/BehaviorTreeEditor/Private/SGraphNode_BehaviorTree.cpp`
- `Engine/Source/Editor/BehaviorTreeEditor/Private/EdGraphSchema_BehaviorTree.cpp`
- `Engine/Source/Editor/BehaviorTreeEditor/Private/BehaviorTreeGraphNode.cpp`
- `Engine/Source/Editor/AIGraph/Private/AIGraphConnectionDrawingPolicy.cpp`
- `Engine/Source/Editor/GraphEditor/Private/ConnectionDrawingPolicy.cpp`
- `Engine/Source/Editor/GraphEditor/Private/DragConnection.cpp`
- `Engine/Source/Editor/GraphEditor/Private/SGraphPanel.cpp`

运行语义：

- `Engine/Source/Runtime/AIModule/Private/BehaviorTree/Composites/BTComposite_Selector.cpp`
- `Engine/Source/Runtime/AIModule/Private/BehaviorTree/Composites/BTComposite_Sequence.cpp`
- `Engine/Source/Runtime/AIModule/Private/BehaviorTree/Composites/BTComposite_SimpleParallel.cpp`
- `Engine/Source/Runtime/AIModule/Private/BehaviorTree/Decorators/BTDecorator_Cooldown.cpp`
- `Engine/Source/Runtime/AIModule/Private/BehaviorTree/Decorators/BTDecorator_TimeLimit.cpp`
- `Engine/Source/Runtime/AIModule/Classes/BehaviorTree/BehaviorTreeTypes.h`

仓库中原有的 `artifacts/ue_engine_ref/` 是此前研读留下的定向源码副本，不是本轮
新增的完整仓库。相关原理笔记见 `docs/ue-behavior-tree-task-study.md`。

## 从 UE 采纳的规则

- 连线表示有序父子关系，不表示 success/failure 状态跳转。
- 输入引脚只允许一个父级，新连接替换旧连接。
- Selector：失败尝试下一子节点，成功返回父级。
- Sequence：成功执行下一子节点，失败返回父级。
- Simple Parallel：第一个子节点是主 Task，第二个是后台树；支持
  AbortBackground 与 WaitForBackground。
- Decorator 是附着在拥有者卡片/分支上的辅助节点，不再建成独立条件卡片。
- Cooldown 在分支停用时开始计时，锁定期间条件失败。
- 连接拖动需要 schema 校验、目标吸附、重新连接、断开反馈和画布自动平移。
- 卡片展示类型、执行索引、装饰器、运行状态、耗时和调试缩略图。

## 没有照搬的 UE 机制

- 没有实现黑板观察者与 FlowAbort（Self/LowerPriority/Both）。当前黑板是一次运行的
  类型化输入，不是可观察事件总线。
- 没有实现 Service 周期 Tick、UE `InProgress`/latent task 协议、实例栈内存块或
  GameplayTask 资源仲裁。这些需要完整事件调度生命周期，不能用 UI 外观冒充。
- Simple Parallel 后台分支执行一轮；当前 Python Action 是阻塞调用，不重复搜索后台树。
- 没有保留 v2 工作流兼容层，避免长期维护两套互相冲突的控制流。

## Python 运行时改动

- `workflows/model.py`：v3 Root/Selector/Sequence/Simple Parallel/Task 与五类 Decorator 模型。
- `workflows/validator.py`：严格树不变量、Action 参数、装饰器、引用与重试安全校验。
- `workflows/compiler.py`：父级映射和深度优先 ExecutionIndex。
- `workflows/resolver.py`：引用统一为 `blackboard.*` 与 `nodes.*.output.*`。
- `workflows/engine.py`：递归树执行、复合节点结果冒泡、Decorator、并行结束模式、
  线程安全历史/输出与运行事件。
- `runtime/context.py`：共享 Action 取消事件改为每次 Action 独立 token，并通过线程本地
  绑定到实际 Action 线程，消除并行分支互相清除/触发取消的竞态。
- `workflows/loader.py`：工作流输入 schema 改为 blackboard schema，资源路径绑定同步迁移。

## VS Code 编辑器改动

- `src/workflow.ts`：v3 解析、前端语义校验、JSON Schema 与引用补全。
- `src/layout.ts`：按子树宽度计算的自顶向下 Behavior Tree 布局。
- `media/workflow-editor.js`：重写卡片、连接、替换父级、重新连接、断开、拖动、框选、
  缩放、平移、边缘自动平移、自动布局、小地图、Undo/Redo 和运行状态。
- `media/workflow-editor.css`：按节点类型区分的紧凑 UE 风格卡片与响应式详情栏。
- `src/webviewManager.ts`：工具栏和实际 Behavior Tree 工作区 HTML。
- 详情栏支持 Action manifest 参数、固定值/引用、ROI、模板截取、Decorator、
  Simple Parallel 结束模式、子节点优先级、黑板与工作流限制。
- 新建模板、代码片段、示例工作流、README 与 JSON 智能提示全部迁移到 v3。

## 测试与验收

- Python：`77 passed, 2 skipped`。跳过项需要真实 MuMu 设备或模型 OCR。
- mypy：通过（45 个源文件）。
- TypeScript：`npm run compile` 通过。
- Node 逻辑冒烟：34 项通过。
- DOM 编辑器冒烟：19 项通过，覆盖卡片、父子边、单父级替换、断开、Undo、参数、
  Decorator、拖动、缩放、布局、黑板和运行缩略图。
- Python/TypeScript 引擎规则对拍：见 `tests/engine_crosscheck.py`。

### 浏览器视觉与真实指针验收

使用扩展目录下的 `tests/browser-harness.html` 和本地静态服务器，在 Codex 内置浏览器
中完成真实 DOM、SVG 和指针事件验收：

- 桌面视口 `1440 x 900`：10 张卡片、9 条有序父子边、详情栏、缩放控件和小地图
  正常显示；页面尺寸与视口一致，无滚动溢出、卡片/连线/详情栏重叠或控制器跳动。
- 窄屏视口 `390 x 844`：画布和详情栏按 `58% / 42%` 上下分区，页面无横向溢出；
  工具栏可横向滚动，详情栏独立滚动，小地图按响应式规则隐藏。
- 实际拖动 Task 卡片后，其 SVG 坐标和 `_layout` 脏状态同步变化。
- 从复合节点输出引脚拖到已有父级的输入引脚，目标节点旧父级自动被新父级替换。
- 从连线目标端手柄拖到另一输入引脚，旧连接按原顺序重连；目标原父级同步断开。
- 双击连线、选中连线后按 `Delete`、详情栏命令均可断开；`Ctrl+Z` 可恢复。
- 缩放按钮、以光标为中心的滚轮缩放、`Alt + 拖动` 平移、自动布局、适应视口和
  小地图点击导航均改变了实际 SVG 视口变换。
- Action 参数表单可把 `threshold` 从 `0.85` 改为 `0.91`；固定值/引用选项、
  Condition/Cooldown 表单可用，并实际新增了 Retry Decorator，卡片摘要同步更新。
- 桌面和窄屏截图均通过目视检查；控制台没有 error 或 warning。

验收中发现可见 `.edge-line` 与顺序圆标会覆盖 14 px 宽的 `.edge-hit` 命中层，导致
鼠标正好点在线上时无法稳定选中连接。已在 `media/workflow-editor.css` 禁用这两个纯
视觉元素的 pointer events；修复后点击线条、详情栏显示父子关系、`Delete` 断线均已
重新验证。在 `1280 x 720` 默认视口还发现最右下卡片会被小地图遮挡，因此
`fitView()` 在小地图可见时会预留其底部区域；小地图隐藏的窄屏不额外缩小画布。
扩展清单中遗留的 schema v2 描述也已更新为 Behavior Tree schema v3。

### VSIX 打包

`npm run package` 成功，输出：

```text
vscode-onmyoji-workflow/onmyoji-workflow-helper-0.2.0.vsix
744.87 KB, 569 files
```

打包过程会再次执行 TypeScript 编译并通过。`vsce` 报告了三个非阻断发布提示：
`package.json` 未声明独立仓库字段、扩展目录没有 LICENSE 文件、依赖尚未 bundle。
这些不影响本地安装和本轮功能验收，也没有把 UE 参考仓库错误登记为扩展发布仓库。

### 0.2.1 连线释放修复

真实 VS Code Webview 复测发现，拖线经过目标输入引脚时虽然出现高亮，但松手后不会
建立连接。原因是拖线的每次 `mousemove` 都会重绘整个 SVG；目标引脚 DOM 在
`mouseenter` 中被替换后，浏览器不会再把 `mouseup` 发送给原元素。此前 DOM 冒烟
直接调用输出端 `mousedown` 和输入端 `mouseup`，没有覆盖这一浏览器事件生命周期。

修复内容：

- 鼠标移动和全局释放时，按画布坐标与当前缩放计算最近的兼容引脚，不依赖会被重绘
  替换的 DOM 元素接收 `mouseup`。
- 全局 `mouseup` 使用吸附目标提交连接；未命中时取消预览，不改工作流。
- 输入引脚也可作为起点反向拖到复合节点输出引脚；已有父级只在新连接校验成功后替换。
- 起点节点不会被识别为自己的落点，避免低缩放下误触自连接。
- DOM 冒烟新增“输入到输出反向连接”和“SVG 重绘后全局释放”两项检查，共 21 项。
- 无缓存 Chromium 真实指针测试通过两个方向：Decision 输出到 Capture 输入、Capture
  输入到 Main 输出，父级关系均按预期更新。

### 0.2.2 模板参数栏修复

新建 `vision.match_template` 节点的 `params` 为空时，详情栏只显示“参数”标题，模板路径、
ROI、阈值等控件都没有出现。Action manifest 与 Webview 收到的 catalog 实际完整；原因是
参数渲染器对“必填且没有默认值”的 `template` 执行 `clone(undefined)`，异常中断了整个参数组。

修复内容：

- 必填参数没有默认值时使用其类型初始值渲染；`asset` 显示空路径输入框和“截取”按钮，
  不在用户编辑前擅自写入工作流。
- DOM 冒烟改为覆盖真实故障形态：`vision.match_template.params` 为 `{}`，并检查 5 个参数组、
  空模板输入框和截取按钮均存在。
- 逻辑冒烟校验真实 manifest 的 `template` 类型和 5 个完整参数名，防止 catalog 链路退化。
- Chromium 浏览器验收确认空参数节点显示 `template`、`roi`、`threshold`、`max_results`、
  `scale_search` 五组控件，模板路径框与“截取”按钮可见，控制台无错误。

验收与安装：

- TypeScript 编译通过；Node 逻辑冒烟 35 项、DOM 编辑器冒烟 25 项、Python/TypeScript
  引擎规则对拍全部通过。
- 已打包 `vscode-onmyoji-workflow/onmyoji-workflow-helper-0.2.2.vsix`（763365 bytes）。
- 已使用 VS Code CLI 强制覆盖安装，并确认已安装版本为
  `oooonmyoji.onmyoji-workflow-helper@0.2.2`。

### 0.2.3 VS Code 多实例选择

双 MuMu 场景下，工作流编辑器此前始终读取配置中的第一个实例，用户只能离开 VS Code
手工执行带 `--instance` 的命令。现已在可视化编辑器工具栏增加运行实例下拉框：

- 下拉选项直接读取运行配置的 `instances`，显示实例 ID 与后端类型。
- “运行”和模板/ROI“截取”统一使用当前实例，避免在一个实例截图、另一个实例执行。
- 当前选择写入 VS Code 工作区状态；重新打开面板以及从命令面板运行时继续使用该实例。
- 配置删除或重命名实例后会自动回退到仍然有效的记忆实例或第一个实例；空配置保留
  `mumu-0` 作为引擎兼容回退。
- 运行实例属于工作台上下文，不写入工作流 JSON，同一工作流可以直接切换设备运行。

测试新增配置实例解析、去重与选择优先级 3 项；DOM 冒烟新增工具栏双实例、选择持久化
消息、运行实例和模板截取实例 4 项。TypeScript 编译、逻辑冒烟 38 项、DOM 冒烟 29 项、
Python/TypeScript 引擎规则对拍均通过。

Chromium 浏览器验收确认桌面工具栏显示 `mumu-0 (mumu)` 与 `mumu-1 (adb)`，切换后
运行按钮上下文同步到 `mumu-1`，实例标题包含对应 ADB serial，控制台无错误。窄屏下
沿用工具栏横向滚动，实例下拉框没有挤压、遮挡其他控件。

已打包 `vscode-onmyoji-workflow/onmyoji-workflow-helper-0.2.3.vsix`（765164 bytes），
使用 VS Code CLI 强制覆盖安装，并确认已安装版本为
`oooonmyoji.onmyoji-workflow-helper@0.2.3`；安装目录包含新的实例解析模块和 Webview 资源。

### 双实例统一使用 MuMu 原生后端

运行配置中的 `mumu-1` 原先使用纯 ADB 后端，因此实例选择器显示为
`mumu-1 (adb)`，且不能使用仅支持 MuMu 原生捕获的模板/ROI 截取功能。现已将它改为
`backend: "mumu"` 并配置 `mumu_index: 1`；`mumu-0` 继续使用 `mumu_index: 0`。
两个实例分别保留 `127.0.0.1:16384` 和 `127.0.0.1:16416`，只在原生连接失败时作为
ADB 回退通道。浏览器验收页的实例数据也同步为双原生后端，避免测试页面继续显示
过期的 `(adb)` 标签。

### 0.2.4 MuMu 原生实例自动发现

为避免三开、四开时继续维护 `instances` 数组，运行时改用 MuMu 安装目录自带的
`MuMuManager.exe info --vmindex all` 作为权威实例来源。只接纳进程和 Android 均已
启动的实例，并读取官方返回的索引、实例名称、Android 版本与实际 ADB 端口；不再按
端口规律猜测。

实现内容：

- 应用配置新增 `discover_mumu_instances` 开关，示例配置已启用。显式配置仍作为实例 ID、
  包名和 ADB 回退端口的覆盖；未配置的新索引自动生成 `mumu-N` 原生实例。
- CLI 新增 `list-instances`，输出扩展和脚本共用的机器可读实例列表。
- 直接运行、长驻 Supervisor 和 ROI/模板截取都能接收动态发现的实例；长驻服务可在
  启动后为新实例补建 worker。
- VS Code 扩展每 4 秒刷新可见面板中的实例列表，显示 MuMu 实例名称，并保留工作区
  记忆选择。新开的三号、四号实例无需重开编辑器或修改工作流 JSON。
- 新增 MuMuManager JSON 解析、未就绪实例过滤、配置覆盖与新索引合并测试；扩展冒烟
  增加禁用实例过滤、发现元数据和第三实例热刷新覆盖。

本轮没有拉取或复制任何外部仓库文件；实例枚举依据本机 MuMu 安装包自带的官方
`MuMuManager.exe`。第一轮验证为 Python `79 passed, 2 skipped`、TypeScript 逻辑冒烟
39 项、DOM 冒烟 30 项以及 Python/TypeScript 引擎规则对拍全部通过。

最终实机验收自动发现 `mumu-0/扫地工` 与 `mumu-1/吃鱼`，两者均通过原生
`MumuDevice` 捕获 `1920 x 1080` 画面且健康检查为 `True`。已打包
`vscode-onmyoji-workflow/onmyoji-workflow-helper-0.2.4.vsix`（765850 bytes），使用
VS Code CLI 强制覆盖安装，并确认当前版本为
`oooonmyoji.onmyoji-workflow-helper@0.2.4`；安装目录包含新的实例发现调用。
