const { test } = require('node:test');
const assert = require('node:assert/strict');
const { optimizeSouls, evaluatePlan, planScore, sortSoulPlans, formatPlanScore, OPTIMIZATION_OBJECTIVES, objectiveMainAttributes } = require('../dist-test-renderer/shared/soul-optimizer.js');
const { SOUL_SLOT_MAIN_ATTRIBUTES } = require('../dist-test-renderer/shared/soul-slots.js');
const { soulCatalog } = require('../dist-test-renderer/shared/soul-catalog-data.js');
const base = { attack: 1000, hp: 10000, defense: 500, speed: 100, crit: .1, critDamage: 1.5, hit: 0, resist: 0 };
const suits = [
  { id: 1, name: '攻击套', bonus: { name: 'attackAdditionRate', value: .15 }, boss: false, four: '' },
  { id: 2, name: '暴击套', bonus: { name: 'critRateAdditionVal', value: .15 }, boss: false, four: '' },
  { id: 3, name: '首领套', bonus: null, boss: true, four: '' },
];
const attr = (name, value) => ({ name, value, label: name, percent: name !== 'speedAdditionVal', rolls: 1 });
const soul = (position, suitId, extra = {}) => ({ id: `${position}-${suitId}`, position, suitId, stars: 6, level: 15, locked: false, equipped: false, discarded: false, itemId: null, baseAttributeIndex: null, baseValue: null, attributeRolls: [], attributesComplete: true, mainAttribute: attr('attackAdditionRate', .1), subAttributes: [attr('speedAdditionVal', suitId * 2), attr('critRateAdditionVal', .1)], intrinsicAttributes: suitId === 3 ? [attr('critRateAdditionVal', .08)] : [], ...extra });
const defaults = { base, objective: 'damage', requirements: [], mainAttributes: {}, ranges: {}, onlySix: true, onlyMaxLevel: true, unequipped: false, excludeDiscarded: true, excludedIds: [], seconds: 10, limit: 20 };

test('restored special item slots reproduce all four game screenshot scores and panels', async () => {
  const fixture=require('../../tests/fixtures/soul_game_optimizer_plans.json');
  const {readSoulSnapshot}=require('../dist-electron/main/soulService.js');
  const options={...defaults,base:fixture.base,requirements:[{suitId:300030,count:4}],twoPieceAttribute:'critRateAdditionVal',ranges:{crit:{min:1}},
    mainAttributes:{1:['attackAdditionVal'],2:['attackAdditionRate'],3:['defenseAdditionVal'],4:['attackAdditionRate'],5:['maxHpAdditionVal'],6:['critRateAdditionVal','critPowerAdditionVal']}};
  const before=await optimizeSouls(fixture.result.souls,soulCatalog.suits,options);
  assert.equal(before.plans[0].score.toFixed(2),'19835.75','reproduce the previous missing-gear result');
  const restored=readSoulSnapshot(fixture,'regression');
  const result=await optimizeSouls(restored.souls,soulCatalog.suits,options);
  assert.equal(result.status,'complete');assert.equal(result.skipped,0);assert.ok(result.plans.length>=4);
  result.plans.slice(0,4).forEach((plan,index)=>{
    const expected=fixture.expected[index];assert.equal(plan.score.toFixed(2),expected.score);
    for(const key of ['attack','hp','crit','critDamage','hit','speed']){
      const percentage=['crit','critDamage','hit'].includes(key);
      assert.equal((plan.panel[key]*(percentage?100:1)).toFixed(key==='speed'?2:1),expected[key],key+' of game plan '+(index+1));
    }
  });
  assert.equal(result.plans[0].ids[0],'gear-1','the missing slot-one reward soul is included');
});

