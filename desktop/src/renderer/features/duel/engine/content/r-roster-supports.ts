import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, EffectCommand, SourceRef, StatusInstance, UnitState } from '../core/types';
import { attemptControl } from '../mechanics/control';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const redOniIds = { hero: 405, basic: '4051', tauntSkill: '4052', taunt: 'status.hero.405.taunt' } as const;
export const yellowOniIds = { hero: 406, basic: '4061', buffSkill: '4062', critBuff: 'status.hero.406.crit-buff' } as const;
export const blueOniIds = { hero: 407, basic: '4071', buffSkill: '4072', speedBuff: 'status.hero.407.speed-buff' } as const;
export const wallIds = { hero: 409, basic: '4091', buffSkill: '4092', defenseBuff: 'status.hero.409.defense-buff' } as const;

export function registerRRankSupports(registry: ContentRegistry): void {
  registry.registerStatus({ id: redOniIds.taunt, mechanicsCoverage: 'verified', category: 'control', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  registry.registerStatus({ id: yellowOniIds.critBuff, mechanicsCoverage: 'verified', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: blueOniIds.speedBuff, mechanicsCoverage: 'verified', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: wallIds.defenseBuff, mechanicsCoverage: 'verified', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerHero(createRedOni());
  registry.registerHero(createYellowOni());
  registry.registerHero(createBlueOni());
  registry.registerHero(createWall());
}

function createRedOni(): HeroDefinition {
  const basic = createBasicAttackSkill(redOniIds.basic, [1, 1.05, 1.1, 1.15, 1.25]);
  const taunt: SkillDefinition = { id: redOniIds.tauntSkill, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single', targetRelation: 'enemy', levels: [{}], execute(context, intent) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.hp <= 0 || !target || target.hp <= 0) return [];
      const source = supportSource(redOniIds.tauntSkill, actor.unitId);
      const control = attemptControl(context, { attemptId: `${redOniIds.taunt}:${actor.unitId}:${target.unitId}:${context.state.counters.action}`,
        source, targetId: target.unitId, statusId: redOniIds.taunt, controlType: '嘲讽', baseChance: 1,
        duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
        modifiers: [{ stat: 'damage', operation: 'percent', amount: .2 }, { stat: 'damageTaken', operation: 'percent', amount: .4 }] });
      return control ? [control] : [];
    } };
  return { id: redOniIds.hero, skills: [basic, taunt], aiCoverage: 'partial', mechanicsCoverage: 'verified',
    aiCoverageNotes: ['鬼火不少于2时对攻击最高敌人施放挑衅，否则普攻最低生命比例目标；完整自动目标选择仍待核验。'],
    mechanicsCoverageNotes: ['客户端技能4052为2火单体100%基础概率嘲讽1回合，并使目标造成伤害+20%、受到伤害+40%；控制与两类增伤均按技能行实现并有命中/抵抗回归。'],
    policy(context, unitId) {
      const actor = context.getUnit(unitId); if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return undefined;
      const target = [...enemies].sort((left, right) => right.stats.attack - left.stats.attack)[0]!;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 2
        && !target.statuses.some(status => status.statusId === redOniIds.taunt))
        return makeIntent(unitId, redOniIds.tauntSkill, [target.unitId]);
      return makeIntent(unitId, redOniIds.basic, [lowestRatioTarget(enemies).unitId]);
    },
  };
}

function createYellowOni(): HeroDefinition {
  const basic = createBasicAttackSkill(yellowOniIds.basic, [1, 1.05, 1.1, 1.15, 1.25]);
  const buff: SkillDefinition = { id: yellowOniIds.buffSkill, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'all-allies', targetRelation: 'ally', levels: [{}], execute(context, intent) {
      const actor = context.getUnit(intent.actorId); if (!actor || actor.hp <= 0) return [];
      const source = supportSource(yellowOniIds.buffSkill, actor.unitId);
      return context.getLivingUnits(actor.side).map(ally => addBuff(ally, yellowOniIds.critBuff, source,
        { kind: 'count', remaining: 1, owner: 'target-turn' }, [{ stat: 'crit', operation: 'flat', amount: .15 }]));
    } };
  return { id: yellowOniIds.hero, skills: [basic, buff], aiCoverage: 'partial', mechanicsCoverage: 'verified',
    aiCoverageNotes: ['鬼火不少于2时使用全队暴击强化，否则普攻最低生命比例敌人；完整自动选招仍待核验。'],
    mechanicsCoverageNotes: ['客户端技能4062消耗2火，令全体友方暴击提高15%，持续1回合；已实现为可刷新暴击状态并有技能/属性回归。'],
    policy(context, unitId) { return chooseTeamBuff(context, unitId, yellowOniIds.buffSkill, yellowOniIds.basic, yellowOniIds.critBuff, 2); },
  };
}

function createBlueOni(): HeroDefinition {
  const basicRatios = [.33, .35, .37, .39, .41] as const;
  const basicBase = createBasicAttackSkill(blueOniIds.basic, basicRatios);
  const basic: SkillDefinition = { ...basicBase, useClientDamageData: false,
    levels: basicRatios.map(ratio => ({ ratio, hits: 3 })), execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId), target = context.getUnit(intent.targetIds[0] ?? '');
      if (!actor || actor.hp <= 0 || !target || target.hp <= 0) return [];
      return repeatedAttackTargets(context, actor, [target.unitId], blueOniIds.basic,
        Number(parameters.ratio ?? .33), Number(parameters.hits ?? 3));
    } };
  const buff: SkillDefinition = { id: blueOniIds.buffSkill, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'all-allies', targetRelation: 'ally', levels: [{}], execute(context, intent) {
      const actor = context.getUnit(intent.actorId); if (!actor || actor.hp <= 0) return [];
      const source = supportSource(blueOniIds.buffSkill, actor.unitId);
      return context.getLivingUnits(actor.side).map(ally => addBuff(ally, blueOniIds.speedBuff, source,
        { kind: 'count', remaining: 1, owner: 'target-turn' }, [{ stat: 'speed', operation: 'flat', amount: 40 }]));
    } };
  return { id: blueOniIds.hero, skills: [basic, buff], aiCoverage: 'partial', mechanicsCoverage: 'verified',
    aiCoverageNotes: ['鬼火不少于2时施放全队速度强化，否则普攻；完整自动选招仍待核验。'],
    mechanicsCoverageNotes: ['客户端技能4071为3段普攻、每段33%至41%；4072消耗2火，全体友方速度+40，持续1回合；已按等级实现并有段数/属性回归。'],
    policy(context, unitId) { return chooseTeamBuff(context, unitId, blueOniIds.buffSkill, blueOniIds.basic, blueOniIds.speedBuff, 2); },
  };
}

