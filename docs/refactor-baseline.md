# 重构基线记录（阶段 1）

记录时间：2026-09-16。代码状态：提交 `2f00a2e`（桌面端 workspace 阶段 2）。
本次记录只盘点现状，不改变行为。

基线更新记录：在提交 `9d33dbd` 之上整理了全部未提交改动并按功能分组（见下），
随后跑通两端全部检查（结果见「一、检查结果」）。按约定**本次只更新基线文档，不提交**。

未纳入重构清理的现有改动（保持原样）：

- `README.md` 在工作区处于已删除状态。
- `desktop/desktop-test-out.txt` 未跟踪。
- `desktop/public/theme/theme.css` 由 `npm run build` 重新生成（浅色主题 palette 的派生产物）。
- `workflows/*.json`：曾混入草稿文档导致 Python 校验测试失败，已从 HEAD 恢复；
  桌面端运行中会再写工作流 JSON（当前是应用内真实编辑，属于用户的进行中内容，保持原样）。

## 一、检查结果

| 检查 | 命令 | 结果 |
|---|---|---|
| Python 测试 | `.venv\Scripts\python.exe -m pytest -q` | 249 passed, 2 skipped |
| Python Lint | `.venv\Scripts\python.exe -m ruff check .` | All checks passed |
| Python 类型 | `.venv\Scripts\python.exe -m mypy src` | Success, 72 files |
| 契约检查 | `.venv\Scripts\python.exe tests\contract_check.py` | 6 项全部 OK |
| 桌面类型 | `npm run typecheck` | 通过（renderer + electron 两个 project） |
| 桌面测试 | `npm test` | 403 pass, 0 fail（node:test + dist-test-renderer 编译产物；条数随工作树数据变化） |
| 桌面构建 | `npm run build` | 通过（浅色主题生成 + typecheck + tsc + vite） |

注意：`mypy .` 会检查 `tests/`，因 `disallow_untyped_defs` 报 93 个错误；CI 与验收只运行 `mypy src`。

### 本次未提交改动按功能分组

改动均来自 HEAD `9d33dbd` 之后的未提交工作，按 CHANGELOG「Unreleased」归纳为以下功能组（同一组内的文件属同一功能，迁移/回滚应整组处理）：

1. **实时视图（live view）**：`src/oooonmyoji/runtime/live_view.py`、`desktop/src/main/liveView.ts`、`renderer/live-view.*`、`shared/contracts.ts`（LiveView 相关类型）、`main.ts`、`preload.ts`、`runtimeService.ts`、`context.py`、`runner.py`、`vite.config.mts`；测试 `tests/test_live_view*.py`、`desktop/tests/live-view.test.cjs`。
2. **卡片固定行（card.rows）与卡内编辑**：`actions/manifest.py` 与 `manifests/*.json`（card.rows 声明）、`render/card-layout.ts`、`param-rows.ts`、`node-card.ts`、`scripts/verify-card-parameter-rows.cjs`、`public/theme` 旧 CSS、`shared/parameter-types.ts`、`workflow/parameters.ts`；测试 `action-card-manifest`/`canvas-card-layout`/`canvas-param-rows`。
3. **节点输出引用与卡片校验**：`model/card-issues.ts`、`variable-links.ts`、`interactions/{connections,hit-test,port-menu,pointer}`、`canvas/edges.ts`、`render/render-entry.ts`、`workflows/validator.py` 与 `node_rules.py`；测试 `canvas-card-issues`/`canvas-reference-port`/`canvas-variable-links`/`canvas-variable-unbind`。
4. **变量引用面板与悬空引用**：`renderer/variable-references.ts`、`renderer/reference-viewer.ts`（含滚轮缩放）、`docking.ts`、`editor-host.ts`；测试 `variable-references-*`、`reference-viewer`。
5. **镜像编辑回写**：`editor-host.ts`、`main.ts`、`asset-browser.ts`、`roi-picker.ts`、`canvas-helpers.ts`；测试 `document-mirror-edits`/`canvas-roi-routing`。
6. **画布迁移遗留 TS 化**：`canvas/**` 主体与 `canvas-*.test.cjs`（见阶段 4/4d）。
7. **桌面工作台拆分**：`renderer/docking.ts` 与 `renderer/docking/*`、`renderer/main.ts`、新增 `renderer/delete-shortcuts.ts`、`document-lifecycle.ts`、`settings-panel.ts`、`content-browser/items.ts`、`overview/card.ts`、`content-browser.ts`、`overview.ts`；测试 `delete-shortcuts`/`content-browser-filter`/`overview-layout`/`document-mirror-edits`/`workflow-tabs`（见阶段 3b）。
8. **Python 运行调度拆分**：新增 `runtime/ocr_dispatch.py`、`runtime/worker_lifecycle.py`、`runtime/group_wait.py`、`runtime/supervisor.py`、`tests/test_worker_lifecycle.py`、`tests/test_group_wait.py`、`tests/test_ocr_pool_shutdown.py`（见阶段 5b）。
9. **文档**：`README.md`、`CHANGELOG.md`、`docs/refactor-baseline.md`。

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
- 工具与事件：`openVisionTest`、`openLiveView`、`liveViewWatch`、`liveViewPoll`、`openReadme`、`visionStart`、`visionCommand`、`visionStop`、`onVisionEvent`、`onRuntimeOutput`、`onRuntimeState`、`onRunEvent`、`onWindowMaximized`。

