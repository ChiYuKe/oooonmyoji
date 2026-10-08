import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import { passivesEnabled } from '../core/passive-eligibility';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { attemptControl } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const tanukiIds = {
  hero: 208,
  basic: '2081',
  passive: '2082',
  ultimate: '2083',
  provoke: 'status.hero.208.provoke',
  sake: 'status.hero.208.sake',
  drunk: 'status.hero.208.drunk',
  sakeFire: 'status.hero.208.sake-fire',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.2] as const;
const ultDamageRatios = [.12, .14, .16, .18, .2] as const;
const ultHealRatios = [.18, .18, .18, .18, .18] as const;
const drunkHealRatios = [.06, .08, .08, .08, .08] as const;

export function registerTanuki(registry: ContentRegistry): void {
  registry.registerStatus({ id: tanukiIds.sake, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'permanent', refreshPolicy: 'add-stack', maxStacks: 5 });
  registry.registerStatus({ id: tanukiIds.drunk, mechanicsCoverage: 'partial', category: 'other', dispellable: false,
    sealable: false, durationOwner: 'event', refreshPolicy: 'replace' });
  registry.registerStatus({ id: tanukiIds.sakeFire, mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', maxStacks: 5 });

  const basic: SkillDefinition = {
    id: tanukiIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = intent.targetIds.map(id => context.getUnit(id)).find((unit): unit is UnitState => Boolean(unit && unit.hp > 0));
      const actorStats = actor && context.getEffectiveStats(actor.unitId);
      const targetStats = target && context.getEffectiveStats(target.unitId);
      if (!actor || !target || !actorStats || !targetStats) return [];
      const source = tanukiSource(tanukiIds.basic, actor.unitId);
      const damage = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
        defenseIgnore: effectiveDefenseIgnore(actor), ratio: Number(parameters.ratio ?? 1),
        critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
      const commands: EffectCommand[] = [{ type: 'deal-damage', source, targetId: target.unitId,
        amount: damage.amount, ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical }];
      commands.push(...addSake(actor.unitId, target, source));
      const provoke = attemptControl(context, { attemptId: `${tanukiIds.provoke}:${actor.unitId}:${target.unitId}:${context.state.counters.hit}`,
        source, targetId: target.unitId, statusId: tanukiIds.provoke, controlType: '挑衅', baseChance: .5,
        duration: { kind: 'count', remaining: 1, owner: 'target-turn' } });
      if (provoke) commands.push(provoke);
      return commands;
    },
  };

  const ultimate: SkillDefinition = {
    id: tanukiIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy',
    levels: ultDamageRatios.map((ratio, index) => ({ ratio, healRatio: ultHealRatios[index]!, fireRatio: .05 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const stats = actor && context.getEffectiveStats(actor.unitId);
      if (!actor || actor.hp <= 0 || !stats) return [];
      const source = tanukiSource(tanukiIds.ultimate, actor.unitId);
      const commands: EffectCommand[] = [{ type: 'heal', source, targetId: actor.unitId,
        amount: actor.stats.hp * Number(parameters.healRatio ?? .18) }];
      const currentHpAfterHeal = Math.min(actor.stats.hp, actor.hp + actor.stats.hp * Number(parameters.healRatio ?? .18));
      for (const targetId of intent.targetIds) {
        const target = context.getUnit(targetId);
        const targetStats = target && context.getEffectiveStats(target.unitId);
        if (!target || target.hp <= 0 || target.side === actor.side || !targetStats) continue;
        const damage = context.calculateDamage({ attack: currentHpAfterHeal, defense: targetStats.defense,
          defenseIgnore: effectiveDefenseIgnore(actor), ratio: Number(parameters.ratio ?? .12),
          critChance: stats.crit, critDamage: stats.critDamage }, actor, target);
        commands.push({ type: 'deal-damage', source, targetId: target.unitId,
          amount: damage.amount, ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical });
        const sake = target.statuses.find(status => status.statusId === tanukiIds.sake);
        if (!sake || sake.stacks <= 0) continue;
        const stacks = Math.min(5, sake.stacks);
        commands.push({ type: 'remove-status-instances', source, targetId: target.unitId,
          instanceIds: [sake.instanceId], reason: 'consumed' });
        commands.push({ type: 'add-status', source, targetId: target.unitId,
          instance: { instanceId: `${tanukiIds.sakeFire}:${actor.unitId}:${target.unitId}`,
            statusId: tanukiIds.sakeFire, source, stacks,
            duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
            values: { damagePerStack: actor.stats.hp * Number(parameters.fireRatio ?? .05) } } });
      }
      return commands;
    },
  };

  const definition: HeroDefinition = {
    id: tanukiIds.hero, skills: [basic, ultimate], aiCoverage: 'verified', mechanicsCoverage: 'partial',
    policy(context: BattleContext, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const sakeCount = enemies.reduce((count, enemy) => count + (enemy.statuses
        .find(status => status.statusId === tanukiIds.sake)?.stacks ?? 0), 0);
      const skillThreeWeight = .85 + .1 * sakeCount;
      const skillOneWeight = .8 + context.random() * .4;
      const skillId = context.random() * (skillOneWeight + skillThreeWeight) < skillThreeWeight
        ? tanukiIds.ultimate : tanukiIds.basic;
      return skillId === tanukiIds.ultimate && (context.state.resources[actor.side]?.fire ?? 0) < 3
        ? targetBasic(actor, enemies)
        : skillId === tanukiIds.ultimate
          ? { actorId: actor.unitId, skillId, targetIds: enemies.map(unit => unit.unitId), shape: 'all-enemies', targetRelation: 'enemy' }
          : targetBasic(actor, enemies);
    },
    handlers: {
      hit: { priority: 145, handle(context, event) { return wakeWhenHit(context, event); } },
      'turn-start': { priority: 60, handle(context, event) { return wakeAtTurnStart(context, event); } },
      'turn-end': { priority: 60, handle(context, event) { return fallAsleep(context, event); } },
    },
  };
  registry.registerStatus({ id: tanukiIds.provoke, mechanicsCoverage: 'partial', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsSkill: true });
  registry.registerHero(definition);
}

function targetBasic(actor: Readonly<UnitState>, enemies: readonly UnitState[]): ActionIntent {
  const target = enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0]!;
  return { actorId: actor.unitId, skillId: tanukiIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
}

function addSake(ownerUnitId: string, target: Readonly<UnitState>, source: SourceRef): EffectCommand[] {
  const current = target.statuses.find(status => status.statusId === tanukiIds.sake && status.source.unitId === ownerUnitId);
  const stacks = Math.min(5, (current?.stacks ?? 0) + 1);
  return [{ type: 'add-status', source, targetId: target.unitId,
    instance: { instanceId: `${tanukiIds.sake}:${ownerUnitId}:${target.unitId}`, statusId: tanukiIds.sake,
      source, stacks, duration: { kind: 'permanent' } } }];
}

function wakeWhenHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage') return;
  const target = context.getUnit(event.targetId);
  const attacker = event.source.unitId ? context.getUnit(event.source.unitId) : undefined;
  const drunk = target?.statuses.find(status => status.statusId === tanukiIds.drunk);
  if (!target || target.heroId !== tanukiIds.hero || !drunk || !attacker || attacker.side === target.side
    || !passivesEnabled(target) || context.random() >= .5) return;
  const source = tanukiSource(tanukiIds.passive, target.unitId);
  const commands: EffectCommand[] = [{ type: 'remove-status-instances', source, targetId: target.unitId,
    instanceIds: [drunk.instanceId], reason: 'consumed', parentEventId: event.eventId }];
  if (target.skillLevel >= 3) commands.push({ type: 'change-action-gauge', source, targetId: target.unitId,
    amount: 30, parentEventId: event.eventId });
  if (target.skillLevel >= 5) {
    for (const enemy of context.getLivingUnits(attacker.side)) commands.push(...addSake(target.unitId, enemy, source)
      .map(command => ({ ...command, parentEventId: event.eventId })));
  } else {
    commands.push(...addSake(target.unitId, attacker, source).map(command => ({ ...command, parentEventId: event.eventId })));
  }
  return commands;
}

function wakeAtTurnStart(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-started') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.hp <= 0) return;
  const commands: EffectCommand[] = actor.statuses.filter(status => status.statusId === tanukiIds.sakeFire).map(status => ({
    type: 'lose-life', source: status.source, targetId: actor.unitId,
    amount: Number(status.values?.damagePerStack ?? 0) * status.stacks, lifeLossKind: 'indirect', parentEventId: event.eventId,
  }));
  const drunk = actor?.statuses.find(status => status.statusId === tanukiIds.drunk);
  if (actor.heroId !== tanukiIds.hero || !drunk) return commands;
  const source = tanukiSource(tanukiIds.passive, actor.unitId);
  commands.push({ type: 'remove-status-instances', source, targetId: actor.unitId, instanceIds: [drunk.instanceId],
    reason: 'consumed', parentEventId: event.eventId });
  if (passivesEnabled(actor)) {
    const ratio = drunkHealRatios[Math.max(0, Math.min(4, actor.skillLevel - 1))]!;
    commands.push({ type: 'heal', source, targetId: actor.unitId, amount: actor.stats.hp * ratio, parentEventId: event.eventId });
  }
  return commands;
}

function fallAsleep(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'turn-ended') return;
  const actor = context.getUnit(event.unitId);
  if (!actor || actor.heroId !== tanukiIds.hero || actor.hp <= 0 || !passivesEnabled(actor)) return;
  const chance = actor.skillLevel >= 4 ? .4 : .2;
  if (context.random() >= chance) return;
  const source = tanukiSource(tanukiIds.passive, actor.unitId);
  return [{ type: 'add-status', source, targetId: actor.unitId, parentEventId: event.eventId,
    instance: { instanceId: `${tanukiIds.drunk}:${actor.unitId}`, statusId: tanukiIds.drunk,
      source, stacks: 1, duration: { kind: 'permanent' } } }];
}

function tanukiSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
