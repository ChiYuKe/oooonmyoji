# 工作流目录约定

本目录下的工作流只有一种磁盘格式：**`.owf` 文本**（图文档 v6）。

- 文件名后缀必须是 `.owf`：加载器只发现 `workflows/**/*.owf`
  （`WorkflowLoader.discover()`），旧格式的 `.json` 不再被识别。
- 文档第一行用 `workflow <id>` 给出工作流 ID，文件里**不写** `schema_version`——
  `.owf` 后缀本身就是格式标记，解析出来的图文档固定是 `schema_version: 6`。
- 节点自带坐标 `at`，连接写成顶层 `edges` 显式边——**执行流**（`then.<下标>` / `true` /
  `false` / `case.<下标>` / `default`）、**数据流**（`out.<字段路径>` → 参数引脚）与
  **变量/输入**（`var <scope>.<key>` 变量节点 → 参数引脚）是同一张边表；加载时由
  `workflows/graph_compile.py` 编译回 Behavior Tree v4 再执行，运行时语义不变。
- 语法（缩进块、值语法、中缀表达式、规范形式）见
  [工作流文本格式 v6](../docs/workflow-dsl-v6.md)，图语义（节点 / 引脚 / 边 / 编译规则）见
  [节点图文档 v5](../docs/graph-document-v5.md)。

节点图还能在文档里声明**自定义节点类型**（`nodeTypes`：`x-…` → 内置基类 + 预设载荷 +
显示名），用法与规矩见 [节点图文档 v5](../docs/graph-document-v5.md#自定义节点类型x-)。

## 目录

- `entrypoints/`：可直接运行的入口工作流，文件名保留实例或业务含义。这个目录不随仓库提交，
  在编辑器里「新建工作流」时按需生成。
- 根目录：当前活动副本循环 `活动副本.owf`（工作流 ID `activity_loop`），按页面
  状态处理挑战页与结算页，轮数由 `inputs.运行轮数` 控制。
- 根目录：结界突破循环 `结界突破_寮突.owf`（工作流 ID `realm_raid_loop`），先识别
  当前页面再分支：停在结算页就点掉，否则打一轮突破并确认返回；页面上没有可突破的
  结界时正常结束，识别不到结界突破页时失败退出。
- `generated/`：编辑器与工具生成的临时工作流，可随时重建。MCP 模板工厂保存的工作流
  落在 `workflows/generated/<name>.owf`。

## 新建工作流

按最小可跑的形状写即可：头行、`version`、`resolution`、`root` 与 `edges` 必需，
节点块里**不写连线**（连线一律进顶层 `edges` 块）：

```owf
workflow my_workflow
  version: 3.0.0
  description: 查找目标并点击
  resolution: [1920, 1080]
  root: root

  inputs:
    模板:
      type: asset
      default: assets/templates/x.png

  node root root 入口
    at: [0, 0]

  node main sequence
    at: [200, 0]

  node find task
    at: [400, 0]
    action: vision.match_template
    params:
      template: inputs.模板

  edges:
    root -> main
    main -> find
```

## 迁移旧格式

v4 的 Behavior Tree JSON 与 v5 的图文档 JSON 都不再加载，一律用
`scripts/migrate_workflows_to_owf.py` 转成 `.owf`：

```powershell
python scripts/migrate_workflows_to_owf.py                                    # 只预览，不写盘
python scripts/migrate_workflows_to_owf.py --apply workflows/*.json           # 写盘并删除旧 .json
python scripts/migrate_workflows_to_owf.py --apply --keep-json workflows/*.json
```

默认只预览；`--apply` 才写盘并删掉旧 `.json`，`--keep-json` 保留旧文件。脚本接收 v4 或
v5 的 JSON，写盘前会把生成的文本解析回来编译一遍，与原文的运行时文档逐字段比对——
**不一致就不写盘**，迁移必须是语义零变化。

桌面端读写 `.owf` 已接线完成：编辑器直接打开、编辑、保存 `.owf`，新建工作流也写成 `.owf`。

## 引用规则

子流程引用使用相对于本目录的 POSIX 路径：`instance_parallel` 的 `runs[].workflow`
（以及 `workflow.run` Action 的 `params.workflow`）写 `活动副本.owf`；workspace 采用
「入口 + 子流程」分层。直接运行时也可以写工作流 ID 或唯一文件名，例如
`run-workflow activity_loop`。配置与 CLI 会把非 `.owf` 后缀替换成 `.owf`，所以沿用旧习惯写
`活动副本.json` 仍然能解析到 `活动副本.owf`，但推荐一律写 `.owf` 或直接写工作流 ID。

## 输入与变量

外部参数和运行状态分开：

- 顶层 `inputs` 可由父工作流的 `runs[].inputs` 传入；声明默认值后即可用
  `inputs.<键>` 只读引用（如 `template: inputs.模板`）。
- 顶层 `variables` 只在当前工作流内部使用，必须声明默认值；可选 `owner` 把变量
  限定到某个复合节点的子树，子树内用 `variables.<键>` 读取。

```owf
  inputs:
    运行轮数:
      type: integer
      default: 9999
  variables:
    internal_state:
      type: string
      default: ready
```

## 跨实例并行

顶层工作流可以用 `instance_parallel` 一次启动多个 MuMu/ADB 实例：

```owf
workflow run_accounts
  version: 1.0.0
  resolution: [1920, 1080]
  root: root

  node root root
    at: [0, 0]

  node run_all instance_parallel
    at: [200, 0]
    wait_for: all
    cancel_on_failure: true
    runs:
      - instance: mumu-0
        workflow: 活动副本.owf
        inputs: {}
      - instance: mumu-1
        workflow: 活动副本.owf
        inputs: {}

  edges:
    root -> run_all
```

`instance_parallel` 必须是 root 的唯一直接子节点，不能带装饰器；它的
`runs[].inputs` 只能引用父工作流的 `inputs`。点击编辑器运行按钮或执行
`run-workflow` 时，Supervisor 会并发投递所有运行项，输出中的 `group-...` ID
可用于整体取消。

## 权威契约

图文档的结构由 `src/oooonmyoji/workflows/graph_schema.py` 中的 JSON Schema 强制，
图语义（引脚存在性、一父多子、成环、switch 空分支、变量节点作用域等）由
`workflows/graph_compile.py` 在编译期报错，编译出的运行时文档再交给
`src/oooonmyoji/workflows/validator.py` 做执行语义校验；每个 Action 的参数与输出
schema 来自其 manifest（内置定义见 `src/oooonmyoji/actions/manifests/`）。
