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
