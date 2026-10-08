import { applyEffectCommands, type CriticalDamageModifier, type DamageInterceptor, type DamageModifier, type HealingModifier } from './effects';
import { createBattleContext } from './context';
import type { EventDispatcher } from './event-dispatcher';
import type { BattleEvent, BattleState, EffectCommand } from './types';
import type { StatusDefinition } from './definitions';
import { TriggerBudget, type TriggerBudgetDiagnostic } from './trigger-budget';

export interface SettlementResult {
  state: BattleState;
  events: readonly BattleEvent[];
  triggerBudget?: TriggerBudgetDiagnostic;
}

export function settleEvents(
  initialState: BattleState,
  initialEvents: readonly BattleEvent[],
  dispatcher: EventDispatcher,
  random: () => number,
  budget = new TriggerBudget(),
  resolveStatus?: (statusId: string) => StatusDefinition | undefined,
  modifyDamage?: DamageModifier,
  interceptDamage?: DamageInterceptor,
  modifyHealing?: HealingModifier,
  modifyCriticalDamage?: CriticalDamageModifier,
): SettlementResult {
  let state = initialState;
  const queue = [...initialEvents];
  const events: BattleEvent[] = [];
  let queueIndex = 0;
  while (queueIndex < queue.length) {
    const event = queue[queueIndex++];
    if (!event) continue;
    events.push(event);
    for (const handler of dispatcher.handlersFor(event.phase)) {
      if (event.type === 'damage' && event.suppressSoulTriggers && handler.id.startsWith('soul:')) continue;
      if (event.type === 'damage' && event.suppressTargetSoulTriggers && state.units[event.targetId]?.soulId
        && handler.id.startsWith(`soul:${state.units[event.targetId]!.soulId}:`)) continue;
      if ('suppressTargetPassiveTriggers' in event && event.suppressTargetPassiveTriggers && handler.id.startsWith('hero:')) {
        const targetHeroIds = event.type === 'damage'
          ? [state.units[event.targetId]?.heroId]
          : event.type === 'attack-ended'
            ? (event.targetHealthChanges ?? []).map(change => state.units[change.targetId]?.heroId)
            : [];
        if (targetHeroIds.some(heroId => heroId !== undefined && handler.id.startsWith(`hero:${heroId}:`))) continue;
      }
        if ('suppressSourcePassiveTriggers' in event && event.suppressSourcePassiveTriggers && handler.id.startsWith('hero:')) {
          const sourceHeroId = event.source.unitId ? state.units[event.source.unitId]?.heroId : undefined;
          if (sourceHeroId !== undefined && handler.id.startsWith(`hero:${sourceHeroId}:`)) continue;
        }
      const scope = event.attackId !== undefined ? 'attack' : event.actionId !== undefined ? 'action' : 'round';
      const scopeId = scope === 'attack' ? String(event.attackId)
        : scope === 'action' ? String(event.actionId) : String(state.counters.round);
      const limit = budget.consume(scope, scopeId, handler.id);
      if (limit.exceeded) return { state, events, triggerBudget: limit };
      const context = createBattleContext(state, random, statusId => resolveStatus?.(statusId)?.category,
        statusId => resolveStatus?.(statusId)?.dispellable === true,
        unitId => Boolean(state.units[unitId]?.statuses.some(status => resolveStatus?.(status.statusId)?.preventsAction)), modifyDamage);
      const returned = handler.handle(context, event) ?? [];
      const commands: EffectCommand[] = [...context.drainCommands(), ...returned].map(command => ({
        ...command,
        parentEventId: command.parentEventId ?? event.eventId,
      }));
      if (commands.length === 0) continue;
      const resolution = applyEffectCommands(state, commands, 'effect-resolution', `${event.eventId}-${handler.id}`,
        resolveStatus, modifyDamage, interceptDamage, modifyHealing, modifyCriticalDamage);
      state = resolution.state;
      queue.push(...resolution.events.map(child => ({ ...child,
        ...(event.actionId !== undefined && child.actionId === undefined ? { actionId: event.actionId } : {}),
        ...(event.attackId !== undefined && child.attackId === undefined ? { attackId: event.attackId } : {}),
      })));
    }
  }
  return { state, events };
}
