import { isUnitBanished, isUnitFightingSpirit, type BattleEvent, type BattleState, type SideId, type UnitId } from './types';
import { effectiveStat } from '../mechanics/stats';

export interface ScheduledActor {
  state: BattleState;
  actorId: UnitId;
  scheduling?: 'extra-turn';
}

export const MOTION_SLOT_MAX_LEN = 120;
export const MOTION_FULL_TURN_MOVE_SPEED = 600;

/** TurnMgrComp._updateTurnPosOnce (757): advance to the leader, then drain the full-turn queue. */
export function scheduleNextActor(state: BattleState, random: () => number): ScheduledActor | undefined {
  const living = Object.values(state.units).filter(unit => (unit.hp > 0 || isUnitFightingSpirit(unit)) && !isUnitBanished(unit));
  if (living.length === 0) return undefined;
  const extraTurns = [...(state.scheduling?.extraTurns ?? [])];
  while (extraTurns.length > 0) {
    const actorId = extraTurns.shift()!;
    if (((state.units[actorId]?.hp ?? 0) <= 0 && !isUnitFightingSpirit(state.units[actorId])) || isUnitBanished(state.units[actorId])) continue;
    return { actorId, scheduling: 'extra-turn', state: { ...state,
      scheduling: { ...state.scheduling, extraTurns } } };
  }
  const advancedUnits = { ...state.units };
  let normalTurns = [...(state.scheduling?.normalTurns ?? [])].filter(id => ((state.units[id]?.hp ?? 0) > 0
    || isUnitFightingSpirit(state.units[id])) && !isUnitBanished(state.units[id]));
  if (!normalTurns.length) {
    const available = living.filter(unit => effectiveStat(unit, 'speed') > 0);
    if (!available.length) return undefined;
    // Native sort key is (-(120-pos)/speed, speed, uid), reverse=True.
    // Exported roster IDs lack native UIDs: equal-speed ties use the seeded camp alternation rule.
    const ordered = available.slice().sort((a, b) =>
      (MOTION_SLOT_MAX_LEN - position(a)) / effectiveStat(a, 'speed')
      - (MOTION_SLOT_MAX_LEN - position(b)) / effectiveStat(b, 'speed')
      || effectiveStat(b, 'speed') - effectiveStat(a, 'speed'));
    const leader = ordered[0];
    const distance = Math.max(0, MOTION_SLOT_MAX_LEN - position(leader));
    const speed = effectiveStat(leader, 'speed');
    for (const unit of ordered) {
      const turnPos = Math.min(MOTION_SLOT_MAX_LEN, position(unit) + distance * effectiveStat(unit, 'speed') / speed);
      advancedUnits[unit.unitId] = { ...unit, turnPos, actionGauge: turnPos * 100 / MOTION_SLOT_MAX_LEN };
    }
    const ready = ordered.filter(unit => position(advancedUnits[unit.unitId]) >= MOTION_SLOT_MAX_LEN - 1e-7);
    let lastSide = state.scheduling?.lastSide;
    while (ready.length) {
      const fastest = effectiveStat(ready[0], 'speed');
      const tied = ready.filter(unit => Math.abs(effectiveStat(unit, 'speed') - fastest) < 1e-7);
      const alternating = tied.filter(unit => unit.side !== lastSide);
      const candidates = alternating.length ? alternating : tied;
      const tieSample = normalTurns.length ? 0 : random();
      const index = Math.min(candidates.length - 1, Math.floor(Math.max(0, Math.min(.999999999, tieSample)) * candidates.length));
      const actor = candidates[index];
      normalTurns.push(actor.unitId);
      ready.splice(ready.indexOf(actor), 1);
      lastSide = actor.side;
    }
  }
  const actor = advancedUnits[normalTurns.shift()!];
  if (!actor) return undefined;
  // TryLock offset 3228 resets the normal actor when locking, before any turn-start callbacks.
  advancedUnits[actor.unitId] = { ...actor, actionGauge: 0, turnPos: 0 };
  return { state: { ...state, units: advancedUnits, scheduling: { extraTurns, normalTurns, lastSide: actor.side } }, actorId: actor.unitId };
}

function position(unit: BattleState['units'][string]): number {
  return unit.turnPos ?? unit.actionGauge * MOTION_SLOT_MAX_LEN / 100;
}

/** Captured com.const.JumpQueuePriority; larger priorities pop first from the inverted sorted list. */
export const JUMP_QUEUE_PRIORITY: Readonly<Record<string, number>> = {
  '2202': 1, '3472': 20, '2542': 21, '5872': -5, '5902': -4,
  '101010': 12, '101011': 11, '101012': 10,
};

export function jumpQueuePriority(event: Extract<BattleEvent, { type: 'action-scheduled' }>): number {
  return JUMP_QUEUE_PRIORITY[event.source.id] ?? JUMP_QUEUE_PRIORITY[event.intent.skillId] ?? 0;
}

export interface BattleEnd {
  winner: SideId | 'draw';
  reason: 'elimination' | 'action-limit';
  blueRemainingRatio: number;
  redRemainingRatio: number;
}

export function checkBattleEnd(state: BattleState, actionLimit = 600): BattleEnd | undefined {
  const blueLiving = state.sides.blue.some(unitId => (state.units[unitId]?.hp ?? 0) > 0 || isUnitFightingSpirit(state.units[unitId]));
  const redLiving = state.sides.red.some(unitId => (state.units[unitId]?.hp ?? 0) > 0 || isUnitFightingSpirit(state.units[unitId]));
  if (blueLiving && redLiving && state.counters.action < actionLimit) return undefined;
  const blueRemainingRatio = teamLifeRatio(state, 'blue');
  const redRemainingRatio = teamLifeRatio(state, 'red');
  return {
    winner: blueRemainingRatio === redRemainingRatio ? 'draw' : blueRemainingRatio > redRemainingRatio ? 'blue' : 'red',
    reason: blueLiving && redLiving ? 'action-limit' : 'elimination',
    blueRemainingRatio,
    redRemainingRatio,
  };
}

export function createBattleEndEvent(end: BattleEnd, state: BattleState, parentEventId?: string): BattleEvent {
  return {
    eventId: `battle-ended-${state.counters.action}`,
    phase: 'battle-end',
    source: { kind: 'system', id: 'simulation' },
    ...(parentEventId ? { parentEventId } : {}),
    ...(state.counters.action > 0 ? { actionId: state.counters.action } : {}),
    type: 'battle-ended',
    winner: end.winner,
    reason: end.reason,
  };
}

function teamLifeRatio(state: BattleState, side: SideId): number {
  return state.sides[side].reduce((sum, unitId) => {
    const unit = state.units[unitId];
    return unit ? sum + (isUnitFightingSpirit(unit) ? Number.EPSILON : Math.max(0, unit.hp) / Math.max(1, unit.stats.hp)) : sum;
  }, 0);
}
