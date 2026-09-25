# 工作流文本格式 v6（`.owf`）

状态：**P1、P2、P3 已完成并验证**；磁盘上只剩 `.owf`，加载链路与桌面端读写都只认 `.owf`，
两份真实工作流已迁移且编译结果逐字一致，两端的 parse/emit 与报错口径逐字对齐。

本文是该格式的**权威契约**。v5 的图语义（节点、引脚、边、编译规则）一字不改，
换掉的只有「文档怎么写成文本」——`docs/graph-document-v5.md` 仍然是图语义的权威说明。
落盘文本的 `schema_version` 固定为 **6**（文本里不写这个字段，`.owf` 后缀就是格式标记）。

## 为什么要换

换之前先摆实证（两份真实工作流：18 节点/20 边、40 节点/44 边）：

1. **重复的结构没有名字可用**。状态四元组 `{name, roi, template, threshold}` 在两份文件里
   逐字重复 2–3 次（`challenge`/`settlement`/`target_lit`/`target_dim`），JSON 里没有宏、
   没有锚点、没有 include，只能复制。
2. **同一份信息被拆成两处，且允许不一致**。`wait_settlement` 的 `params` 只有
   `{"scale_search": false}`，却有 5 条边把 `template / present / timeout_seconds / roi / threshold`
   注入进参数；`tap_exit_after_battle` 被注入 `revalidate`，而这个键在它自己的 `params` 里
   根本不存在。「有哪些输入」要同时看 `params` 与 64 条边才能回答。
3. **表达式是「单键对象 + 位置寻址」**。`{"eq": [{"ref": "nodes.a.output.state"}, "challenge"]}`
   这种写法里，`[0]`/`[1]` 不是数据而是**接线位置**：`bool_1:left` 引脚就落在
   `expression.eq[0]` 上，文件里那个位置的 `null` 是「这里被一条连线占着」的占位符。
   读的人要自己在脑子里把 `eq[0]` 翻译成「左操作数」。
4. **键序无规范**。同一组 `params` 字段在两个节点里顺序相反（`tap_challenge` vs
   `tap_exit_from_settlement`），diff 里全是噪音；坐标坐标（`at`）与节点本体分离过一次，
   v5 已经收回来了，但参数载荷还是自由顺序。

顺带澄清一个**不是**痛点的事：这两份文件里换行符、反斜杠、嵌入引号各 0 处，
最长的单行 81 字符（一句 `description`）。所以 v6 不靠「少转义」取胜，
靠的是**重复可复用、接线与载荷同处、表达式可读**。

## 设计原则

1. **字段名不改**。文档与节点的字段名（`action`/`params`/`expression`/`cases`/`runs`/
   `decorators`/`nodeIds`/`pinPolicy`…）与运行时**逐字相同**。DSL 只换「怎么写」，
   不换「叫什么」——报错文案、编辑器、运行时引用同一套词。
2. **能推导的不写**。坐标与节点同处；变量节点的 id 由 `(scope, key)` 派生成
   `var__<scope>__<key>`（两份真实文件 8/8 满足，已实测）；`then`/`then.0`、`in` 这类
   默认引脚省略；空编辑器键（`_inputParams: {}`）照写但不制造噪音。
3. **连线是顶层边表**。一张 `edges:` 块按 `edges` 数组的顺序逐行转写
   （`源[:引脚] -> 目标[:引脚]`）：**边序与编译报错里的 `edges[i]` 下标一字不漂**，
   迁移是纯转写而不是重排；代价是文件读起来不像「图」，改线要去边表里找。
4. **表达式写中缀**。`nodes.a.output.state == "challenge"` 一行写完，
   不需要在脑子里做 `eq[0]` 的位置映射；落盘时按固定文法**规范化**回运行时的操作数对象
   （唯一真相仍是运行时那棵树，见「表达式」一节）。
5. **一种块语法**。`params` / `fields` / `inputs` / `variables` / `nodeTypes` / `limits` /
   `runs[].inputs` / `groups[].pins` 全用同一套「键 : 值 / 缩进子块 / `- ` 列表项」语法，
   解析器只有一套。
6. **完全弃用 JSON**。磁盘上只认 `.owf`；v4/v5 的 `.json` 由迁移脚本一次性转换，
   加载器不再读 JSON（也不再需要 `_layout` / `_variableCards` 那些「JSON 时代的旁表」兜底）。

## 词法与行规则

