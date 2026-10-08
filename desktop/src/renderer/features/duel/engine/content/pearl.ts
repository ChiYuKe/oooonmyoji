import type { ContentRegistry } from './registry';
import type { SourceRef, StatusInstance } from '../core/types';
import { soulsEnabled } from '../core/soul-eligibility';

export const pearlIds = {
  soul: 'soul:300032',
  shield: 'status.soul.300032.shield',
} as const;

/** 珍珠 adds a two-turn shield worth 30% of the healing request to its recipient. */
export function registerPearl(registry: ContentRegistry): void {
  registry.registerStatus({ id: pearlIds.shield, mechanicsCoverage: 'verified', category: 'shield',
    dispellable: true, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'add-stack', maxStacks: 99 });
  registry.registerSoul({ id: pearlIds.soul, mechanicsCoverage: 'verified', handlers: {
    'effect-resolution': { priority: 100, handle(context, event) {
      if (event.type !== 'healing' || event.requestedAmount <= 0 || !event.source.unitId) return;
      const healer = context.getUnit(event.source.unitId);
      if (!healer || healer.soulId !== pearlIds.soul || !soulsEnabled(healer)) return;
      const target = context.getUnit(event.targetId);
      if (!target) return;
      const source: SourceRef = { kind: 'soul', id: pearlIds.soul, unitId: healer.unitId };
      const shield: StatusInstance = { instanceId: `${pearlIds.shield}:${event.eventId}`, statusId: pearlIds.shield,
        source, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
        values: { shieldRemaining: event.requestedAmount * .3 } };
      return [{ type: 'add-status', source, targetId: target.unitId, instance: shield, parentEventId: event.eventId }];
    } },
  } });
}
