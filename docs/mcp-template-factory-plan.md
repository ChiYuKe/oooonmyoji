# MCP 模板工厂方案

## 1. 文档目的

为 `oooonmyoji` 增加一个 MCP（Model Context Protocol）服务，让 AI 能够根据用户的自然语言需求制作、校验并保存可运行的工作流模板。

本文档同时作为实施清单和进度记录。每完成一个步骤，都要勾选对应项，并在文末追加一条进度记录，说明完成内容、验证方式和遗留问题。

## 2. 总体目标

用户可以向 AI 描述类似下面的需求：

> 进入御魂界面，找到准备按钮，点击后等待战斗结束；如果出现继续按钮就继续，否则返回庭院。

AI 应能够：

1. 理解项目支持的工作流 v4 结构。
2. 查询当前可用的 Action、参数和输出。
3. 查询现有工作流和图片模板资源。
4. 生成一份新的 JSON 工作流。
5. 调用项目现有校验器检查结构、引用、Action 参数和资源路径。
6. 根据校验错误自动修正，直到生成有效模板或明确告知用户缺少资源。
7. 将模板保存到受控目录，供桌面端和运行时使用。

## 3. 当前项目能力盘点

### 3.1 可以直接复用的能力

- `src/oooonmyoji/workflows/validator.py`
  - 已实现工作流 v4 的 JSON Schema、树结构、引用、Action 参数和变量校验。
- `src/oooonmyoji/workflows/loader.py`
  - 已实现工作流发现、加载、路径检查、输入默认值和模板资源校验。
- `src/oooonmyoji/actions/registry.py`
  - 已实现内置 Action 和插件 Action 的统一注册。
- `src/oooonmyoji/actions/manifest.py`
  - Action manifest 已包含参数 schema、输出 schema、描述和副作用信息。
- `workflows/`
  - 已有入口工作流、公共子流程、组队流程和示例工作流，可作为 AI 参考模板。
- `assets/templates/`
  - 已有按功能组织的视觉模板图片。
- 现有 CLI
  - 已支持 `list-workflows`、`show-workflow`、`list-actions`、`run-workflow` 等能力。

### 3.2 需要区分的两类模板

#### 工作流模板

行为树 v4 JSON，描述识别、点击、等待、分支、重试、循环和子工作流组合。这是 MCP 模板生成阶段的主要产物。

#### 图片模板

供 `vision.match_template` 和 `vision.wait_template` 使用的 PNG 等图片资源。图片模板通常需要从用户的模拟器截图中截取，不能只靠文本模型凭空生成。

模板生成阶段中，AI 可以选择已有图片模板，也可以读取已配置实例的截图并按 ROI
生成新图片；不允许 AI 随意写入项目外部图片或修改现有资源。

## 4. 第一阶段范围

### 4.1 MCP 只读能力

建议提供以下资源或工具：

```text
get_project_guide()
list_actions()
get_action(action_name)
list_workflows()
get_workflow(workflow_id)
list_assets()
capture_screen(instance_id)
```

返回内容应尽量结构化，方便模型可靠地生成 JSON，而不是只返回大段说明文本。

### 4.2 MCP 图片和工作流生成、校验能力

```text
create_template_asset(capture_id, roi, name)
validate_workflow(workflow_json)
save_workflow_template(workflow_json, name, description)
```

`capture_screen` 只读取画面，不发送设备输入；`create_template_asset` 只允许从
临时截图缓存按 ROI 生成 PNG，并写入 `assets/templates/generated/`。

`validate_workflow` 必须复用项目当前的 `validate_workflow()` 和 `WorkflowLoader`，不在 MCP 中复制一套 schema。

`save_workflow_template` 应先校验，校验通过后才能写文件。默认保存到：

```text
workflows/generated/
```

默认禁止覆盖同名文件。

### 4.3 第一阶段明确不做的能力

- 不允许 AI 创建或修改 Python Action。
- 不允许 AI 写入项目根目录以外的文件。
- 不默认暴露点击、滑动、输入文字、启动工作流等运行时操作。
- 不让 AI 自动覆盖已有工作流或图片模板。
- 不承诺 AI 能够凭文字生成准确的游戏截图模板。

## 5. 推荐架构

