const test = require('node:test');
const assert = require('node:assert/strict');
const { SoulCalculatorState, filterSouls, formatSoulAttribute, sortSouls } = require('../dist-test-renderer/renderer/features/souls/calculator/index.js');
const { soulMainAttributesForPositions } = require('../dist-test-renderer/shared/soul-slots.js');

test('main attribute choices follow fixed odd positions and distinct even-position rules', () => {
  assert.deepEqual(soulMainAttributesForPositions(['1']), ['attackAdditionVal']);
  assert.deepEqual(soulMainAttributesForPositions(['3']), ['defenseAdditionVal']);
  assert.deepEqual(soulMainAttributesForPositions(['5']), ['maxHpAdditionVal']);
  assert.deepEqual(soulMainAttributesForPositions(['2']), ['attackAdditionRate', 'defenseAdditionRate', 'maxHpAdditionRate', 'speedAdditionVal']);
  assert.deepEqual(soulMainAttributesForPositions(['4']), ['attackAdditionRate', 'defenseAdditionRate', 'maxHpAdditionRate', 'debuffEnhance', 'debuffResist']);
  assert.deepEqual(soulMainAttributesForPositions(['6']), ['attackAdditionRate', 'defenseAdditionRate', 'maxHpAdditionRate', 'critRateAdditionVal', 'critPowerAdditionVal']);
});

test('main attribute choices union selected positions without adding incompatible options', () => {
  assert.deepEqual(soulMainAttributesForPositions(['2', '4']), ['attackAdditionRate', 'defenseAdditionRate', 'maxHpAdditionRate', 'speedAdditionVal', 'debuffEnhance', 'debuffResist']);
  assert.deepEqual(soulMainAttributesForPositions([1, 3, 5]), ['attackAdditionVal', 'defenseAdditionVal', 'maxHpAdditionVal']);
  assert.equal(soulMainAttributesForPositions([]).length, 11);
  assert.deepEqual(soulMainAttributesForPositions(['4', '4']), soulMainAttributesForPositions(['4']));
});

test('sorts subattribute speed precisely without including main or intrinsic speed or mutating snapshots', () => {
  const speed = value => ({ name: 'speedAdditionVal', label: '速度', value, percent: false, rolls: 1 });
  const souls = [
    { id: 'main-only', mainAttribute: speed(57), intrinsicAttributes: [speed(99)], subAttributes: [] },
    { id: 'slow', subAttributes: [speed(12.3451)] },
    { id: 'fast', subAttributes: [speed(17.2)] },
    { id: 'slightly-faster', subAttributes: [speed(12.3452)] },
    { id: 'tie', subAttributes: [speed(17.2)] },
  ];
  const original = JSON.stringify(souls);
  assert.deepEqual(sortSouls(souls, 'sub:speedAdditionVal').map(s => s.id), ['fast', 'tie', 'slightly-faster', 'slow', 'main-only']);
  assert.deepEqual(sortSouls(souls, 'sub:speedAdditionVal', 'asc').map(s => s.id), ['slow', 'slightly-faster', 'fast', 'tie', 'main-only']);
  assert.deepEqual(sortSouls(souls, 'default'), souls);
  assert.equal(JSON.stringify(souls), original);
});

test('keeps absent, undecoded and nonfinite attributes after valid zero values in both directions', () => {
  const souls = [
    { id: 'absent' }, { id: 'undecoded', attributeRolls: [{ name: 'speedAdditionVal', factor: 99 }] },
    { id: 'invalid', subAttributes: [{ name: 'speedAdditionVal', value: NaN }] },
    { id: 'zero', subAttributes: [{ name: 'speedAdditionVal', value: 0 }] },
    { id: 'positive', subAttributes: [{ name: 'speedAdditionVal', value: 2.5 }] },
  ];
  assert.deepEqual(sortSouls(souls, 'sub:speedAdditionVal').map(s => s.id), ['positive', 'zero', 'absent', 'undecoded', 'invalid']);
  assert.deepEqual(sortSouls(souls, 'sub:speedAdditionVal', 'asc').map(s => s.id), ['zero', 'positive', 'absent', 'undecoded', 'invalid']);
});

