# 对弈竞猜游戏逻辑对齐实施记录

目标与依据：`E:/Project/临时工作区/yys-lineup/TASKS-engine-game-fidelity.md`。本记录区分已根据客户端代码实现的规则、需要官方动态数据的规则，以及使用假设得到的统计结果。

## 实施状态

- **P0 伤害与属性接线：已接入。** 引擎入口调用游戏伤害公式，采用 K=300，并按 `base × (1 + percent) + flat` 合成属性。控制和反伤式神魂使用统一防御常数。
- **P1 伤害流程：主要阶段已实现。** 攻防双方钩子、闪避、原始伤害、延后减伤、固定减伤、护盾、免疫、反弹、吸血和额外生命吸收按顺序结算。事件分别记录护盾消耗和实际生命损失。内容模块尚未声明的属性或特殊技能机制不自动视为完整。
  - ✅ **2026-10-09 修正 `calcShieldAbsorb` 的穿透量（原实现高估护盾）**：按客户端块布局，
    `shield_dmg_add_rate`（来自 `calcDmgParam.extShieldDmgRate`）的放大量**先吃盾且不挡伤害**，
    只有剩余容量按 1:1 挡伤 ⇒ `shieldLeft = extHurt>0 && extHurt>=shield ? 0 : shield−extHurt`，
    `damage = max(0, realHurt − shieldLeft)`。`consumeShield` 不变（`min(shield, realHurt+extHurt)`）。
    例：3000 伤害 / 2000 盾 / rate 0.5 → 消耗 2000、**穿透 2500**（原实现给 1000）。
    用例期望同步更正，`npm run test:duel` 全绿。详见 [`DUEL_ENGINE_HANDOFF.md`](./DUEL_ENGINE_HANDOFF.md) §4.1。
  - ✅ **2026-10-09 补齐 `AOE_SKILL_TO_SHIELD_DMG_RATE = 2.5`（AOE 打护盾实体）**：
    依据 `calcRawAttackDmg.txt:2104-2180`（`if isRangeSkill(skillData['selectRange']) and
    helpers.isShieldEntity(targetEntity): realHurt *= 2.5`），位置在 `(1 + extDmgRate)` 之后、
    `extCritPower`/`maxHurt`/下限 1.0 之前。实现：
    - `mechanics/game-damage.ts`：新增常量 `AOE_SKILL_TO_SHIELD_DMG_RATE = 2.5` 与输入
      `isRangeSkill` / `isShieldEntity`，在 `calcRawAttackDmg` 的对应位置乘算；
    - `core/types.ts`：`UnitState.shieldEntity?: boolean`（内容模块显式标记护盾实体）；
    - `core/context.ts`：`calculateDamage` 自动补 `isRangeSkill`（本次行动形态为
      `all-enemies`/`all-allies`/`multi`）与 `isShieldEntity`（目标 `shieldEntity === true`）；
    - `content/chihime.ts`：海原贝戟标记 `shieldEntity: true`。
    - ⚠️ 两处近似（已在代码注释标明）：① 客户端 `RANGE_SKILLS` 集合需运行时从
      `com.utils.formula` 读取，暂以行动形态近似（实测 `all-enemies` 对应客户端 `selectRange="2"`
      占 9/10，单体基本为 `"1"`）；② `helpers.isShieldEntity` 的判据尚未反汇编，暂由内容显式标记。
    - 用例：`duel-game-fidelity.test.cjs` 新增一条（只满足 AOE 或只满足护盾实体都不增伤；
      两者同时满足 → ×2.5；且位于 `extDmgRate` 之后、`maxHurt` 之前）。`npm run test:duel` 全绿、
      `tsc -p tsconfig.renderer.json --noEmit` 通过。
  - ✅ **2026-10-09 补齐治疗数值管线（`_calcCure` 忠实移植）**：此前引擎只有 `resolveHealing`
    （加血 + 上限钳制）与 `healingTaken` 乘区，缺治疗强度/受治疗强度/御魂治疗强度/阵营治疗系数/治疗暴击。
    现按 `out/disasm/com_utils_formula/_calcCure.txt` 的 STORE 顺序实现（新文件
    `mechanics/game-heal.ts`，含逐偏移注释）：
    ```
    stren      = from.cureStrenthRate + target.curedStrenthRate     # ★ 两边率"相加"
    equipValue = cureValue × from.equipCureStrenthRate              # ★ 线性加项，不是乘区
    cureValue *= (1 + target.PvpCuredStrenthRate)
    cureValue *= (1 + stren)
    cureValue += equipValue
    cureValue *= getCampData(target.camp).cureRate                  # ★ 取**目标**阵营
    cureValue  = max(cureValue, 1)                                  # 下限 1
    critical   = rand < from.critRate 且非 hero_no_crit
    if critical: cureValue *= (1 + from.critPower)                  # 治疗吃暴击、不吃抗暴
    cureValue  = doCureAbsord(from, target, cureValue)              # SUFFER 池吸收
    ```
    接线：`UnitState.cureAttributes`（四个率 + `heroNoCrit`）、`effects.ts` 的 `heal` 分支调用
    `calcCure`、`applyEffectCommands` 增加可选 `random` 参数（治疗暴击需要随机源；已从
    `settlement.ts` 与 `action-runner` 主循环透传）。治疗吸收沿用既有
    `StatusDefinition.healingAbsorption` / `values.healingAbsorptionRemaining`（与 `doCureAbsord` 同构）。
    用例：新增「治疗按 `_calcCure` 官方公式…」（无加成/强弱相加/御魂加项/阵营系数/下限 1/暴击/
    `hero_no_crit`/吸收池 + 端到端）；既有「灼华桃花妖…」用例的治疗期望按官方口径更新
    （治疗方可暴击 ⇒ 15% 生命上限 1500 → 2250；复活本身不是 heal 命令故不暴击 ⇒ 6500）。
    `npm run test:duel` 全绿、`tsc -p tsconfig.renderer.json --noEmit` 通过。
  - ✅ **2026-10-09 补齐间接攻击按层降防（`INDIRECT_REDUCE_VALUE = 10`）**：
    依据 `indirectDamageCalc.txt:656-744`：
    ```
    total_lv       = targetEntity.BuffMgrComp.getIndirectBuffLv()
    reduce_defense = total_lv * const.INDIRECT_REDUCE_VALUE
    calcDmgParam.ignoreDefenseValue += reduce_defense          # 在 calcAttackDmg 之前累加
    ```
    判定来源：客户端 buff 数据字段 `indirectDmgType`（`table_DATA_BUFF.json` 7458 条里 0 占 4074、
    1 占 48；取 1 的正是「回合后造成/受到…」「永久降低基础防御」这类间接伤害 debuff）。
    实现：`mechanics/game-damage.ts` 新增常量 `INDIRECT_REDUCE_VALUE`；
    `core/definitions.ts` 新增 `StatusDefinition.indirectDamageLevel`（每层贡献，应用时写入
    `StatusInstance.values.indirectDamageLevel`）；`mechanics/indirect-damage.ts` 新增
    `indirectBuffLv(unit)` / `indirectDefenseReduction(unit)`；`core/context.ts` 的 `calculateDamage`
    在 `isIndirectDamage` 时把 `lv × 10` 并入 `defenseReduction.ignoreDefenseValue`。
    用例：`间接攻击按目标间接伤害层数降防…`（层数求和/未标记不计/端到端 500 → 1000×300/(300+280)）。
    说明：引擎目前没有内容声明 `indirectDamageLevel`（与 `shieldEntity` 同样是"接好线、等内容标注"），
    标好后即刻生效。
  - ✅ **2026-10-09 补齐持续伤害（DOT）机制**（`buffCalc` 移植）：此前引擎没有通用 DOT 路径，
    中毒/灼烧由各英雄自己发 `deal-damage`/`lose-life`。依据
    `out/disasm/com_utils_formula/buffCalc.txt`：
    ```
    138-154  仅当 buff 的 continueHurt > 0 或 continueAttackHurt > 0 才结算
    178-200  checkDamageAvoided / Immunity.CONTINUE_HURT 免疫则跳过
    324-428  hpChange = min(targetEntity.AttrComp.hp × continueHurt,      # 按目标**当前生命**
                            fromEntity.AttrComp.attack × CONTINUE_HURT_LIMIT)  # ★ 上限 = 攻击×1.0
             （另一支用 continueAttackHurt：fromEntity.attack × continueAttackHurt，同受该上限）
    430-432  critical = False                                              # ★ DOT 永不暴击
    434+     把该值当"攻击"送进 calcRawAttackDmg ⇒ **复用完整伤害管线**
    ```
    实现：新文件 `mechanics/continue-hurt.ts` —— `CONTINUE_HURT_LIMIT = 1.0`、`calcContinueHurt()`
    （基础值 + 上限截断 + `capped` 标记）、`continueHurtCommand(context, …)`（先算基础值，
    再用 `context.calculateDamage({ attack: base, defense: 目标防御, noCrit: true })` 生成 `deal-damage`
    命令，保证防御/减伤/护盾/玄血都参与）。
    参数来源已确认：客户端 buff 表 `continueHurt`（29 条非零，按目标当前生命，如 0.08/0.09/0.17）与
    `continueAttackHurt`（27 条非零，按攻击，如 0.4/0.5/0.63）。
    用例：`持续伤害按 buffCalc 口径…`（上限截断 / 按攻击 / 端到端仍吃防御且不暴击）。
  - ✅ **2026-10-09 补齐重伤溢伤回流（`make_serious_injury_overflow_value_defense`）**：
    此前引擎只有"重伤按 def=0 计 + 记 `record_*`"，**没有**超出血量部分的回流换算。
    依据 `out/disasm/com_utils_formula/make_serious_injury_overflow_value_defense.txt`（全文 63 行、无跳转歧义）：
    ```
    2-16     if overflow_value <= 0: return overflow_value
    18-98    overflow_value *= K / (K + record_defense)                 # 用记账防御补回 K/(K+def)
    104-142  overflow_value /= (1 + record_hurt_reduction_rate)
    144-182  overflow_value /= (1 + record_indirect_hurt_reduction_rate)
    184-216  overflow_value *= (1 - record_target_hp_change_reduce_rate)
    ```
    实现：新文件 `mechanics/serious-injury.ts` —— `seriousInjuryOverflowValue(overflowValue, record, K=300)`
    纯函数（含偏移注释）。用途：玄血/重伤类内容把"超过玄血的溢伤"按真实防御与三种减伤率折算后回流。
    ⚠️ 已知缺口：`record_target_hp_change_reduce_rate` 的**来源**在客户端未定位
    （`doSkillCalc` 里只见 `remain_target_hp_change` / `set_target_hp_change_to_1` 这类**另外**的机制），
    因此引擎未新增对应属性，函数由调用方按需传入。
    用例：`重伤溢伤回流按 make_serious_injury_overflow_value_defense…`（≤0 直返 / 只补防御 1000→500 /
    再叠两种减伤 →250 / 再叠生命变化削减 →200 / 未记账 ⇒ ×1）。
  - ✅ **2026-10-09 补齐两条免疫口径**（DOT / 间接伤害的最后一块）：
    - `const.Immunity.CONTINUE_HURT`（`buffCalc.txt`：`checkDamageAvoided` 之后判定）⇒
      `StatusDefinition.continueHurtImmune` + `mechanics/continue-hurt.ts` 的
      `continueHurtImmune(unit, resolveStatus?)`；`continueHurtCommand()` 命中免疫时**不生成**命令。
    - `const.Immunity.DEBUFF_INDIRECT`（`indirectDamageCalc.txt` 同上位置）⇒
      `StatusDefinition.indirectDamageImmune` + `mechanics/indirect-damage.ts` 的
      `indirectDamageImmune(unit, resolveStatus?)`，内容在发起间接攻击前先查。
    用例：`持续伤害与间接伤害的免疫口径…`（有无免疫的对比 / 不传 resolver 则不检查）。
  - 仍缺（P1 后续）：**DOT 的内容标注**（把中毒/灼烧类状态改用 `continueHurtCommand`，需按 buff id
    对上客户端参数字段）、**重伤溢伤的内容调用**（玄血类状态把溢伤接进 `seriousInjuryOverflowValue`）、
    溅射 `jianSheType` 与延迟伤害 `damageDeferred`（二者在 `attackCalc`/`directDamageCalc`/`indirectDamageCalc`
    里是**参数透传**而非独立算法，引擎侧暂以 `damageKind`/调度表达）、
    时间维度/锁/间隔队列（`TurnState`/`BoutLockItem`/`isGapOfTime`）。
