// Run via npm test (builds the renderer test output first).
// 画布指针交互：拖拽/平移/框选与历史边界验证编译产物。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { createCanvasState } = require('../dist-test-renderer/canvas/state/canvas-state.js');
const { createWorkflowModel } = require('../dist-test-renderer/canvas/model/workflow-model.js');
const { createCanvasPointer } = require('../dist-test-renderer/canvas/interactions/pointer.js');

function harness(raw, options = {}) {
  const state = createCanvasState();
  state.raw = raw;
  const model = createWorkflowModel(state);
  const calls = {rendered: 0, dirty: 0, hidden: 0, cleared: 0, connections: [], cancelled: 0, finishedVariable: 0, events: []};
  const graph = {id: 'graph'};
  const pointer = createCanvasPointer({
    state,
    graph,
    wrap: {getBoundingClientRect: () => ({left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300})},
    worldPoint: (event) => ({x: (event.clientX - state.panX) / state.zoom, y: (event.clientY - state.panY) / state.zoom}),
    position: model.position,
    nodeById: model.nodeById,
    nodes: model.nodes,
    nodeHeight: () => 96,
    snapshot: () => JSON.stringify(state.raw),
    render: () => { calls.rendered += 1; },
    hideMenus: () => { calls.hidden += 1; },
    clearVariableCardSelection: () => { calls.cleared += 1; model.clearVariableCardSelection(); },
    layout: model.layout,
    variableCards: model.variableCards,
    variableCardList: model.variableCardList,
    connectionTargetAt: (event) => options.connectionTarget ? options.connectionTarget(event) : null,
    variableConnectionTargetAt: () => options.variableTarget || null,
    finishConnection: (event, target) => calls.connections.push(target),
    cancelConnection: () => { calls.cancelled += 1; },
    finishVariableConnection: () => { calls.finishedVariable += 1; },
    setDirty: () => { calls.dirty += 1; },
    nodeWidth: 260,
    variableCardWidth: 168,
    variableCardHeight: 58,
  });
  return {state, model, pointer, calls, graph};
}

const event = (extra = {}) => ({button: 0, clientX: 100, clientY: 100, preventDefault() {}, stopPropagation() {}, ...extra});

test('startNodeDrag 处理选中替换/shift 增减并记录拖拽起点与快照', () => {
  const h = harness({nodes: [{id: 'a'}, {id: 'b'}], _layout: {a: {x: 0, y: 0}, b: {x: 300, y: 0}}});
  h.pointer.startNodeDrag(event(), 'a');
  assert.deepEqual([...h.state.selected], ['a']);
  assert.equal(h.state.drag.kind, 'nodes');
  assert.deepEqual(h.state.drag.origins.a, {x: 0, y: 0});
  assert.equal(h.state.drag.before, JSON.stringify(h.state.raw));

  h.pointer.startNodeDrag(event({shiftKey: true}), 'b');
  assert.deepEqual([...h.state.selected].sort(), ['a', 'b']);
  h.pointer.startNodeDrag(event({shiftKey: true}), 'b');
  assert.deepEqual([...h.state.selected], ['a']);
});

test('onPointerDown 区分平移与框选并清空选择', () => {
  const h = harness({nodes: [{id: 'a'}], _layout: {a: {x: 0, y: 0}}});
  h.state.selected.add('a');
  h.pointer.onPointerDown(event({button: 2}));
  assert.equal(h.state.drag.kind, 'pan');
  assert.equal(h.calls.hidden, 1);

  const m = harness({nodes: [{id: 'a'}], _layout: {a: {x: 0, y: 0}}});
  m.state.selected.add('a');
  m.pointer.onPointerDown(event({target: m.graph}));
  assert.equal(m.state.drag.kind, 'marquee');
  assert.equal(m.state.selected.size, 0);
  assert.equal(m.calls.cleared, 1);

  const additive = harness({nodes: [], _layout: {}});
  additive.state.selected.add('keep');
  additive.pointer.onPointerDown(event({target: additive.graph, shiftKey: true}));
  assert.deepEqual([...additive.state.selected], ['keep']);
  assert.equal(additive.state.marquee.additive, true);
});

