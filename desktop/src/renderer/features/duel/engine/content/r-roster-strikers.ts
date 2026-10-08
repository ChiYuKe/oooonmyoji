import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, EffectCommand, UnitState } from '../core/types';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const umbrellaGhostIds = { hero: 403, basic: '4031', skill: '4032' } as const;
export const greenOniIds = { hero: 404, basic: '4041', skill: '4042' } as const;
export const tombRaiderOniIds = { hero: 400, basic: '4001' } as const;
export const parasiticSoulIds = { hero: 401, basic: '4011' } as const;
export const broomSpriteIds = { hero: 408, basic: '4081', skill: '4082' } as const;
export const ootenguGuaIds = { hero: 414, basic: '4141', skill: '4142' } as const;
export const arakawaGuaIds = { hero: 416, basic: '4161', skill: '4162' } as const;
export const youngDeerGuaIds = { hero: 419, basic: '4191', skill: '4192' } as const;

export function registerRRankStrikers(registry: ContentRegistry): void {
  registry.registerHero(createBasicOnly(tombRaiderOniIds.hero, tombRaiderOniIds.basic, '盗墓小鬼'));
  registry.registerHero(createBasicOnly(parasiticSoulIds.hero, parasiticSoulIds.basic, '寄生魂'));
  registry.registerHero(createUmbrellaGhost());
  registry.registerHero(createGreenOni());
  registry.registerHero(createBroomSprite());
  registry.registerHero(createOotenguGua());
  registry.registerHero(createArakawaGua());
  registry.registerHero(createYoungDeerGua());
}

function createBasicOnly(heroId: number, basicId: string, name: string): HeroDefinition {
  const basic = createBasicAttackSkill(basicId, [1, 1.05, 1.1, 1.15, 1.25]);
  return { id: heroId, skills: [basic], aiCoverage: 'partial', mechanicsCoverage: 'verified',
    aiCoverageNotes: [`${name}仅按最低生命比例目标使用普攻；客户端自动战斗目标排序仍未核对。`],
    mechanicsCoverageNotes: [`客户端技能数据仅列出${basicId}普攻，已按等级实现100%至125%攻击倍率并通过等级伤害回归。`] ,
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      return enemies.length ? intent(unitId, basicId, [lowestRatioTarget(enemies).unitId], 'single') : undefined;
    },
  };
}

function createUmbrellaGhost(): HeroDefinition {
  const basic = createBasicAttackSkill(umbrellaGhostIds.basic, [1, 1.05, 1.1, 1.15, 1.25]);
  const aoe: SkillDefinition = {
    id: umbrellaGhostIds.skill, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'all-enemies', targetRelation: 'enemy', levels: [1.09, 1.14, 1.19, 1.24, 1.29].map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.hp <= 0) return [];
      return attackTargets(context, actor, intent.targetIds, umbrellaGhostIds.skill, Number(parameters.ratio ?? 1.09));
    },
  };
  return {
    id: umbrellaGhostIds.hero, skills: [basic, aoe], aiCoverage: 'partial', mechanicsCoverage: 'verified',
    aiCoverageNotes: ['已实现基础选招：敌方至少2名存活且鬼火不少于2时使用天旋地转，否则普攻最低生命比例目标；与客户端战斗 AI 的完整目标排序仍未核对。'],
    mechanicsCoverageNotes: ['客户端技能行4031/4032对应单体普攻100%至125%、2火全体攻击109%至129%，已按等级实现并有伤害/鬼火回归。该式神客户端没有额外主动或被动技能。'],
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (enemies.length === 0) return undefined;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      if (enemies.length >= 2 && fire >= 2)
        return intent(unitId, umbrellaGhostIds.skill, enemies.map(enemy => enemy.unitId), 'all-enemies');
      return intent(unitId, umbrellaGhostIds.basic, [lowestRatioTarget(enemies).unitId], 'single');
    },
  };
}