- **P2 行动条：已切换为 turnPos 和多队列模型。** 读取了客户端行动位置更新、整回合、插队和优先级逻辑，并保留完整行动队列；推拉条免疫区分两个方向并发出来源事件。同速交替使用模拟器规则，因为输入数据没有客户端 UID，无法复现客户端最后一级排序。回合超时、速度修改时的客户端内部重排及完整插队 ID 表尚未覆盖。
- **P3 鬼火：常见规则已接入；抵扣口径已核对（2026-10-09 更正）。** 包含供火条、8 点储量上限、阴阳师与式神阵亡补火、同一单位每次支付前重新计算折扣。供火按模拟器回合结束事件推进；客户端锁定阶段也会更新回合供火计数，两者对插队和额外回合的完整对应仍需实战事件验证。
  - ⚠️ **更正**：此前（文档与 `TASKS-engine-game-fidelity.md`）把抵扣描述为「同一回合内累积、**回合末**复位重算」，这是误读。调用点已查明在 `formula.forceCastSkill`（`com/utils/formula.py` line=4186，反汇编 `yys-lineup/out/disasm/com_utils_formula/forceCastSkill.txt:138-160`）：**每次施法前**先 `calc_guihuo_consume` 复位+重算本施法者的抵扣，再门禁、施法、按 `getConsumeValue()` 扣火、抛 `Skill_Cast_Consume_Guihuo`。引擎的 `StatusDefinition.modifyResourceCost`「每次付费按当前状态重算」在模型上**已经等价**，不必推倒重来。
  - ✅ **2026-10-09 定案并实施：扣火改为官方顺序（施法后扣）。**
    - 运行层 `core/action-runner.ts`：① 施法前持有 `gatePlan` 做**火够不够**的门禁（价格已按
      `calc_guihuo_consume` 语义重算）；② 施法前只结清「抵扣的消耗部分」（`statusSubstitutions`，
      如流光/愿力/层数）；③ `castSkill`（技能自身逻辑与伤害）跑完后，才执行 `change-resource` /
      `set-resource-meter-progress` 扣掉 `paymentPlan`（对应客户端 `getConsumeValue()` → `guiHuo -= …`
      → `Skill_Cast_Consume_Guihuo`），事件仍为 `phase='resource-payment'` 的 `resource-changed`。
    - 直接后果：**技能自身逻辑读到的是扣火前的鬼火**（与客户端一致）。已有用例随之确认这一点：
      `狂骨` 伤害由 116 改为 **140**（5 火 × 8%/火，扣火前）、`浮世青行灯` 的扣火断言改为与顺序无关的
      「本回合扣火总量 = 4」、`action runner` 的事件序列把 `resource-changed` 移到 `attack-ended` 之后。
    - 内容层 `content/lantern-spirit.ts`：青行灯规则原文是「**技能结算后**若己方鬼火多于敌方…」，
      在官方顺序下该判定必须在**扣火之后**，因此把「鬼火差真实伤害」从 `attack-end` 移到 `action-end`
      （命中夺火仍留在 `attack-end`）。
    - 验证：`npm run test:duel` 全绿（0 失败）、`tsc -p tsconfig.renderer-tests.json --noEmit` 对我改动的
      三个文件无错误（该次全量 `tsc -p tsconfig.renderer.json` 另有 2 条报错，位于 `content/yato-no-kami.ts`
      与 `presentation/events.ts`，均由并发写入者的在途改动引入，与本项无关）。
  - 剩余命名差异：客户端事件名为 `Skill_Cast_Consume_Guihuo`，引擎以 `phase='resource-payment'` 的
    `resource-changed` 代替（内容模块可挂 handler，语义接近）。
  - 详细推导、逐条证据与复现命令见 [`DUEL_ENGINE_HANDOFF.md`](./DUEL_ENGINE_HANDOFF.md)。