- **编码**：UTF-8，LF 或 CRLF，文件后缀 `.owf`。
- **注释**：`#` 到行尾（引号内与 `|` 文本块内不算）。
- **缩进**：每层 2 空格，禁止 Tab。子块必须比父行更深；深度跳级报错。
- **空行**：忽略。
- **键**：裸词（不含空白、`#`、`"`、`,:`、`[`、`]`、`{`、`}`），可含中文、`_`、`-`、`.`。
- **标量**：
  | 写法 | 含义 |
  | --- | --- |
  | `42` / `-7` | 整数（保持 int，不做归一化） |
  | `0.88` / `-0.5` / `1e-20` / `1.5e3` | 浮点（`5` 与 `5.0` 是**不同**的值，`0.5` 不写 `.5`；支持科学计数法——`repr(float)` 对极小/极大值就写这种形式，不支持等于静默丢数据） |
  | `true` / `false` / `null` | 布尔与空 |
  | `challenge` / `assets/templates/a.png` / `x-是否在结算页` | 字符串（裸词） |
  | `"循环执行次数。"` | 字符串（含空格、`#`、`:`、逗号等必须加引号） |
  | `nodes.a.output.state` / `inputs.运行轮数` / `variables.v_3a3d…` | **引用** `{"ref": …}`（`nodes.` / `inputs.` / `variables.` 开头的裸词自动成为引用；要当普通字符串就加引号） |
- **转义**：引号内支持 `\n` `\t` `\"` `\\`；其余 `\x` 报错。
- **长文本块**：值写 `|` 时，取紧随其后的更深缩进行作为原文（按公共缩进 dedent，行尾换行去掉）：
  ```owf
  description: |
    第一行
    第二行
  ```
- **列表**：行内 `[a, b, c]`（逗号可省，尾逗号容忍），或块形式 `- 值`；元素可以是块（`- key: value` + 更深子块）。
- **空块**：`key:` 后面没有更深子块 = 空对象 `{}`；`key: []` = 空数组。
- **位置与尺寸字段**（`at` / `size` / `interfaceAt` / `variablesAt`、连线的 `waypoints`）：
  只有**正好是 `[x, y]`（两个数）**才折叠成 `{"x": …, "y": …}`；写成别的形状就原样存进文档，
  由 schema 去报「坐标必须是整数」这类类型错——**语法层不替类型层做判断**，
  这样编辑器内存里的任何文档都写得出去、读得回来。

## 文档结构

```owf
workflow activity_loop                 # 必需，第一行，给出 id
  version: 4.4.0                       # 必需
  description: "活动副本循环：按页面状态处理挑战页和结算页…"
  resolution: [1920, 1080]             # 必需，[宽, 高]
  root: root                           # 必需，根节点 id

  retry_safe: true                     # 可选
  limits:                              # 可选（通用块）
    timeout_seconds: 600
    max_steps: 5000

  inputs:                              # 通用块：键 = 输入键（可以是 uuid，也可以是中文）
    v_3a3d58354dbf4aeb8a85bf05bc703c2c:
      type: integer
      default: 760
      min: 1
      description: "循环执行次数。"
      display_name: 运行轮数
      _autoPublished: true

  variables:                           # 通用块，形状同 inputs
    v_10a5b9e6f0724cae9fddae2b177a86af:
      type: integer
      display_name: 运行轮数
      initial_from: v_3a3d58354dbf4aeb8a85bf05bc703c2c

  nodeTypes:                           # 通用块：自定义节点类型定义（x-…）
    x-是否在结算页:
      base: bool_judge
      title: 是否在结算页

  _inputParams:                        # 下划线编辑器旁表照写（缺省时写空对象）

  node root root 活动副本循环入口      # 结构关键字：node <id> <type> ["显示名"]
    at: [498, 0]

  node start_round_cond condition "处理挑战页 · 判断"
    at: [664, 936]
    expression: nodes.wait_round_state.output.state == challenge

  var variables.v_10a5b9e6f0724cae9fddae2b177a86af
    at: [-448, 376]

  edges:                               # 顶层边表：按 edges 数组顺序逐行转写
    root -> repeat_rounds
    round_state_selector:then.0 -> start_round_cond
    start_round_cond:true -> start_round
    start_round_cond:false -> stop_round
    var__variables__v_10a5b9e6f0724cae9fddae2b177a86af:out -> repeat_rounds:decorators.0.count

  group node_group_1 "节点组 1"
    nodeIds: [continue_round, tap_exit_from_settlement]
    pinPolicy: explicit-v1
    at: [1328, 1160]
    pins:
      - nodeId: tap_exit_from_settlement
        param: match

  comment comment_1 "结算页分支"
    at: [1040, 640]
    size: [420, 260]
    tint: warning
```