function createGreenOni(): HeroDefinition {
  const basic = createBasicAttackSkill(greenOniIds.basic, [1, 1.05, 1.1, 1.15, 1.25]);
  const triple: SkillDefinition = {
    id: greenOniIds.skill, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single', targetRelation: 'enemy', levels: [.72, .76, .8, .84, .88].map(ratio => ({ ratio, hits: 3 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.hp <= 0 || !target || target.hp <= 0) return [];
      const ratio = Number(parameters.ratio ?? .72);
      const hits = Math.max(1, Math.floor(Number(parameters.hits ?? 3)));
      const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
      const source = { kind: 'skill' as const, id: greenOniIds.skill, unitId: actor.unitId };
      const commands: EffectCommand[] = [];
      for (let hit = 0; hit < hits; hit++) {
        const result = context.calculateDamage({ attack: offense.attack, defense: defense.defense,
          defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: offense.crit, critDamage: offense.critDamage }, actor, target);
        commands.push({ type: 'deal-damage', source, targetId: target.unitId, amount: result.amount,
          ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}), isCritical: result.isCritical });
      }
      return commands;
    },
  };
  return {
    id: greenOniIds.hero, skills: [basic, triple], aiCoverage: 'partial', mechanicsCoverage: 'verified',
    aiCoverageNotes: ['已实现基础选招：鬼火不少于2时对最低生命比例敌人施放三段我打打打，否则普攻；客户端完整选招顺序尚未核对。'],
    mechanicsCoverageNotes: ['客户端技能行4041/4042对应单体普攻100%至125%、2火单体三段攻击每段72%至88%，已按等级实现并有段数/倍率/鬼火回归。该式神客户端没有额外主动或被动技能。'],
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (enemies.length === 0) return undefined;
      const target = lowestRatioTarget(enemies);
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      return fire >= 2 ? intent(unitId, greenOniIds.skill, [target.unitId], 'single')
        : intent(unitId, greenOniIds.basic, [target.unitId], 'single');
    },
  };
}

function createBroomSprite(): HeroDefinition {
  const basic = createBasicAttackSkill(broomSpriteIds.basic, [1, 1.05, 1.1, 1.15, 1.25]);
  const sweep: SkillDefinition = {
    id: broomSpriteIds.skill, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'all-enemies', targetRelation: 'enemy', levels: [1.11, 1.16, 1.21, 1.26, 1.31].map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.hp <= 0) return [];
      return attackTargets(context, actor, intent.targetIds, broomSpriteIds.skill, Number(parameters.ratio ?? 1.11));
    },
  };
  return { id: broomSpriteIds.hero, skills: [basic, sweep], aiCoverage: 'partial', mechanicsCoverage: 'verified',
    aiCoverageNotes: ['敌方至少2名存活且鬼火不少于2时使用大扫除，否则普攻最低生命比例目标；自动战斗完整选招仍待核对。'],
    mechanicsCoverageNotes: ['客户端技能行4081/4082对应单体普攻100%至125%、2火全体攻击111%至131%，已按等级实现并有伤害/鬼火回归。'],
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (enemies.length === 0) return undefined;
      if (enemies.length >= 2 && (context.state.resources[actor.side]?.fire ?? 0) >= 2)
        return intent(unitId, broomSpriteIds.skill, enemies.map(enemy => enemy.unitId), 'all-enemies');
      return intent(unitId, broomSpriteIds.basic, [lowestRatioTarget(enemies).unitId], 'single');
    },
  };
}

function createOotenguGua(): HeroDefinition {
  const basic = createBasicAttackSkill(ootenguGuaIds.basic, [1, 1.05, 1.1, 1.15, 1.25]);
  const blades: SkillDefinition = {
    id: ootenguGuaIds.skill, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', levels: [.08, .09, .1, .11, .12].map(ratio => ({ ratio, hits: 4 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.hp <= 0) return [];
      return repeatedAttackTargets(context, actor, intent.targetIds, ootenguGuaIds.skill,
        Number(parameters.ratio ?? .08), Number(parameters.hits ?? 4));
    },
  };
  return { id: ootenguGuaIds.hero, skills: [basic, blades], aiCoverage: 'partial', mechanicsCoverage: 'verified',
    aiCoverageNotes: ['敌方至少2人且有3火时使用四段羽刃暴风，否则普攻最低生命比例目标；自动战斗完整选招仍待核对。'],
    mechanicsCoverageNotes: ['客户端技能行4141/4142对应普攻100%至125%、3火全体4段且每段8%至12%攻击，已按等级实现并验证段数与费用。'],
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if (enemies.length >= 2 && (context.state.resources[actor.side]?.fire ?? 0) >= 3)
        return intent(unitId, ootenguGuaIds.skill, enemies.map(enemy => enemy.unitId), 'all-enemies');
      return intent(unitId, ootenguGuaIds.basic, [lowestRatioTarget(enemies).unitId], 'single');
    },
  };
}

