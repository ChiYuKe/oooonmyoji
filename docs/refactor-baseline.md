# 重构基线记录（阶段 1）

记录时间：2026-09-16。代码状态：提交 `2f00a2e`（桌面端 workspace 阶段 2）。
本次记录只盘点现状，不改变行为。

未纳入重构清理的现有改动（保持原样）：

- `README.md` 在工作区处于已删除状态。
- `desktop/desktop-test-out.txt` 未跟踪。

## 一、检查结果

| 检查 | 命令 | 结果 |
|---|---|---|
| Python 测试 | `.venv\Scripts\python.exe -m pytest -q` | 181 passed, 2 skipped |
| Python Lint | `.venv\Scripts\python.exe -m ruff check .` | All checks passed |
| Python 类型 | `.venv\Scripts\python.exe -m mypy src` | Success, 54 files |
| 契约检查 | `.venv\Scripts\python.exe tests\contract_check.py` | 6 项全部 OK |
| 桌面类型 | `npm run typecheck` | 通过（renderer + electron 两个 project） |
| 桌面测试 | `npm test` | 149 pass, 0 fail（node:test + stripTypeScriptTypes） |
| 桌面构建 | `npm run build` | 通过（浅色主题生成 + typecheck + tsc + vite） |

注意：`mypy .` 会检查 `tests/`，因 `disallow_untyped_defs` 报 93 个错误；CI 与验收只运行 `mypy src`。

## 二、Python 公开入口

### 包导出

| 模块 | 导出 |
|---|---|
| `oooonmyoji.workflows` | `CompiledWorkflow`、`BehaviorDecorator`、`InstanceParallelRun`、`INSTANCE_PARALLEL_WAIT_MODES`、`ReferenceResolver`、`WORKFLOW_SCHEMA`、`WorkflowEngine`、`WorkflowLoader`、`WorkflowNode`、`WorkflowResult`、`WorkflowSpec`、`compile_workflow`、`is_binding`、`validate_workflow` |
| `oooonmyoji.actions` | `Action`、`ActionDefinition`、`ActionRegistry`、`ActionResult`、`ActionSpec`、`ActionStatus`、`ParameterDefinition`、`build_action_registry` |
| `oooonmyoji.config` | `AppConfig`、`DebugConfig`、`InstanceConfig`、`JobConfig`、`OcrConfig`、`RetryConfig`、`load_config`、`resolve_workflow_path` |
| `oooonmyoji.runtime` | `AtomicJsonStore`、`EventLogger`、`RunRecord`、`RunStatus`、`TaskContextImpl`、`retry_call` |
| `oooonmyoji.vision` | `OcrResult`、`PaddleOcrEngine`、`SharedOcrPool`、`TemplateMatch`、`TemplateMatcher`、`normalize_ocr_result` |
| `oooonmyoji.devices` | `AdbDevice`、`CoordinateMapper`、`Rect`、`connect_at_task_boundary`、`create_backend`、`resolve_adb_path`、`InstanceLock`、`InstanceLockError`、`MumuDevice`、`DeviceBackend`、`DeviceFrame`、`frame_from_backend` |

### CLI（`src/oooonmyoji/cli.py`）

子命令：`serve`、`status`、`run`、`run-workflow`、`cancel`、`validate`、`doctor`、`list-workflows`、`show-workflow`、`list-actions`、`list-instances`。

### MCP（`src/oooonmyoji/mcp/server.py`）

- 工具：`server_info`、`get_project_guide`、`list_actions`、`get_action`、`list_workflows`、`get_workflow`、`list_assets`、`capture_screen`、`create_template_asset`、`select_roi`、`validate_workflow`、`save_workflow_template`。
- 资源：`oooonmyoji://guide`。
- 启动参数：`--config`、`--project-root`；stdio 传输，stdout 只走协议。

### Action 注册契约

