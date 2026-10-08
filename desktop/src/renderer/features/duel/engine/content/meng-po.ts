import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, UnitState } from '../core/types';
import { attemptControl } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const mengPoIds = {
  hero: 215,
  basic: '2151',
  ram: '2152',
  bowl: '2153',
  silence: 'status.hero.215.silence',
} as const;

export function registerMengPo(registry: ContentRegistry): void {
  registry.registerStatus({ id: mengPoIds.silence, mechanicsCoverage: 'partial', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsSkill: true });
  const definition: HeroDefinition = {
    id: mengPoIds.hero,
    skills: [createBasic(), createRam(), createBowl()],
    aiCoverage: 'verified',
    mechanicsCoverage: 'partial',
    handlers: {
      hit: { priority: 145, handle(context, event) { return onHit(context, event); } },
      'control-application': { priority: 88, handle(context, event) { return knockBackIfSilenceFails(context, event); } },
      'action-end': { priority: 72, handle(context, event) { return passiveGauge(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (enemies.length === 0) return undefined;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      const useBowl = enemies.length >= 2 && fire >= 3 || enemies.length === 1 && fire > 5;
      if (useBowl) return { actorId: unitId, skillId: mengPoIds.bowl, targetIds: enemies.map(unit => unit.unitId),
        shape: 'all-enemies', targetRelation: 'enemy' };
      if (fire < 3 && context.random() < .5 && fire >= 1) {
        return { actorId: unitId, skillId: mengPoIds.ram, targetIds: [lowestRatio(enemies).unitId], shape: 'single', targetRelation: 'enemy' };
      }
      return { actorId: unitId, skillId: mengPoIds.basic, targetIds: [lowestRatio(enemies).unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function createBasic(): SkillDefinition {
  return { id: mengPoIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: [1, 1.05, 1.1, 1.15, 1.2].map(ratio => ({ ratio })),
    execute(context, intent, parameters) { return damage(context, intent.actorId, intent.targetIds.slice(0, 1), mengPoIds.basic, Number(parameters.ratio ?? 1)); } };
}

function createRam(): SkillDefinition {
  return { id: mengPoIds.ram, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 1 },
    target: 'single', targetRelation: 'enemy', levels: [1.3, 1.37, 1.44, 1.51, 1.58].map(ratio => ({ ratio })),
    execute(context, intent, parameters) { return damage(context, intent.actorId, intent.targetIds.slice(0, 1), mengPoIds.ram, Number(parameters.ratio ?? 1.3)); } };
}

function createBowl(): SkillDefinition {
  return { id: mengPoIds.bowl, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: [1.3, 1.37, 1.44, 1.51, 1.58].map(ratio => ({ ratio })),
    execute(context, intent, parameters) { return damage(context, intent.actorId, intent.targetIds, mengPoIds.bowl, Number(parameters.ratio ?? 1.3)); } };
}

function damage(context: BattleContext, actorId: string, targetIds: readonly string[], skillId: string, ratio: number): EffectCommand[] {
  const actor = context.getUnit(actorId);
  const actorStats = context.getEffectiveStats(actorId);
  if (!actor || !actorStats) return [];
  return targetIds.flatMap(targetId => {
    const target = context.getUnit(targetId);
    const targetStats = context.getEffectiveStats(targetId);
    if (!target || !targetStats || target.hp <= 0) return [];
    const hit = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense, defenseIgnore: effectiveDefenseIgnore(actor),
      ratio, critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
    return [{ type: 'deal-damage' as const, source: source(skillId, actor.unitId), targetId,
      amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
  });
}

function onHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || ![mengPoIds.ram, mengPoIds.bowl].includes(event.source.id as typeof mengPoIds.ram | typeof mengPoIds.bowl)
    || !event.source.unitId) return;
  const attacker = context.getUnit(event.source.unitId);
  const target = context.getUnit(event.targetId);
  if (!attacker || attacker.heroId !== mengPoIds.hero || !passivesEnabled(attacker) || !target || target.hp <= 0) return;
  const isBowl = event.source.id === mengPoIds.bowl;
  const control = attemptControl(context, { attemptId: `${mengPoIds.silence}:${attacker.unitId}:${target.unitId}:${event.eventId}`,
    source: source(event.source.id, attacker.unitId), targetId: target.unitId, statusId: mengPoIds.silence,
    controlType: '沉默', baseChance: isBowl ? .6 : .5,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, parentEventId: event.eventId });
  const commands: EffectCommand[] = [];
  if (control) commands.push(control);
  else if (isBowl) commands.push({ type: 'change-action-gauge', source: source(mengPoIds.bowl, attacker.unitId),
    targetId: target.unitId, amount: -20, parentEventId: event.eventId });
  if (!isBowl) commands.push({ type: 'change-action-gauge', source: source(mengPoIds.ram, attacker.unitId),
    targetId: target.unitId, amount: -40, parentEventId: event.eventId });
  return commands;
}

function knockBackIfSilenceFails(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'control-resisted' && event.type !== 'control-blocked') return;
  if (event.controlStatusId !== mengPoIds.silence || event.source.id !== mengPoIds.bowl || !event.source.unitId) return;
  const attacker = context.getUnit(event.source.unitId);
  const target = context.getUnit(event.targetId);
  if (!attacker || attacker.heroId !== mengPoIds.hero || !passivesEnabled(attacker) || !target || target.hp <= 0) return;
  return [{ type: 'change-action-gauge', source: source(mengPoIds.bowl, attacker.unitId),
    targetId: target.unitId, amount: -20, parentEventId: event.eventId }];
}

function passiveGauge(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'action-ended' || event.actionKind !== 'basic' || !event.source.unitId) return;
  const actor = context.getUnit(event.source.unitId);
  if (!actor) return;
  return context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue')
    .filter(unit => unit.heroId === mengPoIds.hero && passivesEnabled(unit))
    .map(unit => ({ type: 'change-action-gauge' as const, source: source(mengPoIds.ram, unit.unitId), targetId: unit.unitId,
      amount: 5, parentEventId: event.eventId }));
}

function lowestRatio(units: readonly UnitState[]): UnitState {
  return units.slice().sort((left, right) => left.hp / left.stats.hp - right.hp / right.stats.hp)[0]!;
}

function source(id: string, unitId: string) { return { kind: 'skill' as const, id, unitId }; }
