# Behavior Tree 工作流 v3 契约

v3 是破坏式迁移。旧的 `entry`、`edges`、独立条件节点和 `policy` 不再解析，
运行控制流只由树结构、复合节点和装饰器决定。

## 最小结构

```json
{
  "schema_version": 3,
  "id": "example",
  "version": "3.0.0",
  "description": "示例工作流的用途说明",
  "resolution": [1920, 1080],
  "root": "root",
  "limits": { "timeout_seconds": 300, "max_steps": 1000 },
  "blackboard": {
    "template": { "type": "asset", "required": true }
  },
  "nodes": [
    { "id": "root", "type": "root", "children": ["main"] },
    { "id": "main", "type": "sequence", "children": ["find", "tap"] },
    {
      "id": "find",
      "type": "task",
      "action": "vision.match_template",
      "params": { "template": { "ref": "blackboard.template" } },
      "decorators": [{ "type": "timeout", "seconds": 10 }]
    },
    {
      "id": "tap",
      "type": "task",
      "action": "input.tap_match",
      "params": { "match": { "ref": "nodes.find.output.0" } }
    }
  ]
}
```

## 树结构不变量

- `root` 必须指向一个 `type: root` 节点。
- Root 恰好有一个子节点，且不能有父节点或装饰器。
- 除 Root 外，每个节点恰好有一个父节点。
- `children` 有序，数组下标就是分支优先级。
- 禁止未知子节点、重复子节点、环和不可达节点。
- Task 是叶子，不能声明 `children`。
- Selector 与 Sequence 至少有一个子节点。
- Simple Parallel 恰好有两个子节点，第一个必须是 Task。
- Instance Parallel 只能作为 Root 的唯一直接子节点，不连接普通 `children`；它把多个
  `runs` 投递到不同运行实例，并由 Supervisor 统一等待和取消。

## 节点语义

| type | 结果规则 |
|---|---|
| `root` | 返回唯一子节点的结果 |
| `selector` | 子节点失败时尝试下一个；首个成功即成功；全部失败才失败 |
| `sequence` | 子节点成功时执行下一个；首个失败即失败；全部成功才成功 |
| `simple_parallel` | 第一个子节点是主 Task，第二个是后台分支；最终结果由主 Task 决定 |
| `instance_parallel` | Supervisor 同时启动 `runs` 中的多个实例工作流；不进入单实例 WorkflowEngine |
| `task` | 执行 Action，返回 `succeeded` / `failed` / `cancelled` |

Simple Parallel 的 `finish_mode`：

- `abort_background`：主 Task 完成后请求取消后台分支。
- `wait_for_background`：主 Task 完成后等待后台分支本轮结束。

每个并发 Action 使用独立取消令牌，后台取消不会污染主分支或其他 Action。

Instance Parallel 示例：

```json
{
  "id": "run_all_accounts",
  "type": "instance_parallel",
  "wait_for": "all",
  "cancel_on_failure": true,
  "runs": [
    {
      "instance": "mumu-0",
      "workflow": "entrypoints/mumu_0_souls_party_leader.json",
      "inputs": { "rounds": { "ref": "blackboard.rounds" } }
    },
    {
      "instance": "mumu-1",
      "workflow": "entrypoints/account_1.json",
      "inputs": {}
    }
  ]
}
```

`runs` 中的实例 ID 不能重复，引用路径必须位于 `workflows/` 下且文件存在。
运行项的 `inputs` 可以引用编排工作流的 `blackboard.*`，不能引用普通节点输出。
`wait_for` 支持 `all`（全部完成）和 `any`（任一成功即完成）；`cancel_on_failure`
为 true 时，一个运行失败会请求取消其余运行。取消命令既可使用子运行 ID，也可使用
返回的 `group-...` 编排运行 ID。

## 装饰器

装饰器位于节点的 `decorators` 数组。多个 Condition 按 AND 关系执行；除
Condition 外，同一节点不允许重复同类装饰器。

```json
[
  { "type": "condition", "expression": { "eq": [{ "ref": "blackboard.enabled" }, true] } },
  { "type": "cooldown", "seconds": 5 },
  { "type": "timeout", "seconds": 10 },
  { "type": "retry", "attempts": 3, "delay_seconds": 0.5 },
  { "type": "repeat", "count": 2 },
  { "type": "do_once" },
  { "type": "do_once", "reset_on_failure": true }
]
```

- Condition 在分支进入前求值，false 是普通分支失败。
- Cooldown 在节点离开后启动，锁定期间分支返回失败。
- Timeout 限制 Task 或整个子树的本次执行。
- Retry 仅在失败时重试；不可安全重试的 Action 会被静态拒绝。
- Repeat 仅在成功后继续下一次，任一次失败都会停止。
- Do Once 让被装饰节点在整个运行期间只真正执行一次：首次进入正常执行，
  之后的每次进入都不再执行并直接返回 `succeeded`（视为已完成）。
  默认失败也计入“已执行”，属于真正的一次性语义；状态在单次运行内隔离。
  可选 `reset_on_failure: true` 改为“成功才锁定”：失败不锁定，下次进入可
  再次执行，适合“反复尝试直到命中一次”的准备/恢复分支。

Condition 运算符：`exists`、`eq`、`ne`、`gt`、`gte`、`lt`、`lte`、
`contains`、`and`、`or`、`not`。条件不执行 Python 表达式。

## 黑板与引用

`blackboard` 使用 Action manifest 相同的参数定义词汇：`string`、`number`、
`integer`、`boolean`、`rect`、`asset`、`path`、`array`、`object`、`any`，
并支持 required、default、范围、枚举和嵌套结构。

顶层黑板变量还可以用 `public` 声明是否允许父工作流传值：

```json
{
  "blackboard": {
    "rounds": { "type": "integer", "public": true, "default": 9999 },
    "internal_state": { "type": "string", "public": false, "default": "ready" }
  }
}
```

- `public: true`：父工作流通过 `workflow.run.params.inputs` 或
  `instance_parallel.runs[].inputs` 传入常量，也可以绑定父工作流的同类型黑板变量。
- `public: false`：变量仅供当前工作流内部使用；父工作流传入该键时，静态校验和运行时都会拒绝。
- 为兼容既有 schema v3 文件，省略 `public` 时按公开变量处理；编辑器中新建的变量默认私有。
- `required` 与 `public` 相互独立。私有必填变量应提供默认值，否则父工作流无法为它赋值。

只允许两个引用命名空间：

- `blackboard.<键>[.<子字段>]`
- `nodes.<task-id>.output.<字段或数组下标>`

校验器会检查键、Action 输出字段与参数类型兼容性。运行时输出保存在 Task ID 下。

## 编辑器映射

- 复合节点卡片下方是输出引脚，非 Root 卡片上方是单输入引脚。
- 新连接会把目标节点从旧父级移出，再插入新父级的有序 `children`。
- 连线手柄支持重新连接；双击、Delete 或详情栏按钮可断开。
- 右侧详情栏编辑 Action 参数、装饰器、Simple Parallel 模式和子节点优先级。
- Instance Parallel 会在节点下展开每个 `runs[]` 子工作流卡片；卡片只显示公开变量，
  可选择使用子工作流默认值、填写常量或绑定父工作流变量。
- 画布支持拖动、框选、缩放、平移、边缘自动平移、自动布局、小地图和 `_layout` 持久化。

## Action manifest

Action manifest 仍使用独立的 `schema_version: 2`。它是 Action 参数、默认值、
输出 JSON Schema、副作用与重试安全性的唯一事实来源；工作流 schema v3 与
Action manifest v2 是两个不同版本域。
