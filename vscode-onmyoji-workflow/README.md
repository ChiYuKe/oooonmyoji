# Onmyoji Workflow Helper

为 oooonmyoji（阴阳师自动化底座）项目编写 `workflows/**/*.json` 的 VS Code 扩展。
工作流采用 **Behavior Tree schema v3**（有序 `children`），Action 参数元数据
来自与 Python 运行时共享的唯一 manifest。

- **智能 JSON 编辑**：在工作流 JSON 里获得基于结构 schema 的自动补全、悬停文档与诊断。
  - Action 名称（内置 `core.*`/`vision.*`/`input.*`/`workflow.*` + `plugins/actions` 下的自定义 Action）
  - 每个节点的 `params` 参数键（按该 Action 的 manifest 参数定义）、`ref` 绑定路径
    （`blackboard.<键>`、`nodes.<节点id>.output.<字段>`）
  - Root / Selector / Sequence / Simple Parallel / Instance Parallel / Task 节点及装饰器
  - 校验：父级唯一性、未知子节点、环、孤立节点、无效绑定、非法装饰器和非安全重试
- **可视化 Behavior Tree 编辑器**：蓝图式卡片、有序父子连线、重新连接/断开、
  参数表单（含 ROI 与模板截取）、装饰器、UE 风格变量、缩放平移、自动布局与小地图。
- **独立运行日志**：节点时间线、状态/耗时统计、逐局与本次累计材料、失败筛选、运行截图预览和原始引擎输出。
- **引擎校验**：一键在终端里运行 `python -m src.oooonmyoji.cli ... validate`。
- **自定义 Action 零编辑**：插件只写一份 v2 manifest + Action 类，编辑器无需改代码。

## 安装

### 方式一：直接安装打包好的 VSIX

```powershell
code --install-extension onmyoji-workflow-helper-0.2.10.vsix
```

### 方式二：从源码运行（调试开发）

1. `npm install`
2. 在 VS Code 中打开本目录，按 `F5`（使用 `.vscode/launch.json` 启动扩展开发宿主，会自动打开项目根目录）。

> 工程位置：`vscode-onmyoji-workflow/`。工作区根目录应为 oooonmyoji 项目根
> （自动向上查找 `src/oooonmyoji/actions/builtin.py` 与 `plugins/actions`；
> 也可用 `onmyoji.projectRoot` 配置覆盖）。

## 使用

- 点击 VS Code 左侧活动栏的 Onmyoji 工作流图标，可打开独立自动化控制页，直接选择
  运行场数并启动/停止组队御魂，也可进入工作流编辑器、运行日志和引擎校验。
- 打开任意 `workflows/**/*.json`，即可获得补全/悬停/波浪线诊断（错误=红）。
- 打开工作流 JSON 后，可点击编辑器右上角的流程图按钮直接打开可视化编辑器。
- 命令面板（`Ctrl+Shift+P`）：
  - `Onmyoji: 新建工作流`（自动创建 v3 Behavior Tree 骨架并打开可视化编辑器）
  - `Onmyoji: 执行当前工作流`（使用可视化编辑器最近选择的实例运行当前工作流）
  - `Onmyoji: 运行组队御魂`（队长 `mumu-0` + 队员 `mumu-1`，直接启动双实例协调入口）
  - `Onmyoji: 停止当前工作流`
  - `Onmyoji: 打开运行日志`
  - `Onmyoji: 打开工作流可视化编辑器`
  - `Onmyoji: 校验当前工作流 JSON`
  - `Onmyoji: 用自动化引擎校验 (CLI validate)`
  - `Onmyoji: 重新加载 Action 目录`
