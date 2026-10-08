import type { ContentRegistry } from '../content/registry';
import { diagnoseContentCoverage, rosterRefsFromState } from '../content/coverage';
import type { DamageInterceptionContext, HeroDefinition, SoulDefinition } from '../core/definitions';
import { advanceStatusDurations, captureStatusExpirySnapshot } from '../core/status-lifecycle';
import { executeAction } from '../core/action-runner';
import { createBattleContext } from '../core/context';
import { checkBattleEnd, createBattleEndEvent, scheduleNextActor, type BattleEnd } from '../core/action-scheduler';
import { applyEffectCommands, type CriticalDamageModifier, type DamageInterceptor, type DamageModifier, type HealingModifier } from '../core/effects';
import { settleEvents } from '../core/settlement';
import { createSeededRandom, deriveSampleSeed } from '../core/random';
import { TriggerBudget, type TriggerBudgetDiagnostic } from '../core/trigger-budget';
import { isUnitFightingSpirit, type BattleEvent, type BattlePhase, type BattleState, type SourceRef, type UnitState } from '../core/types';
import type { BattleRunOptions, BattleRunResult } from '../core/result';
import { EventDispatcher } from '../core/event-dispatcher';
import { applyCriticalDamageTakenModifiers, effectiveDamageMultiplier, effectiveDamageTakenMultiplier, effectiveDefenseIgnore, effectiveHealingTakenMultiplier, effectiveStats } from '../mechanics/stats';
import { registerPvpRules } from '../mechanics/pvp-rules';
import { selectWeightedAction } from '../policies/weighted-policy';

export interface RunBattleOptions extends BattleRunOptions {
  sampleIndex?: number;
  dispatcher?: EventDispatcher;
}

