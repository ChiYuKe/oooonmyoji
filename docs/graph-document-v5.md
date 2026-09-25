# 节点图文档 v5（Graph Document）

状态：**P1（Python 侧）与 P2（桌面端读写）已落地，磁盘落盘已换成 `.owf` 文本**，
`workflows/` 下的两份工作流已经迁移成图文档并以 `.owf` 落盘；
Python 与桌面端都读写 `.owf`，运行时仍执行编译出来的 v4。

> **v5 的 JSON 落盘已退役**：磁盘格式换成了 v6 文本（`.owf`，见
> [工作流文本格式 v6](./workflow-dsl-v6.md)），Python 加载链路只读 `.owf`，
> 图文档的 `schema_version` 从 5 提到 6（`graph_schema.py` 的
> `GRAPH_SCHEMA_VERSION = 6`；解析 `.owf` 得到的文档就是 6）。
> **本文只描述图语义**——节点、引脚、边、编译规则一字未改，v6 换掉的只是「文档怎么写成
> 文本」。因此下文出现的 v5 JSON 片段是这套图语义的 JSON 形态，用来说明字段与编译规则，
> **不再是落盘格式**；迁移用 `scripts/migrate_workflows_to_owf.py`（只产出 v5 JSON 的旧脚本
> 已删除）。桌面端的 `.owf` 读写已经接线完成（见文末分阶段 P3）。

## 为什么要换

现在的 `schema_version: 4` 是 **Behavior Tree 的序列化**，不是**图**：

- 连接关系藏在 `children: [id]` 里，是一棵**有序树**：一个节点只能有一个父级，顺序即数组顺序，
  「哪条线从哪个口出来」要靠 `ports` 这个旁路字段补。
- 坐标在旁表 `_layout: {节点id: {x, y}}` 里，锁在 `_layoutLocks` 里，变量卡在 `_variableCards` 里，
  变量连线在 `_variableLinks` 里，节点组在 `_nodeGroups` 里——**节点删掉之后坐标会变成孤儿**
  （`model/document-health.ts` 的 `pruneOrphanLayout` 就是给这个洞打的补丁）。
- 同一个「连线」概念在文档里有**四种写法**：`children`（执行顺序）、`ports`（口位）、
  `{"ref": "nodes.x.output.y"}`（输出引用）、`_variableLinks`（变量连线），外加 `_variableCards`
  这种「线的端点自己还得有坐标」的第五种。
- `type` 是固定枚举（`NODE_TYPES` 13 种），节点不能带自定义字段
  （v4 schema 对 node 是 `additionalProperties: false`）。

UE 蓝图的文档是**图**：`UEdGraphNode` 自带 `NodePosX/NodePosY` 和 `Pins`，连接是
`UEdGraphPin::LinkedTo` 形成的边，节点类可扩展，注释框（Comment）与折叠图都是文档里的一等公民。
v5 就是把这份 JSON 变成那种东西，同时**不改运行时**。

## 目标与边界

1. **图即文档**：节点自带坐标与引脚，连接是显式边表；`children` 与 `_layout` 不再出现在文档里。
2. **运行时不改**：加载时把图**编译**成 v4，现有 `validator.py` / `engine.py` / `supervisor.py`
   一行不改，执行语义完全不变。
3. **一种连线**（目标，分步到）：执行流、参数绑定、变量绑定、输出引用最终统一成 `edges`；
   P1 先把**执行流**收进边表，数据绑定仍留在参数里（P4 收敛），避免一次改太多东西。
4. **最小增量**：节点上的 `action` / `params` / `decorators` / `expression` / `fields` / `cases` /
   `runs` / `wait_for` / `cancel_on_failure` / `finish_mode` / `name` **保持 v4 的名字和形状不变**
   ——它们是运行时的载荷，改名字只会制造风险。v5 只换掉「结构」那部分。
5. **不做**：用户自定义节点类型定义语言（UE 的 `UK2Node` 子类那种）这一阶段不做，
   只把 `type` 从「封闭枚举」放宽成「注册表查得到即可」，为它留位置。

## 文件形状

