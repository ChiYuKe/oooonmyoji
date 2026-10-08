import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, EffectCommand } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const soulReaperIds = {
  hero: 211,
  basic: '2111',
  passive: '2112',
  ultimate: '2113',
  pursuit: '2114',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [1.06, 1.11, 1.17, 1.22, 1.28] as const;

/** 鬼使黑技能来自客户端技能表；每个敌方击杀事件各自触发一次索命新回合。 */
export function registerSoulReaper(registry: ContentRegistry): void {
  const pursuit: SkillDefinition = {
    id: soulReaperIds.pursuit,
    actionKind: 'passive',
    target: 'single',
    targetRelation: 'enemy',
    levels: basicRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const stats = actor && context.getEffectiveStats(actor.unitId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      const targetStats = target && context.getEffectiveStats(target.unitId);
      if (!actor || !stats || !target || !targetStats) return [];
      const ratio = Number(parameters.ratio ?? 1);
      const commands: EffectCommand[] = [];
      for (let hit = 0; hit < 2 && target.hp > 0; hit++) {
        const result = context.calculateDamage({ attack: stats.attack, defense: targetStats.defense,
          defenseIgnore: effectiveDefenseIgnore(actor), ratio,
          critChance: stats.crit + .5, critDamage: stats.critDamage }, actor, target);
        commands.push({ type: 'deal-damage' as const, source: { kind: 'skill' as const, id: soulReaperIds.pursuit, unitId: actor.unitId },
          targetId: target.unitId, amount: result.amount, ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}),
          ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, stats.critDamage) } : {}), isCritical: result.isCritical });
      }
      return commands;
    },
  };

  const ultimate: SkillDefinition = {
    id: soulReaperIds.ultimate,
    actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies',
    targetRelation: 'enemy',
    levels: ultimateRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const stats = actor && context.getEffectiveStats(actor.unitId);
      if (!actor || !stats) return [];
      const ratio = Number(parameters.ratio ?? 1.06);
      const source = { kind: 'skill' as const, id: soulReaperIds.ultimate, unitId: actor.unitId };
      return intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId);
        const targetStats = target && context.getEffectiveStats(targetId);
        if (!target || !targetStats) return [];
        const highHealth = target.hp / Math.max(1, target.stats.hp) > .4;
        const result = context.calculateDamage({ attack: stats.attack, defense: targetStats.defense,
          defenseIgnore: effectiveDefenseIgnore(actor), ratio: ratio * (highHealth ? 1.5 : .5),
          critChance: stats.crit + (highHealth ? .5 : 0), critDamage: stats.critDamage }, actor, target);
        return [{ type: 'deal-damage' as const, source, targetId, amount: result.amount, ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}),
          ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, stats.critDamage) } : {}), isCritical: result.isCritical }];
      });
    },
  };

  const definition: HeroDefinition = {
    id: soulReaperIds.hero,
    skills: [createBasicAttackSkill(soulReaperIds.basic, basicRatios), ultimate, pursuit],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已对照客户端技能表接入：死亡宣判消耗3火，生命比例高于40%的目标伤害提高50%并额外获得50%暴击，低于或等于40%时伤害降低50%；索命在每个敌方单位阵亡事件后排入一次被动新回合，使用追魂两段攻击并额外增加50%暴击，追魂倍率随惩戒技能等级变化。逐帧击杀动画、同一群攻多杀时新回合的客户端显示/执行顺序及鬼使黑具体技能等级仍需战斗录像确认'],
    handlers: {
      'unit-defeated': { priority: 30, handle(context, event) {
        if (event.type !== 'unit-defeated' || !event.defeatedBy?.unitId) return;
        const actor = context.getUnit(event.defeatedBy.unitId);
        if (!actor || actor.heroId !== soulReaperIds.hero || !passivesEnabled(actor)) return;
        const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
        if (enemies.length === 0) return;
        const target = choosePursuitTarget(enemies, context);
        const source = { kind: 'skill' as const, id: soulReaperIds.passive, unitId: actor.unitId };
        return [{ type: 'schedule-action', source,
          intent: { actorId: actor.unitId, skillId: soulReaperIds.pursuit, targetIds: [target.unitId], shape: 'single',
            targetRelation: 'enemy', kind: 'passive' },
          scheduling: 'extra-turn', parentEventId: event.eventId }];
      } },
    },
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (enemies.length === 0) return undefined;
      const fire = context.state.resources[actor.side]?.fire ?? 0;
      const hasLowEnemy = enemies.some(unit => unit.hp / Math.max(1, unit.stats.hp) < .2);
      const hasEnemyAbove40 = enemies.some(unit => unit.hp / Math.max(1, unit.stats.hp) > .4);
      const useUltimate = fire >= 3 && enemies.length >= 2 && !hasLowEnemy && hasEnemyAbove40;
      const targetIds = useUltimate ? enemies.map(unit => unit.unitId) : [choosePursuitTarget(enemies, context).unitId];
      return { actorId: unitId, skillId: useUltimate ? soulReaperIds.ultimate : soulReaperIds.basic,
        targetIds, shape: useUltimate ? 'all-enemies' : 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function choosePursuitTarget<T extends { unitId: string; hp: number; stats: { hp: number }; statuses: readonly { statusId: string }[] }>(
  enemies: readonly T[], context: Parameters<NonNullable<HeroDefinition['policy']>>[0],
): T {
  return [...enemies].sort((left, right) => {
    const leftDebuffed = left.statuses.some(status => {
      const category = context.getStatusCategory(status.statusId);
      return category === 'control' || category === 'debuff';
    });
    const rightDebuffed = right.statuses.some(status => {
      const category = context.getStatusCategory(status.statusId);
      return category === 'control' || category === 'debuff';
    });
    return Number(rightDebuffed) - Number(leftDebuffed)
      || (left.hp / Math.max(1, left.stats.hp) - Number(leftDebuffed) * .2)
        - (right.hp / Math.max(1, right.stats.hp) - Number(rightDebuffed) * .2)
      || left.unitId.localeCompare(right.unitId);
  })[0]!;
}
