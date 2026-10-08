import type { ContentRegistry } from './registry';
import { soulsEnabled } from '../core/soul-eligibility';

export const fortuneCatIds = {
  soul: 'soul:300010',
} as const;

/** 50% chance to gain two fire at the wearer's turn start, capped by the side's fire limit. */
export function registerFortuneCat(registry: ContentRegistry): void {
  registry.registerSoul({
    id: fortuneCatIds.soul,
    mechanicsCoverage: 'verified',
    handlers: {
      'turn-start': { priority: 20, handle(context, event) {
        if (event.type !== 'turn-started') return;
        const wearer = context.getUnit(event.unitId);
        if (!wearer || wearer.soulId !== fortuneCatIds.soul || !soulsEnabled(wearer) || context.random() >= .5) return;
        const currentFire = Math.max(0, context.state.resources[wearer.side]?.fire ?? 0);
        const gained = Math.max(0, Math.min(8, currentFire + 2) - currentFire);
        if (gained === 0) return;
        return [{ type: 'change-resource', source: { kind: 'soul', id: fortuneCatIds.soul, unitId: wearer.unitId },
          side: wearer.side, resourceId: 'fire', amount: gained, parentEventId: event.eventId }];
      } },
    },
  });
}
