import { isUnitBanished, type ActionKind, type BattleEvent, type BattlePhase, type BattleState, type EffectCommand, type EventEnvelope, type StatusCategory, type StatusInstance, type UnitState } from './types';
import type { DamageInterception, StatusDefinition } from './definitions';
import { resolveDamage } from '../mechanics/damage';
import { resolveHealing } from '../mechanics/healing';
import { effectiveIndirectDamageTakenMultiplier } from '../mechanics/stats';
import { applyHurtReduction, calcExtHpAbsorb } from '../mechanics/game-damage';
import type { DamageCalculationHooks } from './definitions';
import { passivesEnabled } from './passive-eligibility';
import { soulsEnabled } from './soul-eligibility';

export interface EffectResolution {
  state: BattleState;
  events: readonly BattleEvent[];
}

export type DamageModifier = ((attacker: UnitState | undefined, target: UnitState, amount: number, kind: 'normal' | 'true',
  state: BattleState, source?: EffectCommand['source'], actionKind?: ActionKind) => number) & DamageCalculationHooks;
export type DamageInterceptor = (state: BattleState, attacker: UnitState | undefined, target: UnitState, amount: number,
  kind: 'normal' | 'true', attackId?: number, hitIndex?: number, source?: EffectCommand['source'],
  cannotBeShared?: boolean, isCritical?: boolean, actionKind?: ActionKind) => DamageInterception | undefined;
export type CriticalDamageModifier = (attacker: UnitState | undefined, target: UnitState, amount: number,
  criticalBaseAmount: number, state: BattleState) => number;
export type HealingModifier = (healer: UnitState | undefined, target: UnitState, amount: number) => number;

