import { soulCatalog } from '../../../../shared/soul-catalog-data';
import { heroSkillsCatalog } from '../../../../shared/hero-skills-data';
import type { ActiveMod, BattleFighterInput, Control, DuelBattleInput, DuelState, Fighter, FighterInput, ModStat, OrbMeter, SideId, StatusTag } from './types';
import type { HeroProfile, Panel, SuitProfile } from '../../../../shared/soul-optimizer';
import type { HeroSkill } from '../../../../shared/hero-skills';
import { advanceOrbMeter, initialOrbProgress } from './resources';
import { battleStatusLabel } from './status';

export type { BattleFighterInput, DuelBattleInput } from './types';

const statusLabel = (unit: Fighter): string => battleStatusLabel(unit, effectiveStat);

const heroes = [...soulCatalog.heroes] as HeroProfile[];
const suits = (soulCatalog.suits as SuitProfile[]).filter(suit => !suit.boss);
const blankPanel = (): Panel => ({ hp: 0, attack: 0, defense: 0, speed: 0, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
function buildModel(roster: FighterInput[], side: SideId): Fighter[] {
  const team: Fighter[] = roster.map((entry, index) => {
    const hero = heroes.find(item => item.id === entry.heroId)!;
    const panel = entry.panel ?? hero.base ?? blankPanel();
    return {
      ...panel, heroId: entry.heroId ?? -1, name: hero.name || `式神 ${index + 1}`, hpNow: entry.heroId === 344 ? panel.hp / 2 : panel.hp, side,
      lostHpTotal: 0, maxHpBonus: 0, flowerExtraTurnUsed: false, starfireOpeningSpeedPending: false,
      fourSuit: suits.find(suit => String(suit.id) === entry.fourSuit)?.name ?? '',
      skillLevel: entry.skillLevel, skills: heroSkillsCatalog.heroes[hero.id]?.skills ?? [],
      control: null, controlTurns: 0, shield: 0, effects: [],
      // Lv.4 行动条加成只在战斗开始后新增行动值时触发，开局资源不预填行动条。
      gauge: 0,
      swiftWindValue: hero.id === 357 && entry.skillLevel >= 5 ? 20 : 0,
      swiftWindCritDamage: 0,
      shanfengCritAdvanceUsed: false,
      shanfengBeastTurns: 0,
      herbs: (heroSkillsCatalog.heroes[hero.id]?.skills ?? []).some(skill => skill.name === '疗愈的药草') ? 4 : 0,
      frogCooldown: 0, foodStacks: 0,
      carrots: 0, remnantFlame: 0,
      herbHealBonus: 0, herbHealBonusTurns: 0,
      harmony: 0, harmonyProgress: 0, harmonyAllies: [],
      opponents: [],
      talismans: (heroSkillsCatalog.heroes[hero.id]?.skills ?? []).some(skill => skill.name === '魔力追踪') && entry.skillLevel >= 5 ? 1 : 0,
      spellUsed: false, dealtDamageThisTurn: false, guardedAttack: false,
      heartFlames: (heroSkillsCatalog.heroes[hero.id]?.skills ?? []).some(skill => skill.name === '灵合') && entry.skillLevel >= 5 ? 3 : 0,
      foxSameTargetCount: 0, hiddenIntentStep: 0, bladeStacks: 0,
      fiveMountainAttackCount: 0, fiveMountainDefenseIgnoreStacks: 0,
      mikuOpeningUsed: false, vigilanceLayers: 0, shinkenBondUsed: false,
      mikuRhythm: 0, cloudYang: hero.id === 344 && panel.attack <= panel.defense * 5,
      cloudYinHp: hero.id === 344 ? panel.hp / 2 : 0, cloudYangHp: hero.id === 344 ? panel.hp / 2 : 0,
      cloudFlipCost: 0, inabaWishPower: 0, inabaWishProvided: 0,
      bellDivineFire: false, bellFireReady: false, bellFireCooldown: 0, bellEternalFlame: false,
      catTeacherOnceAvailable: true, catTeacherKnockbackNext: false,
      oniStanceTurns: 0, oniStanceEnteredThisTurn: false, oniStanceDamage: 0,
      divinePower: 0, birdDamageBonus: 0, permanentDamageBonus: 0, woodCharmTriggered: false,
      bondOwnerBoostUsed: false, bondTargetBoostUsed: false,
      himeFireTriggeredThisAction: false,
      tags: [
        ...(hero.id === 346 && (heroSkillsCatalog.heroes[hero.id]?.skills ?? []).some(skill => skill.name === '凌波')
          ? Array.from({ length: 4 }, () => ({ name: '凝神', turns: 999 })) : []),
        ...((heroSkillsCatalog.heroes[hero.id]?.skills ?? []).some(skill => skill.name === '清辉月华') ? [{ name: '庇护', turns: 1 }] : []),
        ...(hero.id === 390 && entry.skillLevel >= 4 ? [{ name: '命运星河', turns: 999 }] : []),
        ...(hero.id === 344 ? [{ name: '镜盾', turns: 2, shieldRemaining: panel.defense * 6.8 }] : []),
        ...((heroSkillsCatalog.heroes[hero.id]?.skills ?? []).some(skill => skill.name === '灵合') && entry.skillLevel >= 5
          ? [{ name: '灵狐守护', turns: 1, shieldRemaining: panel.attack * Number(/灵狐守护提高至攻击(\d+(?:\.\d+)?)%/.exec((heroSkillsCatalog.heroes[hero.id]?.skills ?? []).find(skill => skill.name === '灵合')?.upgrades[0] ?? '')?.[1] ?? 90) / 100 }]
          : []),
      ],
    };
  });
  for (const unit of team) unit.harmonyAllies = team;
  // AI-visible battle-start passives used by several shikigami policies.
  for (const unit of team) {
    if (unit.heroId === 570) {
      for (let layer = 0; layer < 7; layer++) unit.tags.push({ name: '咒纱', turns: 999 });
    }
    if (unit.heroId === 585) {
      const flowerBearer = team.filter(ally => ally.hpNow > 0).slice()
        .sort((a, b) => effectiveStat(b, 'attack') - effectiveStat(a, 'attack'))[0];
      if (flowerBearer && !flowerBearer.tags.some(tag => tag.name === '血色之花')) {
        flowerBearer.tags.push({ name: '血色之花', turns: 999 });
      }
    }
  }
  return team;
}

function controlType(text: string): Control | null {
  return (['眩晕', '冰冻', '睡眠', '沉默', '混乱', '嘲讽', '封印'] as Control[]).find(type => text.includes(type)) ?? null;
}

function passiveActive(unit: Fighter): boolean {
  return !unit.tags.some(tag => tag.name === '鬼面' || tag.name === '被动压制');
}

function activeSoul(unit: Fighter): string {
  return unit.tags.some(tag => tag.name === '鬼面' || tag.name === '御魂封印') ? '' : unit.fourSuit;
}

function skillText(skill: HeroSkill, level: number): string {
  let text = skill.description.replace(/\r\n?/g, '\n');
  text = text.includes('【施放】') ? text.split('【施放】').pop()!.trim() : text;
  const upgrade = skill.upgrades[level - 2];
  const foxDamageUpgrade = skill.name === '狐惑魅影'
    ? [...skill.upgrades.slice(0, Math.max(0, level - 1))].reverse().find(item => /伤害均提升至攻击\d+(?:\.\d+)?%/.test(item))
    : undefined;
  const syaoranDamageUpgrade = skill.name === '雷帝招来'
    ? [...skill.upgrades.slice(0, Math.max(0, level - 1))].reverse().find(item => /伤害(?:增加至|增至|提升至)\d+(?:\.\d+)?%/.test(item))
    : undefined;
  const amountUpgrade = foxDamageUpgrade ?? syaoranDamageUpgrade ?? upgrade;
  const amount = amountUpgrade && /(?:伤害|治疗|恢复|护盾|生命上限)[^\d]{0,12}(\d+(?:\.\d+)?)%/.exec(amountUpgrade);
  const upgradedDamageRatios = upgrade
    ? [...upgrade.matchAll(/(?:伤害|间接伤害)[^\d]{0,12}(\d+(?:\.\d+)?)%/g)].map(match => match[1])
    : [];
  if (upgradedDamageRatios.length > 1 && /攻击(?:力)?(?:的)?\d+(?:\.\d+)?%(?:的)?(?:间接)?伤害/.test(text)) {
    let ratioIndex = 0;
    text = text.replace(/(攻击(?:力)?(?:的)?)(\d+(?:\.\d+)?%)(的)?(间接)?(伤害)/g, (_match, prefix: string, _ratio: string, 的: string | undefined, indirect: string | undefined, suffix: string) => {
      const upgraded = upgradedDamageRatios[Math.min(ratioIndex++, upgradedDamageRatios.length - 1)];
      return `${prefix}${upgraded}%${的 ?? ''}${indirect ?? ''}${suffix}`;
    });
  } else if (amount && /攻击(?:力)?(?:的)?\d+(?:\.\d+)?%(?:的)?伤害/.test(text)) {
    text = text.replace(/(攻击(?:力)?(?:的)?)(\d+(?:\.\d+)?)%(的)?(伤害)/, `$1${amount[1]}%$3$4`);
  } else if (upgrade) {
    text += `\n${upgrade.replace(/^Lv\.\d+/, '').trim()}`;
  }
  if (skill.name === '狐惑魅影' && amount) {
    text = text.replace(/(攻击(?:力)?(?:的)?)(\d+(?:\.\d+)?)%(的)?(?=(?:间接)?伤害)/g, `$1${amount[1]}%$3`);
  }
  return text;
}

function skillCost(skill: HeroSkill, level: number, attacker?: Fighter): number {
  const upgrades = skill.upgrades.slice(0, Math.max(0, level - 1));
  const inTimeGap = attacker?.tags.some(tag => tag.name === '时之隙') ?? false;
  const reduction = [...upgrades].reverse().map(item => {
    if (/(?:在时之隙施放|时之隙中)/.test(item) && !inTimeGap) return undefined;
    return /(?:鬼火消耗减少|消耗鬼火减少)(\d+)点/.exec(item)?.[1];
  }).find(Boolean);
  const ofudaReduction = attacker?.heroId === 588 && skill.name === '雷帝招来' ? attacker.talismans : 0;
  const cloudFlipCost = attacker?.heroId === 344 && ['斗转', '昭回'].includes(skill.name) ? attacker.cloudFlipCost : 0;
  const inabaWishDiscount = attacker?.heroId === 372 && skill.name === '愿满夜'
    && attacker.tags.some(tag => tag.name === '愿满夜减耗') ? 1 : 0;
  return Math.max(0, skill.cost - Number(reduction ?? 0) - ofudaReduction - inabaWishDiscount + cloudFlipCost);
}

function applyResonanceWall(target: Fighter, turns = 2): void {
  const walls = target.tags.filter(tag => tag.name === '共鸣之墙');
  // The wall is a two-stack mark. Each stack absorbs critical damage up to
  // 8,000 times the wearer's initial Effect RES, not ordinary damage.
  if (walls.length >= 2) {
    for (const wall of walls) wall.turns = Math.max(wall.turns, turns);
    return;
  }
  target.tags.push({ name: '共鸣之墙', turns, absorbRemaining: Math.max(0, target.resist * 8000) });
}

function applyControl(attacker: Fighter, target: Fighter, control: Control, chance: number, random: () => number, battleLog?: string[]): void {
  if (target.bellEternalFlame) return;
  if (target.heroId === 323 && (target.tags.some(tag => tag.name === '欢愉') || target.tags.some(tag => tag.name === '妖怪屋清醒'))) {
    battleLog?.push(`  ${fighterLabel(target)}处于妖怪屋清醒状态，免疫${control}。`);
    return;
  }
  if (target.tags.some(tag => tag.name === '庇护' || tag.name === '灵狐守护') || (passiveActive(target) && target.skills.some(skill => skill.name === '红莲'))) return;
  const beforeControl = target.control;
  const rawChance = Math.max(0, Math.min(1, chance * (1 + Math.max(0, effectiveStat(attacker, 'hit')))));
  const effective = rawChance * (1 - Math.min(.95, Math.max(0, effectiveStat(target, 'resist'))));
  const roll = random();
  if (roll < effective) {
    target.control = control;
    target.controlTurns = 1;
    recordDebuff(target);
    if (!beforeControl && activeSoul(target) === '骰子鬼') {
      const pushed = changeActionBar(target, 25, attacker);
      if (pushed) battleLog?.push(`  骰子鬼触发：${fighterLabel(target)}受到控制时行动条推进25%。`);
    }
    for (const ally of target.harmonyAllies.filter(unit => unit.hpNow > 0 && activeSoul(unit) === '三味')) {
      const stacks = ally.effects.filter(effect => effect.source === '三味·速度').length;
      if (stacks < 2) {
        ally.effects.push({ stat: 'speed', amount: 30, turns: 2, flat: true, source: '三味·速度' });
        battleLog?.push(`  三味触发：${fighterLabel(ally)}速度提高30点（${stacks + 1}/2层），持续2回合。`);
      }
    }
    return;
  }
  // Only a failure within the RES reduction band counts as a resisted effect.
  if (roll < rawChance) {
    if (activeSoul(target) === '骰子鬼' && attacker.hpNow > 0) {
      const counter = Math.max(1, effectiveStat(target, 'attack') * .125 * 1.5 * 1000 / (1000 + Math.max(0, effectiveStat(attacker, 'defense'))));
      attacker.hpNow -= counter;
      battleLog?.push(`  骰子鬼抵抗反击：${fighterLabel(target)}对${fighterLabel(attacker)}造成 ${Math.round(counter)} 点伤害。`);
    }
    if (activeSoul(target) === '幽谷响' && random() < .5
      && !attacker.tags.some(tag => tag.name === '庇护' || tag.name === '灵狐守护')
      && !attacker.skills.some(skill => skill.name === '红莲')) {
      attacker.control = control;
      attacker.controlTurns = 1;
      recordDebuff(attacker);
      battleLog?.push(`  幽谷响触发：${fighterLabel(target)}抵抗${control}后将其反弹给${fighterLabel(attacker)}。`);
    }
  }
}

function recordDebuff(target: Fighter): void {
  for (const singer of target.harmonyAllies) {
    if (!passiveActive(singer) || !singer.skills.some(skill => skill.name === '和音回响') || singer.hpNow <= 0 || singer.harmony >= 5) continue;
    singer.harmonyProgress++;
    if (singer.harmonyProgress >= 3) {
      singer.harmonyProgress -= 3;
      singer.harmony = Math.min(5, singer.harmony + 1);
    }
  }
}

function removeControl(target: Fighter, battleLog?: string[]): Control | null {
  const removed = target.control;
  if (!removed) return null;
  target.control = null;
  target.controlTurns = 0;
  if (target.heroId === 296 && passiveActive(target) && target.hpNow > 0) {
    const lostEnemy = target.opponents.some(enemy => enemy.hpNow > 0 && enemy.hpNow / currentMaxHp(enemy) < .35);
    const pushed = changeActionBar(target, target.skillLevel >= 5 && lostEnemy ? 70 : 35, target);
    const beastBonus = target.skillLevel >= 4 ? .25 : target.skillLevel >= 3 ? .2 : target.skillLevel >= 2 ? .15 : .1;
    target.effects = target.effects.filter(effect => effect.source !== '山风·困兽');
    target.effects.push({ stat: 'attack', amount: beastBonus, turns: 1, source: '山风·困兽' });
    target.effects.push({ stat: 'resist', amount: .5, turns: 1, source: '山风·困兽' });
    battleLog?.push(`  山风「烈」触发：脱离控制，行动条推进${Math.round(pushed)}%，获得困兽（攻击+${Math.round(beastBonus * 100)}%、效果抵抗+50%），持续1回合。`);
  }
  if (target.heroId === 357 && target.hpNow > 0) {
    const consumed = Math.min(60, target.swiftWindValue);
    target.swiftWindValue -= consumed;
    const advanced = changeActionBar(target, 30 + consumed, target);
    if (advanced) battleLog?.push(`  初翎山风「令」触发：控制消失，行动条推进${Math.round(advanced)}%（迅风消耗${consumed}，剩余${target.swiftWindValue}）。`);
  }
  if (passiveActive(target) && target.skills.some(skill => skill.name === '和音回响') && target.skillLevel >= 2) {
    const speed = target.skillLevel >= 3 ? 60 : 40;
    target.effects = target.effects.filter(effect => effect.source !== '和音回响·脱控');
    target.effects.push({ stat: 'speed', amount: speed, flat: true, turns: 1, source: '和音回响·脱控' });
    battleLog?.push(`  ${fighterLabel(target)}脱离控制，「和音回响」使速度提高${speed}点，持续1回合。`);
  }
  return removed;
}

function effectiveStat(unit: Fighter, stat: ModStat): number {
  const base = stat === 'damage' ? 1 : stat === 'critResist' ? 0 : unit[stat];
  let amount = unit.effects.filter(effect => effect.stat === stat && !effect.flat).reduce((sum, effect) => sum + effect.amount, 0);
  let flat = unit.effects.filter(effect => effect.stat === stat && effect.flat).reduce((sum, effect) => sum + effect.amount, 0);
  if (stat === 'damage' && unit.harmonyAllies.some(ally => ally.hpNow > 0 && ally.heroId === 323
    && (ally.tags.some(tag => tag.name === '欢愉') || ally.tags.some(tag => tag.name === '妖怪屋清醒')))) {
    const tianjing = unit.harmonyAllies.find(ally => ally.hpNow > 0 && ally.heroId === 323)!;
    amount += tianjing.skillLevel >= 4 ? .2 : tianjing.skillLevel >= 2 ? .15 : .1;
  }
  if (stat === 'resist' && unit.heroId === 323
    && (unit.tags.some(tag => tag.name === '欢愉') || unit.tags.some(tag => tag.name === '妖怪屋清醒'))) amount += .75;
  if (stat === 'speed' && unit.heroId === 563) flat += unit.mikuRhythm * 10;
  if (stat === 'resist' && unit.heroId === 372 && passiveActive(unit) && unit.tags.some(tag => tag.name === '因幡辉夜姬幻境')) amount += .8;
  if (stat === 'critDamage' && unit.heroId === 372 && unit.skillLevel >= 2) amount += Math.min(1.2, unit.inabaWishProvided * .05);
  if (stat === 'attack' && unit.heroId === 344 && !unit.cloudYang) flat += unit.defense * 2;
  if (stat === 'defense' && unit.heroId === 344 && unit.cloudYang) amount += .1;
  if (stat === 'damage') amount += unit.tags.reduce((sum, tag) => sum + (tag.damageBonus ?? 0), 0);
  if (stat === 'damage') amount -= unit.tags.filter(tag => tag.name === '符咒·破').length * .3;
  if (stat === 'speed' && unit.heroId === 241 && passiveActive(unit)) {
    const lowestAllyRatio = Math.min(...unit.harmonyAllies.filter(ally => ally.hpNow > 0)
      .map(ally => ally.hpNow / currentMaxHp(ally)));
    flat += Math.min(3, Math.floor((1 - lowestAllyRatio + 1e-9) / .3)) * 10;
  }
  if (stat === 'defense' && unit.heartFlames > 0) amount += unit.heartFlames * .15;
  if (stat === 'resist') amount += unit.herbs * .1;
  if (stat === 'resist' && activeSoul(unit) === '遗念火') amount += unit.remnantFlame * .15;
  if (stat === 'attack' && unit.harmonyAllies.some(ally => ally.hpNow > 0 && passiveActive(ally) && ally.herbs >= 4 && ally.skillLevel >= 5 && ally.skills.some(skill => skill.name === '疗愈的药草'))) amount += .24;
  if (stat === 'attack' && unit.heroId === 370 && passiveActive(unit)) amount += unit.foodStacks * .1;
  if (stat === 'critDamage' && unit.heroId === 370 && passiveActive(unit)) amount += unit.foodStacks * .05;
  if (stat === 'attack') amount -= Math.min(3, unit.tags.filter(tag => tag.name === '业障').length) * .05;
  return stat === 'attack' || stat === 'defense' || stat === 'speed' ? Math.max(0, base * (1 + amount) + flat) : Math.max(0, base + amount + flat);
}

function actionSpeed(unit: Fighter): number {
  const speed = effectiveStat(unit, 'speed');
  // 先机星火结界会在首轮队列建立后生效；录像里不知火队的前两名
  // 仍按面板速度行动，追月神与天井下同速竞争，先机加速只影响首动之后。
  return Math.max(1, speed - (unit.starfireOpeningSpeedPending ? 25 : 0));
}

function addTimedShield(unit: Fighter, amount: number, name: string, turns = 1): void {
  if (amount > 0) unit.tags.push({ name, turns, shieldRemaining: amount });
}

function addMikuRhythm(miku: Fighter, battleLog?: string[]): void {
  const before = miku.mikuRhythm;
  miku.mikuRhythm = Math.min(5, miku.mikuRhythm + 1);
  if (miku.mikuRhythm === before) return;
  const shieldCap = miku.hp * .35;
  for (const ally of miku.harmonyAllies.filter(unit => unit.hpNow > 0)) {
    const current = ally.tags.filter(tag => tag.name === '心之弦').reduce((sum, tag) => sum + (tag.shieldRemaining ?? 0), 0);
    const amount = Math.min(miku.hp * .05, Math.max(0, shieldCap - current));
    if (amount > 0) addTimedShield(ally, amount, '心之弦', 2);
  }
  battleLog?.push(`  初音未来获得1层节奏（${miku.mikuRhythm}/5），速度+10、受到伤害降低12%；友方获得心之弦护盾（上限初音生命35%）。`);
}

function changeActionBar(target: Fighter, delta: number, source?: Fighter): number {
  // Fuyuan ignores bar manipulation from other targets; her bound ally also
  // cannot be pushed back. Her own skill may still move her bar.
  if (source && target !== source && target.bondedAlly !== source && target.skills.some(skill => skill.name === '守缘刃')) return 0;
  if (delta < 0 && target.bondedAlly) return 0;
  const before = target.gauge;
  target.gauge = Math.max(0, Math.min(100, target.gauge + delta));
  return target.gauge - before;
}

function healingMultiplier(unit: Fighter): number {
  const reduction = unit.tags.reduce((sum, tag) => sum + (tag.healingReduction ?? 0), 0);
  const oniReduction = passiveActive(unit) && unit.skills.some(skill => skill.name === '红莲')
    ? unit.skillLevel >= 4 ? .3 : unit.skillLevel >= 2 ? .4 : .5 : 0;
  return Math.max(0, 1 - Math.min(1, reduction + oniReduction));
}

function applyHealing(healer: Fighter, target: Fighter, baseAmount: number, battleLog?: string[]): number {
  const targetRatio = target.hpNow / currentMaxHp(target);
  const treeBonus = activeSoul(healer) === '树妖' ? targetRatio < .2 ? .5 : .2 : 0;
  const healing = Math.max(0, baseAmount * (1 + treeBonus) * healingMultiplier(target));
  if (target.heroId === 344) {
    addTimedShield(target, healing * .5, '镜中世界治疗护盾', 2);
    battleLog?.push(`  云外镜「镜中世界」将治疗转化为${Math.round(healing * .5)}点护盾。`);
    return 0;
  }
  const before = target.hpNow;
  target.hpNow = Math.min(currentMaxHp(target), target.hpNow + healing);
  if (target.bellEternalFlame && target.hpNow >= currentMaxHp(target) - 1e-7) leaveBellEternalFlame(target, battleLog);
  if (target.bellDivineFire && target.bellFireCooldown === 0 && target.hpNow >= currentMaxHp(target) - 1e-7 && !target.control) {
    target.bellFireReady = true;
  }
  if (activeSoul(healer) === '珍珠' && baseAmount > 0) {
    addTimedShield(target, baseAmount * .3, '珍珠护盾', 2);
    battleLog?.push(`  珍珠为${fighterLabel(target)}增加 ${Math.round(baseAmount * .3)} 点护盾，持续2回合。`);
  }
  if (healer.heroId === 200 && passiveActive(healer) && healer.skills.some(skill => skill.name === '花之馨息') && healing > 0) {
    target.tags = target.tags.filter(tag => tag.name !== '盛开');
    target.tags.push({ name: '盛开', turns: 1 });
    for (const ally of healer.harmonyAllies.filter(unit => unit.hpNow > 0 && unit !== target)) {
      const extra = Math.min(currentMaxHp(ally) - ally.hpNow, healing * .3 * healingMultiplier(ally));
      if (extra > 0) ally.hpNow += extra;
      battleLog?.push(`  桃花妖「花之馨息」为${fighterLabel(ally)}额外治疗 ${Math.round(extra)} 点生命。`);
    }
    battleLog?.push(`  ${fighterLabel(target)}获得盛开，持续1回合。`);
  }
  return Math.max(0, target.hpNow - before);
}

function applyRestoration(target: Fighter, amount: number, battleLog?: string[]): number {
  const before = target.hpNow;
  target.hpNow = Math.min(currentMaxHp(target), target.hpNow + Math.max(0, amount));
  if (target.bellEternalFlame && target.hpNow >= currentMaxHp(target) - 1e-7) leaveBellEternalFlame(target, battleLog);
  if (target.bellDivineFire && target.bellFireCooldown === 0 && target.hpNow >= currentMaxHp(target) - 1e-7 && !target.control) {
    target.bellFireReady = true;
  }
  return Math.max(0, target.hpNow - before);
}

function cleanseRandomDebuff(team: Fighter[], side: SideId, random: () => number, battleLog?: string[]): boolean {
  const candidates = team.filter(unit => unit.side === side && unit.hpNow > 0
    && (unit.control || unit.effects.some(effect => effect.amount < 0)
      || unit.tags.some(tag => tag.hpReduction !== undefined || tag.healingReduction !== undefined || tag.delayedDamage || tag.foxSeal || tag.redMapleDoll)));
  if (!candidates.length) return false;
  const target = candidates[Math.floor(random() * candidates.length)]!;
  const removable: Array<() => string> = [];
  if (target.control) removable.push(() => removeControl(target, battleLog)!);
  for (let index = 0; index < target.effects.length; index++) if (target.effects[index]!.amount < 0) {
    const effect = target.effects[index]!;
    removable.push(() => { const current = target.effects.indexOf(effect); if (current >= 0) target.effects.splice(current, 1); return statusLabel({ ...target, effects: [effect] }); });
  }
  for (let index = 0; index < target.tags.length; index++) {
    const tag = target.tags[index]!;
    if (tag.hpReduction === undefined && tag.healingReduction === undefined && !tag.delayedDamage && !tag.foxSeal && !tag.redMapleDoll) continue;
    removable.push(() => { const current = target.tags.indexOf(tag); if (current >= 0) target.tags.splice(current, 1); return tag.name; });
  }
  const removed = removable[Math.floor(random() * removable.length)]?.();
  if (removed) battleLog?.push(`  共潜驱散：${fighterLabel(target)}的${removed}。`);
  return Boolean(removed);
}

function triggerCatTeacher(catTeacher: Fighter, random: () => number, battleLog?: string[], fire?: { blue: number; red: number }): void {
  if (!catTeacher.skills.some(skill => skill.name === '猫老师的守护') || !catTeacher.catTeacherOnceAvailable || catTeacher.hpNow <= 0) return;
  catTeacher.catTeacherOnceAvailable = false;
  catTeacher.woodCharmTriggered = false;
  catTeacher.guardedAttack = false;
  catTeacher.guardedTarget = undefined;
  catTeacher.guardOwner = undefined;
  const knockback = catTeacher.catTeacherKnockbackNext;
  catTeacher.catTeacherKnockbackNext = !knockback;
  battleLog?.push(`  猫老师变身为斑${knockback ? '（本次攻击击退行动条）' : ''}，攻击敌方全体3次。`);
  for (let hit = 0; hit < 3; hit++) {
    for (const enemy of catTeacher.opponents.filter(unit => unit.hpNow > 0)) {
      const damage = resolveHit(catTeacher, enemy, .45, random, 0, true, 0, catTeacher.skillLevel >= 5, battleLog, fire);
      if (knockback) changeActionBar(enemy, -5, catTeacher);
      battleLog?.push(`  斑第${hit + 1}段攻击${fighterLabel(enemy)}造成 ${Math.round(damage)} 点伤害${knockback ? '，行动条-5%' : ''}。`);
    }
  }
}

function triggerRedMapleExplosion(deadTarget: Fighter, battleLog?: string[]): void {
  if (!deadTarget.tags.some(tag => tag.redMapleDoll)) return;
  const queue = [deadTarget];
  while (queue.length) {
    const victim = queue.shift()!;
    if (!victim.tags.some(tag => tag.redMapleDoll)) continue;
    const maples = victim.opponents.filter(unit => unit.skills.some(skill => skill.name === '爆炸之咒'));
    const dolls = victim.harmonyAllies.flatMap(unit => unit.tags.filter(tag => tag.redMapleDoll).map(tag => ({ unit, tag })));
    if (!maples.length || !dolls.length) continue;
    for (const { unit, tag } of dolls) unit.tags = unit.tags.filter(candidate => candidate !== tag);
    for (const { unit, tag } of dolls) {
      for (const target of victim.harmonyAllies.filter(candidate => candidate.hpNow > 0)) {
        const damage = (tag.redMapleDoll?.attack ?? maples[0].attack) * (tag.redMapleDoll?.ratio ?? .42);
        const timedShields = target.tags.filter(candidate => (candidate.shieldRemaining ?? 0) > 0);
        let remaining = damage;
        for (const shield of timedShields) {
          const absorbed = Math.min(remaining, shield.shieldRemaining ?? 0);
          shield.shieldRemaining = Math.max(0, (shield.shieldRemaining ?? 0) - absorbed);
          remaining -= absorbed;
          if (remaining <= 0) break;
        }
        target.tags = target.tags.filter(candidate => (candidate.shieldRemaining ?? 0) > 0 || !('shieldRemaining' in candidate));
        const absorbedByNormalShield = Math.min(target.shield, remaining);
        target.shield -= absorbedByNormalShield;
        const actual = Math.max(0, remaining - absorbedByNormalShield);
        target.hpNow -= actual;
        if (target.hpNow <= 0) enterBellEternalFlame(target);
        if (target.hpNow <= 0) notifyBellAllyDeath(target);
        battleLog?.push(`  红枫娃娃引爆：${fighterLabel(target)}受到 ${Math.round(actual)} 点间接伤害。`);
        if (target.hpNow <= 0 && target.tags.some(candidate => candidate.redMapleDoll)) queue.push(target);
      }
    }
  }
}

function triggerRedMapleCurse(target: Fighter, random: () => number, battleLog?: string[]): void {
  const dolls = target.tags.filter(tag => tag.redMapleDoll);
  for (const doll of dolls) {
    const mark = doll.redMapleDoll!;
    if (target.hpNow <= 0 || random() >= mark.curseChance) continue;
    const beforeHp = target.hpNow;
    const damage = Math.min(beforeHp * mark.curseRatio, mark.attack * 2.5);
    const dealt = applyTrueDamage(target, damage);
    battleLog?.push(`  红枫娃娃诅咒触发：${fighterLabel(target)}普攻后受到${Math.round(mark.curseRatio * 100)}%当前生命的间接伤害${mark.attack * 2.5 <= beforeHp * mark.curseRatio ? `（上限${Math.round(mark.attack * 2.5)}）` : ''}，实际${Math.round(dealt)}。`);
    if (target.hpNow <= 0) triggerRedMapleExplosion(target, battleLog);
  }
}

function applySkillModifiers(text: string, attacker: Fighter, allies: Fighter[], targets: Fighter[]): void {
  const durationMatch = /持续(\d+)回合/.exec(text);
  const duration = durationMatch ? Math.max(1, Math.min(5, Number(durationMatch[1]))) : 2;
  const stats: Array<[ModStat, RegExp]> = [
    ['attack', /攻击力?|攻击/], ['defense', /防御力?|防御/], ['speed', /速度/],
    ['critDamage', /暴击伤害|暴伤/], ['crit', /暴击/], ['hit', /效果命中/], ['resist', /效果抵抗/],
  ];
  for (const clause of text.split(/[。；\n]/)) {
    if (/治疗量|治疗效果|治疗增加/.test(clause) && /攻击的\d+(?:\.\d+)?%/.test(clause)) continue;
    const up = /提升|提高|增加|增强|上升/.test(clause);
    const down = /降低|下降|减少|削弱/.test(clause);
    if (!up && !down) continue;
    const amountMatch = /(\d+(?:\.\d+)?)%/.exec(clause);
    if (!amountMatch) continue;
    const amount = Number(amountMatch[1]) / 100 * (up ? 1 : -1);
    const recipients = /自身|自己/.test(clause) ? [attacker]
      : /敌方|敌人|目标/.test(clause) || down ? targets
        : /友方|队友|己方/.test(clause) ? (/全体/.test(clause) ? allies.filter(unit => unit.hpNow > 0) : [allies.filter(unit => unit.hpNow > 0).sort((a, b) => a.hpNow / currentMaxHp(a) - b.hpNow / currentMaxHp(b))[0]].filter((unit): unit is Fighter => Boolean(unit)))
          : [attacker];
    for (const [stat, pattern] of stats) {
      if (!pattern.test(clause)) continue;
      for (const recipient of recipients) if (recipient) {
        const mirrorAnger = amount > 0 ? recipient.tags.find(tag => tag.name === '镜怒') : undefined;
        if (mirrorAnger) {
          recipient.tags = recipient.tags.filter(tag => tag !== mirrorAnger);
          continue;
        }
        if (recipient.bellEternalFlame && amount < 0) continue;
        recipient.effects.push({ stat, amount, turns: duration });
        if (amount < 0) recordDebuff(recipient);
      }
      break;
    }
  }
}

function applyActionBarEffects(text: string, attacker: Fighter, allies: Fighter[], targets: Fighter[], battleLog?: string[]): boolean {
  let handled = false;
  for (const clause of text.split(/[。；\n]/)) {
    // Skill descriptions use several word orders (e.g. “增加自身30%行动条”
    // and “使指定友方目标提升20%行动条”). Match the effect amount first, then
    // interpret the recipient separately so these effects actually enter the queue.
    const match = /(?:增加|提升|推进|击退|降低|减少)[^。；\n]{0,24}?(\d+(?:\.\d+)?)%行动条/.exec(clause);
    if (!match) continue;
    handled = true;
    const value = Number(match[1]);
    const delta = /击退|降低|减少/.test(clause) ? -value : value;
    const recipients = /自身|自己/.test(clause) ? [attacker]
      : /友方全体|己方全体/.test(clause) ? allies.filter(unit => unit.hpNow > 0)
        : /友方|己方|队友/.test(clause) ? [allies.filter(unit => unit.hpNow > 0).sort((a, b) => a.gauge - b.gauge)[0]].filter((unit): unit is Fighter => Boolean(unit))
          : /击退|敌方|敌人|目标/.test(clause) ? targets : [attacker];
    for (const recipient of recipients) {
      const applied = changeActionBar(recipient, delta, attacker);
      if (applied) battleLog?.push(`  ${fighterLabel(recipient)}行动条${applied >= 0 ? '推进' : '击退'} ${Math.abs(applied)}%，当前 ${Math.round(recipient.gauge)}%。`);
    }
  }
  return handled;
}

function initializeActionBar(team: Fighter[], allies: Fighter[], enemies: Fighter[], battleLog?: string[]): void {
  for (const unit of team) {
    for (const skill of unit.skills) {
      let text = skill.description;
      const upgrade = skill.upgrades[unit.skillLevel - 2];
      if (upgrade) text += `\n${upgrade.replace(/^Lv\.\d+/, '').trim()}`;
      // “先机” and explicit start-of-battle action-bar effects happen before
      // the first speed-based turn; ordinary reactive clauses remain dormant.
      const opening = text.split(/[。；\n]/).filter(clause => /先机|战斗开始时/.test(clause) && /%行动条/.test(clause));
      if (opening.length) applyActionBarEffects(opening.join('。').replace(/先机[：:]?/g, ''), unit, allies, enemies, battleLog);
    }
  }
}

function applyStarfireDomain(owner: Fighter, team: Fighter[], fire: number, battleLog?: string[]): void {
  const damageBonus = .1 + (owner.skillLevel >= 3 ? Math.max(0, fire) * .02 : 0);
  const damageReduction = damageBonus;
  for (const ally of team.filter(unit => unit.hpNow > 0)) {
    ally.effects = ally.effects.filter(effect => effect.source !== '星火满天');
    ally.effects.push({ stat: 'speed', amount: 25, flat: true, turns: 2, source: '星火满天' });
    ally.effects.push({ stat: 'damage', amount: damageBonus, turns: 2, source: '星火满天' });
    ally.tags = ally.tags.filter(tag => tag.name !== '星火结界');
    ally.tags.push({ name: '星火结界', turns: 2, damageReduction, starfireLevel: owner.skillLevel });
    ally.starfireOpeningSpeedPending = true;
  }
  battleLog?.push(`  不知火「星火满天」建立2回合结界：友方速度+25、伤害提高${Math.round(damageBonus * 100)}%、受到伤害降低${Math.round(damageReduction * 100)}%。`);
}

function applyHimeIllusion(owner: Fighter, team: Fighter[], battleLog?: string[]): void {
  owner.tags = owner.tags.filter(tag => tag.name !== '辉夜姬幻境');
  owner.tags.push({ name: '辉夜姬幻境', turns: 2 });
  for (const ally of team.filter(unit => unit.hpNow > 0)) {
    ally.effects = ally.effects.filter(effect => effect.source !== '辉夜姬幻境');
    ally.effects.push({ stat: 'defense', amount: .15, turns: 2, source: '辉夜姬幻境' });
    ally.effects.push({ stat: 'resist', amount: .1, turns: 2, source: '辉夜姬幻境' });
  }
  battleLog?.push(`先机｜${fighterLabel(owner)}无消耗施放「龙首之玉」，友方全体防御提高15%、效果抵抗提高10%，幻境持续2回合。`);
}

function initializePreemptiveSkills(team: Fighter[], battleLog?: string[], fire?: { blue: number; red: number }): void {
  const whale = team.find(unit => unit.heroId === 324);
  if (whale?.skills.some(skill => skill.name === '齿甲' && skill.description.includes('先机：'))) {
    const partner = team.filter(unit => unit.hpNow > 0 && unit !== whale)
      .sort((a, b) => effectiveStat(b, 'attack') - effectiveStat(a, 'attack'))[0];
    for (const bearer of [whale, partner].filter((unit): unit is Fighter => Boolean(unit))) {
      for (const name of ['齿甲', '体甲']) {
        bearer.tags = bearer.tags.filter(tag => tag.name !== name);
        bearer.tags.push({ name, turns: 99 });
      }
    }
    battleLog?.push(`先机｜化鲸为自身与攻击最高的友方${partner ? fighterLabel(partner) : ''}施加齿甲、体甲。`);
  }
  for (const unit of team) {
    if (unit.heroId === 372 && unit.skillLevel >= 5 && unit.skills.some(skill => skill.name === '愿满夜')) {
      applyInabaIllusion(unit, battleLog);
      battleLog?.push(`先机｜${fighterLabel(unit)}无消耗施放「愿满夜」。`);
    }
    if (unit.heroId === 280 && passiveActive(unit) && unit.skills.some(skill => skill.name === '火鼠裘'
      && skill.description.includes('先机：施放『龙首之玉』'))) {
      applyHimeIllusion(unit, team, battleLog);
    }
    if (unit.heroId === 330 && unit.skillLevel >= 5) {
      const openingSkill = unit.skills.find(skill => skill.name === '星火满天');
      if (openingSkill?.upgrades.slice(0, unit.skillLevel - 1).some(upgrade => /先机[：:]施放/.test(upgrade))) {
        applyStarfireDomain(unit, team, fire?.[unit.side] ?? 0, battleLog);
        battleLog?.push(`先机｜${fighterLabel(unit)}无消耗施放「星火满天」。`);
      }
    }
    if (unit.heroId === 595 && unit.skillLevel >= 5) {
      const bearer = team.filter(ally => ally.hpNow > 0).sort((a, b) => effectiveStat(b, 'attack') - effectiveStat(a, 'attack'))[0];
      if (bearer) {
        bearer.tags = bearer.tags.filter(tag => tag.name !== '守护之印');
        bearer.tags.push({ name: '守护之印', turns: 2 });
        battleLog?.push(`先机｜${fighterLabel(unit)}为攻击最高的友方${fighterLabel(bearer)}施加守护之印，持续2回合。`);
      }
    }
    if (unit.heroId === 370 && passiveActive(unit) && unit.skills.some(skill => skill.name === '蓄食待发'
      && skill.description.includes('先机获得7层储备粮'))) {
      unit.foodStacks = Math.min(10, unit.foodStacks + 7);
      battleLog?.push(`先机｜${fighterLabel(unit)}获得7层储备粮（${unit.foodStacks}/10）。`);
    }
    if (unit.heroId !== 304) continue;
    const openingSkill = unit.skills.find(skill => skill.name === '狐狩界');
    if (!openingSkill?.description.includes('先机：施放')) continue;

    // 御馔津的狐狩界是先机效果，不占用行动条或鬼火；开场即拥有结界和
    // 四层灵符。之前把结界留到她首次行动时才施放，会错移她之后的技能。
    unit.tags = unit.tags.filter(tag => tag.name !== '御馔津狐狩界' && tag.name !== '御馔津灵符');
    unit.tags.push({ name: '御馔津狐狩界', turns: 1 });
    for (let stack = 0; stack < 4; stack++) unit.tags.push({ name: '御馔津灵符', turns: 999 });
    battleLog?.push(`先机｜${fighterLabel(unit)}无消耗施放「狐狩界」，获得4层灵符。`);
  }
}

function applyInabaIllusion(unit: Fighter, battleLog?: string[]): void {
  unit.tags = unit.tags.filter(tag => tag.name !== '因幡辉夜姬幻境');
  unit.tags.push({ name: '因幡辉夜姬幻境', turns: unit.skillLevel >= 4 ? 2 : 1 });
  const gained = Math.min(3, 8 - unit.inabaWishPower);
  unit.inabaWishPower += gained;
  unit.inabaWishProvided += gained;
  battleLog?.push(`  ${fighterLabel(unit)}「愿满夜」创造幻境，获得${gained}点愿力（${unit.inabaWishPower}/8，累计提供${unit.inabaWishProvided}）。`);
}

function grantSoulFire(side: SideId, amount: number, fire: { blue: number; red: number }, team: Fighter[], battleLog?: string[]): void {
  const inaba = team.find(unit => unit.hpNow > 0 && unit.heroId === 372 && unit.skillLevel >= 2
    && passiveActive(unit) && unit.tags.some(tag => tag.name === '因幡辉夜姬幻境'));
  if (inaba) {
    const gained = Math.min(amount, 8 - inaba.inabaWishPower);
    inaba.inabaWishPower += gained;
    inaba.inabaWishProvided += gained;
    battleLog?.push(`  因幡辉夜姬「愿满夜」转化御魂鬼火：愿力 +${gained}（${inaba.inabaWishPower}/8，累计提供${inaba.inabaWishProvided}）。`);
    return;
  }
  const before = fire[side];
  fire[side] = Math.min(8, before + amount);
  battleLog?.push(`  御魂产生鬼火：${side === 'blue' ? '蓝方' : '红方'} +${fire[side] - before}（${before}→${fire[side]}）。`);
}

function applyResourceEffects(text: string, attacker: Fighter, allies: Fighter[], fire: { blue: number; red: number }, battleLog?: string[]): boolean {
  let handled = false;
  const teamOrb = /友方全体[^。；\n]{0,15}(?:获得|增加)(\d+)点鬼火/.exec(text);
  const orbGain = /(?:获得|增加|恢复)(\d+)点鬼火/.exec(text);
  if (orbGain && !teamOrb) {
    handled = true;
    const amount = Number(orbGain[1]);
    grantSoulFire(attacker.side, amount, fire, allies, battleLog);
  }
  if (/额外行动|额外回合|获得新的回合/.test(text)) {
    handled = true;
    attacker.gauge = 100;
    battleLog?.push(`  ${fighterLabel(attacker)}获得额外行动。`);
  }
  if (teamOrb) {
    handled = true;
    const amount = Number(teamOrb[1]);
    grantSoulFire(attacker.side, amount, fire, allies, battleLog);
  }
  return handled;
}

function resolveHit(attacker: Fighter, target: Fighter, ratio: number, random: () => number, lifeSteal = 0, allowRecovery = true, availableFire = 0, ignoreSoul = false, battleLog?: string[], fire?: { blue: number; red: number }, defenseIgnore = 0, suppressPassiveReactions = false, forceCritical = false): number {
  const targetHpBefore = target.hpNow;
  const attackingSoul = ignoreSoul ? '' : activeSoul(attacker);
  let defendingSoul = ignoreSoul || suppressPassiveReactions || attacker.bellDivineFire ? '' : activeSoul(target);
  const judgePassive = passiveActive(attacker) && attacker.skills.some(skill => skill.name === '无情');
  const judgeMissingHpCrit = judgePassive ? Math.max(0, 1 - target.hpNow / currentMaxHp(target)) : 0;
  const critChance = Math.max(0, effectiveStat(attacker, 'crit') + judgeMissingHpCrit - effectiveStat(target, 'critResist'));
  const critical = forceCritical || random() < Math.min(1, critChance);
  if (critical && target.hpNow > 0 && attacker.side !== target.side) {
    const windRiders = target.harmonyAllies.filter(ally => ally.hpNow > 0 && ally.heroId === 357
      && ally.skillLevel >= 4 && !ally.shanfengCritAdvanceUsed);
    for (const rider of windRiders) {
      rider.shanfengCritAdvanceUsed = true;
      const advanced = changeActionBar(rider, 10, attacker);
      if (advanced) battleLog?.push(`  初翎山风「令」触发：友方受到敌方暴击伤害，行动条推进${Math.round(advanced)}%（本次攻击最多触发1次）。`);
    }
  }
  let critDamage = effectiveStat(attacker, 'critDamage');
  if (attacker.heroId === 357 && attacker.skillLevel >= 3) critDamage += attacker.swiftWindCritDamage / 100;
  if (attackingSoul === '镇墓兽') critDamage += .5 * Math.max(0, 1 - attacker.hpNow / currentMaxHp(attacker));
  if (critical && judgePassive && attacker.skillLevel >= 5) critDamage += Math.max(0, critChance - 1);
  const criticalMultiplier = critical ? Math.max(1, critDamage) : 1;
  let multiplier = criticalMultiplier;
  if (attackingSoul === '隐念') {
    attacker.hiddenIntentStep = attacker.hiddenIntentTarget === target ? attacker.hiddenIntentStep % 3 + 1 : 1;
    attacker.hiddenIntentTarget = target;
    const amount = attacker.hiddenIntentStep * .2;
    multiplier *= 1 + amount;
    battleLog?.push(`  隐念：对${fighterLabel(target)}第${attacker.hiddenIntentStep}次连续命中，伤害提高${Math.round(amount * 100)}%。`);
  }
  if (attackingSoul === '破势' && target.hpNow / currentMaxHp(target) > .7) multiplier *= 1.4;
  if (attackingSoul === '心眼') multiplier *= 1 + Math.floor(Math.max(0, 1 - target.hpNow / currentMaxHp(target)) / .15) * .1;
  if (attackingSoul === '狂骨') multiplier *= 1 + Math.max(0, availableFire) * .08;
  if (attackingSoul === '片叶之苇' && attacker.hpNow >= currentMaxHp(attacker)) multiplier *= 1.45;
  if (attackingSoul === '鸣屋' && target.control) multiplier *= 1.45;
  multiplier *= 1 + Math.max(0, attacker.birdDamageBonus + attacker.permanentDamageBonus);
  if (attacker.heroId === 357) multiplier *= 1 + Math.max(0, 1 - target.hpNow / currentMaxHp(target)) * .5;
  multiplier *= effectiveStat(attacker, 'damage');
  if (defendingSoul === '被服') multiplier *= .7;
  let defense = Math.max(0, effectiveStat(target, 'defense') - (attackingSoul === '兵主部' ? attacker.bladeStacks * 75 : 0) - defenseIgnore);
  if (attackingSoul === '网切' && random() < .5) defense *= .55;
  // Onmyoji's defense reduction is defense / (defense + 300), so the
  // remaining damage multiplier is 300 / (defense + 300).
  let damageReduction = 1;
  const songstressPassive = passiveActive(target) && target.skills.some(skill => skill.name === '和音回响');
  if (songstressPassive && target.skillLevel >= 4) {
    const reduction = Math.floor(Math.max(0, target.resist) / .4) * .1;
    damageReduction *= Math.max(0, 1 - Math.min(.9, reduction));
  }
  if (passiveActive(target) && target.skills.some(skill => skill.name === '猫老师的守护')) damageReduction *= .6;
  const oni = target.harmonyAllies.find(unit => unit.hpNow > 0 && passiveActive(unit) && unit.skills.some(skill => skill.name === '红莲'));
  if (oni) {
    const missingHealth = Math.max(0, 1 - target.hpNow / currentMaxHp(target));
    damageReduction *= Math.max(0, 1 - Math.min(1, missingHealth * (oni === target && oni.skillLevel >= 5 ? 2 : 1)));
  }
  if (!critical) {
    const talismanReduction = target.tags.filter(tag => tag.name === '雷帝招来·生命上限降低')
      .reduce((sum, tag) => sum + Math.max(0, tag.hpReduction ?? 0) / Math.max(1, target.hp), 0);
    damageReduction *= Math.max(0, 1 - Math.min(1, talismanReduction));
  }
  const starfireReduction = target.tags.reduce((sum, tag) => sum + (tag.damageReduction ?? 0), 0);
  damageReduction *= Math.max(0, 1 - Math.min(1, starfireReduction));
  if (target.heroId === 563) damageReduction *= Math.max(0, 1 - Math.min(.6, target.mikuRhythm * .12));
  damageReduction *= Math.max(0, 1 - Math.min(.9, target.tags.reduce((sum, tag) => sum + (tag.damageTakenIncrease ?? 0), 0)));
  if (target.tags.some(tag => tag.actionImmunity)) damageReduction = 0;
  if (critical && target.tags.some(tag => tag.name === '体甲')) {
    damageReduction *= .5;
    battleLog?.push(`  体甲触发：${fighterLabel(target)}受到的暴击伤害降低50%。`);
  }
  if (attacker.heroId === 296 && passiveActive(attacker)) multiplier *= 1 + Math.max(0, 1 - target.hpNow / currentMaxHp(target)) * .5;
  let damage = target.tags.some(tag => tag.actionImmunity) ? 0
    : Math.max(1, effectiveStat(attacker, 'attack') * ratio * multiplier * (.9 + random() * .2) * 300 / (300 + defense) * damageReduction);
  const sugarGuardian = !suppressPassiveReactions && target.hpNow > 0
    ? target.harmonyAllies.find(ally => ally.heroId === 368 && ally.hpNow > 0 && passiveActive(ally)
      && ally.skills.some(skill => skill.name === '苦中作甜')
      && target === target.harmonyAllies.filter(unit => unit.hpNow > 0).sort((a, b) => a.hpNow / currentMaxHp(a) - b.hpNow / currentMaxHp(b))[0])
    : undefined;
  if (sugarGuardian) {
    const ratio = sugarGuardian.skillLevel >= 5 ? .3 : sugarGuardian.skillLevel >= 4 ? .25 : sugarGuardian.skillLevel >= 3 ? .21 : sugarGuardian.skillLevel >= 2 ? .18 : .15;
    const shared = damage * ratio;
    damage *= 1 - ratio;
    const paid = applyTrueDamage(sugarGuardian, shared);
    battleLog?.push(`  饴细工「苦中作甜」替${fighterLabel(target)}分担${Math.round(ratio * 100)}%伤害，由饴细工承受${Math.round(paid)}点。`);
  }
  const flowerTag = target.tags.find(tag => tag.name === '血色之花');
  const flowerOwner = flowerTag && target !== attacker
    ? target.harmonyAllies.find(unit => unit.heroId === 585 && unit.hpNow > 0 && unit !== target)
    : undefined;
  const flowerShareRatio = flowerOwner ? (flowerOwner.skillLevel >= 4 ? .5 : flowerOwner.skillLevel >= 2 ? .45 : .4) : 0;
  if (flowerOwner && flowerShareRatio > 0) {
    const lifeLoss = damage * flowerShareRatio;
    const actualLoss = Math.min(lifeLoss, Math.max(0, flowerOwner.hpNow - 1));
    flowerOwner.hpNow -= actualLoss;
    flowerOwner.lostHpTotal += actualLoss;
    const cap = flowerOwner.hp * .5;
    flowerOwner.shield = Math.min(cap, flowerOwner.shield + actualLoss);
    damage *= 1 - flowerShareRatio;
    battleLog?.push(`  荒骷髅「血色之花」分担${Math.round(flowerShareRatio * 100)}%伤害，承受${Math.round(actualLoss)}点生命流失并存入平氏铁壁（${Math.round(flowerOwner.shield)}/${Math.round(cap)}）。`);
  }
  let damageAfterResonance = damage;
  if (critical) {
    // 共鸣之墙 absorbs the bonus portion created by a critical hit; the
    // ordinary non-critical portion still lands. This matches the in-game
    // wording and the 631 residual damage visible on the frame-00331 targets.
    let criticalBonusRemaining = damage * (1 - 1 / criticalMultiplier);
    for (const wall of target.tags.filter(tag => tag.name === '共鸣之墙' && (tag.absorbRemaining ?? 0) > 0)) {
      const absorbed = Math.min(criticalBonusRemaining, wall.absorbRemaining ?? 0);
      wall.absorbRemaining = Math.max(0, (wall.absorbRemaining ?? 0) - absorbed);
      damageAfterResonance -= absorbed;
      criticalBonusRemaining -= absorbed;
      if (criticalBonusRemaining <= 0) break;
    }
    target.tags = target.tags.filter(tag => tag.name !== '共鸣之墙' || (tag.absorbRemaining ?? 0) > 0);
  }
  let damageAfterTimedShields = damageAfterResonance;
  for (const shield of target.tags.filter(tag => (tag.shieldRemaining ?? 0) > 0)) {
    const absorbed = Math.min(damageAfterTimedShields, shield.shieldRemaining ?? 0);
    shield.shieldRemaining = Math.max(0, (shield.shieldRemaining ?? 0) - absorbed);
    damageAfterTimedShields -= absorbed;
    if (damageAfterTimedShields <= 0) break;
  }
  target.tags = target.tags.filter(tag => (tag.shieldRemaining ?? 0) > 0 || !('shieldRemaining' in tag));
  const actual = Math.max(0, damageAfterTimedShields - Math.min(target.shield, damageAfterTimedShields));
  target.shield = Math.max(0, target.shield - damageAfterTimedShields);
  target.hpNow -= actual;
  if (target.hpNow <= 0 && target.heroId === 330 && passiveActive(target) && target.skills.some(skill => skill.name === '离影')
    && !target.tags.some(tag => tag.name === '离殇姿态')) {
    target.hpNow = 1;
    target.tags.push({ name: '离殇姿态', turns: 999 });
    battleLog?.push(`  不知火「离影」触发：抵挡致命伤害，生命保留1点并进入离殇姿态。`);
  }
  if (!suppressPassiveReactions && actual > 0 && target.tags.some(tag => tag.name === '守护之印') && target.heroId !== 595) {
    const fox = target.harmonyAllies.find(unit => unit.hpNow > 0 && unit.heroId === 595 && passiveActive(unit));
    if (fox && fox.skillLevel >= 4 && !target.tags.some(tag => tag.name === '守护印反击·本回合')) {
      attacker.tags = attacker.tags.filter(tag => tag.name !== '符咒·破');
      attacker.tags.push({ name: '符咒·破', turns: 2 });
      target.tags.push({ name: '守护印反击·本回合', turns: 1 });
      battleLog?.push(`  梦山白藏主「守护之印」触发：${fighterLabel(attacker)}受到符咒·破，造成伤害降低30%，持续2回合。`);
    }
  }
  const sugarMark = !suppressPassiveReactions && target.hpNow > 0
    ? target.tags.find(tag => tag.name === '糖渍' && tag.sugarOwnerId !== undefined && (tag.sugarHeals ?? 0) < 3)
    : undefined;
  if (sugarMark && actual > 0) {
    const owner = target.harmonyAllies.find(ally => ally.heroId === sugarMark.sugarOwnerId && ally.hpNow > 0 && passiveActive(ally));
    if (owner) {
      const before = target.hpNow;
      const healed = applyHealing(owner, target, currentMaxHp(owner) * .1, battleLog);
      sugarMark.sugarHeals = (sugarMark.sugarHeals ?? 0) + 1;
      const overflow = Math.max(0, before + currentMaxHp(owner) * .1 * healingMultiplier(target) - currentMaxHp(target));
      if (overflow > 0) changeActionBar(target, 8, owner);
      battleLog?.push(`  饴细工「糖渍」触发：${fighterLabel(target)}恢复${Math.round(healed)}点生命${overflow > 0 ? '，溢出治疗使行动条推进8%' : ''}（本回合${sugarMark.sugarHeals}/3）。`);
    }
  }
  if (target.heroId === 344 && actual > 0) {
    if (target.cloudYang) {
      target.cloudYangHp = target.hpNow;
      target.cloudYinHp = Math.min(target.hp / 2, target.cloudYinHp + actual);
    } else {
      target.cloudYinHp = target.hpNow;
      target.cloudYangHp = Math.min(target.hp / 2, target.cloudYangHp + actual);
    }
  }
  const snowArmor = target.heroId === 201 && target.tags.some(tag => tag.name === '冰甲盾' && (tag.shieldRemaining ?? 0) > 0);
  if (snowArmor && attacker.hpNow > 0 && !suppressPassiveReactions) {
    const chance = Math.min(1, .5 * (1 + Math.max(0, effectiveStat(target, 'hit')))
      * (1 - Math.min(.95, Math.max(0, effectiveStat(attacker, 'resist')))));
    if (random() < chance) {
      attacker.effects = attacker.effects.filter(effect => effect.source !== '雪女·冰甲减速');
      attacker.effects.push({ stat: 'speed', amount: -10, flat: true, turns: 2, source: '雪女·冰甲减速' });
      battleLog?.push(`  雪女「冰甲术」触发：${fighterLabel(attacker)}速度降低10点，持续2回合。`);
    }
  }
  if (!suppressPassiveReactions && actual > currentMaxHp(target) * .3) {
    const goldfish = target.harmonyAllies.find(ally => ally.hpNow > 0 && ally.heroId === 346 && passiveActive(ally)
      && ally.skills.some(skill => skill.name === '川流'));
    if (goldfish) {
      const current = attacker.tags.filter(tag => tag.name === '结怨').length;
      const added = Math.min(3 - current, 3);
      for (let stack = 0; stack < added; stack++) attacker.tags.push({ name: '结怨', turns: 2 });
      if (added > 0) battleLog?.push(`  聆海金鱼姬「川流」被动触发：单次伤害超过生命上限30%，为${fighterLabel(attacker)}施加${added}层结怨（${current + added}/3），持续2回合。`);
    }
  }
  if (target.hpNow <= 0 && flowerTag && !flowerTag.fatalPrevented && target.heroId !== 585) {
    target.hpNow = 1;
    flowerTag.fatalPrevented = true;
    if (flowerOwner && flowerOwner.skillLevel >= 3) {
      flowerOwner.shield = Math.min(flowerOwner.hp * .5, flowerOwner.shield + flowerOwner.lostHpTotal);
    }
    battleLog?.push(`  血色之花免疫${fighterLabel(target)}此次致命伤害，生命保留1点。`);
  }
  if (target.heroId === 585 && target.hpNow <= 0) {
    const lost = Math.max(0, target.hpNow + actual - 1);
    target.hpNow = 1;
    target.lostHpTotal += lost;
    target.shield = Math.min(target.hp * .5, target.shield + lost);
    battleLog?.push(`  荒骷髅不会因生命流失阵亡，生命保留1点。`);
  }
  if (!suppressPassiveReactions && damage > 0 && target.hpNow > 0 && attacker.heroId === 271
    && passiveActive(attacker) && random() < .4) {
    target.tags = target.tags.filter(tag => tag.name !== '鬼面');
    target.tags.push({ name: '鬼面', turns: 2 });
    // 般若的嫉恨之心 resolves after damage but before defender soul/passive
    // reactions, so a newly applied mask suppresses those reactions now.
    defendingSoul = '';
    battleLog?.push(`  嫉恨之心触发：${fighterLabel(target)}被鬼面封印御魂与被动，持续2回合。`);
  }
  const himeGuardian = !suppressPassiveReactions && !attacker.himeFireTriggeredThisAction
    ? target.harmonyAllies.find(ally => ally.hpNow > 0 && ally.heroId === 280 && passiveActive(ally)
      && (ally === target || ally.tags.some(tag => tag.name === '辉夜姬幻境')))
    : undefined;
  if (himeGuardian) {
    attacker.himeFireTriggeredThisAction = true;
    if (random() < .3 && fire) {
      const before = fire[himeGuardian.side];
      fire[himeGuardian.side] = Math.min(8, before + 1);
      battleLog?.push(`  辉夜姬「火鼠裘」触发：${fighterLabel(himeGuardian)}获得1点鬼火（${before}→${fire[himeGuardian.side]}）。`);
    }
  }
  if (!suppressPassiveReactions && passiveActive(target) && damage > 0 && target.heroId === 285) {
    const poisonCount = attacker.tags.filter(tag => tag.name === '毒羽').length;
    if (poisonCount < 5) attacker.tags.push({ name: '毒羽', turns: 999 });
  }
  if (!suppressPassiveReactions && passiveActive(target) && actual > 0 && target.heroId === 388) {
    const leafVeil = target.tags.findIndex(tag => tag.name === '林隐');
    if (leafVeil >= 0) target.tags.splice(leafVeil, 1);
  }
  if (!suppressPassiveReactions && passiveActive(target) && actual > 0 && target.heroId === 289 && random() < .4) target.carrots = Math.min(4, target.carrots + 1);
  if (target.hpNow <= 0) enterBellEternalFlame(target, battleLog);
  updateBellDivineFire(target, battleLog);
  if (attacker.bellDivineFire && activeSoul(target)) battleLog?.push(`  神火攻击无视${fighterLabel(target)}的御魂效果。`);
  if (damage > 0) attacker.dealtDamageThisTurn = true;
  if (attacker.oniStanceTurns > 0) attacker.oniStanceDamage += actual;
  if (damageAfterTimedShields > 0 || target.hpNow < currentMaxHp(target)) {
    target.tags = target.tags.filter(tag => !tag.foxSeal);
  }
  if (!suppressPassiveReactions && passiveActive(target) && actual > 0 && target.heroId === 552) {
    const stacks = attacker.tags.filter(tag => tag.name === '业障').length;
    if (stacks < 3) {
      attacker.tags.push({ name: '业障', turns: 999 });
      battleLog?.push(`  慧明灯的「业回」为伤害来源${fighterLabel(attacker)}附加1层业障（${stacks + 1}/3，攻击降低${(stacks + 1) * 5}%）。`);
    }
    if (stacks + 1 >= 3 && target.harmonyAllies.some(ally => ally.effects.some(effect => effect.source === '正念·明识灯'))
      && !attacker.tags.some(tag => tag.name === '拘魂')) {
      attacker.tags.push({ name: '拘魂', turns: 999 });
      battleLog?.push(`  ${fighterLabel(attacker)}业障达到3层，陷入拘魂；下次行动跳过。`);
    }
  }
  if (allowRecovery && lifeSteal > 0) attacker.hpNow = Math.min(currentMaxHp(attacker), attacker.hpNow + actual * lifeSteal);
  if (attackingSoul === '针女' && critical && random() < .4) {
    const bonusDamage = Math.min(currentMaxHp(target) * .1, effectiveStat(attacker, 'attack') * 1.2);
    target.hpNow -= bonusDamage;
    battleLog?.push(`  针女触发：额外造成 ${Math.round(bonusDamage)} 点伤害。`);
  }
  if (allowRecovery && attackingSoul === '蝠翼') attacker.hpNow = Math.min(currentMaxHp(attacker), attacker.hpNow + actual * .2);
  const slowed = target.effects.some(effect => effect.stat === 'speed' && effect.amount < 0);
  const controlSouls: Record<string, [Control, number]> = { '雪幽魂': ['冰冻', slowed ? .3 : .15], '魅妖': ['混乱', .25], '钟灵': ['眩晕', .1], '反枕': ['睡眠', .23] };
  const proc = controlSouls[attackingSoul];
  if (proc && target.hpNow > 0) {
    const chance = attackingSoul === '钟灵' && !attacker.harmonyAllies.some(unit => unit.control === '眩晕') ? .2 : proc[1];
    applyControl(attacker, target, proc[0], chance, random, battleLog);
  }
  if (defendingSoul === '雪幽魂' && attacker.hpNow > 0) {
    attacker.effects = attacker.effects.filter(effect => !(effect.stat === 'speed' && effect.flat && effect.amount < 0));
    attacker.effects.push({ stat: 'speed', amount: -30, turns: 1, flat: true });
  }
  if (defendingSoul === '地藏像' && critical && target.hpNow > 0) {
    for (const ally of target.harmonyAllies.filter(unit => unit.hpNow > 0)) {
      const baseChance = ally === target ? 1 : .3;
      const chance = ally.control === '嘲讽' ? baseChance * .4 : baseChance;
      if ((ally === target || random() < chance) && activeSoul(ally) === '地藏像') {
        const amount = currentMaxHp(ally) * .1;
        addTimedShield(ally, amount, '地藏像护盾');
        battleLog?.push(`  地藏像触发：${fighterLabel(ally)}获得 ${Math.round(amount)} 点护盾（生命上限10%）。`);
      }
    }
  }
  if (attackingSoul === '魍魉之匣' && target.hpNow > 0 && random() < .25) {
    const effect = Math.floor(random() * 4);
    if (effect === 3) {
      target.tags = target.tags.filter(tag => tag.name !== '魍魉之匣·减疗');
      target.tags.push({ name: '魍魉之匣·减疗', turns: 1, healingReduction: .4 });
    } else applyControl(attacker, target, (['眩晕', '沉默', '混乱'] as Control[])[effect], 1, random, battleLog);
  }
  if (defendingSoul === '镜姬' && random() < .3) {
    const reflected = Math.min(attacker.hpNow, damage);
    attacker.hpNow -= reflected;
    battleLog?.push(`  镜姬触发：${fighterLabel(target)}反弹 ${Math.round(reflected)} 点伤害给${fighterLabel(attacker)}。`);
  }
  if (defendingSoul === '返魂香') {
    const procChance = target.control === '嘲讽' ? .1 : .25;
    if (random() < procChance) {
      const beforeControl = attacker.control;
      applyControl(target, attacker, '眩晕', 1, random, battleLog);
      if (attacker.control === '眩晕' && beforeControl !== '眩晕') {
        battleLog?.push(`  返魂香触发：${fighterLabel(target)}眩晕伤害者${fighterLabel(attacker)}（基础概率${Math.round(procChance * 100)}%）。`);
      }
    }
  }
  if (defendingSoul === '狰' && random() < .35 && target.hpNow > 0) {
    const counterDamage = Math.max(1, target.attack * .125 * 1000 / (1000 + Math.max(0, attacker.defense)));
    attacker.hpNow -= counterDamage;
  }
  const passive = suppressPassiveReactions || !passiveActive(attacker) ? undefined : attacker.skills.find(skill => skill.type === 4 && /攻击时|造成伤害时|攻击后|伤害时/.test(skill.description) && controlType(skill.description));
  if (passive && target.hpNow > 0) {
    const passiveControl = controlType(passive.description)!;
    const passiveChance = /概率(?:为|提升至)?(\d+(?:\.\d+)?)%/.exec(passive.description);
    applyControl(attacker, target, passiveControl, passiveChance ? Number(passiveChance[1]) / 100 : .2, random, battleLog);
  }
  if (attackingSoul === '日女巳时' && target.hpNow > 0) {
    const hasBuff = target.effects.some(effect => effect.amount > 0)
      || target.tags.some(tag => ['庇护', '月之祝福', '共鸣之墙', '灵狐守护', '地藏像护盾', '蚌精护盾', '珍珠护盾', '贝吹坊·贝甲'].includes(tag.name));
    const chance = hasBuff ? .3 : .2;
    if (random() < chance) {
      changeActionBar(target, -30, attacker);
      battleLog?.push(`  日女巳时触发，${fighterLabel(target)}行动条击退30%${hasBuff ? '（目标带有增益，概率提高）' : ''}。`);
    }
  }
  if (fire && damage > 0 && !attacker.woodCharmTriggered) {
    for (const wearer of target.harmonyAllies.filter(unit => unit.hpNow > 0 && activeSoul(unit) === '木魅')) {
      const chance = target.control === '嘲讽' ? .1 : .25;
      if (fire[attacker.side] > 0 && random() < chance) {
        fire[attacker.side]--;
        attacker.woodCharmTriggered = true;
        battleLog?.push(`  木魅触发：${fighterLabel(wearer)}受击削减${fighterLabel(attacker)}1点鬼火（当前${fire[attacker.side]}），本次攻击不再重复触发。`);
        break;
      }
    }
  }
  if (targetHpBefore > 0 && target.hpNow <= 0) {
    notifyBellAllyDeath(target, battleLog);
    if (target.heroId === 250 && passiveActive(target) && target.frogCooldown <= 0 && target.skills.some(skill => skill.name === '转运')) {
      const rolls = target.opponents.filter(unit => unit.hpNow > 0).map(enemy => ({ enemy, points: 1 + Math.floor(random() * 6) }));
      const dieCounts = new Map<number, number>();
      for (const roll of rolls) dieCounts.set(roll.points, (dieCounts.get(roll.points) ?? 0) + 1);
      const matches = [...dieCounts].filter(([, count]) => count >= 2).map(([points]) => points).sort((a, b) => a - b);
      const levelSkill = target.skills.find(skill => skill.name === '岭上开花');
      const hitRatio = levelSkill ? Number(/攻击(\d+(?:\.\d+)?)%伤害/.exec(skillText(levelSkill, target.skillLevel))?.[1] ?? 49) / 100 : .49;
      let maxPoint = 1;
      for (const { enemy, points } of rolls) {
        maxPoint = Math.max(maxPoint, points);
        battleLog?.push(`  青蛙瓷器「转运」阵亡反击：对${fighterLabel(enemy)}掷出${points}点，岭上开花攻击${points}次。`);
        for (let hit = 0; hit < points && enemy.hpNow > 0; hit++) {
          resolveHit(target, enemy, hitRatio, random, 0, false, fire?.[target.side] ?? 0, false, battleLog, fire, 0, true);
        }
      }
      if (matches.length) {
        const restore = currentMaxHp(target) * .1 * matches[0];
        target.hpNow = Math.min(currentMaxHp(target), restore);
        target.frogCooldown = maxPoint;
        battleLog?.push(`  青蛙瓷器「转运」骰子出现对子${matches.join('、')}，立即复活并恢复${Math.round(target.hpNow)}点生命；冷却${target.frogCooldown}回合。`);
      } else {
        target.frogCooldown = maxPoint;
        battleLog?.push(`  青蛙瓷器「转运」没有掷出对子，无法复活；冷却${target.frogCooldown}回合。`);
      }
    }
    for (const skull of target.opponents.filter(unit => unit.hpNow > 0 && unit.heroId === 585
      && unit.skillLevel >= 5 && unit.skills.some(skill => skill.name === '黄泉战旗'))) {
      const increase = skull.hp * .35;
      skull.maxHpBonus += increase;
      skull.hpNow += increase;
      battleLog?.push(`  敌方式神${fighterLabel(target)}阵亡，荒骷髅「黄泉战旗」使生命上限提高${Math.round(increase)}并恢复等量生命（当前上限${Math.round(currentMaxHp(skull))}）。`);
    }
    if (activeSoul(attacker) === '阴摩罗' && fire) {
      grantSoulFire(attacker.side, 3, fire, attacker.harmonyAllies, battleLog);
      battleLog?.push(`  阴摩罗击败目标，${fighterLabel(attacker)}触发回火效果。`);
    }
    const casualties = [...target.harmonyAllies, ...target.opponents];
    // A wearer killed by this same hit cannot trigger its own kill passive.
    for (const wearer of casualties.filter(unit => unit.hpNow > 0 && activeSoul(unit) === '伤魂鸟')) {
      const restored = applyHealing(wearer, wearer, currentMaxHp(wearer) * .2, battleLog);
      wearer.birdDamageBonus = Math.min(1.2, wearer.birdDamageBonus + .2);
      battleLog?.push(`  伤魂鸟因${fighterLabel(target)}阵亡而触发：${fighterLabel(wearer)}恢复 ${Math.round(restored)} 点生命，并永久增伤20%（当前${Math.round(wearer.birdDamageBonus * 100)}%）。`);
    }
    triggerRedMapleExplosion(target, battleLog);
  }
  const catTeacherChance = target.skillLevel >= 2 ? 1 : .6;
  if (!suppressPassiveReactions && damageAfterTimedShields > 0 && target.hpNow > 0 && target.skills.some(skill => skill.name === '猫老师的守护')
    && target.catTeacherOnceAvailable && random() < catTeacherChance) triggerCatTeacher(target, random, battleLog, fire);
  return damage;
}

function triggerFoxSeal(target: Fighter, seal: StatusTag, battleLog?: string[]): void {
  if (!seal.foxSeal) return;
  const cap = seal.foxSeal.attack * 10;
  const damage = Math.min(cap, Math.max(0, currentMaxHp(target) - target.hpNow) * .5);
  target.hpNow -= damage;
  updateBellDivineFire(target, battleLog);
  target.tags = target.tags.filter(tag => tag !== seal);
  battleLog?.push(`  狐印触发：${fighterLabel(target)}受到 ${Math.round(damage)} 点间接伤害（上限 ${Math.round(cap)}），剩余生命 ${Math.max(0, Math.round(target.hpNow))}。`);
}

function resolveTurnStartEffects(unit: Fighter, random: () => number, battleLog?: string[], fire?: { blue: number; red: number }): void {
  for (const mark of unit.tags.filter(tag => tag.name === '糖渍')) mark.sugarHeals = 0;
  if (unit.heroId === 372 && passiveActive(unit) && unit.skillLevel >= 3 && unit.tags.some(tag => tag.name === '因幡辉夜姬幻境')) {
    const gained = Math.min(3, 8 - unit.inabaWishPower);
    unit.inabaWishPower += gained;
    unit.inabaWishProvided += gained;
    battleLog?.push(`  因幡辉夜姬「愿满夜」回合开始获得${gained}点愿力（${unit.inabaWishPower}/8，累计提供${unit.inabaWishProvided}）。`);
  }
  for (const mark of unit.tags.filter(tag => tag.shanfengTear)) {
    const tear = mark.shanfengTear!;
    const raw = Math.min(tear.attack * 3.2, unit.hpNow * tear.ratio + tear.attack * (1 - tear.ratio));
    const defense = Math.max(0, effectiveStat(unit, 'defense') - tear.defenseIgnore);
    const damage = Math.max(1, raw * 300 / (300 + defense));
    const dealt = applyTrueDamage(unit, damage);
    if (tear.healingReduction > 0) unit.tags.push({ name: '撕裂减疗', turns: 1, healingReduction: tear.healingReduction });
    battleLog?.push(`  山风「撕裂」在${fighterLabel(unit)}回合开始触发：造成${Math.round(dealt)}点间接伤害${tear.defenseIgnore ? '（无视600点防御）' : ''}${tear.healingReduction ? '，减疗100%持续1回合' : ''}。`);
    unit.tags = unit.tags.filter(tag => tag !== mark);
  }
  const hime = unit.harmonyAllies.find(ally => ally.hpNow > 0 && ally.heroId === 280 && passiveActive(ally)
    && ally.tags.some(tag => tag.name === '辉夜姬幻境'));
  if (unit.hpNow > 0 && hime && fire && random() < .67) {
    const before = fire[unit.side];
    fire[unit.side] = Math.min(8, before + 1);
    battleLog?.push(`  辉夜姬「火鼠裘」触发：${fighterLabel(unit)}回合开始获得1点鬼火（${before}→${fire[unit.side]}）。`);
  }
  if (unit.heroId === 323 && unit.hpNow > 0) {
    unit.tags = unit.tags.filter(tag => tag.name !== '妖怪屋清醒');
    unit.tags.push({ name: '妖怪屋清醒', turns: 1 });
  }
  if (unit.heroId === 552) {
    const lampWasPresent = unit.harmonyAllies.some(ally => ally.effects.some(effect => effect.source === '正念·明识灯'));
    if (lampWasPresent) {
      for (const ally of unit.harmonyAllies) ally.effects = ally.effects.filter(effect => effect.source !== '正念·明识灯');
      for (const enemy of unit.opponents) enemy.tags = enemy.tags.filter(tag => tag.name !== '业障' && tag.name !== '拘魂');
      if (fire) {
        const before = fire[unit.side];
        fire[unit.side] = Math.min(8, before + 2);
        battleLog?.push(`  慧明灯回合开始，收回明识灯并清除敌方业障；返还2点鬼火（${before}→${fire[unit.side]}，存量上限8）。`);
      } else {
        battleLog?.push('  慧明灯回合开始，收回明识灯并清除敌方业障。');
      }
    }
  }
  if (unit.hpNow > 0 && activeSoul(unit) === '遗念火') {
    const before = unit.remnantFlame;
    unit.remnantFlame = Math.min(3, unit.remnantFlame + 1);
    if (unit.remnantFlame > before) {
      battleLog?.push(`  遗念火触发：${fighterLabel(unit)}获得1层念火（${unit.remnantFlame}/3），效果抵抗提高${unit.remnantFlame * 15}%。`);
    }
  }
  if (unit.heroId === 289) unit.carrots = Math.min(4, unit.carrots + 2);
  if (unit.skills.some(skill => skill.name === '守缘刃')) unit.bondTargetBoostUsed = false;
  if (unit.tags.some(tag => tag.name === '尘缘·赤' || tag.name === '尘缘·青')
    && unit.harmonyAllies.some(ally => ally.hpNow > 0 && ally.skillLevel >= 2 && ally.skills.some(skill => skill.name === '守缘刃')) && fire) {
      fire[unit.side] = Math.min(8, fire[unit.side] + 1);
      battleLog?.push(`  尘缘效果触发：${fighterLabel(unit)}回合开始获得1点鬼火（当前${fire[unit.side]}）。`);
  }
  for (const owner of unit.harmonyAllies.filter(candidate => candidate.bondedAlly === unit)) owner.bondOwnerBoostUsed = false;
  if (unit.skills.some(skill => skill.name === '猫老师的守护')) unit.catTeacherOnceAvailable = true;
  if (unit.skills.some(skill => skill.name === '疗愈的药草')) unit.herbs = 4;
  const foxSeals = unit.tags.filter(tag => tag.foxSeal);
  for (const seal of foxSeals) triggerFoxSeal(unit, seal, battleLog);
  const marks = unit.tags.filter(tag => tag.name === '死亡裁决' && tag.delayedDamage);
  for (const mark of marks) {
    const effect = mark.delayedDamage!;
    const missingHpCrit = effect.judgePassive ? Math.max(0, 1 - unit.hpNow / currentMaxHp(unit)) : 0;
    const critChance = Math.max(0, effect.crit + missingHpCrit);
    const critical = unit.defense <= 0 || random() < Math.min(1, critChance);
    const critDamage = effect.critDamage + (critical && effect.judgePassive && effect.skillLevel >= 5 ? Math.max(0, critChance - 1) : 0);
    const multiplier = critical ? Math.max(1, critDamage) : 1;
    const defenseMultiplier = 300 / (300 + Math.max(0, unit.defense));
    const reduction = unit.skills.some(skill => skill.name === '和音回响') && unit.skillLevel >= 4
      ? Math.max(0, 1 - Math.min(.9, Math.floor(Math.max(0, unit.resist) / .4) * .1)) : 1;
    const catTeacherReduction = unit.skills.some(skill => skill.name === '猫老师的守护') ? .6 : 1;
    const damage = Math.max(1, effect.attack * effect.ratio * multiplier * (.9 + random() * .2) * defenseMultiplier * reduction * catTeacherReduction);
    unit.hpNow -= damage;
    if (unit.hpNow <= 0) enterBellEternalFlame(unit, battleLog);
    if (unit.hpNow <= 0) notifyBellAllyDeath(unit, battleLog);
    updateBellDivineFire(unit, battleLog);
    battleLog?.push(`  死亡裁决在${fighterLabel(unit)}回合开始前结算${critical ? '暴击' : ''}间接伤害 ${Math.round(damage)}，剩余生命 ${Math.max(0, Math.round(unit.hpNow))}。`);
  }
  if (marks.length) unit.tags = unit.tags.filter(tag => tag.name !== '死亡裁决');
}

function fighterLabel(unit: Fighter): string { return `${unit.side === 'blue' ? '蓝方' : '红方'}·${unit.name}`; }

function currentMaxHp(unit: Fighter): number {
  if (unit.heroId === 344) return Math.max(1, unit.hp / 2 + unit.maxHpBonus / 2);
  const reduction = unit.tags.reduce((sum, tag) => sum + (tag.hpReduction ?? 0), 0);
  return Math.max(1, unit.hp + unit.maxHpBonus - reduction);
}

function updateBellDivineFire(unit: Fighter, battleLog?: string[]): void {
  if (unit.bellDivineFire || unit.hpNow <= 0 || !unit.skills.some(skill => skill.name === '铃焰灼心')) return;
  const threshold = unit.skillLevel >= 2 ? .75 : .5;
  if (unit.hpNow / currentMaxHp(unit) < threshold) {
    unit.bellDivineFire = true;
    battleLog?.push(`  ${fighterLabel(unit)}生命低于${Math.round(threshold * 100)}%，永久进入神火状态；神火伤害无视敌方御魂效果。`);
  }
}

function enterBellEternalFlame(unit: Fighter, battleLog?: string[]): void {
  if (unit.bellEternalFlame) {
    if (unit.hpNow <= 0 && unit.harmonyAllies.some(ally => ally !== unit && ally.hpNow > 0)) unit.hpNow = 1;
    return;
  }
  if (unit.hpNow > 0 || unit.skillLevel < 4
    || !unit.skills.some(skill => skill.name === '铃焰灼心')) return;
  unit.bellEternalFlame = true;
  unit.bellFireReady = false;
  unit.control = null;
  unit.controlTurns = 0;
  unit.effects = [];
  unit.tags = [];
  unit.shield = 0;
  unit.hpNow = currentMaxHp(unit) * .5;
  const allies = unit.harmonyAllies.filter(ally => ally.hpNow > 0 && ally !== unit);
  unit.effects.push({ stat: 'defense', amount: 1, turns: 999, source: '心火永明' });
  unit.effects.push({ stat: 'critResist', amount: 1, turns: 999, source: '心火永明' });
  for (const ally of allies) {
    ally.effects.push({ stat: 'defense', amount: .4, turns: 999, source: '心火永明·友方' });
    ally.effects.push({ stat: 'critResist', amount: .4, turns: 999, source: '心火永明·友方' });
  }
  if (unit.skillLevel >= 5) addTimedShield(unit, unit.attack * 1.2, '心火永明护盾', 2);
  battleLog?.push(`  ${fighterLabel(unit)}受到致命伤害，进入「心火永明」：清除自身状态并恢复${Math.round(unit.hpNow)}点生命。`);
}

function leaveBellEternalFlame(unit: Fighter, battleLog?: string[]): void {
  if (!unit.bellEternalFlame) return;
  unit.bellEternalFlame = false;
  unit.effects = unit.effects.filter(effect => effect.source !== '心火永明');
  for (const ally of unit.harmonyAllies) ally.effects = ally.effects.filter(effect => effect.source !== '心火永明·友方');
  unit.tags = unit.tags.filter(tag => tag.name !== '心火永明护盾');
  unit.bellDivineFire = false;
  unit.bellFireReady = false;
  unit.bellFireCooldown = 0;
  battleLog?.push(`  ${fighterLabel(unit)}生命回满，退出「心火永明」并重置神火冷却。`);
}

function notifyBellAllyDeath(dead: Fighter, battleLog?: string[]): void {
  for (const bell of dead.harmonyAllies.filter(ally => ally.hpNow > 0 && ally.bellEternalFlame)) {
    const otherLiving = bell.harmonyAllies.filter(ally => ally !== bell && ally.hpNow > 0);
    if (!otherLiving.length) {
      bell.hpNow = 0;
      battleLog?.push(`  ${fighterLabel(bell)}失去最后一位非召唤物友方，心火永明结束并阵亡。`);
      continue;
    }
    const restored = applyRestoration(bell, currentMaxHp(bell) * .5, battleLog);
    battleLog?.push(`  ${fighterLabel(dead)}阵亡，心火永明使${fighterLabel(bell)}恢复${Math.round(restored)}点生命。`);
  }
}

function applyTrueDamage(target: Fighter, damage: number): number {
  let remaining = Math.max(0, damage);
  for (const shield of target.tags.filter(tag => (tag.shieldRemaining ?? 0) > 0)) {
    const absorbed = Math.min(remaining, shield.shieldRemaining ?? 0);
    shield.shieldRemaining = Math.max(0, (shield.shieldRemaining ?? 0) - absorbed);
    remaining -= absorbed;
    if (remaining <= 0) break;
  }
  target.tags = target.tags.filter(tag => (tag.shieldRemaining ?? 0) > 0 || !('shieldRemaining' in tag));
  const normalAbsorbed = Math.min(target.shield, remaining);
  target.shield -= normalAbsorbed;
  const actual = Math.max(0, remaining - normalAbsorbed);
  target.hpNow -= actual;
  if (target.hpNow <= 0) enterBellEternalFlame(target);
  if (target.hpNow <= 0) notifyBellAllyDeath(target);
  updateBellDivineFire(target);
  return actual;
}

function resolveTurnEndPassives(units: Fighter[], actor: Fighter, random: () => number, battleLog?: string[], allowHealing = true, fire?: { blue: number; red: number }, orbMeters?: Record<SideId, OrbMeter>): void {
  if (actor.heroId === 201 && actor.hpNow > 0 && actor.skills.some(skill => skill.name === '冰甲术')) {
    const ratio = actor.skillLevel >= 4 ? .12 : actor.skillLevel >= 2 ? .09 : .06;
    const recipients = [actor, ...actor.harmonyAllies.filter(unit => unit.hpNow > 0 && unit !== actor)
      .sort((a, b) => b.critDamage - a.critDamage).slice(0, 2)];
    for (const ally of recipients) {
      ally.tags = ally.tags.filter(tag => tag.name !== '冰甲盾');
      addTimedShield(ally, currentMaxHp(ally) * ratio, '冰甲盾', 1);
    }
    battleLog?.push(`  雪女「冰甲术」回合结束触发：${recipients.map(fighterLabel).join('、')}获得生命上限${Math.round(ratio * 100)}%冰甲盾。`);
  }
  for (const healer of units) {
    if (healer.heroId === 346 && healer.hpNow > 0 && passiveActive(healer) && actor.side !== healer.side
      && healer.skills.some(skill => skill.name === '凌波')) {
      const concentration = healer.tags.filter(tag => tag.name === '凝神').length;
      if (concentration < 8) {
        healer.tags.push({ name: '凝神', turns: 999 });
        battleLog?.push(`  聆海金鱼姬「凌波」触发：获得1层凝神（${concentration + 1}/8）。`);
      }
      if (!healer.tags.some(tag => tag.name === '灵鱼盾')) {
        addTimedShield(healer, effectiveStat(healer, 'attack') * .8, '灵鱼盾', 999);
        battleLog?.push(`  聆海金鱼姬「凌波」获得灵鱼盾，可吸收攻击80%的伤害。`);
      }
      if (concentration + 1 >= 8) {
        healer.tags = healer.tags.filter(tag => tag.name !== '凝神');
        if (healer.tags.some(tag => tag.name === '鱼尾之簇')) {
          for (const ally of healer.harmonyAllies.filter(unit => unit.hpNow > 0)) changeActionBar(ally, 25, healer);
          battleLog?.push(`  凌波凝神达到8层，消耗全部层数并使友方全体行动条推进25%。`);
        } else {
          for (const enemy of healer.opponents.filter(unit => unit.hpNow > 0)) enemy.tags.push({ name: '川流之缚', turns: 2 });
          healer.tags.push({ name: '鱼尾之簇', turns: 1 });
          battleLog?.push(`  凌波凝神达到8层，消耗全部层数、为敌方施加川流之缚并开启鱼尾之簇。`);
        }
      }
    }
    if (healer.heroId === 356 && healer.hpNow > 0 && passiveActive(healer) && actor.side !== healer.side
      && healer.tags.some(tag => tag.name === '海原贝戟')) {
      const advanced = changeActionBar(healer, 10, healer);
      if (advanced) battleLog?.push(`  千姬「潮汐奔流」触发：敌方回合结束，行动条推进${Math.round(advanced)}%。`);
    }
    if (healer.heroId === 346 && healer.hpNow > 0 && passiveActive(healer) && actor.side === healer.side
      && actor.hpNow > 0 && healer.tags.some(tag => tag.name === '鱼尾之簇')) {
      const restored = applyHealing(healer, actor, effectiveStat(healer, 'attack') * .5, battleLog);
      battleLog?.push(`  鱼尾之簇触发：${fighterLabel(actor)}恢复${Math.round(restored)}点生命。`);
    }
    if (healer.heroId === 304 && healer.hpNow > 0 && actor.hpNow > 0
      && actor.side !== healer.side && healer.skills.some(skill => skill.name === '一矢')) {
      const inFoxHuntField = healer.tags.some(tag => tag.name === '御馔津狐狩界');
      const triggerChance = inFoxHuntField ? .4 : .05;
      if (random() < triggerChance) {
        const basicAttack = healer.skills.find(skill => skill.name === '一矢')!;
        const ratioText = /攻击敌方目标，造成攻击(\d+(?:\.\d+)?)%伤害/.exec(skillText(basicAttack, healer.skillLevel));
        const ratio = Number(ratioText?.[1] ?? 80) / 100;
        battleLog?.push(`  御馔津「一矢·封魔」被动触发：${fighterLabel(actor)}行动结束后，以${Math.round(triggerChance * 100)}%概率追射（不触发目标御魂及被动）。`);
        const damage = resolveHit(healer, actor, ratio, random, 0, true, fire?.[healer.side] ?? 0, false, battleLog, fire, 0, true);
        battleLog?.push(`  一矢·封魔命中${fighterLabel(actor)}，造成${Math.round(damage)}点生命伤害，剩余生命${Math.max(0, Math.round(actor.hpNow))}。`);
        const rawChance = Math.max(0, Math.min(1, 1 * (1 + Math.max(0, effectiveStat(healer, 'hit')))));
        const effectChance = rawChance * (1 - Math.min(.95, Math.max(0, effectiveStat(actor, 'resist'))));
        if (random() < effectChance && !actor.bellEternalFlame
          && !actor.tags.some(tag => tag.name === '庇护' || tag.name === '灵狐守护')
          && !actor.skills.some(skill => skill.name === '红莲')) {
          actor.control = '沉默';
          actor.controlTurns = 1;
          actor.tags = actor.tags.filter(tag => tag.name !== '御魂封印' && tag.name !== '被动压制' && tag.healingReduction === undefined);
          actor.tags.push({ name: '御魂封印', turns: 1 }, { name: '被动压制', turns: 1 }, { name: '减疗75%', turns: 1, healingReduction: .75 });
          recordDebuff(actor);
          battleLog?.push(`  一矢·封魔使${fighterLabel(actor)}沉默、御魂封印、被动压制并减疗75%（效果命中${Math.round(effectChance * 100)}%）。`);
        }
      }
    }
    if (healer === actor && healer.oniStanceTurns > 0 && !healer.oniStanceEnteredThisTurn) {
      healer.oniStanceTurns--;
      if (healer.oniStanceTurns === 0 && healer.skillLevel >= 3) {
        const healing = healer.oniStanceDamage * .2;
        for (const ally of units.filter(unit => unit.side === healer.side && unit.hpNow > 0)) {
          const restored = applyHealing(healer, ally, healing, battleLog);
          battleLog?.push(`  鬼王姿态结束，为${fighterLabel(ally)}恢复 ${Math.round(restored)} 点生命。`);
        }
        healer.oniStanceDamage = 0;
      }
    }
    if (healer === actor && healer.hpNow > 0 && healer.skills.some(skill => skill.name === '猫老师的守护')
      && units.filter(unit => unit.side === healer.side && unit.hpNow > 0).length === 1) {
      triggerCatTeacher(healer, random, battleLog, fire);
    }
    if (healer.hpNow > 0 && !healer.bellEternalFlame && healer.bellDivineFire && healer.skillLevel >= 3
      && healer.skills.some(skill => skill.name === '铃焰灼心') && actor !== healer && actor.side === healer.side && actor.hpNow > 0) {
      const recovered = applyRestoration(healer, currentMaxHp(healer) * .08, battleLog);
      battleLog?.push(`  神火：友方${fighterLabel(actor)}行动结束，${fighterLabel(healer)}恢复${Math.round(recovered)}点生命（生命上限8%）。`);
    }
    if (healer === actor && healer.hpNow > 0 && healer.skills.some(skill => skill.name === '灵合')) {
      const oldGuards = healer.tags.filter(tag => tag.name === '灵狐守护');
      const expiredShield = oldGuards.reduce((sum, tag) => sum + (tag.shieldRemaining ?? 0), 0);
      if (expiredShield > 0 && healer.skillLevel >= 4) {
        const recovered = applyHealing(healer, healer, expiredShield * .8, battleLog);
        battleLog?.push(`  灵狐守护消失，${fighterLabel(healer)}恢复 ${Math.round(recovered)} 点生命。`);
      }
      healer.tags = healer.tags.filter(tag => tag.name !== '灵狐守护');
      const guardRatio = healer.skillLevel >= 2 ? 1.4 : .9;
      const guardAmount = effectiveStat(healer, 'attack') * guardRatio;
      addTimedShield(healer, guardAmount, '灵狐守护');
      const beforeFlames = healer.heartFlames;
      healer.heartFlames = 3;
      battleLog?.push(`  灵合：${fighterLabel(healer)}获得${Math.round(guardAmount)}点灵狐守护与3层心焰（${beforeFlames}→3，防御提高45%）。`);
    }
    if (healer.hpNow > 0 && healer.skills.some(skill => skill.name === '魔力追踪')) {
      const ownTurnChance = healer.skillLevel >= 2 ? 1 : .7;
      const gained = healer === actor ? random() < ownTurnChance
        : actor.side === healer.side && actor.spellUsed && healer.skillLevel >= 3;
      // 道符印记最多3层；封顶后不会再获得，也不触发对应的行动条推进。
      if (gained && healer.talismans < 3) {
        healer.talismans++;
        if (healer.skillLevel >= 4) changeActionBar(healer, 15, healer);
        battleLog?.push(`  ${fighterLabel(healer)}获得1张道符（共${healer.talismans}张）${healer.skillLevel >= 4 ? '，行动条推进15%' : ''}。`);
      }
    }
    if (healer === actor && healer.hpNow > 0 && activeSoul(healer) === '共潜') {
      const attempts = healer.dealtDamageThisTurn ? 1 : 3;
      let removed = 0;
      for (let index = 0; index < attempts; index++) {
        if (!cleanseRandomDebuff(units, healer.side, random, battleLog)) break;
        removed++;
      }
      if (removed) battleLog?.push(`  共潜回合结束驱散${removed}个友方减益${healer.dealtDamageThisTurn ? '' : '（本回合未造成伤害，额外驱散）'}。`);
    }
    if (healer === actor && healer.hpNow > 0 && activeSoul(healer) === '涂佛' && !healer.spellUsed) {
      for (const ally of units.filter(unit => unit.side === healer.side && unit.hpNow > 0)) {
        const amount = ally === healer ? .3 : .15;
        ally.effects = ally.effects.filter(effect => !(effect.source === '涂佛' && (effect.stat === 'resist' || effect.stat === 'damage')));
        ally.effects.push({ stat: 'resist', amount, turns: 2, source: '涂佛' });
        ally.effects.push({ stat: 'damage', amount, turns: 2, source: '涂佛' });
      }
      battleLog?.push(`  涂佛触发：${fighterLabel(healer)}本回合普攻或未能行动，友方获得效果抵抗与伤害提升15%，自身提升30%，持续2回合。`);
    }
    if (healer === actor && healer.hpNow > 0 && activeSoul(healer) === '钓瓶火') {
      const meter = orbMeters?.[healer.side];
      if (fire && meter) advanceOrbMeter(healer.side, fire, meter, 1, battleLog);
      const recipient = units.filter(unit => unit.side === healer.side && unit.hpNow > 0)
        .sort((a, b) => a.hpNow / currentMaxHp(a) - b.hpNow / currentMaxHp(b))[0];
      if (recipient) {
        const recovered = applyHealing(healer, recipient, effectiveStat(healer, 'defense') * 7, battleLog);
        battleLog?.push(`  钓瓶火触发：鬼火行动条额外推进1格；为生命比例最低的友方${fighterLabel(recipient)}恢复${Math.round(recovered)}点生命（携带者防御700%）。`);
      }
    }
    const healingSkill = healer.skills.find(skill => skill.name === '疗愈');
    const recipient = allowHealing && healer.hpNow > 0 && healer.herbs > 0 && healingSkill
      ? units.filter(unit => unit.side === healer.side && unit.hpNow > 0)
        .sort((a, b) => a.hpNow / currentMaxHp(a) - b.hpNow / currentMaxHp(b))[0]
      : undefined;
    if (healingSkill && recipient && recipient.hpNow / currentMaxHp(recipient) < .7) {
      const description = skillText(healingSkill, healer.skillLevel);
      const ratio = Number(/治疗攻击(\d+(?:\.\d+)?)%/.exec(description)?.[1] ?? 40) / 100;
      const recovered = applyHealing(healer, recipient, effectiveStat(healer, 'attack') * (ratio + healer.herbHealBonus), battleLog);
      healer.herbs--;
      changeActionBar(healer, 5, healer);
      battleLog?.push(`  自动治疗（疗愈）：${fighterLabel(healer)}消耗1株草药，为${fighterLabel(recipient)}恢复 ${Math.round(recovered)} 点生命（剩余草药 ${healer.herbs}，行动条+5%）。`);
    }
    if (healer.hpNow > 0 && healer.harmony > 0) {
      healer.harmony--;
      const target = healer.harmonyAllies.filter(unit => unit.hpNow > 0)
        .sort((a, b) => Number(Boolean(b.control)) - Number(Boolean(a.control))
          || (b.effects.filter(effect => effect.amount < 0).length + Number(b.tags.some(tag => tag.name === '死亡裁决')))
            - (a.effects.filter(effect => effect.amount < 0).length + Number(a.tags.some(tag => tag.name === '死亡裁决'))))[0];
      if (target) {
        let removed = 0;
        if (target.control) {
          battleLog?.push(`  和音驱散${fighterLabel(target)}的${target.control}。`);
          removeControl(target, battleLog);
          removed++;
        }
        while (removed < 2) {
          const debuff = target.effects.findIndex(effect => effect.amount < 0);
          if (debuff >= 0) {
            const [effect] = target.effects.splice(debuff, 1);
            battleLog?.push(`  和音驱散${fighterLabel(target)}的${statusLabel({ ...target, effects: [effect] })}。`);
            removed++;
            continue;
          }
          const mark = target.tags.findIndex(tag => tag.name === '死亡裁决');
          if (mark >= 0) {
            target.tags.splice(mark, 1);
            battleLog?.push(`  和音驱散${fighterLabel(target)}的死亡裁决。`);
            removed++;
            continue;
          }
          break;
        }
        if (healer.skillLevel >= 5 && removed > 0) applyResonanceWall(target, 2);
        battleLog?.push(`  ${fighterLabel(healer)}消耗1层和音（剩余${healer.harmony}层），${fighterLabel(target)}被驱散${removed}个减益/控制效果。`);
      }
    }
    if (healer === actor && healer.herbHealBonusTurns > 0) {
      healer.herbHealBonusTurns--;
      if (healer.herbHealBonusTurns === 0) healer.herbHealBonus = 0;
    }
  }
  for (const eater of units.filter(unit => unit.hpNow > 0 && unit.heroId === 370 && passiveActive(unit)
    && unit.skills.some(skill => skill.name === '蓄食待发') && !unit.control)) {
    const friendlyTurn = actor.side === eater.side;
    const appetiteEnemyTurn = actor.side !== eater.side && eater.tags.some(tag => tag.name === '食欲大增');
    if (friendlyTurn || appetiteEnemyTurn) {
      eater.foodStacks = Math.min(10, eater.foodStacks + 1);
      battleLog?.push(`  饭笥「储备粮」被动触发：${fighterLabel(eater)}获得1层储备粮（${eater.foodStacks}/10）。`);
    }
  }
  if (actor.hpNow > 0 && actor.tags.some(tag => tag.name === '齿甲')) {
    actor.tags = actor.tags.filter(tag => tag.name !== '齿甲');
    const whale = units.find(unit => unit.side === actor.side && unit.heroId === 324 && unit.hpNow > 0);
    if (whale) {
      const teethSkill = whale.skills.find(skill => skill.name === '齿甲');
      const text = teethSkill ? skillText(teethSkill, whale.skillLevel) : '';
      const ratio = Number(/生命上限(\d+(?:\.\d+)?)%真实伤害/.exec(text)?.[1] ?? 12) / 100;
      for (const target of units.filter(unit => unit.side !== actor.side && unit.hpNow > 0)) {
        const damage = Math.min(currentMaxHp(target) * ratio, effectiveStat(actor, 'attack'));
        const actual = applyTrueDamage(target, damage);
        battleLog?.push(`  齿甲触发：${fighterLabel(actor)}行动后，化鲸攻击${fighterLabel(target)}造成${Math.round(actual)}点真实伤害（生命上限${Math.round(currentMaxHp(target) * ratio)}，携带者攻击上限${Math.round(effectiveStat(actor, 'attack'))}）。`);
      }
    }
  }
  if (actor.hpNow > 0 && activeSoul(actor) === '轮入道' && random() < .2) {
    changeActionBar(actor, 100, actor);
    battleLog?.push(`  轮入道触发，${fighterLabel(actor)}获得新的回合。`);
  }
  if (actor.hpNow > 0 && activeSoul(actor) === '兵主部') {
    const before = actor.bladeStacks;
    actor.bladeStacks = Math.min(3, actor.bladeStacks + 1);
    if (actor.bladeStacks > before) battleLog?.push(`  兵主部：${fighterLabel(actor)}获得1层兵刃（${actor.bladeStacks}/3），每层攻击无视75点防御。`);
  }
  if (actor.hpNow > 0 && activeSoul(actor) === '无刀取') {
    const before = actor.permanentDamageBonus;
    actor.permanentDamageBonus = Math.min(.45, actor.permanentDamageBonus + .15);
    if (actor.permanentDamageBonus > before) battleLog?.push(`  无刀取：${fighterLabel(actor)}永久伤害提高15%（当前${Math.round(actor.permanentDamageBonus * 100)}%，上限45%）。`);
  }
  if (actor.hpNow > 0 && actor.bondedAlly && actor.bondedAlly.hpNow > 0) {
    const partner = actor.bondedAlly;
    if (actor.skills.some(skill => skill.name === '守缘刃') && !actor.bondOwnerBoostUsed) {
      changeActionBar(partner, 30, actor);
      actor.bondOwnerBoostUsed = true;
      battleLog?.push(`  胜天之缘：${fighterLabel(actor)}回合结束，为${fighterLabel(partner)}推进30%行动条。`);
    } else if (!actor.skills.some(skill => skill.name === '守缘刃') && !partner.bondTargetBoostUsed) {
      changeActionBar(partner, 30, actor);
      partner.bondTargetBoostUsed = true;
      battleLog?.push(`  胜天之缘：${fighterLabel(actor)}回合结束，为${fighterLabel(partner)}推进30%行动条。`);
    }
  }
}

function resolveFoxFollowUps(foxes: Fighter[], targets: Fighter[], hpBeforeAction: Map<Fighter, number>, random: () => number, battleLog?: string[], fire?: { blue: number; red: number }): void {
  for (const fox of foxes) {
    if (fox.hpNow <= 0 || fox.control || fox.heartFlames <= 0 || !fox.skills.some(skill => skill.name === '灵合')) continue;
    for (const target of targets) {
      const before = hpBeforeAction.get(target) ?? target.hpNow;
      const lost = before - target.hpNow;
      if (before <= 0 || lost < target.hp * .1 || lost / before <= .25 || target.hpNow <= 0) continue;
      fox.heartFlames--;
      fox.foxSameTargetCount = fox.foxLastTarget === target ? fox.foxSameTargetCount + 1 : 0;
      fox.foxLastTarget = target;
      const damage = resolveHit(fox, target, .168 * Math.pow(.7, fox.foxSameTargetCount), random, 0, true, fire?.[fox.side] ?? 0, false, battleLog, fire);
      if (fox.skillLevel >= 3) changeActionBar(fox, 10, target);
      battleLog?.push(`  心焰触发汲魄：${fighterLabel(fox)}对${fighterLabel(target)}造成 ${Math.round(damage)} 点伤害，消耗1层心焰（剩余${fox.heartFlames}）${fox.skillLevel >= 3 ? '，行动条推进10%' : ''}。`);
    }
  }
}

function takeTurn(attacker: Fighter, allies: Fighter[], enemies: Fighter[], fire: { blue: number; red: number }, random: () => number, battleLog?: string[], round = 1, automaticBellFire = false): boolean {
  attacker.starfireOpeningSpeedPending = false;
  attacker.oniStanceEnteredThisTurn = false;
  attacker.woodCharmTriggered = false;
  attacker.guardedAttack = false;
  attacker.guardedTarget = undefined;
  attacker.guardOwner = undefined;
  attacker.dealtDamageThisTurn = false;
  attacker.himeFireTriggeredThisAction = false;
  if (attacker.tags.some(tag => tag.name === '拘魂')) {
    battleLog?.push(`行动 ${round}｜${fighterLabel(attacker)}受「拘魂」影响，无法行动。`);
    return false;
  }
  if (attacker.heroId === 370 && attacker.foodStacks >= 10 && attacker.control && passiveActive(attacker)) {
    const before = attacker.foodStacks;
    attacker.foodStacks = Math.max(0, attacker.foodStacks - 5);
    removeControl(attacker, battleLog);
    battleLog?.push(`  饭笥「胃口大开·吞食天地」触发：消耗5层储备粮（${before}→${attacker.foodStacks}）并解除自身控制。`);
  }
  if (activeSoul(attacker) === '尘冢') {
    const friendlyCount = allies.filter(unit => unit.hpNow > 0).length;
    const enemyCount = enemies.filter(unit => unit.hpNow > 0).length;
    const bonus = Math.min(.45, .25 + Math.max(0, friendlyCount - enemyCount) * .04);
    attacker.effects = attacker.effects.filter(effect => effect.source !== '尘冢');
    attacker.effects.push({ stat: 'damage', amount: bonus, turns: 1, source: '尘冢' });
    battleLog?.push(`  尘冢：${fighterLabel(attacker)}本次行动伤害提高${Math.round(bonus * 100)}%（存活友方${friendlyCount}、敌方${enemyCount}）。`);
  }
  attacker.spellUsed = false;
  if (attacker.skills.some(skill => skill.name === '清辉月华')) attacker.tags = attacker.tags.filter(tag => tag.name !== '庇护');
  const silenced = attacker.controlTurns > 0 && attacker.control === '沉默';
  if (attacker.controlTurns > 0 && !silenced) {
    battleLog?.push(`行动 ${round}｜${fighterLabel(attacker)}受${attacker.control}控制，跳过行动。`);
    attacker.controlTurns--;
    if (attacker.control === '混乱') {
      const confusedTarget = allies.filter(unit => unit.hpNow > 0).sort((a, b) => a.hpNow / currentMaxHp(a) - b.hpNow / currentMaxHp(b))[0];
      if (confusedTarget) resolveHit(attacker, confusedTarget, .125, random, 0, true, fire[attacker.side], false, battleLog, fire);
      removeControl(attacker, battleLog);
      return false;
    }
    if (attacker.control === '嘲讽') {
      const taunter = enemies.filter(unit => unit.hpNow > 0 && unit.control === '嘲讽')[0];
      if (taunter) resolveHit(attacker, taunter, .125, random, 0, true, fire[attacker.side], false, battleLog, fire);
      removeControl(attacker, battleLog);
      return false;
    }
    removeControl(attacker, battleLog);
    return false;
  }
  if (activeSoul(attacker) === '招财猫' && random() < .5) {
    const before = fire[attacker.side];
    const inaba = allies.find(unit => unit.hpNow > 0 && unit.heroId === 372 && unit.skillLevel >= 2
      && passiveActive(unit) && unit.tags.some(tag => tag.name === '因幡辉夜姬幻境'));
    if (inaba) {
      const gained = Math.min(2, 8 - inaba.inabaWishPower);
      inaba.inabaWishPower += gained;
      inaba.inabaWishProvided += gained;
      battleLog?.push(`  招财猫鬼火转为因幡辉夜姬愿力 +${gained}（${inaba.inabaWishPower}/8，累计提供${inaba.inabaWishProvided}）。`);
    } else {
      fire[attacker.side] = Math.min(8, before + 2);
      battleLog?.push(`  招财猫触发：${fighterLabel(attacker)}获得${fire[attacker.side] - before}点鬼火（${before}→${fire[attacker.side]}）。`);
    }
  }
  const availableFire = fire[attacker.side];
  const availableSkillFire = availableFire + (activeSoul(attacker) === '遗念火' ? attacker.remnantFlame : 0)
    + (attacker.heroId === 372 ? attacker.inabaWishPower : 0);
  const allSkills = attacker.skills.flatMap(skill => [skill, ...skill.extraSkills]);
  const usable = silenced ? [] : allSkills.filter(skill => skill.type === 3 && skill.cost > 0
    && !(attacker.oniStanceTurns > 0 && skill.name === '天火怒焱')
    && !(attacker.heroId === 585 && skill.name === '黄泉战旗' && attacker.hpNow / currentMaxHp(attacker) < .3)
    && skillCost(skill, attacker.skillLevel, attacker) <= availableSkillFire);
  const livingAllies = allies.filter(unit => unit.hpNow > 0);
  const livingEnemies = enemies.filter(unit => unit.hpNow > 0);
  if (attacker.heroId === 357) attacker.swiftWindCritDamage = attacker.swiftWindValue;
  if (attacker.heroId === 357 && !silenced && livingEnemies.length) {
    const lowestAlly = livingAllies.slice().sort((a, b) => a.hpNow / currentMaxHp(a) - b.hpNow / currentMaxHp(b))[0];
    const helperSkill = attacker.swiftWindValue >= 80 ? '迅·击空'
      : lowestAlly && lowestAlly.hpNow / currentMaxHp(lowestAlly) < .2 ? '迅·庇羽' : '迅·猎目';
    if (helperSkill === '迅·击空') {
      const target = livingEnemies.slice().sort((a, b) => a.hpNow / currentMaxHp(a) - b.hpNow / currentMaxHp(b))[0];
      const spent = Math.min(60, attacker.swiftWindValue);
      attacker.swiftWindValue -= spent;
      if (target) resolveHit(attacker, target, 2.4, random, 0, true, availableFire, false, battleLog, fire);
      battleLog?.push(`  迅风协战「迅·击空」，消耗${spent}点行动值（余${attacker.swiftWindValue}）。`);
    } else if (helperSkill === '迅·庇羽' && lowestAlly) {
      addTimedShield(lowestAlly, effectiveStat(attacker, 'attack') * .75, '迅·庇羽护盾', 2);
      lowestAlly.effects.push({ stat: 'critResist', amount: 1, turns: 2, source: '迅·庇羽' });
      attacker.swiftWindValue += 40;
      changeActionBar(attacker, 40, attacker);
      battleLog?.push(`  迅风协战「迅·庇羽」，保护生命比例最低的友方${fighterLabel(lowestAlly)}，行动值升至${attacker.swiftWindValue}。`);
    } else {
      const target = livingEnemies.slice().sort((a, b) => a.hpNow / currentMaxHp(a) - b.hpNow / currentMaxHp(b))[0];
      if (target) {
        for (const stat of ['attack', 'defense', 'speed'] as const) target.effects.push({ stat, amount: -.35, turns: 2, source: '迅·猎目' });
        target.tags.push({ name: '迅·猎目', turns: 2 });
      }
      attacker.swiftWindValue += 40;
      changeActionBar(attacker, 40, attacker);
      battleLog?.push(`  迅风协战「迅·猎目」${target ? `，锁定${fighterLabel(target)}` : ''}，行动值升至${attacker.swiftWindValue}。`);
    }
  }
  let aiSkillName: string | undefined;
  let aiBasicSkillName: string | undefined;
  let suppressPaidSkill = false;
  const matchesSlot = (skill: HeroSkill, slot: number) => skill.type === 3
    && (slot === 10 ? Math.floor(skill.id / 10) === attacker.heroId : skill.id % 10 === slot);
  const referenceSkill = (slot: number) => attacker.skills.find(skill => matchesSlot(skill, slot))
    ?? allSkills.find(skill => matchesSlot(skill, slot));
  const chooseReferenceSlot = (slot: number) => {
    const selected = referenceSkill(slot);
    if (!selected) return;
    suppressPaidSkill = true;
    const freeCast = selected.cost === 0 && (selected.description.includes('【施放】') || [356, 383].includes(attacker.heroId)
      || attacker.heroId === 585 && selected.name === '黄泉战旗')
      && [334, 356, 371, 383, 584, 585].includes(attacker.heroId);
    if (slot === 1 || selected.cost === 0 && !freeCast) {
      aiSkillName = undefined;
      aiBasicSkillName = selected.name;
    } else {
      aiSkillName = selected.name;
      aiBasicSkillName = undefined;
    }
  };
  const allyHpRatio = livingAllies.map(unit => unit.hpNow / currentMaxHp(unit));
  const lowestAllyHpRatio = Math.min(...allyHpRatio);
  // Every catalog shikigami gets an explicit baseline AI choice: prefer its
  // third active skill as the in-game auto AI does. Per-shikigami conditions
  // below replace this default; if the preferred skill cannot be used, basic
  // attack remains the fallback.
  chooseReferenceSlot(3);
  // The wiki lists explicit release decisions for these legacy units. Most
  // entries are unconditional slot-3 casts and naturally use the default;
  // these branches cover their conditional choices.
  if (attacker.heroId === 253) { // 吸血姬
    chooseReferenceSlot(attacker.hpNow / currentMaxHp(attacker) < .6 ? 3 : 1);
  } else if ([249, 246, 231, 225, 218].includes(attacker.heroId)) { // AoE only with targets/fire
    chooseReferenceSlot(livingEnemies.length >= 2 || availableFire > 5 ? 3 : 1);
  } else if (attacker.heroId === 236) { // 管狐
    chooseReferenceSlot(attacker.hpNow / currentMaxHp(attacker) >= .4 ? 3 : 2);
  } else if (attacker.heroId === 233) { // 跳跳哥哥
    chooseReferenceSlot(allies.some(unit => unit.hpNow <= 0) ? 3 : 2);
  } else if ([241, 213].includes(attacker.heroId)) { // 蝴蝶精、童女
    const threshold = attacker.heroId === 241 ? .75 : .6;
    chooseReferenceSlot(lowestAllyHpRatio < threshold ? 3 : 1);
  } else if (attacker.heroId === 219) { // 酒吞童子
    chooseReferenceSlot(attacker.hpNow / currentMaxHp(attacker) <= .25 ? 3 : 1);
  } else if (attacker.heroId === 257) { // 食梦貘
    const healingDebuffs = livingEnemies.reduce((count, unit) => count + unit.tags.filter(tag => (tag.healingReduction ?? 0) > 0).length, 0);
    chooseReferenceSlot(healingDebuffs < 2 ? 3 : 1);
  } else if (attacker.heroId === 205) { // 座敷童子
    chooseReferenceSlot(availableFire < 6 ? 3 : 1);
  } else if (attacker.heroId === 201) { // 雪女
    if (livingEnemies.length >= 2) chooseReferenceSlot(3);
    else if (availableFire > 5) chooseReferenceSlot(random() < .5 ? 3 : 1);
    else if (availableFire >= 3) chooseReferenceSlot(random() < .2727 ? 3 : 1);
    else chooseReferenceSlot(1);
  } else if (attacker.heroId === 200) { // 桃花妖
    const canRevive = allies.some(unit => unit.hpNow <= 0);
    const atLeastOneBelow65 = allyHpRatio.some(ratio => ratio < .65);
    const below80 = allyHpRatio.some(ratio => ratio < .8);
    chooseReferenceSlot(canRevive ? 3 : atLeastOneBelow65 ? 2
      : below80 && random() < .75 ? 2 : 1);
  } else if (attacker.heroId === 211) { // 鬼使黑
    const enemyLow = livingEnemies.some(unit => unit.hpNow / currentMaxHp(unit) < .2);
    const enemyAbove40 = livingEnemies.some(unit => unit.hpNow / currentMaxHp(unit) > .4);
    chooseReferenceSlot(!enemyLow && livingEnemies.length >= 2 && enemyAbove40 ? 3 : 1);
  } else if (attacker.heroId === 259) { // 小鹿男
    const hasGrowthBuff = livingAllies.some(unit => unit.tags.some(tag => tag.name.includes('生生不息'))
      || unit.effects.some(effect => effect.source?.includes('生生不息')));
    chooseReferenceSlot(hasGrowthBuff ? 3 : 1);
  } else if (attacker.heroId === 234) { // 椒图
    const linked = livingAllies.some(unit => unit.tags.some(tag => tag.name.includes('生命链接')));
    chooseReferenceSlot(linked ? 1 : 3);
  } else if (attacker.heroId === 232) { // 铁鼠
    const flawCount = livingEnemies.reduce((count, unit) => count + unit.tags.filter(tag => tag.name.includes('破绽')).length, 0);
    chooseReferenceSlot(availableFire > 5 ? (flawCount >= 6 ? 1 : 3)
      : livingEnemies.length < 2 || flawCount > 0 ? 1 : 3);
  } else if (attacker.heroId === 221) { // 食发鬼
    if (livingEnemies.length < 2) chooseReferenceSlot(1);
    else if (availableFire > 5) chooseReferenceSlot(3);
    else if (availableFire > 3 && availableFire < 5) chooseReferenceSlot(random() < .5 ? 2 : 1);
    else chooseReferenceSlot(1);
  } else if (attacker.heroId === 220) { // 犬神
    chooseReferenceSlot(availableFire >= 3 && random() < .5 ? 3 : 1);
  } else if (attacker.heroId === 215) { // 孟婆
    if (livingEnemies.length >= 2 && availableFire >= 3 || livingEnemies.length === 1 && availableFire > 5) chooseReferenceSlot(3);
    else if (availableFire < 3) chooseReferenceSlot(random() < .5 ? 2 : 1);
  } else if (attacker.heroId === 208) { // 狸猫：酒气越多，越倾向3技能
    const drunk = livingEnemies.reduce((count, unit) => count + unit.tags.filter(tag => tag.name.includes('酒气')).length, 0);
    const skillThreeWeight = .85 + .1 * drunk;
    const skillOneWeight = .8 + random() * .4;
    chooseReferenceSlot(random() * (skillOneWeight + skillThreeWeight) < skillThreeWeight ? 3 : 1);
  } else if (attacker.heroId === 206) { // 鲤鱼精
    const allShielded = livingAllies.every(unit => unit.tags.some(tag => tag.name.includes('鲤鱼精') && tag.name.includes('护盾')));
    chooseReferenceSlot(allShielded ? 3 : 2);
  } else if (attacker.heroId === 203) { // 灯笼鬼
    const buffed = livingAllies.some(unit => unit.tags.some(tag => tag.name.includes('大鬼笼')));
    chooseReferenceSlot(buffed ? 1 : 3);
  } else if ([559, 399, 397, 395, 387, 386, 385, 384, 378, 375, 373, 342, 340, 339, 338, 337, 336, 335,
    332, 328, 319, 318, 314, 313, 312, 311, 310, 309, 308, 305, 297, 296, 294, 292, 290,
    281, 278, 277, 276, 275, 274, 273, 271, 269, 268, 265, 263, 262,
    260, 258, 255, 254, 252, 250, 248, 247, 245, 244, 243, 242, 238, 237,
    230, 228, 227, 226, 224, 223, 222, 217, 216, 214, 212, 210, 209, 207, 202].includes(attacker.heroId)) {
    // These entries specify an unconditional slot-3 cast on the reference page.
    chooseReferenceSlot(3);
  }
  // Auto-battle policies from the Shikigami AI reference. Keep them explicit:
  // choosing the most expensive available skill is not how several units behave.
  if (attacker.skills.some(skill => skill.name === '明月潮生')) {
    aiSkillName = livingAllies.length >= 2 ? '清辉月华' : undefined;
    suppressPaidSkill = livingAllies.length < 2;
  } else if (attacker.skills.some(skill => skill.name === '余音')) {
    aiSkillName = livingEnemies.length >= 2 || fire[attacker.side] > 5 ? '疯魔琴心' : '余音';
  } else if (attacker.skills.some(skill => skill.name === '无情')) {
    const hasVerdict = livingEnemies.some(unit => unit.tags.some(tag => tag.name === '死亡裁决'));
    // The AI reference says 判官 uses skill 3 until any enemy has 死亡裁决,
    // then switches to its basic attack. Enemy count and unrelated marks do
    // not change that decision.
    aiSkillName = hasVerdict ? undefined : '死亡宣告';
    if (hasVerdict) aiBasicSkillName = referenceSkill(1)?.name;
    suppressPaidSkill = hasVerdict;
  } else if (attacker.skills.some(skill => skill.name === '爆炸之咒')) {
    const shouldUseDance = livingEnemies.length >= 2 || fire[attacker.side] > 5;
    aiSkillName = shouldUseDance ? '死亡之舞' : undefined;
    suppressPaidSkill = !shouldUseDance;
  } else if (attacker.skills.some(skill => skill.name === '守缘刃')) {
    aiSkillName = attacker.bondedAlly ? '与世结缘' : '守缘刃';
    // When the preferred second cast is out of fire, do not fall back to
    // 守缘刃: that would immediately break the bond the AI just created.
    suppressPaidSkill = Boolean(attacker.bondedAlly);
  } else if (attacker.skills.some(skill => skill.name === '和音回响')) {
    aiSkillName = '律动巡游';
  } else if (attacker.skills.some(skill => skill.name === '魔力追踪')) {
    aiSkillName = '雷帝招来';
  } else if (attacker.skills.some(skill => skill.name === '猫老师的守护')) {
    aiSkillName = '疗愈的药草';
  } else if (attacker.skills.some(skill => skill.name === '灵合')) {
    aiSkillName = '狐惑魅影';
  } else if (attacker.skills.some(skill => skill.name === '红莲')) {
    aiSkillName = attacker.oniStanceTurns > 0 ? undefined : '天火怒焱';
  } else if (attacker.skills.some(skill => skill.name === '铃焰灼心')) {
    aiBasicSkillName = '五山火祭';
  } else if (attacker.heroId === 557) { // 伊邪那美：我方存在毁灭时施放3技能，否则施放2技能
    const hasDestruction = livingAllies.some(unit => unit.tags.some(tag => tag.name.includes('毁灭')));
    chooseReferenceSlot(hasDestruction ? 3 : 2);
  } else if (attacker.heroId === 564) { // 镜音铃·连：友方均高于50%时施放2技能，否则施放3技能
    chooseReferenceSlot(livingAllies.every(unit => unit.hpNow / currentMaxHp(unit) > .5) ? 2 : 3);
  } else if (attacker.heroId === 569) { // 猫川：猫砂盆不在场时召唤，已在场时普攻
    const hasLitterBox = livingAllies.some(unit => unit.tags.some(tag => tag.name === '别馆私汤'));
    chooseReferenceSlot(hasLitterBox ? 1 : 3);
  } else if (attacker.heroId === 570) { // 祸津神：消耗完咒纱后解锁祸咒
    const hasCurseVeil = attacker.tags.some(tag => tag.name === '咒纱');
    chooseReferenceSlot(hasCurseVeil ? 2 : 3);
  } else if (attacker.heroId === 280) { // 辉夜姬：幻境不存在或将结束时重开，否则普攻
    const illusion = attacker.tags.find(tag => tag.name === '辉夜姬幻境');
    chooseReferenceSlot(!illusion || illusion.turns <= 1 ? 3 : 1);
  } else if (attacker.heroId === 372) { // 因幡辉夜姬：幻境不存在或将结束时重开，否则群攻
    const illusion = attacker.tags.find(tag => tag.name === '因幡辉夜姬幻境');
    chooseReferenceSlot(!illusion || illusion.turns <= 1 ? 2 : 3);
  } else if (attacker.heroId === 376) { // 铃彦姬：生命高于50%用3技能，低于或等于50%用2技能
    chooseReferenceSlot(attacker.hpNow / currentMaxHp(attacker) > .5 ? 3 : 2);
  } else if (attacker.heroId === 377) { // 梦寻山兔：梦忍法未满9篇时布置炸弹，满层后群攻
    const dreamPages = attacker.tags.filter(tag => tag.name === '梦忍法').length;
    chooseReferenceSlot(dreamPages >= 9 ? 3 : 2);
  } else if (attacker.heroId === 382) { // 灵海蝶：友方有人低于75%时治疗，否则普攻
    chooseReferenceSlot(livingAllies.some(unit => unit.hpNow / currentMaxHp(unit) < .75) ? 3 : 1);
  } else if (attacker.heroId === 316) { // 白藏主：友方没有狐影结界时开启，否则普攻
    const allProtected = livingAllies.every(unit => unit.tags.some(tag => tag.name === '狐影结界'));
    chooseReferenceSlot(allProtected ? 1 : 3);
  } else if (attacker.heroId === 317) { // 人面树：敌方无灾厄花时施放祸根，否则普攻
    const enemyHasDisasterFlower = livingEnemies.some(unit => unit.tags.some(tag => tag.name === '灾厄花'));
    chooseReferenceSlot(enemyHasDisasterFlower ? 1 : 3);
  } else if (attacker.heroId === 334) { // 骁浪荒川之主：累积海怒，达到3层后使用海作斩
    const seaRage = attacker.tags.filter(tag => tag.name === '海怒').length;
    chooseReferenceSlot(seaRage >= 3 ? 3 : 2);
  } else if (attacker.heroId === 304) { // 御馔津：结界存续时普攻；结界结束后按灵符决策
    const markedMiko = livingAllies.filter(unit => unit.heroId === 304
      && unit.tags.some(tag => tag.name === '御馔津灵符'));
    const fieldActive = attacker.tags.some(tag => tag.name === '御馔津狐狩界');
    chooseReferenceSlot(fieldActive ? 1 : markedMiko.length === 0 || markedMiko.length === 1 && random() < .5 ? 2 : 3);
  } else if (attacker.heroId === 390) { // 神启荒：星辰之力达到3层后施放星流霆击
    const stars = attacker.tags.filter(tag => tag.name === '星辰之力').length;
    chooseReferenceSlot(stars >= 3 ? 3 : 2);
  } else if (attacker.heroId === 353) { // 紧那罗：优先弹奏本回目尚未施放的律音，齐全后急奏
    const melodies = ['宫·赤之霞', '商·山吹', '角·神宫华辉', '徵·薰风', '羽·澈'];
    const played = new Set(attacker.tags.filter(tag => tag.name.startsWith('紧那罗已弹·')).map(tag => tag.name.slice('紧那罗已弹·'.length)));
    const nextMelody = melodies.find(name => !played.has(name));
    if (nextMelody) {
      const skillTwo = referenceSkill(2);
    if (skillTwo && skillCost(skillTwo, attacker.skillLevel) <= availableSkillFire) {
        aiSkillName = nextMelody;
        suppressPaidSkill = true;
      } else chooseReferenceSlot(1);
    } else {
      aiSkillName = '急';
      suppressPaidSkill = true;
    }
  } else if (attacker.heroId === 371) { // 川猿：按顺序变幻三种形态
    const forms = ['你是坏人', '别再追我啦', '快躲起来'];
    const usedForms = attacker.tags.filter(tag => tag.name.startsWith('川猿已变·')).length;
    const nextForm = attacker.skills.flatMap(skill => skill.extraSkills ?? []).find(skill => skill.name === forms[usedForms]);
    if (nextForm && skillCost(nextForm, attacker.skillLevel) <= availableSkillFire) {
      aiSkillName = nextForm.name;
      suppressPaidSkill = true;
    } else chooseReferenceSlot(1);
  } else if (attacker.heroId === 392) { // 季：先累积四季流转并开启结界，满4层后使用大葬
    const seasons = attacker.tags.filter(tag => tag.name === '四季流转').length;
    const hasCorner = attacker.tags.some(tag => tag.name === '四时一隅');
    if (seasons < 4 || !hasCorner) {
      const skillTwo = referenceSkill(2);
      if (skillTwo && skillCost(skillTwo, attacker.skillLevel) <= availableSkillFire) {
        aiSkillName = '四时一隅·秋';
        suppressPaidSkill = true;
      } else chooseReferenceSlot(1);
    } else {
      const skillThree = referenceSkill(3);
      if (skillThree && skillCost(skillThree, attacker.skillLevel) <= availableSkillFire) {
        aiSkillName = '四季大葬';
        suppressPaidSkill = true;
      } else chooseReferenceSlot(1);
    }
  } else if (attacker.heroId === 566) { // 晨晖惠比寿：无条件施放3技能
    chooseReferenceSlot(3);
  } else if (attacker.heroId === 561) { // 泷：戒备未达3层前积累，达到后决荡
    chooseReferenceSlot(attacker.vigilanceLayers >= 3 ? 3 : 2);
  } else if (attacker.heroId === 583) { // 卑弥呼：先把友方溯回时隙转为时之隙，否则使用3技能
    const allyNeedsTimeGap = livingAllies.some(unit => unit.tags.some(tag => tag.name === '溯回时隙')
      && !unit.tags.some(tag => tag.name === '时之隙'));
    chooseReferenceSlot(allyNeedsTimeGap ? 3 : 2);
  } else if (attacker.heroId === 584) { // 时曜泷夜叉姬：先进入时之隙，再施放烬时之斩
    const inTimeGap = attacker.tags.some(tag => tag.name === '时之隙');
    chooseReferenceSlot(inTimeGap ? 3 : 2);
  } else if (attacker.heroId === 585) { // 荒骷髅：血色之花转移后改为战旗攻击
    const highestAttackAlly = livingAllies.slice().sort((a, b) => effectiveStat(b, 'attack') - effectiveStat(a, 'attack'))[0];
    chooseReferenceSlot(highestAttackAlly && !highestAttackAlly.tags.some(tag => tag.name === '血色之花') ? 2 : 3);
  } else if (attacker.heroId === 563) { // 初音未来：先序幕，后盛幕；不施放中幕
    const selected = allSkills.find(skill => skill.name === (attacker.mikuOpeningUsed ? '音之舞曲·盛幕' : '音之舞曲·序幕'));
    if (selected && skillCost(selected, attacker.skillLevel) <= availableSkillFire) {
      aiSkillName = selected.name;
      suppressPaidSkill = true;
    } else {
      aiBasicSkillName = '音弦动';
      suppressPaidSkill = true;
    }
  } else if (attacker.heroId === 578) { // 神酿星熊童子：敌方无增益时开宴，否则协助攻击
    const enemyHasBuff = livingEnemies.some(unit => unit.effects.some(effect => effect.amount > 0)
      || unit.tags.some(tag => /buff|护盾|庇护|祝福|增益/.test(tag.name)));
    chooseReferenceSlot(enemyHasBuff ? 2 : 3);
  } else if (attacker.heroId === 261) { // 镰鼬：队伍尚无二哥呼哨时拉条，否则普攻
    const hasBrotherWhistle = livingAllies.some(unit => unit.tags.some(tag => tag.name === '二哥呼哨'));
    chooseReferenceSlot(hasBrotherWhistle ? 1 : 3);
  } else if (attacker.heroId === 270) { // 络新妇：敌方至少2人或鬼火充足时3技能，否则普攻
    chooseReferenceSlot(livingEnemies.length >= 2 || availableFire > 5 ? 3 : 1);
  } else if (attacker.heroId === 288) { // 彼岸花：仅有一名彼岸花时施放3技能
    chooseReferenceSlot(livingAllies.filter(unit => unit.heroId === 288).length === 1 ? 3 : 1);
  } else if (attacker.heroId === 293) { // 百目鬼：敌方仍有未凝视目标时3技能，否则普攻
    const hasUnwatchedEnemy = livingEnemies.some(unit => !unit.tags.some(tag => tag.name.includes('凝视')));
    chooseReferenceSlot(hasUnwatchedEnemy ? 3 : 1);
  } else if (attacker.heroId === 298) { // 薰：至少2名友方存活时3技能，否则普攻
    chooseReferenceSlot(livingAllies.length >= 2 ? 3 : 1);
  } else if (attacker.heroId === 306) { // 虫师：友方血线均高于70%时普攻，否则治疗
    chooseReferenceSlot(livingAllies.some(unit => unit.hpNow / currentMaxHp(unit) < .7) ? 3 : 1);
  } else if (attacker.heroId === 307) { // 猫掌柜：至少2名敌方且均高于70%时先召来，否则乱斗
    chooseReferenceSlot(livingEnemies.length >= 2 && livingEnemies.every(unit => unit.hpNow / currentMaxHp(unit) > .7) ? 2 : 3);
  } else if (attacker.heroId === 300) { // 玉藻前：敌方至少2人时3技能，单体时2技能
    chooseReferenceSlot(livingEnemies.length >= 2 ? 3 : 2);
  } else if (attacker.heroId === 301) { // 数珠：友方都未打坐时3技能，否则普攻
    chooseReferenceSlot(livingAllies.some(unit => unit.tags.some(tag => tag.name.includes('打坐'))) ? 1 : 3);
  } else if (attacker.heroId === 302) { // 小袖之手：优先2技能，鬼火不足时回退3技能
    const skillTwo = referenceSkill(2);
    chooseReferenceSlot(skillTwo && skillCost(skillTwo, attacker.skillLevel) <= availableSkillFire ? 2 : 3);
  } else if (attacker.heroId === 303) { // 弈：无条件3技能
    chooseReferenceSlot(3);
  } else if (attacker.heroId === 324) { // 化鲸：友方低于40%时施放体甲
    const lowAlly = livingAllies.some(unit => unit.hpNow / currentMaxHp(unit) < .4);
    const anyTeethArmor = livingAllies.some(unit => unit.tags.some(tag => tag.name.includes('齿甲')));
    chooseReferenceSlot(lowAlly ? 3 : anyTeethArmor ? 1 : 2);
  } else if (attacker.heroId === 325) { // 八岐大蛇：优先3技能，鬼火不足时2技能
    const skillThree = referenceSkill(3);
    chooseReferenceSlot(skillThree && skillCost(skillThree, attacker.skillLevel) <= availableSkillFire ? 3 : 2);
  } else if (attacker.heroId === 331) { // 御怨般若：封印结界可用时优先2技能，否则3技能
    const skillTwo = referenceSkill(2);
    chooseReferenceSlot(skillTwo && skillCost(skillTwo, attacker.skillLevel) <= availableSkillFire ? 2 : 3);
  } else if (attacker.heroId === 326) { // 稻荷神御馔津：优先2技能，其不可用时3技能
    const skillTwo = referenceSkill(2);
    chooseReferenceSlot(skillTwo && skillCost(skillTwo, attacker.skillLevel) <= availableSkillFire ? 2 : 3);
  } else if (attacker.heroId === 327) { // 苍风一目连：风盾未覆盖全队时2技能，覆盖后3技能
    const allHaveWindShield = livingAllies.every(unit => unit.tags.some(tag => tag.name.includes('风盾')));
    chooseReferenceSlot(allHaveWindShield ? 3 : 2);
  } else if (attacker.heroId === 343) { // 天剑韧心鬼切：先2技能，之后3技能
    chooseReferenceSlot(attacker.shinkenBondUsed ? 3 : 2);
  } else if (attacker.heroId === 344) { // 云外镜：鬼火不足且被缴械时2技能，否则3技能
    const disarmed = attacker.tags.some(tag => tag.name.includes('缴械'));
    const skillThree = attacker.skills.find(skill => skill.name === '云岸净空');
    const needSwitch = disarmed && skillThree && skillCost(skillThree, attacker.skillLevel, attacker) > availableSkillFire;
    aiSkillName = needSwitch
      ? attacker.cloudYang ? '昭回' : '斗转'
      : attacker.cloudYang ? '苦海浮生' : '云岸净空';
    aiBasicSkillName = attacker.cloudYang ? '昙无' : undefined;
    suppressPaidSkill = false;
  } else if (attacker.heroId === 396) { // 修罗鬼童丸：无魂网时2技能，有魂网时3技能
    const hasSoulNet = attacker.tags.some(tag => tag.name.includes('魂网'));
    chooseReferenceSlot(hasSoulNet ? 3 : 2);
  } else if (attacker.heroId === 346) { // 聆海金鱼姬：至少2名友方存活时3技能，否则普攻
    chooseReferenceSlot(livingAllies.length >= 2 ? 3 : 1);
  } else if (attacker.heroId === 321) { // 入殓师：优先3技能，鬼火不足时2技能
    const skillThree = referenceSkill(3);
    chooseReferenceSlot(skillThree && skillCost(skillThree, attacker.skillLevel) <= availableSkillFire ? 3 : 2);
  } else if (attacker.heroId === 320) { // 一反木绵：敌方无人被缠绕时先施放雪织
    const hasWrappedEnemy = livingEnemies.some(unit => unit.tags.some(tag => tag.name.includes('缠绕')));
    const enemyBelow30 = livingEnemies.some(unit => unit.hpNow / currentMaxHp(unit) < .3);
    chooseReferenceSlot(hasWrappedEnemy || enemyBelow30 ? 3 : 2);
  } else if (attacker.heroId === 283) { // 荒：幻境中使用天罚·月，否则开启幻境
    const illusion = attacker.tags.some(tag => tag.name === '荒幻境');
    if (illusion) {
      const moon = allSkills.find(skill => skill.name === '天罚·月');
      if (moon) { aiSkillName = moon.name; suppressPaidSkill = true; }
    } else chooseReferenceSlot(2);
  } else if (attacker.heroId === 285) { // 鸩：毒羽超过2层、目标残血或仅剩单体时使用毒蚀
    const enemyHasEnoughPoison = livingEnemies.some(unit => unit.tags.filter(tag => tag.name === '毒羽').length > 2);
    const enemyBelow30 = livingEnemies.some(unit => unit.hpNow / currentMaxHp(unit) < .3);
    chooseReferenceSlot(livingEnemies.length === 1 || enemyHasEnoughPoison || enemyBelow30 ? 3 : 2);
  } else if (attacker.heroId === 356) { // 千姬：先召海原贝戟；潮声满5层时拔锤，否则用汐梦
    const hasSpear = attacker.tags.some(tag => tag.name === '海原贝戟');
    const tideStacks = attacker.tags.filter(tag => tag.name === '潮声').length;
    if (!hasSpear) chooseReferenceSlot(3);
    else if (tideStacks >= 5) {
      const ultimate = allSkills.find(skill => skill.name === '永生之汐');
      if (ultimate) { aiSkillName = ultimate.name; suppressPaidSkill = true; }
    } else chooseReferenceSlot(2);
  } else if (attacker.heroId === 388) { // 心狩鬼女红叶：先进入林隐，再普攻
    chooseReferenceSlot(attacker.tags.some(tag => tag.name === '林隐') ? 1 : 3);
  } else if (attacker.heroId === 379) { // 不见岳：山行结界不存在时开启，存在后普攻
    chooseReferenceSlot(attacker.tags.some(tag => tag.name === '山行结界') ? 1 : 3);
  } else if (attacker.heroId === 383) { // 神堕八岐大蛇：先化身蛇神，随后以审判仪式行动
    chooseReferenceSlot(attacker.tags.some(tag => tag.name === '蛇神状态') ? 3 : 2);
  } else if ([406, 407, 409].includes(attacker.heroId)) { // 天邪鬼青/黄、涂壁：友方缺少增益时施放2技能
    const hasUnbuffedAlly = livingAllies.some(unit => !unit.effects.some(effect => effect.amount > 0)
      && !unit.tags.some(tag => /buff|护盾|庇护|祝福|增益|锵锵锵|低吟|坚壁/.test(tag.name)));
    chooseReferenceSlot(hasUnbuffedAlly ? 2 : 1);
  } else if (attacker.heroId === 408) { // 帚神：敌人超过3名或鬼火大于5时群攻
    chooseReferenceSlot(livingEnemies.length > 3 || availableFire > 5 ? 2 : 1);
  } else if (attacker.heroId === 421) { // 青行灯呱：敌人超过2名或鬼火大于5时群攻
    chooseReferenceSlot(livingEnemies.length > 2 || availableFire > 5 ? 2 : 1);
  } else if (attacker.heroId === 424) { // 花鸟卷呱：友方有人低于70%时治疗
    chooseReferenceSlot(livingAllies.some(unit => unit.hpNow / currentMaxHp(unit) < .7) ? 2 : 1);
  } else if (attacker.heroId === 291) { // 书翁：友方低于30%时守护，否则记录伤害
    chooseReferenceSlot(livingAllies.some(unit => unit.hpNow / currentMaxHp(unit) < .3) ? 2 : 3);
  } else if (attacker.heroId === 279) { // 花鸟卷：友方低于70%时治疗，否则普攻
    chooseReferenceSlot(livingAllies.some(unit => unit.hpNow / currentMaxHp(unit) < .7) ? 3 : 1);
  } else if (attacker.heroId === 286) { // 以津真天：敌方至少2人时群攻，否则普攻
    chooseReferenceSlot(livingEnemies.length >= 2 ? 3 : 1);
  } else if (attacker.heroId === 287) { // 匣中少女：队友都没有回梦时施放回梦，否则普攻
    const hasDreamingAlly = livingAllies.some(unit => unit.tags.some(tag => tag.name === '回梦'));
    chooseReferenceSlot(hasDreamingAlly ? 1 : 3);
  } else if (attacker.heroId === 289) { // 兔丸：队友被控或胡萝卜满层时解控，否则普攻
    const allyControlled = livingAllies.some(unit => unit.control !== null);
    chooseReferenceSlot(allyControlled || attacker.carrots >= 4 ? 3 : 1);
  } else if (attacker.heroId === 323) { // 天井下：至少2名友方存活时施放3技能，否则普攻
    chooseReferenceSlot(livingAllies.length >= 2 ? 3 : 1);
  } else if (attacker.heroId === 330) { // 不知火：满级先机已开结界，结界消失后重开
    const inSorrow = attacker.tags.some(tag => tag.name === '离殇姿态');
    if (inSorrow) {
      const night = allSkills.find(skill => skill.name === '烬染不夜');
      if (night && skillCost(night, attacker.skillLevel) <= availableSkillFire) {
        aiSkillName = '烬染不夜'; suppressPaidSkill = true;
      } else { aiSkillName = '终舞'; suppressPaidSkill = true; }
    } else {
      const inDance = attacker.tags.some(tag => tag.name === '星火结界');
      if (attacker.hpNow / currentMaxHp(attacker) < .5) aiBasicSkillName = '离影';
      else chooseReferenceSlot(inDance ? 1 : 3);
    }
  } else if (attacker.heroId === 355) { // 麓铭大岳丸：未进入驭魂状态时先变身
    const possessed = attacker.tags.some(tag => tag.name.includes('驭魂'));
    chooseReferenceSlot(possessed ? 3 : 2);
  } else if (attacker.heroId === 360) { // 灶门祢豆子：鬼火够施放3技能时用3，否则用2
    const skillThree = referenceSkill(3);
    chooseReferenceSlot(skillThree && skillCost(skillThree, attacker.skillLevel) <= availableSkillFire ? 3 : 2);
  } else if (attacker.heroId === 361) { // 垢尝：自动战斗始终普攻
    chooseReferenceSlot(1);
  } else if (attacker.heroId === 358) { // 夜溟彼岸花：生命低于40%时优先自保，否则群攻
    chooseReferenceSlot(attacker.hpNow / currentMaxHp(attacker) < .4 ? 2 : 3);
  } else if (attacker.heroId === 348) { // 浮世青行灯：解锁终话后优先使用4技能
    const finale = attacker.skills.flatMap(skill => skill.extraSkills ?? []).find(skill => skill.name === '浮世终话');
    aiSkillName = attacker.skillLevel >= 5 && finale ? '浮世终话' : '告死暝灯';
    suppressPaidSkill = true;
  } else if (attacker.heroId === 362) { // 蝉冰雪女：仅缴械且鬼火不足以施放3技能时转用2技能
    const disarmed = attacker.tags.some(tag => tag.name.includes('缴械'));
    const skillThree = referenceSkill(3);
    chooseReferenceSlot(disarmed && skillThree && skillCost(skillThree, attacker.skillLevel) > availableSkillFire ? 2 : 3);
  } else if (attacker.heroId === 359) { // 灶门炭治郎：按敌方人数切换型，解锁火之神神乐后优先使用
    aiSkillName = attacker.skillLevel >= 5 ? '火之神神乐'
      : livingEnemies.length > 3 ? '叁之型·流流舞'
        : livingEnemies.length > 1 ? '捌之型·滝壶' : '拾之型·生生流转';
    suppressPaidSkill = true;
  } else if (attacker.heroId === 366) { // 空相面灵气：存活友方至少2人时3技能，仅自身存活时2技能
    chooseReferenceSlot(livingAllies.length >= 2 ? 3 : 2);
  } else if (attacker.heroId === 368) { // 饴细工：优先把糖渍给尚未拥有糖渍的友方
    chooseReferenceSlot(3);
  } else if (attacker.heroId === 367) { // 绘世花鸟卷：敌方无逐墨时绘梦，有逐墨时繁花
    const enemyHasInkMark = livingEnemies.some(unit => unit.tags.some(tag => tag.name === '逐墨'));
    aiSkillName = enemyHasInkMark ? '繁花坠露' : '绘梦浮生';
    suppressPaidSkill = true;
  } else if (attacker.heroId === 329) { // 海忍：友方潜影生效时用影出，否则3技能
    const hasAllyShadow = livingAllies.some(unit => unit.heroId === 329 && unit.tags.some(tag => tag.name.includes('潜影')));
    chooseReferenceSlot(hasAllyShadow ? 1 : 3);
  } else if (attacker.heroId === 393) { // 禅心云外镜：优先3技能，鬼火不足时2技能
    const skillThree = referenceSkill(3);
    chooseReferenceSlot(skillThree && skillCost(skillThree, attacker.skillLevel) <= availableSkillFire ? 3 : 2);
  } else if (attacker.heroId === 391) { // 寻香行：先开启明香境，之后使用菩提愿
    const hasScentRealm = attacker.tags.some(tag => tag.name === '明香境');
    chooseReferenceSlot(hasScentRealm ? 3 : 2);
  } else if (attacker.heroId === 363) { // 帝释天：给最高生命且未有金莲的目标施加金莲，否则群攻
    const highestHpEnemy = livingEnemies.slice().sort((a, b) => b.hpNow - a.hpNow)[0];
    chooseReferenceSlot(highestHpEnemy && !highestHpEnemy.tags.some(tag => tag.name === '金莲') ? 2 : 3);
  } else if (attacker.heroId === 394) { // 月读：无虚假之月且召唤位可用时先召月
    const hasFalseMoon = attacker.tags.some(tag => tag.name === '虚假之月');
    chooseReferenceSlot(!hasFalseMoon && livingAllies.length < 5 ? 2 : 3);
  } else if (attacker.heroId === 398) { // 天逆每：敌方尚无满8层恐惧目标时叠恐惧，否则群攻
    const hasFullFear = livingEnemies.some(unit => unit.tags.filter(tag => tag.name === '恐惧').length >= 8);
    chooseReferenceSlot(hasFullFear ? 3 : 2);
  } else if (attacker.heroId === 369) { // 食灵：至少2名友方存活时对友方施放3技能梦想料理，否则普攻
    chooseReferenceSlot(livingAllies.length >= 2 ? 3 : 1);
  } else if (attacker.heroId === 370) { // 饭笥：优先蓄食待发；胃口大开由储备粮满层时触发
    if (passiveActive(attacker) && attacker.foodStacks >= 10) aiSkillName = '胃口大开·吞食天地';
    else if (passiveActive(attacker) && attacker.foodStacks >= 6) aiSkillName = '胃口大开';
    else chooseReferenceSlot(2);
  } else if (attacker.heroId === 266) { // 青行灯：敌方至少2人或鬼火充足时3技能
    chooseReferenceSlot(livingEnemies.length >= 2 || availableFire > 5 ? 3 : 1);
  } else if (attacker.heroId === 272) { // 一目连：友方均高于40%时3技能，否则2技能
    chooseReferenceSlot(livingAllies.every(unit => unit.hpNow / currentMaxHp(unit) >= .4) ? 3 : 2);
  } else if (attacker.heroId === 267) { // 樱花妖：友方低于70%时2技能，单人或已有复苏时转3技能
    const lowAlly = livingAllies.some(unit => unit.hpNow / currentMaxHp(unit) < .7);
    const hasReviveDance = attacker.tags.some(tag => tag.name.includes('复苏之舞'));
    chooseReferenceSlot(lowAlly && livingAllies.length > 1 && !hasReviveDance ? 2 : 3);
  } else if (attacker.heroId === 598) { // 灼华桃花妖：有可复活目标时3技能，否则2技能
    chooseReferenceSlot(allies.some(unit => unit.hpNow <= 0) ? 3 : 2);
  } else if (attacker.heroId === 600) { // 市加美：友方无增益时2技能，否则3技能
    const hasUnbuffedAlly = livingAllies.some(unit => !unit.effects.some(effect => effect.amount > 0)
      && !unit.tags.some(tag => /buff|护盾|庇护|祝福|增益/.test(tag.name)));
    chooseReferenceSlot(hasUnbuffedAlly ? 2 : 3);
  } else if (attacker.heroId === 603) { // 毗沙门天：友方无增益时2技能，否则3技能
    const hasUnbuffedAlly = livingAllies.some(unit => !unit.effects.some(effect => effect.amount > 0)
      && !unit.tags.some(tag => /buff|护盾|庇护|祝福|增益/.test(tag.name)));
    chooseReferenceSlot(hasUnbuffedAlly ? 2 : 3);
  } else if (attacker.heroId === 604) { // 不相狐禅：敌方无增益时2技能，否则3技能
    const markedTarget = livingEnemies.slice().sort((a, b) => effectiveStat(b, 'attack') - effectiveStat(a, 'attack'))[0];
    const targetHasBuff = Boolean(markedTarget && (markedTarget.effects.some(effect => effect.amount > 0)
      || markedTarget.tags.some(tag => /buff|护盾|庇护|祝福|增益/.test(tag.name))));
    chooseReferenceSlot(targetHasBuff ? 3 : 2);
  } else if (attacker.heroId === 596) { // 神无月：我方存活数量大于2时施放3技能
    chooseReferenceSlot(livingAllies.length > 2 ? 3 : 1);
  } else if (attacker.heroId === 597) { // 葛叶：鬼火足以施放3技能时使用3技能，否则用2技能
    const skillThree = referenceSkill(3);
    chooseReferenceSlot(skillThree && skillCost(skillThree, attacker.skillLevel) <= availableSkillFire ? 3 : 2);
  } else if (attacker.heroId === 595 || attacker.heroId === 590 || attacker.heroId === 586) {
    // 梦山白藏主、妙主九命猫、云间不见岳：有未获增益的友方时2技能，否则3技能。
    const hasUnbuffedAlly = livingAllies.some(unit => !unit.effects.some(effect => effect.amount > 0)
      && !unit.tags.some(tag => /buff|护盾|庇护|祝福|增益/.test(tag.name)));
    chooseReferenceSlot(hasUnbuffedAlly ? 2 : 3);
  } else if (attacker.heroId === 594 || attacker.heroId === 587
    || attacker.heroId === 575 || attacker.heroId === 574 || attacker.heroId === 573
    || attacker.heroId === 571 || attacker.heroId === 567
    || attacker.heroId === 565 || attacker.heroId === 562 || attacker.heroId === 558
    || attacker.heroId === 556 || attacker.heroId === 555 || attacker.heroId === 553
    || attacker.heroId === 552 || attacker.heroId === 550) {
    // These entries are unconditional third-skill choices in the AI reference.
    chooseReferenceSlot(3);
  } else if (attacker.heroId === 593) { // 妖刀姬·绯夜猎刃：无悬赏目标时2技能，有悬赏目标时3技能
    const hasWantedEnemy = livingEnemies.some(unit => unit.tags.some(tag => tag.name.includes('悬赏')));
    chooseReferenceSlot(hasWantedEnemy ? 3 : 2);
  } else if (attacker.heroId === 592 || attacker.heroId === 344) { // 平将门、云外镜：缴械且鬼火不足时2技能，否则3技能
    const disarmed = attacker.tags.some(tag => tag.name.includes('缴械'));
    if (attacker.heroId === 344) {
      const skillThree = attacker.skills.find(skill => skill.name === '云岸净空');
      const needSwitch = disarmed && skillThree && skillCost(skillThree, attacker.skillLevel, attacker) > availableSkillFire;
      aiSkillName = needSwitch
        ? attacker.cloudYang ? '昭回' : '斗转'
        : attacker.cloudYang ? '苦海浮生' : '云岸净空';
      aiBasicSkillName = attacker.cloudYang ? '昙无' : undefined;
      suppressPaidSkill = false;
    } else {
      const skillThree = referenceSkill(3);
      chooseReferenceSlot(disarmed && skillThree && skillCost(skillThree, attacker.skillLevel) > availableSkillFire ? 2 : 3);
    }
  } else if (attacker.heroId === 591) { // 雪御前：有剑之无敌时3技能，否则2技能
    const swordInvincible = attacker.tags.some(tag => /剑/.test(tag.name) && /无敌/.test(tag.name));
    chooseReferenceSlot(swordInvincible ? 3 : 2);
  } else if (attacker.heroId === 572) { // 遥念烟烟罗：鬼火充足时3技能，否则2技能
    chooseReferenceSlot(availableFire >= 3 ? 3 : 2);
  } else if (attacker.heroId === 551) { // 寻森小鹿男：有森之心且敌方存活人数大于1时3技能
    const hasForestHeart = attacker.tags.some(tag => tag.name.includes('森之心'));
    chooseReferenceSlot(hasForestHeart && livingEnemies.length > 1 ? 3 : 1);
  } else if (attacker.heroId === 295) { // 追月神：至少2名友方存活时3技能，否则普攻
    chooseReferenceSlot(livingAllies.length >= 2 ? 3 : 1);
  } else if (attacker.heroId === 282) { // 金鱼姬：鬼火充足时使用3技能，否则普攻
    const skillThree = referenceSkill(3);
    chooseReferenceSlot(skillThree && skillCost(skillThree, attacker.skillLevel) <= availableSkillFire ? 3 : 1);
  } else if (attacker.heroId === 351) { // 铃鹿御前：优先3技能，无法施放时改用2技能
    const skillThree = referenceSkill(3);
    chooseReferenceSlot(skillThree && skillCost(skillThree, attacker.skillLevel) <= availableSkillFire ? 3 : 2);
  } else if (attacker.heroId === 352) { // 缚骨清姬：自动战斗始终使用3技能
    chooseReferenceSlot(3);
  } else if ([403, 404, 405, 414, 415, 416, 417, 418, 420, 422, 423, 425, 426, 427, 428, 429, 430].includes(attacker.heroId)) {
    // The AI reference explicitly selects slot 2 for these N/R shikigami and Gaki.
    chooseReferenceSlot(2);
  } else if ([608, 602, 601, 599, 580, 579, 577, 575, 574, 568, 567, 565, 562, 558, 556, 555].includes(attacker.heroId)) {
    // These current-roster entries are unconditional slot-3 decisions in the AI reference.
    chooseReferenceSlot(3);
  }
  const preferredAiSkill = aiSkillName
    ? allSkills.find(skill => skill.name === aiSkillName && skill.type === 3
      && (usable.includes(skill) || skill.cost === 0
        && (skill.description.includes('【施放】') || [356, 383].includes(attacker.heroId))
        && [334, 356, 371, 383, 584].includes(attacker.heroId)
        || attacker.heroId === 370 && skill.name === '胃口大开' && attacker.foodStacks >= 6
        || attacker.heroId === 370 && skill.name === '胃口大开·吞食天地' && attacker.foodStacks >= 10))
    : undefined;
  const emergencyRestoreSkill = !silenced && attacker.hpNow / currentMaxHp(attacker) < .5
    ? attacker.skills.find(skill => skill.name === '铃焰灼心')
    : undefined;
  const paidSkill = emergencyRestoreSkill ? undefined
    : preferredAiSkill ?? (suppressPaidSkill ? undefined : usable.sort((a, b) => b.cost - a.cost)[0]);
  const basicSkill = emergencyRestoreSkill ?? (silenced ? undefined : (aiBasicSkillName ? allSkills.find(skill => skill.name === aiBasicSkillName) : undefined)
    ?? attacker.skills.find(skill => skill.name === '五山火祭')
    ?? attacker.skills.find(skill => skill.type === 3 && skill.cost === 0 && !/回合开始时|任一目标回合结束时|战斗开始时|唯一效果/.test(skill.description)));
  const formSkill = attacker.oniStanceTurns > 0
    ? attacker.skills.flatMap(skill => skill.extraSkills ?? []).find(skill => skill.name === '烈焰焚天')
    : attacker.heroId === 367 && aiSkillName === '繁花坠露'
      ? attacker.skills.flatMap(skill => skill.extraSkills ?? []).find(skill => skill.name === '繁花坠露')
      : attacker.heroId === 359 && ['捌之型·滝壶', '火之神神乐'].includes(aiSkillName ?? '')
        ? attacker.skills.flatMap(skill => skill.extraSkills ?? []).find(skill => skill.name === aiSkillName)
      : attacker.heroId === 348 && aiSkillName === '浮世终话'
        ? attacker.skills.flatMap(skill => skill.extraSkills ?? []).find(skill => skill.name === '浮世终话')
      : [330, 353, 371, 392].includes(attacker.heroId) && aiSkillName
        ? attacker.skills.flatMap(skill => skill.extraSkills ?? []).find(skill => skill.name === aiSkillName)
      : attacker.heroId === 344 && paidSkill?.name === '云岸净空' && attacker.cloudYang
        ? attacker.skills.flatMap(skill => skill.extraSkills ?? []).find(skill => skill.name === '苦海浮生')
      : attacker.heroId === 344 && paidSkill?.name === '斗转' && attacker.cloudYang
        ? attacker.skills.flatMap(skill => skill.extraSkills ?? []).find(skill => skill.name === '昭回')
      : undefined;
  const castCostSkill = paidSkill ?? (attacker.heroId === 353 && formSkill ? referenceSkill(2)
    : attacker.heroId === 392 && formSkill ? referenceSkill(formSkill.name === '四季大葬' ? 3 : 2)
    : formSkill && formSkill.cost > 0 ? formSkill : undefined);
  const skill = automaticBellFire ? attacker.skills.find(item => item.name === '五山火祭')
    : formSkill ?? emergencyRestoreSkill ?? paidSkill ?? basicSkill;
  if (attacker.heroId === 343 && skill?.name === '真剑·韧心') attacker.shinkenBondUsed = true;
  if (attacker.heroId === 563 && (skill?.name === '音之舞曲·序幕' || skill?.name === '音之舞曲·盛幕')) attacker.mikuOpeningUsed = true;
  if (attacker.heroId === 561 && skill?.name === '涛泷之佑') {
    attacker.vigilanceLayers = Math.min(3, attacker.vigilanceLayers + 1 + Math.floor(attacker.crit * 2));
    battleLog?.push(`  戒备累积至${attacker.vigilanceLayers}层。`);
  } else if (attacker.heroId === 561 && skill?.name === '泷之决荡') {
    attacker.vigilanceLayers = 0;
  }
  attacker.spellUsed = Boolean(automaticBellFire || formSkill || castCostSkill || emergencyRestoreSkill || skill?.name === '五山火祭');
  let remnantFlameSpent = 0;
  if (castCostSkill) {
    const cost = skillCost(castCostSkill, attacker.skillLevel, attacker);
    remnantFlameSpent = activeSoul(attacker) === '遗念火' ? Math.min(attacker.remnantFlame, cost) : 0;
    attacker.remnantFlame -= remnantFlameSpent;
    const wishSpent = attacker.heroId === 372 ? Math.min(attacker.inabaWishPower, Math.max(0, cost - remnantFlameSpent - fire[attacker.side])) : 0;
    attacker.inabaWishPower -= wishSpent;
    const spentFire = cost - remnantFlameSpent - wishSpent;
    fire[attacker.side] -= spentFire;
    if (wishSpent > 0) battleLog?.push(`  因幡辉夜姬消耗${wishSpent}点愿力替代鬼火（愿力剩余${attacker.inabaWishPower}/8）。`);
    if (castCostSkill.name === '寂光映月') {
      attacker.tags = attacker.tags.filter(tag => tag.name !== '愿满夜减耗');
      attacker.tags.push({ name: '愿满夜减耗', turns: 3 });
    }
    if (castCostSkill.name === '愿满夜') attacker.tags = attacker.tags.filter(tag => tag.name !== '愿满夜减耗');
    if (remnantFlameSpent > 0) battleLog?.push(`  遗念火替代消耗${remnantFlameSpent}点鬼火（念火剩余${attacker.remnantFlame}/3）。`);
    if (spentFire > 0) {
      for (const chihime of allies.filter(unit => unit.hpNow > 0 && unit.heroId === 356
        && unit.tags.some(tag => tag.name === '海原贝戟'))) {
        const guaranteed = chihime.skillLevel >= 3;
        for (let orb = 0; orb < spentFire; orb++) {
          const tideCount = chihime.tags.filter(tag => tag.name === '潮声').length;
          if (tideCount >= 5) break;
          if (guaranteed || random() < .5) chihime.tags.push({ name: '潮声', turns: 999 });
        }
      }
    }
  }
  if (castCostSkill && skillCost(castCostSkill, attacker.skillLevel) > 0 && enemies.some(target => target.tags.some(tag => tag.redMapleDoll)
    && target.opponents.some(maple => maple.hpNow > 0 && maple.skillLevel >= 5 && maple.skills.some(passive => passive.name === '爆炸之咒')))
    && random() < .5) {
    const before = fire[attacker.side];
    fire[attacker.side] = Math.max(0, before - 1);
    battleLog?.push(`  红枫娃娃触发，${fighterLabel(attacker)}的技能消耗额外增加1点鬼火（${before}→${fire[attacker.side]}）。`);
  }
  const text = skill ? skillText(skill, attacker.skillLevel) : '';
  const action = automaticBellFire ? `神火自动施放「${skill?.name ?? '五山火祭'}」（鬼火 ${fire[attacker.side]}）`
    : castCostSkill ? `使用技能「${skill!.name}」（鬼火 ${availableFire}→${fire[attacker.side]}${remnantFlameSpent ? `，遗念火替代${remnantFlameSpent}点` : ''}）`
    : formSkill ? `使用技能「${formSkill.name}」（鬼火 ${fire[attacker.side]}）`
    : basicSkill ? `${['五山火祭', '铃焰灼心'].includes(basicSkill.name) ? '使用技能' : '使用普攻'}「${basicSkill.name}」（鬼火 ${fire[attacker.side]}）`
      : `${silenced ? '沉默中，' : ''}使用普攻（鬼火 ${fire[attacker.side]}）`;
  battleLog?.push(`行动 ${round}｜${fighterLabel(attacker)}${action}。`);
  const miku = allies.find(unit => unit.heroId === 563 && unit.hpNow > 0 && passiveActive(unit)
    && unit !== attacker && !unit.control && unit.controlTurns <= 0);
  if (attacker.heroId === 563 && attacker.skillLevel >= 5 && skill?.name === '音弦动' && passiveActive(attacker)) addMikuRhythm(attacker, battleLog);
  for (const inaba of allies.filter(unit => unit.heroId === 372 && unit.hpNow > 0 && passiveActive(unit)
    && unit !== attacker && unit.tags.some(tag => tag.name === '因幡辉夜姬幻境') && castCostSkill)) {
    attacker.tags = attacker.tags.filter(tag => tag.name !== '愿佑');
    attacker.tags.push({ name: '愿佑', turns: 1 });
    attacker.effects = attacker.effects.filter(effect => effect.source !== '因幡辉夜姬·愿佑');
    attacker.effects.push({ stat: 'critDamage', amount: effectiveStat(inaba, 'critDamage') * .3, turns: 1, source: '因幡辉夜姬·愿佑' });
    attacker.effects.push({ stat: 'defense', amount: effectiveStat(inaba, 'defense') * .3, flat: true, turns: 1, source: '因幡辉夜姬·愿佑' });
    battleLog?.push(`  因幡辉夜姬「愿满夜」幻境触发：${fighterLabel(attacker)}获得愿佑，持续1回合。`);
  }
  if (miku && castCostSkill) {
    const performance = miku.skills.find(item => item.name === '音律起')?.extraSkills.find(item => item.name === '演奏');
    if (performance && fire[attacker.side] > 0) {
      fire[attacker.side]--;
      const upgrades = miku.skills.find(item => item.name === '音律起')!.upgrades.slice(0, miku.skillLevel - 1);
      const amount = Number([...upgrades].reverse().map(item => /演奏提升伤害效果增加至(\d+(?:\.\d+)?)%/.exec(item)?.[1]).find(Boolean) ?? 6) / 100;
      attacker.tags = attacker.tags.filter(tag => tag.name !== '初音演奏');
      attacker.tags.push({ name: '初音演奏', turns: 1, damageBonus: amount });
      addMikuRhythm(miku, battleLog);
      battleLog?.push(`  初音未来「音律起」触发：消耗1点鬼火，演奏使${fighterLabel(attacker)}造成的伤害提高${Math.round(amount * 100)}%，持续至其回合结束。`);
    }
  }
  if (skill?.name === '黄泉战旗' && attacker.heroId === 585 && enemies.length) {
    const cost = Math.min(currentMaxHp(attacker) * .3, Math.max(0, attacker.hpNow - 1));
    attacker.hpNow -= cost;
    attacker.lostHpTotal += cost;
    attacker.shield = Math.min(attacker.hp * .5, attacker.shield + cost);
    const secondRatio = attacker.skillLevel >= 4 ? .3 : attacker.skillLevel >= 2 ? .25 : .2;
    const cap = attacker.attack * 12;
    const target = enemies.filter(unit => unit.hpNow > 0)
      .sort((a, b) => a.hpNow / currentMaxHp(a) - b.hpNow / currentMaxHp(b))[0];
    battleLog?.push(`  荒骷髅舍命损失${Math.round(cost)}点生命，累计损失${Math.round(attacker.lostHpTotal)}，平氏铁壁${Math.round(attacker.shield)}。`);
    if (target) for (const [index, ratio] of [.08, secondRatio].entries()) {
      const raw = Math.min(cap, attacker.lostHpTotal * ratio);
      const actual = applyTrueDamage(target, raw);
      if (target.hpNow <= 0) triggerRedMapleExplosion(target, battleLog);
      battleLog?.push(`  黄泉战旗第${index + 1}击对${fighterLabel(target)}造成${Math.round(actual)}点真实伤害（计算值上限${Math.round(cap)}），剩余生命${Math.max(0, Math.round(target.hpNow))}。`);
      if (target.hpNow <= 0) break;
    }
    return false;
  }
  const ratioValues = [...text.matchAll(/攻击(?:力)?(?:的)?(\d+(?:\.\d+)?)%(?:的)?(?=(?:间接)?伤害)/g)].map(match => Number(match[1]) / 100);
  let ratio = ratioValues[0] ?? (skill ? 0 : .125);
  if (skill?.name === '雷帝招来' && attacker.skillLevel >= 3) ratio += attacker.talismans * .4;
  const hits = /(\d+)次/.exec(text);
  const hitCount = skill?.name === '五山火祭' ? 1 : hits ? Math.max(1, Math.min(8, Number(hits[1]))) : 1;
  let specialMechanicHandled = false;
  const heal = /(?:治疗|治療|恢复|恢復)[^。；\n]{0,30}生命上限(\d+(?:\.\d+)?)%/.exec(text);
  if (heal) {
    if (skill?.name === '铃焰灼心') {
      const selfHealed = applyRestoration(attacker, currentMaxHp(attacker) * .4, battleLog);
      attacker.bellFireCooldown = 0;
      battleLog?.push(`  铃焰灼心恢复${fighterLabel(attacker)} ${Math.round(selfHealed)} 点生命。`);
      for (const ally of allies.filter(unit => unit.hpNow > 0 && unit !== attacker)) {
        const healed = applyRestoration(ally, currentMaxHp(ally) * .12, battleLog);
        battleLog?.push(`  铃焰灼心恢复${fighterLabel(ally)} ${Math.round(healed)} 点生命。`);
      }
      if (attacker.bellDivineFire && attacker.hpNow >= currentMaxHp(attacker) - 1e-7 && !attacker.control) attacker.bellFireReady = true;
    } else if (skill?.name === '与世结缘') {
      const recipient = attacker.bondedAlly && attacker.bondedAlly.hpNow > 0 ? attacker.bondedAlly
        : allies.filter(unit => unit.hpNow > 0).sort((a, b) => a.hpNow / currentMaxHp(a) - b.hpNow / currentMaxHp(b))[0];
      if (!recipient) return false;
      const wasFull = recipient.hpNow >= currentMaxHp(recipient) - 1e-7;
      const base = currentMaxHp(recipient) * Number(heal[1]) / 100;
      const healed = applyHealing(attacker, recipient, base, battleLog);
      battleLog?.push(`  治疗 ${fighterLabel(recipient)} ${Math.round(healed)} 点生命。`);
      attacker.divinePower = Math.min(5, attacker.divinePower + 1);
      const colors: Array<'赤' | '青'> = attacker.divinePower >= 5 ? ['赤', '青']
        : recipient === attacker.bondedAlly && attacker.bondColor ? [attacker.bondColor]
          : random() < .5 ? ['赤'] : ['青'];
      for (const color of colors) {
        recipient.tags = recipient.tags.filter(tag => tag.name !== `尘缘·${color}`);
        recipient.tags.push({ name: `尘缘·${color}`, turns: 1 });
      }
      battleLog?.push(`  ${fighterLabel(attacker)}获得1层神力（${attacker.divinePower}/5），${fighterLabel(recipient)}获得${colors.map(color => `尘缘·${color}`).join('与')}（持续1回合）。`);
      if (attacker.divinePower >= 3) for (const ally of allies.filter(unit => unit.hpNow > 0 && unit !== recipient)) {
        const extra = applyHealing(attacker, ally, currentMaxHp(ally) * Number(heal[1]) / 100, battleLog);
        battleLog?.push(`  神力≥3，额外治疗${fighterLabel(ally)} ${Math.round(extra)} 点生命。`);
      }
      if (wasFull && attacker.skillLevel >= 4) {
        const amount = currentMaxHp(recipient) * .08;
        addTimedShield(recipient, amount, '与世结缘护盾', 2);
        battleLog?.push(`  ${fighterLabel(recipient)}治疗前生命全满，获得 ${Math.round(amount)} 点护盾，持续2回合。`);
      }
      if (attacker.skillLevel >= 3) {
        for (const ally of [attacker, recipient]) {
          ally.tags = ally.tags.filter(tag => tag.name !== '庇护');
          ally.tags.push({ name: '庇护', turns: 1 });
        }
        battleLog?.push('  与世结缘为自身和目标施加庇护，持续1回合。');
      }
      if (attacker.skillLevel >= 5 && random() < effectiveStat(attacker, 'crit')) {
        const bonus = Math.min(1.1, effectiveStat(attacker, 'critDamage') * .4);
        recipient.effects.push({ stat: 'critDamage', amount: bonus, turns: 1 });
        battleLog?.push(`  治疗暴击：${fighterLabel(recipient)}暴击伤害提高${Math.round(bonus * 100)}%，持续1回合。`);
      }
      specialMechanicHandled = true;
    } else {
      const recipient = allies.filter(unit => unit.hpNow > 0).sort((a, b) => a.hpNow / currentMaxHp(a) - b.hpNow / currentMaxHp(b))[0];
      if (!recipient) return false;
      const healed = applyHealing(attacker, recipient, currentMaxHp(recipient) * Number(heal[1]) / 100, battleLog);
      battleLog?.push(`  治疗 ${fighterLabel(recipient)} ${Math.round(healed)} 点生命。`);
    }
  }
  const shield = /(?:护盾|護盾)[^。；\n]{0,20}(\d+(?:\.\d+)?)%/.exec(text);
  if (shield) {
    const recipient = allies.filter(unit => unit.hpNow > 0).sort((a, b) => a.hpNow / currentMaxHp(a) - b.hpNow / currentMaxHp(b))[0];
    if (recipient) {
      const gained = currentMaxHp(recipient) * Number(shield[1]) / 100;
      recipient.shield += gained;
      battleLog?.push(`  ${fighterLabel(recipient)}获得 ${Math.round(gained)} 点护盾。`);
    }
  }
  const alive = enemies.filter(unit => unit.hpNow > 0);
  if (!alive.length) return false;
  const aoe = /敌方全体|全体敌方/.test(text);
  const allyTargeting = attacker.heroId === 369 && skill?.name === '梦想料理'
    || attacker.heroId === 570 && (skill?.id ?? 0) % 10 === 2
    || [566, 571, 580, 594, 595, 596, 601, 603].includes(attacker.heroId) && ((skill?.id ?? 0) % 10 === 3 || attacker.heroId === 595 && (skill?.id ?? 0) % 10 === 2)
    || attacker.heroId === 583 && (skill?.id ?? 0) % 10 === 2
    || attacker.heroId === 585 && (skill?.id ?? 0) % 10 === 2
    || /友方|己方|队友/.test(text) && !/敌方|敌人/.test(text) && ratio === 0;
  const availableTargets = allyTargeting ? allies.filter(unit => unit.hpNow > 0) : alive;
  const targetSlot = skill ? skill.id % 10 : 0;
  const lowestRatioFirst = (a: Fighter, b: Fighter) => a.hpNow / currentMaxHp(a) - b.hpNow / currentMaxHp(b);
  const highestRatioFirst = (a: Fighter, b: Fighter) => b.hpNow / currentMaxHp(b) - a.hpNow / currentMaxHp(a);
  const selectReferenceTarget = (candidates: Fighter[]): Fighter | undefined => {
    if (!candidates.length) return undefined;
    const prefer = (predicate: (unit: Fighter) => boolean, compare = lowestRatioFirst) => {
      const preferred = candidates.filter(predicate);
      return (preferred.length ? preferred : candidates).slice().sort(compare)[0];
    };
    // 10点场录像中，初翎山风首个「岚」锁定敌方一号位；不要把荒骷髅开局自损后的低血量比例误当成选敌规则。
    if (attacker.heroId === 357 && skill?.name === '岚') return candidates[0];
    if (attacker.heroId === 371 && skill?.name === '你是坏人' && !allyTargeting) {
      return candidates.slice().sort((a, b) => effectiveStat(b, 'attack') - effectiveStat(a, 'attack'))[0];
    }
    if (attacker.heroId === 391 && targetSlot === 1) {
      return prefer(unit => unit.hpNow / currentMaxHp(unit) < .2 || unit.tags.some(tag => tag.name.includes('失神')));
    }
    if (attacker.heroId === 356 && targetSlot === 2) {
      return candidates.slice().sort((a, b) => b.hpNow - a.hpNow)[0];
    }
    // 月读的虚诞月落优先攻击绝对生命值最高的敌方。
    if (attacker.heroId === 394 && targetSlot === 3 && !allyTargeting) {
      return candidates.slice().sort((a, b) => b.hpNow - a.hpNow)[0];
    }
    if (attacker.heroId === 388 && targetSlot === 1) {
      return prefer(unit => unit.hpNow / currentMaxHp(unit) < .2);
    }
    if (attacker.heroId === 320 && [2, 3].includes(targetSlot) && !allyTargeting) {
      return candidates.filter(unit => !unit.tags.some(tag => tag.name.includes('缠绕')))
        .sort(lowestRatioFirst)[0] ?? candidates.slice().sort(lowestRatioFirst)[0];
    }
    if (attacker.heroId === 363 && targetSlot === 2 && !allyTargeting) {
      return candidates.slice().sort((a, b) => b.hpNow - a.hpNow)[0];
    }
    if (attacker.heroId === 251 && targetSlot === 1) return prefer(unit => unit.hpNow / currentMaxHp(unit) < .4);
    if (attacker.heroId === 398 && skill?.name === '惧影随') {
      const fullFearTarget = candidates.find(unit => unit.tags.filter(tag => tag.name === '恐惧').length >= 8);
      return fullFearTarget ?? candidates[Math.floor(random() * candidates.length)];
    }
    if (attacker.heroId === 359 && skill?.name === '火之神神乐') return candidates[Math.floor(random() * candidates.length)];
    // The AI reference gives 酒吞童子's slot 3 the highest-absolute-HP target;
    // during 鬼王姿态 its basic skill is replaced by 烈焰焚天 and follows the same rule.
    if (attacker.heroId === 341 && ['焚天', '烈焰焚天'].includes(skill?.name ?? '')) {
      return candidates.slice().sort((a, b) => b.hpNow - a.hpNow)[0];
    }
    if (attacker.heroId === 289 && targetSlot === 3 && allyTargeting) {
      return candidates[Math.floor(random() * candidates.length)];
    }
    if (attacker.heroId === 597 && targetSlot === 2 && allyTargeting) {
      return candidates[Math.floor(random() * candidates.length)];
    }
    if (attacker.heroId === 365 && targetSlot === 3 && allyTargeting) {
      return candidates[Math.floor(random() * candidates.length)];
    }
    if ([596, 595, 571].includes(attacker.heroId) && allyTargeting) {
      return candidates.slice().sort((a, b) => effectiveStat(b, 'attack') - effectiveStat(a, 'attack'))[0];
    }
    if (attacker.heroId === 594 && allyTargeting) {
      return candidates.filter(unit => !unit.effects.some(effect => effect.amount > 0)
        && !unit.tags.some(tag => /buff|护盾|庇护|祝福|增益/.test(tag.name)))
        .sort((a, b) => effectiveStat(b, 'attack') - effectiveStat(a, 'attack'))[0]
        ?? candidates.slice().sort((a, b) => effectiveStat(b, 'attack') - effectiveStat(a, 'attack'))[0];
    }
    if (attacker.heroId === 593 && targetSlot === 2) return candidates.slice().sort((a, b) => a.hpNow - b.hpNow)[0];
    if ([593, 592, 590, 572].includes(attacker.heroId) && targetSlot === 3 && !allyTargeting) {
      return candidates.slice().sort((a, b) => b.hpNow - a.hpNow)[0];
    }
    // Several AI entries specify different priorities for their basic skill
    // and skill 3. Keep the high-current-HP rule scoped to skill 3 so the
    // default low-HP targeting remains in effect for their basic attacks.
    if ([608, 599, 592, 588, 585, 584, 581, 579, 577, 573, 354, 333, 322, 315, 389].includes(attacker.heroId)
      && targetSlot === 3 && !allyTargeting) {
      return candidates.slice().sort((a, b) => b.hpNow - a.hpNow)[0];
    }
    if (attacker.heroId === 366 && targetSlot === 3 && !allyTargeting) {
      return candidates.slice().sort((a, b) => b.hpNow - a.hpNow)[0];
    }
    if (attacker.heroId === 364 && targetSlot === 3 && !allyTargeting) {
      return candidates.slice().sort((a, b) => currentMaxHp(b) - currentMaxHp(a))[0];
    }
    if (attacker.heroId === 362 && targetSlot === 3 && !allyTargeting) {
      return candidates.slice().sort((a, b) => effectiveStat(b, 'attack') - effectiveStat(a, 'attack'))[0];
    }
    if (attacker.heroId === 372 && targetSlot === 3 && !allyTargeting) {
      return candidates.slice().sort((a, b) => currentMaxHp(a) - currentMaxHp(b))[0];
    }
    if (attacker.heroId === 598 && allyTargeting) {
      return skill?.name === '携芳意'
        ? candidates.slice().sort((a, b) => a.hpNow - b.hpNow)[0]
        : candidates.slice().sort((a, b) => effectiveStat(b, 'attack') - effectiveStat(a, 'attack'))[0];
    }
    if (attacker.heroId === 393 && targetSlot === 2 && allyTargeting) {
      const debuffCount = (unit: Fighter) => unit.effects.filter(effect => effect.amount < 0).length
        + Number(Boolean(unit.control))
        + unit.tags.filter(tag => tag.hpReduction !== undefined || tag.healingReduction !== undefined
          || tag.delayedDamage !== undefined || tag.redMapleDoll !== undefined
          || /减益|减速|破防|诅咒|沉默|禁锢|冻结|眩晕|嘲讽|混乱|减疗|裁决|缠绕|恐惧|凝视|缴械|失神/.test(tag.name)).length;
      return candidates.filter(unit => debuffCount(unit) > 0)
        .sort((a, b) => debuffCount(b) - debuffCount(a) || lowestRatioFirst(a, b))[0]
        ?? candidates.slice().sort(lowestRatioFirst)[0];
    }
    if (attacker.heroId === 570 && targetSlot === 2 && allyTargeting) return candidates.slice().sort((a, b) => a.hpNow - b.hpNow)[0];
    if (attacker.heroId === 382 && targetSlot === 3 && allyTargeting) return candidates.slice().sort(lowestRatioFirst)[0];
    if (attacker.heroId === 604 && targetSlot === 2 && !allyTargeting) {
      return candidates.slice().sort((a, b) => effectiveStat(b, 'attack') - effectiveStat(a, 'attack'))[0];
    }
    // 白狼3技能偏好生命比例高于40%的目标；同一候选池内优先选择血线较高者。
    if (attacker.heroId === 264 && targetSlot === 3 && !allyTargeting) {
      return prefer(unit => unit.hpNow / currentMaxHp(unit) > .4, highestRatioFirst);
    }
    // 卖药郎会把天平/看破视作额外的低血量倾向，各自只作用于对应技能。
    if (attacker.heroId === 305 && [1, 3].includes(targetSlot) && !allyTargeting) {
      const markName = targetSlot === 1 ? '天平' : '看破';
      return candidates.slice().sort((a, b) => {
        const adjustedRatio = (unit: Fighter) => unit.hpNow / currentMaxHp(unit)
          - (unit.tags.some(tag => tag.name.includes(markName)) ? .2 : 0);
        return adjustedRatio(a) - adjustedRatio(b);
      })[0];
    }
    if (attacker.heroId === 574 && targetSlot === 2 && allyTargeting) {
      const debuffCount = (unit: Fighter) => unit.effects.filter(effect => effect.amount < 0).length
        + Number(Boolean(unit.control))
        + unit.tags.filter(tag => tag.hpReduction !== undefined || tag.healingReduction !== undefined
          || tag.delayedDamage !== undefined || tag.redMapleDoll !== undefined
          || /减益|减速|破防|诅咒|沉默|禁锢|冻结|眩晕|嘲讽|混乱|减疗|裁决|缠绕|恐惧|凝视|缴械|失神/.test(tag.name)).length;
      return candidates.slice().sort((a, b) => debuffCount(b) - debuffCount(a) || lowestRatioFirst(a, b))[0];
    }
    if (attacker.heroId === 324 && allyTargeting && targetSlot === 2) {
      return candidates.slice().sort((a, b) => effectiveStat(b, 'attack') - effectiveStat(a, 'attack'))[0];
    }
    if (attacker.heroId === 324 && allyTargeting && targetSlot === 3) return candidates.slice().sort(lowestRatioFirst)[0];
    if (attacker.heroId === 591 && targetSlot === 3 && !allyTargeting) {
      return candidates.slice().sort(highestRatioFirst)[0];
    }
    if (attacker.heroId === 588) return candidates.slice().sort((a, b) => b.hpNow - a.hpNow)[0];
    if (attacker.heroId === 559 || skill?.name === '狐惑魅影') return candidates.slice().sort((a, b) => a.hpNow - b.hpNow)[0];
    if (attacker.heroId === 554 && skill?.name === '与世结缘' && attacker.bondedAlly?.hpNow) return attacker.bondedAlly;
    if ([608, 599, 579, 577].includes(attacker.heroId) && targetSlot === 3 && !allyTargeting) {
      return candidates.slice().sort((a, b) => b.hpNow - a.hpNow)[0];
    }
    if ([566, 580].includes(attacker.heroId) && allyTargeting) return candidates.slice().sort((a, b) => effectiveStat(b, 'attack') - effectiveStat(a, 'attack'))[0];
    if (attacker.heroId === 369 && targetSlot === 3 && allyTargeting) {
      return candidates.slice().sort((a, b) => effectiveStat(b, 'critDamage') - effectiveStat(a, 'critDamage'))[0];
    }
    if (attacker.heroId === 298 && skill?.name === '温柔的守护' && allyTargeting) return candidates.slice().sort(lowestRatioFirst)[0];
    if (attacker.heroId === 601 && allyTargeting) {
      return candidates.filter(unit => !unit.tags.some(tag => tag.name.includes('智识之火')))
        .sort((a, b) => effectiveStat(b, 'attack') - effectiveStat(a, 'attack'))[0]
        ?? candidates.slice().sort((a, b) => effectiveStat(b, 'attack') - effectiveStat(a, 'attack'))[0];
    }
    if ([566, 571, 580, 595, 596].includes(attacker.heroId) && (targetSlot === 3 || attacker.heroId === 595 && targetSlot === 2) && allyTargeting) {
      return candidates.slice().sort((a, b) => effectiveStat(b, 'attack') - effectiveStat(a, 'attack'))[0];
    }
    if (attacker.heroId === 603 && targetSlot === 3 && allyTargeting) return candidates.slice().sort((a, b) => b.hpNow - a.hpNow)[0];
    if (attacker.heroId === 594 && allyTargeting) {
      return candidates.filter(unit => !unit.effects.some(effect => effect.amount > 0)
        && !unit.tags.some(tag => /buff|护盾|庇护|祝福|增益/.test(tag.name)))
        .sort((a, b) => effectiveStat(b, 'attack') - effectiveStat(a, 'attack'))[0]
        ?? candidates.slice().sort((a, b) => effectiveStat(b, 'attack') - effectiveStat(a, 'attack'))[0];
    }
    if (attacker.heroId === 569 && targetSlot === 1) return prefer(unit => unit.hpNow / currentMaxHp(unit) < .4);
    if (attacker.heroId === 583 && targetSlot === 2 && allyTargeting) {
      return candidates.slice().sort((a, b) => effectiveStat(b, 'attack') - effectiveStat(a, 'attack'))[0];
    }
    if (attacker.heroId === 585 && targetSlot === 2 && allyTargeting) {
      return candidates.slice().sort((a, b) => effectiveStat(b, 'attack') - effectiveStat(a, 'attack'))[0];
    }
    if (attacker.heroId === 367 && skill?.name === '繁花坠露' && allyTargeting) {
      return candidates.filter(unit => unit !== attacker).slice().sort(lowestRatioFirst)[0]
        ?? candidates.slice().sort(lowestRatioFirst)[0];
    }
    if (attacker.heroId === 367 && skill?.name === '绘梦浮生' && !allyTargeting) {
      return candidates.slice().sort((a, b) => b.hpNow - a.hpNow)[0];
    }
    if (attacker.heroId === 368 && skill?.name === '一物一心' && allyTargeting) {
      return candidates.find(unit => unit !== attacker && !unit.tags.some(tag => tag.name.includes('糖渍')))
        ?? candidates.find(unit => unit !== attacker)
        ?? candidates[0];
    }
    if (attacker.heroId === 500 && skill?.name === '全力以赴' && allyTargeting) {
      return candidates.find(unit => !unit.tags.some(tag => tag.name.includes('伞之盾')))
        ?? candidates.slice().sort(lowestRatioFirst)[0];
    }
    if (attacker.heroId === 557 && targetSlot === 2 && allyTargeting) return candidates.slice().sort((a, b) => effectiveStat(b, 'attack') - effectiveStat(a, 'attack'))[0];
    if (attacker.heroId === 603 && targetSlot === 3 && allyTargeting) return candidates.slice().sort((a, b) => b.hpNow - a.hpNow)[0];
    if (attacker.heroId === 347 && targetSlot === 3 && allyTargeting) return candidates.slice().sort((a, b) => effectiveStat(b, 'critDamage') - effectiveStat(a, 'critDamage'))[0];
    if ([345, 344].includes(attacker.heroId) && !allyTargeting && targetSlot === 3) return candidates.slice().sort((a, b) => b.hpNow - a.hpNow)[0];
    if (attacker.heroId === 370 && /^胃口大开/.test(skill?.name ?? '') && !allyTargeting) {
      return candidates.slice().sort((a, b) => b.hpNow - a.hpNow)[0];
    }
    if (attacker.heroId === 346 && targetSlot === 3 && !allyTargeting) {
      return candidates.find(unit => !unit.tags.some(tag => tag.name.includes('结怨'))) ?? candidates[0];
    }
    if (attacker.heroId === 350 && targetSlot === 3 && !allyTargeting) return candidates.slice().sort((a, b) => b.hpNow - a.hpNow)[0];
    if (attacker.heroId === 349 && targetSlot === 3 && !allyTargeting) {
      return candidates.find(unit => !unit.tags.some(tag => tag.name.includes('雷火弹'))) ?? candidates[0];
    }
    if (attacker.heroId === 327 && targetSlot === 2 && allyTargeting) {
      return candidates.find(unit => !unit.tags.some(tag => tag.name.includes('风盾'))) ?? candidates[0];
    }
    if (attacker.heroId === 302 && targetSlot === 2) return candidates.slice().sort((a, b) => b.hpNow - a.hpNow)[0];
    if (attacker.heroId === 302 && targetSlot === 3 && !allyTargeting) return prefer(unit => unit.hpNow / currentMaxHp(unit) < .4);
    if (attacker.heroId === 300) return prefer(unit => unit.hpNow / currentMaxHp(unit) < .5);
    if (attacker.heroId === 259 && targetSlot === 1) return prefer(unit => !unit.tags.some(tag => tag.name.includes('森之力')));
    if (attacker.heroId === 259 && targetSlot === 3) return prefer(unit => !unit.control || unit.control !== '眩晕', highestRatioFirst);
    if (attacker.heroId === 257 && targetSlot === 1) return prefer(unit => !unit.tags.some(tag => (tag.healingReduction ?? 0) > 0));
    if (attacker.heroId === 255 && targetSlot === 3) return prefer(unit => unit.hpNow / currentMaxHp(unit) < .4);
    if (attacker.heroId === 254) return prefer(unit => unit.hpNow / currentMaxHp(unit) > .5, highestRatioFirst);
    if (attacker.heroId === 253 && targetSlot === 3) return prefer(unit => unit.hpNow / currentMaxHp(unit) > .4, highestRatioFirst);
    if (attacker.heroId === 250 && targetSlot === 3 || attacker.heroId === 242 && targetSlot === 3
      || attacker.heroId === 230 && targetSlot === 3 || attacker.heroId === 223 && targetSlot === 3
      || attacker.heroId === 207 && targetSlot === 3) {
      return prefer(unit => unit.hpNow / currentMaxHp(unit) > .4, highestRatioFirst);
    }
    if (attacker.heroId === 244 || attacker.heroId === 243) return prefer(unit => unit.hpNow / currentMaxHp(unit) < .4);
    if (attacker.heroId === 236) return prefer(unit => unit.hpNow / currentMaxHp(unit) < .3);
    if (attacker.heroId === 228 && targetSlot === 3) return candidates.slice().sort((a, b) => b.hpNow - a.hpNow)[0];
    if (attacker.heroId === 219 && targetSlot === 1 || attacker.heroId === 254 || attacker.heroId === 218 && targetSlot === 1) {
      return prefer(unit => unit.hpNow / currentMaxHp(unit) > (attacker.heroId === 219 ? .4 : .5), highestRatioFirst);
    }
    if (attacker.heroId === 211 && targetSlot === 1) {
      return candidates.slice().sort((a, b) => {
        const aHasDebuff = a.control || a.effects.some(effect => effect.amount < 0);
        const bHasDebuff = b.control || b.effects.some(effect => effect.amount < 0);
        return Number(Boolean(bHasDebuff)) - Number(Boolean(aHasDebuff))
          || (a.hpNow / currentMaxHp(a) - (aHasDebuff ? .2 : 0)) - (b.hpNow / currentMaxHp(b) - (bHasDebuff ? .2 : 0));
      })[0];
    }
    if (attacker.heroId === 206 && targetSlot === 1) {
      return candidates.slice().sort((a, b) => {
        const aBuffed = a.tags.some(tag => /buff|护盾|庇护|之缘|祝福|兔子舞|大鬼笼|生命链接|酒气/.test(tag.name)) || a.effects.some(effect => effect.amount > 0);
        const bBuffed = b.tags.some(tag => /buff|护盾|庇护|之缘|祝福|兔子舞|大鬼笼|生命链接|酒气/.test(tag.name)) || b.effects.some(effect => effect.amount > 0);
        return Number(bBuffed) - Number(aBuffed)
          || (a.hpNow / currentMaxHp(a) - (aBuffed ? .2 : 0)) - (b.hpNow / currentMaxHp(b) - (bBuffed ? .2 : 0));
      })[0];
    }
    if (attacker.heroId === 206 && targetSlot === 3 && allyTargeting) return candidates.slice().sort((a, b) => effectiveStat(b, 'crit') - effectiveStat(a, 'crit'))[0];
    if (attacker.heroId === 566 && targetSlot === 3 && allyTargeting) return candidates.slice().sort((a, b) => effectiveStat(b, 'attack') - effectiveStat(a, 'attack'))[0];
    if (attacker.heroId === 561 && targetSlot === 3 && allyTargeting) return candidates[Math.floor(random() * candidates.length)];
    if ((attacker.heroId === 233 && targetSlot === 2 || attacker.heroId === 202 && targetSlot === 3) && candidates.length > 1) {
      return candidates[Math.floor(random() * candidates.length)];
    }
    if (attacker.heroId === 202 && targetSlot === 1 && candidates.some(unit => unit.hpNow / currentMaxHp(unit) < .3)) {
      return candidates.filter(unit => unit.hpNow / currentMaxHp(unit) < .3).sort(lowestRatioFirst)[0];
    }
    if (attacker.heroId === 218 && targetSlot === 1) return candidates.slice().sort(highestRatioFirst)[0];
    return candidates.slice().sort(lowestRatioFirst)[0];
  };
  const referenceTarget = selectReferenceTarget(availableTargets);
  const targets = aoe ? availableTargets : [referenceTarget].filter((unit): unit is Fighter => Boolean(unit));
  if (attacker.heroId === 394 && skill?.name === '月烬天极' && referenceTarget) {
    referenceTarget.tags = referenceTarget.tags.filter(tag => tag.name !== '惑星');
    for (let mark = 0; mark < (attacker.skillLevel >= 5 ? 2 : 1); mark++) {
      referenceTarget.tags.push({ name: '惑星', turns: 999 });
    }
    battleLog?.push(`  月读按式神AI为绝对生命值最高的敌方${fighterLabel(referenceTarget)}附加${attacker.skillLevel >= 5 ? '2层' : '1层'}惑星。`);
  }
  if (skill?.name === '梦想料理' && targets[0]) {
    battleLog?.push(`  式神AI优先选择暴击伤害最高的友方：${fighterLabel(targets[0])}。`);
  }
  if (skill?.name === '守缘刃') {
    const partner = attacker.bondedAlly;
    if (partner) {
      partner.tags = partner.tags.filter(tag => tag.name !== `胜天之缘·${attacker.bondColor ?? '赤'}`);
      removeControl(partner, battleLog);
      partner.effects = partner.effects.filter(effect => effect.amount >= 0);
      partner.tags = partner.tags.filter(tag => !['死亡裁决', '红枫娃娃', '狐印'].includes(tag.name)
        && tag.hpReduction === undefined && tag.healingReduction === undefined);
      partner.bondedAlly = undefined;
      attacker.bondedAlly = undefined;
      attacker.bondColor = undefined;
      battleLog?.push(`  ${fighterLabel(attacker)}解除与${fighterLabel(partner)}的胜天之缘，并驱散其全部减益与控制。`);
    } else {
      // The reference AI first binds the ally with the highest Attack, then
      // directs subsequent 与世结缘 casts to that same ally.
      const target = allies.filter(unit => unit.hpNow > 0 && unit !== attacker)
        .sort((a, b) => effectiveStat(b, 'attack') - effectiveStat(a, 'attack'))[0];
      if (target) {
        // The Shikigami AI reference specifies 胜天之缘·赤 for its
        // automatic first cast; 青 is the manual alternative.
        const color: '赤' = '赤';
        attacker.bondedAlly = target;
        attacker.bondColor = color;
        attacker.bondOwnerBoostUsed = false;
        attacker.bondTargetBoostUsed = false;
        target.bondedAlly = attacker;
        target.tags = target.tags.filter(tag => !tag.name.startsWith('胜天之缘·'));
        target.tags.push({ name: `胜天之缘·${color}`, turns: 999 });
        attacker.divinePower = Math.min(5, attacker.divinePower + 2);
        battleLog?.push(`  ${fighterLabel(attacker)}与${fighterLabel(target)}缔结胜天之缘·${color}，神力+2（${attacker.divinePower}/5）；双方回合结束时可为对方推进30%行动条。`);
      }
    }
    specialMechanicHandled = true;
  }
  if (skill?.name === '洗筋伐髓') {
    const bath = attacker.tags.find(tag => tag.name === '别馆私汤');
    if (!bath) {
      attacker.tags.push({ name: '别馆私汤', turns: 999 });
      battleLog?.push(`  ${fighterLabel(attacker)}召唤别馆私汤；之后自动战斗改用普攻。`);
    } else {
      bath.turns = 999;
      battleLog?.push(`  ${fighterLabel(attacker)}恢复别馆私汤并刷新其持续时间。`);
    }
    specialMechanicHandled = true;
  }
  if (skill?.name === '祷言') {
    const veil = attacker.tags.findIndex(tag => tag.name === '咒纱');
    if (veil >= 0) attacker.tags.splice(veil, 1);
    const target = targets[0];
    if (target) {
      const shieldAmount = currentMaxHp(attacker) * .1 * (target === attacker ? 2 : 1);
      addTimedShield(target, shieldAmount, '祸津神·祷言护盾', 2);
    }
    battleLog?.push(`  祸津神消耗1层咒纱（剩余${attacker.tags.filter(tag => tag.name === '咒纱').length}层）。`);
    specialMechanicHandled = true;
  }
  if (skill?.name === '溯回时隙' && targets[0] && allies.includes(targets[0])) {
    const target = targets[0];
    if (target && !target.tags.some(tag => tag.name === '溯回时隙')) {
      target.tags.push({ name: '溯回时隙', turns: 999 });
      battleLog?.push(`  ${fighterLabel(target)}获得溯回时隙；卑弥呼的自动战斗会在此后转用日耀时辉。`);
    }
    specialMechanicHandled = true;
  }
  if (skill?.name === '曜时之旅' && !attacker.tags.some(tag => tag.name === '时之隙')) {
    attacker.tags.push({ name: '时之隙', turns: 999 });
    specialMechanicHandled = true;
  }
  if (skill?.name === '花吻烈魂' && targets[0]) {
    const currentBearer = allies.find(unit => unit.tags.some(tag => tag.name === '血色之花'));
    if (currentBearer) currentBearer.tags = currentBearer.tags.filter(tag => tag.name !== '血色之花');
    targets[0].tags.push({ name: '血色之花', turns: 999 });
    battleLog?.push(`  血色之花转移至${fighterLabel(targets[0])}。`);
    specialMechanicHandled = true;
  }
  if (skill?.name === '龙首之玉') {
    attacker.tags = attacker.tags.filter(tag => tag.name !== '辉夜姬幻境');
    attacker.tags.push({ name: '辉夜姬幻境', turns: 2 });
  }
  if (skill?.name === '蓄食待发' && attacker.heroId === 370 && passiveActive(attacker)) {
    attacker.foodStacks = Math.min(10, attacker.foodStacks + 2);
    for (const ally of allies.filter(unit => unit.hpNow > 0 && unit !== attacker)) {
      ally.effects = ally.effects.filter(effect => effect.source !== '食欲大增');
      ally.effects.push({ stat: 'speed', amount: 30, flat: true, turns: 1, source: '食欲大增' });
    }
    attacker.tags = attacker.tags.filter(tag => tag.name !== '食欲大增');
    attacker.tags.push({ name: '食欲大增', turns: 1 });
    battleLog?.push(`  饭笥「蓄食待发」获得2层储备粮（${attacker.foodStacks}/10），其他友方速度提高30点，持续1回合。`);
    specialMechanicHandled = true;
  }
  if (skill?.name === '愿满夜') {
    applyInabaIllusion(attacker, battleLog);
    specialMechanicHandled = true;
  }
  if (skill?.name === '梦心迷兔阵！') {
    attacker.tags.push({ name: '梦忍法', turns: 999 });
    specialMechanicHandled = true;
  }
  if (skill?.name === '梦山狐影') {
    for (const ally of allies.filter(unit => unit.hpNow > 0)) {
      ally.tags = ally.tags.filter(tag => tag.name !== '狐影结界');
      ally.tags.push({ name: '狐影结界', turns: 1 });
    }
    specialMechanicHandled = true;
  }
  if (skill?.name === '川怒') {
    attacker.tags.push({ name: '海怒', turns: 999 });
    for (const ally of allies.filter(unit => unit.hpNow > 0 && unit !== attacker)) {
      ally.tags = ally.tags.filter(tag => tag.name !== '屹立不倒');
      ally.tags.push({ name: '屹立不倒', turns: 1 });
    }
    specialMechanicHandled = true;
  }
  if (skill?.name === '祸根') {
    for (const target of targets) target.tags = target.tags.filter(tag => tag.name !== '灾厄花');
    specialMechanicHandled = true;
  }
  if (skill?.name === '狐狩界') {
    attacker.tags = attacker.tags.filter(tag => tag.name !== '御馔津灵符' && tag.name !== '御馔津狐狩界');
    attacker.tags.push({ name: '御馔津狐狩界', turns: 1 });
    for (let stack = 0; stack < 4; stack++) attacker.tags.push({ name: '御馔津灵符', turns: 999 });
    specialMechanicHandled = true;
  }
  if (skill?.name === '燃爆·破魔箭') {
    const spentSigils = attacker.tags.filter(tag => tag.name === '御馔津灵符').length;
    attacker.tags = attacker.tags.filter(tag => tag.name !== '御馔津灵符');
    battleLog?.push(`  御馔津消耗${spentSigils}层灵符。`);
  }
  if (skill?.name === '星罗云布') {
    if (!attacker.tags.some(tag => tag.name === '命运星河')) attacker.tags.push({ name: '命运星河', turns: 999 });
    specialMechanicHandled = true;
  }
  if (skill?.name === '星流霆击') {
    attacker.tags = attacker.tags.filter(tag => tag.name !== '星辰之力');
  }
  if (skill && ['宫·赤之霞', '商·山吹', '角·神宫华辉', '徵·薰风', '羽·澈'].includes(skill.name)) {
    attacker.tags.push({ name: `紧那罗已弹·${skill.name}`, turns: 999 });
    specialMechanicHandled = true;
  }
  if (skill?.name === '宫·赤之霞' && targets[0] && targets[0].hpNow > 0) {
    targets[0].tags = targets[0].tags.filter(tag => tag.name !== '孤立');
    targets[0].tags.push({ name: '孤立', turns: 2 });
    battleLog?.push(`  律音「宫·赤之霞」使${fighterLabel(targets[0])}孤立，持续2回合。`);
  }
  if (skill?.name === '急') {
    attacker.tags = attacker.tags.filter(tag => !tag.name.startsWith('紧那罗已弹·'));
  }
  if (skill && ['你是坏人', '别再追我啦', '快躲起来'].includes(skill.name)) {
    attacker.tags.push({ name: `川猿已变·${skill.name}`, turns: 999 });
    specialMechanicHandled = true;
  }
  if (skill?.name === '四时一隅·秋') {
    attacker.tags = attacker.tags.filter(tag => tag.name !== '四时一隅');
    attacker.tags.push({ name: '四时一隅', turns: 2 });
    attacker.tags.push({ name: '四季流转', turns: 999 });
    specialMechanicHandled = true;
  }
  if (skill?.name === '四季大葬') {
    attacker.tags = attacker.tags.filter(tag => !['四季流转', '四时一隅'].includes(tag.name));
    specialMechanicHandled = true;
  }
  if (skill?.name === '狐惑魅影' && attacker.skillLevel >= 5 && targets[0]) {
    const seal = targets[0].tags.find(tag => Boolean(tag.foxSeal));
    if (seal) triggerFoxSeal(targets[0], seal, battleLog);
  }
  if (skill?.name === '雷帝招来') {
    const spent = attacker.talismans;
    attacker.talismans = 0;
    if (spent > 0) {
      const healAmount = effectiveStat(attacker, 'attack') * .65 * spent;
      const healed = applyHealing(attacker, attacker, healAmount, battleLog);
      battleLog?.push(`  ${fighterLabel(attacker)}消耗${spent}张道符，恢复 ${Math.round(healed)} 点生命。`);
      for (const target of targets) {
        const existingReduction = target.tags.filter(tag => tag.name === '雷帝招来·生命上限降低')
          .reduce((sum, tag) => sum + (tag.hpReduction ?? 0), 0);
        const reduction = Math.min(target.hp * .11, attacker.attack * 2.35) * spent;
        const applied = target.bellEternalFlame ? 0 : Math.min(Math.max(0, target.hp - 1 - existingReduction), reduction);
        if (applied > 0) {
          target.tags = target.tags.filter(tag => tag.name !== '雷帝招来·生命上限降低');
          target.tags.push({ name: '雷帝招来·生命上限降低', turns: 5, hpReduction: existingReduction + applied });
          target.hpNow = Math.min(target.hpNow, currentMaxHp(target));
          battleLog?.push(`  ${fighterLabel(target)}生命上限额外降低 ${Math.round(applied)}（累计 ${Math.round(existingReduction + applied)}），持续5回合。`);
        }
      }
    }
  }
  // 律动巡游的 Lv.4 行动条推进有“目标仍承受控制效果”这一触发条件，
  // 不能交给通用技能文本解析器无条件执行；在下方驱散后检查剩余控制。
  const actionBarHandled = Boolean(skill && skill.name !== '律动巡游'
    && applyActionBarEffects(text, attacker, allies, targets, battleLog));
  const resourceHandled = Boolean(skill && applyResourceEffects(text, attacker, allies, fire, battleLog));
  specialMechanicHandled ||= actionBarHandled || resourceHandled;
  const priorEffects = new Map<Fighter, number>();
  for (const unit of [...allies, ...targets]) priorEffects.set(unit, unit.effects.length);
  // 雷帝招来 contains nested percentages for HP-cap loss, damage scaling, and
  // non-critical damage reduction. The generic prose parser mistakes those
  // values for attack/crit modifiers; its actual effects are applied below.
  // These descriptions contain nested percentages that look like stat
  // changes to a broad text scan (雷帝招来's max-HP ratio and 狐惑魅影's
  // damage ratio next to “生命比例每降低25%”). Their mechanics are handled
  // explicitly below instead of being turned into fake attack debuffs.
  if (skill && !['雷帝招来', '狐惑魅影', '守缘刃', '正念', '再会之音'].includes(skill.name)) applySkillModifiers(text, attacker, allies, targets);
  if (skill?.name === '正念') {
    const defenseBonus = attacker.skillLevel >= 3 ? .4 : attacker.skillLevel >= 2 ? .3 : .2;
    for (const ally of allies.filter(unit => unit.hpNow > 0)) {
      ally.effects = ally.effects.filter(effect => effect.source !== '正念·明识灯');
      ally.effects.push({ stat: 'defense', amount: defenseBonus, turns: 999, source: '正念·明识灯' });
    }
    const dispels = attacker.skillLevel >= 5 ? 2 : attacker.skillLevel >= 4 ? 1 : 0;
    for (let index = 0; index < dispels; index++) cleanseRandomDebuff(allies, attacker.side, random, battleLog);
    battleLog?.push(`  慧明灯召唤明识灯：友方全体防御提高${Math.round(defenseBonus * 100)}%，直到慧明灯下次回合开始。`);
    specialMechanicHandled = true;
  }
  if (skill?.name === '再会之音') {
    const joyLayers = attacker.skillLevel >= 5 ? 3 : 2;
    attacker.tags = attacker.tags.filter(tag => tag.name !== '欢愉');
    for (let layer = 0; layer < joyLayers; layer++) attacker.tags.push({ name: '欢愉', turns: 1 });
    battleLog?.push(`  天井下获得${joyLayers}层欢愉；清醒期间友方伤害提高${attacker.skillLevel >= 4 ? 20 : attacker.skillLevel >= 2 ? 15 : 10}%，自身免疫控制。`);
    specialMechanicHandled = true;
  }
  if (skill?.name === '雷帝招来') specialMechanicHandled = true;
  if (skill && /复活|复生/.test(text)) {
    const fallen = allies.find(unit => unit.hpNow <= 0 && !unit.skills.some(item => item.name === '铃焰灼心'));
    if (fallen) {
      const life = /生命上限(?:的)?(\d+(?:\.\d+)?)%/.exec(text);
      fallen.hpNow = Math.max(1, currentMaxHp(fallen) * (life ? Number(life[1]) / 100 : .3));
      fallen.control = null;
      fallen.controlTurns = 0;
      battleLog?.push(`  ${fighterLabel(fallen)}复活，恢复 ${Math.round(fallen.hpNow)} 点生命。`);
    }
    specialMechanicHandled = true;
  }
  if (skill && skill.name !== '律动巡游' && /驱散|解除/.test(text)) {
    const removeAll = /全部|所有/.test(text);
    const count = removeAll ? Number.POSITIVE_INFINITY : Number(/(?:驱散|解除)[^。；\n]{0,12}(\d+)个/.exec(text)?.[1] ?? 1);
    for (const target of targets) {
      let remaining = count;
      if (remaining > 0 && target.control) {
        battleLog?.push(`  驱散${fighterLabel(target)}的${target.control}。`);
        removeControl(target, battleLog);
        remaining--;
      }
      while (remaining > 0) {
        const index = target.effects.findIndex(effect => effect.amount < 0);
        if (index < 0) break;
        const [removed] = target.effects.splice(index, 1);
        battleLog?.push(`  驱散${fighterLabel(target)}的${statusLabel({ ...target, effects: [removed] })}。`);
        remaining--;
      }
      while (remaining > 0) {
        const index = target.tags.findIndex(tag => tag.name === '死亡裁决');
        if (index < 0) break;
        target.tags.splice(index, 1);
        battleLog?.push(`  驱散${fighterLabel(target)}的死亡裁决。`);
        remaining--;
      }
    }
    specialMechanicHandled = true;
  }
  if (skill?.name === '清辉月华') {
    const duration = /(?:持续|维持)(\d+)回合/.exec(text)?.[1];
    const durationTurns = duration ? Number(duration) : 1;
    const attackBonus = attacker.skillLevel >= 4 ? .2 : attacker.skillLevel >= 2 ? .1 : 0;
    for (const ally of allies.filter(unit => unit.hpNow > 0)) {
      ally.tags = ally.tags.filter(tag => tag.name !== '月之祝福');
      ally.tags.push({ name: '月之祝福', turns: durationTurns });
      ally.effects = ally.effects.filter(effect => effect.source !== '月之祝福');
      if (attackBonus > 0) ally.effects.push({ stat: 'attack', amount: attackBonus, turns: durationTurns, source: '月之祝福' });
      battleLog?.push(`  月之祝福：${fighterLabel(ally)}攻击提升${Math.round(attackBonus * 100)}%${ally !== attacker ? `，速度提升${attacker.skillLevel >= 3 ? 20 : 10}点` : ''}。`);
      if (ally !== attacker) {
        const speedBonus = attacker.skillLevel >= 3 ? 20 : 10;
        ally.effects.push({ stat: 'speed', amount: speedBonus, turns: durationTurns, flat: true, source: '月之祝福' });
      }
    }
    attacker.tags = attacker.tags.filter(tag => tag.name !== '庇护');
    if (attacker.skillLevel >= 5) attacker.tags.push({ name: '庇护', turns: 1 });
    battleLog?.push(`  ${fighterLabel(attacker)}为友方施加月之祝福（攻击提升${Math.round(attackBonus * 100)}%，其他友方速度提升${attacker.skillLevel >= 3 ? 20 : 10}点）${attacker.skillLevel >= 5 ? '，自身获得可抵挡控制的庇护' : ''}。`);
    specialMechanicHandled = true;
  }
  if (skill?.name === '回梦') {
    for (const ally of allies.filter(unit => unit.hpNow > 0)) {
      ally.tags = ally.tags.filter(tag => tag.name !== '回梦');
      ally.tags.push({ name: '回梦', turns: 2 });
    }
    battleLog?.push('  匣中少女记录友方全体生命，施加回梦状态。');
    specialMechanicHandled = true;
  }
  if (attacker.heroId === 394 && skill?.name === '虚诞月落') {
    attacker.tags = attacker.tags.filter(tag => tag.name !== '虚假之月');
    attacker.tags.push({ name: '虚假之月', turns: 3 });
  }
  if (attacker.heroId === 391 && skill?.name === '缚梦明香') {
    attacker.tags = attacker.tags.filter(tag => tag.name !== '明香境');
    attacker.tags.push({ name: '明香境', turns: 3 });
  }
  if (attacker.heroId === 363 && skill?.name === '无垢莲华' && targets[0]) {
    targets[0].tags = targets[0].tags.filter(tag => tag.name !== '金莲');
    targets[0].tags.push({ name: '金莲', turns: 1 });
  }
  if (attacker.heroId === 398 && skill?.name === '惧影随' && targets[0]) {
    for (let layer = 0; layer < 4; layer++) targets[0].tags.push({ name: '恐惧', turns: 3 });
  }
  if (attacker.heroId === 320 && skill?.name === '雪织') {
    for (const target of targets) {
      target.tags = target.tags.filter(tag => !tag.name.includes('缠绕'));
      target.tags.push({ name: '缠绕', turns: 2 });
    }
  }
  if (attacker.heroId === 283 && skill?.name === '星辰之境') {
    attacker.tags = attacker.tags.filter(tag => tag.name !== '荒幻境');
    attacker.tags.push({ name: '荒幻境', turns: 2 });
    for (let layer = 0; layer < 3; layer++) targets[0]?.tags.push({ name: '星痕', turns: 3 });
  }
  if (attacker.heroId === 285) {
    const addPoison = (target: Fighter, count: number) => {
      const existing = target.tags.filter(tag => tag.name === '毒羽').length;
      for (let layer = existing; layer < Math.min(5, existing + count); layer++) {
        target.tags.push({ name: '毒羽', turns: 999 });
      }
    };
    if (skill?.name === '鸩羽' && targets[0]) addPoison(targets[0], 2);
    if (skill?.name === '毒之华') for (const enemy of livingEnemies) addPoison(enemy, 2);
    if (skill?.name === '毒蚀' && targets[0]) {
      const target = targets[0];
      const stacks = target.tags.filter(tag => tag.name === '毒羽').length;
      target.tags = target.tags.filter(tag => tag.name !== '毒羽');
      if (attacker.skillLevel >= 4) addPoison(target, 3);
      if (stacks) battleLog?.push(`  鸩消耗${fighterLabel(target)}的${stacks}层毒羽。`);
    }
  }
  if (attacker.heroId === 356 && skill?.name === '海潮入梦') {
    attacker.tags = attacker.tags.filter(tag => tag.name !== '海原贝戟' && tag.name !== '潮声');
    attacker.tags.push({ name: '海原贝戟', turns: 999 });
    if (attacker.skillLevel >= 5) {
      for (let layer = 0; layer < 3; layer++) attacker.tags.push({ name: '潮声', turns: 999 });
    }
  }
  if (attacker.heroId === 356 && skill?.name === '千汐' && attacker.skillLevel >= 5
    && attacker.tags.some(tag => tag.name === '海原贝戟')) {
    const tides = attacker.tags.filter(tag => tag.name === '潮声').length;
    if (tides < 5) attacker.tags.push({ name: '潮声', turns: 999 });
  }
  if (attacker.heroId === 356 && skill?.name === '永生之汐') {
    attacker.tags = attacker.tags.filter(tag => tag.name !== '海原贝戟' && tag.name !== '潮声');
  }
  if (attacker.heroId === 379 && skill?.name === '水宿山行') {
    attacker.tags = attacker.tags.filter(tag => tag.name !== '山行结界');
    attacker.tags.push({ name: '山行结界', turns: 3 });
  }
  if (attacker.heroId === 383 && skill?.name === '神堕之力') {
    attacker.tags = attacker.tags.filter(tag => tag.name !== '蛇神状态');
    attacker.tags.push({ name: '蛇神状态', turns: 999 });
  }
  if (attacker.heroId === 388 && skill?.name === '枫起之舞') {
    attacker.tags = attacker.tags.filter(tag => tag.name !== '林隐');
    attacker.tags.push({ name: '林隐', turns: 999 }, { name: '林隐', turns: 999 });
  }
  const teamBuffNames: Record<number, string> = { 406: '锵锵锵', 407: '低吟', 409: '坚壁' };
  const teamBuff = teamBuffNames[attacker.heroId];
  if (teamBuff && skill?.id === attacker.heroId * 10 + 2) {
    for (const ally of livingAllies) {
      ally.tags = ally.tags.filter(tag => tag.name !== teamBuff);
      ally.tags.push({ name: teamBuff, turns: attacker.heroId === 409 ? 2 : 1 });
    }
  }
  if (attacker.heroId === 324 && skill?.name === '齿甲') {
    const partner = allies.filter(unit => unit.hpNow > 0 && unit !== attacker)
      .sort((a, b) => effectiveStat(b, 'attack') - effectiveStat(a, 'attack'))[0];
    for (const bearer of [attacker, partner].filter((unit): unit is Fighter => Boolean(unit))) {
      bearer.tags = bearer.tags.filter(tag => tag.name !== '齿甲' && tag.name !== '体甲');
      bearer.tags.push({ name: '齿甲', turns: 99 }, { name: '体甲', turns: 99 });
    }
    specialMechanicHandled = true;
  }
  if (skill?.name === '守护之心') attacker.carrots = 0;
  if (skill?.name === '兄弟之绊') {
    for (const ally of allies.filter(unit => unit.hpNow > 0)) {
      for (const whistle of ['二哥呼哨', '三弟呼哨']) {
        ally.tags = ally.tags.filter(tag => tag.name !== whistle);
        ally.tags.push({ name: whistle, turns: 2 });
      }
    }
  }
  if (skill?.name === '一物一心' && targets[0]) {
    targets[0].tags = targets[0].tags.filter(tag => !tag.name.includes('糖渍'));
    targets[0].tags.push({ name: '糖渍', turns: attacker.skillLevel >= 3 ? 3 : 2, sugarOwnerId: attacker.heroId, sugarHeals: 0 });
    const costHp = attacker.hpNow * .15;
    attacker.hpNow = Math.max(1, attacker.hpNow - costHp);
    battleLog?.push(`  饴细工优先把糖渍交给未拥有糖渍的友方：${fighterLabel(targets[0])}。`);
    specialMechanicHandled = true;
  }
  if (attacker.heroId === 367 && skill?.name === '绘梦浮生') {
    attacker.tags = attacker.tags.filter(tag => tag.name !== '浮生画影');
    attacker.tags.push({ name: '浮生画影', turns: 4 });
    if (targets[0]) {
      targets[0].tags = targets[0].tags.filter(tag => tag.name !== '逐墨');
      targets[0].tags.push({ name: '逐墨', turns: 4 });
      battleLog?.push(`  绘世花鸟卷为${fighterLabel(targets[0])}施加逐墨；后续自动选择繁花坠露。`);
    }
  }
  if (attacker.heroId === 367 && skill?.name === '繁花坠露') {
    attacker.tags = attacker.tags.filter(tag => tag.name !== '浮生画影');
  }
  if (attacker.heroId === 355 && skill?.name === '铭海之主') {
    attacker.tags = attacker.tags.filter(tag => tag.name !== '驭魂');
    attacker.tags.push({ name: '驭魂', turns: 999 });
  }
  if (attacker.heroId === 330 && skill?.name === '星火满天') applyStarfireDomain(attacker, allies, fire[attacker.side], battleLog);
  if (attacker.heroId === 330 && skill?.name === '离影' && attacker.hpNow / currentMaxHp(attacker) < .5) {
    attacker.tags = attacker.tags.filter(tag => tag.name !== '离殇姿态');
    attacker.tags.push({ name: '离殇姿态', turns: 999 });
    const night = attacker.skills.flatMap(item => item.extraSkills ?? []).find(item => item.name === '烬染不夜');
    const nightRatio = night ? Number(/攻击(?:力)?(?:的)?(\d+(?:\.\d+)?)%伤害/.exec(skillText(night, attacker.skillLevel))?.[1] ?? 125) / 100 : 1.25;
    for (const enemy of enemies.filter(unit => unit.hpNow > 0)) {
      const damage = resolveHit(attacker, enemy, nightRatio, random, 0, true, fire[attacker.side], false, battleLog, fire);
      battleLog?.push(`  「离影」触发无消耗「烬染不夜」，对${fighterLabel(enemy)}造成${Math.round(damage)}点伤害。`);
    }
    specialMechanicHandled = true;
  }
  if (skill?.name === '全力以赴' && targets[0]) battleLog?.push(`  神乐与定春优先为尚无伞之盾的友方施加护盾：${fighterLabel(targets[0])}。`);
  if (skill?.name === '天火怒焱') {
    const buffTags = new Set(['庇护', '月之祝福', '共鸣之墙', '灵狐守护', '地藏像护盾', '蚌精护盾', '灵狐守护']);
    const buffCount = attacker.skillLevel >= 2 ? 2 : 1;
    for (const target of targets) {
      let removed = 0;
      for (let index = target.effects.length - 1; index >= 0 && removed < buffCount; index--) {
        if (target.effects[index].amount <= 0) continue;
        const [buff] = target.effects.splice(index, 1);
        battleLog?.push(`  ${fighterLabel(target)}的增益${statusLabel({ ...target, effects: [buff] })}被天火怒焱驱散。`);
        removed++;
      }
      for (let index = target.tags.length - 1; index >= 0 && removed < buffCount; index--) {
        if (!buffTags.has(target.tags[index].name)) continue;
        const [buff] = target.tags.splice(index, 1);
        battleLog?.push(`  ${fighterLabel(target)}的${buff.name}被天火怒焱驱散。`);
        removed++;
      }
    }
    attacker.oniStanceTurns = 2;
    attacker.oniStanceEnteredThisTurn = true;
    attacker.oniStanceDamage = 0;
    battleLog?.push(`  ${fighterLabel(attacker)}进入鬼王姿态，持续2回合。`);
    specialMechanicHandled = true;
  }
  if (skill?.name === '疗愈的药草') {
    const upgrades = skill.upgrades.slice(0, attacker.skillLevel - 1);
    const bonusUpgrade = [...upgrades].reverse().find(item => /治疗量增加攻击的\d+(?:\.\d+)?%/.test(item)) ?? '';
    const bonus = Number(/治疗量增加攻击的(\d+(?:\.\d+)?)%/.exec(bonusUpgrade)?.[1] ?? 12) / 100;
    attacker.herbs = Math.min(6, attacker.herbs + 2);
    attacker.herbHealBonus = bonus;
    attacker.herbHealBonusTurns = 2;
    battleLog?.push(`  ${fighterLabel(attacker)}获得2株草药并提高疗愈量 ${Math.round(bonus * 100)}%（共 ${attacker.herbs} 株）。`);
    if (attacker.skillLevel >= 5 && attacker.herbs >= 4) battleLog?.push(`  草药不少于4株：友方全体攻击提高24%（草药持续充足时生效）。`);
    specialMechanicHandled = true;
  }
  if (skill?.name === '律动巡游') {
    for (const ally of allies.filter(unit => unit.hpNow > 0)) {
      if (ally.control) { battleLog?.push(`  驱散${fighterLabel(ally)}的${ally.control}。`); removeControl(ally, battleLog); }
      else {
        const debuff = ally.effects.findIndex(effect => effect.amount < 0);
        if (debuff >= 0) { const [removed] = ally.effects.splice(debuff, 1); battleLog?.push(`  驱散${fighterLabel(ally)}的${statusLabel({ ...ally, effects: [removed] })}。`); }
      }
      applyResonanceWall(ally, 2);
    }
    if (attacker.skillLevel >= 4) {
      for (const ally of allies.filter(unit => unit.hpNow > 0 && unit.control)) {
        const applied = changeActionBar(ally, 30, attacker);
        if (applied) battleLog?.push(`  ${fighterLabel(ally)}仍受${ally.control}影响，行动条推进${Math.round(applied)}%，当前 ${Math.round(ally.gauge)}%。`);
      }
    }
    const harmonyGain = attacker.skillLevel >= 3 ? 2 : attacker.skillLevel >= 2 ? 1 : 0;
    attacker.harmony = Math.min(5, attacker.harmony + harmonyGain);
    if (harmonyGain > 0) battleLog?.push(`  ${fighterLabel(attacker)}获得${harmonyGain}层和音（当前${attacker.harmony}层）。`);
    battleLog?.push('  友方获得共鸣之墙，持续2回合；每层吸收暴击伤害，单层上限为初始效果抵抗×8000。');
    specialMechanicHandled = true;
  }
  let addedEffects = 0;
  for (const [unit, count] of priorEffects) {
    const gained = unit.effects.slice(count);
    addedEffects += gained.length;
    if (gained.length) battleLog?.push(`  ${fighterLabel(unit)}状态变化：${gained.map(effect => statusLabel({ ...unit, effects: [effect] })).join('、')}。`);
  }
  const control = controlType(text);
  const forTarget = /(\d+(?:\.\d+)?)%[^。；\n]{0,20}(?:眩晕|冰冻|睡眠|沉默|混乱|嘲讽|封印)|(?:眩晕|冰冻|睡眠|沉默|混乱|嘲讽|封印)[^。；\n]{0,20}(\d+(?:\.\d+)?)%/.exec(text);
  const chance = forTarget ? Number(forTarget[1] ?? forTarget[2]) / 100 : .25;
  if (!ratio) {
    if (attacker.heroId === 595 && skill?.name === '白狐咒' && targets[0]) {
      const recipient = targets[0];
      const restored = applyHealing(attacker, recipient, Math.max(0, currentMaxHp(recipient) - recipient.hpNow) * .2, battleLog);
      recipient.tags = recipient.tags.filter(tag => tag.name !== '守护之印');
      recipient.tags.push({ name: '守护之印', turns: 2 });
      battleLog?.push(`  白藏主「白狐咒」为${fighterLabel(recipient)}恢复${Math.round(restored)}点生命，并施加守护之印（2回合）。`);
      specialMechanicHandled = true;
    }
    if (attacker.heroId === 595 && ['斩梦刀', '梦山誓'].includes(skill?.name ?? '')) {
      const pct = skill?.name === '斩梦刀'
        ? attacker.skillLevel >= 4 ? .3 : attacker.skillLevel >= 2 ? .25 : .2
        : attacker.skillLevel >= 4 ? .2 : attacker.skillLevel >= 2 ? .17 : .14;
      for (const enemy of enemies.filter(unit => unit.hpNow > 0)) {
        enemy.tags = enemy.tags.filter(tag => tag.name !== '符咒·破');
        enemy.tags.push({ name: '符咒·破', turns: 2 });
        const reduction = enemy.tags.reduce((sum, tag) => sum + (tag.damageReduction ?? 0), 0);
        const damage = applyTrueDamage(enemy, currentMaxHp(attacker) * pct * Math.max(.1, 1 - Math.min(.9, reduction)));
        battleLog?.push(`  白藏主「${skill!.name}」对${fighterLabel(enemy)}造成${Math.round(damage)}点间接伤害，并施加符咒·破（造成伤害降低30%，2回合）。`);
      }
      if ((skill?.name === '斩梦刀' || skill?.name === '梦山誓') && attacker.skillLevel >= 3) {
        for (const ally of allies.filter(unit => unit.hpNow > 0)) {
          const restored = applyHealing(attacker, ally, Math.max(0, currentMaxHp(ally) - ally.hpNow) * .2, battleLog);
          if (restored > 0) battleLog?.push(`  白藏主「${skill!.name}」治疗${fighterLabel(ally)}${Math.round(restored)}点生命。`);
        }
      }
      specialMechanicHandled = true;
    }
    if (attacker.heroId === 344 && skill && ['斗转', '昭回'].includes(skill.name)) {
      attacker.cloudYang = !attacker.cloudYang;
      attacker.hpNow = attacker.cloudYang ? attacker.cloudYangHp : attacker.cloudYinHp;
      attacker.effects = attacker.effects.filter(effect => effect.source !== '云外镜·翻转加速');
      attacker.effects.push({ stat: 'speed', amount: 100, flat: true, turns: 1, source: '云外镜·翻转加速' });
      attacker.tags = attacker.tags.filter(tag => tag.name !== '镜盾');
      addTimedShield(attacker, effectiveStat(attacker, 'defense') * 6.8, '镜盾', 2);
      attacker.cloudFlipCost += 2;
      if (!attacker.cloudYang) attacker.tags = attacker.tags.filter(tag => tag.name !== '镜佑');
      battleLog?.push(`  云外镜「${skill.name}」翻转为${attacker.cloudYang ? '阳' : '阴'}状态，恢复对应生命值并获得100点速度与镜盾；后续翻转技能消耗永久增加2点。`);
      specialMechanicHandled = true;
    }
    if (attacker.heroId === 344 && skill?.name === '苦海浮生') {
      const existing = allies.filter(unit => unit.hpNow > 0 && unit.tags.some(tag => tag.name === '镜佑'));
      const selected = targets[0] && targets[0] !== attacker ? targets[0] : allies
        .filter(unit => unit.hpNow > 0 && unit !== attacker && !unit.tags.some(tag => tag.name === '镜佑'))
        .sort((a, b) => a.hpNow / currentMaxHp(a) - b.hpNow / currentMaxHp(b))[0];
      const recipients = [...new Set([attacker, ...existing, ...(selected ? [selected] : [])])].slice(0, 2);
      for (const ally of recipients) {
        ally.tags = ally.tags.filter(tag => tag.name !== '镜佑');
        ally.tags.push({ name: '镜佑', turns: 999 });
      }
      for (const ally of allies.filter(unit => unit.hpNow > 0)) changeActionBar(ally, 20, attacker);
      battleLog?.push(`  云外镜「苦海浮生」使${recipients.map(fighterLabel).join('、')}获得镜佑，友方全体行动条增加20%。`);
      specialMechanicHandled = true;
    }
    if (['角·神宫华辉', '徵·薰风', '羽·澈'].includes(skill?.name ?? '') && attacker.heroId === 353) {
      if (skill?.name === '角·神宫华辉') {
        for (const ally of allies.filter(unit => unit.hpNow > 0)) {
          changeActionBar(ally, 10, attacker);
          ally.effects = ally.effects.filter(effect => effect.source !== '紧那罗·角');
          ally.effects.push({ stat: 'critDamage', amount: .4, turns: 2, source: '紧那罗·角' });
        }
        battleLog?.push('  律音「角·神宫华辉」使友方全体行动条推进10%，暴击伤害提高40%，持续2回合。');
      } else if (skill?.name === '徵·薰风') {
        for (const ally of allies.filter(unit => unit.hpNow > 0)) {
          const healed = applyHealing(attacker, ally, effectiveStat(attacker, 'attack') * .8, battleLog);
          ally.effects = ally.effects.filter(effect => effect.source !== '紧那罗·徵');
          ally.effects.push({ stat: 'defense', amount: .4, turns: 2, source: '紧那罗·徵' });
          battleLog?.push(`  律音「徵·薰风」治疗${fighterLabel(ally)} ${Math.round(healed)} 点，并使防御提高40%，持续2回合。`);
        }
      } else {
        const before = fire[attacker.side];
        fire[attacker.side] = Math.min(8, before + 1);
        let removed = 0;
        for (let index = 0; index < 3; index++) if (cleanseRandomDebuff(allies, attacker.side, random, battleLog)) removed++;
        if (removed <= 3) fire[attacker.side] = Math.min(8, fire[attacker.side] + 1);
        battleLog?.push(`  律音「羽·澈」驱散${removed}个减益，并获得${fire[attacker.side] - before}点鬼火。`);
      }
      specialMechanicHandled = true;
    }
    if (skill?.name === '灵鱼抱蕊' && attacker.heroId === 346 && targets[0]) {
      const target = targets[0];
      target.tags = target.tags.filter(tag => tag.name !== '结怨');
      for (let stack = 0; stack < 3; stack++) target.tags.push({ name: '结怨', turns: 2 });
      attacker.tags = attacker.tags.filter(tag => tag.name !== '鱼尾之簇');
      attacker.tags.push({ name: '鱼尾之簇', turns: 1 });
      attacker.tags.push({ name: '浪涌', turns: 1 });
      for (const ally of allies.filter(unit => unit.hpNow > 0)) changeActionBar(ally, 10, attacker);
      battleLog?.push(`  聆海金鱼姬「灵鱼抱蕊」为${fighterLabel(target)}施加3层结怨，开启鱼尾之簇、获得1层浪涌，并使友方全体行动条推进10%。`);
      specialMechanicHandled = true;
    }
    if (control) for (const target of targets) {
      const previous = target.control;
      applyControl(attacker, target, control, chance, random, battleLog);
      if (target.control && target.control !== previous) battleLog?.push(`  控制生效：${fighterLabel(target)}受到${target.control}；状态：${statusLabel(target)}。`);
    }
    if (activeSoul(attacker) === '涅槃之火' && attacker.hpNow / currentMaxHp(attacker) < .3) attacker.hpNow = Math.min(currentMaxHp(attacker), attacker.hpNow + currentMaxHp(attacker) * .15);
    if (skill && !heal && !shield && !addedEffects && !control && !specialMechanicHandled) battleLog?.push(`  技能「${skill.name}」含有尚未建模的特殊机制；本次已结算可识别效果。`);
    return false;
  }
  const resolveLoggedHit = (target: Fighter, hitRatio: number, hit: number, totalHits: number, lifeSteal = 0, allowRecovery = true, suppressPassiveReactions = false, extraDefenseIgnore = 0, forceCritical = false): void => {
      forceCritical = forceCritical || (attacker.heroId === 296 && skill?.name === '风' && target.hpNow / currentMaxHp(target) < .35);
      const beforeHp = target.hpNow;
      const beforeShield = target.shield;
      const beforeTimedShield = target.tags.filter(tag => (tag.shieldRemaining ?? 0) > 0).reduce((sum, tag) => sum + (tag.shieldRemaining ?? 0), 0);
      const beforeResonance = target.tags.filter(tag => tag.name === '共鸣之墙').reduce((sum, tag) => sum + (tag.absorbRemaining ?? 0), 0);
      const beforeControl = target.control;
      const beforeAttackerHp = attacker.hpNow;
      let guardian = attacker.guardedTarget === target && attacker.guardOwner?.hpNow! > 0 ? attacker.guardOwner : undefined;
      if (!aoe && !attacker.guardedAttack) {
        attacker.guardedAttack = true;
        const protectors = target.harmonyAllies.filter(unit => unit.hpNow > 0 && unit !== target && activeSoul(unit) === '薙魂');
        const protector = protectors.length ? protectors[Math.floor(random() * protectors.length)] : undefined;
      if (!suppressPassiveReactions && protector && random() < .5) {
          guardian = protector;
          attacker.guardedTarget = target;
          attacker.guardOwner = protector;
          battleLog?.push(`  薙魂触发：${fighterLabel(protector)}守护${fighterLabel(target)}，本次单体攻击伤害降低20%并由双方各分担一半。`);
        }
      }
      const lampGuardian = !suppressPassiveReactions && !aoe && target.heroId !== 552 && target.hpNow > 0
        ? target.harmonyAllies.find(unit => unit.heroId === 552 && unit.hpNow > 0 && !unit.control && unit.controlTurns <= 0)
        : undefined;
      const lampIntercept = !guardian && lampGuardian && random() < .5 ? lampGuardian : undefined;
      if (lampIntercept) battleLog?.push(`  慧明灯「业回」替${fighterLabel(target)}分担50%单体伤害。`);
      const fiveMountainDefenseIgnore = skill?.name === '五山火祭' && attacker.skillLevel >= 5
        ? attacker.fiveMountainDefenseIgnoreStacks * 30 : 0;
      const shanfengAoEReduction = aoe && target.heroId === 357 && target.skillLevel >= 2;
      if (shanfengAoEReduction && hit === 0) battleLog?.push(`  初翎山风「令」生效：受到的群体伤害降低50%。`);
      const finalHitRatio = guardian ? hitRatio * .4 : lampIntercept ? hitRatio * .5 : hitRatio;
      const attackDamage = resolveHit(attacker, target, shanfengAoEReduction ? finalHitRatio * .5 : finalHitRatio, random, lifeSteal, allowRecovery, fire[attacker.side], false, battleLog, fire, fiveMountainDefenseIgnore + extraDefenseIgnore, suppressPassiveReactions, forceCritical);
      if (lampIntercept && lampIntercept.hpNow > 0) {
        resolveHit(attacker, lampIntercept, hitRatio * .5, random, lifeSteal, allowRecovery, fire[attacker.side], false, battleLog, fire, 0, suppressPassiveReactions);
        const healAmount = lampIntercept.hp * .06;
        const selfHeal = Math.min(healAmount, currentMaxHp(lampIntercept) - lampIntercept.hpNow);
        lampIntercept.hpNow += selfHeal;
        const recipient = lampIntercept.harmonyAllies.filter(unit => unit.hpNow > 0 && unit !== lampIntercept && unit.heroId !== -1)
          .sort((a, b) => a.hpNow / currentMaxHp(a) - b.hpNow / currentMaxHp(b))[0];
        const allyHeal = recipient ? Math.min(healAmount, currentMaxHp(recipient) - recipient.hpNow) : 0;
        if (recipient) recipient.hpNow += allyHeal;
        battleLog?.push(`  慧明灯「业回」恢复自身${Math.round(selfHeal)}及生命比例最低友方${recipient ? fighterLabel(recipient) : '（无可治疗友方）'}${Math.round(allyHeal)}点生命。`);
      }
      if (skill?.name === '五山火祭' && attacker.skillLevel >= 5) {
        attacker.fiveMountainAttackCount++;
        if (attacker.fiveMountainAttackCount % 5 === 0 && attacker.fiveMountainDefenseIgnoreStacks < 5) {
          attacker.fiveMountainDefenseIgnoreStacks++;
          battleLog?.push(`  五山火祭累计攻击${attacker.fiveMountainAttackCount}次，无视防御提高至${attacker.fiveMountainDefenseIgnoreStacks * 30}点（${attacker.fiveMountainDefenseIgnoreStacks}/5层）。`);
        }
      }
      if (guardian && guardian.hpNow > 0) {
        const shared = resolveHit(attacker, guardian, hitRatio * .4, random, lifeSteal, allowRecovery, fire[attacker.side], false, battleLog, fire);
        battleLog?.push(`  薙魂分担：${fighterLabel(guardian)}承担 ${Math.round(shared)} 点伤害。`);
      }
      if (!suppressPassiveReactions && attacker.skills.some(item => item.name === '爆炸之咒') && target.hpNow > 0 && !target.bellEternalFlame) {
        const curseUpgrade = attacker.skills.find(item => item.name === '爆炸之咒')!.upgrades.slice(0, Math.max(0, attacker.skillLevel - 1));
        const curseText = [...curseUpgrade].reverse().find(item => /当前生命\d+%/.test(item)) ?? '';
        const procText = [...curseUpgrade].reverse().find(item => /触发概率增至\d+%/.test(item)) ?? '';
        target.tags = target.tags.filter(tag => !tag.redMapleDoll);
        target.tags.push({ name: '红枫娃娃', turns: 2, redMapleDoll: {
          attack: effectiveStat(attacker, 'attack'), ratio: .42,
          curseRatio: Number(/当前生命(\d+)%/.exec(curseText)?.[1] ?? 18) / 100,
          curseChance: Number(/触发概率增至(\d+)%/.exec(procText)?.[1] ?? 50) / 100,
        } });
        battleLog?.push(`  ${fighterLabel(attacker)}为${fighterLabel(target)}附加红枫娃娃（2回合；普攻后${Math.round(Number(/触发概率增至(\d+)%/.exec(procText)?.[1] ?? 50))}%概率受到${Number(/当前生命(\d+)%/.exec(curseText)?.[1] ?? 18)}%当前生命的诅咒伤害，上限为红枫攻击的250%）。`);
      }
      if (!suppressPassiveReactions && attacker.skills.some(item => item.name === '狐惑魅影') && !aoe && skill?.name !== '狐惑魅影'
        && target.hpNow > 0 && !target.bellEternalFlame) {
        target.tags = target.tags.filter(tag => !tag.foxSeal);
        target.tags.push({ name: '狐印', turns: 5, foxSeal: { attack: attacker.attack } });
        battleLog?.push(`  ${fighterLabel(target)}被附加狐印；回合开始时受到已损失生命50%的间接伤害。`);
      }
      if (!suppressPassiveReactions && control && target.hpNow > 0) applyControl(attacker, target, control, chance, random, battleLog);
      const dealt = Math.max(0, beforeHp - target.hpNow);
      const absorbed = Math.max(0, beforeShield - target.shield);
      const timedShieldAbsorbed = Math.max(0, beforeTimedShield - target.tags.filter(tag => (tag.shieldRemaining ?? 0) > 0).reduce((sum, tag) => sum + (tag.shieldRemaining ?? 0), 0));
      const resonanceAbsorbed = Math.max(0, beforeResonance - target.tags.filter(tag => tag.name === '共鸣之墙').reduce((sum, tag) => sum + (tag.absorbRemaining ?? 0), 0));
      battleLog?.push(`  ${totalHits > 1 ? `第 ${hit + 1} 段命中 ` : '攻击 '}${fighterLabel(target)}：${Math.round(dealt)} 点生命伤害${absorbed ? `（护盾吸收 ${Math.round(absorbed)}）` : ''}${timedShieldAbsorbed ? `（限时护盾吸收 ${Math.round(timedShieldAbsorbed)}）` : ''}${resonanceAbsorbed ? `（共鸣之墙吸收暴击伤害 ${Math.round(resonanceAbsorbed)}）` : ''}，剩余生命 ${Math.max(0, Math.round(target.hpNow))}；状态：${statusLabel(target)}。`);
      if (!suppressPassiveReactions && activeSoul(attacker) === '针女' && dealt > attackDamage + 1) {
        battleLog?.push(`  针女触发，额外造成 ${Math.round(dealt - attackDamage)} 点伤害。`);
      }
      if (beforeControl !== target.control && target.control) battleLog?.push(`  控制生效：${fighterLabel(target)}受到${target.control}。`);
      if (beforeAttackerHp > attacker.hpNow) battleLog?.push(`  ${fighterLabel(attacker)}受到${activeSoul(target) === '狰' ? '狰反击' : '反伤'}，剩余生命 ${Math.max(0, Math.round(attacker.hpNow))}。`);
      else if (beforeAttackerHp < attacker.hpNow) battleLog?.push(`  ${attacker.skills.some(item => item.name === '狐惑魅影') && lifeSteal > 0 ? '狐惑魅影吸血' : activeSoul(attacker) === '蝠翼' ? '蝠翼吸血' : '技能治疗'} ${fighterLabel(attacker)} ${Math.round(attacker.hpNow - beforeAttackerHp)} 点生命。`);
  };
  if (skill?.name === '寂光映月' && attacker.heroId === 372) {
    const bypass = attacker.skillLevel >= 4 && attacker.inabaWishProvided >= 12;
    for (const target of enemies.filter(unit => unit.hpNow > 0)) {
      const damage = resolveHit(attacker, target, ratioValues[0] ?? 1.38, random, 0, true, fire[attacker.side], bypass, battleLog, fire, 0, bypass);
      battleLog?.push(`  因幡辉夜姬「寂光映月」${bypass ? '无视御魂与被动' : ''}攻击${fighterLabel(target)}，造成${Math.round(damage)}点伤害。`);
    }
    if (attacker.skillLevel >= 5 && attacker.inabaWishProvided >= 24) {
      for (const target of enemies.filter(unit => unit.hpNow > 0)) {
        const damage = resolveHit(attacker, target, 1.53, random, 0, true, fire[attacker.side], true, battleLog, fire, 0, true);
        battleLog?.push(`  因幡兔「月之洗礼」无视御魂与被动攻击${fighterLabel(target)}，造成${Math.round(damage)}点伤害。`);
      }
    }
    if (attacker.skillLevel >= 3) {
      let shields = attacker.tags.filter(tag => tag.name === '因幡愿盾').length;
      const shieldStacks = Math.min(8, attacker.inabaWishProvided);
      while (shields < shieldStacks) {
        addTimedShield(attacker, currentMaxHp(attacker) * .12, '因幡愿盾', 2);
        attacker.tags.push({ name: '因幡愿盾', turns: 2 });
        shields++;
      }
      if (shields) battleLog?.push(`  「寂光映月」愿力护盾：因幡辉夜姬获得${shields}层生命上限12%的护盾（最多8层）。`);
    }
    attacker.tags = attacker.tags.filter(tag => tag.name !== '愿满夜减耗');
    const invited = allies.filter(unit => unit.hpNow > 0 && unit !== attacker && unit.tags.some(tag => tag.name === '愿佑'));
    const inviteTarget = targets.find(unit => unit.hpNow > 0) ?? enemies.find(unit => unit.hpNow > 0);
    if (inviteTarget) for (const ally of invited) {
      const basic = ally.skills.find(item => item.type === 3 && item.cost === 0);
      const ratio = basic ? Number(/攻击(\d+(?:\.\d+)?)%伤害/.exec(skillText(basic, ally.skillLevel))?.[1] ?? 100) / 100 : 1;
      const damage = resolveHit(ally, inviteTarget, ratio, random, 0, true, fire[ally.side], false, battleLog, fire);
      ally.tags = ally.tags.filter(tag => tag.name !== '愿佑');
      battleLog?.push(`  因幡辉夜姬邀战${fighterLabel(ally)}攻击${fighterLabel(inviteTarget)}，造成${Math.round(damage)}点伤害。`);
    }
    specialMechanicHandled = true;
  } else if (skill?.name === '岭上开花' && attacker.heroId === 250 && targets[0]) {
    const points = 1 + Math.floor(random() * 6);
    battleLog?.push(`  青蛙瓷器掷出${points}点，岭上开花攻击${points}次。`);
    for (let hit = 0; hit < points && targets[0].hpNow > 0; hit++) resolveLoggedHit(targets[0], ratioValues[0] ?? .49, hit, points);
    specialMechanicHandled = true;
  } else if (skill?.name === '云岸净空' && attacker.heroId === 344) {
    const sweepRatio = ratioValues[0] ?? 1.31;
    for (const target of enemies.filter(unit => unit.hpNow > 0)) {
      resolveLoggedHit(target, sweepRatio, 0, 1);
      target.tags = target.tags.filter(tag => tag.name !== '镜怒');
      target.tags.push({ name: '镜怒', turns: 999 });
      battleLog?.push(`  云外镜「镜怒」使${fighterLabel(target)}下次获得的可驱散增益失效。`);
    }
    const blackLotusTarget = targets.find(unit => unit.hpNow > 0) ?? enemies.find(unit => unit.hpNow > 0);
    if (blackLotusTarget) {
      const extra = Math.min(3, Math.floor((1 - attacker.cloudYinHp / Math.max(1, attacker.hp / 2) + 1e-7) / .3));
      for (let index = 0; index < 1 + extra && blackLotusTarget.hpNow > 0; index++) {
        resolveLoggedHit(blackLotusTarget, ratioValues[1] ?? sweepRatio, index, 1 + extra);
      }
      battleLog?.push(`  天坠黑莲攻击${fighterLabel(blackLotusTarget)}${extra ? `，阴生命每降低30%追加${extra}段` : ''}。`);
    }
    specialMechanicHandled = true;
  } else if (skill?.name === '斩' && attacker.heroId === 296 && targets[0]) {
    const primary = targets[0];
    const secondary = enemies.filter(unit => unit.hpNow > 0 && unit !== primary)
      .sort((a, b) => a.hpNow / currentMaxHp(a) - b.hpNow / currentMaxHp(b))[0];
    for (const [index, target] of [primary, secondary].filter((unit): unit is Fighter => Boolean(unit)).entries()) {
      resolveLoggedHit(target, ratio, index, 2, 0, true, false, 0, true);
      if (target.hpNow > 0) {
        const ignore = attacker.skillLevel >= 5 ? 600 : 0;
        target.tags = target.tags.filter(tag => !tag.shanfengTear);
        target.tags.push({ name: '撕裂', turns: 1, shanfengTear: { attack: effectiveStat(attacker, 'attack'), ratio: .12, defenseIgnore: ignore, healingReduction: attacker.skillLevel >= 5 ? 1 : 0 } });
        battleLog?.push(`  山风「斩」为${fighterLabel(target)}附加撕裂：其回合开始受到当前生命12%+攻击88%的间接伤害（攻击上限320%）${ignore ? '，无视600点防御' : ''}。`);
      }
    }
    specialMechanicHandled = true;
  } else if (skill?.name === '商·山吹' && attacker.heroId === 353) {
    for (let hit = 0; hit < 5 && attacker.hpNow > 0; hit++) {
      const livingTargets = enemies.filter(unit => unit.hpNow > 0);
      if (!livingTargets.length) break;
      const target = livingTargets[Math.floor(random() * livingTargets.length)];
      resolveLoggedHit(target, ratioValues[0] ?? .9, hit, 5, 0, true, true);
    }
    battleLog?.push('  律音「商·山吹」的5段攻击不会触发敌方御魂效果。');
    specialMechanicHandled = true;
  } else if ((skill?.name === '胃口大开' || skill?.name === '胃口大开·吞食天地') && attacker.heroId === 370 && targets[0]) {
    const enhanced = skill.name === '胃口大开·吞食天地';
    const primary = targets[0];
    const primaryBefore = primary.hpNow;
    resolveLoggedHit(primary, ratioValues[0] ?? 1, 0, 1);
    if (enhanced) {
      const others = enemies.filter(unit => unit.hpNow > 0 && unit !== primary);
      const share = others.length ? Math.max(0, primaryBefore - primary.hpNow) * .4 / others.length : 0;
      for (const target of others) {
        const actual = applyTrueDamage(target, share);
        battleLog?.push(`  吞食天地真实伤害：${fighterLabel(target)}受到 ${Math.round(actual)} 点伤害。`);
      }
    }
    const extraHits = enhanced ? 9 : 8;
    for (let hit = 0; hit < extraHits && attacker.hpNow > 0; hit++) {
      const livingTargets = enemies.filter(unit => unit.hpNow > 0);
      if (!livingTargets.length) break;
      const target = livingTargets[Math.floor(random() * livingTargets.length)];
      resolveLoggedHit(target, ratioValues[1] ?? .33, hit, extraHits);
    }
    const before = attacker.foodStacks;
    attacker.foodStacks = enhanced ? 0 : Math.max(0, attacker.foodStacks - 4);
    battleLog?.push(`  饭笥「${skill.name}」消耗${enhanced ? before : 4}层储备粮（${before}→${attacker.foodStacks}）。`);
    specialMechanicHandled = true;
  } else if (skill?.name === '烈焰焚天' && targets[0]) {
    const primary = targets[0];
    const beforeHp = primary.hpNow;
    resolveLoggedHit(primary, ratio, 0, 1, 0, false);
    const splashBase = Math.max(0, beforeHp - primary.hpNow) * .2;
    for (const target of enemies.filter(unit => unit.hpNow > 0 && unit !== primary)) {
      const actual = applyTrueDamage(target, splashBase);
      attacker.oniStanceDamage += actual;
      if (target.hpNow <= 0) triggerRedMapleExplosion(target, battleLog);
      battleLog?.push(`  烈焰焚天溅射${fighterLabel(target)}，造成 ${Math.round(actual)} 点真实伤害（主目标伤害的20%）。`);
    }
  } else if (skill?.name === '五山火祭') {
    const extraRatio = ratioValues[1] ?? .43;
    for (const target of targets) if (target.hpNow > 0) resolveLoggedHit(target, ratio, 0, 1, 0, false);
    let restoredFromKill = false;
    const hpCostUpgrade = [...skill.upgrades.slice(0, attacker.skillLevel - 1)].reverse()
      .find(item => /消耗生命降低至\d+(?:\.\d+)?%/.test(item)) ?? '';
    const hpCostRatio = Number(/消耗生命降低至(\d+(?:\.\d+)?)%/.exec(hpCostUpgrade)?.[1] ?? 25) / 100;
    while (fire[attacker.side] > 0 && attacker.hpNow / currentMaxHp(attacker) >= .5 && attacker.hpNow > 0) {
      const beforeFire = fire[attacker.side];
      fire[attacker.side]--;
      attacker.hpNow = Math.max(0, attacker.hpNow - currentMaxHp(attacker) * hpCostRatio);
      updateBellDivineFire(attacker, battleLog);
      battleLog?.push(`  五山火祭追加攻击：消耗1点鬼火（${beforeFire}→${fire[attacker.side]}）及 ${Math.round(currentMaxHp(attacker) * hpCostRatio)} 点生命。`);
      const aliveBefore = targets.filter(target => target.hpNow > 0).length;
      for (const target of targets) if (target.hpNow > 0) resolveLoggedHit(target, extraRatio, 0, 1, 0, false);
      const aliveAfter = targets.filter(target => target.hpNow > 0).length;
      if (!restoredFromKill && aliveAfter < aliveBefore) {
        const before = attacker.hpNow;
        attacker.hpNow = currentMaxHp(attacker);
        restoredFromKill = true;
        battleLog?.push(`  五山火祭击败敌方，${fighterLabel(attacker)}恢复至生命上限（${Math.round(currentMaxHp(attacker) - before)} 点）。`);
      }
    }
  } else {
    const foxActive = skill?.name === '狐惑魅影';
    const foxLifeSteal = attacker.skills.some(item => item.name === '狐惑魅影') && !aoe ? .2 : 0;
    const attackTargets = foxActive && targets[0]
      ? [targets[0], ...enemies.filter(target => target.hpNow > 0 && target !== targets[0])]
      : targets;
    for (const [targetIndex, target] of attackTargets.entries()) {
      if (foxActive && targetIndex > 0) {
        if (target.hpNow > 0 && attacker.hpNow > 0) resolveLoggedHit(target, ratioValues[1] ?? ratio, 0, 1, foxLifeSteal);
        continue;
      }
      let plannedHits = hitCount;
      let nextFoxThreshold = Math.floor((target.hpNow / currentMaxHp(target)) * 4) / 4 - .25;
      for (let hit = 0; hit < plannedHits && hit < 8 && attacker.hpNow > 0 && target.hpNow > 0; hit++) {
        resolveLoggedHit(target, ratio, hit, plannedHits, foxLifeSteal);
        if (foxActive) {
          while (plannedHits < 5 && target.hpNow > 0 && target.hpNow / currentMaxHp(target) <= nextFoxThreshold) {
            plannedHits++;
            nextFoxThreshold -= .25;
          }
        }
      }
      const starfire = attacker.tags.find(tag => tag.name === '星火结界');
      if ((skill?.name === '初舞' || skill?.name === '终舞') && starfire && target.hpNow > 0 && attacker.hpNow > 0) {
        const chance = (starfire.starfireLevel ?? 1) >= 4 ? 1 : .5;
        if (random() < chance) {
          const upgradeText = attacker.skills.find(item => item.name === '星火满天')?.upgrades
            .slice(0, Math.max(0, (starfire.starfireLevel ?? 1) - 1)) ?? [];
          const defenseText = [...upgradeText].reverse().find(item => /额外普攻无视\d+防御/.test(item)) ?? '';
          const lifeStealText = [...upgradeText].reverse().find(item => /附带\d+%吸血/.test(item)) ?? '';
          const defenseIgnore = Number(/无视(\d+)防御/.exec(defenseText)?.[1] ?? 0);
          const extraLifeSteal = Number(/附带(\d+)%吸血/.exec(lifeStealText)?.[1] ?? 0) / 100;
          battleLog?.push(`  星火结界触发${Math.round(chance * 100)}%额外普攻：${fighterLabel(attacker)}对${fighterLabel(target)}再攻击${hitCount}次（不触发攻击者被动、目标御魂及被动${defenseIgnore ? `；无视${defenseIgnore}点防御` : ''}${extraLifeSteal ? `；吸血${Math.round(extraLifeSteal * 100)}%` : ''}）。`);
          for (let extraHit = 0; extraHit < hitCount && attacker.hpNow > 0 && target.hpNow > 0; extraHit++) {
            resolveLoggedHit(target, ratio, extraHit, hitCount, extraLifeSteal, true, true, defenseIgnore);
          }
        }
      }
    }
  }
  if (skill?.name === '死亡宣告') {
    const delayedRatio = ratioValues[1] ?? ratio;
    for (const target of targets.filter(unit => unit.hpNow > 0)) {
      target.tags = target.tags.filter(tag => tag.name !== '死亡裁决');
      if (!target.bellEternalFlame) {
        target.tags.push({ name: '死亡裁决', turns: 1, delayedDamage: {
          attack: effectiveStat(attacker, 'attack'), crit: effectiveStat(attacker, 'crit'),
          critDamage: effectiveStat(attacker, 'critDamage'), skillLevel: attacker.skillLevel,
          judgePassive: attacker.skills.some(item => item.name === '无情'), ratio: delayedRatio,
        } });
        recordDebuff(target);
        battleLog?.push(`  ${fighterLabel(target)}受到死亡裁决；若未被驱散，将在其回合开始前受到${Math.round(delayedRatio * 100)}%攻击的间接伤害。`);
      }
    }
  }
  if (skill?.name === '纺缘' && attacker.skillLevel >= 5) {
    attacker.divinePower = Math.min(5, attacker.divinePower + 1);
    battleLog?.push(`  纺缘获得1层神力（${attacker.divinePower}/5）。`);
  }
  if (!attacker.spellUsed && attacker.hpNow > 0 && skill?.name !== '初舞' && skill?.name !== '终舞') triggerRedMapleCurse(attacker, random, battleLog);
  if (skill?.name !== '五山火祭' && activeSoul(attacker) === '涅槃之火' && attacker.hpNow / currentMaxHp(attacker) < .3) attacker.hpNow = Math.min(currentMaxHp(attacker), attacker.hpNow + currentMaxHp(attacker) * .15);
  if (automaticBellFire) {
    attacker.bellFireReady = false;
    attacker.bellFireCooldown = 2;
  }
  if (silenced) removeControl(attacker, battleLog);
  // 五山火祭本次攻击不触发自身治疗/恢复/吸血；其结算完成后，仍应
  // 正常触发“任一目标回合结束时”类友方被动（例如夏目的自动治疗）。
  return false;
}

export function simulateBattle(state: DuelState, runs = 256, sampleIndex = 0): { blueRate: number; redRate: number; drawRate: number; seed: number; sampleLog: string[] } {
  const seedText = JSON.stringify(state);
  let seed = 2166136261;
  for (let index = 0; index < seedText.length; index++) seed = Math.imul(seed ^ seedText.charCodeAt(index), 16777619) >>> 0;
  const initialSeed = seed || 1;
  const random = (): number => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  let blueWins = 0, redWins = 0, draws = 0;
  let sampleLog: string[] = [];
  for (let run = 0; run < runs; run++) {
    const battleLog: string[] | undefined = run === sampleIndex ? [] : undefined;
    const blue = buildModel(state.blue, 'blue');
    const red = buildModel(state.red, 'red');
    for (const unit of blue) unit.opponents = red;
    for (const unit of red) unit.opponents = blue;
    const fire = { blue: 4, red: 4 };
    const orbMeters: Record<SideId, OrbMeter> = {
      blue: { progress: initialOrbProgress(blue), nextSupply: 3 },
      red: { progress: initialOrbProgress(red), nextSupply: 3 },
    };
    for (const side of ['blue', 'red'] as const) {
      const team = side === 'blue' ? blue : red;
      if (team.some(unit => activeSoul(unit) === '火灵')) fire[side] = Math.min(8, fire[side] + 3);
      for (const wearer of team.filter(unit => activeSoul(unit) === '蚌精')) {
        for (const ally of team) addTimedShield(ally, wearer.hp * .1, '蚌精护盾', 1);
      }
    }
    initializePreemptiveSkills(blue, battleLog, fire);
    initializePreemptiveSkills(red, battleLog, fire);
    if (battleLog) {
      for (const unit of [...blue, ...red]) {
        const concentration = unit.tags.filter(tag => tag.name === '凝神').length;
        if (unit.heroId === 346 && concentration > 0) {
          battleLog.push(`先机｜${fighterLabel(unit)}获得${concentration}层凝神（凌波）。`);
        }
      }
      battleLog.push(`开局鬼火：蓝方 ${fire.blue}，红方 ${fire.red}（基础4火；装备火灵的一方额外获得3火）。`);
      battleLog.push(`鬼火行动条：蓝方开局 ${orbMeters.blue.progress}/5，红方 ${orbMeters.red.progress}/5；每次己方行动结束推进1格，满5格补火依次+3、+4、+5（单次最多5），鬼火存量上限8。`);
      battleLog.push(`基础速度：${[...blue, ...red].map(unit => `${fighterLabel(unit)} ${Math.round(effectiveStat(unit, 'speed'))}`).join('；')}。`);
      const equipped = [...blue, ...red].filter(unit => unit.fourSuit).map(unit => `${fighterLabel(unit)}=${unit.fourSuit}`);
      if (equipped.length) battleLog.push(`已启用御魂：${equipped.join('；')}。`);
    }
    initializeActionBar(blue, blue, red, battleLog);
    initializeActionBar(red, red, blue, battleLog);
    let actions = 0;
    while (blue.some(unit => unit.hpNow > 0) && red.some(unit => unit.hpNow > 0) && actions < 600) {
      const living = [...blue, ...red].filter(unit => unit.hpNow > 0);
      const timeToNextAction = Math.min(...living.map(unit => Math.max(0, 100 - unit.gauge) / actionSpeed(unit)));
      for (const unit of living) unit.gauge = Math.min(100, unit.gauge + actionSpeed(unit) * timeToNextAction);
      const ready = living.filter(unit => unit.gauge >= 100 - 1e-7);
      const fastest = Math.max(...ready.map(actionSpeed));
      const tied = ready.filter(unit => Math.abs(actionSpeed(unit) - fastest) < 1e-7);
      // Resolve equal-time arrivals explicitly. A random sort comparator is
      // non-transitive and can reorder otherwise identical queues unpredictably.
      const attacker = tied[Math.floor(random() * tied.length)];
      if (!attacker) break;
      for (const unit of living) if (unit.heroId === 357) unit.shanfengCritAdvanceUsed = false;
      attacker.gauge = Math.max(0, attacker.gauge - 100);
      const allies = attacker.side === 'blue' ? blue : red;
      const enemies = attacker.side === 'blue' ? red : blue;
      const expiringEffects = new Set(attacker.effects);
      const expiringTags = new Set(attacker.tags);
      if (battleLog) battleLog.push(`行动条到达顺序：${fighterLabel(attacker)}（速度 ${Math.round(actionSpeed(attacker))}，行动条100%）。`);
      if (attacker.heroId === 585) attacker.flowerExtraTurnUsed = false;
      resolveTurnStartEffects(attacker, random, battleLog, fire);
      const guardianSeal = attacker.tags.find(tag => tag.name === '守护之印');
      if (guardianSeal && attacker.skillLevel >= 2) {
        guardianSeal.actionImmunity = true;
        battleLog?.push(`  ${fighterLabel(attacker)}的守护之印触发：本次行动期间免疫伤害。`);
      }
      const turnBegan = attacker.hpNow > 0;
      let allowTurnEndHealing = true;
      if (turnBegan && attacker.bellEternalFlame) {
        battleLog?.push(`行动 ${actions + 1}｜${fighterLabel(attacker)}处于「心火永明」，无法行动。`);
      } else if (turnBegan) {
        const hpBeforeAction = new Map<Fighter, number>([...blue, ...red].map(unit => [unit, unit.hpNow]));
        const fireBeforeAction = fire[attacker.side];
        allowTurnEndHealing = !takeTurn(attacker, allies, enemies, fire, random, battleLog, actions + 1);
        if (fire[attacker.side] === fireBeforeAction) {
          for (const oracle of [...blue, ...red].filter(unit => unit.hpNow > 0 && unit.heroId === 390
            && unit.side !== attacker.side && unit.tags.some(tag => tag.name === '命运星河'))) {
            const stars = oracle.tags.filter(tag => tag.name === '星辰之力').length;
            if (stars < 6) {
              oracle.tags.push({ name: '星辰之力', turns: 999 });
              battleLog?.push(`  神启荒的星爆条件触发，星辰之力累积至${stars + 1}层。`);
              if (stars + 1 >= 6) oracle.tags = oracle.tags.filter(tag => tag.name !== '命运星河');
            }
          }
        }
        resolveFoxFollowUps(allies, enemies, hpBeforeAction, random, battleLog, fire);
        const lunarBlessingActive = attacker.heroId !== 295
          && allies.some(unit => unit.hpNow > 0 && unit.tags.some(tag => tag.name === '月之祝福'));
        advanceOrbMeter(attacker.side, fire, orbMeters[attacker.side], lunarBlessingActive ? 2 : 1, battleLog);
      } else battleLog?.push(`  ${fighterLabel(attacker)}在行动前阵亡，无法行动。`);
      if (turnBegan) resolveTurnEndPassives([...blue, ...red], attacker, random, battleLog, allowTurnEndHealing, fire, orbMeters);
      for (const seal of attacker.tags.filter(tag => tag.name === '守护之印')) delete seal.actionImmunity;
      const flowerBearer = attacker.harmonyAllies.find(unit => unit.hpNow > 0 && unit.tags.some(tag => tag.name === '血色之花'));
      const flowerSkull = flowerBearer === attacker
        ? attacker.harmonyAllies.find(unit => unit.hpNow > 0 && unit.heroId === 585 && unit.skillLevel >= 5 && !unit.flowerExtraTurnUsed)
        : undefined;
      if (turnBegan && flowerSkull) {
        flowerSkull.flowerExtraTurnUsed = true;
        flowerSkull.tags = flowerSkull.tags.filter(tag => tag.name !== '时之隙');
        flowerSkull.tags.push({ name: '时之隙', turns: 1 });
        battleLog?.push(`  荒骷髅「花吻烈魂」触发：血色之花携带者回合结束，荒骷髅进入时之隙并立即行动。`);
        const skullAllies = flowerSkull.side === 'blue' ? blue : red;
        const skullEnemies = flowerSkull.side === 'blue' ? red : blue;
        takeTurn(flowerSkull, skullAllies, skullEnemies, fire, random, battleLog, actions + 1);
        resolveTurnEndPassives([...blue, ...red], flowerSkull, random, battleLog, true, fire, orbMeters);
        flowerSkull.tags = flowerSkull.tags.filter(tag => tag.name !== '时之隙');
      }
      if (attacker.heroId === 323) attacker.tags = attacker.tags.filter(tag => tag.name !== '妖怪屋清醒');
      if (turnBegan) {
        for (const tree of [...blue, ...red].filter(unit => unit.hpNow > 0 && unit.heroId === 317)) {
          if (attacker.side !== tree.side && attacker.hpNow > 0
            && attacker.tags.filter(tag => tag.name === '灾厄花').length < 3) {
            attacker.tags.push({ name: '灾厄花', turns: 999 });
            battleLog?.push(`  人面树的灾厄花在${fighterLabel(attacker)}回合结束后生长至${attacker.tags.filter(tag => tag.name === '灾厄花').length}层。`);
          }
        }
      }
      if (turnBegan && attacker.heroId === 250 && attacker.frogCooldown > 0) attacker.frogCooldown--;
      if (turnBegan && attacker.skills.some(skill => skill.name === '铃焰灼心') && attacker.bellFireCooldown > 0) attacker.bellFireCooldown--;
      if (turnBegan) {
        const readyBell = [...blue, ...red].find(unit => unit.hpNow > 0 && !unit.bellEternalFlame && unit.bellDivineFire && unit.bellFireReady
          && unit.bellFireCooldown === 0 && !unit.control);
        if (readyBell) {
          const bellAllies = readyBell.side === 'blue' ? blue : red;
          const bellEnemies = readyBell.side === 'blue' ? red : blue;
          takeTurn(readyBell, bellAllies, bellEnemies, fire, random, battleLog, actions + 1, true);
        }
      }
      for (const effect of expiringEffects) effect.turns--;
      attacker.effects = attacker.effects.filter(effect => effect.turns > 0);
      for (const tag of expiringTags) tag.turns--;
      attacker.tags = attacker.tags.filter(tag => tag.turns > 0);
      actions++;
    }
    const blueRemaining = blue.reduce((sum, unit) => sum + Math.max(0, unit.hpNow) / currentMaxHp(unit), 0);
    const redRemaining = red.reduce((sum, unit) => sum + Math.max(0, unit.hpNow) / currentMaxHp(unit), 0);
    if (blueRemaining > redRemaining) blueWins++;
    else if (redRemaining > blueRemaining) redWins++;
    else draws++;
    if (battleLog) {
      battleLog.push(blueRemaining > redRemaining ? `样例对局结束（${actions} 次行动）：蓝方生命比例合计 ${blueRemaining.toFixed(2)}，红方 ${redRemaining.toFixed(2)}。`
        : redRemaining > blueRemaining ? `样例对局结束：红方生命比例合计 ${redRemaining.toFixed(2)}，蓝方 ${blueRemaining.toFixed(2)}。`
          : '样例对局结束：双方剩余生命相同。');
      sampleLog = battleLog;
    }
  }
  return { blueRate: blueWins / runs, redRate: redWins / runs, drawRate: draws / runs, seed: initialSeed, sampleLog };
}

export function simulateBattleSample(state: DuelState, sampleIndex: number): string[] {
  const index = Math.max(0, Math.floor(sampleIndex));
  return simulateBattle(state, index + 1, index).sampleLog;
}

