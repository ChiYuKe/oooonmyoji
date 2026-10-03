const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { SoulService, readSoulSnapshot } = require('../dist-electron/main/soulService.js');

test('lists historical caches after restart, deduplicates reconnecting devices and preserves names', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onmyoji-soul-history-'));
  try {
    const service = new SoulService(root), write = (id, date, wrapped = false) => {
      const snapshot = {instanceId:id,fetchedAt:date,total:1,failed:0,souls:[{id:'gear',position:1}]};
      const file=service.snapshotPath(id);fs.mkdirSync(path.dirname(file),{recursive:true});
      fs.writeFileSync(file,JSON.stringify(wrapped?{result:snapshot}:snapshot)); return file;
    };
    const first=write('mumu-0','2026-10-03T01:00:00Z'), second=write('mumu-1','2026-10-03T02:00:00Z',true);
    const originals=[first,second].map(file=>fs.readFileSync(file,'utf8'));
    const live=[{id:'mumu-0',backend:'mumu',mumuIndex:0,displayName:'扫地工'},{id:'mumu-1',backend:'mumu',mumuIndex:1,displayName:'吃鱼'}];
    assert.equal((await service.listInstances(live)).length,2);
    const restarted=new SoulService(root), offline=await restarted.listInstances([]);
    assert.deepEqual(offline.map(item=>item.id),['mumu-1','mumu-0']);
    assert.ok(offline.every(item=>item.online===false&&item.cachedCount===1));
    assert.deepEqual(offline.map(item=>item.displayName),['吃鱼','扫地工']);
    assert.equal((await restarted.load('mumu-1')).souls.length,1);
    const reconnect=await restarted.listInstances([{...live[0],displayName:'新名字'},{id:'mumu-2',backend:'mumu',mumuIndex:2}]);
    assert.equal(reconnect.length,3);assert.equal(reconnect.filter(item=>item.id==='mumu-0').length,1);
    assert.equal(reconnect.find(item=>item.id==='mumu-0').online,true);assert.equal(reconnect.find(item=>item.id==='mumu-0').displayName,'新名字');
    assert.equal(reconnect.find(item=>item.id==='mumu-1').online,false);
    assert.equal(reconnect.find(item=>item.id==='mumu-2').cachedAt,undefined);
    assert.deepEqual([first,second].map(file=>fs.readFileSync(file,'utf8')),originals,'enumerating history never rewrites backpacks');
  } finally { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true}); }
});

test('history ignores corrupt, incomplete, misplaced caches and supports legacy names and empty backpacks', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onmyoji-soul-history-invalid-'));
  try {
    const service=new SoulService(root),write=(id,value)=>{const file=service.snapshotPath(id);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};
    const base={fetchedAt:'2026-10-03T00:00:00Z',souls:[],total:0,failed:0};
    write('mumu-4',{...base,instanceId:'mumu-4'});
    write('corrupt','{ invalid');write('incomplete',{...base,instanceId:'incomplete',total:1});
    write('foreign',{...base,instanceId:'mumu-9'});write('invalid-date',{...base,instanceId:'invalid-date',fetchedAt:'not a date'});
    write('missing-fields',{instanceId:'missing-fields',souls:[]});
    fs.mkdirSync(path.join(root,'config'),{recursive:true});
    fs.writeFileSync(path.join(root,'config/config.json'),JSON.stringify({instances:[{id:'mumu-4',backend:'mumu',mumu_index:4,display_name:'旧实例名称'}]}));
    let list=await service.listInstances([]);assert.equal(list.length,1);assert.equal(list[0].displayName,'旧实例名称');assert.equal(list[0].cachedCount,0);assert.equal(list[0].online,false);
    fs.unlinkSync(path.join(root,'config/config.json'));list=await new SoulService(root).listInstances([]);
    assert.equal(list[0].mumuIndex,4);assert.equal(list[0].backend,'mumu');
  } finally { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true}); }
});

function service() {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let launch;
  const value = new SoulService(process.cwd(), (...args) => { launch = args; return child; });
  const event = e => child.stdout.write(JSON.stringify(e) + '\n');
  return { value, child, event, launch: () => launch };
}

