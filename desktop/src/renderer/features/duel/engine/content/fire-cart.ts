import type { ContentRegistry } from './registry';
import type { SourceRef, StatusInstance } from '../core/types';
import { soulsEnabled } from '../core/soul-eligibility';

export const fireCartIds = {
  soul: 'soul:300085',
  graveFire: 'status.soul.300085.grave-fire',
  discount: 'status.soul.300085.discount',
} as const;

/** 火之车 gains one Grave Fire at each turn end; four stacks schedule an extra turn. */
export function registerFireCart(registry: ContentRegistry): void {
  registry.registerStatus({ id: fireCartIds.graveFire, mechanicsCoverage: 'verified', category: 'mark', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', stackScope: 'source-unit', maxStacks: 3 });
  registry.registerStatus({ id: fireCartIds.discount, mechanicsCoverage: 'verified', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace', policyResourceBonus: { resourceId: 'fire', amount: 1 },
    modifyResourceCost(_state, _actor, _skill, cost) {
      return cost.resourceId === 'fire' ? Math.max(0, cost.amount - 1) : cost.amount;
    } });
  registry.registerSoul({ id: fireCartIds.soul, mechanicsCoverage: 'verified', handlers: {
    'turn-end': { priority: 150, handle(context, event) {
      if (event.type !== 'turn-ended') return;
      const wearer = context.getUnit(event.unitId);
      if (!wearer || wearer.hp <= 0 || wearer.soulId !== fireCartIds.soul || !soulsEnabled(wearer)) return;
      const source = fireCartSource(wearer.unitId);
      const stacks = wearer.statuses.filter(status => status.statusId === fireCartIds.graveFire
        && status.source.unitId === wearer.unitId).reduce((sum, status) => sum + status.stacks, 0);
      if (stacks < 3) {
        const instance: StatusInstance = { instanceId: `${fireCartIds.graveFire}:${wearer.unitId}`,
          statusId: fireCartIds.graveFire, source, stacks: 1, duration: { kind: 'permanent' } };
        return [{ type: 'add-status', source, targetId: wearer.unitId, instance, parentEventId: event.eventId }];
      }
      return [
        { type: 'remove-statuses', source, targetId: wearer.unitId, statusIds: [fireCartIds.graveFire],
          reason: 'consumed', parentEventId: event.eventId },
        { type: 'add-status', source, targetId: wearer.unitId, instance: {
          instanceId: `${fireCartIds.discount}:${wearer.unitId}:${event.eventId}`, statusId: fireCartIds.discount,
          source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
        }, parentEventId: event.eventId },
        { type: 'schedule-turn', source, unitId: wearer.unitId, scheduling: 'extra-turn', selection: 'action-gauge',
          parentEventId: event.eventId },
      ];
    } },
  } });
}

function fireCartSource(unitId: string): SourceRef {
  return { kind: 'soul', id: fireCartIds.soul, unitId };
}
