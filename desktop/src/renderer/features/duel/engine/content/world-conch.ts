import type { ContentRegistry } from './registry';
import type { BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { soulsEnabled } from '../core/soul-eligibility';

export const worldConchIds = {
  soul: 'soul:300084',
  shell: 'status.soul.300084.shell',
} as const;

/** 出世螺 heals after each damage hit and caps one oversized hit while 螺壳 is active. */
export function registerWorldConch(registry: ContentRegistry): void {
  registry.registerStatus({ id: worldConchIds.shell, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace',
    mechanicsCoverageNotes: ['螺壳按客户端描述限制单次伤害；状态能否被驱散仍需实战确认'] });
  registry.registerSoul({
    id: worldConchIds.soul,
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['每次受伤后恢复该次伤害10%生命；开战及自身行动前获得一层螺壳，单次伤害超过生命上限60%时限制为60%并消耗螺壳。客户端数据明确这三项规则；螺壳驱散属性以及伤害只被护盾吸收时的恢复口径仍需帧图确认'],
    initialize(context, unitId) {
      const wearer = context.getUnit(unitId);
      if (!wearer || wearer.hp <= 0 || wearer.soulId !== worldConchIds.soul || !soulsEnabled(wearer)) return [];
      return shellGrant(wearer.unitId);
    },
    handlers: {
      'turn-start': { priority: 20, handle(context, event) {
        if (event.type !== 'turn-started') return;
        const wearer = context.getUnit(event.unitId);
        if (!wearer || wearer.hp <= 0 || wearer.soulId !== worldConchIds.soul || !soulsEnabled(wearer)) return;
        return shellGrant(wearer.unitId, event.eventId);
      } },
      hit: { priority: 20, handle(context, event) {
        if (event.type !== 'damage' || event.amount <= 0 || !event.targetId) return;
        const wearer = context.getUnit(event.targetId);
        if (!wearer || wearer.hp <= 0 || wearer.soulId !== worldConchIds.soul || !soulsEnabled(wearer)) return;
        return [{ type: 'heal', source: soulSource(wearer.unitId), targetId: wearer.unitId,
          amount: event.amount * .1, parentEventId: event.eventId }];
      } },
    },
    interceptIncomingDamage(_state, _attacker, target, amount) {
      if (target.hp <= 0 || target.soulId !== worldConchIds.soul || !soulsEnabled(target)
        || !target.statuses.some(status => status.statusId === worldConchIds.shell)) return undefined;
      const cap = target.stats.hp * .6;
      if (amount <= cap) return undefined;
      return { amount: cap, effects: [{ type: 'remove-statuses', source: soulSource(target.unitId), targetId: target.unitId,
        statusIds: [worldConchIds.shell], reason: 'consumed' }] };
    },
  });
}

function shellGrant(unitId: string, parentEventId?: string): EffectCommand[] {
  if (!unitId) return [];
  const source = soulSource(unitId);
  const instance: StatusInstance = { instanceId: `${worldConchIds.shell}:${unitId}`, statusId: worldConchIds.shell,
    source, stacks: 1, duration: { kind: 'permanent' } };
  return [{ type: 'add-status', source, targetId: unitId, instance,
    ...(parentEventId ? { parentEventId } : {}) }];
}

function soulSource(unitId: string): SourceRef {
  return { kind: 'soul', id: worldConchIds.soul, unitId };
}