顶层关键字：`workflow`（头行）、`version`、`description`、`resolution`、`root`、
`retry_safe`、`limits`、`inputs`、`variables`、`nodeTypes`、`node`、`var`、`edges`、
`group`、`comment`、下划线前缀键（`_inputParams` 等，通用块）。
`node` / `var` / `group` / `comment` 可重复且**保持出现顺序**（就是 `nodes` / `groups` /
`comments` 的数组顺序）。

## 节点块

```
node <id> <type> ["显示名"]      # 显示名即运行时字段 name；可省
  at: [x, y]                     # 可省（编辑器兜底排列）
  size: [w, h]                   # 可省
  locked: true                   # 可省
  comment: "…"                   # 节点自身备注，可省
  action: vision.detect_state    # task 必需
  params:                        # 通用块
    states:
      - name: challenge
        roi: [1621, 791, 299, 289]
        template: assets/templates/souls/souls-challenge.png
        threshold: 0.88
  expression: …                  # condition / bool_judge / switch（表达式）
  condition: …                   # repeat_until（表达式）
  conditions:                    # branch（表达式列表）
    - nodes.a.output.x > 1
    - exists nodes.b.output.y
  cases:                         # switch 的分支取值（字面量，不是表达式）
    - value: challenge
    - value: settlement
  decorator retry                # 可重复；decorators 数组按出现顺序
    attempts: 180
    delay_seconds: 0.5
  runs:                          # instance_parallel
    - instance: mumu-0
      workflow: activity_loop
      inputs:
        rounds: 3
  wait_for: all
  cancel_on_failure: true
  finish_mode: abort_background
  max_iterations: 100
  ref: nodes.classify.output      # break
  fields:                        # 通用块（拆分卡片的字段名）
    state: 状态
```

节点块里 **`id` / `type` / 显示名是位置参数**，其余都是上表的关键字；
出现表外的键按通用块解析（照抄进节点，未知字段最终由 schema 报错，而不是被静默吞掉）。
节点块里**不写连线**：看见 `->` 会明确报「连线要写到顶层 edges 块」（字面量里真要写 `->` 就加引号）。

### 连线表

```owf
edges:
  <源节点>[:<源引脚>] -> <目标节点>[:<目标引脚>]
```

- 源引脚省略 = `then.0`；目标引脚省略 = `in`。
- 因此 `root -> repeat_rounds` ≡
  `{"from": {"node": "root", "pin": "then.0"}, "to": {"node": "repeat_rounds", "pin": "in"}}`。
- 多子节点顺序由 `then.<下标>` 决定（与数组顺序无关，编译器按下标排序）；
  要改顺序就改下标：`rounds:then.2 -> judge`。
- 判断口：`judge:true -> x` / `judge:false -> x`；`switch`：`pick:case.0 -> x` / `pick:default -> x`。
- 数据口：`wait_round_state:out.match -> tap_challenge:match`、
  `var__inputs__模板:out -> wait_settlement:template`、
  `bool_1:out.value -> condition_1:condition`、`break_1:out.state -> bool_1:left`。
- 目标引脚就是**参数名或特殊口**（`template` / `roi` / `revalidate` / `ref` /
  `conditions.0` / `decorators.0.count` / `runs.0.inputs.名称`）。
- 手工折点写在连线下面：
  ```owf
  judge:out.value -> branch_1:conditions.0
    waypoints: [[100, 80], [120, 180]]
  ```

**边表顺序 = `edges` 数组顺序**（不排序、不按节点分组）：迁移是纯转写，
编译报错里的 `edges[i]` 下标、以及编辑器里边的先后都不会因为换格式而漂。

「参数只由连线提供」是**正常状态**：`wait_settlement` 的 `params` 里可以没有 `template`，
只要有一条 `var__inputs__模板:out -> wait_settlement:template`。v6 不为它补默认值——
与 v5 一致，谁接了线谁提供值。

### 变量节点

编辑器里的变量卡就是变量节点，用 `var` 关键字写，**id 不写**（由作用域与键派生）：

```owf
var inputs.模板                     # → {"id": "var__inputs__模板", "type": "variable", "scope": "inputs", "name": "模板"}
  at: [0, 1784]
```

