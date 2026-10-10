/**
 * 游戏侧「伤害管线」的忠实实现 —— 对照 com\utils\formula.py 的反汇编。
 *
 * 证据（yys-lineup/out/disasm/com_utils_formula/*.txt，客户端字节码反汇编）：
 *
 * calcAttackDmg 的阶段顺序（对照函数调用偏移；co_names 本身不是执行序列）：
 *   0 _beforeCalcAttackDmg          抛全局事件（允许改攻/防）
 *   1 dodge                         闪避判定（targetAttrComp.dodge + simpleRandResult）
 *   2 calcRawAttackDmg              ← 见下
 *   3 _afterCalcAttackDmg           双方回调
 *   4 hurtReductionRate             减伤；>=0 用 realHurt /= (1 + r)，<0 用 *= (1 - r)
 *   5 serious_injury                重伤口径重算
 *   6 doFixedReduction              固定减伤 max(0, hp_change - fixedHurtReductionVal)
 *   7 CalcDamageResult(raw_damage, damage, critical, avoid_dmg)
 *   8 护盾 calcShieldAbsorb（先按 shield_dmg_add_rate 放大消耗）
 *   9 免疫 Immunity.DAMAGE
 *  10 hurtReboundRate               反弹 = rate * hurtBeforeAbsorb（下限 1）
 *  11 leechRate / getCampData       吸血
 *  12 calcExtHpAbsorb               玄血/额外血吸收
 *
 * calcRawAttackDmg 内部（偏移为字节码偏移，均已在反汇编中逐条确认）：
 *   472-498   attack   = calcDmgParam.attackReplace || fromAttrComp.attack
 *   516-560   attackAttr = skillData.get('attack_ref_attr')
 *   562-598   if attackAttr: attack = fromAttrComp[attackAttr]      ← 攻击引用属性
 *   600-612   defanse  = targetAttrComp.defense
 *   644-704   defanse  = max(defanse - ignoreDefenseValue, 0)
 *   706-772   if critical: defanse = max(defanse - ignoreDefenseValueWhenCrit, 0)
 *   774-816   if ignore_defense: defanse = max(defanse - ignore_defense, 0)
 *   818-912   if fromAttrComp.checkCardAttr('ignoreDefense'): defanse = max(defanse - breakDefense, 0)
 *   914-952   if ignoreDefanseRate: defanse -= defanse * ignoreDefanseRate
 *   954-986   defanse  = max(defanse, 0)
 *   988-1082  if critical and psskill: defanse -= defanse * psskill.param1; floor 0
 *  1128-1244  engine.callAnyBodyCompFuncExcuteCb(ON_TRIGGER_CHANGE_DEF, …)
 *             defanse = callBackResult.get('defanse', defanse)     ← 防御可被回调改写
 *  1246-1284  serious_injury = check_serious_injury(from, target)
 *  1294-1326  if serious: record_defense = defanse; defanse = 0（跳转极性按消费方校验）
 *  1342-1346  if serious: critical = True
 *  1328-1340  if isIndirectDamage: critical = True
 *  1348-1384  if getattr(fromEntity,'hero_no_crit',False): critical = False
 *  1386-1508  if const.DEFENSE_CORRECT_FACTOR + defanse != 0:
 *                 realHurt = attack * K / float(K + defanse)      K = DEFENSE_CORRECT_FACTOR = 300
 *  1514-1612  if skillData: addDmg = skillAddDmgReplace || skillData['addDmg'] || 0
 *                          if addDmg > 0: realHurt *= addDmg
 *  1638-1684  dmgFluctuation = skillData['dmgFluctuation']（可被 dmgFluctuationReplace 覆盖）
 *  1690-1764  if dmgFluctuation != 0: realHurt *= 1 + uniform(-f, f)
 *  1766-1856  hurtAdd = PvpHurtAdditionRate
 *             if not ignorehurtAdditionRate: hurtAdd += hurtAdditionRate + hurtAdditionRateAdd
 *             if hurtAdd >= 0: realHurt *= (1 + hurtAdd)
 *  2308-2322  realHurt = max(realHurt, 1.0)                       ← 伤害下限
 *  2324-2332  return realHurt, critical, record
 *
 * 尾部已核对：1860–1874 负增伤，1876–1902 damageReplace，1904–2012 目标减伤，
 * 2014–2058 暴击，2060–2084 extDmgRate，2206–2248 extCritPower，2250–2322 上下限。
 */

export const DEFENSE_CORRECT_FACTOR = 300;

