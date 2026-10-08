import type { ContentRegistry } from './registry';
import { soulsEnabled } from '../core/soul-eligibility';

export const yinMoruoIds = {
  soul: 'soul:300027',
} as const;

/** Yin Moruo returns three fire when its wearer defeats an enemy unit. */
export function registerYinMoruo(registry: ContentRegistry): void {
  registry.registerSoul({
    id: yinMoruoIds.soul,
    mechanicsCoverage: 'verified',
    handlers: {
      'unit-defeated': { priority: 20, handle(context, event) {
        if (event.type !== 'unit-defeated' || event.defeatedBy?.kind === 'system' || !event.defeatedBy?.unitId) return;
        const wearer = context.getUnit(event.defeatedBy.unitId);
        const defeated = context.getUnit(event.unitId);
        if (!wearer || wearer.hp <= 0 || wearer.soulId !== yinMoruoIds.soul || !soulsEnabled(wearer)
          || !defeated || defeated.side === wearer.side) return;
        const fire = Math.max(0, context.state.resources[wearer.side]?.fire ?? 0);
        const gained = Math.max(0, Math.min(8, fire + 3) - fire);
        if (gained === 0) return;
        return [{ type: 'change-resource', source: { kind: 'soul', id: yinMoruoIds.soul, unitId: wearer.unitId },
          side: wearer.side, resourceId: 'fire', amount: gained, parentEventId: event.eventId }];
      } },
    },
  });
}
