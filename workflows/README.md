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
- 根目录：御魂组队队长 `御魂组队_队长.owf`（工作流 ID `souls_party_captain`）：
  队友在队立即开战；缺人时等 2 秒复核空位，再邀请已有模板对应的好友「鱼不鲤窝」。
  补邀最多尝试 3 次，每次等入队 40 秒，失败停止。挑战后确认战斗画面，奖励逐页点击，
  续邀弹窗确认默认邀请，再确认回房；完整结算才消耗 `inputs.运行轮数`，默认 20。
  推荐起点为已选好「御魂·悲鸣」的协战房间；也能识别庭院、创建队伍按钮及创建确认按钮
  并恢复房间，沿用游戏记忆的队伍目标。探索地图等未知页面超时停止，不再盲点固定坐标。
- 根目录：御魂组队队员 `御魂组队_队员.owf`（工作流 ID `souls_party_member`）：
  邀请、自动接受、准备和奖励同时识别，看到什么立即处理，不再串行空等邀请 90 秒。
  奖励逐页领取并响应续邀，确认回房或庭院后才完成一轮；等待不扣轮数。
  队员可从庭院、邀请弹窗、队伍、准备、战斗或残留奖励页接续；启动恢复单独清掉残留
  奖励，不计入本次轮数。奖励文字的两种外观与奖励袋均可触发结算处理，避免文字闪烁漏识别。
- 根目录：御魂组队双开入口 `御魂组队_双开.owf`（工作流 ID `souls_party_duo`）：
  instance_parallel 在 mumu-0 跑队长、mumu-1 跑队员，轮数原样传给两侧；
  等双方完成，任一侧失败取消另一侧。两侧关键点击都先复核模板，动作局部重试最多 3 次；
  状态处理预算用尽仍未到达目标页、加载/战斗超时等都会失败退出，避免假成功与无限空转。
- `御魂组队_双开_稳定版.owf`（ID `souls_party_duo_stable`）及对应的队长、队员稳定版：
  与上述 2.1.0 流程相同，入口只引用带 `_稳定版` 后缀的子流程。编辑器里还打开旧版文件时，
  请从内容浏览器重新打开这个独立入口，避免运行前保存旧标签页造成版本混用。
- 根目录：个人结界突破挂机 `结界突破_个人.owf`（工作流 ID `结界突破_个人`）：**不点刷新**
  （9 张全破时游戏自己换一批），selector 从卡 1 到卡 9 逐卡扫描，但每张卡前有
  **「破」印门卫**（`assets/templates/realm/realm-break-seal.png`，`wait_template
  present=false`，各卡格独立 ROI、阈值 0.72、超时 0.6 秒）：格子里有破印 0.6 秒就
  跳过换下一张，没破才点击并调子流程打完整场——打完 5 号卡后下一轮只花零点几秒
  扫过前面的破标，直接落到第一张没破的卡。真帧实测：已破卡命中 0.80-1.00，
  未破卡 ≤0.18；突破符耗尽后整轮扫描全部落空，重试耗尽即失败退出。
  子流程 `结界突破_单场.owf`（工作流 ID `结界突破_单场`）：进场先用 selector 清残留
  提示（干净时走 `present=false` 检查零成本通过）→ 等「进攻」→ 点它 → 等战斗结束
  出现结算提示 → 点提示（retry ×6：每轮点掉一波奖励入账，确认提示消失且「刷新」
  出现才通过，波数不限）→ **等「刷新」按钮出现确认回到九宫格页**。
  「进攻」按钮复用寮突模板（`assets/templates/task_4-template.png`，宽 ROI
  `[380, 480, 1480, 600]` 覆盖 9 个卡位的弹窗位置，实测匹配 0.92、真帧假阳性上限
  0.553）；结算提示用两个模板（战斗结算 `task_6-templates.png` + 奖励面板
  `assets/templates/realm/realm-reward-continue.png`，阈值 0.8——寮突模板在奖励面板上
  只有 0.644 会卡死）；回页确认用真帧裁的
  `assets/templates/realm/realm-grid-refresh.png`（正样本 1.000，各负样本 ≤0.10）。
  卡片坐标（列 460/957/1455，行 309/511/714）、破印 ROI 与刷新按钮位置均用 ADB
  从真 1080p 帧量出。`inputs.突破轮数` 控制进攻次数（默认 30，对应 30 张突破符）。
  运行前置：停在结界突破页、自动战斗开启。
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
        attempts: 3
        delay_seconds: 3
        inputs: {}
      - instance: mumu-1
        workflow: 活动副本.owf
        attempts: 2
        delay_seconds: 1
        inputs: {}

  edges:
    root -> run_all
```

`instance_parallel` 必须是 root 的唯一直接子节点，不能带装饰器；它的
`runs[].inputs` 只能引用父工作流的 `inputs`。点击编辑器运行按钮或执行
`run-workflow` 时，Supervisor 会并发投递所有运行项，输出中的 `group-...` ID
可用于整体取消。每个运行项可用 `attempts`（总尝试次数，含首次）和 `delay_seconds`
配置独立重试；失败或实例进程中断后只重新投递该实例，取消不会重试。父节点建议设为
`wait_for: all`，否则任一实例成功后并行组可能提前结束。每次尝试保留独立运行记录与事件文件。

## 权威契约

图文档的结构由 `src/oooonmyoji/workflows/graph_schema.py` 中的 JSON Schema 强制，
图语义（引脚存在性、一父多子、成环、switch 空分支、状态机未接处理子图 / 终止状态接了
处理子图、变量节点作用域等）由 `workflows/graph_compile.py` 在编译期报错，编译出的运行时
文档再交给 `src/oooonmyoji/workflows/validator.py` 做执行语义校验；每个 Action 的参数与输出
schema 来自其 manifest（内置定义见 `src/oooonmyoji/actions/manifests/`）。