- 内置 manifest 位于 `src/oooonmyoji/actions/manifests/*.json`，v2 格式（`schema_version: 2`），入口写法 `builtin:ClassName`，类从 `oooonmyoji.actions.builtin` 解析。
- 插件 manifest 位于 `plugins/actions/<目录>/action.json`，入口写法 `module.py:ClassName`，路径必须落在插件目录内。
- 注册名固定，与 Python 类名解耦；`ActionRegistry.names()` 排序返回。
- 现有 22 个 Action 名称（`builtin:类名`）：`core.assert`→AssertAction、`core.capture`→CaptureAction、`core.log`→LogAction、`core.save_frame`→SaveFrameAction、`core.sleep`→SleepAction、`input.dismiss_template_until_text`→DismissTemplateUntilTextAction、`input.key`→KeyAction、`input.recover_state`→RecoverStateAction、`input.swipe`→SwipeAction、`input.tap`→TapAction、`input.tap_match`→TapMatchAction、`input.type_text`→TypeTextAction、`vision.detect_state`→DetectStateAction、`vision.match_template`→MatchTemplateAction、`vision.ocr`→OcrAction、`vision.wait_any`→WaitAnyAction、`vision.wait_any_text`→WaitAnyTextAction、`vision.wait_template`→WaitTemplateAction、`vision.wait_text`→WaitTextAction、`workflow.run`→RunWorkflowAction、`workflow.select`→SelectWorkflowAction、`workflow.sequence`→SequenceWorkflowAction。

## 三、桌面端公开入口

### preload API（`window.onmyoji`，`desktop/src/preload/preload.ts`）

- 窗口：`minimizeWindow`、`toggleMaximizeWindow`、`closeWindow`、`isWindowMaximized`。
- 布局与外观：`readLayout`、`writeLayout`、`getTheme`、`setTheme`、`onThemeChanged`。
- 项目：`bootstrap`、`getWorkflowInit`、`saveWorkflow`、`createWorkflow`、`openWorkflowFile`、`openContentItem`、`moveContent`、`listContentFolders`、`createContentFolder`、`renameContent`、`deleteContent`、`getReferenceGraph`。
- 运行：`runWorkflow`、`stopWorkflow`、`getDebugSettings`、`updateDebugSettings`、`listInstances`、`captureRoi`、`checkTemplate`。
- 素材：`listAssets`、`readAssetData`、`saveTemplate`、`saveCanvas`。
- 工具与事件：`openVisionTest`、`openReadme`、`visionStart`、`visionCommand`、`visionStop`、`onVisionEvent`、`onRuntimeOutput`、`onRuntimeState`、`onRunEvent`、`onWindowMaximized`。

IPC 通道名与上表方法一一对应：`window:*`、`layout:*`、`appearance:*`、`project:*`、`runtime:*`、`tools:open-vision-test`、`help:open-readme`、`vision:*`。

### iframe 消息协议

- 壳层 → 画布：`{ source: 'desktop-shell', payload }`；`payload.type` 为 `desktopPing`、`desktopControl`（command：`back`/`run`/`stop`/`save`/`more`/`switchWorkflow`/`selectInstance`），其余按编辑器消息直接派发。
- 画布 → 壳层：`{ source: 'legacy-editor', message }`、`{ source: 'legacy-editor-state', state }`；独立窗口为 `{ source: 'dockview-popout', ... }`。
- 编辑器消费的消息类型：`init`、`runEvent`、`runtimeInstances`、`runReplay`、`roiPickerImage`、`roiPickerCancelled`、`roiPickerError`、`roiPickerResult`、`templateSaved`、`assetImages`、`assetImagesError`、`templateCheckResult`、`templateCheckError`、`canvasImageSaved`、`canvasImageCancelled`、`canvasImageError`。
- 编辑器发出的消息类型：`ready`、`editorCommand`、`runWorkflow`、各种 `request*` 与保存请求，经壳层按 `type` 分发。

### 构建入口

- Vite 多页面：`index.html`、`popout.html`、`vision-test.html`（`desktop/vite.config.mts`）。
- 旧画布仍为静态页：`public/legacy/editor-frame.html` 加载 `bridge.js` → `ui.js` → `node-cards.js` → `workflow-editor.js` 等脚本，不经过 Vite 打包。
- 主进程入口：`dist-electron/main/main.js`；Electron 类型检查含 `src/shared/**`，renderer 类型检查含 `src/shared/**`。

