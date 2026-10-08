import type { ContentRegistry } from './registry';
import type { EffectCommand, SourceRef, StatusInstance } from '../core/types';
import { soulsEnabled } from '../core/soul-eligibility';

export const dustMoundIds = {
  soul: 'soul:300056',
  damage: 'status.soul.300056.damage',
} as const;

/** 尘冢 refreshes its attack bonus at the start of each eligible turn. */
export function registerDustMound(registry: ContentRegistry): void {
  registry.registerStatus({ id: dustMoundIds.damage, mechanicsCoverage: 'verified', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerSoul({ id: dustMoundIds.soul, mechanicsCoverage: 'verified', handlers: {
    'turn-start': { priority: 125, handle(context, event) {
      if (event.type !== 'turn-started') return;
      const wearer = context.getUnit(event.unitId);
      if (!wearer || wearer.hp <= 0 || wearer.soulId !== dustMoundIds.soul || !soulsEnabled(wearer)) return;
      const friendlyCount = context.getLivingUnits(wearer.side).filter(unit => unit.unitKind !== 'summon').length;
      const enemySide = wearer.side === 'blue' ? 'red' : 'blue';
      const enemyCount = context.getLivingUnits(enemySide).length;
      const bonus = Math.min(.45, .25 + Math.max(0, friendlyCount - enemyCount) * .04);
      const source: SourceRef = { kind: 'soul', id: dustMoundIds.soul, unitId: wearer.unitId };
      const instance: StatusInstance = { instanceId: `${dustMoundIds.damage}:${wearer.unitId}`, statusId: dustMoundIds.damage,
        source, stacks: 1, duration: { kind: 'permanent' }, modifiers: [{ stat: 'damage', operation: 'percent', amount: bonus }] };
      return [{ type: 'add-status', source, targetId: wearer.unitId, instance, parentEventId: event.eventId }];
    } },
    'turn-end': { priority: 125, handle(context, event) {
      if (event.type !== 'turn-ended') return;
      const wearer = context.getUnit(event.unitId);
      if (!wearer?.statuses.some(status => status.statusId === dustMoundIds.damage)) return;
      const source: SourceRef = { kind: 'soul', id: dustMoundIds.soul, unitId: wearer.unitId };
      const command: EffectCommand = { type: 'remove-statuses', source, targetId: wearer.unitId,
        statusIds: [dustMoundIds.damage], reason: 'consumed', parentEventId: event.eventId };
      return [command];
    } },
  } });
}
