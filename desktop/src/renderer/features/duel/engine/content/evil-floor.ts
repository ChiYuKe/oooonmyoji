import type { ContentRegistry } from './registry';
import type { EffectCommand, SourceRef, StatusInstance } from '../core/types';
import { soulsEnabled } from '../core/soul-eligibility';

export const evilFloorIds = {
  soul: 'soul:300081',
  sealed: 'status.soul.300081.sealed',
  power: 'status.soul.300081.power',
} as const;

/** 恶楼's unique power activates after the wearer's first eight turns. */
export function registerEvilFloor(registry: ContentRegistry): void {
  registry.registerStatus({ id: evilFloorIds.sealed, mechanicsCoverage: 'partial', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: evilFloorIds.power, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace',
    mechanicsCoverageNotes: ['恶楼之力增伤与减伤各80%；具体状态的驱散属性尚未从帧图核实'] });
  registry.registerSoul({
    id: evilFloorIds.soul,
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['客户端御魂表记载开战获得恶楼之力（增伤、减伤各80%），携带者前8回合封禁；当前按携带者完成8个回合后生效。封禁回合的客户端计数窗口、恶楼携带者阵亡后的唯一效果转移、多携带者与御魂封印交互仍需战斗帧核验'],
    initialize(context, unitId) {
      const wearer = context.getUnit(unitId);
      if (!wearer || wearer.hp <= 0 || wearer.soulId !== evilFloorIds.soul) return [];
      const firstCarrier = context.getLivingUnits(wearer.side).find(unit => unit.soulId === evilFloorIds.soul);
      if (firstCarrier?.unitId !== wearer.unitId) return [];
      return [sealedStatus(wearer.unitId)];
    },
    handlers: {
      'turn-end': { priority: 30, handle(context, event) {
        if (event.type !== 'turn-ended') return;
        const wearer = context.getUnit(event.unitId);
        if (!wearer || wearer.hp <= 0 || wearer.soulId !== evilFloorIds.soul) return;
        const sealed = wearer.statuses.find(status => status.statusId === evilFloorIds.sealed);
        if (!sealed) return;
        const source = soulSource(wearer.unitId);
        const remaining = Math.max(0, sealed.stacks - 1);
        const commands: EffectCommand[] = [{ type: 'remove-status-instances', source, targetId: wearer.unitId,
          instanceIds: [sealed.instanceId], reason: 'consumed' }];
        if (remaining > 0) commands.push({ type: 'add-status', source, targetId: wearer.unitId,
          instance: { ...sealed, stacks: remaining } });
        else commands.push({ type: 'add-status', source, targetId: wearer.unitId,
          instance: powerStatus(wearer.unitId) });
        return commands;
      } },
    },
    modifyOutgoingDamage(attacker, _target, amount) {
      return attacker.soulId === evilFloorIds.soul && soulsEnabled(attacker)
        && attacker.statuses.some(status => status.statusId === evilFloorIds.power) ? amount * 1.8 : amount;
    },
    modifyIncomingDamage(_attacker, target, amount) {
      return target.soulId === evilFloorIds.soul && soulsEnabled(target)
        && target.statuses.some(status => status.statusId === evilFloorIds.power) ? amount * .2 : amount;
    },
  });
}

function sealedStatus(unitId: string): EffectCommand {
  const source = soulSource(unitId);
  const instance: StatusInstance = { instanceId: `${evilFloorIds.sealed}:${unitId}`, statusId: evilFloorIds.sealed,
    source, stacks: 8, duration: { kind: 'permanent' } };
  return { type: 'add-status', source, targetId: unitId, instance };
}

function powerStatus(unitId: string): StatusInstance {
  const source = soulSource(unitId);
  return { instanceId: `${evilFloorIds.power}:${unitId}`, statusId: evilFloorIds.power,
    source, stacks: 1, duration: { kind: 'permanent' } };
}

function soulSource(unitId: string): SourceRef {
  return { kind: 'soul', id: evilFloorIds.soul, unitId };
}