## 四、数据契约

- 工作流 JSON：`schema_version` 固定 4；节点类型 `root`、`selector`、`sequence`、`simple_parallel`、`parallel`、`repeat_until`、`branch`、`switch`、`instance_parallel`、`task`；装饰器 `condition`、`cooldown`、`timeout`、`retry`、`repeat`、`do_once`；`finish_mode` 为 `abort_background`、`wait_for_background`；`wait_for` 为 `all`、`any`。
- 编辑器元数据写在顶层下划线字段，Python 侧必须原样保留：`_layout`（节点坐标）、`_variableCards`、`_variableLinks`、`_inputParams`。
- 运行状态：`RunStatus` 为 `queued`、`running`、`retrying`、`succeeded`、`failed`、`cancelled`、`interrupted`。
- 两端契约由 `tests/contract_check.py` 检查：4 组常量与运行状态枚举、日志状态映射。
- 编辑器初始化契约：`WorkflowEditorInit`（文档、工作流清单、trail、catalog、refs、issues、projectRoot、assetsBaseUri、instances、selectedInstance）。
- Action 清单契约：`ActionSpec`/`ActionSpecInfo` 字段与 manifest 一一对应，参数定义只有 manifest 一份来源。

## 五、测试覆盖与迁移清单

方案第五节列出的关键行为中，目前已有覆盖：

- 多标签与会话：`workflow-tabs.test.cjs`、`workflow-session.test.cjs`、`workbench.test.cjs`。
- 节点与变量编辑：`variable-system.test.cjs`、`variables-panel.test.cjs`、`variable-inspector.test.cjs`、`variable-card-delete.test.cjs`、`decorator-inputs.test.cjs`。
- 面板与布局：`port-context-menu.test.cjs`、`asset-browser-portal.test.cjs`、`sidebar-design.test.cjs`、`editor-frame-layout.test.cjs`。
- 工作流规则：`variable-validation.test.cjs`（已从 `dist-electron` 导入真实模块）、`tests/test_workflows.py`。

尚未覆盖、需要随拆分补齐的关键行为：

- 自动保存：保存失败、连续修改、异步返回顺序与「旧版本保存成功不得清除新修改脏标记」。
- iframe 生命周期：初始化、重新加载、销毁与独立窗口转发。
- 共享面板单实例与布局保存/恢复。
- 文件重命名/移动后的引用更新与路径边界（Python 侧有覆盖，桌面侧缺）。
- 两端共同校验规则的一致样例（当前只有常量级契约检查）。

源切片测试（通过 `source.indexOf` 截取函数执行）需要随迁移改为导入编译产物：

`decorator-inputs`、`delete-shortcuts`、`content-browser-filter`、`composite-inspector`、`asset-browser-portal`、`node-cards`、`overview-layout`、`port-context-menu`、`runtime-log`、`shortcuts`、`sidebar-design`、`sidebar-variable-list`、`task-parameter-pins`、`tooltip-shared`、`variable-system`、`variables-panel`、`variable-inspector`、`variable-card-delete`、`workbench`、`workflow-session`（共 20 个）。

## 六、实施进度（滚动更新）

### 阶段 2：提取规则与类型（完成）

- 新增 `desktop/src/shared/workflow/` 领域模块：参数、解析、图关系、绑定、校验、引用建议、结构树、子工作流引用；`main/core/workflow.ts` 仅聚合导出，`catalog.ts` 复用共享参数逻辑。
- Python `workflows/validator.py` 拆为 `schema.py`、`graph.py`、`bindings.py`、`scopes.py`、`node_rules.py`，`validate_workflow`/`WORKFLOW_SCHEMA` 契约不变（963 → 234 行）。
- 两端共同规则样例 `tests/fixtures/workflow-rules/cases.json`，由 `tests/test_workflow_rules_contract.py` 与 `desktop/tests/workflow-rules-contract.test.cjs` 共用。
- `tests/contract_check.py` 常量来源改指向 `shared/workflow/types.ts`。

