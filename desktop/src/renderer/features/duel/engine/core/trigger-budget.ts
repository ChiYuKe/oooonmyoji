export interface TriggerBudgetDiagnostic {
  exceeded: boolean;
  scope: 'action' | 'attack' | 'round' | 'battle';
  key: string;
  count: number;
  limit: number;
}

export class TriggerBudget {
  private readonly counts = new Map<string, number>();
  constructor(private readonly limitPerScope = 256) {}

  consume(scope: TriggerBudgetDiagnostic['scope'], scopeId: string, triggerId: string): TriggerBudgetDiagnostic {
    const key = `${scope}:${scopeId}:${triggerId}`;
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return { exceeded: count > this.limitPerScope, scope, key, count, limit: this.limitPerScope };
  }
}
