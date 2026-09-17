// Run via npm test (builds the renderer test output first).
// 画布历史：快照语义、历史边界、撤销重做与文档替换全部验证编译产物。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { createCanvasState } = require('../dist-test-renderer/canvas/state/canvas-state.js');
const { createEditorHistory } = require('../dist-test-renderer/canvas/state/history.js');

function harness(raw) {
  const state = createCanvasState();
  state.raw = raw;
  const calls = { rendered: 0, dirty: 0, cleaned: 0 };
  const history = createEditorHistory({
    state,
    cleanupReleased: () => { calls.cleaned += 1; return []; },
    clearVariableCardSelection: () => { state.selectedVariableCardId = ''; state.selectedVariableCardIds = new Set(); },
    nodeById: (id) => (Array.isArray(state.raw?.nodes) ? state.raw.nodes : []).find((node) => node && node.id === id) || null,
    normalizeRaw: (value) => value,
    setDirty: () => { calls.dirty += 1; },
    render: () => { calls.rendered += 1; },
  });
  return {state, history, calls};
}

test('mutate 合并无改动操作，变更才进入历史并渲染', () => {
  const h = harness({nodes: []});
  h.history.mutate(() => {});
  assert.deepEqual(h.state.undo, []);
  assert.equal(h.calls.rendered, 0);
  assert.equal(h.calls.dirty, 0);

  h.history.mutate(() => { h.state.raw.nodes.push({id: 'a'}); });
  assert.equal(h.state.undo.length, 1);
  assert.equal(h.calls.rendered, 1);
  assert.equal(h.calls.dirty, 1);
  assert.equal(h.calls.cleaned, 2);

  h.history.mutate(() => { h.state.raw.nodes.push({id: 'b'}); }, {render: false});
  assert.equal(h.state.undo.length, 2);
  assert.equal(h.calls.rendered, 1);
});

test('历史上限 80 且新修改清空重做栈', () => {
  const h = harness({nodes: []});
  for (let index = 0; index < 90; index += 1) h.history.mutate(() => { h.state.raw.nodes.push({id: `n_${index}`}); });
  assert.equal(h.state.undo.length, 80);
  assert.equal(h.state.redo.length, 0);
  h.history.undo();
  h.history.redo();
  assert.equal(h.state.undo.length, 80);
  h.history.mutate(() => { h.state.raw.nodes.push({id: 'new'}); });
  assert.deepEqual(h.state.redo, []);
});

test('撤销重做恢复文档并清空画布选择', () => {
  const h = harness({nodes: [{id: 'a'}]});
  h.history.mutate(() => { h.state.raw.nodes.push({id: 'b'}); });
  h.state.selected.add('b');
  h.state.selectedEdge = {parent: 'a', child: 'b'};
  h.state.selectedRun = {nodeId: 'a', index: 0};
  h.history.undo();
  assert.deepEqual(h.state.raw.nodes, [{id: 'a'}]);
  assert.equal(h.state.selected.size, 0);
  assert.equal(h.state.selectedEdge, null);
  assert.equal(h.state.selectedRun, null);
  h.history.redo();
  assert.deepEqual(h.state.raw.nodes, [{id: 'a'}, {id: 'b'}]);
});

test('replaceDocument 拒绝损坏 JSON，按需记录历史并清理失效选择', () => {
  const h = harness({nodes: [{id: 'a', children: ['b']}, {id: 'b'}]});
  h.state.selected.add('a');
  h.state.selectedEdge = {parent: 'a', child: 'b'};
  h.history.replaceDocument('not json');
  assert.equal(h.state.raw.nodes.length, 2);
  assert.equal(h.state.undo.length, 0);

  h.history.replaceDocument(JSON.stringify({nodes: [{id: 'a'}]}), true);
  assert.equal(h.state.undo.length, 1);
  assert.equal(h.state.selectedEdge, null);
  assert.deepEqual([...h.state.selected], ['a']);

  h.state.inspector = 'variables';
  h.state.selectedVariableScope = 'inputs';
  h.state.selectedVariable = 'missing';
  h.history.replaceDocument(JSON.stringify({nodes: [{id: 'a'}], inputs: {keep: {type: 'integer'}}}));
  assert.equal(h.state.selectedVariable, '');
});
