import type { StatusDefinition } from '../core/definitions';
import type { EffectCommand, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';

export function dreamEaterRetainsSleep(attacker: Readonly<UnitState> | undefined): boolean {
  return attacker?.heroId === 257 && passivesEnabled(attacker);
}

/** Sleep is removed by the first damage hit, with removal linked to that hit event. */
export function createSleepStatusDefinition(id: string, mechanicsCoverage: 'verified' | 'partial' = 'partial',
  retainWhenHitBy?: (attacker: Readonly<UnitState> | undefined) => boolean): StatusDefinition {
  return {
    id,
    mechanicsCoverage,
    category: 'control',
    dispellable: true,
    sealable: true,
    durationOwner: 'target-turn',
    refreshPolicy: 'replace',
    preventsAction: true,
    handlers: {
      hit: { priority: 5, handle(context, event): readonly EffectCommand[] | undefined {
        if (event.type !== 'damage') return;
        const target = context.getUnit(event.targetId);
        const status = target?.statuses.find(item => item.statusId === id);
        if (!target || !status) return;
        const attacker = event.source.unitId ? context.getUnit(event.source.unitId) : undefined;
        if (retainWhenHitBy?.(attacker)) return;
        return [{ type: 'remove-statuses', source: status.source, targetId: target.unitId,
          statusIds: [id], reason: 'consumed', parentEventId: event.eventId }];
      } },
    },
  };
}
