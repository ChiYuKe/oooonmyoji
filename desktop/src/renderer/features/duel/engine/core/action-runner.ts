import type { ContentRegistry } from '../content/registry';
import { applyEffectCommands, type CriticalDamageModifier, type DamageInterceptor, type DamageModifier, type HealingModifier } from './effects';
import { createBattleContext } from './context';
import { isUnitBanished, isUnitFightingSpirit, type ActionIntent, type ActionScheduling, type BattleEvent, type BattleState, type EffectCommand, type SourceRef, type StatusId } from './types';
import { skillResourceCost, type ActionAdjustment, type SkillDefinition, type StatusDefinition } from './definitions';
import type { EventDispatcher } from './event-dispatcher';
import { settleEvents } from './settlement';
import { TriggerBudget, type TriggerBudgetDiagnostic } from './trigger-budget';
import { battleSkillRow, skillNumber } from '../../../../../shared/game-skill-data';
import { jumpQueuePriority } from './action-scheduler';

export type ActionFailure = 'actor-dead' | 'controlled' | 'hero-not-registered' | 'skill-not-registered' | 'skill-unavailable'
  | 'insufficient-resource' | 'invalid-target';

export interface ActionExecutionResult {
  accepted: boolean;
  failure?: ActionFailure;
  state: BattleState;
  events: readonly BattleEvent[];
  triggerBudget?: TriggerBudgetDiagnostic;
}

export interface ActionRuntime {
  dispatcher?: EventDispatcher;
  triggerBudget?: TriggerBudget;
  resolveStatus?: (statusId: StatusId) => StatusDefinition | undefined;
  modifyDamage?: DamageModifier;
  interceptDamage?: DamageInterceptor;
  modifyHealing?: HealingModifier;
  modifyCriticalDamage?: CriticalDamageModifier;
  /** Scheduled content actions can explicitly waive resource payment while keeping normal validation and triggers. */
  ignoreResourceCost?: boolean;
  /** Preserves whether this action was scheduled outside a normal turn. */
  scheduling?: ActionScheduling;
  /** Narrow override used by forced basic attacks that must hit an ally. */
  targetRelationOverride?: ActionIntent['targetRelation'];
  parentEventId?: string;
  /** Counter/assist actions settle within the current action and do not spend a turn. */
  reaction?: boolean;
  reactionDepth?: number;
}

