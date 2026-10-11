import type { BattleEvent, BattleState, StatusInstance, UnitId } from './types';
import type { StatusDefinition } from './definitions';

export type StatusTick =
  | { owner: 'source-turn' | 'target-turn'; unitId: UnitId }
  | { owner: 'round' }
  | { owner: 'event'; event: string };

export interface StatusExpirySnapshot {
  readonly instances: Readonly<Record<UnitId, readonly string[]>>;
  /** Refreshing/replacing an instance during this turn starts a new application. */
  readonly applications?: Readonly<Record<UnitId, Readonly<Record<string, string | undefined>>>>;
}

export function captureStatusExpirySnapshot(state: BattleState, tick: StatusTick): StatusExpirySnapshot {
  const instances: Record<UnitId, string[]> = {};
  const applications: Record<UnitId, Record<string, string | undefined>> = {};
  for (const [unitId, unit] of Object.entries(state.units)) {
    const statuses = unit.statuses.filter(status => shouldTick(status, unitId, tick));
    instances[unitId] = statuses.map(status => status.instanceId);
    applications[unitId] = Object.fromEntries(statuses.map(status => [status.instanceId, status.applicationId ?? status.appliedByEventId]));
  }
  return { instances, applications };
}

/** Both clocks advance once per real turn, including extra turns; assists are not turns. */
export function captureTurnStatusExpirySnapshot(state: BattleState, unitId: UnitId): StatusExpirySnapshot {
  const target = captureStatusExpirySnapshot(state, { owner: 'target-turn', unitId });
  const source = captureStatusExpirySnapshot(state, { owner: 'source-turn', unitId });
  return {
    instances: Object.fromEntries(Object.keys(state.units).map(id => [id,
      [...(target.instances[id] ?? []), ...(source.instances[id] ?? [])]])),
    applications: Object.fromEntries(Object.keys(state.units).map(id => [id,
      { ...target.applications?.[id], ...source.applications?.[id] }])),
  };
}

export function advanceStatusDurations(
  state: BattleState,
  snapshot: StatusExpirySnapshot,
  eventPrefix = `status-expiry-${state.counters.round}-${state.counters.action}`,
  resolveStatus?: (id: string) => StatusDefinition | undefined,
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
      if (!ids.has(status.instanceId) || status.duration.kind === 'permanent'
        || (snapshot.applications && snapshot.applications[unitId]?.[status.instanceId] !== (status.applicationId ?? status.appliedByEventId))) {
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
          statusCategory: resolveStatus?.(status.statusId)?.category,
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

/** Remove dying-state buffs, keeping explicit keepOnDie effects and newly added defeat effects. */
export function removeStatusesOnDeath(state: BattleState, unitId: UnitId,
  resolveStatus: ((id: string) => StatusDefinition | undefined) | undefined,
  eventPrefix: string, parentEventId?: string, dyingStatuses?: readonly StatusInstance[]):
{ state: BattleState; events: readonly BattleEvent[] } {
  const unit = state.units[unitId];
  if (!unit?.deathCleanupPending) return { state, events: [] };
  const applications = new Map((dyingStatuses ?? unit.deathCleanupSnapshot ?? unit.statuses)
    .map(status => [status.instanceId, status.applicationId ?? status.appliedByEventId]));
  const removed = unit.statuses.filter(status => applications.has(status.instanceId)
    && applications.get(status.instanceId) === (status.applicationId ?? status.appliedByEventId)
    && resolveStatus?.(status.statusId)?.keepOnDie !== true);
  const ids = new Set(removed.map(status => status.instanceId));
  const nextUnit = { ...unit, deathCleanupPending: false, deathCleanupSnapshot: undefined, shield: 0,
    resources: unit.resources.extHp === undefined ? unit.resources : { ...unit.resources, extHp: 0 },
    statuses: unit.statuses.filter(status => !ids.has(status.instanceId)) };
  return { state: { ...state, units: { ...state.units, [unitId]: nextUnit } },
    events: removed.map((status, index) => ({ eventId: `${eventPrefix}-${index + 1}`, phase: 'effect-resolution',
      source: status.source, ...(parentEventId ? { parentEventId } : {}),
      ...(state.counters.action ? { actionId: state.counters.action } : {}),
      type: 'status-removed', targetId: unitId, instanceId: status.instanceId, statusId: status.statusId,
      statusCategory: resolveStatus?.(status.statusId)?.category, removedValues: status.values,
      removedSource: status.source, reason: 'died' })) };
}

function shouldTick(status: StatusInstance, targetId: UnitId, tick: StatusTick): boolean {
  if (status.duration.kind !== 'count' || status.duration.owner !== tick.owner) return false;
  if (tick.owner === 'source-turn') return status.source.unitId === tick.unitId;
  if (tick.owner === 'target-turn') return targetId === tick.unitId;
  if (tick.owner === 'event') return status.duration.event === tick.event;
  return true;
}