- **P4 技能表：解码器和接入已实现，通用等级键映射仍待验证。** 序列化块的 18,447 个条目、7,178 个技能 ID 和所需 1,566 个 ID 均已导入；原有千姬 33 行回归通过。新增客户端真值快照含 8 行、43 个字段；当前等级映射曾与其中 30 个字段冲突，导入器现记录冲突并以客户端直接解出的行覆盖。8 行现已逐字段完全吻合。非锚点行的 blob 记录键到运行时技能等级的通用映射仍未被这些真值证实，故全 ID 覆盖不等于全等级数值已经校准。运行路径已接入 `addDmg`、`dmgFluctuation`、`consumeVal` 与 `param1..10`；专属效果参数仍由相应内容规则解释。
- **P5 式神 AI：评分框架已实现，页面提供了可用的人工整理规则参考，但不是官方权重表。** 客户端权重计算与目标评分已分开；对弈竞猜采用服务器权威战斗，不会在客户端加载 `SKILL_AI_DATA`，所以官方原始序列仍无法由该进程取得。你提供的[式神 AI 页面](https://yys.huijiwiki.com/wiki/%E5%BC%8F%E7%A5%9EAI)目前列有 272 个式神条目，逐条整理技能释放和目标偏好；我已核对其中的页面结构与条目数。它能作为式神专属策略的社区参考，但不含官方权重或完整候选序列，也不能自动补齐未建模技能。现有模块化策略只覆盖已实现的式神子集；其余条目需要先有可执行技能与状态规则，再迁移对应 AI 条件。官方序列的一致率仍需本地 AI 战斗事件或原始表验证。
- **P7 效果命中/抵抗：常规概率质量已统一，固定随机种子映射仍与客户端不同。** 本地 `calcSkillAddBuff` 反汇编显示：完整公式为 `(defSuccRate × (1 + debuffEnhance) + additionSuccrate) ÷ max(0.0001, 1 + effectiveResist)`（分母绝对值接近0时用 epsilon）。当前通用辅助函数覆盖的是**没有独立 `additionSuccrate` 的常规调用**，将命中修正后的基础概率除以抵抗分母；成功、抵抗、失败三种结果分开处理，只有抵抗区间生成抵抗事件。专项回归覆盖三种结果。静态调用点复核发现雪女减速、三尾狐狐毒此前把负效果命中截成0，与客户端乘数不符；现已改为直接使用 `1 + hit`，负命中回归通过。客户端按“失败→抵抗→成功”顺序消费随机区间，模拟器保留既有“低值先成功”约定，因此统计概率一致，但逐个固定随机值/种子不承诺与客户端同结果。控制反射、转化和传递等事件型路径是否应重新经过 `calcSkillAddBuff`、独立附加成功率及99%必成分支对各入口的适用条件仍待逐调用点核实；`useDebuffResist=false` 本身不代表忽略抵抗。
- **P6 统计校准：脚本与一轮实测已完成，计划门槛未达到。** 使用 26 局、每局 200 次模拟。该数据集没有逐局面板、御魂、点数和技能等级，因此结果按六星 40 级基础面板、无御魂、等级 5 假设输入；不能代表实际竞猜配置。校准结果为准确率 61.54%、Brier 0.3818、LogLoss 7.3009；Brier 与 LogLoss 门槛均未通过。

## 验证记录

- `npm run typecheck`：Renderer 与 Electron 类型检查通过。
- `npm run test:duel`：核心与对齐专项测试 220 项全部通过，包括技能表倍率接入行动执行的回归用例。
- 斗技主界面冒烟用例：3 项通过。
- Vite Renderer 构建通过；大入口包约 1.30 MB（压缩前），构建工具提示该入口超过 500 KB。
- 技能数据离线回归：18,447 行成功解析，千姬 33 行差异为 0；8 条最新客户端真值共 43 个字段逐字段比对通过，覆盖旧数据中的 30 个字段冲突。
- 最新 26 × 200 校准：准确率 61.54%、Brier 0.3818、LogLoss 7.3009；两项计划门槛未通过。独立参考校验器确认预测与指标一致。
- 校准产物位于 `desktop/out/duel-fidelity/`。`verify-duel-calibration.py` 会调用计划附带的独立校验器并核对指标，不会改写上游数据集或预测。
- 2026-10-09 效果命中/抵抗复验：通用控制检定改为客户端公式 `chance ÷ (1 + resist)`，不再用旧的 `chance × (1 - resist)`；普通概率失败不再误记为抵抗。雪女减速、三尾狐附加状态改用相同换算，并于本轮修正两条入口对负效果命中的错误截断；负命中边界定向回归通过。客户端与模拟器固定随机区间顺序仍不同，见 P7；控制反射、转化和传递等事件型路径是否重做命中/抵抗仍需客户端调用点证据。

## 后续所需输入

1. 继续完成 P5 时，可按 272 条社区条目扩展已建模式神的决策策略；若要验收官方权重/候选序列一致率，仍需运行本地式神 AI 的战斗事件或导出的 `SKILL_AI_DATA` 表。对弈竞猜自动战斗不会触发本地表加载。
2. 提供历史对局的双方真实面板、御魂、乱斗点数和技能等级后重跑 P6。若要通过计划中两项阈值，应以改进真实战斗输入或规则为目标，不对这 26 个标签单独拟合。
3. 对照一场带记录的实战补齐队列切换、额外行动供火时机和剩余式神专属机制。

运行时反汇编、动态数据抓取和校准文件在 `desktop/out/duel-fidelity/`；该目录是本机工作产物，不应当作源码提交数据。

