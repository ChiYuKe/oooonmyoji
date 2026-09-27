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

**折叠图边界卡**：编辑器里的节点组（折叠图）跨组执行边是真的经过 `group_entry` /
`group_exit` 边界卡的——`组外父 → 入口 → 组内子`、`组内父 → 出口 → 组外子`，卡登记在
`group` 块的 `nodeIds` 里；运行时把它们当单子透传（等价于只有一个子节点的 sequence），
展开折叠图后执行关系逐字节还原。旧文档（有跨组边但没边界卡）编辑器首次加载自动补齐。
直接手写 `.owf` 时可以不写边界卡（编译侧只在不变量被打破时才报），但保存回编辑器后
会自动补全。

## 目录

- `entrypoints/`：可直接运行的入口工作流，文件名保留实例或业务含义。这个目录不随仓库提交，
  在编辑器里「新建工作流」时按需生成。
- 根目录：当前活动副本循环 `活动副本.owf`（工作流 ID `activity_loop`），一个状态机卡片
  （`round_state`）每轮识别挑战页与结算页并把执行分派给对应的处理子图，轮数由
  `inputs.运行轮数` 绑到卡片的最大轮数。
- 根目录：结界突破循环 `结界突破_寮突.owf`（工作流 ID `realm_raid_loop`），状态机卡片
  （`page_machine`）识别结算页与「可突破的结界」（亮标 / 灰标是同一个状态的多个模板），
  命中就运行对应处理子图；一个状态都没识别到时走兜底收尾子图判定是否打完——页面上没有
  可突破的结界时正常结束，不在结界突破页时失败退出。
- 根目录：御魂组队循环 `御魂副本.owf`（工作流 ID `souls_party_loop`），页面恢复段用状态机
  卡片（`recover_state`）识别御魂选层页 / 御魂类型页 / 探索地图并分派，识别到选层页即终止；
  拿到选层页后创建协战队伍（已有队伍直接复用），在好友列表里邀请队友（`inputs.邀请目标`）
  并等待入队；随后按 `inputs.运行轮数` 循环「点挑战 → 准备 → 等结算 → 关奖励 → 确认续邀」，
  每轮都会回到协战房间再开下一场（这一段仍是主流程里的线性函数子图）。
- 根目录：御魂组队队员循环 `御魂副本_队员.owf`（工作流 ID `souls_party_member_loop`），
  配合队长工作流在队友号上运行：待机等待组队邀请弹窗（自动准备按钮或普通接受按钮），
  首次接受时勾选「不再提示」启用自动准备，进房点准备参战、结算后回到地图/庭院/协战房间
  待命，按 `inputs.运行轮数` 循环。
- `generated/`：编辑器与工具生成的临时工作流，可随时重建。MCP 模板工厂保存的工作流
  落在 `workflows/generated/<name>.owf`。

## 状态机卡片

`state_machine` 是一等复合节点类型：**页面识别 + 按状态分派 + 循环**写在一张卡上，
不必再手写「detect_state → selector → 每个状态一条 condition」。每个状态的处理子图
就是主流程里的一个普通函数子图，状态机只负责按当前画面调用它。

```owf
  node sm state_machine 活动副本状态机
    at: [498, 208]
    states:
      - name: challenge
        template: assets/templates/souls/souls-challenge.png
        roi: [1621, 791, 299, 289]
        threshold: 0.88
      - name: settlement
        templates: [assets/templates/a.png, assets/templates/b.png]  # 同一状态的多个外观
        roi: [700, 950, 520, 130]
    terminal_states: [done]        # 识别到就成功结束（提前收工）
    state_action: vision.detect_state  # 「判断当前画面」用哪个 Action（可换，见下）
    allow_ocr: false               # 模板全未命中时是否降级 OCR
    state_timeout_seconds: 90      # 一个状态都没识别到时，在同一轮里轮询等待的预算
    max_iterations: 20             # 轮数预算，可以绑到 inputs / variables 的整数值

  edges:
    sm:case.0 -> handler_challenge    # case.<下标> 的下标指向 states
    sm:case.1 -> handler_settlement
    sm:default -> handler_unknown     # 一个状态都没识别到时的兜底（可选）
    sm:out.match -> tap_something:match   # 把「命中在哪」交给动作
```

