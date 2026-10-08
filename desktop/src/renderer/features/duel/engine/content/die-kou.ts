import type { ContentRegistry } from './registry';
import type { BattleState, UnitState } from '../core/types';
import { soulsEnabled } from '../core/soul-eligibility';

export const dieKouIds = { soul: 'soul:300087' } as const;

/** 叠叩's unique four-piece effect reduces allied non-summons' critical bonus damage by 15%. */
export function registerDiekou(registry: ContentRegistry): void {
  registry.registerSoul({ id: dieKouIds.soul, mechanicsCoverage: 'verified',
    mechanicsCoverageNotes: ['仅当携带者初始暴击严格高于120%时生效；唯一效果，全体非召唤物友方受到的暴击伤害减免15%。'],
    modifyCriticalDamageTaken(wearer, target, amount, criticalBaseAmount, state) {
      if (target.side !== wearer.side || target.unitKind === 'summon') return amount;
      if (wearer.soulId !== dieKouIds.soul || wearer.stats.crit <= 1.2 || !soulsEnabled(wearer)) return amount;
      if (firstEligibleCarrier(state, wearer) !== wearer.unitId) return amount;
      return criticalBaseAmount + (amount - criticalBaseAmount) * .85;
    },
  });
}

function firstEligibleCarrier(state: Readonly<BattleState>, wearer: Readonly<UnitState>): string | undefined {
  return state.sides[wearer.side].map(unitId => state.units[unitId]).find(unit => unit && unit.hp > 0
    && unit.soulId === dieKouIds.soul && unit.stats.crit > 1.2 && soulsEnabled(unit))?.unitId;
}
