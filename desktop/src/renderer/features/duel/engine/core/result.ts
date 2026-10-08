import type { BattleEvent, BattleState, SideId } from './types';

export type CoverageStatus = 'verified' | 'partial' | 'unsupported';
export interface CoverageDiagnostic {
  contentType: 'hero' | 'soul' | 'status' | 'runtime';
  contentId: string;
  aspect?: 'ai' | 'mechanics';
  status: CoverageStatus;
  message?: string;
}

export interface BattleRunOptions {
  seed?: number;
  ruleVersion?: string;
  actionLimit?: number;
  captureEvents?: boolean;
  triggerBudget?: number;
}

export interface BattleRunResult {
  winner: SideId | 'draw';
  reason: 'elimination' | 'action-limit' | 'trigger-budget';
  state: BattleState;
  events: readonly BattleEvent[];
  diagnostics: readonly CoverageDiagnostic[];
  seed: number;
  ruleVersion: string;
}

export interface BattleResult {
  blueRate: number;
  redRate: number;
  drawRate: number;
  seed: number;
  sampleLog: string[];
  engine: 'modular';
  diagnostics: readonly CoverageDiagnostic[];
  sampleReason?: 'elimination' | 'action-limit' | 'trigger-budget';
  terminationCounts: { elimination: number; actionLimit: number; triggerBudget: number };
  /** Runs excluded from aggregate results because their trigger budget was exceeded. */
  invalidRuns?: number;
  sampleResult?: BattleRunResult;
}
