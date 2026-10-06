const { test } = require('node:test');
const assert = require('node:assert/strict');
const { simulateBattle } = require('../dist-test-renderer/renderer/features/duel/engine/battle-engine.js');
const { heroSkillsCatalog } = require('../dist-test-renderer/shared/hero-skills-data.js');

const fighter = (heroId, panel, skillLevel = 5) => ({ heroId, fourSuit: '', skillLevel, panel });

test('图鉴中的每个式神都能进入自动战斗决策', () => {
  const ids = Object.keys(heroSkillsCatalog.heroes).map(Number);
  const strongPanel = { hp: 10000, attack: 1e9, defense: 1000, speed: 10000, crit: 0, critDamage: 1.5, hit: 0, resist: 0 };
  const weakPanel = { hp: 10000, attack: 1, defense: 1000, speed: 1, crit: 0, critDamage: 1.5, hit: 0, resist: 0 };
  for (const heroId of ids) {
    const battle = simulateBattle({
      blue: [fighter(heroId, strongPanel)],
      red: [fighter(251, weakPanel)],
    }, 1);
    assert.ok(battle.sampleLog.some(line => line.startsWith('行动 ') && line.includes('蓝方·')), `式神 ${heroId} 应进入自动行动流程`);
  }
});

test('式神AI资料标注为无条件施放三技能的式神会按规则选技', () => {
  const panel = speed => ({ hp: 100000, attack: 1000, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const alwaysThirdSkill = [
    262, 263, 264, 265, 268, 269, 271, 273, 274, 275, 276, 277, 278, 281,
    290, 292, 294, 296, 297, 305, 308, 309, 310, 311, 312, 313, 314, 318, 319,
    328, 332, 335, 336, 337, 338, 339, 340, 342, 373, 375, 378, 384, 385, 386,
    387, 395, 397, 399, 559,
  ];
  for (const heroId of alwaysThirdSkill) {
    const catalogSkills = heroSkillsCatalog.heroes[heroId]?.skills ?? [];
    const thirdSkill = catalogSkills.find(skill => skill.type === 3 && skill.id % 10 === 3 && skill.cost > 0);
    if (!thirdSkill) continue;
    const battle = simulateBattle({
      blue: [fighter(heroId, panel(300))],
      red: [fighter(231, panel(1))],
    }, 1);
    const openingAction = battle.sampleLog.find(line => line.startsWith('行动 ') && line.includes('蓝方·'));
    assert.ok(openingAction?.includes(`使用技能「${thirdSkill.name}」`), `式神 ${heroId} 应优先施放三技能 ${thirdSkill.name}`);
  }
});

test('式神AI参考中的人数、增益与悬赏条件会改变自动技能选择', () => {
  const panel = speed => ({ hp: 100000, attack: 1000, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const firstBlueAction = battle => battle.sampleLog.find(line => line.startsWith('行动 ') && line.includes('蓝方·'));
  const team = (heroId, allyCount) => [fighter(heroId, panel(300))
    , ...Array.from({ length: allyCount - 1 }, (_, index) => fighter(251, panel(index + 1)))];

  const kamutsukiCrowded = simulateBattle({ blue: team(596, 3), red: [fighter(231, panel(1))] }, 1);
  assert.ok(firstBlueAction(kamutsukiCrowded)?.includes('神无月使用技能'));
  const kamutsukiSoloPair = simulateBattle({ blue: team(596, 2), red: [fighter(231, panel(1))] }, 1);
  assert.ok(firstBlueAction(kamutsukiSoloPair)?.includes('神无月使用普攻'));

  const unbuffedDream = simulateBattle({
    blue: [fighter(595, panel(300)), fighter(251, panel(100)), fighter(251, panel(90))],
    red: [fighter(231, panel(1))],
  }, 1);
  assert.ok(firstBlueAction(unbuffedDream)?.includes('梦山白藏主使用技能「白狐咒」'));

  const bountyHunter = simulateBattle({
    blue: [fighter(593, panel(300))], red: [fighter(231, panel(1))],
  }, 1);
  assert.ok(firstBlueAction(bountyHunter)?.includes('妖刀姬·绯夜猎刃使用普攻「霞光小调」'));

  const zhuyeWithFire = simulateBattle({
    blue: [fighter(597, panel(300)), fighter(251, panel(100)), fighter(251, panel(90))],
    red: [fighter(231, panel(1))],
  }, 1);
  assert.ok(firstBlueAction(zhuyeWithFire)?.includes('葛叶使用技能「狐影阵」'));
});

test('式神AI参考中的追月神、金鱼姬与铃鹿御前条件按鬼火和队伍状态决策', () => {
  const panel = speed => ({ hp: 100000, attack: 1000, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const firstBlueAction = battle => battle.sampleLog.find(line => line.startsWith('行动 ') && line.includes('蓝方·'));
  const solo = heroId => simulateBattle({
    blue: [fighter(heroId, panel(300))], red: [fighter(231, panel(1))],
  }, 1);
  const pair = heroId => simulateBattle({
    blue: [fighter(heroId, panel(300)), fighter(251, panel(100))], red: [fighter(231, panel(1))],
  }, 1);

  assert.ok(firstBlueAction(solo(295))?.includes('追月神使用普攻'), '追月神单独存活时普攻');
  assert.ok(firstBlueAction(pair(295))?.includes('追月神使用技能'), '追月神有至少2名存活友方时使用3技能');
  assert.ok(firstBlueAction(solo(282))?.includes('金鱼姬使用技能'), '开局鬼火充足时金鱼姬使用3技能');
  assert.ok(firstBlueAction(solo(351))?.includes('铃鹿御前使用技能'), '铃鹿御前优先使用可施放的3技能');
  for (const heroId of [403, 404, 405, 414, 415, 416, 417, 418, 420, 422, 423, 425, 426, 427, 428, 429, 430]) {
    assert.ok(firstBlueAction(solo(heroId))?.includes('使用技能'), `式神 ${heroId} 的 AI 固定选择2技能`);
  }
});

test('实战帧序列：追月神先开清辉月华，巡音流歌随后开律动巡游', () => {
  const f = (heroId, hp, attack, defense, speed, crit, critDamage, hit, resist) => fighter(heroId, {
    hp, attack, defense, speed, crit, critDamage, hit, resist,
  });
  const blue = [
    f(295, 26935, 2791, 743, 181, .05, 1.5, 0, .64),
    f(576, 18573, 3434, 640, 159, .60, 1.78, 0, .78),
    f(251, 12535, 3878, 640, 154, .95, 2.90, 0, .64),
    f(231, 14870, 5246, 785, 132, .78, 3.04, 0, .56),
    f(588, 14870, 7079, 640, 115, 1.10, 2.06, 0, .40),
  ];
  const red = [
    f(582, 29396, 2815, 839, 181, .22, 1.5, .15, 1.05),
    f(554, 21711, 2844, 757, 156, .10, 1.5, .06, .80),
    f(559, 15127, 5946, 556, 151, .20, 1.5, 0, 0),
    f(376, 12229, 4831, 545, 144, .75, 1.64, 0, 0),
    f(341, 15212, 3675, 581, 109, .25, 2.62, 0, 1.12),
  ];
  const battle = simulateBattle({ blue, red }, 1, 0);
  const actions = battle.sampleLog.filter(line => line.startsWith('行动 ') && /蓝方·追月神|红方·巡音流歌/.test(line));

  // Frame 000031 shows 清辉月华 plus 行动提前; frame 000061 shows 律动巡游.
  assert.ok(actions[0]?.includes('蓝方·追月神使用技能「清辉月华」'));
  assert.ok(actions[1]?.includes('红方·巡音流歌使用技能「律动巡游」'));
});

test('铃彦姬AI越过50%血线后从五山火祭切换为铃焰灼心', () => {
  const panel = speed => ({ hp: 50000, attack: 5000, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(376, panel(300))],
    red: [fighter(251, panel(1))],
  }, 1);
  const actions = battle.sampleLog.filter(line => line.startsWith('行动 ') && line.includes('蓝方·铃彦姬'));
  assert.ok(actions[0]?.includes('使用技能「五山火祭」'));
  assert.ok(actions[1]?.includes('使用技能「铃焰灼心」'), '五山火祭将生命压到50%后，按 AI 切到2技能');
});

test('式神AI参考中的新状态能驱动猫川、祸津神、卑弥呼、时曜泷夜叉姬和荒骷髅决策', () => {
  const panel = speed => ({ hp: 50000, attack: 5000, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const firstBlueAction = heroId => simulateBattle({
    blue: [fighter(heroId, panel(300)), fighter(251, panel(200))],
    red: [fighter(231, panel(1))],
  }, 1).sampleLog.find(line => line.startsWith('行动 ') && line.includes('蓝方·'));

  assert.ok(firstBlueAction(569)?.includes('技能「洗筋伐髓」'), '猫川未召出猫砂盆时先召唤');
  assert.ok(firstBlueAction(570)?.includes('技能「祷言」'), '祸津神先消耗咒纱');
  assert.ok(firstBlueAction(583)?.includes('技能「溯回时隙」'), '卑弥呼先给友方施加溯回时隙');
  assert.ok(firstBlueAction(584)?.includes('技能「曜时之旅」'), '时曜泷夜叉姬先进入时之隙');
  assert.ok(firstBlueAction(585)?.includes('技能「黄泉战旗」'), '荒骷髅的战斗开始被动已把血色之花交给最高攻击友方');
});

test('式神AI会在状态建立后切换后续技能', () => {
  const panel = (hp, attack, speed) => ({ hp, attack, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const run = heroId => simulateBattle({
    blue: [fighter(heroId, panel(100000, 100, 300))],
    red: [fighter(251, panel(100000, 1, 1))],
  }, 1).sampleLog.filter(line => line.startsWith('行动 ') && line.includes('蓝方·'));

  const catRiver = run(569);
  assert.ok(catRiver.some(line => line.includes('洗筋伐髓')));
  assert.ok(catRiver.some(line => line.includes('普攻「探温」')), '猫砂盆召出后猫川改用普攻');

  const curseGod = run(570);
  assert.equal(curseGod.filter(line => line.includes('祷言')).length, 7, '鬼火不足时普攻回火，咒纱只会在成功施放时消耗');
  assert.ok(curseGod.some(line => line.includes('祸咒')), '消耗完7层咒纱后解锁并选择3技能');

  const himiko = run(583);
  assert.ok(himiko.some(line => line.includes('溯回时隙')));
  assert.ok(himiko.some(line => line.includes('日耀时辉')), '友方获得溯回状态后改用群攻');

  const timeYasha = run(584);
  assert.ok(timeYasha.some(line => line.includes('曜时之旅')));
  assert.ok(timeYasha.some(line => line.includes('烬时之斩')), '进入时之隙后切换3技能');
});

test('式神AI依照幻境状态、梦忍法层数与治疗阈值选技能', () => {
  const panel = (hp, attack, speed) => ({ hp, attack, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const run = heroId => simulateBattle({
    blue: [fighter(heroId, panel(100000, 100, 300))],
    red: [fighter(251, panel(100000, 1, 1))],
  }, 1).sampleLog.filter(line => line.startsWith('行动 ') && line.includes('蓝方·'));

  const kaguya = run(280);
  const kaguyaBattle = simulateBattle({
    blue: [fighter(280, panel(100000, 100, 300))],
    red: [fighter(251, panel(100000, 1, 1))],
  }, 1);
  assert.ok(kaguyaBattle.sampleLog.some(line => line.includes('先机｜蓝方·辉夜姬无消耗施放「龙首之玉」')),
    '辉夜姬开局先机建立幻境，不占用首次行动');
  assert.ok(kaguya[0]?.includes('普攻「蓬莱玉枝」'), '开局幻境持续时首次行动普攻');
  const inabaBattle = simulateBattle({
    blue: [fighter(372, panel(100000, 100, 300))],
    red: [fighter(251, panel(100000, 1, 1))],
  }, 1);
  assert.ok(inabaBattle.sampleLog.some(line => line.includes('先机｜蓝方·因幡辉夜姬无消耗施放「愿满夜」')),
    '满级因幡辉夜姬开局先机建立幻境，不占用首次行动');
  assert.ok(inabaBattle.sampleLog.some(line => line.includes('寂光映月')), '鬼火充足且幻境生效时施放3技能');

  const dreamMountain = run(377);
  assert.ok(dreamMountain[0]?.includes('梦心迷兔阵！'));
  assert.ok(dreamMountain.some(line => line.includes('狩梦之乱舞！')), '累计9篇梦忍法后切换3技能');
  assert.ok(run(382)[0]?.includes('普攻「波缀」'), '队友血线均高于75%时灵海蝶普攻');
});

test('式神AI处理狐影结界、灾厄花和海怒条件', () => {
  const panel = (hp, attack, speed) => ({ hp, attack, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const run = heroId => simulateBattle({
    blue: [fighter(heroId, panel(100000, 100, 300))],
    red: [fighter(251, panel(100000, 1, 1))],
  }, 1).sampleLog.filter(line => line.startsWith('行动 ') && line.includes('蓝方·'));

  const shiro = run(316);
  assert.ok(shiro[0]?.includes('梦山狐影'));
  assert.ok(shiro[1]?.includes('普攻「炎影」'), '狐影结界仍在场时使用普攻');

  const tree = run(317);
  assert.ok(tree[0]?.includes('祸根'));
  assert.ok(tree.slice(1).some(line => line.includes('普攻「神木」')), '敌方长出灾厄花后改用普攻');

  const arakawa = run(334);
  assert.ok(arakawa.slice(0, 3).every(line => line.includes('川怒')), '零鬼火主动技能2累积海怒');
  assert.ok(arakawa.some(line => line.includes('骁浪海作斩')), '海怒达到3层后切换3技能');
});

test('御馔津依灵符数量决策，神启荒依星辰之力层数切换技能', () => {
  const panel = (hp, attack, speed) => ({ hp, attack, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const miko = simulateBattle({
    blue: [fighter(304, panel(100000, 100, 300)), fighter(304, panel(100000, 100, 200))],
    red: [fighter(251, panel(100000, 1, 1))],
  }, 1).sampleLog;
  assert.ok(miko.some(line => line.includes('先机｜蓝方·御馔津无消耗施放「狐狩界」')),
    '每个御馔津开局先机开启狐狩界');
  assert.ok(miko.some(line => line.includes('御馔津使用技能「燃爆·破魔箭」')),
    '友方御馔津都已有灵符后燃爆灵符');

  const oracle = simulateBattle({
    blue: [fighter(390, panel(100000, 100, 90))],
    red: [fighter(251, panel(100000, 1, 300))],
  }, 1).sampleLog;
  assert.ok(oracle.some(line => line.includes('神启荒的星爆条件触发')), '敌方未消耗鬼火时累积星辰之力');
  assert.ok(oracle.some(line => line.startsWith('行动 ') && line.includes('神启荒使用技能「星流霆击」')),
    '星辰之力达到3层后使用3技能');
});

test('御馔津开局先机狐狩界不占行动，结界存续时首次行动普攻', () => {
  const panel = speed => ({ hp: 100000, attack: 100, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const log = simulateBattle({
    blue: [fighter(304, panel(300))],
    red: [fighter(251, panel(1))],
  }, 1).sampleLog;
  assert.ok(log.some(line => line.includes('先机｜蓝方·御馔津无消耗施放「狐狩界」')),
    '开场立即建立狐狩界并获得灵符');
  const firstMikoAction = log.find(line => line.startsWith('行动 ') && line.includes('御馔津使用'));
  assert.ok(firstMikoAction?.includes('普攻「一矢」'),
    '视频帧显示结界存续时首次行动普攻');
});

test('紧那罗按律音优先级完成一回目，川猿按固定次序变幻三种形态', () => {
  const panel = (hp, attack, speed) => ({ hp, attack, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const run = heroId => simulateBattle({
    blue: [fighter(heroId, panel(100000, 100, 300))],
    red: [fighter(251, panel(100000, 1, 1))],
  }, 1).sampleLog;
  const kinnara = run(353);
  const melodyOrder = ['宫·赤之霞', '商·山吹', '角·神宫华辉', '徵·薰风', '羽·澈'];
  const melodyIndices = melodyOrder.map(name => kinnara.findIndex(line => line.startsWith('行动 ') && line.includes(name)));
  assert.ok(melodyIndices.every(index => index >= 0));
  assert.ok(melodyIndices.every((index, i) => i === 0 || index > melodyIndices[i - 1]), '未弹律音按 Wiki 顺序弹奏');
  assert.ok(kinnara.some(line => line.startsWith('行动 ') && line.includes('紧那罗使用技能「急」')), '本回目律音齐全后使用3技能');

  const kawazaru = run(371);
  const formIndices = ['你是坏人', '别再追我啦', '快躲起来'].map(name => kawazaru.findIndex(line => line.startsWith('行动 ') && line.includes(name)));
  assert.ok(formIndices.every(index => index >= 0));
  assert.ok(formIndices.every((index, i) => i === 0 || index > formIndices[i - 1]), '川猿依次变幻三种形态');
});

test('季先施放四时一隅·秋，累计四层四季流转后施放四季大葬', () => {
  const panel = (hp, attack, speed) => ({ hp, attack, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(392, panel(100000, 100, 300))],
    red: [fighter(251, panel(100000, 1, 1))],
  }, 1);
  const actions = battle.sampleLog.filter(line => line.startsWith('行动 ') && line.includes('蓝方·'));
  assert.ok(actions.filter(line => line.includes('四时一隅·秋')).length >= 4);
  assert.ok(actions.some(line => line.includes('四季大葬')));

  for (const heroId of [353, 392]) {
    const lowLevel = simulateBattle({
      blue: [fighter(heroId, panel(100000, 100, 300), 1)],
      red: [fighter(251, panel(100000, 1, 1))],
    }, 1).sampleLog;
    assert.ok(!lowLevel.some(line => /鬼火 \d+→-\d+/.test(line)), `式神${heroId}鬼火不足时不可施放高费技能`);
  }
});

test('巡音流歌满级技能少耗鬼火，且共鸣之墙吸收暴击伤害', () => {
  const battle = simulateBattle({
    blue: [fighter(582, { hp: 20000, attack: 1000, defense: 500, speed: 110, crit: 0, critDamage: 1.5, hit: 0, resist: 0.4 })],
    red: [fighter(251, { hp: 20000, attack: 1000, defense: 300, speed: 100, crit: 1, critDamage: 1.5, hit: 0, resist: 0 })],
  }, 1);

  assert.ok(battle.sampleLog.some(line => line.includes('巡音流歌') && line.includes('使用技能「律动巡游」') && line.includes('鬼火 4→2')));
  assert.ok(battle.sampleLog.some(line => line.includes('共鸣之墙吸收暴击伤害')));
});

test('共鸣之墙吸收暴击额外伤害，但保留普通伤害部分', () => {
  const panel = (hp, attack, defense, speed, crit, critDamage, resist = 0) => ({
    hp, attack, defense, speed, crit, critDamage, hit: 0, resist,
  });
  const battle = simulateBattle({
    blue: [fighter(251, panel(20000, 1000, 0, 200, 1, 2))],
    red: [fighter(582, panel(20000, 1000, 0, 300, 0, 1.5, .8))],
  }, 1);
  const judgeHit = battle.sampleLog.find(line => line.includes('攻击 红方·巡音流歌:')
    || line.includes('攻击 红方·巡音流歌：'));

  assert.match(judgeHit ?? '', /\d+ 点生命伤害（共鸣之墙吸收暴击伤害 \d+）/,
    '暴击加成被墙吸收后，基础伤害仍然命中');
});

test('巡音流歌脱离控制后依技能等级提升速度', () => {
  const panel = (hp, attack, speed, defense = 300) => ({ hp, attack, defense, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const outcomes = Array.from({ length: 24 }, (_, index) => simulateBattle({
    blue: [fighter(582, panel(50000, 500, 90))],
    red: [{ ...fighter(251, panel(50000, 2500, 180 + index)), fourSuit: '300015' }],
  }, 1));

  assert.ok(outcomes.some(battle => battle.sampleLog.some(line => line.includes('脱离控制，「和音回响」使速度提高60点'))));
});

test('和音回响累积三次减益后会自动消耗印记并清除死亡裁决', () => {
  const battle = simulateBattle({
    blue: [fighter(582, { hp: 20000, attack: 1000, defense: 500, speed: 90, crit: 0, critDamage: 1.5, hit: 0, resist: 0 }),
      fighter(231, { hp: 20000, attack: 500, defense: 500, speed: 80, crit: 0, critDamage: 1.5, hit: 0, resist: 0 })],
    red: [fighter(251, { hp: 50000, attack: 1000, defense: 300, speed: 100, crit: 0, critDamage: 1.5, hit: 0, resist: 0 })],
  }, 1);

  assert.ok(battle.sampleLog.some(line => line.includes('和音驱散') && line.includes('死亡裁决')));
});

test('李小狼雷帝招来消耗道符并降低目标生命上限', () => {
  const battle = simulateBattle({
    blue: [fighter(588, { hp: 20000, attack: 1000, defense: 400, speed: 110, crit: 0, critDamage: 1.5, hit: 0, resist: 0 })],
    red: [fighter(251, { hp: 50000, attack: 1000, defense: 1000, speed: 100, crit: 0, critDamage: 1.5, hit: 0, resist: 0 })],
  }, 1);

  assert.ok(battle.sampleLog.some(line => line.includes('雷帝招来')));
  assert.ok(battle.sampleLog.some(line => line.includes('消耗1张道符')));
  assert.ok(battle.sampleLog.some(line => line.includes('李小狼使用技能「雷帝招来」（鬼火 4→2）')),
    '初始1张道符应使3火技能降为2火');
  assert.ok(battle.sampleLog.some(line => line.includes('生命上限额外降低')));
  assert.ok(!battle.sampleLog.some(line => line.includes('攻击-11%')));
});

test('李小狼按式神 AI 优先攻击绝对生命值最高的敌方', () => {
  const panel = (hp, attack, speed) => ({ hp, attack, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(588, panel(30000, 1000, 220))],
    red: [fighter(251, panel(30000, 500, 80)), fighter(231, panel(80000, 500, 70))],
  }, 1);

  const firstHpCapTarget = battle.sampleLog.find(line => line.includes('生命上限额外降低'));
  assert.ok(firstHpCapTarget?.includes('鬼女红叶'), '优先瞄准绝对生命值最高的鬼女红叶');
});

test('判官按式神 AI：无死亡裁决时施放3技能，已有死亡裁决时改用普攻', () => {
  const panel = (hp, speed) => ({ hp, attack: 100, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(251, panel(50000, 300))],
    red: [fighter(231, panel(500000, 1)), fighter(588, panel(500000, 1))],
  }, 1);

  const judgeActions = battle.sampleLog.filter(line => line.startsWith('行动 ') && line.includes('判官'));
  assert.ok(judgeActions.some(line => line.includes('死亡宣告')), '没有死亡裁决时应施放3技能');
  assert.ok(judgeActions.some(line => line.includes('普攻「墨笔夺魂」')), '敌方已有死亡裁决时应改用普攻');
});

test('镜音铃·连按式神 AI 根据友方血线在2、3技能间切换', () => {
  const panel = (hp, speed) => ({ hp, attack: 100, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const simulate = (allyHp) => simulateBattle({
    blue: [fighter(564, panel(50000, 200)), fighter(251, panel(allyHp, 90))],
    red: [fighter(231, panel(50000, 100))],
  }, 1);

  const healthy = simulate(30000);
  assert.ok(healthy.sampleLog.some(line => line.includes('镜音铃·连') && line.includes('羁绊二重奏')));
  const injured = simulate(20000);
  assert.ok(injured.sampleLog.some(line => line.includes('镜音铃·连') && line.includes('守护定格')));
});

test('泷先累积戒备，达到3层后按式神 AI 施放决荡', () => {
  const battle = simulateBattle({
    blue: [fighter(561, { hp: 100000, attack: 100, defense: 1000, speed: 200, crit: .5, critDamage: 1.5, hit: 0, resist: 0 })],
    red: [fighter(231, { hp: 100000, attack: 100, defense: 1000, speed: 1, crit: 0, critDamage: 1.5, hit: 0, resist: 0 })],
  }, 1);

  assert.ok(battle.sampleLog.some(line => line.includes('泷') && line.includes('涛泷之佑')));
  assert.ok(battle.sampleLog.some(line => line.includes('戒备累积至3层')));
  assert.ok(battle.sampleLog.some(line => line.includes('泷之决荡')));
});

test('玉藻前面对单个敌方时改用2技能', () => {
  const battle = simulateBattle({
    blue: [fighter(300, { hp: 100000, attack: 100, defense: 1000, speed: 200, crit: 0, critDamage: 1.5, hit: 0, resist: 0 })],
    red: [fighter(251, { hp: 100000, attack: 1, defense: 1000, speed: 1, crit: 0, critDamage: 1.5, hit: 0, resist: 0 })],
  }, 1);

  assert.ok(battle.sampleLog.some(line => line.includes('玉藻前') && line.includes('狐火')));
});

test('天剑韧心鬼切先结缘，再按式神 AI 使用3技能', () => {
  const panel = speed => ({ hp: 100000, attack: 100, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(343, panel(200)), fighter(251, panel(190))],
    red: [fighter(231, panel(1))],
  }, 1);

  assert.ok(battle.sampleLog.some(line => line.includes('天剑韧心鬼切') && line.includes('真剑·韧心')));
  assert.ok(battle.sampleLog.some(line => line.includes('天剑韧心鬼切') && line.includes('天剑·断恶斩')));
});

test('蚌精开局护盾会吸收伤害，地藏像只在暴击后触发护盾', () => {
  const panel = speed => ({ hp: 20000, attack: 1000, defense: 300, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0.5 });
  const judgePanel = speed => ({ ...panel(speed), crit: 1, resist: 0 });
  const simulate = fourSuit => simulateBattle({
    blue: [{ heroId: 582, fourSuit, skillLevel: 5, panel: panel(90) }],
    red: [{ heroId: 251, fourSuit: '', skillLevel: 5, panel: judgePanel(120) }],
  }, 1);

  const shell = simulate('300034');
  assert.ok(shell.sampleLog.some(line => line.includes('限时护盾吸收')));
  const amulet = simulate('300003');
  assert.ok(amulet.sampleLog.some(line => line.includes('地藏像护盾')));
});

test('般若嫉恨之心封印御魂和被动，辉夜姬开局幻境与火鼠裘正常触发', () => {
  const panel = (hp, attack, speed, crit = 0) => ({ hp, attack, defense: 300, speed, crit, critDamage: 1.5, hit: 0, resist: 0 });
  const state = {
    blue: [{ ...fighter(271, panel(100000, 1000, 300)), fourSuit: '' }],
    red: [{ ...fighter(280, panel(100000, 100, 100)), fourSuit: '300014' }],
  };
  let battle;
  for (let sample = 0; sample < 128 && !battle; sample++) {
    const result = simulateBattle(state, sample + 1, sample);
    const mask = result.sampleLog.findIndex(line => line.includes('嫉恨之心触发') && line.includes('红方·辉夜姬'));
    if (mask >= 0) battle = { result, mask };
  }
  assert.ok(battle, '般若攻击时应有确定性样例触发40%鬼面');
  assert.ok(battle.result.sampleLog.some(line => line.includes('先机｜红方·辉夜姬无消耗施放「龙首之玉」')),
    '辉夜姬开局先机应先建立幻境');
  assert.ok(battle.result.sampleLog.some(line => line.includes('辉夜姬「火鼠裘」触发')),
    '辉夜姬幻境中受击或友方回合开始时应能触发供火');
  const laterLines = battle.result.sampleLog.slice(battle.mask + 1);
  const secondHimeAction = laterLines.findIndex(line => line.startsWith('行动 ') && line.includes('红方·辉夜姬'));
  const maskDurationLines = laterLines.slice(0, secondHimeAction < 0 ? undefined : secondHimeAction);
  assert.ok(!maskDurationLines.some(line => line.includes('镜姬触发')),
    '鬼面持续期间应封印携带者的镜姬四件套效果');
});

test('饭笥先机储备粮计入攻击并解锁胃口大开，攻击后消耗4层', () => {
  const panel = (hp, attack, speed) => ({ hp, attack, defense: 300, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(370, panel(100000, 1000, 300))],
    red: [fighter(251, panel(100000, 1, 1))],
  }, 1);
  assert.ok(battle.sampleLog.some(line => line.includes('先机｜蓝方·饭笥获得7层储备粮')));
  assert.ok(battle.sampleLog.some(line => line.includes('蓝方·饭笥使用技能「胃口大开」')));
  assert.ok(battle.sampleLog.some(line => line.includes('消耗4层储备粮（7→3）')));
});

test('聆海金鱼姬开局获得凝神，敌方回合结束叠层并生成灵鱼盾', () => {
  const panel = (hp, attack, speed) => ({ hp, attack, defense: 300, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(346, panel(100000, 1000, 200))],
    red: [fighter(251, panel(100000, 1, 100))],
  }, 2);

  assert.ok(battle.sampleLog.some(line => line.includes('先机｜蓝方·聆海金鱼姬获得4层凝神')));
  assert.ok(battle.sampleLog.some(line => line.includes('聆海金鱼姬「凌波」触发：获得1层凝神（5/8）')));
  assert.ok(battle.sampleLog.some(line => line.includes('聆海金鱼姬「凌波」获得灵鱼盾')));
});

test('本真三尾狐在实战属性阵容中获得灵狐守护并施加狐印', () => {
  const member = (heroId, hp, attack, defense, speed, crit, critDamage, hit, resist) => ({
    heroId, fourSuit: '', skillLevel: 5,
    panel: { hp, attack, defense, speed, crit: crit / 100, critDamage: critDamage / 100, hit: hit / 100, resist: resist / 100 },
  });
  const battle = simulateBattle({
    blue: [
      member(295, 26935, 2791, 743, 181, 5, 150, 0, 64),
      member(576, 18573, 3434, 640, 159, 60, 178, 0, 78),
      member(251, 12535, 3878, 640, 154, 95, 290, 0, 64),
      member(231, 14870, 5246, 785, 132, 78, 304, 0, 56),
      member(588, 14870, 7079, 640, 115, 110, 206, 0, 40),
    ],
    red: [
      member(582, 29396, 2815, 839, 181, 22, 150, 15, 105),
      member(554, 21711, 2844, 757, 156, 10, 150, 6, 80),
      member(559, 15127, 5946, 556, 151, 20, 150, 0, 0),
      member(376, 12229, 4831, 545, 144, 75, 164, 0, 55),
      member(341, 15212, 3675, 581, 109, 25, 262, 0, 112),
    ],
  }, 1);

  const openingActions = battle.sampleLog.filter(line => line.startsWith('行动 ')).slice(0, 5);
  assert.deepEqual(openingActions.map(line => line.match(/(?:蓝方|红方)·(.+?)使用/)[1]), [
    '追月神', '巡音流歌', '夏目&猫老师', '李小狼', '判官',
  ], '按真实视频帧 31、61、151、211、251 的顺序行动');
  assert.deepEqual(openingActions.map(line => /使用技能「(.+?)」/.exec(line)?.[1]), [
    '清辉月华', '律动巡游', '疗愈的药草', '雷帝招来', '死亡宣告',
  ]);
  assert.ok(openingActions[4].includes('判官使用技能「死亡宣告」（鬼火 3→0）'),
    '第251帧判官施放死亡宣告前为3火，技能后为0火');
  assert.ok(battle.sampleLog.some(line => line.includes('灵合：红方·本真三尾狐') && line.includes('灵狐守护')));
  assert.ok(battle.sampleLog.some(line => line.includes('被附加狐印')));
  const talismanGains = battle.sampleLog.map(line => /蓝方·李小狼获得1张道符（共(\d+)张）/.exec(line)).filter(Boolean);
  assert.ok(talismanGains.length > 0);
  assert.ok(talismanGains.every(([, count]) => Number(count) <= 3), '道符最多积累3张');
  assert.ok(openingActions[3].includes('李小狼使用技能「雷帝招来」（鬼火 3→3）'),
    '3张道符使雷帝招来免消耗鬼火，和视频第211帧的3/8一致');
  assert.ok(battle.sampleLog.some(line => line.includes('蓝方·李小狼消耗3张道符，恢复')),
    '消耗满层道符时按被动恢复生命');
  const natsumeAction = battle.sampleLog.findIndex(line => line.startsWith('行动 ') && line.includes('夏目&猫老师使用技能「疗愈的药草」'));
  const talismanAdvance = battle.sampleLog.findIndex((line, index) => index > natsumeAction
    && line.includes('蓝方·李小狼获得1张道符（共3张），行动条推进15%'));
  const nextAction = battle.sampleLog.find((line, index) => index > talismanAdvance && line.startsWith('行动 '));
  assert.ok(talismanAdvance > natsumeAction, '第151帧对应：夏目放技能后，李小狼获得道符并推进15%行动条');
  assert.ok(nextAction?.includes('李小狼'), '行动条推进后，李小狼是下一位行动者');
  assert.ok(battle.sampleLog.some(line => line.includes('样例对局结束') && line.includes('蓝方生命比例合计')),
    '真实战斗以蓝方胜利结束');
  assert.ok(!battle.sampleLog.some(line => line.includes('攻击-145%')));
  assert.ok(!battle.sampleLog.some(line => line.includes('尚未建模')));
});

test('本真三尾狐在敌方掉血达到阈值后消耗心焰施放汲魄', () => {
  const panel = (hp, attack, speed, defense = 300) => ({ hp, attack, defense, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(251, panel(30000, 1000, 80, 1000))],
    red: [fighter(559, panel(100000, 3000, 90)), fighter(251, panel(100000, 60000, 200))],
  }, 1);

  assert.ok(battle.sampleLog.some(line => line.includes('心焰触发汲魄')));
});

test('本真三尾狐自动技能优先攻击绝对生命值最低的敌方', () => {
  const panel = (hp, attack, speed, defense = 1000) => ({ hp, attack, defense, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(559, panel(100000, 100, 300))],
    red: [fighter(251, panel(12000, 100, 1)), fighter(251, panel(15000, 100, 1))],
  }, 1);

  const firstFoxHit = battle.sampleLog.find(line => line.includes('攻击 红方·'));
  assert.ok(firstFoxHit?.includes('红方·判官'));
});

test('夏目草药被动只在友方回合结束时治疗，猫老师受击后会变身攻击', () => {
  const panel = (hp, attack, speed) => ({ hp, attack, defense: 300, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(576, panel(100000, 1000, 90))],
    red: [fighter(251, panel(100000, 1000, 200))],
  }, 1);

  assert.ok(battle.sampleLog.some(line => line.includes('猫老师变身为斑')));
  assert.ok(battle.sampleLog.some(line => line.includes('斑第1段攻击')));
  assert.ok(!battle.sampleLog.some(line => line.includes('使用普攻「疗愈」')));
  assert.ok(!battle.sampleLog.some(line => line.includes('技能「疗愈」含有尚未建模')));
  assert.ok(battle.sampleLog.some(line => line.includes('草药不少于4株') && line.includes('攻击提高24%')));
});

test('鬼女红叶给敌方附加红枫娃娃，带标记目标阵亡时引爆标记', () => {
  const panel = (hp, attack, speed) => ({ hp, attack, defense: 300, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(231, panel(100000, 1000, 220)), fighter(251, panel(100000, 80000, 180))],
    red: [fighter(251, panel(30000, 1000, 100)), fighter(251, panel(30000, 1000, 90))],
  }, 1);

  assert.ok(battle.sampleLog.some(line => line.includes('红枫娃娃（2回合）')));
  assert.ok(battle.sampleLog.some(line => line.includes('红枫娃娃引爆')));
});

test('鬼女红叶只剩一个敌人且鬼火不多时改用普攻', () => {
  const panel = (hp, attack, speed) => ({ hp, attack, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(231, panel(100000, 100, 220))],
    red: [fighter(251, panel(100000, 100, 1))],
  }, 1);

  const firstMapleAction = battle.sampleLog.find(line => line.startsWith('行动 ') && line.includes('蓝方·鬼女红叶'));
  assert.ok(firstMapleAction?.includes('使用普攻「红枫」'));
  assert.ok(!firstMapleAction?.includes('死亡之舞'));
});

test('追月神仅剩自己时普攻，仍有其他存活队友时使用清辉月华', () => {
  const panel = (hp, attack, speed) => ({ hp, attack, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const solo = simulateBattle({
    blue: [fighter(295, panel(100000, 100, 220))],
    red: [fighter(251, panel(100000, 100, 1))],
  }, 1);
  const paired = simulateBattle({
    blue: [fighter(295, panel(100000, 100, 220)), fighter(251, panel(100000, 100, 1000))],
    red: [fighter(251, panel(100000, 100, 1))],
  }, 1);

  assert.ok(solo.sampleLog.some(line => line.includes('追月神') && line.includes('使用普攻「邀月」')));
  assert.ok(!solo.sampleLog.some(line => line.includes('追月神') && line.includes('清辉月华')));
  assert.ok(paired.sampleLog.some(line => line.includes('追月神') && line.includes('清辉月华')));
});

test('式神AI按阵容状态选择技能并选中正确友方目标', () => {
  const panel = (speed, critDamage = 1.5) => ({ hp: 100000, attack: 1000, defense: 1000, speed, crit: 0, critDamage, hit: 0, resist: 0 });
  const enemy = fighter(251, panel(1));
  const soloFoodSpirit = simulateBattle({
    blue: [fighter(369, panel(300))], red: [enemy],
  }, 1);
  assert.ok(soloFoodSpirit.sampleLog.some(line => line.includes('食灵') && line.includes('使用普攻「开锅」')));

  const foodSpiritWithAllies = simulateBattle({
    blue: [fighter(369, panel(300)), fighter(251, panel(200, 2.4)), fighter(251, panel(190, 1.8))],
    red: [enemy],
  }, 1);
  assert.ok(foodSpiritWithAllies.sampleLog.some(line => line.includes('食灵使用技能「梦想料理」')));
  assert.ok(foodSpiritWithAllies.sampleLog.some(line => line.includes('式神AI优先选择暴击伤害最高的友方') && line.includes('蓝方·判官')),
    '食灵优先选择暴击伤害最高的友方');

  const feaster = simulateBattle({
    blue: [fighter(370, panel(300))], red: [enemy],
  }, 1);
  assert.ok(feaster.sampleLog.some(line => line.includes('饭笥使用技能「蓄食待发」')),
    '饭笥优先蓄食待发，满层后的胃口大开另行自动触发');
});

test('补全更多式神AI条件并覆盖友方人数与技能可用性', () => {
  const panel = speed => ({ hp: 100000, attack: 1000, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const first = heroId => simulateBattle({
    blue: [fighter(heroId, panel(300))], red: [fighter(251, panel(1))],
  }, 1).sampleLog.find(line => line.startsWith('行动 ') && line.includes('蓝方·'));

  assert.ok(first(323)?.includes('天井下使用普攻'), '天井下只剩自身时普攻');
  assert.ok(first(329)?.includes('海忍使用普攻「潜影」'), '海忍没有潜影时按AI选择3技能潜影');
  assert.ok(first(321)?.includes('入殓师使用技能'), '入殓师优先使用可用的3技能');
  assert.ok(first(393)?.includes('禅心云外镜使用技能'), '禅心云外镜优先使用可用的3技能');
  assert.ok(first(604)?.includes('不相狐禅使用技能「时也运也」'), '无增益的高攻击敌方目标使不相狐禅选择2技能');
});

test('继续补齐式神AI中的敌我人数、状态与目标优先级规则', () => {
  const panel = (speed, hp = 100000, attack = 1000) => ({ hp, attack, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const first = (blue, red) => simulateBattle({ blue, red }, 1).sampleLog.find(line => line.startsWith('行动 ') && line.includes('蓝方·'));

  assert.ok(first([fighter(286, panel(300))], [fighter(251, panel(1))])?.includes('以津真天使用普攻'));
  assert.ok(first([fighter(286, panel(300))], [fighter(251, panel(2)), fighter(231, panel(1))])?.includes('以津真天使用技能「千羽风之舞」'));
  assert.ok(first([fighter(287, panel(300)), fighter(251, panel(100))], [fighter(231, panel(1))])?.includes('匣中少女使用技能「回梦」'));
  assert.ok(first([fighter(289, panel(300)), fighter(251, panel(100))], [fighter(231, panel(1))])?.includes('兔丸使用普攻「萌动」'));
  assert.ok(first([fighter(366, panel(300))], [fighter(251, panel(1))])?.includes('空相面灵气使用普攻「表里之相」'));
  assert.ok(first([fighter(366, panel(300)), fighter(251, panel(100))], [fighter(231, panel(1))])?.includes('空相面灵气使用技能「梦虚空境」'));
  assert.ok(first([fighter(306, panel(300))], [fighter(251, panel(1))])?.includes('虫师使用普攻「虫之舞」'));
  assert.ok(first([fighter(307, panel(300))], [fighter(251, panel(2)), fighter(231, panel(1))])?.includes('猫掌柜使用技能「猫合战」'));
  assert.ok(first([fighter(330, panel(300))], [fighter(251, panel(1))])?.includes('不知火使用普攻「初舞」'));
  assert.ok(first([fighter(355, panel(300))], [fighter(251, panel(1))])?.includes('麓铭大岳丸使用普攻「铭海之主」'));
  assert.ok(first([fighter(360, panel(300))], [fighter(251, panel(1))])?.includes('灶门祢豆子使用技能「鬼化」'));
  assert.ok(first([fighter(361, panel(300))], [fighter(251, panel(1))])?.includes('垢尝使用普攻「脏兮兮」'));
  assert.ok(first([fighter(324, panel(300)), fighter(251, panel(200))], [fighter(231, panel(1))])?.includes('化鲸使用普攻「水袭」'),
    '开场先机已建立齿甲、体甲，化鲸首次行动应普攻，避免重复施加先机状态');
  assert.ok(first([fighter(320, panel(300))], [fighter(251, panel(1))])?.includes('一反木绵使用技能「雪织」'));
  assert.ok(first([fighter(348, panel(300))], [fighter(251, panel(1))])?.includes('浮世青行灯使用技能「浮世终话」'));
  assert.ok(first([fighter(394, panel(300))], [fighter(251, panel(1))])?.includes('月读使用技能「虚诞月落」'));
  const moon = simulateBattle({
    blue: [fighter(394, panel(400))],
    red: [fighter(231, panel(2)), fighter(251, panel(1))],
  }, 2);
  assert.ok(moon.sampleLog.some(line => line.includes('月读按式神AI为绝对生命值最高的敌方红方·判官附加2层惑星')),
    '月读群攻后只给AI选中的绝对生命值最高目标附加惑星');
  assert.ok(first([fighter(398, panel(300))], [fighter(251, panel(1))])?.includes('天逆每使用技能「惧影随」'));
});

test('灶门炭治郎按敌方人数切换技能形态，解锁后优先使用火之神神乐', () => {
  const panel = speed => ({ hp: 100000, attack: 1000, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const first = (count, level) => simulateBattle({
    blue: [fighter(359, panel(300), level)], red: Array.from({ length: count }, (_, index) => fighter(251, panel(index + 1))),
  }, 1).sampleLog.find(line => line.startsWith('行动 ') && line.includes('蓝方·'));
  assert.ok(first(4, 4)?.includes('灶门炭治郎使用技能「叁之型·流流舞」'));
  assert.ok(first(3, 4)?.includes('灶门炭治郎使用技能「捌之型·滝壶」'));
  assert.ok(first(1, 4)?.includes('灶门炭治郎使用技能「拾之型·生生流转」'));
  assert.ok(first(1, 5)?.includes('灶门炭治郎使用技能「火之神神乐」'));
});

test('绘世花鸟卷先施放绘梦，画影存在时使用繁花坠露', () => {
  const panel = (hp, speed) => ({ hp, attack: 1000, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(367, panel(100000, 300))],
    red: [fighter(251, panel(60000, 1)), fighter(231, panel(50000, 2))],
  }, 1);
  const opening = battle.sampleLog.findIndex(line => line.includes('蓝方·绘世花鸟卷') && line.includes('绘梦浮生'));
  const followup = battle.sampleLog.findIndex((line, index) => index > opening && line.includes('蓝方·绘世花鸟卷') && line.includes('繁花坠露'));
  assert.ok(opening >= 0);
  assert.ok(followup > opening);
  assert.ok(battle.sampleLog.some(line => line.includes('绘世花鸟卷为红方·判官施加逐墨')),
    '绘梦浮生优先给绝对生命值更高的敌方施加逐墨');
});

test('护盾和糖渍类式神优先选择尚未获得对应状态的友方', () => {
  const panel = (speed, critDamage = 1.5) => ({ hp: 100000, attack: 1000, defense: 1000, speed, crit: 0, critDamage, hit: 0, resist: 0 });
  const candy = simulateBattle({
    blue: [fighter(368, panel(300)), fighter(251, panel(200, 2.4)), fighter(231, panel(190, 1.8))],
    red: [fighter(251, panel(1))],
  }, 1);
  assert.ok(candy.sampleLog.some(line => line.includes('饴细工优先把糖渍交给未拥有糖渍的友方：蓝方·判官')));

  const umbrella = simulateBattle({
    blue: [fighter(500, panel(300)), fighter(251, panel(200)), fighter(231, panel(190))],
    red: [fighter(251, panel(1))],
  }, 1);
  assert.ok(umbrella.sampleLog.some(line => line.includes('神乐与定春优先为尚无伞之盾的友方施加护盾：蓝方·神乐&定春')),
    '队伍没有已有伞盾的目标时，可以选择自己');
});

test('追月神月之祝福将攻击加成施加给全队且庇护仅满级获得', () => {
  const panel = speed => ({ hp: 50000, attack: 1000, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const fight = skillLevel => simulateBattle({
    blue: [fighter(295, panel(220), skillLevel), fighter(251, panel(100), skillLevel)],
    red: [fighter(251, panel(80))],
  }, 1);

  const maxed = fight(5);
  const blessings = maxed.sampleLog.filter(line => line.startsWith('  月之祝福：')).slice(0, 2);
  assert.equal(blessings.length, 2, '追月神与队友都获得祝福');
  assert.ok(blessings.every(line => line.includes('攻击提升20%')));
  assert.ok(blessings.some(line => line.includes('蓝方·判官') && line.includes('速度提升20点')));
  assert.ok(maxed.sampleLog.some(line => line.includes('追月神') && line.includes('获得可抵挡控制的庇护')));

  const unmaxed = fight(1);
  assert.ok(!unmaxed.sampleLog.some(line => line.includes('追月神') && line.includes('获得可抵挡控制的庇护')));
});

test('判官已有死亡裁决时自动改用普攻', () => {
  const panel = (hp, attack, speed) => ({ hp, attack, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(251, panel(100000, 100, 220))],
    red: [fighter(251, panel(1000000, 100, 1)), fighter(231, panel(1000000, 100, 2))],
  }, 1);

  const ultimate = battle.sampleLog.findIndex(line => line.includes('蓝方·判官') && line.includes('使用技能「死亡宣告」'));
  const basicAfter = battle.sampleLog.findIndex((line, index) => index > ultimate
    && line.includes('蓝方·判官') && line.includes('使用普攻「墨笔夺魂」'));
  assert.ok(ultimate >= 0);
  assert.ok(basicAfter > ultimate);
});

test('妖琴师面对单个敌人且鬼火不多时按自动逻辑施放余音', () => {
  const panel = (hp, attack, speed) => ({ hp, attack, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(256, panel(100000, 100, 220))],
    red: [fighter(251, panel(100000, 100, 1))],
  }, 1);

  const action = battle.sampleLog.find(line => line.startsWith('行动 ') && line.includes('蓝方·妖琴师'));
  assert.ok(action?.includes('使用技能「余音」'));
  assert.ok(battle.sampleLog.some(line => line.includes('妖琴师获得额外行动')));
  assert.ok(!battle.sampleLog.some(line => line.includes('技能「余音」含有尚未建模')));
});

test('红枫娃娃按技能等级在敌方普攻后触发当前生命诅咒', () => {
  const panel = (hp, attack, speed) => ({ hp, attack, defense: 300, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const outcomes = Array.from({ length: 16 }, (_, index) => simulateBattle({
    blue: [fighter(231, panel(100000, 1000, 220)), fighter(251, panel(100000, 100, 150 + index))],
    red: [fighter(251, panel(100000, 100, 120))],
  }, 1));

  assert.ok(outcomes.some(battle => battle.sampleLog.some(line => line.includes('红枫娃娃诅咒触发'))));
  assert.ok(outcomes.every(battle => battle.sampleLog.some(line => line.includes('当前生命的诅咒伤害'))));
});

test('鬼王酒吞进入姿态后使用烈焰焚天并在姿态结束时治疗队友', () => {
  const panel = (hp, attack, speed, defense = 500) => ({ hp, attack, defense, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(251, panel(200000, 500, 90)), fighter(251, panel(200000, 500, 80))],
    red: [fighter(341, panel(200000, 2000, 200)), fighter(251, panel(200000, 500, 70))],
  }, 1);

  assert.ok(battle.sampleLog.some(line => line.includes('进入鬼王姿态')));
  assert.ok(battle.sampleLog.some(line => line.includes('使用技能「烈焰焚天」')));
  assert.ok(battle.sampleLog.filter(line => line.includes('使用技能「烈焰焚天」')).length >= 2);
  assert.ok(battle.sampleLog.some(line => line.includes('真实伤害')));
  assert.ok(battle.sampleLog.some(line => line.includes('鬼王姿态结束')));
});

test('鬼王酒吞按式神AI将焚天与烈焰焚天优先对准绝对生命值最高的敌方', () => {
  const panel = (hp, attack, speed) => ({ hp, attack, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(251, panel(150000, 1, 1)), fighter(576, panel(200000, 1, 1))],
    red: [fighter(341, panel(100000, 1, 300))],
  }, 1);

  const blast = battle.sampleLog.findIndex(line => line.includes('鬼王酒吞童子使用技能「烈焰焚天」'));
  assert.ok(blast >= 0, '鬼王酒吞进入姿态后会按AI施放烈焰焚天');
  const primaryHit = battle.sampleLog.slice(blast + 1).find(line => line.includes('攻击 蓝方·') && line.includes('点生命伤害'));
  assert.ok(primaryHit?.includes('蓝方·夏目&猫老师'), '主目标应为当前绝对生命值更高的敌方');
});

test('瑶音紧那罗技能3按当前生命值选目标，普攻按低生命比例选目标', () => {
  const panel = (hp, speed, attack = 1) => ({ hp, attack, defense: 0, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(579, panel(1_000_000, 300, 200_000))],
    red: [fighter(250, panel(1_000_000, 1)), fighter(251, panel(900_000, 1))],
  }, 1);
  const actions = battle.sampleLog.filter(line => line.startsWith('行动 ') && line.includes('蓝方·瑶音紧那罗'));
  const basicHit = battle.sampleLog.slice(battle.sampleLog.indexOf(actions[1]) + 1)
    .find(line => line.includes('攻击 红方·'));

  assert.ok(actions[0]?.includes('使用技能「世间之曲」'));
  assert.ok(actions[1]?.includes('使用普攻「浴音而生」'));
  assert.ok(basicHit?.includes('红方·青蛙瓷器'), '技能3先攻击高绝对生命目标后，普攻转而追击低血线目标');
});

test('式神 AI 的新目标优先级区分当前生命、生命上限与攻击', () => {
  const panel = (hp, attack, speed) => ({ hp, attack, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const targetOf = (heroId, red) => {
    const battle = simulateBattle({
      blue: [fighter(heroId, panel(200000, 100000, 300)), ...(heroId === 366 ? [fighter(576, panel(100000, 1, 1))] : [])],
      red,
    }, 1);
    const action = battle.sampleLog.findIndex(line => line.startsWith('行动 ') && line.includes('蓝方·'));
    return battle.sampleLog.slice(action + 1).find(line => line.includes('攻击 红方·') && line.includes('点生命伤害'));
  };

  assert.ok(targetOf(315, [fighter(251, panel(50000, 100, 1)), fighter(251, panel(80000, 1, 1))])?.includes('红方·判官'),
    '少羽大天狗优先当前生命更高的敌方');
  assert.ok(targetOf(366, [fighter(251, panel(50000, 100, 1)), fighter(251, panel(80000, 1, 1))])?.includes('红方·判官'),
    '空相面灵气3技能优先当前生命更高的敌方');
  assert.ok(targetOf(364, [fighter(251, panel(100000, 100, 1)), fighter(251, panel(200000, 1, 1))])?.includes('红方·判官'),
    '阿修罗3技能优先最大生命值更高的敌方');
  assert.ok(targetOf(362, [fighter(251, panel(100000, 1, 1)), fighter(251, panel(200000, 100, 1))])?.includes('红方·判官'),
    '蝉冰雪女3技能优先攻击更高的敌方');
});

test('寻香行与帝释天按状态切换自动技能', () => {
  const panel = (hp, attack, speed) => ({ hp, attack, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const run = heroId => simulateBattle({
    blue: [fighter(heroId, panel(100000, 1000, 300))],
    red: [fighter(251, panel(100000, 100, 1)), fighter(576, panel(100000, 100, 1))],
  }, 1).sampleLog.filter(line => line.startsWith('行动 ') && line.includes('蓝方·'));

  const incense = run(391);
  assert.ok(incense[0]?.includes('缚梦明香'), '寻香行先开启明香境');
  assert.ok(incense.some(line => line.includes('菩提愿')), '明香境生效后转用群攻');

  const lotus = run(363);
  assert.ok(lotus[0]?.includes('无垢莲华'), '帝释天先给最高生命目标施加金莲');
  assert.ok(lotus.some(line => line.includes('刹那莲华绽放')), '目标已有金莲后转用群攻');
});

test('荒、鸩、千姬与心狩鬼女红叶按已建模状态切换 AI 技能', () => {
  const panel = (hp, attack, speed) => ({ hp, attack, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const blueActions = (heroId, enemies, rounds = 3, allies = []) => simulateBattle({
    blue: [fighter(heroId, panel(100000, 1000, 500)), ...allies],
    red: enemies,
  }, rounds).sampleLog.filter(line => line.startsWith('行动 ') && line.includes('蓝方·'));

  const onmyoji = blueActions(283, [fighter(251, panel(100000, 1, 1))]);
  assert.ok(onmyoji[0]?.includes('星辰之境'), '荒先开启幻境');
  assert.ok(onmyoji.some(line => line.includes('天罚·月')), '幻境建立后使用额外技能天罚·月');

  const poison = blueActions(285, [fighter(251, panel(100000, 1, 1))]);
  assert.ok(poison[0]?.includes('毒蚀'), '仅剩一个敌方时鸩按 AI 使用3技能');

  const seaSpirit = blueActions(356, [fighter(251, panel(100000, 1, 1))], 6,
    [fighter(576, panel(100000, 1000, 450))]);
  assert.ok(seaSpirit[0]?.includes('海潮入梦'), '千姬先召唤海原贝戟');
  assert.ok(seaSpirit.some(line => line.includes('汐梦')), '海原贝戟在场、潮声未满时使用2技能');
  assert.ok(seaSpirit.some(line => line.includes('永生之汐')), '友方式神消耗鬼火叠满潮声后拔出海原贝戟');

  const maple = blueActions(388, [fighter(251, panel(100000, 1, 1))]);
  assert.ok(maple[0]?.includes('枫起之舞'), '心狩鬼女红叶先进入林隐');
  assert.ok(maple[1]?.includes('普攻'), '林隐层数仍在时切换普攻');

  const mountain = blueActions(379, [fighter(251, panel(100000, 1, 1))]);
  assert.ok(mountain[0]?.includes('水宿山行'), '不见岳先开启山行结界');
  assert.ok(mountain[1]?.includes('普攻'), '结界存在时按 AI 改用普攻');

  const serpent = blueActions(383, [fighter(251, panel(100000, 1, 1))]);
  assert.ok(serpent[0]?.includes('神堕之力'), '神堕八岐大蛇先变为蛇神');
  assert.ok(serpent.some(line => line.includes('审判仪式')), '进入蛇神状态后使用审判仪式');
});

test('低阶式神与呱太按人数、鬼火和友方增益条件决策', () => {
  const panel = (hp, speed, attack = 100) => ({ hp, attack, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const firstAction = (heroId, red, blue = [], rounds = 3) => simulateBattle({
    blue: [fighter(heroId, panel(10000, 1000)), ...blue], red,
  }, rounds).sampleLog.filter(line => line.startsWith('行动 ') && line.includes(`蓝方·`))[0];

  const noEnemies = [fighter(251, panel(10000, 1))];
  for (const [heroId, skillName] of [[406, '锵锵锵'], [407, '低吟'], [409, '坚壁']]) {
    assert.ok(firstAction(heroId, noEnemies)?.includes(`使用技能「${skillName}」`), `${heroId}友方无增益时施放群体增益`);
  }
  const injuredSupport = simulateBattle({
    blue: [fighter(424, panel(10000, 500)), fighter(251, panel(10000, 450))],
    red: [fighter(296, panel(10000, 3000, 3000))],
  }, 8).sampleLog.find(line => line.startsWith('行动 ') && line.includes('蓝方·花鸟卷呱'));
  assert.ok(injuredSupport?.includes('呱·花鸟相闻'),
    '花鸟卷呱在友方低于70%时治疗');
  assert.ok(firstAction(421, [1, 2, 3].map(() => fighter(251, panel(10000, 1))))?.includes('呱·吸魂灯'),
    '青行灯呱在敌方超过2名时群攻');
  assert.ok(firstAction(408, [1, 2, 3, 4].map(() => fighter(251, panel(10000, 1))))?.includes('大扫除'),
    '帚神在敌方超过3名时群攻');
});

test('初翎山风的迅风按行动值与友方血线自动协战', () => {
  const panel = (hp, speed, attack = 100) => ({ hp, attack, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(357, panel(100000, 500, 1000))],
    red: [fighter(251, panel(100000, 1, 1))],
  }, 8);
  const log = battle.sampleLog;
  assert.ok(log.some(line => line.includes('迅风协战「迅·猎目」')), '初始行动值不足80时迅风先用猎目');
  assert.ok(log.some(line => line.includes('迅风协战「迅·击空」')), '两次积累达到80后迅风改用击空');
  assert.ok(log.some(line => line.startsWith('行动 ') && line.includes('初翎山风使用技能「岚」')),
    '迅风协战后初翎山风仍执行自己的自动技能');
});

test('珍珠和树妖按基础治疗量生成护盾并提高治疗', () => {
  const panel = (hp, attack, speed, defense = 300) => ({ hp, attack, defense, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const pearlBattle = simulateBattle({
    blue: [{ ...fighter(576, panel(20000, 1000, 50)), fourSuit: '300032' }],
    red: [fighter(251, panel(20000, 10000, 200))],
  }, 1);
  const treeBattle = simulateBattle({
    blue: [{ ...fighter(576, panel(20000, 1000, 50)), fourSuit: '300024' }],
    red: [fighter(251, panel(20000, 10000, 200))],
  }, 1);

  assert.ok(pearlBattle.sampleLog.some(line => line.includes('珍珠为') && line.includes('持续2回合')));
  assert.ok(treeBattle.sampleLog.some(line => line.includes('恢复 595 点生命')));
});

test('钓瓶火回合结束额外推进鬼火行动条并按防御治疗', () => {
  const panel = (hp, attack, speed, defense = 300) => ({ hp, attack, defense, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [{ ...fighter(251, panel(100000, 100, 250, 500)), fourSuit: '300090' }],
    red: [fighter(559, panel(100000, 1, 1))],
  }, 1);

  assert.ok(battle.sampleLog.some(line => line.includes('钓瓶火触发') && line.includes('额外推进1格')));
  assert.ok(battle.sampleLog.some(line => line.includes('鬼火行动条：1/5')),
    '钓瓶火应在本回合常规推进前额外推进一格');
  assert.ok(battle.sampleLog.some(line => line.includes('携带者防御700%')));
});

test('10点场实战校对：双方五人面板、御魂与开局行动顺序', () => {
  const panel = (attack, hp, defense, speed, crit, critDamage, hit, resist) => ({
    attack, hp, defense, speed, crit: crit / 100, critDamage: critDamage / 100,
    hit: hit / 100, resist: resist / 100,
  });
  const recordedFighter = (heroId, fourSuit, stats) => ({ heroId, fourSuit, skillLevel: 5, panel: stats });
  const battle = simulateBattle({
    blue: [
      recordedFighter(323, '300007', panel(2737, 23586, 799, 181, 20, 150, 0, 64)), // 天井下·三味
      recordedFighter(357, '300022', panel(5661, 13446, 519, 152, 67, 178, 0, 0)), // 初翎山风·心眼
      recordedFighter(313, '300036', panel(5067, 16864, 744, 132, 95, 185, 0, 144)), // 犬夜叉·针女
      recordedFighter(324, '300033', panel(4520, 18145, 686, 129, 25, 227, 0, 63)), // 化鲸·骰子鬼
      recordedFighter(238, '300080', panel(5256, 14585, 668, 115, 80, 255, 0, 55)), // 萤草·共潜
    ],
    red: [
      recordedFighter(552, '300090', panel(3413, 23984, 899, 212, 30, 150, 0, 125)), // 慧明灯·钓瓶火
      recordedFighter(585, '300021', panel(3001, 28171, 545, 208, 3, 150, 0, 56)), // 荒骷髅·薙魂
      recordedFighter(295, '300021', panel(2791, 26935, 743, 181, 5, 150, 0, 64)), // 追月神·薙魂
      recordedFighter(304, '300030', panel(4928, 15964, 648, 137, 105, 220, 60, 56)), // 御馔津·破势
      recordedFighter(330, '300034', panel(4773, 12666, 529, 135, 25, 185, 15, 48)), // 不知火·蚌精
    ],
  }, 1, 0);
  const actions = battle.sampleLog.filter(line => /^行动 \d+｜/.test(line));

  assert.deepEqual(actions.slice(0, 5).map(line => line.replace(/^行动 \d+｜/, '').replace(/（鬼火.*$/, '')),[
    '红方·慧明灯使用技能「正念」',
    '红方·荒骷髅使用技能「黄泉战旗」',
    '红方·追月神使用技能「清辉月华」',
    '蓝方·天井下使用普攻「再会之音」',
    '蓝方·初翎山风使用技能「岚」',
  ]);
  assert.ok(actions[5]?.startsWith('行动 6｜红方·御馔津使用普攻「一矢」'),
    '视频841帧中山风之后轮到御馔津正常行动');
  assert.ok(actions[6]?.startsWith('行动 6｜红方·荒骷髅使用技能「黄泉战旗」'),
    '视频921帧中荒骷髅接着触发时之隙额外行动，仍归入同一行动序号');
  assert.ok(battle.sampleLog.some(line => line.includes('御馔津「一矢·封魔」被动触发')),
    '敌方行动结束时应触发御馔津的被动追射，但不能作为御馔津自己的行动计数');
  assert.ok(battle.sampleLog.some(line => line.includes('御馔津无消耗施放「狐狩界」')),
    '御馔津狐狩界先机应在行动条排序前生效');
  assert.ok(battle.sampleLog.some(line => line.includes('已启用御魂：') && line.includes('慧明灯=钓瓶火')
    && line.includes('犬夜叉=针女') && line.includes('御馔津=破势')),
  '实战记录里的御魂效果应传入模拟器');
  assert.ok(battle.sampleLog.some(line => line.includes('不知火无消耗施放「星火满天」')),
    '不知火满级星火满天先机必须在首次行动前生效');
  assert.ok(battle.sampleLog.some(line => line.includes('结界：友方速度+25')),
    '星火结界的速度加成必须参与行动排序');
  assert.ok(battle.sampleLog.some(line => line.includes('红方·不知火对') && line.includes('星火结界触发100%额外普攻')),
    '10点场中的不知火普攻应触发满级星火结界追加攻击');
  const openingLog = battle.sampleLog.slice(0, battle.sampleLog.findIndex(line => line.startsWith('行动 6｜')));
  assert.ok(!openingLog.some(line => line.includes('尚未建模')),
    '视频已核对的前五次行动不应遗留未建模提示');
});

test('不知火星火结界按技能等级追加完整普攻并跳过目标御魂触发', () => {
  const panel = (speed, defense = 1000) => ({ hp: 100000, attack: 1000, defense, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(330, panel(300), 5)],
    red: [{ ...fighter(251, panel(1), 5), fourSuit: '返魂香' }],
  }, 1);
  const extraIndex = battle.sampleLog.findIndex(line => line.includes('星火结界触发100%额外普攻'));
  assert.ok(extraIndex >= 0, '满级不知火先机结界应保证触发追加普攻');
  assert.ok(battle.sampleLog[extraIndex].includes('再攻击2次'));
  assert.ok(battle.sampleLog[extraIndex].includes('无视200点防御') && battle.sampleLog[extraIndex].includes('吸血30%'));
  const nextAction = battle.sampleLog.findIndex((line, index) => index > extraIndex && line.startsWith('行动 '));
  const extraHits = battle.sampleLog.slice(extraIndex + 1, nextAction < 0 ? undefined : nextAction);
  assert.equal(extraHits.filter(line => /(?:攻击|命中) 红方·判官：/.test(line)).length, 2,
    '追加普攻应复刻初舞的两段攻击');
  assert.ok(!extraHits.some(line => line.includes('返魂香触发')),
    '追加普攻不触发目标御魂');
});

test('日女巳时击退行动条，轮入道有机会追加回合', () => {
  const panel = (hp, attack, speed, defense = 300) => ({ hp, attack, defense, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [{ ...fighter(251, panel(100000, 2000, 200)), fourSuit: '300013' }],
    red: [{ ...fighter(295, panel(100000, 1000, 90)), fourSuit: '300012' }],
  }, 1);

  assert.ok(battle.sampleLog.some(line => line.includes('日女巳时触发')));
  assert.ok(battle.sampleLog.some(line => line.includes('轮入道触发')));
});

test('纺愿缘结神施加尘缘与庇护，守缘刃缔结缘分并推进双方行动条', () => {
  const panel = (hp, attack, speed, defense = 1000) => ({ hp, attack, defense, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(554, panel(100000, 1000, 220)), fighter(588, panel(100000, 2000, 110)), fighter(251, panel(50000, 500, 100))],
    red: [fighter(251, panel(100000, 100, 150))],
  }, 1);

  assert.ok(battle.sampleLog.some(line => line.includes('尘缘·') && line.includes('神力')));
  assert.ok(battle.sampleLog.some(line => line.includes('施加庇护')));
  assert.ok(battle.sampleLog.some(line => line.includes('缔结胜天之缘')));
  assert.ok(battle.sampleLog.some(line => line.includes('缔结胜天之缘') && line.includes('李小狼')),
    '2技能应连接攻击最高的友方');
  assert.ok(battle.sampleLog.some(line => line.includes('缔结胜天之缘·赤') && line.includes('李小狼')),
    '式神 AI 应固定选择胜天之缘·赤');
  assert.ok(!battle.sampleLog.some(line => line.includes('缔结胜天之缘·青')),
    '胜天之缘·青不是自动战斗的初始选择');
  assert.ok(battle.sampleLog.some(line => line.includes('治疗 蓝方·李小狼')),
    '后续3技能应固定治疗2技能连接的友方');
  assert.ok(battle.sampleLog.findIndex(line => line.includes('纺愿缘结神') && line.includes('使用技能「守缘刃」'))
    < battle.sampleLog.findIndex(line => line.includes('纺愿缘结神') && line.includes('使用技能「与世结缘」')));
  assert.ok(battle.sampleLog.some(line => line.includes('胜天之缘：') && line.includes('推进30%行动条')));
  assert.ok(!battle.sampleLog.some(line => line.includes('尚未建模')));
});

test('木魅受击扣火；阴摩罗击杀回火并触发伤魂鸟治疗和增伤', () => {
  const panel = (hp, attack, speed, defense = 300) => ({ hp, attack, defense, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const wood = simulateBattle({
    blue: [{ ...fighter(251, panel(100000, 100, 60, 1000)), fourSuit: '300023' }],
    red: [fighter(251, panel(100000, 100, 100, 1000))],
  }, 1);
  const kills = simulateBattle({
    blue: [
      { ...fighter(251, panel(100000, 20000, 220)), fourSuit: '300027' },
      { ...fighter(251, panel(100000, 100, 50)), fourSuit: '300029' },
    ],
    red: [fighter(251, panel(1000, 100, 30)), fighter(251, panel(100000, 100, 20))],
  }, 1);

  assert.ok(wood.sampleLog.some(line => line.includes('木魅触发') && line.includes('削减')));
  assert.ok(kills.sampleLog.some(line => line.includes('阴摩罗击败目标')));
  assert.ok(kills.sampleLog.some(line => line.includes('伤魂鸟因') && line.includes('永久增伤20%')));

  const deadWearer = simulateBattle({
    blue: [fighter(251, panel(100000, 20000, 220))],
    red: [
      { ...fighter(251, panel(1000, 100, 30)), fourSuit: '300029' },
      { ...fighter(559, panel(100000, 100, 20)), fourSuit: '300029' },
    ],
  }, 1);
  const birdProcs = deadWearer.sampleLog.filter(line => line.includes('伤魂鸟因') && line.includes('永久增伤20%'));
  assert.equal(birdProcs.length, 1, '死亡的伤魂鸟佩戴者不能触发自身被动');
  assert.ok(birdProcs[0].includes('本真三尾狐'));
});

test('骰子鬼抵抗反击并推条，幽谷响可将抵抗的控制反弹', () => {
  const panel = (hp, attack, speed, resist, hit = 0) => ({ hp, attack, defense: 5000, speed, crit: 0, critDamage: 1.5, hit, resist });
  const dice = simulateBattle({
    blue: [{ ...fighter(251, panel(1000000, 1000, 70, .99)), fourSuit: '300033' }],
    red: [{ ...fighter(251, panel(1000000, 1000, 120, 0)), fourSuit: '300035' }],
  }, 1);
  const valley = simulateBattle({
    blue: [{ ...fighter(251, panel(1000000, 1000, 70, .99)), fourSuit: '300049' }],
    red: [{ ...fighter(251, panel(1000000, 1000, 120, 0)), fourSuit: '300035' }],
  }, 1);

  assert.ok(dice.sampleLog.some(line => line.includes('骰子鬼抵抗反击')));
  assert.ok(dice.sampleLog.some(line => line.includes('骰子鬼触发') && line.includes('推进25%')));
  assert.ok(valley.sampleLog.some(line => line.includes('幽谷响触发')));
});

test('返魂香按25%基础概率眩晕伤害者，嘲讽时降低触发概率', () => {
  const panel = (hp, attack, speed, defense = 5000) => ({ hp, attack, defense, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  let battle;
  for (let seed = 1; seed <= 64 && !battle; seed++) {
    const sample = simulateBattle({
      blue: [fighter(251, panel(1000000, 1000, 200))],
      red: [{ ...fighter(251, panel(1000000, 100, 100)), fourSuit: '300039' }],
    }, seed, seed - 1);
    if (sample.sampleLog.some(line => line.includes('返魂香触发'))) battle = sample;
  }

  assert.ok(battle, '应能观察到返魂香触发');
  assert.ok(battle.sampleLog.some(line => line.includes('返魂香触发') && line.includes('基础概率25%')));
});

test('涂佛在普攻或未能行动的回合结束时强化全队', () => {
  const panel = (hp, attack, speed) => ({ hp, attack, defense: 500, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [{ ...fighter(251, panel(100000, 1000, 150)), fourSuit: '300076' }, fighter(295, panel(100000, 1000, 90))],
    red: [fighter(251, panel(100000, 100, 30))],
  }, 1);

  assert.ok(battle.sampleLog.some(line => line.includes('涂佛触发') && line.includes('自身提升30%')));
  assert.ok(battle.sampleLog.some(line => line.includes('伤害提高')));
});

test('薙魂对单体多段攻击只判定一次并分担整次攻击伤害', () => {
  const panel = (hp, attack, speed, defense = 500) => ({ hp, attack, defense, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  let battle;
  for (let attack = 5000; attack < 5050 && !battle; attack++) {
    const sample = simulateBattle({
      blue: [fighter(251, panel(100000, 500, 60)), { ...fighter(251, panel(100000, 500, 55)), fourSuit: '300021' }],
      red: [fighter(559, panel(100000, attack, 150))],
    }, 1);
    if (sample.sampleLog.some(line => line.includes('薙魂触发'))) battle = sample;
  }

  assert.ok(battle, '至少一个确定性种子应触发薙魂守护');
  assert.ok(battle.sampleLog.some(line => line.includes('薙魂分担')));
});

test('尘冢按存活人数加伤，隐念连击增伤，兵主部与无刀取随回合成长', () => {
  const panel = (hp, attack, speed, defense = 500) => ({ hp, attack, defense, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const mound = simulateBattle({
    blue: [{ ...fighter(251, panel(100000, 1000, 200)), fourSuit: '300056' }, fighter(295, panel(100000, 1000, 80))],
    red: [fighter(251, panel(100000, 100, 30))],
  }, 1);
  const hidden = simulateBattle({
    blue: [{ ...fighter(559, panel(100000, 20000, 200)), fourSuit: '300086' }],
    red: [fighter(251, panel(100000, 100, 30))],
  }, 1);
  const stacks = simulateBattle({
    blue: [{ ...fighter(251, panel(100000, 1000, 150)), fourSuit: '300074' }, { ...fighter(251, panel(100000, 1000, 90)), fourSuit: '300092' }],
    red: [fighter(251, panel(100000, 100, 30))],
  }, 1);

  assert.ok(mound.sampleLog.some(line => line.includes('尘冢：') && line.includes('伤害提高29%')));
  assert.ok(hidden.sampleLog.some(line => line.includes('隐念：') && line.includes('第2次连续命中')));
  assert.ok(stacks.sampleLog.some(line => line.includes('兵主部：') && line.includes('获得1层兵刃')));
  assert.ok(stacks.sampleLog.some(line => line.includes('无刀取：') && line.includes('永久伤害提高15%')));
});

test('铃彦姬满级五山火祭累计攻击后会逐层无视防御', () => {
  const panel = (hp, attack, speed, defense = 100000) => ({ hp, attack, defense, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(376, panel(100000, 1000, 200))],
    red: Array.from({ length: 5 }, () => fighter(251, panel(1000000, 100, 20))),
  }, 1);

  assert.ok(battle.sampleLog.some(line => line.includes('五山火祭累计攻击5次') && line.includes('无视防御提高至30点')));
  assert.ok(battle.sampleLog.some(line => line.includes('五山火祭累计攻击10次') && line.includes('无视防御提高至60点')));
});

test('五山火祭结束后仍会触发夏目的回合结束自动治疗', () => {
  const panel = (hp, attack, speed, defense = 0) => ({ hp, attack, defense, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(576, panel(3000, 1000, 40))],
    red: [fighter(376, panel(100000, 1000, 200))],
  }, 1);

  const bellAction = battle.sampleLog.findIndex(line => line.includes('红方·铃彦姬使用技能「五山火祭」'));
  const natsumeHeal = battle.sampleLog.findIndex((line, index) => index > bellAction
    && line.includes('自动治疗（疗愈）') && line.includes('蓝方·夏目&猫老师'));
  assert.ok(bellAction >= 0, '铃彦姬先施放五山火祭');
  assert.ok(natsumeHeal > bellAction, '技能动作结束后，夏目仍响应任一目标回合结束的治疗条件');
});

test('铃彦姬低血量进入神火并无视敌方御魂效果', () => {
  const panel = (hp, attack, speed, defense) => ({ hp, attack, defense, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(376, panel(10000, 100, 200, 500))],
    red: [
      fighter(251, panel(100000, 10000, 120, 500)),
      { ...fighter(251, panel(100000, 100, 20, 500)), fourSuit: '300009' },
    ],
  }, 1);

  assert.ok(battle.sampleLog.some(line => line.includes('铃彦姬生命低于75%，永久进入神火状态')));
  assert.ok(battle.sampleLog.some(line => line.includes('神火攻击无视红方·判官的御魂效果')));
});

test('铃彦姬神火状态下回满生命会自动追加五山火祭', () => {
  const panel = (hp, attack, speed, defense) => ({ hp, attack, defense, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(251, panel(100000, 100, 50, 0))],
    red: [
      fighter(376, panel(10000, 100, 200, 5000)),
      fighter(576, panel(10000, 12000, 100, 5000)),
    ],
  }, 1);

  assert.ok(battle.sampleLog.some(line => line.includes('铃彦姬神火自动施放「五山火祭」')));
});

test('铃彦姬神火状态下友方回合结束会恢复8%生命上限', () => {
  const panel = (hp, attack, speed, defense) => ({ hp, attack, defense, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(376, panel(5000, 500, 40, 10000), 3), fighter(251, panel(100000, 500, 90, 500))],
    red: [fighter(251, panel(100000, 2500, 180, 500))],
  }, 1);

  assert.ok(battle.sampleLog.some(line => line.includes('神火：友方') && line.includes('恢复400点生命（生命上限8%）')));
});

test('铃彦姬满级受到致命伤害后进入心火永明并跳过自身行动', () => {
  const panel = (hp, attack, speed, defense = 0) => ({ hp, attack, defense, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(376, panel(1000, 10000, 200)), fighter(251, panel(50000, 100, 100))],
    red: [fighter(251, panel(1000000, 10000, 201, 10000))],
  }, 1);

  assert.ok(battle.sampleLog.some(line => line.includes('铃彦姬受到致命伤害，进入「心火永明」')));
  assert.ok(battle.sampleLog.some(line => line.includes('铃彦姬') && line.includes('处于「心火永明」，无法行动')));
});

test('进入心火永明后免疫后续红枫娃娃减益', () => {
  const panel = (hp, attack, speed, defense = 0) => ({ hp, attack, defense, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(376, panel(1000, 300, 50)), fighter(251, panel(100000, 300, 60, 100000))],
    red: [fighter(231, panel(200000, 10000, 220, 300)), fighter(588, panel(200000, 100, 210, 300))],
  }, 1);
  const bellHits = battle.sampleLog.filter(line => line.includes('攻击 蓝方·铃彦姬：'));

  assert.ok(battle.sampleLog.some(line => line.includes('铃彦姬受到致命伤害，进入「心火永明」')));
  assert.ok(battle.sampleLog.some(line => line.includes('附加红枫娃娃')));
  assert.ok(bellHits.length > 0);
  assert.ok(bellHits.every(line => !line.includes('红枫娃娃')));
});

test('慧明灯正念只给己方全队加防，并在其下回合开始收回明识灯', () => {
  const panel = speed => ({ hp: 100000, attack: 1000, defense: 500, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(231, panel(1))],
    red: [fighter(552, panel(300)), fighter(251, panel(100)), fighter(252, panel(90))],
  }, 1);
  const firstCast = battle.sampleLog.findIndex(line => line.includes('慧明灯召唤明识灯'));
  const nextTurn = battle.sampleLog.findIndex((line, index) => index > firstCast && line.includes('慧明灯回合开始，收回明识灯'));
  const buffLines = battle.sampleLog.slice(firstCast + 1, nextTurn);
  const redBuffs = buffLines.filter(line => line.includes('红方·') && line.includes('状态变化：防御+40%'));

  assert.ok(firstCast >= 0);
  assert.equal(redBuffs.length, 3);
  assert.ok(!buffLines.some(line => line.includes('蓝方·')));
  assert.ok(nextTurn > firstCast);
});

test('慧明灯业回最多叠3层并削弱攻击，正念回合返还鬼火', () => {
  const panel = (speed, attack = 1000) => ({ hp: 100000, attack, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(251, panel(1000))],
    red: [fighter(552, panel(1, 100)), fighter(252, panel(1, 100))],
  }, 1);
  const karma = battle.sampleLog.filter(line => line.includes('「业回」为伤害来源'));
  const refundBattle = simulateBattle({
    blue: [fighter(231, panel(1, 1))],
    red: [fighter(552, panel(300, 100)), fighter(252, panel(1, 100))],
  }, 1);

  assert.ok(karma.some(line => line.includes('（3/3，攻击降低15%）')));
  assert.ok(!karma.some(line => line.includes('（4/3')));
  assert.ok(refundBattle.sampleLog.some(line => line.includes('返还2点鬼火')));
});

test('荒骷髅黄泉战旗按损失生命造成两段真实伤害并将自损转为铁壁', () => {
  const panel = (speed, attack) => ({ hp: 100000, attack, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(231, panel(1, 1))],
    red: [fighter(585, panel(300, 1000)), fighter(251, panel(1, 100))],
  }, 1);
  const opening = battle.sampleLog.findIndex(line => line.includes('荒骷髅使用技能「黄泉战旗」'));
  const flagLog = battle.sampleLog.slice(opening, opening + 5).join('\n');

  assert.ok(opening >= 0);
  assert.match(flagLog, /舍命损失30000点生命/);
  assert.match(flagLog, /第1击.*真实伤害/);
  assert.match(flagLog, /第2击.*真实伤害/);
  assert.match(flagLog, /平氏铁壁30000/);
});

test('荒骷髅血色之花把携带者一半单体伤害转为自身生命流失', () => {
  const panel = (speed, attack, hp = 100000) => ({ hp, attack, defense: 500, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(231, panel(300, 500))],
    red: [fighter(585, panel(1, 100)), fighter(251, panel(1, 2000, 10000))],
  }, 1);

  assert.ok(battle.sampleLog.some(line => line.includes('「血色之花」分担50%伤害')));
  assert.ok(battle.sampleLog.some(line => line.includes('存入平氏铁壁')));
});

test('血色之花携带者回合结束会触发荒骷髅的时之隙行动', () => {
  const panel = (speed, attack, hp = 100000) => ({ hp, attack, defense: 500, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(231, panel(1, 1))],
    red: [fighter(585, panel(1, 100)), fighter(251, panel(300, 2000))],
  }, 1);

  assert.ok(battle.sampleLog.some(line => line.includes('血色之花携带者回合结束，荒骷髅进入时之隙并立即行动')));
  assert.ok(battle.sampleLog.some(line => line.includes('荒骷髅使用技能「黄泉战旗」')));
});

test('敌方式神阵亡时满级荒骷髅提高生命上限并回复生命', () => {
  const panel = (speed, attack, hp = 100000) => ({ hp, attack, defense: 100, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(251, panel(300, 100000)), fighter(585, panel(1, 1))],
    red: [fighter(231, panel(1, 1, 1))],
  }, 1);

  assert.ok(battle.sampleLog.some(line => line.includes('荒骷髅「黄泉战旗」使生命上限提高')));
});

test('天井下再会之音获得欢愉并提升友方伤害', () => {
  const panel = speed => ({ hp: 100000, attack: 1000, defense: 500, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(323, panel(300)), fighter(251, panel(200))],
    red: [fighter(231, panel(1))],
  }, 1);

  assert.ok(battle.sampleLog.some(line => line.includes('天井下获得3层欢愉')));
  assert.ok(battle.sampleLog.some(line => line.includes('伤害提高20%')));
});

test('雪女回合结束为暴伤最高友方施加冰甲盾，受击时减速攻击者', () => {
  const panel = (speed, critDamage = 1.5, attack = 1000) => ({ hp: 100000, attack, defense: 500, speed, crit: 0, critDamage, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(201, panel(300)), fighter(251, panel(100, 3))],
    red: [fighter(251, panel(200, 1.5, 3000))],
  }, 1);

  assert.ok(battle.sampleLog.some(line => line.includes('冰甲术」回合结束触发')));
  assert.ok(battle.sampleLog.some(line => line.includes('冰甲术」触发：红方·判官速度降低10点')));
});

test('因幡辉夜姬满级先机开幻境，队友施法获得愿佑', () => {
  const panel = speed => ({ hp: 100000, attack: 1000, defense: 500, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(372, panel(100)), fighter(201, panel(300))],
    red: [fighter(251, panel(1))],
  }, 1);

  assert.ok(battle.sampleLog.some(line => line.includes('因幡辉夜姬') && line.includes('创造幻境，获得3点愿力')));
  assert.ok(battle.sampleLog.some(line => line.includes('幻境触发') && line.includes('获得愿佑')));
});

test('云外镜按初始阴阳形态施放对应三技能', () => {
  const panel = (speed, attack, defense = 500) => ({ hp: 100000, attack, defense, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const yin = simulateBattle({ blue: [fighter(344, panel(300, 3000))], red: [fighter(251, panel(1, 1))] }, 1);
  const yang = simulateBattle({ blue: [fighter(344, panel(300, 1000))], red: [fighter(251, panel(1, 1)), fighter(231, panel(2, 1))] }, 1);

  assert.ok(yin.sampleLog.some(line => line.includes('云外镜使用技能「云岸净空」')));
  assert.ok(yin.sampleLog.some(line => line.includes('「镜怒」使')));
  assert.ok(yang.sampleLog.some(line => line.includes('云外镜使用技能「苦海浮生」')));
  assert.ok(yang.sampleLog.some(line => line.includes('友方全体行动条增加20%')));
});

test('青蛙瓷器阵亡后转运会向每名敌人投骰并按点数连续攻击', () => {
  const panel = (speed, attack, hp = 100000) => ({ hp, attack, defense: 500, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(251, panel(300, 100000))],
    red: [fighter(250, panel(1, 1, 1000))],
  }, 1);

  assert.ok(battle.sampleLog.some(line => line.includes('青蛙瓷器「转运」阵亡反击')));
});

test('梦山白藏主先机守护、白狐咒和符咒·破均结算', () => {
  const panel = (speed, attack, hp = 100000) => ({ hp, attack, defense: 500, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(595, panel(300, 1000)), fighter(251, panel(100, 2000, 50000))],
    red: [fighter(231, panel(200, 100000, 50000)), fighter(251, panel(1, 1000))],
  }, 1);
  assert.ok(battle.sampleLog.some(line => line.includes('先机｜') && line.includes('施加守护之印')));
  assert.ok(battle.sampleLog.some(line => line.includes('守护之印触发') && line.includes('免疫伤害')));
  assert.ok(battle.sampleLog.some(line => line.includes('白狐咒') && line.includes('恢复') && line.includes('守护之印')));
  assert.ok(battle.sampleLog.some(line => line.includes('符咒·破') && line.includes('造成伤害降低30%')));
});

test('不知火受到致命伤害后保留1点生命进入离殇并切换姿态技能', () => {
  const panel = (speed, attack, hp = 100000) => ({ hp, attack, defense: 0, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(330, panel(200, 1, 1000))],
    red: [fighter(266, panel(300, 100000, 100000)), fighter(231, panel(1, 1, 100000))],
  }, 1);
  assert.ok(battle.sampleLog.some(line => line.includes('抵挡致命伤害') && line.includes('离殇姿态')));
  assert.ok(battle.sampleLog.some(line => line.includes('不知火') && /烬染不夜|终舞/.test(line)));
});

test('初音未来鬼火不足时回退音弦动普攻，不把音之舞曲被动当普攻', () => {
  const panel = speed => ({ hp: 100000, attack: 1000, defense: 1000, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 });
  const battle = simulateBattle({
    blue: [fighter(563, panel(300))],
    red: [fighter(231, panel(1))],
  }, 1);
  assert.ok(battle.sampleLog.some(line => line.includes('初音未来使用技能「音之舞曲·序幕」')));
  assert.ok(battle.sampleLog.some(line => line.includes('初音未来使用普攻「音弦动」')));
  assert.ok(!battle.sampleLog.some(line => line.includes('技能「音之舞曲」含有尚未建模')));
});

test('截图十人阵容的御魂均被识别，代表对局日志没有漏建模提示', () => {
  const panel = (attack, hp, defense, speed, crit, critDamage, hit, resist) => ({
    attack, hp, defense, speed, crit: crit / 100, critDamage: critDamage / 100,
    hit: hit / 100, resist: resist / 100,
  });
  const unit = (heroId, fourSuit, stats) => ({ heroId, fourSuit, skillLevel: 5, panel: stats });
  const battle = simulateBattle({
    red: [
      unit(357, '300029', panel(5319, 18003, 791, 151, 36, 227, 0, 48)),
      unit(563, '300009', panel(3699, 27977, 676, 146, 39, 178, 18, 40)),
      unit(280, '300014', panel(3937, 23420, 794, 144, 30, 220, 0, 48)),
      unit(368, '300010', panel(3427, 34352, 1267, 131, 15, 171, 0, 64)),
      unit(344, '300031', panel(5150, 10370, 707, 121, 100, 283, 0, 56)),
    ],
    blue: [
      unit(201, '300035', panel(3541, 21968, 701, 157, 18, 150, 48, 40)),
      unit(250, '300036', panel(5246, 16357, 764, 149, 100, 304, 0, 56)),
      unit(330, '300049', panel(4358, 12666, 584, 147, 15, 185, 0, 63)),
      unit(595, '300014', panel(1826, 24024, 873, 123, 30, 150, 0, 64)),
      unit(372, '300034', panel(4054, 13446, 556, 113, 38, 207, 0, 0)),
    ],
  }, 1, 0);
  const soulLog = battle.sampleLog.find(line => line.startsWith('已启用御魂：'));
  for (const soul of ['伤魂鸟', '被服', '镜姬', '招财猫', '镇墓兽', '魅妖', '针女', '幽谷响', '蚌精']) {
    assert.ok(soulLog?.includes(`=${soul}`), `${soul}应按截图装备生效`);
  }
  assert.ok(!battle.sampleLog.some(line => line.includes('尚未建模')),
    '截图阵容的代表对局不应遗留未处理技能或被动');
});
