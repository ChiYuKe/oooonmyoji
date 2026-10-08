import type { BattleEvent, BattleState, StatusInstance, UnitId } from './types';

export type StatusTick =
  | { owner: 'source-turn' | 'target-turn'; unitId: UnitId }
  | { owner: 'round' }
  | { owner: 'event'; event: string };

export interface StatusExpirySnapshot {
  readonly instances: Readonly<Record<UnitId, readonly string[]>>;
}

export function captureStatusExpirySnapshot(state: BattleState, tick: StatusTick): StatusExpirySnapshot {
  const instances: Record<UnitId, string[]> = {};
  for (const [unitId, unit] of Object.entries(state.units)) {
    instances[unitId] = unit.statuses.filter(status => shouldTick(status, unitId, tick)).map(status => status.instanceId);
  }
  return { instances };
}

export function advanceStatusDurations(
  state: BattleState,
  snapshot: StatusExpirySnapshot,
  eventPrefix = `status-expiry-${state.counters.round}-${state.counters.action}`,
): { state: BattleState; events: readonly BattleEvent[] } {
  let nextState = state;
  const events: BattleEvent[] = [];
  let index = 0;
  for (const [unitId, instanceIds] of Object.entries(snapshot.instances)) {
    const unit = nextState.units[unitId];
    if (!unit || instanceIds.length === 0) continue;
    const ids = new Set(instanceIds);
    const statuses: StatusInstance[] = [];
    for (const status of unit.statuses) {
      if (!ids.has(status.instanceId) || status.duration.kind === 'permanent') {
        statuses.push(status);
        continue;
      }
      const remaining = status.duration.remaining - 1;
      if (remaining > 0) {
        statuses.push({ ...status, duration: { ...status.duration, remaining } });
      } else {
        events.push({
          eventId: `${eventPrefix}-${++index}`,
          phase: 'status-expiration',
          source: status.source,
          ...(status.appliedByEventId ? { parentEventId: status.appliedByEventId } : {}),
          ...(nextState.counters.action ? { actionId: nextState.counters.action } : {}),
          type: 'status-removed',
          targetId: unitId,
          instanceId: status.instanceId,
          statusId: status.statusId,
          removedValues: status.values,
          removedSource: status.source,
          reason: 'expired',
        });
      }
    }
    nextState = { ...nextState, units: { ...nextState.units, [unitId]: { ...unit, statuses } } };
  }
  return { state: nextState, events };
}

function shouldTick(status: StatusInstance, targetId: UnitId, tick: StatusTick): boolean {
  if (status.duration.kind !== 'count' || status.duration.owner !== tick.owner) return false;
  if (tick.owner === 'source-turn') return status.source.unitId === tick.unitId;
  if (tick.owner === 'target-turn') return targetId === tick.unitId;
  if (tick.owner === 'event') return status.duration.event === tick.event;
  return true;
}
