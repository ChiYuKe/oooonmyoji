import type { ContentRegistry } from './registry';
import type { EffectCommand, SourceRef } from '../core/types';
import { soulsEnabled } from '../core/soul-eligibility';

export const roundaboutIds = { soul: 'soul:300012' } as const;

/** 轮入道 schedules a typed extra turn at the end of the wearer's turn, with the legacy 20% chance. */
export function registerRoundabout(registry: ContentRegistry): void {
  registry.registerSoul({ id: roundaboutIds.soul, mechanicsCoverage: 'verified', handlers: {
    'turn-end': { priority: 150, handle(context, event) {
      if (event.type !== 'turn-ended') return;
      const wearer = context.getUnit(event.unitId);
      if (!wearer || wearer.hp <= 0 || wearer.soulId !== roundaboutIds.soul || !soulsEnabled(wearer)
        || context.random() >= .2) return;
      const source: SourceRef = { kind: 'soul', id: roundaboutIds.soul, unitId: wearer.unitId };
      const command: EffectCommand = { type: 'schedule-turn', source, unitId: wearer.unitId,
        scheduling: 'extra-turn', selection: 'action-gauge', parentEventId: event.eventId };
      return [command];
    } },
  } });
}