`var <scope>.<key>` 里 `<scope>` 只能是 `inputs` / `variables`，`<key>` 按**第一个点**切开，
所以键里带点（`inputs.超时_秒.v2`）会得到 `超时_秒.v2`——与 `var__<scope>__<key>` 派生一致。
id 派生的不变量由 `var` 关键字保证，手写一个不合派生的 id 是写不出来的（这是有意的）。

## 表达式

表达式出现在 `expression:` / `condition:` / `conditions:` 的项上。值写在同一行就是**中缀**，
写子块则是**操作数对象**（逃生舱，见下）。

| 中缀 | 运行时 | 说明 |
| --- | --- | --- |
| `a == b` | `{"eq": [a, b]}` | 比较，**恰好两个操作数** |
| `a != b` | `{"ne": [a, b]}` | |
| `a > b` / `a >= b` / `a < b` / `a <= b` | `{"gt"/"gte"/"lt"/"lte": [a, b]}` | |
| `a contains b` | `{"contains": [a, b]}` | 左是容器，右是元素 |
| `a and b and c` | `{"and": [a, b, c]}` | 扁平化（任意个） |
| `a or b` | `{"or": [a, b]}` | 扁平化 |
| `not a` | `{"not": a}` | |
| `exists nodes.x.output.y` | `{"exists": {"ref": "nodes.x.output.y"}}` | 操作数必须是引用 |

- 优先级：`or` < `and` < `not` / `exists` < 比较；`and` / `or` 左结合，落盘扁平化；
  比较**不允许链式**（`a < b < c` 报错——运行时只有两个操作数）。
- 括号按需要写（`not (a and b)`）；落盘时只在语义需要处加括号（规范形式唯一）。
- 操作数可以是字面量、引用、`null` 占位、括号表达式。
  **`null` 是真实占位**：`expression: null == "settlement"` 表示左操作数空着，
  等一条 `out.state -> bool_1:left` 把它填上——`bool_1:left` 引脚的载荷路径正是
  `expression.eq[0]`，与 v5 逐字一致。
- **逃生舱**：值写子块时按通用块解析成操作数对象，用于中缀表达不了的形状
  （未知运算符、将来扩展的算子）。读进来是同一种真相，落盘优先用中缀：
  ```owf
  expression:
    eq:
      - null
      - settlement
  ```
- **条件列表**：`conditions:` 的行内写法**只按逗号切分**（表达式里的空格是语义的一部分）：
  ```owf
  conditions: [nodes.a.output.x == 1, exists nodes.b.output.y]
  ```
  每一项也可以写成块（`- eq:` + 更深缩进的操作数），走逃生舱那套。

## 规范形式（序列化规则）

`emit(document)` 是**唯一**落盘出口，输出必须满足：

1. 结构与字段顺序固定：文档头 → `retry_safe` / `limits` → `inputs` / `variables` /
   `nodeTypes` / 下划线键 → `node`（文档顺序）→ `group` → `comment`。
2. 节点内顺序固定：头行 → `at` / `size` / `locked` / `comment` → `action` → `params` →
   `expression` / `condition` / `conditions` / `cases` → `decorator` → `runs` / `wait_for` /
   `cancel_on_failure` / `finish_mode` / `max_iterations` → `ref` / `fields`
   （节点块里**没有**连线，连线一律在顶层 `edges:` 块）。
3. 通用块内的键**保持原顺序**（不排序：输入/变量表是给人看的，排序会把相关字段打散）。
4. 值内联还是换块：标量与「全是标量且整行 ≤ 96 字符」的列表内联，其余换块。
5. 引号只在必要时加（会与数字/布尔/`null`/引用/裸词规则冲突，或含空白与分隔符）。
6. 字符串含换行时用 `|` 文本块。
7. 连线：顶层 `edges:` 块，**按 `edges` 数组顺序**逐行转写
   （`源[:引脚] -> 目标[:引脚]`，源引脚 `then.0` 与目标引脚 `in` 省略），折点缩进挂在它下面。
8. 结尾一个换行，**LF**（Windows 上写文件要显式指定 `newline="\n"`，否则 Python 的文本模式会把
   `\n` 翻译成 `\r\n`，编辑器每次保存都会重写整个文件——`scripts/normalize_workflow_newlines.py`
   就是用来把早期写出的 CRLF 转回 LF 的）。

**哪些文档写不出来**（`emit` 明确拒绝，而不是写出一份读不回来的文本）：

