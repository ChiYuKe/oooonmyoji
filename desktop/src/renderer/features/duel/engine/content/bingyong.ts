import type { HeroDefinition, SkillDefinition } from '../core/definitions';
import type { ActionIntent, BattleContext, EffectCommand, SourceRef } from '../core/types';
import { attemptControl } from '../mechanics/control';
import type { ContentRegistry } from './registry';

export const bingyongIds = {
  hero: 227,
  basic: '2271',
  passive: '2272',
  tauntSkill: '2273',
  taunt: 'status.hero.227.taunt',
  stoneArmor: 'status.hero.227.stone-armor',
} as const;

const basicDefenseRatios = [3, 3.4, 3.8, 4.2, 4.2] as const;
const armorDefenseBonuses = [1, 1.1, 1.2, 1.3, 1.5] as const;

export function registerBingyong(registry: ContentRegistry): void {
  registry.registerStatus({ id: bingyongIds.taunt, mechanicsCoverage: 'partial', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  registry.registerStatus({ id: bingyongIds.stoneArmor, mechanicsCoverage: 'partial', category: 'buff', dispellable: true,
    sealable: true, durationOwner: 'source-turn', refreshPolicy: 'refresh-duration' });

  const basic: SkillDefinition = {
    id: bingyongIds.basic,
    actionKind: 'basic',
    target: 'single',
    targetRelation: 'enemy',
    levels: basicDefenseRatios.map((ratio, index) => ({ ratio, tauntChance: index === 4 ? .3 : 0 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const actorStats = context.getEffectiveStats(intent.actorId);
      if (!actor || !actorStats) return [];
      const source: SourceRef = { kind: 'skill', id: bingyongIds.basic, unitId: actor.unitId };
      return intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId);
        const targetStats = context.getEffectiveStats(targetId);
        if (!target || !targetStats) return [];
        const damage = context.calculateDamage({ attack: actorStats.defense, defense: targetStats.defense,
          ratio: Number(parameters.ratio ?? 3), critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
        const amount = Math.min(damage.amount, actorStats.attack * 4);
        return [{ type: 'deal-damage' as const, source, targetId, amount,
          ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}), isCritical: damage.isCritical },
          ...(Number(parameters.tauntChance) > 0 ? [attemptControl(context, { attemptId: `${bingyongIds.taunt}:${actor.unitId}:${targetId}:${context.state.counters.action}`,
            source, targetId, statusId: bingyongIds.taunt, controlType: '嘲讽', baseChance: Number(parameters.tauntChance),
            duration: { kind: 'count', remaining: 1, owner: 'target-turn' } })].filter((command): command is EffectCommand => Boolean(command)) : [])];
      });
    },
  };

  const taunt: SkillDefinition = {
    id: bingyongIds.tauntSkill,
    resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'self',
    targetRelation: 'ally',
    levels: armorDefenseBonuses.map(defenseBonus => ({ defenseBonus, tauntChance: .5 })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const source: SourceRef = { kind: 'skill', id: bingyongIds.tauntSkill, unitId: actor.unitId };
      const commands: EffectCommand[] = [{ type: 'add-status', source, targetId: actor.unitId, instance: {
        instanceId: `${bingyongIds.stoneArmor}:${actor.unitId}:${context.state.counters.action}`,
        statusId: bingyongIds.stoneArmor, source, stacks: 1,
        duration: { kind: 'count', remaining: 2, owner: 'source-turn' },
        modifiers: [{ stat: 'defense', operation: 'percent', amount: Number(parameters.defenseBonus ?? 1) }],
      } }];
      for (const enemy of context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue')) {
        const control = attemptControl(context, { attemptId: `${bingyongIds.taunt}:${actor.unitId}:${enemy.unitId}:${context.state.counters.action}`,
          source, targetId: enemy.unitId, statusId: bingyongIds.taunt, controlType: '嘲讽',
          baseChance: Number(parameters.tauntChance ?? .5), duration: { kind: 'count', remaining: 1, owner: 'target-turn' } });
        if (control) commands.push(control);
      }
      return commands;
    },
  };

  const definition: HeroDefinition = {
    id: bingyongIds.hero,
    skills: [basic, taunt],
    aiCoverage: 'verified',
    mechanicsCoverage: 'partial',
    modifyIncomingDamage(_attacker, target, amount, kind, source) {
      if (target.heroId !== bingyongIds.hero || kind !== 'normal' || source?.id === bingyongIds.basic) return amount;
      return amount * .7;
    },
    policy(context: BattleContext, unitId: string): ActionIntent | undefined {
      const actor = context.getUnit(unitId);
      if (!actor || actor.hp <= 0) return undefined;
      const enemies = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue');
      if (enemies.length === 0) return undefined;
      if ((context.state.resources[actor.side]?.fire ?? 0) >= 2) {
        return { actorId: actor.unitId, skillId: bingyongIds.tauntSkill, targetIds: [actor.unitId], shape: 'self', targetRelation: 'ally' };
      }
      const target = enemies.slice().sort((a, b) => a.hp / Math.max(1, a.stats.hp) - b.hp / Math.max(1, b.stats.hp))[0]!;
      return { actorId: actor.unitId, skillId: bingyongIds.basic, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' };
    },
  };
  registry.registerHero(definition);
}
