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
      // 客户端 `AttrCalc._guiHuoRecover`：每回合的资源推进量 = 基准（阴阳师 `YYS_BOUT_ADD_GUIHUO` = 3 / 其它 = 1）
      // **加上状态修正**（沉默/禁言/不可见类 buff 为 -1 ⇒ 该单位这一回合少补 1；见 §49 A3）。
      const base = actor.unitKind === 'onmyoji' ? 3 : 1;
      const bonus = actor.statuses.reduce((sum, status) => {
        const modifier = resolveStatus?.(status.statusId)?.resourceRecoveryBonus;
        return modifier && modifier.resourceId === 'fire' ? sum + modifier.amount : sum;
      }, 0);
      const steps = Math.max(0, base + bonus);
      if (steps <= 0) return;
      return [{ type: 'advance-resource-meter', source: { kind: 'system', id: 'resource-meter' },
        side: actor.side, resourceId: 'fire', steps, parentEventId: event.eventId }];
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