- 缺必需头字段（`id` / `version` / `resolution` / `root` / `nodes`）；
- 还带着编辑形态字段（`children` / `ports` / `default_child`）；
- 变量节点的 id 与 `var__<scope>__<key>` 派生不一致；
- 连线的源节点不存在或指向不存在的节点。

往返保证（都有测试）：

- `parse(emit(doc)) == normalize_document(doc)`：规范化只做三件语义无损的事——
  `then` 别名收敛成 `then.0`、`and` / `or` 扁平化、空的 `edges` / `groups` / `comments`
  与空 `waypoints` 删掉。**边的顺序不动**。
- `emit(parse(text)) == text`：**emit 产出的文本**是不动点（手写文本先经一次规范化）。
- `compile_graph(doc) == compile_graph(parse(emit(doc)))`：运行时文档逐字相同；
  非法文档的编译报错文案（含 `edges[i]` 下标）也逐字相同。

## 已验证（实测）

| 样本 | 结果 |
| --- | --- |
| `workflows/活动副本.owf`（643 行 JSON → **190 行**文本） | 往返一致、文本不动点、编译结果一致 |
| `workflows/结界突破_寮突.owf`（1197 行 JSON → **327 行**文本） | 往返一致、文本不动点、编译结果一致 |
| `tests/fixtures/graph-rules/cases.json` 40 个契约用例 | 37 个可写盘且全部通过（非法文档的编译报错文案含下标逐字一致）；3 个是**故意非法**的文档（缺 `scope`/`name` 的变量节点 ×2、悬空边），文本形式给不出自洽写法，写盘期明确拒绝 |
| `scripts/migrate_workflows_to_owf.py --apply` | 迁移前后**运行时文档逐字段一致**才写盘；两份工作流由此落盘 |
| `python -m src.oooonmyoji.cli --config config/config.json validate` | `valid: true`，`workflows: [activity_loop, realm_raid_loop]`（从 `.owf` 解析并编译） |
| Python 全量测试 | `446 passed / 2 skipped`，ruff 干净 |

用例在 `tests/test_workflow_dsl.py`（101 项），夹具 `tests/fixtures/dsl/kitchen.owf`
覆盖 switch / branch / instance_parallel / 注释框 / 手工折线 / 多行文本 / 中缀优先级。

## 加载链路（P2 落地后的实际行为）

- **只能读 `.owf`**：`WorkflowLoader.discover()` 遍历 `*{WORKFLOW_SUFFIX}`（`.owf`），
  `load()` 用 `parse_document` 解析文本 → 结构 schema 校验 → `compile_graph` → 现有运行时校验。
  `.json` 工作流文件**不再被识别**（v4 与 v5 都不认）。
- **后缀替换兼容**：`config/loader.py` 的 `_workflow_path` 会把任何非 `.owf` 后缀换成 `.owf`，
  所以旧配置里写的 `activity_loop.json`、`workflows/活动副本.json` 仍能解析到 `.owf`；
  按 id 反查走 `read_document_id`（只读头行，不解析整份文档）。
- **内存里的图文档一律 v6**：`decompile_workflow`（v4 编辑形态 → 图文档）也产出 `schema_version: 6`，
  v5 只作为**旧 JSON 文件**的版本号存在（迁移脚本读它，`is_graph_document` 不认它）。
- **子工作流的 inputs 校验**（`node_rules.validate_child_inputs`）同样读 `.owf`。
- **MCP 模板工厂**保存为 `workflows/generated/<name>.owf`，文本由 `emit_runtime_document` 生成
  （内存里的 v4 文档先反编译成图文档再写）。
- **迁移**：`scripts/migrate_workflows_to_owf.py`（默认只预览；`--apply` 写盘并删旧 `.json`；
  `--keep-json` 保留旧文件）。只产出 v5 JSON 的 `migrate_workflows_to_graph_v5.py` 与
  v4 时代的 `migrate_condition_decorators.py` 已删除。

## 平台差异（Python ↔ TypeScript）

两端实现逐语义对齐（`src/oooonmyoji/workflows/dsl/` ↔ `desktop/src/shared/workflow/graph-dsl.ts`），
用同一份契约夹具验收。已知**唯一**的表述差异来自宿主语言：

