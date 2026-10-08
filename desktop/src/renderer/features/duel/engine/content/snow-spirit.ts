import type { ContentRegistry } from './registry';
import { soulsEnabled } from '../core/soul-eligibility';
import { attemptControl } from '../mechanics/control';

export const snowSpiritIds = {
  soul: 'soul:300002',
  freeze: 'status.soul.300002.freeze',
  slow: 'status.soul.300002.slow',
} as const;

/** 雪幽魂's on-hit freeze and defensive slow are migrated; cross-content control reactions remain partial. */
export function registerSnowSpirit(registry: ContentRegistry): void {
  registry.registerStatus({ id: snowSpiritIds.freeze, mechanicsCoverage: 'partial', category: 'control',
    dispellable: true, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  registry.registerStatus({ id: snowSpiritIds.slow, mechanicsCoverage: 'verified', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerSoul({
    id: snowSpiritIds.soul,
    mechanicsCoverage: 'partial',
    handlers: {
      hit: { priority: 47, handle(context, event) {
        if (event.type !== 'damage' || !event.source.unitId || event.amount <= 0) return;
        const attacker = context.getUnit(event.source.unitId);
        const target = context.getUnit(event.targetId);
        if (!attacker || !target) return;
        const commands = [];
        if (attacker.soulId === snowSpiritIds.soul && target.hp > 0 && soulsEnabled(attacker)) {
          const targetIsSlowed = target.statuses.some(status => status.modifiers?.some(modifier =>
            modifier.stat === 'speed' && modifier.amount < 0));
          const baseChance = targetIsSlowed ? .3 : .15;
          const source = { kind: 'soul' as const, id: snowSpiritIds.soul, unitId: attacker.unitId };
          const freeze = attemptControl(context, { attemptId: `${snowSpiritIds.freeze}:${event.eventId}`, source,
            targetId: target.unitId, statusId: snowSpiritIds.freeze, controlType: '冰冻', baseChance,
            duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId: event.eventId,
            scopeId: `snow-spirit:${event.eventId}` });
          if (freeze) commands.push(freeze);
        }
        if (target.soulId === snowSpiritIds.soul && attacker.hp > 0 && soulsEnabled(target)) {
          const source = { kind: 'soul' as const, id: snowSpiritIds.soul, unitId: target.unitId };
          commands.push({ type: 'add-status' as const, source, targetId: attacker.unitId, parentEventId: event.eventId,
            instance: { instanceId: `${snowSpiritIds.slow}:${attacker.unitId}:${event.eventId}`, statusId: snowSpiritIds.slow,
              source, stacks: 1, duration: { kind: 'count' as const, remaining: 1, owner: 'target-turn' as const },
              modifiers: [{ stat: 'speed' as const, operation: 'flat' as const, amount: -30 }] } });
        }
        return commands;
      } },
    },
  });
}
