import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ActionIntent, BattleContext, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { attemptControl } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const eaterIds = {
  hero: 214,
  basic: '2141',
  passive: '2142',
  ultimate: '2143',
  food: 'status.hero.214.steamed-bun',
  swallowed: 'status.hero.214.swallowed',
} as const;

export function registerEater(registry: ContentRegistry): void {
  registry.registerStatus({ id: eaterIds.food, mechanicsCoverage: 'partial', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 4 });
  registry.registerStatus({ id: eaterIds.swallowed, mechanicsCoverage: 'partial', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  const basic = createEaterBasic();
  const ultimate = createEaterUltimate();
  const definition: HeroDefinition = {
    id: eaterIds.hero, skills: [basic, ultimate], aiCoverage: 'verified', mechanicsCoverage: 'partial',
    handlers: {
      hit: { priority: 140, handle(context, event) {
        if (event.type !== 'damage') return;
        const commands: EffectCommand[] = [];
        const attacker = event.source.unitId ? context.getUnit(event.source.unitId) : undefined;
        const target = context.getUnit(event.targetId);
        if (!target) return;
        if (event.source.id === eaterIds.basic && attacker?.heroId === eaterIds.hero && passivesEnabled(attacker) && target.hp > 0) {
          const buffs = stealableBuffs(context, target);
          if (buffs.length > 0 && context.random() < .2) {
            const selected = buffs[Math.floor(context.random() * buffs.length)]!;
            commands.push({ type: 'transfer-status', source: eaterSource(eaterIds.basic, attacker.unitId),
              fromTargetId: target.unitId, toTargetId: attacker.unitId, instanceId: selected.instanceId, parentEventId: event.eventId });
          }
        }
        if (event.source.id === eaterIds.ultimate && attacker?.heroId === eaterIds.hero && passivesEnabled(attacker)) {
          if (event.hpAfter !== undefined && event.hpAfter <= 0) return [...commands, ...addFood(attacker, event.eventId)];
          if (!target || target.hp <= 0) return commands;
          const food = attacker.statuses.find(status => status.statusId === eaterIds.food)?.stacks ?? 0;
          const control = attemptControl(context, { attemptId: `${eaterIds.swallowed}:${attacker.unitId}:${target.unitId}:${event.eventId}`,
            source: eaterSource(eaterIds.ultimate, attacker.unitId), targetId: target.unitId, statusId: eaterIds.swallowed,
            controlType: '吞食', baseChance: .3 + .3 * food,
            duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId: event.eventId });
          if (!control) commands.push(...addFood(attacker, event.eventId));
          else commands.push(control);
        }
        const swallowed = target.statuses.find(status => status.statusId === eaterIds.swallowed);
        if (swallowed && event.source.unitId !== swallowed.source.unitId && context.random() < .15) {
          commands.push({ type: 'remove-statuses', source: swallowed.source, targetId: target.unitId,
            statusIds: [eaterIds.swallowed], reason: 'consumed', parentEventId: event.eventId }, ...dispelAllBuffs(context, target, swallowed.source, event.eventId));
        }
        return commands;
      } },
      'control-application': { priority: 85, handle(context, event) {
        if (event.type === 'control-applied' && event.statusId === eaterIds.swallowed) {
          const eaterId = event.source.unitId;
          const eater = eaterId ? context.getUnit(eaterId) : undefined;
          if (!eater) return;
          return [{ type: 'remove-statuses', source: eaterSource(eaterIds.ultimate, eater.unitId), targetId: eater.unitId,
            statusIds: [eaterIds.food], reason: 'consumed', parentEventId: event.eventId }];
        }
        if ((event.type === 'control-resisted' && event.controlStatusId === eaterIds.swallowed)
          || (event.type === 'control-blocked' && event.controlStatusId === eaterIds.swallowed)) {
          const eaterId = event.source.unitId;
          const eater = eaterId ? context.getUnit(eaterId) : undefined;
          return eater ? addFood(eater, event.eventId) : undefined;
        }
      } },
      'turn-end': { priority: 42, handle(context, event) {
        if (event.type !== 'turn-ended') return;
        const target = context.getUnit(event.unitId);
        const swallowed = target?.statuses.find(status => status.statusId === eaterIds.swallowed);
        if (!target || !swallowed) return;
        return [{ type: 'remove-statuses', source: swallowed.source, targetId: target.unitId,
          statusIds: [eaterIds.swallowed], reason: 'consumed', parentEventId: event.eventId },
        ...dispelAllBuffs(context, target, swallowed.source, event.eventId)];
      } },
      'attack-end': { priority: 150, handle(context, event) {
        if (event.type !== 'attack-ended' || !event.source.unitId || event.actionKind === 'passive') return;
        const ally = context.getUnit(event.source.unitId);
        if (!ally || ally.hp <= 0) return;
        const eaters = context.getLivingUnits(ally.side).filter(unit => unit.heroId === eaterIds.hero && unit.unitId !== ally.unitId
          && passivesEnabled(unit));
        return eaters.flatMap(eater => {
          const chance = [.1, .15, .2, .25, .3][Math.max(0, Math.min(4, eater.skillLevel - 1))]!;
          if (context.random() >= chance) return [];
          const markedTargets = (event.targetHealthChanges ?? []).map(change => context.getUnit(change.targetId))
            .filter((unit): unit is UnitState => Boolean(unit && unit.hp > 0 && unit.side !== eater.side));
          const enemies = markedTargets.length > 0 ? markedTargets : context.getLivingUnits(eater.side === 'blue' ? 'red' : 'blue');
          if (!enemies.length) return [];
          const target = enemies[Math.floor(context.random() * enemies.length)]!;
          const actorStats = context.getEffectiveStats(eater.unitId) ?? eater.stats;
          const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
          const ratio = [1, 1.05, 1.1, 1.15, 1.25][Math.max(0, Math.min(4, eater.skillLevel - 1))]!;
          const hit = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
            defenseIgnore: effectiveDefenseIgnore(eater), ratio, critChance: actorStats.crit,
            critDamage: actorStats.critDamage }, eater, target);
          const intent: ActionIntent = { actorId: eater.unitId, skillId: eaterIds.basic, targetIds: [target.unitId],
            shape: 'single', targetRelation: 'enemy', kind: 'passive' };
          return [{ type: 'schedule-attack' as const, source: eaterSource(eaterIds.passive, eater.unitId), intent,
            scheduling: 'assist' as const, hits: [{ targetId: target.unitId, amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }],
            parentEventId: event.eventId }];
        });
      } },
      'unit-defeated': { priority: 46, handle(context, event) {
        if (event.type !== 'unit-defeated' || !event.source.unitId) return;
        const eater = context.getUnit(event.source.unitId);
        if (!eater || eater.heroId !== eaterIds.hero || !passivesEnabled(eater)) return;
        return [{ type: 'restore-health', source: eaterSource(eaterIds.passive, eater.unitId),
          targetId: eater.unitId, amount: eater.stats.hp, parentEventId: event.eventId }];
      } },
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 3) {
        const target = enemies.slice().sort((left, right) => left.hp / left.stats.hp - right.hp / right.stats.hp)[0]!;
        return { actorId: unitId, skillId: eaterIds.ultimate, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
      }
      const target = enemies.slice().sort((left, right) => left.hp / left.stats.hp - right.hp / right.stats.hp)[0]!;
      return { actorId: unitId, skillId: eaterIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function createEaterBasic(): SkillDefinition {
  return { id: eaterIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: [1, 1.05, 1.1, 1.15, 1.25].map(ratio => ({ ratio })),
    execute(context, intent, parameters) { return eaterHit(context, intent.actorId, intent.targetIds[0] ?? '', eaterIds.basic, Number(parameters.ratio ?? 1)); } };
}

function createEaterUltimate(): SkillDefinition {
  return { id: eaterIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', levels: [1, 1.05, 1.1, 1.15, 1.2].map(ratio => ({ ratio })),
    execute(context, intent, parameters) { return eaterHit(context, intent.actorId, intent.targetIds[0] ?? '', eaterIds.ultimate, Number(parameters.ratio ?? 1)); } };
}

function eaterHit(context: BattleContext, actorId: string, targetId: string, skillId: string, ratio: number): EffectCommand[] {
  const actor = context.getUnit(actorId);
  const actorStats = context.getEffectiveStats(actorId);
  const target = context.getUnit(targetId);
  const targetStats = target && context.getEffectiveStats(target.unitId);
  if (!actor || !actorStats || !target || !targetStats) return [];
  const hit = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense, defenseIgnore: effectiveDefenseIgnore(actor),
    ratio, critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
  return [{ type: 'deal-damage', source: eaterSource(skillId, actor.unitId), targetId: target.unitId,
    amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
}

function addFood(eater: UnitState, parentEventId: string): EffectCommand[] {
  if ((eater.statuses.find(status => status.statusId === eaterIds.food)?.stacks ?? 0) >= 4) return [];
  const source = eaterSource(eaterIds.passive, eater.unitId);
  const instance: StatusInstance = { instanceId: `${eaterIds.food}:${eater.unitId}`,
    statusId: eaterIds.food, source, stacks: 1, duration: { kind: 'permanent' } };
  return [{ type: 'add-status', source, targetId: eater.unitId, instance, parentEventId }];
}

function stealableBuffs(context: BattleContext, target: UnitState): readonly StatusInstance[] {
  return target.statuses.filter(status => {
    const category = context.getStatusCategory(status.statusId);
    return (category === 'buff' || category === 'shield') && context.isStatusDispellable(status.statusId);
  });
}

function dispelAllBuffs(context: BattleContext, target: UnitState, source: SourceRef, parentEventId: string): EffectCommand[] {
  const statusIds = [...new Set(stealableBuffs(context, target).map(status => status.statusId))];
  return statusIds.length ? [{ type: 'dispel-statuses', source, targetId: target.unitId, statusIds, parentEventId }] : [];
}

function eaterSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
