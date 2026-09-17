// Run via npm test (builds the renderer test output first).
// 画布连线渲染：父子连线、实例运行连线、拖拽预览与变量连线验证编译产物。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { createCanvasState } = require('../dist-test-renderer/canvas/state/canvas-state.js');
const { createCanvasEdges } = require('../dist-test-renderer/canvas/canvas/edges.js');

function fakeNode(tag, attrs = {}) {
  return {
    tag, attrs, children: [], dataset: {}, events: {}, textContent: '',
    addEventListener(name, fn) { (this.events[name] ||= []).push(fn); },
    fire(name, extra = {}) { for (const fn of this.events[name] || []) fn({button: 0, preventDefault() {}, stopPropagation() {}, altKey: false, ...extra}); },
    querySelectorAll(selector) {
      const cls = selector.replace(/^\./, '');
      return this.children.flatMap((child) => [...((child.attrs.class || '').split(' ').includes(cls) ? [child] : []), ...child.querySelectorAll(selector)]);
    },
  };
}

function harness(nodes, options = {}) {
  const state = createCanvasState();
  state.raw = {root: 'root', nodes};
  const calls = {disconnected: [], disconnectedPins: [], disconnectedInstance: [], mutated: 0, rendered: 0, inspector: []};
  const edges = createCanvasEdges({
    state,
    svgEl: (tag, attrs, parent) => { const node = fakeNode(tag, attrs); parent.children.push(node); return node; },
    bezier: (x1, y1, x2, y2) => `M ${x1} ${y1} C ${x2} ${y2}`,
    nodes: () => state.raw.nodes,
    nodeById: (id) => state.raw.nodes.find((node) => node.id === id) || null,
    position: (node) => (options.positions && options.positions[node.id]) || {x: 0, y: 0},
    nodeHeight: () => options.nodeHeight ?? 96,
    instanceRunCards: () => options.runCards || [],
    instanceRunInputPosition: (card, index) => ({x: card.x + 10, y: card.y + index * 24}),
    variableCardList: () => options.cards || [],
    nodeVariablePins: (node) => node.pins || [],
    variablePinPosition: (node, index) => ({x: 10, y: 96 + index * 24 + 12}),
    disconnect: (parent, child) => calls.disconnected.push([parent, child]),
    disconnectVariableFromPin: (nodeId, param) => calls.disconnectedPins.push([nodeId, param]),
    disconnectVariableFromInstanceInput: (nodeId, runIndex, param) => calls.disconnectedInstance.push([nodeId, runIndex, param]),
    mutate: (fn) => { calls.mutated += 1; fn(); },
    requestInspector: (selection) => calls.inspector.push(selection),
    render: () => { calls.rendered += 1; },
    worldPoint: (event) => ({x: event.clientX, y: event.clientY}),
    captureConnectionPointer: () => 7,
    nodeWidth: 260,
    runCardWidth: 250,
    baseHeight: 96,
    runVariableHeight: 24,
    variableCardWidth: 168,
    variableCardPortY: 29,
    variablePinX: 10,
  });
  return {state, edges, calls, layer: fakeNode('g')};
}

test('renderEdge 绘制选中状态、运行状态与顺序号并支持重连和断开', () => {
  const h = harness([
    {id: 'root', type: 'root', children: ['a']},
    {id: 'a', type: 'task'},
  ], {positions: {root: {x: 0, y: 0}, a: {x: 0, y: 300}}});
  h.state.selectedEdge = {parent: 'root', child: 'a'};
  h.state.run.set('a', {status: 'succeeded'});
  h.edges.renderEdge(h.layer, h.state.raw.nodes[0], 'a', 0);
  const group = h.layer.children[0];
  assert.equal(group.attrs.class, 'edge selected run-succeeded');
  assert.deepEqual(group.dataset, {parent: 'root', child: 'a'});
  const order = group.children.find((child) => child.attrs.class === 'edge-order');
  assert.equal(order.textContent, '1');
  assert.equal(group.children.find((child) => child.attrs.class === 'edge-hit').attrs.d, 'M 130 96 C 130 300');

  group.fire('dblclick');
  assert.deepEqual(h.calls.disconnected, [['root', 'a']]);
  assert.equal(h.calls.mutated, 1);

  const hit = group.children.find((child) => child.attrs.class === 'edge-hit');
  hit.fire('mousedown');
  assert.deepEqual(h.calls.inspector, [{kind: 'edge', parent: 'root', child: 'a'}]);
  assert.deepEqual(h.state.selectedEdge, {parent: 'root', child: 'a'});

  const rewire = group.children.find((child) => child.attrs.class === 'edge-rewire');
  rewire.fire('pointerdown', {clientX: 5, clientY: 6});
  assert.deepEqual(h.state.connect, {direction: 'from-output', parent: 'root', x: 5, y: 6, oldChild: 'a', oldIndex: 0, hover: null, pointerId: 7});
});

