import type { ContentRegistry } from './registry';
import { soulsEnabled } from '../core/soul-eligibility';
import { attemptControl } from '../mechanics/control';

export const returnIncenseIds = {
  soul: 'soul:300039',
  stun: 'status.soul.300039.stun',
} as const;

/** 返魂香's proc is migrated; cross-content stun reactions remain partial. */
export function registerReturnIncense(registry: ContentRegistry): void {
  registry.registerStatus({ id: returnIncenseIds.stun, mechanicsCoverage: 'partial', category: 'control',
    dispellable: true, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  registry.registerSoul({
    id: returnIncenseIds.soul,
    mechanicsCoverage: 'partial',
    handlers: {
      hit: { priority: 45, handle(context, event) {
        if (event.type !== 'damage' || !event.source.unitId) return;
        const wearer = context.getUnit(event.targetId);
        const attacker = context.getUnit(event.source.unitId);
        if (!wearer || wearer.soulId !== returnIncenseIds.soul || !soulsEnabled(wearer) || !attacker || attacker.hp <= 0) return;
        const taunted = wearer.statuses.some(status => context.getStatusCategory(status.statusId) === 'control'
          && status.values?.controlType === '嘲讽');
        const procChance = taunted ? .1 : .25;
        if (context.random() >= procChance) return;
        const source = { kind: 'soul' as const, id: returnIncenseIds.soul, unitId: wearer.unitId };
        const command = attemptControl(context, { attemptId: `${returnIncenseIds.stun}:${event.eventId}`,
          source, targetId: attacker.unitId, statusId: returnIncenseIds.stun, controlType: '眩晕', baseChance: procChance,
          duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId: event.eventId,
          scopeId: `return-incense:${event.eventId}` });
        return command ? [command] : undefined;
      } },
    },
  });
}
