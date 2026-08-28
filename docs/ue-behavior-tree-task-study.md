# UE 行为树与 Task 运行机制研读笔记

> 素材来源：`ChiYuKe/UnrealEngine` fork（release = UE 5.8.2）实读源码，
> 已下载到 `artifacts/ue_engine_ref/`（AIModule 行为树 + GameplayTasks 模块，
> 注意 5.8 把头文件从 `Public/BehaviorTree/` 挪到了 `Classes/BehaviorTree/`）。
> 目的：提炼可借鉴的运行逻辑，应用到 oooonmyoji 的工作流引擎。

---

## 1. 总体架构：搜索与执行分离

UE 行为树运行的核心不是"每帧从头跑一遍"，而是**两阶段模型**：

```
                 ┌─────────────────────────────┐
                 │  UBehaviorTreeComponent     │  ← 挂在 AIController 上，每帧 Tick
                 │  (TickComponent)            │
                 └──────────────┬──────────────┘
                    │                            │
        ┌───────────▼───────────┐   ┌───────────▼───────────┐
        │  FBehaviorTreeSearch  │   │  节点执行 (ExecuteTask) │
        │  (查找下一个要执行的   │   │  返回三态结果            │
        │   Task 节点)          │   │  Succeeded/Failed/     │
        └───────────┬───────────┘   │  InProgress            │
                    │               └───────────────────────┘
                    │  完成/中止后 → 再次发起 Search（沿执行索引）
                    ▼
        ┌─────────────────────────────┐
        │  ExecutionRequest 排队       │  ← 当前 Task 还没结束前，
        │  PendingExecution 挂起       │     新请求先挂起，不打断执行
        └─────────────────────────────┘
```

- **每个节点有全局 `ExecutionIndex`**（深度优先编号），搜索只在小段索引范围内
  进行（`FBTNodeExecutionInfo.SearchStart/SearchEnd`），子树整体跳过的
  关键（`BTTask_RunBehavior` 压栈后，搜索直接从子树结束后继续）。
- **执行请求可以被挂起**：装饰器触发的高优先级分支请求（abort）在
  当前 Task 还在跑时不会立刻执行，而是存到 `ExecutionRequest`，等当前
  Task 完成或**中止完成**后再 `ProcessPendingExecution()`。

### 实例栈：一棵树套一棵树

- `TArray<FBehaviorTreeInstance> InstanceStack`：每压入一棵子树
  （`PushInstance`，由 `BTTask_RunBehavior` 调用）就多一层实例。
- `ActiveInstanceIdx` 指向栈顶；子树完成时弹栈，父任务通过
  `DeactivationNotify` 委托拿到子树结果。
- **持久内存**：`KnownInstances` 保存每个实例的持久内存块，子树退出时
  `CopyInstanceMemoryToPersistent`，再次进入时恢复——保证跨多次进入
  同一个子树的节点状态（如循环计数）不丢。

---

## 2. 节点协议：三态结果 + ReturnToParent

```
                EBTNodeResult: Succeeded / Failed / InProgress / Aborted
                                  ▲                        │
                    组合节点向上冒泡 ◄──────────────────────┘
                    (ReturnToParent)                  Task 返回 InProgress 时
                                                       整条路径挂起，等 FinishLatentTask
```

- **Task 是叶子**：`ExecuteTask()` 返回 `Succeeded` / `Failed` /
  `InProgress`。`InProgress` = 异步执行中，之后必须调用
  `FinishLatentTask(OwnerComp, Succeeded/Failed)` 或
  `FinishLatentAbort(OwnerComp)` 由组件继续执行流。
- **组合节点只做一件事**：`GetNextChildHandler(SearchData, PrevChild, LastResult)`
  返回下一个子节点下标，或 `BTSpecialChild::ReturnToParent`（= 把结果交给父节点）。

```cpp
// Selector: 失败换下一分支，成功向上冒泡
if (PrevChild == 未初始化)        → 0
else if (Failed && 还有下一分支)  → PrevChild + 1
else                              → ReturnToParent

// Sequence: 成功走下一分支，失败向上冒泡
if (PrevChild == 未初始化)          → 0
else if (Succeeded && 还有下一分支) → PrevChild + 1
else                                → ReturnToParent
```

**这是全部的组合逻辑**：复合策略 = "选第一个、失败/成功时问父节点要下一个"。
新组合节点（如随机、权重）只需重写 `GetNextChildHandler`。

---

## 3. Task 生命周期（自定义 BTTask 的模板）