v5 **不做多余嵌套**：`nodes` / `edges` 就在顶层，与 v4 同位。这样迁移是逐字段的，不是整体搬箱子。

```json
{
  "schema_version": 5,
  "id": "activity_loop",
  "version": "5.0.0",
  "description": "活动副本循环：…",
  "resolution": [1920, 1080],
  "root": "root",
  "inputs": { "…": { "type": "integer", "default": 760 } },
  "variables": { "…": { "type": "boolean", "default": true } },
  "nodes": [
    {
      "id": "wait_round_state",
      "type": "task",
      "name": "识别当前页面状态",
      "at": { "x": 0, "y": 624 },
      "locked": false,
      "action": "vision.detect_state",
      "params": { "states": [ "…" ], "allow_ocr": false },
      "decorators": [ { "type": "retry", "attempts": 180, "delay_seconds": 0.5 } ]
    }
  ],
  "edges": [
    {
      "from": { "node": "root", "pin": "then.0" },
      "to": { "node": "repeat_rounds", "pin": "in" }
    }
  ]
}
```

> **数据边**（`{"ref": "nodes.x.output.y"}`）已经在表里了：节点输出 → 参数/引脚引用是
> `out` / `out.<字段路径>` 出发的边，编译时落回参数里的绑定。仍然留在参数里的只有
> **指向 `inputs.` / `variables.` 的引用**——它们没有节点作为端点，要折成边得先把
> 变量卡变成图里的节点（P4 剩下的那半）。
>
> 注释框（`comments`）与节点组（`groups`）字段留给 P3；现在节点组仍在 `_nodeGroups` 里。

### 节点

相对 v4 只多了三个字段、少了一个：

| v4 | v5 | 说明 |
| --- | --- | --- |
| `_layout[id] = {x, y}` | `at: {x, y}` | 坐标进节点本体（UE 的 `NodePosX/NodePosY`）。缺省时编辑器兜底排列，不再写孤儿坐标 |
| `_layoutLocks: [id]` | `locked: true` | 锁进节点本体 |
| `children: [id]` + `ports: ["true"]` | 出边（见下） | 连接从「子节点数组」变成「边」 |
| 其余字段 | 原样 | `action` / `params` / `expression` / `fields` / `cases` / `runs` / … 一律不改名 |

可选字段：`size: {w, h}`（用户手动拉过卡片尺寸时才写；不写 = 由内容算）、
`comment: "…"`（节点自身备注，纯编辑期）。

### 边与引脚

一条边 = 两个引脚端点。**引脚 id 由类型定义派生，文档只存边**——这与 UE 一致
（UE 也只序列化 pin 的 `DefaultValue` 与 `LinkedTo`，不把引脚本身存进文件）。

引脚命名（全项目共用这一套，卡片绘制、命中、校验、编译都读它）：

| 引脚 | 出现位置 | 含义 | 本阶段 |
| --- | --- | --- | --- |
| `in` | 有执行流的节点（`root` 除外） | 执行流入口（卡片顶边的箭头） | ✅ 用于边 |
| `then.<下标>` | 多子节点（root / sequence / selector / parallel / branch / repeat_until / simple_parallel） | 第 n 条执行流出口，**下标即顺序**（`then` 等价于 `then.0`） | ✅ 用于边 |
| `true` / `false` | `condition` | 两个分支口 | ✅ 用于边 |
| `case.<下标>` / `default` | `switch` | 分支口（下标对应节点 `cases` 数组的顺序） | ✅ 用于边 |
| `out` / `out.<字段路径>` | 产出输出的节点（task / bool_judge / break）与变量节点 | 数据出口（引用文本 `nodes.<id>.output…` / `inputs.<键>…`） | ✅ 用于边 |
| 参数名 / `left` / `right` / `condition` / `scope` 的 `expression` / `ref` / `conditions.<i>` / `decorators.<i>.<字段>` / `runs.<i>.inputs.<名>` | 参数行与特殊输入口 | 数据输入 | ✅ 用于边 |
| `inputs.<名>` / `variables.<名>` | **变量节点**（`type: "variable"`） | 变量数据源 | ✅ 用于边（见下） |

