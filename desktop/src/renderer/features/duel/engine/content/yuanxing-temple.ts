import type { ContentRegistry } from './registry';
import type { BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { soulsEnabled } from '../core/soul-eligibility';

export const yuanxingTempleIds = {
  soul: 'soul:300089',
  actionTargets: 'status.soul.300089.action-targets',
  teamDamage: 'status.soul.300089.team-damage',
} as const;

/** 元兴寺 converts unique successful control targets into up to 40% team damage for two turns. */
export function registerYuanxingTemple(registry: ContentRegistry): void {
  registry.registerStatus({ id: yuanxingTempleIds.actionTargets, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: yuanxingTempleIds.teamDamage, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'add-stack', stackScope: 'source-unit', maxStacks: 8 });
  registry.registerSoul({ id: yuanxingTempleIds.soul, mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['携带者行动内成功施加控制时，按本次行动中被控制的不同目标数叠加全队非召唤物5%增伤，最多8层、持续2回合；同一行动重复控制同目标只计1次。客户端说明为唯一效果；脱离行动来源的被动控制与镜像携带者的完整触发边界仍待帧核。'],
    handlers: {
      'control-application': { priority: 170, handle(context, event) { return addTeamDamage(context, event); } },
      'action-end': { priority: 170, handle(context, event) { return clearActionTargets(context, event); } },
    },
  });
}

function addTeamDamage(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'control-applied' || !event.source.unitId) return;
  const wearer = context.getUnit(event.source.unitId);
  const target = context.getUnit(event.targetId);
  if (!wearer || !target || wearer.hp <= 0 || target.hp <= 0 || target.side === wearer.side
    || wearer.soulId !== yuanxingTempleIds.soul || !soulsEnabled(wearer)
    || firstEligibleCarrier(context, wearer.side)?.unitId !== wearer.unitId) return;

  const actionId = event.actionId ?? context.state.counters.action;
  const marker = wearer.statuses.find(status => status.statusId === yuanxingTempleIds.actionTargets
    && status.source.unitId === wearer.unitId);
  const previousAction = Number(marker?.values?.actionId ?? -1);
  const priorTargets = previousAction === actionId && typeof marker?.values?.targetIds === 'string'
    ? String(marker.values.targetIds).split('\u001f').filter(Boolean) : [];
  if (priorTargets.includes(target.unitId)) return [];
  const targetIds = [...priorTargets, target.unitId];
  const source = yuanxingSource(wearer.unitId);
  const markerInstance: StatusInstance = { instanceId: `${yuanxingTempleIds.actionTargets}:${wearer.unitId}`,
    statusId: yuanxingTempleIds.actionTargets, source, stacks: 1, duration: { kind: 'permanent' },
    values: { actionId, targetIds: targetIds.join('\u001f') } };
  const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: wearer.unitId, instance: markerInstance,
    parentEventId: event.eventId }];
  const duration = { kind: 'count' as const, remaining: 2, owner: 'target-turn' as const };
  for (const ally of context.getLivingUnits(wearer.side)) {
    if (ally.unitKind === 'summon') continue;
    commands.push({ type: 'add-status', source, targetId: ally.unitId, instance: {
      instanceId: `${yuanxingTempleIds.teamDamage}:${wearer.unitId}:${ally.unitId}`,
      statusId: yuanxingTempleIds.teamDamage, source, stacks: 1, duration,
      modifiers: [{ stat: 'damage', operation: 'percent', amount: .05, perStack: true }],
    }, parentEventId: event.eventId });
  }
  return commands;
}

function clearActionTargets(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || !event.intent) return;
  const actor = context.getUnit(event.intent.actorId);
  if (!actor || actor.soulId !== yuanxingTempleIds.soul
    || !actor.statuses.some(status => status.statusId === yuanxingTempleIds.actionTargets)) return;
  return [{ type: 'remove-statuses', source: yuanxingSource(actor.unitId), targetId: actor.unitId,
    statusIds: [yuanxingTempleIds.actionTargets], reason: 'consumed', parentEventId: event.eventId }];
}

function firstEligibleCarrier(context: BattleContext, side: UnitState['side']): UnitState | undefined {
  return context.getLivingUnits(side).find(unit => unit.soulId === yuanxingTempleIds.soul && soulsEnabled(unit));
}

function yuanxingSource(unitId: string): SourceRef {
  return { kind: 'soul', id: yuanxingTempleIds.soul, unitId };
}
