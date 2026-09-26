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
  const calls = {rendered: 0, dirty: 0, hidden: 0, cleared: 0, connections: [], cancelled: 0, finishedVariable: 0, events: [], inspectorNotices: 0};
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
    notifyInspector: () => { calls.inspectorNotices += 1; },
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
  // 清空选区必须告诉详情栏镜像（可见面板在它那边），否则它会停在上一份选区上。
  assert.equal(m.calls.inspectorNotices, 1, '点空白要通知详情面板清空');

  const additive = harness({nodes: [], _layout: {}});
  additive.state.selected.add('keep');
  additive.pointer.onPointerDown(event({target: additive.graph, shiftKey: true}));
  assert.deepEqual([...additive.state.selected], ['keep']);
  assert.equal(additive.state.marquee.additive, true);
  assert.equal(additive.calls.inspectorNotices, 0, 'shift 追加框选没有清空，不用通知');
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

test('pointerdown 起手的拖拽标记 fromPointer：画布入口据此改用 pointer 事件驱动', () => {
  // 起手那一下 preventDefault() 让 Chromium **整段交互都不再派发兼容 mouse 事件**
  // （mousedown / mousemove / mouseup 全没有，实测），只认 mousemove 的话这类拖拽根本
  // 拖不动——「注释框没法像卡片那样拖」就是这么来的。所以它们必须标记出来，
  // 由画布入口改用 pointermove / pointerup 驱动（见 editor.ts 的 pointerDrivenDrag）。
  const h = harness({nodes: [], comments: [{id: 'comment_1', text: 'x', at: {x: 0, y: 0}}]});
  h.pointer.startCommentDrag(event({clientX: 0, clientY: 0}), h.state.raw.comments[0], 'move');
  assert.equal(h.state.drag.fromPointer, true, '注释框拖拽要走 pointer');

  h.pointer.startWaypointDrag(event({clientX: 0, clientY: 0}), 'a', 'b', 0);
  assert.equal(h.state.drag.fromPointer, true, '折点拖拽同样在 pointerdown 里起手');

  // 卡片拖拽是在 mousedown 里起手的：兼容 mouse 事件照常派发，照旧走 mouse，别重复驱动。
  const nodes = harness({nodes: [{id: 'a'}], _layout: {a: {x: 0, y: 0}}});
  nodes.pointer.startNodeDrag(event(), 'a');
  assert.ok(!nodes.state.drag.fromPointer, '卡片拖拽不该标记成 pointer 驱动');
});

test('抬手事件丢了也不会一直拖：没按键还在移动就按松手收尾', () => {
  // 复现「点一下注释框，它就一直跟着鼠标走」：
  // 注释框/折点是在 pointerdown 里起手的，起手那一下 preventDefault() 会让 Chromium
  // 整段交互都不再派发兼容 mouse 事件（实测连 mouseup 都没有），只挂 mouseup 收尾的话
  // state.drag 永远清不掉，之后每一次 mousemove 都还在拖。
  const h = harness({nodes: [], edges: [], comments: [{id: 'comment_1', text: '注释', at: {x: 100, y: 100}, size: {w: 200, h: 120}}]});
  const comment = h.state.raw.comments[0];
  h.pointer.startCommentDrag(event({clientX: 100, clientY: 100}), comment, 'move');
  assert.equal(h.state.drag.kind, 'comment');

  // 松手事件丢了：只有 mousemove，且 buttons === 0。
  h.pointer.onPointerMove(event({clientX: 300, clientY: 260, buttons: 0}));
  assert.equal(h.state.drag, null, '没按键还在移动 = 抬手丢了，必须收尾');
  assert.deepEqual(comment.at, {x: 100, y: 100}, '收尾那一帧不再套用位移');

  // 之后再挪鼠标也不该动它。
  h.pointer.onPointerMove(event({clientX: 500, clientY: 400, buttons: 0}));
  assert.deepEqual(comment.at, {x: 100, y: 100});

  // 真按住时照常拖（buttons 里有左键），并且照旧按 8 像素吸附。
  h.pointer.startCommentDrag(event({clientX: 100, clientY: 100}), comment, 'move');
  h.pointer.onPointerMove(event({clientX: 180, clientY: 140, buttons: 1}));
  assert.deepEqual(comment.at, {x: 184, y: 144});

  // 平移与连线拖拽同样受兜底保护，且不影响正常路径。
  const pan = harness({nodes: []});
  pan.pointer.onPointerDown(event({button: 2, clientX: 0, clientY: 0}));
  const panBefore = pan.state.panX;
  pan.pointer.onPointerMove(event({clientX: 40, clientY: 40, buttons: 0}));
  assert.equal(pan.state.drag, null, '平移也会收尾');
  assert.equal(pan.state.panX, panBefore, '收尾帧不再叠加位移');

  const connect = harness({nodes: []});
  connect.state.connect = {x: 0, y: 0, pointerId: 5, hover: null};
  connect.pointer.onPointerMove(event({pointerId: 5, clientX: 40, clientY: 40, buttons: 0}));
  assert.equal(connect.calls.cancelled, 1, '丢抬手的连线拖拽也要收尾');
});

test('变量卡片拖拽按 origins 移动整组选中的卡片', () => {
  const h = harness({
    inputs: {超时: {type: 'number'}, 阈值: {type: 'number'}},
    _variableCards: {
      card_1: {name: '超时', scope: 'inputs', x: 10, y: 10},
      card_2: {name: '阈值', scope: 'inputs', x: 10, y: 90},
    },
  });
  const snap = (value) => Math.round(value / 8) * 8;
  h.state.drag = {
    kind: 'variable-card', id: 'card_1', start: {x: 0, y: 0},
    origins: {card_1: {x: 10, y: 10}, card_2: {x: 10, y: 90}},
    before: JSON.stringify(h.state.raw), moved: false,
  };
  // 世界坐标 = 客户端坐标 - pan（80/48），所以这里位移正好是 (40, 40)。
  h.pointer.onPointerMove(event({clientX: 120, clientY: 88}));
  assert.equal(h.state.drag.moved, true);
  assert.deepEqual(h.state.raw._variableCards.card_1, {name: '超时', scope: 'inputs', x: snap(50), y: snap(50)});
  assert.deepEqual(h.state.raw._variableCards.card_2, {name: '阈值', scope: 'inputs', x: snap(50), y: snap(130)});
  h.pointer.onPointerUp(event({clientX: 120, clientY: 88}));
  assert.equal(h.state.undo.length, 1, '整组拖拽仍然只形成一次历史');
  assert.equal(h.calls.dirty, 1);
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
