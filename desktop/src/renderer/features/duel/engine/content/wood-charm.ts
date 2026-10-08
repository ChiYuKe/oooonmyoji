import type { ContentRegistry } from './registry';
import { soulsEnabled } from '../core/soul-eligibility';

export const woodCharmIds = {
  soul: 'soul:300023',
  triggerStatus: 'status.soul.300023.trigger-limit',
} as const;

/** 木魅: one successful fire reduction per attacker's action, with taunt-adjusted odds. */
export function registerWoodCharm(registry: ContentRegistry): void {
  registry.registerStatus({ id: woodCharmIds.triggerStatus, mechanicsCoverage: 'verified', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerSoul({
    id: woodCharmIds.soul,
    mechanicsCoverage: 'verified',
    handlers: {
      hit: { priority: 40, handle(context, event) {
        if (event.type !== 'damage' || event.amount <= 0 || event.actionId === undefined || !event.source.unitId) return;
        const attacker = context.getUnit(event.source.unitId);
        const target = context.getUnit(event.targetId);
        if (!attacker || !target || (context.state.resources[attacker.side]?.fire ?? 0) <= 0) return;
        const alreadyTriggered = attacker.statuses.some(status => status.statusId === woodCharmIds.triggerStatus
          && Number(status.values?.actionId) === event.actionId);
        if (alreadyTriggered) return;

        const taunted = target.statuses.some(status => context.getStatusCategory(status.statusId) === 'control'
          && status.values?.controlType === '嘲讽');
        for (const wearer of context.getLivingUnits(target.side)) {
          if (wearer.soulId !== woodCharmIds.soul || !soulsEnabled(wearer)) continue;
          if (context.random() >= (taunted ? .1 : .25)) continue;
          const source = { kind: 'soul' as const, id: woodCharmIds.soul, unitId: wearer.unitId };
          return [
            { type: 'change-resource' as const, source, side: attacker.side, resourceId: 'fire', amount: -1, parentEventId: event.eventId },
            { type: 'add-status' as const, source, targetId: attacker.unitId, parentEventId: event.eventId,
              instance: { instanceId: `${woodCharmIds.triggerStatus}:${attacker.unitId}:${event.actionId}`,
                statusId: woodCharmIds.triggerStatus, source, stacks: 1, duration: { kind: 'permanent' as const },
                values: { actionId: event.actionId } } },
          ];
        }
      } },
      'turn-end': { priority: 40, handle(_context, event) {
        if (event.type !== 'turn-ended') return;
        return [{ type: 'remove-statuses', source: { kind: 'system', id: 'wood-charm.action-cleanup' },
          targetId: event.unitId, statusIds: [woodCharmIds.triggerStatus], reason: 'consumed', parentEventId: event.eventId }];
      } },
    },
  });
}
