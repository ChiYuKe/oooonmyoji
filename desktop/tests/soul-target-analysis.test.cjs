const {test}=require('node:test'),assert=require('node:assert/strict');
const {analyzeSoulTarget}=require('../dist-test-renderer/shared/soul-target-analysis');
const {evaluatePlan,planScore}=require('../dist-test-renderer/shared/soul-optimizer');
const base={attack:1000,hp:10000,defense:500,speed:100,crit:.1,critDamage:1.5,hit:0,resist:0};
const catalog=[{id:1,name:'四件套',bonus:{name:'attackAdditionRate',value:.15},four:'四件套效果',boss:false},{id:9,name:'首领套',bonus:null,four:'首领效果',boss:true}];
const attr=(name,value,rolls=1)=>({name,value,rolls,label:name,percent:!['attackAdditionVal','maxHpAdditionVal','defenseAdditionVal','speedAdditionVal'].includes(name)});
const mains=[['attackAdditionVal',486],['attackAdditionRate',.55],['defenseAdditionVal',104],['attackAdditionRate',.55],['maxHpAdditionVal',2052],['critRateAdditionVal',.55]];
const gear=()=>mains.map(([name,value],i)=>({id:String(i+1),position:i+1,suitId:i<4?1:9,stars:6,level:15,attributesComplete:true,mainAttribute:attr(name,value),
 subAttributes:[attr('critPowerAdditionVal',.07,2),attr('speedAdditionVal',3),attr('debuffResist',.1,3),attr(i===5?'attackAdditionRate':'critRateAdditionVal',.08,3)],intrinsicAttributes:i===4?[attr('attackAdditionRate',.08)]:[]}));
const options=(extra={})=>({base,objective:'damage',ranges:{crit:{min:1}},requirements:[{suitId:1,count:4},{suitId:9,count:2}],mainAttributes:{},excludedIds:[],limit:8,...extra});
const plan=(souls,config=options())=>{const panel=evaluatePlan(souls,config.base,catalog);return {ids:souls.map(s=>s.id),panel,score:planScore(panel,config.objective),suits:[{id:1,count:4},{id:9,count:2}]};};

test('max-level analysis returns only the six actual items and their real score and gap',()=>{
 const souls=gear(),config=options(),original=plan(souls),before=JSON.stringify(souls);
 for(const target of [original.score-1,original.score,original.score+500,999999]){
  const report=analyzeSoulTarget(original,souls,catalog,config,target);
  assert.equal(report.currentScore,original.score);assert.deepEqual(report.currentPanel,original.panel);
  assert.equal(report.gap,Math.max(0,target-original.score));assert.equal(report.achieved,target<=original.score);
  assert.deepEqual(report.souls,souls);assert.equal('routes' in report,false);assert.equal('bestProjectionScore' in report,false);
  report.souls.forEach((s,i)=>assert.deepEqual(s.subAttributes,souls[i].subAttributes));
 }
 assert.equal(JSON.stringify(souls),before);
 assert.deepEqual(analyzeSoulTarget(original,souls,catalog,config,999999).preservedSets,[{suitId:1,count:4,boss:false},{suitId:9,count:2,boss:true}]);
});

test('actual hp and speed stay present; no crit line or upgrade allocation is invented',()=>{
 const souls=gear(),config=options({base:{...base,crit:.2}});
 souls[1].subAttributes=[attr('critPowerAdditionVal',.1464,4),attr('attackAdditionVal',24.27),attr('maxHpAdditionVal',108.20),attr('speedAdditionVal',2.77)];
 const original=plan(souls,config),report=analyzeSoulTarget(original,souls,catalog,config,30000);
 assert.deepEqual(report.souls[1].subAttributes,souls[1].subAttributes);
 assert.deepEqual(report.souls[1].subAttributes.map(a=>a.name),['critPowerAdditionVal','attackAdditionVal','maxHpAdditionVal','speedAdditionVal']);
 assert.equal(report.currentScore,original.score);
});

test('other inventory items and stale saved panels cannot change current analysis',()=>{
 const souls=gear(),config=options(),original=plan(souls),target=original.score+500;
 const donor={...souls[0],id:'unrelated',subAttributes:[attr('critPowerAdditionVal',5)]};
 const report=analyzeSoulTarget({...original,score:999999,panel:{...original.panel,crit:9}},[...souls,donor],catalog,config,target);
 assert.deepEqual(report,analyzeSoulTarget(original,souls,catalog,config,target));
});

test('each selected metric is evaluated from fixed actual gear including raw percent scores',()=>{
 const souls=gear(),before=JSON.stringify(souls);
 for(const objective of ['damage','attack','hp','defense','speed','crit','critDamage','hit','resist']){
  const config=options({objective,ranges:{}}),original=plan(souls,config);
  const report=analyzeSoulTarget(original,souls,catalog,config,original.score+1);
  assert.equal(report.currentScore,planScore(original.panel,objective));assert.ok(Math.abs(report.gap-1)<1e-9);assert.equal(report.achieved,false);
  assert.deepEqual(report.souls,souls);
 }
 assert.equal(JSON.stringify(souls),before);
});

test('target endpoints classify below, inside and above without changing the source',()=>{
 const souls=gear(),config=options(),original=plan(souls);
 for(const [range,achieved,gap]of [[{min:original.score-10,max:original.score+10},true,0],[{max:original.score-10},false,10],[{min:original.score+10,max:original.score+11},false,10],[{max:original.score},true,0],[{min:0},true,0]]){
  const report=analyzeSoulTarget(original,souls,catalog,config,range);assert.equal(report.achieved,achieved);assert.equal(report.gap,gap);assert.deepEqual(report.souls,souls);
 }
 for(const range of [{},{min:-1},{max:-1},{min:10,max:5},{max:Infinity},{min:NaN},0,-1,NaN,Infinity])assert.throws(()=>analyzeSoulTarget(original,souls,catalog,config,range),/目标评分/);
});

test('missing or stale source data is rejected; lower level actual gear can still be inspected',()=>{
 const souls=gear(),config=options(),original=plan(souls);
 assert.throws(()=>analyzeSoulTarget(original,souls.slice(1),catalog,config,10000),/完整的六件/);
 assert.throws(()=>analyzeSoulTarget({...original,ids:['1','1','3','4','5','6']},souls,catalog,config,10000),/完整的六件/);
 assert.throws(()=>analyzeSoulTarget(original,[{...souls[0],attributesComplete:false},...souls.slice(1)],catalog,config,10000),/完整的六件/);
 assert.throws(()=>analyzeSoulTarget(original,souls,catalog,options({ranges:{speed:{min:999}}}),10000),/不满足/);
 const actual=[{...souls[0],stars:5,level:12},...souls.slice(1)];
 assert.deepEqual(analyzeSoulTarget(plan(actual),actual,catalog,config,10000).souls,actual);
});

test('a single boss item is not presented as an activated two-piece boss set',()=>{
 const souls=gear();souls[5].suitId=2;
 assert.deepEqual(analyzeSoulTarget(plan(souls),souls,catalog,options(),10000).preservedSets,[{suitId:1,count:4,boss:false}]);
});
