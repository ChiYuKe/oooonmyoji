const test = require('node:test');
const assert = require('node:assert/strict');
const { SoulCalculatorState, filterSouls } = require('../dist-test-renderer/renderer/soul-calculator.js');

const snapshot = (id) => ({ instanceId: id, souls: [], total: 0, failed: 0 });
const state = () => {
  const value = new SoulCalculatorState(); value.setInstances([{ id: 'one' }, { id: 'two' }]); return value;
};

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
