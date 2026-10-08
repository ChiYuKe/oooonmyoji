import type { SkillDefinition } from '../core/definitions';
import { effectiveDefenseIgnore } from '../mechanics/stats';

export function createBasicAttackSkill(id: string, ratios: readonly number[]): SkillDefinition {
  return {
    id,
    useClientDamageData: true,
    actionKind: 'basic',
    target: 'single',
    targetRelation: 'enemy',
    levels: ratios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const actorStats = context.getEffectiveStats(actor.unitId) ?? actor.stats;
      const ratio = Number(parameters.ratio ?? 1);
      const source = { kind: 'skill' as const, id, unitId: actor.unitId };
      return intent.targetIds.flatMap(targetId => {
        const target = context.getUnit(targetId);
        if (!target) return [];
        const targetStats = context.getEffectiveStats(target.unitId) ?? target.stats;
        const result = context.calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
          defenseIgnore: effectiveDefenseIgnore(actor), ratio,
          critChance: actorStats.crit, critDamage: actorStats.critDamage }, actor, target);
        return [{ type: 'deal-damage' as const, source, targetId, amount: result.amount, ...(result.damageOptions ? { damageOptions: result.damageOptions } : {}),
          ...(result.isCritical ? { criticalBaseAmount: result.amount / Math.max(1, actorStats.critDamage) } : {}), isCritical: result.isCritical }];
      });
    },
  };
}

export function createHealingSkill(
  id: string,
  ratios: readonly number[],
  target: 'single' | 'all-allies' = 'single',
): SkillDefinition {
  return {
    id,
    actionKind: 'skill',
    target,
    targetRelation: 'ally',
    levels: ratios.map(ratio => ({ ratio })),
    execute(context, intent, parameters) {
      const actor = context.getUnit(intent.actorId);
      if (!actor) return [];
      const attack = context.getEffectiveStats(actor.unitId)?.attack ?? actor.stats.attack;
      const ratio = Number(parameters.ratio ?? 1);
      const source = { kind: 'skill' as const, id, unitId: actor.unitId };
      return intent.targetIds.map(targetId => ({ type: 'heal' as const, source, targetId, amount: attack * ratio }));
    },
  };
}