test('returned plans sort by real score or panel values without mutating results and keep stable ties', () => {
  const a = { ids: ['a'], score: 300, panel: { ...base, speed: 120.125, crit: .9 } };
  const b = { ids: ['b'], score: 200, panel: { ...base, speed: 120.126, crit: 1 } };
  const c = { ids: ['c'], score: 200, panel: { ...base, speed: 119, crit: 1 } };
  const input = [c, a, b];
  assert.deepEqual(sortSoulPlans(input).map(p => p.ids[0]), ['a', 'c', 'b']);
  assert.deepEqual(sortSoulPlans(input, 'speed').map(p => p.ids[0]), ['b', 'a', 'c']);
  assert.deepEqual(sortSoulPlans(input, 'crit').map(p => p.ids[0]), ['c', 'b', 'a']);
  assert.deepEqual(input, [c, a, b]);
});

test('official catalog contains usable six-star level-40 heroes, total crit damage and non-passive bonuses', () => {
  assert.ok(soulCatalog.heroes.length >= 280);
  assert.equal(soulCatalog.heroes.filter(h => !h.base).length, 0);
  const peach = soulCatalog.heroes.find(h => h.name === '桃花妖');
  assert.equal(peach.base.critDamage, 1.5);
  assert.ok(peach.base.attack > 2000);
  assert.equal(soulCatalog.suits.find(s => s.name === '荒骷髅').bonus, null);
  assert.deepEqual(soulCatalog.suits.find(s => s.name === '破势').bonus, { name: 'critRateAdditionVal', value: .15 });
});

test('panel includes intrinsic stats, ordinary two-piece bonuses once, and no boss passive double counting', () => {
  const gear = [soul(1, 1), soul(2, 1), soul(3, 1), soul(4, 1), soul(5, 3), soul(6, 3)];
  const p = evaluatePlan(gear, base, suits);
  assert.ok(Math.abs(p.attack - 1750) < 1e-9);
  assert.ok(Math.abs(p.crit - .86) < 1e-9);
  assert.equal(p.speed, 120);
  assert.equal(planScore({ ...p, crit: 1.8 }, 'damage'), p.attack * 1.5);
});

test('branch and bound matches exhaustive top plans with suite, main choices and min/max ranges', async () => {
  const gear = Array.from({ length: 6 }, (_, i) => [soul(i + 1, 1), soul(i + 1, 2), soul(i + 1, 3)]).flat();
  const options = { ...defaults, requirements: [{ suitId: 1, count: 4 }], twoPieceAttribute: 'critRateAdditionVal', ranges: { speed: { min: 112, max: 118 }, crit: { min: .8 } }, limit: 10 };
  const expected = [];
  function exhaustive(chosen) {
    if (chosen.length < 6) { for (const item of gear.filter(s => s.position === chosen.length + 1)) exhaustive([...chosen, item]); return; }
    if (chosen.filter(s => s.suitId === 1).length < 4 || chosen.filter(s => s.suitId === 2).length < 2) return;
    const p = evaluatePlan(chosen, base, suits);
    if (p.speed < 112 || p.speed > 118 || p.crit + 1e-9 < .8) return;
    expected.push({ ids: chosen.map(s => s.id), score: planScore(p, 'damage') });
  }
  exhaustive([]); expected.sort((a, b) => b.score - a.score || a.ids.join('|').localeCompare(b.ids.join('|')));
  assert.ok(expected.length > 0);
  const result = await optimizeSouls(gear, suits, options);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.plans.map(p => p.ids), expected.slice(0, 10).map(p => p.ids));
  for (const p of result.plans) assert.ok(Math.abs(p.score - expected.find(e => e.ids.join('|') === p.ids.join('|')).score) < 1e-8);
});