IPC 通道名与上表方法一一对应：`window:*`、`layout:*`、`appearance:*`、`project:*`、`runtime:*`、`tools:open-vision-test`、`tools:open-live-view`、`live-view:*`、`help:open-readme`、`vision:*`。

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

源切片测试（通过 `source.indexOf` 截取函数执行）的迁移状态：

- 行为测试已改为导入/实例化编译产物；本轮又清掉两处已无调用路径的切片辅助（`port-context-menu` 的 `extractFunction` 回退、`task-parameter-pins` 未使用的 `extractFunction`）。
- 仅剩 `workbench.test.cjs` 的 `renderContentBrowser` 仍按源码切片执行（原因见阶段 3b 登记）。
- 另有若干测试读取源码文本做接线断言（`delete-shortcuts`、`workflow-tabs`、`workbench`、`sidebar-design`、`theme-settings`、`variables-panel`、`node-cards`、`editor-frame-layout` 等），断言的是结构性接线而非行为，不在此清单内。

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

阶段 3b：工作台拆分（完成）：

停靠层（`renderer/docking.ts` 1460 → 803 行）——主文件只保留类型、面板定义、渲染器类与两个创建函数：

- `renderer/docking/layout.ts`：布局存储键与读写、标签拖放覆盖模型。
- `renderer/docking/documents.ts`：工作流文档面板（画布 iframe 容器、标签、未保存圆点、`documentUriForPanelId`）。
- `renderer/docking/gestures.ts`：拖回主窗口/拖出弹窗/拖拽让位/标签条拖动区切换四个手势，依赖全以参数注入。
- `renderer/docking/shared-panels.ts`：共享面板（内容浏览器/运行日志/变量引用）定义、层选择与跨层转移桥接。
- 对外导出面不变（主文件再导出拆分符号），外部引用无需改动；类型只经 `import type` 回引，无运行时循环。

壳层（`renderer/main.ts` 1344 → 959 行）——按职责抽成工厂模块，入口只组装：

- `renderer/delete-shortcuts.ts`(124)：Delete/Backspace 的登记目标状态与解析（原 `deleteTarget` 与四个函数），各面板只负责登记。
- `renderer/document-lifecycle.ts`(424)：标签/面板的打开、激活、关闭与对账；`closingDocuments/documentsReady/removingDocument/suppressDocumentRemoval/documentLoads/activatingUri` 随函数一并迁入，`workspace.ts` 只存状态。
- `renderer/settings-panel.ts`(139)：内容视图、实例自动刷新、启动行为与 Debug 截图的控件读写与监听（含轮询定时器）。
- `renderer/content-browser/items.ts`(44)：目录归属与递归类型过滤两个纯函数。
- `renderer/overview/card.ts`(147)：单卡片渲染（依赖注入，`OverviewItemStatus` 一并迁入）。
- 接线：`workspace`/`contentBrowser`/`editorHost` 的相关依赖改为转调生命周期方法；`beforeunload` 用 `settings.dispose()` 与 `lifecycle.suppressRemovals()`。

