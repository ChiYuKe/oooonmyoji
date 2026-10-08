import type { ContentRegistry } from './registry';
import type { SourceRef, StatusInstance } from '../core/types';
import { soulsEnabled } from '../core/soul-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';

export const controlSoulIds = {
  sanmi: 'soul:300007',
  sanmiSpeed: 'status.soul.300007.speed',
  diceGhost: 'soul:300033',
  echoingValley: 'soul:300049',
} as const;

/** Control-linked support soul effects. */
export function registerControlSouls(registry: ContentRegistry): void {
  registry.registerStatus({ id: controlSoulIds.sanmiSpeed, mechanicsCoverage: 'verified', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'add-stack', maxStacks: 2 });
  registry.registerSoul({ id: controlSoulIds.sanmi, mechanicsCoverage: 'verified', handlers: {
    'control-application': { priority: 155, handle(context, event) {
      if (event.type !== 'control-applied') return;
      const controlled = context.getUnit(event.targetId);
      if (!controlled || controlled.hp <= 0) return;
      const wearer = context.getLivingUnits(controlled.side).find(unit => unit.soulId === controlSoulIds.sanmi && soulsEnabled(unit));
      if (!wearer) return;
      const current = controlled.statuses.find(status => status.statusId === controlSoulIds.sanmiSpeed
        && status.source.id === controlSoulIds.sanmi);
      if ((current?.stacks ?? 0) >= 2) return;
      const source: SourceRef = { kind: 'soul', id: controlSoulIds.sanmi, unitId: current?.source.unitId ?? wearer.unitId };
      const instance: StatusInstance = { instanceId: `${controlSoulIds.sanmiSpeed}:${controlled.unitId}`,
        statusId: controlSoulIds.sanmiSpeed, source, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
        modifiers: [{ stat: 'speed', operation: 'flat', amount: 30, perStack: true }] };
      return [{ type: 'add-status', source, targetId: controlled.unitId, instance, parentEventId: event.eventId }];
    } },
  } });

  registry.registerSoul({ id: controlSoulIds.diceGhost, mechanicsCoverage: 'verified', handlers: {
    'control-application': { priority: 160, handle(context, event) {
      if (event.type === 'control-applied') {
        if (!event.newlyControlled) return;
        const wearer = context.getUnit(event.targetId);
        if (!wearer || wearer.hp <= 0 || wearer.soulId !== controlSoulIds.diceGhost || !soulsEnabled(wearer)) return;
        return [{ type: 'change-action-gauge', source: diceGhostSource(wearer.unitId), targetId: wearer.unitId,
          amount: 25, parentEventId: event.eventId }];
      }
      if (event.type !== 'control-resisted' || !event.source.unitId) return;
      const wearer = context.getUnit(event.targetId);
      const source = context.getUnit(event.source.unitId);
      const wearerStats = wearer && context.getEffectiveStats(wearer.unitId);
      const sourceStats = source && context.getEffectiveStats(source.unitId);
      if (!wearer || wearer.hp <= 0 || wearer.soulId !== controlSoulIds.diceGhost || !soulsEnabled(wearer)
        || !source || source.hp <= 0 || !wearerStats || !sourceStats) return;
      const damage = context.calculateDamage({ attack: wearerStats.attack, defense: sourceStats.defense,
        defenseIgnore: effectiveDefenseIgnore(wearer), ratio: 1.5, critChance: wearerStats.crit,
        critDamage: wearerStats.critDamage }, wearer, source);
      const soulSource: SourceRef = { kind: 'soul', id: controlSoulIds.diceGhost, unitId: wearer.unitId };
      return [{ type: 'schedule-attack', source: soulSource, scheduling: 'counter', parentEventId: event.eventId,
        intent: { actorId: wearer.unitId, skillId: controlSoulIds.diceGhost, targetIds: [source.unitId],
          shape: 'single', targetRelation: 'enemy', kind: 'passive' }, suppressSourcePassiveTriggers: true,
        hits: [{ targetId: source.unitId, amount: damage.amount,
          ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical }] }];
    } },
  } });

  registry.registerSoul({ id: controlSoulIds.echoingValley, mechanicsCoverage: 'verified', handlers: {
    'control-application': { priority: 165, handle(context, event) {
      if (event.type !== 'control-resisted' || !event.source.unitId) return;
      const wearer = context.getUnit(event.targetId);
      const attacker = context.getUnit(event.source.unitId);
      if (!wearer || wearer.hp <= 0 || wearer.soulId !== controlSoulIds.echoingValley || !soulsEnabled(wearer)
        || !attacker || attacker.hp <= 0 || context.random() >= .5) return;
      const source: SourceRef = { kind: 'soul', id: controlSoulIds.echoingValley, unitId: wearer.unitId };
      return [{ type: 'apply-control', source, targetId: attacker.unitId,
        instance: { instanceId: `${controlSoulIds.echoingValley}:reflection:${event.eventId}`, statusId: event.controlStatusId,
          source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
          values: { controlType: event.controlType, reflectedFromUnitId: wearer.unitId } }, parentEventId: event.eventId }];
    } },
  } });
}

function diceGhostSource(unitId: string): SourceRef {
  return { kind: 'soul', id: controlSoulIds.diceGhost, unitId };
}