export function executeAction(
  initialState: BattleState,
  intent: ActionIntent,
  registry: ContentRegistry,
  random: () => number,
  runtime: ActionRuntime = {},
): ActionExecutionResult {
  const actor = initialState.units[intent.actorId];
  if (!actor || (actor.hp <= 0 && !isUnitFightingSpirit(actor))) return { accepted: false, failure: 'actor-dead', state: initialState, events: [] };
  if (isUnitBanished(actor)) return { accepted: false, failure: 'controlled', state: initialState, events: [] };
  if (actor.statuses.some(status => runtime.resolveStatus?.(status.statusId)?.preventsAction)) {
    return { accepted: false, failure: 'controlled', state: initialState, events: [] };
  }
  if (runtime.scheduling === 'assist' && actor.statuses.some(status => runtime.resolveStatus?.(status.statusId)?.preventsAssist)) {
    return { accepted: false, failure: 'skill-unavailable', state: initialState, events: [] };
  }
  const hero = registry.getHero(actor.heroId);
  if (!hero) return { accepted: false, failure: 'hero-not-registered', state: initialState, events: [] };
  let resolvedIntent = intent;
  let skill = hero.skills.find(candidate => candidate.id === intent.skillId)
    ?? actor.statuses.flatMap(status => runtime.resolveStatus?.(status.statusId)?.grantedSkills ?? [])
      .find(candidate => candidate.id === intent.skillId);
  if (!skill) return { accepted: false, failure: 'skill-not-registered', state: initialState, events: [] };
  if (skill.canUse && !skill.canUse(initialState, actor))
    return { accepted: false, failure: 'skill-unavailable', state: initialState, events: [] };
  const skillsSealed = actor.statuses.some(status => runtime.resolveStatus?.(status.statusId)?.preventsSkill);
  if (skillsSealed && skill.actionKind !== 'basic') {
    const basic = hero.skills.find(candidate => candidate.actionKind === 'basic');
    if (!basic) return { accepted: false, failure: 'controlled', state: initialState, events: [] };
    const opposingSide = actor.side === 'blue' ? 'red' : 'blue';
    const targetId = intent.targetIds.find(id => {
      const target = initialState.units[id];
      return Boolean(target && target.hp > 0 && !isUnitBanished(target) && target.side !== actor.side);
    }) ?? initialState.sides[opposingSide].find(id => initialState.units[id]?.hp > 0 && !isUnitBanished(initialState.units[id]));
    if (!targetId) return { accepted: false, failure: 'invalid-target', state: initialState, events: [] };
    skill = basic;
    resolvedIntent = { actorId: actor.unitId, skillId: basic.id, targetIds: [targetId], shape: basic.target,
      ...(basic.targetRelation ? { targetRelation: basic.targetRelation } : {}) };
  }
  resolvedIntent = redirectProtectedDirectTarget(initialState, resolvedIntent, actor.side, registry);
  const targetRelation = runtime.targetRelationOverride ?? skill.targetRelation;
  if (resolvedIntent.shape !== skill.target || (targetRelation && resolvedIntent.targetRelation !== targetRelation)
    || !validTargets(initialState, resolvedIntent, targetRelation ?? resolvedIntent.targetRelation, skill.allowDefeatedTargets === true)) {
    return { accepted: false, failure: 'invalid-target', state: initialState, events: [] };
  }
  const effectiveActionKind = resolvedIntent.kind ?? skill.actionKind ?? 'skill';
  if (skill.actionKind !== effectiveActionKind) skill = { ...skill, actionKind: effectiveActionKind };
  const declaredAdjustment = resolveActionAdjustment(initialState, actor, skill, registry);
  if (!runtime.ignoreResourceCost && !resolvePayment(initialState, actor, skill, declaredAdjustment, registry, runtime.scheduling)) {
    return { accepted: false, failure: 'insufficient-resource', state: initialState, events: [] };
  }

  const actionId = initialState.counters.action + (runtime.reaction ? 0 : 1);
  const actionPrefix = runtime.reaction ? `reaction-${runtime.parentEventId}` : `action-${actionId}`;
  let state: BattleState = { ...initialState, activeActionScheduling: runtime.scheduling,
    counters: { ...initialState.counters, action: actionId } };
  const source: SourceRef = { kind: 'skill', id: skill.id, unitId: actor.unitId };
  const actionEvent: BattleEvent = {
    eventId: actionPrefix,
    phase: 'action-selection',
    source,
    ...(runtime.parentEventId ? { parentEventId: runtime.parentEventId } : {}),
    actionId,
    type: 'action-declared',
    intent: resolvedIntent,
    ...(runtime.scheduling ? { scheduling: runtime.scheduling } : {}),
    ...(runtime.ignoreResourceCost ? { resourceCostWaived: true } : {}),
  };
  const events: BattleEvent[] = [];
  const budget = runtime.triggerBudget ?? new TriggerBudget();
  let exceeded: TriggerBudgetDiagnostic | undefined;
  if ((runtime.reactionDepth ?? 0) > 64) return { accepted: true, state, events,
    triggerBudget: { exceeded: true, scope: 'action', key: 'system:reaction-depth', count: runtime.reactionDepth!, limit: 64 } };
  const appendAndSettle = (event: BattleEvent): void => {
    events.push(event);
    if (!runtime.dispatcher || exceeded) return;
    const settled = settleEvents(state, [event], runtime.dispatcher, random, budget, runtime.resolveStatus, runtime.modifyDamage,
      runtime.interceptDamage, runtime.modifyHealing, runtime.modifyCriticalDamage);
    state = settled.state;
    events.push(...settled.events.slice(1));
    exceeded = settled.triggerBudget;
  };
  const resolveReactions = (): void => {
    while (!exceeded) {
      const jumpQueue = events.map((event, index) => ({ event, index })).filter(
        (entry): entry is { event: Extract<BattleEvent, { type: 'action-scheduled' }>; index: number } =>
          entry.event.type === 'action-scheduled' && !entry.event.preResolved
          && (entry.event.scheduling === 'counter' || entry.event.scheduling === 'assist'));
      // sorted_list.add is stable, sorted reverse by -priority, then TryLock pops its tail.
      jumpQueue.sort((a, b) => jumpQueuePriority(b.event) - jumpQueuePriority(a.event) || b.index - a.index);
      const next = jumpQueue[0];
      if (!next) break;
      const { event, index } = next;
      events[index] = { ...event, preResolved: true };
      const parentAttackId = state.activeAttackId;
      const parentHitIndex = state.counters.hit;
      const parentAttackTargetIds = state.activeAttackTargetIds;
      const parentAttackShape = state.activeAttackShape;
      const reaction = executeAction(state, event.intent, registry, random, { ...runtime, triggerBudget: budget,
        reaction: true, reactionDepth: (runtime.reactionDepth ?? 0) + 1,
        ignoreResourceCost: event.freeCast === true, scheduling: event.scheduling, parentEventId: event.eventId });
      state = { ...reaction.state, activeAttackId: parentAttackId,
        activeAttackTargetIds: parentAttackTargetIds, activeAttackShape: parentAttackShape,
        counters: { ...reaction.state.counters, hit: parentHitIndex } };
      events.push(...reaction.events);
      exceeded = reaction.triggerBudget;
    }
  };
  appendAndSettle(actionEvent);
  if (exceeded) return { accepted: true, state, events, triggerBudget: exceeded };
  const validatedActor = state.units[resolvedIntent.actorId];
  if (!validatedActor || (validatedActor.hp <= 0 && !isUnitFightingSpirit(validatedActor)))
    return { accepted: false, failure: 'actor-dead', state, events };
  if (!validTargets(state, resolvedIntent, targetRelation ?? resolvedIntent.targetRelation, skill.allowDefeatedTargets === true))
    return { accepted: false, failure: 'invalid-target', state, events };

  const actionAdjustment = resolveActionAdjustment(state, validatedActor, skill, registry);
  if (actionAdjustment?.label && validatedActor.soulId) {
    appendAndSettle({ eventId: `${actionEvent.eventId}-adjustment-${validatedActor.soulId}`, phase: 'resource-payment',
      source: { kind: 'soul', id: validatedActor.soulId, unitId: validatedActor.unitId }, parentEventId: actionEvent.eventId,
      actionId, type: 'content-triggered', contentType: 'soul', contentId: validatedActor.soulId, label: actionAdjustment.label });
    if (exceeded) return { accepted: true, state, events, triggerBudget: exceeded };
  }
  const paymentPlan = runtime.ignoreResourceCost ? { resourceAmount: 0, meterAmount: 0 }
    : resolvePayment(state, validatedActor, skill, actionAdjustment, registry, runtime.scheduling);
  if (!paymentPlan) return { accepted: false, failure: 'insufficient-resource', state, events };
  if (paymentPlan.resourceAmount > 0 || paymentPlan.meterAmount > 0 || paymentPlan.statusSubstitutions?.length) {
    const paymentCommands: EffectCommand[] = [];
    if (paymentPlan.resourceAmount > 0 && paymentPlan.resourceId) paymentCommands.push({ type: 'change-resource', source,
      side: validatedActor.side, resourceId: paymentPlan.resourceId, amount: -paymentPlan.resourceAmount, parentEventId: actionEvent.eventId });
    if (paymentPlan.meterAmount > 0 && paymentPlan.meterResourceId) {
      const meter = state.resourceMeters[validatedActor.side]?.[paymentPlan.meterResourceId];
      if (!meter) return { accepted: false, failure: 'insufficient-resource', state, events };
      paymentCommands.push({ type: 'set-resource-meter-progress', source, side: validatedActor.side,
        resourceId: paymentPlan.meterResourceId, progress: meter.progress - paymentPlan.meterAmount, parentEventId: actionEvent.eventId });
    }
    for (const substitution of paymentPlan.statusSubstitutions ?? []) {
      const owner = state.units[substitution.sourceUnitId];
      const status = owner?.statuses.find(item => item.instanceId === substitution.instanceId);
      if (!owner || !status) continue;
      paymentCommands.push({ type: 'remove-status-instances', source, targetId: owner.unitId,
        instanceIds: [status.instanceId], reason: 'consumed', parentEventId: actionEvent.eventId });
      if (status.stacks > substitution.stacks) paymentCommands.push({ type: 'add-status', source,
        targetId: owner.unitId, instance: { ...status, stacks: status.stacks - substitution.stacks }, parentEventId: actionEvent.eventId });
      if (substitution.linkedStatusId) for (const allyId of state.sides[owner.side]) {
        const ally = state.units[allyId];
        const linked = ally?.statuses.filter(item => item.statusId === substitution.linkedStatusId && item.source.unitId === owner.unitId) ?? [];
        for (const linkedStatus of linked) {
          paymentCommands.push({ type: 'remove-status-instances', source, targetId: allyId,
            instanceIds: [linkedStatus.instanceId], reason: 'consumed', parentEventId: actionEvent.eventId });
          if (linkedStatus.stacks > substitution.stacks) paymentCommands.push({ type: 'add-status', source, targetId: allyId,
            instance: { ...linkedStatus, stacks: linkedStatus.stacks - substitution.stacks }, parentEventId: actionEvent.eventId });
        }
      }
    }
    const payment = applyEffectCommands(state, paymentCommands, 'resource-payment', `${actionPrefix}-cost`, runtime.resolveStatus,
      runtime.modifyDamage, runtime.interceptDamage, runtime.modifyHealing, runtime.modifyCriticalDamage);
    state = payment.state;
    for (const event of payment.events) appendAndSettle(event);
    if (exceeded) return { accepted: true, state, events, triggerBudget: exceeded };
  }

  const actionSkillLevel = skillRank(validatedActor, skill.id);
  const actionState = actionSkillLevel === validatedActor.skillLevel ? state : { ...state,
    units: { ...state.units, [validatedActor.unitId]: { ...validatedActor, skillLevel: actionSkillLevel } } };
  const row = battleSkillRow(skill.id, actionSkillLevel, validatedActor.awakeFilter,
    validatedActor.unitKind === 'monster' || validatedActor.unitKind === 'summon');
  const context = createBattleContext(actionState, random, statusId => registry.getStatus(statusId)?.category,
    statusId => registry.getStatus(statusId)?.dispellable === true, () => false, runtime.modifyDamage, row,
    (unitId, amount) => {
      const target = actionState.units[unitId];
      if (!target || !Number.isFinite(amount) || amount === 0) return false;
      return !target.statuses.some(status => {
        const definition = registry.getStatus(status.statusId);
        return definition?.preventsActionGaugeChange
          || (amount < 0 ? definition?.preventsActionGaugeDecrease : definition?.preventsActionGaugeIncrease);
      });
    });
  const fallbackParameters = skill.levels[Math.max(0, Math.min(actionSkillLevel - 1, skill.levels.length - 1))] ?? skill.levels.at(-1) ?? {};
  const addDmg = skillNumber(row, 'addDmg');
  const clientRatio = skill.useClientDamageData !== false && 'ratio' in fallbackParameters && (addDmg ?? 0) > 0 ? addDmg : undefined;
  const clientParameters = Object.fromEntries(Array.from({ length: 10 }, (_, index) => `param${index + 1}`)
    .flatMap(field => typeof row?.[field] === 'number' || typeof row?.[field] === 'string' || typeof row?.[field] === 'boolean'
      ? [[field, row[field]]] : []));
  const parameters = { ...fallbackParameters, ...clientParameters, ...(clientRatio === undefined ? {} : { ratio: clientRatio }),
    ...(skillNumber(row, 'dmgFluctuation') === undefined ? {} : { dmgFluctuation: skillNumber(row, 'dmgFluctuation')! }) };
  const returned = skill.execute(context, resolvedIntent, parameters) ?? [];
  const actionKind = resolvedIntent.kind ?? skill.actionKind ?? 'skill';
  const commands: readonly EffectCommand[] = [...context.drainCommands(), ...returned].map(command => ({
    ...command,
    parentEventId: command.parentEventId ?? actionEvent.eventId,
    source: command.source ?? source,
  })).map(command => command.type === 'deal-damage'
    ? { ...command, actionKind,
      ...(actionAdjustment?.damageMultiplier === undefined ? {} : { amount: command.amount * actionAdjustment.damageMultiplier,
        ...(command.criticalBaseAmount === undefined ? {} : { criticalBaseAmount: command.criticalBaseAmount * actionAdjustment.damageMultiplier }) }) }
    : command);
  const attackCommands = commands.filter((command): command is Extract<EffectCommand, { type: 'deal-damage' }> => command.type === 'deal-damage');
  let attackStart: Extract<BattleEvent, { type: 'attack-start' }> | undefined;
  if (attackCommands.length > 0) {
    const attackTargetIds = [...new Set(attackCommands.map(command => command.targetId))];
    state = { ...state, activeAttackId: state.counters.attack + 1,
      activeAttackTargetIds: attackTargetIds, activeAttackShape: resolvedIntent.shape,
      counters: { ...state.counters, attack: state.counters.attack + 1, hit: 0 } };
    attackStart = { eventId: `${actionEvent.eventId}-attack-${state.counters.attack}`, phase: 'attack-start',
      source, parentEventId: actionEvent.eventId, actionId, attackId: state.counters.attack,
      type: 'attack-start', targetIds: attackTargetIds,
      selectedTargetIds: resolvedIntent.selectedTargetId ? [resolvedIntent.selectedTargetId] : resolvedIntent.targetIds,
      shape: resolvedIntent.shape,
      actionKind };
    appendAndSettle(attackStart);
    if (exceeded) return { accepted: true, state, events, triggerBudget: exceeded };
  }
  const attackHpBefore = new Map<string, number>((attackStart?.targetIds ?? []).map(targetId => [targetId, state.units[targetId]?.hp ?? 0]));
  const resolvedCommands = commands.map(command => command.type === 'deal-damage' && attackStart
    ? { ...command, parentEventId: command.parentEventId === actionEvent.eventId ? attackStart.eventId : command.parentEventId }
    : command);
  let resolvedIndex = 0;
  for (const command of resolvedCommands) {
    const resolution = applyEffectCommands(state, [command], 'effect-resolution', `${actionPrefix}-effect-${++resolvedIndex}`,
      runtime.resolveStatus, runtime.modifyDamage, runtime.interceptDamage, runtime.modifyHealing, runtime.modifyCriticalDamage);
    state = resolution.state;
    for (const event of resolution.events) appendAndSettle(event);
    resolveReactions();
    if (exceeded) return { accepted: true, state, events, triggerBudget: exceeded };
  }
  if (attackStart) {
    const hitEvents = events.filter((event): event is Extract<BattleEvent, { type: 'damage' }> => event.type === 'damage' && event.attackId === attackStart.attackId);
    const targetHealthChanges = attackStart.targetIds.map(targetId => {
      const targetHits = hitEvents.filter(event => event.targetId === targetId);
      const defeatingHit = targetHits.filter(event => event.hpAfter === 0).at(-1);
      return { targetId, hpBefore: attackHpBefore.get(targetId) ?? 0, hpAfter: state.units[targetId]?.hp ?? 0,
        hpLost: Math.max(0, (attackHpBefore.get(targetId) ?? 0) - (state.units[targetId]?.hp ?? 0)),
        ...(defeatingHit ? { defeatedByHit: true, ...(defeatingHit.overkillDamage === undefined ? {} : { overkillDamage: defeatingHit.overkillDamage }) } : {}) };
    });
    appendAndSettle({ eventId: `${attackStart.eventId}-end`, phase: 'attack-end', source, parentEventId: hitEvents.at(-1)?.eventId ?? attackStart.eventId,
      actionId, attackId: attackStart.attackId, type: 'attack-ended',
      hitCount: new Set(hitEvents.map(event => event.hitIndex ?? event.eventId)).size,
      actionKind: attackStart.actionKind, shape: attackStart.shape, selectedTargetIds: attackStart.selectedTargetIds,
      ...(hitEvents.some(event => event.suppressTargetPassiveTriggers) ? { suppressTargetPassiveTriggers: true } : {}),
      targetHealthChanges });
    state = { ...state, activeAttackTargetIds: undefined, activeAttackShape: undefined };
  }
  resolveReactions();
  if (!exceeded) appendAndSettle({ eventId: `${actionPrefix}-end`, phase: 'action-end', source,
    parentEventId: attackStart ? `${attackStart.eventId}-end` : actionEvent.eventId, actionId,
    type: 'action-ended', skillId: skill.id, actionKind, intent,
    soulTriggersAllowed: skill.suppressSoulTriggers !== true, ...(runtime.scheduling ? { scheduling: runtime.scheduling } : {}) });
  resolveReactions();
  state = { ...state, activeActionScheduling: initialState.activeActionScheduling };
  return { accepted: true, state, events, ...(exceeded ? { triggerBudget: exceeded } : {}) };
}

