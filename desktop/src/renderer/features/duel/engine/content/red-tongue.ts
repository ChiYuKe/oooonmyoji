import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef, StatusInstance } from '../core/types';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const redTongueIds = {
  hero: 246,
  basic: '2461',
  cheer: '2462',
  storm: '2463',
  cheerBuff: 'status.hero.246.cheer',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const cheerBonuses = [
  { speed: 5, crit: .05 },
  { speed: 5, crit: .08 },
  { speed: 10, crit: .08 },
  { speed: 10, crit: .11 },
  { speed: 15, crit: .11 },
] as const;
const stormRatios = [.6, .63, .66, .69, .72] as const;

export function registerRedTongue(registry: ContentRegistry): void {
  registry.registerStatus({ id: redTongueIds.cheerBuff, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerHero(createRedTongueDefinition());
}

export function createRedTongueDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(redTongueIds.basic, basicRatios);
  const cheer: SkillDefinition = {
    id: redTongueIds.cheer, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'all-allies', targetRelation: 'ally',
    levels: cheerBonuses.map(({ speed, crit }) => ({ speed, crit })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const speed = Number(parameters.speed ?? 5), crit = Number(parameters.crit ?? .05);
      const source = redTongueSource(redTongueIds.cheer, actor.unitId);
      return intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId);
        if (!target || target.hp <= 0) return [];
        const instance: StatusInstance = { instanceId: `${redTongueIds.cheerBuff}:${actor.unitId}:${target.unitId}`,
          statusId: redTongueIds.cheerBuff, source, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
          modifiers: [{ stat: 'speed', operation: 'flat', amount: speed }, { stat: 'crit', operation: 'flat', amount: crit }] };
        return [{ type: 'add-status' as const, source, targetId, instance }];
      });
    },
  };
  const storm: SkillDefinition = {
    id: redTongueIds.storm, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', useClientDamageData: true,
    levels: stormRatios.map(ratio => ({ ratio, hits: 2, pushChance: .3 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const stats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const source = redTongueSource(redTongueIds.storm, actor.unitId);
      const ratio = Number(parameters.ratio ?? .6);
      return intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId);
        if (!target || target.hp <= 0) return [];
        const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
        return Array.from({ length: 2 }, () => {
          const hit = context.calculateDamage({ attack: stats.attack, defense,
            defenseIgnore: effectiveDefenseIgnore(actor), ratio,
            critChance: stats.crit, critDamage: stats.critDamage }, actor, target);
          return { type: 'deal-damage' as const, source, targetId, amount: hit.amount,
            ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
            ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, stats.critDamage) } : {}), isCritical: hit.isCritical };
        });
      });
    },
  };
  return {
    id: redTongueIds.hero, skills: [basic, cheer, storm], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已按客户端技能数据接入海扁等级倍率、鼓舞2火/2回合速度与暴击加成、风鼓雷3火两段全体攻击及逐次30%击退100%行动条；击退逐段概率/控制免疫及客户端具体持续回合显示仍需连续帧确认'],
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      if (enemies.length > 1 && fire >= 3)
        return redTongueIntent(actor.unitId, redTongueIds.storm, enemies.map(enemy => enemy.unitId), 'all-enemies');
      const allies = context.getLivingUnits(actor.side);
      if (fire >= 2 && allies.some(ally => !ally.statuses.some(status => status.statusId === redTongueIds.cheerBuff)))
        return redTongueIntent(actor.unitId, redTongueIds.cheer, allies.map(ally => ally.unitId), 'all-allies');
      return redTongueIntent(actor.unitId, redTongueIds.basic, [enemies[0]!.unitId], 'single');
    },
    handlers: { hit: { priority: 32, handle(context, event) { return pushBack(context, event); } } },
  };
}

function pushBack(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || event.source.id !== redTongueIds.storm || !event.source.unitId) return;
  const owner = context.getUnit(event.source.unitId), target = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== redTongueIds.hero || owner.hp <= 0 || !target || target.hp <= 0
    || context.random() >= .3) return;
  return [{ type: 'change-action-gauge', source: redTongueSource(redTongueIds.storm, owner.unitId),
    targetId: target.unitId, amount: -100, parentEventId: event.eventId }];
}

function redTongueIntent(actorId: string, skillId: string, targetIds: readonly string[], shape: 'single' | 'all-allies' | 'all-enemies'): ActionIntent {
  return { actorId, skillId, targetIds, shape, targetRelation: shape === 'all-allies' ? 'ally' : 'enemy' };
}

function redTongueSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
