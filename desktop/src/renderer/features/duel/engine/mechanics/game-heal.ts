/**
 * 游戏侧「治疗」的忠实移植 —— 对照 `com/utils/formula.py` 的 `_calcCure` / `doCureAbsord`
 * 反汇编（证据：`yys-lineup/out/disasm/com_utils_formula/_calcCure.txt`，下面按 STORE 顺序逐条标注）。
 *
 * `_calcCure(fromEntity, targetEntity, cureValue, engine)`：
 *     0-46    if helpers.isShieldEntity(targetEntity): return <tuple>      # 护盾实体不走常规治疗
 *    48-60    engine = fromEntity.battleEngine
 *    62-110   stren = fromEntity.AttrComp.cureStrenthRate
 *                     + targetEntity.AttrComp.curedStrenthRate             # ★ 两边率"相加"
 *   112-140   equidValue = cureValue * fromEntity.AttrComp.equipCureStrenthRate
 *                                                                          # ★ 御魂治疗强度是 cureValue×rate 的加项
 *   142-176   cureValue *= (1 + targetEntity.AttrComp.PvpCuredStrenthRate)
 *   178-192   cureValue *= (1 + stren)
 *   194-202   cureValue += equidValue
 *   204-284   campdata = targetEntity.battleEngine.getCampData(targetEntity.camp)
 *             cureValue *= campdata.cureRate                               # ★ 取**目标**阵营
 *   286-300   if cureValue < 1: cureValue = 1                             # 下限（不是 0）
 *   302-376   critical = simpleRandResult(fromEntity.AttrComp.critRate, engine.random)[0]
 *   378-416   critical = getattr(fromEntity, 'hero_no_crit', False) → False
 *   418-456   if critical: cureValue *= (1 + fromEntity.AttrComp.critPower)   # 治疗暴击不吃抗暴
 *   458-492   cureValue = doCureAbsord(fromEntity, targetEntity, cureValue)
 *   494-518   battle_cure_stat(...)
 *   530-536   return (cureValue, critical)
 *
 * `doCureAbsord`（`doCureAbsord.txt`）：SUFFER 类 buff 的 `baseCureAbsord` 池子吃掉治疗，
 * 池子耗尽则移除 buff（与引擎 `StatusDefinition.healingAbsorption` /
 * `values.healingAbsorptionRemaining` 的语义一致）：
 *      8-14    if cure_value <= 0: return cure_value
 *    144-224   for buff: if buff.baseCureAbsord > 0 and buff.buffType == BuffType.SUFFER:
 *                 if buff.baseCureAbsord <= cure_value: cure_value -= buff.baseCureAbsord; buff.baseCureAbsord = 0
 *                 else: buff.baseCureAbsord -= cure_value; cure_value = 0
 *    552-566   if cure_value <= 0: break
 *    570-622   移除耗尽池子的 buff；return cure_value
 *
 * 注意 `_calcCure` 里 `cureStrenthRate` 与 `curedStrenthRate` 是**相加**后按 `(1 + stren)` 乘，
 * 不是「除以(1+受治疗强度)」；`equipCureStrenthRate` 也不是乘区而是 cureValue 的线性加项。
 */

/** 治疗下限（_calcCure 偏移 286-300）。 */
export const CURE_MIN_VALUE = 1;

/** 单位上的治疗相关属性（对应 AttrComp 的四个字段 + hero_no_crit）。 */
export interface CureAttributes {
  /** 作为治疗方：`AttrComp.cureStrenthRate` */
  cureStrengthRate?: number;
  /** 作为治疗方：`AttrComp.equipCureStrenthRate`（御魂治疗强度，按 cureValue 的比率加算） */
  equipCureStrengthRate?: number;
  /** 作为被治疗方：`AttrComp.curedStrenthRate` */
  curedStrengthRate?: number;
  /** 作为被治疗方：`AttrComp.PvpCuredStrenthRate`（PVP 专用受治疗强度） */
  pvpCuredStrengthRate?: number;
  /** `getattr(fromEntity, 'hero_no_crit', False)`：为真则治疗不能暴击 */
  heroNoCrit?: boolean;
}

export interface GameCureInput {
  /** 技能/效果给出的基础治疗量（进管线前，已按技能等级取值） */
  cureValue: number;
  cureStrengthRate?: number;
  equipCureStrengthRate?: number;
  curedStrengthRate?: number;
  pvpCuredStrengthRate?: number;
  /** `getCampData(target.camp).cureRate`，缺省 1 */
  campCureRate?: number;
  /** 治疗方 `AttrComp.critRate`（与面板暴击同源） */
  critRate?: number;
  /** 面板**总**暴伤倍率：游戏侧 `(1 + critPower)`，引擎 stat 口径即 `critDamage` */
  critDamage?: number;
  heroNoCrit?: boolean;
  random: () => number;
}

export interface GameCureResult {
  cureValue: number;
  critical: boolean;
}

/** `_calcCure` 的数值部分（不含 doCureAbsord，吸收由 effects 的 healingAbsorption 处理）。 */
export function calcCure(input: GameCureInput): GameCureResult {
  let cure = Number.isFinite(input.cureValue) ? input.cureValue : 0;
  const stren = (input.cureStrengthRate ?? 0) + (input.curedStrengthRate ?? 0);
  const equipValue = cure * (input.equipCureStrengthRate ?? 0);
  cure *= 1 + (input.pvpCuredStrengthRate ?? 0);
  cure *= 1 + stren;
  cure += equipValue;
  cure *= input.campCureRate ?? 1;
  if (cure < CURE_MIN_VALUE) cure = CURE_MIN_VALUE;
  let critical = input.random() < (input.critRate ?? 0);
  if (input.heroNoCrit) critical = false;
  if (critical) cure *= input.critDamage ?? 1;
  return { cureValue: cure, critical };
}

/**
 * `doCureAbsord` 的纯函数版本（用于做单元测试与内容侧预估）。
 * 传入各吸收池的剩余量，返回剩余治疗、各池的消耗与耗尽的下标。
 */
export function applyCureAbsorb(cureValue: number, absorbs: readonly number[]):
{ cureValue: number; consumed: number[]; depleted: boolean[] } {
  let remaining = Math.max(0, Number.isFinite(cureValue) ? cureValue : 0);
  const consumed = absorbs.map(() => 0);
  const depleted = absorbs.map(() => false);
  if (remaining <= 0) return { cureValue: remaining, consumed, depleted };
  for (let index = 0; index < absorbs.length && remaining > 0; index++) {
    const pool = Math.max(0, absorbs[index] ?? 0);
    if (pool <= 0) continue;
    if (pool <= remaining) {
      consumed[index] = pool;
      remaining -= pool;
      depleted[index] = true;
    } else {
      consumed[index] = remaining;
      remaining = 0;
    }
  }
  return { cureValue: remaining, consumed, depleted };
}