function redirectProtectedDirectTarget(state: BattleState, intent: ActionIntent, actorSide: 'blue' | 'red', registry: ContentRegistry): ActionIntent {
  if ((intent.shape !== 'single' && intent.shape !== 'multi') || intent.targetIds.length !== 1) return intent;
  const selected = state.units[intent.targetIds[0] ?? ''];
  if (!selected || selected.side === actorSide || !selected.statuses.some(status => registry.getStatus(status.statusId)?.protectsFromDirectTargeting))
    return intent;
  const candidates = state.sides[selected.side].map(id => state.units[id]).filter((unit): unit is NonNullable<typeof unit> =>
    Boolean(unit && unit.hp > 0 && !isUnitBanished(unit) && unit.unitId !== selected.unitId));
  const replacement = candidates[0];
  return replacement ? { ...intent, targetIds: [replacement.unitId] } : intent;
}

interface ResolvedPayment {
  resourceId?: string;
  resourceAmount: number;
  meterResourceId?: string;
  meterAmount: number;
  statusSubstitutions?: { statusId: string; instanceId: string; sourceUnitId: string; stacks: number; linkedStatusId?: string }[];
}

function resolvePayment(state: BattleState, actor: NonNullable<BattleState['units'][string]>, skill: SkillDefinition,
  adjustment?: ActionAdjustment, registry?: ContentRegistry, scheduling?: ActionScheduling): ResolvedPayment | undefined {
  const level = skillRank(actor, skill.id);
  const costActor = level === actor.skillLevel ? actor : { ...actor, skillLevel: level };
  const clientCost = skillNumber(battleSkillRow(skill.id, level, actor.awakeFilter,
    actor.unitKind === 'monster' || actor.unitKind === 'summon'), 'consumeVal');
  let baseCost = skill.resolveResourceCost?.(state, costActor, scheduling)
    ?? (clientCost === undefined ? skillResourceCost(skill, level) : { resourceId: 'fire', amount: clientCost });
  if (baseCost) for (const status of actor.statuses) {
    const reducer = registry?.getStatus(status.statusId)?.modifyResourceCost;
    if (reducer) {
      const amount = reducer(state, costActor, skill, baseCost);
      if (!Number.isFinite(amount)) return undefined;
      baseCost = { ...baseCost, amount: Math.max(0, amount) };
    }
  }
  let cost = baseCost && adjustment?.additionalResourceCost?.resourceId === baseCost.resourceId
    ? { ...baseCost, amount: baseCost.amount + adjustment.additionalResourceCost.amount } : baseCost;
  const statusSubstitutions: NonNullable<ResolvedPayment['statusSubstitutions']> = [];
  for (const substitution of adjustment?.resourceCostSubstitutions ?? []) {
    if (!cost || substitution.resourceId !== cost.resourceId) continue;
    const owner = state.units[substitution.sourceUnitId ?? actor.unitId];
    const status = owner?.statuses.find(item => item.statusId === substitution.statusId);
    if (!status || status.stacks <= 0) continue;
    const availableResource = Math.max(0, state.resources[actor.side]?.[cost.resourceId] ?? 0);
    if (substitution.whenInsufficient && availableResource >= cost.amount) continue;
    const wanted = substitution.whenInsufficient ? Math.max(0, cost.amount - availableResource) : cost.amount;
    const stacks = Math.min(wanted, status.stacks);
    if (stacks <= 0) continue;
    statusSubstitutions.push({ statusId: status.statusId, instanceId: status.instanceId, sourceUnitId: owner!.unitId, stacks,
      ...(substitution.linkedStatusId ? { linkedStatusId: substitution.linkedStatusId } : {}) });
    cost = { ...cost, amount: cost.amount - stacks };
  }
  const substitutions = statusSubstitutions.length ? { statusSubstitutions } : {};
  if (!cost || cost.amount <= 0) return { resourceAmount: 0, meterAmount: 0, ...substitutions };
  const available = Math.max(0, state.resources[actor.side]?.[cost.resourceId] ?? 0);
  if (available >= cost.amount) return { resourceId: cost.resourceId, resourceAmount: cost.amount, meterAmount: 0,
    ...substitutions };
  const alternate = skill.alternatePayment;
  if (!alternate || level < alternate.minSkillLevel || alternate.resourceId !== cost.resourceId) return undefined;
  const stepsPerMissing = Math.max(1, alternate.meterStepsPerMissing ?? 1);
  const missing = cost.amount - available;
  const meterAmount = missing * stepsPerMissing;
  const progress = state.resourceMeters[actor.side]?.[alternate.meterResourceId]?.progress ?? 0;
  if (progress < meterAmount) return undefined;
  return { resourceId: cost.resourceId, resourceAmount: available, meterResourceId: alternate.meterResourceId, meterAmount,
    ...substitutions };
}