test('launches the requested instance and waits for process cleanup before releasing the lock', async () => {
  const { value, child, event, launch } = service(); const events = []; value.on('progress', e => events.push(e));
  const pending = value.fetch('mumu-2');
  assert.ok(launch()[1].includes('mumu-2')); assert.equal(launch()[2].windowsHide, true);
  assert.throws(() => value.fetch('mumu-3'), /正在获取/);
  event({ type: 'progress', instanceId: 'mumu-3', message: 'wrong' });
  event({ type: 'progress', instanceId: 'mumu-2', message: 'reading' });
  event({ type: 'result', result: { instanceId: 'mumu-2', fetchedAt: '2026-10-03T01:23:25.000Z', souls: [], total: 0, failed: 0 } });
  assert.equal(value.running, true); child.emit('close', 0);
  assert.equal((await pending).instanceId, 'mumu-2'); assert.equal(value.running, false); assert.equal(events.length, 1);
});

test('cancellation targets only the active instance and waits for its completion', async () => {
  const { value, child, event } = service(); let commands = ''; child.stdin.on('data', data => commands += data);
  const pending = value.fetch('one'); await value.cancel('two'); assert.equal(commands, '');
  const stopping = value.dispose(); assert.equal(commands, 'cancel\n'); assert.equal(value.running, true);
  event({ type: 'cancelled' }); child.emit('close', 0); assert.equal(await pending, null); await stopping;
});

test('rejects malformed or foreign instance data instead of displaying it', async () => {
  const { value, child, event } = service(); const pending = value.fetch('one');
  event({ type: 'result', result: { instanceId: 'two', souls: [], total: 0, failed: 0 } }); child.emit('close', 0);
  await assert.rejects(pending, /不一致/);
});

