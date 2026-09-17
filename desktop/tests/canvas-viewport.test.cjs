// Run via npm test (builds the renderer test output first).
// 画布视口与布局计算：自动布局、包围盒、适配、缩放与坐标换算验证编译产物。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { createCanvasState } = require('../dist-test-renderer/canvas/state/canvas-state.js');
const { createWorkflowModel } = require('../dist-test-renderer/canvas/model/workflow-model.js');
const { createCanvasViewport } = require('../dist-test-renderer/canvas/canvas/viewport.js');

function harness(raw, options = {}) {
  const state = createCanvasState();
  state.raw = raw;
  const model = createWorkflowModel(state);
  const calls = {rendered: 0, mutated: 0};
  const wrap = {getBoundingClientRect: () => ({left: 0, top: 0, width: 400, height: 300}), clientWidth: 400, clientHeight: 300};
  const viewport = createCanvasViewport({
    state,
    nodes: model.nodes,
    position: model.position,
    layout: model.layout,
    mutate: (fn) => { calls.mutated += 1; fn(); },
    instanceRunCards: () => options.runCards || [],
    variableCardList: model.variableCardList,
    nodeHeight: options.nodeHeight || (() => 96),
    wrap,
    minimap: () => options.minimap || null,
    render: () => { calls.rendered += 1; },
    nodeWidth: 260,
    baseHeight: 96,
    runCardWidth: 250,
    variableCardWidth: 168,
    variableCardHeight: 58,
  });
  return {state, model, viewport, calls};
}

function tree() {
  return {root: 'root', nodes: [
    {id: 'root', type: 'root', children: ['seq']},
    {id: 'seq', type: 'sequence', children: ['a', 'b']},
    {id: 'a', type: 'task', params: {}},
    {id: 'b', type: 'task', params: {}},
  ]};
}

test('autoLayout 叶子横向排开、父节点居中、深度决定纵向', () => {
  const h = harness(tree());
  h.viewport.autoLayout(false);
  assert.equal(h.calls.mutated, 0);
  assert.deepEqual(h.state.raw._layout, {
    a: {x: 0, y: 416},
    b: {x: 332, y: 416},
    seq: {x: 166, y: 208},
    root: {x: 166, y: 0},
  });
  const recorded = harness(tree());
  recorded.viewport.autoLayout();
  assert.equal(recorded.calls.mutated, 1);
});

test('autoLayout 为未连边的孤立节点补位', () => {
  const h = harness({root: 'root', nodes: [
    {id: 'root', type: 'root', children: []},
    {id: 'lonely', type: 'task', params: {}},
  ]});
  h.viewport.autoLayout(false);
  assert.deepEqual(h.state.raw._layout.root, {x: 0, y: 0});
  assert.deepEqual(h.state.raw._layout.lonely, {x: 332, y: 0});
});

test('ensureLayout 仅在缺坐标时自动布局', () => {
  const h = harness(tree());
  h.state.raw._layout = {root: {x: 0, y: 0}, seq: {x: 0, y: 0}, a: {x: 0, y: 0}, b: {x: 0, y: 0}};
  h.viewport.ensureLayout();
  assert.equal(h.calls.mutated, 0);
  assert.deepEqual(h.state.raw._layout.seq, {x: 0, y: 0});
  const missing = harness(tree());
  missing.viewport.ensureLayout();
  assert.deepEqual(missing.state.raw._layout.seq, {x: 166, y: 208});
});

test('bounds 合并节点、实例卡与变量卡', () => {
  const h = harness({root: 'n', nodes: [{id: 'n', type: 'task', params: {}}], inputs: {超时: {type: 'number'}}, _layout: {n: {x: 100, y: 50}}}, {
    runCards: [{x: 20, y: 10, height: 78}],
  });
  h.model.variableCards().card_1 = {name: '超时', scope: 'inputs', x: 5, y: 5};
  assert.deepEqual(h.viewport.bounds(), {minX: 5, minY: 5, maxX: 360, maxY: 146});
  const empty = harness(null);
  assert.deepEqual(empty.viewport.bounds(), {minX: 0, minY: 0, maxX: 260, maxY: 96});
});

test('worldPoint 与 zoomAt 按视口换算并限制缩放范围', () => {
  const h = harness(tree());
  h.state.panX = 10; h.state.panY = 20; h.state.zoom = 2;
  assert.deepEqual(h.viewport.worldPoint({clientX: 30, clientY: 60}), {x: 10, y: 20});

  h.state.zoom = 1; h.state.panX = 80; h.state.panY = 48;
  h.viewport.zoomAt(2);
  assert.equal(h.state.zoom, 2);
  assert.equal(h.state.panX, -40);
  assert.equal(h.state.panY, -54);
  assert.equal(h.calls.rendered, 1);

  h.viewport.zoomAt(10);
  assert.equal(h.state.zoom, 2.5);
  h.viewport.zoomAt(0.001);
  assert.equal(h.state.zoom, 0.25);
});

test('fitView 为小地图预留底部空间并居中内容', () => {
  const h = harness(tree(), {minimap: {getBoundingClientRect: () => ({height: 60})}});
  h.state.raw._layout = {root: {x: 0, y: 0}, seq: {x: 0, y: 0}, a: {x: 0, y: 0}, b: {x: 0, y: 0}};
  h.viewport.fitView();
  const zoom = 216 / 256;
  assert.equal(h.state.zoom, zoom);
  assert.equal(h.state.panX, (400 - 260 * zoom) / 2);
  assert.equal(h.state.panY, (216 - 96 * zoom) / 2);
  assert.equal(h.calls.rendered, 1);
});

test('bezier 输出带最小弯曲量的三次曲线', () => {
  const h = harness(tree());
  assert.equal(h.viewport.bezier(0, 0, 100, 20), 'M 0 0 C 0 48, 100 -28, 100 20');
});