### 变量节点

编辑器里的变量卡就是图里的**变量节点**：它是个纯数据源，没有执行引脚，输出引脚 `out` /
`out.<嵌套字段路径>` 喂给参数或装饰器。

```json
{ "id": "var__inputs__模板", "type": "variable", "scope": "inputs", "name": "模板",
  "at": { "x": -184, "y": 1784 } }
```
```json
{ "from": { "node": "var__inputs__模板", "pin": "out" }, "to": { "node": "wait_settlement", "pin": "template" } }
```

- id 由 `(作用域, 键)` 推导（`var__<scope>__<name>`），不是卡片 id：v4 的引用里只有
  `variables.x`，卡片 id 过一趟编译就没了，从引用推导才能让「编译 → 反编译」与反复刷新稳定。
  同名重复卡片会并成一个变量节点（一个变量就是图里的一个实体，与 UE 一致）。
- 没有卡片的引用（手工写的 `{"ref": "inputs.运行轮数"}`）在迁移时补出一个变量节点，
  位置留给编辑器放（`at` 可缺）。
- 变量节点**不进运行时文档**：编译时它们被丢掉，出边落成目标引脚上的引用。
- 变量卡与变量连线因此**不再以 `_variableCards` / `_variableLinks` 落盘**；画布内部仍用这两张
  旁表（`toCanvasDocument` / `toGraphDocument` 在边界上换算）。`_inputParams`（输入提升元数据）
  与 `_nodeGroups`（节点组）与连线无关，仍在旁表里，等 P3 处理。

边的形状刻意保持最小：

```json
{ "from": { "node": "a", "pin": "then.0" }, "to": { "node": "b", "pin": "in" } }
```

- **不存 `kind`**：来源引脚是不是执行口，由 `then.*` / `true` / `false` / `case.*` /
  `default` 这套命名判定；线画成粗浅色还是金色虚线，由引用前缀
  （`nodes.` / `variables.` / `inputs.`）派生。能推出来的东西不写进文档，就不会出现
  「字段和实际画出来的线不一致」。
- **不存引脚值**：字面量仍写在 `params` 里（`"timeout_seconds": 15`），边只表达
  「有人连过来」。断开之后参数回退到哪个默认值，仍由编辑器决定——与今天一致。
- 可选 `waypoints: [{x, y}]`：手工折线的中间点（UE 的 Knot 用同一种表达，不单列节点类型）。

### 注释与节点组

- `comments`：UE 的 Comment 框，纯编辑期，编译器整体丢弃。
- `groups`：把现有 `_nodeGroups` 搬进文档的正式字段（名字不变）。组仍然是**投影 + 接口**语义
  （进组内视图时隐藏组外节点），`pins` / `pinPolicy` 的含义不变——组不是新概念，只是换了位置。
- 暂时保留 `_variableCards` / `_variableLinks` / `_inputParams` 三个下划线键：它们描述的是
  「变量卡这张卡片」和「变量接口提升」，属于编辑器状态，等边模型稳定后再折叠进 `edges`
  （变量卡 → 变量引脚是数据边的另一头）。这一阶段**不动它们**，避免一次改太多东西。

## 自定义节点类型（`x-…`）

「可扩展节点类型」按 UE 的做法落地：**类型有定义，实例只存差异**。定义写在文档顶层的
`nodeTypes` 里（可选）：

```json
{
  "nodeTypes": {
    "x-tap_settlement": {
      "base": "task",
      "action": "input.tap_match",
      "params": { "verify_gone": true, "verify_timeout_seconds": 10 },
      "title": "点掉结算页"
    }
  },
  "nodes": [
    { "id": "tap_settle", "type": "x-tap_settlement", "params": { "verify_timeout_seconds": 3 } }
  ]
}
```

三条规矩（两端同一套，报错文案各自本地化）：

1. **必须有内置 `base`**。这一轮扩展的是「一个可复用的预设节点」，不是新的执行语义——
   要新语义得先有运行时支持；硬塞一个编译器认不出的类型只会在运行期炸。
   类型名必须以 `x-` 开头（保留命名空间，避免拼错的内置类型被当成自定义类型悄悄通过）。