```text
AI 客户端
    │ MCP stdio
    ▼
MCP 模板服务
    ├── ProjectContext      读取项目说明、Action、工作流和资源
    ├── WorkflowService     加载、生成、校验、保存工作流
    ├── DeviceReadService   连接实例、读取截图，不发送输入
    ├── AssetService        枚举资源并按截图 ROI 生成 PNG
    └── WritePolicy         路径、命名、覆盖和文件大小限制
    │
    ▼
oooonmyoji 现有运行时
    ├── ActionRegistry
    ├── WorkflowLoader
    └── validate_workflow
```

推荐目录：

```text
src/oooonmyoji/mcp/
├── __init__.py
├── server.py       # MCP 入口和工具注册
├── service.py      # 项目上下文、工作流和资源服务
└── policy.py       # 受控路径和写入规则
```

如果 MCP SDK 作为可选能力安装，依赖可以单独放在 `requirements-mcp.txt`，避免不需要 MCP 的运行环境被额外依赖影响。

## 6. AI 制作模板的标准流程

```text
1. 读取项目能力说明
2. 查询 Action 清单和参数 schema
3. 查询相近的现有工作流
4. 查询可用图片模板
5. 如果缺少模板，调用 capture_screen 获取截图
6. 根据截图确定实际像素 ROI，并调用 create_template_asset 生成 PNG
7. 生成工作流 JSON
8. 调用 validate_workflow
9. 根据 errors 修正 JSON
10. 检查 warnings 和缺失资源
11. 保存到 workflows/generated/
12. 将文件路径、输入参数和使用说明返回给用户
```

当缺少图片模板时，MCP 返回结构化缺口：

```json
{
  "ok": false,
  "kind": "missing_asset",
  "asset_role": "souls-ready-button",
  "message": "需要用户从模拟器画面截取准备按钮模板",
  "suggested_action": "使用 ROI 标注工具截取并保存到 assets/templates/generated/"
}
```

## 7. 工具接口设计

### 7.1 `list_actions`

返回所有可用 Action 的名称、描述、输入 schema、输出 schema、是否有副作用和是否允许安全重试。

```json
{
  "actions": [
    {
      "name": "vision.wait_template",
      "description": "等待指定图片模板出现",
      "input_schema": {},
      "output_schema": {},
      "side_effect": false,
      "retry_safe": true
    }
  ]
}
```

### 7.2 `list_workflows`

返回工作流 ID、版本、描述、相对路径、分辨率、输入定义和节点摘要。默认不返回过大的完整 JSON。

### 7.3 `get_workflow`

根据工作流 ID 或工作流相对路径返回经过加载器验证的原始 JSON，并附带文件哈希和相对路径。

### 7.4 `list_assets`

只枚举项目资源目录内的文件，至少返回：

- 相对路径
- 文件类型
- 文件大小
- 图片宽高（如果可以读取）
- 所属功能目录

不返回项目目录外的路径。

### 7.5 `validate_workflow`

输入是一份完整的工作流 JSON。输出必须区分：

- `errors`：阻止保存的问题。
- `warnings`：不阻止保存但需要用户注意的问题。
- `normalized_inputs`：可选，返回已应用默认值的输入定义。
- `referenced_assets`：工作流实际引用的资源。

建议错误格式：

```json
{
  "ok": false,
  "errors": [
    {
      "path": "nodes[2].params.template",
      "code": "asset_not_found",
      "message": "模板文件不存在: assets/templates/generated/ready.png"
    }
  ],
  "warnings": []
}
```

### 7.6 `capture_screen`

连接指定的已配置实例并读取一帧当前画面，返回 MCP 图片块、截图尺寸和临时
`capture_id`。该工具不发送任何设备输入事件；截图只保留在 MCP 进程内存中。

```text
capture_screen(instance_id="mumu-0")
```

### 7.7 `select_roi`

使用截图缓存 ID 调用已有 `roi_editor.py --select-roi`，打开本地可视化框选窗口。
用户确认后返回截图坐标 `image_rect` 和参考分辨率坐标 `reference_rect`；该过程
不重新连接设备，也不发送设备输入事件。

### 7.8 `create_template_asset`