function createArakawaGua(): HeroDefinition {
  const basic = createBasicAttackSkill(arakawaGuaIds.basic, [1, 1.05, 1.1, 1.15, 1.25]);
  const eat: SkillDefinition = {
    id: arakawaGuaIds.skill, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', levels: [.66, .7, .72, .76, .8].map(ratio => ({ ratio, hits: 2 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.hp <= 0 || !target || target.hp <= 0) return [];
      return repeatedAttackTargets(context, actor, [target.unitId], arakawaGuaIds.skill,
        Number(parameters.ratio ?? .66), Number(parameters.hits ?? 2));
    },
  };
  return { id: arakawaGuaIds.hero, skills: [basic, eat], aiCoverage: 'partial', mechanicsCoverage: 'verified',
    aiCoverageNotes: ['有3火时使用两段呱·吞噬，否则普攻最低生命比例目标；自动战斗完整选招仍待核对。'],
    mechanicsCoverageNotes: ['客户端技能行4161/4162对应普攻100%至125%、3火单体两段且每段66%至80%攻击，已按等级实现并验证段数与费用。'],
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = lowestRatioTarget(enemies);
      return (context.state.resources[actor.side]?.fire ?? 0) >= 3
        ? intent(unitId, arakawaGuaIds.skill, [target.unitId], 'single')
        : intent(unitId, arakawaGuaIds.basic, [target.unitId], 'single');
    },
  };
}

function createYoungDeerGua(): HeroDefinition {
  const basic = createBasicAttackSkill(youngDeerGuaIds.basic, [1, 1.05, 1.1, 1.15, 1.2]);
  const charge: SkillDefinition = {
    id: youngDeerGuaIds.skill, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', levels: [.75, .8, .85, .9, .95].map(ratio => ({ ratio, extraTargets: 2, repeatReduction: .4 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const first = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.hp <= 0 || !first || first.hp <= 0) return [];
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      const targets = [first.unitId];
      const extra = Math.max(0, Math.floor(Number(parameters.extraTargets ?? 2)));
      for (let index = 0; index < extra && enemies.length > 0; index++)
        targets.push(enemies[Math.min(enemies.length - 1, Math.floor(context.random() * enemies.length))]!.unitId);
      const reduction = Number(parameters.repeatReduction ?? .4);
      const counts = new Map<string, number>();
      const ratio = Number(parameters.ratio ?? .75);
      return targets.flatMap(targetId => {
        const repeat = counts.get(targetId) ?? 0;
        counts.set(targetId, repeat + 1);
        return attackTargets(context, actor, [targetId], youngDeerGuaIds.skill, ratio * Math.pow(1 - reduction, repeat));
      });
    },
  };
  return { id: youngDeerGuaIds.hero, skills: [basic, charge], aiCoverage: 'partial', mechanicsCoverage: 'verified',
    aiCoverageNotes: ['有3火时对最低生命比例目标施放呱·鹿角冲撞，否则普攻；随机次目标与自动战斗选招尚待完整实战核对。'],
    mechanicsCoverageNotes: ['客户端技能行4191/4192对应普攻100%至120%、3火先攻击所选目标再随机攻击2个目标、每段75%至95%，重复目标伤害降低40%；已按等级实现并有重复目标回归。'],
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = lowestRatioTarget(enemies);
      return (context.state.resources[actor.side]?.fire ?? 0) >= 3
        ? intent(unitId, youngDeerGuaIds.skill, [target.unitId], 'single')
        : intent(unitId, youngDeerGuaIds.basic, [target.unitId], 'single');
    },
  };
}

function attackTargets(context: Parameters<SkillDefinition['execute']>[0], actor: Readonly<UnitState>, targetIds: readonly string[],
  skillId: string, ratio: number): EffectCommand[] {
  const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats;
  const source = { kind: 'skill' as const, id: skillId, unitId: actor.unitId };
  return targetIds.flatMap(targetId => {
    const target = context.getUnit(targetId);
    if (!target || target.hp <= 0 || target.side === actor.side) return [];
    const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
    const result = context.calculateDamage({ attack: offense.attack, defense: defense.defense,
      defenseIgnore: effectiveDefenseIgnore(actor), ratio, critChance: offense.crit, critDamage: offense.critDamage }, actor, target);
    return [{ type: 'deal-damage' as const, source, targetId, amount: result.amount,
      ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}), isCritical: result.isCritical }];
  });
}

function repeatedAttackTargets(context: Parameters<SkillDefinition['execute']>[0], actor: Readonly<UnitState>, targetIds: readonly string[],
  skillId: string, ratio: number, hits: number): EffectCommand[] {
  const commands: EffectCommand[] = [];
  for (let hit = 0; hit < Math.max(1, Math.floor(hits)); hit++)
    commands.push(...attackTargets(context, actor, targetIds, skillId, ratio));
  return commands;
}

function lowestRatioTarget(enemies: readonly UnitState[]): UnitState {
  return [...enemies].sort((left, right) => left.hp / Math.max(1, left.stats.hp)
    - right.hp / Math.max(1, right.stats.hp))[0]!;
}

function intent(actorId: string, skillId: string, targetIds: string[], shape: 'single' | 'all-enemies'): ActionIntent {
  return { actorId, skillId, targetIds, shape, targetRelation: 'enemy' };
}