2. **节点载荷赢过预设**：`params` 逐层深合并（上面例子里节点把超时从 10 改成 3，
   同时继承了 `verify_gone`），其余字段节点写了就用节点的；`title` 只在节点没写 `name` 时生效。
3. **定义不许碰结构**：`children` / `ports` / `default_child` / `at` / `locked` 写进定义直接报错。
   结构由节点自身与边决定，藏进预设就是「看不见的连线」。

编译时自定义类型被解析成基类（引脚、边、载荷搬运都按基类走），所以：

- 运行时文档里没有 `x-…`、也没有 `nodeTypes`；
- 画布内部按基类工作（它认识 `task` / `condition` / …），但节点上记着 `_nodeType`，
  写回图文档时还原成 `x-…`——**打开、编辑、保存都不会把自定义类型降级成基类**。

**编辑器里怎么用**（P5 的入口）：

- **收成自定义类型**：右键一个已配置好的节点 →「收成自定义类型」。类型名从节点名派生
  （没有名字就用动作名、再退化到 id），加 `x-` 前缀、撞名自动加序号。
  定义里**只预设字面量**：带 `{"ref": …}` 的参数 / 表达式不进预设——否则所有实例都会指向
  同一个来源节点，那是看不见的耦合。节点自己的载荷一个字段都不动，只打上 `_nodeType` 标记。
- **按类型新建**：画布空白处右键，菜单底部会列出文档里所有自定义类型
  （`＋ 自定义类型（N）` → `＋ <标题>（x-… · 基类）`）；建出来的节点按基类工作、铺上预设、
  标题取定义的 `title`，但**保留自己的类型名**（写回文件是 `x-…`）。
- 目前改类型名要直接编辑 `nodeTypes` 的键（还没有「重命名类型」的界面），删掉定义则引用它的
  节点会变成「未声明的节点类型」报错——这是刻意的，宁可报错也不要静默降级成基类。

**没做的部分**（说清楚以免误解）：不能定义自己的引脚集合与编译行为（那需要节点类级别的
运行时扩展，UE 那边是 `UK2Node` 子类）。当前能力边界是「内置节点 + 预设载荷 + 显示名」。

### 节点组

编辑器里的节点组搬到了文档顶层的 `groups`（不再是旁表 `_nodeGroups`）。组是**编辑期概念**：
运行时不认识它，编译时整体丢弃；但既然写进了文档，就要自洽——成员与端点必须存在、端点必须
落在组内、id 不能重复（编译期与编辑器诊断都会报）。

```json
{ "id": "node_group_1", "name": "收尾", "nodeIds": ["a", "b"],
  "pins": [{ "nodeId": "b", "param": "value" }], "pinPolicy": "explicit-v1",
  "at": { "x": 996, "y": 1040 }, "interfaceAt": { "x": 830, "y": 0 }, "variablesAt": { "x": -448, "y": 376 } }
```

组卡、组接口卡（`__node_group_interface__:<id>`）与组变量卡（`__node_group_variables__:<id>`）
都不是节点，位置分别落在 `at` / `interfaceAt` / `variablesAt`；缺省时编辑器按成员包围盒推导。
画布内部仍然用 `_nodeGroups` + `_layout` 记它们，靠边界换算。

### 注释框

UE 的 Comment：圈住一片区域并写一句话，纯编辑期标注（编译时整体丢弃）。

```json
{ "id": "comment_1", "text": "结算页分支", "at": { "x": 1040, "y": 640 },
  "size": { "w": 420, "h": 260 }, "tint": "warning" }
```

`id` / `text` / `at` 必填，`size`（正整数 `w`/`h`，缺省 360×200）与 `tint`
（分类色名，落在卡片的 `--card-tint` 上）可选。文档里写了就要自洽：id 唯一、坐标是整数、
尺寸为正——编译期与编辑器诊断都会报（`graph-comment-*`）。