### 三个角色，三处落地

写一套状态机实际上是三件事，它们在这套框架里是**分开的**，不是一张卡内部的黑盒：

| 角色 | 谁来做 | 帧语义 |
|---|---|---|
| **拿当前画面** | `core.capture`（刷新"最近一帧"）或任何带轮询的等待动作 | `context.capture()` 才抓帧 |
| **判断当前画面** | `vision.detect_state`（默认），或任何满足契约的 Action | `find_template` 读**缓存帧**；`vision.detect_state` 每轮自己抓**一帧**，模板与 OCR 兜底都看这一帧（`ocr_current`） |
| **确认该干什么** | 状态机的 `case.<下标>` → 处理子图 | — |

两条由此推出的规矩：

- **一轮只看一帧**：状态机每轮调一次分类动作，动作内部抓一帧、对所有状态候选做判断，
  所以「判断」不会被画面在中途变化撕成两半。`vision.ocr` 是例外——它是轮询语义（每次
  重新抓帧），这也是 `vision.wait_any_text` 这类动作需要的。
- **判断结果必须交给决策**：分类成功后，状态机**立刻**把这一轮的观察结果登记成自己的输出，
  处理子图（含子图深处的动作）可以直接引用 `nodes.<状态机>.output.{state, source,
  confidence, match, iterations}`，把「命中在哪」喂给点击/OCR，不必把模板参数抄一遍。
  兜底子图（`sm:default`）**不能**引用它——那一轮压根没判断成功，读到的只会是上一轮的旧值，
  校验层会直接报错。

### 换掉「判断」这一步

`vision.detect_state` 只是默认实现。它满足的契约是：

- **接受** `states`（状态声明数组）与 `allow_ocr`；
- **返回** `{ state, source, confidence, match }`，`state` 必须是 `states` 里声明过的名字。

想换判断方式（例如纯 OCR、外部模型、把上一帧缓存的判断结果粘住），注册一个满足该契约的
Action，然后把卡片上的 `state_action` 指过去即可——引擎只认 Action 名，不认识具体实现。
显式写了 `state_action` 就会在编译期校验契约；不写就用内置默认。

### 语义

- 每轮先判断当前画面，再运行该状态的处理子图；处理子图把画面推进到别的状态后，下一轮判断
  自然分发到新的处理子图——**切换是隐式的**，不需要显式的转移表。
- **终止状态**（`terminal_states`）识别到即整机成功结束；**轮数预算用尽**同样算正常收工
  （`运行轮数` 的语义），不是错误。
- 处理子图失败 → 整机失败（失败即停），报错里带上状态名与这一轮的置信度，便于定位是哪个
  画面上的哪一步坏了；需要重试的场合由那个子图自己挂 `retry` 装饰器。一个状态都没识别到、
  又没配 `default` 子图时，整机按 `not_matched` 失败（配了 default 就把「一个状态都没识别到」
  和兜底子图的失败一起写进报错）。
- 每个状态都必须接处理子图；**终止状态不接线**（接了就是作者写错了）。状态名只在
  `states` 里写一份，`case.<下标>` 的下标就是它在 `states` 里的位置。
- 一个状态可以写 `templates`（多张模板，任一命中即算这个状态）：像「亮标 / 灰标」这种
  同一页面的不同外观本来就该算一个状态——否则两个状态没法共用同一个处理子图，因为节点
  只有一个执行父级。
- **不做「粘性当前状态」**：当前画面每轮重新判断，而不是缓存一个状态、只在确认后才改。
  这套框架的可靠性靠**动作之后的确认**（`input.tap_match` 的 `verify_gone` /
  `disappeared_states`、`vision.wait_template(present=…)`），而不是靠记住一个可能已经过期的
  状态——粘性状态会把「画面意外变了」这件事盖住，那比多花一次判断危险得多。

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
图语义（引脚存在性、一父多子、成环、switch 空分支、状态机未接处理子图 / 终止状态接了
处理子图、变量节点作用域等）由 `workflows/graph_compile.py` 在编译期报错，编译出的运行时
文档再交给 `src/oooonmyoji/workflows/validator.py` 做执行语义校验；每个 Action 的参数与输出
schema 来自其 manifest（内置定义见 `src/oooonmyoji/actions/manifests/`）。
