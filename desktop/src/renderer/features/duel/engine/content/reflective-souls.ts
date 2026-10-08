import type { ContentRegistry } from './registry';
import type { SourceRef } from '../core/types';
import { soulsEnabled } from '../core/soul-eligibility';
import { DEFENSE_CORRECT_FACTOR } from '../mechanics/game-damage';

export const reflectiveSoulIds = { mirrorLady: 'soul:300014', scar: 'soul:300018' } as const;

/** Reactive damage reflections. Specialized attacks that suppress soul reactions remain a known coverage gap. */
export function registerReflectiveSouls(registry: ContentRegistry): void {
  registry.registerSoul({ id: reflectiveSoulIds.mirrorLady, mechanicsCoverage: 'partial', handlers: {
    hit: { priority: 170, handle(context, event) {
      if (event.type !== 'damage' || event.attackId === undefined || !event.source.unitId) return;
      const attacker = context.getUnit(event.source.unitId);
      const wearer = context.getUnit(event.targetId);
      if (!attacker || attacker.hp <= 0 || !wearer || wearer.soulId !== reflectiveSoulIds.mirrorLady
        || !soulsEnabled(wearer) || context.random() >= .3) return;
      const source: SourceRef = { kind: 'soul', id: reflectiveSoulIds.mirrorLady, unitId: wearer.unitId };
      return [{ type: 'lose-life', source, targetId: attacker.unitId, amount: Math.min(attacker.hp, event.amount),
        parentEventId: event.eventId }];
    } },
  } });

  registry.registerSoul({ id: reflectiveSoulIds.scar, mechanicsCoverage: 'partial', handlers: {
    hit: { priority: 175, handle(context, event) {
      if (event.type !== 'damage' || event.attackId === undefined || !event.source.unitId) return;
      const attacker = context.getUnit(event.source.unitId);
      const wearer = context.getUnit(event.targetId);
      const wearerStats = wearer && context.getEffectiveStats(wearer.unitId);
      const attackerStats = attacker && context.getEffectiveStats(attacker.unitId);
      if (!attacker || attacker.hp <= 0 || !wearer || wearer.hp <= 0 || wearer.soulId !== reflectiveSoulIds.scar
        || !soulsEnabled(wearer) || !wearerStats || !attackerStats || context.random() >= .35) return;
      const amount = Math.max(1, wearerStats.attack * .125 * DEFENSE_CORRECT_FACTOR / (DEFENSE_CORRECT_FACTOR + Math.max(0, attackerStats.defense)));
      const source: SourceRef = { kind: 'soul', id: reflectiveSoulIds.scar, unitId: wearer.unitId };
      return [{ type: 'lose-life', source, targetId: attacker.unitId, amount, parentEventId: event.eventId }];
    } },
  } });
}