### 阶段 3：整理工作台（完成）

- 新增 `desktop/src/shared/workspace/`：
  - `session.ts`：会话序列化（从 renderer 迁入，测试改为编译产物导入）。
  - `documents.ts`：文档列表、活动文档、正文、脏标记、返回栈的唯一归属。
  - `autosave.ts`：按文档的保存队列，版本不匹配的旧结果不会清除新修改的脏标记。
- `renderer/workspace.ts` 持有所述状态，`main.ts` 移除 `currentUri/currentText/dirty/workflowTabs/backStack/currentEditorInit` 等镜像变量与 getter/setter 同步。
- 新增 `shared/editor-messages.ts`：编辑器消息以 `type` 区分的联合类型与 `parseEditorMessage` 边界校验。
- 新增 `renderer/editor-host.ts`：消息处理从 main 迁出（main 2054 → 约 1400 行），异步写盘与导航统一以消息来源文档为准，避免等待期间切换文档写错标签。
- 新增 `renderer/panels/sidebar.ts`：结构树与变量列表迁出，面板持有展示状态并提供 snapshot/apply 供切换文档同步。
- 新增 `renderer/naming.ts`：输入名展示翻译从 overview 抽出，面板不再依赖概览模块。
- 测试：`sidebar-design`、`variables-panel` 改为导入编译产物（新增 `tsconfig.renderer-tests.json` 与 `build:renderer-tests`）；新增 `editor-messages.test.cjs`；桌面测试 176 → 179 项，全部通过。
- 已验证：桌面 typecheck、测试、生产构建通过；按项目规则重启桌面端，窗口标题与启动后写出的会话配置正常。

### 阶段 4：迁移画布（进行中）

入口与桥接（完成）：

- 新增 Vite 画布入口 `src/renderer/canvas.html` + `src/canvas/main.ts`，加入 `vite.config.mts` 多页面构建；iframe 地址统一改为 `./canvas.html?mode=canvas|details`，`public/legacy/editor-frame.html` 与 `bridge.js` 删除。
- 新增 `src/canvas/bridge.ts`：模式检测、消息信封、桌面控制命令；旧脚本仍通过 `acquireVsCodeApi` 垫片工作（阶段 6 删除）。
- 尚未迁移的经典脚本按旧顺序以经典脚本注入，保持它们依赖的全局导出；每迁移一个模块即从注入列表移除。

已迁移模块（旧文件已删除，行为由编译产物测试或真机探针覆盖）：

- `src/canvas/model/schema.ts`（原 `editor-schema.js`）。
- `src/canvas/model/variable-system.ts`（原 `variable-system.js`）。
- `src/canvas/render/node-cards.ts`（原 `node-cards.js`）。
- `src/canvas/model/sidebar-state.ts`（原 `editor-sidebar-state.js`）。
- `src/canvas/export.ts`（原 `editor-export.js`）。
- `src/canvas/interactions/roi-picker.ts`（原 `editor-roi-picker.js`）。
- `src/canvas/interactions/workflow-browser.ts`（原 `editor-workflow-browser.js`）。
- `src/canvas/interactions/template-check.ts`（原 `editor-template-check.js`）。
- `src/canvas/interactions/child-order-dnd.ts`（原 `child-order-dnd.js`，改为显式安装并返回 dispose）。
- `src/canvas/toolbar.ts`（原 `editor-toolbar.js`，工厂继续设置 `window.__topbar`）。
- `src/canvas/interactions/asset-browser.ts`（原 `editor-asset-browser.js`，测试改为实例化编译产物）。
- `src/canvas/ui/elements.ts`（原 `ui.js`；展示页迁为 Vite 入口 `src/renderer/ui-showcase.html` + `src/canvas/ui/showcase.ts`，测试改为编译产物实例化）。
- `src/canvas/inspector/composite-inspector.ts`（原 `editor-composite-inspector.js`；`UI` 由入口包装注入，`VariableSystem` 改为显式模块导入。`composite-inspector`/`decorator-inputs` 测试改为共享假依赖基座 `tests/helpers/composite-harness.cjs` 实例化编译产物）。
- 迁移期以旧全局名挂载（`window.StudioEditor*`/`VariableSystem`/`NodeCards`），主编辑器完成迁移后移除。