测试迁移（4 个源切片改为导入编译产物）：`delete-shortcuts`、`content-browser-filter`、`overview-layout`、`document-mirror-edits`；`workflow-tabs` 改读 `document-lifecycle.ts`；`tsconfig.renderer-tests.json` 纳入上述新模块。桌面测试 361 pass、typecheck 与 build 通过。

- 仍按源码切片执行：`workbench.test.cjs` 的 `renderContentBrowser`。该函数与内容浏览器十余个模块级状态耦合，单独抽工厂会引入比现在更多的间接层，暂留并在此登记。

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
- `src/canvas/toolbar.ts`（原 `editor-toolbar.js`；选择器钩子随工厂返回，入口经桥接 `setTopbarControls` 转发，不再写 `window.__topbar`）。
- `src/canvas/interactions/asset-browser.ts`（原 `editor-asset-browser.js`，测试改为实例化编译产物）。
- `src/canvas/ui/elements.ts`（原 `ui.js`；展示页迁为 Vite 入口 `src/renderer/ui-showcase.html` + `src/canvas/ui/showcase.ts`，测试改为编译产物实例化）。
- `src/canvas/inspector/composite-inspector.ts`（原 `editor-composite-inspector.js`；`UI` 由入口包装注入，`VariableSystem` 改为显式模块导入。`composite-inspector`/`decorator-inputs` 测试改为共享假依赖基座 `tests/helpers/composite-harness.cjs` 实例化编译产物）。
- 迁移期以旧全局名挂载（`window.StudioEditor*`/`VariableSystem`/`NodeCards`）的垫片已随主编辑器迁移完成全部移除（残留的只有几个模块头注释，已一并清理）。

验证方式：`npm test` 188 项通过；构建通过；桌面端重启后通过 DevTools 协议只读探针确认 canvas/details iframe 中 `__canvasBridge.mode`、`__btEditor`、迁移后的全局与零控制台错误。

阶段 4 已完成：`workflow-editor.js` 全部业务迁出并删除，经典脚本注入与全局垫片（`window.StudioEditor*`、`acquireVsCodeApi`、`__topbar`、`__canvasBridge`）不再存在；`__btEditor` 保留为验证脚本/旧展示页的调试出口。

`editor-composite-inspector.js` 迁移已完成：内部函数通过工厂返回对象对测试可见（`renderDecorator`、`decoratorField`、`decoratorVectorField`、`decoratorParameterControl`、`exposeDecoratorParameter`、`retryPublicActions`），供编译产物测试使用。

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
- `src/canvas/render/card-layout.ts`：Action 清单 `card.rows` 的规整化（端点顺序、label 覆盖、hidden、行控件与布尔状态名）；没声明卡片的 Action 返回 null，调用方退回默认卡片（纯计算）。
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
- `src/canvas/editor.ts`：画布入口组装（原 `workflow-editor.js` 闭包改为直接导入各工厂）；`src/canvas/main.ts` 精简为桥接 + 拖拽排序安装 + `startCanvasEditor(bridge)`；`public/legacy/workflow-editor.js` 与 `LEGACY_SCRIPTS` 经典脚本加载已删除，`window.StudioCanvas*` 垫片不再写入。
- 画布收尾（完成）：`editor.ts` 不再有 `late()` 接线，改为纯组装（见下方「阶段 4d 收尾」）；`src/canvas/env.d.ts` 只保留 `UI` 与 `__btEditor`（类型化为 `CanvasEditorHandle`）声明；桥接 API `legacyApi` 更名 `editorApi`。
- 测试适配：`node-cards`、`variable-card-delete`、`variable-system` 的切片改为编译产物；`port-context-menu` 改为经编译工厂包装 vm 依赖桩（含桩优先/模块回退与 `getNavigator` 注入），源码断言改读 `node-card.ts`/`cards.ts`/`overlays.ts`/`port-menu.ts`；新增 `canvas-state.test.cjs`、`canvas-history.test.cjs`、`canvas-commands.test.cjs`、`canvas-viewport.test.cjs`、`canvas-minimap.test.cjs`、`canvas-edges.test.cjs`、`canvas-card-values.test.cjs`、`canvas-pointer.test.cjs`、`canvas-hit-test.test.cjs`、`canvas-connections.test.cjs`；桌面测试 188 → 242 项。workflow-editor.js 4,472 行 → 入口组装 582 行的 TS 模块（业务函数全部迁出，旧文件删除）；ui-library/variable-inspector/workbench/variable-card-delete/delete-shortcuts/node-cards/port-context-menu/task-parameter-pins 测试的迁移函数改为导入编译产物。

