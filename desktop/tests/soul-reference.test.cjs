const { test } = require('node:test'), assert = require('node:assert/strict');
const { analyzeSoulTarget, SIX_STAR_SUBSTAT_ROLLS } = require('../dist-test-renderer/shared/soul-target-analysis');
const { generateSoulReferences } = require('../dist-test-renderer/shared/soul-reference');
const { evaluatePlan, planScore } = require('../dist-test-renderer/shared/soul-optimizer');
const { SOUL_SLOT_MAIN_ATTRIBUTES } = require('../dist-test-renderer/shared/soul-slots');
const base = { attack: 3000, hp: 10000, defense: 500, speed: 100, crit: .1, critDamage: 1.5, hit: 0, resist: 0 };
const catalog = [{ id: 1, name: '四件套', bonus: { name: 'attackAdditionRate', value: .15 }, boss: false }, { id: 9, name: '首领套', bonus: null, boss: true }];
const attr = (name, value, rolls = 1) => ({ name, value, rolls, label: name, percent: !name.endsWith('Val') });
const mains = [['attackAdditionVal', 486], ['attackAdditionRate', .55], ['defenseAdditionVal', 104], ['attackAdditionRate', .55], ['maxHpAdditionVal', 2052], ['critRateAdditionVal', .55]];
const gear = () => mains.map(([name, value], i) => ({ id: `actual-${i}`, position: i + 1, suitId: i < 4 ? 1 : 9, stars: 6, level: 15, attributesComplete: true,
  mainAttribute: attr(name, value), subAttributes: [attr('speedAdditionVal', 3), attr('debuffResist', .1, 3), attr('critPowerAdditionVal', .07, 2), attr(i === 5 ? 'attackAdditionRate' : 'critRateAdditionVal', .08, 3)],
  intrinsicAttributes: i >= 4 ? [attr('critRateAdditionVal', .08)] : [] }));
