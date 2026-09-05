# 工作流目录约定

工作流文件按“可直接运行的入口”和“被入口复用的流程”分层，所有 JSON 都使用
Behavior Tree schema v3。

## 目录

- `entrypoints/`：用户或 VS Code 直接启动的实例入口。文件名保留实例和业务含义，
  例如 `mumu_0_souls_party_leader.json`。
- `souls/party/`：组队御魂队长/队员的单回合流程。入口只负责场次策略，单回合
  逻辑放在这里，便于单独校验和复用。
- `souls/shared/`：跨入口复用的子流程，例如进入御魂挑战页、准备阵容、等待胜利和奖励统计。
- `examples/`：不会被生产入口调用的开发/验证样例。

需要一次启动多个实例时，编排入口也放在 `entrypoints/`（开发验证可放在
`examples/`），只描述实例与工作流的映射。示例见
`examples/three_instance_parallel.json`；日常三开入口是
`entrypoints/three_mumu_souls_parallel.json`。

## 引用规则

`workflow.run.params.workflow` 使用相对于本目录的 POSIX 路径，例如：

```json
{ "workflow": "souls/shared/reward_statistics.json" }
```

运行时和 VS Code 会递归发现 `workflows/**/*.json`；直接运行时仍可使用工作流
ID 或唯一文件名，例如 `run-workflow mumu_1_souls_loop`。公共流程不要复制到
入口目录，优先放入 `souls/shared/` 并通过 `workflow.run` 调用。

## 跨实例并行

顶层工作流可以使用 `instance_parallel` 节点一次启动多个 MuMu/ADB 实例：

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
        { "instance": "mumu-0", "workflow": "entrypoints/mumu_0_souls_party_leader.json", "inputs": {} },
        { "instance": "mumu-1", "workflow": "entrypoints/account_1.json", "inputs": {} }
      ]
    }
  ]
}
```

点击编辑器运行按钮或执行 `run-workflow` 时，Supervisor 会并发投递所有运行项。
每个实例有独立的运行事件文件，输出中的 `group-...` ID 可以用于整体取消。

子工作流的顶层 `blackboard` 变量可声明 `public`。只有公开变量才能由
`runs[].inputs` 传入；私有变量保留在子工作流内部。省略 `public` 的旧工作流按
公开处理，新建变量默认私有。例如：

```json
{
  "blackboard": {
    "rounds": { "type": "integer", "public": true, "default": 9999 },
    "internal_state": { "type": "string", "public": false, "default": "ready" }
  }
}
```

在可视化编辑器中，Instance Parallel 节点下方会展开每个实例的子工作流卡片；
公开变量可以使用默认值、填写常量，或绑定编排工作流中的同类型黑板变量。

三开御魂入口可直接运行：

```powershell
python -m src.oooonmyoji.cli --config .\config\config.json run-workflow three_mumu_souls_parallel
```

该入口默认把 `mumu-0` 作为队长、`mumu-1` 作为队员、`mumu-2` 执行御魂循环；
将 `blackboard.rounds` 设为 `1` 可先做一轮验证，也可直接传入 `10`、`30` 或任意 `1..9999` 的轮数；默认值仍为 `9999`。

## 现有公共流程

- `souls/shared/task_in_souls.json`：统一把实例恢复到御魂挑战页。它会按挑战页、八岐大蛇页、探索地图、庭院四种状态依次判断；庭院模板通过公开输入传入，队长和队员入口无需各自复制导航逻辑。
- `souls/shared/prepare_lineup.json`：等待并点击编队准备按钮，可通过
  `inputs.timeout_seconds` 调整等待时间，默认 10 秒。
- `souls/shared/await_victory.json`：等待胜利页并点击继续，可通过
  `inputs.timeout_seconds` 调整等待时间，默认 240 秒。
- `souls/shared/reward_statistics.json`：截图并投递奖励统计，输入
  `category` 和 `layer`。

## 结界突破

- `realm/shared/realm_raid_loop.json`：结界突破主循环。每页固定处理 9 个目标，前 8 个正常挑战；第 9 个目标按“进入战斗、返回列表”重复 4 次，第 5 次正式击败。券读到 0 后结束，输入 `resume_souls=true` 时会按配置模板恢复御魂。
- 结界页每轮开始会通过 `realm.detect_progress` 扫描 9 个目标区域，输出 `completed_count`、`completed[]` 和 `next_index`。完成态可用 OCR 文本（默认“已挑战/已击败/胜利/占领”）或 `completed_templates` 配置；识别不到完成标记时会安全回退为从第 1 个目标执行。
- `realm/shared/schedule_from_souls.json`：御魂回合边界调度器。入口的 `enable_realm_raid` 默认是 `false`；打开后，`realm_threshold` 默认为 30，达到阈值才切换结界突破。
- `run-party-souls --enable-member-realm-raid --realm-threshold 30`：只让队员在监听邀请前执行上述调度。队长会在房间内按最新画面重新发送邀请，每次发送后确认队员入房；最长等待两小时，超时后停止并保留失败现场。
- `entrypoints/realm_raid.json`：单独运行结界突破的通用入口，不绑定具体实例。可在运行输入中覆盖 `entry_point`、`pass_roi`、`target_points`、`target_rois`、`completed_texts`、`completed_templates`、`battle_texts` 和 `victory_texts`。

结界突破页面没有硬编码模板依赖，默认使用 OCR 识别页面、战斗和结算状态；九个目标坐标和券数字区域都属于入口公开变量，可以按实例分别配置。单人御魂会在每轮挑战前检查；组队入口也公开同一套配置，启动建队前可先执行结界突破。