画布上它在**自己的图层**（`.comments`，挂在 `.graph-world` 最前面，画在连线与卡片之下），
按内容签名整层重建，不参与卡片/连线那套增量补丁；拖拽复用 pointer 模块的生命周期
（autoPan、快照、撤销），所以「拖动 / 改尺寸 / 删 / 就地改文字」与其他卡片行为一致。

### 手工折线（Knot）

边上可以带手工折点，连线按 `起点 → 折点… → 终点` 串成多段（每段保持竖直切线）：

```json
{ "from": { "node": "wait_round_state", "pin": "out.match" },
  "to": { "node": "tap_challenge", "pin": "match" },
  "waypoints": [ { "x": 100, "y": 80 }, { "x": 120, "y": 180 } ] }
```

- 没有折点的边**不写** `waypoints`，画出来的路径与加这个字段之前逐字相同。
- 画布的边是从 `children` 现推出来的、没有对象可以挂折点，所以编辑期把它寄存在
  `_edgeWaypoints` 旁表里（键就是边自身的身份：from/to 的节点与引脚），写回时再挂回边。
  `then` 会规范成 `then.0`，别名写法不会丢折点。
- 画布上：连线右键「添加折点」（落在点击处）、折点可拖（只重画那一条线）、
  折点右键删除、连线右键「清除全部折点」。折点坐标贴 8 像素网格。
- 数据边（节点输出引用、变量连线）的折点**照样保存在文件里**，但目前只有执行边在画布上
  支持手工走线；边界只搬运、不解释。

## 编译：图文档 → Behavior Tree v4

`compile_graph(raw) -> dict`（纯函数，无 I/O，`workflows/graph_compile.py`），输入是 `.owf`
解析出来的图文档（`schema_version: 6`），输出一份 v4 原始 dict，交给现有 `validate_workflow`。规则：

1. **执行结构**：执行边必须构成一棵以 `root` 为根的树——除 `root` 外每个执行节点恰好一条
   执行入边，同一个出口引脚不能接两条，无环。按引脚下标排序生成 `children`；
   `condition` 由 `true` / `false` 两条边生成 `children` + **对齐的 `ports`**；
   `switch` 由 `case.<下标>` / `default` 重建 `cases[].child` / `default_child` / `children`
   （每个 case 都必须接上，否则编译期报错——v4 的 switch 不允许空分支）。
2. **载荷与数据边**：`params` / `expression` / `cases[].value` / `runs` / `decorators` /
   `wait_for` / `cancel_on_failure` / `finish_mode` / `fields` / `ref` / `max_iterations` /
   `conditions` 直接抄进 v4 节点；数据边落成目标引脚上的 `{"ref": "nodes.<源>.output…"}`。
   **认不出引脚位置的引用原样留在参数里**（例如 `cases[].value` 里的引用），所以格式换代
   不会吞掉任何一条既有连线。摘引用时**数组元素留洞（`null`）而不是删除**：删掉会让
   后面的元素前移，同一段里的另一个引用就会挪位，回填时把相邻的字面量盖掉。
3. **丢弃编辑器字段**：`at` / `size` / `locked` / `comment` / `waypoints`，以及所有
   下划线前缀的编辑器键。运行时不认识、也不该认识它们。
4. **拒编译比错编译好**：未知节点、引脚不存在、口位用错、一父多子、成环、数据边
   （本阶段还不支持）都在编译期报错，并把错误定位到**图上的节点与引脚**，
   而不是 v4 的数组下标——这是编辑器能把错误标在卡片上的前提。

反方向 `decompile_workflow(raw_v4) -> raw_graph` 服务于两处：迁移脚本把 v4 JSON 升成图文档
再写 `.owf`，以及 MCP 模板工厂把运行时的 v4 文档转成图文档写盘（`dsl/convert.py` 的
`emit_runtime_document`）。它把 `children` / `ports` / `cases[].child` / `default_child`
变成边，`_layout` / `_layoutLocks` 搬进节点，其余（含 `_variableCards` / `_nodeGroups`
等编辑器状态）照抄。

## 校验分层

