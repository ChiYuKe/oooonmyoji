// Run via npm test (builds the renderer test output first).
// 连线生命周期与变量连接命令：普通连线、指针捕获、变量绑定/解绑验证编译产物。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const { createCanvasState } = require('../dist-test-renderer/canvas/state/canvas-state.js');
const { createWorkflowModel } = require('../dist-test-renderer/canvas/model/workflow-model.js');
const { createCanvasCommands } = require('../dist-test-renderer/canvas/state/commands.js');
const { createEditorHistory } = require('../dist-test-renderer/canvas/state/history.js');
const { createCanvasConnections } = require('../dist-test-renderer/canvas/interactions/connections.js');

function harness(raw, options = {}) {
  const state = createCanvasState();
  state.raw = raw;
  const model = createWorkflowModel(state);
  const calls = {rendered: 0, toasts: [], mutated: 0, captured: [], released: []};
  const history = createEditorHistory({
    state,
    cleanupReleased: () => [],
    clearVariableCardSelection: () => {},
    nodeById: model.nodeById,
    normalizeRaw: (value) => value,
    setDirty: () => {},
    render: () => { calls.rendered += 1; },
  });
  const commands = createCanvasCommands({
    state,
    nodes: model.nodes,
    nodeById: model.nodeById,
    layout: model.layout,
    mutate: history.mutate,
    clone: (value) => JSON.parse(JSON.stringify(value)),
    toast: (message, error) => calls.toasts.push([message, Boolean(error)]),
    worldPoint: (event) => ({x: event.clientX, y: event.clientY}),
    wrap: {clientWidth: 0, clientHeight: 0},
    nodeWidth: 260,
    baseHeight: 96,
  });
  const connections = createCanvasConnections({
    state,
    graph: {
      setPointerCapture: (id) => calls.captured.push(id),
      releasePointerCapture: (id) => calls.released.push(id),
    },
    worldPoint: (event) => ({x: event.clientX, y: event.clientY}),
    render: () => { calls.rendered += 1; },
    snapshot: history.snapshot,
    mutate: (fn) => { calls.mutated += 1; history.mutate(fn); },
    connect: commands.connect,
    disconnect: commands.disconnect,
    variableConnectionTargetAt: () => options.variableTarget ? options.variableTarget() : null,
    nodeById: model.nodeById,
    instanceRunCards: () => options.runCards || [],
    variableCompatibleWithPin: () => options.compatiblePin !== false,
    variableCompatibleWithInstanceInput: () => options.compatibleInstance !== false,
    variableLinks: model.variableLinks,
    displayNameOfDefinition: model.displayNameOfDefinition,
    variableDisplayNameOf: model.variableDisplayNameOf,
    toast: (message, error) => calls.toasts.push([message, Boolean(error)]),
  });
  return {state, model, commands, connections, calls};
}

const event = (extra = {}) => ({button: 0, pointerId: 3, clientX: 10, clientY: 20, preventDefault() {}, stopPropagation() {}, ...extra});

test('startConnection 记录起点并清空边选中，按钮非左键忽略', () => {
  const h = harness({nodes: [{id: 'a'}, {id: 'b'}], _layout: {a: {x: 0, y: 0}, b: {x: 0, y: 200}}});
  h.state.selectedEdge = {parent: 'a', child: 'b'};
  h.connections.startConnection(event(), 'a');
  assert.equal(h.state.connect.direction, 'from-output');
  assert.equal(h.state.connect.parent, 'a');
  assert.equal(h.state.selectedEdge, null);
  assert.deepEqual(h.calls.captured, [3]);
  assert.equal(h.calls.rendered, 1);

  h.connections.startConnection(event({button: 2}), 'b');
  assert.equal(h.state.connect.parent, 'a');
});

test('cancelConnection 释放指针并清空连线状态', () => {
  const h = harness({nodes: [{id: 'a'}]});
  h.connections.startConnection(event(), 'a');
  h.connections.cancelConnection();
  assert.equal(h.state.connect, null);
  assert.deepEqual(h.calls.released, [3]);
});

test('finishConnection 重连时把子节点从旧父节点移入新父节点', () => {
  const h = harness({nodes: [
    {id: 'root', type: 'root', children: ['seq1']},
    {id: 'seq1', type: 'sequence', children: ['a', 'b']},
    {id: 'seq2', type: 'sequence', children: ['c']},
    {id: 'a', type: 'task'},
    {id: 'b', type: 'task'},
    {id: 'c', type: 'task'},
  ], _layout: {}});
  h.connections.startConnection(event(), 'seq1');
  h.state.connect.oldChild = 'b';
  h.state.connect.oldIndex = 1;
  h.connections.finishConnection(event(), 'c');
  assert.deepEqual(h.state.raw.nodes.find((node) => node.id === 'seq1').children, ['a', 'c']);
  assert.deepEqual(h.state.raw.nodes.find((node) => node.id === 'seq2').children, []);
  assert.deepEqual(h.calls.toasts, []);
});