使用 `capture_id` 对截图按实际像素 ROI `[x, y, width, height]` 裁剪，并将 PNG
保存到 `assets/templates/generated/`。只接受安全文件名，默认禁止覆盖，并返回
裁剪图片预览和资源路径。

### 7.9 `save_workflow_template`

建议参数：

```text
workflow_json   完整工作流对象
name            目标文件名或模板 ID
description     可选的用户说明
overwrite       默认 false
```

保存规则：

1. 校验工作流 JSON。
2. 校验模板 ID 和文件名，只允许简单安全字符。
3. 目标只能位于 `workflows/generated/`；图片模板只能位于 `assets/templates/generated/`。
4. 目录不存在时可以创建。
5. 使用临时文件加原子替换，避免生成半个 JSON 文件。
6. `overwrite=false` 时，同名文件直接返回冲突信息。
7. 返回相对路径、工作流 ID、版本和校验结果。

## 8. 权限和安全策略

### 8.1 文件边界

MCP 服务只能读取：

- `README.md`
- `docs/`
- `workflows/`
- `assets/templates/`
- `src/oooonmyoji/actions/manifests/`
- `plugins/actions/` 中的 manifest
- 已配置实例的当前设备画面（仅截图，不发送输入事件）

MCP 服务只能写入：

- `workflows/generated/`
- `assets/templates/generated/`

图片资源只能通过截图缓存 ID 和截图实际像素 ROI 生成 PNG；不接受任意本地路径，
并增加明确的图片格式、尺寸和文件大小限制。

### 8.2 内容边界

- 工作流必须是 schema v4。
- Action 必须来自当前 registry。
- 模板引用必须位于项目资源目录内。
- 禁止绝对路径和 `..` 路径。
- 限制节点数量、JSON 大小和文件名长度。
- 默认禁止覆盖。
- 默认不提供设备输入和任务执行工具；截图工具只执行连接、捕获和关闭。

### 8.3 发布和运行边界

生成和运行应保持两个阶段：

```text
AI 生成 → MCP 校验 → 保存模板 → 用户在桌面端确认 → 用户运行
```

未来如需增加 `run_workflow`，应单独设计确认机制、实例白名单、超时、取消和运行结果查询，不能因为已经能保存模板就顺手开放设备控制。

## 9. 实施步骤

### 第 0 步：项目调研

- [x] 确认工作流目录和 schema v4。
- [x] 确认 Action registry 和 manifest 能提供参数 schema。
- [x] 确认 `WorkflowLoader` 能提供工作流发现和资源路径校验。
- [x] 确认现有图片模板目录和 ROI 工具。
- [x] 记录当前工作区已有改动，后续只新增或修改 MCP 相关文件。

### 第 1 步：确定 MCP 运行方式和依赖

- [x] 选择官方 MCP Python SDK v2 和 stdio 启动方式。
- [x] 确定 MCP 服务启动参数：`--config`，并提供可选的 `--project-root`。
- [x] 将依赖放在独立的 `requirements-mcp.txt`，不影响原有主依赖。
- [x] 写出 AI 客户端的本地启动配置示例。

验收：在不启动 MuMu 的情况下，可以启动 MCP 服务并完成握手，读取工具清单。

当前状态：已完成。使用桌面自带 Python 3.12 运行时完成服务启动、MCP 初始化和工具发现；项目原 `.venv` 仍指向已不存在的 Python 安装路径，实际使用时应在客户端配置中填入本机有效 Python 路径。

### 第 2 步：实现只读项目上下文

- [x] 实现 Action 清单读取。
- [x] 实现工作流清单和详情读取。
- [x] 实现图片资源清单读取。
- [x] 增加项目能力说明资源。

验收：AI 可以只通过 MCP 获取生成工作流所需的 schema、Action 和资源信息。

### 第 3 步：实现工作流校验工具

- [x] 接收完整工作流 JSON。
- [x] 复用 `validate_workflow()`。
- [x] 复用 `WorkflowLoader.validate_paths()` 和输入资源校验。
- [x] 将内部异常转换成稳定的结构化错误。
- [x] 增加错误路径、错误代码和修复建议。

验收：合法工作流返回 `ok=true`；Action 不存在、节点断链、引用错误、资源不存在等情况返回可定位的错误。