test('renderInstanceRunEdge 标注运行序号与卡片连线', () => {
  const card = {node: {id: 'p', type: 'task'}, index: 1, key: 'p:1', x: 100, y: 400, variables: []};
  const h = harness([{id: 'p', type: 'task'}], {positions: {p: {x: 0, y: 0}}, runCards: [card]});
  h.edges.renderInstanceRunEdge(h.layer, card);
  const group = h.layer.children[0];
  assert.equal(group.attrs.class, 'instance-run-edge');
  assert.equal(group.attrs['data-run-key'], 'p:1');
  assert.equal(group.children.find((child) => child.attrs.class === 'edge-order').textContent, '2');
});

test('renderConnection 覆盖 from-output 与 from-input 预览', () => {
  const h = harness([
    {id: 'root', type: 'root', children: ['a']},
    {id: 'a', type: 'task'},
  ], {positions: {root: {x: 0, y: 0}, a: {x: 0, y: 300}}});
  h.state.connect = {direction: 'from-output', parent: 'root', x: 5, y: 6, hover: {x: 1, y: 2}};
  h.edges.renderConnection(h.layer);
  assert.equal(h.layer.children[0].attrs.class, 'connection-preview snapped');
  assert.equal(h.layer.children[0].attrs.d, 'M 130 96 C 5 6');

  h.layer.children.length = 0;
  h.state.connect = {direction: 'from-input', child: 'a', x: 5, y: 6, hover: null};
  h.edges.renderConnection(h.layer);
  assert.equal(h.layer.children[0].attrs.class, 'connection-preview');
  assert.equal(h.layer.children[0].attrs.d, 'M 5 6 C 130 300');
});

test('renderVariableEdges 按 _variableLinks 连到卡片并支持 Alt 断开', () => {
  const node = {id: 'n', type: 'task', pins: [{param: 'template', variable: '模板', scope: 'inputs'}]};
  const h = harness([node], {
    positions: {n: {x: 100, y: 50}},
    cards: [{id: 'card_1', name: '模板', scope: 'inputs', x: 0, y: 0}],
  });
  h.state.raw._variableLinks = {'n:template': 'card_1'};
  h.edges.renderVariableEdges(h.layer);
  const edge = h.layer.children[0];
  assert.equal(edge.attrs.class, 'variable-edge');
  assert.equal(edge.attrs.d, 'M 168 29 C 200 29, 78 158, 110 158');
  edge.fire('pointerdown', {altKey: true});
  assert.deepEqual(h.calls.disconnectedPins, [['n', 'template']]);
});

test('renderVariableConnection 从卡片、实例输入与变量端点出发', () => {
  const card = {node: {id: 'p', type: 'task'}, index: 0, x: 100, y: 400, variables: [{name: '模板'}]};
  const h = harness([{id: 'p', type: 'task'}], {
    cards: [{id: 'card_1', name: '模板', scope: 'inputs', x: 0, y: 0}],
    runCards: [card],
  });
  h.state.variableConnect = {direction: 'from-card', cardId: 'card_1', x: 5, y: 6, hover: {x: 7, y: 8}};
  h.edges.renderVariableConnection(h.layer);
  assert.equal(h.layer.children[0].attrs.class, 'variable-connection-preview snapped');
  assert.equal(h.layer.children[0].attrs.d, 'M 168 29 C 7 8');

  h.layer.children.length = 0;
  h.state.variableConnect = {direction: 'from-instance-input', nodeId: 'p', runIndex: 0, param: '模板', x: 5, y: 6, hover: null};
  h.edges.renderVariableConnection(h.layer);
  assert.equal(h.layer.children[0].attrs.d, 'M 110 400 C 5 6');
});
