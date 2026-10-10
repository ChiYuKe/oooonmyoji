import { isUnitBanished, type BattleContext, type BattleState, type EffectCommand, type SideId, type UnitId, type UnitState } from './types';
import { effectiveCritResist, effectiveStats } from '../mechanics/stats';
import { calculateDamage } from '../mechanics/damage';
import { checkDodge } from '../mechanics/game-damage';
import { indirectDefenseReduction } from '../mechanics/indirect-damage';
import type { DamageCalculationHooks } from './definitions';
import { skillNumber, type GameSkillRow } from '../../../../../shared/game-skill-data';

export interface CommandContext extends BattleContext {
  drainCommands(): EffectCommand[];
}

/** 当前客户端运行时未直接暴露 RANGE_SKILLS；本地模拟按行动形态近似。 */
const RANGE_ACTION_SHAPES = new Set<string>(['all-enemies', 'all-allies', 'multi']);

export function createBattleContext(state: BattleState, random: () => number,
  getStatusCategory: (statusId: string) => import('./types').StatusCategory | undefined = () => undefined,
  isStatusDispellable: (statusId: string) => boolean = () => false,
  isUnitUnableToAct: (unitId: UnitId) => boolean = () => false,
  damageHooks?: DamageCalculationHooks, skillRow?: GameSkillRow,
  actionGaugeChangeAllowed: (unitId: UnitId, amount: number) => boolean = () => true,
  attackShape?: import('./types').ActionIntent['shape']): CommandContext {
  const commands: EffectCommand[] = [];
  return {
    state,
    getUnit(unitId: UnitId): UnitState | undefined { return state.units[unitId]; },
    getEffectiveStats(unitId: UnitId) {
      const unit = state.units[unitId];
      return unit ? effectiveStats(unit) : undefined;
    },
    getStatusCategory,
    isStatusDispellable,
    isUnitUnableToAct,
    actionGaugeChangeAllowed,
    getLivingUnits(side: SideId): readonly UnitState[] {
      return state.sides[side].map(unitId => state.units[unitId]).filter((unit): unit is UnitState => Boolean(unit && unit.hp > 0 && !isUnitBanished(unit)));
    },
    random,
    calculateDamage(input, attacker, target) {
      const skillInput = { ...input, dmgFluctuation: input.dmgFluctuation ?? skillNumber(skillRow, 'dmgFluctuation') };
      const configured = damageHooks?.before?.(skillInput, attacker, target, state) ?? skillInput;
      const avoided = checkDodge(target.damageAttributes?.dodge ?? 0, random);
      // AOE 打护盾实体：×AOE_SKILL_TO_SHIELD_DMG_RATE（calcRawAttackDmg.txt:2104-2180）。
      // isRangeSkill 的客户端口径是 isRangeSkill(skillData['selectRange'])；本地数据尚未闭合
      // RANGE_SKILLS 集合，因此仍用本次行动形态近似。执行技能时由 action-runner 显式传入当前 shape。
      const isRangeSkill = input.isRangeSkill ?? RANGE_ACTION_SHAPES.has(attackShape ?? state.activeAttackShape ?? '');
      const isShieldEntity = input.isShieldEntity ?? target.shieldEntity === true;
      // 间接攻击：`ignoreDefenseValue += getIndirectBuffLv() × INDIRECT_REDUCE_VALUE(=10)`
      // （indirectDamageCalc.txt:656-744，在 calcAttackDmg 之前累加）。
      const indirectReduction = configured.isIndirectDamage === true ? indirectDefenseReduction(target) : 0;
      const defenseReduction = indirectReduction > 0
        ? { ...configured.defenseReduction,
          ignoreDefenseValue: (configured.defenseReduction?.ignoreDefenseValue ?? 0) + indirectReduction }
        : configured.defenseReduction;
      const result = avoided ? { amount: 0, isCritical: false } : calculateDamage({ ...configured,
        isRangeSkill, isShieldEntity, ...(defenseReduction ? { defenseReduction } : {}),
        critResist: effectiveCritResist(target, configured.critResist ?? target.damageAttributes?.critResist ?? 0),
        targetHurtReductionRate: configured.targetHurtReductionRate ?? target.damageAttributes?.hurtReductionRate,
        seriousInjury: configured.seriousInjury ?? target.damageAttributes?.seriousInjury,
        hurtReductionRate: 0, fixedHurtReductionVal: 0 }, random);
      const damageOptions = Object.fromEntries(Object.entries({ ...result.damageOptions, hurtReductionRate: configured.hurtReductionRate,
        fixedHurtReductionVal: configured.fixedHurtReductionVal, seriousInjury: configured.seriousInjury ?? target.damageAttributes?.seriousInjury,
        ignoreShield: configured.ignoreShield, shieldDmgAddRate: configured.shieldDmgAddRate,
        leechRate: configured.leechRate, ...(avoided ? { avoided: true } : {}) }).filter(([, value]) => value !== undefined));
      return { ...result, amount: damageHooks?.after?.(result.amount, result.isCritical, attacker, target, state) ?? result.amount,
        ...(Object.keys(damageOptions).length ? { damageOptions } : {}) };
    },
    submit(command: EffectCommand): void { commands.push(command); },
    drainCommands(): EffectCommand[] { return commands.splice(0, commands.length); },
  };
}
