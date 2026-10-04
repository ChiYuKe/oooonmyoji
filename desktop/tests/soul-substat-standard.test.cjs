const {test}=require('node:test'),assert=require('node:assert/strict');
const {assessSoulSubstat:assess,SUIT_DEFAULT_USAGES,substatUsageNote,suitMechanicRanges}=require('../dist-test-renderer/shared/soul-substat-standard');
const {soulCatalog}=require('../dist-test-renderer/shared/soul-catalog-data');
const {optimizeSouls}=require('../dist-test-renderer/shared/soul-optimizer');
const attr=(name,value=.03)=>({name,value,label:name,rolls:1,percent:true});
const soul=(name='针女',position=1,subAttributes=[])=>({id:String(position),name,position,suitId:soulCatalog.suits.find(s=>s.name===name).id,subAttributes});
const status=(name,context={},s=soul())=>assess(s,attr(name),context).status;
test('all 70 catalog suits have a default usage, independent of the two-piece bonus',()=>{
 assert.equal(Object.keys(SUIT_DEFAULT_USAGES).length,70);for(const s of soulCatalog.suits)assert.ok(SUIT_DEFAULT_USAGES[s.id],s.name);
 assert.equal(status('debuffEnhance',{},soul('蚌精')),'invalid');assert.equal(status('critRateAdditionVal',{},soul('蚌精')),'core');
 assert.equal(status('debuffEnhance',{},soul('火灵')),'pending');assert.equal(status('defenseAdditionRate',{},soul('钓瓶火')),'core');
 assert.equal(status('debuffEnhance',{},soul('日女巳时')),'invalid');assert.equal(status('debuffEnhance',{},soul('雪幽魂')),'core');
 assert.equal(status('debuffResist',{},soul('骰子鬼')),'core');assert.equal(status('critRateAdditionVal',{},soul('叠叩')),'conditional');
});
test('explicit user metrics override the suit template; output never gains pollution points',()=>{
 const c={objective:'damage'};assert.equal(status('attackAdditionRate',c),'core');assert.equal(status('critPowerAdditionVal',c),'core');assert.equal(status('attackAdditionVal',c),'low');
 for(const key of ['debuffEnhance','debuffResist','maxHpAdditionRate','defenseAdditionRate','speedAdditionVal'])assert.equal(status(key,c),'invalid');
 assert.equal(status('debuffEnhance',{objective:'hit'},soul('针女')),'core');assert.equal(status('speedAdditionVal',{objective:'speed'}),'core');
 assert.equal(status('critRateAdditionVal',{objective:'critDamage'}),'invalid');assert.equal(status('defenseAdditionVal',{objective:'defense'}),'low');
});
test('ranges are separate conditions and hit/resist do not overflow automatically at 100 percent',()=>{
 const c={objective:'damage',ranges:{speed:{min:128,max:140},defense:{min:600},hit:{min:.3}}};
 for(const key of ['speedAdditionVal','defenseAdditionRate','debuffEnhance'])assert.equal(status(key,c),'conditional');
 assert.equal(status('debuffEnhance',{objective:'hit',panel:{hit:2}}),'core');assert.equal(status('debuffResist',{objective:'resist',panel:{resist:2}}),'core');
});
test('critical overflow is allocated once across the scheme and preserves a separate above-full-crit condition',()=>{
 const gear=[soul('针女',1,[attr('critRateAdditionVal',.08)]),soul('针女',2,[attr('critRateAdditionVal',.06)])];
 const context={objective:'damage',panel:{crit:1.08},gear};const a=assess(gear[0],gear[0].subAttributes[0],context),b=assess(gear[1],gear[1].subAttributes[0],context);
 assert.ok(Math.abs(a.effectiveValue+b.effectiveValue-.06)<1e-8);assert.ok(Math.abs(a.overflowValue+b.overflowValue-.08)<1e-8);assert.equal(b.status,'overflow');
 const extra=assess(gear[1],gear[1].subAttributes[0],{...context,panel:{crit:1.12},ranges:{crit:{min:1.2}}});assert.equal(extra.status,'conditional');assert.equal(extra.overflowValue,0);
 // A raw crit objective values the full panel, including amounts over ordinary full crit.
 assert.equal(assess(gear[1],gear[1].subAttributes[0],{...context,objective:'crit'}).status,'core');
});
test('four-piece Tatami trigger is strict, applied to search and does not mutate user ranges',async()=>{
 const ranges={crit:{max:1.4}}, gear=Array.from({length:4},(_,i)=>soul('叠叩',i+1));const r=suitMechanicRanges(gear,ranges);
 assert.ok(r.crit.min>1.2);assert.deepEqual(ranges,{crit:{max:1.4}});assert.equal(suitMechanicRanges(gear.slice(1),ranges),ranges);
 const base={attack:1000,hp:10000,defense:500,speed:100,crit:1.2,critDamage:1.5,hit:0,resist:0};
 const items=Array.from({length:6},(_,i)=>({...soul(i<4?'叠叩':'针女',i+1),stars:6,level:15,attributesComplete:true,mainAttribute:attr('debuffResist',0)}));
 const catalog=soulCatalog.suits.map(s=>({...s,bonus:null}));const options={base,objective:'speed',requirements:[{suitId:gear[0].suitId,count:4}],ranges:{},mainAttributes:{},excludedIds:[],seconds:1,limit:5};
 assert.equal((await optimizeSouls(items,catalog,options)).plans.length,0);
 options.base={...base,crit:1.200001};assert.equal((await optimizeSouls(items,catalog,options)).plans.length,1);
 assert.deepEqual(options.ranges,{});
});
test('special hero/role hints do not silently change the selected objective',()=>{
 assert.equal(status('defenseAdditionRate',{heroName:'不见岳'},soul('火灵')),'core');
 assert.equal(status('attackAdditionRate',{heroName:'不见岳',objective:'attack'},soul('火灵')),'core');
 assert.match(substatUsageNote(soul('火灵'),{heroName:'不见岳',objective:'damage'}),/防御指标另评/);
 assert.match(substatUsageNote(soul('火灵'),{heroName:'因幡辉夜姬',objective:'damage'}),/暴击伤害指标/);
 assert.equal(status('critRateAdditionVal',{heroName:'因幡辉夜姬'},soul('火灵')),'pending');
});
