import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, BattleEvent, EffectCommand, SourceRef } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const puppetMasterIds = {
  hero: 242,
  basic: '2421',
  passive: '2422',
  ultimate: '2423',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const ultimateRatios = [.55, .58, .61, .64, .67] as const;

export function registerPuppetMaster(registry: ContentRegistry): void {
  registry.registerHero(createPuppetMasterDefinition());
}

export function createPuppetMasterDefinition(): HeroDefinition {
  const basic = createBasicAttackSkill(puppetMasterIds.basic, basicRatios);
  const ultimate: SkillDefinition = {
    id: puppetMasterIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', useClientDamageData: true,
    levels: ultimateRatios.map(ratio => ({ ratio, hits: 5 })),
    execute(context, intent, parameters) {
      const owner = context.getUnit(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      if (!owner || !target || target.hp <= 0) return [];
      const stats = context.getEffectiveStats(owner.unitId) ?? owner.stats;
      const defense = context.getEffectiveStats(target.unitId)?.defense ?? target.stats.defense;
      const ratio = Number(parameters.ratio ?? .55);
      return Array.from({ length: Number(parameters.hits ?? 5) }, () => {
        const hit = context.calculateDamage({ attack: stats.attack, defense,
          defenseIgnore: effectiveDefenseIgnore(owner), ratio, critChance: stats.crit, critDamage: stats.critDamage }, owner, target);
        return { type: 'deal-damage' as const, source: puppetSource(puppetMasterIds.ultimate, owner.unitId),
          targetId: target.unitId, amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}),
          isCritical: hit.isCritical };
      });
    },
  };
  return {
    id: puppetMasterIds.hero, skills: [basic, ultimate], aiCoverage: 'partial', mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已按客户端技能表接入傀儡·出击等级倍率、傀儡·爆发3火单体五段攻击和傀儡·追击每次攻击20%概率造成目标生命上限10%的真实伤害（上限为攻击120%）；真实斗技帧中被动按每段独立判定、与暴击/御魂的触发先后及技能等级分支仍待确认'],
    policy(context, unitId): ActionIntent | undefined {
      const owner = context.getUnit(unitId);
      if (!owner || owner.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(owner.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const target = enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      if ((context.state.resources[owner.side]?.fire ?? 0) >= 3)
        return puppetIntent(owner.unitId, puppetMasterIds.ultimate, target.unitId, 'single');
      return puppetIntent(owner.unitId, puppetMasterIds.basic, target.unitId, 'single');
    },
    handlers: { hit: { priority: 40, handle(context, event) { return triggerFollowUp(context, event); } } },
  };
}

function triggerFollowUp(context: BattleContext, event: BattleEvent): EffectCommand[] | undefined {
  if (event.type !== 'damage' || !event.source.unitId
    || event.source.id !== puppetMasterIds.basic && event.source.id !== puppetMasterIds.ultimate) return;
  const owner = context.getUnit(event.source.unitId);
  const target = context.getUnit(event.targetId);
  if (!owner || owner.heroId !== puppetMasterIds.hero || !passivesEnabled(owner) || !target || target.hp <= 0
    || context.random() >= .2) return;
  const attack = context.getEffectiveStats(owner.unitId)?.attack ?? owner.stats.attack;
  const amount = Math.min(target.stats.hp * .1, attack * 1.2);
  if (amount <= 0) return;
  return [{ type: 'deal-damage', source: puppetSource(puppetMasterIds.passive, owner.unitId), targetId: target.unitId,
    amount, damageKind: 'true', parentEventId: event.eventId }];
}

function puppetIntent(actorId: string, skillId: string, targetId: string, shape: ActionIntent['shape']): ActionIntent {
  return { actorId, skillId, targetIds: [targetId], shape, targetRelation: 'enemy' };
}
function puppetSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