迁移注意：把函数从工作流编辑器移入模块后，原函数声明的提升消失。注入时为可能存在的先后顺序加一层箭头（如 `worldPoint: (event) => worldPoint(event)`），或先创建模块实例再解构；否则会在启动时触发 TDZ（Cannot access before initialization）。真机探针负责捕获这类只在运行时出现的问题。

阶段 4d 收尾（完成）：`editor.ts` 重写为按依赖顺序组装的入口，模块依赖可顺着构造顺序读完。

- 构造顺序自上而下：状态/模型 → 渲染 → 交互 → 壳层；模块间依赖直接传入，不再有 `late(() => X)` 包裹（113 处 late 归零）。
- 仅三处跨模块互调留在入口显式接线（都在文件顶部注释里说明）：
  - `render`/`focusNode`：重绘入口由 RenderEntry 提供；入口先建占位函数、渲染层就绪后经 `renderPieces` 赋值，各交互/渲染模块直接引用函数本身；
  - `inspectorRenderers`：详情面板 ⇄ 各详情渲染器互调；面板先建，内容渲染器（DetailInspectors/VariableInspectors/CompositeInspector）构造后填表，面板在分派时读取；
  - `assetHooks.requestTemplateReplacement`：素材浏览器补图 ⇄ 素材动作互调（`AssetActions` 需要解构该回调，故先给占位再赋值）。
- 纯函数提取消除跨模块 import：`isBindingValue` 收敛到 `shared/workflow/bindings.ts`；`parameterLiteralCache`/`parameterLiteralCacheKey` 收敛到 `state/literal-cache.ts`；`normalizeRaw`（含 `reconcileVariableLinks`）收敛到 `state/normalize.ts`，`history` 的 `normalizeRaw` 依赖改为可选、默认用真实实现（测试继续传桩）。
- 全局接口收敛：删除 `__canvasBridge` 与 `__topbar`。桥接新增 `setTopbarControls`，`desktopControl` 的 `switchWorkflow`/`selectInstance` 经它转发给工具条；`child-order-dnd` 改为 `installChildOrderDnd(post, getEditor)` 惰性取编辑器句柄。
- 编辑器句柄：`startCanvasEditor(bridge): CanvasEditorHandle` 显式返回；`window.__btEditor` 仍挂（verify-*.cjs 与旧展示页依赖），成员与迁移前一致，类型化为 `CanvasEditorHandle`。
- 测试适配：`canvas-bridge.test.cjs` 改经 `setTopbarControls` 注入桩；桌面测试 361 pass、typecheck 与 build 通过。

### 阶段 5：拆服务与引擎（进行中）

5a 内置动作（完成）：

- `actions/builtin.py`（1,137 行）拆为包 `actions/builtin/`，按职责分组并保留 `builtin:ClassName` 契约（`registry._load_builtin_instance` 仍以 `getattr(builtin_module, class_name)` 解析，无需改动）：
  - `basic.py`(38) 基础动作、`vision.py`(87) 模板与 OCR 等待、`detection.py`(142) 状态检测与 OCR 匹配助手、`input.py`(68) 输入动作与点击偏移 `_tap_with_variation`、`stateflow.py`(464) 点击匹配项/点模板关闭/状态恢复、`subworkflow.py`(150) 子工作流动作、`text_wait.py`(78) 文字等待、`__init__.py`(33) 聚合导出与原 `__all__`。
