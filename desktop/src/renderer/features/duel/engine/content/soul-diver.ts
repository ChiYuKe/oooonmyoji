import type { ContentRegistry } from './registry';
import type { EffectCommand, SourceRef, StatusInstance } from '../core/types';
import { soulsEnabled } from '../core/soul-eligibility';

export const soulDiverIds = {
  soul: 'soul:300080',
  dealtDamage: 'status.soul.300080.dealt-damage-this-turn',
} as const;

/** 客户端数据确认回合结束随机驱散1项；本回合未造成伤害时额外驱散2项。
 * 按可驱散的负面状态实例组成候选池，直接抽取状态，避免状态较多的单位被低估。 */
export function registerSoulDiver(registry: ContentRegistry): void {
  registry.registerStatus({ id: soulDiverIds.dealtDamage, mechanicsCoverage: 'verified', category: 'other',
    dispellable: false, sealable: false, durationOwner: 'event', refreshPolicy: 'keep' });
  registry.registerSoul({ id: soulDiverIds.soul, mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['客户端技能表确认回合结束随机驱散1项，本回合未造成伤害时额外驱散2项；伤害标记要求实际扣除生命、护盾或额外生命，完全被免疫/致命保护抵消的伤害不计；当前按友方全部可驱散负面状态实例等权抽取，候选池权重仍需客户端帧核验'],
    handlers: {
    hit: { priority: 120, handle(context, event) {
      if (event.type !== 'damage' || event.amount <= 0 || !(event.hpLost > 0 || (event.shieldConsumed ?? 0) > 0
        || (event.extHpConsumed ?? 0) > 0)
        || !event.source.unitId) return;
      const attacker = context.getUnit(event.source.unitId);
      if (!attacker || attacker.soulId !== soulDiverIds.soul || !soulsEnabled(attacker)
        || attacker.statuses.some(status => status.statusId === soulDiverIds.dealtDamage)) return;
      const source: SourceRef = { kind: 'soul', id: soulDiverIds.soul, unitId: attacker.unitId };
      const marker: StatusInstance = { instanceId: `${soulDiverIds.dealtDamage}:${attacker.unitId}:${event.actionId ?? 0}`,
        statusId: soulDiverIds.dealtDamage, source, stacks: 1, duration: { kind: 'permanent' } };
      return [{ type: 'add-status', source, targetId: attacker.unitId, instance: marker, parentEventId: event.eventId }];
    } },
    'turn-start': { priority: 120, handle(context, event) {
      if (event.type !== 'turn-started') return;
      const actor = context.getUnit(event.unitId);
      if (!actor?.statuses.some(status => status.statusId === soulDiverIds.dealtDamage)) return;
      return [{ type: 'remove-statuses', source: soulSource(actor.unitId), targetId: actor.unitId,
        statusIds: [soulDiverIds.dealtDamage], reason: 'consumed' }];
    } },
    'turn-end': { priority: 120, handle(context, event) {
      if (event.type !== 'turn-ended') return;
      const wearer = context.getUnit(event.unitId);
      if (!wearer || wearer.hp <= 0 || wearer.soulId !== soulDiverIds.soul || !soulsEnabled(wearer)) return;
      const dealtDamage = wearer.statuses.some(status => status.statusId === soulDiverIds.dealtDamage);
      const attempts = dealtDamage ? 1 : 3;
      const eligibleStatuses = context.getLivingUnits(wearer.side).flatMap(unit => unit.statuses
        .filter(status => context.isStatusDispellable(status.statusId)
          && ['debuff', 'control', 'mark'].includes(context.getStatusCategory(status.statusId) ?? ''))
        .map(status => ({ targetId: unit.unitId, status })));
      const commands: EffectCommand[] = [];
      for (let index = 0; index < attempts; index++) {
        if (eligibleStatuses.length === 0) break;
        const [selectedCandidate] = eligibleStatuses.splice(Math.floor(context.random() * eligibleStatuses.length), 1);
        if (!selectedCandidate) continue;
        const { targetId, status: selected } = selectedCandidate;
        if (!selected) continue;
        commands.push({ type: 'dispel-statuses', source: soulSource(wearer.unitId), targetId,
          instanceIds: [selected.instanceId], maxCount: 1 });
      }
      if (dealtDamage) commands.push({ type: 'remove-statuses', source: soulSource(wearer.unitId), targetId: wearer.unitId,
        statusIds: [soulDiverIds.dealtDamage], reason: 'consumed' });
      return commands;
    } },
  } });
}

function soulSource(unitId: string): SourceRef {
  return { kind: 'soul', id: soulDiverIds.soul, unitId };
}
