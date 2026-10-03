const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { HeroOwnershipService } = require('../dist-electron/main/heroOwnershipService');
const { readHeroOwnership, groupOwnedHeroes } = require('../dist-electron/shared/hero-ownership');
const snapshot = id => ({instanceId:id,fetchedAt:'2026-10-03T01:00:00Z',source:'memory',total:3,counts:{217:2,389:1}});
const copy = (id, extra={}) => ({id,heroId:217,level:40,stars:6,awake:true,locked:false,skills:[{id:2171,level:5},{id:2172,level:3}],equips:Array(6).fill(null),...extra});
const soul = (id, value=12) => ({id,itemId:110001,suitId:300030,position:1,stars:6,level:15,locked:false,equipped:true,discarded:false,
  baseAttributeIndex:0,baseValue:486,attributeRolls:[{name:'speedAdditionVal',factor:value}],
  mainAttribute:{name:'attackAdditionVal',label:'攻击',value:486,percent:false,rolls:1},
  subAttributes:[{name:'speedAdditionVal',label:'速度',value,percent:false,rolls:2}],intrinsicAttributes:[],attributesComplete:true});
const detailed = (heroes,equippedSouls=[]) => ({...snapshot('a'),total:heroes.length,counts:{217:heroes.length},heroes,equippedSouls});

test('owned copies group by actual configuration rather than UID, lock or skill order', () => {
  const data=detailed([copy('one'),copy('two',{locked:true,skills:[{id:2172,level:3},{id:2171,level:5}]}),
    copy('three',{level:35}),copy('four',{skills:[{id:2171,level:4},{id:2172,level:3}]}),
    copy('five',{equips:['gear1',null,null,null,null,null]}),copy('six',{equips:['gear2',null,null,null,null,null]}),
    copy('seven',{equips:['gear3',null,null,null,null,null]})],[soul('gear1'),soul('gear2'),soul('gear3',13)]);
  assert.ok(readHeroOwnership(data,'a'));
  const groups=groupOwnedHeroes(data,217);assert.equal(groups.length,5);
  assert.equal(groups.find(g=>g.ids.includes('one')).count,2);assert.equal(groups.find(g=>g.ids.includes('one')).lockedCount,1);
  assert.equal(groups.find(g=>g.ids.includes('five')).count,2);
  assert.equal(groups.find(g=>g.ids.includes('seven')).count,1);assert.deepEqual(groupOwnedHeroes(data,389),[]);
});

test('detail snapshots reject missing copies, duplicate identities and foreign/misplaced equipment', () => {
  const good=detailed([copy('one')]);assert.ok(readHeroOwnership(good,'a'));
  assert.ok(readHeroOwnership(detailed([copy('material',{level:60})]),'a'));
  for(const bad of [{...good,total:2,counts:{217:2}},detailed([copy('same'),copy('same')]),
    detailed([copy('one',{level:null})]),detailed([copy('one',{equips:['lost',null,null,null,null,null]})]),
    detailed([copy('one',{equips:[null,'gear',null,null,null,null]})],[soul('gear')]),
    {...good,counts:{389:1}},{...good,equippedSouls:undefined},detailed([copy('one',{skills:[{id:2171,level:0}]})])]) assert.equal(readHeroOwnership(bad,'a'),null);
});

test('complete snapshots distinguish empty inventory from invalid data', () => {
  assert.ok(readHeroOwnership(snapshot('a'),'a'));
  assert.ok(readHeroOwnership({...snapshot('a'),total:0,counts:{}},'a'));
  for(const value of [null,{...snapshot('a'),total:4},{...snapshot('a'),counts:{217:-1,389:4}},snapshot('b'),{...snapshot('a'),fetchedAt:'bad'}]) assert.equal(readHeroOwnership(value,'a'),null);
});

test('per-instance offline caches survive invalid records and process failures', async t => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'onmyoji-heroes-'));
  t.after(async()=>{assert.ok(directory.startsWith(path.join(os.tmpdir(),'onmyoji-heroes-')));await fs.rm(directory,{recursive:true,force:true});});
  let child;
  const launch=()=>{child=new EventEmitter(); child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();return child;};
  const service=new HeroOwnershipService(directory,launch);
  const file=service.snapshotPath('mumu-0');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(snapshot('mumu-0')));
  assert.deepEqual(await service.load('mumu-0'),snapshot('mumu-0'));assert.equal(await service.load('mumu-1'),null);
  assert.deepEqual((await service.listInstances([])).map(x=>[x.id,x.online]),[['mumu-0',false]]);
  assert.equal((await service.listInstances([{id:'mumu-0',online:true}])).length,1);
  const failed=service.fetch('mumu-0'); assert.equal(service.running,true); assert.throws(()=>service.fetch('mumu-1'),/正在检测/);
  child.stdout.write(JSON.stringify({type:'result',result:snapshot('mumu-1')})+'\n'); child.emit('close',0);
  await assert.rejects(failed,/不完整或与所选实例不一致/);assert.equal(service.running,false);
  assert.deepEqual(await service.load('mumu-0'),snapshot('mumu-0'));
  const cancelled=service.fetch('mumu-0');const closing=service.cancel('mumu-0');
  assert.equal(service.running,true);child.stdout.write('{"type":"cancelled"}\n');child.emit('close',0);
  assert.equal(await cancelled,null);await closing;assert.equal(service.running,false);
  await fs.writeFile(file,JSON.stringify({...snapshot('mumu-0'),total:4}));assert.equal(await service.load('mumu-0'),null);
  assert.deepEqual(await service.listInstances([]),[]);
});
