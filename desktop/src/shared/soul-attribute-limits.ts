/** Six-star client coefficients, checked against saved client tables and the agreed attribute standard. */
export const SIX_STAR_SUBSTAT_ROLLS: Readonly<Record<string, number>> = {
  maxHpAdditionVal: 114, defenseAdditionVal: 5, attackAdditionVal: 27,
  maxHpAdditionRate: .03, defenseAdditionRate: .03, attackAdditionRate: .03,
  speedAdditionVal: 3, critRateAdditionVal: .03, critPowerAdditionVal: .04, debuffEnhance: .04, debuffResist: .04,
};
export const SIX_STAR_SUBSTAT_MIN_FACTOR = .8;
export const SIX_STAR_SUBSTAT_MAX_ALLOCATIONS = 6;
export const SIX_STAR_SUBSTAT_TOTAL_ALLOCATIONS = 9;
/** Recommendation policy; the game's theoretical maximum remains 100% of each coefficient. */
export const REFERENCE_SUBSTAT_MAX_FACTOR = .98;
export const SIX_STAR_MAIN_VALUES: Readonly<Record<string, number>> = {
  attackAdditionVal: 486, defenseAdditionVal: 104, maxHpAdditionVal: 2052, speedAdditionVal: 57,
  attackAdditionRate: .55, defenseAdditionRate: .55, maxHpAdditionRate: .55,
  critRateAdditionVal: .55, critPowerAdditionVal: .89, debuffEnhance: .55, debuffResist: .55,
};
export const BOSS_INTRINSIC_VALUES: Readonly<Record<string, number>> = {
  attackAdditionRate: .08, maxHpAdditionRate: .08, defenseAdditionRate: .16,
  critRateAdditionVal: .08, debuffEnhance: .08, debuffResist: .08,
};
