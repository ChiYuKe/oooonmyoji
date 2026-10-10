import type { EffectCommand, StatusDuration, SourceRef, StatusId, StatusInstance, UnitId } from '../core/types';
import type { BattleContext } from '../core/types';
import { effectiveTargetResistance } from '../content/flying-edge';

export interface ControlAttempt {
  readonly attemptId: string;
  readonly source: SourceRef;
  readonly targetId: UnitId;
  readonly statusId: string;
  readonly controlType: string;
  readonly baseChance: number;
  /** Additive effect-hit bonus applied before resistance, for same-cast hit buffs. */
  readonly bonusHit?: number;
  readonly duration: StatusDuration;
  readonly modifiers?: StatusInstance['modifiers'];
  readonly ignoreResistance?: number;
  readonly parentEventId?: string;
  readonly scopeId?: string;
}

/** Client calcSkillAddBuff scales application chance by 1 / (1 + effective resist). */
export function chanceAfterResistance(rawChance: number, resistance: number): number {
  const denominator = Math.max(0.0001, 1 + resistance);
  return Math.max(0, Math.min(1, rawChance / denominator));
}

/**
 * Uses the simulator's established low-roll success convention while keeping
 * the client's three probabilities distinct: success, resisted, and failed.
 * calcSkillAddBuff draws those same intervals in reverse order, which has no
 * effect on aggregate simulation odds but does affect a fixed random seed.
 */
export function rollAddBuffChance(context: BattleContext, rawChance: number, resistance: number):
  'success' | 'resisted' | 'failed' {
  const unresistedChance = Math.max(0, Math.min(1, rawChance));
  const adjustedChance = chanceAfterResistance(rawChance, resistance);
  const roll = context.random();
  if (roll < adjustedChance) return 'success';
  if (roll < unresistedChance) return 'resisted';
  return 'failed';
}

/** Rolls hit and resistance modifiers, then returns a typed control command on success. */
export function attemptControl(context: BattleContext, attempt: ControlAttempt): EffectCommand | undefined {
  const sourceUnitId = attempt.source.unitId;
  const sourceStats = sourceUnitId ? context.getEffectiveStats(sourceUnitId) : undefined;
  const targetStats = context.getEffectiveStats(attempt.targetId);
  if (!sourceStats || !targetStats) return undefined;
  const resist = effectiveTargetResistance(targetStats.resist, attempt.source, context.getUnit, attempt.ignoreResistance);
  const hitAdjustedChance = attempt.baseChance * (1 + sourceStats.hit + (attempt.bonusHit ?? 0));
  const result = rollAddBuffChance(context, hitAdjustedChance, resist);
  if (result !== 'success') {
    return result === 'resisted' ? { type: 'report-control-resisted', source: attempt.source, targetId: attempt.targetId,
      controlStatusId: attempt.statusId, controlType: attempt.controlType,
      ...(attempt.parentEventId ? { parentEventId: attempt.parentEventId } : {}) } : undefined;
  }
  return {
    type: 'apply-control',
    source: attempt.source,
    targetId: attempt.targetId,
    ...(attempt.parentEventId ? { parentEventId: attempt.parentEventId } : {}),
    ...(attempt.scopeId ? { scopeId: attempt.scopeId } : {}),
    instance: {
      instanceId: attempt.attemptId,
      statusId: attempt.statusId,
      source: attempt.source,
      stacks: 1,
      duration: attempt.duration,
      values: { controlType: attempt.controlType },
      ...(attempt.modifiers ? { modifiers: attempt.modifiers } : {}),
    },
  };
}

export function attemptDebuff(context: BattleContext, attempt: {
  readonly source: SourceRef;
  readonly targetId: UnitId;
  readonly statusId: StatusId;
  readonly baseChance: number;
  readonly duration: StatusDuration;
  readonly parentEventId?: string;
  readonly stacks?: number;
  readonly values?: Readonly<Record<string, number | string | boolean>>;
  readonly modifiers?: StatusInstance['modifiers'];
  readonly ignoreResistance?: number;
}): EffectCommand[] {
  const sourceStats = attempt.source.unitId ? context.getEffectiveStats(attempt.source.unitId) : undefined;
  const targetStats = context.getEffectiveStats(attempt.targetId);
  if (!sourceStats || !targetStats) return [];
  const hitAdjustedChance = attempt.baseChance * (1 + sourceStats.hit);
  const resist = effectiveTargetResistance(targetStats.resist, attempt.source, context.getUnit, attempt.ignoreResistance);
  const result = rollAddBuffChance(context, hitAdjustedChance, resist);
  if (result !== 'success') return result === 'resisted'
    ? [{ type: 'report-status-resisted', source: attempt.source, targetId: attempt.targetId, statusId: attempt.statusId,
      ...(attempt.parentEventId ? { parentEventId: attempt.parentEventId } : {}) }]
    : [];
  return [{ type: 'add-status', source: attempt.source, targetId: attempt.targetId,
    instance: { instanceId: `${attempt.statusId}:${attempt.source.unitId ?? attempt.source.id}:${attempt.parentEventId ?? 'attempt'}`,
      statusId: attempt.statusId, source: attempt.source, stacks: attempt.stacks ?? 1, duration: attempt.duration,
      ...(attempt.values ? { values: attempt.values } : {}), ...(attempt.modifiers ? { modifiers: attempt.modifiers } : {}) },
    ...(attempt.parentEventId ? { parentEventId: attempt.parentEventId } : {}) }];
}