export function applyEffectCommands(
  initialState: BattleState,
  commands: readonly EffectCommand[],
  phase: BattlePhase,
  eventPrefix = 'event',
  resolveStatus?: (statusId: string) => StatusDefinition | undefined,
  modifyDamage?: DamageModifier,
  interceptDamage?: DamageInterceptor,
  modifyHealing?: HealingModifier,
  modifyCriticalDamage?: CriticalDamageModifier,
): EffectResolution {
  let state = initialState;
  const events: BattleEvent[] = [];
  let sequence = 0;

  const updateUnit = (unitId: string, update: (unit: UnitState) => UnitState): void => {
    const unit = state.units[unitId];
    if (!unit) return;
    state = { ...state, units: { ...state.units, [unitId]: update(unit) } };
  };
  const envelope = (source: EffectCommand['source'], parentEventId?: string): EventEnvelope => ({
    eventId: `${eventPrefix}-${++sequence}`,
    phase,
    source,
    ...(parentEventId ? { parentEventId } : {}),
    ...(state.counters.action ? { actionId: state.counters.action } : {}),
    ...(state.activeAttackId ?? state.counters.attack ? { attackId: state.activeAttackId ?? state.counters.attack } : {}),
    ...(state.counters.hit ? { hitIndex: state.counters.hit } : {}),
  });
  const consumeOneStatusStack = (target: UnitState, status: StatusInstance, source: EffectCommand['source'], parentEventId?: string): void => {
    if (status.stacks <= 1) {
      updateUnit(target.unitId, current => ({ ...current, statuses: current.statuses.filter(item => item.instanceId !== status.instanceId) }));
      events.push({ ...envelope(status.source, parentEventId), phase: 'effect-resolution', type: 'status-removed',
        targetId: target.unitId, instanceId: status.instanceId, statusId: status.statusId,
        statusCategory: resolveStatus?.(status.statusId)?.category, removedValues: status.values,
        removedSource: status.source, reason: 'consumed' });
      return;
    }
    updateUnit(target.unitId, current => ({ ...current, statuses: current.statuses.map(item => item.instanceId === status.instanceId
      ? { ...item, stacks: item.stacks - 1 } : item) }));
    events.push({ ...envelope(source, parentEventId), phase: 'effect-resolution', type: 'status-stacks-changed',
      targetId: target.unitId, instanceId: status.instanceId, statusId: status.statusId,
      before: status.stacks, after: status.stacks - 1 });
  };

  for (const command of commands) {
    if (command.type === 'schedule-action') {
      events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution', type: 'action-scheduled',
        intent: command.intent, scheduling: command.scheduling, ...(command.freeCast ? { freeCast: true } : {}) });
      continue;
    }
    if (command.type === 'schedule-turn') {
      const actor = state.units[command.unitId];
      if (!actor || actor.hp <= 0) continue;
      state = { ...state, scheduling: { ...state.scheduling,
        extraTurns: [...(state.scheduling?.extraTurns ?? []), actor.unitId] } };
      events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution', type: 'turn-scheduled',
        unitId: actor.unitId, scheduling: command.scheduling, selection: command.selection });
      continue;
    }
    if (command.type === 'schedule-attack') {
      const actor = state.units[command.intent.actorId];
      if (!actor || actor.hp <= 0 || (command.scheduling === 'assist'
        && actor.statuses.some(status => resolveStatus?.(status.statusId)?.preventsAssist))) continue;
      const previousAttackId = state.activeAttackId;
      const previousHitIndex = state.counters.hit;
      const previousAttackTargetIds = state.activeAttackTargetIds;
      const previousAttackShape = state.activeAttackShape;
      const targetIds = [...new Set(command.hits.filter(hit => state.units[hit.targetId]?.hp > 0).map(hit => hit.targetId))];
      if (targetIds.length === 0 || command.hits.length === 0) continue;
      state = { ...state, activeAttackId: state.counters.attack + 1,
        activeAttackTargetIds: targetIds, activeAttackShape: command.intent.shape,
        counters: { ...state.counters, attack: state.counters.attack + 1, hit: 0 } };
      const attackId = state.counters.attack;
      const scheduled: BattleEvent = { ...envelope(command.source, command.parentEventId), phase: 'effect-resolution', type: 'action-scheduled',
        intent: command.intent, scheduling: command.scheduling, preResolved: true };
      const attackStart: BattleEvent = { ...envelope(command.source, scheduled.eventId), phase: 'attack-start', type: 'attack-start', targetIds,
        attackId, shape: command.intent.shape, actionKind: command.intent.kind ?? 'skill' };
      events.push(scheduled, attackStart);
      const hpBefore = new Map(targetIds.map(targetId => [targetId, state.units[targetId]?.hp ?? 0]));
      for (const [hitIndex, hit] of command.hits.entries()) {
        if (state.units[hit.targetId]?.hp <= 0) continue;
        const result = applyEffectCommands(state, [{ type: 'deal-damage', source: command.source, targetId: hit.targetId,
          amount: hit.amount, damageOptions: hit.damageOptions, criticalBaseAmount: hit.criticalBaseAmount, damageKind: hit.damageKind,
          actionKind: command.intent.kind ?? 'skill', isCritical: hit.isCritical,
          suppressSoulTriggers: command.suppressSoulTriggers,
          suppressTargetSoulTriggers: hit.suppressTargetSoulTriggers ?? command.suppressTargetSoulTriggers,
          suppressTargetPassiveTriggers: hit.suppressTargetPassiveTriggers ?? command.suppressTargetPassiveTriggers,
            suppressSourcePassiveTriggers: hit.suppressSourcePassiveTriggers ?? command.suppressSourcePassiveTriggers,
          parentEventId: attackStart.eventId }], 'effect-resolution', `${eventPrefix}-scheduled-${attackId}-${hitIndex + 1}`,
        resolveStatus, modifyDamage, interceptDamage, modifyHealing, modifyCriticalDamage);
        state = result.state;
        events.push(...result.events.map(event => ({ ...event, attackId, ...(state.counters.action ? { actionId: state.counters.action } : {}) })));
      }
      const hitCount = new Set(events.filter((event): event is Extract<BattleEvent, { type: 'damage' }> =>
        event.type === 'damage' && event.attackId === attackId).map(event => event.hitIndex ?? event.eventId)).size;
      const attackDamageEvents = events.filter((event): event is Extract<BattleEvent, { type: 'damage' }> =>
        event.type === 'damage' && event.attackId === attackId);
      const changes = targetIds.map(targetId => {
        const defeatingHit = attackDamageEvents.filter(event => event.targetId === targetId && event.hpAfter === 0).at(-1);
        return { targetId, hpBefore: hpBefore.get(targetId) ?? 0, hpAfter: state.units[targetId]?.hp ?? 0,
          hpLost: Math.max(0, (hpBefore.get(targetId) ?? 0) - (state.units[targetId]?.hp ?? 0)),
          ...(defeatingHit ? { defeatedByHit: true, ...(defeatingHit.overkillDamage === undefined ? {} : { overkillDamage: defeatingHit.overkillDamage }) } : {}) };
      });
      events.push({ ...envelope(command.source, events.at(-1)?.eventId ?? attackStart.eventId), phase: 'attack-end', type: 'attack-ended',
        attackId, hitCount, actionKind: command.intent.kind ?? 'skill', selectedTargetIds: command.intent.selectedTargetId
          ? [command.intent.selectedTargetId] : command.intent.targetIds,
          ...(command.suppressTargetPassiveTriggers || attackDamageEvents.some(event => event.suppressTargetPassiveTriggers)
            ? { suppressTargetPassiveTriggers: true } : {}),
          ...(command.suppressSourcePassiveTriggers ? { suppressSourcePassiveTriggers: true } : {}), targetHealthChanges: changes });
      state = { ...state, activeAttackId: previousAttackId,
        activeAttackTargetIds: previousAttackTargetIds, activeAttackShape: previousAttackShape,
        ...(previousAttackId === undefined ? {} : { counters: { ...state.counters, hit: previousHitIndex } }) };
      continue;
    }
    if (command.type === 'deal-damage') {
      const target = state.units[command.targetId];
      if (!target || target.hp <= 0 || isUnitBanished(target)) continue;
      if (command.countsAsHit !== false) state = { ...state, counters: { ...state.counters, hit: state.counters.hit + 1 } };
      const attacker = command.source.unitId ? state.units[command.source.unitId] : undefined;
      const damageKind = command.damageKind ?? 'normal';
      const criticalAdjustedAmount = !command.precalculated && command.isCritical && Number.isFinite(command.criticalBaseAmount)
        ? modifyCriticalDamage?.(attacker, target, command.amount, command.criticalBaseAmount!, state) ?? command.amount
        : command.amount;
      const adjustedAmount = command.precalculated ? command.amount
        : modifyDamage?.(attacker, target, criticalAdjustedAmount, damageKind, state, command.source, command.actionKind) ?? criticalAdjustedAmount;
      const interception = command.precalculated ? undefined
        : interceptDamage?.(state, attacker, target, adjustedAmount, damageKind, state.activeAttackId ?? state.counters.attack,
          state.counters.hit, command.source, command.cannotBeShared, command.isCritical, command.actionKind);
      let amount = interception?.amount ?? adjustedAmount;
      if (interception?.effects.length) {
        const intercepted = applyEffectCommands(state, interception.effects.map(effect => ({ ...effect,
          parentEventId: effect.parentEventId ?? command.parentEventId })), 'effect-resolution', `${eventPrefix}-intercept-${sequence + 1}`,
        resolveStatus, modifyDamage, interceptDamage, modifyHealing, modifyCriticalDamage);
        state = intercepted.state;
        events.push(...intercepted.events);
      }
      const currentTargetBeforeHit = state.units[command.targetId];
      if (!currentTargetBeforeHit || currentTargetBeforeHit.hp <= 0) continue;
      const activeTarget = state.units[command.targetId] ?? currentTargetBeforeHit;
      const activeAttacker = command.source.unitId ? state.units[command.source.unitId] : attacker;
      const interceptedRatio = adjustedAmount > 0 ? amount / adjustedAmount : 1;
      let criticalAbsorbed = 0;
      const exhaustedStatusIds = new Set<string>();
      if (damageKind === 'normal' && command.isCritical && Number.isFinite(command.criticalBaseAmount)) {
        const criticalBase = (command.precalculated ? command.criticalBaseAmount!
          : modifyDamage?.(activeAttacker, activeTarget, command.criticalBaseAmount!, damageKind, state, command.source) ?? command.criticalBaseAmount!) * interceptedRatio;
        let criticalBonus = Math.max(0, amount - criticalBase);
        const absorbers = target.statuses.filter(status => resolveStatus?.(status.statusId)?.absorbsCriticalBonus);
        const updates = new Map<string, number>();
        for (const status of absorbers) {
          if (criticalBonus <= 0) break;
          const remaining = status.values?.criticalAbsorbRemaining;
          if (typeof remaining !== 'number' || remaining <= 0) continue;
          const absorbed = Math.min(criticalBonus, remaining);
          criticalBonus -= absorbed;
          criticalAbsorbed += absorbed;
          updates.set(status.instanceId, remaining - absorbed);
          if (remaining - absorbed <= 0) exhaustedStatusIds.add(status.instanceId);
        }
        if (updates.size > 0) {
          amount -= criticalAbsorbed;
          updateUnit(target.unitId, current => ({ ...current, statuses: current.statuses.flatMap(status => {
            const remaining = updates.get(status.instanceId);
            if (remaining === undefined) return [status];
            if (remaining <= 0) return [];
            const perLayer = Number(status.values?.initialResist) * 8000;
            const stacks = Number.isFinite(perLayer) && perLayer > 0 ? Math.min(status.stacks, Math.ceil(remaining / perLayer)) : status.stacks;
            return [{ ...status, stacks, values: { ...status.values, criticalAbsorbRemaining: remaining } }];
          }) }));
        }
      }
      const currentTarget = state.units[target.unitId] ?? activeTarget;
      const attrs = currentTarget.damageAttributes;
      const hitActionKind = command.actionKind;
      const hitStatuses = hitActionKind ? currentTarget.statuses.filter(status =>
        resolveStatus?.(status.statusId)?.consumesOneStackOnHitActionKinds?.includes(hitActionKind)) : [];
      const ignoresShieldByStatus = Boolean(hitActionKind && currentTarget.statuses.some(status =>
        resolveStatus?.(status.statusId)?.ignoresShieldOnHitActionKinds?.includes(hitActionKind)));
      const suppressTargetTriggersByStatus = Boolean(hitActionKind && currentTarget.statuses.some(status =>
        resolveStatus?.(status.statusId)?.suppressesTargetTriggersOnHitActionKinds?.includes(hitActionKind)));
      if (!command.precalculated) {
        const rate = command.damageOptions?.hurtReductionRate ?? attrs?.parameterHurtReductionRate ?? 0;
        amount = applyHurtReduction(amount, (command.damageOptions?.seriousInjury ?? attrs?.seriousInjury) && rate >= 0 ? 0 : rate);
        if (amount > 0) amount = Math.max(0, amount - (command.damageOptions?.fixedHurtReductionVal ?? attrs?.fixedHurtReductionVal ?? 0));
      }
      const hurtBeforeAbsorb = amount;
      const statusShield = currentTarget.statuses.reduce((sum, status) => {
        const value = status.values?.shieldRemaining;
        return sum + (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0);
      }, 0);
      const ignoreShield = command.ignoreShield || command.damageOptions?.ignoreShield || ignoresShieldByStatus
        || (activeAttacker?.damageAttributes?.ignoreShieldCounter ?? 0) > 0 || attrs?.beIgnoreShield;
      const result = resolveDamage(currentTarget, amount, currentTarget.shield + statusShield,
        command.shieldDmgAddRate ?? command.damageOptions?.shieldDmgAddRate, ignoreShield, attrs?.absorbAllDamage);
      // Immunity, rebound, leech, then extra HP: calcAttackDmg 1052–1348.
      const unboundedDamage = attrs?.damageImmune || (!ignoreShield && attrs?.absorbAllDamage) ? 0
        : Math.max(0, amount - Math.min(currentTarget.shield + statusShield, ignoreShield ? 0 : amount));
      const reboundDamage = !command.suppressRebound && !activeAttacker?.damageAttributes?.damageImmune
        && (attrs?.hurtReboundRate ?? 0) > 0 && hurtBeforeAbsorb > 0
        ? Math.max(1, (attrs?.hurtReboundRate ?? 0) * hurtBeforeAbsorb) : 0;
      const leechDamage = Math.max(0, (command.leechRate ?? command.damageOptions?.leechRate ?? 0) + (activeAttacker?.damageAttributes?.leechRate ?? 0))
        * (state.resources[activeAttacker?.side ?? currentTarget.side]?.campLeechRate ?? 1) * unboundedDamage;
      const ext = calcExtHpAbsorb(unboundedDamage, currentTarget.resources.extHp ?? 0, attrs?.extHpAbsorptionRate);
      let hpDamage = Math.min(currentTarget.hp, ext.damage);
      const fatalProtection = hpDamage >= currentTarget.hp
        ? currentTarget.statuses.find(status => {
          const definition = resolveStatus?.(status.statusId);
          return status.stacks > 0 && definition?.preventsLethalDamage === true
            && (!definition.requiresPassiveEnabled || (passivesEnabled(currentTarget) && !command.suppressTargetPassiveTriggers))
            && (!definition.requiresSoulEnabled || soulsEnabled(currentTarget));
        })
        : undefined;
      const overkillDamage = !fatalProtection && hpDamage >= currentTarget.hp ? Math.max(0, ext.damage - currentTarget.hp) : 0;
      if (fatalProtection) hpDamage = Math.max(0, currentTarget.hp - 1);
      const unitShieldAbsorbed = Math.min(currentTarget.shield, result.shieldAbsorbed);
      const shieldStatusAbsorbed = result.shieldAbsorbed - unitShieldAbsorbed;
      updateUnit(target.unitId, current => ({
        ...current,
        hp: Math.max(0, current.hp - hpDamage),
        shield: current.shield - unitShieldAbsorbed,
        statuses: consumeShieldStatuses(current.statuses, shieldStatusAbsorbed).flatMap(status => {
          if (status.instanceId === fatalProtection?.instanceId) return status.stacks > 1 ? [{ ...status, stacks: status.stacks - 1 }] : [];
          if (!hitStatuses.some(consumed => consumed.instanceId === status.instanceId)) return [status];
          return status.stacks > 1 ? [{ ...status, stacks: status.stacks - 1 }] : [];
        }),
        resources: ext.consumed > 0 ? { ...current.resources, extHp: Math.max(0, (current.resources.extHp ?? 0) - ext.consumed) } : current.resources,
      }));
      const damageEvent: BattleEvent = { ...envelope(command.source, command.parentEventId), phase: 'hit', type: 'damage', targetId: target.unitId,
        damageKind, ...(command.actionKind ? { actionKind: command.actionKind } : {}), amount: result.amount,
        hpBefore: currentTarget.hp, hpAfter: currentTarget.hp - hpDamage, hpLost: hpDamage,
        ...(overkillDamage > 0 ? { overkillDamage } : {}),
        ...(fatalProtection ? { fatalProtectionStatusId: fatalProtection.statusId } : {}),
        hurtBeforeAbsorb, shieldConsumed: result.shieldAbsorbed, extHpConsumed: ext.consumed, reboundDamage, leechDamage,
        ...(command.damageOptions?.seriousInjury || attrs?.seriousInjury ? { seriousInjury: true,
          recordDefense: command.damageOptions?.recordDefense ?? currentTarget.stats.defense,
          recordHurtReductionRate: command.damageOptions?.recordHurtReductionRate ?? attrs?.hurtReductionRate ?? 0,
          recordIndirectHurtReductionRate: Math.max(0, command.damageOptions?.hurtReductionRate ?? attrs?.parameterHurtReductionRate ?? 0) } : {}),
        mitigated: result.shieldAbsorbed, ...(criticalAbsorbed > 0 ? { criticalAbsorbed } : {}), isCritical: command.isCritical ?? false,
        ...(command.suppressSoulTriggers ? { suppressSoulTriggers: true } : {}),
        ...(command.suppressTargetSoulTriggers || suppressTargetTriggersByStatus ? { suppressTargetSoulTriggers: true } : {}),
          ...(command.suppressTargetPassiveTriggers || suppressTargetTriggersByStatus ? { suppressTargetPassiveTriggers: true } : {}),
          ...(command.suppressSourcePassiveTriggers ? { suppressSourcePassiveTriggers: true } : {}) };
      events.push(damageEvent);
      for (const status of hitStatuses) {
        const definition = resolveStatus?.(status.statusId);
        if (status.stacks > 1) events.push({ ...envelope(status.source, damageEvent.eventId), phase: 'effect-resolution',
          type: 'status-stacks-changed', targetId: target.unitId, instanceId: status.instanceId, statusId: status.statusId,
          before: status.stacks, after: status.stacks - 1 });
        else events.push({ ...envelope(status.source, damageEvent.eventId), phase: 'effect-resolution', type: 'status-removed',
          targetId: target.unitId, instanceId: status.instanceId, statusId: status.statusId, statusCategory: definition?.category,
          removedValues: status.values, removedSource: status.source, reason: 'consumed' });
      }
      if (fatalProtection) {
        if (fatalProtection.stacks > 1) events.push({ ...envelope(fatalProtection.source, damageEvent.eventId), phase: 'effect-resolution',
          type: 'status-stacks-changed', targetId: target.unitId, instanceId: fatalProtection.instanceId,
          statusId: fatalProtection.statusId, before: fatalProtection.stacks, after: fatalProtection.stacks - 1 });
        else events.push({ ...envelope(fatalProtection.source, damageEvent.eventId), phase: 'effect-resolution', type: 'status-removed',
          targetId: target.unitId, instanceId: fatalProtection.instanceId, statusId: fatalProtection.statusId,
          statusCategory: resolveStatus?.(fatalProtection.statusId)?.category, removedValues: fatalProtection.values,
          removedSource: fatalProtection.source, reason: 'consumed' });
      }
      for (const status of target.statuses) if (exhaustedStatusIds.has(status.instanceId)) {
        events.push({ ...envelope(status.source, damageEvent.eventId), phase: 'effect-resolution', type: 'status-removed', targetId: target.unitId,
          instanceId: status.instanceId, statusId: status.statusId, statusCategory: resolveStatus?.(status.statusId)?.category, reason: 'consumed' });
      }
      if (currentTarget.hp > 0 && hpDamage >= currentTarget.hp) events.push({ ...envelope(command.source, damageEvent.eventId), phase: 'unit-defeated',
        type: 'unit-defeated', unitId: target.unitId, defeatedBy: command.source });
      if (activeAttacker && (reboundDamage > 0 || leechDamage > 0)) {
        const reactions: EffectCommand[] = [];
        if (reboundDamage > 0) reactions.push({ type: 'deal-damage', source: { kind: 'system', id: 'damage.rebound', unitId: target.unitId },
          targetId: activeAttacker.unitId, amount: reboundDamage, precalculated: true, suppressRebound: true,
          countsAsHit: false, suppressSoulTriggers: true, parentEventId: damageEvent.eventId });
        if (leechDamage > 0) reactions.push({ type: 'heal', source: command.source, targetId: activeAttacker.unitId,
          amount: leechDamage, parentEventId: damageEvent.eventId });
        const reaction = applyEffectCommands(state, reactions, phase, `${damageEvent.eventId}-reaction`, resolveStatus,
          modifyDamage, interceptDamage, modifyHealing, modifyCriticalDamage);
        state = reaction.state;
        events.push(...reaction.events);
      }
      continue;
    }
    if (command.type === 'lose-life') {
      const target = state.units[command.targetId];
      if (!target || isUnitBanished(target)) continue;
      const requestedAmount = Math.max(0, Number.isFinite(command.amount) ? command.amount : 0);
      const amount = command.lifeLossKind === 'indirect' ? requestedAmount * effectiveIndirectDamageTakenMultiplier(target) : requestedAmount;
      const hpLost = Math.min(Math.max(0, target.hp), amount);
      updateUnit(target.unitId, current => ({ ...current, hp: current.hp - hpLost }));
      const lifeLostEvent: BattleEvent = { ...envelope(command.source, command.parentEventId), phase: 'effect-resolution', type: 'life-lost',
        targetId: target.unitId, amount, hpLost, ...(command.lifeLossKind ? { lifeLossKind: command.lifeLossKind } : {}) };
      events.push(lifeLostEvent);
      if (target.hp > 0 && target.hp - hpLost <= 0) events.push({ ...envelope(command.source, lifeLostEvent.eventId),
        phase: 'unit-defeated', type: 'unit-defeated', unitId: target.unitId, defeatedBy: command.source });
      continue;
    }
    if (command.type === 'revive') {
      const target = state.units[command.targetId];
      if (!target || target.hp > 0) continue;
      const reviveBlocker = target.statuses.find(status => resolveStatus?.(status.statusId)?.preventsRevive);
      if (reviveBlocker) {
        events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution', type: 'revive-blocked',
          unitId: target.unitId, protectionStatusId: reviveBlocker.statusId });
        continue;
      }
      const hp = Math.min(Math.max(1, target.stats.hp), Math.max(1, Number.isFinite(command.hp) ? command.hp : 1));
      const removedControls = target.statuses.filter(status => resolveStatus?.(status.statusId)?.category === 'control');
      updateUnit(target.unitId, current => ({ ...current, hp,
        statuses: current.statuses.filter(status => !removedControls.some(control => control.instanceId === status.instanceId)) }));
      events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution', type: 'unit-revived', unitId: target.unitId, hp });
      for (const status of removedControls) events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution',
        type: 'status-removed', targetId: target.unitId, instanceId: status.instanceId, statusId: status.statusId,
        statusCategory: 'control', reason: 'consumed' });
      continue;
    }
    if (command.type === 'summon-unit') {
      const unit = command.unit;
      const owner = unit.summonedByUnitId ? state.units[unit.summonedByUnitId] : undefined;
      if (!unit.unitId || state.units[unit.unitId] || !owner || owner.side !== unit.side || unit.hp <= 0
        || (unit.unitKind !== undefined && unit.unitKind !== 'summon')) continue;
      const summoned: UnitState = { ...unit, unitKind: 'summon' };
      state = { ...state, units: { ...state.units, [summoned.unitId]: summoned },
        sides: { ...state.sides, [summoned.side]: [...state.sides[summoned.side], summoned.unitId] } };
      events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution', type: 'unit-summoned',
        unitId: summoned.unitId, ownerUnitId: owner.unitId, heroId: summoned.heroId });
      continue;
    }
    if (command.type === 'apply-control') {
      const target = state.units[command.targetId];
      if (!target || target.hp <= 0 || isUnitBanished(target)) continue;
      const scopeId = command.scopeId ?? `action:${state.counters.action || eventPrefix}`;
      const debuffImmunity = target.statuses.find(status => resolveStatus?.(status.statusId)?.statusImmunity === 'debuffs');
      if (debuffImmunity) {
        events.push({ ...envelope(command.source, command.parentEventId), phase: 'control-application', type: 'control-blocked',
          targetId: target.unitId, controlStatusId: command.instance.statusId, protectionStatusId: debuffImmunity.statusId,
          blockReason: 'immunity' });
        continue;
      }
      const typedControlImmunity = target.statuses.find(status =>
        resolveStatus?.(status.statusId)?.controlImmunityTypes?.includes(String(command.instance.values?.controlType ?? '')));
      if (typedControlImmunity) {
        events.push({ ...envelope(command.source, command.parentEventId), phase: 'control-application', type: 'control-blocked',
          targetId: target.unitId, controlStatusId: command.instance.statusId,
          protectionStatusId: typedControlImmunity.statusId, blockReason: 'immunity' });
        continue;
      }
      const protection = target.statuses.find(status => Boolean(resolveStatus?.(status.statusId)?.controlProtection));
      const protectionRule = protection && resolveStatus?.(protection.statusId)?.controlProtection;
      const previousScope = protection?.values?.controlProtectionScopeId;
      const blocked = Boolean(protection && protectionRule && (protectionRule === 'immune' || protectionRule === 'single-application'
        || previousScope === undefined || previousScope === scopeId));
      const controlEventId = `${eventPrefix}-control-${++sequence}`;
      if (blocked && protection && protectionRule) {
        const controlEvent: BattleEvent = { eventId: controlEventId, phase: 'control-application', source: command.source,
          ...(command.parentEventId ? { parentEventId: command.parentEventId } : {}),
          ...(state.counters.action ? { actionId: state.counters.action } : {}),
          ...(state.counters.attack ? { attackId: state.counters.attack } : {}),
          type: 'control-blocked', targetId: target.unitId, controlStatusId: command.instance.statusId,
          protectionStatusId: protection.statusId, blockReason: 'protection' };
        if (protectionRule === 'single-application') {
          updateUnit(target.unitId, current => ({ ...current, statuses: current.statuses.filter(status => status.instanceId !== protection.instanceId) }));
          events.push(controlEvent, { ...envelope(protection.source, controlEvent.eventId), phase: 'control-application',
            type: 'status-removed', targetId: target.unitId, instanceId: protection.instanceId, statusId: protection.statusId,
            statusCategory: resolveStatus?.(protection.statusId)?.category, reason: 'consumed' });
        } else if (previousScope === undefined) {
          updateUnit(target.unitId, current => ({ ...current, statuses: current.statuses.map(status => status.instanceId === protection.instanceId
            ? { ...status, values: { ...status.values, controlProtectionScopeId: scopeId } } : status) }));
          events.push(controlEvent);
        } else events.push(controlEvent);
        continue;
      }
      let protectionRemovedEvent: BattleEvent | undefined;
      if (protection && protectionRule === 'single-skill' && previousScope !== scopeId) {
        updateUnit(target.unitId, current => ({ ...current, statuses: current.statuses.filter(status => status.instanceId !== protection.instanceId) }));
        protectionRemovedEvent = { eventId: controlEventId, phase: 'control-application', source: command.source,
          ...(command.parentEventId ? { parentEventId: command.parentEventId } : {}),
          ...(state.counters.action ? { actionId: state.counters.action } : {}),
          ...(state.counters.attack ? { attackId: state.counters.attack } : {}),
          type: 'status-removed', targetId: target.unitId, instanceId: protection.instanceId, statusId: protection.statusId,
          statusCategory: resolveStatus?.(protection.statusId)?.category, reason: 'consumed' };
      }
      const newlyControlled = !target.statuses.some(status => resolveStatus?.(status.statusId)?.category === 'control'
        || status.values?.controlType !== undefined);
      const controlEvent: BattleEvent = { eventId: protectionRemovedEvent ? `${controlEventId}-applied` : controlEventId,
        phase: 'control-application', source: command.source,
        ...(command.parentEventId ? { parentEventId: command.parentEventId } : {}),
        ...(state.counters.action ? { actionId: state.counters.action } : {}),
        ...(state.counters.attack ? { attackId: state.counters.attack } : {}),
        type: 'control-applied', targetId: target.unitId, statusId: command.instance.statusId, newlyControlled,
        ...(typeof command.instance.values?.controlType === 'string' ? { controlType: command.instance.values.controlType } : {}) };
      const applied = applyEffectCommands(state, [{ type: 'add-status', source: command.source, targetId: command.targetId,
        instance: command.instance, parentEventId: controlEvent.eventId }], 'control-application', `${eventPrefix}-control-status`,
      resolveStatus, modifyDamage, undefined, modifyHealing, modifyCriticalDamage);
      state = applied.state;
      if (protectionRemovedEvent) events.push(protectionRemovedEvent);
      events.push(controlEvent, ...applied.events);
      continue;
    }
    if (command.type === 'report-control-resisted') {
      events.push({ ...envelope(command.source, command.parentEventId), phase: 'control-application', type: 'control-resisted',
        targetId: command.targetId, controlStatusId: command.controlStatusId, controlType: command.controlType });
      continue;
    }
    if (command.type === 'report-status-resisted') {
      events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution', type: 'status-resisted',
        targetId: command.targetId, statusId: command.statusId });
      continue;
    }
    if (command.type === 'dispel-statuses') {
      const target = state.units[command.targetId];
      if (!target || isUnitBanished(target)) continue;
      const requested = command.statusIds ? new Set(command.statusIds) : undefined;
        const requestedInstances = command.instanceIds ? new Set(command.instanceIds) : undefined;
      const maxCount = command.maxCount === undefined ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(command.maxCount));
      const removed = new Set<string>();
      const preferred = new Map((command.preferCategories ?? []).map((category, index) => [category, index]));
      const candidates = target.statuses.map((status, index) => ({ status, index, definition: resolveStatus?.(status.statusId) }))
          .filter(({ status, definition }) => definition?.dispellable === true && (!requested || requested.has(status.statusId))
            && (!requestedInstances || requestedInstances.has(status.instanceId))
          && (command.filter === 'debuff-or-control' ? definition.category === 'debuff' || definition.category === 'control'
            : command.filter === 'buff' ? definition.category === 'buff' : true))
        .sort((a, b) => (preferred.get(a.definition!.category ?? 'other') ?? Number.MAX_SAFE_INTEGER)
          - (preferred.get(b.definition!.category ?? 'other') ?? Number.MAX_SAFE_INTEGER) || a.index - b.index);
      for (const { status } of candidates) {
        if (removed.size >= maxCount) break;
        removed.add(status.instanceId);
      }
      if (removed.size > 0) {
        updateUnit(target.unitId, current => ({ ...current, statuses: current.statuses.filter(status => !removed.has(status.instanceId)) }));
        for (const status of target.statuses) if (removed.has(status.instanceId)) {
          events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution', type: 'status-removed',
            targetId: target.unitId, instanceId: status.instanceId, statusId: status.statusId,
            statusCategory: resolveStatus?.(status.statusId)?.category, removedValues: status.values, removedSource: status.source, reason: 'dispelled' });
        }
      }
      continue;
    }
    if (command.type === 'transfer-status') {
      const from = state.units[command.fromTargetId];
      const to = state.units[command.toTargetId];
      if (!from || !to || to.hp <= 0 || isUnitBanished(from) || isUnitBanished(to) || from.unitId === to.unitId) continue;
      const status = from.statuses.find(item => item.instanceId === command.instanceId);
      const definition = status && resolveStatus?.(status.statusId);
      if (!status || !definition?.dispellable || (definition.category !== 'buff' && definition.category !== 'shield')) continue;
      const removeEventId = `${eventPrefix}-${sequence + 1}`;
      updateUnit(from.unitId, current => ({ ...current, statuses: current.statuses.filter(item => item.instanceId !== status.instanceId) }));
      const removed: BattleEvent = { ...envelope(command.source, command.parentEventId), phase: 'effect-resolution',
        type: 'status-removed', targetId: from.unitId, instanceId: status.instanceId, statusId: status.statusId,
        statusCategory: definition.category, reason: 'dispelled' };
      const transferred: StatusInstance = { ...status, instanceId: `${status.instanceId}:transfer:${removeEventId}`,
        appliedByEventId: removeEventId };
      events.push(removed);
      const addition = applyEffectCommands(state, [{ type: 'add-status', source: command.source, targetId: to.unitId,
        instance: transferred, parentEventId: removed.eventId }], phase, `${eventPrefix}-transfer-${sequence + 1}`,
      resolveStatus, modifyDamage, interceptDamage, modifyHealing, modifyCriticalDamage);
      state = addition.state;
      events.push(...addition.events);
      continue;
    }
    if (command.type === 'remove-statuses') {
      const target = state.units[command.targetId];
      if (!target) continue;
      const ids = new Set(command.statusIds);
      const removed = target.statuses.filter(status => ids.has(status.statusId));
      if (removed.length === 0) continue;
      const removedIds = new Set(removed.map(status => status.instanceId));
      updateUnit(target.unitId, current => ({ ...current, statuses: current.statuses.filter(status => !removedIds.has(status.instanceId)) }));
      for (const status of removed) events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution',
        type: 'status-removed', targetId: target.unitId, instanceId: status.instanceId, statusId: status.statusId,
        statusCategory: resolveStatus?.(status.statusId)?.category, removedValues: status.values, removedSource: status.source,
        reason: command.reason ?? 'consumed' });
      continue;
    }
    if (command.type === 'remove-status-instances') {
      const target = state.units[command.targetId];
      if (!target) continue;
      const ids = new Set(command.instanceIds);
      const removed = target.statuses.filter(status => ids.has(status.instanceId));
      if (removed.length === 0) continue;
      const removedIds = new Set(removed.map(status => status.instanceId));
      updateUnit(target.unitId, current => ({ ...current, statuses: current.statuses.filter(status => !removedIds.has(status.instanceId)) }));
      for (const status of removed) events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution',
        type: 'status-removed', targetId: target.unitId, instanceId: status.instanceId, statusId: status.statusId,
        statusCategory: resolveStatus?.(status.statusId)?.category, removedValues: status.values, removedSource: status.source,
        reason: command.reason ?? 'consumed' });
      continue;
    }
    if (command.type === 'heal') {
      const target = state.units[command.targetId];
      if (!target || isUnitBanished(target)) continue;
      const healingBlocker = target.statuses.find(status => status.stacks > 0 && resolveStatus?.(status.statusId)?.blocksNextHealing);
      if (healingBlocker) {
        consumeOneStatusStack(target, healingBlocker, command.source, command.parentEventId);
        events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution', type: 'healing-blocked',
          targetId: target.unitId, sourceId: command.source.id, restrictionStatusId: healingBlocker.statusId });
        continue;
      }
      const restriction = findHealingRestriction(target, command.source.id, resolveStatus);
      if (restriction) {
        events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution', type: 'healing-blocked',
          targetId: target.unitId, sourceId: command.source.id, restrictionStatusId: restriction.statusId });
        continue;
      }
      const healer = command.source.unitId ? state.units[command.source.unitId] : undefined;
      const modifiedAmount = modifyHealing?.(healer, target, command.amount) ?? command.amount;
      let amount = Math.max(0, Number.isFinite(modifiedAmount) ? modifiedAmount : 0);
      let healingAbsorbed = 0;
      const depletedAbsorptions = new Set<string>();
      const absorbedAmounts = new Map<string, number>();
      for (const status of target.statuses) {
        if (!resolveStatus?.(status.statusId)?.healingAbsorption || amount <= 0) continue;
        const remaining = status.values?.healingAbsorptionRemaining;
        if (typeof remaining !== 'number' || !Number.isFinite(remaining) || remaining <= 0) continue;
        const absorbed = Math.min(amount, remaining);
        amount -= absorbed;
        healingAbsorbed += absorbed;
        absorbedAmounts.set(status.instanceId, remaining - absorbed);
        if (remaining - absorbed <= 0) depletedAbsorptions.add(status.instanceId);
      }
      if (absorbedAmounts.size > 0) {
        updateUnit(target.unitId, current => ({ ...current, statuses: current.statuses.flatMap(status => {
          const remaining = absorbedAmounts.get(status.instanceId);
          if (remaining === undefined) return [status];
          return remaining <= 0 ? [] : [{ ...status, values: { ...status.values, healingAbsorptionRemaining: remaining } }];
        }) }));
        for (const status of target.statuses) if (depletedAbsorptions.has(status.instanceId)) {
          events.push({ ...envelope(status.source, command.parentEventId), phase: 'effect-resolution', type: 'status-removed',
            targetId: target.unitId, instanceId: status.instanceId, statusId: status.statusId,
            statusCategory: resolveStatus?.(status.statusId)?.category, removedValues: status.values,
            removedSource: status.source, reason: 'consumed' });
        }
      }
      const healedTarget = state.units[target.unitId] ?? target;
      const converter = healedTarget.statuses.map(status => ({ status, rule: resolveStatus?.(status.statusId)?.healingConversionToShield }))
        .find(item => item.rule);
      if (converter?.rule) {
        const shieldAmount = Math.max(0, Number.isFinite(amount) ? amount : 0) * converter.rule.ratio;
        const converted: BattleEvent = { ...envelope(command.source, command.parentEventId), phase: 'effect-resolution',
          type: 'healing-converted', targetId: target.unitId, requestedAmount: Math.max(0, amount), shieldAmount,
          shieldStatusId: converter.rule.shieldStatusId };
        events.push(converted);
        if (shieldAmount > 0) {
          const shieldSource = converter.status.source;
          const shield: EffectCommand = { type: 'add-status', source: command.source, targetId: target.unitId,
            parentEventId: converted.eventId, instance: { instanceId: `${converter.rule.shieldStatusId}:${target.unitId}:${converted.eventId}`,
              statusId: converter.rule.shieldStatusId, source: shieldSource, stacks: 1,
              duration: { kind: 'count', remaining: converter.rule.duration, owner: converter.rule.durationOwner },
              values: { shieldRemaining: shieldAmount } } };
          const applied = applyEffectCommands(state, [shield], 'effect-resolution', `${eventPrefix}-heal-converted-${sequence + 1}`,
            resolveStatus, modifyDamage, interceptDamage, modifyHealing, modifyCriticalDamage);
          state = applied.state;
          events.push(...applied.events);
        }
        continue;
      }
      const result = resolveHealing(healedTarget.hp, healedTarget.stats.hp, amount);
      updateUnit(healedTarget.unitId, current => ({ ...current, hp: result.hpAfter }));
      events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution', type: 'healing', targetId: target.unitId,
        amount: result.amount, requestedAmount: Math.max(0, Number.isFinite(command.amount) ? command.amount : 0), hpGained: result.hpGained,
        ...(healingAbsorbed > 0 ? { healingAbsorbed } : {}) });
      continue;
    }
    if (command.type === 'restore-health') {
      const target = state.units[command.targetId];
      if (!target || target.hp <= 0 || isUnitBanished(target)) continue;
      const restriction = findHealingRestriction(target, command.source.id, resolveStatus);
      if (restriction) {
        events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution', type: 'healing-blocked',
          targetId: target.unitId, sourceId: command.source.id, restrictionStatusId: restriction.statusId });
        continue;
      }
      const amount = Math.max(0, Number.isFinite(command.amount) ? command.amount : 0);
      const hp = Math.min(target.stats.hp, target.hp + amount);
      const hpGained = hp - target.hp;
      updateUnit(target.unitId, current => ({ ...current, hp }));
      events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution', type: 'health-restored',
        targetId: target.unitId, amount, hpGained });
      continue;
    }
    if (command.type === 'increase-max-health') {
      const target = state.units[command.targetId];
      const amount = Math.max(0, Number.isFinite(command.amount) ? command.amount : 0);
      if (!target || target.hp <= 0 || isUnitBanished(target) || amount <= 0) continue;
      const newMaxHp = target.stats.hp + amount;
      const newHp = Math.min(newMaxHp, target.hp + amount);
      const hpGained = newHp - target.hp;
      updateUnit(target.unitId, current => ({ ...current, stats: { ...current.stats, hp: newMaxHp }, hp: newHp }));
      events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution', type: 'max-health-changed',
        targetId: target.unitId, before: target.stats.hp, after: newMaxHp });
      if (hpGained > 0) events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution',
        type: 'health-restored', targetId: target.unitId, amount: hpGained, hpGained });
      continue;
    }
    if (command.type === 'reduce-max-health') {
      const target = state.units[command.targetId];
      if (!target || target.stats.hp <= 0 || isUnitBanished(target)) continue;
      const amount = Math.max(0, Number.isFinite(command.amount) ? command.amount : 0);
      const minimumRatio = Math.max(0, Math.min(1, Number.isFinite(command.minimumRatio) ? command.minimumRatio : 0));
      if (amount <= 0) continue;
      const previous = target.statuses.find(status => status.statusId === command.statusId);
      const originalMaxHp = typeof previous?.values?.originalMaxHp === 'number'
        ? previous.values.originalMaxHp : target.stats.hp;
      const maxHp = Math.max(originalMaxHp * minimumRatio, target.stats.hp - amount);
      if (maxHp >= target.stats.hp) continue;
      const instance: StatusInstance = {
        ...(previous ?? { instanceId: `${command.statusId}:${target.unitId}`, statusId: command.statusId,
          source: command.source, stacks: 1, duration: { kind: 'permanent' as const } }),
        source: command.source,
        values: { originalMaxHp, currentMaxHp: maxHp, reducedMaxHp: originalMaxHp - maxHp },
      };
      updateUnit(target.unitId, current => ({ ...current,
        stats: { ...current.stats, hp: maxHp }, hp: Math.min(current.hp, maxHp),
        statuses: [...current.statuses.filter(status => status.statusId !== command.statusId), instance],
      }));
      events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution', type: 'status-added',
        targetId: target.unitId, instance });
      continue;
    }
    if (command.type === 'change-status-stacks') {
      const target = state.units[command.targetId];
      const current = target?.statuses.find(status => status.instanceId === command.instanceId);
      if (!target || isUnitBanished(target) || !current || !Number.isFinite(command.amount) || command.amount === 0) continue;
      const definition = resolveStatus?.(current.statusId);
      const maximum = definition?.maxStacks ?? Number.POSITIVE_INFINITY;
      const after = Math.max(0, Math.min(maximum, current.stacks + Math.trunc(command.amount)));
      if (after === current.stacks) continue;
      if (after === 0) {
        updateUnit(target.unitId, unit => ({ ...unit, statuses: unit.statuses.filter(status => status.instanceId !== current.instanceId) }));
        events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution', type: 'status-removed',
          targetId: target.unitId, instanceId: current.instanceId, statusId: current.statusId,
          statusCategory: definition?.category, removedValues: current.values, removedSource: current.source, reason: 'consumed' });
      } else {
        updateUnit(target.unitId, unit => ({ ...unit, statuses: unit.statuses.map(status => status.instanceId === current.instanceId
          ? { ...status, stacks: after } : status) }));
        events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution', type: 'status-stacks-changed',
          targetId: target.unitId, instanceId: current.instanceId, statusId: current.statusId, before: current.stacks, after });
      }
      continue;
    }
    if (command.type === 'add-status') {
      const target = state.units[command.targetId];
      if (!target || isUnitBanished(target)) continue;
      const category = resolveStatus?.(command.instance.statusId)?.category;
      const incomingDefinition = resolveStatus?.(command.instance.statusId);
      const blocker = incomingDefinition?.category === 'buff' && incomingDefinition.dispellable
        ? target.statuses.find(status => resolveStatus?.(status.statusId)?.blocksNextDispellableBuff) : undefined;
      if (blocker) {
        updateUnit(target.unitId, current => ({ ...current, statuses: current.statuses.filter(status => status.instanceId !== blocker.instanceId) }));
        events.push({ ...envelope(blocker.source, command.parentEventId), phase: 'effect-resolution', type: 'status-application-blocked',
          targetId: target.unitId, attemptedStatusId: command.instance.statusId, protectionStatusId: blocker.statusId, blockReason: 'protection' });
        events.push({ ...envelope(blocker.source, command.parentEventId), phase: 'effect-resolution', type: 'status-removed',
          targetId: target.unitId, instanceId: blocker.instanceId, statusId: blocker.statusId,
          statusCategory: resolveStatus?.(blocker.statusId)?.category, removedValues: blocker.values, reason: 'consumed' });
        continue;
      }
      const buffBlocker = (category === 'buff' || category === 'shield')
        ? target.statuses.find(status => resolveStatus?.(status.statusId)?.preventsBuffApplications) : undefined;
      if (buffBlocker) {
        events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution', type: 'status-application-blocked',
          targetId: target.unitId, attemptedStatusId: command.instance.statusId, protectionStatusId: buffBlocker.statusId,
          blockReason: 'protection' });
        continue;
      }
      const debuffImmunity = target.statuses.find(status => resolveStatus?.(status.statusId)?.statusImmunity === 'debuffs');
      if (debuffImmunity && (category === 'debuff' || category === 'control')) {
        events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution', type: 'status-application-blocked',
          targetId: target.unitId, attemptedStatusId: command.instance.statusId, protectionStatusId: debuffImmunity.statusId,
          blockReason: 'immunity' });
        continue;
      }
      const instance = { ...command.instance, appliedByEventId: command.instance.appliedByEventId ?? command.parentEventId };
      const statusDefinition = resolveStatus?.(instance.statusId);
      const policy = statusDefinition?.refreshPolicy ?? 'replace';
      const matching = target.statuses.filter(current => current.statusId === instance.statusId
        && (policy === 'add-stack' && statusDefinition?.stackScope === 'source-unit'
          ? current.source.unitId === instance.source.unitId
          : current.source.kind === instance.source.kind && current.source.id === instance.source.id
            && current.source.unitId === instance.source.unitId));
      if (policy === 'keep' && matching.length > 0) continue;
      if (policy === 'refresh-duration' && matching.length > 0) {
        const previous = matching[0]!;
        const refreshed = { ...previous, source: instance.source, appliedByEventId: instance.appliedByEventId, duration: instance.duration };
        const matchingIds = new Set(matching.map(status => status.instanceId));
        updateUnit(target.unitId, current => ({ ...current, statuses: [...current.statuses.filter(status => !matchingIds.has(status.instanceId)), refreshed] }));
        events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution', type: 'status-added', targetId: target.unitId,
          instance: refreshed });
        continue;
      }
      if (policy === 'add-stack' && matching.length > 0) {
        const previous = matching[0]!;
        const maximumStacks = statusDefinition?.maxStacks;
        const incomingShield = instance.values?.shieldRemaining;
        const previousShield = previous.values?.shieldRemaining;
        const incomingCriticalAbsorb = instance.values?.criticalAbsorbRemaining;
        const previousCriticalAbsorb = previous.values?.criticalAbsorbRemaining;
        const values = incomingShield !== undefined || previousShield !== undefined
          || incomingCriticalAbsorb !== undefined || previousCriticalAbsorb !== undefined ? {
          ...previous.values,
          ...instance.values,
          ...(incomingShield !== undefined || previousShield !== undefined
            ? { shieldRemaining: (typeof previousShield === 'number' ? previousShield : 0) + (typeof incomingShield === 'number' ? incomingShield : 0) } : {}),
          ...(incomingCriticalAbsorb !== undefined || previousCriticalAbsorb !== undefined
            ? { criticalAbsorbRemaining: (typeof previousCriticalAbsorb === 'number' ? previousCriticalAbsorb : 0)
              + (typeof incomingCriticalAbsorb === 'number' ? incomingCriticalAbsorb : 0) } : {}),
        } : { ...previous.values, ...instance.values };
        const refreshed = { ...previous, source: instance.source, appliedByEventId: instance.appliedByEventId,
          stacks: Math.min(maximumStacks ?? Number.POSITIVE_INFINITY, previous.stacks + instance.stacks), duration: instance.duration, values };
        const matchingIds = new Set(matching.map(status => status.instanceId));
        updateUnit(target.unitId, current => ({ ...current, statuses: [...current.statuses.filter(status => !matchingIds.has(status.instanceId)), refreshed] }));
        events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution', type: 'status-added', targetId: target.unitId,
          instance: refreshed });
        continue;
      }
      if (policy === 'replace' && matching.length > 0) {
        updateUnit(target.unitId, current => ({ ...current, statuses: [
          ...current.statuses.filter(status => !matching.some(previous => previous.instanceId === status.instanceId)), instance,
        ] }));
        for (const previous of matching) events.push({ ...envelope(previous.source, command.parentEventId), phase: 'effect-resolution',
          type: 'status-removed', targetId: target.unitId, instanceId: previous.instanceId, statusId: previous.statusId,
          statusCategory: resolveStatus?.(previous.statusId)?.category, removedValues: previous.values, removedSource: previous.source,
          reason: 'replaced' });
      } else {
        updateUnit(target.unitId, current => ({ ...current, statuses: [...current.statuses, instance] }));
      }
      events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution', type: 'status-added', targetId: target.unitId, instance });
      continue;
    }
    if (command.type === 'change-action-gauge') {
      const target = state.units[command.targetId];
      if (!target || isUnitBanished(target)) continue;
      const before = target.turnPos === undefined ? target.actionGauge : target.turnPos / 1.2;
      const delta = Number.isFinite(command.amount) ? command.amount : 0;
      if (!delta) continue;
      const immune = command.checkImmunity !== false && target.statuses.some(status => {
        const definition = resolveStatus?.(status.statusId);
        return definition?.preventsActionGaugeChange || (delta < 0 ? definition?.preventsActionGaugeDecrease : definition?.preventsActionGaugeIncrease);
      });
      const advanceBlocker = delta > 0 ? target.statuses.find(status => status.stacks > 0
        && resolveStatus?.(status.statusId)?.blocksNextActionAdvance) : undefined;
      if (advanceBlocker) {
        consumeOneStatusStack(target, advanceBlocker, command.source, command.parentEventId);
        events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution', type: 'action-gauge-changed',
          unitId: target.unitId, before, after: before, requestedAmount: delta, blockedByImmunity: true });
        continue;
      }
      if (immune) {
        events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution', type: 'action-gauge-changed',
          unitId: target.unitId, before, after: before, requestedAmount: delta, blockedByImmunity: true });
        continue;
      }
      const after = Math.max(0, Math.min(100, before + delta));
      updateUnit(target.unitId, current => ({ ...current, actionGauge: after, turnPos: after * 1.2 }));
      events.push({ ...envelope(command.source, command.parentEventId), phase: 'effect-resolution', type: 'action-gauge-changed',
        unitId: target.unitId, before, after, requestedAmount: delta });
      continue;
    }
    if (command.type === 'set-resource-meter-progress') {
      const meter = state.resourceMeters[command.side]?.[command.resourceId];
      if (!meter) continue;
      const progress = Math.max(0, Math.min(Math.max(1, meter.threshold), Math.floor(Number.isFinite(command.progress) ? command.progress : 0)));
      state = { ...state, resourceMeters: { ...state.resourceMeters, [command.side]: { ...state.resourceMeters[command.side],
        [command.resourceId]: { ...meter, progress } } } };
      events.push({ ...envelope(command.source, command.parentEventId), phase, type: 'resource-meter-set', side: command.side,
        resourceId: command.resourceId, progressBefore: meter.progress, progressAfter: progress });
      continue;
    }
    if (command.type === 'advance-resource-meter') {
      const meter = state.resourceMeters[command.side]?.[command.resourceId];
      if (!meter) continue;
      const steps = Math.floor(Number.isFinite(command.steps) ? command.steps : 0);
      const beforeProgress = meter.progress;
      let progress = beforeProgress;
      let nextSupply = meter.nextSupply;
      let resource = state.resources[command.side]?.[command.resourceId] ?? 0;
      const beforeResource = resource;
      let overflow = 0;
      for (let step = 0; step < Math.abs(steps); step++) {
        if (steps < 0) {
          progress = Math.max(0, progress - 1);
          continue;
        }
        progress += 1;
        if (progress < Math.max(1, meter.threshold)) continue;
        progress = 0;
        const supply = Math.min(meter.maxSupply, nextSupply);
        const attempted = resource + supply;
        resource = Math.min(Math.max(0, meter.resourceCap), attempted);
        overflow += Math.max(0, attempted - resource);
        nextSupply = Math.min(meter.maxSupply, nextSupply + 1);
      }
      state = { ...state,
        resourceMeters: { ...state.resourceMeters, [command.side]: { ...state.resourceMeters[command.side],
          [command.resourceId]: { ...meter, progress, nextSupply } } },
        resources: { ...state.resources, [command.side]: { ...state.resources[command.side], [command.resourceId]: resource } },
      };
      const meterEvent: BattleEvent = { ...envelope(command.source, command.parentEventId), phase,
        type: 'resource-meter-advanced', side: command.side, resourceId: command.resourceId,
        progressBefore: beforeProgress, progressAfter: progress, supplied: resource - beforeResource };
      events.push(meterEvent);
      if (resource !== beforeResource) events.push({ ...envelope(command.source, meterEvent.eventId), phase,
        type: 'resource-changed', side: command.side, resourceId: command.resourceId, before: beforeResource, after: resource });
      if (overflow > 0) events.push({ ...envelope(command.source, meterEvent.eventId), phase: 'resource-overflow',
        type: 'resource-overflow', side: command.side, resourceId: command.resourceId, amount: overflow,
        before: beforeResource, after: resource, attempted: beforeResource + overflow + Math.max(0, resource - beforeResource) });
      continue;
    }
    const before = state.resources[command.side]?.[command.resourceId] ?? 0;
    const meter = state.resourceMeters[command.side]?.[command.resourceId];
    const attempted = before + command.amount;
    const after = meter ? Math.max(0, Math.min(Math.max(0, meter.resourceCap), attempted)) : attempted;
    state = { ...state, resources: { ...state.resources, [command.side]: {
      ...state.resources[command.side], [command.resourceId]: after,
    } } };
    events.push({ ...envelope(command.source, command.parentEventId), phase, type: 'resource-changed', side: command.side,
      resourceId: command.resourceId, before, after });
    if (meter && attempted > after) events.push({ ...envelope(command.source, command.parentEventId), phase: 'resource-overflow',
      type: 'resource-overflow', side: command.side, resourceId: command.resourceId, amount: attempted - after,
      before, after, attempted });
  }
  return { state, events };
}

function findHealingRestriction(target: UnitState, sourceId: string,
  resolveStatus?: (statusId: string) => StatusDefinition | undefined): StatusInstance | undefined {
  return target.statuses.find(status => {
    const allowed = resolveStatus?.(status.statusId)?.healingRestriction?.allowedSourceIds;
    return Boolean(allowed && !allowed.includes(sourceId));
  });
}

function consumeShieldStatuses(statuses: UnitState['statuses'], amount: number): UnitState['statuses'] {
  let remaining = amount;
  return statuses.map(status => {
    const current = status.values?.shieldRemaining;
    if (remaining <= 0 || typeof current !== 'number' || current <= 0) return status;
    const consumed = Math.min(current, remaining);
    remaining -= consumed;
    return { ...status, values: { ...status.values, shieldRemaining: current - consumed } };
  });
}