### 第 4 步：实现安全保存工具

- [x] 增加 `workflows/generated/`。
- [x] 增加文件名和工作流 ID 校验。
- [x] 增加默认禁止覆盖。
- [x] 使用原子写入。
- [x] 保存前强制校验。
- [x] 返回相对路径和校验摘要。

验收：AI 可以保存有效模板；无效模板不会落盘；越权路径和同名覆盖会被拒绝。

### 第 5 步：补充测试和示例

- [x] 增加 MCP 服务单元测试。
- [x] 增加路径越权测试。
- [x] 增加无效工作流不能保存测试。
- [x] 增加重复文件名和 JSON 原子写入测试。
- [x] 增加一个最小的自然语言生成示例。
- [x] 更新 README 的安装和启动说明。

验收：默认测试和 MCP 专项测试通过，且不要求真实 MuMu 实例。

### 第 6 步：桌面端联动

- [x] 在桌面端显示 `workflows/generated/` 模板。
- [x] 显示模板来源、校验状态和生成时间。
- [x] 复用现有“打开编辑器”和用户点击“运行所选”作为运行前确认入口。
- [x] 将缺失图片模板提示连接到 ROI 工具。

当前状态：已完成桌面联动。桌面端会递归发现生成目录，并在概览卡片显示来源、校验状态和更新时间；编辑器会读取 assets 图片清单，对不存在的模板引用显示红色提示，并提供“从当前画面补齐”入口，将 ROI 截取结果保存到原引用路径。MCP 保存后点击桌面端已有“刷新”即可看到新模板。

### 第 7 步：设备截图和图片模板生成

- [x] 增加只读 `capture_screen(instance_id)` 工具。
- [x] 以 MCP 图片块返回截图，并返回临时 `capture_id`。
- [x] 接入已有 `roi_editor.py --select-roi` 框选窗口，增加 `select_roi(capture_id)` 工具。
- [x] 增加 `create_template_asset(capture_id, roi, name)` 工具。
- [x] 将图片写入 `assets/templates/generated/`，并限制文件名、ROI、大小和覆盖行为。
- [x] 截图与裁剪均复用现有设备后端和 OpenCV 图像转换。

验收：不发送设备输入事件即可取得截图；使用截图 ID 和有效 ROI 生成 PNG，
越界 ROI、过期截图和越权路径都会被拒绝。

### 第 8 步：可选的运行能力

- [ ] 设计显式确认机制。
- [ ] 增加实例白名单。
- [ ] 增加运行超时和取消能力。
- [ ] 增加运行状态查询和结果摘要。
- [ ] 默认关闭设备控制工具。

验收：只有用户明确确认后，AI 才能启动指定模板，并且可以可靠取消。

## 10. 测试策略

### 单元测试

- Action 和工作流清单返回稳定结构。
- 截图工具只调用设备连接、捕获和关闭，不调用点击、滑动、按键或文字输入。
- 截图返回 MCP 图片块和可用于后续裁剪的临时 capture ID。
- ROI 裁剪只写入 `assets/templates/generated/`，并拒绝越界和越权路径。
- 工作流详情不会泄露项目外路径。
- 合法 v4 工作流可以通过校验。
- 非法 Action、非法引用和非法树结构会被拒绝。
- 输入模板资源缺失时返回 `asset_not_found`。
- 绝对路径、`..` 路径和符号链接越权会被拒绝。
- 同名文件默认不能覆盖。
- 保存中断时不会留下损坏 JSON。

### 集成测试

- 通过 stdio 启动 MCP 服务。
- 完成 MCP 初始化和工具发现。
- 调用查询、校验和保存工具。
- 保存后的工作流能够被现有 `WorkflowLoader.discover()` 发现。
- 不连接真实设备即可完成完整测试。

### 人工验收

1. 用自然语言描述一个简单的“识别后点击”流程。
2. AI 查询 Action 和图片资源。
3. AI 生成工作流并调用校验工具。
4. AI 根据错误自动修正。
5. AI 保存模板。
6. 在桌面端打开模板并确认节点、参数和图片引用。

## 11. 完成标准

当前模板生成阶段的完成定义：

