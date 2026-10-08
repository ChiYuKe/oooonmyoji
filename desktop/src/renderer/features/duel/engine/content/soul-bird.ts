import type { ContentRegistry } from './registry';
import { soulsEnabled } from '../core/soul-eligibility';
import type { UnitState } from '../core/types';

export const soulBirdIds = {
  soul: 'soul:300029',
  damageStatus: 'status.soul.300029.damage-stacks',
} as const;

/** Soul Bird excludes monster deaths; summons count as non-monster targets. */
export function registerSoulBird(registry: ContentRegistry): void {
  registry.registerStatus({ id: soulBirdIds.damageStatus, mechanicsCoverage: 'verified', category: 'buff',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 6 });
  registry.registerSoul({
    id: soulBirdIds.soul,
    mechanicsCoverage: 'verified',
    modifyOutgoingDamage(attacker, _target, amount) {
      const status = attacker.statuses.find(item => item.statusId === soulBirdIds.damageStatus);
      const bonus = Number(status?.values?.damageBonus ?? 0);
      return amount * (1 + Math.max(0, Math.min(1.2, Number.isFinite(bonus) ? bonus : 0)));
    },
    handlers: {
      'unit-defeated': { priority: 30, handle(context, event) {
        if (event.type !== 'unit-defeated') return;
        const defeated = context.getUnit(event.unitId);
        if (!defeated || defeated.unitKind === 'monster') return;
        const living = [
          ...context.getLivingUnits('blue'),
          ...context.getLivingUnits('red'),
        ];
        const commands = [];
        for (const wearer of living) {
          if (wearer.soulId !== soulBirdIds.soul || !soulsEnabled(wearer)) continue;
          commands.push({ type: 'heal' as const, source: { kind: 'soul' as const, id: soulBirdIds.soul, unitId: wearer.unitId },
            targetId: wearer.unitId, amount: wearer.stats.hp * .2, parentEventId: event.eventId });
          const previous = wearer.statuses.find(status => status.statusId === soulBirdIds.damageStatus);
          const previousBonus = Number(previous?.values?.damageBonus ?? 0);
          const damageBonus = Math.min(1.2, Math.max(0, Number.isFinite(previousBonus) ? previousBonus : 0) + .2);
          if (damageBonus <= previousBonus) continue;
          commands.push({ type: 'add-status' as const, source: { kind: 'soul' as const, id: soulBirdIds.soul, unitId: wearer.unitId },
            targetId: wearer.unitId, parentEventId: event.eventId, instance: {
              instanceId: `${soulBirdIds.damageStatus}:${wearer.unitId}:${event.eventId}`,
              statusId: soulBirdIds.damageStatus,
              source: { kind: 'soul' as const, id: soulBirdIds.soul, unitId: wearer.unitId },
              stacks: 1,
              duration: { kind: 'permanent' as const },
              values: { damageBonus },
            } });
        }
        return commands;
      } },
    },
  });
}

export function soulBirdDamageBonus(unit: Pick<UnitState, 'statuses'>): number {
  const value = Number(unit.statuses.find(status => status.statusId === soulBirdIds.damageStatus)?.values?.damageBonus ?? 0);
  return Math.max(0, Math.min(1.2, Number.isFinite(value) ? value : 0));
}