/**
 * AOE（range skill）打**护盾实体**的伤害倍率。
 * 依据 `calcRawAttackDmg.txt:2104-2180`（`const.AOE_SKILL_TO_SHIELD_DMG_RATE = 2.5`）：
 *     if isRangeSkill(skillData['selectRange']) and helpers.isShieldEntity(targetEntity):
 *         realHurt *= 2.5
 * 位置在 `(1 + extDmgRate)` 之后、`extCritPower`/`maxHurt`/下限 1.0 之前。
 */
export const AOE_SKILL_TO_SHIELD_DMG_RATE = 2.5;

/**
 * 间接伤害：目标每 1 层「间接伤害层」额外无视的防御值。
 * 依据 `indirectDamageCalc.txt:656-744`（`const.INDIRECT_REDUCE_VALUE = 10`）：
 *     total_lv       = targetEntity.BuffMgrComp.getIndirectBuffLv()
 *     reduce_defense = total_lv * const.INDIRECT_REDUCE_VALUE
 *     calcDmgParam.ignoreDefenseValue += reduce_defense       # 累加到"无视防御值"，在 calcAttackDmg 之前
 * `getIndirectBuffLv` 的判据来自 buff 数据字段 `indirectDmgType`（`table_DATA_BUFF.json`：
 * 7458 条里 0 有 4074 条、1 有 48 条；取 1 的那些正是「回合后造成/受到…」「永久降低基础防御」这类间接伤害 debuff）。
 * 引擎侧对应 `StatusDefinition.indirectDamageLevel`（每层贡献，写入 `values.indirectDamageLevel`）。
 */
export const INDIRECT_REDUCE_VALUE = 10;

export interface GameDefenseReduction {
  /** defanse = max(defanse - v, 0) */
  ignoreDefenseValue?: number;
  /** 仅暴击时生效 */
  ignoreDefenseValueWhenCrit?: number;
  /** 平减（游戏里是减，不是乘率） */
  ignoreDefense?: number;
  /** 需 checkCardAttr('ignoreDefense') 为真才生效 */
  breakDefense?: number;
  /** 按比例穿透：defanse -= defanse * rate */
  ignoreDefanseRate?: number;
  /** 暴击且存在该被动时的 param1 */
  psSkillIgnoreDefWhenCrit?: number;
}

export interface GameDamageInput {
  /** 攻击方攻击力（已按 AttackCalc 合成） */
  attack: number;
  /** 技能伤害倍率 addDmg；0 视为不乘 */
  ratio: number;
  /** 技能波动幅度 dmgFluctuation；0 = 不波动（游戏里 0 就是完全不波动） */
  dmgFluctuation?: number;
  /** 攻击方暴击率 */
  critRate: number;
  /** 目标抗暴击（critResist，**不是**面板效果抵抗） */
  critResist?: number;
  /** 暴击倍率 critPower（面板 critDamage） */
  critDamage: number;
  /** 目标防御 */
  defense: number;
  /** ON_TRIGGER_CHANGE_DEF (1128–1244), applied after penetration. */
  defenseOverride?: (defense: number) => number;
  defenseReduction?: GameDefenseReduction;
  /** checkCardAttr('ignoreDefense') 的结果 */
  cardAttrIgnoresDefense?: boolean;
  /** 强制暴击（calcDmgParam.mustCrit，或间接伤害） */
  mustCrit?: boolean;
  /** 禁止暴击（calcDmgParam.noCrit） */
  noCrit?: boolean;
  /** getattr(entity,'hero_no_crit',False) */
  heroNoCrit?: boolean;
  /** 一次性标记 fromEntity.nextAttackCrit */
  nextAttackCrit?: boolean;
  /** 重伤判定 check_serious_injury */
  seriousInjury?: boolean;
  isIndirectDamage?: boolean;
  /** 攻击方 PvP 增伤（面板 PvpHurtAdditionRate） */
  pvpHurtAdditionRate?: number;
  /** 攻击方增伤（hurtAdditionRate） */
  hurtAdditionRate?: number;
  /** 额外增伤（calcDmgParam.hurtAdditionRateAdd） */
  hurtAdditionRateAdd?: number;
  /** 为真则跳过 hurtAdditionRate 段 */
  ignoreHurtAdditionRate?: boolean;
  /** 管线第 4 步：目标侧减伤率 */
  hurtReductionRate?: number;
  /** Target AttrComp reduction inside calcRawAttackDmg (1904–2012). */
  targetHurtReductionRate?: number;
  extAddCritPower?: number;
  extCritPower?: number;
  extDmgRate?: number;
  /** isRangeSkill(skillData['selectRange'])：本技能是否 AOE（range skill）。 */
  isRangeSkill?: boolean;
  /** helpers.isShieldEntity(target)：目标是否为"护盾实体"（由内容模块显式标记）。 */
  isShieldEntity?: boolean;
  /** 管线第 6 步：固定减伤 flat */
  fixedHurtReductionVal?: number;
  /** 直接替换最终伤害（damageReplace） */
  damageReplace?: number;
  /** 单次伤害上限（maxHurt） */
  maxHurt?: number;
  random: () => number;
}

