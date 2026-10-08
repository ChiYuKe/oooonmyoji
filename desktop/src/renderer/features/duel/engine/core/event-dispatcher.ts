import type { BattleContext, BattleEvent, BattlePhase } from './types';
import type { RuleHandler } from './definitions';

export interface PhaseHandler {
  id: string;
  phase: BattlePhase;
  priority: number;
  handle: RuleHandler;
}

export class EventDispatcher {
  private readonly handlers: PhaseHandler[] = [];

  register(handler: PhaseHandler): void {
    if (this.handlers.some(current => current.id === handler.id && current.phase === handler.phase)) {
      throw new Error(`Duplicate rule handler: ${handler.phase}/${handler.id}`);
    }
    this.handlers.push(handler);
    this.handlers.sort((left, right) => left.phase.localeCompare(right.phase)
      || left.priority - right.priority
      || compareStableId(left.id, right.id));
  }

  handlersFor(phase: BattlePhase): readonly PhaseHandler[] {
    return this.handlers.filter(handler => handler.phase === phase);
  }

  dispatch(context: BattleContext, event: BattleEvent): void {
    for (const handler of this.handlers) {
      if (handler.phase !== event.phase) continue;
      const commands = handler.handle(context, event);
      if (commands) for (const command of commands) context.submit(command);
    }
  }
}

function compareStableId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
