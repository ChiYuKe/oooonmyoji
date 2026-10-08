import type { ContentRegistry } from './registry';
import type { EffectCommand, SourceRef, StatusInstance } from '../core/types';
import { soulsEnabled } from '../core/soul-eligibility';

export const nightSendDogIds = {
  soul: 'soul:300059',
  nightWalk: 'status.soul.300059.night-walk',
  controlledThisTurn: 'status.soul.300059.controlled-this-turn',
} as const;

/** 夜送犬 grants one Night Walk stack for the first enemy control received each turn. */
export function registerNightSendDog(registry: ContentRegistry): void {
  registry.registerStatus({ id: nightSendDogIds.nightWalk, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 3,
    mechanicsCoverageNotes: ['每层增加80个百分点效果抵抗，最多3层；夜行的客户端驱散属性尚未用帧图确认'],
  });
  registry.registerStatus({ id: nightSendDogIds.controlledThisTurn, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerSoul({
    id: nightSendDogIds.soul,
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['每个携带者回合内首次受到敌方式神施加的控制时增加1层夜行，抵抗+80个百分点，最多3层；自身回合开始能行动时清空夜行。当前以回合开始事件重置本回合控制标记；可行动判定沿用状态是否阻止行动。控制覆盖范围、效果驱散与客户端回合起点仍需逐帧校对'],
    handlers: {
      'control-application': { priority: 170, handle(context, event) {
        if (event.type !== 'control-applied' || !event.source.unitId) return;
        const wearer = context.getUnit(event.targetId);
        const attacker = context.getUnit(event.source.unitId);
        if (!wearer || wearer.hp <= 0 || wearer.soulId !== nightSendDogIds.soul || !soulsEnabled(wearer)
          || !attacker || attacker.hp <= 0 || attacker.side === wearer.side
          || wearer.statuses.some(status => status.statusId === nightSendDogIds.controlledThisTurn)) return;
        const current = wearer.statuses.find(status => status.statusId === nightSendDogIds.nightWalk);
        if ((current?.stacks ?? 0) >= 3) return [turnMarker(wearer.unitId, event.eventId)];
        const source = soulSource(wearer.unitId);
        const instance: StatusInstance = { instanceId: `${nightSendDogIds.nightWalk}:${wearer.unitId}`,
          statusId: nightSendDogIds.nightWalk, source, stacks: 1,
          duration: { kind: 'permanent' }, modifiers: [{ stat: 'resist', operation: 'flat', amount: .8, perStack: true }] };
        return [{ type: 'add-status', source, targetId: wearer.unitId, instance, parentEventId: event.eventId },
          turnMarker(wearer.unitId, event.eventId)];
      } },
      'turn-start': { priority: 170, handle(context, event) {
        if (event.type !== 'turn-started') return;
        const wearer = context.getUnit(event.unitId);
        if (!wearer || wearer.hp <= 0 || wearer.soulId !== nightSendDogIds.soul || !soulsEnabled(wearer)) return;
        const source = soulSource(wearer.unitId);
        const commands: EffectCommand[] = [];
        const marker = wearer.statuses.find(status => status.statusId === nightSendDogIds.controlledThisTurn);
        if (marker) commands.push({ type: 'remove-status-instances', source, targetId: wearer.unitId,
          instanceIds: [marker.instanceId], reason: 'consumed', parentEventId: event.eventId });
        if (context.isUnitUnableToAct(wearer.unitId)) return commands;
        const nightWalk = wearer.statuses.find(status => status.statusId === nightSendDogIds.nightWalk);
        if (nightWalk) commands.push({ type: 'remove-status-instances', source, targetId: wearer.unitId,
          instanceIds: [nightWalk.instanceId], reason: 'consumed', parentEventId: event.eventId });
        return commands;
      } },
    },
  });
}

function turnMarker(unitId: string, parentEventId: string): EffectCommand {
  const source = soulSource(unitId);
  const instance: StatusInstance = { instanceId: `${nightSendDogIds.controlledThisTurn}:${unitId}`,
    statusId: nightSendDogIds.controlledThisTurn, source, stacks: 1, duration: { kind: 'permanent' } };
  return { type: 'add-status', source, targetId: unitId, instance, parentEventId };
}

function soulSource(unitId: string): SourceRef {
  return { kind: 'soul', id: nightSendDogIds.soul, unitId };
}