```cpp
EBTNodeResult::Type ExecuteTask(OwnerComp, NodeMemory);   // 入口
EBTNodeResult::Type AbortTask(OwnerComp, NodeMemory);     // 被打断时
void TickTask(OwnerComp, NodeMemory, DeltaSeconds);       // 需要时才会被调
void OnTaskFinished(OwnerComp, NodeMemory, TaskResult);   // 收尾
```

关键细节：

1. **节点内存 `NodeMemory`**：所有"模板节点"（非实例化）共享同一个
   UObject，**运行状态必须放内存块**（`GetInstanceMemorySize()` +
   `GetNodeMemory<T>()`），不许改节点对象属性——这是共享模板的正确用法。
2. **惰性 Tick**：Task 的 `TickTask` 不是每帧都调。`FBTTaskMemory` 有
   `NextTickRemainingTime`，`SetNextTickTime(NodeMemory, sec)` 设定下次
   唤醒时间；`bTickIntervals` 时组件只在需要时 Tick 该节点
   （`WrappedTickTask` 会改写 `NextNeededDeltaTime` 让引擎降低自身 Tick 频率）。
   范例 `BTTask_Wait`（见下）。
3. **消息观察者**：`WaitForMessage(OwnerComp, MessageType)` 注册消息观察，
   `OnMessage` 收到后默认 `FinishLatentExecution/Abort` —— 让 Task 能
   等待外部事件完成（如"等动画通知"）。
4. **不可重入**：`bIgnoreRestartSelf` —— 树重新搜索时如果该 Task 正在跑，
   可以丢弃这次选择（避免"选中自己"导致重启）。

```cpp
// BTTask_Wait.cpp —— 最标准的异步 Task 写法
EBTNodeResult::Type UBTTask_Wait::ExecuteTask(...) {
    const float WaitSeconds = 随机(WaitTime ± Deviation);
    SetNextTickTime(NodeMemory, WaitSeconds);   // 告诉引擎：N 秒后再 Tick 我
    return EBTNodeResult::InProgress;           // 挂起执行流
}
void UBTTask_Wait::TickTask(...) {              // 时间到，被唤醒
    FinishLatentTask(OwnerComp, EBTNodeResult::Succeeded);  // 恢复执行流
}
```

---

## 4. 装饰器（Decorator）与中止（Abort）

装饰器是**条件节点**，挂在组合节点或分支上。生命周期：

```
OnBecomeRelevant     ← 分支被激活
OnNodeActivation     ← 节点进入执行
CalculateRawConditionValue ← 条件求值（可反向 bIsInversed）
OnNodeDeactivation   ← 节点离开执行
OnCeaseRelevant      ← 分支被停用
条件变化时 → ConditionalFlowAbort() → 请求重新搜索该分支
```

**`FlowAbortMode`（观察者中止，关键概念）**：

| 模式 | 含义 |
|---|---|
| `None` | 条件只在分支被选中时求值一次 |
| `Self` | 本分支执行中条件变否 → **中止当前分支内的任务**（如"血低于 30% 就逃跑"） |
| `LowerPriority` | 更靠后的分支条件变真 → **打断当前正在执行的低优先级分支**（如"发现敌人就切换攻击"） |
| `Both` | 两者都要 |

实现上是**观察者**：装饰器在组件里注册，黑板值变化/定时器触发时
`RequestBranchEvaluation`，组件把新搜索请求排队（`EBTBranchAction` 队列 +
`SuspendBranchActions/ResumeBranchActions` 处理拓扑变更一致性），
当前任务先 `AbortTask`（异步可返回 InProgress，等 `FinishLatentAbort`），
完成后切入新分支。

services 与 decorators 统称**辅助节点（Aux Nodes）**，组件维护它们的
"已注册"集合，随执行流进出：`RegisterAuxNodes`/`UnregisterAuxNodesInBranch`。
服务（BTService）周期性 `TickNode`，用于持续更新黑板（如维护"目标位置"），
生命周期同装饰器（OnBecomeRelevant/OnCeaseRelevant/TickNode）。

---

## 5. 黑板（Blackboard）：共享内存 + 观察者

- `UBlackboardData` 定义键（名、类型），`UBlackboardComponent` 运行值。
- 键类型：Bool/Float/Int/String/Enum/Name/Object/Vector/Rotator/Class/
  Struct + 原生枚举（`BlackboardKeyType_*`）。
- **观察者**：`AddObserver` / `RegisterObserver` —— 值变化时通知装饰器
  （这就是装饰器"黑板键变化 → 中止"的实现通道）。
- 节点用 `FBlackboardKeySelector` 声明自己需要哪个键，资产初始化时解析
  （`bCreateNodeInstance` 的节点如 BP 节点，还会 `ResolveBlackboardSelectors`）。
- 树上所有实例共享同一块黑板（子树的 `BTTask_RunBehavior` 要求黑板兼容
  = 相同或父子关系）。

