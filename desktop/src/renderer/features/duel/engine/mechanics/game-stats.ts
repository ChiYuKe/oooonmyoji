/**
 * 游戏侧「属性合成」的忠实实现 —— 对照 AttrCalc 各 getter 的反汇编。
 *
 * 证据（yys-lineup/out/disasm/AttrCalc_classes/AttrCalc/*.txt，均由客户端字节码反汇编得到）：
 *
 *   attack   : names = [max, _attackAdditionVal, _baseAttack, _attackAdditionRate,
 *                       _allAdditionRate, _attackToVal, _attackToValAddMaxValue, min,
 *                       _newServerAdditionRate, _specialAttackAdditionRate]
 *              ⇒ value = max(0, baseAttack * (1 + rate 之和) + attackAdditionVal)
 *                另有一条「攻击转化」addValue = min(attackToVal, attackToValAddMaxValue)
 *
 *   defense  : names = [max, _defenseAdditionVal, _baseDefense, _defenseAdditionRate,
 *                       _allAdditionRate, _newServerAdditionRate, _specialDefenseAdditionRate]
 *
 *   maxHp    : names = [maxChangeModelShield, changeModelShield, getattr,
 *                       _maxHpAdditionVal, _baseMaxHp, _maxHpAdditionRate, _allAdditionRate,
 *                       max, _pvpMaxHpAdditionRate, _maxHpMulAfterPVP,
 *                       _specialMaxHpAdditionRate, _newServerAdditionRate, _maxHpDec]
 *              ⇒ value = max(0, (base * (1 + rate 之和) + flat) * maxHpMulAfterPVP) - maxHpDec
 *
 *   speed    : names = [baseSpeed, _speedAdditionVal, _speedAdditionRate]
 *   critRate : names = [baseCritRate, _critRateAdditionVal, _critRateAdditionRate]
 *   critResist: names = [_critResist]        （抗暴击，与面板「效果抵抗」不是同一字段）
 *
 * ★ 与旧实现的差异：旧 effectiveStats 用 (base + flat) * (1 + percent)，
 *   游戏是 base * (1 + percent) + flat —— 同时有 flat 与 percent 时结果不同。
 */

export type GameStatName =
  | 'attack' | 'defense' | 'maxHp' | 'speed'
  | 'critRate' | 'critPower' | 'debuffEnhance' | 'debuffResist';

/** 一次属性合成的全部输入（对应 AttrCalc 的内部字段）。 */
export interface GameStatParts {
  /** 基础值：来自面板/成长表（baseAttack / baseDefense / baseMaxHp / baseSpeed …） */
  base: number;
  /** 加算项（*AdditionVal）；对 maxHp 是 _maxHpAdditionVal */
  additionVal?: number;
  /** 该属性自己的百分比加成（*AdditionRate） */
  additionRate?: number;
  /** 通用百分比加成 _allAdditionRate（影响攻/生/防） */
  allAdditionRate?: number;
  /** 玩法专用百分比 _specialXxxAdditionRate */
  specialAdditionRate?: number;
  /** 新服加成 _newServerAdditionRate */
  newServerAdditionRate?: number;
  /** 仅 maxHp：PVP 专用加成率 _pvpMaxHpAdditionRate */
  pvpMaxHpAdditionRate?: number;
  /** 仅 maxHp：PVP 之后的乘区 _maxHpMulAfterPVP */
  maxHpMulAfterPVP?: number;
  /** 仅 maxHp：最终减值 _maxHpDec */
  maxHpDec?: number;
}

const sumRates = (p: GameStatParts): number =>
  (p.additionRate ?? 0) + (p.allAdditionRate ?? 0) + (p.specialAdditionRate ?? 0)
  + (p.newServerAdditionRate ?? 0) + (p.pvpMaxHpAdditionRate ?? 0);

/** 攻/防：max(0, base * (1 + Σrate) + flat) */
export function composeLinear(parts: GameStatParts): number {
  const value = parts.base * (1 + sumRates(parts)) + (parts.additionVal ?? 0);
  return Math.max(0, value);
}

/** 生命：max(0, (base * (1 + Σrate) + flat) * maxHpMulAfterPVP) - maxHpDec */
export function composeMaxHp(parts: GameStatParts): number {
  const scaled = parts.base * (1 + sumRates(parts)) + (parts.additionVal ?? 0);
  const afterPvp = scaled * (parts.maxHpMulAfterPVP ?? 1);
  return Math.max(0, afterPvp - (parts.maxHpDec ?? 0));
}

/** 速度 / 暴击 / 暴伤 / 命中 / 抵抗：base + flat（速度另有 rate 乘区） */
export function composeAdditive(base: number, additionVal = 0, additionRate = 0, floor = 0): number {
  return Math.max(floor, base * (1 + additionRate) + additionVal);
}

/**
 * 攻击转化（AttrCalc.attack 里的 addValue）：
 *   addValue = min(_attackToVal, _attackToValAddMaxValue)
 * 旧实现没有这个概念；需要「以攻击力为系数」的技能时用它。
 */
export function attackConversion(attackToVal = 0, attackToValAddMaxValue = 0): number {
  return Math.min(attackToVal, attackToValAddMaxValue);
}

/** 把一组「游戏属性名 → 值」的 modifier 折算成 rate/flat 两部分。 */
export function splitModifiers(
  modifiers: readonly { stat: string; operation: 'flat' | 'percent'; amount: number }[],
  statName: string,
): { flat: number; percent: number } {
  let flat = 0;
  let percent = 0;
  for (const m of modifiers) {
    if (m.stat !== statName || !Number.isFinite(m.amount)) continue;
    if (m.operation === 'flat') flat += m.amount;
    else percent += m.amount;
  }
  return { flat, percent };
}
