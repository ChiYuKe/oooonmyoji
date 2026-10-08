import type { ContentRegistry } from './registry';
import { soulsEnabled } from '../core/soul-eligibility';
import type { SourceRef, StatusInstance } from '../core/types';

export const remembranceFireIds = {
  soul: 'soul:300079',
  thoughtFire: 'status.soul.300079.thought-fire',
} as const;

/** 遗念火 builds up resistance and substitutes layers for skill fire costs. */
export function registerRemembranceFire(registry: ContentRegistry): void {
  registry.registerStatus({ id: remembranceFireIds.thoughtFire, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 3,
    mechanicsCoverageNotes: ['每层提供15个百分点效果抵抗，并替代技能消耗的1点鬼火；客户端状态驱散属性尚未逐帧核实'] });
  registry.registerSoul({
    id: remembranceFireIds.soul,
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['回合开始增加1层念火，最多3层；每层效果抵抗+15个百分点，施放技能时按需消耗念火替代等量鬼火。行动验证会先确认剩余鬼火/鬼火条可支付，再扣除念火，防止失败技能白耗念火。主动技能、状态驱散及御魂封印边界仍待帧核'],
    handlers: {
      'turn-start': { priority: 24, handle(context, event) {
        if (event.type !== 'turn-started') return;
        const wearer = context.getUnit(event.unitId);
        if (!wearer || wearer.hp <= 0 || wearer.soulId !== remembranceFireIds.soul || !soulsEnabled(wearer)) return;
        const source = soulSource(wearer.unitId);
        const instance: StatusInstance = { instanceId: `${remembranceFireIds.thoughtFire}:${wearer.unitId}`,
          statusId: remembranceFireIds.thoughtFire, source, stacks: 1, duration: { kind: 'permanent' },
          modifiers: [{ stat: 'resist', operation: 'flat', amount: .15, perStack: true }] };
        return [{ type: 'add-status', source, targetId: wearer.unitId, instance, parentEventId: event.eventId }];
      } },
    },
    resolveActionAdjustment(_state, actor, skill) {
      if (actor.soulId !== remembranceFireIds.soul || actor.hp <= 0 || !soulsEnabled(actor)
        || skill.actionKind !== 'skill' || !actor.statuses.some(status => status.statusId === remembranceFireIds.thoughtFire)) return undefined;
      return { resourceCostSubstitutions: [{ resourceId: 'fire', statusId: remembranceFireIds.thoughtFire,
        sourceUnitId: actor.unitId }] };
    },
  });
}

function soulSource(unitId: string): SourceRef {
  return { kind: 'soul', id: remembranceFireIds.soul, unitId };
}
