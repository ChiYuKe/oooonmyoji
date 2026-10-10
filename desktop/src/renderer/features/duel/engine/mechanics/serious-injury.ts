/**
 * 游戏侧「重伤溢伤回流」的忠实移植 —— `make_serious_injury_overflow_value_defense`
 * （证据：`yys-lineup/out/disasm/com_utils_formula/make_serious_injury_overflow_value_defense.txt`，
 *  按指令顺序逐条；该文件只有 63 行，无跳转歧义）。
 *
 *   2-16    if overflow_value <= 0: return overflow_value
 *  18-98    overflow_value *= const.DEFENSE_CORRECT_FACTOR / (K + record_defense)
 *           （record_defense 为 0 时 K/(K+0)=1，等效于不处理）
 * 104-142   overflow_value /= (1 + record_hurt_reduction_rate)
 * 144-182   overflow_value /= (1 + record_indirect_hurt_reduction_rate)
 * 184-216   reduce_rate = record_target_hp_change_reduce_rate
 *           overflow_value *= (1 - reduce_rate)
 * 220-222   return overflow_value
 *
 * 语义：重伤（玄血）命中时 `calcRawAttackDmg` 把直接伤害按 `def = 0` 计并记下 `record_*`，
 * **超过玄血的那部分溢伤**在回流时必须把这些被跳过的乘区补回来 —— 先按真实防御
 * `K/(K+def)` 折算，再回放三种减伤率。详见 README-game-battle.md 的重伤一节与
 * `DISASM-JUMP-TARGETS.md`（"谁被清零"的极性由本函数的消费方式证明）。
 */

export interface SeriousInjuryRecord {
  /** `calcRawAttackDmg` 记账的"清零前防御"；缺省/0 ⇒ 该步等效于 ×1 */
  recordDefense?: number;
  /** 第 4 步（目标侧减伤）里被推迟的率 */
  recordHurtReductionRate?: number;
  /** 间接伤害的减伤率 */
  recordIndirectHurtReductionRate?: number;
  /** 目标"生命变化削减率"（溢伤专用） */
  recordTargetHpChangeReduceRate?: number;
}

/** `make_serious_injury_overflow_value_defense` 的纯函数版本。 */
export function seriousInjuryOverflowValue(overflowValue: number, record: SeriousInjuryRecord = {},
  defenseCorrectFactor = 300): number {
  let value = Number.isFinite(overflowValue) ? overflowValue : 0;
  if (value <= 0) return value;
  const defense = Number.isFinite(record.recordDefense) ? Math.max(0, record.recordDefense!) : 0;
  const denominator = defenseCorrectFactor + defense;
  if (denominator !== 0) value *= defenseCorrectFactor / denominator;
  const hurtReduction = Number.isFinite(record.recordHurtReductionRate) ? record.recordHurtReductionRate! : 0;
  value /= 1 + hurtReduction;
  const indirectReduction = Number.isFinite(record.recordIndirectHurtReductionRate)
    ? record.recordIndirectHurtReductionRate! : 0;
  value /= 1 + indirectReduction;
  const hpChangeReduce = Number.isFinite(record.recordTargetHpChangeReduceRate)
    ? record.recordTargetHpChangeReduceRate! : 0;
  value *= 1 - hpChangeReduce;
  return value;
}