function createWall(): HeroDefinition {
  const basic = createBasicAttackSkill(wallIds.basic, [1, 1.05, 1.1, 1.15, 1.25]);
  const buff: SkillDefinition = { id: wallIds.buffSkill, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'all-allies', targetRelation: 'ally', levels: [{}], execute(context, intent) {
      const actor = context.getUnit(intent.actorId); if (!actor || actor.hp <= 0) return [];
      const source = supportSource(wallIds.buffSkill, actor.unitId);
      const initialDefense = actor.stats.defense;
      return context.getLivingUnits(actor.side).map(ally => addBuff(ally, wallIds.defenseBuff, source,
        { kind: 'count', remaining: 2, owner: 'target-turn' }, [
          { stat: 'defense', operation: 'percent', amount: .4 },
          { stat: 'defense', operation: 'flat', amount: initialDefense * .2 },
        ]));
    } };
  return { id: wallIds.hero, skills: [basic, buff], aiCoverage: 'partial', mechanicsCoverage: 'verified',
    aiCoverageNotes: ['鬼火不少于2时使用全队防御强化，否则普攻；完整自动选招仍待核验。'],
    mechanicsCoverageNotes: ['客户端技能4092消耗2火，使全队获得2回合防御+40%及涂壁初始防御20%的固定加值，单层；已实现并验证属性与持续时间。'],
    policy(context, unitId) { return chooseTeamBuff(context, unitId, wallIds.buffSkill, wallIds.basic, wallIds.defenseBuff, 2); },
  };
}

function chooseTeamBuff(context: BattleContext, unitId: string, skillId: string,
  basicId: string, statusId: string, fireCost: number): ActionIntent | undefined {
  const actor = context.getUnit(unitId); if (!actor || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
  const allies = context.getLivingUnits(actor.side);
  const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue'); if (!enemies.length) return undefined;
  const needsBuff = allies.some(ally => !ally.statuses.some(status => status.statusId === statusId));
  if (needsBuff && (context.state.resources[actor.side]?.fire ?? 0) >= fireCost)
    return makeIntent(unitId, skillId, allies.map(ally => ally.unitId), 'all-allies');
  return makeIntent(unitId, basicId, [lowestRatioTarget(enemies).unitId]);
}

function addBuff(ally: Readonly<UnitState>, statusId: string, source: SourceRef,
  duration: { kind: 'count'; remaining: number; owner: 'target-turn' }, modifiers: NonNullable<StatusInstance['modifiers']>): EffectCommand {
  return { type: 'add-status', source, targetId: ally.unitId, instance: {
    instanceId: `${statusId}:${source.unitId}:${ally.unitId}`, statusId, source, stacks: 1, duration, modifiers,
  } };
}

function lowestRatioTarget(units: readonly UnitState[]): UnitState {
  return [...units].sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0]!;
}
function repeatedAttackTargets(context: BattleContext, actor: Readonly<UnitState>, targetIds: readonly string[], skillId: string,
  ratio: number, hits: number): EffectCommand[] {
  const commands: EffectCommand[] = [];
  const source = supportSource(skillId, actor.unitId);
  for (let index = 0; index < Math.max(1, Math.floor(hits)); index++) for (const targetId of targetIds) {
    const target = context.getUnit(targetId);
    if (!target || target.hp <= 0 || target.side === actor.side) continue;
    const offense = context.getEffectiveStats(actor.unitId) ?? actor.stats;
    const defense = context.getEffectiveStats(target.unitId) ?? target.stats;
    const result = context.calculateDamage({ attack: offense.attack, defense: defense.defense,
      critChance: offense.crit, critDamage: offense.critDamage, ratio }, actor, target);
    commands.push({ type: 'deal-damage', source, targetId, amount: result.amount, isCritical: result.isCritical,
      ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}) });
  }
  return commands;
}
function supportSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
function makeIntent(actorId: string, skillId: string, targetIds: string[], shape: 'single' | 'all-allies' = 'single'): ActionIntent {
  return { actorId, skillId, targetIds, shape, targetRelation: skillId.endsWith('2') && shape === 'all-allies' ? 'ally' : 'enemy' };
}
