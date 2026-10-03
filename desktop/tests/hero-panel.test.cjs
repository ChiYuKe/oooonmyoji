const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {HeroPanelService} = require('../dist-electron/main/heroPanelService');
const {ownedEquipmentPanel, ownedHeroBaseRequest, catalogHeroBase, EMPTY_PANEL} = require('../dist-electron/shared/hero-panel');
const {soulCatalog} = require('../dist-electron/shared/soul-catalog-data');
const base = {attack:1000,hp:10000,defense:400,speed:110,crit:.1,critDamage:1.5,hit:0,resist:0};
const attr = (name,value) => ({name,value,label:name,rolls:1,percent:name.includes('Rate')});
const gear = (id,suitId,main,subs=[],intrinsic=[]) => ({id,suitId,mainAttribute:main,subAttributes:subs,intrinsicAttributes:intrinsic,attributesComplete:true});
const suits = [{id:1,bonus:{name:'critRateAdditionVal',value:.15},boss:false}, {id:2,bonus:null,boss:true}];
const records = new Map([
  gear('a',1,attr('attackAdditionVal',486),[attr('attackAdditionRate',.1)]),
  gear('b',1,attr('maxHpAdditionVal',2052)),
  gear('c',1,attr('defenseAdditionVal',104)),
  gear('d',1,attr('critRateAdditionVal',.55)),
  gear('e',2,attr('attackAdditionRate',.55),[attr('critPowerAdditionVal',.4)],[attr('debuffResist',.08)]),
  gear('f',2,attr('speedAdditionVal',57),[],[attr('debuffResist',.08)]),
].map(s=>[s.id,s]));
const copy = {heroId:354,level:40,stars:6,awake:true,equips:[...records.keys()]};

test('owned panels show exact additions and totals, including two-piece and boss intrinsic attributes once', () => {
  const result=ownedEquipmentPanel(copy,records,base,suits);
  assert.equal(result.incomplete,false);
  assert.deepEqual(result.total,{attack:2136,hp:12052,defense:504,speed:167,crit:.8,critDamage:1.9,hit:0,resist:.16});
  for(const key of Object.keys(base)) assert.ok(Math.abs(result.total[key]-base[key]-result.addition[key])<1e-9);
  assert.ok(Math.abs(result.addition.crit-.7)<1e-9,'four matching souls grant one 15% bonus');
  assert.equal(result.addition.resist,.16,'each boss piece intrinsic applies; no extra suit stat');
  const empty=ownedEquipmentPanel({...copy,equips:Array(6).fill(null)},records,base,suits);
  assert.deepEqual(empty.total,base);assert.deepEqual(empty.addition,EMPTY_PANEL);
});

test('missing gear/attributes never understate totals; missing bases retain only exact additions', () => {
  for(const equipped of [['lost'],['incomplete']]) {
    const incomplete=new Map(records);incomplete.set('incomplete',{...records.get('a'),attributesComplete:false});
    const result=ownedEquipmentPanel({...copy,equips:equipped},incomplete,base,suits);
    assert.equal(result.incomplete,true);assert.equal(result.total,null);assert.ok(Object.values(result.addition).every(value=>value===null));
  }
  const offline=ownedEquipmentPanel(copy,records,null,suits);
  assert.equal(offline.total,null);assert.equal(offline.addition.attack,null);
  assert.equal(offline.addition.hp,2052);assert.equal(offline.addition.speed,57);
  assert.ok(Math.abs(offline.addition.crit-.7)<1e-9);
});

test('encyclopedia base is restricted to its actual level, stars and form, and SP has no awaken mode', () => {
  const sp=soulCatalog.heroes.find(h=>h.id===354);
  const request=ownedHeroBaseRequest(copy,sp);assert.equal(request.awake,false);assert.deepEqual(catalogHeroBase(request,sp),sp.base);
  assert.equal(catalogHeroBase({...request,level:1,stars:2},sp),null);
  const ssr=soulCatalog.heroes.find(h=>h.id===217);
  assert.equal(catalogHeroBase({heroId:217,level:40,stars:6,awake:false},ssr),null);
});

test('per-level public base requests are deduplicated, validated and cached across restarts for offline use', async t => {
  const prefix=path.join(os.tmpdir(),'onmyoji-panels-');
  const directory=await fs.mkdtemp(prefix);t.after(()=>{assert.ok(path.resolve(directory).startsWith(path.resolve(prefix)));return fs.rm(directory,{recursive:true,force:true});});
  const request={heroId:354,level:1,stars:2,awake:false};let calls=0;
  const fetcher=async(url,options)=>{
    calls++;assert.match(url,/heroid=354&awake=0&level=1&star=2$/);assert.ok(options.signal);
    return new Response(JSON.stringify({success:true,data:{attack:154.94,maxHp:981.72,defense:64.5,speed:115,critRate:.12,critPower:.5,debuffEnhance:0,debuffResist:0}}));
  };
  const service=new HeroPanelService(directory,fetcher);
  const [a,b]=await Promise.all([service.load(request),service.load(request)]);assert.equal(calls,1);assert.deepEqual(a,b);assert.equal(a.critDamage,1.5);assert.equal(a.attack,154.94);
  const offline=new HeroPanelService(directory,async()=>{throw Error('offline');});assert.deepEqual(await offline.load(request),a);
  assert.deepEqual(await offline.load({...request,level:40,stars:6}),soulCatalog.heroes.find(h=>h.id===354).base);
  assert.equal(await offline.load({...request,level:2}),null,'must not reuse a different level');
  for(const bad of [null,{...request,heroId:99999},{...request,level:'1'},{...request,stars:7},{...request,awake:true}]) await assert.rejects(service.load(bad),/参数无效/);
  await fs.writeFile(path.join(directory,'artifacts','hero-panels','354-1-2-0.json'),JSON.stringify({...request,level:40,base}));
  assert.equal(await offline.load(request),null,'mismatched cache metadata is rejected');
});

test('incomplete public responses and network failures return unknown instead of guessed stats', async t => {
  const prefix=path.join(os.tmpdir(),'onmyoji-invalid-panels-');
  const directory=await fs.mkdtemp(prefix);t.after(()=>{assert.ok(path.resolve(directory).startsWith(path.resolve(prefix)));return fs.rm(directory,{recursive:true,force:true});});
  for(const payload of [{success:false},{success:true,data:{critPower:.5}},{success:true,data:{attack:-1,maxHp:10,defense:1,speed:1,critRate:.1,critPower:.5,debuffEnhance:0,debuffResist:0}}]) {
    const service=new HeroPanelService(directory,async()=>new Response(JSON.stringify(payload)));
    assert.equal(await service.load({heroId:354,level:1,stars:2,awake:false}),null);
  }
});