test('keeps one snapshot file per instance and loads it back without the device', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onmyoji-souls-'));
  try {
    const value = new SoulService(root);
    assert.notEqual(value.snapshotPath('mumu-0'), value.snapshotPath('mumu-1'));
    assert.equal(await value.load('mumu-0'), null);
    const file = value.snapshotPath('mumu-0');
    assert.ok(file.startsWith(root));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const saved = { instanceId: 'mumu-0', fetchedAt: '2026-10-03T01:23:25.000Z', total: 2, failed: 1, souls: [{ id: 'a' }] };
    fs.writeFileSync(file, JSON.stringify(saved));
    const loaded = await value.load('mumu-0');
    assert.equal(loaded.instanceId, 'mumu-0'); assert.equal(loaded.souls.length, 1); assert.equal(loaded.fetchedAt, saved.fetchedAt);
    // 旧版本把原始导出写进同一文件：兼容 { result: ... }
    fs.writeFileSync(file, JSON.stringify({ report: {}, records: {}, tables: {}, result: saved }));
    assert.equal((await value.load('mumu-0')).total, 2);
    // 别的实例的数据、缺字段和坏文件都不算命中
    fs.writeFileSync(file, JSON.stringify({ ...saved, instanceId: 'mumu-1' }));
    assert.equal(await value.load('mumu-0'), null);
    fs.writeFileSync(file, JSON.stringify({ instanceId: 'mumu-0', souls: [] }));
    assert.equal(await value.load('mumu-0'), null);
    fs.writeFileSync(file, '{ not json');
    assert.equal(await value.load('mumu-0'), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('snapshot validator accepts only complete, matching payloads', () => {
  const base = { instanceId: 'one', souls: [], total: 0, failed: 0, fetchedAt: 'now' };
  assert.equal(readSoulSnapshot(base, 'one').instanceId, 'one');
  assert.equal(readSoulSnapshot({ result: base }, 'one').instanceId, 'one');
  assert.equal(readSoulSnapshot(base, 'two'), null);
  assert.equal(readSoulSnapshot({ ...base, souls: undefined }, 'one'), null);
  assert.equal(readSoulSnapshot({ ...base, fetchedAt: undefined }, 'one'), null);
  assert.equal(readSoulSnapshot(null, 'one'), null);
});

test('legacy snapshots recover special item positions from client config without mutating saved data', () => {
  const souls = [180001,180008,180009,180010,180005,180012,180099,180100,180101].map((itemId,i)=>({id:String(i),itemId,position:null}));
  const raw = {result:{instanceId:'one',souls,total:souls.length,failed:0,fetchedAt:'now'},tables:{init:{
    180001:{equipType:11},180008:{equipType:12},180009:{equipType:13},180010:{equipType:14},180005:{equipType:15},180012:{equipType:16},
    180099:{equipType:17},180100:{equipType:'11'},
  }}};
  const before=JSON.stringify(raw), restored=readSoulSnapshot(raw,'one');
  assert.deepEqual(restored.souls.map(s=>s.position),[1,2,3,4,5,6,null,null,null]);
  assert.equal(JSON.stringify(raw),before);
  assert.equal(readSoulSnapshot(raw,'two'),null);
  assert.deepEqual(readSoulSnapshot(raw.result,'one').souls.map(s=>s.position),Array(9).fill(null),'no position guesses when client metadata is absent');
});

test('plain caches recover positions from matching raw metadata and ignore stale or foreign exports', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'onmyoji-soul-slots-'));
  try {
    const service=new SoulService(root), file=service.snapshotPath('one'), rawFile=path.join(path.dirname(file),'raw.json');
    fs.mkdirSync(path.dirname(file),{recursive:true});
    const snapshot={instanceId:'one',fetchedAt:'now',total:1,failed:0,souls:[{id:'reward',itemId:180005,position:null}]};
    fs.writeFileSync(file,JSON.stringify(snapshot)); const before=fs.readFileSync(file,'utf8');
    const raw={result:snapshot,tables:{init:{180005:{equipType:15}}}};
    fs.writeFileSync(rawFile,JSON.stringify(raw));
    assert.equal((await service.load('one')).souls[0].position,5);
    assert.equal(fs.readFileSync(file,'utf8'),before,'loading repairs only the in-memory snapshot');
    for(const result of [{...snapshot,fetchedAt:'older'},{...snapshot,instanceId:'two'},{...snapshot,total:2}]) {
      fs.writeFileSync(rawFile,JSON.stringify({...raw,result}));
      assert.equal((await service.load('one')).souls[0].position,null);
    }
    fs.writeFileSync(rawFile,'{ bad');assert.equal((await service.load('one')).souls.length,1);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('restores shared local icons when switching between new and legacy instance snapshots', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onmyoji-soul-icons-'));
  try {
    fs.mkdirSync(path.join(root, 'assets', 'soul-icons'), { recursive: true });
    fs.writeFileSync(path.join(root, 'assets', 'soul-icons', '300027.png'), 'local icon');
    const value = new SoulService(root);
    const write = (id, payload) => {
      const file = value.snapshotPath(id); fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(payload)); return file;
    };
    const base = { fetchedAt: '2026-10-02T14:40:07.000Z', total: 4, failed: 0,
      souls: [{ id: 'a', suitId: 300027, iconUrl: null }, { id: 'b', suitId: 300027 },
        { id: 'c', suitId: 300027, iconUrl: 'outdated-url' }, { id: 'd', suitId: 300999, iconUrl: 'missing-url' }] };
    write('one', { ...base, instanceId: 'one' });
    const legacyFile = write('two', { result: { ...base, instanceId: 'two' }, records: {} });
    const before = fs.readFileSync(legacyFile, 'utf8');
    for (const id of ['one', 'two', 'one', 'two']) {
      const loaded = await value.load(id);
      assert.equal(loaded.instanceId, id); assert.equal(loaded.fetchedAt, base.fetchedAt);
      assert.equal(loaded.souls.length, 4);
      for (const soul of loaded.souls.slice(0, 3)) assert.equal(soul.iconUrl, 'onmyoji-resource://project/assets/soul-icons/300027.png');
      assert.equal(loaded.souls[3].iconUrl, null);
    }
    assert.equal(fs.readFileSync(legacyFile, 'utf8'), before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
