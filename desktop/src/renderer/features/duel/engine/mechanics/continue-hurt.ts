/**
 * 游戏侧「持续伤害（DOT / continue hurt）」的忠实移植 —— 对照 `com/utils/formula.py` 的
 * `buffCalc` 反汇编（证据：`yys-lineup/out/disasm/com_utils_formula/buffCalc.txt`）。
 *
 * 关键指令（STORE/ATTR 顺序可靠，跳转目标不可信见 DISASM-JUMP-TARGETS.md）：
 *  138-154  仅当 buff 的 `continueHurt > 0` 或 `continueAttackHurt > 0` 才结算
 *  178-200  `if checkDamageAvoided(fromEntity, targetEntity, skillCalcResult): return`
 *           （另有 `const.Immunity.CONTINUE_HURT in target.immunity` 的免疫判定）
 *  324-428  hpChange = min(
 *                targetEntity.AttrComp.hp   × continueHurt,        # 按目标**当前生命**的百分比
 *                fromEntity.AttrComp.attack × CONTINUE_HURT_LIMIT) # ★ 上限 = 攻击 × 1.0
 *           （另一支按 `continueAttackHurt`：fromEntity.attack × continueAttackHurt，同样受该上限约束）
 *  430-432  critical = False                                        # ★ DOT 永不暴击
 *  434+     用 `CalcRawAttackDmgRecord` / `CalcDamageParam.attackReplace` 把上面的值当作"攻击"
 *           送进 `calcRawAttackDmg` ⇒ **复用完整伤害管线**（防御 K/(K+def)、增伤、减伤、
 *           `doFixedReduction`、护盾 `calcShieldAbsorb`、玄血 `calcExtHpAbsorb`）
 *  其它     `int(targetHpChange)` 截断、`_afterBuffCalc` / `doSkillCalc` / `AfterFinalSkillCalc` 事件、
 *           `BATTLE_DETAIL_TYPE.BUFF_DAMAGE` 记账
 *
 * ⇒ 引擎侧正确做法：先把 DOT 的基础值算成"攻击"，再走 `context.calculateDamage({ attack: 基础值, … })`，
 * 而不是直接给 `deal-damage` 一个终值（否则会跳过防御/减伤/护盾/玄血）。
 */

/** `const.CONTINUE_HURT_LIMIT`（`table_CONST.json` = 1.0）：DOT 上限 = 攻击方攻击 × 此值。 */
export const CONTINUE_HURT_LIMIT = 1.0;

import type { BattleContext, EffectCommand, SourceRef, UnitId } from '../core/types';
import type { StatusDefinition } from '../core/definitions';

export interface ContinueHurtInput {
  /** 目标**当前**生命（`AttrComp.hp`，不是上限） */
  targetHp: number;
  /** 攻击方攻击（`fromEntity.AttrComp.attack`） */
  sourceAttack: number;
  /** buff 的 `continueHurt`：按目标当前生命的比例（与 attackRatio 二选一） */
  percentOfTargetHp?: number;
  /** buff 的 `continueAttackHurt`：按攻击方攻击的比例（与 percentOfTargetHp 二选一） */
  attackRatio?: number;
  /** 覆盖上限倍率，缺省用 `CONTINUE_HURT_LIMIT` */
  limit?: number;
}

export interface ContinueHurtResult {
  /** 送进伤害管线前的"攻击"值（已经过 CONTINUE_HURT_LIMIT 上限） */
  baseDamage: number;
  /** 上限截断前的原始值，便于记账/调试 */
  rawValue: number;
  /** 是否被上限截断 */
  capped: boolean;
}

/** `buffCalc` 324-428：算出 DOT 的基础伤害（后续必须再走一遍伤害管线）。 */
export function calcContinueHurt(input: ContinueHurtInput): ContinueHurtResult {
  const targetHp = Number.isFinite(input.targetHp) ? Math.max(0, input.targetHp) : 0;
  const sourceAttack = Number.isFinite(input.sourceAttack) ? Math.max(0, input.sourceAttack) : 0;
  const percent = input.percentOfTargetHp;
  const ratio = input.attackRatio;
  const rawValue = typeof percent === 'number' && Number.isFinite(percent) && percent !== 0
    ? targetHp * percent
    : sourceAttack * (typeof ratio === 'number' && Number.isFinite(ratio) ? ratio : 0);
  const limitValue = sourceAttack * (input.limit ?? CONTINUE_HURT_LIMIT);
  const baseDamage = Math.min(rawValue, limitValue);
  return { baseDamage, rawValue, capped: baseDamage < rawValue };
}

export interface ContinueHurtCommandOptions {
  source: SourceRef;
  targetId: UnitId;
  /** buff 的 `continueHurt`（按目标当前生命） */
  percentOfTargetHp?: number;
  /** buff 的 `continueAttackHurt`（按攻击方攻击） */
  attackRatio?: number;
  damageKind?: 'normal' | 'true';
  parentEventId?: string;
  /** 用来检查 `StatusDefinition.continueHurtImmune`；不传则不做免疫检查 */
  resolveStatus?: (statusId: string) => StatusDefinition | undefined;
}

/**
 * `const.Immunity.CONTINUE_HURT`：目标身上有声明 `continueHurtImmune` 的状态时，
 * 整次 DOT 不结算（`buffCalc.txt`：`checkDamageAvoided` 之后紧跟该免疫判定）。
 */
export function continueHurtImmune(unit: { readonly statuses: readonly { readonly statusId: string }[] },
  resolveStatus?: (statusId: string) => StatusDefinition | undefined): boolean {
  if (!resolveStatus) return false;
  return unit.statuses.some(status => resolveStatus(status.statusId)?.continueHurtImmune === true);
}

/**
 * 生成一次 DOT 结算的 `deal-damage` 命令：先按 `calcContinueHurt` 得到"攻击"值，
 * 再用 `context.calculateDamage` 走完整伤害管线（防禦/增伤/减伤/护盾/玄血），并且**永不暴击**。
 * 内容侧的 tick handler（例如持有者回合开始）直接 return 这个命令即可。
 */
export function continueHurtCommand(context: BattleContext, options: ContinueHurtCommandOptions):
EffectCommand | undefined {
  const target = context.getUnit(options.targetId);
  if (!target || target.hp <= 0) return undefined;
  if (continueHurtImmune(target, options.resolveStatus)) return undefined;
  const attacker = options.source.unitId ? context.getUnit(options.source.unitId) : undefined;
  const sourceAttack = attacker ? (context.getEffectiveStats(attacker.unitId)?.attack ?? 0) : 0;
  const { baseDamage } = calcContinueHurt({ targetHp: target.hp, sourceAttack,
    percentOfTargetHp: options.percentOfTargetHp, attackRatio: options.attackRatio });
  if (baseDamage <= 0) return undefined;
  const defense = context.getEffectiveStats(target.unitId)?.defense ?? 0;
  const hit = context.calculateDamage({ attack: baseDamage, defense, ratio: 1, critChance: 0, critDamage: 1,
    noCrit: true }, attacker ?? target, target);
  return { type: 'deal-damage', source: options.source, targetId: target.unitId, amount: hit.amount,
    isCritical: false, ...(options.damageKind ? { damageKind: options.damageKind } : {}),
    ...(options.parentEventId ? { parentEventId: options.parentEventId } : {}) };
}
