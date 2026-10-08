import type { CombatStatId, UnitState, UnitStats } from '../core/types';
import { composeAdditive } from './game-stats';

const combatStats: readonly CombatStatId[] = ['attack', 'defense', 'speed', 'crit', 'critDamage', 'hit', 'resist'];

/** Resolves temporary status modifiers from the immutable panel for each query. */
export function effectiveStats(unit: UnitState): UnitStats {
  const result = { ...unit.stats };
  for (const stat of combatStats) {
    let flat = 0;
    let percent = 0;
    for (const status of unit.statuses) for (const modifier of status.modifiers ?? []) {
      if (modifier.stat !== stat || !Number.isFinite(modifier.amount) || !conditionApplies(unit, modifier.condition)) continue;
      const amount = modifier.amount * (modifier.perStack ? status.stacks : 1);
      if (modifier.operation === 'flat') flat += amount;
      else percent += amount;
    }
    const minimum = stat === 'hit' ? -1 : 0;
    result[stat] = composeAdditive(unit.stats[stat], flat, percent, minimum);
  }
  return result;
}

function conditionApplies(unit: UnitState, condition: import('../core/types').StatModifier['condition'], actionKind?: import('../core/types').ActionKind): boolean {
  if (!condition) return true;
  if (condition.actionKind !== undefined && condition.actionKind !== actionKind) return false;
  const healthRatio = unit.hp / Math.max(1, unit.stats.hp);
  if (condition.healthRatioBelow !== undefined && !(healthRatio < condition.healthRatioBelow)) return false;
  if (condition.healthRatioAtLeast !== undefined && !(healthRatio >= condition.healthRatioAtLeast)) return false;
  return true;
}

export function effectiveStat(unit: UnitState, stat: CombatStatId): number {
  return effectiveStats(unit)[stat];
}

/** Resolves the separate anti-critical attribute from the panel and active status modifiers. */
export function effectiveCritResist(unit: UnitState, base = unit.damageAttributes?.critResist ?? 0): number {
  let flat = 0;
  let percent = 0;
  for (const status of unit.statuses) for (const modifier of status.modifiers ?? []) {
    if (modifier.stat !== 'critResist' || !Number.isFinite(modifier.amount)) continue;
    const amount = modifier.amount * (modifier.perStack ? status.stacks : 1);
    if (modifier.operation === 'flat') flat += amount;
    else percent += amount;
  }
  return base * (1 + percent) + flat;
}

/** Resolves additive outgoing damage modifiers stored on typed statuses. */
export function effectiveDamageMultiplier(unit: UnitState, resources?: Readonly<Record<string, number>>, actionKind?: import('../core/types').ActionKind): number {
  let flat = 0;
  let percent = 0;
  for (const status of unit.statuses) for (const modifier of status.modifiers ?? []) {
    if (modifier.stat !== 'damage' || !Number.isFinite(modifier.amount) || !conditionApplies(unit, modifier.condition, actionKind)) continue;
    const amount = modifier.amount * (modifier.perStack ? status.stacks : 1)
      + (modifier.perResource ? (resources?.[modifier.perResource.resourceId] ?? 0) * modifier.perResource.amount : 0);
    if (modifier.operation === 'flat') flat += amount;
    else percent += amount;
  }
  return Math.max(0, (1 + flat) * (1 + percent));
}

/** Resolves additive damage-taken modifiers from typed statuses. */
export function effectiveDamageTakenMultiplier(unit: UnitState, resources?: Readonly<Record<string, number>>, actionKind?: import('../core/types').ActionKind): number {
  let flat = 0;
  let percent = 0;
  for (const status of unit.statuses) for (const modifier of status.modifiers ?? []) {
    if (modifier.stat !== 'damageTaken' || !Number.isFinite(modifier.amount) || !conditionApplies(unit, modifier.condition, actionKind)) continue;
    const amount = modifier.amount * (modifier.perStack ? status.stacks : 1)
      + (modifier.perResource ? (resources?.[modifier.perResource.resourceId] ?? 0) * modifier.perResource.amount : 0);
    if (modifier.operation === 'flat') flat += amount;
    else percent += amount;
  }
  return Math.max(0, (1 + flat) * (1 + percent));
}

/** Applies status-based reduction or amplification to only the bonus part of critical damage. */
export function applyCriticalDamageTakenModifiers(amount: number, criticalBaseAmount: number, target: UnitState): number {
  let flat = 0, percent = 0;
  for (const status of target.statuses) for (const modifier of status.modifiers ?? []) {
    if (modifier.stat !== 'critDamageTaken' || !Number.isFinite(modifier.amount)) continue;
    const value = modifier.amount * (modifier.perStack ? status.stacks : 1);
    if (modifier.operation === 'flat') flat += value;
    else percent += value;
  }
  const multiplier = Math.max(0, (1 + flat) * (1 + percent));
  return criticalBaseAmount + (amount - criticalBaseAmount) * multiplier;
}

/** Resolves flat defense penetration granted by typed statuses. */
export function effectiveDefenseIgnore(unit: UnitState): number {
  return unit.statuses.reduce((total, status) => total + (status.modifiers ?? []).reduce((sum, modifier) =>
    modifier.stat === 'defenseIgnore' && modifier.operation === 'flat' && Number.isFinite(modifier.amount)
      ? sum + modifier.amount * status.stacks : sum, 0), 0);
}

/** Resolves additive incoming-healing modifiers from typed statuses. */
export function effectiveHealingTakenMultiplier(unit: UnitState): number {
  let flat = 0;
  let percent = 0;
  for (const status of unit.statuses) for (const modifier of status.modifiers ?? []) {
    if (modifier.stat !== 'healingTaken' || !Number.isFinite(modifier.amount)) continue;
    const amount = modifier.amount * (modifier.perStack ? status.stacks : 1);
    if (modifier.operation === 'flat') flat += amount;
    else percent += amount;
  }
  return Math.max(0, (1 + flat) * (1 + percent));
}

/** Resolves additive modifiers to non-attack life loss, such as indirect damage. */
export function effectiveIndirectDamageTakenMultiplier(unit: UnitState): number {
  let flat = 0;
  let percent = 0;
  for (const status of unit.statuses) for (const modifier of status.modifiers ?? []) {
    if (modifier.stat !== 'indirectDamageTaken' || !Number.isFinite(modifier.amount)) continue;
    const amount = modifier.amount * (modifier.perStack ? status.stacks : 1);
    if (modifier.operation === 'flat') flat += amount;
    else percent += amount;
  }
  return Math.max(0, (1 + flat) * (1 + percent));
}
