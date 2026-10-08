export interface HealingResolution {
  amount: number;
  hpGained: number;
  hpAfter: number;
}

export function resolveHealing(hp: number, maxHp: number, amount: number): HealingResolution {
  const normalized = Math.max(0, Number.isFinite(amount) ? amount : 0);
  const hpAfter = Math.min(Math.max(0, maxHp), Math.max(0, hp) + normalized);
  return { amount: normalized, hpGained: hpAfter - Math.max(0, hp), hpAfter };
}
