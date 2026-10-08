import { luandouPointRules } from './luandou-points-data';
import type { Panel } from './soul-optimizer';

/**
 * Applies an explicit eight-slot 乱斗 allocation to a panel.
 * The caller must provide a panel that does not already include these points.
 */
export function applyLuandouPoints(panel: Panel, points: readonly number[] | undefined): Panel {
  if (!points) return panel;
  const bonus = Object.fromEntries(luandouPointRules.map(rule => {
    const rawPoints = points[rule.slot] ?? 0;
    const count = Number.isFinite(rawPoints) ? Math.max(0, Math.min(rule.maxPoints, Math.floor(rawPoints))) : 0;
    return [rule.stat, count * rule.perPoint];
  })) as Record<string, number>;

  return {
    ...panel,
    attack: panel.attack * (1 + (bonus.attackAdditionRate ?? 0)),
    defense: panel.defense * (1 + (bonus.defenseAdditionRate ?? 0)),
    hp: panel.hp * (1 + (bonus.maxHpAdditionRate ?? 0)),
    speed: panel.speed + (bonus.speedAdditionVal ?? 0),
    critDamage: panel.critDamage + (bonus.critPowerAdditionVal ?? 0),
    crit: panel.crit + (bonus.critRateAdditionVal ?? 0),
    hit: panel.hit + (bonus.debuffEnhance ?? 0),
    resist: panel.resist + (bonus.debuffResist ?? 0),
  };
}