test('sorts the entire filtered inventory by other attributes, level and stars with missing data last', () => {
  const souls = [
    { id: 'a', position: 2, level: 0, stars: 6, subAttributes: [{ name: 'critRateAdditionVal', value: 0.12 }] },
    { id: 'b', position: 2, level: 15, stars: 5, subAttributes: [{ name: 'critRateAdditionVal', value: 0.15 }] },
    { id: 'c', position: 4, level: 12, stars: 4, subAttributes: [{ name: 'critRateAdditionVal', value: 0.19 }] },
    { id: 'unknown', position: 2, level: null, stars: null },
  ];
  const filtered = filterSouls(souls, '', '', '', { position: '2' });
  assert.deepEqual(sortSouls(filtered, 'sub:critRateAdditionVal').map(s => s.id), ['b', 'a', 'unknown']);
  assert.deepEqual(sortSouls(souls, 'level').map(s => s.id), ['b', 'c', 'a', 'unknown']);
  assert.deepEqual(sortSouls(souls, 'stars', 'asc').map(s => s.id), ['c', 'b', 'a', 'unknown']);
  assert.deepEqual(sortSouls(souls, 'unknown-key'), souls);
});

const snapshot = (id) => ({ instanceId: id, souls: [], total: 0, failed: 0 });
const state = () => {
  const value = new SoulCalculatorState(); value.setInstances([{ id: 'one' }, { id: 'two' }]); return value;
};

test('offline history retains selection and cached souls while preventing device acquisition', async () => {
  const model = state();model.select('one');await model.load({loadSouls:async id=>snapshot(id)});
  model.setInstances([{id:'two',online:true},{id:'one',online:false}]);
  assert.equal(model.selectedId,'one');assert.equal(model.offline,true);assert.equal(model.snapshot.instanceId,'one');
  let called=false;await assert.rejects(model.fetch({fetchSouls:async()=>{called=true;return null;}}),/离线/);assert.equal(called,false);
  model.setInstances([{id:'one',online:true}]);assert.equal(model.offline,false);assert.equal(model.selectedId,'one');
});

test('rapid cache switching loads each instance and late disk data cannot replace a fresh acquisition', async () => {
  const model=state(),finishes={};const api={loadSouls:id=>new Promise(resolve=>{finishes[id]=resolve;})};
  model.select('one');const first=model.load(api);model.select('two');const second=model.load(api);
  finishes.two(snapshot('two'));await second;assert.equal(model.snapshot.instanceId,'two');
  finishes.one(snapshot('one'));await first;assert.equal(model.snapshot.instanceId,'two');
  const other=state();other.select('one');let finish;const old=other.load({loadSouls:()=>new Promise(resolve=>{finish=resolve;})});
  await other.fetch({fetchSouls:async()=>({...snapshot('one'),fetchedAt:'fresh'})});
  finish({...snapshot('one'),fetchedAt:'old'});await old;assert.equal(other.snapshot.fetchedAt,'fresh');assert.equal(other.restoredFromDisk,false);
});

test('requires user selection and keeps snapshots separate when switching instances', async () => {
  const model = state();
  assert.equal(model.selectedId, '');
  await assert.rejects(model.fetch({ fetchSouls: async () => snapshot('one') }), /请选择/);
  const calls = [];
  const api = { fetchSouls: async id => { calls.push(id); return snapshot(id); } };
  model.select('one'); await model.fetch(api); model.select('two');
  assert.equal(model.snapshot, undefined);
  await model.fetch(api); model.select('one');
  assert.equal(model.snapshot.instanceId, 'one'); assert.deepEqual(calls, ['one', 'two']);
});

test('cannot change instance or launch another acquisition during a pending read', async () => {
  const model = state(); model.select('one');
  let finish; const pending = model.fetch({ fetchSouls: () => new Promise(resolve => { finish = resolve; }) });
  model.select('two'); assert.equal(model.selectedId, 'one');
  await assert.rejects(model.fetch({ fetchSouls: async () => null }));
  finish(snapshot('one')); await pending; assert.equal(model.fetchingId, '');
});

test('errors, cancellation and wrong-instance replies preserve last successful data', async () => {
  const model = state(); model.select('one'); await model.fetch({ fetchSouls: async () => snapshot('one') });
  const previous = model.snapshot;
  await assert.rejects(model.fetch({ fetchSouls: async () => { throw Error('offline'); } }), /offline/);
  await assert.rejects(model.fetch({ fetchSouls: async () => snapshot('two') }), /不一致/);
  assert.equal(await model.fetch({ fetchSouls: async () => null }), null);
  assert.equal(model.snapshot, previous); assert.equal(model.fetchingId, '');
  model.setInstances([{ id: 'two' }]); assert.equal(model.selectedId, ''); assert.equal(model.snapshot, undefined);
});

test('search and filters combine without changing the acquired data', () => {
  const souls = [{ id: 'ABC', suitId: 300010, stars: 6, locked: true }, { id: 'DEF', suitId: 300015, stars: 5, equipped: true }];
  assert.deepEqual(filterSouls(souls, ' abc ', '6', 'locked'), [souls[0]]);
  assert.deepEqual(filterSouls(souls, '300015', '', 'equipped'), [souls[1]]);
  assert.deepEqual(filterSouls(souls, '', '5', 'locked'), []); assert.equal(souls.length, 2);
});

