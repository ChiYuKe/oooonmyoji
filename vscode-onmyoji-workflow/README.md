# Onmyoji Workflow Helper

为 oooonmyoji（阴阳师自动化底座）项目编写 `workflows/*.json` 的 VS Code 扩展。
工作流采用 **Behavior Tree schema v3**（有序 `children`），Action 参数元数据
来自与 Python 运行时共享的唯一 manifest。

- **智能 JSON 编辑**：在工作流 JSON 里获得基于结构 schema 的自动补全、悬停文档与诊断。
  - Action 名称（内置 `core.*`/`vision.*`/`input.*`/`workflow.*` + `plugins/actions` 下的自定义 Action）
  - 每个节点的 `params` 参数键（按该 Action 的 manifest 参数定义）、`ref` 绑定路径
    （`blackboard.<键>`、`nodes.<节点id>.output.<字段>`）
  - Root / Selector / Sequence / Simple Parallel / Task 节点及装饰器
  - 校验：父级唯一性、未知子节点、环、孤立节点、无效绑定、非法装饰器和非安全重试
- **可视化 Behavior Tree 编辑器**：蓝图式卡片、有序父子连线、重新连接/断开、
  参数表单（含 ROI 与模板截取）、装饰器、黑板、缩放平移、自动布局与小地图。
- **独立运行日志**：节点时间线、状态/耗时统计、失败筛选、运行截图预览和原始引擎输出。
- **引擎校验**：一键在终端里运行 `python -m src.oooonmyoji.cli ... validate`。
- **自定义 Action 零编辑**：插件只写一份 v2 manifest + Action 类，编辑器无需改代码。

## 安装

### 方式一：直接安装打包好的 VSIX

```powershell
code --install-extension onmyoji-workflow-helper-0.2.7.vsix
```

### 方式二：从源码运行（调试开发）

1. `npm install`
2. 在 VS Code 中打开本目录，按 `F5`（使用 `.vscode/launch.json` 启动扩展开发宿主，会自动打开项目根目录）。

> 工程位置：`vscode-onmyoji-workflow/`。工作区根目录应为 oooonmyoji 项目根
> （自动向上查找 `src/oooonmyoji/actions/builtin.py` 与 `plugins/actions`；
> 也可用 `onmyoji.projectRoot` 配置覆盖）。

## 使用

- 打开任意 `workflows/*.json`，即可获得补全/悬停/波浪线诊断（错误=红）。
- 打开工作流 JSON 后，可点击编辑器右上角的流程图按钮直接打开可视化编辑器。
- 命令面板（`Ctrl+Shift+P`）：
  - `Onmyoji: 新建工作流`（自动创建 v3 Behavior Tree 骨架并打开可视化编辑器）
  - `Onmyoji: 执行当前工作流`（使用可视化编辑器最近选择的实例运行当前工作流）
  - `Onmyoji: 停止当前工作流`
  - `Onmyoji: 打开运行日志`
  - `Onmyoji: 打开工作流可视化编辑器`
  - `Onmyoji: 校验当前工作流 JSON`
  - `Onmyoji: 用自动化引擎校验 (CLI validate)`
  - `Onmyoji: 重新加载 Action 目录`
- 可视化编辑器：
  - 工具栏实例下拉框读取运行配置，并在启用 `discover_mumu_instances` 时每 4 秒通过
    MuMu 官方管理器刷新已启动的原生实例；三开、四开无需修改配置。运行和模板截取
    都使用当前选择，并在工作区中记住上次选择。
  - 滚轮缩放，右键/中键拖拽平移，拖动卡片调整位置（持久化到 `_layout`）。
  - 可从复合节点下方输出引脚拖到节点上方输入引脚，也可从输入引脚反向拖到输出引脚；
    输入只允许一个父级，新连接自动替换旧父级。
  - 拖动连线靠近目标端的手柄可重新连接；双击连线或选中后按 Delete 可断开。
  - 右侧详情栏编辑 Action 参数、Condition/Cooldown/Time Limit/Retry/Repeat 装饰器、
    Simple Parallel 结束模式和子节点优先级。
  - `roi` 参数旁「选择识别区域」按钮会从 MuMu 获取当前截图，在面板内框选后自动换算为
    参考分辨率坐标写入参数；`template` 参数旁「截取模板」按钮把框选区域保存为
    `assets/templates/` 下的模板图。
  - 参数可在固定值与结构化引用间切换；黑板面板编辑 `blackboard` 类型化键。
  - 「设置」编辑 ID、版本、参考分辨率与运行限制。
  - 「▶ 运行」会通过后台 Python 进程运行当前已保存的工作流，并自动在旁边打开独立
    运行日志窗口；有未保存修改时需先保存。「■」可停止当前运行，「☷」可随时重新打开日志。
  - 运行日志按时间线展示节点状态、Action、耗时、错误和截图，可在「任务 / 全部 / 失败」
    间筛选；「引擎输出」保留清理 ANSI 控制码后的原始输出，关闭窗口后仍可回放本次运行。
  - 保存会以 2 空格缩进输出 v3 JSON。

## 配置

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `onmyoji.projectRoot` | `""`（自动探测） | oooonmyoji 项目根目录 |
| `onmyoji.workflowFiles` | `**/workflows/*.json` | 启用智能提示的文件 glob |
| `onmyoji.pythonExecutable` | `""`（自动用 `.venv/Scripts/python.exe`） | 引擎校验使用的 Python |
| `onmyoji.configPath` | `config/config.json` | 引擎 CLI validate 的配置文件 |

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