function setup(objective = 'damage', ranges = {}, target) {
  const souls = gear(), options = { base, objective, ranges, requirements: [{ suitId: 1, count: 4 }, { suitId: 9, count: 2 }], mainAttributes: Object.fromEntries(souls.map(s=>[s.position,[s.mainAttribute.name]])), excludedIds: [] };
  const panel = evaluatePlan(souls, base, catalog), score = planScore(panel, objective), plan = { ids: souls.map(s => s.id), panel, score, suits: [] };
  const analysis = analyzeSoulTarget(plan, souls, catalog, options, target ?? Math.max(.1, score * 1.05));
  return { souls, options, analysis };
}
function check(reference, source, options, target) {
  assert.equal(reference.souls.length, 6);
  const counts = souls => [...souls.reduce((result, soul) => result.set(soul.suitId, (result.get(soul.suitId) ?? 0) + 1), new Map())].sort((a, b) => a[0] - b[0]);
  assert.deepEqual(counts(reference.souls), counts(source), 'set combination and counts remain fixed, independently of positions');
  reference.souls.forEach((s, i) => {
    assert.match(s.id, /^reference-slot-/); assert.notEqual(s.id, source[i].id); assert.equal(s.itemId, null);
    assert.equal(s.position, i + 1); assert.equal(s.stars, 6); assert.equal(s.level, 15);
    assert.ok(SOUL_SLOT_MAIN_ATTRIBUTES[s.position].includes(s.mainAttribute.name));
    const allowed=options.mainAttributes[s.position];
    if(allowed?.length)assert.ok(allowed.includes(s.mainAttribute.name),'generated main attributes obey the user selection');
    assert.equal(s.mainAttribute.value,{attackAdditionVal:486,defenseAdditionVal:104,maxHpAdditionVal:2052,speedAdditionVal:57,attackAdditionRate:.55,defenseAdditionRate:.55,maxHpAdditionRate:.55,critRateAdditionVal:.55,critPowerAdditionVal:.89,debuffEnhance:.55,debuffResist:.55}[s.mainAttribute.name]);
    if (s.suitId === 9) {
      assert.equal(s.intrinsicAttributes.length, 1);
      const intrinsic = s.intrinsicAttributes[0];
      assert.equal(intrinsic.value, {attackAdditionRate:.08,maxHpAdditionRate:.08,defenseAdditionRate:.16,critRateAdditionVal:.08,debuffEnhance:.08,debuffResist:.08}[intrinsic.name]);
      assert.equal(intrinsic.rolls,1);
    } else assert.deepEqual(s.intrinsicAttributes,[],'ordinary suits cannot acquire boss intrinsic stats');
    assert.equal(s.subAttributes.length, 4); assert.equal(new Set(s.subAttributes.map(a => a.name)).size, 4);
    assert.equal(s.subAttributes.reduce((sum, a) => sum + a.rolls, 0), 9);
    s.subAttributes.forEach(a => {
      assert.notEqual(a.name, s.mainAttribute.name); assert.ok(a.rolls >= 1 && a.rolls <= 6 && Number.isInteger(a.rolls));
      const max = SIX_STAR_SUBSTAT_ROLLS[a.name] * a.rolls;
      assert.ok(a.value >= max * .8 - 1e-8 && a.value <= max * .98 + 1e-8);
      assert.ok(a.value < max - 1e-8,'reference substats never assume every allocation has perfect yield');
    });
  });
  assert.deepEqual(reference.panel, evaluatePlan(reference.souls, options.base, catalog));
  assert.equal(reference.score, planScore(reference.panel, options.objective));
  for (const [name, range] of Object.entries(options.ranges)) {
    if (range.min != null) assert.ok(reference.panel[name] >= range.min - 1e-8);
    if (range.max != null) assert.ok(reference.panel[name] <= range.max + 1e-8);
  }
  if (reference.meetsTarget) {
    assert.ok(reference.score >= target.min - 1e-8);
    if (target.max != null) assert.ok(reference.score <= target.max + 1e-8);
  }
}
test('generates multiple independent complete configurations without changing max-level inventory', () => {
  const { souls, options, analysis } = setup('damage', { crit: { min: 1 }, speed: { min: 115, max: 135 } });
  const before = JSON.stringify(souls), result = generateSoulReferences(analysis, options, catalog);
  assert.equal(result.configs.length, 3); assert.ok(result.configs.every(r => r.meetsTarget));
  result.configs.forEach(r => check(r, souls, options, { min: analysis.target }));
  assert.equal(new Set(result.configs.map(r => JSON.stringify(r.souls))).size, 3);
  const originalLayout = souls.map(s => s.suitId).join(',');
  assert.ok(result.configs.every(r => r.souls.map(s => s.suitId).join(',') !== originalLayout), 'references can move the four-set and boss pieces to other positions');
  assert.equal(new Set(result.configs.map(r => r.souls.map(s => s.suitId).join(','))).size, 3, 'different references show different valid set arrangements');
  for (const reference of result.configs) for (const soul of reference.souls) for (const attr of soul.subAttributes) {
    if (!['attackAdditionRate','attackAdditionVal','critRateAdditionVal','critPowerAdditionVal','speedAdditionVal'].includes(attr.name)) assert.equal(attr.rolls,1,'unrelated output stats do not get repeated allocations');
  }
  assert.equal(JSON.stringify(souls), before);
  assert.deepEqual(result, generateSoulReferences(analysis, options, catalog), 'generation is deterministic');
});
test('uses each selected objective, including raw percentage goals', () => {
  for (const objective of ['damage', 'attack', 'hp', 'defense', 'speed', 'crit', 'critDamage', 'hit', 'resist']) {
    const { souls, options, analysis } = setup(objective), result = generateSoulReferences(analysis, options, catalog);
    assert.ok(result.configs.some(r => r.meetsTarget), objective);
    result.configs.forEach(r => check(r, souls, options, { min: analysis.target }));
  }
});

test('flexible positions use the assigned suit name and icon, with boss intrinsics only on boss pieces', () => {
  const { souls, options, analysis } = setup('damage', { crit: { min: 1 } }, 19000);
  const source = analysis.souls.map(soul => ({ ...soul, name: `source-${soul.suitId}`, iconKey: `suit-${soul.suitId}`, iconUrl: `fixture://suit-${soul.suitId}` }));
  const before = JSON.stringify(source), result = generateSoulReferences({ ...analysis, souls: source }, options, catalog);
  assert.equal(result.configs.length, 3);
  for (const reference of result.configs) {
    check(reference, souls, options, { min: 19000 });
    assert.ok(reference.souls.some((soul, index) => soul.suitId !== source[index].suitId));
    for (const soul of reference.souls) {
      assert.equal(soul.name, catalog.find(suit => suit.id === soul.suitId).name);
      assert.equal(soul.iconKey, `suit-${soul.suitId}`); assert.equal(soul.iconUrl, `fixture://suit-${soul.suitId}`);
    }
  }
  assert.equal(JSON.stringify(source), before);
});