export function runBattle(initialState: BattleState, registry: ContentRegistry, options: RunBattleOptions = {}): BattleRunResult {
  const ruleVersion = options.ruleVersion ?? 'game-fidelity-v2';
  const baseSeed = options.seed ?? 1;
  const seed = options.sampleIndex === undefined ? (baseSeed >>> 0 || 1)
    : deriveSampleSeed(baseSeed, Math.max(0, Math.floor(options.sampleIndex)), ruleVersion);
  const random = createSeededRandom(seed);
  const dispatcher = options.dispatcher ?? new EventDispatcher();
  registerPvpRules(dispatcher, id => registry.getStatus(id));
  registerContentHandlers(registry, dispatcher);
  const budget = new TriggerBudget(options.triggerBudget ?? 256);
  const coverageDiagnostics = diagnoseContentCoverage(rosterRefsFromState(Object.values(initialState.units)), registry);
  const actionLimit = options.actionLimit ?? 600;
  const captureEvents = options.captureEvents !== false;
  let state: BattleState = { ...initialState, counters: { ...initialState.counters, round: Math.max(1, initialState.counters.round) } };
  const events: BattleEvent[] = [];
  let lastEventId: string | undefined;
  let triggerBudget: TriggerBudgetDiagnostic | undefined;
  let finalEnd: BattleEnd | undefined;
  let actedThisRound = new Set<string>();
  const scheduledActions: Extract<BattleEvent, { type: 'action-scheduled' }>[] = [];
  const pendingExtraTurns = new Map<string, Extract<BattleEvent, { type: 'turn-scheduled' }>[]>();
  const source: SourceRef = { kind: 'system', id: 'simulation' };
  const modifyDamage: DamageModifier = (attacker, target, amount, kind, currentState, damageSource, actionKind) =>
    modifyContentDamage(registry, attacker, target, amount, kind, currentState, damageSource, () => random.next(), actionKind);
  modifyDamage.before = (input, attacker, target, currentState) => {
    let configured = registry.getHero(attacker.heroId)?.beforeCalculateDamage?.(input, attacker, target, currentState) ?? input;
    if (attacker.unitId !== target.unitId)
      configured = registry.getHero(target.heroId)?.beforeCalculateDamage?.(configured, attacker, target, currentState) ?? configured;
    return configured;
  };
  modifyDamage.after = (amount, critical, attacker, target, currentState) => {
    let modified = registry.getHero(attacker.heroId)?.afterCalculateDamage?.(amount, critical, attacker, target, currentState) ?? amount;
    if (attacker.unitId !== target.unitId)
      modified = registry.getHero(target.heroId)?.afterCalculateDamage?.(modified, critical, attacker, target, currentState) ?? modified;
    return modified;
  };
  const modifyCriticalDamage: CriticalDamageModifier = (attacker, target, amount, criticalBaseAmount, currentState) =>
    modifyContentCriticalDamage(registry, attacker, target, amount, criticalBaseAmount, currentState);
  const modifyHealing: HealingModifier = (healer, target, amount) => modifyContentHealing(registry, healer, target, amount);
  const interceptDamage: DamageInterceptor = (currentState, attacker, target, amount, kind, attackId, hitIndex, damageSource,
    cannotBeShared, isCritical, actionKind) => {
    if (target.statuses.some(status => {
      const definition = registry.getStatus(status.statusId);
      return definition?.preventsDamageSharing === true
        && (!definition.preventsDamageSharingOnHitActionKinds
          || (actionKind !== undefined && definition.preventsDamageSharingOnHitActionKinds.includes(actionKind)));
    })) return undefined;
    let currentAmount = amount;
    const effects: import('../core/types').EffectCommand[] = [];
    const interceptionContext: DamageInterceptionContext = {
      attackId: attackId ?? currentState.counters.attack,
      hitIndex: hitIndex ?? currentState.counters.hit,
      source: damageSource,
      isCritical,
      cannotBeShared,
      targetIds: currentState.activeAttackTargetIds ?? [target.unitId],
      attackShape: currentState.activeAttackShape,
      actionKind,
      battle: createBattleContext(currentState, () => random.next(), statusId => registry.getStatus(statusId)?.category,
        statusId => registry.getStatus(statusId)?.dispellable === true,
        unitId => unitUnableToAct(currentState, unitId, registry)),
      isUnitUnableToAct(unitId) {
        const unit = currentState.units[unitId];
        return Boolean(unit?.statuses.some(status => registry.getStatus(status.statusId)?.preventsAction));
      },
    };
    for (const hero of registry.heroDefinitions().filter(definition => definition.interceptIncomingDamage)
      .slice().sort((left, right) => left.id - right.id)) {
      const result = hero.interceptIncomingDamage?.(currentState, attacker, target, currentAmount, kind, interceptionContext);
      if (!result) continue;
      currentAmount = result.amount;
      effects.push(...result.effects);
    }
    for (const soul of registry.soulDefinitions().filter(definition => definition.interceptIncomingDamage)
      .slice().sort((left, right) => left.id.localeCompare(right.id))) {
      const result = soul.interceptIncomingDamage?.(currentState, attacker, target, currentAmount, kind, interceptionContext);
      if (!result) continue;
      currentAmount = result.amount;
      effects.push(...result.effects);
    }
    return effects.length > 0 || currentAmount !== amount ? { amount: currentAmount, effects } : undefined;
  };

  function captureScheduled(sourceEvents: readonly BattleEvent[]): void {
    for (const event of sourceEvents) {
      if (event.type === 'action-scheduled' && !event.preResolved) scheduledActions.push(event);
      else if (event.type === 'turn-scheduled') {
        const pending = pendingExtraTurns.get(event.unitId) ?? [];
        pending.push(event);
        pendingExtraTurns.set(event.unitId, pending);
      }
    }
  }

  function appendEvents(batch: readonly BattleEvent[]): void {
    if (batch.length === 0) return;
    lastEventId = batch[batch.length - 1]?.eventId ?? lastEventId;
    if (captureEvents) events.push(...batch);
  }

  function initializeContent(
    unitId: string,
    definitionId: string,
    initialize: NonNullable<HeroDefinition['initialize']> | NonNullable<SoulDefinition['initialize']>,
    parentEventId: string,
  ): void {
    const context = createBattleContext(state, () => random.next(), statusId => registry.getStatus(statusId)?.category,
      statusId => registry.getStatus(statusId)?.dispellable === true,
      unitId => unitUnableToAct(state, unitId, registry));
    const returned = initialize(context, unitId);
    const commands = [...context.drainCommands(), ...returned].map(command => ({
      ...command,
      parentEventId: command.parentEventId ?? parentEventId,
    }));
    if (commands.length === 0) return;
    const initialized = applyEffectCommands(state, commands, 'effect-resolution', `initialize-${definitionId}-${unitId}`,
      statusId => registry.getStatus(statusId), modifyDamage, interceptDamage, modifyHealing, modifyCriticalDamage);
    state = initialized.state;
    for (const event of initialized.events) settle(event);
  }

  const battleStartEvent: BattleEvent = { eventId: 'battle-start', phase: 'battle-start', source, type: 'battle-started' };
  appendEvents([battleStartEvent]);
  const settle = (event: BattleEvent): void => {
    appendEvents([event]);
    if (triggerBudget) return;
    const result = settleEvents(state, [event], dispatcher, () => random.next(), budget,
      statusId => registry.getStatus(statusId), modifyDamage, interceptDamage, modifyHealing, modifyCriticalDamage);
    state = result.state;
    appendEvents(result.events.slice(1));
    captureScheduled(result.events.slice(1));
    triggerBudget = result.triggerBudget;
  };

  function resolveScheduledActions(): void {
    while (scheduledActions.length > 0 && !triggerBudget && state.counters.action < actionLimit) {
      const scheduledAction = scheduledActions.shift()!;
      const actor = state.units[scheduledAction.intent.actorId];
      if (!actor || (actor.hp <= 0 && !isUnitFightingSpirit(actor))) continue;
      const expirySnapshot = scheduledAction.scheduling === 'extra-turn'
        ? captureStatusExpirySnapshot(state, { owner: 'target-turn', unitId: actor.unitId }) : undefined;
      if (expirySnapshot) settle({ eventId: `scheduled-turn-${state.counters.action + 1}-start-${scheduledAction.eventId}`,
        phase: 'turn-start', source: scheduledAction.source, parentEventId: scheduledAction.eventId,
        actionId: state.counters.action + 1, type: 'turn-started', unitId: actor.unitId, scheduling: 'extra-turn' });
      const action = executeAction(state, scheduledAction.intent, registry, () => random.next(), { dispatcher, triggerBudget: budget,
        resolveStatus: statusId => registry.getStatus(statusId), modifyDamage, interceptDamage, modifyHealing, modifyCriticalDamage,
        ignoreResourceCost: scheduledAction.freeCast === true,
        scheduling: scheduledAction.scheduling,
        parentEventId: scheduledAction.eventId });
      state = action.state;
      appendEvents(action.events);
      captureScheduled(action.events);
      triggerBudget = action.triggerBudget;
      if (!action.accepted && !triggerBudget) {
        if (state.counters.action < actionLimit) state = incrementAction(state);
        settle({ eventId: `scheduled-action-${state.counters.action}-skipped-${scheduledAction.eventId}`,
          phase: 'action-validation', source: scheduledAction.source, parentEventId: scheduledAction.eventId,
          actionId: state.counters.action, type: 'action-skipped', actorId: actor.unitId,
          reason: action.failure === 'actor-dead' || action.failure === 'controlled' ? 'interrupted' : 'invalid-intent' });
      }
      if (triggerBudget || !expirySnapshot) continue;
      const current = state.units[actor.unitId];
      if (current) settle({ eventId: `scheduled-turn-${state.counters.action}-end-${scheduledAction.eventId}`,
        phase: 'turn-end', source: scheduledAction.source, parentEventId: lastEventId,
        actionId: state.counters.action, type: 'turn-ended', unitId: actor.unitId, scheduling: 'extra-turn' });
      if (triggerBudget) break;
      const expired = advanceStatusDurations(state, expirySnapshot, `scheduled-status-expiry-${state.counters.action}-${scheduledAction.eventId}`);
      state = expired.state;
      for (const event of expired.events) settle(event);
    }
  }

  for (const unit of Object.values(state.units)) {
    if (triggerBudget) break;
    const hero = registry.getHero(unit.heroId);
    if (hero?.initialize) initializeContent(unit.unitId, `hero:${hero.id}`, hero.initialize, battleStartEvent.eventId);
    if (triggerBudget) break;
    const soul = unit.soulId ? registry.getSoul(unit.soulId) : undefined;
    if (soul?.initialize) initializeContent(unit.unitId, `soul:${soul.id}`, soul.initialize, battleStartEvent.eventId);
  }
  if (!triggerBudget) {
    const startResult = settleEvents(state, [battleStartEvent], dispatcher, () => random.next(), budget,
      statusId => registry.getStatus(statusId), modifyDamage, interceptDamage, modifyHealing, modifyCriticalDamage);
    state = startResult.state;
    appendEvents(startResult.events.slice(1));
    triggerBudget = startResult.triggerBudget;
  }
  while (!triggerBudget) {
    const end = checkBattleEnd(state, actionLimit);
    if (end) {
      finalEnd = end;
      const endedEvent = createBattleEndEvent(end, state, lastEventId);
      settle(endedEvent);
      break;
    }
    const scheduled = scheduleNextActor(state, () => random.next());
    if (!scheduled) {
      finalEnd = { winner: 'draw', reason: 'elimination', blueRemainingRatio: 0, redRemainingRatio: 0 };
      settle(createBattleEndEvent(finalEnd, state, lastEventId));
      break;
    }
    state = scheduled.state;
    const actor = state.units[scheduled.actorId];
    if (!actor) continue;
    const extraTurnQueue = pendingExtraTurns.get(actor.unitId);
    const extraTurn = extraTurnQueue?.shift();
    if (extraTurnQueue?.length === 0) pendingExtraTurns.delete(actor.unitId);
    const nextActionId = state.counters.action + 1;
    const expirySnapshot = captureStatusExpirySnapshot(state, { owner: 'target-turn', unitId: actor.unitId });
    settle({ eventId: `turn-${nextActionId}-start`, phase: 'turn-start', source: { kind: 'unit', id: String(actor.heroId), unitId: actor.unitId },
      ...(extraTurn ? { parentEventId: extraTurn.eventId } : {}), actionId: nextActionId, type: 'turn-started', unitId: actor.unitId,
      ...(extraTurn ? { scheduling: 'extra-turn' as const } : {}) });
    if (triggerBudget) break;
    const currentActor = state.units[actor.unitId];
    const hero = currentActor && registry.getHero(currentActor.heroId);
    const forcedControl = currentActor?.statuses.find(status => status.values?.controlType === '混乱'
      || status.values?.controlType === '嘲讽' || status.values?.controlType === '挑衅'
      || status.values?.controlType === 'forced-random-ally');
    const controlType = forcedControl?.values?.controlType;
    const controlTarget = currentActor && forcedControl
      ? controlType === '混乱'
        ? (() => {
          const preferredTargetId = forcedControl.values?.preferredTargetId;
          const preferred = typeof preferredTargetId === 'string' ? state.units[preferredTargetId] : undefined;
          if (preferred && preferred.hp > 0 && preferred.unitId !== currentActor.unitId) return preferred;
          const candidates = [...state.sides.blue, ...state.sides.red].map(unitId => state.units[unitId])
            .filter(unit => unit && unit.hp > 0 && unit.unitId !== currentActor.unitId);
          return candidates.length ? candidates[Math.floor(random.next() * candidates.length)] : undefined;
        })()
        : controlType === 'forced-random-ally'
          ? (() => {
            const allies = state.sides[currentActor.side].map(unitId => state.units[unitId])
              .filter(unit => unit && unit.hp > 0 && unit.unitId !== currentActor.unitId);
            return allies.length ? allies[Math.floor(random.next() * allies.length)] : undefined;
          })()
      : (forcedControl.source.unitId ? state.units[forcedControl.source.unitId] : undefined)
          ?? state.sides[currentActor.side === 'blue' ? 'red' : 'blue'].map(unitId => state.units[unitId])
            .find(unit => unit?.hp > 0 && unit.statuses.some(status => status.values?.controlType === '嘲讽'
              || status.values?.controlType === '挑衅'))
      : undefined;
    const policyState = withPolicyResourceBonuses(state, currentActor, registry);
    const policyContext = createBattleContext(policyState, () => random.next(), statusId => registry.getStatus(statusId)?.category,
      statusId => registry.getStatus(statusId)?.dispellable === true,
      unitId => unitUnableToAct(state, unitId, registry));
    const statusIntent = currentActor?.statuses.map(instance => registry.getStatus(instance.statusId)?.selectAction?.(
      policyContext, currentActor, instance)).find((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined);
    const intent = !forcedControl && currentActor && (currentActor.hp > 0 || isUnitFightingSpirit(currentActor))
      ? statusIntent ?? (hero && selectWeightedAction(policyContext, currentActor, hero.skills))
        ?? hero?.policy?.(policyContext, currentActor.unitId) : undefined;
    if (forcedControl && controlType === 'forced-random-ally' && currentActor && (currentActor.hp > 0 || isUnitFightingSpirit(currentActor))) {
      const basic = hero?.skills.find(skill => skill.actionKind === 'basic');
      if (basic && controlTarget?.hp) {
        const forced = executeAction(state, { actorId: currentActor.unitId, skillId: basic.id,
          targetIds: [controlTarget.unitId], shape: basic.target, targetRelation: 'ally' }, registry, () => random.next(), {
          dispatcher, triggerBudget: budget, resolveStatus: statusId => registry.getStatus(statusId), modifyDamage,
          interceptDamage, modifyHealing, modifyCriticalDamage, targetRelationOverride: 'ally',
          parentEventId: extraTurn?.eventId ?? forcedControl.appliedByEventId ?? `turn-${nextActionId}-start` });
        state = forced.state;
        appendEvents(forced.events);
        captureScheduled(forced.events);
        triggerBudget = forced.triggerBudget;
        if (!forced.accepted) {
          if (state.counters.action < nextActionId) state = incrementAction(state);
          settle({ eventId: `action-${state.counters.action}-forced-attack-skipped`, phase: 'action-validation',
            source: { kind: 'unit', id: String(currentActor.heroId), unitId: currentActor.unitId },
            ...(extraTurn ? { parentEventId: extraTurn.eventId } : {}), actionId: state.counters.action,
            type: 'action-skipped', actorId: currentActor.unitId, reason: 'invalid-intent' });
        }
      } else {
        state = incrementAction(state);
        settle({ eventId: `action-${state.counters.action}-forced-attack-skipped`, phase: 'action-validation',
          source: { kind: 'unit', id: String(currentActor.heroId), unitId: currentActor.unitId },
          ...(extraTurn ? { parentEventId: extraTurn.eventId } : {}), actionId: state.counters.action,
          type: 'action-skipped', actorId: currentActor.unitId, reason: 'no-policy' });
      }
    } else if (forcedControl && currentActor && (currentActor.hp > 0 || isUnitFightingSpirit(currentActor))) {
      state = incrementAction(state);
      if (controlTarget && controlTarget.hp > 0) {
        const parentEventId = extraTurn?.eventId ?? forcedControl.appliedByEventId ?? `turn-${nextActionId}-start`;
        const source: SourceRef = { kind: 'status', id: forcedControl.statusId, unitId: currentActor.unitId };
        state = { ...state, counters: { ...state.counters, attack: state.counters.attack + 1, hit: 0 } };
        const attackId = state.counters.attack;
        const actorStats = effectiveStats(currentActor);
        const targetStats = effectiveStats(controlTarget);
        const calculated = createBattleContext(state, () => random.next(), undefined, undefined, undefined, modifyDamage).calculateDamage({ attack: actorStats.attack, defense: targetStats.defense,
          defenseIgnore: effectiveDefenseIgnore(currentActor), ratio: .125, critChance: actorStats.crit,
          critDamage: actorStats.critDamage }, currentActor, controlTarget);
        const attackStart: BattleEvent = { eventId: `control-attack-${state.counters.action}-${attackId}-start`, phase: 'attack-start',
          source, parentEventId, actionId: state.counters.action, attackId, type: 'attack-start', targetIds: [controlTarget.unitId],
          shape: 'single', actionKind: 'basic' };
        const hpBefore = controlTarget.hp;
        settle(attackStart);
        const hit = applyEffectCommands(state, [{ type: 'deal-damage', source, targetId: controlTarget.unitId, amount: calculated.amount,
          ...(calculated.damageOptions ? { damageOptions: calculated.damageOptions } : {}),
          ...(calculated.isCritical ? { criticalBaseAmount: calculated.amount / Math.max(1, actorStats.critDamage) } : {}),
          isCritical: calculated.isCritical, parentEventId: attackStart.eventId }], 'effect-resolution', attackStart.eventId,
        statusId => registry.getStatus(statusId), modifyDamage, interceptDamage, modifyHealing, modifyCriticalDamage);
        state = hit.state;
        for (const event of hit.events) settle(event);
        const damageEvent = hit.events.find(event => event.type === 'damage');
        settle({ eventId: `${attackStart.eventId}-end`, phase: 'attack-end', source,
          parentEventId: damageEvent?.eventId ?? attackStart.eventId, actionId: state.counters.action, attackId,
          type: 'attack-ended', hitCount: damageEvent ? 1 : 0,
          targetHealthChanges: [{ targetId: controlTarget.unitId, hpBefore, hpAfter: state.units[controlTarget.unitId]?.hp ?? 0,
            hpLost: Math.max(0, hpBefore - (state.units[controlTarget.unitId]?.hp ?? 0)) }] });
      }
      settle({ eventId: `action-${state.counters.action}-control-skip`, phase: 'action-validation',
        source: { kind: 'unit', id: String(currentActor.heroId), unitId: currentActor.unitId }, actionId: state.counters.action,
        ...(extraTurn ? { parentEventId: extraTurn.eventId } : {}), type: 'action-skipped', actorId: currentActor.unitId,
        reason: 'interrupted' });
    } else if (intent) {
      const previousActionCount = state.counters.action;
      const action = executeAction(state, intent, registry, () => random.next(), { dispatcher, triggerBudget: budget,
        resolveStatus: statusId => registry.getStatus(statusId), modifyDamage, interceptDamage, modifyHealing, modifyCriticalDamage,
        ...(extraTurn ? { scheduling: 'extra-turn' as const } : {}),
        ...(extraTurn ? { parentEventId: extraTurn.eventId } : {}) });
      state = action.state;
      appendEvents(action.events);
      captureScheduled(action.events);
      triggerBudget = action.triggerBudget;
      if (!action.accepted) {
        if (state.counters.action <= previousActionCount) state = incrementAction(state);
        const skipped: BattleEvent = { eventId: `action-${state.counters.action}-skipped`, phase: 'action-validation', source,
          ...(extraTurn ? { parentEventId: extraTurn.eventId } : {}),
          actionId: state.counters.action, type: 'action-skipped', actorId: actor.unitId,
          reason: action.failure === 'actor-dead' || action.failure === 'controlled' ? 'interrupted' : 'invalid-intent' };
        settle(skipped);
      }
    } else {
      state = incrementAction(state);
      settle({ eventId: `action-${state.counters.action}-skipped`, phase: 'action-validation',
        source: { kind: 'unit', id: String(actor.heroId), unitId: actor.unitId }, actionId: state.counters.action,
        ...(extraTurn ? { parentEventId: extraTurn.eventId } : {}), type: 'action-skipped', actorId: actor.unitId,
        reason: currentActor?.hp ? 'no-policy' : 'interrupted' });
    }
    if (triggerBudget) break;
    resolveScheduledActions();
    if (triggerBudget) break;

    const actionId = state.counters.action;
    settle({ eventId: `turn-${actionId}-end`, phase: 'turn-end', source: { kind: 'unit', id: String(actor.heroId), unitId: actor.unitId },
      ...(extraTurn ? { parentEventId: extraTurn.eventId } : {}), actionId, type: 'turn-ended', unitId: actor.unitId,
      ...(extraTurn ? { scheduling: 'extra-turn' as const } : {}) });
    if (triggerBudget) break;
    resolveScheduledActions();
    if (triggerBudget) break;
    const expired = advanceStatusDurations(state, expirySnapshot, `status-expiry-${state.counters.round}-${actionId}`);
    state = expired.state;
    for (const event of expired.events) settle(event);
    if (triggerBudget) break;

    if ((state.units[actor.unitId]?.hp ?? 0) > 0 || isUnitFightingSpirit(state.units[actor.unitId])) actedThisRound.add(actor.unitId);
    const livingIds = Object.values(state.units).filter(unit => unit.hp > 0 || isUnitFightingSpirit(unit)).map(unit => unit.unitId);
    if (livingIds.length > 0 && livingIds.every(unitId => actedThisRound.has(unitId))) {
      state = { ...state, counters: { ...state.counters, round: state.counters.round + 1 } };
      actedThisRound = new Set<string>();
    }
  }

  if (triggerBudget) {
    const event: BattleEvent = { eventId: 'battle-ended-trigger-budget', phase: 'battle-end', source, parentEventId: lastEventId,
      actionId: state.counters.action, type: 'battle-ended', winner: 'draw', reason: 'trigger-budget' };
    appendEvents([event]);
    state = { ...state, ended: true };
    return { winner: 'draw', reason: 'trigger-budget', state, events,
      diagnostics: [...coverageDiagnostics, { contentType: 'runtime', contentId: triggerBudget.key, status: 'partial',
        message: `触发预算超限：${triggerBudget.count}/${triggerBudget.limit}` }], seed, ruleVersion };
  }

  const end = finalEnd ?? checkBattleEnd(state, actionLimit) ?? { winner: 'draw' as const, reason: 'elimination' as const,
    blueRemainingRatio: 0, redRemainingRatio: 0 };
  state = { ...state, ended: true };
  return { winner: end.winner, reason: end.reason, state, events,
    diagnostics: coverageDiagnostics, seed, ruleVersion };
}

function withPolicyResourceBonuses(state: BattleState, actor: NonNullable<BattleState['units'][string]>,
  registry: ContentRegistry): BattleState {
  const bonus = actor.statuses.reduce((sum, status) => {
    const resource = registry.getStatus(status.statusId)?.policyResourceBonus;
    return resource ? { ...sum, [resource.resourceId]: (sum[resource.resourceId] ?? 0) + resource.amount * status.stacks } : sum;
  }, {} as Record<string, number>);
  if (!Object.keys(bonus).length) return state;
  const resources = { ...state.resources[actor.side] };
  for (const [resourceId, amount] of Object.entries(bonus)) resources[resourceId] = (resources[resourceId] ?? 0) + amount;
  return { ...state, resources: { ...state.resources, [actor.side]: resources } };
}

function incrementAction(state: BattleState): BattleState {
  return { ...state, counters: { ...state.counters, action: state.counters.action + 1 } };
}

function unitUnableToAct(state: BattleState, unitId: string, registry: ContentRegistry): boolean {
  const unit = state.units[unitId];
  return Boolean(unit?.statuses.some(status => registry.getStatus(status.statusId)?.preventsAction));
}

function registerContentHandlers(registry: ContentRegistry, dispatcher: EventDispatcher): void {
  const register = (kind: string, id: string, handlers: HeroDefinition['handlers']): void => {
    for (const phase of Object.keys(handlers ?? {}) as BattlePhase[]) {
      const rule = handlers?.[phase];
      if (!rule) continue;
      dispatcher.register({ id: `${kind}:${id}:${phase}`, phase, priority: rule.priority, handle: rule.handle });
    }
  };
  for (const hero of registry.heroDefinitions()) register('hero', String(hero.id), hero.handlers);
  for (const soul of registry.soulDefinitions()) register('soul', soul.id, soul.handlers);
  for (const status of registry.statusDefinitions()) register('status', status.id, status.handlers);
}

function modifyContentDamage(
  registry: ContentRegistry,
  attacker: UnitState | undefined,
  target: UnitState,
  amount: number,
  kind: 'normal' | 'true',
  state: BattleState,
  source: SourceRef | undefined,
  random: () => number,
  actionKind?: import('../core/types').ActionKind,
): number {
  if (!attacker) return amount;
  let modified = amount;
  if (attacker) modified = registry.getHero(target.heroId)?.modifyIncomingDamage?.(attacker, target, modified, kind, source) ?? modified;
  if (attacker) modified = registry.getHero(attacker.heroId)?.modifyOutgoingDamage?.(attacker, target, modified, kind, state) ?? modified;
  if (attacker.soulId) modified = registry.getSoul(attacker.soulId)?.modifyOutgoingDamage?.(attacker, target, modified, kind, state, random) ?? modified;
  modified *= effectiveDamageMultiplier(attacker, state.resources[attacker.side], actionKind);
  modified *= effectiveDamageTakenMultiplier(target, state.resources[target.side], actionKind);
  if (target.soulId) modified = registry.getSoul(target.soulId)?.modifyIncomingDamage?.(attacker, target, modified, kind) ?? modified;
  return Number.isFinite(modified) ? Math.max(0, modified) : 0;
}

function modifyContentHealing(registry: ContentRegistry, healer: UnitState | undefined, target: UnitState, amount: number): number {
  const heroModified = healer ? registry.getHero(healer.heroId)?.modifyOutgoingHealing?.(healer, target, amount) ?? amount : amount;
  const sourceModified = healer?.soulId
    ? registry.getSoul(healer.soulId)?.modifyOutgoingHealing?.(healer, target, heroModified) ?? heroModified : heroModified;
  const modified = sourceModified * effectiveHealingTakenMultiplier(target);
  return Number.isFinite(modified) ? Math.max(0, modified) : 0;
}

function modifyContentCriticalDamage(registry: ContentRegistry, attacker: UnitState | undefined, target: UnitState,
  amount: number, criticalBaseAmount: number, state: BattleState): number {
  let modified = amount;
  if (attacker) {
    modified = registry.getHero(attacker.heroId)?.modifyCriticalDamage?.(attacker, target, modified, criticalBaseAmount, state) ?? modified;
    if (attacker.soulId) modified = registry.getSoul(attacker.soulId)?.modifyCriticalDamage?.(attacker, target, modified,
      criticalBaseAmount, state) ?? modified;
  }
  for (const unitId of state.sides[target.side]) {
    const wearer = state.units[unitId];
    if (!wearer || wearer.hp <= 0 || !wearer.soulId) continue;
    modified = registry.getSoul(wearer.soulId)?.modifyCriticalDamageTaken?.(wearer, target, modified, criticalBaseAmount, state) ?? modified;
  }
  modified = applyCriticalDamageTakenModifiers(modified, criticalBaseAmount, target);
  return Number.isFinite(modified) ? Math.max(0, modified) : 0;
}

