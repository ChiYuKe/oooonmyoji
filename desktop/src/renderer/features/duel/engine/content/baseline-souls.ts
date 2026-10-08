import type { ContentRegistry } from './registry';
import type { EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { soulsEnabled } from '../core/soul-eligibility';

export const baselineSoulIds = {
  shell: 'soul:300034',
  needle: 'soul:300036',
  jizo: 'soul:300003',
  fire: 'soul:300019',
  guard: 'soul:300021',
  break: 'soul:300030',
} as const;

export const shieldStatusId = 'core.shield';
export const guardAttackStatusId = 'status.soul.300021.attack-guard';

export function registerBaselineSouls(registry: ContentRegistry): void {
  registry.registerStatus({ id: shieldStatusId, mechanicsCoverage: 'verified', dispellable: false, sealable: false,
    durationOwner: 'target-turn', refreshPolicy: 'add-stack', maxStacks: 99 });
  registry.registerStatus({ id: guardAttackStatusId, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'event', refreshPolicy: 'replace' });

  registry.registerSoul({ id: baselineSoulIds.fire, mechanicsCoverage: 'verified', initialize(context, unitId) {
    const wearer = context.getUnit(unitId);
    if (!wearer || !soulsEnabled(wearer)) return [];
    const first = context.getLivingUnits(wearer.side).find(unit => unit.soulId === baselineSoulIds.fire);
    if (first?.unitId !== unitId) return [];
    return [{ type: 'change-resource', source: soulSource(baselineSoulIds.fire, unitId), side: wearer.side,
      resourceId: 'fire', amount: 3 }];
  } });

  registry.registerSoul({ id: baselineSoulIds.shell, mechanicsCoverage: 'verified', initialize(context, unitId) {
    const wearer = context.getUnit(unitId);
    if (!wearer || !soulsEnabled(wearer)) return [];
    const first = context.getLivingUnits(wearer.side).find(unit => unit.soulId === baselineSoulIds.shell);
    if (first?.unitId !== unitId) return [];
    return context.getLivingUnits(wearer.side).map(ally => addShield(baselineSoulIds.shell, unitId, ally, ally.stats.hp * .1, 'shell-opening'));
  } });

  registry.registerSoul({ id: baselineSoulIds.break, mechanicsCoverage: 'verified',
    modifyOutgoingDamage(attacker, target, amount, kind) {
      return soulsEnabled(attacker) && kind === 'normal' && target.hp / Math.max(1, target.stats.hp) > .7 ? amount * 1.4 : amount;
    } });

  registry.registerSoul({ id: baselineSoulIds.needle, mechanicsCoverage: 'verified', handlers: {
    hit: { priority: 100, handle(context, event) {
      if (event.type !== 'damage' || !event.isCritical || event.damageKind !== 'normal' || !event.source.unitId) return;
      const attacker = context.getUnit(event.source.unitId);
      const target = context.getUnit(event.targetId);
      if (!attacker || attacker.soulId !== baselineSoulIds.needle || !soulsEnabled(attacker)
        || !target || target.hp <= 0 || context.random() >= .4) return;
      const attack = context.getEffectiveStats(attacker.unitId)?.attack ?? attacker.stats.attack;
      const amount = Math.min(target.stats.hp * .1, attack * 1.2);
      if (amount <= 0) return;
      context.submit({ type: 'deal-damage', source: soulSource(baselineSoulIds.needle, attacker.unitId), targetId: target.unitId,
        amount, damageKind: 'true', parentEventId: event.eventId });
    } },
  } });

  registry.registerSoul({ id: baselineSoulIds.jizo, mechanicsCoverage: 'verified', handlers: {
    hit: { priority: 110, handle(context, event) {
      if (event.type !== 'damage' || !event.isCritical) return;
      const target = context.getUnit(event.targetId);
      if (!target || target.hp <= 0 || target.soulId !== baselineSoulIds.jizo || !soulsEnabled(target)) return;
      for (const ally of context.getLivingUnits(target.side)) {
        if (ally.soulId !== baselineSoulIds.jizo || !soulsEnabled(ally)) continue;
        const taunted = ally.statuses.some(status => context.getStatusCategory(status.statusId) === 'control'
          && status.values?.controlType === '嘲讽');
        const baseChance = ally.unitId === target.unitId ? 1 : .3;
        const chance = baseChance * (taunted ? .4 : 1);
        if (ally.unitId !== target.unitId && context.random() >= chance) continue;
        context.submit(addShield(baselineSoulIds.jizo, ally.unitId, ally, ally.stats.hp * .1,
          `jizo:${event.attackId ?? event.eventId}:${event.hitIndex ?? 0}`));
      }
    } },
  } });

  registry.registerSoul({ id: baselineSoulIds.guard, mechanicsCoverage: 'verified',
    mechanicsCoverageNotes: ['客户端御魂表的单体守护规则已实现并通过边界回归：从其他存活携带者中随机选择守护者，50%判定成功后整次攻击共用标记；受击先减伤20%，剩余伤害由目标与守护者各承担一半。分摊沿用原目标防御结算结果，并在攻击结束清除标记。'], handlers: {
    'attack-start': { priority: 50, handle(context, event) {
      if (event.type !== 'attack-start' || event.shape !== 'single' || event.targetIds.length !== 1
        || event.attackId === undefined || !event.source.unitId) return;
      const attacker = context.getUnit(event.source.unitId);
      const protectedTarget = context.getUnit(event.targetIds[0]!);
      if (!attacker || !protectedTarget) return;
      const protectors = context.getLivingUnits(protectedTarget.side)
        .filter(unit => unit.unitId !== protectedTarget.unitId && unit.soulId === baselineSoulIds.guard && soulsEnabled(unit));
      if (protectors.length === 0) return;
      const protector = protectors[Math.floor(context.random() * protectors.length)]!;
      if (context.random() >= .5) return;
      const source = soulSource(baselineSoulIds.guard, protector.unitId);
      const marker: StatusInstance = { instanceId: `${guardAttackStatusId}:${attacker.unitId}:${event.attackId}`,
        statusId: guardAttackStatusId, source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'event', event: 'attack-end' },
        values: { attackId: event.attackId, protectedTargetId: protectedTarget.unitId, protectorId: protector.unitId } };
      return [{ type: 'add-status', source, targetId: attacker.unitId, instance: marker, parentEventId: event.eventId }];
    } },
    'attack-end': { priority: 50, handle(context, event) {
      if (event.type !== 'attack-ended' || !event.source.unitId) return;
      const attacker = context.getUnit(event.source.unitId);
      if (!attacker?.statuses.some(status => status.statusId === guardAttackStatusId
        && Number(status.values?.attackId) === event.attackId)) return;
      return [{ type: 'remove-statuses', source: soulSource(baselineSoulIds.guard, event.source.unitId),
        targetId: event.source.unitId, statusIds: [guardAttackStatusId], reason: 'consumed', parentEventId: event.eventId }];
    } },
  }, interceptIncomingDamage(state, attacker, target, amount) {
    if (!attacker) return undefined;
    const marker = attacker.statuses.find(status => status.statusId === guardAttackStatusId
      && Number(status.values?.attackId) === state.counters.attack
      && status.values?.protectedTargetId === target.unitId);
    if (!marker) return undefined;
    const protectorId = marker.values?.protectorId;
    const protector = typeof protectorId === 'string' ? state.units[protectorId] : undefined;
    if (!protector || protector.hp <= 0 || !soulsEnabled(protector)) return undefined;
    // Incoming damage already includes the protected target's defense. The set leaves 80% of
    // that result and divides it equally between the protected target and the guardian.
    const shared = amount * .4;
    return { amount: Math.max(0, amount * .4), effects: [{ type: 'deal-damage', source: soulSource(baselineSoulIds.guard, protector.unitId),
      targetId: protector.unitId, amount: shared, precalculated: true, countsAsHit: false, parentEventId: marker.appliedByEventId }] };
  } });
}

function addShield(sourceId: string, sourceUnitId: string, target: Readonly<UnitState>, amount: number, suffix: string): EffectCommand {
  const source = soulSource(sourceId, sourceUnitId);
  const instance: StatusInstance = {
    instanceId: `${sourceId}:${suffix}:${target.unitId}`,
    statusId: shieldStatusId,
    source,
    stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
    values: { shieldRemaining: Math.max(0, amount) },
  };
  return { type: 'add-status', source, targetId: target.unitId, instance };
}

function soulSource(id: string, unitId: string): SourceRef {
  return { kind: 'soul', id, unitId };
}
