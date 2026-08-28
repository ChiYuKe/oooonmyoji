# Behavior Tree 工作流 v3 契约

v3 是破坏式迁移。旧的 `entry`、`edges`、独立条件节点和 `policy` 不再解析，
运行控制流只由树结构、复合节点和装饰器决定。

## 最小结构

```json
{
  "schema_version": 3,
  "id": "example",
  "version": "3.0.0",
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

## 节点语义

| type | 结果规则 |
|---|---|
| `root` | 返回唯一子节点的结果 |
| `selector` | 子节点失败时尝试下一个；首个成功即成功；全部失败才失败 |
| `sequence` | 子节点成功时执行下一个；首个失败即失败；全部成功才成功 |
| `simple_parallel` | 第一个子节点是主 Task，第二个是后台分支；最终结果由主 Task 决定 |
| `task` | 执行 Action，返回 `succeeded` / `failed` / `cancelled` |

Simple Parallel 的 `finish_mode`：

- `abort_background`：主 Task 完成后请求取消后台分支。
- `wait_for_background`：主 Task 完成后等待后台分支本轮结束。

每个并发 Action 使用独立取消令牌，后台取消不会污染主分支或其他 Action。

## 装饰器

装饰器位于节点的 `decorators` 数组。多个 Condition 按 AND 关系执行；除
Condition 外，同一节点不允许重复同类装饰器。

```json
[
  { "type": "condition", "expression": { "eq": [{ "ref": "blackboard.enabled" }, true] } },
  { "type": "cooldown", "seconds": 5 },
  { "type": "timeout", "seconds": 10 },
  { "type": "retry", "attempts": 3, "delay_seconds": 0.5 },
  { "type": "repeat", "count": 2 }
]
```

- Condition 在分支进入前求值，false 是普通分支失败。
- Cooldown 在节点离开后启动，锁定期间分支返回失败。
- Timeout 限制 Task 或整个子树的本次执行。
- Retry 仅在失败时重试；不可安全重试的 Action 会被静态拒绝。
- Repeat 仅在成功后继续下一次，任一次失败都会停止。

Condition 运算符：`exists`、`eq`、`ne`、`gt`、`gte`、`lt`、`lte`、
`contains`、`and`、`or`、`not`。条件不执行 Python 表达式。

## 黑板与引用

`blackboard` 使用 Action manifest 相同的参数定义词汇：`string`、`number`、
`integer`、`boolean`、`rect`、`asset`、`path`、`array`、`object`、`any`，
并支持 required、default、范围、枚举和嵌套结构。

只允许两个引用命名空间：

- `blackboard.<键>[.<子字段>]`
- `nodes.<task-id>.output.<字段或数组下标>`

校验器会检查键、Action 输出字段与参数类型兼容性。运行时输出保存在 Task ID 下。

## 编辑器映射

- 复合节点卡片下方是输出引脚，非 Root 卡片上方是单输入引脚。
- 新连接会把目标节点从旧父级移出，再插入新父级的有序 `children`。
- 连线手柄支持重新连接；双击、Delete 或详情栏按钮可断开。
- 右侧详情栏编辑 Action 参数、装饰器、Simple Parallel 模式和子节点优先级。
- 画布支持拖动、框选、缩放、平移、边缘自动平移、自动布局、小地图和 `_layout` 持久化。

## Action manifest

Action manifest 仍使用独立的 `schema_version: 2`。它是 Action 参数、默认值、
输出 JSON Schema、副作用与重试安全性的唯一事实来源；工作流 schema v3 与
Action manifest v2 是两个不同版本域。
