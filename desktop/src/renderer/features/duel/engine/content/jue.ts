import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { attemptDebuff } from '../mechanics/control';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const jueIds = {
  hero: 249,
  basic: '2491',
  passive: '2492',
  ultimate: '2493',
  grudge: 'status.hero.249.grudge',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [1.32, 1.39, 1.46, 1.53, 1.6] as const;

export function registerJue(registry: ContentRegistry): void {
  registry.registerStatus({ id: jueIds.grudge, mechanicsCoverage: 'partial', category: 'debuff',
    dispellable: true, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerHero(createJueDefinition());
}

export function createJueDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(jueIds.basic, basicRatios);
  const ultimate: SkillDefinition = {
    id: jueIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'all-enemies', targetRelation: 'enemy', useClientDamageData: true,
    levels: ultimateRatios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const stats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const source = jueSource(jueIds.ultimate, actor.unitId);
      const ratio = Number(parameters.ratio ?? 1.32);
      return intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId);
        if (!target || target.hp <= 0) return [];
        const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
        const hit = context.calculateDamage({ attack: stats.attack, defense,
          defenseIgnore: effectiveDefenseIgnore(actor), ratio,
          critChance: stats.crit, critDamage: stats.critDamage }, actor, target);
        return [{ type: 'deal-damage' as const, source, targetId, amount: hit.amount,
          ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
          ...(hit.isCritical ? { criticalBaseAmount: hit.amount / Math.max(1, stats.critDamage) } : {}), isCritical: hit.isCritical }];
      });
    },
  };
  return {
    id: jueIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已按客户端数据接入棒打等级倍率、棒球炸弹3火群攻倍率、记仇受击40%判定/两回合标记及觉攻击标记目标增伤15%；每次受击与多段技能触发次数、目标抵抗/封印和帧图数值仍待客户端连续帧确认'],
    policy(context, unitId) {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if (enemies.length > 1 && (context.state.resources[actor.side]?.fire ?? 0) >= 3)
        return jueIntent(actor.unitId, jueIds.ultimate, enemies.map(enemy => enemy.unitId), 'all-enemies');
      return jueIntent(actor.unitId, jueIds.basic, [enemies[0]!.unitId], 'single');
    },
    modifyOutgoingDamage(attacker, target, amount, _kind) {
      if (attacker.heroId !== jueIds.hero) return amount;
      return target.statuses.some(status => status.statusId === jueIds.grudge) ? amount * 1.15 : amount;
    },
    handlers: { hit: { priority: 35, handle(context, event) { return markAttacker(context, event); } } },
  };
}

function markAttacker(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.source.unitId) return;
  const owner = context.getUnit(event.targetId);
  const attacker = context.getUnit(event.source.unitId);
  if (!owner || owner.heroId !== jueIds.hero || owner.hp <= 0 || !passivesEnabled(owner) || !attacker || attacker.hp <= 0) return;
  return attemptDebuff(context, { source: jueSource(jueIds.passive, owner.unitId), targetId: attacker.unitId,
    statusId: jueIds.grudge, baseChance: .4, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
    parentEventId: event.eventId });
}

function jueIntent(actorId: string, skillId: string, targetIds: readonly string[], shape: 'single' | 'all-enemies'): ActionIntent {
  return { actorId, skillId, targetIds, shape, targetRelation: 'enemy' };
}

function jueSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