export interface GameDamageResult {
  /** calcRawAttackDmg 的返回值 */
  rawDamage: number;
  /** 暴击结果 */
  critical: boolean;
  /** 实际参与 K/(K+def) 的防御（被清零时是 0） */
  defenseUsed: number;
  /** 记账：重伤溢伤计算所需的原始防御 */
  recordDefense: number;
  /** 第 4 步之后 */
  afterHurtReduction: number;
  /** 第 6 步之后（最终 hp_change） */
  hpChange: number;
  recordHurtReductionRate: number;
  recordIndirectHurtReductionRate: number;
}

function uniform(random: () => number, low: number, high: number): number {
  return low + (high - low) * random();
}

/**
 * 计算原始伤害（calcRawAttackDmg 的忠实移植）。不含闪避/护盾/反弹/吸血。
 */
export function calcRawAttackDmg(input: GameDamageInput): GameDamageResult {
  const red = input.defenseReduction ?? {};

  // ---- 暴击判定（240-306 / 418-456 / 1342-1384 的互斥链）----
  let critical: boolean;
  if (input.mustCrit) critical = true;
  else if (input.nextAttackCrit) critical = true;
  else if (input.noCrit) critical = false;
  else {
    const chance = input.critRate - (input.critResist ?? 0);
    critical = input.random() < chance;                 // simpleRandResult：rand < prob，不做 clamp
  }
  if (input.heroNoCrit) critical = false;

  // ---- 防御六段削减（600-1082），每段 floor 0 ----
  let defense = Math.max(0, input.defense);
  if (red.ignoreDefenseValue) defense = Math.max(defense - red.ignoreDefenseValue, 0);
  if (critical && red.ignoreDefenseValueWhenCrit) {
    defense = Math.max(defense - red.ignoreDefenseValueWhenCrit, 0);
  }
  if (red.ignoreDefense) defense = Math.max(defense - red.ignoreDefense, 0);
  if (input.cardAttrIgnoresDefense && red.breakDefense) {
    defense = Math.max(defense - red.breakDefense, 0);
  }
  if (red.ignoreDefanseRate) defense -= defense * red.ignoreDefanseRate;
  defense = Math.max(defense, 0);
  if (critical && red.psSkillIgnoreDefWhenCrit) {
    defense -= defense * red.psSkillIgnoreDefWhenCrit;
    defense = Math.max(defense, 0);
  }
  if (input.defenseOverride) defense = input.defenseOverride(defense);

  // ---- 重伤（1294-1346）----
  // 结论：重伤命中按 def=0 计算，并把清零前的防御记进 record_defense。
  // 依据（两条都不依赖跳转目标 ⇒ 不受本项目反汇编器缺陷影响；
  //       完整推导与复现命令见 yys-lineup/DISASM-JUMP-TARGETS.md）：
  //   ① 记账值 = 清零前的防御：1298-1326 的 `if defanse > 0:` 体内先
  //      STORE_ATTR record_defense = defanse，紧接 STORE_FAST defanse = 0
  //      （两条相邻且顺序固定，与跳转走向无关）。
  //   ② 消费方 make_serious_injury_overflow_value_defense 对溢伤做
  //      overflow_value *= K / (K + record_defense)（BINARY_OP 18 = *=），再依次回放
  //      record_hurt_reduction_rate / record_indirect_hurt_reduction_rate /
  //      record_target_hp_change_reduce_rate —— 只有「溢伤进入该函数时没乘过防御削减」
  //      才成立，否则同一份防御会被算两遍。
  //   ⇒ 重伤目标：直接伤害按 def=0 计并记账；普通目标：防御照常参与。
  //   （原注释称本项因反汇编器不区分 POP_JUMP_IF_TRUE/FALSE 而「按游戏语义定」，
  //     现已由上述两条替代，极性不再是未知项。附注：全库前向跳转目标经标定只有
  //     87% 落在指令边界，引用跳转结构前仍需复核。）
  let recordDefense = 0;
  if (input.seriousInjury) {
    critical = true;
    recordDefense = defense;
    defense = 0;
  } else if (input.isIndirectDamage) {
    critical = true;
  }
  if (input.heroNoCrit) critical = false;

  // ---- 基础伤害（1386-1508）----
  let raw = 0;
  if (DEFENSE_CORRECT_FACTOR + defense !== 0) {
    raw = input.attack * DEFENSE_CORRECT_FACTOR / (DEFENSE_CORRECT_FACTOR + defense);
  }

  // ---- 技能倍率（1514-1612）----
  if (input.ratio > 0) raw *= input.ratio;

  // ---- 波动（1638-1764）：为 0 则完全不波动 ----
  const fluct = input.dmgFluctuation ?? 0;
  if (fluct !== 0) raw *= 1 + uniform(input.random, -fluct, fluct);

  // ---- 增伤桶（1766-1856）----
  let hurtAdd = input.pvpHurtAdditionRate ?? 0;
  if (!input.ignoreHurtAdditionRate) {
    hurtAdd += (input.hurtAdditionRate ?? 0) + (input.hurtAdditionRateAdd ?? 0);
  }
  if (hurtAdd >= 0) raw *= 1 + hurtAdd;
  else raw /= 1 - hurtAdd; // 1860–1874

  if (input.damageReplace !== undefined) raw = input.damageReplace; // 1876–1902
  const targetReduction = input.targetHurtReductionRate ?? 0;
  const deferredTargetReduction = input.seriousInjury && targetReduction >= 0;
  raw = applyHurtReduction(raw, deferredTargetReduction ? 0 : targetReduction);

  // ---- 暴击倍率（2014–2058）----
  if (critical) raw *= input.critDamage + (input.extAddCritPower ?? 0); // 2014–2058; panel is 1 + critPower
  raw *= 1 + (input.extDmgRate ?? 0); // 2060–2084
  // ---- AOE 打护盾实体（2104–2180）----
  if (input.isRangeSkill && input.isShieldEntity) raw *= AOE_SKILL_TO_SHIELD_DMG_RATE;
  if (critical) raw *= 1 + (input.extCritPower ?? 0); // 2206–2248

  // ---- 替换（damageReplace）+ 上限 + 下限（2308-2322）----
  if (input.maxHurt !== undefined) raw = Math.min(raw, input.maxHurt);
  raw = Math.max(raw, 1.0);

  // ---- 管线第 4 步：减伤（712-744）----
  let afterReduction = raw;
  if (raw > 0) {
    const r = input.hurtReductionRate ?? 0;
    afterReduction = applyHurtReduction(raw, input.seriousInjury && r >= 0 ? 0 : r);
  }

  // ---- 管线第 6 步：固定减伤（doFixedReduction）----
  let hpChange = afterReduction;
  if (hpChange > 0) {
    hpChange = Math.max(0, hpChange - (input.fixedHurtReductionVal ?? 0));
  }

  return {
    rawDamage: raw,
    critical,
    defenseUsed: defense,
    recordDefense,
    afterHurtReduction: afterReduction,
    hpChange,
    recordHurtReductionRate: deferredTargetReduction ? targetReduction : 0,
    recordIndirectHurtReductionRate: input.seriousInjury && (input.hurtReductionRate ?? 0) >= 0 ? input.hurtReductionRate ?? 0 : 0,
  };
}