test('candidate selection respects exclusions, main choices, stars, level, incomplete and equipped items', async () => {
  const gear = Array.from({ length: 6 }, (_, i) => soul(i + 1, 1));
  const extra = [soul(1, 2, { id: 'missing', attributesComplete: false }), soul(1, 2, { id: 'equipped', equipped: true }), soul(1, 2, { id: 'five', stars: 5 }), soul(1, 2, { id: 'zero', level: 0 }), soul(1, 2, { id: 'discarded', discarded: true }), soul(1, 2, { id: 'excluded' }), soul(1, 2, { id: 'wrong-main', mainAttribute: attr('maxHpAdditionRate', .55) })];
  const result = await optimizeSouls([...gear, ...extra], suits, { ...defaults, unequipped: true, excludedIds: ['excluded'], mainAttributes: { 1: ['attackAdditionRate'] } });
  assert.deepEqual(result.candidates, [1, 1, 1, 1, 1, 1]); assert.equal(result.skipped, 1); assert.equal(result.plans.length, 1);
  const impossible = await optimizeSouls(gear, suits, { ...defaults, excludedIds: [gear[5].id] });
  assert.equal(impossible.status, 'complete'); assert.equal(impossible.plans.length, 0);
});

test('all objective modes rank correctly and a maximum bound does not prune feasible results', async () => {
  const gear = Array.from({ length: 6 }, (_, i) => [soul(i + 1, 1, { subAttributes: [attr('maxHpAdditionVal', 500), attr('debuffEnhance', .2)] }), soul(i + 1, 2, { subAttributes: [attr('debuffResist', .3)] })]).flat();
  for (const objective of ['hp', 'hit', 'resist']) {
    const r = await optimizeSouls(gear, suits, { ...defaults, objective, ranges: { attack: { max: 1800 } } });
    assert.equal(r.status, 'complete'); assert.ok(r.plans.length); assert.ok(r.plans.every(p => p.panel.attack <= 1800 + 1e-9));
    const expected = objective === 'hp' ? 13000 : objective === 'hit' ? 1.2 : 1.8;
    assert.ok(Math.abs(r.plans[0].panel[objective] - expected) < 1e-9);
  }
});

test('new panel objectives find the exhaustive best combinations under suite and range constraints', async () => {
  const gear = Array.from({length:6},(_,i)=>[1,2,3].map(kind=>soul(i+1,kind,{subAttributes:[
    attr('attackAdditionVal', (i+1)*kind*17), attr('defenseAdditionRate', (4-kind)*.025),
    attr('speedAdditionVal', kind*(i+1)*.7), attr('critRateAdditionVal', (4-kind)*(i+1)*.03),
    attr('critPowerAdditionVal', kind*(7-i)*.04),
  ]}))).flat();
  const feasible=[];
  const visit=chosen=>{
    if(chosen.length<6){for(const item of gear.filter(s=>s.position===chosen.length+1))visit([...chosen,item]);return;}
    if(chosen.filter(s=>s.suitId===1).length<2)return;
    const p=evaluatePlan(chosen,base,suits);
    if(p.speed<115 || p.speed>135 || p.crit<1 || p.crit>1.6)return;
    feasible.push({ids:chosen.map(s=>s.id),panel:p});
  };
  visit([]); assert.ok(feasible.length>20);
  for(const objective of ['attack','defense','speed','crit','critDamage']){
    const expected=[...feasible].sort((a,b)=>b.panel[objective]-a.panel[objective] || a.ids.join('|').localeCompare(b.ids.join('|'))).slice(0,7);
    const result=await optimizeSouls(gear,suits,{...defaults,objective,requirements:[{suitId:1,count:2}],ranges:{speed:{min:115,max:135},crit:{min:1,max:1.6}},limit:7});
    assert.equal(result.status,'complete');
    assert.deepEqual(result.plans.map(p=>p.ids),expected.map(p=>p.ids),objective);
    result.plans.forEach((p,i)=>assert.ok(Math.abs(p.score-expected[i].panel[objective])<1e-9));
  }
});

