# Onmyoji Workflow Helper

为 [oooonmyoji](https://github.com/)（阴阳师自动化底座）项目编写 `workflows/*.json` 的 VS Code 扩展：

- **智能 JSON 编辑**：在 `.json` 工作流文件里获得基于动态 schema 的自动补全、悬停文档与诊断。
  - Action 名称（内置 `core.*`/`vision.*`/`input.*` + `plugins/actions` 下的自定义 Action）
  - 每步 `with` 参数、`when` 条件运算符、`on_success`/`on_failure`/`on_skip` 跳转目标（步骤 ID + 终点）
  - `entry`、`$ref` 路径（`inputs.<字段>`、`steps.<步骤id>.output.<字段>`）
  - 校验：重复步骤 ID、未知 Action、未知跳转目标、无效 `$ref`、非法重试、未知参数、不可达步骤
- **可视化流程图编辑器**：以节点图编辑步骤与跳转，参数表单化编辑，一键生成/回写 JSON。
- **引擎校验**：一键在终端里运行 `python -m src.oooonmyoji.cli ... validate`。

## 安装

### 方式一：直接安装打包好的 VSIX

```powershell
code --install-extension vscode-onmyoji-workflow-0.1.0.vsix
```

### 方式二：从源码运行（调试开发）

1. `npm install`
2. 在 VS Code 中打开本目录，按 `F5`（使用 `.vscode/launch.json` 启动扩展开发宿主，会自动打开项目根目录）。

> 工程位置：`vscode-onmyoji-workflow/`。工作区根目录应为 oooonmyoji 项目根（自动向上查找 `src/oooonmyoji/actions/builtin.py` 与 `plugins/actions`；也可用 `onmyoji.projectRoot` 配置覆盖）。

## 使用

- 打开任意 `workflows/*.json`，即可获得补全/悬停/波浪线诊断（错误=红，警告=黄）。
- 打开工作流 JSON 后，可点击编辑器右上角的流程图按钮直接打开可视化编辑器。
- 命令面板（`Ctrl+Shift+P`）：
  - `Onmyoji: 打开工作流可视化编辑器`
  - `Onmyoji: 校验当前工作流 JSON`
  - `Onmyoji: 用自动化引擎校验 (CLI validate)`
  - `Onmyoji: 重新加载 Action 目录`
- 可视化编辑器：
  - 滚轮缩放、拖拽平移、拖动卡片调整位置（视觉位置不写入 JSON）。
  - 点击节点 → 右侧表单编辑 ID / Action / 参数 / when / 跳转 / 重试 / 超时。
  - 「🔗 引用」可为参数插入 `$ref`；「＋ 新增步骤」「保存到 JSON」「重新加载」。
  - 保存会以 2 空格缩进规范化 JSON 并保留原键顺序，最小化 diff。

## 配置

| 配置项 | 默认 | 说明 |
| --- | --- | --- |
| `onmyoji.projectRoot` | `""`（自动探测） | oooonmyoji 项目根目录 |
| `onmyoji.workflowFiles` | `**/workflows/*.json` | 启用智能提示的文件 glob |
| `onmyoji.pythonExecutable` | `""`（自动用 `.venv/Scripts/python.exe`） | 引擎校验使用的 Python |
| `onmyoji.configPath` | `config/config.json` | 引擎 CLI validate 的配置文件 |

## 自定义 Action

扩展会自动扫描 `<projectRoot>/plugins/actions/*/action.json` 并把它们纳入补全、参数表单和校验。
清单格式与引擎完全一致（引擎用 `additionalProperties: false` 校验，**不要加额外字段**）：`name`、`version`、`entry`、`input_schema` 必填，`output_schema`、`retry_safe`、`side_effect` 可选。
新增/修改自定义 Action 后执行 `Onmyoji: 重新加载 Action 目录`。

## 与引擎静态校验（`cli validate`）的关系

扩展的波浪线校验以「让工作流真正跑起来」为目标，与引擎 `validate` 命令的规则一致，并且**额外**提前暴露两类只有运行才会失败的问题：

| 问题 | `cli validate`（静态） | 引擎运行 | 扩展 |
| --- | --- | --- | --- |
| `with` 里写了 Action 不支持的参数 | 通过（不检查这一层） | 拒绝（`additionalProperties:false`） | 报错 `with.unknown` |
| `when` 直接写成 `{"$ref": ...}` | 通过 | 拒绝（`unsupported operator: $ref`） | 报错 `when.ref` |

其余规则（未知 Action、未知跳转、重复 ID、非法重试、非法 `$ref`、非法条件运算符、不可达步骤）与引擎 `validate` 完全一致，均为错误级别。

## 构建与打包

```powershell
npm run compile   # tsc 编译到 out/
npm run package   # vsce 打包 .vsix
```

## 冒烟测试（不依赖 VS Code 宿主）

```powershell
npm run compile
node tests/smoke.js
```

## 结构

```
src/extension.ts        扩展入口、命令
src/jsonProviders.ts    补全/悬停/诊断（vscode-json-languageservice + jsonc-parser）
src/catalog.ts          内置 + 自定义 Action 目录
src/workflow.ts         解析、语义校验、动态 schema、$ref 补全数据
src/layout.ts           图布局（纯逻辑）
src/webviewManager.ts   Webview 面板与消息协议
media/                  Webview 前端（HTML/CSS/JS）
snippets/               常用步骤代码片段
```