- MCP 服务可以稳定启动并被 AI 客户端发现。
- AI 可以读取项目能力、Action、工作流和资源清单。
- AI 可以生成符合工作流 v4 的 JSON。
- 无效模板无法保存。
- 保存路径和文件权限受到限制。
- 生成模板可以被现有桌面端和运行时读取。
- 测试不依赖真实设备。
- README 和本方案文档包含安装、启动和故障排查说明。
- AI 可以读取设备截图并从截图生成受控 PNG 模板，仍不会执行设备输入。

## 12. 进度记录

| 日期 | 步骤 | 状态 | 完成内容 | 验证方式 | 遗留问题 |
|---|---|---|---|---|---|
| 2026-09-13 | 第 0 步：项目调研 | 已完成 | 确认工作流 v4、Action manifest、WorkflowLoader、图片模板目录和现有 CLI；确定第一阶段以工作流模板为主，图片模板作为资源缺口处理。 | 阅读项目 README、工作流 schema、loader、validator、Action registry 和目录结构。 | MCP SDK、启动配置和具体实现尚未确定。 |
| 2026-09-13 | 第 1 步：运行方式和依赖 | 已完成（运行验证） | 新增 `src/oooonmyoji/mcp/server.py` 最小 stdio 入口、`src/oooonmyoji/mcp/__init__.py`、可选依赖文件和客户端配置示例；注册 `server_info` 工具，明确当前不具备写文件和设备执行权限。 | 使用桌面自带 Python 3.12 安装 MCP SDK、pytest、jsonschema；完成 `--help`、MCP initialize 和 stdio 工具发现，发现 9 个工具。 | 项目原 `.venv` 仍指向已不存在的 Python 安装路径；客户端配置需改为本机有效 Python 路径。 |
| 2026-09-13 | 第 2 步：只读项目上下文 | 已完成（运行验证） | 新增 `src/oooonmyoji/mcp/service.py`；MCP 现在提供项目说明、Action 清单/详情、工作流清单/详情和图片资源清单工具，并通过 `oooonmyoji://guide` 暴露项目说明资源。 | stdio 工具调用成功：`server_info` 返回模板生成模式，`list_assets` 返回 52 项资源；确认实现不创建设备、不启动 Supervisor、不写项目文件。 | 尚未用真实 AI 客户端做交互式自然语言验收。 |
| 2026-09-13 | 第 3 步：工作流校验工具 | 已完成（运行验证） | `ProjectContextService.validate_workflow()` 先定位 schema 错误，再复用运行时的 `validate_workflow()`、模板路径校验和输入默认资源校验；新增 MCP `validate_workflow` 工具，返回 `path/code/message`、资源引用和工作流摘要。 | stdio 调用合法最小工作流返回 `ok=true`、`errors=0`；专项测试覆盖未知 Action、非法引用和结构错误。 | 尚未用真实 AI 客户端做交互式自然语言验收。 |
| 2026-09-13 | 第 4 步：安全保存工具 | 已完成（运行验证） | 新增 `save_workflow_template` MCP 工具；模板保存前强制校验，只允许安全名称和 `workflows/generated/`，限制 JSON 大小，默认拒绝覆盖，并通过临时文件和原子替换写入。 | 专项测试验证有效模板保存、无效模板不落盘、越权名称、重复文件名和保存结果；保存逻辑实际运行通过。 | 尚未通过真实 AI 客户端执行一次用户确认后的保存。 |
| 2026-09-13 | 第 5 步：测试和示例 | 已完成（运行验证） | 新增 `tests/test_mcp_template_service.py`，覆盖只读清单、合法/非法工作流、路径越权、无效模板不落盘、重复文件名和保存结果；新增 `docs/mcp-template-generation-example.md`；README 增加可选依赖、stdio 启动和配置说明。 | MCP 专项测试 `6 passed`；全量 Python 测试 `218 passed, 2 skipped`；无真实 MuMu 依赖。 | 桌面端完整 Node 测试仍有 1 项工作区原有浅色主题生成文件失败。 |
| 2026-09-13 | 第 6 步：桌面端联动 | 已完成（已做 Node 验证） | 修改 `desktop/src/shared/contracts.ts`、`desktop/src/main/projectService.ts`、`desktop/src/renderer/main.ts`、`desktop/src/renderer/styles.css`，并补充 `desktop/public/legacy/workflow-editor.js`、`desktop/public/legacy/inspector.css`：桌面端显示 AI 生成、校验状态和更新时间；编辑器对缺失模板资源显示红色状态，并可直接调用 ROI 工具补齐原路径。 | `desktop/npm run typecheck`、`node --check public/legacy/workflow-editor.js` 和 `git diff --check` 通过；完整 `npm test` 为 85 项通过、1 项失败，失败是工作区原有浅色主题生成文件不一致。 | Python MCP 服务仍待恢复解释器后验证；尚未连接真实 MuMu 做人工 ROI 验收。 |
| 2026-09-13 | 阶段性验证补充 | 已记录 | 保留现有工作区改动，不处理与 MCP 无关的浅色主题生成文件失败；确认本次新增 TypeScript、旧版编辑器脚本和 MCP 代码均完成对应验证。 | `desktop/npm run typecheck`、`node --check public/legacy/workflow-editor.js`、`git diff --check`、MCP 专项测试、MCP 握手和工具调用均通过；`desktop/npm test` 结果为 85 passed、1 failed。 | 桌面端那 1 项浅色主题生成文件失败仍属于工作区原有问题；真实 AI 客户端对话式生成尚未验收。 |
| 2026-09-13 | MCP 运行验收补充 | 已完成 | 使用桌面自带 Python 3.12 完成 MCP 服务启动、initialize、tools/list 和工具调用；确认服务仅提供模板生成能力，设备执行开关为 `False`。 | initialize 成功；发现 9 个工具；`server_info`、`list_assets`、`validate_workflow` 调用成功；全量 Python 测试 218 passed、2 skipped。 | 仍需在用户选择的 AI 客户端中填入有效 Python 路径并进行一次实际对话式生成；第 7 步设备运行能力保持未开启。 |
| 2026-09-13 | Codex 客户端接入 | 已完成 | 将 `oooonmyoji-template-factory` 写入 Codex 全局 `config.toml`，配置本地 STDIO Command、项目配置文件和工作目录；保持服务的设备执行能力关闭。 | `codex mcp get` 和 `codex mcp list` 均能读到服务器，配置状态为 enabled；服务此前已完成 MCP initialize 和工具调用验证。 | 需要重启 Codex 让当前会话重新加载配置，然后进行一次真实对话式生成验收。 |
| 2026-09-13 | 真实对话式生成验收 | 已完成 | 通过 `oooonmyoji-template-factory` 查询 26 个 Action 和 52 个图片资源，使用 `vision.match_template` 识别 `assets/templates/start/yys_tubiao.png`，再用 `input.tap_match` 点击匹配中心；工作流命名为 `test_template`。 | MCP `validate_workflow` 返回 `ok=true`、无错误和无警告且资源存在；随后 `save_workflow_template` 返回保存成功，路径为 `workflows/generated/test_template.json`；全程未调用设备操作。 | 该模板尚未在真实设备上运行，符合本次“不执行设备操作”要求。 |
| 2026-09-13 | 第 7 步：设备截图和图片模板生成 | 已完成（无设备运行验证） | 新增 `capture_screen`、`select_roi` 和 `create_template_asset`；截图以 MCP 图片块返回并缓存临时 `capture_id`，`select_roi` 调用已有 ROI 框选程序返回 `image_rect`/`reference_rect`，模板仅能由截图 ROI 生成到 `assets/templates/generated/`；更新 MCP 状态说明、依赖和 README。 | MCP 工具发现包含 12 个工具；专项测试 `10 passed`，覆盖模拟截图、PNG 返回、只读关闭、ROI 裁剪、重复文件、路径/ROI 校验和 ROI 程序调用参数；未连接真实设备、未打开真实窗口。 | 截图功能需要用户配置的实例在线；第 8 步设备输入和工作流运行仍关闭。 |

### 进度记录规则

每完成一个实施步骤：

1. 勾选本节对应的任务项。
2. 更新上面的进度表。
3. 记录实际修改的文件。
4. 记录运行过的测试或人工验证方式。
5. 明确写出未完成内容和下一步。