export function applyHurtReduction(damage: number, rate: number): number {
  return damage <= 0 ? damage : rate >= 0 ? damage / (1 + rate) : damage * (1 - rate);
}

/** calcExtHpAbsorb 106–414: extHp is consumed in rounded whole points. */
export function calcExtHpAbsorb(damage: number, extHp: number, absorptionRate = 1): { damage: number; consumed: number } {
  if (damage <= 0 || extHp <= 0 || absorptionRate <= 0) return { damage, consumed: 0 };
  const consumed = Math.min(extHp, Math.ceil(Math.abs(damage) / absorptionRate));
  return { damage: Math.max(0, damage - consumed * absorptionRate), consumed };
}

export interface GameAttackInput extends GameDamageInput {
  dodge?: number;
  damageImmune?: boolean;
  attackerDamageImmune?: boolean;
  shieldHp?: number;
  shieldDmgAddRate?: number;
  ignoreShield?: boolean;
  ignoreShieldCounter?: boolean;
  beIgnoreShield?: boolean;
  absorbAllDamage?: boolean;
  reboundRate?: number;
  leechRate?: number;
  campLeechRate?: number;
  extHp?: number;
  extHpAbsorptionRate?: number;
  before?: readonly ((input: GameAttackInput) => GameAttackInput)[];
  after?: readonly ((damage: number, critical: boolean) => number)[];
}