| 层 | 在哪 | 查什么 |
| --- | --- | --- |
| 结构 | `src/oooonmyoji/workflows/graph_schema.py` | 图文档的 JSON Schema（`.owf` 解析出来的形状，`schema_version: 6`）：字段类型、必有字段（含节点上不再允许 `children` / `ports` / `default_child`） |
| 图语义 | `src/oooonmyoji/workflows/graph_compile.py`、`desktop/src/shared/workflow/graph-document.ts` | 引脚存在性、口位是否用对、一父多子、同一口接两条、成环、switch 空分支、变量节点的作用域/键与「不接受输入」、未声明的自定义类型 |
| 执行语义 | `validator.py`（不动） | 装饰器、绑定类型、Action 参数、作用域、可达性 |
| 编辑期 | `desktop/src/shared/workflow/validate.ts` | 图文档先报图结构问题，再转成编辑形态交给同一份 v4 校验（issue 的 `nodes[i]` 下标与原文件一一对应） |

Python 与桌面端各自实现一份，用同一份 **`tests/fixtures/graph-rules/cases.json`** 做跨语言契约：
同一份图文档输入，两边必须转出同样的 `children` / `ports` / `cases` / `default_child`，
图结构错误的定位也必须一致（Python 报错文案 ↔ 编辑器诊断 code）。两端各有 13 项样例用例。

## 桌面端怎么读它（画布内部仍用编辑形态）

画布内部**没有**改成「边是唯一真相」：它继续用编辑形态工作（`children` / `ports` /
`cases[].child` / `_layout` / `_layoutLocks`）。理由是那套代码被 94 个测试与全部
渲染/命中/连线/节点组逻辑覆盖，为格式换代整体重写属于「一次改太多东西」。

于是转换只发生在**两个边界**：

- 读入：`parseDocument`（`.owf` → 图文档，`desktop/src/shared/workflow/graph-dsl.ts`）之后
  由 `toCanvasDocument` 把 `at` → `_layout`、`edges` → `children`/`ports`/`cases`。
- 落盘：`canvas/state/document-text.ts` 的 `documentText(state)` 是**唯一序列化出口**，
  直接 `emitRuntimeDocument(state.raw)` 写 `.owf`；磁盘格式只有这一种，所以画布里区分
  「树/图」的 `documentFormat` 状态字段已经删除（`serializeWorkflow` 也删了）。

配套的三处修复（都是「图文档没有 `children`」暴露出来的）：

- `parseWorkflow` 自己会先转换形态——主进程的引用建议、引用图与画布都从它取
  `children`，不转就会把「谁排在我前面」全算成空。
- `runtimeService` 的实例并行识别改走共享的 `instanceParallelRuns`（原先自己翻
  `root.children[0]`，图文档下会认不出 `instance_parallel`，运行标签与实例列表会错）。
- 校验与 `parseWorkflow` 都接受图文档（现在 `schema_version: 6`），画布徽标里的
  `nodes[i]` 下标与原文件一致（编译保序）。

## 迁移与兼容

- `WorkflowLoader.load` 现在只读 `.owf`：`parse_document` 得到图文档（`schema_version: 6`）后先按
  图 schema 校验、再编译成 v4 走现有校验。v4 与 v5 的 `.json` **都不再加载**，
  `discover()` 也只遍历 `*.owf`。
- 迁移脚本 `scripts/migrate_workflows_to_owf.py`（默认只预览，`--apply` 才写盘并删旧 `.json`，
  `--keep-json` 保留旧文件）：接收 v4（含全部下划线编辑器键）或 v5 的 JSON → `.owf` 文本 →
  再解析编译回 v4，与原文的运行时文档**逐字段**比对，**不一致就不写盘**——
  迁移必须是语义零变化。仓库里的两份工作流已用它迁移（643 行 JSON → **190 行** `.owf`、
  1197 行 JSON → **327 行** `.owf`，旧 `.json` 已删除）。
- 配置与 CLI 按工作流 id 或路径反查：`config/loader.py` 的 `_workflow_path` 会把非 `.owf`
  后缀替换成 `.owf`，所以旧习惯写的 `活动副本.json` 仍能解析到 `活动副本.owf`，
  但文件本身必须真的叫 `.owf`（推荐一律写 `.owf` 或工作流 ID）。
