import type { EventDispatcher } from '../core/event-dispatcher';
import type { BattleEvent } from '../core/types';
import type { StatusDefinition } from '../core/definitions';

/** Rules shared by PvP battles; content-specific defeat effects remain in content modules. */
export function registerPvpRules(dispatcher: EventDispatcher, resolveStatus?: (id: string) => StatusDefinition | undefined): void {
  dispatcher.register({ id: 'system:pvp-turn-fire-meter', phase: 'turn-end', priority: 0,
    handle(context, event) {
      if (event.type !== 'turn-ended') return;
      const actor = context.getUnit(event.unitId);
      if (!actor || actor.statuses.some(status => resolveStatus?.(status.statusId)?.blocksResourceMeterAdvance)) return;
      return [{ type: 'advance-resource-meter', source: { kind: 'system', id: 'resource-meter' },
        side: actor.side, resourceId: 'fire', steps: actor.unitKind === 'onmyoji' ? 3 : 1, parentEventId: event.eventId }];
    } });
  dispatcher.register({ id: 'system:pvp-defeat-fire', phase: 'unit-defeated', priority: 0,
    handle(context, event: BattleEvent) {
      if (event.type !== 'unit-defeated') return;
      const defeated = context.getUnit(event.unitId);
      if (!defeated) return;
      const amount = defeated.unitKind === 'onmyoji' ? 2 : defeated.unitKind === 'shikigami' ? 1 : 0;
      if (amount === 0) return;
      return [{ type: 'change-resource', source: { kind: 'system', id: 'pvp.defeat-fire' },
        side: defeated.side, resourceId: 'fire', amount, parentEventId: event.eventId }];
    } });
}
