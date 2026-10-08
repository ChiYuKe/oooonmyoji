const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { simulateBattle, simulateBattleProgressive, simulateBattleSampleDetails } = require('../dist-test-renderer/renderer/features/duel/engine/battle-engine.js');
const { createSeededRandom, deriveSampleSeed } = require('../dist-test-renderer/renderer/features/duel/engine/core/random.js');
const { EventDispatcher } = require('../dist-test-renderer/renderer/features/duel/engine/core/event-dispatcher.js');
const { settleEvents } = require('../dist-test-renderer/renderer/features/duel/engine/core/settlement.js');
const { checkBattleEnd, scheduleNextActor } = require('../dist-test-renderer/renderer/features/duel/engine/core/action-scheduler.js');
const { applyEffectCommands } = require('../dist-test-renderer/renderer/features/duel/engine/core/effects.js');
const { TriggerBudget } = require('../dist-test-renderer/renderer/features/duel/engine/core/trigger-budget.js');
const { ContentRegistry } = require('../dist-test-renderer/renderer/features/duel/engine/content/registry.js');
const { registerGenericFallbackHeroes } = require('../dist-test-renderer/renderer/features/duel/engine/content/generic-fallback.js');
const { diagnoseContentCoverage, isRosterFullyMigrated } = require('../dist-test-renderer/renderer/features/duel/engine/content/coverage.js');
const { executeAction } = require('../dist-test-renderer/renderer/features/duel/engine/core/action-runner.js');
const { advanceStatusDurations, captureStatusExpirySnapshot } = require('../dist-test-renderer/renderer/features/duel/engine/core/status-lifecycle.js');
const { createBasicAttackSkill, createHealingSkill } = require('../dist-test-renderer/renderer/features/duel/engine/content/common-skills.js');
const { createBattleState } = require('../dist-test-renderer/renderer/features/duel/engine/simulation/input-adapter.js');
const { registerPvpRules } = require('../dist-test-renderer/renderer/features/duel/engine/mechanics/pvp-rules.js');
const { runBattle } = require('../dist-test-renderer/renderer/features/duel/engine/simulation/run-battle.js');
const { calculateDamage, resolveDamage } = require('../dist-test-renderer/renderer/features/duel/engine/mechanics/damage.js');
const { effectiveCritResist, effectiveDamageMultiplier, effectiveDamageTakenMultiplier, effectiveStats } = require('../dist-test-renderer/renderer/features/duel/engine/mechanics/stats.js');
const { resolveHealing } = require('../dist-test-renderer/renderer/features/duel/engine/mechanics/healing.js');
const { presentBattleEvents } = require('../dist-test-renderer/renderer/features/duel/engine/presentation/events.js');
const { registerBaselineSouls, baselineSoulIds, shieldStatusId, guardAttackStatusId } = require('../dist-test-renderer/renderer/features/duel/engine/content/baseline-souls.js');
const { createBattleContext } = require('../dist-test-renderer/renderer/features/duel/engine/core/context.js');
const { registerMoonChaser, moonChaserIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/moon-chaser.js');
const { registerSongstress, songstressIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/songstress.js');
const { registerTrueFox, trueFoxIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/true-fox.js');
const { registerBellEmpress, bellEmpressIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/bell-empress.js');
const { registerSkullGeneral, skullGeneralIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/skull-general.js');
const { registerCloudMirror, cloudMirrorIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/cloud-mirror.js');
const { registerKidomaru, kidomaruIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/kidomaru.js');
const { registerHearingSeaGoldfish, hearingSeaGoldfishIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/hearing-sea-goldfish.js');
const { registerEngagementGod, engagementGodIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/engagement-god.js');
const { registerWorldLantern, worldLanternIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/world-lantern.js');
const { registerRedMaple, redMapleIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/red-maple.js');
const { createMigratedContentRegistry } = require('../dist-test-renderer/renderer/features/duel/engine/content/register-migrated-content.js');
const { registerZashiki, zashikiIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/zashiki.js');
const { passiveSuppressionStatusId } = require('../dist-test-renderer/renderer/features/duel/engine/core/passive-eligibility.js');
const { registerLanternGhost, lanternGhostIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/lantern-ghost.js');
const { registerSoulReaper, soulReaperIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/soul-reaper.js');
const { registerUbume, ubumeIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/ubume.js');
const { registerTwoMouthGirl, twoMouthGirlIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/two-mouth-girl.js');
const { registerLanternSpirit, lanternSpiritIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/lantern-spirit.js');
const { registerWhiteWolf, whiteWolfIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/white-wolf.js');
const { registerArakawa, arakawaIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/arakawa.js');
const { registerCrabSister, crabSisterIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/crab-sister.js');
const { registerRukia, rukiaIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/rukia.js');
const { registerIchigo, ichigoIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/ichigo.js');
const { registerTakiyashahime, takiyashahimeIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/takiyashahime.js');
const { registerEnshrinedFox, enshrinedFoxIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/enshrined-fox.js');
const { registerPaperDancer, paperDancerIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/paper-dancer.js');
const { registerGhostKingShuten, ghostKingShutenIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/ghost-king-shuten.js');
const { registerStarBear, starBearIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/star-bear.js');
const { registerTenkenOniKiri, tenkenOniKiriIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/tenken-oni-kiri.js');
const { registerKawaArakawa, kawaArakawaIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/kawa-arakawa.js');
const { registerSakuraFairy, sakuraFairyIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/sakura-fairy.js');
const { registerEbisu, ebisuIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/ebisu.js');
const { registerHannya, hannyaIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/hannya.js');
const { passivesEnabled } = require('../dist-test-renderer/renderer/features/duel/engine/core/passive-eligibility.js');
const { soulsEnabled } = require('../dist-test-renderer/renderer/features/duel/engine/core/soul-eligibility.js');
const { registerEchoingInsect, echoingInsectIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/echoing-insect.js');
const { registerIbarakiDoji, ibarakiDojiIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/ibaraki-doji.js');
const { fortuneCatIds, registerFortuneCat } = require('../dist-test-renderer/renderer/features/duel/engine/content/fortune-cat.js');
const { soulSuppressionStatusId } = require('../dist-test-renderer/renderer/features/duel/engine/core/soul-eligibility.js');
const { yinMoruoIds, registerYinMoruo } = require('../dist-test-renderer/renderer/features/duel/engine/content/yin-moruo.js');
const { nirvanaFireIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/nirvana-fire.js');
const { seaMoonFireJadeIds, registerSeaMoonFireJade } = require('../dist-test-renderer/renderer/features/duel/engine/content/sea-moon-fire-jade.js');
const { soulBirdIds, soulBirdDamageBonus } = require('../dist-test-renderer/renderer/features/duel/engine/content/soul-bird.js');
const { registerWoodCharm, woodCharmIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/wood-charm.js');
const { registerReturnIncense, returnIncenseIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/return-incense.js');
const { registerBellSpirit, bellSpiritIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/bell-spirit.js');
const { registerSnowSpirit, snowSpiritIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/snow-spirit.js');
const { registerDreamPillow, dreamPillowIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/dream-pillow.js');
const { registerBatWing, batWingIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/bat-wing.js');
const { registerClothOfProtection, clothOfProtectionIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/cloth-of-protection.js');
const { registerTreeSpirit, treeSpiritIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/tree-spirit.js');
const { registerDamageScalingSouls, damageScalingSoulIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/damage-scaling-souls.js');
const { registerDawnlessDusk, dawnlessDuskIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/dawnless-dusk.js');
const { registerGravekeeperBeast, gravekeeperBeastIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/gravekeeper-beast.js');
const { registerPearl, pearlIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/pearl.js');
const { registerSoulDiver, soulDiverIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/soul-diver.js');
const { registerTulfo, tulfoIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/tulfo.js');
const { registerTubingFire, tubingFireIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/tubing-fire.js');
const { registerRoundabout, roundaboutIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/roundabout.js');
const { registerFireCart, fireCartIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/fire-cart.js');
const { registerDiekou, dieKouIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/die-kou.js');
const { registerQingnufang, qingnufangIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/qingnufang.js');
const { registerYuanxingTemple, yuanxingTempleIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/yuanxing-temple.js');
const { registerDustMound, dustMoundIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/dust-mound.js');
const { registerRampingSouls, rampingSoulIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/ramping-souls.js');
const { registerControlSouls, controlSoulIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/control-souls.js');
const { attemptControl, attemptDebuff } = require('../dist-test-renderer/renderer/features/duel/engine/mechanics/control.js');
const { flyingEdgeIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/flying-edge.js');
const { registerReflectiveSouls, reflectiveSoulIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/reflective-souls.js');
const { registerDebuffSouls, debuffSoulIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/debuff-souls.js');
const { registerZhen, zhenIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/zhen.js');
const { registerRabbitMaru, rabbitMaruIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/rabbit-maru.js');
const { registerPeachBlossom, peachBlossomIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/peach-blossom.js');
const { registerSnowGirl, snowGirlIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/snow-girl.js');
const { registerThreeTailFox, threeTailFoxIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/three-tail-fox.js');
const { registerCarpSpirit, carpSpiritIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/carp-spirit.js');
const { registerKappa, kappaIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/kappa.js');
const { registerNineLivedCat, nineLivedCatIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/nine-lived-cat.js');
const { registerBoySoulSacrifice, boySoulSacrificeIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/boy-soul-sacrifice.js');
const { registerLittleGirl, littleGirlIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/little-girl.js');
const { registerEater, eaterIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/eater.js');
const { registerMengPo, mengPoIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/meng-po.js');
const { registerWuguShi, wuguShiIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/wugu-shi.js');
const { registerGreatTengu, greatTenguIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/great-tengu.js');
const { registerYatagarasu, yatagarasuIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/yatagarasu.js');
const { registerShutenDoji, shutenDojiIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/shuten-doji.js');
const { registerFoodHairDemon, foodHairDemonIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/food-hair-demon.js');
const { registerSamuraiSpirit, samuraiSpiritIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/samurai-spirit.js');
const { registerBoneGirl, boneGirlIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/bone-girl.js');
const { registerRainWoman, rainWomanIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/rain-woman.js');
const { registerJumpingBrother, jumpingBrotherIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/jumping-brother.js');
const { registerJumpingYoungerBrother, jumpingYoungerBrotherIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/jumping-younger-brother.js');
const { registerJumpingSister, jumpingSisterIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/jumping-sister.js');
const { registerBingyong, bingyongIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/bingyong.js');
const { registerUglyWoman, uglyWomanIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/ugly-woman.js');
const { registerOneEyedMonk, oneEyedMonkIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/one-eyed-monk.js');
const { registerIronRat, ironRatIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/iron-rat.js');
const { registerJiaoTu, jiaoTuIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/jiao-tu.js');
const { registerGuanHu, guanHuIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/guan-hu.js');
const { registerYamausagi, yamausagiIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/yamausagi.js');
const { registerFirefly, fireflyIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/firefly.js');
const { registerButterflySpirit, butterflySpiritIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/butterfly-spirit.js');
const { registerTanuki, tanukiIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/tanuki.js');
const { registerSeaMonk, seaMonkIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/sea-monk.js');
const { registerInsectMaster, insectMasterIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/insect-master.js');
const { registerLuminousMoonChaser, luminousMoonChaserIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/luminous-moon-chaser.js');
const { registerShuraKidomaru, shuraKidomaruIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/shura-kidomaru.js');
const { registerJinkougyou, jinkougyouIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/jinkougyou.js');
const { shikagamiCityIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/shikagami-city.js');
const { chihimeIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/chihime.js');
const { resentmentHannyaIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/resentment-hannya.js');
const { kujiraIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/kujira.js');
const { ootakemaruIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/ootakemaru.js');
const { cicadaSnowMaidenIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/cicada-snow-maiden.js');
const { registerJi, jiIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/ji.js');
const { registerWhiteFox, whiteFoxIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/white-fox.js');
const { registerHumanFacedTree, humanFacedTreeIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/human-faced-tree.js');
const { registerYujuworm, yujuwormIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/yujuworm.js');
const { registerKikyo, kikyoIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/kikyo.js');
const { registerIttanMomen, ittanMomenIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/ittan-momen.js');
const { registerEmbalmer, embalmerIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/embalmer.js');
const { registerHellishIbaraki, hellishIbarakiIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/hellish-ibaraki.js');
const { registerOrochi, orochiIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/orochi.js');
const { registerInariMiketsu, inariMiketsuIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/inari-miketsu.js');
const { registerCangfengOneEyed, cangfengIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/cangfeng-one-eyed.js');
const { registerRedShadowYoto, redShadowYotoIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/red-shadow-yoto.js');
const { registerHaishin, haishinIds } = require('../dist-test-renderer/renderer/features/duel/engine/content/haishin.js');


function state() {
  const unit = (unitId, side, hp, shield = 0) => ({
    unitId, heroId: 1, skillLevel: 1, side,
    stats: { hp, attack: 100, defense: 0, speed: 100, crit: 0, critDamage: 1.5, hit: 0, resist: 0 },
    hp, shield, actionGauge: 0, statuses: [], resources: {},
  });
  const blue = unit('blue-1', 'blue', 100, 10);
  const red = unit('red-1', 'red', 60, 10);
  return {
    units: { [blue.unitId]: blue, [red.unitId]: red },
    sides: { blue: [blue.unitId], red: [red.unitId] },
    resources: { blue: { fire: 4 }, red: { fire: 4 } },
    resourceMeters: {
      blue: { fire: { progress: 0, threshold: 5, nextSupply: 3, maxSupply: 5, resourceCap: 8 } },
      red: { fire: { progress: 0, threshold: 5, nextSupply: 3, maxSupply: 5, resourceCap: 8 } },
    },
    counters: { round: 1, action: 2, attack: 3, hit: 1 },
    ended: false,
  };
}

test('Flying Edge ignores 30% of total resistance on debuff and control checks, and soul seal disables it', () => {
  const base = state();
  const wearer = { ...base.units['blue-1'], soulId: flyingEdgeIds.soul };
  const target = { ...base.units['red-1'], stats: { ...base.units['red-1'].stats, resist: .5 } };
  const battle = { ...base, units: { ...base.units, 'blue-1': wearer, 'red-1': target } };
  const context = createBattleContext(battle, () => .6);
  const source = { kind: 'skill', id: 'test', unitId: wearer.unitId };
  const debuff = attemptDebuff(context, { source, targetId: target.unitId, statusId: 'test.debuff', baseChance: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' } });
  assert.equal(debuff[0].type, 'add-status', 'effective resistance is .35, so a .6 roll passes');
  const control = attemptControl(context, { attemptId: 'test.control', source, targetId: target.unitId,
    statusId: 'test.control', controlType: 'stun', baseChance: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' } });
  assert.equal(control.type, 'apply-control', 'the common control path uses the same adjusted resistance');

  const sealedWearer = { ...wearer, statuses: [{ instanceId: 'seal', statusId: soulSuppressionStatusId,
    source: { kind: 'skill', id: 'seal' }, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }] };
  const sealedContext = createBattleContext({ ...battle, units: { ...battle.units, 'blue-1': sealedWearer } }, () => .6);
  const sealedDebuff = attemptDebuff(sealedContext, { source, targetId: target.unitId, statusId: 'test.debuff', baseChance: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' } });
  assert.equal(sealedDebuff[0].type, 'report-status-resisted', 'soul seal restores the target resistance to .5');
});

test('Peach Blossom healing spreads once and applies a one-turn blossom status', () => {
  const registry = new ContentRegistry();
  registerPeachBlossom(registry);
  const unit = (unitId, side, heroId, hp) => ({ unitId, heroId, skillLevel: 1, side,
    stats: { hp: 100, attack: 100, defense: 0, speed: 100, crit: 0, critDamage: 1.5, hit: 0, resist: 0 },
    hp, shield: 0, actionGauge: 0, statuses: [], resources: {} });
  const peach = unit('blue-1', 'blue', peachBlossomIds.hero, 100);
  const target = unit('blue-2', 'blue', 1, 30);
  const ally = unit('blue-3', 'blue', 2, 50);
  const enemy = unit('red-1', 'red', 3, 100);
  const initial = { units: Object.fromEntries([peach, target, ally, enemy].map(item => [item.unitId, item])),
    sides: { blue: ['blue-1', 'blue-2', 'blue-3'], red: ['red-1'] }, resources: { blue: { fire: 4 }, red: { fire: 4 } },
    resourceMeters: {}, counters: { round: 1, action: 0, attack: 0, hit: 0 }, ended: false };
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: `hero:${peachBlossomIds.hero}:effect-resolution`, phase: 'effect-resolution', priority: 0,
    handle: registry.getHero(peachBlossomIds.hero).handlers['effect-resolution'].handle });
  const result = executeAction(initial, { actorId: peach.unitId, skillId: peachBlossomIds.healingSkill,
    targetIds: [target.unitId], shape: 'single', targetRelation: 'ally' }, registry, () => .5, { dispatcher,
      resolveStatus: id => registry.getStatus(id) });
  assert.equal(result.accepted, true);
  assert.equal(result.state.units[target.unitId].hp, 50);
  assert.equal(result.state.units[ally.unitId].hp, 56);
  assert.equal(result.state.units[enemy.unitId].hp, 100);
  assert.equal(result.state.resources.blue.fire, 2);
  assert.ok(result.state.units[target.unitId].statuses.some(status => status.statusId === peachBlossomIds.blossom
    && status.duration.remaining === 1 && status.duration.owner === 'target-turn'));
  assert.equal(result.events.filter(event => event.type === 'healing').length, 3);
});

test('Peach Blossom resurrection can target a fallen ally and its policy prioritizes resurrection', () => {
  const registry = new ContentRegistry();
  registerPeachBlossom(registry);
  const unit = (unitId, side, heroId, hp) => ({ unitId, heroId, skillLevel: 1,
    side, stats: { hp: 100, attack: 100, defense: 0, speed: 100, crit: 0, critDamage: 1.5, hit: 0, resist: 0 },
    hp, shield: 0, actionGauge: 0, statuses: [], resources: {} });
  const peach = unit('blue-1', 'blue', peachBlossomIds.hero, 100);
  const fallen = unit('blue-2', 'blue', 1, 0);
  fallen.statuses = [{ instanceId: 'stun:fallen', statusId: 'test.revive-control', source: { kind: 'skill', id: 'test.stun' },
    stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }];
  const enemy = unit('red-1', 'red', 3, 100);
  const initial = { units: { [peach.unitId]: peach, [fallen.unitId]: fallen, [enemy.unitId]: enemy },
    sides: { blue: [peach.unitId, fallen.unitId], red: [enemy.unitId] }, resources: { blue: { fire: 4 }, red: { fire: 4 } },
    resourceMeters: {}, counters: { round: 1, action: 0, attack: 0, hit: 0 }, ended: false };
  registry.registerStatus({ id: 'test.revive-control', mechanicsCoverage: 'verified', dispellable: true, sealable: false,
    durationOwner: 'target-turn', refreshPolicy: 'replace', category: 'control' });
  const hero = registry.getHero(peachBlossomIds.hero);
  const intent = hero.policy(createBattleContext(initial, () => .5), peach.unitId);
  assert.equal(intent.skillId, peachBlossomIds.reviveSkill);
  const result = executeAction(initial, { actorId: peach.unitId, skillId: peachBlossomIds.reviveSkill,
    targetIds: [fallen.unitId], shape: 'single', targetRelation: 'ally' }, registry, () => .5,
    { resolveStatus: id => registry.getStatus(id) });
  assert.equal(result.accepted, true);
  assert.equal(result.state.units[fallen.unitId].hp, 20);
  assert.equal(result.state.resources.blue.fire, 1);
  assert.ok(result.events.some(event => event.type === 'unit-revived' && event.unitId === fallen.unitId));
  assert.deepEqual(result.state.units[fallen.unitId].statuses, []);
  assert.ok(result.events.some(event => event.type === 'status-removed' && event.targetId === fallen.unitId
    && event.statusCategory === 'control' && event.reason === 'consumed'));
  assert.equal(executeAction(result.state, { actorId: peach.unitId, skillId: peachBlossomIds.reviveSkill,
    targetIds: [enemy.unitId], shape: 'single', targetRelation: 'ally' }, registry, () => .5).failure, 'invalid-target');
});

test('雪女暴风雪按多段命中结算冰冻，已冰冻目标可以转为深度冰冻', () => {
  const registry = new ContentRegistry();
  registerSnowGirl(registry);
  const initial = state();
  const snowGirl = { ...initial.units['blue-1'], heroId: snowGirlIds.hero, skillLevel: 1 };
  const secondEnemy = { ...initial.units['red-1'], unitId: 'red-2', hp: 100, stats: { ...initial.units['red-1'].stats, hp: 100 } };
  initial.units['blue-1'] = snowGirl;
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 100, stats: { ...initial.units['red-1'].stats, hp: 100 } };
  initial.units[secondEnemy.unitId] = secondEnemy;
  initial.sides.red = ['red-1', 'red-2'];
  initial.resources.blue.fire = 3;
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: `hero:${snowGirlIds.hero}:hit`, phase: 'hit', priority: 140,
    handle: registry.getHero(snowGirlIds.hero).handlers.hit.handle });
  const result = executeAction(initial, { actorId: 'blue-1', skillId: snowGirlIds.blizzard,
    targetIds: ['red-1', 'red-2'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => 0,
    { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(result.accepted, true);
  assert.equal(result.state.resources.blue.fire, 0);
  assert.equal(result.events.filter(event => event.type === 'damage' && event.source.id === snowGirlIds.blizzard).length, 6);
  assert.ok(result.state.units['red-1'].statuses.some(status => status.statusId === snowGirlIds.freeze
    && status.values.controlType === '深度冰冻' && status.duration.remaining === 2));
  assert.ok(result.events.some(event => event.type === 'control-applied' && event.targetId === 'red-1'));
});

test('雪女回合结束给暴击伤害最高的友方提供冰甲盾，受击后有机会减速攻击者', () => {
  const registry = new ContentRegistry();
  registerSnowGirl(registry);
  const initial = state();
  const snowGirl = { ...initial.units['blue-1'], heroId: snowGirlIds.hero, skillLevel: 5, soulId: flyingEdgeIds.soul };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, resist: .5 } };
  const ally = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 2, stats: { ...initial.units['blue-1'].stats, critDamage: 2 } };
  initial.units['blue-1'] = snowGirl;
  initial.units['blue-2'] = ally;
  initial.sides.blue = ['blue-1', 'blue-2'];
  const handler = registry.getHero(snowGirlIds.hero).handlers;
  const turnEnd = handler['turn-end'].handle;
  const armorCommands = turnEnd(createBattleContext(initial, () => 0), { type: 'turn-ended', eventId: 'snow-turn-end',
    phase: 'turn-end', source: { kind: 'system', id: 'turn' }, unitId: 'blue-1' });
  assert.deepEqual(armorCommands.map(command => command.targetId), ['blue-1', 'blue-2']);
  const armored = applyEffectCommands(initial, armorCommands, 'effect-resolution', 'snow-armor', id => registry.getStatus(id)).state;
  assert.equal(armored.units['blue-2'].statuses.find(status => status.statusId === snowGirlIds.armor).values.shieldRemaining, 12);
  const attack = applyEffectCommands(armored, [{ type: 'deal-damage', source: { kind: 'skill', id: 'test.attack', unitId: 'red-1' },
    targetId: 'blue-2', amount: 5 }], 'hit', 'snow-incoming', id => registry.getStatus(id));
  const response = handler.hit.handle(createBattleContext(attack.state, () => .3), attack.events.find(event => event.type === 'damage'));
  assert.equal(response[0].type, 'add-status');
  assert.equal(response[0].targetId, 'red-1');
  assert.equal(response[0].instance.statusId, snowGirlIds.slow);
});

test('三尾狐三段攻击结算满血增伤、狐袭印记、被动吸血和印记间接伤害', () => {
  const registry = new ContentRegistry();
  registerThreeTailFox(registry);
  const initial = state();
  const fox = { ...initial.units['blue-1'], heroId: threeTailFoxIds.hero, skillLevel: 5, hp: 100,
    stats: { ...initial.units['blue-1'].stats, hp: 100, attack: 100 } };
  const target = { ...initial.units['red-1'], hp: 1000, shield: 0,
    stats: { ...initial.units['red-1'].stats, hp: 1000, defense: 0 } };
  initial.units[fox.unitId] = fox;
  initial.units[target.unitId] = target;
  initial.counters = { ...initial.counters, action: 0, attack: 0, hit: 0 };
  initial.ended = false;
  initial.resources.blue.fire = 3;
  const result = runBattle(initial, registry, { seed: 27, actionLimit: 1 });
  const hits = result.events.filter(event => event.type === 'damage' && event.source.id === threeTailFoxIds.ultimate);
  assert.equal(hits.length, 3);
  assert.ok(hits.every(event => event.amount > 110), '技能五级满血时含15%增伤');
  assert.equal(result.state.units[fox.unitId].hp, 100, '被动吸血受生命上限约束');
  assert.equal(result.state.units[target.unitId].statuses.find(status => status.statusId === threeTailFoxIds.foxMark).stacks, 3);
  const poison = result.state.units[target.unitId].statuses.find(status => status.statusId === threeTailFoxIds.poison);
  assert.equal(poison.stacks, 3);
  assert.equal(createBattleContext(result.state, () => .5).getEffectiveStats(target.unitId).speed, 90, '5级毒使目标速度降低10%');
  const passiveHit = { ...hits[0], eventId: 'fox-basic-passive', source: { kind: 'skill', id: threeTailFoxIds.basic, unitId: fox.unitId },
    targetId: target.unitId, hpLost: 25 };
  const passiveCommands = registry.getHero(threeTailFoxIds.hero).handlers.hit.handle(
    createBattleContext(result.state, () => 0), passiveHit);
  assert.equal(passiveCommands[0].type, 'restore-health');
  assert.equal(passiveCommands[0].amount, 10);
  assert.equal(passiveCommands[1].type, 'add-status');
  assert.equal(passiveCommands[1].targetId, fox.unitId);
  assert.equal(passiveCommands[1].instance.modifiers[0].amount, 20);
  const defendedState = { ...result.state, units: { ...result.state.units,
    [target.unitId]: { ...result.state.units[target.unitId], stats: { ...result.state.units[target.unitId].stats, defense: 300 } } } };
  const tick = registry.getHero(threeTailFoxIds.hero).handlers['turn-start'].handle(createBattleContext(defendedState, () => .5), {
    eventId: 'fox-mark-tick', phase: 'turn-start', source: { kind: 'system', id: 'turn' }, type: 'turn-started', unitId: target.unitId,
  });
  assert.equal(tick[0].type, 'lose-life');
  assert.ok(Math.abs(tick[0].amount - 40) < 1e-10, '三层5级毒使间接伤害额外忽略150防御');
  const ticked = applyEffectCommands(defendedState, tick, 'effect-resolution', 'fox-mark-tick', id => registry.getStatus(id));
  assert.equal(ticked.state.units[target.unitId].hp, defendedState.units[target.unitId].hp - 40);
  assert.equal(registry.getHero(threeTailFoxIds.hero).mechanicsCoverage, 'partial');

  const flyingFox = { ...fox, soulId: flyingEdgeIds.soul };
  const resistantTarget = { ...target, statuses: [], stats: { ...target.stats, resist: .5 } };
  const flyingState = { ...result.state, units: { ...result.state.units, [fox.unitId]: flyingFox,
    [target.unitId]: resistantTarget } };
  const flyingCommands = registry.getHero(threeTailFoxIds.hero).handlers.hit.handle(
    createBattleContext(flyingState, () => .6), { ...hits[0], source: { kind: 'skill', id: threeTailFoxIds.ultimate,
      unitId: fox.unitId }, targetId: target.unitId, hpLost: 0 });
  assert.deepEqual(flyingCommands.filter(command => command.type === 'add-status').map(command => command.instance.statusId),
    [threeTailFoxIds.poison, threeTailFoxIds.foxMark], 'the poison and mark use Flying Edge adjusted resistance');
});

test('鲤鱼精泡泡之盾为满级友方提供间接伤害减免且不减免直接生命流失', () => {
  const registry = new ContentRegistry();
  registerCarpSpirit(registry);
  const initial = state();
  const carp = { ...initial.units['blue-1'], heroId: carpSpiritIds.hero, skillLevel: 5 };
  const ally = { ...carp, unitId: 'blue-2', heroId: 2, stats: { ...carp.stats, hp: 200 }, hp: 200 };
  initial.units[carp.unitId] = carp;
  initial.units[ally.unitId] = ally;
  initial.sides.blue = [carp.unitId, ally.unitId];
  const result = executeAction(initial, { actorId: carp.unitId, skillId: carpSpiritIds.bubbleShield,
    targetIds: [carp.unitId, ally.unitId], shape: 'all-allies', targetRelation: 'ally' }, registry, () => 0.5);
  assert.equal(result.state.units[ally.unitId].statuses[0].values.shieldRemaining, 36);
  assert.equal(result.state.units[ally.unitId].statuses[0].modifiers.find(item => item.stat === 'hit').amount, 0.1);
  assert.equal(result.state.units[ally.unitId].statuses[0].modifiers.find(item => item.stat === 'indirectDamageTaken').amount, -0.5);

  const indirect = applyEffectCommands(result.state, [{ type: 'lose-life', source: { kind: 'status', id: 'test.indirect' },
    targetId: ally.unitId, amount: 40, lifeLossKind: 'indirect' }], 'turn-start', 'carp-indirect', id => registry.getStatus(id));
  assert.equal(indirect.state.units[ally.unitId].hp, 180);
  assert.equal(indirect.events.find(event => event.type === 'life-lost').lifeLossKind, 'indirect');
  const direct = applyEffectCommands(result.state, [{ type: 'lose-life', source: { kind: 'skill', id: 'test.direct' },
    targetId: ally.unitId, amount: 40 }], 'effect-resolution', 'carp-direct', id => registry.getStatus(id));
  assert.equal(direct.state.units[ally.unitId].hp, 160);
  assert.equal(registry.getHero(carpSpiritIds.hero).mechanicsCoverage, 'partial');
});

test('河童大河之歌对低于40%生命比例目标追加伤害，行动后滋润叠加并提高后续攻击', () => {
  const registry = new ContentRegistry();
  registerKappa(registry);
  const initial = state();
  const kappa = { ...initial.units['blue-1'], heroId: kappaIds.hero, skillLevel: 4 };
  const wounded = { ...initial.units['red-1'], hp: 3900,
    stats: { ...initial.units['red-1'].stats, hp: 10000, attack: 100, defense: 0, crit: 0 } };
  const boundary = { ...wounded, unitId: 'red-2', hp: 4000 };
  initial.units[kappa.unitId] = kappa;
  initial.units[wounded.unitId] = wounded;
  initial.units[boundary.unitId] = boundary;
  initial.sides.red = [wounded.unitId, boundary.unitId];
  initial.counters = { ...initial.counters, action: 0, attack: 0, hit: 0 };
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'hero:209:action-end', phase: 'action-end', priority: 70,
    handle: registry.getHero(kappaIds.hero).handlers['action-end'].handle });
  const result = executeAction(initial, { actorId: kappa.unitId, skillId: kappaIds.ultimate,
    targetIds: [wounded.unitId, boundary.unitId], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => 0.5,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });
  const damages = result.events.filter(event => event.type === 'damage' && event.source.id === kappaIds.ultimate);
  assert.equal(damages.length, 2);
  assert.equal(damages[0].amount, 128, 'Lv4倍率1.08并对低血量目标追加0.2倍率');
  assert.equal(damages[1].amount, 108, '生命比例恰为40%时不追加倍率');
  const moisture = result.state.units[kappa.unitId].statuses.find(status => status.statusId === kappaIds.moisture);
  assert.equal(moisture.stacks, 1, '行动结束后获得第一层永久滋润');
  assert.equal(moisture.values.attackBonus, 0.3);
  const next = executeAction(result.state, { actorId: kappa.unitId, skillId: kappaIds.basic,
    targetIds: [boundary.unitId], shape: 'single', targetRelation: 'enemy' }, registry, () => 0.5,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(next.events.find(event => event.type === 'damage' && event.source.id === kappaIds.basic).amount, 113.1,
    '滋润一层让Lv4普攻按130攻击力而非100攻击力计算');
  assert.equal(next.state.units[kappa.unitId].statuses.find(status => status.statusId === kappaIds.moisture).stacks, 2);
  let stacked = next.state;
  for (let index = 0; index < 3; index++) {
    stacked = executeAction(stacked, { actorId: kappa.unitId, skillId: kappaIds.basic,
      targetIds: [boundary.unitId], shape: 'single', targetRelation: 'enemy' }, registry, () => 0.5,
    { dispatcher, resolveStatus: id => registry.getStatus(id) }).state;
  }
  assert.equal(stacked.units[kappa.unitId].statuses.find(status => status.statusId === kappaIds.moisture).stacks, 4,
    '滋润达到四层后不再增长');
  assert.equal(registry.getHero(kappaIds.hero).mechanicsCoverage, 'partial');
});

test('九命猫暴击叠加九命并在四层阵亡时复活，复仇反击三段且保留来源顺序', () => {
  const registry = new ContentRegistry();
  registerNineLivedCat(registry);
  const initial = state();
  const cat = { ...initial.units['blue-1'], heroId: nineLivedCatIds.hero, skillLevel: 1, hp: 100,
    stats: { ...initial.units['blue-1'].stats, hp: 100, attack: 100, crit: 0 } };
  const killer = { ...initial.units['red-1'], hp: 1000, shield: 0,
    stats: { ...initial.units['red-1'].stats, hp: 1000, attack: 1000 } };
  const lifeStatus = { instanceId: 'cat-lives', statusId: nineLivedCatIds.lives,
    source: { kind: 'skill', id: nineLivedCatIds.passive, unitId: cat.unitId }, stacks: 4, duration: { kind: 'permanent' } };
  initial.units[cat.unitId] = { ...cat, hp: 0, statuses: [lifeStatus] };
  initial.units[killer.unitId] = killer;
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'hero:207:defeat', phase: 'unit-defeated', priority: 115,
    handle: registry.getHero(nineLivedCatIds.hero).handlers['unit-defeated'].handle });
  const death = { type: 'unit-defeated', eventId: 'cat-death', phase: 'unit-defeated',
    source: { kind: 'skill', id: 'killer-skill', unitId: killer.unitId }, defeatedBy: { kind: 'skill', id: 'killer-skill', unitId: killer.unitId },
    unitId: cat.unitId };
  const result = settleEvents(initial, [death], dispatcher, () => 0.5, new TriggerBudget(20), id => registry.getStatus(id));
  assert.equal(result.state.units[cat.unitId].hp, 20);
  assert.equal(result.state.units[cat.unitId].statuses.some(status => status.statusId === nineLivedCatIds.lives), false);
  assert.equal(result.state.units[killer.unitId].statuses[0].statusId, nineLivedCatIds.revenge);
  assert.equal(result.state.units[killer.unitId].hp, 781, '报复按技能等级对同一目标造成三次73%伤害');
  const orderedTypes = result.events.map(event => event.type);
  assert.ok(orderedTypes.indexOf('unit-revived') < orderedTypes.indexOf('attack-start'));
  const counterHits = result.events.filter(event => event.type === 'damage' && event.source.id === nineLivedCatIds.revengeAttack);
  assert.equal(counterHits.length, 3);
  assert.ok(counterHits.every(event => event.parentEventId));
});

test('九命猫只在暴击时叠加九命且最多四层', () => {
  const registry = new ContentRegistry();
  registerNineLivedCat(registry);
  const initial = state();
  const cat = { ...initial.units['blue-1'], heroId: nineLivedCatIds.hero, skillLevel: 1 };
  initial.units[cat.unitId] = cat;
  const handler = registry.getHero(nineLivedCatIds.hero).handlers.hit.handle;
  let current = initial;
  for (let index = 0; index < 5; index++) {
    const event = { type: 'damage', eventId: `cat-crit-${index}`, phase: 'hit', source: { kind: 'skill', id: nineLivedCatIds.basic, unitId: cat.unitId },
      targetId: 'red-1', amount: 100, hpLost: 100, mitigated: 0, isCritical: true };
    const commands = handler(createBattleContext(current, () => .5), event);
    if (commands?.length) current = applyEffectCommands(current, commands, 'effect-resolution', `cat-stack-${index}`,
      id => registry.getStatus(id)).state;
  }
  assert.equal(current.units[cat.unitId].statuses.find(status => status.statusId === nineLivedCatIds.lives).stacks, 4);
});

test('童男魂之祭献复活并治疗友方、推进行动条后牺牲自身，羽衣按比例封顶减伤', () => {
  const registry = new ContentRegistry();
  registerBoySoulSacrifice(registry);
  const initial = state();
  const boy = { ...initial.units['blue-1'], heroId: boySoulSacrificeIds.hero, skillLevel: 1, hp: 100,
    stats: { ...initial.units['blue-1'].stats, hp: 200 } };
  const fallen = { ...boy, unitId: 'blue-2', heroId: 2, hp: 0, stats: { ...boy.stats, hp: 1000 } };
  const injured = { ...boy, unitId: 'blue-3', heroId: 3, hp: 50, stats: { ...boy.stats, hp: 100 } };
  initial.units[boy.unitId] = boy;
  initial.units[fallen.unitId] = fallen;
  initial.units[injured.unitId] = injured;
  initial.sides.blue = [boy.unitId, fallen.unitId, injured.unitId];
  const policyIntent = registry.getHero(boySoulSacrificeIds.hero).policy(createBattleContext(initial, () => 0.5), boy.unitId);
  assert.equal(policyIntent.skillId, boySoulSacrificeIds.ultimate);
  assert.ok(policyIntent.targetIds.includes(fallen.unitId), '自动策略必须把阵亡队友包括在多目标意图中');
  const result = executeAction(initial, { actorId: boy.unitId, skillId: boySoulSacrificeIds.ultimate,
    targetIds: [boy.unitId, fallen.unitId, injured.unitId], shape: 'multi', targetRelation: 'ally' }, registry, () => 0.5);
  assert.equal(result.accepted, true);
  assert.equal(result.state.units[fallen.unitId].hp, 300);
  assert.equal(result.state.units[fallen.unitId].actionGauge, 30);
  assert.equal(result.state.units[injured.unitId].hp, 80);
  assert.equal(result.state.units[injured.unitId].actionGauge, 30);
  assert.equal(result.state.units[boy.unitId].hp, 0);
  assert.equal(result.state.resources.blue.fire, 1);
  assert.ok(result.events.some(event => event.type === 'unit-revived' && event.unitId === fallen.unitId));
  assert.ok(result.events.some(event => event.type === 'unit-defeated' && event.unitId === boy.unitId));

  const ward = registry.getHero(boySoulSacrificeIds.hero).modifyIncomingDamage;
  const protectedBoy = { ...boy, skillLevel: 5, stats: { ...boy.stats, hp: 1000 } };
  assert.equal(ward(undefined, protectedBoy, 1000, 'normal'), 950, '羽衣减伤受生命上限5%封顶');
  assert.equal(ward(undefined, protectedBoy, 50, 'true'), 30, '小额伤害最多抵挡该次伤害40%');
  assert.equal(registry.getHero(boySoulSacrificeIds.hero).mechanicsCoverage, 'partial');
});

test('童女命之祭献按低血线治疗友方并牺牲当前生命，低于30%时也治疗自身', () => {
  const registry = new ContentRegistry();
  registerLittleGirl(registry);
  const initial = state();
  const girl = { ...initial.units['blue-1'], heroId: littleGirlIds.hero, skillLevel: 1, hp: 100,
    stats: { ...initial.units['blue-1'].stats, hp: 100 } };
  const ally = { ...girl, unitId: 'blue-2', heroId: 2, hp: 40 };
  initial.units[girl.unitId] = girl;
  initial.units[ally.unitId] = ally;
  initial.sides.blue = [girl.unitId, ally.unitId];
  const policy = registry.getHero(littleGirlIds.hero).policy;
  const intent = policy(createBattleContext(initial, () => .5), girl.unitId);
  assert.equal(intent.skillId, littleGirlIds.ultimate);
  assert.deepEqual(intent.targetIds, [ally.unitId]);
  const result = executeAction(initial, intent, registry, () => .5);
  assert.equal(result.state.units[ally.unitId].hp, 50);
  assert.equal(result.state.units[girl.unitId].hp, 70);
  assert.ok(result.state.units[ally.unitId].statuses.some(status => status.statusId === littleGirlIds.lifeProtection));
  assert.equal(result.state.resources.blue.fire, 3);

  const selfCritical = { ...initial, units: { ...initial.units, [girl.unitId]: { ...girl, hp: 25 } } };
  const selfIntent = policy(createBattleContext(selfCritical, () => .5), girl.unitId);
  assert.ok(selfIntent.targetIds.includes(girl.unitId), '低于30%生命时自动技能将童女也纳入治疗目标');
  const selfResult = executeAction(selfCritical, selfIntent, registry, () => .5);
  assert.equal(selfResult.state.units[girl.unitId].hp, 27.5, '先牺牲当前生命的30%，再获得10%最大生命治疗');
  assert.ok(selfResult.state.units[girl.unitId].statuses.some(status => status.statusId === littleGirlIds.lifeProtection));

  const ward = registry.getHero(littleGirlIds.hero).modifyIncomingDamage;
  const maxedGirl = { ...girl, skillLevel: 5, stats: { ...girl.stats, hp: 1000 } };
  assert.equal(ward(undefined, maxedGirl, 1000, 'normal'), 950);
  assert.equal(ward(undefined, maxedGirl, 50, 'true'), 30);
  assert.equal(registry.getHero(littleGirlIds.hero).mechanicsCoverage, 'partial');
});

test('presentation formats structured events in Chinese and reports action-limit outcomes', () => {
  const lines = presentBattleEvents([
    { type: 'action-declared', eventId: 'action', actionId: 4, phase: 'action-selection',
      source: { kind: 'unit', id: 'blue:1', unitId: 'blue:1' },
      intent: { actorId: 'blue:1', skillId: 'test.skill', targetIds: ['red:1'], shape: 'single' } },
    { type: 'resource-changed', eventId: 'payment', actionId: 4, phase: 'resource-payment',
      source: { kind: 'unit', id: 'blue:1', unitId: 'blue:1' }, side: 'blue', resourceId: 'fire', before: 4, after: 2 },
    { type: 'damage', eventId: 'damage', phase: 'hit', source: { kind: 'skill', id: 'basic' }, targetId: 'red:1',
      damageKind: 'true', amount: 12.6, hpLost: 12.6, mitigated: 0, isCritical: false },
    { type: 'action-scheduled', eventId: 'free-action', phase: 'effect-resolution', source: { kind: 'skill', id: 'passive' },
      intent: { actorId: 'blue:1', skillId: 'ultimate', targetIds: ['red:1'], shape: 'single' }, scheduling: 'extra-action', freeCast: true },
    { type: 'battle-ended', eventId: 'end', phase: 'battle-end', source: { kind: 'system', id: 'simulation' },
      winner: 'blue', reason: 'action-limit' },
  ], id => id === 'red:1' ? '红方·目标' : id);
  assert.deepEqual(lines, ['行动 4｜blue:1使用技能「test.skill」。（鬼火 4→2）', '红方·目标受到13点真实伤害。',
    'blue:1获得追加行动（无消耗）。',
    '对局结束：蓝方获胜（达到行动上限后按生命比例判定）。']);
});

test('generic damage separates shield absorption from health loss', () => {
  assert.deepEqual(resolveDamage({ hp: 60, statuses: [] }, 30, 10), {
    amount: 30, shieldAbsorbed: 10, hpLost: 20, hpAfter: 40,
  });
  const result = applyEffectCommands(state(), [{
    type: 'deal-damage', source: { kind: 'unit', id: 'basic', unitId: 'blue-1' }, targetId: 'red-1', amount: 35,
  }], 'hit', 'test');
  assert.equal(result.state.units['red-1'].hp, 35);
  assert.deepEqual(result.events.map(event => [event.type, event.hpLost, event.mitigated, event.actionId, event.attackId, event.hitIndex]), [
    ['damage', 25, 10, 2, 3, 2],
  ]);
});

test('Red Maple basic attack marks targets and reports its action kind', () => {
  const registry = new ContentRegistry();
  registerRedMaple(registry);
  const hero = registry.getHero(redMapleIds.hero);
  const dispatcher = new EventDispatcher();
  for (const [phase, rule] of Object.entries(hero.handlers)) dispatcher.register({ id: `test.red-maple.${phase}`, phase,
    priority: rule.priority, handle: rule.handle });
  const initial = state();
  initial.units['blue-1'].heroId = redMapleIds.hero;
  initial.units['blue-1'].skillLevel = 1;
  initial.units['red-1'].hp = 200;
  const action = executeAction(initial, { actorId: 'blue-1', skillId: redMapleIds.basic, targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' },
    registry, () => .9, { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(action.accepted, true);
  assert.equal(action.events.find(event => event.type === 'attack-start').actionKind, 'basic');
  assert.equal(action.events.find(event => event.type === 'attack-ended').actionKind, 'basic');
  const doll = action.state.units['red-1'].statuses.find(status => status.statusId === redMapleIds.doll);
  assert.equal(doll.values.curseChance, .5);
  assert.equal(doll.values.curseRatio, .18);
  assert.deepEqual(doll.duration, { kind: 'count', remaining: 2, owner: 'target-turn' });
});

test('aggregate modular content registry registers every migrated module with stable IDs', () => {
  const registry = createMigratedContentRegistry();
  for (const heroId of [203, 205, 211, 231, 247, 295, 306, 344, 349, 350, 351, 353, 354, 355, 358, 361, 368, 369, 376, 400, 401, 403, 404, 405, 406, 407, 408, 409, 414, 415, 416, 417, 418, 419, 420, 421, 422, 423, 424, 425, 426, 427, 428, 429, 430, 433, 559, 581, 582, 585, 594, 598]) assert.ok(registry.getHero(heroId), `missing migrated hero ${heroId}`);
  for (const soulId of Object.values(baselineSoulIds)) assert.ok(registry.getSoul(soulId), `missing migrated soul ${soulId}`);
  assert.ok(registry.getStatus(redMapleIds.doll));
  assert.ok(registry.getSoul(fortuneCatIds.soul));
  assert.ok(registry.getSoul(yinMoruoIds.soul));
  assert.ok(registry.getSoul(nirvanaFireIds.soul));
  assert.ok(registry.getSoul(soulBirdIds.soul));
  assert.ok(registry.getStatus(soulBirdIds.damageStatus));
  assert.ok(registry.getStatus(soulSuppressionStatusId));
});

test('Soul Bird heals every living equipped wearer on unit defeat and caps permanent damage at 120 percent', () => {
  const registry = createMigratedContentRegistry();
  const soul = registry.getSoul(soulBirdIds.soul);
  const handler = soul.handlers['unit-defeated'];
  const initial = state();
  const blue = { ...initial.units['blue-1'], soulId: soulBirdIds.soul, hp: 50 };
  const red = { ...initial.units['red-1'], soulId: soulBirdIds.soul, hp: 25 };
  const defeated = { ...initial.units['red-1'], unitId: 'red-dead', hp: 0, unitKind: 'shikigami' };
  const units = { ...initial.units, [blue.unitId]: blue, [red.unitId]: red, [defeated.unitId]: defeated };
  const event = { eventId: 'enemy-defeated', phase: 'unit-defeated', source: { kind: 'skill', id: 'test', unitId: blue.unitId },
    type: 'unit-defeated', unitId: 'red-dead', defeatedBy: { kind: 'skill', id: 'test', unitId: blue.unitId } };
  const commands = handler.handle(createBattleContext({ ...initial, units }, () => .5), event);
  assert.equal(commands.length, 4);
  assert.deepEqual(commands.filter(command => command.type === 'heal').map(command => command.amount), [20, 12]);
  const bonuses = commands.filter(command => command.type === 'add-status').map(command => command.instance.values.damageBonus);
  assert.deepEqual(bonuses, [.2, .2]);
  assert.ok(commands.every(command => command.parentEventId === event.eventId));
  assert.equal(soul.mechanicsCoverage, 'verified');
  assert.equal(soul.modifyOutgoingDamage({ ...blue, statuses: [{ instanceId: 'bird', statusId: soulBirdIds.damageStatus,
    source: { kind: 'soul', id: soulBirdIds.soul, unitId: blue.unitId }, stacks: 1,
    duration: { kind: 'permanent' }, values: { damageBonus: .2 } }] }, red, 100, 'normal'), 120);
  const capped = { ...blue, statuses: [{ instanceId: 'bird-max', statusId: soulBirdIds.damageStatus,
    source: { kind: 'soul', id: soulBirdIds.soul, unitId: blue.unitId }, stacks: 6,
    duration: { kind: 'permanent' }, values: { damageBonus: 1.2 } }] };
  const redCapped = { ...red, statuses: [{ instanceId: 'bird-red-max', statusId: soulBirdIds.damageStatus,
    source: { kind: 'soul', id: soulBirdIds.soul, unitId: red.unitId }, stacks: 6,
    duration: { kind: 'permanent' }, values: { damageBonus: 1.2 } }] };
  const atCap = handler.handle(createBattleContext({ ...initial, units: { ...units, [blue.unitId]: capped, [red.unitId]: redCapped } }, () => .5), event);
  assert.deepEqual(atCap.filter(command => command.type === 'add-status'), []);
  assert.equal(soulBirdDamageBonus(capped), 1.2);

  const monster = { ...defeated, unitId: 'monster-1', unitKind: 'monster' };
  const monsterDeath = handler.handle(createBattleContext({ ...initial, units: { ...units, [monster.unitId]: monster } }, () => .5),
    { ...event, unitId: monster.unitId });
  assert.equal(monsterDeath, undefined);
  const summon = { ...defeated, unitId: 'summon-1', unitKind: 'summon' };
  const summonDeath = handler.handle(createBattleContext({ ...initial, units: { ...units, [summon.unitId]: summon } }, () => .5),
    { ...event, unitId: summon.unitId });
  assert.equal(summonDeath.filter(command => command.type === 'heal').length, 2);
});

test('Nirvana Fire restores 15 percent after an action below 30 percent and respects skill and soul suppression', () => {
  const registry = createMigratedContentRegistry();
  const handler = registry.getSoul(nirvanaFireIds.soul).handlers['action-end'];
  const initial = state();
  const wearer = { ...initial.units['blue-1'], soulId: nirvanaFireIds.soul, hp: 29 };
  const units = { ...initial.units, [wearer.unitId]: wearer };
  const event = { eventId: 'action-end', phase: 'action-end', source: { kind: 'skill', id: 'test.skill', unitId: wearer.unitId },
    actionId: 1, type: 'action-ended', skillId: 'test.skill', actionKind: 'skill', soulTriggersAllowed: true };
  const healing = handler.handle(createBattleContext({ ...initial, units }, () => .5), event);
  assert.equal(healing[0].type, 'restore-health');
  assert.equal(healing[0].amount, 15);
  assert.equal(healing[0].parentEventId, event.eventId);
  assert.equal(handler.handle(createBattleContext({ ...initial, units: { ...units, [wearer.unitId]: { ...wearer, hp: 30 } } }, () => .5), event), undefined);
  assert.equal(handler.handle(createBattleContext({ ...initial, units }, () => .5), { ...event, soulTriggersAllowed: false }), undefined);
  const sealed = { ...wearer, statuses: [{ instanceId: 'seal', statusId: soulSuppressionStatusId,
    source: { kind: 'system', id: 'test' }, stacks: 1, duration: { kind: 'permanent' } }] };
  assert.equal(handler.handle(createBattleContext({ ...initial, units: { ...units, [wearer.unitId]: sealed } }, () => .5), event), undefined);
  assert.equal(registry.getSoul(nirvanaFireIds.soul).mechanicsCoverage, 'verified');

  const noOp = { id: 'test.no-op', actionKind: 'skill', target: 'self', targetRelation: 'ally', levels: [{}],
    execute() { return []; } };
  const suppressedNoOp = { ...noOp, id: 'test.suppressed-no-op', suppressSoulTriggers: true };
  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [noOp, suppressedNoOp] });
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'soul:nirvana-fire:action-end', phase: 'action-end', priority: 30, handle: handler.handle });
  const ran = executeAction({ ...initial, units }, { actorId: wearer.unitId, skillId: noOp.id, targetIds: [wearer.unitId],
    shape: 'self', targetRelation: 'ally' }, registry, () => .5, { dispatcher, modifyHealing: () => 0 });
  assert.equal(ran.state.units[wearer.unitId].hp, 44);
  assert.ok(ran.events.some(item => item.type === 'action-ended' && item.phase === 'action-end'));
  assert.ok(ran.events.some(item => item.type === 'health-restored' && item.hpGained === 15));
  const suppressedRun = executeAction({ ...initial, units }, { actorId: wearer.unitId, skillId: suppressedNoOp.id,
    targetIds: [wearer.unitId], shape: 'self', targetRelation: 'ally' }, registry, () => .5, { dispatcher });
  assert.equal(suppressedRun.state.units[wearer.unitId].hp, 29);
  assert.equal(suppressedRun.events.find(item => item.type === 'action-ended').soulTriggersAllowed, false);
});

test("Yin Moruo returns fire only for its wearer's enemy defeat and respects the resource cap and soul seal", () => {
  const registry = new ContentRegistry();
  registerYinMoruo(registry);
  const handler = registry.getSoul(yinMoruoIds.soul).handlers['unit-defeated'];
  const initial = state();
  const wearer = { ...initial.units['blue-1'], soulId: yinMoruoIds.soul };
  const units = { ...initial.units, [wearer.unitId]: wearer };
  const event = { eventId: 'defeat', phase: 'unit-defeated', source: { kind: 'unit', id: '1', unitId: wearer.unitId },
    type: 'unit-defeated', unitId: 'red-1', defeatedBy: { kind: 'unit', id: '1', unitId: wearer.unitId } };
  const fire = handler.handle(createBattleContext({ ...initial, units }, () => .5), event);
  assert.equal(fire[0].amount, 3);
  assert.equal(fire[0].parentEventId, event.eventId);

  const capped = { ...initial, resources: { ...initial.resources, blue: { ...initial.resources.blue, fire: 7 } } };
  assert.equal(handler.handle(createBattleContext({ ...capped, units }, () => .5), event)[0].amount, 1);

  const allyDefeat = { ...event, unitId: 'blue-1' };
  assert.equal(handler.handle(createBattleContext({ ...initial, units }, () => .5), allyDefeat), undefined);
  const sealed = { ...wearer, statuses: [{ instanceId: 'seal', statusId: soulSuppressionStatusId,
    source: { kind: 'system', id: 'test' }, stacks: 1, duration: { kind: 'permanent' } }] };
  assert.equal(handler.handle(createBattleContext({ ...initial, units: { ...units, [wearer.unitId]: sealed } }, () => .5), event), undefined);
  assert.equal(registry.getSoul(yinMoruoIds.soul).mechanicsCoverage, 'verified');
});

test('Zhaocai Cat grants capped team fire at turn start and respects soul suppression', () => {
  const registry = new ContentRegistry();
  registerFortuneCat(registry);
  const handler = registry.getSoul(fortuneCatIds.soul).handlers['turn-start'];
  const battle = state();
  const wearer = { ...battle.units['blue-1'], soulId: fortuneCatIds.soul };
  const context = createBattleContext({ ...battle, units: { ...battle.units, [wearer.unitId]: wearer } }, () => .1);
  const event = { eventId: 'turn-start', phase: 'turn-start', source: { kind: 'unit', id: String(wearer.heroId), unitId: wearer.unitId },
    actionId: 1, type: 'turn-started', unitId: wearer.unitId };
  const gained = handler.handle(context, event);
  assert.equal(gained[0].amount, 2);
  assert.equal(gained[0].parentEventId, event.eventId);

  const cappedState = { ...context.state, resources: { ...context.state.resources, blue: { ...context.state.resources.blue, fire: 7 } } };
  const capped = handler.handle(createBattleContext(cappedState, () => .1), event);
  assert.equal(capped[0].amount, 1);

  const sealedWearer = { ...wearer, statuses: [{ instanceId: 'seal', statusId: soulSuppressionStatusId,
    source: { kind: 'system', id: 'test' }, stacks: 1, duration: { kind: 'permanent' } }] };
  const sealedState = { ...cappedState, units: { ...cappedState.units, [wearer.unitId]: sealedWearer } };
  assert.equal(handler.handle(createBattleContext(sealedState, () => .1), event), undefined);
  assert.equal(registry.getSoul(fortuneCatIds.soul).mechanicsCoverage, 'verified');
});

test('海月火玉技能有余量时额外支付1点鬼火并提高40%伤害，否则不触发', () => {
  const registry = new ContentRegistry();
  registerSeaMoonFireJade(registry);
  const initial = state();
  const actor = { ...initial.units['blue-1'], soulId: seaMoonFireJadeIds.soul };
  const skill = { id: 'test.paid-skill', actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single', levels: [{}], execute: () => [] };
  const resolve = registry.getSoul(seaMoonFireJadeIds.soul).resolveActionAdjustment;
  assert.deepEqual(resolve(initial, actor, skill), { additionalResourceCost: { resourceId: 'fire', amount: 1 },
    damageMultiplier: 1.4, label: '额外消耗1点资源，本次技能伤害提高40%' });
  const insufficient = { ...initial, resources: { ...initial.resources, blue: { ...initial.resources.blue, fire: 2 } } };
  assert.equal(resolve(insufficient, actor, skill), undefined);
  assert.equal(resolve(initial, actor, { ...skill, actionKind: 'basic' }), undefined,
    '海月火玉只强化妖术，带费用的普攻不触发额外支付和增伤');
  assert.equal(registry.getSoul(seaMoonFireJadeIds.soul).mechanicsCoverage, 'verified');
});

test('modular facade simulates partial rosters with diagnostics and reproduces sample N directly', () => {
  const panel = { hp: 700, attack: 160, defense: 40, speed: 120, crit: 0, critDamage: 1.5, hit: 0, resist: 0 };
  const input = { blue: [{ heroId: moonChaserIds.hero, fourSuit: '', skillLevel: 5, panel }],
    red: [{ heroId: moonChaserIds.hero, fourSuit: '', skillLevel: 5, panel }] };
  const batch = simulateBattle(input, 3, 2);
  assert.equal(batch.engine, 'modular');
  assert.ok(batch.diagnostics.every(item => item.status === 'verified'));
  assert.equal(batch.sampleReason, batch.sampleResult.reason);
  assert.equal(Object.values(batch.terminationCounts).reduce((sum, count) => sum + count, 0), 3);
  assert.equal(batch.sampleResult.ruleVersion, 'game-fidelity-v2');
  assert.equal(batch.sampleResult.seed, deriveSampleSeed(batch.seed, 2, 'game-fidelity-v2'));
  assert.deepEqual(batch.sampleLog, require('../dist-test-renderer/renderer/features/duel/engine/battle-engine.js').simulateBattleSample(input, 2));
  const directSample = simulateBattleSampleDetails(input, 2);
  assert.equal(directSample.sampleReason, batch.sampleResult.reason);
  assert.deepEqual(directSample.sampleLog, batch.sampleLog);
  assert.equal(batch.blueRate + batch.redRate + batch.drawRate, 1);

  const incomplete = simulateBattle({ blue: [{ heroId: moonChaserIds.hero, fourSuit: '300057', skillLevel: 5, panel }],
    red: [{ heroId: moonChaserIds.hero, fourSuit: '', skillLevel: 5, panel }] }, 1, 0);
  assert.equal(incomplete.engine, 'modular');
  assert.ok(incomplete.diagnostics.some(item => item.status !== 'verified'));
  assert.ok(incomplete.sampleResult);
});

test('modular results identify the 600-action cutoff', () => {
  const panel = { hp: 1e6, attack: 1, defense: 1e9, speed: 100, crit: 0, critDamage: 1.5, hit: 0, resist: 0 };
  const result = simulateBattle({ blue: [{ heroId: 203, fourSuit: '', skillLevel: 1, panel }],
    red: [{ heroId: 203, fourSuit: '', skillLevel: 1, panel }] }, 1, 0);
  assert.equal(result.engine, 'modular');
  assert.equal(result.sampleReason, 'action-limit');
  assert.equal(result.terminationCounts.actionLimit, 1);
  assert.match(result.sampleLog.at(-1), /对局结束/);
  assert.equal(simulateBattleSampleDetails({ blue: [{ heroId: 203, fourSuit: '', skillLevel: 1, panel }],
    red: [{ heroId: 203, fourSuit: '', skillLevel: 1, panel }] }, 0).sampleReason, 'action-limit');
});

test('progressive modular batches report completed samples, match the sync facade, and stop at chunk boundaries', async () => {
  const panel = { hp: 700, attack: 160, defense: 40, speed: 120, crit: 0, critDamage: 1.5, hit: 0, resist: 0 };
  const input = { blue: [{ heroId: moonChaserIds.hero, fourSuit: '', skillLevel: 5, panel }],
    red: [{ heroId: moonChaserIds.hero, fourSuit: '', skillLevel: 5, panel }] };
  const sync = simulateBattle(input, 4, 0);
  const progress = [];
  const progressive = await simulateBattleProgressive(input, 4, 0, (completed, total, engine) => progress.push({ completed, total, engine }), () => false, 2);
  assert.deepEqual(progress, [{ completed: 2, total: 4, engine: 'modular' }, { completed: 4, total: 4, engine: 'modular' }]);
  assert.deepEqual(progressive, sync);

  let cancelled = false;
  const stopped = await simulateBattleProgressive(input, 100, 0, () => { cancelled = true; }, () => cancelled, 1);
  assert.equal(stopped, undefined);
});

test('Red Maple mark explodes once across the defeated side and links damage to the defeat event', () => {
  const registry = new ContentRegistry();
  registerRedMaple(registry);
  const hero = registry.getHero(redMapleIds.hero);
  const dispatcher = new EventDispatcher();
  for (const [phase, rule] of Object.entries(hero.handlers)) dispatcher.register({ id: `test.red-maple.${phase}`, phase,
    priority: rule.priority, handle: rule.handle });
  const initial = state();
  const marked = { ...initial.units['red-1'], hp: 0, statuses: [{ instanceId: 'doll:red', statusId: redMapleIds.doll,
    source: { kind: 'skill', id: redMapleIds.passive, unitId: 'blue-1' }, stacks: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, values: { attack: 100, explosionRatio: .42 } }] };
  const redAlly = { ...marked, unitId: 'red-2', hp: 100, statuses: [] };
  initial.units['blue-1'].heroId = redMapleIds.hero;
  initial.units['red-1'] = marked;
  initial.units['red-2'] = redAlly;
  initial.sides.red.push('red-2');
  const result = settleEvents(initial, [{ eventId: 'red-death', phase: 'unit-defeated', source: { kind: 'skill', id: 'test' },
    type: 'unit-defeated', unitId: 'red-1' }], dispatcher, () => .5, new TriggerBudget(32), id => registry.getStatus(id));
  assert.equal(result.state.units['red-2'].hp, 68);
  assert.equal(result.state.units['red-1'].statuses.some(status => status.statusId === redMapleIds.doll), false);
  const explosion = result.events.find(event => event.type === 'damage' && event.targetId === 'red-2');
  assert.equal(explosion.damageKind, 'true');
  assert.equal(explosion.source.id, redMapleIds.passive);
  assert.equal(explosion.parentEventId, 'red-death');
});

test('level-five Red Maple mark can deduct one additional fire after a paid enemy skill', () => {
  const registry = new ContentRegistry();
  registerRedMaple(registry);
  registry.registerHero({ id: 2, skills: [{ id: 'test.paid-skill', actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'self', targetRelation: 'ally', levels: [{}], execute: () => [] }] });
  const maple = registry.getHero(redMapleIds.hero);
  const dispatcher = new EventDispatcher();
  for (const [phase, rule] of Object.entries(maple.handlers)) dispatcher.register({ id: `test.red-maple.${phase}`, phase,
    priority: rule.priority, handle: rule.handle });
  const initial = state();
  initial.units['blue-1'].heroId = redMapleIds.hero;
  initial.units['blue-1'].skillLevel = 5;
  initial.units['blue-1'].statuses = [{ instanceId: 'doll:blue', statusId: redMapleIds.doll,
    source: { kind: 'skill', id: redMapleIds.passive, unitId: 'red-maple-owner' }, stacks: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, values: {} }];
  initial.units['red-1'].heroId = 2;
  const result = executeAction(initial, { actorId: 'red-1', skillId: 'test.paid-skill', targetIds: ['red-1'], shape: 'self', targetRelation: 'ally' },
    registry, () => .1, { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(result.accepted, true);
  assert.equal(result.state.resources.red.fire, 1);
  assert.deepEqual(result.events.filter(event => event.type === 'resource-changed').map(event => [event.before, event.after]), [[4, 2], [2, 1]]);
});

test('Zashiki opening fire and life conversion use explicit level parameters and linked resource events', () => {
  const registry = new ContentRegistry();
  registerZashiki(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: zashikiIds.hero, skillLevel: 3, hp: 700,
    stats: { ...initial.units['blue-1'].stats, hp: 700 } };
  const context = createBattleContext(initial, () => .5);
  const opening = registry.getHero(zashikiIds.hero).initialize(context, 'blue-1');
  const opened = applyEffectCommands(initial, opening, 'effect-resolution', 'zashiki-opening');
  assert.equal(opened.state.resources.blue.fire, 7);
  const action = executeAction(opened.state, { actorId: 'blue-1', skillId: zashikiIds.offering, targetIds: ['blue-1'],
    shape: 'self', targetRelation: 'ally' }, registry, () => .5);
  assert.equal(action.accepted, true);
  assert.equal(action.state.units['blue-1'].hp, 560);
  assert.equal(action.state.resources.blue.fire, 8);
  assert.equal(action.events.find(event => event.type === 'life-lost').hpLost, 140);
  assert.ok(action.events.some(event => event.type === 'resource-changed' && event.after === 8));
});

test('Zashiki basic passive gains one fire at its attack-end window and verified rosters select modular simulation', () => {
  const registry = new ContentRegistry();
  registerZashiki(registry);
  const hero = registry.getHero(zashikiIds.hero);
  const dispatcher = new EventDispatcher();
  for (const [phase, rule] of Object.entries(hero.handlers)) dispatcher.register({ id: `test.zashiki.${phase}`, phase,
    priority: rule.priority, handle: rule.handle });
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: zashikiIds.hero, hp: 1000,
    stats: { ...initial.units['blue-1'].stats, hp: 1000, attack: 50 } };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 1000, stats: { ...initial.units['red-1'].stats, hp: 1000 } };
  // Dodge, critical, native skill fluctuation, then the fire passive.
  const values = [.9, .9, .9, .1];
  const action = executeAction(initial, { actorId: 'blue-1', skillId: zashikiIds.basic, targetIds: ['red-1'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => values.shift() ?? .9, { dispatcher });
  assert.equal(action.state.resources.blue.fire, 5);
  assert.ok(action.events.some(event => event.type === 'resource-changed' && event.source.id === zashikiIds.passive
    && event.parentEventId === action.events.find(item => item.type === 'attack-ended').eventId));

  const sealed = { ...initial, units: { ...initial.units, 'blue-1': { ...initial.units['blue-1'], statuses: [{ instanceId: 'passive-seal',
    statusId: passiveSuppressionStatusId, source: { kind: 'status', id: passiveSuppressionStatusId }, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }] } } };
  const suppressed = executeAction(sealed, { actorId: 'blue-1', skillId: zashikiIds.basic, targetIds: ['red-1'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => values.shift() ?? .1, { dispatcher });
  assert.equal(suppressed.state.resources.blue.fire, 4);

  const panel = { hp: 700, attack: 120, defense: 50, speed: 100, crit: 0, critDamage: 1.5, hit: 0, resist: 0 };
  const input = { blue: [{ heroId: zashikiIds.hero, fourSuit: '', skillLevel: 5, panel }],
    red: [{ heroId: zashikiIds.hero, fourSuit: '', skillLevel: 5, panel }] };
  const modular = simulateBattle(input, 1, 0);
  assert.equal(modular.sampleResult.ruleVersion, 'game-fidelity-v2');
  assert.ok(modular.sampleLog.length > 0);
});

test('Lantern Ghost fire passive uses the skill-level chance, obeys passive suppression, and reports partial coverage', () => {
  const registry = new ContentRegistry();
  registerLanternGhost(registry);
  const hero = registry.getHero(lanternGhostIds.hero);
  const rule = hero.handlers.hit;
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: lanternGhostIds.hero, skillLevel: 3 };
  const hit = { eventId: 'incoming-hit', phase: 'hit', source: { kind: 'skill', id: 'test.attack', unitId: 'red-1' },
    attackId: 4, hitIndex: 1, type: 'damage', targetId: 'blue-1', damageKind: 'normal', amount: 20, hpLost: 20, mitigated: 0, isCritical: false };
  const context = createBattleContext(initial, () => .29);
  const commands = rule.handle(context, hit);
  const gained = applyEffectCommands(initial, commands, 'effect-resolution', 'lantern-fire');
  assert.equal(gained.state.resources.blue.fire, 5);
  assert.equal(gained.events[0].source.id, lanternGhostIds.passive);
  assert.equal(gained.events[0].parentEventId, hit.eventId);
  assert.equal(hero.mechanicsCoverage, 'partial');

  initial.units['blue-1'] = { ...initial.units['blue-1'], statuses: [{ instanceId: 'seal', statusId: passiveSuppressionStatusId,
    source: { kind: 'status', id: passiveSuppressionStatusId }, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }] };
  const sealedContext = createBattleContext(initial, () => .01);
  assert.equal(rule.handle(sealedContext, hit), undefined);
});

test('Lantern Ghost Big Lantern Cage applies typed critical modifiers and AI avoids repeating an active cage', () => {
  const registry = new ContentRegistry();
  registerLanternGhost(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: lanternGhostIds.hero, skillLevel: 4, stats: { ...initial.units['blue-1'].stats, crit: .1 } };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 1, statuses: [] };
  initial.sides.blue = ['blue-1', 'blue-2'];
  const intent = registry.getHero(lanternGhostIds.hero).policy(createBattleContext(initial, () => .5), 'blue-1');
  assert.equal(intent.skillId, lanternGhostIds.skill);
  const result = executeAction(initial, intent, registry, () => .5);
  assert.equal(result.accepted, true);
  for (const unitId of ['blue-1', 'blue-2']) {
    const cage = result.state.units[unitId].statuses.find(status => status.statusId === lanternGhostIds.cage);
    assert.equal(cage.values.critBonus, .2);
    assert.equal(cage.duration.remaining, 3);
    assert.ok(Math.abs(createBattleContext(result.state, () => .5).getEffectiveStats(unitId).crit
      - .3) < 1e-9);
  }
  const nextIntent = registry.getHero(lanternGhostIds.hero).policy(createBattleContext(result.state, () => .5), 'blue-1');
  assert.equal(nextIntent.skillId, lanternGhostIds.basic);
});

test('Soul Reaper kill schedules a typed extra turn that resolves the two-hit Soul Pursuit', () => {
  const registry = new ContentRegistry();
  registerSoulReaper(registry);
  const initial = state();
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: soulReaperIds.hero, skillLevel: 5, hp: 1000,
    stats: { ...initial.units['blue-1'].stats, hp: 1000, attack: 2000, speed: 300, crit: 0 } };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 100, stats: { ...initial.units['red-1'].stats, hp: 1000, defense: 0, speed: 1 } };
  initial.units['red-2'] = { ...initial.units['red-1'], unitId: 'red-2', hp: 10000,
    stats: { ...initial.units['red-1'].stats, hp: 10000 } };
  initial.sides = { blue: ['blue-1'], red: ['red-1', 'red-2'] };
  const result = runBattle(initial, registry, { seed: 12, actionLimit: 2 });
  assert.ok(result.events.some(event => event.type === 'action-scheduled' && event.scheduling === 'extra-turn'
    && event.intent.skillId === soulReaperIds.pursuit && event.intent.kind === 'passive'));
  const pursuitEnd = result.events.find(event => event.type === 'attack-ended' && event.source.id === soulReaperIds.pursuit);
  assert.equal(pursuitEnd.hitCount, 2);
  assert.equal(pursuitEnd.actionKind, 'passive');
  assert.equal(result.events.filter(event => event.type === 'damage' && event.source.id === soulReaperIds.pursuit).length, 2);
  assert.equal(result.diagnostics.find(item => item.contentId === String(soulReaperIds.hero) && item.aspect === 'mechanics').status, 'partial');
});

test('Soul Reaper schedules one passive extra turn for each enemy defeated by one AoE', () => {
  const registry = new ContentRegistry();
  registerSoulReaper(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: soulReaperIds.hero, skillLevel: 5,
    stats: { ...initial.units['blue-1'].stats, attack: 5000, crit: 0 } };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 1, stats: { ...initial.units['red-1'].stats, hp: 1000 } };
  initial.units['red-2'] = { ...initial.units['red-1'], unitId: 'red-2', hp: 1 };
  initial.units['red-3'] = { ...initial.units['red-1'], unitId: 'red-3', hp: 100000,
    stats: { ...initial.units['red-1'].stats, hp: 100000 } };
  initial.sides = { blue: ['blue-1'], red: ['red-1', 'red-2', 'red-3'] };
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: `hero:${soulReaperIds.hero}:unit-defeated`, phase: 'unit-defeated', priority: 30,
    handle: registry.getHero(soulReaperIds.hero).handlers['unit-defeated'].handle });
  const result = executeAction(initial, { actorId: 'blue-1', skillId: soulReaperIds.ultimate,
    targetIds: initial.sides.red, shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .9,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });
  const defeats = result.events.filter(event => event.type === 'unit-defeated' && event.defeatedBy?.unitId === 'blue-1');
  const extraTurns = result.events.filter(event => event.type === 'action-scheduled' && event.scheduling === 'extra-turn'
    && event.intent.skillId === soulReaperIds.pursuit);
  assert.equal(defeats.length, 2);
  assert.equal(extraTurns.length, 2);
});

test('姑获鸟伞剑与天翔鹤斩按客户端倍率、破防、段数和鬼火结算', () => {
  const registry = new ContentRegistry();
  registerUbume(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: ubumeIds.hero, skillLevel: 2,
    stats: { ...initial.units['blue-1'].stats, attack: 1000, crit: 0 } };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 100000, shield: 0,
    stats: { ...initial.units['red-1'].stats, hp: 100000, defense: 1000 } };
  initial.units['red-2'] = { ...initial.units['red-1'], unitId: 'red-2' };
  initial.sides.red = ['red-1', 'red-2'];
  const basic = executeAction(initial, { actorId: 'blue-1', skillId: ubumeIds.basic,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => .9);
  assert.equal(basic.events.filter(event => event.type === 'damage').length, 1);
  const basicDamage = basic.events.find(event => event.type === 'damage').amount;
  const withoutSkillPenetration = createBattleContext(initial, () => .9).calculateDamage({ attack: 1000, defense: 1000,
    defenseIgnore: 0, ratio: .84, critChance: 0, critDamage: 1.5 }, initial.units['blue-1'], initial.units['red-1']).amount;
  assert.ok(basicDamage > withoutSkillPenetration, '伞剑必须实际无视一部分防御');

  const ultimate = executeAction(initial, { actorId: 'blue-1', skillId: ubumeIds.ultimate,
    targetIds: ['red-1', 'red-2'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .9);
  assert.equal(ultimate.accepted, true);
  assert.equal(ultimate.state.resources.blue.fire, 1);
  const hits = ultimate.events.filter(event => event.type === 'damage');
  assert.equal(hits.filter(event => event.targetId === 'red-1').length, 4);
  assert.equal(hits.filter(event => event.targetId === 'red-2').length, 3);
});

test('姑获鸟最高攻击被动提供增伤并把队友普攻协战率提升至60%', () => {
  const registry = new ContentRegistry();
  registerUbume(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: ubumeIds.hero,
    stats: { ...initial.units['blue-1'].stats, attack: 200 } };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 1,
    stats: { ...initial.units['blue-1'].stats, attack: 100 } };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 10000, shield: 0,
    stats: { ...initial.units['red-1'].stats, hp: 10000 } };
  initial.sides.blue = ['blue-1', 'blue-2'];
  const hero = registry.getHero(ubumeIds.hero);
  const buffCommands = hero.initialize(createBattleContext(initial, () => .5), 'blue-1');
  assert.equal(buffCommands[0].instance.values.assistChance, .6);
  const buffed = applyEffectCommands(initial, buffCommands, 'initialization', 'ubume-passive', id => registry.getStatus(id)).state;
  assert.equal(effectiveDamageMultiplier(buffed.units['blue-1']), 2);

  registry.registerHero({ id: 1, skills: [createBasicAttackSkill('test-basic', [1])] });
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: `hero:${ubumeIds.hero}:attack-end`, phase: 'attack-end', priority: 31,
    handle: hero.handlers['attack-end'].handle });
  const alliedBasic = executeAction(buffed, { actorId: 'blue-2', skillId: 'test-basic', targetIds: ['red-1'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .5,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });
  const assist = alliedBasic.events.find(event => event.type === 'action-scheduled' && event.scheduling === 'assist');
  assert.equal(assist.intent.actorId, 'blue-1');
  assert.equal(assist.intent.skillId, ubumeIds.basic);
  assert.equal(assist.intent.kind, 'passive');
});

test('二口女初始获得4枚子弹，最多6枚，友方行动后按觉醒概率补充', () => {
  const registry = new ContentRegistry();
  registerTwoMouthGirl(registry);
  const hero = registry.getHero(twoMouthGirlIds.hero);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: twoMouthGirlIds.hero, awakeFilter: 0 };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 1, awakeFilter: undefined };
  initial.sides.blue = ['blue-1', 'blue-2'];
  const initialize = applyEffectCommands(initial, hero.initialize(createBattleContext(initial, () => .5), 'blue-1'),
    'initialization', 'two-mouth-init', id => registry.getStatus(id));
  const bullets = () => initialize.state.units['blue-1'].statuses.find(status => status.statusId === twoMouthGirlIds.bulletStatus)?.stacks;
  assert.equal(bullets(), 4);

  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: `hero:${twoMouthGirlIds.hero}:action-end`, phase: 'action-end', priority: 30,
    handle: hero.handlers['action-end'].handle });
  const allyEnded = { eventId: 'ally-basic-ended', phase: 'action-end', source: { kind: 'skill', id: 'ally-basic', unitId: 'blue-2' },
    actionId: 1, type: 'action-ended', actionKind: 'basic', skillId: 'ally-basic', soulTriggersAllowed: true };
  const unawakened = settleEvents(initialize.state, [allyEnded], dispatcher, () => .3, new TriggerBudget(64),
    id => registry.getStatus(id));
  assert.equal(unawakened.state.units['blue-1'].statuses.find(status => status.statusId === twoMouthGirlIds.bulletStatus).stacks, 5);

  const awakeGirl = { ...unawakened.state.units['blue-1'], awakeFilter: 1,
    statuses: unawakened.state.units['blue-1'].statuses.map(status => status.statusId === twoMouthGirlIds.bulletStatus
      ? { ...status, stacks: 5 } : status) };
  const cappedState = { ...unawakened.state, units: { ...unawakened.state.units, 'blue-1': awakeGirl } };
  const awakened = settleEvents(cappedState, [{ ...allyEnded, eventId: 'ally-basic-ended-awake' }], dispatcher, () => .5,
    new TriggerBudget(64), id => registry.getStatus(id));
  assert.equal(awakened.state.units['blue-1'].statuses.find(status => status.statusId === twoMouthGirlIds.bulletStatus).stacks, 6);
  const atCap = settleEvents(awakened.state, [{ ...allyEnded, eventId: 'ally-basic-ended-cap' }], dispatcher, () => 0,
    new TriggerBudget(64), id => registry.getStatus(id));
  assert.equal(atCap.state.units['blue-1'].statuses.find(status => status.statusId === twoMouthGirlIds.bulletStatus).stacks, 6);
});

test('二口女歉意支付3火，消耗子弹并按每枚印记增加一发随机攻击', () => {
  const registry = new ContentRegistry();
  registerTwoMouthGirl(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: twoMouthGirlIds.hero, skillLevel: 2 };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 100000, shield: 0,
    stats: { ...initial.units['red-1'].stats, hp: 100000 } };
  initial.units['red-2'] = { ...initial.units['red-1'], unitId: 'red-2' };
  initial.sides.red = ['red-1', 'red-2'];
  const initialized = applyEffectCommands(initial, registry.getHero(twoMouthGirlIds.hero)
    .initialize(createBattleContext(initial, () => .5), 'blue-1'), 'initialization', 'two-mouth-init',
  id => registry.getStatus(id)).state;
  const result = executeAction(initialized, { actorId: 'blue-1', skillId: twoMouthGirlIds.ultimate,
    targetIds: ['red-1', 'red-2'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .1);
  assert.equal(result.accepted, true);
  assert.equal(result.state.resources.blue.fire, 1);
  assert.equal(result.events.filter(event => event.type === 'damage' && event.source.id === twoMouthGirlIds.ultimate).length, 6);
  assert.equal(result.state.units['blue-1'].statuses.some(status => status.statusId === twoMouthGirlIds.bulletStatus), false);
});

test('青行灯幽光与吸魂灯按目标逐次转移鬼火，并按最终鬼火差对非怪物结算真实伤害', () => {
  const registry = new ContentRegistry();
  registerLanternSpirit(registry);
  const hero = registry.getHero(lanternSpiritIds.hero);
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: `hero:${lanternSpiritIds.hero}:attack-end`, phase: 'attack-end', priority: 28,
    handle: hero.handlers['attack-end'].handle });
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: lanternSpiritIds.hero, skillLevel: 2,
    stats: { ...initial.units['blue-1'].stats, attack: 1000 } };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 10000, shield: 0,
    stats: { ...initial.units['red-1'].stats, hp: 10000 } };
  const basic = executeAction(initial, { actorId: 'blue-1', skillId: lanternSpiritIds.basic,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => 0,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(basic.state.resources.blue.fire, 5);
  assert.equal(basic.state.resources.red.fire, 3);

  const volleyState = state();
  volleyState.units['blue-1'] = { ...volleyState.units['blue-1'], heroId: lanternSpiritIds.hero, skillLevel: 2,
    stats: { ...volleyState.units['blue-1'].stats, attack: 1000 } };
  volleyState.units['red-1'] = { ...volleyState.units['red-1'], hp: 10000, shield: 0,
    stats: { ...volleyState.units['red-1'].stats, hp: 1000 } };
  volleyState.units['red-2'] = { ...volleyState.units['red-1'], unitId: 'red-2', hp: 10000,
    stats: { ...volleyState.units['red-1'].stats, hp: 1000 } };
  volleyState.sides.red = ['red-1', 'red-2'];
  const ultimate = executeAction(volleyState, { actorId: 'blue-1', skillId: lanternSpiritIds.ultimate,
    targetIds: ['red-1', 'red-2'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => 0,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(ultimate.state.resources.blue.fire, 3);
  assert.equal(ultimate.state.resources.red.fire, 2);
  const trueHits = ultimate.events.filter(event => event.type === 'damage' && event.source.id === lanternSpiritIds.ultimate
    && event.damageKind === 'true');
  assert.deepEqual(trueHits.map(event => [event.targetId, event.amount]), [['red-1', 50], ['red-2', 50]]);
});

test('青行灯明灯在友方回合开始时按技能等级触发，令该回合技能免火并按现有鬼火增伤', () => {
  const registry = new ContentRegistry();
  registerLanternSpirit(registry);
  registry.registerHero({ id: 1, skills: [{ id: 'test-paid-skill', actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 3 },
    target: 'single', targetRelation: 'enemy', levels: [{ ratio: 1 }],
    execute(context, intent) { return [{ type: 'deal-damage', source: { kind: 'skill', id: 'test-paid-skill', unitId: intent.actorId },
      targetId: intent.targetIds[0], amount: 100 }]; } }] });
  const lantern = registry.getHero(lanternSpiritIds.hero);
  const dispatcher = new EventDispatcher();
  for (const phase of ['turn-start', 'attack-end', 'action-end', 'unit-defeated']) dispatcher.register({
    id: `hero:${lanternSpiritIds.hero}:${phase}`, phase, priority: 28, handle: lantern.handlers[phase].handle });
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: lanternSpiritIds.hero, skillLevel: 1 };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 1 };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 1000, shield: 0,
    stats: { ...initial.units['red-1'].stats, hp: 1000 } };
  initial.sides.blue = ['blue-1', 'blue-2'];
  const started = settleEvents(initial, [{ eventId: 'ally-turn-start', phase: 'turn-start',
    source: { kind: 'system', id: 'test' }, type: 'turn-started', unitId: 'blue-2' }], dispatcher, () => 0,
  new TriggerBudget(64), id => registry.getStatus(id));
  const light = started.state.units['blue-2'].statuses.find(status => status.statusId === lanternSpiritIds.lanternLight);
  assert.ok(light);
  assert.equal(light.modifiers[0].amount, .2);
  const cast = executeAction(started.state, { actorId: 'blue-2', skillId: 'test-paid-skill', targetIds: ['red-1'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .5,
  { dispatcher, resolveStatus: id => registry.getStatus(id), modifyDamage: (attacker, _target, amount) =>
    attacker ? amount * effectiveDamageMultiplier(attacker) : amount });
  assert.equal(cast.accepted, true);
  assert.equal(cast.state.resources.blue.fire, 4);
  assert.ok(cast.events.find(event => event.type === 'damage').amount > 100);
  assert.equal(cast.state.units['blue-2'].statuses.some(status => status.statusId === lanternSpiritIds.lanternLight), false);
});

test('白狼无我读取等级倍率、暴击加成和行动条击退，并在击退至末端时增伤回气', () => {
  const registry = new ContentRegistry();
  registerWhiteWolf(registry);
  const definition = registry.getHero(whiteWolfIds.hero);
  const skill = definition.skills.find(item => item.id === whiteWolfIds.ultimate);
  assert.equal(skill.resourceCost.amount, 3);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: whiteWolfIds.hero, skillLevel: 2, awakeFilter: 1,
    stats: { ...initial.units['blue-1'].stats, hp: 1000, attack: 100, defense: 0, crit: 0, critDamage: 1.5 }, hp: 1000 };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 1000, actionGauge: 10,
    stats: { ...initial.units['red-1'].stats, hp: 1000, defense: 0 } };
  const actor = initial.units['blue-1'];
  const intent = { actorId: 'blue-1', skillId: whiteWolfIds.ultimate, targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' };
  const endedHit = skill.execute(createBattleContext(initial, () => .99), intent, { ratio: 2.49 });
  assert.equal(endedHit.find(command => command.type === 'deal-damage').amount, 100 * 2.49 * 1.5);
  assert.equal(endedHit.find(command => command.type === 'change-action-gauge').amount, -20);
  assert.equal(endedHit.find(command => command.type === 'add-status').instance.statusId, whiteWolfIds.recovery);
  assert.equal(endedHit.find(command => command.type === 'add-status').instance.modifiers[0].amount, -.4);

  initial.units['red-1'] = { ...initial.units['red-1'], actionGauge: 30 };
  const notEnded = skill.execute(createBattleContext(initial, () => .99), intent, { ratio: 2.49 });
  assert.equal(notEnded.find(command => command.type === 'deal-damage').amount, 100 * 2.49);
  assert.equal(notEnded.some(command => command.type === 'add-status' && command.instance.statusId === whiteWolfIds.recovery), false);

  registry.registerStatus({ id: 'test.action-gauge-decrease-immunity', mechanicsCoverage: 'verified', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', preventsActionGaugeDecrease: true });
  const immuneState = { ...initial, units: { ...initial.units, 'red-1': { ...initial.units['red-1'], actionGauge: 10,
    statuses: [{ instanceId: 'gauge-immune', statusId: 'test.action-gauge-decrease-immunity',
      source: { kind: 'system', id: 'test' }, stacks: 1, duration: { kind: 'permanent' } }] } } };
  const immuneContext = createBattleContext(immuneState, () => .99, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable ?? false, () => false, undefined, undefined,
    (unitId, amount) => !immuneState.units[unitId]?.statuses.some(status => {
      const statusDefinition = registry.getStatus(status.statusId);
      return statusDefinition?.preventsActionGaugeChange
        || (amount < 0 ? statusDefinition?.preventsActionGaugeDecrease : statusDefinition?.preventsActionGaugeIncrease);
    }));
  const immuneHit = skill.execute(immuneContext, intent, { ratio: 2.49 });
  assert.equal(immuneHit.find(command => command.type === 'deal-damage').amount, 100 * 2.49);
  assert.equal(immuneHit.some(command => command.type === 'add-status' && command.instance.statusId === whiteWolfIds.recovery), false,
    '推条免疫时不能触发末端增伤和回气');

  actor.statuses = [{ instanceId: 'white-wolf-meditation', statusId: whiteWolfIds.meditation,
    source: { kind: 'skill', id: whiteWolfIds.passive, unitId: actor.unitId }, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
    modifiers: [{ stat: 'critDamage', operation: 'percent', amount: .2 }] }];
  initial.units['red-1'] = { ...initial.units['red-1'], actionGauge: 40 };
  const meditationHit = skill.execute(createBattleContext(initial, () => .99), intent, { ratio: 2.49 });
  assert.equal(meditationHit.find(command => command.type === 'change-action-gauge').amount, -50);
  assert.equal(meditationHit.find(command => command.type === 'deal-damage').amount, 100 * 2.49 * 1.5);
  assert.equal(definition.mechanicsCoverage, 'partial');
});

test('白狼觉醒无我击杀推进90%行动条，冥想增暴伤并可按30%抵挡单体攻击', () => {
  const registry = new ContentRegistry();
  registerWhiteWolf(registry);
  const definition = registry.getHero(whiteWolfIds.hero);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: whiteWolfIds.hero, skillLevel: 2, awakeFilter: 1 };
  const actor = initial.units['blue-1'];
  const killed = definition.handlers['unit-defeated'].handle(createBattleContext(initial),
    { type: 'unit-defeated', eventId: 'white-wolf-kill', phase: 'unit-defeated', unitId: 'red-1',
      defeatedBy: { kind: 'skill', id: whiteWolfIds.ultimate, unitId: actor.unitId } });
  assert.equal(killed[0].amount, 90);

  const meditation = definition.handlers['action-end'].handle(createBattleContext(initial, () => .1),
    { type: 'action-ended', eventId: 'white-wolf-meditate', phase: 'action-end',
      source: { kind: 'unit', id: String(actor.heroId), unitId: actor.unitId } });
  assert.equal(meditation[0].instance.statusId, whiteWolfIds.meditation);
  assert.equal(meditation[0].instance.modifiers[0].amount, .2);

  actor.statuses = [meditation[0].instance];
  const attackStart = { type: 'attack-start', eventId: 'white-wolf-clone-start', phase: 'attack-start',
    source: { kind: 'skill', id: 'test.single', unitId: 'red-1' }, attackId: 77, targetIds: [actor.unitId], shape: 'single' };
  const guard = definition.handlers['attack-start'].handle(createBattleContext(initial, () => .1), attackStart);
  const guarded = applyEffectCommands(initial, guard, 'effect-resolution', 'white-wolf-clone', id => registry.getStatus(id)).state;
  const intercepted = definition.interceptIncomingDamage(guarded, guarded.units['red-1'], guarded.units['blue-1'], 500,
    'normal', { attackId: 77 });
  assert.equal(intercepted.amount, 0);
});

test('Shuten Doji registers typed Rage and stance rules with stable AI and skill costs', () => {
  const registry = new ContentRegistry();
  registerShutenDoji(registry);
  const hero = registry.getHero(shutenDojiIds.hero);
  assert.equal(hero.mechanicsCoverage, 'partial');
  assert.equal(registry.getStatus(shutenDojiIds.rage).maxStacks, 4);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: shutenDojiIds.hero, skillLevel: 5 };
  const initialize = hero.initialize(createBattleContext(initial, () => .5), 'blue-1');
  assert.equal(initialize[0].instance.stacks, 2);
  const seeded = applyEffectCommands(initial, initialize, 'initialization', 'shuten-init', id => registry.getStatus(id));
  assert.equal(seeded.state.units['blue-1'].statuses[0].duration.kind, 'permanent');
  assert.equal(hero.skills.find(skill => skill.id === shutenDojiIds.ultimate).resourceCost.amount, 3);
  const policy = hero.policy(createBattleContext(seeded.state, () => .5), 'blue-1');
  assert.equal(policy.skillId, shutenDojiIds.basic);
  const attack = hero.skills.find(skill => skill.id === shutenDojiIds.basic).execute(
    createBattleContext(seeded.state, () => .99), { actorId: 'blue-1', skillId: shutenDojiIds.basic,
      targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, { ratio: 1.25 });
  assert.equal(attack.length, 3, 'two Rage stacks add two hits to a normal basic attack');
  assert.ok(attack.every(command => command.source.id === shutenDojiIds.basic));
});

test('Shuten Doji passive gains Rage, clears controls, mitigates by skill level, and auto-casts below 30%', () => {
  const registry = new ContentRegistry();
  registerShutenDoji(registry);
  registry.registerStatus({ id: 'test.shuten-stun', mechanicsCoverage: 'verified', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const hero = registry.getHero(shutenDojiIds.hero);
  const initial = state();
  const rage = { instanceId: 'rage', statusId: shutenDojiIds.rage, source: { kind: 'skill', id: shutenDojiIds.passive, unitId: 'blue-1' },
    stacks: 2, duration: { kind: 'permanent' } };
  const control = { instanceId: 'stun', statusId: 'test.shuten-stun', source: { kind: 'skill', id: 'test.stun' }, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' } };
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: shutenDojiIds.hero, skillLevel: 4, hp: 20,
    statuses: [rage, control] };
  const context = createBattleContext(initial, () => .1, id => registry.getStatus(id)?.category);
  assert.ok(Math.abs(hero.modifyIncomingDamage(initial.units['red-1'], initial.units['blue-1'], 100) - 63) < 1e-9);
  const turnStart = hero.handlers['turn-start'].handle(context, { eventId: 'turn-start', phase: 'turn-start',
    source: { kind: 'system', id: 'test' }, type: 'turn-started', unitId: 'blue-1', turnId: 1 });
  assert.equal(turnStart[0].type, 'remove-statuses');
  assert.equal(turnStart.at(-1).instance.stacks, 1);
  const damageEvent = { eventId: 'incoming', phase: 'hit', source: { kind: 'skill', id: 'test.hit', unitId: 'red-1' },
    attackId: 4, hitIndex: 1, type: 'damage', targetId: 'blue-1', damageKind: 'normal', amount: 20, hpLost: 20,
    mitigated: 0, isCritical: false };
  const hit = hero.handlers.hit.handle(context, damageEvent);
  assert.equal(hit.length, 1);
  assert.equal(hit[0].instance.stacks, 1);
  const stance = { instanceId: 'stance', statusId: shutenDojiIds.stance,
    source: { kind: 'skill', id: shutenDojiIds.ultimate, unitId: 'blue-1' }, stacks: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, values: { lifesteal: .25 } };
  const lifesteal = hero.handlers.hit.handle(createBattleContext({ ...initial, units: {
    ...initial.units, 'blue-1': { ...initial.units['blue-1'], statuses: [rage, stance] },
  } }, () => .99), { ...damageEvent, source: { kind: 'skill', id: 'test.attack', unitId: 'blue-1' }, targetId: 'red-1' });
  assert.equal(lifesteal.length, 1);
  assert.equal(lifesteal[0].amount, 5);
  assert.equal(lifesteal[0].parentEventId, damageEvent.eventId);
  const auto = hero.handlers['turn-end'].handle(context, { eventId: 'turn-end', phase: 'turn-end',
    source: { kind: 'system', id: 'test' }, type: 'turn-ended', unitId: 'blue-1', turnId: 1 });
  assert.ok(auto.some(command => command.type === 'remove-statuses' && command.targetId === 'blue-1'));
  const cast = auto.find(command => command.type === 'schedule-action');
  assert.equal(cast.freeCast, true);
  assert.equal(cast.intent.skillId, shutenDojiIds.ultimate);
});

test('Shuten Doji ultimate heals, advances its gauge, and starts a three-turn stance', () => {
  const registry = new ContentRegistry();
  registerShutenDoji(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: shutenDojiIds.hero, skillLevel: 5, hp: 40 };
  const result = executeAction(initial, { actorId: 'blue-1', skillId: shutenDojiIds.ultimate, targetIds: ['blue-1'],
    shape: 'self', targetRelation: 'ally' }, registry, () => .99,
    { resolveStatus: id => registry.getStatus(id) });
  assert.equal(result.accepted, true);
  assert.equal(result.state.units['blue-1'].hp, 70);
  assert.equal(result.state.units['blue-1'].actionGauge, 50);
  const stance = result.state.units['blue-1'].statuses.find(status => status.statusId === shutenDojiIds.stance);
  assert.equal(stance.duration.remaining, 3);
  assert.equal(stance.values.lifesteal, .3);
  assert.equal(result.state.resources.blue.fire, 1);
});

test('Food Hair Demon AI selects by enemy count and fire; all-enemy skill pushes each target back', () => {
  const registry = new ContentRegistry();
  registerDreamPillow(registry);
  registerFoodHairDemon(registry);
  const hero = registry.getHero(foodHairDemonIds.hero);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: foodHairDemonIds.hero };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 100, actionGauge: 70 };
  initial.units['red-2'] = { ...initial.units['red-1'], unitId: 'red-2', hp: 100, actionGauge: 70 };
  initial.sides.red.push('red-2');
  const highFire = { ...initial, resources: { ...initial.resources, blue: { fire: 6 } } };
  assert.equal(hero.policy(createBattleContext(highFire, () => .9), 'blue-1').skillId, foodHairDemonIds.ultimate);
  const fourFire = { ...initial, resources: { ...initial.resources, blue: { fire: 4 } } };
  assert.equal(hero.policy(createBattleContext(fourFire, () => .1), 'blue-1').skillId, foodHairDemonIds.sleep);
  assert.equal(hero.policy(createBattleContext({ ...fourFire, sides: { blue: ['blue-1'], red: ['red-1'] } }, () => .1),
    'blue-1').skillId, foodHairDemonIds.basic);

  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: `hero.${foodHairDemonIds.hero}`, phase: 'hit', priority: 140, handle: hero.handlers.hit.handle });
  const result = executeAction(highFire, { actorId: 'blue-1', skillId: foodHairDemonIds.ultimate,
    targetIds: ['red-1', 'red-2'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .99,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(result.accepted, true);
  assert.equal(result.state.units['red-1'].actionGauge, 40);
  assert.equal(result.state.units['red-2'].actionGauge, 40);
  assert.equal(result.events.filter(event => event.type === 'action-gauge-changed'
    && event.source.id === foodHairDemonIds.ultimate).length, 2);
  assert.equal(result.events.filter(event => event.type === 'damage' && event.source.id === foodHairDemonIds.ultimate).length, 2);
});

test('Food Hair Demon applies one-turn sleep through control checks and damage wakes the target', () => {
  const registry = new ContentRegistry();
  registerDreamPillow(registry);
  registerFoodHairDemon(registry);
  const hero = registry.getHero(foodHairDemonIds.hero);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: foodHairDemonIds.hero };
  const sleep = executeAction(initial, { actorId: 'blue-1', skillId: foodHairDemonIds.sleep,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => .99,
  { resolveStatus: id => registry.getStatus(id) });
  assert.equal(sleep.accepted, true);
  const asleep = sleep.state.units['red-1'].statuses.find(status => status.statusId === foodHairDemonIds.sleepStatus);
  assert.equal(asleep.duration.remaining, 1);
  assert.equal(asleep.values.controlType, '睡眠');
  const damageEvent = { eventId: 'wake-hit', phase: 'hit', source: { kind: 'skill', id: 'test.attack', unitId: 'blue-1' },
    attackId: 9, hitIndex: 1, type: 'damage', targetId: 'red-1', damageKind: 'normal', amount: 10, hpLost: 10,
    mitigated: 0, isCritical: false };
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: foodHairDemonIds.sleepStatus, phase: 'hit', priority: 5,
    handle: registry.getStatus(foodHairDemonIds.sleepStatus).handlers.hit.handle });
  const woken = settleEvents(sleep.state, [damageEvent], dispatcher, () => .5, new TriggerBudget(20), id => registry.getStatus(id));
  assert.equal(woken.state.units['red-1'].statuses.some(status => status.statusId === foodHairDemonIds.sleepStatus), false);
  assert.ok(woken.events.some(event => event.type === 'status-removed' && event.parentEventId === damageEvent.eventId));
  assert.equal(hero.mechanicsCoverage, 'partial');
});

test('Samurai Spirit applies a typed haunting mark after its area attack and ticks indirect life loss', () => {
  const registry = new ContentRegistry();
  registerSamuraiSpirit(registry);
  const hero = registry.getHero(samuraiSpiritIds.hero);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: samuraiSpiritIds.hero, skillLevel: 5 };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 1000, stats: { ...initial.units['red-1'].stats, hp: 1000 }, actionGauge: 50 };
  initial.units['red-2'] = { ...initial.units['red-1'], unitId: 'red-2', hp: 1000 };
  initial.sides.red.push('red-2');
  const policy = hero.policy(createBattleContext({ ...initial, resources: { ...initial.resources, blue: { fire: 3 } } }, () => .5), 'blue-1');
  assert.equal(policy.skillId, samuraiSpiritIds.ultimate);
  assert.equal(hero.policy(createBattleContext({ ...initial, sides: { blue: ['blue-1'], red: ['red-1'] } }, () => .5),
    'blue-1').skillId, samuraiSpiritIds.basic);

  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'samurai-spirit', phase: 'attack-end', priority: 151, handle: hero.handlers['attack-end'].handle });
  const intent = { actorId: 'blue-1', skillId: samuraiSpiritIds.ultimate, targetIds: ['red-1', 'red-2'],
    shape: 'all-enemies', targetRelation: 'enemy' };
  const result = executeAction(initial, intent, registry, () => .99, { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(result.accepted, true);
  for (const targetId of ['red-1', 'red-2']) {
    const haunt = result.state.units[targetId].statuses.find(status => status.statusId === samuraiSpiritIds.haunt);
    assert.equal(haunt.values.indirectDamageRatio, .65);
    assert.equal(haunt.duration.remaining, 3);
    assert.equal(haunt.modifiers[0].amount, -.4);
    assert.equal(haunt.appliedByEventId, result.events.find(event => event.type === 'attack-ended').eventId);
  }
  const reducedHitAttacker = { ...result.state.units['red-1'], statuses: [result.state.units['red-1'].statuses[0]] };
  const hitContext = createBattleContext({ ...result.state, units: { ...result.state.units, 'red-1': reducedHitAttacker } }, () => .35);
  assert.equal(hitContext.getEffectiveStats('red-1').hit, -.4);
  assert.equal(attemptControl(hitContext, { attemptId: 'reduced-hit', source: { kind: 'skill', id: 'test.control', unitId: 'red-1' },
    targetId: 'blue-1', statusId: 'test.control', controlType: '眩晕', baseChance: .5,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }), undefined,
  'negative effect-hit should reduce the control chance below the base chance');

  const tickRule = registry.getStatus(samuraiSpiritIds.haunt).handlers['turn-start'];
  const tickCommands = tickRule.handle(createBattleContext(result.state, () => .5), { eventId: 'haunt-turn-start', phase: 'turn-start',
    source: { kind: 'system', id: 'test' }, type: 'turn-started', unitId: 'red-2', turnId: 1 });
  assert.equal(tickCommands[0].amount, 65);
  const ticked = applyEffectCommands(result.state, tickCommands, 'effect-resolution', 'haunt-tick', id => registry.getStatus(id));
  assert.equal(ticked.state.units['red-2'].hp, result.state.units['red-2'].hp - 65);
  assert.ok(ticked.events.some(event => event.type === 'life-lost' && event.lifeLossKind === 'indirect'
    && event.source.id === samuraiSpiritIds.ultimate));

  const dispelled = applyEffectCommands(result.state, [{ type: 'dispel-statuses', source: { kind: 'skill', id: 'test.dispel' },
    targetId: 'red-1', statusIds: [samuraiSpiritIds.haunt] }], 'effect-resolution', 'haunt-dispel', id => registry.getStatus(id));
  const removal = dispelled.events.find(event => event.type === 'status-removed');
  assert.equal(removal.removedSource.unitId, 'blue-1');
  const passiveDispatcher = new EventDispatcher();
  passiveDispatcher.register({ id: 'samurai-spirit-passive', phase: 'effect-resolution', priority: 140,
    handle: hero.handlers['effect-resolution'].handle });
  const penalty = settleEvents(dispelled.state, [removal], passiveDispatcher, () => .5, new TriggerBudget(20), id => registry.getStatus(id));
  assert.equal(penalty.state.resources.red.fire, 3);
});

test('Bone Girl gains one Resentment per attack, scales Attack, and revives once at four stacks', () => {
  const registry = new ContentRegistry();
  registerBoneGirl(registry);
  const hero = registry.getHero(boneGirlIds.hero);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: boneGirlIds.hero };
  const incoming = { eventId: 'bone-hit-1', phase: 'hit', source: { kind: 'skill', id: 'test.multi', unitId: 'red-1' },
    attackId: 14, hitIndex: 1, type: 'damage', targetId: 'blue-1', damageKind: 'normal', amount: 20, hpLost: 20,
    mitigated: 0, isCritical: false };
  const first = hero.handlers.hit.handle(createBattleContext(initial, () => .5), incoming);
  const afterFirst = applyEffectCommands(initial, first, 'hit', 'bone-hit-1');
  assert.equal(afterFirst.state.units['blue-1'].statuses[0].stacks, 1);
  assert.equal(hero.handlers.hit.handle(createBattleContext(afterFirst.state, () => .5), { ...incoming, eventId: 'bone-hit-2', hitIndex: 2 }), undefined,
    'additional segments from the same attack must not add another stack');
  const second = hero.handlers.hit.handle(createBattleContext(afterFirst.state, () => .5), { ...incoming, eventId: 'bone-hit-3', attackId: 15 });
  const afterSecond = applyEffectCommands(afterFirst.state, second, 'hit', 'bone-hit-3');
  assert.equal(afterSecond.state.units['blue-1'].statuses[0].stacks, 2);
  assert.ok(Math.abs(createBattleContext(afterSecond.state, () => .5).getEffectiveStats('blue-1').attack - 110) < 1e-9);

  const skill = hero.skills.find(item => item.id === boneGirlIds.ultimate);
  assert.equal(skill.resourceCost.amount, 3);
  const strong = { ...initial.units['blue-1'], skillLevel: 5, hp: 1000,
    stats: { ...initial.units['blue-1'].stats, hp: 1000 } };
  const target = { ...initial.units['red-1'], hp: 1000, stats: { ...initial.units['red-1'].stats, hp: 1000, defense: 300 } };
  const skillState = { ...initial, units: { ...initial.units, 'blue-1': strong, 'red-1': target } };
  const hits = skill.execute(createBattleContext(skillState, () => .5), { actorId: 'blue-1', skillId: boneGirlIds.ultimate,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, skill.levels[4]);
  assert.equal(hits.length, 3);
  assert.ok(hits.every(command => Math.abs(command.amount - 58.75) < 1e-9), 'Lv.5 three-hit skill ignores 40% of 300 Defense');

  const fourLayers = { instanceId: `${boneGirlIds.resentment}:blue-1`, statusId: boneGirlIds.resentment,
    source: { kind: 'skill', id: boneGirlIds.passive, unitId: 'blue-1' }, stacks: 4, duration: { kind: 'permanent' } };
  const dead = { ...strong, hp: 0, statuses: [fourLayers] };
  const defeatedState = { ...skillState, units: { ...skillState.units, 'blue-1': dead } };
  const reviveCommands = hero.handlers['unit-defeated'].handle(createBattleContext(defeatedState, () => .5), {
    eventId: 'bone-defeated', phase: 'unit-defeated', source: { kind: 'skill', id: 'test.lethal', unitId: 'red-1' },
    type: 'unit-defeated', unitId: 'blue-1', defeatedBy: { kind: 'skill', id: 'test.lethal', unitId: 'red-1' },
  });
  assert.equal(reviveCommands.length, 2);
  const revived = applyEffectCommands(defeatedState, reviveCommands, 'unit-defeated', 'bone-revive', id => registry.getStatus(id));
  assert.equal(revived.state.units['blue-1'].hp, 200);
  assert.equal(revived.state.units['blue-1'].statuses.length, 0);
  assert.ok(revived.events.some(event => event.type === 'unit-revived' && event.parentEventId === 'bone-defeated'));
});

test('Jumping Brother grants level-scaled resistance and schedules a free guaranteed-stun revenge attack', () => {
  const registry = new ContentRegistry();
  registerJumpingBrother(registry);
  const hero = registry.getHero(jumpingBrotherIds.hero);
  const initial = state();
  const actor = { ...initial.units['blue-1'], heroId: jumpingBrotherIds.hero, skillLevel: 5 };
  const ally = { ...initial.units['blue-1'], unitId: 'blue-2', hp: 0 };
  const killer = { ...initial.units['red-1'], hp: 1000, stats: { ...initial.units['red-1'].stats, hp: 1000 } };
  initial.units['blue-1'] = actor;
  initial.units['blue-2'] = ally;
  initial.units['red-1'] = killer;
  initial.sides.blue.push('blue-2');
  const started = hero.handlers['battle-start'].handle(createBattleContext(initial, () => .5), {
    type: 'battle-started', eventId: 'jump-start', phase: 'battle-start', source: { kind: 'system', id: 'battle' },
  });
  const initialized = applyEffectCommands(initial, started, 'battle-start', 'jump-start', id => registry.getStatus(id));
  assert.ok(Math.abs(createBattleContext(initialized.state, () => .5).getEffectiveStats(actor.unitId).resist - .4) < 1e-9);
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'jumping-brother-hit', phase: 'hit', priority: 100,
    handle: hero.handlers.hit.handle });

  const defeat = { type: 'unit-defeated', eventId: 'jump-ally-defeated', phase: 'unit-defeated', source: { kind: 'skill', id: 'test.lethal' },
    unitId: ally.unitId, defeatedBy: { kind: 'skill', id: 'test.lethal', unitId: 'red-1' } };
  const revenge = hero.handlers['unit-defeated'].handle(createBattleContext(initialized.state, () => .5), defeat);
  assert.equal(revenge[0].type, 'schedule-action');
  assert.equal(revenge[0].freeCast, true);
  assert.equal(revenge[0].intent.skillId, jumpingBrotherIds.revenge);
  const counter = executeAction(initialized.state, revenge[0].intent, registry, () => .5, { dispatcher,
    resolveStatus: id => registry.getStatus(id), ignoreResourceCost: revenge[0].freeCast,
    parentEventId: 'jump-ally-defeated' });
  assert.equal(counter.accepted, true);
  assert.equal(counter.state.resources.blue.fire, 4, 'the counter action must not spend fire');
  assert.ok(counter.events.some(event => event.type === 'control-applied' && event.statusId === jumpingBrotherIds.stun
    && event.source.id === jumpingBrotherIds.revenge));
  assert.equal(hero.mechanicsCoverage, 'partial', 'coffin bonus redistribution and broader interaction coverage remain incomplete');
});

test('Jumping Brother summons one inherited coffin per fallen ally, revives on the coffin turn, and advances remaining coffins', () => {
  const registry = new ContentRegistry();
  registerJumpingBrother(registry);
  const hero = registry.getHero(jumpingBrotherIds.hero);
  const initial = state();
  const actor = { ...initial.units['blue-1'], heroId: jumpingBrotherIds.hero, skillLevel: 5 };
  const fallenA = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 205, hp: 0 };
  const fallenB = { ...initial.units['blue-1'], unitId: 'blue-3', heroId: 206, hp: 0 };
  initial.units['blue-1'] = actor;
  initial.units[fallenA.unitId] = fallenA;
  initial.units[fallenB.unitId] = fallenB;
  initial.sides.blue.push(fallenA.unitId, fallenB.unitId);
  initial.resources.blue.fire = 4;
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'jumping-brother-defeat', phase: 'unit-defeated', priority: 100,
    handle: hero.handlers['unit-defeated'].handle });

  const intent = hero.policy(createBattleContext(initial, () => .5), actor.unitId);
  assert.equal(intent.skillId, jumpingBrotherIds.ultimate);
  const raised = executeAction(initial, intent, registry, () => .5, { dispatcher,
    resolveStatus: id => registry.getStatus(id) });
  assert.equal(raised.accepted, true);
  assert.equal(raised.state.resources.blue.fire, 1);
  const coffins = Object.values(raised.state.units).filter(unit => unit.statuses.some(status => status.statusId === jumpingBrotherIds.coffin));
  assert.equal(coffins.length, 2);
  assert.ok(coffins.every(coffin => coffin.unitKind === 'summon' && coffin.hp === 45 && coffin.stats.speed === 100),
    'at Lv.5 each coffin gets 30% of its position unit health plus half of the owner 30% shared health bonus');

  const first = coffins[0];
  const coffinIntent = hero.policy(createBattleContext(raised.state, () => .5), first.unitId);
  assert.deepEqual(coffinIntent.targetIds, [fallenA.unitId]);
  const completed = executeAction(raised.state, coffinIntent, registry, () => .5, { dispatcher,
    resolveStatus: id => registry.getStatus(id) });
  assert.equal(completed.accepted, true);
  assert.equal(completed.state.units[fallenA.unitId].hp, fallenA.stats.hp);
  assert.equal(completed.state.units[first.unitId].hp, 0, 'the coffin sacrifices itself after attempting its assigned revival');
  const remaining = coffins.find(coffin => coffin.unitId !== first.unitId);
  assert.equal(completed.state.units[remaining.unitId].actionGauge, 15);
  assert.ok(completed.events.some(event => event.type === 'unit-revived' && event.unitId === fallenA.unitId));

  const battle = state();
  const slowOwner = { ...battle.units['blue-1'], heroId: jumpingBrotherIds.hero,
    stats: { ...battle.units['blue-1'].stats, speed: 1 } };
  const slowEnemy = { ...battle.units['red-1'], heroId: 999, hp: 100000,
    stats: { ...battle.units['red-1'].stats, hp: 100000, speed: 1, attack: 1 } };
  const fastFallenA = { ...battle.units['blue-1'], unitId: 'blue-run-dead-a', heroId: 205, hp: 0,
    stats: { ...battle.units['blue-1'].stats, speed: 300 } };
  const fastFallenB = { ...battle.units['blue-1'], unitId: 'blue-run-dead-b', heroId: 206, hp: 0,
    stats: { ...battle.units['blue-1'].stats, speed: 300 } };
  battle.units['blue-1'] = slowOwner;
  battle.units[slowEnemy.unitId] = slowEnemy;
  battle.units[fastFallenA.unitId] = fastFallenA;
  battle.units[fastFallenB.unitId] = fastFallenB;
  battle.sides.blue.push(fastFallenA.unitId, fastFallenB.unitId);
  battle.resources.blue.fire = 4;
  const simulated = runBattle(battle, registry, { seed: 987, actionLimit: 20 });
  assert.equal(simulated.events.filter(event => event.type === 'unit-summoned').length, 2);
  assert.ok(simulated.events.some(event => event.type === 'unit-revived' && event.unitId === fastFallenA.unitId));
  assert.ok(simulated.events.some(event => event.type === 'unit-revived' && event.unitId === fastFallenB.unitId),
    'the simulation scheduler must give each fast coffin its next action and resolve its assigned resurrection');
});

test('Jumping Brother AI chooses coffin recovery first and otherwise follows its random active target rule', () => {
  const registry = new ContentRegistry();
  registerJumpingBrother(registry);
  const hero = registry.getHero(jumpingBrotherIds.hero);
  const initial = state();
  const actor = { ...initial.units['blue-1'], heroId: jumpingBrotherIds.hero };
  const redTwo = { ...initial.units['red-1'], unitId: 'red-2', hp: 20 };
  initial.units['blue-1'] = actor;
  initial.units[redTwo.unitId] = redTwo;
  initial.sides.red.push(redTwo.unitId);
  assert.equal(hero.policy(createBattleContext(initial, () => .75), actor.unitId).skillId, jumpingBrotherIds.unyielding);
  assert.equal(hero.policy(createBattleContext(initial, () => .75), actor.unitId).targetIds[0], redTwo.unitId);
  initial.resources.blue.fire = 1;
  const basic = hero.policy(createBattleContext(initial, () => .75), actor.unitId);
  assert.equal(basic.skillId, jumpingBrotherIds.basic);
  assert.equal(basic.targetIds[0], redTwo.unitId, 'basic attack defaults to the lowest-health-ratio enemy');
});

test('Jumping Younger Brother accumulates attack from damage taken using the skill-level percentage', () => {
  const registry = new ContentRegistry();
  registerJumpingYoungerBrother(registry);
  const hero = registry.getHero(jumpingYoungerBrotherIds.hero);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: jumpingYoungerBrotherIds.hero, skillLevel: 5 };
  const first = hero.handlers.hit.handle(createBattleContext(initial, () => .5), { type: 'damage', eventId: 'younger-hit-1',
    phase: 'hit', source: { kind: 'skill', id: 'test.attack', unitId: 'red-1' }, targetId: 'blue-1', damageKind: 'normal',
    amount: 100, hpLost: 80, mitigated: 20, isCritical: false });
  const one = applyEffectCommands(initial, first, 'hit', 'younger-hit-1', id => registry.getStatus(id));
  assert.ok(Math.abs(createBattleContext(one.state, () => .5).getEffectiveStats('blue-1').attack - 109) < 1e-9);
  const second = hero.handlers.hit.handle(createBattleContext(one.state, () => .5), { type: 'damage', eventId: 'younger-hit-2',
    phase: 'hit', source: { kind: 'skill', id: 'test.attack', unitId: 'red-1' }, targetId: 'blue-1', damageKind: 'normal',
    amount: 50, hpLost: 50, mitigated: 0, isCritical: false });
  const two = applyEffectCommands(one.state, second, 'hit', 'younger-hit-2', id => registry.getStatus(id));
  assert.ok(Math.abs(createBattleContext(two.state, () => .5).getEffectiveStats('blue-1').attack - 113.5) < 1e-9);
  assert.equal(two.state.units['blue-1'].statuses.find(status => status.statusId === jumpingYoungerBrotherIds.attackGrowth).duration.kind,
    'permanent');
});

test('Jumping Younger Brother Poison Fountain hits all enemies, ticks indirect damage, and adds corrosion when dispelled', () => {
  const registry = new ContentRegistry();
  registerJumpingYoungerBrother(registry);
  const hero = registry.getHero(jumpingYoungerBrotherIds.hero);
  const poison = registry.getStatus(jumpingYoungerBrotherIds.corpsePoison);
  const initial = state();
  const actor = { ...initial.units['blue-1'], heroId: jumpingYoungerBrotherIds.hero, skillLevel: 5 };
  const redOne = { ...initial.units['red-1'], hp: 1000, shield: 10,
    stats: { ...initial.units['red-1'].stats, hp: 1000, defense: 200 } };
  const redTwo = { ...redOne, unitId: 'red-2', hp: 1000, shield: 0 };
  initial.units['blue-1'] = actor;
  initial.units['red-1'] = redOne;
  initial.units['red-2'] = redTwo;
  initial.sides.red.push(redTwo.unitId);
  initial.resources.blue.fire = 4;
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'jumping-younger-attack-end', phase: 'attack-end', priority: 113,
    handle: hero.handlers['attack-end'].handle });
  dispatcher.register({ id: 'jumping-younger-dispel', phase: 'effect-resolution', priority: 112,
    handle: hero.handlers['effect-resolution'].handle });
  const intent = hero.policy(createBattleContext(initial, () => .5), actor.unitId);
  assert.equal(intent.skillId, jumpingYoungerBrotherIds.ultimate);
  assert.deepEqual(intent.targetIds, ['red-1', 'red-2']);
  const attack = executeAction(initial, intent, registry, () => .5, { dispatcher,
    resolveStatus: id => registry.getStatus(id) });
  assert.equal(attack.accepted, true);
  assert.equal(attack.state.resources.blue.fire, 2);
  for (const targetId of ['red-1', 'red-2']) {
    const status = attack.state.units[targetId].statuses.find(item => item.statusId === jumpingYoungerBrotherIds.corpsePoison);
    assert.equal(status.values.indirectDamageRatio, .26);
    assert.equal(status.duration.remaining, 2);
  }

  const targetBeforeTick = { ...attack.state.units['red-1'], shield: 17 };
  const tickingState = { ...attack.state, units: { ...attack.state.units, 'red-1': targetBeforeTick } };
  const tick = poison.handlers['turn-start'].handle(createBattleContext(tickingState, () => .5), {
    type: 'turn-started', eventId: 'younger-poison-tick', phase: 'turn-start', source: { kind: 'unit', id: '3', unitId: 'red-1' },
    unitId: 'red-1' });
  const ticked = applyEffectCommands(tickingState, tick, 'turn-start', 'younger-poison-tick', id => registry.getStatus(id));
  assert.ok(ticked.state.units['red-1'].hp < targetBeforeTick.hp);
  assert.equal(ticked.state.units['red-1'].shield, 17, 'indirect life loss bypasses ordinary shields');
  assert.ok(ticked.events.some(event => event.type === 'life-lost' && event.lifeLossKind === 'indirect'));

  const dispelled = applyEffectCommands(ticked.state, [{ type: 'dispel-statuses', source: { kind: 'system', id: 'test.dispel' },
    targetId: 'red-1', statusIds: [jumpingYoungerBrotherIds.corpsePoison], maxCount: 1 }], 'effect-resolution',
  'younger-poison-dispel', id => registry.getStatus(id));
  const removed = dispelled.events.find(event => event.type === 'status-removed' && event.statusId === jumpingYoungerBrotherIds.corpsePoison);
  assert.equal(removed.removedSource.unitId, actor.unitId);
  const corrosion = hero.handlers['effect-resolution'].handle(createBattleContext(dispelled.state, () => .5), removed);
  const corroded = applyEffectCommands(dispelled.state, corrosion, 'effect-resolution', 'younger-corrosion', id => registry.getStatus(id));
  const corrosionStatus = corroded.state.units['red-1'].statuses.find(item => item.statusId === jumpingYoungerBrotherIds.corrosion);
  assert.equal(corrosionStatus.duration.remaining, 2);
  assert.ok(Math.abs(createBattleContext(corroded.state, () => .5).getEffectiveStats('red-1').defense - 120) < 1e-9);
});

test('Jumping Sister summons Tomato with inherited stats and schedules its free first Rage attack', () => {
  const registry = new ContentRegistry();
  registerJumpingSister(registry);
  const initial = state();
  const owner = { ...initial.units['blue-1'], heroId: jumpingSisterIds.hero, skillLevel: 5 };
  const enemy = { ...initial.units['red-1'], hp: 2000, stats: { ...initial.units['red-1'].stats, hp: 2000, speed: 1 } };
  initial.units['blue-1'] = owner;
  initial.units['red-1'] = enemy;
  initial.resources.blue.fire = 4;
  initial.counters = { ...initial.counters, action: 0 };
  const result = runBattle(initial, registry, { seed: 93, actionLimit: 1 });
  const tomato = Object.values(result.state.units).find(unit => unit.statuses.some(status => status.statusId === jumpingSisterIds.tomato));
  assert.ok(tomato);
  assert.equal(tomato.unitKind, 'summon');
  assert.equal(tomato.stats.hp, owner.stats.hp, 'Lv.4 inherits 100% of the owner HP');
  assert.equal(tomato.stats.attack, owner.stats.attack * .8, 'Lv.2 inherits 80% of owner attack');
  assert.equal(tomato.stats.speed, owner.stats.speed);
  assert.ok(result.events.some(event => event.type === 'unit-summoned' && event.unitId === tomato.unitId));
  assert.ok(result.events.some(event => event.type === 'action-declared' && event.intent.skillId === jumpingSisterIds.tomatoRage),
    'summoning schedules a no-cost first attack through the normal action runner');
  assert.equal(result.state.resources.blue.fire, 2);
});

test('Jumping Sister owner revival waits for its increasing cooldown while Tomato remains alive', () => {
  const registry = new ContentRegistry();
  registerJumpingSister(registry);
  const hero = registry.getHero(jumpingSisterIds.hero);
  const initial = state();
  const owner = { ...initial.units['blue-1'], heroId: jumpingSisterIds.hero, hp: 0 };
  const tomato = { ...initial.units['blue-1'], unitId: 'tomato:blue-1:1', heroId: jumpingSisterIds.hero,
    unitKind: 'summon', summonedByUnitId: owner.unitId, hp: 60,
    statuses: [{ instanceId: 'tomato-mark', statusId: jumpingSisterIds.tomato,
      source: { kind: 'skill', id: jumpingSisterIds.summon, unitId: owner.unitId }, stacks: 1, duration: { kind: 'permanent' } }] };
  initial.units['blue-1'] = owner;
  initial.units[tomato.unitId] = tomato;
  initial.sides.blue.push(tomato.unitId);
  const defeated = { type: 'unit-defeated', eventId: 'sister-defeated-1', phase: 'unit-defeated',
    source: { kind: 'skill', id: 'test.lethal', unitId: 'red-1' }, unitId: owner.unitId,
    defeatedBy: { kind: 'skill', id: 'test.lethal', unitId: 'red-1' } };
  const first = hero.handlers['unit-defeated'].handle(createBattleContext(initial, () => .5), defeated);
  const revived = applyEffectCommands(initial, first, 'unit-defeated', 'sister-revive-1', id => registry.getStatus(id));
  assert.equal(revived.state.units[owner.unitId].hp, owner.stats.hp);
  assert.equal(revived.state.units[owner.unitId].statuses.find(status => status.statusId === jumpingSisterIds.reviveCooldown).duration.remaining, 1);
  assert.equal(hero.handlers['unit-defeated'].handle(createBattleContext({ ...revived.state, units: {
    ...revived.state.units, [owner.unitId]: { ...revived.state.units[owner.unitId], hp: 0 },
  } }, () => .5), { ...defeated, eventId: 'sister-defeated-cooldown' }), undefined,
  'a death during cooldown does not consume another revive');

  const waiting = { ...revived.state, units: { ...revived.state.units,
    [owner.unitId]: { ...revived.state.units[owner.unitId], hp: 0 } } };
  const expirySnapshot = captureStatusExpirySnapshot(waiting, { owner: 'source-turn', unitId: owner.unitId });
  const afterCooldown = advanceStatusDurations(waiting, expirySnapshot, 'sister-revive-cooldown').state;
  const second = hero.handlers['unit-defeated'].handle(createBattleContext(afterCooldown, () => .5), {
    ...defeated, eventId: 'sister-defeated-2',
  });
  const twice = applyEffectCommands(afterCooldown, second, 'unit-defeated', 'sister-revive-2', id => registry.getStatus(id));
  assert.equal(twice.state.units[owner.unitId].hp, owner.stats.hp);
  assert.equal(twice.state.units[owner.unitId].statuses.find(status => status.statusId === jumpingSisterIds.reviveCount).stacks, 2);
  assert.equal(twice.state.units[owner.unitId].statuses.find(status => status.statusId === jumpingSisterIds.reviveCooldown).duration.remaining, 2);
});

test('Jumping Sister follow-up grows Tomato before its two attacks and her passive can buff the whole team', () => {
  const registry = new ContentRegistry();
  registerJumpingSister(registry);
  const hero = registry.getHero(jumpingSisterIds.hero);
  const initial = state();
  const owner = { ...initial.units['blue-1'], heroId: jumpingSisterIds.hero, skillLevel: 5 };
  const tomato = { ...initial.units['blue-1'], unitId: 'tomato:blue-1:1', heroId: jumpingSisterIds.hero,
    unitKind: 'summon', summonedByUnitId: owner.unitId, stats: { ...owner.stats, hp: 100, attack: 80 }, hp: 100,
    statuses: [{ instanceId: 'tomato-mark', statusId: jumpingSisterIds.tomato,
      source: { kind: 'skill', id: jumpingSisterIds.summon, unitId: owner.unitId }, stacks: 1, duration: { kind: 'permanent' },
      values: { ownerUnitId: owner.unitId } }] };
  const enemy = { ...initial.units['red-1'], hp: 2000, stats: { ...initial.units['red-1'].stats, hp: 2000 } };
  initial.units['blue-1'] = owner;
  initial.units[tomato.unitId] = tomato;
  initial.units['red-1'] = enemy;
  initial.sides.blue.push(tomato.unitId);
  initial.resources.blue.fire = 4;
  const intent = hero.policy(createBattleContext(initial, () => .5), owner.unitId);
  assert.equal(intent.skillId, jumpingSisterIds.tomatoFollowup);
  const followup = executeAction(initial, intent, registry, () => .5, { resolveStatus: id => registry.getStatus(id) });
  assert.equal(followup.accepted, true);
  assert.equal(followup.state.resources.blue.fire, 2);
  assert.equal(followup.state.units[tomato.unitId].statuses.find(status => status.statusId === jumpingSisterIds.growUp).stacks, 1);
  assert.ok(Math.abs(createBattleContext(followup.state, () => .5).getEffectiveStats(tomato.unitId).attack - 96) < 1e-9);
  assert.equal(followup.events.filter(event => event.type === 'damage' && event.source.id === jumpingSisterIds.tomatoFollowup).length, 2);

  const justice = hero.handlers['turn-end'].handle(createBattleContext(initial, () => .29), {
    type: 'turn-ended', eventId: 'sister-lolita-justice', phase: 'turn-end',
    source: { kind: 'unit', id: String(jumpingSisterIds.hero), unitId: owner.unitId }, unitId: owner.unitId,
  });
  const buffed = applyEffectCommands(initial, justice, 'turn-end', 'sister-lolita-justice', id => registry.getStatus(id));
  for (const unitId of ['blue-1', tomato.unitId]) {
    assert.ok(Math.abs(createBattleContext(buffed.state, () => .5).getEffectiveStats(unitId).defense
      - initial.units[unitId].stats.defense * 1.3) < 1e-9);
  }
});

test('Tomato takes a defeated enemy slot, restores its HP, and blocks later resurrection', () => {
  const registry = new ContentRegistry();
  registerJumpingSister(registry);
  const hero = registry.getHero(jumpingSisterIds.hero);
  const initial = state();
  const owner = { ...initial.units['blue-1'], heroId: jumpingSisterIds.hero };
  const tomato = { ...initial.units['blue-1'], unitId: 'tomato:blue-1:1', heroId: jumpingSisterIds.hero,
    unitKind: 'summon', summonedByUnitId: owner.unitId, hp: 20,
    statuses: [{ instanceId: 'tomato-mark', statusId: jumpingSisterIds.tomato,
      source: { kind: 'skill', id: jumpingSisterIds.summon, unitId: owner.unitId }, stacks: 1, duration: { kind: 'permanent' } }] };
  const defeated = { ...initial.units['red-1'], hp: 0 };
  initial.units['blue-1'] = owner;
  initial.units[tomato.unitId] = tomato;
  initial.units['red-1'] = defeated;
  initial.sides.blue.push(tomato.unitId);
  const event = { type: 'unit-defeated', eventId: 'tomato-kill', phase: 'unit-defeated',
    source: { kind: 'skill', id: jumpingSisterIds.tomatoRage, unitId: tomato.unitId }, unitId: defeated.unitId,
    defeatedBy: { kind: 'skill', id: jumpingSisterIds.tomatoRage, unitId: tomato.unitId } };
  const scheduled = hero.handlers['unit-defeated'].handle(createBattleContext(initial, () => .5), event);
  assert.equal(scheduled[0].type, 'schedule-action');
  assert.equal(scheduled[0].intent.skillId, jumpingSisterIds.tomatoBrutal);
  const brutal = hero.skills.find(skill => skill.id === jumpingSisterIds.tomatoBrutal);
  const commands = brutal.execute(createBattleContext(initial, () => .5), scheduled[0].intent, brutal.levels[0]);
  const result = applyEffectCommands(initial, commands, 'effect-resolution', 'tomato-brutal', id => registry.getStatus(id));
  assert.equal(result.state.units[tomato.unitId].hp, tomato.stats.hp);
  assert.ok(result.state.units[defeated.unitId].statuses.some(status => status.statusId === jumpingSisterIds.occupiedEnemySlot));
  const blocked = applyEffectCommands(result.state, [{ type: 'revive', source: { kind: 'skill', id: 'test.revive' },
    targetId: defeated.unitId, hp: defeated.stats.hp }], 'effect-resolution', 'blocked-revive', id => registry.getStatus(id));
  assert.equal(blocked.state.units[defeated.unitId].hp, 0);
  assert.ok(blocked.events.some(item => item.type === 'revive-blocked' && item.protectionStatusId === jumpingSisterIds.occupiedEnemySlot));
});

test("Rain Woman Heaven's Tears cleans allies, dispels enemy buffs, and applies its level-scaled tether", () => {
  const registry = new ContentRegistry();
  registerRainWoman(registry);
  const registerStatus = (id, category, dispellable = true) => registry.registerStatus({ id, mechanicsCoverage: 'verified', category,
    dispellable, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registerStatus('test.rain.control', 'control');
  const debuffIds = Array.from({ length: 5 }, (_, index) => `test.rain.debuff.${index}`);
  debuffIds.forEach(id => registerStatus(id, 'debuff'));
  registerStatus('test.rain.buff.1', 'buff');
  registerStatus('test.rain.buff.2', 'buff');
  registerStatus('test.rain.shield', 'shield');
  const hero = registry.getHero(rainWomanIds.hero);
  const initial = state();
  const rainy = { ...initial.units['blue-1'], heroId: rainWomanIds.hero, skillLevel: 3 };
  const ally = { ...initial.units['blue-1'], unitId: 'blue-2', hp: 45 };
  const temporaryStatus = (id, sourceId = 'test') => ({ instanceId: id, statusId: id,
    source: { kind: 'skill', id: sourceId }, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' } });
  ally.statuses = [temporaryStatus('test.rain.control'), ...debuffIds.map(id => temporaryStatus(id))];
  const enemy = { ...initial.units['red-1'], hp: 1000, stats: { ...initial.units['red-1'].stats, hp: 1000 },
    statuses: ['test.rain.buff.1', 'test.rain.buff.2', 'test.rain.shield'].map(id => temporaryStatus(id)) };
  initial.units['blue-1'] = rainy;
  initial.units['blue-2'] = ally;
  initial.units['red-1'] = enemy;
  initial.sides.blue.push('blue-2');
  const intent = { actorId: 'blue-1', skillId: rainWomanIds.ultimate, targetIds: ['blue-2', 'blue-1', 'red-1'],
    shape: 'multi', targetRelation: 'any' };
  const result = executeAction(initial, intent, registry, () => .99, { resolveStatus: id => registry.getStatus(id) });
  assert.equal(result.accepted, true);
  assert.equal(result.state.resources.blue.fire, 2);
  assert.equal(result.state.units['blue-2'].statuses.some(status => status.statusId === 'test.rain.control'), false);
  assert.equal(result.state.units['blue-2'].statuses.filter(status => debuffIds.includes(status.statusId)).length, 1,
    'the team cleanse removes at most four registered debuff/control instances after the selected target control clear');
  assert.ok(Math.abs(createBattleContext(result.state, () => .5).getEffectiveStats('blue-2').resist - .8) < 1e-9);
  assert.equal(result.state.units['red-1'].statuses.some(status => status.statusId === 'test.rain.buff.1'), false);
  assert.equal(result.state.units['red-1'].statuses.some(status => status.statusId === 'test.rain.buff.2'), false);
  assert.equal(result.state.units['red-1'].statuses.some(status => status.statusId === 'test.rain.shield'), true,
    'enemy dispel count is two and applies only to buff-like effects');
  const tether = result.state.units['red-1'].statuses.find(status => status.statusId === rainWomanIds.tether);
  assert.equal(tether.duration.remaining, 2);
  assert.equal(tether.modifiers[0].amount, -10);
  assert.equal(hero.mechanicsCoverage, 'partial');
});

test('Rain Woman passive cleanses at turn start and gains one 40-speed trigger before her next turn', () => {
  const registry = new ContentRegistry();
  registerRainWoman(registry);
  registry.registerStatus({ id: 'test.rain.control', mechanicsCoverage: 'verified', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: 'test.rain.debuff', mechanicsCoverage: 'verified', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const hero = registry.getHero(rainWomanIds.hero);
  const initial = state();
  const control = { instanceId: 'rain-control', statusId: 'test.rain.control', source: { kind: 'skill', id: 'control' },
    stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } };
  const debuff = { instanceId: 'rain-debuff', statusId: 'test.rain.debuff', source: { kind: 'skill', id: 'debuff' },
    stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } };
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: rainWomanIds.hero, statuses: [control, debuff] };
  const passiveDispatcher = new EventDispatcher();
  passiveDispatcher.register({ id: 'rain-turn', phase: 'turn-start', priority: 64, handle: hero.handlers['turn-start'].handle });
  passiveDispatcher.register({ id: 'rain-reaction', phase: 'effect-resolution', priority: 91,
    handle: hero.handlers['effect-resolution'].handle });
  passiveDispatcher.register({ id: 'rain-control', phase: 'control-application', priority: 91,
    handle: hero.handlers['control-application'].handle });
  const start = settleEvents(initial, [{ eventId: 'rain-turn-start', phase: 'turn-start', source: { kind: 'system', id: 'test' },
    type: 'turn-started', unitId: 'blue-1', turnId: 1 }], passiveDispatcher, () => .5, new TriggerBudget(64), id => registry.getStatus(id));
  assert.equal(start.state.units['blue-1'].statuses.some(status => status.statusId === 'test.rain.control'
    || status.statusId === 'test.rain.debuff'), false);

  const applyDebuff = (stateToUpdate, eventId) => applyEffectCommands(stateToUpdate, [{ type: 'add-status',
    source: { kind: 'skill', id: 'test.debuff' }, targetId: 'blue-1', instance: { instanceId: eventId,
      statusId: 'test.rain.debuff', source: { kind: 'skill', id: 'test.debuff' }, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' } } }], 'effect-resolution', eventId,
  id => registry.getStatus(id));
  const firstApplied = applyDebuff(start.state, 'rain-debuff-1');
  const firstReaction = settleEvents(firstApplied.state, firstApplied.events, passiveDispatcher, () => .5,
    new TriggerBudget(64), id => registry.getStatus(id));
  assert.equal(createBattleContext(firstReaction.state, () => .5).getEffectiveStats('blue-1').speed, 140);
  const secondApplied = applyDebuff(firstReaction.state, 'rain-debuff-2');
  const secondReaction = settleEvents(secondApplied.state, secondApplied.events, passiveDispatcher, () => .5,
    new TriggerBudget(64), id => registry.getStatus(id));
  assert.equal(secondReaction.events.some(event => event.source.id === rainWomanIds.passive
    && event.type === 'status-added' && event.instance.statusId === rainWomanIds.speed), false);

  const nextTurn = settleEvents(secondReaction.state, [{ eventId: 'rain-turn-start-2', phase: 'turn-start',
    source: { kind: 'system', id: 'test' }, type: 'turn-started', unitId: 'blue-1', turnId: 2 }], passiveDispatcher,
  () => .5, new TriggerBudget(64), id => registry.getStatus(id));
  const afterReset = applyDebuff(nextTurn.state, 'rain-debuff-3');
  const afterResetReaction = settleEvents(afterReset.state, afterReset.events, passiveDispatcher, () => .5,
    new TriggerBudget(64), id => registry.getStatus(id));
  assert.ok(afterResetReaction.events.some(event => event.source.id === rainWomanIds.passive
    && event.type === 'status-added' && event.instance.statusId === rainWomanIds.speed));
});

test('Soul Reaper ultimate uses three-times damage contrast around the 40 percent threshold', () => {
  const registry = new ContentRegistry();
  registerSoulReaper(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: soulReaperIds.hero, skillLevel: 5,
    stats: { ...initial.units['blue-1'].stats, attack: 100, crit: 0, critDamage: 1.5 } };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 800, stats: { ...initial.units['red-1'].stats, hp: 1000, defense: 0 } };
  initial.units['red-2'] = { ...initial.units['red-1'], unitId: 'red-2', hp: 300 };
  initial.sides.red.push('red-2');
  const action = executeAction(initial, { actorId: 'blue-1', skillId: soulReaperIds.ultimate,
    targetIds: ['red-1', 'red-2'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .9);
  const damage = action.events.filter(event => event.type === 'damage');
  const highTarget = damage.find(event => event.targetId === 'red-1');
  const lowTarget = damage.find(event => event.targetId === 'red-2');
  assert.ok(highTarget.amount > lowTarget.amount * 2.9);
});

test('life loss bypasses shields and has its own event type', () => {
  const initial = state();
  const result = applyEffectCommands(initial, [{ type: 'lose-life', source: { kind: 'status', id: 'status.bleed' },
    targetId: 'red-1', amount: 20 }], 'effect-resolution', 'life');
  assert.equal(result.state.units['red-1'].hp, 40);
  assert.equal(result.state.units['red-1'].shield, 10);
  assert.deepEqual(result.events.map(event => [event.type, event.hpLost]), [['life-lost', 20]]);
});

test('lethal damage and life loss emit one source-linked defeat event; defeat handlers can revive', () => {
  const initial = state();
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 15, shield: 0 };
  const lethal = applyEffectCommands(initial, [{ type: 'deal-damage', source: { kind: 'skill', id: 'finisher', unitId: 'blue-1' },
    targetId: 'red-1', amount: 20 }], 'hit', 'lethal');
  assert.deepEqual(lethal.events.map(event => event.type), ['damage', 'unit-defeated']);
  assert.equal(lethal.events[1].parentEventId, lethal.events[0].eventId);
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'test.revive', phase: 'unit-defeated', priority: 0, handle: (_context, event) => [{
    type: 'revive', source: { kind: 'status', id: 'status.last-stand', unitId: event.unitId }, targetId: event.unitId, hp: 30,
  }] });
  const revived = settleEvents(lethal.state, [lethal.events[1]], dispatcher, () => 0.5);
  assert.equal(revived.state.units['red-1'].hp, 30);
  assert.equal(revived.events.at(-1).type, 'unit-revived');
  assert.equal(revived.events.at(-1).parentEventId, lethal.events[1].eventId);
});

test('dispel removes only explicitly dispellable statuses and records each removal', () => {
  const registry = new ContentRegistry();
  registry.registerStatus({ id: 'status.debuff', mechanicsCoverage: 'verified', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: 'status.sealed', mechanicsCoverage: 'verified', dispellable: false,
    sealable: true, durationOwner: 'permanent', refreshPolicy: 'keep' });
  const initial = state();
  initial.units['red-1'] = { ...initial.units['red-1'], statuses: [
    { instanceId: 'debuff-1', statusId: 'status.debuff', source: { kind: 'system', id: 'test' }, stacks: 1, duration: { kind: 'permanent' } },
    { instanceId: 'debuff-2', statusId: 'status.debuff', source: { kind: 'system', id: 'test' }, stacks: 1, duration: { kind: 'permanent' } },
    { instanceId: 'sealed', statusId: 'status.sealed', source: { kind: 'system', id: 'test' }, stacks: 1, duration: { kind: 'permanent' } },
  ] };
  const result = applyEffectCommands(initial, [{ type: 'dispel-statuses', source: { kind: 'skill', id: 'cleanse' },
    targetId: 'red-1', maxCount: 1 }], 'effect-resolution', 'dispel', id => registry.getStatus(id));
  assert.deepEqual(result.state.units['red-1'].statuses.map(status => status.instanceId), ['debuff-2', 'sealed']);
  assert.deepEqual(result.events.map(event => [event.type, event.instanceId, event.reason]), [['status-removed', 'debuff-1', 'dispelled']]);
});

test('single-skill control protection blocks every control in one scope and is consumed by the next scope', () => {
  const registry = new ContentRegistry();
  registry.registerStatus({ id: 'status.protection', mechanicsCoverage: 'verified', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep', controlProtection: 'single-skill' });
  registry.registerStatus({ id: 'control.stun', mechanicsCoverage: 'verified', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const initial = state();
  initial.units['red-1'] = { ...initial.units['red-1'], statuses: [{ instanceId: 'protect-1', statusId: 'status.protection',
    source: { kind: 'skill', id: 'protection', unitId: 'red-1' }, stacks: 1, duration: { kind: 'permanent' } }] };
  const tryControl = (scopeId, suffix) => applyEffectCommands(initial, [{ type: 'apply-control',
    source: { kind: 'skill', id: 'enemy-control', unitId: 'blue-1' }, targetId: 'red-1', scopeId, parentEventId: `hit-${suffix}`,
    instance: { instanceId: `stun-${suffix}`, statusId: 'control.stun', source: { kind: 'skill', id: 'enemy-control', unitId: 'blue-1' },
      stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } } }],
  'effect-resolution', `control-${suffix}`, id => registry.getStatus(id));
  const first = tryControl('attack:9', 'a');
  assert.deepEqual(first.events.map(event => event.type), ['control-blocked']);
  assert.equal(first.state.units['red-1'].statuses[0].values.controlProtectionScopeId, 'attack:9');
  const second = applyEffectCommands(first.state, [{ type: 'apply-control', source: { kind: 'skill', id: 'enemy-control', unitId: 'blue-1' },
    targetId: 'red-1', scopeId: 'attack:9', instance: { instanceId: 'stun-b', statusId: 'control.stun',
      source: { kind: 'skill', id: 'enemy-control', unitId: 'blue-1' }, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' } } }], 'effect-resolution', 'control-b', id => registry.getStatus(id));
  assert.deepEqual(second.events.map(event => event.type), ['control-blocked']);
  const third = applyEffectCommands(second.state, [{ type: 'apply-control', source: { kind: 'skill', id: 'enemy-control', unitId: 'blue-1' },
    targetId: 'red-1', scopeId: 'attack:10', instance: { instanceId: 'stun-c', statusId: 'control.stun',
      source: { kind: 'skill', id: 'enemy-control', unitId: 'blue-1' }, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' } } }], 'effect-resolution', 'control-c', id => registry.getStatus(id));
  assert.deepEqual(third.events.map(event => event.type), ['status-removed', 'control-applied', 'status-added']);
  assert.ok(!third.state.units['red-1'].statuses.some(status => status.statusId === 'status.protection'));
  assert.ok(third.state.units['red-1'].statuses.some(status => status.statusId === 'control.stun'));
});

test('debuff immunity blocks control before emitting a control-applied event', () => {
  const registry = new ContentRegistry();
  registry.registerStatus({ id: 'status.debuff-immunity', mechanicsCoverage: 'verified', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep', statusImmunity: 'debuffs' });
  registry.registerStatus({ id: 'control.silence', mechanicsCoverage: 'verified', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const initial = state();
  initial.units['red-1'] = { ...initial.units['red-1'], statuses: [{ instanceId: 'immune', statusId: 'status.debuff-immunity',
    source: { kind: 'skill', id: 'immunity', unitId: 'red-1' }, stacks: 1, duration: { kind: 'permanent' } }] };
  const result = applyEffectCommands(initial, [{ type: 'apply-control', source: { kind: 'skill', id: 'silence', unitId: 'blue-1' },
    targetId: 'red-1', instance: { instanceId: 'silence-1', statusId: 'control.silence',
      source: { kind: 'skill', id: 'silence', unitId: 'blue-1' }, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' } } }],
  'effect-resolution', 'immune-control', id => registry.getStatus(id));
  assert.deepEqual(result.events.map(event => event.type), ['control-blocked']);
  assert.equal(result.events[0].blockReason, 'immunity');
  assert.equal(result.state.units['red-1'].statuses.length, 1);
});

test('duration-based shield statuses absorb hits and retain their remaining amount', () => {
  const registry = new ContentRegistry();
  registry.registerStatus({ id: 'core.shield', dispellable: false, sealable: false, durationOwner: 'target-turn',
    refreshPolicy: 'add-stack', maxStacks: 5 });
  const initial = state();
  const shield = { instanceId: 'shield-1', statusId: 'core.shield', source: { kind: 'soul', id: 'shell', unitId: 'blue-1' },
    stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { shieldRemaining: 40 } };
  initial.units['red-1'] = { ...initial.units['red-1'], shield: 0, statuses: [shield] };
  const first = applyEffectCommands(initial, [{ type: 'deal-damage', source: { kind: 'skill', id: 'basic', unitId: 'blue-1' },
    targetId: 'red-1', amount: 30 }], 'hit', 'shield-1', id => registry.getStatus(id));
  assert.equal(first.state.units['red-1'].hp, 60);
  assert.equal(first.state.units['red-1'].statuses[0].values.shieldRemaining, 10);
  assert.equal(first.events[0].mitigated, 30);
  const second = applyEffectCommands(first.state, [{ type: 'deal-damage', source: { kind: 'skill', id: 'basic', unitId: 'blue-1' },
    targetId: 'red-1', amount: 20 }], 'hit', 'shield-2', id => registry.getStatus(id));
  assert.equal(second.state.units['red-1'].hp, 50);
  assert.equal(second.state.units['red-1'].statuses[0].values.shieldRemaining, 0);
  assert.equal(second.events[0].mitigated, 10);
});

test('damage formula applies defense, data-driven fluctuation, and critical multiplier', () => {
  assert.deepEqual(calculateDamage({ attack: 100, defense: 300, ratio: 1, critChance: 1, critDamage: 1.5 }, () => 0.5), {
    amount: 75, isCritical: true,
  });
  assert.deepEqual(calculateDamage({ attack: 100, defense: -20, ratio: 0.5, critChance: 0, critDamage: 2 }, () => 0.5), {
    amount: 50, isCritical: false,
  });
});

test('generic healing caps at maximum health and returns only actual healing', () => {
  assert.deepEqual(resolveHealing(90, 100, 25), { amount: 25, hpGained: 10, hpAfter: 100 });
  const result = applyEffectCommands(state(), [{
    type: 'heal', source: { kind: 'skill', id: 'heal', unitId: 'blue-1' }, targetId: 'red-1', amount: 80,
  }], 'hit');
  assert.equal(result.state.units['red-1'].hp, 60);
  assert.equal(result.events[0].hpGained, 0);
});

test('stacked debuff flags block and consume one healing or action advance per trigger', () => {
  const initial = state();
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 40, statuses: [{ instanceId: 'wound', statusId: 'test.wound',
    source: { kind: 'skill', id: 'test.skill', unitId: 'blue-1' }, stacks: 2, duration: { kind: 'count', remaining: 2, owner: 'target-turn' } }] };
  const definition = { id: 'test.wound', mechanicsCoverage: 'partial', category: 'debuff', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace', blocksNextHealing: true, blocksNextActionAdvance: true };
  const result = applyEffectCommands(initial, [
    { type: 'heal', source: { kind: 'skill', id: 'test.heal', unitId: 'blue-1' }, targetId: 'red-1', amount: 20 },
    { type: 'change-action-gauge', source: { kind: 'skill', id: 'test.push' }, targetId: 'red-1', amount: 20 },
  ], 'effect-resolution', 'stacked-trigger-debuff', id => id === 'test.wound' ? definition : undefined);
  assert.equal(result.state.units['red-1'].hp, 40);
  assert.equal(result.state.units['red-1'].actionGauge, 0);
  assert.equal(result.state.units['red-1'].statuses.some(status => status.statusId === 'test.wound'), false);
  assert.equal(result.events.filter(event => event.type === 'healing-blocked' && event.restrictionStatusId === 'test.wound').length, 1);
  assert.ok(result.events.some(event => event.type === 'action-gauge-changed' && event.blockedByImmunity));
});

test('typed status stat modifiers feed effective stats and action scheduling', () => {
  const initial = state();
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  initial.units['blue-1'] = { ...initial.units['blue-1'], stats: { ...initial.units['blue-1'].stats, speed: 100, attack: 100 },
    statuses: [{ instanceId: 'haste', statusId: 'status.haste', source: { kind: 'status', id: 'status.haste' }, stacks: 2,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
      modifiers: [{ stat: 'speed', operation: 'percent', amount: 1, perStack: true },
        { stat: 'attack', operation: 'flat', amount: 25, perStack: true }] }] };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, speed: 150 } };
  const context = createBattleContext(initial, () => 0);
  assert.equal(context.getEffectiveStats('blue-1').speed, 300);
  assert.equal(context.getEffectiveStats('blue-1').attack, 150);
  assert.equal(scheduleNextActor(initial, () => 0).actorId, 'blue-1');
});

test('seeded random stream and per-sample seed are stable and versioned', () => {
  const first = createSeededRandom(12345);
  const second = createSeededRandom(12345);
  assert.deepEqual(Array.from({ length: 8 }, () => first.next()), Array.from({ length: 8 }, () => second.next()));
  assert.notEqual(deriveSampleSeed(12345, 4, 'v1'), deriveSampleSeed(12345, 4, 'v2'));
  assert.notEqual(deriveSampleSeed(12345, 4, 'v1'), deriveSampleSeed(12345, 5, 'v1'));
});

test('phase handlers use explicit priority and stable IDs, independent of registration order', () => {
  const dispatcher = new EventDispatcher();
  const calls = [];
  const handler = (id, priority) => ({ id, phase: 'hit', priority, handle: () => { calls.push(id); } });
  dispatcher.register(handler('late', 10));
  dispatcher.register(handler('zeta', 0));
  dispatcher.register(handler('alpha', 0));
  dispatcher.dispatch({}, { type: 'action-declared', eventId: 'x', phase: 'hit', source: { kind: 'system', id: 'test' }, intent: {} });
  assert.deepEqual(calls, ['alpha', 'zeta', 'late']);
  assert.throws(() => dispatcher.register(handler('alpha', 0)), /Duplicate rule handler/);
});

test('trigger budget identifies runaway loops after the configured limit', () => {
  const budget = new TriggerBudget(2);
  assert.equal(budget.consume('attack', 'attack-1', 'counter').exceeded, false);
  assert.equal(budget.consume('attack', 'attack-1', 'counter').exceeded, false);
  assert.deepEqual(budget.consume('attack', 'attack-1', 'counter'), {
    exceeded: true, scope: 'attack', key: 'attack:attack-1:counter', count: 3, limit: 2,
  });
  assert.equal(budget.consume('attack', 'attack-2', 'counter').count, 1);
});

test('phase settlement stops a recursive trigger chain and preserves its parent event', () => {
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'test.counter', phase: 'hit', priority: 0, handle: (_context, event) => [{
    type: 'deal-damage', source: { kind: 'status', id: 'status.loop', unitId: 'blue-1' }, targetId: 'red-1', amount: 1,
    parentEventId: event.eventId,
  }] });
  const initial = state();
  initial.units['red-1'] = { ...initial.units['red-1'], shield: 0 };
  initial.counters = { ...initial.counters, action: 1, attack: 1, hit: 1 };
  const result = settleEvents(initial, [{ type: 'damage', eventId: 'root', phase: 'hit', source: { kind: 'skill', id: 'root' },
    actionId: 1, attackId: 1, hitIndex: 1, targetId: 'red-1', amount: 0, hpLost: 0, mitigated: 0, isCritical: false }],
  dispatcher, () => 0.5, new TriggerBudget(2));
  assert.equal(result.triggerBudget.exceeded, true);
  assert.equal(result.triggerBudget.count, 3);
  assert.equal(result.events.length, 3);
  assert.equal(result.events[1].parentEventId, 'root');
  assert.equal(result.events[2].parentEventId, result.events[1].eventId);
  assert.equal(result.state.units['red-1'].hp, 58);
});

test('content registry rejects duplicate stable IDs', () => {
  const registry = new ContentRegistry();
  registry.registerHero({ id: 42, skills: [] });
  registry.registerSoul({ id: 'soul.a' });
  registry.registerStatus({ id: 'status.a', dispellable: true, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'keep' });
  assert.equal(registry.getHero(42).id, 42);
  assert.equal(registry.getSoul('soul.a').id, 'soul.a');
  assert.equal(registry.getStatus('status.a').durationOwner, 'target-turn');
  assert.throws(() => registry.registerHero({ id: 42, skills: [] }), /Duplicate hero definition/);
  assert.throws(() => registry.registerSoul({ id: 'soul.a' }), /Duplicate soul definition/);
  assert.throws(() => registry.registerStatus({ id: 'status.a', dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' }), /Duplicate status definition/);
});

test('action runner validates, pays cost, and emits parent-linked hit events', () => {
  const registry = new ContentRegistry();
  registry.registerHero({ id: 1, skills: [{
    id: 'hero.one.basic', resourceCost: { resourceId: 'fire', amount: 2 }, target: 'single', levels: [],
    execute: () => [
      { type: 'deal-damage', source: { kind: 'skill', id: 'hero.one.basic', unitId: 'blue-1' }, targetId: 'red-1', amount: 20 },
      { type: 'deal-damage', source: { kind: 'skill', id: 'hero.one.basic', unitId: 'blue-1' }, targetId: 'red-1', amount: 15 },
    ],
  }] });
  const intent = { actorId: 'blue-1', skillId: 'hero.one.basic', targetIds: ['red-1'], shape: 'single' };
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'test.per-hit', phase: 'hit', priority: 0, handle: () => [{
    type: 'change-resource', source: { kind: 'status', id: 'status.hit-reward' }, side: 'blue', resourceId: 'fire', amount: 1,
  }] });
  const result = executeAction(state(), intent, registry, () => 0.5, { dispatcher, triggerBudget: new TriggerBudget(10) });
  assert.equal(result.accepted, true);
  assert.equal(result.state.resources.blue.fire, 4);
  assert.equal(result.state.units['red-1'].hp, 35);
  const damage = result.events.filter(event => event.type === 'damage');
  assert.deepEqual(damage.map(event => [event.actionId, event.attackId, event.hitIndex, event.parentEventId]), [
    [3, 4, 1, 'action-3-attack-4'], [3, 4, 2, 'action-3-attack-4'],
  ]);
  assert.deepEqual(result.events.map(event => event.type), [
    'action-declared', 'resource-changed', 'attack-start', 'damage', 'resource-changed', 'damage', 'resource-changed', 'attack-ended', 'action-ended',
  ]);
  const rejected = executeAction({ ...state(), resources: { blue: { fire: 1 }, red: { fire: 4 } } }, intent, registry, () => 0.5);
  assert.equal(rejected.failure, 'insufficient-resource');
  assert.equal(rejected.state.resources.blue.fire, 1);
  assert.equal(rejected.events.length, 0);
});

test('action runner revalidates the actor and targets after action-selection triggers', () => {
  const registry = new ContentRegistry();
  registry.registerHero({ id: 1, skills: [{ id: 'hero.one.basic', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single', targetRelation: 'enemy', levels: [], execute: () => [] }] });
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'test.before-action', phase: 'action-selection', priority: 0, handle: (_context, event) => [{
    type: 'deal-damage', source: { kind: 'status', id: 'status.interrupt' }, targetId: event.intent.targetIds[0], amount: 1000,
  }] });
  const result = executeAction(state(), { actorId: 'blue-1', skillId: 'hero.one.basic', targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' },
    registry, () => 0.5, { dispatcher });
  assert.equal(result.accepted, false);
  assert.equal(result.failure, 'invalid-target');
  assert.equal(result.state.units['red-1'].hp, 0);
  assert.equal(result.state.resources.blue.fire, 4);
});

test('common attack and healing content uses explicit skill-level ratios', () => {
  const registry = new ContentRegistry();
  registry.registerHero({ id: 1, skills: [createBasicAttackSkill('hero.one.basic', [0.8, 1.1, 1.4]),
    createHealingSkill('hero.one.heal', [0.5, 0.75], 'all-allies')] });
  const untouched = state();
  const levelTwoState = { ...untouched, units: { ...untouched.units, 'blue-1': { ...untouched.units['blue-1'], skillLevel: 2 } } };
  const attack = executeAction(levelTwoState,
    { actorId: 'blue-1', skillId: 'hero.one.basic', targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => 0.5);
  assert.equal(attack.state.units['red-1'].hp, 0);
  assert.ok(Math.abs(attack.events.find(event => event.type === 'damage').amount - 110) < 1e-9);
  const hurtTeam = { ...levelTwoState, units: { ...levelTwoState.units,
    'blue-1': { ...levelTwoState.units['blue-1'], hp: 50 }, 'red-1': { ...levelTwoState.units['red-1'], side: 'blue', hp: 50 } },
    sides: { blue: ['blue-1', 'red-1'], red: [] } };
  const heal = executeAction(hurtTeam,
    { actorId: 'blue-1', skillId: 'hero.one.heal', targetIds: ['blue-1', 'red-1'], shape: 'all-allies', targetRelation: 'ally' }, registry, () => 0.2);
  assert.deepEqual(['blue-1', 'red-1'].map(id => heal.state.units[id].hp), [100, 60]);
  assert.deepEqual(heal.events.filter(event => event.type === 'healing').map(event => event.hpGained), [50, 10]);
});

test('status expiration follows its declared owner and does not tick statuses added after the snapshot', () => {
  const initial = state();
  const targetTurn = { instanceId: 'target-turn-1', statusId: 'status.slow', source: { kind: 'skill', id: 'slow', unitId: 'blue-1' },
    appliedByEventId: 'apply-slow', stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } };
  const sourceTurn = { instanceId: 'source-turn-1', statusId: 'status.mark', source: { kind: 'skill', id: 'mark', unitId: 'blue-1' },
    stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'source-turn' } };
  const target = { ...initial.units['red-1'], statuses: [targetTurn, sourceTurn] };
  const withStatuses = { ...initial, units: { ...initial.units, 'red-1': target } };
  const snapshot = captureStatusExpirySnapshot(withStatuses, { owner: 'target-turn', unitId: 'red-1' });
  const addedLater = { instanceId: 'late-1', statusId: 'status.late', source: { kind: 'system', id: 'late' },
    stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } };
  const afterAction = { ...withStatuses, units: { ...withStatuses.units,
    'red-1': { ...target, statuses: [...target.statuses, addedLater] } } };
  const result = advanceStatusDurations(afterAction, snapshot, 'tick');
  assert.deepEqual(result.state.units['red-1'].statuses.map(status => status.instanceId), ['source-turn-1', 'late-1']);
  assert.deepEqual(result.events.map(event => [event.type, event.instanceId, event.reason, event.parentEventId]), [['status-removed', 'target-turn-1', 'expired', 'apply-slow']]);
});

test('status registry applies explicit add-stack, refresh-duration, keep, and replace policies', () => {
  const existing = { instanceId: 'old', statusId: 'status.stack', source: { kind: 'skill', id: 'stack', unitId: 'blue-1' },
    stacks: 2, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } };
  const incoming = { instanceId: 'new', statusId: 'status.stack', source: existing.source,
    stacks: 1, duration: { kind: 'count', remaining: 3, owner: 'target-turn' } };
  const registry = new ContentRegistry();
  registry.registerStatus({ id: 'status.stack', dispellable: true, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'add-stack' });
  const initial = state();
  initial.units['red-1'] = { ...initial.units['red-1'], statuses: [existing] };
  const stacked = applyEffectCommands(initial, [{ type: 'add-status', source: incoming.source, targetId: 'red-1', instance: incoming }],
    'effect-resolution', 'stack', id => registry.getStatus(id));
  assert.equal(stacked.state.units['red-1'].statuses.length, 1);
  assert.equal(stacked.state.units['red-1'].statuses[0].stacks, 3);
  assert.equal(stacked.state.units['red-1'].statuses[0].duration.remaining, 3);
  assert.equal(stacked.state.units['red-1'].statuses[0].instanceId, 'old');

  registry.registerStatus({ id: 'status.refresh', dispellable: true, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'refresh-duration' });
  const expiring = { ...existing, statusId: 'status.refresh', instanceId: 'refresh-old' };
  const refreshed = applyEffectCommands({ ...initial, units: { ...initial.units, 'red-1': { ...initial.units['red-1'], statuses: [expiring] } } }, [
    { type: 'add-status', source: incoming.source, targetId: 'red-1', instance: { ...incoming, statusId: 'status.refresh', instanceId: 'refresh-new' } },
  ], 'effect-resolution', 'refresh', id => registry.getStatus(id));
  assert.deepEqual(refreshed.state.units['red-1'].statuses.map(status => [status.instanceId, status.stacks, status.duration.remaining]), [['refresh-old', 2, 3]]);

  registry.registerStatus({ id: 'status.keep', dispellable: true, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'keep' });
  registry.registerStatus({ id: 'status.replace', dispellable: true, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const keep = { ...incoming, statusId: 'status.keep', instanceId: 'keep-old' };
  const kept = applyEffectCommands({ ...initial, units: { ...initial.units, 'red-1': { ...initial.units['red-1'], statuses: [keep] } } }, [
    { type: 'add-status', source: keep.source, targetId: 'red-1', instance: { ...keep, instanceId: 'keep-new' } },
  ], 'effect-resolution', 'keep', id => registry.getStatus(id));
  assert.deepEqual(kept.state.units['red-1'].statuses.map(status => status.instanceId), ['keep-old']);
  const oldReplace = { ...incoming, statusId: 'status.replace', instanceId: 'replace-old' };
  const replaced = applyEffectCommands({ ...initial, units: { ...initial.units, 'red-1': { ...initial.units['red-1'], statuses: [oldReplace] } } }, [
    { type: 'add-status', source: oldReplace.source, targetId: 'red-1', instance: { ...oldReplace, instanceId: 'replace-new' } },
  ], 'effect-resolution', 'replace', id => registry.getStatus(id));
  assert.deepEqual(replaced.state.units['red-1'].statuses.map(status => status.instanceId), ['replace-new']);
  assert.deepEqual(replaced.events.map(event => event.type), ['status-removed', 'status-added']);
});

test('generic status transfer moves a dispellable buff to a new unit and preserves its modifiers and duration', () => {
  const registry = new ContentRegistry();
  registry.registerStatus({ id: 'test.transfer-buff', mechanicsCoverage: 'verified', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const initial = state();
  const instance = { instanceId: 'transfer-instance', statusId: 'test.transfer-buff',
    source: { kind: 'skill', id: 'test.buff-source', unitId: 'red-1' }, stacks: 2,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, modifiers: [{ stat: 'speed', operation: 'flat', amount: 12 }] };
  initial.units['red-1'] = { ...initial.units['red-1'], statuses: [instance] };
  const result = applyEffectCommands(initial, [{ type: 'transfer-status', source: { kind: 'skill', id: 'test.steal', unitId: 'blue-1' },
    fromTargetId: 'red-1', toTargetId: 'blue-1', instanceId: instance.instanceId }], 'effect-resolution', 'transfer', id => registry.getStatus(id));
  assert.equal(result.state.units['red-1'].statuses.length, 0);
  const moved = result.state.units['blue-1'].statuses[0];
  assert.equal(moved.statusId, instance.statusId);
  assert.equal(moved.stacks, 2);
  assert.equal(moved.duration.remaining, 2);
  assert.equal(moved.modifiers[0].amount, 12);
  assert.equal(moved.source.unitId, 'red-1', '来源仍保留原施加者身份');
  assert.deepEqual(result.events.map(event => [event.type, event.targetId]), [['status-removed', 'red-1'], ['status-added', 'blue-1']]);
});

test('Eater steals a dispellable buff after a basic hit through the shared status-transfer effect', () => {
  const registry = new ContentRegistry();
  registerEater(registry);
  registry.registerStatus({ id: 'test.eater-buff', mechanicsCoverage: 'verified', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: eaterIds.hero };
  const buff = { instanceId: 'enemy-haste', statusId: 'test.eater-buff',
    source: { kind: 'skill', id: 'test.haste', unitId: 'red-1' }, stacks: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, modifiers: [{ stat: 'speed', operation: 'flat', amount: 15 }] };
  initial.units['red-1'] = { ...initial.units['red-1'], statuses: [buff] };
  const hit = { eventId: 'basic-hit', phase: 'hit', source: { kind: 'skill', id: eaterIds.basic, unitId: 'blue-1' },
    type: 'damage', targetId: 'red-1', damageKind: 'normal', amount: 10, hpBefore: 60, hpAfter: 50,
    hpLost: 10, mitigated: 0, isCritical: false };
  const handler = registry.getHero(eaterIds.hero).handlers.hit;
  const commands = handler.handle(createBattleContext(initial, (() => { const rolls = [.19, 0]; return () => rolls.shift(); })(),
    id => registry.getStatus(id)?.category, id => registry.getStatus(id)?.dispellable === true), hit);
  assert.equal(commands[0].type, 'transfer-status');
  const result = applyEffectCommands(initial, commands, 'hit', 'eater-steal', id => registry.getStatus(id));
  assert.equal(result.state.units['red-1'].statuses.length, 0);
  const stolen = result.state.units['blue-1'].statuses[0];
  assert.equal(stolen.statusId, buff.statusId);
  assert.equal(stolen.duration.remaining, 2);
  assert.equal(stolen.modifiers[0].amount, 15);
  assert.deepEqual(result.events.map(event => event.type), ['status-removed', 'status-added']);
});

test('Meng Po applies level-scaled silence and gauge changes for both bowl skills', () => {
  const registry = new ContentRegistry();
  registerMengPo(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: mengPoIds.hero };
  const definition = registry.getHero(mengPoIds.hero);
  const silenced = state();
  silenced.units['blue-1'] = { ...silenced.units['blue-1'], heroId: mengPoIds.hero,
    statuses: [{ instanceId: 'mengpo-silence', statusId: mengPoIds.silence,
      source: { kind: 'skill', id: mengPoIds.bowl, unitId: 'red-1' }, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }] };
  const silencedAction = executeAction(silenced, { actorId: 'blue-1', skillId: mengPoIds.bowl, targetIds: ['red-1'],
    shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .5, { resolveStatus: id => registry.getStatus(id) });
  assert.equal(silencedAction.accepted, true);
  assert.equal(silencedAction.events.find(event => event.type === 'action-declared').intent.skillId, mengPoIds.basic,
    '沉默时将选定技能转为普攻');
  assert.equal(silencedAction.state.resources.blue.fire, 4, '沉默转普攻不支付技能鬼火');
  const twoEnemies = state();
  twoEnemies.units['blue-1'] = { ...twoEnemies.units['blue-1'], heroId: mengPoIds.hero };
  twoEnemies.units['red-2'] = { ...twoEnemies.units['red-1'], unitId: 'red-2', hp: 80 };
  twoEnemies.sides.red.push('red-2');
  twoEnemies.resources.blue.fire = 3;
  assert.equal(definition.policy(createBattleContext(twoEnemies, () => .5), 'blue-1').skillId, mengPoIds.bowl,
    '两名以上敌人且有3火时使用群攻');
  const lowFire = state();
  lowFire.units['blue-1'] = { ...lowFire.units['blue-1'], heroId: mengPoIds.hero };
  lowFire.resources.blue.fire = 1;
  assert.equal(definition.policy(createBattleContext(lowFire, () => .1), 'blue-1').skillId, mengPoIds.ram,
    '鬼火不足3时保留二技能随机分支');
  lowFire.resources.blue.fire = 0;
  assert.equal(definition.policy(createBattleContext(lowFire, () => .1), 'blue-1').skillId, mengPoIds.basic,
    '没有鬼火时回退普攻');
  assert.deepEqual(definition.skills.slice(1).map(skill => [skill.resourceCost.amount, skill.levels[0].ratio, skill.levels[4].ratio]),
    [[1, 1.3, 1.58], [3, 1.3, 1.58]]);
  const handler = registry.getHero(mengPoIds.hero).handlers.hit;
  const hit = (skillId, eventId) => ({ eventId, phase: 'hit', source: { kind: 'skill', id: skillId, unitId: 'blue-1' },
    type: 'damage', targetId: 'red-1', damageKind: 'normal', amount: 10, hpBefore: 60, hpAfter: 50,
    hpLost: 10, mitigated: 0, isCritical: false });
  const ramCommands = handler.handle(createBattleContext(initial, () => .49), hit(mengPoIds.ram, 'ram-hit'));
  assert.deepEqual(ramCommands.map(command => command.type), ['apply-control', 'change-action-gauge']);
  assert.equal(ramCommands[0].instance.duration.remaining, 1);
  assert.equal(ramCommands[1].amount, -40);
  const bowlCommands = handler.handle(createBattleContext(initial, () => .7), hit(mengPoIds.bowl, 'bowl-hit'));
  assert.deepEqual(bowlCommands.map(command => [command.type, command.amount]), [['change-action-gauge', -20]],
    '群攻未沉默目标时击退20%行动条');
  const blocked = registry.getHero(mengPoIds.hero).handlers['control-application'].handle(createBattleContext(initial, () => .5), {
    eventId: 'blocked-silence', phase: 'control-application', source: { kind: 'skill', id: mengPoIds.bowl, unitId: 'blue-1' },
    type: 'control-blocked', targetId: 'red-1', controlStatusId: mengPoIds.silence, protectionStatusId: 'test.immunity' });
  assert.equal(blocked[0].amount, -20, '沉默被免疫阻止后仍推条');
  const passive = registry.getHero(mengPoIds.hero).handlers['action-end'].handle(createBattleContext(initial, () => .5), {
    eventId: 'enemy-basic-end', phase: 'action-end', source: { kind: 'skill', id: 'enemy.basic', unitId: 'red-1' },
    type: 'action-ended', actionKind: 'basic', skillId: 'enemy.basic', soulTriggersAllowed: true });
  assert.deepEqual(passive.map(command => [command.type, command.targetId, command.amount]), [['change-action-gauge', 'blue-1', 5]]);
});

test('Wugu Shi applies Gu-eclipse with hit and resistance, then creates an owned summon on defeat', () => {
  const registry = new ContentRegistry();
  registerWuguShi(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: wuguShiIds.hero, skillLevel: 5 };
  const hero = registry.getHero(wuguShiIds.hero);
  const ultimate = hero.skills.find(skill => skill.id === wuguShiIds.ultimate);
  assert.equal(ultimate.resourceCost.amount, 2);
  assert.deepEqual([ultimate.levels[0].ratio, ultimate.levels[4].ratio], [1.09, 1.31]);
  const hit = { eventId: 'gu-hit', phase: 'hit', source: { kind: 'skill', id: wuguShiIds.ultimate, unitId: 'blue-1' },
    type: 'damage', targetId: 'red-1', damageKind: 'normal', amount: 10, hpBefore: 60, hpAfter: 50,
    hpLost: 10, mitigated: 0, isCritical: false };
  const handler = hero.handlers.hit;
  const commands = handler.handle(createBattleContext(initial, () => 0), hit);
  assert.equal(commands[0].type, 'add-status');
  assert.equal(commands[0].instance.duration.remaining, 3);
  const marked = applyEffectCommands(initial, commands, 'hit', 'gu-mark', id => registry.getStatus(id));
  assert.ok(marked.state.units['red-1'].statuses.some(status => status.statusId === wuguShiIds.mark));
  assert.equal(marked.events[0].parentEventId, 'gu-hit');
  const resistantState = { ...initial, units: { ...initial.units, 'red-1': { ...initial.units['red-1'], stats: {
    ...initial.units['red-1'].stats, resist: .5,
  } } } };
  const resisted = handler.handle(createBattleContext(resistantState, () => .3), hit);
  assert.equal(resisted[0].type, 'report-status-resisted');
  assert.equal(applyEffectCommands(resistantState, resisted, 'hit', 'gu-resist', id => registry.getStatus(id)).events[0].type, 'status-resisted');
  registry.registerStatus({ id: 'test.wugu-debuff-immunity', category: 'buff', dispellable: false, sealable: false,
    durationOwner: 'permanent', refreshPolicy: 'keep', statusImmunity: 'debuffs' });
  const immuneState = { ...initial, units: { ...initial.units, 'red-1': { ...initial.units['red-1'], statuses: [{ instanceId: 'mark-immunity',
    statusId: 'test.wugu-debuff-immunity', source: { kind: 'system', id: 'test' }, stacks: 1, duration: { kind: 'permanent' } }] } } };
  const blocked = applyEffectCommands(immuneState, commands, 'hit', 'gu-immune', id => registry.getStatus(id));
  assert.equal(blocked.events[0].type, 'status-application-blocked');
  assert.equal(blocked.events[0].blockReason, 'immunity');

  const defeatedState = { ...marked.state, units: { ...marked.state.units,
    'red-1': { ...marked.state.units['red-1'], hp: 0 } } };
  const defeated = { eventId: 'red-dead', phase: 'unit-defeated', source: { kind: 'skill', id: wuguShiIds.basic, unitId: 'blue-1' },
    type: 'unit-defeated', unitId: 'red-1', defeatedBy: { kind: 'skill', id: wuguShiIds.basic, unitId: 'blue-1' } };
  const summon = hero.handlers['unit-defeated'].handle(createBattleContext(defeatedState, () => .5), defeated);
  assert.equal(summon[0].type, 'summon-unit');
  const result = applyEffectCommands(defeatedState, summon, 'unit-defeated', 'gu-summon', id => registry.getStatus(id));
  const puppet = result.state.units[result.events[0].unitId];
  assert.equal(puppet.unitKind, 'summon');
  assert.equal(puppet.summonedByUnitId, 'blue-1');
  assert.equal(puppet.stats.hp, 30);
  assert.equal(puppet.stats.attack, 50);
  assert.ok(result.state.sides.blue.includes(puppet.unitId));
  assert.deepEqual(result.events.map(event => event.type), ['unit-summoned']);

  const battleState = state();
  battleState.units['blue-1'] = { ...battleState.units['blue-1'], heroId: wuguShiIds.hero, skillLevel: 5 };
  battleState.units['red-1'] = { ...battleState.units['red-1'], hp: 1, statuses: [{ ...marked.state.units['red-1'].statuses[0],
    duration: { kind: 'count', remaining: 3, owner: 'target-turn' } }] };
  const battle = runBattle(battleState, registry, { seed: 21 });
  const summoned = battle.events.find(event => event.type === 'unit-summoned');
  assert.ok(summoned, '正式模拟中的击败触发也应创建傀儡');
  assert.equal(battle.state.units[summoned.unitId].summonedByUnitId, 'blue-1');
  assert.ok(battle.state.sides.blue.includes(summoned.unitId));
});

test('Great Tengu counts unique targets once per ultimate attack and cleans up attack-local markers', () => {
  const registry = new ContentRegistry();
  registerGreatTengu(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: greatTenguIds.hero, skillLevel: 1 };
  for (let i = 2; i <= 7; i++) {
    const unitId = `red-${i}`;
    initial.units[unitId] = { ...initial.units['red-1'], unitId };
    initial.sides.red.push(unitId);
  }
  const definition = registry.getHero(greatTenguIds.hero);
  const ultimate = definition.skills.find(skill => skill.id === greatTenguIds.ultimate);
  assert.equal(ultimate.resourceCost.amount, 3);
  assert.equal(ultimate.levels[0].ratio, .65);
  assert.equal(ultimate.levels[4].ratio, .75);
  const intent = { actorId: 'blue-1', skillId: greatTenguIds.ultimate, targetIds: initial.sides.red,
    shape: 'all-enemies', targetRelation: 'enemy' };
  assert.equal(ultimate.execute(createBattleContext(initial, () => .9), intent, ultimate.levels[0]).length, 28,
    '技能以四段命中全部七名目标');
  const handler = definition.handlers.hit;
  let current = initial;
  for (let hitIndex = 0; hitIndex < 4; hitIndex++) {
    for (const targetId of initial.sides.red) {
      const event = { eventId: `tengu-${hitIndex}-${targetId}`, phase: 'hit', source: { kind: 'skill', id: greatTenguIds.ultimate, unitId: 'blue-1' },
        type: 'damage', targetId, damageKind: 'normal', amount: 10, hpBefore: 60, hpAfter: 50,
        hpLost: 10, mitigated: 0, isCritical: false, attackId: 99, hitIndex: hitIndex * 7 };
      const commands = handler.handle(createBattleContext(current, () => .9), event) ?? [];
      current = applyEffectCommands(current, commands, 'hit', `tengu-hit-${hitIndex}-${targetId}`, id => registry.getStatus(id)).state;
    }
  }
  const tengu = current.units['blue-1'];
  assert.equal(tengu.statuses.filter(status => status.statusId === greatTenguIds.attackTarget).length, 6,
    '单次攻击最多记录六名不同目标');
  assert.equal(tengu.statuses.find(status => status.statusId === greatTenguIds.fierce).stacks, 6);
  assert.equal(tengu.actionGauge, 30, '同一目标四段命中只增加一次5%行动条');
  const cleanup = definition.handlers['attack-end'].handle(createBattleContext(current, () => .5), {
    eventId: 'tengu-attack-end', phase: 'attack-end', source: { kind: 'skill', id: greatTenguIds.ultimate, unitId: 'blue-1' },
    type: 'attack-ended', attackId: 99, hitCount: 28 });
  const cleaned = applyEffectCommands(current, cleanup, 'attack-end', 'tengu-cleanup', id => registry.getStatus(id));
  assert.equal(cleaned.state.units['blue-1'].statuses.filter(status => status.statusId === greatTenguIds.attackTarget).length, 0);
  assert.equal(cleaned.state.units['blue-1'].statuses.find(status => status.statusId === greatTenguIds.fierce).stacks, 6);
});

test('Great Tengu level-five shelter schedules a free, fully resolved ultimate after blocking control', () => {
  const registry = new ContentRegistry();
  registerGreatTengu(registry);
  const controlStatus = 'test.great-tengu-control';
  registry.registerStatus({ id: controlStatus, category: 'control', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  const attackerSkill = { id: 'test.control-attack', actionKind: 'skill', target: 'single', targetRelation: 'enemy', levels: [{}],
    execute(_context, intent) { return [{ type: 'apply-control', source: { kind: 'skill', id: 'test.control-attack', unitId: intent.actorId },
      targetId: intent.targetIds[0], instance: { instanceId: 'test.control', statusId: controlStatus,
        source: { kind: 'skill', id: 'test.control-attack', unitId: intent.actorId }, stacks: 1,
        duration: { kind: 'count', remaining: 1, owner: 'target-turn' } } }]; } };
  registry.registerHero({ id: 999, skills: [attackerSkill], aiCoverage: 'verified', mechanicsCoverage: 'verified',
    policy(_context, unitId) { return { actorId: unitId, skillId: attackerSkill.id, targetIds: ['blue-1'], shape: 'single', targetRelation: 'enemy' }; } });
  const initial = state();
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: greatTenguIds.hero, skillLevel: 5,
    stats: { ...initial.units['blue-1'].stats, speed: 100, attack: 10 } };
  initial.units['red-1'] = { ...initial.units['red-1'], heroId: 999,
    stats: { ...initial.units['red-1'].stats, speed: 200, hp: 1000 }, hp: 1000 };
  const result = runBattle(initial, registry, { seed: 47, actionLimit: 2 });
  const freeCast = result.events.find(event => event.type === 'action-scheduled' && event.freeCast);
  assert.ok(freeCast, '庇护阻挡控制后排入免付费的追加行动');
  assert.ok(result.events.some(event => event.type === 'action-declared' && event.intent.actorId === 'blue-1'
    && event.intent.skillId === greatTenguIds.ultimate));
  assert.equal(result.state.resources.blue.fire, 4);
  const renewed = registry.getHero(greatTenguIds.hero).handlers['turn-end'].handle(createBattleContext(result.state, () => .5), {
    eventId: 'tengu-turn-end', phase: 'turn-end', source: { kind: 'unit', id: String(greatTenguIds.hero), unitId: 'blue-1' },
    type: 'turn-ended', unitId: 'blue-1' });
  const renewal = applyEffectCommands(result.state, renewed, 'turn-end', 'tengu-shelter-renewal', id => registry.getStatus(id));
  assert.ok(renewal.state.units['blue-1'].statuses.some(status => status.statusId === greatTenguIds.shelter),
    '回合结束后重新获得庇护');
});

test('Yatagarasu invites the highest-base-attack ally, clears its control, and grants gauge on allied basics', () => {
  const registry = new ContentRegistry();
  registerYatagarasu(registry);
  registerZashiki(registry);
  const controlStatus = 'test.yatagarasu-control';
  registry.registerStatus({ id: controlStatus, category: 'control', dispellable: false, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: yatagarasuIds.hero, skillLevel: 4 };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: zashikiIds.hero,
    stats: { ...initial.units['blue-1'].stats, attack: 300 }, statuses: [{ instanceId: 'zashiki-control', statusId: controlStatus,
      source: { kind: 'skill', id: 'test.control', unitId: 'red-1' }, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }] };
  initial.sides.blue.push('blue-2');
  const hero = registry.getHero(yatagarasuIds.hero);
  const basic = hero.skills.find(skill => skill.id === yatagarasuIds.basic);
  const ultimate = hero.skills.find(skill => skill.id === yatagarasuIds.ultimate);
  assert.deepEqual(basic.levels.map(level => level.ratio), [.8, .9, .9, 1, 1]);
  assert.equal(ultimate.resourceCost.amount, 3);
  assert.deepEqual([ultimate.levels[0].ratio, ultimate.levels[4].ratio], [1.19, 1.43]);
  const policyContext = createBattleContext(initial, () => .5);
  assert.equal(hero.policy(policyContext, 'blue-1').skillId, yatagarasuIds.basic,
    '一名敌人且不超过5火时选择普攻');
  initial.resources.blue.fire = 6;
  assert.equal(hero.policy(policyContext, 'blue-1').skillId, yatagarasuIds.ultimate,
    '鬼火超过5时改用群攻');
  initial.resources.blue.fire = 3;
  initial.units['red-2'] = { ...initial.units['red-1'], unitId: 'red-2', hp: 80 };
  initial.sides.red.push('red-2');
  assert.deepEqual(hero.policy(policyContext, 'blue-1').targetIds, ['red-1', 'red-2'],
    '群攻按敌方生命比例从低到高排序');
  initial.sides.red.pop();
  delete initial.units['red-2'];
  initial.resources.blue.fire = 4;
  const handler = hero.handlers['attack-end'];
  const attackEnded = { eventId: 'crow-basic-end', phase: 'attack-end', source: { kind: 'skill', id: yatagarasuIds.basic, unitId: 'blue-1' },
    type: 'attack-ended', attackId: 52, hitCount: 1,
    targetHealthChanges: [{ targetId: 'red-1', hpBefore: 60, hpAfter: 50, hpLost: 10 }] };
  const commands = handler.handle(createBattleContext(initial, () => .1, id => registry.getStatus(id)?.category), attackEnded);
  assert.deepEqual(commands.map(command => command.type), ['remove-statuses', 'schedule-action']);
  assert.equal(commands[0].targetId, 'blue-2');
  assert.deepEqual(commands[0].statusIds, [controlStatus]);
  assert.equal(commands[1].intent.actorId, 'blue-2');
  assert.equal(commands[1].intent.kind, 'passive');
  assert.equal(commands[1].scheduling, 'assist');
  assert.equal(commands[1].parentEventId, attackEnded.eventId);
  const cleansed = applyEffectCommands(initial, commands.slice(0, 1), 'attack-end', 'crow-cleanse', id => registry.getStatus(id));
  assert.equal(cleansed.state.units['blue-2'].statuses.length, 0);
  const assist = executeAction(cleansed.state, commands[1].intent, registry, () => .5,
    { resolveStatus: id => registry.getStatus(id) });
  assert.equal(assist.events.find(event => event.type === 'action-ended').actionKind, 'passive');

  const passive = hero.handlers['action-end'].handle(createBattleContext(initial, () => .5), {
    eventId: 'ally-basic-end', phase: 'action-end', source: { kind: 'skill', id: 'ally.basic', unitId: 'blue-2' },
    type: 'action-ended', skillId: 'ally.basic', actionKind: 'basic', soulTriggersAllowed: true });
  assert.deepEqual(passive.map(command => [command.targetId, command.amount]), [['blue-1', 5]]);
});

test('Yatagarasu turn start independently removes one control from itself and a random ally', () => {
  const registry = new ContentRegistry();
  registerYatagarasu(registry);
  const controlStatus = 'test.yatagarasu-turn-control';
  registry.registerStatus({ id: controlStatus, category: 'control', dispellable: false, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  const initial = state();
  const controlled = unit => ({ ...unit, statuses: [{ instanceId: `control:${unit.unitId}`, statusId: controlStatus,
    source: { kind: 'skill', id: 'test.control', unitId: 'red-1' }, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }] });
  initial.units['blue-1'] = controlled({ ...initial.units['blue-1'], heroId: yatagarasuIds.hero, skillLevel: 5 });
  initial.units['blue-2'] = controlled({ ...initial.units['blue-1'], unitId: 'blue-2', heroId: zashikiIds.hero });
  initial.sides.blue.push('blue-2');
  const handler = registry.getHero(yatagarasuIds.hero).handlers['turn-start'];
  const commands = handler.handle(createBattleContext(initial, (() => { const rolls = [.5, .2, .9, .3]; return () => rolls.shift(); })(),
    id => registry.getStatus(id)?.category), { eventId: 'crow-turn-start', phase: 'turn-start',
    source: { kind: 'unit', id: String(yatagarasuIds.hero), unitId: 'blue-1' }, type: 'turn-started', unitId: 'blue-1' });
  assert.deepEqual(commands.map(command => command.targetId), ['blue-1', 'blue-2']);
  const result = applyEffectCommands(initial, commands, 'turn-start', 'crow-cleanse-turn', id => registry.getStatus(id));
  assert.equal(result.state.units['blue-1'].statuses.length, 0);
  assert.equal(result.state.units['blue-2'].statuses.length, 0);
});

test('coverage distinguishes verified, partial, and missing hero, soul, and status rules', () => {
  const registry = new ContentRegistry();
  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [] });
  registry.registerSoul({ id: 'soul.ember', mechanicsCoverage: 'partial' });
  registry.registerStatus({ id: 'status.seal', mechanicsCoverage: 'verified', dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const roster = [{ heroId: 1, soulId: 'soul.ember', statuses: [{ statusId: 'status.seal' }] },
    { heroId: 2, soulId: 'soul.unknown', statuses: [{ statusId: 'status.unknown' }] }];
  const diagnostics = diagnoseContentCoverage(roster, registry);
  assert.ok(diagnostics.some(item => item.contentId === 'soul.ember' && item.status === 'partial'));
  assert.ok(diagnostics.some(item => item.contentId === '2' && item.aspect === 'ai' && item.status === 'unsupported'));
  assert.ok(diagnostics.some(item => item.contentId === 'status.unknown' && item.status === 'unsupported'));
  assert.equal(isRosterFullyMigrated(roster, registry), false);
  assert.equal(isRosterFullyMigrated([{ heroId: 1, statuses: [{ statusId: 'status.seal' }] }], registry), true);
});

test('coverage diagnostics distinguish verified and partial roster content', () => {
  const registry = new ContentRegistry();
  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [] });
  registry.registerHero({ id: 2, aiCoverage: 'verified', mechanicsCoverage: 'partial', skills: [] });
  const roster = [{ heroId: 1 }, { heroId: 2 }];
  assert.deepEqual(diagnoseContentCoverage(roster, registry).map(item => item.status), ['verified', 'verified', 'verified', 'partial']);
  assert.equal(isRosterFullyMigrated(roster, registry), false);
  assert.equal(isRosterFullyMigrated(roster.slice(0, 1), registry), true);
});

test('截图阵容的式神与御魂都进入注册表，未完整迁移项保留覆盖诊断', () => {
  const registry = createMigratedContentRegistry();
  const lineup = [
    { heroId: 247, soulId: 'soul:300036' }, { heroId: 396, soulId: 'soul:300010' },
    { heroId: 600, soulId: 'soul:300080' }, { heroId: 331, soulId: 'soul:300049' },
    { heroId: 395, soulId: 'soul:300006' }, { heroId: 391, soulId: 'soul:300083' },
    { heroId: 306, soulId: 'soul:300003' }, { heroId: 362, soulId: 'soul:300010' },
    { heroId: 356, soulId: 'soul:300049' }, { heroId: 392, soulId: 'soul:300049' },
  ];
  const diagnostics = diagnoseContentCoverage(lineup, registry);
  assert.equal(diagnostics.some(item => item.status === 'unsupported'), false);
  assert.ok(diagnostics.some(item => item.status === 'partial'));
  assert.match(diagnostics.find(item => item.contentType === 'hero' && item.contentId === '356' && item.aspect === 'mechanics').message,
    /汐梦控制命中时窗、致命伤害后的恢复\/阵亡处理/);
  assert.match(diagnostics.find(item => item.contentType === 'hero' && item.contentId === '392' && item.aspect === 'mechanics').message,
    /多目标选择权重/);
  assert.deepEqual(new Set(lineup.map(unit => unit.heroId).filter(id => registry.getHero(id))),
    new Set(lineup.map(unit => unit.heroId)));
  assert.deepEqual(new Set(lineup.map(unit => unit.soulId).filter(id => registry.getSoul(id))),
    new Set(lineup.map(unit => unit.soulId)));
});

test('截图十名式神与七类御魂在完整五对五中通过新引擎完成阶段结算', () => {
  const panel = (hp, attack, defense, speed, crit, critDamage, hit, resist) => ({ hp, attack, defense, speed,
    crit: crit / 100, critDamage: critDamage / 100, hit: hit / 100, resist: resist / 100 });
  const fighter = (heroId, fourSuit, stats) => ({ heroId, fourSuit, skillLevel: 5, panel: stats });
  const input = {
    red: [fighter(247, '300036', panel(14728, 5741, 652, 205, 20, 150, 60, 64)),
      fighter(396, '300010', panel(19313, 4423, 710, 192, 35, 150, 60, 40)),
      fighter(600, '300080', panel(15286, 4667, 496, 166, 48, 206, 0, 15)),
      fighter(331, '300049', panel(14374, 3541, 541, 127, 10, 255, 0, 135)),
      fighter(395, '300006', panel(16858, 2710, 563, 111, 30, 220, 0, 0))],
    blue: [fighter(391, '300083', panel(14973, 6103, 764, 207, 110, 220, 30, 0)),
      fighter(306, '300003', panel(32882, 3014, 818, 199, 88, 164, 0, 56)),
      fighter(362, '300010', panel(15087, 4131, 884, 121, 38, 206, 0, 24)),
      fighter(356, '300049', panel(14585, 3434, 514, 121, 8, 248, 0, 31)),
      fighter(392, '300049', panel(15451, 5654, 602, 118, 0, 213, 0, 0))],
  };
  const result = runBattle(createBattleState(input), createMigratedContentRegistry(), { seed: 20261008, actionLimit: 120 });
  assert.notEqual(result.reason, 'trigger-budget', '目标阵容的组合触发不应耗尽引擎预算');
  const actedHeroes = new Set(result.events.filter(event => event.type === 'action-declared')
    .map(event => result.state.units[event.intent.actorId]?.heroId));
  assert.deepEqual([...actedHeroes].sort((a, b) => a - b), [247, 306, 331, 356, 362, 391, 392, 395, 396, 600]);
  assert.ok(Object.values(result.state.units).some(unit => unit.heroId === chihimeIds.hero && unit.side === 'blue'
    && unit.statuses.some(status => status.statusId === chihimeIds.enemySkillGaugeTriggered)),
  '完整截图阵容的实际新引擎流程应结算千姬持戟后的敌方首次妖术触发');
});

test('legacy roster adapter gives duplicate heroes distinct unit IDs without changing the input shape', () => {
  const input = { blue: [
    { heroId: 231, fourSuit: '', skillLevel: 5, panel: { hp: 1000, attack: 200, defense: 100, speed: 120, crit: 0, critDamage: 1.5, hit: 0, resist: 0 } },
    { heroId: 231, fourSuit: '', skillLevel: 4, panel: { hp: 900, attack: 180, defense: 90, speed: 100, crit: 0, critDamage: 1.5, hit: 0, resist: 0 } },
  ], red: [] };
  const adapted = createBattleState(input);
  assert.deepEqual(adapted.sides.blue, ['blue:1:231', 'blue:2:231']);
  assert.notEqual(adapted.units['blue:1:231'].unitId, adapted.units['blue:2:231'].unitId);
  assert.equal(adapted.units['blue:1:231'].unitKind, 'shikigami');
  assert.equal(adapted.units['blue:2:231'].unitKind, 'shikigami');
  assert.equal(adapted.units['blue:2:231'].heroId, 231);
  assert.equal(adapted.units['blue:2:231'].skillLevel, 4);
});

test('action scheduler advances the whole queue and picks a seeded tie; action limit uses team life ratios', () => {
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], stats: { ...initial.units['blue-1'].stats, speed: 100 }, actionGauge: 0 };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, speed: 100 }, actionGauge: 0 };
  const first = scheduleNextActor(initial, () => 0.9);
  assert.equal(first.actorId, 'red-1');
  assert.equal(first.state.units['blue-1'].actionGauge, 100);
  assert.equal(first.state.units['red-1'].actionGauge, 0);
  assert.equal(checkBattleEnd(initial), undefined);
  const capped = { ...initial, counters: { ...initial.counters, action: 600 },
    units: { ...initial.units, 'blue-1': { ...initial.units['blue-1'], hp: 75 }, 'red-1': { ...initial.units['red-1'], hp: 40 } } };
  assert.deepEqual(checkBattleEnd(capped), { winner: 'blue', reason: 'action-limit', blueRemainingRatio: 0.75, redRemainingRatio: 40 / 60 });
});

test('modular battle runs registered policies to elimination reproducibly; event capture does not affect state', () => {
  const registry = new ContentRegistry();
  const basic = createBasicAttackSkill('common.basic', [1]);
  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [basic], policy(context, actorId) {
    const actor = context.getUnit(actorId);
    const targetSide = actor.side === 'blue' ? 'red' : 'blue';
    const target = context.getLivingUnits(targetSide)[0];
    return target ? { actorId, skillId: basic.id, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' } : undefined;
  } });
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], stats: { ...initial.units['blue-1'].stats, hp: 1000, attack: 200, speed: 200 }, hp: 1000 };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, hp: 100, attack: 1, speed: 100 }, hp: 100, shield: 0 };
  const first = runBattle(initial, registry, { seed: 99 });
  const second = runBattle(initial, registry, { seed: 99 });
  const quiet = runBattle(initial, registry, { seed: 99, captureEvents: false });
  assert.equal(first.winner, 'blue');
  assert.equal(first.reason, 'elimination');
  assert.equal(first.seed, 99);
  assert.deepEqual(first.state, second.state);
  assert.deepEqual(first.events, second.events);
  assert.deepEqual(first.state, quiet.state);
  assert.deepEqual(quiet.events, []);
  assert.deepEqual(first.events.map(event => event.type).filter(type => ['battle-started', 'action-declared', 'attack-start', 'damage', 'attack-ended', 'battle-ended'].includes(type)),
    ['battle-started', 'action-declared', 'attack-start', 'damage', 'attack-ended', 'battle-ended']);
  assert.ok(first.diagnostics.length > 0);
  assert.ok(first.diagnostics.every(item => item.status === 'verified'));
});

test('modular battle ends at its action cap using remaining life ratios', () => {
  const registry = new ContentRegistry();
  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [] });
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], stats: { ...initial.units['blue-1'].stats, hp: 100 }, hp: 75, shield: 0 };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, hp: 100 }, hp: 40, shield: 0 };
  const result = runBattle(initial, registry, { seed: 1, actionLimit: 2 });
  assert.equal(result.reason, 'action-limit');
  assert.equal(result.winner, 'blue');
  assert.equal(result.state.counters.action, 2);
  assert.equal(result.events.at(-1).type, 'battle-ended');
});

test('battle definitions initialize once and battle-start handlers produce linked effects', () => {
  const registry = new ContentRegistry();
  const change = (amount, id) => ({ type: 'change-resource', source: { kind: 'unit', id, unitId: 'blue-1' },
    side: 'blue', resourceId: 'fire', amount });
  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [],
    initialize(context, unitId) {
      if (unitId === 'blue-1') context.submit(change(2, 'opening'));
      return [];
    },
    handlers: { 'battle-start': { priority: 10, handle: (_context, event) => event.type === 'battle-started' ? [change(1, 'opening-passive')] : [] } },
  });
  const result = runBattle(state(), registry, { seed: 1, actionLimit: 0 });
  assert.equal(result.state.resources.blue.fire, 7);
  const resourceEvents = result.events.filter(event => event.type === 'resource-changed');
  assert.deepEqual(resourceEvents.map(event => [event.before, event.after, event.parentEventId]), [
    [4, 6, 'battle-start'], [6, 7, 'battle-start'],
  ]);
});

test('火灵 and 蚌精 migrate as opening rules and expose their resource and shield events', () => {
  const registry = new ContentRegistry();
  registerBaselineSouls(registry);
  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [] });
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: baselineSoulIds.shell };
  initial.units['red-1'] = { ...initial.units['red-1'], soulId: baselineSoulIds.fire };
  const result = runBattle(initial, registry, { seed: 9, actionLimit: 0 });
  assert.equal(result.state.resources.blue.fire, 4);
  assert.equal(result.state.resources.red.fire, 7);
  assert.equal(result.state.units['blue-1'].statuses.find(status => status.statusId === shieldStatusId).values.shieldRemaining, 10);
  assert.ok(result.events.some(event => event.type === 'status-added' && event.parentEventId === 'battle-start'));
  assert.ok(result.diagnostics.every(item => item.status === 'verified'));
});

test('破势 applies its outgoing multiplier through the generic damage hook', () => {
  const registry = new ContentRegistry();
  registerBaselineSouls(registry);
  const basic = createBasicAttackSkill('common.basic', [1]);
  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [basic], policy(context, actorId) {
    const actor = context.getUnit(actorId);
    const target = context.getLivingUnits(actor.side === 'blue' ? 'red' : 'blue')[0];
    return target ? { actorId, skillId: basic.id, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' } : undefined;
  } });
  const makeInitial = soulId => {
    const initial = state();
    initial.counters = { ...initial.counters, action: 0 };
    initial.units['blue-1'] = { ...initial.units['blue-1'], soulId,
      stats: { ...initial.units['blue-1'].stats, hp: 1000, attack: 100, speed: 200 }, hp: 1000 };
    initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, hp: 1000, speed: 100 }, hp: 750, shield: 0 };
    return initial;
  };
  const withBreak = runBattle(makeInitial(baselineSoulIds.break), registry, { seed: 89, actionLimit: 1 });
  const baselineHit = runBattle(makeInitial(undefined), registry, { seed: 89, actionLimit: 1 });
  const soulDamage = withBreak.events.find(event => event.type === 'damage').amount;
  const plainDamage = baselineHit.events.find(event => event.type === 'damage').amount;
  assert.ok(Math.abs(soulDamage / plainDamage - 1.4) < 1e-10);
  assert.ok(withBreak.diagnostics.some(item => item.contentId === baselineSoulIds.break && item.status === 'verified'));
});

test('针女追加真实伤害 and 地藏像 add one-turn shield statuses from critical-hit rules', () => {
  const registry = new ContentRegistry();
  registerBaselineSouls(registry);
  registry.registerStatus({ id: 'test.taunt', mechanicsCoverage: 'verified', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: baselineSoulIds.needle,
    stats: { ...initial.units['blue-1'].stats, attack: 150 } };
  initial.units['red-1'] = { ...initial.units['red-1'], soulId: baselineSoulIds.jizo,
    stats: { ...initial.units['red-1'].stats, hp: 1000 }, hp: 1000, shield: 0 };
  initial.units['red-2'] = { ...initial.units['red-1'], unitId: 'red-2', hp: 1000,
    statuses: [{ instanceId: 'taunt', statusId: 'test.taunt', source: { kind: 'skill', id: 'test.taunt' }, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { controlType: '嘲讽' } }] };
  initial.sides = { blue: ['blue-1'], red: ['red-1', 'red-2'] };
  const hit = { type: 'damage', eventId: 'critical-hit', phase: 'hit', source: { kind: 'skill', id: 'basic', unitId: 'blue-1' },
    actionId: 1, attackId: 1, hitIndex: 1, targetId: 'red-1', damageKind: 'normal', amount: 200, hpLost: 200, mitigated: 0, isCritical: true };

  const needleContext = createBattleContext(initial, () => 0);
  registry.getSoul(baselineSoulIds.needle).handlers.hit.handle(needleContext, hit);
  const needleCommands = needleContext.drainCommands();
  assert.equal(needleCommands.length, 1);
  assert.equal(needleCommands[0].type, 'deal-damage');
  assert.equal(needleCommands[0].damageKind, 'true');
  assert.equal(needleCommands[0].amount, 100);

  const boosted = { ...initial, units: { ...initial.units,
    'blue-1': { ...initial.units['blue-1'], statuses: [{ instanceId: 'attack-up', statusId: 'test.attack-up',
      source: { kind: 'skill', id: 'test.attack-up', unitId: 'blue-1' }, stacks: 1, duration: { kind: 'permanent' },
      modifiers: [{ stat: 'attack', operation: 'percent', amount: 1 }] }] },
    'red-1': { ...initial.units['red-1'], hp: 100000, stats: { ...initial.units['red-1'].stats, hp: 100000 } },
  } };
  const boostedContext = createBattleContext(boosted, () => 0);
  registry.getSoul(baselineSoulIds.needle).handlers.hit.handle(boostedContext, hit);
  assert.equal(boostedContext.drainCommands()[0].amount, 360,
    '针女120%攻击上限使用触发时的有效攻击，包含战斗中的攻击强化');

  const jizoContext = createBattleContext(initial, () => 0.99, id => registry.getStatus(id)?.category);
  registry.getSoul(baselineSoulIds.jizo).handlers.hit.handle(jizoContext, hit);
  const jizoCommands = jizoContext.drainCommands();
  assert.equal(jizoCommands.length, 1);
  assert.equal(jizoCommands[0].type, 'add-status');
  assert.equal(jizoCommands[0].instance.statusId, shieldStatusId);
  assert.equal(jizoCommands[0].instance.values.shieldRemaining, 100);
  const tauntedContext = createBattleContext(initial, () => .1, id => registry.getStatus(id)?.category);
  registry.getSoul(baselineSoulIds.jizo).handlers.hit.handle(tauntedContext, hit);
  assert.equal(tauntedContext.drainCommands().length, 2);
  const tauntedSelfRolls = [.99, .39];
  const tauntedSelfContext = createBattleContext(initial, () => tauntedSelfRolls.shift() ?? .99,
    id => registry.getStatus(id)?.category);
  registry.getSoul(baselineSoulIds.jizo).handlers.hit.handle(tauntedSelfContext, { ...hit, targetId: 'red-2' });
  const tauntedSelfCommands = tauntedSelfContext.drainCommands();
  assert.deepEqual(tauntedSelfCommands.map(command => command.targetId), ['red-2'],
    '嘲讽目标自身的地藏触发概率应从100%降低60%，并独立于其他友方的30%判定');
  const unrelatedTargetContext = createBattleContext(initial, () => .1, id => registry.getStatus(id)?.category);
  registry.getSoul(baselineSoulIds.jizo).handlers.hit.handle(unrelatedTargetContext, { ...hit, targetId: 'blue-1' });
  assert.equal(unrelatedTargetContext.drainCommands().length, 0);
});

test('木魅按攻击者行动限次扣火，并按嘲讽降低触发概率', () => {
  const registry = new ContentRegistry();
  registerWoodCharm(registry);
  registry.registerStatus({ id: 'test.wood-taunt', mechanicsCoverage: 'verified', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const hit = { type: 'damage', eventId: 'wood-hit-1', phase: 'hit', source: { kind: 'skill', id: 'basic', unitId: 'blue-1' },
    actionId: 9, attackId: 3, hitIndex: 1, targetId: 'red-1', damageKind: 'normal', amount: 50, hpLost: 50, mitigated: 0, isCritical: false };
  const initial = state();
  initial.units['red-1'] = { ...initial.units['red-1'], soulId: woodCharmIds.soul };
  const definition = registry.getSoul(woodCharmIds.soul);
  const context = createBattleContext(initial, () => .2, id => registry.getStatus(id)?.category);
  const commands = definition.handlers.hit.handle(context, hit);
  assert.equal(commands.length, 2);
  assert.deepEqual({ type: commands[0].type, side: commands[0].side, resourceId: commands[0].resourceId, amount: commands[0].amount },
    { type: 'change-resource', side: 'blue', resourceId: 'fire', amount: -1 });
  assert.equal(commands[1].instance.statusId, woodCharmIds.triggerStatus);
  assert.equal(commands[1].instance.values.actionId, 9);

  const alreadyTriggered = { ...initial, units: { ...initial.units,
    'blue-1': { ...initial.units['blue-1'], statuses: [{ instanceId: 'wood-limit', statusId: woodCharmIds.triggerStatus,
      source: { kind: 'soul', id: woodCharmIds.soul }, stacks: 1, duration: { kind: 'permanent' }, values: { actionId: 9 } }] } } };
  const sameActionContext = createBattleContext(alreadyTriggered, () => .1, id => registry.getStatus(id)?.category);
  const sameActionCommands = definition.handlers.hit.handle(sameActionContext, { ...hit, hitIndex: 2, eventId: 'wood-hit-2' });
  assert.equal(sameActionCommands?.length ?? 0, 0);
  const nextActionContext = createBattleContext(alreadyTriggered, () => .1, id => registry.getStatus(id)?.category);
  const nextActionCommands = definition.handlers.hit.handle(nextActionContext, { ...hit, actionId: 10, eventId: 'wood-hit-next-action' });
  assert.equal(nextActionCommands?.length ?? 0, 2);

  initial.units['red-1'] = { ...initial.units['red-1'], statuses: [{ instanceId: 'taunt', statusId: 'test.wood-taunt',
    source: { kind: 'skill', id: 'taunt' }, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
    values: { controlType: '嘲讽' } }] };
  const tauntedContext = createBattleContext(initial, () => .15, id => registry.getStatus(id)?.category);
  const tauntedCommands = definition.handlers.hit.handle(tauntedContext, hit);
  assert.equal(tauntedCommands?.length ?? 0, 0);
});

test('返魂香按基础概率与抵抗判定眩晕，眩晕状态会消耗行动', () => {
  const registry = new ContentRegistry();
  registerReturnIncense(registry);
  registry.registerStatus({ id: 'test.taunt', mechanicsCoverage: 'verified', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const initial = state();
  initial.units['red-1'] = { ...initial.units['red-1'], soulId: returnIncenseIds.soul };
  const hit = { type: 'damage', eventId: 'incense-hit', phase: 'hit', source: { kind: 'skill', id: 'basic', unitId: 'blue-1' },
    actionId: 5, attackId: 2, hitIndex: 1, targetId: 'red-1', damageKind: 'normal', amount: 50, hpLost: 50, mitigated: 0, isCritical: false };
  const soul = registry.getSoul(returnIncenseIds.soul);
  const commands = soul.handlers.hit.handle(createBattleContext(initial, () => 0), hit);
  assert.equal(commands[0].type, 'apply-control');
  assert.equal(commands[0].instance.statusId, returnIncenseIds.stun);
  assert.equal(commands[0].instance.values.controlType, '眩晕');

  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [
    createBasicAttackSkill('test.basic', [1]),
  ] });
  const applied = applyEffectCommands(initial, commands, 'hit', 'incense-test', id => registry.getStatus(id));
  assert.ok(applied.events.some(event => event.type === 'control-applied'));
  assert.ok(applied.state.units['blue-1'].statuses.some(status => status.statusId === returnIncenseIds.stun));
  const blockedAction = executeAction(applied.state, { actorId: 'blue-1', skillId: 'test.basic', targetIds: ['red-1'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => 0, { resolveStatus: id => registry.getStatus(id) });
  assert.equal(blockedAction.accepted, false);
  assert.equal(blockedAction.failure, 'controlled');

  initial.units['red-1'] = { ...initial.units['red-1'], statuses: [{ instanceId: 'taunt', statusId: 'test.taunt',
    source: { kind: 'skill', id: 'taunt' }, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
    values: { controlType: '嘲讽' } }] };
  const tauntedRoll = soul.handlers.hit.handle(createBattleContext(initial, () => .15, id => registry.getStatus(id)?.category), hit);
  assert.equal(tauntedRoll?.length ?? 0, 0);
});

test('钟灵在己方无人眩晕时使用20%基础概率，有队友眩晕时降为10%', () => {
  const registry = new ContentRegistry();
  registerBellSpirit(registry);
  const hit = { type: 'damage', eventId: 'bell-spirit-hit', phase: 'hit', source: { kind: 'skill', id: 'basic', unitId: 'blue-1' },
    actionId: 5, attackId: 2, hitIndex: 1, targetId: 'red-1', damageKind: 'normal', amount: 50, hpLost: 50, mitigated: 0, isCritical: false };
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: bellSpiritIds.soul };
  const handler = registry.getSoul(bellSpiritIds.soul).handlers.hit.handle;
  const noStunContext = createBattleContext(initial, () => .15);
  const noStun = handler(noStunContext, hit);
  assert.equal(noStun?.[0].instance.statusId, bellSpiritIds.stun);

  initial.units['blue-1'] = { ...initial.units['blue-1'], statuses: [{ instanceId: 'existing-stun', statusId: bellSpiritIds.stun,
    source: { kind: 'skill', id: 'existing-stun' }, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { controlType: '眩晕' } }] };
  const stunnedAllyContext = createBattleContext(initial, () => .15);
  assert.equal(handler(stunnedAllyContext, hit)?.length ?? 0, 0);
});

test('雪幽魂受减速目标影响提高冰冻概率，受击时降低攻击者30点速度', () => {
  const registry = new ContentRegistry();
  registerSnowSpirit(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: snowSpiritIds.soul };
  const hit = { type: 'damage', eventId: 'snow-hit', phase: 'hit', source: { kind: 'skill', id: 'basic', unitId: 'blue-1' },
    actionId: 5, attackId: 2, hitIndex: 1, targetId: 'red-1', damageKind: 'normal', amount: 50, hpLost: 50, mitigated: 0, isCritical: false };
  const handler = registry.getSoul(snowSpiritIds.soul).handlers.hit.handle;
  assert.equal(handler(createBattleContext(initial, () => .2), hit)?.length ?? 0, 0,
    '未减速目标使用15%概率，0.2应未触发');
  initial.units['red-1'] = { ...initial.units['red-1'], statuses: [{ instanceId: 'slow', statusId: 'test.slow',
    source: { kind: 'skill', id: 'slow' }, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
    modifiers: [{ stat: 'speed', operation: 'flat', amount: -20 }] }] };
  const slowedTargetCommands = handler(createBattleContext(initial, () => .2), hit);
  assert.equal(slowedTargetCommands?.[0].instance.statusId, snowSpiritIds.freeze);

  initial.units['red-1'] = { ...initial.units['red-1'], soulId: snowSpiritIds.soul, statuses: [] };
  const defensiveCommands = handler(createBattleContext(initial, () => .99), hit);
  assert.equal(defensiveCommands?.[0].type, 'add-status');
  assert.equal(defensiveCommands?.[0].instance.statusId, snowSpiritIds.slow);
  assert.equal(defensiveCommands?.[0].instance.modifiers[0].amount, -30);
});

test('反枕以23%基础概率施加一回合睡眠控制', () => {
  const registry = new ContentRegistry();
  registerDreamPillow(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: dreamPillowIds.soul };
  const hit = { type: 'damage', eventId: 'dream-pillow-hit', phase: 'hit', source: { kind: 'skill', id: 'basic', unitId: 'blue-1' },
    actionId: 5, attackId: 2, hitIndex: 1, targetId: 'red-1', damageKind: 'normal', amount: 50, hpLost: 50, mitigated: 0, isCritical: false };
  const handler = registry.getSoul(dreamPillowIds.soul).handlers.hit.handle;
  assert.equal(registry.getStatus(dreamPillowIds.sleep).preventsAction, true);
  const applied = handler(createBattleContext(initial, () => .22), hit);
  assert.equal(applied?.[0].instance.statusId, dreamPillowIds.sleep);
  assert.equal(applied?.[0].instance.duration.remaining, 1);
  assert.equal(applied?.[0].instance.values.controlType, '睡眠');
  assert.equal(handler(createBattleContext(initial, () => .23), hit)?.length ?? 0, 0);
});

test('蝠翼按实际生命损失的20%治疗伤害来源并遵守生命上限', () => {
  const registry = new ContentRegistry();
  registerBatWing(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: batWingIds.soul, hp: 90 };
  const hit = { type: 'damage', eventId: 'bat-wing-hit', phase: 'hit', source: { kind: 'skill', id: 'basic', unitId: 'blue-1' },
    actionId: 5, attackId: 2, hitIndex: 1, targetId: 'red-1', damageKind: 'normal', amount: 60, hpLost: 40, mitigated: 20, isCritical: false };
  const handler = registry.getSoul(batWingIds.soul).handlers.hit.handle;
  const commands = handler(createBattleContext(initial, () => 0), hit);
  assert.equal(commands[0].type, 'heal');
  assert.equal(commands[0].amount, 8);
  assert.equal(commands[0].targetId, 'blue-1');
  const resolution = applyEffectCommands(initial, commands, 'hit', 'bat-wing-test');
  assert.equal(resolution.state.units['blue-1'].hp, 98);
  assert.equal(handler(createBattleContext(initial, () => 0), { ...hit, hpLost: 0 })?.length ?? 0, 0);
});

test('被服只将普通攻击伤害降低30%，真实伤害不经过该乘区', () => {
  const registry = new ContentRegistry();
  registerClothOfProtection(registry);
  const skill = { id: 'test.dual-damage', target: 'single', targetRelation: 'enemy', levels: [{}],
    execute(_context, intent) {
      const source = { kind: 'skill', id: 'test.dual-damage', unitId: intent.actorId };
      return [
        { type: 'deal-damage', source, targetId: intent.targetIds[0], amount: 100 },
        { type: 'deal-damage', source, targetId: intent.targetIds[0], amount: 100, damageKind: 'true' },
      ];
    } };
  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [skill],
    policy(_context, actorId) { return { actorId, skillId: skill.id, targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }; } });
  const initial = state();
  initial.counters = { ...initial.counters, action: 0 };
  initial.units['blue-1'] = { ...initial.units['blue-1'], stats: { ...initial.units['blue-1'].stats, speed: 200 } };
  initial.units['red-1'] = { ...initial.units['red-1'], soulId: clothOfProtectionIds.soul, hp: 1000, shield: 0,
    stats: { ...initial.units['red-1'].stats, hp: 1000 } };
  const result = runBattle(initial, registry, { seed: 5, actionLimit: 1 });
  const damage = result.events.filter(event => event.type === 'damage');
  assert.equal(damage[0].amount, 70);
  assert.equal(damage[1].amount, 100);
  assert.ok(result.diagnostics.some(item => item.contentId === clothOfProtectionIds.soul && item.status === 'verified'));
});

test('树妖按治疗前目标血线提高治疗量，再由通用治疗上限结算', () => {
  const registry = new ContentRegistry();
  registerTreeSpirit(registry);
  const skill = { id: 'test.tree-heal', target: 'single', targetRelation: 'ally', levels: [{}],
    execute(_context, intent) { return [{ type: 'heal', source: { kind: 'skill', id: 'test.tree-heal', unitId: intent.actorId },
      targetId: intent.targetIds[0], amount: 20 }]; } };
  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [skill],
    policy(_context, actorId) { return { actorId, skillId: skill.id, targetIds: ['blue-2'], shape: 'single', targetRelation: 'ally' }; } });
  const simulateHeal = hp => {
    const initial = state();
    initial.counters = { ...initial.counters, action: 0 };
    initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: treeSpiritIds.soul,
      stats: { ...initial.units['blue-1'].stats, hp: 100, speed: 200 }, hp: 100 };
    initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', soulId: undefined,
      hp: hp, stats: { ...initial.units['blue-1'].stats, hp: 100, speed: 50 } };
    initial.sides = { blue: ['blue-1', 'blue-2'], red: ['red-1'] };
    return runBattle(initial, registry, { seed: 5, actionLimit: 1 });
  };
  const lowHealth = simulateHeal(10);
  const standardHealth = simulateHeal(30);
  const lowHealEvent = lowHealth.events.find(event => event.type === 'healing');
  const standardHealEvent = standardHealth.events.find(event => event.type === 'healing');
  assert.equal(lowHealEvent.amount, 30);
  assert.equal(lowHealEvent.hpGained, 30);
  assert.equal(standardHealEvent.amount, 24);
  assert.equal(standardHealEvent.hpGained, 24);
});

test('珍珠依据治疗请求量施加两回合护盾，并遵守御魂封印与治疗转化边界', () => {
  const registry = new ContentRegistry();
  registerPearl(registry);
  registry.registerStatus({ id: soulSuppressionStatusId, mechanicsCoverage: 'verified', category: 'control', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const mirrorFormId = 'test.mirror-form';
  const mirrorShieldId = 'test.mirror-shield';
  registry.registerStatus({ id: mirrorShieldId, dispellable: false, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: mirrorFormId, dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace',
    healingConversionToShield: { ratio: .5, shieldStatusId: mirrorShieldId, duration: 2, durationOwner: 'target-turn' } });
  const skill = { id: 'test.pearl-heal', target: 'single', targetRelation: 'ally', levels: [{}],
    execute(_context, intent) { return [{ type: 'heal', source: { kind: 'skill', id: 'test.pearl-heal', unitId: intent.actorId },
      targetId: intent.targetIds[0], amount: 80 }]; } };
  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [skill],
    policy(_context, actorId) { return { actorId, skillId: skill.id, targetIds: ['blue-2'], shape: 'single', targetRelation: 'ally' }; } });
  const simulateHeal = (suppressed = false, converted = false) => {
    const initial = state();
    initial.counters = { ...initial.counters, action: 0 };
    initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: pearlIds.soul, stats: { ...initial.units['blue-1'].stats, speed: 200 },
      ...(suppressed ? { statuses: [{ instanceId: 'soul-sealed', statusId: soulSuppressionStatusId, source: { kind: 'system', id: 'test' },
        stacks: 1, duration: { kind: 'permanent' } }] } : {}) };
    initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', soulId: undefined, hp: 60,
      stats: { ...initial.units['blue-1'].stats, hp: 100, speed: 50 }, statuses: converted ? [{ instanceId: 'mirror-form', statusId: mirrorFormId,
        source: { kind: 'system', id: 'test' }, stacks: 1, duration: { kind: 'permanent' } }] : [] };
    initial.sides = { blue: ['blue-1', 'blue-2'], red: ['red-1'] };
    return runBattle(initial, registry, { seed: 5, actionLimit: 1 });
  };
  const healed = simulateHeal();
  const pearlShield = healed.state.units['blue-2'].statuses.find(status => status.statusId === pearlIds.shield);
  assert.equal(healed.events.find(event => event.type === 'healing').requestedAmount, 80);
  assert.equal(healed.events.find(event => event.type === 'healing').hpGained, 40);
  assert.equal(pearlShield.values.shieldRemaining, 24);
  assert.deepEqual(pearlShield.duration, { kind: 'count', remaining: 2, owner: 'target-turn' });
  assert.ok(healed.events.some(event => event.type === 'status-added' && event.instance.statusId === pearlIds.shield));
  assert.equal(simulateHeal(true).state.units['blue-2'].statuses.some(status => status.statusId === pearlIds.shield), false);
  const converted = simulateHeal(false, true);
  assert.ok(converted.events.some(event => event.type === 'healing-converted'));
  assert.equal(converted.events.some(event => event.type === 'healing'), false);
  assert.equal(converted.state.units['blue-2'].statuses.some(status => status.statusId === pearlIds.shield), false);
});

test('共潜按本回合伤害情况随机净化一次或三次，并通过事件记录移除来源', () => {
  const registry = new ContentRegistry();
  registerSoulDiver(registry);
  const curseIds = ['test.curse-a', 'test.curse-b', 'test.curse-c'];
  for (const id of curseIds) registry.registerStatus({ id, mechanicsCoverage: 'verified', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  let allowHit = true;
  const skill = { id: 'test.soul-diver-attack', target: 'single', targetRelation: 'enemy', levels: [{}],
    execute(_context, intent) { return [{ type: 'deal-damage', source: { kind: 'skill', id: 'test.soul-diver-attack', unitId: intent.actorId },
      targetId: intent.targetIds[0], amount: 10 }]; } };
  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [skill],
    policy(_context, actorId) { return actorId === 'blue-1' && allowHit ? { actorId, skillId: skill.id, targetIds: ['red-1'], shape: 'single',
      targetRelation: 'enemy' } : undefined; } });
  const simulateTurn = (hit) => {
    allowHit = hit;
    const initial = state();
    initial.counters = { ...initial.counters, action: 0 };
    initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: soulDiverIds.soul,
      stats: { ...initial.units['blue-1'].stats, speed: 200 }, statuses: hit ? [] : curseIds.map((statusId, index) => ({
        instanceId: `curse-${index}`, statusId, source: { kind: 'system', id: 'fixture' }, stacks: 1, duration: { kind: 'permanent' } })) };
    initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', soulId: undefined, stats: { ...initial.units['blue-1'].stats, speed: 50 },
      statuses: hit ? curseIds.map((statusId, index) => ({ instanceId: `curse-${index}`, statusId,
        source: { kind: 'system', id: 'fixture' }, stacks: 1, duration: { kind: 'permanent' } })) : [] };
    initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, speed: 25 } };
    initial.sides = { blue: ['blue-1', 'blue-2'], red: ['red-1'] };
    const result = runBattle(initial, registry, { seed: 17, actionLimit: 1 });
    return result;
  };
  const hit = simulateTurn(true);
  const hitDispels = hit.events.filter(event => event.type === 'status-removed' && event.reason === 'dispelled');
  assert.equal(hitDispels.length, 1);
  assert.ok(hitDispels[0].parentEventId);
  assert.equal(hit.state.units['blue-1'].statuses.some(status => status.statusId === soulDiverIds.dealtDamage), false);
  const idle = simulateTurn(false);
  assert.equal(idle.events.filter(event => event.type === 'status-removed' && event.reason === 'dispelled').length, 3);
  assert.equal(idle.state.units['blue-1'].statuses.some(status => status.statusId === soulDiverIds.dealtDamage), false);
});

test('共潜将被护盾吸收的伤害计作造成伤害，但不记录完全免疫的伤害', () => {
  const registry = new ContentRegistry(); registerSoulDiver(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: soulDiverIds.soul };
  const handler = registry.getSoul(soulDiverIds.soul).handlers.hit.handle;
  const damage = { eventId: 'soul-diver-shield-hit', phase: 'hit', type: 'damage', targetId: 'red-1',
    source: { kind: 'skill', id: 'test.attack', unitId: 'blue-1' }, amount: 100, hpLost: 0, shieldConsumed: 100,
    damageKind: 'normal', mitigated: 100, isCritical: false };
  const absorbed = handler(createBattleContext(initial, () => .5), damage);
  assert.equal(absorbed?.[0]?.type, 'add-status', '护盾被实际消耗，计作造成伤害');
  const immune = handler(createBattleContext(initial, () => .5), { ...damage, eventId: 'soul-diver-immune-hit', shieldConsumed: 0 });
  assert.equal(immune, undefined, '既未扣除生命，也未消耗护盾/额外生命时不算造成伤害');
});

test('共潜在所有友方负面状态实例中直接抽取，不先按单位等概率选人', () => {
  const registry = new ContentRegistry();
  registerSoulDiver(registry);
  for (const id of ['test.soul-diver-single', 'test.soul-diver-multiple']) {
    registry.registerStatus({ id, mechanicsCoverage: 'verified', category: 'debuff', dispellable: true,
      sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  }
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: soulDiverIds.soul, statuses: [{ instanceId: 'single-curse',
    statusId: 'test.soul-diver-single', source: { kind: 'system', id: 'test' }, stacks: 1, duration: { kind: 'permanent' } }] };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', statuses: [0, 1, 2].map(index => ({ instanceId: `multi-curse-${index}`,
    statusId: 'test.soul-diver-multiple', source: { kind: 'system', id: 'test' }, stacks: 1, duration: { kind: 'permanent' } })) };
  initial.sides.blue = ['blue-1', 'blue-2'];
  const handler = registry.getSoul(soulDiverIds.soul).handlers['turn-end'].handle;
  const commands = handler(createBattleContext(initial, () => .3, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable ?? false),
    { type: 'turn-ended', eventId: 'soul-diver-flat-pool', phase: 'turn-end', unitId: 'blue-1' });
  assert.equal(commands[0].targetId, 'blue-2', '等权抽取4个状态实例时第2项属于状态较多的队友');
  assert.equal(commands[0].instanceIds[0], 'multi-curse-0');
});

test('按实例净化时只移除随机选中的同类负面状态', () => {
  const registry = new ContentRegistry();
  const duplicateCurseId = 'test.duplicate-curse';
  registry.registerStatus({ id: duplicateCurseId, mechanicsCoverage: 'verified', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const initial = state();
  const keep = { instanceId: 'curse-first', statusId: duplicateCurseId,
    source: { kind: 'system', id: 'fixture' }, stacks: 1, duration: { kind: 'permanent' } };
  const remove = { ...keep, instanceId: 'curse-selected' };
  initial.units['blue-1'] = { ...initial.units['blue-1'], statuses: [keep, remove] };
  const result = applyEffectCommands(initial, [{ type: 'dispel-statuses', source: { kind: 'soul', id: soulDiverIds.soul },
    targetId: 'blue-1', instanceIds: ['curse-selected'], maxCount: 1 }], 'turn-end', 'soul-diver-instance-test', id => registry.getStatus(id));
  assert.deepEqual(result.state.units['blue-1'].statuses.map(status => status.instanceId), ['curse-first']);
  assert.equal(result.events.find(event => event.type === 'status-removed').instanceId, 'curse-selected');
});

test('涂佛只在普攻或受控中断的回合结束时增益队伍，伤害增益进入通用伤害修正', () => {
  const registry = new ContentRegistry();
  registerTulfo(registry);
  registry.registerStatus({ id: 'test.tulfo-control', mechanicsCoverage: 'verified', category: 'control', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  const attack = { id: 'test.tulfo-basic', actionKind: 'basic', target: 'single', targetRelation: 'enemy', levels: [{}],
    execute(_context, intent) { return [{ type: 'deal-damage', source: { kind: 'skill', id: 'test.tulfo-basic', unitId: intent.actorId },
      targetId: intent.targetIds[0], amount: 100 }]; } };
  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [attack],
    policy(_context, actorId) { return actorId === 'blue-1' ? { actorId, skillId: attack.id, targetIds: ['red-1'], shape: 'single',
      targetRelation: 'enemy' } : undefined; } });
  const initial = state();
  initial.counters = { ...initial.counters, action: 0 };
  initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: tulfoIds.soul,
    stats: { ...initial.units['blue-1'].stats, speed: 200, resist: .2 } };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', soulId: undefined,
    stats: { ...initial.units['blue-1'].stats, speed: 50, resist: .2 } };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, speed: 25, hp: 1000 }, hp: 1000 };
  initial.sides = { blue: ['blue-1', 'blue-2'], red: ['red-1'] };
  const basic = runBattle(initial, registry, { seed: 20, actionLimit: 1 });
  const selfBuff = basic.state.units['blue-1'].statuses.find(status => status.statusId === tulfoIds.blessing);
  const allyBuff = basic.state.units['blue-2'].statuses.find(status => status.statusId === tulfoIds.blessing);
  assert.deepEqual(selfBuff.modifiers.map(item => item.amount), [.3, .3]);
  assert.deepEqual(allyBuff.modifiers.map(item => item.amount), [.15, .15]);
  assert.equal(basic.state.units['blue-1'].stats.resist * (1 + selfBuff.modifiers[0].amount), .26);
  assert.deepEqual(selfBuff.duration, { kind: 'count', remaining: 2, owner: 'target-turn' });
  assert.equal(basic.events.some(event => event.type === 'status-added' && event.instance.statusId === tulfoIds.blessing
    && event.parentEventId?.startsWith('turn-')), true);

  const controlled = { ...initial, units: { ...initial.units, 'blue-1': { ...initial.units['blue-1'],
    statuses: [{ instanceId: 'control', statusId: 'test.tulfo-control', source: { kind: 'system', id: 'test' }, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }] } } };
  const interrupted = runBattle(controlled, registry, { seed: 20, actionLimit: 1 });
  assert.ok(interrupted.events.some(event => event.type === 'action-skipped' && event.reason === 'interrupted'));
  assert.ok(interrupted.state.units['blue-1'].statuses.some(status => status.statusId === tulfoIds.blessing));

  const boosted = { ...initial, units: { ...initial.units, 'blue-1': { ...initial.units['blue-1'], soulId: undefined,
    statuses: [{ instanceId: 'existing-tulfo', statusId: tulfoIds.blessing, source: { kind: 'soul', id: tulfoIds.soul,
      unitId: 'blue-2' }, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
      modifiers: [{ stat: 'damage', operation: 'percent', amount: .3 }] }] } } };
  const boostedHit = runBattle(boosted, registry, { seed: 20, actionLimit: 1 });
  assert.equal(boostedHit.events.find(event => event.type === 'damage').amount, 130);
});

test('钓瓶火回合结束额外推进鬼火条，并按携带者防御治疗生命比例最低友方', () => {
  const registry = new ContentRegistry();
  registerTubingFire(registry);
  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [] });
  const initial = state();
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: tubingFireIds.soul, hp: 80,
    stats: { ...initial.units['blue-1'].stats, hp: 100, defense: 10, speed: 200 } };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', soulId: undefined, hp: 20,
    stats: { ...initial.units['blue-1'].stats, hp: 100, defense: 0, speed: 50 } };
  initial.units['blue-3'] = { ...initial.units['blue-1'], unitId: 'blue-3', soulId: undefined, hp: 50,
    stats: { ...initial.units['blue-1'].stats, hp: 100, defense: 0, speed: 40 } };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, speed: 20 } };
  initial.sides = { blue: ['blue-1', 'blue-2', 'blue-3'], red: ['red-1'] };
  initial.resources.blue.fire = 4;
  initial.resourceMeters.blue.fire = { ...initial.resourceMeters.blue.fire, progress: 3, nextSupply: 3 };
  const result = runBattle(initial, registry, { seed: 21, actionLimit: 1 });
  const healing = result.events.find(event => event.type === 'healing');
  assert.equal(healing.targetId, 'blue-2');
  assert.equal(healing.requestedAmount, 70);
  assert.equal(healing.hpGained, 70);
  assert.equal(result.state.units['blue-2'].hp, 90);
  const advance = result.events.find(event => event.type === 'resource-meter-advanced' && event.source.id === tubingFireIds.soul);
  assert.equal(advance.progressBefore, 4, '普通行动已先推进鬼火条，钓瓶火在回合结束再推进一格');
  assert.equal(advance.progressAfter, 0);
  assert.equal(advance.supplied, 3);
  assert.equal(result.state.resources.blue.fire, 7);
  assert.ok(healing.parentEventId?.startsWith('turn-'));
});

test('轮入道额外回合优先入队，并重新运行式神策略', () => {
  const registry = new ContentRegistry();
  registerRoundabout(registry);
  const durationStatusId = 'test.roundabout-duration';
  registry.registerStatus({ id: durationStatusId, mechanicsCoverage: 'verified', category: 'buff', dispellable: true, sealable: false,
    durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const skill = { id: 'test.roundabout-basic', actionKind: 'basic', resourceCost: { resourceId: 'fire', amount: 1 },
    target: 'single', targetRelation: 'enemy', levels: [{}],
    execute(_context, intent) { return [{ type: 'deal-damage', source: { kind: 'skill', id: 'test.roundabout-basic', unitId: intent.actorId },
      targetId: intent.targetIds[0], amount: 10 }]; } };
  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [skill],
    policy(_context, actorId) { return { actorId, skillId: skill.id, targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }; } });
  const initial = state();
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: roundaboutIds.soul,
    stats: { ...initial.units['blue-1'].stats, speed: 100 }, statuses: [{ instanceId: 'roundabout-duration', statusId: durationStatusId,
      source: { kind: 'system', id: 'test' }, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' } }] };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', soulId: undefined,
    stats: { ...initial.units['blue-1'].stats, speed: 100 } };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, speed: 20, hp: 1000 }, hp: 1000 };
  initial.sides = { blue: ['blue-1', 'blue-2'], red: ['red-1'] };
  const findSeed = (extraTurnSelectedNext) => {
    let seed = 1;
    while (true) {
      const random = createSeededRandom(seed);
      const firstActorPick = random.next();
      const roundaboutRoll = random.next();
      const nextTiePick = random.next();
      if (firstActorPick < .5 && roundaboutRoll < .2 && (extraTurnSelectedNext ? nextTiePick < .5 : nextTiePick >= .5)) return seed;
      seed++;
    }
  };
  const simulate = seed => runBattle(initial, registry, { seed, actionLimit: 2 });
  const wearerSelectedNext = simulate(findSeed(true));
  const scheduled = wearerSelectedNext.events.find(event => event.type === 'turn-scheduled' && event.source.id === roundaboutIds.soul);
  assert.equal(scheduled.selection, 'action-gauge');
  const extraStart = wearerSelectedNext.events.find(event => event.type === 'turn-started' && event.scheduling === 'extra-turn');
  const wearerActions = wearerSelectedNext.events.filter(event => event.type === 'action-declared');
  assert.ok(extraStart);
  assert.equal(wearerActions.map(event => event.intent.actorId).join(','), 'blue-1,blue-1');
  assert.equal(wearerActions[1].parentEventId, scheduled.eventId);
  assert.equal(wearerSelectedNext.state.resources.blue.fire, 2, '额外行动重新校验并支付技能鬼火费用');
  assert.ok(wearerSelectedNext.events.some(event => event.type === 'status-removed' && event.statusId === durationStatusId
    && event.reason === 'expired'), '额外回合按一次友方目标回合扣减持续时间');
  const extraMeter = wearerSelectedNext.events.find(event => event.type === 'resource-meter-advanced' && event.actionId === 2);
  assert.ok(extraMeter, '额外回合重新进入主行动循环并按常规规则推进鬼火条');
  assert.equal(extraMeter.progressBefore, 1);
  assert.equal(extraMeter.progressAfter, 2);

  const allySelectedNext = simulate(findSeed(false));
  const queued = allySelectedNext.events.find(event => event.type === 'turn-scheduled' && event.source.id === roundaboutIds.soul);
  assert.ok(queued);
  assert.equal(allySelectedNext.events.some(event => event.type === 'turn-started' && event.scheduling === 'extra-turn'), true);
  const allyActions = allySelectedNext.events.filter(event => event.type === 'action-declared');
  assert.equal(allyActions.map(event => event.intent.actorId).join(','), 'blue-1,blue-1',
    '额外回合优先于另一个同速就绪单位');
});

test('火之车每四次回合结束触发额外回合，额外回合技能减1火并在该回合结束后失效', () => {
  const registry = new ContentRegistry();
  registerFireCart(registry);
  const basic = { id: 'test.fire-cart-basic', actionKind: 'basic', target: 'single', targetRelation: 'enemy', levels: [{}],
    execute() { return []; } };
  const skill = { id: 'test.fire-cart-skill', actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 2 },
    target: 'single', targetRelation: 'enemy', levels: [{}], execute() { return []; } };
  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [basic, skill],
    policy(context, actorId) {
      const wearer = context.getUnit(actorId);
      const effectiveFire = context.state.resources[wearer.side]?.fire ?? 0;
      return { actorId, skillId: effectiveFire >= 2 ? skill.id : basic.id, targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' };
    } });
  const initial = state();
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  initial.resources.blue.fire = 1;
  initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: fireCartIds.soul,
    stats: { ...initial.units['blue-1'].stats, speed: 100 } };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, speed: 1 } };

  const battle = runBattle(initial, registry, { seed: 31, actionLimit: 5 });
  const queued = battle.events.find(event => event.type === 'turn-scheduled' && event.source.id === fireCartIds.soul);
  assert.ok(queued, 'fourth Grave Fire schedules an extra turn');
  const extraAction = battle.events.find(event => event.type === 'action-declared' && event.intent.skillId === skill.id);
  const extraStart = battle.events.find(event => event.type === 'turn-started' && event.scheduling === 'extra-turn');
  assert.equal(extraAction.actionId, extraStart.actionId, 'the reduced-cost skill resolves inside the scheduled extra turn');
  assert.equal(battle.state.resources.blue.fire, 3, 'the opening supply is four fire; the extra-turn skill consumes one');
  assert.ok(battle.events.some(event => event.type === 'resource-changed' && event.resourceId === 'fire'
    && event.before === 1 && event.after === 0), 'payment confirms a one-fire cost before normal turn-end supply');
  assert.ok(battle.events.some(event => event.type === 'status-removed' && event.statusId === fireCartIds.discount
    && event.reason === 'expired'), 'the one-turn discount expires after the extra turn');
  const remainingFire = battle.state.units['blue-1'].statuses.find(status => status.statusId === fireCartIds.graveFire);
  assert.equal(remainingFire?.stacks, 1, 'the extra turn begins the next four-turn cycle');

  const sealedInitial = { ...initial, units: { ...initial.units, 'blue-1': { ...initial.units['blue-1'], statuses: [{
    instanceId: 'fire-cart-seal', statusId: soulSuppressionStatusId, source: { kind: 'system', id: 'test' }, stacks: 1,
    duration: { kind: 'permanent' },
  }] } } };
  const sealedBattle = runBattle(sealedInitial, registry, { seed: 31, actionLimit: 5 });
  assert.equal(sealedBattle.events.some(event => event.type === 'turn-scheduled' && event.source.id === fireCartIds.soul), false,
    'soul seal disables Grave Fire accumulation and its extra turn');
  assert.equal(sealedBattle.state.units['blue-1'].statuses.some(status => status.statusId === fireCartIds.graveFire), false);
});

test('叠叩仅在初始暴击超过120%时让非召唤友方减少15%暴击额外伤害，且唯一效果不叠加', () => {
  const registry = new ContentRegistry();
  registerDiekou(registry);
  const hit = { id: 'test.die-kou-hit', actionKind: 'basic', target: 'single', targetRelation: 'enemy', levels: [{}],
    execute(_context, intent) { return [{ type: 'deal-damage', source: { kind: 'skill', id: 'test.die-kou-hit', unitId: intent.actorId },
      targetId: intent.targetIds[0], amount: 200, criticalBaseAmount: 100, isCritical: true }]; } };
  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [hit],
    policy(_context, actorId) { return { actorId, skillId: hit.id, targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }; } });
  const simulate = ({ initialCrit = 1.21, targetKind, sealed = false, duplicate = false, wearerDead = false } = {}) => {
    const initial = state();
    initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
    initial.units['blue-1'] = { ...initial.units['blue-1'], stats: { ...initial.units['blue-1'].stats, speed: 200 } };
    initial.units['red-1'] = { ...initial.units['red-1'], unitKind: targetKind, shield: 0,
      stats: { ...initial.units['red-1'].stats, hp: 1000 }, hp: 1000 };
    const carrier = { ...initial.units['red-1'], unitId: 'red-2', soulId: dieKouIds.soul,
      stats: { ...initial.units['red-1'].stats, crit: initialCrit }, hp: wearerDead ? 0 : 1000,
      statuses: sealed ? [{ instanceId: 'die-kou-seal', statusId: soulSuppressionStatusId,
        source: { kind: 'system', id: 'test' }, stacks: 1, duration: { kind: 'permanent' } }] : [] };
    initial.units['red-2'] = carrier;
    initial.sides = { blue: ['blue-1'], red: ['red-1', 'red-2'] };
    if (duplicate) initial.units['red-3'] = { ...carrier, unitId: 'red-3' }, initial.sides.red.push('red-3');
    return runBattle(initial, registry, { seed: 31, actionLimit: 1 });
  };
  const reduced = simulate({ duplicate: true });
  const hitEvent = reduced.events.find(event => event.type === 'damage' && event.targetId === 'red-1');
  assert.equal(hitEvent.amount, 185, '100 base damage plus 85% of the critical bonus');
  assert.equal(hitEvent.hpLost, 185);
  assert.equal(simulate({ initialCrit: 1.2 }).events.find(event => event.type === 'damage' && event.targetId === 'red-1').amount, 200,
    'the trigger is strictly above 120% initial critical rate');
  assert.equal(simulate({ targetKind: 'summon' }).events.find(event => event.type === 'damage' && event.targetId === 'red-1').amount, 200,
    'summoned allies are excluded');
  assert.equal(simulate({ sealed: true }).events.find(event => event.type === 'damage' && event.targetId === 'red-1').amount, 200,
    'soul seal disables the set effect');
  assert.equal(simulate({ wearerDead: true }).events.find(event => event.type === 'damage' && event.targetId === 'red-1').amount, 200,
    'a defeated carrier no longer supplies the team effect');
});

test('青女房首次致死时清状态并满血冰封一回合，御魂封印可阻断且冰封结束再次治疗', () => {
  const registry = new ContentRegistry();
  registerQingnufang(registry);
  for (const [id, category] of [['test.qingnufang-buff', 'buff'], ['test.qingnufang-debuff', 'debuff'],
    ['test.qingnufang-mark', 'mark']]) registry.registerStatus({ id, category, mechanicsCoverage: 'verified',
      dispellable: false, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' });
  const hit = { id: 'test.qingnufang-hit', actionKind: 'basic', target: 'single', targetRelation: 'enemy', levels: [{}],
    execute(_context, intent) { return [{ type: 'deal-damage', source: { kind: 'skill', id: 'test.qingnufang-hit', unitId: intent.actorId },
      targetId: intent.targetIds[0], amount: 200 }]; } };
  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [hit],
    policy(_context, actorId) { return { actorId, skillId: hit.id, targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }; } });
  const initial = (sealed = false) => {
    const battle = state();
    battle.counters = { round: 1, action: 0, attack: 0, hit: 0 };
    battle.units['blue-1'] = { ...battle.units['blue-1'], stats: { ...battle.units['blue-1'].stats, speed: 200 } };
    battle.units['red-1'] = { ...battle.units['red-1'], soulId: qingnufangIds.soul, shield: 0, hp: 100,
      stats: { ...battle.units['red-1'].stats, hp: 100, defense: 100 }, statuses: [
        { instanceId: 'old-buff', statusId: 'test.qingnufang-buff', source: { kind: 'system', id: 'test' }, stacks: 1,
          duration: { kind: 'permanent' } },
        { instanceId: 'old-debuff', statusId: 'test.qingnufang-debuff', source: { kind: 'system', id: 'test' }, stacks: 1,
          duration: { kind: 'permanent' } },
        { instanceId: 'old-mark', statusId: 'test.qingnufang-mark', source: { kind: 'system', id: 'test' }, stacks: 1,
          duration: { kind: 'permanent' } },
        ...(sealed ? [{ instanceId: 'soul-seal', statusId: soulSuppressionStatusId,
          source: { kind: 'system', id: 'test' }, stacks: 1, duration: { kind: 'permanent' } }] : []),
      ] };
    battle.sides = { blue: ['blue-1'], red: ['red-1'] };
    return battle;
  };

  const saved = runBattle(initial(), registry, { seed: 31, actionLimit: 1 });
  const wearer = saved.state.units['red-1'];
  assert.equal(wearer.hp, 100, 'the lethal hit restores the wearer to full health immediately');
  assert.deepEqual(wearer.statuses.map(status => status.statusId), [qingnufangIds.iceSeal],
    'all previous buffs, debuffs, marks, and the consumed fatal guard are removed');
  const ice = registry.getStatus(qingnufangIds.iceSeal);
  assert.equal(ice.preventsAction, true);
  assert.equal(ice.statusImmunity, 'debuffs');
  assert.equal(effectiveStats(wearer).defense, 200, 'ice doubles defense for one turn');
  const blocked = applyEffectCommands(saved.state, [{ type: 'add-status', source: { kind: 'system', id: 'test' },
    targetId: 'red-1', instance: { instanceId: 'blocked-debuff', statusId: 'test.qingnufang-debuff',
      source: { kind: 'system', id: 'test' }, stacks: 1, duration: { kind: 'permanent' } } }],
  'effect-resolution', 'qingnufang-immunity', id => registry.getStatus(id));
  assert.equal(blocked.state.units['red-1'].statuses.some(status => status.instanceId === 'blocked-debuff'), false);
  assert.ok(blocked.events.some(event => event.type === 'status-application-blocked' && event.blockReason === 'immunity'));

  const injured = { ...saved.state, units: { ...saved.state.units, 'red-1': { ...wearer, hp: 40 } } };
  const snapshot = captureStatusExpirySnapshot(injured, { owner: 'target-turn', unitId: 'red-1' });
  const expired = advanceStatusDurations(injured, snapshot, 'qingnufang-expiry');
  const recoveryHandler = registry.getSoul(qingnufangIds.soul).handlers['status-expiration'];
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: `soul:${qingnufangIds.soul}:status-expiration`, phase: 'status-expiration', priority: 145,
    handle: recoveryHandler.handle });
  const recovered = settleEvents(expired.state, expired.events, dispatcher, () => .5, new TriggerBudget(), id => registry.getStatus(id));
  assert.equal(recovered.state.units['red-1'].hp, 100, 'surviving the one-turn ice status restores full health again');

  const sealed = runBattle(initial(true), registry, { seed: 31, actionLimit: 1 });
  assert.equal(sealed.state.units['red-1'].hp, 0, 'soul seal disables the lethal guard');
});

test('元兴寺按单次行动不同控制目标叠加全队增伤，排除召唤物并封顶8层', () => {
  const registry = new ContentRegistry();
  registerYuanxingTemple(registry);
  registry.registerStatus({ id: 'test.yuanxing-stun', mechanicsCoverage: 'verified', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  const skill = { id: 'test.yuanxing-control', actionKind: 'skill', target: 'all-enemies', targetRelation: 'enemy', levels: [{}],
    execute(context, intent) {
      const source = { kind: 'skill', id: 'test.yuanxing-control', unitId: intent.actorId };
      const targets = intent.targetIds.map(id => context.getUnit(id)).filter(Boolean);
      const hitTargets = [...targets, ...(targets.length ? [targets[0]] : [])];
      return hitTargets.map((target, index) => ({ type: 'apply-control', source, targetId: target.unitId, scopeId: `cast:${context.state.counters.action}`,
        instance: { instanceId: `yuanxing-test:${context.state.counters.action}:${index}`, statusId: 'test.yuanxing-stun',
          source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { controlType: 'stun' } } }));
    } };
  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [skill],
    policy(context, actorId) { return { actorId, skillId: skill.id, targetIds: context.getLivingUnits('red').map(unit => unit.unitId),
      shape: 'all-enemies', targetRelation: 'enemy' }; } });
  const simulate = (targetCount, sealed = false) => {
    const initial = state();
    initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
    initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: yuanxingTempleIds.soul,
      stats: { ...initial.units['blue-1'].stats, speed: 200 },
      statuses: sealed ? [{ instanceId: 'yuanxing-seal', statusId: soulSuppressionStatusId,
        source: { kind: 'system', id: 'test' }, stacks: 1, duration: { kind: 'permanent' } }] : [] };
    initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', soulId: undefined,
      statuses: [] };
    initial.units['blue-summon'] = { ...initial.units['blue-2'], unitId: 'blue-summon', unitKind: 'summon' };
    const redIds = [];
    for (let index = 1; index <= targetCount; index++) {
      const unitId = `red-${index}`;
      redIds.push(unitId);
      initial.units[unitId] = { ...initial.units['red-1'], unitId, hp: 1000,
        stats: { ...initial.units['red-1'].stats, hp: 1000, speed: 1 }, shield: 0 };
    }
    initial.sides = { blue: ['blue-1', 'blue-2', 'blue-summon'], red: redIds };
    return runBattle(initial, registry, { seed: 31, actionLimit: 1 });
  };

  const twoTargets = simulate(2);
  for (const unitId of ['blue-1', 'blue-2']) {
    const buff = twoTargets.state.units[unitId].statuses.find(status => status.statusId === yuanxingTempleIds.teamDamage);
    assert.equal(buff?.stacks, 2, 'the repeated first target is counted only once');
    assert.equal(buff.duration.remaining, 2);
    assert.equal(effectiveDamageMultiplier(twoTargets.state.units[unitId]), 1.1);
  }
  assert.equal(twoTargets.state.units['blue-summon'].statuses.some(status => status.statusId === yuanxingTempleIds.teamDamage), false);
  assert.equal(twoTargets.state.units['blue-1'].statuses.some(status => status.statusId === yuanxingTempleIds.actionTargets), false,
    'per-action deduplication data is removed when the carrier action ends');

  const capped = simulate(9);
  assert.equal(capped.state.units['blue-1'].statuses.find(status => status.statusId === yuanxingTempleIds.teamDamage).stacks, 8);
  const sealed = simulate(2, true);
  assert.equal(sealed.state.units['blue-1'].statuses.some(status => status.statusId === yuanxingTempleIds.teamDamage), false,
    'soul seal disables Yuanxing Temple');
});

test('片叶之苇、心眼和鸣屋通过通用伤害钩子按条件增伤', () => {
  const registry = new ContentRegistry();
  registerDamageScalingSouls(registry);
  const initial = state();
  const attacker = initial.units['blue-1'];
  const target = initial.units['red-1'];
  const reed = registry.getSoul(damageScalingSoulIds.reed);
  const eye = registry.getSoul(damageScalingSoulIds.heartEye);
  const tile = registry.getSoul(damageScalingSoulIds.roofTile);
  const netCut = registry.getSoul(damageScalingSoulIds.netCut);

  const fullHealthAttacker = { ...attacker, soulId: damageScalingSoulIds.reed,
    hp: 1000, stats: { ...attacker.stats, hp: 1000 } };
  assert.equal(reed.modifyOutgoingDamage(fullHealthAttacker, target, 100, 'normal'), 145);
  assert.equal(reed.modifyOutgoingDamage({ ...fullHealthAttacker, hp: 999 }, target, 100, 'normal'), 100);
  assert.equal(reed.modifyOutgoingDamage(fullHealthAttacker, target, 100, 'true'), 100);

  const heartEyeAttacker = { ...attacker, soulId: damageScalingSoulIds.heartEye };
  assert.ok(Math.abs(eye.modifyOutgoingDamage(heartEyeAttacker, { ...target, hp: 850, stats: { ...target.stats, hp: 1000 } }, 100, 'normal') - 110) < 1e-10);
  assert.ok(Math.abs(eye.modifyOutgoingDamage(heartEyeAttacker, { ...target, hp: 700, stats: { ...target.stats, hp: 1000 } }, 100, 'normal') - 120) < 1e-10);
  assert.equal(eye.modifyOutgoingDamage(heartEyeAttacker, { ...target, hp: 700 }, 100, 'true'), 100);

  const tileAttacker = { ...attacker, soulId: damageScalingSoulIds.roofTile };
  const controlledTarget = { ...target, statuses: [{ instanceId: 'stun', statusId: 'test.stun',
    source: { kind: 'skill', id: 'test.stun' }, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
    values: { controlType: '眩晕' } }] };
  assert.equal(tile.modifyOutgoingDamage(tileAttacker, controlledTarget, 100, 'normal'), 145);
  assert.equal(tile.modifyOutgoingDamage(tileAttacker, target, 100, 'normal'), 100);

  const netCutAttacker = { ...attacker, soulId: damageScalingSoulIds.netCut };
  const armoredTarget = { ...target, stats: { ...target.stats, defense: 300 } };
  assert.ok(Math.abs(netCut.modifyOutgoingDamage(netCutAttacker, armoredTarget, 100, 'normal', undefined, () => .49) - (100 * 600 / 465)) < 1e-10);
  assert.equal(netCut.modifyOutgoingDamage(netCutAttacker, armoredTarget, 100, 'normal', undefined, () => .5), 100);
  assert.equal(netCut.modifyOutgoingDamage(netCutAttacker, armoredTarget, 100, 'true', undefined, () => .1), 100);
});

test('隐念对同一目标的伤害加成为20%、40%、60%循环，换目标后重新开始', () => {
  const registry = new ContentRegistry();
  registerDamageScalingSouls(registry);
  const skill = { id: 'test.hidden-intent-four-hit', target: 'single', targetRelation: 'enemy', levels: [{}],
    execute(_context, intent) { return Array.from({ length: 4 }, () => ({ type: 'deal-damage',
      source: { kind: 'skill', id: 'test.hidden-intent-four-hit', unitId: intent.actorId }, targetId: intent.targetIds[0], amount: 100 })); } };
  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [skill],
    policy(_context, actorId) { return actorId === 'blue-1' ? { actorId, skillId: skill.id, targetIds: ['red-1'], shape: 'single',
      targetRelation: 'enemy' } : undefined; } });
  const initial = state();
  initial.counters = { ...initial.counters, action: 0 };
  initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: damageScalingSoulIds.hiddenIntent,
    stats: { ...initial.units['blue-1'].stats, speed: 200 } };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 1000, shield: 0,
    stats: { ...initial.units['red-1'].stats, hp: 1000 } };
  const result = runBattle(initial, registry, { seed: 22, actionLimit: 1 });
  assert.deepEqual(result.events.filter(event => event.type === 'damage').map(event => event.amount), [120, 140, 160, 120]);
  const counter = result.state.units['blue-1'].statuses.find(status => status.statusId === damageScalingSoulIds.hiddenIntentCounter);
  assert.equal(counter.values.targetId, 'red-1');
  assert.equal(counter.values.completedHits, 1);
  assert.ok(result.events.filter(event => event.type === 'status-added' && event.instance.statusId === damageScalingSoulIds.hiddenIntentCounter)
    .every(event => event.parentEventId));
  const hiddenIntent = registry.getSoul(damageScalingSoulIds.hiddenIntent);
  assert.equal(hiddenIntent.modifyOutgoingDamage(result.state.units['blue-1'], { ...result.state.units['red-1'], unitId: 'red-2' },
    100, 'normal'), 120, '切换目标后按新目标的首段20%计算');
});

test('尘冢按非召唤物存活人数计算行动增伤并在行动后移除', () => {
  const registry = new ContentRegistry();
  registerDustMound(registry);
  const attack = { id: 'test.dust-mound-attack', target: 'single', targetRelation: 'enemy', levels: [{}],
    execute(_context, intent) { return [{ type: 'deal-damage', source: { kind: 'skill', id: 'test.dust-mound-attack', unitId: intent.actorId },
      targetId: intent.targetIds[0], amount: 100 }]; } };
  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [attack],
    policy(_context, actorId) { return actorId === 'blue-1' ? { actorId, skillId: attack.id, targetIds: ['red-1'], shape: 'single',
      targetRelation: 'enemy' } : undefined; } });
  const initial = state();
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: dustMoundIds.soul,
    stats: { ...initial.units['blue-1'].stats, speed: 300 } };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', soulId: undefined,
    stats: { ...initial.units['blue-1'].stats, speed: 20 } };
  initial.units['blue-summon'] = { ...initial.units['blue-1'], unitId: 'blue-summon', heroId: 2, soulId: undefined,
    unitKind: 'summon', stats: { ...initial.units['blue-1'].stats, speed: 10 } };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, speed: 5 } };
  initial.sides = { blue: ['blue-1', 'blue-2', 'blue-summon'], red: ['red-1'] };
  const result = runBattle(initial, registry, { seed: 41, actionLimit: 1 });
  const applied = result.events.find(event => event.type === 'status-added' && event.instance.statusId === dustMoundIds.damage);
  assert.equal(applied.instance.modifiers[0].amount, .29,
    '两名友方非召唤物对一名敌方，召唤物不参与人数差');
  assert.equal(applied.parentEventId, 'turn-1-start');
  assert.equal(result.events.find(event => event.type === 'damage').amount, 129);
  assert.ok(result.events.some(event => event.type === 'status-removed' && event.statusId === dustMoundIds.damage
    && event.reason === 'consumed' && event.parentEventId === 'turn-1-end'));
  assert.equal(result.state.units['blue-1'].statuses.some(status => status.statusId === dustMoundIds.damage), false);

  const handler = registry.getSoul(dustMoundIds.soul).handlers['turn-start'].handle;
  const crowded = state();
  crowded.units['blue-1'] = { ...crowded.units['blue-1'], soulId: dustMoundIds.soul };
  crowded.sides.blue = ['blue-1'];
  for (let i = 2; i <= 10; i++) {
    const unit = { ...crowded.units['blue-1'], unitId: `blue-${i}`, soulId: undefined };
    crowded.units[unit.unitId] = unit;
    crowded.sides.blue.push(unit.unitId);
  }
  const command = handler(createBattleContext(crowded, () => .5), { type: 'turn-started', eventId: 'dust-cap-start',
    phase: 'turn-start', source: { kind: 'system', id: 'test' }, unitId: 'blue-1', actionId: 1 })[0];
  assert.equal(command.instance.modifiers[0].amount, .45, '人数差增加时增伤最高为45%');
});

test('无刀取在佩戴者回合结束永久成长15%伤害，最高45%', () => {
  const registry = new ContentRegistry();
  registerRampingSouls(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: rampingSoulIds.bladeNoBlade };
  const handler = registry.getSoul(rampingSoulIds.bladeNoBlade).handlers['turn-end'].handle;
  let current = initial;
  const statusAdds = [];
  for (let action = 1; action <= 4; action++) {
    const event = { type: 'turn-ended', eventId: `no-blade-end-${action}`, phase: 'turn-end',
      source: { kind: 'unit', id: '1', unitId: 'blue-1' }, actionId: action, unitId: 'blue-1' };
    const commands = handler(createBattleContext(current, () => .5), event);
    if (commands) {
      const applied = applyEffectCommands(current, commands, 'effect-resolution', `no-blade-${action}`, id => registry.getStatus(id));
      current = applied.state;
      statusAdds.push(...applied.events.filter(item => item.type === 'status-added'));
    }
  }
  const bonus = current.units['blue-1'].statuses.find(status => status.statusId === rampingSoulIds.bladeNoBladeBonus);
  assert.equal(statusAdds.length, 3);
  assert.deepEqual(statusAdds.map(event => event.instance.values.bonus), [.15, .3, .45]);
  assert.equal(bonus.modifiers[0].amount, .45);
  assert.equal(bonus.duration.kind, 'permanent');
  assert.equal(require('../dist-test-renderer/renderer/features/duel/engine/mechanics/stats.js')
    .effectiveDamageMultiplier(current.units['blue-1']), 1.45);
  assert.ok(statusAdds.every(event => event.parentEventId.startsWith('no-blade-end-')));
});

test('任一友方受控时由三味佩戴者触发加速给受控者，最多两层且不可驱散', () => {
  const registry = new ContentRegistry();
  registerControlSouls(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: controlSoulIds.sanmi };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', soulId: 'test.other-soul' };
  initial.sides.blue = ['blue-1', 'blue-2'];
  const handler = registry.getSoul(controlSoulIds.sanmi).handlers['control-application'].handle;
  const event = { type: 'control-applied', eventId: 'sanmi-control', phase: 'control-application',
    source: { kind: 'skill', id: 'test.control', unitId: 'red-1' }, targetId: 'blue-2', statusId: 'test.stun' };
  let current = initial;
  for (let trigger = 0; trigger < 3; trigger++) {
    const commands = handler(createBattleContext(current, () => .5, id => registry.getStatus(id)?.category),
      { ...event, eventId: `${event.eventId}-${trigger}` });
    if (!commands) continue;
    const applied = applyEffectCommands(current, commands, 'effect-resolution', `sanmi-${trigger}`, id => registry.getStatus(id));
    current = applied.state;
  }
  const speed = current.units['blue-2'].statuses.find(status => status.statusId === controlSoulIds.sanmiSpeed);
  assert.equal(speed.stacks, 2);
  assert.equal(speed.modifiers[0].amount, 30);
  assert.deepEqual(speed.duration, { kind: 'count', remaining: 2, owner: 'target-turn' });
  assert.equal(current.units['blue-1'].statuses.some(status => status.statusId === controlSoulIds.sanmiSpeed), false,
    '三味佩戴者触发御魂，但加速状态只施加给受控友方');
  assert.equal(registry.getStatus(controlSoulIds.sanmiSpeed).dispellable, false);
  assert.equal(registry.getSoul(controlSoulIds.sanmi).mechanicsCoverage, 'verified');
});

test('三味可从已应用的放逐控制事件触发加速，并保留控制类型来源', () => {
  const registry = new ContentRegistry();
  registerControlSouls(registry);
  registry.registerStatus({ id: 'test.banish-control', category: 'control', dispellable: false,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: controlSoulIds.sanmi };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', soulId: 'test.other-soul' };
  initial.sides.blue = ['blue-1', 'blue-2'];
  const resolveStatus = id => registry.getStatus(id);
  const exileSource = { kind: 'skill', id: 'test.exile', unitId: 'red-1' };
  const applied = applyEffectCommands(initial, [{ type: 'apply-control', source: exileSource, targetId: 'blue-2', instance: {
    instanceId: 'test.exile', statusId: 'test.banish-control', source: exileSource, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { controlType: '放逐' },
  } }], 'control-application', 'sanmi-exile', resolveStatus);
  const controlEvent = applied.events.find(event => event.type === 'control-applied');
  assert.equal(controlEvent.controlType, '放逐');
  const commands = registry.getSoul(controlSoulIds.sanmi).handlers['control-application']
    .handle(createBattleContext(applied.state, () => .5, id => registry.getStatus(id)?.category), controlEvent);
  const accelerated = applyEffectCommands(applied.state, commands, 'effect-resolution', 'sanmi-exile-speed', resolveStatus).state;
  assert.equal(accelerated.units['blue-2'].statuses.find(status => status.statusId === controlSoulIds.sanmiSpeed).stacks, 1);
});

test('骰子鬼仅在首次受控时推条，抵抗时以150%攻击倍率反击来源目标', () => {
  const registry = new ContentRegistry();
  registerControlSouls(registry);
  registry.registerStatus({ id: 'test.dice-ghost-control', mechanicsCoverage: 'verified', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const soul = registry.getSoul(controlSoulIds.diceGhost);
  const controlledState = state();
  controlledState.units['blue-1'] = { ...controlledState.units['blue-1'], soulId: controlSoulIds.diceGhost, actionGauge: 20 };
  const source = { kind: 'skill', id: 'test.control', unitId: 'red-1' };
  const controlCommand = { type: 'apply-control', source, targetId: 'blue-1', instance: { instanceId: 'dice-stun',
    statusId: 'test.dice-ghost-control', source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
    values: { controlType: '眩晕' } } };
  const first = applyEffectCommands(controlledState, [controlCommand], 'effect-resolution', 'dice-first', id => registry.getStatus(id));
  const firstEvent = first.events.find(event => event.type === 'control-applied');
  assert.equal(firstEvent.newlyControlled, true);
  const push = soul.handlers['control-application'].handle(createBattleContext(first.state, () => .5), firstEvent);
  const pushed = applyEffectCommands(first.state, push, 'effect-resolution', 'dice-push', id => registry.getStatus(id));
  assert.equal(pushed.state.units['blue-1'].actionGauge, 45);
  const second = applyEffectCommands(pushed.state, [controlCommand], 'effect-resolution', 'dice-second', id => registry.getStatus(id));
  assert.equal(second.events.find(event => event.type === 'control-applied').newlyControlled, false);
  assert.equal(soul.handlers['control-application'].handle(createBattleContext(second.state, () => .5), second.events[0]), undefined);

  const resistedState = state();
  resistedState.units['blue-1'] = { ...resistedState.units['blue-1'], soulId: controlSoulIds.diceGhost,
    stats: { ...resistedState.units['blue-1'].stats, resist: .5, attack: 100 } };
  resistedState.units['red-1'] = { ...resistedState.units['red-1'], hp: 1000,
    stats: { ...resistedState.units['red-1'].stats, hp: 1000 } };
  const resistedCommand = attemptControl(createBattleContext(resistedState, () => .6), { attemptId: 'dice-attempt', source,
    targetId: 'blue-1', statusId: 'test.dice-ghost-control', controlType: '眩晕', baseChance: .8,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' } });
  assert.equal(resistedCommand.type, 'report-control-resisted');
  const resisted = applyEffectCommands(resistedState, [resistedCommand], 'effect-resolution', 'dice-resisted', id => registry.getStatus(id));
  const resistedEvent = resisted.events.find(event => event.type === 'control-resisted');
  const counter = soul.handlers['control-application'].handle(createBattleContext(resisted.state, () => .5), resistedEvent);
  const countered = applyEffectCommands(resisted.state, counter, 'effect-resolution', 'dice-counter', id => registry.getStatus(id));
  assert.equal(counter[0].type, 'schedule-attack');
  assert.equal(counter[0].scheduling, 'counter');
  assert.equal(counter[0].suppressSourcePassiveTriggers, true);
  assert.equal(counter[0].hits[0].amount, 150,
    '反击按攻击力150%计算普通伤害，可在正式攻击结算中正常处理防御和护盾');
  assert.equal(countered.events[0].type, 'action-scheduled');
  assert.equal(countered.events[0].parentEventId, resistedEvent.eventId);
});

test('幽谷响以50%概率反弹已抵抗的控制，并由通用控制保护检查免疫', () => {
  const registry = new ContentRegistry();
  registerControlSouls(registry);
  registry.registerStatus({ id: 'test.echo-control', mechanicsCoverage: 'verified', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: 'test.echo-immunity', mechanicsCoverage: 'verified', category: 'buff', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep', controlProtection: 'immune' });
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: controlSoulIds.echoingValley };
  const resisted = { type: 'control-resisted', eventId: 'echo-resisted', phase: 'control-application',
    source: { kind: 'skill', id: 'test.control', unitId: 'red-1' }, targetId: 'blue-1',
    controlStatusId: 'test.echo-control', controlType: '眩晕' };
  const handler = registry.getSoul(controlSoulIds.echoingValley).handlers['control-application'].handle;
  assert.equal(registry.getSoul(controlSoulIds.echoingValley).mechanicsCoverage, 'verified');
  const reflected = handler(createBattleContext(initial, () => .25), resisted);
  assert.equal(reflected[0].type, 'apply-control');
  assert.equal(reflected[0].targetId, 'red-1');
  const applied = applyEffectCommands(initial, reflected, 'effect-resolution', 'echo-reflect', id => registry.getStatus(id));
  assert.ok(applied.state.units['red-1'].statuses.some(status => status.statusId === 'test.echo-control'));
  assert.equal(applied.events.find(event => event.type === 'control-applied').source.id, controlSoulIds.echoingValley);
  assert.equal(applied.events.find(event => event.type === 'control-applied').parentEventId, resisted.eventId);
  assert.equal(handler(createBattleContext(initial, () => .75), resisted), undefined);

  const protectedState = { ...initial, units: { ...initial.units, 'red-1': { ...initial.units['red-1'], statuses: [
    { instanceId: 'immunity', statusId: 'test.echo-immunity', source: { kind: 'system', id: 'fixture' }, stacks: 1,
      duration: { kind: 'permanent' } },
  ] } } };
  const blocked = applyEffectCommands(protectedState, reflected, 'effect-resolution', 'echo-blocked', id => registry.getStatus(id));
  assert.ok(blocked.events.some(event => event.type === 'control-blocked' && event.protectionStatusId === 'test.echo-immunity'));
});

test('镜姬受攻击时按30%反弹伤害生命流失，反弹不超过攻击者当前生命', () => {
  const registry = new ContentRegistry();
  registerReflectiveSouls(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: reflectiveSoulIds.mirrorLady };
  const hit = { type: 'damage', eventId: 'mirror-hit', phase: 'hit', source: { kind: 'skill', id: 'test.attack', unitId: 'red-1' },
    actionId: 1, attackId: 1, hitIndex: 1, targetId: 'blue-1', damageKind: 'normal', amount: 100,
    hpLost: 90, mitigated: 10, isCritical: false };
  const handler = registry.getSoul(reflectiveSoulIds.mirrorLady).handlers.hit.handle;
  const reflection = handler(createBattleContext(initial, () => .29), hit);
  assert.equal(reflection[0].type, 'lose-life');
  assert.equal(reflection[0].amount, 60);
  const result = applyEffectCommands(initial, reflection, 'effect-resolution', 'mirror-reflection', id => registry.getStatus(id));
  assert.equal(result.state.units['red-1'].hp, 0);
  assert.equal(result.events[0].hpLost, 60);
  assert.equal(result.events[0].parentEventId, hit.eventId);
  assert.equal(handler(createBattleContext(initial, () => .31), hit), undefined);
  assert.equal(registry.getSoul(reflectiveSoulIds.mirrorLady).mechanicsCoverage, 'partial');
});

test('狰受击时按35%概率造成基于攻击与目标防御的反击生命流失', () => {
  const registry = new ContentRegistry();
  registerReflectiveSouls(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: reflectiveSoulIds.scar,
    stats: { ...initial.units['blue-1'].stats, attack: 100 } };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, defense: 0 } };
  const hit = { type: 'damage', eventId: 'scar-hit', phase: 'hit', source: { kind: 'skill', id: 'test.attack', unitId: 'red-1' },
    actionId: 1, attackId: 1, hitIndex: 1, targetId: 'blue-1', damageKind: 'normal', amount: 50,
    hpLost: 50, mitigated: 0, isCritical: false };
  const handler = registry.getSoul(reflectiveSoulIds.scar).handlers.hit.handle;
  const counter = handler(createBattleContext(initial, () => .34), hit);
  assert.equal(counter[0].amount, 12.5);
  const result = applyEffectCommands(initial, counter, 'effect-resolution', 'scar-counter', id => registry.getStatus(id));
  assert.equal(result.state.units['red-1'].hp, 47.5);
  assert.equal(result.events[0].type, 'life-lost');
  assert.equal(result.events[0].parentEventId, hit.eventId);
  assert.equal(handler(createBattleContext(initial, () => .36), hit), undefined);
});

test('魍魉之匣命中后随机施加控制或减疗，减疗进入通用治疗结算', () => {
  const registry = new ContentRegistry();
  registerDebuffSouls(registry);
  const initial = state();
  initial.counters = { ...initial.counters, action: 0 };
  initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: debuffSoulIds.boxOfWonders, stats: {
    ...initial.units['blue-1'].stats, speed: 200,
  } };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', hp: 40, stats: {
    ...initial.units['blue-1'].stats, hp: 100, speed: 20,
  } };
  initial.sides.blue = ['blue-1', 'blue-2'];
  const hit = { type: 'damage', eventId: 'wonyo-hit', phase: 'hit', source: { kind: 'skill', id: 'test.attack', unitId: 'blue-1' },
    actionId: 1, attackId: 1, hitIndex: 1, targetId: 'blue-2', damageKind: 'normal', amount: 50,
    hpLost: 50, mitigated: 0, isCritical: false };
  const handler = registry.getSoul(debuffSoulIds.boxOfWonders).handlers.hit.handle;
  const healingCommands = handler(createBattleContext(initial, (() => { const rolls = [0, .875]; return () => rolls.shift(); })()), hit);
  assert.equal(healingCommands[0].type, 'add-status');
  assert.equal(healingCommands[0].instance.statusId, debuffSoulIds.healingReduction);
  let weakened = applyEffectCommands(initial, healingCommands, 'effect-resolution', 'wonyo-heal-reduction', id => registry.getStatus(id)).state;

  const heal = { id: 'test.wonyo-heal', target: 'single', targetRelation: 'ally', levels: [{}],
    execute(_context, intent) { return [{ type: 'heal', source: { kind: 'skill', id: 'test.wonyo-heal', unitId: intent.actorId },
      targetId: intent.targetIds[0], amount: 100 }]; } };
  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [heal],
    policy(_context, actorId) { return actorId === 'blue-1' ? { actorId, skillId: heal.id, targetIds: ['blue-2'], shape: 'single',
      targetRelation: 'ally' } : undefined; } });
  const healed = runBattle(weakened, registry, { seed: 55, actionLimit: 1 });
  const healing = healed.events.find(event => event.type === 'healing');
  assert.equal(healing.requestedAmount, 100);
  assert.equal(healing.amount, 60);
  assert.equal(healing.hpGained, 60);

  const controlRolls = [0, .1, .2];
  const control = handler(createBattleContext(initial, () => controlRolls.shift()), hit);
  assert.equal(control[0].type, 'apply-control');
  assert.equal(control[0].instance.statusId, debuffSoulIds.stun);
  const controlled = applyEffectCommands(initial, control, 'effect-resolution', 'wonyo-control', id => registry.getStatus(id));
  assert.ok(controlled.state.units['blue-2'].statuses.some(status => status.statusId === debuffSoulIds.stun));
  assert.equal(handler(createBattleContext(initial, () => .26), hit), undefined,
    '25%触发失败时不会附加控制或减疗');
  assert.equal(registry.getSoul(debuffSoulIds.boxOfWonders).mechanicsCoverage, 'partial',
    '魍魉之匣仍因其他触发差异标记为部分覆盖');
  assert.equal(registry.getStatus(debuffSoulIds.confusion).mechanicsCoverage, 'verified');
});

test('魅妖按25%基础概率在伤害后尝试混乱，仍经过抵抗并受御魂封印抑制', () => {
  const registry = new ContentRegistry();
  registerDebuffSouls(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: debuffSoulIds.charm };
  const hit = { type: 'damage', eventId: 'charm-hit', phase: 'hit', source: { kind: 'skill', id: 'test.attack', unitId: 'blue-1' },
    actionId: 1, attackId: 1, hitIndex: 1, targetId: 'red-1', damageKind: 'normal', amount: 50,
    hpLost: 50, mitigated: 0, isCritical: false };
  const handler = registry.getSoul(debuffSoulIds.charm).handlers.hit.handle;
  const applied = handler(createBattleContext(initial, (() => { const rolls = [.24, .5]; return () => rolls.shift(); })()), hit);
  assert.equal(applied[0].type, 'apply-control');
  assert.equal(applied[0].instance.statusId, debuffSoulIds.confusion);
  assert.equal(applied[0].instance.values.controlType, '混乱');
  assert.equal(applied[0].parentEventId, hit.eventId);
  const settled = applyEffectCommands(initial, applied, 'effect-resolution', 'charm-control', id => registry.getStatus(id));
  assert.ok(settled.events.some(event => event.type === 'control-applied' && event.targetId === 'red-1'));
  assert.equal(handler(createBattleContext(initial, () => .25), hit), undefined, '触发概率边界失败时不提交控制');
  const sealed = { ...initial, units: { ...initial.units, 'blue-1': { ...initial.units['blue-1'], statuses: [
    { instanceId: 'sealed-charm', statusId: soulSuppressionStatusId, source: { kind: 'system', id: 'test' }, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' } },
  ] } } };
  assert.equal(handler(createBattleContext(sealed, () => 0), hit), undefined, '御魂封印时不触发');
  assert.equal(registry.getSoul(debuffSoulIds.charm).mechanicsCoverage, 'partial');
});

test('混乱在敌我存活目标中随机普攻，嘲讽强制攻击来源单位', () => {
  const registry = new ContentRegistry();
  const skill = { id: 'test.control-basic', target: 'single', targetRelation: 'enemy', levels: [{}],
    execute(_context, intent) { return [{ type: 'deal-damage', source: { kind: 'skill', id: skill.id, unitId: intent.actorId },
      targetId: intent.targetIds[0], amount: 10 }]; } };
  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [skill],
    policy(_context, actorId) { return { actorId, skillId: skill.id, targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }; } });
  const makeInitial = (controlType, sourceUnitId) => {
    const initial = state();
    initial.counters = { ...initial.counters, action: 0, attack: 0, hit: 0 };
    initial.units['blue-1'] = { ...initial.units['blue-1'], stats: { ...initial.units['blue-1'].stats, speed: 300 }, statuses: [{
      instanceId: `control:${controlType}`, statusId: `test.${controlType}`, source: { kind: 'unit', id: String(sourceUnitId), unitId: sourceUnitId },
      appliedByEventId: 'control-applied', stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
      values: { controlType },
    }] };
    initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', hp: 20,
      stats: { ...initial.units['blue-1'].stats, hp: 100, speed: 10 }, statuses: [] };
    initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, speed: 10 } };
    initial.sides.blue = ['blue-1', 'blue-2'];
    return initial;
  };
  const confusionTargets = new Set();
  for (const seed of [1, 123456789]) {
    const confused = runBattle(makeInitial('混乱', 'red-1'), registry, { seed, actionLimit: 1 });
    const targetId = confused.events.find(event => event.type === 'attack-start')?.targetIds[0];
    assert.ok(['blue-2', 'red-1'].includes(targetId));
    assert.equal(confused.events.find(event => event.type === 'damage')?.targetId, targetId);
    assert.equal(confused.events.find(event => event.type === 'attack-start')?.source.kind, 'status');
    assert.equal(confused.events.some(event => event.type === 'action-declared'), false);
    confusionTargets.add(targetId);
  }
  assert.deepEqual([...confusionTargets].sort(), ['blue-2', 'red-1']);

  const taunted = runBattle(makeInitial('嘲讽', 'red-1'), registry, { seed: 7, actionLimit: 1 });
  assert.equal(taunted.events.find(event => event.type === 'attack-start')?.targetIds[0], 'red-1');
  assert.equal(taunted.events.find(event => event.type === 'damage')?.targetId, 'red-1');
});

test('鸩的注册式规则按敌方人数与毒羽状态选技，并结算毒羽叠层和消耗', () => {
  const registry = new ContentRegistry();
  registerZhen(registry);
  const multi = state();
  multi.counters = { ...multi.counters, action: 0, attack: 0, hit: 0 };
  multi.units['blue-1'] = { ...multi.units['blue-1'], heroId: zhenIds.hero, stats: { ...multi.units['blue-1'].stats, speed: 300 } };
  multi.units['red-1'] = { ...multi.units['red-1'], stats: { ...multi.units['red-1'].stats, speed: 10 } };
  multi.units['red-2'] = { ...multi.units['red-1'], unitId: 'red-2', hp: 100, stats: { ...multi.units['red-1'].stats, hp: 100, speed: 5 } };
  multi.sides.red = ['red-1', 'red-2'];
  multi.resources.blue.fire = 2;
  const bloom = runBattle(multi, registry, { seed: 13, actionLimit: 1 });
  assert.equal(bloom.events.find(event => event.type === 'action-declared')?.intent.skillId, zhenIds.poisonBloom);
  assert.equal(bloom.state.units['red-1'].statuses.find(status => status.statusId === zhenIds.poisonFeather)?.stacks, 2);
  assert.equal(bloom.state.units['red-2'].statuses.find(status => status.statusId === zhenIds.poisonFeather)?.stacks, 2);
  assert.equal(bloom.events.filter(event => event.type === 'damage' && event.source.id === zhenIds.poisonBloom).length, 2);

  const basicState = structuredClone(multi);
  basicState.resources.blue.fire = 0;
  basicState.units['red-1'] = { ...basicState.units['red-1'], hp: 500, stats: { ...basicState.units['red-1'].stats, hp: 500 }, statuses: [] };
  const basic = runBattle(basicState, registry, { seed: 15, actionLimit: 1 });
  assert.equal(basic.events.find(event => event.type === 'action-declared')?.intent.skillId, zhenIds.basic);
  assert.equal(basic.state.units['red-1'].statuses.find(status => status.statusId === zhenIds.poisonFeather)?.stacks, 2,
    JSON.stringify(basic.events));

  const erodeState = state();
  erodeState.counters = { ...erodeState.counters, action: 0, attack: 0, hit: 0 };
  erodeState.units['blue-1'] = { ...erodeState.units['blue-1'], heroId: zhenIds.hero, stats: { ...erodeState.units['blue-1'].stats, speed: 300 } };
  erodeState.units['red-1'] = { ...erodeState.units['red-1'], hp: 500, stats: { ...erodeState.units['red-1'].stats, hp: 500 }, statuses: [{
    instanceId: 'zhen-poison-two', statusId: zhenIds.poisonFeather, source: { kind: 'skill', id: zhenIds.basic, unitId: 'blue-1' },
    stacks: 2, duration: { kind: 'permanent' },
  }] };
  erodeState.resources.blue.fire = 3;
  const erode = runBattle(erodeState, registry, { seed: 14, actionLimit: 1 });
  assert.equal(erode.events.find(event => event.type === 'action-declared')?.intent.skillId, zhenIds.poisonErode);
  assert.ok(erode.events.some(event => event.type === 'damage' && event.source.id === zhenIds.poisonErode
    && event.damageKind === 'true' && event.amount === 70), JSON.stringify(erode.events.filter(event => event.type === 'damage')));
  assert.equal(erode.state.units['red-1'].statuses.some(status => status.statusId === zhenIds.poisonFeather), false);

  const incoming = state();
  incoming.counters = { ...incoming.counters, action: 0, attack: 0, hit: 0 };
  incoming.units['blue-1'] = { ...incoming.units['blue-1'], heroId: zhenIds.hero, stats: { ...incoming.units['blue-1'].stats, speed: 5 } };
  incoming.units['red-1'] = { ...incoming.units['red-1'], stats: { ...incoming.units['red-1'].stats, speed: 300 } };
  const strike = { id: 'test.zhen-passive-strike', target: 'single', targetRelation: 'enemy', levels: [{}],
    execute(_context, intent) { return [{ type: 'deal-damage', source: { kind: 'skill', id: 'test.zhen-passive-strike', unitId: intent.actorId },
      targetId: intent.targetIds[0], amount: 5 }]; } };
  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [strike],
    policy(_context, actorId) { return { actorId, skillId: strike.id, targetIds: ['blue-1'], shape: 'single', targetRelation: 'enemy' }; } });
  const passive = runBattle(incoming, registry, { seed: 16, actionLimit: 1 });
  assert.equal(passive.state.units['red-1'].statuses.find(status => status.statusId === zhenIds.poisonFeather)?.stacks, 1);
});

test('兔丸按胡萝卜和友方控制状态选守护之心，并驱散、推条后消耗资源', () => {
  const registry = new ContentRegistry();
  registerRabbitMaru(registry);
  registry.registerStatus({ id: 'test.rabbit-stun', mechanicsCoverage: 'verified', category: 'control', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  const initial = state();
  initial.counters = { ...initial.counters, action: 0, attack: 0, hit: 0 };
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: rabbitMaruIds.hero, skillLevel: 3,
    stats: { ...initial.units['blue-1'].stats, speed: 300 }, statuses: [{
      instanceId: 'rabbit-carrots', statusId: rabbitMaruIds.carrots,
      source: { kind: 'skill', id: rabbitMaruIds.passive, unitId: 'blue-1' }, stacks: 1, duration: { kind: 'permanent' },
    }] };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 1, hp: 100, shield: 0, actionGauge: 0, resources: {},
    stats: { ...initial.units['blue-1'].stats, hp: 100, speed: 10 }, statuses: [{
      instanceId: 'rabbit-stun', statusId: 'test.rabbit-stun', source: { kind: 'unit', id: 'test', unitId: 'red-1' },
      stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { controlType: '眩晕' },
    }] };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, speed: 5 } };
  initial.sides.blue = ['blue-1', 'blue-2'];
  initial.resources.blue.fire = 2;
  const result = runBattle(initial, registry, { seed: 4, actionLimit: 1 });
  assert.equal(result.events.find(event => event.type === 'action-declared')?.intent.skillId, rabbitMaruIds.cleanse);
  assert.ok(result.events.some(event => event.type === 'action-gauge-changed' && event.unitId === 'blue-2'
    && event.after - event.before === 40));
  assert.equal(result.state.units['blue-1'].statuses.some(status => status.statusId === rabbitMaruIds.carrots), false);
  assert.equal(result.state.resources.blue.fire, 0);

  const cleanse = executeAction(initial, { actorId: 'blue-1', skillId: rabbitMaruIds.cleanse, targetIds: ['blue-2'],
    shape: 'single', targetRelation: 'ally' }, registry, () => .5, { resolveStatus: statusId => registry.getStatus(statusId) });
  assert.equal(cleanse.events.some(event => event.type === 'status-removed' && event.targetId === 'blue-2'
    && event.statusId === 'test.rabbit-stun' && event.reason === 'dispelled'), true);
  assert.ok(cleanse.events.some(event => event.type === 'action-gauge-changed' && event.unitId === 'blue-2'
    && event.after - event.before === 40));
});

test('兵主部每回合获得75点防御忽略，最多3层并进入通用伤害公式', () => {
  const registry = new ContentRegistry();
  registerRampingSouls(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: rampingSoulIds.warriorChief };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, defense: 300 } };
  const handler = registry.getSoul(rampingSoulIds.warriorChief).handlers['turn-end'].handle;
  let current = initial;
  const stackCounts = [];
  for (let action = 1; action <= 4; action++) {
    const event = { type: 'turn-ended', eventId: `warrior-chief-end-${action}`, phase: 'turn-end',
      source: { kind: 'unit', id: '1', unitId: 'blue-1' }, actionId: action, unitId: 'blue-1' };
    const commands = handler(createBattleContext(current, () => .5), event);
    if (commands) {
      const applied = applyEffectCommands(current, commands, 'effect-resolution', `warrior-chief-${action}`, id => registry.getStatus(id));
      current = applied.state;
      stackCounts.push(current.units['blue-1'].statuses.find(status => status.statusId === rampingSoulIds.warriorChiefStacks).stacks);
    }
  }
  const stacks = current.units['blue-1'].statuses.find(status => status.statusId === rampingSoulIds.warriorChiefStacks);
  assert.deepEqual(stackCounts, [1, 2, 3]);
  assert.equal(stacks.stacks, 3);
  assert.equal(require('../dist-test-renderer/renderer/features/duel/engine/mechanics/stats.js')
    .effectiveDefenseIgnore(current.units['blue-1']), 225);
  const basic = createBasicAttackSkill('test.warrior-chief-basic', [1]);
  const commands = basic.execute(createBattleContext(current, () => .9),
    { actorId: 'blue-1', skillId: basic.id, targetIds: ['red-1'], shape: 'single' }, { ratio: 1 });
  assert.ok(Math.abs(commands[0].amount - 80) < 1e-10,
    '普通攻击用300防御减去225点忽略后的防御值计算伤害');
});

test('狂骨逐段读取支付技能费用后的鬼火，真实伤害不吃增伤', () => {
  const registry = new ContentRegistry();
  registerDamageScalingSouls(registry);
  const skill = { id: 'test.mad-bone-costly', target: 'single', targetRelation: 'enemy', resourceCost: { resourceId: 'fire', amount: 3 },
    levels: [{}], execute(_context, intent) {
      const source = { kind: 'skill', id: 'test.mad-bone-costly', unitId: intent.actorId };
      return [
        { type: 'deal-damage', source, targetId: intent.targetIds[0], amount: 100 },
        { type: 'deal-damage', source, targetId: intent.targetIds[0], amount: 100 },
        { type: 'deal-damage', source, targetId: intent.targetIds[0], amount: 100, damageKind: 'true' },
      ];
    } };
  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [skill],
    policy(_context, actorId) { return { actorId, skillId: skill.id, targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }; } });
  const initial = state();
  initial.counters = { ...initial.counters, action: 0 };
  initial.resources.blue.fire = 5;
  initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: damageScalingSoulIds.madBone,
    stats: { ...initial.units['blue-1'].stats, speed: 200 } };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 1000, shield: 0,
    stats: { ...initial.units['red-1'].stats, hp: 1000 } };
  const result = runBattle(initial, registry, { seed: 5, actionLimit: 1 });
  const damage = result.events.filter(event => event.type === 'damage');
  assert.equal(damage.length, 3);
  assert.ok(Math.abs(damage[0].amount - 116) < 1e-10);
  assert.ok(Math.abs(damage[1].amount - 116) < 1e-10);
  assert.equal(damage[2].amount, 100);
  assert.equal(result.state.resources.blue.fire, 2);
  assert.ok(result.diagnostics.some(item => item.contentId === damageScalingSoulIds.madBone && item.status === 'verified'));
});

test('日女巳时对带增益或印记目标提高推条概率并击退30%', () => {
  const registry = new ContentRegistry();
  registerDawnlessDusk(registry);
  registry.registerStatus({ id: 'test.buff', mechanicsCoverage: 'verified', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: dawnlessDuskIds.soul };
  initial.units['red-1'] = { ...initial.units['red-1'], actionGauge: 50, statuses: [{ instanceId: 'buff', statusId: 'test.buff',
    source: { kind: 'skill', id: 'test.buff' }, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }] };
  const hit = { type: 'damage', eventId: 'dawnless-hit', phase: 'hit', source: { kind: 'skill', id: 'basic', unitId: 'blue-1' },
    actionId: 5, attackId: 2, hitIndex: 1, targetId: 'red-1', damageKind: 'normal', amount: 50, hpLost: 50, mitigated: 0, isCritical: false };
  const handler = registry.getSoul(dawnlessDuskIds.soul).handlers.hit.handle;
  assert.equal(handler(createBattleContext(initial, () => .25, id => registry.getStatus(id)?.category), hit)?.[0].amount, -30,
    '带增益时0.25低于30%触发率');
  const normalTarget = { ...initial, units: { ...initial.units, 'red-1': { ...initial.units['red-1'], statuses: [] } } };
  assert.equal(handler(createBattleContext(normalTarget, () => .25, id => registry.getStatus(id)?.category), hit)?.length ?? 0, 0,
    '无增益时0.25高于20%触发率');
  const commands = handler(createBattleContext(initial, () => 0, id => registry.getStatus(id)?.category), hit);
  const resolved = applyEffectCommands(initial, commands, 'hit', 'dawnless-dusk-test', id => registry.getStatus(id));
  assert.equal(resolved.state.units['red-1'].actionGauge, 20);
  assert.ok(resolved.events.some(event => event.type === 'action-gauge-changed' && event.after === 20));
});

test('镇墓兽只按当前缺失生命提高暴击额外伤害', () => {
  const registry = new ContentRegistry();
  registerGravekeeperBeast(registry);
  registerClothOfProtection(registry);
  const skill = { id: 'test.critical-hit', target: 'single', targetRelation: 'enemy', levels: [{}],
    execute(_context, intent) { return [{ type: 'deal-damage', source: { kind: 'skill', id: 'test.critical-hit', unitId: intent.actorId },
      targetId: intent.targetIds[0], amount: 150, criticalBaseAmount: 100, isCritical: true }]; } };
  registry.registerHero({ id: 1, aiCoverage: 'verified', mechanicsCoverage: 'verified', skills: [skill],
    policy(_context, actorId) { return { actorId, skillId: skill.id, targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }; } });
  const initial = state();
  initial.counters = { ...initial.counters, action: 0 };
  initial.units['blue-1'] = { ...initial.units['blue-1'], soulId: gravekeeperBeastIds.soul, hp: 500,
    stats: { ...initial.units['blue-1'].stats, hp: 1000, speed: 200 } };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 1000, shield: 0,
    stats: { ...initial.units['red-1'].stats, hp: 1000 } };
  const result = runBattle(initial, registry, { seed: 8, actionLimit: 1 });
  const damage = result.events.find(event => event.type === 'damage');
  assert.equal(damage.amount, 175, '50%缺失生命提升25%非暴击基础值');
  assert.equal(damage.isCritical, true);
  const protectedState = { ...initial, units: { ...initial.units,
    'red-1': { ...initial.units['red-1'], soulId: clothOfProtectionIds.soul } } };
  const protectedResult = runBattle(protectedState, registry, { seed: 8, actionLimit: 1 });
  assert.ok(Math.abs(protectedResult.events.find(event => event.type === 'damage').amount - 122.5) < 1e-9,
    '镇墓兽暴击增量仍要经过被服减伤');
  const fullHealth = { ...initial.units['blue-1'], hp: 1000 };
  const soul = registry.getSoul(gravekeeperBeastIds.soul);
  assert.equal(soul.modifyCriticalDamage(fullHealth, initial.units['red-1'], 150, 100, initial), 150);
});

test('薙魂只在单体攻击开始时掷一次，并使多段伤害共用同一攻击守护', () => {
  const registry = new ContentRegistry();
  registerBaselineSouls(registry);
  const initial = state();
  initial.counters = { round: 1, action: 1, attack: 4, hit: 0 };
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: 901, hp: 1000, shield: 0,
    stats: { ...initial.units['blue-1'].stats, hp: 1000, speed: 200 } };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 1000, shield: 0,
    stats: { ...initial.units['red-1'].stats, hp: 1000, defense: 300 } };
  initial.units['red-2'] = { ...initial.units['red-1'], unitId: 'red-2', soulId: baselineSoulIds.guard, hp: 1000, shield: 0,
    stats: { ...initial.units['red-1'].stats, defense: 0 } };
  initial.sides = { blue: ['blue-1'], red: ['red-1', 'red-2'] };
  const dispatcher = new EventDispatcher();
  for (const [phase, rule] of Object.entries(registry.getSoul(baselineSoulIds.guard).handlers)) {
    dispatcher.register({ id: `soul:${baselineSoulIds.guard}:${phase}`, phase, priority: rule.priority, handle: rule.handle });
  }
  const attackStart = { eventId: 'guarded-attack-start', phase: 'attack-start', source: { kind: 'skill', id: 'multi', unitId: 'blue-1' },
    actionId: 1, attackId: 4, type: 'attack-start', targetIds: ['red-1'], shape: 'single' };
  const selected = settleEvents(initial, [attackStart], dispatcher, () => .1, new TriggerBudget(64), id => registry.getStatus(id));
  assert.equal(selected.state.units['blue-1'].statuses.find(status => status.statusId === guardAttackStatusId).values.protectorId, 'red-2');
  const soul = registry.getSoul(baselineSoulIds.guard);
  const intercepted = applyEffectCommands(selected.state, [1, 2].map(() => ({ type: 'deal-damage',
    source: { kind: 'skill', id: 'multi', unitId: 'blue-1' }, targetId: 'red-1', amount: 100, parentEventId: attackStart.eventId })),
  'effect-resolution', 'guarded-hits', id => registry.getStatus(id), undefined,
  (current, attacker, target, amount, kind) => soul.interceptIncomingDamage(current, attacker, target, amount, kind));
  const guardHits = intercepted.events.filter(event => event.type === 'damage' && event.targetId === 'red-2');
  const targetHits = intercepted.events.filter(event => event.type === 'damage' && event.targetId === 'red-1');
  assert.deepEqual(guardHits.map(event => event.amount), [40, 40]);
  assert.deepEqual(targetHits.map(event => event.amount), [40, 40]);
  assert.deepEqual(guardHits.map(event => event.hitIndex), targetHits.map(event => event.hitIndex));
  const ended = settleEvents(intercepted.state, [{ eventId: 'guarded-attack-end', phase: 'attack-end', source: attackStart.source,
    actionId: 1, attackId: 4, type: 'attack-ended', hitCount: 2 }], dispatcher, () => .1,
  new TriggerBudget(64), id => registry.getStatus(id));
  assert.ok(!ended.state.units['blue-1'].statuses.some(status => status.statusId === guardAttackStatusId));
});

test('薙魂在完整模拟器中拦截每一段多段命中，但攻击段数不重复计数', () => {
  const registry = new ContentRegistry();
  registerBaselineSouls(registry);
  const skillId = 'test.guard-multi';
  registry.registerHero({ id: 901, skills: [{ id: skillId, target: 'single', targetRelation: 'enemy', levels: [{}],
    execute(_context, intent) { return [1, 2].map(() => ({ type: 'deal-damage', source: { kind: 'skill', id: skillId,
      unitId: intent.actorId }, targetId: intent.targetIds[0], amount: 100 })); } }], policy(_context, actorId) {
    return { actorId, skillId, targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' };
  } });
  const initial = state();
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: 901, hp: 1000, shield: 0,
    stats: { ...initial.units['blue-1'].stats, hp: 1000, attack: 100, defense: 0, speed: 300 } };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 1000, shield: 0,
    stats: { ...initial.units['red-1'].stats, hp: 1000, defense: 0, speed: 1 } };
  initial.units['red-2'] = { ...initial.units['red-1'], unitId: 'red-2', soulId: baselineSoulIds.guard };
  initial.sides = { blue: ['blue-1'], red: ['red-1', 'red-2'] };
  initial.resources = { blue: { fire: 4 }, red: { fire: 4 } };
  const result = Array.from({ length: 24 }, (_, index) => runBattle(initial, registry, { seed: index + 1, actionLimit: 1 }))
    .find(candidate => candidate.events.filter(event => event.type === 'damage' && event.targetId === 'red-2').length === 2);
  assert.ok(result, 'a deterministic seed should trigger the 50% guard roll');
  const attackEnd = result.events.find(event => event.type === 'attack-ended' && event.source.id === skillId);
  assert.ok(attackEnd);
  const damage = result.events.filter(event => event.type === 'damage' && event.attackId === attackEnd?.attackId);
  assert.equal(attackEnd.hitCount, 2);
  assert.equal(damage.filter(event => event.targetId === 'red-1').length, 2);
  assert.equal(damage.filter(event => event.targetId === 'red-2').length, 2);
  assert.ok(!result.state.units['blue-1'].statuses.some(status => status.statusId === guardAttackStatusId));
});

test('追月神 modular definition drives opening fire meter, AI, team blessing, and basic action advance', () => {
  const registry = new ContentRegistry();
  registerMoonChaser(registry);
  const initial = state();
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: moonChaserIds.hero, skillLevel: 5,
    stats: { ...initial.units['blue-1'].stats, hp: 1000, attack: 100, speed: 200 }, hp: 1000, shield: 0 };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 1, skillLevel: 1,
    stats: { ...initial.units['blue-1'].stats, speed: 100 }, statuses: [] };
  initial.sides = { blue: ['blue-1', 'blue-2'], red: ['red-1'] };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, speed: 90 }, hp: 1000, shield: 0 };
  const blessing = runBattle(initial, registry, { seed: 71, actionLimit: 1 });
  assert.equal(blessing.state.resources.blue.fire, 5);
  assert.deepEqual(blessing.state.units['blue-1'].statuses.map(status => status.statusId), [
    moonChaserIds.protectionStatus,
  ]);
  assert.ok(!blessing.state.units['blue-1'].statuses.some(status => status.statusId === moonChaserIds.blessingStatus),
    'Moon blessing buffs only the other friendly units');
  assert.equal(blessing.state.units['blue-2'].statuses.find(status => status.statusId === moonChaserIds.blessingStatus)
    .modifiers.find(modifier => modifier.stat === 'attack').amount, .2);
  assert.equal(blessing.state.units['blue-2'].statuses[0].modifiers.find(modifier => modifier.stat === 'speed').amount, 20);
  assert.ok(blessing.events.some(event => event.type === 'resource-meter-advanced' && event.progressAfter === 4));
  assert.ok(blessing.events.some(event => event.type === 'resource-meter-advanced' && event.supplied === 3));
  assert.ok(blessing.events.some(event => event.type === 'action-declared' && event.intent.skillId === moonChaserIds.blessingSkill));
  assert.equal(blessing.diagnostics.find(item => item.contentId === '295' && item.aspect === 'mechanics').status, 'verified');
  const blockedControl = applyEffectCommands(blessing.state, [{ type: 'apply-control',
    source: { kind: 'skill', id: 'test.enemy-control', unitId: 'red-1' }, targetId: 'blue-1', scopeId: 'enemy.skill.1',
    instance: { instanceId: 'test-control', statusId: 'control.test', source: { kind: 'skill', id: 'test.enemy-control', unitId: 'red-1' },
      stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } } }],
  'hit', 'moon-control', id => registry.getStatus(id));
  assert.ok(blockedControl.events.some(event => event.type === 'control-blocked'));
  assert.ok(!blockedControl.state.units['blue-1'].statuses.some(status => status.statusId === 'control.test'));

  const lowFire = { ...initial, resources: { ...initial.resources, blue: { fire: 0 } } };
  const meterPayment = runBattle(lowFire, registry, { seed: 73, actionLimit: 1 });
  assert.ok(meterPayment.events.some(event => event.type === 'action-declared' && event.intent.skillId === moonChaserIds.blessingSkill));
  assert.equal(meterPayment.state.resources.blue.fire, 0);
  assert.equal(meterPayment.state.resourceMeters.blue.fire.progress, 3);

  const solo = state();
  solo.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  solo.units['blue-1'] = { ...solo.units['blue-1'], heroId: moonChaserIds.hero, skillLevel: 1,
    stats: { ...solo.units['blue-1'].stats, hp: 1000, attack: 100, speed: 200 }, hp: 1000, shield: 0 };
  solo.units['red-1'] = { ...solo.units['red-1'], stats: { ...solo.units['red-1'].stats, hp: 1000, speed: 90 }, hp: 1000, shield: 0 };
  const basic = runBattle(solo, registry, { seed: 72, actionLimit: 1 });
  assert.ok(basic.events.some(event => event.type === 'action-declared' && event.intent.skillId === moonChaserIds.basic));
  assert.equal(basic.state.units['blue-1'].actionGauge, 20);
  assert.equal(basic.state.resourceMeters.blue.fire.progress, 2);
  assert.ok(basic.events.some(event => event.type === 'status-removed' && event.instanceId === `${moonChaserIds.protectionStatus}:opening:blue-1`));
  assert.ok(!basic.state.units['blue-1'].statuses.some(status => status.statusId === moonChaserIds.protectionStatus));
});

test('追月神月之祝福只给其他友方增益，并在其回合结束额外推进1格鬼火条', () => {
  const registry = new ContentRegistry();
  registerMoonChaser(registry);
  const initial = state();
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: moonChaserIds.hero, skillLevel: 4,
    stats: { ...initial.units['blue-1'].stats, speed: 1 } };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 1, skillLevel: 1, actionGauge: 99,
    stats: { ...initial.units['blue-1'].stats, speed: 10000 },
    statuses: [{ instanceId: 'moon-blessing-from-blue-1', statusId: moonChaserIds.blessingStatus,
      source: { kind: 'skill', id: moonChaserIds.blessingSkill, unitId: 'blue-1' }, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }] };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, speed: 1 } };
  initial.sides = { blue: ['blue-1', 'blue-2'], red: ['red-1'] };
  const result = runBattle(initial, registry, { seed: 76, actionLimit: 1 });
  assert.equal(result.state.resourceMeters.blue.fire.progress, 1,
    'four opening steps plus standard and blessing turn-end steps yield six: one supply and one remaining');
  assert.equal(result.state.resources.blue.fire, 7, 'the standard and blessing steps together supply three fire');
});

test('流光追月神 registers modular skills and resource meter supports pushback and overflow events', () => {
  const registry = new ContentRegistry();
  registerLuminousMoonChaser(registry);
  assert.ok(registry.getHero(luminousMoonChaserIds.hero));
  assert.equal(registry.getStatus(luminousMoonChaserIds.lostRadiance).blocksResourceMeterAdvance, true);
  const initial = state();
  initial.resources.blue.fire = 7;
  initial.resourceMeters.blue.fire = { ...initial.resourceMeters.blue.fire, progress: 4 };
  const overflow = applyEffectCommands(initial, [{ type: 'advance-resource-meter', source: { kind: 'unit', id: 'unit', unitId: 'blue-1' },
    side: 'blue', resourceId: 'fire', steps: 1 }], 'effect-resolution', 'test-overflow');
  assert.equal(overflow.state.resources.blue.fire, 8);
  assert.equal(overflow.events.find(event => event.type === 'resource-overflow').amount, 2);
  const pushback = applyEffectCommands(overflow.state, [{ type: 'advance-resource-meter', source: { kind: 'skill', id: '3951', unitId: 'blue-1' },
    side: 'red', resourceId: 'fire', steps: -1 }], 'effect-resolution', 'test-pushback');
  assert.equal(pushback.state.resourceMeters.red.fire.progress, 0);
});

test('流光追月神五级普攻击退鬼火条，但不影响怪物', () => {
  const registry = new ContentRegistry();
  registerLuminousMoonChaser(registry);
  const hero = registry.getHero(luminousMoonChaserIds.hero);
  const skill = hero.skills.find(item => item.id === luminousMoonChaserIds.basic);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: luminousMoonChaserIds.hero, skillLevel: 5 };
  const intent = { actorId: 'blue-1', skillId: luminousMoonChaserIds.basic, targetIds: ['red-1'],
    shape: 'single', targetRelation: 'enemy' };
  const context = createBattleContext(initial, () => .1);
  const shikigamiHit = skill.execute(context, intent, skill.levels[4]);
  assert.ok(shikigamiHit.some(command => command.type === 'advance-resource-meter' && command.side === 'red'
    && command.steps === -1));
  initial.units['red-1'] = { ...initial.units['red-1'], unitKind: 'monster' };
  const monsterContext = createBattleContext(initial, () => .1);
  const monsterHit = skill.execute(monsterContext, intent, skill.levels[4]);
  assert.ok(!monsterHit.some(command => command.type === 'advance-resource-meter'), '客户端说明该效果对怪物无效');
});

test('流光追月神开局鬼火条、技能费用和赋予状态读取各自技能等级', () => {
  const registry = new ContentRegistry();
  registerLuminousMoonChaser(registry);
  const hero = registry.getHero(luminousMoonChaserIds.hero);
  const initial = state();
  const actor = { ...initial.units['blue-1'], heroId: luminousMoonChaserIds.hero, skillLevel: 1,
    skillLevels: { [luminousMoonChaserIds.passive]: 3, [luminousMoonChaserIds.ultimate]: 4 } };
  initial.units[actor.unitId] = actor;
  initial.resources.blue.fire = 2;
  const initialized = hero.initialize(createBattleContext(initial, () => .5), actor.unitId);
  assert.ok(initialized.some(command => command.type === 'advance-resource-meter' && command.steps === 4),
    '初始鬼火条推进由被动技能三级决定');
  assert.equal(hero.policy(createBattleContext(initial, () => .5), actor.unitId).skillId, luminousMoonChaserIds.ultimate,
    '四级大招费用为2，策略不能误读全局一级');
  const cast = executeAction(initial, { actorId: actor.unitId, skillId: luminousMoonChaserIds.ultimate,
    targetIds: ['blue-1'], shape: 'all-allies', targetRelation: 'ally' }, registry, () => .5,
  { resolveStatus: id => registry.getStatus(id) });
  assert.equal(cast.accepted, true);
  assert.equal(cast.events.find(event => event.type === 'resource-changed' && event.phase === 'resource-payment').before
    - cast.events.find(event => event.type === 'resource-changed' && event.phase === 'resource-payment').after, 2);
  assert.equal(cast.state.units[actor.unitId].statuses.find(status => status.statusId === luminousMoonChaserIds.gathered)
    .values.ultimateRank, 4);
});

test('流光追月神仅唯一被动持有者获得流光，流光层数按每层10%增加效果抵抗', () => {
  const registry = new ContentRegistry();
  registerLuminousMoonChaser(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: luminousMoonChaserIds.hero, skillLevel: 5,
    stats: { ...initial.units['blue-1'].stats, resist: .05 } };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', statuses: [], stats: { ...initial.units['blue-1'].stats, speed: 90 } };
  initial.sides.blue = ['blue-1', 'blue-2'];
  const hero = registry.getHero(luminousMoonChaserIds.hero);
  const context = createBattleContext(initial, () => .5);
  const ownerCommands = hero.initialize(context, 'blue-1');
  const secondCommands = hero.initialize(context, 'blue-2');
  assert.ok(ownerCommands.some(command => command.type === 'add-status' && command.instance.statusId === luminousMoonChaserIds.flow));
  assert.deepEqual(secondCommands, [], '同侧重复上场时只有唯一被动持有者获得流光');
  const initialized = applyEffectCommands(initial, ownerCommands, 'battle-start', 'moon-chaser-init', id => registry.getStatus(id));
  assert.ok(Math.abs(effectiveStats(initialized.state.units['blue-1']).resist - .35) < 1e-9);
  assert.equal(initialized.state.units['blue-2'].statuses.some(status => status.statusId === luminousMoonChaserIds.flow), false);

  const lowFire = { ...initialized.state, resources: { ...initialized.state.resources,
    blue: { ...initialized.state.resources.blue, fire: 2 } } };
  const turnStart = hero.handlers['turn-start'].handle(createBattleContext(lowFire, () => .5), {
    type: 'turn-started', eventId: 'ally-turn-start', phase: 'turn-start', source: { kind: 'unit', id: '1', unitId: 'blue-2' },
    actionId: 1, unitId: 'blue-2' });
  const advanced = applyEffectCommands(lowFire, turnStart, 'turn-start', 'ally-turn-start', id => registry.getStatus(id));
  assert.equal(advanced.state.units['blue-1'].statuses.find(status => status.statusId === luminousMoonChaserIds.flow).stacks, 2);
  assert.ok(Math.abs(effectiveStats(advanced.state.units['blue-1']).resist - .25) < 1e-9,
    '消耗1层流光后效果抵抗同步减少10%');

  const sealedOwner = { ...initialized.state.units['blue-1'], statuses: [...initialized.state.units['blue-1'].statuses,
    { instanceId: 'passive-sealed', statusId: passiveSuppressionStatusId,
      source: { kind: 'skill', id: 'test-seal', unitId: 'red-1' }, stacks: 1, duration: { kind: 'permanent' } }] };
  const sealedState = { ...initialized.state, units: { ...initialized.state.units, [sealedOwner.unitId]: sealedOwner } };
  const turnEnd = hero.handlers['turn-end'].handle(createBattleContext(sealedState, () => .5), {
    type: 'turn-ended', eventId: 'sealed-owner-turn-end', phase: 'turn-end',
    source: { kind: 'unit', id: sealedOwner.unitId, unitId: sealedOwner.unitId }, actionId: 1, unitId: sealedOwner.unitId,
  });
  assert.equal(turnEnd, undefined, '被动封印期间不触发回合结束的鬼火推进与全队强化');
});

test('流光追月神五级集落光未消耗到期时同时驱散并给予攻击速度强化', () => {
  const registry = new ContentRegistry();
  registerLuminousMoonChaser(registry);
  registry.registerStatus({ id: 'test.moon-debuff', category: 'debuff', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const initial = state();
  const owner = { ...initial.units['blue-1'], heroId: luminousMoonChaserIds.hero,
    skillLevels: { [luminousMoonChaserIds.ultimate]: 5 } };
  const holder = { ...initial.units['blue-1'], unitId: 'blue-2', statuses: [{
    instanceId: 'retained-debuff', statusId: 'test.moon-debuff', source: { kind: 'skill', id: 'test', unitId: 'red-1' },
    stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
  }] };
  initial.units[owner.unitId] = owner;
  initial.units[holder.unitId] = holder;
  initial.sides.blue = [owner.unitId, holder.unitId];
  const event = { eventId: 'gathered-expired', phase: 'status-expiration', source: { kind: 'skill', id: luminousMoonChaserIds.ultimate,
    unitId: owner.unitId }, type: 'status-removed', targetId: holder.unitId, instanceId: 'gathered-instance',
    statusId: luminousMoonChaserIds.gathered, reason: 'expired', removedValues: { ownerUnitId: owner.unitId } };
  const handler = registry.getHero(luminousMoonChaserIds.hero).handlers['status-expiration'].handle;
  const commands = handler(createBattleContext(initial, () => .5, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable === true), event);
  assert.deepEqual(commands.map(command => command.type), ['dispel-statuses', 'add-status']);
  const applied = applyEffectCommands(initial, commands, 'status-expiration', event.eventId, id => registry.getStatus(id));
  assert.equal(applied.state.units[holder.unitId].statuses.some(status => status.statusId === 'test.moon-debuff'), false);
  const buff = applied.state.units[holder.unitId].statuses.find(status => status.statusId === luminousMoonChaserIds.overflowBuff);
  assert.deepEqual(buff.modifiers, [{ stat: 'attack', operation: 'percent', amount: .3 }, { stat: 'speed', operation: 'flat', amount: 30 }]);
});

test('流光追月神集落光按实际鬼火扣除推进鬼火条并令行动条最前敌方失彩', () => {
  const registry = new ContentRegistry();
  registerLuminousMoonChaser(registry);
  const initial = state();
  const owner = initial.units['blue-1'];
  const payer = { ...owner, unitId: 'blue-2', soulId: undefined, statuses: [{ instanceId: 'gathered-light',
    statusId: luminousMoonChaserIds.gathered, source: { kind: 'skill', id: luminousMoonChaserIds.ultimate,
      unitId: owner.unitId }, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
    values: { ownerUnitId: owner.unitId } }] };
  const fastEnemy = { ...initial.units['red-1'], unitId: 'red-2', actionGauge: 90, statuses: [] };
  initial.units[owner.unitId] = { ...owner, heroId: luminousMoonChaserIds.hero, skillLevel: 3,
    statuses: [{ instanceId: 'moon-unique', statusId: luminousMoonChaserIds.unique,
      source: { kind: 'skill', id: luminousMoonChaserIds.passive, unitId: owner.unitId }, stacks: 1,
    duration: { kind: 'permanent' } }, { instanceId: `${luminousMoonChaserIds.flow}:${owner.unitId}`, statusId: luminousMoonChaserIds.flow,
      source: { kind: 'skill', id: luminousMoonChaserIds.passive, unitId: owner.unitId }, stacks: 2,
      duration: { kind: 'permanent' }, modifiers: [{ stat: 'resist', operation: 'flat', amount: .1, perStack: true }] }] };
  initial.units[payer.unitId] = payer;
  initial.units[fastEnemy.unitId] = fastEnemy;
  initial.sides.blue = [owner.unitId, payer.unitId];
  initial.sides.red = ['red-1', fastEnemy.unitId];
  initial.resources.blue.fire = 5;

  const paid = applyEffectCommands(initial, [{ type: 'change-resource', source: { kind: 'skill', id: 'test.cost', unitId: payer.unitId },
    side: 'blue', resourceId: 'fire', amount: -3 }], 'resource-payment', 'moon-fire-payment', id => registry.getStatus(id));
  const fireSpent = paid.events.find(event => event.type === 'resource-changed');
  const handler = registry.getHero(luminousMoonChaserIds.hero).handlers['effect-resolution'].handle;
  const commands = handler(createBattleContext(paid.state, () => .5, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable === true), fireSpent);
  assert.deepEqual(commands.map(command => command.type), ['add-status', 'remove-statuses', 'advance-resource-meter', 'add-status']);
  assert.equal(commands[2].steps, 3, '一次三点鬼火消耗返还三格鬼火条，但只消耗一层流光');
  assert.equal(commands[3].targetId, fastEnemy.unitId, '失彩施加给行动条最前的敌方单位');
  assert.deepEqual(commands[3].instance.duration, { kind: 'count', remaining: 2, owner: 'target-turn' });
  const result = applyEffectCommands(paid.state, commands, 'effect-resolution', fireSpent.eventId, id => registry.getStatus(id));
  assert.equal(result.state.units[owner.unitId].statuses.find(status => status.statusId === luminousMoonChaserIds.flow).stacks, 1);
  assert.equal(result.state.resourceMeters.blue.fire.progress, initial.resourceMeters.blue.fire.progress + 3);
  assert.equal(result.state.units[payer.unitId].statuses.some(status => status.statusId === luminousMoonChaserIds.gathered), false);
  assert.ok(result.state.units[fastEnemy.unitId].statuses.some(status => status.statusId === luminousMoonChaserIds.lostRadiance));
});

test('修罗鬼童丸 modular skill flow initializes the trap, builds Soul Net, and suppresses direct target selection', () => {
  const registry = new ContentRegistry();
  registerShuraKidomaru(registry);
  const initial = state();
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: shuraKidomaruIds.hero, skillLevel: 5,
    stats: { ...initial.units['blue-1'].stats, hp: 1000, attack: 100, speed: 200 }, hp: 1000 };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 1, skillLevel: 1, statuses: [], hp: 1000 };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, hp: 1000, speed: 90 }, hp: 1000 };
  initial.sides = { blue: ['blue-1', 'blue-2'], red: ['red-1'] };
  const opened = runBattle(initial, registry, { seed: 396, actionLimit: 1 });
  assert.ok(opened.events.some(event => event.type === 'action-declared' && event.intent.skillId === shuraKidomaruIds.trapSkill),
    JSON.stringify({ firstAction: opened.events.filter(event => event.type === 'action-declared').map(event => event.intent), fire: opened.state.resources.blue.fire,
      blueStatuses: opened.state.units['blue-1'].statuses.map(status => status.statusId), reason: opened.reason }));
  assert.ok(opened.events.some(event => event.type === 'status-added' && event.instance.statusId === shuraKidomaruIds.soulNet));
  assert.ok(!opened.state.units['blue-1'].statuses.some(status => status.statusId === shuraKidomaruIds.trap));

  const targetRegistry = new ContentRegistry();
  registerShuraKidomaru(targetRegistry);
  const { createBasicAttackSkill } = require('../dist-test-renderer/renderer/features/duel/engine/content/common-skills.js');
  targetRegistry.registerHero({ id: 2, skills: [createBasicAttackSkill('enemy.basic', [1])], aiCoverage: 'partial' });
  const protectedState = state();
  protectedState.units['blue-1'] = { ...protectedState.units['blue-1'], heroId: shuraKidomaruIds.hero,
    statuses: [{ instanceId: 'trap', statusId: shuraKidomaruIds.trap,
      source: { kind: 'skill', id: shuraKidomaruIds.trapSkill, unitId: 'blue-1' }, stacks: 1, duration: { kind: 'permanent' } }] };
  protectedState.units['blue-2'] = { ...protectedState.units['blue-1'], unitId: 'blue-2', heroId: 1, statuses: [] };
  protectedState.units['red-1'] = { ...protectedState.units['red-1'], heroId: 2 };
  protectedState.sides = { blue: ['blue-1', 'blue-2'], red: ['red-1'] };
  const attack = executeAction(protectedState, { actorId: 'red-1', skillId: 'enemy.basic', targetIds: ['blue-1'],
    shape: 'single', targetRelation: 'enemy' }, targetRegistry, () => .5);
  assert.deepEqual(attack.events.find(event => event.type === 'action-declared').intent.targetIds, ['blue-2']);
});

test('修罗鬼童丸只有成功附加新失魂后才替换旧目标的失魂', () => {
  const registry = new ContentRegistry();
  registerShuraKidomaru(registry);
  const dispatcher = new EventDispatcher();
  for (const [phase, rule] of Object.entries(registry.getHero(shuraKidomaruIds.hero).handlers))
    dispatcher.register({ id: `shura-mark-replacement:${phase}`, phase, priority: rule.priority, handle: rule.handle });
  const createState = resist => {
    const initial = state();
    const source = { kind: 'skill', id: shuraKidomaruIds.trapSkill, unitId: 'blue-1' };
    initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: shuraKidomaruIds.hero, skillLevel: 1,
      statuses: [{ instanceId: 'unique', statusId: shuraKidomaruIds.unique, source, stacks: 1, duration: { kind: 'permanent' } }] };
    initial.units['red-1'] = { ...initial.units['red-1'], statuses: [{ instanceId: 'old-delirium',
      statusId: shuraKidomaruIds.delirium, source, stacks: 1, duration: { kind: 'permanent' }, values: { ownerUnitId: 'blue-1' } }] };
    initial.units['red-2'] = { ...initial.units['red-1'], unitId: 'red-2', statuses: [],
      stats: { ...initial.units['red-1'].stats, resist } };
    initial.sides.red = ['red-1', 'red-2'];
    initial.resources.blue.fire = 4;
    return initial;
  };
  const cast = initial => executeAction(initial, { actorId: 'blue-1', skillId: shuraKidomaruIds.trapSkill,
    targetIds: ['red-2'], shape: 'single', targetRelation: 'enemy' }, registry, () => .5,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });

  const resisted = cast(createState(1));
  assert.ok(resisted.state.units['red-1'].statuses.some(status => status.statusId === shuraKidomaruIds.delirium));
  assert.equal(resisted.state.units['red-2'].statuses.some(status => status.statusId === shuraKidomaruIds.delirium), false);
  assert.ok(resisted.events.some(event => event.type === 'status-resisted' && event.statusId === shuraKidomaruIds.delirium));

  const applied = cast(createState(0));
  assert.equal(applied.state.units['red-1'].statuses.some(status => status.statusId === shuraKidomaruIds.delirium), false);
  assert.ok(applied.state.units['red-2'].statuses.some(status => status.statusId === shuraKidomaruIds.delirium));
});

test('修罗鬼童丸失魂强制敌方按其普攻规则攻击随机友方，并保留行动事件', () => {
  const registry = new ContentRegistry();
  registerShuraKidomaru(registry);
  const initial = state();
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: shuraKidomaruIds.hero, skillLevel: 5,
    stats: { ...initial.units['blue-1'].stats, hp: 10000, attack: 100, speed: 200 }, hp: 10000,
    statuses: [{ instanceId: 'forced-basic', statusId: shuraKidomaruIds.forcedAttack,
      source: { kind: 'skill', id: shuraKidomaruIds.trapSkill, unitId: 'red-1' }, stacks: 1,
      duration: { kind: 'permanent' }, values: { controlType: 'forced-random-ally' } }] };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', statuses: [], hp: 10000,
    stats: { ...initial.units['blue-1'].stats, speed: 50 } };
  initial.units['red-1'] = { ...initial.units['red-1'], heroId: shuraKidomaruIds.hero, skillLevel: 5,
    stats: { ...initial.units['red-1'].stats, hp: 10000, attack: 1000, speed: 10 }, hp: 10000 };
  initial.sides = { blue: ['blue-1', 'blue-2'], red: ['red-1'] };
  const result = runBattle(initial, registry, { seed: 396, actionLimit: 1 });
  const attack = result.events.filter(event => event.type === 'damage' && event.source.unitId === 'blue-1');
  assert.equal(attack.length, 2, '被强制攻击者执行其普攻的两段结算');
  assert.deepEqual(new Set(attack.map(event => event.targetId)), new Set(['blue-2']));
  const declared = result.events.find(event => event.type === 'action-declared' && event.intent.actorId === 'blue-1');
  assert.equal(declared.intent.skillId, shuraKidomaruIds.basic);
  assert.equal(declared.intent.targetRelation, 'ally');
  assert.equal(declared.parentEventId, 'turn-1-start', '行动声明应回链到失魂判定发生的回合开始事件');
  assert.ok(result.events.some(event => event.type === 'action-ended' && event.source.unitId === 'blue-1'));
});

test('修罗鬼童丸失魂三级将回合开始强制普攻基础概率从60%提升至80%', () => {
  const registry = new ContentRegistry();
  registerShuraKidomaru(registry);
  const handler = registry.getHero(shuraKidomaruIds.hero).handlers['turn-start'].handle;
  for (const [skillLevel, expected] of [[1, false], [2, false], [3, true]]) {
    const initial = state();
    initial.units['red-1'] = { ...initial.units['red-1'], heroId: shuraKidomaruIds.hero, skillLevel: 1,
      skillLevels: { [shuraKidomaruIds.trapSkill]: skillLevel } };
    initial.units['blue-1'] = { ...initial.units['blue-1'], statuses: [{ instanceId: `delirium-${skillLevel}`,
      statusId: shuraKidomaruIds.delirium, source: { kind: 'skill', id: shuraKidomaruIds.trapSkill, unitId: 'red-1' },
      stacks: 1, duration: { kind: 'permanent' }, values: { ownerUnitId: 'red-1' } }] };
    const commands = handler(createBattleContext(initial, () => .7), { type: 'turn-started', eventId: `victim-turn-${skillLevel}`,
      phase: 'turn-start', source: { kind: 'unit', id: 'blue-1', unitId: 'blue-1' }, actionId: skillLevel, unitId: 'blue-1' });
    assert.equal(commands.some(command => command.type === 'add-status' && command.instance.statusId === shuraKidomaruIds.forcedAttack), expected);
  }
});

test('修罗鬼童丸失魂强制普攻按基础概率、命中与目标抵抗结算并关联回合开始事件', () => {
  const registry = new ContentRegistry();
  registerShuraKidomaru(registry);
  const initial = state();
  initial.units['red-1'] = { ...initial.units['red-1'], heroId: shuraKidomaruIds.hero,
    stats: { ...initial.units['red-1'].stats, hit: .5 } };
  initial.units['blue-1'] = { ...initial.units['blue-1'], stats: { ...initial.units['blue-1'].stats, resist: .5 },
    statuses: [{ instanceId: 'delirium', statusId: shuraKidomaruIds.delirium,
      source: { kind: 'skill', id: shuraKidomaruIds.trapSkill, unitId: 'red-1' }, stacks: 1,
      duration: { kind: 'permanent' }, values: { ownerUnitId: 'red-1' } }] };
  const event = { type: 'turn-started', eventId: 'shura-marked-turn-start', phase: 'turn-start',
    source: { kind: 'unit', id: 'blue-1', unitId: 'blue-1' }, actionId: 20, unitId: 'blue-1' };
  const handler = registry.getHero(shuraKidomaruIds.hero).handlers['turn-start'].handle;
  const resisted = handler(createBattleContext(initial, () => .5), event);
  assert.ok(resisted.some(command => command.type === 'report-status-resisted'
    && command.statusId === shuraKidomaruIds.forcedAttack && command.parentEventId === event.eventId));
  assert.equal(resisted.some(command => command.type === 'add-status' && command.instance.statusId === shuraKidomaruIds.forcedAttack), false);
  const applied = handler(createBattleContext(initial, () => .4), event);
  assert.ok(applied.some(command => command.type === 'add-status' && command.instance.statusId === shuraKidomaruIds.forcedAttack
    && command.parentEventId === event.eventId));
});

test('修罗鬼童丸魂网减伤、四级追猎加层和五级追猎追加攻击读取对应技能等级', () => {
  const registry = new ContentRegistry();
  registerShuraKidomaru(registry);
  const statusMultiplierFor = rank => {
    const initial = state();
    initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: shuraKidomaruIds.hero, skillLevel: 1,
      skillLevels: { [shuraKidomaruIds.trapSkill]: rank } };
    initial.resources.blue.fire = 4;
    const result = executeAction(initial, { actorId: 'blue-1', skillId: shuraKidomaruIds.trapSkill,
      targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => 0,
    { resolveStatus: id => registry.getStatus(id) });
    assert.equal(result.accepted, true);
    return effectiveDamageTakenMultiplier(result.state.units['blue-1']);
  };
  assert.equal(statusMultiplierFor(1), 1);
  assert.equal(statusMultiplierFor(2), .6);
  assert.equal(statusMultiplierFor(4), .4);

  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: shuraKidomaruIds.hero, skillLevel: 1,
    skillLevels: { [shuraKidomaruIds.trapSkill]: 1, [shuraKidomaruIds.citySkill]: 4 },
    statuses: [{ instanceId: 'net-four', statusId: shuraKidomaruIds.soulNet,
      source: { kind: 'skill', id: shuraKidomaruIds.trapSkill, unitId: 'blue-1' }, stacks: 2,
      duration: { kind: 'permanent' }, values: { reductions: 0 } }] };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 10000,
    stats: { ...initial.units['red-1'].stats, hp: 10000 } };
  initial.resources.blue.fire = 4;
  const city = executeAction(initial, { actorId: 'blue-1', skillId: shuraKidomaruIds.citySkill,
    targetIds: ['red-1'], shape: 'multi', targetRelation: 'enemy' }, registry, () => .5,
  { resolveStatus: id => registry.getStatus(id) });
  assert.equal(city.accepted, true);
  assert.equal(city.state.units['blue-1'].statuses.filter(status => status.statusId === shuraKidomaruIds.soulNet).length, 1);
  assert.equal(city.state.units['blue-1'].statuses.find(status => status.statusId === shuraKidomaruIds.soulNet).stacks, 3);
});

test('修罗鬼童丸 multi-hit city skill drains actual damage and locks single-target action gauge changes', () => {
  const registry = new ContentRegistry();
  registerShuraKidomaru(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: shuraKidomaruIds.hero, skillLevel: 3,
    stats: { ...initial.units['blue-1'].stats, hp: 1000, attack: 200, speed: 200 }, hp: 300 };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, hp: 3000, defense: 0, speed: 90 }, hp: 3000 };
  const dispatcher = new EventDispatcher();
  for (const [phase, rule] of Object.entries(registry.getHero(shuraKidomaruIds.hero).handlers))
    dispatcher.register({ id: `test-shura:${phase}`, phase, priority: rule.priority, handle: rule.handle });
  const result = executeAction(initial, { actorId: 'blue-1', skillId: shuraKidomaruIds.citySkill, targetIds: ['red-1'],
    shape: 'multi', targetRelation: 'enemy' }, registry, () => .5, { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(result.events.filter(event => event.type === 'damage' && event.source.id === shuraKidomaruIds.citySkill).length, 3);
  assert.ok(result.state.units['blue-1'].hp > 300);
  assert.ok(result.state.units['red-1'].statuses.some(status => status.statusId === shuraKidomaruIds.actionLock
    && status.duration.remaining === 2));
  const gauge = applyEffectCommands(result.state, [{ type: 'change-action-gauge', source: { kind: 'skill', id: 'test.gauge' },
    targetId: 'red-1', amount: 40 }], 'effect-resolution', 'test-action-lock', id => registry.getStatus(id));
  assert.equal(gauge.state.units['red-1'].actionGauge, result.state.units['red-1'].actionGauge);
});

test('修罗鬼童丸每减少两层魂网触发追猎绝击，只抑制受击目标的御魂触发', () => {
  const registry = new ContentRegistry();
  registerShuraKidomaru(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: shuraKidomaruIds.hero, skillLevel: 1,
    skillLevels: { [shuraKidomaruIds.citySkill]: 5 },
    soulId: 'test.attacker-soul',
    stats: { ...initial.units['blue-1'].stats, attack: 200, speed: 200 }, statuses: [{ instanceId: 'net',
      statusId: shuraKidomaruIds.soulNet, source: { kind: 'skill', id: shuraKidomaruIds.trapSkill, unitId: 'blue-1' },
      stacks: 3, duration: { kind: 'permanent' }, values: { reductions: 1 } }] };
  initial.units['red-1'] = { ...initial.units['red-1'], soulId: 'test.target-soul',
    stats: { ...initial.units['red-1'].stats, hp: 2000, speed: 100 }, hp: 2000 };
  initial.units['red-2'] = { ...initial.units['red-1'], unitId: 'red-2', heroId: 2, hp: 2000 };
  initial.sides = { blue: ['blue-1'], red: ['red-1', 'red-2'] };
  registry.registerSoul({ id: 'test.target-soul', handlers: { hit: { priority: 0, handle: (context, event) => event.type === 'damage'
    && event.targetId === 'red-1' ? [{ type: 'change-action-gauge', source: { kind: 'soul', id: 'test.target-soul', unitId: 'red-1' },
      targetId: 'red-1', amount: 40 }] : [] } } });
  registry.registerSoul({ id: 'test.attacker-soul', handlers: { hit: { priority: 0, handle: (context, event) => event.type === 'damage'
    && event.source.unitId === 'blue-1' ? [{ type: 'change-action-gauge', source: { kind: 'soul', id: 'test.attacker-soul', unitId: 'blue-1' },
      targetId: 'blue-1', amount: 10 }] : [] } } });
  const dispatcher = new EventDispatcher();
  for (const [phase, rule] of Object.entries(registry.getHero(shuraKidomaruIds.hero).handlers))
    dispatcher.register({ id: `hero:${shuraKidomaruIds.hero}:${phase}`, phase, priority: rule.priority, handle: rule.handle });
  for (const id of ['test.target-soul', 'test.attacker-soul'])
    dispatcher.register({ id: `soul:${id}:hit`, phase: 'hit', priority: 0, handle: registry.getSoul(id).handlers.hit.handle });
  const settled = settleEvents(initial, [{ eventId: 'shura-turn-end', phase: 'turn-end', source: { kind: 'unit', id: '396', unitId: 'blue-1' },
    actionId: 3, type: 'turn-ended', unitId: 'blue-1' }], dispatcher, () => .5, new TriggerBudget(), id => registry.getStatus(id));
  assert.equal(settled.state.units['blue-1'].statuses.find(status => status.statusId === shuraKidomaruIds.soulNet).stacks, 2);
  assert.equal(settled.events.filter(event => event.type === 'damage' && event.source.id === shuraKidomaruIds.citySkill).length, 4,
    JSON.stringify(settled.events.map(event => ({ type: event.type, phase: event.phase, source: event.source.id }))));
  assert.ok(settled.events.some(event => event.type === 'action-scheduled' && event.preResolved));
  assert.equal(settled.state.units['red-1'].actionGauge, initial.units['red-1'].actionGauge);
  assert.equal(settled.state.units['blue-1'].actionGauge, initial.units['blue-1'].actionGauge + 40,
    '攻击者御魂仍响应追猎绝击的四段伤害，只有受击方御魂触发被抑制');
});

test('修罗鬼童丸被封被动时魂网仍按回合结束减层并触发技能状态追猎', () => {
  const registry = new ContentRegistry();
  registerShuraKidomaru(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: shuraKidomaruIds.hero, skillLevel: 5,
    statuses: [
      { instanceId: 'passive-seal', statusId: passiveSuppressionStatusId,
        source: { kind: 'skill', id: 'test.seal', unitId: 'red-1' }, stacks: 1,
        duration: { kind: 'count', remaining: 1, owner: 'target-turn' } },
      { instanceId: 'soul-net', statusId: shuraKidomaruIds.soulNet,
        source: { kind: 'skill', id: shuraKidomaruIds.trapSkill, unitId: 'blue-1' }, stacks: 2,
        duration: { kind: 'permanent' }, values: { reductions: 1 } },
    ] };
  const rules = registry.getHero(shuraKidomaruIds.hero).handlers;
  const dispatcher = new EventDispatcher();
  for (const [phase, rule] of Object.entries(rules))
    dispatcher.register({ id: `shura-sealed:${phase}`, phase, priority: rule.priority, handle: rule.handle });
  const settled = settleEvents(initial, [{ eventId: 'sealed-shura-turn-end', phase: 'turn-end',
    source: { kind: 'unit', id: String(shuraKidomaruIds.hero), unitId: 'blue-1' }, actionId: 4,
    type: 'turn-ended', unitId: 'blue-1' }], dispatcher, () => .5, new TriggerBudget(), id => registry.getStatus(id));
  assert.equal(settled.state.units['blue-1'].statuses.find(status => status.statusId === shuraKidomaruIds.soulNet).stacks, 1);
  assert.ok(settled.events.some(event => event.type === 'damage' && event.source.id === shuraKidomaruIds.citySkill
    && event.suppressTargetSoulTriggers === true));
});

test('修罗鬼童丸无法行动时魂网照常减层，但不施放追猎绝击', () => {
  const registry = new ContentRegistry();
  registerShuraKidomaru(registry);
  registry.registerStatus({ id: 'test.shura-unable', mechanicsCoverage: 'verified', category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: shuraKidomaruIds.hero, skillLevel: 5, statuses: [
    { instanceId: 'unable', statusId: 'test.shura-unable', source: { kind: 'skill', id: 'test.control', unitId: 'red-1' },
      stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } },
    { instanceId: 'soul-net', statusId: shuraKidomaruIds.soulNet,
      source: { kind: 'skill', id: shuraKidomaruIds.trapSkill, unitId: 'blue-1' }, stacks: 2,
      duration: { kind: 'permanent' }, values: { reductions: 1 } },
  ] };
  const dispatcher = new EventDispatcher();
  for (const [phase, rule] of Object.entries(registry.getHero(shuraKidomaruIds.hero).handlers))
    dispatcher.register({ id: `shura-unable:${phase}`, phase, priority: rule.priority, handle: rule.handle });
  const settled = settleEvents(initial, [{ eventId: 'unable-shura-turn-end', phase: 'turn-end',
    source: { kind: 'unit', id: String(shuraKidomaruIds.hero), unitId: 'blue-1' }, actionId: 5,
    type: 'turn-ended', unitId: 'blue-1' }], dispatcher, () => .5, new TriggerBudget(), id => registry.getStatus(id));
  assert.equal(settled.state.units['blue-1'].statuses.find(status => status.statusId === shuraKidomaruIds.soulNet).stacks, 1);
  assert.equal(settled.events.some(event => event.type === 'damage' && event.source.id === shuraKidomaruIds.citySkill), false);
});

test('寻香行 modular AI opens its field and skill hits transform three Soul Binder stacks into Trance', () => {
  const registry = new ContentRegistry();
  registerJinkougyou(registry);
  const initial = state();
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: jinkougyouIds.hero, skillLevel: 5,
    stats: { ...initial.units['blue-1'].stats, hp: 1000, attack: 100, defense: 300, speed: 200 }, hp: 1000 };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, hp: 5000, defense: 100, speed: 90 }, hp: 5000 };
  const opened = runBattle(initial, registry, { seed: 391, actionLimit: 1 });
  assert.ok(opened.events.some(event => event.type === 'status-added' && event.instance.statusId === jinkougyouIds.fragranceField));
  assert.ok(opened.state.units['blue-1'].statuses.some(status => status.statusId === jinkougyouIds.fragranceField));

  const rules = registry.getHero(jinkougyouIds.hero);
  const dispatcher = new EventDispatcher();
  for (const [phase, rule] of Object.entries(rules.handlers))
    dispatcher.register({ id: `hero:${jinkougyouIds.hero}:${phase}`, phase, priority: rule.priority, handle: rule.handle });
  let stateForHits = { ...initial, resources: { blue: { fire: 4 }, red: { fire: 4 } },
    units: { ...initial.units,
      'blue-1': { ...initial.units['blue-1'], statuses: [
        { instanceId: 'unique', statusId: jinkougyouIds.unique, source: { kind: 'skill', id: jinkougyouIds.fieldSkill, unitId: 'blue-1' },
          stacks: 1, duration: { kind: 'permanent' } },
        { instanceId: 'field', statusId: jinkougyouIds.fragranceField,
          source: { kind: 'skill', id: jinkougyouIds.fieldSkill, unitId: 'blue-1' }, stacks: 1,
          duration: { kind: 'count', remaining: 3, owner: 'source-turn' } },
      ] } } };
  let lastHit;
  for (let index = 0; index < 3; index++) {
    const hit = executeAction(stateForHits, { actorId: 'blue-1', skillId: jinkougyouIds.basic, targetIds: ['red-1'],
      shape: 'single', targetRelation: 'enemy' }, registry, () => 0, { dispatcher, resolveStatus: id => registry.getStatus(id) });
    assert.equal(hit.accepted, true);
    lastHit = hit;
    stateForHits = hit.state;
    const binder = stateForHits.units['red-1'].statuses.find(status => status.statusId === jinkougyouIds.soulBinder);
    if (index < 2) {
      assert.equal(binder.stacks, index + 1);
      assert.equal(effectiveStats(stateForHits.units['red-1']).defense, 100 * (1 - .1 * (index + 1)));
    }
  }
  assert.ok(stateForHits.units['red-1'].statuses.some(status => status.statusId === jinkougyouIds.trance));
  assert.ok(stateForHits.units['red-1'].statuses.some(status => status.statusId === jinkougyouIds.defenseRuin));
  assert.equal(stateForHits.units['red-1'].statuses.some(status => status.statusId === jinkougyouIds.soulBinder), false);
  assert.equal(effectiveStats(stateForHits.units['red-1']).defense, 65,
    'three binder layers convert to permanent 35% defense reduction');
  assert.ok(lastHit.events.some(event => event.type === 'life-lost' && event.hpLost >= 231));
  assert.equal(registry.getStatus(jinkougyouIds.trance).preventsAction, true);
});

test('寻香行缚魂香跨技能叠层，三级场地升级每层降防提高至10%', () => {
  const registry = new ContentRegistry();
  registerJinkougyou(registry);
  const dispatcher = new EventDispatcher();
  for (const [phase, rule] of Object.entries(registry.getHero(jinkougyouIds.hero).handlers))
    dispatcher.register({ id: `jinkougyou-stack:${phase}`, phase, priority: rule.priority, handle: rule.handle });
  const initial = state();
  const fieldSource = { kind: 'skill', id: jinkougyouIds.fieldSkill, unitId: 'blue-1' };
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: jinkougyouIds.hero, skillLevel: 3,
    statuses: [{ instanceId: 'unique', statusId: jinkougyouIds.unique, source: fieldSource,
      stacks: 1, duration: { kind: 'permanent' } },
    { instanceId: 'field', statusId: jinkougyouIds.fragranceField, source: fieldSource,
      stacks: 1, duration: { kind: 'count', remaining: 4, owner: 'source-turn' }, values: { skillLevel: 3 } }] };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 1000,
    stats: { ...initial.units['red-1'].stats, hp: 1000, defense: 100 } };
  initial.resources = { blue: { fire: 4 }, red: { fire: 4 } };
  const basic = () => executeAction(initial, { actorId: 'blue-1', skillId: jinkougyouIds.basic,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => 0,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });
  let result = basic();
  assert.equal(effectiveStats(result.state.units['red-1']).defense, 90);
  const wish = executeAction(result.state, { actorId: 'blue-1', skillId: jinkougyouIds.wishSkill,
    targetIds: ['red-1'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => 0,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(wish.accepted, true);
  assert.equal(wish.state.units['red-1'].statuses.find(status => status.statusId === jinkougyouIds.soulBinder).stacks, 2);
  assert.equal(effectiveStats(wish.state.units['red-1']).defense, 80);
  result = executeAction(wish.state, { actorId: 'blue-1', skillId: jinkougyouIds.basic,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => 0,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.ok(result.state.units['red-1'].statuses.some(status => status.statusId === jinkougyouIds.trance));
  assert.equal(result.state.units['red-1'].statuses.some(status => status.statusId === jinkougyouIds.soulBinder), false);

  const lowRank = { ...initial, units: { ...initial.units, 'blue-1': { ...initial.units['blue-1'], skillLevel: 2,
    statuses: initial.units['blue-1'].statuses.map(status => status.statusId === jinkougyouIds.fragranceField
      ? { ...status, values: { skillLevel: 2 } } : status) } } };
  const lowerFirst = executeAction(lowRank, { actorId: 'blue-1', skillId: jinkougyouIds.basic,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => 0,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });
  const lowerSecond = executeAction(lowerFirst.state, { actorId: 'blue-1', skillId: jinkougyouIds.basic,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => 0,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(effectiveStats(lowerSecond.state.units['red-1']).defense, 90,
    'rank two retains the 5% per-stack reduction');
});

test('寻香行三级以上明香境使付费技能鬼火消耗减少一点', () => {
  const registry = new ContentRegistry();
  registerJinkougyou(registry);
  const withField = (skillLevel) => {
    const initial = state();
    const source = { kind: 'skill', id: jinkougyouIds.fieldSkill, unitId: 'blue-1' };
    initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: jinkougyouIds.hero, skillLevel,
      statuses: [{ instanceId: 'unique', statusId: jinkougyouIds.unique, source,
        stacks: 1, duration: { kind: 'permanent' } },
      { instanceId: 'field', statusId: jinkougyouIds.fragranceField, source,
        stacks: 1, duration: { kind: 'count', remaining: 3, owner: 'source-turn' } }] };
    initial.resources = { blue: { fire: 2 }, red: { fire: 4 } };
    return initial;
  };
  const cast = initial => executeAction(initial, { actorId: 'blue-1', skillId: jinkougyouIds.wishSkill,
    targetIds: ['red-1'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .5,
  { resolveStatus: id => registry.getStatus(id) });
  const discounted = cast(withField(3));
  assert.equal(discounted.accepted, true);
  assert.equal(discounted.state.resources.blue.fire, 0);
  assert.ok(discounted.events.some(event => event.type === 'resource-changed' && event.before === 2 && event.after === 0));
  assert.equal(cast(withField(2)).failure, 'insufficient-resource');

  const policyState = withField(3);
  const hero = registry.getHero(jinkougyouIds.hero);
  const policyContext = { state: policyState, getUnit: id => policyState.units[id],
    getLivingUnits: side => Object.values(policyState.units).filter(unit => unit.side === side && unit.hp > 0) };
  assert.equal(hero.policy(policyContext, 'blue-1').skillId, jinkougyouIds.wishSkill);

  const withoutField = withField(3);
  withoutField.units['blue-1'] = { ...withoutField.units['blue-1'], statuses: [] };
  assert.equal(cast(withoutField).failure, 'insufficient-resource');
});

test('寻香行无火普攻优先目标为低于20%生命或带有失神的敌人', () => {
  const registry = new ContentRegistry();
  registerJinkougyou(registry);
  const build = (tranceTarget = false) => {
    const initial = state();
    const source = { kind: 'skill', id: jinkougyouIds.fieldSkill, unitId: 'blue-1' };
    initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: jinkougyouIds.hero, statuses: [
      { instanceId: 'unique', statusId: jinkougyouIds.unique, source, stacks: 1, duration: { kind: 'permanent' } },
      { instanceId: 'field', statusId: jinkougyouIds.fragranceField, source, stacks: 1,
        duration: { kind: 'count', remaining: 3, owner: 'source-turn' } },
    ] };
    initial.resources.blue.fire = 0;
    initial.units['red-1'] = { ...initial.units['red-1'], hp: tranceTarget ? 60 : 15,
      stats: { ...initial.units['red-1'].stats, hp: 100 } };
    initial.units['red-2'] = { ...initial.units['red-1'], unitId: 'red-2', hp: 80,
      statuses: tranceTarget ? [{ instanceId: 'trance', statusId: jinkougyouIds.trance, source,
        stacks: 1, duration: { kind: 'permanent' } }] : [] };
    initial.sides.red = ['red-1', 'red-2'];
    return initial;
  };
  const hero = registry.getHero(jinkougyouIds.hero);
  const lowHp = build();
  assert.equal(hero.policy(createBattleContext(lowHp, () => .5), 'blue-1').targetIds[0], 'red-1');
  const trance = build(true);
  assert.equal(hero.policy(createBattleContext(trance, () => .5), 'blue-1').targetIds[0], 'red-2');
});

test('寻香行明香境中的菩提愿必定给怪物缚魂香，式神目标仍按40%基础概率判定', () => {
  const registry = new ContentRegistry();
  registerJinkougyou(registry);
  const initial = state();
  const source = { kind: 'skill', id: jinkougyouIds.fieldSkill, unitId: 'blue-1' };
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: jinkougyouIds.hero, skillLevel: 5,
    stats: { ...initial.units['blue-1'].stats, hit: 0 },
    statuses: [{ instanceId: 'unique', statusId: jinkougyouIds.unique, source,
      stacks: 1, duration: { kind: 'permanent' } },
    { instanceId: 'field', statusId: jinkougyouIds.fragranceField, source,
      stacks: 1, duration: { kind: 'count', remaining: 4, owner: 'source-turn' } }] };
  initial.units['red-1'] = { ...initial.units['red-1'], unitKind: 'monster', stats: { ...initial.units['red-1'].stats, resist: 0 } };
  initial.units['red-2'] = { ...initial.units['red-1'], unitId: 'red-2', unitKind: 'shikigami', statuses: [] };
  initial.sides.red = ['red-1', 'red-2'];
  initial.resources = { blue: { fire: 4 }, red: { fire: 4 } };
  const result = executeAction(initial, { actorId: 'blue-1', skillId: jinkougyouIds.wishSkill,
    targetIds: ['red-1', 'red-2'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .5,
  { resolveStatus: id => registry.getStatus(id) });
  assert.equal(result.accepted, true);
  assert.ok(result.state.units['red-1'].statuses.some(status => status.statusId === jinkougyouIds.soulBinder));
  assert.equal(result.state.units['red-2'].statuses.some(status => status.statusId === jinkougyouIds.soulBinder), false);
});

test('寻香行初始化、鬼火减耗和明香境延长读取各自技能等级', () => {
  const registry = new ContentRegistry();
  registerJinkougyou(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: jinkougyouIds.hero, skillLevel: 1,
    skillLevels: { [jinkougyouIds.fieldSkill]: 5, [jinkougyouIds.wishSkill]: 2 } };
  initial.resources.blue.fire = 2;
  const definition = registry.getHero(jinkougyouIds.hero);
  const initializedCommands = definition.initialize(createBattleContext(initial, () => .5), 'blue-1');
  const initialized = applyEffectCommands(initial, initializedCommands, 'battle-start', 'jinkou-ranks-init',
    id => registry.getStatus(id));
  const openingField = initialized.state.units['blue-1'].statuses.find(status => status.statusId === jinkougyouIds.fragranceField);
  assert.equal(openingField.values.skillLevel, 5, 'rank-five field triggers first turn even when the aggregate rank is one');

  const result = executeAction(initialized.state, { actorId: 'blue-1', skillId: jinkougyouIds.wishSkill,
    targetIds: ['red-1'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .5,
  { resolveStatus: id => registry.getStatus(id) });
  assert.equal(result.accepted, true, 'rank-five field reduces this paid skill cost to the available two fire');
  assert.equal(result.state.resources.blue.fire, 0);
  assert.equal(result.state.units['blue-1'].statuses.find(status => status.statusId === jinkougyouIds.fragranceField)
    .duration.remaining, 4, 'rank-two Wish extends the opening three-turn field once');
});

test('寻香行二级明香境基础持续4回合，二级缚梦明香再延长1回合', () => {
  const registry = new ContentRegistry();
  registerJinkougyou(registry);
  const hero = registry.getHero(jinkougyouIds.hero);
  const skill = hero.skills.find(item => item.id === jinkougyouIds.fieldSkill);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: jinkougyouIds.hero, skillLevel: 2,
    statuses: [{ instanceId: 'unique', statusId: jinkougyouIds.unique,
      source: { kind: 'skill', id: jinkougyouIds.fieldSkill, unitId: 'blue-1' }, stacks: 1,
      duration: { kind: 'permanent' } }] };
  const intent = { actorId: 'blue-1', skillId: jinkougyouIds.fieldSkill, targetIds: ['blue-1'],
    shape: 'self', targetRelation: 'ally' };
  const castField = skill.execute(createBattleContext(initial, () => .5), intent, skill.levels[1]);
  assert.equal(castField.find(command => command.type === 'add-status').instance.duration.remaining, 4);
  const rankThree = skill.execute(createBattleContext(initial, () => .5), intent, skill.levels[2]);
  assert.equal(rankThree.find(command => command.type === 'add-status').instance.duration.remaining, 4);

  const activeField = { ...initial.units['blue-1'].statuses[0], statusId: jinkougyouIds.fragranceField,
    instanceId: 'field', duration: { kind: 'count', remaining: 4, owner: 'source-turn' } };
  initial.units['blue-1'] = { ...initial.units['blue-1'], statuses: [initial.units['blue-1'].statuses[0], activeField] };
  const wish = hero.skills.find(item => item.id === jinkougyouIds.wishSkill);
  const extended = wish.execute(createBattleContext(initial, () => .5), { actorId: 'blue-1', skillId: wish.id,
    targetIds: ['red-1'], shape: 'all-enemies', targetRelation: 'enemy' }, wish.levels[1]);
  assert.equal(extended.find(command => command.type === 'add-status' && command.instance.statusId === jinkougyouIds.fragranceField)
    .instance.duration.remaining, 5);
});

test('skill alternate payment rechecks after action-selection triggers and consumes only the missing resource amount', () => {
  const registry = new ContentRegistry();
  registry.registerHero({ id: 1, skills: [{ id: 'hero.alt', resourceCost: { resourceId: 'fire', amount: 2 },
    alternatePayment: { resourceId: 'fire', meterResourceId: 'fire', minSkillLevel: 5 },
    target: 'single', targetRelation: 'enemy', levels: [], execute: () => [] }] });
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], skillLevel: 5 };
  initial.resources = { blue: { fire: 2 }, red: { fire: 4 } };
  initial.resourceMeters = { ...initial.resourceMeters,
    blue: { fire: { ...initial.resourceMeters.blue.fire, progress: 1 } } };
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'test.resource-drain', phase: 'action-selection', priority: 0, handle: () => [{
    type: 'change-resource', source: { kind: 'status', id: 'status.resource-drain' }, side: 'blue', resourceId: 'fire', amount: -1,
  }] });
  const paid = executeAction(initial, { actorId: 'blue-1', skillId: 'hero.alt', targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' },
    registry, () => 0.5, { dispatcher });
  assert.equal(paid.accepted, true);
  assert.equal(paid.state.resources.blue.fire, 0);
  assert.equal(paid.state.resourceMeters.blue.fire.progress, 0);
  assert.deepEqual(paid.events.filter(event => event.type === 'resource-changed').map(event => [event.before, event.after]), [[2, 1], [1, 0]]);
  assert.ok(paid.events.some(event => event.type === 'resource-meter-set' && event.progressBefore === 1 && event.progressAfter === 0));

  const insufficient = { ...initial, resources: { ...initial.resources, blue: { fire: 1 } }, resourceMeters: { ...initial.resourceMeters,
    blue: { fire: { ...initial.resourceMeters.blue.fire, progress: 0 } } } };
  const rejected = executeAction(insufficient, { actorId: 'blue-1', skillId: 'hero.alt', targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' },
    registry, () => 0.5);
  assert.equal(rejected.failure, 'insufficient-resource');
  assert.equal(rejected.state.resources.blue.fire, 1);
  assert.equal(rejected.events.length, 0);
});

test('duplicate 追月神 units keep independent IDs while the team passive initializes only once', () => {
  const registry = new ContentRegistry();
  registerMoonChaser(registry);
  const initial = state();
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: moonChaserIds.hero, skillLevel: 2 };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', skillLevel: 5 };
  initial.sides = { blue: ['blue-1', 'blue-2'], red: ['red-1'] };
  const result = runBattle(initial, registry, { seed: 74, actionLimit: 0 });
  assert.equal(result.state.resourceMeters.blue.fire.progress, 2);
  assert.notEqual(result.state.units['blue-1'].unitId, result.state.units['blue-2'].unitId);
  assert.ok(result.state.units['blue-1'].statuses.some(status => status.statusId === moonChaserIds.protectionStatus));
  assert.ok(result.state.units['blue-2'].statuses.some(status => status.statusId === moonChaserIds.protectionStatus));
  assert.equal(result.events.filter(event => event.type === 'resource-meter-advanced' && event.side === 'blue'
    && event.source.id === moonChaserIds.passive).length, 1);
});

test('巡音流歌满级巡游消耗两点鬼火、优先驱散控制并施加共鸣之墙', () => {
  const registry = new ContentRegistry();
  registerSongstress(registry);
  registry.registerStatus({ id: 'test.stun', mechanicsCoverage: 'verified', category: 'control', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: 'test.debuff', mechanicsCoverage: 'verified', category: 'debuff', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: songstressIds.hero, skillLevel: 5,
    statuses: [{ instanceId: 'stun-1', statusId: 'test.stun', source: { kind: 'skill', id: 'test.stun' }, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }] };
  const result = executeAction(initial, { actorId: 'blue-1', skillId: songstressIds.tour,
    targetIds: ['blue-1'], shape: 'all-allies', targetRelation: 'ally' }, registry, () => .99,
  { resolveStatus: id => registry.getStatus(id) });
  assert.equal(result.accepted, true);
  assert.equal(result.state.resources.blue.fire, 2);
  assert.ok(result.events.some(event => event.type === 'status-removed' && event.statusId === 'test.stun'));
  assert.ok(result.state.units['blue-1'].statuses.some(status => status.statusId === songstressIds.resonanceWall));
  assert.ok(result.state.units['blue-1'].statuses.some(status => status.statusId === songstressIds.harmony && status.stacks === 2));
});

test('共鸣之墙只吸收暴击额外伤害', () => {
  const initial = state();
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 500, stats: { ...initial.units['red-1'].stats, hp: 1000 }, statuses: [{ instanceId: 'wall-1', statusId: songstressIds.resonanceWall,
    source: { kind: 'skill', id: songstressIds.tour, unitId: 'blue-1' }, stacks: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, values: { criticalAbsorbRemaining: 100 } }] };
  const result = applyEffectCommands(initial, [
    { type: 'deal-damage', source: { kind: 'skill', id: songstressIds.basic, unitId: 'blue-1' },
      targetId: 'red-1', amount: 120, criticalBaseAmount: 100, isCritical: true },
    { type: 'deal-damage', source: { kind: 'skill', id: songstressIds.basic, unitId: 'blue-1' },
      targetId: 'red-1', amount: 200, criticalBaseAmount: 100, isCritical: true },
  ], 'hit', 'songstress-wall',
  id => id === songstressIds.resonanceWall ? { id, absorbsCriticalBonus: true } : undefined);
  const damage = result.events.find(event => event.type === 'damage');
  assert.equal(damage.criticalAbsorbed, 20);
  assert.equal(damage.hpLost, 90);
  const secondHit = result.events.filter(event => event.type === 'damage')[1];
  assert.equal(secondHit.criticalAbsorbed, 80);
  assert.ok(result.events.some(event => event.type === 'status-removed' && event.instanceId === 'wall-1' && event.reason === 'consumed'));
  assert.equal(result.state.units['red-1'].statuses.length, 0);
});

test('和音层数在友方回合结束时消耗并驱散，满级驱散后施加共鸣之墙', () => {
  const registry = new ContentRegistry();
  registerSongstress(registry);
  registry.registerStatus({ id: 'test.debuff', mechanicsCoverage: 'verified', category: 'debuff', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const initial = state();
  const harmony = { instanceId: 'harmony-1', statusId: songstressIds.harmony,
    source: { kind: 'skill', id: songstressIds.passive, unitId: 'blue-1' }, stacks: 1,
    duration: { kind: 'permanent' }, values: { progress: 0 } };
  const debuff = { instanceId: 'debuff-1', statusId: 'test.debuff', source: { kind: 'skill', id: 'test.debuff' }, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' } };
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: songstressIds.hero, skillLevel: 5, statuses: [harmony] };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 1, skillLevel: 1, statuses: [debuff] };
  initial.sides = { blue: ['blue-1', 'blue-2'], red: ['red-1'] };
  const dispatcher = new EventDispatcher();
  for (const [phase, rule] of Object.entries(registry.getHero(songstressIds.hero).handlers)) {
    dispatcher.register({ id: `hero:${songstressIds.hero}:${phase}`, phase, priority: rule.priority, handle: rule.handle });
  }
  const settled = settleEvents(initial, [{ eventId: 'end-blue-2', phase: 'turn-end',
    source: { kind: 'unit', id: '1', unitId: 'blue-2' }, type: 'turn-ended', unitId: 'blue-2' }], dispatcher, () => .5,
  new TriggerBudget(32), id => registry.getStatus(id));
  assert.equal(settled.state.units['blue-1'].statuses.some(status => status.statusId === songstressIds.harmony), false);
  assert.equal(settled.state.units['blue-2'].statuses.some(status => status.statusId === 'test.debuff'), false);
  assert.ok(settled.state.units['blue-2'].statuses.some(status => status.statusId === songstressIds.resonanceWall));
  assert.ok(settled.events.some(event => event.type === 'status-removed' && event.instanceId === 'debuff-1'));
});

test('本真三尾狐普攻附加狐印并吸血，回合末获得护盾和心焰', () => {
  const registry = new ContentRegistry();
  registerTrueFox(registry);
  const initial = state();
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: trueFoxIds.hero, skillLevel: 1, hp: 50,
    stats: { ...initial.units['blue-1'].stats, hp: 1000, attack: 100, speed: 200 }, shield: 0 };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 500,
    stats: { ...initial.units['red-1'].stats, hp: 1000, defense: 0, speed: 90 }, shield: 0 };
  initial.resources = { blue: { fire: 0 }, red: { fire: 0 } };
  const result = runBattle(initial, registry, { seed: 93, actionLimit: 1 });
  const mark = result.state.units['red-1'].statuses.find(status => status.statusId === trueFoxIds.seal);
  assert.equal(mark.values.attack, 100);
  const basicHit = result.events.find(event => event.type === 'damage' && event.source.id === trueFoxIds.basic);
  assert.ok(basicHit.hpLost > 0);
  assert.equal(result.state.units['blue-1'].hp, 50 + basicHit.hpLost * .2);
  assert.ok(result.state.units['blue-1'].statuses.some(status => status.statusId === trueFoxIds.guard));
  assert.ok(result.state.units['blue-1'].statuses.some(status => status.statusId === trueFoxIds.flames && status.stacks === 3));
});

test('狐印在目标回合开始造成受上限约束的间接生命损失', () => {
  const registry = new ContentRegistry();
  registerTrueFox(registry);
  const initial = state();
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  initial.units['red-1'] = { ...initial.units['red-1'], heroId: trueFoxIds.hero, hp: 500,
    stats: { ...initial.units['red-1'].stats, hp: 1000, speed: 200 }, statuses: [{ instanceId: 'fox-mark', statusId: trueFoxIds.seal,
      source: { kind: 'skill', id: trueFoxIds.passive, unitId: 'blue-1' }, stacks: 1,
      duration: { kind: 'count', remaining: 5, owner: 'target-turn' }, values: { attack: 20 } }] };
  const result = runBattle(initial, registry, { seed: 94, actionLimit: 1 });
  assert.equal(result.state.units['red-1'].hp, 300);
  assert.ok(result.events.some(event => event.type === 'life-lost' && event.targetId === 'red-1' && event.hpLost === 200));
  assert.ok(!result.state.units['red-1'].statuses.some(status => status.statusId === trueFoxIds.seal));
});

test('狐印按攻击后的生命变化触发独立汲魄协战并消耗心焰', () => {
  const registry = new ContentRegistry();
  registerTrueFox(registry);
  const initial = state();
  initial.counters = { ...initial.counters, action: 1, attack: 7 };
  initial.units['blue-1'] = { ...initial.units['blue-1'], hp: 600, stats: { ...initial.units['blue-1'].stats, hp: 1000 } };
  initial.units['red-1'] = { ...initial.units['red-1'], heroId: trueFoxIds.hero, skillLevel: 3, hp: 1000,
    stats: { ...initial.units['red-1'].stats, hp: 1000, attack: 100, defense: 0 }, statuses: [{ instanceId: 'flames', statusId: trueFoxIds.flames,
      source: { kind: 'skill', id: trueFoxIds.passive, unitId: 'red-1' }, stacks: 3, duration: { kind: 'permanent' },
      modifiers: [{ stat: 'defense', operation: 'percent', amount: .45 }], values: {} }] };
  const dispatcher = new EventDispatcher();
  for (const [phase, rule] of Object.entries(registry.getHero(trueFoxIds.hero).handlers)) {
    dispatcher.register({ id: `hero:${trueFoxIds.hero}:${phase}`, phase, priority: rule.priority, handle: rule.handle });
  }
  const settled = settleEvents(initial, [{ eventId: 'external-attack-end', phase: 'attack-end',
    source: { kind: 'unit', id: '1', unitId: 'blue-1' }, actionId: 1, attackId: 7, type: 'attack-ended', hitCount: 1,
    targetHealthChanges: [{ targetId: 'blue-1', hpBefore: 1000, hpAfter: 600, hpLost: 400 }] }], dispatcher, () => .5,
  new TriggerBudget(64), id => registry.getStatus(id));
  assert.equal(settled.state.units['red-1'].statuses.find(status => status.statusId === trueFoxIds.flames).stacks, 2);
  assert.ok(settled.events.some(event => event.type === 'action-scheduled' && event.scheduling === 'assist'
    && event.intent.skillId === trueFoxIds.followUp));
  assert.deepEqual(settled.events.filter(event => event.type === 'attack-start').map(event => event.attackId), [8]);
  assert.equal(settled.events.find(event => event.type === 'attack-start').actionKind, 'passive');
  assert.equal(settled.events.find(event => event.type === 'attack-ended' && event.source.id === trueFoxIds.followUp).actionKind, 'passive');
  assert.ok(settled.events.some(event => event.type === 'damage' && event.source.id === trueFoxIds.followUp));
});

test('本真三尾狐技能3按目标生命阈值递归追加命中并共享同一攻击编号', () => {
  const registry = new ContentRegistry();
  registerTrueFox(registry);
  const initial = state();
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: trueFoxIds.hero, skillLevel: 5,
    stats: { ...initial.units['blue-1'].stats, hp: 50000, attack: 2000, speed: 200, defense: 500 }, hp: 50000, shield: 0 };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, hp: 10000, defense: 0, speed: 90 }, hp: 10000, shield: 0 };
  const result = runBattle(initial, registry, { seed: 96, actionLimit: 1 });
  const foxHits = result.events.filter(event => event.type === 'damage' && event.source.id === trueFoxIds.skill);
  assert.ok(foxHits.length >= 3);
  assert.equal(new Set(foxHits.map(event => event.attackId)).size, 1);
  const end = result.events.find(event => event.type === 'attack-ended' && event.source.id === trueFoxIds.skill);
  assert.equal(end.hitCount, foxHits.length);
  assert.equal(end.targetHealthChanges[0].hpBefore, 10000);
});

test('铃彦姬五山火祭逐次消耗鬼火和生命，低血量进入神火并累计防御无视', () => {
  const registry = new ContentRegistry();
  registerBellEmpress(registry);
  const initial = state();
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: bellEmpressIds.hero, skillLevel: 5, hp: 50000,
    stats: { ...initial.units['blue-1'].stats, hp: 50000, attack: 100, speed: 200, defense: 500 }, shield: 0 };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 100000,
    stats: { ...initial.units['red-1'].stats, hp: 100000, attack: 100, defense: 0, speed: 90 }, shield: 0 };
  initial.resources = { blue: { fire: 4 }, red: { fire: 4 } };
  const result = runBattle(initial, registry, { seed: 97, actionLimit: 1 });
  assert.ok(result.events.some(event => event.type === 'action-declared' && event.intent.skillId === bellEmpressIds.fiveMountain));
  assert.equal(result.state.resources.blue.fire, 0);
  assert.ok(result.state.units['blue-1'].statuses.some(status => status.statusId === bellEmpressIds.divine));
  const stacks = result.state.units['blue-1'].statuses.find(status => status.statusId === bellEmpressIds.fiveMountainStacks);
  assert.equal(stacks.stacks, 1);
  assert.equal(stacks.values.attackCount, 5);
});

test('铃彦姬满级致命保护复苏并获得免控状态，友方保留姿态光环', () => {
  const registry = new ContentRegistry();
  registerBellEmpress(registry);
  registry.registerStatus({ id: 'test.bell-stun', mechanicsCoverage: 'verified', category: 'control', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: bellEmpressIds.hero, skillLevel: 5, hp: 0,
    stats: { ...initial.units['blue-1'].stats, hp: 1000, attack: 500, defense: 100 } };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 1, hp: 500, statuses: [] };
  initial.sides = { blue: ['blue-1', 'blue-2'], red: ['red-1'] };
  const dispatcher = new EventDispatcher();
  for (const [phase, rule] of Object.entries(registry.getHero(bellEmpressIds.hero).handlers)) {
    dispatcher.register({ id: `hero:${bellEmpressIds.hero}:${phase}`, phase, priority: rule.priority, handle: rule.handle });
  }
  const revived = settleEvents(initial, [{ eventId: 'bell-fell', phase: 'unit-defeated', source: { kind: 'skill', id: 'test.lethal' },
    type: 'unit-defeated', unitId: 'blue-1' }], dispatcher, () => .5, new TriggerBudget(64), id => registry.getStatus(id));
  assert.equal(revived.state.units['blue-1'].hp, 500);
  assert.ok(revived.state.units['blue-1'].statuses.some(status => status.statusId === bellEmpressIds.eternal));
  assert.ok(revived.state.units['blue-1'].statuses.some(status => status.statusId === bellEmpressIds.eternalShield));
  assert.ok(revived.state.units['blue-2'].statuses.some(status => status.statusId === bellEmpressIds.allyEternal));
  const control = applyEffectCommands(revived.state, [{ type: 'apply-control', source: { kind: 'skill', id: 'test.stun' },
    targetId: 'blue-1', instance: { instanceId: 'bell-stun', statusId: 'test.bell-stun', source: { kind: 'skill', id: 'test.stun' },
      stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } } }], 'hit', 'bell-control', id => registry.getStatus(id));
  assert.ok(control.events.some(event => event.type === 'control-blocked'));
  assert.ok(!control.state.units['blue-1'].statuses.some(status => status.statusId === 'test.bell-stun'));
});

test('荒骷髅初始化血色之花给攻击最高友方，并可用技能转移', () => {
  const registry = new ContentRegistry();
  registerSkullGeneral(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: skullGeneralIds.hero, stats: { ...initial.units['blue-1'].stats, attack: 100 } };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 1, stats: { ...initial.units['blue-1'].stats, attack: 500 }, statuses: [] };
  initial.units['blue-3'] = { ...initial.units['blue-1'], unitId: 'blue-3', heroId: 1, statuses: [] };
  initial.sides = { blue: ['blue-1', 'blue-2', 'blue-3'], red: ['red-1'] };
  const context = createBattleContext(initial, () => 0.5);
  const commands = registry.getHero(skullGeneralIds.hero).initialize(context, 'blue-1');
  const applied = applyEffectCommands(initial, commands, 'battle-start', 'skull-init', id => registry.getStatus(id));
  assert.ok(applied.state.units['blue-2'].statuses.some(status => status.statusId === skullGeneralIds.flower));
  const moved = executeAction(applied.state, { actorId: 'blue-1', skillId: skullGeneralIds.transfer,
    targetIds: ['blue-3'], shape: 'single', targetRelation: 'ally' }, registry, () => 0.5);
  assert.ok(moved.state.units['blue-3'].statuses.some(status => status.statusId === skullGeneralIds.flower));
  assert.ok(!moved.state.units['blue-2'].statuses.some(status => status.statusId === skullGeneralIds.flower));
});

test('荒骷髅血色之花读取独立技能等级、排除召唤物并受被动封印影响', () => {
  const registry = new ContentRegistry();
  registerSkullGeneral(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: skullGeneralIds.hero, skillLevel: 5,
    skillLevels: { [skullGeneralIds.transfer]: 1 }, stats: { ...initial.units['blue-1'].stats, attack: 100 } };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 1, skillLevels: undefined,
    stats: { ...initial.units['blue-1'].stats, attack: 500 }, statuses: [] };
  initial.units['blue-summon'] = { ...initial.units['blue-2'], unitId: 'blue-summon', unitKind: 'summon',
    stats: { ...initial.units['blue-2'].stats, attack: 900 } };
  initial.sides = { blue: ['blue-1', 'blue-2', 'blue-summon'], red: ['red-1'] };
  const hero = registry.getHero(skullGeneralIds.hero);
  const initialized = applyEffectCommands(initial, hero.initialize(createBattleContext(initial, () => .5), 'blue-1'),
    'battle-start', 'skull-rank-init', id => registry.getStatus(id));
  assert.ok(initialized.state.units['blue-2'].statuses.some(status => status.statusId === skullGeneralIds.flower));
  assert.ok(!initialized.state.units['blue-summon'].statuses.some(status => status.statusId === skullGeneralIds.flower));
  const sealedAtStart = { ...initial, units: { ...initial.units, 'blue-1': { ...initial.units['blue-1'], statuses: [{
    instanceId: 'skull-start-seal', statusId: passiveSuppressionStatusId,
    source: { kind: 'skill', id: 'test.seal' }, stacks: 1, duration: { kind: 'permanent' },
  }] } } };
  assert.deepEqual(hero.initialize(createBattleContext(sealedAtStart), 'blue-1'), [], '被动封印时不触发开局血色之花');
  const turnEnd = hero.handlers['turn-end'].handle(createBattleContext(initialized.state, () => .5), {
    type: 'turn-ended', eventId: 'skull-rank-turn-end', phase: 'turn-end', source: { kind: 'unit', id: '1', unitId: 'blue-2' },
    unitId: 'blue-2', actionId: 1,
  });
  assert.ok(!turnEnd?.some(command => command.type === 'schedule-action'), '额外回合解锁由血色之花技能五级决定');
  const transfer = hero.skills.find(skill => skill.id === skullGeneralIds.transfer);
  const summonTarget = transfer.execute(createBattleContext(initialized.state, () => .5), {
    actorId: 'blue-1', skillId: skullGeneralIds.transfer, targetIds: ['blue-summon'], shape: 'single', targetRelation: 'ally',
  }, {});
  assert.deepEqual(summonTarget, [], '手动转移也不能把血色之花施加给召唤物');

  const intercept = hero.interceptIncomingDamage(initialized.state, initialized.state.units['red-1'],
    initialized.state.units['blue-2'], 100);
  assert.equal(intercept.amount, 60, '四级以下的独立花吻烈魂等级分担40%，不使用全局五级');
  assert.equal(intercept.effects[0].amount, 40);

  const sealed = { ...initialized.state, units: { ...initialized.state.units,
    'blue-1': { ...initialized.state.units['blue-1'], skillLevels: { [skullGeneralIds.transfer]: 5 }, statuses: [{
      instanceId: 'skull-passive-seal', statusId: 'core.passive-suppression',
      source: { kind: 'skill', id: 'test.seal' }, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
    }] } } };
  assert.equal(hero.interceptIncomingDamage(sealed, sealed.units['red-1'], sealed.units['blue-2'], 100), undefined,
    '被动封印期间血色之花不分担伤害');
  const sealedTurnEnd = hero.handlers['turn-end'].handle(createBattleContext(sealed, () => .5), {
    type: 'turn-ended', eventId: 'skull-sealed-turn-end', phase: 'turn-end', source: { kind: 'unit', id: '1', unitId: 'blue-2' },
    unitId: 'blue-2', actionId: 2,
  });
  assert.ok(!sealedTurnEnd?.some(command => command.type === 'schedule-action'), '被动封印期间不触发时之隙');
});

test('荒骷髅五级被动在敌方式神阵亡后按初始生命上限成长并等额恢复', () => {
  const registry = new ContentRegistry();
  registerSkullGeneral(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: skullGeneralIds.hero, skillLevel: 5, hp: 7000,
    stats: { ...initial.units['blue-1'].stats, hp: 10000, attack: 100 } };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 0, unitKind: 'shikigami' };
  initial.sides = { blue: ['blue-1'], red: ['red-1'] };
  const hero = registry.getHero(skullGeneralIds.hero);
  const initialized = applyEffectCommands(initial, hero.initialize(createBattleContext(initial, () => .5), 'blue-1'),
    'battle-start', 'skull-max-hp-init', id => registry.getStatus(id)).state;
  const defeated = (currentState, unitId) => {
    const event = { type: 'unit-defeated', eventId: `defeated-${unitId}`, phase: 'unit-defeated',
      source: { kind: 'skill', id: 'test.kill' }, unitId, defeatedBy: { kind: 'skill', id: 'test.kill', unitId: 'blue-2' } };
    const commands = hero.handlers['unit-defeated'].handle(createBattleContext(currentState, () => .5), event);
    return applyEffectCommands(currentState, commands ?? [], 'unit-defeated', event.eventId, id => registry.getStatus(id));
  };
  const first = defeated(initialized, 'red-1');
  assert.equal(first.state.units['blue-1'].stats.hp, 13500);
  assert.equal(first.state.units['blue-1'].hp, 10500);
  assert.ok(first.events.some(event => event.type === 'max-health-changed' && event.before === 10000 && event.after === 13500));
  assert.ok(first.events.some(event => event.type === 'health-restored' && event.hpGained === 3500));

  const withSecondEnemy = { ...first.state, units: { ...first.state.units,
    'red-2': { ...first.state.units['red-1'], unitId: 'red-2', hp: 0, unitKind: 'shikigami' } },
    sides: { ...first.state.sides, red: [...first.state.sides.red, 'red-2'] } };
  const second = defeated(withSecondEnemy, 'red-2');
  assert.equal(second.state.units['blue-1'].stats.hp, 17000, '每次都以开战时基础生命上限计算增量');
  assert.equal(second.state.units['blue-1'].hp, 14000);
  assert.equal(second.state.units['blue-1'].statuses.find(status => status.statusId === skullGeneralIds.maxHpGrowth).values.growthCount, 2);

  const summonState = { ...second.state, units: { ...second.state.units,
    'red-summon': { ...second.state.units['red-2'], unitId: 'red-summon', unitKind: 'summon' } },
    sides: { ...second.state.sides, red: [...second.state.sides.red, 'red-summon'] } };
  assert.equal(defeated(summonState, 'red-summon').state.units['blue-1'].stats.hp, 17000,
    '敌方召唤物阵亡不触发式神阵亡效果');
  const rankFour = { ...initialized, units: { ...initialized.units,
    'blue-1': { ...initialized.units['blue-1'], skillLevel: 4 } } };
  assert.equal(defeated(rankFour, 'red-1').state.units['blue-1'].stats.hp, 10000,
    '该生命成长仅在五级技能解锁');
  const sealed = { ...initialized, units: { ...initialized.units,
    'blue-1': { ...initialized.units['blue-1'], statuses: [...initialized.units['blue-1'].statuses, {
      instanceId: 'skull-growth-seal', statusId: passiveSuppressionStatusId,
      source: { kind: 'skill', id: 'test.seal' }, stacks: 1, duration: { kind: 'permanent' },
    }] } } };
  assert.equal(defeated(sealed, 'red-1').state.units['blue-1'].stats.hp, 10000, '被动封印时不触发阵亡成长');
});

test('荒骷髅黄泉战旗记录舍命生命并按累计损失造成两段真实伤害', () => {
  const registry = new ContentRegistry();
  registerSkullGeneral(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: skullGeneralIds.hero, skillLevel: 1,
    stats: { ...initial.units['blue-1'].stats, hp: 1000, attack: 100 }, hp: 1000 };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, hp: 1000, defense: 0 }, hp: 1000 };
  const result = executeAction(initial, { actorId: 'blue-1', skillId: skullGeneralIds.banner,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => 0.5);
  assert.equal(result.state.units['blue-1'].hp, 700);
  assert.equal(result.state.units['red-1'].hp, 926);
  assert.equal(result.state.resources.blue.fire, 2);
  assert.equal(result.state.units['blue-1'].statuses.find(status => status.statusId === skullGeneralIds.ironWall).values.totalLost, 300);
  assert.deepEqual(result.events.filter(event => event.type === 'damage').map(event => [event.damageKind, event.amount]), [['true', 24], ['true', 60]]);
  assert.equal(result.events.filter(event => event.type === 'damage')[0].attackId,
    result.events.filter(event => event.type === 'damage')[1].attackId);
});

test('血色之花在通用命中结算前分担伤害，荒骷髅承担部分生命流失', () => {
  const registry = new ContentRegistry();
  registerSkullGeneral(registry);
  const initial = state();
  initial.units['red-1'] = { ...initial.units['red-1'], heroId: skullGeneralIds.hero, skillLevel: 4, hp: 1000,
    stats: { ...initial.units['red-1'].stats, hp: 1000 } };
  initial.units['red-2'] = { ...initial.units['red-1'], unitId: 'red-2', heroId: 1, hp: 1000, statuses: [
    { instanceId: 'flower:red-2', statusId: skullGeneralIds.flower, source: { kind: 'skill', id: skullGeneralIds.transfer, unitId: 'red-1' },
      stacks: 1, duration: { kind: 'permanent' } },
  ] };
  initial.sides = { blue: ['blue-1'], red: ['red-1', 'red-2'] };
  const interception = (current, attacker, target, amount, kind, _attackId, _hitIndex, _source, cannotBeShared) => registry.getHero(skullGeneralIds.hero)
    .interceptIncomingDamage(current, attacker, target, amount, kind, { cannotBeShared });
  const result = applyEffectCommands(initial, [{ type: 'deal-damage', source: { kind: 'skill', id: 'test.hit', unitId: 'blue-1' },
    targetId: 'red-2', amount: 100 }], 'hit', 'flower-share', id => registry.getStatus(id), undefined, interception);
  assert.equal(result.state.units['red-1'].hp, 950);
  assert.equal(result.state.units['red-2'].hp, 960);
  assert.deepEqual(result.events.map(event => event.type), ['life-lost', 'damage']);
  assert.equal(result.events[1].amount, 50);
  const noShare = interception(initial, initial.units['blue-1'], initial.units['red-2'], 100, 'normal', 1, 1,
    { kind: 'skill', id: 'test.no-share' }, true);
  assert.equal(noShare, undefined, '明确禁止分担的伤害不能被血色之花再次转移');
});

test('正式模拟运行路径使用内容伤害拦截器结算血色之花分担', () => {
  const registry = new ContentRegistry();
  registerSkullGeneral(registry);
  const strikeId = 'test.flower-strike';
  registry.registerHero({ id: 901, skills: [createBasicAttackSkill(strikeId, [1])], policy(context, unitId) {
    const target = context.getLivingUnits('red').find(unit => unit.statuses.some(status => status.statusId === skullGeneralIds.flower));
    return target ? { actorId: unitId, skillId: strikeId, targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' } : undefined;
  } });
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: 901, hp: 10000,
    stats: { ...initial.units['blue-1'].stats, hp: 10000, attack: 1000, defense: 0, speed: 300 }, shield: 0 };
  initial.units['red-1'] = { ...initial.units['red-1'], heroId: skullGeneralIds.hero, skillLevel: 4, hp: 1000,
    stats: { ...initial.units['red-1'].stats, hp: 1000, attack: 100, defense: 0, speed: 1 }, shield: 0 };
  initial.units['red-2'] = { ...initial.units['red-1'], unitId: 'red-2', heroId: 251, hp: 1000,
    stats: { ...initial.units['red-1'].stats, attack: 500 }, statuses: [], shield: 0 };
  initial.sides = { blue: ['blue-1'], red: ['red-1', 'red-2'] };
  initial.resources = { blue: { fire: 4 }, red: { fire: 4 } };
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  const result = runBattle(initial, registry, { seed: 14, actionLimit: 1 });
  const shared = result.events.find(event => event.type === 'life-lost' && event.targetId === 'red-1'
    && event.source.id === skullGeneralIds.flower);
  const hit = result.events.find(event => event.type === 'damage' && event.targetId === 'red-2' && event.source.id === strikeId);
  assert.ok(shared && hit);
  assert.equal(shared.hpLost, hit.amount);
});

test('荒骷髅生命流失触发后保留1点生命并累计平氏铁壁', () => {
  const registry = new ContentRegistry();
  registerSkullGeneral(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: skullGeneralIds.hero, hp: 10,
    stats: { ...initial.units['blue-1'].stats, hp: 100 } };
  const dispatcher = new EventDispatcher();
  for (const [phase, rule] of Object.entries(registry.getHero(skullGeneralIds.hero).handlers)) {
    dispatcher.register({ id: `hero:${skullGeneralIds.hero}:${phase}`, phase, priority: rule.priority, handle: rule.handle });
  }
  const lost = applyEffectCommands(initial, [{ type: 'lose-life', source: { kind: 'skill', id: 'test-cost', unitId: 'blue-1' },
    targetId: 'blue-1', amount: 20 }], 'effect-resolution', 'skull-lethal');
  const revived = settleEvents(lost.state, lost.events, dispatcher, () => 0.5, undefined, id => registry.getStatus(id));
  assert.equal(revived.state.units['blue-1'].hp, 1);
  assert.equal(revived.state.units['blue-1'].statuses.find(status => status.statusId === skullGeneralIds.ironWall).values.totalLost, 10);
});

test('携花友方回合结束时荒骷髅通过额外回合队列施放黄泉战旗', () => {
  const registry = new ContentRegistry();
  registerSkullGeneral(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: skullGeneralIds.hero, skillLevel: 5,
    stats: { ...initial.units['blue-1'].stats, hp: 10000, attack: 100, defense: 0, speed: 1 }, hp: 10000 };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 1, skillLevel: 1,
    stats: { ...initial.units['blue-1'].stats, attack: 500, speed: 300 }, hp: 10000, statuses: [] };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 10000, shield: 0,
    stats: { ...initial.units['red-1'].stats, hp: 10000, attack: 1, defense: 0, speed: 1 } };
  initial.sides = { blue: ['blue-1', 'blue-2'], red: ['red-1'] };
  initial.resources = { blue: { fire: 4 }, red: { fire: 4 } };
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  const cast = (scheduling) => executeAction(initial, { actorId: 'blue-1', skillId: skullGeneralIds.banner,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => .5, { scheduling });
  assert.equal(cast(undefined).state.resources.blue.fire, 2, '本回合正常施放仍消耗2火');
  assert.equal(cast('extra-turn').state.resources.blue.fire, 4, '三级技能在时之隙额外回合施放减免2火');
  const rankTwo = { ...initial, units: { ...initial.units, 'blue-1': { ...initial.units['blue-1'], skillLevel: 2 } } };
  assert.equal(executeAction(rankTwo, { actorId: 'blue-1', skillId: skullGeneralIds.banner,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => .5,
  { scheduling: 'extra-turn' }).state.resources.blue.fire, 2, '二级额外回合尚未解锁减火');
  const result = runBattle(initial, registry, { seed: 9, actionLimit: 2 });
  assert.ok(result.events.some(event => event.type === 'action-scheduled' && event.scheduling === 'extra-turn'
    && event.intent.actorId === 'blue-1'));
  assert.ok(result.events.some(event => event.type === 'action-declared' && event.intent.actorId === 'blue-1'
    && event.intent.skillId === skullGeneralIds.banner));
  assert.equal(result.state.resources.blue.fire, 4, '携花触发的黄泉战旗额外回合不消耗鬼火');
});

test('云外镜的阴阳生命池分开记录，翻转时切换到另一侧已保存的生命', () => {
  const registry = new ContentRegistry();
  registerCloudMirror(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: cloudMirrorIds.hero, hp: 100,
    stats: { ...initial.units['blue-1'].stats, hp: 100, attack: 100, defense: 10 } };
  const context = createBattleContext(initial, () => .5);
  const initialized = applyEffectCommands(initial, registry.getHero(cloudMirrorIds.hero).initialize(context, 'blue-1'),
    'battle-start', 'mirror-init', id => registry.getStatus(id));
  assert.equal(initialized.state.units['blue-1'].hp, 50);
  assert.equal(initialized.state.units['blue-1'].statuses.find(status => status.statusId === cloudMirrorIds.form).values.form, 'yin');
  const dispatcher = new EventDispatcher();
  const handler = registry.getHero(cloudMirrorIds.hero).handlers.hit;
  dispatcher.register({ id: `hero:${cloudMirrorIds.hero}:hit`, phase: 'hit', priority: handler.priority, handle: handler.handle });
  const damaged = applyEffectCommands(initialized.state, [{ type: 'deal-damage', source: { kind: 'skill', id: 'test.hit', unitId: 'red-1' },
    targetId: 'blue-1', amount: 100, damageKind: 'true' }], 'hit', 'mirror-hit', id => registry.getStatus(id));
  const settled = settleEvents(damaged.state, damaged.events, dispatcher, () => .5, new TriggerBudget(64), id => registry.getStatus(id));
  assert.equal(settled.state.units['blue-1'].hp, 28);
  assert.equal(settled.state.units['blue-1'].statuses.find(status => status.statusId === cloudMirrorIds.form).values.yinHp, 28);
  const yang = executeAction(settled.state, { actorId: 'blue-1', skillId: cloudMirrorIds.flipYang,
    targetIds: ['blue-1'], shape: 'self', targetRelation: 'ally' }, registry, () => .5);
  assert.equal(yang.state.units['blue-1'].hp, 50);
  assert.equal(yang.state.units['blue-1'].statuses.find(status => status.statusId === cloudMirrorIds.form).values.form, 'yang');
  const yin = executeAction(yang.state, { actorId: 'blue-1', skillId: cloudMirrorIds.flipYin,
    targetIds: ['blue-1'], shape: 'self', targetRelation: 'ally' }, registry, () => .5);
  assert.equal(yin.state.units['blue-1'].hp, 28);
  assert.equal(yin.state.units['blue-1'].statuses.find(status => status.statusId === cloudMirrorIds.form).values.form, 'yin');
  assert.equal(yin.state.resources.blue.fire, 2);
  assert.equal(yin.state.units['blue-1'].statuses.find(status => status.statusId === cloudMirrorIds.form).values.flipCost, 4);
});

test('云外镜镜怒消耗并抵挡下一次可驱散增益', () => {
  const registry = new ContentRegistry();
  registerCloudMirror(registry);
  registry.registerStatus({ id: 'test.dispellable-buff', mechanicsCoverage: 'verified', category: 'buff', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const initial = state();
  initial.units['red-1'] = { ...initial.units['red-1'], statuses: [{ instanceId: 'anger', statusId: cloudMirrorIds.mirrorAnger,
    source: { kind: 'skill', id: cloudMirrorIds.yinSkill, unitId: 'blue-1' }, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'round' } }] };
  const result = applyEffectCommands(initial, [{ type: 'add-status', source: { kind: 'skill', id: 'test.buff', unitId: 'blue-1' },
    targetId: 'red-1', instance: { instanceId: 'buff', statusId: 'test.dispellable-buff',
      source: { kind: 'skill', id: 'test.buff', unitId: 'blue-1' }, stacks: 1, duration: { kind: 'permanent' } } }],
  'effect-resolution', 'mirror-anger', id => registry.getStatus(id));
  assert.ok(!result.state.units['red-1'].statuses.some(status => status.statusId === 'test.dispellable-buff'));
  assert.ok(!result.state.units['red-1'].statuses.some(status => status.statusId === cloudMirrorIds.mirrorAnger));
  assert.deepEqual(result.events.map(event => event.type), ['status-application-blocked', 'status-removed']);
});

test('云外镜镜佑受减益时驱散、推条并治疗生命比例最低友方', () => {
  const registry = new ContentRegistry();
  registerCloudMirror(registry);
  for (const id of ['test.mirror-debuff', 'test.mirror-new-debuff']) registry.registerStatus({ id,
    mechanicsCoverage: 'verified', category: 'debuff', dispellable: true, sealable: false,
    durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const initial = state();
  const owner = { ...initial.units['blue-1'], heroId: cloudMirrorIds.hero, skillLevel: 4,
    stats: { ...initial.units['blue-1'].stats, hp: 100, defense: 10 }, hp: 50,
    statuses: [{ instanceId: 'mirror-blessing-owner', statusId: cloudMirrorIds.mirrorBlessing,
      source: { kind: 'skill', id: cloudMirrorIds.yangSkill, unitId: 'blue-1' }, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'round' },
      values: { healDefenseRatio: 4.8, actionGaugeRatio: .2, dispelCount: 2 } }] };
  const lowAlly = { ...initial.units['blue-1'], unitId: 'blue-2', side: 'blue', hp: 20,
    stats: { ...initial.units['blue-1'].stats, hp: 100, defense: 0 }, statuses: [
      { instanceId: 'existing-debuff', statusId: 'test.mirror-debuff', source: { kind: 'skill', id: 'test', unitId: 'red-1' },
        stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } },
      { instanceId: 'incoming-debuff', statusId: 'test.mirror-new-debuff', source: { kind: 'skill', id: 'test', unitId: 'red-1' },
        stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } },
      { instanceId: 'blessing', statusId: cloudMirrorIds.mirrorBlessing,
        source: { kind: 'skill', id: cloudMirrorIds.yangSkill, unitId: 'blue-1' }, stacks: 1,
        duration: { kind: 'count', remaining: 1, owner: 'round' },
        values: { healDefenseRatio: 4.8, actionGaugeRatio: .2, dispelCount: 2 } },
    ] };
  initial.units['blue-1'] = owner;
  initial.units['blue-2'] = lowAlly;
  initial.sides.blue.push('blue-2');
  const context = createBattleContext(initial, () => .5, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable === true);
  const handler = registry.getHero(cloudMirrorIds.hero).handlers['effect-resolution'];
  const commands = handler.handle(context, { eventId: 'mirror-debuff-event', phase: 'effect-resolution',
    source: { kind: 'skill', id: 'test.new-debuff', unitId: 'red-1' }, type: 'status-added', targetId: 'blue-2',
    instance: { instanceId: 'incoming', statusId: 'test.mirror-new-debuff',
      source: { kind: 'skill', id: 'test.new-debuff', unitId: 'red-1' }, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' } } });
  const settled = applyEffectCommands(initial, commands, 'effect-resolution', 'mirror-blessing-trigger',
    id => registry.getStatus(id));
  assert.equal(settled.state.units['blue-1'].actionGauge, 20);
  assert.equal(settled.state.units['blue-2'].hp, 68);
  assert.ok(!settled.state.units['blue-2'].statuses.some(status => status.statusId === 'test.mirror-debuff'
    || status.statusId === 'test.mirror-new-debuff'));
  assert.ok(settled.state.units['blue-2'].statuses.some(status => status.statusId === cloudMirrorIds.mirrorBlessingUsed));
});

test('云外镜阳状态五级苦海浮生按阳生命损失永久减火', () => {
  const registry = new ContentRegistry();
  registerCloudMirror(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: cloudMirrorIds.hero, skillLevel: 5,
    stats: { ...initial.units['blue-1'].stats, hp: 100, defense: 10 }, hp: 20,
    statuses: [{ instanceId: 'mirror-form', statusId: cloudMirrorIds.form,
      source: { kind: 'skill', id: cloudMirrorIds.flipYang, unitId: 'blue-1' }, stacks: 1,
      duration: { kind: 'permanent' }, values: { form: 'yang', yinHp: 50, yangHp: 20, yinMax: 50,
        yangMax: 50, flipCount: 1, flipCost: 2 } }] };
  const result = executeAction(initial, { actorId: 'blue-1', skillId: cloudMirrorIds.yangSkill,
    targetIds: ['blue-1'], shape: 'single', targetRelation: 'ally' }, registry, () => .5);
  assert.equal(result.state.resources.blue.fire, 3, '阳生命低于40%时按两个30%档位降至1火');
});

test('云外镜把治疗的一半转为两回合镜盾，不增加当前生命', () => {
  const registry = new ContentRegistry();
  registerCloudMirror(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: cloudMirrorIds.hero, hp: 50,
    statuses: [{ instanceId: 'mirror-form', statusId: cloudMirrorIds.form, source: { kind: 'skill', id: cloudMirrorIds.flipYang,
      unitId: 'blue-1' }, stacks: 1, duration: { kind: 'permanent' }, values: { form: 'yin', yinHp: 50, yangHp: 50,
        yinMax: 50, yangMax: 50, flipCount: 0, flipCost: 0 } }] };
  const result = applyEffectCommands(initial, [{ type: 'heal', source: { kind: 'skill', id: 'test.heal', unitId: 'red-1' },
    targetId: 'blue-1', amount: 100 }], 'effect-resolution', 'mirror-heal', id => registry.getStatus(id));
  assert.equal(result.state.units['blue-1'].hp, 50);
  assert.equal(result.state.units['blue-1'].statuses.find(status => status.statusId === cloudMirrorIds.mirrorShield).values.shieldRemaining, 50);
  assert.ok(result.events.some(event => event.type === 'healing-converted' && event.shieldAmount === 50));
});

test('云外镜满级阴生命每降低30%为天坠黑莲追加一段独立命中', () => {
  const registry = new ContentRegistry();
  registerCloudMirror(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: cloudMirrorIds.hero, skillLevel: 5, hp: 50,
    stats: { ...initial.units['blue-1'].stats, hp: 100, attack: 100, defense: 10 }, shield: 0,
    statuses: [{ instanceId: 'mirror-form', statusId: cloudMirrorIds.form, source: { kind: 'skill', id: cloudMirrorIds.flipYang,
      unitId: 'blue-1' }, stacks: 1, duration: { kind: 'permanent' }, modifiers: [{ stat: 'attack', operation: 'flat', amount: 20 }],
      values: { form: 'yin', yinHp: 5, yangHp: 50, yinMax: 50, yangMax: 50, flipCount: 0, flipCost: 0 } }] };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 10000, stats: { ...initial.units['red-1'].stats, hp: 10000, defense: 0 }, shield: 0 };
  const result = executeAction(initial, { actorId: 'blue-1', skillId: cloudMirrorIds.yinSkill,
    targetIds: ['red-1'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .5);
  const hits = result.events.filter(event => event.type === 'damage' && event.source.id === cloudMirrorIds.yinSkill);
  assert.equal(hits.length, 5);
  assert.ok(hits.every(event => event.attackId === hits[0].attackId));
});

test('鬼童丸降诛造成两段伤害并尝试施加可抵抗的骸之锁', () => {
  const registry = new ContentRegistry();
  registerKidomaru(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: kidomaruIds.hero, skillLevel: 5 };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, defense: 0, resist: 0 } };
  const result = executeAction(initial, { actorId: 'blue-1', skillId: kidomaruIds.basic,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => .1);
  assert.equal(result.events.filter(event => event.type === 'damage' && event.source.id === kidomaruIds.basic).length, 2);
  assert.ok(result.state.units['red-1'].statuses.some(status => status.statusId === kidomaruIds.shackle));
  const locked = applyEffectCommands(result.state, [{ type: 'change-action-gauge',
    source: { kind: 'skill', id: 'test.gauge', unitId: 'blue-1' }, targetId: 'red-1', amount: 20 }],
  'effect-resolution', 'locked-gauge', id => registry.getStatus(id));
  assert.equal(locked.state.units['red-1'].actionGauge, result.state.units['red-1'].actionGauge,
    '骸之锁阻止行动条变化');
});

test('鬼童丸五级修罗骸锁开场进入隐匿，修罗状态带120%攻击护盾和三次猎魂次数', () => {
  const registry = new ContentRegistry();
  registerKidomaru(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: kidomaruIds.hero, skillLevel: 5,
    stats: { ...initial.units['blue-1'].stats, attack: 100 } };
  const context = createBattleContext(initial, () => .5);
  const opening = applyEffectCommands(initial, registry.getHero(kidomaruIds.hero).initialize(context, 'blue-1'),
    'battle-start', 'kidomaru-init', id => registry.getStatus(id));
  assert.ok(opening.state.units['blue-1'].statuses.some(status => status.statusId === kidomaruIds.hidden));
  const rage = { instanceId: 'rage', statusId: kidomaruIds.rage,
    source: { kind: 'skill', id: kidomaruIds.basic, unitId: 'blue-1' }, stacks: 3, duration: { kind: 'permanent' } };
  const shuraHandler = registry.getHero(kidomaruIds.hero).handlers['effect-resolution'];
  const shuraCommands = shuraHandler.handle(createBattleContext(opening.state, () => .5), {
    eventId: 'rage-maxed', phase: 'effect-resolution', source: rage.source, type: 'status-added',
    targetId: 'blue-1', instance: rage });
  const entered = applyEffectCommands(opening.state, shuraCommands, 'effect-resolution', 'kidomaru-rage', id => registry.getStatus(id));
  assert.ok(entered.state.units['blue-1'].statuses.some(status => status.statusId === kidomaruIds.shura
    && status.stacks === 3 && status.values.shieldRemaining === 120));
});

test('聆海金鱼姬先机4层凝神，五级灵鱼抱蕊耗2火、推条并附加3层结怨', () => {
  const registry = new ContentRegistry();
  registerHearingSeaGoldfish(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: hearingSeaGoldfishIds.hero, skillLevel: 5,
    stats: { ...initial.units['blue-1'].stats, hp: 100, attack: 100 } };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, hp: 100, resist: 0 } };
  const context = createBattleContext(initial, () => .1);
  const opening = applyEffectCommands(initial, registry.getHero(hearingSeaGoldfishIds.hero).initialize(context, 'blue-1'),
    'battle-start', 'goldfish-init', id => registry.getStatus(id));
  assert.equal(opening.state.units['blue-1'].statuses.find(status => status.statusId === hearingSeaGoldfishIds.concentration).stacks, 4);
  const result = executeAction(opening.state, { actorId: 'blue-1', skillId: hearingSeaGoldfishIds.ultimate,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => .1);
  assert.equal(result.state.resources.blue.fire, 2);
  assert.equal(result.state.units['red-1'].statuses.find(status => status.statusId === hearingSeaGoldfishIds.resentment).stacks, 3);
  assert.ok(result.state.units['blue-1'].statuses.some(status => status.statusId === hearingSeaGoldfishIds.field));
  assert.equal(result.state.units['blue-1'].statuses.find(status => status.statusId === hearingSeaGoldfishIds.surge).stacks, 1);
  assert.equal(result.state.units['blue-1'].actionGauge, 10);
});

test('聆海金鱼姬友方单次受伤超过30%生命时令伤害来源获得结怨', () => {
  const registry = new ContentRegistry();
  registerHearingSeaGoldfish(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: hearingSeaGoldfishIds.hero };
  const context = createBattleContext(initial, () => .1, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable === true);
  const handler = registry.getHero(hearingSeaGoldfishIds.hero).handlers.hit;
  const commands = handler.handle(context, { eventId: 'large-hit', phase: 'hit', source: { kind: 'skill', id: 'test', unitId: 'red-1' },
    type: 'damage', targetId: 'blue-1', amount: 31, hpLost: 31, mitigated: 0, isCritical: false });
  assert.equal(commands.filter(command => command.type === 'add-status'
    && command.instance.statusId === hearingSeaGoldfishIds.resentment).length, 1);
  const tooSmall = handler.handle(context, { eventId: 'small-hit', phase: 'hit', source: { kind: 'skill', id: 'test', unitId: 'red-1' },
    type: 'damage', targetId: 'blue-1', amount: 30, hpLost: 30, mitigated: 0, isCritical: false });
  assert.equal(tooSmall?.length ?? 0, 0);
});

test('聆海金鱼姬鱼尾之簇期间敌方单体推条积浪涌并在其回合末减速', () => {
  const registry = new ContentRegistry();
  registerHearingSeaGoldfish(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: hearingSeaGoldfishIds.hero,
    statuses: [{ instanceId: 'field', statusId: hearingSeaGoldfishIds.field,
      source: { kind: 'skill', id: hearingSeaGoldfishIds.ultimate, unitId: 'blue-1' }, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'source-turn' } }] };
  const hero = registry.getHero(hearingSeaGoldfishIds.hero);
  const gaugeHandler = hero.handlers['effect-resolution'];
  const gaugeCommands = gaugeHandler.handle(createBattleContext(initial, () => .1), {
    eventId: 'enemy-push', phase: 'effect-resolution', source: { kind: 'skill', id: 'test.push', unitId: 'red-1' },
    type: 'action-gauge-changed', unitId: 'red-1', before: 0, after: 20, requestedAmount: 20 });
  const pushed = applyEffectCommands(initial, gaugeCommands, 'effect-resolution', 'goldfish-push', id => registry.getStatus(id));
  assert.equal(pushed.state.units['blue-1'].statuses.find(status => status.statusId === hearingSeaGoldfishIds.surge).stacks, 1);
  const endHandler = hero.handlers['turn-end'];
  const slowCommands = endHandler.handle(createBattleContext(pushed.state, () => .1), {
    eventId: 'enemy-turn-end', phase: 'turn-end', source: { kind: 'unit', id: 'red-1', unitId: 'red-1' },
    type: 'turn-ended', unitId: 'red-1' });
  const slowed = applyEffectCommands(pushed.state, slowCommands, 'turn-end', 'goldfish-slow', id => registry.getStatus(id));
  assert.equal(slowed.state.units['red-1'].statuses.find(status => status.statusId === hearingSeaGoldfishIds.slow)
    .modifiers[0].amount, -.4);
});

test('缘结神缘结相同时返1火并叠缘，二级神赐良缘治疗、增伤并把溢疗一半转盾', () => {
  const registry = new ContentRegistry();
  registerEngagementGod(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: engagementGodIds.hero, skillLevel: 2,
    statuses: [{ instanceId: 'tie-tracker', statusId: engagementGodIds.tracker,
      source: { kind: 'skill', id: engagementGodIds.passive, unitId: 'blue-1' }, stacks: 1,
      duration: { kind: 'permanent' }, values: { lastTie: 0, forceNext: false, anger: 0 } },
    { instanceId: 'fate', statusId: engagementGodIds.fate,
      source: { kind: 'skill', id: engagementGodIds.passive, unitId: 'blue-1' }, stacks: 1, duration: { kind: 'permanent' } }] };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 1, skillLevel: 1, hp: 95,
    stats: { ...initial.units['blue-1'].stats, hp: 100 }, statuses: [] };
  initial.sides.blue.push('blue-2');
  const hero = registry.getHero(engagementGodIds.hero);
  const tieCommands = hero.handlers['turn-start'].handle(createBattleContext(initial, () => .1), {
    eventId: 'friend-turn-start', phase: 'turn-start', source: { kind: 'unit', id: 'blue-2', unitId: 'blue-2' },
    type: 'turn-started', unitId: 'blue-2' });
  const tied = applyEffectCommands(initial, tieCommands, 'turn-start', 'tie-match', id => registry.getStatus(id));
  assert.equal(tied.state.resources.blue.fire, 5);
  assert.equal(tied.state.units['blue-1'].statuses.find(status => status.statusId === engagementGodIds.fate).stacks, 2);
  assert.equal(tied.state.units['blue-2'].statuses.find(status => status.statusId === engagementGodIds.tie).values.tieType, 0);

  const result = executeAction(tied.state, { actorId: 'blue-1', skillId: engagementGodIds.blessing,
    targetIds: ['blue-2'], shape: 'single', targetRelation: 'ally' }, registry, () => .1);
  assert.equal(result.state.resources.blue.fire, 3);
  assert.equal(result.state.units['blue-2'].hp, 100);
  assert.equal(result.state.units['blue-2'].statuses.find(status => status.statusId === engagementGodIds.inspiration)
    .modifiers[0].amount, .5);
  assert.equal(result.state.units['blue-2'].statuses.find(status => status.statusId === engagementGodIds.overflowShield)
    .values.shieldRemaining, 2);
});

test('浮世青行灯普攻挂灯印、大招消耗鬼火、五级队友技能加价且收集鬼火触发全队层数增益', () => {
  const registry = new ContentRegistry();
  registerWorldLantern(registry);
  let initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: worldLanternIds.hero, skillLevel: 5,
    skillLevels: { [worldLanternIds.basic]: 5, [worldLanternIds.passive]: 5, [worldLanternIds.lantern]: 5 } };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 10000, stats: { ...initial.units['red-1'].stats, hp: 10000 } };
  const hero = registry.getHero(worldLanternIds.hero);
  const initialized = applyEffectCommands(initial, hero.initialize(createBattleContext(initial, () => .1), 'blue-1'),
    'battle-start', 'world-lantern-init', id => registry.getStatus(id)).state;
  initial = { ...initialized, resources: { ...initialized.resources, blue: { fire: 4 }, red: { fire: 4 } } };

  const basic = executeAction(initial, { actorId: 'blue-1', skillId: worldLanternIds.basic,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => .1);
  assert.ok(basic.state.units['red-1'].statuses.some(status => status.statusId === worldLanternIds.mark));
  const paid = executeAction(basic.state, { actorId: 'blue-1', skillId: worldLanternIds.lantern,
    targetIds: ['red-1'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .1);
  assert.equal(paid.state.resources.blue.fire, 0, 'five-level team aura adds one fire to the base three-fire cost');
  assert.equal(paid.events.find(event => event.type === 'resource-changed' && event.after < event.before).before -
    paid.events.find(event => event.type === 'resource-changed' && event.after < event.before).after, 4);

  const redMarked = paid.state.units['red-1'];
  assert.equal(registry.getStatus(worldLanternIds.mark).modifyResourceCost(paid.state, redMarked, { id: 'test.skill' },
    { resourceId: 'fire', amount: 2 }), 3);
  const collected = hero.handlers['resource-payment'].handle(createBattleContext(initial, () => .1), {
    eventId: 'fire-gain-30', phase: 'resource-payment', source: { kind: 'skill', id: 'test.gain' },
    type: 'resource-changed', side: 'blue', resourceId: 'fire', before: 0, after: 30 });
  assert.equal(collected.find(command => command.type === 'add-status' && command.instance.statusId === worldLanternIds.collected)
    .instance.stacks, 30);
  assert.ok(collected.some(command => command.type === 'schedule-action' && command.freeCast === true
    && command.intent.skillId === worldLanternIds.lantern));
  const stored = applyEffectCommands(initial, collected, 'resource-payment', 'world-lantern-collect', id => registry.getStatus(id)).state;
  assert.equal(createBattleContext(stored, () => .1).getEffectiveStats('blue-1').attack, 130);
});

test('兵俑挥斩按防御结算并在满级时可以嘲讽目标', () => {
  const registry = new ContentRegistry();
  registerBingyong(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: bingyongIds.hero, skillLevel: 5,
    stats: { ...initial.units['blue-1'].stats, attack: 100, defense: 200 } };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 1000,
    stats: { ...initial.units['red-1'].stats, hp: 1000, defense: 0 } };
  const hero = registry.getHero(bingyongIds.hero);
  const skill = hero.skills.find(candidate => candidate.id === bingyongIds.basic);
  const context = createBattleContext(initial, () => 0, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable === true);
  const commands = skill.execute(context, { actorId: 'blue-1', skillId: bingyongIds.basic,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, skill.levels[4]);
  assert.equal(commands.find(command => command.type === 'deal-damage').amount, 400,
    '420% defense damage is capped at 400% of initial attack');
  assert.ok(commands.some(command => command.type === 'apply-control'), JSON.stringify(commands));
  const applied = applyEffectCommands(initial, commands, 'effect-resolution', 'bingyong-basic', id => registry.getStatus(id));
  assert.ok(applied.state.units['red-1'].statuses.some(status => status.statusId === bingyongIds.taunt),
    JSON.stringify({ hp: applied.state.units['red-1'].hp, commands, events: applied.events }));
  assert.equal(hero.modifyIncomingDamage(undefined, { ...initial.units['blue-1'], heroId: bingyongIds.hero }, 100, 'normal',
    { kind: 'skill', id: 'test.ultimate' }), 70);
  assert.equal(hero.modifyIncomingDamage(undefined, { ...initial.units['blue-1'], heroId: bingyongIds.hero }, 100, 'normal',
    { kind: 'skill', id: bingyongIds.basic }), 100);
  assert.equal(hero.modifyIncomingDamage(undefined, { ...initial.units['blue-1'], heroId: bingyongIds.hero }, 100, 'true',
    { kind: 'skill', id: 'test.ultimate' }), 100);
  let passedSource;
  applyEffectCommands(initial, [{ type: 'deal-damage', source: { kind: 'skill', id: bingyongIds.basic, unitId: 'blue-1' },
    targetId: 'red-1', amount: 1 }], 'hit', 'damage-source', id => registry.getStatus(id),
  (_attacker, _target, amount, _kind, _state, source) => { passedSource = source; return amount; });
  assert.equal(passedSource.id, bingyongIds.basic, 'generic damage modifiers receive the source skill ID');
});

test('兵俑坚不可破支付2火、提升防御并分别判定全体嘲讽', () => {
  const registry = new ContentRegistry();
  registerBingyong(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: bingyongIds.hero, skillLevel: 5,
    stats: { ...initial.units['blue-1'].stats, defense: 100 } };
  initial.units['red-2'] = { ...initial.units['red-1'], unitId: 'red-2' };
  initial.sides = { blue: ['blue-1'], red: ['red-1', 'red-2'] };
  const result = executeAction(initial, { actorId: 'blue-1', skillId: bingyongIds.tauntSkill,
    targetIds: ['blue-1'], shape: 'self', targetRelation: 'ally' }, registry, () => 0);
  assert.equal(result.state.resources.blue.fire, 2);
  assert.equal(createBattleContext(result.state, () => .5).getEffectiveStats('blue-1').defense, 250);
  for (const targetId of ['red-1', 'red-2']) {
    assert.ok(result.state.units[targetId].statuses.some(status => status.statusId === bingyongIds.taunt), targetId);
  }
  assert.equal(result.events.filter(event => event.type === 'control-applied' && event.statusId === bingyongIds.taunt).length, 2);
});

test('丑时之女召唤的草人继承目标生命与防御，受击后等量传导伤害', () => {
  const registry = new ContentRegistry();
  registerUglyWoman(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: uglyWomanIds.hero, skillLevel: 5,
    stats: { ...initial.units['blue-1'].stats, hp: 1000, attack: 100, defense: 300 }, hp: 1000 };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 10000, stats: { ...initial.units['red-1'].stats, hp: 10000, defense: 200 } };
  const cast = executeAction(initial, { actorId: 'blue-1', skillId: uglyWomanIds.scarecrowSkill,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => .5);
  const puppet = Object.values(cast.state.units).find(unit => unit.unitKind === 'summon' && unit.summonedByUnitId === 'blue-1');
  assert.ok(puppet);
  assert.equal(puppet.stats.hp, 3000);
  assert.equal(puppet.stats.defense, 100);
  assert.ok(cast.state.units['red-1'].statuses.some(status => status.statusId === uglyWomanIds.tether
    && status.values.puppetId === puppet.unitId));

  const intercept = (current, attacker, target, amount, kind) => registry.getHero(uglyWomanIds.hero)
    .interceptIncomingDamage(current, attacker, target, amount, kind);
  const hit = applyEffectCommands(cast.state, [{ type: 'deal-damage', source: { kind: 'skill', id: 'test.strike', unitId: 'red-1' },
    targetId: puppet.unitId, amount: 80 }], 'hit', 'scarecrow-transfer', id => registry.getStatus(id), undefined, intercept);
  assert.equal(hit.state.units['red-1'].hp, 9930, '传导的固定伤害仍由目标护盾吸收');
  assert.equal(hit.state.units['red-1'].shield, 0);
  assert.equal(hit.state.units[puppet.unitId].hp, 2920);
  assert.deepEqual(hit.events.filter(event => event.type === 'damage').map(event => event.targetId), ['red-1', puppet.unitId]);
});

test('丑时之女行动后随机施加咒火，等级化易伤进入通用受伤倍率', () => {
  const registry = new ContentRegistry();
  registerUglyWoman(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: uglyWomanIds.hero, skillLevel: 5 };
  const handler = registry.getHero(uglyWomanIds.hero).handlers['action-end'].handle;
  const commands = handler(createBattleContext(initial, () => 0), { type: 'action-ended', eventId: 'curse-action-end', phase: 'action-end',
    source: { kind: 'skill', id: uglyWomanIds.basic, unitId: 'blue-1' }, actionId: 1, actionKind: 'basic', skillId: uglyWomanIds.basic });
  const applied = applyEffectCommands(initial, commands, 'action-end', 'curse-fire', id => registry.getStatus(id));
  const curse = applied.state.units['red-1'].statuses.find(status => status.statusId === uglyWomanIds.curseFire);
  assert.equal(curse.modifiers[0].amount, .15);
  assert.equal(effectiveDamageTakenMultiplier(applied.state.units['red-1']), 1.15);

  const hitSkillId = 'test.curse-fire-hit';
  registry.registerHero({ id: 9001, skills: [createBasicAttackSkill(hitSkillId, [1])], policy(context, unitId) {
    return { actorId: unitId, skillId: hitSkillId,
      targetIds: context.getLivingUnits('red').map(unit => unit.unitId), shape: 'single', targetRelation: 'enemy' };
  } });
  const battleState = { ...state(), counters: { round: 1, action: 0, attack: 0, hit: 0 } };
  battleState.units['blue-1'] = { ...battleState.units['blue-1'], heroId: 9001, hp: 10000,
    stats: { ...battleState.units['blue-1'].stats, hp: 10000, attack: 1000, defense: 0, speed: 300, crit: 0 }, shield: 0 };
  battleState.units['red-1'] = { ...battleState.units['red-1'], heroId: 1, hp: 10000,
    stats: { ...battleState.units['red-1'].stats, hp: 10000, attack: 1, defense: 0, speed: 1 }, shield: 0,
    statuses: curse ? [curse] : [] };
  const cursedDamage = runBattle(battleState, registry, { seed: 17, actionLimit: 1 }).events
    .find(event => event.type === 'damage' && event.source.id === hitSkillId).amount;
  battleState.units['red-1'] = { ...battleState.units['red-1'], statuses: [] };
  const normalDamage = runBattle(battleState, registry, { seed: 17, actionLimit: 1 }).events
    .find(event => event.type === 'damage' && event.source.id === hitSkillId).amount;
  assert.ok(cursedDamage > normalDamage);
  assert.equal(cursedDamage / normalDamage, 1.15);
});

test('丑时之女草人连结在目标行动三次后到期并结束召唤物', () => {
  const registry = new ContentRegistry();
  registerUglyWoman(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: uglyWomanIds.hero, skillLevel: 5 };
  const cast = executeAction(initial, { actorId: 'blue-1', skillId: uglyWomanIds.scarecrowSkill,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => .5);
  const puppet = Object.values(cast.state.units).find(unit => unit.unitKind === 'summon');
  let current = cast.state;
  let expiration;
  for (let turn = 0; turn < 3; turn++) {
    const snapshot = captureStatusExpirySnapshot(current, { owner: 'target-turn', unitId: 'red-1' });
    const result = advanceStatusDurations(current, snapshot, `scarecrow-turn-${turn}`);
    current = result.state;
    expiration = result.events[0] ?? expiration;
  }
  assert.equal(expiration.statusId, uglyWomanIds.tether);
  const commands = registry.getHero(uglyWomanIds.hero).handlers['status-expiration'].handle(
    createBattleContext(current, () => .5), expiration);
  current = applyEffectCommands(current, commands, 'status-expiration', 'scarecrow-expire', id => registry.getStatus(id)).state;
  assert.equal(current.units[puppet.unitId].hp, 0);
  assert.ok(!current.units['red-1'].statuses.some(status => status.statusId === uglyWomanIds.tether));
});

test('独眼小僧受击后为全队施加金刚经，友方受伤时按等级反弹生命损失', () => {
  const registry = new ContentRegistry();
  registerOneEyedMonk(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: oneEyedMonkIds.hero, skillLevel: 5 };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 1, skillLevel: 1, statuses: [] };
  initial.sides = { blue: ['blue-1', 'blue-2'], red: ['red-1'] };
  const passive = registry.getHero(oneEyedMonkIds.hero).handlers.hit.handle;
  const monkHit = { type: 'damage', eventId: 'monk-hit', phase: 'hit', source: { kind: 'skill', id: 'test.hit', unitId: 'red-1' },
    actionId: 1, attackId: 1, hitIndex: 1, targetId: 'blue-1', damageKind: 'normal', amount: 100, hpBefore: 100, hpAfter: 0,
    hpLost: 100, mitigated: 0, isCritical: false };
  const blessing = passive(createBattleContext(initial, () => .5), monkHit);
  const applied = applyEffectCommands(initial, blessing, 'hit', 'monk-vajra', id => registry.getStatus(id));
  assert.equal(createBattleContext(applied.state, () => .5).getEffectiveStats('blue-2').resist, .2);
  const allyHit = { ...monkHit, eventId: 'ally-hit', targetId: 'blue-2', amount: 80, hpBefore: 100, hpAfter: 20, hpLost: 80 };
  const reflected = passive(createBattleContext(applied.state, () => .5), allyHit);
  assert.equal(reflected[0].type, 'lose-life');
  assert.equal(reflected[0].targetId, 'red-1');
  assert.equal(reflected[0].amount, 16);
  const result = applyEffectCommands(applied.state, reflected, 'hit', 'monk-reflect', id => registry.getStatus(id));
  assert.equal(result.state.units['red-1'].hp, 44);
  assert.equal(registry.getStatus(oneEyedMonkIds.vajra).dispellable, false);
});

test('独眼小僧石像冲击支付2火、按等级伤害并进行眩晕判定', () => {
  const registry = new ContentRegistry();
  registerOneEyedMonk(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: oneEyedMonkIds.hero, skillLevel: 5, hp: 10000,
    stats: { ...initial.units['blue-1'].stats, hp: 10000, attack: 1000, defense: 100, crit: 0 } };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 10000,
    stats: { ...initial.units['red-1'].stats, hp: 10000, defense: 0 } };
  const result = executeAction(initial, { actorId: 'blue-1', skillId: oneEyedMonkIds.impact,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => .1);
  assert.equal(result.state.resources.blue.fire, 2);
  assert.ok(result.state.units['red-1'].statuses.some(status => status.statusId === oneEyedMonkIds.stun));
  assert.ok(result.events.some(event => event.type === 'control-applied' && event.statusId === oneEyedMonkIds.stun));
});

test('铁鼠钱响叮当按等级造成伤害并降低目标暴击', () => {
  const registry = new ContentRegistry();
  registerIronRat(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: ironRatIds.hero, skillLevel: 5,
    stats: { ...initial.units['blue-1'].stats, attack: 200, crit: .5 } };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 1000,
    stats: { ...initial.units['red-1'].stats, hp: 1000, defense: 0, crit: .5 } };
  const result = executeAction(initial, { actorId: 'blue-1', skillId: ironRatIds.basic,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => 0);
  const moneyHit = result.state.units['red-1'].statuses.find(status => status.statusId === ironRatIds.moneyHit);
  assert.ok(moneyHit);
  assert.equal(moneyHit.modifiers[0].amount, -.2);
  assert.equal(createBattleContext(result.state, () => .5).getEffectiveStats('red-1').crit, .3);
});

test('铁鼠受击被动按40%概率施加两回合收买并降低攻击', () => {
  const registry = new ContentRegistry();
  registerIronRat(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: ironRatIds.hero, skillLevel: 5 };
  const handler = registry.getHero(ironRatIds.hero).handlers.hit.handle;
  const hit = { type: 'damage', eventId: 'iron-rat-hit', phase: 'hit', source: { kind: 'skill', id: 'test.attack', unitId: 'red-1' },
    actionId: 1, attackId: 1, hitIndex: 1, targetId: 'blue-1', damageKind: 'normal', amount: 100, hpBefore: 100, hpAfter: 0,
    hpLost: 100, mitigated: 0, isCritical: false };
  const commands = handler(createBattleContext(initial, () => 0), hit);
  const result = applyEffectCommands(initial, commands, 'hit', 'iron-rat-bought', id => registry.getStatus(id));
  const bought = result.state.units['red-1'].statuses.find(status => status.statusId === ironRatIds.bought);
  assert.ok(bought);
  assert.equal(createBattleContext(result.state, () => .5).getEffectiveStats('red-1').attack, 80);
  assert.equal(handler(createBattleContext(result.state, () => 0), { ...hit, eventId: 'iron-rat-second-hit-in-same-attack' }), undefined,
    'multi-segment attack must not reroll the passive for every hit');
});

test('铁鼠钱即正义逐目标两段攻击，首段破绽会提高同次技能第二段伤害', () => {
  const registry = new ContentRegistry();
  registerIronRat(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: ironRatIds.hero, skillLevel: 5, hp: 10000,
    stats: { ...initial.units['blue-1'].stats, hp: 10000, attack: 1000, defense: 0, speed: 300, crit: 0 }, shield: 0 };
  initial.units['red-1'] = { ...initial.units['red-1'], heroId: 1, hp: 100000,
    stats: { ...initial.units['red-1'].stats, hp: 100000, attack: 1, defense: 0, speed: 1 }, shield: 0 };
  initial.units['red-2'] = { ...initial.units['red-1'], unitId: 'red-2' };
  initial.sides = { blue: ['blue-1'], red: ['red-1', 'red-2'] };
  initial.resources = { blue: { fire: 4 }, red: { fire: 4 } };
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  const result = runBattle(initial, registry, { seed: 23, actionLimit: 1 });
  const redOneHits = result.events.filter(event => event.type === 'damage' && event.source.id === ironRatIds.ultimate
    && event.targetId === 'red-1');
  assert.equal(redOneHits.length, 2);
  assert.ok(redOneHits[1].amount > redOneHits[0].amount);
  assert.equal(result.state.resources.blue.fire, 2);
  assert.ok(result.state.units['red-1'].statuses.some(status => status.statusId === ironRatIds.flaw));
});

test('椒图涓流按等级建立生命链接，分摊伤害并在友方行动后治疗椒图', () => {
  const registry = new ContentRegistry();
  registerJiaoTu(registry);
  const initial = state();
  const owner = { ...initial.units['blue-1'], heroId: jiaoTuIds.hero, skillLevel: 3, hp: 1000,
    stats: { ...initial.units['blue-1'].stats, hp: 1000, attack: 200, crit: 0 }, shield: 0 };
  const ally = { ...owner, unitId: 'blue-2', heroId: 205, skillLevel: 1, hp: 1000, statuses: [] };
  initial.units['blue-1'] = owner;
  initial.units['blue-2'] = ally;
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 1000,
    stats: { ...initial.units['red-1'].stats, hp: 1000, attack: 500, defense: 0 } };
  initial.sides = { blue: ['blue-1', 'blue-2'], red: ['red-1'] };
  const hero = registry.getHero(jiaoTuIds.hero);
  const intent = { actorId: owner.unitId, skillId: jiaoTuIds.ultimate,
    targetIds: ['blue-1', 'blue-2'], shape: 'all-allies', targetRelation: 'ally' };
  const linkCommands = hero.skills.find(skill => skill.id === jiaoTuIds.ultimate).execute(
    createBattleContext(initial, () => .5), intent, { duration: 2, damageReduction: .05 });
  const linked = applyEffectCommands(initial, linkCommands, 'effect-resolution', 'jiao-tu-link', id => registry.getStatus(id));
  assert.ok(linked.state.units['blue-1'].statuses.some(status => status.statusId === jiaoTuIds.lifeLink));
  assert.equal(linked.state.units['blue-2'].statuses.find(status => status.statusId === jiaoTuIds.lifeLink).values.damageReduction, .05);

  const interceptor = (currentState, attacker, target, amount, kind) => hero.interceptIncomingDamage(currentState, attacker, target, amount, kind);
  const shared = applyEffectCommands(linked.state, [{ type: 'deal-damage', source: { kind: 'skill', id: 'test.hit', unitId: 'red-1' },
    targetId: 'blue-2', amount: 200 }], 'hit', 'jiao-tu-share', id => registry.getStatus(id), undefined, interceptor);
  assert.equal(shared.state.units['blue-1'].hp, 905, 'the linked ally takes its equal transferred share as life loss');
  assert.equal(shared.state.units['blue-2'].hp, 905, 'the original target takes the same share after 5% reduction');
  assert.ok(shared.events.some(event => event.type === 'life-lost' && event.targetId === 'blue-1'
    && event.source.id === jiaoTuIds.lifeLink));

  const heal = hero.handlers['action-end'].handle(createBattleContext(shared.state, () => .5), {
    type: 'action-ended', eventId: 'linked-action-end', phase: 'action-end', source: { kind: 'unit', id: 'blue-2', unitId: 'blue-2' },
    skillId: 'ally.skill', actionKind: 'skill', soulTriggersAllowed: true,
  });
  assert.equal(heal[0].type, 'heal');
  assert.equal(heal[0].targetId, 'blue-1');
  assert.equal(heal[0].amount, 50);
});

test('椒图被动只在友方首次跌破70%且无生命链接时自动建立链接', () => {
  const registry = new ContentRegistry();
  registerJiaoTu(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: jiaoTuIds.hero, skillLevel: 5 };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 205, hp: 60, statuses: [] };
  initial.sides = { blue: ['blue-1', 'blue-2'], red: ['red-1'] };
  const event = { type: 'damage', eventId: 'threshold-hit', phase: 'hit', source: { kind: 'skill', id: 'enemy.hit', unitId: 'red-1' },
    targetId: 'blue-2', damageKind: 'normal', amount: 50, hpBefore: 100, hpAfter: 50, hpLost: 50, mitigated: 0, isCritical: false };
  const passive = registry.getHero(jiaoTuIds.hero).handlers.hit.handle;
  const commands = passive(createBattleContext(initial, () => .5), event);
  assert.equal(commands.filter(command => command.type === 'add-status' && command.instance.statusId === jiaoTuIds.lifeLink).length, 2);
  const linked = applyEffectCommands(initial, commands, 'hit', 'jiao-tu-passive-link', id => registry.getStatus(id));
  assert.ok(linked.state.units['blue-1'].statuses.some(status => status.statusId === jiaoTuIds.lifeLinkOnce));
  assert.ok(linked.state.units['blue-2'].statuses.some(status => status.statusId === jiaoTuIds.lifeLink));
  assert.equal(passive(createBattleContext(linked.state, () => .5), { ...event, eventId: 'threshold-hit-again' }).length, 0);
});

test('管狐竹之护按技能等级推条、叠加狐怒并生成带防御和抵抗的不可驱散护盾', () => {
  const registry = new ContentRegistry();
  registerGuanHu(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: guanHuIds.hero, skillLevel: 4, hp: 10000,
    stats: { ...initial.units['blue-1'].stats, hp: 10000, defense: 100, resist: .1 }, actionGauge: 20 };
  const intent = { actorId: 'blue-1', skillId: guanHuIds.guard, targetIds: ['blue-1'], shape: 'self', targetRelation: 'ally' };
  const runtime = { resolveStatus: id => registry.getStatus(id) };
  const first = executeAction(initial, intent, registry, () => .5, runtime);
  const firstShield = first.state.units['blue-1'].statuses.find(status => status.statusId === guanHuIds.bambooGuard);
  assert.equal(first.state.units['blue-1'].actionGauge, 50);
  assert.equal(firstShield.values.shieldRemaining, 3000);
  assert.equal(first.state.units['blue-1'].statuses.find(status => status.statusId === guanHuIds.foxRage).stacks, 1);
  assert.equal(createBattleContext(first.state, () => .5).getEffectiveStats('blue-1').defense, 200);
  assert.equal(createBattleContext(first.state, () => .5).getEffectiveStats('blue-1').resist, 1.1);
  assert.equal(registry.getStatus(guanHuIds.bambooGuard).dispellable, false);
  const second = executeAction(first.state, intent, registry, () => .5, runtime);
  assert.equal(second.state.units['blue-1'].statuses.find(status => status.statusId === guanHuIds.foxRage).stacks, 2);
});

test('管狐护盾耗尽后移除狐怒和防御增益并眩晕一回合', () => {
  const registry = new ContentRegistry();
  registerGuanHu(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: guanHuIds.hero, skillLevel: 5, hp: 10000,
    stats: { ...initial.units['blue-1'].stats, hp: 10000, defense: 100 },
    statuses: [
      { instanceId: 'guard', statusId: guanHuIds.bambooGuard, source: { kind: 'skill', id: guanHuIds.guard, unitId: 'blue-1' },
        stacks: 1, duration: { kind: 'permanent' }, values: { shieldRemaining: 100 },
        modifiers: [{ stat: 'defense', operation: 'percent', amount: 1 }] },
      { instanceId: 'rage', statusId: guanHuIds.foxRage, source: { kind: 'skill', id: guanHuIds.guard, unitId: 'blue-1' },
        stacks: 3, duration: { kind: 'permanent' } },
    ] };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 10000,
    stats: { ...initial.units['red-1'].stats, hp: 10000, attack: 1000, defense: 0 } };
  const hit = { type: 'damage', eventId: 'guan-hu-guard-hit', phase: 'hit', source: { kind: 'skill', id: 'test.hit', unitId: 'red-1' },
    targetId: 'blue-1', damageKind: 'normal', amount: 500, hpBefore: 10000, hpAfter: 9600, hpLost: 400, mitigated: 100,
    isCritical: false };
  const broken = applyEffectCommands(initial, [{ type: 'deal-damage', source: hit.source, targetId: 'blue-1', amount: 500 }],
    'hit', 'guan-hu-shield-break', id => registry.getStatus(id));
  const commands = registry.getHero(guanHuIds.hero).handlers.hit.handle(createBattleContext(broken.state, () => .5), hit);
  assert.ok(commands.some(command => command.type === 'remove-statuses' && command.statusIds.includes(guanHuIds.foxRage)));
  const result = applyEffectCommands(broken.state, commands, 'hit', 'guan-hu-break-effects', id => registry.getStatus(id));
  assert.ok(!result.state.units['blue-1'].statuses.some(status => status.statusId === guanHuIds.bambooGuard
    || status.statusId === guanHuIds.foxRage));
  assert.ok(result.state.units['blue-1'].statuses.some(status => status.statusId === guanHuIds.stun));
  assert.equal(createBattleContext(result.state, () => .5).getEffectiveStats('blue-1').defense, 100);
});

test('管狐爆轰炮使用等级倍率，暴击时确定削减1点鬼火', () => {
  const registry = new ContentRegistry();
  registerGuanHu(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: guanHuIds.hero, skillLevel: 5 };
  const handler = registry.getHero(guanHuIds.hero).handlers.hit.handle;
  const hit = { type: 'damage', eventId: 'guan-hu-crit', phase: 'hit', source: { kind: 'skill', id: guanHuIds.ultimate, unitId: 'blue-1' },
    targetId: 'red-1', damageKind: 'normal', amount: 266, hpBefore: 1000, hpAfter: 734, hpLost: 266, mitigated: 0, isCritical: true };
  const commands = handler(createBattleContext(initial, () => .99), hit);
  assert.equal(commands[0].type, 'change-resource');
  assert.equal(commands[0].amount, -1);
  const result = applyEffectCommands(initial, commands, 'hit', 'guan-hu-fire-reduction', id => registry.getStatus(id));
  assert.equal(result.state.resources.blue.fire, 3);
  assert.equal(registry.getHero(guanHuIds.hero).skills.find(skill => skill.id === guanHuIds.ultimate).levels[4].ratio, 2.66);
});

test('山兔兔子舞支付2火、全队推条并给行动条最低友方额外攻击增益', () => {
  const registry = new ContentRegistry();
  registerYamausagi(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: yamausagiIds.hero, skillLevel: 4, actionGauge: 40 };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 205, actionGauge: 5, statuses: [] };
  initial.units['blue-3'] = { ...initial.units['blue-1'], unitId: 'blue-3', heroId: 205, actionGauge: 20, statuses: [] };
  initial.sides = { blue: ['blue-1', 'blue-2', 'blue-3'], red: ['red-1'] };
  const result = executeAction(initial, { actorId: 'blue-1', skillId: yamausagiIds.dance,
    targetIds: ['blue-1', 'blue-2', 'blue-3'], shape: 'all-allies', targetRelation: 'ally' }, registry, () => .5,
  { resolveStatus: id => registry.getStatus(id) });
  assert.equal(result.state.resources.blue.fire, 2);
  assert.deepEqual(['blue-1', 'blue-2', 'blue-3'].map(id => result.state.units[id].actionGauge), [70, 35, 50]);
  assert.equal(createBattleContext(result.state, () => .5).getEffectiveStats('blue-1').attack, 120);
  assert.equal(createBattleContext(result.state, () => .5).getEffectiveStats('blue-2').attack, 140);
  assert.equal(result.state.units['blue-2'].statuses.find(status => status.statusId === yamausagiIds.danceBuff)
    .duration.remaining, 2);
});

test('山兔幸运套环变形成功后，满级会调度一次免费的兔子舞', () => {
  const registry = new ContentRegistry();
  registerYamausagi(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: yamausagiIds.hero, skillLevel: 5, hp: 10000,
    stats: { ...initial.units['blue-1'].stats, hp: 10000, attack: 500, speed: 300, hit: 10, crit: 0 } };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 205, hp: 10000, actionGauge: 5, statuses: [] };
  initial.units['red-1'] = { ...initial.units['red-1'], heroId: 1, hp: 10000,
    stats: { ...initial.units['red-1'].stats, hp: 10000, defense: 0, resist: 0, speed: 1 } };
  initial.sides = { blue: ['blue-1', 'blue-2'], red: ['red-1'] };
  initial.resources = { blue: { fire: 4 }, red: { fire: 4 } };
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  const result = runBattle(initial, registry, { seed: 22, actionLimit: 3 });
  assert.ok(result.events.some(event => event.type === 'control-applied' && event.statusId === yamausagiIds.transform));
  assert.ok(result.events.some(event => event.type === 'action-scheduled' && event.intent.skillId === yamausagiIds.dance
    && event.freeCast === true));
  assert.ok(result.events.some(event => event.type === 'action-declared' && event.intent.skillId === yamausagiIds.dance));
  assert.ok(result.state.units['blue-2'].statuses.some(status => status.statusId === yamausagiIds.danceBuff));
  assert.equal(result.state.resources.blue.fire, 1, 'the scheduled dance waives its normal 2-fire cost');
});

test('萤草开局拥有两枚祝福种子，治愈之光转交一枚并全队治疗和施加光合作用', () => {
  const registry = new ContentRegistry();
  registerFirefly(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: fireflyIds.hero, skillLevel: 5, hp: 5000,
    stats: { ...initial.units['blue-1'].stats, hp: 5000, attack: 100, defense: 0 } };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 205, skillLevel: 1, hp: 3000, statuses: [] };
  initial.sides = { blue: ['blue-1', 'blue-2'], red: ['red-1'] };
  const hero = registry.getHero(fireflyIds.hero);
  const initCommands = hero.initialize(createBattleContext(initial, () => .5), 'blue-1');
  const initialized = applyEffectCommands(initial, initCommands, 'battle-start', 'firefly-init', id => registry.getStatus(id));
  assert.equal(initialized.state.units['blue-1'].statuses.find(status => status.statusId === fireflyIds.seed).stacks, 2);
  assert.equal(Math.round(createBattleContext(initialized.state, () => .5).getEffectiveStats('blue-1').attack * 1000) / 1000, 220);
  const cast = executeAction(initialized.state, { actorId: 'blue-1', skillId: fireflyIds.heal,
    targetIds: ['blue-1', 'blue-2'], shape: 'all-allies', targetRelation: 'ally' }, registry, () => .5,
  { resolveStatus: id => registry.getStatus(id) });
  assert.equal(cast.state.resources.blue.fire, 2);
  assert.equal(cast.state.units['blue-1'].statuses.find(status => status.statusId === fireflyIds.seed).stacks, 1);
  assert.equal(cast.state.units['blue-2'].statuses.find(status => status.statusId === fireflyIds.seed).stacks, 1);
  assert.equal(Math.round(createBattleContext(cast.state, () => .5).getEffectiveStats('blue-2').attack * 1000) / 1000, 160);
  assert.equal(cast.events.filter(event => event.type === 'healing').length, 2);
  assert.ok(cast.state.units['blue-1'].statuses.some(status => status.statusId === fireflyIds.photosynthesis));
  assert.ok(cast.state.units['blue-2'].statuses.some(status => status.statusId === fireflyIds.photosynthesis));
  const hot = hero.handlers['turn-start'].handle(createBattleContext(cast.state, () => .5), {
    type: 'turn-started', eventId: 'photosynthesis-tick', phase: 'turn-start', source: { kind: 'unit', id: '205', unitId: 'blue-2' },
    unitId: 'blue-2', actionId: 3,
  });
  assert.equal(hot[0].type, 'heal');
  assert.equal(Math.round(hot[0].amount * 1000) / 1000, 57.2);
  const defeatedState = { ...cast.state, units: { ...cast.state.units, 'blue-2': { ...cast.state.units['blue-2'], hp: 0 } } };
  const seedOnDeath = hero.handlers['unit-defeated'].handle(createBattleContext(defeatedState, () => .5), {
    type: 'unit-defeated', eventId: 'ally-defeated', phase: 'unit-defeated', source: { kind: 'skill', id: 'test.kill' },
    unitId: 'blue-2', defeatedBy: { kind: 'skill', id: 'test.kill', unitId: 'red-1' },
  });
  const afterDeath = applyEffectCommands(defeatedState, seedOnDeath, 'unit-defeated', 'firefly-seed-death', id => registry.getStatus(id));
  assert.equal(afterDeath.state.units['blue-1'].statuses.find(status => status.statusId === fireflyIds.seed).stacks, 2);
});

test('萤草普攻吸血，生花每次攻击只治疗一次并限回合反击低攻击来源', () => {
  const registry = new ContentRegistry();
  registerFirefly(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: fireflyIds.hero, skillLevel: 5, hp: 500,
    stats: { ...initial.units['blue-1'].stats, hp: 1000, attack: 200, defense: 100, crit: 0 } };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 1000,
    stats: { ...initial.units['red-1'].stats, hp: 1000, attack: 100, defense: 0 } };
  const handler = registry.getHero(fireflyIds.hero).handlers.hit.handle;
  const target = initial.units['blue-1'];
  const attacker = initial.units['red-1'];
  assert.equal(registry.getHero(fireflyIds.hero).modifyIncomingDamage(attacker, target, 100, 'normal'), 70,
    'low attack sources deal 30% less incoming damage');
  const incoming = { type: 'damage', eventId: 'firefly-incoming', phase: 'hit', source: { kind: 'skill', id: 'enemy.basic', unitId: 'red-1' },
    targetId: 'blue-1', damageKind: 'normal', amount: 100, hpBefore: 500, hpAfter: 430, hpLost: 70,
    mitigated: 30, isCritical: false, actionId: 1, attackId: 1, hitIndex: 1 };
  const commands = handler(createBattleContext(initial, () => .5), incoming);
  assert.ok(commands.some(command => command.type === 'heal' && command.targetId === 'blue-1' && command.amount === 19),
    'passive healing uses attacker attack and skill level');
  assert.ok(commands.some(command => command.type === 'schedule-action' && command.scheduling === 'counter'
    && command.intent.kind === 'passive'));
  const first = applyEffectCommands(initial, commands, 'hit', 'firefly-first-proc', id => registry.getStatus(id));
  const secondHit = { ...incoming, eventId: 'second-segment', attackId: incoming.attackId, hitIndex: 2 };
  const repeated = handler(createBattleContext(first.state, () => .5), secondHit);
  assert.ok(!repeated.some(command => command.type === 'heal' && command.source.id === fireflyIds.passive),
    'passive healing is limited to one trigger per attack');
  assert.ok(!repeated.some(command => command.type === 'schedule-action'), 'the counter is limited to once per battle round');
  const capped = { ...initial, units: { ...initial.units, 'blue-1': { ...initial.units['blue-1'], statuses: [{
    instanceId: 'firefly-window-cap', statusId: fireflyIds.passiveWindow,
    source: { kind: 'skill', id: fireflyIds.passive, unitId: 'blue-1' }, stacks: 1, duration: { kind: 'permanent' },
    values: { counterUsesSinceTurn: 5, lastCounterRound: 0 },
  }] } } };
  const atLimit = handler(createBattleContext(capped, () => .5), { ...incoming, eventId: 'sixth-counter', attackId: 2 });
  assert.ok(!atLimit.some(command => command.type === 'schedule-action'), 'the counter is capped at five before the next personal turn');
  const basicHit = { ...incoming, eventId: 'firefly-basic-hit', source: { kind: 'skill', id: fireflyIds.basic, unitId: 'blue-1' },
    targetId: 'red-1', attackId: 2, hpLost: 100 };
  const lifeSteal = handler(createBattleContext(initial, () => .5), basicHit);
  assert.ok(lifeSteal.some(command => command.type === 'heal' && command.targetId === 'blue-1' && command.amount === 30));
});

test('萤草五级回合外普攻伤害翻倍，生花与阵亡得种子读取各自技能等级', () => {
  const registry = new ContentRegistry();
  registerFirefly(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: fireflyIds.hero, skillLevel: 5,
    skillLevels: { [fireflyIds.basic]: 5, [fireflyIds.passive]: 1, [fireflyIds.heal]: 4 },
    stats: { ...initial.units['blue-1'].stats, attack: 100, crit: 0 } };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, defense: 0 } };
  const context = createBattleContext(initial, () => .5);
  const basic = registry.getHero(fireflyIds.hero).skills.find(skill => skill.id === fireflyIds.basic);
  const baseIntent = { actorId: 'blue-1', skillId: fireflyIds.basic, targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' };
  const normal = basic.execute(context, { ...baseIntent, kind: 'basic' }, { ratio: 1.25 });
  const counter = basic.execute(context, { ...baseIntent, kind: 'passive' }, { ratio: 1.25 });
  assert.equal(counter[0].amount, normal[0].amount * 2, '五级回合外普攻提高100%伤害');

  const hit = { type: 'damage', eventId: 'firefly-rank-hit', phase: 'hit', source: { kind: 'skill', id: 'test.enemy', unitId: 'red-1' },
    targetId: 'blue-1', damageKind: 'normal', amount: 100, hpBefore: 1000, hpAfter: 900, hpLost: 100,
    mitigated: 0, isCritical: false, actionId: 1, attackId: 1, hitIndex: 1 };
  const passiveHeal = registry.getHero(fireflyIds.hero).handlers.hit.handle(context, hit);
  assert.ok(passiveHeal.some(command => command.type === 'heal' && command.amount === 15), '生花治疗倍率读取被动一级');
  const death = { type: 'unit-defeated', eventId: 'firefly-rank-death', phase: 'unit-defeated',
    source: { kind: 'skill', id: 'test.kill' }, unitId: 'red-1', defeatedBy: { kind: 'skill', id: 'test.kill', unitId: 'blue-1' } };
  assert.deepEqual(registry.getHero(fireflyIds.hero).handlers['unit-defeated'].handle(context, death), [],
    '友方阵亡获得种子由治愈之光等级5解锁，不能使用全局等级5替代');
});

test('萤草开局种子、治疗技能和状态展示沿正式模拟路径结算', () => {
  const registry = new ContentRegistry();
  registerFirefly(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: fireflyIds.hero, skillLevel: 5, hp: 2000, actionGauge: 99,
    stats: { ...initial.units['blue-1'].stats, hp: 10000, attack: 500, speed: 300, crit: 0 } };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 205, skillLevel: 1, hp: 1000,
    stats: { ...initial.units['blue-1'].stats, hp: 10000, attack: 200, speed: 1 }, actionGauge: 0, statuses: [] };
  initial.units['red-1'] = { ...initial.units['red-1'], heroId: 1, hp: 10000,
    stats: { ...initial.units['red-1'].stats, hp: 10000, attack: 1, defense: 0, speed: 1 } };
  initial.sides = { blue: ['blue-1', 'blue-2'], red: ['red-1'] };
  initial.resources = { blue: { fire: 4 }, red: { fire: 4 } };
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  const result = runBattle(initial, registry, { seed: 12, actionLimit: 1 });
  assert.ok(result.events.some(event => event.type === 'action-declared' && event.intent.skillId === fireflyIds.heal));
  assert.ok(result.events.some(event => event.type === 'healing' && event.targetId === 'blue-2'));
  assert.equal(result.state.resources.blue.fire, 2);
  assert.equal(result.state.units['blue-1'].statuses.find(status => status.statusId === fireflyIds.seed).stacks, 1);
  assert.ok(result.state.units['blue-2'].statuses.some(status => status.statusId === fireflyIds.seed));
  assert.ok(result.state.units['blue-2'].statuses.some(status => status.statusId === fireflyIds.photosynthesis));
});

test('萤草受到治疗时祝福种子令持有者回复萤草实际恢复的等量生命', () => {
  const registry = new ContentRegistry();
  registerFirefly(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: fireflyIds.hero, skillLevel: 5, hp: 2000, actionGauge: 99,
    stats: { ...initial.units['blue-1'].stats, hp: 10000, attack: 500, speed: 300, crit: 0 } };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 205, hp: 1000, actionGauge: 0,
    stats: { ...initial.units['blue-1'].stats, hp: 10000, attack: 200, speed: 1 }, statuses: [] };
  initial.units['red-1'] = { ...initial.units['red-1'], heroId: 1, hp: 10000,
    stats: { ...initial.units['red-1'].stats, hp: 10000, attack: 1, defense: 0, speed: 1 } };
  initial.sides = { blue: ['blue-1', 'blue-2'], red: ['red-1'] };
  initial.resources = { blue: { fire: 4 }, red: { fire: 4 } };
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  const result = runBattle(initial, registry, { seed: 18, actionLimit: 1 });
  const fireflyHeal = result.events.find(event => event.type === 'healing' && event.targetId === 'blue-1'
    && event.source.id === fireflyIds.heal);
  assert.ok(fireflyHeal && fireflyHeal.hpGained > 0);
  const seedEcho = result.events.find(event => event.type === 'healing' && event.targetId === 'blue-2'
    && event.source.id === fireflyIds.passive);
  assert.ok(seedEcho, 'the transferred seed reacts to Firefly actually receiving healing');
  assert.equal(seedEcho.hpGained, fireflyHeal.hpGained);
});

test('萤草光合作用每个回目首次受到伤害时将该次伤害转为治疗', () => {
  const registry = new ContentRegistry();
  registerFirefly(registry);
  const enemySkill = createBasicAttackSkill('test.enemy-basic', [1]);
  registry.registerHero({ id: 999, skills: [enemySkill], policy(_context, unitId) {
    return { actorId: unitId, skillId: enemySkill.id, targetIds: ['blue-1'], shape: 'single', targetRelation: 'enemy' };
  } });
  const initial = state();
  const photosynthesisSource = { kind: 'skill', id: fireflyIds.heal, unitId: 'blue-1' };
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: fireflyIds.hero, skillLevel: 1, hp: 6000,
    stats: { ...initial.units['blue-1'].stats, hp: 10000, attack: 100, defense: 0, speed: 1 },
    statuses: [{ instanceId: `${fireflyIds.photosynthesis}:blue-1:blue-1`, statusId: fireflyIds.photosynthesis,
      source: photosynthesisSource, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' },
      values: { healAmount: 22 } }] };
  initial.units['red-1'] = { ...initial.units['red-1'], heroId: 999, skillLevel: 1, hp: 10000, actionGauge: 99,
    stats: { ...initial.units['red-1'].stats, hp: 10000, attack: 500, defense: 0, speed: 10000 } };
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  const result = runBattle(initial, registry, { seed: 6, actionLimit: 1 });
  const damage = result.events.find(event => event.type === 'damage' && event.source.id === enemySkill.id);
  const conversion = result.events.find(event => event.type === 'healing' && event.targetId === 'blue-1'
    && event.source.id === fireflyIds.heal);
  assert.ok(damage);
  assert.equal(damage.amount, 0);
  assert.equal(damage.hpLost, 0);
  assert.ok(conversion && conversion.hpGained > 0);
  assert.equal(result.state.units['blue-1'].statuses.find(status => status.statusId === fireflyIds.photosynthesis)
    .values.damageConvertedRound, 1);

  const firefly = registry.getHero(fireflyIds.hero);
  assert.equal(firefly.interceptIncomingDamage(result.state, result.state.units['red-1'], result.state.units['blue-1'], 500,
    'normal') , undefined, 'the effect is limited to one conversion per round');
  const nextRound = { ...result.state, counters: { ...result.state.counters, round: 2 } };
  assert.equal(firefly.interceptIncomingDamage(nextRound, nextRound.units['red-1'], nextRound.units['blue-1'], 500,
    'normal').amount, 0, 'the conversion becomes available again in the next round');
});

test('蝴蝶精轻盈随队伍最低血线调整速度并解锁满级免费祈愿之舞', () => {
  const registry = new ContentRegistry();
  registerButterflySpirit(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: butterflySpiritIds.hero, skillLevel: 5, hp: 10000, actionGauge: 99,
    stats: { ...initial.units['blue-1'].stats, hp: 10000, speed: 100 } };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 205, hp: 2000, actionGauge: 0,
    stats: { ...initial.units['blue-1'].stats, speed: 1 }, statuses: [] };
  initial.units['red-1'] = { ...initial.units['red-1'], heroId: 1, hp: 10000,
    stats: { ...initial.units['red-1'].stats, hp: 10000, speed: 1, attack: 1 } };
  initial.sides = { blue: ['blue-1', 'blue-2'], red: ['red-1'] };
  initial.resources = { blue: { fire: 0 }, red: { fire: 0 } };
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  const result = runBattle(initial, registry, { seed: 17, actionLimit: 1 });
  const lightness = result.state.units['blue-1'].statuses.find(status => status.statusId === butterflySpiritIds.lightness);
  assert.equal(lightness.stacks, 2, 'healing the lowest ally recalculates the dynamic speed layers');
  assert.equal(createBattleContext(result.state, () => .5).getEffectiveStats('blue-1').speed, 160);
  assert.ok(result.events.some(event => event.type === 'action-declared' && event.intent.skillId === butterflySpiritIds.wishDance));
  assert.equal(result.state.resources.blue.fire, 0, 'four lightness layers waive the full 2-fire cost');
  assert.ok(result.state.units['blue-2'].statuses.some(status => status.statusId === butterflySpiritIds.dance));
});

test('蝴蝶精祈愿之舞驱散三项状态、治疗并按溢出生成护盾，蝶舞受击后治疗', () => {
  const registry = new ContentRegistry();
  registerButterflySpirit(registry);
  registry.registerStatus({ id: 'test.butterfly-debuff', mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: butterflySpiritIds.hero, skillLevel: 2, hp: 10000,
    stats: { ...initial.units['blue-1'].stats, hp: 10000, speed: 100 } };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 205, hp: 9800,
    statuses: [0, 1, 2, 3].map(index => ({ instanceId: `debuff-${index}`, statusId: 'test.butterfly-debuff',
      source: { kind: 'skill', id: 'test.debuff', unitId: 'red-1' }, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' } })) };
  initial.sides = { blue: ['blue-1', 'blue-2'], red: ['red-1'] };
  const skill = registry.getHero(butterflySpiritIds.hero).skills.find(item => item.id === butterflySpiritIds.wishDance);
  const intent = { actorId: 'blue-1', skillId: butterflySpiritIds.wishDance, targetIds: ['blue-2'],
    shape: 'single', targetRelation: 'ally' };
  const commands = skill.execute(createBattleContext(initial, () => .5), intent, { ratio: .31, damageHealRatio: .09 });
  const first = applyEffectCommands(initial, commands, 'effect-resolution', 'butterfly-heal', id => registry.getStatus(id));
  assert.equal(first.state.units['blue-2'].statuses.filter(status => status.statusId === 'test.butterfly-debuff').length, 1);
  assert.equal(first.state.units['blue-2'].hp, 10000);
  const healing = first.events.find(event => event.type === 'healing');
  const overflow = registry.getHero(butterflySpiritIds.hero).handlers['effect-resolution'].handle(
    createBattleContext(first.state, () => .5), healing);
  const shielded = applyEffectCommands(first.state, overflow, 'effect-resolution', 'butterfly-overflow', id => registry.getStatus(id));
  assert.equal(shielded.state.units['blue-2'].statuses.find(status => status.statusId === butterflySpiritIds.overflowShield)
    .values.shieldRemaining, 500);
  const hit = { type: 'damage', eventId: 'butterfly-dance-hit', phase: 'hit', source: { kind: 'skill', id: 'test.hit', unitId: 'red-1' },
    targetId: 'blue-2', damageKind: 'normal', amount: 100, hpBefore: 10000, hpAfter: 9900, hpLost: 100, mitigated: 0,
    isCritical: false };
  const followupHeal = registry.getHero(butterflySpiritIds.hero).handlers.hit.handle(
    createBattleContext(shielded.state, () => .5), hit);
  assert.ok(followupHeal.some(command => command.type === 'heal' && command.targetId === 'blue-2' && command.amount === 900));
});

test('狸猫妖酒壶叠加酒气并挑衅，烈焰之酒转换酒火，醉倒可被攻击唤醒', () => {
  const registry = new ContentRegistry();
  registerTanuki(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: tanukiIds.hero, skillLevel: 5, hp: 5000,
    stats: { ...initial.units['blue-1'].stats, hp: 10000, attack: 1000, crit: 0 } };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 10000,
    stats: { ...initial.units['red-1'].stats, hp: 10000, defense: 0, resist: 0 } };
  initial.resources.blue.fire = 3;
  const hero = registry.getHero(tanukiIds.hero);
  const basic = hero.skills.find(skill => skill.id === tanukiIds.basic);
  const basicIntent = { actorId: 'blue-1', skillId: tanukiIds.basic, targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' };
  const basicResult = executeAction(initial, basicIntent, registry, () => 0,
    { resolveStatus: id => registry.getStatus(id) });
  assert.equal(basicResult.state.units['red-1'].statuses.find(status => status.statusId === tanukiIds.sake).stacks, 1);
  assert.ok(basicResult.state.units['red-1'].statuses.some(status => status.values?.controlType === '挑衅'));
  const provoked = { ...basicResult.state, counters: { round: 1, action: 0, attack: 0, hit: 0 },
    units: { ...basicResult.state.units,
      'blue-1': { ...basicResult.state.units['blue-1'], stats: { ...basicResult.state.units['blue-1'].stats, speed: 1 } },
      'red-1': { ...basicResult.state.units['red-1'], stats: { ...basicResult.state.units['red-1'].stats, speed: 200 } } } };
  const forced = runBattle(provoked, registry, { seed: 23, actionLimit: 1 });
  assert.ok(forced.events.some(event => event.type === 'damage' && event.targetId === 'blue-1'
    && event.source.id === tanukiIds.provoke), '挑衅单位在自己的行动中攻击状态来源');

  const marked = { ...basicResult.state, units: { ...basicResult.state.units,
    'red-1': { ...basicResult.state.units['red-1'], stats: { ...basicResult.state.units['red-1'].stats, hp: 20000 }, statuses: [{ instanceId: 'test.sake', statusId: tanukiIds.sake,
      source: { kind: 'skill', id: tanukiIds.basic, unitId: 'blue-1' }, stacks: 2, duration: { kind: 'permanent' } }] } } };
  const ultimate = hero.skills.find(skill => skill.id === tanukiIds.ultimate);
  const ultimateIntent = { actorId: 'blue-1', skillId: tanukiIds.ultimate, targetIds: ['red-1'],
    shape: 'all-enemies', targetRelation: 'enemy' };
  const ultimateResult = executeAction(marked, ultimateIntent, registry, () => 0,
    { resolveStatus: id => registry.getStatus(id) });
  const fire = ultimateResult.state.units['red-1'].statuses.find(status => status.statusId === tanukiIds.sakeFire);
  assert.equal(fire.stacks, 2);
  assert.equal(fire.values.damagePerStack, 500);
  assert.equal(ultimateResult.state.units['red-1'].statuses.some(status => status.statusId === tanukiIds.sake), false);
  const burnCommands = hero.handlers['turn-start'].handle(createBattleContext(ultimateResult.state, () => 0),
    { type: 'turn-started', eventId: 'red-turn-start', phase: 'turn-start', source: { kind: 'unit', id: '1', unitId: 'red-1' }, unitId: 'red-1' });
  const burned = applyEffectCommands(ultimateResult.state, burnCommands, 'turn-start', 'red-turn-start', id => registry.getStatus(id));
  assert.equal(burned.state.units['red-1'].hp, ultimateResult.state.units['red-1'].hp - 1000);
  assert.equal(burned.events.find(event => event.type === 'life-lost').lifeLossKind, 'indirect');

  const turnEnd = { type: 'turn-ended', eventId: 'tanuki-turn-end', phase: 'turn-end', source: { kind: 'unit', id: '208', unitId: 'blue-1' }, unitId: 'blue-1' };
  const drunkCommands = hero.handlers['turn-end'].handle(createBattleContext(initial, () => 0), turnEnd);
  assert.equal(drunkCommands[0].instance.statusId, tanukiIds.drunk);
  const drunkState = applyEffectCommands(initial, drunkCommands, 'turn-end', turnEnd.eventId, id => registry.getStatus(id)).state;
  const hitEvent = { type: 'damage', eventId: 'tanuki-hit', phase: 'hit', source: { kind: 'skill', id: 'test.attack', unitId: 'red-1' },
    targetId: 'blue-1', damageKind: 'normal', amount: 20, hpBefore: 5000, hpAfter: 4980, hpLost: 20, mitigated: 0, isCritical: false };
  const wakeCommands = hero.handlers.hit.handle(createBattleContext(drunkState, () => 0), hitEvent);
  assert.ok(wakeCommands.some(command => command.type === 'change-action-gauge' && command.amount === 30));
  const woken = applyEffectCommands(drunkState, wakeCommands, 'hit', hitEvent.eventId, id => registry.getStatus(id));
  assert.equal(woken.state.units['blue-1'].statuses.some(status => status.statusId === tanukiIds.drunk), false);
  assert.equal(woken.state.units['red-1'].statuses.find(status => status.statusId === tanukiIds.sake).stacks, 1);
  assert.equal(hero.mechanicsCoverage, 'partial');
});

test('海坊主巨浪三段逐次攻击，祝福之水行动内重复治疗递减15%', () => {
  const registry = new ContentRegistry();
  registerSeaMonk(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: seaMonkIds.hero,
    stats: { ...initial.units['blue-1'].stats, hp: 10000, attack: 1000, defense: 0, speed: 200, crit: 0 }, hp: 10000 };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 1, hp: 1000,
    stats: { ...initial.units['blue-1'].stats, speed: 50 }, statuses: [] };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 100000,
    stats: { ...initial.units['red-1'].stats, hp: 100000, defense: 0, speed: 10, crit: 0 } };
  initial.sides = { blue: ['blue-1', 'blue-2'], red: ['red-1'] };
  initial.resources.blue.fire = 3;
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  const result = runBattle(initial, registry, { seed: 101, actionLimit: 1 });
  const damages = result.events.filter(event => event.type === 'damage' && event.source.id === seaMonkIds.ultimate);
  const heals = result.events.filter(event => event.type === 'healing' && event.source.id === seaMonkIds.passive);
  assert.equal(damages.length, 3, '巨浪对一个目标造成三段伤害');
  assert.deepEqual(heals.map(event => event.targetId), ['blue-2', 'blue-2', 'blue-2']);
  assert.ok(Math.abs(heals[0].requestedAmount - damages[0].hpLost) < .001);
  assert.ok(Math.abs(heals[1].requestedAmount - damages[1].hpLost * .85) < .001);
  assert.ok(Math.abs(heals[2].requestedAmount - damages[2].hpLost * .7) < .001);
  assert.equal(result.state.units['blue-1'].statuses.some(status => status.statusId === seaMonkIds.healingWindow), false,
    '海坊主行动结束后清理仅用于当前行动递减治疗的内部状态');
  assert.equal(registry.getHero(seaMonkIds.hero).mechanicsCoverage, 'partial');
});

test('海坊主祝福之水读取觉醒治疗系数，护盾全吸收和生命流失不触发治疗', () => {
  const registry = new ContentRegistry();
  registerSeaMonk(registry);
  const hero = registry.getHero(seaMonkIds.hero);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: seaMonkIds.hero, awakeFilter: 0, hp: 800,
    stats: { ...initial.units['blue-1'].stats, hp: 1000 } };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 1, hp: 100,
    stats: { ...initial.units['blue-1'].stats, hp: 1000 }, statuses: [] };
  initial.sides.blue = ['blue-1', 'blue-2'];
  const context = createBattleContext(initial, () => .5);
  const damage = { type: 'damage', eventId: 'sea-monk-lethal-hit', phase: 'hit', source: { kind: 'skill', id: seaMonkIds.ultimate,
    unitId: 'blue-1' }, actionId: 9, targetId: 'red-1', damageKind: 'normal', amount: 1000, hpBefore: 1000, hpAfter: 0,
    hpLost: 1000, mitigated: 0, isCritical: false };
  const lethalHeal = hero.handlers.hit.handle(context, damage);
  assert.equal(lethalHeal.find(command => command.type === 'heal').targetId, 'blue-2');
  assert.equal(lethalHeal.find(command => command.type === 'heal').amount, 600,
    '未觉醒参数下按客户端60%治疗，击杀命中仍按实际生命损失计算');
  assert.equal(hero.handlers.hit.handle(context, { ...damage, hpLost: 0, hpAfter: 1000 }), undefined,
    '伤害被护盾完全吸收时没有实际生命损失，不触发治疗');
  assert.equal(hero.handlers.hit.handle(context, { ...damage, type: 'life-lost' }), undefined,
    '生命流失不是普攻或技能伤害命中事件');
});

test('虫师每次攻击最多判定一次免伤，虫之痕联动治疗且技能按等级驱散治疗', () => {
  const registry = new ContentRegistry();
  registerInsectMaster(registry);
  registry.registerStatus({ id: 'test.insect-debuff', mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: insectMasterIds.hero, skillLevel: 3,
    stats: { ...initial.units['blue-1'].stats, hp: 10000 }, hp: 6000 };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, hp: 10000 } };
  const hero = registry.getHero(insectMasterIds.hero);
  const interceptionContext = current => ({ attackId: 5, hitIndex: 1,
    battle: createBattleContext(current, () => 0, id => registry.getStatus(id)?.category, id => registry.getStatus(id)?.dispellable === true),
    isUnitUnableToAct: () => false });
  const intercepted = hero.interceptIncomingDamage(initial, initial.units['red-1'], initial.units['blue-1'], 400, 'normal', interceptionContext(initial));
  assert.equal(intercepted.amount, 0, '25%判定成功时本段伤害被免疫');
  const applied = applyEffectCommands(initial, intercepted.effects, 'effect-resolution', 'insect-intercept', id => registry.getStatus(id));
  assert.ok(applied.state.units['red-1'].statuses.some(status => status.statusId === insectMasterIds.trace));
  assert.equal(effectiveDamageTakenMultiplier(applied.state.units['red-1']), 1.3,
    '虫之痕按客户端buff参数令目标受到伤害提高30%');
  assert.equal(hero.interceptIncomingDamage(applied.state, applied.state.units['red-1'], applied.state.units['blue-1'], 500,
    'normal', { ...interceptionContext(applied.state), hitIndex: 2 }), undefined, '同一次攻击后续段不重复触发');

  const independentRolls = [0.5, 0];
  const noImmunityContext = { ...interceptionContext(initial), battle: createBattleContext(initial,
    () => independentRolls.shift() ?? 0, id => registry.getStatus(id)?.category, id => registry.getStatus(id)?.dispellable === true) };
  const noImmunity = hero.interceptIncomingDamage(initial, initial.units['red-1'], initial.units['blue-1'], 400,
    'normal', noImmunityContext);
  assert.equal(noImmunity.amount, 400, '免伤判定失败时伤害正常结算');
  const tracedDespiteHit = applyEffectCommands(initial, noImmunity.effects, 'effect-resolution', 'insect-independent-rolls',
    id => registry.getStatus(id));
  assert.ok(tracedDespiteHit.state.units['red-1'].statuses.some(status => status.statusId === insectMasterIds.trace),
    '附加虫之痕独立于25%免伤判定');
  const immuneButResisted = { ...initial, units: { ...initial.units,
    'red-1': { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, resist: .95 } } } };
  const resistedRolls = [0, .99];
  const immuneAndResistContext = { attackId: 6, hitIndex: 1,
    battle: createBattleContext(immuneButResisted, () => resistedRolls.shift() ?? .99,
      id => registry.getStatus(id)?.category, id => registry.getStatus(id)?.dispellable === true),
    isUnitUnableToAct: () => false };
  const immuneAndResisted = hero.interceptIncomingDamage(immuneButResisted, immuneButResisted.units['red-1'],
    immuneButResisted.units['blue-1'], 400, 'normal', immuneAndResistContext);
  assert.equal(immuneAndResisted.amount, 0, '免伤成功仍独立于附痕抵抗');
  const resistedResult = applyEffectCommands(immuneButResisted, immuneAndResisted.effects, 'effect-resolution',
    'insect-immunity-and-resist', id => registry.getStatus(id));
  assert.equal(resistedResult.state.units['red-1'].statuses.some(status => status.statusId === insectMasterIds.trace), false);
  assert.ok(resistedResult.events.some(event => event.type === 'status-resisted' && event.statusId === insectMasterIds.trace));

  const sealedInsect = { ...initial, units: { ...initial.units, 'blue-1': { ...initial.units['blue-1'], statuses: [
    { instanceId: 'passive-seal', statusId: passiveSuppressionStatusId,
      source: { kind: 'skill', id: 'test.seal', unitId: 'red-1' }, stacks: 1, duration: { kind: 'permanent' } },
  ] } } };
  assert.equal(hero.interceptIncomingDamage(sealedInsect, sealedInsect.units['red-1'], sealedInsect.units['blue-1'], 400,
    'normal', interceptionContext(sealedInsect)), undefined, '被动封印时不进行免伤或虫之痕判定');

  const tracedTarget = { ...applied.state.units['red-1'], statuses: applied.state.units['red-1'].statuses };
  const traceHit = { type: 'damage', eventId: 'insect-trace-hit', phase: 'hit', source: { kind: 'skill', id: 'test.hit', unitId: 'blue-1' },
    targetId: 'red-1', damageKind: 'normal', amount: 200, hpBefore: 10000, hpAfter: 9800, hpLost: 200, mitigated: 0, isCritical: false };
  const linkedHeal = hero.handlers.hit.handle(createBattleContext({ ...applied.state,
    units: { ...applied.state.units, 'red-1': tracedTarget } }, () => 0), traceHit);
  assert.equal(linkedHeal[0].type, 'heal');
  assert.equal(linkedHeal[0].targetId, 'blue-1');
  assert.equal(linkedHeal[0].amount, 30);
  const deadInsectState = { ...applied.state, units: { ...applied.state.units,
    'blue-1': { ...applied.state.units['blue-1'], hp: 0 } } };
  assert.equal(hero.handlers.hit.handle(createBattleContext(deadInsectState, () => 0), traceHit), undefined,
    '虫师阵亡后，存留的虫之痕不再触发被动治疗');
  const sealedInsectState = { ...applied.state, units: { ...applied.state.units,
    'blue-1': { ...applied.state.units['blue-1'], statuses: [...applied.state.units['blue-1'].statuses,
      { instanceId: 'insect-passive-seal', statusId: passiveSuppressionStatusId,
        source: { kind: 'skill', id: 'test.seal', unitId: 'red-1' }, stacks: 1, duration: { kind: 'permanent' } }] } } };
  assert.equal(hero.handlers.hit.handle(createBattleContext(sealedInsectState, () => 0), traceHit), undefined,
    '虫师被动封印后，存留的虫之痕不再触发被动治疗');

  const pingSkill = { id: 'test.insect-three-hit', actionKind: 'skill', target: 'single', targetRelation: 'enemy', levels: [{}],
    execute(_context, intent) { return [1, 2, 3].map(() => ({ type: 'deal-damage', source: { kind: 'skill', id: 'test.insect-three-hit',
      unitId: intent.actorId }, targetId: intent.targetIds[0], amount: 100 })); } };
  registry.registerHero({ id: 99, skills: [pingSkill], aiCoverage: 'verified', mechanicsCoverage: 'verified',
    policy(_context, unitId) { return { actorId: unitId, skillId: pingSkill.id, targetIds: ['blue-1'], shape: 'single', targetRelation: 'enemy' }; } });
  const live = state();
  live.units['blue-1'] = { ...live.units['blue-1'], heroId: insectMasterIds.hero, hp: 10000, shield: 0,
    stats: { ...live.units['blue-1'].stats, hp: 10000, speed: 1, resist: 0 } };
  live.units['red-1'] = { ...live.units['red-1'], heroId: 99, hp: 10000,
    stats: { ...live.units['red-1'].stats, hp: 10000, speed: 200 } };
  live.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  const liveResult = runBattle(live, registry, { seed: 1, actionLimit: 1 });
  const liveDamage = liveResult.events.filter(event => event.type === 'damage' && event.source.id === pingSkill.id);
  assert.deepEqual(liveDamage.map(event => event.hpLost), [0, 100, 100], '首段免疫后，本次攻击剩余两段正常命中');
  assert.equal(new Set(liveDamage.map(event => event.attackId)).size, 1);

  const skillState = state();
  skillState.units['blue-1'] = { ...skillState.units['blue-1'], heroId: insectMasterIds.hero, skillLevel: 1,
    skillLevels: { [insectMasterIds.skill]: 2 }, hp: 5000,
    stats: { ...skillState.units['blue-1'].stats, hp: 10000 } };
  skillState.units['blue-2'] = { ...skillState.units['blue-1'], unitId: 'blue-2', heroId: 1, hp: 500,
    statuses: [{ instanceId: 'test.debuff', statusId: 'test.insect-debuff', source: { kind: 'skill', id: 'test', unitId: 'red-1' },
      stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }] };
  skillState.sides.blue = ['blue-1', 'blue-2'];
  skillState.resources.blue.fire = 3;
  const context = createBattleContext(skillState, () => .5, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable === true);
  const intent = hero.policy(context, 'blue-1');
  assert.equal(intent.skillId, insectMasterIds.skill, '最低友方低于70%且有3火时选择治疗净化');
  const exactSeventy = { ...skillState, units: { ...skillState.units,
    'blue-1': { ...skillState.units['blue-1'], hp: 7000 }, 'blue-2': { ...skillState.units['blue-2'], hp: 7000 } } };
  assert.equal(hero.policy(createBattleContext(exactSeventy, () => .5), 'blue-1').skillId, insectMasterIds.basic,
    '最低血线恰为70%时沿用旧 AI 的严格小于边界');
  const skill = hero.skills.find(item => item.id === insectMasterIds.skill);
  const commands = skill.execute(context, intent, { healRatio: .15, cleanseCount: 4, reducedHealRatio: .2 });
  const settled = applyEffectCommands(skillState, commands, 'effect-resolution', 'insect-heal', id => registry.getStatus(id));
  assert.equal(settled.state.units['blue-2'].statuses.some(status => status.statusId === 'test.insect-debuff'), false);
  assert.equal(settled.events.find(event => event.type === 'healing' && event.targetId === 'blue-2').requestedAmount, 1200,
    '被驱散目标按等级减少20%治疗');
  assert.equal(hero.mechanicsCoverage, 'partial');
});

test('虫师被动排除睡眠，但眩晕等其他不能行动状态不阻止受击触发', () => {
  const registry = new ContentRegistry();
  registerInsectMaster(registry);
  const sleepId = 'test.insect-sleep';
  const stunId = 'test.insect-stun';
  for (const id of [sleepId, stunId]) registry.registerStatus({ id, category: 'control', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  const initial = state();
  const insect = { ...initial.units['blue-1'], heroId: insectMasterIds.hero };
  const attacker = initial.units['red-1'];
  const hero = registry.getHero(insectMasterIds.hero);
  const intercept = (controlId, controlType) => {
    const controlled = { ...insect, statuses: [{ instanceId: controlId, statusId: controlId,
      source: { kind: 'skill', id: 'test.control', unitId: attacker.unitId }, stacks: 1,
      duration: { kind: 'permanent' }, values: { controlType } }] };
    const current = { ...initial, units: { ...initial.units, [insect.unitId]: controlled } };
    return hero.interceptIncomingDamage(current, attacker, controlled, 100, 'normal', { attackId: 20, hitIndex: 1,
      battle: createBattleContext(current, () => .99, id => registry.getStatus(id)?.category,
        id => registry.getStatus(id)?.dispellable === true), isUnitUnableToAct: () => true });
  };
  assert.equal(intercept(sleepId, '睡眠'), undefined);
  assert.ok(intercept(stunId, '眩晕'), '受击被动不应把睡眠条件扩大成所有行动限制控制');
});

test('乱斗点数按 HERO_MAKE 八槽换算，并可选地附加到现有面板', () => {
  const panel = { hp: 10000, attack: 1000, defense: 500, speed: 120, crit: .1, critDamage: 1.5, hit: 0, resist: 0 };
  const battle = createBattleState({ blue: [{ heroId: 247, fourSuit: '', skillLevel: 1, panel,
    points: [1, 1, 1, 1, 1, 1, 1, 1] }], red: [] });
  const unit = Object.values(battle.units)[0];
  const { battleMaxHp } = require('../dist-test-renderer/renderer/features/duel/engine/mechanics/battle-hp.js');
  assert.equal(unit.stats.hp, battleMaxHp(10500).maxHp,
    '点数加到选卡面板后，使用统一入口换算战斗生命');
  assert.equal(unit.stats.attack, 1060);
  assert.equal(unit.stats.defense, 535);
  assert.equal(unit.stats.speed, 126);
  assert.ok(Math.abs(unit.stats.crit - .15) < 1e-12);
  assert.ok(Math.abs(unit.stats.critDamage - 1.57) < 1e-12);
  assert.equal(unit.stats.hit, .06);
  assert.equal(unit.stats.resist, .08);
  assert.equal(createBattleState({ blue: [{ heroId: 247, fourSuit: '', skillLevel: 1, panel }], red: [] })
    .units['blue:1:247'].stats.attack, 1000, '未提供点数时保持既有阵容面板');
  assert.equal(createBattleState({ blue: [{ heroId: 247, fourSuit: '', skillLevel: 1, panel,
    points: [999, 0, 0, 0, 0, 0, 0, 0] }], red: [] }).units['blue:1:247'].stats.attack, 2800,
  '攻击点数按 HERO_MAKE 上限30截断');
});

test('荒骷髅黄泉战旗三项实战数字校准对局生命换算', () => {
  const panel = { hp: 28171, attack: 3001, defense: 545, speed: 208, crit: .03, critDamage: 1.5, hit: 0, resist: .56 };
  const initial = createBattleState({
    blue: [{ heroId: skullGeneralIds.hero, fourSuit: '', skillLevel: 5, panel }],
    red: [{ heroId: 1, fourSuit: '', skillLevel: 1,
      panel: { hp: 100000, attack: 1, defense: 0, speed: 1, crit: 0, critDamage: 1.5, hit: 0, resist: 0 } }],
  });
  const registry = new ContentRegistry();
  registerSkullGeneral(registry);
  const result = runBattle(initial, registry, { seed: 31, actionLimit: 1 });
  const skullId = 'blue:1:585';
  const selfLoss = result.events.find(event => event.type === 'life-lost' && event.targetId === skullId
    && event.source.id === skullGeneralIds.banner);
  const hits = result.events.filter(event => event.type === 'damage' && event.source.id === skullGeneralIds.banner);
  assert.equal(Math.trunc(selfLoss.amount), 20452, '30% self-loss matches frame 000401');
  assert.deepEqual(hits.map(event => Math.trunc(event.amount)), [1636, 6135],
    '8% and 30% damage match frames 000421 and 000441');
});

test('模块化动作按技能自身等级选择资源费用和等级参数', () => {
  const registry = new ContentRegistry();
  registry.registerHero({ id: 777, skills: [{ id: '7771', actionKind: 'skill', target: 'single', targetRelation: 'enemy',
    resourceCostsByLevel: [1, 2, 3, 4, 5].map(amount => ({ resourceId: 'fire', amount })),
    levels: [10, 20, 30, 40, 50].map(amount => ({ amount })),
    execute(_context, intent, params) { return [{ type: 'deal-damage', source: { kind: 'skill', id: '7771', unitId: intent.actorId },
      targetId: intent.targetIds[0], amount: params.amount, precalculated: true }]; } }] });
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: 777, skillLevel: 5, skillLevels: { '7771': 2 } };
  initial.units['red-1'] = { ...initial.units['red-1'], shield: 0 };
  initial.resources.blue.fire = 2;
  const result = executeAction(initial, { actorId: 'blue-1', skillId: '7771', targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' },
    registry, () => .5);
  assert.equal(result.accepted, true, '2火足够支付2级费用，而不应按全局5级要求5火');
  assert.equal(result.state.resources.blue.fire, 0);
  assert.equal(result.state.units['red-1'].hp, 40, '伤害参数使用该技能2级的20点');
});

test('导入的客户端战斗数据快照保留预期表覆盖和来源行数', () => {
  const data = JSON.parse(readFileSync(join(__dirname, '../src/shared/game-battle-data.generated.json'), 'utf8'));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.source.rowCounts.heroes, data.heroes.length);
  assert.equal(data.source.rowCounts.buffs, data.buffs.length);
  assert.ok(data.heroes.length >= 1000);
  assert.ok(data.buffs.length >= 7000);
  assert.equal(data.source.rowCounts.souls, 70);
  assert.equal(data.heroMake.length, 8);
  assert.equal(data.constants.DEFENSE_CORRECT_FACTOR, 300);
  assert.equal(data.heroes.find(hero => hero.id === 600)?.name, '市加美');
});

test('PvP 式神阵亡补1火并尊重8火上限，召唤物阵亡不触发', () => {
  const initial = createBattleState({ blue: [{ heroId: 247, fourSuit: '', skillLevel: 1, panel: null }], red: [] });
  const unit = Object.values(initial.units)[0];
  const defeat = { eventId: 'test-defeat', phase: 'unit-defeated', source: { kind: 'system', id: 'test' },
    type: 'unit-defeated', unitId: unit.unitId };
  const run = state => {
    const dispatcher = new EventDispatcher();
    registerPvpRules(dispatcher);
    return settleEvents(state, [defeat], dispatcher, () => .5).state;
  };
  const atFourFire = { ...initial, units: { ...initial.units, [unit.unitId]: { ...unit, hp: 0 } } };
  assert.equal(run(atFourFire).resources.blue.fire, 5);
  const atCap = { ...atFourFire, resources: { ...atFourFire.resources, blue: { fire: 8 } } };
  assert.equal(run(atCap).resources.blue.fire, 8);
  const summon = { ...atFourFire, units: { ...atFourFire.units,
    [unit.unitId]: { ...atFourFire.units[unit.unitId], unitKind: 'summon' } } };
  assert.equal(run(summon).resources.blue.fire, 4);
});

test('市加美寂灭按初始攻击治疗，并分别叠加幻花和花祓', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const actor = initial.units['blue-1'];
  initial.units['blue-1'] = { ...actor, heroId: shikagamiCityIds.hero, skillLevel: 5, hp: 80,
    stats: { ...actor.stats, hp: 100, attack: 1000 }, statuses: [{ instanceId: 'existing-flower',
      statusId: shikagamiCityIds.flower, source: { kind: 'skill', id: shikagamiCityIds.stance, unitId: actor.unitId },
      stacks: 4, duration: { kind: 'permanent' } }] };
  const hero = registry.getHero(shikagamiCityIds.hero);
  const skill = hero.skills.find(item => item.id === shikagamiCityIds.ultimate);
  const commands = skill.execute(createBattleContext(initial, () => .5, id => registry.getStatus(id)?.category),
    { actorId: actor.unitId, skillId: skill.id, targetIds: [actor.unitId], shape: 'all-allies', targetRelation: 'ally' }, skill.levels[4]);
  assert.equal(commands.find(command => command.type === 'heal').amount, 1300);
  const applied = applyEffectCommands(initial, commands.filter(command => command.type === 'add-status'), 'effect-resolution', 'city-test',
    id => registry.getStatus(id));
  const statuses = applied.state.units[actor.unitId].statuses;
  assert.equal(statuses.find(status => status.statusId === shikagamiCityIds.illusionFlower).stacks, 2);
  assert.equal(statuses.find(status => status.statusId === shikagamiCityIds.flower).stacks, 5);
});

test('市加美垂悯形态的速度增益存在时即使队友满血也优先施放寂灭现前', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const actor = initial.units['blue-1'];
  initial.units[actor.unitId] = { ...actor, heroId: shikagamiCityIds.hero, statuses: [
    { instanceId: 'speed', statusId: shikagamiCityIds.speed, source: { kind: 'skill', id: shikagamiCityIds.stance,
      unitId: actor.unitId }, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } },
  ] };
  const intent = registry.getHero(shikagamiCityIds.hero).policy(createBattleContext(initial, () => .5), actor.unitId);
  assert.equal(intent.skillId, shikagamiCityIds.ultimate);
  assert.deepEqual(intent.targetIds, [actor.unitId]);
});

test('市加美初始化、普攻加花和三技能减火分别读取对应技能等级', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const actor = { ...initial.units['blue-1'], heroId: shikagamiCityIds.hero, skillLevel: 1,
    skillLevels: { [shikagamiCityIds.basic]: 1, [shikagamiCityIds.stance]: 5, [shikagamiCityIds.ultimate]: 2 } };
  initial.units[actor.unitId] = actor;
  const hero = registry.getHero(shikagamiCityIds.hero);
  const initialized = applyEffectCommands(initial, hero.initialize(createBattleContext(initial, () => .5), actor.unitId),
    'battle-start', 'city-skill-ranks', id => registry.getStatus(id));
  assert.equal(initialized.state.units[actor.unitId].statuses.find(status => status.statusId === shikagamiCityIds.flower).stacks, 2);
  assert.equal(hero.skills.find(skill => skill.id === shikagamiCityIds.ultimate).resolveResourceCost(initial, actor).amount, 2);
  const basic = hero.skills.find(skill => skill.id === shikagamiCityIds.basic);
  const basicCommands = basic.execute(createBattleContext(initialized.state, () => .5),
    { actorId: actor.unitId, skillId: basic.id, targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, basic.levels[0]);
  assert.equal(basicCommands.some(command => command.type === 'add-status' && command.instance.statusId === shikagamiCityIds.flower), false);
});

test('市加美垂悯之刃按是否觉醒获得对应防御加成', () => {
  const registry = createMigratedContentRegistry();
  const hero = registry.getHero(shikagamiCityIds.hero);
  for (const [awakeFilter, expectedDefense] of [[0, 300], [1, 450]]) {
    const initial = state();
    const actor = { ...initial.units['blue-1'], heroId: shikagamiCityIds.hero, awakeFilter,
      skillLevels: { [shikagamiCityIds.stance]: 2 } };
    initial.units[actor.unitId] = actor;
    const commands = hero.initialize(createBattleContext(initial, () => .5), actor.unitId);
    const initialized = applyEffectCommands(initial, commands, 'battle-start', `city-awake-${awakeFilter}`,
      id => registry.getStatus(id));
    assert.equal(effectiveStats(initialized.state.units[actor.unitId]).defense, expectedDefense);
  }
});

test('市加美花祓惩戒敌方式神回合外行动，技能行动后进入虚妄迷障', () => {
  const registry = createMigratedContentRegistry();
  const city = registry.getHero(shikagamiCityIds.hero);
  const enemySkill = { id: 'test.enemy-paid-skill', actionKind: 'skill', resourceCost: { resourceId: 'fire', amount: 1 },
    target: 'self', targetRelation: 'ally', levels: [{}], execute: () => [] };
  registry.registerHero({ id: 9999, skills: [enemySkill], mechanicsCoverage: 'verified', aiCoverage: 'verified' });
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: shikagamiCityIds.hero, unitKind: 'shikigami', skillLevel: 1,
    skillLevels: { [shikagamiCityIds.stance]: 4, [shikagamiCityIds.basic]: 1, [shikagamiCityIds.ultimate]: 1 },
    statuses: [
      { instanceId: 'city-unique', statusId: shikagamiCityIds.unique,
        source: { kind: 'skill', id: shikagamiCityIds.stance, unitId: 'blue-1' }, stacks: 1, duration: { kind: 'permanent' } },
      { instanceId: 'city-flower', statusId: shikagamiCityIds.flower,
        source: { kind: 'skill', id: shikagamiCityIds.stance, unitId: 'blue-1' }, stacks: 2, duration: { kind: 'permanent' } },
    ] };
  initial.units['red-1'] = { ...initial.units['red-1'], heroId: 9999, unitKind: 'shikigami' };
  initial.resources.red.fire = 8;
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'hero:600:action-end', phase: 'action-end', priority: city.handlers['action-end'].priority,
    handle: city.handlers['action-end'].handle });
  const intent = { actorId: 'red-1', skillId: enemySkill.id, targetIds: ['red-1'], shape: 'self', targetRelation: 'ally' };

  const offTurn = executeAction(initial, intent, registry, () => .5, { dispatcher, resolveStatus: id => registry.getStatus(id), scheduling: 'assist' });
  assert.equal(offTurn.events.find(event => event.type === 'action-ended').scheduling, 'assist');
  assert.equal(offTurn.state.units['blue-1'].statuses.find(status => status.statusId === shikagamiCityIds.flower).stacks, 1);
  assert.equal(offTurn.state.units['blue-1'].statuses.find(status => status.statusId === shikagamiCityIds.illusionFlower).stacks, 1);
  assert.ok(offTurn.state.units['red-1'].statuses.some(status => status.statusId === shikagamiCityIds.trapped));

  const afterMarkedSkill = executeAction(offTurn.state, intent, registry, () => .5, { dispatcher,
    resolveStatus: id => registry.getStatus(id) });
  const maze = afterMarkedSkill.state.units['red-1'].statuses.find(status => status.statusId === shikagamiCityIds.illusion);
  assert.equal(maze.duration.remaining, 2);
  assert.ok(Math.abs(effectiveDamageTakenMultiplier(afterMarkedSkill.state.units['red-1']) - .15) < 1e-9);
  assert.equal(registry.getStatus(shikagamiCityIds.illusion).modifyResourceCost(afterMarkedSkill.state,
    afterMarkedSkill.state.units['red-1'], enemySkill, { resourceId: 'fire', amount: 1 }), 4);
  assert.equal(afterMarkedSkill.state.units['red-1'].statuses.some(status => status.statusId === shikagamiCityIds.trapped), false);
  const readyToCast = { ...afterMarkedSkill.state, resources: { ...afterMarkedSkill.state.resources,
    red: { ...afterMarkedSkill.state.resources.red, fire: 8 } } };
  const charged = executeAction(readyToCast, intent, registry, () => .5, { dispatcher, resolveStatus: id => registry.getStatus(id) });
  const payment = charged.events.find(event => event.type === 'resource-changed' && event.phase === 'resource-payment');
  assert.equal(payment.before - payment.after, 4, '虚妄迷障期间实际支付应增加3点鬼火');

  const implicitSkill = { id: 'test.enemy-default-skill', resourceCost: { resourceId: 'fire', amount: 1 },
    target: 'self', targetRelation: 'ally', levels: [{}], execute: () => [] };
  registry.registerHero({ id: 9998, skills: [implicitSkill], mechanicsCoverage: 'verified', aiCoverage: 'verified' });
  const implicitState = { ...readyToCast, units: { ...readyToCast.units,
    'red-1': { ...readyToCast.units['red-1'], heroId: 9998 } } };
  const implicit = executeAction(implicitState, { ...intent, skillId: implicitSkill.id }, registry, () => .5,
    { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(implicit.events.find(event => event.type === 'action-ended').actionKind, 'skill');
  const implicitPayment = implicit.events.find(event => event.type === 'resource-changed' && event.phase === 'resource-payment');
  assert.equal(implicitPayment.before - implicitPayment.after, 4,
    '未显式声明 actionKind 的技能仍按引擎默认妖术类型触发虚妄迷障费用');

  const extraTurn = executeAction(initial, intent, registry, () => .5, { dispatcher,
    resolveStatus: id => registry.getStatus(id), scheduling: 'extra-turn' });
  assert.equal(extraTurn.state.units['blue-1'].statuses.find(status => status.statusId === shikagamiCityIds.flower).stacks, 2,
    '额外回合不触发花祓惩戒');
  assert.equal(extraTurn.state.units['red-1'].statuses.some(status => status.statusId === shikagamiCityIds.trapped), false);
});

test('市加美幻花累计达到3层解锁断罪之刃，断罪三技能攻击指定目标及生命最低的两名敌人', () => {
  const registry = createMigratedContentRegistry();
  const city = registry.getHero(shikagamiCityIds.hero);
  const initial = state();
  const permanent = id => ({ instanceId: id, statusId: id, source: { kind: 'skill', id: shikagamiCityIds.stance, unitId: 'blue-1' },
    stacks: 1, duration: { kind: 'permanent' } });
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: shikagamiCityIds.hero, unitKind: 'shikigami', skillLevel: 5,
    stats: { ...initial.units['blue-1'].stats, attack: 1000, defense: 500, crit: 0 }, statuses: [
      permanent(shikagamiCityIds.unique), permanent(shikagamiCityIds.mercy),
      { ...permanent(shikagamiCityIds.flower), stacks: 1 },
      { ...permanent(shikagamiCityIds.illusionFlower), stacks: 2 },
    ] };
  initial.units['red-1'] = { ...initial.units['red-1'], heroId: 1, unitKind: 'shikigami', hp: 800,
    stats: { ...initial.units['red-1'].stats, hp: 1000, defense: 500 } };
  initial.units['red-2'] = { ...initial.units['red-1'], unitId: 'red-2', hp: 600, statuses: [
    { ...permanent(shikagamiCityIds.illusion), instanceId: 'maze-on-red-2', source: { kind: 'skill', id: 'test', unitId: 'blue-1' },
      modifiers: [{ stat: 'damageTaken', operation: 'percent', amount: -.85 }] },
  ] };
  initial.units['red-3'] = { ...initial.units['red-1'], unitId: 'red-3', hp: 200, statuses: [] };
  initial.sides = { blue: ['blue-1'], red: ['red-1', 'red-2', 'red-3'] };
  const unlockEvent = { type: 'action-ended', eventId: 'enemy-assist', phase: 'action-end', source: { kind: 'skill', id: 'assist', unitId: 'red-1' },
    actionKind: 'basic', actionId: 1, scheduling: 'assist' };
  const context = createBattleContext(initial, () => .9, id => registry.getStatus(id)?.category);
  const commands = city.handlers['action-end'].handle(context, unlockEvent);
  const unlocked = applyEffectCommands(initial, commands, 'action-end', unlockEvent.eventId, id => registry.getStatus(id));
  const owner = unlocked.state.units['blue-1'];
  assert.equal(owner.statuses.find(status => status.statusId === shikagamiCityIds.illusionFlower).stacks, 3);
  assert.equal(owner.statuses.some(status => status.statusId === shikagamiCityIds.mercy), false);
  const guilt = owner.statuses.find(status => status.statusId === shikagamiCityIds.guilt);
  assert.equal(guilt.modifiers.find(modifier => modifier.stat === 'crit').amount, .5);
  assert.equal(guilt.modifiers.find(modifier => modifier.stat === 'defenseIgnore').amount, 350);

  const ultimate = city.skills.find(skill => skill.id === shikagamiCityIds.ultimate);
  assert.equal(ultimate.levels[2].mazeDefenseIgnore, 50, '大招三级起迷障增伤额外无视50防御');
  assert.equal(ultimate.levels[4].mazeDefenseIgnore, 150, '大招五级迷障增伤合计额外无视150防御');
  const attackCommands = ultimate.execute(createBattleContext(unlocked.state, () => .9, id => registry.getStatus(id)?.category),
    { actorId: 'blue-1', skillId: ultimate.id, targetIds: ['red-1'], shape: 'multi', targetRelation: 'enemy' }, ultimate.levels[4]);
  assert.deepEqual(attackCommands.filter(command => command.type === 'deal-damage').map(command => command.targetId),
    ['red-1', 'red-3', 'red-2']);
  const damage = attackCommands.filter(command => command.type === 'deal-damage');
  assert.ok(damage[2].amount > damage[0].amount * 1.3,
    '五级断罪刀攻击虚妄迷障目标时，额外提高30%伤害并无视150防御');

  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'hero:600:action-end', phase: 'action-end', priority: city.handlers['action-end'].priority,
    handle: city.handlers['action-end'].handle });
  const intent = { actorId: 'blue-1', skillId: ultimate.id, targetIds: ['red-1'], shape: 'multi', targetRelation: 'enemy' };
  const executed = executeAction(unlocked.state, intent, registry, () => .9, { dispatcher,
    resolveStatus: id => registry.getStatus(id) });
  assert.equal(executed.accepted, true, '断罪形态的技能接受敌方目标意图');
  assert.deepEqual(executed.events.filter(event => event.type === 'damage' && event.source.id === ultimate.id)
    .map(event => event.targetId), ['red-1', 'red-3', 'red-2']);
  const payment = executed.events.find(event => event.type === 'resource-changed' && event.phase === 'resource-payment');
  assert.equal(payment.before - payment.after, 3, '断罪形态不享受垂悯形态的减火效果');
});

test('市加美回合结束获得1层幻花，并在第3层切换为断罪之刃', () => {
  const registry = createMigratedContentRegistry();
  const city = registry.getHero(shikagamiCityIds.hero);
  const initial = state();
  const source = { kind: 'skill', id: shikagamiCityIds.stance, unitId: 'blue-1' };
  const status = (statusId, stacks = 1) => ({ instanceId: statusId, statusId, source, stacks,
    duration: { kind: 'permanent' } });
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: shikagamiCityIds.hero,
    statuses: [status(shikagamiCityIds.unique), status(shikagamiCityIds.mercy), status(shikagamiCityIds.illusionFlower, 2)] };
  const event = { type: 'turn-ended', eventId: 'city-turn-end', phase: 'turn-end', source,
    unitId: 'blue-1', actionId: 1 };
  const context = createBattleContext(initial, () => .5, id => registry.getStatus(id)?.category);
  const commands = city.handlers['turn-end'].handle(context, event);
  const result = applyEffectCommands(initial, commands, 'turn-end', event.eventId, id => registry.getStatus(id));
  const owner = result.state.units['blue-1'];
  assert.equal(owner.statuses.find(status => status.statusId === shikagamiCityIds.illusionFlower).stacks, 3);
  assert.ok(owner.statuses.some(status => status.statusId === shikagamiCityIds.guilt));
  assert.equal(owner.statuses.some(status => status.statusId === shikagamiCityIds.mercy), false);
  assert.ok(result.events.every(item => item.parentEventId === event.eventId), '被动增层和形态切换应关联回合结束事件');

  const battleState = state();
  battleState.units['blue-1'] = { ...battleState.units['blue-1'], heroId: shikagamiCityIds.hero,
    stats: { ...battleState.units['blue-1'].stats, speed: 200 }, statuses: [
      status(shikagamiCityIds.unique), status(shikagamiCityIds.mercy), status(shikagamiCityIds.illusionFlower, 2),
    ] };
  battleState.units['red-1'] = { ...battleState.units['red-1'], stats: { ...battleState.units['red-1'].stats, speed: 1 } };
  battleState.counters = { ...battleState.counters, action: 0, attack: 0, hit: 0 };
  const battle = runBattle(battleState, registry, { seed: 3, actionLimit: 1 });
  assert.ok(battle.events.some(item => item.type === 'status-added' && item.instance.statusId === shikagamiCityIds.guilt
    && item.parentEventId === 'turn-1-end'), '整场调度应在市加美自身回合结束时触发形态切换');
  assert.ok(battle.state.units['blue-1'].statuses.some(item => item.statusId === shikagamiCityIds.guilt));
});

test('千姬悲歌回合增长按单层递增，不在效果结算时重复叠加', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const actor = initial.units['blue-1'];
  initial.units['blue-1'] = { ...actor, heroId: chihimeIds.hero, statuses: [
    { instanceId: 'halberd', statusId: chihimeIds.halberd, source: { kind: 'skill', id: '3563', unitId: actor.unitId },
      stacks: 1, duration: { kind: 'permanent' } },
    { instanceId: 'lament', statusId: chihimeIds.lament, source: { kind: 'skill', id: '3564', unitId: actor.unitId },
      stacks: 2, duration: { kind: 'permanent' } },
  ] };
  const handler = registry.getHero(chihimeIds.hero).handlers['turn-start'].handle;
  const event = { eventId: 'turn-start-test', phase: 'turn-start', source: { kind: 'system', id: 'test' },
    type: 'turn-started', unitId: actor.unitId };
  const commands = handler(createBattleContext(initial, () => .5), event);
  assert.equal(commands[0].instance.stacks, 1);
  const applied = applyEffectCommands(initial, commands, 'turn-start', 'chihime-test', id => registry.getStatus(id));
  assert.equal(applied.state.units[actor.unitId].statuses.find(status => status.statusId === chihimeIds.lament).stacks, 3);
});

test('千姬持戟时汐梦选当前生命值最高目标，普攻优先收割低于20%生命的敌人', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const actor = initial.units['blue-1'];
  initial.units[actor.unitId] = { ...actor, heroId: chihimeIds.hero, statuses: [
    { instanceId: 'halberd', statusId: chihimeIds.halberd, source: { kind: 'skill', id: chihimeIds.summon, unitId: actor.unitId },
      stacks: 1, duration: { kind: 'permanent' } },
  ] };
  const injured = { ...initial.units['red-1'], hp: 15, stats: { ...initial.units['red-1'].stats, hp: 100 } };
  const healthy = { ...initial.units['red-1'], unitId: 'red-2', hp: 80, stats: { ...initial.units['red-1'].stats, hp: 100 } };
  initial.units['red-1'] = injured;
  initial.units[healthy.unitId] = healthy;
  initial.sides.red.push(healthy.unitId);
  const hero = registry.getHero(chihimeIds.hero);
  const dream = hero.policy(createBattleContext(initial, () => .5), actor.unitId);
  assert.equal(dream.skillId, chihimeIds.dream);
  assert.deepEqual(dream.targetIds, [healthy.unitId]);
  initial.resources.blue.fire = 0;
  const basic = hero.policy(createBattleContext(initial, () => .5), actor.unitId);
  assert.equal(basic.skillId, chihimeIds.basic);
  assert.deepEqual(basic.targetIds, [injured.unitId]);
});

test('千姬在非召唤物敌方回合结束时推进10点行动条', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const actor = initial.units['blue-1'];
  initial.units[actor.unitId] = { ...actor, heroId: chihimeIds.hero };
  const handler = registry.getHero(chihimeIds.hero).handlers['turn-end'].handle;
  const event = { eventId: 'enemy-turn-end', phase: 'turn-end', source: { kind: 'unit', id: '1', unitId: 'red-1' },
    type: 'turn-ended', unitId: 'red-1' };
  const commands = handler(createBattleContext(initial, () => .5), event);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].targetId, actor.unitId);
  assert.equal(commands[0].amount, 10);
  const summonState = { ...initial, units: { ...initial.units, 'red-1': { ...initial.units['red-1'], unitKind: 'summon' } } };
  assert.deepEqual(handler(createBattleContext(summonState, () => .5), event) ?? [], []);
});

test('千姬持戟时敌方式神首次施放妖术推进30点行动条，之后不再触发', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const actor = initial.units['blue-1'];
  initial.units[actor.unitId] = { ...actor, heroId: chihimeIds.hero, skillLevels: { [chihimeIds.summon]: 4 } };
  const hero = registry.getHero(chihimeIds.hero);
  const initialized = hero.initialize(createBattleContext(initial, () => .5), actor.unitId);
  const ready = applyEffectCommands(initial, initialized, 'battle-start', 'chihime-first-skill-init', id => registry.getStatus(id)).state;
  const summon = hero.skills.find(skill => skill.id === chihimeIds.summon);
  const summonCommands = summon.execute(createBattleContext(ready, () => .5),
    { actorId: actor.unitId, skillId: summon.id, targetIds: [actor.unitId], shape: 'self', targetRelation: 'ally' }, summon.levels[3]);
  const held = applyEffectCommands(ready, summonCommands, 'action-start', 'chihime-first-skill-summon', id => registry.getStatus(id)).state;
  const handler = hero.handlers['action-end'].handle;
  const skillEvent = { eventId: 'enemy-first-skill-end', actionId: 1, phase: 'action-end',
    source: { kind: 'skill', id: 'enemy.skill', unitId: 'red-1' }, type: 'action-ended', actionKind: 'skill',
    skillId: 'enemy.skill', soulTriggersAllowed: true };
  const first = handler(createBattleContext(held, () => .5), skillEvent);
  assert.deepEqual(first.map(command => command.type), ['add-status', 'change-action-gauge']);
  assert.equal(first[1].amount, 30);
  const applied = applyEffectCommands(held, first, 'action-end', skillEvent.eventId, id => registry.getStatus(id));
  assert.equal(applied.state.units[actor.unitId].actionGauge, held.units[actor.unitId].actionGauge + 30);
  assert.deepEqual(handler(createBattleContext(applied.state, () => .5), { ...skillEvent, eventId: 'enemy-second-skill-end', actionId: 2 }) ?? [], [],
    '一次性触发标记保留至战斗结束');
  const defeatedEnemy = { ...held, units: { ...held.units, 'red-1': { ...held.units['red-1'], hp: 0 } } };
  assert.equal(handler(createBattleContext(defeatedEnemy, () => .5), skillEvent).length, 2,
    '敌方式神施放妖术后即使在行动结束前阵亡，已触发的效果仍结算');
  assert.deepEqual(handler(createBattleContext(ready, () => .5), skillEvent) ?? [], [], '海原贝戟不在场时不触发');
  assert.deepEqual(handler(createBattleContext(held, () => .5), { ...skillEvent, actionKind: 'basic' }) ?? [], [], '敌方普攻不触发');
});

test('千姬四级持戟时免疫控制，召唤后免疫移除并获得减伤，释放后恢复免疫', () => {
  const registry = createMigratedContentRegistry();
  registry.registerStatus({ id: 'test.chihime-exile', mechanicsCoverage: 'verified', category: 'control', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace', preventsAction: true });
  const initial = state();
  const actor = initial.units['blue-1'];
  initial.units[actor.unitId] = { ...actor, heroId: chihimeIds.hero, skillLevel: 1,
    skillLevels: { [chihimeIds.summon]: 4 } };
  const hero = registry.getHero(chihimeIds.hero);
  const initialized = hero.initialize(createBattleContext(initial, () => .5), actor.unitId);
  const held = applyEffectCommands(initial, initialized, 'battle-start', 'chihime-held-test', id => registry.getStatus(id));
  assert.ok(held.state.units[actor.unitId].statuses.some(status => status.statusId === chihimeIds.halberdImmunity));
  const exile = { type: 'apply-control', source: { kind: 'skill', id: 'test.exile', unitId: 'red-1' }, targetId: actor.unitId,
    instance: { instanceId: 'exile-on-held', statusId: 'test.chihime-exile', source: { kind: 'skill', id: 'test.exile', unitId: 'red-1' },
      stacks: 1, duration: { kind: 'permanent' }, values: { controlType: '放逐' } } };
  const blockedExile = applyEffectCommands(held.state, [exile], 'control-application', 'chihime-exile-held', id => registry.getStatus(id));
  assert.ok(blockedExile.events.some(event => event.type === 'control-blocked' && event.blockReason === 'protection'));
  assert.equal(blockedExile.state.units[actor.unitId].statuses.some(status => status.statusId === 'test.chihime-exile'), false);
  const summon = hero.skills.find(item => item.id === chihimeIds.summon);
  const statusCommands = summon.execute(createBattleContext(held.state, () => .5),
    { actorId: actor.unitId, skillId: summon.id, targetIds: [actor.unitId], shape: 'self', targetRelation: 'ally' }, summon.levels[3]);
  const applied = applyEffectCommands(held.state, statusCommands, 'effect-resolution', 'chihime-halberd-test', id => registry.getStatus(id));
  const statuses = applied.state.units[actor.unitId].statuses;
  assert.equal(effectiveDamageTakenMultiplier(applied.state.units[actor.unitId]), .7);
  assert.ok(statuses.every(status => status.statusId !== chihimeIds.halberdImmunity));
  assert.equal(registry.getStatus(chihimeIds.halberdImmunity).controlProtection, 'immune');
  const summonUnit = Object.values(applied.state.units).find(unit => unit.unitKind === 'summon' && unit.summonedByUnitId === actor.unitId);
  assert.ok(summonUnit);
  assert.equal(summonUnit.stats.hp, actor.stats.attack * 5.5);
  assert.equal(summonUnit.stats.defense, actor.stats.defense);
  assert.equal(summonUnit.stats.speed, 0);
  assert.equal(effectiveDamageTakenMultiplier(summonUnit), .7);
  assert.equal(registry.getStatus(chihimeIds.halberdProtection).controlProtection, 'immune');
  assert.equal(registry.getStatus(chihimeIds.halberdProtection).statusImmunity, 'debuffs');
  const release = hero.skills.find(item => item.id === chihimeIds.release);
  const cleanup = release.execute(createBattleContext(applied.state, () => .5),
    { actorId: actor.unitId, skillId: release.id, targetIds: ['red-1'], shape: 'all-enemies', targetRelation: 'enemy' }, release.levels[3]);
  const after = applyEffectCommands(applied.state, cleanup.filter(command => command.type === 'lose-life'),
    'effect-resolution', 'chihime-release-test', id => registry.getStatus(id));
  const defeated = after.events.find(event => event.type === 'unit-defeated');
  assert.ok(defeated);
  const returnCommands = hero.handlers['unit-defeated'].handle(createBattleContext(after.state, () => .5), defeated);
  const returned = applyEffectCommands(after.state, returnCommands,
    'effect-resolution', 'chihime-return-test', id => registry.getStatus(id));
  assert.ok(returned.state.units[actor.unitId].statuses.every(status => status.statusId !== chihimeIds.halberd
    ));
  assert.ok(returned.state.units[actor.unitId].statuses.some(status => status.statusId === chihimeIds.halberdImmunity));
  assert.equal(returned.state.units[summonUnit.unitId].statuses.some(status => status.statusId === chihimeIds.halberdProtection), false);
});

test('千姬海原贝戟按受击目标恢复生命，普通友方为实际损失的30%', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const actor = { ...initial.units['blue-1'], heroId: chihimeIds.hero, skillLevel: 3 };
  initial.units[actor.unitId] = actor;
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', hp: 500,
    stats: { ...initial.units['blue-1'].stats, hp: 1000 } };
  initial.sides.blue = [...initial.sides.blue, 'blue-2'];
  const hero = registry.getHero(chihimeIds.hero);
  const summonSkill = hero.skills.find(item => item.id === chihimeIds.summon);
  const summonCommands = summonSkill.execute(createBattleContext(initial, () => .5),
    { actorId: actor.unitId, skillId: summonSkill.id, targetIds: [actor.unitId], shape: 'self', targetRelation: 'ally' },
    summonSkill.levels[2]);
  const summoned = applyEffectCommands(initial, summonCommands, 'effect-resolution', 'chihime-heal-summon', id => registry.getStatus(id));
  const handler = hero.handlers.hit.handle;
  const hit = { eventId: 'ally-damaged', phase: 'hit', source: { kind: 'skill', id: 'enemy.skill', unitId: 'red-1' },
    type: 'damage', targetId: 'blue-2', damageKind: 'normal', amount: 150, hpLost: 100, mitigated: 50, isCritical: false };
  const recovery = handler(createBattleContext(summoned.state, () => .5), hit);
  assert.equal(recovery.length, 1);
  assert.equal(recovery[0].type, 'restore-health');
  assert.equal(recovery[0].amount, 30);
  assert.equal(recovery[0].targetId, 'blue-2');
  assert.equal(recovery[0].parentEventId, hit.eventId);
  assert.deepEqual(handler(createBattleContext(summoned.state, () => .5), { ...hit, hpLost: 0 }) ?? [], []);
});

test('千姬的真实战斗首动召唤海原贝戟，零速度召唤物不占用行动', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  initial.counters = { ...initial.counters, action: 0 };
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: chihimeIds.hero, skillLevel: 5,
    stats: { ...initial.units['blue-1'].stats, speed: 200 } };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, speed: 50 } };
  const result = runBattle(initial, registry, { seed: 356, actionLimit: 1 });
  const summoned = result.events.find(event => event.type === 'unit-summoned');
  assert.ok(summoned, JSON.stringify(result.events.map(event => [event.type, event.phase, event.skillId, event.reason, event.unitId])));
  assert.equal(summoned.ownerUnitId, 'blue-1');
  assert.ok(result.state.units[summoned.unitId].hp > 0);
  assert.equal(result.state.units[summoned.unitId].stats.speed, 0);
  assert.equal(result.events.some(event => event.type === 'turn-started' && event.unitId === summoned.unitId), false);
  assert.equal(result.reason, 'action-limit');

  const panel = { hp: 1000, attack: 100, defense: 100, speed: 200, crit: 0, critDamage: 1.5, hit: 0, resist: 0 };
  const log = simulateBattleSampleDetails({ blue: [{ heroId: chihimeIds.hero, fourSuit: '', skillLevel: 5, panel }],
    red: [{ heroId: 203, fourSuit: '', skillLevel: 1, panel: { ...panel, speed: 50 } }] }, 0).sampleLog;
  assert.ok(log.some(line => line.includes('召唤了蓝方·海原贝戟')));
  assert.ok(log.every(line => !line.includes('summon:chihime:')));
});

test('千姬五级召唤获得3层汐梦，持戟时队友消耗鬼火增长汐梦并在7层转为全队增伤', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const actor = initial.units['blue-1'];
  initial.units[actor.unitId] = { ...actor, heroId: chihimeIds.hero, skillLevel: 5 };
  const hero = registry.getHero(chihimeIds.hero);
  const summon = hero.skills.find(item => item.id === chihimeIds.summon);
  const intent = { actorId: actor.unitId, skillId: summon.id, targetIds: [actor.unitId], shape: 'self', targetRelation: 'ally' };
  const started = applyEffectCommands(initial, summon.execute(createBattleContext(initial, () => .5), intent, summon.levels[4]),
    'effect-resolution', 'chihime-summon-test', id => registry.getStatus(id));
  const summonedHalberdId = started.state.units[actor.unitId].statuses.find(status => status.statusId === chihimeIds.halberd).values.summonId;
  assert.equal(started.state.units[summonedHalberdId].statuses.find(status => status.statusId === chihimeIds.tideSound).stacks, 3);
  const handler = hero.handlers['resource-payment'].handle;
  const event = { eventId: 'ally-spent-fire', phase: 'resource-payment', source: { kind: 'skill', id: 'ally-skill', unitId: actor.unitId },
    type: 'resource-changed', side: 'blue', resourceId: 'fire', before: 4, after: 0 };
  const commands = handler(createBattleContext(started.state, () => .1), event);
  const applied = applyEffectCommands(started.state, commands, 'resource-payment', 'chihime-fire-test', id => registry.getStatus(id));
  const statuses = applied.state.units[actor.unitId].statuses;
  assert.equal(applied.state.units[summonedHalberdId].statuses.find(status => status.statusId === chihimeIds.tideSound).stacks, 7);
  assert.equal(statuses.find(status => status.statusId === chihimeIds.teamTideBonus).stacks, 1);
  assert.equal(applied.state.resources.blue.fire, 7);
  assert.equal(applied.events.find(item => item.type === 'status-added' && item.instance.statusId === chihimeIds.teamTideBonus).parentEventId,
    event.eventId);
  assert.equal(applied.events.find(item => item.type === 'resource-changed' && item.after > item.before).parentEventId, event.eventId);
});

test('千姬持戟汐梦在目标回合结束时消耗鬼火并于五级尝试深度冰冻', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const chihime = { ...initial.units['blue-1'], heroId: chihimeIds.hero, skillLevel: 5, statuses: [
    { instanceId: 'halberd', statusId: chihimeIds.halberd, source: { kind: 'skill', id: '3563', unitId: 'blue-1' },
      stacks: 1, duration: { kind: 'permanent' } },
  ] };
  const target = { ...initial.units['red-1'], statuses: [{ instanceId: 'tide-dream', statusId: chihimeIds.tideDream,
    source: { kind: 'skill', id: chihimeIds.dream, unitId: chihime.unitId }, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { ownerUnitId: chihime.unitId } }] };
  initial.units[chihime.unitId] = chihime;
  initial.units[target.unitId] = target;
  initial.resources.red.fire = 2;
  const event = { eventId: 'tide-dream-target-end', phase: 'turn-end', source: { kind: 'system', id: 'test' },
    type: 'turn-ended', unitId: target.unitId };
  const commands = registry.getHero(chihimeIds.hero).handlers['turn-end'].handle(createBattleContext(initial, () => .1), event);
  assert.ok(commands.some(command => command.type === 'change-resource' && command.side === 'red' && command.amount === -2));
  assert.ok(commands.some(command => command.type === 'apply-control' && command.instance.statusId === chihimeIds.deepFreeze));
});

test('御怨般若三段选中目标后再依序攻击全体一次', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const actor = initial.units['blue-1'];
  const second = { ...initial.units['red-1'], unitId: 'red-2', hp: 100, stats: { ...initial.units['red-1'].stats, hp: 100 } };
  initial.units[actor.unitId] = { ...actor, heroId: resentmentHannyaIds.hero, skillLevel: 5 };
  initial.units[second.unitId] = second;
  initial.sides.red = [...initial.sides.red, second.unitId];
  const skill = registry.getHero(resentmentHannyaIds.hero).skills.find(item => item.id === resentmentHannyaIds.ultimate);
  const commands = skill.execute(createBattleContext(initial, () => .5),
    { actorId: actor.unitId, skillId: skill.id, targetIds: ['red-1', 'red-2'], shape: 'multi', targetRelation: 'enemy' }, skill.levels[4]);
  assert.deepEqual(commands.filter(command => command.type === 'deal-damage').map(command => command.targetId),
    ['red-1', 'red-1', 'red-1', 'red-1', 'red-2']);
  assert.equal(commands.find(command => command.type === 'add-status').instance.stacks, 3);
});

test('御怨般若满级予愿必还按低血非召唤友方追加随机攻击', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const actor = initial.units['blue-1'];
  const lowAlly = { ...actor, unitId: 'blue-2', hp: 49, stats: { ...actor.stats, hp: 100 }, statuses: [] };
  initial.units[actor.unitId] = { ...actor, heroId: resentmentHannyaIds.hero, skillLevel: 5 };
  initial.units[lowAlly.unitId] = lowAlly;
  initial.sides.blue = [...initial.sides.blue, lowAlly.unitId];
  const skill = registry.getHero(resentmentHannyaIds.hero).skills.find(item => item.id === resentmentHannyaIds.ultimate);
  const commands = skill.execute(createBattleContext(initial, () => .5),
    { actorId: actor.unitId, skillId: skill.id, targetIds: ['red-1'], shape: 'multi', targetRelation: 'enemy' }, skill.levels[4]);
  assert.equal(commands.filter(command => command.type === 'deal-damage').length, 5);
  assert.ok(commands.filter(command => command.type === 'deal-damage').every(command => command.targetId === 'red-1'));
});

test('御怨般若对敌方暴击每行动最多获得一次仇恨印记', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const actor = initial.units['blue-1'];
  initial.units[actor.unitId] = { ...actor, heroId: resentmentHannyaIds.hero, skillLevel: 4 };
  const handler = registry.getHero(resentmentHannyaIds.hero).handlers.hit.handle;
  const event = { eventId: 'critical-hit', phase: 'hit', source: { kind: 'skill', id: 'enemy-skill', unitId: 'red-1' },
    actionId: 8, attackId: 3, hitIndex: 1, type: 'damage', targetId: actor.unitId, damageKind: 'normal', amount: 10,
    hpLost: 10, mitigated: 0, isCritical: true };
  const commands = handler(createBattleContext(initial, () => .79), event);
  assert.equal(commands.filter(command => command.type === 'add-status').length, 2);
  const applied = applyEffectCommands(initial, commands, 'hit', 'hannya-crit-test', id => registry.getStatus(id));
  assert.equal(applied.state.units[actor.unitId].statuses.find(status => status.statusId === resentmentHannyaIds.hateMark).stacks, 1);
  assert.deepEqual(handler(createBattleContext(applied.state, () => .5), { ...event, eventId: 'critical-hit-2' }) ?? [], []);

  const rankFourMiss = handler(createBattleContext(initial, () => .81), event);
  assert.equal(rankFourMiss.some(command => command.type === 'add-status'
    && command.instance.statusId === resentmentHannyaIds.hateMark), false, '四级应按80%概率触发');
  initial.units[actor.unitId] = { ...initial.units[actor.unitId], skillLevel: 5 };
  const rankFive = handler(createBattleContext(initial, () => .99), event);
  assert.equal(rankFive.some(command => command.type === 'add-status'
    && command.instance.statusId === resentmentHannyaIds.hateMark), true, '五级应保证触发');
});

test('御怨般若五级先机获得6层仇恨印记，普攻再加1层', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const actor = initial.units['blue-1'];
  initial.units[actor.unitId] = { ...actor, heroId: resentmentHannyaIds.hero, skillLevel: 5 };
  const hero = registry.getHero(resentmentHannyaIds.hero);
  const initializeCommands = hero.initialize(createBattleContext(initial, () => .5), actor.unitId);
  const initialized = applyEffectCommands(initial, initializeCommands, 'battle-start', 'hannya-init-test', id => registry.getStatus(id));
  assert.equal(initialized.state.units[actor.unitId].statuses.find(status => status.statusId === resentmentHannyaIds.hateMark).stacks, 6);
  const basic = hero.skills.find(item => item.id === resentmentHannyaIds.basic);
  const commands = basic.execute(createBattleContext(initialized.state, () => .5),
    { actorId: actor.unitId, skillId: basic.id, targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, basic.levels[4]);
  const applied = applyEffectCommands(initialized.state, commands.filter(command => command.type === 'add-status'),
    'effect-resolution', 'hannya-basic-mark-test', id => registry.getStatus(id));
  assert.equal(applied.state.units[actor.unitId].statuses.find(status => status.statusId === resentmentHannyaIds.hateMark).stacks, 7);
});

test('御怨般若仇恨印记逐层增加抵抗与减伤，达到9层时清除控制并推进45%行动条', () => {
  const registry = createMigratedContentRegistry();
  const controlId = 'test.hannya-control';
  registry.registerStatus({ id: controlId, category: 'control', dispellable: false, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  const initial = state();
  const actor = initial.units['blue-1'];
  initial.units[actor.unitId] = { ...actor, heroId: resentmentHannyaIds.hero, skillLevel: 5, actionGauge: 10,
    statuses: [
      { instanceId: 'hate-control', statusId: controlId, source: { kind: 'skill', id: 'test.control', unitId: 'red-1' },
        stacks: 1, duration: { kind: 'permanent' } },
      { instanceId: `${resentmentHannyaIds.hateMark}:${actor.unitId}`, statusId: resentmentHannyaIds.hateMark,
        source: { kind: 'skill', id: resentmentHannyaIds.passive, unitId: actor.unitId }, stacks: 8,
        duration: { kind: 'permanent' }, modifiers: [
          { stat: 'resist', operation: 'flat', amount: .1, perStack: true },
          { stat: 'damageTaken', operation: 'percent', amount: -.05, perStack: true },
        ] },
    ] };
  const hero = registry.getHero(resentmentHannyaIds.hero);
  const basic = hero.skills.find(item => item.id === resentmentHannyaIds.basic);
  const commands = basic.execute(createBattleContext(initial, () => .5, id => registry.getStatus(id)?.category),
    { actorId: actor.unitId, skillId: basic.id, targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, basic.levels[4]);
  const applied = applyEffectCommands(initial, commands, 'effect-resolution', 'hannya-cap-test', id => registry.getStatus(id));
  const result = applied.state.units[actor.unitId];
  assert.equal(result.statuses.find(status => status.statusId === resentmentHannyaIds.hateMark).stacks, 9);
  assert.equal(result.statuses.some(status => status.statusId === controlId), false);
  assert.equal(result.actionGauge, 55);
  assert.equal(effectiveStats(result).resist, actor.stats.resist + .9);
  assert.equal(effectiveDamageTakenMultiplier(result), .55);
});

test('御怨般若二级被动在非召唤友方式神阵亡时获得3层印记', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const actor = initial.units['blue-1'];
  const ally = { ...actor, unitId: 'blue-2', heroId: 200, skillLevel: 1, unitKind: 'shikigami', statuses: [] };
  initial.units[actor.unitId] = { ...actor, heroId: resentmentHannyaIds.hero, skillLevel: 5,
    skillLevels: { [resentmentHannyaIds.passive]: 2 } };
  initial.units[ally.unitId] = ally;
  initial.sides.blue.push(ally.unitId);
  const handler = registry.getHero(resentmentHannyaIds.hero).handlers['unit-defeated'].handle;
  const event = { eventId: 'ally-defeated', phase: 'unit-defeated', source: { kind: 'system', id: 'test' },
    type: 'unit-defeated', unitId: ally.unitId };
  const commands = handler(createBattleContext(initial, () => .5), event);
  assert.equal(commands.filter(command => command.type === 'add-status')[0].instance.stacks, 3);
  const summonEvent = { ...event, eventId: 'summon-defeated' };
  initial.units[ally.unitId] = { ...ally, unitKind: 'summon' };
  assert.deepEqual(handler(createBattleContext(initial, () => .5), summonEvent) ?? [], []);
});

test('御怨般若阵亡时清除自身结界及其鬼面和封印标记', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const owner = initial.units['blue-1'];
  const target = initial.units['red-1'];
  const otherTarget = { ...target, unitId: 'red-2', statuses: [] };
  const source = { kind: 'skill', id: resentmentHannyaIds.passive, unitId: owner.unitId };
  initial.units[owner.unitId] = { ...owner, heroId: resentmentHannyaIds.hero, hp: 0, statuses: [
    { instanceId: 'hannya-barrier', statusId: resentmentHannyaIds.sealBarrier, source, stacks: 5,
      duration: { kind: 'permanent' } },
  ] };
  initial.units[target.unitId] = { ...target, statuses: [
    { instanceId: 'owned-mask', statusId: resentmentHannyaIds.sealMask, source, stacks: 1, duration: { kind: 'permanent' } },
    { instanceId: 'owned-seal', statusId: passiveSuppressionStatusId, source, stacks: 1, duration: { kind: 'permanent' } },
    { instanceId: 'other-seal', statusId: passiveSuppressionStatusId,
      source: { kind: 'skill', id: resentmentHannyaIds.passive, unitId: 'another-hannya' }, stacks: 1,
      duration: { kind: 'permanent' } },
  ] };
  initial.units[otherTarget.unitId] = otherTarget;
  initial.sides.red.push(otherTarget.unitId);
  const event = { eventId: 'hannya-defeated', phase: 'unit-defeated', source: { kind: 'skill', id: 'test.kill' },
    type: 'unit-defeated', unitId: owner.unitId };
  const handler = registry.getHero(resentmentHannyaIds.hero).handlers['unit-defeated'].handle;
  const commands = handler(createBattleContext(initial, () => .5), event);
  assert.equal(commands.filter(command => command.type === 'remove-status-instances').length, 2);
  assert.ok(commands.every(command => command.parentEventId === event.eventId));
  const applied = applyEffectCommands(initial, commands, 'unit-defeated', 'hannya-cleanup-test', id => registry.getStatus(id));
  assert.equal(applied.state.units[owner.unitId].statuses.some(status => status.statusId === resentmentHannyaIds.sealBarrier), false);
  assert.equal(applied.state.units[target.unitId].statuses.some(status => status.instanceId === 'owned-mask'), false);
  assert.equal(applied.state.units[target.unitId].statuses.some(status => status.instanceId === 'owned-seal'), false);
  assert.equal(applied.state.units[target.unitId].statuses.some(status => status.instanceId === 'other-seal'), true);
});

test('御怨般若二级被动攻击仇恨蔓延目标每次攻击每个目标只获得1层印记', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const actor = initial.units['blue-1'];
  const target = initial.units['red-1'];
  const hannyaSource = { kind: 'skill', id: resentmentHannyaIds.passive, unitId: actor.unitId };
  initial.units[actor.unitId] = { ...actor, heroId: resentmentHannyaIds.hero, skillLevel: 1,
    skillLevels: { [resentmentHannyaIds.passive]: 1 } };
  initial.units[target.unitId] = { ...target, statuses: [{ instanceId: 'spread:blue-1', statusId: resentmentHannyaIds.hateSpread,
    source: hannyaSource, stacks: 1, duration: { kind: 'permanent' } }] };
  const hitHandler = registry.getHero(resentmentHannyaIds.hero).handlers.hit.handle;
  const hit = (eventId, attackId) => ({ eventId, phase: 'hit', source: { kind: 'skill', id: resentmentHannyaIds.basic, unitId: actor.unitId },
    type: 'damage', targetId: target.unitId, amount: 10, hpLost: 10, mitigated: 0, isCritical: false, actionId: 2, attackId });

  const rankOneCommands = hitHandler(createBattleContext(initial, () => .5), hit('rank-one-hit', 11)) ?? [];
  assert.equal(rankOneCommands.some(command => command.type === 'add-status'
    && command.instance.statusId === resentmentHannyaIds.hateMark), false);

  initial.units[actor.unitId] = { ...initial.units[actor.unitId], skillLevels: { [resentmentHannyaIds.passive]: 2 } };
  const firstHit = hit('first-multihit', 12);
  const firstCommands = hitHandler(createBattleContext(initial, () => .5), firstHit) ?? [];
  assert.equal(firstCommands.filter(command => command.type === 'add-status'
    && command.instance.statusId === resentmentHannyaIds.hateMark).length, 1);
  const afterFirstHit = applyEffectCommands(initial, firstCommands, 'effect-resolution', firstHit.eventId,
    id => registry.getStatus(id)).state;
  const secondHit = hit('second-multihit', 12);
  const secondCommands = hitHandler(createBattleContext(afterFirstHit, () => .5), secondHit) ?? [];
  assert.equal(secondCommands.some(command => command.type === 'add-status'
    && command.instance.statusId === resentmentHannyaIds.hateMark), false);

  const secondTarget = { ...afterFirstHit.units['red-1'], unitId: 'red-2', statuses: [
    { instanceId: 'spread:blue-1:red-2', statusId: resentmentHannyaIds.hateSpread,
      source: hannyaSource, stacks: 1, duration: { kind: 'permanent' } },
  ] };
  const sameAttackOtherTarget = { ...afterFirstHit, units: { ...afterFirstHit.units, [secondTarget.unitId]: secondTarget },
    sides: { ...afterFirstHit.sides, red: [...afterFirstHit.sides.red, secondTarget.unitId] } };
  const otherTargetCommands = hitHandler(createBattleContext(sameAttackOtherTarget, () => .5),
    { ...secondHit, eventId: 'same-attack-other-target', targetId: secondTarget.unitId }) ?? [];
  assert.equal(otherTargetCommands.filter(command => command.type === 'add-status'
    && command.instance.statusId === resentmentHannyaIds.hateMark).length, 1);

  const nextAttack = hit('next-attack', 13);
  const nextCommands = hitHandler(createBattleContext(afterFirstHit, () => .5), nextAttack) ?? [];
  assert.equal(nextCommands.filter(command => command.type === 'add-status'
    && command.instance.statusId === resentmentHannyaIds.hateMark).length, 1);
});

test('御怨般若消耗9层印记开启结界，敌方获得封印与可用的破阵技能', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const actor = initial.units['blue-1'];
  initial.units[actor.unitId] = { ...actor, heroId: resentmentHannyaIds.hero, skillLevel: 3,
    statuses: [{ instanceId: `marks:${actor.unitId}`, statusId: resentmentHannyaIds.hateMark,
      source: { kind: 'skill', id: resentmentHannyaIds.passive, unitId: actor.unitId }, stacks: 9,
      duration: { kind: 'permanent' }, modifiers: [
        { stat: 'resist', operation: 'flat', amount: .1, perStack: true },
        { stat: 'damageTaken', operation: 'percent', amount: -.05, perStack: true },
      ] }] };
  initial.resources.blue.fire = 0;
  const lowLevelState = { ...initial, units: { ...initial.units,
    [actor.unitId]: { ...initial.units[actor.unitId], skillLevel: 1 } } };
  const lowLevelAttempt = executeAction(lowLevelState, { actorId: actor.unitId, skillId: resentmentHannyaIds.passive,
    targetIds: [actor.unitId], shape: 'self', targetRelation: 'ally' }, registry, () => .5,
  { resolveStatus: id => registry.getStatus(id) });
  assert.equal(lowLevelAttempt.failure, 'insufficient-resource');
  const opened = executeAction(initial, { actorId: actor.unitId, skillId: resentmentHannyaIds.passive,
    targetIds: [actor.unitId], shape: 'self', targetRelation: 'ally' }, registry, () => .5,
  { resolveStatus: id => registry.getStatus(id) });
  assert.equal(opened.accepted, true);
  assert.equal(opened.state.units[actor.unitId].statuses.some(status => status.statusId === resentmentHannyaIds.hateMark), false);
  assert.equal(opened.state.units[actor.unitId].statuses.find(status => status.statusId === resentmentHannyaIds.sealBarrier).stacks, 9);
  assert.ok(opened.state.units['red-1'].statuses.some(status => status.statusId === resentmentHannyaIds.sealMask));
  assert.ok(opened.state.units['red-1'].statuses.some(status => status.statusId === passiveSuppressionStatusId));
});

test('御怨般若封印结界开放敌方破阵技能，破碎2面并在最后一面破碎后结界关闭', () => {
  const registry = createMigratedContentRegistry();
  const simulateBreaker = remainingMasks => {
    const initial = state();
    initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
    const hannya = initial.units['blue-1'];
    const breaker = initial.units['red-1'];
    initial.units[hannya.unitId] = { ...hannya, heroId: resentmentHannyaIds.hero, skillLevel: 1,
      stats: { ...hannya.stats, speed: 1 }, statuses: [{ instanceId: `barrier:${hannya.unitId}`,
        statusId: resentmentHannyaIds.sealBarrier, source: { kind: 'skill', id: resentmentHannyaIds.passive, unitId: hannya.unitId },
        stacks: remainingMasks, duration: { kind: 'permanent' } }] };
    initial.units[breaker.unitId] = { ...breaker, heroId: 200, skillLevel: 1,
      stats: { ...breaker.stats, speed: 1000 }, statuses: [
        { instanceId: `mask:${breaker.unitId}`, statusId: resentmentHannyaIds.sealMask,
          source: { kind: 'skill', id: resentmentHannyaIds.passive, unitId: hannya.unitId }, stacks: 1,
          duration: { kind: 'permanent' } },
        { instanceId: `passive-seal:${breaker.unitId}`, statusId: passiveSuppressionStatusId,
          source: { kind: 'skill', id: resentmentHannyaIds.passive, unitId: hannya.unitId }, stacks: 1,
          duration: { kind: 'permanent' } },
      ] };
    initial.resources.red.fire = 1;
    return runBattle(initial, registry, { seed: 13, actionLimit: 1 });
  };
  const stillOpen = simulateBreaker(3);
  assert.ok(stillOpen.events.some(event => event.type === 'action-declared' && event.intent.skillId === resentmentHannyaIds.maskBreak));
  assert.equal(stillOpen.state.units['blue-1'].statuses.find(status => status.statusId === resentmentHannyaIds.sealBarrier).stacks, 1);
  assert.equal(stillOpen.state.resources.red.fire, 0);
  const closed = simulateBreaker(1);
  assert.equal(closed.state.units['blue-1'].statuses.some(status => status.statusId === resentmentHannyaIds.sealBarrier), false);
  assert.equal(closed.state.units['red-1'].statuses.some(status => status.statusId === resentmentHannyaIds.sealMask), false);
  assert.equal(closed.state.units['red-1'].statuses.some(status => status.statusId === passiveSuppressionStatusId), false);
  const hateSpread = closed.state.units['red-1'].statuses.find(status => status.statusId === resentmentHannyaIds.hateSpread);
  assert.ok(hateSpread);
  assert.deepEqual(hateSpread.duration, { kind: 'count', remaining: 1, owner: 'target-turn' });
  assert.deepEqual(hateSpread.modifiers, [
    { stat: 'crit', operation: 'flat', amount: .5 },
    { stat: 'damage', operation: 'percent', amount: -.35 },
  ]);
  const affectedEnemy = { ...closed.state.units['red-1'], statuses: [hateSpread] };
  assert.equal(effectiveStats(affectedEnemy).crit, closed.state.units['red-1'].stats.crit + .5);
  assert.equal(effectiveDamageMultiplier(affectedEnemy), .65);
});

test('御怨般若结界期间普攻变为两段并按实际生命损失吸血', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  const actor = initial.units['blue-1'];
  initial.units[actor.unitId] = { ...actor, heroId: resentmentHannyaIds.hero, skillLevel: 1, hp: 50,
    stats: { ...actor.stats, hp: 100, attack: 20, speed: 1000 }, statuses: [{ instanceId: 'barrier:basic-test',
      statusId: resentmentHannyaIds.sealBarrier, source: { kind: 'skill', id: resentmentHannyaIds.passive, unitId: actor.unitId },
      stacks: 9, duration: { kind: 'permanent' } }] };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, hp: 1000, speed: 100 }, hp: 1000 };
  initial.resources.blue.fire = 0;
  const result = runBattle(initial, registry, { seed: 9, actionLimit: 1 });
  const basicHits = result.events.filter(event => event.type === 'damage' && event.source.id === resentmentHannyaIds.basic);
  const leech = result.events.filter(event => event.type === 'healing' && event.source.id === resentmentHannyaIds.basic);
  assert.equal(basicHits.length, 2);
  assert.equal(leech.length, 2);
  assert.ok(result.state.units[actor.unitId].hp > 50);
  assert.ok(Math.abs(leech.reduce((sum, event) => sum + event.requestedAmount, 0)
    - basicHits.reduce((sum, event) => sum + event.hpLost * .15, 0)) < 1e-9);
});

test('御怨般若结界普攻等级逐级提高两段倍率至100%', () => {
  const registry = createMigratedContentRegistry();
  const ratios = [.8, .8, .88, .92, 1];
  const amounts = [];
  const skill = registry.getHero(resentmentHannyaIds.hero).skills.find(item => item.id === resentmentHannyaIds.basic);
  for (let rank = 1; rank <= 5; rank++) {
    const initial = state();
    const actor = initial.units['blue-1'];
    initial.units[actor.unitId] = { ...actor, heroId: resentmentHannyaIds.hero, skillLevel: rank,
      skillLevels: { [resentmentHannyaIds.basic]: rank }, stats: { ...actor.stats, attack: 2000, crit: 0 },
      statuses: [{ instanceId: `barrier:basic-ratio-${rank}`, statusId: resentmentHannyaIds.sealBarrier,
        source: { kind: 'skill', id: resentmentHannyaIds.passive, unitId: actor.unitId }, stacks: 9,
        duration: { kind: 'permanent' } }] };
    initial.units['red-1'] = { ...initial.units['red-1'], hp: 100000,
      stats: { ...initial.units['red-1'].stats, hp: 100000, defense: 5000 } };
    const context = createBattleContext(initial, () => .99, id => registry.getStatus(id)?.category);
    const commands = skill.execute(context, { actorId: actor.unitId, skillId: skill.id,
      targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, skill.levels[rank - 1]);
    const hits = commands.filter(command => command.type === 'deal-damage');
    assert.equal(hits.length, 2);
    assert.equal(hits[0].amount, hits[1].amount);
    amounts.push(hits[0].amount);
    const baseline = context.calculateDamage({ attack: 2000, defense: 5000, ratio: ratios[rank - 1],
      critChance: 0, critDamage: actor.stats.critDamage }, initial.units[actor.unitId], initial.units['red-1']);
    assert.equal(hits[0].amount, baseline.amount, `等级${rank}应使用结界倍率${ratios[rank - 1]}`);
  }
  assert.equal(amounts[1], amounts[0], '二级结界普攻仍为每段80%');
  assert.ok(amounts[2] > amounts[1] && amounts[3] > amounts[2] && amounts[4] > amounts[3]);
});

test('御怨般若结界期间予愿必还额外攻击敌方全体一次', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const actor = initial.units['blue-1'];
  initial.units[actor.unitId] = { ...actor, heroId: resentmentHannyaIds.hero, skillLevel: 1, statuses: [{ instanceId: 'barrier:ultimate-test',
    statusId: resentmentHannyaIds.sealBarrier, source: { kind: 'skill', id: resentmentHannyaIds.passive, unitId: actor.unitId },
    stacks: 9, duration: { kind: 'permanent' } }] };
  const secondEnemy = { ...initial.units['red-1'], unitId: 'red-2', hp: 60, statuses: [] };
  initial.units[secondEnemy.unitId] = secondEnemy;
  initial.sides.red.push(secondEnemy.unitId);
  const ultimate = registry.getHero(resentmentHannyaIds.hero).skills.find(skill => skill.id === resentmentHannyaIds.ultimate);
  const commands = ultimate.execute(createBattleContext(initial, () => .5),
    { actorId: actor.unitId, skillId: ultimate.id, targetIds: ['red-1', 'red-2'], shape: 'multi', targetRelation: 'enemy' }, ultimate.levels[0]);
  assert.equal(commands.filter(command => command.type === 'deal-damage').length, 5,
    '一级予愿必还在结界中仍只追加一次全体攻击');
  const rankTwoActor = { ...initial.units[actor.unitId], skillLevel: 2 };
  initial.units[actor.unitId] = rankTwoActor;
  const rankTwoCommands = ultimate.execute(createBattleContext(initial, () => .5),
    { actorId: actor.unitId, skillId: ultimate.id, targetIds: ['red-1', 'red-2'], shape: 'multi', targetRelation: 'enemy' }, ultimate.levels[1]);
  assert.equal(rankTwoCommands.filter(command => command.type === 'deal-damage').length, 7,
    '二级起结界期间额外追加第二次全体攻击');
  assert.deepEqual(rankTwoCommands.filter(command => command.type === 'add-status'
    && command.instance.statusId === resentmentHannyaIds.hateMark).map(command => command.instance.stacks), [],
  '结界期间不能获得仇恨印记');
  const noBarrierState = { ...initial, units: { ...initial.units,
    [actor.unitId]: { ...rankTwoActor, statuses: [] } } };
  const rankTwoOutsideCommands = ultimate.execute(createBattleContext(noBarrierState, () => .5),
    { actorId: actor.unitId, skillId: ultimate.id, targetIds: ['red-1', 'red-2'], shape: 'multi', targetRelation: 'enemy' }, ultimate.levels[1]);
  assert.equal(rankTwoOutsideCommands.find(command => command.type === 'add-status'
    && command.instance.statusId === resentmentHannyaIds.hateMark)?.instance.stacks, 3,
  '二级起予愿必还获得3层仇恨印记');
});

test('久次良守备姿态切进攻提升速度/暴伤并推条，方圆之备切回并生成108%攻击护盾', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const owner = initial.units['blue-1'];
  initial.units[owner.unitId] = { ...owner, heroId: kujiraIds.hero, skillLevel: 5, awakeFilter: 1,
    actionGauge: 10, stats: { ...owner.stats, hp: 2000, attack: 1000, speed: 100 } };
  const ally = { ...owner, unitId: 'blue-2', heroId: 200, actionGauge: 10, hp: 1000,
    stats: { ...owner.stats, hp: 2000 }, statuses: [] };
  initial.units[ally.unitId] = ally;
  initial.sides.blue.push(ally.unitId);
  const hero = registry.getHero(kujiraIds.hero);
  const initialize = hero.initialize(createBattleContext(initial, () => .5), owner.unitId);
  let battle = applyEffectCommands(initial, initialize, 'battle-start', 'kujira-start', id => registry.getStatus(id)).state;
  assert.ok(battle.units[owner.unitId].statuses.some(status => status.statusId === kujiraIds.defensiveAura));
  const enterOffense = hero.skills.find(skill => skill.id === kujiraIds.defensiveStance);
  const offense = enterOffense.execute(createBattleContext(battle, () => .5),
    { actorId: owner.unitId, skillId: enterOffense.id, targetIds: [owner.unitId], shape: 'self', targetRelation: 'ally' }, enterOffense.levels[4]);
  battle = applyEffectCommands(battle, offense, 'effect-resolution', 'kujira-offense', id => registry.getStatus(id)).state;
  assert.equal(battle.units[owner.unitId].actionGauge, 70, '五级自身累计获得60%行动条');
  assert.equal(battle.units[ally.unitId].actionGauge, 40, '五级其余友方获得30%行动条');
  const offenseBuff = battle.units[ally.unitId].statuses.find(status => status.statusId === kujiraIds.offensiveAura);
  assert.deepEqual(offenseBuff.modifiers, [
    { stat: 'speed', operation: 'flat', amount: 30 },
    { stat: 'critDamage', operation: 'percent', amount: .3 },
  ]);
  const enterDefense = hero.skills.find(skill => skill.id === kujiraIds.offensiveStance);
  const defense = enterDefense.execute(createBattleContext(battle, () => .5),
    { actorId: owner.unitId, skillId: enterDefense.id, targetIds: [owner.unitId], shape: 'self', targetRelation: 'ally' }, enterDefense.levels[4]);
  battle = applyEffectCommands(battle, defense, 'effect-resolution', 'kujira-defense', id => registry.getStatus(id)).state;
  assert.equal(battle.units[ally.unitId].statuses.find(status => status.statusId === kujiraIds.stanceShield)
    .values.shieldRemaining, 1080);
  assert.equal(battle.units[ally.unitId].statuses.some(status => status.statusId === kujiraIds.defensiveAura), true);
});

test('久次良骨盾只减免暴击伤害40%，并在暴击命中后移除', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const owner = initial.units['blue-1'];
  const shieldSource = { kind: 'skill', id: kujiraIds.passive, unitId: owner.unitId };
  const target = { ...owner, heroId: 200, statuses: [{ instanceId: 'kujira-bone-test', statusId: kujiraIds.boneShield,
    source: shieldSource, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }] };
  initial.units[target.unitId] = target;
  const hero = registry.getHero(kujiraIds.hero);
  const input = { attack: 100, defense: 0, ratio: 1, critChance: 1, critDamage: 2 };
  const modified = hero.beforeCalculateDamage(input, initial.units['red-1'], target, initial);
  assert.equal(modified.critDamage, 1.6);
  const onHit = hero.handlers.hit.handle;
  assert.deepEqual(onHit(createBattleContext(initial, () => .5), { eventId: 'normal-hit', phase: 'hit',
    source: { kind: 'skill', id: 'test', unitId: 'red-1' }, type: 'damage', targetId: target.unitId,
    damageKind: 'normal', amount: 100, hpLost: 100, mitigated: 0, isCritical: false }) ?? [], []);
  const critCommands = onHit(createBattleContext(initial, () => .5), { eventId: 'crit-hit', phase: 'hit',
    source: { kind: 'skill', id: 'test', unitId: 'red-1' }, type: 'damage', targetId: target.unitId,
    damageKind: 'normal', amount: 160, hpLost: 160, mitigated: 0, isCritical: true });
  assert.equal(critCommands[0].type, 'remove-status-instances');
  assert.deepEqual(critCommands[0].instanceIds, [target.statuses[0].instanceId]);
  const absorbedCrit = onHit(createBattleContext(initial, () => .5), { eventId: 'absorbed-crit', phase: 'hit',
    source: { kind: 'skill', id: 'test', unitId: 'red-1' }, type: 'damage', targetId: target.unitId,
    damageKind: 'normal', amount: 160, hpLost: 0, mitigated: 160, isCritical: true });
  assert.equal(absorbedCrit[0].type, 'remove-status-instances');
});

test('久次良守备被动每个回合只为一个无骨盾受击友方补盾并以50%概率反击', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const owner = initial.units['blue-1'];
  initial.units[owner.unitId] = { ...owner, heroId: kujiraIds.hero, skillLevel: 5, awakeFilter: 1,
    statuses: [{ instanceId: `stance:${owner.unitId}`, statusId: kujiraIds.stance,
      source: { kind: 'skill', id: kujiraIds.passive, unitId: owner.unitId }, stacks: 1,
      duration: { kind: 'permanent' }, values: { mode: 'defense' } }] };
  const ally = { ...owner, unitId: 'blue-2', heroId: 200, statuses: [] };
  initial.units[ally.unitId] = ally;
  initial.sides.blue.push(ally.unitId);
  const handler = registry.getHero(kujiraIds.hero).handlers.hit.handle;
  const event = { eventId: 'ally-hit', phase: 'hit', source: { kind: 'skill', id: 'enemy', unitId: 'red-1' },
    actionId: 14, attackId: 9, type: 'damage', targetId: ally.unitId, damageKind: 'normal', amount: 10,
    hpLost: 10, mitigated: 0, isCritical: false };
  const commands = handler(createBattleContext(initial, () => .1), event);
  assert.ok(commands.some(command => command.type === 'add-status' && command.instance.statusId === kujiraIds.boneShield));
  assert.ok(commands.some(command => command.type === 'add-status' && command.instance.statusId === kujiraIds.counterWindow));
  assert.ok(commands.some(command => command.type === 'schedule-attack' && command.scheduling === 'counter'));
  const applied = applyEffectCommands(initial, commands, 'hit', event.eventId, id => registry.getStatus(id));
  const nextAlly = { ...applied.state.units[ally.unitId], unitId: 'blue-3', statuses: [] };
  const nextState = { ...applied.state, units: { ...applied.state.units, [nextAlly.unitId]: nextAlly },
    sides: { ...applied.state.sides, blue: [...applied.state.sides.blue, nextAlly.unitId] } };
  const second = handler(createBattleContext(nextState, () => .1), { ...event, eventId: 'second-ally-hit', targetId: nextAlly.unitId });
  assert.equal((second ?? []).some(command => command.type === 'add-status' && command.instance.statusId === kujiraIds.boneShield), false);
  const reset = registry.getHero(kujiraIds.hero).handlers['turn-start'].handle(createBattleContext(nextState),
    { eventId: 'next-turn', phase: 'turn-start', type: 'turn-started', unitId: 'red-1' });
  assert.ok(reset.some(command => command.type === 'remove-status-instances' && command.targetId === owner.unitId));
});

test('大岳丸开局覆土之力按技能等级减伤，五级承受三次不同攻击后破碎', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const owner = initial.units['blue-1'];
  initial.units[owner.unitId] = { ...owner, heroId: ootakemaruIds.hero, skillLevel: 5, awakeFilter: 1 };
  const hero = registry.getHero(ootakemaruIds.hero);
  const commands = hero.initialize(createBattleContext(initial), owner.unitId);
  assert.equal(commands[0].instance.values.reduction, .4);
  const applied = applyEffectCommands(initial, commands, 'battle-start', 'oota-open', id => registry.getStatus(id));
  assert.equal(hero.modifyIncomingDamage(initial.units['red-1'], applied.state.units[owner.unitId], 100), 60);
  const handler = hero.handlers.hit.handle;
  const first = handler(createBattleContext(applied.state), { eventId: 'shelter-hit-1', phase: 'hit', type: 'damage',
    source: { kind: 'skill', id: 'enemy', unitId: 'red-1' }, targetId: owner.unitId, attackId: 10,
    damageKind: 'normal', amount: 60, hpLost: 0, mitigated: 60, isCritical: false });
  const oneHit = applyEffectCommands(applied.state, first, 'hit', 'shelter-hit-1', id => registry.getStatus(id));
  const second = handler(createBattleContext(oneHit.state), { eventId: 'shelter-hit-2', phase: 'hit', type: 'damage',
    source: { kind: 'skill', id: 'enemy', unitId: 'red-1' }, targetId: owner.unitId, attackId: 11,
    damageKind: 'normal', amount: 60, hpLost: 0, mitigated: 60, isCritical: false });
  assert.equal(second[0].type, 'add-status', '五级覆土之力额外承受一次攻击');
  const twoHits = applyEffectCommands(oneHit.state, second, 'hit', 'shelter-hit-2', id => registry.getStatus(id));
  const third = handler(createBattleContext(twoHits.state), { eventId: 'shelter-hit-3', phase: 'hit', type: 'damage',
    source: { kind: 'skill', id: 'enemy', unitId: 'red-1' }, targetId: owner.unitId, attackId: 12,
    damageKind: 'normal', amount: 60, hpLost: 0, mitigated: 60, isCritical: false });
  assert.equal(third[0].type, 'remove-status-instances');
  assert.deepEqual(third[0].instanceIds, [twoHits.state.units[owner.unitId].statuses[0].instanceId]);
});

test('大岳丸麓鸣·轰按客户端技能等级倍率且普攻不额外附加未列出的减速', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const owner = initial.units['blue-1'];
  initial.units[owner.unitId] = { ...owner, heroId: ootakemaruIds.hero, skillLevel: 5, awakeFilter: 1 };
  const basic = registry.getHero(ootakemaruIds.hero).skills.find(skill => skill.id === ootakemaruIds.basic);
  assert.deepEqual(basic.levels.map(level => level.ratio), [1, 1.05, 1.1, 1.15, 1.25]);
  const commands = basic.execute(createBattleContext(initial, () => .5), { actorId: owner.unitId,
    skillId: ootakemaruIds.basic, targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, { ratio: 1.25 });
  assert.ok(commands.some(command => command.type === 'deal-damage' && command.amount > 0));
  assert.equal(commands.some(command => command.type === 'add-status'), false);
});

test('大岳丸剑狱放逐目标后使其不行动、不被选中且免受效果，同时石浪打击其他敌方', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const owner = initial.units['blue-1'];
  initial.units[owner.unitId] = { ...owner, heroId: ootakemaruIds.hero, skillLevel: 5, awakeFilter: 1,
    stats: { ...owner.stats, defense: 100 } };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 1000,
    stats: { ...initial.units['red-1'].stats, hp: 1000, attack: 500, defense: 400 } };
  const red2 = { ...initial.units['red-1'], unitId: 'red-2', hp: 1000 };
  initial.units[red2.unitId] = red2;
  initial.sides.red.push(red2.unitId);
  const hero = registry.getHero(ootakemaruIds.hero);
  const ultimate = hero.skills.find(skill => skill.id === ootakemaruIds.ultimate);
  const commands = ultimate.execute(createBattleContext(initial, () => .99), { actorId: owner.unitId,
    skillId: ootakemaruIds.ultimate, targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, { waveRatio: 3.12 });
  assert.ok(commands.some(command => command.type === 'add-status' && command.targetId === 'red-1'
    && command.instance.statusId === ootakemaruIds.banishStatus));
  assert.ok(commands.some(command => command.type === 'deal-damage' && command.targetId === 'red-2'));
  assert.equal(commands.some(command => command.type === 'deal-damage' && command.targetId === 'red-1'), false);
  const applied = applyEffectCommands(initial, commands, 'effect-resolution', 'prison-start', id => registry.getStatus(id));
  const context = createBattleContext(applied.state);
  assert.deepEqual(context.getLivingUnits('red').map(unit => unit.unitId), ['red-2']);
  assert.equal(effectiveStats(applied.state.units[owner.unitId]).attack, 150, '目标初始攻击的30%受到自身初始攻击50%上限约束');
  assert.equal(effectiveStats(applied.state.units[owner.unitId]).defense, 150, '目标初始防御的30%受到自身初始防御50%上限约束');
  assert.notEqual(scheduleNextActor(applied.state, () => .9).actorId, 'red-1');
  const blockedDamage = applyEffectCommands(applied.state, [{ type: 'deal-damage', source: { kind: 'skill', id: 'test', unitId: owner.unitId },
    targetId: 'red-1', amount: 50 }], 'hit', 'banished-hit', id => registry.getStatus(id));
  assert.equal(blockedDamage.state.units['red-1'].hp, 1000);
  const blockedBuff = applyEffectCommands(blockedDamage.state, [{ type: 'add-status', source: { kind: 'skill', id: 'test', unitId: owner.unitId },
    targetId: 'red-1', instance: { instanceId: 'test-buff', statusId: 'test-buff', source: { kind: 'skill', id: 'test', unitId: owner.unitId },
      stacks: 1, duration: { kind: 'permanent' } } }], 'effect-resolution', 'banished-buff', id => ({ id,
        category: 'buff', mechanicsCoverage: 'partial', dispellable: true, sealable: false, durationOwner: 'permanent', refreshPolicy: 'replace' }));
  assert.equal(blockedBuff.state.units['red-1'].statuses.some(status => status.statusId === 'test-buff'), false);
  const blockedHeal = applyEffectCommands(blockedBuff.state, [{ type: 'heal', source: { kind: 'skill', id: 'test', unitId: owner.unitId },
    targetId: 'red-1', amount: 100 }], 'effect-resolution', 'banished-heal');
  assert.equal(blockedHeal.state.units['red-1'].hp, 1000);
});

test('大岳丸下回合结束解除剑狱、使落石无法分摊并按技能等级推条', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const owner = initial.units['blue-1'];
  const source = { kind: 'skill', id: ootakemaruIds.ultimate, unitId: owner.unitId };
  const exile = { instanceId: 'exile-red', statusId: ootakemaruIds.banishStatus, source, stacks: 1,
    duration: { kind: 'permanent' }, values: { banished: true } };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 1000, stats: { ...initial.units['red-1'].stats, hp: 1000 }, statuses: [exile] };
  initial.units[owner.unitId] = { ...owner, heroId: ootakemaruIds.hero, skillLevel: 4, awakeFilter: 1,
    statuses: [
      { instanceId: 'prison', statusId: ootakemaruIds.prisonStatus, source, stacks: 1, duration: { kind: 'permanent' },
        values: { targetId: 'red-1', armed: true } },
      { instanceId: 'stolen', statusId: ootakemaruIds.bonusStatus, source, stacks: 1, duration: { kind: 'permanent' },
        modifiers: [{ stat: 'attack', operation: 'flat', amount: 50 }] },
    ] };
  const hero = registry.getHero(ootakemaruIds.hero);
  const commands = hero.handlers['turn-end'].handle(createBattleContext(initial, () => .5), { eventId: 'owner-turn-end', phase: 'turn-end',
    type: 'turn-ended', unitId: owner.unitId, actionId: 7, source });
  const rock = commands.find(command => command.type === 'deal-damage' && command.targetId === 'red-1');
  assert.ok(rock);
  assert.equal(rock.cannotBeShared, true);
  assert.equal(rock.suppressTargetSoulTriggers, true);
  assert.equal(rock.suppressTargetPassiveTriggers, true);
  assert.ok(commands.some(command => command.type === 'change-action-gauge' && command.targetId === owner.unitId && command.amount === 70));
  const result = applyEffectCommands(initial, commands, 'turn-end', 'owner-turn-end', id => registry.getStatus(id));
  assert.equal(result.state.units['red-1'].statuses.some(status => status.statusId === ootakemaruIds.banishStatus), false);
  assert.ok(result.state.units['red-1'].hp < 1000);
});

test('大岳丸放逐期间友方普攻触发麓鸣·斩协战', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const owner = initial.units['blue-1'];
  const source = { kind: 'skill', id: ootakemaruIds.ultimate, unitId: owner.unitId };
  initial.units[owner.unitId] = { ...owner, heroId: ootakemaruIds.hero, skillLevel: 5, awakeFilter: 1,
    statuses: [{ instanceId: 'prison', statusId: ootakemaruIds.prisonStatus, source, stacks: 1, duration: { kind: 'permanent' },
      values: { targetId: 'red-1', armed: false } }] };
  const ally = { ...owner, unitId: 'blue-2', heroId: 200, statuses: [] };
  initial.units[ally.unitId] = ally;
  initial.sides.blue.push(ally.unitId);
  const event = { eventId: 'ally-basic', phase: 'attack-end', type: 'attack-ended', actionKind: 'basic',
    source: { kind: 'skill', id: '2001', unitId: ally.unitId }, selectedTargetIds: ['red-1'], hitCount: 1 };
  const commands = registry.getHero(ootakemaruIds.hero).handlers['attack-end'].handle(createBattleContext(initial, () => .4), event);
  const assist = commands.find(command => command.type === 'schedule-attack' && command.scheduling === 'assist');
  assert.equal(assist.intent.skillId, ootakemaruIds.evolvedBasic);
  assert.equal(assist.suppressTargetSoulTriggers, true);
  assert.equal(assist.suppressTargetPassiveTriggers, true);
});

test('蝉冰雪女开局给全体友方添加永久防御光环', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const actor = initial.units['blue-1'];
  const ally = { ...actor, unitId: 'blue-2', hp: 100, stats: { ...actor.stats, hp: 100, defense: 500 }, statuses: [] };
  initial.units[actor.unitId] = { ...actor, heroId: cicadaSnowMaidenIds.hero, stats: { ...actor.stats, defense: 500 } };
  initial.units[ally.unitId] = ally;
  initial.sides.blue = [...initial.sides.blue, ally.unitId];
  const initialize = registry.getHero(cicadaSnowMaidenIds.hero).initialize;
  const commands = initialize(createBattleContext(initial, () => .5), actor.unitId);
  assert.deepEqual(commands.map(command => command.targetId), [actor.unitId, ally.unitId]);
  assert.ok(commands.every(command => command.instance.modifiers[0].amount === .3));
});

test('蝉冰雪女永冬施加带护盾量的蝉翼，蝉翼移除时解除对应霜冻', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const actor = initial.units['blue-1'];
  initial.units[actor.unitId] = { ...actor, heroId: cicadaSnowMaidenIds.hero, skillLevel: 1,
    skillLevels: { [cicadaSnowMaidenIds.ultimate]: 4, [cicadaSnowMaidenIds.revive]: 1 },
    stats: { ...actor.stats, defense: 200 } };
  const hero = registry.getHero(cicadaSnowMaidenIds.hero);
  const ultimate = hero.skills.find(item => item.id === cicadaSnowMaidenIds.ultimate);
  const commands = ultimate.execute(createBattleContext(initial, () => .5),
    { actorId: actor.unitId, skillId: ultimate.id, targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, ultimate.levels[2]);
  const wing = commands.find(command => command.type === 'add-status' && command.instance.statusId === cicadaSnowMaidenIds.cicadaWing);
  assert.equal(wing.instance.values.shieldRemaining, 1170);
  assert.deepEqual(wing.instance.modifiers, [{ stat: 'critResist', operation: 'flat', amount: 1 }]);
  const attacker = { ...initial.units['blue-1'], stats: { ...initial.units['blue-1'].stats, attack: 100, crit: .5, critDamage: 2 } };
  const target = { ...initial.units['red-1'], statuses: [wing.instance] };
  const critHit = createBattleContext(initial, () => .1).calculateDamage({ attack: 100, defense: 0, ratio: 1,
    critChance: .5, critDamage: 2 }, attacker, target);
  assert.equal(critHit.isCritical, false, '四级蝉翼提供100%暴击抵抗');
  const hitHandler = hero.handlers.hit.handle;
  const damageEvent = { eventId: 'snow-hit', phase: 'hit', source: { kind: 'skill', id: ultimate.id, unitId: actor.unitId },
    type: 'damage', targetId: 'red-1', damageKind: 'normal', amount: 10, hpLost: 10, mitigated: 0, isCritical: false };
  const freeze = hitHandler(createBattleContext(initial, () => .01), damageEvent)[0];
  assert.equal(freeze.instance.values.wingOwnerUnitId, actor.unitId);
  const frozenState = applyEffectCommands(initial, [freeze], 'control-application', 'snow-freeze-test', id => registry.getStatus(id)).state;
  const gaugeState = { ...frozenState, units: { ...frozenState.units,
    'red-1': { ...frozenState.units['red-1'], actionGauge: 42 } } };
  const gaugeLock = applyEffectCommands(gaugeState, [20, -15].map(amount => ({ type: 'change-action-gauge',
    source: { kind: 'skill', id: ultimate.id, unitId: actor.unitId }, targetId: 'red-1', amount })),
  'effect-resolution', 'snow-freeze-gauge-lock', id => registry.getStatus(id));
  assert.equal(gaugeLock.state.units['red-1'].actionGauge, 42);
  assert.equal(gaugeLock.events.filter(event => event.type === 'action-gauge-changed' && event.blockedByImmunity).length, 2);
  const removeHandler = hero.handlers['effect-resolution'].handle;
  const cleanup = removeHandler(createBattleContext(frozenState, () => .5), { eventId: 'wing-lost', phase: 'effect-resolution',
    source: wing.source, type: 'status-removed', targetId: actor.unitId, instanceId: wing.instance.instanceId,
    statusId: cicadaSnowMaidenIds.cicadaWing, reason: 'consumed' });
  assert.equal(cleanup[0].targetId, 'red-1');
  assert.deepEqual(cleanup[0].statusIds, [cicadaSnowMaidenIds.freeze]);
});

test('蝉翼不可驱散并在蝉冰雪女自身回合开始到期，随后解除其霜冻', () => {
  const registry = createMigratedContentRegistry();
  registry.registerStatus({ id: 'test.cicada-turn-lock', mechanicsCoverage: 'verified', category: 'control', dispellable: false,
    sealable: false, durationOwner: 'permanent', refreshPolicy: 'keep', preventsAction: true });
  const initial = state();
  const snow = initial.units['blue-1'];
  const wingSource = { kind: 'skill', id: cicadaSnowMaidenIds.ultimate, unitId: snow.unitId };
  const wing = { instanceId: 'cicada-wing-expiry', statusId: cicadaSnowMaidenIds.cicadaWing, source: wingSource,
    stacks: 1, duration: { kind: 'permanent' }, values: { shieldRemaining: 100 } };
  const freezeSource = { kind: 'skill', id: cicadaSnowMaidenIds.ultimate, unitId: snow.unitId };
  initial.units[snow.unitId] = { ...snow, heroId: cicadaSnowMaidenIds.hero, skillLevel: 1, turnPos: 120,
    stats: { ...snow.stats, speed: 300 }, statuses: [wing, { instanceId: 'turn-lock', statusId: 'test.cicada-turn-lock',
      source: { kind: 'system', id: 'test' }, stacks: 1, duration: { kind: 'permanent' } }] };
  initial.units['red-1'] = { ...initial.units['red-1'], turnPos: 0,
    stats: { ...initial.units['red-1'].stats, speed: 50 }, statuses: [
    { instanceId: 'wing-owned-frost', statusId: cicadaSnowMaidenIds.freeze, source: freezeSource, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { wingOwnerUnitId: snow.unitId } },
  ] };
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };

  assert.equal(registry.getStatus(cicadaSnowMaidenIds.cicadaWing).dispellable, false);
  assert.equal(registry.getStatus(cicadaSnowMaidenIds.cicadaWing).sealable, false);
  const dispelAttempt = applyEffectCommands(initial, [{ type: 'dispel-statuses', source: { kind: 'skill', id: 'test.dispel' },
    targetId: snow.unitId, statusIds: [cicadaSnowMaidenIds.cicadaWing] }], 'effect-resolution', 'cicada-wing-dispel',
  id => registry.getStatus(id));
  assert.ok(dispelAttempt.state.units[snow.unitId].statuses.some(status => status.statusId === cicadaSnowMaidenIds.cicadaWing));

  const result = runBattle(initial, registry, { seed: 362, actionLimit: 1 });
  assert.ok(result.events.some(event => event.type === 'status-removed' && event.statusId === cicadaSnowMaidenIds.cicadaWing
    && event.reason === 'expired'), '蝉冰雪女回合开始时将蝉翼作为到期状态记录');
  assert.equal(result.state.units[snow.unitId].statuses.some(status => status.statusId === cicadaSnowMaidenIds.cicadaWing), false);
  assert.equal(result.state.units['red-1'].statuses.some(status => status.statusId === cicadaSnowMaidenIds.freeze), false,
    '蝉翼到期会通过既有解除规则移除由其施加的霜冻');
});

test('蝉冰雪女冰花每6层触发极寒之气，结算霜冻增伤、友方减伤与受控延迟', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const snow = initial.units['blue-1'];
  const ally = { ...snow, unitId: 'blue-2', heroId: 1, hp: 20000,
    stats: { ...snow.stats, hp: 20000, defense: 100 }, statuses: [] };
  initial.units[snow.unitId] = { ...snow, heroId: cicadaSnowMaidenIds.hero, skillLevel: 1,
    skillLevels: { [cicadaSnowMaidenIds.revive]: 4, [cicadaSnowMaidenIds.ultimate]: 1 },
    stats: { ...snow.stats, defense: 100 }, statuses: [{ instanceId: 'five-flowers', statusId: cicadaSnowMaidenIds.iceFlower,
      source: { kind: 'skill', id: cicadaSnowMaidenIds.revive, unitId: snow.unitId }, stacks: 5, duration: { kind: 'permanent' } }] };
  initial.units[ally.unitId] = ally;
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 20000,
    stats: { ...initial.units['red-1'].stats, hp: 20000, defense: 100 }, statuses: [{ instanceId: 'frosted-enemy',
      statusId: cicadaSnowMaidenIds.freeze, source: { kind: 'skill', id: cicadaSnowMaidenIds.ultimate, unitId: snow.unitId },
      stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }] };
  initial.sides.blue = [...initial.sides.blue, ally.unitId];
  const hero = registry.getHero(cicadaSnowMaidenIds.hero);
  const event = { eventId: 'ice-flower-threshold', phase: 'turn-end', source: { kind: 'unit', id: 'red-1', unitId: 'red-1' },
    type: 'turn-ended', actionId: 2, unitId: 'red-1' };
  const handler = hero.handlers['turn-end'].handle;
  const commands = handler(createBattleContext(initial, () => .5), event);
  const bursts = commands.filter(command => command.type === 'lose-life' && command.source.id === cicadaSnowMaidenIds.iceBurst);
  assert.deepEqual(bursts.map(command => command.targetId), ['blue-2', 'red-1']);
  assert.ok(Math.abs(bursts[0].amount / bursts[1].amount - (.7 / 1.5)) < 1e-9,
    '四级友方伤害降低30%，二级以上对霜冻敌人增伤50%');
  const resolved = applyEffectCommands(initial, commands, 'turn-end', event.eventId, id => registry.getStatus(id));
  assert.equal(resolved.state.units[snow.unitId].statuses.some(status => status.statusId === cicadaSnowMaidenIds.iceFlower), false);
  assert.equal(resolved.events.filter(item => item.type === 'life-lost' && item.lifeLossKind === 'indirect').length, 2);
  assert.equal(resolved.events.some(item => item.type === 'damage'), false, '极寒之气以间接生命损失结算，不触发受击被动');

  const delayed = handler(createBattleContext(initial, () => .5, () => undefined, () => false, () => true), event);
  assert.equal(delayed.some(command => command.type === 'lose-life'), false, '蝉冰雪女无法行动时暂不触发极寒之气');
  const delayedState = applyEffectCommands(initial, delayed, 'turn-end', 'ice-flower-delayed', id => registry.getStatus(id));
  assert.equal(delayedState.state.units[snow.unitId].statuses.find(status => status.statusId === cicadaSnowMaidenIds.iceFlower).stacks, 6);
});

test('蝉冰雪女保护友方凝结并由息吹复活全体，选中目标获得满行动条', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const actor = initial.units['blue-1'];
  const ally = { ...actor, unitId: 'blue-2', heroId: 1, hp: 100, stats: { ...actor.stats, hp: 100 }, statuses: [] };
  initial.units[actor.unitId] = { ...actor, heroId: cicadaSnowMaidenIds.hero };
  initial.units[ally.unitId] = ally;
  initial.sides.blue = [...initial.sides.blue, ally.unitId];
  const hero = registry.getHero(cicadaSnowMaidenIds.hero);
  const intercept = hero.interceptIncomingDamage(initial, initial.units['red-1'], ally, 120, 'normal');
  assert.ok(intercept);
  const sealedProtectorState = { ...initial, units: { ...initial.units, [actor.unitId]: { ...initial.units[actor.unitId],
    statuses: [{ instanceId: 'sealed-snow-passive', statusId: passiveSuppressionStatusId,
      source: { kind: 'skill', id: 'test.seal', unitId: 'red-1' }, stacks: 1, duration: { kind: 'permanent' } }] } } };
  assert.equal(hero.interceptIncomingDamage(sealedProtectorState, sealedProtectorState.units['red-1'], ally, 120, 'normal'), undefined,
    '被动封印期间蝉冰雪女不替友方进入凝结形态');
  const sealedTurnEnd = hero.handlers['turn-end'].handle(createBattleContext(sealedProtectorState, () => .5), {
    type: 'turn-ended', eventId: 'sealed-snow-turn-end', phase: 'turn-end',
    source: { kind: 'unit', id: actor.unitId, unitId: actor.unitId }, actionId: 1, unitId: actor.unitId,
  });
  assert.deepEqual(sealedTurnEnd, [], '被动封印期间不生成冰花');
  const saved = applyEffectCommands(initial, intercept.effects, 'hit', 'snow-save-test', id => registry.getStatus(id));
  const deadAllyState = { ...saved.state, units: { ...saved.state.units, [ally.unitId]: {
    ...saved.state.units[ally.unitId], hp: 0 } } };
  assert.ok(deadAllyState.units[ally.unitId].statuses.some(status => status.statusId === cicadaSnowMaidenIds.crystallized));
  const revive = hero.skills.find(item => item.id === cicadaSnowMaidenIds.revive);
  const commands = revive.execute(createBattleContext(deadAllyState, () => .5),
    { actorId: actor.unitId, skillId: revive.id, targetIds: [ally.unitId], shape: 'single', targetRelation: 'ally' });
  assert.deepEqual(commands.map(command => command.type), ['remove-statuses', 'revive', 'change-action-gauge', 'add-status']);
  const result = applyEffectCommands(deadAllyState, commands, 'effect-resolution', 'snow-revive-test', id => registry.getStatus(id));
  assert.equal(result.state.units[ally.unitId].hp, 100);
  assert.equal(result.state.units[ally.unitId].actionGauge, 100);
  assert.ok(!result.state.units[ally.unitId].statuses.some(status => status.statusId === cicadaSnowMaidenIds.crystallized));
  assert.ok(result.state.units[actor.unitId].statuses.some(status => status.statusId === cicadaSnowMaidenIds.springCallReady));
});

test('蝉冰雪女永冬优先攻击最高攻击的非阴阳师，普攻优先攻击低于20%生命的敌人', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const snow = initial.units['blue-1'];
  initial.units[snow.unitId] = { ...snow, heroId: cicadaSnowMaidenIds.hero };
  initial.units['red-1'] = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, attack: 400 } };
  initial.units['red-2'] = { ...initial.units['red-1'], unitId: 'red-2', stats: { ...initial.units['red-1'].stats, attack: 600 } };
  initial.units['red-3'] = { ...initial.units['red-1'], unitId: 'red-3', unitKind: 'onmyoji', stats: { ...initial.units['red-1'].stats, attack: 1000 } };
  initial.sides.red = ['red-1', 'red-2', 'red-3'];
  const hero = registry.getHero(cicadaSnowMaidenIds.hero);
  const ultimate = hero.policy(createBattleContext(initial, () => .5), snow.unitId);
  assert.equal(ultimate.skillId, cicadaSnowMaidenIds.ultimate);
  assert.deepEqual(ultimate.targetIds, ['red-2'], '阴阳师即使攻击最高也不作为永冬目标');

  initial.resources.blue.fire = 0;
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 15, stats: { ...initial.units['red-1'].stats, hp: 100 } };
  const basic = hero.policy(createBattleContext(initial, () => .5), snow.unitId);
  assert.equal(basic.skillId, cicadaSnowMaidenIds.basic);
  assert.deepEqual(basic.targetIds, ['red-1']);
});

test('蝉冰雪女三级被动按凝结友方数量获得速度，复活后同步移除加成', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const snow = initial.units['blue-1'];
  const crystallizedAlly = { ...snow, unitId: 'blue-2', heroId: 1, hp: 0,
    stats: { ...snow.stats, hp: 100, speed: 123 }, statuses: [{ instanceId: 'crystallized-ally',
      statusId: cicadaSnowMaidenIds.crystallized, source: { kind: 'skill', id: cicadaSnowMaidenIds.revive,
        unitId: snow.unitId }, stacks: 1, duration: { kind: 'permanent' } }] };
  initial.units[snow.unitId] = { ...snow, heroId: cicadaSnowMaidenIds.hero, skillLevel: 1,
    skillLevels: { [cicadaSnowMaidenIds.revive]: 3, [cicadaSnowMaidenIds.ultimate]: 1 },
    stats: { ...snow.stats, speed: 100 } };
  initial.units[crystallizedAlly.unitId] = crystallizedAlly;
  initial.sides.blue = [...initial.sides.blue, crystallizedAlly.unitId];
  const hero = registry.getHero(cicadaSnowMaidenIds.hero);
  const defeatedEvent = { eventId: 'crystallized-count-up', phase: 'unit-defeated',
    source: { kind: 'unit', id: crystallizedAlly.unitId, unitId: crystallizedAlly.unitId },
    type: 'unit-defeated', unitId: crystallizedAlly.unitId };
  const speedCommands = hero.handlers['unit-defeated'].handle(createBattleContext(initial, () => .5), defeatedEvent);
  const boosted = applyEffectCommands(initial, speedCommands, 'unit-defeated', defeatedEvent.eventId,
    id => registry.getStatus(id)).state;
  assert.equal(effectiveStats(boosted.units[snow.unitId]).speed, 150);

  const revived = applyEffectCommands(boosted, [
    { type: 'remove-statuses', source: { kind: 'skill', id: cicadaSnowMaidenIds.revive, unitId: snow.unitId },
      targetId: crystallizedAlly.unitId, statusIds: [cicadaSnowMaidenIds.crystallized], reason: 'consumed' },
    { type: 'revive', source: { kind: 'skill', id: cicadaSnowMaidenIds.revive, unitId: snow.unitId },
      targetId: crystallizedAlly.unitId, hp: 100 },
  ], 'effect-resolution', 'crystallized-count-down', id => registry.getStatus(id));
  const revivedEvent = revived.events.find(event => event.type === 'unit-revived');
  assert.ok(revivedEvent);
  const cleanupCommands = hero.handlers['effect-resolution'].handle(createBattleContext(revived.state, () => .5),
    { ...revivedEvent, phase: 'effect-resolution' });
  const cleaned = applyEffectCommands(revived.state, cleanupCommands, 'effect-resolution', revivedEvent.eventId,
    id => registry.getStatus(id)).state;
  assert.equal(effectiveStats(cleaned.units[snow.unitId]).speed, 100);
});

test('蝉冰雪女凝结救命与息吹复活在正式战斗调度中串联', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const snow = initial.units['blue-1'];
  const red = initial.units['red-1'];
  const ally = { ...snow, unitId: 'blue-2', heroId: 1, hp: 10,
    stats: { ...snow.stats, hp: 100, defense: 0, speed: 100 }, shield: 0, statuses: [] };
  initial.units[snow.unitId] = { ...snow, heroId: cicadaSnowMaidenIds.hero, hp: 100,
    stats: { ...snow.stats, hp: 100, attack: 100, speed: 100 } };
  initial.units[ally.unitId] = ally;
  initial.units[red.unitId] = { ...red, heroId: 247, hp: 1000,
    stats: { ...red.stats, hp: 1000, attack: 20, defense: 0, speed: 110 } };
  initial.resources.red.fire = 0;
  initial.sides.blue = [snow.unitId, ally.unitId];
  initial.sides.red = [red.unitId];
  const result = runBattle(initial, registry, { seed: 712, actionLimit: 12 });
  assert.ok(result.events.some(event => event.type === 'status-added' && event.targetId === ally.unitId
    && event.instance.statusId === cicadaSnowMaidenIds.crystallized), result.events.map(event => `${event.type}:${event.source.id}`).join(', '));
  assert.ok(result.events.some(event => event.type === 'unit-revived' && event.unitId === ally.unitId),
    result.events.map(event => `${event.type}:${event.source.id}`).join(', '));
  assert.ok(result.events.some(event => event.type === 'status-added' && event.instance.statusId === cicadaSnowMaidenIds.springBlessing));
});

test('季的群攻按已损失生命增加单体追加段，技能不可暴击', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const actor = initial.units['blue-1'];
  initial.units[actor.unitId] = { ...actor, heroId: jiIds.hero, skillLevel: 4, hp: 52,
    stats: { ...actor.stats, hp: 100, crit: 100, critDamage: 1.8 } };
  const skill = registry.getHero(jiIds.hero).skills.find(item => item.id === jiIds.ultimate);
  const commands = skill.execute(createBattleContext(initial, () => .01),
    { actorId: actor.unitId, skillId: skill.id, targetIds: ['red-1'], shape: 'all-enemies', targetRelation: 'enemy' }, skill.levels[3]);
  assert.equal(commands.length, 5, '3 段群攻加上 48% 已损生命对应的 2 段追加攻击');
  assert.ok(commands.every(command => command.isCritical === false));
  assert.equal(commands.at(-1).amount > commands[0].amount, true, '追加攻击使用技能4级的120%系数');
});

test('季按暴击伤害高于150%的部分获得50%比例暴击抵抗并参与实际判定', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const attacker = { ...initial.units['red-1'], stats: { ...initial.units['red-1'].stats, crit: .5, critDamage: 1.5 } };
  const target = { ...initial.units['blue-1'], heroId: jiIds.hero,
    stats: { ...initial.units['blue-1'].stats, critDamage: 2 } };
  initial.units[attacker.unitId] = attacker;
  initial.units[target.unitId] = target;
  const hook = registry.getHero(jiIds.hero).beforeCalculateDamage;
  const input = { attack: 100, defense: 0, ratio: 1, critChance: attacker.stats.crit, critDamage: attacker.stats.critDamage };
  const normal = createBattleContext(initial, () => .3).calculateDamage(input, attacker, target);
  const jiContext = createBattleContext(initial, () => .3, undefined, undefined, undefined, { before: hook });
  const resisted = jiContext.calculateDamage(input, attacker, target);
  assert.equal(normal.isCritical, true);
  assert.equal(resisted.isCritical, false);
});

test('季的暴击抵抗钩子在完整战斗调度中影响敌方伤害结算', () => {
  const registry = new ContentRegistry();
  registerJi(registry);
  const skill = { id: 'test.critical-hit', actionKind: 'skill', target: 'single', targetRelation: 'enemy', levels: [{}],
    execute(context, intent) {
      const attacker = context.getUnit(intent.actorId); const target = context.getUnit(intent.targetIds[0]);
      const hit = context.calculateDamage({ attack: attacker.stats.attack, defense: target.stats.defense, ratio: 1,
        critChance: attacker.stats.crit, critDamage: attacker.stats.critDamage }, attacker, target);
      return [{ type: 'deal-damage', source: { kind: 'skill', id: skill.id, unitId: attacker.unitId },
        targetId: target.unitId, amount: hit.amount, isCritical: hit.isCritical }];
    } };
  registry.registerHero({ id: 9998, skills: [skill], mechanicsCoverage: 'verified', aiCoverage: 'verified',
    policy(_context, actorId) { return { actorId, skillId: skill.id, targetIds: ['blue-1'], shape: 'single', targetRelation: 'enemy' }; } });
  const initial = state();
  initial.units['red-1'] = { ...initial.units['red-1'], heroId: 9998, stats: { ...initial.units['red-1'].stats,
    speed: 200, attack: 100, crit: 1, critDamage: 1.5 } };
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: jiIds.hero, skillLevel: 1,
    stats: { ...initial.units['blue-1'].stats, speed: 100, critDamage: 3.5 } };
  initial.counters = { ...initial.counters, action: 0 };
  const result = runBattle(initial, registry, { seed: 392, actionLimit: 1 });
  const hit = result.events.find(event => event.type === 'damage' && event.source.id === skill.id);
  assert.ok(hit);
  assert.equal(hit.isCritical, false);
});

test('季每层四季流转抵挡一次致命伤害，非致命的护盾命中不消耗层数', () => {
  const registry = new ContentRegistry();
  registerJi(registry);
  const initial = state();
  const protection = { instanceId: 'ji-seasons', statusId: jiIds.fourSeason,
    source: { kind: 'skill', id: jiIds.season, unitId: 'blue-1' }, stacks: 2,
    duration: { kind: 'count', remaining: 3, owner: 'target-turn' }, values: { season: 'spring' } };
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: jiIds.hero, hp: 50, shield: 0,
    statuses: [protection] };
  const lethal = [{ type: 'deal-damage', source: { kind: 'skill', id: 'test.lethal', unitId: 'red-1' },
    targetId: 'blue-1', amount: 1000 }];
  const first = applyEffectCommands(initial, lethal, 'effect-resolution', 'ji-lethal-1', id => registry.getStatus(id));
  assert.equal(first.state.units['blue-1'].hp, 1);
  assert.equal(first.state.units['blue-1'].statuses.find(status => status.statusId === jiIds.fourSeason).stacks, 1);
  assert.equal(first.events.find(event => event.type === 'damage').fatalProtectionStatusId, jiIds.fourSeason);
  assert.ok(first.events.some(event => event.type === 'status-stacks-changed' && event.before === 2 && event.after === 1));

  const second = applyEffectCommands(first.state, lethal, 'effect-resolution', 'ji-lethal-2', id => registry.getStatus(id));
  assert.equal(second.state.units['blue-1'].hp, 1);
  assert.equal(second.state.units['blue-1'].statuses.some(status => status.statusId === jiIds.fourSeason), false);
  assert.ok(second.events.some(event => event.type === 'status-removed' && event.statusId === jiIds.fourSeason
    && event.reason === 'consumed'));

  const shielded = { ...initial, units: { ...initial.units,
    'blue-1': { ...initial.units['blue-1'], hp: 50, shield: 100, statuses: [protection] } } };
  const nonlethal = applyEffectCommands(shielded, [{ ...lethal[0], amount: 50 }], 'effect-resolution', 'ji-shielded-hit',
    id => registry.getStatus(id));
  assert.equal(nonlethal.state.units['blue-1'].hp, 50);
  assert.equal(nonlethal.state.units['blue-1'].shield, 50);
  assert.equal(nonlethal.state.units['blue-1'].statuses[0].stacks, 2);
});

test('季二级岁时生息按当前已损失生命动态减伤，一级不获得该减伤', () => {
  const registry = new ContentRegistry();
  registerJi(registry);
  const hero = registry.getHero(jiIds.hero);
  const makeState = skillLevel => {
    const initial = state();
    initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: jiIds.hero, skillLevel: 1,
      skillLevels: { [jiIds.seasonCore]: skillLevel, [jiIds.ultimate]: 1 }, hp: 50, shield: 0,
      statuses: [{ instanceId: 'years-renewal', statusId: jiIds.yearsRenewal,
        source: { kind: 'skill', id: jiIds.season, unitId: 'blue-1' }, stacks: 1,
        duration: { kind: 'count', remaining: 2, owner: 'target-turn' } }] };
    return initial;
  };
  const damage = [{ type: 'deal-damage', source: { kind: 'skill', id: 'test.damage', unitId: 'red-1' },
    targetId: 'blue-1', amount: 80 }];
  const resolveStatus = id => registry.getStatus(id);
  const modifyDamage = (attacker, target, amount, kind) => hero.modifyIncomingDamage(attacker, target, amount, kind);
  const upgraded = applyEffectCommands(makeState(2), damage, 'effect-resolution', 'years-renewal-lv2', resolveStatus, modifyDamage);
  assert.equal(upgraded.state.units['blue-1'].hp, 10);
  assert.equal(upgraded.events.find(event => event.type === 'damage').amount, 40);
  const baseRank = applyEffectCommands(makeState(1), damage, 'effect-resolution', 'years-renewal-lv1', resolveStatus, modifyDamage);
  assert.equal(baseRank.state.units['blue-1'].hp, 0);
  assert.equal(baseRank.events.find(event => event.type === 'damage').amount, 80);
});

test('季五级群攻即时触发自身季灵一次且保留回合末结算', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const actor = { ...initial.units['blue-1'], heroId: jiIds.hero, skillLevel: 1,
    skillLevels: { [jiIds.ultimate]: 5, [jiIds.seasonCore]: 1 },
    stats: { ...initial.units['blue-1'].stats, attack: 100 } };
  const mark = { instanceId: 'ji-season-spirit', statusId: jiIds.seasonSpirit,
    source: { kind: 'skill', id: jiIds.season, unitId: actor.unitId }, stacks: 1,
    duration: { kind: 'count', remaining: 3, owner: 'target-turn' }, values: { ownerUnitId: actor.unitId, season: 'autumn' } };
  initial.units[actor.unitId] = actor;
  initial.units['red-1'] = { ...initial.units['red-1'], statuses: [mark] };
  const skill = registry.getHero(jiIds.hero).skills.find(item => item.id === jiIds.ultimate);
  const intent = { actorId: actor.unitId, skillId: skill.id, targetIds: ['red-1'], shape: 'all-enemies', targetRelation: 'enemy' };
  const commands = skill.execute(createBattleContext(initial, () => .5), intent, skill.levels[4]);
  const spiritAttacks = commands.filter(command => command.source.id === jiIds.seasonSpirit);
  assert.equal(spiritAttacks.length, 1);
  assert.equal(spiritAttacks[0].targetId, 'red-1');
  assert.equal(initial.units['red-1'].statuses.some(status => status.statusId === jiIds.seasonSpirit), true,
    '即时攻击不会消耗季灵状态，目标回合结束仍可结算');
});

test('季先机、姿态持续时间和重复切换返火读取四时一隅等级', () => {
  const registry = new ContentRegistry();
  registerJi(registry);
  const hero = registry.getHero(jiIds.hero);
  const initial = state();
  const actor = { ...initial.units['blue-1'], heroId: jiIds.hero, skillLevel: 1,
    skillLevels: { [jiIds.seasonCore]: 5, [jiIds.ultimate]: 1 } };
  initial.units[actor.unitId] = actor;
  const opening = hero.initialize(createBattleContext(initial, () => .5), actor.unitId);
  const openingStance = opening.find(command => command.type === 'add-status' && command.instance.statusId === jiIds.fourSeason);
  assert.deepEqual(openingStance.instance.duration, { kind: 'count', remaining: 3, owner: 'target-turn' });
  assert.equal(openingStance.instance.values.season, 'spring');
  const spring = hero.skills.find(skill => skill.id === jiIds.season);
  const active = { ...actor, statuses: [{ ...openingStance.instance }] };
  const recast = spring.execute(createBattleContext({ ...initial, units: { ...initial.units, [actor.unitId]: active } }, () => .5),
    { actorId: actor.unitId, skillId: jiIds.season, targetIds: [actor.unitId], shape: 'self', targetRelation: 'ally' });
  assert.ok(recast.some(command => command.type === 'change-resource' && command.resourceId === 'fire' && command.amount === 1));
  const lowSeasonRank = { ...actor, skillLevels: { [jiIds.seasonCore]: 1, [jiIds.ultimate]: 5 } };
  assert.deepEqual(hero.initialize(createBattleContext({ ...initial, units: { ...initial.units, [actor.unitId]: lowSeasonRank } }, () => .5),
    actor.unitId), [], '大招五级不能替代四时一隅五级先机');
});

test('季四季流转满4层后选择四季大葬并按生命损失追击最多3个目标', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const actor = { ...initial.units['blue-1'], heroId: jiIds.hero, skillLevel: 4, hp: 52,
    stats: { ...initial.units['blue-1'].stats, hp: 100, crit: 100, critDamage: 1.8 }, statuses: [
      { instanceId: 'four-season', statusId: jiIds.fourSeason, source: { kind: 'skill', id: jiIds.season, unitId: 'blue-1' },
        stacks: 4, duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, values: { season: 'spring' } },
    ] };
  const second = { ...initial.units['red-1'], unitId: 'red-2', hp: 50, stats: { ...initial.units['red-1'].stats, hp: 100 } };
  initial.units[actor.unitId] = actor; initial.units[second.unitId] = second;
  initial.sides.red = [...initial.sides.red, second.unitId];
  const hero = registry.getHero(jiIds.hero);
  const intent = hero.policy(createBattleContext(initial, () => .5), actor.unitId);
  assert.equal(intent.skillId, jiIds.greatUltimate);
  const skill = hero.skills.find(item => item.id === jiIds.greatUltimate);
  const commands = skill.execute(createBattleContext(initial, () => .5), intent, skill.levels[3]);
  assert.equal(commands.length, 10, '2个敌人各受3段群攻，再各受2段追加攻击');
  assert.ok(commands.every(command => command.isCritical === false));
});

test('季的自动选招先补四时姿态与四季流转，满4层且有鬼火时才选四季大葬', () => {
  const registry = new ContentRegistry();
  registerJi(registry);
  const hero = registry.getHero(jiIds.hero);
  const policyAt = (stacks, fire) => {
    const initial = state();
    const actor = { ...initial.units['blue-1'], heroId: jiIds.hero, statuses: stacks === undefined ? [] : [
      { instanceId: 'four-season', statusId: jiIds.fourSeason, source: { kind: 'skill', id: jiIds.season, unitId: 'blue-1' },
        stacks, duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, values: { season: 'autumn' } },
    ] };
    initial.units[actor.unitId] = actor;
    initial.resources.blue.fire = fire;
    return hero.policy(createBattleContext(initial, () => .5), actor.unitId);
  };
  assert.equal(policyAt(undefined, 4).skillId, jiIds.autumn, '有3火时也先建立姿态');
  assert.equal(policyAt(3, 4).skillId, jiIds.autumn, '姿态层数不足4时继续补层');
  assert.equal(policyAt(4, 3).skillId, jiIds.greatUltimate, '满4层后使用四季大葬');
  assert.equal(policyAt(undefined, 1).skillId, jiIds.basic, '鬼火不足时退回普攻');
});

test('季夏季灵命中时按30%概率封印目标被动和御魂', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: jiIds.hero, statuses: [] };
  initial.units['red-1'] = { ...initial.units['red-1'], statuses: [{ instanceId: 'summer-spirit', statusId: jiIds.seasonSpirit,
    source: { kind: 'skill', id: jiIds.season, unitId: 'blue-1' }, stacks: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, values: { ownerUnitId: 'blue-1', season: 'summer' } }] };
  const event = { eventId: 'summer-spirit-end', phase: 'turn-end', source: { kind: 'unit', id: '1', unitId: 'red-1' },
    type: 'turn-ended', unitId: 'red-1' };
  const commands = registry.getStatus(jiIds.seasonSpirit).handlers['turn-end'].handle(createBattleContext(initial, () => .1), event);
  assert.ok(commands.some(command => command.type === 'add-status' && command.instance.statusId === passiveSuppressionStatusId));
  assert.ok(commands.some(command => command.type === 'add-status' && command.instance.statusId === soulSuppressionStatusId));
  assert.equal(commands.find(command => command.type === 'add-status' && command.instance.statusId === passiveSuppressionStatusId).parentEventId,
    event.eventId);
});

test('季四时姿态限制非春季治疗，仍记录被拦截的治疗事件', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const actor = { ...initial.units['blue-1'], heroId: jiIds.hero, hp: 40, stats: { ...initial.units['blue-1'].stats, hp: 100 },
    statuses: [{ instanceId: 'ji-stance', statusId: jiIds.fourSeason, source: { kind: 'skill', id: jiIds.season, unitId: 'blue-1' },
      stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, values: { season: 'summer' } }] };
  initial.units[actor.unitId] = actor;
  const blocked = applyEffectCommands(initial, [
    { type: 'heal', source: { kind: 'skill', id: '3063', unitId: 'red-1' }, targetId: actor.unitId, amount: 20 },
    { type: 'restore-health', source: { kind: 'soul', id: 'soul:300006', unitId: actor.unitId }, targetId: actor.unitId, amount: 20 },
  ], 'effect-resolution', 'ji-heal-block-test', id => registry.getStatus(id));
  assert.equal(blocked.state.units[actor.unitId].hp, 40);
  assert.equal(blocked.events.filter(event => event.type === 'healing-blocked').length, 2);
  const spring = applyEffectCommands(initial, [{ type: 'heal', source: { kind: 'skill', id: jiIds.season, unitId: actor.unitId },
    targetId: actor.unitId, amount: 20 }], 'effect-resolution', 'ji-spring-heal-test', id => registry.getStatus(id));
  assert.equal(spring.state.units[actor.unitId].hp, 60);
});

test('季冬姿态入场给友方抵抗，受击后降低攻击者暴击伤害', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const actor = { ...initial.units['blue-1'], heroId: jiIds.hero, skillLevel: 4, hp: 100, stats: { ...initial.units['blue-1'].stats, hp: 100 } };
  initial.units[actor.unitId] = actor;
  const hero = registry.getHero(jiIds.hero);
  const winter = hero.skills.find(item => item.id === jiIds.winter);
  const commands = winter.execute(createBattleContext(initial, () => .5),
    { actorId: actor.unitId, skillId: winter.id, targetIds: [actor.unitId], shape: 'self', targetRelation: 'ally' }, winter.levels[3]);
  const applied = applyEffectCommands(initial, commands, 'effect-resolution', 'ji-winter-test', id => registry.getStatus(id));
  assert.equal(createBattleContext(applied.state, () => .5).getEffectiveStats(actor.unitId).resist, .5);
  const hit = { eventId: 'winter-hit', phase: 'hit', source: { kind: 'skill', id: 'enemy-skill', unitId: 'red-1' },
    type: 'damage', targetId: actor.unitId, damageKind: 'normal', amount: 10, hpLost: 10, mitigated: 0, isCritical: false };
  const chill = hero.handlers.hit.handle(createBattleContext(applied.state, () => .5), hit);
  assert.equal(chill[0].targetId, 'red-1');
  assert.equal(chill[0].instance.modifiers[0].amount, -.3);
  assert.equal(chill[0].parentEventId, hit.eventId);
});

test('季友方式神施放技能后为目标附加季灵，秋季季灵在目标回合末造成120%攻击伤害', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const ji = { ...initial.units['blue-1'], heroId: jiIds.hero, skillLevel: 5, stats: { ...initial.units['blue-1'].stats, attack: 100 },
    statuses: [{ instanceId: 'ji-stance', statusId: jiIds.fourSeason, source: { kind: 'skill', id: jiIds.season, unitId: 'blue-1' },
      stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, values: { season: 'autumn' } }] };
  const ally = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 1 };
  initial.units[ji.unitId] = ji; initial.units[ally.unitId] = ally;
  initial.sides.blue = [...initial.sides.blue, ally.unitId];
  const hero = registry.getHero(jiIds.hero);
  const actionEnd = { eventId: 'ally-action-end', phase: 'action-end', source: { kind: 'skill', id: 'ally-skill', unitId: ally.unitId },
    actionId: 9, type: 'action-ended', skillId: 'ally-skill', actionKind: 'skill', soulTriggersAllowed: true,
    intent: { actorId: ally.unitId, skillId: 'ally-skill', targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' } };
  const attach = hero.handlers['action-end'].handle(createBattleContext(initial, () => .5), actionEnd);
  const marked = applyEffectCommands(initial, attach, 'action-end', 'ji-spirit-attach', id => registry.getStatus(id));
  const spirit = marked.state.units['red-1'].statuses.find(status => status.statusId === jiIds.seasonSpirit);
  assert.equal(spirit.duration.remaining, 3);
  assert.equal(spirit.values.season, 'autumn');
  const turnEnd = { eventId: 'spirit-target-turn-end', phase: 'turn-end', source: { kind: 'unit', id: '1', unitId: 'red-1' },
    type: 'turn-ended', unitId: 'red-1' };
  const spiritCommands = registry.getStatus(jiIds.seasonSpirit).handlers['turn-end'].handle(
    createBattleContext(marked.state, () => .5), turnEnd);
  assert.equal(spiritCommands[0].amount, 120);
  assert.equal(spiritCommands[0].parentEventId, turnEnd.eventId);
});

test('季四级四时一隅后季灵攻击怪物改为真实伤害', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const actor = { ...initial.units['blue-1'], heroId: jiIds.hero, skillLevel: 1,
    skillLevels: { [jiIds.seasonCore]: 4 }, stats: { ...initial.units['blue-1'].stats, attack: 100 } };
  const target = { ...initial.units['red-1'], unitKind: 'monster', hp: 1000,
    stats: { ...initial.units['red-1'].stats, hp: 1000, defense: 300 }, statuses: [{
      instanceId: 'ji-monster-spirit', statusId: jiIds.seasonSpirit,
      source: { kind: 'skill', id: jiIds.season, unitId: actor.unitId }, stacks: 1,
      duration: { kind: 'count', remaining: 3, owner: 'target-turn' },
      values: { ownerUnitId: actor.unitId, season: 'autumn' },
    }] };
  initial.units[actor.unitId] = actor;
  initial.units[target.unitId] = target;
  const event = { eventId: 'ji-monster-turn-end', phase: 'turn-end', source: { kind: 'unit', id: 'monster', unitId: target.unitId },
    type: 'turn-ended', unitId: target.unitId };
  const handler = registry.getStatus(jiIds.seasonSpirit).handlers['turn-end'].handle;
  const rankFourHit = handler(createBattleContext(initial, () => .5), event)[0];
  assert.equal(rankFourHit.damageKind, 'true');
  assert.equal(rankFourHit.amount, 120);

  const rankThreeActor = { ...actor, skillLevels: { [jiIds.seasonCore]: 3 } };
  const rankThreeState = { ...initial, units: { ...initial.units, [actor.unitId]: rankThreeActor } };
  const rankThreeHit = handler(createBattleContext(rankThreeState, () => .5), event)[0];
  assert.equal(rankThreeHit.damageKind, undefined);
  assert.equal(rankThreeHit.amount, 60, '三级季灵仍按目标防御结算');
});

test('季春季在友方技能后治疗，夏季在友方技能后提供速度与效果命中', () => {
  const registry = createMigratedContentRegistry();
  const initial = state();
  const ji = { ...initial.units['blue-1'], heroId: jiIds.hero, skillLevel: 5, hp: 70,
    statuses: [{ instanceId: 'ji-spring', statusId: jiIds.fourSeason, source: { kind: 'skill', id: jiIds.season, unitId: 'blue-1' },
      stacks: 1, duration: { kind: 'count', remaining: 3, owner: 'target-turn' }, values: { season: 'spring' } }] };
  const ally = { ...initial.units['blue-1'], unitId: 'blue-2', hp: 50 };
  initial.units[ji.unitId] = ji; initial.units[ally.unitId] = ally;
  initial.sides.blue = [...initial.sides.blue, ally.unitId];
  const hero = registry.getHero(jiIds.hero);
  const event = { eventId: 'spring-ally-skill', phase: 'action-end', source: { kind: 'skill', id: 'ally-skill', unitId: ally.unitId },
    actionId: 4, type: 'action-ended', skillId: 'ally-skill', actionKind: 'skill', soulTriggersAllowed: true,
    intent: { actorId: ally.unitId, skillId: 'ally-skill', targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' } };
  const springCommands = hero.handlers['action-end'].handle(createBattleContext(initial, () => .5), event);
  const springApplied = applyEffectCommands(initial, springCommands, 'action-end', 'ji-spring-action', id => registry.getStatus(id));
  assert.equal(springApplied.state.units[ally.unitId].hp, 58);
  assert.equal(springApplied.state.units[ji.unitId].hp, 78);

  const summerState = { ...initial, units: { ...initial.units, [ji.unitId]: { ...ji, statuses: [{ ...ji.statuses[0], values: { season: 'summer' } }] } } };
  const summerCommands = hero.handlers['action-end'].handle(createBattleContext(summerState, () => .5), event);
  const summerApplied = applyEffectCommands(summerState, summerCommands, 'action-end', 'ji-summer-action', id => registry.getStatus(id));
  const favor = summerApplied.state.units[ally.unitId].statuses.find(status => status.statusId === jiIds.summerFavor);
  assert.equal(favor.duration.remaining, 2);
  assert.equal(favor.modifiers.find(modifier => modifier.stat === 'speed').amount, 30);
  assert.equal(favor.modifiers.find(modifier => modifier.stat === 'hit').amount, .3);
});

test('茨木童子地狱之手消耗3火，迁怒非击杀攻击获得怒火且怒火按层提高伤害', () => {
  const registry = new ContentRegistry();
  registerIbarakiDoji(registry);
  const hero = registry.getHero(ibarakiDojiIds.hero);
  const ultimate = hero.skills.find(skill => skill.id === ibarakiDojiIds.ultimate);
  assert.equal(ultimate.resourceCost.amount, 3);
  assert.deepEqual(ultimate.levels.map(level => level.ratio), [4.6, 5, 5.4, 5.8, 6.2]);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: ibarakiDojiIds.hero, awakeFilter: 0 };
  const event = { eventId: 'ibaraki-basic-end', phase: 'attack-end', source: { kind: 'skill', id: ibarakiDojiIds.basic,
    unitId: 'blue-1' }, type: 'attack-ended', hitCount: 1, targetHealthChanges: [{ targetId: 'red-1', hpBefore: 60, hpAfter: 0,
      hpLost: 60, defeatedByHit: true, overkillDamage: 20 }] };
  const commands = hero.handlers['attack-end'].handle(createBattleContext(initial, () => .5), event);
  assert.equal(commands[0].amount, 10, '普通式神击杀触发迁怒溅射而不是叠怒火');
  event.targetHealthChanges = [{ targetId: 'red-1', hpBefore: 60, hpAfter: 20, hpLost: 40, defeatedByHit: false }];
  const gain = hero.handlers['attack-end'].handle(createBattleContext(initial, () => .5), event);
  assert.equal(gain[0].instance.statusId, ibarakiDojiIds.rage);
  assert.equal(gain[0].instance.stacks, 1);
  const attacker = { ...initial.units['blue-1'], statuses: [{ ...gain[0].instance, stacks: 2 }] };
  initial.units['blue-1'] = attacker;
  const powered = ultimate.execute(createBattleContext(initial, () => .99), { actorId: 'blue-1', skillId: ibarakiDojiIds.ultimate,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, { ratio: 4.6 });
  assert.equal(powered[0].amount, 660, '两层怒火给技能倍率增加200%攻击系数');
});

test('茨木童子迁怒按实际扣盾后的致死溢出伤害比例溅射', () => {
  const registry = new ContentRegistry();
  registerIbarakiDoji(registry);
  const hero = registry.getHero(ibarakiDojiIds.hero);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: ibarakiDojiIds.hero, awakeFilter: 0,
    stats: { ...initial.units['blue-1'].stats, attack: 100, crit: 0 } };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 30, shield: 10, stats: { ...initial.units['red-1'].stats, hp: 30 } };
  initial.units['red-2'] = { ...initial.units['red-1'], unitId: 'red-2', hp: 500, shield: 0, stats: { ...initial.units['red-1'].stats, hp: 500 } };
  initial.sides.red = ['red-1', 'red-2'];
  const outcome = executeAction(initial, { actorId: 'blue-1', skillId: ibarakiDojiIds.basic, targetIds: ['red-1'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .99);
  const ended = outcome.events.find(event => event.type === 'attack-ended');
  assert.equal(ended.targetHealthChanges[0].defeatedByHit, true);
  assert.equal(ended.targetHealthChanges[0].overkillDamage, 60, '100伤害先被10点护盾吸收，再溢出目标30点生命');
  const splash = hero.handlers['attack-end'].handle(createBattleContext(outcome.state, () => .5), ended);
  assert.deepEqual(splash.map(command => [command.targetId, command.amount]), [['red-2', 30]], '未觉醒分支按50%过量伤害溅射');
  const awakened = { ...outcome.state, units: { ...outcome.state.units,
    'blue-1': { ...outcome.state.units['blue-1'], awakeFilter: 1 } } };
  const awakenedSplash = hero.handlers['attack-end'].handle(createBattleContext(awakened, () => .5), ended);
  assert.deepEqual(awakenedSplash.map(command => command.amount), [60], '觉醒分支按100%过量伤害溅射');
});

test('茨木童子每损失30%最大生命叠怒火，满3层生成一次致命保护', () => {
  const registry = new ContentRegistry();
  registerIbarakiDoji(registry);
  const hero = registry.getHero(ibarakiDojiIds.hero);
  const initial = state();
  const tracker = { instanceId: 'life-tracker', statusId: ibarakiDojiIds.lifeTracker,
    source: { kind: 'skill', id: ibarakiDojiIds.passive, unitId: 'blue-1' }, stacks: 1,
    duration: { kind: 'permanent' }, values: { hpLossProgress: 0 } };
  const rage = { ...tracker, instanceId: 'rage', statusId: ibarakiDojiIds.rage, stacks: 2, values: {} };
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: ibarakiDojiIds.hero, hp: 700, stats: { ...initial.units['blue-1'].stats,
    hp: 1000 }, statuses: [tracker, rage] };
  const hitEvent = { eventId: 'ibaraki-third-rage', phase: 'hit', source: { kind: 'skill', id: 'enemy-hit', unitId: 'red-1' },
    type: 'damage', targetId: 'blue-1', amount: 300, hpBefore: 1000, hpAfter: 700, hpLost: 300, mitigated: 0, isCritical: false };
  const commands = hero.handlers.hit.handle(createBattleContext(initial, () => .5), hitEvent);
  assert.equal(commands.find(command => command.type === 'add-status' && command.instance.statusId === ibarakiDojiIds.rage).instance.stacks, 1);
  assert.ok(commands.some(command => command.type === 'add-status' && command.instance.statusId === ibarakiDojiIds.fatalGuard));
  const applied = applyEffectCommands(initial, commands, 'hit', 'ibaraki-third-rage-result', id => registry.getStatus(id));
  assert.equal(applied.state.units['blue-1'].statuses.find(status => status.statusId === ibarakiDojiIds.rage).stacks, 3);
  const lethal = applyEffectCommands({ ...applied.state, units: { ...applied.state.units,
    'blue-1': { ...applied.state.units['blue-1'], hp: 100 } } }, [{ type: 'deal-damage', source: hitEvent.source,
      targetId: 'blue-1', amount: 200 }], 'hit', 'ibaraki-fatal-hit', id => registry.getStatus(id));
  assert.equal(lethal.state.units['blue-1'].hp, 1);
  assert.equal(lethal.state.units['blue-1'].statuses.some(status => status.statusId === ibarakiDojiIds.fatalGuard), false,
    '致命保护挡下一次伤害后消耗');
});

test('白藏主普攻降攻、回合末护盾按单次伤害比例吸收并按自身生命上限封顶', () => {
  const registry = new ContentRegistry(); registerWhiteFox(registry);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: whiteFoxIds.hero, skillLevel: 3,
    stats: { ...initial.units['blue-1'].stats, hp: 1000, attack: 100, crit: 0 } };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 1, hp: 1000 };
  initial.sides.blue = ['blue-1', 'blue-2'];
  const hero = registry.getHero(whiteFoxIds.hero);
  const buff = hero.handlers['turn-end'].handle(createBattleContext(initial), { eventId: 'white-fox-end', phase: 'turn-end',
    type: 'turn-ended', unitId: 'blue-1', source: { kind: 'unit', id: 'blue-1', unitId: 'blue-1' } });
  assert.equal(buff.length, 1);
  const buffed = applyEffectCommands(initial, buff, 'turn-end', 'white-fox-shield', id => registry.getStatus(id)).state;
  const ally = buffed.units['blue-2'];
  const interception = hero.interceptIncomingDamage(buffed, buffed.units['red-1'], ally, 100, 'normal', {
    source: { kind: 'skill', id: 'enemy-skill', unitId: 'red-1' }, attackId: 1, hitIndex: 0,
    targetIds: ['blue-2'], attackShape: 'single', battle: createBattleContext(buffed), isUnitUnableToAct: () => false,
  });
  assert.equal(interception.amount, 60, '被动三级护盾每次吸收40%');
  assert.equal(interception.effects[0].instance.values.capacityRemaining, 60, '初始封顶为白藏主生命上限的10%');
  const basic = hero.skills.find(skill => skill.id === whiteFoxIds.basic);
  const debuffCommands = basic.execute(createBattleContext(initial, () => .5), { actorId: 'blue-1', skillId: whiteFoxIds.basic,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, { ratio: 1.25 });
  assert.ok(debuffCommands.some(command => command.type === 'add-status' && command.instance.statusId === whiteFoxIds.attackDown));
  assert.equal(debuffCommands.find(command => command.instance?.statusId === whiteFoxIds.attackDown).instance.modifiers[0].amount, -.1);
  const removed = { eventId: 'white-fox-shield-break', phase: 'effect-resolution', type: 'status-removed', targetId: 'blue-2',
    instanceId: 'white-fox-shield', statusId: whiteFoxIds.shield, reason: 'consumed', attackId: 9,
    source: { kind: 'skill', id: 'enemy-skill', unitId: 'red-1' },
    removedSource: { kind: 'skill', id: whiteFoxIds.passive, unitId: 'blue-1' } };
  const retaliation = hero.handlers['effect-resolution'].handle(createBattleContext(buffed, () => .5), removed);
  assert.equal(retaliation.find(command => command.type === 'lose-life').amount, 100);
  assert.ok(retaliation.some(command => command.type === 'add-status' && command.instance.statusId === whiteFoxIds.critDown));
});

test('白藏主结界按等级减免单体伤害并守护生命比例最低的队友', () => {
  const registry = new ContentRegistry(); registerWhiteFox(registry);
  const initial = state();
  const fox = { ...initial.units['blue-1'], heroId: whiteFoxIds.hero, skillLevel: 5, hp: 600 };
  const low = { ...initial.units['blue-1'], unitId: 'blue-2', hp: 100 };
  const high = { ...initial.units['blue-1'], unitId: 'blue-3', hp: 500 };
  initial.units[fox.unitId] = fox; initial.units[low.unitId] = low; initial.units[high.unitId] = high;
  initial.sides.blue = [fox.unitId, low.unitId, high.unitId]; initial.resources.blue.fire = 3;
  const hero = registry.getHero(whiteFoxIds.hero);
  const passiveAura = hero.initialize(createBattleContext(initial), fox.unitId)[0];
  assert.deepEqual(passiveAura.instance.modifiers.map(modifier => modifier.amount), [60, .6], '五级被动无队友持盾时提供60速度和60%抵抗');
  const ultimate = hero.skills.find(skill => skill.id === whiteFoxIds.ultimate);
  assert.equal(ultimate.resourceCostsByLevel[5].amount, 2);
  const fieldCommand = ultimate.execute(createBattleContext(initial), { actorId: fox.unitId, skillId: whiteFoxIds.ultimate,
    targetIds: initial.sides.blue, shape: 'all-allies', targetRelation: 'ally' }, { reduction: .5, duration: 2 })[0];
  const fieldState = applyEffectCommands(initial, [fieldCommand], 'action-end', 'white-fox-field', id => registry.getStatus(id)).state;
  const guardCommands = hero.handlers['turn-start'].handle(createBattleContext(fieldState), { eventId: 'white-fox-turn-start',
    phase: 'turn-start', type: 'turn-started', unitId: low.unitId, source: { kind: 'unit', id: low.unitId, unitId: low.unitId } });
  assert.equal(guardCommands[0].instance.values.targetId, low.unitId);
  const guardedState = applyEffectCommands(fieldState, guardCommands, 'turn-start', 'white-fox-guard', id => registry.getStatus(id)).state;
  const hit = hero.interceptIncomingDamage(guardedState, guardedState.units['red-1'], low, 100, 'normal', {
    source: { kind: 'skill', id: 'enemy-skill', unitId: 'red-1' }, attackId: 2, hitIndex: 0,
    targetIds: [low.unitId], attackShape: 'single', battle: createBattleContext(guardedState), isUnitUnableToAct: () => false,
  });
  assert.equal(hit.amount, 0);
  assert.equal(hit.effects[0].targetId, fox.unitId);
  assert.equal(hit.effects[0].amount, 50, '结界减免50%后由白藏主代受');
});

test('人面树神木按防御普攻，敌方回合结束种花、满三层反伤并在自身回合末清算', () => {
  const registry = new ContentRegistry(); registerHumanFacedTree(registry);
  const initial = state();
  const tree = { ...initial.units['blue-1'], heroId: humanFacedTreeIds.hero, skillLevel: 5, awakeFilter: 1, hp: 1000,
    stats: { ...initial.units['blue-1'].stats, attack: 20, defense: 300, crit: 0 } };
  const enemy = { ...initial.units['red-1'], hp: 1000, stats: { ...initial.units['red-1'].stats, hp: 1000, defense: 150 } };
  initial.units[tree.unitId] = tree; initial.units[enemy.unitId] = enemy;
  const hero = registry.getHero(humanFacedTreeIds.hero);
  const basic = hero.skills.find(skill => skill.id === humanFacedTreeIds.basic);
  const normalHit = basic.execute(createBattleContext(initial, () => .5), { actorId: tree.unitId, skillId: basic.id,
    targetIds: [enemy.unitId], shape: 'single', targetRelation: 'enemy' }, { ratio: 1.25 });
  assert.equal(normalHit[0].amount, 250, '普攻以300点防御作伤害基数，再按敌方150防御结算');
  const endEvent = { eventId: 'tree-enemy-turn-end', phase: 'turn-end', type: 'turn-ended', unitId: enemy.unitId,
    source: { kind: 'unit', id: enemy.unitId, unitId: enemy.unitId } };
  const markCommands = hero.handlers['turn-end'].handle(createBattleContext(initial, () => .5), endEvent);
  assert.equal(markCommands[0].instance.statusId, humanFacedTreeIds.flower);
  const flower = { instanceId: 'tree-flower', statusId: humanFacedTreeIds.flower, source: { kind: 'skill', id: humanFacedTreeIds.basic, unitId: tree.unitId },
    stacks: 3, duration: { kind: 'count', remaining: 99, owner: 'target-turn' } };
  initial.units[enemy.unitId] = { ...enemy, statuses: [flower] };
  const ownEnd = { eventId: 'tree-own-turn-end', phase: 'turn-end', type: 'turn-ended', unitId: tree.unitId,
    source: { kind: 'unit', id: tree.unitId, unitId: tree.unitId } };
  const passiveCommands = hero.handlers['turn-end'].handle(createBattleContext(initial, () => .5), ownEnd);
  assert.equal(passiveCommands[0].type, 'remove-status-instances');
  assert.equal(passiveCommands[1].amount, 1890, '五级被动按每层105%防御，并按防御差最多翻倍');
  const dispelEvent = { eventId: 'tree-flower-dispelled', phase: 'effect-resolution', type: 'status-removed', targetId: enemy.unitId,
    instanceId: flower.instanceId, statusId: humanFacedTreeIds.flower, reason: 'dispelled', source: { kind: 'skill', id: 'dispel', unitId: 'red-1' },
    removedSource: flower.source };
  const dispelBuff = hero.handlers['effect-resolution'].handle(createBattleContext(initial, () => .5), dispelEvent);
  assert.equal(dispelBuff[0].instance.modifiers[0].amount, .05, '五级被动在灾厄花被驱散时获得5%防御');
  assert.equal(dispelBuff[0].instance.duration.remaining, 2);
});

test('人面树祸根六级耗2火、获得效果抵抗，并按标记层数造成间接伤害', () => {
  const registry = new ContentRegistry(); registerHumanFacedTree(registry);
  const initial = state();
  const tree = { ...initial.units['blue-1'], heroId: humanFacedTreeIds.hero, skillLevel: 6, awakeFilter: 1,
    stats: { ...initial.units['blue-1'].stats, attack: 20, defense: 300 } };
  const enemy = { ...initial.units['red-1'], statuses: [{ instanceId: 'tree-flower-active', statusId: humanFacedTreeIds.flower,
    source: { kind: 'skill', id: humanFacedTreeIds.basic, unitId: tree.unitId }, stacks: 2,
    duration: { kind: 'count', remaining: 99, owner: 'target-turn' } }] };
  initial.units[tree.unitId] = tree; initial.units[enemy.unitId] = enemy;
  const hero = registry.getHero(humanFacedTreeIds.hero);
  const ultimate = hero.skills.find(skill => skill.id === humanFacedTreeIds.ultimate);
  assert.equal(ultimate.resourceCostsByLevel[5].amount, 2);
  const commands = ultimate.execute(createBattleContext(initial), { actorId: tree.unitId, skillId: ultimate.id,
    targetIds: [enemy.unitId], shape: 'all-enemies', targetRelation: 'enemy' }, { ratio: 2.48, resist: .2, duration: 3 });
  assert.equal(commands[0].instance.modifiers[0].amount, .2);
  assert.equal(commands[2].amount, 1488, '祸根按248%防御乘两层标记结算间接伤害');
  assert.equal(commands[2].lifeLossKind, 'indirect');
});

test('於菊虫毒液按技能等级加毒，被动随机引爆一层并升级毒素', () => {
  const registry = new ContentRegistry(); registerYujuworm(registry);
  const initial = state();
  const worm = { ...initial.units['blue-1'], heroId: yujuwormIds.hero, skillLevel: 3,
    stats: { ...initial.units['blue-1'].stats, attack: 100, crit: 0 } };
  const poison = { instanceId: 'old-poison', statusId: yujuwormIds.poison,
    source: { kind: 'skill', id: yujuwormIds.basic, unitId: 'blue-1' }, stacks: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, values: { poisonLevel: 2 } };
  const target = { ...initial.units['red-1'], statuses: [poison] };
  initial.units[worm.unitId] = worm; initial.units[target.unitId] = target;
  const hero = registry.getHero(yujuwormIds.hero);
  const event = { eventId: 'worm-hit-1', phase: 'hit', type: 'damage', targetId: target.unitId,
    source: { kind: 'skill', id: yujuwormIds.basic, unitId: worm.unitId }, amount: 100, hpLost: 100, mitigated: 0, isCritical: false };
  const commands = hero.handlers.hit.handle(createBattleContext(initial, () => .5), event);
  assert.equal(commands[0].type, 'remove-status-instances');
  assert.equal(commands[1].amount, 24, '三级被动按攻击12%乘毒等级2造成间接伤害');
  assert.ok(commands.some(command => command.type === 'add-status' && command.instance.statusId === yujuwormIds.poison
    && command.instance.values.poisonLevel === 3 && command.instance.duration.remaining === 3), '引爆后新增等级+1、持续+1回合的毒');
  assert.ok(commands.some(command => command.type === 'add-status' && command.instance.statusId === yujuwormIds.poison
    && command.instance.values.poisonLevel === 2), '普攻本身另按技能等级附加2级毒');
});

test('於菊虫祸根按优先未命中规则连射，五级降至2火并在凝视目标回合末造成伤害', () => {
  const registry = new ContentRegistry(); registerYujuworm(registry);
  const initial = state();
  const worm = { ...initial.units['blue-1'], heroId: yujuwormIds.hero, skillLevel: 5, awakeFilter: 1,
    stats: { ...initial.units['blue-1'].stats, attack: 100, crit: 0 } };
  initial.units[worm.unitId] = worm;
  initial.units['red-2'] = { ...initial.units['red-1'], unitId: 'red-2' };
  initial.sides.red = ['red-1', 'red-2'];
  const hero = registry.getHero(yujuwormIds.hero);
  const ultimate = hero.skills.find(skill => skill.id === yujuwormIds.ultimate);
  assert.equal(ultimate.resourceCostsByLevel[4].amount, 2);
  const commands = ultimate.execute(createBattleContext(initial, () => .1), { actorId: worm.unitId, skillId: ultimate.id,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, { ratio: .36, hits: 6 });
  assert.equal(commands.filter(command => command.type === 'deal-damage').length, 6);
  const tracker = commands[0].instance;
  initial.units[worm.unitId] = { ...worm, statuses: [tracker] };
  const ended = { eventId: 'worm-attack-end', phase: 'attack-end', type: 'attack-ended', hitCount: 6,
    source: { kind: 'skill', id: ultimate.id, unitId: worm.unitId } };
  const finish = hero.handlers['attack-end'].handle(createBattleContext(initial, () => .5), ended);
  assert.ok(finish.some(command => command.type === 'add-status' && command.instance.statusId === yujuwormIds.gaze));
  const tick = hero.handlers['turn-end'].handle(createBattleContext({ ...initial, units: { ...initial.units,
    'red-1': { ...initial.units['red-1'], statuses: finish.filter(command => command.type === 'add-status' && command.targetId === 'red-1')
      .map(command => command.instance) } } }), { eventId: 'worm-gaze-tick', phase: 'turn-end', type: 'turn-ended', unitId: 'red-1',
    source: { kind: 'unit', id: 'red-1', unitId: 'red-1' } });
  assert.equal(tick[0].amount, 105);
  assert.equal(tick[0].lifeLossKind, 'indirect');
});

test('於菊虫普攻在完整行动结算中触发被动爆毒事件', () => {
  const registry = new ContentRegistry(); registerYujuworm(registry);
  const initial = state();
  const worm = { ...initial.units['blue-1'], heroId: yujuwormIds.hero, skillLevel: 3,
    stats: { ...initial.units['blue-1'].stats, attack: 100, crit: 0 } };
  const poison = { instanceId: 'worm-existing-poison', statusId: yujuwormIds.poison,
    source: { kind: 'skill', id: yujuwormIds.basic, unitId: worm.unitId }, stacks: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, values: { poisonLevel: 1 } };
  initial.units[worm.unitId] = worm;
  initial.units['red-1'] = { ...initial.units['red-1'], statuses: [poison] };
  const dispatcher = new EventDispatcher();
  dispatcher.register({ id: `hero:${yujuwormIds.hero}:hit`, phase: 'hit', priority: 55,
    handle: registry.getHero(yujuwormIds.hero).handlers.hit.handle });
  const result = executeAction(initial, { actorId: worm.unitId, skillId: yujuwormIds.basic, targetIds: ['red-1'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .5,
    { dispatcher, resolveStatus: statusId => registry.getStatus(statusId) });
  assert.ok(result.events.some(event => event.type === 'life-lost' && event.source.id === yujuwormIds.passive),
    `命中事件会触发被动间接伤害: ${JSON.stringify(result.events.map(event => [event.type, event.source?.id, event.phase]))}`);
  assert.ok(result.state.units['red-1'].statuses.filter(status => status.statusId === yujuwormIds.poison).length >= 2,
    '完整行动包含引爆后的升级毒和普攻附毒');
});

test('桔梗破魔之箭按等级伤害并概率驱散一个增益，灵魂结界护盾吸收破盾溢出', () => {
  const registry = new ContentRegistry(); registerKikyo(registry);
  const initial = state();
  const kikyo = { ...initial.units['blue-1'], heroId: kikyoIds.hero, skillLevel: 2, awakeFilter: 1,
    stats: { ...initial.units['blue-1'].stats, attack: 100, crit: 0 } };
  const enemyBuff = { instanceId: 'enemy-buff', statusId: 'test-kikyo-buff', source: { kind: 'skill', id: 'test', unitId: 'red-1' },
    stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' } };
  initial.units[kikyo.unitId] = kikyo;
  initial.units['red-1'] = { ...initial.units['red-1'], statuses: [enemyBuff] };
  registry.registerStatus({ id: 'test-kikyo-buff', category: 'buff', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const hero = registry.getHero(kikyoIds.hero);
  const basicHit = hero.skills.find(skill => skill.id === kikyoIds.basic).execute(createBattleContext(initial, () => .5),
    { actorId: kikyo.unitId, skillId: kikyoIds.basic, targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, { ratio: .85 });
  assert.ok(basicHit[0].amount > 0);
  const hitEvent = { eventId: 'kikyo-basic-hit', phase: 'hit', type: 'damage', targetId: 'red-1',
    source: { kind: 'skill', id: kikyoIds.basic, unitId: kikyo.unitId }, amount: 85, hpLost: 85, mitigated: 0, isCritical: false };
  const dispel = hero.handlers.hit.handle(createBattleContext(initial, () => .1), hitEvent);
  assert.equal(dispel[0].type, 'dispel-statuses'); assert.equal(dispel[0].maxCount, 1);
  const barrier = hero.handlers['turn-end'].handle(createBattleContext(initial), { eventId: 'kikyo-turn-end', phase: 'turn-end',
    type: 'turn-ended', unitId: kikyo.unitId, source: { kind: 'unit', id: kikyo.unitId, unitId: kikyo.unitId } })[0];
  assert.equal(barrier.instance.values.shieldRemaining, 100);
  const shieldedState = applyEffectCommands(initial, [barrier], 'turn-end', 'kikyo-barrier', id => registry.getStatus(id)).state;
  const broken = hero.interceptIncomingDamage(shieldedState, shieldedState.units['red-1'], shieldedState.units[kikyo.unitId], 250, 'normal', {
    source: { kind: 'skill', id: 'heavy-hit', unitId: 'red-1' }, attackId: 3, hitIndex: 0, targetIds: [kikyo.unitId],
    attackShape: 'single', battle: createBattleContext(shieldedState), isUnitUnableToAct: () => false,
  });
  assert.equal(broken.amount, 0, '破盾的这一击及溢出伤害均由护盾吸收');
  assert.ok(broken.effects.some(command => command.type === 'add-status' && command.instance.statusId === kikyoIds.attackUp),
    '觉醒后破盾提升30%攻击');
});

test('桔梗破魔之矢禁止获得增益，五级标记被驱散后封印被动与御魂', () => {
  const registry = new ContentRegistry(); registerKikyo(registry);
  registry.registerStatus({ id: 'test-kikyo-buff', category: 'buff', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const initial = state();
  const kikyo = { ...initial.units['blue-1'], heroId: kikyoIds.hero, skillLevel: 5 };
  const mark = { instanceId: 'kikyo-mark', statusId: kikyoIds.sealBuffs, source: { kind: 'skill', id: kikyoIds.ultimate, unitId: kikyo.unitId },
    stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' } };
  const target = { ...initial.units['red-1'], statuses: [mark] };
  initial.units[kikyo.unitId] = kikyo; initial.units[target.unitId] = target;
  const hero = registry.getHero(kikyoIds.hero);
  const ultimate = hero.skills.find(skill => skill.id === kikyoIds.ultimate);
  assert.equal(ultimate.resourceCost.amount, 3);
  const commands = ultimate.execute(createBattleContext(initial, () => .5), { actorId: kikyo.unitId, skillId: ultimate.id,
    targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' }, { ratio: 3.02 });
  assert.ok(commands.some(command => command.type === 'add-status' && command.instance.statusId === kikyoIds.sealBuffs));
  const blocked = applyEffectCommands(initial, [{ type: 'add-status', source: { kind: 'skill', id: 'ally-buff', unitId: 'red-1' },
    targetId: target.unitId, instance: { instanceId: 'blocked-beneficial', statusId: 'test-kikyo-buff',
      source: { kind: 'skill', id: 'ally-buff', unitId: 'red-1' }, stacks: 1, duration: { kind: 'permanent' } } }],
    'effect-resolution', 'kikyo-buff-prevention', id => registry.getStatus(id));
  assert.equal(blocked.state.units[target.unitId].statuses.some(status => status.instanceId === 'blocked-beneficial'), false);
  const dispelled = hero.handlers['effect-resolution'].handle(createBattleContext({ ...initial, units: { ...initial.units,
    [target.unitId]: { ...target, statuses: [mark] } } }, () => .5), { eventId: 'kikyo-mark-dispelled', phase: 'effect-resolution',
    type: 'status-removed', targetId: target.unitId, instanceId: mark.instanceId, statusId: kikyoIds.sealBuffs,
    reason: 'dispelled', source: { kind: 'skill', id: 'enemy-dispel', unitId: target.unitId }, removedSource: mark.source });
  assert.ok(dispelled.some(command => command.type === 'add-status' && command.instance.statusId === kikyoIds.sealPassivesSouls
    && command.instance.values.sealPassives === true && command.instance.values.sealSouls === true));
});

test('一反木绵缠击降伤，雪织绑缚偷属性、回合叠层、受普攻减层且复施引爆', () => {
  const registry = new ContentRegistry(); registerIttanMomen(registry);
  const initial = state();
  const actor = { ...initial.units['blue-1'], heroId: ittanMomenIds.hero, skillLevel: 5,
    stats: { ...initial.units['blue-1'].stats, attack: 100, hp: 1000 }, hp: 1000 };
  const firstTarget = { ...initial.units['red-1'], hp: 2000,
    stats: { ...initial.units['red-1'].stats, hp: 2000, hit: .5 } };
  const secondTarget = { ...firstTarget, unitId: 'red-2', hp: 2000 };
  initial.units[actor.unitId] = actor; initial.units[firstTarget.unitId] = firstTarget; initial.units[secondTarget.unitId] = secondTarget;
  initial.sides.red = ['red-1', 'red-2'];
  const dispatcher = new EventDispatcher();
  const hero = registry.getHero(ittanMomenIds.hero);
  for (const [phase, rule] of Object.entries(hero.handlers)) dispatcher.register({ id: `hero:${ittanMomenIds.hero}:${phase}`,
    phase, priority: rule.priority, handle: rule.handle });

  const basic = executeAction(initial, { actorId: actor.unitId, skillId: ittanMomenIds.basic, targetIds: [firstTarget.unitId],
    shape: 'single', targetRelation: 'enemy' }, registry, () => 0,
    { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(basic.events.find(event => event.type === 'damage').actionKind, 'basic');
  assert.ok(basic.state.units[firstTarget.unitId].statuses.some(status => status.statusId === ittanMomenIds.obstruction));
  assert.equal(effectiveDamageTakenMultiplier(basic.state.units[firstTarget.unitId]), .85);

  const bound = executeAction(basic.state, { actorId: actor.unitId, skillId: ittanMomenIds.bind, targetIds: [firstTarget.unitId],
    shape: 'single', targetRelation: 'enemy' }, registry, () => 0,
    { dispatcher, resolveStatus: id => registry.getStatus(id) });
  let wrap = bound.state.units[firstTarget.unitId].statuses.find(status => status.statusId === ittanMomenIds.wrap);
  assert.equal(bound.state.resources.blue.fire, 3, '雪织支付1火');
  assert.equal(wrap.stacks, 3);
  assert.equal(effectiveStats(bound.state.units[firstTarget.unitId]).speed, 75);
  assert.equal(effectiveStats(bound.state.units[firstTarget.unitId]).hit, .3);
  assert.equal(effectiveStats(bound.state.units[actor.unitId]).hit, .2, '偷取的40%效果命中转为一反木绵增益');

  const basicAttacker = { id: 1, skills: [{ id: 'test-basic-attack', actionKind: 'basic', target: 'single',
    targetRelation: 'enemy', levels: [{}], execute(_context, intent) { return [{ type: 'deal-damage',
      source: { kind: 'skill', id: 'test-basic-attack', unitId: intent.actorId }, targetId: intent.targetIds[0], amount: 10 }]; } }] };
  registry.registerHero(basicAttacker);
  const struck = executeAction(bound.state, { actorId: secondTarget.unitId, skillId: 'test-basic-attack', targetIds: [actor.unitId],
    shape: 'single', targetRelation: 'enemy' }, registry, () => 0,
    { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(struck.events.find(event => event.type === 'damage').actionKind, 'basic');
  wrap = struck.state.units[firstTarget.unitId].statuses.find(status => status.statusId === ittanMomenIds.wrap);
  assert.equal(wrap.stacks, 2, '一反木绵受到普攻时缠绕减1层');

  const targetTurnEnd = { eventId: 'wrap-target-turn-end', phase: 'turn-end', type: 'turn-ended', unitId: firstTarget.unitId,
    source: { kind: 'unit', id: firstTarget.unitId, unitId: firstTarget.unitId } };
  const tick = settleEvents(struck.state, [targetTurnEnd], dispatcher, () => 0, new TriggerBudget(32), id => registry.getStatus(id));
  wrap = tick.state.units[firstTarget.unitId].statuses.find(status => status.statusId === ittanMomenIds.wrap);
  assert.equal(wrap.stacks, 3, '缠绕目标回合结束自动叠1层');

  const detonated = executeAction(tick.state, { actorId: actor.unitId, skillId: ittanMomenIds.bind, targetIds: [firstTarget.unitId],
    shape: 'single', targetRelation: 'enemy' }, registry, () => 0,
    { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(detonated.state.units[firstTarget.unitId].statuses.some(status => status.statusId === ittanMomenIds.wrap), false);
  assert.equal(detonated.state.units[actor.unitId].statuses.some(status => status.statusId === ittanMomenIds.stolenStats), false);
  assert.equal(detonated.state.resources.blue.fire, 2, '复施雪织仍支付1火');
});

test('一反木绵绯夜散华分别攻击选中与缠绕目标各四段、叠缠绕且多目标不返火', () => {
  const registry = new ContentRegistry(); registerIttanMomen(registry);
  const initial = state();
  const actor = { ...initial.units['blue-1'], heroId: ittanMomenIds.hero, skillLevel: 5,
    stats: { ...initial.units['blue-1'].stats, attack: 100, hp: 1000 }, hp: 1000 };
  const selected = { ...initial.units['red-1'], hp: 5000, stats: { ...initial.units['red-1'].stats, hp: 5000 } };
  const wrapped = { ...selected, unitId: 'red-2', hp: 5000, statuses: [{ instanceId: 'wrapped', statusId: ittanMomenIds.wrap,
    source: { kind: 'skill', id: ittanMomenIds.bind, unitId: actor.unitId }, stacks: 2,
    duration: { kind: 'permanent' }, values: { ownerUnitId: actor.unitId, hit: 0 } }] };
  initial.units[actor.unitId] = actor; initial.units[selected.unitId] = selected; initial.units[wrapped.unitId] = wrapped;
  initial.sides.red = [selected.unitId, wrapped.unitId];
  const dispatcher = new EventDispatcher(), hero = registry.getHero(ittanMomenIds.hero);
  dispatcher.register({ id: `hero:${ittanMomenIds.hero}:effect-resolution`, phase: 'effect-resolution', priority: 77,
    handle: hero.handlers['effect-resolution'].handle });
  const result = executeAction(initial, { actorId: actor.unitId, skillId: ittanMomenIds.ultimate, targetIds: [selected.unitId],
    shape: 'single', targetRelation: 'enemy' }, registry, () => 0,
    { dispatcher, resolveStatus: id => registry.getStatus(id) });
  const hits = result.events.filter(event => event.type === 'damage' && event.source.id === ittanMomenIds.ultimate);
  assert.equal(hits.length, 8);
  assert.equal(hits.filter(event => event.targetId === selected.unitId).length, 4);
  assert.equal(hits.filter(event => event.targetId === wrapped.unitId).length, 4);
  assert.ok(hits.every(event => event.actionKind === 'skill'));
  assert.equal(result.state.units[wrapped.unitId].statuses.find(status => status.statusId === ittanMomenIds.wrap).stacks, 3);
  assert.equal(result.state.resources.blue.fire, 1, '攻击两个不同目标后不返还鬼火');

  const oneTarget = { ...initial, units: { ...initial.units, 'red-2': undefined }, sides: { ...initial.sides, red: [selected.unitId] } };
  delete oneTarget.units['red-2'];
  const single = executeAction(oneTarget, { actorId: actor.unitId, skillId: ittanMomenIds.ultimate, targetIds: [selected.unitId],
    shape: 'single', targetRelation: 'enemy' }, registry, () => 0,
    { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(single.events.filter(event => event.type === 'damage' && event.source.id === ittanMomenIds.ultimate).length, 4);
  assert.equal(single.state.resources.blue.fire, 3, '五级大招只攻击一个目标返还2火');
});

test('入殓师离魂叠加与回合后生命损失、普攻清除魂隙，棺中人按敌方耗火反击', () => {
  const registry = new ContentRegistry(); registerEmbalmer(registry);
  const initial = state();
  const actor = { ...initial.units['blue-1'], heroId: embalmerIds.hero, skillLevel: 5,
    stats: { ...initial.units['blue-1'].stats, attack: 100, hp: 1000, defense: 100 }, hp: 1000 };
  const target = { ...initial.units['red-1'], hp: 2000,
    stats: { ...initial.units['red-1'].stats, hp: 2000, defense: 100, resist: 0 } };
  const other = { ...target, unitId: 'red-2', hp: 500 };
  initial.units[actor.unitId] = actor; initial.units[target.unitId] = target; initial.units[other.unitId] = other;
  initial.sides.red = [target.unitId, other.unitId];
  const dispatcher = new EventDispatcher(), hero = registry.getHero(embalmerIds.hero);
  for (const [phase, rule] of Object.entries(hero.handlers)) dispatcher.register({ id: `hero:${embalmerIds.hero}:${phase}`,
    phase, priority: rule.priority, handle: rule.handle });

  const seam = executeAction(initial, { actorId: actor.unitId, skillId: embalmerIds.soulSeam, targetIds: [target.unitId],
    shape: 'single', targetRelation: 'enemy' }, registry, () => 0,
    { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(seam.state.resources.blue.fire, 2, '五级离魂消耗2火');
  assert.equal(seam.state.units[target.unitId].statuses.find(status => status.statusId === embalmerIds.seam).stacks, 1);
  const second = executeAction(seam.state, { actorId: actor.unitId, skillId: embalmerIds.soulSeam, targetIds: [target.unitId],
    shape: 'single', targetRelation: 'enemy' }, registry, () => 0,
    { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(second.state.units[target.unitId].statuses.find(status => status.statusId === embalmerIds.seam).stacks, 2);
  const seamTick = settleEvents(second.state, [{ eventId: 'seam-target-turn-end', phase: 'turn-end', type: 'turn-ended',
    unitId: target.unitId, actionId: 90, source: { kind: 'unit', id: target.unitId, unitId: target.unitId } }], dispatcher,
    () => .5, new TriggerBudget(32), id => registry.getStatus(id));
  assert.equal(seamTick.state.units[target.unitId].hp, second.state.units[target.unitId].hp - 500,
    '两层魂隙的间接生命损失受500%攻击上限约束');

  const summoned = executeAction(initial, { actorId: actor.unitId, skillId: embalmerIds.summon, targetIds: [actor.unitId],
    shape: 'self', targetRelation: 'ally' }, registry, () => .5,
    { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(summoned.state.resources.blue.fire, 1);
  assert.ok(summoned.state.units[actor.unitId].statuses.some(status => status.statusId === embalmerIds.coffin));
  assert.equal(effectiveStats(summoned.state.units[actor.unitId]).defense, 350);
  const fireSpent = settleEvents(summoned.state, [{ eventId: 'enemy-fire-payment', phase: 'resource-payment', type: 'resource-changed',
    side: 'red', resourceId: 'fire', before: 4, after: 2, source: { kind: 'skill', id: 'red-skill', unitId: target.unitId } }],
    dispatcher, () => .5, new TriggerBudget(32), id => registry.getStatus(id));
  const retaliation = settleEvents(fireSpent.state, [{ eventId: 'enemy-turn-end', phase: 'turn-end', type: 'turn-ended',
    unitId: target.unitId, actionId: 91, source: { kind: 'unit', id: target.unitId, unitId: target.unitId } }], dispatcher,
    () => .5, new TriggerBudget(32), id => registry.getStatus(id));
  assert.equal(retaliation.events.filter(event => event.type === 'damage' && event.source.unitId === actor.unitId).length, 2,
    '棺中人反击回合行动者与另一名生命比例最低的敌人');
  assert.equal(retaliation.state.units[target.unitId].hp < fireSpent.state.units[target.unitId].hp, true);
  assert.equal(retaliation.state.units[other.unitId].hp < fireSpent.state.units[other.unitId].hp, true);
});

test('炼狱茨木童子狂意提升多目标鬼焰，选中目标倒下后鬼手转攻最高生命敌人并附加溢出伤害', () => {
  const registry = new ContentRegistry(); registerHellishIbaraki(registry);
  const initial = state();
  const actor = { ...initial.units['blue-1'], heroId: hellishIbarakiIds.hero, skillLevel: 5,
    skillLevels: { [hellishIbarakiIds.basic]: 5, [hellishIbarakiIds.passive]: 5, [hellishIbarakiIds.ultimate]: 5 },
    stats: { ...initial.units['blue-1'].stats, attack: 100, hp: 1000 }, hp: 1000 };
  const selected = { ...initial.units['red-1'], hp: 100,
    stats: { ...initial.units['red-1'].stats, hp: 2000, defense: 0 } };
  const largest = { ...selected, unitId: 'red-2', hp: 2000 };
  const other = { ...selected, unitId: 'red-3', hp: 1500 };
  initial.units[actor.unitId] = actor; initial.units[selected.unitId] = selected;
  initial.units[largest.unitId] = largest; initial.units[other.unitId] = other;
  initial.sides.red = [selected.unitId, largest.unitId, other.unitId];
  const dispatcher = new EventDispatcher(), hero = registry.getHero(hellishIbarakiIds.hero);
  dispatcher.register({ id: `hero:${hellishIbarakiIds.hero}:attack-end`, phase: 'attack-end',
    priority: hero.handlers['attack-end'].priority, handle: hero.handlers['attack-end'].handle });
  const result = executeAction(initial, { actorId: actor.unitId, skillId: hellishIbarakiIds.ultimate,
    targetIds: [selected.unitId, largest.unitId, other.unitId], selectedTargetId: selected.unitId,
    shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => 0,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(result.state.resources.blue.fire, 1, '炼狱之门消耗3火');
  const firstAttackEnd = result.events.find(event => event.type === 'attack-ended' && event.source.id === hellishIbarakiIds.ultimate);
  assert.deepEqual(firstAttackEnd.selectedTargetIds, [selected.unitId]);
  const targetDamage = result.events.filter(event => event.type === 'damage' && event.source.id === hellishIbarakiIds.ultimate
    && event.targetId === largest.unitId);
  assert.equal(targetDamage.length, 3, '鬼焰命中后，鬼手主段和五级被动过量段都打向当前生命最高敌人');
  assert.ok(targetDamage.some(event => event.amount >= 90), '五级被动追加了鬼焰过量伤害');
  assert.equal(result.state.units[other.unitId].hp < other.hp, true, '鬼焰仍攻击其余敌人');

  const smallRoster = { ...initial, units: { ...initial.units }, sides: { ...initial.sides, red: [largest.unitId] } };
  delete smallRoster.units[selected.unitId]; delete smallRoster.units[other.unitId];
  const oneEnemy = executeAction(smallRoster, { actorId: actor.unitId, skillId: hellishIbarakiIds.ultimate,
    targetIds: [largest.unitId], selectedTargetId: largest.unitId, shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => 0,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });
  const flame = oneEnemy.events.find(event => event.type === 'damage' && event.targetId === largest.unitId
    && event.source.id === hellishIbarakiIds.ultimate);
  assert.ok(flame.amount < targetDamage.find(event => event.targetId === largest.unitId).amount,
    '多名敌方存在时，鬼焰按狂意获得额外伤害');

  const baseDamage = count => {
    const battle = state();
    const wearer = { ...battle.units['blue-1'], heroId: hellishIbarakiIds.hero, skillLevel: 5,
      skillLevels: { [hellishIbarakiIds.passive]: 5, [hellishIbarakiIds.ultimate]: 5 },
      stats: { ...battle.units['blue-1'].stats, attack: 100, hp: 1000 }, hp: 1000 };
    battle.units[wearer.unitId] = wearer;
    const ids = [];
    for (let index = 0; index < count; index++) {
      const unitId = index === 0 ? 'red-1' : `red-tier-${index}`;
      const enemy = { ...battle.units['red-1'], unitId, hp: 10000, stats: { ...battle.units['red-1'].stats, hp: 10000 } };
      battle.units[unitId] = enemy; ids.push(unitId);
    }
    battle.sides.red = ids;
    const cast = executeAction(battle, { actorId: wearer.unitId, skillId: hellishIbarakiIds.ultimate,
      targetIds: ids, selectedTargetId: ids[0], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => 0,
    { dispatcher, resolveStatus: id => registry.getStatus(id) });
    return cast.events.find(event => event.type === 'damage' && event.source.id === hellishIbarakiIds.ultimate
      && event.targetId === ids[0]).amount;
  };
  const one = baseDamage(1);
  assert.ok(Math.abs(baseDamage(2) / one - 1.1) < .001, '第2名敌方令鬼焰增伤10%');
  assert.ok(Math.abs(baseDamage(3) / one - 1.2) < .001, '第3名敌方令鬼焰增伤20%');
  assert.ok(Math.abs(baseDamage(6) / one - 1.5) < .001, '最多按5名额外敌方增伤50%');
});

test('八岐大蛇五级普攻发动蛇魔凝视，神念之影耗火封印敌方并役使至多五蛇魔投毒推条', () => {
  const registry = new ContentRegistry(); registerOrochi(registry);
  const initial = state();
  const actor = { ...initial.units['blue-1'], heroId: orochiIds.hero, skillLevel: 5,
    skillLevels: { [orochiIds.basic]: 5, [orochiIds.ultimate]: 5 },
    stats: { ...initial.units['blue-1'].stats, attack: 100, hp: 1000 }, hp: 1000, actionGauge: 0 };
  const target = { ...initial.units['red-1'], hp: 5000, stats: { ...initial.units['red-1'].stats, hp: 5000, defense: 500 } };
  const snake = { ...actor, unitId: 'snake-1', heroId: orochiIds.hero, unitKind: 'summon', summonedByUnitId: actor.unitId,
    stats: { ...actor.stats, attack: 150 }, hp: 1000 };
  initial.units[actor.unitId] = actor; initial.units[target.unitId] = target; initial.units[snake.unitId] = snake;
  initial.sides.blue = [actor.unitId, snake.unitId];
  const basic = executeAction(initial, { actorId: actor.unitId, skillId: orochiIds.basic, targetIds: [target.unitId],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .5, { resolveStatus: id => registry.getStatus(id) });
  const withoutSnake = { ...initial, sides: { ...initial.sides, blue: [actor.unitId] } };
  const plainBasic = executeAction(withoutSnake, { actorId: actor.unitId, skillId: orochiIds.basic, targetIds: [target.unitId],
    shape: 'single', targetRelation: 'enemy' }, registry, () => .5, { resolveStatus: id => registry.getStatus(id) });
  assert.equal(basic.state.resources.blue.fire, 4, '普攻不消耗鬼火');
  const basicDamage = basic.events.find(event => event.type === 'damage' && event.source.id === orochiIds.basic);
  const plainBasicDamage = plainBasic.events.find(event => event.type === 'damage' && event.source.id === orochiIds.basic);
  assert.ok(basicDamage.amount > plainBasicDamage.amount, '蛇魔凝视忽略目标20%防御');

  const secondTarget = { ...target, unitId: 'red-2', hp: 5000 };
  const thirdTarget = { ...target, unitId: 'red-3', hp: 5000 };
  const snakes = Array.from({ length: 6 }, (_, index) => ({ ...snake, unitId: `snake-${index + 1}`,
    stats: { ...snake.stats, attack: 50 + index * 50 } }));
  const battle = { ...initial, units: { ...initial.units, [actor.unitId]: actor, [target.unitId]: target,
    [secondTarget.unitId]: secondTarget, [thirdTarget.unitId]: thirdTarget }, sides: { blue: [actor.unitId, ...snakes.map(unit => unit.unitId)],
    red: [target.unitId, secondTarget.unitId, thirdTarget.unitId] } };
  for (const unit of snakes) battle.units[unit.unitId] = unit;
  const ultimate = executeAction(battle, { actorId: actor.unitId, skillId: orochiIds.ultimate,
    targetIds: [target.unitId, secondTarget.unitId, thirdTarget.unitId], shape: 'all-enemies', targetRelation: 'enemy' },
  registry, () => .99, { resolveStatus: id => registry.getStatus(id) });
  assert.equal(ultimate.state.resources.blue.fire, 1, '神念之影消耗3火');
  const toxinHits = ultimate.events.filter(event => event.type === 'damage' && event.source.id === orochiIds.toxin);
  assert.equal(toxinHits.length, 5, '最多役使5只蛇魔');
  assert.ok(!toxinHits.some(event => event.source.unitId === 'snake-1'), '优先役使攻击最高的蛇魔');
  assert.equal(ultimate.state.units[actor.unitId].actionGauge, 50, '5次毒液回合后各推进10点行动条');
  assert.ok(ultimate.state.units['red-3'].statuses.some(status => status.statusId === orochiIds.fiveSenses
    && status.values.sealPassives && status.values.sealSouls), '蛇魔使随机目标暂时封印被动与御魂');
});

test('稻荷神狐铃按技能等级施加随机控制，日曜界推进前排友方并驱散，月影界追击敌方且封其御魂被动', () => {
  const registry = new ContentRegistry(); registerInariMiketsu(registry);
  registry.registerStatus({ id: 'test.inari.debuff', mechanicsCoverage: 'partial', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: passiveSuppressionStatusId, mechanicsCoverage: 'verified', category: 'control', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: soulSuppressionStatusId, mechanicsCoverage: 'verified', category: 'control', dispellable: true,
    sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const initial = state();
  const actor = { ...initial.units['blue-1'], heroId: inariMiketsuIds.hero, skillLevel: 5,
    skillLevels: { [inariMiketsuIds.basic]: 5, [inariMiketsuIds.solar]: 4, [inariMiketsuIds.lunar]: 5 },
    stats: { ...initial.units['blue-1'].stats, hp: 1000, speed: 99, attack: 100, defense: 100, hit: 0, resist: 0 }, hp: 1000 };
  const front = { ...initial.units['blue-1'], unitId: 'blue-front', hp: 100, actionGauge: 90,
    stats: { ...initial.units['blue-1'].stats, hp: 100, speed: 80, attack: 100, defense: 100, resist: 0 },
    statuses: [{ instanceId: 'test-inari-debuff', statusId: 'test.inari.debuff', source: { kind: 'skill', id: 'test', unitId: 'red-1' },
      stacks: 1, duration: { kind: 'permanent' } }] };
  const rear = { ...front, unitId: 'blue-rear', actionGauge: 40, statuses: [] };
  const target = { ...initial.units['red-1'], hp: 1000, stats: { ...initial.units['red-1'].stats, hp: 1000, resist: 0 } };
  initial.units[actor.unitId] = actor; initial.units[front.unitId] = front; initial.units[rear.unitId] = rear; initial.units[target.unitId] = target;
  initial.sides.blue = [actor.unitId, front.unitId, rear.unitId];
  const hero = registry.getHero(inariMiketsuIds.hero), dispatcher = new EventDispatcher();
  dispatcher.register({ id: 'hero:326:turn-end', phase: 'turn-end', priority: hero.handlers['turn-end'].priority,
    handle: hero.handlers['turn-end'].handle });

  const bell = executeAction(initial, { actorId: actor.unitId, skillId: inariMiketsuIds.basic, targetIds: [target.unitId],
    shape: 'single', targetRelation: 'enemy' }, registry, () => 0, { resolveStatus: id => registry.getStatus(id) });
  assert.equal(bell.state.resources.blue.fire, 4);
  assert.ok(bell.state.units[target.unitId].statuses.some(status => [inariMiketsuIds.silence, inariMiketsuIds.bindFoot,
    passiveSuppressionStatusId, soulSuppressionStatusId].includes(status.statusId)), '五级狐铃有100%基础概率命中一种随机控制');

  const sun = executeAction(initial, { actorId: actor.unitId, skillId: inariMiketsuIds.solar,
    targetIds: [actor.unitId, front.unitId, rear.unitId], shape: 'all-allies', targetRelation: 'ally' }, registry, () => .5,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(sun.state.resources.blue.fire, 1, '日曜界消耗3火');
  assert.equal(effectiveStats(sun.state.units[actor.unitId]).speed, 119, '日曜界提高全体20速度');
  const allyEnd = settleEvents(sun.state, [{ eventId: 'inari-ally-end', phase: 'turn-end', type: 'turn-ended', unitId: actor.unitId,
    source: { kind: 'unit', id: actor.unitId, unitId: actor.unitId } }], dispatcher, () => .5, new TriggerBudget(32), id => registry.getStatus(id));
  assert.equal(allyEnd.state.units[front.unitId].actionGauge, 100, '行动条推进后封顶100点');
  assert.equal(allyEnd.events.find(event => event.type === 'action-gauge-changed').requestedAmount, 20,
    '除行动者外选择行动条最前的友方推进20点');
  assert.equal(allyEnd.state.units[front.unitId].statuses.some(status => status.statusId === 'test.inari.debuff'), false,
    '四级日曜界推进时必定驱散1个减益或控制');

  const lunarCommands = hero.initialize(createBattleContext(initial, () => .5), actor.unitId);
  assert.ok(lunarCommands.some(command => command.type === 'add-status' && command.instance.statusId === inariMiketsuIds.lunarField),
    '五级月影界在战斗开始先机施放');
  const lunar = executeAction(initial, { actorId: actor.unitId, skillId: inariMiketsuIds.lunar,
    targetIds: [actor.unitId, front.unitId, rear.unitId], shape: 'all-allies', targetRelation: 'ally' }, registry, () => .5,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(lunar.state.resources.blue.fire, 1, '月影界消耗3火');
  assert.equal(effectiveStats(lunar.state.units[actor.unitId]).speed, 129, '三级起月影界为自身增加30速度');
  assert.equal(effectiveStats(lunar.state.units[front.unitId]).attack, 130, '五级月影界为全队增加30%攻击');
  const enemyEnd = settleEvents(lunar.state, [{ eventId: 'inari-enemy-end', phase: 'turn-end', type: 'turn-ended', unitId: target.unitId,
    source: { kind: 'unit', id: target.unitId, unitId: target.unitId } }], dispatcher, () => 0, new TriggerBudget(32), id => registry.getStatus(id));
  const retaliation = enemyEnd.events.find(event => event.type === 'damage' && event.source.id === inariMiketsuIds.basic);
  assert.equal(retaliation.targetId, target.unitId);
  assert.equal(retaliation.suppressSoulTriggers, true);
  assert.equal(retaliation.suppressTargetSoulTriggers, true);
  assert.equal(retaliation.suppressTargetPassiveTriggers, true);
  assert.ok(enemyEnd.state.units[target.unitId].statuses.some(status => status.duration.remaining === 2),
    '月影界追击控制持续2回合');
});

test('苍风一目连按等级结算普攻风盾、风符·守补盾被动及友方护盾联动', () => {
  const registry = new ContentRegistry(); registerCangfengOneEyed(registry);
  const initial = state();
  const actor = { ...initial.units['blue-1'], heroId: cangfengIds.hero, skillLevel: 5,
    skillLevels: { [cangfengIds.basic]: 5, [cangfengIds.guard]: 5, [cangfengIds.ultimate]: 5 },
    stats: { ...initial.units['blue-1'].stats, hp: 1000, speed: 99, attack: 100, defense: 100, crit: 1.2, critDamage: 1.5 },
    hp: 1000, statuses: [] };
  const ally = { ...initial.units['blue-1'], unitId: 'blue-2', hp: 250, stats: { ...initial.units['blue-1'].stats, hp: 1000 }, statuses: [] };
  const rear = { ...initial.units['blue-1'], unitId: 'blue-3', hp: 600, stats: { ...initial.units['blue-1'].stats, hp: 1000 }, statuses: [] };
  const enemy = { ...initial.units['red-1'], hp: 3000, stats: { ...initial.units['red-1'].stats, hp: 3000, resist: 0 }, statuses: [] };
  initial.units[actor.unitId] = actor; initial.units[ally.unitId] = ally; initial.units[rear.unitId] = rear; initial.units[enemy.unitId] = enemy;
  initial.sides.blue = [actor.unitId, ally.unitId, rear.unitId]; initial.sides.red = [enemy.unitId];
  const hero = registry.getHero(cangfengIds.hero), dispatcher = new EventDispatcher();
  for (const [phase, handler] of Object.entries(hero.handlers)) dispatcher.register({ id: `hero:327:${phase}`, phase,
    priority: handler.priority, handle: handler.handle });
  const resolveStatus = id => registry.getStatus(id);

  const firstBasic = executeAction(initial, { actorId: actor.unitId, skillId: cangfengIds.basic,
    targetIds: [enemy.unitId], shape: 'single', targetRelation: 'enemy' }, registry, () => .5, { dispatcher, resolveStatus });
  assert.equal(firstBasic.state.resources.blue.fire, 4, '风符·灭不消耗鬼火');
  const selfShield = firstBasic.state.units[actor.unitId].statuses.find(status => status.statusId === cangfengIds.windShield);
  assert.equal(selfShield.values.shieldRemaining, 60, '无风盾时给自身攻击60%的三回合风盾');
  assert.equal(selfShield.duration.remaining, 3);

  const guard = executeAction(initial, { actorId: actor.unitId, skillId: cangfengIds.guard,
    targetIds: [ally.unitId], shape: 'single', targetRelation: 'ally' }, registry, () => .5, { dispatcher, resolveStatus });
  assert.equal(guard.state.resources.blue.fire, 2, '风符·守消耗2火');
  assert.equal(guard.state.units[ally.unitId].statuses.find(status => status.statusId === cangfengIds.windShield).values.shieldRemaining, 217);
  assert.equal(guard.state.units[rear.unitId].statuses.find(status => status.statusId === cangfengIds.windShield).values.shieldRemaining, 217,
    '风符·守同时保护另一名未有风盾的友方');
  assert.ok(guard.state.units[actor.unitId].statuses.some(status => status.statusId === cangfengIds.windShield
    && status.values.shieldRemaining === 108.5), '四级起友方获得风盾时苍风一目连获得盾量50%的风盾');
  assert.ok(Math.abs(guard.state.units[actor.unitId].statuses.find(status => status.statusId === cangfengIds.shieldReduction).values.reduction
    - .55) < 1e-9, '三个有盾友方提供15%减伤，暴击溢出再提供40%');

  const passiveState = { ...initial, units: { ...initial.units, [actor.unitId]: actor,
    [ally.unitId]: { ...ally, hp: 350 }, [rear.unitId]: rear } };
  const passive = settleEvents(passiveState, [{ eventId: 'cangfeng-ally-action-ended', actionId: 'ally-action', phase: 'action-end',
    type: 'action-ended', unitId: ally.unitId, source: { kind: 'unit', id: ally.unitId, unitId: ally.unitId } }], dispatcher,
  () => .5, new TriggerBudget(32), resolveStatus);
  assert.equal(passive.state.units[ally.unitId].statuses.find(status => status.statusId === cangfengIds.windShield).values.shieldRemaining, 217,
    '友方行动结束時低于40%血量触发自动补盾');
  assert.ok(passive.state.units[actor.unitId].statuses.some(status => status.statusId === cangfengIds.passiveCooldown), '触发后进入冷却');
  assert.equal(hero.modifyCriticalDamage(actor, enemy, 100, 100), 140, '五级暴击溢出转化为暴击伤害');
});

test('苍风一目连风止·苍龙坠按风盾数追击、治疗剩余护盾并在五级补盾续期', () => {
  const registry = new ContentRegistry(); registerCangfengOneEyed(registry);
  const initial = state(), actorBase = initial.units['blue-1'];
  const actor = { ...actorBase, heroId: cangfengIds.hero, skillLevel: 5,
    skillLevels: { [cangfengIds.basic]: 5, [cangfengIds.guard]: 5, [cangfengIds.ultimate]: 5 }, hp: 1000,
    stats: { ...actorBase.stats, hp: 1000, attack: 100, defense: 100, crit: 0, critDamage: 1.5 }, statuses: [] };
  const windShield = (unitId, remaining, hp) => ({ ...actorBase, unitId, hp,
    stats: { ...actorBase.stats, hp: 1000 }, statuses: [{ instanceId: `wind-shield-${unitId}`, statusId: cangfengIds.windShield,
      source: { kind: 'skill', id: cangfengIds.guard, unitId: actor.unitId }, stacks: 1,
      duration: { kind: 'count', remaining: 2, owner: 'target-turn' }, values: { shieldRemaining: remaining, initialAmount: 1000 } }] });
  const allyA = windShield('blue-2', 200, 500), allyB = windShield('blue-3', 500, 400);
  const enemy = { ...initial.units['red-1'], hp: 3000, stats: { ...initial.units['red-1'].stats, hp: 3000, resist: 0 }, statuses: [] };
  initial.units[actor.unitId] = actor; initial.units[allyA.unitId] = allyA; initial.units[allyB.unitId] = allyB; initial.units[enemy.unitId] = enemy;
  initial.sides.blue = [actor.unitId, allyA.unitId, allyB.unitId]; initial.sides.red = [enemy.unitId];
  const hero = registry.getHero(cangfengIds.hero), dispatcher = new EventDispatcher();
  for (const [phase, handler] of Object.entries(hero.handlers)) dispatcher.register({ id: `hero:327:${phase}`, phase,
    priority: handler.priority, handle: handler.handle });
  const resolveStatus = id => registry.getStatus(id);
  const cast = executeAction(initial, { actorId: actor.unitId, skillId: cangfengIds.ultimate,
    targetIds: [enemy.unitId], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => 0,
  { dispatcher, resolveStatus });
  assert.equal(cast.state.resources.blue.fire, 1, '风止·苍龙坠消耗3火');
  const strikes = cast.events.filter(event => event.type === 'damage' && event.source.id === cangfengIds.ultimate);
  assert.equal(strikes.length, 3, '一名敌人先受群攻，两个友方风盾各追加一次攻击');
  assert.ok(strikes[2].amount < strikes[1].amount, '同一目标再次命中时伤害递减20%');
  assert.equal(cast.state.units[allyA.unitId].hp, 570, '四级治疗量按行动结束时200点剩余风盾的35%计算');
  assert.equal(cast.state.units[allyB.unitId].hp, 575, '另一名友方按500点剩余风盾的35%治疗');
  assert.equal(cast.state.units[allyA.unitId].statuses.find(status => status.statusId === cangfengIds.windShield).values.shieldRemaining, 720,
    '五级将低于初始72%的风盾补至72%');
  assert.equal(cast.state.units[allyA.unitId].statuses.find(status => status.statusId === cangfengIds.windShield).duration.remaining, 3,
    '五级重置其他友方风盾持续时间');
  assert.ok(!cast.state.units[actor.unitId].statuses.some(status => status.statusId === cangfengIds.windShield),
    '大招刷新友方风盾不重复触发护盾分享');
});

test('赤影妖刀姬炎刃按等级结算，穷追不舍锁低血目标并附加孤立', () => {
  const registry = new ContentRegistry(); registerRedShadowYoto(registry);
  const initial = state(), base = initial.units['blue-1'];
  const actor = { ...base, heroId: redShadowYotoIds.hero, skillLevel: 5,
    skillLevels: { [redShadowYotoIds.basic]: 5, [redShadowYotoIds.passive]: 5, [redShadowYotoIds.ultimate]: 5 },
    stats: { ...base.stats, attack: 100, hp: 1000, speed: 100, defense: 100, hit: 0 }, hp: 1000,
    statuses: [{ instanceId: 'locked-red-1', statusId: redShadowYotoIds.lockedTarget,
      source: { kind: 'skill', id: redShadowYotoIds.passive, unitId: base.unitId }, stacks: 1,
      duration: { kind: 'permanent' }, values: { targetUnitId: 'red-1' } }] };
  const target = { ...initial.units['red-1'], hp: 500, stats: { ...initial.units['red-1'].stats, hp: 1000, resist: 0 }, statuses: [] };
  const alternate = { ...target, unitId: 'red-2', hp: 1000, stats: { ...target.stats, hp: 1000 } };
  initial.units[actor.unitId] = actor; initial.units[target.unitId] = target; initial.units[alternate.unitId] = alternate;
  initial.sides.blue = [actor.unitId]; initial.sides.red = [target.unitId, alternate.unitId]; initial.resources.blue.fire = 0;
  const hero = registry.getHero(redShadowYotoIds.hero), dispatcher = new EventDispatcher();
  for (const [phase, handler] of Object.entries(hero.handlers)) dispatcher.register({ id: `hero:328:${phase}`, phase,
    priority: handler.priority, handle: handler.handle });
  const resolveStatus = id => registry.getStatus(id);
  const first = executeAction(initial, { actorId: actor.unitId, skillId: redShadowYotoIds.basic,
    targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' }, registry, () => 0,
  { dispatcher, resolveStatus });
  assert.equal(first.state.units[target.unitId].statuses.find(status => status.statusId === redShadowYotoIds.isolated)?.duration.remaining, 1,
    '五级被动命中锁定目标时附加1回合孤立');
  const redirected = executeAction(first.state, { actorId: actor.unitId, skillId: redShadowYotoIds.basic,
    targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' }, registry, () => 0,
  { dispatcher, resolveStatus });
  assert.ok(redirected.events.some(event => event.type === 'damage' && event.targetId === alternate.unitId),
    '孤立目标不能被对方的友方直接选中');

  const damageBoost = hero.modifyOutgoingDamage(actor, target, 100, 'normal', initial);
  assert.ok(Math.abs(damageBoost - 165) < 1e-9, '最低敌人损失50%生命提供50%增伤，锁定目标另有15%增伤');
  const ended = settleEvents(first.state, [{ eventId: 'yoto-turn-end', phase: 'turn-end', type: 'turn-ended', unitId: actor.unitId,
    source: { kind: 'unit', id: String(actor.heroId), unitId: actor.unitId } }], dispatcher, () => 0, new TriggerBudget(32), resolveStatus);
  assert.equal(ended.state.units[actor.unitId].statuses.find(status => status.statusId === redShadowYotoIds.lockedTarget).values.targetUnitId,
    target.unitId, '回合结束锁定生命比例最低的非召唤敌人');
  assert.equal(ended.state.units[actor.unitId].statuses.find(status => status.statusId === redShadowYotoIds.lockedTarget).values.pendingStrike,
    true, '锁定后挂起被动印记攻击');
  assert.equal(ended.state.units[actor.unitId].statuses.find(status => status.statusId === redShadowYotoIds.lowHealthAura)
    .modifiers[0].amount, Math.floor((1 - ended.state.units[target.unitId].hp / target.stats.hp) * 100),
  '最低敌人损失的生命比例转为等值速度');
  const nextStart = settleEvents(ended.state, [{ eventId: 'yoto-next-turn', phase: 'turn-start', type: 'turn-started', unitId: actor.unitId,
    source: { kind: 'unit', id: String(actor.heroId), unitId: actor.unitId } }], dispatcher, () => 0, new TriggerBudget(32), resolveStatus);
  assert.ok(nextStart.events.some(event => event.type === 'damage' && event.source.id === redShadowYotoIds.passive
    && event.targetId === target.unitId && event.suppressTargetPassiveTriggers && event.suppressTargetSoulTriggers),
  '下次回合开始消耗被动印记，对锁定目标造成100%攻击且不触发其御魂/被动');
});

test('赤影一瞬按击杀等级叠加赤影之息、获得新回合并在五级免费强化大招', () => {
  const registry = new ContentRegistry(); registerRedShadowYoto(registry);
  const initial = state(), base = initial.units['blue-1'];
  const actor = { ...base, heroId: redShadowYotoIds.hero, skillLevel: 5,
    skillLevels: { [redShadowYotoIds.basic]: 5, [redShadowYotoIds.passive]: 5, [redShadowYotoIds.ultimate]: 5 },
    stats: { ...base.stats, attack: 100, hp: 1000, speed: 100, defense: 100, crit: 0, resist: 0 }, hp: 1000, statuses: [] };
  const target = { ...initial.units['red-1'], hp: 100, stats: { ...initial.units['red-1'].stats, hp: 1000, defense: 0, resist: 0 }, statuses: [] };
  const secondTarget = { ...target, unitId: 'red-2', hp: 30000, stats: { ...target.stats, hp: 30000 } };
  initial.units[actor.unitId] = actor; initial.units[target.unitId] = target; initial.units[secondTarget.unitId] = secondTarget;
  initial.sides.blue = [actor.unitId]; initial.sides.red = [target.unitId, secondTarget.unitId];
  const hero = registry.getHero(redShadowYotoIds.hero), dispatcher = new EventDispatcher();
  for (const [phase, handler] of Object.entries(hero.handlers)) dispatcher.register({ id: `hero:328:${phase}`, phase,
    priority: handler.priority, handle: handler.handle });
  const resolveStatus = id => registry.getStatus(id);
  const kill = executeAction(initial, { actorId: actor.unitId, skillId: redShadowYotoIds.ultimate,
    targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' }, registry, () => 0,
  { dispatcher, resolveStatus });
  assert.equal(kill.state.resources.blue.fire, 1, '赤影一瞬消耗3火');
  assert.equal(kill.state.units[actor.unitId].statuses.find(status => status.statusId === redShadowYotoIds.redBreath).stacks, 1,
    '击败非召唤敌人获得一层赤影之息');
  assert.ok(kill.state.scheduling.extraTurns.includes(actor.unitId), '三级起大招击杀获得新的回合');
  assert.ok(kill.state.units[actor.unitId].statuses.some(status => status.statusId === redShadowYotoIds.freeUltimate));
  assert.ok(kill.state.units[actor.unitId].statuses.some(status => status.statusId === redShadowYotoIds.extraTurnUltimate));
  const free = executeAction(kill.state, { actorId: actor.unitId, skillId: redShadowYotoIds.ultimate,
    targetIds: [secondTarget.unitId], shape: 'single', targetRelation: 'enemy' }, registry, () => 0,
  { dispatcher, resolveStatus, scheduling: 'extra-turn' });
  assert.equal(free.state.resources.blue.fire, 1, '四级起新回合的大招免消耗');
  const hitEvent = free.events.find(event => event.type === 'damage' && event.source.id === redShadowYotoIds.ultimate);
  assert.ok(hitEvent?.suppressTargetPassiveTriggers && hitEvent.suppressTargetSoulTriggers,
    '五级新回合大招不触发目标被动和御魂');
  assert.ok(!free.state.units[actor.unitId].statuses.some(status => status.statusId === redShadowYotoIds.freeUltimate
    || status.statusId === redShadowYotoIds.extraTurnUltimate), '新回合大招结算后消耗免费施放标记');

  const battleState = { ...initial, units: { ...initial.units,
    [actor.unitId]: { ...actor, actionGauge: 100, stats: { ...actor.stats, speed: 200 } },
    [target.unitId]: { ...target }, [secondTarget.unitId]: { ...secondTarget } } };
  const battle = runBattle(battleState, registry, { seed: 19, actionLimit: 4 });
  const ultActions = battle.events.filter(event => event.type === 'action-ended' && event.skillId === redShadowYotoIds.ultimate);
  assert.equal(ultActions.length, 2, '完整调度中大招击杀后立即执行新回合免费大招');
  assert.equal(ultActions[1].scheduling, 'extra-turn');
  assert.equal(battle.state.resources.blue.fire, 1);
});

test('孤立阻止友方伤害拦截与分担', () => {
  const registry = new ContentRegistry(); registerRedShadowYoto(registry);
  const interceptor = { id: 777, skills: [createBasicAttackSkill('7771', [1])],
    policy(context, unitId) { const target = context.getLivingUnits('blue')[0]; return target
      ? { actorId: unitId, skillId: '7771', targetIds: [target.unitId], shape: 'single', targetRelation: 'enemy' } : undefined; },
    interceptIncomingDamage(_state, _attacker, _target, amount) { return { amount: amount * .5, effects: [] }; } };
  registry.registerHero(interceptor);
  const initial = state(), isolated = { ...initial.units['blue-1'], heroId: redShadowYotoIds.hero, hp: 1000, actionGauge: 0,
    stats: { ...initial.units['blue-1'].stats, hp: 1000, defense: 0 }, statuses: [{ instanceId: 'isolated-blue',
      statusId: redShadowYotoIds.isolated, source: { kind: 'skill', id: redShadowYotoIds.passive, unitId: 'red-2' }, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }] };
  const attacker = { ...initial.units['red-1'], heroId: interceptor.id, hp: 1000, actionGauge: 100,
    stats: { ...initial.units['red-1'].stats, hp: 1000, attack: 100, defense: 0, speed: 100, crit: 0 }, statuses: [] };
  initial.units[isolated.unitId] = isolated; initial.units[attacker.unitId] = attacker;
  initial.sides.blue = [isolated.unitId]; initial.sides.red = [attacker.unitId];
  const result = runBattle(initial, registry, { seed: 7, actionLimit: 3 });
  const damage = result.events.find(event => event.type === 'damage' && event.targetId === isolated.unitId);
  assert.ok(damage && damage.hpLost > 50, '伤害拦截器不能替孤立目标分担或代受伤害');
});

test('海忍影出按等级忽视40%防御，三层弱点转120%群攻并追击另一随机敌人', () => {
  const registry = new ContentRegistry(); registerHaishin(registry);
  const initial = state(), base = initial.units['blue-1'];
  const actor = { ...base, heroId: haishinIds.hero, skillLevel: 1,
    skillLevels: { [haishinIds.basic]: 1, [haishinIds.passive]: 1, [haishinIds.ultimate]: 1 },
    stats: { ...base.stats, attack: 100, hp: 1000, speed: 100, defense: 0, crit: 0, critDamage: 1.5 }, hp: 1000, statuses: [] };
  const firstTarget = { ...initial.units['red-1'], hp: 5000, stats: { ...initial.units['red-1'].stats, hp: 5000, defense: 300, resist: 0 }, statuses: [] };
  const secondTarget = { ...firstTarget, unitId: 'red-2', hp: 5000 };
  initial.units[actor.unitId] = actor; initial.units[firstTarget.unitId] = firstTarget; initial.units[secondTarget.unitId] = secondTarget;
  initial.sides.blue = [actor.unitId]; initial.sides.red = [firstTarget.unitId, secondTarget.unitId]; initial.resources.blue.fire = 0;
  const resolveStatus = id => registry.getStatus(id);
  let current = initial;
  for (let i = 0; i < 3; i++) {
    const hit = executeAction(current, { actorId: actor.unitId, skillId: haishinIds.basic,
      targetIds: [firstTarget.unitId], shape: 'single', targetRelation: 'enemy' }, registry, () => .99, { resolveStatus });
    current = hit.state;
  }
  assert.equal(current.units[firstTarget.unitId].statuses.find(status => status.statusId === haishinIds.weakness).stacks, 3,
    '普通攻击逐次叠加弱点，最多3层');
  const pop = executeAction(current, { actorId: actor.unitId, skillId: haishinIds.basic,
    targetIds: [firstTarget.unitId], shape: 'single', targetRelation: 'enemy' }, registry, () => .99, { resolveStatus });
  const damages = pop.events.filter(event => event.type === 'damage' && event.source.id === haishinIds.basic);
  assert.equal(damages.length, 3, '消耗弱点后攻击全体一次，再对另一敌人进行一次普攻');
  assert.ok(damages.filter(event => [firstTarget.unitId, secondTarget.unitId].includes(event.targetId)).slice(0, 2)
    .every(event => event.suppressTargetPassiveTriggers && event.suppressTargetSoulTriggers), '弱点群攻不触发敌方御魂与被动');
  assert.equal(pop.state.units[firstTarget.unitId].statuses.some(status => status.statusId === haishinIds.weakness), false,
    '触发群攻时消耗三层弱点');
  assert.equal(pop.state.units[secondTarget.unitId].statuses.find(status => status.statusId === haishinIds.weakness).stacks, 1,
    '消耗弱点后改攻另一随机敌人并重新叠加弱点');
});

test('海忍影回逐级概率追击并按同目标次数封顶，敌方回合末五级被动叠弱点', () => {
  const registry = new ContentRegistry(); registerHaishin(registry);
  const initial = state(), base = initial.units['blue-1'];
  const actor = { ...base, heroId: haishinIds.hero, skillLevel: 4,
    skillLevels: { [haishinIds.basic]: 5, [haishinIds.passive]: 4, [haishinIds.ultimate]: 1 },
    stats: { ...base.stats, attack: 100, hp: 1000, speed: 100, defense: 0, crit: 0 }, hp: 1000, statuses: [] };
  const target = { ...initial.units['red-1'], hp: 10000, stats: { ...initial.units['red-1'].stats, hp: 10000, defense: 0, resist: 0 }, statuses: [] };
  initial.units[actor.unitId] = actor; initial.units[target.unitId] = target; initial.sides.blue = [actor.unitId]; initial.sides.red = [target.unitId];
  initial.resources.blue.fire = 0;
  const resolveStatus = id => registry.getStatus(id);
  const dispatcher = new EventDispatcher();
  for (const [phase, handler] of Object.entries(registry.getHero(haishinIds.hero).handlers)) dispatcher.register({
    id: `hero:329:${phase}`, phase, priority: handler.priority, handle: handler.handle });
  const cast = executeAction(initial, { actorId: actor.unitId, skillId: haishinIds.basic, targetIds: [target.unitId],
    shape: 'single', targetRelation: 'enemy' }, registry, () => 0, { dispatcher, resolveStatus });
  const hits = cast.events.filter(event => event.type === 'damage' && event.source.id === haishinIds.basic);
  assert.equal(hits.length, 4, '四级影回对同一目标最多追加3次普攻');

  const rankFive = { ...actor, skillLevels: { ...actor.skillLevels, [haishinIds.passive]: 5 } };
  const turnState = { ...initial, units: { ...initial.units, [actor.unitId]: rankFive } };
  const end = settleEvents(turnState, [{ eventId: 'haishin-enemy-turn-end', phase: 'turn-end', type: 'turn-ended', unitId: target.unitId,
    source: { kind: 'unit', id: target.unitId, unitId: target.unitId } }], dispatcher, () => 0, new TriggerBudget(32), resolveStatus);
  assert.equal(end.state.units[target.unitId].statuses.find(status => status.statusId === haishinIds.weakness).stacks, 1,
    '五级唯一被动在敌方回合结束时按30%概率添加弱点');
});

test('海忍潜影守护一名友方，首次受击反击、按实际生命损失治疗并混乱推条', () => {
  const registry = new ContentRegistry(); registerHaishin(registry);
  const initial = state(), base = initial.units['blue-1'];
  const actor = { ...base, heroId: haishinIds.hero, skillLevel: 5,
    skillLevels: { [haishinIds.basic]: 5, [haishinIds.passive]: 5, [haishinIds.ultimate]: 5 },
    stats: { ...base.stats, attack: 100, hp: 1000, speed: 100, defense: 0, hit: 0, resist: 0 }, hp: 500, statuses: [] };
  const ally = { ...base, unitId: 'blue-2', hp: 1000, stats: { ...base.stats, hp: 1000, defense: 0 }, statuses: [] };
  const attacker = { ...initial.units['red-1'], hp: 2000, stats: { ...initial.units['red-1'].stats, hp: 2000, attack: 100,
    defense: 0, speed: 100, hit: 0, resist: 0 }, statuses: [] };
  initial.units[actor.unitId] = actor; initial.units[ally.unitId] = ally; initial.units[attacker.unitId] = attacker;
  initial.sides.blue = [actor.unitId, ally.unitId]; initial.sides.red = [attacker.unitId];
  const resolveStatus = id => registry.getStatus(id), hero = registry.getHero(haishinIds.hero), dispatcher = new EventDispatcher();
  for (const [phase, handler] of Object.entries(hero.handlers)) dispatcher.register({ id: `hero:329:${phase}`, phase,
    priority: handler.priority, handle: handler.handle });
  const cast = executeAction(initial, { actorId: actor.unitId, skillId: haishinIds.ultimate, targetIds: [ally.unitId],
    shape: 'single', targetRelation: 'ally' }, registry, () => 0, { dispatcher, resolveStatus });
  assert.equal(cast.state.units[actor.unitId].statuses.find(status => status.statusId === haishinIds.shadow).modifiers[0].amount, .3,
    '五级潜影提供30%效果抵抗');
  assert.equal(cast.state.units[actor.unitId].statuses.find(status => status.statusId === haishinIds.shadow).modifiers[1].amount, 30,
    '五级潜影提供30点速度');
  assert.equal(cast.state.units[actor.unitId].statuses.find(status => status.statusId === haishinIds.shadow).values.extraBasicChance, .5);

  const stealthEnd = settleEvents(cast.state, [{ eventId: 'haishin-next-attack-end', phase: 'attack-end', actionId: 42,
    type: 'attack-ended', hitCount: 1, actionKind: 'basic', selectedTargetIds: [attacker.unitId],
    source: { kind: 'skill', id: haishinIds.basic, unitId: actor.unitId } }], dispatcher, () => .99,
  new TriggerBudget(32), resolveStatus);
  assert.equal(stealthEnd.state.units[actor.unitId].statuses.find(status => status.statusId === haishinIds.shadow).values.extraBasicChance, 0,
    '五级潜影的50%影回概率加成在下一次攻击结束后消耗');

  const battleContext = createBattleContext(cast.state, () => 0, id => resolveStatus(id)?.category,
    id => resolveStatus(id)?.dispellable === true);
  const response = hero.interceptIncomingDamage(cast.state, attacker, cast.state.units[ally.unitId], 100, 'normal', {
    attackId: 1, hitIndex: 1, targetIds: [ally.unitId], attackShape: 'single', battle: battleContext, isUnitUnableToAct: () => false,
  });
  assert.equal(response.amount, 100, '偷袭不会替代或减免友方受到的伤害');
  const applied = applyEffectCommands(cast.state, response.effects, 'effect-resolution', 'haishin-ambush', resolveStatus);
  assert.ok(applied.events.some(event => event.type === 'damage' && event.source.id === haishinIds.ultimate
    && event.targetId === attacker.unitId), '海忍反击攻击来源');
  assert.ok(applied.state.units[attacker.unitId].statuses.some(status => status.statusId === haishinIds.confusion), '100%基础概率混乱攻击来源');
  assert.equal(applied.state.units[actor.unitId].actionGauge, 50, '三级起偷袭后增加50%行动条');
  const damage = applied.events.find(event => event.type === 'damage' && event.source.id === haishinIds.ultimate);
  const healed = settleEvents(applied.state, [damage], dispatcher, () => 0, new TriggerBudget(32), resolveStatus);
  assert.equal(healed.state.units[actor.unitId].hp, actor.hp + damage.hpLost, '按偷袭实际造成的生命损失等量治疗');
  assert.equal(applied.state.units[ally.unitId].statuses.some(status => status.statusId === haishinIds.protectedAlly), false,
    '首次受击后消耗友方守护标记');
});

test('樱花妖复苏逐级减火并强化治疗，友方行动后治疗且回合结束补足额外治疗', () => {
  const registry = new ContentRegistry();
  registerSakuraFairy(registry);
  const hero = registry.getHero(sakuraFairyIds.hero);
  const revive = hero.skills.find(skill => skill.id === sakuraFairyIds.revive);
  assert.equal(revive.resourceCost.amount, 3);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: sakuraFairyIds.hero, skillLevel: 3,
    skillLevels: { [sakuraFairyIds.revive]: 3 }, hp: 500, stats: { ...initial.units['blue-1'].stats, hp: 1000 },
    statuses: [] };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', hp: 800,
    stats: { ...initial.units['blue-1'].stats, hp: 1000 }, side: 'blue' };
  initial.sides.blue = ['blue-1', 'blue-2'];
  const actor = initial.units['blue-1'];
  const skillIntent = { actorId: actor.unitId, skillId: sakuraFairyIds.revive, targetIds: [actor.unitId], shape: 'self', targetRelation: 'ally' };
  const cast = revive.execute(createBattleContext(initial, () => .5), skillIntent, { rank: 3 });
  assert.equal(cast[0].instance.values.healingBonusPerStack, 1);
  assert.equal(cast[0].instance.modifiers[0].amount, .5);
  assert.equal(cast[0].instance.modifiers[0].operation, 'flat');
  const boosted = { ...actor, statuses: [{ ...cast[0].instance, stacks: 2 }] };
  assert.equal(hero.modifyOutgoingHealing(boosted, initial.units['blue-2'], 100), 300);
  let stacked = initial;
  for (let i = 0; i < 5; i++) {
    const commands = revive.execute(createBattleContext(stacked, () => .5), skillIntent, { rank: 3 });
    stacked = applyEffectCommands(stacked, commands, 'effect-resolution', `sakura-dance-stack-${i}`, id => registry.getStatus(id)).state;
  }
  const fullDance = stacked.units['blue-1'].statuses.find(status => status.statusId === sakuraFairyIds.dance);
  assert.equal(fullDance.stacks, 4);
  assert.equal(hero.modifyOutgoingHealing({ ...actor, statuses: [fullDance] }, initial.units['blue-2'], 100), 500);
  const rankFive = { ...initial, units: { ...initial.units, 'blue-1': { ...actor, skillLevel: 5,
    skillLevels: { [sakuraFairyIds.revive]: 5 } } }, resources: { ...initial.resources, blue: { ...initial.resources.blue, fire: 2 } } };
  const paid = executeAction(rankFive, { ...skillIntent, targetIds: ['blue-1'] }, registry, () => .5);
  assert.equal(paid.accepted, true);
  assert.equal(paid.state.resources.blue.fire, 0, '五级复苏消耗2点鬼火');

  const actionEnd = { eventId: 'sakura-ally-action-end', phase: 'action-end', source: { kind: 'skill', id: 'ally-action', unitId: 'blue-2' },
    type: 'action-ended', actionKind: 'skill', skillId: 'ally-action', soulTriggersAllowed: true,
    intent: { actorId: 'blue-2', skillId: 'ally-action', targetIds: ['red-1'], shape: 'single' } };
  const passive = hero.handlers['action-end'].handle(createBattleContext(initial, () => .5), actionEnd);
  assert.equal(passive.find(command => command.type === 'heal').amount, 60);
  const marked = applyEffectCommands(initial, passive, 'action-end', 'sakura-ally-action-heal', id => registry.getStatus(id));
  const turnEnd = { eventId: 'sakura-ally-turn-end', phase: 'turn-end', source: { kind: 'unit', id: '1', unitId: 'blue-2' },
    type: 'turn-ended', unitId: 'blue-2' };
  const ending = hero.handlers['turn-end'].handle(createBattleContext(marked.state, () => .5), turnEnd);
  assert.deepEqual(ending.filter(command => command.type === 'heal').map(command => [command.targetId, command.amount]),
    [['blue-2', 30], ['blue-1', 40]]);
});

test('樱花妖樱吹雪每个目标最多驱散3个增益，施加减疗和落樱，空驱散时五级返火', () => {
  const registry = new ContentRegistry();
  registerSakuraFairy(registry);
  const hero = registry.getHero(sakuraFairyIds.hero);
  const ultimate = hero.skills.find(skill => skill.id === sakuraFairyIds.ultimate);
  assert.equal(ultimate.resourceCost.amount, 3);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: sakuraFairyIds.hero, awakeFilter: 0,
    skillLevels: { [sakuraFairyIds.ultimate]: 1 }, stats: { ...initial.units['blue-1'].stats, attack: 100 } };
  for (let i = 0; i < 4; i++) registry.registerStatus({ id: `test.sakura.buff-${i}`, category: 'buff', mechanicsCoverage: 'verified',
    dispellable: i < 3, sealable: false, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  registry.registerStatus({ id: 'test.sakura.debuff', category: 'debuff', mechanicsCoverage: 'verified',
    dispellable: true, sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 1000, stats: { ...initial.units['red-1'].stats, hp: 1000 },
    statuses: [...[0, 1, 2, 3].map(i => ({ instanceId: `buff-${i}`,
    statusId: `test.sakura.buff-${i}`, source: { kind: 'system', id: 'test' }, stacks: 1,
    duration: { kind: 'count', remaining: 2, owner: 'target-turn' } })), { instanceId: 'existing-debuff', statusId: 'test.sakura.debuff',
      source: { kind: 'system', id: 'test' }, stacks: 1, duration: { kind: 'count', remaining: 2, owner: 'target-turn' } }] };
  const skillIntent = { actorId: 'blue-1', skillId: sakuraFairyIds.ultimate, targetIds: ['red-1'], shape: 'all-enemies', targetRelation: 'enemy' };
  const commands = ultimate.execute(createBattleContext(initial, () => .1, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable ?? false), skillIntent, { rank: 1 });
  const dispel = commands.find(command => command.type === 'dispel-statuses');
  assert.equal(dispel.maxCount, 3);
  assert.equal(dispel.filter, 'buff');
  assert.equal(commands.some(command => command.type === 'change-resource'), false, '驱散到任一增益时不返还鬼火');
  const applied = applyEffectCommands(initial, commands, 'effect-resolution', 'sakura-ultimate', id => registry.getStatus(id));
  assert.equal(applied.state.units['red-1'].statuses.some(status => status.statusId === 'test.sakura.buff-3'), true);
  assert.equal(applied.state.units['red-1'].statuses.some(status => status.statusId === 'test.sakura.debuff'), true,
    '增益不足3个时不应误驱散已有减益');
  assert.equal(applied.state.units['red-1'].statuses.some(status => status.statusId === sakuraFairyIds.healingReduction), true);
  const reduction = applied.state.units['red-1'].statuses.find(status => status.statusId === sakuraFairyIds.healingReduction);
  assert.equal(reduction.modifiers[0].amount, -.5);
  const blossom = applied.state.units['red-1'].statuses.find(status => status.statusId === sakuraFairyIds.cherryBlossom);
  assert.equal(blossom.values.indirectDamageRatio, .09);
  const tick = registry.getStatus(sakuraFairyIds.cherryBlossom).handlers['turn-end'].handle(
    createBattleContext(applied.state, () => .5), { eventId: 'sakura-dot-end', phase: 'turn-end', source: { kind: 'unit', id: '1', unitId: 'red-1' },
      type: 'turn-ended', unitId: 'red-1' });
  assert.equal(tick[0].amount, 90, '落樱按目标生命上限9%结算，且不超过樱花妖攻击370%');

  const castAt = (rank, awake, random) => {
    const lineup = { ...initial, units: { ...initial.units, 'blue-1': { ...initial.units['blue-1'], awakeFilter: awake,
      skillLevels: { [sakuraFairyIds.ultimate]: rank } } } };
    return ultimate.execute(createBattleContext(lineup, () => random, id => registry.getStatus(id)?.category,
      id => registry.getStatus(id)?.dispellable ?? false), skillIntent, { rank });
  };
  const resistedByBaseChance = castAt(1, 0, .9);
  assert.equal(resistedByBaseChance.some(command => command.type === 'add-status'
    && command.instance.statusId === sakuraFairyIds.healingReduction), false, '未觉醒按50%基础概率');
  const awakenedHit = castAt(1, 1, .99);
  assert.equal(awakenedHit.some(command => command.type === 'add-status'
    && command.instance.statusId === sakuraFairyIds.healingReduction), true, '觉醒后按100%基础概率');
  assert.equal(castAt(2, 1, .1).find(command => command.type === 'add-status'
    && command.instance.statusId === sakuraFairyIds.cherryBlossom).instance.values.indirectDamageRatio, .14);
  assert.equal(castAt(3, 1, .1).find(command => command.type === 'add-status'
    && command.instance.statusId === sakuraFairyIds.cherryBlossom).instance.values.indirectDamageRatio, .19);
  assert.equal(castAt(4, 1, .1).find(command => command.type === 'add-status'
    && command.instance.statusId === sakuraFairyIds.healingReduction).instance.modifiers[0].amount, -.6);

  const empty = { ...initial, units: { ...initial.units, 'blue-1': { ...initial.units['blue-1'], awakeFilter: 1,
    skillLevels: { [sakuraFairyIds.ultimate]: 5 } }, 'red-1': { ...initial.units['red-1'], statuses: [] } } };
  const rankFive = ultimate.execute(createBattleContext(empty, () => .1, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable ?? false), skillIntent, { rank: 5 });
  assert.equal(rankFive.find(command => command.type === 'change-resource').amount, 1);
  const paid = executeAction(empty, { ...skillIntent, targetIds: ['red-1'] }, registry, () => .1);
  assert.equal(paid.accepted, true);
  assert.equal(paid.state.resources.blue.fire, 2, '五级樱吹雪支付3火后在没有可驱散增益时返还1火');
});

test('惠比寿普攻拉动鲤鱼旗、旗帜治疗友方且行动驱散并在五级回复鬼火', () => {
  const registry = new ContentRegistry();
  registerEbisu(registry);
  const hero = registry.getHero(ebisuIds.hero);
  const summonSkill = hero.skills.find(skill => skill.id === ebisuIds.summon);
  const basic = hero.skills.find(skill => skill.id === ebisuIds.basic);
  const flagAction = hero.skills.find(skill => skill.id === ebisuIds.flagAction);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: ebisuIds.hero, skillLevel: 5,
    skillLevels: { [ebisuIds.basic]: 5, [ebisuIds.summon]: 5, [ebisuIds.passive]: 3 },
    stats: { ...initial.units['blue-1'].stats, hp: 1000, speed: 100 }, hp: 1000, statuses: [] };
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', hp: 500, side: 'blue',
    stats: { ...initial.units['blue-1'].stats, hp: 1000 }, statuses: [] };
  initial.units['blue-3'] = { ...initial.units['blue-1'], unitId: 'blue-3', heroId: 400, hp: 299, side: 'blue', statuses: [] };
  initial.sides.blue = ['blue-1', 'blue-2', 'blue-3'];
  const owner = initial.units['blue-1'];
  const summonCommands = summonSkill.execute(createBattleContext(initial), { actorId: owner.unitId,
    skillId: ebisuIds.summon, targetIds: [owner.unitId], shape: 'self', targetRelation: 'ally' }, { rank: 5 });
  assert.equal(summonCommands.find(command => command.type === 'summon-unit').unit.stats.hp, 400,
    '鲤鱼旗基础继承惠比寿40%生命；未导出的后续等级继承值不臆测');
  let summoned = applyEffectCommands(initial, summonCommands, 'effect-resolution', 'ebisu-summon', id => registry.getStatus(id)).state;
  const flagId = summonCommands.find(command => command.type === 'summon-unit').unit.unitId;
  const flag = summoned.units[flagId];
  assert.ok(flag);
  assert.equal(flag.stats.speed, 140, '五级召唤技能按技能文本继承140%速度');
  const speedContext = createBattleContext(summoned, () => .5, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable ?? false);
  assert.equal(speedContext.getEffectiveStats('blue-2').speed, 120, '四级起全体友方加20速度');
  assert.equal(speedContext.getEffectiveStats('blue-3').speed, 150, '生命低于30%时额外加30速度');
  summoned.units['blue-3'] = { ...summoned.units['blue-3'], hp: 300 };
  assert.equal(createBattleContext(summoned, () => .5, id => registry.getStatus(id)?.category).getEffectiveStats('blue-3').speed, 120,
    '恰为30%生命时不触发“低于30%”的额外速度');
  summoned.units['blue-3'] = { ...summoned.units['blue-3'], hp: 299 };
  const actionEndIntent = { actorId: flag.unitId, skillId: ebisuIds.flagAction, targetIds: ['blue-1', 'blue-2', 'blue-3'],
    shape: 'all-allies', targetRelation: 'ally' };
  registry.registerStatus({ id: 'test.ebisu.debuff', mechanicsCoverage: 'verified', category: 'debuff', dispellable: true,
    sealable: true, durationOwner: 'target-turn', refreshPolicy: 'replace' });
  summoned.units['blue-2'] = { ...summoned.units['blue-2'], statuses: [{ instanceId: 'ebisu-debuff', statusId: 'test.ebisu.debuff',
    source: { kind: 'system', id: 'test' }, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }] };
  const actions = flagAction.execute(createBattleContext(summoned, () => .5, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable ?? false), actionEndIntent, {});
  assert.equal(actions.some(command => command.type === 'dispel-statuses' && command.targetId === 'blue-2'), true);
  assert.equal(actions.some(command => command.type === 'change-resource' && command.amount === 1), true);
  summoned = applyEffectCommands(summoned, actions, 'effect-resolution', 'ebisu-flag-turn', id => registry.getStatus(id)).state;
  const turnStart = { eventId: 'ebisu-ally-start', phase: 'turn-start', source: { kind: 'unit', id: '400', unitId: 'blue-3' },
    type: 'turn-started', unitId: 'blue-3' };
  const healing = hero.handlers['turn-start'].handle(createBattleContext(summoned), turnStart);
  assert.equal(healing[0].amount, 160, '行动前治疗鲤鱼旗最大生命值的40%');
  const basicIntent = { actorId: owner.unitId, skillId: ebisuIds.basic, targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' };
  const bar = basic.execute(createBattleContext(summoned, () => .5), basicIntent, { ratio: 1.25 });
  assert.equal(bar.find(command => command.type === 'change-action-gauge').amount, 30);
  const attacked = { eventId: 'ebisu-hit', phase: 'hit', source: { kind: 'skill', id: 'enemy', unitId: 'red-1' },
    type: 'damage', targetId: 'blue-1', amount: 100, hpLost: 100, mitigated: 0, isCritical: false };
  const passive = hero.handlers.hit.handle(createBattleContext(summoned, () => .29), attacked);
  assert.equal(passive[0].amount, 1, '三级转祸为福按30%概率返1火');
  assert.equal(hero.handlers.hit.handle(createBattleContext(summoned, () => .31), attacked), undefined);
  const defeated = { eventId: 'ebisu-flag-defeated', phase: 'unit-defeated', source: { kind: 'unit', id: '268' },
    type: 'unit-defeated', unitId: flag.unitId };
  const cleanup = hero.handlers['unit-defeated'].handle(createBattleContext(summoned), defeated);
  const expiredAura = applyEffectCommands(summoned, cleanup, 'unit-defeated', 'ebisu-aura-cleanup', id => registry.getStatus(id)).state;
  assert.equal(expiredAura.units['blue-2'].statuses.some(status => status.statusId === ebisuIds.speedAura), false);
});

test('般若鬼袭变更普攻为鬼之爪，被动按40%基础概率封御魂且觉醒后同时封被动', () => {
  const registry = new ContentRegistry();
  registerHannya(registry);
  const hero = registry.getHero(hannyaIds.hero);
  const ultimate = hero.skills.find(skill => skill.id === hannyaIds.ultimate);
  const claw = hero.skills.find(skill => skill.id === hannyaIds.claw);
  assert.equal(ultimate.resourceCost.amount, 3);
  const initial = state();
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: hannyaIds.hero, awakeFilter: 0, skillLevel: 5,
    skillLevels: { [hannyaIds.basic]: 5, [hannyaIds.ultimate]: 5 }, stats: { ...initial.units['blue-1'].stats, hit: 0 } };
  const actor = initial.units['blue-1'];
  const intent = { actorId: actor.unitId, skillId: hannyaIds.ultimate, targetIds: ['red-1'], shape: 'all-enemies', targetRelation: 'enemy' };
  const cast = ultimate.execute(createBattleContext(initial, () => .5), intent, { ratio: 1.3 });
  const frenzy = cast.find(command => command.type === 'add-status' && command.instance.statusId === hannyaIds.frenzy);
  assert.equal(frenzy.instance.duration.remaining, 2);
  const clawIntent = { actorId: actor.unitId, skillId: hannyaIds.claw, targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' };
  assert.equal(claw.execute(createBattleContext({ ...initial, units: { ...initial.units, 'blue-1': { ...actor, statuses: [frenzy.instance] } } }, () => .5),
    clawIntent, {}).filter(command => command.type === 'deal-damage').length, 2);

  const hit = { eventId: 'hannya-hit', phase: 'hit', source: { kind: 'skill', id: hannyaIds.basic, unitId: actor.unitId },
    type: 'damage', targetId: 'red-1', amount: 100, hpLost: 100, mitigated: 0, isCritical: false };
  const beforeAwakening = hero.handlers.hit.handle(createBattleContext(initial, () => .39), hit);
  assert.equal(beforeAwakening[0].instance.values.sealSouls, true);
  assert.equal(beforeAwakening[0].instance.values.sealPassives, false);
  assert.equal(beforeAwakening[0].instance.duration.remaining, 2);
  const sealed = applyEffectCommands(initial, beforeAwakening, 'hit', 'hannya-seal', id => registry.getStatus(id)).state;
  const sealedTarget = sealed.units['red-1'];
  assert.equal(soulsEnabled(sealedTarget), false);
  assert.equal(passivesEnabled(sealedTarget), true);
  assert.deepEqual(hero.handlers.hit.handle(createBattleContext(initial, () => .41), hit), [],
    '基础概率40%，超过概率后不附加封印');

  initial.units['blue-1'] = { ...actor, awakeFilter: 1 };
  const awakenedSeal = hero.handlers.hit.handle(createBattleContext(initial, () => .39), hit);
  assert.equal(awakenedSeal[0].instance.values.sealPassives, true);
  const awakenedState = applyEffectCommands(initial, awakenedSeal, 'hit', 'hannya-awakened-seal', id => registry.getStatus(id)).state;
  assert.equal(passivesEnabled(awakenedState.units['red-1']), false);
  const policyState = { ...awakenedState, units: { ...awakenedState.units,
    'blue-1': { ...awakenedState.units['blue-1'], statuses: [frenzy.instance] } } };
  assert.equal(hero.policy(createBattleContext(policyState), 'blue-1').skillId, hannyaIds.claw);
});

test('应声虫仅在友方普通攻击后按20%概率协战，协战动作和被封御魂者不再触发', () => {
  const registry = new ContentRegistry();
  registerEchoingInsect(registry);
  registerGenericFallbackHeroes(registry);
  const soul = registry.getSoul(echoingInsectIds.soul);
  const initial = state();
  initial.units['blue-2'] = { ...initial.units['blue-1'], unitId: 'blue-2', heroId: 201, soulId: echoingInsectIds.soul, side: 'blue' };
  initial.sides.blue = ['blue-1', 'blue-2'];
  const action = { eventId: 'echo-ally-basic', phase: 'action-end', source: { kind: 'skill', id: '2011', unitId: 'blue-1' },
    type: 'action-ended', actionKind: 'basic', skillId: '2011', soulTriggersAllowed: true,
    intent: { actorId: 'blue-1', skillId: '2011', targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' } };
  const commands = soul.handlers['action-end'].handle(createBattleContext(initial, () => .19), action);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].type, 'schedule-action');
  assert.equal(commands[0].scheduling, 'assist');
  assert.equal(commands[0].intent.actorId, 'blue-2');
  assert.equal(commands[0].intent.targetIds[0], 'red-1');
  assert.equal(commands[0].intent.skillId, '2011');
  const assist = executeAction(initial, commands[0].intent, registry, () => .5, { scheduling: 'assist', reaction: true });
  assert.equal(assist.accepted, true, '协战可在注册的基础攻击技能上执行');
  assert.equal(assist.events.find(event => event.type === 'action-ended').actionKind, 'passive');
  assert.deepEqual(soul.handlers['action-end'].handle(createBattleContext(initial, () => .2), action), [],
    '20%概率边界不触发');
  assert.equal(soul.handlers['action-end'].handle(createBattleContext(initial, () => .01), { ...action, scheduling: 'assist' }), undefined,
    '协战动作不再递归触发');
  assert.equal(soul.handlers['action-end'].handle(createBattleContext(initial, () => .01), { ...action, soulTriggersAllowed: false }), undefined,
    '技能禁止御魂触发时不协战');
  initial.units['blue-2'] = { ...initial.units['blue-2'], statuses: [{ instanceId: 'echo-sealed', statusId: 'core.soul-suppression',
    source: { kind: 'system', id: 'test' }, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }] };
  assert.deepEqual(soul.handlers['action-end'].handle(createBattleContext(initial, () => .01), action), [],
    '御魂封印期间不协战');
});

test('荒川之主使用客户端普攻 ID，吞噬接入鬼火、孤立、双段伤害和君临状态', () => {
  const registry = new ContentRegistry();
  registerArakawa(registry);
  const initial = state();
  initial.counters = { round: 1, action: 0, attack: 0, hit: 0 };
  initial.units['blue-1'] = { ...initial.units['blue-1'], heroId: arakawaIds.hero, skillLevel: 1,
    skillLevels: { [arakawaIds.basic]: 5, [arakawaIds.passive]: 4, [arakawaIds.ultimate]: 5 },
    stats: { ...initial.units['blue-1'].stats, hp: 1000, attack: 100, defense: 0, speed: 200, crit: 0 }, hp: 1000 };
  initial.units['red-1'] = { ...initial.units['red-1'], hp: 1000, shield: 0,
    stats: { ...initial.units['red-1'].stats, hp: 1000, defense: 0, speed: 1 } };
  const result = runBattle(initial, registry, { seed: 21, actionLimit: 1 });
  assert.equal(result.state.resources.blue.fire, 1, '吞噬 pays the client 3-fire cost');
  const hits = result.events.filter(event => event.type === 'damage' && event.source.unitId === 'blue-1');
  assert.equal(hits.length, 2, '吞噬 resolves its 53% first strike and second strike');
  assert.ok(hits[0].amount >= 52 && hits[0].amount <= 54);
  assert.ok(hits[1].amount >= 267 && hits[1].amount <= 273, 'rank-five second hit is 270%');
  assert.ok(result.state.units['red-1'].statuses.some(status => status.statusId === arakawaIds.isolated && status.duration.remaining === 2));
  assert.ok(result.state.units['blue-1'].statuses.some(status => status.statusId === arakawaIds.passiveMark));
  assert.ok(result.state.units['blue-1'].statuses.some(status => status.statusId === arakawaIds.junlin && status.duration.remaining === 2));
  const passive = registry.getHero(arakawaIds.hero);
  assert.equal(passive.modifyCriticalDamage(initial.units['blue-1'], initial.units['red-1'], 150, 100, initial), 170,
    'passive adds 20% of base damage to critical hits');
  const hitEvent = { eventId: 'crit-hit', phase: 'hit', source: { kind: 'skill', id: arakawaIds.basic, unitId: 'blue-1' },
    type: 'damage', targetId: 'red-1', damageKind: 'normal', amount: 100, hpLost: 100, mitigated: 0, isCritical: true };
  const lifestealCommands = passive.handlers.hit.handle(createBattleContext(initial), hitEvent);
  assert.equal(lifestealCommands[0].type, 'heal');
  assert.equal(lifestealCommands[0].amount, 20, 'rank-four critical hit leeches 20% of actual HP damage');
  assert.equal(registry.getHero(arakawaIds.hero).skills.find(skill => skill.id === arakawaIds.basic).id, '2481');
});

function kawaTestBattle(rank = 1) {
  const unit = (unitId, side, heroId, hp, attack = 100, speed = 100) => ({ unitId, heroId, skillLevel: 1,
    skillLevels: { [kawaArakawaIds.furySkill]: rank, [kawaArakawaIds.slash]: rank, [kawaArakawaIds.basic]: rank }, side,
    stats: { hp: 1000, attack, defense: 0, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 },
    hp, shield: 0, actionGauge: 0, statuses: [], resources: {} });
  const owner = unit('blue-1', 'blue', kawaArakawaIds.hero, 1000, 100, 180);
  const ally = unit('blue-2', 'blue', 1, 1000, 100, 90);
  const enemy = unit('red-1', 'red', 2, 1000, 100, 80);
  return { units: { [owner.unitId]: owner, [ally.unitId]: ally, [enemy.unitId]: enemy },
    sides: { blue: [owner.unitId, ally.unitId], red: [enemy.unitId] },
    resources: { blue: { fire: 5 }, red: { fire: 5 } }, resourceMeters: {},
    counters: { round: 1, action: 0, attack: 0, hit: 0 }, ended: false };
}

function kawaDispatcher(registry) {
  const dispatcher = new EventDispatcher();
  const hero = registry.getHero(kawaArakawaIds.hero);
  for (const [phase, rule] of Object.entries(hero.handlers)) dispatcher.register({ id: `hero:${hero.id}:${phase}`,
    phase, priority: rule.priority, handle: rule.handle });
  return dispatcher;
}

test('骁浪荒川之主的川怒不耗火、海怒最多三层，重击被动按战斗回合只触发一次', () => {
  const registry = new ContentRegistry();
  registerKawaArakawa(registry);
  let initial = kawaTestBattle(5);
  const dispatcher = kawaDispatcher(registry);
  const runtime = { dispatcher, resolveStatus: id => registry.getStatus(id) };
  for (let i = 0; i < 4; i++) {
    const result = executeAction(initial, { actorId: 'blue-1', skillId: kawaArakawaIds.furySkill,
      targetIds: ['blue-1'], shape: 'self', targetRelation: 'ally' }, registry, () => .5, runtime);
    assert.equal(result.accepted, true);
    initial = result.state;
  }
  assert.equal(initial.resources.blue.fire, 5, '川怒 is a free cast');
  assert.equal(initial.units['blue-1'].statuses.find(status => status.statusId === kawaArakawaIds.seaFury).stacks, 3);
  assert.ok(initial.units['blue-1'].statuses.some(status => status.statusId === kawaArakawaIds.furyThree));
  assert.equal(effectiveStats(initial.units['blue-1']).speed, 270, 'three Sea Fury stacks each add 30 speed');
  assert.equal(initial.units['blue-2'].statuses.find(status => status.statusId === kawaArakawaIds.unflinching).values.reduction, .1);

  const victim = initial.units['blue-2'];
  const hit = { eventId: 'kawa-hit-1', phase: 'hit', type: 'damage', source: { kind: 'skill', id: 'test.hit' },
    targetId: victim.unitId, damageKind: 'normal', amount: 301, hpLost: 301, mitigated: 0, isCritical: false };
  const exactThreshold = settleEvents(initial, [{ ...hit, eventId: 'kawa-hit-exact', amount: 300, hpLost: 300 }],
    dispatcher, () => .5, undefined, id => registry.getStatus(id));
  assert.equal(exactThreshold.state.units['blue-2'].actionGauge, 0, 'exactly 30 percent does not exceed the threshold');
  let settled = settleEvents(initial, [hit], dispatcher, () => .5, undefined, id => registry.getStatus(id));
  assert.equal(settled.state.units['blue-2'].actionGauge, 50);
  assert.equal(settled.state.units['blue-1'].statuses.find(status => status.statusId === kawaArakawaIds.seaFury).stacks, 3);
  const secondHit = { ...hit, eventId: 'kawa-hit-2', targetId: 'blue-1' };
  settled = settleEvents(settled.state, [secondHit], dispatcher, () => .5, undefined, id => registry.getStatus(id));
  assert.equal(settled.state.units['blue-1'].actionGauge, 0, 'the passive does not trigger twice in one round');
  assert.equal(settled.state.units['blue-1'].statuses.find(status => status.statusId === kawaArakawaIds.turnTrigger).values.round, 1);
});

test('骁浪海作斩消耗三火并在击杀后减一层海怒，三级孤立禁止伤害分摊', () => {
  const registry = new ContentRegistry();
  registerKawaArakawa(registry);
  const initial = kawaTestBattle(3);
  const owner = { ...initial.units['blue-1'], statuses: [{ instanceId: 'fury', statusId: kawaArakawaIds.seaFury,
    source: { kind: 'skill', id: kawaArakawaIds.furySkill, unitId: 'blue-1' }, stacks: 2,
    duration: { kind: 'permanent' }, modifiers: [{ stat: 'speed', operation: 'flat', amount: 30, perStack: true }] }] };
  const enemy = { ...initial.units['red-1'], hp: 1 };
  const battle = { ...initial, units: { ...initial.units, 'blue-1': owner, 'red-1': enemy } };
  let cannotBeShared;
  const result = executeAction(battle, { actorId: 'blue-1', skillId: kawaArakawaIds.slash,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => .5,
  { dispatcher: kawaDispatcher(registry), resolveStatus: id => registry.getStatus(id),
    interceptDamage(_state, _attacker, _target, _amount, _kind, _attackId, _hitIndex, _source, isolated) { cannotBeShared = isolated; } });
  assert.equal(result.accepted, true);
  assert.equal(result.state.resources.blue.fire, 2);
  assert.equal(result.state.units['blue-1'].statuses.find(status => status.statusId === kawaArakawaIds.seaFury).stacks, 1);
  assert.equal(cannotBeShared, true, 'rank-three slash passes the isolation flag into damage-sharing interception');
});

test('骁浪荒川之主阵亡后留场行动，按等级施放海浪并保留三层海怒', () => {
  const registry = new ContentRegistry();
  registerKawaArakawa(registry);
  const initial = kawaTestBattle(4);
  const owner = { ...initial.units['blue-1'], hp: 0, statuses: [{ instanceId: 'fury', statusId: kawaArakawaIds.seaFury,
    source: { kind: 'skill', id: kawaArakawaIds.furySkill, unitId: 'blue-1' }, stacks: 3,
    duration: { kind: 'permanent' } }] };
  const battle = { ...initial, units: { ...initial.units, 'blue-1': owner, 'blue-2': { ...initial.units['blue-2'], hp: 100 } } };
  const defeated = { eventId: 'kawa-death', phase: 'unit-defeated', type: 'unit-defeated', unitId: 'blue-1' };
  const dispatcher = kawaDispatcher(registry);
  const death = settleEvents(battle, [defeated], dispatcher, () => .5, undefined, id => registry.getStatus(id));
  assert.equal(death.state.units['blue-1'].hp, 0);
  assert.ok(death.state.units['blue-1'].statuses.some(status => status.statusId === kawaArakawaIds.spirit));
  assert.equal(death.state.units['blue-1'].statuses.find(status => status.statusId === kawaArakawaIds.spirit).values.fightingSpirit, true);
  assert.equal(require('../dist-test-renderer/renderer/features/duel/engine/core/types.js').isUnitFightingSpirit(death.state.units['blue-1']), true);
  assert.equal(death.state.units['blue-1'].statuses.find(status => status.statusId === kawaArakawaIds.seaFury).stacks, 3);
  assert.equal(death.state.units['blue-2'].hp, 225, 'rank four heals surviving allies for 125% of initial attack');
  assert.ok(death.state.units['blue-2'].statuses.some(status => status.statusId === kawaArakawaIds.unflinching));
  assert.equal(checkBattleEnd(death.state), undefined, 'the spirit still occupies its slot');
  assert.ok(scheduleNextActor(death.state, () => .1));

  const action = executeAction(death.state, { actorId: 'blue-1', skillId: kawaArakawaIds.spiritWave,
    targetIds: ['red-1'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .5,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(action.accepted, true, `spirit action rejected: ${action.failure}`);
  const wave = action.events.find(event => event.type === 'damage' && event.source.id === kawaArakawaIds.spiritWave);
  assert.equal(wave.amount, 44, 'rank two increases the wave to 22% of team initial attack');
  assert.ok(wave.suppressSoulTriggers && wave.suppressTargetPassiveTriggers && wave.suppressSourcePassiveTriggers);
  assert.equal(action.state.units['blue-1'].hp, 0);
  assert.equal(action.state.units['blue-1'].statuses.find(status => status.statusId === kawaArakawaIds.spirit).values.waveCount, 1);
});

function crabTestBattle(rank = 1, fire = 5) {
  const unit = (unitId, side, heroId, hp, attack = 100, speed = 100) => ({ unitId, heroId, skillLevel: 1,
    skillLevels: { [crabSisterIds.basic]: rank, [crabSisterIds.passive]: rank, [crabSisterIds.hammer]: rank }, side,
    stats: { hp: 1000, attack, defense: 0, speed, crit: 0, critDamage: 1.5, hit: 0, resist: 0 },
    hp, shield: 0, actionGauge: 0, statuses: [], resources: {} });
  const crab = unit('blue-1', 'blue', crabSisterIds.hero, 1000, 100, 100);
  const enemy = unit('red-1', 'red', 1, 1000, 100, 80);
  const enemy2 = unit('red-2', 'red', 2, 1000, 100, 70);
  return { units: { [crab.unitId]: crab, [enemy.unitId]: enemy, [enemy2.unitId]: enemy2 },
    sides: { blue: [crab.unitId], red: [enemy.unitId, enemy2.unitId] },
    resources: { blue: { fire }, red: { fire } }, resourceMeters: {},
    counters: { round: 1, action: 0, attack: 0, hit: 0 }, ended: false };
}

function crabDispatcher(registry) {
  const dispatcher = new EventDispatcher();
  const hero = registry.getHero(crabSisterIds.hero);
  for (const [phase, rule] of Object.entries(hero.handlers)) dispatcher.register({ id: `hero:${hero.id}:${phase}`,
    phase, priority: rule.priority, handle: rule.handle });
  return dispatcher;
}

test('蟹姬左右钳普攻按等级两段结算，自身回合后提速并给下一锤免除自晕', () => {
  const registry = new ContentRegistry();
  registerCrabSister(registry);
  const initial = crabTestBattle(5);
  const runtime = { dispatcher: crabDispatcher(registry), resolveStatus: id => registry.getStatus(id) };
  const basic = executeAction(initial, { actorId: 'blue-1', skillId: crabSisterIds.basic,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => .5, runtime);
  assert.equal(basic.accepted, true);
  const basicHits = basic.events.filter(event => event.type === 'damage' && event.source.id === crabSisterIds.basic);
  assert.equal(basicHits.length, 2);
  assert.deepEqual(basicHits.map(hit => hit.amount), [62.5, 62.5]);
  assert.equal(basic.state.resources.blue.fire, 5);
  const momentum = basic.state.units['blue-1'].statuses.find(status => status.statusId === crabSisterIds.momentum);
  assert.ok(momentum);
  assert.equal(effectiveStats(basic.state.units['blue-1']).speed, 130);

  const hammer = executeAction(basic.state, { actorId: 'blue-1', skillId: crabSisterIds.hammer,
    targetIds: ['red-1', 'red-2'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .5, runtime);
  assert.equal(hammer.accepted, true);
  const hammerHits = hammer.events.filter(event => event.type === 'damage' && event.source.id === crabSisterIds.hammer);
  assert.equal(hammerHits.length, 4, 'the all-enemies skill hits each enemy twice');
  assert.equal(hammer.state.resources.blue.fire, 2);
  assert.ok(!hammer.state.units['blue-1'].statuses.some(status => status.statusId === crabSisterIds.momentum));
  assert.ok(!hammer.state.units['blue-1'].statuses.some(status => status.statusId === crabSisterIds.selfStun));

  const assisted = executeAction(initial, { actorId: 'blue-1', skillId: crabSisterIds.basic,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => .5,
  { ...runtime, scheduling: 'assist' });
  assert.equal(assisted.accepted, true);
  assert.ok(!assisted.state.units['blue-1'].statuses.some(status => status.statusId === crabSisterIds.momentum),
    'an assist is outside Crab Sister own turn and does not create the one-use hammer protection');
});

test('蟹壳只降低非暴击伤害并把累计减伤限制在攻击力上限', () => {
  const registry = new ContentRegistry();
  registerCrabSister(registry);
  const initial = crabTestBattle(5);
  const crab = registry.getHero(crabSisterIds.hero);
  const context = createBattleContext(initial, () => .5, id => registry.getStatus(id)?.category);
  const shellCommand = crab.initialize(context, 'blue-1')[0];
  const opened = applyEffectCommands(initial, [shellCommand], 'effect-resolution', 'crab-shell-init', id => registry.getStatus(id));
  const interceptDamage = (state, attacker, target, amount, kind, attackId, hitIndex, source, cannotBeShared, isCritical) =>
    crab.interceptIncomingDamage(state, attacker, target, amount, kind, { attackId, hitIndex, source, cannotBeShared,
      isCritical, targetIds: [target.unitId], battle: createBattleContext(state, () => .5, id => registry.getStatus(id)?.category),
      isUnitUnableToAct: () => false });
  const first = applyEffectCommands(opened.state, [{ type: 'deal-damage', source: { kind: 'skill', id: 'test.incoming', unitId: 'red-1' },
    targetId: 'blue-1', amount: 300, isCritical: false }], 'effect-resolution', 'crab-hit-1', id => registry.getStatus(id),
  undefined, interceptDamage);
  assert.equal(first.state.units['blue-1'].hp, 820, 'rank four shell reduces the first noncritical hit by 40%');
  assert.equal(first.state.units['blue-1'].statuses.find(status => status.statusId === crabSisterIds.shell).values.reduced, 120);
  const capped = applyEffectCommands(first.state, [{ type: 'deal-damage', source: { kind: 'skill', id: 'test.incoming', unitId: 'red-1' },
    targetId: 'blue-1', amount: 500, isCritical: false }], 'effect-resolution', 'crab-hit-2', id => registry.getStatus(id),
  undefined, interceptDamage);
  assert.equal(capped.state.units['blue-1'].hp, 350, 'remaining protection is limited by the 150% attack cap');
  assert.equal(capped.state.units['blue-1'].statuses.find(status => status.statusId === crabSisterIds.shell).values.reduced, 150);
  const critical = applyEffectCommands(capped.state, [{ type: 'deal-damage', source: { kind: 'skill', id: 'test.critical', unitId: 'red-1' },
    targetId: 'blue-1', amount: 100, isCritical: true }], 'effect-resolution', 'crab-hit-3', id => registry.getStatus(id),
  undefined, interceptDamage);
  assert.equal(critical.state.units['blue-1'].hp, 250, 'critical damage bypasses shell reduction');
  assert.equal(effectiveStats(initial.units['blue-1']).critResist ?? 0, 0);
  assert.equal(effectiveCritResist(opened.state.units['blue-1']), .3);
});

test('蟹姬螺螺锤无来劲时自晕，五级自晕期间得蟹壳，解控后获得40%暴伤', () => {
  const registry = new ContentRegistry();
  registerCrabSister(registry);
  const initial = crabTestBattle(5);
  const dispatcher = crabDispatcher(registry);
  const runtime = { dispatcher, resolveStatus: id => registry.getStatus(id) };
  const hammer = executeAction(initial, { actorId: 'blue-1', skillId: crabSisterIds.hammer,
    targetIds: ['red-1', 'red-2'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .5, runtime);
  assert.equal(hammer.accepted, true);
  assert.equal(hammer.events.filter(event => event.type === 'damage' && event.source.id === crabSisterIds.hammer).length, 4);
  assert.ok(hammer.state.units['blue-1'].statuses.some(status => status.statusId === crabSisterIds.selfStun));
  assert.ok(hammer.state.units['blue-1'].statuses.some(status => status.statusId === crabSisterIds.shell));
  const stun = hammer.state.units['blue-1'].statuses.find(status => status.statusId === crabSisterIds.selfStun);
  const removed = applyEffectCommands(hammer.state, [{ type: 'remove-status-instances', source: stun.source,
    targetId: 'blue-1', instanceIds: [stun.instanceId], reason: 'consumed' }], 'effect-resolution', 'crab-stun-clear',
  id => registry.getStatus(id));
  const settled = settleEvents(removed.state, removed.events, dispatcher, () => .5, undefined, id => registry.getStatus(id));
  const postStun = settled.state.units['blue-1'].statuses.find(status => status.statusId === crabSisterIds.postStun);
  assert.ok(postStun);
  assert.equal(postStun.duration.remaining, 1);
  assert.equal(effectiveStats(settled.state.units['blue-1']).critDamage, 1.9);
});

test('蟹姬先机与无控制的自身回合末获得对应等级蟹壳，受控时不获得', () => {
  const registry = new ContentRegistry();
  registerCrabSister(registry);
  const dispatcher = crabDispatcher(registry);
  for (const [rank, expectedReduction, expectedCap] of [[1, .2, 100], [2, .3, 100], [3, .3, 150], [4, .4, 150], [5, .4, 150]]) {
    const battle = crabTestBattle(rank);
    const context = createBattleContext(battle, () => .5, id => registry.getStatus(id)?.category);
    const commands = registry.getHero(crabSisterIds.hero).initialize(context, 'blue-1');
    const opened = applyEffectCommands(battle, commands, 'effect-resolution', `crab-open-${rank}`, id => registry.getStatus(id));
    const shell = opened.state.units['blue-1'].statuses.find(status => status.statusId === crabSisterIds.shell);
    assert.equal(shell.values.reduction, expectedReduction);
    assert.equal(shell.values.cap, expectedCap);
    assert.equal(Boolean(shell.modifiers?.some(modifier => modifier.stat === 'critResist')), rank >= 5);
  }
  const battle = crabTestBattle(2);
  const turnEnd = { eventId: 'crab-passive-end', phase: 'turn-end', type: 'turn-ended', unitId: 'blue-1',
    source: { kind: 'unit', id: '335', unitId: 'blue-1' } };
  const freeTurn = settleEvents(battle, [turnEnd], dispatcher, () => .5, undefined, id => registry.getStatus(id));
  assert.ok(freeTurn.state.units['blue-1'].statuses.some(status => status.statusId === crabSisterIds.shell));
  const controlled = { ...battle, units: { ...battle.units, 'blue-1': { ...battle.units['blue-1'], statuses: [{
    instanceId: 'test.stun', statusId: crabSisterIds.selfStun, source: { kind: 'skill', id: 'test' },
    stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { controlType: '眩晕' } }] } } };
  const controlledEnd = settleEvents(controlled, [{ ...turnEnd, eventId: 'crab-passive-controlled-end' }], dispatcher,
    () => .5, undefined, id => registry.getStatus(id));
  assert.ok(!controlledEnd.state.units['blue-1'].statuses.some(status => status.statusId === crabSisterIds.shell));
});

function rukiaTestBattle(rank = 1, fire = 5) {
  const unit = (unitId, side, heroId, hp, attack = 100, speed = 100, resist = 0) => ({ unitId, heroId, skillLevel: 1,
    skillLevels: { [rukiaIds.basic]: rank, [rukiaIds.passive]: rank, [rukiaIds.ultimate]: rank }, side,
    stats: { hp: 1000, attack, defense: 0, speed, crit: 0, critDamage: 1.5, hit: 0, resist },
    hp, shield: 0, actionGauge: 0, statuses: [], resources: {} });
  const rukia = unit('blue-1', 'blue', rukiaIds.hero, 1000, 100, 100);
  const enemy = unit('red-1', 'red', 2, 1000, 100, 80, .5);
  const enemy2 = unit('red-2', 'red', 3, 1000, 100, 70, .5);
  return { units: { [rukia.unitId]: rukia, [enemy.unitId]: enemy, [enemy2.unitId]: enemy2 },
    sides: { blue: [rukia.unitId], red: [enemy.unitId, enemy2.unitId] },
    resources: { blue: { fire }, red: { fire } }, resourceMeters: {},
    counters: { round: 1, action: 0, attack: 0, hit: 0 }, ended: false };
}

function rukiaDispatcher(registry) {
  const dispatcher = new EventDispatcher();
  const hero = registry.getHero(rukiaIds.hero);
  for (const [phase, rule] of Object.entries(hero.handlers)) dispatcher.register({ id: `hero:${hero.id}:${phase}`,
    phase, priority: rule.priority, handle: rule.handle });
  return dispatcher;
}

test('朽木露琪亚在任意一方行动结束后触发阈值被动，解除控制并按等级永久变身', () => {
  const registry = new ContentRegistry();
  registerRukia(registry);
  const dispatcher = rukiaDispatcher(registry);
  const exactHalf = rukiaTestBattle(1);
  exactHalf.units['blue-1'] = { ...exactHalf.units['blue-1'], hp: 500, statuses: [{ instanceId: 'stun',
    statusId: 'test.stun', source: { kind: 'skill', id: 'test' }, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { controlType: '眩晕' } }] };
  const endEvent = { eventId: 'enemy-ended', phase: 'action-end', type: 'action-ended', actionKind: 'basic',
    skillId: 'test.enemy-basic', soulTriggersAllowed: true, source: { kind: 'skill', id: 'test.enemy-basic', unitId: 'red-1' } };
  const atThreshold = settleEvents(exactHalf, [endEvent], dispatcher, () => .5, undefined, id => registry.getStatus(id));
  assert.ok(!atThreshold.state.units['blue-1'].statuses.some(status => status.statusId === rukiaIds.form), '50% is not below the base threshold');
  assert.ok(atThreshold.state.units['blue-1'].statuses.some(status => status.statusId === 'test.stun'));

  const below = { ...exactHalf, units: { ...exactHalf.units, 'blue-1': { ...exactHalf.units['blue-1'], hp: 499 } } };
  const transformed = settleEvents(below, [{ ...endEvent, eventId: 'enemy-ended-below' }], dispatcher, () => .5,
    undefined, id => registry.getStatus(id));
  const form = transformed.state.units['blue-1'].statuses.find(status => status.statusId === rukiaIds.form);
  assert.ok(form);
  assert.equal(transformed.state.units['blue-1'].statuses.some(status => status.statusId === 'test.stun'), false);
  assert.equal(form.values.ignoreResistance, .15);
  assert.equal(effectiveStats(transformed.state.units['blue-1']).speed, 120);

  for (const [rank, expectedSpeed, expectedIgnore] of [[2, 20, .15], [3, 30, .15], [4, 30, .2]]) {
    const ranked = rukiaTestBattle(rank);
    ranked.units['blue-1'] = { ...ranked.units['blue-1'], hp: 400 };
    const result = settleEvents(ranked, [{ ...endEvent, eventId: `rank-${rank}-threshold` }], dispatcher,
      () => .5, undefined, id => registry.getStatus(id));
    const rankedForm = result.state.units['blue-1'].statuses.find(status => status.statusId === rukiaIds.form);
    assert.equal(effectiveStats(result.state.units['blue-1']).speed, 100 + expectedSpeed);
    assert.equal(rankedForm.values.ignoreResistance, expectedIgnore);
    assert.equal(rankedForm.modifiers[0].amount, expectedSpeed);
  }

  const rankFive = rukiaTestBattle(5);
  rankFive.units['blue-1'] = { ...rankFive.units['blue-1'], hp: 599 };
  const rankFiveResult = settleEvents(rankFive, [{ ...endEvent, eventId: 'rank-five-threshold' }], dispatcher,
    () => .5, undefined, id => registry.getStatus(id));
  assert.equal(rankFiveResult.state.units['blue-1'].statuses.find(status => status.statusId === rukiaIds.form).values.ignoreResistance, .2);
});

test('朽木露琪亚三火群攻逐目标判定冰冻，变身无视抵抗并附加冻伤与减速', () => {
  const registry = new ContentRegistry();
  registerRukia(registry);
  const initial = rukiaTestBattle(5);
  const formSource = { kind: 'skill', id: rukiaIds.passive, unitId: 'blue-1' };
  initial.units['blue-1'] = { ...initial.units['blue-1'], statuses: [{ instanceId: 'form', statusId: rukiaIds.form,
    source: formSource, stacks: 1, duration: { kind: 'permanent' }, values: { ignoreResistance: .2 },
    modifiers: [{ stat: 'speed', operation: 'flat', amount: 30 }] }] };
  const result = executeAction(initial, { actorId: 'blue-1', skillId: rukiaIds.ultimate,
    targetIds: ['red-1', 'red-2'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => .17,
  { dispatcher: rukiaDispatcher(registry), resolveStatus: id => registry.getStatus(id) });
  assert.equal(result.accepted, true);
  assert.equal(result.state.resources.blue.fire, 2);
  assert.equal(result.events.filter(event => event.type === 'damage' && event.source.id === rukiaIds.ultimate).length, 2);
  for (const enemyId of ['red-1', 'red-2']) {
    assert.ok(result.state.units[enemyId].statuses.some(status => status.statusId === rukiaIds.freeze), '20% resist-adjusted base chance succeeds with form ignore');
    const dot = result.state.units[enemyId].statuses.find(status => status.statusId === rukiaIds.frostBurn);
    assert.equal(dot.values.ratio, .14);
    assert.equal(dot.duration.remaining, 1);
    assert.ok(!result.state.units[enemyId].statuses.some(status => status.statusId === rukiaIds.slow), 'already frozen enemies are not slowed');
  }

  const basicStart = rukiaTestBattle(4, 0);
  basicStart.units['blue-1'] = { ...basicStart.units['blue-1'], statuses: [{ instanceId: 'form4', statusId: rukiaIds.form,
    source: formSource, stacks: 1, duration: { kind: 'permanent' }, values: { ignoreResistance: .2 },
    modifiers: [{ stat: 'speed', operation: 'flat', amount: 30 }] }] };
  const basic = executeAction(basicStart, { actorId: 'blue-1', skillId: rukiaIds.basic,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => .55,
  { dispatcher: rukiaDispatcher(registry), resolveStatus: id => registry.getStatus(id) });
  assert.equal(basic.accepted, true);
  assert.ok(basic.state.units['red-1'].statuses.some(status => status.statusId === rukiaIds.frostBurn));
  assert.ok(basic.state.units['red-1'].statuses.some(status => status.statusId === rukiaIds.slow),
    'unfrozen target receives speed-down after the form ignores part of its resistance');
});

test('朽木露琪亚冻伤在目标回合开始按最大生命比例结算并受攻击上限约束', () => {
  const registry = new ContentRegistry();
  registerRukia(registry);
  const initial = rukiaTestBattle(5);
  const target = { ...initial.units['red-1'], hp: 1000, stats: { ...initial.units['red-1'].stats, hp: 10000 },
    statuses: [{ instanceId: 'dot', statusId: rukiaIds.frostBurn,
      source: { kind: 'skill', id: rukiaIds.passive, unitId: 'blue-1' }, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { ratio: .14, attackCapRatio: 2.4 } }] };
  const battle = { ...initial, units: { ...initial.units, 'red-1': target } };
  const event = { eventId: 'frost-burn-turn', phase: 'turn-start', type: 'turn-started', unitId: 'red-1',
    source: { kind: 'unit', id: '2', unitId: 'red-1' } };
  const settled = settleEvents(battle, [event], rukiaDispatcher(registry), () => .5, undefined, id => registry.getStatus(id));
  const loss = settled.events.find(item => item.type === 'life-lost' && item.targetId === 'red-1');
  assert.ok(loss);
  assert.equal(loss.amount, 240, '14% of 10,000 HP is capped at Rukia attack times 240%');
  assert.equal(settled.state.units['red-1'].hp, 760);
});

function ichigoBattle() {
  const unit = (unitId, side, heroId, hp = 1000, actionGauge = 0) => ({ unitId, heroId, skillLevel: 5,
    skillLevels: { [ichigoIds.basic]: 5, [ichigoIds.passive]: 5, [ichigoIds.ultimate]: 5 }, side,
    awakeFilter: heroId === ichigoIds.hero ? 1 : 0,
    stats: { hp: 1000, attack: 100, defense: 0, speed: 100, crit: 0, critDamage: 1.5, hit: 0, resist: 0 },
    hp, shield: 0, actionGauge, statuses: [], resources: {} });
  const ichigo = unit('blue-1', 'blue', ichigoIds.hero), ally = unit('blue-2', 'blue', 2, 300);
  const enemy = unit('red-1', 'red', 3), enemy2 = unit('red-2', 'red', 4);
  return { units: { 'blue-1': ichigo, 'blue-2': ally, 'red-1': enemy, 'red-2': enemy2 },
    sides: { blue: ['blue-1', 'blue-2'], red: ['red-1', 'red-2'] },
    resources: { blue: { fire: 4 }, red: { fire: 4 } }, resourceMeters: {},
    counters: { round: 1, action: 0, attack: 0, hit: 0 }, ended: false };
}

function ichigoDispatcher(registry) {
  const dispatcher = new EventDispatcher(), hero = registry.getHero(ichigoIds.hero);
  for (const [phase, rule] of Object.entries(hero.handlers)) dispatcher.register({ id: `hero:${hero.id}:${phase}`,
    phase, priority: rule.priority, handle: rule.handle });
  return dispatcher;
}

test('黑崎一护按技能表结算普攻和耗火大招，回合开始按低血队友数积累灵压并转入虚化', () => {
  const registry = new ContentRegistry(); registerIchigo(registry);
  const initial = ichigoBattle(), hero = registry.getHero(ichigoIds.hero);
  const skill = hero.skills.find(item => item.id === ichigoIds.basic);
  assert.deepEqual(skill.levels.map(level => level.ratio), [.8, .85, .9, .95, 1]);
  const start = { eventId: 'ichigo-start', phase: 'turn-start', type: 'turn-started', unitId: 'blue-1',
    source: { kind: 'unit', id: String(ichigoIds.hero), unitId: 'blue-1' } };
  const ctx = createBattleContext(initial, () => .5);
  const commands = hero.handlers['turn-start'].handle(ctx, start);
  assert.equal(commands.find(command => command.type === 'add-status' && command.instance.statusId === ichigoIds.pressure).instance.stacks, 2,
    '自身回合開始时获得1层，低于40%生命比例的友方再提供1层');
  const charged = { ...initial, units: { ...initial.units, 'blue-1': { ...initial.units['blue-1'], statuses: [
    { instanceId: 'pressure', statusId: ichigoIds.pressure, source: { kind: 'skill', id: ichigoIds.passive, unitId: 'blue-1' },
      stacks: 3, duration: { kind: 'permanent' } }] } } };
  const four = hero.handlers['turn-start'].handle(createBattleContext(charged, () => .5), start);
  assert.ok(four.some(command => command.type === 'add-status' && command.instance.statusId === ichigoIds.hollow));
  const cast = executeAction(initial, { actorId: 'blue-1', skillId: ichigoIds.ultimate,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => 0);
  assert.equal(cast.state.resources.blue.fire, 1, '月牙天冲消耗3火');
  assert.equal(cast.state.units['red-1'].hp, 685, '五级月牙天冲造成315%攻击伤害');
});

test('黑崎一护的低血反击每回合一次，致命伤害后优先对伤害来源释放最后的月牙天冲', () => {
  const registry = new ContentRegistry(); registerIchigo(registry);
  const initial = ichigoBattle(), hero = registry.getHero(ichigoIds.hero);
  const source = { kind: 'skill', id: ichigoIds.passive, unitId: 'blue-1' };
  const lowHit = { eventId: 'low-ally-hit', phase: 'hit-resolution', type: 'damage', source: { kind: 'skill', id: 'enemy', unitId: 'red-1' },
    targetId: 'blue-2', amount: 20, hpLost: 20, mitigated: 0, isCritical: false };
  const counter = hero.handlers.hit.handle(createBattleContext(initial, () => .5), lowHit);
  assert.equal(counter.find(command => command.type === 'schedule-action').intent.skillId, ichigoIds.basic);
  const repeat = hero.handlers.hit.handle(createBattleContext({ ...initial, units: { ...initial.units,
    'blue-1': { ...initial.units['blue-1'], statuses: [{ instanceId: 'used', statusId: ichigoIds.countered,
      source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'round' } }] } } }), lowHit);
  assert.equal(repeat, undefined, '本回合已经反击后不重复触发');

  const ichigo = { ...initial.units['blue-1'], statuses: [{ instanceId: 'unlock', statusId: ichigoIds.finalUnlock,
    source, stacks: 1, duration: { kind: 'permanent' } }] };
  const stateWithUnlock = { ...initial, units: { ...initial.units, 'blue-1': ichigo } };
  const intercepted = hero.interceptIncomingDamage(stateWithUnlock, stateWithUnlock.units['red-1'], ichigo, 1000, 'normal', {
    attackId: 1, hitIndex: 1, targetIds: ['blue-1'], battle: createBattleContext(stateWithUnlock, () => .5), isUnitUnableToAct() { return false; } });
  assert.equal(intercepted.amount, 0, '免疫致命一击');
  const scheduled = intercepted.effects.find(command => command.type === 'schedule-action');
  assert.equal(scheduled.scheduling, 'extra-turn');
  assert.equal(scheduled.freeCast, true);
  assert.equal(scheduled.intent.targetIds[0], 'red-1', '优先选择伤害来源');
  const final = hero.skills.find(skill => skill.id === '3376-last-moon-cast');
  const finalCommands = final.execute(createBattleContext(stateWithUnlock, () => 0), scheduled.intent, { ratio: 6 });
  assert.equal(finalCommands[0].amount, 600);
  assert.equal(finalCommands[0].cannotBeShared, true);
  assert.equal(finalCommands[0].suppressTargetPassiveTriggers, true);
});

function takiyashahimeBattle(rank = 5, fire = 4) {
  const unit = (unitId, side, heroId, hp = 1000, defense = 0) => ({ unitId, heroId, skillLevel: rank,
    skillLevels: { [takiyashahimeIds.basic]: rank, [takiyashahimeIds.switch]: rank,
      [takiyashahimeIds.aoe]: rank, [takiyashahimeIds.single]: rank }, side,
    stats: { hp: 1000, attack: 100, defense, speed: 100, crit: 0, critDamage: 1.5, hit: 0, resist: 0 },
    hp, shield: 0, actionGauge: 0, statuses: [], resources: {} });
  const hero = unit('blue-1', 'blue', takiyashahimeIds.hero), enemy = unit('red-1', 'red', 1), enemy2 = unit('red-2', 'red', 2);
  return { units: { 'blue-1': hero, 'red-1': enemy, 'red-2': enemy2 }, sides: { blue: ['blue-1'], red: ['red-1', 'red-2'] },
    resources: { blue: { fire }, red: { fire } }, resourceMeters: {}, counters: { round: 1, action: 0, attack: 0, hit: 0 }, ended: false };
}

function takiyashahimeDispatcher(registry) {
  const dispatcher = new EventDispatcher(), hero = registry.getHero(takiyashahimeIds.hero);
  for (const [phase, rule] of Object.entries(hero.handlers)) dispatcher.register({ id: `hero:${hero.id}:${phase}`,
    phase, priority: rule.priority, handle: rule.handle });
  return dispatcher;
}

function initializeTakiyashahime(registry, battle) {
  const hero = registry.getHero(takiyashahimeIds.hero), context = createBattleContext(battle, () => .5);
  return applyEffectCommands(battle, hero.initialize(context, 'blue-1'), 'effect-resolution', 'moon-init', id => registry.getStatus(id)).state;
}

test('泷夜叉姬开战获得5层新月祝福并在回合末逐层把暴击抵抗转成伤害', () => {
  const registry = new ContentRegistry(); registerTakiyashahime(registry);
  let battle = initializeTakiyashahime(registry, takiyashahimeBattle());
  let moon = battle.units['blue-1'].statuses.find(status => status.statusId === takiyashahimeIds.moonCrit);
  assert.equal(moon.stacks, 5);
  assert.equal(battle.units['blue-1'].statuses.find(status => status.statusId === takiyashahimeIds.move).values.activeSkill, takiyashahimeIds.aoe);
  const event = { eventId: 'moon-turn-end', phase: 'turn-end', type: 'turn-ended', unitId: 'blue-1', actionId: 1,
    source: { kind: 'unit', id: String(takiyashahimeIds.hero), unitId: 'blue-1' } };
  const commands = registry.getHero(takiyashahimeIds.hero).handlers['turn-end'].handle(createBattleContext(battle, () => .5), event);
  battle = applyEffectCommands(battle, commands, 'effect-resolution', event.eventId, id => registry.getStatus(id)).state;
  moon = battle.units['blue-1'].statuses.find(status => status.statusId === takiyashahimeIds.moonCrit);
  assert.equal(moon.stacks, 4);
  assert.equal(battle.units['blue-1'].statuses.find(status => status.statusId === takiyashahimeIds.moonDamage).stacks, 1);
  const effective = require('../dist-test-renderer/renderer/features/duel/engine/mechanics/stats.js').effectiveStats(battle.units['blue-1']);
  assert.equal(effectiveCritResist(battle.units['blue-1']), .8);
  assert.equal(effectiveDamageMultiplier(battle.units['blue-1']), 1.2);
});

test('泷夜叉姬切换月之奥义形态有冷却，群攻三段、单体五段并按等级耗3火', () => {
  const registry = new ContentRegistry(); registerTakiyashahime(registry);
  const battle = initializeTakiyashahime(registry, takiyashahimeBattle(5, 4));
  const dispatcher = takiyashahimeDispatcher(registry);
  const toggle = executeAction(battle, { actorId: 'blue-1', skillId: takiyashahimeIds.switch,
    targetIds: ['blue-1'], shape: 'self', targetRelation: 'ally' }, registry, () => 0, { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(toggle.accepted, true);
  assert.equal(toggle.state.units['blue-1'].statuses.find(status => status.statusId === takiyashahimeIds.move).values.activeSkill,
    takiyashahimeIds.single);
  assert.equal(toggle.state.units['blue-1'].statuses.find(status => status.statusId === takiyashahimeIds.cooldown).values.remaining, 1,
    '五级切换冷却1回合');
  assert.equal(registry.getHero(takiyashahimeIds.hero).skills.find(skill => skill.id === takiyashahimeIds.switch)
    .canUse(toggle.state, toggle.state.units['blue-1']), false);
  const single = executeAction(toggle.state, { actorId: 'blue-1', skillId: takiyashahimeIds.single,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => 0,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(single.state.resources.blue.fire, 1);
  assert.equal(single.events.filter(event => event.type === 'damage' && event.source.id === takiyashahimeIds.single).length, 5);
  assert.equal(single.state.units['red-1'].hp, 688.15, '五段各造成63%攻击伤害并计入1%伤害浮动');
  assert.ok(single.events.some(event => event.type === 'damage' && event.suppressTargetSoulTriggers), '四级起奥义伤害不触发目标御魂');

  const aoeBattle = initializeTakiyashahime(registry, takiyashahimeBattle(5, 4));
  const aoe = executeAction(aoeBattle, { actorId: 'blue-1', skillId: takiyashahimeIds.aoe,
    targetIds: ['red-1', 'red-2'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => 0,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(aoe.state.resources.blue.fire, 1);
  assert.equal(aoe.events.filter(event => event.type === 'damage' && event.source.id === takiyashahimeIds.aoe).length, 6);
  assert.equal(aoe.state.units['red-1'].hp, 829.72, '全体三段为12%、24%、136%并计入1%伤害浮动');
});

test('泷夜叉姬月之奥义按血线忽略防御、低血增伤、逐段驱散或击退行动条', () => {
  const registry = new ContentRegistry(); registerTakiyashahime(registry);
  registry.registerStatus({ id: 'test.moon-buff', category: 'buff', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace' });
  const battle = initializeTakiyashahime(registry, takiyashahimeBattle(3, 4));
  const hero = registry.getHero(takiyashahimeIds.hero), enemy = { ...battle.units['red-1'], hp: 400, stats: { ...battle.units['red-1'].stats, defense: 200 },
    statuses: [{ instanceId: 'target-buff', statusId: 'test.moon-buff', source: { kind: 'skill', id: 'test' }, stacks: 1,
      duration: { kind: 'count', remaining: 1, owner: 'target-turn' } }] };
  const changed = { ...battle, units: { ...battle.units, 'red-1': enemy } };
  const context = createBattleContext(changed, () => 0, id => registry.getStatus(id)?.category,
    id => registry.getStatus(id)?.dispellable === true);
  const skill = hero.skills.find(item => item.id === takiyashahimeIds.single);
  const commands = skill.execute(context, { actorId: 'blue-1', skillId: takiyashahimeIds.single,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, { ratio: .55 });
  assert.equal(commands[0].type, 'deal-damage');
  assert.ok(Math.abs(commands[0].amount - 42.9) < 1e-9, '低于半血目标获得30%增伤；其当前防御高于50%血线门槛时才忽略180防御');
  const highTarget = { ...enemy, hp: 600 };
  const highContext = createBattleContext({ ...changed, units: { ...changed.units, 'red-1': highTarget } }, () => 0);
  const ignored = skill.execute(highContext, { actorId: 'blue-1', skillId: takiyashahimeIds.single,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, { ratio: .55 });
  assert.ok(ignored[0].amount > commands[0].amount, '高于半血目标承受180点固定防御忽略');
  const event = { eventId: 'moon-hit', phase: 'hit-resolution', type: 'damage', source: { kind: 'skill', id: takiyashahimeIds.single,
    unitId: 'blue-1' }, targetId: 'red-1', amount: 10, hpLost: 10, mitigated: 0, isCritical: false };
  const extra = hero.handlers.hit.handle(context, event);
  assert.equal(extra[0].type, 'dispel-statuses');
  assert.equal(extra[0].instanceIds[0], 'target-buff');
  const noBuff = { ...context, getUnit: id => id === 'red-1' ? { ...enemy, statuses: [] } : changed.units[id] };
  assert.equal(hero.handlers.hit.handle(noBuff, event)[0].amount, -.05, '没有可驱散增益时击退5%行动条');
});

function enshrinedFoxBattle(rank = 1, fire = 4) {
  const unit = (unitId, side, heroId, attack = 100, hp = 3000) => ({ unitId, heroId, skillLevel: rank,
    skillLevels: { [enshrinedFoxIds.basic]: rank, [enshrinedFoxIds.passive]: rank, [enshrinedFoxIds.ultimate]: rank }, side,
    stats: { hp, attack, defense: 0, speed: 100, crit: 0, critDamage: 1.5, hit: 0, resist: 0 },
    hp, shield: 0, actionGauge: 0, statuses: [], resources: {} });
  const fox = unit('blue-1', 'blue', enshrinedFoxIds.hero), ally = unit('blue-2', 'blue', 2);
  const enemy = unit('red-1', 'red', 3), enemy2 = unit('red-2', 'red', 4);
  return { units: { 'blue-1': fox, 'blue-2': ally, 'red-1': enemy, 'red-2': enemy2 },
    sides: { blue: ['blue-1', 'blue-2'], red: ['red-1', 'red-2'] },
    resources: { blue: { fire }, red: { fire } }, resourceMeters: {}, counters: { round: 1, action: 0, attack: 0, hit: 0 }, ended: false };
}

function enshrinedFoxDispatcher(registry) {
  const dispatcher = new EventDispatcher(), hero = registry.getHero(enshrinedFoxIds.hero);
  for (const [phase, rule] of Object.entries(hero.handlers)) dispatcher.register({ id: `hero:${hero.id}:${phase}`,
    phase, priority: rule.priority, handle: rule.handle });
  return dispatcher;
}

test('烬天玉藻前焚天九尾先窃取全场攻击再伤害，按12次随机目标序列递减并消耗3火', () => {
  const registry = new ContentRegistry(); registerEnshrinedFox(registry);
  const initial = enshrinedFoxBattle(1, 4), dispatcher = enshrinedFoxDispatcher(registry);
  const cast = executeAction(initial, { actorId: 'blue-1', skillId: enshrinedFoxIds.ultimate,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => 0,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(cast.accepted, true);
  assert.equal(cast.state.resources.blue.fire, 1, '焚天九尾固定消耗3火');
  assert.equal(cast.events.filter(event => event.type === 'damage' && event.source.id === enshrinedFoxIds.ultimate).length, 12);
  const owner = cast.state.units['blue-1'];
  assert.equal(effectiveStats(owner).attack, 109, '放大招前从其他3个在场单位各偷取3点攻击');
  for (const id of ['blue-2', 'red-1', 'red-2']) {
    const taken = cast.state.units[id].statuses.find(status => status.statusId === enshrinedFoxIds.steal);
    assert.equal(taken.values.count, 1);
    assert.equal(effectiveStats(cast.state.units[id]).attack, 97);
  }
  const hits = cast.events.filter(event => event.type === 'damage' && event.source.id === enshrinedFoxIds.ultimate);
  assert.ok(hits[1].amount < hits[0].amount, '重复命中同一目标伤害递减');
});

test('烬天玉藻前的偷攻受每目标10次和初始攻击上限约束，阵亡时归还', () => {
  const registry = new ContentRegistry(); registerEnshrinedFox(registry);
  const hero = registry.getHero(enshrinedFoxIds.hero), initial = enshrinedFoxBattle(1, 4);
  const event = { eventId: 'fox-ultimate-declared', phase: 'action-selection', type: 'action-declared', actionId: 1,
    intent: { actorId: 'blue-1', skillId: enshrinedFoxIds.ultimate, targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' },
    source: { kind: 'skill', id: enshrinedFoxIds.ultimate, unitId: 'blue-1' } };
  let battle = initial;
  for (let count = 0; count < 25; count++) {
    const commands = hero.handlers['action-selection'].handle(createBattleContext(battle, () => .5), event);
    if (!commands) break;
    battle = applyEffectCommands(battle, commands, 'effect-resolution', `fox-steal-${count}`, id => registry.getStatus(id)).state;
  }
  const owner = battle.units['blue-1'];
  const total = owner.statuses.find(status => status.statusId === enshrinedFoxIds.stolen).values.total;
  assert.ok(total <= owner.stats.attack * .6 + 1e-9, '一级偷攻总量最多为初始攻击60%');
  assert.equal(effectiveStats(owner).attack, 160);
  for (const unit of Object.values(battle.units).filter(unit => unit.unitId !== owner.unitId)) {
    const marker = unit.statuses.find(status => status.statusId === enshrinedFoxIds.steal);
    if (marker) assert.ok(marker.values.count <= 10, '每个目标最多被偷10次');
  }
  const defeated = { eventId: 'fox-defeated', phase: 'unit-defeated', type: 'unit-defeated', unitId: 'blue-1',
    source: { kind: 'unit', id: String(enshrinedFoxIds.hero), unitId: 'blue-1' } };
  const commands = hero.handlers['unit-defeated'].handle(createBattleContext(battle, () => .5), defeated);
  const returned = applyEffectCommands(battle, commands, 'unit-defeated', defeated.eventId, id => registry.getStatus(id)).state;
  for (const id of ['blue-2', 'red-1', 'red-2']) assert.equal(effectiveStats(returned.units[id]).attack, 100);
  assert.equal(returned.units['blue-1'].statuses.some(status => status.statusId === enshrinedFoxIds.stolen), false);
});

function paperDancerBattle(rank = 5, fire = 4) {
  const unit = (unitId, side, heroId, skillRank = rank) => ({ unitId, heroId, skillLevel: skillRank,
    skillLevels: { [paperDancerIds.basic]: skillRank, [paperDancerIds.passive]: skillRank, [paperDancerIds.ultimate]: skillRank }, side,
    stats: { hp: 3000, attack: 100, defense: 0, speed: 100, crit: 0, critDamage: 1.5, hit: 0, resist: 0 },
    hp: 3000, shield: 0, actionGauge: 0, statuses: [], resources: {} });
  return { units: { 'blue-1': unit('blue-1', 'blue', paperDancerIds.hero), 'blue-2': unit('blue-2', 'blue', 2),
    'red-1': unit('red-1', 'red', 3), 'red-2': unit('red-2', 'red', 4) },
    sides: { blue: ['blue-1', 'blue-2'], red: ['red-1', 'red-2'] }, resources: { blue: { fire }, red: { fire } },
    resourceMeters: {}, counters: { round: 1, action: 0, attack: 0, hit: 0 }, ended: false };
}

function paperDancerDispatcher(registry) {
  const dispatcher = new EventDispatcher(), hero = registry.getHero(paperDancerIds.hero);
  for (const [phase, rule] of Object.entries(hero.handlers)) dispatcher.register({ id: `hero:${hero.id}:${phase}`,
    phase, priority: rule.priority, handle: rule.handle });
  return dispatcher;
}

test('纸舞纸刃大招耗火施加间接伤害，五级再次命中造成额外伤害并刷新标记', () => {
  const registry = new ContentRegistry(); registerPaperDancer(registry);
  const dispatcher = paperDancerDispatcher(registry), initial = paperDancerBattle(5, 4);
  const first = executeAction(initial, { actorId: 'blue-1', skillId: paperDancerIds.ultimate,
    targetIds: ['red-1', 'red-2'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => 0,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(first.accepted, true);
  assert.equal(first.state.resources.blue.fire, 1, '首次施放消耗3点鬼火');
  assert.equal(first.events.filter(event => event.type === 'life-lost' && event.source.id === paperDancerIds.ultimate).length, 2);
  for (const id of ['red-1', 'red-2']) assert.equal(first.state.units[id].statuses.find(status => status.statusId === paperDancerIds.paper).duration.remaining, 2);
  const second = executeAction({ ...first.state, resources: { ...first.state.resources, blue: { fire: 3 } } }, { actorId: 'blue-1', skillId: paperDancerIds.ultimate,
    targetIds: ['red-1', 'red-2'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => 0,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(second.state.resources.blue.fire, 0);
  assert.equal(second.events.filter(event => event.type === 'life-lost' && event.source.id === paperDancerIds.ultimate).length, 4,
    '再次命中每个已有纸刃目标增加154%间接伤害');
});

test('敌方带纸刃施放技能时先引爆并尝试沉默，纸舞被动获得落纸', () => {
  const registry = new ContentRegistry(); registerPaperDancer(registry);
  const initial = paperDancerBattle(5, 4);
  const dispatcher = paperDancerDispatcher(registry);
  const cast = executeAction(initial, { actorId: 'blue-1', skillId: paperDancerIds.ultimate,
    targetIds: ['red-1', 'red-2'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => 0,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });
  const event = { eventId: 'marked-enemy-skill', phase: 'action-selection', type: 'action-declared', actionId: 2,
    intent: { actorId: 'red-1', skillId: 'test.enemy-skill', targetIds: ['blue-2'], shape: 'single', targetRelation: 'enemy' },
    source: { kind: 'skill', id: 'test.enemy-skill', unitId: 'red-1' } };
  const commands = registry.getHero(paperDancerIds.hero).handlers['action-selection'].handle(
    createBattleContext(cast.state, () => 0, id => registry.getStatus(id)?.category), event);
  assert.equal(commands.filter(command => command.type === 'remove-status-instances' && command.targetId === 'red-1').length, 1);
  const resolved = applyEffectCommands(cast.state, commands, 'effect-resolution', event.eventId, id => registry.getStatus(id));
  assert.equal(resolved.state.units['red-1'].statuses.some(status => status.statusId === paperDancerIds.paper), false);
  assert.equal(resolved.state.units['red-1'].statuses.some(status => status.statusId === paperDancerIds.silence), true);
  assert.equal(resolved.state.units['blue-1'].statuses.find(status => status.statusId === paperDancerIds.fallenPaper).stacks, 1);
});

function ghostKingShutenBattle(rank = 5, fire = 4) {
  const unit = (unitId, side, heroId, skillRank = rank) => ({ unitId, heroId, skillLevel: skillRank,
    skillLevels: { [ghostKingShutenIds.basic]: skillRank, [ghostKingShutenIds.passive]: skillRank,
      [ghostKingShutenIds.ultimate]: skillRank }, side,
    stats: { hp: 1000, attack: 100, defense: 0, speed: 100, crit: 0, critDamage: 1.5, hit: 0, resist: 0 },
    hp: 1000, shield: 0, actionGauge: 0, statuses: [], resources: {} });
  return { units: { 'blue-1': unit('blue-1', 'blue', ghostKingShutenIds.hero), 'blue-2': unit('blue-2', 'blue', 2),
    'red-1': unit('red-1', 'red', 3), 'red-2': unit('red-2', 'red', 4) },
    sides: { blue: ['blue-1', 'blue-2'], red: ['red-1', 'red-2'] }, resources: { blue: { fire }, red: { fire } },
    resourceMeters: {}, counters: { round: 1, action: 0, attack: 0, hit: 0 }, ended: false };
}

function ghostKingShutenDispatcher(registry) {
  const dispatcher = new EventDispatcher(), hero = registry.getHero(ghostKingShutenIds.hero);
  for (const [phase, rule] of Object.entries(hero.handlers)) dispatcher.register({ id: `hero:${hero.id}:${phase}`,
    phase, priority: rule.priority, handle: rule.handle });
  return dispatcher;
}

function initializeGhostKingShuten(registry, battle) {
  const hero = registry.getHero(ghostKingShutenIds.hero), context = createBattleContext(battle, () => .5,
    id => registry.getStatus(id)?.category, id => registry.getStatus(id)?.dispellable === true);
  return applyEffectCommands(battle, hero.initialize(context, 'blue-1'), 'effect-resolution', 'shuten-init',
    id => registry.getStatus(id)).state;
}

test('鬼王酒吞红莲赋予控制免疫和减疗，大妖之力按已损生命动态增伤、减伤并在五级加倍自身效果', () => {
  const registry = new ContentRegistry(); registerGhostKingShuten(registry);
  registry.registerStatus({ id: 'test.shuten-stun', category: 'control', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  const battle = initializeGhostKingShuten(registry, ghostKingShutenBattle(5));
  const owner = { ...battle.units['blue-1'], hp: 500 }, ally = { ...battle.units['blue-2'], hp: 500 };
  const changed = { ...battle, units: { ...battle.units, 'blue-1': owner, 'blue-2': ally } };
  const hero = registry.getHero(ghostKingShutenIds.hero);
  const refreshed = hero.handlers.hit.handle(createBattleContext(changed), { eventId: 'ally-hurt', phase: 'hit-resolution', type: 'damage',
    source: { kind: 'skill', id: 'test' }, targetId: 'blue-2', amount: 500, hpLost: 500, mitigated: 0, isCritical: false });
  let updated = applyEffectCommands(changed, refreshed, 'effect-resolution', 'aura-refresh', id => registry.getStatus(id)).state;
  const ownAura = hero.handlers.hit.handle(createBattleContext(updated), { eventId: 'owner-hurt', phase: 'hit-resolution', type: 'damage',
    source: { kind: 'skill', id: 'test' }, targetId: 'blue-1', amount: 500, hpLost: 500, mitigated: 0, isCritical: false });
  updated = applyEffectCommands(updated, ownAura, 'effect-resolution', 'owner-aura-refresh', id => registry.getStatus(id)).state;
  assert.equal(effectiveDamageMultiplier(updated.units['blue-2']), 1.5);
  assert.equal(effectiveDamageMultiplier(updated.units['blue-1']), 2);
  assert.equal(effectiveDamageTakenMultiplier(updated.units['blue-2']), .5);
  assert.equal(require('../dist-test-renderer/renderer/features/duel/engine/mechanics/stats.js').effectiveHealingTakenMultiplier(updated.units['blue-1']), .7);
  assert.equal(registry.getStatus(ghostKingShutenIds.controlImmunity).controlProtection, 'immune');
  const controlSource = { kind: 'skill', id: 'test.stun', unitId: 'red-1' };
  const immune = applyEffectCommands(updated, [{ type: 'apply-control', source: controlSource, targetId: 'blue-1', instance: {
    instanceId: 'test.shuten-control', statusId: 'test.shuten-stun', source: controlSource, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { controlType: '眩晕' },
  } }], 'effect-resolution', 'red-stun', id => registry.getStatus(id));
  assert.equal(immune.state.units['blue-1'].statuses.some(status => status.statusId === 'test.shuten-stun'), false,
    '红莲控制免疫应在控制效果写入状态前生效');
});

test('鬼王酒吞天火怒焱消耗3火，击退行动条、驱散增益并进入两回合姿态，友方回合开始灼烧并免伤', () => {
  const registry = new ContentRegistry(); registerGhostKingShuten(registry);
  registry.registerStatus({ id: 'test.shuten-buff', category: 'buff', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace' });
  let initial = initializeGhostKingShuten(registry, ghostKingShutenBattle(5, 4));
  initial = { ...initial, units: { ...initial.units, 'red-1': { ...initial.units['red-1'], actionGauge: 70, statuses: [{
    instanceId: 'shuten-test-buff', statusId: 'test.shuten-buff', source: { kind: 'skill', id: 'test' }, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' },
  }] } } };
  const dispatcher = ghostKingShutenDispatcher(registry);
  const cast = executeAction(initial, { actorId: 'blue-1', skillId: ghostKingShutenIds.ultimate,
    targetIds: ['red-1', 'red-2'], shape: 'all-enemies', targetRelation: 'enemy' }, registry, () => 0,
  { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(cast.state.resources.blue.fire, 1);
  assert.equal(cast.state.units['red-1'].actionGauge, 30);
  assert.equal(cast.state.units['red-1'].statuses.some(status => status.statusId === 'test.shuten-buff'), false);
  assert.ok(cast.state.units['blue-2'].statuses.some(status => status.statusId === ghostKingShutenIds.fireField));
  assert.equal(cast.state.units['blue-1'].statuses.find(status => status.statusId === ghostKingShutenIds.stance).duration.remaining, 2);
  const start = { eventId: 'blue-ally-start', phase: 'turn-start', type: 'turn-started', unitId: 'blue-2',
    source: { kind: 'unit', id: '2', unitId: 'blue-2' } };
  const commands = registry.getHero(ghostKingShutenIds.hero).handlers['turn-start'].handle(
    createBattleContext(cast.state), start);
  const burned = applyEffectCommands(cast.state, commands, 'effect-resolution', start.eventId, id => registry.getStatus(id)).state;
  assert.equal(burned.units['blue-2'].hp, 760, '友方回合开始损失当前生命24%');
  assert.equal(effectiveDamageTakenMultiplier(burned.units['blue-2']), 0, '火海保护状态使其免疫伤害');
});

test('鬼王姿态普攻命中主目标并按主目标预估伤害比例溅射，结束时按姿态伤害治疗全队', () => {
  const registry = new ContentRegistry(); registerGhostKingShuten(registry);
  const battle = initializeGhostKingShuten(registry, ghostKingShutenBattle(5));
  const actor = battle.units['blue-1'], stance = { instanceId: 'active-stance', statusId: ghostKingShutenIds.stance,
    source: { kind: 'skill', id: ghostKingShutenIds.ultimate, unitId: actor.unitId }, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { damageTotal: 200 } };
  const changed = { ...battle, units: { ...battle.units, 'blue-1': { ...actor, statuses: [
    ...actor.statuses.filter(status => status.statusId !== ghostKingShutenIds.stance), stance,
  ] } } };
  const skill = registry.getHero(ghostKingShutenIds.hero).skills.find(item => item.id === ghostKingShutenIds.basic);
  const attack = skill.execute(createBattleContext(changed, () => 0), { actorId: 'blue-1', skillId: ghostKingShutenIds.basic,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, { ratio: 1, stanceRatio: 2.45, splashRatio: .4 });
  assert.equal(attack.length, 1, '主目标伤害完成后再按实际命中值触发溅射');
  assert.equal(attack[0].type, 'deal-damage');
  const splash = registry.getHero(ghostKingShutenIds.hero).handlers.hit.handle(createBattleContext(changed),
    { eventId: 'stance-basic-hit', phase: 'hit-resolution', type: 'damage', source: { kind: 'skill', id: ghostKingShutenIds.stanceBasic,
      unitId: 'blue-1' }, targetId: 'red-1', amount: attack[0].amount, hpLost: attack[0].amount, mitigated: 0, isCritical: false });
  assert.equal(splash.find(command => command.type === 'lose-life').amount, attack[0].amount * .4);
  const ended = registry.getHero(ghostKingShutenIds.hero).handlers['turn-end'].handle(createBattleContext(changed),
    { eventId: 'stance-final-turn', phase: 'turn-end', type: 'turn-ended', unitId: 'blue-1', actionId: 8,
      source: { kind: 'unit', id: String(ghostKingShutenIds.hero), unitId: 'blue-1' } });
  assert.equal(ended.length, 2);
  assert.equal(ended[0].amount, 40, '姿态期间造成的200点伤害按20%治疗全体友方');
  const rankTwoBattle = ghostKingShutenBattle(2), rankTwoOwner = rankTwoBattle.units['blue-1'];
  const rankTwoStance = { ...stance, values: { damageTotal: 200, healRatio: 0 } };
  const rankTwoState = { ...rankTwoBattle, units: { ...rankTwoBattle.units,
    'blue-1': { ...rankTwoOwner, statuses: [rankTwoStance] } } };
  assert.equal(registry.getHero(ghostKingShutenIds.hero).handlers['turn-end'].handle(createBattleContext(rankTwoState),
    { eventId: 'stance-rank-two-end', phase: 'turn-end', type: 'turn-ended', unitId: 'blue-1', actionId: 9,
      source: { kind: 'unit', id: String(ghostKingShutenIds.hero), unitId: 'blue-1' } }), undefined,
  '姿态结束群体治疗从三级才解锁');
});

function starBearBattle(rank = 5, fire = 4) {
  const unit = (unitId, side, heroId, skillRank = rank) => ({ unitId, heroId, skillLevel: skillRank,
    skillLevels: { [starBearIds.basic]: skillRank, [starBearIds.passive]: skillRank, [starBearIds.ultimate]: skillRank }, side,
    stats: { hp: 1000, attack: 100, defense: 0, speed: 100, crit: 0, critDamage: 1.5, hit: 0, resist: 0 },
    hp: 1000, shield: 0, actionGauge: 0, statuses: [], resources: {} });
  return { units: { 'blue-1': unit('blue-1', 'blue', starBearIds.hero), 'blue-2': unit('blue-2', 'blue', 2),
    'red-1': unit('red-1', 'red', 3), 'red-2': unit('red-2', 'red', 4) },
    sides: { blue: ['blue-1', 'blue-2'], red: ['red-1', 'red-2'] }, resources: { blue: { fire }, red: { fire } },
    resourceMeters: {}, counters: { round: 1, action: 0, attack: 0, hit: 0 }, ended: false };
}

function starBearDispatcher(registry) {
  const dispatcher = new EventDispatcher(), hero = registry.getHero(starBearIds.hero);
  for (const [phase, rule] of Object.entries(hero.handlers)) dispatcher.register({ id: `hero:${hero.id}:${phase}`,
    phase, priority: rule.priority, handle: rule.handle });
  return dispatcher;
}

function initializeStarBear(registry, battle) {
  const hero = registry.getHero(starBearIds.hero), context = createBattleContext(battle, () => .5,
    id => registry.getStatus(id)?.category, id => registry.getStatus(id)?.dispellable === true);
  return applyEffectCommands(battle, hero.initialize(context, 'blue-1'), 'effect-resolution', 'star-bear-init',
    id => registry.getStatus(id)).state;
}

test('星熊童子只免疫混乱；敌在酒碗处耗3火、施加五层标记并按等级混乱全敌及指定优先目标', () => {
  const registry = new ContentRegistry(); registerStarBear(registry);
  registry.registerStatus({ id: 'test.star-bear-stun', category: 'control', dispellable: true, sealable: true,
    durationOwner: 'target-turn', refreshPolicy: 'replace', preventsAction: true });
  const initial = initializeStarBear(registry, starBearBattle(5, 4)), dispatcher = starBearDispatcher(registry);
  const cast = executeAction(initial, { actorId: 'blue-1', skillId: starBearIds.ultimate, targetIds: ['red-1'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => 0, { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(cast.accepted, true);
  assert.equal(cast.state.resources.blue.fire, 1);
  assert.equal(cast.state.units['red-1'].statuses.find(status => status.statusId === starBearIds.bowlMark).stacks, 5);
  for (const id of ['red-1', 'red-2']) {
    const confusion = cast.state.units[id].statuses.find(status => status.statusId === starBearIds.confusion);
    assert.ok(confusion, '满级全体混乱率为40%，随机值0应成功');
    assert.equal(confusion.values.preferredTargetId, 'red-1');
  }
  const owner = cast.state.units['blue-1'], source = { kind: 'skill', id: 'test.control', unitId: 'red-1' };
  const control = (statusId, controlType) => ({ type: 'apply-control', source, targetId: 'blue-1', instance: { instanceId: `test-${controlType}`,
    statusId, source, stacks: 1, duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { controlType } } });
  const blocked = applyEffectCommands(cast.state, [control(starBearIds.confusion, '混乱')], 'effect-resolution', 'star-bear-confusion', id => registry.getStatus(id));
  assert.equal(blocked.state.units['blue-1'].statuses.some(status => status.statusId === starBearIds.confusion), false);
  const acceptedStun = applyEffectCommands(cast.state, [control('test.star-bear-stun', '眩晕')], 'effect-resolution', 'star-bear-stun', id => registry.getStatus(id));
  assert.ok(acceptedStun.state.units[owner.unitId].statuses.some(status => status.statusId === 'test.star-bear-stun'),
    '技能只声明免疫混乱，不应误扩展为全控制免疫');
});

test('星熊童子酒碗标记增幅普攻并至多耗1层，混乱目标按等级概率插队进行随机普攻', () => {
  const registry = new ContentRegistry(); registerStarBear(registry);
  const initial = initializeStarBear(registry, starBearBattle(5)), actor = initial.units['blue-1'];
  const markSource = { kind: 'skill', id: starBearIds.ultimate, unitId: actor.unitId };
  const mark = { instanceId: `${starBearIds.bowlMark}:blue-1:red-1`, statusId: starBearIds.bowlMark, source: markSource,
    stacks: 2, duration: { kind: 'permanent' }, values: { preferredTargetId: 'red-1', ownerUnitId: 'blue-1' },
    modifiers: [{ stat: 'damageTaken', operation: 'percent', amount: .2, condition: { actionKind: 'basic' } }] };
  const confusion = { instanceId: 'red-confusion', statusId: starBearIds.confusion,
    source: { kind: 'skill', id: starBearIds.ultimate, unitId: 'blue-1' }, stacks: 1,
    duration: { kind: 'count', remaining: 1, owner: 'target-turn' }, values: { controlType: '混乱', preferredTargetId: 'red-1' } };
  const changed = { ...initial, units: { ...initial.units, 'red-1': { ...initial.units['red-1'], statuses: [mark, confusion] } } };
  assert.equal(effectiveDamageTakenMultiplier(changed.units['red-1'], undefined, 'basic'), 1.2);
  assert.equal(effectiveDamageTakenMultiplier(changed.units['red-1'], undefined, 'skill'), 1,
    '酒碗增伤限定普攻');
  const dispatcher = starBearDispatcher(registry);
  const cast = executeAction(changed, { actorId: 'blue-1', skillId: starBearIds.basic, targetIds: ['red-1'],
    shape: 'single', targetRelation: 'enemy' }, registry, () => 0, { dispatcher, resolveStatus: id => registry.getStatus(id) });
  assert.equal(cast.accepted, true);
  assert.ok(cast.events.some(event => event.type === 'action-scheduled' && event.scheduling === 'counter'
    && event.intent.actorId === 'red-1'), '满级普攻在命中混乱目标后触发一次插队混乱普攻');
  const remaining = cast.state.units['red-1'].statuses.find(status => status.statusId === starBearIds.bowlMark);
  assert.equal(remaining.stacks, 1, '每次普攻行动至多消耗一层酒碗标记');
});

test('星熊童子酒碗标记目标被友方普攻且血量比例更低时反击攻击来源', () => {
  const registry = new ContentRegistry(); registerStarBear(registry);
  const initial = starBearBattle(5), hero = registry.getHero(starBearIds.hero);
  initial.units['red-1'].hp = 400;
  initial.units['red-2'].hp = 800;
  const source = { kind: 'skill', id: starBearIds.ultimate, unitId: 'blue-1' };
  initial.units['red-1'].statuses.push({ instanceId: 'red-bowl-mark', statusId: starBearIds.bowlMark, source,
    stacks: 5, duration: { kind: 'permanent' }, values: { ownerUnitId: 'blue-1' } });
  const event = { eventId: 'bowl-counter', phase: 'hit', actionId: 4, attackId: 7, actionKind: 'basic',
    source: { kind: 'skill', id: 'red-basic', unitId: 'red-2' }, type: 'damage', targetId: 'red-1',
    damageKind: 'normal', amount: 100, hpLost: 100, mitigated: 0, isCritical: false };
  const commands = hero.handlers.hit.handle(createBattleContext(initial, () => .5), event);
  assert.ok(commands.some(command => command.type === 'schedule-attack' && command.scheduling === 'counter'
    && command.intent.actorId === 'red-1' && command.intent.targetIds[0] === 'red-2'),
  '低血标记目标应反击同阵营的普攻来源');
  initial.units['red-1'].hp = 900;
  const notTriggered = hero.handlers.hit.handle(createBattleContext(initial, () => .5), event);
  assert.equal(Boolean(notTriggered?.some(command => command.type === 'schedule-attack')), false,
    '标记目标生命比例不低于攻击来源时不反击');
});

test('星熊童子被普攻时按技能等级闪避并混乱攻击者；混乱消失时按驱散与否推进行动条', () => {
  const registry = new ContentRegistry(); registerStarBear(registry);
  const initial = initializeStarBear(registry, starBearBattle(5)), hero = registry.getHero(starBearIds.hero);
  const attacker = initial.units['red-1'];
  const result = hero.interceptIncomingDamage(initial, attacker, initial.units['blue-1'], 500, 'normal', {
    attackId: 12, hitIndex: 1, targetIds: ['blue-1'], attackShape: 'single', actionKind: 'basic',
    battle: createBattleContext(initial, () => 0, id => registry.getStatus(id)?.category), isUnitUnableToAct() { return false; },
  });
  assert.equal(result.amount, 0);
  assert.ok(result.effects.some(effect => effect.type === 'apply-control' && effect.targetId === 'red-1'),
    '成功闪避后对普攻来源尝试一回合混乱');
  const expired = hero.handlers['status-expiration'].handle(createBattleContext(initial), { eventId: 'confusion-expired',
    phase: 'status-expiration', type: 'status-removed', source: { kind: 'skill', id: 'test', unitId: 'red-1' },
    targetId: 'red-1', instanceId: 'confusion-expired', statusId: starBearIds.confusion, statusCategory: 'control',
    removedValues: { controlType: '混乱' }, reason: 'expired' });
  assert.equal(expired[0].amount, 10);
  const dispelled = hero.handlers['effect-resolution'].handle(createBattleContext(initial), { eventId: 'confusion-dispelled',
    phase: 'effect-resolution', type: 'status-removed', source: { kind: 'skill', id: 'test', unitId: 'red-1' },
    targetId: 'red-1', instanceId: 'confusion-dispelled', statusId: starBearIds.confusion, statusCategory: 'control',
    removedValues: { controlType: '混乱' }, reason: 'dispelled' });
  assert.equal(dispelled[0].amount, 20);
});

function tenkenBattle(rank = 5, fire = 4) {
  const unit = (unitId, side, heroId, skillRank = rank) => ({ unitId, heroId, skillLevel: skillRank,
    skillLevels: { [tenkenOniKiriIds.basic]: skillRank, [tenkenOniKiriIds.stance]: skillRank,
      [tenkenOniKiriIds.ultimate]: skillRank }, side,
    stats: { hp: 1000, attack: 200, defense: 100, speed: 100, crit: 0, critDamage: 1.5, hit: 0, resist: 0 },
    hp: 1000, shield: 0, actionGauge: 0, statuses: [], resources: {} });
  return { units: { 'blue-1': unit('blue-1', 'blue', tenkenOniKiriIds.hero), 'blue-2': unit('blue-2', 'blue', 2),
    'red-1': unit('red-1', 'red', 3), 'red-2': unit('red-2', 'red', 4) },
    sides: { blue: ['blue-1', 'blue-2'], red: ['red-1', 'red-2'] }, resources: { blue: { fire }, red: { fire } },
    resourceMeters: {}, counters: { round: 1, action: 0, attack: 0, hit: 0 }, ended: false };
}

function initializeTenken(registry, battle) {
  const hero = registry.getHero(tenkenOniKiriIds.hero), context = createBattleContext(battle, () => .5,
    id => registry.getStatus(id)?.category, id => registry.getStatus(id)?.dispellable === true);
  return applyEffectCommands(battle, hero.initialize(context, 'blue-1'), 'effect-resolution', 'tenken-init',
    id => registry.getStatus(id)).state;
}

test('天剑韧心鬼切被动按等级减伤并格挡普攻，真剑进入心剑推条，断恶斩耗火施加危', () => {
  const registry = new ContentRegistry(); registerTenkenOniKiri(registry);
  const initial = initializeTenken(registry, tenkenBattle(5, 4)), hero = registry.getHero(tenkenOniKiriIds.hero);
  assert.equal(hero.modifyIncomingDamage(initial.units['red-1'], initial.units['blue-1'], 1000, 'normal'), 700);
  const blocked = hero.interceptIncomingDamage(initial, initial.units['red-1'], initial.units['blue-1'], 500, 'normal', {
    attackId: 12, hitIndex: 1, targetIds: ['blue-1'], attackShape: 'single', actionKind: 'basic',
    battle: createBattleContext(initial, () => 0, id => registry.getStatus(id)?.category),
    isUnitUnableToAct() { return false; },
  });
  assert.equal(blocked.amount, 0);
  assert.ok(blocked.effects.some(effect => effect.type === 'change-action-gauge' && effect.amount === 10));
  assert.ok(blocked.effects.some(effect => effect.type === 'apply-control' && effect.targetId === 'red-1'),
    '成功格挡时对普攻来源施加一回合技能封锁');
  const stance = executeAction(initial, { actorId: 'blue-1', skillId: tenkenOniKiriIds.stance,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => 0,
  { resolveStatus: id => registry.getStatus(id) });
  assert.equal(stance.accepted, true);
  assert.equal(stance.state.units['blue-1'].actionGauge, 40);
  assert.ok(stance.state.units['blue-1'].statuses.some(status => status.statusId === tenkenOniKiriIds.heartSword));
  assert.ok(stance.state.units['red-1'].statuses.some(status => status.statusId === tenkenOniKiriIds.shadowLock));
  const cast = executeAction(stance.state, { actorId: 'blue-1', skillId: tenkenOniKiriIds.ultimate,
    targetIds: ['red-1'], shape: 'single', targetRelation: 'enemy' }, registry, () => .5,
  { resolveStatus: id => registry.getStatus(id) });
  assert.equal(cast.accepted, true);
  assert.equal(cast.state.resources.blue.fire, 3, '五级心剑期间3火技能减2火');
  assert.equal(cast.state.units['red-1'].statuses.find(status => status.statusId === tenkenOniKiriIds.shadowCut).stacks, 3);
  assert.equal(effectiveStats(cast.state.units['red-1']).speed, 80, '危状态降低20点速度');
  assert.equal(effectiveStats(cast.state.units['red-1']).defense, 80, '危状态降低20%防御');
  const shielded = { ...cast.state, units: { ...cast.state.units, 'red-1': { ...cast.state.units['red-1'], shield: 50 } } };
  const markedHit = applyEffectCommands(shielded, [{ type: 'deal-damage', source: { kind: 'skill', id: 'test-basic', unitId: 'red-2' },
    targetId: 'red-1', amount: 40, actionKind: 'basic' }], 'effect-resolution', 'tenken-marked-hit',
  id => registry.getStatus(id));
  assert.equal(markedHit.state.units['red-1'].hp, shielded.units['red-1'].hp - 40, '危的三次标记伤害忽略护盾');
  assert.equal(markedHit.state.units['red-1'].shield, 50);
  assert.equal(markedHit.state.units['red-1'].statuses.find(status => status.statusId === tenkenOniKiriIds.shadowCut).stacks, 2);
  const markedDamage = markedHit.events.find(event => event.type === 'damage');
  assert.equal(markedDamage.suppressTargetPassiveTriggers, true);
  assert.equal(markedDamage.suppressTargetSoulTriggers, true);
  const clone = hero.handlers['action-end'].handle(createBattleContext(markedHit.state, () => .5), { eventId: 'tenken-clone-trigger',
    phase: 'action-end', type: 'action-ended', actionKind: 'skill', skillId: 'red-skill', soulTriggersAllowed: true,
    intent: { actorId: 'red-1', skillId: 'red-skill', targetIds: ['blue-1'], shape: 'single', targetRelation: 'enemy' } });
  assert.ok(clone?.some(command => command.type === 'schedule-attack' && command.intent.skillId === tenkenOniKiriIds.cloneAttack),
    '四级起，影切目标施放技能时分身按降低30%的大招倍率反击');
});

test('天剑韧心鬼切四级格挡增伤最多叠加5层', () => {
  const registry = new ContentRegistry(); registerTenkenOniKiri(registry);
  let current = initializeTenken(registry, tenkenBattle(5, 4));
  const hero = registry.getHero(tenkenOniKiriIds.hero);
  for (let attackId = 1; attackId <= 6; attackId += 1) {
    const result = hero.interceptIncomingDamage(current, current.units['red-1'], current.units['blue-1'], 10, 'normal', {
      attackId, hitIndex: 1, targetIds: ['blue-1'], attackShape: 'single', actionKind: 'basic',
      battle: createBattleContext(current, () => 0, id => registry.getStatus(id)?.category),
      isUnitUnableToAct() { return false; },
    });
    current = applyEffectCommands(current, result.effects, 'effect-resolution', `tenken-block-${attackId}`,
      id => registry.getStatus(id)).state;
  }
  const buff = current.units['blue-1'].statuses.find(status => status.statusId === tenkenOniKiriIds.guardDamage);
  assert.equal(buff.stacks, 5);
  assert.equal(effectiveDamageMultiplier(current.units['blue-1']), 2, '五层各增加20%伤害');
});

test('天剑韧心鬼切同一多段普攻只判定一次格挡概率，攻击结束清除判定窗', () => {
  const registry = new ContentRegistry(); registerTenkenOniKiri(registry);
  let current = initializeTenken(registry, tenkenBattle(1, 4));
  const hero = registry.getHero(tenkenOniKiriIds.hero), attacker = current.units['red-1'], target = current.units['blue-1'];
  const input = { attackId: 91, hitIndex: 1, targetIds: [target.unitId], attackShape: 'single', actionKind: 'basic',
    battle: createBattleContext(current, () => .99, id => registry.getStatus(id)?.category),
    isUnitUnableToAct() { return false; } };
  const firstHit = hero.interceptIncomingDamage(current, attacker, target, 200, 'normal', input);
  assert.equal(firstHit.amount, 200, '判定失败不格挡');
  current = applyEffectCommands(current, firstHit.effects, 'effect-resolution', 'tenken-block-fail',
    id => registry.getStatus(id)).state;
  const secondHit = hero.interceptIncomingDamage(current, attacker, current.units['blue-1'], 200, 'normal', {
    ...input, hitIndex: 2, battle: createBattleContext(current, () => 0, id => registry.getStatus(id)?.category),
  });
  assert.equal(secondHit, undefined, '同一攻击后续段不重复抽取格挡');
  const cleared = hero.handlers['attack-end'].handle(createBattleContext(current), { eventId: 'tenken-attack-ended',
    phase: 'attack-end', type: 'attack-ended', attackId: 91, hitCount: 2, actionKind: 'basic' });
  assert.ok(cleared.some(command => command.type === 'remove-status-instances'));
});

test('天剑韧心鬼切五级致命保护每回目一次，复活半血并推30%行动条', () => {
  const registry = new ContentRegistry(); registerTenkenOniKiri(registry);
  const initial = initializeTenken(registry, tenkenBattle(5, 4)), hero = registry.getHero(tenkenOniKiriIds.hero);
  initial.units['blue-1'].hp = 0;
  const event = { eventId: 'tenken-fatal', phase: 'unit-defeat', type: 'unit-defeated', unitId: 'blue-1',
    defeatedBy: { kind: 'skill', id: 'enemy-skill', unitId: 'red-1' } };
  const commands = hero.handlers['unit-defeated'].handle(createBattleContext(initial), event);
  const revived = applyEffectCommands(initial, commands, 'unit-defeat', event.eventId, id => registry.getStatus(id)).state;
  assert.equal(revived.units['blue-1'].hp, 500);
  assert.equal(revived.units['blue-1'].actionGauge, 30);
  assert.equal(hero.handlers['unit-defeated'].handle(createBattleContext(revived), event), undefined,
    '同一回目不能重复触发致命保护');
});
