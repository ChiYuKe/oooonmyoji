// Run via npm test (builds the renderer test output first).
// 画布状态工厂：默认值与实例隔离由编译产物验证。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { createCanvasState } = require('../dist-test-renderer/canvas/state/canvas-state.js');
const { createWorkflowModel } = require('../dist-test-renderer/canvas/model/workflow-model.js');

test('状态默认值与旧编辑器一致', () => {
  const state = createCanvasState();
  assert.equal(state.raw, null);
  assert.deepEqual(state.refs, {inputs: [], variables: [], nodes: []});
  assert.equal(state.docUri, '');
  assert.equal(state.zoom, 1);
  assert.equal(state.panX, 80);
  assert.equal(state.panY, 48);
  assert.equal(state.dirty, false);
  assert.equal(state.inspector, 'node');
  assert.equal(state.selectedVariableScope, 'inputs');
  assert.deepEqual(state.nodeSearch, {query: '', ids: [], index: -1});
  assert.equal(state.assetPaths, null);
  assert.equal(state.exportBusy, false);
});

test('每个画布实例的容器与临时状态互不共享', () => {
  const first = createCanvasState();
  const second = createCanvasState();
  first.selected.add('a');
  first.selectedVariableCardIds.add('card_1');
  first.run.set('a', {status: 'running'});
  first.undo.push('snapshot');
  first.paramLiteralCache.x = 1;
  first.nodeSearch.ids.push('a');
  assert.equal(second.selected.size, 0);
  assert.equal(second.selectedVariableCardIds.size, 0);
  assert.equal(second.run.size, 0);
  assert.deepEqual(second.undo, []);
  assert.deepEqual(second.paramLiteralCache, {});
  assert.deepEqual(second.nodeSearch.ids, []);
  assert.notEqual(first.selected, second.selected);
});

test('模型层直接读写同一份状态对象', () => {
  const state = createCanvasState();
  const model = createWorkflowModel(state);
  state.raw = {nodes: [{id: 'a'}], _layout: {a: {x: 8, y: 16}}};
  assert.deepEqual(model.nodes(), [{id: 'a'}]);
  assert.equal(model.nodeById('a').id, 'a');
  assert.deepEqual(model.position(state.raw.nodes[0]), {x: 8, y: 16});
  model.variableCards().card_1 = {name: '超时', scope: 'inputs'};
  assert.equal(model.nextVariableCardId(), 'card_2');
});
