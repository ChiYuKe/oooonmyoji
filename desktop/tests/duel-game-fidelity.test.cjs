const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = '../dist-test-renderer/renderer/features/duel/engine/';
const { calcRawAttackDmg, calcAttackDmg, calcShieldAbsorb, calcExtHpAbsorb } = require(path + 'mechanics/game-damage.js');
const { composeLinear, composeMaxHp } = require(path + 'mechanics/game-stats.js');
const { calculateDamage } = require(path + 'mechanics/damage.js');
const { effectiveStats, effectiveDamageMultiplier, effectiveDamageTakenMultiplier, applyCriticalDamageTakenModifiers } = require(path + 'mechanics/stats.js');
const { applyEffectCommands } = require(path + 'core/effects.js');
const { createBattleContext } = require(path + 'core/context.js');
const { scheduleNextActor } = require(path + 'core/action-scheduler.js');
const { EventDispatcher } = require(path + 'core/event-dispatcher.js');
const { settleEvents } = require(path + 'core/settlement.js');
const { captureStatusExpirySnapshot, advanceStatusDurations } = require(path + 'core/status-lifecycle.js');
const { registerPvpRules } = require(path + 'mechanics/pvp-rules.js');
const { ContentRegistry } = require(path + 'content/registry.js');
const { executeAction } = require(path + 'core/action-runner.js');
const { runBattle } = require(path + 'simulation/run-battle.js');
const { createBasicAttackSkill } = require(path + 'content/common-skills.js');
const { registerTenjukka, tenjukkaIds } = require(path + 'content/tenjukka.js');
const { registerFirefly, fireflyIds } = require(path + 'content/firefly.js');
const { registerInuyasha, inuyashaIds } = require(path + 'content/inuyasha.js');
const { registerControlSouls, controlSoulIds } = require(path + 'content/control-souls.js');
const { registerBaselineSouls, baselineSoulIds, guardAttackStatusId } = require(path + 'content/baseline-souls.js');
const { registerWhaleSummoner, whaleSummonerIds } = require(path + 'content/whale-summoner.js');
const { registerOmikane, omikaneIds } = require(path + 'content/omikane.js');
const { registerWisdomLamp, wisdomLampIds } = require(path + 'content/wisdom-lamp.js');
const { registerSkullGeneral, skullGeneralIds } = require(path + 'content/skull-general.js');
const { registerAsura, asuraIds } = require(path + 'content/asura.js');
const { registerShiranui, shiranuiIds } = require(path + 'content/shiranui.js');
const { registerFirstHaneMountainWind, firstHaneMountainWindIds } = require(path + 'content/first-hane-mountain-wind.js');
const { registerGhostServantWhite, ghostServantWhiteIds } = require(path + 'content/ghost-servant-white.js');
const { registerMountainChild, mountainChildIds } = require(path + 'content/mountain-child.js');
const { registerInuGod, inuGodIds } = require(path + 'content/inu-god.js');
const { registerPuppetMaster, puppetMasterIds } = require(path + 'content/puppet-master.js');
const { registerShoumu, shoumuIds } = require(path + 'content/shoumu.js');
const { registerLanternBoy, lanternBoyIds } = require(path + 'content/lantern-boy.js');
const { registerGouchang, gouchangIds } = require(path + 'content/gouchang.js');
const { registerYiguangong, yiguangongIds } = require(path + 'content/yiguangong.js');
const { registerFengli, fengliIds } = require(path + 'content/fengli.js');
const { registerBoneBoundPrincess, boneBoundPrincessIds } = require(path + 'content/bone-bound-princess.js');
const { registerKinnara, kinnaraIds } = require(path + 'content/kinnara.js');
const { registerChihime, chihimeIds } = require(path + 'content/chihime.js');
const { registerTanjiro, tanjiroIds } = require(path + 'content/tanjiro.js');
const { registerNezuko, nezukoIds } = require(path + 'content/nezuko.js');
const { registerEmperorOfHeaven, emperorOfHeavenIds } = require(path + 'content/emperor-of-heaven.js');
const { registerRRankStrikers, umbrellaGhostIds, greenOniIds, tombRaiderOniIds, parasiticSoulIds, broomSpriteIds,
  ootenguGuaIds, arakawaGuaIds, youngDeerGuaIds } = require(path + 'content/r-roster-strikers.js');
const { registerRRankSupports, redOniIds, yellowOniIds, blueOniIds, wallIds } = require(path + 'content/r-roster-supports.js');
const { registerScorpionGirl, scorpionGirlIds } = require(path + 'content/scorpion-girl.js');
const { registerSuzukaGozen, suzukaGozenIds } = require(path + 'content/suzuka-gozen.js');
const { registerDaybreakUbume, daybreakUbumeIds } = require(path + 'content/daybreak-ubume.js');
const { registerKappaRoster, kappaRosterIds } = require(path + 'content/kappa-roster.js');
const { registerKaruta, karutaIds } = require(path + 'content/karuta.js');
const { registerDreamButterfly, dreamButterflyIds } = require(path + 'content/dream-butterfly.js');
const { registerBlazingPeach, blazingPeachIds } = require(path + 'content/blazing-peach.js');
const { registerOniMask, oniMaskIds } = require(path + 'content/oni-mask.js');
const { registerLumingOotakemaru, lumingOotakemaruIds } = require(path + 'content/luming-ootakemaru.js');
const { registerNightBloom, nightBloomIds } = require(path + 'content/night-bloom.js');
const { registerFoodSpirit, foodSpiritIds } = require(path + 'content/food-spirit.js');
const { registerBeichuifang, beichuifangIds } = require(path + 'content/beichuifang.js');
const { registerWorldConch, worldConchIds } = require(path + 'content/world-conch.js');
const { registerEvilFloor, evilFloorIds } = require(path + 'content/evil-floor.js');
const { registerNightSendDog, nightSendDogIds } = require(path + 'content/night-send-dog.js');
const { registerNightTearStone, nightTearStoneIds } = require(path + 'content/night-tear-stone.js');
const { registerRainfallStone, rainfallStoneIds } = require(path + 'content/rainfall-stone.js');
const { registerRemembranceFire, remembranceFireIds } = require(path + 'content/remembrance-fire.js');
const { registerOilChild, oilChildIds } = require(path + 'content/oil-child.js');
const { registerOceanAtlas, oceanAtlasIds } = require(path + 'content/ocean-atlas.js');
const { registerJue, jueIds } = require(path + 'content/jue.js');
const { registerRedTongue, redTongueIds } = require(path + 'content/red-tongue.js');
const { registerFrogPorcelain, frogPorcelainIds } = require(path + 'content/frog-porcelain.js');
const { registerJudge, judgeIds } = require(path + 'content/judge.js');
const { registerPhoenixFire, phoenixFireIds } = require(path + 'content/phoenix-fire.js');
const { registerVampirePrincess, vampirePrincessIds } = require(path + 'content/vampire-princess.js');
const { registerDemonFox, demonFoxIds } = require(path + 'content/demon-fox.js');
const { registerEnma, enmaIds } = require(path + 'content/enma.js');
const { registerYaoqinShi, yaoqinShiIds } = require(path + 'content/yaoqin-shi.js');
const { registerDreamEater, dreamEaterIds } = require(path + 'content/dream-eater.js');
const { registerTwoFacedBuddha, twoFacedBuddhaIds } = require(path + 'content/two-faced-buddha.js');
const { registerYoungDeer, youngDeerIds } = require(path + 'content/youngdeer.js');
const { registerKiyohime, kiyohimeIds } = require(path + 'content/kiyohime.js');
const { registerYaodaoJi, yaodaoJiIds } = require(path + 'content/yaodao-ji.js');
const { registerLuoxinfufu, luoxinfufuIds } = require(path + 'content/luoxinfufu.js');
const { registerYiMuLian, yiMuLianIds } = require(path + 'content/yimulian.js');
const { registerQingfangzhu, qingfangzhuIds } = require(path + 'content/qingfangzhu.js');
const { registerGulonghuo, gulonghuoIds } = require(path + 'content/gulonghuo.js');
const { registerWannianzhu, wannianzhuIds } = require(path + 'content/wannianzhu.js');
const { registerYasha, yashaIds } = require(path + 'content/yasha.js');
const { registerHeitongzi, heitongziIds } = require(path + 'content/heitongzi.js');
const { registerBaitongzi, baitongziIds } = require(path + 'content/baitongzi.js');
const { registerHuaniaoJuan, huaniaoJuanIds } = require(path + 'content/huaniao-juan.js');
const { registerHuiyeji, huiyejiIds } = require(path + 'content/huiyeji.js');
const { registerYanyanluo, yanyanluoIds } = require(path + 'content/yanyanluo.js');
const { registerJinyuhime, jinyuhimeIds } = require(path + 'content/jinyuhime.js');
const { registerHuang, huangIds } = require(path + 'content/huang.js');
const { registerYijinzhentian, yijinzhentianIds } = require(path + 'content/yijinzhentian.js');
const { registerXiazhongshaonv, xiazhongshaonvIds } = require(path + 'content/xiazhongshaonv.js');
const { registerBiganhua, biganhuaIds } = require(path + 'content/biganhua.js');
const { registerXiaosongwan, xiaosongwanIds } = require(path + 'content/xiaosongwan.js');
const { registerShuweng, shuwengIds } = require(path + 'content/shuweng.js');
const { registerXuetongzi, xuetongziIds } = require(path + 'content/xuetongzi.js');
const { registerBaimugui, baimuguiIds } = require(path + 'content/baimugui.js');
const { registerNuraRiku, nuraRikuIds } = require(path + 'content/nura-riku.js');
const { registerMountainWind, mountainWindIds } = require(path + 'content/mountain-wind.js');
const { registerRihefang, rihefangIds } = require(path + 'content/rihowan.js');
const { registerTamamo, tamamoIds } = require(path + 'content/tamamo.js');
const { registerXun, xunIds } = require(path + 'content/xun.js');
const { registerJuzu, juzuIds } = require(path + 'content/juzu.js');
const { registerXiaoxiu, xiaoxiuIds } = require(path + 'content/xiaoxiu.js');
const { registerYi, yiIds } = require(path + 'content/yi.js');
const { registerMaiyaolang, maiyaolangIds } = require(path + 'content/maiyaolang.js');
const { registerCatManager, catManagerIds } = require(path + 'content/cat-manager.js');
const { registerGuideng, guidengIds } = require(path + 'content/guideng.js');
const { registerAxiang, axiangIds } = require(path + 'content/axiang.js');
const { registerPeachMaki, peachMakiIds } = require(path + 'content/peach-maki.js');
const { registerMenreiki, menreikiIds } = require(path + 'content/menreiki.js');
const { registerOnikiri, onikiriIds } = require(path + 'content/onikiri.js');
const { registerSesshomaru, sesshomaruIds } = require(path + 'content/sesshomaru.js');
const { registerYouthfulOotengu, youthfulOotenguIds } = require(path + 'content/youthful-ootengu.js');
const { registerKamaitachi, kamaitachiIds } = require(path + 'content/kamaitachi.js');
const { registerFoodHairDemon, foodHairDemonIds } = require(path + 'content/food-hair-demon.js');
const { passiveSuppressionStatusDefinition, passiveSuppressionStatusId } = require(path + 'core/passive-eligibility.js');
const { soulSuppressionStatusDefinition, soulSuppressionStatusId } = require(path + 'core/soul-eligibility.js');
const { gameSkillRow, battleSkillRow, skillNumber, gameSkillCoverage } = require('../dist-test-renderer/shared/game-skill-data.js');
const { scoreAiTarget, selectWeightedAction } = require(path + 'policies/weighted-policy.js');
const { evaluate, rosterInput } = require('../scripts/duel-calibration.cjs');

const source = { kind: 'skill', id: 'basic', unitId: 'b' };
const formula = overrides => ({ attack: 5000, defense: 652, ratio: 1, critRate: 0, critDamage: 1.5, random: () => .5, ...overrides });
const unit = (unitId, side) => ({ unitId, heroId: side === 'blue' ? 1 : 2, unitKind: 'shikigami', skillLevel: 1, side,
  stats: { hp: 10000, attack: 5000, defense: 0, speed: 100, crit: 0, critDamage: 1.5, hit: 0, resist: .99 },
  hp: 10000, shield: 0, actionGauge: 0, statuses: [], resources: {} });
function state() {
  return { units: { b: unit('b', 'blue'), r: unit('r', 'red') }, sides: { blue: ['b'], red: ['r'] },
    resources: { blue: { fire: 0 }, red: { fire: 0 } }, resourceMeters: { blue: { fire: { progress: 0, threshold: 5, nextSupply: 3, maxSupply: 5, resourceCap: 8 } },
      red: { fire: { progress: 0, threshold: 5, nextSupply: 3, maxSupply: 5, resourceCap: 8 } } },
    counters: { round: 1, action: 0, attack: 0, hit: 0 }, ended: false };
}

test('垢尝规则按客户端技能行读取倍率、驱散上限、霉球上限和四层回合末代价', () => {
  assert.match(gameSkillRow(gouchangIds.basic, 1, -1).desc, /降低25%效果命中/);
  assert.equal(gameSkillRow(gouchangIds.basic, 5, -1).addDmg, 1.2);
  assert.equal(gameSkillRow(gouchangIds.ultimate, 2, -1).addDmg, 2.23);
  assert.equal(gameSkillRow(gouchangIds.ultimate, 5, -1).param2, -.15,
    '五级一篓打尽每层霉球击退15%行动条');
  assert.match(gameSkillRow(gouchangIds.passive, 1, -1).combatDesc, /最多3个减益状态或/);
  assert.match(gameSkillRow('3614', 1, -1).combatDesc, /随机驱散1个我方单位身上的所有减益或控制效果/);
  assert.equal(gameSkillRow('3614', 1, -1).param1, 3, '战斗行以参数保留单次最多驱散3个状态');
  assert.match(gameSkillRow('3614', 1, -1).combatDesc, /最大生命值30%伤害/);
  const registry = new ContentRegistry(); registerGouchang(registry);
  assert.equal(registry.getStatus(gouchangIds.mildew).maxStacks, 4);
});

test('垢尝在敌方行动后随机净化至多3个减益并叠霉球，无法动作或封被动时不触发', () => {
  const registry = new ContentRegistry(); registerGouchang(registry);
  for (const [id, category] of [['test.gouchang-debuff', 'debuff'], ['test.gouchang-control', 'control']])
    registry.registerStatus({ id, category, dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: gouchangIds.hero, skillLevel: 5,
    stats: { ...initial.units.b.stats, resist: .4 } };
  const ally = { ...unit('b2', 'blue'), statuses: Array.from({ length: 4 }, (_, index) => ({
    instanceId: `debuff-${index}`, statusId: index === 3 ? 'test.gouchang-control' : 'test.gouchang-debuff',
    source: { kind: 'skill', id: 'test.debuff' }, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
  })) };
  initial = { ...initial, units: { ...initial.units, b2: ally }, sides: { ...initial.sides, blue: ['b', 'b2'] } };
  const definition = registry.getHero(gouchangIds.hero);
  const context = createBattleContext(initial, () => .99, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable === true);
  const event = { type: 'turn-ended', eventId: 'enemy-turn-end', phase: 'turn-end', source: { kind: 'unit', id: 'r', unitId: 'r' },
    unitId: 'r', actionId: 1 };
  const commands = definition.handlers['turn-end'].handle(context, event);
  assert.ok(commands.some(command => command.type === 'dispel-statuses' && command.targetId === 'b2' && command.maxCount === 3));
  const applied = applyEffectCommands(initial, commands, 'turn-end', event.eventId, id => registry.getStatus(id));
  assert.equal(applied.state.units.b2.statuses.length, 1, '最多清除随机友方身上的三个可驱散负面状态');
  const mark = applied.state.units.b.statuses.find(status => status.statusId === gouchangIds.mildew);
  assert.equal(mark.stacks, 1);
  assert.equal(effectiveStats(applied.state.units.b).resist, .25, '每层霉球降低15%效果抵抗');

  const sealed = { ...initial, units: { ...initial.units, b: { ...initial.units.b, statuses: [{
    instanceId: 'passive-seal', statusId: passiveSuppressionStatusId,
    source: { kind: 'skill', id: 'test.seal' }, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
  }] } } };
  const sealedContext = createBattleContext(sealed, () => .99, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable === true);
  assert.equal(definition.handlers['turn-end'].handle(sealedContext, event), undefined, '被动封印时不净化或叠霉球');
  const unableContext = createBattleContext(initial, () => .99, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable === true, unitId => unitId === 'b');
  assert.equal(definition.handlers['turn-end'].handle(unableContext, event), undefined, '垢尝无法动作时不触发回合后净化');
});

test('垢尝五级一篓打尽消耗霉球、群体加抵抗并按层击退；四层回合末承受30%生命损失', () => {
  const registry = new ContentRegistry(); registerGouchang(registry);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: gouchangIds.hero, skillLevel: 5, hp: 10000,
    statuses: [{ instanceId: 'mildew-b', statusId: gouchangIds.mildew,
      source: { kind: 'skill', id: gouchangIds.passive, unitId: 'b' }, stacks: 3, duration: { kind: 'permanent' },
      modifiers: [{ stat: 'resist', operation: 'flat', amount: -.15, perStack: true }] }] };
  initial.units.r = { ...initial.units.r, hp: 100000, actionGauge: 70,
    stats: { ...initial.units.r.stats, hp: 100000, defense: 0 } };
  initial.resources.blue.fire = 4;
  const result = executeAction(initial, { actorId: 'b', skillId: gouchangIds.ultimate,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, registry, () => .5);
  assert.equal(result.state.resources.blue.fire, 2);
  assert.equal(result.state.units.r.actionGauge, 25);
  assert.equal(result.state.units.b.statuses.some(status => status.statusId === gouchangIds.mildew), false);
  assert.ok(result.state.units.b.statuses.some(status => status.statusId === gouchangIds.resistance));
  assert.ok(result.state.units.r.hp < initial.units.r.hp);

  const dispatcher = new EventDispatcher();
  const definition = registry.getHero(gouchangIds.hero);
  dispatcher.register({ id: 'hero:361:turn-end', phase: 'turn-end', priority: definition.handlers['turn-end'].priority,
    handle: definition.handlers['turn-end'].handle });
  const full = { ...initial, units: { ...initial.units, b: { ...initial.units.b, statuses: [{
    instanceId: 'mildew-full', statusId: gouchangIds.mildew,
    source: { kind: 'skill', id: gouchangIds.passive, unitId: 'b' }, stacks: 4, duration: { kind: 'permanent' },
  }] } } };
  const turnEnd = definition.handlers['turn-end'].handle(createBattleContext(full, () => .5), {
    type: 'turn-ended', eventId: 'gouchang-own-end', phase: 'turn-end', source: { kind: 'unit', id: 'b', unitId: 'b' },
    unitId: 'b', actionId: 2,
  });
  const settled = applyEffectCommands(full, turnEnd, 'turn-end', 'gouchang-own-end', id => registry.getStatus(id));
  assert.equal(settled.state.units.b.hp, 7000);
  assert.equal(settled.state.units.b.statuses.some(status => status.statusId === gouchangIds.mildew), false);
});

test('饴细工按最低生命比例友方分担伤害并尊重不可分担攻击', () => {
  const registry = new ContentRegistry(); registerYiguangong(registry);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: yiguangongIds.hero, skillLevel: 4,
    skillLevels: { [yiguangongIds.passive]: 4 }, hp: 9000 };
  const protectedAlly = { ...unit('b2', 'blue'), hp: 3000 };
  initial.units.b2 = protectedAlly;
  initial.sides.blue = ['b', 'b2'];
  const definition = registry.getHero(yiguangongIds.hero);
  const hit = definition.interceptIncomingDamage(initial, initial.units.r, protectedAlly, 1000, 'normal', {});
  assert.equal(hit.amount, 750, '四级被动转移25%伤害');
  assert.equal(hit.effects[0].amount, 250);
  assert.equal(definition.interceptIncomingDamage(initial, initial.units.r, protectedAlly, 1000, 'normal', { cannotBeShared: true }), undefined);
  const ownLowest = { ...initial, units: { ...initial.units, b: { ...initial.units.b, hp: 2000 } } };
  assert.equal(definition.interceptIncomingDamage(ownLowest, ownLowest.units.r, ownLowest.units.b2, 1000, 'normal', {}), undefined,
    '若垢尝自己生命比例最低，则不会替第二低目标分担');
});

test('饴细工施加糖渍消耗当前生命，受击治疗每个目标每回合至多三次且溢出推条', () => {
  assert.equal(gameSkillRow(yiguangongIds.passive, 5, -1).param1, .3);
  assert.equal(gameSkillRow(yiguangongIds.skill, 1, 0).param2, .1);
  assert.equal(gameSkillRow(yiguangongIds.skill, 4, 0).buffDuration, 3);
  assert.equal(gameSkillRow(yiguangongIds.skill, 5, 0).param4, .05);
  const registry = new ContentRegistry(); registerYiguangong(registry);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: yiguangongIds.hero, skillLevel: 5, hp: 8000,
    stats: { ...initial.units.b.stats, hp: 10000 } };
  const friend = { ...unit('b2', 'blue'), hp: 10000 };
  initial.units.b2 = friend;
  initial.sides.blue = ['b', 'b2'];
  initial.resources.blue.fire = 2;
  const cast = executeAction(initial, { actorId: 'b', skillId: yiguangongIds.skill,
    targetIds: ['b2'], shape: 'single', targetRelation: 'ally' }, registry, () => .5);
  assert.equal(cast.state.units.b.hp, 6800, '消耗施放时当前生命的15%');
  const sugar = cast.state.units.b2.statuses.find(status => status.statusId === yiguangongIds.sugar);
  assert.equal(sugar.duration.remaining, 3);
  assert.equal(sugar.values.ownerUnitId, 'b');

  const definition = registry.getHero(yiguangongIds.hero);
  let current = { ...cast.state, units: { ...cast.state.units, b: { ...cast.state.units.b, hp: 5000 } } };
  const trigger = index => {
    const damage = { type: 'damage', eventId: `sugar-hit-${index}`, phase: 'hit', source: { kind: 'skill', id: 'test.hit', unitId: 'r' },
      targetId: 'b', amount: 100, hpLost: 100, damageKind: 'normal', mitigated: 0, isCritical: false };
    const commands = definition.handlers.hit.handle(createBattleContext(current, () => .5), damage);
    if (!commands) return;
    const applied = applyEffectCommands(current, commands, 'hit', damage.eventId, id => registry.getStatus(id));
    current = applied.state;
    for (const healing of applied.events.filter(event => event.type === 'healing')) {
      const overflow = definition.handlers['effect-resolution'].handle(createBattleContext(current, () => .5), healing);
      if (overflow) current = applyEffectCommands(current, overflow, 'effect-resolution', healing.eventId, id => registry.getStatus(id)).state;
    }
  };
  trigger(1); trigger(2); trigger(3); trigger(4);
  assert.equal(current.units.b2.actionGauge, 24, '前三次满血治疗各溢出并推进8%行动条，第四次不再触发');
  assert.equal(current.units.b.hp, 6500, '五级每次治疗友方额外治疗自身5%生命上限');
  assert.equal(current.units.b2.statuses.find(status => status.statusId === yiguangongIds.sugar).values.healTriggers, 3);

  const reset = definition.handlers['turn-start'].handle(createBattleContext(current, () => .5), {
    type: 'turn-started', eventId: 'sugar-next-turn', phase: 'turn-start', source: { kind: 'unit', id: 'b2', unitId: 'b2' }, unitId: 'b2',
  });
  current = applyEffectCommands(current, reset, 'turn-start', 'sugar-next-turn', id => registry.getStatus(id)).state;
  assert.equal(current.units.b2.statuses.find(status => status.statusId === yiguangongIds.sugar).values.healTriggers, 0);
  trigger(5);
  assert.equal(current.units.b2.actionGauge, 32, '糖渍目标下回合开始重置三次治疗额度');
});

test('风狸普攻与雷火弹按欺软怕硬分支调整无视防御和暴击率', () => {
  const registry = new ContentRegistry(); registerFengli(registry);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: fengliIds.hero, skillLevel: 5,
    skillLevels: { [fengliIds.basic]: 1, [fengliIds.passive]: 5, [fengliIds.ultimate]: 5 },
    stats: { ...initial.units.b.stats, attack: 5000, crit: .9 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, attack: 4000, defense: 800 } };
  const weakTarget = executeAction(initial, { actorId: 'b', skillId: fengliIds.basic, targetIds: ['r'], shape: 'single', targetRelation: 'enemy' },
    registry, () => .5);
  assert.equal(weakTarget.events.find(event => event.type === 'damage')?.isCritical, true,
    '攻击力较低的目标不触发80%暴击降低，且基础暴击仍为90%');
  assert.ok(weakTarget.state.units.b.statuses.some(status => status.statusId === fengliIds.haste));

  const strong = { ...initial, units: { ...initial.units, r: { ...initial.units.r,
    stats: { ...initial.units.r.stats, attack: 5000 } } } };
  const strongHit = executeAction(strong, { actorId: 'b', skillId: fengliIds.basic, targetIds: ['r'], shape: 'single', targetRelation: 'enemy' },
    registry, () => .5);
  assert.equal(strongHit.events.find(event => event.type === 'damage')?.isCritical, false,
    '攻击力相等时也降低80%暴击');

  const ultimate = registry.getHero(fengliIds.hero).skills.find(skill => skill.id === fengliIds.ultimate);
  const context = createBattleContext(initial, () => .5);
  const highTarget = { ...initial.units.r, stats: { ...initial.units.r.stats, attack: 5000 } };
  const direct = ultimate.execute({ ...context, getUnit: id => id === 'r' ? highTarget : context.getUnit(id),
    getEffectiveStats: id => id === 'r' ? highTarget.stats : context.getEffectiveStats(id) },
  { actorId: 'b', skillId: fengliIds.ultimate, targetIds: ['r'], shape: 'single', targetRelation: 'enemy' },
  { ratio: 1.25, indirectRatio: 3.5 });
  assert.equal(direct[0].type, 'deal-damage');
  assert.equal(direct[0].isCritical, false);
});

test('风狸被普攻时按攻击ID只判定一次闪避，成功后取得等级对应暴击抵抗', () => {
  const registry = new ContentRegistry(); registerFengli(registry);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: fengliIds.hero, skillLevel: 5,
    skillLevels: { [fengliIds.passive]: 5 } };
  const definition = registry.getHero(fengliIds.hero);
  const context = { actionKind: 'basic', attackId: 9, battle: { random: () => .1 }, isUnitUnableToAct: () => false };
  const first = definition.interceptIncomingDamage(initial, initial.units.r, initial.units.b, 1000, 'normal', context);
  const applied = applyEffectCommands(initial, first.effects, 'hit', 'fengli-dodge', id => registry.getStatus(id));
  assert.equal(first.amount, 0);
  assert.equal(applied.state.units.b.statuses.find(status => status.statusId === fengliIds.critResist).modifiers[0].amount, 1);
  const second = definition.interceptIncomingDamage(applied.state, applied.state.units.r, applied.state.units.b, 1000, 'normal', context);
  assert.equal(second.amount, 0, '同一次多段普攻不重新掷骰');
  assert.equal(second.effects.some(command => command.instance?.statusId === fengliIds.critResist), false);
});

test('风狸回合末引爆火球印记、移除印记并累计至多300点无视防御', () => {
  const registry = new ContentRegistry(); registerFengli(registry);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: fengliIds.hero, skillLevel: 5 };
  initial.units.r = { ...initial.units.r, hp: 1000000, stats: { ...initial.units.r.stats, hp: 1000000 } };
  initial.units.r.statuses = [{ instanceId: 'fireball-b-r', statusId: fengliIds.fireball,
    source: { kind: 'skill', id: fengliIds.ultimate, unitId: 'b' }, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { ownerUnitId: 'b', ratio: 3.5 } }];
  const definition = registry.getHero(fengliIds.hero);
  let current = initial;
  for (let index = 0; index < 7; index++) {
    const event = { type: 'turn-ended', eventId: `fengli-end-${index}`, phase: 'turn-end',
      source: { kind: 'unit', id: 'r', unitId: 'r' }, unitId: 'r', actionId: index + 1 };
    const commands = definition.handlers['turn-end'].handle(createBattleContext(current, () => .5), event);
    const applied = applyEffectCommands(current, commands, 'turn-end', event.eventId, id => registry.getStatus(id));
    current = applied.state;
    if (index === 0) assert.ok(applied.events.some(event => event.type === 'life-lost' && event.lifeLossKind === 'indirect'));
    assert.equal(current.units.r.statuses.some(status => status.statusId === fengliIds.fireball), false);
    assert.equal(current.units.b.statuses.find(status => status.statusId === fengliIds.defenseGrowth)?.values.bonus,
      Math.min(300, (index + 1) * 50));
    current = { ...current, units: { ...current.units, r: { ...current.units.r,
      statuses: [{ ...initial.units.r.statuses[0], instanceId: `fireball-${index}` }] } } };
  }
});

test('风狸雷火弹消耗3火、先直击，再引爆所有旧印记并给所选目标挂新印记', () => {
  const registry = new ContentRegistry(); registerFengli(registry);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: fengliIds.hero, skillLevel: 5 };
  initial.units.r = { ...initial.units.r, hp: 1000000, stats: { ...initial.units.r.stats, hp: 1000000 } };
  initial.units.r2 = { ...unit('r2', 'red'), hp: 1000000, stats: { ...unit('r2', 'red').stats, hp: 1000000 }, statuses: [{
    instanceId: 'old-fireball', statusId: fengliIds.fireball,
    source: { kind: 'skill', id: fengliIds.ultimate, unitId: 'b' }, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { ownerUnitId: 'b', ratio: 3.5 },
  }] };
  initial.sides.red.push('r2');
  initial.resources.blue.fire = 3;
  const result = executeAction(initial, { actorId: 'b', skillId: fengliIds.ultimate, targetIds: ['r'], shape: 'single', targetRelation: 'enemy' },
    registry, () => .5);
  assert.equal(result.accepted, true);
  assert.equal(result.state.resources.blue.fire, 0);
  assert.ok(result.events.some(event => event.type === 'life-lost' && event.targetId === 'r2' && event.lifeLossKind === 'indirect'));
  assert.equal(result.state.units.r2.statuses.some(status => status.statusId === fengliIds.fireball), false);
  assert.ok(result.state.units.r.statuses.some(status => status.statusId === fengliIds.fireball));
  assert.equal(result.state.units.b.statuses.find(status => status.statusId === fengliIds.defenseGrowth)?.values.bonus, 50);
});

test('唐纸伞妖读取客户端技能倍率，以2火攻击全体敌人并按敌人数选择群攻', () => {
  const registry = new ContentRegistry(); registerRRankStrikers(registry);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: umbrellaGhostIds.hero, skillLevel: 5,
    skillLevels: { [umbrellaGhostIds.skill]: 5 } };
  initial.units.r2 = { ...unit('r2', 'red'), hp: 100000, stats: { ...unit('r2', 'red').stats, hp: 100000 } };
  initial.sides.red.push('r2'); initial.resources.blue.fire = 2;
  const selected = registry.getHero(umbrellaGhostIds.hero).policy(createBattleContext(initial), 'b');
  assert.equal(selected.skillId, umbrellaGhostIds.skill);
  const result = executeAction(initial, selected, registry, () => .5);
  assert.equal(result.state.resources.blue.fire, 0);
  assert.equal(result.events.filter(event => event.type === 'damage' && event.source.id === umbrellaGhostIds.skill).length, 2);
  assert.equal(gameSkillRow(umbrellaGhostIds.skill, 5, -1).addDmg, 1.29);
});

test('天邪鬼绿读取客户端三段倍率与鬼火费用，按技能等级造成三次命中', () => {
  const registry = new ContentRegistry(); registerRRankStrikers(registry);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: greenOniIds.hero, skillLevel: 5,
    skillLevels: { [greenOniIds.skill]: 5 } };
  initial.units.r = { ...initial.units.r, hp: 100000, stats: { ...initial.units.r.stats, hp: 100000, resist: 0 } };
  initial.resources.blue.fire = 2;
  const selected = registry.getHero(greenOniIds.hero).policy(createBattleContext(initial), 'b');
  assert.equal(selected.skillId, greenOniIds.skill);
  const result = executeAction(initial, selected, registry, () => .5);
  assert.equal(result.state.resources.blue.fire, 0);
  assert.equal(result.events.filter(event => event.type === 'damage' && event.source.id === greenOniIds.skill).length, 3);
  assert.equal(gameSkillRow(greenOniIds.skill, 5, -1).addDmg, .88);
  assert.equal(gameSkillRow(greenOniIds.skill, 5, -1).consumeVal, 2);
});

test('盗墓小鬼与寄生魂普攻读取客户端等级倍率，帚神两火群攻按敌人数选择', () => {
  const registry = new ContentRegistry(); registerRRankStrikers(registry);
  assert.equal(registry.getHero(tombRaiderOniIds.hero).mechanicsCoverage, 'verified');
  assert.equal(registry.getHero(parasiticSoulIds.hero).mechanicsCoverage, 'verified');
  assert.equal(gameSkillRow(tombRaiderOniIds.basic, 5, -1).addDmg, 1.25);
  assert.equal(gameSkillRow(parasiticSoulIds.basic, 5, -1).addDmg, 1.25);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: broomSpriteIds.hero, skillLevel: 5,
    skillLevels: { [broomSpriteIds.skill]: 5 } };
  initial.units.r2 = { ...unit('r2', 'red') }; initial.sides.red.push('r2'); initial.resources.blue.fire = 2;
  assert.equal(registry.getHero(broomSpriteIds.hero).policy(createBattleContext(initial), 'b').skillId, broomSpriteIds.skill);
  assert.equal(gameSkillRow(broomSpriteIds.skill, 5, -1).addDmg, 1.31);
});

test('呱太大天狗四段群攻、呱太荒川两段单攻与呱太小鹿重复目标递减均按客户端行结算', () => {
  const registry = new ContentRegistry(); registerRRankStrikers(registry);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: ootenguGuaIds.hero, skillLevel: 5,
    skillLevels: { [ootenguGuaIds.skill]: 5 } };
  initial.units.r2 = { ...unit('r2', 'red') }; initial.sides.red.push('r2'); initial.resources.blue.fire = 3;
  const aoe = executeAction(initial, { actorId: 'b', skillId: ootenguGuaIds.skill, targetIds: ['r', 'r2'], shape: 'all-enemies', targetRelation: 'enemy' },
    registry, () => .5);
  assert.equal(aoe.state.resources.blue.fire, 0);
  assert.equal(aoe.events.filter(event => event.type === 'damage' && event.source.id === ootenguGuaIds.skill).length, 8);
  assert.equal(gameSkillRow(ootenguGuaIds.skill, 5, -1).addDmg, .12);

  const arakawa = { ...initial, units: { ...initial.units, b: { ...initial.units.b, heroId: arakawaGuaIds.hero,
    skillLevels: { [arakawaGuaIds.skill]: 5 } } } };
  const double = executeAction(arakawa, { actorId: 'b', skillId: arakawaGuaIds.skill, targetIds: ['r'], shape: 'single', targetRelation: 'enemy' },
    registry, () => .5);
  assert.equal(double.events.filter(event => event.type === 'damage' && event.source.id === arakawaGuaIds.skill).length, 2);
  assert.equal(gameSkillRow(arakawaGuaIds.skill, 5, -1).addDmg, .8);

  const deer = { ...initial, resources: { ...initial.resources, blue: { fire: 3 } },
    units: { ...initial.units, b: { ...initial.units.b, heroId: youngDeerGuaIds.hero,
      skillLevels: { [youngDeerGuaIds.skill]: 5 } }, r3: { ...unit('r3', 'red') } }, sides: { ...initial.sides, red: ['r', 'r2', 'r3'] } };
  const charge = executeAction(deer, { actorId: 'b', skillId: youngDeerGuaIds.skill, targetIds: ['r'], shape: 'single', targetRelation: 'enemy' },
    registry, () => .5);
  const hits = charge.events.filter(event => event.type === 'damage' && event.source.id === youngDeerGuaIds.skill);
  assert.equal(hits.length, 3);
  assert.ok(Math.abs(hits[2].amount - hits[1].amount * .6) < 1e-8, '同一随机目标再次命中时伤害降低40%');
  assert.equal(charge.state.resources.blue.fire, 0);
  assert.equal(gameSkillRow(youngDeerGuaIds.skill, 5, -1).addDmg, .95);
});

test('天邪鬼赤嘲讽带来的控制和易伤、天邪鬼黄/青增益、涂壁防御强化均按客户端数值结算', () => {
  const registry = new ContentRegistry(); registerRRankSupports(registry);
  const initial = state(); initial.resources.blue.fire = 2;
  initial.units.b = { ...initial.units.b, stats: { ...initial.units.b.stats, defense: 1000 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, attack: 1000, resist: 0 } };

  const taunt = executeAction({ ...initial, units: { ...initial.units, b: { ...initial.units.b, heroId: redOniIds.hero } } },
    { actorId: 'b', skillId: redOniIds.tauntSkill, targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, registry, () => .1);
  const control = taunt.state.units.r.statuses.find(status => status.statusId === redOniIds.taunt);
  assert.equal(control.values.controlType, '嘲讽');
  assert.equal(control.modifiers.find(modifier => modifier.stat === 'damage').amount, .2);
  assert.equal(control.modifiers.find(modifier => modifier.stat === 'damageTaken').amount, .4);
  assert.equal(battleSkillRow(redOniIds.tauntSkill, 1, -1).consumeVal, 2);

  const yellow = executeAction({ ...initial, units: { ...initial.units, b: { ...initial.units.b, heroId: yellowOniIds.hero } } },
    { actorId: 'b', skillId: yellowOniIds.buffSkill, targetIds: ['b'], shape: 'all-allies', targetRelation: 'ally' }, registry, () => .5);
  assert.equal(effectiveStats(yellow.state.units.b).crit, .15);
  assert.equal(yellow.state.units.b.statuses.find(status => status.statusId === yellowOniIds.critBuff).duration.remaining, 1);

  const blue = executeAction({ ...initial, units: { ...initial.units, b: { ...initial.units.b, heroId: blueOniIds.hero } } },
    { actorId: 'b', skillId: blueOniIds.basic, targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, registry, () => .5);
  assert.equal(blue.events.filter(event => event.type === 'damage' && event.source.id === blueOniIds.basic).length, 3);
  const speed = executeAction({ ...initial, units: { ...initial.units, b: { ...initial.units.b, heroId: blueOniIds.hero } } },
    { actorId: 'b', skillId: blueOniIds.buffSkill, targetIds: ['b'], shape: 'all-allies', targetRelation: 'ally' }, registry, () => .5);
  assert.equal(effectiveStats(speed.state.units.b).speed, initial.units.b.stats.speed + 40);
  assert.equal(battleSkillRow(blueOniIds.buffSkill, 1, -1).buffDuration, 1);

  const wallInitial = { ...initial, units: { ...initial.units, b: { ...initial.units.b, heroId: wallIds.hero },
    b2: { ...unit('b2', 'blue'), stats: { ...unit('b2', 'blue').stats, defense: 200 } } }, sides: { ...initial.sides, blue: ['b', 'b2'] } };
  const wall = executeAction(wallInitial, { actorId: 'b', skillId: wallIds.buffSkill, targetIds: ['b', 'b2'], shape: 'all-allies', targetRelation: 'ally' },
    registry, () => .5);
  assert.equal(effectiveStats(wall.state.units.b2).defense, 480, '基础防御200 × 1.4，再加涂壁初始防御200');
  assert.equal(wall.state.units.b2.statuses.find(status => status.statusId === wallIds.defenseBuff).duration.remaining, 2);
  assert.equal(battleSkillRow(wallIds.buffSkill, 1, -1).buffId, 4093);
});

test('蝎女蝎刺两段、蝎毒唯一目标与叠层、引爆间接伤害/治疗和五层回合末溅射均生效', () => {
  const registry = new ContentRegistry(); registerScorpionGirl(registry);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: scorpionGirlIds.hero, skillLevel: 5,
    skillLevels: { [scorpionGirlIds.basic]: 5, [scorpionGirlIds.passive]: 5, [scorpionGirlIds.skill]: 5 }, hp: 5000 };
  initial.units.r = { ...initial.units.r, hp: 1000000, stats: { ...initial.units.r.stats, hp: 1000000, defense: 1000 } };
  initial.units.r2 = { ...unit('r2', 'red'), hp: 1000000, stats: { ...unit('r2', 'red').stats, hp: 1000000 } };
  initial.sides.red.push('r2'); initial.resources.blue.fire = 2;

  const basic = executeAction(initial, { actorId: 'b', skillId: scorpionGirlIds.basic, targetIds: ['r'], shape: 'single', targetRelation: 'enemy' },
    registry, () => .5, { resolveStatus: id => registry.getStatus(id) });
  assert.equal(basic.events.filter(event => event.type === 'damage' && event.source.id === scorpionGirlIds.basic).length, 2);
  assert.equal(gameSkillRow(scorpionGirlIds.basic, 5, -1).addDmg, .6);

  const first = executeAction(initial, { actorId: 'b', skillId: scorpionGirlIds.skill, targetIds: ['r'], shape: 'single', targetRelation: 'enemy' },
    registry, () => .5, { resolveStatus: id => registry.getStatus(id) });
  assert.equal(first.state.resources.blue.fire, 0);
  assert.equal(first.state.units.r.statuses.find(status => status.statusId === scorpionGirlIds.poison).stacks, 1);
  assert.equal(first.state.units.r2.statuses.some(status => status.statusId === scorpionGirlIds.poison), false,
    '同一蝎女只维持一个中毒目标');

  const secondInitial = { ...first.state, units: { ...first.state.units, b: { ...first.state.units.b, hp: 5000 } },
    resources: { ...first.state.resources, blue: { fire: 2 } } };
  const second = executeAction(secondInitial, { actorId: 'b', skillId: scorpionGirlIds.skill,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, registry, () => .5,
  { resolveStatus: id => registry.getStatus(id) });
  assert.equal(second.state.units.r.statuses.find(status => status.statusId === scorpionGirlIds.poison).stacks, 2);
  assert.ok(second.events.some(event => event.type === 'life-lost' && event.targetId === 'r' && event.lifeLossKind === 'indirect'));
  assert.ok(second.events.some(event => event.type === 'healing' && event.targetId === 'b'));
  assert.equal(battleSkillRow(scorpionGirlIds.skill, 5, -1).param1, .9);

  const tickState = { ...second.state, units: { ...second.state.units, r: { ...second.state.units.r,
    statuses: [{ instanceId: 'five-poison', statusId: scorpionGirlIds.poison,
      source: { kind: 'skill', id: scorpionGirlIds.skill, unitId: 'b' }, stacks: 5, duration: { kind: 'permanent' },
      values: { ownerUnitId: 'b' }, modifiers: [{ stat: 'defense', operation: 'flat', amount: -80, perStack: true }] }] } } };
  const event = { type: 'turn-ended', eventId: 'scorpion-target-end', phase: 'turn-end', source: { kind: 'unit', id: 'r', unitId: 'r' },
    unitId: 'r', actionId: 2 };
  const definition = registry.getHero(scorpionGirlIds.hero);
  const tickCommands = definition.handlers['turn-end'].handle(createBattleContext(tickState, () => .5), event);
  assert.ok(tickCommands.some(command => command.type === 'lose-life' && command.lifeLossKind === 'indirect' && command.amount > 0));
  const tickApplied = applyEffectCommands(tickState, tickCommands, 'turn-end', event.eventId, id => registry.getStatus(id));
  const lifeLost = tickApplied.events.find(event => event.type === 'life-lost' && event.targetId === 'r');
  const splash = definition.handlers['effect-resolution'].handle(createBattleContext(tickApplied.state, () => .5), lifeLost);
  assert.ok(splash.some(command => command.type === 'lose-life' && command.targetId === 'r2' && command.amount > 0));
});

test('铃鹿御前麓魂·极施加麓障并按等级推条，万羽浪行全体五段吸血', () => {
  const registry = new ContentRegistry(); registerSuzukaGozen(registry);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: suzukaGozenIds.hero, skillLevel: 5,
    skillLevels: { [suzukaGozenIds.basic]: 5, [suzukaGozenIds.guard]: 5, [suzukaGozenIds.ultimate]: 5 }, hp: 5000 };
  initial.units.b2 = unit('b2', 'blue'); initial.units.b2 = { ...initial.units.b2, actionGauge: 10 };
  initial.units.r = { ...initial.units.r, hp: 1000000, stats: { ...initial.units.r.stats, hp: 1000000, defense: 1000 } };
  initial.units.r2 = unit('r2', 'red'); initial.units.r2 = { ...initial.units.r2, hp: 1000000, stats: { ...initial.units.r2.stats, hp: 1000000 } };
  initial.sides.blue.push('b2'); initial.sides.red.push('r2'); initial.resources.blue.fire = 4;

  const guard = executeAction(initial, { actorId: 'b', skillId: suzukaGozenIds.guard, targetIds: ['r'], shape: 'single', targetRelation: 'enemy' },
    registry, () => .5, { resolveStatus: id => registry.getStatus(id) });
  assert.equal(guard.state.resources.blue.fire, 2);
  assert.ok(guard.state.units.b.statuses.some(status => status.statusId === suzukaGozenIds.duty));
  assert.ok(guard.state.units.b2.statuses.some(status => status.statusId === suzukaGozenIds.barrier));
  assert.equal(guard.state.units.b2.actionGauge, 20, '二级技能为全体友方增加10%行动条');
  assert.ok(guard.state.units.b.statuses.find(status => status.statusId === suzukaGozenIds.duty).modifiers
    .some(modifier => modifier.stat === 'resist' && modifier.amount === .5));

  const ultimate = executeAction({ ...initial, resources: { ...initial.resources, blue: { ...initial.resources.blue, fire: 4 } } },
    { actorId: 'b', skillId: suzukaGozenIds.ultimate, targetIds: ['r', 'r2'], shape: 'all-enemies', targetRelation: 'enemy' },
    registry, () => .5, { resolveStatus: id => registry.getStatus(id) });
  assert.equal(ultimate.events.filter(event => event.type === 'damage' && event.source.id === suzukaGozenIds.ultimate).length, 10);
  assert.ok(ultimate.events.some(event => event.type === 'healing' && event.targetId === 'b'), '每段造成伤害后按10%吸血');
  assert.equal(gameSkillRow(suzukaGozenIds.ultimate, 5, -1).addDmg, .53);
});

test('待宵姑获鸟开局按已普攻两次计数，第三次普攻后触发墨影剑光并追加三段选中目标攻击', () => {
  const registry = new ContentRegistry(); registerDaybreakUbume(registry);
  const definition = registry.getHero(daybreakUbumeIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: daybreakUbumeIds.hero, skillLevel: 5,
    skillLevels: { [daybreakUbumeIds.basic]: 5, [daybreakUbumeIds.passive]: 1, [daybreakUbumeIds.special]: 5 } };
  initial.units.r = { ...initial.units.r, hp: 1000000, stats: { ...initial.units.r.stats, hp: 1000000 } };
  initial.units.r2 = { ...unit('r2', 'red'), hp: 1000000, stats: { ...unit('r2', 'red').stats, hp: 1000000 } };
  initial.sides.red.push('r2');
  initial = applyEffectCommands(initial, definition.initialize(createBattleContext(initial), 'b'), 'battle-start', 'daybreak-init',
    id => registry.getStatus(id)).state;
  const action = () => executeAction(initial, { actorId: 'b', skillId: daybreakUbumeIds.basic, targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .5, { resolveStatus: id => registry.getStatus(id) });
  const first = action(); initial = first.state;
  assert.equal(first.events.filter(event => event.type === 'damage').length, 1, '开局已计2次，当前第三次普攻仍为普通攻击');
  assert.equal(initial.units.b.statuses.find(status => status.statusId === daybreakUbumeIds.basicCounter).values.count, 3);
  const second = action(); initial = second.state;
  assert.equal(initial.units.b.statuses.find(status => status.statusId === daybreakUbumeIds.basicCounter).values.count, 0,
    '第三次普通攻击后，下一次普攻替换为墨影剑光');
  assert.equal(second.events.filter(event => event.type === 'damage').length, 4, '全体墨影1段并对选中目标追加3段');
  assert.equal(second.events.filter(event => event.type === 'damage' && event.targetId === 'r').length, 3);
  assert.equal(second.events.filter(event => event.type === 'damage' && event.targetId === 'r2').length, 1);
  assert.equal(initial.units.b.statuses.find(status => status.statusId === daybreakUbumeIds.basicCounter).values.count, 0);
  assert.equal(gameSkillRow(daybreakUbumeIds.basic, 5, -1).addDmg, 1.25);
  const turnStart = definition.handlers['turn-start'].handle(createBattleContext(initial), {
    type: 'turn-started', eventId: 'daybreak-start', phase: 'turn-start', unitId: 'b' });
  assert.equal(turnStart[0].instance.stacks, 2);
});

test('呱太式神批次按客户端技能表结算鬼火、段数、增益、护盾和治疗', () => {
  const registry = new ContentRegistry(); registerKappaRoster(registry);
  const resolveStatus = id => registry.getStatus(id);
  const kappaHeroes = [415, 417, 418, 420, 421, 422, 423, 424, 425, 426, 427, 428, 429, 430];
  for (const heroId of kappaHeroes) {
    const hero = registry.getHero(heroId);
    for (const skill of hero.skills) for (let level = 1; level <= 5; level += 1) {
      const expected = gameSkillRow(skill.id, level, -1).addDmg;
      const actual = skill.levels[level - 1].ratio;
      if (expected > 0) assert.equal(actual, expected, `${heroId}/${skill.id} Lv.${level}倍率应与客户端技能表一致`);
    }
  }
  const prepare = (heroId, skillId, fire = 3) => {
    const initial = state();
    const hero = registry.getHero(heroId);
    initial.units.b = { ...initial.units.b, heroId, skillLevel: 5,
      skillLevels: Object.fromEntries(hero.skills.map(skill => [skill.id, 5])), hp: 5000 };
    initial.units.r = { ...initial.units.r, hp: 1000000, stats: { ...initial.units.r.stats, hp: 1000000, resist: 0 } };
    initial.units.r2 = { ...unit('r2', 'red'), hp: 1000000, stats: { ...unit('r2', 'red').stats, hp: 1000000, resist: 0 } };
    initial.units.b2 = { ...unit('b2', 'blue'), hp: 5000 };
    initial.sides.blue.push('b2'); initial.sides.red.push('r2'); initial.resources.blue.fire = fire;
    return { initial, skillId };
  };
  const run = (initial, skillId, targets, shape = 'single', randomValue = .5) => executeAction(initial,
    { actorId: 'b', skillId, targetIds: targets, shape, targetRelation: skillId.endsWith('2') && [423, 424, 425, 427].includes(initial.units.b.heroId) ? 'ally' : 'enemy' },
    registry, () => randomValue, { resolveStatus });

  let { initial } = prepare(kappaRosterIds.shuten, '4151', 3);
  const rageGain = run(initial, '4151', ['r'], 'single', .1);
  assert.equal(rageGain.state.units.b.statuses.find(status => status.statusId === kappaRosterIds.shutenRage).stacks, 1,
    '20%基础概率获得且最多1层呱气');
  initial = { ...rageGain.state, resources: { ...rageGain.state.resources, blue: { ...rageGain.state.resources.blue, fire: 3 } } };
  const rageSpend = run(initial, '4152', ['r']);
  assert.equal(rageSpend.events.filter(event => event.type === 'damage' && event.source.id === '4152').length, 2);
  assert.equal(rageSpend.state.units.b.statuses.some(status => status.statusId === kappaRosterIds.shutenRage), false);

  ({ initial } = prepare(kappaRosterIds.twoFace, '4182'));
  const threeStrikes = run(initial, '4182', ['r', 'r2'], 'all-enemies');
  assert.equal(threeStrikes.events.filter(event => event.type === 'damage' && event.source.id === '4182').length, 6,
    '两面佛呱对两名敌人各攻击3次');
  ({ initial } = prepare(kappaRosterIds.yoto, '4222'));
  const sixStrikes = run(initial, '4222', ['r']);
  assert.equal(sixStrikes.events.filter(event => event.type === 'damage' && event.source.id === '4222').length, 6,
    '妖刀姬呱对选中目标攻击6次');
  ({ initial } = prepare(kappaRosterIds.susabi, '4262'));
  const falling = run(initial, '4262', ['r']);
  assert.deepEqual(falling.events.filter(event => event.type === 'damage').map(event => Math.round(event.amount * 10) / 10), [3000, 2250, 1687.5]);

  ({ initial } = prepare(kappaRosterIds.ichimokuren, '4232'));
  const shield = run(initial, '4232', ['b', 'b2'], 'all-allies');
  assert.equal(shield.state.units.b2.statuses.find(status => status.statusId === kappaRosterIds.ichimokurenShield).values.shieldRemaining, 300);
  ({ initial } = prepare(kappaRosterIds.huaniao, '4242'));
  initial.units.b2 = { ...initial.units.b2, hp: 1000 };
  const heal = run(initial, '4242', ['b', 'b2'], 'all-allies');
  assert.equal(heal.state.units.b2.hp, 1400, '满级全体治疗按生命上限4%计算');
  ({ initial } = prepare(kappaRosterIds.kaguyahime, '4252', 2));
  const ward = run(initial, '4252', ['b', 'b2'], 'all-allies');
  assert.equal(effectiveStats(ward.state.units.b2).defense, initial.units.b2.stats.defense * 1.05);
  assert.equal(effectiveStats(ward.state.units.b2).resist, initial.units.b2.stats.resist + .05);
  const kaguyahime = registry.getHero(kappaRosterIds.kaguyahime);
  const noFire = { ...initial, resources: { ...initial.resources, blue: { ...initial.resources.blue, fire: 0 } } };
  assert.equal(kaguyahime.policy(createBattleContext(noFire), 'b').skillId, '4251', '鬼火不足时回退普攻');
  assert.equal(kaguyahime.policy(createBattleContext(initial), 'b').skillId, '4252', '鬼火足够时施放增益');
  ({ initial } = prepare(kappaRosterIds.higanbana, '4272'));
  const lostShield = run(initial, '4272', ['b'], 'self');
  assert.ok(lostShield.state.units.b.statuses.some(status => status.statusId === kappaRosterIds.higanbanaShield),
    `彼岸花呱护盾状态未保留：${lostShield.failure ?? 'action succeeded'}; ${JSON.stringify(lostShield.state.units.b.statuses)}`);
  assert.equal(lostShield.state.units.b.statuses.find(status => status.statusId === kappaRosterIds.higanbanaShield).values.shieldRemaining, 500);

  ({ initial } = prepare(kappaRosterIds.yukidouji, '4282'));
  const freeze = executeAction(initial, { actorId: 'b', skillId: '4282', targetIds: ['r'], shape: 'single', targetRelation: 'enemy' },
    registry, () => .01, { resolveStatus });
  assert.equal(freeze.events.filter(event => event.type === 'damage' && event.source.id === '4282').length, 3);
  assert.equal(freeze.events.filter(event => event.type === 'control-applied' && event.statusId === kappaRosterIds.yukidoujiFreeze).length, 3);
});

test('歌留多按花忆层数结算间接伤害、减疗、被动叠层与五光斩守势', () => {
  const registry = new ContentRegistry(); registerKaruta(registry);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: karutaIds.hero, skillLevel: 5,
    skillLevels: { [karutaIds.basic]: 5, [karutaIds.passive]: 5, [karutaIds.ultimate]: 5 } };
  initial.units.r = { ...initial.units.r, hp: 1000000, stats: { ...initial.units.r.stats, hp: 1000000, defense: 1000 } };
  initial.units.r2 = { ...unit('r2', 'red'), hp: 1000000, stats: { ...unit('r2', 'red').stats, hp: 1000000 } };
  initial.sides.red.push('r2'); initial.resources.blue.fire = 3;
  const resolveStatus = id => registry.getStatus(id);
  const basic = executeAction(initial, { actorId: 'b', skillId: karutaIds.basic, targetIds: ['r'], shape: 'single', targetRelation: 'enemy' },
    registry, () => .5, { resolveStatus });
  const firstMemory = basic.state.units.r.statuses.find(status => status.statusId === karutaIds.memory);
  assert.equal(firstMemory.stacks, 1, '五级青短附加1层花忆');
  assert.equal(firstMemory.modifiers[0].amount, -.1);

  const ultimate = executeAction(basic.state, { actorId: 'b', skillId: karutaIds.ultimate, targetIds: ['r'], shape: 'single', targetRelation: 'enemy' },
    registry, () => .5, { resolveStatus });
  assert.equal(ultimate.state.resources.blue.fire, 0);
  assert.equal(ultimate.state.units.r.statuses.find(status => status.statusId === karutaIds.memory).stacks, 3);
  assert.ok(ultimate.events.some(event => event.type === 'life-lost' && event.targetId === 'r' && event.lifeLossKind === 'indirect'));
  assert.ok(ultimate.events.some(event => event.type === 'life-lost' && event.targetId === 'r2' && event.lifeLossKind === 'indirect'));
  assert.ok(ultimate.state.units.r.statuses.some(status => status.statusId === karutaIds.mark));
  const guard = ultimate.state.units.b.statuses.find(status => status.statusId === karutaIds.guard);
  assert.equal(guard.modifiers[0].amount, -.3);
  assert.equal(gameSkillRow(karutaIds.ultimate, 5, -1).addDmg, 3.5);

  const definition = registry.getHero(karutaIds.hero);
  const incoming = { type: 'damage', eventId: 'karuta-retaliation', phase: 'hit', source: { kind: 'skill', id: 'enemy-hit', unitId: 'r2' },
    targetId: 'b', amount: 100, hpBefore: 10000, hpAfter: 9900, hpLost: 100, shieldConsumed: 0, extHpConsumed: 0,
    reboundDamage: 0, leechDamage: 0, mitigated: 0, isCritical: false };
  const retaliation = definition.handlers.hit.handle(createBattleContext(ultimate.state, () => .5), incoming);
  assert.ok(retaliation.some(command => command.type === 'add-status' && command.targetId === 'r2' && command.instance.stacks === 2));
});

test('梦引蝴蝶精灵梦抵消睡眠并生成梦茧，梦引之声按选中友方强化治疗', () => {
  const registry = new ContentRegistry(); registerDreamButterfly(registry);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: dreamButterflyIds.hero, skillLevel: 5,
    skillLevels: { [dreamButterflyIds.basic]: 5, [dreamButterflyIds.cocoonSkill]: 5, [dreamButterflyIds.song]: 5 }, hp: 5000 };
  initial.units.b2 = { ...unit('b2', 'blue'), hp: 1000 }; initial.sides.blue.push('b2'); initial.resources.blue.fire = 2;
  const resolveStatus = id => registry.getStatus(id);
  const cocoon = executeAction(initial, { actorId: 'b', skillId: dreamButterflyIds.cocoonSkill, targetIds: ['b'], shape: 'self', targetRelation: 'ally' },
    registry, () => .5, { resolveStatus });
  const cocoonStatus = cocoon.state.units.b.statuses.find(status => status.statusId === dreamButterflyIds.cocoon);
  assert.equal(cocoonStatus.values.shieldRemaining, 2000);
  assert.ok(cocoonStatus.modifiers.some(modifier => modifier.stat === 'damage' && modifier.amount === .2));

  const sleep = registry.getHero(dreamButterflyIds.hero).handlers['control-application'].handle(createBattleContext(initial), {
    type: 'control-applied', eventId: 'dream-sleep', phase: 'control-application', targetId: 'b', statusId: 'test.sleep',
    newlyControlled: true, controlType: '睡眠',
  });
  assert.ok(sleep.some(command => command.type === 'remove-statuses' && command.statusIds.includes('test.sleep')));
  assert.ok(sleep.some(command => command.type === 'add-status' && command.instance.statusId === dreamButterflyIds.cocoon));

  const song = executeAction(initial, { actorId: 'b', skillId: dreamButterflyIds.song, targetIds: ['b', 'b2'], selectedTargetId: 'b2',
    shape: 'all-allies', targetRelation: 'ally' }, registry, () => .5, { resolveStatus });
  assert.equal(song.state.units.b.hp, 6500, '友方获得生命上限15%的群体治疗');
  assert.equal(song.state.units.b2.hp, 4000, '选中目标获得30%治疗');
  assert.ok(song.state.units.b2.statuses.some(status => status.statusId === dreamButterflyIds.cocoon
    && status.values.shieldRemaining === 1500));
  assert.ok(song.state.units.b.statuses.some(status => status.statusId === dreamButterflyIds.melody));
});

test('灼华桃花妖携芳意治疗并授新蕊，醒时花复活并以新蕊抵挡致命伤害', () => {
  const registry = new ContentRegistry(); registerBlazingPeach(registry);
  const resolveStatus = id => registry.getStatus(id);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: blazingPeachIds.hero, skillLevel: 5,
    skillLevels: { [blazingPeachIds.basic]: 5, [blazingPeachIds.budSkill]: 5, [blazingPeachIds.reviveSkill]: 5 },
    stats: { ...initial.units.b.stats, hp: 10000, crit: 1 }, hp: 5000 };
  initial.units.b2 = { ...unit('b2', 'blue'), stats: { ...unit('b2', 'blue').stats, hp: 10000 }, hp: 5000 };
  initial.sides.blue.push('b2'); initial.resources.blue.fire = 3;
  const bud = executeAction(initial, { actorId: 'b', skillId: blazingPeachIds.budSkill, targetIds: ['b2'], shape: 'single', targetRelation: 'ally' },
    registry, () => .5, { resolveStatus });
  assert.equal(bud.state.units.b2.hp, 6500);
  assert.ok(bud.state.units.b2.statuses.some(status => status.statusId === blazingPeachIds.bud));

  let defeated = { ...bud.state, units: { ...bud.state.units, b2: { ...bud.state.units.b2, hp: 0, statuses: [] } },
    resources: { ...bud.state.resources, blue: { ...bud.state.resources.blue, fire: 3 } } };
  const revived = executeAction(defeated, { actorId: 'b', skillId: blazingPeachIds.reviveSkill, targetIds: ['b2'], shape: 'single', targetRelation: 'ally' },
    registry, () => .5, { resolveStatus });
  assert.equal(revived.state.units.b2.hp, 6000, `50%复活后，二级起再治疗桃花妖生命上限10%；事件：${JSON.stringify(revived.events
    .filter(event => event.unitId === 'b2' || event.targetId === 'b2').map(event => ({ type: event.type, amount: event.amount, hp: event.hp, hpGained: event.hpGained })))}`);
  assert.equal(revived.state.units.b2.actionGauge, 50, '三级起复活目标增加50%行动条');
  assert.ok(revived.state.units.b2.statuses.some(status => status.statusId === blazingPeachIds.bud));
  assert.ok(revived.state.units.b2.statuses.some(status => status.statusId === blazingPeachIds.bloom));

  const guardState = { ...revived.state, units: { ...revived.state.units,
    b2: { ...revived.state.units.b2, statuses: [...revived.state.units.b2.statuses.filter(status => status.statusId !== blazingPeachIds.bud),
      { instanceId: 'guarding-bud', statusId: blazingPeachIds.bud, source: { kind: 'skill', id: blazingPeachIds.budSkill, unitId: 'b' },
        stacks: 1, duration: { kind: 'permanent' } }] } } };
  const intercept = registry.getHero(blazingPeachIds.hero).interceptIncomingDamage(guardState, undefined,
    guardState.units.b, guardState.units.b.hp, 'normal');
  assert.equal(intercept.amount, 0, '三级被动用场上新蕊抵挡桃花妖致命伤害');
  assert.ok(intercept.effects.some(command => command.type === 'remove-status-instances' && command.targetId === 'b2'));
});

test('生剥鬼扫堂桶与三连雪球按技能等级交替，逐段独立判定冰冻', () => {
  const registry = new ContentRegistry(); registerOniMask(registry);
  const resolveStatus = id => registry.getStatus(id);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: oniMaskIds.hero, skillLevel: 5,
    skillLevels: { [oniMaskIds.barrel]: 5, [oniMaskIds.snow]: 5 },
    stats: { ...initial.units.b.stats, attack: 1000, crit: 0, hit: 0 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, defense: 0, resist: 0 } };
  initial = applyEffectCommands(initial, registry.getHero(oniMaskIds.hero).initialize(createBattleContext(initial), 'b'),
    'initialization', 'oni-mask-init', resolveStatus).state;
  const barrel = executeAction(initial, { actorId: 'b', skillId: oniMaskIds.barrel, targetIds: ['r'], shape: 'single', targetRelation: 'enemy' },
    registry, () => .99, { resolveStatus });
  assert.equal(barrel.state.units.r.hp, 8737.75, '五级普攻按攻击125%进入斗技伤害公式');
  assert.ok(barrel.state.units.b.statuses.some(status => status.statusId === oniMaskIds.formSnow));
  assert.ok(!barrel.state.units.b.statuses.some(status => status.statusId === oniMaskIds.formBarrel));

  const snow = executeAction(barrel.state, { actorId: 'b', skillId: oniMaskIds.snow, targetIds: ['r'], shape: 'single', targetRelation: 'enemy' },
    registry, () => .01, { resolveStatus });
  assert.equal(snow.state.units.r.hp, 7549.51, '雪球攻击三次，每次按攻击40%进入斗技伤害公式');
  assert.ok(snow.state.units.r.statuses.some(status => status.statusId === oniMaskIds.freeze));
  assert.ok(snow.state.units.b.statuses.some(status => status.statusId === oniMaskIds.formBarrel));
  assert.ok(!snow.state.units.b.statuses.some(status => status.statusId === oniMaskIds.formSnow));
});

test('紧那罗回合开始随机开放两曲，五级破免费弹奏并记录律音', () => {
  const registry = new ContentRegistry(); registerKinnara(registry);
  const resolveStatus = id => registry.getStatus(id);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: kinnaraIds.hero, skillLevel: 5,
    skillLevels: { [kinnaraIds.basic]: 5, [kinnaraIds.passive]: 5, [kinnaraIds.ultimate]: 5 },
    stats: { ...initial.units.b.stats, attack: 1000, crit: 0, hit: 0 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, defense: 0, resist: 0 } };
  const context = createBattleContext(initial, () => 0,
    id => registry.getStatus(id)?.category, id => registry.getStatus(id)?.dispellable ?? false);
  const opened = registry.getHero(kinnaraIds.hero).handlers['turn-start'].handle(context,
    { eventId: 'kinnara-turn-start', phase: 'turn-start', type: 'turn-started', unitId: 'b' });
  initial = applyEffectCommands(initial, opened, 'turn-start', 'kinnara-turn-start', resolveStatus).state;
  const available = initial.units.b.statuses.filter(status => status.statusId.startsWith(kinnaraIds.available));
  assert.equal(available.length, 2);
  const palace = executeAction(initial, { actorId: 'b', skillId: kinnaraIds.palace, targetIds: ['r'], shape: 'single', targetRelation: 'enemy' },
    registry, () => 0, { resolveStatus });
  assert.ok(palace.state.units.r.hp < initial.units.r.hp);
  assert.ok(palace.state.units.r.statuses.some(status => status.statusId === kinnaraIds.isolation));
  assert.ok(palace.state.units.b.statuses.some(status => status.statusId === kinnaraIds.melodyMemory
    && status.values.lastTone === kinnaraIds.palace));
  assert.equal(palace.state.units.b.statuses.filter(status => status.statusId.startsWith(kinnaraIds.available)).length, 1);
  assert.equal(palace.state.resources.blue.fire, initial.resources.blue.fire, '五级律音不消耗鬼火');
});

test('三味友方受控时每层增加30点速度，最多叠加两层', () => {
  let initial = state();
  initial.units.b = { ...initial.units.b, soulId: controlSoulIds.sanmi };
  const registry = new ContentRegistry(); registerControlSouls(registry);
  const definition = registry.getSoul(controlSoulIds.sanmi);
  const onControl = { eventId: 'sanmi-control-1', phase: 'control-application',
    source: { kind: 'skill', id: 'control.test', unitId: 'r' }, type: 'control-applied', targetId: 'b', newlyControlled: true };
  for (let i = 0; i < 3; i += 1) {
    const commands = definition.handlers['control-application'].handle(createBattleContext(initial),
      { ...onControl, eventId: `sanmi-control-${i + 1}` });
    initial = applyEffectCommands(initial, commands ?? [], 'effect-resolution', `sanmi-${i + 1}`,
      id => registry.getStatus(id)).state;
  }
  const speed = effectiveStats(initial.units.b).speed;
  const buff = initial.units.b.statuses.find(status => status.statusId === controlSoulIds.sanmiSpeed);
  assert.equal(buff.stacks, 2);
  assert.equal(speed, initial.units.b.stats.speed + 60);
  assert.equal(buff.duration.remaining, 2);
  assert.equal(registry.getStatus(controlSoulIds.sanmiSpeed).dispellable, false);
});

test('薙魂先减伤20%再均分余下伤害，守护只覆盖该次单体攻击', () => {
  let initial = state();
  initial.units.b = { ...initial.units.b, stats: { ...initial.units.b.stats, defense: 300 } };
  initial.units.p = { ...unit('p', 'blue'), soulId: baselineSoulIds.guard,
    stats: { ...unit('p', 'blue').stats, defense: 600 } };
  initial.units.p2 = { ...unit('p2', 'blue'), soulId: baselineSoulIds.guard,
    stats: { ...unit('p2', 'blue').stats, defense: 700 } };
  initial.sides.blue = ['b', 'p', 'p2'];
  initial.counters.attack = 42;
  const registry = new ContentRegistry(); registerBaselineSouls(registry);
  const definition = registry.getSoul(baselineSoulIds.guard);
  const attackStart = { eventId: 'guard-attack-start', phase: 'attack-start',
    source: { kind: 'skill', id: 'single.attack', unitId: 'r' }, type: 'attack-start', targetIds: ['b'],
    shape: 'single', attackId: 42 };
  const marker = definition.handlers['attack-start'].handle(createBattleContext(initial, () => 0), attackStart);
  const guarded = applyEffectCommands(initial, marker ?? [], 'effect-resolution', 'guard-marker',
    id => registry.getStatus(id)).state;
  assert.ok(guarded.units.r.statuses.some(status => status.statusId === guardAttackStatusId));
  assert.equal(guarded.units.r.statuses.find(status => status.statusId === guardAttackStatusId).values.protectorId, 'p',
    '50%判定成功后使用抽中的守护者');
  const randomSequence = (...values) => { let index = 0; return () => values[index++] ?? 0; };
  const secondProtector = definition.handlers['attack-start'].handle(createBattleContext(initial, randomSequence(.99, 0)), attackStart);
  assert.equal(secondProtector[0].instance.values.protectorId, 'p2', '守护者在多名携带者间随机选择');
  const failedChance = definition.handlers['attack-start'].handle(createBattleContext(initial, () => .5), attackStart);
  assert.equal(failedChance, undefined, '恰为50%的随机数不通过50%判定');

  const result = definition.interceptIncomingDamage(guarded, guarded.units.r, guarded.units.b, 1000, 'normal');
  assert.equal(result.amount, 400);
  assert.equal(result.effects[0].amount, 400,
    'amount 已按受击目标防御计算，守护分摊不能对同一伤害再次扣防');
  assert.equal(result.amount + result.effects[0].amount, 800);
  const trueHit = definition.interceptIncomingDamage(guarded, guarded.units.r, guarded.units.b, 1000, 'true');
  assert.equal(trueHit.amount, 400);
  assert.equal(trueHit.effects[0].amount, 400);
});

test('P0: engine entry uses K=300 and zero fluctuation across varying random samples', () => {
  const values = [0, .2, .4, .6, .999].map(value => calculateDamage({ attack: 5000, defense: 652, ratio: 1, critChance: 0, critDamage: 1.5 }, () => value).amount);
  assert.deepEqual(values, Array(5).fill(5000 * 300 / 952));
  assert.equal(calcRawAttackDmg(formula({ attack: 7500, defense: 0, hurtReductionRate: .25, fixedHurtReductionVal: 100 })).hpChange, 5900);
  assert.equal(composeLinear({ base: 10000, additionVal: 2052, additionRate: .9 }), 21052);
  assert.equal(composeMaxHp({ base: 10000, additionVal: 2052, additionRate: .9 }), 21052);
  const actor = { ...unit('b', 'blue'), stats: { ...unit('b', 'blue').stats, attack: 10000 }, statuses: [{ stacks: 1,
    modifiers: [{ stat: 'attack', operation: 'flat', amount: 2052 }, { stat: 'attack', operation: 'percent', amount: .9 }] }] };
  assert.equal(effectiveStats(actor).attack, 21052);
});

test('天井下的抵抗光环、回合治疗、清醒增益和欢愉供火推条按对应触发点结算', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: 323, skillLevel: 5, skillLevels: { '3232': 5, '3233': 3 }, hp: 9500 };
  initial.units.a = { ...unit('a', 'blue'), hp: 9000 };
  initial.sides.blue = ['b', 'a'];
  const registry = new ContentRegistry();
  registerTenjukka(registry);
  const definition = registry.getHero(323);
  const resolveStatus = statusId => registry.getStatus(statusId);
  const initialized = applyEffectCommands(initial, definition.initialize(createBattleContext(initial), 'b'),
    'effect-resolution', 'tenjukka-initialize', resolveStatus);
  assert.equal(effectiveStats(initialized.state.units.a).resist, 1.24);
  assert.equal(effectiveStats(initialized.state.units.b).resist, 1.49);

  const startContext = createBattleContext(initialized.state, () => .5, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable === true);
  const healed = applyEffectCommands(initialized.state, definition.handlers['turn-start'].handle(startContext,
    { eventId: 'ally-turn-start', phase: 'turn-start', source, type: 'turn-started', unitId: 'a' }),
  'effect-resolution', 'tenjukka-heal', resolveStatus);
  assert.equal(healed.state.units.a.hp, 9500);

  const awakeContext = createBattleContext(healed.state, () => .5, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable === true);
  const awakeCommands = definition.handlers['turn-start'].handle(awakeContext,
    { eventId: 'tenjukka-turn-start', phase: 'turn-start', source, type: 'turn-started', unitId: 'b' });
  const awake = applyEffectCommands(healed.state, awakeCommands, 'effect-resolution', 'tenjukka-awake', resolveStatus);
  assert.equal(effectiveDamageMultiplier(awake.state.units.a), 1.15);
  assert.equal(effectiveStats(awake.state.units.b).resist, 2.24);

  const active = definition.skills.find(skill => skill.id === tenjukkaIds.awaken);
  const castContext = createBattleContext(awake.state, () => .5, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable === true);
  const cast = applyEffectCommands(awake.state, active.execute(castContext,
    { actorId: 'b', skillId: tenjukkaIds.awaken, targetIds: ['b'], shape: 'self', targetRelation: 'ally' }, { stacks: 3 }),
  'effect-resolution', 'tenjukka-cast', resolveStatus);
  const joyInstance = cast.state.units.b.statuses.find(status => status.statusId === tenjukkaIds.joy);
  const dispelledJoy = applyEffectCommands(cast.state, [{ type: 'dispel-statuses', source,
    targetId: 'b', instanceIds: [joyInstance.instanceId], maxCount: 1 }], 'effect-resolution', 'tenjukka-dispel-joy', resolveStatus);
  assert.equal(dispelledJoy.state.units.b.statuses.some(status => status.statusId === tenjukkaIds.joy), false,
    '欢愉按客户端状态行可被驱散');
  const noSupplyCommands = definition.handlers['turn-end'].handle(createBattleContext(dispelledJoy.state),
    { eventId: 'tenjukka-dispelled-turn-end', phase: 'turn-end', source, type: 'turn-ended', unitId: 'b' });
  const noSupply = applyEffectCommands(dispelledJoy.state, noSupplyCommands, 'effect-resolution',
    'tenjukka-no-supply-after-dispel', resolveStatus);
  assert.equal(noSupply.state.resources.blue.fire, 0, '欢愉已驱散后持有者回合结束不应供火');
  const turnEndContext = createBattleContext(cast.state, () => .5, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable === true);
  const turnEnd = applyEffectCommands(cast.state, definition.handlers['turn-end'].handle(turnEndContext,
    { eventId: 'ally-turn-end', phase: 'turn-end', source, type: 'turn-ended', unitId: 'a' }),
  'effect-resolution', 'tenjukka-joy-consumed', resolveStatus);
  const remainingJoy = turnEnd.state.units.b.statuses.find(status => status.statusId === tenjukkaIds.joy);
  assert.equal(remainingJoy.stacks, 2);
  assert.equal(turnEnd.state.resources.blue.fire, 1);
  assert.equal(turnEnd.state.units.a.actionGauge, 25);

  const ownerEndContext = createBattleContext(turnEnd.state, () => .5, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable === true);
  const cleared = applyEffectCommands(turnEnd.state, definition.handlers['turn-end'].handle(ownerEndContext,
    { eventId: 'tenjukka-turn-end', phase: 'turn-end', source, type: 'turn-ended', unitId: 'b' }),
  'effect-resolution', 'tenjukka-awake-end', resolveStatus);
  assert.equal(effectiveDamageMultiplier(cleared.state.units.a), 1);
  assert.equal(effectiveStats(cleared.state.units.b).resist, 1.49);
  assert.equal(cleared.state.units.b.statuses.find(status => status.statusId === tenjukkaIds.joy).stacks, 1,
    '欢愉持有者本人回合结束也消耗一层');
  assert.equal(cleared.state.resources.blue.fire, 2, '天井下自身消耗欢愉同样获得鬼火');
  assert.equal(cleared.state.units.b.actionGauge, 25, '三级再会之音也为天井下本人推进25%行动条');
});

test('天井下欢愉的供火和推条会在正式战斗的友方回合结束后执行', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: 323, skillLevel: 5, skillLevels: { '3232': 5, '3233': 3 },
    stats: { ...initial.units.b.stats, attack: 10, speed: 220 } };
  initial.units.a = { ...unit('a', 'blue'), stats: { ...unit('a', 'blue').stats, attack: 10, speed: 180 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, attack: 10, speed: 100 } };
  initial.sides.blue = ['b', 'a'];
  const registry = new ContentRegistry();
  registerTenjukka(registry);
  for (const heroId of [1, 2]) registry.registerHero({ id: heroId, skills: [createBasicAttackSkill(`basic.${heroId}`, [1])],
    policy(context, actorId) {
      const actor = context.getUnit(actorId);
      const target = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue')[0];
      return target ? { actorId, skillId: `basic.${heroId}`, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' } : undefined;
    } });
  const result = runBattle(initial, registry, { actionLimit: 8, seed: 7 });
  assert.ok(result.events.some(event => event.type === 'resource-changed' && event.source.id === tenjukkaIds.awaken
    && event.after > event.before));
  assert.ok(result.events.some(event => event.type === 'action-gauge-changed' && event.source.id === tenjukkaIds.awaken
    && event.unitId === 'a' && event.after > event.before));
});

test('天井下被封印时移除抵抗光环，封印解除后按技能等级恢复', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: tenjukkaIds.hero, skillLevel: 5, skillLevels: { '3232': 5 } };
  initial.units.a = unit('a', 'blue');
  initial.sides.blue = ['b', 'a'];
  const registry = new ContentRegistry();
  registerTenjukka(registry);
  registry.registerStatus(passiveSuppressionStatusDefinition);
  const definition = registry.getHero(tenjukkaIds.hero);
  const resolveStatus = statusId => registry.getStatus(statusId);
  const initialized = applyEffectCommands(initial, definition.initialize(createBattleContext(initial), 'b'),
    'effect-resolution', 'tenjukka-seal-initialize', resolveStatus).state;
  const baseAllyResist = effectiveStats(initial.units.a).resist;
  const baseOwnerResist = effectiveStats(initial.units.b).resist;
  assert.equal(effectiveStats(initialized.units.a).resist, 1.24);

  const seal = { instanceId: 'tenjukka-passive-seal', statusId: passiveSuppressionStatusId, source,
    stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } };
  const sealed = applyEffectCommands(initialized, [{ type: 'add-status', source, targetId: 'b', instance: seal }],
    'effect-resolution', 'tenjukka-passive-sealed', resolveStatus);
  const sealEvent = sealed.events.find(event => event.type === 'status-added' && event.instance.statusId === passiveSuppressionStatusId);
  const removedAuraCommands = definition.handlers['effect-resolution'].handle(createBattleContext(sealed.state), sealEvent);
  const withoutAura = applyEffectCommands(sealed.state, removedAuraCommands, 'effect-resolution', 'tenjukka-aura-suppressed', resolveStatus).state;
  assert.equal(effectiveStats(withoutAura.units.a).resist, baseAllyResist);
  assert.equal(effectiveStats(withoutAura.units.b).resist, baseOwnerResist);

  const unsealed = applyEffectCommands(withoutAura, [{ type: 'remove-status-instances', source, targetId: 'b',
    instanceIds: [seal.instanceId], reason: 'expired' }], 'effect-resolution', 'tenjukka-passive-restored', resolveStatus);
  const unsealEvent = unsealed.events.find(event => event.type === 'status-removed' && event.statusId === passiveSuppressionStatusId);
  const restoreAuraCommands = definition.handlers['effect-resolution'].handle(createBattleContext(unsealed.state), unsealEvent);
  const restored = applyEffectCommands(unsealed.state, restoreAuraCommands, 'effect-resolution', 'tenjukka-aura-restored', resolveStatus).state;
  assert.equal(effectiveStats(restored.units.a).resist, 1.24);
  assert.equal(effectiveStats(restored.units.b).resist, 1.49);
});

test('犬夜叉风劲提供速度和增伤，普攻触发与回合末分别叠层', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: 313, skillLevel: 5 };
  const registry = new ContentRegistry(); registerInuyasha(registry);
  const definition = registry.getHero(313);
  const context = createBattleContext(initial, () => .09, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable === true);
  const basicEnd = definition.handlers['attack-end'].handle(context,
    { eventId: 'inuyasha-basic-end', phase: 'attack-end', source: { kind: 'skill', id: inuyashaIds.basic, unitId: 'b' },
      type: 'attack-ended', hitCount: 1, actionKind: 'basic' });
  let applied = applyEffectCommands(initial, basicEnd, 'effect-resolution', 'inuyasha-basic-wind', id => registry.getStatus(id));
  const turnContext = createBattleContext(applied.state, () => .5, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable === true);
  const turnEnd = definition.handlers['turn-end'].handle(turnContext,
    { eventId: 'inuyasha-turn-end', phase: 'turn-end', source, type: 'turn-ended', unitId: 'b' });
  applied = applyEffectCommands(applied.state, turnEnd, 'effect-resolution', 'inuyasha-turn-wind', id => registry.getStatus(id));
  const wind = applied.state.units.b.statuses.find(status => status.statusId === inuyashaIds.wind);
  assert.equal(wind.stacks, 2);
  assert.equal(effectiveStats(applied.state.units.b).speed, 120);
  assert.equal(effectiveDamageMultiplier(applied.state.units.b), 1.1);
});

test('犬夜叉风劲按客户端普攻描述在全部等级触发，命中10%边界正确', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: inuyashaIds.hero, skillLevel: 5,
    skillLevels: { [inuyashaIds.basic]: 1 } };
  const registry = new ContentRegistry(); registerInuyasha(registry);
  const definition = registry.getHero(inuyashaIds.hero);
  assert.match(gameSkillRow(inuyashaIds.basic, 1, -1).desc, /10%概率获得1层[\s\S]*回合结束后，获得1层/,
    '客户端一级技能文本已包含普攻概率叠层和回合末固定叠层');
  const attackEvent = { eventId: 'inuyasha-rank-one-attack', phase: 'attack-end',
    source: { kind: 'skill', id: inuyashaIds.basic, unitId: 'b' }, type: 'attack-ended', hitCount: 1, actionKind: 'basic' };
  const context = createBattleContext(initial, () => .09, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable === true);
  const attackEnd = definition.handlers['attack-end'].handle(context, attackEvent);
  assert.equal(attackEnd[0].instance.stacks, 1, '一级普攻在随机值低于10%时照样获得风劲');
  const afterAttack = applyEffectCommands(initial, attackEnd, 'effect-resolution', 'inuyasha-rank-one-attack',
    id => registry.getStatus(id)).state;
  const turnEnd = definition.handlers['turn-end'].handle(createBattleContext(afterAttack),
    { eventId: 'inuyasha-rank-one-turn', phase: 'turn-end', source, type: 'turn-ended', unitId: 'b' });
  const afterTurn = applyEffectCommands(afterAttack, turnEnd, 'effect-resolution', 'inuyasha-rank-one-turn',
    id => registry.getStatus(id)).state;
  assert.equal(afterTurn.units.b.statuses.find(status => status.statusId === inuyashaIds.wind).stacks, 2,
    '一级回合结束固定追加第二层');
  assert.equal(definition.handlers['attack-end'].handle(createBattleContext(initial, () => .1), attackEvent), undefined,
    '随机值恰为10%时不通过概率判定');
});

test('化鲸首回合双甲、体甲恢复推条和齿甲生命上限伤害按触发点结算', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: 324, skillLevel: 5, skillLevels: { '3242': 5, '3243': 5 }, hp: 9000 };
  initial.units.a = { ...unit('a', 'blue'), hp: 4000, stats: { ...unit('a', 'blue').stats, attack: 8000 } };
  initial.units.summon = { ...unit('summon', 'blue'), unitId: 'summon', unitKind: 'summon', hp: 1000 };
  initial.sides.blue = ['b', 'a', 'summon'];
  const registry = new ContentRegistry(); registerWhaleSummoner(registry);
  const definition = registry.getHero(324), resolveStatus = id => registry.getStatus(id);
  const initialized = applyEffectCommands(initial, definition.initialize(createBattleContext(initial), 'b'),
    'effect-resolution', 'whale-initialize', resolveStatus).state;
  assert.ok(initialized.units.b.statuses.some(status => status.statusId === whaleSummonerIds.toothArmor));
  assert.ok(initialized.units.a.statuses.some(status => status.statusId === whaleSummonerIds.bodyArmor));

  const tooth = definition.skills.find(skill => skill.id === whaleSummonerIds.tooth);
  assert.equal(tooth.resourceCostsByLevel[4].amount, 2);
  const body = definition.skills.find(skill => skill.id === whaleSummonerIds.body);
  assert.equal(body.resourceCostsByLevel[4].amount, 2);
  const castContext = createBattleContext(initialized, () => .5, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable === true);
  const bodyCommands = body.execute(castContext, { actorId: 'b', skillId: whaleSummonerIds.body, targetIds: ['a'],
    shape: 'single', targetRelation: 'ally' }, { ratio: .1 });
  const healed = applyEffectCommands(initialized, bodyCommands, 'effect-resolution', 'whale-body', resolveStatus).state;
  assert.equal(healed.units.a.hp, 5000);
  assert.equal(healed.units.b.hp, 10000, '体甲群疗覆盖化鲸本身');
  assert.equal(healed.units.summon.hp, 1000, '体甲群疗排除召唤物');
  const turnStart = definition.handlers['turn-start'].handle(createBattleContext(healed),
    { eventId: 'body-start', phase: 'turn-start', source, type: 'turn-started', unitId: 'a' });
  const started = applyEffectCommands(healed, turnStart, 'effect-resolution', 'whale-start', resolveStatus).state;
  assert.equal(started.units.a.hp, 6000, '体甲五级行动前恢复化鲸生命上限10%');
  const turnEnd = definition.handlers['turn-end'].handle(createBattleContext(started),
    { eventId: 'body-end', phase: 'turn-end', source, type: 'turn-ended', unitId: 'a' });
  assert.ok(turnEnd.some(command => command.type === 'change-action-gauge' && command.amount === 20));
  const bodyEnd = applyEffectCommands(started, turnEnd, 'turn-end', 'whale-body-end', resolveStatus);
  assert.equal(bodyEnd.state.units.a.actionGauge, 20);

  const toothEnd = definition.handlers['turn-end'].handle(createBattleContext(initialized),
    { eventId: 'tooth-end', phase: 'turn-end', source, type: 'turn-ended', unitId: 'b' });
  const resolved = applyEffectCommands(initialized, toothEnd, 'effect-resolution', 'whale-tooth', resolveStatus);
  const toothDamage = resolved.events.find(event => event.type === 'damage' && event.source.id === whaleSummonerIds.tooth);
  assert.equal(toothDamage.damageKind, 'true');
  assert.equal(toothDamage.amount, 1500);
  assert.equal(toothDamage.suppressSoulTriggers, true);
  assert.equal(toothDamage.suppressTargetSoulTriggers, true);
  assert.equal(toothDamage.suppressTargetPassiveTriggers, true);
  assert.equal(toothDamage.suppressSourcePassiveTriggers, true);

  let sourcePassiveTriggers = 0;
  let targetPassiveTriggers = 0;
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'hero:324:tooth-source-listener', phase: 'hit', priority: 1,
    handle(_context, event) { if (event.type === 'damage') sourcePassiveTriggers += 1; } });
  dispatcher.register({ id: 'hero:2:tooth-target-listener', phase: 'hit', priority: 1,
    handle(_context, event) { if (event.type === 'damage') targetPassiveTriggers += 1; } });
  settleEvents(resolved.state, resolved.events, dispatcher, () => .5);
  assert.equal(sourcePassiveTriggers, 0);
  assert.equal(targetPassiveTriggers, 0);

  const unsuppressedDamage = resolved.events.map(event => event.type === 'damage'
    ? { ...event, suppressSourcePassiveTriggers: false, suppressTargetPassiveTriggers: false } : event);
  settleEvents(resolved.state, unsuppressedDamage, dispatcher, () => .5);
  assert.equal(sourcePassiveTriggers, 1);
  assert.equal(targetPassiveTriggers, 1);
});

test('化鲸体甲在行动前按技能等级治疗化鲸生命上限的6%至10%', () => {
  const ratios = [.06, .07, .08, .09, .1];
  const registry = new ContentRegistry(); registerWhaleSummoner(registry);
  const definition = registry.getHero(whaleSummonerIds.hero);
  for (let rank = 1; rank <= 5; rank += 1) {
    let initial = state();
    initial.units.b = { ...initial.units.b, heroId: whaleSummonerIds.hero, skillLevel: rank,
      skillLevels: { [whaleSummonerIds.body]: rank }, hp: 5000,
      stats: { ...initial.units.b.stats, hp: 10000 } };
    const resolveStatus = id => registry.getStatus(id);
    initial = applyEffectCommands(initial, definition.initialize(createBattleContext(initial), 'b'),
      'effect-resolution', `whale-body-rank-${rank}`, resolveStatus).state;
    const armor = initial.units.b.statuses.find(status => status.statusId === whaleSummonerIds.bodyArmor);
    assert.equal(armor.values.preTurnHealRatio, ratios[rank - 1]);
    const commands = definition.handlers['turn-start'].handle(createBattleContext(initial),
      { eventId: `whale-body-turn-${rank}`, phase: 'turn-start', source, type: 'turn-started', unitId: 'b' });
    const started = applyEffectCommands(initial, commands ?? [], 'effect-resolution', `whale-body-heal-${rank}`, resolveStatus).state;
    assert.equal(started.units.b.hp, 5000 + 10000 * ratios[rank - 1], `体甲等级${rank}的行动前治疗比例`);
  }
});

test('化鲸齿甲与体甲按各自技能等级判断费用并拒绝给召唤物施甲', () => {
  const registry = new ContentRegistry(); registerWhaleSummoner(registry);
  const makeInitial = skillLevels => {
    const initial = state();
    initial.units.b = { ...initial.units.b, heroId: whaleSummonerIds.hero, skillLevel: 5, skillLevels,
      statuses: [], stats: { ...initial.units.b.stats, attack: 500 } };
    initial.units.a = { ...unit('a', 'blue'), hp: 3000, statuses: [], stats: { ...unit('a', 'blue').stats, attack: 300 } };
    initial.units.summon = { ...initial.units.a, unitId: 'summon', unitKind: 'summon', statuses: [],
      stats: { ...initial.units.a.stats, attack: 1000 } };
    initial.sides.blue = ['b', 'a', 'summon'];
    initial.resources.blue.fire = 2;
    return initial;
  };
  const toothCheap = makeInitial({ [whaleSummonerIds.tooth]: 5, [whaleSummonerIds.body]: 1 });
  const toothContext = createBattleContext(toothCheap, () => .5, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable === true);
  assert.equal(registry.getHero(whaleSummonerIds.hero).policy(toothContext, 'b').skillId, whaleSummonerIds.tooth,
    '齿甲五级费用2火，不受体甲一级影响');
  const bodyCheap = makeInitial({ [whaleSummonerIds.tooth]: 1, [whaleSummonerIds.body]: 5 });
  const bodyContext = createBattleContext(bodyCheap, () => .5, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable === true);
  assert.equal(registry.getHero(whaleSummonerIds.hero).policy(bodyContext, 'b').skillId, whaleSummonerIds.body,
    '一级齿甲费用3火，不能借用体甲五级的2火费用');

  const hero = registry.getHero(whaleSummonerIds.hero);
  for (const skillId of [whaleSummonerIds.tooth, whaleSummonerIds.body]) {
    const skill = hero.skills.find(candidate => candidate.id === skillId);
    const result = skill.execute(toothContext, { actorId: 'b', skillId, targetIds: ['summon'],
      shape: 'single', targetRelation: 'ally' }, { ratio: .1 });
    assert.deepEqual(result, [], `${skillId}不得对召唤物施加护甲`);
  }
});

test('化鲸普攻邀战执行友方式神自己的普攻技能与被动效果', () => {
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: whaleSummonerIds.hero, skillLevel: 5,
    stats: { ...initial.units.b.stats, attack: 1000 } };
  initial.units.a = { ...unit('a', 'blue'), heroId: fireflyIds.hero, skillLevel: 5,
    hp: 5000, stats: { ...unit('a', 'blue').stats, attack: 2000 }, statuses: [{
      instanceId: 'whale-tooth-on-firefly', statusId: whaleSummonerIds.toothArmor,
      source: { kind: 'skill', id: whaleSummonerIds.tooth, unitId: 'b' }, stacks: 1,
      duration: { kind: 'permanent' }, values: { whaleUnitId: 'b' },
    }] };
  initial.units.r = { ...initial.units.r, hp: 100000,
    stats: { ...initial.units.r.stats, hp: 100000, defense: 0, attack: 1 } };
  initial.sides.blue = ['b', 'a'];
  const registry = new ContentRegistry();
  registerWhaleSummoner(registry); registerFirefly(registry);
  const dispatcher = new EventDispatcher();
  for (const heroId of [whaleSummonerIds.hero, fireflyIds.hero]) {
    const definition = registry.getHero(heroId);
    for (const [phase, rule] of Object.entries(definition.handlers ?? {}))
      dispatcher.register({ id: `hero:${heroId}:${phase}`, phase, priority: rule.priority, handle: rule.handle });
  }
  const result = executeAction(initial, { actorId: 'b', skillId: whaleSummonerIds.basic, targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .5, {
    dispatcher, resolveStatus: id => registry.getStatus(id),
  });
  const invite = result.events.find(event => event.type === 'action-scheduled'
    && event.scheduling === 'assist' && event.intent.actorId === 'a');
  assert.equal(invite?.intent.skillId, fireflyIds.basic, '邀战应调度萤草的真实普攻技能');
  const invitedHits = result.events.filter(event => event.type === 'damage' && event.source.id === fireflyIds.basic);
  assert.ok(invitedHits.length > 0, '邀战伤害应由萤草普攻技能结算');
  assert.ok(invitedHits.every(event => event.actionKind === 'passive'), '邀战普攻保持回合外行动类型');
  const passiveHeal = result.events.find(event => event.type === 'healing' && event.source.id === fireflyIds.basic
    && event.targetId === 'a');
  assert.ok(passiveHeal && passiveHeal.hpGained > 0, '萤草普攻自带的30%吸血也应在邀战时生效');
});

test('萤草反击每个敌方行动至多一次，行动前最多五次，自己的回合开始重置次数', () => {
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: fireflyIds.hero, skillLevel: 5,
    skillLevels: { [fireflyIds.passive]: 5 }, stats: { ...initial.units.b.stats, attack: 5000 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, attack: 4000 } };
  const registry = new ContentRegistry(); registerFirefly(registry);
  const definition = registry.getHero(fireflyIds.hero);
  const settleHit = (current, actionId, attackId) => {
    const commands = definition.handlers.hit.handle(createBattleContext(current), { eventId: `firefly-hit-${attackId}`,
      phase: 'hit', actionId, source: { kind: 'skill', id: 'enemy-multi-hit', unitId: 'r' }, type: 'damage',
      targetId: 'b', damageKind: 'normal', amount: 100, hpLost: 100, mitigated: 0, isCritical: false, attackId });
    const next = applyEffectCommands(current, commands ?? [], 'effect-resolution', `firefly-counter-${attackId}`,
      id => registry.getStatus(id)).state;
    return { next, counter: (commands ?? []).some(command => command.type === 'schedule-action') };
  };

  let first = settleHit(initial, 10, 1);
  assert.equal(first.counter, true);
  let sameEnemyTurn = settleHit(first.next, 10, 2);
  assert.equal(sameEnemyTurn.counter, false, '同一敌方行动中的多段攻击只反击一次');

  let current = sameEnemyTurn.next;
  for (let actionId = 11; actionId <= 14; actionId += 1) {
    const hit = settleHit(current, actionId, actionId);
    assert.equal(hit.counter, true, `萤草行动前第${actionId - 9}次合格敌方行动应反击`);
    current = hit.next;
  }
  const sixth = settleHit(current, 15, 15);
  assert.equal(sixth.counter, false, '萤草行动前反击最多五次');

  const reset = definition.handlers['turn-start'].handle(createBattleContext(current),
    { eventId: 'firefly-turn-start-reset', phase: 'turn-start', source, type: 'turn-started', unitId: 'b' });
  current = applyEffectCommands(current, reset ?? [], 'effect-resolution', 'firefly-counter-reset',
    id => registry.getStatus(id)).state;
  assert.equal(current.units.b.statuses.find(status => status.statusId === fireflyIds.passiveWindow)
    .values.counterUsesSinceTurn, 0);
  assert.equal(settleHit(current, 16, 16).counter, true, '自身回合开始后恢复反击次数');
});

test('萤草生花按每次攻击治疗攻击者，低攻击来源伤害降低30%', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: fireflyIds.hero, skillLevel: 5,
    skillLevels: { [fireflyIds.passive]: 5 }, stats: { ...initial.units.b.stats, attack: 5000 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, attack: 4000 } };
  const registry = new ContentRegistry(); registerFirefly(registry);
  const definition = registry.getHero(fireflyIds.hero);
  assert.equal(definition.modifyIncomingDamage(initial.units.r, initial.units.b, 1000), 700);
  assert.equal(definition.modifyIncomingDamage({ ...initial.units.r, stats: { ...initial.units.r.stats, attack: 5000 } },
    initial.units.b, 1000), 1000, '攻击力相同不触发减伤');
  const hit = { eventId: 'firefly-passive-heal', phase: 'hit', actionId: 8, attackId: 10,
    source: { kind: 'skill', id: 'enemy-basic', unitId: 'r' }, type: 'damage', targetId: 'b',
    damageKind: 'normal', amount: 1000, hpLost: 1000, mitigated: 0, isCritical: false };
  const commands = definition.handlers.hit.handle(createBattleContext(initial), hit);
  assert.ok(commands.some(command => command.type === 'heal' && command.targetId === 'b' && command.amount === 760),
    '五级生花按攻击者攻击力19%治疗');
  const afterFirstHit = applyEffectCommands(initial, commands, 'effect-resolution', 'firefly-passive-window',
    id => registry.getStatus(id)).state;
  const repeatedHit = definition.handlers.hit.handle(createBattleContext(afterFirstHit), { ...hit, eventId: 'firefly-passive-heal-repeat' });
  assert.equal(repeatedHit.some(command => command.type === 'heal'), false, '同一攻击内不能重复治疗');
});

test('萤草五级治愈之光转移种子、群疗及光合作用按客户端比例结算', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: fireflyIds.hero, skillLevel: 5,
    skillLevels: { [fireflyIds.heal]: 5 }, hp: 5000,
    stats: { ...initial.units.b.stats, hp: 10000, attack: 1000 } };
  initial.units.a = { ...unit('a', 'blue'), hp: 4000 };
  initial.sides.blue = ['b', 'a'];
  const registry = new ContentRegistry(); registerFirefly(registry);
  const definition = registry.getHero(fireflyIds.hero), resolveStatus = id => registry.getStatus(id);
  let current = applyEffectCommands(initial, definition.initialize(createBattleContext(initial), 'b'),
    'effect-resolution', 'firefly-heal-initialize', resolveStatus).state;
  assert.equal(current.units.b.statuses.find(status => status.statusId === fireflyIds.seed).stacks, 2);
  const heal = definition.skills.find(skill => skill.id === fireflyIds.heal);
  const healCommands = heal.execute(createBattleContext(current), { actorId: 'b', skillId: fireflyIds.heal,
    targetIds: ['b', 'a'], selectedTargetId: 'a', shape: 'all-allies', targetRelation: 'ally' },
  heal.levels[4]);
  assert.ok(healCommands.some(command => command.type === 'heal' && command.targetId === 'a' && command.amount === 2288));
  const photo = healCommands.find(command => command.type === 'add-status' && command.targetId === 'a'
    && command.instance.statusId === fireflyIds.photosynthesis);
  assert.equal(photo.instance.values.healAmount, 572);
  current = applyEffectCommands(current, healCommands, 'effect-resolution', 'firefly-heal-cast', resolveStatus).state;
  assert.equal(current.units.b.statuses.find(status => status.statusId === fireflyIds.seed).stacks, 1);
  assert.equal(current.units.a.statuses.find(status => status.statusId === fireflyIds.seed).stacks, 1);

  const photoHeal = definition.handlers['turn-start'].handle(createBattleContext(current),
    { eventId: 'firefly-photo-heal', phase: 'turn-start', source, type: 'turn-started', unitId: 'a' });
  assert.ok(photoHeal.some(command => command.type === 'heal' && command.targetId === 'a' && command.amount === 572));
  const interception = definition.interceptIncomingDamage(current, current.units.r, current.units.a, 500, 'normal');
  assert.equal(interception.amount, 0);
  assert.ok(interception.effects.some(command => command.type === 'heal' && command.targetId === 'a' && command.amount === 500));
  current = applyEffectCommands(current, interception.effects, 'effect-resolution', 'firefly-photo-convert', resolveStatus).state;
  assert.equal(definition.interceptIncomingDamage(current, current.units.r, current.units.a, 500, 'normal'), undefined,
    '同一回目的首次伤害转换后不再重复触发');
});

test('萤草五级治愈之光只在非召唤友方阵亡时获得种子并受五层上限约束', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: fireflyIds.hero, skillLevel: 5,
    skillLevels: { [fireflyIds.heal]: 5 }, statuses: [{ instanceId: `${fireflyIds.seed}:b:b`,
      statusId: fireflyIds.seed, source: { kind: 'skill', id: fireflyIds.passive, unitId: 'b' },
      stacks: 4, duration: { kind: 'permanent' }, values: { seedCount: 4 } }] };
  initial.units.a = { ...unit('a', 'blue'), hp: 0 };
  initial.units.summon = { ...unit('summon', 'blue'), unitId: 'summon', unitKind: 'summon', hp: 0 };
  initial.sides.blue = ['b', 'a', 'summon'];
  const registry = new ContentRegistry(); registerFirefly(registry);
  const definition = registry.getHero(fireflyIds.hero);
  const death = (unitId, eventId) => definition.handlers['unit-defeated'].handle(createBattleContext(initial),
    { eventId, phase: 'unit-defeat', source, type: 'unit-defeated', unitId });
  const normalDeath = death('a', 'firefly-ally-death');
  assert.equal(normalDeath[0].instance.stacks, 5);
  assert.equal(death('summon', 'firefly-summon-death'), undefined, '召唤物阵亡不生成种子');
  initial.units.b.statuses[0] = { ...initial.units.b.statuses[0], stacks: 5 };
  assert.equal(death('a', 'firefly-seed-cap').length, 0, '五层时不再生成额外种子');
});

test('多化鲸只邀战持有自身齿甲的友方，不串用另一名化鲸的标记', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: whaleSummonerIds.hero, stats: { ...initial.units.b.stats, attack: 1000 } };
  initial.units.whale2 = { ...unit('whale2', 'blue'), heroId: whaleSummonerIds.hero,
    stats: { ...unit('whale2', 'blue').stats, attack: 900 } };
  const tooth = ownerId => ({ instanceId: `tooth:${ownerId}`, statusId: whaleSummonerIds.toothArmor,
    source: { kind: 'skill', id: whaleSummonerIds.tooth, unitId: ownerId }, stacks: 1,
    duration: { kind: 'permanent' }, values: { whaleUnitId: ownerId } });
  initial.units.a = { ...unit('a', 'blue'), heroId: fireflyIds.hero, hp: 5000,
    stats: { ...unit('a', 'blue').stats, attack: 2000 }, statuses: [tooth('b')] };
  initial.units.c = { ...unit('c', 'blue'), heroId: fireflyIds.hero, hp: 5000,
    stats: { ...unit('c', 'blue').stats, attack: 1500 }, statuses: [tooth('whale2')] };
  initial.units.r = { ...initial.units.r, hp: 100000,
    stats: { ...initial.units.r.stats, hp: 100000, defense: 0, attack: 1 } };
  initial.sides.blue = ['b', 'whale2', 'a', 'c'];
  const registry = new ContentRegistry(); registerWhaleSummoner(registry); registerFirefly(registry);
  const dispatcher = new EventDispatcher();
  for (const heroId of [whaleSummonerIds.hero, fireflyIds.hero]) {
    const definition = registry.getHero(heroId);
    for (const [phase, rule] of Object.entries(definition.handlers ?? {}))
      dispatcher.register({ id: `multi:${heroId}:${phase}`, phase, priority: rule.priority, handle: rule.handle });
  }
  const runtime = { dispatcher, resolveStatus: id => registry.getStatus(id) };
  const first = executeAction(initial, { actorId: 'b', skillId: whaleSummonerIds.basic, targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .5, runtime);
  assert.ok(first.events.some(event => event.type === 'action-scheduled' && event.scheduling === 'assist'
    && event.intent.actorId === 'a'), '第一名化鲸只认领自己的齿甲持有者');
  assert.equal(first.events.some(event => event.type === 'action-scheduled' && event.intent.actorId === 'c'), false,
    '另一名化鲸持有的齿甲不能被第一名化鲸借用');
  const second = executeAction(first.state, { actorId: 'whale2', skillId: whaleSummonerIds.basic, targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .5, runtime);
  assert.ok(second.events.some(event => event.type === 'action-scheduled' && event.scheduling === 'assist'
    && event.intent.actorId === 'c'), '第二名化鲸正确使用自己的齿甲标记');
});

test('化鲸邀战齿甲目标时优先选择非化鲸友方', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: whaleSummonerIds.hero };
  initial.units.whale2 = { ...unit('whale2', 'blue'), heroId: whaleSummonerIds.hero, statuses: [{
    instanceId: 'tooth-from-b-on-whale2', statusId: whaleSummonerIds.toothArmor,
    source: { kind: 'skill', id: whaleSummonerIds.tooth, unitId: 'b' }, stacks: 1,
    duration: { kind: 'permanent' }, values: { whaleUnitId: 'b' },
  }] };
  initial.units.ally = { ...unit('ally', 'blue'), statuses: [{
    instanceId: 'tooth-from-b-on-ally', statusId: whaleSummonerIds.toothArmor,
    source: { kind: 'skill', id: whaleSummonerIds.tooth, unitId: 'b' }, stacks: 1,
    duration: { kind: 'permanent' }, values: { whaleUnitId: 'b' },
  }] };
  initial.sides.blue = ['b', 'whale2', 'ally'];
  const registry = new ContentRegistry();
  registerWhaleSummoner(registry);
  registry.registerHero({ id: 2, skills: [{ id: '2', actionKind: 'basic', target: 'single', targetRelation: 'enemy',
    levels: [{}], execute() { return []; } }] });
  const dispatcher = new EventDispatcher();
  const definition = registry.getHero(whaleSummonerIds.hero);
  dispatcher.register({ id: `hero:${whaleSummonerIds.hero}:attack-end`, phase: 'attack-end', priority: 24,
    handle: definition.handlers['attack-end'].handle });
  const result = executeAction(initial, { actorId: 'b', skillId: whaleSummonerIds.basic, targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .5, { dispatcher,
    resolveStatus: id => registry.getStatus(id) });
  const invite = result.events.find(event => event.type === 'action-scheduled' && event.scheduling === 'assist');
  assert.equal(invite?.intent.actorId, 'ally', '即使化鲸先出现在队列中，也应优先邀战非化鲸友方');
});

test('御馔津狐狩界不可升级，开场和手动施放都固定给予4层灵符', () => {
  assert.match(gameSkillRow(omikaneIds.foxHunt, 1, 2).desc, /获得4层/,
    '客户端技能表记录狐狩界固定获得4层');
  const registry = new ContentRegistry(); registerOmikane(registry);
  const definition = registry.getHero(omikaneIds.hero);
  for (let rank = 1; rank <= 5; rank += 1) {
    const initial = state();
    initial.units.b = { ...initial.units.b, heroId: omikaneIds.hero, skillLevel: rank,
      skillLevels: { [omikaneIds.foxHunt]: rank } };
    const opening = definition.initialize(createBattleContext(initial), 'b');
    assert.equal(opening.find(command => command.type === 'add-status' && command.targetId === 'b'
      && command.instance.statusId === omikaneIds.talisman)?.instance.stacks, 4,
    `技能等级${rank}的先机狐狩界仍固定获得4层`);
    const foxHunt = definition.skills.find(skill => skill.id === omikaneIds.foxHunt);
    const cast = foxHunt.execute(createBattleContext(initial), { actorId: 'b', skillId: omikaneIds.foxHunt,
      targetIds: ['b'], shape: 'self', targetRelation: 'ally' }, {});
    assert.equal(cast.find(command => command.type === 'add-status' && command.targetId === 'b'
      && command.instance.statusId === omikaneIds.talisman)?.instance.stacks, 4,
    `技能等级${rank}的手动狐狩界仍固定获得4层`);
  }
});

test('御馔津先机狐狩界叠加灵符全队增益，敌方行动后封魔箭封印并屏蔽目标被动', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: 304, skillLevel: 5, skillLevels: { '3041': 5, '3042': 2 },
    stats: { ...initial.units.b.stats, resist: 0 } };
  initial.units.a = { ...unit('a', 'blue'), stats: { ...unit('a', 'blue').stats, defense: 1000, speed: 100 } };
  initial.units.r = { ...initial.units.r, hp: 10000, stats: { ...initial.units.r.stats, hp: 10000, resist: 0 } };
  initial.sides.blue = ['b', 'a'];
  const registry = new ContentRegistry(); registerOmikane(registry);
  const definition = registry.getHero(304), resolveStatus = id => registry.getStatus(id);
  const initialized = applyEffectCommands(initial, definition.initialize(createBattleContext(initial), 'b'),
    'effect-resolution', 'omikane-initialize', resolveStatus).state;
  assert.equal(effectiveStats(initialized.units.a).defense, 1120);
  assert.equal(effectiveStats(initialized.units.a).speed, 104);
  assert.equal(effectiveDamageMultiplier(initialized.units.a), 1.08);
  const foxHunt = definition.skills.find(skill => skill.id === omikaneIds.foxHunt);
  const renewed = applyEffectCommands(initialized, foxHunt.execute(createBattleContext(initialized),
    { actorId: 'b', skillId: omikaneIds.foxHunt, targetIds: ['b'], shape: 'self', targetRelation: 'ally' }, { layers: 8 }),
  'effect-resolution', 'omikane-renew', resolveStatus).state;
  assert.equal(effectiveStats(renewed.units.a).speed, 112);
  assert.equal(effectiveDamageMultiplier(renewed.units.a), 1.24);
  assert.equal(renewed.units.a.statuses.find(status => status.statusId === omikaneIds.talisman).stacks, 12);

  const trigger = definition.handlers['turn-end'].handle(createBattleContext(initialized, () => 0),
    { eventId: 'enemy-turn-end', phase: 'turn-end', source, type: 'turn-ended', unitId: 'r' });
  assert.equal(trigger.filter(command => command.type === 'schedule-attack').length, 1);
  const fieldBoundary = definition.handlers['turn-end'].handle(createBattleContext(initialized, () => .4),
    { eventId: 'enemy-turn-end-field-boundary', phase: 'turn-end', source, type: 'turn-ended', unitId: 'r' });
  assert.equal(fieldBoundary.filter(command => command.type === 'schedule-attack').length, 0,
    '狐狩界内40%概率在随机值恰为0.4时不触发');
  const withoutField = { ...initialized, units: { ...initialized.units,
    b: { ...initialized.units.b, statuses: initialized.units.b.statuses.filter(status => status.statusId !== omikaneIds.field) } } };
  const basicBoundary = definition.handlers['turn-end'].handle(createBattleContext(withoutField, () => .05),
    { eventId: 'enemy-turn-end-basic-boundary', phase: 'turn-end', source, type: 'turn-ended', unitId: 'r' });
  assert.equal(basicBoundary.filter(command => command.type === 'schedule-attack').length, 0,
    '结界外5%概率在随机值恰为0.05时不触发');
  const basicSuccess = definition.handlers['turn-end'].handle(createBattleContext(withoutField, () => .049),
    { eventId: 'enemy-turn-end-basic-success', phase: 'turn-end', source, type: 'turn-ended', unitId: 'r' });
  assert.equal(basicSuccess.filter(command => command.type === 'schedule-attack').length, 1,
    '结界外随机值低于0.05时触发');
  const allyTurn = definition.handlers['turn-end'].handle(createBattleContext(initialized, () => 0),
    { eventId: 'ally-turn-end', phase: 'turn-end', source, type: 'turn-ended', unitId: 'a' });
  assert.equal(allyTurn.filter(command => command.type === 'schedule-attack').length, 0,
    '友方回合结束不触发封魔箭');
  const resolved = applyEffectCommands(initialized, trigger, 'effect-resolution', 'omikane-arrow', resolveStatus);
  assert.ok(resolved.events.some(event => event.type === 'damage' && event.source.id === omikaneIds.sealedArrow
    && event.suppressTargetSoulTriggers && event.suppressTargetPassiveTriggers));
  assert.ok(resolved.state.units.r.statuses.some(status => status.statusId === omikaneIds.silence));
  assert.ok(resolved.state.units.r.statuses.some(status => status.statusId === omikaneIds.healingReduction));
  assert.ok(resolved.state.units.r.statuses.some(status => status.statusId === 'core.passive-suppression'));
  assert.ok(resolved.state.units.r.statuses.some(status => status.statusId === 'core.soul-suppression'));

  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'hero:2:hit', phase: 'hit', priority: 1, handle: () => [
    { type: 'change-resource', source, side: 'blue', resourceId: 'fire', amount: 9 }] });
  dispatcher.register({ id: 'hero:304:hit', phase: 'hit', priority: 1, handle: (_context, event) =>
    event.type === 'damage' && event.source.id === omikaneIds.sealedArrow
      ? [{ type: 'change-resource', source, side: 'blue', resourceId: 'fire', amount: 1 }] : [] });
  const arrowDamage = resolved.events.find(event => event.type === 'damage' && event.source.id === omikaneIds.sealedArrow);
  const settled = settleEvents(resolved.state, [arrowDamage], dispatcher, () => 0);
  assert.equal(settled.state.resources.blue.fire, 1);

  const expired = definition.handlers['status-expiration'].handle(createBattleContext(initialized),
    { eventId: 'field-expired', phase: 'status-expiration', source: { kind: 'skill', id: omikaneIds.foxHunt, unitId: 'b' },
      type: 'status-removed', targetId: 'b', instanceId: 'field', statusId: omikaneIds.field, reason: 'expired' });
  const cleared = applyEffectCommands(initialized, expired, 'status-expiration', 'omikane-expiry', resolveStatus).state;
  assert.equal(cleared.units.a.statuses.some(status => status.statusId === omikaneIds.talisman), false);

  const withFire = { ...initialized, resources: { ...initialized.resources, blue: { ...initialized.resources.blue, fire: 3 } } };
  const ultimate = executeAction(withFire, { actorId: 'b', skillId: omikaneIds.spiritArrow, targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .5);
  assert.equal(ultimate.accepted, true);
  assert.equal(ultimate.state.resources.blue.fire, 0);
  assert.equal(ultimate.state.units.a.statuses.some(status => status.statusId === omikaneIds.talisman), false);
  assert.ok(ultimate.events.some(event => event.type === 'damage' && event.source.id === omikaneIds.spiritArrow));
});

test('不知火自动濒死转离殇回满生命并清除负面，封印时不触发；手动进入也回满生命', () => {
  const registry = new ContentRegistry();
  registerShiranui(registry);
  registry.registerStatus(passiveSuppressionStatusDefinition);
  registry.registerStatus({ id: 'test.shiranui-debuff', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const attackerId = 999;
  registry.registerHero({ id: attackerId,
    skills: [{ id: 'test.lethal', actionKind: 'basic', target: 'single', targetRelation: 'enemy', levels: [{}],
      execute(_context, intent) { return [{ type: 'deal-damage', source: { kind: 'skill', id: 'test.lethal', unitId: intent.actorId },
        targetId: intent.targetIds[0], amount: 5000 }]; } }],
    policy(_context, actorId) { return { actorId, skillId: 'test.lethal', targetIds: ['b'], shape: 'single', targetRelation: 'enemy' }; },
  });
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: shiranuiIds.hero, hp: 300,
    stats: { ...initial.units.b.stats, hp: 1000 }, skillLevel: 5, skillLevels: { [shiranuiIds.passive]: 5 },
    statuses: [{ instanceId: 'test.debuff', statusId: 'test.shiranui-debuff',
      source: { kind: 'skill', id: 'test.debuff', unitId: 'r' }, stacks: 1,
      duration: { kind: 'count', remaining: 2, owner: 'target-turn' } }] };
  initial.units.r = { ...initial.units.r, heroId: attackerId, stats: { ...initial.units.r.stats, speed: 200, attack: 5000 } };
  const fatal = runBattle(initial, registry, { seed: 3, actionLimit: 1, captureEvents: true });
  assert.equal(fatal.state.units.b.hp, 1000, 'automatic form entry restores the full HP bar');
  assert.ok(fatal.state.units.b.statuses.some(status => status.statusId === shiranuiIds.mourning));
  assert.ok(!fatal.state.units.b.statuses.some(status => status.statusId === 'test.shiranui-debuff'));
  assert.ok(!fatal.state.units.b.statuses.some(status => status.statusId === shiranuiIds.fatalTransition));
  assert.ok(!fatal.events.some(event => event.type === 'unit-defeated' && event.unitId === 'b'));
  assert.ok(!fatal.events.some(event => event.type === 'action-scheduled' && event.intent.skillId === shiranuiIds.eternalNight),
    'the passive transition does not use the manual cast free ultimate');

  const sealed = state();
  sealed.units.b = { ...initial.units.b, hp: 300, statuses: [{ instanceId: 'passive-seal', statusId: passiveSuppressionStatusId,
    source: { kind: 'skill', id: 'passive.seal', unitId: 'r' }, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }] };
  sealed.units.r = initial.units.r;
  const sealedBattle = runBattle(sealed, registry, { seed: 3, actionLimit: 1, captureEvents: true });
  assert.equal(sealedBattle.state.units.b.hp, 0, 'passive suppression disables the lethal transition');

  const suppressedDamageState = state();
  suppressedDamageState.units.b = { ...initial.units.b, hp: 300, statuses: [{ instanceId: 'fatal-ready',
    statusId: shiranuiIds.fatalTransition, source: { kind: 'skill', id: shiranuiIds.passive, unitId: 'b' },
    stacks: 1, duration: { kind: 'permanent' } }] };
  const suppressedDamage = applyEffectCommands(suppressedDamageState, [{ type: 'deal-damage',
    source: { kind: 'skill', id: 'test.suppressive', unitId: 'r' }, targetId: 'b', amount: 5000,
    suppressTargetPassiveTriggers: true }], 'hit', 'shiranui-suppressed-hit', id => registry.getStatus(id));
  assert.equal(suppressedDamage.state.units.b.hp, 0, 'target-passive suppression also disables the lethal transition');
  assert.equal(suppressedDamage.events.find(event => event.type === 'damage').fatalProtectionStatusId, undefined);

  const manual = state();
  manual.units.b = { ...initial.units.b, hp: 400, statuses: [...initial.units.b.statuses,
    { instanceId: 'fatal-ready', statusId: shiranuiIds.fatalTransition,
      source: { kind: 'skill', id: shiranuiIds.passive, unitId: 'b' }, stacks: 1, duration: { kind: 'permanent' } }] };
  const transformed = executeAction(manual, { actorId: 'b', skillId: shiranuiIds.passive, targetIds: ['b'],
    shape: 'self', targetRelation: 'ally' }, registry, () => .5, { resolveStatus: id => registry.getStatus(id) });
  assert.equal(transformed.state.units.b.hp, 1000, 'manual entry also restores full HP');
  assert.ok(transformed.state.units.b.statuses.some(status => status.statusId === shiranuiIds.mourning));
  assert.ok(!transformed.state.units.b.statuses.some(status => status.statusId === 'test.shiranui-debuff'
    || status.statusId === shiranuiIds.fatalTransition));
  assert.ok(transformed.events.some(event => event.type === 'action-scheduled' && event.intent.skillId === shiranuiIds.eternalNight),
    'manual entry schedules the free ultimate');
  assert.equal(effectiveStats(transformed.state.units.b).crit, effectiveStats(initial.units.b).crit + .3,
    '离殇姿态按客户端buff 33001提高30%暴击');
});

test('不知火离殇在每个单位回合结束回复已损生命40%，自身回合末再失去生命上限15%', () => {
  const registry = new ContentRegistry(); registerShiranui(registry);
  const definition = registry.getHero(shiranuiIds.hero);
  const initial = state();
  const mourning = { instanceId: 'mourning', statusId: shiranuiIds.mourning,
    source: { kind: 'skill', id: shiranuiIds.passive, unitId: 'b' }, stacks: 1,
    duration: { kind: 'permanent' }, modifiers: [{ stat: 'crit', operation: 'flat', amount: .3 }] };
  initial.units.b = { ...initial.units.b, heroId: shiranuiIds.hero, hp: 500,
    stats: { ...initial.units.b.stats, hp: 1000 }, statuses: [mourning] };
  const enemyTurn = definition.handlers['turn-end'].handle(createBattleContext(initial),
    { eventId: 'enemy-round-end', phase: 'turn-end', source: { kind: 'system', id: 'round' }, type: 'turn-ended', unitId: 'r' });
  assert.equal(enemyTurn.length, 1);
  assert.equal(enemyTurn[0].type, 'heal');
  assert.equal(enemyTurn[0].amount, 200);
  const afterEnemyTurn = applyEffectCommands(initial, enemyTurn, 'effect-resolution', 'mourning-enemy-turn').state;
  assert.equal(afterEnemyTurn.units.b.hp, 700);

  const ownTurn = definition.handlers['turn-end'].handle(createBattleContext(initial),
    { eventId: 'shiranui-round-end', phase: 'turn-end', source: { kind: 'system', id: 'round' }, type: 'turn-ended', unitId: 'b' });
  assert.deepEqual(ownTurn.map(command => command.type), ['heal', 'lose-life']);
  assert.equal(ownTurn[0].amount, 200);
  assert.equal(ownTurn[1].amount, 150);
  const afterOwnTurn = applyEffectCommands(initial, ownTurn, 'effect-resolution', 'mourning-own-turn').state;
  assert.equal(afterOwnTurn.units.b.hp, 550);
});

test('不知火离殇攻击施加离火，下一次攻击同目标双倍伤害并消耗离火', () => {
  const registry = new ContentRegistry(); registerShiranui(registry);
  const definition = registry.getHero(shiranuiIds.hero);
  const initial = state();
  const mourning = { instanceId: 'mourning', statusId: shiranuiIds.mourning,
    source: { kind: 'skill', id: shiranuiIds.passive, unitId: 'b' }, stacks: 1, duration: { kind: 'permanent' } };
  initial.units.b = { ...initial.units.b, heroId: shiranuiIds.hero, statuses: [mourning] };
  const attackEnd = { eventId: 'mourning-first-attack', phase: 'attack-end',
    source: { kind: 'skill', id: shiranuiIds.basic, unitId: 'b' }, type: 'attack-ended', hitCount: 2,
    actionKind: 'basic', targetHealthChanges: [{ targetId: 'r', hpBefore: 10000, hpAfter: 9000, hpLost: 1000 }] };
  const appliedMark = definition.handlers['attack-end'].handle(createBattleContext(initial), attackEnd);
  assert.equal(appliedMark[0].type, 'add-status');
  const marked = applyEffectCommands(initial, appliedMark, 'effect-resolution', 'lihuo-mark').state;
  assert.equal(definition.modifyOutgoingDamage(marked.units.b, marked.units.r, 100, 'normal', marked), 200);

  const consumeMark = definition.handlers['attack-end'].handle(createBattleContext(marked),
    { ...attackEnd, eventId: 'mourning-second-attack' });
  assert.equal(consumeMark[0].type, 'remove-status-instances');
  const consumed = applyEffectCommands(marked, consumeMark, 'effect-resolution', 'lihuo-consumed').state;
  assert.equal(consumed.units.r.statuses.some(status => status.statusId === shiranuiIds.liHuo), false);
  assert.equal(definition.modifyOutgoingDamage(consumed.units.b, consumed.units.r, 100, 'normal', consumed), 100);
});

test('不知火星火结界按满级先机覆盖非召唤友方并提供速度、增伤和减伤', () => {
  const initial = state();
  initial.resources.blue.fire = 4;
  initial.units.b = { ...initial.units.b, heroId: shiranuiIds.hero, skillLevel: 5,
    skillLevels: { [shiranuiIds.basic]: 5, [shiranuiIds.passive]: 5, [shiranuiIds.starfire]: 5 } };
  initial.units.a = unit('a', 'blue');
  initial.units.summon = { ...unit('summon', 'blue'), unitKind: 'summon' };
  initial.sides.blue = ['b', 'a', 'summon'];
  const registry = new ContentRegistry(); registerShiranui(registry);
  const definition = registry.getHero(shiranuiIds.hero);
  const commands = definition.initialize(createBattleContext(initial), 'b');
  const opened = applyEffectCommands(initial, commands, 'effect-resolution', 'shiranui-initialize', id => registry.getStatus(id)).state;
  assert.ok(opened.units.b.statuses.some(status => status.statusId === shiranuiIds.field));
  assert.ok(opened.units.a.statuses.some(status => status.statusId === shiranuiIds.field));
  assert.ok(!opened.units.summon.statuses.some(status => status.statusId === shiranuiIds.field));
  assert.equal(effectiveStats(opened.units.a).speed, 125);
  assert.ok(Math.abs(effectiveDamageMultiplier(opened.units.a, opened.resources.blue) - 1.18) < 1e-10);
  assert.ok(Math.abs(effectiveDamageTakenMultiplier(opened.units.a, opened.resources.blue) - .82) < 1e-10);
  assert.ok(Math.abs(effectiveDamageMultiplier(opened.units.a, { fire: 0 }) - 1.1) < 1e-10,
    '耗尽鬼火后保留基础10%增伤');
  assert.ok(Math.abs(effectiveDamageTakenMultiplier(opened.units.a, { fire: 0 }) - .9) < 1e-10,
    '耗尽鬼火后保留基础10%减伤');
  assert.equal(opened.units.a.statuses.find(status => status.statusId === shiranuiIds.field).modifiers[0].perResource.amount, .02);
});

test('不知火普攻双段，友方普攻触发结界协战，回合末起舞支付生命并给抵抗', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: shiranuiIds.hero, skillLevel: 5,
    skillLevels: { [shiranuiIds.basic]: 5, [shiranuiIds.passive]: 5, [shiranuiIds.starfire]: 4 } };
  initial.units.a = unit('a', 'blue');
  initial.sides.blue = ['b', 'a'];
  const registry = new ContentRegistry(); registerShiranui(registry);
  const definition = registry.getHero(shiranuiIds.hero);
  const source = { kind: 'skill', id: shiranuiIds.starfire, unitId: 'b' };
  const opened = applyEffectCommands(initial, definition.skills.find(skill => skill.id === shiranuiIds.starfire)
    .execute(createBattleContext(initial), { actorId: 'b', skillId: shiranuiIds.starfire, targetIds: ['b'], shape: 'self' }, {}),
  'effect-resolution', 'shiranui-open', id => registry.getStatus(id)).state;
  const actionEnd = { eventId: 'ally-basic', phase: 'action-end', source: { kind: 'skill', id: 'ally-basic', unitId: 'a' },
    type: 'action-ended', actionKind: 'basic', skillId: 'ally-basic', soulTriggersAllowed: true,
    intent: { actorId: 'a', skillId: 'ally-basic', targetIds: ['r'], shape: 'single' } };
  const follow = definition.handlers['action-end'].handle(createBattleContext(opened), actionEnd);
  assert.equal(follow.length, 1);
  const interrupted = definition.handlers['action-validation'].handle(createBattleContext(opened),
    { eventId: 'ally-interrupted', phase: 'action-validation', source, type: 'action-skipped', actorId: 'a', reason: 'interrupted' });
  assert.equal(interrupted.length, 1);
  const attackEnd = { eventId: 'ally-attack-end', phase: 'attack-end', source: actionEnd.source, type: 'attack-ended',
    hitCount: 1, actionKind: 'basic', targetHealthChanges: [{ targetId: 'r', hpBefore: 10000, hpAfter: 9000, hpLost: 1000 }] };
  const assist = definition.handlers['attack-end'].handle(createBattleContext(opened, () => .1), attackEnd);
  assert.equal(assist[0].type, 'schedule-attack');
  assert.equal(assist[0].hits.length, 2);
  assert.equal(assist[0].suppressSourcePassiveTriggers, true);
  const marked = applyEffectCommands(opened, follow, 'effect-resolution', 'shiranui-dance-mark', id => registry.getStatus(id)).state;
  const danced = definition.handlers['turn-end'].handle(createBattleContext(marked, () => .99, id => registry.getStatus(id)?.category),
    { eventId: 'ally-turn-end', phase: 'turn-end', source, type: 'turn-ended', unitId: 'a' });
  assert.ok(danced.some(command => command.type === 'lose-life' && command.targetId === 'b' && command.amount === 500));
  const applied = applyEffectCommands(marked, danced, 'effect-resolution', 'shiranui-dance', id => registry.getStatus(id)).state;
  assert.ok(applied.units.a.statuses.some(status => status.statusId === shiranuiIds.resist
    && status.modifiers[0].amount === .8));
});

test('不知火五级离歌在烬染不夜结束后按剩余鬼火随机追击', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: shiranuiIds.hero, skillLevel: 5,
    skillLevels: { [shiranuiIds.elegy]: 5 }, statuses: [{ instanceId: 'elegy', statusId: shiranuiIds.elegyBuff,
      source: { kind: 'skill', id: shiranuiIds.elegy, unitId: 'b' }, stacks: 1, duration: { kind: 'permanent' } }] };
  initial.units.r2 = { ...unit('r2', 'red'), hp: 10000 };
  initial.sides.red = ['r', 'r2'];
  initial.resources.blue.fire = 2;
  const registry = new ContentRegistry(); registerShiranui(registry);
  const definition = registry.getHero(shiranuiIds.hero);
  const attacks = definition.handlers['action-end'].handle(createBattleContext(initial, () => .75),
    { eventId: 'night-end', phase: 'action-end', source: { kind: 'skill', id: shiranuiIds.eternalNight, unitId: 'b' },
      type: 'action-ended', actionKind: 'skill', skillId: shiranuiIds.eternalNight, soulTriggersAllowed: true });
  assert.equal(attacks.length, 2);
  assert.ok(attacks.every(command => command.type === 'schedule-attack' && command.hits[0].amount > 0));
  assert.ok(attacks.every(command => command.suppressSourcePassiveTriggers === true));
});

test('初翎山风迅风初始行动值、双段伤害、生命差增伤与控制解除推条按技能等级结算', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: firstHaneMountainWindIds.hero, skillLevel: 5,
    skillLevels: { [firstHaneMountainWindIds.basic]: 5, [firstHaneMountainWindIds.passive]: 5,
      [firstHaneMountainWindIds.ultimate]: 5 } };
  initial.units.r = { ...initial.units.r, hp: 5000 };
  const registry = new ContentRegistry();
  registry.registerStatus(passiveSuppressionStatusDefinition); registry.registerStatus(soulSuppressionStatusDefinition);
  registerFirstHaneMountainWind(registry);
  const definition = registry.getHero(firstHaneMountainWindIds.hero);
  const initialized = applyEffectCommands(initial, definition.initialize(createBattleContext(initial), 'b'),
    'effect-resolution', 'shanfeng-initialize', id => registry.getStatus(id)).state;
  assert.equal(initialized.units.b.statuses.find(status => status.statusId === firstHaneMountainWindIds.swiftWind).stacks, 20);
  assert.equal(initialized.units.b.actionGauge, 20);
  assert.equal(definition.modifyOutgoingDamage(initialized.units.b, initialized.units.r, 1000, 'normal', initialized), 1250);

  const basic = executeAction(initialized, { actorId: 'b', skillId: firstHaneMountainWindIds.basic, targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .5);
  const hits = basic.events.filter(event => event.type === 'damage' && event.source.id === firstHaneMountainWindIds.basic);
  assert.equal(hits.length, 2);
  assert.ok(hits.every(event => event.amount > 0));

  const ultimateState = { ...initialized, resources: { ...initialized.resources, blue: { fire: 6 } },
    units: { ...initialized.units, b: { ...initialized.units.b, stats: { ...initialized.units.b.stats, attack: 1000 } },
      r: { ...initialized.units.r, hp: 10000 } } };
  const ultimate = executeAction(ultimateState, { actorId: 'b', skillId: firstHaneMountainWindIds.ultimate,
    targetIds: ['r'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .5);
  assert.equal(ultimate.events.filter(event => event.type === 'damage' && event.source.id === firstHaneMountainWindIds.ultimate).length, 4);
  assert.equal(ultimate.state.resources.blue.fire, 3);

  const controlled = { ...initialized.units.b, statuses: [...initialized.units.b.statuses,
    { instanceId: 'test-control', statusId: 'test-control', source, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }] };
  const current = { ...initialized, units: { ...initialized.units, b: controlled } };
  const recovery = definition.handlers['effect-resolution'].handle(createBattleContext(current, () => .5,
    id => id === 'test-control' ? 'control' : registry.getStatus(id)?.category),
  { eventId: 'control-ended', phase: 'effect-resolution', source, type: 'status-removed', targetId: 'b',
    instanceId: 'test-control', statusId: 'test-control', statusCategory: 'control', reason: 'dispelled' });
  assert.ok(recovery.some(command => command.type === 'change-action-gauge' && command.amount === 50));
  assert.ok(recovery.some(command => command.type === 'remove-status-instances'
    && command.instanceIds.includes(initialized.units.b.statuses.find(status => status.statusId === firstHaneMountainWindIds.swiftWind).instanceId)));
});

test('初翎山风回合开始快照迅风暴伤，猎目减益通过效果抵抗判定', () => {
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: firstHaneMountainWindIds.hero, skillLevel: 5,
    skillLevels: { [firstHaneMountainWindIds.passive]: 3 }, stats: { ...initial.units.b.stats, critDamage: 1.5 },
    statuses: [{ instanceId: `${firstHaneMountainWindIds.swiftWind}:b`, statusId: firstHaneMountainWindIds.swiftWind,
      source: { kind: 'skill', id: firstHaneMountainWindIds.passive, unitId: 'b' }, stacks: 30,
      duration: { kind: 'permanent' } }] };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, resist: .5 } };
  const registry = new ContentRegistry(); registerFirstHaneMountainWind(registry);
  const definition = registry.getHero(firstHaneMountainWindIds.hero), resolveStatus = id => registry.getStatus(id);
  const snapshot = definition.handlers['turn-start'].handle(createBattleContext(initial),
    { eventId: 'first-hane-snapshot', phase: 'turn-start', source, type: 'turn-started', unitId: 'b' });
  initial = applyEffectCommands(initial, snapshot, 'effect-resolution', 'first-hane-snapshot', resolveStatus).state;
  assert.equal(initial.units.b.statuses.find(status => status.statusId === firstHaneMountainWindIds.turnWind)
    .values.swiftPoints, 30);
  assert.ok(Math.abs(effectiveStats(initial.units.b).critDamage - 1.95) < 1e-10);
  const moreWind = { ...initial.units.b, statuses: initial.units.b.statuses.map(status => status.statusId === firstHaneMountainWindIds.swiftWind
    ? { ...status, stacks: 40 } : status) };
  assert.ok(Math.abs(effectiveStats(moreWind).critDamage - 1.95) < 1e-10, '回合中的新迅风不改写已形成的快照');

  const mark = definition.skills.find(skill => skill.id === firstHaneMountainWindIds.mark);
  const resisted = mark.execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: firstHaneMountainWindIds.mark,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, {});
  assert.ok(resisted.some(command => command.type === 'report-status-resisted'));
  const applied = mark.execute(createBattleContext(initial, () => .49), { actorId: 'b', skillId: firstHaneMountainWindIds.mark,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, {});
  assert.ok(applied.some(command => command.type === 'add-status' && command.instance.statusId === firstHaneMountainWindIds.hunterMark));
});

test('初翎山风迅·庇羽护盾不可驱散且破裂时同步失去暴击抵抗', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: firstHaneMountainWindIds.hero, skillLevel: 5,
    skillLevels: { [firstHaneMountainWindIds.passive]: 5 } };
  initial.units.a = { ...unit('a', 'blue'), hp: 10000 };
  initial.sides.blue = ['b', 'a'];
  const registry = new ContentRegistry(); registerFirstHaneMountainWind(registry);
  const definition = registry.getHero(firstHaneMountainWindIds.hero);
  const shieldSkill = definition.skills.find(skill => skill.id === firstHaneMountainWindIds.shield);
  const commands = shieldSkill.execute(createBattleContext(initial), { actorId: 'b', skillId: firstHaneMountainWindIds.shield,
    targetIds: ['a'], shape: 'single', targetRelation: 'ally' }, {});
  const shielded = applyEffectCommands(initial, commands, 'effect-resolution', 'shan-shield', id => registry.getStatus(id)).state;
  const shield = shielded.units.a.statuses.find(status => status.statusId === firstHaneMountainWindIds.allyShield);
  assert.equal(shield.values.shieldRemaining, 3750);
  assert.equal(registry.getStatus(firstHaneMountainWindIds.allyShield).dispellable, false);
  assert.equal(require(path + 'mechanics/stats.js').effectiveCritResist(shielded.units.a), 1);
  const endHit = definition.handlers.hit.handle(createBattleContext({ ...shielded,
    units: { ...shielded.units, a: { ...shielded.units.a, statuses: shielded.units.a.statuses.map(status =>
      status.statusId === firstHaneMountainWindIds.allyShield ? { ...status, values: { shieldRemaining: 0 } } : status) } } }),
  { eventId: 'shield-break', phase: 'hit', source, type: 'damage', targetId: 'a', damageKind: 'normal', amount: 4000,
    hpLost: 250, mitigated: 3750, isCritical: false });
  assert.ok(endHit.some(command => command.type === 'remove-status-instances' && command.targetId === 'a'));
});

test('初翎山风二级群攻减伤、猎目减益、击空封印和四级受暴击推条均有独立触发', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: firstHaneMountainWindIds.hero, skillLevel: 5,
    skillLevels: { [firstHaneMountainWindIds.passive]: 4, [firstHaneMountainWindIds.mark]: 1,
      [firstHaneMountainWindIds.lift]: 1 } };
  initial.units.r = { ...initial.units.r, side: 'red', stats: { ...initial.units.r.stats, defense: 1000, speed: 200 } };
  initial.units.r2 = { ...unit('r2', 'red'), stats: { ...unit('r2', 'red').stats, attack: 1000, defense: 500, speed: 150 } };
  initial.sides.red.push('r2');
  const registry = new ContentRegistry(); registry.registerStatus(passiveSuppressionStatusDefinition);
  registry.registerStatus(soulSuppressionStatusDefinition); registerFirstHaneMountainWind(registry);
  const definition = registry.getHero(firstHaneMountainWindIds.hero);
  const intercepted = definition.interceptIncomingDamage(initial, initial.units.r, initial.units.b, 1000, 'normal',
    { attackId: 1, hitIndex: 0, targetIds: ['b', 'a'], attackShape: 'all-enemies', battle: createBattleContext(initial),
      isUnitUnableToAct: () => false });
  assert.equal(intercepted.amount, 500);
  const mark = definition.skills.find(skill => skill.id === firstHaneMountainWindIds.mark)
    .execute(createBattleContext(initial, () => 0), { actorId: 'b', skillId: firstHaneMountainWindIds.mark,
      targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, {});
  assert.ok(mark.some(command => command.type === 'add-status' && command.instance.statusId === firstHaneMountainWindIds.hunterMark
    && command.instance.duration.remaining === 2 && command.instance.duration.owner === 'target-turn'
    && ['attack', 'speed', 'defense'].every(stat => command.instance.modifiers.some(modifier => modifier.stat === stat && modifier.amount === -.35))));
  const resolveStatus = id => registry.getStatus(id);
  const marked = applyEffectCommands(initial, mark, 'effect-resolution', 'shan-mark-first', resolveStatus).state;
  assert.equal(effectiveStats(marked.units.r).attack, 3250);
  assert.equal(effectiveStats(marked.units.r).speed, 130);
  assert.equal(effectiveStats(marked.units.r).defense, 650);
  const retargetedCommands = definition.skills.find(skill => skill.id === firstHaneMountainWindIds.mark)
    .execute(createBattleContext(marked, () => 0), { actorId: 'b', skillId: firstHaneMountainWindIds.mark,
      targetIds: ['r2'], shape: 'single', targetRelation: 'enemy' }, {});
  const retargeted = applyEffectCommands(marked, retargetedCommands, 'effect-resolution', 'shan-mark-retarget', resolveStatus).state;
  assert.equal(retargeted.units.r.statuses.some(status => status.statusId === firstHaneMountainWindIds.hunterMark), false,
    '迅风改盯新目标时移除旧目标标记');
  assert.equal(effectiveStats(retargeted.units.r2).attack, 650);
  assert.equal(effectiveStats(retargeted.units.r2).speed, 97.5);
  assert.equal(effectiveStats(retargeted.units.r2).defense, 325);
  const lift = definition.skills.find(skill => skill.id === firstHaneMountainWindIds.lift)
    .execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: firstHaneMountainWindIds.lift,
      targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, {});
  assert.ok(lift.some(command => command.type === 'add-status' && command.instance.statusId === passiveSuppressionStatusId));
  assert.ok(lift.some(command => command.type === 'add-status' && command.instance.statusId === soulSuppressionStatusId));
  const liftState = applyEffectCommands(initial, lift, 'effect-resolution', 'shan-lift', id => registry.getStatus(id)).state;
  assert.equal(liftState.units.b.statuses.find(status => status.statusId === firstHaneMountainWindIds.swiftWind).stacks, 40);
  assert.equal(liftState.units.b.actionGauge, 40);
  const critTrigger = definition.handlers.hit.handle(createBattleContext(initial), { eventId: 'ally-critical', phase: 'hit',
    source: { kind: 'skill', id: 'enemy-basic', unitId: 'r' }, type: 'damage', targetId: 'b', damageKind: 'normal',
    amount: 1000, hpLost: 1000, mitigated: 0, isCritical: true, attackId: 9 });
  assert.ok(critTrigger.some(command => command.type === 'change-action-gauge' && command.amount === 10));
});

test('初翎山风自动决策遵循迅风阈值、危急护盾与低血量集火', () => {
  const registry = new ContentRegistry(); registerFirstHaneMountainWind(registry);
  const definition = registry.getHero(firstHaneMountainWindIds.hero);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: firstHaneMountainWindIds.hero };
  initial.units.friend = { ...unit('friend', 'blue'), hp: 2500,
    stats: { ...unit('friend', 'blue').stats, hp: 10000 } };
  initial.sides.blue.push('friend');
  initial.units.r = { ...initial.units.r, hp: 1000,
    stats: { ...initial.units.r.stats, hp: 10000 } };
  initial.units.r2 = { ...unit('r2', 'red'), stats: { ...unit('r2', 'red').stats, speed: 999 } };
  initial.sides.red.push('r2');

  let policy = definition.policy(createBattleContext(initial), 'b');
  assert.equal(policy.skillId, firstHaneMountainWindIds.mark);
  assert.deepEqual(policy.targetIds, ['r'], '猎目优先压制生命低于20%的目标');

  initial.units.b = { ...initial.units.b, statuses: [{ instanceId: 'swift-79',
    statusId: firstHaneMountainWindIds.swiftWind, source: { kind: 'skill', id: firstHaneMountainWindIds.passive, unitId: 'b' },
    stacks: 79, duration: { kind: 'permanent' } }] };
  policy = definition.policy(createBattleContext(initial), 'b');
  assert.equal(policy.skillId, firstHaneMountainWindIds.mark, '迅风未达80时不使用击空');

  initial.units.b = { ...initial.units.b, statuses: [{ instanceId: 'swift-80',
    statusId: firstHaneMountainWindIds.swiftWind, source: { kind: 'skill', id: firstHaneMountainWindIds.passive, unitId: 'b' },
    stacks: 80, duration: { kind: 'permanent' } }] };
  policy = definition.policy(createBattleContext(initial), 'b');
  assert.equal(policy.skillId, firstHaneMountainWindIds.lift);
  assert.deepEqual(policy.targetIds, ['r']);

  initial.units.b = { ...initial.units.b, statuses: [] };
  initial.units.r = { ...initial.units.r, hp: 5000 };
  initial.units.friend = { ...initial.units.friend, hp: 1900 };
  policy = definition.policy(createBattleContext(initial), 'b');
  assert.equal(policy.skillId, firstHaneMountainWindIds.shield, '友方低于20%时优先庇羽');
  assert.deepEqual(policy.targetIds, ['friend']);
  initial.units.friend = { ...initial.units.friend, hp: 2000 };
  policy = definition.policy(createBattleContext(initial), 'b');
  assert.notEqual(policy.skillId, firstHaneMountainWindIds.shield, '友方恰为20%时不提前消耗庇羽');
});

test('鬼使白普攻减疗、鬼手毒层与夺命回合末间接伤害按技能触发', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: ghostServantWhiteIds.hero, skillLevel: 5, stats: { ...initial.units.b.stats, attack: 1000 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, resist: 0 }, hp: 10000 };
  const registry = new ContentRegistry(); registerGhostServantWhite(registry);
  const definition = registry.getHero(ghostServantWhiteIds.hero), resolveStatus = id => registry.getStatus(id);
  const healReduction = definition.handlers.hit.handle(createBattleContext(initial, () => 0),
    { eventId: 'white-basic-hit', phase: 'hit', source: { kind: 'skill', id: ghostServantWhiteIds.basic, unitId: 'b' },
      type: 'damage', targetId: 'r', damageKind: 'normal', amount: 1000, hpLost: 1000, mitigated: 0, isCritical: false });
  const reduced = applyEffectCommands(initial, healReduction, 'effect-resolution', 'white-heal-reduction', resolveStatus).state;
  assert.equal(reduced.units.r.statuses.find(status => status.statusId === ghostServantWhiteIds.healingReduction).modifiers[0].amount, -.4);

  let poisoned = initial;
  for (let hit = 1; hit <= 3; hit++) {
    const commands = definition.handlers.hit.handle(createBattleContext(poisoned, () => 0),
      { eventId: `white-poison-hit-${hit}`, phase: 'hit', source: { kind: 'skill', id: ghostServantWhiteIds.ultimate, unitId: 'b' },
        type: 'damage', targetId: 'r', damageKind: 'normal', amount: 320, hpLost: 320, mitigated: 0, isCritical: false });
    poisoned = applyEffectCommands(poisoned, commands, 'effect-resolution', `white-poison-${hit}`, resolveStatus).state;
  }
  const poison = poisoned.units.r.statuses.find(status => status.statusId === ghostServantWhiteIds.poison);
  assert.equal(poison.stacks, 3);
  assert.equal(effectiveStats(poisoned.units.r).speed, 70);
  assert.equal(effectiveStats(poisoned.units.r).defense, 0);

  const markCommands = definition.handlers['action-end'].handle(createBattleContext(initial),
    { eventId: 'white-ultimate-end', phase: 'action-end', source: { kind: 'skill', id: ghostServantWhiteIds.ultimate, unitId: 'b' },
      type: 'action-ended', actionKind: 'skill', skillId: ghostServantWhiteIds.ultimate, soulTriggersAllowed: true,
      intent: { actorId: 'b', skillId: ghostServantWhiteIds.ultimate, targetIds: ['r'], shape: 'all-enemies', targetRelation: 'enemy' } });
  const marked = applyEffectCommands(initial, markCommands, 'effect-resolution', 'white-death-mark', resolveStatus).state;
  const mark = marked.units.r.statuses.find(status => status.statusId === ghostServantWhiteIds.deathMark);
  assert.equal(mark.values.ratio, 1.82);
  const tick = definition.handlers['turn-end'].handle(createBattleContext(marked),
    { eventId: 'white-target-turn-end', phase: 'turn-end', source, type: 'turn-ended', unitId: 'r' });
  const damaged = applyEffectCommands(marked, tick, 'effect-resolution', 'white-death-mark-tick', resolveStatus);
  assert.equal(damaged.state.units.r.hp, 8180);
  assert.ok(damaged.events.some(event => event.type === 'life-lost' && event.lifeLossKind === 'indirect'));
});

test('鬼使白魂狩按阵亡非召唤物空位召唤小鬼，禁止该阵亡单位复活，小鬼出手后牺牲', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: ghostServantWhiteIds.hero, skillLevel: 5, skillLevels: { [ghostServantWhiteIds.spiritHunt]: 5 },
    stats: { ...initial.units.b.stats, hp: 10000, attack: 2000 } };
  initial.units.r.hp = 0;
  initial.units.r2 = { ...unit('r2', 'red'), stats: { ...unit('r2', 'red').stats, hp: 10000, attack: 10 } };
  initial.sides.red.push('r2');
  initial.resources.blue.fire = 1;
  const registry = new ContentRegistry(); registerGhostServantWhite(registry);
  const definition = registry.getHero(ghostServantWhiteIds.hero), resolveStatus = id => registry.getStatus(id);
  assert.equal(definition.skills.find(skill => skill.id === ghostServantWhiteIds.spiritHunt).canUse(initial, initial.units.b), true);
  const summonAction = executeAction(initial, { actorId: 'b', skillId: ghostServantWhiteIds.spiritHunt,
    targetIds: ['b'], shape: 'self', targetRelation: 'ally' }, registry, () => 0, { resolveStatus });
  assert.equal(summonAction.accepted, true);
  assert.equal(summonAction.state.resources.blue.fire, 0);
  const summoned = summonAction.state;
  const imp = Object.values(summoned.units).find(unit => unit.displayName === '白色小鬼');
  assert.equal(imp.stats.hp, 3000);
  assert.equal(imp.stats.attack, 1800);
  const blocked = applyEffectCommands(summoned, [{ type: 'revive', source, targetId: 'r', hp: 1000 }],
    'effect-resolution', 'white-revive-blocked', resolveStatus);
  assert.equal(blocked.state.units.r.hp, 0);
  assert.ok(blocked.events.some(event => event.type === 'revive-blocked'));
  const attack = definition.skills.find(skill => skill.id === ghostServantWhiteIds.impAttack).execute(createBattleContext(summoned),
    { actorId: imp.unitId, skillId: ghostServantWhiteIds.impAttack, targetIds: ['r2'], shape: 'all-enemies' }, {});
  const resolved = applyEffectCommands(summoned, attack, 'effect-resolution', 'white-imp-attack', resolveStatus);
  assert.equal(resolved.state.units.r2.hp, 8200);
  assert.equal(resolved.state.units[imp.unitId].hp, 0);
  const cleanup = definition.handlers['unit-defeated'].handle(createBattleContext(resolved.state),
    { eventId: 'white-imp-defeated', phase: 'unit-defeated', source: { kind: 'skill', id: ghostServantWhiteIds.impAttack,
      unitId: imp.unitId }, type: 'unit-defeated', unitId: imp.unitId });
  const released = applyEffectCommands(resolved.state, cleanup, 'effect-resolution', 'white-occupancy-cleanup', resolveStatus).state;
  assert.equal(released.units.r.statuses.some(status => status.statusId === ghostServantWhiteIds.blockedRevive), false);
});

test('山童碎岩和崩山读取技能倍率，崩山消耗3火且怪力逐次进行眩晕判定', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: mountainChildIds.hero, skillLevel: 5, stats: { ...initial.units.b.stats,
    attack: 1000, crit: 0 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, defense: 0, resist: 0 }, hp: 10000 };
  initial.resources.blue.fire = 3;
  const registry = new ContentRegistry(); registerMountainChild(registry);
  const definition = registry.getHero(mountainChildIds.hero), resolveStatus = id => registry.getStatus(id);
  const cast = executeAction(initial, { actorId: 'b', skillId: mountainChildIds.ultimate, targetIds: ['r'],
    shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .01, { resolveStatus });
  assert.equal(cast.accepted, true);
  assert.equal(cast.events.filter(event => event.type === 'damage' && event.source.id === mountainChildIds.ultimate).length, 3);
  assert.equal(cast.state.resources.blue.fire, 0);
  let stateAfter = cast.state;
  const damageEvents = cast.events.filter(event => event.type === 'damage' && event.source.id === mountainChildIds.ultimate);
  for (const event of damageEvents) {
    const commands = definition.handlers.hit.handle(createBattleContext(stateAfter, () => .01), event);
    stateAfter = applyEffectCommands(stateAfter, commands, 'effect-resolution', `mountain-stun-${event.eventId}`, resolveStatus).state;
  }
  assert.ok(stateAfter.units.r.statuses.some(status => status.statusId === mountainChildIds.stun));
  assert.equal(registry.getStatus(mountainChildIds.stun).preventsAction, true);

  const sealed = { ...initial, units: { ...initial.units, b: { ...initial.units.b,
    statuses: [{ instanceId: 'seal', statusId: passiveSuppressionStatusId, source, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }] } } };
  assert.equal(definition.handlers.hit.handle(createBattleContext(sealed, () => 0), damageEvents[0]), undefined);
});

test('犬神开局守护低血友方，单体受击后反击并增加攻击、给敌方紧盯', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: inuGodIds.hero, skillLevel: 5, stats: { ...initial.units.b.stats, attack: 1000 } };
  initial.units.a = { ...unit('a', 'blue'), hp: 5000, stats: { ...unit('a', 'blue').stats, attack: 10 } };
  initial.units.r = { ...initial.units.r, heroId: 999, stats: { ...initial.units.r.stats, attack: 100, defense: 0, crit: 0 }, hp: 10000 };
  initial.sides.blue.push('a');
  const registry = new ContentRegistry(); registerInuGod(registry);
  registry.registerHero({ id: 999, skills: [createBasicAttackSkill('enemy.basic', [1])] });
  const definition = registry.getHero(inuGodIds.hero), resolveStatus = id => registry.getStatus(id);
  const initialized = applyEffectCommands(initial, definition.initialize(createBattleContext(initial), 'b'),
    'effect-resolution', 'dog-guardian-start', resolveStatus).state;
  assert.equal(initialized.units.a.statuses.some(status => status.statusId === inuGodIds.guardian), true);
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'hero:220:attack-end', phase: 'attack-end', priority: 30,
    handle: definition.handlers['attack-end'].handle });
  const attack = executeAction(initialized, { actorId: 'r', skillId: 'enemy.basic', targetIds: ['a'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .5, { dispatcher, resolveStatus });
  assert.ok(attack.events.some(event => event.type === 'action-scheduled' && event.scheduling === 'counter'
    && event.intent.actorId === 'b'));
  assert.ok(attack.events.some(event => event.type === 'damage' && event.source.id === inuGodIds.counter));
  assert.ok(attack.state.units.b.statuses.some(status => status.statusId === inuGodIds.attackBonus
    && status.values.totalAttackAdded === 30));
  assert.ok(attack.state.units.r.statuses.some(status => status.statusId === inuGodIds.focus));
});

test('犬神挚友阵亡后获得护盾和推条，挚友之怒强化心剑并降低鬼火消耗', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: inuGodIds.hero, skillLevel: 5, stats: { ...initial.units.b.stats, attack: 1000 },
    statuses: [{ instanceId: 'dog-seal', statusId: passiveSuppressionStatusId, source, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }] };
  initial.units.a = { ...unit('a', 'blue'), hp: 0, statuses: [{ instanceId: 'bond-a', statusId: inuGodIds.bond,
    source: { kind: 'skill', id: inuGodIds.guardSkill, unitId: 'b' }, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { ownerUnitId: 'b' } }] };
  initial.sides.blue.push('a');
  initial.units.b.statuses = initial.units.b.statuses.filter(status => status.statusId !== passiveSuppressionStatusId);
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, hp: 50000, defense: 0, crit: 0 }, hp: 50000 };
  initial.resources.blue.fire = 1;
  const registry = new ContentRegistry(); registerInuGod(registry);
  const definition = registry.getHero(inuGodIds.hero), resolveStatus = id => registry.getStatus(id);
  const defeatCommands = definition.handlers['unit-defeated'].handle(createBattleContext(initial),
    { eventId: 'bond-holder-defeated', phase: 'unit-defeated', source, type: 'unit-defeated', unitId: 'a' });
  const empowered = applyEffectCommands(initial, defeatCommands, 'effect-resolution', 'dog-enter-vengeance', resolveStatus).state;
  assert.equal(empowered.units.b.actionGauge, 30);
  assert.ok(empowered.units.b.statuses.some(status => status.statusId === inuGodIds.vengeanceState));
  assert.equal(empowered.units.b.statuses.some(status => status.statusId === passiveSuppressionStatusId), false);
  assert.equal(empowered.units.b.statuses.some(status => status.statusId === inuGodIds.allyShield
    && status.values.shieldRemaining === 1000), true);

  const furySkill = definition.skills.find(skill => skill.id === inuGodIds.vengeance);
  const furyCommands = furySkill.execute(createBattleContext(empowered), { actorId: 'b', skillId: inuGodIds.vengeance,
    targetIds: ['b'], shape: 'self', targetRelation: 'ally' }, {});
  const fury = applyEffectCommands(empowered, furyCommands, 'effect-resolution', 'dog-fury-cast', resolveStatus).state;
  assert.ok(fury.units.b.statuses.some(status => status.statusId === inuGodIds.vengeanceActive));
  assert.equal(effectiveStats(fury.units.b).attack, 3100);
  const ultimate = executeAction(fury, { actorId: 'b', skillId: inuGodIds.ultimate, targetIds: ['r'],
    shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .5, { resolveStatus });
  assert.equal(ultimate.accepted, true);
  assert.equal(ultimate.state.resources.blue.fire, 0);
  const hits = ultimate.events.filter(event => event.type === 'damage' && event.source.id === inuGodIds.ultimate);
  assert.equal(hits.length, 5);
  assert.equal(new Set(hits.map(event => event.amount)).size, 1);
});

test('傀儡师傀儡爆发支付3火造成五段单体伤害，傀儡追击逐段概率追加封顶真实伤害', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: puppetMasterIds.hero, skillLevel: 5,
    stats: { ...initial.units.b.stats, attack: 2000, crit: 0 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, hp: 100000, defense: 0, crit: 0, resist: 0 }, hp: 100000 };
  initial.resources.blue.fire = 3;
  const registry = new ContentRegistry(); registerPuppetMaster(registry);
  const definition = registry.getHero(puppetMasterIds.hero), resolveStatus = id => registry.getStatus(id);
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'hero:242:hit', phase: 'hit', priority: 40, handle: definition.handlers.hit.handle });
  const result = executeAction(initial, { actorId: 'b', skillId: puppetMasterIds.ultimate, targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .19, { dispatcher, resolveStatus });
  assert.equal(result.accepted, true);
  assert.equal(result.state.resources.blue.fire, 0);
  assert.equal(result.events.filter(event => event.type === 'damage' && event.source.id === puppetMasterIds.ultimate).length, 5);
  const followUps = result.events.filter(event => event.type === 'damage' && event.source.id === puppetMasterIds.passive);
  assert.equal(followUps.length, 5);
  assert.ok(followUps.every(event => event.damageKind === 'true' && event.amount === 2400));
  const basicHits = result.events.filter(event => event.type === 'damage' && event.source.id === puppetMasterIds.ultimate);
  assert.ok(basicHits.every(event => event.amount > 1300 && event.amount < 1340));
  const totalDamage = [...basicHits, ...followUps].reduce((sum, event) => sum + event.amount, 0);
  assert.ok(Math.abs(result.state.units.r.hp - (100000 - totalDamage)) < 1e-8);
});

test('首无冥火每次伤害偷取40%暴击并转移目标，虚无消耗3火且无视40%防御', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: shoumuIds.hero, skillLevel: 5,
    stats: { ...initial.units.b.stats, attack: 1000, crit: 0 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, hp: 100000, attack: 10, defense: 1000, crit: .8 }, hp: 100000 };
  initial.units.r2 = { ...unit('r2', 'red'), stats: { ...unit('r2', 'red').stats, hp: 100000, attack: 10, crit: .2 }, hp: 100000 };
  initial.sides.red.push('r2');
  const registry = new ContentRegistry(); registerShoumu(registry);
  const definition = registry.getHero(shoumuIds.hero), resolveStatus = id => registry.getStatus(id);
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'hero:244:hit', phase: 'hit', priority: 40, handle: definition.handlers.hit.handle });
  const first = executeAction(initial, { actorId: 'b', skillId: shoumuIds.basic, targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .5, { dispatcher, resolveStatus });
  assert.equal(effectiveStats(first.state.units.b).crit, .4);
  assert.equal(effectiveStats(first.state.units.r).crit, .4);
  const second = executeAction(first.state, { actorId: 'b', skillId: shoumuIds.basic, targetIds: ['r2'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .5, { dispatcher, resolveStatus });
  assert.equal(second.state.units.r.statuses.some(status => status.statusId === shoumuIds.targetCritReduction), false);
  assert.equal(effectiveStats(second.state.units.r2).crit, 0);
  assert.equal(second.state.units.b.statuses.find(status => status.statusId === shoumuIds.stolenCrit).values.targetUnitId, 'r2');

  const costly = { ...initial, resources: { ...initial.resources, blue: { fire: 3 } } };
  const ultimate = executeAction(costly, { actorId: 'b', skillId: shoumuIds.ultimate, targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .5, { resolveStatus });
  assert.equal(ultimate.accepted, true);
  assert.equal(ultimate.state.resources.blue.fire, 0);
  assert.ok(Math.abs(ultimate.events.find(event => event.type === 'damage' && event.source.id === shoumuIds.ultimate).amount - 820) < 1e-8);
});

test('提灯小僧鬼火球按技能等级群攻并消耗2火，阵亡时给敌方补1火', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: lanternBoyIds.hero, skillLevel: 5,
    stats: { ...initial.units.b.stats, attack: 1000, crit: 0 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, hp: 50000, defense: 0, crit: 0 }, hp: 50000 };
  initial.units.r2 = { ...unit('r2', 'red'), stats: { ...unit('r2', 'red').stats, hp: 50000, defense: 0, crit: 0 }, hp: 50000 };
  initial.sides.red.push('r2');
  initial.resources.blue.fire = 2;
  const registry = new ContentRegistry(); registerLanternBoy(registry);
  const definition = registry.getHero(lanternBoyIds.hero), resolveStatus = id => registry.getStatus(id);
  const cast = executeAction(initial, { actorId: 'b', skillId: lanternBoyIds.ultimate, targetIds: ['r', 'r2'],
    shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .5, { resolveStatus });
  assert.equal(cast.accepted, true);
  assert.equal(cast.state.resources.blue.fire, 0);
  assert.equal(cast.events.filter(event => event.type === 'damage' && event.source.id === lanternBoyIds.ultimate).length, 2);
  assert.ok(cast.events.filter(event => event.type === 'damage' && event.source.id === lanternBoyIds.ultimate)
    .every(event => event.amount > 1280 && event.amount < 1300));
  const deathCommands = definition.handlers['unit-defeated'].handle(createBattleContext(initial),
    { eventId: 'lantern-boy-dead', phase: 'unit-defeated', source, type: 'unit-defeated', unitId: 'b' });
  const supplied = applyEffectCommands(initial, deathCommands, 'effect-resolution', 'lantern-boy-death-fire').state;
  assert.equal(supplied.resources.red.fire, 1);
});

test('出世螺开战与行动前获得螺壳，大伤害封顶并按每次伤害恢复生命', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, soulId: worldConchIds.soul };
  const registry = new ContentRegistry(); registerWorldConch(registry);
  const definition = registry.getSoul(worldConchIds.soul), resolveStatus = id => registry.getStatus(id);
  const opened = applyEffectCommands(initial, definition.initialize(createBattleContext(initial), 'b'),
    'effect-resolution', 'world-conch-opening', resolveStatus).state;
  assert.ok(opened.units.b.statuses.some(status => status.statusId === worldConchIds.shell));

  const harmlessHit = definition.interceptIncomingDamage(opened, opened.units.r, opened.units.b, 5000, 'normal');
  assert.equal(harmlessHit, undefined, '伤害没有超过生命上限60%时保留螺壳');
  const shellHit = definition.interceptIncomingDamage(opened, opened.units.r, opened.units.b, 8000, 'normal');
  assert.equal(shellHit.amount, 6000);
  const actualHit = applyEffectCommands(opened, [{ type: 'deal-damage', source: { kind: 'skill', id: 'test-hit', unitId: 'r' },
    targetId: 'b', amount: 8000 }], 'effect-resolution', 'world-conch-large-hit', resolveStatus, undefined,
    (current, attacker, target, amount, kind) => definition.interceptIncomingDamage(current, attacker, target, amount, kind));
  assert.equal(actualHit.state.units.b.hp, 4000);
  assert.equal(actualHit.state.units.b.statuses.some(status => status.statusId === worldConchIds.shell), false);

  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: `soul:${worldConchIds.soul}:hit`, phase: 'hit', priority: 20,
    handle: definition.handlers.hit.handle });
  const afterHit = settleEvents(actualHit.state, actualHit.events, dispatcher, () => .5,
    undefined, resolveStatus);
  assert.equal(afterHit.state.units.b.hp, 4600, '按封顶后的伤害值恢复10%');

  const turnStart = definition.handlers['turn-start'].handle(createBattleContext(afterHit.state),
    { eventId: 'world-conch-turn-start', phase: 'turn-start', source, type: 'turn-started', unitId: 'b' });
  const refreshed = applyEffectCommands(afterHit.state, turnStart, 'effect-resolution', 'world-conch-refresh', resolveStatus).state;
  assert.equal(refreshed.units.b.statuses.filter(status => status.statusId === worldConchIds.shell).length, 1);
});

test('恶楼开战获得封禁计数，携带者完成8回合后激活80%增减伤', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, soulId: evilFloorIds.soul };
  const registry = new ContentRegistry(); registerEvilFloor(registry);
  const definition = registry.getSoul(evilFloorIds.soul), resolveStatus = id => registry.getStatus(id);
  let battle = applyEffectCommands(initial, definition.initialize(createBattleContext(initial), 'b'),
    'effect-resolution', 'evil-floor-opening', resolveStatus).state;
  assert.equal(battle.units.b.statuses.find(status => status.statusId === evilFloorIds.sealed).stacks, 8);
  assert.equal(definition.modifyOutgoingDamage(battle.units.b, battle.units.r, 100, 'normal', battle), 100);
  assert.equal(definition.modifyIncomingDamage(battle.units.r, battle.units.b, 100, 'normal'), 100);

  for (let turn = 1; turn <= 8; turn += 1) {
    const commands = definition.handlers['turn-end'].handle(createBattleContext(battle),
      { eventId: `evil-floor-turn-${turn}`, phase: 'turn-end', source, type: 'turn-ended', unitId: 'b' });
    battle = applyEffectCommands(battle, commands, 'effect-resolution', `evil-floor-end-${turn}`, resolveStatus).state;
    if (turn < 8) {
      assert.equal(battle.units.b.statuses.find(status => status.statusId === evilFloorIds.sealed).stacks, 8 - turn);
      assert.equal(battle.units.b.statuses.some(status => status.statusId === evilFloorIds.power), false);
    }
  }
  assert.equal(battle.units.b.statuses.some(status => status.statusId === evilFloorIds.sealed), false);
  assert.equal(definition.modifyOutgoingDamage(battle.units.b, battle.units.r, 100, 'normal', battle), 180);
  assert.equal(definition.modifyIncomingDamage(battle.units.r, battle.units.b, 100, 'normal'), 20);
});

test('夜送犬每回合首次受到敌方控制时叠加80%抵抗，能行动时清除夜行', () => {
  let battle = state();
  battle.units.b = { ...battle.units.b, soulId: nightSendDogIds.soul, stats: { ...battle.units.b.stats, resist: .5 } };
  const registry = new ContentRegistry(); registerNightSendDog(registry);
  const definition = registry.getSoul(nightSendDogIds.soul), resolveStatus = id => registry.getStatus(id);
  const enemyControl = turn => ({ eventId: `night-send-dog-control-${turn}`, phase: 'control-application',
    source: { kind: 'skill', id: 'enemy-control', unitId: 'r' }, type: 'control-applied', targetId: 'b',
    statusId: 'test.control', newlyControlled: true });
  for (let turn = 1; turn <= 4; turn += 1) {
    const commands = definition.handlers['control-application'].handle(createBattleContext(battle, () => .5), enemyControl(turn));
    battle = applyEffectCommands(battle, commands ?? [], 'effect-resolution', `night-send-dog-stack-${turn}`, resolveStatus).state;
    const walk = battle.units.b.statuses.find(status => status.statusId === nightSendDogIds.nightWalk);
    assert.equal(walk.stacks, Math.min(turn, 3));
    assert.equal(effectiveStats(battle.units.b).resist, .5 + Math.min(turn, 3) * .8);
    if (turn === 1) {
      assert.equal(definition.handlers['control-application'].handle(createBattleContext(battle, () => .5),
        { ...enemyControl(turn), eventId: 'night-send-dog-second-control' }), undefined,
      '同一携带者回合内只触发首次控制');
    }
    const reset = definition.handlers['turn-start'].handle(createBattleContext(battle, () => .5, undefined, undefined, () => true),
      { eventId: `night-send-dog-turn-start-${turn}`, phase: 'turn-start', source, type: 'turn-started', unitId: 'b' });
    battle = applyEffectCommands(battle, reset ?? [], 'effect-resolution', `night-send-dog-reset-${turn}`, resolveStatus).state;
  }
  assert.equal(battle.units.b.statuses.some(status => status.statusId === nightSendDogIds.nightWalk), true,
    '被控制而不能行动时保留夜行');
  const able = definition.handlers['turn-start'].handle(createBattleContext(battle, () => .5),
    { eventId: 'night-send-dog-able-turn-start', phase: 'turn-start', source, type: 'turn-started', unitId: 'b' });
  battle = applyEffectCommands(battle, able ?? [], 'effect-resolution', 'night-send-dog-clear', resolveStatus).state;
  assert.equal(battle.units.b.statuses.some(status => status.statusId === nightSendDogIds.nightWalk), false);
  assert.equal(effectiveStats(battle.units.b).resist, .5);
});

test('夜啼石只从非召唤友方阵亡获得属性，封顶5层与初始属性150%，两回合后回退生命上限', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, soulId: nightTearStoneIds.soul,
    stats: { ...initial.units.b.stats, hp: 10000, attack: 2000, defense: 500 }, hp: 10000 };
  for (let index = 1; index <= 6; index += 1) {
    const ally = { ...unit(`d${index}`, 'blue'), stats: { ...unit(`d${index}`, 'blue').stats,
      hp: 10000, attack: 4000, defense: 1000 }, hp: 10000,
      ...(index === 6 ? { unitKind: 'summon' } : {}) };
    initial.units[ally.unitId] = ally;
    initial.sides.blue.push(ally.unitId);
  }
  const registry = new ContentRegistry(); registerNightTearStone(registry);
  const definition = registry.getSoul(nightTearStoneIds.soul), resolveStatus = id => registry.getStatus(id);
  let battle = applyEffectCommands(initial, definition.initialize(createBattleContext(initial), 'b'),
    'effect-resolution', 'night-tear-initial-stats', resolveStatus).state;
  for (let index = 1; index <= 5; index += 1) {
    const deadId = `d${index}`;
    battle = { ...battle, units: { ...battle.units, [deadId]: { ...battle.units[deadId], hp: 0 } } };
    const commands = definition.handlers['unit-defeated'].handle(createBattleContext(battle),
      { eventId: `night-tear-death-${index}`, phase: 'unit-defeated', source, type: 'unit-defeated', unitId: deadId });
    battle = applyEffectCommands(battle, commands ?? [], 'effect-resolution', `night-tear-growth-${index}`, resolveStatus).state;
  }
  const growth = battle.units.b.statuses.find(status => status.statusId === nightTearStoneIds.growth);
  assert.equal(growth.stacks, 5);
  assert.equal(effectiveStats(battle.units.b).attack, 5000);
  assert.equal(effectiveStats(battle.units.b).defense, 1250);
  assert.equal(battle.units.b.stats.hp, 25000);

  battle = { ...battle, units: { ...battle.units, d6: { ...battle.units.d6, hp: 0 } } };
  const summonDeath = definition.handlers['unit-defeated'].handle(createBattleContext(battle),
    { eventId: 'night-tear-summon-death', phase: 'unit-defeated', source, type: 'unit-defeated', unitId: 'd6' });
  assert.equal(summonDeath, undefined);

  const { captureStatusExpirySnapshot, advanceStatusDurations } = require(path + 'core/status-lifecycle.js');
  for (let turn = 1; turn <= 2; turn += 1) {
    const snapshot = captureStatusExpirySnapshot(battle, { owner: 'target-turn', unitId: 'b' });
    const expiry = advanceStatusDurations(battle, snapshot, `night-tear-expiry-${turn}`);
    battle = expiry.state;
    for (const event of expiry.events) {
      const commands = definition.handlers['status-expiration'].handle(createBattleContext(battle), event);
      battle = applyEffectCommands(battle, commands ?? [], 'effect-resolution', `night-tear-expiry-effect-${turn}`,
        resolveStatus).state;
    }
  }
  assert.equal(battle.units.b.statuses.some(status => status.statusId === nightTearStoneIds.growth), false);
  assert.equal(battle.units.b.stats.hp, 10000);
});

test('雨降首次低于30%生命后将上限降为1，每层雨露吸收一次完整行动的多段伤害', () => {
  let initial = state();
  initial.units.b = { ...initial.units.b, soulId: rainfallStoneIds.soul, hp: 4000, stats: { ...initial.units.b.stats, hp: 10000 } };
  initial.counters.action = 10;
  const registry = new ContentRegistry(); registerRainfallStone(registry);
  const definition = registry.getSoul(rainfallStoneIds.soul), resolveStatus = id => registry.getStatus(id);
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: `soul:${rainfallStoneIds.soul}:hit`, phase: 'hit', priority: 45,
    handle: definition.handlers.hit.handle });
  dispatcher.register({ id: `soul:${rainfallStoneIds.soul}:effect-resolution`, phase: 'effect-resolution', priority: 45,
    handle: definition.handlers['effect-resolution'].handle });
  const crossed = applyEffectCommands(initial, [{ type: 'deal-damage', source: { kind: 'skill', id: 'threshold-hit', unitId: 'r' },
    targetId: 'b', amount: 1500 }], 'effect-resolution', 'rainfall-threshold', resolveStatus);
  const triggered = settleEvents(crossed.state, crossed.events, dispatcher, () => .5, undefined, resolveStatus);
  assert.equal(triggered.state.units.b.stats.hp, 1);
  assert.equal(triggered.state.units.b.hp, 1);
  assert.equal(triggered.state.units.b.statuses.find(status => status.statusId === rainfallStoneIds.rainDew).stacks, 3);

  const intercept = (current, attacker, target, amount, kind, attackId, hitIndex) => definition.interceptIncomingDamage(
    current, attacker, target, amount, kind, { attackId, hitIndex, targetIds: [target.unitId], battle: createBattleContext(current),
      isUnitUnableToAct: () => false });
  const hit = (current, actionId, label) => applyEffectCommands({ ...current,
    counters: { ...current.counters, action: actionId } }, [{ type: 'deal-damage', source: { kind: 'skill', id: label, unitId: 'r' },
      targetId: 'b', amount: 100 }], 'effect-resolution', label, resolveStatus, undefined, intercept);
  let soaked = hit(triggered.state, 10, 'rainfall-action-10-hit-1');
  assert.equal(soaked.state.units.b.hp, 1);
  assert.equal(soaked.state.units.b.statuses.find(status => status.statusId === rainfallStoneIds.rainDew).stacks, 2);
  soaked = hit(soaked.state, 10, 'rainfall-action-10-hit-2');
  assert.equal(soaked.state.units.b.hp, 1);
  assert.equal(soaked.state.units.b.statuses.find(status => status.statusId === rainfallStoneIds.rainDew).stacks, 2,
    '同一行动后续段伤害全吸收但不再消耗雨露');
  soaked = hit(soaked.state, 11, 'rainfall-action-11');
  soaked = hit(soaked.state, 12, 'rainfall-action-12');
  assert.equal(soaked.state.units.b.statuses.some(status => status.statusId === rainfallStoneIds.rainDew), false);
  const unprotected = hit(soaked.state, 13, 'rainfall-action-13');
  assert.equal(unprotected.state.units.b.hp, 0);
});

test('遗念火回合开始叠抵抗，施放技能时按层数替代鬼火且不足时不白耗念火', () => {
  const registry = new ContentRegistry(); registerRemembranceFire(registry);
  registry.registerHero({ id: 1, skills: [{ id: 'test.remembrance-skill', actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 3 }, target: 'single', targetRelation: 'ally', levels: [{}], execute: () => [] }] });
  const definition = registry.getSoul(remembranceFireIds.soul), resolveStatus = id => registry.getStatus(id);
  let initial = state();
  initial.units.b = { ...initial.units.b, soulId: remembranceFireIds.soul, stats: { ...initial.units.b.stats, resist: .2 } };
  initial.resources.blue.fire = 1;
  for (let turn = 1; turn <= 4; turn += 1) {
    const commands = definition.handlers['turn-start'].handle(createBattleContext(initial),
      { eventId: `remembrance-fire-turn-${turn}`, phase: 'turn-start', source, type: 'turn-started', unitId: 'b' });
    initial = applyEffectCommands(initial, commands ?? [], 'effect-resolution', `remembrance-fire-stack-${turn}`, resolveStatus).state;
  }
  assert.equal(initial.units.b.statuses.find(status => status.statusId === remembranceFireIds.thoughtFire).stacks, 3);
  assert.ok(Math.abs(effectiveStats(initial.units.b).resist - .65) < 1e-9);

  const insufficient = { ...initial, resources: { ...initial.resources, blue: { ...initial.resources.blue, fire: 0 } },
    units: { ...initial.units, b: { ...initial.units.b, statuses: initial.units.b.statuses.map(status =>
      status.statusId === remembranceFireIds.thoughtFire ? { ...status, stacks: 2 } : status) } } };
  const failed = executeAction(insufficient, { actorId: 'b', skillId: 'test.remembrance-skill', targetIds: ['b'],
    shape: 'single', targetRelation: 'ally' }, registry, () => .5, { resolveStatus });
  assert.equal(failed.accepted, false);
  assert.equal(failed.state.units.b.statuses.find(status => status.statusId === remembranceFireIds.thoughtFire).stacks, 2);

  const fullSubstitution = executeAction(initial, { actorId: 'b', skillId: 'test.remembrance-skill', targetIds: ['b'],
    shape: 'single', targetRelation: 'ally' }, registry, () => .5, { resolveStatus });
  assert.equal(fullSubstitution.accepted, true);
  assert.equal(fullSubstitution.state.resources.blue.fire, 1, '3层念火替代全部3点耗火');
  assert.equal(fullSubstitution.state.units.b.statuses.some(status => status.statusId === remembranceFireIds.thoughtFire), false);

  const partial = { ...initial, units: { ...initial.units, b: { ...initial.units.b,
    statuses: initial.units.b.statuses.map(status => status.statusId === remembranceFireIds.thoughtFire
      ? { ...status, stacks: 2 } : status) } } };
  const partialSubstitution = executeAction(partial, { actorId: 'b', skillId: 'test.remembrance-skill', targetIds: ['b'],
    shape: 'single', targetRelation: 'ally' }, registry, () => .5, { resolveStatus });
  assert.equal(partialSubstitution.accepted, true);
  assert.equal(partialSubstitution.state.resources.blue.fire, 0, '2层念火替代2火，剩余1火正常支付');
  assert.equal(partialSubstitution.state.units.b.statuses.some(status => status.statusId === remembranceFireIds.thoughtFire), false);
});

test('油女开战获得灵元并提供全队防御；友方缺火施放妖术时消耗对应层数', () => {
  const registry = new ContentRegistry(); registerOilChild(registry);
  registry.registerHero({ id: 1, skills: [{ id: 'test.oil-child-skill', actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 3 }, target: 'single', targetRelation: 'enemy', levels: [{}], execute: () => [] }] });
  const resolveStatus = id => registry.getStatus(id);
  let initial = state();
  initial.units.b = { ...initial.units.b, soulId: oilChildIds.soul, stats: { ...initial.units.b.stats, defense: 1000 } };
  initial.units.c = { ...unit('c', 'blue'), stats: { ...unit('c', 'blue').stats, defense: 1000 } };
  initial.sides.blue = ['b', 'c'];
  const definition = registry.getSoul(oilChildIds.soul);
  const initialized = applyEffectCommands(initial, definition.initialize(createBattleContext(initial), 'b'),
    'effect-resolution', 'oil-child-start', resolveStatus);
  initial = initialized.state;
  assert.equal(initial.units.b.statuses.find(status => status.statusId === oilChildIds.spiritOrigin).stacks, 2);
  assert.equal(effectiveStats(initial.units.b).defense, 1160);
  assert.equal(effectiveStats(initial.units.c).defense, 1160);

  const enoughFire = { ...initial, resources: { ...initial.resources, blue: { ...initial.resources.blue, fire: 3 } } };
  const paidNormally = executeAction(enoughFire, { actorId: 'c', skillId: 'test.oil-child-skill', targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .5, { resolveStatus });
  assert.equal(paidNormally.accepted, true);
  assert.equal(paidNormally.state.resources.blue.fire, 0);
  assert.equal(paidNormally.state.units.b.statuses.find(status => status.statusId === oilChildIds.spiritOrigin).stacks, 2,
    '鬼火充足时不消耗灵元');

  const shortFire = { ...initial, resources: { ...initial.resources, blue: { ...initial.resources.blue, fire: 1 } } };
  const substituted = executeAction(shortFire, { actorId: 'c', skillId: 'test.oil-child-skill', targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .5, { resolveStatus });
  assert.equal(substituted.accepted, true);
  assert.equal(substituted.state.resources.blue.fire, 0, '2层灵元替代缺少的2点鬼火');
  assert.equal(substituted.state.units.b.statuses.some(status => status.statusId === oilChildIds.spiritOrigin), false);
  assert.ok(substituted.state.units.b.statuses.every(status => status.statusId !== oilChildIds.defenseAura));
  assert.equal(effectiveStats(substituted.state.units.c).defense, 1000);

  const insufficientCredit = { ...initial, resources: { ...initial.resources, blue: { ...initial.resources.blue, fire: 1 } },
    units: { ...initial.units, b: { ...initial.units.b, statuses: initial.units.b.statuses.map(status =>
      status.statusId === oilChildIds.spiritOrigin ? { ...status, stacks: 1 } : status) } } };
  const failed = executeAction(insufficientCredit, { actorId: 'c', skillId: 'test.oil-child-skill', targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .5, { resolveStatus });
  assert.equal(failed.accepted, false);
  assert.equal(failed.state.units.b.statuses.find(status => status.statusId === oilChildIds.spiritOrigin).stacks, 1,
    '灵元和鬼火仍不足以支付时，不扣除灵元');
});

test('奉海图为受攻击友方延后30%伤害并封顶，守护消失时结算记录生命损失', () => {
  const registry = new ContentRegistry(); registerOceanAtlas(registry);
  const definition = registry.getSoul(oceanAtlasIds.soul), resolveStatus = id => registry.getStatus(id);
  let initial = state();
  initial.units.b = { ...initial.units.b, soulId: oceanAtlasIds.soul, stats: { ...initial.units.b.stats, hp: 1000 }, hp: 1000 };
  initial.units.c = unit('c', 'blue');
  initial.sides.blue = ['b', 'c'];
  const intercept = (current, attacker, target, amount) => definition.interceptIncomingDamage(current, attacker, target, amount, 'normal');
  const hit = applyEffectCommands(initial, [
    { type: 'deal-damage', source: { kind: 'skill', id: 'enemy.test', unitId: 'r' }, targetId: 'c', amount: 1000 },
    { type: 'deal-damage', source: { kind: 'skill', id: 'enemy.test', unitId: 'r' }, targetId: 'c', amount: 2000 },
  ], 'effect-resolution', 'ocean-atlas-hit', resolveStatus, undefined, intercept);
  const guard = hit.state.units.c.statuses.find(status => status.statusId === oceanAtlasIds.seaChartGuard);
  assert.equal(hit.events.filter(event => event.type === 'damage').reduce((sum, event) => sum + event.amount, 0), 2350,
    '两次攻击分别减伤300和350，第二次受携带者生命上限35%的单次封顶');
  assert.equal(guard.values.recordedLifeLoss, 650);
  assert.equal(hit.state.units.c.hp, 7650);

  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: `soul:${oceanAtlasIds.soul}:effect-resolution`, phase: 'effect-resolution', priority: 40,
    handle: definition.handlers['effect-resolution'].handle });
  dispatcher.register({ id: `soul:${oceanAtlasIds.soul}:status-expiration`, phase: 'status-expiration', priority: 40,
    handle: definition.handlers['status-expiration'].handle });
  const refreshed = settleEvents(hit.state, hit.events, dispatcher, () => .5, undefined, resolveStatus);
  assert.equal(refreshed.events.some(event => event.type === 'life-lost'), false, '刷新状态不提前结算记录值');
  const expiry = advanceStatusDurations(refreshed.state, captureStatusExpirySnapshot(refreshed.state, { owner: 'target-turn', unitId: 'c' }),
    'ocean-atlas-expire');
  assert.ok(expiry.events.some(event => event.type === 'status-removed' && event.statusId === oceanAtlasIds.seaChartGuard));
  const settled = settleEvents(expiry.state, expiry.events, dispatcher, () => .5, undefined, resolveStatus);
  assert.equal(settled.state.units.c.hp, 7000, '守护消失时直接失去累计记录的650点生命');
  assert.ok(settled.events.some(event => event.type === 'life-lost' && event.amount === 650));
});

test('贝吹坊回合开始获得贝甲，贝甲挡一次伤害并提供25%增伤', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, soulId: beichuifangIds.soul };
  const registry = new ContentRegistry(); registerBeichuifang(registry);
  const definition = registry.getSoul(beichuifangIds.soul), resolveStatus = id => registry.getStatus(id);
  const start = definition.handlers['turn-start'].handle(createBattleContext(initial),
    { eventId: 'shell-turn-start', phase: 'turn-start', source, type: 'turn-started', unitId: 'b' });
  const bestowed = applyEffectCommands(initial, start, 'effect-resolution', 'beichuifang-start', resolveStatus);
  const wearer = bestowed.state.units.b;
  assert.ok(wearer.statuses.some(status => status.statusId === beichuifangIds.shell));
  assert.equal(definition.modifyOutgoingDamage(wearer, bestowed.state.units.r, 100, 'normal', bestowed.state), 125);

  const block = definition.interceptIncomingDamage(bestowed.state, bestowed.state.units.r, wearer, 800, 'normal');
  assert.equal(block.amount, 0);
  const consumed = applyEffectCommands(bestowed.state, block.effects, 'effect-resolution', 'beichuifang-block', resolveStatus);
  assert.equal(consumed.state.units.b.statuses.some(status => status.statusId === beichuifangIds.shell), false);
  assert.equal(definition.modifyOutgoingDamage(consumed.state.units.b, consumed.state.units.r, 100, 'normal', consumed.state), 100);

  const battle = state();
  battle.units.b = { ...battle.units.b, heroId: 9000, soulId: beichuifangIds.soul,
    stats: { ...battle.units.b.stats, attack: 100, speed: 300, crit: 0 } };
  battle.units.r = { ...battle.units.r, heroId: 9001,
    stats: { ...battle.units.r.stats, hp: 10000, attack: 100, speed: 200, defense: 0, crit: 0 }, hp: 10000 };
  for (const heroId of [9000, 9001]) registry.registerHero({ id: heroId,
    skills: [createBasicAttackSkill(`basic.${heroId}`, [1])],
    policy(context, actorId) {
      const actor = context.getUnit(actorId), target = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue')[0];
      return target ? { actorId, skillId: `basic.${heroId}`, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' } : undefined;
    } });
  const live = runBattle(battle, registry, { actionLimit: 2, seed: 10 });
  const boostedHit = live.events.find(event => event.type === 'damage' && event.source.id === 'basic.9000');
  const blockedHit = live.events.find(event => event.type === 'damage' && event.source.id === 'basic.9001');
  assert.equal(boostedHit.amount, 125);
  assert.equal(blockedHit.amount, 0);
  assert.ok(live.events.some(event => event.type === 'status-removed' && event.statusId === beichuifangIds.shell
    && event.reason === 'consumed'));
});

test('觉受击时按40%判定记仇，爆炸耗3火群攻并对记仇目标增伤15%', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: jueIds.hero, skillLevel: 5,
    stats: { ...initial.units.b.stats, attack: 1000, crit: 0, hit: 0, resist: 0 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, hp: 50000, defense: 0, crit: 0, resist: 0 }, hp: 50000 };
  initial.units.r2 = { ...unit('r2', 'red'), stats: { ...unit('r2', 'red').stats, hp: 50000, defense: 0, crit: 0, resist: 0 }, hp: 50000 };
  initial.sides.red.push('r2');
  const registry = new ContentRegistry(); registerJue(registry);
  const definition = registry.getHero(jueIds.hero), resolveStatus = id => registry.getStatus(id);
  const marked = definition.handlers.hit.handle(createBattleContext(initial, () => 0, id => registry.getStatus(id)?.category),
    { eventId: 'jue-received-hit', phase: 'hit', source: { kind: 'skill', id: 'enemy-hit', unitId: 'r' },
      type: 'damage', targetId: 'b', amount: 100, hpLoss: 100, shieldAbsorbed: 0, mitigated: 0, isCritical: false });
  const markedState = applyEffectCommands(initial, marked, 'effect-resolution', 'jue-grudge', resolveStatus).state;
  assert.ok(markedState.units.r.statuses.some(status => status.statusId === jueIds.grudge));
  assert.ok(Math.abs(definition.modifyOutgoingDamage(markedState.units.b, markedState.units.r, 100, 'normal', markedState) - 115) < 1e-8);

  const withFire = { ...markedState, resources: { ...markedState.resources, blue: { fire: 3 } },
    units: { ...markedState.units, b: { ...markedState.units.b, stats: { ...markedState.units.b.stats, speed: 300 } },
      r: { ...markedState.units.r, stats: { ...markedState.units.r.stats, speed: 200 } } } };
  registry.registerHero({ id: 9001, skills: [createBasicAttackSkill('basic.9001', [1])] });
  const cast = runBattle(withFire, registry, { actionLimit: 1, seed: 3 });
  assert.equal(cast.state.resources.blue.fire, 0);
  const hits = cast.events.filter(event => event.type === 'damage' && event.source.id === jueIds.ultimate);
  assert.equal(hits.length, 2);
  assert.ok(hits.find(event => event.targetId === 'r').amount > hits.find(event => event.targetId === 'r2').amount);
});

test('赤舌鼓舞按技能等级增加速度和暴击，风鼓雷两段群攻并逐段击退行动条', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: redTongueIds.hero, skillLevel: 5,
    stats: { ...initial.units.b.stats, attack: 1000, speed: 100, crit: 0, critDamage: 1.5 } };
  initial.units.a = { ...unit('a', 'blue'), stats: { ...unit('a', 'blue').stats, speed: 110, crit: .1 } };
  initial.sides.blue.push('a');
  initial.units.r = { ...initial.units.r, actionGauge: 100, stats: { ...initial.units.r.stats, hp: 50000, defense: 0, crit: 0 }, hp: 50000 };
  initial.units.r2 = { ...unit('r2', 'red'), actionGauge: 100,
    stats: { ...unit('r2', 'red').stats, hp: 50000, defense: 0, crit: 0 }, hp: 50000 };
  initial.sides.red.push('r2');
  initial.resources.blue.fire = 2;
  const registry = new ContentRegistry(); registerRedTongue(registry);
  const definition = registry.getHero(redTongueIds.hero), resolveStatus = id => registry.getStatus(id);
  const cheer = executeAction(initial, { actorId: 'b', skillId: redTongueIds.cheer, targetIds: ['b', 'a'],
    shape: 'all-allies', targetRelation: 'ally' }, registry, () => .5, { resolveStatus });
  assert.equal(cheer.accepted, true);
  assert.equal(cheer.state.resources.blue.fire, 0);
  assert.equal(effectiveStats(cheer.state.units.b).speed, 115);
  assert.ok(Math.abs(effectiveStats(cheer.state.units.a).crit - .21) < 1e-8);
  assert.equal(effectiveStats(cheer.state.units.a).speed, 125);

  const ready = { ...initial, resources: { ...initial.resources, blue: { fire: 3 } } };
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'red-tongue-push-test', phase: 'hit', priority: 32, handle: definition.handlers.hit.handle });
  const storm = executeAction(ready, { actorId: 'b', skillId: redTongueIds.storm, targetIds: ['r', 'r2'],
    shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => 0, { dispatcher, resolveStatus });
  assert.equal(storm.accepted, true);
  assert.equal(storm.state.resources.blue.fire, 0);
  assert.equal(storm.events.filter(event => event.type === 'damage' && event.source.id === redTongueIds.storm).length, 4);
  const pushes = storm.events.filter(event => event.type === 'action-gauge-changed' && event.source.id === redTongueIds.storm);
  assert.equal(pushes.length, 4);
  assert.ok(pushes.every(event => event.requestedAmount === -100 && event.after === 0));
});

test('青蛙瓷器岭上开花按骰点决定段数，阵亡转运对敌方逐个掷骰并重复时复活', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: frogPorcelainIds.hero, skillLevel: 5,
    stats: { ...initial.units.b.stats, hp: 10000, attack: 1000, crit: 0, critDamage: 1.5 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, hp: 50000, defense: 0, crit: 0 }, hp: 50000 };
  const registry = new ContentRegistry(); registerFrogPorcelain(registry);
  const definition = registry.getHero(frogPorcelainIds.hero), resolveStatus = id => registry.getStatus(id);

  initial.resources.blue.fire = 1;
  const cast = executeAction(initial, { actorId: 'b', skillId: frogPorcelainIds.ultimate, targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .8, { resolveStatus });
  assert.equal(cast.accepted, true);
  assert.equal(cast.state.resources.blue.fire, 0);
  assert.equal(cast.events.filter(event => event.type === 'damage' && event.source.id === frogPorcelainIds.ultimate).length, 5);

  const dead = { ...initial, units: { ...initial.units, b: { ...initial.units.b, hp: 0 } } };
  dead.units.r2 = { ...unit('r2', 'red'), stats: { ...unit('r2', 'red').stats, hp: 50000, defense: 0 }, hp: 50000 };
  dead.units.r3 = { ...unit('r3', 'red'), stats: { ...unit('r3', 'red').stats, hp: 50000, defense: 0 }, hp: 50000 };
  dead.sides.red.push('r2', 'r3');
  const commands = definition.handlers['unit-defeated'].handle(createBattleContext(dead, () => 0),
    { eventId: 'frog-defeated', phase: 'unit-defeated', source, type: 'unit-defeated', unitId: 'b' });
  const resolved = applyEffectCommands(dead, commands, 'effect-resolution', 'frog-fortune', resolveStatus);
  assert.equal(resolved.events.filter(event => event.type === 'damage' && event.source.id === frogPorcelainIds.ultimate).length, 3);
  assert.equal(resolved.state.units.b.hp, 1000);
  const cooldown = resolved.state.units.b.statuses.find(status => status.statusId === frogPorcelainIds.reviveCooldown);
  assert.equal(cooldown.duration.remaining, 1);
  assert.equal(cooldown.values.repeatedPips, 1);

  const blocked = definition.handlers['unit-defeated'].handle(createBattleContext(resolved.state, () => 0),
    { eventId: 'frog-defeated-again', phase: 'unit-defeated', source, type: 'unit-defeated', unitId: 'b' });
  assert.equal(blocked, undefined);
});

test('判官死亡宣告按目标回合前触发间接伤害与治疗吸收，无情按低血和复活目标强化攻击', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: judgeIds.hero, skillLevel: 5,
    stats: { ...initial.units.b.stats, hp: 10000, attack: 1000, crit: .5, critDamage: 1.5, hit: 0 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, hp: 50000, defense: 0, resist: 0 }, hp: 50000 };
  initial.units.r2 = { ...unit('r2', 'red'), stats: { ...unit('r2', 'red').stats, hp: 50000, defense: 0, resist: 0 }, hp: 50000 };
  initial.sides.red.push('r2');
  initial.resources.blue.fire = 3;
  const registry = new ContentRegistry(); registerJudge(registry);
  const definition = registry.getHero(judgeIds.hero), resolveStatus = id => registry.getStatus(id);
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'judge-death-sentence-test', phase: 'hit', priority: 34, handle: definition.handlers.hit.handle });
  const cast = executeAction(initial, { actorId: 'b', skillId: judgeIds.ultimate, targetIds: ['r', 'r2'],
    shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .5, { dispatcher, resolveStatus });
  assert.equal(cast.accepted, true);
  assert.equal(cast.state.resources.blue.fire, 0);
  assert.equal(cast.events.filter(event => event.type === 'damage' && event.source.id === judgeIds.ultimate).length, 2);
  const mark = cast.state.units.r.statuses.find(status => status.statusId === judgeIds.deathSentence);
  assert.ok(mark);
  assert.ok(mark.values.healingAbsorptionRemaining > 0);

  const liveInitial = { ...initial, units: { ...initial.units,
    b: { ...initial.units.b, stats: { ...initial.units.b.stats, speed: 300 } },
    r: { ...initial.units.r, stats: { ...initial.units.r.stats, speed: 200 } },
    r2: { ...initial.units.r2, stats: { ...initial.units.r2.stats, speed: 100 } } } };
  const live = runBattle(liveInitial, registry, { actionLimit: 2, seed: 12 });
  const rTurnStart = live.events.findIndex(event => event.type === 'turn-started' && event.unitId === 'r');
  const rTick = live.events.findIndex(event => event.type === 'life-lost' && event.targetId === 'r'
    && event.lifeLossKind === 'indirect' && event.source.id === judgeIds.ultimate);
  const rSkip = live.events.findIndex(event => event.type === 'action-skipped' && event.actorId === 'r');
  assert.ok(rTurnStart >= 0 && rTick > rTurnStart && rSkip > rTick);
  assert.equal(live.state.units.r.statuses.some(status => status.statusId === judgeIds.deathSentence), false);

  const tick = registry.getStatus(judgeIds.deathSentence).handlers['turn-start'].handle(
    createBattleContext(cast.state, () => .5, id => registry.getStatus(id)?.category),
    { eventId: 'judge-target-turn-start', phase: 'turn-start', source, type: 'turn-started', unitId: 'r' });
  assert.equal(tick[0].type, 'lose-life');
  assert.equal(tick[0].lifeLossKind, 'indirect');
  const ticked = applyEffectCommands(cast.state, tick, 'effect-resolution', 'judge-tick', resolveStatus);
  assert.equal(ticked.state.units.r.hp, cast.state.units.r.hp - tick[0].amount);

  const absorptionState = { ...state(), units: { ...state().units,
    r: { ...state().units.r, hp: 5000, statuses: [{ instanceId: 'judge-absorb', statusId: judgeIds.deathSentence,
      source: { kind: 'skill', id: judgeIds.ultimate, unitId: 'b' }, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { healingAbsorptionRemaining: 500 } }] } } };
  const healed = applyEffectCommands(absorptionState, [{ type: 'heal', source, targetId: 'r', amount: 800 }],
    'effect-resolution', 'judge-heal-absorption', resolveStatus);
  assert.equal(healed.state.units.r.hp, 5300);
  assert.ok(healed.events.some(event => event.type === 'healing' && event.healingAbsorbed === 500 && event.amount === 300));
  assert.ok(healed.events.some(event => event.type === 'status-removed' && event.statusId === judgeIds.deathSentence
    && event.reason === 'consumed'));

  const target = { ...cast.state.units.r, hp: 12500,
    statuses: [{ instanceId: 'judge-revived', statusId: judgeIds.revivedTarget, source, stacks: 1, duration: { kind: 'permanent' } }] };
  const formula = definition.beforeCalculateDamage({ attack: 1000, defense: 0, ratio: 1, critChance: .5, critDamage: 1.5 },
    cast.state.units.b, target, cast.state);
  assert.equal(formula.critChance, 1.25);
  assert.equal(formula.critDamage, 1.75);
  assert.equal(definition.modifyOutgoingDamage(cast.state.units.b, target, 100, 'normal', cast.state), 140);
});

test('凤凰火凤火转移暴击，烈焰要求目标同时有减益和控制，凤凰业火暴击可追加回合', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: phoenixFireIds.hero, skillLevel: 5,
    stats: { ...initial.units.b.stats, attack: 1000, crit: 0, critDamage: 1.5, hit: 0 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, hp: 50000, defense: 0, crit: .5, resist: 0 }, hp: 50000 };
  initial.units.r2 = { ...unit('r2', 'red'), stats: { ...unit('r2', 'red').stats, hp: 50000, defense: 0, crit: .2, resist: 0 }, hp: 50000 };
  initial.sides.red.push('r2');
  const registry = new ContentRegistry(); registerPhoenixFire(registry);
  const definition = registry.getHero(phoenixFireIds.hero), resolveStatus = id => registry.getStatus(id);
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'phoenix-fire-hit-test', phase: 'hit', priority: 36, handle: definition.handlers.hit.handle });
  dispatcher.register({ id: 'phoenix-fire-steal-test', phase: 'effect-resolution', priority: 37,
    handle: definition.handlers['effect-resolution'].handle });
  const basic = executeAction(initial, { actorId: 'b', skillId: phoenixFireIds.basic, targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .1, { dispatcher, resolveStatus });
  assert.equal(basic.accepted, true);
  assert.equal(effectiveStats(basic.state.units.b).crit, .1);
  assert.ok(Math.abs(effectiveStats(basic.state.units.r).crit - .4) < 1e-8);

  registry.registerStatus({ id: 'test.phoenix.debuff', mechanicsCoverage: 'verified', category: 'debuff',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: 'test.phoenix.control', mechanicsCoverage: 'verified', category: 'control',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  const guardedTarget = { ...initial.units.r, statuses: [
    { instanceId: 'existing-debuff', statusId: 'test.phoenix.debuff', source, stacks: 1, duration: { kind: 'permanent' } },
    { instanceId: 'existing-control', statusId: 'test.phoenix.control', source, stacks: 1, duration: { kind: 'permanent' } },
  ] };
  const guarded = { ...initial, units: { ...initial.units, r: guardedTarget } };
  const passiveCommands = definition.handlers.hit.handle(createBattleContext(guarded, () => 0,
    id => registry.getStatus(id)?.category), { eventId: 'phoenix-passive-hit', phase: 'hit',
      source: { kind: 'skill', id: phoenixFireIds.basic, unitId: 'b' }, type: 'damage', targetId: 'r',
      amount: 100, hpLoss: 100, shieldAbsorbed: 0, mitigated: 0, isCritical: false });
  assert.ok(passiveCommands.some(command => command.type === 'apply-control' && command.instance.statusId === phoenixFireIds.stun));

  const fireReady = { ...initial, resources: { ...initial.resources, blue: { fire: 3 } },
    units: { ...initial.units, b: { ...initial.units.b, stats: { ...initial.units.b.stats, crit: 1 } } } };
  const ultimate = executeAction(fireReady, { actorId: 'b', skillId: phoenixFireIds.ultimate, targetIds: ['r', 'r2'],
    shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => 0, { dispatcher, resolveStatus });
  assert.equal(ultimate.accepted, true);
  assert.equal(ultimate.state.resources.blue.fire, 0);
  assert.equal(ultimate.events.filter(event => event.type === 'damage' && event.source.id === phoenixFireIds.ultimate
    && event.isCritical).length, 2);
  assert.equal(ultimate.events.filter(event => event.type === 'turn-scheduled' && event.source.id === phoenixFireIds.ultimate).length, 2);
});

test('吸血姬血袭消耗当前生命并受血怒加成，鲜血之拥获得护盾并在目标回合结束造成封顶间接伤害', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: vampirePrincessIds.hero, skillLevel: 5,
    stats: { ...initial.units.b.stats, hp: 10000, attack: 1000, crit: 0 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, hp: 50000, defense: 0, resist: 0 }, hp: 50000 };
  initial.resources.blue.fire = 2;
  const registry = new ContentRegistry(); registerVampirePrincess(registry);
  const definition = registry.getHero(vampirePrincessIds.hero), resolveStatus = id => registry.getStatus(id);
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'vampire-hit-test', phase: 'hit', priority: 42, handle: definition.handlers.hit.handle });
  const basic = executeAction(initial, { actorId: 'b', skillId: vampirePrincessIds.basic, targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .5, { dispatcher, resolveStatus });
  assert.equal(basic.accepted, true);
  assert.equal(basic.state.units.b.hp, 9000);
  assert.ok(basic.events.some(event => event.type === 'life-lost' && event.targetId === 'b' && event.amount === 1000));
  const outgoing = definition.modifyOutgoingDamage(basic.state.units.b, basic.state.units.r, 100, 'normal', basic.state);
  assert.equal(outgoing, 140);

  const ult = executeAction(basic.state, { actorId: 'b', skillId: vampirePrincessIds.ultimate, targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .5, { dispatcher, resolveStatus });
  assert.equal(ult.accepted, true);
  assert.equal(ult.state.resources.blue.fire, 0);
  const shield = ult.state.units.b.statuses.find(status => status.statusId === vampirePrincessIds.shield);
  assert.ok(shield.values.shieldRemaining > 0);
  assert.equal(ult.state.units.r.statuses.find(status => status.statusId === vampirePrincessIds.bleed).duration.remaining, 2);

  const mark = registry.getStatus(vampirePrincessIds.bleed);
  const tick = mark.handlers['turn-end'].handle(createBattleContext(ult.state, () => .5),
    { eventId: 'vampire-target-turn-end', phase: 'turn-end', source, type: 'turn-ended', unitId: 'r' });
  assert.equal(tick.length, 1);
  assert.equal(tick[0].lifeLossKind, 'indirect');
  assert.equal(tick[0].amount, 4000); // 吸血姬攻击400%低于目标生命上限10%
  const resolved = applyEffectCommands(ult.state, tick, 'effect-resolution', 'vampire-dot', resolveStatus);
  assert.equal(resolved.state.units.r.hp, ult.state.units.r.hp - 4000);
});

test('妖狐狂风刃卷按命中次数重复施放，攻击叠层封顶且半血以上目标每次攻击至多触发一次追击', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: demonFoxIds.hero, skillLevel: 5,
    stats: { ...initial.units.b.stats, hp: 10000, attack: 1000, crit: 0 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, hp: 50000, defense: 0, resist: 0 }, hp: 50000 };
  initial.resources.blue.fire = 3;
  const registry = new ContentRegistry(); registerDemonFox(registry);
  const definition = registry.getHero(demonFoxIds.hero), resolveStatus = id => registry.getStatus(id);
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'demon-fox-hit-test', phase: 'hit', priority: 32, handle: definition.handlers.hit.handle });
  const cast = executeAction(initial, { actorId: 'b', skillId: demonFoxIds.ultimate, targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .1, { dispatcher, resolveStatus });
  assert.equal(cast.accepted, true);
  assert.equal(cast.state.resources.blue.fire, 0);
  assert.equal(cast.events.filter(event => event.type === 'damage' && event.source.id === demonFoxIds.ultimate).length, 20);
  assert.equal(cast.events.filter(event => event.type === 'damage' && event.source.id === demonFoxIds.passive).length, 1);
  assert.equal(cast.state.units.b.statuses.find(status => status.statusId === demonFoxIds.attack).stacks, 10);
  assert.equal(effectiveStats(cast.state.units.b).attack, 1600);

  const lowTarget = { ...initial.units.r, hp: 20000 };
  const noFollowup = { ...initial, units: { ...initial.units, r: lowTarget } };
  const failed = executeAction(noFollowup, { actorId: 'b', skillId: demonFoxIds.basic, targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .1, { dispatcher, resolveStatus });
  assert.equal(failed.events.filter(event => event.type === 'damage' && event.source.id === demonFoxIds.passive).length, 0);
});

test('阎魔怨魂重压支付3火并尝试沉默/变形，敌方阵亡召唤白鬼、占位禁复活且白鬼攻击后消失', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: enmaIds.hero, skillLevel: 5,
    stats: { ...initial.units.b.stats, hp: 10000, attack: 1000, crit: 0, hit: 0 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, hp: 50000, defense: 0, resist: 0 }, hp: 50000 };
  initial.resources.blue.fire = 3;
  const registry = new ContentRegistry();
  registry.registerStatus(passiveSuppressionStatusDefinition);
  registerEnma(registry);
  const definition = registry.getHero(enmaIds.hero), resolveStatus = id => registry.getStatus(id);
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'enma-hit-test', phase: 'hit', priority: 33, handle: definition.handlers.hit.handle });
  dispatcher.register({ id: 'enma-transform-test', phase: 'effect-resolution', priority: 33,
    handle: definition.handlers['effect-resolution'].handle });
  dispatcher.register({ id: 'enma-defeat-test', phase: 'unit-defeated', priority: 33,
    handle: definition.handlers['unit-defeated'].handle });
  const cast = executeAction(initial, { actorId: 'b', skillId: enmaIds.ultimate, targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .1, { dispatcher, resolveStatus });
  assert.equal(cast.accepted, true);
  assert.equal(cast.state.resources.blue.fire, 0);
  assert.ok(cast.events.some(event => event.type === 'damage' && event.source.id === enmaIds.ultimate));
  assert.ok(cast.state.units.r.statuses.some(status => status.statusId === enmaIds.silence));
  assert.ok(cast.state.units.r.statuses.some(status => status.statusId === enmaIds.blackImp));
  assert.ok(cast.state.units.r.statuses.some(status => status.statusId === passiveSuppressionStatusId));

  const summonInitial = state();
  summonInitial.units.b = { ...summonInitial.units.b, heroId: enmaIds.hero,
    stats: { ...summonInitial.units.b.stats, hp: 10000, attack: 1000 } };
  summonInitial.units.r = { ...summonInitial.units.r, hp: 0 };
  summonInitial.units.r2 = { ...unit('r2', 'red'), heroId: enmaIds.hero,
    stats: { ...unit('r2', 'red').stats, hp: 10000, attack: 500, defense: 0 }, hp: 10000 };
  summonInitial.sides.red.push('r2');
  const deathCommands = definition.handlers['unit-defeated'].handle(createBattleContext(summonInitial, () => .5),
    { eventId: 'enma-enemy-defeated', phase: 'unit-defeated', source, type: 'unit-defeated', unitId: 'r' });
  const spawned = applyEffectCommands(summonInitial, deathCommands, 'effect-resolution', 'enma-summon', resolveStatus);
  const imp = Object.values(spawned.state.units).find(value => value.displayName === '白色小鬼');
  assert.ok(imp);
  assert.ok(spawned.state.units.r.statuses.some(status => status.statusId === enmaIds.blockedRevive));
  assert.ok(spawned.state.units.r2.statuses.some(status => status.statusId === enmaIds.impPresence));
  assert.equal(definition.modifyOutgoingDamage(spawned.state.units.r2, spawned.state.units.b, 100, 'normal', spawned.state), 100);
  assert.equal(definition.modifyIncomingDamage(summonInitial.units.b, spawned.state.units.r2, 100, 'normal'), 50);

  const attack = executeAction(spawned.state, { actorId: imp.unitId, skillId: enmaIds.impAttack,
    targetIds: ['r2'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .5,
  { dispatcher, resolveStatus });
  assert.equal(attack.accepted, true);
  assert.ok(attack.state.units.r2.hp < spawned.state.units.r2.hp);
  assert.equal(attack.state.units[imp.unitId].hp, 0);
  assert.equal(attack.state.units.r.statuses.some(status => status.statusId === enmaIds.blockedRevive), false);
});

test('妖琴师余音支付2火并为指定友方插入新回合，疯魔琴心逐目标推条并尝试混乱', () => {
  const registry = new ContentRegistry(); registerYaoqinShi(registry);
  const definition = registry.getHero(yaoqinShiIds.hero), resolveStatus = id => registry.getStatus(id);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: yaoqinShiIds.hero, skillLevel: 5,
    stats: { ...initial.units.b.stats, hp: 10000, attack: 1000, speed: 300 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, hp: 50000, defense: 0, resist: 0 },
    hp: 50000, actionGauge: 75 };
  initial.units.r2 = { ...unit('r2', 'red'), stats: { ...unit('r2', 'red').stats, hp: 50000, defense: 0, resist: 0 },
    hp: 50000, actionGauge: 50 };
  initial.sides.red.push('r2');
  initial.resources.blue.fire = 3;
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'yaoqin-hit-test', phase: 'hit', priority: 31, handle: definition.handlers.hit.handle });
  const ultimate = executeAction(initial, { actorId: 'b', skillId: yaoqinShiIds.ultimate,
    targetIds: ['r', 'r2'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => 0,
  { dispatcher, resolveStatus });
  assert.equal(ultimate.accepted, true);
  assert.equal(ultimate.state.resources.blue.fire, 0);
  for (const id of ['r', 'r2']) {
    assert.equal(ultimate.state.units[id].actionGauge, 0);
    assert.ok(ultimate.state.units[id].statuses.some(status => status.statusId === yaoqinShiIds.confusion));
  }
  assert.ok(ultimate.events.filter(event => event.type === 'action-gauge-changed' && event.requestedAmount === -100).length === 2);

  const support = state();
  support.units.b = { ...support.units.b, heroId: yaoqinShiIds.hero, skillLevel: 5,
    stats: { ...support.units.b.stats, hp: 10000, attack: 1000, speed: 300 } };
  support.units.r = { ...support.units.r, stats: { ...support.units.r.stats, hp: 50000, defense: 0, speed: 10 }, hp: 50000 };
  support.resources.blue.fire = 2;
  const battle = runBattle(support, registry, { seed: 31, actionLimit: 2 });
  assert.equal(battle.state.resources.blue.fire, 0);
  assert.ok(battle.events.some(event => event.type === 'turn-started' && event.unitId === 'b' && event.scheduling === 'extra-turn'));
  assert.ok(battle.events.some(event => event.type === 'status-added' && event.targetId === 'b'
    && event.instance.statusId === yaoqinShiIds.speed));
  assert.ok(battle.events.some(event => event.type === 'action-declared' && event.intent.actorId === 'b'
    && event.intent.skillId === yaoqinShiIds.basic));
});

test('食梦貘食梦者消耗3火逐目标催眠，沉睡触发治疗且食梦貘攻击不唤醒睡眠目标', () => {
  const registry = new ContentRegistry();
  registerDreamEater(registry);
  registerFoodHairDemon(registry);
  registry.registerStatus({ id: 'test.attack-buff', category: 'buff', dispellable: true });
  const definition = registry.getHero(dreamEaterIds.hero), resolveStatus = id => registry.getStatus(id);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: dreamEaterIds.hero, skillLevel: 5,
    skillLevels: { [dreamEaterIds.basic]: 5, [dreamEaterIds.ultimate]: 5 },
    stats: { ...initial.units.b.stats, hp: 10000, attack: 1000, resist: 0 } };
  initial.units.a = { ...unit('a', 'blue'), hp: 2000, stats: { ...unit('a', 'blue').stats, hp: 20000 } };
  initial.units.s = { ...unit('s', 'blue'), heroId: 9000, unitKind: 'summon', hp: 500,
    stats: { ...unit('s', 'blue').stats, hp: 10000 } };
  initial.sides.blue.push('a', 's');
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, hp: 50000, defense: 0, resist: 0 }, hp: 50000,
    statuses: [] };
  initial.units.r2 = { ...unit('r2', 'red'), stats: { ...unit('r2', 'red').stats, hp: 50000, defense: 0, resist: 0 }, hp: 50000,
    statuses: [{ instanceId: 'buff-r2', statusId: 'test.attack-buff', source, stacks: 1,
      duration: { kind: 'count', remaining: 2, owner: 'target-turn' } }] };
  initial.sides.red.push('r2');
  initial.resources.blue.fire = 3;
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'dream-eater-hit-test', phase: 'hit', priority: 30, handle: definition.handlers.hit.handle });
  dispatcher.register({ id: 'dream-eater-heal-test', phase: 'effect-resolution', priority: 30,
    handle: definition.handlers['effect-resolution'].handle });
  dispatcher.register({ id: 'dream-eater-sleep-test', phase: 'hit', priority: 5,
    handle: registry.getStatus(dreamEaterIds.sleep).handlers.hit.handle });
  dispatcher.register({ id: 'food-hair-sleep-test', phase: 'hit', priority: 5,
    handle: registry.getStatus(foodHairDemonIds.sleepStatus).handlers.hit.handle });
  const cast = executeAction(initial, { actorId: 'b', skillId: dreamEaterIds.ultimate,
    targetIds: ['r', 'r2'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => 0,
  { dispatcher, resolveStatus });
  assert.equal(cast.accepted, true);
  assert.equal(cast.state.resources.blue.fire, 0);
  for (const id of ['r', 'r2']) {
    const sleep = cast.state.units[id].statuses.find(status => status.statusId === dreamEaterIds.sleep);
    assert.ok(sleep);
    assert.equal(sleep.duration.remaining, 1);
  }
  assert.equal(cast.state.units.a.hp, 4000);
  assert.equal(cast.state.units.s.hp, 500);

  const foodSleep = applyEffectCommands(cast.state, [{ type: 'apply-control', source,
    targetId: 'r2', instance: { instanceId: 'food-sleep', statusId: foodHairDemonIds.sleepStatus,
      source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { controlType: '睡眠' } } }],
  'effect-resolution', 'food-sleep-setup', resolveStatus);
  const basic = executeAction(foodSleep.state, { actorId: 'b', skillId: dreamEaterIds.basic,
    targetIds: ['r2'], shape: 'single', targetRelation: 'enemy' }, registry, () => 0, { dispatcher, resolveStatus });
  assert.equal(basic.accepted, true);
  assert.ok(basic.state.units.r2.statuses.some(status => status.statusId === foodHairDemonIds.sleepStatus));
  assert.equal(basic.state.units.r2.statuses.some(status => status.statusId === dreamEaterIds.sleep), true);
  assert.equal(basic.state.units.r2.statuses.some(status => status.statusId === 'test.attack-buff'), false);
});

test('两面佛逐击随机雷神/风神，按面附加减益与风神间接伤害并结算五级行动条', () => {
  const registry = new ContentRegistry(); registerTwoFacedBuddha(registry);
  const definition = registry.getHero(twoFacedBuddhaIds.hero), resolveStatus = id => registry.getStatus(id);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: twoFacedBuddhaIds.hero, skillLevel: 5,
    skillLevels: { [twoFacedBuddhaIds.basic]: 5, [twoFacedBuddhaIds.passive]: 5, [twoFacedBuddhaIds.ultimate]: 5 },
    stats: { ...initial.units.b.stats, hp: 10000, attack: 5000, defense: 700, resist: 0 } };
  initial.units.r = { ...initial.units.r, hp: 50000, actionGauge: 50,
    stats: { ...initial.units.r.stats, hp: 50000, attack: 3000, defense: 200, resist: 0 } };
  initial.units.r2 = { ...unit('r2', 'red'), hp: 50000,
    stats: { ...unit('r2', 'red').stats, hp: 50000, attack: 3000, defense: 200, resist: 0 } };
  initial.sides.red.push('r2');
  initial.resources.blue.fire = 3;

  const wind = executeAction(initial, { actorId: 'b', skillId: twoFacedBuddhaIds.ultimate,
    targetIds: ['r', 'r2'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .9, { resolveStatus });
  assert.equal(wind.accepted, true);
  assert.equal(wind.state.resources.blue.fire, 0);
  assert.equal(wind.events.filter(event => event.type === 'damage' && event.source.id === twoFacedBuddhaIds.ultimate).length, 6);
  for (const id of ['r', 'r2']) {
    const attackDown = wind.state.units[id].statuses.find(status => status.statusId === twoFacedBuddhaIds.attackDown);
    const dot = wind.state.units[id].statuses.find(status => status.statusId === twoFacedBuddhaIds.ultimateWind);
    assert.ok(attackDown);
    assert.equal(attackDown.modifiers[0].amount, -.18);
    assert.ok(dot);
    assert.equal(dot.values.indirectDamageRatio, .69);
    assert.equal(dot.duration.remaining, 1);
  }
  const tickContext = createBattleContext(wind.state, () => .5,
    id => registry.getStatus(id)?.category, id => registry.getStatus(id)?.dispellable === true);
  const tickCommands = registry.getStatus(twoFacedBuddhaIds.ultimateWind).handlers['turn-end'].handle(tickContext,
    { eventId: 'two-face-wind-tick', phase: 'turn-end', source, type: 'turn-ended', unitId: 'r' });
  assert.ok(tickCommands.some(command => command.type === 'lose-life' && command.lifeLossKind === 'indirect'));
  assert.ok(tickCommands.some(command => command.type === 'change-action-gauge' && command.targetId === 'b' && command.amount === 8));
  const tick = applyEffectCommands(wind.state, tickCommands, 'turn-end', 'two-face-wind-tick', resolveStatus);
  assert.ok(tick.state.units.r.hp < wind.state.units.r.hp);
  assert.equal(tick.state.units.b.actionGauge, 8);

  const thunderState = state();
  thunderState.units.b = initial.units.b;
  thunderState.units.r = { ...initial.units.r, actionGauge: 50 };
  const thunder = executeAction(thunderState, { actorId: 'b', skillId: twoFacedBuddhaIds.basic,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, registry, () => 0, { resolveStatus });
  assert.equal(thunder.accepted, true);
  assert.equal(thunder.state.units.r.actionGauge, 42);
  assert.equal(thunder.state.units.r.statuses.find(status => status.statusId === twoFacedBuddhaIds.defenseDown).modifiers[0].amount, -.18);

  const partialPassive = state();
  partialPassive.units.b = { ...initial.units.b, skillLevels: { ...initial.units.b.skillLevels, [twoFacedBuddhaIds.passive]: 2 } };
  partialPassive.units.r = { ...initial.units.r, actionGauge: 50 };
  const lowerRank = executeAction(partialPassive, { actorId: 'b', skillId: twoFacedBuddhaIds.basic,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, registry, () => 0, { resolveStatus });
  assert.equal(lowerRank.state.units.r.actionGauge, 50);
  assert.equal(lowerRank.state.units.r.statuses.find(status => status.statusId === twoFacedBuddhaIds.defenseDown).modifiers[0].amount, -.12);
});

test('小鹿男森之力按回合叠层，敌方耗火推条，鹿角冲撞击退到底眩晕并消耗一层', () => {
  const registry = new ContentRegistry(); registerYoungDeer(registry);
  registry.registerStatus({ id: 'test.enemy-control', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerHero({ id: 2, skills: [{ id: 'test.enemy-fire-skill', actionKind: 'skill',
    resourceCost: { resourceId: 'fire', amount: 2 }, target: 'single', targetRelation: 'enemy', levels: [{}], execute() { return []; } }] });
  const definition = registry.getHero(youngDeerIds.hero), resolveStatus = id => registry.getStatus(id);
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'young-deer-turn-end-test', phase: 'turn-end', priority: 91, handle: definition.handlers['turn-end'].handle });
  dispatcher.register({ id: 'young-deer-resource-test', phase: 'resource-payment', priority: 92,
    handle: definition.handlers['resource-payment'].handle });
  dispatcher.register({ id: 'young-deer-control-test', phase: 'control-application', priority: 93,
    handle: definition.handlers['control-application'].handle });
  dispatcher.register({ id: 'young-deer-push-test', phase: 'effect-resolution', priority: 94,
    handle: definition.handlers['effect-resolution'].handle });

  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: youngDeerIds.hero, skillLevel: 5,
    skillLevels: { [youngDeerIds.basic]: 5, [youngDeerIds.passive]: 5, [youngDeerIds.ultimate]: 5 },
    stats: { ...initial.units.b.stats, hp: 10000, attack: 4000, defense: 600, resist: 0 } };
  initial.units.r = { ...initial.units.r, heroId: 2, stats: { ...initial.units.r.stats, hp: 20000, attack: 3000, defense: 100, resist: 0 }, hp: 20000 };
  initial.units.r2 = { ...unit('r2', 'red'), hp: 20000, actionGauge: 80,
    stats: { ...unit('r2', 'red').stats, hp: 20000, attack: 2500, defense: 100, resist: 0 } };
  initial.sides.red.push('r2');
  initial.resources.red.fire = 4;

  const debuff = executeAction(initial, { actorId: 'b', skillId: youngDeerIds.basic,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, registry, () => 0, { resolveStatus });
  assert.ok(debuff.state.units.r.statuses.some(status => status.statusId === youngDeerIds.resistDown
    && status.modifiers[0].amount === -.2 && status.duration.remaining === 2));

  const controlled = { ...initial, units: { ...initial.units, b: { ...initial.units.b, statuses: [{ instanceId: 'incoming-stun',
    statusId: 'test.enemy-control', source: { kind: 'skill', id: 'enemy', unitId: 'r' }, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { controlType: '眩晕' } }] } } };
  const reflected = definition.handlers['control-application'].handle(createBattleContext(controlled, () => 0),
    { eventId: 'young-deer-controlled', phase: 'control-application', source: { kind: 'skill', id: 'enemy', unitId: 'r' },
      type: 'control-applied', targetId: 'b', statusId: 'test.enemy-control', newlyControlled: true });
  assert.ok(reflected.some(command => command.type === 'apply-control' && command.targetId === 'r'
    && command.instance.values.controlType === '眩晕'));

  const fireCast = executeAction(debuff.state, { actorId: 'r', skillId: 'test.enemy-fire-skill',
    targetIds: ['b'], shape: 'single', targetRelation: 'enemy' }, registry, () => 0, { dispatcher, resolveStatus });
  assert.equal(fireCast.state.resources.red.fire, 2);
  assert.equal(fireCast.state.units.b.actionGauge, 20);

  const turnEndCommands = definition.handlers['turn-end'].handle(createBattleContext(fireCast.state),
    { eventId: 'young-deer-turn-end', phase: 'turn-end', source, type: 'turn-ended', unitId: 'b' });
  const charged = applyEffectCommands(fireCast.state, turnEndCommands, 'turn-end', 'young-deer-charge', resolveStatus);
  assert.equal(charged.state.units.b.statuses.find(status => status.statusId === youngDeerIds.spirit).stacks, 1);

  const gainAgain = (current, eventId) => applyEffectCommands(current, definition.handlers['turn-end'].handle(
    createBattleContext(current), { eventId, phase: 'turn-end', source, type: 'turn-ended', unitId: 'b' }),
  'turn-end', eventId, resolveStatus);
  const twoLayers = gainAgain(charged.state, 'young-deer-layer-two');
  const threeLayers = gainAgain(twoLayers.state, 'young-deer-layer-three');
  const capped = gainAgain(threeLayers.state, 'young-deer-layer-cap');
  assert.equal(twoLayers.state.units.b.statuses.find(status => status.statusId === youngDeerIds.spirit).stacks, 2);
  assert.equal(threeLayers.state.units.b.statuses.find(status => status.statusId === youngDeerIds.spirit).stacks, 3);
  assert.equal(capped.state.units.b.statuses.find(status => status.statusId === youngDeerIds.spirit).stacks, 3);

  const ready = { ...capped.state, resources: { ...capped.state.resources,
    blue: { ...capped.state.resources.blue, fire: 3 } }, units: { ...capped.state.units,
    b: { ...capped.state.units.b }, r: { ...capped.state.units.r, actionGauge: 30,
          statuses: charged.state.units.r.statuses.filter(status => status.statusId !== youngDeerIds.resistDown) } } };
  assert.equal(ready.units.b.statuses.find(status => status.statusId === youngDeerIds.spirit).stacks, 3);
  ready.units.r2 = { ...ready.units.r2, actionGauge: 80 };
  const cast = executeAction(ready, { actorId: 'b', skillId: youngDeerIds.ultimate,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, registry, () => .9,
  { dispatcher, resolveStatus });
  assert.equal(cast.accepted, true);
  assert.equal(cast.state.resources.blue.fire, 0);
  assert.equal(cast.state.units.r.actionGauge, 0);
  assert.equal(cast.state.units.r2.actionGauge, 0);
  assert.equal(cast.events.filter(event => event.type === 'damage' && event.source.id === youngDeerIds.ultimate).length, 3);
  assert.ok(cast.state.units.r2.hp < ready.units.r2.hp);
  assert.ok(cast.state.units.r.statuses.some(status => status.statusId === youngDeerIds.stun));
  assert.ok(cast.state.units.r2.statuses.some(status => status.statusId === youngDeerIds.stun));
  assert.equal(cast.state.units.b.statuses.find(status => status.statusId === youngDeerIds.spirit)?.stacks, 1);
  assert.ok(cast.state.units.b.statuses.some(status => status.statusId === youngDeerIds.consumedThisTurn));
  const afterConsumedTurn = definition.handlers['turn-end'].handle(createBattleContext(cast.state),
    { eventId: 'young-deer-spent-turn-end', phase: 'turn-end', source, type: 'turn-ended', unitId: 'b' });
  const cleared = applyEffectCommands(cast.state, afterConsumedTurn, 'turn-end', 'young-deer-spent', resolveStatus);
  assert.equal(cleared.state.units.b.statuses.find(status => status.statusId === youngDeerIds.spirit)?.stacks, 1);
  assert.equal(cleared.state.units.b.statuses.some(status => status.statusId === youngDeerIds.consumedThisTurn), false);
});

test('清姬普攻6级中毒与焚火，淬毒逐次永久降防，焚身之火3火三段逐击叠毒', () => {
  const registry = new ContentRegistry(); registerKiyohime(registry);
  const definition = registry.getHero(kiyohimeIds.hero), resolveStatus = id => registry.getStatus(id);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: kiyohimeIds.hero, awakeFilter: 1, skillLevel: 5,
    skillLevels: { [kiyohimeIds.basic]: 6, [kiyohimeIds.passive]: 1, [kiyohimeIds.ultimate]: 5 },
    stats: { ...initial.units.b.stats, hp: 10000, attack: 5000, defense: 600, crit: 0, resist: 0 } };
  initial.units.r = { ...initial.units.r, hp: 50000, stats: { ...initial.units.r.stats, hp: 50000, attack: 1000, defense: 1000, speed: 100, resist: 0 } };
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'kiyohime-poison-passive-test', phase: 'effect-resolution', priority: 118,
    handle: definition.handlers['effect-resolution'].handle });
  const basic = executeAction(initial, { actorId: 'b', skillId: kiyohimeIds.basic,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, registry, () => 0,
  { dispatcher, resolveStatus });
  assert.equal(basic.accepted, true);
  const poison = basic.state.units.r.statuses.find(status => status.statusId === kiyohimeIds.poison);
  const burning = basic.state.units.r.statuses.find(status => status.statusId === kiyohimeIds.burningFire);
  const defenseLoss = basic.state.units.r.statuses.find(status => status.statusId === kiyohimeIds.permanentDefenseLoss);
  assert.equal(poison.stacks, 3);
  assert.equal(poison.duration.remaining, 5);
  assert.deepEqual(poison.modifiers.map(modifier => modifier.amount), [-.1, -10]);
  assert.equal(burning.values.indirectDamageRatio, .33);
  assert.equal(defenseLoss.values.defenseReduced, 20);
  assert.equal(effectiveStats(basic.state.units.r).defense, 950);
  const tickCommands = registry.getStatus(kiyohimeIds.burningFire).handlers['turn-end'].handle(
    createBattleContext(basic.state, () => .5, id => registry.getStatus(id)?.category,
      id => registry.getStatus(id)?.dispellable === true),
    { eventId: 'kiyohime-burning-fire-tick', phase: 'turn-end', source, type: 'turn-ended', unitId: 'r' });
  assert.ok(tickCommands.some(command => command.type === 'lose-life' && command.lifeLossKind === 'indirect'));

  const ultimateStart = state();
  ultimateStart.units.b = { ...initial.units.b };
  ultimateStart.units.r = { ...initial.units.r };
  ultimateStart.units.r2 = { ...unit('r2', 'red'), hp: 50000,
    stats: { ...unit('r2', 'red').stats, hp: 50000, attack: 1000, defense: 1000, speed: 100, resist: 0 } };
  ultimateStart.sides.red.push('r2');
  ultimateStart.resources.blue.fire = 3;
  const ultimate = executeAction(ultimateStart, { actorId: 'b', skillId: kiyohimeIds.ultimate,
    targetIds: ['r', 'r2'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => 0,
  { dispatcher, resolveStatus });
  assert.equal(ultimate.accepted, true);
  assert.equal(ultimate.state.resources.blue.fire, 0);
  assert.equal(ultimate.events.filter(event => event.type === 'damage' && event.source.id === kiyohimeIds.ultimate).length, 6);
  for (const id of ['r', 'r2']) {
    assert.equal(ultimate.state.units[id].statuses.find(status => status.statusId === kiyohimeIds.poison).stacks, 9);
    assert.equal(ultimate.state.units[id].statuses.find(status => status.statusId === kiyohimeIds.permanentDefenseLoss).values.defenseReduced, 60);
    assert.equal(ultimate.state.units[id].statuses.find(status => status.statusId === kiyohimeIds.burningFire).values.indirectDamageRatio, .99);
  }

  const sharedCap = state();
  sharedCap.units.b = { ...initial.units.b };
  sharedCap.units.a = { ...unit('a', 'blue'), heroId: kiyohimeIds.hero, awakeFilter: 1 };
  sharedCap.sides.blue.push('a');
  sharedCap.units.r = { ...initial.units.r, statuses: [{ instanceId: 'shared-defense-loss', statusId: kiyohimeIds.permanentDefenseLoss,
    source: { kind: 'skill', id: kiyohimeIds.passive, unitId: 'b' }, stacks: 1, duration: { kind: 'permanent' },
    values: { defenseReduced: 290 }, modifiers: [{ stat: 'defense', operation: 'flat', amount: -290 }] }] };
  const poisonApplied = { eventId: 'second-kiyohime-poison', phase: 'effect-resolution',
    source: { kind: 'skill', id: kiyohimeIds.basic, unitId: 'a' }, type: 'status-added', targetId: 'r',
    instance: { instanceId: 'second-poison', statusId: kiyohimeIds.poison,
      source: { kind: 'skill', id: kiyohimeIds.basic, unitId: 'a' }, stacks: 3,
      duration: { kind: 'count', remaining: 5, owner: 'target-turn' } } };
  const finalShred = definition.handlers['effect-resolution'].handle(createBattleContext(sharedCap), poisonApplied);
  const capApplied = applyEffectCommands(sharedCap, finalShred, 'effect-resolution', 'shared-cap', resolveStatus);
  assert.equal(capApplied.state.units.r.statuses.find(status => status.statusId === kiyohimeIds.permanentDefenseLoss).values.defenseReduced, 300);
  assert.equal(definition.handlers['effect-resolution'].handle(createBattleContext(capApplied.state),
    { ...poisonApplied, eventId: 'third-kiyohime-poison' }), undefined);

  const unawakened = state();
  unawakened.units.b = { ...initial.units.b, awakeFilter: 0 };
  const basePassive = executeAction(unawakened, { actorId: 'b', skillId: kiyohimeIds.basic,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, registry, () => 0, { dispatcher, resolveStatus });
  assert.equal(basePassive.state.units.r.statuses.find(status => status.statusId === kiyohimeIds.permanentDefenseLoss).values.defenseReduced, 10);
});

test('镰鼬普攻随机附加三种效果之一，兄弟之绊触发额外回合并强化全队', () => {
  const registry = new ContentRegistry(); registerKamaitachi(registry);
  const definition = registry.getHero(kamaitachiIds.hero), resolveStatus = id => registry.getStatus(id);
  const base = state();
  base.units.b = { ...base.units.b, heroId: kamaitachiIds.hero, skillLevel: 5,
    skillLevels: { [kamaitachiIds.basic]: 5, [kamaitachiIds.passive]: 5, [kamaitachiIds.ultimate]: 5 },
    stats: { ...base.units.b.stats, hp: 10000, attack: 3000, defense: 400, hit: 0, resist: 0 } };
  base.units.r = { ...base.units.r, hp: 40000,
    stats: { ...base.units.r.stats, hp: 40000, attack: 1000, defense: 1000, resist: 0 } };
  const queuedRandom = values => { let index = 0; return () => values[index++] ?? 0; };

  const defenseDown = executeAction(base, { actorId: 'b', skillId: kamaitachiIds.basic,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, registry, queuedRandom([0, 0, 0, 0, 0]), { resolveStatus });
  assert.ok(defenseDown.state.units.r.statuses.some(status => status.statusId === kamaitachiIds.defenseDown
    && status.modifiers[0].amount === -.3 && status.duration.remaining === 2));

  const stun = executeAction(base, { actorId: 'b', skillId: kamaitachiIds.basic,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, registry, queuedRandom([0, 0, 0, .5, 0]), { resolveStatus });
  assert.ok(stun.state.units.r.statuses.some(status => status.statusId === kamaitachiIds.stun
    && status.values.controlType === '眩晕' && status.duration.remaining === 1));

  const bleed = executeAction(base, { actorId: 'b', skillId: kamaitachiIds.basic,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, registry, queuedRandom([0, 0, 0, .9, 0]), { resolveStatus });
  const bleedStatus = bleed.state.units.r.statuses.find(status => status.statusId === kamaitachiIds.bleed);
  assert.equal(bleedStatus.values.maxHpLossRatio, .05);
  assert.equal(bleedStatus.duration.remaining, 2);
  const tick = registry.getStatus(kamaitachiIds.bleed).handlers['turn-start'].handle(
    createBattleContext(bleed.state), { eventId: 'kamaitachi-bleed-tick', phase: 'turn-start', source,
      type: 'turn-started', unitId: 'r' });
  assert.equal(tick[0].amount, 2000);

  const ultimateState = { ...base, units: { ...base.units, a: { ...unit('a', 'blue'), hp: 8000,
    stats: { ...unit('a', 'blue').stats, hp: 10000, attack: 1500, resist: 0 } } },
    sides: { ...base.sides, blue: ['b', 'a'] }, resources: { ...base.resources,
      blue: { ...base.resources.blue, fire: 3 } } };
  const ultimate = executeAction(ultimateState, { actorId: 'b', skillId: kamaitachiIds.ultimate,
    targetIds: ['b', 'a'], shape: 'all-allies', targetRelation: 'ally' }, registry, () => 0, { resolveStatus });
  assert.equal(ultimate.accepted, true);
  assert.equal(ultimate.state.resources.blue.fire, 0);
  for (const id of ['b', 'a']) {
    assert.equal(effectiveStats(ultimate.state.units[id]).attack, ultimateState.units[id].stats.attack * 1.3);
    assert.equal(effectiveStats(ultimate.state.units[id]).resist, .2);
    assert.equal(ultimate.state.units[id].actionGauge, 30);
    assert.equal(ultimate.state.units[id].statuses.find(status => status.statusId === kamaitachiIds.attackUp).duration.remaining, 2);
  }

  const passiveContext = createBattleContext({ ...base, counters: { ...base.counters, action: 1 } }, () => 0);
  const scheduled = definition.handlers['turn-end'].handle(passiveContext,
    { eventId: 'kamaitachi-passive-turn-end', phase: 'turn-end', source,
      type: 'turn-ended', unitId: 'b' });
  assert.ok(scheduled.some(command => command.type === 'schedule-turn' && command.unitId === 'b'
    && command.scheduling === 'extra-turn'));
  const queued = applyEffectCommands(passiveContext.state, scheduled, 'turn-end', 'kamaitachi-extra-turn', resolveStatus);
  assert.ok(queued.events.some(event => event.type === 'turn-scheduled' && event.scheduling === 'extra-turn'));
});

test('慧明灯被动只在敌方单体攻击时分担伤害，明识灯提供防御并以业障拘魂', () => {
  const initial = state();
  const light = { instanceId: 'light', statusId: wisdomLampIds.light,
    source: { kind: 'skill', id: wisdomLampIds.wisdomLamp, unitId: 'b' }, stacks: 1,
    duration: { kind: 'permanent' } };
  initial.units.b = { ...initial.units.b, heroId: 552, hp: 9000, stats: { ...initial.units.b.stats, hp: 10000 }, statuses: [light] };
  initial.units.a = { ...unit('a', 'blue'), hp: 6000 };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, resist: 0 } };
  initial.sides.blue = ['b', 'a'];
  const registry = new ContentRegistry(); registerWisdomLamp(registry);
  registry.registerStatus({ id: 'test.wisdom-lamp-stun', category: 'control', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  const definition = registry.getHero(552), resolveStatus = id => registry.getStatus(id);
  const interceptDamage = (current, attacker, target, amount, kind, attackId, hitIndex, damageSource) => {
    const context = createBattleContext(current, () => .1, id => registry.getStatus(id)?.category,
      id => registry.getStatus(id)?.dispellable === true);
    return definition.interceptIncomingDamage(current, attacker, target, amount, kind, { attackId, hitIndex,
      source: damageSource, targetIds: current.activeAttackTargetIds ?? [target.unitId],
      attackShape: current.activeAttackShape, battle: context, isUnitUnableToAct: unitId => Boolean(current.units[unitId]?.statuses
        .some(status => registry.getStatus(status.statusId)?.preventsAction)) });
  };
  registry.registerHero({ id: 2, skills: [
    { id: 'enemy.single', actionKind: 'skill', target: 'single', targetRelation: 'enemy', levels: [{}],
      execute(_context, intent) { return [{ type: 'deal-damage', source: { kind: 'skill', id: 'enemy.single', unitId: intent.actorId },
        targetId: intent.targetIds[0], amount: 100 }]; } },
    { id: 'enemy.area', actionKind: 'skill', target: 'all-enemies', targetRelation: 'enemy', levels: [{}],
      execute(_context, intent) { return intent.targetIds.map(targetId => ({ type: 'deal-damage',
        source: { kind: 'skill', id: 'enemy.area', unitId: intent.actorId }, targetId, amount: 100 })); } },
  ] });
  const single = executeAction(initial, { actorId: 'r', skillId: 'enemy.single', targetIds: ['a'], shape: 'single', targetRelation: 'enemy' },
    registry, () => .1, { interceptDamage });
  assert.equal(single.state.units.a.hp, 6550);
  assert.equal(single.state.units.b.hp, 9550);
  assert.ok(single.events.some(event => event.type === 'damage' && event.targetId === 'b'
    && event.source.id === 'enemy.single' && event.hpLost === 50));
  const withoutLight = { ...initial, units: { ...initial.units, b: { ...initial.units.b, statuses: [] } } };
  const unprotected = executeAction(withoutLight, { actorId: 'r', skillId: 'enemy.single', targetIds: ['a'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .1, { interceptDamage });
  assert.equal(unprotected.state.units.a.hp, 5900, '灯不在场时被动不分担伤害');
  assert.equal(unprotected.state.units.b.hp, 9000);
  assert.equal(unprotected.events.some(event => event.type === 'healing' && event.source.id === wisdomLampIds.passive), false);
  const controlledLamp = { ...initial, units: { ...initial.units, b: { ...initial.units.b, statuses: [light, {
    instanceId: 'lamp-stun', statusId: 'test.wisdom-lamp-stun', source, stacks: 1,
    duration: { kind: 'permanent' } }] } } };
  const stillProtects = executeAction(controlledLamp, { actorId: 'r', skillId: 'enemy.single', targetIds: ['a'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .1, { interceptDamage });
  assert.equal(stillProtects.state.units.a.hp, 5900, '慧明灯受控时不应代替友方承伤');
  assert.equal(stillProtects.state.units.b.hp, 9000, '不可行动时也不应受到分担伤害或获得被动治疗');
  assert.equal(stillProtects.events.some(event => event.type === 'healing' && event.source.id === wisdomLampIds.passive), false);
  const area = executeAction(single.state, { actorId: 'r', skillId: 'enemy.area', targetIds: ['b', 'a'],
    shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .1, { interceptDamage });
  assert.equal(area.state.units.a.hp, 6450);
  assert.equal(area.state.units.b.hp, 9450);
  assert.equal(area.events.some(event => event.type === 'healing' && event.source.id === wisdomLampIds.passive), false);

  const karmaStart = initial;
  const zeroDamageEvent = { eventId: 'wisdom-zero-damage', phase: 'hit', source: { kind: 'skill', id: 'enemy.single', unitId: 'r' },
    type: 'damage', targetId: 'b', damageKind: 'normal', amount: 0, hpLost: 0, mitigated: 0, isCritical: false };
  assert.equal(definition.handlers.hit.handle(createBattleContext(karmaStart), zeroDamageEvent), undefined,
    '闪避或零伤害不应叠加业障');
  const shieldDamageEvent = { ...zeroDamageEvent, eventId: 'wisdom-shield-damage', amount: 100, hpLost: 0 };
  assert.ok(definition.handlers.hit.handle(createBattleContext(karmaStart), shieldDamageEvent)
    .some(command => command.type === 'add-status' && command.instance.statusId === wisdomLampIds.karma),
  '实际伤害由护盾吸收时仍视为慧明灯受击');
  let karmaState = karmaStart;
  for (let index = 1; index <= 3; index += 1) {
    const event = { eventId: `wisdom-hit-${index}`, phase: 'hit', source: { kind: 'skill', id: 'enemy.single', unitId: 'r' },
      type: 'damage', targetId: 'b', damageKind: 'normal', amount: 100, hpLost: 100, mitigated: 0, isCritical: false };
    const context = createBattleContext(karmaState, () => 0, id => registry.getStatus(id)?.category,
      id => registry.getStatus(id)?.dispellable === true);
    const commands = definition.handlers.hit.handle(context, event);
    karmaState = applyEffectCommands(karmaState, commands, 'effect-resolution', `wisdom-karma-${index}`, resolveStatus).state;
  }
  const karma = karmaState.units.r.statuses.find(status => status.statusId === wisdomLampIds.karma);
  assert.equal(karma.stacks, 3);
  assert.equal(effectiveStats(karmaState.units.r).attack, 4250);
  assert.ok(karmaState.units.r.statuses.some(status => status.statusId === wisdomLampIds.soulBind));

  registry.registerStatus({ id: 'test.healing-down', category: 'debuff', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: 'test.root', category: 'control', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  const invokeState = { ...karmaState, resources: { ...karmaState.resources, blue: { ...karmaState.resources.blue, fire: 3 } },
    units: { ...karmaState.units, b: { ...karmaState.units.b, skillLevel: 5, skillLevels: { '5523': 5 } },
      a: { ...karmaState.units.a, stats: { ...karmaState.units.a.stats, defense: 1000 }, statuses: [
      { instanceId: 'healing-down', statusId: 'test.healing-down', source, stacks: 1, duration: { kind: 'permanent' } },
      { instanceId: 'root', statusId: 'test.root', source, stacks: 1, duration: { kind: 'permanent' } }] } } };
  const invoked = executeAction(invokeState, { actorId: 'b', skillId: wisdomLampIds.wisdomLamp, targetIds: ['b'],
    shape: 'self', targetRelation: 'ally' }, registry, () => 0, { resolveStatus }).state;
  assert.equal(invoked.resources.blue.fire, 0);
  assert.equal(effectiveStats(invoked.units.a).defense, 1400);
  assert.equal(invoked.units.a.statuses.some(status => status.statusId === 'test.healing-down'
    || status.statusId === 'test.root'), false);
  assert.ok(invoked.units.r.statuses.some(status => status.statusId === wisdomLampIds.soulBind));
  const cleanup = definition.handlers['turn-start'].handle(createBattleContext(invoked),
    { eventId: 'wisdom-next-turn', phase: 'turn-start', source, type: 'turn-started', unitId: 'b' });
  const cleaned = applyEffectCommands(invoked, cleanup, 'turn-start', 'wisdom-cleanup', resolveStatus).state;
  assert.equal(cleaned.units.b.statuses.some(status => status.statusId === wisdomLampIds.light), false);
  assert.equal(cleaned.units.a.statuses.some(status => status.statusId === wisdomLampIds.defenseAura), false);
  assert.equal(cleaned.units.r.statuses.some(status => status.statusId === wisdomLampIds.karma), false);
});

test('犬夜叉消耗鬼火反击并依铁碎牙进化获得无视护盾，铁碎牙大招执行7至14段随机攻击', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: 313, skillLevel: 5,
    stats: { ...initial.units.b.stats, attack: 1000 }, statuses: [
      { instanceId: `${inuyashaIds.wind}:b`, statusId: inuyashaIds.wind, source: { kind: 'skill', id: inuyashaIds.basic, unitId: 'b' },
        stacks: 2, duration: { kind: 'permanent' } },
      { instanceId: `${inuyashaIds.evolution}:b`, statusId: inuyashaIds.evolution,
        source: { kind: 'skill', id: inuyashaIds.counter, unitId: 'b' }, stacks: 1, duration: { kind: 'permanent' }, values: { stage: 1 } },
    ] };
  initial.units.r = { ...initial.units.r, shield: 1000 };
  const registry = new ContentRegistry(); registerInuyasha(registry);
  const definition = registry.getHero(313);
  const triggerContext = createBattleContext(initial, () => .41, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable === true);
  const scheduled = definition.handlers['resource-payment'].handle(triggerContext,
    { eventId: 'enemy-paid-fire', phase: 'resource-payment', source: { kind: 'skill', id: 'enemy.ultimate', unitId: 'r' },
      type: 'resource-changed', side: 'red', resourceId: 'fire', before: 3, after: 1 });
  assert.equal(scheduled[0].scheduling, 'counter');
  assert.equal(scheduled[0].intent.targetIds[0], 'r');

  const counter = executeAction(initial, scheduled[0].intent, registry, () => .5,
    { ignoreResourceCost: true, resolveStatus: id => registry.getStatus(id) });
  assert.equal(counter.state.units.r.shield, 1000);
  assert.equal(counter.state.units.r.hp, 7888);
  assert.equal(counter.state.units.b.statuses.find(status => status.statusId === inuyashaIds.wind), undefined);
  assert.equal(counter.state.units.b.statuses.find(status => status.statusId === inuyashaIds.evolution).values.stage, 2);

  const ultimate = definition.skills.find(skill => skill.id === inuyashaIds.ultimate);
  const ultimateContext = createBattleContext(initial, () => .5, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable === true);
  const hits = ultimate.execute(ultimateContext, { actorId: 'b', skillId: inuyashaIds.ultimate,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, { ratio: .5, hitCount: 7, extraChance: .8 });
  assert.equal(hits.length, 14);
  assert.ok(hits.every(hit => hit.type === 'deal-damage' && hit.targetId === 'r'));
  assert.ok(hits.every(hit => hit.ignoreShield));
});

test('犬夜叉漆黑铁碎牙反击保留风劲层数和增伤，不再继续进化', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: inuyashaIds.hero, skillLevel: 5, stats: { ...initial.units.b.stats, attack: 1000 },
    statuses: [{ instanceId: `${inuyashaIds.wind}:b`, statusId: inuyashaIds.wind,
      source: { kind: 'skill', id: inuyashaIds.basic, unitId: 'b' }, stacks: 2, duration: { kind: 'permanent' } },
    { instanceId: `${inuyashaIds.evolution}:b`, statusId: inuyashaIds.evolution,
      source: { kind: 'skill', id: inuyashaIds.counter, unitId: 'b' }, stacks: 1, duration: { kind: 'permanent' }, values: { stage: 4 } }] };
  const registry = new ContentRegistry(); registerInuyasha(registry);
  const intent = { actorId: 'b', skillId: inuyashaIds.counter, targetIds: ['r'], shape: 'single',
    targetRelation: 'enemy', kind: 'passive' };
  const result = executeAction(initial, intent, registry, () => .5, { ignoreResourceCost: true,
    resolveStatus: id => registry.getStatus(id) });
  assert.equal(result.state.units.b.statuses.find(status => status.statusId === inuyashaIds.wind)?.stacks, 2,
    '漆黑铁碎牙反击不消耗风劲层数');
  assert.equal(result.state.units.b.statuses.find(status => status.statusId === inuyashaIds.evolution).values.stage, 4,
    '最终阶段反击不再继续升级');
});

test('犬夜叉龙鳞铁碎牙成功驱散后，暴伤加成在本次多段攻击中立即生效', () => {
  const registry = new ContentRegistry(); registerInuyasha(registry);
  registry.registerStatus({ id: 'test.inuyasha-dispellable-buff', mechanicsCoverage: 'partial', category: 'buff',
    dispellable: true, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  const makeInitial = (withBuff) => {
    const initial = state();
    initial.units.b = { ...initial.units.b, heroId: inuyashaIds.hero, skillLevel: 5, actionGauge: 99,
      stats: { ...initial.units.b.stats, hp: 10000, attack: 1000, speed: 300, crit: 1, critDamage: 1.5 },
      statuses: [{ instanceId: `${inuyashaIds.evolution}:b`, statusId: inuyashaIds.evolution,
        source: { kind: 'skill', id: inuyashaIds.counter, unitId: 'b' }, stacks: 1,
        duration: { kind: 'permanent' }, values: { stage: 3 } }] };
    initial.units.r = { ...initial.units.r, hp: 100000,
      stats: { ...initial.units.r.stats, hp: 100000, defense: 0, speed: 1 },
      statuses: withBuff ? [1, 2].map(index => ({ instanceId: `target-buff-${index}`, statusId: 'test.inuyasha-dispellable-buff',
        source: { kind: 'skill', id: 'test.buff', unitId: 'r' }, stacks: 1, duration: { kind: 'permanent' } })) : [] };
    initial.resources.blue.fire = 3;
    return initial;
  };
  const withDispel = runBattle(makeInitial(true), registry, { actionLimit: 1, seed: 14 });
  const withoutDispel = runBattle(makeInitial(false), registry, { actionLimit: 1, seed: 14 });
  const firstDamage = result => result.events.find(event => event.type === 'damage' && event.source.id === inuyashaIds.ultimate);
  assert.equal(withDispel.events.filter(event => event.type === 'status-removed'
    && event.statusId === 'test.inuyasha-dispellable-buff').length, 2);
  assert.equal(withDispel.state.units.b.statuses.find(status => status.statusId === inuyashaIds.dragonScaleCrit).stacks, 2);
  const withDispelHits = withDispel.events.filter(event => event.type === 'damage' && event.source.id === inuyashaIds.ultimate);
  const baselineHits = withoutDispel.events.filter(event => event.type === 'damage' && event.source.id === inuyashaIds.ultimate);
  assert.ok(withDispelHits[0].amount > baselineHits[0].amount,
    'the first successful pre-hit dispel affects its own hit');
  assert.ok(withDispelHits[1].amount > baselineHits[1].amount && withDispelHits[1].amount > withDispelHits[0].amount,
    'a second successful pre-hit dispel stacks and affects the next hit in the same action');
});

test('犬夜叉漆黑铁碎牙按造成伤害的一半降低生命上限，最低保留原上限20%', () => {
  const initial = state();
  initial.resources.blue.fire = 3;
  initial.units.b = { ...initial.units.b, heroId: 313, skillLevel: 5,
    stats: { ...initial.units.b.stats, hp: 1000, attack: 500 }, hp: 1000,
    statuses: [{ instanceId: `${inuyashaIds.evolution}:b`, statusId: inuyashaIds.evolution,
      source: { kind: 'skill', id: inuyashaIds.counter, unitId: 'b' }, stacks: 1,
      duration: { kind: 'permanent' }, values: { stage: 4 } }] };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, hp: 100000 }, hp: 100000 };
  const registry = new ContentRegistry(); registerInuyasha(registry);
  initial.units.b = { ...initial.units.b, stats: { ...initial.units.b.stats, speed: 200 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, speed: 100 } };
  const result = runBattle(initial, registry, { actionLimit: 1, seed: 1 });
  const damage = result.events.filter(event => event.type === 'damage' && event.targetId === 'r'
    && event.source.unitId === 'b').reduce((sum, event) => sum + event.amount, 0);
  const hitCount = result.events.filter(event => event.type === 'damage' && event.source.id === inuyashaIds.ultimate).length;
  assert.ok(hitCount >= 7 && hitCount <= 14);
  assert.equal(result.state.resources.blue.fire, 0);
  assert.equal(result.state.units.r.stats.hp, Math.max(20000, 100000 - damage * .5));
  assert.ok(result.state.units.r.hp <= result.state.units.r.stats.hp);
  assert.equal(result.state.units.r.statuses.find(status => status.statusId === inuyashaIds.maxHpReduction)
    .values.originalMaxHp, 100000);

  const capped = applyEffectCommands(initial, [{ type: 'reduce-max-health', source: { kind: 'skill',
    id: inuyashaIds.ultimate, unitId: 'b' }, targetId: 'r', amount: 1000000, minimumRatio: .2,
    statusId: inuyashaIds.maxHpReduction }], 'effect-resolution', 'inuyasha-black-cap',
  id => registry.getStatus(id)).state;
  assert.equal(capped.units.r.stats.hp, 20000);
  assert.equal(capped.units.r.hp, 20000);
});

test('犬夜叉鬼火反击会在正式战斗资源支付阶段插入反击动作', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: 1, stats: { ...initial.units.b.stats, attack: 10, speed: 300 } };
  initial.units.r = { ...initial.units.r, heroId: 313, skillLevel: 5,
    stats: { ...initial.units.r.stats, attack: 100, speed: 100 },
    statuses: [{ instanceId: `${inuyashaIds.wind}:r`, statusId: inuyashaIds.wind,
      source: { kind: 'skill', id: inuyashaIds.basic, unitId: 'r' }, stacks: 5, duration: { kind: 'permanent' } }] };
  initial.resources.blue.fire = 3;
  const registry = new ContentRegistry(); registerInuyasha(registry);
  const spend = { id: 'fire-spender', resourceCost: { resourceId: 'fire', amount: 2 }, target: 'single',
    targetRelation: 'enemy', levels: [{}], execute: (context, intent) => [{ type: 'deal-damage',
      source: { kind: 'skill', id: 'fire-spender', unitId: intent.actorId }, targetId: intent.targetIds[0], amount: 100 } ] };
  registry.registerHero({ id: 1, skills: [spend], policy: () => ({ actorId: 'b', skillId: 'fire-spender',
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }) });
  const result = runBattle(initial, registry, { actionLimit: 1, seed: 9 });
  assert.ok(result.events.some(event => event.type === 'action-scheduled' && event.source.id === inuyashaIds.counter
    && event.scheduling === 'counter'));
  assert.ok(result.events.some(event => event.type === 'attack-ended' && event.source.id === inuyashaIds.counter));
});

test('raw formula handles negative additions, target reduction, penetration and crit resistance independently', () => {
  assert.equal(calcRawAttackDmg(formula({ attack: 6000, defense: 0, hurtAdditionRate: -.5 })).rawDamage, 4000);
  assert.equal(calcRawAttackDmg(formula({ attack: 7500, defense: 0, targetHurtReductionRate: .25 })).rawDamage, 6000);
  assert.equal(calcRawAttackDmg(formula({ defenseReduction: { ignoreDefenseValue: 100, ignoreDefanseRate: .5 } })).defenseUsed, 276);
  assert.equal(calcRawAttackDmg(formula({ defenseOverride: () => 0 })).defenseUsed, 0);
  const initial = state();
  initial.units.r.damageAttributes = { critResist: .8 };
  const context = createBattleContext(initial, () => .5);
  assert.equal(context.calculateDamage({ attack: 1000, defense: 0, ratio: 1, critChance: 1, critDamage: 2 }, initial.units.b, initial.units.r).isCritical, false);
});

test('P1: before/after callbacks, shield, rebound, leech and extra HP run in game order', () => {
  const order = [];
  const result = calcAttackDmg(formula({ attack: 3000, defense: 0, shieldHp: 2000, shieldDmgAddRate: .5,
    reboundRate: .3, leechRate: .2, extHp: 100, extHpAbsorptionRate: 2,
    random: () => { order.push('roll'); return .5; },
    before: [input => { order.push('before'); return input; }], after: [damage => { order.push('after'); return damage; }] }));
  assert.deepEqual(order, ['before', 'roll', 'roll', 'after']);
  assert.equal(result.consumeShield, 2000);
  assert.equal(result.hurtBeforeAbsorb, 3000);
  assert.equal(result.reboundDamage, 900);
  assert.equal(result.leechDamage, 200);
  assert.equal(result.damage, 800);
  assert.equal(result.consumeExtHp, 100);
  assert.equal(calcAttackDmg(formula({ attack: 2000, defense: 0, reboundRate: .0001 })).reboundDamage, 1);
  assert.deepEqual(calcShieldAbsorb(3000, 2000, .5), { damage: 1000, consumeShield: 2000 });
  assert.deepEqual(calcExtHpAbsorb(5, 10, 2), { damage: 0, consumed: 3 });
});

test('P1: serious injury records deferred nonnegative reductions', () => {
  const result = calcRawAttackDmg(formula({ seriousInjury: true, targetHurtReductionRate: .3, hurtReductionRate: .25 }));
  assert.equal(result.defenseUsed, 0);
  assert.equal(result.recordDefense, 652);
  assert.equal(result.recordHurtReductionRate, .3);
  assert.equal(result.recordIndirectHurtReductionRate, .25);
  assert.equal(result.rawDamage, result.hpChange);
  assert.equal(calcRawAttackDmg(formula({ seriousInjury: true, targetHurtReductionRate: -.3 })).recordHurtReductionRate, 0);
});

test('P1: production effects consume shields separately and absorb extra HP before real HP', () => {
  const initial = state();
  initial.units.r = { ...initial.units.r, shield: 2000, resources: { extHp: 100 }, damageAttributes: { hurtReboundRate: .3, extHpAbsorptionRate: 2 } };
  initial.units.b = { ...initial.units.b, hp: 9000, damageAttributes: { leechRate: .2 } };
  const result = applyEffectCommands(initial, [{ type: 'deal-damage', source, targetId: 'r', amount: 3000, shieldDmgAddRate: .5 }], 'hit');
  assert.equal(result.state.units.r.hp, 9200);
  assert.equal(result.state.units.r.shield, 0);
  assert.equal(result.state.units.r.resources.extHp, 0);
  assert.equal(result.state.units.b.hp, 8300); // -900 rebound +200 leech
  assert.equal(result.events[0].leechDamage, 200);
  assert.equal(result.events[0].shieldConsumed, 2000);
  assert.equal(result.events.filter(event => event.type === 'damage').length, 2);
});

test('P1: immunity and shield bypass cannot leak damage through extra HP', () => {
  for (const flag of ['damageImmune', 'absorbAllDamage']) {
    const initial = state();
    initial.units.r = { ...initial.units.r, shield: 1000, resources: { extHp: 50 }, damageAttributes: { [flag]: true } };
    const result = applyEffectCommands(initial, [{ type: 'deal-damage', source, targetId: 'r', amount: 3000 }], 'hit');
    assert.equal(result.state.units.r.hp, 10000);
    assert.equal(result.state.units.r.resources.extHp, 50);
  }
  const initial = state(); initial.units.r.shield = 2000;
  const result = applyEffectCommands(initial, [{ type: 'deal-damage', source, targetId: 'r', amount: 3000, ignoreShield: true }], 'hit');
  assert.equal(result.state.units.r.hp, 7000); assert.equal(result.state.units.r.shield, 2000);
});

test('P1: registered callbacks are invoked on both participants in a real battle', () => {
  const initial = state(), registry = new ContentRegistry(), order = [];
  initial.units.b.stats = { ...initial.units.b.stats, speed: 200 };
  for (const heroId of [1, 2]) registry.registerHero({ id: heroId, skills: [createBasicAttackSkill('basic', [1])],
    beforeCalculateDamage(input) { order.push('before' + heroId); return { ...input, attack: 1000 }; },
    afterCalculateDamage(amount) { order.push('after' + heroId); return amount + 10; },
    policy(context, actorId) { return { actorId, skillId: 'basic', targetIds: [actorId === 'b' ? 'r' : 'b'], shape: 'single', targetRelation: 'enemy' }; } });
  const result = runBattle(initial, registry, { actionLimit: 1, seed: 1 });
  assert.deepEqual(order, ['before1', 'before2', 'after1', 'after2']);
  assert.equal(result.state.units.r.hp, 8980);
});

test('P2: extra turns have priority and preserve action bars; equal-speed teams alternate', () => {
  let initial = state(); initial.units.b.actionGauge = 37;
  initial = applyEffectCommands(initial, [{ type: 'schedule-turn', source, unitId: 'b', scheduling: 'extra-turn', selection: 'action-gauge' }], 'hit').state;
  const extra = scheduleNextActor(initial, () => .5);
  assert.equal(extra.actorId, 'b'); assert.equal(extra.state.units.b.actionGauge, 37);
  assert.equal(extra.state.units.r.actionGauge, 0); assert.equal(extra.scheduling, 'extra-turn');
  initial = state();
  initial.units.b2 = unit('b2', 'blue'); initial.units.r2 = unit('r2', 'red');
  initial.sides = { blue: ['b', 'b2'], red: ['r', 'r2'] };
  const sides = [];
  for (let n = 0; n < 8; n++) { const next = scheduleNextActor(initial, () => 0); initial = next.state; sides.push(initial.units[next.actorId].side); }
  assert.deepEqual(sides, ['blue', 'red', 'blue', 'red', 'blue', 'red', 'blue', 'red']);
});

test('P2: a pre-resolved counter finishes inside its originating action without advancing turns', () => {
  const initial = state(); initial.counters.action = 7;
  const result = applyEffectCommands(initial, [{ type: 'schedule-attack', source,
    intent: { actorId: 'b', skillId: 'basic', targetIds: ['r'], shape: 'single' }, scheduling: 'counter', hits: [{ targetId: 'r', amount: 100 }] }], 'hit');
  assert.equal(result.state.counters.action, 7);
  assert.equal(result.state.units.b.actionGauge, 0);
  assert.equal(result.events.at(-1).type, 'attack-ended');
});

test('P2: scheduled counter interrupts a multi-hit action and restores the parent hit scope', () => {
  const initial = state(), registry = new ContentRegistry(), dispatcher = new EventDispatcher();
  const intent = { actorId: 'b', skillId: 'multi', targetIds: ['r'], shape: 'single', targetRelation: 'enemy' };
  registry.registerHero({ id: 1, skills: [{ id: 'multi', target: 'single', targetRelation: 'enemy', levels: [{}],
    execute: () => [1, 2].map(() => ({ type: 'deal-damage', source, targetId: 'r', amount: 100 })) }] });
  registry.registerHero({ id: 2, skills: [{ id: 'counter', target: 'single', targetRelation: 'enemy', levels: [{}],
    execute: () => [{ type: 'deal-damage', source: { ...source, unitId: 'r', id: 'counter' }, targetId: 'b', amount: 50 }] }] });
  dispatcher.register({ id: 'counter', phase: 'hit', priority: 0, handle(context, event) {
    if (event.type === 'damage' && event.source.unitId === 'b' && event.hitIndex === 1) return [{ type: 'schedule-action',
      source: { ...source, unitId: 'r' }, scheduling: 'counter', freeCast: true,
      intent: { actorId: 'r', skillId: 'counter', targetIds: ['b'], shape: 'single', targetRelation: 'enemy' } }];
  } });
  const result = executeAction(initial, intent, registry, () => .5, { dispatcher });
  const hits = result.events.filter(event => event.type === 'damage');
  assert.deepEqual(hits.map(event => event.source.unitId), ['b', 'r', 'b']);
  assert.deepEqual(hits.map(event => event.attackId), [1, 2, 1]);
  assert.deepEqual(hits.map(event => event.hitIndex), [1, 1, 2]);
  assert.equal(result.state.counters.action, 1);
  assert.equal(result.state.counters.attack, 2);
  assert.equal(new Set(result.events.map(event => event.eventId)).size, result.events.length);
});

test('P1: before-hook damage options reach late reduction after the after-hook', () => {
  const initial = state(), registry = new ContentRegistry();
  registry.registerHero({ id: 1, skills: [createBasicAttackSkill('basic', [1])],
    beforeCalculateDamage: input => ({ ...input, attack: 1000, hurtReductionRate: .25, fixedHurtReductionVal: 100 }),
    afterCalculateDamage: amount => amount + 500,
    policy: () => ({ actorId: 'b', skillId: 'basic', targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }) });
  initial.units.b.stats = { ...initial.units.b.stats, speed: 200 };
  const result = runBattle(initial, registry, { actionLimit: 1 });
  assert.equal(result.state.units.r.hp, 8900); // (1000 +500)/1.25 -100
});

test('P3: defeat supplies +2 for onmyoji and +1 for each shikigami, with normal cap', () => {
  const initial = state(); initial.units.b.unitKind = 'onmyoji';
  initial.units.b2 = unit('b2', 'blue');
  initial.units.b3 = unit('b3', 'blue');
  const dispatcher = new EventDispatcher(); registerPvpRules(dispatcher);
  const events = ['b', 'b2', 'b3'].map(unitId => ({ eventId: 'dead-' + unitId, phase: 'unit-defeated', source, type: 'unit-defeated', unitId }));
  const result = settleEvents(initial, events, dispatcher, () => .5);
  assert.equal(result.state.resources.blue.fire, 4);
  assert.deepEqual(result.events.filter(event => event.type === 'resource-changed').map(event => event.after - event.before), [2, 1, 1]);
});

test('P3: turn-end supply works for extra turns and honors meter-blocking definitions', () => {
  const initial = state(); initial.resourceMeters.blue.fire.progress = 4;
  const event = { eventId: 'end', phase: 'turn-end', source, type: 'turn-ended', unitId: 'b', scheduling: 'extra-turn' };
  const dispatcher = new EventDispatcher(); registerPvpRules(dispatcher, () => ({ blocksResourceMeterAdvance: true }));
  const result = settleEvents(initial, [event], dispatcher, () => .5);
  assert.equal(result.state.resources.blue.fire, 3);
  initial.units.b.statuses = [{ statusId: 'block' }];
  assert.equal(settleEvents(initial, [event], dispatcher, () => .5).state.resources.blue.fire, 0);
});

test('P3: repeated casts recompute entity-specific cost reductions against current state', () => {
  const initial = state(), registry = new ContentRegistry(); initial.resources.blue.fire = 6;
  const status = { instanceId: 'discount', statusId: 'discount', source, stacks: 1, duration: { kind: 'permanent' } };
  initial.units.b.statuses = [status]; initial.units.r.statuses = [{ ...status, statusId: 'foreign' }];
  registry.registerStatus({ id: 'discount', modifyResourceCost(state, actor, skill, cost) {
    return cost.amount - (actor.resources.casts ?? 0 ? 1 : 2);
  } });
  registry.registerStatus({ id: 'foreign', modifyResourceCost() { throw new Error('must not inspect another entity'); } });
  registry.registerHero({ id: 1, skills: [{ id: 'paid', target: 'self', targetRelation: 'ally', resourceCost: { resourceId: 'fire', amount: 3 },
    levels: [{}], execute: () => [] }] });
  const intent = { actorId: 'b', skillId: 'paid', targetIds: ['b'], shape: 'self', targetRelation: 'ally' };
  const first = executeAction(initial, intent, registry, () => .5);
  assert.equal(first.state.resources.blue.fire, 5);
  const secondState = { ...first.state, units: { ...first.state.units, b: { ...first.state.units.b, resources: { casts: 1 } } } };
  const second = executeAction(secondState, intent, registry, () => .5);
  assert.equal(second.state.resources.blue.fire, 3);
});

test('P4: decoded rows inherit base fields and cover every required hero skill', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(level => skillNumber(gameSkillRow(3561, level), 'addDmg')), [1, 1.05, 1.1, 1.2, 1.25]);
  assert.equal(skillNumber(gameSkillRow(3561, 5), 'dmgFluctuation'), .01);
  assert.equal(skillNumber(gameSkillRow(35640, 1), 'consumeVal'), 2);
  assert.equal(gameSkillRow(3561, 1, 0), undefined);
  assert.equal(gameSkillCoverage.complete, true);
  assert.equal(gameSkillCoverage.rowCount, 18447);
  assert.equal(gameSkillCoverage.skillCount, 7178);
  assert.deepEqual(gameSkillCoverage.missingSkillIds, []);
  assert.equal(gameSkillCoverage.requiredSkillCount, 1566);
  assert.equal(gameSkillCoverage.runtimeAnchorCount, 8);
  assert.equal(skillNumber(gameSkillRow(5983, 2, -1), 'addDmg'), 1.25);
  assert.equal(skillNumber(gameSkillRow(2973, 2, -1), 'param1'), .4);
  assert.equal(skillNumber(gameSkillRow(2873, 2, -1), 'maxCd'), 3);
  assert.equal(skillNumber(gameSkillRow(2673, 2, 0), 'param1'), 1);
});

test('P4: an executed action uses the decoded addDmg and native fluctuation fields', () => {
  const registry = new ContentRegistry();
  registry.registerHero({ id: 9000, skills: [createBasicAttackSkill('3561', [.5, .6, .7, .8, .9])] });
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: 9000, skillLevel: 5,
    stats: { ...initial.units.b.stats, attack: 100 } };
  initial.units.r = { ...initial.units.r, hp: 1000, shield: 0,
    stats: { ...initial.units.r.stats, hp: 1000, defense: 0 } };
  const result = executeAction(initial, { actorId: 'b', skillId: '3561', targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .5);
  assert.equal(result.accepted, true);
  const hit = result.events.find(event => event.type === 'damage' && event.source.id === '3561');
  assert.ok(hit);
  assert.ok(hit.amount > 123.75 && hit.amount < 126.25,
    `skill 3561 rank 5 uses native 1.25x table data with 1% fluctuation; got ${hit.amount}`);
});

test('P5: verified AI weights drive opt-in candidate selection; missing sequences stay on fallback', () => {
  const initial = state(), actor = initial.units.b, target = initial.units.r;
  const rule = { baseWeight: 1, factors: [{ kind: 'CampMatch', side: 'enemy' }, { kind: 'MonsterId', heroId: 2 }, { kind: 'HasNotBuff', statusId: 'stun' }] };
  assert.equal(scoreAiTarget(actor, target, rule), 220);
  const skill = { id: 'basic', target: 'single', targetRelation: 'enemy', levels: [{}], aiRule: rule };
  assert.equal(selectWeightedAction(createBattleContext(initial, () => .5), actor, [skill]).targetIds[0], 'r');
  assert.equal(selectWeightedAction(createBattleContext(initial, () => .5), actor, [{ ...skill, aiRule: undefined }]), undefined);
});

test('P6: metric formulas and bet-relative side mapping cannot accidentally use winner labels', () => {
  const dataset = [{ time: 1, official_winner: '红方' }, { time: 2, official_winner: '蓝方' }];
  const report = evaluate(dataset, { 1: { p_red: .5 }, 2: { p_red: .5 } });
  assert.equal(report.brier, .25); assert.equal(report.logloss, Math.log(2));
  assert.throws(() => evaluate(dataset, { 1: { p_red: .5 } }), /Missing/);
  const row = { time: 1, my_group: 1, left_heroes: [356], right_heroes: [227], official_winner: '红方' };
  assert.equal(rosterInput(row).blue[0].heroId, 356);
  assert.equal(rosterInput({ ...row, official_winner: '蓝方' }).blue[0].heroId, 356);
});

test('P2: the full-turn queue survives speed changes and extra turns without moving other positions', () => {
  let initial = state();
  initial.units.b = { ...initial.units.b, turnPos: 90, actionGauge: 75, stats: { ...initial.units.b.stats, speed: 100 } };
  initial.units.r = { ...initial.units.r, turnPos: 60, actionGauge: 50, stats: { ...initial.units.r.stats, speed: 200 } };
  const first = scheduleNextActor(initial, () => 0);
  assert.equal(first.actorId, 'r');
  assert.deepEqual(first.state.scheduling.normalTurns, ['b']);
  initial = { ...first.state, units: { ...first.state.units,
    b: { ...first.state.units.b, stats: { ...first.state.units.b.stats, speed: 1 } } } };
  initial = applyEffectCommands(initial, [{ type: 'schedule-turn', source, unitId: 'r', scheduling: 'extra-turn', selection: 'action-gauge' }], 'hit').state;
  const extra = scheduleNextActor(initial, () => 0);
  assert.equal(extra.actorId, 'r'); assert.equal(extra.state.units.b.turnPos, 120);
  const second = scheduleNextActor(extra.state, () => 0);
  assert.equal(second.actorId, 'b'); assert.equal(second.state.units.r.turnPos, 0);
  assert.equal(scheduleNextActor({ ...state(), units: { b: { ...unit('b', 'blue'), stats: { ...unit('b', 'blue').stats, speed: 0 } } } }, () => 0), undefined);
});

test('P2: directional turn-position immunity emits a source-linked event and can be explicitly bypassed', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, turnPos: 60, actionGauge: 50,
    statuses: [{ statusId: 'push-immune' }] };
  const resolve = () => ({ preventsActionGaugeDecrease: true });
  const command = { type: 'change-action-gauge', source, targetId: 'b', amount: -25, parentEventId: 'push' };
  const blocked = applyEffectCommands(initial, [command], 'hit', 'immune', resolve);
  assert.equal(blocked.state.units.b.turnPos, 60);
  assert.equal(blocked.events[0].blockedByImmunity, true);
  assert.equal(blocked.events[0].parentEventId, 'push');
  const pulled = applyEffectCommands(initial, [{ ...command, amount: 25 }], 'hit', 'pull', resolve);
  assert.equal(pulled.state.units.b.turnPos, 90);
  const bypassed = applyEffectCommands(initial, [{ ...command, checkImmunity: false }], 'hit', 'bypass', resolve);
  assert.equal(bypassed.state.units.b.turnPos, 30);
});

test('P5: native target thresholds and camp penalties do not influence skill priority', () => {
  const initial = state(), actor = initial.units.b, target = { ...initial.units.r, hp: 2500 };
  const rule = factors => ({ baseWeight: 0, factors });
  assert.equal(scoreAiTarget(actor, target, rule([{ kind: 'HPLower', threshold: 40 }])), 65);
  assert.equal(scoreAiTarget(actor, target, rule([{ kind: 'HPHigher', threshold: 40 }])), 50);
  assert.equal(scoreAiTarget(actor, target, rule([{ kind: 'AbsHPLower', threshold: 40 }])), -2450);
  assert.equal(scoreAiTarget(actor, target, rule([{ kind: 'CampMatch', side: 'ally' }])), 0);
  const skill = { id: 'low', target: 'single', targetRelation: 'enemy', levels: [{}],
    aiRule: { baseWeight: 1, factors: [{ kind: 'MonsterId', heroId: 2 }] } };
  const better = { ...skill, id: 'high', aiRule: { baseWeight: 2, factors: [] } };
  assert.equal(selectWeightedAction(createBattleContext(initial, () => .5), actor, [skill, better]).skillId, 'high');
});

test('络新妇蛛印追击耗火技能，噬心毒液按速度差结算回合后间接伤害', () => {
  const registry = new ContentRegistry(); registerLuoxinfufu(registry);
  const definition = registry.getHero(luoxinfufuIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: luoxinfufuIds.hero, awakeFilter: 1, skillLevel: 5,
    skillLevels: { [luoxinfufuIds.passive]: 1, [luoxinfufuIds.ultimate]: 5 },
    stats: { ...initial.units.b.stats, attack: 1000, speed: 100, hit: 0 } };
  initial.units.r = { ...initial.units.r, heroId: 44, skillLevel: 1, awakeFilter: 0,
    stats: { ...initial.units.r.stats, hp: 10000, resist: 0, speed: 100 } };
  const markHit = { eventId: 'spider-mark-hit', phase: 'hit', source: { kind: 'skill', id: luoxinfufuIds.basic, unitId: 'b' },
    type: 'damage', targetId: 'r', amount: 100, hpLost: 100, mitigated: 0, damageKind: 'normal', isCritical: false };
  const markCommands = definition.handlers.hit.handle(createBattleContext(initial, () => .1), markHit);
  initial = applyEffectCommands(initial, markCommands, 'effect-resolution', 'spider-mark', id => registry.getStatus(id)).state;
  const mark = initial.units.r.statuses.find(status => status.statusId === luoxinfufuIds.mark);
  assert.equal(mark.duration.remaining, 2);
  const fireSkill = definition.handlers['action-end'].handle(createBattleContext(initial, () => .5), {
    eventId: 'marked-target-fire-skill', phase: 'action-end', source: { kind: 'skill', id: luoxinfufuIds.ultimate, unitId: 'r' },
    type: 'action-ended', actionKind: 'skill', skillId: luoxinfufuIds.ultimate,
    intent: { actorId: 'r', skillId: luoxinfufuIds.ultimate, targetIds: ['b'], shape: 'single', targetRelation: 'enemy' },
    soulTriggersAllowed: true,
  });
  assert.ok(fireSkill.some(command => command.type === 'lose-life' && command.lifeLossKind === 'indirect'));
  assert.ok(fireSkill.some(command => command.type === 'add-status' && command.instance.modifiers[0].amount === -20));

  const noStun = definition.handlers.hit.handle(createBattleContext(initial, () => .5), {
    ...markHit, eventId: 'spider-ultimate-hit', source: { kind: 'skill', id: luoxinfufuIds.ultimate, unitId: 'b' },
  });
  const venom = noStun.find(command => command.type === 'add-status' && command.instance.statusId === luoxinfufuIds.venom);
  assert.equal(venom.instance.values.indirectDamageRatio, 1.36);
  const venomState = applyEffectCommands(initial, [venom], 'effect-resolution', 'spider-venom', id => registry.getStatus(id)).state;
  const tick = registry.getStatus(luoxinfufuIds.venom).handlers['turn-end'].handle(createBattleContext(venomState, () => .5),
    { eventId: 'spider-venom-turn-end', phase: 'turn-end', source, type: 'turn-ended', unitId: 'r' });
  assert.ok(tick.some(command => command.type === 'lose-life' && command.lifeLossKind === 'indirect'));
  assert.equal(gameSkillRow(2703, 5, -1).consumeVal, 3);

  const battle = { ...initial, units: { ...initial.units, r: { ...initial.units.r, statuses: [] },
    r2: { ...unit('r2', 'red'), stats: { ...unit('r2', 'red').stats, resist: 0, speed: 100 } } },
    sides: { ...initial.sides, red: ['r', 'r2'] }, resources: { blue: { fire: 3 }, red: { fire: 0 } } };
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'spider-hit', phase: 'hit', priority: 100, handle: definition.handlers.hit.handle });
  dispatcher.register({ id: 'spider-blocked-stun', phase: 'control-application', priority: 100,
    handle: definition.handlers['control-application'].handle });
  const cast = executeAction(battle, { actorId: 'b', skillId: luoxinfufuIds.ultimate, targetIds: ['r', 'r2'],
    shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .5, { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(cast.accepted, true);
  assert.equal(cast.state.resources.blue.fire, 0);
  assert.equal(cast.events.filter(event => event.type === 'damage' && event.source.id === luoxinfufuIds.ultimate).length, 2);
  for (const id of ['r', 'r2']) assert.ok(cast.state.units[id].statuses.some(status => status.statusId === luoxinfufuIds.venom));
});

test('一目连风符·破偷攻，风符·护破裂伤害推条，风神之佑复施强化并治疗', () => {
  const registry = new ContentRegistry(); registerYiMuLian(registry);
  const definition = registry.getHero(yiMuLianIds.hero), resolveStatus = id => registry.getStatus(id);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: yiMuLianIds.hero, skillLevel: 5,
    skillLevels: { [yiMuLianIds.basic]: 5, [yiMuLianIds.guard]: 3, [yiMuLianIds.blessing]: 5 },
    stats: { ...initial.units.b.stats, hp: 20000, attack: 5000 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, resist: 0 } };
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'yimulian-hit', phase: 'hit', priority: 45, handle: definition.handlers.hit.handle });
  dispatcher.register({ id: 'yimulian-effects', phase: 'effect-resolution', priority: 45,
    handle: definition.handlers['effect-resolution'].handle });
  const stolen = executeAction(initial, { actorId: 'b', skillId: yiMuLianIds.basic,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, registry, () => .1,
  { dispatcher, resolveStatus });
  assert.equal(stolen.accepted, true);
  assert.equal(effectiveStats(stolen.state.units.r).attack, 4000);
  assert.equal(effectiveStats(stolen.state.units.b).attack, 6000);
  assert.equal(stolen.state.units.r.statuses.find(status => status.statusId === yiMuLianIds.attackDown).duration.remaining, 2);

  const guardState = { ...initial, units: { ...initial.units,
    b: { ...initial.units.b, skillLevel: 3, skillLevels: { ...initial.units.b.skillLevels, [yiMuLianIds.guard]: 3 } },
    a: { ...unit('a', 'blue'), hp: 10000, actionGauge: 60, stats: { ...unit('a', 'blue').stats, hp: 10000 } } },
    sides: { ...initial.sides, blue: ['b', 'a'] }, resources: { blue: { fire: 2 }, red: { fire: 0 } } };
  const guardCast = executeAction(guardState, { actorId: 'b', skillId: yiMuLianIds.guard,
    targetIds: ['a'], shape: 'single', targetRelation: 'ally' }, registry, () => .5,
  { resolveStatus });
  assert.equal(guardCast.state.resources.blue.fire, 0);
  const guard = guardCast.state.units.a.statuses.find(status => status.statusId === yiMuLianIds.windGuard);
  assert.equal(guard.values.shieldRemaining, 2000);
  const preemptiveState = { ...guardState, units: { ...guardState.units,
    b: { ...guardState.units.b, skillLevels: { ...guardState.units.b.skillLevels, [yiMuLianIds.guard]: 4 } },
    a: { ...guardState.units.a, stats: { ...guardState.units.a.stats, attack: 7000 } } } };
  const preemptive = definition.handlers['battle-start'].handle(createBattleContext(preemptiveState), {
    eventId: 'yimulian-battle-start', phase: 'battle-start', source, type: 'battle-started',
  });
  assert.ok(preemptive.some(command => command.type === 'add-status' && command.targetId === 'a'
    && command.instance.statusId === yiMuLianIds.windGuard));
  const depletedState = { ...guardCast.state, resources: { ...guardCast.state.resources, red: { fire: 0 } },
    units: { ...guardCast.state.units, a: { ...guardCast.state.units.a, statuses: [{ ...guard,
      values: { ...guard.values, shieldRemaining: 0 } }] }, r2: { ...unit('r2', 'red'), actionGauge: 60 } },
    sides: { ...guardCast.state.sides, red: ['r', 'r2'] } };
  const breakCommands = definition.handlers.hit.handle(createBattleContext(depletedState), {
    eventId: 'yimulian-guard-break', phase: 'hit', source: { kind: 'skill', id: 'test.attack', unitId: 'r' },
    type: 'damage', targetId: 'a', amount: 10000, hpLost: 0, mitigated: 2000, shieldConsumed: 2000,
    damageKind: 'normal', isCritical: false,
  });
  assert.equal(breakCommands[0].type, 'remove-status-instances');
  const removed = applyEffectCommands(depletedState, breakCommands, 'hit', 'yimulian-break', resolveStatus);
  const boom = definition.handlers['effect-resolution'].handle(createBattleContext(removed.state), removed.events[0]);
  assert.equal(boom.filter(command => command.type === 'deal-damage' && command.damageKind === 'true').length, 2);
  assert.equal(boom.filter(command => command.type === 'change-action-gauge' && command.amount === -20).length, 2);
  const expiryBoom = definition.handlers['status-expiration'].handle(createBattleContext(depletedState), {
    eventId: 'yimulian-guard-expiry', phase: 'status-expiration', source: guard.source, type: 'status-removed',
    targetId: 'a', instanceId: guard.instanceId, statusId: yiMuLianIds.windGuard, removedSource: guard.source,
    removedValues: guard.values, reason: 'expired',
  });
  assert.equal(expiryBoom.filter(command => command.type === 'deal-damage').length, 2);

  const blessingState = { ...guardState, resources: { blue: { fire: 3 }, red: { fire: 0 } },
    units: { ...guardState.units, a: { ...guardState.units.a, hp: 5000, statuses: [{
      instanceId: 'prior-wind-blessing', statusId: yiMuLianIds.windBlessing,
      source: { kind: 'skill', id: yiMuLianIds.blessing, unitId: 'b' }, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { shieldRemaining: 1000 },
    }] } } };
  const blessingCast = executeAction(blessingState, { actorId: 'b', skillId: yiMuLianIds.blessing,
    targetIds: ['b', 'a'], shape: 'all-allies', targetRelation: 'ally' }, registry, () => .5, { resolveStatus });
  assert.equal(blessingCast.state.resources.blue.fire, 0);
  assert.equal(blessingCast.state.units.a.hp, 5800);
  assert.ok(blessingCast.state.units.a.statuses.some(status => status.statusId === yiMuLianIds.recastBlessing));
  assert.equal(blessingCast.state.units.a.statuses.find(status => status.statusId === yiMuLianIds.windBlessing)
    .values.shieldRemaining, 1800);

  let trackerState = { ...guardState, units: { ...guardState.units,
    b: { ...guardState.units.b, skillLevels: { ...guardState.units.b.skillLevels, [yiMuLianIds.guard]: 5 }, statuses: [{
      instanceId: 'tracking-wind-guard', statusId: yiMuLianIds.windGuard,
      source: { kind: 'skill', id: yiMuLianIds.guard, unitId: 'b' }, stacks: 1,
      duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, values: { shieldRemaining: 500 },
    }] }, r: { ...guardState.units.r, actionGauge: 60 }, r2: { ...unit('r2', 'red'), actionGauge: 60 } },
    sides: { blue: ['b', 'a'], red: ['r', 'r2'] } };
  for (let i = 0; i < 4; i += 1) {
    const commands = definition.handlers['effect-resolution'].handle(createBattleContext(trackerState, () => .5,
      id => registry.getStatus(id)?.category, id => registry.getStatus(id)?.dispellable === true), {
      eventId: `yimulian-debuff-${i}`, phase: 'effect-resolution', source: { kind: 'skill', id: 'test.debuff', unitId: 'r' },
      type: 'status-added', targetId: 'b', instance: { instanceId: `test.debuff:${i}`,
        statusId: yiMuLianIds.attackDown, source: { kind: 'skill', id: 'test.debuff', unitId: 'r' },
        stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' } },
    });
    trackerState = applyEffectCommands(trackerState, commands ?? [], 'effect-resolution', `yimulian-tracker-${i}`, resolveStatus).state;
  }
  assert.equal(trackerState.units.r.actionGauge, 45);
  assert.equal(trackerState.units.r2.actionGauge, 45);
});

test('青坊主佛光因友方受控叠层、提供抵抗、回合末衰减并抑制禅心伤害', () => {
  const registry = new ContentRegistry(); registerQingfangzhu(registry);
  const definition = registry.getHero(qingfangzhuIds.hero), resolveStatus = id => registry.getStatus(id);
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'hero:273:battle-start', phase: 'battle-start', priority: 45,
    handle: definition.handlers['battle-start'].handle });
  dispatcher.register({ id: 'hero:273:control', phase: 'control-application', priority: 45,
    handle: definition.handlers['control-application'].handle });
  dispatcher.register({ id: 'hero:273:effects', phase: 'effect-resolution', priority: 45,
    handle: definition.handlers['effect-resolution'].handle });
  dispatcher.register({ id: 'hero:273:turn-end', phase: 'turn-end', priority: 45,
    handle: definition.handlers['turn-end'].handle });
  dispatcher.register({ id: 'hero:273:defeat', phase: 'unit-defeated', priority: 45,
    handle: definition.handlers['unit-defeated'].handle });
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: qingfangzhuIds.hero, skillLevel: 5,
    skillLevels: { [qingfangzhuIds.passive]: 1, [qingfangzhuIds.ultimate]: 5 },
    stats: { ...initial.units.b.stats, attack: 1000 } };
  initial.units.a = { ...unit('a', 'blue') };
  initial.sides.blue.push('a');
  let started = settleEvents(initial, [{ eventId: 'qingfangzhu-start', phase: 'battle-start', source,
    type: 'battle-started' }], dispatcher, () => .5, undefined, resolveStatus);
  initial = started.state;
  assert.equal(initial.units.b.statuses.find(status => status.statusId === qingfangzhuIds.light).stacks, 1);
  assert.equal(effectiveStats(initial.units.b).resist, 1.29);
  assert.equal(effectiveStats(initial.units.a).resist, 1.14);

  for (let i = 0; i < 8; i += 1) {
    initial = settleEvents(initial, [{ eventId: `qingfangzhu-control-${i}`, phase: 'control-application',
      source: { kind: 'skill', id: 'enemy.control', unitId: 'r' }, type: 'control-applied', targetId: 'a',
      statusId: 'test.control', newlyControlled: true }], dispatcher, () => .5, undefined, resolveStatus).state;
  }
  assert.equal(initial.units.b.statuses.find(status => status.statusId === qingfangzhuIds.light).stacks, 6);
  assert.equal(effectiveStats(initial.units.a).resist, 1.89);
  initial = settleEvents(initial, [{ eventId: 'qingfangzhu-turn-end', phase: 'turn-end', source,
    type: 'turn-ended', unitId: 'b' }], dispatcher, () => .5, undefined, resolveStatus).state;
  assert.equal(initial.units.b.statuses.find(status => status.statusId === qingfangzhuIds.light).stacks, 5);
  assert.equal(initial.units.a.statuses.find(status => status.statusId === qingfangzhuIds.lightAura).stacks, 5);
  const defeat = settleEvents(initial, [{ eventId: 'qingfangzhu-defeat', phase: 'unit-defeated', source,
    type: 'unit-defeated', unitId: 'b' }], dispatcher, () => .5, undefined, resolveStatus).state;
  assert.equal(defeat.units.b.statuses.some(status => status.statusId === qingfangzhuIds.light), false);
  assert.equal(defeat.units.a.statuses.some(status => status.statusId === qingfangzhuIds.lightAura), false);

  const attackStart = state();
  const light = { instanceId: `${qingfangzhuIds.light}:b`, statusId: qingfangzhuIds.light,
    source: { kind: 'skill', id: qingfangzhuIds.passive, unitId: 'b' }, stacks: 6, duration: { kind: 'permanent' },
    modifiers: [{ stat: 'resist', operation: 'flat', amount: .3, perStack: true }] };
  attackStart.units.b = { ...attackStart.units.b, heroId: qingfangzhuIds.hero, skillLevel: 5,
    skillLevels: { [qingfangzhuIds.ultimate]: 5 }, statuses: [light],
    stats: { ...attackStart.units.b.stats, hp: 10000, attack: 1000, defense: 0, crit: 0 } };
  attackStart.units.r = { ...attackStart.units.r, unitKind: 'summon', hp: 100000,
    stats: { ...attackStart.units.r.stats, hp: 100000, defense: 0, resist: 0 } };
  attackStart.units.r2 = { ...unit('r2', 'red'), hp: 100000,
    stats: { ...unit('r2', 'red').stats, hp: 100000, defense: 0, resist: 0 } };
  attackStart.sides.red = ['r', 'r2'];
  attackStart.resources.blue.fire = 3;
  const cast = executeAction(attackStart, { actorId: 'b', skillId: qingfangzhuIds.ultimate,
    targetIds: ['r', 'r2'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .5, { resolveStatus });
  assert.equal(cast.state.resources.blue.fire, 0);
  const damage = cast.events.filter(event => event.type === 'damage' && event.source.id === qingfangzhuIds.ultimate);
  assert.equal(Math.round(damage.find(event => event.targetId === 'r').amount), 1776);
  assert.equal(Math.round(damage.find(event => event.targetId === 'r2').amount), 888);
});

test('妖刀姬暴击按被动等级永久叠加暴伤，并在回合开始达到350%时进入妖华', () => {
  const registry = new ContentRegistry(); registerYaodaoJi(registry);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: yaodaoJiIds.hero, skillLevel: 3,
    skillLevels: { [yaodaoJiIds.passive]: 3, [yaodaoJiIds.ultimate]: 3 },
    stats: { ...initial.units.b.stats, critDamage: 3.43 } };
  const hero = registry.getHero(yaodaoJiIds.hero);
  const critical = { eventId: 'yaodao-crit', phase: 'hit', source: { kind: 'skill', id: 'test.crit', unitId: 'b' },
    type: 'damage', targetId: 'r', amount: 100, hpLost: 100, mitigated: 0, damageKind: 'normal', isCritical: true };
  const growthCommands = hero.handlers.hit.handle(createBattleContext(initial), critical);
  assert.equal(growthCommands[0].instance.modifiers[0].amount, .07);
  initial = applyEffectCommands(initial, growthCommands, 'effect-resolution', 'yaodao-passive', id => registry.getStatus(id)).state;
  assert.equal(effectiveStats(initial.units.b).critDamage, 3.5);
  const awakened = hero.handlers['turn-start'].handle(createBattleContext(initial),
    { eventId: 'yaodao-turn-start', phase: 'turn-start', source, type: 'turn-started', unitId: 'b' });
  initial = applyEffectCommands(initial, awakened, 'effect-resolution', 'yaodao-awaken', id => registry.getStatus(id)).state;
  assert.ok(initial.units.b.statuses.some(status => status.statusId === yaodaoJiIds.yaohua));
  const flower = hero.skills.find(skill => skill.id === yaodaoJiIds.flower);
  assert.equal(flower.canUse(initial, initial.units.b), true);
  assert.equal(hero.skills.find(skill => skill.id === yaodaoJiIds.ultimate).canUse(initial, initial.units.b), false,
    '进入妖华后由百花缭乱替代杀戮');
});

test('妖刀姬杀戮击败目标后转向剩余敌人，五级每次换靶额外攻击2次', () => {
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: yaodaoJiIds.hero, skillLevel: 5,
    skillLevels: { [yaodaoJiIds.passive]: 1, [yaodaoJiIds.ultimate]: 5 },
    stats: { ...initial.units.b.stats, attack: 1000, crit: 0, critDamage: 2, speed: 10000 } };
  initial.units.r = { ...initial.units.r, hp: 1, stats: { ...initial.units.r.stats, hp: 1000, defense: 0, speed: 1 } };
  initial.units.r2 = { ...unit('r2', 'red'), hp: 100000, stats: { ...unit('r2', 'red').stats, hp: 100000, attack: 1, defense: 0, speed: 1 } };
  initial.sides.red = ['r', 'r2'];
  initial.resources.blue.fire = 3;
  const registry = new ContentRegistry(); registerYaodaoJi(registry);
  const result = runBattle(initial, registry, { seed: 269, actionLimit: 1 });
  const strikes = result.events.filter(event => event.type === 'damage' && event.source.id === yaodaoJiIds.ultimate);
  const progress = result.events.filter(event => event.type === 'status-added' && event.instance.statusId === yaodaoJiIds.attackChain)
    .map(event => event.instance.values.remainingHits);
  assert.equal(strikes.length, 8, `基础6击加首次换靶的2击；目标=${strikes.map(event => event.targetId).join(',')}；余击=${progress.join(',')}`);
  assert.equal(result.state.units.r.hp, 0);
  assert.ok(result.state.units.r2.hp < 100000);
  assert.ok(!result.state.units.b.statuses.some(status => status.statusId === yaodaoJiIds.attackChain));
  const yaohuaState = { ...initial, units: { ...initial.units, b: { ...initial.units.b, statuses: [{
    instanceId: `${yaodaoJiIds.yaohua}:b`, statusId: yaodaoJiIds.yaohua,
    source: { kind: 'skill', id: yaodaoJiIds.passive, unitId: 'b' }, stacks: 1, duration: { kind: 'permanent' },
  }] } } };
  const flowerResult = runBattle(yaohuaState, registry, { seed: 269, actionLimit: 1 });
  assert.equal(flowerResult.events.filter(event => event.type === 'damage' && event.source.id === yaodaoJiIds.flower).length, 8,
    '妖华状态的百花缭乱也沿用换靶连击并维持自身链状态');
});

test('古笼火灵运受击按技能等级概率返还1点鬼火，技能封印时不触发', () => {
  const registry = new ContentRegistry(); registerGulonghuo(registry);
  const definition = registry.getHero(gulonghuoIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: gulonghuoIds.hero, skillLevel: 3 };
  const damage = { eventId: 'gulonghuo-hit', phase: 'hit', source: { kind: 'skill', id: 'enemy.skill', unitId: 'r' },
    type: 'damage', targetId: 'b', amount: 1 };
  const commands = definition.handlers.hit.handle(createBattleContext(initial, () => .29), damage);
  assert.equal(commands[0].type, 'change-resource');
  assert.equal(commands[0].amount, 1);
  assert.equal(commands[0].resourceId, 'fire');
  assert.equal(definition.handlers.hit.handle(createBattleContext(initial, () => .31), damage), undefined);
  initial.units.b = { ...initial.units.b, statuses: [{ instanceId: 'seal', statusId: passiveSuppressionStatusId,
    source: { kind: 'skill', id: 'test', unitId: 'r' }, stacks: 1, duration: { kind: 'permanent' } }] };
  assert.equal(definition.handlers.hit.handle(createBattleContext(initial, () => 0), damage), undefined);
});

test('古笼火灵运行动结束时零鬼火回1点，非零鬼火不重复触发', () => {
  const registry = new ContentRegistry(); registerGulonghuo(registry);
  const definition = registry.getHero(gulonghuoIds.hero);
  const event = { eventId: 'gulonghuo-action', phase: 'action-end', source: { kind: 'skill', id: gulonghuoIds.basic, unitId: 'b' },
    type: 'action-ended', actionKind: 'basic', skillId: gulonghuoIds.basic, soulTriggersAllowed: true,
    intent: { actorId: 'b', skillId: gulonghuoIds.basic, targetIds: ['r'], shape: 'single', targetRelation: 'enemy' } };
  const empty = state(); empty.units.b = { ...empty.units.b, heroId: gulonghuoIds.hero };
  const recovered = definition.handlers['action-end'].handle(createBattleContext(empty), event);
  assert.equal(recovered[0].amount, 1);
  const withFire = { ...empty, resources: { ...empty.resources, blue: { fire: 1 } } };
  assert.equal(definition.handlers['action-end'].handle(createBattleContext(withFire), event), undefined);
});

test('古笼火恶戏之火允许非自身任意目标，友方必中，敌方仍受效果抵抗且附加增伤沉默', () => {
  const registry = new ContentRegistry(); registerGulonghuo(registry);
  const skill = registry.getHero(gulonghuoIds.hero).skills.find(item => item.id === gulonghuoIds.ultimate);
  assert.equal(skill.resourceCost.amount, 3);
  assert.equal(skill.targetRelation, 'any');
  let initial = state(); initial.units.b = { ...initial.units.b, heroId: gulonghuoIds.hero, skillLevel: 5 };
  initial.units.ally = { ...unit('ally', 'blue'), resist: .99 };
  initial.sides.blue = ['b', 'ally'];
  const intent = { actorId: 'b', skillId: gulonghuoIds.ultimate, targetIds: ['ally'], shape: 'single', targetRelation: 'any' };
  let commands = skill.execute(createBattleContext(initial, () => .99), intent, { rank: 5, damageBonus: .3 });
  assert.equal(commands[0].type, 'apply-control', '友方目标不因高效果抵抗而失败');
  assert.equal(commands[0].instance.duration.remaining, 2);
  assert.equal(commands[0].instance.modifiers[0].stat, 'damage');
  assert.equal(commands[0].instance.modifiers[0].amount, .3);

  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, resist: 0 } };
  commands = skill.execute(createBattleContext(initial, () => .5), { ...intent, targetIds: ['r'] }, { rank: 2, damageBonus: .15 });
  assert.equal(commands[0].type, 'apply-control');
  assert.equal(commands[0].instance.values.damageBonus, .15);
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, resist: .99 } };
  commands = skill.execute(createBattleContext(initial, () => .99), { ...intent, targetIds: ['r'] }, { rank: 2, damageBonus: .15 });
  assert.equal(commands[0].type, 'report-control-resisted');
});

test('万年竹回合结束获得护竹，友方受击按等级反击，自身受击必中且受控时停止', () => {
  const registry = new ContentRegistry(); registerWannianzhu(registry);
  const definition = registry.getHero(wannianzhuIds.hero);
  let initial = state(); initial.units.b = { ...initial.units.b, heroId: wannianzhuIds.hero, skillLevel: 1 };
  const turnEnd = { eventId: 'bamboo-turn-end', phase: 'turn-end', source: { kind: 'unit', id: '275', unitId: 'b' },
    type: 'turn-ended', unitId: 'b' };
  const guard = definition.handlers['turn-end'].handle(createBattleContext(initial), turnEnd);
  assert.equal(guard[0].instance.statusId, wannianzhuIds.guard);
  initial = applyEffectCommands(initial, guard, 'effect-resolution', 'bamboo-guard', id => registry.getStatus(id)).state;
  const attackEnd = { eventId: 'enemy-attack-end', phase: 'attack-end', source: { kind: 'skill', id: 'enemy.hit', unitId: 'r' },
    type: 'attack-ended', attackId: 5, hitCount: 1,
    targetHealthChanges: [{ targetId: 'b', hpBefore: 10000, hpAfter: 9900, hpLost: 100 },
      { targetId: 'b2', hpBefore: 10000, hpAfter: 9900, hpLost: 100 }] };
  initial.units.b2 = { ...unit('b2', 'blue'), heroId: 3 };
  initial.sides.blue = ['b', 'b2'];
  const counter = definition.handlers['attack-end'].handle(createBattleContext(initial, () => .39), attackEnd);
  assert.equal(counter[0].type, 'schedule-action');
  assert.equal(counter[0].scheduling, 'counter');
  assert.equal(counter[0].intent.actorId, 'b');
  assert.equal(counter[0].intent.targetIds[0], 'r');
  assert.equal(counter[0].freeCast, true);
  const selfWasHit = { ...attackEnd, targetHealthChanges: [{ targetId: 'b', hpBefore: 10000, hpAfter: 9900, hpLost: 100 }] };
  assert.ok(definition.handlers['attack-end'].handle(createBattleContext(initial, () => .99), selfWasHit));
  initial.units.b = { ...initial.units.b, statuses: [...initial.units.b.statuses, { instanceId: 'stun', statusId: 'test.stun',
    source: { kind: 'skill', id: 'stun', unitId: 'r' }, stacks: 1, duration: { kind: 'permanent' }, values: { controlType: '眩晕' } }] };
  assert.equal(definition.handlers['attack-end'].handle(createBattleContext(initial, () => .39, undefined, undefined, () => true), attackEnd), undefined);
});

test('万年竹竹语消耗3火并提升全队攻击；笛中剑以30%概率邀战随机友方', () => {
  const registry = new ContentRegistry(); registerWannianzhu(registry);
  const definition = registry.getHero(wannianzhuIds.hero);
  const ultimate = definition.skills.find(skill => skill.id === wannianzhuIds.ultimate);
  assert.equal(ultimate.resourceCost.amount, 3);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: wannianzhuIds.hero, skillLevel: 5,
    skillLevels: { [wannianzhuIds.ultimate]: 5 }, stats: { ...initial.units.b.stats, attack: 2000 } };
  initial.units.friend = { ...unit('friend', 'blue'), heroId: 203 };
  initial.sides.blue = ['b', 'friend'];
  const commands = ultimate.execute(createBattleContext(initial), { actorId: 'b', skillId: wannianzhuIds.ultimate,
    targetIds: ['b', 'friend'], shape: 'all-allies', targetRelation: 'ally' }, { rank: 5, attackRate: .15 });
  assert.equal(commands.length, 4);
  const friendAttack = commands.find(command => command.type === 'add-status' && command.targetId === 'friend'
    && command.instance.statusId === wannianzhuIds.attack);
  assert.equal(friendAttack.instance.modifiers[0].amount, 300);
  assert.equal(friendAttack.instance.duration.remaining, 1);

  const basicEvent = { eventId: 'bamboo-basic-end', phase: 'action-end', source: { kind: 'skill', id: wannianzhuIds.basic, unitId: 'b' },
    type: 'action-ended', actionKind: 'basic', skillId: wannianzhuIds.basic, soulTriggersAllowed: true,
    intent: { actorId: 'b', skillId: wannianzhuIds.basic, targetIds: ['r'], shape: 'single', targetRelation: 'enemy' } };
  const invite = definition.handlers['action-end'].handle(createBattleContext(initial, () => 0), basicEvent);
  assert.equal(invite[0].type, 'schedule-action');
  assert.equal(invite[0].scheduling, 'assist');
  assert.equal(invite[0].intent.actorId, 'friend');
  assert.equal(invite[0].intent.targetIds[0], 'r');
});

test('夜叉鬼魅造成伤害后按被动等级获得20速度、持续两个目标回合', () => {
  const registry = new ContentRegistry(); registerYasha(registry);
  const definition = registry.getHero(yashaIds.hero);
  let initial = state(); initial.units.b = { ...initial.units.b, heroId: yashaIds.hero, skillLevel: 4,
    skillLevels: { [yashaIds.passive]: 4 } };
  const damage = { eventId: 'yasha-damage', phase: 'hit', source: { kind: 'skill', id: yashaIds.basic, unitId: 'b' },
    type: 'damage', targetId: 'r', amount: 10 };
  const commands = definition.handlers.hit.handle(createBattleContext(initial, () => .44), damage);
  assert.equal(commands[0].type, 'add-status');
  assert.equal(commands[0].instance.statusId, yashaIds.speed);
  assert.equal(commands[0].instance.duration.remaining, 2);
  assert.equal(commands[0].instance.modifiers[0].amount, 20);
  assert.equal(definition.handlers.hit.handle(createBattleContext(initial, () => .46), damage), undefined);
  initial.units.b = { ...initial.units.b, statuses: [{ instanceId: 'passive-seal', statusId: passiveSuppressionStatusId,
    source: { kind: 'skill', id: 'test', unitId: 'r' }, stacks: 1, duration: { kind: 'permanent' } }] };
  assert.equal(definition.handlers.hit.handle(createBattleContext(initial, () => 0), damage), undefined);
});

test('夜叉黄泉之海消耗3火、倍率随等级增加，并以50%概率免费对随机存活敌人重复施放', () => {
  const registry = new ContentRegistry(); registerYasha(registry);
  const definition = registry.getHero(yashaIds.hero);
  const ultimate = definition.skills.find(skill => skill.id === yashaIds.ultimate);
  assert.equal(ultimate.resourceCost.amount, 3);
  assert.equal(ultimate.levels[4].ratio, 2.38);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: yashaIds.hero, skillLevel: 5, stats: { ...initial.units.b.stats, attack: 1000 } };
  initial.units.r2 = { ...unit('r2', 'red'), stats: { ...unit('r2', 'red').stats, hp: 10000 } };
  initial.sides.red = ['r', 'r2'];
  const cast = ultimate.execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: yashaIds.ultimate,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, { ratio: 2.38 });
  assert.equal(cast[0].amount, 2380);
  const attackEnd = { eventId: 'yasha-ultimate-end', phase: 'attack-end', source: { kind: 'skill', id: yashaIds.ultimate, unitId: 'b' },
    type: 'attack-ended', attackId: 9, hitCount: 1,
    targetHealthChanges: [{ targetId: 'r', hpBefore: 10000, hpAfter: 7620, hpLost: 2380 }] };
  let values = [.49, .75];
  const repeated = definition.handlers['attack-end'].handle(createBattleContext(initial, () => values.shift() ?? .9), attackEnd);
  assert.equal(repeated[0].type, 'schedule-action');
  assert.equal(repeated[0].scheduling, 'extra-action');
  assert.equal(repeated[0].freeCast, true);
  assert.equal(repeated[0].intent.skillId, yashaIds.ultimate);
  assert.equal(repeated[0].intent.targetIds[0], 'r2');
  assert.equal(definition.handlers['attack-end'].handle(createBattleContext(initial, () => .5), attackEnd), undefined);
});

test('黑童子魂之怒火按受击与生命线概率免费施放连斩，五级先机获得回魂', () => {
  const registry = new ContentRegistry(); registerHeitongzi(registry);
  const definition = registry.getHero(heitongziIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: heitongziIds.hero, skillLevel: 4,
    skillLevels: { [heitongziIds.passive]: 4 }, hp: 4000 };
  const incoming = { eventId: 'black-child-hit', phase: 'hit', source: { kind: 'skill', id: 'enemy.attack', unitId: 'r' },
    type: 'damage', targetId: 'b', amount: 100, hpLost: 100, damageKind: 'normal', attackId: 8, isCritical: false };
  const commands = definition.handlers.hit.handle(createBattleContext(initial, () => .25), incoming);
  assert.equal(commands[0].type, 'schedule-action');
  assert.equal(commands[0].intent.skillId, heitongziIds.ultimate);
  assert.equal(commands[0].freeCast, true);
  assert.equal(commands[1].instance.statusId, heitongziIds.revenant);
  assert.equal(definition.handlers.hit.handle(createBattleContext(initial, () => .27), incoming), undefined,
    '40%生命已损失时四级概率为26%，超过阈值不触发');
  assert.equal(definition.handlers.hit.handle(createBattleContext(initial, () => 0), { ...incoming, damageKind: 'true' }), undefined);

  initial.units.b = { ...initial.units.b, skillLevel: 5, skillLevels: { [heitongziIds.passive]: 5 } };
  const preemptive = definition.initialize(createBattleContext(initial), 'b');
  assert.equal(preemptive[0].instance.statusId, heitongziIds.revenant);
  assert.equal(registry.getStatus(heitongziIds.revenant).preventsLethalDamage, true);
});

test('黑童子连斩按失血比例增加群攻段数，觉醒击杀后免费接减伤连斩并获得护盾', () => {
  const registry = new ContentRegistry(); registerHeitongzi(registry);
  const definition = registry.getHero(heitongziIds.hero);
  const ultimate = definition.skills.find(skill => skill.id === heitongziIds.ultimate);
  const reduced = definition.skills.find(skill => skill.id === heitongziIds.reducedUltimate);
  assert.equal(ultimate.resourceCost.amount, 3);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: heitongziIds.hero, skillLevel: 5, hp: 2500, awakeFilter: 1,
    stats: { ...initial.units.b.stats, attack: 1000 } };
  initial.units.r2 = { ...unit('r2', 'red'), hp: 10000 };
  initial.sides.red = ['r', 'r2'];
  const intent = { actorId: 'b', skillId: heitongziIds.ultimate, targetIds: ['r', 'r2'], shape: 'all-enemies', targetRelation: 'enemy' };
  const attacks = ultimate.execute(createBattleContext(initial, () => .5), intent, { ratio: .99 });
  assert.equal(attacks.length, 6, '75%失血按30%一档共3段，每段命中2个敌人');
  assert.equal(reduced.levels[4].ratio, .594);
  const attackEnd = { eventId: 'black-child-kill', phase: 'attack-end', source: { kind: 'skill', id: heitongziIds.ultimate, unitId: 'b' },
    type: 'attack-ended', attackId: 12, hitCount: 1,
    targetHealthChanges: [{ targetId: 'r', hpBefore: 100, hpAfter: 0, hpLost: 100, defeatedByHit: true }] };
  const chain = definition.handlers['attack-end'].handle(createBattleContext(initial), attackEnd);
  assert.equal(chain[0].intent.skillId, heitongziIds.reducedUltimate);
  assert.equal(chain[0].freeCast, true);
  const fatal = definition.handlers.hit.handle(createBattleContext(initial), { eventId: 'fatal-save', phase: 'hit',
    source: { kind: 'skill', id: 'enemy.attack', unitId: 'r' }, type: 'damage', targetId: 'b', damageKind: 'normal',
    amount: 1000, hpLost: 999, attackId: 15, isCritical: false, fatalProtectionStatusId: heitongziIds.revenant });
  assert.equal(fatal[0].instance.statusId, heitongziIds.shield);
  assert.equal(fatal[0].instance.values.shieldRemaining, 1350);
});

test('白童子不灭在敌方式神阵亡时随机选活敌进行免费普攻，召唤物阵亡不触发', () => {
  const registry = new ContentRegistry(); registerBaitongzi(registry);
  const definition = registry.getHero(baitongziIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: baitongziIds.hero };
  initial.units.r = { ...initial.units.r, hp: 0 };
  initial.units.r2 = unit('r2', 'red');
  initial.sides.red = ['r', 'r2'];
  const event = { eventId: 'dead-enemy-shiki', phase: 'unit-defeated', source: { kind: 'skill', id: 'hit', unitId: 'b' },
    type: 'unit-defeated', unitId: 'r' };
  const counter = definition.handlers['unit-defeated'].handle(createBattleContext(initial, () => .5), event);
  assert.equal(counter[0].type, 'schedule-action');
  assert.equal(counter[0].intent.skillId, baitongziIds.basic);
  assert.equal(counter[0].intent.targetIds[0], 'r2');
  assert.equal(counter[0].freeCast, true);
  initial.units.r = { ...initial.units.r, unitKind: 'summon' };
  const summonDeath = definition.handlers['unit-defeated'].handle(createBattleContext(initial), event);
  assert.equal(summonDeath, undefined, '召唤物阵亡不触发不灭');
});

test('白童子招魂消耗3火、按等级群攻并为全友方挂一次性护盾和40%抵抗', () => {
  const registry = new ContentRegistry(); registerBaitongzi(registry);
  const definition = registry.getHero(baitongziIds.hero);
  const ultimate = definition.skills.find(skill => skill.id === baitongziIds.ultimate);
  assert.equal(ultimate.resourceCost.amount, 3);
  assert.equal(ultimate.levels[4].ratio, 1.26);
  assert.equal(ultimate.canUse(state(), { ...unit('b', 'blue'), heroId: baitongziIds.hero, awakeFilter: 0 }), false);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: baitongziIds.hero, awakeFilter: 1, skillLevel: 5, skillLevels: { [baitongziIds.ultimate]: 5 } };
  initial.units.b2 = { ...unit('b2', 'blue'), heroId: 203 };
  initial.sides.blue = ['b', 'b2'];
  const commands = ultimate.execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: baitongziIds.ultimate,
    targetIds: ['r'], shape: 'all-enemies', targetRelation: 'enemy' }, { ratio: 1.26 });
  assert.equal(commands[0].type, 'deal-damage');
  assert.equal(commands.filter(command => command.type === 'add-status' && command.instance.statusId === baitongziIds.whiteProtection).length, 2);
  const protection = commands.find(command => command.targetId === 'b2' && command.instance.statusId === baitongziIds.whiteProtection);
  assert.equal(protection.instance.duration.remaining, 1);
  assert.equal(protection.instance.modifiers[0].amount, .4);
  initial.units.b2 = { ...initial.units.b2, statuses: [protection.instance] };
  const intercepted = definition.interceptIncomingDamage(initial, initial.units.r, initial.units.b2, 400, 'normal');
  assert.equal(intercepted.amount, 0, '白之护拦截首次伤害的完整数值');
  assert.equal(intercepted.effects[0].type, 'remove-status-instances');
});

test('白童子觉醒招魂为每个阵亡式神生成同阵营魂魄、立即邀攻并在其回合结束消失', () => {
  const registry = new ContentRegistry(); registerBaitongzi(registry);
  const definition = registry.getHero(baitongziIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: baitongziIds.hero, awakeFilter: 1 };
  initial.units.r = { ...initial.units.r, hp: 0 };
  initial.units.r2 = { ...unit('r2', 'red'), hp: 0 };
  initial.sides.red = ['r', 'r2'];
  const event = { eventId: 'bai-ultimate-attack-end', phase: 'attack-end', source: { kind: 'skill', id: baitongziIds.ultimate, unitId: 'b' },
    type: 'attack-ended', attackId: 3, hitCount: 1, targetHealthChanges: [{ targetId: 'r', hpBefore: 1, hpAfter: 0, hpLost: 1 }] };
  const souls = definition.handlers['attack-end'].handle(createBattleContext(initial), event);
  assert.equal(souls.filter(command => command.type === 'summon-unit').length, 2);
  assert.ok(souls.every(command => command.unit.side === 'red' && command.unit.displayName === '魂魄'));
  const spirit = souls[0].unit;
  initial.units[spirit.unitId] = spirit;
  initial.sides.red = [...initial.sides.red, spirit.unitId];
  const immediate = definition.handlers['effect-resolution'].handle(createBattleContext(initial, () => .4),
    { eventId: 'spirit-created', phase: 'effect-resolution', source: { kind: 'skill', id: baitongziIds.ultimate, unitId: 'b' },
      type: 'unit-summoned', unitId: spirit.unitId, ownerUnitId: 'b', heroId: baitongziIds.hero });
  assert.equal(immediate[0].intent.skillId, baitongziIds.spiritBasic);
  assert.equal(immediate[0].intent.targetIds[0], 'b');
  const expires = registry.getStatus(baitongziIds.spiritLifetime).handlers['turn-end'].handle(createBattleContext(initial),
    { eventId: 'spirit-turn-end', phase: 'turn-end', source: { kind: 'unit', id: '278', unitId: spirit.unitId },
      type: 'turn-ended', unitId: spirit.unitId });
  assert.equal(expires[0].type, 'lose-life');
  assert.equal(expires[0].amount, spirit.hp);
});

test('花鸟卷归鸟按飞鸟数量打出40%攻击并逐只判定治疗，飞鸟耗尽后补1只', () => {
  const registry = new ContentRegistry(); registerHuaniaoJuan(registry);
  const definition = registry.getHero(huaniaoJuanIds.hero);
  const basic = definition.skills.find(skill => skill.id === huaniaoJuanIds.basic);
  let initial = state();
  const birds = { instanceId: 'birds:b', statusId: huaniaoJuanIds.birds, source: { kind: 'skill', id: huaniaoJuanIds.passive, unitId: 'b' },
    stacks: 3, duration: { kind: 'permanent' } };
  initial.units.b = { ...initial.units.b, heroId: huaniaoJuanIds.hero, skillLevel: 5, statuses: [birds] };
  initial.units.b2 = { ...unit('b2', 'blue'), hp: 5000 };
  initial.sides.blue = ['b', 'b2'];
  const commands = basic.execute(createBattleContext(initial, () => .1), { actorId: 'b', skillId: huaniaoJuanIds.basic,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, { ratio: .4 });
  assert.equal(commands.filter(command => command.type === 'deal-damage').length, 3);
  assert.equal(commands.filter(command => command.type === 'heal').length, 3);
  assert.equal(commands.at(-1).type, 'add-status');
  assert.equal(commands.at(-1).instance.stacks, 1);
  const scheduled = definition.handlers['effect-resolution'].handle(createBattleContext(initial), {
    eventId: 'flower-counter-scheduled', phase: 'effect-resolution', source,
    type: 'action-scheduled', scheduling: 'counter', freeCast: true,
    intent: { actorId: 'b', skillId: huaniaoJuanIds.basic, targetIds: ['r'], shape: 'single', targetRelation: 'enemy' },
  });
  assert.equal(scheduled[0].instance.statusId, huaniaoJuanIds.counterMarker);
  initial.units.b.statuses = [birds, scheduled[0].instance];
  const counter = basic.execute(createBattleContext(initial, () => .9), { actorId: 'b', skillId: huaniaoJuanIds.basic,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, { ratio: .4 });
  assert.equal(counter.filter(command => command.type === 'deal-damage').length, 1, '反击消耗1只飞鸟，仅攻击一次');
  assert.equal(counter.at(-1).instance.stacks, 2);
  initial.units.b.statuses = [{ ...birds, stacks: 2 }];
  const refill = definition.handlers['turn-start'].handle(createBattleContext(initial), {
    eventId: 'flower-turn-start', phase: 'turn-start', source, type: 'turn-started', unitId: 'b' });
  assert.equal(refill[0].instance.stacks, 3, '五级飞鸟上限为3，回合开始补充1只');
});

test('花鸟卷画境以30%概率消耗飞鸟并移除友方已施加的控制', () => {
  const registry = new ContentRegistry(); registerHuaniaoJuan(registry);
  const definition = registry.getHero(huaniaoJuanIds.hero);
  registry.registerStatus({ id: 'test.freeze', category: 'control', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const control = { instanceId: 'freeze:b2', statusId: 'test.freeze', source, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { controlType: '冰冻' } };
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: huaniaoJuanIds.hero,
    statuses: [{ instanceId: 'birds:b', statusId: huaniaoJuanIds.birds, source: { kind: 'skill', id: huaniaoJuanIds.passive, unitId: 'b' },
      stacks: 2, duration: { kind: 'permanent' } }] };
  initial.units.b2 = unit('b2', 'blue');
  initial.sides.blue = ['b', 'b2'];
  const applied = applyEffectCommands(initial, [{ type: 'apply-control', source, targetId: 'b2', instance: control }],
    'effect-resolution', 'flower-control', id => registry.getStatus(id));
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: `hero:${huaniaoJuanIds.hero}:control-application`, phase: 'control-application', priority: 42,
    handle(context, event) { return definition.handlers['control-application'].handle(context, event); } });
  const result = settleEvents(applied.state, applied.events, dispatcher, () => .1, undefined, id => registry.getStatus(id));
  assert.equal(result.state.units.b2.statuses.some(status => status.statusId === 'test.freeze'), false);
  assert.equal(result.state.units.b.statuses.find(status => status.statusId === huaniaoJuanIds.birds).stacks, 1);
});

test('花鸟卷画境按等级概率推进行动条，花鸟相闻消耗3火并即时治疗附加两次回合前治疗', () => {
  const registry = new ContentRegistry(); registerHuaniaoJuan(registry);
  const definition = registry.getHero(huaniaoJuanIds.hero);
  const ultimate = definition.skills.find(skill => skill.id === huaniaoJuanIds.ultimate);
  assert.equal(ultimate.resourceCost.amount, 3);
  assert.equal(ultimate.levels[4].ratio, .12);
  assert.equal(ultimate.levels[4].firstTick, .11);
  assert.equal(ultimate.levels[4].secondTick, .1);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: huaniaoJuanIds.hero, skillLevel: 5,
    skillLevels: { [huaniaoJuanIds.ultimate]: 5, [huaniaoJuanIds.passive]: 5 } };
  initial.units.b2 = { ...unit('b2', 'blue'), hp: 5000 };
  initial.sides.blue = ['b', 'b2'];
  const healing = ultimate.execute(createBattleContext(initial), { actorId: 'b', skillId: huaniaoJuanIds.ultimate,
    targetIds: ['b', 'b2'], shape: 'all-allies', targetRelation: 'ally' }, { ratio: .12, firstTick: .11, secondTick: .1 });
  const status = healing.find(command => command.type === 'add-status' && command.targetId === 'b2');
  assert.equal(healing.find(command => command.type === 'heal' && command.targetId === 'b2').amount, 1200);
  assert.equal(status.instance.duration.remaining, 2);
  assert.equal(status.instance.values.firstHeal, 1100);
  assert.equal(status.instance.values.secondHeal, 1000);
  const healingStatus = registry.getStatus(huaniaoJuanIds.healing);
  initial.units.b2 = { ...initial.units.b2, statuses: [status.instance] };
  const firstTick = healingStatus.handlers['turn-start'].handle(createBattleContext(initial), {
    eventId: 'flower-heal-first', phase: 'turn-start', source, type: 'turn-started', unitId: 'b2' });
  assert.equal(firstTick[0].amount, 1100);
  initial.units.b2 = { ...initial.units.b2, statuses: [{ ...status.instance, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }] };
  const secondTick = healingStatus.handlers['turn-start'].handle(createBattleContext(initial), {
    eventId: 'flower-heal-second', phase: 'turn-start', source, type: 'turn-started', unitId: 'b2' });
  assert.equal(secondTick[0].amount, 1000);
  const actionEnd = definition.handlers['action-end'].handle(createBattleContext(initial, () => .29), {
    eventId: 'flower-action-ended', phase: 'action-end', source, type: 'action-ended', actionKind: 'basic',
    skillId: huaniaoJuanIds.basic, soulTriggersAllowed: true,
    intent: { actorId: 'b', skillId: huaniaoJuanIds.basic, targetIds: ['r'], shape: 'single', targetRelation: 'enemy' },
  });
  assert.equal(actionEnd[0].type, 'change-action-gauge');
  assert.equal(actionEnd[0].amount, .3);
});

test('辉夜姬蓬莱玉枝按等级伤害并削减鬼火，觉醒六级必定削减1火', () => {
  const registry = new ContentRegistry(); registerHuiyeji(registry);
  const definition = registry.getHero(huiyejiIds.hero);
  const basic = definition.skills.find(skill => skill.id === huiyejiIds.basic);
  assert.equal(basic.levels[0].ratio, 1);
  assert.equal(basic.levels[4].ratio, 1.25);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: huiyejiIds.hero, skillLevel: 1 };
  const atTenPercent = definition.handlers['action-end'].handle(createBattleContext(initial, () => .09), {
    eventId: 'kaguya-basic-end', phase: 'action-end', source, type: 'action-ended', actionKind: 'basic',
    skillId: huiyejiIds.basic, soulTriggersAllowed: true,
    intent: { actorId: 'b', skillId: huiyejiIds.basic, targetIds: ['r'], shape: 'single', targetRelation: 'enemy' },
  });
  assert.equal(atTenPercent[0].type, 'change-resource');
  assert.equal(atTenPercent[0].side, 'red');
  initial.units.b.skillLevel = 6;
  const awakened = definition.handlers['action-end'].handle(createBattleContext(initial, () => .999), {
    eventId: 'kaguya-basic-end-awakened', phase: 'action-end', source, type: 'action-ended', actionKind: 'basic',
    skillId: huiyejiIds.basic, soulTriggersAllowed: true,
    intent: { actorId: 'b', skillId: huiyejiIds.basic, targetIds: ['r'], shape: 'single', targetRelation: 'enemy' },
  });
  assert.equal(awakened[0].amount, -1, '觉醒六级无视随机判定削减鬼火');
});

test('辉夜姬火鼠裘对本体或结界友方每次攻击只判定一次返火', () => {
  const registry = new ContentRegistry(); registerHuiyeji(registry);
  const definition = registry.getHero(huiyejiIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: huiyejiIds.hero, skillLevel: 5 };
  initial.units.b2 = unit('b2', 'blue');
  initial.sides.blue = ['b', 'b2'];
  const realm = { instanceId: 'realm:b:b2', statusId: huiyejiIds.realm,
    source: { kind: 'skill', id: huiyejiIds.ultimate, unitId: 'b' }, stacks: 1,
    duration: { kind: 'count', remaining: 2, owner: 'source-turn' } };
  initial.units.b2.statuses = [realm];
  const first = definition.handlers.hit.handle(createBattleContext(initial, () => .39), {
    eventId: 'attack-hit-1', phase: 'hit', source, type: 'damage', targetId: 'b2', damageKind: 'normal',
    amount: 500, hpLost: 500, attackId: 9, hitIndex: 1, isCritical: false,
  });
  assert.equal(first.filter(command => command.type === 'change-resource').length, 1);
  assert.equal(first.find(command => command.type === 'change-resource').amount, 1);
  initial.units.b.statuses = [first[0].instance];
  const second = definition.handlers.hit.handle(createBattleContext(initial, () => .01), {
    eventId: 'attack-hit-2', phase: 'hit', source, type: 'damage', targetId: 'b2', damageKind: 'normal',
    amount: 500, hpLost: 500, attackId: 9, hitIndex: 2, isCritical: false,
  });
  assert.equal(second, undefined, '同次多段攻击不能重复获得鬼火');
  const cleanup = definition.handlers['attack-end'].handle(createBattleContext(initial), {
    eventId: 'attack-end-9', phase: 'attack-end', source, type: 'attack-ended', attackId: 9, hitCount: 2,
  });
  assert.equal(cleanup[0].type, 'remove-status-instances');
  assert.deepEqual(cleanup[0].instanceIds, [first[0].instance.instanceId]);
});

test('辉夜姬龙首之玉2火、两回合结界及等级防御抵抗，且回合开始67%回火', () => {
  const registry = new ContentRegistry(); registerHuiyeji(registry);
  const definition = registry.getHero(huiyejiIds.hero);
  const ultimate = definition.skills.find(skill => skill.id === huiyejiIds.ultimate);
  const realmDefinition = registry.getStatus(huiyejiIds.realm);
  assert.equal(ultimate.resourceCost.amount, 2);
  assert.equal(ultimate.levels[0].duration, 2);
  assert.equal(ultimate.levels[0].defense, .15);
  assert.equal(ultimate.levels[0].resist, .1);
  assert.equal(ultimate.levels[5].defense, .35);
  assert.equal(ultimate.levels[5].resist, .3);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: huiyejiIds.hero, skillLevel: 5 };
  initial.units.b2 = unit('b2', 'blue');
  initial.sides.blue = ['b', 'b2'];
  const commands = ultimate.execute(createBattleContext(initial), { actorId: 'b', skillId: huiyejiIds.ultimate,
    targetIds: ['b', 'b2'], shape: 'all-allies', targetRelation: 'ally' }, { defense: .25, resist: .2, duration: 2 });
  const buff = commands.find(command => command.type === 'add-status' && command.targetId === 'b2');
  assert.equal(buff.instance.duration.remaining, 2);
  assert.deepEqual(buff.instance.modifiers.map(modifier => modifier.amount), [.25, .2]);
  initial.units.b2.statuses = [buff.instance];
  const fireTick = realmDefinition.handlers['turn-start'].handle(createBattleContext(initial, () => .66), {
    eventId: 'kaguya-ally-turn-start', phase: 'turn-start', source, type: 'turn-started', unitId: 'b2' });
  assert.deepEqual(fireTick, [{ type: 'change-resource', source: buff.instance.source, side: 'blue', resourceId: 'fire', amount: 1,
    parentEventId: 'kaguya-ally-turn-start' }]);
  assert.equal(realmDefinition.handlers['turn-start'].handle(createBattleContext(initial, () => .67), {
    eventId: 'kaguya-no-fire', phase: 'turn-start', source, type: 'turn-started', unitId: 'b2' }), undefined);
});

test('辉夜姬结界内龙首之玉减1火，鬼火不足时以当前鬼火施放并牺牲5%生命/缩短1回合', () => {
  const registry = new ContentRegistry(); registerHuiyeji(registry);
  const definition = registry.getHero(huiyejiIds.hero);
  const realmDefinition = registry.getStatus(huiyejiIds.realm);
  let initial = state();
  const realm = { instanceId: 'realm:b:b', statusId: huiyejiIds.realm,
    source: { kind: 'skill', id: huiyejiIds.ultimate, unitId: 'b' }, stacks: 1,
    duration: { kind: 'count', remaining: 2, owner: 'source-turn' } };
  initial.units.b = { ...initial.units.b, heroId: huiyejiIds.hero, skillLevel: 2, statuses: [realm] };
  initial.units.b2 = { ...unit('b2', 'blue'), heroId: huiyejiIds.hero, statuses: [{ ...realm, instanceId: 'realm:b:b2' }] };
  initial.sides.blue = ['b', 'b2'];
  assert.equal(realmDefinition.modifyResourceCost(initial, initial.units.b, { id: '2803' }, { resourceId: 'fire', amount: 2 }), 0);
  const shortfall = definition.handlers['action-selection'].handle(createBattleContext(initial), {
    eventId: 'kaguya-shortfall', phase: 'action-selection', source, actionId: 4, type: 'action-declared',
    intent: { actorId: 'b', skillId: huiyejiIds.ultimate, targetIds: ['b', 'b2'], shape: 'all-allies', targetRelation: 'ally' },
  });
  assert.equal(shortfall[0].type, 'add-status');
  assert.equal(shortfall[0].instance.statusId, huiyejiIds.fireShortfall);
  const marked = applyEffectCommands(initial, shortfall, 'effect-resolution', 'kaguya-shortfall-marker', id => registry.getStatus(id));
  const afterAction = definition.handlers['action-end'].handle(createBattleContext(marked.state), {
    eventId: 'kaguya-shortfall-end', phase: 'action-end', source, actionId: 4, type: 'action-ended',
    actionKind: 'skill', skillId: huiyejiIds.ultimate, soulTriggersAllowed: true,
    intent: { actorId: 'b', skillId: huiyejiIds.ultimate, targetIds: ['b', 'b2'], shape: 'all-allies', targetRelation: 'ally' },
  });
  assert.equal(afterAction[0].type, 'lose-life');
  assert.equal(afterAction[0].targetId, 'b');
  assert.equal(afterAction[0].amount, 500);
  const reduced = applyEffectCommands(marked.state, afterAction, 'effect-resolution', 'kaguya-shortfall-effects', id => registry.getStatus(id));
  assert.equal(reduced.state.units.b.hp, 9500);
  assert.equal(reduced.state.units.b.statuses[0].duration.remaining, 1);
  assert.equal(reduced.state.units.b2.statuses[0].duration.remaining, 1);
  const waived = definition.handlers['action-selection'].handle(createBattleContext(initial), {
    eventId: 'kaguya-freecast', phase: 'action-selection', source, actionId: 5, type: 'action-declared', resourceCostWaived: true,
    intent: { actorId: 'b', skillId: huiyejiIds.ultimate, targetIds: ['b'], shape: 'all-allies', targetRelation: 'ally' },
  });
  assert.equal(waived, undefined, '免火追加行动不触发鬼火透支代价');

  let live = state();
  live.units.b = { ...initial.units.b, hp: 10000, statuses: [{ ...realm, instanceId: 'realm:b:b' }] };
  live.units.b2 = unit('b2', 'blue');
  live.sides.blue = ['b', 'b2'];
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: `hero:${huiyejiIds.hero}:action-selection`, phase: 'action-selection', priority: 39,
    handle(context, event) { return definition.handlers['action-selection'].handle(context, event); } });
  dispatcher.register({ id: `hero:${huiyejiIds.hero}:action-end`, phase: 'action-end', priority: 39,
    handle(context, event) { return definition.handlers['action-end'].handle(context, event); } });
  const executed = executeAction(live, { actorId: 'b', skillId: huiyejiIds.ultimate,
    targetIds: ['b', 'b2'], shape: 'all-allies', targetRelation: 'ally' }, registry, () => .5,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(executed.accepted, true, '结界内鬼火为0时仍可施放技能');
  assert.equal(executed.state.units.b.hp, 9500, '技能结束后才扣除辉夜姬当前生命5%');
  assert.ok(executed.state.units.b.statuses.some(status => status.statusId === huiyejiIds.realm && status.duration.remaining === 1));
});

test('烟烟罗扑朔迷离按等级概率降低该次受击伤害', () => {
  const registry = new ContentRegistry(); registerYanyanluo(registry);
  const definition = registry.getHero(yanyanluoIds.hero);
  let initial = state();
  initial.units.r = { ...initial.units.r, heroId: yanyanluoIds.hero, skillLevel: 5 };
  const reduced = definition.interceptIncomingDamage(initial, initial.units.b, initial.units.r, 1000, 'normal',
    { battle: createBattleContext(initial, () => .39) });
  assert.equal(reduced.amount, 700, '五级被动触发40%概率，减伤30%');
  const missed = definition.interceptIncomingDamage(initial, initial.units.b, initial.units.r, 1000, 'normal',
    { battle: createBattleContext(initial, () => .4) });
  assert.equal(missed, undefined);
});

test('烟烟罗攻击有10%基础概率按效果命中/抵抗变形目标并封锁被动', () => {
  const registry = new ContentRegistry(); registerYanyanluo(registry);
  registry.registerStatus(passiveSuppressionStatusDefinition);
  const definition = registry.getHero(yanyanluoIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: yanyanluoIds.hero, stats: { ...initial.units.b.stats, hit: .5 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, resist: 0 } };
  const damage = { eventId: 'smoke-basic-hit', phase: 'hit', source: { kind: 'skill', id: yanyanluoIds.basic, unitId: 'b' },
    type: 'damage', targetId: 'r', damageKind: 'normal', amount: 100, hpLost: 100, attackId: 3, hitIndex: 1, isCritical: false };
  const commands = definition.handlers.hit.handle(createBattleContext(initial, () => .14), damage);
  assert.equal(commands.at(-1).type, 'apply-control');
  assert.equal(commands.at(-1).instance.values.controlType, '变形');
  assert.equal(commands.at(-1).instance.duration.remaining, 1);
  const applied = applyEffectCommands(initial, commands, 'effect-resolution', 'smoke-transform', id => registry.getStatus(id));
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: `hero:${yanyanluoIds.hero}:status-added`, phase: 'effect-resolution', priority: 40,
    handle(context, event) { return definition.handlers['effect-resolution'].handle(context, event); } });
  const result = settleEvents(applied.state, applied.events, dispatcher, () => .5, undefined, id => registry.getStatus(id));
  assert.ok(result.state.units.r.statuses.some(status => status.statusId === yanyanluoIds.smokeGhoul));
  assert.ok(result.state.units.r.statuses.some(status => status.statusId === passiveSuppressionStatusId));
  assert.equal(registry.getStatus(yanyanluoIds.smokeGhoul).preventsAction, true);
});

test('烟烟罗烟之鬼五段单体按每次暴击增加30%终击，鬼火五级3火、觉醒六级2火', () => {
  const registry = new ContentRegistry(); registerYanyanluo(registry);
  const definition = registry.getHero(yanyanluoIds.hero);
  const ultimate = definition.skills.find(skill => skill.id === yanyanluoIds.ultimate);
  assert.equal(ultimate.resourceCostsByLevel[4].amount, 3);
  assert.equal(ultimate.resourceCostsByLevel[5].amount, 2);
  assert.equal(ultimate.levels[4].ratio, .23);
  assert.equal(ultimate.levels[4].finalRatio, .53);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: yanyanluoIds.hero, skillLevel: 5 };
  initial.units.r2 = unit('r2', 'red');
  initial.sides.red = ['r', 'r2'];
  const intent = { actorId: 'b', skillId: yanyanluoIds.ultimate, targetIds: ['r'], shape: 'single', targetRelation: 'enemy' };
  const firstHits = ultimate.execute(createBattleContext(initial, () => .5), intent, { ratio: .23 });
  assert.equal(firstHits.length, 5);
  const tracker = { instanceId: 'crit:b:7', statusId: yanyanluoIds.critTracker,
    source: { kind: 'skill', id: yanyanluoIds.ultimate, unitId: 'b' }, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'event', event: 'attack-end' }, values: { attackId: 7, crits: 5 } };
  initial.units.b.statuses = [tracker];
  const final = definition.handlers['attack-end'].handle(createBattleContext(initial, () => .5), {
    eventId: 'smoke-ultimate-end', phase: 'attack-end', source: { kind: 'skill', id: yanyanluoIds.ultimate, unitId: 'b' },
    type: 'attack-ended', attackId: 7, hitCount: 5,
  });
  const finalHits = final.filter(command => command.type === 'deal-damage');
  assert.equal(finalHits.length, 2, '终击攻击所有存活敌人');
  assert.equal(finalHits[0].targetId, 'r');
  const attacker = initial.units.b;
  const target = initial.units.r;
  const expected = createBattleContext(initial, () => .5).calculateDamage({ attack: attacker.stats.attack, defense: target.stats.defense,
    defenseIgnore: 0, ratio: .53 * 2.5, dmgFluctuation: .01, critChance: attacker.stats.crit, critDamage: attacker.stats.critDamage }, attacker, target);
  assert.equal(finalHits[0].amount, expected.amount);
  assert.equal(final[0].type, 'remove-status-instances');
});

test('金鱼姬开场召唤金鱼，金鱼承接单体攻击40%且只分摊每次攻击首段', () => {
  const registry = new ContentRegistry(); registerJinyuhime(registry);
  const definition = registry.getHero(jinyuhimeIds.hero);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: jinyuhimeIds.hero };
  const initialized = definition.initialize(createBattleContext(initial), 'b');
  const fishCommand = initialized.find(command => command.type === 'summon-unit');
  assert.equal(fishCommand.unit.displayName, '金鱼');
  assert.equal(fishCommand.unit.stats.hp, 4800);
  initial.units[fishCommand.unit.unitId] = fishCommand.unit;
  initial.sides.blue.push(fishCommand.unit.unitId);
  const intercept = definition.interceptIncomingDamage(initial, initial.units.r, initial.units.b, 1000, 'normal', {
    attackId: 3, hitIndex: 1, targetIds: ['b'], attackShape: 'single', battle: createBattleContext(initial), isUnitUnableToAct: () => false,
  });
  assert.equal(intercept.amount, 600);
  assert.equal(intercept.effects[0].targetId, fishCommand.unit.unitId);
  assert.equal(intercept.effects[0].amount, 400);
  assert.equal(definition.interceptIncomingDamage(initial, initial.units.r, initial.units.b, 1000, 'normal', {
    attackId: 3, hitIndex: 2, targetIds: ['b'], attackShape: 'single', battle: createBattleContext(initial), isUnitUnableToAct: () => false,
  }), undefined);
});

test('金鱼姬扇舞治疗金鱼并叠加攻击，金鱼普攻有50%概率击退30点行动条', () => {
  const registry = new ContentRegistry(); registerJinyuhime(registry);
  const definition = registry.getHero(jinyuhimeIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: jinyuhimeIds.hero };
  const fish = { ...unit('f', 'blue'), heroId: jinyuhimeIds.hero, unitKind: 'summon', displayName: '金鱼', summonedByUnitId: 'b',
    stats: { ...unit('f', 'blue').stats, hp: 4800, attack: 5000, resist: 1 }, hp: 3000 };
  initial.units.f = fish; initial.sides.blue.push('f');
  const basic = definition.skills.find(skill => skill.id === jinyuhimeIds.basic);
  const commands = basic.execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: jinyuhimeIds.basic,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, { ratio: 1 });
  assert.equal(commands.find(command => command.type === 'heal').amount, 480);
  const added = commands.find(command => command.type === 'add-status');
  assert.equal(added.instance.modifiers[0].amount, .2);
  initial = applyEffectCommands(initial, [added], 'effect-resolution', 'goldfish-attack-stack', id => registry.getStatus(id)).state;
  const grown = { ...initial.units.f, statuses: initial.units.f.statuses };
  initial.units.f = grown;
  const fishBasic = definition.skills.find(skill => skill.id === jinyuhimeIds.goldfishBasic);
  const fishCommands = fishBasic.execute(createBattleContext(initial, () => .4), { actorId: 'f', skillId: jinyuhimeIds.goldfishBasic,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, { ratio: 1, pushChance: .5, pushAmount: 30 });
  assert.ok(fishCommands.some(command => command.type === 'change-action-gauge' && command.targetId === 'r' && command.amount === -30));
  assert.ok(fishCommands.some(command => command.type === 'deal-damage' && command.targetId === 'r'));
});

test('金鱼姬友方普攻后25%概率协战，敌方第8次行动后群攻并尝试沉默', () => {
  const registry = new ContentRegistry(); registerJinyuhime(registry);
  const definition = registry.getHero(jinyuhimeIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: jinyuhimeIds.hero };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, resist: 0 } };
  initial.units.p = unit('p', 'blue'); initial.sides.blue.push('p');
  initial.units.f = { ...unit('f', 'blue'), heroId: jinyuhimeIds.hero, unitKind: 'summon', displayName: '金鱼', summonedByUnitId: 'b',
    stats: { ...unit('f', 'blue').stats, hp: 4800, attack: 5000, resist: 1 }, hp: 4800 };
  initial.sides.blue.push('f');
  const assist = definition.handlers['attack-end'].handle(createBattleContext(initial, () => .1), {
    eventId: 'ally-basic-end', phase: 'attack-end', source: { kind: 'skill', id: 'p-basic', unitId: 'p' },
    type: 'attack-ended', actionKind: 'basic', attackId: 1, hitCount: 1, targetHealthChanges: [{ targetId: 'r', hpBefore: 10000, hpAfter: 9000 }],
  });
  assert.equal(assist.length, 1);
  assert.equal(assist[0].type, 'schedule-action');
  assert.equal(assist[0].intent.actorId, 'f');

  let lastCommands = [];
  for (let i = 1; i <= 8; i += 1) {
    lastCommands = definition.handlers['action-end'].handle(createBattleContext(initial, () => .1), {
      eventId: `enemy-action-${i}`, phase: 'action-end', source: { kind: 'skill', id: 'enemy-basic', unitId: 'r' },
      type: 'action-ended', actionId: i,
    }) ?? [];
    initial = applyEffectCommands(initial, lastCommands, 'effect-resolution', `enemy-action-${i}`,
      id => registry.getStatus(id)).state;
  }
  assert.equal(lastCommands.filter(command => command.type === 'deal-damage').length, 1);
  assert.ok(lastCommands.some(command => command.type === 'add-status' && command.instance.statusId === jinyuhimeIds.silence));
});

test('荒星轨按等级攻击并叠加星痕，五层且荒未受控时消耗星痕免费施放天罚·星', () => {
  const registry = new ContentRegistry(); registerHuang(registry);
  const definition = registry.getHero(huangIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: huangIds.hero, skillLevel: 5 };
  const damage = { eventId: 'huang-basic-hit', phase: 'hit', source: { kind: 'skill', id: huangIds.basic, unitId: 'b' },
    type: 'damage', targetId: 'r', damageKind: 'normal', amount: 500, hpLost: 500, hpBefore: 10000, hpAfter: 9500,
    attackId: 1, hitIndex: 1, isCritical: false };
  const mark = definition.handlers.hit.handle(createBattleContext(initial), damage);
  assert.equal(mark[0].instance.stacks, 1);
  const full = { ...mark[0].instance, stacks: 5 };
  initial.units.r.statuses = [full];
  const triggered = definition.handlers['effect-resolution'].handle(createBattleContext(initial), {
    eventId: 'huang-full-mark', phase: 'effect-resolution', source: full.source, type: 'status-added', targetId: 'r', instance: full,
  });
  assert.equal(triggered[0].type, 'remove-status-instances');
  assert.equal(triggered[1].type, 'schedule-action');
  assert.equal(triggered[1].freeCast, true);
  initial.units.b.statuses = [{ instanceId: 'stun:b', statusId: 'test.stun', source: { kind: 'skill', id: 'test', unitId: 'r' },
    stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }];
  assert.equal(definition.handlers['effect-resolution'].handle(createBattleContext(initial, () => .5, undefined, undefined, id => id === 'b'), {
    eventId: 'huang-full-mark-stunned', phase: 'effect-resolution', source: full.source, type: 'status-added', targetId: 'r', instance: full,
  }), undefined, '荒受控时不触发五层星痕追击');
});

test('荒星辰之境消耗2火并对目标叠3层星痕，五级重开时推全队25%行动条', () => {
  const registry = new ContentRegistry(); registerHuang(registry);
  const definition = registry.getHero(huangIds.hero);
  const skill = definition.skills.find(item => item.id === huangIds.realm);
  assert.equal(skill.resourceCost.amount, 2);
  assert.equal(skill.levels[4].pushTeamGauge, .25);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: huangIds.hero, skillLevel: 5 };
  initial.units.p = unit('p', 'blue'); initial.sides.blue.push('p');
  initial.units.b.statuses.push({ instanceId: 'illusion:b', statusId: huangIds.illusion,
    source: { kind: 'skill', id: huangIds.realm, unitId: 'b' }, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'source-turn' } });
  const commands = skill.execute(createBattleContext(initial), { actorId: 'b', skillId: huangIds.realm,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, { pushTeamGauge: .25 });
  assert.ok(commands.some(command => command.type === 'add-status' && command.targetId === 'r' && command.instance.stacks === 3));
  assert.equal(commands.filter(command => command.type === 'change-action-gauge').length, 2);
  assert.ok(commands.filter(command => command.type === 'change-action-gauge').every(command => command.amount === 25));
});

test('荒幻境回合前按被动等级创建，幻境内荒回合开始驱散一个可驱散减益', () => {
  const registry = new ContentRegistry(); registerHuang(registry);
  const definition = registry.getHero(huangIds.hero);
  const owner = { ...unit('b', 'blue'), heroId: huangIds.hero, skillLevel: 5 };
  let initial = state(); initial.units.b = owner;
  const created = definition.handlers['turn-start'].handle(createBattleContext(initial, () => .59), {
    eventId: 'huang-turn-start', phase: 'turn-start', source: { kind: 'skill', id: 'system' }, type: 'turn-started', unitId: 'b',
  });
  assert.ok(created.some(command => command.type === 'add-status' && command.instance.statusId === huangIds.illusion));
  initial.units.b.statuses = [created[0].instance, { instanceId: 'debuff:b', statusId: 'test.debuff',
    source: { kind: 'skill', id: 'test', unitId: 'r' }, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }];
  const cleaned = definition.handlers['turn-start'].handle(createBattleContext(initial), {
    eventId: 'huang-turn-start-in-realm', phase: 'turn-start', source: { kind: 'skill', id: 'system' }, type: 'turn-started', unitId: 'b',
  });
  assert.ok(cleaned.some(command => command.type === 'dispel-statuses' && command.maxCount === 1
    && command.filter === 'debuff-or-control'));
});

test('荒天罚·星3火三段递减，天罚·月按剩余鬼火攻击且星痕抵扣消耗', () => {
  const registry = new ContentRegistry(); registerHuang(registry);
  const definition = registry.getHero(huangIds.hero);
  const star = definition.skills.find(item => item.id === huangIds.star);
  assert.equal(star.resourceCost.amount, 3);
  const moon = definition.skills.find(item => item.id === huangIds.moon);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: huangIds.hero, skillLevel: 2, awakeFilter: 1,
    statuses: [{ instanceId: 'illusion:b', statusId: huangIds.illusion,
      source: { kind: 'skill', id: huangIds.realm, unitId: 'b' }, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'source-turn' } }] };
  initial.units.r.statuses = [{ instanceId: 'mark:b:r', statusId: huangIds.starMark,
    source: { kind: 'skill', id: huangIds.basic, unitId: 'b' }, stacks: 2, duration: { kind: 'permanent' } }];
  initial.resources.blue.fire = 5;
  const moonCommands = moon.execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: huangIds.moon,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, { ratio: 1.35, falloff: .2 });
  assert.equal(moonCommands[0].type, 'change-resource');
  assert.equal(moonCommands[0].amount, -3, '5点鬼火减去目标2层星痕后消耗3点');
  assert.equal(moonCommands.filter(command => command.type === 'deal-damage').length, 3);
  const starCommands = star.execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: huangIds.star,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, { ratio: 1.35, falloff: .1 });
  assert.equal(starCommands.length, 3);
  assert.equal(starCommands[0].amount > starCommands[1].amount, true);
  assert.equal(starCommands[1].amount > starCommands[2].amount, true);
});

test('以津真天黄金羽回合开始随机叠层，受敌方伤害后转移并附加印记效果', () => {
  const registry = new ContentRegistry(); registerYijinzhentian(registry);
  const definition = registry.getHero(yijinzhentianIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: yijinzhentianIds.hero, skillLevel: 5 };
  const start = definition.handlers['turn-start'].handle(createBattleContext(initial, () => .59), {
    eventId: 'yijin-turn-start', phase: 'turn-start', source: { kind: 'skill', id: 'system' }, type: 'turn-started', unitId: 'b',
  });
  assert.equal(start[0].instance.stacks, 2);
  initial.units.b.statuses = [start[0].instance];
  const transfer = definition.handlers.hit.handle(createBattleContext(initial), {
    eventId: 'yijin-hit', phase: 'hit', source: { kind: 'skill', id: 'enemy-basic', unitId: 'r' }, type: 'damage',
    targetId: 'b', damageKind: 'normal', amount: 100, hpLost: 100, mitigated: 0, isCritical: false,
  });
  assert.deepEqual(transfer.map(command => command.type), ['remove-status-instances', 'add-status']);
  assert.equal(transfer[1].targetId, 'r');
  assert.equal(transfer[1].instance.stacks, 1);
  assert.deepEqual(transfer[1].instance.modifiers.map(item => item.amount), [.09, -.09]);
});

test('以津真天普攻按羽毛加段并封顶四段，协战普攻不使用自身羽毛', () => {
  const registry = new ContentRegistry(); registerYijinzhentian(registry);
  const skill = registry.getHero(yijinzhentianIds.hero).skills.find(item => item.id === yijinzhentianIds.basic);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: yijinzhentianIds.hero, skillLevel: 5,
    statuses: [{ instanceId: 'feathers:b', statusId: yijinzhentianIds.feathers,
      source: { kind: 'skill', id: yijinzhentianIds.passive, unitId: 'b' }, stacks: 3, duration: { kind: 'permanent' } }] };
  initial.units.r.statuses = [{ instanceId: 'mark:b:r', statusId: yijinzhentianIds.featherMark,
    source: { kind: 'skill', id: yijinzhentianIds.passive, unitId: 'b' }, stacks: 2, duration: { kind: 'permanent' } }];
  const regular = skill.execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: yijinzhentianIds.basic,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, {});
  assert.equal(regular.filter(command => command.type === 'deal-damage').length, 4);
  const assist = skill.execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: yijinzhentianIds.basic,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy', kind: 'passive' }, {});
  assert.equal(assist.filter(command => command.type === 'deal-damage').length, 3);
});

test('以津真天千羽风之舞按技能等级消耗鬼火、羽毛追加伤害后清除印记', () => {
  const registry = new ContentRegistry(); registerYijinzhentian(registry);
  const skill = registry.getHero(yijinzhentianIds.hero).skills.find(item => item.id === yijinzhentianIds.ultimate);
  assert.equal(skill.resourceCost.amount, 3);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: yijinzhentianIds.hero, skillLevel: 6, awakeFilter: 1 };
  initial.units.r.statuses = [{ instanceId: 'mark:b:r', statusId: yijinzhentianIds.featherMark,
    source: { kind: 'skill', id: yijinzhentianIds.passive, unitId: 'b' }, stacks: 2, duration: { kind: 'permanent' } }];
  const commands = skill.execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: yijinzhentianIds.ultimate,
    targetIds: ['r'], shape: 'all-enemies', targetRelation: 'enemy' }, {});
  assert.equal(skill.resourceCostsByLevel[5].amount, 2);
  assert.equal(commands.filter(command => command.type === 'deal-damage').length, 4);
  assert.ok(commands.some(command => command.type === 'remove-status-instances' && command.targetId === 'r'
    && command.reason === 'consumed'));
});

test('以津真天友方普攻羽毛目标后有50%概率协战，阵亡时按标记层数引爆', () => {
  const registry = new ContentRegistry(); registerYijinzhentian(registry);
  const definition = registry.getHero(yijinzhentianIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: yijinzhentianIds.hero, skillLevel: 5 };
  initial.units.b2 = unit('b2', 'blue'); initial.sides.blue.push('b2');
  initial.units.r.statuses = [{ instanceId: 'mark:b:r', statusId: yijinzhentianIds.featherMark,
    source: { kind: 'skill', id: yijinzhentianIds.passive, unitId: 'b' }, stacks: 1, duration: { kind: 'permanent' } }];
  const assist = definition.handlers['attack-end'].handle(createBattleContext(initial, () => .4), {
    eventId: 'ally-basic-ended', phase: 'hit', source: { kind: 'skill', id: 'ally-basic', unitId: 'b2' },
    type: 'attack-ended', actionKind: 'basic', hitCount: 1, targetHealthChanges: [{ targetId: 'r', hpBefore: 1000, hpAfter: 900, hpLost: 100 }],
  });
  assert.equal(assist[0].type, 'schedule-action');
  assert.equal(assist[0].scheduling, 'assist');
  assert.equal(assist[0].intent.kind, 'passive');
  const death = definition.handlers['unit-defeated'].handle(createBattleContext(initial, () => .5), {
    eventId: 'yijin-defeated', phase: 'effect-resolution', source: { kind: 'skill', id: 'enemy-basic' },
    type: 'unit-defeated', unitId: 'b',
  });
  assert.equal(death.filter(command => command.type === 'deal-damage').length, 1);
  assert.ok(death.some(command => command.type === 'remove-status-instances' && command.targetId === 'r'));
});

test('匣中少女溢彩在友方行动前按80%概率提供其生命上限8%的护盾', () => {
  const registry = new ContentRegistry(); registerXiazhongshaonv(registry);
  const definition = registry.getHero(xiazhongshaonvIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: xiazhongshaonvIds.hero, skillLevel: 5,
    stats: { ...initial.units.b.stats, hp: 20000 } };
  const commands = definition.handlers['turn-start'].handle(createBattleContext(initial, () => .79), {
    eventId: 'xiazhong-ally-turn-start', phase: 'turn-start', source: { kind: 'skill', id: 'system' }, type: 'turn-started', unitId: 'b',
  });
  assert.equal(commands.length, 1);
  assert.equal(commands[0].instance.values.shieldRemaining, 1600);
  assert.equal(commands[0].instance.duration.remaining, 2);
  assert.equal(definition.handlers['turn-start'].handle(createBattleContext(initial, () => .8), {
    eventId: 'xiazhong-fail-roll', phase: 'turn-start', source: { kind: 'skill', id: 'system' }, type: 'turn-started', unitId: 'b',
  }), undefined);
});

test('匣中少女流光按等级造成单段伤害，回梦记录友方生命并消耗3火', () => {
  const registry = new ContentRegistry(); registerXiazhongshaonv(registry);
  const definition = registry.getHero(xiazhongshaonvIds.hero);
  const basic = definition.skills.find(skill => skill.id === xiazhongshaonvIds.basic);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: xiazhongshaonvIds.hero, skillLevel: 5 };
  const hit = basic.execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: xiazhongshaonvIds.basic,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, {});
  assert.equal(hit.filter(command => command.type === 'deal-damage').length, 1);
  assert.ok(hit[0].amount > 0);
  const dream = definition.skills.find(skill => skill.id === xiazhongshaonvIds.dream);
  assert.equal(dream.resourceCost.amount, 3);
  const recorded = dream.execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: xiazhongshaonvIds.dream,
    targetIds: ['b'], shape: 'self', targetRelation: 'ally' }, {});
  assert.equal(recorded.filter(command => command.type === 'add-status').length, 2);
  assert.ok(recorded.every(command => command.type !== 'add-status' || command.instance.duration.remaining === 2));
  assert.equal(recorded.find(command => command.type === 'add-status' && command.targetId === 'b'
    && command.instance.statusId === xiazhongshaonvIds.dreamRecord).instance.values.recordedHp, initial.units.b.hp);
});

test('匣中少女回梦两回合后补至记录比例，致命伤害时提前免死并结算记录', () => {
  const registry = new ContentRegistry(); registerXiazhongshaonv(registry);
  const definition = registry.getHero(xiazhongshaonvIds.hero);
  const dream = definition.skills.find(skill => skill.id === xiazhongshaonvIds.dream);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: xiazhongshaonvIds.hero, skillLevel: 1 };
  const recorded = applyEffectCommands(initial, dream.execute(createBattleContext(initial, () => .5), {
    actorId: 'b', skillId: xiazhongshaonvIds.dream, targetIds: ['b'], shape: 'self', targetRelation: 'ally',
  }, {}), 'effect-resolution', 'xiazhong-dream', id => registry.getStatus(id)).state;
  const low = { ...recorded, units: { ...recorded.units, b: { ...recorded.units.b, hp: 2000 } } };
  const expiry = definition.handlers['status-expiration'].handle(createBattleContext(low, () => .5), {
    eventId: 'dream-expired', phase: 'status-expiration', source: { kind: 'skill', id: xiazhongshaonvIds.dream, unitId: 'b' },
    type: 'status-removed', targetId: 'b', instanceId: 'record:b', statusId: xiazhongshaonvIds.dreamRecord,
    reason: 'expired', removedValues: { recordedHp: 10000, threshold: .3 },
  });
  assert.equal(expiry[0].type, 'restore-health');
  assert.equal(expiry[0].amount, 1000);

  const lethal = applyEffectCommands(recorded, [{ type: 'deal-damage', source: { kind: 'skill', id: 'lethal', unitId: 'r' },
    targetId: 'b', amount: 20000, isCritical: false }], 'hit', 'dream-lethal', id => registry.getStatus(id));
  const damage = lethal.events.find(event => event.type === 'damage' && event.targetId === 'b');
  assert.equal(damage.fatalProtectionStatusId, xiazhongshaonvIds.dreamGuard);
  assert.equal(lethal.state.units.b.hp, 1);
  const early = definition.handlers.hit.handle(createBattleContext(lethal.state, () => .5), damage);
  assert.equal(early[0].type, 'restore-health');
  assert.equal(early[0].amount, 2999);
  assert.ok(early.some(command => command.type === 'remove-statuses' && command.reason === 'consumed'));
});

test('彼岸花开战获得3层花海，敌方行动前逐层造成伤害，自身行动开始衰减但至少保留1层', () => {
  const registry = new ContentRegistry(); registerBiganhua(registry);
  const definition = registry.getHero(biganhuaIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: biganhuaIds.hero, skillLevel: 5 };
  const opening = definition.initialize(createBattleContext(initial, () => .5), 'b');
  assert.equal(opening[0].instance.stacks, 3);
  initial.units.b.statuses = [opening[0].instance];
  const enemyStart = definition.handlers['turn-start'].handle(createBattleContext(initial, () => .5), {
    eventId: 'sea-enemy-start', phase: 'turn-start', source: { kind: 'skill', id: 'system' }, type: 'turn-started', unitId: 'r',
  });
  assert.equal(enemyStart.filter(command => command.type === 'deal-damage').length, 3);
  const ownStart = definition.handlers['turn-start'].handle(createBattleContext(initial, () => .5), {
    eventId: 'sea-own-start', phase: 'turn-start', source: { kind: 'skill', id: 'system' }, type: 'turn-started', unitId: 'b',
  });
  assert.equal(ownStart[0].instance.stacks, 2);
  initial.units.b.statuses = [{ ...ownStart[0].instance, stacks: 1 }];
  const lastStack = definition.handlers['turn-start'].handle(createBattleContext(initial, () => .5), {
    eventId: 'sea-own-start-minimum', phase: 'turn-start', source: { kind: 'skill', id: 'system' }, type: 'turn-started', unitId: 'b',
  });
  assert.equal(lastStack, undefined);
});

test('彼岸花生命跨越25%阈值增加花海层并获得血之花海护盾', () => {
  const registry = new ContentRegistry(); registerBiganhua(registry);
  const definition = registry.getHero(biganhuaIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: biganhuaIds.hero, hp: 7400, skillLevel: 5,
    statuses: [{ instanceId: 'sea:b', statusId: biganhuaIds.sea,
      source: { kind: 'skill', id: biganhuaIds.passive, unitId: 'b' }, stacks: 3,
      duration: { kind: 'permanent' }, values: { thresholdCount: 0 } }] };
  const commands = definition.handlers.hit.handle(createBattleContext(initial, () => .5), {
    eventId: 'sea-cross-quarter', phase: 'hit', source: { kind: 'skill', id: 'enemy', unitId: 'r' }, type: 'damage',
    targetId: 'b', damageKind: 'normal', amount: 2600, hpBefore: 10000, hpAfter: 7400, hpLost: 2600, mitigated: 0, isCritical: false,
  });
  assert.equal(commands[0].instance.stacks, 4);
  assert.equal(commands[0].instance.values.thresholdCount, 1);
  assert.equal(commands[1].instance.values.shieldRemaining, 520);
});

test('彼岸花赤团华消耗3火，六级降至2火并按血线增加花海和吸收盾', () => {
  const registry = new ContentRegistry(); registerBiganhua(registry);
  const skill = registry.getHero(biganhuaIds.hero).skills.find(item => item.id === biganhuaIds.ultimate);
  assert.equal(skill.resourceCost.amount, 3);
  assert.equal(skill.resourceCostsByLevel[5].amount, 2);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: biganhuaIds.hero, skillLevel: 6, hp: 4500,
    statuses: [{ instanceId: 'sea:b', statusId: biganhuaIds.sea,
      source: { kind: 'skill', id: biganhuaIds.passive, unitId: 'b' }, stacks: 3,
      duration: { kind: 'permanent' }, values: { thresholdCount: 0 } }] };
  const commands = skill.execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: biganhuaIds.ultimate,
    targetIds: ['b'], shape: 'self', targetRelation: 'ally' }, {});
  assert.equal(commands[0].instance.stacks, 5);
  assert.equal(commands[1].instance.values.shieldRemaining, 1265);
});

test('小松丸胆怯按等级概率闪避并把单体攻击的80%转给生命最高友方，触发时可眩晕攻击者', () => {
  const registry = new ContentRegistry(); registerXiaosongwan(registry);
  const definition = registry.getHero(xiaosongwanIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: xiaosongwanIds.hero, skillLevel: 5 };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, resist: 0 } };
  initial.units.b2 = { ...unit('b2', 'blue'), hp: 9000 }; initial.sides.blue.push('b2');
  const target = initial.units.b;
  const attacker = initial.units.r;
  const interception = { attackId: 1, hitIndex: 1, source: { kind: 'skill', id: 'enemy-hit', unitId: 'r' },
    targetIds: ['b'], attackShape: 'single', battle: createBattleContext(initial, () => .1), isUnitUnableToAct: () => false };
  const intercepted = definition.interceptIncomingDamage(initial, attacker, target, 5000, 'normal', interception);
  assert.equal(intercepted.amount, 0);
  assert.equal(intercepted.effects.find(command => command.type === 'deal-damage').targetId, 'b2');
  assert.equal(intercepted.effects.find(command => command.type === 'deal-damage').amount, 4000);
  assert.ok(intercepted.effects.some(command => command.type === 'apply-control' && command.instance.statusId === xiaosongwanIds.stun));
  const failed = definition.interceptIncomingDamage(initial, attacker, target, 5000, 'normal', {
    ...interception, battle: createBattleContext(initial, () => .25),
  });
  assert.equal(failed, undefined);
});

test('小松丸怒气消耗3火四次踩踏，重复命中伤害递减且控制最多叠两层', () => {
  const registry = new ContentRegistry(); registerXiaosongwan(registry);
  const definition = registry.getHero(xiaosongwanIds.hero);
  const skill = definition.skills.find(item => item.id === xiaosongwanIds.ultimate);
  assert.equal(skill.resourceCost.amount, 3);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: xiaosongwanIds.hero, skillLevel: 5 };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, resist: 0 } };
  const commands = skill.execute(createBattleContext(initial, () => .1), { actorId: 'b', skillId: xiaosongwanIds.ultimate,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, {});
  const hits = commands.filter(command => command.type === 'deal-damage');
  assert.equal(hits.length, 4);
  assert.ok(hits[1].amount < hits[0].amount);
  assert.ok(Math.abs(hits[1].amount / hits[0].amount - .6) < .02);
  assert.ok(commands.filter(command => command.type === 'apply-control').every(command => command.instance.statusId === xiaosongwanIds.stun));
});

test('书翁云游消耗2火、治疗8%并驱散1个减益，五级再照顾最低生命友方', () => {
  const registry = new ContentRegistry(); registerShuweng(registry);
  const skill = registry.getHero(shuwengIds.hero).skills.find(item => item.id === shuwengIds.cloud);
  assert.equal(skill.resourceCost.amount, 2);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: shuwengIds.hero, skillLevel: 5, hp: 5000 };
  initial.units.b2 = { ...unit('b2', 'blue'), hp: 2000 }; initial.sides.blue.push('b2');
  const commands = skill.execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: shuwengIds.cloud,
    targetIds: ['b'], shape: 'single', targetRelation: 'ally' }, {});
  assert.equal(commands.filter(command => command.type === 'heal').length, 2);
  assert.ok(commands.filter(command => command.type === 'heal').every(command => command.amount === 800));
  assert.equal(commands.filter(command => command.type === 'dispel-statuses' && command.maxCount === 1).length, 2);
  assert.equal(commands.filter(command => command.type === 'add-status' && command.instance.statusId === shuwengIds.cap).length, 2);
});

test('书翁云游三级后免费施放万象之书，万象之书三级后免费施放云游', () => {
  const registry = new ContentRegistry(); registerShuweng(registry);
  const definition = registry.getHero(shuwengIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: shuwengIds.hero, skillLevel: 3 };
  const cloud = definition.skills.find(item => item.id === shuwengIds.cloud);
  const cloudCommands = cloud.execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: shuwengIds.cloud,
    targetIds: ['b'], shape: 'single', targetRelation: 'ally' }, {});
  const cloudFollowup = cloudCommands.find(command => command.type === 'schedule-action');
  assert.equal(cloudFollowup.freeCast, true);
  assert.equal(cloudFollowup.intent.skillId, shuwengIds.book);
  assert.equal(cloudFollowup.intent.kind, 'passive');
  const book = definition.skills.find(item => item.id === shuwengIds.book);
  const bookCommands = book.execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: shuwengIds.book,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, {});
  const bookFollowup = bookCommands.find(command => command.type === 'schedule-action');
  assert.equal(bookFollowup.freeCast, true);
  assert.equal(bookFollowup.intent.skillId, shuwengIds.cloud);
  assert.equal(bookFollowup.intent.kind, 'passive');
});

test('书翁单次伤害上限按技能状态生效，万象之书记录实际生命损失并在目标回合后结算', () => {
  const registry = new ContentRegistry(); registerShuweng(registry);
  const definition = registry.getHero(shuwengIds.hero);
  let initial = state();
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, resist: 0 } };
  initial.units.b = { ...initial.units.b, heroId: shuwengIds.hero, skillLevel: 2 };
  const capState = { ...initial, units: { ...initial.units, r: { ...initial.units.r,
    statuses: [{ instanceId: 'cap:r', statusId: shuwengIds.cap,
      source: { kind: 'skill', id: shuwengIds.cloud, unitId: 'b' }, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { damageCapRatio: .12 } }] } } };
  const capped = definition.interceptIncomingDamage(capState, initial.units.b, capState.units.r, 3000, 'normal');
  assert.equal(capped.amount, 1200);

  const book = definition.skills.find(item => item.id === shuwengIds.book);
  const commands = book.execute(createBattleContext(initial, () => .1), { actorId: 'b', skillId: shuwengIds.book,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, {});
  const applied = applyEffectCommands(initial, commands, 'hit', 'shuweng-book', id => registry.getStatus(id));
  const hitEvent = applied.events.find(event => event.type === 'damage' && event.source.id === shuwengIds.book);
  assert.ok(hitEvent.hpLost > 0);
  const recordedCommands = definition.handlers.hit.handle(createBattleContext(applied.state, () => .5), hitEvent);
  const recorded = applyEffectCommands(applied.state, recordedCommands, 'effect-resolution', 'shuweng-record', id => registry.getStatus(id));
  assert.equal(recorded.state.units.r.statuses.find(status => status.statusId === shuwengIds.record).values.recordedDamage, hitEvent.hpLost);
  const mark = recorded.state.units.r.statuses.find(status => status.statusId === shuwengIds.record);
  const settlement = definition.handlers['status-expiration'].handle(createBattleContext(recorded.state, () => .5), {
    eventId: 'shuweng-mark-expired', phase: 'status-expiration', source: mark.source, type: 'status-removed',
    targetId: 'r', instanceId: mark.instanceId, statusId: shuwengIds.record, reason: 'expired',
    removedValues: mark.values, removedSource: mark.source,
  });
  assert.equal(settlement[0].type, 'lose-life');
  assert.equal(settlement[0].lifeLossKind, 'indirect');
  assert.equal(settlement[0].amount, hitEvent.hpLost * .75);
});

test('雪童子雪走倍率按技能等级，碎冰增伤由伤害钩子只提升到三倍', () => {
  const registry = new ContentRegistry(); registerXuetongzi(registry);
  const definition = registry.getHero(xuetongziIds.hero);
  const basic = definition.skills.find(item => item.id === xuetongziIds.basic);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: xuetongziIds.hero, skillLevel: 5 };
  initial.units.r = { ...initial.units.r, statuses: [{ instanceId: 'frozen:r', statusId: xuetongziIds.freeze,
    source: { kind: 'skill', id: xuetongziIds.passive, unitId: 'b' }, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { controlType: '冰冻' } }] };
  const commands = basic.execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: xuetongziIds.basic,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, {});
  assert.equal(commands.length, 1);
  const base = definition.beforeCalculateDamage({ ratio: 1 }, initial.units.b, { ...initial.units.r, statuses: [] });
  const frozen = definition.beforeCalculateDamage({ ratio: 1 }, initial.units.b, initial.units.r);
  assert.equal(base.ratio, 1);
  assert.equal(frozen.ratio, 3);
});

test('雪童子霜天之织成功冰冻后得150%攻击护盾，大招三段并最多返还1火', () => {
  const registry = new ContentRegistry(); registerXuetongzi(registry);
  const definition = registry.getHero(xuetongziIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: xuetongziIds.hero, skillLevel: 5 };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, resist: 0 } };
  const event = { eventId: 'xue-ult-hit', attackId: 17, phase: 'attack-end', type: 'attack-ended', actionKind: 'skill',
    source: { kind: 'skill', id: xuetongziIds.ultimate, unitId: 'b' }, targetHealthChanges: [{ targetId: 'r', hpLost: 100 }] };
  const commands = definition.handlers['attack-end'].handle(createBattleContext(initial, () => .1), event);
  assert.ok(commands.some(command => command.type === 'apply-control' && command.instance.statusId === xuetongziIds.freeze));
  assert.equal(commands.find(command => command.type === 'add-status' && command.instance.statusId === xuetongziIds.shield).instance.values.shieldRemaining, 7500);
  const ult = definition.skills.find(item => item.id === xuetongziIds.ultimate);
  assert.equal(ult.resourceCost.amount, 3);
  const hits = ult.execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: xuetongziIds.ultimate,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, {}).filter(command => command.type === 'deal-damage');
  assert.equal(hits.length, 3);
  const refund = commands.filter(command => command.type === 'change-resource' && command.resourceId === 'fire');
  assert.equal(refund.length, 1);
  assert.equal(refund[0].amount, 1);
});

test('雪童子碎冰施加两回合减速，式神阵亡后全体存活雪童子永久增伤', () => {
  const registry = new ContentRegistry(); registerXuetongzi(registry);
  const definition = registry.getHero(xuetongziIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: xuetongziIds.hero };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, resist: 0 }, statuses: [
    { instanceId: 'frozen:r', statusId: xuetongziIds.freeze, source: { kind: 'skill', id: xuetongziIds.passive, unitId: 'b' },
      stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { controlType: '冰冻' } }] };
  const shattered = definition.handlers['attack-end'].handle(createBattleContext(initial, () => .1), {
    eventId: 'xue-shatter', phase: 'attack-end', type: 'attack-ended', actionKind: 'basic',
    source: { kind: 'skill', id: xuetongziIds.basic, unitId: 'b' }, targetHealthChanges: [{ targetId: 'r', hpLost: 100 }] });
  assert.ok(shattered.some(command => command.type === 'remove-status-instances' && command.reason === 'consumed'));
  assert.ok(shattered.some(command => command.type === 'add-status' && command.instance.statusId === xuetongziIds.shattered
    && command.instance.duration.remaining === 2 && command.instance.modifiers[0].amount === -.4));

  initial.units.b2 = { ...unit('b2', 'blue'), heroId: 7, hp: 0 }; initial.sides.blue.push('b2');
  const growth = definition.handlers['unit-defeated'].handle(createBattleContext(initial), {
    eventId: 'xue-ally-death', phase: 'unit-defeated', type: 'unit-defeated', unitId: 'b2',
    source: { kind: 'system', id: 'test' }, targetId: 'b2' });
  assert.equal(growth.length, 1);
  assert.equal(growth[0].instance.duration.kind, 'permanent');
  assert.equal(growth[0].instance.modifiers[0].amount, .05);
});

test('百目鬼瞳炎按等级伤害并延长凝视，诅咒之眼按等级消耗鬼火', () => {
  const registry = new ContentRegistry(); registerBaimugui(registry);
  const definition = registry.getHero(baimuguiIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: baimuguiIds.hero, skillLevel: 5 };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, resist: 0 }, statuses: [
    { instanceId: 'gaze:r', statusId: baimuguiIds.gaze, source: { kind: 'skill', id: baimuguiIds.gazeSkill, unitId: 'b' },
      stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { controlType: '凝视' } }] };
  const basic = definition.skills.find(item => item.id === baimuguiIds.basic);
  const commands = basic.execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: baimuguiIds.basic,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, {});
  assert.equal(commands[0].type, 'deal-damage');
  assert.equal(commands[1].instance.duration.remaining, 2);
  const gaze = definition.skills.find(item => item.id === baimuguiIds.gazeSkill);
  assert.equal(gaze.resolveResourceCost(initial, initial.units.b).amount, 2);
  assert.equal(gaze.resolveResourceCost(initial, { ...initial.units.b, skillLevel: 1 }).amount, 3);
});

test('百目鬼鬼眸在敌方暴击后叠满五层，免费施放诅咒之眼并清空', () => {
  const registry = new ContentRegistry(); registerBaimugui(registry);
  const definition = registry.getHero(baimuguiIds.hero);
  let current = state();
  current.units.b = { ...current.units.b, heroId: baimuguiIds.hero, skillLevel: 1 };
  current.units.r = { ...current.units.r, stats: { ...current.units.r.stats, crit: 1 } };
  for (let hit = 1; hit <= 5; hit += 1) {
    const commands = definition.handlers.hit.handle(createBattleContext(current, () => .1), {
      eventId: `enemy-crit-${hit}`, phase: 'hit', type: 'damage', source: { kind: 'skill', id: 'enemy-hit', unitId: 'r' },
      targetId: 'b', damageKind: 'normal', amount: 500, hpLost: 500, mitigated: 0, isCritical: true,
    });
    if (hit < 5) assert.ok(!commands?.some(command => command.type === 'schedule-action'));
    else assert.ok(commands.some(command => command.type === 'schedule-action' && command.freeCast === true
      && command.intent.skillId === baimuguiIds.gazeSkill));
    current = applyEffectCommands(current, commands ?? [], 'effect-resolution', `baimugui-crit-${hit}`,
      id => registry.getStatus(id)).state;
  }
  assert.equal(current.units.b.statuses.some(status => status.statusId === baimuguiIds.eyes), false);
});

test('百目鬼凝视替换持有者行动为邪光，按伤害/附加生命损失封顶后清除全队同源凝视', () => {
  const registry = new ContentRegistry(); registerBaimugui(registry);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: baimuguiIds.hero, skillLevel: 1, stats: { ...initial.units.b.stats, attack: 5000 } };
  const gaze = { instanceId: 'gaze:r', statusId: baimuguiIds.gaze, source: { kind: 'skill', id: baimuguiIds.gazeSkill, unitId: 'b' },
    stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { controlType: '凝视' } };
  initial.units.r = { ...initial.units.r, heroId: baimuguiIds.hero, hp: 20000, statuses: [gaze] };
  initial.units.r2 = { ...unit('r2', 'red'), heroId: baimuguiIds.hero, hp: 20000, statuses: [{ ...gaze, instanceId: 'gaze:r2' }] };
  initial.sides.red.push('r2'); initial.resources.red.fire = 3;
  const statusIntent = registry.getStatus(baimuguiIds.gaze).selectAction(createBattleContext(initial), initial.units.r, gaze);
  assert.equal(statusIntent.skillId, baimuguiIds.evilLight);
  const resolved = executeAction(initial, statusIntent, registry, () => .5, {
    resolveStatus: id => registry.getStatus(id),
  });
  assert.equal(resolved.accepted, true, resolved.failure);
  assert.equal(resolved.state.resources.red.fire, 0);
  const loss = resolved.events.find(event => event.type === 'life-lost' && event.targetId === 'r');
  assert.ok(loss);
  assert.equal(loss.amount, 12150);
  assert.equal(resolved.state.units.r.statuses.some(status => status.statusId === baimuguiIds.gaze), false);
  assert.equal(resolved.state.units.r2.statuses.some(status => status.statusId === baimuguiIds.gaze), false);
});

test('奴良陆生百鬼夜行消耗3火、按等级伤害并获得持续4回合的畏', () => {
  const registry = new ContentRegistry(); registerNuraRiku(registry);
  const definition = registry.getHero(nuraRikuIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: nuraRikuIds.hero, skillLevel: 5 };
  const ultimate = definition.skills.find(item => item.id === nuraRikuIds.ultimate);
  assert.equal(ultimate.resourceCost.amount, 3);
  assert.equal(ultimate.levels[0].ratio, 1.2);
  assert.equal(ultimate.levels[4].ratio, 1.5);
  const commands = ultimate.execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: nuraRikuIds.ultimate,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, {});
  assert.equal(commands.find(command => command.type === 'deal-damage').source.id, nuraRikuIds.ultimate);
  const fear = commands.find(command => command.type === 'add-status' && command.instance.statusId === nuraRikuIds.fear);
  assert.equal(fear.instance.duration.remaining, 4);
  assert.equal(fear.instance.modifiers[0].amount, .75);
});

test('奴良陆生每次攻击最多判定一次镜花水月，成功后叠畏并在攻击结束反击', () => {
  const registry = new ContentRegistry(); registerNuraRiku(registry);
  const definition = registry.getHero(nuraRikuIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: nuraRikuIds.hero, skillLevel: 1 };
  const hit = { eventId: 'nura-hit-1', phase: 'hit', type: 'damage', attackId: 27, hitIndex: 1,
    source: { kind: 'skill', id: 'enemy-multi', unitId: 'r' }, targetId: 'b', damageKind: 'normal',
    amount: 100, hpLost: 100, mitigated: 0, isCritical: false };
  const first = definition.handlers.hit.handle(createBattleContext(initial, () => .1), hit);
  assert.ok(first.some(command => command.type === 'add-status' && command.instance.statusId === nuraRikuIds.fear));
  initial = applyEffectCommands(initial, first, 'effect-resolution', 'nura-hit-1', id => registry.getStatus(id)).state;
  assert.equal(definition.handlers.hit.handle(createBattleContext(initial, () => .1), { ...hit,
    eventId: 'nura-hit-2', hitIndex: 2 }), undefined);
  const counter = definition.handlers['attack-end'].handle(createBattleContext(initial), {
    eventId: 'nura-attack-end', phase: 'attack-end', type: 'attack-ended', attackId: 27,
    source: hit.source, actionKind: 'skill', targetHealthChanges: [{ targetId: 'b', hpBefore: 10000, hpAfter: 9900, hpLost: 100 }],
  });
  assert.equal(counter.length, 1);
  assert.equal(counter[0].scheduling, 'counter');
  assert.equal(counter[0].freeCast, true);
  assert.equal(counter[0].intent.targetIds[0], 'r');
});

test('奴良陆生五级普攻有25%概率邀战一至两名随机友方', () => {
  const registry = new ContentRegistry(); registerNuraRiku(registry);
  const definition = registry.getHero(nuraRikuIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: nuraRikuIds.hero, skillLevel: 5 };
  initial.units.b2 = unit('b2', 'blue'); initial.units.b3 = unit('b3', 'blue');
  initial.sides.blue.push('b2', 'b3');
  initial.units.b2.heroId = nuraRikuIds.hero;
  initial.units.b3.heroId = nuraRikuIds.hero;
  const rolls = [.1, .9, .1, .1];
  const assists = definition.handlers['action-end'].handle(createBattleContext(initial, () => rolls.shift() ?? .1), {
    eventId: 'nura-basic-ended', phase: 'action-end', type: 'action-ended', actionKind: 'basic',
    skillId: nuraRikuIds.basic, soulTriggersAllowed: true,
    source: { kind: 'skill', id: nuraRikuIds.basic, unitId: 'b' },
    intent: { actorId: 'b', skillId: nuraRikuIds.basic, targetIds: ['r'], shape: 'single', targetRelation: 'enemy' },
  });
  assert.equal(assists.length, 2);
  assert.ok(assists.every(command => command.type === 'schedule-action' && command.scheduling === 'assist'
    && command.freeCast === true && command.intent.targetIds[0] === 'r'));
});

test('山风风按等级两段攻击，目标低于35%生命时两段必定暴击', () => {
  const registry = new ContentRegistry(); registerMountainWind(registry);
  const definition = registry.getHero(mountainWindIds.hero);
  const basic = definition.skills.find(item => item.id === mountainWindIds.basic);
  assert.deepEqual(basic.levels.map(level => level.ratio), [.76, .8, .84, .87, .95]);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: mountainWindIds.hero, skillLevel: 5 };
  initial.units.r = { ...initial.units.r, hp: 3400, stats: { ...initial.units.r.stats, resist: 0 } };
  const commands = basic.execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: mountainWindIds.basic,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, {});
  const hits = commands.filter(command => command.type === 'deal-damage');
  assert.equal(hits.length, 2);
  assert.ok(hits.every(hit => hit.isCritical));
});

test('山风受到攻击后每次攻击只判定一次畏，成功时在攻击结束免费反击', () => {
  const registry = new ContentRegistry(); registerMountainWind(registry);
  const definition = registry.getHero(mountainWindIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: mountainWindIds.hero };
  const hit = { eventId: 'mountain-hit-1', phase: 'hit', type: 'damage', attackId: 86, hitIndex: 1,
    source: { kind: 'skill', id: 'enemy-multi', unitId: 'r' }, targetId: 'b', damageKind: 'normal',
    amount: 100, hpLost: 100, mitigated: 0, isCritical: false };
  const first = definition.handlers.hit.handle(createBattleContext(initial, () => .1), hit);
  assert.ok(first.some(command => command.type === 'add-status' && command.instance.statusId === mountainWindIds.fierce));
  initial = applyEffectCommands(initial, first, 'effect-resolution', 'mountain-hit-1', id => registry.getStatus(id)).state;
  assert.equal(definition.handlers.hit.handle(createBattleContext(initial, () => .1), { ...hit,
    eventId: 'mountain-hit-2', hitIndex: 2 }), undefined);
  const counter = definition.handlers['attack-end'].handle(createBattleContext(initial), {
    eventId: 'mountain-attack-end', phase: 'attack-end', type: 'attack-ended', attackId: 86,
    source: hit.source, actionKind: 'skill', targetHealthChanges: [{ targetId: 'b', hpBefore: 10000, hpAfter: 9900, hpLost: 100 }],
  });
  assert.equal(counter.length, 1);
  assert.equal(counter[0].scheduling, 'counter');
  assert.equal(counter[0].intent.targetIds[0], 'r');
});

test('山风控制解除时推条并获攻击/抵抗，斩3火双目标必暴并在撕裂到期结算间接伤害', () => {
  const registry = new ContentRegistry(); registerMountainWind(registry);
  const definition = registry.getHero(mountainWindIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: mountainWindIds.hero, skillLevel: 5 };
  initial.units.r = { ...initial.units.r, hp: 5000, stats: { ...initial.units.r.stats, defense: 1000 } };
  initial.units.r2 = { ...unit('r2', 'red'), hp: 2500 }; initial.sides.red.push('r2');
  assert.equal(definition.modifyOutgoingDamage(initial.units.b, initial.units.r, 100, 'normal', initial), 125);
  assert.equal(definition.modifyOutgoingDamage(initial.units.b, { ...initial.units.r, hp: 10000 }, 100, 'normal', initial), 100);
  const controlEnd = definition.handlers['status-expiration'].handle(createBattleContext(initial), {
    eventId: 'mountain-control-expired', phase: 'status-expiration', type: 'status-removed',
    source: { kind: 'skill', id: 'control.test', unitId: 'r' }, targetId: 'b', instanceId: 'stun:b',
    statusId: 'stun.test', statusCategory: 'control', reason: 'expired',
  });
  assert.equal(controlEnd.find(command => command.type === 'change-action-gauge').amount, 70);
  assert.deepEqual(controlEnd.find(command => command.type === 'add-status').instance.modifiers.map(mod => mod.amount), [.25, .5]);
  assert.equal(controlEnd.find(command => command.type === 'add-status').instance.modifiers[1].operation, 'flat');

  const ultimate = definition.skills.find(item => item.id === mountainWindIds.ultimate);
  assert.equal(ultimate.resourceCost.amount, 3);
  const attacks = ultimate.execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: mountainWindIds.ultimate,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, {});
  const directHits = attacks.filter(command => command.type === 'deal-damage');
  assert.deepEqual(directHits.map(command => command.targetId), ['r', 'r2']);
  assert.ok(directHits.every(command => command.isCritical));
  assert.equal(attacks.filter(command => command.type === 'add-status' && command.instance.statusId === mountainWindIds.bleed).length, 2);
  const bleed = attacks.find(command => command.type === 'add-status' && command.instance.statusId === mountainWindIds.bleed);
  const bleedResolver = registry.getStatus(mountainWindIds.bleed).handlers['status-expiration'].handle;
  const tick = bleedResolver(createBattleContext(initial, () => .5), { eventId: 'mountain-bleed-expired', phase: 'status-expiration',
    type: 'status-removed', source: bleed.instance.source, targetId: 'r', instanceId: bleed.instance.instanceId,
    statusId: mountainWindIds.bleed, reason: 'expired', removedValues: bleed.instance.values,
    removedSource: bleed.instance.source });
  assert.equal(tick[0].type, 'lose-life');
  assert.equal(tick[0].lifeLossKind, 'indirect');
  const expectedBleed = calculateDamage({ attack: 5000, defense: 1000, ratio: 1, defenseIgnore: 600,
    dmgFluctuation: 0, critChance: 0, critDamage: 1 }, () => .5).amount;
  assert.equal(tick[0].amount, expectedBleed);
  const ban = bleedResolver(createBattleContext(initial, () => .5), { eventId: 'mountain-bleed-dispelled', phase: 'status-expiration',
    type: 'status-removed', source: bleed.instance.source, targetId: 'r', instanceId: bleed.instance.instanceId,
    statusId: mountainWindIds.bleed, reason: 'dispelled', removedValues: bleed.instance.values,
    removedSource: bleed.instance.source });
  assert.ok(ban.some(command => command.type === 'add-status' && command.instance.statusId === mountainWindIds.healBan));
});

test('日和坊采集友方伤害和觉醒敌方治疗，敌方回合末消耗日光治疗最低比例非召唤友方', () => {
  const registry = new ContentRegistry(); registerRihefang(registry);
  const definition = registry.getHero(rihefangIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: rihefangIds.hero, awakeFilter: 1, hp: 3000 };
  initial.units.b2 = unit('b2', 'blue'); initial.sides.blue.push('b2');
  initial.units.r = { ...initial.units.r, awakeFilter: 1 };
  const initialized = definition.initialize(createBattleContext(initial), 'b');
  initial = applyEffectCommands(initial, initialized, 'battle-start', 'rihowan-start', id => registry.getStatus(id)).state;
  const damage = definition.handlers.hit.handle(createBattleContext(initial), { eventId: 'rihowan-ally-hit', phase: 'hit',
    type: 'damage', source: { kind: 'skill', id: 'ally.attack', unitId: 'b2' }, targetId: 'r', damageKind: 'normal',
    amount: 1000, hpLost: 1000, mitigated: 0, isCritical: false });
  initial = applyEffectCommands(initial, damage, 'effect-resolution', 'rihowan-damage', id => registry.getStatus(id)).state;
  const healing = definition.handlers['effect-resolution'].handle(createBattleContext(initial), { eventId: 'rihowan-enemy-heal',
    phase: 'effect-resolution', type: 'healing', source: { kind: 'skill', id: 'enemy.heal', unitId: 'r' }, targetId: 'r',
    amount: 500, requestedAmount: 500, hpGained: 500 });
  initial = applyEffectCommands(initial, healing, 'effect-resolution', 'rihowan-enemy-healing', id => registry.getStatus(id)).state;
  assert.equal(Number(initial.units.b.statuses.find(status => status.statusId === rihefangIds.energy).values.energy), 350);
  const turnEnd = definition.handlers['turn-end'].handle(createBattleContext(initial), { eventId: 'rihowan-enemy-turn-end',
    phase: 'turn-end', type: 'turn-ended', source: { kind: 'system', id: 'turn' }, unitId: 'r' });
  assert.equal(turnEnd.find(command => command.type === 'heal').targetId, 'b');
  assert.equal(turnEnd.find(command => command.type === 'heal').amount, 350);
  assert.equal(Number(turnEnd.find(command => command.type === 'add-status').instance.values.energy), 0);
});

test('日和坊滋养消耗2火储存日光，友方阵亡牺牲晴天娃娃复活并分享日光', () => {
  const registry = new ContentRegistry(); registerRihefang(registry);
  const definition = registry.getHero(rihefangIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: rihefangIds.hero, skillLevel: 5, hp: 5000 };
  initial.units.b2 = { ...unit('b2', 'blue'), hp: 0 }; initial.sides.blue.push('b2');
  const initialized = definition.initialize(createBattleContext(initial), 'b');
  initial = applyEffectCommands(initial, initialized, 'battle-start', 'rihowan-start-2', id => registry.getStatus(id)).state;
  const nourish = definition.skills.find(skill => skill.id === rihefangIds.nourish);
  assert.equal(nourish.resourceCost.amount, 2);
  assert.ok(initial.units.b.statuses.some(status => status.statusId === rihefangIds.doll));
  const stored = nourish.execute(createBattleContext(initial), { actorId: 'b', skillId: rihefangIds.nourish,
    targetIds: ['b'], shape: 'self', targetRelation: 'ally' }, nourish.levels[4]);
  assert.equal(stored[0].instance.values.energy, 4000);
  initial = applyEffectCommands(initial, stored, 'effect-resolution', 'rihowan-store', id => registry.getStatus(id)).state;
  assert.equal(Number(initial.units.b.statuses.find(status => status.statusId === rihefangIds.energy).values.energy), 4000);
  const revive = definition.handlers['unit-defeated'].handle(createBattleContext(initial, () => .2), { eventId: 'rihowan-ally-defeated',
    phase: 'unit-defeated', type: 'unit-defeated', source: { kind: 'skill', id: 'enemy.attack', unitId: 'r' }, unitId: 'b2' });
  assert.ok(revive.some(command => command.type === 'revive' && command.targetId === 'b2' && command.hp === 10000));
  assert.ok(revive.some(command => command.type === 'remove-statuses' && command.statusIds.includes(rihefangIds.doll)));
  assert.ok(revive.some(command => command.type === 'add-status' && command.instance.statusId === rihefangIds.dollCooldown
    && command.instance.values.remaining === 3));
  const teamHeal = revive.find(command => command.type === 'heal');
  assert.equal(teamHeal.targetId, 'b');
  assert.equal(teamHeal.amount, 3000);
});

test('玉藻前灵击按等级增伤并尝试混乱，狐火和堕天读取客户端生命线倍率与2火觉醒行', () => {
  const registry = new ContentRegistry(); registerTamamo(registry);
  const definition = registry.getHero(tamamoIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: tamamoIds.hero, skillLevel: 6 };
  initial.units.r2 = unit('r2', 'red'); initial.sides.red.push('r2');
  const foxfire = definition.skills.find(skill => skill.id === tamamoIds.foxfire);
  const heavenFall = definition.skills.find(skill => skill.id === tamamoIds.heavenFall);
  assert.deepEqual(foxfire.resourceCostsByLevel.map(cost => cost.amount), [3, 3, 3, 3, 3, 2]);
  assert.equal(heavenFall.resourceCostsByLevel[5].amount, 2);
  assert.equal(foxfire.resolveResourceCost(initial, initial.units.b).amount, 2);
  assert.equal(heavenFall.resolveResourceCost(initial, { ...initial.units.b, skillLevel: 5 }).amount, 3);
  assert.deepEqual(foxfire.levels.map(level => level.ratio), [2.63, 2.76, 2.76, 2.89, 2.89, 2.89]);
  const fullHp = foxfire.execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: tamamoIds.foxfire,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, foxfire.levels[4]);
  const lowTarget = { ...initial.units.r, hp: 4000 };
  initial.units.r = lowTarget;
  const lowHp = foxfire.execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: tamamoIds.foxfire,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, foxfire.levels[4]);
  assert.ok(lowHp[0].amount > fullHp[0].amount);
  const area = heavenFall.execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: tamamoIds.heavenFall,
    targetIds: ['r', 'r2'], shape: 'all-enemies', targetRelation: 'enemy' }, heavenFall.levels[4]);
  assert.deepEqual(area.map(command => command.targetId), ['r', 'r2']);
});

test('玉藻前基础混乱经过命中抵抗，五级妖术击杀后交替免费施法并逐次衰减', () => {
  const registry = new ContentRegistry(); registerTamamo(registry);
  const definition = registry.getHero(tamamoIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: tamamoIds.hero, skillLevel: 5 };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, resist: 0 } };
  initial.units.r2 = unit('r2', 'red'); initial.units.r3 = unit('r3', 'red'); initial.sides.red.push('r2', 'r3');
  const confuse = definition.handlers.hit.handle(createBattleContext(initial, () => .05), { eventId: 'tamamo-basic-hit', phase: 'hit',
    type: 'damage', source: { kind: 'skill', id: tamamoIds.basic, unitId: 'b' }, targetId: 'r', damageKind: 'normal',
    amount: 100, hpLost: 100, mitigated: 0, isCritical: false });
  assert.ok(confuse.some(command => command.type === 'apply-control' && command.instance.statusId === tamamoIds.confusion
    && command.instance.duration.remaining === 1));
  initial.units.r = { ...initial.units.r, hp: 0 };
  const chain = definition.handlers['attack-end'].handle(createBattleContext(initial), { eventId: 'tamamo-foxfire-kill',
    phase: 'attack-end', type: 'attack-ended', source: { kind: 'skill', id: tamamoIds.foxfire, unitId: 'b' },
    hitCount: 1, targetHealthChanges: [{ targetId: 'r', hpBefore: 100, hpAfter: 0, hpLost: 100, defeatedByHit: true }] });
  const free = chain.find(command => command.type === 'schedule-action');
  assert.equal(free.intent.skillId, tamamoIds.heavenFall);
  assert.equal(free.freeCast, true);
  assert.equal(free.intent.targetIds.length, 2);
  initial.units.b.statuses = [{ instanceId: 'chain', statusId: tamamoIds.chain,
    source: { kind: 'skill', id: tamamoIds.heavenFall, unitId: 'b' }, stacks: 1,
    duration: { kind: 'permanent' }, values: { step: 1 } }];
  assert.equal(definition.modifyOutgoingDamage(initial.units.b, initial.units.r, 100, 'normal', initial), 80);
  initial.units.r2 = { ...initial.units.r2, hp: 0 };
  const next = definition.handlers['attack-end'].handle(createBattleContext(initial), { eventId: 'tamamo-area-kill',
    phase: 'attack-end', type: 'attack-ended', source: { kind: 'skill', id: tamamoIds.heavenFall, unitId: 'b' },
    hitCount: 2, targetHealthChanges: [{ targetId: 'r2', hpBefore: 100, hpAfter: 0, hpLost: 100, defeatedByHit: true }] });
  assert.equal(next.find(command => command.type === 'add-status').instance.values.step, 2);
  assert.equal(next.find(command => command.type === 'schedule-action').intent.skillId, tamamoIds.foxfire);
  assert.equal(next.find(command => command.type === 'schedule-action').intent.targetIds[0], 'r3');
  assert.ok(Math.abs(definition.modifyOutgoingDamage({ ...initial.units.b,
    statuses: [next.find(command => command.type === 'add-status').instance] }, initial.units.r, 100, 'normal', initial) - 64) < 1e-9);
});

test('薰五级普攻在目标有4个增益时击退行动条，警戒态随受控友方数切换并增加速度抵抗', () => {
  const registry = new ContentRegistry(); registerXun(registry);
  for (let i = 0; i < 4; i += 1) registry.registerStatus({ id: `test.buff.${i}`, mechanicsCoverage: 'partial',
    category: 'buff', dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const definition = registry.getHero(xunIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: xunIds.hero, skillLevel: 5,
    statuses: [{ instanceId: 'mode:b', statusId: xunIds.mode, source: { kind: 'skill', id: xunIds.passive, unitId: 'b' },
      stacks: 1, duration: { kind: 'permanent' }, values: { mode: 'calm' } }] };
  initial.units.r = { ...initial.units.r, statuses: Array.from({ length: 4 }, (_, i) => ({ instanceId: `buff:${i}`,
    statusId: `test.buff.${i}`, source: { kind: 'skill', id: `buff.${i}` }, stacks: 1,
    duration: { kind: 'permanent' } })) };
  const hit = definition.handlers.hit.handle(createBattleContext(initial, () => .5, id => registry.getStatus(id)?.category), {
    eventId: 'xun-basic-hit', phase: 'hit', type: 'damage', source: { kind: 'skill', id: xunIds.basic, unitId: 'b' },
    targetId: 'r', damageKind: 'normal', amount: 100, hpLost: 100, mitigated: 0, isCritical: false });
  assert.equal(hit[0].type, 'change-action-gauge');
  assert.equal(hit[0].amount, -15);
  initial.units.b2 = unit('b2', 'blue'); initial.units.b3 = unit('b3', 'blue'); initial.sides.blue.push('b2', 'b3');
  initial.units.b2.statuses = [{ instanceId: 'stun:b2', statusId: 'stun.test', source: { kind: 'skill', id: 'stun' },
    stacks: 1, duration: { kind: 'permanent' }, values: { controlType: '眩晕' } }];
  initial.units.b3.statuses = [{ instanceId: 'sleep:b3', statusId: 'sleep.test', source: { kind: 'skill', id: 'sleep' },
    stacks: 1, duration: { kind: 'permanent' }, values: { controlType: '睡眠' } }];
  const mode = definition.handlers['turn-start'].handle(createBattleContext(initial, () => .5), { eventId: 'xun-alert-start',
    phase: 'turn-start', type: 'turn-started', source: { kind: 'system', id: 'turn' }, unitId: 'r' });
  const alert = mode.find(command => command.type === 'add-status' && command.instance.statusId === xunIds.alert);
  assert.equal(alert.instance.modifiers[0].amount, 15);
  assert.equal(alert.instance.modifiers[1].amount, .6);
});

test('薰温柔的守护按等级耗火与牺牲当前生命，守护记录伤害、群体驱散并在移除时恢复生命', () => {
  const registry = new ContentRegistry(); registerXun(registry);
  registry.registerStatus({ id: 'test.control', mechanicsCoverage: 'partial', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: 'test.control.locked', mechanicsCoverage: 'partial', category: 'control', dispellable: false,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: 'test.debuff', mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const definition = registry.getHero(xunIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: xunIds.hero, skillLevel: 5, hp: 5000,
    statuses: [{ instanceId: 'mode:b', statusId: xunIds.mode, source: { kind: 'skill', id: xunIds.passive, unitId: 'b' },
      stacks: 1, duration: { kind: 'permanent' }, values: { mode: 'calm' } }] };
  initial.units.b2 = unit('b2', 'blue'); initial.units.b3 = unit('b3', 'blue'); initial.sides.blue.push('b2', 'b3');
  initial.units.b2.statuses = [{ instanceId: 'control:b2', statusId: 'test.control', source: { kind: 'skill', id: 'test' },
    stacks: 1, duration: { kind: 'permanent' } }];
  initial.units.b3.statuses = [{ instanceId: 'debuff:b3', statusId: 'test.debuff', source: { kind: 'skill', id: 'test' },
    stacks: 1, duration: { kind: 'permanent' } }];
  const protect = definition.skills.find(skill => skill.id === xunIds.protect);
  assert.equal(protect.resolveResourceCost(initial, { ...initial.units.b, skillLevel: 2 }).amount, 2);
  assert.equal(protect.resolveResourceCost(initial, { ...initial.units.b, skillLevel: 5 }).amount, 1);
  const commands = protect.execute(createBattleContext(initial), { actorId: 'b', skillId: xunIds.protect,
    targetIds: ['b2'], shape: 'single', targetRelation: 'ally' }, protect.levels[4]);
  assert.equal(commands.find(command => command.type === 'lose-life').amount, 1500);
  assert.ok(commands.some(command => command.type === 'change-resource' && command.amount === 4));
  assert.equal(commands.filter(command => command.type === 'dispel-statuses').length, 3);
  const guard = commands.find(command => command.type === 'add-status' && command.instance.statusId === xunIds.guard).instance;
  initial.units.b2.statuses = [guard];
  const interception = definition.interceptIncomingDamage(initial, initial.units.r, initial.units.b2, 800, 'normal');
  assert.equal(interception.amount, 0);
  const accumulated = interception.effects.find(command => command.type === 'add-status').instance;
  assert.equal(accumulated.values.recordedDamage, 800);
  initial.units.b2.statuses = [{ ...accumulated, values: { ...accumulated.values, recordedDamage: 800, capHp: 1000 } }];
  const capped = definition.interceptIncomingDamage(initial, initial.units.r, initial.units.b2, 500, 'normal');
  assert.equal(capped.amount, 0);
  assert.equal(capped.effects.find(command => command.type === 'add-status').instance.values.recordedDamage, 1000);
  assert.ok(capped.effects.some(command => command.type === 'remove-statuses' && command.reason === 'consumed'));
  const settle = registry.getStatus(xunIds.guard).handlers['status-expiration'].handle(createBattleContext(initial), {
    eventId: 'xun-guard-capped', phase: 'status-expiration', type: 'status-removed',
    source: guard.source, targetId: 'b2', instanceId: guard.instanceId, statusId: xunIds.guard,
    removedSource: guard.source, removedValues: { recordedDamage: 1000, capHp: 20000 }, reason: 'consumed' });
  assert.equal(settle[0].type, 'restore-health');
  assert.equal(settle[0].amount, 800);
  initial.units.b.statuses = [{ ...initial.units.b.statuses[0], values: { mode: 'alert' } }];
  initial.units.b2.statuses = [{ instanceId: 'locked-control', statusId: 'test.control.locked',
    source: { kind: 'skill', id: 'test' }, stacks: 1, duration: { kind: 'permanent' }, values: { controlType: '眩晕' } }];
  const alertCast = protect.execute(createBattleContext(initial, () => .5, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable === true), { actorId: 'b', skillId: xunIds.protect,
    targetIds: ['b2'], shape: 'single', targetRelation: 'ally' }, protect.levels[4]);
  assert.ok(!alertCast.some(command => command.type === 'change-resource'));
  assert.ok(alertCast.some(command => command.type === 'add-status' && command.instance.statusId === xunIds.speed));
});

test('薰五级被动在控制解除后本回合仅一次免费守护，并常态自身回合结束强化全队', () => {
  const registry = new ContentRegistry(); registerXun(registry);
  const definition = registry.getHero(xunIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: xunIds.hero, skillLevel: 5,
    statuses: [{ instanceId: 'mode:b', statusId: xunIds.mode, source: { kind: 'skill', id: xunIds.passive, unitId: 'b' },
      stacks: 1, duration: { kind: 'permanent' }, values: { mode: 'calm' } }] };
  initial.units.b2 = unit('b2', 'blue'); initial.sides.blue.push('b2'); initial.units.b2.hp = 1000;
  const event = { eventId: 'xun-control-removed', phase: 'status-expiration', type: 'status-removed',
    source: { kind: 'skill', id: 'control', unitId: 'r' }, targetId: 'b', instanceId: 'control:b',
    statusId: 'control.test', statusCategory: 'control', reason: 'expired' };
  const commands = definition.handlers['status-expiration'].handle(createBattleContext(initial), event);
  const schedule = commands.find(command => command.type === 'schedule-action');
  assert.equal(schedule.intent.skillId, xunIds.protect);
  assert.equal(schedule.freeCast, true);
  initial = applyEffectCommands(initial, commands, 'effect-resolution', event.eventId, id => registry.getStatus(id)).state;
  assert.equal(definition.handlers['status-expiration'].handle(createBattleContext(initial), { ...event, eventId: 'xun-control-removed-again' }), undefined);
  const aura = definition.handlers['turn-end'].handle(createBattleContext(initial), { eventId: 'xun-calm-turn-end', phase: 'turn-end',
    type: 'turn-ended', source: { kind: 'system', id: 'turn' }, unitId: 'b' });
  assert.equal(aura.filter(command => command.type === 'add-status' && command.instance.statusId === xunIds.calmDamage).length, 2);
  assert.equal(aura[0].instance.modifiers[0].amount, .15);
});

test('数珠敌方行动积佛珠，六珠触发群攻与等级推条并清空佛珠', () => {
  const registry = new ContentRegistry(); registerJuzu(registry);
  const definition = registry.getHero(juzuIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: juzuIds.hero, skillLevel: 5, statuses: [{ instanceId: `${juzuIds.beads}:b`,
    statusId: juzuIds.beads, source: { kind: 'skill', id: juzuIds.passive, unitId: 'b' }, stacks: 5, duration: { kind: 'permanent' } }] };
  const event = { eventId: 'juzu-enemy-action', phase: 'action-end', type: 'action-ended', actionKind: 'basic', skillId: 'enemy.basic',
    soulTriggersAllowed: true, source: { kind: 'skill', id: 'enemy.basic', unitId: 'r' }, intent: { actorId: 'r' } };
  const commands = definition.handlers['action-end'].handle(createBattleContext(initial, () => 0), event);
  assert.ok(commands.some(command => command.type === 'deal-damage' && command.targetId === 'r'));
  assert.ok(commands.some(command => command.type === 'change-action-gauge' && command.targetId === 'r' && command.amount === -30));
  initial = applyEffectCommands(initial, commands, 'action-end', event.eventId, id => registry.getStatus(id)).state;
  assert.equal(initial.units.b.statuses.some(status => status.statusId === juzuIds.beads), false);
  assert.ok(initial.units.r.hp < 10000);
  assert.equal(initial.units.r.actionGauge, 0);
});

test('数珠禅意友方回合前成功驱散治疗，消耗佛珠並在其回合后拉条', () => {
  const registry = new ContentRegistry(); registerJuzu(registry);
  registry.registerStatus({ id: 'test.juzu.debuff', category: 'debuff', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: 'test.juzu.control', category: 'control', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const definition = registry.getHero(juzuIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: juzuIds.hero, skillLevel: 5, statuses: [
    { instanceId: `${juzuIds.beads}:b`, statusId: juzuIds.beads, source: { kind: 'skill', id: juzuIds.passive, unitId: 'b' },
      stacks: 2, duration: { kind: 'permanent' } },
    { instanceId: 'juzu-meditation', statusId: juzuIds.meditation, source: { kind: 'skill', id: juzuIds.meditationSkill, unitId: 'b' },
      stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'source-turn' } },
  ] };
  initial.units.a = { ...unit('a', 'blue'), hp: 5000, statuses: [
    { instanceId: 'juzu-debuff', statusId: 'test.juzu.debuff', source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } },
    { instanceId: 'juzu-control', statusId: 'test.juzu.control', source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } },
  ] };
  initial.sides.blue = ['b', 'a'];
  const context = createBattleContext(initial, () => 0, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable === true);
  const startEvent = { eventId: 'juzu-ally-turn-start', phase: 'turn-start', type: 'turn-started',
    source: { kind: 'system', id: 'turn' }, unitId: 'a' };
  const commands = definition.handlers['turn-start'].handle(context, startEvent);
  assert.ok(commands.some(command => command.type === 'dispel-statuses' && command.instanceIds.length === 2));
  assert.ok(commands.some(command => command.type === 'heal' && command.amount === 1000));
  assert.ok(commands.some(command => command.type === 'add-status' && command.instance.statusId === juzuIds.delayedGauge));
  let applied = applyEffectCommands(initial, commands, 'turn-start', startEvent.eventId, id => registry.getStatus(id));
  assert.equal(applied.state.units.a.statuses.some(status => status.statusId === 'test.juzu.debuff' || status.statusId === 'test.juzu.control'), false);
  assert.equal(applied.state.units.a.hp, 6000);
  assert.equal(applied.state.units.b.statuses.find(status => status.statusId === juzuIds.beads).stacks, 1);
  const endEvent = { eventId: 'juzu-ally-turn-end', phase: 'turn-end', type: 'turn-ended', source: { kind: 'system', id: 'turn' }, unitId: 'a' };
  const gauge = definition.handlers['turn-end'].handle(createBattleContext(applied.state), endEvent);
  applied = applyEffectCommands(applied.state, gauge, 'turn-end', endEvent.eventId, id => registry.getStatus(id));
  assert.equal(applied.state.units.a.actionGauge, 30);

  const failedState = { ...initial, units: { ...initial.units, a: { ...initial.units.a, statuses: [] } } };
  const failed = definition.handlers['turn-start'].handle(createBattleContext(failedState, () => .99,
    id => registry.getStatus(id)?.category, id => registry.getStatus(id)?.dispellable === true), startEvent);
  assert.ok(failed.some(command => command.type === 'add-status' && command.instance.statusId === juzuIds.effectResist));
});

test('阿香每次命中叠加蛇毒降低8%防御，三层狂暴增伤120%并尝试眩晕', () => {
  const registry = new ContentRegistry(); registerAxiang(registry);
  const definition = registry.getHero(axiangIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: axiangIds.hero, skillLevel: 2 };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, defense: 1000, resist: 0 } };
  for (let index = 0; index < 3; index++) {
    const event = { eventId: `axiang-poison-${index}`, phase: 'hit', type: 'damage',
      source: { kind: 'skill', id: axiangIds.basic, unitId: 'b' }, targetId: 'r', damageKind: 'normal',
      amount: 100, hpBefore: 10000, hpAfter: 9900, hpLost: 100, mitigated: 0, isCritical: false,
      attackId: index + 1, hitIndex: 1 };
    const commands = definition.handlers.hit.handle(createBattleContext(initial, () => 0,
      id => registry.getStatus(id)?.category), event);
    initial = applyEffectCommands(initial, commands, 'hit', event.eventId, id => registry.getStatus(id)).state;
  }
  const poison = initial.units.r.statuses.find(status => status.statusId === axiangIds.poison);
  assert.equal(poison.stacks, 3);
  assert.equal(effectiveStats(initial.units.r).defense, 760);
  initial.resources.blue.fire = 3;
  const result = executeAction(initial, { actorId: 'b', skillId: axiangIds.ultimate, targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => 0, { resolveStatus: id => registry.getStatus(id) });
  assert.equal(result.accepted, true);
  assert.equal(result.state.resources.blue.fire, 0);
  assert.ok(result.events.some(event => event.type === 'control-applied' && event.statusId === axiangIds.stun));
});

test('阿香及友方每次攻击只判一次25%反击，反击使用被动连击事件', () => {
  const registry = new ContentRegistry(); registerAxiang(registry);
  const definition = registry.getHero(axiangIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: axiangIds.hero, skillLevel: 2 };
  initial.units.b2 = unit('b2', 'blue');
  initial.sides.blue.push('b2');
  const incoming = { eventId: 'axiang-ally-hit-1', phase: 'hit', type: 'damage',
    source: { kind: 'skill', id: 'enemy.attack', unitId: 'r' }, targetId: 'b2', damageKind: 'normal',
    amount: 100, hpBefore: 10000, hpAfter: 9900, hpLost: 100, mitigated: 0, isCritical: false, attackId: 9, hitIndex: 1 };
  const commands = definition.handlers.hit.handle(createBattleContext(initial, () => .24), incoming);
  assert.ok(commands.some(command => command.type === 'schedule-attack' && command.scheduling === 'counter'
    && command.intent.actorId === 'b' && command.intent.targetIds[0] === 'r'));
  const markerCommands = commands.filter(command => command.type === 'add-status' && command.instance.statusId === axiangIds.counterWindow);
  initial = applyEffectCommands(initial, markerCommands, 'hit', incoming.eventId, id => registry.getStatus(id)).state;
  const secondHit = { ...incoming, eventId: 'axiang-ally-hit-2', targetId: 'b', hitIndex: 2 };
  const second = definition.handlers.hit.handle(createBattleContext(initial, () => 0), secondHit);
  assert.ok(!second?.some(command => command.type === 'schedule-attack'));
});

test('鬼灯普攻二段和地狱之鬼三段读取客户端倍率，眩晕目标必定暴击', () => {
  const registry = new ContentRegistry(); registerGuideng(registry);
  const definition = registry.getHero(guidengIds.hero);
  const basic = definition.skills.find(skill => skill.id === guidengIds.basic);
  assert.equal(basic.levels[0].firstRatio, .3);
  assert.equal(basic.levels[0].secondRatio, .7);
  const ultimate = definition.skills.find(skill => skill.id === guidengIds.ultimate);
  assert.equal(ultimate.resourceCost.amount, 3);
  assert.deepEqual([ultimate.levels[0].firstRatio, ultimate.levels[0].secondRatio, ultimate.levels[0].thirdRatio], [.44, .88, 1.32]);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: guidengIds.hero, stats: { ...initial.units.b.stats, hit: 0, crit: 0 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, resist: 0 }, statuses: [{
    instanceId: 'stunned-r', statusId: guidengIds.stun, source: { kind: 'skill', id: guidengIds.passive, unitId: 'b' },
    stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { controlType: '眩晕' },
  }] };
  const commands = basic.execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: guidengIds.basic,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, basic.levels[0]);
  assert.equal(commands.filter(command => command.type === 'deal-damage').length, 2);
  assert.ok(commands.every(command => command.type !== 'deal-damage' || command.isCritical));
});

test('鬼灯每次敌方命中独立尝试22%眩晕，自身回合末为友方解控/驱散并推30%行动条', () => {
  const registry = new ContentRegistry(); registerGuideng(registry);
  registry.registerStatus({ id: 'test.guideng.debuff', category: 'debuff', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: 'test.guideng.control', category: 'control', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  const definition = registry.getHero(guidengIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: guidengIds.hero, stats: { ...initial.units.b.stats, hit: 0 } };
  initial.units.b2 = { ...unit('b2', 'blue'), statuses: [
    { instanceId: 'g-debuff', statusId: 'test.guideng.debuff', source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } },
    { instanceId: 'g-control', statusId: 'test.guideng.control', source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } },
  ] };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, resist: 0 } };
  initial.sides.blue.push('b2');
  const hit = { eventId: 'guideng-hit-1', phase: 'hit', type: 'damage', source,
    targetId: 'r', damageKind: 'normal', amount: 50, hpBefore: 10000, hpAfter: 9950, hpLost: 50,
    mitigated: 0, isCritical: false, attackId: 1, hitIndex: 1 };
  const hitCommands = definition.handlers.hit.handle(createBattleContext(initial, () => 0,
    id => registry.getStatus(id)?.category), hit);
  assert.ok(hitCommands.some(command => command.type === 'apply-control' && command.instance.statusId === guidengIds.stun));
  const turnEnd = { eventId: 'guideng-turn-end', phase: 'turn-end', type: 'turn-ended',
    source: { kind: 'system', id: 'turn' }, unitId: 'b' };
  const context = createBattleContext(initial, () => 0, id => registry.getStatus(id)?.category);
  const commands = definition.handlers['turn-end'].handle(context, turnEnd);
  assert.equal(commands.filter(command => command.type === 'deal-damage' && command.targetId === 'b2').length, 2);
  assert.ok(commands.some(command => command.type === 'remove-status-instances' && command.instanceIds.includes('g-control')));
  assert.ok(commands.some(command => command.type === 'change-action-gauge' && command.targetId === 'b2' && command.amount === 30));
  const cleared = applyEffectCommands(initial, commands, 'turn-end', turnEnd.eventId, id => registry.getStatus(id)).state;
  assert.equal(cleared.units.b2.actionGauge, 30);
  assert.equal(cleared.units.b2.statuses.some(status => status.instanceId === 'g-debuff' || status.instanceId === 'g-control'), false);
});

test('猫掌柜普攻按猫种结算鬼火、额外伤害和行动条，骑乘时每次呼唤两只猫', () => {
  const registry = new ContentRegistry(); registerCatManager(registry);
  const definition = registry.getHero(catManagerIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: catManagerIds.hero, skillLevel: 2 };
  initial.units.r = { ...initial.units.r, actionGauge: 50, turnPos: 60 };
  initial.resources.red.fire = 2;
  const basic = definition.skills.find(skill => skill.id === catManagerIds.basic);
  assert.equal(basic.levels[1].ratio, .84);
  let commands = basic.execute(createBattleContext(initial, () => .99), { actorId: 'b', skillId: catManagerIds.basic,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, basic.levels[1]);
  assert.ok(commands.some(command => command.type === 'change-action-gauge' && command.targetId === 'r' && command.amount === -20));
  let result = applyEffectCommands(initial, commands, 'effect-resolution', 'cat-manager-basic', id => registry.getStatus(id));
  assert.equal(result.state.units.r.actionGauge, 30);

  commands = basic.execute(createBattleContext(initial, () => 0), { actorId: 'b', skillId: catManagerIds.basic,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, basic.levels[1]);
  assert.ok(commands.some(command => command.type === 'change-resource' && command.side === 'red' && command.amount === -1));
  initial.units.b = { ...initial.units.b, statuses: [{ instanceId: 'ride:b', statusId: catManagerIds.rideStatus,
    source: { kind: 'skill', id: catManagerIds.ride, unitId: 'b' }, stacks: 1,
    duration: { kind: 'count', remaining: 2, owner: 'source-turn' } }] };
  commands = basic.execute(createBattleContext(initial, () => .5), { actorId: 'b', skillId: catManagerIds.basic,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, basic.levels[1]);
  const hits = commands.filter(command => command.type === 'deal-damage');
  assert.equal(hits.length, 3);
  assert.ok(hits[1].amount < hits[0].amount && hits[2].amount < hits[0].amount);
});

test('猫掌柜猫合战消耗2火持续两个自身回合，觉醒提供40%效果抵抗；猫猫乱斗消耗3火打五段', () => {
  const registry = new ContentRegistry(); registerCatManager(registry);
  const definition = registry.getHero(catManagerIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: catManagerIds.hero, awakeFilter: 1, skillLevel: 2 };
  initial.resources.blue.fire = 2;
  const ride = definition.skills.find(skill => skill.id === catManagerIds.ride);
  assert.equal(ride.resourceCost.amount, 2);
  const rideCommands = ride.execute(createBattleContext(initial), { actorId: 'b', skillId: catManagerIds.ride,
    targetIds: ['b'], shape: 'self', targetRelation: 'ally' }, ride.levels[0]);
  const ridden = applyEffectCommands(initial, rideCommands, 'effect-resolution', 'cat-manager-ride', id => registry.getStatus(id)).state;
  const status = ridden.units.b.statuses.find(item => item.statusId === catManagerIds.rideStatus);
  assert.equal(status.duration.remaining, 2);
  assert.equal(status.modifiers.find(item => item.stat === 'speed').amount, 20);
  assert.equal(status.modifiers.find(item => item.stat === 'resist').amount, .4);

  initial = state();
  initial.units.b = { ...initial.units.b, heroId: catManagerIds.hero, skillLevel: 2 };
  initial.resources.blue.fire = 3;
  initial.resources.red.fire = 5;
  const attack = executeAction(initial, { actorId: 'b', skillId: catManagerIds.ultimate, targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => 0, { resolveStatus: id => registry.getStatus(id) });
  assert.equal(attack.accepted, true);
  assert.equal(attack.state.resources.blue.fire, 0);
  assert.equal(attack.state.resources.red.fire, 0);
  assert.equal(attack.events.filter(event => event.type === 'damage' && event.source.id === catManagerIds.ultimate).length, 5);
});

test('卖药郎敌方回合末按觉醒概率叠加天平，最多三层并按层数转化真理', () => {
  const registry = new ContentRegistry(); registerMaiyaolang(registry);
  const definition = registry.getHero(maiyaolangIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: maiyaolangIds.hero, awakeFilter: 0 };
  const turnEnd = { eventId: 'seller-enemy-turn-end', phase: 'turn-end', type: 'turn-ended',
    source: { kind: 'system', id: 'turn' }, unitId: 'r' };
  let commands = definition.handlers['turn-end'].handle(createBattleContext(initial, () => .39), turnEnd);
  assert.equal(commands.filter(command => command.type === 'add-status' && command.instance.statusId === maiyaolangIds.scale).length, 1);
  initial = applyEffectCommands(initial, commands, 'turn-end', turnEnd.eventId, id => registry.getStatus(id)).state;
  initial.units.r = { ...initial.units.r, statuses: [...initial.units.r.statuses,
    { instanceId: 'extra-mark-2', statusId: maiyaolangIds.scale,
      source: { kind: 'skill', id: maiyaolangIds.passive, unitId: 'b' }, stacks: 1, duration: { kind: 'permanent' } }], hp: 3900 };
  initial.units.b2 = { ...unit('b2', 'blue'), heroId: maiyaolangIds.hero };
  initial.sides.blue.push('b2');
  assert.equal(definition.modifyOutgoingDamage(initial.units.b, initial.units.r, 100, 'normal', initial), 166);
  assert.equal(definition.modifyOutgoingDamage(initial.units.b2, initial.units.r, 100, 'normal', initial), 100);
  const damage = { eventId: 'seller-threshold-hit', phase: 'hit', type: 'damage', source,
    targetId: 'r', damageKind: 'normal', amount: 100, hpBefore: 4000, hpAfter: 3900, hpLost: 100,
    mitigated: 0, isCritical: false };
  commands = definition.handlers.hit.handle(createBattleContext(initial), damage);
  assert.ok(commands.some(command => command.type === 'remove-status-instances' && command.instanceIds.includes('extra-mark-2')));
  assert.ok(commands.some(command => command.type === 'add-status' && command.instance.statusId === maiyaolangIds.truth
    && command.instance.duration.remaining === 2));
  const converted = applyEffectCommands(initial, commands, 'hit', damage.eventId, id => registry.getStatus(id)).state;
  assert.equal(converted.units.r.statuses.some(status => status.statusId === maiyaolangIds.scale), false);
  assert.ok(converted.units.r.statuses.some(status => status.statusId === maiyaolangIds.truth));
});

test('卖药郎退魔消耗3火，真理状态分支按当前生命3%且受攻击600%上限', () => {
  const registry = new ContentRegistry(); registerMaiyaolang(registry);
  const definition = registry.getHero(maiyaolangIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: maiyaolangIds.hero, stats: { ...initial.units.b.stats, attack: 5000 } };
  initial.resources.blue.fire = 3;
  initial.units.r = { ...initial.units.r, hp: 10000, statuses: [{ instanceId: 'truth:r', statusId: maiyaolangIds.truth,
    source: { kind: 'skill', id: maiyaolangIds.passive, unitId: 'b' }, stacks: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' } }] };
  const skill = definition.skills.find(item => item.id === maiyaolangIds.ultimate);
  assert.equal(skill.resourceCost.amount, 3);
  const paid = executeAction(initial, { actorId: 'b', skillId: maiyaolangIds.ultimate, targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .5, { resolveStatus: id => registry.getStatus(id) });
  assert.equal(paid.accepted, true);
  assert.equal(paid.state.resources.blue.fire, 0);
  const commands = skill.execute(createBattleContext(initial), { actorId: 'b', skillId: maiyaolangIds.ultimate,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, skill.levels[0]);
  const damage = commands.find(command => command.type === 'deal-damage');
  assert.equal(damage.amount, 300);
  assert.equal(damage.damageKind, 'normal');
  assert.equal(damage.ignoreShield, true);
  assert.equal(damage.suppressTargetSoulTriggers, true);
  assert.equal(damage.suppressTargetPassiveTriggers, true);
  assert.equal(damage.cannotBeShared, true);
  initial.units.r = { ...initial.units.r, shield: 5000 };
  const shieldResult = applyEffectCommands(initial, commands, 'effect-resolution', 'seller-truth-hit', id => registry.getStatus(id));
  assert.equal(shieldResult.state.units.r.shield, 5000);
  assert.equal(shieldResult.state.units.r.hp, 9700);
  initial.units.r = { ...initial.units.r, hp: 1000000 };
  const cappedCommands = skill.execute(createBattleContext(initial), { actorId: 'b', skillId: maiyaolangIds.ultimate,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, skill.levels[0]);
  assert.equal(cappedCommands.find(command => command.type === 'deal-damage').amount, 30000);
});

test('数珠禅意施放实际扣除2点鬼火并进入两回合打坐', () => {
  const registry = new ContentRegistry(); registerJuzu(registry);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: juzuIds.hero, skillLevel: 5 };
  initial.resources.blue.fire = 2;
  const cast = executeAction(initial, { actorId: 'b', skillId: juzuIds.meditationSkill, targetIds: ['b'],
    shape: 'self', targetRelation: 'ally' }, registry, () => .5, { resolveStatus: id => registry.getStatus(id) });
  assert.equal(cast.accepted, true);
  assert.equal(cast.state.resources.blue.fire, 0);
  assert.equal(cast.state.units.b.statuses.find(status => status.statusId === juzuIds.meditation).duration.remaining, 2);
});

test('小袖之手连线按等级判定控制与70%伤害传导，穿针引线对连线目标返火', () => {
  const registry = new ContentRegistry(); registerXiaoxiu(registry);
  registry.registerStatus({ id: 'test.xiaoxiu.control', category: 'control', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  const definition = registry.getHero(xiaoxiuIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: xiaoxiuIds.hero, skillLevel: 5 };
  initial.units.r2 = unit('r2', 'red'); initial.sides.red.push('r2');
  initial.units.r3 = unit('r3', 'red'); initial.sides.red.push('r3');
  initial.units.b2 = unit('b2', 'blue'); initial.sides.blue.push('b2');
  initial.resources.blue.fire = 2;
  const linkCast = executeAction(initial, { actorId: 'b', skillId: xiaoxiuIds.threads, targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => 0, { resolveStatus: id => registry.getStatus(id) });
  assert.equal(linkCast.accepted, true);
  assert.equal(linkCast.state.resources.blue.fire, 0);
  const rLink = linkCast.state.units.r.statuses.find(status => status.statusId === xiaoxiuIds.link);
  const r2Link = linkCast.state.units.r2.statuses.find(status => status.statusId === xiaoxiuIds.link);
  assert.equal(rLink.values.chance, .6);
  assert.equal(rLink.values.partnerUnitId, 'r2');
  assert.equal(r2Link.values.partnerUnitId, 'r');
  const readyToLink = { ...initial, resources: { ...initial.resources, blue: { ...initial.resources.blue, fire: 2 } } };
  assert.equal(definition.policy(createBattleContext(readyToLink), 'b').skillId, xiaoxiuIds.threads);
  const alreadyLinked = { ...linkCast.state,
    resources: { ...linkCast.state.resources, blue: { ...linkCast.state.resources.blue, fire: 2 } } };
  assert.equal(definition.policy(createBattleContext(alreadyLinked), 'b').skillId, xiaoxiuIds.basic);

  const controlSource = { kind: 'skill', id: 'test.control', unitId: 'b2' };
  const controlInstance = { instanceId: 'xiaoxiu-original-control', statusId: 'test.xiaoxiu.control', source: controlSource,
    stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { controlType: '眩晕' } };
  const controlledState = { ...linkCast.state, units: { ...linkCast.state.units,
    r: { ...linkCast.state.units.r, statuses: [...linkCast.state.units.r.statuses, controlInstance] } } };
  const controlCommands = definition.handlers['control-application'].handle(createBattleContext(controlledState, () => 0,
    id => registry.getStatus(id)?.category), { eventId: 'xiaoxiu-control-link', phase: 'control-application',
    source: controlSource, type: 'control-applied', targetId: 'r', statusId: 'test.xiaoxiu.control', newlyControlled: true });
  assert.ok(controlCommands.some(command => command.type === 'apply-control' && command.targetId === 'r2'
    && command.instance.duration.remaining === controlInstance.duration.remaining));

  const damageCommands = definition.handlers.hit.handle(createBattleContext(controlledState, () => 0), {
    eventId: 'xiaoxiu-damage-link', phase: 'hit', source: controlSource, type: 'damage', targetId: 'r',
    damageKind: 'normal', amount: 100, hpLost: 100, mitigated: 0, isCritical: false });
  const transfer = damageCommands.find(command => command.type === 'deal-damage');
  assert.equal(transfer.targetId, 'r2');
  assert.equal(transfer.amount, 70);
  assert.equal(transfer.precalculated, true);
  assert.equal(transfer.suppressSoulTriggers, true);
  assert.equal(transfer.suppressTargetPassiveTriggers, true);
  const afterTransfer = applyEffectCommands(controlledState, damageCommands, 'hit', 'xiaoxiu-damage-link', id => registry.getStatus(id)).state;
  assert.equal(afterTransfer.units.r2.hp, 9930);

  let ultimateState = { ...linkCast.state, resources: { ...linkCast.state.resources, blue: { ...linkCast.state.resources.blue, fire: 3 } } };
  const ultimate = executeAction(ultimateState, { actorId: 'b', skillId: xiaoxiuIds.ultimate, targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .5, { resolveStatus: id => registry.getStatus(id) });
  assert.equal(ultimate.accepted, true);
  const ultimateDamage = ultimate.events.filter(event => event.type === 'damage' && event.source.id === xiaoxiuIds.ultimate);
  assert.equal(ultimateDamage.length, 4);
  assert.ok(ultimateDamage.filter(event => event.targetId === 'r' || event.targetId === 'r2')
    .every(event => event.amount > ultimateDamage.find(candidate => candidate.targetId === 'r3').amount));
  assert.equal(ultimate.state.resources.blue.fire, 2);
});

test('弈神之一手3火九段投掷，气合四层同色触发600%伤害并消耗棋子', () => {
  const registry = new ContentRegistry(); registerYi(registry);
  const definition = registry.getHero(yiIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: yiIds.hero, skillLevel: 2, stats: { ...initial.units.b.stats, hit: 0 } };
  initial.units.r = { ...initial.units.r, hp: 1000000, stats: { ...initial.units.r.stats, hp: 1000000, resist: .99 } };
  initial.resources.blue.fire = 3;
  const initialized = applyEffectCommands(initial, definition.initialize(createBattleContext(initial), 'b'), 'battle-start',
    'yi-init', id => registry.getStatus(id));
  const dispatcher = new EventDispatcher();
  for (const [phase, rule] of Object.entries(definition.handlers)) dispatcher.register({ id: `yi-test-${phase}`, phase,
    priority: rule.priority, handle: rule.handle });
  const action = executeAction(initialized.state, { actorId: 'b', skillId: yiIds.ultimate, targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => 0, { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(action.accepted, true);
  assert.equal(action.state.resources.blue.fire, 0);
  assert.equal(action.events.filter(event => event.type === 'damage' && event.source.id === yiIds.ultimate).length, 9);
  const bursts = action.events.filter(event => event.type === 'damage' && event.source.id === yiIds.passive);
  assert.equal(bursts.length, 2);
  assert.ok(bursts.every(event => event.amount > 20000));
  assert.equal(action.state.units.r.statuses.find(status => status.statusId === yiIds.pieces)?.stacks, 1);
  assert.equal(effectiveDamageMultiplier(action.state.units.r), .95);
});

test('弈的同色棋子提供逐层伤害修正，敌方耗鬼火保留棋子，空耗火回合随机掉层', () => {
  const registry = new ContentRegistry(); registerYi(registry);
  const definition = registry.getHero(yiIds.hero);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: yiIds.hero, skillLevel: 5 };
  initial.units.r = { ...initial.units.r, statuses: [{ instanceId: `${yiIds.pieces}:b:r`, statusId: yiIds.pieces,
    source: { kind: 'skill', id: yiIds.passive, unitId: 'b' }, stacks: 3, duration: { kind: 'permanent' },
    values: { ownerUnitId: 'b', weakening: 2, vulnerability: 1 }, modifiers: [
      { stat: 'damage', operation: 'percent', amount: -.1 },
      { stat: 'damageTaken', operation: 'percent', amount: .05 },
    ] }] };
  const mark = initial.units.r.statuses[0];
  assert.equal(effectiveDamageMultiplier(initial.units.r), .9);
  assert.equal(effectiveDamageTakenMultiplier(initial.units.r), 1.05);
  const turnEnd = { eventId: 'yi-no-fire-turn', phase: 'turn-end', type: 'turn-ended',
    source: { kind: 'system', id: 'turn' }, unitId: 'r' };
  const dropped = definition.handlers['turn-end'].handle(createBattleContext(initial, () => 0), turnEnd);
  assert.ok(dropped.some(command => command.type === 'add-status' && command.instance.stacks === 2));
  assert.equal(dropped.find(command => command.type === 'add-status').instance.values.weakening, 1);
  const resourceEvent = { eventId: 'yi-enemy-spent-fire', phase: 'resource-payment', type: 'resource-changed',
    source: { kind: 'skill', id: 'enemy.skill', unitId: 'r' }, side: 'red', resourceId: 'fire', before: 2, after: 1 };
  const paid = definition.handlers['resource-payment'].handle(createBattleContext(initial), resourceEvent);
  assert.ok(paid.some(command => command.type === 'add-status' && command.instance.statusId === yiIds.fireSpent));
  const paidState = applyEffectCommands(initial, paid, 'resource-payment', resourceEvent.eventId, id => registry.getStatus(id)).state;
  const paidTurnEnd = definition.handlers['turn-end'].handle(createBattleContext(paidState, () => 0), turnEnd);
  assert.ok(paidTurnEnd.some(command => command.type === 'remove-status-instances' && command.instanceIds[0].startsWith(yiIds.fireSpent)));
  assert.ok(!paidTurnEnd.some(command => command.type === 'add-status' && command.instance.statusId === yiIds.pieces));
  const preserved = applyEffectCommands(paidState, paidTurnEnd, 'turn-end', 'yi-paid-turn-end', id => registry.getStatus(id)).state;
  assert.equal(preserved.units.r.statuses.find(status => status.statusId === yiIds.pieces).stacks, 3);
});

test('蜜桃&芥子觉醒后30%概率减伤50%，蜜桃·地狱偶像按等级治疗推条并消耗2火', () => {
  const registry = new ContentRegistry(); registerPeachMaki(registry);
  const definition = registry.getHero(peachMakiIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: peachMakiIds.hero, awakeFilter: 1, skillLevel: 5 };
  initial.units.b2 = { ...unit('b2', 'blue'), heroId: 2, hp: 6000, actionGauge: 4 };
  initial.units.r = { ...initial.units.r, hp: 100000, stats: { ...initial.units.r.stats, hp: 100000, attack: 1000 } };
  initial.sides.blue.push('b2');
  const hitContext = { battle: createBattleContext(initial, () => .29), attackId: 1, hitIndex: 0,
    targetIds: ['b'], attackShape: 'single', isUnitUnableToAct: () => false };
  assert.equal(definition.interceptIncomingDamage(initial, initial.units.r, initial.units.b, 1000, 'normal', hitContext).amount, 500);
  const failedContext = { ...hitContext, battle: createBattleContext(initial, () => .3) };
  assert.equal(definition.interceptIncomingDamage(initial, initial.units.r, initial.units.b, 1000, 'normal', failedContext), undefined);
  const unawakened = { ...initial.units.b, awakeFilter: 0 };
  assert.equal(definition.interceptIncomingDamage(initial, initial.units.r, unawakened, 1000, 'normal', hitContext), undefined);
  initial.resources.blue.fire = 2;
  const action = executeAction(initial, { actorId: 'b', skillId: peachMakiIds.ultimate, targetIds: ['b', 'b2'],
    shape: 'all-allies', targetRelation: 'ally' }, registry, () => .5, { resolveStatus: id => registry.getStatus(id) });
  assert.equal(action.accepted, true);
  assert.equal(action.state.resources.blue.fire, 0);
  assert.equal(action.state.units.b2.hp, 7000);
  assert.equal(action.state.units.b.actionGauge, 25);
  assert.equal(action.state.units.b2.actionGauge, 29);
});

test('面灵气注灵延迟结算间接伤害，善面友方行动后推条并转恶面', () => {
  const registry = new ContentRegistry(); registerMenreiki(registry);
  const definition = registry.getHero(menreikiIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: menreikiIds.hero, awakeFilter: 1, skillLevel: 5 };
  initial.units.b2 = { ...unit('b2', 'blue'), hp: 7000, actionGauge: 0 };
  initial.units.r = { ...initial.units.r, hp: 5000, stats: { ...initial.units.r.stats, hp: 10000, defense: 0 } };
  initial.units.r2 = { ...unit('r2', 'red'), hp: 2000 };
  initial.sides.blue.push('b2'); initial.sides.red.push('r2');
  const opening = definition.initialize(createBattleContext(initial), 'b');
  assert.deepEqual(opening.map(command => command.targetId), ['b2']);
  assert.equal(opening[0].instance.statusId, menreikiIds.goodMask);
  const marked = applyEffectCommands(initial, opening, 'battle-start', 'menreiki-opening', id => registry.getStatus(id)).state;
  const actionEnd = { eventId: 'menreiki-ally-action', phase: 'action-end', type: 'action-ended',
    source: { kind: 'skill', id: 'ally.basic', unitId: 'b2' }, actionKind: 'basic', skillId: 'ally.basic',
    soulTriggersAllowed: true, intent: { actorId: 'b2', skillId: 'ally.basic', targetIds: ['r'], shape: 'single' } };
  const transfer = definition.handlers['action-end'].handle(createBattleContext(marked, () => .5), actionEnd);
  assert.equal(transfer.find(command => command.type === 'change-action-gauge').amount, 10);
  assert.equal(transfer.find(command => command.type === 'add-status').targetId, 'r2');

  const basic = definition.skills.find(skill => skill.id === menreikiIds.basic);
  const white = basic.execute(createBattleContext(marked, () => .5), { actorId: 'b', skillId: menreikiIds.basic,
    targetIds: ['r'], shape: 'single' }, { ratio: 1.25 });
  assert.equal(white.length, 1);
  assert.equal(white[0].instance.values.damageRatio, 1.25);
  assert.equal(white.some(command => command.type === 'deal-damage' || command.type === 'lose-life'), false);
  const withWhite = applyEffectCommands(marked, white, 'action', 'menreiki-white', id => registry.getStatus(id)).state;
  const detonation = definition.handlers['turn-start'].handle(createBattleContext(withWhite, () => .5),
    { eventId: 'menreiki-white-tick', phase: 'turn-start', type: 'turn-started', source: { kind: 'system', id: 'turn' }, unitId: 'r' });
  assert.ok(detonation.some(command => command.type === 'lose-life' && command.lifeLossKind === 'indirect'));
  assert.ok(detonation.some(command => command.type === 'remove-status-instances'
    && command.instanceIds.includes(white[0].instance.instanceId)));
});

test('面灵气禁断之面消耗3火、按恶面层数造成间接伤害、推善面友方并重放七张面具', () => {
  const registry = new ContentRegistry(); registerMenreiki(registry);
  const definition = registry.getHero(menreikiIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: menreikiIds.hero, skillLevel: 3 };
  initial.units.b2 = { ...unit('b2', 'blue'), hp: 7000, actionGauge: 3,
    statuses: [{ instanceId: 'good:b:b2', statusId: menreikiIds.goodMask, source: { kind: 'skill', id: menreikiIds.passive, unitId: 'b' },
      stacks: 1, duration: { kind: 'permanent' } }] };
  initial.units.r = { ...initial.units.r, hp: 10000, stats: { ...initial.units.r.stats, hp: 10000, defense: 0 },
    statuses: [{ instanceId: 'evil:b:r', statusId: menreikiIds.evilMask, source: { kind: 'skill', id: menreikiIds.passive, unitId: 'b' },
      stacks: 2, duration: { kind: 'permanent' } }] };
  initial.units.r2 = { ...unit('r2', 'red'), hp: 5000 };
  initial.sides.blue.push('b2'); initial.sides.red.push('r2'); initial.resources.blue.fire = 3;
  const dispatcher = new EventDispatcher();
  for (const [phase, rule] of Object.entries(definition.handlers)) dispatcher.register({ id: `menreiki-${phase}`,
    phase, priority: rule.priority, handle: rule.handle });
  const action = executeAction(initial, { actorId: 'b', skillId: menreikiIds.ultimate, targetIds: ['r', 'r2'],
    shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .5,
    { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(action.accepted, true);
  assert.equal(action.state.resources.blue.fire, 0);
  assert.ok(action.events.some(event => event.type === 'life-lost' && event.source.id === menreikiIds.ultimate
    && event.targetId === 'r' && event.lifeLossKind === 'indirect'));
  assert.ok(action.events.some(event => event.type === 'action-gauge-changed' && event.unitId === 'b2' && event.after > event.before));
  const masks = Object.values(action.state.units).flatMap(unit => unit.statuses.filter(status =>
    (status.statusId === menreikiIds.goodMask || status.statusId === menreikiIds.evilMask) && status.source.unitId === 'b'));
  assert.equal(masks.filter(status => status.statusId === menreikiIds.goodMask).length, 1);
  assert.equal(masks.reduce((total, status) => total + (status.statusId === menreikiIds.evilMask ? status.stacks : 0), 0), 6);
});

test('面灵气的善恶面数量实时换算为抵抗、减伤、速度和增伤，封印被动后撤销', () => {
  const registry = new ContentRegistry(); registerMenreiki(registry);
  const definition = registry.getHero(menreikiIds.hero);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: menreikiIds.hero, skillLevel: 5 };
  initial.units.b2 = { ...unit('b2', 'blue'), statuses: [{ instanceId: 'good:b:b2', statusId: menreikiIds.goodMask,
    source: { kind: 'skill', id: menreikiIds.passive, unitId: 'b' }, stacks: 1, duration: { kind: 'permanent' } }] };
  initial.units.r = { ...initial.units.r, statuses: [{ instanceId: 'evil:b:r', statusId: menreikiIds.evilMask,
    source: { kind: 'skill', id: menreikiIds.passive, unitId: 'b' }, stacks: 2, duration: { kind: 'permanent' } }] };
  initial.sides.blue.push('b2');
  const added = definition.handlers['effect-resolution'].handle(createBattleContext(initial),
    { eventId: 'menreiki-mask-added', phase: 'effect-resolution', type: 'status-added', targetId: 'b2',
      source: initial.units.b2.statuses[0].source, instance: initial.units.b2.statuses[0] });
  const bonus = added.find(command => command.type === 'add-status' && command.instance.statusId === menreikiIds.passiveStats);
  assert.deepEqual(bonus.instance.values, { goodCount: 1, evilCount: 2, rank: 5 });
  assert.deepEqual(bonus.instance.modifiers, [
    { stat: 'resist', operation: 'percent', amount: .2 },
    { stat: 'speed', operation: 'flat', amount: 40 },
    { stat: 'damage', operation: 'percent', amount: .2 },
    { stat: 'damageTaken', operation: 'percent', amount: -.1 },
  ]);
  initial.units.b = { ...initial.units.b, statuses: [bonus.instance] };
  const suppressed = { ...initial.units.b.statuses[0], instanceId: 'passive-seal', statusId: 'core.passive-suppression' };
  initial.units.b.statuses.push(suppressed);
  const sealed = definition.handlers['effect-resolution'].handle(createBattleContext(initial),
    { eventId: 'menreiki-passive-sealed', phase: 'effect-resolution', type: 'status-added', targetId: 'b',
      source: suppressed.source, instance: suppressed });
  assert.ok(sealed.some(command => command.type === 'remove-status-instances'
    && command.instanceIds.includes(bonus.instance.instanceId)));
});

test('鬼切鬼斩随机激活单把佩刀，鬼影闪耗3火、三段伤害并激活三把佩刀', () => {
  const registry = new ContentRegistry(); registerOnikiri(registry);
  const definition = registry.getHero(onikiriIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: onikiriIds.hero, skillLevel: 5,
    skillLevels: { [onikiriIds.basic]: 5, [onikiriIds.ultimate]: 5, [onikiriIds.passive]: 1 } };
  initial.resources.blue.fire = 3;
  const basic = definition.skills.find(skill => skill.id === onikiriIds.basic);
  const basicCommands = basic.execute(createBattleContext(initial, () => .99),
    { actorId: 'b', skillId: onikiriIds.basic, targetIds: ['r'], shape: 'single' }, { ratio: 1 });
  assert.equal(basicCommands.filter(command => command.type === 'deal-damage').length, 1);
  assert.ok(basicCommands.some(command => command.type === 'add-status' && command.instance.statusId === onikiriIds.executionBlade));
  const ultimate = definition.skills.find(skill => skill.id === onikiriIds.ultimate);
  const ultimateCommands = ultimate.execute(createBattleContext(initial, () => .4),
    { actorId: 'b', skillId: onikiriIds.ultimate, targetIds: ['r'], shape: 'single' }, { ratio: 1 });
  assert.equal(ultimate.resourceCost.amount, 3);
  assert.equal(ultimateCommands.filter(command => command.type === 'deal-damage').length, 3);
  assert.deepEqual(ultimateCommands.filter(command => command.type === 'add-status').map(command => command.instance.statusId), [...new Set([
    onikiriIds.assistBlade, onikiriIds.guardBlade, onikiriIds.executionBlade,
  ])]);
});

test('鬼切被动按技能等级开局随机获得不同佩刀，鬼甲最多减伤三次', () => {
  const registry = new ContentRegistry(); registerOnikiri(registry);
  const definition = registry.getHero(onikiriIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: onikiriIds.hero, skillLevel: 3, awakeFilter: 0,
    skillLevels: { [onikiriIds.passive]: 3 } };
  const opening = definition.initialize(createBattleContext(initial, () => 0), 'b');
  assert.equal(opening.length, 2);
  assert.equal(new Set(opening.map(command => command.instance.statusId)).size, 2);
  const guard = { instanceId: 'guard:b', statusId: onikiriIds.guardBlade,
    source: { kind: 'skill', id: onikiriIds.ultimate, unitId: 'b' }, stacks: 1,
    duration: { kind: 'permanent' }, values: { charges: 3 } };
  initial.units.b.statuses = [guard];
  for (let i = 0; i < 3; i++) {
    const interception = definition.interceptIncomingDamage(initial, initial.units.r, initial.units.b, 1000, 'normal');
    assert.equal(interception.amount, 500);
    initial = applyEffectCommands(initial, interception.effects, 'effect-resolution', `onikiri-guard-${i}`, id => registry.getStatus(id)).state;
  }
  assert.equal(initial.units.b.statuses.some(status => status.statusId === onikiriIds.guardBlade), false);
});

test('鬼切目标低于85%生命才触发125%追斩，追斩忽略护盾且不能分摊', () => {
  const registry = new ContentRegistry(); registerOnikiri(registry);
  const definition = registry.getHero(onikiriIds.hero);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: onikiriIds.hero, skillLevel: 1 };
  initial.units.r.hp = 8400;
  const event = { eventId: 'oni-trigger', phase: 'attack-end', type: 'attack-ended', source: { kind: 'skill', id: 'ally', unitId: 'b' },
    hitCount: 1, actionKind: 'basic', targetHealthChanges: [{ targetId: 'r', hpBefore: 10000, hpAfter: 8400, hpLost: 1600 }] };
  const commands = definition.handlers['attack-end'].handle(createBattleContext(initial, () => .5), event);
  const slash = commands.find(command => command.type === 'deal-damage');
  assert.equal(slash.amount, 6250);
  assert.equal(slash.ignoreShield, true);
  assert.equal(slash.cannotBeShared, true);
  assert.equal(slash.suppressTargetPassiveTriggers, true);
  assert.equal(slash.suppressTargetSoulTriggers, true);
  const boundary = definition.handlers['attack-end'].handle(createBattleContext({ ...initial, units: { ...initial.units,
    r: { ...initial.units.r, hp: 8500 } } }), { ...event, eventId: 'oni-boundary', targetHealthChanges: [
    { targetId: 'r', hpBefore: 10000, hpAfter: 8500, hpLost: 1500 },
  ] });
  assert.equal(boundary, undefined);
});

test('鬼切追斩命中后重新检查65%血线并对敌方全体追加伤害，协战只跟随友方普攻', () => {
  const registry = new ContentRegistry(); registerOnikiri(registry);
  const definition = registry.getHero(onikiriIds.hero);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: onikiriIds.hero, skillLevel: 1 };
  initial.units.b2 = unit('b2', 'blue');
  initial.units.r.hp = 6000;
  initial.units.r2 = unit('r2', 'red');
  initial.units.r3 = unit('r3', 'red');
  initial.sides.blue.push('b2');
  initial.sides.red.push('r2', 'r3');
  const source = { kind: 'skill', id: onikiriIds.passive, unitId: 'b' };
  const marker = { instanceId: 'follow:b', statusId: onikiriIds.followup, source, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'event' }, values: { targetId: 'r' } };
  initial.units.b.statuses = [marker];
  const sweep = definition.handlers.hit.handle(createBattleContext(initial, () => .5), { eventId: 'oni-sweep-hit',
    phase: 'hit', source, type: 'damage', targetId: 'r', amount: 1250, hpBefore: 7250, hpAfter: 6000, hpLost: 1250,
    shieldConsumed: 0, extHpConsumed: 0, reboundDamage: 0, leechDamage: 0, mitigated: 0, isCritical: false });
  assert.equal(sweep.filter(command => command.type === 'deal-damage').length, 3);
  assert.ok(sweep.filter(command => command.type === 'deal-damage').every(command => command.ignoreShield && command.cannotBeShared));
  const assistStatus = { instanceId: 'assist:b', statusId: onikiriIds.assistBlade,
    source: { kind: 'skill', id: onikiriIds.ultimate, unitId: 'b' }, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'source-turn' } };
  initial.units.b.statuses = [assistStatus];
  const assist = definition.handlers['action-end'].handle(createBattleContext(initial, () => 0), { eventId: 'ally-basic-end',
    phase: 'action-end', source: { kind: 'skill', id: 'ally-basic', unitId: 'b2' }, type: 'action-ended', actionKind: 'basic',
    skillId: 'ally-basic', soulTriggersAllowed: true,
    intent: { actorId: 'b2', skillId: 'ally-basic', targetIds: ['r'], shape: 'single', targetRelation: 'enemy' } });
  assert.equal(assist.length, 1);
  assert.equal(assist[0].intent.skillId, onikiriIds.basic);
  assert.equal(assist[0].freeCast, true);
});

test('杀生丸毒华爪按等级造成伤害并在二级起判定降防，冥道残月破耗3火并附加禁疗创伤', () => {
  const registry = new ContentRegistry(); registerSesshomaru(registry);
  const definition = registry.getHero(sesshomaruIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: sesshomaruIds.hero, skillLevel: 2,
    skillLevels: { [sesshomaruIds.basic]: 2, [sesshomaruIds.ultimate]: 2, [sesshomaruIds.passive]: 1 } };
  initial.units.r2 = unit('r2', 'red'); initial.sides.red.push('r2'); initial.resources.blue.fire = 3;
  const basic = definition.skills.find(skill => skill.id === sesshomaruIds.basic);
  const basicCommands = basic.execute(createBattleContext(initial, () => 0),
    { actorId: 'b', skillId: sesshomaruIds.basic, targetIds: ['r'], shape: 'single' }, { ratio: 1.05 });
  assert.equal(basicCommands[0].amount, 5250);
  const basicApplied = applyEffectCommands(initial, basicCommands, 'effect-resolution', 'sessho-basic', id => registry.getStatus(id));
  const defenseDown = basicApplied.state.units.r.statuses.find(status => status.statusId === sesshomaruIds.defenseDown);
  assert.equal(defenseDown.duration.remaining, 1);
  assert.deepEqual(defenseDown.modifiers, [{ stat: 'defense', operation: 'percent', amount: -.2 }]);
  const ultimate = definition.skills.find(skill => skill.id === sesshomaruIds.ultimate);
  const ultimateCommands = ultimate.execute(createBattleContext(initial, () => 0),
    { actorId: 'b', skillId: sesshomaruIds.ultimate, targetIds: ['r', 'r2'], shape: 'all-enemies' }, { ratio: 1.58 });
  assert.equal(ultimate.resourceCost.amount, 3);
  assert.equal(ultimateCommands.filter(command => command.type === 'deal-damage').length, 2);
  const wound = ultimateCommands.find(command => command.type === 'add-status' && command.instance.statusId === sesshomaruIds.wound);
  assert.equal(wound.instance.duration.remaining, 2);
  assert.equal(registry.getStatus(sesshomaruIds.wound).preventsRevive, true);
  assert.deepEqual(wound.instance.modifiers[0].condition, { healthRatioBelow: .3 });
});

test('杀生丸天生牙按已损生命封顶减伤，觉醒致命保护每回目一次并接续无敌、减伤和吸血', () => {
  const registry = new ContentRegistry(); registerSesshomaru(registry);
  const definition = registry.getHero(sesshomaruIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: sesshomaruIds.hero, awakeFilter: 1, hp: 1000, skillLevel: 1 };
  assert.equal(definition.modifyIncomingDamage(initial.units.r, initial.units.b, 5000, 'normal'), 3500);
  const opened = applyEffectCommands(initial, definition.initialize(createBattleContext(initial, () => .5), 'b'),
    'effect-resolution', 'sessho-open', id => registry.getStatus(id)).state;
  initial = { ...opened, units: { ...opened.units, b: { ...opened.units.b, statuses: [
    ...opened.units.b.statuses,
    { instanceId: 'old-debuff', statusId: sesshomaruIds.defenseDown, source: { kind: 'skill', id: 'enemy', unitId: 'r' },
      stacks: 1, duration: { kind: 'permanent' } },
  ] } } };
  const lethal = applyEffectCommands(initial, [{ type: 'deal-damage', source: { kind: 'skill', id: 'lethal', unitId: 'r' },
    targetId: 'b', amount: 5000 }], 'effect-resolution', 'sessho-lethal', id => registry.getStatus(id));
  assert.equal(lethal.state.units.b.hp, 1);
  const consumed = lethal.events.find(event => event.type === 'status-removed' && event.statusId === sesshomaruIds.fatalGuard);
  assert.equal(consumed.reason, 'consumed');
  const transition = definition.handlers['effect-resolution'].handle(createBattleContext(lethal.state, () => .5,
    id => registry.getStatus(id)?.category), consumed);
  let transitioned = applyEffectCommands(lethal.state, transition, 'effect-resolution', 'sessho-transition', id => registry.getStatus(id)).state;
  assert.equal(transitioned.units.b.statuses.some(status => status.statusId === sesshomaruIds.defenseDown), false);
  assert.equal(definition.modifyIncomingDamage(transitioned.units.r, transitioned.units.b, 5000, 'normal'), 0);
  const deniedAssist = executeAction(transitioned, { actorId: 'b', skillId: sesshomaruIds.basic, targetIds: ['r'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .5,
  { scheduling: 'assist', resolveStatus: id => registry.getStatus(id) });
  assert.equal(deniedAssist.failure, 'skill-unavailable');
  const deniedDirectAssist = applyEffectCommands(transitioned, [{ type: 'schedule-attack', source: { kind: 'skill', id: 'ally-assist', unitId: 'r' },
    scheduling: 'assist', intent: { actorId: 'b', skillId: sesshomaruIds.basic, targetIds: ['r'], shape: 'single', targetRelation: 'enemy' },
    hits: [{ targetId: 'r', amount: 1000 }] }], 'effect-resolution', 'sessho-direct-assist', id => registry.getStatus(id));
  assert.equal(deniedDirectAssist.state.units.r.hp, transitioned.units.r.hp);
  assert.equal(deniedDirectAssist.events.length, 0);
  const nextStart = definition.handlers['turn-start'].handle(createBattleContext(transitioned, () => .5), {
    eventId: 'sessho-next-start', phase: 'turn-start', type: 'turn-started', unitId: 'b' });
  transitioned = applyEffectCommands(transitioned, nextStart, 'effect-resolution', 'sessho-next-start-effects', id => registry.getStatus(id)).state;
  assert.ok(transitioned.units.b.statuses.some(status => status.statusId === sesshomaruIds.aftershock));
  assert.equal(definition.handlers.hit.handle(createBattleContext(transitioned, () => .5), {
    eventId: 'sessho-leech', phase: 'hit', type: 'damage', source: { kind: 'skill', id: 'counter', unitId: 'b' },
    targetId: 'r', amount: 100, hpBefore: 500, hpAfter: 400, hpLost: 100, shieldConsumed: 0, extHpConsumed: 0,
    reboundDamage: 0, leechDamage: 0, mitigated: 0, isCritical: false,
  })[0].amount, 30);
  const nextRound = { ...transitioned, counters: { ...transitioned.counters, round: 2 } };
  const rearmed = definition.handlers['turn-start'].handle(createBattleContext(nextRound, () => .5), {
    eventId: 'sessho-round-start', phase: 'turn-start', type: 'turn-started', unitId: 'r' });
  assert.ok(rearmed.some(command => command.type === 'add-status' && command.instance.statusId === sesshomaruIds.fatalGuard));
  assert.ok(rearmed.some(command => command.type === 'remove-status-instances'
    && command.instanceIds.includes(`${sesshomaruIds.lifeSteal}:b`)));
});

test('少羽大天狗羽刃之风逐次提高重复目标伤害，并按其他存活敌人数量分裂小风刃', () => {
  const registry = new ContentRegistry(); registerYouthfulOotengu(registry);
  const definition = registry.getHero(youthfulOotenguIds.hero);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: youthfulOotenguIds.hero, skillLevel: 5,
    skillLevels: { [youthfulOotenguIds.basic]: 5, [youthfulOotenguIds.ultimate]: 5, [youthfulOotenguIds.passive]: 1 } };
  initial.units.r2 = unit('r2', 'red'); initial.units.r3 = unit('r3', 'red'); initial.sides.red.push('r2', 'r3');
  const ultimate = definition.skills.find(skill => skill.id === youthfulOotenguIds.ultimate);
  const commands = ultimate.execute(createBattleContext(initial, () => .5),
    { actorId: 'b', skillId: youthfulOotenguIds.ultimate, targetIds: ['r'], shape: 'single' }, { ratio: .5 });
  assert.equal(ultimate.resourceCost.amount, 3);
  assert.equal(commands.length, 15);
  const mainHits = commands.filter(command => command.targetId === 'r');
  assert.deepEqual(mainHits.map(command => command.amount), [2500, 2750, 3000, 3250, 3500]);
  assert.equal(commands.filter(command => command.targetId === 'r2').length, 5);
  assert.equal(commands.filter(command => command.targetId === 'r3').length, 5);
});

test('少羽大天狗逐风每次造成伤害叠1层至80层，40层门槛减1火，受多段攻击获得2回合加速', () => {
  const registry = new ContentRegistry(); registerYouthfulOotengu(registry);
  const definition = registry.getHero(youthfulOotenguIds.hero);
  const instance = stacks => ({ instanceId: 'wind:b', statusId: youthfulOotenguIds.chasingWind,
    source: { kind: 'skill', id: youthfulOotenguIds.passive, unitId: 'b' }, stacks, duration: { kind: 'permanent' },
    modifiers: [{ stat: 'speed', operation: 'flat', amount: 1, perStack: true }] });
  const actor = { ...unit('b', 'blue'), heroId: youthfulOotenguIds.hero, statuses: [instance(39)] };
  const ultimate = definition.skills.find(skill => skill.id === youthfulOotenguIds.ultimate);
  assert.equal(ultimate.resolveResourceCost(state(), actor).amount, 3);
  actor.statuses = [instance(40)];
  assert.equal(ultimate.resolveResourceCost(state(), actor).amount, 2);
  actor.statuses = [instance(80)];
  assert.equal(ultimate.resolveResourceCost(state(), actor).amount, 1);
  const oneStack = definition.handlers.hit.handle(createBattleContext({ ...state(), units: { ...state().units, b: actor } }, () => .5), {
    eventId: 'ootengu-hit', phase: 'hit', type: 'damage', source: { kind: 'skill', id: youthfulOotenguIds.basic, unitId: 'b' },
    targetId: 'r', amount: 100, hpBefore: 10000, hpAfter: 9900, hpLost: 100, shieldConsumed: 0, extHpConsumed: 0,
    reboundDamage: 0, leechDamage: 0, mitigated: 0, isCritical: false,
  });
  assert.equal(oneStack, undefined);
  actor.statuses = [instance(79)];
  const capped = definition.handlers.hit.handle(createBattleContext({ ...state(), units: { ...state().units, b: actor } }, () => .5), {
    eventId: 'ootengu-cap-hit', phase: 'hit', type: 'damage', source: { kind: 'skill', id: youthfulOotenguIds.basic, unitId: 'b' },
    targetId: 'r', amount: 100, hpBefore: 10000, hpAfter: 9900, hpLost: 100, shieldConsumed: 0, extHpConsumed: 0,
    reboundDamage: 0, leechDamage: 0, mitigated: 0, isCritical: false,
  });
  assert.equal(capped[0].instance.stacks, 1);
  assert.equal(registry.getStatus(youthfulOotenguIds.chasingWind).maxStacks, 80);
  actor.statuses = [];
  let incoming = { ...state(), units: { ...state().units, b: actor } };
  const incomingHit = hitIndex => ({ eventId: `ootengu-received-${hitIndex}`, phase: 'hit', type: 'damage', attackId: 7,
    hitIndex, source: { kind: 'skill', id: 'enemy-multi', unitId: 'r' }, targetId: 'b', amount: 100,
    hpBefore: 10000 - hitIndex * 100, hpAfter: 9900 - hitIndex * 100, hpLost: 100, shieldConsumed: 0,
    extHpConsumed: 0, reboundDamage: 0, leechDamage: 0, mitigated: 0, isCritical: false });
  for (let hit = 0; hit < 2; hit++) {
    const tracker = definition.handlers.hit.handle(createBattleContext(incoming, () => .5), incomingHit(hit));
    incoming = applyEffectCommands(incoming, tracker, 'effect-resolution', `ootengu-tracker-${hit}`,
      id => registry.getStatus(id)).state;
  }
  const speed = definition.handlers['attack-end'].handle(createBattleContext(incoming, () => .5), {
    eventId: 'ootengu-multi-hit', phase: 'attack-end', type: 'attack-ended', attackId: 7,
    source: { kind: 'skill', id: 'enemy-multi', unitId: 'r' }, hitCount: 2,
    targetHealthChanges: [{ targetId: 'b', hpBefore: 10000, hpAfter: 9800, hpLost: 200 }],
  });
  assert.equal(speed[0].instance.duration.remaining, 2);
  assert.deepEqual(speed[0].instance.modifiers, [{ stat: 'speed', operation: 'percent', amount: 1 }]);
});

test('少羽大天狗羽刃之风只把已阵亡非召唤敌方式神计入额外段数，召唤物不加段', () => {
  const registry = new ContentRegistry(); registerYouthfulOotengu(registry);
  const definition = registry.getHero(youthfulOotenguIds.hero);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: youthfulOotenguIds.hero, skillLevel: 5,
    skillLevels: { [youthfulOotenguIds.ultimate]: 5, [youthfulOotenguIds.passive]: 1 } };
  initial.units.r2 = unit('r2', 'red'); initial.units.r3 = unit('r3', 'red');
  initial.units.r4 = { ...unit('r4', 'red'), hp: 0 };
  initial.units.r5 = { ...unit('r5', 'red'), unitKind: 'summon', hp: 0 };
  initial.units.r6 = { ...unit('r6', 'red'), unitKind: 'summon', hp: 0 };
  initial.units.r7 = { ...unit('r7', 'red'), unitKind: 'summon', hp: 0 };
  initial.sides.red.push('r2', 'r3', 'r4', 'r5', 'r6', 'r7');
  const ultimate = definition.skills.find(skill => skill.id === youthfulOotenguIds.ultimate);
  const commands = ultimate.execute(createBattleContext(initial, () => .5),
    { actorId: 'b', skillId: youthfulOotenguIds.ultimate, targetIds: ['r'], shape: 'single' }, { ratio: .5 });
  assert.equal(commands.length, 21);
  assert.equal(commands.filter(command => command.targetId === 'r').length, 7);
});

test('萤草治愈之光优先把祝福之种交给玩家选中的存活友方', () => {
  const registry = new ContentRegistry(); registerFirefly(registry);
  const definition = registry.getHero(fireflyIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: fireflyIds.hero, skillLevel: 5,
    skillLevels: { [fireflyIds.heal]: 5 }, stats: { ...initial.units.b.stats, attack: 1000 }, hp: 5000 };
  initial.units.friend = { ...unit('friend', 'blue'), stats: { ...unit('friend', 'blue').stats, attack: 5000 }, hp: 5000 };
  initial.units.friend2 = { ...unit('friend2', 'blue'), stats: { ...unit('friend2', 'blue').stats, attack: 9000 }, hp: 5000 };
  initial.sides.blue.push('friend', 'friend2');
  initial.resources.blue.fire = 2;
  const setup = definition.initialize(createBattleContext(initial), 'b');
  initial = applyEffectCommands(initial, setup, 'effect-resolution', 'firefly-setup', id => registry.getStatus(id)).state;
  initial.units.b = { ...initial.units.b, statuses: [{ instanceId: 'foreign-seed', statusId: fireflyIds.seed,
    source: { kind: 'skill', id: fireflyIds.passive, unitId: 'other-firefly' }, stacks: 1,
    duration: { kind: 'permanent' } }, ...initial.units.b.statuses] };
  const heal = definition.skills.find(skill => skill.id === fireflyIds.heal);
  const commands = heal.execute(createBattleContext(initial), { actorId: 'b', skillId: fireflyIds.heal,
    targetIds: ['b', 'friend', 'friend2'], selectedTargetId: 'friend', shape: 'all-allies', targetRelation: 'ally' },
  { ratio: 1.04, hotRatio: .26 });
  const transferred = commands.find(command => command.type === 'add-status' && command.targetId === 'friend'
    && command.instance.statusId === fireflyIds.seed);
  assert.ok(transferred, 'selected friend receives the seed even when another ally has higher attack');
  const remainingOwnSeed = commands.find(command => command.type === 'add-status' && command.targetId === 'b'
    && command.instance.statusId === fireflyIds.seed);
  assert.equal(remainingOwnSeed?.instance.instanceId, `${fireflyIds.seed}:b:b`, '萤草 only spends the seed she owns');
  assert.equal(commands.some(command => command.type === 'add-status' && command.targetId === 'friend2'
    && command.instance.statusId === fireflyIds.seed), false);
});

test('萤草祝福之种在单个友方身上最多叠加5层', () => {
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: fireflyIds.hero, skillLevel: 5,
    skillLevels: { [fireflyIds.heal]: 5 }, statuses: [{ instanceId: `${fireflyIds.seed}:b:b`,
      statusId: fireflyIds.seed, source: { kind: 'skill', id: fireflyIds.passive, unitId: 'b' },
      stacks: 2, duration: { kind: 'permanent' }, values: { seedCount: 2 } }] };
  initial.units.a = { ...unit('a', 'blue'), statuses: [{ instanceId: `${fireflyIds.seed}:b:a`,
    statusId: fireflyIds.seed, source: { kind: 'skill', id: fireflyIds.passive, unitId: 'b' },
    stacks: 5, duration: { kind: 'permanent' }, values: { seedCount: 5 } }] };
  initial.sides.blue = ['b', 'a'];
  const registry = new ContentRegistry(); registerFirefly(registry);
  const definition = registry.getHero(fireflyIds.hero);
  const heal = definition.skills.find(skill => skill.id === fireflyIds.heal);
  const commands = heal.execute(createBattleContext(initial), { actorId: 'b', skillId: fireflyIds.heal,
    targetIds: ['b', 'a'], selectedTargetId: 'a', shape: 'all-allies', targetRelation: 'ally' }, { ratio: .87, hotRatio: .22 });
  const cappedSeed = commands.find(command => command.type === 'add-status' && command.targetId === 'a'
    && command.instance.statusId === fireflyIds.seed);
  assert.equal(cappedSeed.instance.stacks, 5, '转移种子不能突破客户端buff的五层上限');
});

test('天井下自动决策两名友方存活时供欢愉，残局优先收割10%生命以下敌人', () => {
  const registry = new ContentRegistry(); registerTenjukka(registry);
  const definition = registry.getHero(tenjukkaIds.hero);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: tenjukkaIds.hero };
  initial.units.r = { ...initial.units.r, hp: 500, stats: { ...initial.units.r.stats, hp: 10000 } };
  initial.units.r2 = { ...unit('r2', 'red'), hp: 1000, stats: { ...unit('r2', 'red').stats, hp: 10000 } };
  initial.sides.red.push('r2');
  initial.units.friend = unit('friend', 'blue');
  initial.sides.blue.push('friend');
  assert.equal(definition.policy(createBattleContext(initial), 'b').skillId, tenjukkaIds.awaken);

  initial.sides.blue = ['b']; delete initial.units.friend;
  const policy = definition.policy(createBattleContext(initial), 'b');
  assert.equal(policy.skillId, tenjukkaIds.basic);
  assert.deepEqual(policy.targetIds, ['r']);
});

test('化鲸自动决策优先救治40%以下队友，无缺齿甲时给攻击最高友方', () => {
  const registry = new ContentRegistry(); registerWhaleSummoner(registry);
  const definition = registry.getHero(whaleSummonerIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: whaleSummonerIds.hero, skillLevel: 5,
    skillLevels: { [whaleSummonerIds.tooth]: 5, [whaleSummonerIds.body]: 5 } };
  initial.units.friend = { ...unit('friend', 'blue'), hp: 3000,
    stats: { ...unit('friend', 'blue').stats, hp: 10000, attack: 7000 }, statuses: [{
      instanceId: 'existing-tooth', statusId: whaleSummonerIds.toothArmor,
      source: { kind: 'skill', id: whaleSummonerIds.tooth, unitId: 'other' }, stacks: 1, duration: { kind: 'permanent' },
    }] };
  initial.units.friend2 = { ...unit('friend2', 'blue'), stats: { ...unit('friend2', 'blue').stats, attack: 9000 } };
  initial.sides.blue.push('friend', 'friend2');
  initial.resources.blue.fire = 3;
  let policy = definition.policy(createBattleContext(initial), 'b');
  assert.equal(policy.skillId, whaleSummonerIds.body);
  assert.deepEqual(policy.targetIds, ['friend']);

  initial.units.friend = { ...initial.units.friend, hp: 10000, statuses: [] };
  policy = definition.policy(createBattleContext(initial), 'b');
  assert.equal(policy.skillId, whaleSummonerIds.tooth);
  assert.deepEqual(policy.targetIds, ['friend2']);
  initial.units.friend2 = { ...initial.units.friend2, statuses: [{
    instanceId: 'tooth-2', statusId: whaleSummonerIds.toothArmor,
    source: { kind: 'skill', id: whaleSummonerIds.tooth, unitId: 'other' }, stacks: 1, duration: { kind: 'permanent' },
  }] };
  assert.equal(definition.policy(createBattleContext(initial), 'b').skillId, whaleSummonerIds.basic);
});

test('御馔津单人持有灵符时自动AI按50%分支选择重开结界或燃爆', () => {
  const registry = new ContentRegistry(); registerOmikane(registry);
  const definition = registry.getHero(omikaneIds.hero);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: omikaneIds.hero, statuses: [{
    instanceId: 'single-miko-talisman', statusId: omikaneIds.talisman,
    source: { kind: 'skill', id: omikaneIds.foxHunt, unitId: 'b' }, stacks: 12, duration: { kind: 'permanent' },
  }, { instanceId: 'single-miko-field', statusId: omikaneIds.field,
    source: { kind: 'skill', id: omikaneIds.foxHunt, unitId: 'b' }, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }] };
  initial.resources.blue.fire = 3;
  const fox = definition.policy(createBattleContext(initial, () => .49), 'b');
  const arrow = definition.policy(createBattleContext(initial, () => .5), 'b');
  assert.equal(fox.skillId, omikaneIds.foxHunt);
  assert.equal(arrow.skillId, omikaneIds.spiritArrow);

  initial.units.friend = { ...unit('friend', 'blue'), heroId: omikaneIds.hero, statuses: [{
    instanceId: 'second-miko-talisman', statusId: omikaneIds.talisman,
    source: { kind: 'skill', id: omikaneIds.foxHunt, unitId: 'friend' }, stacks: 4, duration: { kind: 'permanent' },
  }] };
  initial.sides.blue.push('friend');
  assert.equal(definition.policy(createBattleContext(initial, () => .49), 'b').skillId, omikaneIds.spiritArrow,
    '有多个持符御馔津时按表使用破魔箭，不再套用单人50%分支');
});

test('不知火自动AI在未起舞时优先开结界，低生命不会擅自进入离殇', () => {
  const registry = new ContentRegistry(); registerShiranui(registry);
  const definition = registry.getHero(shiranuiIds.hero);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: shiranuiIds.hero, hp: 4000,
    stats: { ...initial.units.b.stats, hp: 10000 } };
  initial.resources.blue.fire = 3;
  assert.equal(definition.policy(createBattleContext(initial), 'b').skillId, shiranuiIds.starfire);
  initial.units.b = { ...initial.units.b, statuses: [{ instanceId: 'field', statusId: shiranuiIds.field,
    source: { kind: 'skill', id: shiranuiIds.starfire, unitId: 'b' }, stacks: 1, duration: { kind: 'permanent' } }] };
  assert.equal(definition.policy(createBattleContext(initial), 'b').skillId, shiranuiIds.basic);
});

test('荒骷髅自动AI把血色之花给攻击最高友方，已有花时优先攻击血量最高敌人', () => {
  const registry = new ContentRegistry(); registerSkullGeneral(registry);
  const definition = registry.getHero(skullGeneralIds.hero);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: skullGeneralIds.hero };
  initial.units.friend = { ...unit('friend', 'blue'), stats: { ...unit('friend', 'blue').stats, attack: 8000 }, statuses: [{
    instanceId: 'flower', statusId: skullGeneralIds.flower,
    source: { kind: 'skill', id: skullGeneralIds.passive, unitId: 'b' }, stacks: 1, duration: { kind: 'permanent' },
  }] };
  initial.units.friend2 = { ...unit('friend2', 'blue'), stats: { ...unit('friend2', 'blue').stats, attack: 3000 } };
  initial.units.r = { ...initial.units.r, hp: 9000, stats: { ...initial.units.r.stats, hp: 10000 } };
  initial.units.r2 = { ...unit('r2', 'red'), hp: 6000, stats: { ...unit('r2', 'red').stats, hp: 10000 } };
  initial.sides.blue.push('friend', 'friend2'); initial.sides.red.push('r2'); initial.resources.blue.fire = 2;
  let policy = definition.policy(createBattleContext(initial), 'b');
  assert.equal(policy.skillId, skullGeneralIds.banner);
  assert.deepEqual(policy.targetIds, ['r']);
  initial.units.friend = { ...initial.units.friend, statuses: [] };
  policy = definition.policy(createBattleContext(initial), 'b');
  assert.equal(policy.skillId, skullGeneralIds.transfer);
  assert.deepEqual(policy.targetIds, ['friend']);
});

test('多荒骷髅阵容中唯一被动只由队伍顺位第一名生效', () => {
  const registry = new ContentRegistry(); registerSkullGeneral(registry);
  const definition = registry.getHero(skullGeneralIds.hero);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: skullGeneralIds.hero };
  initial.units.skull2 = { ...unit('skull2', 'blue'), heroId: skullGeneralIds.hero };
  initial.sides.blue.push('skull2');
  const first = definition.initialize(createBattleContext(initial), 'b');
  const duplicate = definition.initialize(createBattleContext(initial), 'skull2');
  assert.ok(first.some(command => command.type === 'add-status' && command.instance.statusId === skullGeneralIds.flower));
  assert.ok(first.some(command => command.type === 'add-status' && command.instance.statusId === skullGeneralIds.maxHpGrowth));
  assert.deepEqual(duplicate, [], 'the duplicate does not create a second opening flower or growth tracker');

  const markedByDuplicate = { ...initial.units.r, statuses: [{ instanceId: 'duplicate-flower',
    statusId: skullGeneralIds.flower, source: { kind: 'skill', id: skullGeneralIds.transfer, unitId: 'skull2' },
    stacks: 1, duration: { kind: 'permanent' } }] };
  const withFlower = { ...initial, units: { ...initial.units, r: markedByDuplicate } };
  assert.equal(definition.interceptIncomingDamage(withFlower, withFlower.units.b, markedByDuplicate, 1000, 'normal'), undefined,
    'a flower granted by the duplicate cannot activate its unique damage-sharing passive');

  const duplicateLost = definition.handlers['effect-resolution'].handle(createBattleContext(initial), {
    eventId: 'duplicate-loss', phase: 'effect-resolution', type: 'life-lost', targetId: 'skull2', amount: 500, hpLost: 500,
    source: { kind: 'skill', id: 'enemy.skill', unitId: 'r' },
  });
  assert.equal(duplicateLost, undefined, 'a duplicate does not accumulate its own Iron Wall');
});

test('阿修罗进入疯狂后正确封印被动和御魂', () => {
  const registry = new ContentRegistry(); registerAsura(registry);
  const definition = registry.getHero(asuraIds.hero);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: asuraIds.hero, skillLevel: 5,
    skillLevels: { [asuraIds.sanitySkill]: 5 }, statuses: [{ instanceId: 'sanity-one', statusId: asuraIds.sanity,
      source: { kind: 'skill', id: asuraIds.sanitySkill, unitId: 'b' }, stacks: 1, duration: { kind: 'permanent' } }] };
  const commands = definition.handlers['attack-start'].handle(createBattleContext(initial), {
    eventId: 'asura-final-sanity', phase: 'attack-start', type: 'attack-start',
    source: { kind: 'skill', id: asuraIds.basic, unitId: 'b' }, targetIds: ['r'],
  });
  const madness = commands.find(command => command.type === 'add-status' && command.instance.statusId === asuraIds.madness);
  assert.equal(madness.instance.values.sealPassives, true);
  assert.equal(madness.instance.values.sealSouls, true);
  const applied = applyEffectCommands(initial, commands, 'attack-start', 'asura-madness', id => registry.getStatus(id)).state;
  const activeMadness = applied.units.b.statuses.find(status => status.statusId === asuraIds.madness);
  assert.equal(activeMadness.values.sealPassives, true);
  assert.equal(activeMadness.values.sealSouls, true);
});

test('荒骷髅伤害分担按花吻烈魂等级生效，且不致死、受封印和不可分担限制', () => {
  const registry = new ContentRegistry(); registerSkullGeneral(registry);
  const definition = registry.getHero(skullGeneralIds.hero);
  const attacker = { ...unit('enemy', 'red') };
  const target = { ...unit('bearer', 'blue'), statuses: [{ instanceId: 'flower', statusId: skullGeneralIds.flower,
    source: { kind: 'skill', id: skullGeneralIds.transfer, unitId: 'skull' }, stacks: 1, duration: { kind: 'permanent' } }] };
  for (const [rank, ratio] of [[1, .4], [2, .45], [3, .45], [4, .5], [5, .5]]) {
    const initial = state();
    initial.units.skull = { ...unit('skull', 'blue'), heroId: skullGeneralIds.hero, skillLevel: rank,
      skillLevels: { [skullGeneralIds.transfer]: rank }, hp: 10000, stats: { ...unit('skull', 'blue').stats, hp: 10000 } };
    initial.sides.blue.push('skull', 'bearer'); initial.units.bearer = target;
    const intercepted = definition.interceptIncomingDamage(initial, attacker, target, 1000, 'normal');
    assert.equal(intercepted.amount, 1000 * (1 - ratio), `rank ${rank} keeps the correct share`);
    assert.equal(intercepted.effects[0].amount, 1000 * ratio);
  }
  const lowHealth = state();
  lowHealth.units.skull = { ...unit('skull', 'blue'), heroId: skullGeneralIds.hero, skillLevel: 5,
    skillLevels: { [skullGeneralIds.transfer]: 5 }, hp: 100, stats: { ...unit('skull', 'blue').stats, hp: 100 } };
  lowHealth.sides.blue.push('skull', 'bearer'); lowHealth.units.bearer = target;
  const capped = definition.interceptIncomingDamage(lowHealth, attacker, target, 1000, 'normal');
  assert.equal(capped.effects[0].amount, 99);
  assert.equal(capped.amount, 901, '携带者只减去荒骷髅实际承担的99点伤害');
  lowHealth.units.skull = { ...lowHealth.units.skull, hp: 1 };
  assert.equal(definition.interceptIncomingDamage(lowHealth, attacker, target, 1000, 'normal'), undefined,
    '荒骷髅已到1点生命时不再虚减携带者伤害');
  const sealed = state();
  sealed.units.skull = { ...unit('skull', 'blue'), heroId: skullGeneralIds.hero, skillLevel: 5,
    statuses: [{ instanceId: 'seal', statusId: passiveSuppressionStatusId, source, stacks: 1, duration: { kind: 'permanent' } }] };
  sealed.sides.blue.push('skull', 'bearer'); sealed.units.bearer = target;
  assert.equal(definition.interceptIncomingDamage(sealed, attacker, target, 1000, 'normal'), undefined);
  sealed.units.skull = { ...sealed.units.skull, statuses: [] };
  assert.equal(definition.interceptIncomingDamage(sealed, attacker, target, 1000, 'normal', { cannotBeShared: true }), undefined);
});

test('血色之花的致命保护只用一次，三级按荒骷髅累计损失给携带者铁壁', () => {
  const registry = new ContentRegistry(); registerSkullGeneral(registry);
  const definition = registry.getHero(skullGeneralIds.hero);
  const skull = { ...unit('skull', 'blue'), heroId: skullGeneralIds.hero, skillLevel: 3,
    skillLevels: { [skullGeneralIds.transfer]: 3 }, statuses: [{ instanceId: 'wall', statusId: skullGeneralIds.ironWall,
      source: { kind: 'status', id: skullGeneralIds.ironWall, unitId: 'skull' }, stacks: 1, duration: { kind: 'permanent' },
      values: { totalLost: 2400, shieldRemaining: 1200 } }] };
  const bearer = { ...unit('bearer', 'blue'), hp: 0, stats: { ...unit('bearer', 'blue').stats, hp: 1000 }, statuses: [{ instanceId: 'flower', statusId: skullGeneralIds.flower,
    source: { kind: 'skill', id: skullGeneralIds.transfer, unitId: 'skull' }, stacks: 1, duration: { kind: 'permanent' } }] };
  const initial = state(); initial.units.skull = skull; initial.units.bearer = bearer; initial.sides.blue.push('skull', 'bearer');
  const event = { eventId: 'bearer-defeat', phase: 'unit-defeated', type: 'unit-defeated', unitId: 'bearer' };
  const commands = definition.handlers['unit-defeated'].handle(createBattleContext(initial), event);
  const revived = applyEffectCommands(initial, commands, 'effect-resolution', event.eventId,
    id => registry.getStatus(id)).state;
  assert.equal(revived.units.bearer.hp, 1);
  assert.equal(revived.units.bearer.statuses.find(status => status.statusId === skullGeneralIds.flower).values.fatalProtectionUsed, 1);
  assert.equal(revived.units.bearer.statuses.find(status => status.statusId === skullGeneralIds.ironWall).values.shieldRemaining, 2400,
    '承花者生命上限较低时，铁壁仍按荒骷髅的初始生命上限封顶');
  const second = definition.handlers['unit-defeated'].handle(createBattleContext({ ...revived,
    units: { ...revived.units, bearer: { ...revived.units.bearer, hp: 0 } } }), event);
  assert.ok(!second?.some(command => command.type === 'revive'), 'the same flower cannot rescue a second lethal hit');
});

test('平氏铁壁只记录荒骷髅承受的非战旗生命流失', () => {
  const registry = new ContentRegistry(); registerSkullGeneral(registry);
  const rule = registry.getHero(skullGeneralIds.hero).handlers['effect-resolution'];
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: skullGeneralIds.hero, statuses: [{ instanceId: 'wall', statusId: skullGeneralIds.ironWall,
    source: { kind: 'status', id: skullGeneralIds.ironWall, unitId: 'b' }, stacks: 1, duration: { kind: 'permanent' },
    values: { totalLost: 1000, shieldRemaining: 800 } }] };
  const lifeLost = { eventId: 'lost', phase: 'effect-resolution', type: 'life-lost', targetId: 'b', amount: 500, hpLost: 500,
    source: { kind: 'skill', id: 'enemy.skill', unitId: 'r' } };
  const added = rule.handle(createBattleContext(initial), lifeLost);
  const updated = applyEffectCommands(initial, added, 'effect-resolution', 'wall-update', id => registry.getStatus(id)).state;
  const wall = updated.units.b.statuses.find(status => status.statusId === skullGeneralIds.ironWall);
  assert.equal(wall.values.totalLost, 1500);
  assert.equal(wall.values.shieldRemaining, 1300);
  const grown = { ...initial, units: { ...initial.units, b: { ...initial.units.b,
    stats: { ...initial.units.b.stats, hp: 20000 }, statuses: [
      { instanceId: 'growth', statusId: skullGeneralIds.maxHpGrowth, source: { kind: 'status', id: skullGeneralIds.maxHpGrowth, unitId: 'b' },
        stacks: 1, duration: { kind: 'permanent' }, values: { baseMaxHp: 10000, growthCount: 2 } },
      { instanceId: 'wall-grown', statusId: skullGeneralIds.ironWall, source: { kind: 'status', id: skullGeneralIds.ironWall, unitId: 'b' },
        stacks: 1, duration: { kind: 'permanent' }, values: { totalLost: 1000, shieldRemaining: 4800 } },
    ] } } };
  const cappedWall = rule.handle(createBattleContext(grown), { ...lifeLost, hpLost: 500 });
  assert.equal(cappedWall[0].instance.values.shieldRemaining, 5000, '最大生命成长不会抬高平氏铁壁的初始上限');
  const bannerLoss = rule.handle(createBattleContext(initial), { ...lifeLost,
    source: { kind: 'skill', id: skullGeneralIds.banner, unitId: 'b' } });
  assert.equal(bannerLoss, undefined, 'banner self-cost is already recorded by the skill effect');
});

test('缚骨清姬降蛊之瞳三段叠加封疗/封推条伤口并逐段降低生命上限', () => {
  const registry = new ContentRegistry(); registerBoneBoundPrincess(registry);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: boneBoundPrincessIds.hero, skillLevel: 5,
    skillLevels: { [boneBoundPrincessIds.basic]: 5, [boneBoundPrincessIds.passive]: 5, [boneBoundPrincessIds.venomSkill]: 5 } };
  initial.units.r = { ...initial.units.r, hp: 100000, stats: { ...initial.units.r.stats, hp: 100000 } };
  initial.resources.blue.fire = 3;
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'hero:352:hit', phase: 'hit', priority: 35,
    handle: registry.getHero(boneBoundPrincessIds.hero).handlers.hit.handle });
  const result = executeAction(initial, { actorId: 'b', skillId: boneBoundPrincessIds.venomSkill,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, registry, () => .5,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(result.events.filter(event => event.type === 'damage' && event.source.id === boneBoundPrincessIds.venomSkill).length, 3);
  assert.equal(result.state.resources.blue.fire, 0);
  assert.ok(Math.abs(result.state.units.r.stats.hp - 100000 * .93 ** 3) < .01,
    `each level-five hit reduces seven percent of the then-current maximum; got ${result.state.units.r.stats.hp}; events=${JSON.stringify(result.events.filter(event => event.type === 'damage').map(event => [event.phase,event.source.id,event.eventId]))}; statuses=${JSON.stringify(result.state.units.r.statuses)}`);
  const wound = result.state.units.r.statuses.find(status => status.statusId === boneBoundPrincessIds.woundLife);
  assert.equal(wound.stacks, 3, JSON.stringify(result.state.units.r.statuses));
  const blocked = applyEffectCommands(result.state, [
    { type: 'heal', source: { kind: 'skill', id: 'test.heal', unitId: 'b' }, targetId: 'r', amount: 10000 },
    { type: 'change-action-gauge', source: { kind: 'skill', id: 'test.push' }, targetId: 'r', amount: 30 },
  ], 'effect-resolution', 'bone-bound-wounds', id => registry.getStatus(id));
  assert.equal(blocked.state.units.r.hp, result.state.units.r.hp);
  assert.equal(blocked.state.units.r.actionGauge, 0);
  assert.equal(blocked.state.units.r.statuses.find(status => status.statusId === boneBoundPrincessIds.woundLife).stacks, 1);
});

test('缚骨清姬蚀骨标记指定敌人并召唤蛇灵，技能四级获得减伤', () => {
  const registry = new ContentRegistry(); registerBoneBoundPrincess(registry);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: boneBoundPrincessIds.hero, skillLevel: 4,
    skillLevels: { [boneBoundPrincessIds.passive]: 4 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, resist: 0 } };
  const result = executeAction(initial, { actorId: 'b', skillId: boneBoundPrincessIds.passive,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, registry, () => .5);
  assert.ok(result.state.units.r.statuses.some(status => status.statusId === boneBoundPrincessIds.mark));
  const snake = Object.values(result.state.units).find(unit => unit.unitKind === 'summon' && unit.summonedByUnitId === 'b');
  assert.ok(snake);
  assert.equal(effectiveDamageTakenMultiplier(result.state.units.b), .6);
});

test('缚骨清姬标记随目标损血动态减攻并增加受伤', () => {
  const registry = new ContentRegistry(); registerBoneBoundPrincess(registry);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: boneBoundPrincessIds.hero, skillLevel: 1,
    skillLevels: { [boneBoundPrincessIds.passive]: 1 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, resist: 0 } };
  const marked = executeAction(initial, { actorId: 'b', skillId: boneBoundPrincessIds.passive,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, registry, () => .5);
  const injured = { ...marked.state, units: { ...marked.state.units,
    r: { ...marked.state.units.r, hp: marked.state.units.r.stats.hp * .8 } } };
  const update = registry.getHero(boneBoundPrincessIds.hero).handlers.hit.handle(createBattleContext(injured), {
    eventId: 'bone-mark-damage', phase: 'hit', type: 'damage', source: { kind: 'skill', id: 'test' }, targetId: 'r',
    damageKind: 'normal', amount: injured.units.r.stats.hp * .2, hpLost: injured.units.r.stats.hp * .2, mitigated: 0, isCritical: false,
  });
  const recalculated = applyEffectCommands(injured, update, 'effect-resolution', 'bone-mark-dynamic', id => registry.getStatus(id)).state;
  const target = recalculated.units.r;
  assert.ok(Math.abs(effectiveStats(target).attack / target.stats.attack - .6) < 1e-10);
  assert.ok(Math.abs(effectiveDamageTakenMultiplier(target) - 1.2) < 1e-10);
});

test('紧那罗每回合开放两种不同律音，五级弹奏免火并结算宫与破被动', () => {
  const registry = new ContentRegistry(); registerKinnara(registry);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: kinnaraIds.hero, skillLevel: 5,
    skillLevels: { [kinnaraIds.basic]: 5, [kinnaraIds.passive]: 5, [kinnaraIds.ultimate]: 5 },
    stats: { ...initial.units.b.stats, resist: 0 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, resist: 0, hp: 100000 }, hp: 100000 };
  const definition = registry.getHero(kinnaraIds.hero);
  const commands = definition.handlers['turn-start'].handle(createBattleContext(initial, () => 0), {
    eventId: 'kinnara-turn-start', phase: 'turn-start', type: 'turn-started', unitId: 'b', source: { kind: 'system', id: 'turn' },
  });
  const opened = applyEffectCommands(initial, commands, 'turn-start', 'kinnara-open', id => registry.getStatus(id)).state;
  const offered = opened.units.b.statuses.filter(status => status.statusId.startsWith(`${kinnaraIds.available}:`));
  assert.equal(offered.length, 2);
  assert.equal(new Set(offered.map(status => status.statusId)).size, 2);
  assert.equal(opened.resources.blue.fire, 0);
  const action = executeAction(opened, { actorId: 'b', skillId: kinnaraIds.palace,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, registry, () => .5,
  { resolveStatus: id => registry.getStatus(id) });
  assert.equal(action.state.resources.blue.fire, 0, '五级破令律音免费');
  assert.ok(action.state.units.r.statuses.some(status => status.statusId === kinnaraIds.isolation));
  assert.equal(action.state.units.b.actionGauge, 35);
  assert.ok(action.state.units.b.statuses.some(status => status.statusId === kinnaraIds.shelter));
  const conversion = action.state.units.b.statuses.find(status => status.statusId === kinnaraIds.critConversion);
  assert.equal(conversion.modifiers.find(modifier => modifier.stat === 'critDamage').amount, .2, JSON.stringify(conversion));
  assert.equal(conversion.modifiers.find(modifier => modifier.stat === 'critDamageTaken').amount, -.4, JSON.stringify(conversion));
  const nextTurn = definition.handlers['turn-start'].handle(createBattleContext(action.state, () => .1), {
    eventId: 'kinnara-next-turn', phase: 'turn-start', type: 'turn-started', unitId: 'b', source: { kind: 'system', id: 'turn' },
  });
  const refreshed = applyEffectCommands(action.state, nextTurn, 'turn-start', 'kinnara-next-turn', id => registry.getStatus(id)).state;
  const nextConversion = refreshed.units.b.statuses.find(status => status.statusId === kinnaraIds.critConversion);
  assert.equal(nextConversion.modifiers.find(modifier => modifier.stat === 'critDamage').amount, .2,
    '已转化的暴伤持续保留');
  assert.equal(nextConversion.modifiers.find(modifier => modifier.stat === 'critDamageTaken').amount, -.5,
    '下个自身回合开始重新获得50%暴击额外伤害减免');
});

test('紧那罗商律音五段攻击屏蔽受击御魂，羽律音按驱散数量返火', () => {
  const registry = new ContentRegistry(); registerKinnara(registry);
  registry.registerStatus({ id: 'test.kinnara-debuff', category: 'debuff', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: kinnaraIds.hero, skillLevel: 2,
    skillLevels: { [kinnaraIds.passive]: 2 }, statuses: [
      { instanceId: 'available-mountain', statusId: `${kinnaraIds.available}:${kinnaraIds.mountain}`,
        source: { kind: 'skill', id: kinnaraIds.passive, unitId: 'b' }, stacks: 1, duration: { kind: 'permanent' } },
    ] };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, resist: 0, hp: 1000000 }, hp: 1000000 };
  initial.resources.blue.fire = 2;
  const mountain = executeAction(initial, { actorId: 'b', skillId: kinnaraIds.mountain,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, registry, () => .5,
  { resolveStatus: id => registry.getStatus(id) });
  const mountainHits = mountain.events.filter(event => event.type === 'damage' && event.source.id === kinnaraIds.mountain);
  assert.equal(mountainHits.length, 5);
  assert.ok(mountainHits.every(event => event.suppressTargetSoulTriggers));
  assert.equal(mountain.state.resources.blue.fire, 1);

  let cleanse = state();
  cleanse.units.b = { ...cleanse.units.b, heroId: kinnaraIds.hero, skillLevel: 4,
    skillLevels: { [kinnaraIds.passive]: 4 }, statuses: [
      { instanceId: 'available-feather', statusId: `${kinnaraIds.available}:${kinnaraIds.clearFeather}`,
        source: { kind: 'skill', id: kinnaraIds.passive, unitId: 'b' }, stacks: 1, duration: { kind: 'permanent' } },
    ] };
  const friend = { ...unit('b2', 'blue'), statuses: [{ instanceId: 'bad', statusId: 'test.kinnara-debuff',
    source: { kind: 'skill', id: 'test.bad' }, stacks: 1, duration: { kind: 'permanent' } }] };
  cleanse.units.b2 = friend; cleanse.sides.blue.push('b2'); cleanse.resources.blue.fire = 1;
  const feather = executeAction(cleanse, { actorId: 'b', skillId: kinnaraIds.clearFeather,
    targetIds: ['b', 'b2'], shape: 'all-allies', targetRelation: 'ally' }, registry, () => .5,
  { resolveStatus: id => registry.getStatus(id) });
  assert.equal(feather.state.resources.blue.fire, 2, '扣除1火后，1个有效驱散不超过3个，返还2火');
  assert.equal(feather.state.units.b2.statuses.length, 0);
  assert.equal(feather.state.units.b.actionGauge, 35);
});

test('紧那罗急五级打五段并重放本场已弹奏的角与徵', () => {
  const registry = new ContentRegistry(); registerKinnara(registry);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: kinnaraIds.hero, skillLevel: 5,
    skillLevels: { [kinnaraIds.passive]: 5, [kinnaraIds.ultimate]: 5 }, statuses: [{
      instanceId: 'memory', statusId: kinnaraIds.melodyMemory,
      source: { kind: 'skill', id: kinnaraIds.passive, unitId: 'b' }, stacks: 1, duration: { kind: 'permanent' },
      values: { lastTone: kinnaraIds.warmWind, playedTones: `${kinnaraIds.palaceGlow},${kinnaraIds.warmWind}` },
    }] };
  initial.units.b2 = { ...unit('b2', 'blue'), hp: 5000 }; initial.sides.blue.push('b2');
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, hp: 1000000 }, hp: 1000000 };
  initial.resources.blue.fire = 3;
  const result = executeAction(initial, { actorId: 'b', skillId: kinnaraIds.ultimate,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, registry, () => .5,
  { resolveStatus: id => registry.getStatus(id) });
  assert.equal(result.events.filter(event => event.type === 'damage' && event.source.id === kinnaraIds.ultimate).length, 5);
  assert.equal(result.state.resources.blue.fire, 0);
  assert.equal(result.state.units.b.actionGauge, 10);
  assert.equal(result.state.units.b2.actionGauge, 10);
  assert.ok(result.state.units.b2.hp > 5000);
  assert.equal(effectiveStats(result.state.units.b2).defense, result.state.units.b2.stats.defense * 1.4);
});

test('麓铭大岳丸麓蚀削攻减疗、麓泽抵扣群攻鬼火，三名阵亡后转归骸五段追击', () => {
  const registry = new ContentRegistry(); registerLumingOotakemaru(registry);
  const resolveStatus = id => registry.getStatus(id);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: lumingOotakemaruIds.hero, skillLevel: 5,
    skillLevels: { [lumingOotakemaruIds.basic]: 5, [lumingOotakemaruIds.stance]: 5,
      [lumingOotakemaruIds.ultimate]: 5 },
    stats: { ...initial.units.b.stats, attack: 1000, hp: 10000 }, hp: 6000 };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, defense: 0, resist: 0, hp: 100000 }, hp: 100000 };
  initial.resources.blue.fire = 4;
  const basic = executeAction(initial, { actorId: 'b', skillId: lumingOotakemaruIds.basic,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, registry, () => .5, { resolveStatus });
  const erosion = basic.state.units.r.statuses.find(status => status.statusId === lumingOotakemaruIds.erosion);
  assert.ok(erosion);
  assert.equal(effectiveStats(basic.state.units.r).attack, basic.state.units.r.stats.attack * .85);
  assert.ok(erosion.modifiers.some(modifier => modifier.stat === 'healingTaken' && modifier.amount === -.3));

  let channel = state();
  channel.units.b = { ...initial.units.b, statuses: [{ instanceId: 'soul', statusId: lumingOotakemaruIds.soulRiding,
    source: { kind: 'skill', id: lumingOotakemaruIds.stance, unitId: 'b' }, stacks: 1,
    duration: { kind: 'count', remaining: 2, owner: 'source-turn' } }] };
  channel.units.b2 = unit('b2', 'blue'); channel.sides.blue.push('b2'); channel.resources.blue.fire = 4;
  const stackCommands = registry.getHero(lumingOotakemaruIds.hero).handlers['action-end'].handle(createBattleContext(channel), {
    eventId: 'ally-skill', phase: 'action-end', type: 'action-ended', actionKind: 'skill', skillId: 'test.skill',
    soulTriggersAllowed: true, intent: { actorId: 'b2', skillId: 'test.skill', targetIds: ['r'], shape: 'single', targetRelation: 'enemy' },
    source: { kind: 'skill', id: 'test.skill', unitId: 'b2' },
  });
  channel = applyEffectCommands(channel, stackCommands, 'action-end', 'ally-skill', resolveStatus).state;
  assert.equal(channel.units.b.statuses.find(status => status.statusId === lumingOotakemaruIds.luze).stacks, 1);
  const ultimate = executeAction(channel, { actorId: 'b', skillId: lumingOotakemaruIds.ultimate,
    targetIds: ['r'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .5, { resolveStatus });
  assert.equal(ultimate.state.resources.blue.fire, 1, '一层麓泽使4火群攻只消耗3火');
  assert.ok(!ultimate.state.units.b.statuses.some(status => status.statusId === lumingOotakemaruIds.luze));

  let battle = state();
  battle.units.b = { ...initial.units.b, statuses: [{ instanceId: 'soul', statusId: lumingOotakemaruIds.soulRiding,
    source: { kind: 'skill', id: lumingOotakemaruIds.stance, unitId: 'b' }, stacks: 1,
    duration: { kind: 'count', remaining: 2, owner: 'source-turn' } }] };
  battle.units.r = { ...initial.units.r, hp: 0 };
  battle.units.r2 = { ...unit('r2', 'red'), hp: 0 };
  battle.units.b2 = { ...unit('b2', 'blue'), hp: 0 };
  battle.units.r3 = { ...unit('r3', 'red'), hp: 100000 };
  battle.sides.red.push('r2', 'r3'); battle.sides.blue.push('b2');
  const transition = registry.getHero(lumingOotakemaruIds.hero).handlers['unit-defeated'].handle(
    createBattleContext(battle), { eventId: 'three-deaths', phase: 'unit-defeated', type: 'unit-defeated', unitId: 'r' });
  battle = applyEffectCommands(battle, transition, 'unit-defeated', 'three-deaths', resolveStatus).state;
  assert.ok(battle.units.b.statuses.some(status => status.statusId === lumingOotakemaruIds.revenant));
  assert.ok(!battle.units.b.statuses.some(status => status.statusId === lumingOotakemaruIds.soulRiding));
  const skill = registry.getHero(lumingOotakemaruIds.hero).skills.find(item => item.id === lumingOotakemaruIds.revenantAttack);
  assert.equal(skill.canUse(battle, battle.units.b), true);
  const attack = executeAction(battle, { actorId: 'b', skillId: lumingOotakemaruIds.revenantAttack,
    targetIds: ['r3'], shape: 'single', targetRelation: 'enemy' }, registry, () => .5, { resolveStatus });
  assert.equal(attack.events.filter(event => event.type === 'damage' && event.source.id === lumingOotakemaruIds.revenantAttack).length, 5);
  assert.ok(attack.state.units.b.hp > 6000, '归骸形态攻击吸血');
});

test('麓蚀在目标回合结束转为不可驱散麓压，令其下回合眩晕并减速', () => {
  const registry = new ContentRegistry(); registerLumingOotakemaru(registry);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: lumingOotakemaruIds.hero, skillLevel: 5 };
  initial.units.r = { ...initial.units.r, statuses: [{ instanceId: 'erosion', statusId: lumingOotakemaruIds.erosion,
    source: { kind: 'skill', id: lumingOotakemaruIds.basic, unitId: 'b' }, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
    modifiers: [{ stat: 'attack', operation: 'percent', amount: -.15 }, { stat: 'healingTaken', operation: 'percent', amount: -.3 }] }] };
  const commands = registry.getHero(lumingOotakemaruIds.hero).handlers['turn-end'].handle(createBattleContext(initial), {
    eventId: 'luming-erosion-turn-end', phase: 'turn-end', type: 'turn-ended', unitId: 'r', source: { kind: 'system', id: 'turn' },
  });
  const result = applyEffectCommands(initial, commands, 'turn-end', 'luming-erosion', id => registry.getStatus(id));
  assert.ok(!result.state.units.r.statuses.some(status => status.statusId === lumingOotakemaruIds.erosion));
  assert.ok(result.state.units.r.statuses.some(status => status.statusId === lumingOotakemaruIds.pressure));
  assert.equal(registry.getStatus(lumingOotakemaruIds.pressure).preventsAction, true);
  assert.equal(effectiveStats(result.state.units.r).speed, result.state.units.r.stats.speed * .7);
  assert.equal(registry.getStatus(lumingOotakemaruIds.pressure).dispellable, false);
});

test('麓铭大岳丸驭魂形态的单体减伤和非召唤阵亡回血按等级触发', () => {
  const registry = new ContentRegistry(); registerLumingOotakemaru(registry);
  const definition = registry.getHero(lumingOotakemaruIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: lumingOotakemaruIds.hero, skillLevel: 3,
    skillLevels: { [lumingOotakemaruIds.stance]: 3 }, hp: 5000,
    statuses: [{ instanceId: 'soul', statusId: lumingOotakemaruIds.soulRiding,
      source: { kind: 'skill', id: lumingOotakemaruIds.stance, unitId: 'b' }, stacks: 1,
      duration: { kind: 'count', remaining: 2, owner: 'source-turn' } }] };
  assert.equal(definition.interceptIncomingDamage(initial, initial.units.r, initial.units.b, 1000, 'normal',
    { attackShape: 'single' }).amount, 500);
  initial.units.r.hp = 0;
  const commands = definition.handlers['unit-defeated'].handle(createBattleContext(initial), {
    eventId: 'luming-nonsummon-death', phase: 'unit-defeated', type: 'unit-defeated', unitId: 'r', source: { kind: 'skill', id: 'test' },
  });
  const healed = applyEffectCommands(initial, commands, 'unit-defeated', 'luming-heal', id => registry.getStatus(id)).state;
  assert.equal(healed.units.b.hp, 8000);
  initial.units.r = { ...initial.units.r, unitKind: 'summon', hp: 0 };
  const summonDeath = definition.handlers['unit-defeated'].handle(createBattleContext(initial), {
    eventId: 'luming-summon-death', phase: 'unit-defeated', type: 'unit-defeated', unitId: 'r', source: { kind: 'skill', id: 'test' },
  });
  assert.deepEqual(summonDeath, [], '召唤物阵亡不回血、不计入形态转换');
});

test('紧那罗律之祝福只降低暴击额外伤害并把减伤转为暴伤', () => {
  const registry = new ContentRegistry(); registerKinnara(registry);
  const status = registry.getStatus(kinnaraIds.critConversion);
  assert.equal(status.category, 'buff');
  const target = { ...unit('b', 'blue'), statuses: [{ instanceId: 'crit-conversion', statusId: kinnaraIds.critConversion,
    source: { kind: 'skill', id: kinnaraIds.passive, unitId: 'b' }, stacks: 1, duration: { kind: 'permanent' },
    modifiers: [{ stat: 'critDamageTaken', operation: 'percent', amount: -.5 }] }] };
  assert.equal(applyCriticalDamageTakenModifiers(200, 100, target), 150,
    '50%减伤作用于暴击额外部分，保留100点基础伤害');
});

test('夜溟彼岸花赤色凋零分配六枚溟种，沉眠回收转溟花并驱动火照之路', () => {
  const registry = new ContentRegistry(); registerNightBloom(registry);
  const resolveStatus = id => registry.getStatus(id);
  const category = id => registry.getStatus(id)?.category;
  const dispellable = id => registry.getStatus(id)?.dispellable ?? false;
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: nightBloomIds.hero, skillLevel: 5,
    skillLevels: { [nightBloomIds.basic]: 5, [nightBloomIds.decay]: 5, [nightBloomIds.ultimate]: 5 },
    stats: { ...initial.units.b.stats, attack: 1000, hp: 10000 }, hp: 8000 };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, hp: 100000, defense: 0 }, hp: 100000 };
  initial.units.r2 = { ...unit('r2', 'red'), stats: { ...unit('r2', 'red').stats, hp: 100000, defense: 0 }, hp: 100000 };
  initial.sides.red.push('r2');
  const decay = executeAction(initial, { actorId: 'b', skillId: nightBloomIds.decay,
    targetIds: ['r', 'r2'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .2, { resolveStatus });
  assert.equal(decay.state.units.b.hp, 4800, '赤色凋零失去施放者当前生命的40%');
  assert.ok(decay.state.units.b.statuses.some(status => status.statusId === nightBloomIds.slumber));
  assert.equal(decay.state.units.r.statuses.find(status => status.statusId === nightBloomIds.seed).stacks, 3);
  assert.equal(decay.state.units.r2.statuses.find(status => status.statusId === nightBloomIds.seed).stacks, 3);

  const woke = registry.getHero(nightBloomIds.hero).handlers['turn-start'].handle(
    createBattleContext(decay.state, () => .5, category, dispellable),
    { eventId: 'night-bloom-wake', phase: 'turn-start', type: 'turn-started', unitId: 'b', source: { kind: 'system', id: 'turn' } });
  const recovered = applyEffectCommands(decay.state, woke, 'turn-start', 'night-bloom-wake', resolveStatus).state;
  assert.equal(recovered.units.b.statuses.find(status => status.statusId === nightBloomIds.flower).stacks, 4);
  assert.equal(recovered.units.b.hp, 8800, '回收4层溟花，每层治疗生命上限10%');
  assert.ok(!recovered.units.r.statuses.some(status => status.statusId === nightBloomIds.seed));
  assert.equal(recovered.units.b.statuses.find(status => status.statusId === nightBloomIds.attackGrowth).stacks, 1);

  const fireRoad = executeAction(recovered, { actorId: 'b', skillId: nightBloomIds.fireRoad,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, registry, () => .5, { resolveStatus });
  assert.equal(fireRoad.events.filter(event => event.type === 'damage' && event.source.id === nightBloomIds.fireRoad).length, 10,
    '4层溟花产生主目标4次、递增的额外随机目标6次');
  assert.ok(!fireRoad.state.units.b.statuses.some(status => status.statusId === nightBloomIds.flower));
  assert.equal(fireRoad.state.units.b.actionGauge, 25);
});

test('千姬召戟后的潮声、受击回复、控制免疫和敌方施术推条按客户端触发', () => {
  const registry = new ContentRegistry(); registerChihime(registry);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: chihimeIds.hero, skillLevel: 5,
    skillLevels: { [chihimeIds.basic]: 5, [chihimeIds.dream]: 5, [chihimeIds.summon]: 5, [chihimeIds.release]: 5 },
    stats: { ...initial.units.b.stats, attack: 2000 }, hp: 6000 };
  initial.resources.blue.fire = 2;
  const summoned = executeAction(initial, { actorId: 'b', skillId: chihimeIds.summon,
    targetIds: ['b'], shape: 'self', targetRelation: 'ally' }, registry, () => .99,
    { resolveStatus: id => registry.getStatus(id) });
  const chihime = summoned.state.units.b;
  const skills = registry.getHero(chihimeIds.hero).skills;
  assert.equal(skills.find(skill => skill.id === chihimeIds.summon).canUse(initial, initial.units.b), true);
  assert.equal(skills.find(skill => skill.id === chihimeIds.release).canUse(initial, initial.units.b), false);
  const halberd = summoned.state.sides.blue.map(id => summoned.state.units[id])
    .find(unit => unit?.unitKind === 'summon' && unit.summonedByUnitId === 'b');
  assert.ok(halberd);
  assert.equal(halberd.statuses.find(status => status.statusId === chihimeIds.tideSound)?.stacks, 3,
    '五级召戟立即获得3层潮声');
  assert.equal(skills.find(skill => skill.id === chihimeIds.summon).canUse(summoned.state, chihime), false,
    '海原贝戟在场时不能重复召唤第二把');
  assert.equal(skills.find(skill => skill.id === chihimeIds.release).canUse(summoned.state, chihime), true,
    '持戟时解锁永生之汐');
  assert.equal(registry.getStatus(chihimeIds.halberdProtection).controlProtection, 'immune');
  assert.equal(registry.getStatus(chihimeIds.halberdProtection).statusImmunity, 'debuffs',
    '海原贝戟免疫控制和减益');

  const definition = registry.getHero(chihimeIds.hero);
  const hit = definition.handlers.hit.handle(createBattleContext(summoned.state), {
    eventId: 'chihime-hit', phase: 'hit', type: 'damage', source, targetId: 'b', hpLost: 1000, amount: 1000,
  });
  assert.equal(hit[0].targetId, 'b');
  assert.equal(hit[0].amount, 500, '千姬受到伤害時海原贝戟回复该次实际生命损失的一半');
  const ally = { ...unit('b2', 'blue'), heroId: 20 };
  const withAlly = { ...summoned.state, units: { ...summoned.state.units, b2: ally }, sides: {
    ...summoned.state.sides, blue: [...summoned.state.sides.blue, 'b2'] } };
  const allyHealing = definition.handlers.hit.handle(createBattleContext(withAlly), {
    eventId: 'chihime-ally-hit', phase: 'hit', type: 'damage', source, targetId: 'b2', hpLost: 1000, amount: 1000,
  });
  assert.equal(allyHealing.length, 1);
  assert.equal(allyHealing[0].targetId, 'b2');
  assert.equal(allyHealing[0].amount, 300, '海原贝戟为其他友方恢复实际受伤生命的30%');

  const enemySkill = { eventId: 'chihime-enemy-skill', phase: 'action-end', type: 'action-ended', actionKind: 'skill',
    source: { kind: 'skill', id: 'enemy.skill', unitId: 'r' }, skillId: 'enemy.skill', soulTriggersAllowed: true };
  const gauge = definition.handlers['action-end'].handle(createBattleContext(summoned.state), enemySkill);
  assert.ok(gauge.some(command => command.type === 'change-action-gauge' && command.targetId === 'b' && command.amount === 30));
  const afterGauge = applyEffectCommands(summoned.state, gauge, 'action-end', enemySkill.eventId,
    id => registry.getStatus(id)).state;
  assert.deepEqual(definition.handlers['action-end'].handle(createBattleContext(afterGauge), {
    ...enemySkill, eventId: 'chihime-enemy-skill-again',
  }), [], '持戟期间敌方施术的30%推条每场只触发一次');
  const sealed = { ...summoned.state, units: { ...summoned.state.units, b: { ...chihime, statuses: [
    ...chihime.statuses, { instanceId: 'seal', statusId: passiveSuppressionStatusId,
      source: { kind: 'skill', id: 'test.seal' }, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } },
  ] } } };
  assert.deepEqual(definition.handlers['action-end'].handle(createBattleContext(sealed), enemySkill), [],
    '被动封印期间不触发敌方施术推条');
  assert.deepEqual(definition.handlers.hit.handle(createBattleContext(sealed), {
    eventId: 'chihime-hit-sealed', phase: 'hit', type: 'damage', source, targetId: 'b', hpLost: 1000, amount: 1000,
  }), [], '被动封印期间海原贝戟不触发受击恢复');
  const enemyTurnEnd = { eventId: 'chihime-enemy-turn-end', phase: 'turn-end', type: 'turn-ended', unitId: 'r',
    source: { kind: 'unit', id: 'r', unitId: 'r' } };
  assert.ok(definition.handlers['turn-end'].handle(createBattleContext(summoned.state), enemyTurnEnd)
    .some(command => command.type === 'change-action-gauge' && command.targetId === 'b' && command.amount === 10),
  '每个敌方非召唤单位回合结束，千姬获得10%行动条');
  const enemySummonTurn = { ...enemyTurnEnd, eventId: 'chihime-enemy-summon-turn-end' };
  const withEnemySummon = { ...summoned.state, units: { ...summoned.state.units,
    r: { ...summoned.state.units.r, unitKind: 'summon' } } };
  assert.ok(!definition.handlers['turn-end'].handle(createBattleContext(withEnemySummon), enemySummonTurn)
    .some(command => command.type === 'change-action-gauge' && command.targetId === 'b'),
  '敌方召唤物回合结束不推条');
});

test('千姬持戟汐梦在敌方回合末扣火，五级仅在实际扣至0时冻结非怪物', () => {
  const registry = new ContentRegistry(); registerChihime(registry);
  const definition = registry.getHero(chihimeIds.hero);
  const makeTurn = (fire, kind = 'shikigami') => {
    const base = state();
    const owner = { ...base.units.b, heroId: chihimeIds.hero, skillLevel: 5,
      skillLevels: { [chihimeIds.dream]: 5, [chihimeIds.summon]: 5 },
      statuses: [{ instanceId: 'halberd-marker', statusId: chihimeIds.halberd,
        source: { kind: 'skill', id: chihimeIds.summon, unitId: 'b' }, stacks: 1, duration: { kind: 'permanent' },
        values: { summonId: 'h' } }] };
    const halberd = { ...unit('h', 'blue'), heroId: chihimeIds.hero, unitKind: 'summon', summonedByUnitId: 'b' };
    const target = { ...base.units.r, unitKind: kind, stats: { ...base.units.r.stats, resist: 0 }, statuses: [
      { instanceId: 'tide-dream', statusId: chihimeIds.tideDream,
        source: { kind: 'skill', id: chihimeIds.dream, unitId: 'b' }, stacks: 1,
        duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { ownerUnitId: 'b' } },
    ] };
    return { ...base, units: { b: owner, h: halberd, r: target }, sides: { blue: ['b', 'h'], red: ['r'] },
      resources: { ...base.resources, red: { fire } } };
  };
  const endEvent = { eventId: 'chihime-dream-turn-end', phase: 'turn-end', type: 'turn-ended', unitId: 'r',
    source: { kind: 'unit', id: 'r', unitId: 'r' } };
  const drained = makeTurn(3);
  const drainedCommands = definition.handlers['turn-end'].handle(createBattleContext(drained, () => 0,
    id => registry.getStatus(id)?.category), endEvent);
  assert.ok(drainedCommands.some(command => command.type === 'change-resource' && command.side === 'red' && command.amount === -3));
  const freeze = drainedCommands.find(command => command.type === 'apply-control' && command.instance.statusId === chihimeIds.deepFreeze);
  assert.ok(freeze);
  assert.deepEqual(freeze.instance.modifiers, [{ stat: 'speed', operation: 'flat', amount: -20 }]);

  const empty = makeTurn(0);
  const emptyCommands = definition.handlers['turn-end'].handle(createBattleContext(empty, () => 0,
    id => registry.getStatus(id)?.category), endEvent);
  assert.ok(!emptyCommands.some(command => command.type === 'apply-control'), '目标原本0火时没有“扣至0”事件');

  const monster = makeTurn(3, 'monster');
  const monsterCommands = definition.handlers['turn-end'].handle(createBattleContext(monster, () => 0,
    id => registry.getStatus(id)?.category), endEvent);
  assert.ok(!monsterCommands.some(command => command.type === 'apply-control'), '深度冰冻不作用于怪物');
});

test('千姬每点耗火按等级叠潮声，七层返火并叠加最多五层全队永久增伤', () => {
  const registry = new ContentRegistry(); registerChihime(registry);
  const definition = registry.getHero(chihimeIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: chihimeIds.hero, skillLevel: 3,
    skillLevels: { [chihimeIds.summon]: 3 }, statuses: [{ instanceId: 'halberd-marker', statusId: chihimeIds.halberd,
      source: { kind: 'skill', id: chihimeIds.summon, unitId: 'b' }, stacks: 1,
      duration: { kind: 'permanent' }, values: { summonId: 'h' } }] };
  initial.units.h = { ...unit('h', 'blue'), heroId: chihimeIds.hero, unitKind: 'summon', summonedByUnitId: 'b',
    statuses: [{ instanceId: 'tide-sound', statusId: chihimeIds.tideSound,
      source: { kind: 'skill', id: chihimeIds.summon, unitId: 'b' }, stacks: 6, duration: { kind: 'permanent' } }] };
  initial.units.b2 = unit('b2', 'blue'); initial.sides.blue.push('h', 'b2');
  initial.resources.blue.fire = 2;
  const payment = { eventId: 'chihime-fire-spent', phase: 'resource-payment', type: 'resource-changed', side: 'blue',
    resourceId: 'fire', before: 3, after: 2, amount: -1,
    source: { kind: 'skill', id: 'test.ally-skill', unitId: 'b2' } };
  const commands = definition.handlers['resource-payment'].handle(createBattleContext(initial, () => .99), payment);
  assert.ok(commands.some(command => command.type === 'change-resource' && command.side === 'blue' && command.amount === 3));
  const gained = applyEffectCommands(initial, commands, 'resource-payment', payment.eventId,
    id => registry.getStatus(id)).state;
  assert.equal(gained.units.h.statuses.find(status => status.statusId === chihimeIds.tideSound).stacks, 7);
  assert.equal(gained.units.b.statuses.find(status => status.statusId === chihimeIds.teamTideBonus).stacks, 1);
  assert.equal(gained.resources.blue.fire, 5, '七层潮声额外返还3火');
  assert.ok(Math.abs(definition.modifyOutgoingDamage(gained.units.b, gained.units.r, 100, 'normal', gained) - 115) < 1e-9);
  assert.equal(registry.getStatus(chihimeIds.teamTideBonus).maxStacks, 5);

  const sealed = { ...initial, units: { ...initial.units, b: { ...initial.units.b, statuses: [
    ...initial.units.b.statuses, { instanceId: 'passive-seal', statusId: passiveSuppressionStatusId,
      source: { kind: 'skill', id: 'test.seal' }, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } },
  ] } } };
  assert.deepEqual(definition.handlers['resource-payment'].handle(createBattleContext(sealed, () => .99), payment), [],
    '被动封印期间消耗鬼火不叠加潮声');
});

test('千姬持戟才能施放永生之汐，按悲歌层数增伤并消耗2火收回海原贝戟', () => {
  const registry = new ContentRegistry(); registerChihime(registry);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: chihimeIds.hero, skillLevel: 5,
    skillLevels: { [chihimeIds.dream]: 5, [chihimeIds.summon]: 5, [chihimeIds.release]: 5 },
    stats: { ...initial.units.b.stats, attack: 1000 },
    statuses: [
      { instanceId: 'halberd-marker', statusId: chihimeIds.halberd,
        source: { kind: 'skill', id: chihimeIds.summon, unitId: 'b' }, stacks: 1,
        duration: { kind: 'permanent' }, values: { summonId: 'h' } },
      { instanceId: 'lament', statusId: chihimeIds.lament,
        source: { kind: 'skill', id: chihimeIds.release, unitId: 'b' }, stacks: 3, duration: { kind: 'permanent' } },
    ] };
  initial.units.h = { ...unit('h', 'blue'), heroId: chihimeIds.hero, unitKind: 'summon', summonedByUnitId: 'b', hp: 1000 };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, hp: 100000, attack: 0 }, hp: 100000 };
  initial.sides.blue.push('h'); initial.resources.blue.fire = 2;
  const definition = registry.getHero(chihimeIds.hero);
  const dispatcher = new EventDispatcher();
  for (const [phase, rule] of Object.entries(definition.handlers ?? {}))
    dispatcher.register({ id: `hero:${chihimeIds.hero}:${phase}`, phase, priority: rule.priority, handle: rule.handle });
  const result = executeAction(initial, { actorId: 'b', skillId: chihimeIds.release,
    targetIds: ['r'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .5,
    { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(result.accepted, true);
  assert.equal(result.state.resources.blue.fire, 0, '永生之汐消耗2火');
  assert.ok(result.events.some(event => event.type === 'damage' && event.source.id === chihimeIds.release && event.amount > 4000),
    '3层悲歌将永生之汐倍率提升至420%');
  assert.equal(result.state.units.h.hp, 0, '施放后击败海原贝戟');
  assert.ok(!result.state.units.b.statuses.some(status => status.statusId === chihimeIds.halberd));
  assert.ok(result.state.units.b.statuses.some(status => status.statusId === chihimeIds.halberdImmunity),
    '收戟后恢复持戟状态的控制免疫');
  assert.ok(!registry.getHero(chihimeIds.hero).skills.find(skill => skill.id === chihimeIds.release)
    .canUse(result.state, result.state.units.b));
});

test('食灵备餐按等级结算并在三个全局单位回合后发动飨食', () => {
  const registry = new ContentRegistry(); registerFoodSpirit(registry);
  const resolveStatus = id => registry.getStatus(id);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: foodSpiritIds.hero, skillLevel: 5,
    skillLevels: { [foodSpiritIds.basic]: 5, [foodSpiritIds.passive]: 5, [foodSpiritIds.meal]: 5 },
    stats: { ...initial.units.b.stats, attack: 1000 }, hp: 10000 };
  initial.units.b2 = { ...unit('b2', 'blue'), stats: { ...unit('b2', 'blue').stats, hp: 10000, critDamage: 2 }, hp: 5000 };
  initial.units.h = { ...unit('h', 'blue'), unitKind: 'summon' };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, hp: 100000, defense: 0 }, hp: 100000 };
  initial.units.r2 = { ...unit('r2', 'red'), stats: { ...unit('r2', 'red').stats, hp: 100000, defense: 0 }, hp: 100000 };
  initial.sides.blue.push('b2', 'h'); initial.sides.red.push('r2'); initial.resources.blue.fire = 2;
  const definition = registry.getHero(foodSpiritIds.hero);
  const meal = definition.skills.find(skill => skill.id === foodSpiritIds.meal);
  assert.equal(meal.resolveResourceCost(initial, initial.units.b).amount, 2, '备餐二级后消耗2火');
  assert.equal(meal.canUse(initial, initial.units.b), true);
  assert.deepEqual(meal.execute(createBattleContext(initial), { actorId: 'b', skillId: foodSpiritIds.meal,
    targetIds: ['b'], shape: 'single', targetRelation: 'ally' }), [], '不能给自己备餐');
  assert.deepEqual(meal.execute(createBattleContext(initial), { actorId: 'b', skillId: foodSpiritIds.meal,
    targetIds: ['h'], shape: 'single', targetRelation: 'ally' }), [], '不能给召唤物备餐');
  const mealCommands = meal.execute(createBattleContext(initial), { actorId: 'b', skillId: foodSpiritIds.meal,
    targetIds: ['b2'], shape: 'single', targetRelation: 'ally' });
  const served = applyEffectCommands(initial, mealCommands, 'action-resolution', 'food-meal', resolveStatus).state;
  assert.equal(served.units.b.hp, 8500, '消耗施放者当前生命的15%');
  assert.equal(effectiveDamageMultiplier(served.units.b2), .7, '用餐期间造成伤害降低30%');
  assert.equal(effectiveDamageTakenMultiplier(served.units.b2), .6, '用餐期间受到伤害降低40%');

  const endEvent = (unitId, eventId) => ({ eventId, phase: 'turn-end', type: 'turn-ended', unitId,
    source: { kind: 'unit', id: unitId } });
  const ate = definition.handlers['turn-end'].handle(createBattleContext(served), endEvent('b2', 'food-eat'));
  assert.ok(ate.some(command => command.type === 'heal' && command.targetId === 'b2' && command.amount === 780),
    '五级备餐为全体友方治疗食灵攻击的78%');
  let fed = applyEffectCommands(served, ate, 'turn-end', 'food-eat', resolveStatus).state;
  assert.ok(fed.units.b2.statuses.some(status => status.statusId === foodSpiritIds.protection), '吃下料理后获得单次控制保护');
  assert.equal(fed.units.b2.statuses.find(status => status.statusId === foodSpiritIds.satiated).values.remainingTurns, 3);

  for (const [index, expectedRemaining] of [[1, 2], [2, 1]]) {
    const tick = definition.handlers['turn-end'].handle(createBattleContext(fed, () => .5), endEvent('r', `food-tick-${index}`));
    fed = applyEffectCommands(fed, tick, 'turn-end', `food-tick-${index}`, resolveStatus).state;
    assert.equal(fed.units.b2.statuses.find(status => status.statusId === foodSpiritIds.satiated).values.remainingTurns, expectedRemaining);
  }
  const feast = definition.handlers['turn-end'].handle(createBattleContext(fed, () => .5), endEvent('r', 'food-feast'));
  assert.equal(feast.filter(command => command.type === 'deal-damage' && command.damageKind === 'true').length, 2,
    '五级飨食按敌人数对每个敌方追加真实伤害');
  assert.ok(feast.some(command => command.type === 'deal-damage' && command.targetId === 'r' && command.amount === 1716),
    '食灵已因友方饱食获得30%攻击成长后再计算真实伤害');
  fed = applyEffectCommands(fed, feast, 'turn-end', 'food-feast', resolveStatus).state;
  assert.ok(!fed.units.b2.statuses.some(status => status.statusId === foodSpiritIds.satiated));
  assert.equal(fed.units.b.statuses.find(status => status.statusId === foodSpiritIds.attackGrowth).stacks, 1,
    '友方进入饱食时食灵获得一层攻击成长');
});

test('食灵五级热浪只在最高暴伤友方选择单体敌方目标时确定协战', () => {
  const registry = new ContentRegistry(); registerFoodSpirit(registry);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: foodSpiritIds.hero, skillLevel: 5,
    skillLevels: { [foodSpiritIds.passive]: 5, [foodSpiritIds.basic]: 5 } };
  initial.units.b2 = { ...unit('b2', 'blue'), stats: { ...unit('b2', 'blue').stats, critDamage: 2 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, resist: 0 } };
  initial.sides.blue.push('b2');
  const handler = registry.getHero(foodSpiritIds.hero).handlers['action-end'].handle;
  const event = { eventId: 'food-ally-action', phase: 'action-end', type: 'action-ended', skillId: 'ally-skill',
    actionKind: 'skill', soulTriggersAllowed: true,
    source: { kind: 'skill', id: 'ally-skill', unitId: 'b2' },
    intent: { actorId: 'b2', skillId: 'ally-skill', targetIds: ['r'], shape: 'single', targetRelation: 'enemy' } };
  const commands = handler(createBattleContext(initial, () => 0), event);
  assert.equal(commands.filter(command => command.type === 'schedule-action').length, 1);
  assert.equal(commands.find(command => command.type === 'schedule-action').intent.actorId, 'b');
  assert.ok(commands.some(command => command.type === 'apply-control' && command.instance.statusId === foodSpiritIds.feastWound
    || command.type === 'add-status' && command.instance.statusId === foodSpiritIds.feastWound),
  '五级协战前给目标附加两回合20%易伤');
  assert.equal(handler(createBattleContext(initial, () => 0), { ...event,
    intent: { ...event.intent, shape: 'all-enemies' } }), undefined, '群攻不触发该单体协战规则');
});

test('食灵全队回合外增伤按动作调度类型生效且不会泄漏到后续行动', () => {
  const registry = new ContentRegistry(); registerFoodSpirit(registry);
  registry.registerHero({ id: 1, skills: [createBasicAttackSkill('food.test-basic', [1])], mechanicsCoverage: 'verified' });
  const definition = registry.getHero(foodSpiritIds.hero);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: foodSpiritIds.hero, skillLevel: 5,
    skillLevels: { [foodSpiritIds.passive]: 5 } };
  initial.units.b2 = { ...unit('b2', 'blue'), stats: { ...unit('b2', 'blue').stats, attack: 1000 } };
  initial.sides.blue.push('b2');
  const intent = { actorId: 'b2', skillId: 'food.test-basic', targetIds: ['r'], shape: 'single', targetRelation: 'enemy' };
  const modifyDamage = (attacker, target, amount, kind, battleState) => definition.modifyOutgoingDamage(attacker, target,
    amount, kind, battleState);
  const normal = executeAction(initial, intent, registry, () => .5, { modifyDamage });
  const assist = executeAction(initial, intent, registry, () => .5, { modifyDamage, scheduling: 'assist' });
  const normalDamage = normal.events.find(event => event.type === 'damage').amount;
  const assistDamage = assist.events.find(event => event.type === 'damage').amount;
  assert.equal(assistDamage, normalDamage * 1.5, '五级被动为友方协战伤害增加50%');
  assert.equal(assist.state.activeActionScheduling, undefined, '协战结束后调度标记必须清除');
  const extraTurn = executeAction(initial, intent, registry, () => .5, { modifyDamage, scheduling: 'extra-turn' });
  assert.equal(extraTurn.events.find(event => event.type === 'damage').amount, normalDamage,
    '额外回合仍属于行动回合，不计入回合外增伤');
});

test('灶门炭治郎按技能等级和目标血线切换水面斩击、干天的慈雨与雫波纹突', () => {
  const registry = new ContentRegistry(); registerTanjiro(registry);
  const makeState = (rank, hp) => {
    const initial = state();
    initial.units.b = { ...initial.units.b, heroId: tanjiroIds.hero, skillLevel: rank,
      skillLevels: { [tanjiroIds.basic]: rank }, stats: { ...initial.units.b.stats, attack: 1000 } };
    initial.units.r = { ...initial.units.r, hp, stats: { ...initial.units.r.stats, hp: 10000, defense: 0 } };
    return initial;
  };
  const useBasic = (rank, hp) => executeAction(makeState(rank, hp), { actorId: 'b', skillId: tanjiroIds.basic,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, registry, () => .5,
  { resolveStatus: id => registry.getStatus(id) });
  const low = useBasic(4, 2000);
  assert.ok(low.events.some(event => event.type === 'damage' && event.source.id === tanjiroIds.fifthForm
    && Math.abs(event.amount - 1400) < 1e-6), '四级起目标低于30%时用伍之型并增伤40%');
  const high = useBasic(5, 8000);
  assert.ok(high.events.some(event => event.type === 'damage' && event.source.id === tanjiroIds.seventhForm
    && Math.abs(event.amount - 1400) < 1e-6), '五级目标高于70%时用柒之型并增伤40%');
  const locked = useBasic(3, 2000);
  assert.ok(locked.events.some(event => event.type === 'damage' && event.source.id === tanjiroIds.basic
    && Math.abs(event.amount - 1000) < 1e-6), '未解锁伍之型时仍用普攻');
});

test('灶门炭治郎水车随已损生命提高触发率、减伤70%并反击叠全集中', () => {
  const registry = new ContentRegistry(); registerTanjiro(registry);
  const definition = registry.getHero(tanjiroIds.hero);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: tanjiroIds.hero, skillLevel: 3,
    skillLevels: { [tanjiroIds.basic]: 3 }, hp: 8000, stats: { ...initial.units.b.stats, attack: 1000, hp: 10000 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, hp: 10000, defense: 0 } };
  const interception = definition.interceptIncomingDamage(initial, initial.units.r, initial.units.b, 1000, 'normal', {
    attackId: 1, hitIndex: 0, actionKind: 'skill', battle: createBattleContext(initial, () => .49),
    isUnitUnableToAct: () => false, targetIds: ['b'], attackShape: 'single',
  });
  assert.ok(interception);
  assert.equal(interception.amount, 300, '生命下降20%后触发率提高至50%，水车降低70%本次伤害');
  assert.ok(interception.effects.some(command => command.type === 'deal-damage' && command.source.id === tanjiroIds.waterwheel
    && command.targetId === 'r'));
  const applied = applyEffectCommands(initial, interception.effects, 'hit', 'tanjiro-waterwheel', id => registry.getStatus(id));
  assert.equal(applied.state.units.b.statuses.find(status => status.statusId === tanjiroIds.concentration)?.stacks, 1);

  const controlled = definition.interceptIncomingDamage(initial, initial.units.r, initial.units.b, 1000, 'normal', {
    attackId: 2, hitIndex: 0, actionKind: 'skill', battle: createBattleContext(initial, () => 0),
    isUnitUnableToAct: () => true, targetIds: ['b'], attackShape: 'single',
  });
  assert.equal(controlled, undefined, '无法动作时水车不触发');
});

test('灶门炭治郎十型耗3火、五段末击随全集中增伤，9层解锁一次火之神神乐', () => {
  const registry = new ContentRegistry(); registerTanjiro(registry);
  const definition = registry.getHero(tanjiroIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: tanjiroIds.hero, skillLevel: 5,
    skillLevels: { [tanjiroIds.forms]: 5, [tanjiroIds.tenthForm]: 5 },
    stats: { ...initial.units.b.stats, attack: 1000 },
    statuses: [{ instanceId: 'concentration', statusId: tanjiroIds.concentration,
      source: { kind: 'skill', id: tanjiroIds.waterwheel, unitId: 'b' }, stacks: 7, duration: { kind: 'permanent' } }] };
  initial.units.r = { ...initial.units.r, hp: 50000, stats: { ...initial.units.r.stats, hp: 50000, defense: 0 } };
  initial.resources.blue.fire = 3;
  assert.equal(definition.skills.find(skill => skill.id === tanjiroIds.hinokami).canUse(initial, initial.units.b), false);
  const river = executeAction(initial, { actorId: 'b', skillId: tanjiroIds.tenthForm,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, registry, () => .5,
  { resolveStatus: id => registry.getStatus(id) });
  const hits = river.events.filter(event => event.type === 'damage' && event.source.id === tanjiroIds.tenthForm);
  assert.equal(hits.length, 5);
  assert.equal(river.state.resources.blue.fire, 0);
  assert.ok(Math.abs(hits[4].amount - 3300) < 1e-6, '7层全集中令五级末段120%提高至330%');
  assert.equal(river.state.units.b.statuses.find(status => status.statusId === tanjiroIds.concentration)?.stacks, 9);
  assert.equal(definition.skills.find(skill => skill.id === tanjiroIds.hinokami).canUse(river.state, river.state.units.b), true);

  const ultimate = executeAction(river.state, { actorId: 'b', skillId: tanjiroIds.hinokami,
    targetIds: ['r'], shape: 'single', targetRelation: 'enemy' }, registry, () => .5,
  { resolveStatus: id => registry.getStatus(id) });
  assert.equal(ultimate.accepted, true);
  assert.equal(ultimate.state.units.r.hp, 31500, '十型先造成五段伤害，再扣除最多攻击1000%的生命');
  assert.ok(ultimate.state.units.b.statuses.some(status => status.statusId === tanjiroIds.hinokamiUsed));
  assert.equal(definition.skills.find(skill => skill.id === tanjiroIds.hinokami).canUse(ultimate.state, ultimate.state.units.b), false,
    '火之神神乐每场战斗仅能使用一次');
});

test('灶门炭治郎被控时解控并换得额外回合，五级对每个非召唤单位回合末推3%行动条', () => {
  const registry = new ContentRegistry(); registerTanjiro(registry);
  const definition = registry.getHero(tanjiroIds.hero);
  registry.registerStatus({ id: 'test.tanjiro-control', category: 'control', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: tanjiroIds.hero, skillLevel: 5,
    skillLevels: { [tanjiroIds.forms]: 5 }, statuses: [{ instanceId: 'stun', statusId: 'test.tanjiro-control',
      source: { kind: 'skill', id: 'test.stun', unitId: 'r' }, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { controlType: '眩晕' } }] };
  const start = { eventId: 'tanjiro-turn-start', phase: 'turn-start', type: 'turn-started', unitId: 'b',
    source: { kind: 'unit', id: String(tanjiroIds.hero), unitId: 'b' } };
  const escape = definition.handlers['turn-start'].handle(createBattleContext(initial, () => .5,
    id => registry.getStatus(id)?.category), start);
  assert.ok(escape.some(command => command.type === 'remove-status-instances' && command.instanceIds.includes('stun')));
  assert.ok(escape.some(command => command.type === 'schedule-turn' && command.scheduling === 'extra-turn'));
  let afterStart = applyEffectCommands(initial, escape, 'turn-start', start.eventId, id => registry.getStatus(id)).state;
  assert.equal(definition.policy(createBattleContext(afterStart), 'b'), undefined, '普通回合让位给解控后获得的新回合');
  const end = { eventId: 'tanjiro-turn-end', phase: 'turn-end', type: 'turn-ended', unitId: 'b',
    source: { kind: 'unit', id: String(tanjiroIds.hero), unitId: 'b' } };
  afterStart = applyEffectCommands(afterStart, definition.handlers['turn-end'].handle(createBattleContext(afterStart), end),
    'turn-end', end.eventId, id => registry.getStatus(id)).state;
  assert.ok(!afterStart.units.b.statuses.some(status => status.statusId === tanjiroIds.controlExtraTurn));
  const gauge = definition.handlers['turn-end'].handle(createBattleContext(initial), { ...end, unitId: 'r' });
  assert.ok(gauge.some(command => command.type === 'change-action-gauge' && command.targetId === 'b' && command.amount === 3));
});

test('灶门祢豆子普通腿踢和鬼化拳打腿踢按等级攻击并额外伤害护盾', () => {
  const registry = new ContentRegistry(); registerNezuko(registry);
  const definition = registry.getHero(nezukoIds.hero);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: nezukoIds.hero, skillLevel: 5,
    skillLevels: { [nezukoIds.basic]: 5 }, stats: { ...initial.units.b.stats, attack: 1000 } };
  initial.units.r = { ...initial.units.r, shield: 3000 };
  const normal = executeAction(initial, { actorId: 'b', skillId: nezukoIds.basic, targetIds: ['r'], shape: 'single',
    targetRelation: 'enemy' }, registry, () => .5, { resolveStatus: id => registry.getStatus(id) });
  assert.equal(normal.accepted, true);
  assert.equal(normal.events.filter(event => event.type === 'damage' && event.source.id === nezukoIds.basic).length, 1);
  assert.equal(normal.state.units.r.shield, 1000, '1000伤害对护盾额外造成100%伤害');

  initial = { ...initial, resources: { ...initial.resources, blue: { ...initial.resources.blue, fire: 3 } } };
  const form = executeAction(initial, { actorId: 'b', skillId: nezukoIds.demonForm, targetIds: ['b'], shape: 'single',
    targetRelation: 'ally' }, registry, () => .5, { resolveStatus: id => registry.getStatus(id) });
  assert.equal(form.accepted, true);
  assert.equal(form.state.resources.blue.fire, 0);
  const transformed = form.state;
  assert.equal(effectiveStats(transformed.units.b).critDamage, 2.5);
  assert.ok(transformed.units.b.statuses.some(status => status.modifiers?.some(modifier => modifier.stat === 'critResist' && modifier.amount === 1)));
  const combo = executeAction(transformed, { actorId: 'b', skillId: nezukoIds.basic, targetIds: ['r'], shape: 'single',
    targetRelation: 'enemy' }, registry, () => .5, { resolveStatus: id => registry.getStatus(id) });
  assert.equal(combo.events.filter(event => event.type === 'damage' && event.source.id === nezukoIds.combo).length, 2);
});

test('灶门祢豆子血鬼术·爆血按等级扣当前生命、推条、净化、加暴伤并给炭治郎新回合', () => {
  const registry = new ContentRegistry(); registerNezuko(registry);
  const definition = registry.getHero(nezukoIds.hero);
  registry.registerStatus({ id: 'test.nezuko-control', category: 'control', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace' });
  let initial = state();
  const tanjiro = { ...unit('b2', 'blue'), heroId: 359, hp: 4000, actionGauge: 20,
    statuses: [{ instanceId: 'ally-stun', statusId: 'test.nezuko-control', source: { kind: 'skill', id: 'test.control', unitId: 'r' },
      stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }] };
  initial = { ...initial, units: { ...initial.units, b2: tanjiro }, sides: { ...initial.sides, blue: ['b', 'b2'] },
    resources: { ...initial.resources, blue: { ...initial.resources.blue, fire: 1 } } };
  initial.units.b = { ...initial.units.b, heroId: nezukoIds.hero, skillLevel: 4, skillLevels: { [nezukoIds.bloodBurst]: 4 }, hp: 8000 };
  const context = createBattleContext(initial, () => .5, id => registry.getStatus(id)?.category);
  const commands = definition.skills.find(skill => skill.id === nezukoIds.bloodBurst).execute(context,
    { actorId: 'b', skillId: nezukoIds.bloodBurst, targetIds: ['b2'], shape: 'single', targetRelation: 'ally' }, {});
  assert.ok(commands.some(command => command.type === 'lose-life' && command.targetId === 'b' && command.amount === 800));
  assert.ok(commands.some(command => command.type === 'change-action-gauge' && command.targetId === 'b2' && command.amount === 50));
  assert.ok(commands.some(command => command.type === 'remove-status-instances' && command.instanceIds.includes('ally-stun')));
  const buff = commands.find(command => command.type === 'add-status' && command.instance.statusId === nezukoIds.bloodBurstCrit);
  assert.equal(buff.instance.modifiers[0].amount, .5);
  assert.ok(commands.some(command => command.type === 'schedule-turn' && command.unitId === 'b2'));

  initial.units.b = { ...initial.units.b, skillLevel: 5, skillLevels: { [nezukoIds.bloodBurst]: 5 } };
  initial.resources.blue.fire = 0;
  const skill = definition.skills.find(item => item.id === nezukoIds.bloodBurst);
  assert.equal(skill.resolveResourceCost(initial, initial.units.b).amount, 0);
  assert.ok(Math.abs(skill.execute(createBattleContext(initial), { actorId: 'b', skillId: nezukoIds.bloodBurst,
    targetIds: ['b2'], shape: 'single', targetRelation: 'ally' }, {})
    .find(command => command.type === 'lose-life').amount - 800) < 1e-6, '五级仍牺牲10%当前生命，鬼火费用降为0');
});

test('灶门祢豆子鬼化期间敌方回合末追击行动条最前的其他敌人，结束时睡眠并击退曾受击目标', () => {
  const registry = new ContentRegistry(); registerNezuko(registry);
  const definition = registry.getHero(nezukoIds.hero);
  let initial = state();
  const secondEnemy = { ...unit('r2', 'red'), actionGauge: 90 };
  initial = { ...initial, units: { ...initial.units, r: { ...initial.units.r, actionGauge: 100 }, r2: secondEnemy },
    sides: { ...initial.sides, red: ['r', 'r2'] } };
  const modeSource = { kind: 'skill', id: nezukoIds.demonForm, unitId: 'b' };
  initial.units.b = { ...initial.units.b, heroId: nezukoIds.hero, skillLevel: 5,
    skillLevels: { [nezukoIds.basic]: 5, [nezukoIds.demonForm]: 5 }, statuses: [{ instanceId: 'demon',
      statusId: nezukoIds.demonState, source: modeSource, stacks: 1, duration: { kind: 'permanent' }, values: { turnsLeft: 1 } }] };
  const enemyEnd = { eventId: 'nezuko-enemy-end', phase: 'turn-end', type: 'turn-ended', unitId: 'r',
    source: { kind: 'unit', id: '2', unitId: 'r' } };
  const followUp = definition.handlers['turn-end'].handle(createBattleContext(initial, () => .5,
    id => registry.getStatus(id)?.category), enemyEnd);
  assert.equal(followUp.filter(command => command.type === 'schedule-attack').length, 1);
  assert.equal(followUp.find(command => command.type === 'schedule-attack').intent.targetIds[0], 'r2');
  assert.equal(followUp[0].suppressTargetPassiveTriggers, true);
  assert.equal(followUp[0].hits.length, 2);

  const hitEvent = { eventId: 'nezuko-mode-hit', phase: 'effect-resolution', type: 'damage', source: { ...modeSource, id: nezukoIds.combo },
    targetId: 'r2', amount: 100, actionKind: 'passive', hitIndex: 2 };
  const mark = definition.handlers['effect-resolution'].handle(createBattleContext(initial), hitEvent);
  assert.equal(mark[0].instance.statusId, nezukoIds.demonHit);
  assert.ok(mark.some(command => command.type === 'change-action-gauge' && command.targetId === 'r2' && command.amount === -20));
  initial.units.r2 = { ...initial.units.r2, statuses: [mark[0].instance] };
  const selfEnd = { eventId: 'nezuko-self-end', phase: 'turn-end', type: 'turn-ended', unitId: 'b', source: modeSource };
  const endCommands = definition.handlers['turn-end'].handle(createBattleContext(initial,
    () => .5, id => registry.getStatus(id)?.category), selfEnd);
  assert.ok(endCommands.some(command => command.type === 'add-status' && command.instance.statusId === nezukoIds.sleep));
  assert.ok(endCommands.some(command => command.type === 'change-action-gauge' && command.targetId === 'r2' && command.amount === -40));
  assert.ok(endCommands.some(command => command.type === 'remove-status-instances' && command.instanceIds.includes(mark[0].instance.instanceId)));
});

test('灶门祢豆子五级睡眠逐个单位回合末恢复生命，并在自己普通回合开始前解除沉睡', () => {
  const registry = new ContentRegistry(); registerNezuko(registry);
  const definition = registry.getHero(nezukoIds.hero);
  const initial = state();
  initial.units.b = { ...initial.units.b, heroId: nezukoIds.hero, skillLevel: 5, skillLevels: { [nezukoIds.basic]: 5 }, hp: 5000,
    statuses: [{ instanceId: 'sleep', statusId: nezukoIds.sleep, source: { kind: 'skill', id: nezukoIds.demonForm, unitId: 'b' },
      stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { controlType: '沉睡' } }] };
  const enemyEnd = { eventId: 'sleep-heal', phase: 'turn-end', type: 'turn-ended', unitId: 'r',
    source: { kind: 'unit', id: '2', unitId: 'r' } };
  const healing = definition.handlers['turn-end'].handle(createBattleContext(initial), enemyEnd);
  assert.ok(healing.some(command => command.type === 'heal' && command.targetId === 'b' && command.amount === 1000));
  const wake = definition.handlers['turn-start'].handle(createBattleContext(initial), { ...enemyEnd,
    eventId: 'nezuko-wake', phase: 'turn-start', type: 'turn-started', unitId: 'b' });
  assert.ok(wake.some(command => command.type === 'remove-status-instances' && command.instanceIds.includes('sleep')));
});

test('帝释天金莲按技能等级施加操控并连接技能抵挡护佑', () => {
  const registry = new ContentRegistry(); registerEmperorOfHeaven(registry);
  const definition = registry.getHero(emperorOfHeavenIds.hero), resolveStatus = id => registry.getStatus(id);
  assert.ok(definition.handlers['control-application'] && definition.handlers.hit && definition.handlers['status-expiration']);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: emperorOfHeavenIds.hero, skillLevel: 5,
    skillLevels: { [emperorOfHeavenIds.lotusSkill]: 5, [emperorOfHeavenIds.ultimate]: 1 } };
  initial.units.r = { ...initial.units.r, stats: { ...initial.units.r.stats, resist: 0 } };
  initial.units.r2 = { ...unit('r2', 'red'), hp: 1000 };
  initial.units.b2 = { ...unit('b2', 'blue'), hp: 2000 };
  initial.sides.blue = ['b', 'b2']; initial.sides.red = ['r', 'r2'];
  initial.resources.blue.fire = 5;
  const lotus = definition.skills.find(skill => skill.id === emperorOfHeavenIds.lotusSkill);
  assert.equal(lotus.resourceCost.amount, 2);
  const attempt = lotus.execute(createBattleContext(initial, () => .5, id => registry.getStatus(id)?.category),
    { actorId: 'b', skillId: emperorOfHeavenIds.lotusSkill, targetIds: ['r'], shape: 'single', targetRelation: 'enemy' },
    { duration: 2 });
  assert.equal(attempt[0].type, 'apply-control');
  assert.equal(attempt[0].instance.duration.remaining, 2);
  assert.equal(attempt[0].instance.modifiers[0].amount, -.8);
  const applied = applyEffectCommands(initial, attempt, 'effect-resolution', 'emperor-lotus', resolveStatus);
  const added = applied.events.find(event => event.type === 'status-added' && event.instance.statusId === emperorOfHeavenIds.lotus);
  assert.ok(added);
  const guard = definition.handlers['effect-resolution'].handle(createBattleContext(applied.state), added);
  const guarded = applyEffectCommands(applied.state, guard, 'effect-resolution', 'emperor-lotus-guard', resolveStatus).state;
  assert.ok(guarded.units.b.statuses.some(status => status.statusId === emperorOfHeavenIds.lotusGuard));
  const mark = guarded.units.r.statuses.find(status => status.statusId === emperorOfHeavenIds.lotus);
  assert.equal(registry.getStatus(emperorOfHeavenIds.lotus).category, 'control');
  const forced = registry.getStatus(emperorOfHeavenIds.lotus).selectAction(createBattleContext(guarded), guarded.units.r, mark);
  assert.equal(forced.skillId, emperorOfHeavenIds.controlledBasic);
  assert.equal(forced.targetIds[0], 'r2', '操控普攻选择我方生命比例最低的友方');
  const blocked = definition.handlers['control-application'].handle(createBattleContext(guarded), {
    eventId: 'emperor-control-block', phase: 'control-application', type: 'control-blocked', targetId: 'b',
    protectionStatusId: emperorOfHeavenIds.lotusGuard, source: { kind: 'skill', id: 'test-control', unitId: 'r' },
  });
  assert.ok(blocked.some(command => command.type === 'add-status' && command.instance.duration.remaining === 1));
});

test('帝释天幻境于行动时开启、按敌方人数减速，并在敌方回合开始推条', () => {
  const registry = new ContentRegistry(); registerEmperorOfHeaven(registry);
  const definition = registry.getHero(emperorOfHeavenIds.hero), resolveStatus = id => registry.getStatus(id);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: emperorOfHeavenIds.hero, skillLevel: 3,
    skillLevels: { [emperorOfHeavenIds.lotusSkill]: 3 } };
  initial.units.b2 = { ...unit('b2', 'blue'), actionGauge: 20 };
  initial.units.r2 = { ...unit('r2', 'red') };
  initial.sides.blue = ['b', 'b2']; initial.sides.red = ['r', 'r2'];
  const start = definition.handlers['turn-start'].handle(createBattleContext(initial), {
    eventId: 'emperor-mirage-start', phase: 'turn-start', type: 'turn-started', unitId: 'b', source,
  });
  initial = applyEffectCommands(initial, start, 'effect-resolution', 'emperor-mirage-open', resolveStatus).state;
  assert.ok(initial.units.b.statuses.some(status => status.statusId === emperorOfHeavenIds.mirage));
  assert.equal(initial.units.b.statuses.find(status => status.statusId === emperorOfHeavenIds.mirageSpeed).stacks, 2);
  const context = createBattleContext(initial, () => .5, id => registry.getStatus(id)?.category);
  assert.equal(context.getEffectiveStats('b').speed, 94);
  const enemyStart = definition.handlers['turn-start'].handle(context, {
    eventId: 'emperor-enemy-turn', phase: 'turn-start', type: 'turn-started', unitId: 'r', source,
  });
  assert.ok(enemyStart.some(command => command.type === 'change-action-gauge' && command.targetId === 'b2' && command.amount === 30));
  const removed = applyEffectCommands(initial, [{ type: 'remove-status-instances', source, targetId: 'b',
    instanceIds: [initial.units.b.statuses.find(status => status.statusId === emperorOfHeavenIds.mirage).instanceId], reason: 'dispelled' }],
  'effect-resolution', 'emperor-mirage-closed', resolveStatus).state;
  const passivePush = definition.handlers['turn-end'].handle(createBattleContext(removed), {
    eventId: 'emperor-passive-push', phase: 'turn-end', type: 'turn-ended', unitId: 'b', source,
  });
  assert.ok(passivePush.some(command => command.type === 'change-action-gauge' && command.amount === 50));
});

test('帝释天大招对金莲目标追加两段，怪物金莲追加真实伤害且关闭御魂触发', () => {
  const registry = new ContentRegistry(); registerEmperorOfHeaven(registry);
  const definition = registry.getHero(emperorOfHeavenIds.hero), resolveStatus = id => registry.getStatus(id);
  let initial = state();
  initial.units.b = { ...initial.units.b, heroId: emperorOfHeavenIds.hero, skillLevel: 5,
    skillLevels: { [emperorOfHeavenIds.ultimate]: 5, [emperorOfHeavenIds.lotusSkill]: 5 }, hp: 4000 };
  initial.units.b2 = { ...unit('b2', 'blue'), hp: 3000 };
  initial.units.r.statuses = [{ instanceId: 'golden-lotus', statusId: emperorOfHeavenIds.lotus,
    source: { kind: 'skill', id: emperorOfHeavenIds.lotusSkill, unitId: 'b' }, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }];
  initial.sides.blue = ['b', 'b2'];
  const ultimate = definition.skills.find(skill => skill.id === emperorOfHeavenIds.ultimate);
  assert.equal(ultimate.resourceCost.amount, 3);
  const commands = ultimate.execute(createBattleContext(initial, () => .5),
    { actorId: 'b', skillId: emperorOfHeavenIds.ultimate, targetIds: ['r'], shape: 'all-enemies', targetRelation: 'enemy' },
    { ratio: 1.59, healRatio: 1 });
  assert.equal(commands.filter(command => command.type === 'deal-damage' && command.targetId === 'r').length, 3);
  assert.ok(commands.some(command => command.type === 'heal' && command.targetId === 'b' && command.amount === 5000));
  assert.ok(commands.some(command => command.type === 'heal' && command.targetId === 'b2' && command.amount === 5000));

  const monster = { ...unit('boss', 'red'), unitKind: 'monster', heroId: 0, stats: { ...unit('boss', 'red').stats, resist: 0 } };
  initial.units.boss = monster; initial.sides.red.push('boss');
  const lotus = definition.skills.find(skill => skill.id === emperorOfHeavenIds.lotusSkill);
  const mark = lotus.execute(createBattleContext(initial, () => .5),
    { actorId: 'b', skillId: emperorOfHeavenIds.lotusSkill, targetIds: ['boss'], shape: 'single', targetRelation: 'enemy' }, {});
  const marked = applyEffectCommands(initial, mark, 'effect-resolution', 'emperor-monster-lotus', resolveStatus).state;
  assert.ok(marked.units.boss.statuses.some(status => status.statusId === emperorOfHeavenIds.monsterLotus));
  const extra = definition.handlers['effect-resolution'].handle(createBattleContext(marked), {
    eventId: 'emperor-monster-damage', phase: 'hit', type: 'damage', source: { kind: 'skill', id: 'test-hit', unitId: 'b' },
    targetId: 'boss', amount: 1000, damageKind: 'normal', suppressSoulTriggers: false, suppressSourcePassiveTriggers: false,
  });
  assert.equal(extra[0].damageKind, 'true');
  assert.equal(extra[0].amount, 3900, '40%已造成伤害加五级帝释天攻击力70%');
  assert.equal(extra[0].suppressSoulTriggers, true);
  assert.equal(extra[0].suppressSourcePassiveTriggers, true);

  let protected = state();
  protected.units.b = { ...protected.units.b, heroId: emperorOfHeavenIds.hero, skillLevel: 5,
    skillLevels: { [emperorOfHeavenIds.ultimate]: 5 }, hp: 1000 };
  protected.units.r.statuses = [{ instanceId: 'fatal-lotus', statusId: emperorOfHeavenIds.lotus,
    source: { kind: 'skill', id: emperorOfHeavenIds.lotusSkill, unitId: 'b' }, stacks: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' } }];
  protected.units.b.statuses = [{ instanceId: 'fatal-guard', statusId: emperorOfHeavenIds.lotusGuard,
    source: { kind: 'skill', id: emperorOfHeavenIds.lotusSkill, unitId: 'b' }, stacks: 1,
    duration: { kind: 'permanent' }, values: { targetUnitId: 'r' } }];
  const fatal = applyEffectCommands(protected, [{ type: 'deal-damage', source: { kind: 'skill', id: 'test-lethal', unitId: 'r' },
    targetId: 'b', amount: 100000, damageKind: 'normal', precalculated: true }], 'hit', 'emperor-fatal', resolveStatus);
  const lethalEvent = fatal.events.find(event => event.type === 'damage' && event.fatalProtectionStatusId === emperorOfHeavenIds.lotusGuard);
  assert.ok(lethalEvent);
  assert.equal(fatal.state.units.b.hp, 1);
  const restore = definition.handlers.hit.handle(createBattleContext(fatal.state), lethalEvent);
  assert.ok(restore.some(command => command.type === 'restore-health' && command.amount === 499));
  const removeMark = restore.find(command => command.type === 'remove-status-instances' && command.targetId === 'r');
  const removed = applyEffectCommands(fatal.state, [removeMark], 'effect-resolution', 'emperor-lotus-break', resolveStatus);
  const expiry = removed.events.find(event => event.type === 'status-removed' && event.statusId === emperorOfHeavenIds.lotus);
  const freeCast = definition.handlers['effect-resolution'].handle(createBattleContext(removed.state), expiry);
  assert.ok(freeCast.some(command => command.type === 'schedule-action' && command.freeCast));
  assert.ok(freeCast.some(command => command.type === 'add-status' && command.instance.statusId === emperorOfHeavenIds.freeUltimate));
});
