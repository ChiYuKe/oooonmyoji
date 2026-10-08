import type { ContentRegistry } from './registry';
import { soulsEnabled } from '../core/soul-eligibility';
import type { SourceRef, StatusInstance } from '../core/types';

export const oilChildIds = {
  soul: 'soul:300057',
  spiritOrigin: 'status.soul.300057.spirit-origin',
  defenseAura: 'status.soul.300057.defense-aura',
} as const;

/** 油女的唯一御魂：开战获得2层灵元，为全体友方提供防御，并在鬼火不足时替代技能鬼火。 */
export function registerOilChild(registry: ContentRegistry): void {
  registry.registerStatus({ id: oilChildIds.spiritOrigin, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 2,
    mechanicsCoverageNotes: ['客户端御魂表记载灵元为油女的唯一资源；驱散与御魂封印交互尚未逐帧核实'] });
  registry.registerStatus({ id: oilChildIds.defenseAura, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', maxStacks: 2,
    mechanicsCoverageNotes: ['每层灵元为友方全体提供8%防御；状态的实际驱散属性尚未逐帧核实'], });
  registry.registerSoul({
    id: oilChildIds.soul,
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['客户端御魂表记载战斗开始获得2层灵元；每层提升友方全体8%防御；友方施放妖术且鬼火不足时，可按缺少量替代鬼火。灵元消耗时同步降低全队防御层数。唯一效果持有者更替、驱散、封印及帧图中的实际触发仍待核实'],
    initialize(context, unitId) {
      const wearer = context.getUnit(unitId);
      if (!wearer || wearer.hp <= 0 || wearer.soulId !== oilChildIds.soul || !soulsEnabled(wearer)) return [];
      const carrier = context.getLivingUnits(wearer.side).find(unit => unit.soulId === oilChildIds.soul && soulsEnabled(unit));
      if (carrier?.unitId !== wearer.unitId) return [];
      const source = soulSource(wearer.unitId);
      const resource: StatusInstance = { instanceId: `${oilChildIds.spiritOrigin}:${wearer.unitId}`,
        statusId: oilChildIds.spiritOrigin, source, stacks: 2, duration: { kind: 'permanent' } };
      return [{ type: 'add-status', source, targetId: wearer.unitId, instance: resource },
        ...context.getLivingUnits(wearer.side).map(ally => auraCommand(ally.unitId, wearer.unitId, 2))];
    },
    handlers: {
      'effect-resolution': { priority: 20, handle(context, event) {
        if (event.type !== 'unit-summoned' && event.type !== 'unit-revived') return;
        const target = context.getUnit(event.unitId);
        if (!target || target.hp <= 0) return;
        const carrier = context.getLivingUnits(target.side).find(unit => unit.soulId === oilChildIds.soul && soulsEnabled(unit));
        const stacks = carrier?.statuses.find(status => status.statusId === oilChildIds.spiritOrigin)?.stacks ?? 0;
        if (!carrier || stacks <= 0) return;
        return [auraCommand(target.unitId, carrier.unitId, stacks, event.eventId)];
      } },
    },
    resolveActionAdjustment(state, actor, skill) {
      if (actor.hp <= 0 || skill.actionKind !== 'skill') return undefined;
      const carrier = [actor, ...state.sides[actor.side].map(unitId => state.units[unitId])
        .filter((unit): unit is NonNullable<typeof unit> => Boolean(unit && unit.unitId !== actor.unitId && unit.hp > 0))]
        .find(unit => unit.hp > 0 && unit.soulId === oilChildIds.soul && soulsEnabled(unit)
          && unit.statuses.some(status => status.statusId === oilChildIds.spiritOrigin && status.stacks > 0));
      if (!carrier) return undefined;
      return { resourceCostSubstitutions: [{ resourceId: 'fire', statusId: oilChildIds.spiritOrigin,
        sourceUnitId: carrier.unitId, whenInsufficient: true, linkedStatusId: oilChildIds.defenseAura }] };
    },
  });
}

function auraCommand(targetId: string, carrierId: string, stacks: number, parentEventId?: string) {
  const source = soulSource(carrierId);
  const instance: StatusInstance = { instanceId: `${oilChildIds.defenseAura}:${carrierId}:${targetId}`,
    statusId: oilChildIds.defenseAura, source, stacks, duration: { kind: 'permanent' },
    modifiers: [{ stat: 'defense', operation: 'percent', amount: .08, perStack: true }] };
  return { type: 'add-status' as const, source, targetId, instance, ...(parentEventId ? { parentEventId } : {}) };
}

function soulSource(unitId: string): SourceRef {
  return { kind: 'soul', id: oilChildIds.soul, unitId };
}
