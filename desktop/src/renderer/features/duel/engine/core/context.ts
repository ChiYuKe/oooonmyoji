import { isUnitBanished, type BattleContext, type BattleState, type EffectCommand, type SideId, type UnitId, type UnitState } from './types';
import { effectiveCritResist, effectiveStats } from '../mechanics/stats';
import { calculateDamage } from '../mechanics/damage';
import { checkDodge } from '../mechanics/game-damage';
import type { DamageCalculationHooks } from './definitions';
import { skillNumber, type GameSkillRow } from '../../../../../shared/game-skill-data';

export interface CommandContext extends BattleContext {
  drainCommands(): EffectCommand[];
}

export function createBattleContext(state: BattleState, random: () => number,
  getStatusCategory: (statusId: string) => import('./types').StatusCategory | undefined = () => undefined,
  isStatusDispellable: (statusId: string) => boolean = () => false,
  isUnitUnableToAct: (unitId: UnitId) => boolean = () => false,
  damageHooks?: DamageCalculationHooks, skillRow?: GameSkillRow,
  actionGaugeChangeAllowed: (unitId: UnitId, amount: number) => boolean = () => true): CommandContext {
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
      const result = avoided ? { amount: 0, isCritical: false } : calculateDamage({ ...configured,
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
