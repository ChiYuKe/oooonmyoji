# 工作流目录约定

工作流是 Behavior Tree v4（`schema_version: 4`）的 JSON。运行时和 VS Code 会递归
发现 `workflows/**/*.json`，workspace 采用「入口 + 子流程」分层。

## 目录

- `entrypoints/`：可直接运行的入口工作流，文件名保留实例或业务含义。这个目录不随仓库提交，
  在编辑器里「新建工作流」时按需生成。
- 根目录：当前活动副本循环 `活动副本.json`（工作流 ID `activity_loop`），按页面
  状态处理挑战页与结算页，轮数由 `inputs.运行轮数` 控制。
- 根目录：结界突破循环 `结界突破_寮突.json`（工作流 ID `realm_raid_loop`），先识别
  当前页面再分支：停在结算页就点掉，否则打一轮突破并确认返回；页面上没有可突破的
  结界时正常结束，识别不到结界突破页时失败退出。
- `generated/`：编辑器与工具生成的临时工作流，可随时重建。

## 引用规则

`workflow.run.params.workflow` 使用相对于本目录的 POSIX 路径，例如
`活动副本.json`；直接运行时也可以用工作流 ID 或唯一文件名，
例如 `run-workflow activity_loop`。

## 输入与变量

schema v4 把外部参数和运行状态分开：

- 顶层 `inputs` 可由父工作流的 `runs[].inputs` 传入；声明默认值后即可用
  `{"ref": "inputs.<键>"}` 只读引用。
- 顶层 `variables` 只在当前工作流内部使用，必须声明默认值；可选 `owner` 把变量
  限定到某个复合节点的子树，子树内用 `{"ref": "variables.<键>"}` 读取。

```json
{
  "inputs": { "运行轮数": { "type": "integer", "default": 9999 } },
  "variables": { "internal_state": { "type": "string", "default": "ready" } }
}
```

## 跨实例并行

顶层工作流可以用 `instance_parallel` 一次启动多个 MuMu/ADB 实例：

```json
{
  "id": "run_accounts",
  "root": "root",
  "nodes": [
    { "id": "root", "type": "root", "children": ["run_all"] },
    {
      "id": "run_all",
      "type": "instance_parallel",
      "wait_for": "all",
      "cancel_on_failure": true,
      "runs": [
        { "instance": "mumu-0", "workflow": "活动副本.json", "inputs": {} },
        { "instance": "mumu-1", "workflow": "活动副本.json", "inputs": {} }
      ]
    }
  ]
}
```

`instance_parallel` 必须是 root 的唯一直接子节点，不能带装饰器；它的
`runs[].inputs` 只能引用父工作流的 `inputs`。点击编辑器运行按钮或执行
`run-workflow` 时，Supervisor 会并发投递所有运行项，输出中的 `group-...` ID
可用于整体取消。

## 权威契约

节点类型、装饰器、参数绑定与图结构的完整校验由
`src/oooonmyoji/workflows/validator.py` 中的 JSON Schema 强制；每个 Action 的
参数与输出 schema 来自其 manifest（内置定义见
`src/oooonmyoji/actions/manifests/`）。