验证方式：`npm test` 188 项通过；构建通过；桌面端重启后通过 DevTools 协议只读探针确认 canvas/details iframe 中 `__canvasBridge.mode`、`__btEditor`、迁移后的全局与零控制台错误。

待继续：只剩 `workflow-editor.js`。注入列表现仅该脚本；最后按 model/state/commands/history/canvas/interactions/inspector 拆分并移除全局垫片（`window.StudioEditor*`、`acquireVsCodeApi`、`__btEditor`、`__topbar`）。

`editor-composite-inspector.js` 迁移已完成：内部函数通过工厂返回对象对测试可见（`renderDecorator`、`decoratorField`、`decoratorVectorField`、`decoratorParameterControl`、`exposeDecoratorParameter`、`retryPublicActions`），阶段 4d 拆分 inspector 时收回。

### 阶段 4d：拆分 workflow-editor.js（进行中）

已抽出（workflow-editor.js 由注入工厂消费，调用点不变）：

- `src/canvas/model/workflow-model.ts`：`nodes`/`nodeById`/`layout`/`position`/`variableCards`/`variableLinks`/`nextVariableCardId`/`variableCardList`/`clearVariableCardSelection`/`setVariableCardSelection`/`inputParameterMetadata`/`displayNameOfDefinition`/`variableDisplayNameOf`。
- `src/canvas/state/canvas-state.ts`：文档数据、选择、视口与临时交互状态的默认形状，每个画布实例独立。
- `src/canvas/state/history.ts`：`snapshot`/`mutate`/`restore`/`replaceDocument`/`undo`/`redo`，保留既有快照语义与 80 步上限。
- `src/canvas/state/commands.ts`：`nextId`/`parentOf`/`descendants`/`canConnect`/`connect`/`disconnect`/`buildNode`/`addNode`/`deleteSelection`/`selectionTreeIds`/`copySelection`/`cutSelection`/`pasteClipboard`；所有修改统一走注入的 `mutate`。
- `src/canvas/canvas/viewport.ts`：`autoLayout`/`ensureLayout`/`bounds`/`fitView`/`zoomAt`/`worldPoint`/`bezier`。
- `src/canvas/canvas/minimap.ts`：小地图缩略节点/实例卡/变量卡与视口框。
- `src/canvas/canvas/edges.ts`：父子连线、实例运行连线、拖拽预览（节点与变量）与 Alt 快捷断开。
- `src/canvas/render/card-values.ts`：卡片摘要、值格式化、输入值提示与实例显示名（纯计算）。
- `src/canvas/interactions/pointer.ts`：节点拖拽、画布平移、框选、连线拖拽的指针生命周期与历史边界（`suppressPanContextMenu` 随模块迁移）。
- `src/canvas/interactions/hit-test.ts`：节点端口、变量端点、实例子输入与变量卡片的就近命中（含卡片本体回退）。
- `src/canvas/render/cards.ts`：实例运行卡与变量卡片渲染、端口事件、卡片双击计时（节点卡与运行卡共用）。
- `src/canvas/render/node-card.ts`：节点卡片渲染（运行状态、预览、变量引脚、装饰器行、端口与右键菜单、双击进入子工作流）。
- `src/canvas/interactions/connections.ts`：普通连线开始/取消/完成与指针捕获，变量端点到参数/实例子输入的解绑与绑定。
- `src/canvas/ui/overlays.ts`：右键菜单（搜索/子菜单/键盘导航）、提示 toast 与图片灯箱。
- `src/canvas/interactions/port-menu.ts`：五类端口右键菜单项与 `insertNodeAbove`/`addChildNode`/`promotePinToVariable`/`copyVariableReference` 命令。
- `src/canvas/inspector/panel.ts`：详情面板外壳（打开/清空、按选中项分派）与通用控件（section/field/输入、分区折叠 `groupSections`）；详情渲染函数与命令由调用方注入。
- `src/canvas/model/references.ts`：引用助手（参数默认值、节点可引用输出集合、`allRefs` 候选与 `referenceLabel`）；schema 解析与变量可见性由注入模块提供。
- `src/canvas/inspector/parameter-controls.ts`（680 行）：参数编辑控件群（`renderParameter`、字面量缓存、literal/JSON/结构化/嵌套/元组/标量数组/对象数组控件、条件控件、`actionDropdown`、`nodeChildrenOptions`）；资产/ROI/模板检查/子工作流浏览以注入回调调用。
- `src/canvas/inspector/detail-inspectors.ts`（204 行）：任务参数块、实例运行输入（含公共工作流输入模式切换与缓存）、连线上限；`parentVariableRefs` 供卡片渲染复用。
- `src/canvas/inspector/variable-inspectors.ts`（343 行）：连线/工作流/变量详情与定义值控件、引用标签菜单；删除/改名/引用计数支持测试注入覆盖。
- `src/canvas/model/canvas-workflow-model.ts`（268 行）：变量端点/卡片位置、公共输入迁移、子工作流描述与输入、实例运行卡片与输入位置；`nodeVariablePins` 支持覆盖。
- `src/canvas/state/editor-commands.ts`（212 行）：变量卡片增删/放置/吸附连接、节点重命名（含引用改写）与类型切换；`selectedVariableCardIds` 判定兼容跨 realm 集合。
- `src/canvas/state/run-events.ts`（85 行）：运行事件写回、旧文档规范化、按选中项删除（实例运行项/变量/卡片/节点连线）。
- `src/canvas/state/editor-command-dispatch.ts`（129 行）：`executeEditorCommand` 命令分派（复制/粘贴/删除/布局/搜索/导出等 30+ 命令）。
- `src/canvas/render/asset-preview.ts`（155 行）：模板缩略图、资产悬停预览与其绑定（支持嵌入父窗口定位）。
- `src/canvas/interactions/asset-actions.ts`（48 行）：资产路径规范化/状态、素材清单刷新、缺失素材修复入口、ROI 拾取请求。
- `src/canvas/model/subworkflow.ts`（77 行）：子工作流引用解析、打开请求（未保存时询问）、复合节点副标题、装饰器与条件摘要。
- `src/canvas/render/render-entry.ts`（96 行）：`render` 总入口（重绘连线/实例卡片/变量卡片/小地图/详情并同步侧栏）与 `focusNode` 定位。
- `src/canvas/ui/canvas-helpers.ts`（62 行）：问题徽标计数、`openPortContextMenu`（含右键平移抑制）、`focusVariableCard` 聚焦选中。
- `src/canvas/state/editor-status.ts`（38 行）：脏标记广播、当前选中项描述、打开详情面板请求。
- `src/canvas/interactions/input-bridge.ts`（约 130 行）：变量卡片拖放（含拖放幽灵）、快捷键分派（delete/copy/cut/paste/selectAll/save/undo/redo/fitView/focusNode）、小地图点击导航；监听器仅在 `install()` 时注册。
- `src/canvas/shell/messages.ts`（145 行）：壳层全部消息处理（init/runEvent/runtimeInstances/runReplay/roiPicker*/templateSaved/assetImages*/templateCheck*/canvasImage*/instanceSelected/workflowSaved|Failed/externalChange/replaceDocument/editorCommand）。
- `src/canvas/editor.ts`（582 行）：画布入口组装（原 `workflow-editor.js` 闭包改为直接导入各工厂）；`src/canvas/main.ts` 精简为桥接 + 拖拽排序安装 + `startCanvasEditor(bridge)`；`public/legacy/workflow-editor.js` 与 `LEGACY_SCRIPTS` 经典脚本加载已删除，`window.StudioCanvas*` 垫片不再写入。
- 画布收尾：`src/canvas/env.d.ts` 仅保留 `__canvasBridge`/`__topbar`/`__btEditor`/`UI`（展示页）声明；桥接 API `legacyApi` 更名 `editorApi`。
- 测试适配：`node-cards`、`variable-card-delete`、`variable-system` 的切片改为编译产物；`port-context-menu` 改为经编译工厂包装 vm 依赖桩（含桩优先/模块回退与 `getNavigator` 注入），源码断言改读 `node-card.ts`/`cards.ts`/`overlays.ts`/`port-menu.ts`；新增 `canvas-state.test.cjs`、`canvas-history.test.cjs`、`canvas-commands.test.cjs`、`canvas-viewport.test.cjs`、`canvas-minimap.test.cjs`、`canvas-edges.test.cjs`、`canvas-card-values.test.cjs`、`canvas-pointer.test.cjs`、`canvas-hit-test.test.cjs`、`canvas-connections.test.cjs`；桌面测试 188 → 242 项。workflow-editor.js 4,472 行 → 入口组装 582 行的 TS 模块（业务函数全部迁出，旧文件删除）；ui-library/variable-inspector/workbench/variable-card-delete/delete-shortcuts/node-cards/port-context-menu/task-parameter-pins 测试的迁移函数改为导入编译产物。