test('平移移动累积位移并标记 moved；自动平移在边缘触发', () => {
  const h = harness({nodes: []});
  h.pointer.onPointerDown(event({button: 2, clientX: 200, clientY: 150}));
  h.pointer.onPointerMove(event({clientX: 210, clientY: 160}));
  assert.equal(h.state.panX, 90);
  assert.equal(h.state.panY, 58);
  assert.equal(h.state.drag.moved, true);

  const edge = harness({nodes: []});
  edge.state.drag = {kind: 'marquee'};
  const before = edge.state.panX;
  edge.pointer.autoPan(event({clientX: 5, clientY: 5}));
  assert.equal(edge.state.panX, before + 12);
  assert.equal(edge.state.panY, 48 + 12);
});

test('节点拖拽按 8 像素吸附，抬起时形成一次历史', () => {
  const h = harness({nodes: [{id: 'a'}], _layout: {a: {x: 20, y: 20}}});
  h.pointer.startNodeDrag(event({clientX: 100, clientY: 100}), 'a');
  h.pointer.onPointerMove(event({clientX: 137, clientY: 121}));
  assert.deepEqual(h.state.raw._layout.a, {x: 56, y: 40});
  h.pointer.onPointerUp(event({clientX: 137, clientY: 121}));
  assert.equal(h.state.undo.length, 1);
  assert.equal(h.calls.dirty, 1);
  assert.equal(h.state.drag, null);
  assert.equal(h.state.marquee, null);
});

test('未移动的拖拽不进入历史', () => {
  const h = harness({nodes: [{id: 'a'}], _layout: {a: {x: 20, y: 20}}});
  h.pointer.startNodeDrag(event(), 'a');
  h.pointer.onPointerUp(event());
  assert.equal(h.state.undo.length, 0);
  assert.equal(h.calls.dirty, 0);
});

test('框选按节点与变量卡矩形命中，只选中卡片时进入变量详情', () => {
  const h = harness({
    nodes: [{id: 'a'}, {id: 'b'}],
    inputs: {超时: {type: 'number'}},
    _layout: {a: {x: 0, y: 0}, b: {x: 1000, y: 1000}},
    _variableCards: {card_1: {name: '超时', scope: 'inputs', x: 10, y: 10}},
  });
  h.pointer.onPointerDown(event({target: h.graph, clientX: 0, clientY: 0}));
  h.pointer.onPointerMove(event({clientX: 300, clientY: 300}));
  assert.deepEqual([...h.state.selected], ['a']);
  assert.equal(h.state.selected.size, 1);

  const cardsOnly = harness({
    nodes: [{id: 'a'}],
    inputs: {超时: {type: 'number'}},
    _layout: {a: {x: 1000, y: 1000}},
    _variableCards: {card_1: {name: '超时', scope: 'inputs', x: 10, y: 10}},
  });
  cardsOnly.pointer.onPointerDown(event({target: cardsOnly.graph, clientX: 0, clientY: 0}));
  cardsOnly.pointer.onPointerMove(event({clientX: 300, clientY: 300}));
  assert.equal(cardsOnly.state.selected.size, 0);
  assert.deepEqual([...cardsOnly.state.selectedVariableCardIds], ['card_1']);
  assert.equal(cardsOnly.state.selectedVariable, '超时');
  assert.equal(cardsOnly.state.selectedVariableScope, 'inputs');
  assert.equal(cardsOnly.state.inspector, 'variables');
});

test('连线拖拽更新悬停目标，抬起时完成或取消；平移抬起消费右键菜单', () => {
  const h = harness({nodes: []}, {connectionTarget: () => ({kind: 'child', childId: 'a'})});
  h.state.connect = {x: 0, y: 0, pointerId: 5, hover: null};
  h.pointer.onPointerMove(event({pointerId: 5, clientX: 50, clientY: 60}));
  assert.deepEqual(h.state.connect.hover, {kind: 'child', childId: 'a'});
  h.pointer.onPointerUp(event({pointerId: 5}));
  assert.deepEqual(h.calls.connections, [{kind: 'child', childId: 'a'}]);

  const cancel = harness({nodes: []});
  cancel.state.connect = {x: 0, y: 0, pointerId: 5, hover: null};
  cancel.pointer.onPointerUp(event({pointerId: 5}));
  assert.equal(cancel.calls.cancelled, 1);

  const pan = harness({nodes: []});
  pan.pointer.onPointerDown(event({button: 2, clientX: 0, clientY: 0}));
  pan.pointer.onPointerMove(event({clientX: 20, clientY: 0}));
  pan.pointer.onPointerUp(event({clientX: 20, clientY: 0}));
  assert.equal(pan.pointer.contextMenuSuppressedByPan(), true);
  assert.equal(pan.pointer.contextMenuSuppressedByPan(), false);
});