test('finishConnection from-input 反向连接父节点', () => {
  const h = harness({nodes: [
    {id: 'root', type: 'root', children: []},
    {id: 'a', type: 'task'},
  ]});
  h.connections.startConnectionFromInput(event(), 'a');
  h.connections.finishConnection(event(), 'root');
  assert.deepEqual(h.state.raw.nodes.find((node) => node.id === 'root').children, ['a']);
  assert.equal(h.state.connect, null);
});

test('变量绑定参数端点：写入 ref、连线映射与提示，不兼容给出错误', () => {
  const h = harness({nodes: [{id: 'n', type: 'task', params: {}}], inputs: {模板: {type: 'asset'}}, _layout: {n: {x: 0, y: 0}}});
  h.connections.connectVariableToPin('inputs', '模板', 'n', 'template', 'card_1');
  assert.deepEqual(h.state.raw.nodes[0].params.template, {ref: 'inputs.模板'});
  assert.equal(h.state.raw._variableLinks['n:template'], 'card_1');
  assert.deepEqual(h.calls.toasts.at(-1), ['参数 template ← 变量 模板', false]);

  h.connections.disconnectVariableFromPin('n', 'template');
  assert.equal(Object.prototype.hasOwnProperty.call(h.state.raw.nodes[0].params, 'template'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(h.state.raw._variableLinks, 'n:template'), false);

  const bad = harness({nodes: [{id: 'n', type: 'task', params: {}}], inputs: {模板: {type: 'asset'}}, _layout: {n: {x: 0, y: 0}}}, {compatiblePin: false});
  bad.connections.connectVariableToPin('inputs', '模板', 'n', 'template');
  assert.deepEqual(bad.calls.toasts.at(-1)[1], true);
  assert.deepEqual(bad.state.raw.nodes[0].params, {});
});

test('变量绑定实例子输入：写入 runs inputs 与映射，断开清理', () => {
  const run = {instance: 'mumu-0', inputs: {}};
  const card = {node: {id: 'p', type: 'task', runs: [run]}, index: 0, x: 0, y: 0, run, variables: [{name: 'input_id', definition: {type: 'number'}}]};
  const h = harness({nodes: [{id: 'p', type: 'task', runs: [run]}], variables: {计数: {type: 'number', default: 0}}, _layout: {p: {x: 0, y: 0}}}, {runCards: [card]});
  h.connections.connectVariableToInstanceInput('variables', '计数', 'p', 0, 'input_id', 'card_1');
  assert.deepEqual(run.inputs.input_id, {ref: 'variables.计数'});
  assert.equal(h.state.raw._variableLinks['p:runs.0.inputs.input_id'], 'card_1');
  h.connections.disconnectVariableFromInstanceInput('p', 0, 'input_id');
  assert.deepEqual(run.inputs, {});
  assert.equal(h.state.raw._variableLinks['p:runs.0.inputs.input_id'], undefined);
});

test('finishVariableConnection 按方向路由到目标并处理无目标', () => {
  const run = {instance: 'mumu-0', inputs: {}};
  const card = {node: {id: 'p', type: 'task', runs: [run]}, index: 0, x: 0, y: 0, run, variables: [{name: 'input_id', definition: {type: 'number'}}]};
  const pinTarget = {kind: 'pin', nodeId: 'n', param: 'template', x: 0, y: 0};
  const h = harness({nodes: [{id: 'n', type: 'task', params: {}}, {id: 'p', type: 'task', runs: [run]}], inputs: {模板: {type: 'asset'}}, _layout: {n: {x: 0, y: 0}, p: {x: 0, y: 0}}}, {
    runCards: [card],
    variableTarget: () => pinTarget,
  });
  h.connections.startVariableConnectionFromCard(event(), 'inputs', '模板', 'card_1');
  h.connections.finishVariableConnection(event());
  assert.deepEqual(h.state.raw.nodes[0].params.template, {ref: 'inputs.模板'});

  const noTarget = harness({nodes: []});
  noTarget.connections.startVariableConnectionFromPin(event(), 'x', 'p');
  noTarget.connections.finishVariableConnection(event());
  assert.equal(noTarget.state.variableConnect, null);
  assert.equal(noTarget.calls.rendered > 0, true);
});
