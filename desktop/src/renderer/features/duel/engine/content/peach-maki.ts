import type { DamageInterception, HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleState, UnitState } from '../core/types';
import { passivesEnabled } from '../core/passive-eligibility';
import { createBasicAttackSkill } from './common-skills';
import type { ContentRegistry } from './registry';

export const peachMakiIds = {
  hero: 310,
  basic: '3101',
  passive: '3102',
  ultimate: '3103',
} as const;

const basicRatios = [1, 1.05, 1.1, 1.15, 1.25] as const;
const healingRatios = [.06, .08, .08, .1, .1] as const;
const actionGaugeByRank = [15, 15, 20, 20, 25] as const;
const damageReductionChance = .3;
const damageReduction = .5;

export function registerPeachMaki(registry: ContentRegistry): void {
  registry.registerHero(createPeachMakiDefinition());
}

export function createPeachMakiDefinition(): HeroDefinition {
  const ultimate: SkillDefinition = {
    id: peachMakiIds.ultimate,
    actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'all-allies',
    targetRelation: 'ally',
    levels: healingRatios.map((healRatio, index) => ({ healRatio, actionGauge: actionGaugeByRank[index]! })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor || actor.heroId !== peachMakiIds.hero || actor.hp <= 0) return [];
      const source = peachMakiSource(peachMakiIds.ultimate, actor.unitId);
      const healRatio = Number(parameters.healRatio ?? healingRatios[Math.max(0, Math.min(4, actor.skillLevel - 1))]);
      const actionGauge = Number(parameters.actionGauge ?? actionGaugeByRank[Math.max(0, Math.min(4, actor.skillLevel - 1))]);
      return context.getLivingUnits(actor.side).flatMap(ally => [
        { type: 'heal' as const, source, targetId: ally.unitId, amount: ally.stats.hp * healRatio },
        { type: 'change-action-gauge' as const, source, targetId: ally.unitId, amount: actionGauge },
      ]);
    },
  };
  return {
    id: peachMakiIds.hero,
    skills: [createBasicAttackSkill(peachMakiIds.basic, basicRatios), ultimate],
    aiCoverage: 'partial',
    mechanicsCoverage: 'partial',
    mechanicsCoverageNotes: ['已接入兔狱卒·叱责普攻倍率、觉醒后兔狱卒·坚毅每次受击30%概率减伤50%，以及蜜桃·地狱偶像2火治疗全体友方生命上限6%/8%/8%/10%/10%并推条15%/15%/20%/20%/25%。伙伴芥子按同一式神单位处理；被动觉醒门槛、逐击概率和大招全体效果已对照客户端表，仍需用实战帧图复核触发时点与召唤单位覆盖。'],
    interceptIncomingDamage(state, _attacker, target, amount, _kind, context) {
      return interceptDamage(state, target, amount, context);
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.heroId !== peachMakiIds.hero || actor.hp <= 0 || actor.unitKind === 'summon') return undefined;
      const allies = context.getLivingUnits(actor.side);
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const fire = context.state.resources[actor.side]?.fire ?? actor.resources.fire ?? 0;
      const injured = allies.some(ally => ally.hp < ally.stats.hp);
      if (fire >= 2 && injured) return { actorId: unitId, skillId: peachMakiIds.ultimate,
        targetIds: allies.map(ally => ally.unitId), shape: 'all-allies', targetRelation: 'ally' };
      const target = enemies.slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp)
        - right.hp / Math.max(1, right.stats.hp))[0]!;
      return { actorId: unitId, skillId: peachMakiIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
}

function interceptDamage(state: Readonly<BattleState>, target: Readonly<UnitState>, amount: number,
  context?: import('../core/definitions').DamageInterceptionContext): DamageInterception | undefined {
  if (target.heroId !== peachMakiIds.hero || target.hp <= 0 || target.unitKind === 'summon'
    || target.awakeFilter !== 1 || !passivesEnabled(target) || amount <= 0 || !context
    || context.battle.random() >= damageReductionChance) return undefined;
  return { amount: amount * (1 - damageReduction), effects: [] };
}

function peachMakiSource(id: string, unitId: string) { return { kind: 'skill' as const, id, unitId }; }