迁移注意：把函数从工作流编辑器移入模块后，原函数声明的提升消失。注入时为可能存在的先后顺序加一层箭头（如 `worldPoint: (event) => worldPoint(event)`），或先创建模块实例再解构；否则会在启动时触发 TDZ（Cannot access before initialization）。真机探针负责捕获这类只在运行时出现的问题。

### 阶段 5：拆服务与引擎（进行中）

5a 内置动作（完成）：

- `actions/builtin.py`（1,137 行）拆为包 `actions/builtin/`，按职责分组并保留 `builtin:ClassName` 契约（`registry._load_builtin_instance` 仍以 `getattr(builtin_module, class_name)` 解析，无需改动）：
  - `basic.py`(38) 基础动作、`vision.py`(87) 模板与 OCR 等待、`detection.py`(142) 状态检测与 OCR 匹配助手、`input.py`(68) 输入动作与点击偏移 `_tap_with_variation`、`stateflow.py`(464) 点击匹配项/点模板关闭/状态恢复、`subworkflow.py`(150) 子工作流动作、`text_wait.py`(78) 文字等待、`__init__.py`(33) 聚合导出与原 `__all__`。
- `test_input_actions` 的 monkeypatch 目标改到 `builtin.input`/`builtin.stateflow`（`TapAction` 与 `TagMatch` 分别使用输入组的点击偏移实现）。
- 验证：pytest 196 passed / 2 skipped；ruff、mypy 通过。
- `stateflow.py` 464 行接近参考上限，后续如继续增改变动可再拆出 recovery 子模块。

5b 运行调度（进行中）：

- 启动收敛拆出 `runtime/reconciliation.py`(100 行)：`reconcile_stale_run_records(artifact_dir, logger, *, stale_after_seconds)` 负责把归属进程已退出的非终态 run/group 标记为中断（含实例锁可用性判断与子记录回填）；`Supervisor._reconcile_stale_run_records` 仅委托调用，公开接口不变。supervisor.py 934 → 852 行。
- 待续：worker 生命周期（`_Worker/_Group/_instance_worker/control_loop`）、运行组协调（`_run_instance_parallel/_wait_group_poll/_persist_group` 等）、OCR 请求处理（`_handle_ocr/_recognize_reward_image`）仍留在 Supervisor 内。
- 验证：pytest 196 passed / 2 skipped；ruff、mypy（67 文件）通过。

后续切片顺序（每步替换定义、调用点不变、验证后进入下一步）：
1. canvas 渲染：SVG 节点与连线、小地图、布局计算；
2. interactions：拖拽、框选、缩放、连线、键盘；
3. inspector：节点、变量、工作流详情与参数控件；
4. 收尾：workflow-editor.js 变为只负责组装的 TS 入口，移除全部迁移垫片与经典脚本注入。
