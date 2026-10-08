import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef } from '../core/types';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const lanternBoyIds = { hero: 245, basic: '2451', deathFire: '2452', ultimate: '2453' } as const;
const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [1.09, 1.14, 1.19, 1.24, 1.29] as const;

export function registerLanternBoy(registry: ContentRegistry): void {
  registry.registerHero(createLanternBoyDefinition());
}

export function createLanternBoyDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(lanternBoyIds.basic, basicRatios);
  const ultimate: SkillDefinition = {
    id: lanternBoyIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'all-enemies', targetRelation: 'enemy', useClientDamageData: true,
    levels: ultimateRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      if (!owner) return [];
      const stats = context.getEffectiveStats(owner.unitId) ?? owner.stats;
      const source = lanternSource(lanternBoyIds.ultimate, owner.unitId);
      return intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId);
        if (!target || target.hp <= 0) return [];
        const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
        const hit = context.calculateDamage({ attack: stats.attack, defense, defenseIgnore: effectiveDefenseIgnore(owner),
          ratio: Number(parameters.ratio ?? 1.09), critChance: stats.crit, critDamage: stats.critDamage }, owner, target);
        return [{ type: 'deal-damage' as const, source, targetId: target.unitId, amount: hit.amount,
          ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
      });
    },
  };
  return {
    id: lanternBoyIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已按客户端表接入头槌倍率、鬼火球2火群攻及提灯小僧阵亡时给敌方补1点鬼火；录像帧未见该式神，阵亡结算是否排除召唤物、双方同时供火顺序和群攻数值仍需实战核验'],
    policy(context, unitId): ActionIntent | undefined {
      const owner = context.getUnit(unitId);
      if (!owner || owner.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if (enemies.length > 1 && (context.state.resources[owner.side]?.fire ?? 0) >= 2)
        return lanternIntent(owner.unitId, lanternBoyIds.ultimate, enemies.map(enemy => enemy.unitId), 'all-enemies');
      return lanternIntent(owner.unitId, lanternBoyIds.basic, [enemies[0]!.unitId], 'single');
    },
    handlers: { 'unit-defeated': { priority: 40, handle(context, event) { return restoreEnemyFire(context, event); } } },
  };
}

function restoreEnemyFire(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'unit-defeated') return;
  const defeated = context.getUnit(event.unitId);
  if (!defeated || defeated.heroId !== lanternBoyIds.hero || defeated.unitKind !== 'shikigami') return;
  return [{ type: 'change-resource', source: lanternSource(lanternBoyIds.deathFire, defeated.unitId),
    side: defeated.side === 'blue' ? 'red' : 'blue', resourceId: 'fire', amount: 1, parentEventId: event.eventId }];
}

function lanternIntent(actorId: string, skillId: string, targetIds: readonly string[], shape: ActionIntent['shape']): ActionIntent {
  return { actorId, skillId, targetIds, shape, targetRelation: 'enemy' };
}
function lanternSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
