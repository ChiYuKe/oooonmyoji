/** Main attributes permitted by each soul position; flat stats are fixed. */
export const SOUL_SLOT_MAIN_ATTRIBUTES: Readonly<Record<number, readonly string[]>> = {
  1: ['attackAdditionVal'],
  2: ['attackAdditionRate', 'defenseAdditionRate', 'maxHpAdditionRate', 'speedAdditionVal'],
  3: ['defenseAdditionVal'],
  4: ['attackAdditionRate', 'defenseAdditionRate', 'maxHpAdditionRate', 'debuffEnhance', 'debuffResist'],
  5: ['maxHpAdditionVal'],
  6: ['attackAdditionRate', 'defenseAdditionRate', 'maxHpAdditionRate', 'critRateAdditionVal', 'critPowerAdditionVal'],
};

/** Preselected main attribute per slot, used when the chosen objective has no matching attribute for that slot. */
export const SOUL_SLOT_DEFAULT_MAIN_ATTRIBUTES: Readonly<Record<number, readonly string[]>> = {
  2: ['attackAdditionRate'], 4: ['attackAdditionRate'], 6: ['critRateAdditionVal', 'critPowerAdditionVal'],
};

export const SOUL_MAIN_ATTRIBUTE_LABELS: Readonly<Record<string, string>> = {
  attackAdditionVal: '攻击', defenseAdditionVal: '防御', maxHpAdditionVal: '生命',
  attackAdditionRate: '攻击加成', defenseAdditionRate: '防御加成', maxHpAdditionRate: '生命加成',
  speedAdditionVal: '速度', debuffEnhance: '效果命中', debuffResist: '效果抵抗',
  critRateAdditionVal: '暴击', critPowerAdditionVal: '暴击伤害',
};

/** Multiple positions expose their union; no position selection means all slots. */
export function soulMainAttributesForPositions(positions: readonly (number | string)[]): string[] {
  const selected = new Set(positions.map(Number).filter(position => Object.hasOwn(SOUL_SLOT_MAIN_ATTRIBUTES, position)));
  return [...new Set(Object.entries(SOUL_SLOT_MAIN_ATTRIBUTES)
    .filter(([position]) => !selected.size || selected.has(Number(position)))
    .flatMap(([, attributes]) => [...attributes]))];
}
