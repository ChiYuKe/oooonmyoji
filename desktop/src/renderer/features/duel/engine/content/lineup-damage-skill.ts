import type { SkillDefinition } from '../core/definitions';
import type { ActionIntent } from '../core/types';
import { effectiveDefenseIgnore } from '../mechanics/stats';

export function createLineupDamageSkill(id: string, ratios: readonly number[], options: {
  cost?: number;
  target?: 'single' | 'all-enemies';
  hits?: number;
  stat?: 'attack' | 'defense';
  canCrit?: boolean;
  actionKind?: 'basic' | 'skill';
} = {}): SkillDefinition {
  const target = options.target ?? 'single';
  return { id, useClientDamageData: true, actionKind: options.actionKind ?? 'skill', ...(options.cost ? { resourceCost: { resourceId: 'fire', amount: options.cost } } : {}),
    target, targetRelation: 'enemy', levels: ratios.map(ratio => ({ ratio, hits: options.hits ?? 1, stat: options.stat ?? 'attack' })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      const actorStats = actor && context.getEffectiveStats(actor.unitId);
      if (!actor || !actorStats) return [];
      const source = { kind: 'skill' as const, id, unitId: actor.unitId };
      const commands = [];
      for (let hit = 0; hit < Number(parameters.hits ?? 1); hit++) {
        for (const targetId of intent.targetIds) {
          const targetUnit = context.getUnit(targetId);
          const targetStats = targetUnit && context.getEffectiveStats(targetUnit.unitId);
          if (!targetUnit || targetUnit.hp <= 0 || !targetStats) continue;
          const attack = parameters.stat === 'defense' ? actorStats.defense : actorStats.attack;
          const damage = context.calculateDamage({ attack, defense: targetStats.defense,
            defenseIgnore: effectiveDefenseIgnore(actor), ratio: Number(parameters.ratio ?? 1),
            critChance: options.canCrit === false ? 0 : actorStats.crit, critDamage: actorStats.critDamage }, actor, targetUnit);
          commands.push({ type: 'deal-damage' as const, source, targetId: targetUnit.unitId, amount: damage.amount, ...(damage.damageOptions ? { damageOptions: damage.damageOptions } : {}),
            isCritical: damage.isCritical });
        }
      }
      return commands;
    },
  };
}

export function lineupIntent(actorId: string, skillId: string, targetIds: readonly string[], shape: ActionIntent['shape']): ActionIntent {
  return { actorId, skillId, targetIds, shape, targetRelation: shape === 'self' ? 'ally' : 'enemy' };
}

export function lowestHealthEnemy(context: import('../core/types').BattleContext, actor: import('../core/types').UnitState) {
  return context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue')
    .slice().sort((left, right) => left.hp / Math.max(1, left.stats.hp) - right.hp / Math.max(1, right.stats.hp))[0];
}