function resolveActionAdjustment(state: BattleState, actor: NonNullable<BattleState['units'][string]>, skill: SkillDefinition,
  registry: ContentRegistry): ActionAdjustment | undefined {
  const carriers = [actor, ...state.sides[actor.side].map(unitId => state.units[unitId])
    .filter((unit): unit is NonNullable<typeof unit> => Boolean(unit && unit.unitId !== actor.unitId && unit.hp > 0 && !isUnitBanished(unit)))];
  const adjustments = carriers.flatMap(carrier => carrier.soulId
    ? [registry.getSoul(carrier.soulId)?.resolveActionAdjustment?.(state, actor, skill)].filter((value): value is ActionAdjustment => Boolean(value))
    : []);
  if (!adjustments.length) return undefined;
  const additionalCosts = adjustments.flatMap(adjustment => adjustment.additionalResourceCost ? [adjustment.additionalResourceCost] : []);
  const additionalResourceCost = additionalCosts.length && additionalCosts.every(cost => cost.resourceId === additionalCosts[0]!.resourceId)
    ? { resourceId: additionalCosts[0]!.resourceId, amount: additionalCosts.reduce((total, cost) => total + cost.amount, 0) } : undefined;
  return {
    ...(additionalResourceCost ? { additionalResourceCost } : {}),
    ...(adjustments.some(adjustment => adjustment.resourceCostSubstitutions?.length)
      ? { resourceCostSubstitutions: adjustments.flatMap(adjustment => adjustment.resourceCostSubstitutions ?? []) } : {}),
    ...(adjustments.some(adjustment => adjustment.damageMultiplier !== undefined)
      ? { damageMultiplier: adjustments.reduce((total, adjustment) => total * (adjustment.damageMultiplier ?? 1), 1) } : {}),
    ...(adjustments.find(adjustment => adjustment.label)?.label ? { label: adjustments.find(adjustment => adjustment.label)!.label } : {}),
  };
}

