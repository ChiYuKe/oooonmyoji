# Behavior Tree 工作流 v4 契约

v4 将调用方输入与流程内可变状态彻底分离。旧顶层参数容器和对应引用不再解析；
运行控制流仍只由树结构、复合节点和装饰器决定。

## 最小结构

```json
{
  "schema_version": 4,
  "id": "example",
  "version": "3.0.0",
  "description": "示例工作流的用途说明",
  "resolution": [1920, 1080],
  "root": "root",
  "inputs": {
    "模板": { "type": "asset", "required": true }
  },
  "variables": {},
  "nodes": [
    { "id": "root", "type": "root", "children": ["main"] },
    { "id": "main", "type": "sequence", "children": ["find", "tap"] },
    {
      "id": "find",
      "type": "task",
      "action": "vision.match_template",
      "params": { "template": { "ref": "inputs.模板" } },
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

## 运行限制

`limits` 完全可选，缺省表示不限制总超时与节点执行数；也可以只开启其中一项：

```json
"limits": { "timeout_seconds": 300 }
```

- `timeout_seconds`：整个工作流的总超时秒数，超时后以 `workflow_timeout` 结束。
- `max_steps`：整个工作流允许的节点执行次数上限，超出后以 `workflow_limit` 结束。

编辑器右侧“工作流设置 → 运行限制”为两项限制分别提供启用开关，关闭时不会写入对应字段。

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
      "inputs": { "运行轮数": { "ref": "inputs.运行轮数" } }
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
运行项的 `inputs` 可以引用编排工作流的 `inputs.*`，不能引用普通节点输出。
`wait_for` 支持 `all`（全部完成）和 `any`（任一成功即完成）；`cancel_on_failure`
为 true 时，一个运行失败会请求取消其余运行。取消命令既可使用子运行 ID，也可使用
返回的 `group-...` 编排运行 ID。

## 装饰器

装饰器位于节点的 `decorators` 数组。多个 Condition 按 AND 关系执行；除
Condition 外，同一节点不允许重复同类装饰器。

```json
[
  { "type": "condition", "expression": { "eq": [{ "ref": "inputs.启用" }, true] } },
  { "type": "cooldown", "seconds": 5 },
  { "type": "timeout", "seconds": 10 },
  { "type": "retry", "attempts": 3, "delay_seconds": 0.5 },
  { "type": "repeat", "count": 2 },
  { "type": "do_once" },
  { "type": "do_once", "reset_on_failure": true }
]
```

`repeat.count` 也可以绑定整数输入或运行变量，例如
`{ "type": "repeat", "count": { "ref": "inputs.运行轮数" } }`；编辑器中的“公开”按钮会自动创建一个整数工作流输入并完成绑定。

其他装饰器参数同样支持 `{ "ref": "inputs.参数名" }`：冷却与限时的 `seconds`、重试的 `attempts` 和 `delay_seconds`、仅执行一次的 `reset_on_failure`，以及条件的 `expression`。编辑器“公开”会按参数类型创建工作流输入，将当前值保留为默认值，名称冲突时自动加后缀。“固定值”恢复输入默认值，但不删除工作流输入。
次数必须为正整数，时长必须为正数，重试间隔允许为零，失败重置必须为布尔值；运行时同样检查引用解析后的值。条件可公开为布尔输入或条件表达式对象输入。动态重试次数仍遵循 Action 的重试安全限制。

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

## 输入、运行变量与引用

`inputs` 使用 Action manifest 相同的参数定义词汇：`string`、`number`、
`integer`、`boolean`、`rect`、`asset`、`path`、`array`、`object`、`any`，
并支持 `required`、`default`、范围、枚举和嵌套结构。所有 `inputs` 都是只读的，
父工作流可以通过 `workflow.run.params.inputs` 或 `instance_parallel.runs[].inputs`
传入常量，也可以绑定父工作流的同类型输入。

`variables` 只属于当前运行，不能由调用方传入，且每个变量必须有默认值。
变量只作为只读值在卡片参数中引用，运行期间不可修改：

```json
{
  "inputs": {
    "运行轮数": { "type": "integer", "default": 9999 }
  },
  "variables": {
    "内部状态": { "type": "string", "default": "ready" }
  },
  "nodes": [
    {
      "id": "use_state",
      "type": "task",
      "action": "core.log",
      "params": { "message": { "ref": "variables.内部状态" } }
    }
  ]
}
```

支持以下引用命名空间：

- `inputs.<键>[.<子字段>]`
- `variables.<键>[.<子字段>]`
- `nodes.<task-id>.output.<字段或数组下标>`
- `runtime.repeat.index|count|final`

校验器会检查键、Action 输出字段与参数类型兼容性。运行时输出保存在 Task ID 下。

## 编辑器映射

- 复合节点卡片下方是输出引脚，非 Root 卡片上方是单输入引脚。
- 新连接会把目标节点从旧父级移出，再插入新父级的有序 `children`。
- 连线手柄支持重新连接；双击、Delete 或详情栏按钮可断开。
- `Delete` 与 `Backspace` 等价：断连线、删节点、删选中变量与 `runs[]` 实例运行项；
  桌面端的内容浏览器条目、目录行与面包屑、执行队列行、结构树与变量列表也响应同一按键。
- 右侧详情栏编辑 Action 参数、装饰器、Simple Parallel 模式和子节点优先级。
- Instance Parallel 会在节点下展开每个 `runs[]` 子工作流卡片；卡片只显示工作流输入，
  可选择使用子工作流默认值、填写常量或绑定父工作流输入。
- 画布支持拖动、框选、缩放、平移、边缘自动平移、自动布局、小地图和 `_layout` 持久化。

## Action manifest

Action manifest 仍使用独立的 `schema_version: 2`。它是 Action 参数、默认值、
输出 JSON Schema、副作用与重试安全性的唯一事实来源；工作流 schema v4 与
Action manifest v2 是两个不同版本域。

## 变量编辑与作用域

- 定义的 JSON 键是稳定标识，`display_name` 仅用于显示。新建变量使用 `v_…` 标识；旧工作流的键不迁移，改显示名不会改写引用。
- `variables.<id>.initial_from` 可填写一个输入标识，在每次运行开始时将该输入深拷贝为变量初值，运行期间保持只读；取消开放会清理已无引用的自动输入，手动输入保留。
- 定义的 `group` 是自定义分组名称，留空为未分组。输入与运行变量各自分组，分组不改变标识或执行作用域。
- 编辑器公开操作生成的输入带 `_autoPublished: true`。解除最后一个引用时清理该输入；其他节点、初始化来源或 Get 卡片仍在使用则保留。清理与修改在同一次撤销记录内。无标记的历史输入不自动删除。
- `variables.<id>.owner` 可指定复合节点。只有该节点及其后代可读取，进入范围时初始化，退出时恢复外层值。不填写则属于本次工作流运行。
- Get 使用 `{"ref":"variables.<id>"}`；变量只读，不再提供 Set 动作，也不允许在运行期间写入。
- 结构体通过 `type: object` 与 `properties` 定义，可整体绑定或引用成员，例如 `inputs.<id>.attempts`。Retry 一次公开产生一个含 `attempts`、`delay_seconds` 的结构输入。
- `_variableTypes` 保存当前工作流可复用的结构预设，是编辑器元数据，不改变执行语义。不是项目级全局类型注册表。
- 步骤事件的 `variable_values` 是最近执行快照，按实例展示；大对象沿用日志摘要截断规则，不代表暂停调试器的实时求值。
- 输入始终只读，实例之间不共享变量。这里保留行为树执行模型，并不引入 UE 对象、继承或事件图系统。