test('a six-piece single-suit template remains valid when there are no different suit positions to arrange', () => {
  const { souls, options } = setup('damage');
  const source = souls.map(soul => ({ ...soul, suitId: 1, intrinsicAttributes: [] }));
  const selected = { ...options, requirements: [{ suitId: 1, count: 4 }, { suitId: 1, count: 2 }] };
  const panel = evaluatePlan(source, base, catalog), plan = { ids: source.map(soul => soul.id), panel, score: planScore(panel, 'damage'), suits: [] };
  const analysis = analyzeSoulTarget(plan, source, catalog, selected, { max: 1e9 });
  const result = generateSoulReferences(analysis, selected, catalog);
  assert.equal(result.configs.length, 3);
  result.configs.forEach(reference => check(reference, source, selected, { min: 0, max: 1e9 }));
  assert.ok(result.configs.every(reference => reference.souls.every(soul => soul.suitId === 1 && soul.intrinsicAttributes.length === 0)));
});
test('target upper bounds are respected; impossible targets are never marked achieved', () => {
  const { souls, options, analysis } = setup('damage', { crit: { min: 1 } }, { min: 20000, max: 20500 });
  const result = generateSoulReferences(analysis, options, catalog);
  assert.ok(result.configs.some(r => r.meetsTarget)); result.configs.forEach(r => check(r, souls, options, { min: 20000, max: 20500 }));
  const impossible = generateSoulReferences({ ...analysis, target: 1e9, targetMax: undefined }, options, catalog);
  assert.equal(impossible.configs.length,0,'a missed target is never returned as a fallback reference'); assert.match(impossible.reason, /未找到.*全部限制.*不代表理论上限/);
  const upper = generateSoulReferences({ ...analysis, target: 0, targetMax: 20500 }, options, catalog);
  assert.ok(upper.configs.some(r => r.meetsTarget)); upper.configs.forEach(r => check(r, souls, options, { min: 0, max: 20500 }));
});
test('keeps strict suit mechanics and reports unsatisfied constraints or unsupported levels', () => {
  const { souls, options, analysis } = setup('damage', { crit: { min: 1 } });
  const strict = { ...analysis, ranges: { crit: { min: 1.200001 } } };
  generateSoulReferences(strict, options, catalog).configs.forEach(r => assert.ok(r.panel.crit > 1.2));
  assert.equal(generateSoulReferences({ ...analysis, ranges: { speed: { min: 1000 } } }, options, catalog).configs.length, 0);
  souls[0].level = 12;
  const unsupported = generateSoulReferences(analysis, options, catalog);
  assert.equal(unsupported.configs.length, 0); assert.match(unsupported.reason, /六星 \+15/);
});
test('boss intrinsic stats are selected for the metric rather than copied from the source', () => {
  const { souls, options, analysis } = setup('hit', {}, 1.45);
  const before = JSON.stringify(souls), result = generateSoulReferences(analysis, options, catalog);
  assert.ok(result.configs.length);
  for (const reference of result.configs) {
    check(reference, souls, options, {min:1.45});
    for (const boss of reference.souls.filter(s=>s.suitId===9)) assert.deepEqual(boss.intrinsicAttributes.map(a=>[a.name,a.value]),[['debuffEnhance',.08]]);
    const subHit=reference.souls.reduce((sum,s)=>sum+s.subAttributes.filter(a=>a.name==='debuffEnhance').reduce((sum,a)=>sum+a.value,0),0);
    assert.ok(Math.abs(reference.panel.hit-subHit-.16)<1e-8,'new intrinsic contribution is counted in the real panel and score');
    assert.equal(reference.meetsTarget,true);
  }
  assert.ok(result.configs.every(reference=>reference.score>=1.45),'the generated reference reaches the required hit with sampled allocations');
  assert.equal(JSON.stringify(souls),before);
});
test('all six client intrinsic choices can serve their corresponding metrics; no speed or crit damage is invented', () => {
  for (const [objective,name,value]of [['attack','attackAdditionRate',.08],['hp','maxHpAdditionRate',.08],['defense','defenseAdditionRate',.16],['crit','critRateAdditionVal',.08],['hit','debuffEnhance',.08],['resist','debuffResist',.08]]) {
    const { souls, options, analysis } = setup(objective, {}, {max:1e9}), result = generateSoulReferences(analysis, options, catalog);
    assert.ok(result.configs.length,objective);
    result.configs.forEach(reference=>{
      check(reference,souls,options,{min:0,max:1e9});
      for(const boss of reference.souls.filter(s=>s.suitId===9)) assert.deepEqual(boss.intrinsicAttributes.map(a=>[a.name,a.value]),[[name,value]]);
    });
  }
});
test('full crit is a hard user limit even when it is missing from the analysis report',()=>{
  const {souls,options,analysis}=setup('damage',{crit:{min:1}},19000);
  const before=JSON.stringify({souls,options,analysis});
  const result=generateSoulReferences({...analysis,ranges:{}},options,catalog);
  assert.ok(result.configs.length,'feasible full-crit references are produced');
  for(const reference of result.configs){
    assert.ok(reference.panel.crit>=1-1e-9,'every reference remains at least 100 percent crit after intrinsic selection');
    check(reference,souls,options,{min:19000});
  }
  assert.equal(JSON.stringify({souls,options,analysis}),before);
});
test('intersects both sources of limits and checks crit, speed and damage bounds together',()=>{
  const {souls,options,analysis}=setup('damage',{}, {min:19500,max:20500});
  const stricter={...options,ranges:{crit:{min:1,max:1.1},speed:{min:120,max:130}}};
  const result=generateSoulReferences({...analysis,ranges:{crit:{min:.95,max:1.05},speed:{min:115,max:140}}},stricter,catalog);
  assert.ok(result.configs.length);
  result.configs.forEach(reference=>{
    check(reference,souls,stricter,{min:19500,max:20500});
    assert.ok(reference.panel.crit<=1.05+1e-9,'stricter cached upper bound is also retained');
  });
  for(const ranges of [{crit:{min:2,max:1}},{crit:{min:NaN}},{speed:{max:Infinity}},{hit:{min:-1}}]){
    const invalid=generateSoulReferences(analysis,{...options,ranges},catalog);assert.equal(invalid.configs.length,0);assert.ok(invalid.reason);
  }
  const conflict=generateSoulReferences({...analysis,ranges:{crit:{max:.9}}},{...options,ranges:{crit:{min:1}}},catalog);
  assert.equal(conflict.configs.length,0);assert.match(conflict.reason,/冲突/);
});
test('does not recommend templates conflicting with suit or two-piece restrictions',()=>{
  const {options,analysis}=setup('damage',{},19000);
  for(const overrides of [{requirements:[{suitId:1,count:4},{suitId:1,count:4}]},{twoPieceAttribute:'maxHpAdditionRate'}]){
    const result=generateSoulReferences(analysis,{...options,...overrides},catalog);assert.equal(result.configs.length,0);assert.match(result.reason,/套装/);
  }
});
test('selects a different main attribute when the user requires it and counts its full panel contribution',()=>{
  const {souls,options,analysis}=setup('speed',{}, {min:170,max:180});
  const selected={...options,ranges:{crit:{min:1},speed:{min:170,max:180}},mainAttributes:{...options.mainAttributes,2:['speedAdditionVal']}};
  const before=JSON.stringify(souls),result=generateSoulReferences(analysis,selected,catalog);
  assert.ok(result.configs.length,'a source attack main does not prevent the user speed main from being generated');
  for(const reference of result.configs){
    check(reference,souls,selected,{min:170,max:180});
    assert.equal(reference.souls[1].mainAttribute.name,'speedAdditionVal');
    assert.equal(reference.souls[1].mainAttribute.value,57);
  }
  assert.equal(JSON.stringify(souls),before);
  const invalid=generateSoulReferences(analysis,{...selected,mainAttributes:{2:['critPowerAdditionVal']}},catalog);
  assert.equal(invalid.configs.length,0);assert.match(invalid.reason,/主属性/);
});
test('considers every checked main attribute while keeping full crit and target bounds',()=>{
  const {souls,options,analysis}=setup('damage',{crit:{min:1}},{min:20000,max:20500});
  const selected={...options,mainAttributes:{...options.mainAttributes,6:['critRateAdditionVal','critPowerAdditionVal']}};
  const result=generateSoulReferences(analysis,selected,catalog);
  assert.ok(result.configs.length,'the checked crit damage main participates alongside crit');
  result.configs.forEach(reference=>check(reference,souls,selected,{min:20000,max:20500}));
  const critDamageOnly={...selected,mainAttributes:{...selected.mainAttributes,6:['critPowerAdditionVal']}};
  const changed=generateSoulReferences(analysis,critDamageOnly,catalog);
  assert.ok(changed.configs.length,'the other checked choice is also available without relaxing full crit');
  changed.configs.forEach(reference=>{
    check(reference,souls,critDamageOnly,{min:20000,max:20500});
    assert.equal(reference.souls[5].mainAttribute.name,'critPowerAdditionVal');
  });
});
test('an empty main selection means unrestricted legal main attributes, matching the form',()=>{
  const {souls,options,analysis}=setup('hit',{}, {min:1.8,max:1.91});
  const selected={...options,ranges:{hit:{min:1.8}},mainAttributes:{...options.mainAttributes,4:[]}};
  const result=generateSoulReferences(analysis,selected,catalog);
  assert.ok(result.configs.length,'hit main is available when slot four is unrestricted');
  result.configs.forEach(reference=>{
    check(reference,souls,selected,{min:1.8,max:1.91});
    assert.equal(reference.souls[3].mainAttribute.name,'debuffEnhance');
  });
});
test('strict suit trigger is enforced again even if both input range maps omitted it',()=>{
  const {options,analysis}=setup('damage',{},16000);
  const souls=analysis.souls.map(s=>({...s,suitId:s.suitId===1?300087:s.suitId}));
  const triggerCatalog=[{...catalog[0],id:300087},catalog[1]];
  const triggerOptions={...options,requirements:[{suitId:300087,count:4},{suitId:9,count:2}]};
  const result=generateSoulReferences({...analysis,souls,ranges:{}},triggerOptions,triggerCatalog);
  assert.ok(result.configs.length);result.configs.forEach(reference=>assert.ok(reference.panel.crit>1.2));
});
test('each allocation has an independent floating yield; six crit rolls never become a perfect 18 percent',()=>{
  const {souls,options,analysis}=setup('crit',{}, {max:1e9});
  const before=JSON.stringify(souls),result=generateSoulReferences(analysis,options,catalog);
  assert.equal(result.configs.length,3);
  let sixCrit=0;
  result.configs.forEach(reference=>{
    check(reference,souls,options,{min:0,max:1e9});
    for(const soul of reference.souls){
      const yields=soul.subAttributes.map(attr=>attr.value/(SIX_STAR_SUBSTAT_ROLLS[attr.name]*attr.rolls));
      assert.ok(new Set(yields.map(yield=>yield.toFixed(6))).size>1,'a whole item no longer shares one yield multiplier');
      for(const attr of soul.subAttributes)if(attr.name==='critRateAdditionVal'&&attr.rolls===6){
        sixCrit++;assert.notEqual((attr.value*100).toFixed(2),'18.00');
      }
    }
  });
  assert.ok(sixCrit>0,'six-crit-roll recommendations are tested rather than banned');
  assert.equal(JSON.stringify(souls),before,'real fixed inventory numbers stay unchanged');
});
test('a target requiring perfect theoretical rolls produces no relaxed or perfect fallback',()=>{
  const {options,analysis}=setup('hit',{},1.6);
  // Six items can each have at most six hit allocations: 6 * 6 * 4% + 2 * 8% = 160%.
  // Reaching this requires every hit allocation to have exactly its theoretical maximum.
  const result=generateSoulReferences(analysis,options,catalog);
  assert.equal(result.configs.length,0);assert.match(result.reason,/未找到.*全部限制/);
});
