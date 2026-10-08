import type { ContentRegistry } from './registry';
import { soulsEnabled } from '../core/soul-eligibility';

export const dawnlessDuskIds = { soul: 'soul:300013' } as const;

/** 日女巳时's action-bar push is migrated; some legacy display-only marks still lack typed categories. */
export function registerDawnlessDusk(registry: ContentRegistry): void {
  registry.registerSoul({
    id: dawnlessDuskIds.soul,
    mechanicsCoverage: 'partial',
    handlers: {
      hit: { priority: 55, handle(context, event) {
        if (event.type !== 'damage' || !event.source.unitId) return;
        const attacker = context.getUnit(event.source.unitId);
        const target = context.getUnit(event.targetId);
        if (!attacker || attacker.soulId !== dawnlessDuskIds.soul || !soulsEnabled(attacker) || !target || target.hp <= 0) return;
        const hasBuffOrMark = target.statuses.some(status => {
          const category = context.getStatusCategory(status.statusId);
          return category === 'buff' || category === 'mark' || category === 'shield'
            || status.modifiers?.some(modifier => modifier.amount > 0) === true;
        });
        if (context.random() >= (hasBuffOrMark ? .3 : .2)) return;
        return [{ type: 'change-action-gauge', source: { kind: 'soul', id: dawnlessDuskIds.soul, unitId: attacker.unitId },
          targetId: target.unitId, amount: -30, parentEventId: event.eventId }];
      } },
    },
  });
}