/** Ordered calcAttackDmg adapter. Hooks run before rolls and after raw damage respectively. */
export function calcAttackDmg(original: GameAttackInput) {
  let input = original;
  for (const hook of original.before ?? []) input = hook(input);
  const avoided = checkDodge(input.dodge ?? 0, input.random);
  const raw = avoided ? undefined : calcRawAttackDmg({ ...input, hurtReductionRate: 0, fixedHurtReductionVal: 0 });
  let damage = raw?.rawDamage ?? 0;
  for (const hook of input.after ?? []) damage = hook(damage, raw?.critical ?? false);
  const rate = input.hurtReductionRate ?? 0;
  damage = applyHurtReduction(damage, input.seriousInjury && rate >= 0 ? 0 : rate);
  if (damage > 0) damage = Math.max(0, damage - (input.fixedHurtReductionVal ?? 0));
  const hurtBeforeAbsorb = damage;
  const shield = input.ignoreShield || input.ignoreShieldCounter || input.beIgnoreShield
    ? { damage, consumeShield: 0 } : calcShieldAbsorb(damage, input.shieldHp ?? 0,
      input.shieldDmgAddRate ?? 0, input.absorbAllDamage);
  damage = input.damageImmune ? 0 : shield.damage;
  const reboundDamage = !input.attackerDamageImmune && (input.reboundRate ?? 0) > 0 && hurtBeforeAbsorb > 0
    ? Math.max(1, (input.reboundRate ?? 0) * hurtBeforeAbsorb) : 0;
  const leechDamage = Math.max(0, input.leechRate ?? 0) * (input.campLeechRate ?? 1) * damage;
  const ext = calcExtHpAbsorb(damage, input.extHp ?? 0, input.extHpAbsorptionRate);
  return { rawDamage: hurtBeforeAbsorb, damage: ext.damage, critical: raw?.critical ?? false, avoided,
    hurtBeforeAbsorb, consumeShield: shield.consumeShield, reboundDamage, leechDamage, consumeExtHp: ext.consumed,
    recordDefense: raw?.recordDefense ?? 0, recordHurtReductionRate: raw?.recordHurtReductionRate ?? 0,
    recordIndirectHurtReductionRate: input.seriousInjury && rate >= 0 ? rate : 0 };
}

/** 闪避判定（calcAttackDmg 386-454 使用的口径）。 */
export function checkDodge(dodge: number, random: () => number): boolean {
  return random() < dodge;               // simpleRandResult(prob, rng)[0]
}

/**
 * 护盾吸收（`calcShieldAbsorb` 的忠实移植）。
 *
 * 游戏侧语义（依据 `yys-lineup/out/disasm/com_utils_formula/calcShieldAbsorb.txt` 的块布局；
 * `shield_dmg_add_rate` 由 `calcAttackDmg.txt:870-884` 取自 `calcDmgParam.extShieldDmgRate`）：
 *   extHurt = rate × realHurt
 *   if extHurt > 0 and extHurt >= shield:  consume = shield ; shieldLeft = 0      # 盾被放大消耗打爆
 *   else:                                  consume = extHurt ; shieldLeft = shield − extHurt
 *   if realHurt > shieldLeft: consume += shieldLeft ; damage = realHurt − shieldLeft
 *   else:                     consume += realHurt   ; damage = 0
 * ⇒ **放大消耗先吃盾、且不挡伤害；只有剩余容量按 1:1 挡伤**。
 * 消耗量与旧实现恒等（`min(shield, realHurt + extHurt)`）；差别只在穿透量：
 * 旧实现让放大部分也去挡伤害，会**高估护盾**。
 * 例：(realHurt 3000, shield 2000, rate 0.5) → 官方 consume 2000 / damage 2500（旧实现给 1000）。
 */
export function calcShieldAbsorb(
  realHurt: number,
  shieldHp: number,
  shieldDmgAddRate = 0,
  absorbAllDamage = false,
): { damage: number; consumeShield: number } {
  if (absorbAllDamage) return { damage: 0, consumeShield: realHurt };
  const extHurt = realHurt * shieldDmgAddRate;
  const shieldLeft = extHurt > 0 && extHurt >= shieldHp ? 0 : Math.max(0, shieldHp - extHurt);
  const consume = Math.min(shieldHp, realHurt + extHurt);
  const damage = Math.max(0, realHurt - shieldLeft);
  return { damage, consumeShield: consume };
}
