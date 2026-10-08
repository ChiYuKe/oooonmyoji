import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveStats } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const butterflySpiritIds = {
  hero: 241,
  basic: '2411',
  passive: '2412',
  wishDance: '2413',
  lightness: 'status.hero.241.lightness',
  dance: 'status.hero.241.butterfly-dance',
  overflowShield: 'status.hero.241.overflow-shield',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const speedThresholds = [.3, .3, .25, .25, .2] as const;
const speedPerLayer = [10, 20, 20, 30, 30] as const;
const healRatios = [.3, .31, .33, .34, .36] as const;
const damageHealRatios = [.08, .09, .1, .11, .12] as const;

export function registerButterflySpirit(registry: ContentRegistry): void {
  registry.registerStatus({ id: butterflySpiritIds.lightness, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'permanent', refreshPolicy: 'replace' });
  registry.registerStatus({ id: butterflySpiritIds.dance, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: butterflySpiritIds.overflowShield, mechanicsCoverage: 'partial', category: 'shield', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });

  const wishDance: SkillDefinition = {
    id: butterflySpiritIds.wishDance,
    actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 2 },
    resolveResourceCost(state, actor) {
      const lightness = actor.statuses.find(status => status.statusId === butterflySpiritIds.lightness);
      return { resourceId: 'fire', amount: actor.skillLevel >= 5 && (lightness?.stacks ?? 0) >= 4 ? 0 : 2 };
    },
    target: 'single',
    targetRelation: 'ally',
    levels: healRatios.map((ratio, index) => ({ ratio, damageHealRatio: damageHealRatios[index]! })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.hp <= 0 || !target || target.hp <= 0 || target.side !== actor.side) return [];
      const source = butterflySource(butterflySpiritIds.wishDance, actor.unitId);
      const commands: EffectCommand[] = [{ type: 'dispel-statuses', source, targetId: target.unitId,
        filter: 'debuff-or-control', maxCount: 3 },
      { type: 'heal', source, targetId: target.unitId, amount: target.stats.hp * Number(parameters.ratio ?? .3) },
      { type: 'add-status', source, targetId: target.unitId, instance: {
        instanceId: `${butterflySpiritIds.dance}:${actor.unitId}:${target.unitId}`, statusId: butterflySpiritIds.dance,
        source, stacks: 1, duration: { kind: 'count', remaining: 3, owner: 'target-turn' },
        values: { damageHealRatio: Number(parameters.damageHealRatio ?? .08) },
      } }];
      return commands;
    },
  };

  registry.registerHero({
    id: butterflySpiritIds.hero,
    skills: [createBasicAttackSkill(butterflySpiritIds.basic, basicRatios), wishDance],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    initialize(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.heroId !== butterflySpiritIds.hero) return [];
      return updateLightness(context, { type: 'battle-started', eventId: 'battle-start',
        phase: 'battle-start', source: butterflySource(butterflySpiritIds.passive, unitId) });
    },
    modifyIncomingDamage(attacker, target, amount) {
      if (target.heroId !== butterflySpiritIds.hero || !passivesEnabled(target)) return amount;
      return effectiveStats(attacker).attack < effectiveStats(target).attack ? amount * .7 : amount;
    },
    policy(context: BattleContext, unitId: string): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const allies = context.getLivingUnits(actor.side);
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (allies.length === 0 || enemies.length === 0) return undefined;
      const target = allies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      const lightness = actor.statuses.find(status => status.statusId === butterflySpiritIds.lightness);
      const skillCost = actor.skillLevel >= 5 && (lightness?.stacks ?? 0) >= 4 ? 0 : 2;
      if (target.hp / Math.max(1, target.stats.hp) < .75 && fire >= skillCost) {
        return { actorId: actor.unitId, skillId: butterflySpiritIds.wishDance,
          targetIds: [target.unitId], shape: 'single', targetRelation: 'ally' };
      }
      const enemy = enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      return { actorId: actor.unitId, skillId: butterflySpiritIds.basic,
        targetIds: [enemy.unitId], shape: 'single', targetRelation: 'enemy' };
    },
    handlers: {
      hit: { priority: 155, handle(context, event) { return onHit(context, event); } },
      'effect-resolution': { priority: 155, handle(context, event) { return onEffect(context, event); } },
    },
  });
}

function onHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage') return;
  const commands: EffectCommand[] = [];
  const target = context.getUnit(event.targetId);
  if (target?.hp && target.hp > 0) {
    const dance = target.statuses.find(status => status.statusId === butterflySpiritIds.dance);
    const ratio = Number(dance?.values?.damageHealRatio ?? 0);
    if (dance && Number.isFinite(ratio) && ratio > 0) commands.push({ type: 'heal', source: dance.source,
      targetId: target.unitId, amount: target.stats.hp * ratio, parentEventId: event.eventId });
  }
  commands.push(...updateLightness(context, event));
  return commands;
}

function onEffect(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  const commands: EffectCommand[] = [];
  if (event.type === 'healing' && event.source.id === butterflySpiritIds.wishDance && event.source.unitId
    && event.amount > event.hpGained) {
    const healer = context.getUnit(event.source.unitId);
    const target = context.getUnit(event.targetId);
    if (healer?.heroId === butterflySpiritIds.hero && target && target.hp > 0) {
      const source = butterflySource(butterflySpiritIds.wishDance, healer.unitId);
      commands.push({ type: 'add-status', source, targetId: target.unitId, parentEventId: event.eventId, instance: {
        instanceId: `${butterflySpiritIds.overflowShield}:${healer.unitId}:${target.unitId}`,
        statusId: butterflySpiritIds.overflowShield, source, stacks: 1,
        duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
        values: { shieldRemaining: healer.stats.hp * .05 },
      } });
    }
  }
  if (event.type === 'healing' || event.type === 'health-restored' || event.type === 'life-lost' || event.type === 'unit-revived') {
    commands.push(...updateLightness(context, event));
  }
  return commands;
}

function updateLightness(context: BattleContext, event: BattleEvent): EffectCommand[] {
  const commands: EffectCommand[] = [];
  for (const side of ['blue', 'red'] as const) {
    const allies = context.getLivingUnits(side);
    const lowestRatio = allies.length > 0 ? Math.min(...allies.map(unit => unit.hp / Math.max(1, unit.stats.hp))) : 1;
    for (const unitId of context.state.sides[side]) {
      const unit = context.getUnit(unitId);
      if (!unit || unit.heroId !== butterflySpiritIds.hero || unit.hp <= 0) continue;
      const previous = unit.statuses.find(status => status.statusId === butterflySpiritIds.lightness);
      const levelIndex = Math.max(0, Math.min(speedThresholds.length - 1, unit.skillLevel - 1));
      const threshold = speedThresholds[levelIndex]!;
      const amountPerLayer = speedPerLayer[levelIndex]!;
      const layers = passivesEnabled(unit) ? Math.max(0, Math.floor((1 - lowestRatio + 1e-9) / threshold)) : 0;
      const currentAmount = previous?.modifiers?.find(modifier => modifier.stat === 'speed')?.amount ?? 0;
      const nextAmount = layers * amountPerLayer;
      if (layers === 0) {
        if (previous) commands.push({ type: 'remove-status-instances', source: previous.source, targetId: unit.unitId,
          instanceIds: [previous.instanceId], reason: 'consumed', parentEventId: event.eventId });
      } else if (previous?.stacks !== layers || Math.abs(currentAmount - nextAmount) > 1e-9) {
        const source = butterflySource(butterflySpiritIds.passive, unit.unitId);
        commands.push({ type: 'add-status', source, targetId: unit.unitId, parentEventId: event.eventId,
          instance: { instanceId: `${butterflySpiritIds.lightness}:${unit.unitId}`, statusId: butterflySpiritIds.lightness,
            source, stacks: layers, duration: { kind: 'permanent' },
            modifiers: [{ stat: 'speed', operation: 'flat', amount: nextAmount }] } });
      }
    }
  }
  return commands;
}

function butterflySource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
