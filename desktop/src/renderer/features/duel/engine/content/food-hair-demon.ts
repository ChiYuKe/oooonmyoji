import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { BattleContext, BattleEvent, EffectCommand } from '../core/types';
import { attemptControl } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createSleepStatusDefinition, dreamEaterRetainsSleep } from './common-statuses';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const foodHairDemonIds = {
  hero: 221,
  basic: '2211',
  sleep: '2212',
  sleepStatus: 'status.hero.221.sleep',
  ultimate: '2213',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.2] as const;
const ultimateRatios = [.87, .91, .96, 1, 1.04] as const;

export function registerFoodHairDemon(registry: ContentRegistry): void {
  registry.registerStatus(createSleepStatusDefinition(foodHairDemonIds.sleepStatus, 'partial', dreamEaterRetainsSleep));
  const definition: HeroDefinition = {
    id: foodHairDemonIds.hero,
    skills: [createBasicAttackSkill(foodHairDemonIds.basic, basicRatios), createSleepSkill(), createUltimate()],
    aiCoverage: 'verified',
    mechanicsCoverage: 'partial',
    handlers: {
      hit: { priority: 140, handle(context, event) { return pushBackOnUltimateHit(context, event); } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = enemies.slice().sort((left, right) => left.hp / left.stats.hp - right.hp / right.stats.hp)[0]!;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      let skillId: string = foodHairDemonIds.basic;
      if (enemies.length >= 2 && fire > 5) skillId = foodHairDemonIds.ultimate;
      else if (enemies.length >= 2 && fire > 3 && fire < 5 && context.random() < .5) skillId = foodHairDemonIds.sleep;
      return skillId === foodHairDemonIds.ultimate
        ? { actorId: unitId, skillId, targetIds: enemies.map(enemy => enemy.unitId), shape: 'all-enemies', targetRelation: 'enemy' }
        : { actorId: unitId, skillId, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function createSleepSkill(): SkillDefinition {
  return {
    id: foodHairDemonIds.sleep,
    actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single',
    targetRelation: 'enemy',
    levels: [{ chance: 1 }, { chance: 1 }, { chance: 1 }, { chance: 1 }, { chance: 1 }],
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const targetId = intent.targetIds[0];
      if (!actor || !targetId) return [];
      const source = { kind: 'skill' as const, id: foodHairDemonIds.sleep, unitId: actor.unitId };
      const result = attemptControl(context, { attemptId: `${foodHairDemonIds.sleepStatus}:${actor.unitId}:${context.state.counters.action}:${targetId}`,
        source, targetId, statusId: foodHairDemonIds.sleepStatus, controlType: '睡眠', baseChance: Number(parameters.chance ?? 1),
        duration: { kind: 'count', remaining: 1, owner: 'target-turn' } });
      return result ? [result] : [];
    },
  };
}

function createUltimate(): SkillDefinition {
  return {
    id: foodHairDemonIds.ultimate,
    actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies',
    targetRelation: 'enemy',
    levels: ultimateRatios.map(ratio => ({ ratio, gaugeReduction: 30 })),
    execute(context, intent, parameters) {
      return damage(context, intent.actorId, intent.targetIds, foodHairDemonIds.ultimate, Number(parameters.ratio ?? .87));
    },
  };
}

function damage(context: BattleContext, actorId: string, targetIds: readonly string[], skillId: string, ratio: number): EffectCommand[] {
  const actor = context.getUnit(actorId);
  const attack = context.getEffectiveStats(actorId);
  if (!actor || !attack) return [];
  return targetIds.flatMap(targetId => {
    const target = context.getUnit(targetId);
    const defense = target && context.getEffectiveStats(targetId);
    if (!target || !defense || target.hp <= 0) return [];
    const hit = context.calculateDamage({ attack: attack.attack, defense: defense.defense,
      defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: attack.crit, critDamage: attack.critDamage }, actor, target);
    return [{ type: 'deal-damage' as const, source: { kind: 'skill' as const, id: skillId, unitId: actor.unitId },
      targetId, amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
  });
}

function pushBackOnUltimateHit(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.source.id !== foodHairDemonIds.ultimate) return;
  const actorId = event.source.unitId;
  const target = context.getUnit(event.targetId);
  if (!actorId || !target || target.hp <= 0) return;
  return [{ type: 'change-action-gauge', source: { kind: 'skill', id: foodHairDemonIds.ultimate, unitId: actorId },
    targetId: target.unitId, amount: -30, parentEventId: event.eventId }];
}
