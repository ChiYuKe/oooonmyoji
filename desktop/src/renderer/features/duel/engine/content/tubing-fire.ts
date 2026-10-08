import type { ContentRegistry } from './registry';
import type { EffectCommand, SourceRef } from '../core/types';
import { soulsEnabled } from '../core/soul-eligibility';

export const tubingFireIds = { soul: 'soul:300090' } as const;

/** 钓瓶火 adds one fire-meter step and heals the living ally with the lowest HP ratio for 700% DEF. */
export function registerTubingFire(registry: ContentRegistry): void {
  registry.registerSoul({ id: tubingFireIds.soul, mechanicsCoverage: 'verified', handlers: {
    'turn-end': { priority: 140, handle(context, event) {
      if (event.type !== 'turn-ended') return;
      const wearer = context.getUnit(event.unitId);
      if (!wearer || wearer.hp <= 0 || wearer.soulId !== tubingFireIds.soul || !soulsEnabled(wearer)) return;
      const livingAllies = context.getLivingUnits(wearer.side);
      if (livingAllies.length === 0) return;
      const recipient = livingAllies.reduce((lowest, unit) => unit.hp / Math.max(1, unit.stats.hp)
        < lowest.hp / Math.max(1, lowest.stats.hp) ? unit : lowest);
      const defense = context.getEffectiveStats(wearer.unitId)?.defense ?? wearer.stats.defense;
      const source: SourceRef = { kind: 'soul', id: tubingFireIds.soul, unitId: wearer.unitId };
      const commands: EffectCommand[] = [
        { type: 'advance-resource-meter', source, side: wearer.side, resourceId: 'fire', steps: 1, parentEventId: event.eventId },
        { type: 'heal', source, targetId: recipient.unitId, amount: defense * 7, parentEventId: event.eventId },
      ];
      return commands;
    } },
  } });
}