- `test_input_actions` 的 monkeypatch 目标改到 `builtin.input`/`builtin.stateflow`（`TapAction` 与 `TagMatch` 分别使用输入组的点击偏移实现）。
- 验证：pytest 196 passed / 2 skipped；ruff、mypy 通过。
- `stateflow.py` 464 行接近参考上限，后续如继续增改变动可再拆出 recovery 子模块。

5b 运行调度（完成）：

- 启动收敛拆出 `runtime/reconciliation.py`(100 行)：`reconcile_stale_run_records(artifact_dir, logger, *, stale_after_seconds)` 负责把归属进程已退出的非终态 run/group 标记为中断（含实例锁可用性判断与子记录回填）；`Supervisor._reconcile_stale_run_records` 仅委托调用，公开接口不变。
- OCR 请求处理拆出 `runtime/ocr_dispatch.py`：`OcrDispatcher` 持有共享 OCR 池、请求线程池与信号量，负责排队、执行与回包；`Supervisor._handle_ocr`/`_recognize_reward_image` 保留为委托，`supervisor.ocr_pool` 改为该池的 property 视图，调用方与测试无需改动。OCR 池的 monkeypatch 目标随之改到 `runtime.ocr_dispatch`。
- worker 生命周期拆出 `runtime/worker_lifecycle.py`：`WorkerLifecycle` 负责按配置 spawn 实例进程、崩溃后在途 run 的 interrupted 落盘与重启，`workers`/`runs` 与 Supervisor 共用同一份字典；`Supervisor._start_worker`/`check_workers` 保留为委托。新增 `tests/test_worker_lifecycle.py`（注入假 spawn 上下文）直接验证崩溃隔离与健康实例不受影响。
- 运行组等待拆出 `runtime/group_wait.py`：`GroupWaiter` 负责轮询整组子 run 记录、落实 `wait_for(any/all)`、失败即取消与超时收尾；`Supervisor._wait_group_poll` 保留为委托，回调全部经属性查找（`lambda: self._cancel_group_runs(group)` 等）以保留测试替换这些方法的口子，`__new__` 手工装配的实例按需补建等待器。新增 `tests/test_group_wait.py`（6 例）独立覆盖 any/all、失败取消、超时与 done/stopping 退出。
- supervisor.py 934 → 852（阶段 5a 后）→ 639 行；`_Worker`/`_Group`/`_instance_worker` 已在 `runtime/worker.py`、`runtime/group.py`。
- 仍留在 Supervisor 内的组协调（属于「协调逻辑」本身，按第 4 步要求保留在调度类）：`_run_instance_parallel` 的组装配与入队、`_queue_workflow_run`、`_persist_group`/`_finish_group`/`_cancel_group_runs`/`_mark_group_timeout` 与 `_runs/_groups/_run_groups` 记账、`wait_for`/`wait_for_all` 的事件队列等待。这些与公开等待 API、事件队列和实例校验强耦合，且 `test_supervisor_integration` 直接读写这些状态；如后续继续膨胀，可把注册表（`_runs/_groups/_run_groups` + 记账）整体抽成 `RunGroupRegistry`。
- 验证：pytest 249 passed / 2 skipped；ruff、mypy（73 文件）通过。

后续切片顺序（每步替换定义、调用点不变、验证后进入下一步）：
- 画布迁移四步（渲染 → interactions → inspector → 收尾）已全部完成，见阶段 4/4d。
- 桌面工作台（第 3 步要求）：已完成，见阶段 3b（`main.ts` 959 行、`docking.ts` 803 行；仅剩 `workbench.test.cjs` 的 `renderContentBrowser` 源切片，已在阶段 3b 登记）。
- 运行调度（第 4 步要求）：已完成，见阶段 5b（OCR 派发、worker 生命周期、运行组等待三块各自成模块并有独立测试；组装配与记账作为协调逻辑保留在 Supervisor）。
- 若后续继续膨胀：`RunGroupRegistry`（`_runs/_groups/_run_groups` 注册表与记账）可作为下一个切片，需同步调整 `test_supervisor_integration` 直接读写这些状态的用例。
