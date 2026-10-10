import { calculateDamage, type CalculatedDamage } from './damage';
import { INDIRECT_REDUCE_VALUE } from './game-damage';
import type { StatusDefinition } from '../core/definitions';

export interface IndirectDamageInput {
  readonly attack: number;
  readonly defense: number;
  readonly defenseIgnore?: number;
  readonly ratio: number;
  readonly critDamage: number;
  /**
   * 目标的「间接伤害层数」`getIndirectBuffLv()`（= 各 `indirectDmgType=1` buff 的等级之和，
   * 见 `indirectBuffLv()`）。传了就按客户端 `indirectDamageCalc` 追加
   * `ignoreDefenseValue += 层数 × INDIRECT_REDUCE_VALUE`。
   */
  readonly layers?: number;
}

/**
 * 间接伤害：**无条件暴击**。
 * 依据 `calcRawAttackDmg.txt:1328-1344`：
 *     1328-1330  LOAD calcDmgParam.isIndirectDamage
 *     1340       POP_JUMP_FORWARD → 1364        # 为假则跳过
 *     1342-1344  critical = True                 # ★ 间接伤害直接把 critical 置真
 * （原实现写成"有效防御为 0 时才暴击"，是误读 —— 客户端与有效防御无关。）
 * 注：`defenseIgnore` 的实际用途是降低本次伤害的防御；层数加成
 * （`INDIRECT_REDUCE_VALUE × getIndirectBuffLv()`）见 `indirectDefenseReduction`。
 */
export function calculateIndirectDamage(input: IndirectDamageInput, random: () => number): CalculatedDamage {
  // indirectDamageCalc 656-744：`calcDmgParam.ignoreDefenseValue += getIndirectBuffLv() × INDIRECT_REDUCE_VALUE`
  const layerBonus = Math.max(0, input.layers ?? 0) * INDIRECT_REDUCE_VALUE;
  const defenseIgnore = layerBonus > 0 ? (input.defenseIgnore ?? 0) + layerBonus : input.defenseIgnore;
  return calculateDamage({ ...input, ...(defenseIgnore === undefined ? {} : { defenseIgnore }), critChance: 1 }, random);
}

/**
 * 目标身上的「间接伤害层数」`getIndirectBuffLv()`：
 * 各状态的 `values.indirectDamageLevel`（应用时从 `StatusDefinition.indirectDamageLevel` 抄入）× 层数求和。
 * 客户端判据是 buff 数据字段 `indirectDmgType != 0`（`table_DATA_BUFF.json` 里 48 条），见 `game-damage.ts` 的注释。
 *
 * ⚠️ 别和 **DOT（持续伤害）** 混为一谈 —— 第 32 轮核对过：所有 DOT 家族
 * （`[2601]` 清姬 / `[2623]` 姑获鸟 / `[2612]` 镰鼬 / `[2533]` 吸血姬 / `[2103]` / `[2063]` / `[2023]`）
 * 的 `indirectDmgType` **都是 0**（少数混合行除外）⇒ DOT **不是**间接伤害，
 * 它走 `buffCalc` 那条路（`mechanics/continue-hurt.ts`），与本文件的"层数"是两套概念。
 */
export function indirectBuffLv(unit: { readonly statuses: readonly { readonly stacks: number;
  readonly values?: Readonly<Record<string, number | string | boolean>> }[] }): number {
  let total = 0;
  for (const status of unit.statuses) {
    const level = status.values?.indirectDamageLevel;
    if (typeof level !== 'number' || !Number.isFinite(level) || level === 0) continue;
    total += level * Math.max(0, status.stacks);
  }
  return total;
}

/** 间接攻击额外无视的防御 = `getIndirectBuffLv() × INDIRECT_REDUCE_VALUE`（indirectDamageCalc 656-744）。 */
export function indirectDefenseReduction(unit: Parameters<typeof indirectBuffLv>[0]): number {
  return indirectBuffLv(unit) * INDIRECT_REDUCE_VALUE;
}

/**
 * `const.Immunity.DEBUFF_INDIRECT`：目标声明了 `indirectDamageImmune` 时，整次间接攻击
 * **不产生伤害**（`indirectDamageCalc.txt` 在 `checkDamageAvoided` 之后判定）。
 * 内容侧在调用 `context.calculateDamage({ isIndirectDamage: true, … })` 之前先查它即可。
 */
export function indirectDamageImmune(unit: { readonly statuses: readonly { readonly statusId: string }[] },
  resolveStatus?: (statusId: string) => StatusDefinition | undefined): boolean {
  if (!resolveStatus) return false;
  return unit.statuses.some(status => resolveStatus(status.statusId)?.indirectDamageImmune === true);
}
