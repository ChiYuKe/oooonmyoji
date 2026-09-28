const { test } = require('node:test');
const assert = require('node:assert/strict');
const { contentSelectionGesture: select } = require('../dist-test-renderer/renderer/content-browser/selection.js');
const order = ['a', 'b', 'c', 'd', 'e'];
const paths = (result) => [...result.paths];

test('plain click replaces selection; Ctrl toggles an individual item and moves the anchor', () => {
  let state = select(order, new Set(['a', 'b']), 'a', 'c');
  assert.deepEqual(paths(state), ['c']);
  state = select(order, state.paths, state.anchor, 'a', { ctrlKey: true });
  assert.deepEqual(paths(state), ['c', 'a']);
  state = select(order, state.paths, state.anchor, 'c', { ctrlKey: true });
  assert.deepEqual(paths(state), ['a']);
  assert.equal(state.anchor, 'c');
});

test('Shift selects an inclusive range in both directions, keeping the anchor stable', () => {
  for (const [anchor, target, expected] of [['b', 'e', ['b', 'c', 'd', 'e']], ['d', 'a', ['a', 'b', 'c', 'd']]]) {
    const state = select(order, new Set([anchor]), anchor, target, { shiftKey: true });
    assert.deepEqual(paths(state), expected);
    assert.equal(state.anchor, anchor);
  }
});

test('repeated Shift gestures shrink or reverse the range rather than accumulating items', () => {
  let state = select(order, new Set(['c']), 'c', 'e', { shiftKey: true });
  state = select(order, state.paths, state.anchor, 'd', { shiftKey: true });
  assert.deepEqual(paths(state), ['c', 'd']);
  state = select(order, state.paths, state.anchor, 'a', { shiftKey: true });
  assert.deepEqual(paths(state), ['a', 'b', 'c']);
});

test('Ctrl+Shift adds a range without discarding disjoint selected items', () => {
  const state = select(order, new Set(['a', 'd']), 'd', 'b', { ctrlKey: true, shiftKey: true });
  assert.deepEqual([...state.paths].sort(), ['a', 'b', 'c', 'd']);
  assert.equal(state.anchor, 'd');
});

test('range follows filtered display order; missing anchor safely starts a new range', () => {
  assert.deepEqual(paths(select(['e', 'c', 'a'], new Set(['e']), 'e', 'a', { shiftKey: true })), ['e', 'c', 'a']);
  const state = select(['c', 'e'], new Set(), 'a', 'e', { shiftKey: true });
  assert.deepEqual(paths(state), ['e']);
  assert.equal(state.anchor, 'e');
});