test('searches Chinese suit names and formats screenshot values without losing units', () => {
  const souls = [{ id: 'ABC', name: '阴摩罗', suitId: 300027, stars: 6 }];
  assert.deepEqual(filterSouls(souls, ' 阴摩罗 ', '6', ''), souls);
  assert.equal(formatSoulAttribute({ label: '攻击', value: 486, percent: false }), '攻击 +486.00');
  assert.equal(formatSoulAttribute({ label: '速度', value: 16.59822311345787, percent: false }), '速度 +16.60');
  assert.equal(formatSoulAttribute({ label: '暴击', value: 0.029383817871178892, percent: true }), '暴击 +2.94%');
});

test('combines type, position, inclusive level ranges and all selected attributes', () => {
  const matching = { id: 'one', suitId: 300027, position: 2, level: 5, stars: 6, locked: true, equipped: false,
    mainAttribute: { name: 'speedAdditionVal' }, subAttributes: [{ name: 'critRateAdditionVal' }],
    attributeRolls: [{ name: 'debuffEnhance', factor: 0.9 }], intrinsicAttributes: [{ name: 'attackAdditionRate' }] };
  const souls = [matching, { ...matching, id: 'two', level: 6 }, { ...matching, id: 'three', position: 4 },
    { ...matching, id: 'four', suitId: 300013 }, { ...matching, id: 'five', mainAttribute: null },
    { ...matching, id: 'six', intrinsicAttributes: [] }, { ...matching, id: 'seven', subAttributes: [] },
    { ...matching, id: 'eight', level: null }, { ...matching, id: 'nine', equipped: true }];
  const before = JSON.stringify(souls);
  const filters = { suitId: '300027', position: '2', level: '3-5', mainAttribute: 'speedAdditionVal',
    subAttributes: ['critRateAdditionVal', 'debuffEnhance'], intrinsicAttribute: 'attackAdditionRate' };
  assert.deepEqual(filterSouls(souls, '', '6', 'unequipped', filters), [matching]);
  assert.equal(JSON.stringify(souls), before);
  assert.deepEqual(filterSouls([{ ...matching, level: 15 }, matching], '', '', '', { level: '15' }).map(s => s.level), [15]);
  assert.deepEqual(filterSouls([{ ...matching, level: 3 }, matching], '', '', '', { level: '3-5' }).map(s => s.level), [3, 5]);
  assert.deepEqual(filterSouls([matching], '', '', 'unlocked'), []);
});

test('counts distinct subattribute entries, including undecoded rolls, without counting upgrades or intrinsic stats', () => {
  const empty = { id: 'empty', subAttributes: [], attributeRolls: [], mainAttribute: { name: 'attackAdditionVal' }, intrinsicAttributes: [{ name: 'critRateAdditionVal' }] };
  const two = { id: 'two', level: 0, stars: 6, subAttributes: [{ name: 'speedAdditionVal', rolls: 4 }],
    attributeRolls: [{ name: 'speedAdditionVal' }, { name: 'speedAdditionVal' }, { name: 'debuffEnhance' }], attributesComplete: false };
  const four = { id: 'four', subAttributes: ['speedAdditionVal', 'debuffEnhance', 'critRateAdditionVal', 'critPowerAdditionVal'].map(name => ({ name, rolls: 1 })), attributeRolls: [] };
  const souls = [empty, two, four];
  const before = JSON.stringify(souls);
  assert.deepEqual(filterSouls(souls, '', '', '', { subAttributeCount: '0' }), [empty]);
  assert.deepEqual(filterSouls(souls, '', '6', '', { subAttributeCount: '2', subAttributes: ['debuffEnhance'], level: '0-2' }), [two]);
  assert.deepEqual(filterSouls(souls, '', '', '', { subAttributeCount: '4' }), [four]);
  assert.deepEqual(filterSouls(souls, '', '', '', { subAttributeCount: '3' }), []);
  assert.deepEqual(filterSouls(souls, '', '', '', { subAttributeCount: '' }), souls);
  assert.equal(JSON.stringify(souls), before);
});

