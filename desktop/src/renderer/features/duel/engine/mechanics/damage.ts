import type { UnitState } from '../core/types';
import { calcRawAttackDmg, calcShieldAbsorb, type GameDamageInput } from './game-damage';

export interface DamageResolution {
  amount: number;
  shieldAbsorbed: number;
  hpLost: number;
  hpAfter: number;
}

export interface DamageFormulaInput extends Omit<GameDamageInput, 'critRate' | 'random'> {
  critChance: number;
  critDamage: number;
  defenseIgnore?: number;
  damageMultiplier?: number;
  ignoreShield?: boolean;
  shieldDmgAddRate?: number;
  leechRate?: number;
}

export interface DamageOptions {
  hurtReductionRate?: number;
  fixedHurtReductionVal?: number;
  seriousInjury?: boolean;
  ignoreShield?: boolean;
  shieldDmgAddRate?: number;
  leechRate?: number;
  avoided?: boolean;
  recordDefense?: number;
  recordHurtReductionRate?: number;
}

export interface CalculatedDamage {
  amount: number;
  isCritical: boolean;
  damageOptions?: DamageOptions;
}

export function calculateDamage(input: DamageFormulaInput, random: () => number): CalculatedDamage {
  const result = calcRawAttackDmg({ ...input, attack: Math.max(0, finite(input.attack, 0)),
    defense: finite(input.defense, 0), ratio: Math.max(0, finite(input.ratio, 0)),
    critRate: finite(input.critChance, 0), critDamage: finite(input.critDamage, 1), random,
    defenseReduction: { ...input.defenseReduction,
      ignoreDefenseValue: (input.defenseReduction?.ignoreDefenseValue ?? 0) + (input.defenseIgnore ?? 0) } });
  return { amount: result.hpChange * Math.max(0, finite(input.damageMultiplier ?? 1, 1)), isCritical: result.critical,
    ...(input.seriousInjury ? { damageOptions: { seriousInjury: true, recordDefense: result.recordDefense,
      recordHurtReductionRate: result.recordHurtReductionRate } } : {}) };
}

/** Resolves the generic shield and HP portion; content-specific modifiers run before this step. */
export function resolveDamage(target: Pick<UnitState, 'hp'>, amount: number, shield: number,
  shieldDmgAddRate = 0, ignoreShield = false, absorbAllDamage = false): DamageResolution {
  const normalized = Math.max(0, Number.isFinite(amount) ? amount : 0);
  const absorption = ignoreShield ? { damage: normalized, consumeShield: 0 }
    : calcShieldAbsorb(normalized, Math.max(0, shield), shieldDmgAddRate, absorbAllDamage);
  const shieldAbsorbed = Math.min(Math.max(0, shield), absorption.consumeShield);
  const hpLost = Math.min(Math.max(0, target.hp), absorption.damage);
  return { amount: normalized, shieldAbsorbed, hpLost, hpAfter: Math.max(0, target.hp - hpLost) };
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
