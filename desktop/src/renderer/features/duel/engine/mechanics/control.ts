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
  readonly duration: StatusDuration;
  readonly modifiers?: StatusInstance['modifiers'];
  readonly ignoreResistance?: number;
  readonly parentEventId?: string;
  readonly scopeId?: string;
}

/** Rolls hit and resistance modifiers, then returns a typed control command on success. */
export function attemptControl(context: BattleContext, attempt: ControlAttempt): EffectCommand | undefined {
  const sourceUnitId = attempt.source.unitId;
  const sourceStats = sourceUnitId ? context.getEffectiveStats(sourceUnitId) : undefined;
  const targetStats = context.getEffectiveStats(attempt.targetId);
  if (!sourceStats || !targetStats) return undefined;
  const resist = effectiveTargetResistance(targetStats.resist, attempt.source, context.getUnit, attempt.ignoreResistance);
  const chance = Math.max(0, Math.min(1, attempt.baseChance * (1 + sourceStats.hit)))
    * (1 - resist);
  const rawChance = Math.max(0, Math.min(1, attempt.baseChance * (1 + sourceStats.hit)));
  const roll = context.random();
  if (roll >= chance) {
    return roll < rawChance ? { type: 'report-control-resisted', source: attempt.source, targetId: attempt.targetId,
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
  const rawChance = Math.max(0, Math.min(1, attempt.baseChance * (1 + sourceStats.hit)));
  const resist = effectiveTargetResistance(targetStats.resist, attempt.source, context.getUnit, attempt.ignoreResistance);
  const chance = rawChance * (1 - resist);
  const roll = context.random();
  if (roll >= chance) return roll < rawChance
    ? [{ type: 'report-status-resisted', source: attempt.source, targetId: attempt.targetId, statusId: attempt.statusId,
      ...(attempt.parentEventId ? { parentEventId: attempt.parentEventId } : {}) }]
    : [];
  return [{ type: 'add-status', source: attempt.source, targetId: attempt.targetId,
    instance: { instanceId: `${attempt.statusId}:${attempt.source.unitId ?? attempt.source.id}:${attempt.parentEventId ?? 'attempt'}`,
      statusId: attempt.statusId, source: attempt.source, stacks: attempt.stacks ?? 1, duration: attempt.duration,
      ...(attempt.values ? { values: attempt.values } : {}), ...(attempt.modifiers ? { modifiers: attempt.modifiers } : {}) },
    ...(attempt.parentEventId ? { parentEventId: attempt.parentEventId } : {}) }];
}