test('multi-select uses OR within groups and AND between groups, while required subattributes remain AND', () => {
  const a = { id: 'a', suitId: 1, position: 2, stars: 6, level: 0, locked: true, equipped: false,
    mainAttribute: { name: 'attackAdditionVal' }, intrinsicAttributes: [{ name: 'critRateAdditionVal' }],
    subAttributes: [{ name: 'speedAdditionVal' }, { name: 'debuffEnhance' }], attributeRolls: [] };
  const b = { ...a, id: 'b', suitId: 2, position: 4, stars: 5, level: 15, locked: false, equipped: true,
    mainAttribute: { name: 'attackAdditionRate' }, intrinsicAttributes: [{ name: 'debuffResist' }],
    subAttributes: [...a.subAttributes, { name: 'critRateAdditionVal' }, { name: 'critPowerAdditionVal' }] };
  const souls = [a, b, { ...a, id: 'otherPosition', position: 1 }, { ...a, id: 'otherSuit', suitId: 3 },
    { ...a, id: 'otherLevel', level: 3 }, { ...a, id: 'otherMain', mainAttribute: null },
    { ...b, id: 'otherStars', stars: 4 }, { ...b, id: 'otherCount', subAttributes: [...b.subAttributes, { name: 'defenseAdditionVal' }] },
    { ...b, id: 'otherIntrinsic', intrinsicAttributes: [] }, { ...b, id: 'otherState', equipped: false },
    { ...a, id: 'missingRequired', subAttributes: [{ name: 'speedAdditionVal' }, { name: 'critRateAdditionVal' }] }];
  const before = JSON.stringify(souls);
  const filters = { suitId: ['1','2'], position: ['2','4'], level: ['0-2','15'], mainAttribute: ['attackAdditionVal','attackAdditionRate'],
    intrinsicAttribute: ['critRateAdditionVal','debuffResist'], subAttributeCount: ['2','4'], subAttributes: ['speedAdditionVal','debuffEnhance'] };
  assert.deepEqual(filterSouls(souls, '', ['6','5'], ['locked','equipped'], filters), [a, b]);
  assert.deepEqual(filterSouls(souls, '', [], [], { position: [], subAttributeCount: [] }), souls);
  assert.deepEqual(filterSouls([a,b], '', [], ['locked','unlocked']), [a,b]);
  assert.deepEqual(filterSouls([{ ...a, subAttributes: [] }, b], '', [], [], { subAttributeCount: ['0','4'] }).map(s=>s.id), ['a','b']);
  assert.equal(JSON.stringify(souls), before);
});

test('subattribute exclusion combines with inclusion and checks undecoded rolls, not main or intrinsic attributes', () => {
  const keep = { id: 'keep', subAttributes: [{ name: 'speedAdditionVal' }], attributeRolls: [],
    mainAttribute: { name: 'debuffEnhance' }, intrinsicAttributes: [{ name: 'debuffEnhance' }] };
  const decoded = { ...keep, id: 'decoded', subAttributes: [...keep.subAttributes, { name: 'debuffEnhance' }] };
  const raw = { ...keep, id: 'raw', attributeRolls: [{ name: 'debuffEnhance' }], attributesComplete: false };
  const missing = { ...keep, id: 'missing', subAttributes: [] };
  const souls = [keep, decoded, raw, missing];
  assert.deepEqual(filterSouls(souls, '', [], [], { subAttributes: ['speedAdditionVal'], excludedSubAttributes: ['debuffEnhance'] }), [keep]);
  assert.deepEqual(filterSouls(souls, '', [], [], { excludedSubAttributes: ['debuffEnhance'] }), [keep, missing]);
  assert.deepEqual(filterSouls(souls, '', [], [], { subAttributes: ['speedAdditionVal'], excludedSubAttributes: ['speedAdditionVal'] }), []);
});

test('restores each instance from its saved snapshot and reads the disk only once', async () => {
  const model = state(); const calls = [];
  const api = { loadSouls: async id => { calls.push(id); return id === 'one' ? snapshot('one') : null; } };
  model.select('one');
  assert.equal((await model.load(api)).instanceId, 'one');
  assert.equal(model.restoredFromDisk, true);
  await model.load(api);
  assert.deepEqual(calls, ['one']);
  model.select('two');
  assert.equal(model.snapshot, undefined); assert.equal(model.restoredFromDisk, false);
  assert.equal(await model.load(api), null);
  assert.equal(model.snapshot, undefined);
  assert.deepEqual(calls, ['one', 'two']);
});

test('a fresh acquisition replaces the restored flag and keeps instances separate', async () => {
  const model = state(); model.select('one');
  await model.load({ loadSouls: async id => snapshot(id) });
  assert.equal(model.restoredFromDisk, true);
  await model.fetch({ fetchSouls: async id => ({ ...snapshot(id), fetchedAt: 'now' }) });
  assert.equal(model.restoredFromDisk, false);
  model.select('two');
  assert.equal(model.snapshot, undefined);
});
