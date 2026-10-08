import type { ContentRegistry } from './registry';
import { soulsEnabled } from '../core/soul-eligibility';

export const beichuifangIds = {
  soul: 'soul:300082',
  shell: 'status.soul.300082.shell',
} as const;

/**贝吹坊：回合开始获得一次性贝甲，贝甲期间增伤25%。 */
export function registerBeichuifang(registry: ContentRegistry): void {
  registry.registerStatus({ id: beichuifangIds.shell, mechanicsCoverage: 'partial', category: 'shield',
    dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace',
    mechanicsCoverageNotes: ['贝甲会挡下一次伤害且存在时增伤25%；驱散/封印属性及客户端多段攻击命中计数仍需帧图确认'] });

  registry.registerSoul({
    id: beichuifangIds.soul,
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['按客户端描述实现携带者回合开始获得贝甲、贝甲期间增伤25%、受到一次伤害后消失；驱散属性与多段攻击的“1次伤害”边界仍需帧图确认'],
    handlers: {
      'turn-start': { priority: 25, handle(context, event) {
        if (event.type !== 'turn-started') return;
        const wearer = context.getUnit(event.unitId);
        if (!wearer || wearer.hp <= 0 || wearer.soulId !== beichuifangIds.soul || !soulsEnabled(wearer)) return;
        const source = { kind: 'soul' as const, id: beichuifangIds.soul, unitId: wearer.unitId };
        return [{ type: 'add-status', source, targetId: wearer.unitId, parentEventId: event.eventId,
          instance: { instanceId: `${beichuifangIds.shell}:${wearer.unitId}`, statusId: beichuifangIds.shell,
            source, stacks: 1, duration: { kind: 'permanent' } } }];
      } },
    },
    modifyOutgoingDamage(attacker, _target, amount) {
      return attacker.soulId === beichuifangIds.soul && soulsEnabled(attacker)
        && attacker.statuses.some(status => status.statusId === beichuifangIds.shell) ? amount * 1.25 : amount;
    },
    interceptIncomingDamage(_state, _attacker, target) {
      if (target.soulId !== beichuifangIds.soul || !soulsEnabled(target)
        || !target.statuses.some(status => status.statusId === beichuifangIds.shell)) return undefined;
      const source = { kind: 'soul' as const, id: beichuifangIds.soul, unitId: target.unitId };
      return { amount: 0, effects: [{ type: 'remove-statuses', source, targetId: target.unitId,
        statusIds: [beichuifangIds.shell], reason: 'consumed' }] };
    },
  });
}
