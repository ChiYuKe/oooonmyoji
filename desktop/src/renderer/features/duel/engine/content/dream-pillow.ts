import type { ContentRegistry } from './registry';
import { soulsEnabled } from '../core/soul-eligibility';
import { attemptControl } from '../mechanics/control';
import { createSleepStatusDefinition, dreamEaterRetainsSleep } from './common-statuses';

export const dreamPillowIds = {
  soul: 'soul:300011',
  sleep: 'status.soul.300011.sleep',
} as const;

/** 反枕's sleep application is migrated; special control immunities and reactions remain partial. */
export function registerDreamPillow(registry: ContentRegistry): void {
  registry.registerStatus({ ...createSleepStatusDefinition(dreamPillowIds.sleep, 'partial', dreamEaterRetainsSleep), sealable: false });
  registry.registerSoul({
    id: dreamPillowIds.soul,
    mechanicsCoverage: 'partial',
    handlers: {
      hit: { priority: 48, handle(context, event) {
        if (event.type !== 'damage' || !event.source.unitId) return;
        const attacker = context.getUnit(event.source.unitId);
        const target = context.getUnit(event.targetId);
        if (!attacker || attacker.soulId !== dreamPillowIds.soul || !soulsEnabled(attacker) || !target || target.hp <= 0) return;
        const source = { kind: 'soul' as const, id: dreamPillowIds.soul, unitId: attacker.unitId };
        const command = attemptControl(context, { attemptId: `${dreamPillowIds.sleep}:${event.eventId}`, source,
          targetId: target.unitId, statusId: dreamPillowIds.sleep, controlType: '睡眠', baseChance: .23,
          duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId: event.eventId,
          scopeId: `dream-pillow:${event.eventId}` });
        return command ? [command] : undefined;
      } },
    },
  });
}