- 桌面端**已接线 `.owf` 读写**：读入走 `parseDocument`（8 处旁路 `JSON.parse` 全部收敛），
  落盘唯一出口是 `canvas/state/document-text.ts` 的 `emitRuntimeDocument`，新建工作流由
  `projectService` 写成 `.owf` 文本；`serializeWorkflow` 与区分「树/图」的 `state.documentFormat`
  都已删除。移动/重命名的引用改写改成了「解析 → 改对象 → 重新序列化」的结构级改写。
- 桌面端 `document-health.ts` 的 `WORKFLOW_SCHEMA_VERSION` 保持 4：它处理的是**内存里的
  编辑形态**，而编辑形态永远是 v4 字段；图文档的接受与转换在上面的两个边界做完了。

## 分阶段

1. **P1 Python（已完成）**：`graph_schema.py` 结构 schema、`graph_compile.py` 编译/反编译、
   loader 分派、迁移脚本、单测。运行时零改动——`validator.py` / `engine.py` / `supervisor.py`
   一行没动。
2. **P2 桌面端读写（已完成）**：`graph-document.ts` 双向转换与图结构诊断、
   `parseWorkflow` 认图、校验器接受图文档、`instanceParallelRuns` 修实例并行识别、
   跨语言契约 fixture、两份工作流迁移。画布渲染/命中/连线/节点组**未改动**，靠边界转换继续工作。
   —— 这一阶段当初读写的是 v5 JSON 落盘，该落盘已随 v6 文本（`.owf`）退役；
   桌面端改读写 `.owf` 已完成，见 [工作流文本格式 v6](./workflow-dsl-v6.md) 的分阶段 P3。
3. **P3 图编辑体验（进行中）**：**节点组已搬进 `groups`、注释框与手工折线已可用**；
   剩下值卡片自由摆放、多执行出口的顺序拖拽，以及「把选中节点收成一个自定义类型」的编辑器入口。
4. **P4 连线收敛（已完成，落盘换代同时完成）**：节点输出引用与**变量/输入绑定**都折进 `edges`
   （引脚 ⇄ 载荷路径的换算在 `workflows/graph_pins.py` 与 `shared/workflow/graph-document.ts`，
   两端同一套规则）；变量卡变成图里的**变量节点**，`_variableCards` / `_variableLinks`
   从文档里退场（画布内部仍用旁表，靠边界换算）。
   同期的落盘换代：Python 加载链路只读 `.owf`（loader / 子工作流 inputs 校验 / 配置按 id
   反查 / `discover()` 只遍历 `*.owf`），图文档版本从 5 提到 **6**，两份工作流迁成
   190 行与 327 行文本、旧 `.json` 删除，MCP 模板工厂写 `workflows/generated/<name>.owf`，
   迁移脚本收敛成一个 `scripts/migrate_workflows_to_owf.py`。
   **未做**：画布内部也改成「边是唯一真相」（现在仍是编辑形态 + 边界转换）。
5. **P5 可扩展节点类型（宏级别已完成，含编辑器入口）**：`nodeTypes` 定义表、`x-` 命名空间、
   基类解析与载荷深合并、两端一致的报错、画布读写不降级；画布可「收成自定义类型」并按类型新建。
   **未做**：自定义引脚与自定义编译行为（需要节点类级别的运行时扩展）、类型的重命名界面。

## 已明确的取舍

- **一份文档，不是两份**：不采用「v4 树 + `_graph` 旁表」的双写方案。两套真相迟早漂移，
  而这份文档的全部价值就在于「图是唯一真相」。
- **就地保存图文档，不落盘编译产物**：`children` 是编译结果，不进文件（磁盘上是 `.owf`
  文本，内容就是这张图）。代价是运行时多一次编译，
  收益是文件里不存在「结构」与「图」不一致的可能。
- **引脚派生、不存**：引脚集合由节点类型决定，文档只存边。想加自定义节点类型时，
  扩展的是类型定义，不是文件格式。