function skillRank(actor: NonNullable<BattleState['units'][string]>, skillId: string): number {
  const level = actor.skillLevels?.[skillId];
  return Number.isFinite(level) ? Math.max(1, Math.min(6, Math.floor(level!))) : actor.skillLevel;
}

function validTargets(state: BattleState, intent: ActionIntent, targetRelation: ActionIntent['targetRelation'], allowDefeated: boolean): boolean {
  const actor = state.units[intent.actorId];
  if (!actor || intent.targetIds.length === 0) return false;
  if (new Set(intent.targetIds).size !== intent.targetIds.length) return false;
  if (intent.shape === 'self') {
    if (intent.targetIds.length !== 1 || intent.targetIds[0] !== intent.actorId) return false;
    return targetRelation !== 'enemy';
  }
  if (intent.shape === 'single' && intent.targetIds.length !== 1) return false;
  if (intent.shape === 'all-enemies' || intent.shape === 'all-allies') {
    const side = intent.shape === 'all-enemies' ? (actor.side === 'blue' ? 'red' : 'blue') : actor.side;
    const expected = state.sides[side].filter(unitId => state.units[unitId]?.hp > 0 && !isUnitBanished(state.units[unitId])).slice().sort();
    const actual = intent.targetIds.slice().sort();
    if (expected.length !== actual.length || expected.some((targetId, index) => targetId !== actual[index])) return false;
  }
  return intent.targetIds.every(targetId => {
    const target = state.units[targetId];
    if (!target || (!allowDefeated && (target.hp <= 0 || isUnitBanished(target)))) return false;
    if (targetRelation === 'ally' && target.side !== actor.side) return false;
    if (targetRelation === 'enemy' && target.side === actor.side) return false;
    if (intent.shape === 'all-enemies') return target.side !== actor.side;
    if (intent.shape === 'all-allies') return target.side === actor.side;
    return true;
  });
}
