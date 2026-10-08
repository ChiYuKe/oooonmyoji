/** Applies a per-hit reduction limited by both a fraction of maximum HP and a fraction of the hit. */
export function cappedDamageReduction(amount: number, maxHp: number, maxHpRatio: number, hitRatio = .4): number {
  const incoming = Math.max(0, Number.isFinite(amount) ? amount : 0);
  const hpCap = Math.max(0, Number.isFinite(maxHp) ? maxHp : 0) * Math.max(0, Number.isFinite(maxHpRatio) ? maxHpRatio : 0);
  const hitCap = incoming * Math.max(0, Math.min(1, Number.isFinite(hitRatio) ? hitRatio : 0));
  return Math.max(0, incoming - Math.min(hpCap, hitCap));
}
