import type { ContentRegistry } from './registry';
import { soulsEnabled } from '../core/soul-eligibility';
import { attemptControl } from '../mechanics/control';

export const bellSpiritIds = {
  soul: 'soul:300015',
  stun: 'status.soul.300015.stun',
} as const;

/** 钟灵's trigger is migrated; its stun aftermath remains partial with other content interactions. */
export function registerBellSpirit(registry: ContentRegistry): void {
  registry.registerStatus({ id: bellSpiritIds.stun, mechanicsCoverage: 'partial', category: 'control',
    dispellable: true, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  registry.registerSoul({
    id: bellSpiritIds.soul,
    mechanicsCoverage: 'partial',
    handlers: {
      hit: { priority: 46, handle(context, event) {
        if (event.type !== 'damage' || !event.source.unitId) return;
        const attacker = context.getUnit(event.source.unitId);
        const target = context.getUnit(event.targetId);
        if (!attacker || attacker.soulId !== bellSpiritIds.soul || !soulsEnabled(attacker) || !target || target.hp <= 0) return;
        const alreadyStunned = context.state.sides[attacker.side].some(unitId => context.getUnit(unitId)?.statuses.some(status =>
          status.values?.controlType === '眩晕'));
        const baseChance = alreadyStunned ? .1 : .2;
        const source = { kind: 'soul' as const, id: bellSpiritIds.soul, unitId: attacker.unitId };
        const command = attemptControl(context, { attemptId: `${bellSpiritIds.stun}:${event.eventId}`, source,
          targetId: target.unitId, statusId: bellSpiritIds.stun, controlType: '眩晕', baseChance,
          duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId: event.eventId,
          scopeId: `bell-spirit:${event.eventId}` });
        return command ? [command] : undefined;
      } },
    },
  });
}
