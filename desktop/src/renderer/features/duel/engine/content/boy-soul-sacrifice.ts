import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, EffectCommand, SourceRef } from '../core/types';
import { cappedDamageReduction } from '../mechanics/capped-damage-reduction';
import { effectiveDefenseIgnore } from '../mechanics/stats';
import type { ContentRegistry } from './registry';

export const boySoulSacrificeIds = {
  hero: 212,
  basic: '2121',
  passive: '2122',
  ultimate: '2123',
} as const;

export function registerBoySoulSacrifice(registry: ContentRegistry): void {
  const basic: SkillDefinition = {
    id: boySoulSacrificeIds.basic, actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: [1, 1.05, 1.1, 1.15, 1.25].map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const actorStats = context.getEffectiveStats(intent.actorId);
      const target = context.getUnit(intent.targetIds[0] ?? '');
      const targetStats = target && context.getEffectiveStats(target.unitId);
      if (!actor || !actorStats || !target || !targetStats) return [];
      const hit = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense, defenseIgnore: effectiveDefenseIgnore(actor),
        ratio: Number(parameters.ratio ?? 1), critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
      return [{ type: 'deal-damage', source: boySource(boySoulSacrificeIds.basic, actor.unitId), targetId: target.unitId,
        amount: hit.amount, ...(hit.damageOptions ? { damageOptions: hit.damageOptions } : {}), isCritical: hit.isCritical }];
    },
  };
  const ultimate: SkillDefinition = {
    id: boySoulSacrificeIds.ultimate, actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'multi', targetRelation: 'ally', allowDefeatedTargets: true, levels: [{}],
    execute(context, intent) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const source = boySource(boySoulSacrificeIds.ultimate, actor.unitId);
      const commands: EffectCommand[] = [];
      for (const targetId of intent.targetIds) {
        const target = context.getUnit(targetId);
        if (!target || target.side !== actor.side || target.unitId === actor.unitId) continue;
        if (target.hp <= 0) {
          commands.push({ type: 'revive', source, targetId: target.unitId, hp: target.stats.hp * .3 });
        } else {
          commands.push({ type: 'heal', source, targetId: target.unitId, amount: target.stats.hp * .3 });
        }
        commands.push({ type: 'change-action-gauge', source, targetId: target.unitId, amount: 30 });
      }
      commands.push({ type: 'lose-life', source, targetId: actor.unitId, amount: actor.hp, lifeLossKind: 'direct' });
      return commands;
    },
  };
  const definition: HeroDefinition = {
    id: boySoulSacrificeIds.hero,
    skills: [basic, ultimate],
    aiCoverage: 'verified',
    mechanicsCoverage: 'partial',
    modifyIncomingDamage(_attacker, target, amount) {
      if (target.heroId !== boySoulSacrificeIds.hero) return amount;
      const ratio = [.03, .035, .04, .045, .05][Math.max(0, Math.min(4, target.skillLevel - 1))]!;
      return cappedDamageReduction(amount, target.stats.hp, ratio);
    },
    policy(context, unitId): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (!enemies.length) return undefined;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 3) {
        const allyIds = context.state.sides[actor.side].filter(id => context.getUnit(id));
        return { actorId: unitId, skillId: boySoulSacrificeIds.ultimate, targetIds: allyIds,
          shape: 'multi', targetRelation: 'ally' };
      }
      const target = enemies.slice().sort((left, right) => left.hp / left.stats.hp - right.hp / right.stats.hp)[0]!;
      return { actorId: unitId, skillId: boySoulSacrificeIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}

function boySource(id: string, unitId: string): SourceRef { return { kind: 'skill', id, unitId }; }
