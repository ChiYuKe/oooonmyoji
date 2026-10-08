/** Compatibility facade; every battle runs in the modular engine and reports content coverage. */
import { soulCatalog } from '../../../../shared/soul-catalog-data';
import { diagnoseContentCoverage, rosterRefsFromState } from './content/coverage';
import { createMigratedContentRegistry } from './content/register-migrated-content';
import type { BattleResult, BattleRunResult } from './core/result';
import { presentBattleEvents } from './presentation/events';
import { createBattleState } from './simulation/input-adapter';
import { runBattle } from './simulation/run-battle';
import type { DuelState } from './types';

const migratedRegistry = createMigratedContentRegistry();
const modularRuleVersion = 'game-fidelity-v2';

export function simulateBattle(state: DuelState, runs = 256, sampleIndex = 0): BattleResult {
  const selection = inspectInput(state);
  const modularState = selection.battleState;
  if (!Number.isInteger(runs) || runs <= 0) runs = 1;

  const seed = compatibleBaseSeed(state);
  let blueWins = 0;
  let redWins = 0;
  let draws = 0;
  let validRuns = 0;
  let sampleResult: BattleRunResult | undefined;
  const terminationCounts = { elimination: 0, actionLimit: 0, triggerBudget: 0 };
  for (let index = 0; index < runs; index++) {
    const result = runBattle(modularState, migratedRegistry, { seed, sampleIndex: index, ruleVersion: modularRuleVersion,
      captureEvents: index === sampleIndex });
    if (index === sampleIndex) sampleResult = result;
    if (result.reason === 'trigger-budget') { terminationCounts.triggerBudget++; continue; }
    if (result.reason === 'action-limit') terminationCounts.actionLimit++;
    else terminationCounts.elimination++;
    validRuns++;
    if (result.winner === 'blue') blueWins++;
    else if (result.winner === 'red') redWins++;
    else draws++;
  }
  const denominator = Math.max(1, validRuns);
  return { blueRate: blueWins / denominator, redRate: redWins / denominator, drawRate: draws / denominator, seed,
    sampleLog: sampleResult ? presentBattleEvents(sampleResult.events, createUnitLabeler(sampleResult.state)) : [],
    engine: 'modular', diagnostics: sampleResult?.diagnostics ?? selection.diagnostics,
    sampleReason: sampleResult?.reason,
    terminationCounts,
    ...(validRuns < runs ? { invalidRuns: runs - validRuns } : {}),
    ...(sampleResult ? { sampleResult } : {}) };
}

/** Runs modular batches in cancellable chunks. */
export async function simulateBattleProgressive(
  state: DuelState,
  runs: number,
  sampleIndex: number,
  onProgress: (completed: number, total: number, engine: 'modular') => void,
  isCancelled: () => boolean,
  chunkSize = 8,
): Promise<BattleResult | undefined> {
  const selection = inspectInput(state);
  const modularState = selection.battleState;
  if (!Number.isInteger(runs) || runs <= 0) runs = 1;

  const seed = compatibleBaseSeed(state);
  let blueWins = 0;
  let redWins = 0;
  let draws = 0;
  let validRuns = 0;
  let sampleResult: BattleRunResult | undefined;
  const terminationCounts = { elimination: 0, actionLimit: 0, triggerBudget: 0 };
  const step = Math.max(1, Math.floor(chunkSize));
  for (let index = 0; index < runs; index++) {
    if (isCancelled()) return undefined;
    const result = runBattle(modularState, migratedRegistry, { seed, sampleIndex: index, ruleVersion: modularRuleVersion,
      captureEvents: index === sampleIndex });
    if (index === sampleIndex) sampleResult = result;
    if (result.reason === 'trigger-budget') terminationCounts.triggerBudget++;
    else {
      if (result.reason === 'action-limit') terminationCounts.actionLimit++;
      else terminationCounts.elimination++;
      validRuns++;
      if (result.winner === 'blue') blueWins++;
      else if (result.winner === 'red') redWins++;
      else draws++;
    }
    const completed = index + 1;
    if (completed % step === 0 || completed === runs) {
      onProgress(completed, runs, 'modular');
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }
  if (isCancelled()) return undefined;
  const denominator = Math.max(1, validRuns);
  return { blueRate: blueWins / denominator, redRate: redWins / denominator, drawRate: draws / denominator, seed,
    sampleLog: sampleResult ? presentBattleEvents(sampleResult.events, createUnitLabeler(sampleResult.state)) : [],
    engine: 'modular', diagnostics: sampleResult?.diagnostics ?? selection.diagnostics,
    sampleReason: sampleResult?.reason,
    terminationCounts,
    ...(validRuns < runs ? { invalidRuns: runs - validRuns } : {}),
    ...(sampleResult ? { sampleResult } : {}) };
}

export function simulateBattleSampleDetails(state: DuelState, sampleIndex: number): {
  sampleLog: string[];
  sampleReason?: 'elimination' | 'action-limit' | 'trigger-budget';
} {
  const selection = inspectInput(state);
  const modularState = selection.battleState;
  const index = Math.max(0, Math.floor(sampleIndex));
  const result = runBattle(modularState, migratedRegistry, { seed: compatibleBaseSeed(state), sampleIndex: index,
    ruleVersion: modularRuleVersion, captureEvents: true });
  return { sampleLog: presentBattleEvents(result.events, createUnitLabeler(result.state)), sampleReason: result.reason };
}

export function simulateBattleSample(state: DuelState, sampleIndex: number): string[] {
  return simulateBattleSampleDetails(state, sampleIndex).sampleLog;
}

function inspectInput(input: DuelState) {
  const battleState = createBattleState(input);
  const roster = rosterRefsFromState(Object.values(battleState.units));
  const diagnostics = diagnoseContentCoverage(roster, migratedRegistry);
  return { diagnostics, battleState } as const;
}

function compatibleBaseSeed(state: DuelState): number {
  const seedText = JSON.stringify(state);
  let seed = 2166136261;
  for (let index = 0; index < seedText.length; index++) seed = Math.imul(seed ^ seedText.charCodeAt(index), 16777619) >>> 0;
  return seed || 1;
}

function createUnitLabeler(state: ReturnType<typeof createBattleState>): (id: string) => string {
  const names = new Map(soulCatalog.heroes.map(hero => [hero.id, hero.name]));
  return id => {
    const unit = state.units[id];
    if (!unit) return id;
    return `${unit.side === 'blue' ? '蓝方' : '红方'}·${unit.displayName ?? names.get(unit.heroId) ?? `式神${unit.heroId}`}`;
  };
}

export { runBattle as runModularBattle } from './simulation/run-battle';
export { createMigratedContentRegistry } from './content/register-migrated-content';
export type { BattleFighterInput, DuelBattleInput } from './types';

export type { BattleResult, BattleRunOptions, BattleRunResult } from './core/result';