---

## 6. 并行：SimpleParallel（主任务 + 后台树）

```
SimpleParallel
 ├─ 主任务（Main Task）      ← 必须存在，决定并行何时结束
 └─ 后台树（Background Tree） ← 一直重复跑，直到主任务结束
FinishMode = AbortBackground   |  WaitForBackground
             主任务结束就砍后台  |   主任务结束后等后台树跑完一轮
```

实现核心：主任务返回 `InProgress` 时 `RegisterParallelTask` 记入活动集，
`GetNextChildHandler` 在主任务活动期间永远指回后台树（`bForceBackgroundTree`），
有死循环保护（同一次搜索重复选同一分支 → `bPostponeSearch`）。
主任务结束 → `UnregisterParallelTask` → 按 FinishMode 决定是否请求中止后台分支。
**注意**：后台树不能压子树（`CanPushSubtree` 返回 false，子树交给主任务路径）。

---

## 7. GameplayTask 系统（"Task"的另一层含义）

`UGameplayTasksComponent` 是任务队列仲裁器，`UGameplayTask` 是异步任务单元。

- **状态机**：`Uninitialized → AwaitingActivation → Paused/Active → Finished`
- **优先级 + 资源集**：任务声明 `Required/Claimed Resources`
  （`FGameplayResourceSet` 位图），组件保证：
  - 资源被更高级任务占着 → 低优先任务排队/暂停
  - `ETaskResourceOverlapPolicy`：`StartOnTop`（压栈暂停同级）/
    `StartAtEnd`（等同级结束）/ `RequestCancelAndStartOnTop` 等
- **生命周期**：`ReadyForActivation → Activate → TickTask → EndTask/OnDestroy`，
  支持 `Pause/Resume`、`ExternalCancel`、`ChildTask` 子任务链。
- **与行为树的关系**：`UBTNode` 实现 `IGameplayTaskOwnerInterface`，
  `NewBTAITask<T>()` 为节点创建 AITask；`BTTask_GameplayTaskBase` 桥接：
  任务激活时把 GameplayTask 注册给组件，`OnGameplayTaskDeactivated` 回调
  `FinishLatentTask`。MoveTo 就是 `UAITask_MoveTo` 挂在这个机制上。
- 心智模型：**BT Task = 行为控制流里的一个动作单元；GameplayTask =
  可仲裁、可抢占的通用异步任务**，BT 用后者实现长动作。

---

## 8. 在 oooonmyoji 中的落地状态

工作流运行时已切换为 Behavior Tree v3，不再是成功/失败跳转状态机：

| UE 概念 | v3 对应 |
|---|---|
| Behavior Tree 资产 | `root` + `nodes[].children` 有序树 |
| Blackboard | `blackboard` 类型定义与 `blackboard.<键>` 引用 |
| Task | `type: task` + Action manifest 参数 |
| Selector / Sequence | 运行时直接实现 UE 的成功/失败推进规则 |
| Simple Parallel | 主 Task + 后台分支，支持 AbortBackground / WaitForBackground |
| Decorator | condition / cooldown / timeout / retry / repeat |
| ExecutionIndex | 编译阶段按深度优先顺序生成并写入运行事件 |
| RunBehavior | 保留 `workflow.run` Action、递归检测与四层限制 |

未照搬的部分：黑板值变更观察者、FlowAbort、Service 周期 Tick、`InProgress`
事件驱动任务协议和 UE 节点内存块。这些需要事件调度器而不是线程阻塞模型，若没有
完整生命周期就加入会制造看似兼容但实际错误的语义。

---

## 9. 参考资料（已落盘的源码文件）

关键文件（`artifacts/ue_engine_ref/`，`__` 为路径分隔符）：

- `Engine__Source__Runtime__AIModule__Classes__BehaviorTree__BehaviorTreeComponent.h/.cpp` — 运行时核心
- `...__BehaviorTree__BTNode.h` / `BTTaskNode.h` / `BTCompositeNode.h` / `BTDecorator.h` / `BTService.h` / `BTAuxiliaryNode.h`
- `...__Composites__BTComposite_Sequence.cpp` / `BTComposite_Selector.cpp` / `BTComposite_SimpleParallel.cpp`
- `...__Tasks__BTTask_Wait.cpp` / `BTTask_BlueprintBase.cpp` / `BTTask_RunBehavior.cpp`
- `...__Decorators__BTDecorator_Cooldown.cpp` / `BTDecorator_Loop.cpp`
- `Engine__Source__Runtime__GameplayTasks__Classes__GameplayTask.h` / `GameplayTasksComponent.h`
- `...__Private__GameplayTasksComponent.cpp` / `GameplayTask.cpp`
