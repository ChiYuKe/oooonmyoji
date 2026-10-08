import { calculateDamage, type CalculatedDamage } from './damage';

export interface IndirectDamageInput {
  readonly attack: number;
  readonly defense: number;
  readonly defenseIgnore?: number;
  readonly ratio: number;
  readonly critDamage: number;
}

/** Indirect damage ignores its declared amount of defense and guarantees a critical hit at zero effective defense. */
export function calculateIndirectDamage(input: IndirectDamageInput, random: () => number): CalculatedDamage {
  const effectiveDefense = Math.max(0, (Number.isFinite(input.defense) ? input.defense : 0)
    - Math.max(0, Number.isFinite(input.defenseIgnore) ? input.defenseIgnore! : 0));
  return calculateDamage({ ...input, critChance: effectiveDefense === 0 ? 1 : 0 }, random);
}
