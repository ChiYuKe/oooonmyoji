import type { ContentRegistry } from './registry';
import { soulsEnabled } from '../core/soul-eligibility';

export const batWingIds = { soul: 'soul:300004' } as const;

/** 蝠翼 healing uses actual health lost; unusual no-recovery damage windows remain partial. */
export function registerBatWing(registry: ContentRegistry): void {
  registry.registerSoul({
    id: batWingIds.soul,
    mechanicsCoverage: 'partial',
    handlers: {
      hit: { priority: 60, handle(context, event) {
        if (event.type !== 'damage' || !event.source.unitId || event.hpLost <= 0) return;
        const wearer = context.getUnit(event.source.unitId);
        if (!wearer || wearer.soulId !== batWingIds.soul || !soulsEnabled(wearer)) return;
        return [{ type: 'heal', source: { kind: 'soul', id: batWingIds.soul, unitId: wearer.unitId },
          targetId: wearer.unitId, amount: event.hpLost * .2, parentEventId: event.eventId }];
      } },
    },
  });
}