test('all percent objectives retain raw panel scores and display percent units; damage keeps its crit cap', async () => {
  assert.deepEqual(Object.keys(OPTIMIZATION_OBJECTIVES),['damage','attack','speed','hp','defense','crit','critDamage','hit','resist']);
  const p={...base,crit:1.25,critDamage:2.34,hit:.45,resist:.67};
  for(const [objective,expected] of [['crit','125.00%'],['critDamage','234.00%'],['hit','45.00%'],['resist','67.00%']]){
    assert.equal(planScore(p,objective),p[objective]); assert.equal(formatPlanScore(planScore(p,objective),objective),expected);
  }
  assert.equal(planScore(p,'damage'),2340);
  assert.equal(formatPlanScore(p.speed,'speed'),'100.00');
  assert.equal(formatPlanScore(123.45),'123.45','old favorites keep their original score display');
  await assert.rejects(optimizeSouls([],suits,{...defaults,objective:'unknown'}),/效果指标/);
});

test('cancellation and time limits report incomplete search and never masquerade as optimum', async () => {  const gear = Array.from({ length: 6 }, (_, i) => Array.from({ length: 20 }, (_, j) => soul(i + 1, 1, { id: `${i}-${j}` }))).flat();
  let cancel = false;
  const pending = optimizeSouls(gear, suits, { ...defaults, seconds: 5 }, () => {}, () => cancel);
  setTimeout(() => { cancel = true; }, 5);
  const stopped = await pending; assert.equal(stopped.status, 'cancelled'); assert.ok(stopped.visited > 0);
  const limited = await optimizeSouls(gear, suits, { ...defaults, seconds: .05 }); assert.equal(limited.status, 'timeout'); assert.ok(limited.elapsed < .5);
  await assert.rejects(optimizeSouls(gear, suits, { ...defaults, ranges: { crit: { min: 1, max: .5 } } }), /范围/);
});

test('每个效果指标预设对应的主属性，打不出该属性的位置全选', () => {
  assert.deepEqual(objectiveMainAttributes('hp', 2), ['maxHpAdditionRate']);
  assert.deepEqual(objectiveMainAttributes('hp', 4), ['maxHpAdditionRate']);
  assert.deepEqual(objectiveMainAttributes('hp', 6), ['maxHpAdditionRate']);
  assert.deepEqual(objectiveMainAttributes('defense', 2), ['defenseAdditionRate']);
  assert.deepEqual(objectiveMainAttributes('defense', 6), ['defenseAdditionRate']);
  assert.deepEqual(objectiveMainAttributes('speed', 2), ['speedAdditionVal']);
  assert.deepEqual(objectiveMainAttributes('crit', 6), ['critRateAdditionVal']);
  assert.deepEqual(objectiveMainAttributes('critDamage', 6), ['critPowerAdditionVal']);
  assert.deepEqual(objectiveMainAttributes('hit', 4), ['debuffEnhance']);
  assert.deepEqual(objectiveMainAttributes('resist', 4), ['debuffResist']);
  // 2／4 号位打不出暴击，2／6 号位打不出效果命中与效果抵抗，4／6 号位打不出速度：全选该位可用主属性
  for (const [objective, position] of [['crit', 2], ['crit', 4], ['hit', 2], ['hit', 6], ['resist', 2], ['resist', 6], ['speed', 4], ['speed', 6]]) {
    assert.deepEqual(objectiveMainAttributes(objective, position), [...SOUL_SLOT_MAIN_ATTRIBUTES[position]], `${objective} 在 ${position} 号位全选`);
  }
  for (const objective of Object.keys(OPTIMIZATION_OBJECTIVES)) {
    for (const position of [2, 4, 6]) {
      const wanted = objectiveMainAttributes(objective, position);
      assert.ok(wanted.length > 0, `${objective} slot ${position} preselects something`);
      assert.ok(wanted.every(name => SOUL_SLOT_MAIN_ATTRIBUTES[position].includes(name)), `${objective} slot ${position} only preselects legal mains`);
    }
  }
  // 伤害输出按攻击 × 暴击评分，保留攻击加成 + 暴击／暴击伤害的经典组合
  assert.deepEqual(objectiveMainAttributes('damage', 2), ['attackAdditionRate']);
  assert.deepEqual(objectiveMainAttributes('damage', 6), ['critRateAdditionVal', 'critPowerAdditionVal']);
});
