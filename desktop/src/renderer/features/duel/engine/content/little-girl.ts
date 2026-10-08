import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, EffectCommand, SourceRef, StatusInstance } from '../core/types';
import { cappedDamageReduction } from '../mechanics/capped-damage-reduction';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const littleGirlIds = {
  hero: 213,
  basic: '2131',
  passive: '2132',
  ultimate: '2133',
  featherProtection: 'status.hero.213.feather-protection',
  lifeProtection: 'status.hero.213.life-protection',
} as const;

export function registerLittleGirl(registry: ContentRegistry): void {
  registry.registerStatus({ id: littleGirlIds.featherProtection, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: littleGirlIds.lifeProtection, mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });

  const basic: SkillDefinition = {
    id: littleGirlIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: [1, 1.05, 1.1, 1.15, 1.2].map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const actorStats = context.getEffectiveStats(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      const targetStats = target && context.getEffectiveStats(target.unitId);
      if (!actor || !actorStats || !target || !targetStats) return [];
      const hit = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
        defenseIgnore: effectiveDefenseIgnore(actor), ratio: Number(parameters.ratio ?? 1),
        critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
      const source = girlSource(littleGirlIds.basic, actor.unitId);
      const protection: StatusInstance = { instanceId: `${littleGirlIds.featherProtection}:${actor.unitId}:${context.state.counters.action + 1}`,
        statusId: littleGirlIds.featherProtection, source, stacks: 1,
        duration: { kind: 'count', remaining: 1, owner: 'target-turn' } };
      return [{ type: 'deal-damage', source, targetId: target.unitId, amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical },
        { type: 'add-status', source, targetId: actor.unitId, instance: protection }];
    },
  };
  const ultimate: SkillDefinition = {
    id: littleGirlIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 1 },
    target: 'multi', targetRelation: 'ally', allowDefeatedTargets: false, levels: [
      { healRatio: .1, costRatio: .3 }, { healRatio: .15, costRatio: .3 }, { healRatio: .2, costRatio: .3 },
      { healRatio: .2, costRatio: .2 }, { healRatio: .2, costRatio: .2 },
    ],
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const skillLevel = Math.max(1, Math.min(5, actor.skillLevel));
      const shouldHealSelf = actor.hp / Math.max(1, actor.stats.hp) < .3;
      const targets = intent.targetIds.map(id => context.getUnit(id)).filter((unit): unit is NonNullable<typeof unit> =>
        Boolean(unit && unit.side === actor.side && unit.hp > 0
          && (unit.unitId !== actor.unitId || shouldHealSelf)));
      const source = girlSource(littleGirlIds.ultimate, actor.unitId);
      const commands: EffectCommand[] = [{ type: 'lose-life', source, targetId: actor.unitId,
        amount: actor.hp * Number(parameters.costRatio ?? (skillLevel >= 4 ? .2 : .3)), lifeLossKind: 'direct' }];
      for (const target of targets) {
        const protection: StatusInstance = { instanceId: `${littleGirlIds.lifeProtection}:${actor.unitId}:${target.unitId}:${context.state.counters.action + 1}`,
          statusId: littleGirlIds.lifeProtection, source, stacks: 1,
          duration: { kind: 'count', remaining: 1, owner: 'target-turn' } };
        commands.push({ type: 'heal', source, targetId: target.unitId, amount: target.stats.hp * Number(parameters.healRatio ?? .1) });
        commands.push({ type: 'add-status', source, targetId: target.unitId, instance: protection });
      }
      return commands;
    },
  };

  const definition: HeroDefinition = {
    id: littleGirlIds.hero,
    skills: [basic, ultimate],
    aiCoverage: 'verified',
    mechanicsCoverage: 'partial',
    modifyIncomingDamage(_attacker, target, amount) {
      if (target.heroId !== littleGirlIds.hero) return amount;
      const ratio = [.03, .035, .04, .045, .05][Math.max(0, Math.min(4, target.skillLevel - 1))]!;
      return cappedDamageReduction(amount, target.stats.hp, ratio);
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      const allies = context.getLivingUnits(actor.side);
      const critical = allies.some(ally => ally.hp / Math.max(1, ally.stats.hp) < .6);
      if (critical && (context.state.resources[actor.side]?.fire ?? 0) >= 1) {
        const targets = allies.filter(ally => ally.unitId !== actor.unitId || actor.hp / Math.max(1, actor.stats.hp) < .3);
        return { actorId: unitId, skillId: littleGirlIds.ultimate, targetIds: targets.map(unit => unit.unitId),
          shape: 'multi', targetRelation: 'ally' };
      }
      const target = enemies.slice().sort((left, right) => left.hp / left.stats.hp - right.hp / right.stats.hp)[0]!;
      return { actorId: unitId, skillId: littleGirlIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function girlSource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