- **JS 只有一种 number**：`3.0` / `1e20` 这类「整数值浮点」在 TS 里与整数不可区分，
  写盘时会写成整数字面量（`3` / `100000000000000000000`），而 Python 保留 `3.0` / `1e+20`。
  **数值往返两端都精确**，只有文本形式可能不同；仓库现有文档不含这类字面量。
  超过 2^53 的整数在 TS 侧会丢精度（Python 不会）——这属于平台边界，不在格式层处理。
- 其余（缩进块、行内值、引用、引号规则、多行文本块、位置字段折叠、`var` 派生、
  边表顺序、表达式降级、报错的 message/line/column）两端口径**逐字相同**。

## 错误定位

解析错误必须报**行号 + 列号 + 原文行**，并尽量给出所在结构（节点 id / 键路径）：

```
活动副本.owf:214:5: 缩进跳级：这一层是 2 个空格，本行是 6 个
  214 |       threshold: 0.88
       |       ^
活动副本.owf:88:3: 连线不写在节点块里：节点 wait_round_state 的连线要写到顶层 edges 块
   88 |     out.match -> tap_challenge:match
```

语法错误是**解析期**的；引脚合法性、一父多子、成环、switch 空分支等仍是**图语义**错误，
由 `graph_compile.py` / `graph-document.ts` 报（它们已经能做到定位到节点与引脚），
v6 不重复实现。

## 与 v5 的对应关系

| v5 JSON | v6 文本 |
| --- | --- |
| `schema_version: 5` | 落盘文本不写；解析结果固定 `schema_version: 6`（`.owf` 就是格式标记） |
| `nodes: [ {…}, … ]` | `node …` 块，按数组顺序 |
| `edges: [ {from,to} ]` | 顶层 `edges:` 块的 `源[:引脚] -> 目标[:引脚]` 行，顺序一一对应 |
| 变量节点 `{type:"variable", scope, name}` | `var <scope>.<key>`（id 派生） |
| `at: {x,y}` / `size: {w,h}` | `at: [x, y]` / `size: [w, h]` |
| `cases: [{value}]` | `cases:` + `- value: …` |
| `decorators: [{type: …}]` | 重复的 `decorator <type>` 块 |
| `groups` / `comments` / `nodeTypes` | 同名字段，通用块 |
| `_inputParams` 等下划线键 | 同名顶层键（通用块） |

## 分阶段

1. **P1 文本层（已完成）**：语法规范 + Python `emit`/`parse`/`normalize` + 往返与编译等价验证
   （两份真实工作流、40 个跨语言契约用例、全特性夹具 `tests/fixtures/dsl/kitchen.owf`）。
2. **P2 接线 Python（已完成）**：`graph_schema.GRAPH_SCHEMA_VERSION` 提到 6；
   `loader.py` / `node_rules.py` / `config/loader.py` 只读 `.owf`（含后缀替换与按 id 反查）；
   `mcp/service.py` 写 `generated/<name>.owf`；迁移脚本 `migrate_workflows_to_owf.py`；
   删除两个只产出 JSON 的旧脚本；两份工作流迁移完成，`cli validate` 与全量测试通过。
3. **P3 桌面端（已完成）**：TS 镜像 `desktop/src/shared/workflow/graph-dsl.ts`（与 Python 逐语义对齐，
   契约夹具两端同源，`desktop/tests/graph-dsl.test.cjs`）；8 处旁路 `JSON.parse` 全部收敛到
   `parseDocument`；`serializeWorkflow` 删除，落盘唯一出口是
   `canvas/state/document-text.ts` 的 `documentText → emitRuntimeDocument`；
   `projectService` 的移动/重命名从「文本级正则改写」换成**结构级改写后重新序列化**；
   `.json` 硬编码、保存对话框过滤与新建模板全部换 `.owf`；画布 `documentFormat` 状态字段删除。
   验证：两个 typecheck、桌面端 `node --test` **935 项通过**（唯一失败是既有的画布几何用例，与本格式无关）、
   TS 侧 DSL 契约 **111 项**；真实项目上 `listWorkflows` / `getWorkflowInit` / `saveWorkflow`
   端到端通过，且桌面端 emit 出来的文本与 Python 对同一份文档的输出**逐字节一致**。
4. **P4 收尾（已完成）**：README / `workflows/README.md` / `docs/graph-document-v5.md`
   （标注 JSON 落盘已退役、桌面端已接线）/ `docs/README.md` / CHANGELOG 全部同步；
   旧迁移脚本删除、落盘换行统一成 LF（含 `scripts/normalize_workflow_newlines.py`）。