- 可视化编辑器：
  - 工具栏左侧工作流下拉框会列出项目内全部工作流（`onmyoji.workflowFiles`），可直接切换
    到其他工作流，无需重新打开；有未保存修改时会先询问“保存并切换 / 放弃修改并切换”。
  - 工具栏实例下拉框读取运行配置，并在启用 `discover_mumu_instances` 时每 4 秒通过
    MuMu 官方管理器刷新已启动的原生实例；三开、四开无需修改配置。运行和模板截取
    都使用当前选择，并在工作区中记住上次选择。
  - 滚轮缩放，右键/中键拖拽平移，拖动卡片调整位置（持久化到 `_layout`）。
  - 选中卡片后 `Ctrl+C` 复制、`Ctrl+X` 剪切、`Ctrl+V` 粘贴（也可在画布右键菜单操作）；
    复制会连同选中节点及其子树一起，粘贴时自动生成新 ID、重映射 `children` 与
    `nodes.<id>.output` 引用，并把整组放到当前鼠标位置（右键菜单粘贴放到点击位置）。
  - 工具栏的「⇩」可把全部卡片和连线导出为 PNG；图片按完整节点边界自动留白，
    不受当前缩放和平移影响。默认使用 2 倍清晰度，超大画布会自动降采样以避免导出失败。
  - 从复合节点下方输出引脚拖到节点上方输入引脚，也可从输入引脚反向拖到输出引脚；
    输入只允许一个父级，新连接自动替换旧父级。
  - `workflow.run` 子流程卡片会以蓝色标题和 `⇢ 子工作流名` 标记；双击卡片或右键选择
    「进入子工作流视图」可直接切换到对应子工作流文件，切换后会自动回放最近一次运行的
    步骤事件，子流程各节点的运行状态（成功/失败/未匹配等）会直接显示在卡片上；
    工具栏出现的「← 返回」按钮可逐级返回上级工作流（支持多级嵌套），有未保存修改时
    会先询问「保存并返回 / 放弃修改并返回」。
  - `Instance Parallel` 是 Supervisor 层的跨实例编排节点，在右侧详情栏编辑每个实例对应的
    工作流、输入和完成策略；它不能连接普通子节点。
  - 工作流设置可编辑顶层 `description`；`workflow.run` 的浏览弹窗会在文件名下显示描述，
    并支持按描述、文件名或相对路径搜索。
  - 拖动连线靠近目标端的手柄可重新连接；双击连线或选中后按 Delete 可断开。
  - 右侧详情栏编辑 Action 参数、Condition/Cooldown/Time Limit/Retry/Repeat/Do Once 装饰器、
    Simple Parallel 结束模式和子节点优先级。
  - `roi` 参数旁「选择识别区域」按钮会从 MuMu 获取当前截图，在面板内框选后自动换算为
    参考分辨率坐标写入参数；`template` 参数旁「截取模板」按钮把框选区域保存为
    `assets/templates/` 下的模板图。
  - 参数可在固定值与结构化引用间切换；变量面板以 UE 风格编辑工作流变量。
  - 「设置」编辑 ID、版本、参考分辨率与运行限制。
  - 「▶ 运行」会通过后台 Python 进程运行当前已保存的工作流；有未保存修改时需先保存。
    运行开始不再自动弹出日志窗口（避免打断编辑），需要时可点「☷」或运行日志命令随时打开；
    仅当运行失败时自动弹出日志窗口。「■」可停止当前运行。
  - 「▶ 组队御魂」直接同时启动队长 `mumu-0` 和队员 `mumu-1`，不经过 BAT；默认运行
    30 场，可通过 `onmyoji.partySoulsRounds` 改为 1 场测试。
  - 运行日志按时间线展示节点状态、Action、耗时、错误和截图，可在「任务 / 全部 / 失败」
    间筛选；奖励识别完成后增加逐局材料行，顶部汇总当前这一次运行的累计数量；「引擎输出」
    保留清理 ANSI 控制码后的原始输出，关闭窗口后仍可回放本次运行。Selector 中已由后续
    Selector 已转入后续候选的失败会显示为“分支跳过”，不计入失败数和失败筛选；最后一个失败候选仍保留真实失败原因。
  - 组队御魂使用队长、队员两条独立事件流；运行日志提供实例页签，分别统计双方的步骤、
    成功/失败、当前节点、局数和材料累计，不会把两个账号的数据合并。
  - 御魂工作流在奖励弹层关闭前调用 `souls/shared/reward_statistics.json` 子工作流。子工作流用 MuMu
    原生接口保存截图并立即返回；Supervisor 后台先匹配材料模板，再把邻近 OCR 数字绑定为
    对应数量，不会再连接或点击模拟器。材料目录位于 `assets/templates/rewards/catalog.json`，
    原始截图保存在当前 run 的 `rewards/` 目录，逐局 `items` 与累计 `material_totals` 位于
    `artifacts/reward-stats/souls/<实例>/`；统计错误只写入记录，不会中断下一局战斗。
  - 保存会以 2 空格缩进输出 v3 JSON。

## 配置

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `onmyoji.projectRoot` | `""`（自动探测） | oooonmyoji 项目根目录 |
| `onmyoji.workflowFiles` | `**/workflows/**/*.json` | 启用智能提示的文件 glob（包含子目录） |
| `onmyoji.pythonExecutable` | `""`（自动用 `.venv/Scripts/python.exe`） | 引擎校验使用的 Python |
| `onmyoji.configPath` | `config/config.json` | 引擎 CLI validate 的配置文件 |
| `onmyoji.partySoulsRounds` | `30` | 点击“组队御魂”按钮时运行 1 场或 30 场 |

## 自定义 Action

扩展会自动扫描 `<projectRoot>/plugins/actions/*/action.json` 并把它们纳入补全、
参数表单和校验。清单与内置 Action 完全同构（v2 manifest，与 Python 运行时共享
同一解析规则）：`schema_version`、`name`、`entry`、`parameters` 必填，
`outputs`、`effects`、`version`、`description` 可选。参数词汇见项目根目录
`docs/workflow-schema-v3.md`。新增/修改自定义 Action 后执行
`Onmyoji: 重新加载 Action 目录`。

## 与引擎静态校验（`cli validate`）的关系

扩展的波浪线校验与引擎 `validate` 命令的规则一致：重复节点 ID、未知 Action、
未知子节点、多父级、环、孤立节点、无效 `ref`、非法装饰器与非安全 Action 重试
均为错误级别。两套实现由
`tests/smoke.js`（TypeScript）与 `tests/engine_crosscheck.py`（Python 引擎）
对拍验证，保证编辑器校验结果与运行时一致。

## 构建与打包

```powershell
npm run compile   # tsc 编译到 out/
npm run package   # vsce 打包 .vsix
```

## 冒烟测试（不依赖 VS Code 宿主）

```powershell
npm run compile
node tests/smoke.js            # 纯逻辑模块 + JSON 语言服务管线
node tests/editor-dom-smoke.js # Webview 编辑器 DOM 桩交互
```

## 结构

```
src/extension.ts        扩展入口、命令
src/jsonProviders.ts    补全/悬停/诊断（vscode-json-languageservice + jsonc-parser）
src/catalog.ts          内置 + 自定义 Action 目录（解析共享 manifest，含参数→JSON Schema 编译）
src/workflow.ts         v3 解析、树结构校验、schema、ref 补全数据
src/layout.ts           Behavior Tree 分层布局（纯逻辑）
src/webviewManager.ts   Webview 面板与消息协议
media/                  Webview 前端（HTML/CSS/JS）
snippets/               常用树节点/装饰器代码片段
tests/                  冒烟测试与引擎对拍
```
