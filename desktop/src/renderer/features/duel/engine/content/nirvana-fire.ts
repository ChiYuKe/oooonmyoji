import type { ContentRegistry } from './registry';
import { soulsEnabled } from '../core/soul-eligibility';

export const nirvanaFireIds = {
  soul: 'soul:300006',
} as const;

/** Restores HP after the wearer's action while below the catalogued threshold. */
export function registerNirvanaFire(registry: ContentRegistry): void {
  registry.registerSoul({
    id: nirvanaFireIds.soul,
    mechanicsCoverage: 'verified',
    handlers: {
      'action-end': { priority: 30, handle(context, event) {
        if (event.type !== 'action-ended' || !event.soulTriggersAllowed || !event.source.unitId) return;
        const wearer = context.getUnit(event.source.unitId);
        if (!wearer || wearer.hp <= 0 || wearer.soulId !== nirvanaFireIds.soul || !soulsEnabled(wearer)
          || wearer.hp / Math.max(1, wearer.stats.hp) >= .3) return;
        return [{ type: 'restore-health', source: { kind: 'soul', id: nirvanaFireIds.soul, unitId: wearer.unitId },
          targetId: wearer.unitId, amount: wearer.stats.hp * .15, parentEventId: event.eventId }];
      } },
    },
  });
}
