/**
 * 对局内最大生命（乱斗 / 对弈竞猜）
 *
 * ## 为什么要单独一个模块
 *
 * 「选卡界面面板」与「对局内实际生命」**不是同一个数**。引擎此前直接把面板当成对局生命，
 * 导致所有以生命为基数的效果系统性偏小。
 *
 * ## 实机反推（荒骷髅 · 黄泉战旗 5853）
 *
 * 该技能：失去 30% 最大生命，再按「自身已损失生命」8% / 30% 打两段真实伤害。
 *
 *   实机截图自伤          = 20,452        ⇒ 对局内最大生命 = 20,452 / 0.30 = 68,173
 *   实机第 1 段           = 1,636         ⇒ 已损失生命   = 1,636 / 0.08  = 20,450
 *   实机第 2 段           = 6,135         ⇒ 已损失生命   = 6,135 / 0.30  = 20,450
 *   选卡面板生命          = 28,171
 *   6★40 基础生命         = 14,924.52
 *
 * 引擎旧算法：30% × 28,171 = 8,451 → 两段 676 / 2,535（实机 1,636 / 6,135）
 * 比值 20,452 / 8,451 = 2.4201 —— 与伤害比值完全一致 ⇒ 唯一原因就是生命基数用错。
 *
 * ## 采用的规则（整面板乘区）
 *
 * `AttrCalc.maxHp` 的形式（见 yys-lineup/out/disasm/AttrCalc_classes/AttrCalc/maxHp.txt）：
 *
 *     maxHp = max(0, (base * (1 + Σrates) + additionVal) * maxHpMulAfterPVP) - maxHpDec
 *
 * 实测：`maxHpMulAfterPVP` **乘在整个面板上**（base 与御魂平加一起放大）：
 *
 *     对局内生命 = 面板生命 * BATTLE_MAXHP_MULTIPLIER
 *
 * 用 2.42 代入荒骷髅，实机三个整数**全部命中**：
 *
 *     28,171 × 2.42 = 68,173.8   → 30% = 20,452.1 → 实机 20452 ✓
 *                                →  8% =  1,636.2 → 实机  1636 ✓
 *                                → 30% =  6,135.6 → 实机  6135 ✓（截断）
 *
 * ## 被否掉的形式
 *
 * `_pvpMaxHpAdditionRate`（加成率，位于 Σrates 内部，只放大 base）形式：
 *
 *     面板生命 + 2.5 × 基础生命 = 28,171 + 37,311 = 65,482   → 实机 68,173，差 −3.9%
 *
 * 与实机不符，因此对局用的不是「+2.5 加成率」而是「×2.42 整面板乘区」。
 *
 * ## 仍待确认
 *
 * 2.42 这个数字尚无朴素解释（既不是 3.5，也不是 1 + 2.5）。它也可能是
 * 「某档点数 × 某加成率」的合成值 —— 需要第二个「按生命上限百分比」的实机数值
 * （针女 10% / 地藏像 10% / 涅槃之火 15%）落在面板已知的单位上，才能判定它是常数还是各单位不同。
 * 一旦拿到第二个点，只需改本文件的 BATTLE_MAXHP_MULTIPLIER 即可重新标定。
 */

/** 选卡面板 → 对局内最大生命的乘区（对应 `AttrCalc.maxHp` 的 `_maxHpMulAfterPVP`）。 */
export const BATTLE_MAXHP_MULTIPLIER = 2.42;

/** DATA_HERO_MAKE 生命槽每点加成率（面板口径，供反解点数用）。 */
export const LUANDOU_HP_POINT_RATE = 0.05;

/** 乱斗面板里写死的御魂主属性平加（LuanDouAttrCalc.__init__ 常量之一）。 */
export const LUANDOU_HP_FLAT = 2053;

export interface BattleMaxHpResult {
  /** 对局内最大生命 */
  maxHp: number;
  /** 面板生命（选卡界面显示值） */
  panelHp: number;
  /** 6★40 基础生命；未知时为 0 */
  baseHp: number;
  /** 加成量（对局内 − 面板） */
  bonus: number;
  /** 是否成功识别到基础面板（仅用于自检与日志） */
  applied: boolean;
}

/**
 * 把「选卡面板生命」换算成「对局内最大生命」。
 *
 * `baseHp` 可选：仅用于日志/自检，不参与计算（乘区作用在整面板上）。
 */
export function battleMaxHp(panelHp: number, baseHp = 0): BattleMaxHpResult {
  const panel = Number.isFinite(panelHp) ? Math.max(0, panelHp) : 0;
  const base = Number.isFinite(baseHp) ? Math.max(0, baseHp) : 0;
  const maxHp = panel * BATTLE_MAXHP_MULTIPLIER;
  return { maxHp, panelHp: panel, baseHp: base, bonus: maxHp - panel, applied: true };
}

/** 从面板与基础反解生命点数（仅供核对，不参与结算）。 */
export function luandouHpPointsFromPanel(panelHp: number, baseHp: number): number {
  if (!(baseHp > 0)) return 0;
  return (panelHp - LUANDOU_HP_FLAT - baseHp) / (baseHp * LUANDOU_HP_POINT_RATE);
}

/** 供日志/自检使用的可读描述。 */
export function describeBattleHp(result: BattleMaxHpResult, heroName?: string): string {
  const who = heroName ? `${heroName}: ` : '';
  const base = result.baseHp > 0 ? `，基础 ${result.baseHp.toFixed(2)}` : '';
  return `${who}面板 ${result.panelHp.toFixed(0)} × ${BATTLE_MAXHP_MULTIPLIER}`
    + `${base} = 对局内 ${result.maxHp.toFixed(0)}（+${result.bonus.toFixed(0)}）`;
}
